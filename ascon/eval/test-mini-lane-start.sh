#!/bin/bash
# Controls for ascon/eval/mini-lane-start.sh in a throwaway git repo (the "main checkout"), with the real
# lane-chain.sh, a fake lane-queue and fake node/npm/anvil.
#   /bin/bash ascon/eval/test-mini-lane-start.sh "$PWD"   (prints ALL_CONTROLS_OK, exits 0; else exits 1)
set -u
src="${1:?usage: /bin/bash $0 <repo root>, e.g. \"\$PWD\"}"
for f in mini-lane-start.sh lane-chain.sh; do
  [ -f "$src/ascon/eval/$f" ] || { echo "BLOCKED: no $src/ascon/eval/$f"; exit 2; }
done
T="$(cd "$(mktemp -d)" && pwd -P)" || exit 2
cleanup() {
  for s in "$T"/q*/; do touch "$s/STOP" 2>/dev/null; done
  sleep 2
  for p in "$T"/final/lane-*.pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null; done
  python3 -c "import shutil, sys; shutil.rmtree(sys.argv[1], ignore_errors=True)" "$T"
}
trap cleanup EXIT
M="$T/main"; mkdir -p "$M/ascon/eval" "$M/example/agents/slotA" "$M/bin" "$T/home/.local/ascon-docker-shim" "$T/wt"
cp "$src/ascon/eval/lane-chain.sh" "$src/ascon/eval/mini-lane-start.sh" "$M/ascon/eval/"
echo 'export const a = 1;' > "$M/example/agents/slotA/agent.ts"
printf 'agents:\n  - id: slot\n    dir: __SLOT_DIR__\n' > "$M/tmpl.yaml"
printf 'regimes: [calm]\nseeds: [1]\n' > "$M/sc.yaml"
git -C "$M" init -q && git -C "$M" add -A && git -C "$M" -c user.name=t -c user.email=t@t commit -qm one || { echo "BLOCKED: git"; exit 2; }
sha1="$(git -C "$M" rev-parse HEAD)"
echo 'export const b = 1;' > "$M/example/agents/slotA/b.ts"
git -C "$M" add -A && git -C "$M" -c user.name=t -c user.email=t@t commit -qm two
sha2="$(git -C "$M" rev-parse HEAD)"
mkdir -p "$M/node_modules" "$M/out" "$M/backtest/state"; echo '{}' > "$M/backtest/state/manifest.json"
for c in node npm anvil; do printf '#!/bin/sh\nexit 0\n' > "$M/bin/$c"; chmod +x "$M/bin/$c"; done
cat > "$T/fake-lq.sh" <<'EOF'
#!/bin/bash
echo "$1 $(basename "$2") $3 $4 run=$ASCON_QUEUE_RUN_ID cwd=$(pwd -P)" >> "$T/lq.log"
EOF
export T HOME="$T/home" PATH="$M/bin:$PATH" ASCON_HOME="$M" ASCON_FINAL="$T/final" ASCON_WT_BASE="$T/wt" \
  ASCON_FETCH=0 ASCON_LANE_QUEUE="$T/fake-lq.sh" ASCON_CHAIN_POLL=1 ASCON_START_GAP=3
MS="$src/ascon/eval/mini-lane-start.sh"
fails=0
ok() { if [ "$2" = 0 ]; then printf '%-58s OK\n' "$1"; else printf '%-58s MISMATCH %s\n' "$1" "$3"; fails=1; fi; }
wait_for() { local i=0; while ! grep -q "$1" "$2" 2>/dev/null; do i=$((i + 1)); [ "$i" -gt 150 ] && return 1; sleep 0.1; done; }
flat() { tr '\n' '|'; }
mkq() { mkdir -p "$T/$1/pending"; [ -n "$2" ] && printf '%s\n' "$3" > "$T/$1/pending/$2"; }
: > "$T/lq.log"

# (a) A fresh start: the tree at sha1 with node_modules and out linked, the state copied, the chain running
# from that tree with run id <lane>-<sha8>-<stem>, pid file and stamp written.
mkq qa q1.txt "j1 tmpl.yaml slotA sc.yaml"
out="$("$BASH" "$MS" A "${sha1:0:10}" "$T/qa" 8700 2>&1)"; rc=$?
W1="$T/wt/ascon-wt-${sha1:0:8}"
c=0
[ "$rc" = 0 ] || c=1
printf '%s\n' "$out" | grep -qx "CHAIN_RUN_A pid=[0-9]* sha=${sha1:0:8} tree=$W1 queue-dir=$T/qa jobs-pending=1" || c=1
[ "$(git -C "$W1" rev-parse HEAD 2>/dev/null)" = "$sha1" ] && [ -L "$W1/node_modules" ] && [ -L "$W1/out" ] || c=1
[ -f "$T/final/state-A/manifest.json" ] && [ -f "$T/final/lane-A.pid" ] && [ -f "$T/final/logs/.last-start" ] || c=1
wait_for "^A q1.txt 8700 $T/final/state-A run=A-${sha1:0:8}-q1 cwd=$W1\$" "$T/lq.log" || c=1
[ -e "$W1/example/agents/slotA/b.ts" ] && c=1
ok "(a) fresh start: pinned tree, links, state, chain running" "$c" "rc=$rc $(printf '%s' "$out" | flat) $(flat < "$T/lq.log")"

