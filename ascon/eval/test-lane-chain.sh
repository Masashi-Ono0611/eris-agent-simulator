#!/bin/bash
# Controls for ascon/eval/lane-chain.sh in a throwaway tree with a fake lane-queue.
#   /bin/bash ascon/eval/test-lane-chain.sh "$PWD"   (prints ALL_CONTROLS_OK, exits 0; else exits 1)
# The fake lane-queue logs "<lane> <queue> <port> <state> run=<id>" and exits with the number on the
# queue file's first "rc=<n>" line (0 if none); "hang" makes it wait for a release file or TERM.
set -u
src="${1:?usage: /bin/bash $0 <repo root>, e.g. \"\$PWD\"}"
[ -f "$src/ascon/eval/lane-chain.sh" ] || { echo "BLOCKED: no $src/ascon/eval/lane-chain.sh"; exit 2; }
T="$(mktemp -d)" || exit 2
trap 'python3 -c "import shutil, sys; shutil.rmtree(sys.argv[1], ignore_errors=True)" "$T"' EXIT
mkdir -p "$T/ascon/eval" "$T/logs"
cp "$src/ascon/eval/lane-chain.sh" "$T/ascon/eval/"
cat > "$T/fake-lq.sh" <<'EOF'
#!/bin/bash
echo "$1 $(basename "$2") $3 $4 run=$ASCON_QUEUE_RUN_ID" >> "$T/lq.log"
if grep -q '^hang' "$2"; then
  trap 'echo "TERM $(basename "$2")" >> "$T/lq.log"; exit 1' TERM
  i=0; while [ ! -e "$T/release" ] && [ "$i" -lt 300 ]; do sleep 0.1; i=$((i + 1)); done
fi
rc="$(sed -n 's/^rc=\([0-9]*\)$/\1/p' "$2" | head -1)"
exit "${rc:-0}"
EOF
export T ASCON_EVAL_LOGS="$T/logs" ASCON_LANE_QUEUE="$T/fake-lq.sh" ASCON_CHAIN_POLL=1
LC="$T/ascon/eval/lane-chain.sh"
fails=0
ok() { if [ "$2" = 0 ]; then printf '%-56s OK\n' "$1"; else printf '%-56s MISMATCH %s\n' "$1" "$3"; fails=1; fi; }
wait_for() { local i=0; while ! grep -q "$1" "$2" 2>/dev/null; do i=$((i + 1)); [ "$i" -gt 150 ] && return 1; sleep 0.1; done; }
# chain <out> <args...>: run a chain that should end by itself; after 15 s it is stopped (rc 124), so a
# chain that wrongly keeps going fails the control instead of hanging the test.
chain() {
  local out="$1" p i=0; shift
  "$BASH" "$LC" "$@" > "$out" 2>&1 & p=$!
  while kill -0 "$p" 2>/dev/null && [ "$i" -lt 150 ]; do sleep 0.1; i=$((i + 1)); done
  if kill -0 "$p" 2>/dev/null; then kill -TERM "$p"; wait "$p"; return 124; fi
  wait "$p"
}
flat() { tr '\n' '|'; }
mkq() { mkdir -p "$T/$1/pending"; printf '%s\n' "${@:3}" > "$T/$1/pending/$2"; }

# (a) Two queues in name order, run ids <lane>-<tag>-<stem>, both to done/; IDLE once; STOP ends with 0.
: > "$T/lq.log"
mkq qa 20-second.txt "job x"; mkq qa 10-first.txt "job y" "rc=1"
ASCON_CHAIN_TAG=abc12345 "$BASH" "$LC" A qa 8700 st-A > "$T/a.out" 2>&1 & pid=$!
c=0
wait_for '^IDLE_A since=' "$T/logs/A.chain.log" || c=1
sleep 2.5
touch "$T/qa/STOP"; i=0; while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 150 ]; do sleep 0.1; i=$((i + 1)); done
kill -0 "$pid" 2>/dev/null && kill -TERM "$pid"; wait "$pid"; rc=$?
[ "$rc" = 0 ] || c=1
[ "$(cat "$T/lq.log")" = "$(printf '%s\n' 'A 10-first.txt 8700 st-A run=A-abc12345-10-first' 'A 20-second.txt 8700 st-A run=A-abc12345-20-second')" ] || c=1
[ -f "$T/qa/done/10-first.txt" ] && [ -f "$T/qa/done/20-second.txt" ] || c=1
[ "$(grep -c '^IDLE_A' "$T/logs/A.chain.log")" = 1 ] || c=1
grep -q '^CHAIN_QUEUE_END_A file=10-first.txt rc=1 ' "$T/logs/A.chain.log" && grep -q '^CHAIN_STOP_A' "$T/logs/A.chain.log" || c=1
[ -d "$T/logs/A.chain.lock" ] && c=1
ok "(a) two queues in order, done/, IDLE once, STOP exits 0" "$c" "rc=$rc $(flat < "$T/lq.log") $(flat < "$T/logs/A.chain.log")"

