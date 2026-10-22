#!/bin/bash
# Controls for ascon/eval/check-collision.py on synthetic run directories in a throwaway tree.
#   /bin/bash ascon/eval/test-check-collision.sh "$PWD"   (prints ALL_CONTROLS_OK, exits 0; else exits 1)
# Each negative control changes one thing in an otherwise good tree and must be caught by the check
# meant for it, alone (exact line count), so a control cannot pass on some other problem.
set -u
src="${1:?usage: /bin/bash $0 <repo root>, e.g. \"\$PWD\"}"
checker="$src/ascon/eval/check-collision.py"
[ -f "$checker" ] || { echo "BLOCKED: no $checker"; exit 2; }
command -v python3 > /dev/null || { echo "BLOCKED: python3 not found"; exit 2; }
T="$(mktemp -d)" || exit 2
# Give every directory its owner bits back first: one control makes agent-view mode 000.
cleanup() {
  python3 -c '
import os, shutil, sys
for root, dirs, _ in os.walk(sys.argv[1]):
    for x in dirs:
        os.chmod(os.path.join(root, x), 0o700)
shutil.rmtree(sys.argv[1], ignore_errors=True)' "$T"
}
trap cleanup EXIT

# mk.py <dir> <case>: <dir>/runs/matrix-A (calm#1, crash#1; agents noop a b) and matrix-B (same
# scenarios; agents noop c), each scenario in its own consistent run directory, then <case> applied.
cat > "$T/mk.py" <<'EOF'
import json, os, shutil, sys
base, case = sys.argv[1], sys.argv[2]
runs = os.path.join(base, "runs")
os.makedirs(runs)
def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(obj if isinstance(obj, str) else json.dumps(obj))
def make_run(run_id, regime, seed, ids, block):
    d = os.path.join(runs, run_id)
    started = "2026-01-01T00:00:%02d.000Z" % (block % 60)
    rs = {"schema": 1, "runStartBlock": block, "runBlocks": 360, "startedAt": started, "writtenAt": started}
    write(os.path.join(d, "run-start.json"), rs)
    for a in ids:
        write(os.path.join(d, "agent-view", a, "run-start.json"), rs)
        write(os.path.join(d, "agent-view", a, "config.yaml"), "run: {}\n")
    write(os.path.join(d, "summary.json"), {"runId": run_id, "mode": "backtest", "runStartBlock": block,
          "finalBlock": block + 360, "agents": [{"id": a, "netPnlUsdc": 0} for a in ids]})
    ev = [{"type": "run_started_realtime", "runId": run_id, "seed": seed, "scenarioRegime": regime, "rpcUrl": "http://127.0.0.1:8650"},
          {"type": "observation", "block": block},
          {"type": "run_start_declared", "runStartBlock": block, "runBlocks": 360},
          {"type": "run_completed", "runId": run_id, "runDir": "runs/" + run_id}]
    write(os.path.join(d, "events.jsonl"), "".join(json.dumps(e) + "\n" for e in ev))
    return d
def matrix(name, ids, first, scen=(("calm", 1), ("crash", 1))):
    rows = []
    for i, (regime, seed) in enumerate(scen):
        rid = "2026-01-01T00-00-00-%03dZ" % (first + i)
        make_run(rid, regime, seed, ids, 100 + first + i)
        rows.append({"s": i + 1, "regime": regime, "seed": seed, "agents": [{"id": a} for a in ids], "runDir": "runs/" + rid})
    m = {"schema": 2, "scenariosPlanned": len(rows), "scenarios": rows}
    write(os.path.join(runs, "matrix-" + name, "matrix.json"), m)
    return m
A = matrix("A", ["noop", "a", "b"], 1)
B = matrix("B", ["noop", "c"], 11)
a1 = os.path.join(base, A["scenarios"][0]["runDir"])
a2 = os.path.join(base, A["scenarios"][1]["runDir"])
def edit(path, fn):
    with open(path) as f:
        v = json.load(f)
    fn(v)
    write(path, v)
def events(fn, d=a1):
    p = os.path.join(d, "events.jsonl")
    ev = [json.loads(l) for l in open(p)]
    write(p, "".join(json.dumps(e) + "\n" for e in fn(ev)))
def append_events(data):
    with open(os.path.join(a1, "events.jsonl"), "ab") as f:
        f.write(data)
def set_a(fn):
    edit(os.path.join(runs, "matrix-A", "matrix.json"), fn)
def set_b(fn):
    edit(os.path.join(runs, "matrix-B", "matrix.json"), fn)
def is_start(e):
    return e["type"] == "run_started_realtime"
def is_declared(e):
    return e["type"] == "run_start_declared"
if case == "good":
    pass
