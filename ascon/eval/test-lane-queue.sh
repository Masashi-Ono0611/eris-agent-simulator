#!/bin/bash
# Controls for ascon/eval/lane-queue.sh in a throwaway tree, with a fake run-matrix and a fake
# collision checker (and, in control f, the real run-matrix.sh and check-matrix.py with a fake npm).
# Control p also makes a directory under /tmp, removed at the end.
#   /bin/bash ascon/eval/test-lane-queue.sh "$PWD"   (prints ALL_CONTROLS_OK, exits 0; else exits 1)
set -u
src="${1:?repo}"
T="$(mktemp -d)"; cd "$T" || exit 2
TL=""
echo "bash $BASH_VERSION ($BASH)"
mkdir -p ascon/eval example/agents/slotA example/agents/slotB fake bin dfbad dfseq res logs \
  node_modules/.bin out/MockOracleProvider.sol backtest/state
cp "$src/ascon/eval/lane-queue.sh" "$src/ascon/eval/run-matrix.sh" "$src/ascon/eval/check-matrix.py" ascon/eval/
printf '#!/bin/sh\n' > node_modules/.bin/tsx; chmod +x node_modules/.bin/tsx
echo '{}' > out/MockOracleProvider.sol/MockOracleProvider.json
echo '{}' > backtest/state/manifest.json; echo '{}' > backtest/state/venues-state.json
cat > tmpl.yaml <<'EOF'
agents:
  - id: noop
    wallet: AUTO
    baseline: true
  - id: cand
    dir: __SLOT_DIR__
    wallet: AUTO
    env: { ERIS_AGENT_FROZEN: "1" }
EOF
grep -v __SLOT_DIR__ tmpl.yaml > tmpl-noph.yaml
printf 'regimes: [calm]\nseeds: [1]\n' > sc.yaml
# Fake run-matrix: logs its arguments, writes a marker like the real one; the job name picks the outcome.
cat > fake/run-matrix.sh <<'EOF'
#!/bin/bash
job="$1"; log="$ASCON_EVAL_LOGS/$job.log"
echo "$*" >> "$T/ran.log"
: > "$log"
pass() {
  d="$PWD/runs/matrix $job"; mkdir -p "$d"; echo '{}' > "$d/matrix.json"
  echo "EXIT_$job=0 VERDICT=PASS 1/1 scenarios, 2 agents each, $d/matrix.json" >> "$log"; exit 0
}
case "$job" in
  *fail*)   echo "EXIT_$job=0 VERDICT=FAIL 0/1 scenarios have results" >> "$log"; exit 1 ;;
  *block*)  echo "EXIT_$job=- VERDICT=BLOCKED state dump missing" >> "$log"; exit 2 ;;
  *liar*)   echo "EXIT_$job=0 VERDICT=FAIL 0/1 scenarios have results" >> "$log"; exit 0 ;;
  *nopath*) echo "EXIT_$job=0 VERDICT=PASS 1/1 scenarios" >> "$log"; exit 0 ;;
  *ghost*)  echo "EXIT_$job=0 VERDICT=PASS 1/1 scenarios, 2 agents each, $PWD/runs/no such/matrix.json" >> "$log"; exit 0 ;;
  *hang*)   trap 'echo "$job got TERM" >> "$T/ran.log"; echo "EXIT_$job=- VERDICT=FAIL interrupted" >> "$log"; exit 1' TERM
            i=0
            while [ ! -e "$T/release-$job" ] && [ "$i" -lt 300 ]; do sleep 0.1; i=$((i + 1)); done
            pass ;;
  *)        pass ;;
esac
EOF
cat > fake/check-collision.py <<'EOF'
import os, sys
open(os.environ["T"] + "/cc.log", "a").write(sys.argv[1] + "\n")
print("fake collision verdict")
sys.exit(int(os.environ.get("FAKE_CC_RC", "0")))
EOF
# Fake npm for control f (the real run-matrix): a complete matrix, except for the job f2bad.
cat > bin/npm <<'EOF'
#!/bin/sh
d="$PWD/runs/matrix x"; mkdir -p "$d"
case "$*" in
  *f2bad*) echo '{"scenariosPlanned":1,"scenarios":[{"regime":"calm","seed":1,"agents":null}]}' ;;
  *) echo '{"scenariosPlanned":1,"scenarios":[{"regime":"calm","seed":1,"agents":[{"id":"noop"},{"id":"cand"}]}]}' ;;
