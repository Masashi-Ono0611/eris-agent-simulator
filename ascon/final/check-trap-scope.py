#!/usr/bin/env python3
"""Is a trap-launcher control still unnecessary for these scenario files and arms?
    python3 ascon/final/check-trap-scope.py --scenarios <file>... --arms <dir>... [--root REPO]
<dir> is a directory name under example/agents/ (opus-1, opus-1-pb, ...) or a path. --root is the
repository (default: the one this script is in).
Exit 0 PASS (one line); 1 FAIL (one line per problem); 2 BLOCKED (something needed to decide is
missing or could not be read, and nothing failed).

Why: the final plan dropped its trap control (field FT, criterion (e)) on two premises; see
ascon/final/README.md. This re-checks both whenever a scenario file or an arm (C1, R) is added.
  1. trap-launcher can only set its trap where the run has the permissionless lending singleton,
     which the coordinator deploys only when run.protocols includes `lending`
     (core/src/realtime/coordinator.ts, deployAgentMarketVenues withLending). Without it the agent
     logs "trap-launcher idle" and stops. FAIL if any regime of the scenario files lists `lending`.
  2. The trap takes only what is lent into it. FAIL if an arm's source mentions lending: its
     directory's .ts/.mts/.js/.py files and every file they import by relative path, transitively
     (an arm can reach the venue through ../lib/, as discovery-arb does). Case-insensitive `lending`,
     except `lending-incident` / `lending_incident` (a regime name). A hit is a reason to look, not
     proof the arm lends: the answer is a trap control in a world that has the venue.
Scenario files use the simple form `regimes: [a, b]`. A regime name resolves the way the backtest
CLI does (core/src/backtest/shared.ts resolveRegimePath). run.protocols is read as a flow list
(`protocols: [a, b]`) or a block list under the top-level `run:` key; anything else is BLOCKED.
"""
import os
import re
import sys

