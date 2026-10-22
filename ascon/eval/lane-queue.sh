#!/bin/bash
# Run a lane of backtest matrices one after another (for the Mac mini, started with nohup).
#   ascon/eval/lane-queue.sh <lane> <queue-file> <port> <state-dir>
# The script cds to the repo root (its ../..) first, so every relative path, in the arguments and in
# the queue file, is relative to the repo root.
# Queue file: one job per line, "<job> <roster-template> <slot-dir> <scenarios.yaml>"; blank lines and
# # comments are skipped. <slot-dir> is a directory name under example/agents; the template must
# contain __SLOT_DIR__ (e.g. `dir: __SLOT_DIR__`), which is replaced by it. The whole file is read and
# checked before the first job (bad line, bad or repeated job name, also names that differ only in case,
# which share their files on macOS, or a job name another run is using now: refused, nothing runs).
#
# Run id. Each start has one: $ASCON_QUEUE_RUN_ID if set ([A-Za-z0-9_.-], not used before in this lane),
# else <yyyymmddThhmmss>-<pid>. The first stdout line is "QUEUE_RUN_<lane> run=<id> pid=<pid>", and every
# line the run writes carries run=<id>. The queue log is appended to across runs and a refused start
# writes nothing to it, so it can still end with an earlier run's QUEUE_DONE_<lane>: never wait for
# QUEUE_DONE_<lane> without the run id.
#
# For each job, in order:
#   1. free space on the filesystem of the repo below ASCON_QUEUE_MIN_FREE_GIB (default 10) GiB: write
#      "HOLD_<lane> run=<id> <job> free=<n>GiB" and stop with exit 3 (this job and the rest do not run);
#   2. take the job's lock <logs>/rosters/<job>.lock, held until the job's marker is written. If another
#      lane holds it, or run-matrix's lock <logs>/<job>.lock exists, a run of this job name is in progress:
#      the job is BLOCKED and its roster is not touched;
#   3. render the roster into <logs>/rosters/<job>.yaml (no placeholder, or no example/agents/<slot-dir>:
#      the job fails without running) and write "NOTE_<job> run=<id> slot=<slot-dir> template=<template>
#      scenarios=<scenarios.yaml>", the record of which arm ran;
#   4. run ascon/eval/run-matrix.sh (or $ASCON_RUN_MATRIX) <job> <roster> <scenarios> <port> <state-dir>;
#   5. on PASS, write "NOTE_<job> run=<id> matrix=<path>", the path taken from the PASS line in
#      <logs>/<job>.log, and run python3 ascon/eval/check-collision.py (or $ASCON_CHECK_COLLISION) <path>
#      (rc 0 PASS, 1 FAIL, anything else BLOCKED);
#   6. append "EXIT_<job>=<run-matrix rc, - if it did not run> VERDICT=<PASS|FAIL|BLOCKED>
#      COLLISION=<PASS|FAIL|BLOCKED|SKIP> run=<id>" and go on: a failed job does not stop the queue.
# After the last job: "QUEUE_DONE_<lane> run=<id>", exit 0.
# Everything goes to stdout and to <logs>/<lane>.queue.log (<logs> = $ASCON_EVAL_LOGS, default
# /tmp/ascon-exp); a run's lines are the ones with its run=<id>. Other NOTE_<job> lines say why a job
# failed outside run-matrix.
# Exit: 0 done; 2 refused to start ("REFUSED_<lane> run=<id> <why>" on stderr only: bad arguments or queue
# file, a run id this lane has used, a job name in use, or this lane already holds <logs>/<lane>.queue.lock);
# 3 HOLD; 1 stopped by a signal (the running matrix is stopped too and its marker says FAIL;
# "STOPPED_<lane> run=<id>" is written and there is no QUEUE_DONE).
#
# Waiting for a lane: it is done when "QUEUE_DONE_<lane> run=<id>" is in the queue log. It ended without
# finishing when "HOLD_<lane> run=<id>" or "STOPPED_<lane> run=<id>" is there, or when the lane-queue pid
# has exited without any of the three: refused (see its stderr), or killed by SIGKILL or a reboot, which
# leaves its locks behind. Each lock holds a file "pid" ("<pid> run=<id> lane=<lane>"); remove a lock by
# hand only after checking that this pid is gone.
#
# Long runs need <logs> outside /tmp: macOS (tmp_cleaner, daily at 00:00) deletes files under /tmp whose
# access, change and modification times are all over 3 days old, then empty directories over 3 days old.
# The job logs, rosters, queue log and locks of a run that lasts days, or is read days later, can go.
# Set ASCON_EVAL_LOGS outside /tmp (e.g. ~/ascon-final/logs); a run whose <logs> is under /tmp writes
# "WARN_<lane> run=<id> ..." after its QUEUE_START line.
#
# Parallel lanes (one lane per nohup):
#   export ASCON_EVAL_LOGS=~/ascon-final/logs; mkdir -p "$ASCON_EVAL_LOGS"
#   ASCON_QUEUE_RUN_ID=quiet-1 nohup ascon/eval/lane-queue.sh quiet q-quiet.txt 8547 backtest/state-quiet \
#     > "$ASCON_EVAL_LOGS/quiet.out" 2>&1 &
#   sleep 20
#   ASCON_QUEUE_RUN_ID=active-1 nohup ascon/eval/lane-queue.sh active q-active.txt 8647 backtest/state-active \
#     > "$ASCON_EVAL_LOGS/active.out" 2>&1 &
# - Start two lanes at least 20 s apart: two backtests started in the same millisecond share
#   runs/<start time> and its run-start block, and check-matrix still says PASS.
# - Never let two lanes share a port (the anvil port of the backtest; not checked anywhere) or a state dir
#   (run-matrix refuses a state dir in use, so the later job is BLOCKED, not run). Two runs of one
#   regime+seed in one state dir can swap rosters silently.
# - Use job names that are unique across lanes: <logs>/<job>.log and the rendered roster are per name, so
#   a job whose name is in use is BLOCKED (step 2).
set -u
lane="${1:?lane}"; queue="${2:?queue-file}"; port="${3:?port}"; state="${4:?state-dir}"
cd "$(dirname "$0")/../.." || exit 2
logs="${ASCON_EVAL_LOGS:-/tmp/ascon-exp}"
export ASCON_EVAL_LOGS="$logs"
run_matrix="${ASCON_RUN_MATRIX:-ascon/eval/run-matrix.sh}"
check_collision="${ASCON_CHECK_COLLISION:-ascon/eval/check-collision.py}"
min_gib="${ASCON_QUEUE_MIN_FREE_GIB:-10}"
run_id="${ASCON_QUEUE_RUN_ID:-$(date '+%Y%m%dT%H%M%S')-$$}"

