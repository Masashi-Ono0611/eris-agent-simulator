#!/bin/bash
# Watch the lanes of a remote host from the laptop: one ssh call per poll, only new lines printed.
#   bash ascon/eval/watch-lanes.sh '<remote status command>'
#   e.g. bash ascon/eval/watch-lanes.sh 'bash ~/Developer/ascon-wt-1ce98d01/ascon/eval/lane-status.sh'
# Start it with run_in_background and watch its output with Monitor; do not poll it with sleep loops.
# Every $ASCON_WATCH_EVERY seconds (default 600) it runs $ASCON_SSH (default `tailscale ssh
# masa-ws1@macmini`) <remote status command>, each call under a 60 s timeout ($ASCON_WATCH_TIMEOUT;
# shell-ops S05: a hung ssh must not stop the loop). A reply counts only if it ends with the
# "ALL_DONE=<0|1> HOLD=<0|1>" line of lane-status.sh: tailscale ssh returns 0 even when the remote
# command failed, so the exit code is not read. A reply without it prints "WATCH_UNAVAILABLE <why>" once
# per streak and the watch goes on.
# Printed: every EXIT_/HOLD_/STOPPED_/QUEUE_DONE_/IDLE_/CHAIN_ line not printed before, and a LANE line
# whenever that lane's state or job changes, each prefixed with the local time.
# Exit: 0 when ALL_DONE=1 (no lane running); 3 when HOLD=1 (a decision is needed); 4 after
# $ASCON_WATCH_MAX_H hours (default 48) without either; 2 bad arguments.
set -u
cmd="${1:?usage: watch-lanes.sh '<remote status command>'}"
ssh_cmd="${ASCON_SSH:-tailscale ssh masa-ws1@macmini}"
every="${ASCON_WATCH_EVERY:-600}"
tmo="${ASCON_WATCH_TIMEOUT:-60}"
max_h="${ASCON_WATCH_MAX_H:-48}"
for v in "$every" "$tmo" "$max_h"; do
  printf '%s\n' "$v" | grep -Eq '^[0-9]{1,6}$' && [ "$v" -ge 1 ] || { echo "WATCH_REFUSED interval, timeout and max hours must be whole numbers >= 1"; exit 2; }
done

# with_timeout <seconds> <command...> (shell-ops rules: group kill, no nesting).
with_timeout(){
  [ "$#" -ge 2 ] || return 2
  local s="${1-}"; shift
  case "$s" in ''|*[!0-9]*) return 2 ;; esac
  [ "${#s}" -le 6 ] && [ "$s" -ge 1 ] || return 2
  local had_monitor=0
  case $- in *m*) had_monitor=1 ;; esac
  set -m
  "$@" & local c=$!
  ( sleep "$s"; kill -9 -- "-$c" 2>/dev/null ) >/dev/null 2>&1 & local w=$!
  local rc=0
  wait "$c" 2>/dev/null || rc=$?
  kill -9 -- "-$c" 2>/dev/null || :
  kill -9 -- "-$w" 2>/dev/null || :
  wait "$w" 2>/dev/null || :
  [ "$had_monitor" -eq 1 ] || set +m
  return $rc
}

seen="$(mktemp)" || exit 2
reply="$(mktemp)" || exit 2
trap 'rm -f "$seen" "$reply"' EXIT
deadline=$(( $(date +%s) + max_h * 3600 ))
unavailable=""
# shellcheck disable=SC2086  # $ssh_cmd is a command and its arguments
while :; do
  : > "$reply"
  if with_timeout "$tmo" $ssh_cmd "$cmd" > "$reply" 2>&1 < /dev/null; then rc=0; else rc=$?; fi
  last="$(grep -E '^ALL_DONE=[01] HOLD=[01]$' "$reply" | tail -1)"
  if [ -z "$last" ] || [ "$(tail -1 "$reply")" != "$last" ]; then
    [ -n "$unavailable" ] || echo "$(date '+%H:%M') WATCH_UNAVAILABLE rc=$rc $(tail -2 "$reply" | tr '\n' ' ' | cut -c1-200)"
    unavailable=1
  else
    unavailable=""
    while IFS= read -r line; do
      case "$line" in
        LANE\ *) key="$(printf '%s\n' "$line" | awk '{ print $1, $2, $3, $4, $5 }')" ;;
        EXIT_*|HOLD_*|STOPPED_*|QUEUE_DONE_*|IDLE_*|CHAIN_*|NO_LOGS*) key="$line" ;;
        *) continue ;;
      esac
      grep -qxF -- "$key" "$seen" && continue
      printf '%s\n' "$key" >> "$seen"
      echo "$(date '+%H:%M') $line"
    done < "$reply"
    case "$last" in
      *"HOLD=1") echo "$(date '+%H:%M') WATCH_HOLD $(grep '^HOST ' "$reply" | tail -1)"; exit 3 ;;
      "ALL_DONE=1"*) echo "$(date '+%H:%M') WATCH_ALL_DONE $(grep '^HOST ' "$reply" | tail -1)"; exit 0 ;;
    esac
  fi
  [ "$(date +%s)" -lt "$deadline" ] || { echo "$(date '+%H:%M') WATCH_TIMEOUT after $max_h h"; exit 4; }
  sleep "$every"
done
