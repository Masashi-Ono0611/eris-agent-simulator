#!/usr/bin/env python3
"""Small synthetic runs only; invoked in a mktemp directory by test-evidence.sh."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

src, temp = map(Path, sys.argv[1:3])
sys.path.insert(0, str(src))
which = sys.argv[3] if len(sys.argv) > 3 else 'all'

def load(name):
    spec = importlib.util.spec_from_file_location(name, src / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def invoke(name, *args, rc):
    p = subprocess.run([sys.executable, str(src / (name + '.py')), *map(str, args)], capture_output=True, text=True)
    assert p.returncode == rc, (name, p.returncode, p.stdout, p.stderr)


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def manifest_controls():
    logs = temp / 'logs'
    logs.mkdir()
    local = temp / 'copy'
    out = temp / 'manifest.json'
    args = ['--logs', logs, '--stage', '1', '--out', out]

    def read():
        return json.loads(out.read_text()), json.loads(Path(str(out) + '.audit.json').read_text())

    def passing(job, arm, run):
        path = local / job / 'matrix.json'
        dump(path, {'fixture': job})
        return (f'NOTE_{job} run={run} slot={arm} matrix={path} head={"e" * 12} arm_tree={"a" * 12}\n'
                f'EXIT_{job}=0 VERDICT=PASS COLLISION=PASS ARM=PASS run={run}\n')

    baseline = ''.join(passing(f's1-FD1003-{arm}', arm, f'B-{arm}')
                       for arm in ('opus-1', 'opus-1-pb'))
    (logs / 'B.queue.log').write_text(baseline)
    # Synthetic killed queues: repeated FAIL, interruption, stale lock, new run ids.
    for lane, arm in zip('CDEF', ('opus-1g', 'opus-1r', 'ascon-zeta-r3k', 'ascon-zeta-r3kg')):
        job = f's1-FP1003-{arm}'
        fail = f'EXIT_{job}=1 VERDICT=FAIL COLLISION=SKIP ARM=SKIP run={lane}-killed\n'
        text = (f'NOTE_{job} run={lane}-killed slot={arm}\n' + fail * 2 +
                f'EXIT_{job}=- VERDICT=FAIL interrupted run={lane}-killed\n' +
                f'NOTE_{job} run={lane}-rerun slot={arm}\n')
        if lane in 'CD':
            text += f'EXIT_{job}=1 VERDICT=BLOCKED run={lane}-stale-lock\n'
        (logs / f'{lane}.queue.log').write_text(text)
    invoke('make-manifest', *args, rc=2)
    man, audit = read()
    assert set(man) <= load('judge2').MANIFEST_KEYS
    assert len(man['cells']) == 1 and man['cells'][0]['field'] == 'FD'
    assert man['cells'][0]['seed'] == 1003 and set(man['cells'][0]['arms']) == {'B', "B'"}
    assert len(audit['selected']) == 2 and len(audit['missing']) == 62
    assert len(audit['ignored']) == 10
    killed = [r for r in audit['ignored'] if r['run'].endswith('-killed')]
    assert len(killed) == 4 and all(len(r['exits']) == 3 for r in killed)
    assert all(r['reason'].startswith('ignored attempt:') for r in audit['ignored'])
    assert len([r for r in audit['ignored'] if 'outside selected' in r['reason']]) == 0
    print('KILLED_QUEUE_CONTROLS_OK selected=2 missing=62 ignored=10')

    job, arm = 's1-FD1003-opus-1', 'opus-1'
    lane_b = logs / 'B.queue.log'
    # Identical PASS repeats preserve one result; conflicting PASS lines do not.
    duplicate = baseline.splitlines()[1] + '\n'
    lane_b.write_text(baseline + duplicate)
    invoke('make-manifest', *args, rc=2)
    assert len(read()[1]['selected']) == 2
    lane_b.write_text(baseline + duplicate.replace('ARM=PASS', 'ARM=FAIL'))
    invoke('make-manifest', *args, rc=2)
    assert any(m['job'] == job and 'conflicting EXIT' in m['reason'] for m in read()[1]['missing'])
    # A lone PASS still needs successful exit, collision/arm checks and provenance.
    for old, new in [('=0 VERDICT=PASS', '=1 VERDICT=PASS'),
                     ('COLLISION=PASS', 'COLLISION=FAIL'), ('ARM=PASS', 'ARM=FAIL'),
                     ('slot=opus-1 ', 'slot=wrong ')]:
        lane_b.write_text(baseline.replace(old, new, 1))
        invoke('make-manifest', *args, rc=2)
        assert len(read()[1]['selected']) == 1
    # Two PASS runs are ambiguous both within a lane and across lanes.
    for cross_lane in (False, True):
        lane_b.write_text(baseline + ('' if cross_lane else passing(job, arm, 'second')))
        other = logs / 'A.queue.log'
        other.write_text(passing(job, arm, 'second') if cross_lane else '')
        invoke('make-manifest', *args, rc=2)
        assert any(m['job'] == job and 'multiple PASS' in m['reason'] for m in read()[1]['missing'])
        assert len(read()[1]['selected']) == 1
    other.write_text('')
    # A later successful retry of a failed run is eligible under its new id.
    lane_b.write_text(baseline)
    c = logs / 'C.queue.log'
    c.write_text(c.read_text() + passing('s1-FP1003-opus-1g', 'opus-1g', 'C-success'))
    invoke('make-manifest', *args, rc=2)
    assert len(read()[1]['selected']) == 3
    # Conflicting NOTE and malformed run evidence still write both partial files.
    lane_b.write_text(baseline + f'NOTE_{job} run=B-opus-1 slot=wrong\n')
    invoke('make-manifest', *args, rc=2)
    assert any('conflicting slot' in m['reason'] for m in read()[1]['missing'])
    lane_b.write_text(baseline + f'EXIT_{job}=1 VERDICT=FAIL\n')
    invoke('make-manifest', *args, rc=2)
    assert read()[1]['errors'] and not read()[0]['cells']
    # Queue extraction preserves remote paths even without local matrix copies.
    lane_b.write_text(baseline.replace(str(local), '/missing-mini-matrices'))
    invoke('make-manifest', *args, rc=2)
    assert len(read()[1]['selected']) == 3
    fd = next(c for c in read()[0]['cells'] if c['field'] == 'FD')
    assert fd['arms']['B'] == '/missing-mini-matrices/s1-FD1003-opus-1/matrix.json'
    # Complete design and path mapping remain supported.
    for log in logs.glob('*.queue.log'):
        log.write_text('')
    lines = ''.join(passing(f's1-{field}{seed}-{arm}', arm, 'only')
                    for seed in range(1003, 1007) for field in ('FP', 'FD')
                    for arm in tuple(load('judge2').DEFAULT_ARM_MAP.values()))
    lane_b.write_text(lines.replace(str(local), '/mini'))
    invoke('make-manifest', *args, '--path-map', f'/mini={local}', rc=0)
    man, audit = read()
    assert len(man['cells']) == 8 and len(audit['selected']) == 64 and not audit['missing']
    assert all(Path(path).is_file() for cell in man['cells'] for path in cell['arms'].values())
    assert 'C1' not in man['candidates']
    for cell in man['cells']:
        for arm, proof in cell['arm_evidence'].items():
            assert proof == dict(ARM='PASS', COLLISION='PASS', slot=man['arm_map'][arm], head='e'*12, arm_tree='a'*12)
    amap = load('judge2').DEFAULT_ARM_MAP
    explicit = [f'{k}={v}' for k, v in amap.items() if k not in ('B', "B'")]
    invoke('make-manifest', *args, '--arms', *explicit, rc=0)
    assert read()[0]['arm_map'] == amap
    lane_b.write_text('\n'.join(line for line in lines.splitlines() if '-ascon-zeta-r3k ' not in line and '-ascon-zeta-r3k=' not in line))
    invoke('make-manifest', *args, '--arms', *explicit, rc=2)
    man, audit = read()
    assert len(audit['missing']) == 8 and all(x['job'].endswith('-ascon-zeta-r3k') for x in audit['missing'])
    assert all('W2' not in cell['arms'] and 'R' in cell['arms'] for cell in man['cells'])
    for entries in [('R=one', 'R=two'), ('R=opus-1',), ('B=wrong', 'R=right'), ('R',)]:
        invoke('make-manifest', *args, '--arms', *entries, rc=2)
    print('ARM_MAP_CONTROLS_OK no C1, explicit 8 arms, missing W2 only, invalid maps refused')
    print('MANIFEST_CONTROLS_OK')


def mechanism_controls():
    root = temp / 'data'
    matrix = root / 'runs' / 'matrix-fixture' / 'matrix.json'
    run = root / 'runs' / 'one'
    agent = run / 'agents' / 'slot.jsonl'
    agent.parent.mkdir(parents=True)
    summary = run / 'summary.json'
    dump(summary, {'finalBlock': 1999, 'blocksProcessed': 2000})
    decision = {'agentId': 'slot', 'round': 1998, 'action': {'type': 'noop'}}
    events = [{'event': 'runtime_start'}, {'event': 'submit_failed', 'error': 'STF'},
              {'reason': 'launch entry token: net +20'},
              {'event': 'submitted', 'error': 'STF'},
              {'event': 'submit_failed', 'error': 'not STF-like?'}]
    # Non-STF failure, before-entry STF, submitted STF are all negative controls.
    events[-1]['error'] = 'other revert'
    agent.write_text('\n'.join(map(json.dumps, events)) + '\n')
    (agent.parent / 'other.jsonl').write_text(json.dumps({'reason': 'decide timeout: no answer'}))
    dump(matrix, {'scenarios': [{'runDir': 'runs/one'}]})
    cols = ['blockNumber', 'txIndex', 'from', 'priorityFeeWei', 'ownerId', 'to']
    txs = [[1, 1, 'a', 10, 'slot', 'router'], [1, 0, 'b', 10, 'other', 'router'],
           [1, 2, 'c', 10, 'other', 'router'], [1, 3, 'd', 10, 'other', 'router'],
           [1, 4, 'a', 10, 'slot', 'elsewhere'], [2, 0, 'e', 10, 'other', 'router'],
           [1, 5, 'f', 11, 'other', 'router'], [1, 6, 'a', 10, 'other', 'router']]
    with (run / 'blocks.csv').open('w', newline='') as f:
        w = csv.writer(f); w.writerow(cols); w.writerows(txs)
    mech = load('mechanism')
    saved_log = agent.read_text()
    for last_round in (None, 140, 1996, 2002):
        agent.write_text(saved_log + (json.dumps(dict(decision, round=last_round)) + '\n'
                                     if last_round is not None else ''))
        try:
            mech.measure(matrix, 'slot', [])
        except ValueError:
            pass
        else:
            raise AssertionError(f'incomplete slot log accepted: {last_round}')
    for last_round in (1997, 1998, 1999, 2001):
        agent.write_text(saved_log + json.dumps(dict(decision, round=last_round)) + '\n')
        assert mech.measure(matrix, 'slot', [])['slot_timeouts'] == 0
    agent.write_text(saved_log + json.dumps(decision) + '\n')
    saved_summary = summary.read_text()
    for invalid in (None, '{broken', '{}', '{"finalBlock": 1999}',
                    '{"finalBlock": "1999", "blocksProcessed": 2000}'):
        if invalid is None:
            summary.unlink()
        else:
            summary.write_text(invalid)
        try:
            mech.measure(matrix, 'slot', [])
        except (OSError, ValueError):
            pass
        else:
            raise AssertionError(f'invalid summary accepted: {invalid}')
    summary.write_text(saved_summary)
    result = mech.measure(matrix, 'slot', [])
    assert result == dict(slot_timeouts=0, stf=0, tie_wins=2, tie_pairs=3), result
    with agent.open('a') as f:
        f.write(json.dumps({'reason': 'decide timeout: no answer within 5000ms'}) + '\n')
        f.write(json.dumps({'event': 'submit_failed', 'error': 'Execution reverted: STF'}) + '\n')
    result = mech.measure(matrix, 'slot', [])
    assert result['slot_timeouts'] == 1 and result['stf'] == 1
    # Reset entry tracking between scenarios.
    run2 = root / 'runs' / 'two'
    (run2 / 'agents').mkdir(parents=True)
    dump(run2 / 'summary.json', {'finalBlock': 1999, 'blocksProcessed': 2000})
    (run2 / 'agents' / 'slot.jsonl').write_text('\n'.join(map(json.dumps, [
        {'event': 'runtime_start'}, {'event': 'submit_failed', 'error': 'STF'}, decision])) + '\n')
    (run2 / 'blocks.csv').write_text(','.join(cols) + '\n')
    dump(matrix, {'scenarios': [{'runDir': '/mini/runs/one'}, {'runDir': '/mini/runs/two'}]})
    man = temp / 'M.json'
    dump(man, dict(candidates={'R': 'superiority'}, cells=[dict(seed=1003, field='FP', arms={'R': str(matrix)})]))
    dump(Path(str(man) + '.audit.json'), {'path_maps': [['/mini', str(root)]]})
    out = temp / 'MECH.json'
    invoke('mechanism', man, '--out', out, rc=2)
    r = json.loads(out.read_text())['arms']['R']
    # Collector and judge must preserve BLOCKED for incomplete execution evidence.
    complete_log = agent.read_text()
    for control in ('early-slot', 'missing-summary'):
        if control == 'early-slot':
            agent.write_text(saved_log + json.dumps(dict(decision, round=140)) + '\n')
        else:
            summary.unlink()
        invoke('mechanism', man, '--out', out, rc=2)
        blocked = json.loads(out.read_text())['arms']['R']
        assert blocked['errors'] and blocked['slot_timeouts'] is None and blocked['stf'] is None
        j = load('judge2')
        hashes = set(blocked['matrices_sha256'])
        subs = j.mechanism_clause({'R': blocked, 'B': r}, 'R', 'B', 'superiority',
                                 {'R': hashes, 'B': hashes})
        assert j._combine(subs) == 'BLOCKED', subs
        print(f'COMPLETION_CONTROL_OK {control} -> BLOCKED')
        agent.write_text(complete_log)
        summary.write_text(saved_summary)
    print('COMPLETION_CONTROL_OK summary + last decision round 1998 / finalBlock 1999; no runtime_end')
    # The same explicit mapping flows through extraction, including absent W2/X.
    mapped = json.loads(man.read_text())
    mapped['arm_map'] = {'B': 'opus-1', "B'": 'opus-1-pb', 'R': 'opus-1r',
                         'W2': 'ascon-zeta-r3k', 'X1': 'opus-1g2'}
    mapped['candidates'] = {a: 'superiority' for a in ('R', 'W2', 'X1')}
    dump(man, mapped)
    invoke('mechanism', man, '--out', out, '--arms', 'R=opus-1r', 'W2=ascon-zeta-r3k', 'X1=opus-1g2', rc=2)
    extracted = json.loads(out.read_text())
    assert extracted['arm_map'] == mapped['arm_map'] and 'C1' not in extracted['arms']
    assert extracted['arms']['R']['slot_timeouts'] == 1
    assert extracted['arms']['W2']['errors'] == ['no matrices']
    assert extracted['arms']['X1']['errors'] == ['no matrices']
    # A conflicting CLI map is rejected without overwriting evidence.
    before = out.read_bytes()
    invoke('mechanism', man, '--out', out, '--arms', 'R=wrong', rc=2)
    assert out.read_bytes() == before
    print('MECHANISM_ARM_MAP_OK missing W2/X explicit, no C1, mismatch refused')
    assert r['stf'] == 1 and r['slot_timeouts'] == 1 and r['tie_win_rate'] == 2/3
    assert r['matrices_sha256'] == [hashlib.sha256(matrix.read_bytes()).hexdigest()]
    assert r['p99_decide_ms'] is None and r['p99_decide_ms_reason']
    # Approved advisory: explicit null with reason does not block clause 5.
    j = load('judge2')
    h = r['matrices_sha256']
    good = dict(r, slot_timeouts=0, stf=0)
    evidence = {'R': good, 'B': dict(good)}
    subs = j.mechanism_clause(evidence, 'R', 'B', 'superiority', {'R': set(h), 'B': set(h)})
    assert subs['p99_latency']['status'] == 'NOT_MEASURED'
    assert all(v['status'] == 'PASS' for k, v in subs.items() if k != 'p99_latency')
    cells = {(s, f): {'regimes': {reg: (1.0, 1.0) for reg in j.REGIMES12}}
             for s in range(1003, 1007) for f in j.FIELDS}
    verdict = j.evaluate('superiority', cells, mechanism_subs=subs, f_override=.25)
    assert verdict['verdict'] == 'PASS', verdict
    for duration, expected in [(499, 'PASS'), (500, 'FAIL')]:
        good['p99_decide_ms'] = duration
        ss = j.mechanism_clause(evidence, 'R', 'B', 'superiority', {'R': set(h), 'B': set(h)})
        assert ss['p99_latency']['status'] == expected
        assert j.evaluate('superiority', cells, mechanism_subs=ss, f_override=.25)['verdict'] == expected
    good['p99_decide_ms'] = None
    good['slot_timeouts'] = 1
    ss = j.mechanism_clause(evidence, 'R', 'B', 'superiority', {'R': set(h), 'B': set(h)})
    assert ss['p99_latency']['status'] == 'NOT_MEASURED'
    assert j.evaluate('superiority', cells, mechanism_subs=ss, f_override=.25)['verdict'] == 'FAIL'
    print('P99_NULL_WITH_TIMEOUT=FAIL (FAIL takes precedence)')
    print('P99_NULL_WITH_REASON=NOT_MEASURED (candidate PASS) P99_499=PASS P99_500=FAIL (clause and candidate)')
    assert r['matrices'][0]['tie_win_rate'] == 2/3
    # Global collector dedupe: relabelled copies cannot contribute another observation.
    original_man = man.read_text()
    duplicate = matrix.parent / 'copy.json'
    original_matrix = json.loads(matrix.read_text())
    for different_bytes in (False, True):
        copied = dict(original_matrix, seed=9999) if different_bytes else original_matrix
        if different_bytes:
            copied['scenarios'] = [dict(row, runDir=row['runDir'].replace('/runs/', '/runs/./'))
                                   for row in original_matrix['scenarios']]
        dump(duplicate, copied)
        for other_arm in ('R', 'W2'):
            mm = json.loads(original_man)
            mm['cells'].append(dict(seed=1004, field='FP', arms={other_arm: str(duplicate)}))
            dump(man, mm)
            invoke('mechanism', man, '--out', out, rc=2)
            failed = json.loads(out.read_text())['arms'][other_arm]
            assert failed['slot_timeouts'] is None and failed['stf'] is None
            assert any('duplicate' in error for error in failed['errors']), failed
    man.write_text(original_man)
    print('GLOBAL_DEDUPE_OK copied hashes and aliased runs across cells/arms')
    # A header-only CSV is a valid no-tie sample, never a fabricated 0 or 0.5.
    (run / 'blocks.csv').write_text(','.join(cols) + '\n')
    invoke('mechanism', man, '--out', out, rc=2)
    rr = json.loads(out.read_text())['arms']['R']
    assert rr['tie_win_rate'] is None and rr['tie_pairs'] == 0 and not rr['errors']
    # Truncated CSV cannot be interpreted as a clean no-tie sample.
    (run / 'blocks.csv').write_text(','.join(cols) + '\n1,0,a,10\n')
    invoke('mechanism', man, '--out', out, rc=2)
    rr = json.loads(out.read_text())['arms']['R']
    assert rr['tie_win_rate'] is None and rr['errors']
    # Broken or absent logs must not become zero failures.
    agent.write_text('{broken\n')
    invoke('mechanism', man, '--out', out, rc=2)
    rr = json.loads(out.read_text())['arms']['R']
    assert rr['stf'] is None and rr['slot_timeouts'] is None and rr['errors']
    agent.unlink()
    invoke('mechanism', man, '--out', out, rc=2)
    assert json.loads(out.read_text())['arms']['R']['tie_win_rate'] is None
    print('MECHANISM_CONTROLS_OK')

if which in ('all', 'manifest'):
    manifest_controls()
if which in ('all', 'mechanism'):
    mechanism_controls()
