#!/usr/bin/env python3
"""Did every scenario of a backtest matrix run in a run directory of its own?
    python3 ascon/eval/check-collision.py <matrix.json> [<matrix.json> ...] [--runs-root DIR]
Exit 0 PASS (one summary line); 1 FAIL (one line per problem); 2 BLOCKED (a file needed to decide
is missing, unreadable or malformed, or the checker itself hit an unexpected error, and nothing else
failed). Never PASS on a file it could not read. An unexpected error is reported as a BLOCKED line,
never as a traceback with exit 1, so a caller that maps exit 1 to "collision" is not misled.

Why: the backtest names a run directory after its start time to the millisecond
(runs/<ISO time>, core/src/realtime/coordinator.ts). Two lanes started in the same millisecond
wrote into one directory: one lane's agents read the other run's agent-view/<id>/run-start.json and
idled, and check-matrix.py still said PASS, because each coordinator puts its own in-memory summary
into its own matrix.json.

Checks, for every scenario row of the given matrices that has results:
  - its runDir is used by no other scenario row, in the given matrices or in any matrix.json one
    level under the runs root (default: the runs/ directory the first matrix sits in);
  - every non-blank line of events.jsonl is a UTF-8 JSON object (the logger writes one per line; a
    line that does not parse could be a start or declared event, so it is BLOCKED, not skipped);
  - events.jsonl holds exactly one run_started_realtime (a second one is a second coordinator), and
    its runId / scenarioRegime / seed are the row's (summary.json carries no regime or seed);
  - events.jsonl holds exactly one run_start_declared, at run-start.json's runStartBlock. When two
    arms share a run dir with the same roster, field and start block, this count is the check that
    still tells them apart: the second coordinator's RunLogger truncates events.jsonl and then logs
    its run_started_realtime, so the first one's can be gone, while each coordinator logs its
    run_start_declared much later (core/src/logger.ts, core/src/realtime/coordinator.ts);
  - summary.json's runId is the directory's name, its agent ids are the row's, and its
    runStartBlock is run-start.json's;
  - agent-view/ holds a directory for each of the row's agents and no other, and each one's
    run-start.json carries the run directory's runStartBlock and startedAt.
A matrix row (schema 2: s, regime, seed, agents, runDir, optional startsAt/error) carries no start
block, so the start block is compared across the run directory's own files. A row without agents
(a failed scenario: `error`, usually no runDir) is not inspected; its runDir, if any, still counts
for sharing. With --repeat > 1 only the last repeat's runDir is in the row, so earlier repeats are
not seen. A copy of a matrix directory under the runs root reads as sharing (a FAIL, never a PASS).
"""
import json
import os
import sys

FAIL, BLOCKED = "FAIL", "BLOCKED"
problems = []  # (kind, line)


def problem(kind, where, what):
    problems.append((kind, f"{kind} {where}: {what}"))


def internal(where, e):
    problem(BLOCKED, where, f"internal error: {type(e).__name__}: {str(e)[:200]}")


