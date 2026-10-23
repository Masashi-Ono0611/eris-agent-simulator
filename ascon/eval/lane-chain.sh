#!/bin/bash
# Keep one lane busy: run the queue files of a directory one after another with lane-queue.sh, then wait
# for more (procedure: ascon/eval/README.md).
#   ascon/eval/lane-chain.sh <lane> <queue-dir> <port> <state-dir>
# The script cds to the repo root (its ../..) first; relative paths are relative to the repo root.
# <queue-dir> holds pending/, running/, done/ and held/ (made if missing). Loop:
#   1. if <queue-dir>/STOP exists: write "CHAIN_STOP_<lane>" and exit 0 (checked before every queue and
#      on every poll; a queue that is running is not interrupted: touch STOP, it ends after that queue);
#   2. take the name-ordered first <queue-dir>/pending/*.txt, move it to running/, and run
#      lane-queue.sh <lane> running/<file> <port> <state-dir> with ASCON_QUEUE_RUN_ID=<lane>-[<tag>-]<stem>
#      (<stem> = the file name without .txt, <tag> = $ASCON_CHAIN_TAG if set);
#   3. lane-queue exit 0 or 1 (done, or stopped by a signal): move the file to done/ and go on;
#      exit 3 (HOLD, disk) or 2 (refused: a bad queue file or a run id used before): move it to held/,
#      write "CHAIN_HELD_<lane> file=<file> rc=<rc>" and exit with that rc. A held chain needs a decision.
#   4. when pending/ is empty: write "IDLE_<lane> since=<time>" once, then look again every
#      $ASCON_CHAIN_POLL seconds (default 60). A file added to pending/ starts on the next look.
# Every line goes to stdout and to <logs>/<lane>.chain.log (<logs> = $ASCON_EVAL_LOGS, default
# /tmp/ascon-exp; set it outside /tmp for long runs). Each queue's own lines are in <logs>/<lane>.queue.log
# under its run id. Completion of one queue: "QUEUE_DONE_<lane> run=<id>" there, and
# "CHAIN_QUEUE_END_<lane> file=<file> rc=0" here.
# Exit: 0 STOP; 2 refused to start (bad arguments, or this lane already has a chain:
# <logs>/<lane>.chain.lock), or a queue refused; 3 a queue held; 1 stopped by a signal (the running
# lane-queue gets TERM and writes STOPPED_<lane>; its file stays in running/).
# Convention (ascon/final/README.md): keep one queue in each lane's pending/ that needs no decision.
set -u
lane="${1:?lane}"; qdir="${2:?queue-dir}"; port="${3:?port}"; state="${4:?state-dir}"
here="$(cd "$(dirname "$0")" && pwd -P)" || exit 2
cd "$here/../.." || exit 2
logs="${ASCON_EVAL_LOGS:-/tmp/ascon-exp}"
export ASCON_EVAL_LOGS="$logs"
lq="${ASCON_LANE_QUEUE:-$here/lane-queue.sh}"
poll="${ASCON_CHAIN_POLL:-60}"
tag="${ASCON_CHAIN_TAG:-}"
name_ok() { printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*$'; }
refuse() { echo "CHAIN_REFUSED_$lane $1" >&2; exit 2; }
name_ok "$lane" || refuse "lane name must be [A-Za-z0-9_.-]"
[ -z "$tag" ] || name_ok "$tag" || refuse "ASCON_CHAIN_TAG must be [A-Za-z0-9_.-]"
printf '%s\n' "$poll" | grep -Eq '^[0-9]{1,4}$' && [ "$poll" -ge 1 ] || refuse "ASCON_CHAIN_POLL must be 1-9999 seconds"
[ -d "$qdir" ] || refuse "queue dir not found: $qdir (relative to the repo root)"
qdir="$(cd "$qdir" && pwd -P)" || refuse "cannot enter $qdir"
mkdir -p "$qdir/pending" "$qdir/running" "$qdir/done" "$qdir/held" "$logs" || refuse "cannot make the queue dirs or $logs"
lock="$logs/$lane.chain.lock"
mkdir "$lock" 2>/dev/null || refuse "lane $lane already has a chain ($lock; remove it by hand only after checking its pid file)"
echo "$$" > "$lock/pid"
clog="$logs/$lane.chain.log"
say() { echo "$1" >> "$clog"; echo "$1"; }
child=""
release() { rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null; }
trap release EXIT
on_signal() {
  if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null; wait "$child"; fi
  say "CHAIN_STOPPED_$lane by a signal"
  exit 1
}
trap on_signal INT TERM HUP
say "CHAIN_START_$lane $(date '+%Y-%m-%dT%H:%M:%S') pid=$$ dir=$qdir port=$port state=$state"
idle=""
while :; do
  if [ -e "$qdir/STOP" ]; then say "CHAIN_STOP_$lane $(date '+%Y-%m-%dT%H:%M:%S')"; exit 0; fi
  next=""
  for f in "$qdir/pending/"*.txt; do [ -f "$f" ] && { next="$f"; break; }; done
  if [ -z "$next" ]; then
    [ -n "$idle" ] || { idle=1; say "IDLE_$lane since=$(date '+%Y-%m-%dT%H:%M:%S')"; }
    sleep "$poll" & child=$!; wait "$child"; child=""
    continue
  fi
  idle=""
  file="$(basename "$next")"; stem="${file%.txt}"
  run="$lane-${tag:+$tag-}$stem"
  if ! name_ok "$stem"; then
    mv "$next" "$qdir/held/$file"; say "CHAIN_HELD_$lane file=$file rc=2 (file name must be [A-Za-z0-9_.-].txt)"; exit 2
  fi
  mv "$next" "$qdir/running/$file" || { say "CHAIN_HELD_$lane file=$file rc=2 (cannot move to running/)"; exit 2; }
  say "CHAIN_QUEUE_$lane file=$file run=$run"
  ASCON_QUEUE_RUN_ID="$run" "$BASH" "$lq" "$lane" "$qdir/running/$file" "$port" "$state" &
  child=$!
  wait "$child"; rc=$?
  child=""
  case "$rc" in
    0|1) mv "$qdir/running/$file" "$qdir/done/$file"; say "CHAIN_QUEUE_END_$lane file=$file rc=$rc run=$run" ;;
    *) mv "$qdir/running/$file" "$qdir/held/$file"; say "CHAIN_HELD_$lane file=$file rc=$rc run=$run"; exit "$rc" ;;
  esac
done
