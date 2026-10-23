"""Offline orchestration controls: real manifest/planner, controlled judge/mechanism CLIs.

Judge statistical correctness is covered separately by test-judge2.sh. The doubles
let us isolate exit-2 evidence, pending/no-pass/selected outcomes and I/O failures.
"""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys

root, temp = map(Path, sys.argv[1:])
src = root / 'ascon/final'
repo = temp / 'fixture repo'
final = repo / 'ascon/final'
final.mkdir(parents=True)
(repo / 'ascon/eval').mkdir()
for name in ('d1-run.sh', 'd1-run.py', 'make-manifest.py', 'mechanism.py', 'stage2-plan.py', 'make-queues.py', 'judge2.py'):
    shutil.copyfile(src / name, final / name)
shutil.copyfile(root / 'ascon/eval/lane-eta.py', repo / 'ascon/eval/lane-eta.py')
# Generator validates actual resources; use symlinks to read-only fixtures.
(repo / 'example').symlink_to(root / 'example', target_is_directory=True)
for path in src.glob('*.yaml'):
    (final / path.name).symlink_to(path)
subprocess.run(['git', 'init', '-q', str(repo)], check=True)
# Resolve a real commit without creating any commit (including in the fixture).
(repo / '.git/objects/info/alternates').write_text(
    subprocess.check_output(['git', '-C', str(root), 'rev-parse', '--path-format=absolute', '--git-path', 'objects'], text=True))
sha = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
(repo / '.git/HEAD').write_text(sha + '\n')
logs = temp / 'logs'
logs.mkdir()


def invoke(base, name, *args):
    out = temp / name
    result = subprocess.run(['/bin/bash', str(base / 'd1-run.sh'), str(out), '--logs', str(logs), *map(str, args)],
                            capture_output=True, text=True)
    assert 'RAW_PNL_SENTINEL' not in result.stdout + result.stderr
    markers = [x for x in result.stdout.splitlines() if x.startswith(('D1_', 'DRY_RUN D1_'))]
    assert len(markers) == 1 and result.stdout.splitlines()[-1] == markers[0], result.stdout
    return result, out


def blocked_control(base, name):
    result, out = invoke(base, name)
    assert result.returncode == 2 and 'D1_BLOCKED stage 1 incomplete:' in result.stdout, result.stdout
    assert 's1-FP1003-opus-1' in result.stdout
    assert 'X3: informational: pending (0/8 cells)' in result.stdout
    assert not (out / 'MECH.json').exists() and not (out / 's2').exists()


blocked_control(final, 'missing')
# Real empty-evidence dry run: no doubles, and every artifact is labelled.
r, out = invoke(final, 'real-dry', '--allow-partial')
assert r.returncode == 2 and 'DRY_RUN D1_BLOCKED' in r.stdout
assert all(x.startswith('DRY_RUN ') for x in r.stdout.splitlines())
for path in out.glob('*.json'):
    assert json.loads(path.read_text())['DRY_RUN'] is True
assert (out / 'MECH.json').exists()  # Empty design is refused by the real judge.
print('REAL_MISSING_AND_DRY_OK')

# A red mutation bypasses the manifest gate; the missing-job control MUST fail.
red = temp / 'red/ascon/final'
red.mkdir(parents=True)
for path in final.iterdir():
    if path.is_file():
        (red / path.name).symlink_to(path)
(red / 'd1-run.py').unlink()
code = (final / 'd1-run.py').read_text()
assert 'if not dry:\n                raise Blocked(reason)' in code
(red / 'd1-run.py').write_text(code.replace('if not dry:\n                raise Blocked(reason)', 'if False:\n                raise Blocked(reason)'))
try:
    blocked_control(red, 'red-out')
except AssertionError:
    print('RED_CHECK_OK manifest gate bypass detected')
else:
    raise AssertionError('red mutation survived')

# Obtain a complete attested verdict fixture from the existing planner controls.
fixture = temp / 'planner-fixture'
fixture.mkdir()
result = subprocess.run([sys.executable, '-B', str(src / 'test-stage2-plan.py'), str(src), str(fixture)], capture_output=True, text=True)
assert result.returncode == 0, result.stdout + result.stderr
v = json.loads((fixture / 'verdict.json').read_text())
v['selection'].update(F='R', F2='W1')
for name, cv in v['candidates'].items():
    cv.update(stats={'m': 1.234567, 't': 9.876543}, informational=name.startswith('X'),
              clauses={'5_mechanism': {'status': 'PASS', 'subclauses': {
                  k: {'status': 'NOT_MEASURED' if k == 'p99_latency' else 'PASS'}
                  for k in ('slot_timeouts', 'p99_latency', 'tie_win_rate', 'stf', 'provenance')}}})
