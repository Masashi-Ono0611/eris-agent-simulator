#!/usr/bin/env python3
"""Offline conservative gate. Baseline directories must be measured at parallel=3.

Counts are compared per run against the baseline mean within each regime (index.tsv).
Catch-up significance is an explicit allowed count increase, default zero; this is
not a statistical significance test. Decision counts are observed distinct blocks,
not exact decide() invocation counts (the runtime does not emit those).
"""
import argparse
import csv
import json
import math
import re
import statistics
from pathlib import Path
from league_harness import ROOT, number
from league_timing import events
from g0_contract import summary_errors


def integer(v):
    return number(v) and v >= 0 and int(v) == v


def sources(values):
    result = []
    for value in values:
        p = Path(value)
        if not p.exists(): p = ROOT / 'ascon-notes/eval/out' / value
        if (p / 'summary.json').exists() or (p / 'events.jsonl').exists():
            result.append((p, 'direct', '0')); continue
        index = p if p.name == 'index.tsv' else p / 'index.tsv'
        if list(index.parent.glob('.matrix-tmp-*')):
            raise ValueError('active/incomplete matrix: ' + str(index.parent))
        with index.open(encoding='utf-8', newline='') as f:
            rows = list(csv.DictReader(f, delimiter='\t'))
        if not rows: raise ValueError('empty index: ' + str(index))
        for row in rows:
            if not row.get('run_dir') or not row.get('regime') or not row.get('seed') or None in row:
                raise ValueError('missing/malformed index row')
            path = Path(row['run_dir'])
            if not path.is_absolute(): path = ROOT / path
            result.append((path, row['regime'], row.get('exit_code')))
    if not result: raise ValueError('no runs')
    return result


