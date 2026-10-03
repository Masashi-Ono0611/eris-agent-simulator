#!/usr/bin/env bash
set -u
BASE_PORT=8547
PARALLEL=4
LABEL=
ROSTER=
REGIMES="calm cex-drift informed-flow whale lending-incident depeg crash vuln spike depeg-persist cdp-incident launch"
SEEDS=
usage() { echo 'Usage: run-matrix.sh --label NAME --roster FILE [--regimes "calm crash ..."] [--seeds "101 102"] [--parallel 3] [--base-port 8547]'; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --label|--roster|--regimes|--seeds|--parallel|--base-port)
      if [ "$#" -lt 2 ]; then echo "missing value for $1" >&2; exit 2; fi
      key=$1; val=$2; shift 2
      case "$key" in
        --label) LABEL=$val;; --roster) ROSTER=$val;; --regimes) REGIMES=$val;;
        --seeds) SEEDS=$val;; --parallel) PARALLEL=$val;; --base-port) BASE_PORT=$val;;
      esac;;
    --help|-h) usage; exit 0;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2;;
  esac
done
if [ -z "$LABEL" ] || [ -z "$ROSTER" ] || [ -z "$SEEDS" ]; then usage >&2; exit 2; fi
case "$PARALLEL" in ''|*[!0-9]*) echo "--parallel must be a positive integer" >&2; exit 2;; esac
if [ "$PARALLEL" -lt 1 ] || [ ! -f "$ROSTER" ]; then echo "invalid parallel count or missing roster" >&2; exit 2; fi
for regime in $REGIMES; do
  if [ ! -f "config/regimes/$regime.yaml" ]; then echo "unknown regime: $regime" >&2; exit 2; fi
