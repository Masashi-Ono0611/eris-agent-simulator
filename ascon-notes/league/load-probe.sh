#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
N= P= DRY=0 LABEL="load-probe-$(date +%Y%m%d-%H%M%S)"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agents|--parallel|--label) [ "$#" -ge 2 ] || exit 2; key=$1; val=$2; case "$key" in --agents) N=$val;; --parallel) P=$val;; --label) LABEL=$val;; esac; shift 2;;
    --dry-run) DRY=1; shift;; *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
case "$N" in 8|12|16) ;; *) echo "--agents must be 8, 12, or 16" >&2; exit 2;; esac
case "$P" in 1|2|3) ;; *) echo "--parallel must be 1, 2, or 3" >&2; exit 2;; esac
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
if [ "$DRY" -eq 1 ]; then
  echo "DRY RUN: $ROOT/ascon-notes/eval/run-matrix.sh --label $LABEL --roster $ROSTER --regimes calm --seeds \"$(seq 101 $((100+P)) | tr '\n' ' ')\" --parallel $P"
  exit 0
fi
cd "$ROOT" || exit 2
SEEDS=$(seq 101 $((100+P)) | tr '\n' ' ')
bash ascon-notes/eval/run-matrix.sh --label "$LABEL" --roster "$ROSTER" --regimes calm --seeds "$SEEDS" --parallel "$P" || exit $?
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