elif case == "shared":  # B's calm row points at A's calm run dir, same roster: only the sharing is wrong
    def f(m):
        m["scenarios"][0]["runDir"] = A["scenarios"][0]["runDir"]
        for r in m["scenarios"]:
            r["agents"] = [{"id": a} for a in ["noop", "a", "b"]]
    set_b(f)
    shutil.rmtree(os.path.join(base, B["scenarios"][0]["runDir"]))
    d = os.path.join(base, B["scenarios"][1]["runDir"])
    shutil.rmtree(d)
    make_run(os.path.basename(d), "crash", 1, ["noop", "a", "b"], 112)
elif case == "regime":
    events(lambda ev: [dict(e, scenarioRegime="crash") if e["type"] == "run_started_realtime" else e for e in ev])
elif case == "seed":
    events(lambda ev: [dict(e, seed=2) if e["type"] == "run_started_realtime" else e for e in ev])
elif case == "two_starts":
    events(lambda ev: ev[:1] + [dict(ev[0], rpcUrl="http://127.0.0.1:8660")] + ev[1:])
elif case == "declared_block":
    events(lambda ev: [dict(e, runStartBlock=999) if e["type"] == "run_start_declared" else e for e in ev])
elif case == "summary_agents":
    edit(os.path.join(a1, "summary.json"), lambda s: s["agents"].append({"id": "c"}))
elif case == "summary_block":
    edit(os.path.join(a1, "summary.json"), lambda s: s.update(runStartBlock=999))
elif case == "summary_runid":
    edit(os.path.join(a1, "summary.json"), lambda s: s.update(runId="2026-01-01T00-00-00-999Z"))
elif case == "view_extra":
    write(os.path.join(a1, "agent-view", "c", "run-start.json"), open(os.path.join(a1, "run-start.json")).read())
elif case == "view_block":
    edit(os.path.join(a1, "agent-view", "a", "run-start.json"), lambda s: s.update(runStartBlock=999))
elif case == "no_run_dir":
    shutil.rmtree(a1)
elif case == "no_summary":
    os.remove(os.path.join(a1, "summary.json"))
elif case == "no_events":
    os.remove(os.path.join(a1, "events.jsonl"))
elif case == "no_run_start":
    os.remove(os.path.join(a1, "run-start.json"))
elif case == "no_agent_view":
    shutil.rmtree(os.path.join(a1, "agent-view"))
elif case == "no_view_for_agent":
    shutil.rmtree(os.path.join(a1, "agent-view", "b"))
elif case == "bad_matrix_under_root":
    write(os.path.join(runs, "matrix-C", "matrix.json"), '{"schema": 2, "scenarios": [')
elif case == "only_failed_rows":
    write(os.path.join(runs, "matrix-F", "matrix.json"),
          {"schema": 2, "scenariosPlanned": 1, "scenarios": [{"s": 1, "regime": "calm", "seed": 1, "error": "forge artifact missing"}]})
elif case == "failed_row_plus_good":
    edit(os.path.join(runs, "matrix-A", "matrix.json"),
         lambda m: m["scenarios"].append({"s": 3, "regime": "spike", "seed": 1, "error": "forge artifact missing"}))
elif case == "fail_and_blocked":
    os.remove(os.path.join(base, B["scenarios"][0]["runDir"], "summary.json"))
    events(lambda ev: [dict(e, seed=2) if e["type"] == "run_started_realtime" else e for e in ev])
# Two arms in one run dir with the same roster, field and start block: only the declared count differs.
elif case == "two_declared":
    events(lambda ev: [x for e in ev for x in ([e, dict(e)] if is_declared(e) else [e])])
elif case == "view_started_at":
    edit(os.path.join(a1, "agent-view", "a", "run-start.json"), lambda s: s.update(startedAt="2026-01-01T00:00:59.000Z"))
# Malformed or missing inputs: BLOCKED with the specific cause.
elif case == "no_declared":
    events(lambda ev: [e for e in ev if not is_declared(e)])
elif case == "no_started":
    events(lambda ev: [e for e in ev if not is_start(e)])
elif case == "start_no_seed":
    events(lambda ev: [{k: v for k, v in e.items() if k != "seed"} if is_start(e) else e for e in ev])
elif case == "start_no_regime":
    events(lambda ev: [{k: v for k, v in e.items() if k != "scenarioRegime"} if is_start(e) else e for e in ev])
elif case == "start_runid":
    events(lambda ev: [dict(e, runId="2026-01-01T00-00-00-999Z") if is_start(e) else e for e in ev])
elif case == "summary_list":
    write(os.path.join(a1, "summary.json"), [])
elif case == "summary_agents_int":
    edit(os.path.join(a1, "summary.json"), lambda s: s.update(agents=5))
