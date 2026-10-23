#!/bin/bash
# Controls for ascon/eval/lane-status.sh (on synthetic logs) and ascon/eval/watch-lanes.sh (with a fake
# ssh and a scripted status command).
#   /bin/bash ascon/eval/test-lane-status.sh "$PWD"   (prints ALL_CONTROLS_OK, exits 0; else exits 1)
set -u
src="${1:?usage: /bin/bash $0 <repo root>, e.g. \"\$PWD\"}"
LS="$src/ascon/eval/lane-status.sh"; WL="$src/ascon/eval/watch-lanes.sh"
for f in "$LS" "$WL"; do [ -f "$f" ] || { echo "BLOCKED: no $f"; exit 2; }; done
T="$(mktemp -d)" || exit 2
trap 'python3 -c "import shutil, sys; shutil.rmtree(sys.argv[1], ignore_errors=True)" "$T"' EXIT
L="$T/logs"; mkdir -p "$L"
fails=0
ok() { if [ "$2" = 0 ]; then printf '%-58s OK\n' "$1"; else printf '%-58s MISMATCH %s\n' "$1" "$3"; fails=1; fi; }
flat() { tr '\n' '|'; }
dead=99999
while kill -0 "$dead" 2>/dev/null; do dead=$((dead + 1)); done
# A: done, then its chain idles. B: running (pid of this test), job b2 at scenario 3/12, an older run too.
# C: HOLD. D: no end line and its pid is gone.
cat > "$L/A.queue.log" <<EOF
QUEUE_START_A run=ra 2026-10-23T01:00:00 pid=$dead queue=q port=1 state=s jobs=1
NOTE_a1 run=ra slot=opus-1 template=t scenarios=s head=x arm_tree=y lib_tree=z dirty=0 load1=1
EXIT_a1=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=ra
QUEUE_DONE_A run=ra
EOF
printf '%s\n' "CHAIN_START_A x pid=1 dir=d port=1 state=s" "CHAIN_QUEUE_A file=q.txt run=ra" \
  "CHAIN_QUEUE_END_A file=q.txt rc=0 run=ra" "IDLE_A since=2026-10-23T02:00:00" > "$L/A.chain.log"
cat > "$L/B.queue.log" <<EOF
QUEUE_START_B run=rb0 2026-10-22T01:00:00 pid=$dead queue=q port=1 state=s jobs=1
EXIT_old=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=rb0
QUEUE_DONE_B run=rb0
QUEUE_START_B run=rb 2026-10-23T01:00:00 pid=$$ queue=q port=1 state=s jobs=2
NOTE_b1 run=rb slot=opus-1 template=t scenarios=s
EXIT_b1=1 VERDICT=FAIL COLLISION=SKIP ARM=SKIP run=rb
NOTE_b2 run=rb slot=opus-1a template=t scenarios=s
EOF
printf '%s\n' "[backtest] scenario 1/12 calm#1003" "[backtest] scenario 2/12 x#1003" "[backtest] scenario 3/12 y#1003" > "$L/b2.log"
printf '%s\n' "QUEUE_START_C run=rc 2026-10-23T01:00:00 pid=$dead queue=q port=1 state=s jobs=3" "HOLD_C run=rc c1 free=3GiB" > "$L/C.queue.log"
printf '%s\n' "QUEUE_START_D run=rd 2026-10-23T01:00:00 pid=$dead queue=q port=1 state=s jobs=3" "NOTE_d1 run=rd slot=opus-1 template=t scenarios=s" > "$L/D.queue.log"

out="$(ASCON_EVAL_LOGS="$L" bash "$LS" 2>&1)"; rc=$?
c=0
[ "$rc" = 0 ] || c=1
for want in "LANE A run=ra state=IDLE job=- scen=- jobs=1/1" "IDLE_A since=2026-10-23T02:00:00" \
  "LANE B run=rb state=RUNNING job=b2 scen=3/12 jobs=1/2" "EXIT_b1=1 VERDICT=FAIL COLLISION=SKIP ARM=SKIP run=rb" \
  "LANE C run=rc state=HOLD job=- scen=- jobs=0/3" "HOLD_C run=rc c1 free=3GiB" \
  "LANE D run=rd state=DEAD job=d1 scen=- jobs=0/3" "ALL_DONE=0 HOLD=1"; do
  printf '%s\n' "$out" | grep -qxF -- "$want" || { c=1; echo "  missing: $want"; }
