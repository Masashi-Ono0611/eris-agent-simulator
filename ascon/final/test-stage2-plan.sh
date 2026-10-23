#!/bin/bash
set -eu
export PYTHONDONTWRITEBYTECODE=1
src="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/good" "$tmp/red" "$tmp/red-work"
python3 "$src/ascon/final/test-stage2-plan.py" "$src/ascon/final" "$tmp/good"
cp "$src/ascon/final/"{stage2-plan,judge2,make-queues}.py "$tmp/red/"
python3 - "$tmp/red/stage2-plan.py" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]); s = p.read_text()
old = "return ['B'] + names, mapping"
assert old in s
p.write_text(s.replace(old, "return ['B', \"B'\"] + names, mapping"))
PY
if python3 "$src/ascon/final/test-stage2-plan.py" "$tmp/red" "$tmp/red-work" > "$tmp/red.log" 2>&1; then
  echo 'FAIL red mutation survived'; exit 1
fi
grep -q AssertionError "$tmp/red.log"
echo RED_CHECK_OK_stage2_plan
echo ALL_CONTROLS_OK
