#!/bin/bash
# Controls for ascon/final/check-arm.py, ascon/final/check-trap-scope.py and ascon/final/make-queues.py.
#   /bin/bash ascon/final/test-checks.sh "$PWD"   (prints ALL_CONTROLS_OK, exits 0; else exits 1)
# check-arm.py runs on synthetic run directories whose runtime_start lines have the shape the agent
# runtime writes (example/agents/runtime/botMain.ts). check-trap-scope.py runs on the repository's
# own regimes and agent directories, plus a few synthetic ones for the malformed cases. Each negative
# control changes one thing and must be caught by the check meant for it (exact line count).
set -u
src="${1:?usage: /bin/bash $0 <repo root>, e.g. \"\$PWD\"}"
arm_checker="$src/ascon/final/check-arm.py"
trap_checker="$src/ascon/final/check-trap-scope.py"
for f in "$arm_checker" "$trap_checker"; do
  [ -f "$f" ] || { echo "BLOCKED: no $f"; exit 2; }
done
command -v python3 > /dev/null || { echo "BLOCKED: python3 not found"; exit 2; }
T="$(mktemp -d)" || exit 2
trap 'python3 -c "import shutil, sys; shutil.rmtree(sys.argv[1], ignore_errors=True)" "$T"' EXIT

# mk.py <dir> <case>: <dir>/runs/matrix-A/matrix.json with calm#1 and crash#1 (agents noop, venue-arb,
# slot), each in its own run directory whose agents/slot.jsonl starts the slot from
# /h/example/agents/opus-1 in mode decide; then <case> applied.
cat > "$T/mk.py" <<'EOF'
import json, os, sys
base, case = sys.argv[1], sys.argv[2]
runs = os.path.join(base, "runs")
def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
def start(run, agent_id="slot", agent_dir="/h/example/agents/opus-1", mode="decide"):
    return {"ts": "2026-10-21T22:57:04.976Z", "agentId": agent_id, "kind": "mempool", "event": "runtime_start",
            "mode": mode, "address": "0x00000000000000000000000000000000000000aa", "agentDir": agent_dir,
            "rpcUrl": "http://127.0.0.1:8560"}
ids = ["noop", "venue-arb", "slot"]
rows, lines = [], {}
for i, regime in enumerate(["calm", "crash"]):
    rid = "2026-10-21T22-56-21-%03dZ" % (i + 1)
    rows.append({"s": i + 1, "regime": regime, "seed": 1, "agents": [{"id": a} for a in ids], "runDir": "runs/" + rid})
    lines[rid] = [{"ts": "2026-10-21T22:57:04.000Z", "agentId": "slot", "kind": "mempool", "event": "approvals_granted", "count": 3},
                  start(rid),
                  {"ts": "2026-10-21T22:57:06.000Z", "agentId": "slot", "round": 5, "reason": "hold"}]
r1 = rows[0]["runDir"][5:]
r2 = rows[1]["runDir"][5:]
raw = {}
if case == "good":
    pass
elif case == "good_trailing_slash":
    lines[r1][1]["agentDir"] += "/"
elif case == "failed_row_plus_good":
    rows.append({"s": 3, "regime": "whale", "seed": 1, "agents": [], "error": "boom"})
elif case == "wrong_arm":  # the C1 copy was made with opus-1's directory
    lines[r2][1]["agentDir"] = "/h/example/agents/opus-1-pb"
elif case == "improve":
    lines[r1][1]["mode"] = "improve"
elif case == "run_mode":
    lines[r1][1]["mode"] = "run"
elif case == "two_starts":
    lines[r1].append(start(r1, agent_dir="/h/example/agents/opus-1-pb"))
elif case == "agent_id":
    lines[r1][1]["agentId"] = "venue-arb"
elif case == "no_slot_in_row":
    rows[0]["agents"] = [{"id": "noop"}, {"id": "venue-arb"}, {"id": "opus-1"}]
elif case == "no_file":
    raw[r1] = None
elif case == "no_start":
    lines[r1].pop(1)
elif case == "torn_line":
    raw[r1] = "".join(json.dumps(e) + "\n" for e in lines[r1]) + '{"ts":"2026-10-21T22:5\n'
elif case == "no_agent_dir":
    del lines[r1][1]["agentDir"]
elif case == "row_no_run_dir":
    del rows[0]["runDir"]
elif case == "only_failed_rows":
    rows = [{"s": 1, "regime": "calm", "seed": 1, "agents": [], "error": "boom"}]
