#!/bin/bash
# Revision-path test for one agent: copies it to example/agents/revtest-<agent> with a short revision
# interval, runs one backtest scenario against noop + multi-arb, then removes the copy.
#   ascon/revtest/run.sh <agent> fake <blocks> [every]   canned broken revisions (ascon/revtest/replies)
#   ascon/revtest/run.sh <agent> real <blocks> [every] [model]   real `claude -p` (subscription CLI)
#   ascon/revtest/run.sh <agent> hybrid <blocks> [every] <model>  REVTEST_CASE=<dir>: canned first reply, then the real model
#   ascon/revtest/run.sh <agent> openai <blocks> [every] <model>  OpenAI API with the ASCON key only
#     (ASCON_OPENAI_ENV, default ~/.config/secrets/ascon-openai.env, holding ASCON_OPENAI_API_KEY=...)
# REVTEST_PORT picks the backtest anvil port (default 8548, clear of a matrix run on 8547);
# REVTEST_REGIME / REVTEST_SEED pick the scenario (default calm / 101).
# Prints the run directory. Exit: 0 run completed, 1 run failed, 2 cannot run.
set -u
agent="${1:?agent}"; mode="${2:?fake|real}"; blocks="${3:?blocks}"; every="${4:-10}"; model="${5:-}"
root="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$root" || exit 2
# The values below go into a YAML roster unescaped, so accept only plain identifiers and numbers.
printf '%s\n' "$agent" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]*$' || { echo "BLOCKED: agent id must be [A-Za-z0-9_-]" >&2; exit 2; }
printf '%s\n' "$blocks $every" | grep -Eq '^[0-9]+ [0-9]+$' || { echo "BLOCKED: blocks and every must be integers" >&2; exit 2; }
[ -z "$model" ] || printf '%s\n' "$model" | grep -Eq '^[A-Za-z0-9._:-]+$' || { echo "BLOCKED: model must be [A-Za-z0-9._:-]" >&2; exit 2; }
# Not safe to run twice at once for the same agent: the copy below is reserved by name only.
src="example/agents/$agent"; copy="example/agents/revtest-$agent"
[ -f "$src/prompt.md" ] || { echo "BLOCKED: $src/prompt.md not found" >&2; exit 2; }
[ -e "$copy" ] && { echo "BLOCKED: $copy already exists" >&2; exit 2; }
work="$(mktemp -d "${TMPDIR:-/tmp}/revtest.XXXXXX")" || exit 2
cleanup() { python3 -c 'import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "$copy"; }
trap cleanup EXIT
cp -R "$src" "$copy" || exit 2
python3 - "$copy/prompt.md" "$every" "revtest-$agent" <<'PY' || exit 2
import re, sys
path, every, name = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
head, body = text.split("\n---\n", 1)
head = re.sub(r"(?m)^reviseEveryBlocks:.*$", f"reviseEveryBlocks: {every}", head)
if "reviseEveryBlocks:" not in head: head += f"\nreviseEveryBlocks: {every}"
head = re.sub(r"(?m)^name:.*$", f"name: {name}", head)
head = re.sub(r"(?m)^model:.*\n?", "", head)
open(path, "w").write(head + "\n---\n" + body)
PY
if [ "$mode" = fake ]; then
  llm="claude-cli"; bin="$root/ascon/revtest/fake-claude.sh"
  extra="REVTEST_REPLIES: \"$root/ascon/revtest/replies\", REVTEST_STATE: \"$work/state\", "
elif [ "$mode" = real ]; then
  llm="claude-cli${model:+:$model}"; bin="${ERIS_CLAUDE_BIN:-claude}"; extra=""
elif [ "$mode" = hybrid ]; then
  # call 1 installs the canned revision in $REVTEST_CASE (a directory of NN.json), later calls ask
  # the real model through the ASCON key file only.
  [ -n "$model" ] || { echo "BLOCKED: hybrid mode needs a model" >&2; exit 2; }
  case_dir="${REVTEST_CASE:?REVTEST_CASE is not set}"
  [ -d "$case_dir" ] || { echo "BLOCKED: $case_dir is not a directory" >&2; exit 2; }
  [ -r "${ASCON_OPENAI_ENV:-$HOME/.config/secrets/ascon-openai.env}" ] || { echo "BLOCKED: ASCON key file not readable" >&2; exit 2; }
  llm="claude-cli"; bin="$root/ascon/revtest/hybrid-llm.py"
  extra="REVTEST_REPLIES: \"$(cd "$case_dir" && pwd)\", REVTEST_STATE: \"$work/state\", REVTEST_MODEL: \"$model\", "
elif [ "$mode" = openai ]; then
  [ -n "$model" ] || { echo "BLOCKED: openai mode needs a model" >&2; exit 2; }
  keyfile="${ASCON_OPENAI_ENV:-$HOME/.config/secrets/ascon-openai.env}"
  [ -r "$keyfile" ] || { echo "BLOCKED: $keyfile not readable" >&2; exit 2; }
  # Never fall back to an OPENAI_API_KEY already in the shell: it may belong to another project.
  OPENAI_API_KEY="$(sed -n 's/^ASCON_OPENAI_API_KEY=//p' "$keyfile")"
  [ -n "$OPENAI_API_KEY" ] || { echo "BLOCKED: ASCON_OPENAI_API_KEY missing in $keyfile" >&2; exit 2; }
  export OPENAI_API_KEY; unset OPENAI_BASE_URL
  llm="openai:$model"; bin=""; extra=""
else echo "BLOCKED: mode must be fake, real or openai" >&2; exit 2; fi
cat > "$work/roster.yaml" <<YAML
agents:
  - id: noop
    wallet: AUTO
    baseline: true
  - id: multi-arb
    wallet: AUTO
    env: { ERIS_AGENT_FROZEN: "1" }
  - id: revtest-$agent
    wallet: AUTO
    env: { ${extra}ERIS_LLM_MODEL: "$llm", ERIS_CLAUDE_BIN: "$bin", ERIS_IMPROVE_LOG_CALLS: "1" }
YAML
npm run backtest -- --regime "${REVTEST_REGIME:-calm}" --seed "${REVTEST_SEED:-101}" --agents "$work/roster.yaml" --agent-sandbox process --blocks "$blocks" --port "${REVTEST_PORT:-8548}" > "$work/backtest.log" 2>&1
rc=$?
run="$(grep -o 'runs/[0-9T:-]*Z' "$work/backtest.log" | tail -1)"
[ -f "$work/state.calls" ] && cp "$work/state.calls" "$root/$run/revtest-fake-calls.log" 2>/dev/null
echo "rc=$rc run=$run log=$work/backtest.log"
[ "$rc" = 0 ] && [ -n "$run" ] || exit 1