def load_json(path):
    """(value, None) or (None, why)."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f), None
    except FileNotFoundError:
        return None, f"missing {path}"
    except (OSError, ValueError) as e:
        return None, f"cannot read {path}: {e}"


def finish():
    for _, line in problems:
        print(line)
    kinds = {k for k, _ in problems}
    if FAIL in kinds:
        sys.exit(1)
    if BLOCKED in kinds:
        sys.exit(2)


def label(path):
    return os.path.basename(os.path.dirname(path))


def resolve_run_dir(matrix_path, run_dir):
    # runDir is relative to the backtest's working directory (runs/<id>, from REPORT_DIR="./runs"),
    # which is the directory holding runs/ -- two levels above runs/matrix-<id>/.
    if os.path.isabs(run_dir):
        return os.path.realpath(run_dir)
    root = os.path.dirname(os.path.dirname(os.path.dirname(matrix_path)))
    return os.path.realpath(os.path.join(root, run_dir))


def events_of(path, types):
    """(events of the given types in order, count of bad lines, number of the first bad line), or
    None if the file cannot be opened or read. A bad line is a non-blank line that is not UTF-8 or
    not a JSON object."""
    out, bad, first_bad = [], 0, None
    try:
        with open(path, "rb") as f:
            for no, raw in enumerate(f, 1):
                if not raw.strip():
                    continue
                try:
                    e = json.loads(raw.decode("utf-8"))  # UnicodeDecodeError is a ValueError
                except ValueError:
                    e = None
                if not isinstance(e, dict):
                    bad += 1
                    first_bad = first_bad or no
                    continue
                if e.get("type") in types:
                    out.append(e)
    except OSError:
        return None
    return out, bad, first_bad


def check_row(path, idx, row, d, where, users):
    others = [name for p, i, name in users.get(d, []) if (p, i) != (path, idx)]
    if others:
        problem(FAIL, where, "run dir shared with " + ", ".join(others))
    if not os.path.isdir(d):
        problem(BLOCKED, where, f"run dir not found: {d}")
        return
    run_id = os.path.basename(d)
    ids = sorted(str(a.get("id")) for a in row["agents"] if isinstance(a, dict))

    summary, why = load_json(os.path.join(d, "summary.json"))
    if why:
        problem(BLOCKED, where, why)
    start, why2 = load_json(os.path.join(d, "run-start.json"))
    if why2:
        problem(BLOCKED, where, why2)
    start_block = start.get("runStartBlock") if isinstance(start, dict) else None
    if start is not None and not isinstance(start_block, int):
        problem(BLOCKED, where, "run-start.json has no integer runStartBlock")
        start_block = None
    started_at = start.get("startedAt") if isinstance(start, dict) else None
    if start is not None and not isinstance(started_at, str):
        problem(BLOCKED, where, "run-start.json has no startedAt string")
        started_at = None

    if isinstance(summary, dict):
        if summary.get("runId") != run_id:
            problem(FAIL, where, f"summary.json runId {summary.get('runId')!r} is not the dir's")
        s_agents = summary.get("agents")
        if not isinstance(s_agents, list):
            problem(BLOCKED, where, f"summary.json agents is not a list: {s_agents!r:.80}")
        else:
            s_ids = sorted(str(a.get("id")) for a in s_agents if isinstance(a, dict))
            if s_ids != ids:
                problem(FAIL, where, f"summary.json agents {s_ids} != the row's {ids}")
        if start_block is not None and summary.get("runStartBlock") != start_block:
            problem(FAIL, where, f"summary.json runStartBlock {summary.get('runStartBlock')} "
                                 f"!= run-start.json {start_block}")
    elif summary is not None:
        problem(BLOCKED, where, "summary.json is not an object")

    got = events_of(os.path.join(d, "events.jsonl"), ("run_started_realtime", "run_start_declared"))
    if got is None:
        problem(BLOCKED, where, f"missing or unreadable {os.path.join(d, 'events.jsonl')}")
    else:
        events, bad, first_bad = got
        if bad:
            problem(BLOCKED, where, f"events.jsonl has {bad} lines that do not parse as JSON objects "
                                    f"(first: line {first_bad}); a run_started_realtime or "
                                    "run_start_declared may be among them")
        starts = [e for e in events if e.get("type") == "run_started_realtime"]
        declared = [e for e in events if e.get("type") == "run_start_declared"]
        if len(starts) > 1:
            problem(FAIL, where, f"{len(starts)} run_started_realtime events (more than one coordinator "
                                 "wrote here): " + ", ".join(
                                     f"{e.get('scenarioRegime')}#{e.get('seed')} rpc {e.get('rpcUrl')}"
                                     for e in starts))
        elif not starts:
            if not bad:  # with bad lines, the missing event is most likely one of them
                problem(BLOCKED, where, "events.jsonl has no run_started_realtime")
        else:
            e = starts[0]
            if "scenarioRegime" not in e or "seed" not in e:
                problem(BLOCKED, where, "run_started_realtime has no scenarioRegime/seed")
            else:
                if e["scenarioRegime"] != row.get("regime"):
                    problem(FAIL, where, f"ran regime {e['scenarioRegime']!r}, row says {row.get('regime')!r}")
                if e["seed"] != row.get("seed"):
                    problem(FAIL, where, f"ran seed {e['seed']!r}, row says {row.get('seed')!r}")
            if e.get("runId") != run_id:
                problem(FAIL, where, f"run_started_realtime runId {e.get('runId')!r} is not the dir's")
        if len(declared) > 1:
            problem(FAIL, where, f"{len(declared)} run_start_declared events, at blocks "
                                 + ", ".join(str(x.get("runStartBlock")) for x in declared))
        elif not declared:
            if not bad:
                problem(BLOCKED, where, "events.jsonl has no run_start_declared")
        elif start_block is not None and declared[0].get("runStartBlock") != start_block:
            problem(FAIL, where, f"run_start_declared at block {declared[0].get('runStartBlock')} "
                                 f"!= run-start.json {start_block}")

    view = os.path.join(d, "agent-view")
    if not os.path.isdir(view):
        problem(BLOCKED, where, f"missing {view}")
        return
    try:
        present = sorted(x for x in os.listdir(view) if os.path.isdir(os.path.join(view, x)))
    except OSError as e:
        problem(BLOCKED, where, f"cannot list {view}: {e.strerror or e}")
        return
    extra = sorted(set(present) - set(ids))
    absent = sorted(set(ids) - set(present))
    if extra:
        problem(FAIL, where, "agent-view has agents this scenario did not run: " + ", ".join(extra))
    if absent:
        problem(BLOCKED, where, "agent-view has no directory for: " + ", ".join(absent))
    if not isinstance(start, dict):
        return
    differ, unread = [], []
    for a in sorted(set(present) & set(ids)):
        v, why = load_json(os.path.join(view, a, "run-start.json"))
        if why or not isinstance(v, dict):
            unread.append(a)
        elif ((start_block is not None and v.get("runStartBlock") != start_block)
              or (started_at is not None and v.get("startedAt") != started_at)):
            differ.append(f"{a}@{v.get('runStartBlock')} {v.get('startedAt')}")
    if differ:
        problem(FAIL, where, f"agent-view run-start.json differs from the run's "
                             f"(block {start_block}, {started_at}): " + ", ".join(differ))
    if unread:
        problem(BLOCKED, where, "agent-view run-start.json missing or unreadable for: " + ", ".join(unread))


def main():
    args = sys.argv[1:]
    runs_root = None
    if "--runs-root" in args:
        i = args.index("--runs-root")
        if i + 1 >= len(args):
            print("BLOCKED usage: --runs-root needs a directory")
            sys.exit(2)
        runs_root = args[i + 1]
        del args[i:i + 2]
    if not args:
        print("BLOCKED usage: check-collision.py <matrix.json> [<matrix.json> ...] [--runs-root DIR]")
        sys.exit(2)

    given = [os.path.realpath(p) for p in args]
    if runs_root is None:
        runs_root = os.path.dirname(os.path.dirname(given[0]))
    runs_root = os.path.realpath(runs_root)
    if not os.path.isdir(runs_root):
        print(f"BLOCKED runs root is not a directory: {runs_root}")
        sys.exit(2)

    # Every matrix.json to look at: the given ones first, then those one level under the runs root.
    found = []
    for entry in sorted(os.listdir(runs_root)):
        p = os.path.join(runs_root, entry, "matrix.json")
        if os.path.isfile(p):
            found.append(os.path.realpath(p))
    order = list(dict.fromkeys(given + found))

    users = {}  # resolved run dir -> [(matrix path, row index, "<matrix> <tag>")]
    to_check = []  # (matrix path, row index, row, resolved run dir, tag)
    skipped = 0
    for path in order:
        m, why = load_json(path)
        if why:
            problem(BLOCKED, label(path), why)
            continue
        rows = m.get("scenarios") if isinstance(m, dict) else None
        if not isinstance(rows, list):
            problem(BLOCKED, label(path), "matrix.json has no scenarios list")
            continue
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                problem(BLOCKED, label(path), f"scenario row is not an object: {row!r:.80}")
                continue
            tag = f"s{row.get('s')} {row.get('regime')}#{row.get('seed')}"
            rd = row.get("runDir")
            if isinstance(rd, str) and rd:
                d = resolve_run_dir(path, rd)
                users.setdefault(d, []).append((path, idx, f"{label(path)} {tag}"))
            else:
                d = None
            if path not in given:
                continue
            if not row.get("agents"):
                skipped += 1
                continue
            if d is None:
                problem(BLOCKED, f"{label(path)} {tag}", "has results but no runDir")
                continue
            to_check.append((path, idx, row, d, tag))

    if not to_check and not problems:
        problem(BLOCKED, ",".join(label(p) for p in given), "no scenario with results to check")

    for path, idx, row, d, tag in to_check:
        where = f"{label(path)} {tag} {os.path.basename(d)}"
        try:
            check_row(path, idx, row, d, where, users)
        except Exception as e:  # one row's surprise is that row's BLOCKED, not a crash
            internal(where, e)

    finish()
    note = f", {skipped} failed rows not inspected" if skipped else ""
    print(f"PASS {len(to_check)} scenarios in {len(given)} matrices, each in its own run dir "
          f"(against {len(order)} matrix.json incl. {runs_root}/*/matrix.json); events, run-start, "
          f"summary and agent-view agree with regime, seed, agents and start block{note}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never a traceback with exit 1: report BLOCKED (a FAIL found before still wins)
        internal("check-collision", e)
        finish()