elif case == "fail_and_blocked":
    lines[r1][1]["agentDir"] = "/h/example/agents/opus-1-pb"
    raw[r2] = None
elif case == "custom_slot":
    rows[0]["agents"][2]["id"] = rows[1]["agents"][2]["id"] = "arm"
    for r in (r1, r2):
        for e in lines[r]:
            e["agentId"] = "arm"
else:
    sys.exit("unknown case " + case)
slot_name = "arm" if case == "custom_slot" else "slot"
for rid, ev in lines.items():
    p = os.path.join(runs, rid, "agents", slot_name + ".jsonl")
    if rid in raw:
        if raw[rid] is not None:
            write(p, raw[rid])
        else:
            os.makedirs(os.path.dirname(p), exist_ok=True)
        continue
    write(p, "".join(json.dumps(e) + "\n" for e in ev))
write(os.path.join(runs, "matrix-A", "matrix.json"), json.dumps({"schema": 2, "scenariosPlanned": len(rows), "scenarios": rows}))
EOF

fails=0
seq=0
report() {  # <label> <want exit> <want lines or -> <needle> <out> <got>
  local n ok=OK
  n="$(printf '%s\n' "$5" | grep -c .)"
  [ "$6" = "$2" ] || ok=MISMATCH
  [ "$3" = - ] || [ "$n" = "$3" ] || ok=MISMATCH
  printf '%s\n' "$5" | grep -qF -- "$4" || ok=MISMATCH
  printf '%-44s want %s got %s, %s lines  %s\n' "$1" "$2" "$6" "$n" "$ok"
  printf '%s\n' "$5" | sed 's/^/    /'
  [ "$ok" = OK ] || fails=1
}
# arm <case> <want exit> <want lines> <needle> -- checker args (relative to the case's tree)
arm() {
  local case="$1" want="$2" lines="$3" needle="$4"; shift 5
  seq=$((seq + 1))
  local d="$T/arm-$seq-$case"
  mkdir -p "$d"
  python3 -I "$T/mk.py" "$d/tree" "$case" || { echo "fixture $case could not be built"; fails=1; return; }
  local out got
  out="$(cd "$d/tree" && python3 -I "$arm_checker" "$@" 2>&1)"; got=$?
  report "arm $case $*" "$want" "$lines" "$needle" "$out" "$got"
}
# trap_scope <label> <want exit> <want lines> <needle> -- checker args
trap_scope() {
  local label="$1" want="$2" lines="$3" needle="$4"; shift 5
  local out got
  out="$(cd "$src" && python3 -I "$trap_checker" "$@" 2>&1)"; got=$?
  report "trap $label" "$want" "$lines" "$needle" "$out" "$got"
}

M=runs/matrix-A/matrix.json
echo "== check-arm.py"
# Positive controls.
arm good                 0 1 "PASS 2 scenarios in matrix-A: slot ran opus-1 in mode decide" -- "$M" opus-1
arm good_trailing_slash  0 1 "PASS 2 scenarios"                       -- "$M" opus-1
arm failed_row_plus_good 0 1 "1 failed rows not inspected"            -- "$M" opus-1
arm custom_slot          0 1 "PASS 2 scenarios in matrix-A: arm ran opus-1" -- "$M" opus-1 --slot arm
# The same run, asked for another arm: every row is a FAIL (B looked up as C1, or B' as B).
arm good                 1 2 "the slot ran 'opus-1' (/h/example/agents/opus-1), not 'opus-1a'" -- "$M" opus-1a
arm good                 1 2 "not 'opus-1-pb'"                        -- "$M" opus-1-pb
# One problem each.
arm wrong_arm            1 1 "s2 crash#1: the slot ran 'opus-1-pb'"   -- "$M" opus-1
arm improve              1 1 "mode 'improve', not 'decide' (frozen)"  -- "$M" opus-1
arm run_mode             1 1 "mode 'run', not 'decide'"               -- "$M" opus-1
arm two_starts           1 1 "2 runtime_start lines in slot.jsonl: opus-1/decide, opus-1-pb/decide" -- "$M" opus-1
arm agent_id             1 1 "runtime_start agentId 'venue-arb' is not 'slot'" -- "$M" opus-1
arm no_slot_in_row       1 1 "the row's agents have no 'slot'"        -- "$M" opus-1
# Missing or unreadable records: BLOCKED, never PASS.
arm no_file              2 1 "BLOCKED matrix-A s1 calm#1: cannot read" -- "$M" opus-1
arm no_start             2 1 "slot.jsonl has no runtime_start"        -- "$M" opus-1
arm torn_line            2 1 "slot.jsonl has 1 lines that do not parse as JSON objects (first: line 4)" -- "$M" opus-1
arm no_agent_dir         2 1 "runtime_start has no agentDir"          -- "$M" opus-1
arm row_no_run_dir       2 1 "s1 calm#1: has results but no runDir"   -- "$M" opus-1
arm only_failed_rows     2 1 "no scenario with results to check"      -- "$M" opus-1
arm good                 2 1 "BLOCKED matrix-Z: cannot read"          -- runs/matrix-Z/matrix.json opus-1
arm good                 2 1 "BLOCKED usage: <arm> is a directory name" -- "$M" example/agents/opus-1
arm good                 2 1 "BLOCKED usage: check-arm.py"            -- "$M"
# A FAIL is not hidden behind a BLOCKED in another row.
arm fail_and_blocked     1 2 "the slot ran 'opus-1-pb'"               -- "$M" opus-1

