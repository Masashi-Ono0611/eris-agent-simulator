#!/usr/bin/env python3
"""Is a backtest matrix complete enough to read?
    python3 ascon/eval/check-matrix.py <runs/matrix-.../matrix.json> <roster.yaml> <scenarios.yaml>
Prints "PASS ..." or "FAIL <why>" and exits 0 / 1. Complete means: the scenarios that have results
are exactly the (regime, seed) pairs the scenario file asks for, each once, and every one of them
has exactly the roster's agent count (a run that picked up another run's roster has a different
count). The scenario file is the simple form used under ascon/: `regimes: [a, b]` and `seeds: [1]`."""
import json, re, sys

matrix, roster, scenarios = sys.argv[1], sys.argv[2], sys.argv[3]


def fail(why):
    print("FAIL " + why)
    sys.exit(1)


def flow_list(text, key):
    m = re.search(rf"(?m)^{key}:\s*\[([^\]]*)\]", text)
    if not m:
        fail(f"{scenarios}: no `{key}: [...]` line")
    return [v.strip() for v in m.group(1).split(",") if v.strip()]


spec = open(scenarios).read()
wanted = {(r, int(s)) for r in flow_list(spec, "regimes") for s in flow_list(spec, "seeds")}
if not wanted:
    fail("the scenario file asks for no scenarios")
roster_ids = sorted(re.findall(r"(?m)^\s*-\s+id:\s*([^\s#]+)", open(roster).read()))
expected = len(roster_ids)
if expected == 0:
    fail("roster has no agents")

m = json.load(open(matrix))
planned = m.get("scenariosPlanned")
results = m.get("scenarios")
if not isinstance(results, list):
    fail("matrix.json has no scenarios list")
if not isinstance(planned, int) or planned <= 0:
    fail(f"scenariosPlanned is {planned!r}")
if planned != len(wanted):
    fail(f"planned {planned} scenarios, the scenario file asks for {len(wanted)}")

rows = [(r.get("regime"), r.get("seed")) for r in results]
done = [(r.get("regime"), r.get("seed")) for r in results if r.get("agents")]
problems = []
missing = sorted(wanted - set(done))
# Over every row, failed ones included: a failed extra or repeated scenario is still wrong output.
extra = sorted(set(rows) - wanted, key=str)
dupes = sorted({k for k in rows if rows.count(k) > 1}, key=str)
if missing:
    problems.append(f"{len(wanted) - len(missing)}/{len(wanted)} scenarios have results; missing "
                    + ", ".join(f"{r}#{s}" for r, s in missing))
if extra:
    problems.append("not asked for: " + ", ".join(f"{r}#{s}" for r, s in extra))
if dupes:
    problems.append("more than one result: " + ", ".join(f"{r}#{s}" for r, s in dupes))
bad = [f"{r['regime']}#{r['seed']}" for r in results
       if r.get("agents") and sorted(str(a.get("id")) for a in r["agents"]) != roster_ids]
if bad:
    problems.append(f"agents != the roster's {expected} ids, each once: " + ", ".join(bad))
if problems:
    fail("; ".join(problems))
print(f"PASS {len(wanted)}/{len(wanted)} scenarios, {expected} agents each, {matrix}")
