#!/bin/bash
# Stand-in for `claude -p` (ERIS_CLAUDE_BIN) that answers each revision call with the next canned
# reply from $REVTEST_REPLIES (01.json, 02.json, ...), then "hold" once they run out. Lets the
# runtime's handling of broken revisions be exercised deterministically, with no model call.
set -u
dir="${REVTEST_REPLIES:?REVTEST_REPLIES is not set}"
state="${REVTEST_STATE:?REVTEST_STATE is not set}"
n=$(( $(cat "$state" 2>/dev/null || echo 0) + 1 ))
printf '%s\n' "$n" > "$state"
f="$dir/$(printf '%02d' "$n").json"
printf '%s call=%s reply=%s\n' "$(date +%H:%M:%S)" "$n" "$(basename "$f")" >> "$state.calls"
if [ -f "$f" ]; then cat "$f"; else printf '%s\n' '{"notes":"hold: canned replies exhausted","executorTs":null}'; fi
