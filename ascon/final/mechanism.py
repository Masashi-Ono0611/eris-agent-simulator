#!/usr/bin/env python3
"""Extract clause-5 evidence without guessing missing measurements.
Default map shared with judge2: B=opus-1, B'=opus-1-pb; shipping R=opus-1r,
W1=opus-1g2 (defect-fixed), W2=ascon-zeta-r3k; informational X1=opus-1g
(frozen original), X2=opus-1w, X3=ascon-zeta-r3kg. X never advances or ships.
Tie unit is a slot/other-sender transaction pair, including reverted transactions.
blocks.csv has no venue column: its on-chain `to` destination is the venue key.
This does not distinguish pools behind one router. Empty destinations are excluded.
Reads OUT.audit.json path_maps emitted by make-manifest (or explicit --path-map).
Exit 2 for unavailable evidence, including the unrecorded p99. Successful extraction
currently always exits 2 and writes JSON; fatal input errors may leave no new file.
Callers accepting 0 or 2 must read the newly written JSON and the judge's verdict,
never interpret the exit code alone as usable evidence or a passing candidate.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
from collections import defaultdict
sys.path.insert(0, str(Path(__file__).resolve().parent))
from judge2 import resolve_arm_map


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def measure(matrix, slot, mappings, seen=None):
    m = json.loads(matrix.read_text())
    rows = m['scenarios']
    if not rows:
        raise ValueError('empty scenarios')
    timeouts = stf = wins = ties = 0
    seen = set() if seen is None else seen
    for row in rows:
        rd = row['runDir']
        for old, new in sorted(mappings, key=lambda x: -len(x[0])):
            if rd == old or rd.startswith(old + '/'):
                rd = new + rd[len(old):]
                break
        run = Path(rd) if Path(rd).is_absolute() else matrix.parent.parent.parent / rd
        run = run.resolve()
        if run in seen:
            raise ValueError('duplicate runDir')
        seen.add(run)
        entered = False
        summary = json.loads((run / 'summary.json').read_text())
        if not isinstance(summary, dict) or any(
                type(summary.get(key)) is not int or summary[key] < 0
                for key in ('runStartBlock', 'finalBlock', 'blocksProcessed')):
            raise ValueError('incomplete run: invalid runStartBlock, finalBlock or blocksProcessed in summary.json')
        if (summary['blocksProcessed'] <= 0 or
                summary['finalBlock'] <= summary['runStartBlock'] or
                summary['blocksProcessed'] != summary['finalBlock'] - summary['runStartBlock']):
            raise ValueError('incomplete run: empty or inconsistent block extent in summary.json')
        last_decision = None
        covered_rounds = set()
        for line in (run / 'agents' / (slot + '.jsonl')).read_text().splitlines():
            if not line.strip():
                continue
            e = json.loads(line)
            if not isinstance(e, dict):
                raise ValueError('agent JSONL entry is not an object')
            reason = str(e.get('reason', ''))
            failed_stf = (entered and e.get('event') == 'submit_failed' and
                          bool(re.search(r'\bSTF\b', str(e.get('error', '')))))
            decision = 'action' in e or 'decide timeout:' in reason
            # Timeouts record a no-action round. STF submission reports use
            # blockSeen and may arrive asynchronously after later decisions.
            if e.get('agentId') == slot and (decision or failed_stf):
                round_ = e.get('round') if decision else e.get('blockSeen', e.get('round'))
                if type(round_) is not int or round_ < 0:
                    raise ValueError('invalid slot decision round')
                # Warm-up decisions provide no run coverage. Duplicate lines
                # are normal, but actual decision order must not go backwards.
                if round_ >= summary['runStartBlock'] - 1:
                    if decision:
                        if last_decision is not None and round_ < last_decision:
                            raise ValueError('incomplete agent log: reversed slot decision rounds')
                        last_decision = round_
                    covered_rounds.add(round_)
            timeouts += int('decide timeout:' in reason)
            # Count only submit failures after an earlier launch-entry log, per scenario.
            stf += int(failed_stf)
            if re.match(r'^launch entry(?:\b)', reason):
                entered = True
        rounds = sorted(covered_rounds)
        if not rounds or abs(summary['finalBlock'] - rounds[-1]) > 2:
            raise ValueError('incomplete agent log: last slot decision not within 2 blocks of finalBlock')
        if rounds[0] > summary['runStartBlock'] + 2:
            raise ValueError('incomplete agent log: missing initial slot decisions')
        if any(b - a > 3 for a, b in zip(rounds, rounds[1:])):
            raise ValueError('incomplete agent log: discontinuous slot decision rounds')
        groups = defaultdict(list)
        with (run / 'blocks.csv').open(newline='') as f:
            reader = csv.DictReader(f)
            required = {'blockNumber', 'txIndex', 'from', 'priorityFeeWei', 'ownerId', 'to'}
            if not required <= set(reader.fieldnames or []):
                raise ValueError('blocks.csv missing columns: ' + ','.join(sorted(required - set(reader.fieldnames or []))))
            indexes = set()
            for tx in reader:
                if None in tx or any(tx[k] is None for k in required):
                    raise ValueError('blocks.csv malformed row')
                block, index, fee = (int(tx[k]) for k in ('blockNumber', 'txIndex', 'priorityFeeWei'))
                if min(block, index, fee) < 0 or (block, index) in indexes or not tx['from']:
                    raise ValueError('invalid/duplicate transaction position or sender')
                indexes.add((block, index))
                if tx['to']:
                    groups[(block, tx['to'].lower(), fee)].append((index, tx['from'].lower(), tx['ownerId']))
        for group in groups.values():
            for index, sender, owner in group:
                if owner == slot:
                    for other_index, other_sender, _ in group:
                        if other_sender != sender:
                            ties += 1
                            wins += int(index < other_index)
    return dict(slot_timeouts=timeouts, stf=stf, tie_wins=wins, tie_pairs=ties)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('manifest', type=Path)
    p.add_argument('--arms', nargs='+', help='LABEL=agent-dir; must match manifest')
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--path-map', action='append', default=[])
    a = p.parse_args()
    man = json.loads(a.manifest.read_text())
    arm_map = resolve_arm_map(man, a.arms)
    if arm_map:
        candidates = {label: 'superiority' for label in arm_map if label not in ('B', "B'")}
        if man.get('candidates') and man['candidates'] != candidates:
            raise ValueError('candidates differ from arm_map')
        man['candidates'] = candidates
    audit = Path(str(a.manifest) + '.audit.json')
    mappings = json.loads(audit.read_text()).get('path_maps', []) if audit.exists() else []
    for item in a.path_map:
        old, sep, new = item.partition('=')
        if not sep or not Path(old).is_absolute() or not Path(new).is_absolute():
            p.error('--path-map requires absolute mini-prefix=local-prefix')
        mappings.append((old.rstrip('/'), new.rstrip('/')))
    if man.get('exclude'):
        raise ValueError('exclusions require separately scoped evidence; refusing to aggregate excluded runs')
    required = [man.get('baseline', 'B')]
    if str(man.get('stage', '1')) not in ('2', 'retest'):
        required.append(man.get('placebo', "B'"))
    arms = {x: [] for x in required + list(man['candidates'])}
    for cell in man['cells']:
        for arm, path in cell['arms'].items():
            arms.setdefault(arm, []).append(Path(path) if Path(path).is_absolute() else a.manifest.resolve().parent / path)
    output = {}
    seen_runs = set()
    for arm, paths in arms.items():
        records, hashes, errors = [], [], []
        for path in paths:
            try:
                h = sha(path)
                hashes.append(h)
                measured = measure(path, man.get('slot_id', 'slot'), mappings, seen_runs)
                measured['tie_win_rate'] = (measured['tie_wins'] / measured['tie_pairs']
                                            if measured['tie_pairs'] else None)
                records.append(dict(matrix=str(path), sha256=h, **measured))
            except (OSError, ValueError, KeyError, TypeError) as e:
                errors.append(f'{path}: {e}')
        if not paths:
            errors.append('no matrices')
        wins = sum(r['tie_wins'] for r in records)
        ties = sum(r['tie_pairs'] for r in records)
        output[arm] = dict(slot_timeouts=None if errors else sum(r['slot_timeouts'] for r in records),
                           stf=None if errors else sum(r['stf'] for r in records),
                           tie_win_rate=wins / ties if ties and not errors else None,
                           tie_pairs=ties, tie_wins=wins, matrices_sha256=sorted(set(hashes)),
                           p99_decide_ms=None, p99_decide_ms_reason='Runtime does not record decide duration; stage 1 already started. Not measurable retrospectively.',
                           matrices=records, errors=errors)
        if not ties:
            output[arm]['tie_win_rate_reason'] = 'No observed equal-fee same-destination pairs; rate is undefined.'
    a.out.write_text(json.dumps(dict(arms=output, arm_map=arm_map), indent=2) + '\n')
    print('MECHANISM BLOCKED: p99_decide_ms is unmeasured (null); evidence written to ' + str(a.out))
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f'BLOCKED: {e}', file=sys.stderr)
        sys.exit(2)
