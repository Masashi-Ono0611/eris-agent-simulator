import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

src, tmp = map(Path, sys.argv[1:3])
spec = importlib.util.spec_from_file_location('planner', src / 'stage2-plan.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
j = m.load('judge2')
mapping = {k: j.DEFAULT_ARM_MAP[k] for k in ('B', "B'", 'R', 'W1', 'X1')}
record = {'sha256': 'a'*64, 'setup': {k: 'a'*40 for k in j.SETUP_KEYS}}
v = {'tool': 'ascon/final/judge2.py', 'stage': '1',
     'params': {'t_crit': j.T_CRIT, 'threshold': 0.20, 'statistic': 'EW11', 'ask_floor': None, 'slot_id': 'slot', 'baseline': 'B', 'placebo': "B'"},
     'design': {'seeds': list(range(1003, 1007)), 'fs_seeds': []}, 'arm_map': mapping,
     'selection': {'F': 'R', 'F2': 'W1', 'status': 'DECIDED'}, 'placebo': {'f': 0.25},
     'candidates': {k: {'verdict': 'PASS', 'rule': 'superiority'} for k in ('R', 'W1', 'X1')},
     'inputs': {'matrices': {}}}
for arm, directory in mapping.items():
    v['inputs']['matrices'][arm] = {}
    for f in ('FP', 'FD'):
        for s in range(1003, 1007):
            # judge2 records paths after resolving them against the manifest
            # directory, with an absolute matrix binding in each attestation.
            path = str((tmp / 'matrices' / directory / f'{f}-{s}' / 'matrix.json').resolve())
            v['inputs']['matrices'][arm][f'{f}#{s}'] = dict(
                copy.deepcopy(record), path=path,
                arm_evidence={'ARM': 'PASS', 'COLLISION': 'PASS', 'slot': directory,
                              'head': 'a'*12, 'arm_tree': 'b'*12, 'matrix': path})
assert m.selected(v, j)[0] == ['B', 'R', 'W1']
for change in ('partial', 'none', 'x', 'xdir', 'stage', 'floor', 'matrices', 'pending', 'placebo_record'):
    bad = copy.deepcopy(v)
    if change == 'placebo_record': bad['inputs']['matrices']["B'"]['FP#1003'] = {}
    if change == 'partial': del bad['inputs']
    if change == 'none': bad['selection']['F'] = None
    if change == 'x': bad['selection']['F'] = 'X1'
    if change == 'xdir': bad['arm_map']['R'] = 'opus-1g'
    if change == 'stage': bad['stage'] = '2'
    if change == 'floor': bad['placebo']['f'] = None
    if change == 'matrices': del bad['inputs']['matrices']['R']['FP#1003']
    if change == 'pending': bad['candidates']['W1']['verdict'] = 'BLOCKED'
    try:
        m.selected(bad, j)
    except ValueError:
        pass
    else:
        raise AssertionError('accepted ' + change)
# Each review regression can run alone against the original planner for red proof.
def rejected(value, message):
    try:
        m.selected(value, j)
    except ValueError as exc:
        assert message in str(exc), str(exc)
    else:
        raise AssertionError('accepted ' + message)


def regression_partial_map():
    value = copy.deepcopy(v)
    del value['arm_map']['B']
    del value['arm_map']["B'"]
    labels, resolved = m.selected(value, j)
    assert [resolved[x] for x in labels] == ['opus-1', 'opus-1r', 'opus-1g2']
    assert 'B' not in value['arm_map']  # no mutation of input evidence


def regression_nonselected():
    value = copy.deepcopy(v)
    value['selection']['F2'] = None
    value['candidates']['W1'] = {'verdict': 'FAIL', 'rule': 'noninferiority'}
    del value['inputs']['matrices']['W1']
    assert m.selected(value, j)[0] == ['B', 'R']


def regression_legacy_identity():
    value = copy.deepcopy(v)
    del value['arm_map']
    value['inputs']['matrices']['R']['FP#1003']['arm_evidence']['slot'] = 'wrong-arm'
    rejected(value, 'matching slot directory')


def regression_duplicate_arms():
    value = copy.deepcopy(v)
    value['arm_map']['W1'] = value['arm_map']['R']
    for rec in value['inputs']['matrices']['W1'].values():
        rec['arm_evidence']['slot'] = value['arm_map']['R']
    rejected(value, 'arm directories must be unique')


regressions = {f.__name__: f for f in (
    regression_partial_map, regression_nonselected,
    regression_legacy_identity, regression_duplicate_arms)}
if len(sys.argv) > 3:
    regressions[sys.argv[3]]()
    print('REGRESSION_OK ' + sys.argv[3])
    sys.exit(0)
for name, check in regressions.items():
    check()
    print('REGRESSION_OK ' + name)

# A passing attestation cannot be reused for another matrix or repaired by
# inventing/rebasing its path. Check every dependency, including the placebo.
for arm in ('B', "B'", 'R', 'W1'):
    for change in ('missing_path', 'missing_binding', 'wrong_matrix', 'relative_binding'):
        value = copy.deepcopy(v)
        rec = value['inputs']['matrices'][arm]['FP#1003']
        if change == 'missing_path': del rec['path']
        if change == 'missing_binding': del rec['arm_evidence']['matrix']
        if change == 'wrong_matrix': rec['arm_evidence']['matrix'] += '.other'
        if change == 'relative_binding': rec['arm_evidence']['matrix'] = 'matrix.json'
        rejected(value, 'arm evidence matrix differs or is missing')
before = copy.deepcopy(v)
assert m.selected(v, j)[0] == ['B', 'R', 'W1']
assert v == before
print('MATRIX_BINDING_CONTROLS_OK')

# Controls for disproved findings: B is validated through prior_problems.
for change in ('missing', 'label', 'record'):
    value = copy.deepcopy(v)
    if change == 'missing': del value['inputs']['matrices']['B']
    if change == 'label': del value['inputs']['matrices']['B']['FP#1003']
    if change == 'record': value['inputs']['matrices']['B']['FP#1003'] = {}
    rejected(value, 'prior verdict')
value = copy.deepcopy(v)
del value['arm_map']
value['candidates']['W1']['rule'] = 'noninferiority'
assert m.selected(value, j)[0] == ['B', 'R', 'W1']
value = copy.deepcopy(v)
del value['selection']['F2']
assert m.selected(value, j)[0] == ['B', 'R']
# Lane count is capacity, not cell count; all arms remain contiguous on one lane.
mq = m.load('make-queues')
for count in (1, 2, 3, 4, 8):
    queues = mq.plan('s2', range(1011, 1015), ['FP', 'FD'],
                     ['opus-1', 'opus-1r', 'opus-1g2'], list(range(count)), 17)
    cells = {}
    for lane, jobs in queues.items():
        for index, row in enumerate(jobs):
            cells.setdefault(row[-1], []).append((lane, index))
    assert len(cells) == 8
    for rows in cells.values():
        assert len(rows) == 3 and len({lane for lane, _ in rows}) == 1
        assert [i for _, i in rows] == list(range(rows[0][1], rows[0][1] + 3))

# Exercise actual CLI + existing generator/checker with a complete verdict.
(tmp / 'verdict.json').write_text(json.dumps(v))
cmd = [sys.executable, str(src / 'stage2-plan.py'), '--verdict', str(tmp / 'verdict.json'),
       '--lanes', 'A,B,C,D', '--order-seed', '17', '--commit', 'a'*40]
for name in ('q1', 'q2'):
    # The verdict lives away from the invocation directory. Recorded absolute
    # matrix paths must also work when invoked from a different directory.
    result = subprocess.run(cmd + ['--out', str(tmp/name)], capture_output=True, text=True,
                            cwd=src if name == 'q1' else tmp)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'lane A: jobs=6 estimated_hours=15.00' in result.stdout
    rows = [line for p in (tmp/name).glob('*.txt') for line in p.read_text().splitlines() if not line.startswith('#')]
    assert len(rows) == 24 and not any('opus-1-pb' in line for line in rows)
    assert {line.split()[3] for line in rows} == {f'ascon/final/scen-{s}.yaml' for s in range(1011, 1015)}
assert all(p.read_bytes() == (tmp/'q2'/p.name).read_bytes() for p in (tmp/'q1').glob('*.txt'))
v['selection']['F2'] = None
assert m.selected(v, j)[0] == ['B', 'R']
v['selection']['F'] = 'X1'
(tmp/'verdict.json').write_text(json.dumps(v))
r = subprocess.run(cmd + ['--out', str(tmp/'bad')], capture_output=True, text=True)
assert r.returncode == 2 and 'BLOCKED' in r.stdout and not (tmp/'bad').exists()
print('STAGE2_PLAN_OK')
