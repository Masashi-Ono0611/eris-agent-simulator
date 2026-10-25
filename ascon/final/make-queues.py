#!/usr/bin/env python3
"""Write the lane-queue files for one stage of the final evaluation, or check a set of them.

    python3 ascon/final/make-queues.py --stage s1 --seeds 1003-1006 --fields FP,FD \
        --arms opus-1,opus-1-pb,opus-1a --lanes A,B --order-seed 7 --out <dir>
    python3 ascon/final/make-queues.py --check <dir>

Writes <dir>/<stage>-<lane>.txt, one per lane, in ascon/eval/lane-queue.sh format:
    <stage>-<field><seed>-<arm> ascon/final/roster-<field>.yaml <arm> ascon/final/scen-<seed>.yaml
Rules (plan, Step 0 "cell execution"):
  - a cell is one (seed, field); all its arms run on one lane, back to back;
  - cell (i-th seed, j-th field) goes to lane (i + j) mod lanes: lanes get equal numbers of cells (+-1)
    and, with as many fields as lanes, every lane runs every field (plain round-robin by cell would put
    all of one field on one lane and confound the field with the host's load);
  - the arm order inside a cell is random.Random(order_seed + cell index).shuffle(arms), fixed before
    anything runs and recorded in the file.
Each file starts with comment lines that record the order seed, the git commit of the checkout and the
arguments; --check reads them back. --seeds takes a list and ranges: 1003-1006,1011.

--check <dir> asserts, over every *.txt in <dir>: all files carry the same arguments; every (field, seed,
arm) the arguments ask for appears exactly once and nothing else does; each cell sits on one lane, its arms
in one block; job names follow the rule and are unique; every roster template, slot directory
(example/agents/<arm>) and scenario file exists; the scenario file is ascon/final/scen-<seed>.yaml and
lists exactly that seed. Exit 0 PASS (one line), 1 FAIL (one line per problem), 2 BLOCKED (cannot read).
FS instead uses scen-FS-<seed>.yaml: exactly two inline lists, regimes
[launch, cdp-incident, lending-incident] in that order and seeds [<seed>].
Generation refuses (exit 2) when an arm directory, roster or scenario file is missing, and runs the same
check on what it wrote.
Paths are relative to the repo root (this file's ../..), which is also where lane-queue.sh resolves them.
"""
import argparse
import os
import random
import re
import subprocess
import sys

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