esac > "$d/matrix.json"
echo "wrote $d/matrix.json and standings.json"
exit 0
EOF
chmod +x bin/npm
printf '#!/bin/sh\necho "df: output nobody can read"\n' > dfbad/df; chmod +x dfbad/df
# Fake df for control l: 100 GiB free on the first call, 1 GiB after.
cat > dfseq/df <<'EOF'
#!/bin/sh
n=$(cat "$T/dfcount" 2>/dev/null || echo 0); echo $((n + 1)) > "$T/dfcount"
echo "Filesystem 1024-blocks Used Available Capacity Mounted"
if [ "$n" = 0 ]; then echo "/dev/x 1 1 104857600 1% /"; else echo "/dev/x 1 1 1048576 1% /"; fi
EOF
chmod +x dfseq/df
unset ASCON_QUEUE_RUN_ID
export T PATH="$T/bin:$PATH" ASCON_EVAL_LOGS="$T/logs" ASCON_QUEUE_MIN_FREE_GIB=0 \
  ASCON_RUN_MATRIX="$T/fake/run-matrix.sh" ASCON_CHECK_COLLISION="$T/fake/check-collision.py"
LQ=ascon/eval/lane-queue.sh
fails=0
q() { local f="$1"; shift; printf '%s\n' "$@" > "$f"; }
lines() { printf '%s\n' "$@"; }
# The lines of one run (file, run id) with " run=<id>" taken out: this is how a monitor tells runs apart.
of_run_f() {
  awk -v t=" run=$2" '{ s = $0 " "; p = index(s, t " "); if (p) print substr($0, 1, p - 1) substr($0, p + length(t)) }' "$1" 2>/dev/null
}
of_run() { of_run_f "logs/$1.queue.log" "$2"; }   # lane, run id
markers() { of_run "$1" "$2" | grep -E '^(EXIT_|HOLD_|QUEUE_DONE_|STOPPED_)'; }
ok() { # label 0|1 detail-on-mismatch
  if [ "$2" = 0 ]; then printf '%-58s OK\n' "$1"; else printf '%-58s MISMATCH %s\n' "$1" "$3"; fails=1; fi
}
wait_for() { # pattern file: up to 10 s
  local i=0
  while ! grep -q "$1" "$2" 2>/dev/null; do i=$((i + 1)); [ "$i" -gt 100 ] && return 1; sleep 0.1; done
}
flat() { tr '\n' '|'; }

# (a) Two jobs, the first fails: both markers in order, QUEUE_DONE, exit 0; the arm and matrix are noted.
: > ran.log; : > cc.log
q a.q "# two jobs" "a1fail tmpl.yaml slotA sc.yaml" "" "a2pass tmpl.yaml slotA sc.yaml   # passes"
ASCON_QUEUE_RUN_ID=ra "$BASH" "$LQ" la a.q 9101 st-a > res/a.out 2>&1; rc=$?
c=0
[ "$rc" = 0 ] || c=1
[ "$(markers la ra)" = "$(lines 'EXIT_a1fail=1 VERDICT=FAIL COLLISION=SKIP' \
  'EXIT_a2pass=0 VERDICT=PASS COLLISION=PASS' 'QUEUE_DONE_la')" ] || c=1
[ "$(cat ran.log)" = "$(lines "a1fail $T/logs/rosters/a1fail.yaml sc.yaml 9101 st-a" \
  "a2pass $T/logs/rosters/a2pass.yaml sc.yaml 9101 st-a")" ] || c=1
[ "$(cat logs/rosters/a2pass.yaml)" = "$(sed 's/__SLOT_DIR__/slotA/' tmpl.yaml)" ] || c=1
[ "$(cat cc.log)" = "$T/runs/matrix a2pass/matrix.json" ] || c=1
[ "$(of_run la ra | grep '^NOTE_')" = "$(lines 'NOTE_a1fail slot=slotA template=tmpl.yaml scenarios=sc.yaml' \
  'NOTE_a2pass slot=slotA template=tmpl.yaml scenarios=sc.yaml' "NOTE_a2pass matrix=$T/runs/matrix a2pass/matrix.json")" ] || c=1
[ -d logs/la.queue.lock ] && c=1
ok "(a) fail then pass: two markers in order, QUEUE_DONE" "$c" "rc=$rc $(of_run la ra | flat)"

# (b) Disk threshold above the free space: HOLD, exit 3, nothing run.
: > ran.log
q b.q "b1 tmpl.yaml slotA sc.yaml" "b2 tmpl.yaml slotA sc.yaml"
ASCON_QUEUE_MIN_FREE_GIB=999999 ASCON_QUEUE_RUN_ID=rb "$BASH" "$LQ" lb b.q 9102 st-b > res/b.out 2>&1; rc=$?
c=0
[ "$rc" = 3 ] || c=1
[ "$(markers lb rb | wc -l | tr -d ' ')" = 1 ] || c=1
markers lb rb | grep -Eqx 'HOLD_lb b1 free=[0-9]+GiB' || c=1
[ -s ran.log ] && c=1
[ -d logs/lb.queue.lock ] && c=1
ok "(b) disk below threshold: HOLD, exit 3, no job run" "$c" "rc=$rc $(markers lb rb | flat)"
# (b2) df output it cannot read counts as no space.
PATH="$T/dfbad:$PATH" ASCON_QUEUE_RUN_ID=rb2 "$BASH" "$LQ" lb2 b.q 9102 st-b > res/b2.out 2>&1; rc=$?
c=0
[ "$rc" = 3 ] || c=1
[ "$(markers lb2 rb2)" = "HOLD_lb2 b1 free=unknown (df output not understood)" ] || c=1
[ -s ran.log ] && c=1
ok "(b2) df output not understood: HOLD, exit 3" "$c" "rc=$rc $(markers lb2 rb2 | flat)"

