#!/usr/bin/env python3
"""Reproducible, stdlib-only mixed-field diagnostics; never official scoring."""
import argparse
import csv
import json
import math
from pathlib import Path
import statistics
import sys

LABEL = 'SIMPLIFIED T (not the official weighted T)'
COLUMNS = ['chunk', 'regime', 'seed', 'run_dir', 'exit_code']


def load_worlds(root, index):
    root = Path(root).resolve()
    index = Path(index)
    if not index.is_absolute():
        index = root / index
    worlds = []
    seen_dirs, seen_worlds = set(), set()
    roster = None
    with index.open(encoding='utf-8', newline='') as handle:
        reader = csv.DictReader(handle, delimiter='\t')
        if reader.fieldnames != COLUMNS:
            raise ValueError('index header must be: ' + '\t'.join(COLUMNS))
        for line, row in enumerate(reader, 2):
            try:
                if None in row or any(not row.get(key) for key in COLUMNS):
                    raise ValueError('missing or extra TSV fields')
                directory = Path(row['run_dir'])
                resolved = (root / directory).resolve()
                if directory.is_absolute() or not resolved.is_relative_to(root):
                    raise ValueError('run_dir must be relative to and inside repo root')
                identity = (row['regime'], row['seed'])
                if resolved in seen_dirs or identity in seen_worlds:
                    raise ValueError('duplicate run_dir or regime/seed world')
                seen_dirs.add(resolved)
                seen_worlds.add(identity)
                exit_code = int(row['exit_code'])
                summary = json.loads((resolved / 'summary.json').read_text(encoding='utf-8'))
                pnl = {}
                for agent in summary['agents']:
                    agent_id, value = agent['id'], agent['pnlUsdc']
                    if not isinstance(agent_id, str) or not agent_id or agent_id in pnl:
                        raise ValueError('missing or duplicate agent id')
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                        raise ValueError(f'non-finite/non-numeric pnlUsdc for {agent_id}')
                    pnl[agent_id] = value
                if 'noop' not in pnl:
                    raise ValueError('missing noop agent')
                if roster is not None and set(pnl) != roster:
                    raise ValueError('agent roster differs across worlds')
                roster = set(pnl)
                loops, violations = summary['loopIterations'], summary['violations']
                if type(loops) is not int or not isinstance(violations, list):
                    raise ValueError('loopIterations must be an integer and violations a list')
                mean = statistics.mean(pnl.values())
                sd = statistics.pstdev(pnl.values())
                scores = {agent: 50 + 10 * (p - mean) / sd if sd else 50.0
                          for agent, p in pnl.items()}
                worlds.append(dict(row=row, pnl=pnl, scores=scores, loops=loops,
                                   violations=violations, exit_code=exit_code))
            except (OSError, ValueError, KeyError, TypeError) as error:
                raise ValueError(f'{index}:{line} ({row.get("run_dir")}): {error}') from error
    if not worlds:
        raise ValueError('index contains no worlds')
    return worlds


def table(worlds):
    """Each world has one vote; all summary agents, including noop, set its T."""
    if not worlds:
        return []
    rows = []
    for agent in worlds[0]['pnl']:
        differences = [w['pnl'][agent] - w['pnl']['noop'] for w in worlds]
        rows.append(dict(agent=agent, meanT=statistics.mean(w['scores'][agent] for w in worlds),
                         excess=statistics.mean(differences), below=sum(p < 0 for p in differences),
                         n=len(worlds)))
    return sorted(rows, key=lambda row: (-row['meanT'], row['agent']))


def paired(worlds, a, b):
    if not worlds:
        return dict(n=0, mean=None, se=None, interval=None, wins=0, regimes={})
    if a not in worlds[0]['pnl'] or b not in worlds[0]['pnl']:
        raise ValueError(f'paired agents must both exist: {a}, {b}')
    differences = [w['scores'][a] - w['scores'][b] for w in worlds]
    mean = statistics.mean(differences)
    # Sample SD for uncertainty across worlds; population SD is only for within-world T.
    se = statistics.stdev(differences) / math.sqrt(len(differences)) if len(differences) > 1 else None
    regimes = {}
    for world, difference in zip(worlds, differences):
        regimes.setdefault(world['row']['regime'], []).append(difference)
    return dict(n=len(differences), mean=mean, se=se,
                interval=(mean - 2 * se, mean + 2 * se) if se is not None else None,
                wins=sum(d > 0 for d in differences),
                regimes={regime: statistics.mean(values) for regime, values in sorted(regimes.items())})


def report(worlds, pair=None):
    # Validate pair before printing any partial report.
    if pair:
        paired(worlds, *pair)
    lines = [LABEL, 'Equal weight per world; flagged worlds remain in ALL.', 'FLAGGED WORLDS']
    flagged = 0
    for world in worlds:
        if world['loops'] != 362 or world['exit_code'] != 0 or world['violations']:
            flagged += 1
            row = world['row']
            lines.append(f'WARN world chunk={row["chunk"]} regime={row["regime"]} seed={row["seed"]} '
                         f'run_dir={row["run_dir"]} loopIterations={world["loops"]} '
                         f'exit_code={world["exit_code"]} violations={json.dumps(world["violations"], ensure_ascii=True)}')
    if not flagged:
        lines.append('none')
    for label, selected in [('ALL', worlds), ('loopIterations==362 ONLY', [w for w in worlds if w['loops'] == 362])]:
        lines.extend(['', f'{label} worlds={len(selected)}'])
        if label != 'ALL':
            lines.append('note: filters on loopIterations only; worlds with exit_code!=0 or violations stay in this table and are listed under FLAGGED WORLDS')
        lines.append('agent\tmeanT\tmean(P-noop)\tP<noop')
        for row in table(selected):
            lines.append(f'{row["agent"]}\t{row["meanT"]:.6f}\t{row["excess"]:.6f}\t{row["below"]}/{row["n"]}')
        if not selected:
            lines.append('(no worlds)')
        if pair:
            stats = paired(selected, *pair)
            def fmt(value):
                return 'NA' if value is None else f'{value:.6f}'
            interval = stats['interval']
            bounds = 'NA' if interval is None else f'[{fmt(interval[0])}, {fmt(interval[1])}]'
            lines.append(f'PAIRED {pair[0]} - {pair[1]} n={stats["n"]} meanTdiff={fmt(stats["mean"])} '
                         f'SE={fmt(stats["se"])} approx95%={bounds} wins/n={stats["wins"]}/{stats["n"]}')
            for regime, difference in stats['regimes'].items():
                lines.append(f'PAIRED regime={regime} meanTdiff={difference:.6f}')
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=LABEL)
    parser.add_argument('repo_root', type=Path)
    parser.add_argument('index_tsv', type=Path, help='absolute or relative to repo_root')
    parser.add_argument('--paired', nargs=2, metavar=('A', 'B'))
    args = parser.parse_args()
    try:
        output = report(load_worlds(args.repo_root, args.index_tsv), args.paired)
    except (OSError, ValueError) as error:
        print(f'STOP: {error}', file=sys.stderr)
        return 2
    print(output, end='')
    return 0


if __name__ == '__main__':
    sys.exit(main())
