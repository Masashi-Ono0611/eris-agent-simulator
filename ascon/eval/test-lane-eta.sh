#!/bin/bash
set -eu
export PYTHONDONTWRITEBYTECODE=1
src="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/good" "$tmp/red-work"
python3 "$src/ascon/eval/test-lane-eta.py" "$src/ascon/eval/lane-eta.py" "$tmp/good"
python3 - "$src/ascon/eval/lane-eta.py" "$tmp/lane-eta.py" <<'PY'
from pathlib import Path
import sys
s = Path(sys.argv[1]).read_text()
old = 'ignored = superseded(runs)'
assert old in s
Path(sys.argv[2]).write_text(s.replace(old, 'ignored = set()'))
PY
if python3 "$src/ascon/eval/test-lane-eta.py" "$tmp/lane-eta.py" "$tmp/red-work" > "$tmp/red.log" 2>&1; then
  echo 'FAIL red mutation survived'; exit 1
fi
grep -q AssertionError "$tmp/red.log"
echo RED_CHECK_OK_lane_eta
# Each regression has its own mutation and must fail at an assertion.
for case in mean next; do
  mkdir "$tmp/good-$case" "$tmp/red-$case"
  python3 "$src/ascon/eval/test-lane-eta.py" "$src/ascon/eval/lane-eta.py" "$tmp/good-$case" "$case"
  python3 - "$src/ascon/eval/lane-eta.py" "$tmp/$case.py" "$case" <<'PYM'
from pathlib import Path
import sys
s = Path(sys.argv[1]).read_text()
if sys.argv[3] == 'mean':
    old, new = "and passed(rec) and job.startswith('s1-')", "and job.startswith('s1-')"
else:
    old, new = 'pending += next_pending', 'pending += 0'
assert old in s
Path(sys.argv[2]).write_text(s.replace(old, new))
PYM
  if python3 "$src/ascon/eval/test-lane-eta.py" "$tmp/$case.py" "$tmp/red-$case" "$case" > "$tmp/red-$case.log" 2>&1; then
    echo "FAIL $case red mutation survived"; exit 1
  fi
  grep -q AssertionError "$tmp/red-$case.log"
  echo "RED_CHECK_OK_lane_eta_$case"
done
# A promoted swap directory is current inventory, not a next queue.
python3 - "$src/ascon/eval/lane-eta.py" "$tmp/promoted" <<'PYR'
from pathlib import Path
import subprocess
import sys

script, root = map(Path, sys.argv[1:])
logs = root / 'logs'
logs.mkdir(parents=True)
for lane in ('A', 'B', 'B2', 'E'):
    for state in ('pending', 'running'):
        (root / f'chain-{lane}' / state).mkdir(parents=True)
current = root / 'chain-B2'
stem = '30-s1-r3k'
jobs = [f's1-{seed}-ascon-zeta-r3k' for seed in ('FD1003', 'FP1004', 'FD1005', 'FP1006')]
queue = ''.join(f'{job} r arm s\n' for job in jobs)
(current / 'running' / f'{stem}.txt').write_text(queue)
(root / 'chain-A/pending' / f'{stem}.txt').write_text('s1-FP1003-ascon-zeta-r3k r arm s\n')
rid = f'B-9e332b3e-{stem}'
other = f'E-9da19bf2-{stem}'
old = f'B-old-{stem}'
def start(lane, run):
    return f'QUEUE_START_{lane} run={run} 2026-10-24T04:06:44 jobs=4 queue=/remote/running/{stem}.txt\n'
def end(job, run):
    return f'EXIT_{job}=1 VERDICT=FAIL COLLISION=PASS ARM=PASS run={run}\n'
# Older same-lane and other-lane exits must not finish this run's jobs.
(logs / 'B.queue.log').write_text(start('B', old) + ''.join(end(j, old) for j in jobs) + start('B', rid))
(logs / 'E.queue.log').write_text(start('E', other) + end('s1-FP1003-ascon-zeta-r3k', other)
                                  + ''.join(end(j, other) for j in jobs) + f'STOPPED_E run={other}\n')
(logs / 'B.chain.log').write_text(
    f'CHAIN_START_B 2026-10-24T03:00:00 pid=1 dir={root / "chain-B"}\n'
    f'CHAIN_QUEUE_B file={stem}.txt run={old}\n'
    f'CHAIN_START_B 2026-10-24T04:06:44 pid=43061 dir={current}\n'
    f'CHAIN_QUEUE_B file={stem}.txt run={rid}\n')
cmd = [sys.executable, str(script), '--logs', str(logs), '--chains', str(root)]
def check(remaining, pending, extra=()):
    result = subprocess.run(cmd + list(extra), capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    line = next(line for line in result.stdout.splitlines() if line.startswith('B: done_PASS='))
    assert f'running_remaining={remaining} pending={pending}' in line, result.stdout
    assert 'B: auto-detected next queue' not in result.stdout, result.stdout
    assert 'next_queues=' not in result.stdout, result.stdout
    print(line)
check(4, 0)
# Explicit --next must also exclude the active directory, including aliases.
(current / 'pending/later.txt').write_text('s1-later r arm s\n')
check(4, 1, ['--next', f'B={current / ".." / "chain-B2"}'])
# Only this run's EXIT subtracts from its running file.
with (logs / 'B.queue.log').open('a') as out:
    out.write(end(jobs[0], rid))
check(3, 1)
print('REGRESSION_OK_lane_eta_promoted_running')
PYR
echo ALL_CONTROLS_OK
