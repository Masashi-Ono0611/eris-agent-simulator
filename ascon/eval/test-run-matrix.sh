#!/bin/bash
# Controls for ascon/eval/run-matrix.sh in a throwaway tree with a fake npm.
#   bash ascon/eval/test-run-matrix.sh "$PWD"   (prints ALL_CONTROLS_OK)
set -u
src="${1:?repo}"
T="$(mktemp -d)"; cd "$T"
mkdir -p ascon/eval node_modules/.bin out/MockOracleProvider.sol backtest/state bin logs
cp "$src/ascon/eval/run-matrix.sh" "$src/ascon/eval/check-matrix.py" ascon/eval/
printf '#!/bin/sh\n' > node_modules/.bin/tsx; chmod +x node_modules/.bin/tsx
echo '{}' > out/MockOracleProvider.sol/MockOracleProvider.json
echo '{}' > backtest/state/manifest.json; echo '{}' > backtest/state/venues-state.json
printf 'agents:\n  - id: a\n  - id: b\n' > roster.yaml
printf 'regimes: [calm]\nseeds: [1]\n' > sc.yaml
# Fake npm: writes a matrix.json chosen by $FAKE (allfail | good) and exits 0, like the real CLI.
cat > bin/npm <<'EOF'
#!/bin/sh
mkdir -p runs/matrix-x
case "$FAKE" in
  allfail) echo '{"scenariosPlanned":2,"scenarios":[{"s":1,"regime":"calm","seed":1,"agents":null},{"s":2,"regime":"crash","seed":1}]}' > runs/matrix-x/matrix.json ;;
  good) echo '{"scenariosPlanned":1,"scenarios":[{"s":1,"regime":"calm","seed":1,"agents":[{"id":"a"},{"id":"b"}]}]}' > runs/matrix-x/matrix.json ;;
esac
echo "wrote $PWD/runs/matrix-x/matrix.json and standings.json"
exit 0
EOF
chmod +x bin/npm
export PATH="$T/bin:$PATH" ASCON_EVAL_LOGS="$T/logs"
check() { # label want-exit cmd...
  local label="$1" want="$2"; shift 2
  "$@" > /dev/null 2>&1; local got=$?
  printf '%-34s want %s got %s  %s\n' "$label" "$want" "$got" "$([ "$got" = "$want" ] && echo OK || echo MISMATCH)"
  [ "$got" = "$want" ]
}
fails=0
FAKE=good check "complete matrix" 0 bash ascon/eval/run-matrix.sh good roster.yaml sc.yaml 9 || fails=1
FAKE=allfail check "all scenarios failed, rc 0" 1 bash ascon/eval/run-matrix.sh allfail roster.yaml sc.yaml 9 || fails=1
printf 'agents:\n  - id: a\n' > roster1.yaml
FAKE=good check "agent count mismatch" 1 bash ascon/eval/run-matrix.sh count roster1.yaml sc.yaml 9 || fails=1
mkdir backtest/state/.run-matrix.lock
FAKE=good check "state dir already in use" 2 bash ascon/eval/run-matrix.sh locked roster.yaml sc.yaml 9 || fails=1
rmdir backtest/state/.run-matrix.lock
mv out out.x
FAKE=good check "forge artifacts missing" 2 bash ascon/eval/run-matrix.sh noforge roster.yaml sc.yaml 9 || fails=1
mv out.x out
echo "--- markers:"; cat logs/*.log | grep '^EXIT_'
ls -d backtest/state/.run-matrix.lock 2>/dev/null && { echo "lock left behind"; fails=1; }
cd /; rm -rf "$T"
[ "$fails" = 0 ] && echo ALL_CONTROLS_OK || echo CONTROL_FAILED