elif case == "summary_non_utf8":
    with open(os.path.join(a1, "summary.json"), "ab") as f:
        f.write(b"\xff")
elif case == "run_start_no_block":
    edit(os.path.join(a1, "run-start.json"), lambda s: s.update(runStartBlock=str(s["runStartBlock"])))
elif case == "run_start_no_started_at":
    edit(os.path.join(a1, "run-start.json"), lambda s: s.pop("startedAt"))
elif case == "view_no_run_start":
    os.remove(os.path.join(a1, "agent-view", "a", "run-start.json"))
elif case == "view_unlistable":
    os.chmod(os.path.join(a1, "agent-view"), 0)
elif case == "row_no_run_dir":
    set_a(lambda m: m["scenarios"][0].pop("runDir"))
elif case == "row_not_object":
    set_a(lambda m: m["scenarios"].append("oops"))
# events.jsonl lines that do not parse (4 good lines, so an appended line is line 5).
elif case == "torn_start":
    append_events(b'{"ts":"x","type":"run_started_realtime","runId":"r","seed":2,"scenar\n')
elif case == "torn_declared":
    append_events(b'{"ts":"x","type":"run_start_declared","runStartBl\n')
elif case == "glued_starts":
    p = os.path.join(a1, "events.jsonl")  # a second start object glued onto line 1
    lines = open(p).read().splitlines()
    write(p, lines[0] + lines[0].replace("8650", "8660") + "\n" + "".join(l + "\n" for l in lines[1:]))
elif case == "declared_torn_in_place":  # the only declared line, cut short (line 3)
    p = os.path.join(a1, "events.jsonl")
    write(p, "".join((l[:30] if '"run_start_declared"' in l else l) + "\n" for l in open(p).read().splitlines()))
elif case == "non_utf8_line":
    append_events(b'{"type":"observation","note":"\xff"}\n')
elif case == "array_line":
    append_events(b'[1, 2]\n')
# Unexpected errors: BLOCKED "internal error", never a traceback with exit 1.
elif case == "row_agents_int":
    set_a(lambda m: m["scenarios"][0].update(agents=5))
elif case == "internal_then_fail":
    set_a(lambda m: m["scenarios"][0].update(agents=5))
    events(lambda ev: [dict(e, seed=2) if is_start(e) else e for e in ev], a2)
elif case == "deep_matrix_under_root":
    write(os.path.join(runs, "matrix-D", "matrix.json"), "[" * 100000)
else:
    sys.exit("unknown case " + case)
EOF

