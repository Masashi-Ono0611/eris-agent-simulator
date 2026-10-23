#!/bin/bash
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd -P)"
python3 "$dir/test-release-tools.py" selftest
# Red check: deliberately accept the log marker without deployments.json.
tmp="$(mktemp -d)"
python3 - "$dir/release-tools.py" "$tmp/broken.py" <<'PY'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
old = "'anvil is still running' in log and deployments.is_file()"
assert old in source
Path(sys.argv[2]).write_text(source.replace(old, "'anvil is still running' in log"))
PY
if python3 "$dir/test-release-tools.py" selftest "$tmp/broken.py" > "$tmp/red.log" 2>&1; then
  echo "FAIL red check accepted missing deployments.json log=$tmp/red.log"; exit 1
fi
grep -q 'AssertionError: Blocked not raised' "$tmp/red.log"
echo 'RED_OK missing-deployments mutation rejected'
echo ALL_CONTROLS_OK
