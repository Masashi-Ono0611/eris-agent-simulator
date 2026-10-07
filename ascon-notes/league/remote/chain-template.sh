#!/bin/bash
# Bash 3.2. Fixed chunk membership: change selection with flags, never sed.
set -u
set -f
umask 077

usage() {
  cat <<'HELP'
Usage: bash chain-template.sh --repo DIR --roster FILE --prefix UNIQUE --seeds "N ..."
  [--chunks "1 3 4" | --from 1 --to 4] [--dry-run]
  [--min-free-gb N] [--mode qualification|diagnostic]
  [--continue-on-g0-fail] [--activity-note "host idle; scheduled jobs paused"]
  [--continue-on-opponent-telemetry-blocked CANDIDATE_ID] (diagnostic only)
  [--log-root DIR] [--lock-dir DIR]
Defaults: all 4 chunks, parallel=3, base-port=8547, MIN_FREE_GB=40.
Use a UTC timestamp in UNIQUE. Read OPS-LESSONS-2026-10-06.md before live use.
HELP
}
die() {
  printf 'STOP: %s\n' "$*" >&2
  if [ -n "${run_dir:-}" ]; then printf 'STOP: %s\n' "$*" >> "$run_dir/chain.log"; fi
  exit 2
}
repo_dir='' roster_file='' run_id='' seed_list='' chunk_list=''
first_chunk=1 last_chunk=4 selection='' mode=qualification
dry_run=0 continue_g0=0 min_free=40 disk_explicit=0 activity_note=''
telemetry_candidate='' telemetry_enabled=0
log_root="${TMPDIR:-/tmp}/ascon-chain-logs"
lock_dir="${TMPDIR:-/tmp}/ascon-measurement-host.lock"
run_dir='' lock_owned=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --dry-run) dry_run=1; shift ;;
    --continue-on-g0-fail) continue_g0=1; shift ;;
    --repo|--roster|--prefix|--seeds|--chunks|--from|--to|--min-free-gb|--mode|--activity-note|--log-root|--lock-dir|--continue-on-opponent-telemetry-blocked)
      [ "$#" -ge 2 ] || die "missing value for $1"
      opt=$1; val=$2; shift 2
      case "$opt" in
        --repo) repo_dir=$val ;; --roster) roster_file=$val ;;
        --prefix) run_id=$val ;; --seeds) seed_list=$val ;;
        --chunks) [ "$selection" != range ] || die 'do not mix --chunks and --from/--to'; selection=list; chunk_list=$val ;;
        --from|--to)
          [ "$selection" != list ] || die 'do not mix --chunks and --from/--to'
          selection=range
          case "$opt" in --from) first_chunk=$val ;; --to) last_chunk=$val ;; esac ;;
        --min-free-gb) min_free=$val; disk_explicit=1 ;;
        --mode) mode=$val ;; --activity-note) activity_note=$val ;;
        --log-root) log_root=$val ;; --lock-dir) lock_dir=$val ;;
        --continue-on-opponent-telemetry-blocked) telemetry_candidate=$val; telemetry_enabled=1 ;;
      esac ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die '--prefix must be a unique safe identifier'
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
finish() {
  final_rc=$?
  trap - EXIT
  if [ "$lock_owned" -eq 1 ]; then
    rmdir "$lock_dir" || final_rc=2
  fi
  if [ "$dry_run" -eq 0 ]; then
    if [ -n "$run_dir" ]; then
      printf 'CHAIN_END_%s=%s\n' "$run_id" "$final_rc" >> "$run_dir/chain.log" || final_rc=2
      printf 'CHAIN_END_%s=%s\n' "$run_id" "$final_rc" > "$run_dir/end.marker" || final_rc=2
    fi
    printf 'CHAIN_END_%s=%s\n' "$run_id" "$final_rc"
  fi
  exit "$final_rc"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
note() {
  printf '%s\n' "$*"
  if [ -n "$run_dir" ]; then printf '%s\n' "$*" >> "$run_dir/chain.log" || die 'cannot write chain log'; fi
}
[ -n "$repo_dir" ] && [ -n "$roster_file" ] && [ -n "$seed_list" ] || die '--repo, --roster, --seeds required'
repo_dir=$(cd "$repo_dir" && pwd -P) || die 'repo missing'
case "$roster_file" in /*) ;; *) roster_file="$repo_dir/$roster_file" ;; esac
case "$log_root" in /*) ;; *) log_root="$PWD/$log_root" ;; esac
case "$lock_dir" in /*) ;; *) lock_dir="$PWD/$lock_dir" ;; esac
case "$mode" in diagnostic|qualification) ;; *) die 'invalid --mode' ;; esac
[ "$continue_g0" -eq 0 ] || [ "$mode" = diagnostic ] || die '--continue-on-g0-fail is diagnostics only'
if [ "$telemetry_enabled" -eq 1 ]; then
  [ "$mode" = diagnostic ] || die '--continue-on-opponent-telemetry-blocked requires --mode diagnostic'
  [[ "$telemetry_candidate" =~ ^[A-Za-z0-9_-]+$ ]] || die 'invalid telemetry candidate ID'
fi
case "$min_free" in ''|*[!0-9]*) die 'invalid --min-free-gb' ;; esac
[ "$min_free" -ge 25 ] || die 'MIN_FREE_GB cannot be below hard stop 25 GB'
if [ "${MIN_FREE_GB+x}" = x ] && [ "$disk_explicit" -eq 0 ]; then
  die 'inherited MIN_FREE_GB refused; use explicit --min-free-gb'
fi
case "$first_chunk:$last_chunk" in [1-4]:[1-4]) ;; *) die 'chunk range must be 1..4' ;; esac
[ "$first_chunk" -le "$last_chunk" ] || die 'reversed chunk range'
if [ "$selection" != list ]; then
  chunk_no=$first_chunk
  while [ "$chunk_no" -le "$last_chunk" ]; do chunk_list="$chunk_list $chunk_no"; chunk_no=$((chunk_no+1)); done
fi
seen_chunks=' '
for chunk_no in $chunk_list; do
  case "$chunk_no" in 1|2|3|4) ;; *) die 'chunks must be 1..4' ;; esac
  case "$seen_chunks" in *" $chunk_no "*) die 'duplicate chunk' ;; esac
  seen_chunks="$seen_chunks$chunk_no "
done
[ "$seen_chunks" != ' ' ] || die 'empty chunks'
seen_seeds=' '
for seed_no in $seed_list; do
  case "$seed_no" in ''|*[!0-9]*) die 'seeds must be decimal integers' ;; esac
  case "$seen_seeds" in *" $seed_no "*) die 'duplicate seed' ;; esac
  seen_seeds="$seen_seeds$seed_no "
done
[ "$seen_seeds" != ' ' ] || die 'empty seeds'
if [ "${CHAIN_TEST_FREE_GB+x}" = x ]; then
  [ "${CHAIN_TEST_MODE:-0}" = 1 ] && [ "$dry_run" -eq 1 ] || die 'test disk override requires CHAIN_TEST_MODE=1 and --dry-run'
fi
free_gb() {
  if [ "${CHAIN_TEST_FREE_GB+x}" = x ]; then printf '%s\n' "$CHAIN_TEST_FREE_GB"
  # Do not coerce a missing/non-numeric Available field to zero.
  else df -Pk "$1" | awk 'NR==2 {if ($4 ~ /^[0-9]+$/) printf "%d\n", $4/1048576; else print "invalid"}'; fi
}
check_disk() {
  snapshot_context=''
  if [ "$(uname -s)" = Darwin ] && command -v tmutil >/dev/null 2>&1; then
    if snapshot_output=$(tmutil listlocalsnapshots / 2>/dev/null); then
      snapshot_count=$(printf '%s\n' "$snapshot_output" | awk 'NF && $0 !~ /^Snapshots for / {n++} END {print n+0}')
      [ "$snapshot_count" -lt 10 ] || note "WARN local TimeMachine snapshots=$snapshot_count"
    else
      snapshot_count=unknown
      note 'WARN cannot list local TimeMachine snapshots'
    fi
    snapshot_context="; local TimeMachine snapshots=$snapshot_count; remedy: review/thin local snapshots with tmutil or complete a Time Machine backup, then recheck df (no automatic deletion)"
  fi
  for disk_path in "$repo_dir" "${TMPDIR:-/tmp}"; do
    free_value=$(free_gb "$disk_path") || die 'cannot measure disk'
    case "$free_value" in ''|*[!0-9]*) die 'cannot measure disk' ;; esac
    note "DISK path=$disk_path free_GB=$free_value MIN_FREE_GB=$min_free hard_stop_GB=25 (GiB units)"
    [ "$free_value" -ge 25 ] || die "free disk below hard stop 25 GB$snapshot_context"
    [ "$free_value" -ge "$min_free" ] || die "free disk below effective MIN_FREE_GB$snapshot_context"
  done
}
check_path() {
  # Only resolve commands: do not start Anvil or execute tool version probes.
  for required_tool in anvil node python3; do
    if resolved_tool=$(command -v "$required_tool"); then
      note "PREFLIGHT $required_tool=$resolved_tool"
    else
      note "STOP: required command not found in PATH: $required_tool"
      exit 3
    fi
  done
}
check_idle() {
  pgrep -x anvil >/dev/null 2>&1
  probe_rc=$?
  case "$probe_rc" in 0) die 'anvil already running' ;; 1) ;; *) die 'pgrep anvil unavailable; fail closed' ;; esac
}
check_label() {
  for existing_path in "$repo_dir/ascon-notes/league/manifests/$1.json" "$repo_dir/ascon-notes/eval/out/$1"; do
    [ ! -e "$existing_path" ] && [ ! -L "$existing_path" ] || die "existing label refused: $1 ($existing_path)"
  done
}
[ -f "$roster_file" ] || die "missing roster: $roster_file"
for required_file in ascon-notes/league/round-manifest.py ascon-notes/league/run-league.sh ascon-notes/league/g0.py; do
  [ -f "$repo_dir/$required_file" ] || die "missing runner: $required_file"
done
classifier=ascon-notes/league/remote/g0_blocked_classify.py
[ "$telemetry_enabled" -eq 0 ] || [ -f "$repo_dir/$classifier" ] || die 'missing telemetry classifier'
for chunk_no in $chunk_list; do check_label "$run_id-c$chunk_no"; done
[ ! -e "$log_root/$run_id" ] && [ ! -L "$log_root/$run_id" ] || die 'existing run log directory refused'
[ ! -e "$lock_dir" ] && [ ! -L "$lock_dir" ] || die "lock held: $lock_dir"
if [ "$dry_run" -eq 0 ]; then
  [ -n "$activity_note" ] || die '--activity-note required; confirm no concurrent CPU work before starting'
  mkdir "$lock_dir" || die "lock held or parent unavailable: $lock_dir"
  lock_owned=1
  mkdir -p "$log_root" || die 'cannot create log root'
  mkdir "$log_root/$run_id" || die 'cannot create unique run directory'
  run_dir="$log_root/$run_id"
fi
check_disk
cd "$repo_dir" || die 'cannot enter repo'
note "RUN prefix=$run_id mode=$mode chunks=$chunk_list seeds=$seed_list"
stdin_tty=no
[ ! -t 0 ] || stdin_tty=yes
# %q keeps even a PATH containing whitespace/newlines on one log line.
printf -v launch_env 'LAUNCH_ENV PATH_head=%q stdin_tty=%s' "${PATH%%:*}" "$stdin_tty"
note "$launch_env"
[ "$stdin_tty" = no ] || note 'WARN stdin is a tty; use nohup with </dev/null and caffeinate (see runbook)'
check_path
check_idle
note "ACTIVITY ${activity_note:-UNRECORDED (dry-run only)}"
note 'RULE: no other CPU work; pause codex jobs, npm ci, builds, ci-local and scheduled workers for the full measurement.'
note 'RULE: regenerate state dump after upstream integration; verify LQTYStaking is nonzero before measurement.'
if [ "$disk_explicit" -eq 1 ]; then note "DEVIATION explicit --min-free-gb=$min_free (matrix default 40; inherited value ignored)"; fi
if [ "$continue_g0" -eq 1 ]; then note 'DEVIATION diagnostic continuation after G0 FAIL; failures remain failures'; fi
[ "$dry_run" -eq 0 ] || note 'PLAN_ONLY: no commands executed, no logs/lock/manifest created; no completion marker emitted.'
# Printing and execution share the same argv; no eval and no shell pipelines mask exit codes.
command_to_log() {
  dest_file=$1; shift
  printf 'COMMAND: (cd %q &&' "$repo_dir"
  printf ' %q' "$@"
  printf ') > %q 2>&1\n' "$dest_file"
  if [ "$dry_run" -eq 1 ]; then return 0; fi
  "$@" > "$dest_file" 2>&1
}
chain_rc=0
for chunk_no in $chunk_list; do
  case "$chunk_no" in
    1) regime_list='calm cex-drift informed-flow' ;;
    2) regime_list='whale lending-incident crash' ;;
    3) regime_list='depeg vuln spike' ;;
    4) regime_list='depeg-persist cdp-incident launch' ;;
  esac
  label="$run_id-c$chunk_no"
  chunk_log="$log_root/$run_id/$label"
  check_label "$label"
  check_disk
  check_idle
  note "CHUNK $chunk_no label=$label regimes=$regime_list"
  command_to_log "$chunk_log-begin.log" python3 -B ascon-notes/league/round-manifest.py begin "$label" --roster "$roster_file" --regimes "$regime_list" --seeds "$seed_list" --parallel 3 || die "manifest begin failed: $label"
  if [ "$telemetry_enabled" -eq 1 ]; then
    command_to_log "$chunk_log-bind.log" python3 -B "$classifier" bind --manifest "ascon-notes/league/manifests/$label.json" --roster "$roster_file" --candidate "$telemetry_candidate" --context "$log_root/$run_id/telemetry-context.json" || die "cannot fix candidate/opponents at start: $label"
  fi
  command_to_log "$chunk_log-run.log" env "MIN_FREE_GB=$min_free" NPM_CONFIG_IGNORE_SCRIPTS=true bash ascon-notes/league/run-league.sh --label "$label" --roster "$roster_file" --regimes "$regime_list" --seeds "$seed_list" --parallel 3 --base-port 8547
  matrix_rc=$?
  command_to_log "$chunk_log-verify.log" python3 -B ascon-notes/league/round-manifest.py verify "$label"
  verify_rc=$?
  # Intentional splitting of validated lists for argparse nargs='+'. Globbing is disabled.
  # shellcheck disable=SC2086
  if [ "$telemetry_enabled" -eq 1 ]; then
    # One G0 evaluation; retain its original structured output unchanged.
    # shellcheck disable=SC2086
    command_to_log "$chunk_log-g0.json" python3 -B ascon-notes/league/g0.py "$label" --roster "$roster_file" --regimes $regime_list --seeds $seed_list --manifest "$label" --json
    g0_rc=$?
    command_to_log "$chunk_log-g0.log" python3 -B "$classifier" status --g0 "$chunk_log-g0.json" --g0-rc "$g0_rc" || die "G0 inconsistent structured output: $label"
  else
    # shellcheck disable=SC2086
    command_to_log "$chunk_log-g0.log" python3 -B ascon-notes/league/g0.py "$label" --roster "$roster_file" --regimes $regime_list --seeds $seed_list --manifest "$label"
    g0_rc=$?
  fi
  [ "$dry_run" -eq 0 ] || continue
  note "RESULT $label matrix_rc=$matrix_rc verify_rc=$verify_rc g0_rc=$g0_rc"
  [ "$matrix_rc" -eq 0 ] && [ "$verify_rc" -eq 0 ] || die "runner/manifest failure: $label (G0 recorded; no continuation)"
  if [ "$g0_rc" -eq 0 ] && grep -qx 'G0 PASS' "$chunk_log-g0.log"; then
    note "G0 PASS $label"
  elif [ "$g0_rc" -eq 1 ] && grep -qx 'G0 FAIL' "$chunk_log-g0.log"; then
    note "G0 FAIL $label (preserved; never retried)"
    [ "$chain_rc" -eq 2 ] || chain_rc=1
    [ "$continue_g0" -eq 1 ] || exit "$chain_rc"
  elif [ "$g0_rc" -eq 2 ] && [ "$telemetry_enabled" -eq 1 ]; then
    note "G0 BLOCKED $label (preserved; eligible_for_gate=false)"
    command_to_log "$chunk_log-classifier.log" python3 -B "$classifier" classify --g0 "$chunk_log-g0.json" --g0-rc "$g0_rc" --repo "$repo_dir" --manifest "ascon-notes/league/manifests/$label.json" --roster "$roster_file" --candidate "$telemetry_candidate" --context "$run_dir/telemetry-context.json" --verdict "$chunk_log-classifier.json" || die "G0 blocked/error/inconsistent output: $label (classification refused)"
    # Read only after the classifier has saved the complete approval verdict.
    while IFS= read -r deviation; do note "$deviation"; done < "$chunk_log-classifier.log"
    chain_rc=2
  else
    die "G0 blocked/error/inconsistent output: $label"
  fi
done
exit "$chain_rc"
