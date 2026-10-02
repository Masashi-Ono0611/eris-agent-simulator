#!/usr/bin/env bash
set -u
BASE_PORT=8547
PARALLEL=4
LABEL=
ROSTER=
REGIMES="calm cex-drift informed-flow whale lending-incident depeg crash vuln spike depeg-persist cdp-incident launch"
SEEDS=
usage() { echo 'Usage: run-matrix.sh --label NAME --roster FILE [--regimes "calm crash ..."] [--seeds "101 102"] [--parallel 4]'; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --label|--roster|--regimes|--seeds|--parallel)
      if [ "$#" -lt 2 ]; then echo "missing value for $1" >&2; exit 2; fi
      key=$1; val=$2; shift 2
      case "$key" in
        --label) LABEL=$val;; --roster) ROSTER=$val;; --regimes) REGIMES=$val;;
        --seeds) SEEDS=$val;; --parallel) PARALLEL=$val;;
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
OUT="ascon-notes/eval/out/$LABEL"
mkdir -p "$OUT"
TMP="$OUT/.matrix-tmp-$$"
mkdir "$TMP" || exit 2
printf 'regime\tseed\trun_dir\texit_code\n' > "$TMP/index.tsv"
run_one() {
  reg=$1; seed=$2; slot=$3
  logfile="$OUT/$reg-$seed.log"
  rowfile="$TMP/$reg-$seed.row"
  npm run backtest -- --regime "$reg" --seed "$seed" --agents "$ROSTER" --agent-sandbox process --port "$((BASE_PORT + slot))" --state backtest/state >"$logfile" 2>&1
  rc=$?
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
for regime in $REGIMES; do
  for seed in $SEEDS; do
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