FAIL, BLOCKED = "FAIL", "BLOCKED"
problems = []
LENDING = re.compile(r"lending(?![-_]incident)", re.I)
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}/[^"']+)["']""")
SOURCE_EXT = (".ts", ".mts", ".js", ".py")


def problem(kind, where, what):
    problems.append((kind, f"{kind} {where}: {what}"))


def flow_or_block(lines, i, indent):
    """Value list of the key on lines[i] (`key: [a, b]` or `key:` + `- a` lines), or None."""
    m = re.match(r"\s*[A-Za-z_]+:\s*(.*?)\s*(#.*)?$", lines[i])
    rest = m.group(1) if m else ""
    if rest.startswith("["):
        if not rest.endswith("]"):
            return None
        return [v.strip().strip("'\"") for v in rest[1:-1].split(",") if v.strip()]
    if rest:
        return None
    out = []
    for line in lines[i + 1:]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if len(line) - len(line.lstrip()) <= indent or not line.lstrip().startswith("- "):
            break
        out.append(line.lstrip()[2:].split("#")[0].strip().strip("'\""))
    return out or None


def run_protocols(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    try:
        start = lines.index("run:")
    except ValueError:
        return None
    for i in range(start + 1, len(lines)):
        line = lines[i]
        if line.strip() and not line[0].isspace():
            break  # next top-level key: run: has no protocols
        m = re.match(r"(\s+)protocols:", line)
        if m:
            return flow_or_block(lines, i, len(m.group(1)))
    return None


def check_scenarios(root, files):
    for sf in files:
        try:
            text = open(sf, encoding="utf-8").read()
        except OSError as e:
            problem(BLOCKED, sf, f"cannot read: {e.strerror or e}")
            continue
        m = re.search(r"(?m)^regimes:\s*\[([^\]]*)\]", text)
        regimes = [v.strip() for v in m.group(1).split(",") if v.strip()] if m else []
        if not regimes:
            problem(BLOCKED, sf, "no `regimes: [...]` line")
            continue
        for r in regimes:
            is_path = "/" in r or r.endswith(".yaml") or r.endswith(".yml")
            p = os.path.join(root, r) if is_path else os.path.join(root, "config", "regimes", r + ".yaml")
            try:
                prot = run_protocols(p)
            except (OSError, ValueError) as e:
                problem(BLOCKED, f"{sf} {r}", f"cannot read {p}: {e}")
                continue
            if prot is None:
                problem(BLOCKED, f"{sf} {r}", f"no readable run.protocols in {p}")
            elif "lending" in prot:
                problem(FAIL, f"{sf} {r}", f"run.protocols includes lending ({', '.join(prot)}): "
                                           "trap-launcher can set its trap in this regime")


def shown(path, root):
    rel = os.path.relpath(path, root)
    return path if rel.startswith("..") else rel


def source_closure(root, arm_dir):
    """(files, unresolved imports) reachable from the arm's directory by relative import."""
    todo = []
    for base, dirs, names in os.walk(arm_dir):
        dirs[:] = [x for x in dirs if x != "node_modules"]
        todo += [os.path.join(base, n) for n in sorted(names) if n.endswith(SOURCE_EXT)]
    seen, unresolved = set(), []
    while todo:
        f = os.path.realpath(todo.pop())
        if f in seen:
            continue
        seen.add(f)
        if f.endswith(".py"):
            continue  # relative Python imports stay inside the directory, which is walked
        for spec in IMPORT.findall(open(f, encoding="utf-8").read()):
            cand = os.path.normpath(os.path.join(os.path.dirname(f), spec))
            stem = re.sub(r"\.(m?js)$", "", cand)
            hit = next((c for c in (cand, stem + ".ts", stem + ".mts", stem + ".js",
                                    os.path.join(cand, "index.ts")) if os.path.isfile(c)), None)
            if hit:
                todo.append(hit)
            else:
                unresolved.append(f"{shown(f, root)} -> {spec}")
    return sorted(seen), unresolved


def check_arms(root, arms):
    for a in arms:
        d = a if "/" in a else os.path.join(root, "example", "agents", a)
        if not (os.path.isfile(os.path.join(d, "agent.ts")) or os.path.isfile(os.path.join(d, "strategy.py"))):
            problem(BLOCKED, a, f"no agent.ts or strategy.py in {d}")
            continue
        files, unresolved = source_closure(root, d)
        for u in unresolved:
            problem(BLOCKED, a, f"relative import not found: {u}")
        for f in files:
            for no, line in enumerate(open(f, encoding="utf-8"), 1):
                if LENDING.search(line):
                    problem(FAIL, a, f"{shown(f, root)}:{no} mentions lending: "
                                     f"{line.strip()[:100]}")
                    break


def main():
    args = sys.argv[1:]
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
    groups = {"--scenarios": [], "--arms": []}
    cur = None
    i = 0
    while i < len(args):
        x = args[i]
        if x == "--root" and i + 1 < len(args):
            root = os.path.realpath(args[i + 1])
            i += 2
            continue
        if x in groups:
            cur = x
        elif cur is None:
            print("BLOCKED usage: check-trap-scope.py --scenarios <file>... --arms <dir>... [--root REPO]")
            sys.exit(2)
        else:
            groups[cur].append(x)
        i += 1
    if not groups["--scenarios"] or not groups["--arms"]:
        print("BLOCKED usage: give at least one --scenarios file and one --arms directory")
        sys.exit(2)
    check_scenarios(root, groups["--scenarios"])
    check_arms(root, groups["--arms"])
    for _, line in problems:
        print(line)
    kinds = {k for k, _ in problems}
    if FAIL in kinds:
        sys.exit(1)
    if BLOCKED in kinds:
        sys.exit(2)
    print(f"PASS {len(groups['--scenarios'])} scenario files: no regime lists lending; "
          f"{len(groups['--arms'])} arms: no lending in their source or its relative imports")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # never a traceback with exit 1
        print(f"BLOCKED check-trap-scope: internal error: {type(e).__name__}: {str(e)[:200]}")
        sys.exit(2)