def extract(source, args):
    path, regime, rc = source
    r = dict(path=path.resolve(), regime=regime, id=None, blocked=[], failed=[], agents={},
             loops=None, blocks=None, catchups=None, p99=None, coverage=None)
    def block(message): r['blocked'].append(message)
    def fail(message): r['failed'].append(message)
    if rc != '0': fail('exit_code != 0')
    try:
        s = json.loads((path / 'summary.json').read_text())
        if not isinstance(s, dict): raise ValueError()
    except (OSError, ValueError):
        block('summary.json'); return r
    r['failed'].extend(summary_errors(s))
    r['id'] = s.get('runId')
    if not isinstance(r['id'], str) or not r['id']:
        block('runId'); r['id'] = None
    for key, out, expected in [('blocksProcessed', 'blocks', args.blocks),
                               ('loopIterations', 'loops', args.expected_loops)]:
        v = s.get(key)
        if not integer(v): block(key)
        else:
            r[out] = v
            if v != expected: fail(f'{key}={v} expected {expected}')
    start, end, blocktime = s.get('runStartBlock'), s.get('finalBlock'), s.get('blockTimeSec')
    extent = integer(start) and integer(end) and end > start
    if not extent: block('runStartBlock/finalBlock')
    elif end - start != args.blocks: fail('epoch extent')
    if not number(blocktime) or blocktime <= 0: block('blockTimeSec')
    elif abs(blocktime - args.block_time_sec) > 1e-9: fail('blockTimeSec mismatch')
    agents = s.get('agents')
    if not isinstance(agents, list) or not agents:
        block('summary agents'); agents = []
    ids = [a.get('id') for a in agents if isinstance(a, dict)]
    if len(ids) != len(agents) or any(not isinstance(a, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', a) for a in ids):
        block('agent IDs'); return r
    if len(set(ids)) != len(ids): fail('duplicate agent ID')
    if any(a.get('processExitedEarly') for a in agents): fail('agent exited early')
    try: logs = list(events(path / 'events.jsonl'))
    except (OSError, ValueError): block('events.jsonl'); return r
    def one(kind):
        found = [e for e in logs if e.get('type') == kind]
        if len(found) != 1: block(kind); return {}
        return found[0]
    started, completed, ready, registered = (one(k) for k in
        ('run_started_realtime', 'run_completed', 'agents_ready', 'agents_registered'))
    for record in (started, completed):
        if record and record.get('runId') != r['id']: fail('runId mismatch')
    if started.get('runBlocks') != args.blocks: block('declared runBlocks missing/mismatch')
    try:
        reg_ids = [a['id'] for a in registered['agents']]
        ready_ids = [a['id'] for a in ready['ready']]
        if (set(reg_ids) != set(ids) or len(reg_ids) != len(ids) or set(ready_ids) != set(ids)
                or len(ready_ids) != len(ids) or ready['launched'] != len(ids)
                or ready['timedOut'] is not False or ready['late'] or ready['exited']):
            fail('not all agents ready')
    except (KeyError, TypeError): block('agent startup fields')
    timings = [e for e in logs if e.get('type') == 'round_timing']
    if not timings: block('round_timing')
    elif len(timings) != r['loops']: block('round_timing count != loopIterations')
    valid = all(integer(e.get('blocksCaughtUp')) and integer(e.get('blockNumber'))
                and number(e.get('totalMs')) and e['totalMs'] >= 0 for e in timings)
    if timings and valid:
        r['catchups'] = sum(e['blocksCaughtUp'] > 1 for e in timings)
        times = sorted(e['totalMs'] for e in timings)
        r['p99'] = times[math.ceil(len(times) * .99) - 1]
        if r['p99'] >= args.block_time_sec * 1000 * args.max_p99_fraction: fail('environment p99')
        if extent:
            # Count every in-epoch block once; zero-length startup passes are allowed.
            cursor = start + 1
            for e in timings:
                low, high = max(start + 1, e['blockNumber'] - e['blocksCaughtUp'] + 1), min(end, e['blockNumber'])
                if low <= high:
                    if low != cursor: block('timing block gap/overlap')
                    cursor = high + 1
            if cursor != end + 1: block('timing block coverage')
    elif timings: block('round_timing fields')
    for aid in ids:
        try:
            log = list(events(path / 'agents' / (aid + '.jsonl')))
            if not log or any(e.get('agentId') != aid for e in log): raise ValueError()
            if any(e.get('event') in ('log_cap_reached', 'log_line_truncated') for e in log): raise ValueError()
            if sum(e.get('kind') == 'mempool' and e.get('event') == 'runtime_start' for e in log) != 1:
                raise ValueError()
            decisions, timeouts, failures = set(), 0, 0
            for e in log:
                timeout = str(e.get('reason', '')).startswith('decide timeout:')
                failure = e.get('kind') == 'mempool' and e.get('event') == 'submit_failed'
                mem = e.get('kind') == 'mempool' and e.get('event') in ('submitted', 'submit_failed')
                decision = 'action' in e or str(e.get('reason', '')).startswith(('decide error:', 'decide timeout:'))
                if not (mem or decision): continue
                bn = e.get('blockSeen') if mem else e.get('round')
                if not integer(bn): raise ValueError()
                if extent and start < bn <= end:
                    decisions.add(bn); timeouts += timeout; failures += failure
            if not extent or not decisions: raise ValueError()
            r['agents'][aid] = dict(decisions=len(decisions), timeouts=timeouts, submit_failed=failures,
                                    coverage=100 * len(decisions) / args.blocks)
        except (OSError, ValueError): block('agent telemetry ' + aid)
    return r


def compare(base, candidates, a):
    seen_ids, seen_paths = set(), set()
    for r in base + candidates:
        if r['id'] in seen_ids or r['path'] in seen_paths: r['failed'].append('duplicate run ID/path')
        if r['id']: seen_ids.add(r['id'])
        seen_paths.add(r['path'])
    for r in candidates:
        refs = [b for b in base if b['regime'] == r['regime']]
        if not refs:
            r['blocked'].append('baseline regime'); continue
        if any(set(b['agents']) != set(r['agents']) for b in refs):
            r['blocked'].append('baseline agent roster/telemetry mismatch'); continue
        if r['catchups'] is not None and all(b['catchups'] is not None for b in refs):
            if r['catchups'] > statistics.mean(b['catchups'] for b in refs) + a.max_catchup_increase:
                r['failed'].append('catch-up increase')
        for aid, m in r['agents'].items():
            for metric, tolerance, drop in [('decisions', a.max_decision_drop, True),
                    ('coverage', a.max_coverage_drop_pp, True), ('timeouts', a.max_timeout_increase, False),
                    ('submit_failed', a.max_submit_failure_increase, False)]:
                if tolerance is None: continue  # informational only (printed below)
                baseline = statistics.mean(b['agents'][aid][metric] for b in refs)
                delta = baseline - m[metric] if drop else m[metric] - baseline
                if delta > tolerance + 1e-9: r['failed'].append(aid + ' ' + metric)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline', nargs='+', required=True, help='parallel=3 output dirs / run dirs')
    p.add_argument('--candidate', nargs='+', required=True)
    p.add_argument('--blocks', type=int, default=360)
    p.add_argument('--expected-loops', type=int, default=362, help='exact count. Healthy runs observed in this repo are always 360 blocks + 2 pre-start passes = 362 (round league-r1, load-probe, iso suites); any other count fails')
    p.add_argument('--block-time-sec', type=float, default=2)
    p.add_argument('--max-p99-fraction', type=float, default=.5)
    p.add_argument('--max-catchup-increase', type=float, default=0)
    p.add_argument('--max-timeout-increase', type=float, default=0)
    p.add_argument('--max-submit-failure-increase', type=float, default=None, help='off by default: submit_failed varies 0-23 per healthy run (tx races), so a zero tolerance fails healthy runs; it is shown as information')
    p.add_argument('--max-decision-drop', type=float, default=None, help='off by default: a 1-block difference (359 vs 360) occurs in healthy runs; --max-coverage-drop-pp covers missing decisions')
    p.add_argument('--max-coverage-drop-pp', type=float, default=1)
    a = p.parse_args()
    if a.blocks < 1 or a.expected_loops < a.blocks or any(not math.isfinite(v) or v < 0 for v in
            (a.block_time_sec, a.max_p99_fraction, a.max_catchup_increase, a.max_timeout_increase,
             a.max_coverage_drop_pp, *(v for v in (a.max_submit_failure_increase, a.max_decision_drop) if v is not None))) or a.block_time_sec == 0 or a.max_p99_fraction == 0:
        p.error('invalid thresholds')
    try:
        base = [extract(s, a) for s in sources(a.baseline)]
        candidates = [extract(s, a) for s in sources(a.candidate)]
    except (OSError, ValueError, TypeError) as e:
        print('取得不能: input artifacts (' + type(e).__name__ + ')')
        print('GATE BLOCKED'); return 2
    compare(base, candidates, a)
    def show(v): return '取得不能' if v is None else str(round(v, 3)) if isinstance(v, float) else str(v)
    print('group\trun\tblocks\tloops\tcatch-up>1\tenv p99 ms\tstatus')
    for group, records in [('baseline', base), ('candidate', candidates)]:
        for r in records:
            state = 'BLOCKED' if r['blocked'] else 'FAIL' if r['failed'] else 'PASS'
            print('\t'.join(map(show, [group, r['id'], r['blocks'], r['loops'], r['catchups'], r['p99'], state])))
            for aid, m in sorted(r['agents'].items()):
                print(f"  {aid}\tobserved decision blocks={m['decisions']}\ttimeout={m['timeouts']}\tsubmit_failed={m['submit_failed']}\tcoverage={m['coverage']:.3f}%")
            for reason in r['blocked']: print('  取得不能: ' + reason)
            for reason in r['failed']: print('  FAIL: ' + reason)
    print('判断回数はログで観測した distinct blocks（decide 呼出総数・採掘遅延は取得不能）。')
    print('基準は --baseline の3並列実測を利用。catch-up はrun当たり基準平均との差（統計的有意差検定なし）。')
    code = 2 if any(r['blocked'] for r in base + candidates) else 1 if any(r['failed'] for r in base + candidates) else 0
    print('負荷のみ: 採点完全性・選抜可否は G0 で確認する。')
    print('GATE ' + {0: 'PASS', 1: 'FAIL', 2: 'BLOCKED'}[code])
    return code


if __name__ == '__main__': raise SystemExit(main())
