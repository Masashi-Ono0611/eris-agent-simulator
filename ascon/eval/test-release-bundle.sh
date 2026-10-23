#!/bin/bash
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd -P)"
python3 "$dir/test-release-tools.py" bundle
# Red check: a broken verifier silently omits files absent from the archive.
tmp="$(mktemp -d)"
python3 - "$dir/release-tools.py" "$tmp/broken.py" <<'PY'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
old = "            if p.is_symlink() or name not in names"
assert old in source
Path(sys.argv[2]).write_text(source.replace(old, "            if name not in names:\n                continue\n" + old))
PY
if python3 "$dir/test-release-tools.py" bundle "$tmp/broken.py" > "$tmp/red.log" 2>&1; then
  echo "FAIL red check accepted missing ZIP member log=$tmp/red.log"; exit 1
fi
grep -q 'AssertionError: ValueError not raised' "$tmp/red.log"
echo 'RED_OK missing-member mutation rejected'
echo ALL_CONTROLS_OK
