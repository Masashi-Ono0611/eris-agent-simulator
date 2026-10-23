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
    r = dict(record, arm_evidence={'ARM': 'PASS', 'COLLISION': 'PASS', 'slot': directory,
                                 'head': 'a'*12, 'arm_tree': 'b'*12})
    v['inputs']['matrices'][arm] = {f'{f}#{s}': r for f in ('FP', 'FD') for s in range(1003, 1007)}
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
# Exercise actual CLI + existing generator/checker with a complete verdict.
(tmp / 'verdict.json').write_text(json.dumps(v))
cmd = [sys.executable, str(src / 'stage2-plan.py'), '--verdict', str(tmp / 'verdict.json'),
       '--lanes', 'A,B,C,D', '--order-seed', '17', '--commit', 'a'*40]
for name in ('q1', 'q2'):
    result = subprocess.run(cmd + ['--out', str(tmp/name)], capture_output=True, text=True)
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
