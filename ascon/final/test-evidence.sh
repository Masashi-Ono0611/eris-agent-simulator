#!/bin/bash
set -eu
export PYTHONDONTWRITEBYTECODE=1
src="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/normal"
python3 "$src/ascon/final/test-evidence.py" "$src/ascon/final" "$tmp/normal"
# One real mutation per extractor, plus missing stage-2/retest coverage.
for target in manifest mechanism stage2 retest; do
  mkdir "$tmp/$target" "$tmp/$target-work"
  cp "$src/ascon/final/"{make-manifest,mechanism,judge2,stage2-plan}.py "$tmp/$target/"
  cp "$src/ascon/final/"*.yaml "$tmp/$target/"
  python3 - "$tmp/$target" "$target" <<'PY'
from pathlib import Path
import sys
root, kind = Path(sys.argv[1]), sys.argv[2]
p = root / ('mechanism.py' if kind == 'mechanism' else 'make-manifest.py')
s = p.read_text()
old, new = ('if len(passes) > 1:', 'if len(passes) > 100:') if kind == 'manifest' else ('timeouts += int(', 'timeouts += 0 * int(')
if kind == 'stage2':
    old, new = ("+ [(seed, 'FS') for seed in judge2.FS_SEEDS]", '+ []')
if kind == 'retest':
    old, new = ("judge2.PLAN_SEEDS['retest'][0]", 'range(1021, 1025)')
assert old in s
p.write_text(s.replace(old, new))
PY
  if python3 "$src/ascon/final/test-evidence.py" "$tmp/$target" "$tmp/$target-work" "$target" > "$tmp/$target-red.log" 2>&1; then
    echo "FAIL red check survived: $target"; exit 1
  fi
  grep -q AssertionError "$tmp/$target-red.log" || { cat "$tmp/$target-red.log"; exit 1; }
  echo "RED_CHECK_OK $target (deliberate mutation caught)"
done
echo ALL_CONTROLS_OK
