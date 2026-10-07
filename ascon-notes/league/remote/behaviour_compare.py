#!/usr/bin/env python3
"""Read-only, stdlib-only seat diagnostics. JSON output; no official/gate scoring.

All indexed worlds are retained. Count metrics aggregate by sum, rates and timing
by equal-world mean; fee distributions additionally pool individual submissions.
Missing measurements stay null. No runtime/strategy source is consulted.
"""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import statistics as st
import sys

EXPERIMENTS = {'e1': 'ascon-zeta-r3', 'e3': 'ascon-zeta-r3',
               'e4': 'ascon-zeta-r3', 'e2': 'ascon-zeta-r'}
COLUMNS = ['chunk', 'regime', 'seed', 'run_dir', 'exit_code']
PARAM_NAMES = ('ASCON_DELTA_PARAMS', 'ASCON_ZETA_PARAMS', 'bidMode',
               'bidProfitShareBps', 'gasPerSwap')


def distribution(values):
    values = sorted(values)
    if not values:
        return dict(n=0, mean=None, median=None, min=None, q1=None, q3=None,
                    max=None, sd=None, se=None)
    def quantile(p):
        pos = (len(values) - 1) * p
        lo = math.floor(pos)
        hi = math.ceil(pos)
        return values[lo] + (values[hi] - values[lo]) * (pos - lo)
    sd = st.stdev(values) if len(values) > 1 else None
    return dict(n=len(values), mean=st.mean(values), median=st.median(values),
                min=values[0], q1=quantile(.25), q3=quantile(.75), max=values[-1],
                sd=sd, se=sd / math.sqrt(len(values)) if sd is not None else None)


def timestamp(ts):
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))


