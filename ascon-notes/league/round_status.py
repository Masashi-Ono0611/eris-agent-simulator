"""Read-only status; no backtest/anvil invocation and no live RPC."""
import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from league_harness import ROOT, index_path, number, read_rows, analyze

from league_timing import timing_maxima

HEADER = ['regime', 'seed', 'run_dir', 'exit_code']


def status(out, total=None, minimum=360, started=None):
    if not out.is_dir(): raise ValueError(f'out directory missing: {out}')
    stages = list(out.glob('.matrix-tmp-*'))
    if len(stages) > 1: raise ValueError('multiple matrix stages; round ownership is ambiguous')
    # Active stage takes precedence over an older index left by a reused label.
    rows = []; malformed = 0
    if stages:
        for p in sorted(stages[0].glob('*.row')):
            try:
                with p.open(newline='', encoding='utf-8') as f:
                    entries = list(csv.reader(f, delimiter='\t', strict=True))
                if len(entries) != 1 or len(entries[0]) != 4 or not entries[0][0] or not entries[0][1]:
                    malformed += 1
                else: rows.append(dict(zip(HEADER, entries[0])))
            except (OSError, ValueError, csv.Error): malformed += 1
    elif (out / 'index.tsv').is_file():
        with (out / 'index.tsv').open(newline='', encoding='utf-8') as f: rows = list(csv.DictReader(f, delimiter='\t'))
    if not rows and not malformed and not (stages and any(out.glob('*.log'))):
        raise ValueError('有効シナリオ 0: 空 index / 完了成果物なし')
    if total is None and not stages and (out / 'index.tsv').is_file(): total = len(rows) + malformed
    if total is not None and total < len(rows) + malformed: raise ValueError('total below completed count')
    artifacts = stages or list(out.glob('*.log')) or [out / 'index.tsv']
    observed_start = min((getattr(p.stat(), 'st_birthtime', p.stat().st_mtime) for p in artifacts if p.exists()), default=time.time())
    start = started if started is not None else observed_start
    end = time.time()
    if not stages and (out / 'index.tsv').exists(): end = (out / 'index.tsv').stat().st_mtime
    elapsed = max(0, end-start)
    records = read_rows(rows)
    run_dirs = {r['run_dir'] for r in records if r['run_dir'] is not None}
    # Current jobs have no .row yet. Read only this round's logs for their run IDs.
    for log in out.glob('*.log'):
        try:
            with log.open(encoding='utf-8', errors='replace') as stream:
                for line in stream:
                    match = re.search(r'"runId"\s*:\s*"([A-Za-z0-9_-]+)"', line)
                    if match:
                        run_dirs.add(ROOT / 'runs' / match.group(1)); break
        except OSError: pass
    timing = timing_maxima(run_dirs)
    loops = [dict(regime=r['regime'], seed=r['seed'],
                  loopIterations=r['loops'] if number(r['loops']) else None, reason=r['reason']) for r in records]
    execution_failed = sum(r.get('exit_code') != '0' or not r.get('run_dir') for r in rows)
    invalid = sum(r['reason'] is not None for r in records)
    failures = invalid + malformed
    analysis = analyze(records, minimum=minimum, boot=1, collect_behavior=False)
    known = [r['loopIterations'] for r in loops if r['loopIterations'] is not None]
    try:
        processes = subprocess.check_output(['ps','-axo','comm='], text=True, stderr=subprocess.DEVNULL)
        anvils = sum(Path(line.strip()).name == 'anvil' for line in processes.splitlines())
    except (OSError, subprocess.CalledProcessError): anvils = None
    try: load = list(os.getloadavg())
    except OSError: load = None
    done = len(rows) + malformed
    return dict(**timing, round=out.name, completed=done, total=total, failed=failures, execution_failed=execution_failed, invalid_runs=invalid, malformed_rows=malformed,
                scored_scenarios=analysis['rank_scenarios'], warnings=[w for w in analysis['warnings'] if '被覆不足' in w],
                error='有効に採点できた共通シナリオが 0' if not analysis['rank_scenarios'] else None, elapsed_seconds=round(elapsed),
                eta_seconds=round(elapsed*(total-done)/done) if total is not None and done else None,
                time_source='explicit start' if started is not None else 'artifact timestamp estimate',
                loops=loops, min_loop_iterations=min(known) if known else None,
                below_threshold=sum(v < minimum for v in known) if minimum > 0 else 0,
                missing_loops=len(loops)-len(known), threshold=minimum,
                anvil_count=anvils, free_gb=round(shutil.disk_usage(out).free/1024**3, 1), load_average=load)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('round'); p.add_argument('--total', type=int)
    p.add_argument('--regimes', help='space separated planned regimes (requires --seeds)')
    p.add_argument('--seeds', help='space separated planned seeds (requires --regimes)')
    p.add_argument('--started-at', type=float, help='Unix timestamp; otherwise artifact estimate')
    p.add_argument('--min-loop-iterations', type=int, default=360); p.add_argument('--json', action='store_true')
    a = p.parse_args()
    try:
        if bool(a.regimes) != bool(a.seeds): raise ValueError('provide both regimes and seeds')
        total = a.total
        if a.regimes:
            planned = len(set(a.regimes.split())) * len(set(a.seeds.split()))
            if total is not None and total != planned: raise ValueError('total disagrees with regimes/seeds')
            total = planned
        if total is not None and total < 1: raise ValueError('total must be positive')
        s = status(index_path(a.round).parent, total, a.min_loop_iterations, a.started_at)
    except (OSError, ValueError) as e: p.error(str(e))
    if a.json:
        print(json.dumps(s))
        if s['error']: raise SystemExit(1)
        return
    def show(v): return '取得不能' if v is None else str(v)
    print(f"Round {s['round']} | 完了 {s['completed']}/{show(s['total'])} | 失敗 {s['failed']} | 不正 run {s['invalid_runs']} | 壊れた行 {s['malformed_rows']}")
    print(f"経過 {s['elapsed_seconds']}s | ETA {show(s['eta_seconds'])}s ({s['time_source']})")
    print(f"完了 run loopIterations 最小 {show(s['min_loop_iterations'])} | <{s['threshold']}: {s['below_threshold']} | 欠測 {s['missing_loops']}")
    print(f"round_timing blocksCaughtUp 最大 {show(s['max_blocks_caught_up'])} | 環境 totalMs 最大 {show(s['max_environment_total_ms'])} ms | 欠測 {s['timing_missing']}")
    # Compact one-screen display: individual runs remain fully available via --json.
    values = [f"{r['regime']}/{r['seed']}={show(r['loopIterations'])}" for r in s['loops']]
    print('runs: ' + (', '.join(values[:8]) or 'なし') + (f" … 他 {len(values)-8} 件 (--json)" if len(values)>8 else ''))
    print(f"稼働 anvil (host 全体): {show(s['anvil_count'])} | 空き {s['free_gb']} GiB | load {show(s['load_average'])}")
    for warning in s['warnings']: print('警告: ' + warning)
    if s['error']:
        print('エラー: ' + s['error']); raise SystemExit(1)
    if s['total'] is None: print('総数は途中成果物から判定不能: --total または --regimes と --seeds を指定')


if __name__ == '__main__': main()
