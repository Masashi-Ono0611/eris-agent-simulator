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
old = 'prepare_private_gmx(main_checkout / name, target)'
assert source.count(old) == 1
Path(sys.argv[2]).write_text(source.replace(old,
    'target.symlink_to(main_checkout / name, target_is_directory=True)'))
PYCODE
if python3 "$dir/test-release-tools.py" selftest "$tmp/shared-gmx.py" > "$tmp/gmx-red.log" 2>&1; then
  echo "FAIL red check accepted shared GMX log=$tmp/gmx-red.log"; exit 1
fi
grep -q "AssertionError: 'deploy overwrite' != 'original'" "$tmp/gmx-red.log"
echo 'RED_OK shared-GMX simulated write mutation rejected'
# Red check: reproduce the previous selective source symlinks. Mutable outputs
# remain private, but Node realpath makes __dirname read checkout A's sentinel.
python3 - "$dir/release-tools.py" "$tmp/source-links.py" <<'PYCODE'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
old = 'prepare_private_gmx(main_checkout / name, target)'
assert source.count(old) == 1
legacy = '''
def old_source_links(source, target, local_dirs=(
        'deployments/localhost', 'cache', 'artifacts', 'typechain', 'typechain-types')):
    target.mkdir(parents=True, exist_ok=True)
    branches = {name.split('/')[0] for name in local_dirs}
    if source.is_dir():
        for child in source.iterdir():
            if child.name not in branches:
                (target / child.name).symlink_to(child.absolute(), target_is_directory=child.is_dir())
    for branch in sorted(branches):
        nested = tuple(name.split('/', 1)[1] for name in local_dirs if name.startswith(branch + '/'))
        if nested:
            old_source_links(source / branch, target / branch, nested)
        elif branch == 'localhost':
            (target / branch).mkdir()
        else:
            seed_build_output(source / branch, target / branch)

'''
# Leave cache empty so the regression reaches the actual Node __dirname assertion.
legacy = legacy.replace("elif branch == 'localhost':", "elif branch in ('localhost', 'cache'):")
source = source.replace('\ndef prepare_deployer(', '\n' + legacy + 'def prepare_deployer(')
Path(sys.argv[2]).write_text(source.replace(old, 'old_source_links(main_checkout / name, target)'))
PYCODE
if python3 "$dir/test-release-tools.py" selftest "$tmp/source-links.py" > "$tmp/source-links-red.log" 2>&1; then
  echo "FAIL red check accepted GMX source symlinks log=$tmp/source-links-red.log"; exit 1
fi
grep -q "AssertionError: 'checkout A' != 'throwaway tree'" "$tmp/source-links-red.log"
grep -q '^ : GMX __dirname escaped' "$tmp/source-links-red.log"
echo 'RED_OK GMX source-symlink __dirname mutation rejected (checkout A != throwaway tree)'
echo ALL_CONTROLS_OK
