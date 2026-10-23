#!/bin/bash
# Controls for ascon/eval/run-matrix.sh in a throwaway tree with a fake npm.
#   /bin/bash ascon/eval/test-run-matrix.sh "$PWD"   (prints ALL_CONTROLS_OK, exits 0; else exits 1)
set -u
src="${1:?usage: /bin/bash $0 <repo root>, e.g. \"\$PWD\"}"
T="$(mktemp -d)"; cd "$T" || exit 2
mkdir -p ascon/eval node_modules/.bin out/MockOracleProvider.sol backtest/state bin logs
cp "$src/ascon/eval/run-matrix.sh" "$src/ascon/eval/check-matrix.py" ascon/eval/
printf '#!/bin/sh\n' > node_modules/.bin/tsx; chmod +x node_modules/.bin/tsx
echo '{}' > out/MockOracleProvider.sol/MockOracleProvider.json
echo '{}' > backtest/state/manifest.json; echo '{}' > backtest/state/venues-state.json
printf 'agents:\n  - id: a\n  - id: b\n' > roster.yaml
printf 'agents:\n  - id: a\n' > roster1.yaml
printf 'regimes: [calm, crash]\nseeds: [1]\n' > sc.yaml
# Fake npm: writes the matrix.json named by $FAKE, like the real CLI, and exits ${FAKE_RC:-0}.
cat > bin/npm <<'EOF'
#!/bin/sh
d="$PWD/runs/matrix x"; mkdir -p "$d"
A='[{"id":"a"},{"id":"b"}]'
case "$FAKE" in
  good)    echo "{\"scenariosPlanned\":2,\"scenarios\":[{\"regime\":\"calm\",\"seed\":1,\"agents\":$A},{\"regime\":\"crash\",\"seed\":1,\"agents\":$A}]}" ;;
  allfail) echo '{"scenariosPlanned":2,"scenarios":[{"regime":"calm","seed":1,"agents":null},{"regime":"crash","seed":1}]}' ;;
  zero)    echo '{"scenariosPlanned":0,"scenarios":[]}' ;;
  dupe)    echo "{\"scenariosPlanned\":2,\"scenarios\":[{\"regime\":\"calm\",\"seed\":1,\"agents\":$A},{\"regime\":\"calm\",\"seed\":1,\"agents\":$A}]}" ;;
  swapid)  B='[{"id":"a"},{"id":"a"}]'
           echo "{\"scenariosPlanned\":2,\"scenarios\":[{\"regime\":\"calm\",\"seed\":1,\"agents\":$A},{\"regime\":\"crash\",\"seed\":1,\"agents\":$B}]}" ;;
  failrow) echo "{\"scenariosPlanned\":2,\"scenarios\":[{\"regime\":\"calm\",\"seed\":1,\"agents\":$A},{\"regime\":\"crash\",\"seed\":1,\"agents\":$A},{\"regime\":\"calm\",\"seed\":1,\"agents\":null}]}" ;;
  hang)    sleep 307 & sleep 307; exit 0 ;;
esac > "$d/matrix.json"
echo "wrote $d/matrix.json and standings.json"
exit "${FAKE_RC:-0}"
EOF
chmod +x bin/npm
export PATH="$T/bin:$PATH" ASCON_EVAL_LOGS="$T/logs"
fails=0
check() { # label want-exit cmd...
  local label="$1" want="$2"; shift 2
  "$@" > /dev/null 2>&1; local got=$?
  printf '%-36s want %s got %s  %s\n' "$label" "$want" "$got" "$([ "$got" = "$want" ] && echo OK || echo MISMATCH)"
  [ "$got" = "$want" ] || fails=1
}
FAKE=good check "complete matrix (path with a space)" 0 bash ascon/eval/run-matrix.sh good roster.yaml sc.yaml 9
FAKE=allfail check "all scenarios failed, rc 0" 1 bash ascon/eval/run-matrix.sh allfail roster.yaml sc.yaml 9
FAKE=zero check "zero planned scenarios" 1 bash ascon/eval/run-matrix.sh zero roster.yaml sc.yaml 9
FAKE=dupe check "duplicate fills a missing scenario" 1 bash ascon/eval/run-matrix.sh dupe roster.yaml sc.yaml 9
FAKE=good check "agent count mismatch" 1 bash ascon/eval/run-matrix.sh count roster1.yaml sc.yaml 9
FAKE=swapid check "right count, wrong agent ids" 1 bash ascon/eval/run-matrix.sh swapid roster.yaml sc.yaml 9
FAKE=failrow check "complete set plus a failed duplicate" 1 bash ascon/eval/run-matrix.sh failrow roster.yaml sc.yaml 9
# Interrupted mid-run: the backtest's own children must be gone before the locks are released.
FAKE=hang bash ascon/eval/run-matrix.sh hang roster.yaml sc.yaml 9 > /dev/null 2>&1 &
runner=$!
sleep 2
kill -TERM "$runner"; wait "$runner"; got=$?
sleep 1
left="$(pgrep -f 'sleep 307' | wc -l | tr -d ' ')"
printf '%-36s want 1 got %s, %s sleepers left, locks %s  %s\n' "interrupted run" "$got" "$left" \
  "$(ls -d backtest/state/.run-matrix.lock logs/hang.lock 2>/dev/null | wc -l | tr -d ' ')" \
  "$([ "$got" = 1 ] && [ "$left" = 0 ] && ! ls -d backtest/state/.run-matrix.lock logs/hang.lock >/dev/null 2>&1 && echo OK || echo MISMATCH)"
[ "$got" = 1 ] && [ "$left" = 0 ] || { fails=1; pkill -f 'sleep 307'; }
FAKE=good FAKE_RC=3 check "complete output, backtest exit 3" 1 bash ascon/eval/run-matrix.sh rc3 roster.yaml sc.yaml 9
mkdir backtest/state/.run-matrix.lock
FAKE=good check "state dir already in use" 2 bash ascon/eval/run-matrix.sh locked roster.yaml sc.yaml 9
rmdir backtest/state/.run-matrix.lock
mkdir logs/busy.lock
FAKE=good check "same name already running" 2 bash ascon/eval/run-matrix.sh busy roster.yaml sc.yaml 9
[ -d logs/busy.lock ] || { echo "the other run's name lock was removed"; fails=1; }
rmdir logs/busy.lock
check "name with a path in it" 2 bash ascon/eval/run-matrix.sh ../escape roster.yaml sc.yaml 9
[ -e "$T/escape.log" ] && { echo "wrote outside the log dir"; fails=1; }
mv out out.x
FAKE=good check "forge artifacts missing" 2 bash ascon/eval/run-matrix.sh noforge roster.yaml sc.yaml 9
mv out.x out
echo "--- markers:"; cat logs/*.log | grep '^EXIT_'
ls -d backtest/state/.run-matrix.lock logs/*.lock 2>/dev/null && { echo "lock left behind"; fails=1; }
cd / && rm -rf "$T"
if [ "$fails" = 0 ]; then echo ALL_CONTROLS_OK; exit 0; fi
echo CONTROL_FAILED; exit 1
