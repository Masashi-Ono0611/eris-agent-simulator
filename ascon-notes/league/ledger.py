#!/usr/bin/env python3
"""Append a round snapshot; regenerate Markdown from the immutable JSONL ledger."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import g0
import subprocess
from pathlib import Path
from league_harness import ROOT, analysis_args, from_args, index_path, roster_agents, tree_hash, fmt, agent_path, ci_text, stability_text


def markdown(rows):
    out = ['# ASCON round ledger', '', 'ハッシュは記録時点のファイル内容。実走開始時点の同一性は別途確認。', '',
           '| ラウンド | UTC | commit | roster sha256 | レジーム / seed | 並列 | 除外 | 上位N平均 T | 順位の安定性 | 備考 |',
           '|---|---|---|---|---|---:|---:|---:|---:|---|']
    def cell(x): return str(x).replace('|', '\\|').replace('\n', '<br>')
    for r in rows:
        out.append('| ' + ' | '.join(cell(x) for x in [r['round'], r['datetime'], r['git_commit'], r['roster']['sha256'],
                   ','.join(r['regimes'])+' / '+','.join(r['seeds']), r['parallel'], r['excluded_scenarios'],
                   fmt(r['top_mean_t']), stability_text(r), r['notes'] + ' / G0 ' + r.get('g0',{}).get('status','未記録') + (' / allow-unverified' if r.get('allow_unverified') else '') + ' / manifest ' + str(r.get('manifest_sha256','未記録'))]) + ' |')
    out += ['', '## Agent versions', '']
    for r in rows:
        out += [f"{cell(r['round'])}: " + '; '.join(f"{cell(a)} `{v['sha256']}`" for a,v in r['agents'].items()), '']
    out += ['選抜バイアス: 順位の安定性は勝者の呪いの補正ではない。未使用 seed で要確認。', '']
    for r in rows:
        out += [f"{cell(r['round'])}: top_n={r['analysis']['top_n']}, top_k={r['analysis']['top_k']}, bootstrap seed={r['analysis']['seed']}, 共通シナリオ={r['analysis']['rank_scenarios']}"]
        out += ['警告: ' + cell(w) for w in r['warnings']]
        out += [f'{cell(aid)}: {ci_text(x)}' for aid, x in r['players'].items()]
    return '\n'.join(out) + '\n'


def row_hash(row):
    payload = {key: value for key, value in row.items() if key != 'row_hash'}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=True, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def validate_chain(text):
    if text and not text.endswith('\n'): raise ValueError('ledger has incomplete last line; refusing append')
    rows = []; previous = None
    for line in text.splitlines():
        row = json.loads(line)
        if (not isinstance(row, dict) or 'prev_hash' not in row or row['prev_hash'] != previous
                or row.get('row_hash') != row_hash(row)):
            raise ValueError('ledger hash chain mismatch; refusing append')
        previous = row['row_hash']; rows.append(row)
    return rows


def append(ledger, entry):
    ledger = Path(ledger)
    md = ledger.with_suffix('.md')
    # Check before even opening/creating the ledger, including symlink aliases.
    if ledger.resolve() == md.resolve() or (ledger.exists() and md.exists() and ledger.samefile(md)):
        raise ValueError('ledger and Markdown projection must be different paths')
    ledger.parent.mkdir(parents=True, exist_ok=True)
    with ledger.open('a+', encoding='utf-8') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0); rows = validate_chain(f.read())
        if any(r['round'] == entry['round'] for r in rows): raise ValueError('round already recorded; use a new round name')
        row = dict(entry, prev_hash=rows[-1]['row_hash'] if rows else None)
        row['row_hash'] = row_hash(row)
        encoded = json.dumps(row, ensure_ascii=True, sort_keys=True, allow_nan=False) + '\n'
        # Render and stage before JSONL append. A later projection failure is nonzero;
        # the durable JSONL remains authoritative and is never replaced.
        projection = markdown(rows + [row])
        temp = md.with_name(md.name + f'.tmp-{os.getpid()}')
        staged = False
        try:
            with temp.open('x', encoding='utf-8') as target:
                staged = True
                target.write(projection); target.flush(); os.fsync(target.fileno())
            f.write(encoded); f.flush(); os.fsync(f.fileno())
            temp.replace(md)
        finally:
            if staged and temp.exists(): temp.unlink()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('round'); p.add_argument('--name')
    p.add_argument('--roster', type=Path, required=True)
    p.add_argument('--agent-root', type=Path, default=ROOT / 'example/agents')
    p.add_argument('--parallel', type=int, required=True)
    p.add_argument('--notes', default='')
    p.add_argument('--ledger', type=Path, default=Path(__file__).with_name('ledger.jsonl'))
    g0.add_args(p, roster=False)
    p.add_argument('--allow-unverified', action='store_true')
    analysis_args(p); a = p.parse_args()
    if a.parallel < 1: p.error('parallel must be positive')
    try:
        gate = g0.from_args(a)
        if gate['status'] != 'PASS' and not a.allow_unverified:
            raise ValueError('未検証（G0 '+gate['status']+'）: refusing append')
        data = from_args(a, expected_ids=gate.get('expected',{}).get('agents'))
        if not data['ranking']: raise ValueError('no common scored scenarios for competitors')
        versions = {}
        for agent in roster_agents(a.roster):
            if agent['command']: raise ValueError('command agent cannot be directory-hashed')
            path = agent_path(a.agent_root, agent['dir'])
            versions[agent['id']] = dict(directory=str(path), **tree_hash(path))
        if set(data['players']) - set(versions): raise ValueError('scored player missing from roster')
        entry = dict(g0=gate, allow_unverified=a.allow_unverified,
                     manifest_sha256=gate.get('manifest_sha256') or '未記録', round=a.name or index_path(a.round).parent.name,
                     datetime=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     git_commit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip(),
                     roster=dict(path=str(a.roster.resolve()), sha256=hashlib.sha256(a.roster.read_bytes()).hexdigest()),
                     agents=versions, regimes=sorted({r['regime'] for r in data['scenarios']}),
                     seeds=sorted({r['seed'] for r in data['scenarios']}), scenarios=data['scenarios'], parallel=a.parallel,
                     excluded_scenarios=data['excluded_scenarios'], excluded=data['excluded'],
                     top_mean_t=data['top_mean_t'], top_stability=data['top_stability'],
                     top_stability_uninformative=data['top_stability_uninformative'],
                     warnings=data['warnings'], players=data['players'],
                     top=[dict(id=aid, mean_t=data['players'][aid]['rank_mean_t'], stability=data['players'][aid]['stability']) for aid in data['ranking'][:a.top_n]],
                     analysis=dict(ref=a.ref, boot=a.boot, seed=a.seed, top_k=a.top_k, top_n=a.top_n, minimum=a.min_loop_iterations,
                                   rank_scenarios=data['rank_scenarios']), notes=a.notes)
        append(a.ledger, entry)
    except (OSError, ValueError, subprocess.CalledProcessError) as e: p.error(str(e))
    print(f"appended {entry['round']}: {a.ledger}; {a.ledger.with_suffix('.md')}")


if __name__ == '__main__': main()
