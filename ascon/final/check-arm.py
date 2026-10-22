#!/usr/bin/env python3
"""Did the slot run the intended arm, frozen, in every scenario of a matrix?
    python3 ascon/final/check-arm.py <matrix.json> <arm> [--slot ID]
<arm> is the directory name under example/agents/ that the roster copy put on the slot's `dir:` line
(opus-1, opus-1-pb, ...). --slot is the slot's agent id (default: slot).
Exit 0 PASS (one summary line); 1 FAIL (one line per problem); 2 BLOCKED (a record needed to decide is
missing or unreadable, and nothing failed). Never PASS on a record it could not read.

Why: under slot replacement every arm of a field has the same agent ids, so check-matrix.py and
check-collision.py, which compare ids, cannot tell one arm from another. A roster copy made with the
wrong directory gives B == C1 and every comparison of the two reads as zero. The run records the arm
itself: the agent runtime writes one `runtime_start` line, with the directory it loaded and its mode,
to runs/<id>/agents/<agentId>.jsonl (example/agents/runtime/botMain.ts, logMempool "runtime_start").

For every scenario row with results, in <runDir>/agents/<slot>.jsonl:
  - every non-blank line is a JSON object (a line that does not parse could be a runtime_start);
  - exactly one runtime_start (a second one is a second process writing as the slot);
  - its agentId is the slot id, the last path component of its agentDir is <arm>, and its mode is
    "decide".
"decide" means frozen only for an arm that ships a prompt.md: such an arm without ERIS_AGENT_FROZEN
runs as "improve" (botMain.ts, `const mode = ...`). Every planned arm ships one. The agentDir check
assumes the process sandbox (run-matrix.sh), where agentDir is the host path of the arm's directory.
A row without agents (a failed scenario) is not inspected; check-matrix.py reports it.
"""
import json
import os
import sys

FAIL, BLOCKED = "FAIL", "BLOCKED"
problems = []  # (kind, line)


def problem(kind, where, what):
    problems.append((kind, f"{kind} {where}: {what}"))


def finish():
    for _, line in problems:
        print(line)
    kinds = {k for k, _ in problems}
    if FAIL in kinds:
        sys.exit(1)
    if BLOCKED in kinds:
        sys.exit(2)


def resolve_run_dir(matrix_path, run_dir):
    # runDir is relative to the directory holding runs/ (two levels above runs/matrix-<id>/), as in
    # ascon/eval/check-collision.py.
    if os.path.isabs(run_dir):
        return os.path.realpath(run_dir)
    root = os.path.dirname(os.path.dirname(os.path.dirname(matrix_path)))
    return os.path.realpath(os.path.join(root, run_dir))


def check_row(row, d, where, slot, arm):
    if slot not in [str(a.get("id")) for a in row["agents"] if isinstance(a, dict)]:
        problem(FAIL, where, f"the row's agents have no {slot!r}; this is not a slot roster")
        return
    path = os.path.join(d, "agents", slot + ".jsonl")
    starts, bad, first_bad = [], 0, None
    try:
        with open(path, "rb") as f:
            for no, raw in enumerate(f, 1):
                if not raw.strip():
                    continue
                try:
                    e = json.loads(raw.decode("utf-8"))
                except ValueError:
                    e = None
                if not isinstance(e, dict):
                    bad += 1
                    first_bad = first_bad or no
                elif e.get("event") == "runtime_start":
                    starts.append(e)
    except OSError as e:
        problem(BLOCKED, where, f"cannot read {path}: {e.strerror or e}")
        return
    if len(starts) > 1:
        problem(FAIL, where, f"{len(starts)} runtime_start lines in {slot}.jsonl: " + ", ".join(
            f"{os.path.basename(str(s.get('agentDir')))}/{s.get('mode')}" for s in starts))
        return
    if bad:
        problem(BLOCKED, where, f"{slot}.jsonl has {bad} lines that do not parse as JSON objects "
                                f"(first: line {first_bad}); a runtime_start may be among them")
        return
    if not starts:
        problem(BLOCKED, where, f"{slot}.jsonl has no runtime_start (the slot never started?)")
        return
    s = starts[0]
    agent_dir = s.get("agentDir")
    if not isinstance(agent_dir, str) or not agent_dir:
        problem(BLOCKED, where, f"runtime_start has no agentDir: {agent_dir!r:.80}")
        return
    ran = os.path.basename(agent_dir.rstrip("/"))
    if s.get("agentId") != slot:
        problem(FAIL, where, f"runtime_start agentId {s.get('agentId')!r} is not {slot!r}")
    if ran != arm:
        problem(FAIL, where, f"the slot ran {ran!r} ({agent_dir}), not {arm!r}")
    if s.get("mode") != "decide":
        problem(FAIL, where, f"the slot ran in mode {s.get('mode')!r}, not 'decide' (frozen)")


def main():
    args = sys.argv[1:]
    slot = "slot"
    if "--slot" in args:
        i = args.index("--slot")
        if i + 1 >= len(args):
            print("BLOCKED usage: --slot needs an agent id")
            sys.exit(2)
        slot = args[i + 1]
        del args[i:i + 2]
    if len(args) != 2:
        print("BLOCKED usage: check-arm.py <matrix.json> <arm> [--slot ID]")
        sys.exit(2)
    matrix, arm = os.path.realpath(args[0]), args[1]
    if not arm or "/" in arm:
        print(f"BLOCKED usage: <arm> is a directory name under example/agents/, got {arm!r}")
        sys.exit(2)
    label = os.path.basename(os.path.dirname(matrix))
    try:
        with open(matrix, encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError) as e:
        print(f"BLOCKED {label}: cannot read {matrix}: {e}")
        sys.exit(2)
    rows = m.get("scenarios") if isinstance(m, dict) else None
    if not isinstance(rows, list):
        print(f"BLOCKED {label}: matrix.json has no scenarios list")
        sys.exit(2)
    checked = skipped = 0
    for row in rows:
        if not isinstance(row, dict):
            problem(BLOCKED, label, f"scenario row is not an object: {row!r:.80}")
            continue
        where = f"{label} s{row.get('s')} {row.get('regime')}#{row.get('seed')}"
        if not row.get("agents"):
            skipped += 1
            continue
        rd = row.get("runDir")
        if not isinstance(rd, str) or not rd:
            problem(BLOCKED, where, "has results but no runDir")
            continue
        try:
            check_row(row, resolve_run_dir(matrix, rd), where, slot, arm)
        except Exception as e:  # one row's surprise is that row's BLOCKED, not a traceback
            problem(BLOCKED, where, f"internal error: {type(e).__name__}: {str(e)[:200]}")
        checked += 1
    if checked == 0 and not problems:
        problem(BLOCKED, label, "no scenario with results to check")
    finish()
    note = f", {skipped} failed rows not inspected" if skipped else ""
    print(f"PASS {checked} scenarios in {label}: {slot} ran {arm} in mode decide, one runtime_start "
          f"each{note}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # never a traceback with exit 1
        print(f"BLOCKED check-arm: internal error: {type(e).__name__}: {str(e)[:200]}")
        sys.exit(2)