def ratio(a, b):
    return a / b if b else None


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def source(path):
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def extract_seat(path, agent, summary, default_fee):
    records = []
    with path.open(encoding='utf-8') as handle:
        for line, text in enumerate(handle, 1):
            if not text.strip():
                continue
            row = json.loads(text)
            if row.get('agentId') != agent['id']:
                raise ValueError(f'{path}:{line}: agentId mismatch')
            records.append((line, row))
    starts = [(line, r) for line, r in records if r.get('event') == 'runtime_start']
    if len(starts) != 1:
        raise ValueError(f'{path}: expected exactly one runtime_start')
    submitted = [(line, r) for line, r in records if r.get('event') == 'submitted']
    for _, r in submitted:
        for field in ('priorityFeeWei', 'actionType', 'blockSeen', 'hash', 'ts'):
            if field not in r:
                raise ValueError(f'{path}: submitted missing {field}')
    hashes = [r['hash'] for _, r in submitted]
    if len(hashes) != len(set(hashes)):
        raise ValueError(f'{path}: duplicate submitted hash')
    metrics = {'submitted': len(submitted)}
    counts = Counter()
    event_keys = defaultdict(set)
    bundles = defaultdict(list)
    fees = []
    noop_rounds = set()
    submit_blocks = set()
    for _, r in records:
        ev = r.get('event', '<decision>')
        event_keys[ev].update(r)
        counts['event/' + ev] += 1
        if ev == 'submitted':
            action, protocol = r['actionType'], r.get('protocol') or '<missing>'
            counts['action/' + action] += 1
            counts['protocol/' + protocol] += 1
            counts['action_protocol/' + action + '/' + protocol] += 1
            fee = int(r['priorityFeeWei'])
            fees.append(fee)
            counts['fee_default_count'] += fee == default_fee
            counts['fee_bumped_count'] += fee > default_fee
            counts['fee_below_count'] += fee < default_fee
            counts['fee_5gwei_count'] += fee == 5_000_000_000
            block = int(r['blockSeen'])
            submit_blocks.add(block)
            counts['pre_start_submitted'] += block < summary['runStartBlock']
            counts['at_or_after_final_submitted'] += block >= summary['finalBlock']
            if r.get('bundleId') is not None:
                bundles[r['bundleId']].append(r)
                counts['bundle_tagged_tx'] += 1
            else:
                counts['unbundled_tx'] += 1
            counts['liquity_tx'] += protocol == 'liquity'
            counts['stability_pool_tx'] += action in ('liquityProvideToSP', 'liquityWithdrawFromSP')
        if ev == '<decision>':
            if (r.get('action') or {}).get('type') == 'noop':
                counts['noop_records'] += 1
                noop_rounds.add(int(r['round']))
                reason = r.get('reason', '')
                category = {'no funded venue gap': 'no_gap',
                            'recovery quote/cost not competitive': 'recovery_cost',
                            'unfunded buy': 'unfunded_buy'}.get(reason, 'other')
                counts['noop_reason/' + category] += 1
            # Log prose is evidence of a launch decision, not a confirmed trade.
            reason = r.get('reason', '')
            signals = r.get('signals', {})
            if reason.startswith('watching ') and 'launchPools' in signals:
                counts['launch_watch_records'] += 1
            if reason.startswith('buying ') and 'amountInUsdcUnits' in signals:
                counts['launch_buy_intents'] += 1
            if reason.startswith('selling ') and 'quotedUsdcUnits' in signals:
                counts['launch_sell_intents'] += 1
    for key in ('fee_default_count', 'fee_bumped_count', 'fee_below_count',
                'fee_5gwei_count', 'pre_start_submitted', 'at_or_after_final_submitted',
                'bundle_tagged_tx', 'unbundled_tx', 'liquity_tx', 'stability_pool_tx',
                'noop_records', 'launch_watch_records', 'launch_buy_intents', 'launch_sell_intents'):
        counts.setdefault(key, 0)
    counts['bundle_groups'] = len(bundles)
    counts['two_leg_submitted_groups'] = sum(
        len(rs) == 2 and sorted(r.get('bundleIndex', -1) for r in rs) == [0, 1]
        for rs in bundles.values())
    counts['one_record_bundle_groups'] = sum(len(rs) == 1 for rs in bundles.values())
    counts['other_bundle_groups'] = (len(bundles) - counts['two_leg_submitted_groups']
                                     - counts['one_record_bundle_groups'])
    counts['noop_rounds'] = len(noop_rounds)
    counts['submitted_blocks'] = len(submit_blocks)
    start, end = summary['runStartBlock'], summary['finalBlock']
    counts['window_blocks_without_submission'] = sum(b not in submit_blocks for b in range(start, end + 1))
    counts['noop_and_submission_rounds'] = len(noop_rounds & submit_blocks)
    metrics.update(counts)
    for field in ('includedTxCount', 'revertCount', 'unloggedTxCount', 'pnlUsdc', 'netPnlUsdc'):
        value = agent[field]
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f'{path}: invalid summary field {field}')
        metrics[field] = value
    metrics['included_minus_submitted'] = agent['includedTxCount'] - len(submitted)
    metrics['included_per_submitted'] = ratio(agent['includedTxCount'], len(submitted))
    metrics['reverts_per_included'] = ratio(agent['revertCount'], agent['includedTxCount'])
    for label in ('default', 'bumped', 'below', '5gwei'):
        metrics['fee_' + label + '_share'] = ratio(counts['fee_' + label + '_count'], len(fees))
    fee_distribution = distribution(fees)
    for key in ('mean', 'median', 'min', 'max'):
        metrics['fee_' + key + '_wei'] = fee_distribution[key]
    metrics['first_submit_from_runtime_ms'] = None
    metrics['first_block_from_run_start'] = None
    first = min(submitted, key=lambda item: timestamp(item[1]['ts'])) if submitted else None
    if first:
        metrics['first_submit_from_runtime_ms'] = 1000 * (timestamp(first[1]['ts']) - timestamp(starts[0][1]['ts'])).total_seconds()
        metrics['first_block_from_run_start'] = first[1]['blockSeen'] - start
    return dict(metrics=metrics, counts=dict(counts), fee_histogram=dict(Counter(fees)),
                runtime={k: starts[0][1][k] for k in ('mode', 'agentDir', 'ts')},
                runtime_line=starts[0][0], first_submission=(dict(line=first[0], ts=first[1]['ts'],
                    blockSeen=first[1]['blockSeen']) if first else None),
                source=source(path), event_keys={k: sorted(v) for k, v in event_keys.items()})


