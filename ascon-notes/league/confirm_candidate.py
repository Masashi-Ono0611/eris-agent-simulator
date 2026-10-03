"""Plan/run one isolated candidate using held-out seeds, then existing paired compare."""
import argparse
import csv
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from league_harness import ROOT, identifier, index_path, agent_path

REGIMES = 'calm cex-drift informed-flow whale lending-incident depeg crash vuln spike depeg-persist cdp-incident launch'


def reject_json_constant(_value):
    raise ValueError('nonfinite JSON constant')


def plan(a):
    identifier(a.label)
    seeds = a.seeds.split()
    if not seeds or any(not s.isdigit() for s in seeds) or len(set(map(int, seeds))) != len(seeds):
        raise ValueError('seeds must be distinct nonnegative integers')
    used = set()
    for value in a.selection_index:
        with index_path(value).open(newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f, delimiter='\t')
            if not reader.fieldnames or 'seed' not in reader.fieldnames: raise ValueError('selection index has no seed column')
            rows = list(reader)
            if not rows: raise ValueError('selection index is empty')
            for row in rows: used.add(int(row['seed']))
    if used.intersection(map(int, seeds)): raise ValueError('seed overlaps selection data')
    for path in getattr(a, 'selection_ledger', None) or [Path(__file__).with_name('ledger.jsonl')]:
        if not Path(path).exists():
            if getattr(a, 'selection_ledger', None): raise ValueError('selection ledger missing')
            continue
        from ledger import validate_chain
        for row in validate_chain(Path(path).read_text(encoding='utf-8')):
            previous = {int(s) for s in row.get('seeds', [])}
            previous.update(int(s['seed']) for s in row.get('scenarios', []))
            overlap = sorted(previous.intersection(map(int, seeds)))
            if overlap: print('警告: seed overlaps selection ledger: ' + ', '.join(map(str, overlap)), file=sys.stderr)
    if a.parallel < 1 or not 1 <= a.base_port <= 65535-a.parallel: raise ValueError('invalid parallel/base-port')
    for regime in a.regimes.split():
        identifier(regime)
        if not (ROOT / 'config/regimes' / f'{regime}.yaml').is_file(): raise ValueError(f'unknown regime: {regime}')
    if not a.regimes.split(): raise ValueError('regimes required')
    directory = Path(a.dir)
    agent_path(ROOT / 'example/agents', str(directory))
    if not (ROOT / 'example/agents' / directory / 'agent.ts').is_file(): raise ValueError('candidate agent.ts missing')
    env = {'ERIS_AGENT_FROZEN': '1'}
    for item in a.env:
        key, sep, value = item.partition('=')
        if not sep or not re.fullmatch(r'[A-Z_][A-Z0-9_]*', key): raise ValueError('--env requires KEY=VALUE')
        if key != 'ERIS_AGENT_FROZEN' and not re.fullmatch(r'ASCON_[A-Z0-9_]+_PARAMS', key):
            raise ValueError('env key not allowed: use ERIS_AGENT_FROZEN or ASCON_*_PARAMS')
        if len(value.encode('utf-8')) > 8192: raise ValueError('env JSON value exceeds 8192 bytes')
        try:
            json.loads(value, parse_constant=reject_json_constant)
        except (ValueError, RecursionError): raise ValueError('env value must be valid JSON') from None
        env[key] = value
    agents = [dict(id='noop',wallet='AUTO',baseline=True),
              dict(id='multi-arb',wallet='AUTO',env={'ERIS_AGENT_FROZEN':'1'}),
              dict(id='crowd',dir='ascon-delta',wallet='AUTO',env={'ERIS_AGENT_FROZEN':'1'}),
              dict(id='clean-arb',wallet='AUTO'), dict(id='cand',dir=a.dir,wallet='AUTO',env=env)]
    for agent in agents:
        if not (ROOT / 'example/agents' / agent.get('dir',agent['id']) / 'agent.ts').is_file():
            raise ValueError(f"agent directory missing: {agent['id']}")
    roster = ROOT / 'ascon-notes/league' / f'roster-confirm-{a.label}.yaml'
    out = ROOT / 'ascon-notes/eval/out' / a.label
    if out.exists() or roster.exists(): raise ValueError('label/roster already exists; use a new label')
    run = ['bash',str(ROOT/'ascon-notes/eval/run-matrix.sh'),'--label',a.label,'--roster',str(roster),
           '--regimes',a.regimes,'--seeds',' '.join(seeds),'--parallel',str(a.parallel),'--base-port',str(a.base_port)]
    compare = ['python3',str(ROOT/'ascon-notes/eval/compare.py'),str(out/'index.tsv'),'--ref','multi-arb',
               '--min-loop-iterations',str(a.min_loop_iterations),'-o',str(out/'compare.md')]
    return roster, agents, run, compare


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dir', required=True); p.add_argument('--env', action='append', default=[])
    p.add_argument('--label', required=True); p.add_argument('--seeds', required=True)
    p.add_argument('--selection-index', action='append', required=True, help='repeat for ALL selection rounds; reject previously used seeds')
    p.add_argument('--selection-ledger', type=Path, action='append', help='warn on overlap with recorded selection seeds (default: league/ledger.jsonl)')
    p.add_argument('--seed-record', type=Path, help='optional ledger-compatible seed record JSON')
    p.add_argument('--parallel', type=int, default=1); p.add_argument('--base-port', type=int, default=8647)
    p.add_argument('--regimes', default=REGIMES); p.add_argument('--min-loop-iterations', type=int, default=360)
    p.add_argument('--dry-run', action='store_true'); a = p.parse_args()
    try:
        roster, agents, run, compare = plan(a)
        print('DRY RUN' if a.dry_run else 'CONFIRM')
        print('roster: cand + noop / multi-arb / crowd / clean-arb; candidate dir=' + a.dir)
        print('candidate env keys: ' + ', '.join(sorted(agents[-1]['env'])))
        print(shlex.join(run)); print(shlex.join(compare))
        record = dict(round=a.label, seeds=[str(int(s)) for s in a.seeds.split()],
                      scenarios=[dict(regime=r, seed=str(int(s))) for r in a.regimes.split() for s in a.seeds.split()])
        print('seed_record: ' + json.dumps(record, ensure_ascii=True, sort_keys=True))
        if a.dry_run: return
        if a.seed_record:
            with a.seed_record.open('x', encoding='utf-8') as f: json.dump(record, f, ensure_ascii=True); f.write('\n')
        # JSON is valid YAML, parsed by the runner's existing yaml dependency.
        created = False
        try:
            with roster.open('x', encoding='utf-8') as f:
                created = True
                json.dump({'agents':agents}, f, indent=2); f.write('\n')
            rc = subprocess.call(run, cwd=ROOT)
            if rc: raise SystemExit(rc)
            raise SystemExit(subprocess.call(compare, cwd=ROOT))
        finally:
            if created: roster.unlink()
    except (OSError, ValueError) as e: p.error(str(e))


if __name__ == '__main__': main()
