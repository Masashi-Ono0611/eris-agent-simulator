#!/usr/bin/env python3
"""G0: the intersection of planned coverage, scoring integrity and load checks (offline)."""
import argparse
from collections import Counter
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
from league_harness import ROOT, index_path, roster_agents
from g0_contract import THRESHOLDS, summary_errors

_spec = importlib.util.spec_from_file_location('degradation_gate', Path(__file__).with_name('degradation-gate.py'))
load_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(load_gate)


def tokens(value):
    if isinstance(value, list): value = ' '.join(value)
    result = (value or '').replace(',', ' ').split()
    if not result or len(set(result)) != len(result): raise ValueError('expectations empty/duplicate')
    return result


def verdict(failed, blocked):
    return 'BLOCKED' if blocked else 'FAIL' if failed else 'PASS'


def evaluate(index, roster, regimes, seeds, baseline=None, manifest=None):
    result = dict(schema='ascon-g0-v1', status='BLOCKED', failed=[], blocked=[], runs=[],
                  thresholds=THRESHOLDS, commit=None, zip_sha256=None, manifest_sha256=None)
    failed, blocked = result['failed'], result['blocked']
    try:
        regimes, seeds = tokens(regimes), tokens(seeds)
        expected_agents = roster_agents(roster)
        ids = [a['id'] for a in expected_agents]
        baselines = {a['id']:a['baseline'] for a in expected_agents}
        result['expected'] = dict(regimes=regimes, seeds=seeds, agents=ids)
        index = index_path(index)
        result['index_sha256'] = hashlib.sha256(index.read_bytes()).hexdigest()
        result['roster_sha256'] = hashlib.sha256(Path(roster).read_bytes()).hexdigest()
        if list(index.parent.glob('.matrix-tmp-*')): blocked.append('active/incomplete matrix')
        with index.open(newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f, delimiter='\t')
            if not {'regime','seed','run_dir','exit_code'} <= set(reader.fieldnames or []):
                raise ValueError('index header malformed')
            rows = list(reader)
        expected = {(r,s) for r in regimes for s in seeds}
        keys = Counter((r.get('regime'),r.get('seed')) for r in rows)
        if set(keys) != expected or any(n != 1 for n in keys.values()):
            failed.append('scenario mismatch: missing/extra/duplicate')
        seen_paths, seen_ids = set(), set()
        extracted = []
        load_pairs = []
        for row in rows:
            r = dict(regime=row.get('regime'), seed=row.get('seed'), failed=[], blocked=[])
            result['runs'].append(r)
            if None in row or not row.get('run_dir'):
                r['failed'].append('index row malformed/empty run_dir'); continue
            path = Path(row['run_dir'])
            if not path.is_absolute(): path = ROOT/path
            path = path.resolve()
            if path in seen_paths: r['failed'].append('duplicate run path')
            seen_paths.add(path)
            try:
                summary = json.loads((path/'summary.json').read_text())
                r['failed'].extend(summary_errors(summary, ids))
                if not isinstance(summary, dict): continue
                for agent in summary.get('agents', []) if isinstance(summary.get('agents'),list) else []:
                    if isinstance(agent,dict) and isinstance(agent.get('id'),str) and agent['id'] in baselines:
                        if bool(agent.get('baseline',False)) != baselines[agent['id']]:
                            r['failed'].append('baseline membership mismatch: '+agent['id'])
                run_id = summary.get('runId')
                if isinstance(run_id, str):
                    if run_id in seen_ids: r['failed'].append('duplicate runId')
                    seen_ids.add(run_id)
                # Inclusion counts cross-check a complete, parseable transaction log.
                with (path/'blocks.csv').open(newline='') as f:
                    reader = csv.DictReader(f)
                    if not {'ownerId','gasUsed','priorityFeeWei','maxFeePerGasWei'} <= set(reader.fieldnames or []):
                        raise ValueError('blocks.csv header')
                    counts = Counter()
                    for tx in reader:
                        if None in tx or any(tx.get(k) is None for k in reader.fieldnames): raise ValueError('blocks.csv row')
                        for k in ('gasUsed','priorityFeeWei','maxFeePerGasWei'):
                            if int(tx[k]) < 0: raise ValueError('negative transaction metric')
                        if tx['ownerId'] in ids: counts[tx['ownerId']] += 1
                for a in summary.get('agents', []):
                    if not isinstance(a, dict): continue
                    n = a.get('includedTxCount')
                    if not isinstance(n,int) or isinstance(n,bool) or n < 0:
                        r['blocked'].append('includedTxCount missing/invalid'); continue
                    if counts[a['id']] != n: r['failed'].append('blocks.csv inclusion mismatch: '+a['id'])
            except (OSError, ValueError, KeyError, TypeError): r['blocked'].append('summary/blocks.csv missing or malformed')
            try:
                load = load_gate.extract((path,row.get('regime'),row.get('exit_code')),SimpleNamespace(**THRESHOLDS))
                extracted.append(load)
                load_pairs.append((r,load))
                r['failed'].extend(load['failed']); r['blocked'].extend(load['blocked'])
                r.update(run_id=load['id'], loops=load['loops'], blocks=load['blocks'], p99_ms=load['p99'])
                if any(a['timeouts'] for a in load['agents'].values()): r['failed'].append('decide timeout')
            except (OSError, ValueError, TypeError, KeyError): r['blocked'].append('load telemetry malformed')
        if baseline:
            try:
                base = [load_gate.extract(s,SimpleNamespace(**THRESHOLDS)) for s in load_gate.sources(baseline)]
                load_gate.compare(base,extracted,SimpleNamespace(**THRESHOLDS))
                for b in base:
                    failed.extend(b['failed']); blocked.extend(b['blocked'])
                    if any(a['timeouts'] for a in b['agents'].values()): failed.append('baseline decide timeout')
                for record,load in load_pairs:
                    record['failed'].extend(x for x in load['failed'] if x not in record['failed'])
                    record['blocked'].extend(x for x in load['blocked'] if x not in record['blocked'])
            except (OSError, ValueError, TypeError, KeyError): blocked.append('baseline unavailable/malformed')
        result['timing_mode'] = 'relative + absolute' if baseline else 'absolute only (no baseline)'
        if manifest:
            from round_manifest import verify, manifest_path
            m = verify(manifest)
            result['manifest_sha256'] = hashlib.sha256(manifest_path(manifest).read_bytes()).hexdigest()
            if m['status'] != 'PASS': failed.extend(m['failed'])
            else:
                snapshot = m['manifest']
                if (snapshot['roster']['sha256'] != result['roster_sha256'] or
                    set(snapshot['regimes']) != set(regimes) or set(snapshot['seeds']) != set(seeds) or
                    snapshot['thresholds'] != THRESHOLDS): failed.append('manifest expectations mismatch')
                else:
                    result.update(commit=snapshot['commit'], zip_sha256=snapshot.get('zip_sha256'))
                    result['manifest_verified'] = True
    except (OSError, ValueError, TypeError, KeyError, subprocess.CalledProcessError):
        blocked.append('expected inputs/manifest missing or malformed')
    for r in result['runs']:
        r['status'] = verdict(r['failed'],r['blocked'])
        failed.extend(f"{r['regime']}/{r['seed']}: {x}" for x in r['failed'])
        blocked.extend(f"{r['regime']}/{r['seed']}: {x}" for x in r['blocked'])
    result['status'] = verdict(failed,blocked)
    return result


