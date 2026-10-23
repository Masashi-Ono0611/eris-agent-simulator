#!/bin/bash
# Run every control test of the evaluation harness with /bin/bash (the macOS bash 3.2 the lanes use).
#   /bin/bash ascon/eval/test-all.sh   (prints ALL_HARNESS_OK and exits 0 only if every test passed)
# A test counts as passed only if it exits 0 and its log has a line exactly ALL_CONTROLS_OK; a missing
# test is a FAIL. Logs stay in a fresh temp dir, named in each FAIL line. Not run by CI (the ubuntu bash and
# df differ): run it by hand after changing anything under ascon/eval or ascon/final.
# ascon/final/test-judge2.sh is not in the list yet: it needs REAL_DIR (real matrices) for two of its
# parts and says CONTROLS_BLOCKED without it. Add it once that is settled (ASCON_TEST_ALL_LIST overrides).
set -u
root="$(cd "$(dirname "$0")/../.." && pwd -P)" || exit 2
out="$(mktemp -d)" || exit 2
tests="${ASCON_TEST_ALL_LIST:-ascon/eval/test-run-matrix.sh ascon/eval/test-check-collision.sh ascon/eval/test-lane-queue.sh ascon/eval/test-lane-chain.sh ascon/eval/test-mini-lane-start.sh ascon/eval/test-lane-status.sh ascon/final/test-checks.sh ascon/final/test-evidence.sh}"
bad=0
for t in $tests; do
  name="$(basename "$t" .sh)"
  if [ ! -f "$root/$t" ]; then echo "FAIL $t (missing)"; bad=1; continue; fi
  /bin/bash "$root/$t" "$root" > "$out/$name.log" 2>&1
  rc=$?
  if [ "$rc" = 0 ] && grep -qx 'ALL_CONTROLS_OK' "$out/$name.log"; then
    echo "OK   $t"
  else
    echo "FAIL $t rc=$rc log=$out/$name.log"; bad=1
  fi
done
if [ "$bad" = 0 ]; then echo ALL_HARNESS_OK; exit 0; fi
echo HARNESS_FAILED; exit 1