echo "== check-trap-scope.py"
S=""
for f in "$src"/ascon/final/scen-*.yaml "$src"/ascon/final/smoke-*.yaml; do S="$S $f"; done
# Includes the GMX probe and two FS files in addition to the original 34 files.
nscen="$(printf '%s\n' $S | grep -c .)"
[ "$nscen" = 37 ] || { echo "BLOCKED: expected 37 scenario files under ascon/final, found $nscen"; exit 2; }
# Positive control: the final plan's scenario files and the planned or measured arms.
trap_scope "final files, planned arms" 0 1 "PASS 37 scenario files: no regime lists lending; 5 arms" -- --scenarios $S --arms opus-1 opus-1-pb opus-1a opus-2 ascon-zeta-r3
# Negative controls on the repository's own files.
printf '%s\n' 'regimes: [calm, agent-markets]' 'seeds: [1]' > "$T/scen-agent-markets.yaml"
trap_scope "regime with lending" 1 1 "agent-markets: run.protocols includes lending" -- --scenarios "$T/scen-agent-markets.yaml" --arms opus-1
trap_scope "arm that lends directly" 1 - "FAIL market-taker: example/agents/market-taker/agent.ts" -- --scenarios "$src/ascon/final/scen-1001.yaml" --arms market-taker
# discovery-arb's own directory never says lending: the FAIL above has to come from the import.
n_own="$(grep -ic lending "$src/example/agents/discovery-arb/agent.ts")"
[ "$n_own" = 0 ] || { echo "control discovery-arb is not transitive-only ($n_own own mentions)"; fails=1; }
trap_scope "arm that lends through ../lib" 1 - "FAIL discovery-arb: example/agents/lib/discoveryAgent.ts" -- --scenarios "$src/ascon/final/scen-1001.yaml" --arms discovery-arb
trap_scope "trap-launcher as an arm" 1 - "FAIL trap-launcher: example/agents/trap-launcher/agent.ts" -- --scenarios "$src/ascon/final/scen-1001.yaml" --arms trap-launcher
# Synthetic inputs for the parser and the malformed cases.
mkdir -p "$T/reg" "$T/arm-ok" "$T/arm-lend" "$T/arm-broken" "$T/arm-empty"
printf '%s\n' 'run:' '  blocks: 360' '  protocols:' '    - uniswap' '    - lending' 'market: {}' > "$T/reg/block-lending.yaml"
printf '%s\n' 'run:' '  blocks: 360' '  protocols:' '    - uniswap' '    - aave' 'market: {}' > "$T/reg/block-ok.yaml"
printf '%s\n' 'run:' '  blocks: 360' 'protocols: [lending]' > "$T/reg/no-run-protocols.yaml"
printf '%s\n' "regimes: [$T/reg/block-lending.yaml]" 'seeds: [1]' > "$T/scen-block-lending.yaml"
printf '%s\n' "regimes: [$T/reg/block-ok.yaml, metric-calm]" 'seeds: [1]' > "$T/scen-block-ok.yaml"
printf '%s\n' "regimes: [$T/reg/no-run-protocols.yaml]" 'seeds: [1]' > "$T/scen-no-protocols.yaml"
printf '%s\n' 'regimes: [no-such-regime]' 'seeds: [1]' > "$T/scen-missing-regime.yaml"
printf '%s\n' 'seeds: [1]' > "$T/scen-no-regimes.yaml"
printf '%s\n' '// skips the lending-incident regime and lending_incident logs' 'export const x = 1;' > "$T/arm-ok/agent.ts"
printf '%s\n' 'import { y } from "./helper.js";' 'export const x = y;' > "$T/arm-lend/agent.ts"
printf '%s\n' 'export const y = { type: "lendingSupply" };' > "$T/arm-lend/helper.ts"
printf '%s\n' 'import { y } from "../lib/missing.js";' > "$T/arm-broken/agent.ts"
trap_scope "block list without lending" 0 1 "PASS 1 scenario files" -- --scenarios "$T/scen-block-ok.yaml" --arms "$T/arm-ok"
trap_scope "block list with lending" 1 1 "run.protocols includes lending (uniswap, lending)" -- --scenarios "$T/scen-block-lending.yaml" --arms opus-1
trap_scope "synthetic arm, lending in an import" 1 1 "arm-lend/helper.ts:1 mentions lending" -- --scenarios "$T/scen-block-ok.yaml" --arms "$T/arm-lend"
trap_scope "protocols outside run:" 2 1 "no readable run.protocols" -- --scenarios "$T/scen-no-protocols.yaml" --arms opus-1
trap_scope "regime file missing" 2 1 "no-such-regime: cannot read" -- --scenarios "$T/scen-missing-regime.yaml" --arms opus-1
trap_scope "scenario file without regimes" 2 1 "no \`regimes: [...]\` line" -- --scenarios "$T/scen-no-regimes.yaml" --arms opus-1
trap_scope "arm import not found" 2 1 "relative import not found" -- --scenarios "$T/scen-block-ok.yaml" --arms "$T/arm-broken"
trap_scope "arm without agent.ts" 2 1 "no agent.ts or strategy.py" -- --scenarios "$T/scen-block-ok.yaml" --arms "$T/arm-empty"
# A name that can never become an agent directory (opus-1a was used here and became real in 1ce98d01).
trap_scope "arm that does not exist" 2 1 "no agent.ts or strategy.py" -- --scenarios "$T/scen-block-ok.yaml" --arms zz-no-such-arm
trap_scope "no arms given" 2 1 "BLOCKED usage" -- --scenarios "$T/scen-block-ok.yaml"
# A FAIL is not hidden behind a BLOCKED.
trap_scope "fail and blocked" 1 2 "includes lending" -- --scenarios "$T/scen-agent-markets.yaml" --arms zz-no-such-arm

