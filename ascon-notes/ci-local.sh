#!/bin/bash
# Reproduce CI locally from a CLEAN export of a commit, so the failure classes we hit on 2026-10-03 show up before a push:
#   - files only in the working tree (forgotten commit)      -> only tracked files at <ref> are exported
#   - host-dependent tests (free disk, absolute paths, HOME) -> clean env (env -i), small-disk `df` shim, temp HOME/TMPDIR
#   - stale tests after a code change                         -> --full runs the whole `npm test`; --quick runs all of OUR tests
#   - concurrent suites colliding on fixed anvil ports        -> refuses to run while another test run / anvil is alive
# usage: ci-local.sh [--ref <git-ref>] [--quick|--full] [--keep]     (default: --ref HEAD --quick)
# exit: 0 pass, 1 test failure, 2 cannot run (blocked)  -- BLOCKED is never PASS.
set -u
REF=HEAD MODE=quick KEEP=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ref) [ "$#" -ge 2 ] || { echo "--ref needs a value" >&2; exit 2; }; REF=$2; shift 2;;
    --quick) MODE=quick; shift;; --full) MODE=full; shift;; --keep) KEEP=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "BLOCKED: not in a git repo" >&2; exit 2; }
SHA="$(git -C "$ROOT" rev-parse --verify --quiet "${REF}^{commit}")" || { echo "BLOCKED: unknown ref: $REF" >&2; exit 2; }
# Run from a git hook: git exports GIT_DIR/GIT_INDEX_FILE/... pointing at the real repo. They must not leak into the temp repo below.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_ALTERNATE_OBJECT_DIRECTORIES
# Fixed-port collisions come from anvil and from a second full `npm test` (upstream tests bind fixed ports and then hang).
# Match real processes only: `pgrep -x anvil` and a command line that STARTS with "npm test" (a `codex exec` prompt that merely
# mentions "npm test" must not count). The quick suite binds no fixed ports, so it only warns.
# pgrep exits 0 (matches) or 1 (none); anything else means process inspection itself failed -> BLOCKED, never "idle".
pgrep -x anvil >/dev/null 2>&1; RC1=$?; pgrep -f '^npm test' >/dev/null 2>&1; RC2=$?
if [ "$RC1" -gt 1 ] || [ "$RC2" -gt 1 ]; then echo "BLOCKED: pgrep failed (rc=$RC1/$RC2); cannot tell whether another suite is running" >&2; exit 2; fi
BUSY="$(( $(pgrep -x anvil | wc -l) + $(pgrep -f '^npm test' | wc -l) ))"
if [ "$BUSY" != "0" ]; then
  if [ "$MODE" = "full" ]; then echo "BLOCKED: $BUSY anvil / npm-test process(es) running (fixed-port collisions hang the full suite). Wait for them or stop them yourself." >&2; exit 2; fi
  echo "note: $BUSY anvil / npm-test process(es) running; the quick suite binds no fixed ports, continuing."
