#!/usr/bin/env python3
"""Is a backtest matrix complete enough to read?
    python3 ascon/eval/check-matrix.py <runs/matrix-.../matrix.json> <roster.yaml>
Prints "PASS ..." or "FAIL <why>" and exits 0 / 1. Complete means: every planned scenario has
results, and every result has exactly the roster's agent count (a run that picked up another run's
roster has a different count)."""
import json, re, sys

matrix, roster = sys.argv[1], sys.argv[2]
m = json.load(open(matrix))
expected = len(re.findall(r"(?m)^\s*-\s+id:\s*\S", open(roster).read()))
planned = m.get("scenariosPlanned")
results = m.get("scenarios")
if not isinstance(results, list):
    print("FAIL matrix.json has no scenarios list")
    sys.exit(1)
ok = [r for r in results if r.get("agents")]
bad = [f"{r['regime']}#{r['seed']}={len(r['agents'])}" for r in ok if len(r["agents"]) != expected]
problems = []
if not isinstance(planned, int):
    problems.append("scenariosPlanned missing")
elif len(ok) != planned:
    problems.append(f"{len(ok)}/{planned} scenarios have results")
if expected == 0:
    problems.append("roster has no agents")
if bad:
    problems.append(f"agent count != roster {expected}: " + ", ".join(bad))
if problems:
    print("FAIL " + "; ".join(problems))
    sys.exit(1)
print(f"PASS {len(ok)}/{planned} scenarios, {expected} agents each, {matrix}")
