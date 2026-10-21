#!/usr/bin/env bash
# The missing link: an accepted submission ZIP -> a runnable per-team image.
#
#   ./accept-submission.sh <submission.zip> <team-id>
#
# scan-submission.py screens a ZIP and build.sh builds from `example/agents/<id>`, but nothing moved
# a ZIP into that shape, so the pipeline had a gap exactly where a competition needs an audit trail.
#
# What it does, in order, stopping at the first failure:
#   1. scan     -- scan-submission.py must accept (a vendored sdk that differs from this checkout is a WARN)
#   2. extract  -- ONLY the participant's own agent directory, into example/agents/<team-id>/
#   3. check    -- check:strategy over the extracted code (cheatcode static check, ADR 0006 §5)
#   4. build    -- eris-agent:<team-id>, and print the digest that the replay audit checks
#
# Step 2 takes the participant's directory and NOTHING else. The bundle also carries sdk/, runtime/
# and lib/; those are the operator's, and copying a participant's copy over the operator's is how a
# tampered runtime would get in through the back door. Because they are never copied, step 1 only
# WARNs when they differ from this checkout -- usually a bundle built at an earlier release.
#
# Step 2 also re-scans what `unzip` actually wrote, because the scan in step 1 reads the archive
# with Python's zipfile and the extraction uses Info-ZIP. They disagree on symlinks (zipfile writes
# the link target as a small text file; unzip makes a real link that the copy then follows into
# another team's directory) and can disagree on malformed archives. Accepting what was scanned
# rather than what was extracted is how a submission smuggles in code nobody looked at.
#
# ERIS_SUBMISSION_LEDGER=<ledger.jsonl> (optional) records every run in the acceptance ledger
# (scripts/submissionLedger.ts, rules §2.2): ACCEPT with the image digest, or REJECT with the reason,
# plus the ZIP's sha256 and the unit's accept count for the JST day. With it set, a unit that already
# has 5 accepts today is refused before the scan (ERIS_SUBMISSION_OVER_LIMIT=1 turns that into a
# warning, for a replacement the operator has agreed to). Unset, nothing here changes.
set -uo pipefail
LEDGER="${ERIS_SUBMISSION_LEDGER:-}"
# Resolved before the cd below: the operator gave it relative to where they stood.
if [ -n "$LEDGER" ]; then LEDGER="$(cd "$(dirname "$LEDGER")" && pwd)/$(basename "$LEDGER")" || exit 1; fi
cd "$(dirname "$0")/../.."
REPO="$PWD"
ZIP="${1:?usage: accept-submission.sh <submission.zip> <team-id>}"
TEAM="${2:?usage: accept-submission.sh <submission.zip> <team-id>}"
echo "$TEAM" | grep -qE '^[a-zA-Z0-9][a-zA-Z0-9_-]*$' || { echo "invalid team id: $TEAM" >&2; exit 1; }
[ -f "$ZIP" ] || { echo "no such file: $ZIP" >&2; exit 1; }
DEST="example/agents/$TEAM"

step() { STEP="$*"; printf '\n=== %s ===\n' "$*"; }
# Every rejection goes through here, so the ledger can say why.
fail() { FAIL_REASON="$*"; echo "$*" >&2; exit 1; }

TMP=""; STEP="start"; FAIL_REASON=""; DIGEST=""
ledger() { "$REPO/node_modules/.bin/tsx" "$REPO/scripts/submissionLedger.ts" "$@" --ledger "$LEDGER"; }
on_exit() {
  local rc=$?
  [ -n "$TMP" ] && rm -rf "$TMP"
  [ -n "$LEDGER" ] || return 0
  if [ "$rc" = 0 ]; then
    ledger record --unit "$TEAM" --result ACCEPT --zip "$ZIP" --digest "$DIGEST"
    local lrc=$?
    # 3 = recorded, but over the day's limit (only reachable with ERIS_SUBMISSION_OVER_LIMIT=1).
    [ "$lrc" = 0 ] || [ "$lrc" = 3 ] || { echo "ACCEPTED, but the ledger write FAILED: record $TEAM / $DIGEST by hand" >&2; exit 2; }
  else
    ledger record --unit "$TEAM" --result REJECT --zip "$ZIP" --reason "${FAIL_REASON:-exit $rc during $STEP}" \
      || echo "the ledger write FAILED for this rejection" >&2
  fi
}
trap on_exit EXIT

if [ -n "$LEDGER" ] && ! ledger check --unit "$TEAM"; then
  if [ "${ERIS_SUBMISSION_OVER_LIMIT:-}" = 1 ]; then
    echo "  WARN: over the daily limit, accepting anyway (ERIS_SUBMISSION_OVER_LIMIT=1)" >&2
  else
    fail "daily limit reached: $TEAM already has 5 accepted submissions today (JST, rules §2.2)"
  fi