# make-queues.py: generate stage-1-shaped queues from the real arms and scenario files, then break one thing
# per copy; --check must catch each (exact line count).
mq_checker="$src/ascon/final/make-queues.py"
if [ -f "$mq_checker" ]; then
  mq_gen="$(python3 -I "$mq_checker" --stage s1 --seeds 1003-1006 --fields FP,FD --arms opus-1,opus-1-pb,opus-1a \
    --lanes A,B --order-seed 7 --out "$T/mq/good" 2>&1)"; got=$?
  report "queues generated and checked" 0 3 "PASS 24 jobs in 2 files, 8 cells" "$mq_gen" "$got"
  # FS is a separate two-cell schedule; FP/FD paths and ordering stay unchanged.
  out="$(python3 -I "$mq_checker" --stage s2 --seeds 1101,1102 --fields FS --arms opus-1,opus-1r \
    --lanes A,B --order-seed 7 --out "$T/mq/fs" 2>&1)"; got=$?
  report "FS queues generated and checked" 0 3 "PASS 4 jobs in 2 files, 2 cells" "$out" "$got"
  out="$(python3 -I "$mq_checker" --check "$T/mq/fs" 2>&1)"; got=$?
  report "FS queues standalone check" 0 1 "PASS 4 jobs" "$out" "$got"
  # Mutate only copied scenarios; never alter the real checkout's resources.
  python3 -I - "$mq_checker" "$T/mq/fs" "$T/fs-repo" <<'PY'
import importlib.util
from pathlib import Path
import shutil
import sys
spec = importlib.util.spec_from_file_location('queues', sys.argv[1])
mq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mq)
source, fixture = Path(mq.ROOT), Path(sys.argv[3])
queues = sys.argv[2]
(fixture / 'ascon/final').mkdir(parents=True)
(fixture / 'example').symlink_to(source / 'example', target_is_directory=True)
for name in ('roster-FS.yaml', 'scen-FS-1101.yaml', 'scen-FS-1102.yaml'):
    shutil.copyfile(source / 'ascon/final' / name, fixture / 'ascon/final' / name)
