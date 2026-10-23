#!/bin/bash
# Start one evaluation lane on its own checkout pinned to a commit (Mac mini, or the laptop as a third lane).
#   bash ascon/eval/mini-lane-start.sh <lane> <sha> <queue-dir> <port>
# Run it from any checkout of the repo (it uses only the main checkout and the pinned tree). Steps:
#   1. the tree $ASCON_WT_BASE/ascon-wt-<sha8> (default ~/Developer) at <sha>: made with `git worktree add
#      --detach` from the main checkout $ASCON_HOME (default ~/Developer/ascon, fetched first unless
#      ASCON_FETCH=0) if missing, with node_modules and out linked and sdk/src/constants.local.ts copied
#      from the main checkout. An existing tree must already be at <sha>: nothing is ever checked out
#      inside an existing tree, because lanes may be running from it (shell-ops S24: a running script and
#      the agent code must not change under a job). Different commits get different trees, so a new arm
#      on a new commit never disturbs a lane that is running;
#   2. every pending/*.txt in <queue-dir>: each roster template, slot dir (example/agents/<slot>) and
#      scenario file it names exists in that tree, else BLOCKED and nothing starts. A queue added to
#      pending/ later is not checked here: lane-queue.sh fails its jobs whose slot dir is missing;
#   3. the state dir $ASCON_FINAL/state-<lane> (default ~/ascon-final): copied from the main checkout's
#      backtest/state if missing;
#   4. refused (BLOCKED, exit 2) only when this lane already has a chain (<logs>/<lane>.chain.lock). If
#      another lane started less than $ASCON_START_GAP seconds ago (default 20; stamp <logs>/.last-start),
#      it sleeps the rest: two runs started in the same millisecond share a run directory;
#   5. starts ascon/eval/lane-chain.sh <lane> <queue-dir> <port> <state> from that tree under nohup, with
#      ASCON_CHAIN_TAG=<sha8> (run ids <lane>-<sha8>-<queue stem>) and ASCON_EVAL_LOGS=<logs>
#      ($ASCON_FINAL/logs), writes $ASCON_FINAL/lane-<lane>.pid and the stamp, waits up to 15 s for its
#      CHAIN_START line and prints "CHAIN_RUN_<lane> pid=<pid> sha=<sha8> tree=<tree> queue-dir=<dir>".
# Exit 0 started; 2 BLOCKED (one line saying why). Read the result from the log lines, not from the exit
# code of the ssh that ran this (tailscale ssh always returns 0).
# Old trees: delete one (git -C <main> worktree remove <tree>) only after every lane that ran from it
# has ended (CHAIN_STOP / CHAIN_HELD in <logs>/<lane>.chain.log, and its pid gone).
set -u
lane="${1:?usage: mini-lane-start.sh <lane> <sha> <queue-dir> <port>}"; sha="${2:?sha}"; qdir="${3:?queue-dir}"; port="${4:?port}"
export PATH="$HOME/.local/ascon-docker-shim:$HOME/.homebrew/bin:$HOME/.foundry/bin:$PATH"
M="${ASCON_HOME:-$HOME/Developer/ascon}"
F="${ASCON_FINAL:-$HOME/ascon-final}"
base="${ASCON_WT_BASE:-$HOME/Developer}"
gap="${ASCON_START_GAP:-20}"
logs="$F/logs"
blocked() { echo "BLOCKED_$lane $1"; exit 2; }
for c in git python3 node npm anvil; do command -v "$c" > /dev/null || blocked "missing command $c"; done
printf '%s\n' "$lane" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*$' || blocked "lane name must be [A-Za-z0-9_.-]"
printf '%s\n' "$sha" | grep -Eq '^[0-9a-f]{7,40}$' || blocked "sha must be 7-40 lowercase hex digits"
printf '%s\n' "$port" | grep -Eq '^[0-9]+$' || blocked "port must be an integer"
printf '%s\n' "$gap" | grep -Eq '^[0-9]{1,3}$' || blocked "ASCON_START_GAP must be 0-999 seconds"
[ -d "$M/node_modules" ] && [ -d "$M/out" ] || blocked "no node_modules or out/ in the main checkout $M"
[ -f "$M/backtest/state/manifest.json" ] || blocked "no state dump in $M/backtest/state"
case "$qdir" in /*) ;; *) qdir="$(pwd -P)/$qdir" ;; esac
[ -d "$qdir/pending" ] || blocked "no $qdir/pending"
mkdir -p "$logs" || blocked "cannot create $logs"
[ -d "$logs/$lane.chain.lock" ] && blocked "lane $lane already has a chain ($logs/$lane.chain.lock, pid $(cat "$logs/$lane.chain.lock/pid" 2>/dev/null || echo unknown))"

# 1. The pinned tree.
if [ "${ASCON_FETCH:-1}" != 0 ]; then git -C "$M" fetch -q origin || blocked "git fetch failed in $M"; fi
full="$(git -C "$M" rev-parse --verify --quiet "$sha^{commit}")" || blocked "commit $sha not found in $M (pushed and fetched?)"
sha8="${full:0:8}"
W="$base/ascon-wt-$sha8"
if [ -e "$W" ]; then
  have="$(git -C "$W" rev-parse HEAD 2>/dev/null)" || blocked "$W exists but is not a checkout"
  [ "$have" = "$full" ] || blocked "$W is at ${have:0:8}, not $sha8: refusing to check out inside an existing tree"
else
  git -C "$M" worktree add -q --detach "$W" "$full" || blocked "git worktree add $W failed"
fi
[ -e "$W/node_modules" ] || ln -s "$M/node_modules" "$W/node_modules" || blocked "cannot link node_modules"
[ -e "$W/out" ] || ln -s "$M/out" "$W/out" || blocked "cannot link out"
if [ -f "$M/sdk/src/constants.local.ts" ] && [ ! -e "$W/sdk/src/constants.local.ts" ] && [ -d "$W/sdk/src" ]; then
  cp "$M/sdk/src/constants.local.ts" "$W/sdk/src/constants.local.ts" || blocked "cannot copy constants.local.ts"
fi
[ -f "$W/ascon/eval/lane-chain.sh" ] || blocked "$W has no ascon/eval/lane-chain.sh (commit $sha8 predates it)"

# 2. What the pending queues need.
n=0; missing=""
for q in "$qdir/pending/"*.txt; do
  [ -f "$q" ] || continue
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    read -r j t s c _ <<< "$line"
    [ -n "$j" ] || continue
    n=$((n + 1))
    for p in "$t" "$c"; do
      case "$p" in /*) [ -f "$p" ] ;; *) [ -f "$W/$p" ] ;; esac || missing="$missing $(basename "$q"):$j:$p"
    done
    [ -n "$s" ] && [ -d "$W/example/agents/$s" ] || missing="$missing $(basename "$q"):$j:example/agents/$s"
  done < "$q"
done
[ -z "$missing" ] || blocked "not in $W:$missing"

# 3. State dir.
state="$F/state-$lane"
if [ ! -d "$state" ]; then
  cp -R "$M/backtest/state" "$state" || blocked "cannot copy the state dump to $state"
  rm -f "$state/.effective-"*.yaml
  rmdir "$state/.run-matrix.lock" 2>/dev/null
fi

# 4. Stagger.
stamp="$logs/.last-start"
if [ -f "$stamp" ]; then
  age=$(( $(date +%s) - $(stat -f %m "$stamp" 2>/dev/null || stat -c %Y "$stamp" 2>/dev/null || echo 0) ))
  if [ "$age" -lt "$gap" ]; then echo "WAIT_$lane $((gap - age)) s after the last start"; sleep $((gap - age)); fi
fi

# 5. Start.
cd "$W" || blocked "cannot enter $W"
ASCON_EVAL_LOGS="$logs" ASCON_CHAIN_TAG="$sha8" nohup "$BASH" "$W/ascon/eval/lane-chain.sh" "$lane" "$qdir" "$port" "$state" \
  >> "$logs/$lane.chain.out" 2>&1 < /dev/null &
pid=$!
touch "$stamp"
echo "$pid" > "$F/lane-$lane.pid"
disown "$pid" 2>/dev/null
i=0
until grep -q "^CHAIN_START_$lane .* pid=$pid " "$logs/$lane.chain.log" 2>/dev/null; do
  kill -0 "$pid" 2>/dev/null || blocked "lane-chain exited at once: $(tail -3 "$logs/$lane.chain.out" | tr '\n' ' ')"
  i=$((i + 1)); [ "$i" -gt 150 ] && blocked "no CHAIN_START_$lane line for pid $pid after 15 s (it may still start: check $logs/$lane.chain.log)"
  sleep 0.1
done
echo "CHAIN_RUN_$lane pid=$pid sha=$sha8 tree=$W queue-dir=$qdir jobs-pending=$n"