# (c) Roster render failures fail that job only; the queue goes on.
: > ran.log
mkdir -p logs/rosters/c5dir.yaml
q c.q "c1noph tmpl-noph.yaml slotA sc.yaml" "c2nosuch tmpl.yaml nosuchslot sc.yaml" \
  "c3notmpl missing.yaml slotA sc.yaml" "c4pass tmpl.yaml slotA sc.yaml" \
  "c5dir tmpl.yaml slotA sc.yaml" "c6slash tmpl.yaml ../agents sc.yaml"
ASCON_QUEUE_RUN_ID=rc "$BASH" "$LQ" lc c.q 9103 st-c > res/c.out 2>&1; rc=$?
c=0
[ "$rc" = 0 ] || c=1
[ "$(markers lc rc)" = "$(lines 'EXIT_c1noph=- VERDICT=FAIL COLLISION=SKIP' \
  'EXIT_c2nosuch=- VERDICT=FAIL COLLISION=SKIP' 'EXIT_c3notmpl=- VERDICT=FAIL COLLISION=SKIP' \
  'EXIT_c4pass=0 VERDICT=PASS COLLISION=PASS' 'EXIT_c5dir=- VERDICT=FAIL COLLISION=SKIP' \
  'EXIT_c6slash=- VERDICT=FAIL COLLISION=SKIP' 'QUEUE_DONE_lc')" ] || c=1
[ "$(cut -d' ' -f1 ran.log)" = c4pass ] || c=1
for n in 'c1noph no __SLOT_DIR__ in tmpl-noph.yaml' 'c2nosuch no slot dir example/agents/nosuchslot' \
  'c3notmpl roster template not readable: missing.yaml' "c5dir could not write $T/logs/rosters/c5dir.yaml" \
  'c6slash no slot dir example/agents/../agents'; do
  of_run lc rc | grep -qxF "NOTE_$n" || { c=1; echo "  missing NOTE_$n"; }
done
ls -d logs/rosters/c*.lock > /dev/null 2>&1 && c=1
ok "(c) no placeholder / no slot / unwritable: FAIL, goes on" "$c" "rc=$rc $(markers lc rc | flat)"

# (d) Collision checker verdicts: rc 1 FAIL, rc 2 BLOCKED, checker missing BLOCKED.
: > cc.log
q d.q "d1pass tmpl.yaml slotA sc.yaml"
FAKE_CC_RC=1 ASCON_QUEUE_RUN_ID=rd "$BASH" "$LQ" ld d.q 9104 st-d > res/d.out 2>&1; rc=$?
c=0
[ "$rc" = 0 ] || c=1
[ "$(markers ld rd)" = "$(lines 'EXIT_d1pass=0 VERDICT=PASS COLLISION=FAIL' 'QUEUE_DONE_ld')" ] || c=1
[ "$(cat cc.log)" = "$T/runs/matrix d1pass/matrix.json" ] || c=1
of_run ld rd | grep -qxF 'NOTE_d1pass check-collision rc 1: fake collision verdict' || c=1
ok "(d) collision checker returns 1: COLLISION=FAIL" "$c" "rc=$rc $(markers ld rd | flat)"
FAKE_CC_RC=2 ASCON_QUEUE_RUN_ID=rd2 "$BASH" "$LQ" ld2 d.q 9104 st-d > res/d2.out 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(markers ld2 rd2)" = "$(lines 'EXIT_d1pass=0 VERDICT=PASS COLLISION=BLOCKED' 'QUEUE_DONE_ld2')" ]
ok "(d2) collision checker returns 2: COLLISION=BLOCKED" "$?" "rc=$rc $(markers ld2 rd2 | flat)"
ASCON_CHECK_COLLISION="$T/fake/no-such-checker.py" ASCON_QUEUE_RUN_ID=rd3 "$BASH" "$LQ" ld3 d.q 9104 st-d > res/d3.out 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(markers ld3 rd3)" = "$(lines 'EXIT_d1pass=0 VERDICT=PASS COLLISION=BLOCKED' 'QUEUE_DONE_ld3')" ]
ok "(d3) collision checker missing: COLLISION=BLOCKED" "$?" "rc=$rc $(markers ld3 rd3 | flat)"

