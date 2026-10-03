#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BASE_PORT=8547
N= P= DRY=0 LABEL="load-probe-$(date +%Y%m%d-%H%M%S)"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agents|--parallel|--label|--base-port) [ "$#" -ge 2 ] || exit 2; key=$1; val=$2; case "$key" in --agents) N=$val;; --parallel) P=$val;; --label) LABEL=$val;; --base-port) BASE_PORT=$val;; esac; shift 2;;
    --dry-run) DRY=1; shift;; *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
case "$N" in 8|12|16) ;; *) echo "--agents must be 8, 12, or 16" >&2; exit 2;; esac
case "$P" in 1|2|3|4|5|6|7|8) ;; *) echo "--parallel must be 1 through 8" >&2; exit 2;; esac
case "$BASE_PORT" in ''|*[!0-9]*) echo "invalid --base-port" >&2; exit 2;; esac
if [ "${#BASE_PORT}" -gt 5 ]; then echo "invalid --base-port" >&2; exit 2; fi
BASE_PORT=$((10#$BASE_PORT))
if [ "$BASE_PORT" -lt 1 ] || [ $((BASE_PORT + P)) -gt 65535 ]; then
  echo "port preflight FAIL: base-port + parallel must be <= 65535" >&2; exit 1
fi
case "$LABEL" in ''|*[!A-Za-z0-9_-]*) echo "invalid --label" >&2; exit 2;; esac
# Measure both output and Anvil-history filesystems before creating even the roster.
# GB here follows run-matrix's GiB convention (2^30 bytes), conservatively.
REQUIRED_KB=$((P * 6815744 + 20971520))
for DISK_PATH in "$ROOT" "${TMPDIR:-/tmp}"; do
  DF_OUTPUT=$(LC_ALL=C df -Pk "$DISK_PATH" 2>/dev/null) || { echo "disk preflight BLOCKED: df failed" >&2; exit 1; }
  FREE_KB=$(printf '%s\n' "$DF_OUTPUT" | awk 'NR == 2 {print $4}')
  case "$FREE_KB" in ''|*[!0-9]*) echo "disk preflight BLOCKED: unreadable df" >&2; exit 1;; esac
  if [ "$FREE_KB" -lt "$REQUIRED_KB" ]; then
    echo "disk preflight FAIL: $DISK_PATH available=${FREE_KB} KiB required=${REQUIRED_KB} KiB" >&2; exit 1
  fi
  echo "disk preflight PASS: $DISK_PATH available=${FREE_KB} KiB required=${REQUIRED_KB} KiB"
done
echo "port preflight PASS: base=$BASE_PORT reserved-through=$((BASE_PORT + P))"
if command -v memory_pressure >/dev/null 2>&1; then
  PRESSURE=$(memory_pressure -Q 2>/dev/null) || PRESSURE=
  PERCENT=$(printf '%s\n' "$PRESSURE" | awk '/System-wide memory free percentage:/ {gsub(/%/, "", $NF); print $NF}')
  case "$PERCENT" in ''|*[!0-9]*) echo "memory pressure: 取得不能";;
    *) echo "memory free percentage: $PERCENT%"; if [ "$PERCENT" -lt 10 ]; then echo "WARNING: memory pressure (free <10%)" >&2; fi;; esac
else
  echo "memory pressure: 取得不能"
fi
if command -v vm_stat >/dev/null 2>&1; then
  vm_stat 2>/dev/null | awk '/Pages occupied by compressor|Swapins|Swapouts/ {print "memory snapshot: " $0}'
fi
SEEDS=$(seq 101 $((100+P)) | tr '\n' ' ')
# Reference agents are checked before the dry-run exit: a dry run that cannot succeed for real must not report success.
for REF in multi-arb clean-arb noop venue-arb; do
  [ -d "$ROOT/example/agents/$REF" ] || { echo "missing reference: $REF" >&2; exit 2; }
done
if [ "$DRY" -eq 1 ]; then
  echo "DRY RUN: agents=$N parallel=$P; generated roster (no file created)"
  echo "DRY RUN: $ROOT/ascon-notes/eval/run-matrix.sh --label $LABEL --roster <generated> --regimes calm --seeds \"$SEEDS\" --parallel $P --base-port $BASE_PORT"
  exit 0
fi
# Existing matrix performs another disk check at each batch; round up its integer threshold.
MIN_FREE_GB=$(((REQUIRED_KB + 1048575) / 1048576))
export MIN_FREE_GB
ROSTER=$(mktemp "$ROOT/ascon-notes/league/load-probe-roster.XXXXXX") || exit 2
trap 'rm -f "$ROSTER"' EXIT
python3 - "$ROOT" "$ROSTER" "$N" <<'PY' || exit 2
import sys
from pathlib import Path
root,out,n=Path(sys.argv[1]),Path(sys.argv[2]),int(sys.argv[3]); refs=["multi-arb","clean-arb","noop","venue-arb"]
for x in refs:
    if not (root/"example/agents"/x).is_dir(): raise SystemExit(f"missing reference: {x}")
lines=["agents:"]
for i in range(n):
    aid=f"probe-{i+1}"; ref=refs[i%len(refs)]
    lines += [f"  - id: {aid}","    wallet: AUTO",f"    dir: {ref}"]
out.write_text("\n".join(lines)+"\n",encoding="utf-8")
PY
cd "$ROOT" || exit 2
SEEDS=$(seq 101 $((100+P)) | tr '\n' ' ')
bash ascon-notes/eval/run-matrix.sh --label "$LABEL" --roster "$ROSTER" --regimes calm --seeds "$SEEDS" --parallel "$P" --base-port "$BASE_PORT" || exit $?
OUT="$ROOT/ascon-notes/eval/out/$LABEL"
python3 - "$OUT/index.tsv" <<'PY'
import csv,json,sys
from pathlib import Path
print("regime\tseed\tloopIterations\tblocksProcessed\tduration_seconds")
for row in csv.DictReader(open(sys.argv[1]),delimiter="\t"):
    p=Path(row["run_dir"]); p=p if p.is_absolute() else Path.cwd()/p
    try:
        s=json.loads((p/"summary.json").read_text()); loops=s.get("loopIterations","欠測"); blocks=s.get("blocksProcessed","欠測"); dur=(s["elapsedMs"]/1000 if isinstance(s.get("elapsedMs"),(int,float)) else "欠測")
    except Exception: loops=blocks=dur="欠測"
    print(f"{row['regime']}\t{row['seed']}\t{loops}\t{blocks}\t{dur}")
PY