fi
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ascon-ci-local.XXXXXX")" || exit 2
cleanup() { if [ "$KEEP" = "1" ]; then echo "kept: $TMP"; else python3 -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$TMP"; fi; }
trap cleanup EXIT
CO="$TMP/checkout"; mkdir -p "$CO" "$TMP/home" "$TMP/tmp" "$TMP/shim"
git -C "$ROOT" archive "$SHA" | tar -x -C "$CO" || { echo "BLOCKED: export failed" >&2; exit 2; }
( cd "$CO" && git init -q && git add -A >/dev/null 2>&1 && git -c user.name=ci -c user.email=ci@local commit -q -m "export $SHA" ) || { echo "BLOCKED: temp repo init failed" >&2; exit 2; }
# Dependencies: same lockfile as CI's `npm ci`; reuse the installed trees instead of installing (read-only use).
# The reused trees must match the export's lockfiles, otherwise a different --ref could PASS with deps CI would not install.
for lock in package-lock.json dashboard/package-lock.json deployer/package-lock.json; do
  if [ -e "$CO/$lock" ] && ! git -C "$ROOT" diff --quiet HEAD -- "$lock" 2>/dev/null; then echo "BLOCKED: $lock in the working tree differs from HEAD; reused node_modules may not match the ref" >&2; exit 2; fi
  if [ -e "$CO/$lock" ] && [ -e "$ROOT/$lock" ] && ! cmp -s "$CO/$lock" "$ROOT/$lock"; then echo "BLOCKED: $lock at $REF differs from the working tree's; reused node_modules may not match" >&2; exit 2; fi
done
for rel in node_modules dashboard/node_modules deployer/node_modules; do
  if [ -e "$ROOT/$rel" ] && [ ! -e "$CO/$rel" ]; then ln -s "$ROOT/$rel" "$CO/$rel"; fi
done
# CI runner has ~13 GB free; a roomy dev disk hides disk-dependent tests. `df` reports 13 GB here.
cat > "$TMP/shim/df" <<'DFEOF'
#!/bin/bash
echo "Filesystem 1024-blocks Used Available Capacity Mounted"
echo "ci-runner 99999999 0 13333888 0% /"
DFEOF
chmod +x "$TMP/shim/df"
# CI runs `pip install ./sdk-py -r sdk-py/requirements-dev.txt`; mirror it in a cached venv (never the global python).
VENV="${ASCON_CI_VENV:-$HOME/.cache/ascon-ci-venv}"
if [ "$MODE" = "full" ]; then
  if [ ! -x "$VENV/bin/python" ]; then python3 -m venv "$VENV" || { echo "BLOCKED: venv create failed" >&2; exit 2; }; fi
  "$VENV/bin/python" -m pip install -q "$CO/sdk-py" -r "$CO/sdk-py/requirements-dev.txt" || { echo "BLOCKED: pip install (sdk-py) failed" >&2; exit 2; }
  PY_DIR="$VENV/bin"
fi
# CI runs `npm run build:contracts` (forge build) before the tests; do it in the export (real HOME: forge needs its solc cache).
if [ "$MODE" = "full" ]; then
  command -v forge >/dev/null 2>&1 || { echo "BLOCKED: forge not installed (CI builds contracts)" >&2; exit 2; }
  ( cd "$CO" && forge build >/dev/null 2>&1 ) || { echo "BLOCKED: forge build failed in the export" >&2; exit 2; }
fi
NODE_DIR="$(dirname "$(command -v node)")"; PY_DIR="${PY_DIR:-$(dirname "$(command -v python3)")}"
EXTRA=""; for t in anvil forge; do p="$(command -v $t 2>/dev/null)"; [ -n "$p" ] && EXTRA="$EXTRA:$(dirname "$p")"; done
CI_PATH="$TMP/shim:$NODE_DIR:$PY_DIR$EXTRA:/usr/bin:/bin:/usr/sbin:/sbin"
echo "ci-local: ref=$REF sha=${SHA:0:7} mode=$MODE checkout=$CO (clean export of tracked files; env -i; df shim 13 GB)"
cd "$CO" || exit 2
run() { env -i HOME="$TMP/home" TMPDIR="$TMP/tmp" PATH="$CI_PATH" LANG=C CI=true "$@"; }
if [ "$MODE" = "full" ]; then
  run npm test; RC=$?
else
  # every test file of ours: league/harness/gate/tools, zeta-2 and the six league players, plus the python suites they wrap
  for req in test/zeta-2.test.ts test/astra-1.test.ts test/astra-2.test.ts test/sonnet-1.test.ts test/sonnet-2.test.ts test/opus-1.test.ts test/grok-1.test.ts; do
    [ -f "$req" ] || { echo "BLOCKED: required suite missing at $REF: $req" >&2; exit 2; }
  done
  FILES="$(ls test/ascon-*.test.ts test/zeta-2.test.ts test/astra-1.test.ts test/astra-2.test.ts test/sonnet-1.test.ts test/sonnet-2.test.ts test/opus-1.test.ts test/grok-1.test.ts 2>/dev/null | tr '\n' ' ')"
  [ -n "$FILES" ] || { echo "BLOCKED: no test files found at $REF" >&2; exit 2; }
  # shellcheck disable=SC2086
  run node --import tsx --test $FILES; RC=$?
fi
if [ "$RC" -eq 0 ]; then echo "ci-local: PASS ($MODE @ ${SHA:0:7})"; exit 0; fi
echo "ci-local: FAIL ($MODE @ ${SHA:0:7}) exit=$RC" >&2; exit 1
