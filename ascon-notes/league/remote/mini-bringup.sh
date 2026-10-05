#!/bin/bash
# Run ON the mini. No sudo, shell profile, auto-install, remote contact or launchd load.
set -u
FOUNDRY=0 NPM=0 MISSING=0
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-foundry) FOUNDRY=1; shift ;;
    --npm-ci) NPM=1; shift ;;
    *) echo "usage: $0 [--install-foundry] [--npm-ci]" >&2; exit 2 ;;
  esac
done
export PATH="$HOME/ascon-run/bin:$HOME/.homebrew/bin:$HOME/.foundry/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
if [ -f "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" --no-use
  if ! nvm use --silent default >/dev/null 2>&1; then
    echo 'MISSING: nvm default node (install/select explicitly)'; MISSING=1
  fi
else
  echo 'MISSING: ~/.nvm/nvm.sh'; MISSING=1
fi
if [ "$FOUNDRY" -eq 1 ]; then
  if command -v brew >/dev/null 2>&1; then
    if ! command -v forge >/dev/null 2>&1 || ! command -v anvil >/dev/null 2>&1; then
      HOMEBREW_NO_AUTO_UPDATE=1 brew install foundry || exit 2
    fi
  else echo 'MISSING: brew; install manually without sudo'; MISSING=1; fi
fi
for tool in brew forge anvil node npm python3 git rsync; do
  if command -v "$tool" >/dev/null 2>&1; then echo "OK: $tool";
  else echo "MISSING: $tool"; MISSING=1; fi
done
# The Air state dump and calibration use anvil 1.2.3 (commit a813a2ce); another version cannot load that dump.
if command -v anvil >/dev/null 2>&1; then
  if anvil --version 2>/dev/null | grep -q 'a813a2cee7dd4926e7c56fd8a785b54f32e0d10f'; then echo 'OK: anvil 1.2.3 (a813a2ce)';
  else echo 'MISSING: anvil must be 1.2.3 commit a813a2ce (see README-RUNBOOK)'; MISSING=1; fi
fi
if command -v node >/dev/null 2>&1; then
  NODE_PATH=$(command -v node)
  case "$NODE_PATH" in "$NVM_DIR"/versions/node/*/bin/node) echo 'OK: node via nvm' ;; *) echo 'MISSING: active nvm node'; MISSING=1 ;; esac
  node --version
fi
if command -v python3 >/dev/null 2>&1; then
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || { echo 'MISSING: Python >=3.9'; MISSING=1; }
fi
# Validate locally; never print a remote URL that might contain credentials.
if git -C "$REPO" remote get-url origin 2>/dev/null | python3 -c 'import re,sys; sys.exit(0 if re.fullmatch(r"(?:git@github.com:|ssh://git@github.com/)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\n?",sys.stdin.read()) else 1)'; then
  echo 'OK: origin is GitHub SSH (connectivity NOT tested)'
else echo 'MISSING: expected GitHub SSH origin'; MISSING=1; fi
if [ "$NPM" -eq 1 ]; then
  [ ! -d "$HOME/ascon-run/host.lock" ] || { echo 'STOP: queue runner lock exists'; exit 2; }
  pgrep -x anvil >/dev/null 2>&1; A=$?
  pgrep -f '(^|[ /])run-matrix\.sh([ ]|$)' >/dev/null 2>&1; B=$?
  [ "$A" -eq 1 ] && [ "$B" -eq 1 ] || { echo 'STOP: host busy or process inspection failed'; exit 2; }
  (cd "$REPO" && NPM_CONFIG_IGNORE_SCRIPTS=true npm ci) || exit 2
fi
if [ ! -d "$REPO/node_modules" ]; then echo 'MISSING: dependencies; explicit --npm-ci required'; MISSING=1; fi
echo 'CHECK MANUALLY: free output/TMP >=40 GiB at start, stop below25 GiB; no competing workload during G0'
echo 'CHECK MANUALLY: pinned commit/rosters, contracts/solc cache, mini OWN load-probe G0, launchd login/reboot behavior'
echo 'No simulations started. Existing gbrain/openclaw services untouched.'
exit "$MISSING"
