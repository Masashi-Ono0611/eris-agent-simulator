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
echo ALL_CONTROLS_OK