# (b) The same lane again while its chain runs: BLOCKED, nothing new starts.
mkq qb "" ""
out="$("$BASH" "$MS" A "$sha1" "$T/qb" 8700 2>&1)"; rc=$?
[ "$rc" = 2 ] && printf '%s\n' "$out" | grep -q '^BLOCKED_A lane A already has a chain'
ok "(b) same lane while its chain runs: BLOCKED" "$?" "rc=$rc $out"

# (c) Another lane within the gap waits, then starts on a second tree (sha2), the first tree untouched.
mkq qc q1.txt "j2 tmpl.yaml slotA sc.yaml"
t0=$(date +%s)
out="$("$BASH" "$MS" B "$sha2" "$T/qc" 8710 2>&1)"; rc=$?
dt=$(( $(date +%s) - t0 ))
W2="$T/wt/ascon-wt-${sha2:0:8}"
c=0
[ "$rc" = 0 ] && printf '%s\n' "$out" | grep -q '^WAIT_B ' && [ "$dt" -ge 1 ] || c=1
[ "$(git -C "$W2" rev-parse HEAD)" = "$sha2" ] && [ "$(git -C "$W1" rev-parse HEAD)" = "$sha1" ] || c=1
wait_for "^B q1.txt 8710 .* run=B-${sha2:0:8}-q1 cwd=$W2\$" "$T/lq.log" || c=1
ok "(c) other lane inside the gap: waits, own tree, first kept" "$c" "rc=$rc dt=$dt $(printf '%s' "$out" | flat)"

# (d) A queue naming a slot dir the tree does not have: BLOCKED, no chain, no stamp change.
touch "$T/qa/STOP" "$T/qc/STOP"; wait_for '^CHAIN_STOP_A' "$T/final/logs/A.chain.log"; wait_for '^CHAIN_STOP_B' "$T/final/logs/B.chain.log"
sleep 1
mkq qd q1.txt "j3 tmpl.yaml slotZ sc.yaml"
before="$(ls -l "$T/final/logs/.last-start")"
out="$("$BASH" "$MS" D "$sha1" "$T/qd" 8720 2>&1)"; rc=$?
[ "$rc" = 2 ] && printf '%s\n' "$out" | grep -q "^BLOCKED_D not in $W1: q1.txt:j3:example/agents/slotZ" \
  && [ ! -f "$T/final/lane-D.pid" ] && [ "$(ls -l "$T/final/logs/.last-start")" = "$before" ]
ok "(d) slot dir missing in the tree: BLOCKED, nothing starts" "$?" "rc=$rc $out"

# (e) An existing tree at another commit is never checked out: BLOCKED.
git -C "$W1" checkout -q --detach "$sha2"
mkq qe q1.txt "j4 tmpl.yaml slotA sc.yaml"
out="$("$BASH" "$MS" E "$sha1" "$T/qe" 8730 2>&1)"; rc=$?
[ "$rc" = 2 ] && printf '%s\n' "$out" | grep -q "refusing to check out inside an existing tree" && [ "$(git -C "$W1" rev-parse HEAD)" = "$sha2" ]
ok "(e) existing tree at another commit: BLOCKED, left as is" "$?" "rc=$rc $out"
git -C "$W1" checkout -q --detach "$sha1"

# (f) Bad sha, unknown commit, missing roster file: BLOCKED.
out1="$("$BASH" "$MS" F 'HEAD;x' "$T/qe" 8740 2>&1)"; r1=$?
out2="$("$BASH" "$MS" F deadbeef "$T/qe" 8740 2>&1)"; r2=$?
mkq qf q1.txt "j5 nosuch.yaml slotA sc.yaml"
out3="$("$BASH" "$MS" F "$sha1" "$T/qf" 8740 2>&1)"; r3=$?
[ "$r1$r2$r3" = 222 ] && printf '%s\n' "$out2" | grep -q 'not found' && printf '%s\n' "$out3" | grep -q 'q1.txt:j5:nosuch.yaml'
ok "(f) bad sha / unknown commit / missing roster: BLOCKED" "$?" "$r1$r2$r3 $(printf '%s|%s|%s' "$out1" "$out2" "$out3")"

# (g) A restart of lane A after its chain stopped reuses the tree at the same commit.
mkq qg q2.txt "j6 tmpl.yaml slotA sc.yaml"
out="$("$BASH" "$MS" A "$sha1" "$T/qg" 8700 2>&1)"; rc=$?
[ "$rc" = 0 ] && wait_for "^A q2.txt 8700 .* run=A-${sha1:0:8}-q2 cwd=$W1\$" "$T/lq.log"
ok "(g) restart on an existing tree at the same commit" "$?" "rc=$rc $out"
touch "$T/qg/STOP"

if [ "$fails" = 0 ]; then echo ALL_CONTROLS_OK; exit 0; fi
echo CONTROL_FAILED; exit 1