# (e) A second instance of a running lane is refused and leaves the lock alone; the locks name the pid.
: > ran.log
q e.q "e1hang tmpl.yaml slotA sc.yaml"
ASCON_QUEUE_RUN_ID=re1 "$BASH" "$LQ" le e.q 9105 st-e > res/e1.out 2>&1 &
first=$!
c=0
wait_for '^e1hang ' ran.log || { c=1; echo "  the first instance never started its job"; }
[ "$(head -1 res/e1.out)" = "QUEUE_RUN_le run=re1 pid=$first" ] || c=1
of_run le re1 | grep -q "^QUEUE_START_le .* pid=$first " || c=1
[ "$(cat logs/le.queue.lock/pid 2>/dev/null)" = "$first run=re1 lane=le" ] || c=1
[ "$(cat logs/rosters/e1hang.lock/pid 2>/dev/null)" = "$first run=re1 lane=le" ] || c=1
ASCON_QUEUE_RUN_ID=re2 "$BASH" "$LQ" le e.q 9106 st-e2 > res/e2.out 2>&1; rc2=$?
[ "$rc2" = 2 ] || c=1
grep -q '^REFUSED_le run=re2 lane le is already running' res/e2.out || c=1
[ "$(cat logs/le.queue.lock/pid 2>/dev/null)" = "$first run=re1 lane=le" ] || c=1
[ "$(grep -c '^e1hang ' ran.log)" = 1 ] || c=1
[ "$(grep -c '^QUEUE_START_le ' logs/le.queue.log)" = 1 ] || c=1
q e3.q "e3pass tmpl.yaml slotA sc.yaml"
"$BASH" "$LQ" le3 e3.q 9107 st-e3 > res/e3.out 2>&1 || c=1
touch release-e1hang; wait "$first"; rc1=$?
[ "$rc1" = 0 ] || c=1
[ "$(markers le re1)" = "$(lines 'EXIT_e1hang=0 VERDICT=PASS COLLISION=PASS' 'QUEUE_DONE_le')" ] || c=1
[ -d logs/le.queue.lock ] && c=1
[ -d logs/rosters/e1hang.lock ] && c=1
"$BASH" "$LQ" le e3.q 9105 st-e > res/e4.out 2>&1 || c=1
ok "(e) same lane refused while held; other lane runs" "$c" "rc2=$rc2 rc1=$rc1 $(markers le re1 | flat) $(grep '^REFUSED_' res/e2.out)"

# (f) The real run-matrix.sh (fake npm): its PASS line gives the matrix path, which has a space.
: > cc.log
q f.q "f1real tmpl.yaml slotA sc.yaml" "f2bad tmpl.yaml slotA sc.yaml"
ASCON_RUN_MATRIX= ASCON_QUEUE_RUN_ID=rf "$BASH" "$LQ" lf f.q 9108 backtest/state > res/f.out 2>&1; rc=$?
c=0
[ "$rc" = 0 ] || c=1
[ "$(markers lf rf)" = "$(lines 'EXIT_f1real=0 VERDICT=PASS COLLISION=PASS' \
  'EXIT_f2bad=1 VERDICT=FAIL COLLISION=SKIP' 'QUEUE_DONE_lf')" ] || c=1
[ "$(cat cc.log)" = "$T/runs/matrix x/matrix.json" ] || c=1
of_run lf rf | grep -qxF "NOTE_f1real matrix=$T/runs/matrix x/matrix.json" || c=1
[ -d backtest/state/.run-matrix.lock ] && c=1
ok "(f) real run-matrix: PASS path parsed, FAIL carried" "$c" "rc=$rc $(markers lf rf | flat) cc=$(flat < cc.log)"

# (g) TERM while a job runs: the job is stopped, marked FAIL, no further job, locks released.
: > ran.log
q g.q "g1hang tmpl.yaml slotA sc.yaml" "g2pass tmpl.yaml slotA sc.yaml"
ASCON_QUEUE_RUN_ID=rg "$BASH" "$LQ" lg g.q 9109 st-g > res/g.out 2>&1 &
lq=$!
c=0
wait_for '^g1hang ' ran.log || { c=1; echo "  the lane never started its job"; }
kill -TERM "$lq"; wait "$lq"; rc=$?
[ "$rc" = 1 ] || c=1
grep -qx 'g1hang got TERM' ran.log || c=1
grep -q '^g2pass ' ran.log && c=1
[ "$(markers lg rg)" = "$(lines 'EXIT_g1hang=1 VERDICT=FAIL COLLISION=SKIP' 'STOPPED_lg')" ] || c=1
[ -d logs/lg.queue.lock ] && c=1
[ -d logs/rosters/g1hang.lock ] && c=1
pgrep -f "$T/fake/run-matrix.sh" > /dev/null && { c=1; touch release-g1hang; }
ok "(g) TERM mid-job: job stopped and marked, queue stops" "$c" "rc=$rc $(markers lg rg | flat)"

