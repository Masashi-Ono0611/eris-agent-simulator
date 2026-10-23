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
# Red check: sharing deployment output must fail the isolation fixture.
python3 - "$dir/release-tools.py" "$tmp/shared-output.py" <<'PYCODE'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
old = "(tree / name).mkdir(parents=True)"
assert source.count(old) == 1
Path(sys.argv[2]).write_text(source.replace(old, "(tree / name).symlink_to(main_checkout / name, target_is_directory=True)"))
PYCODE
if python3 "$dir/test-release-tools.py" selftest "$tmp/shared-output.py" > "$tmp/shared-red.log" 2>&1; then
  echo "FAIL red check accepted shared deployments log=$tmp/shared-red.log"; exit 1
fi
grep -q 'AssertionError: True is not false : deployer/deployments' "$tmp/shared-red.log"
echo 'RED_OK shared-deployments mutation rejected'
# Red check: restoring the original whole-GMX link must corrupt only fixture
# sentinels and be rejected by the simulated-write test.
python3 - "$dir/release-tools.py" "$tmp/shared-gmx.py" <<'PYCODE'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
old = 'link_readonly_children(main_checkout / name, target, GMX_LOCAL_DIRS)'
assert source.count(old) == 1
Path(sys.argv[2]).write_text(source.replace(old,
    'target.symlink_to(main_checkout / name, target_is_directory=True)'))
PYCODE
if python3 "$dir/test-release-tools.py" selftest "$tmp/shared-gmx.py" > "$tmp/gmx-red.log" 2>&1; then
  echo "FAIL red check accepted shared GMX log=$tmp/gmx-red.log"; exit 1
fi
grep -q "AssertionError: 'deploy overwrite' != 'original'" "$tmp/gmx-red.log"
echo 'RED_OK shared-GMX simulated write mutation rejected'
echo ALL_CONTROLS_OK
