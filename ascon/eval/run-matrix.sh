#!/bin/bash
# Run one backtest matrix and say whether its results can be read.
#   ascon/eval/run-matrix.sh <name> <roster.yaml> <scenarios.yaml> <port> [state-dir]
# Writes $ASCON_EVAL_LOGS/<name>.log (default /tmp/ascon-exp) and appends one marker line:
#   EXIT_<name>=<backtest rc> VERDICT=<PASS|FAIL|BLOCKED> <why>
# Exit: 0 only on PASS; 1 FAIL (the run finished but its results are not complete); 2 BLOCKED.
#
# Why each check is here (each one was missed once):
# - `npm run backtest --scenarios` exits 0 even when every scenario failed (it prints FAILED and
#   moves on), so success is judged from matrix.json against the scenario file and the roster
#   (check-matrix.py), and a nonzero exit is a FAIL even when the output looks complete.
# - A fresh worktree has no forge artifacts (out/), state dump or node_modules; every scenario then
#   fails within seconds. They are checked before anything starts.
# - Two runs with the same (state dir, regime, seed) at once can swap rosters. Give each parallel
#   lane its own state dir (the 5th argument); a state dir or a name already in use is refused.
# - A state dir of its own is not enough: two runs started in the same millisecond share
#   runs/<start time> (upstream PR #324, not in this branch), and the PASS below still appears.
#   Start lanes at least 20 s apart and run check-collision.py on the matrix (lane-queue.sh does).
# - Under slot replacement (ascon/final) every arm's agent is `slot`, so this PASS cannot tell arms
#   apart either: run ascon/final/check-arm.py <matrix.json> <arm> (lane-queue.sh does).
# Logs default to /tmp/ascon-exp, which macOS cleans after 3 idle days: set ASCON_EVAL_LOGS for long runs.
set -u
name="${1:?name}"; roster="${2:?roster}"; scenarios="${3:?scenarios}"; port="${4:?port}"; state="${5:-}"
logs="${ASCON_EVAL_LOGS:-/tmp/ascon-exp}"
# Checked before any file is touched: the name becomes a path.
printf '%s\n' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*$' || { echo "BLOCKED: name must be [A-Za-z0-9_.-]"; exit 2; }
mkdir -p "$logs" || exit 2
log="$logs/$name.log"
name_lock="$logs/$name.lock"
mkdir "$name_lock" 2>/dev/null || { echo "EXIT_$name=- VERDICT=BLOCKED another run named $name is in progress ($name_lock)"; exit 2; }
state_lock=""
child=""
cleanup() {
  # The backtest runs in its own process group (set -m below), so this stops its anvil and agent
  # workers too, before the locks that keep a second run out are released.
  if [ -n "$child" ]; then
    kill -TERM -- "-$child" 2>/dev/null
    wait "$child" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 -- "-$child" 2>/dev/null || break
      sleep 1
    done
    kill -KILL -- "-$child" 2>/dev/null
  fi
  [ -n "$state_lock" ] && rmdir "$state_lock" 2>/dev/null
  rmdir "$name_lock" 2>/dev/null
}
trap cleanup EXIT
trap 'echo "EXIT_$name=- VERDICT=FAIL interrupted" >> "$log"; exit 1' INT TERM HUP
marker() { echo "EXIT_$name=$1 VERDICT=$2 $3" >> "$log"; echo "EXIT_$name=$1 VERDICT=$2 $3"; }
: > "$log"
block() { marker - BLOCKED "$1"; exit 2; }

printf '%s\n' "$port" | grep -Eq '^[0-9]+$' || block "port must be an integer"
[ -r "$roster" ] || block "roster not readable: $roster"
[ -r "$scenarios" ] || block "scenarios not readable: $scenarios"
[ -x node_modules/.bin/tsx ] || block "node_modules/.bin/tsx missing (run npm ci, or link node_modules)"
forge="${ERIS_FORGE_OUT:-out}"
[ -f "$forge/MockOracleProvider.sol/MockOracleProvider.json" ] || block "forge artifacts missing in $forge (npm run build:contracts, link out/, or set ERIS_FORGE_OUT)"
sdir="${state:-backtest/state}"
[ -f "$sdir/manifest.json" ] && [ -f "$sdir/venues-state.json" ] || block "state dump missing in $sdir"
mkdir "$sdir/.run-matrix.lock" 2>/dev/null || block "state dir in use by another run ($sdir/.run-matrix.lock); give this lane its own state dir"
state_lock="$sdir/.run-matrix.lock"

args=(--scenarios "$scenarios" --agents "$roster" --agent-sandbox process --port "$port")
[ -n "$state" ] && args+=(--state "$state")
set -m
npm run backtest -- "${args[@]}" >> "$log" 2>&1 &
child=$!
set +m
wait "$child"
rc=$?
child=""

matrix="$(grep -E '^wrote .+/matrix\.json and standings\.json$' "$log" | tail -1 | sed 's/^wrote //; s/ and standings\.json$//')"
[ -n "$matrix" ] && [ -f "$matrix" ] || { marker "$rc" FAIL "no matrix.json written"; exit 1; }
verdict="$(python3 "$(dirname "$0")/check-matrix.py" "$matrix" "$roster" "$scenarios" 2>&1)"
case "$verdict" in
  PASS*|FAIL*) ;;
  *) marker "$rc" FAIL "could not read $matrix: ${verdict:0:200}"; exit 1 ;;
esac
if [ "$rc" != 0 ]; then
  marker "$rc" FAIL "backtest exited $rc (${verdict})"
  exit 1
fi
marker "$rc" "${verdict%% *}" "${verdict#* }"
[ "${verdict%% *}" = PASS ] || exit 1