# (b) HOLD (rc 3): the file goes to held/, the chain exits 3, the next file stays in pending/.
: > "$T/lq.log"
mkq qb 1.txt "rc=3"; mkq qb 2.txt "job z"
chain "$T/b.out" B qb 8710 st-B; rc=$?
c=0
[ "$rc" = 3 ] && [ -f "$T/qb/held/1.txt" ] && [ -f "$T/qb/pending/2.txt" ] || c=1
[ "$(wc -l < "$T/lq.log" | tr -d ' ')" = 1 ] && grep -q '^CHAIN_HELD_B file=1.txt rc=3' "$T/logs/B.chain.log" || c=1
ok "(b) HOLD: held/, exit 3, rest stays pending" "$c" "rc=$rc $(flat < "$T/b.out")"

# (c) lane-queue refused (rc 2): held/, exit 2.
mkq qc 1.txt "rc=2"
chain "$T/c.out" C qc 8720 st-C; rc=$?
[ "$rc" = 2 ] && [ -f "$T/qc/held/1.txt" ] && grep -q '^CHAIN_HELD_C file=1.txt rc=2' "$T/logs/C.chain.log"
ok "(c) refused queue: held/, exit 2" "$?" "rc=$rc $(flat < "$T/c.out")"

# (d) A second chain on a lane that has one is refused; (e) a file added while idle starts;
# (f) TERM while a queue runs: lane-queue gets TERM, the chain exits 1, the file stays in running/.
: > "$T/lq.log"; mkdir -p "$T/qd/pending"
"$BASH" "$LC" D qd 8730 st-D > "$T/d.out" 2>&1 & pid=$!
wait_for '^IDLE_D' "$T/logs/D.chain.log"
chain "$T/d2.out" D qd 8730 st-D; rc2=$?
[ "$rc2" = 2 ] && grep -q '^CHAIN_REFUSED_D lane D already has a chain' "$T/d2.out"
ok "(d) second chain on the same lane refused" "$?" "rc=$rc2 $(flat < "$T/d2.out")"
printf 'hang\n' > "$T/qd/pending/late.txt"
c=0
wait_for 'late.txt' "$T/lq.log" || c=1
ok "(e) a file added while idle starts" "$c" "$(flat < "$T/logs/D.chain.log")"
kill -TERM "$pid"; wait "$pid"; rc=$?
c=0
[ "$rc" = 1 ] && [ -f "$T/qd/running/late.txt" ] || c=1
grep -q '^TERM late.txt' "$T/lq.log" && grep -q '^CHAIN_STOPPED_D' "$T/logs/D.chain.log" || c=1
[ -d "$T/logs/D.chain.lock" ] && c=1
ok "(f) TERM: lane-queue stopped, exit 1, file in running/" "$c" "rc=$rc $(flat < "$T/lq.log")"

# (g) STOP already there: exit 0, nothing runs.
: > "$T/lq.log"; mkq qg 1.txt "job"; touch "$T/qg/STOP"
chain "$T/g.out" G qg 8740 st-G; rc=$?
[ "$rc" = 0 ] && [ ! -s "$T/lq.log" ] && [ -f "$T/qg/pending/1.txt" ]
ok "(g) STOP before start: exit 0, nothing runs" "$?" "rc=$rc $(flat < "$T/g.out")"

# (h) Bad arguments are refused before anything moves.
chain "$T/h.out" 'a/b' qg 8740 st-G; r1=$?
chain "$T/h2.out" H no-such-dir 8740 st-G; r2=$?
ASCON_CHAIN_POLL=0 chain "$T/h3.out" H qg 8740 st-G; r3=$?
[ "$r1$r2$r3" = 222 ]
ok "(h) bad lane / missing dir / bad poll: refused" "$?" "rc=$r1$r2$r3"

touch "$T/release"
if [ "$fails" = 0 ]; then echo ALL_CONTROLS_OK; exit 0; fi
echo CONTROL_FAILED; exit 1