verdict_fixture = final / 'fixture.json'


def set_verdict(value):
    verdict_fixture.write_text(json.dumps(value))


# Preserve real judge definitions for make-manifest and stage2-plan imports;
# only replace its CLI entrypoint, with strict argument-contract assertions.
judge = final / 'judge2.py'
code = judge.read_text()
index = code.rfind('if __name__ == "__main__":')
assert index > 0
judge.write_text(code[:index] + '''if __name__ == "__main__":
    from pathlib import Path
    assert sys.argv[1] == 'judge'
    assert sys.argv[sys.argv.index('--stage') + 1] == '1'
    assert Path(sys.argv[sys.argv.index('--mechanism') + 1]).is_file()
    manifest = json.loads(Path(sys.argv[sys.argv.index('--manifest') + 1]).read_text())
    assert len(manifest['cells']) == 8
    Path(sys.argv[sys.argv.index('--out') + 1]).write_text(Path(__file__).with_name('fixture.json').read_text())
    print('RAW_PNL_SENTINEL')
''')
(final / 'mechanism.py').write_text('''import json, sys
from pathlib import Path
assert Path(sys.argv[1]).is_file()
Path(sys.argv[sys.argv.index('--out') + 1]).write_text(json.dumps({'arms': {}}))
print('RAW_PNL_SENTINEL')
sys.exit(2)
''')
mapping = {'B': 'opus-1', "B'": 'opus-1-pb', 'R': 'opus-1r', 'W1': 'opus-1g2',
           'W2': 'ascon-zeta-r3k', 'X1': 'opus-1g', 'X2': 'opus-1w', 'X3': 'ascon-zeta-r3kg'}
rows = []
for seed in range(1003, 1007):
    for field in ('FP', 'FD'):
        for arm in mapping.values():
            job = f's1-{field}{seed}-{arm}'
            rows.extend([f'NOTE_{job} run=fixture slot={arm} matrix=/fixture/{job}/matrix.json head={sha} arm_tree={sha}',
                         f'EXIT_{job}=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=fixture'])
(logs / 'A.queue.log').write_text('\n'.join(rows) + '\n')
set_verdict(v)
# Regression: optional X cells cannot gate D1; every shipping cell must gate it.
for label in ('X1', 'X2', 'X3', 'W2'):
    job = f's1-FP1003-{mapping[label]}'
    (logs / 'A.queue.log').write_text('\n'.join(row for row in rows if not row.startswith((f'NOTE_{job} ', f'EXIT_{job}='))) + '\n')
    r, out = invoke(final, 'missing-cell-' + label)
    if label.startswith('X'):
        assert r.returncode == 0 and r.stdout.endswith('D1_PASS\n'), r.stdout
        assert f'{label}: informational: pending (7/8 cells)' in r.stdout
        manifest = json.loads((out / 'M.json').read_text())
        assert label not in manifest['candidates'] and label not in manifest['arm_map']
        assert all(label not in cell['arms'] and label not in cell['arm_evidence'] for cell in manifest['cells'])
        assert all(x in manifest['candidates'] for x in mapping if x.startswith('X') and x != label)
    else:
        assert r.returncode == 2 and job in r.stdout, r.stdout
        assert not (out / 'MECH.json').exists() and not (out / 's2').exists()
(logs / 'A.queue.log').write_text('\n'.join(row for row in rows if not any(row.split()[0].removesuffix('=0').endswith('-' + mapping[x]) for x in ('X1', 'X2', 'X3'))) + '\n')
r, out = invoke(final, 'shipping-only')
assert r.returncode == 0, r.stdout
assert set(json.loads((out / 'M.json').read_text())['candidates']) == {'R', 'W1', 'W2'}
for label in ('X1', 'X2', 'X3'):
    assert f'{label}: informational: pending (0/8 cells)' in r.stdout