done
printf '%s\n' "$out" | grep -q 'EXIT_old' && c=1
[ "$(printf '%s\n' "$out" | tail -1)" = "ALL_DONE=0 HOLD=1" ] && printf '%s\n' "$out" | grep -q '^HOST load1=' || c=1
ok "(a) idle / running / hold / dead lanes, flags" "$c" "$(printf '%s' "$out" | flat)"
out="$(ASCON_EVAL_LOGS="$L" bash "$LS" A 2>&1)"
[ "$(printf '%s\n' "$out" | tail -1)" = "ALL_DONE=1 HOLD=0" ]
ok "(b) only the idle lane: ALL_DONE=1 HOLD=0" "$?" "$(printf '%s' "$out" | flat)"
out="$(ASCON_EVAL_LOGS="$T/none" bash "$LS" 2>&1)"
[ "$(printf '%s\n' "$out" | tail -1)" = "ALL_DONE=0 HOLD=1" ] && printf '%s\n' "$out" | grep -q '^NO_LOGS'
ok "(c) no logs dir: not done, HOLD" "$?" "$(printf '%s' "$out" | flat)"

# watch-lanes: a fake ssh that runs the command locally, and a status command that plays a script, one
# step per call: running, no sentinel, a hang (killed by the timeout), then the final reply.
printf '#!/bin/bash\nbash -c "$1"\n' > "$T/fake-ssh"; chmod +x "$T/fake-ssh"
cat > "$T/status.sh" <<'EOF'
n=$(cat "$T/n" 2>/dev/null || echo 0); echo $((n + 1)) > "$T/n"
case "$n" in
  0) printf '%s\n' 'LANE A run=ra state=RUNNING job=a1 scen=2/12 jobs=0/2' 'HOST load1=8 free_gib=100' 'ALL_DONE=0 HOLD=0' ;;
  1) echo 'connection reset' ;;
  2) sleep 30; echo 'ALL_DONE=1 HOLD=0' ;;
  3) printf '%s\n' 'LANE A run=ra state=RUNNING job=a1 scen=9/12 jobs=0/2' 'HOST load1=8 free_gib=100' 'ALL_DONE=0 HOLD=0' ;;
  4) printf '%s\n' 'LANE A run=ra state=RUNNING job=a2 scen=1/12 jobs=1/2' 'EXIT_a1=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=ra' 'HOST load1=8 free_gib=100' 'ALL_DONE=0 HOLD=0' ;;
  *) printf '%s\n' "${FINAL_LANE:-LANE A run=ra state=DONE job=- scen=- jobs=2/2}" 'EXIT_a1=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=ra' 'EXIT_a2=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=ra' 'QUEUE_DONE_A run=ra' 'HOST load1=8 free_gib=100' "${FINAL:-ALL_DONE=1 HOLD=0}" ;;
esac
EOF
export T
t0=$(date +%s)
out="$(ASCON_SSH="$T/fake-ssh" ASCON_WATCH_EVERY=1 ASCON_WATCH_TIMEOUT=2 bash "$WL" "bash $T/status.sh" 2>&1)"; rc=$?
dt=$(( $(date +%s) - t0 ))
body="$(printf '%s\n' "$out" | cut -c7-)"
want="$(printf '%s\n' 'LANE A run=ra state=RUNNING job=a1 scen=2/12 jobs=0/2' \
  'WATCH_UNAVAILABLE rc=0 connection reset ' \
  'LANE A run=ra state=RUNNING job=a2 scen=1/12 jobs=1/2' 'EXIT_a1=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=ra' \
  'LANE A run=ra state=DONE job=- scen=- jobs=2/2' 'EXIT_a2=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=ra' 'QUEUE_DONE_A run=ra' \
  'WATCH_ALL_DONE HOST load1=8 free_gib=100')"
[ "$rc" = 0 ] && [ "$body" = "$want" ] && [ "$dt" -lt 20 ]
ok "(d) watch: new lines only, one UNAVAILABLE, hang cut, exit 0" "$?" "rc=$rc dt=$dt $(printf '%s' "$out" | flat)"
echo 5 > "$T/n"
out="$(FINAL='ALL_DONE=1 HOLD=1' FINAL_LANE='LANE A run=ra state=HOLD job=- scen=- jobs=1/2' ASCON_SSH="$T/fake-ssh" ASCON_WATCH_EVERY=1 bash "$WL" "bash $T/status.sh" 2>&1)"; rc=$?
[ "$rc" = 3 ] && printf '%s\n' "$out" | grep -q 'WATCH_HOLD'
ok "(e) watch: HOLD=1 exits 3" "$?" "rc=$rc $(printf '%s' "$out" | flat)"
ASCON_WATCH_EVERY=0 bash "$WL" "true" > "$T/f.out" 2>&1; rc=$?
[ "$rc" = 2 ]
ok "(f) watch: bad interval refused" "$?" "rc=$rc"

if [ "$fails" = 0 ]; then echo ALL_CONTROLS_OK; exit 0; fi
echo CONTROL_FAILED; exit 1