fails=0
seq=0
# control <case> <want exit> <want line count or -> <substring the output must contain> -- checker args (relative to the case dir)
control() {
  local case="$1" want="$2" lines="$3" needle="$4"; shift 5
  seq=$((seq + 1))
  local d="$T/$seq-$case"
  mkdir -p "$d"
  python3 -I "$T/mk.py" "$d/tree" "$case" || { echo "fixture $case could not be built"; fails=1; return; }
  local out got n ok=OK
  out="$(cd "$d/tree" && python3 -I "$checker" "$@" 2>&1)"; got=$?
  n="$(printf '%s\n' "$out" | grep -c .)"
  [ "$got" = "$want" ] || ok=MISMATCH
  [ "$lines" = - ] || [ "$n" = "$lines" ] || ok=MISMATCH
  printf '%s\n' "$out" | grep -qF -- "$needle" || ok=MISMATCH
  printf '%-34s want %s got %s, %s lines  %s\n' "$case" "$want" "$got" "$n" "$ok"
  printf '%s\n' "$out" | sed 's/^/    /'
  [ "$ok" = OK ] || fails=1
}
MA=runs/matrix-A/matrix.json
MB=runs/matrix-B/matrix.json
# Positive controls.
control good                    0 1 "PASS 4 scenarios in 2 matrices"   -- "$MA" "$MB"
control good                    0 1 "PASS 2 scenarios in 1 matrices"   -- "$MA"
control failed_row_plus_good    0 1 "1 failed rows not inspected"      -- "$MA"
# One problem each, caught by its own check.
control shared                  1 2 "run dir shared with"              -- "$MA" "$MB"
control shared                  1 1 "run dir shared with matrix-B s1"  -- "$MA"
mkdir -p "$T/elsewhere"
control shared                  0 1 "PASS 2 scenarios"                 -- "$MA" --runs-root "$T/elsewhere"
control regime                  1 1 "ran regime 'crash', row says 'calm'" -- "$MA"
control seed                    1 1 "ran seed 2, row says 1"           -- "$MA"
control two_starts              1 1 "2 run_started_realtime events"    -- "$MA"
control declared_block          1 1 "run_start_declared at block 999"  -- "$MA"
control summary_agents          1 1 "summary.json agents"              -- "$MA"
control summary_block           1 1 "summary.json runStartBlock 999"   -- "$MA"
control summary_runid           1 1 "summary.json runId"               -- "$MA"
control view_extra              1 1 "agent-view has agents this scenario did not run: c" -- "$MA"
control view_block              1 1 "differs from the run's"           -- "$MA"
control view_started_at         1 1 "a@101 2026-01-01T00:00:59.000Z"   -- "$MA"
control start_runid             1 1 "run_started_realtime runId '2026-01-01T00-00-00-999Z' is not the dir's" -- "$MA"
# Two arms in one run dir, same roster, field and start block: only the second declared start shows it.
control two_declared            1 1 "2 run_start_declared events, at blocks 101, 101" -- "$MA"
# Missing files: BLOCKED, never PASS.
control no_run_dir              2 1 "BLOCKED"                          -- "$MA"
control no_summary              2 1 "BLOCKED"                          -- "$MA"
control no_events               2 1 "BLOCKED"                          -- "$MA"
control no_run_start            2 1 "BLOCKED"                          -- "$MA"
control no_agent_view           2 1 "BLOCKED"                          -- "$MA"
control no_view_for_agent       2 1 "agent-view has no directory for: b" -- "$MA"
control bad_matrix_under_root   2 1 "BLOCKED matrix-C"                 -- "$MA"
control only_failed_rows        2 1 "no scenario with results"         -- runs/matrix-F/matrix.json
control good                    2 1 "BLOCKED runs root"                -- "$MA" --runs-root "$T/nowhere"
control good                    2 1 "BLOCKED matrix-Z: missing"        -- runs/matrix-Z/matrix.json
# Malformed inputs: BLOCKED with the specific cause, never PASS and never a FAIL.
control no_declared             2 1 "events.jsonl has no run_start_declared"  -- "$MA"
control no_started              2 1 "events.jsonl has no run_started_realtime" -- "$MA"
control start_no_seed           2 1 "run_started_realtime has no scenarioRegime/seed" -- "$MA"
control start_no_regime         2 1 "run_started_realtime has no scenarioRegime/seed" -- "$MA"
control summary_list            2 1 "summary.json is not an object"    -- "$MA"
control summary_agents_int      2 1 "summary.json agents is not a list: 5" -- "$MA"
control summary_non_utf8        2 1 "summary.json: 'utf-8' codec"      -- "$MA"
control run_start_no_block      2 1 "run-start.json has no integer runStartBlock" -- "$MA"
control run_start_no_started_at 2 1 "run-start.json has no startedAt string" -- "$MA"
control view_no_run_start       2 1 "agent-view run-start.json missing or unreadable for: a" -- "$MA"
control view_unlistable         2 1 "/agent-view: Permission denied"   -- "$MA"
control row_no_run_dir          2 1 "BLOCKED matrix-A s1 calm#1: has results but no runDir" -- "$MA"
control row_not_object          2 1 "BLOCKED matrix-A: scenario row is not an object: 'oops'" -- "$MA"
# events.jsonl lines that do not parse are BLOCKED, not skipped (one could be a second start).
control torn_start              2 1 "events.jsonl has 1 lines that do not parse as JSON objects (first: line 5)" -- "$MA"
control torn_declared           2 1 "events.jsonl has 1 lines that do not parse as JSON objects (first: line 5)" -- "$MA"
control glued_starts            2 1 "events.jsonl has 1 lines that do not parse as JSON objects (first: line 1)" -- "$MA"
control declared_torn_in_place  2 1 "events.jsonl has 1 lines that do not parse as JSON objects (first: line 3)" -- "$MA"
control non_utf8_line           2 1 "events.jsonl has 1 lines that do not parse as JSON objects (first: line 5)" -- "$MA"
control array_line              2 1 "events.jsonl has 1 lines that do not parse as JSON objects (first: line 5)" -- "$MA"
# Unexpected errors: one BLOCKED line, exit 2, no traceback; the other rows are still checked.
control row_agents_int          2 1 "BLOCKED matrix-A s1 calm#1 2026-01-01T00-00-00-001Z: internal error: TypeError" -- "$MA"
control deep_matrix_under_root  2 1 "BLOCKED check-collision: internal error: RecursionError" -- "$MA"
# A FAIL is not hidden behind a BLOCKED elsewhere.
control fail_and_blocked        1 2 "ran seed 2"                       -- "$MA" "$MB"
control internal_then_fail      1 2 "s2 crash#1 2026-01-01T00-00-00-002Z: ran seed 2, row says 1" -- "$MA"
if [ "$fails" = 0 ]; then echo ALL_CONTROLS_OK; exit 0; fi
echo CONTROL_FAILED; exit 1