# (h) Refused before anything runs: exit 2, no lock, no job.
refused() { # label command...
  local label="$1"; shift
  : > ran.log
  "$@" > res/h.out 2>&1; local rc=$? c=0
  [ "$rc" = 2 ] || c=1
  [ -s ran.log ] && c=1
  grep -q '^REFUSED_' res/h.out || c=1
  ls -d logs/lh*.queue.lock > /dev/null 2>&1 && c=1
  ok "$label" "$c" "rc=$rc $(grep '^REFUSED_' res/h.out | head -1)"
}
q h0.q "h0 tmpl.yaml slotA sc.yaml"
refused "(h) queue line with 3 fields" "$BASH" "$LQ" lh "$(q h1.q 'h1 tmpl.yaml slotA'; echo h1.q)" 9110 st-h
refused "(h) queue line with 5 fields" "$BASH" "$LQ" lh "$(q h2.q 'h2 tmpl.yaml slotA sc.yaml x'; echo h2.q)" 9110 st-h
refused "(h) job listed twice" "$BASH" "$LQ" lh "$(q h3.q 'h3 tmpl.yaml slotA sc.yaml' 'h3 tmpl.yaml slotA sc.yaml'; echo h3.q)" 9110 st-h
refused "(h) job names differing only in case" "$BASH" "$LQ" lh "$(q h7.q 'h7 tmpl.yaml slotA sc.yaml' 'H7 tmpl.yaml slotB sc.yaml'; echo h7.q)" 9110 st-h
refused "(h) job name with a path" "$BASH" "$LQ" lh "$(q h4.q '../h4 tmpl.yaml slotA sc.yaml'; echo h4.q)" 9110 st-h
refused "(h) job name ending in .queue" "$BASH" "$LQ" lh "$(q h5.q 'lh.queue tmpl.yaml slotA sc.yaml'; echo h5.q)" 9110 st-h
refused "(h) queue with only comments" "$BASH" "$LQ" lh "$(q h6.q '# nothing' ''; echo h6.q)" 9110 st-h
refused "(h) queue file missing" "$BASH" "$LQ" lh no-such.q 9110 st-h
refused "(h) lane name with a path" "$BASH" "$LQ" ../lh h0.q 9110 st-h
refused "(h) port not a number" "$BASH" "$LQ" lh h0.q 91x st-h
refused "(h) min free GiB not a number" env ASCON_QUEUE_MIN_FREE_GIB=ten "$BASH" "$LQ" lh h0.q 9110 st-h
refused "(h) run id with a space" env ASCON_QUEUE_RUN_ID='r h' "$BASH" "$LQ" lh h0.q 9110 st-h
refused "(h) run id with a path" env ASCON_QUEUE_RUN_ID='../rh' "$BASH" "$LQ" lh h0.q 9110 st-h
[ -e logs/lh.queue.log ] && { echo "a refused start wrote the queue log"; fails=1; }
[ -e "$T/../lh.queue.log" ] && { echo "wrote outside the log dir"; fails=1; }

# (i) run-matrix outcomes: rc 2 BLOCKED, rc 0 without a PASS line FAIL, PASS without a path BLOCKED.
: > cc.log
q i.q "i1block tmpl.yaml slotA sc.yaml" "i2liar tmpl.yaml slotA sc.yaml" "i3nopath tmpl.yaml slotA sc.yaml"
ASCON_QUEUE_RUN_ID=ri "$BASH" "$LQ" li i.q 9111 st-i > res/i.out 2>&1; rc=$?
c=0
[ "$rc" = 0 ] || c=1
[ "$(markers li ri)" = "$(lines 'EXIT_i1block=2 VERDICT=BLOCKED COLLISION=SKIP' \
  'EXIT_i2liar=0 VERDICT=FAIL COLLISION=SKIP' 'EXIT_i3nopath=0 VERDICT=PASS COLLISION=BLOCKED' 'QUEUE_DONE_li')" ] || c=1
[ -s cc.log ] && c=1
ok "(i) BLOCKED / exit 0 without PASS / PASS without path" "$c" "rc=$rc $(markers li ri | flat)"

# (j) Started from another directory with the script's absolute path: relative paths are from the repo root.
: > ran.log; : > cc.log
q j.q "j1pass tmpl.yaml slotA sc.yaml"
( cd / && ASCON_QUEUE_RUN_ID=rj "$BASH" "$T/$LQ" lj j.q 9112 st-j > "$T/res/j.out" 2>&1 ); rc=$?
c=0
[ "$rc" = 0 ] || c=1
[ "$(markers lj rj)" = "$(lines 'EXIT_j1pass=0 VERDICT=PASS COLLISION=PASS' 'QUEUE_DONE_lj')" ] || c=1
[ "$(cat ran.log)" = "j1pass $T/logs/rosters/j1pass.yaml sc.yaml 9112 st-j" ] || c=1
[ "$(cat cc.log)" = "$T/runs/matrix j1pass/matrix.json" ] || c=1
ok "(j) run from / : queue, template, slot found from repo root" "$c" "rc=$rc $(head -2 res/j.out | flat)"