(logs / 'A.queue.log').write_text('\n'.join(rows) + '\n')
print('OPTIONAL_X_REQUIRED_W2_OK')
chains = temp / "chains with ' quote"
r, out = invoke(final, 'pass', '--install', chains, '--order-seed', '17')
assert r.returncode == 0 and r.stdout.endswith('D1_PASS\n'), r.stdout + r.stderr
summary = (out / 'summary.txt').read_text()
assert 'm=1.234567 t=9.876543' in summary and 'p99_latency=NOT_MEASURED' in summary
assert 'informational=True' in summary and 'F=R F2=W1' in summary
assert 'jobs=6 ETA_hours=15.00 job_hours=2.5' in summary
assert summary.count('mini-lane-start.sh') == 8 and summary.count('swap-waiter') == 4
for lane in 'ABCD':
    assert (chains / f'chain-{lane}S2/pending/s2-{lane}.txt').read_bytes() == (out / f's2/s2-{lane}.txt').read_bytes()
# Repeated installs cannot overwrite; preflight a hidden file in the LAST lane.
r, _ = invoke(final, 'occupied', '--install', chains)
assert r.returncode == 2 and 'destination not empty' in r.stdout
for lane in 'ABCD':
    assert (chains / f'chain-{lane}S2/pending/s2-{lane}.txt').read_bytes() == (temp / f'pass/s2/s2-{lane}.txt').read_bytes()
occupied = temp / 'hidden'
(occupied / 'chain-DS2/pending').mkdir(parents=True)
(occupied / 'chain-DS2/pending/.keep').write_text('keep')
r, _ = invoke(final, 'hidden-out', '--install', occupied)
assert r.returncode == 2 and not (occupied / 'chain-AS2').exists()
r, _ = invoke(final, 'dry-install', '--allow-partial', '--install', temp / 'never')
assert r.returncode == 2 and not (temp / 'never').exists()
r, out = invoke(final, 'dry-pass', '--allow-partial', '--lanes', 'A,B')
assert r.returncode == 0 and all(x.startswith('DRY_RUN ') for x in r.stdout.splitlines())
for path in out.rglob('*'):
    if path.suffix == '.json': assert json.loads(path.read_text())['DRY_RUN'] is True
    if path.suffix == '.txt': assert 'DRY_RUN' in path.read_text().splitlines()[0]
single = copy.deepcopy(v)
single['selection']['F2'] = None
set_verdict(single)
r, out = invoke(final, 'single', '--lanes', 'A,B')
assert r.returncode == 0 and r.stdout.count('jobs=8 ETA_hours=20.00') == 2
before = (out / 'summary.txt').read_bytes()
r, _ = invoke(final, 'single')
assert r.returncode == 2 and (out / 'summary.txt').read_bytes() == before
r, _ = invoke(final, 'bad-lanes', '--lanes', 'A,a')
assert r.returncode == 2
pending = copy.deepcopy(v)
pending['selection']['status'] = 'PENDING'
set_verdict(pending)
r, out = invoke(final, 'pending')
assert r.returncode == 2 and not (out / 's2').exists()
no_pass = copy.deepcopy(v)
no_pass['selection'].update(F=None, F2=None, decision='N4')
for cv in no_pass['candidates'].values(): cv['verdict'] = 'FAIL'
set_verdict(no_pass)
r, out = invoke(final, 'no-pass')
assert r.returncode == 0 and r.stdout.endswith('D1_NO_STAGE2\n') and 'ship S-00048' in r.stdout
assert not (out / 's2').exists()
bad = copy.deepcopy(v)
bad['selection']['F'] = 'X1'
set_verdict(bad)
r, _ = invoke(final, 'bad-selection')
assert r.returncode == 2 and 'stage2-plan refused' in r.stdout
# A failed extractor without MECH must stop, despite its expected rc=2.
(final / 'mechanism.py').write_text('import sys; sys.exit(2)\n')
r, out = invoke(final, 'no-mech')
assert r.returncode == 2 and not (out / 'VERDICT.json').exists()
(final / 'mechanism.py').write_text('''import sys
from pathlib import Path
Path(sys.argv[sys.argv.index('--out') + 1]).write_text('{broken')
sys.exit(2)
''')
r, out = invoke(final, 'malformed-dry', '--allow-partial')
assert r.returncode == 2 and json.loads((out / 'MECH.json').read_text())['DRY_RUN'] is True
print('D1_ORCHESTRATION_CONTROLS_OK')
