#!/bin/bash
set -eu
export PYTHONDONTWRITEBYTECODE=1
src="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/normal"
python3 "$src/ascon/final/test-evidence.py" "$src/ascon/final" "$tmp/normal"
# One real mutation per extractor: the tests must turn red.
for target in manifest mechanism; do
  mkdir "$tmp/$target" "$tmp/$target-work"
  cp "$src/ascon/final/"{make-manifest,mechanism,judge2}.py "$tmp/$target/"
  python3 - "$tmp/$target" "$target" <<'PY'
from pathlib import Path
import sys
root, kind = Path(sys.argv[1]), sys.argv[2]
p = root / ('make-manifest.py' if kind == 'manifest' else 'mechanism.py')
s = p.read_text()
old, new = ('chosen = max(passes,', 'chosen = min(passes,') if kind == 'manifest' else ('timeouts += int(', 'timeouts += 0 * int(')
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
