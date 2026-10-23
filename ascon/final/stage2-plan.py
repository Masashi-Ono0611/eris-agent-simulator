#!/usr/bin/env python3
"""Plan Step 7 FP/FD queues only; see README for F2 capacity and separate FS gates."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def selected(v, judge):
    if not isinstance(v, dict) or v.get('tool') != 'ascon/final/judge2.py' or v.get('stage') != '1':
        raise ValueError('not a judge2 stage-1 verdict')
    for key in ('params', 'design', 'inputs', 'candidates', 'selection', 'placebo'):
        if not isinstance(v.get(key), dict):
            raise ValueError('incomplete stage-1 verdict: ' + key)
    p = v['params']
    if p.get('statistic') != 'EW11' or p.get('ask_floor') is not None or v.get('nonplan'):
        raise ValueError('non-plan verdict')
    if p.get('baseline') != 'B' or p.get('placebo') != "B'" or p.get('slot_id') != 'slot':
        raise ValueError('unexpected baseline/placebo/slot')
    if p.get('t_crit') != judge.T_CRIT or p.get('threshold') != 0.20:
        raise ValueError('non-plan stage-1 thresholds')
    f = v['placebo'].get('f')
    if isinstance(f, bool) or not isinstance(f, (int, float)) or not math.isfinite(f) or f <= 0:
        raise ValueError('missing stage-1 placebo floor')
    sel = v['selection']
    if sel.get('status') != 'DECIDED' or not sel.get('F'):
        raise ValueError('no decided stage-2 candidate')
    mapping = v.get('arm_map') or dict(judge.DEFAULT_ARM_MAP, C1='opus-1a')
    if not isinstance(mapping, dict):
        raise ValueError('malformed arm_map')
    names = [sel['F']] + ([sel['F2']] if sel.get('F2') else [])
    if len(set(names)) != len(names):
        raise ValueError('F and F2 are identical')
    for name in names:
        if not isinstance(name, str) or judge.exploratory_arm(name, mapping):
            raise ValueError('informational X arm cannot enter stage 2')
        cv = v['candidates'].get(name, {})
        if cv.get('informational') or cv.get('verdict') != 'PASS' or name not in mapping:
            raise ValueError('selected candidate is not a shippable PASS: ' + name)
        if cv.get('rule') not in ('superiority', 'noninferiority'):
            raise ValueError('missing/unknown candidate rule: ' + name)
        cfg = {'candidates': {name: cv.get('rule')}, 'arm_map': v.get('arm_map'),
               'slot_id': 'slot', 'baseline': 'B'}
        problems = judge.prior_problems(v, cfg, name)
        if problems:
            raise ValueError('; '.join(problems))
    for name, cv in v['candidates'].items():
        if not isinstance(cv, dict) or (not judge.exploratory_arm(name, mapping) and cv.get('verdict') not in ('PASS', 'FAIL')):
            raise ValueError('incomplete candidate verdict: ' + name)
    if any(v.get(k) for k in ('global_problems', 'infrastructure_open', 'input_problems')):
        raise ValueError('stage-1 verdict has unresolved input/infrastructure problems')
    seeds = v['design'].get('seeds')
    if seeds not in ([1003, 1004, 1005, 1006], [1007, 1008, 1009, 1010]):
        raise ValueError('incomplete/non-plan stage-1 seeds')
    # B-prime is needed in the prior evidence, but is NOT rerun in stage 2.
    matrices = v['inputs'].get('matrices', {})
    labels = {f'{field}#{seed}' for field in ('FP', 'FD') for seed in seeds}
    if set(matrices.get("B'", {})) != labels:
        raise ValueError('incomplete stage-1 placebo matrices')
    # Use the same prior-evidence validator for the placebo and non-selected
    # shipping candidates as well, without changing their actual verdicts.
    for name in ["B'"] + [n for n in v['candidates'] if not judge.exploratory_arm(n, mapping)]:
        prior = dict(v, candidates={**v['candidates'], name: {'verdict': 'PASS', 'rule': 'superiority'}})
        cfg = {'candidates': {name: 'superiority'}, 'arm_map': v.get('arm_map'),
               'slot_id': 'slot', 'baseline': 'B'}
        problems = judge.prior_problems(prior, cfg, name)
        if problems:
            raise ValueError('; '.join(problems))
    return ['B'] + names, mapping


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    for flag in ('verdict', 'lanes', 'out'):
        ap.add_argument('--' + flag, required=True)
    ap.add_argument('--order-seed', type=int, required=True)
    ap.add_argument('--commit')
    ap.add_argument('--job-hours', type=float, default=2.5)
    a = ap.parse_args()
    try:
        if not math.isfinite(a.job_hours) or a.job_hours <= 0:
            raise ValueError('job-hours must be positive and finite')
        if a.commit and not re.fullmatch(r'[0-9a-f]{7,40}', a.commit):
            raise ValueError('commit must be 7-40 lowercase hex digits')
        raw = Path(a.verdict).read_bytes()
        labels, mapping = selected(json.loads(raw), load('judge2'))
        mq = load('make-queues')
        lanes = mq.split_list(a.lanes, 'lanes')
        if len(set(x.lower() for x in lanes)) != len(lanes):
            raise ValueError('lane names collide ignoring case')
        arms = [mapping[x] for x in labels]
        mq.split_list(','.join(arms), 'arms')
        # Reuse the generator's validation, writer, checker and deterministic order.
        argv = ['make-queues.py', '--stage', 's2', '--seeds', '1011-1014', '--fields', 'FP,FD',
                '--arms', ','.join(arms), '--lanes', ','.join(lanes), '--order-seed', str(a.order_seed), '--out', a.out]
        if a.commit:
            mq.git_head = lambda: a.commit
        old = sys.argv
        try:
            sys.argv = argv
            rc = mq.main()
        finally:
            sys.argv = old
        if rc:
            return rc
        receipt = {'verdict_sha256': hashlib.sha256(raw).hexdigest(), 'selected': labels,
                   'arm_map': mapping, 'commit': a.commit or mq.git_head(),
                   'f2_policy': 'parallel on supplied lanes (capacity assumed)',
                   'placebo_policy': 'inherit stage-1 f; no B-prime rerun',
                   'scope': 'FP/FD only; FS and docker gates remain separate'}
        Path(a.out, 'stage2-plan.json').write_text(json.dumps(receipt, indent=2) + '\n')
        plan = mq.plan('s2', range(1011, 1015), ['FP', 'FD'], arms, lanes, a.order_seed)
        for lane, jobs in plan.items():
            print(f'lane {lane}: jobs={len(jobs)} estimated_hours={len(jobs) * a.job_hours:.2f}')
        return 0
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as e:
        print('BLOCKED ' + str(e))
        return 2


if __name__ == '__main__':
    sys.exit(main())
