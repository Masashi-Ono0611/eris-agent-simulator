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
        return (f'NOTE_{job} run={run} slot={arm} matrix={path}\n'
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
    assert len(audit['selected']) == 2 and len(audit['missing']) == 38
    assert len(audit['ignored']) == 10
    killed = [r for r in audit['ignored'] if r['run'].endswith('-killed')]
    assert len(killed) == 4 and all(len(r['exits']) == 3 for r in killed)
    assert all(r['reason'].startswith('ignored attempt:') for r in audit['ignored'])
    assert len([r for r in audit['ignored'] if 'outside selected' in r['reason']]) == 4
    print('KILLED_QUEUE_CONTROLS_OK selected=2 missing=38 ignored=10')

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
                    for arm in ('opus-1', 'opus-1-pb', 'opus-1a', 'opus-1r', 'opus-1g'))
    lane_b.write_text(lines.replace(str(local), '/mini'))
    invoke('make-manifest', *args, '--path-map', f'/mini={local}', rc=0)
    man, audit = read()
    assert len(man['cells']) == 8 and len(audit['selected']) == 40 and not audit['missing']
    assert all(Path(path).is_file() for cell in man['cells'] for path in cell['arms'].values())
    print('MANIFEST_CONTROLS_OK')


def mechanism_controls():
    root = temp / 'data'
    matrix = root / 'runs' / 'matrix-fixture' / 'matrix.json'
    run = root / 'runs' / 'one'
    agent = run / 'agents' / 'slot.jsonl'
    agent.parent.mkdir(parents=True)
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
    (run2 / 'agents' / 'slot.jsonl').write_text(json.dumps({'event': 'submit_failed', 'error': 'STF'}) + '\n')
    (run2 / 'blocks.csv').write_text(','.join(cols) + '\n')
    dump(matrix, {'scenarios': [{'runDir': '/mini/runs/one'}, {'runDir': '/mini/runs/two'}]})
    man = temp / 'M.json'
    dump(man, dict(candidates={'R': 'superiority'}, cells=[dict(seed=1003, field='FP', arms={'R': str(matrix)})]))
    dump(Path(str(man) + '.audit.json'), {'path_maps': [['/mini', str(root)]]})
    out = temp / 'MECH.json'
    invoke('mechanism', man, '--out', out, rc=2)
    r = json.loads(out.read_text())['arms']['R']
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
