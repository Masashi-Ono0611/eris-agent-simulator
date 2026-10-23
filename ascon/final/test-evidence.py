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
    lines = []
    paths = {}
    for seed in range(1003, 1007):
        for field in ('FP', 'FD'):
            for arm in ('opus-1', 'opus-1-pb', 'opus-1r'):
                job = f's1-{field}{seed}-{arm}'
                path = local / 'runs' / job / 'matrix.json'
                dump(path, {'fixture': job})
                paths[job] = path
                for run in ('z-old', 'a-new'):
                    lines += [f'NOTE_{job} run={run} slot={arm} head=abc arm_tree=def lib_tree=ghi dirty=0 load1=1',
                              f'NOTE_{job} run={run} matrix=/mini/runs/{job}/matrix.json',
                              f'EXIT_{job}=0 VERDICT=PASS COLLISION=PASS ARM=PASS run={run}']
                lines += [f'NOTE_{job} run=killed slot={arm}',
                          f'EXIT_{job}=1 VERDICT=FAIL COLLISION=SKIP ARM=SKIP run=failed']
    log = logs / 'A.queue.log'
    # Disjoint jobs span two lane logs; ordering is within each lane, not filename/run id.
    log.write_text('\n'.join(x for x in lines if 's1-FP' in x) + '\n')
    log2 = logs / 'B.queue.log'
    log2.write_text('\n'.join(x for x in lines if 's1-FD' in x) + '\n')
    out = temp / 'manifest.json'
    args = ['--logs', logs, '--stage', '1', '--out', out, '--arms', 'opus-1r', '--path-map', f'/mini={local}']
    invoke('make-manifest', *args, rc=0)
    man = json.loads(out.read_text())
    audit = json.loads(Path(str(out) + '.audit.json').read_text())
    assert set(man) <= load('judge2').MANIFEST_KEYS
    assert len(man['cells']) == 8 and len(audit['selected']) == 24
    assert all(r['run'] == 'a-new' for r in audit['selected'])
    assert len(audit['ignored']) == 72 and not audit['missing']
    assert man['cells'][0]['arms']['R'] == str(paths['s1-FD1003-opus-1r'].resolve())
    # The last PASS cannot be rescued by an older PASS if its validity checks failed.
    job = 's1-FP1003-opus-1r'
    with log.open('a') as f:
        f.write(f'NOTE_{job} run=bad slot=opus-1r\nEXIT_{job}=0 VERDICT=PASS COLLISION=FAIL ARM=PASS run=bad\n')
    invoke('make-manifest', *args, rc=2)
    assert 'R' not in json.loads(out.read_text())['cells'][1]['arms']
    assert len(json.loads(Path(str(out) + '.audit.json').read_text())['missing']) == 1
    # A job which only failed must stay missing; its path is not enough.
    job_failed = 's1-FD1004-opus-1r'
    log2.write_text('\n'.join(x for x in log2.read_text().splitlines()
                              if job_failed not in x or 'run=failed' in x) + '\n')
    invoke('make-manifest', *args, rc=2)
    missing = json.loads(Path(str(out) + '.audit.json').read_text())['missing']
    assert any(x['job'] == job_failed and x['reason'] == 'missing or never PASS' for x in missing)
    # Totally absent jobs are missing; no made-up cells or matrices.
    # Across-lane PASS ordering is unavailable for arbitrary run ids: fail closed.
    with log2.open('a') as f:
        f.write(f'NOTE_{job} run=ambiguous slot=opus-1r\n'
                f'NOTE_{job} run=ambiguous matrix={paths[job]}\n'
                f'EXIT_{job}=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=ambiguous\n')
    invoke('make-manifest', *args, rc=2)
    assert any('provable order' in x['reason'] for x in
               json.loads(Path(str(out) + '.audit.json').read_text())['missing'])
    log.write_text('')
    log2.write_text('')
    invoke('make-manifest', *args, rc=2)
    assert json.loads(out.read_text())['cells'] == []
    assert len(json.loads(Path(str(out) + '.audit.json').read_text())['missing']) == 24
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