def load_experiment(root, experiment, candidate, default_fee):
    base = root / experiment
    index = base / 'index.tsv'
    worlds, seen, seen_dirs = [], set(), set()
    with index.open(encoding='utf-8', newline='') as handle:
        for line, cells in enumerate(csv.reader(handle, delimiter='\t'), 1):
            if line == 1 and cells == COLUMNS:
                continue
            if len(cells) != len(COLUMNS) or not all(cells):
                raise ValueError(f'{index}:{line}: expected five nonempty fields')
            row = dict(zip(COLUMNS, cells))
            identity = (row['regime'], int(row['seed']))
            directory = base / row['run_dir']
            if Path(row['run_dir']).is_absolute() or not directory.resolve().is_relative_to(base.resolve()):
                raise ValueError(f'{index}:{line}: path outside experiment')
            if identity in seen or directory.resolve() in seen_dirs:
                raise ValueError(f'{index}:{line}: duplicate world')
            seen.add(identity)
            seen_dirs.add(directory.resolve())
            summary_path = directory / 'summary.json'
            summary = read_json(summary_path)
            agents = {a['id']: a for a in summary['agents']}
            if len(agents) != len(summary['agents']):
                raise ValueError(f'{summary_path}: duplicate agent')
            pnls = [a['pnlUsdc'] for a in agents.values()]
            if not all(isinstance(p, (float, int)) and math.isfinite(p) for p in pnls):
                raise ValueError(f'{summary_path}: invalid pnlUsdc')
            sd, mean = st.pstdev(pnls), st.mean(pnls)
            seats = {}
            for role, seat in [('inc', 'inc-zeta'), ('candidate', candidate)]:
                seats[role] = extract_seat(directory / 'agents' / (seat + '.jsonl'),
                                           agents[seat], summary, default_fee)
                seats[role]['metrics']['simplified_t'] = 50 + 10 * (agents[seat]['pnlUsdc'] - mean) / sd if sd else 50
            delta_first_ms = None
            if all(s['first_submission'] for s in seats.values()):
                delta_first_ms = 1000 * (timestamp(seats['candidate']['first_submission']['ts']) -
                                         timestamp(seats['inc']['first_submission']['ts'])).total_seconds()
            worlds.append(dict(experiment=experiment, regime=identity[0], seed=identity[1],
                index_line=line, run_dir=row['run_dir'], exit_code=int(row['exit_code']),
                loopIterations=summary['loopIterations'], violation_count=len(summary['violations']),
                runStartBlock=summary['runStartBlock'], finalBlock=summary['finalBlock'],
                agent_count=len(agents), mode=summary['mode'], resetUnit=summary['resetUnit'],
                summary_source=source(summary_path), seats=seats,
                first_submission_seat_delta_ms=delta_first_ms))
    if not worlds:
        raise ValueError(f'{index}: empty index')
    return worlds


def clearly_outside(baseline, experiments):
    """Descriptive screen, NOT a significance test: strict IQR + same sign."""
    if baseline['q1'] is None or any(x['mean'] is None for x in experiments):
        return False
    means = [x['mean'] for x in experiments]
    return (all(x > max(0, baseline['q3']) for x in means) or
            all(x < min(0, baseline['q1']) for x in means))