# (k) Threshold at the real free space of this filesystem: HOLD 2 GiB above it, run 1 GiB below it.
fk="$(df -Pk "$T" | awk 'NR == 2 && NF == 6 { print $4 }')"
case "$fk" in ''|*[!0-9]*) fk=0 ;; esac
fg=$((fk / 1048576))
if [ "$fg" -lt 2 ]; then
  printf '%-58s BLOCKED %s\n' "(k) threshold just above / below the free space" "free ${fg} GiB, need 2 to test"; fails=1
else
  : > ran.log
  q k.q "k1pass tmpl.yaml slotA sc.yaml"
  ASCON_QUEUE_MIN_FREE_GIB=$((fg + 2)) ASCON_QUEUE_RUN_ID=rk1 "$BASH" "$LQ" lk k.q 9113 st-k > res/k1.out 2>&1; rk1=$?
  ASCON_QUEUE_MIN_FREE_GIB=$((fg - 1)) ASCON_QUEUE_RUN_ID=rk2 "$BASH" "$LQ" lk k.q 9113 st-k > res/k2.out 2>&1; rk2=$?
  c=0
  [ "$rk1" = 3 ] || c=1
  markers lk rk1 | grep -Eqx 'HOLD_lk k1pass free=[0-9]+GiB' || c=1
  [ "$rk2" = 0 ] || c=1
  [ "$(markers lk rk2)" = "$(lines 'EXIT_k1pass=0 VERDICT=PASS COLLISION=PASS' 'QUEUE_DONE_lk')" ] || c=1
  [ "$(grep -c '^k1pass ' ran.log)" = 1 ] || c=1
  ok "(k) threshold just above / below the free space (${fg} GiB)" "$c" "rk1=$rk1 rk2=$rk2 $(markers lk rk1 | flat)$(markers lk rk2 | flat)"
fi

# (l) The disk is checked before every job: enough for job 1, too little for job 2.
: > ran.log; rm -f dfcount
q l.q "l1pass tmpl.yaml slotA sc.yaml" "l2pass tmpl.yaml slotA sc.yaml"
PATH="$T/dfseq:$PATH" ASCON_QUEUE_MIN_FREE_GIB=10 ASCON_QUEUE_RUN_ID=rl "$BASH" "$LQ" ll l.q 9114 st-l > res/l.out 2>&1; rc=$?
c=0
[ "$rc" = 3 ] || c=1
[ "$(markers ll rl)" = "$(lines 'EXIT_l1pass=0 VERDICT=PASS COLLISION=PASS' 'HOLD_ll l2pass free=1GiB')" ] || c=1
[ "$(cut -d' ' -f1 ran.log)" = l1pass ] || c=1
[ "$(cat dfcount 2>/dev/null)" = 2 ] || c=1
ok "(l) disk drops after job 1: HOLD before job 2" "$c" "rc=$rc $(markers ll rl | flat)"

# (m) A PASS line naming a matrix.json that does not exist: COLLISION=BLOCKED, the checker is not run.
: > cc.log
q m.q "m1ghost tmpl.yaml slotA sc.yaml"
ASCON_QUEUE_RUN_ID=rm "$BASH" "$LQ" lm m.q 9115 st-m > res/m.out 2>&1; rc=$?
c=0
[ "$rc" = 0 ] || c=1
[ "$(markers lm rm)" = "$(lines 'EXIT_m1ghost=0 VERDICT=PASS COLLISION=BLOCKED' 'QUEUE_DONE_lm')" ] || c=1
[ -s cc.log ] && c=1
of_run lm rm | grep -qxF "NOTE_m1ghost the matrix.json named in the PASS line of $T/logs/m1ghost.log does not exist: $T/runs/no such/matrix.json" || c=1
of_run lm rm | grep -q '^NOTE_m1ghost matrix=' && c=1
ok "(m) PASS line names a missing matrix.json: BLOCKED" "$c" "rc=$rc $(markers lm rm | flat)"