def add_args(p, roster=True):
    if roster: p.add_argument('--roster', type=Path)
    p.add_argument('--regimes', nargs='+')
    p.add_argument('--seeds', nargs='+')
    p.add_argument('--baseline', nargs='+')
    p.add_argument('--manifest', help='begin manifest label')


def from_args(a):
    return evaluate(a.round,a.roster,a.regimes,a.seeds,a.baseline,a.manifest)


def render(result):
    lines = ['G0 '+result['status'], '| regime | seed | blocks | loops | p99 ms | status |', '|---|---|---:|---:|---:|---|']
    for r in result['runs']:
        lines.append('| '+' | '.join(str(r.get(k,'?')) for k in ('regime','seed','blocks','loops','p99_ms','status'))+' |')
    lines += ['FAIL: '+x for x in result['failed']] + ['BLOCKED: '+x for x in result['blocked']]
    lines.append(result.get('timing_mode','timing unavailable'))
    return '\n'.join(lines)+'\n'


def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('round'); add_args(p)
    p.add_argument('--json',action='store_true'); a=p.parse_args(); result=from_args(a)
    print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False) if a.json else render(result),end='\n')
    return {'PASS':0,'FAIL':1,'BLOCKED':2}[result['status']]


if __name__=='__main__': raise SystemExit(main())
