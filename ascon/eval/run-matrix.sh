#!/bin/bash
# Run one backtest matrix and say whether its results can be read.
#   ascon/eval/run-matrix.sh <name> <roster.yaml> <scenarios.yaml> <port> [state-dir]
# Writes $ASCON_EVAL_LOGS/<name>.log (default /tmp/ascon-exp) and appends one marker line:
#   EXIT_<name>=<backtest rc> VERDICT=<PASS|FAIL|BLOCKED> <why>
# Exit: 0 only on PASS; 1 FAIL (the run finished but its results are not complete); 2 BLOCKED.
#
# Why each check is here (each one was missed once):
# - `npm run backtest --scenarios` exits 0 even when every scenario failed (it prints FAILED and
#   moves on), so success is judged from matrix.json: every planned scenario has results, and every
#   result has the roster's agent count.
# - A fresh worktree has no forge artifacts (out/), state dump or node_modules; every scenario then
#   fails within seconds. They are checked before anything starts.
# - Two runs with the same (state dir, regime, seed) at once can swap rosters. Give each parallel
#   lane its own state dir (the 5th argument); this script refuses a state dir already in use.
set -u
name="${1:?name}"; roster="${2:?roster}"; scenarios="${3:?scenarios}"; port="${4:?port}"; state="${5:-}"
logs="${ASCON_EVAL_LOGS:-/tmp/ascon-exp}"
log="$logs/$name.log"
mkdir -p "$logs" || exit 2
marker() { echo "EXIT_$name=$1 VERDICT=$2 $3" >> "$log"; echo "EXIT_$name=$1 VERDICT=$2 $3"; }
block() { : > "$log"; marker - BLOCKED "$1"; exit 2; }

printf '%s\n' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*$' || block "name must be [A-Za-z0-9_.-]"
printf '%s\n' "$port" | grep -Eq '^[0-9]+$' || block "port must be an integer"
[ -r "$roster" ] || block "roster not readable: $roster"
[ -r "$scenarios" ] || block "scenarios not readable: $scenarios"
[ -x node_modules/.bin/tsx ] || block "node_modules/.bin/tsx missing (run npm ci, or link node_modules)"
forge="${ERIS_FORGE_OUT:-out}"
[ -f "$forge/MockOracleProvider.sol/MockOracleProvider.json" ] || block "forge artifacts missing in $forge (npm run build:contracts, link out/, or set ERIS_FORGE_OUT)"
sdir="${state:-backtest/state}"
[ -f "$sdir/manifest.json" ] && [ -f "$sdir/venues-state.json" ] || block "state dump missing in $sdir"
lock="$sdir/.run-matrix.lock"
mkdir "$lock" 2>/dev/null || block "state dir in use by another run ($lock); give this lane its own state dir"
trap 'rmdir "$lock" 2>/dev/null' EXIT

args=(--scenarios "$scenarios" --agents "$roster" --agent-sandbox process --port "$port")
[ -n "$state" ] && args+=(--state "$state")
npm run backtest -- "${args[@]}" > "$log" 2>&1
rc=$?

matrix="$(grep -oE 'wrote [^ ]+/matrix\.json' "$log" | tail -1 | sed 's/^wrote //')"
[ -n "$matrix" ] && [ -f "$matrix" ] || { marker "$rc" FAIL "no matrix.json written"; exit 1; }
verdict="$(python3 "$(dirname "$0")/check-matrix.py" "$matrix" "$roster" 2>&1)"
case "$verdict" in
  PASS*|FAIL*) ;;
  *) marker "$rc" FAIL "could not read $matrix: ${verdict:0:200}"; exit 1 ;;
esac
marker "$rc" "${verdict%% *}" "${verdict#* }"
[ "${verdict%% *}" = PASS ] && [ "$rc" = 0 ] || exit 1