refuse() { echo "REFUSED_$lane run=$run_id $1" >&2; exit 2; }
name_ok() { printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*$'; }
name_ok "$run_id" || refuse "ASCON_QUEUE_RUN_ID must be [A-Za-z0-9_.-]"
echo "QUEUE_RUN_$lane run=$run_id pid=$$"
# Checked before any file is touched: the lane and job names become paths.
name_ok "$lane" || refuse "lane name must be [A-Za-z0-9_.-]"
printf '%s\n' "$port" | grep -Eq '^[0-9]+$' || refuse "port must be an integer"
printf '%s\n' "$min_gib" | grep -Eq '^[0-9]{1,6}$' || refuse "ASCON_QUEUE_MIN_FREE_GIB must be a whole number of GiB"
[ -f "$queue" ] && [ -r "$queue" ] || refuse "queue file not readable: $queue (relative to the repo root)"

names=(); lower=(); tmpls=(); slots=(); scens=()
n=0
while IFS= read -r line || [ -n "$line" ]; do
  n=$((n + 1))
  line="${line%%#*}"
  read -r j t s c extra <<< "$line"
  [ -z "$j" ] && continue
  [ -n "$c" ] && [ -z "$extra" ] || refuse "$queue line $n: want <job> <roster-template> <slot-dir> <scenarios.yaml>"
  name_ok "$j" || refuse "$queue line $n: job name must be [A-Za-z0-9_.-]"
  case "$j" in *.queue) refuse "$queue line $n: a job name may not end in .queue (the files of a lane do)" ;; esac
  lj="$(printf '%s' "$j" | tr '[:upper:]' '[:lower:]')"
  for k in ${lower[@]+"${lower[@]}"}; do
    [ "$k" = "$lj" ] && refuse "$queue line $n: job $j is listed twice (names are compared ignoring case)"
  done
  names+=("$j"); lower+=("$lj"); tmpls+=("$t"); slots+=("$s"); scens+=("$c")
