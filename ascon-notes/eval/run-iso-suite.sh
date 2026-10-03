#!/usr/bin/env bash
# Isolated-candidate evaluation: each candidate alone (plus references and a no-bid clone) in its own world.
# Runs the candidates two at a time (two run-matrix.sh invocations on different port ranges), 12 regimes each.
# Usage: run-iso-suite.sh [--seeds "101"] [--parallel 3]   (run from the repo root, under caffeinate)
set -u
SEEDS="101"
PARALLEL=3
while [ "$#" -gt 0 ]; do
  case "$1" in
    --seeds) SEEDS=$2; shift 2;;
    --parallel) PARALLEL=$2; shift 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
RM="ascon-notes/eval/run-matrix.sh"
failures=0
pair() {
  # $1,$2 = candidate names (roster-iso-<name>.yaml); labels iso-<name>-s<seeds-with-underscores>
  a=$1; b=$2
  # Seeds are part of the label so a re-run with other seeds never overwrites an earlier index.
  # (The first batch, seed 101 only, was labeled iso-<name> without a suffix.)
  suffix="s$(echo "$SEEDS" | tr ' ' '_')"
  la="iso-$a-$suffix"; lb="iso-$b-$suffix"
  bash "$RM" --label "$la" --roster "ascon-notes/roster-iso-$a.yaml" --seeds "$SEEDS" --parallel "$PARALLEL" --base-port 8547 &
  pa=$!
  sleep 5
  bash "$RM" --label "$lb" --roster "ascon-notes/roster-iso-$b.yaml" --seeds "$SEEDS" --parallel "$PARALLEL" --base-port 8570 &
  pb=$!
  wait "$pa"; ra=$?
  wait "$pb"; rb=$?
  if [ "$ra" -ne 0 ]; then failures=$((failures + 1)); fi
  if [ "$rb" -ne 0 ]; then failures=$((failures + 1)); fi
  echo "pair $a / $b finished: exit $ra / $rb"
}
pair delta-bid eps-bid5000
pair zeta-a30 eps-bid10000
echo "ISO SUITE DONE at $(date '+%H:%M')"
echo "ISO SUITE: ${failures} failed matrix run(s)"
if [ "$failures" -gt 0 ]; then exit 1; fi
exit 0