# (n) A finished lane restarted, refused: its log still ends with the old QUEUE_DONE, but nothing in it
# carries the new run id, so a monitor waiting for that id does not see the lane as done.
: > ran.log
q n.q "n1pass tmpl.yaml slotA sc.yaml"
c=0
ASCON_QUEUE_RUN_ID=rn1 "$BASH" "$LQ" ln n.q 9116 st-n > res/n1.out 2>&1 || c=1
nlines="$(wc -l < logs/ln.queue.log)"
q nbad.q "n2 tmpl.yaml slotA"
ASCON_QUEUE_RUN_ID=rn2 "$BASH" "$LQ" ln nbad.q 9116 st-n > res/n2.out 2>&1; r2=$?
[ "$r2" = 2 ] || c=1
[ "$(head -1 res/n2.out)" = "$(grep '^QUEUE_RUN_' res/n2.out)" ] || c=1
grep -Eqx 'QUEUE_RUN_ln run=rn2 pid=[0-9]+' res/n2.out || c=1
grep -q '^REFUSED_ln run=rn2 nbad.q line 1: ' res/n2.out || c=1
[ "$(tail -1 logs/ln.queue.log)" = "QUEUE_DONE_ln run=rn1" ] || c=1   # what a grep for QUEUE_DONE_ln finds
[ -z "$(of_run ln rn2)" ] || c=1
mkdir logs/ln.queue.lock   # a lock left by a killed run
ASCON_QUEUE_RUN_ID=rn3 "$BASH" "$LQ" ln n.q 9116 st-n > res/n3.out 2>&1; r3=$?
[ "$r3" = 2 ] || c=1
grep -q '^REFUSED_ln run=rn3 lane ln is already running' res/n3.out || c=1
[ -z "$(of_run ln rn3)" ] || c=1
rmdir logs/ln.queue.lock
ASCON_QUEUE_RUN_ID=rn1 "$BASH" "$LQ" ln n.q 9116 st-n > res/n4.out 2>&1; r4=$?   # a run id used before
[ "$r4" = 2 ] || c=1
grep -q '^REFUSED_ln run=rn1 run id rn1 was used before' res/n4.out || c=1
[ -d logs/ln.queue.lock ] && c=1
[ "$(wc -l < logs/ln.queue.log)" = "$nlines" ] || c=1
[ "$(grep -c '^n1pass ' ran.log)" = 1 ] || c=1
"$BASH" "$LQ" ln n.q 9116 st-n > res/n5.out 2>&1 || c=1   # no run id given: one is made and printed
gid="$(head -1 res/n5.out | sed -n 's/^QUEUE_RUN_ln run=\([0-9]\{8\}T[0-9]\{6\}-\([0-9][0-9]*\)\) pid=\2$/\1/p')"
[ -n "$gid" ] || c=1
[ -n "$gid" ] && [ "$(markers ln "$gid")" = "$(lines 'EXIT_n1pass=0 VERDICT=PASS COLLISION=PASS' 'QUEUE_DONE_ln')" ] || c=1
ok "(n) refused restart: no line carries its run id" "$c" "r2=$r2 r3=$r3 r4=$r4 gid=$gid $(tail -1 logs/ln.queue.log)"

# (o) A job name in use by another run: refused at the start, or BLOCKED when reached, and the roster
# that the running job uses is not touched.
: > ran.log
c=0
q oc.q "o0hang tmpl.yaml slotA sc.yaml" "o1hang tmpl.yaml slotB sc.yaml" "o2pass tmpl.yaml slotA sc.yaml"
q oa.q "o1hang tmpl.yaml slotA sc.yaml"
q ob.q "o3pass tmpl.yaml slotA sc.yaml" "o1hang tmpl.yaml slotB sc.yaml"
ASCON_QUEUE_RUN_ID=roc "$BASH" "$LQ" loc oc.q 9117 st-oc > res/oc.out 2>&1 &
pc=$!
wait_for '^o0hang ' ran.log || { c=1; echo "  loc never started o0hang"; }
ASCON_QUEUE_RUN_ID=roa "$BASH" "$LQ" loa oa.q 9118 st-oa > res/oa.out 2>&1 &
pa=$!
wait_for '^o1hang ' ran.log || { c=1; echo "  loa never started o1hang"; }
[ "$(grep 'dir:' logs/rosters/o1hang.yaml)" = "    dir: slotA" ] || c=1
ASCON_QUEUE_RUN_ID=rob "$BASH" "$LQ" lob ob.q 9119 st-ob > res/ob.out 2>&1; rb=$?
[ "$rb" = 2 ] || c=1
grep -q "^REFUSED_lob run=rob job o1hang is in use by another run ($T/logs/rosters/o1hang.lock)" res/ob.out || c=1
[ -d logs/lob.queue.lock ] && c=1
touch release-o0hang; wait "$pc"; rcc=$?
[ "$rcc" = 0 ] || c=1
[ "$(markers loc roc)" = "$(lines 'EXIT_o0hang=0 VERDICT=PASS COLLISION=PASS' \
  'EXIT_o1hang=- VERDICT=BLOCKED COLLISION=SKIP' 'EXIT_o2pass=0 VERDICT=PASS COLLISION=PASS' 'QUEUE_DONE_loc')" ] || c=1
