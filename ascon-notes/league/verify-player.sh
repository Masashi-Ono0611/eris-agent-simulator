#!/bin/bash
# Verify one league player in its own worktree: typecheck, static check, its tests, env/import/forbidden-call scans.
# usage: verify-player.sh <player-id>      (read-only except for running the checks)
id="${1:?usage: verify-player.sh <player-id>}"
case "$id" in *[!A-Za-z0-9_-]*|"") echo "bad id" >&2; exit 2;; esac
SCAFFOLD="$(cd "$(dirname "$0")/../.." && pwd)"
WT="$(cd "$SCAFFOLD/.." && pwd)/league-${id}"
[ -d "$WT/example/agents/$id" ] || { echo "BLOCKED ${id}: no example/agents/${id} in ${WT}"; exit 2; }
cd "$WT" || exit 2
status=0
row() { printf '%-9s %-22s %s\n' "$1" "$2" "$3"; }
if npm run typecheck > /tmp/vp-${id}-tc.log 2>&1; then row PASS typecheck ""; else row FAIL typecheck "$(grep -c 'error TS' /tmp/vp-${id}-tc.log) errors (see /tmp/vp-${id}-tc.log)"; status=1; fi
if npm run check:strategy -- "example/agents/${id}/agent.ts" > /tmp/vp-${id}-cs.log 2>&1 && grep -q 'PASS (1 files)' /tmp/vp-${id}-cs.log; then row PASS check:strategy ""; else row FAIL check:strategy "see /tmp/vp-${id}-cs.log"; status=1; fi
if [ -f "test/${id}.test.ts" ]; then
  node --import tsx --test "test/${id}.test.ts" > /tmp/vp-${id}-t.log 2>&1
  t=$(grep -E '^ℹ tests ' /tmp/vp-${id}-t.log | awk '{print $3}'); p=$(grep -E '^ℹ pass ' /tmp/vp-${id}-t.log | awk '{print $3}'); f=$(grep -E '^ℹ fail ' /tmp/vp-${id}-t.log | awk '{print $3}')
  if [ -n "$t" ] && [ "${f:-1}" = "0" ] && [ "$t" -gt 0 ]; then row PASS "tests" "${p}/${t}"; else row FAIL tests "tests=${t:-?} fail=${f:-?}"; status=1; fi
else row BLOCKED tests "no test/${id}.test.ts"; status=1; fi
stage="$(mktemp -d)"; cp "example/agents/${id}/prompt.md" "${stage}/${id}.md" 2>/dev/null
node --import tsx "$SCAFFOLD/ascon-notes/release/check-prompts.ts" "$stage" > /tmp/vp-${id}-pr.log 2>&1
if grep -q "^PASS staged/${id}$" /tmp/vp-${id}-pr.log; then row PASS prompt.md ""; else row FAIL prompt.md "$(tail -1 /tmp/vp-${id}-pr.log | cut -c1-120)"; status=1; fi
python3 -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$stage"
n=$(grep -n 'process\.env' example/agents/${id}/*.ts 2>/dev/null | wc -l | tr -d ' '); [ "$n" = "0" ] && row PASS "no process.env" "" || { row WARN "process.env refs" "$n"; }
n=$(grep -nE 'anvil_|evm_|eth_sendTransaction|txpool_|eth_subscribe' example/agents/${id}/*.ts 2>/dev/null | wc -l | tr -d ' '); [ "$n" = "0" ] && row PASS "no forbidden rpc" "" || { row FAIL "forbidden rpc refs" "$n"; status=1; }
n=$(grep -nE 'from "\.\./' example/agents/${id}/*.ts 2>/dev/null | grep -vE '\.\./(lib|runtime)/' | wc -l | tr -d ' '); [ "$n" = "0" ] && row PASS "self-contained imports" "" || { row FAIL "cross-agent imports" "$n"; status=1; }
n=$(grep -nE 'fetch\(|https?://|WebSocket|net\.connect|child_process' example/agents/${id}/*.ts 2>/dev/null | wc -l | tr -d ' '); [ "$n" = "0" ] && row PASS "no outbound net refs" "" || { row WARN "net-like refs" "$n"; }
exit $status