def parse_seeds(text):
    out = []
    for part in text.split(","):
        part = part.strip()
        m = re.fullmatch(r"(\d+)-(\d+)", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if b < a:
                raise ValueError(f"bad seed range {part}")
            out.extend(range(a, b + 1))
        elif re.fullmatch(r"\d+", part):
            out.append(int(part))
        else:
            raise ValueError(f"bad seed {part!r}")
    if len(set(out)) != len(out):
        raise ValueError("a seed is listed twice")
    return out


def split_list(text, what):
    items = [x.strip() for x in text.split(",") if x.strip()]
    if not items:
        raise ValueError(f"no {what}")
    if len(set(items)) != len(items):
        raise ValueError(f"a {what[:-1]} is listed twice: {text}")
    for x in items:
        if not NAME.match(x):
            raise ValueError(f"bad {what[:-1]} name {x!r}")
    return items


def roster(field):
    return f"ascon/final/roster-{field}.yaml"


def scen(seed, field):
    return f"ascon/final/scen-{'FS-' if field == 'FS' else ''}{seed}.yaml"


def plan(stage, seeds, fields, arms, lanes, order_seed):
    """{lane: [(job, roster, arm, scenarios, cell)]}"""
    out = {lane: [] for lane in lanes}
    cell = 0
    for i, seed in enumerate(seeds):
        for j, field in enumerate(fields):
            order = list(arms)
            random.Random(order_seed + cell).shuffle(order)
            lane = lanes[(i + j) % len(lanes)]
            for arm in order:
                out[lane].append((f"{stage}-{field}{seed}-{arm}", roster(field), arm, scen(seed, field), (seed, field)))
            cell += 1
    return out


def git_head():
    try:
        r = subprocess.run(["git", "-C", ROOT, "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else "nogit"
    except OSError:
        return "nogit"


def args_line(a):
    return (f"--stage {a.stage} --seeds {a.seeds} --fields {a.fields} --arms {a.arms} "
            f"--lanes {a.lanes} --order-seed {a.order_seed}")


def scen_seeds(path):
    """The seeds: [..] list of a scenario file, or None."""
    try:
        with open(os.path.join(ROOT, path)) as f:
            for line in f:
                m = re.match(r"\s*seeds:\s*\[([^\]]*)\]", line)
                if m:
                    return [int(x) for x in m.group(1).replace(" ", "").split(",") if x]
    except (OSError, ValueError):
        return None
    return None


def fs_scen_ok(path, seed):
    """Fail closed on extra regimes, duplicate keys or unsupported YAML syntax."""
    try:
        with open(os.path.join(ROOT, path)) as f:
            lines = [line.split('#', 1)[0].strip() for line in f]
        lines = [line for line in lines if line]
        return (len(lines) == 2 and
                re.fullmatch(r'regimes:\s*\[\s*launch\s*,\s*cdp-incident\s*,\s*lending-incident\s*\]', lines[0]) is not None and
                re.fullmatch(r'seeds:\s*\[\s*' + str(seed) + r'\s*\]', lines[1]) is not None)
    except OSError:
        return False


def check(qdir):
    fails, blocked = [], []
    try:
        files = sorted(f for f in os.listdir(qdir) if f.endswith(".txt"))
    except OSError as e:
        print(f"BLOCKED cannot list {qdir}: {e}")
        return 2
    if not files:
        print(f"BLOCKED no *.txt in {qdir}")
        return 2
    argsets, jobs = set(), []  # jobs: (file, lineno, job, roster, arm, scen)
    for fn in files:
        found = None
        with open(os.path.join(qdir, fn)) as f:
            for n, raw in enumerate(f, 1):
                m = re.match(r"#\s*args:\s*(.*\S)\s*$", raw)
                if m:
                    found = m.group(1)
                line = raw.split("#", 1)[0].split()
                if not line:
                    continue
                if len(line) != 4:
                    fails.append(f"FAIL {fn}:{n}: want 4 fields, got {len(line)}")
                    continue
                jobs.append((fn, n) + tuple(line))
        if found is None:
            blocked.append(f"BLOCKED {fn}: no '# args:' header line")
        else:
            argsets.add(found)
    if len(argsets) > 1:
        fails.append(f"FAIL the files were made with different arguments: {sorted(argsets)}")
    if blocked or not argsets:
        for line in fails + blocked:
            print(line)
        return 1 if fails else 2
    ap = build_parser()
    try:
        a = ap.parse_args(next(iter(argsets)).split() + ["--out", qdir])
        seeds = parse_seeds(a.seeds)
        fields, arms, lanes = split_list(a.fields, "fields"), split_list(a.arms, "arms"), split_list(a.lanes, "lanes")
    except (ValueError, SystemExit) as e:
        print(f"BLOCKED cannot read the recorded arguments: {e}")
        return 2
    want = {(f, s, arm) for s in seeds for f in fields for arm in arms}
    seen, names, cell_lane, cell_rows = {}, {}, {}, {}
    for fn, n, job, ros, arm, sc in jobs:
        where = f"{fn}:{n}"
        low = job.lower()
        if low in names:
            fails.append(f"FAIL {where}: job {job} also at {names[low]}")
        names[low] = where
        m = re.fullmatch(re.escape(a.stage) + r"-([A-Za-z0-9]+?)(\d+)-(.+)", job)
        if not m:
            fails.append(f"FAIL {where}: job name {job} is not {a.stage}-<field><seed>-<arm>")
            continue
        field, seed = m.group(1), int(m.group(2))
        if m.group(3) != arm:
            fails.append(f"FAIL {where}: job {job} names arm {m.group(3)} but runs {arm}")
        key = (field, seed, arm)
        if key in seen:
            fails.append(f"FAIL {where}: {field} seed {seed} arm {arm} appears twice (also {seen[key]})")
        seen[key] = where
        if key not in want:
            fails.append(f"FAIL {where}: {field} seed {seed} arm {arm} is not asked for by the arguments")
        if ros != roster(field):
            fails.append(f"FAIL {where}: roster {ros}, want {roster(field)}")
        elif not os.path.isfile(os.path.join(ROOT, ros)):
            fails.append(f"FAIL {where}: roster {ros} does not exist")
        if not NAME.match(arm) or not os.path.isdir(os.path.join(ROOT, "example", "agents", arm)):
            fails.append(f"FAIL {where}: no slot dir example/agents/{arm}")
        if sc != scen(seed, field):
            fails.append(f"FAIL {where}: scenarios {sc}, want {scen(seed, field)}")
        elif scen_seeds(sc) != [seed]:
            fails.append(f"FAIL {where}: {sc} does not list exactly seed {seed} (got {scen_seeds(sc)})")
        elif field == 'FS' and not fs_scen_ok(sc, seed):
            fails.append(f"FAIL {where}: {sc} must list exactly FS regimes launch,cdp-incident,lending-incident in order and seed {seed}")
        cell = (seed, field)
        cell_lane.setdefault(cell, set()).add(fn)
        cell_rows.setdefault((cell, fn), []).append(n)
    for key in sorted(want - set(seen)):
        fails.append(f"FAIL missing: {key[0]} seed {key[1]} arm {key[2]}")
    for cell, fns in sorted(cell_lane.items()):
        if len(fns) > 1:
            fails.append(f"FAIL cell seed {cell[0]} field {cell[1]} is split across {sorted(fns)}")
    # The arms of a cell back to back: their job lines are consecutive among the file's job lines.
    for fn in files:
        order = [(n, (int(re.fullmatch(re.escape(a.stage) + r"-([A-Za-z0-9]+?)(\d+)-.+", j).group(2)),
                      re.fullmatch(re.escape(a.stage) + r"-([A-Za-z0-9]+?)(\d+)-.+", j).group(1)))
                 for f2, n, j, *_ in jobs if f2 == fn and re.fullmatch(re.escape(a.stage) + r"-([A-Za-z0-9]+?)(\d+)-.+", j)]
        done, prev = set(), None
        for n, cell in order:
            if cell != prev and cell in done:
                fails.append(f"FAIL {fn}:{n}: the arms of cell seed {cell[0]} field {cell[1]} are not in one block")
            done.add(cell)
            prev = cell
    for line in fails:
        print(line)
    if fails:
        return 1
    print(f"PASS {len(jobs)} jobs in {len(files)} files, {len(cell_lane)} cells, arms {','.join(arms)}")
    return 0


def build_parser():
    ap = argparse.ArgumentParser(description="lane-queue files for the final evaluation")
    ap.add_argument("--stage")
    ap.add_argument("--seeds")
    ap.add_argument("--fields")
    ap.add_argument("--arms")
    ap.add_argument("--lanes")
    ap.add_argument("--order-seed", type=int)
    ap.add_argument("--out")
    ap.add_argument("--check")
    return ap


def main():
    ap = build_parser()
    a = ap.parse_args()
    if a.check:
        return check(a.check)
    missing = [k for k in ("stage", "seeds", "fields", "arms", "lanes", "order_seed", "out") if getattr(a, k) is None]
    if missing:
        print("BLOCKED usage: missing --" + ", --".join(m.replace("_", "-") for m in missing))
        return 2
    try:
        if not NAME.match(a.stage):
            raise ValueError(f"bad stage name {a.stage!r}")
        seeds = parse_seeds(a.seeds)
        fields, arms, lanes = split_list(a.fields, "fields"), split_list(a.arms, "arms"), split_list(a.lanes, "lanes")
    except ValueError as e:
        print(f"BLOCKED {e}")
        return 2
    need = [roster(f) for f in fields] + [scen(s, f) for s in seeds for f in fields]
    gone = [p for p in need if not os.path.isfile(os.path.join(ROOT, p))]
    gone += [f"example/agents/{x}" for x in arms if not os.path.isdir(os.path.join(ROOT, "example", "agents", x))]
    if gone:
        print("BLOCKED missing: " + " ".join(gone))
        return 2
    if 'FS' in fields and any(not fs_scen_ok(scen(s, 'FS'), s) for s in seeds):
        print('BLOCKED FS scenarios must list exactly FS regimes launch,cdp-incident,lending-incident in order and the requested seed')
        return 2
    os.makedirs(a.out, exist_ok=True)
    clash = [f for f in os.listdir(a.out) if f.endswith(".txt")]
    if clash:
        print(f"BLOCKED {a.out} already has queue files ({' '.join(sorted(clash))}): use an empty directory")
        return 2
    lanes_jobs = plan(a.stage, seeds, fields, arms, lanes, a.order_seed)
    head = git_head()
    for lane in lanes:
        path = os.path.join(a.out, f"{a.stage}-{lane}.txt")
        with open(path, "w") as f:
            f.write(f"# {a.stage} lane {lane}: made by ascon/final/make-queues.py at commit {head}\n")
            f.write(f"# order-seed {a.order_seed}: arm order inside a cell = random.Random(order_seed + cell index)\n")
            f.write(f"# args: {args_line(a)}\n")
            prev = None
            for job, ros, arm, sc, cell in lanes_jobs[lane]:
                if cell != prev:
                    f.write(f"# cell seed {cell[0]} field {cell[1]}\n")
                    prev = cell
                f.write(f"{job} {ros} {arm} {sc}\n")
        print(f"wrote {path} ({len(lanes_jobs[lane])} jobs)")
    return check(a.out)


if __name__ == "__main__":
    sys.exit(main())