of_run loc roc | grep -qxF "NOTE_o1hang another run named o1hang is in progress ($T/logs/rosters/o1hang.lock); roster not touched" || c=1
[ "$(grep 'dir:' logs/rosters/o1hang.yaml)" = "    dir: slotA" ] || c=1
touch release-o1hang; wait "$pa"; rca=$?
[ "$rca" = 0 ] || c=1
[ "$(markers loa roa)" = "$(lines 'EXIT_o1hang=0 VERDICT=PASS COLLISION=PASS' 'QUEUE_DONE_loa')" ] || c=1
of_run loa roa | grep -qxF 'NOTE_o1hang slot=slotA template=tmpl.yaml scenarios=sc.yaml' || c=1
[ "$(grep 'dir:' logs/rosters/o1hang.yaml)" = "    dir: slotA" ] || c=1
[ "$(cut -d' ' -f1 ran.log | flat)" = "o0hang|o1hang|o2pass|" ] || c=1
ok "(o) job in use by another lane: refused / BLOCKED, roster kept" "$c" "rb=$rb rcc=$rcc rca=$rca $(markers loc roc | flat)"
# (o2) The same with run-matrix's own lock <logs>/<job>.lock (a run started by hand).
: > ran.log
c=0
printf 'sentinel\n' > logs/rosters/o5pass.yaml
mkdir logs/o5pass.lock
q o5.q "o5pass tmpl.yaml slotA sc.yaml"
ASCON_QUEUE_RUN_ID=ro5 "$BASH" "$LQ" lo5 o5.q 9120 st-o5 > res/o5.out 2>&1; r5=$?
[ "$r5" = 2 ] || c=1
grep -q "^REFUSED_lo5 run=ro5 job o5pass is in use by another run ($T/logs/o5pass.lock)" res/o5.out || c=1
rmdir logs/o5pass.lock
q o6.q "o6hang tmpl.yaml slotA sc.yaml" "o5pass tmpl.yaml slotA sc.yaml"
ASCON_QUEUE_RUN_ID=ro6 "$BASH" "$LQ" lo6 o6.q 9121 st-o6 > res/o6.out 2>&1 &
p6=$!
wait_for '^o6hang ' ran.log || { c=1; echo "  lo6 never started o6hang"; }
mkdir logs/o5pass.lock
touch release-o6hang; wait "$p6"; r6=$?
[ "$r6" = 0 ] || c=1
[ "$(markers lo6 ro6)" = "$(lines 'EXIT_o6hang=0 VERDICT=PASS COLLISION=PASS' \
  'EXIT_o5pass=- VERDICT=BLOCKED COLLISION=SKIP' 'QUEUE_DONE_lo6')" ] || c=1
[ "$(cat logs/rosters/o5pass.yaml)" = sentinel ] || c=1
grep -q '^o5pass ' ran.log && c=1
rmdir logs/o5pass.lock
ok "(o2) run-matrix lock held: refused / BLOCKED, roster kept" "$c" "r5=$r5 r6=$r6 $(markers lo6 ro6 | flat)"

# (p) Logs under /tmp: a WARN line after QUEUE_START. None for the logs of every other control (not /tmp).
c=0
treal="$(cd -P -- "$T" > /dev/null && pwd -P)"
case "$treal/" in /tmp/*|/private/tmp/*) ;; *) TL="$(mktemp -d /tmp/ascon-lq-test.XXXXXX)" || TL="" ;; esac
if [ -z "$TL" ]; then
  printf '%-58s BLOCKED %s\n' "(p) logs under /tmp: WARN; elsewhere: none" "no dir under /tmp, or the test tree itself is under /tmp ($treal)"; fails=1
else
  tlreal="$(cd -P -- "$TL" > /dev/null && pwd -P)"
  q p.q "p1pass tmpl.yaml slotA sc.yaml"
  ASCON_EVAL_LOGS="$TL" ASCON_QUEUE_RUN_ID=rp "$BASH" "$LQ" lp p.q 9122 st-p > res/p.out 2>&1; rc=$?
  [ "$rc" = 0 ] || c=1
  [ "$(of_run_f "$TL/lp.queue.log" rp | sed -n 2p)" = "WARN_lp logs in $tlreal: macOS deletes files under /tmp unused for 3 days; set ASCON_EVAL_LOGS outside /tmp for long runs" ] || c=1
  [ "$(of_run_f "$TL/lp.queue.log" rp | grep -E '^(EXIT_|QUEUE_DONE_)' | flat)" = "EXIT_p1pass=0 VERDICT=PASS COLLISION=PASS|QUEUE_DONE_lp|" ] || c=1
  grep -q '^WARN_' logs/*.queue.log && c=1
  ok "(p) logs under /tmp: WARN; elsewhere: none" "$c" "rc=$rc $(grep '^WARN_' "$TL/lp.queue.log" logs/*.queue.log | head -2 | flat)"
fi

echo "--- queue logs:"
for f in logs/*.queue.log ${TL:+"$TL/lp.queue.log"}; do echo "## ${f#logs/}"; sed "s#$T#<T>#g" "$f"; done
left="$(ls -d logs/*.lock logs/rosters/*.lock 2>/dev/null)"   # ls exits 1 when either glob is empty
[ -n "$left" ] && { echo "lock left behind: $(printf '%s' "$left" | flat)"; fails=1; }
touch release-e1hang release-g1hang release-o0hang release-o1hang release-o6hang
cd / && python3 -c 'import shutil, sys; shutil.rmtree(sys.argv[1])' "$T"
[ -n "$TL" ] && python3 -c 'import shutil, sys; shutil.rmtree(sys.argv[1])' "$TL"
if [ "$fails" = 0 ]; then echo ALL_CONTROLS_OK; exit 0; fi
echo CONTROL_FAILED; exit 1