def analyse(root, default_fee=100_000_000):
    root = Path(root)
    worlds = [w for e, c in EXPERIMENTS.items()
              for w in load_experiment(root, e, c, default_fee)]
    count_keys = set().union(*(s['counts'] for w in worlds for s in w['seats'].values()))
    # Absent event/action category means zero; absent measurement remains null.
    for w in worlds:
        for s in w['seats'].values():
            for key in sorted(count_keys):
                s['counts'].setdefault(key, 0)
                s['metrics'].setdefault(key, 0)
        a, b = w['seats']['candidate']['metrics'], w['seats']['inc']['metrics']
        w['delta'] = {k: a[k] - b[k] if a[k] is not None and b[k] is not None else None for k in a}
        w['delta']['first_submission_seat_ms'] = w['first_submission_seat_delta_ms']
    groups = {e: [w for w in worlds if w['experiment'] == e] for e in EXPERIMENTS}
    groups['e1e3'] = groups['e1'] + groups['e3']
    aggregate = {}
    for e, ws in groups.items():
        seats = {}
        for role in ('inc', 'candidate'):
            ss = [w['seats'][role] for w in ws]
            hist = Counter()
            for s in ss:
                hist.update(s['fee_histogram'])
            expanded = [fee for fee, n in hist.items() for _ in range(n)]
            seats[role] = dict(totals={k: sum(s['metrics'][k] for s in ss) for k in sorted(count_keys | {'submitted', 'includedTxCount', 'revertCount', 'unloggedTxCount'})},
                world_metrics={k: distribution([s['metrics'][k] for s in ss if s['metrics'][k] is not None]) for k in sorted(ss[0]['metrics'])},
                pooled_fees=distribution(expanded), fee_histogram=dict(sorted(hist.items())),
                pooled_fee_shares={label: ratio(sum(s['metrics']['fee_' + label + '_count'] for s in ss), len(expanded)) for label in ('default', 'bumped', 'below', '5gwei')},
                runtime_directories=dict(Counter(s['runtime']['agentDir'] for s in ss)),
                runtime_modes=dict(Counter(s['runtime']['mode'] for s in ss)))
        aggregate[e] = dict(worlds=len(ws), seeds=sorted({w['seed'] for w in ws}),
            regimes=sorted({w['regime'] for w in ws}),
            nonzero_exit=sum(w['exit_code'] != 0 for w in ws),
            loops_not_362=sum(w['loopIterations'] != 362 for w in ws),
            violations=sum(w['violation_count'] for w in ws), seats=seats,
            delta={k: distribution([w['delta'][k] for w in ws if w['delta'][k] is not None]) for k in sorted(ws[0]['delta'])})
    comparison = {}
    for key, baseline in aggregate['e4']['delta'].items():
        comparison[key] = dict(e4=baseline, **{e: aggregate[e]['delta'][key] for e in ('e1', 'e3', 'e1e3', 'e2')},
            flag=clearly_outside(baseline, [aggregate[e]['delta'][key] for e in ('e1', 'e3', 'e2')]))
    # Search supplied files for parameter names without emitting any values/errors.
    parameter_hits = []
    paths = sorted({p for e in EXPERIMENTS for p in (root / e).rglob('*') if p.is_file()})
    for path in paths:
        for line, text in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            names = [name for name in PARAM_NAMES if name in text]
            if names:
                parameter_hits.append(dict(path=str(path), line=line, names=names))
    vocabulary = defaultdict(set)
    for w in worlds:
        for s in w['seats'].values():
            for ev, keys in s['event_keys'].items():
                vocabulary[ev].update(keys)
    return dict(default_fee_reference_wei=default_fee, scanned_files=len(paths),
        indexes={e: source(root / e / 'index.tsv') for e in EXPERIMENTS},
        parameter_name_hits=parameter_hits, event_keys={k: sorted(v) for k, v in vocabulary.items()},
        flag_rule='E1, E3 and E2 means all strictly above max(0,E4 Q3), or all strictly below min(0,E4 Q1); linear quantiles; descriptive only',
        audit=dict(worlds=len(worlds), seat_logs=2 * len(worlds),
            world_shapes=sorted({(w['agent_count'], w['finalBlock'] - w['runStartBlock'], w['mode'], w['resetUnit']) for w in worlds}),
            inclusion_tail_count_mismatches=sum(s['metrics']['included_minus_submitted'] != -s['metrics']['at_or_after_final_submitted'] for w in worlds for s in w['seats'].values())),
        aggregate=aggregate, comparison=comparison,
        flags=[k for k, v in comparison.items() if v['flag']], worlds=worlds)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('.scratch-logs'))
    parser.add_argument('--default-fee-wei', type=int, default=100_000_000,
                        help='comparison reference, NOT a recovered runtime config')
    args = parser.parse_args()
    result = analyse(args.root, args.default_fee_wei)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2, allow_nan=False, sort_keys=True)
    print()


if __name__ == '__main__':
    main()