done
case "$BASE_PORT" in ''|*[!0-9]*) echo "--base-port must be a positive integer" >&2; exit 2;; esac
# anvil leaks its per-block history under $HOME/.foundry/anvil/tmp (4-6.5 GB per 12-minute scenario; SIGTERM does not
# remove it; 50 runs filled a 460 GB disk on 2026-10-03 and killed a sweep). FOUNDRY_DIR is NOT honored (measured);
# HOME is. So every scenario runs anvil through ./anvil-shim with its own HOME under HOMES_ROOT, and that whole
# directory is deleted when the scenario ends. Ownership is exact (we created the directory), so no guessing about
# which leaked directory belongs to whom, and it is safe next to other projects' anvils and parallel invocations.
MIN_FREE_GB=${MIN_FREE_GB:-40}
case "$MIN_FREE_GB" in ''|*[!0-9]*) echo "MIN_FREE_GB must be a non-negative integer" >&2; exit 2;; esac
REAL_ANVIL=$(command -v anvil) || { echo "anvil not found in PATH" >&2; exit 2; }
SHIM_DIR="$(cd "$(dirname "$0")" && pwd)/anvil-shim"
if [ ! -x "$SHIM_DIR/anvil" ]; then echo "anvil shim missing or not executable: $SHIM_DIR/anvil" >&2; exit 2; fi
HOMES_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/ascon-anvil-homes.XXXXXX") || exit 2
# Delete a per-scenario anvil HOME. Only paths directly under HOMES_ROOT (created above) are ever removed.
remove_anvil_home() {
  case "$1" in "$HOMES_ROOT"/?*) python3 -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$1";; esac
}
cleanup_homes_root() {
  if [ -d "$HOMES_ROOT" ]; then
    left=$(find "$HOMES_ROOT" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')
    if [ "$left" -gt 0 ]; then echo "warning: $left anvil home dir(s) still under $HOMES_ROOT (anvil did not exit?); remove them by hand once no anvil runs" >&2
    else rmdir "$HOMES_ROOT" 2>/dev/null; fi
  fi
}
trap cleanup_homes_root EXIT
# Free space is measured where the history is written, and an unreadable measurement fails CLOSED.
free_gb() {
  out=$(df -k "$HOMES_ROOT" 2>/dev/null | awk 'NR == 2 {printf "%d", $4 / 1048576}')
  case "$out" in ''|*[!0-9]*) return 1;; esac
  echo "$out"
}
ensure_space() {
  have=$(free_gb) || { echo "ERROR: cannot measure free disk space; aborting (fail closed)" >&2; return 1; }
  if [ "$have" -lt "$MIN_FREE_GB" ]; then
    echo "ERROR: only ${have} GB free (need ${MIN_FREE_GB}); aborting before launching more backtests" >&2
    return 1
  fi
  return 0
}
OUT="ascon-notes/eval/out/$LABEL"
mkdir -p "$OUT"
TMP="$OUT/.matrix-tmp-$$"
mkdir "$TMP" || exit 2
printf 'regime\tseed\trun_dir\texit_code\n' > "$TMP/index.tsv"
run_one() {
  reg=$1; seed=$2; slot=$3
  logfile="$OUT/$reg-$seed.log"
  rowfile="$TMP/$reg-$seed.row"
  port=$((BASE_PORT + slot))
  ahome="$HOMES_ROOT/$reg-$seed"
  # BACKTEST_EXTRA_ARGS (optional, unquoted on purpose) lets tests add e.g. "--blocks 24 --seconds 70".
  ASCON_ANVIL_HOME="$ahome" ASCON_REAL_ANVIL="$REAL_ANVIL" PATH="$SHIM_DIR:$PATH" \
    npm run backtest -- --regime "$reg" --seed "$seed" --agents "$ROSTER" --agent-sandbox process --port "$port" --state backtest/state ${BACKTEST_EXTRA_ARGS:-} >"$logfile" 2>&1
  rc=$?
  # The backtest stops anvil with SIGTERM and returns; wait until that anvil is really gone before deleting its HOME.
  waited=0
  while pgrep -f "anvil --port $port( |\$)" >/dev/null 2>&1 && [ "$waited" -lt 30 ]; do sleep 1; waited=$((waited + 1)); done
  if pgrep -f "anvil --port $port( |\$)" >/dev/null 2>&1; then
    echo "warning: anvil on port $port still running after 30s; its HOME $ahome is NOT deleted" >&2
  else
    remove_anvil_home "$ahome"
  fi
run_dir=$(python3 - "$logfile" <<'PY'
import json, re, sys
found = None
try:
    for line in open(sys.argv[1], encoding='utf-8', errors='replace'):
        try: event = json.loads(line)
        except Exception: continue
        if event.get('type') == 'run_completed' and event.get('runDir'): found = event['runDir']
except OSError: pass
if not found:
    text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
    match = re.search(r'realtime simulation completed: (runs/[^\s(]+)', text)
    if match: found = match.group(1)
print(found or '')
PY
)
  if [ -z "$run_dir" ]; then
    run_dir=$(python3 - "$logfile" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8', errors='replace').read()
m = re.search(r'"runId"\s*:\s*"([^"]+)"', s)
print('runs/' + m.group(1) if m else '')
PY
)
  fi
  printf '%s\t%s\t%s\t%s\n' "$reg" "$seed" "$run_dir" "$rc" > "$rowfile"
  return 0
}
pids=
slot=0
failures=0
aborted=0
for regime in $REGIMES; do
  for seed in $SEEDS; do
    if [ "$slot" -eq 0 ] && ! ensure_space; then aborted=1; break 2; fi
    run_one "$regime" "$seed" "$slot" &
    pids="$pids $!"
    # Stagger launches: the backtest derives runs/<id> from a millisecond timestamp, so runs started in
    # the same instant collide on one directory (observed in r1: calm/cex-drift shared a run dir).
    sleep 3
    slot=$((slot + 1))
    if [ "$slot" -ge "$PARALLEL" ]; then
      for pid in $pids; do wait "$pid" || :; done
      pids=
      slot=0
    fi
  done
done
for pid in $pids; do wait "$pid" || :; done
if [ "$aborted" -eq 1 ]; then
  echo "ERROR: matrix aborted for lack of disk space; scenarios not yet run are recorded as failed" >&2
fi
for regime in $REGIMES; do
  for seed in $SEEDS; do
    rowfile="$TMP/$regime-$seed.row"
    if [ -f "$rowfile" ]; then
      cat "$rowfile" >> "$TMP/index.tsv"
      rc=$(awk -F '\t' '{print $4}' "$rowfile")
      if [ "$rc" -ne 0 ]; then failures=$((failures + 1)); fi
    else
      printf '%s\t%s\t\t127\n' "$regime" "$seed" >> "$TMP/index.tsv"
      failures=$((failures + 1))
    fi
  done
done
# A run directory claimed by two scenarios means their results overwrote each other: count as failures.
dups=$(awk -F '\t' 'NR > 1 && $3 != "" {n[$3]++} END {c = 0; for (k in n) if (n[k] > 1) c += n[k]; print c}' "$TMP/index.tsv")
if [ "$dups" -gt 0 ]; then
  echo "ERROR: $dups scenario(s) share a run directory (results are not trustworthy)" >&2
  failures=$((failures + dups))
fi
mv "$TMP/index.tsv" "$OUT/index.tsv"
rm -rf "$TMP"
echo "completed with $failures failed run(s); index: $OUT/index.tsv"
if [ "$failures" -gt 0 ]; then exit 1; fi
exit 0