fi

step "1/4 scan"
python3 infra/submission/scan-submission.py "$ZIP" || fail "REJECTED by scan — not accepting"

step "2/4 extract the participant's agent directory"
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP" || fail "unzip failed"
# Only regular files and directories. A symlink here would be followed by the copy below (macOS
# `cp -r` dereferences) or by the image build, pulling in files from outside the submission.
ODD=$(find "$TMP" ! -type f ! -type d)
[ -z "$ODD" ] || { echo "$ODD" | sed "s|^$TMP/|  |" >&2; fail "REJECTED: bundle contains symlinks or special files (listed above)"; }
python3 infra/submission/scan-submission.py "$TMP" >/dev/null \
  || { python3 infra/submission/scan-submission.py "$TMP" >&2; fail "REJECTED by scan of the extracted tree"; }
# The agent dir is the one under agents/ that is neither runtime nor lib.
SRC=""
for d in "$TMP"/agents/*/; do
  # No match leaves the pattern itself, which reported "* has neither agent.ts nor strategy.py".
  [ -d "$d" ] || continue
  b=$(basename "$d"); case "$b" in runtime|lib) continue;; esac
  [ -n "$SRC" ] && fail "bundle carries more than one agent directory ($(basename "$SRC") and $b)"
  SRC="$d"
done
[ -n "$SRC" ] || fail "no agent directory found under agents/ in the bundle"
# TypeScript or Python (ADR 0025): bundleAgent makes the two entry points exclusive, so a Python
# submission carries strategy.py and no agent.ts. Requiring agent.ts rejected every Python bundle the
# documented path tells participants to build.
if   [ -f "$SRC/agent.ts" ];    then ENTRY=agent.ts
elif [ -f "$SRC/strategy.py" ]; then ENTRY=strategy.py
else fail "$(basename "$SRC") has neither agent.ts nor strategy.py"
fi
[ -f "$SRC/prompt.md" ] || fail "$(basename "$SRC") has no prompt.md (rules §2.5)"
[ -e "$DEST" ] && fail "$DEST already exists — remove it first if this is a resubmission"
mkdir -p "$DEST" && cp -RP "$SRC". "$DEST"/
[ -z "$(find "$DEST" ! -type f ! -type d)" ] || { rm -rf "$DEST"; fail "non-regular file appeared in $DEST"; }
echo "  $(basename "$SRC") -> $DEST  ($(find "$DEST" -type f | wc -l) files)"

step "3/4 check:strategy"
# The static check reads the strategy's source whichever language it is in; the glob has to follow
# the entry point, because "$DEST"/*.ts does not expand for a Python submission.
case "$ENTRY" in
  agent.ts)    STRATEGY_FILES=("$DEST"/*.ts) ;;
  strategy.py) STRATEGY_FILES=("$DEST"/*.py) ;;
esac
npx tsx scripts/checkStrategyCode.ts "${STRATEGY_FILES[@]}" 2>&1 | tail -3
[ "${PIPESTATUS[0]}" = 0 ] || { rm -rf "$DEST"; fail "check:strategy found issues — see above"; }

step "4/4 build eris-agent:$TEAM"
# A resubmission's tag may already exist from the last accepted one. The build's own exit code is
# what says this ZIP became an image; `docker image inspect` after a failed build would happily
# return the previous submission's id, and that id would be recorded as this one's (issue #261).
BEFORE=$(docker image inspect "eris-agent:$TEAM" --format '{{.Id}}' 2>/dev/null || true)
npm run agent:build -- team "$TEAM" 2>&1 | tail -2
[ "${PIPESTATUS[0]}" = 0 ] || { rm -rf "$DEST"; fail "build failed — not accepting (the previous image${BEFORE:+ $BEFORE} is untouched)"; }
DIGEST=$(docker image inspect "eris-agent:$TEAM" --format '{{.Id}}' 2>/dev/null)
[ -n "$DIGEST" ] || { rm -rf "$DEST"; fail "image not found after build"; }
# Same id as before is possible and fine (byte-identical submission, docker reused the layers);
# it is said so the operator does not take it for a stale one.
[ -n "$BEFORE" ] && [ "$BEFORE" = "$DIGEST" ] && echo "  (same image id as the previous submission: identical contents)"

cat <<DONE

  accepted: $TEAM
  image:    eris-agent:$TEAM
  digest:   $DIGEST

  Record that digest. runs/<id>/images.jsonl logs it again at spawn, and the replay audit is the
  comparison between the two.

  Add the roster entry to the competition config:
    - id: $TEAM
      dir: $TEAM
      wallet: AUTO
DONE