mq.ROOT = str(fixture)
assert mq.check(queues) == 0
scenario = fixture / 'ascon/final/scen-FS-1101.yaml'
good = scenario.read_text()
for bad in (good.replace('lending-incident]', 'lending-incident, calm]'),
            good.replace('launch, cdp-incident', 'cdp-incident, launch'),
            good.replace('launch,', 'la unch,'),
            good + 'regimes: [launch, cdp-incident, lending-incident, calm]\n',
            good.replace('[1101]', '[1102]')):
    scenario.write_text(bad)
    assert mq.check(queues) == 1
    sys.argv = [sys.argv[0], '--stage', 's2', '--seeds', '1101', '--fields', 'FS',
                '--arms', 'opus-1,opus-1r', '--lanes', 'A', '--order-seed', '7',
                '--out', str(fixture / 'refused')]
    assert mq.main() == 2 and not (fixture / 'refused').exists()
scenario.write_text(good)
print('FS_SCENARIO_CONTROLS_OK extra/reordered regimes, duplicate key, wrong seed rejected')
PY
  [ "$?" = 0 ] || fails=1
  mq() {  # <label> <want exit> <want lines> <needle> <edit: python on the copy's s1-A.txt text as s>
    local label="$1" want="$2" lines="$3" needle="$4" edit="$5" d out got
    seq=$((seq + 1)); d="$T/mq/c$seq"; mkdir -p "$d"
    cp "$T/mq/good/"*.txt "$d/"
    python3 -I -c 'import sys
p = sys.argv[1] + "/s1-A.txt"; s = open(p).read(); exec(sys.argv[2]); open(p, "w").write(s)' "$d" "$edit" \
      || { echo "fixture $label could not be built"; fails=1; return; }
    out="$(python3 -I "$mq_checker" --check "$d" 2>&1)"; got=$?
    report "queues $label" "$want" "$lines" "$needle" "$out" "$got"
  }
  mq "unchanged copy" 0 1 "PASS 24 jobs" 'pass'
  mq "duplicate arm" 1 3 "appears twice" 'l = [x for x in s.splitlines() if x and not x.startswith("#")][0]; s = s + l + "\n"'
  mq "missing arm" 1 1 "FAIL missing:" 'l = [x for x in s.splitlines() if x and not x.startswith("#")][0]; s = s.replace(l + "\n", "")'
  mq "slot dir that does not exist" 1 4 "no slot dir example/agents/zz-no-such-arm" 'l = [x for x in s.splitlines() if x and not x.startswith("#")][0]; f = l.split(); s = s.replace(l, " ".join([f[0], f[1], "zz-no-such-arm", f[3]]))'
  mq "wrong scenario file" 1 1 "want ascon/final/scen-" 'l = [x for x in s.splitlines() if x and not x.startswith("#")][0]; f = l.split(); s = s.replace(l, " ".join(f[:3] + ["ascon/final/scen-1011.yaml"]))'
  mq "different arguments" 1 1 "different arguments" 's = s.replace("--order-seed 7", "--order-seed 8")'
  mq "no args header" 2 1 "args:' header line" 's = "\n".join(x for x in s.splitlines() if not x.startswith("# args:")) + "\n"'
  # A cell split across lanes: move the last job of A's first cell to lane B's file.
  seq=$((seq + 1)); d="$T/mq/c$seq"; mkdir -p "$d"; cp "$T/mq/good/"*.txt "$d/"
  python3 -I -c 'import sys
d = sys.argv[1]; a = open(d + "/s1-A.txt").read().splitlines(); jobs = [i for i, x in enumerate(a) if x and not x.startswith("#")]
moved = a.pop(jobs[2]); open(d + "/s1-A.txt", "w").write("\n".join(a) + "\n"); open(d + "/s1-B.txt", "a").write(moved + "\n")' "$d"
  out="$(python3 -I "$mq_checker" --check "$d" 2>&1)"; got=$?
  report "queues cell split across lanes" 1 1 "is split across" "$out" "$got"
  out="$(python3 -I "$mq_checker" --stage s1 --seeds 1003 --fields FP --arms opus-1,zz-no-such-arm --lanes A \
    --order-seed 1 --out "$T/mq/refused" 2>&1)"; got=$?
  report "queues refused for a missing arm" 2 1 "BLOCKED missing: example/agents/zz-no-such-arm" "$out" "$got"
  [ -e "$T/mq/refused/s1-A.txt" ] && { echo "queues refused for a missing arm: a file was written anyway"; fails=1; }
else
  echo "BLOCKED: no $mq_checker"; fails=1
fi

if [ "$fails" = 0 ]; then echo ALL_CONTROLS_OK; exit 0; fi
echo CONTROL_FAILED; exit 1