done < "$queue"
[ "${#names[@]}" -gt 0 ] || refuse "no jobs in $queue"

mkdir -p "$logs/rosters" || refuse "cannot create $logs/rosters"
lock="$logs/$lane.queue.lock"
mkdir "$lock" 2>/dev/null || refuse "lane $lane is already running ($lock)"
jlock=""
lock_pid() { printf '%s run=%s lane=%s\n' "$$" "$run_id" "$lane" > "$1/pid" 2>/dev/null; }
unlock() { rm -f "$1/pid"; rmdir "$1" 2>/dev/null; }
release() { [ -n "$jlock" ] && unlock "$jlock"; unlock "$lock"; }
trap release EXIT
lock_pid "$lock"
qlog="$logs/$lane.queue.log"
if [ -f "$qlog" ] && awk -v p="QUEUE_START_$lane run=$run_id " 'index($0, p) == 1 { f = 1 } END { exit !f }' "$qlog"; then
  refuse "run id $run_id was used before in $qlog: give each start a new one"
fi
for k in "${names[@]}"; do
  for l in "$logs/$k.lock" "$logs/rosters/$k.lock"; do
    [ -d "$l" ] && refuse "job $k is in use by another run ($l)"
  done
done

say() { echo "$1" >> "$qlog"; echo "$1"; }
mark() { say "EXIT_$1=$2 VERDICT=$3 COLLISION=$4 run=$run_id"; }
child=""; pending=""; job=""; rc=-; verdict=FAIL; collision=SKIP
on_signal() {
  # The running run-matrix gets TERM and stops its own backtest process group before it exits.
  if [ -n "$child" ]; then
    kill -TERM "$child" 2>/dev/null
    wait "$child"; rc=$?
    child=""
  fi
  if [ -n "$pending" ]; then
    mark "$job" "$rc" "$verdict" "$collision"
    say "NOTE_$job run=$run_id stopped by a signal"
  fi
  say "STOPPED_$lane run=$run_id"
  exit 1
}
trap on_signal INT TERM HUP
say "QUEUE_START_$lane run=$run_id $(date '+%Y-%m-%dT%H:%M:%S') pid=$$ queue=$queue port=$port state=$state jobs=${#names[@]}"
logs_real="$(cd -P -- "$logs" > /dev/null && pwd -P)"
case "$logs_real/" in
  /tmp/*|/private/tmp/*) say "WARN_$lane run=$run_id logs in $logs_real: macOS deletes files under /tmp unused for 3 days; set ASCON_EVAL_LOGS outside /tmp for long runs" ;;
esac

i=0
while [ "$i" -lt "${#names[@]}" ]; do
  job="${names[$i]}"; tmpl="${tmpls[$i]}"; slot="${slots[$i]}"; sc="${scens[$i]}"
  i=$((i + 1))
  rc=-; verdict=FAIL; collision=SKIP

  # 1. Disk. An unreadable df counts as too little space.
  free_kib="$(df -Pk . 2>/dev/null | awk 'NR == 2 && NF == 6 { print $4 }')"
  if ! printf '%s\n' "$free_kib" | grep -Eq '^[0-9]+$'; then
    say "HOLD_$lane run=$run_id $job free=unknown (df output not understood)"; exit 3
  fi
  if [ "$free_kib" -lt $((min_gib * 1048576)) ]; then
    say "HOLD_$lane run=$run_id $job free=$((free_kib / 1048576))GiB"; exit 3
  fi
  pending="$job"

  # 2. The job's lock: another lane running this job name would otherwise replace the roster in use.
  why=""
  if [ -d "$logs/$job.lock" ]; then why="another run named $job is in progress ($logs/$job.lock)"
  elif ! mkdir "$logs/rosters/$job.lock" 2>/dev/null; then why="another run named $job is in progress ($logs/rosters/$job.lock)"
  else jlock="$logs/rosters/$job.lock"; lock_pid "$jlock"
  fi
  if [ -n "$why" ]; then
    say "NOTE_$job run=$run_id $why; roster not touched"
    mark "$job" - BLOCKED SKIP; pending=""
    continue
  fi

  # 3. Roster.
  roster="$logs/rosters/$job.yaml"
  rm -f "$roster"
  if ! [ -f "$tmpl" ] || ! [ -r "$tmpl" ]; then why="roster template not readable: $tmpl"
  elif ! grep -qF __SLOT_DIR__ "$tmpl"; then why="no __SLOT_DIR__ in $tmpl"
  elif ! name_ok "$slot" || ! [ -d "example/agents/$slot" ]; then why="no slot dir example/agents/$slot"
  elif ! sed "s/__SLOT_DIR__/$slot/g" "$tmpl" > "$roster"; then why="could not write $roster"
  fi
  if [ -n "$why" ]; then
    say "NOTE_$job run=$run_id $why"
    mark "$job" - FAIL SKIP; pending=""
    unlock "$jlock"; jlock=""
    continue
  fi
  say "NOTE_$job run=$run_id slot=$slot template=$tmpl scenarios=$sc"

  # 4. Matrix. In the background so a signal reaches on_signal at once rather than after the job.
  "$BASH" "$run_matrix" "$job" "$roster" "$sc" "$port" "$state" &
  child=$!
  wait "$child"
  rc=$?
  child=""
  # The marker run-matrix wrote for this run (it empties <logs>/<job>.log when it starts).
  line="$(awk -v p="EXIT_$job=" 'index($0, p) == 1' "$logs/$job.log" 2>/dev/null | tail -1)"
  if [ "$rc" = 0 ]; then
    case "$line" in
      "EXIT_$job=0 VERDICT=PASS "*) verdict=PASS ;;
      *) say "NOTE_$job run=$run_id run-matrix exited 0 but $logs/$job.log has no PASS line" ;;
    esac
  elif [ "$rc" = 2 ]; then
    verdict=BLOCKED
  fi

  # 5. On PASS: where the matrix is, and the collision check. The PASS text of check-matrix ends with
  # ", <n> agents each, <path>".
  if [ "$verdict" = PASS ]; then
    collision=BLOCKED
    matrix="${line#* agents each, }"
    if [ "$matrix" = "$line" ]; then
      say "NOTE_$job run=$run_id no matrix.json path in the PASS line of $logs/$job.log"
    elif ! [ -f "$matrix" ]; then
      say "NOTE_$job run=$run_id the matrix.json named in the PASS line of $logs/$job.log does not exist: $matrix"
    else
      say "NOTE_$job run=$run_id matrix=$matrix"
      out="$(python3 "$check_collision" "$matrix" 2>&1)"
      crc=$?
      case "$crc" in 0) collision=PASS ;; 1) collision=FAIL ;; esac
      [ "$crc" = 0 ] || say "NOTE_$job run=$run_id check-collision rc $crc: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"
    fi
  fi

  # 6. Marker.
  mark "$job" "$rc" "$verdict" "$collision"; pending=""
  unlock "$jlock"; jlock=""
done
say "QUEUE_DONE_$lane run=$run_id"
exit 0
