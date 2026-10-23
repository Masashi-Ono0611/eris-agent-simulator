#!/bin/bash
# Controls for ascon/final/judge2.py and ascon/final/mc.py.
#   bash ascon/final/test-judge2.sh "$PWD" [REAL_DIR]
# Synthetic part: every clause of the stage-1, stage-2 and re-test rules and every input guard, each with
# a case that must trip it and a case that must not. Matrices are generated with the shape run-matrix.sh
# writes (schema 2, k 12, scenariosPlanned 12, slot replacement: our agent is `slot`, noop is the
# baseline, the reference agents of roster-<field>.yaml); the slot's P in each arm is solved so that its
# official T sits at the intended distance from B's T. A case that must be refused expects exit 2.
# Pinned boundaries include t at n=4 (0.79 / 0.939 FAIL, 0.95 PASS), C1's launch-only noninferiority in both stages,
# the re-test counting F's slot failures and rule flags (REVERT), the arms' simulation setup, rule flags on
# a candidate's slot, B' and open infrastructure failures blocking C1, the exclusion rerun record and scope
# check, the approved +0.20 floor without an ask band, and stage 2 inheriting stage 1's non-plan notes. (Stage 2's
# m' > 0 for R is implied by t >= t_crit, so no control can separate it; see the judge2 docstring.)
# MC part: mc.py reads the noise file's placebo section (and it changes the stage-1 f), fails loudly on a
# malformed one, handles --launch-sd cap/number, runs stage 2 and the re-test through judge2's own
# functions, counts PENDING selections and placebo WARNs, records the code's sha256, and builds a placebo
# section from a stage-1 verdict. judge2's defensive helpers (coverage, flag kinds) are driven directly.
# Real part (REAL_DIR = directory of <label>/{matrix.json,standings.json} copied read-only from the mini):
# `judge2.py validate` must reproduce every standings.json and must catch three corrupted copies; with
# labels Q202..Q606 and A202..A606 present, the identical-code pair ascon-zeta-r3 vs ascon-zeta-r2 is also
# judged as R vs B (a real null: must not PASS; refused without --allow-nonplan-design), and the per-arm
# official score of judge2 must equal each agent scoreRaw in standings.json.
# Calibration part (same REAL_DIR; plan Step 4): 80 stage-1 manifests resampled from the r3/r2 pair
# (4-of-5 seeds x which twin plays R), with +0, +0.5, +1.0 T injected into R, judged through the CLI;
# the null PASS rate must be <= 0.15 and the injected rates within +-0.10 of mc.py's prediction from the
# same matrices; two negative controls must trip.
# Prints ALL_CONTROLS_OK and exits 0 only when every control passed. Exit 1: a control failed.
# Exit 2: a requested input is missing. REAL_DIR checks are optional and explicitly skipped if absent.
set -u
export PYTHONDONTWRITEBYTECODE=1
src="${1:?repo}"
real="${2:-}"
J="$src/ascon/final/judge2.py"
MC="$src/ascon/final/mc.py"
[ -f "$J" ] || { echo "BLOCKED: no $J"; exit 2; }
[ -f "$MC" ] || { echo "BLOCKED: no $MC"; exit 2; }
command -v python3 > /dev/null || { echo "BLOCKED: python3 not found"; exit 2; }
T="$(mktemp -d)" || exit 2
trap 'python3 -c "import shutil, sys; shutil.rmtree(sys.argv[1], ignore_errors=True)" "$T"' EXIT

# Revert only the advisory branch in memory: the same null+reason must block again.
python3 -B -I - "$J" <<'PYRED' || exit 1
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
start = source.index('    reason = None if a is None else a.get("p99_decide_ms_reason")')
end = source.index('    elif not (_num(v) and math.isfinite(v) and v >= 0):', start)
reverted = source[:start] + source[end:].replace('    elif not (', '    if not (', 1)
h = "a" * 64
arm = dict(slot_timeouts=0, p99_decide_ms=None, p99_decide_ms_reason="Runtime does not record decide duration",
           tie_win_rate=0.5, stf=0, matrices_sha256=[h])
for code, expected in [(source, "NOT_MEASURED"), (reverted, "BLOCKED")]:
    ns = {"__name__": "p99_red_check", "__file__": sys.argv[1]}
    exec(compile(code, sys.argv[1], "exec"), ns)
    subs = ns["mechanism_clause"]({"R": arm, "B": arm}, "R", "B", "superiority", {"R": {h}, "B": {h}})
    assert subs["p99_latency"]["status"] == expected, subs
    assert ns["_combine"](subs) == ("PASS" if expected == "NOT_MEASURED" else "BLOCKED"), subs
print("RED_CHECK_OK p99 advisory reverted: null+reason returns BLOCKED")
PYRED

# Exercise the collector-to-clause boundary with real-shaped execution fixtures:
# summary.json + terminal slot decision, with no runtime_end event.
mkdir "$T/execution-evidence" || exit 2
python3 "$src/ascon/final/test-evidence.py" "$src/ascon/final" "$T/execution-evidence" mechanism || exit 1

cat > "$T/synthetic.py" <<'EOF'
import copy, hashlib, json, math, os, random, subprocess, sys
J, T = sys.argv[1], sys.argv[2]
REG = ["calm", "cex-drift", "informed-flow", "whale", "lending-incident", "crash", "depeg", "vuln", "spike",
       "depeg-persist", "cdp-incident", "launch"]
REF = {"FP": ["random", "lp-provider", "lst-carry", "levered-long", "venue-arb", "basis-arb", "peg-arb"],
       "FD": ["venue-arb", "venue-arb-2", "multi-arb", "clean-arb", "cross-venue-arb", "max-profit-arb", "stat-arb", "adaptive-arb"],
       "FS": ["launch-confirm", "launch-sniper", "liquidator", "redemption-arb", "trove-manager", "discovery-arb-verify",
              "max-profit-arb", "venue-arb", "lp-provider", "random"]}
SCALE = {"FP": 2500.0, "FD": 1000.0, "FS": 1500.0}
GOOD_MECH = {"B": {"tie_win_rate": 0.54},
             "R": {"slot_timeouts": 0, "p99_decide_ms": 300, "tie_win_rate": 0.52, "stf": 0},
             "W": {"slot_timeouts": 0, "p99_decide_ms": 300, "tie_win_rate": 0.52, "stf": 0},
             "C1": {"slot_timeouts": 0, "p99_decide_ms": 200, "tie_win_rate": 0.53, "stf": 0, "step2_mechanism": "PASS"}}
STAGE_SEEDS = {"1": [1003, 1004, 1005, 1006], "2": [1011, 1012, 1013, 1014], "retest": [1011, 1012, 1013, 1014, 1021, 1022, 1023, 1024]}
EXITED = "process exited early: exit code 1 at block 140"
FEE = "priority fee rule violation: over the cap, or maxFeePerGas above the tip (rules §2.6 / §8; for the operator to judge)"
UNLOGGED = "12 on-chain tx(s) absent from the agent's submitted log"
DERIVED = "3 on-chain tx(s) sent from 1 address(es) the agent's wallet funded (attributed to the agent; rules §8, for the operator to judge)"
TRANSFER = ("value moved between registered addresses: sent 10.00 USDC to random in 1 ERC-20 transfer(s) -- over the 5.00 USDC "
            "flag threshold (rules §8; for the operator to judge)")
SAVED = {}
RERUN = {}

def sha(p):
    with open(p, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()

def t_of(ps, i):
    mu = sum(ps) / len(ps)
    sd = math.sqrt(sum((p - mu) ** 2 for p in ps) / len(ps))
    return 50 + 10 * (ps[i] - mu) / sd

def solve(ref, target):
    lo, hi = -1e8, 1e8
    for _ in range(70):
        mid = (lo + hi) / 2
        if t_of(ref + [mid], len(ref)) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2

def agents_of(row, aid):
    return [a for a in row["agents"] if a["id"] == aid]

def mutate(mats, kind, arg):
    for m in mats:
        rows = m["scenarios"]
        if kind == "slot_absent":            # the slot renamed: a roster / config error
            for row in rows:
                for a in agents_of(row, "slot"):
                    a["id"] = "opus-1"
        elif kind == "invalid_epoch":        # the whole epoch failed (no summary.json): infrastructure
            for row in rows:
                if row["regime"] == arg:
                    row["agents"] = []
                    row["error"] = "anvil setup failed"
        elif kind == "seed":
            for row in rows:
                row["seed"] = arg
        elif kind == "noop_not_baseline":
            for row in rows:
                for a in agents_of(row, "noop"):
                    del a["baseline"]
        elif kind == "extra_agent":
            for row in rows:
                row["agents"].append({"id": "intruder", "pnlUsdc": 5.0})
        elif kind == "drop_regime":
            m["scenarios"] = [row for row in rows if row["regime"] != arg]
        elif kind == "k13":
            m["k"] = m["scenariosPlanned"] = 13
            extra = copy.deepcopy(rows[0])
            extra.update(s=13, regime="bonus", runDir=extra["runDir"] + "-x")
            rows.append(extra)
        elif kind == "planned":
            m["scenariosPlanned"] = arg
        elif kind == "slot_flag":            # arg (regime or None, flag)
            for row in rows:
                if arg[0] in (None, row["regime"]):
                    for a in agents_of(row, "slot"):
                        a.setdefault("flags", []).append(arg[1])
                    if arg[1].startswith("process exited early"):
                        row["flags"] = ["1 of %d non-baseline agents exited early" % (len(row["agents"]) - 1)]
        elif kind == "slot_unplaced":        # arg regime
            for row in rows:
                if row["regime"] == arg:
                    for a in agents_of(row, "slot"):
                        a.pop("pnlUsdc")
                        a["flags"] = ["absent from summary.json (was not placed)"]
        elif kind == "ref_flag":             # arg (regime or None, agent id, flag)
            for row in rows:
                if arg[0] in (None, row["regime"]):
                    for a in agents_of(row, arg[1]):
                        a.setdefault("flags", []).append(arg[2])
        elif kind == "ref_unplaced":         # arg (regime, agent id, flag or None)
            for row in rows:
                if row["regime"] == arg[0]:
                    for a in agents_of(row, arg[1]):
                        a.pop("pnlUsdc")
                        if arg[2]:
                            a["flags"] = [arg[2]]
        elif kind == "setup":                # arg (key, value or None to delete)
            k, val = arg
            tgt, k = (m["scenarioKey"], "commitment") if k == "scenarioKey.commitment" else (m, k)
            if val is None:
                tgt.pop(k, None)
            else:
                tgt[k] = val
        else:
            raise SystemExit("unknown mutation %s" % kind)

def gen_cells(case, d, stage, arms, skip=()):
    """Writes one matrix per (cell, arm); returns {(seed, field): {arm: path}}."""
    seeds = case.get("seeds", STAGE_SEEDS[stage])
    keys = [(s, f) for s in seeds for f in ("FP", "FD")]
    if stage == "2":
        keys += [(s, "FS") for s in case.get("fs_seeds", [1101, 1102])]
    eff, noise = case.get("eff", {}), case.get("noise", {})
    by_field, by_seed, by_cell = case.get("by_field", {}), case.get("by_seed", {}), case.get("by_cell", {})
    cell_dt, cell_dp = case.get("cell_dt", {}), case.get("cell_dp", {})
    rng = random.Random(case.get("rng", 7))
    out = {}
    for seed, field in keys:
        if (seed, field) in skip:
            continue
        ref = {r: [rng.gauss(0, SCALE[field]) for _ in REF[field]] for r in REG}
        pb = {r: rng.gauss(300, SCALE[field] / 3) for r in REG}
        mats = {}
        for arm in arms:
            if arm in case.get("drop_arms", []):
                continue
            rows = []
            for i, r in enumerate(REG):
                if arm == "B":
                    p = pb[r]
                elif (arm, seed, field, r) in cell_dp:
                    p = pb[r] + cell_dp[(arm, seed, field, r)]
                else:
                    tb = t_of(ref[r] + [pb[r]], len(ref[r]))
                    dt = by_cell.get((arm, seed, field), by_seed.get(arm, {}).get(seed, by_field.get(arm, {}).get(field, eff.get(arm, 0.0))))
                    dt = cell_dt.get((arm, seed, field, r), dt + noise.get(arm, 0.0) * rng.gauss(0, 1))
                    dt += case.get("placebo_seed_offset", {}).get(seed, 0.0) if arm == "B'" else 0.0
                    p = pb[r] if dt == 0 else solve(ref[r], tb + dt)
                ag = [{"id": "noop", "pnlUsdc": 100.0 + i, "baseline": True}]
                ag += [{"id": a, "pnlUsdc": v} for a, v in zip(REF[field], ref[r])]
                ag.append({"id": "slot", "pnlUsdc": p})
                rows.append({"s": i + 1, "regime": r, "seed": seed, "agents": ag,
                             "runDir": "runs/%s-%s-%d-%02d" % (arm.replace("'", "p"), field, seed, i + 1)})
            scope = (["launch"] if arm == "C1" and case.get("launch_only") else
                     ["launch", "cdp-incident", "lending-incident"] if field == "FS" else REG)
            rows = [next(row for row in rows if row["regime"] == r) for r in scope]
            for i, row in enumerate(rows):
                row["s"] = i + 1
            mats[arm] = {"schema": 2, "sourceCommit": "e" * 40, "resetUnit": "scenario", "k": len(rows), "repeat": 1,
                         "scenarioKey": {"source": "public", "commitment": "sha256:" + "5" * 64}, "scenarioStreams": "regime-v1",
                         "scenariosPlanned": len(rows), "scenarios": rows}
        clean = copy.deepcopy(mats)
        for (arm, s, f, kind, arg) in case.get("mutate", []):
            if (s, f) == (seed, field):
                mutate([mats[a] for a in (list(mats) if arm == "*" else [arm]) if a in mats], kind, arg)
        for x in case.get("exclude", []):    # the failed second run of an excluded job: x["_rerun"] = (arm, kind)
            if "_rerun" not in x or (x["seed"], x["field"]) != (seed, field):
                continue
            arm, kind = x["_rerun"]
            rm = copy.deepcopy(clean[arm] if kind == "clean" else mats[arm])
            for row in rm["scenarios"]:
                row["runDir"] += "" if kind == "copy" else "-rerun"
            rp = os.path.join(d, "rerun-%s-%d-%s.json" % (field, seed, arm.replace("'", "p")))
            with open(rp, "w") as fh:
                json.dump(rm, fh)
            if kind == "wrong_setup":
                rm["sourceCommit"] = "f" * 40
                with open(rp, "w") as fh:
                    json.dump(rm, fh)
            if kind == "listed":
                rp = os.path.join(d, "%s-%d-%s.json" % (field, seed, arm.replace("'", "p")))
            RERUN[(seed, field, x.get("regime"))] = {"arm": arm, "path": rp, "sha256": "0" * 64 if kind == "badsha" else None}
        for (arm, s, f, kind, other) in case.get("cross", []):  # needs two arms of one cell
            if (s, f) == (seed, field) and kind == "rundirs_of":
                for row, o in zip(mats[arm]["scenarios"], mats[other]["scenarios"]):
                    row["runDir"] = o["runDir"] if not case.get("alias_runs") else o["runDir"].replace("runs/", "runs/./")
        paths = {}
        for arm, m in mats.items():
            p = os.path.join(d, "%s-%d-%s.json" % (field, seed, arm.replace("'", "p")))
            with open(p, "w") as fh:
                json.dump(m, fh)
            paths[arm] = p
        out[(seed, field)] = paths
    return out

def run(case, d):
    os.makedirs(d, exist_ok=True)
    stage = case.get("stage", "1")
    cands = case.get("cands", {"R": "superiority", "C1": "noninferiority"} if stage == "1" else {"R": "superiority"})
    arms = (["B", "B'"] if stage == "1" else ["B"]) + list(cands) + case.get("extra_arms", [])
    reuse = {k: v for k, v in SAVED[case["reuse_from"]]["cells"].items() if k[1] in ("FP", "FD")} if "reuse_from" in case else {}
    cells = dict(reuse)
    RERUN.clear()
    cells.update(gen_cells(case, d, stage, arms, skip=set(reuse)))
    excl = []
    for x in case.get("exclude", []):
        y = {k: v for k, v in x.items() if k != "_rerun"}
        rr = RERUN.get((x["seed"], x["field"], x.get("regime")))
        if "_rerun" in x and rr is not None:
            y["rerun"] = {"arm": rr["arm"], "path": rr["path"], "sha256": rr["sha256"] or sha(rr["path"])}
        excl.append(y)
    for (s, f), (s2, f2) in case.get("cell_paths_from", {}).items():
        cells[(s, f)] = dict(cells[(s2, f2)])
    if case.get("swap_fields"):
        for s in {s for s, _ in cells}:
            cells[(s, "FP")], cells[(s, "FD")] = cells[(s, "FD")], cells[(s, "FP")]
    for (arm, s, f, other) in case.get("same_file", []):
        cells[(s, f)][arm] = cells[(s, f)][other]
    for (s, f, arm) in case.get("replace_file", []):  # a fresh, different matrix in place of a reused one
        p = os.path.join(d, "replaced-%s-%d-%s.json" % (f, s, arm))
        with open(cells[(s, f)][arm]) as fh:
            m = json.load(fh)
        m["scenarios"][0]["agents"][1]["pnlUsdc"] += 1.0
        with open(p, "w") as fh:
            json.dump(m, fh)
        cells[(s, f)] = dict(cells[(s, f)], **{arm: p})
    listed = [{"seed": s, "field": f, "arms": a} for (s, f), a in sorted(cells.items()) if (s, f) not in case.get("omit_cells", [])]
    man = {"stage": stage, "baseline": "B", "placebo": "B'", "candidates": cands, "cells": listed, "exclude": excl}
    for seed, field, arm in case.get("omit_arms", []):
        cells[(seed, field)].pop(arm)
    for k in ("threshold", "ask_floor", "design", "arm_map"):
        if k in case:
            man[k] = case[k]
    if case.get("arm_map"):
        for cell in listed:
            cell["arm_evidence"] = {a: dict(ARM="PASS", COLLISION="PASS", slot=case["arm_map"][a],
                head="e" * 12, arm_tree="a" * 12) for a in cell["arms"]}
            if case.get("wrong_arm"):
                cell["arm_evidence"]["R"]["slot"] = "opus-1"
    # Lane attestation for legacy exclusion fixtures too.
    for entry in excl:
        if "rerun" in entry:
            arm = entry["rerun"]["arm"]
            proof = dict(ARM="PASS", COLLISION="PASS", slot=arm, head="e" * 12, arm_tree="a" * 12)
            entry["rerun"]["arm_evidence"] = proof
            for cell in listed:
                if (cell["seed"], cell["field"]) == (entry["seed"], entry["field"]):
                    cell.setdefault("arm_evidence", {})[arm] = proof
    mp = os.path.join(d, "manifest.json")
    with open(mp, "w") as fh:
        json.dump(man, fh)
    vp = os.path.join(d, "verdict.json")
    cmd = [sys.executable, "-B", "-I", J, "judge", "--out", vp, "--manifest", mp]
    if case.get("cli"):  # same cells through --cell flags instead of the manifest's cells
        cmd = [sys.executable, "-B", "-I", J, "judge", "--out", vp] + sum((["--candidate", "%s=%s" % x] for x in cands.items()), [])
        for c in listed:
            for arm, p in c["arms"].items():
                cmd += ["--cell", "%s:%d:%s=%s" % (c["field"], c["seed"], arm, p)]
    if case.get("cli_arms"):
        cmd += ["--arms"] + [f"{k}={v}" for k, v in case["arm_map"].items()]
    for flag in ("allow_nonplan_design", "allow_nonplan_threshold"):
        if case.get(flag):
            cmd.append("--" + flag.replace("_", "-"))
    if "stage1_from" in case:
        cmd += ["--stage1-verdict", SAVED[case["stage1_from"]]["verdict"]]
    if "stage2_from" in case:
        cmd += ["--stage2-verdict", SAVED[case["stage2_from"]]["verdict"]]
    if case.get("tamper_prior"):
        idx = cmd.index("--stage2-verdict" if stage == "retest" else "--stage1-verdict") + 1
        prior = json.load(open(cmd[idx]))
        if case["tamper_prior"] == "matrices":
            prior["inputs"].pop("matrices")
        elif case["tamper_prior"] == "map":
            prior["arm_map"] = {"B": "opus-1", "B'": "opus-1-pb", "R": "wrong"}
        elif case["tamper_prior"] == "candidate":
            prior["candidates"]["R"] = []
        else:
            prior["candidates"]["R"]["verdict"] = "FAIL"
        cmd[idx] = os.path.join(d, "tampered-prior.json")
        with open(cmd[idx], "w") as fh:
            json.dump(prior, fh)
    mech = case.get("mech", "good")
    if mech == "missing_file":
        cmd += ["--mechanism", os.path.join(d, "no-such-mechanism.json")]
    elif mech is not None:
        whole = {(x["seed"], x["field"]) for x in case.get("exclude", []) if "regime" not in x}
        mj = {a: copy.deepcopy(GOOD_MECH.get(a, GOOD_MECH["R"])) for a in arms if a != "B'"}
        for arm in mj:
            mj[arm]["matrices_sha256"] = sorted({sha(c["arms"][arm]) for c in listed if arm in c["arms"] and (c["seed"], c["field"]) not in whole})
        for arm in ("R", "W"):
            if arm in mj:
                mj[arm]["tagged_mechanism_pnl"] = {"%s#%s" % (f, seed): {r: case.get("own_pnl", {}).get(arm, {}).get(r, 0.0) for r in REG}
                    for seed, f in cells}
        rep = os.path.join(d, "step2-report.txt")
        with open(rep, "w") as fh:
            fh.write("Step 2 mechanism report (synthetic)\n")
        if "C1" in mj:
            mj["C1"]["step2_report"] = {"path": "step2-report.txt", "sha256": "0" * 64 if case.get("step2_bad_sha") else sha(rep)}
        for arm in case.get("mech_stale", []):
            mj[arm]["matrices_sha256"] = mj[arm]["matrices_sha256"][1:]
        for arm, patch in (case.get("mech_patch") or {}).items():
            for k, v in patch.items():
                if v is None:
                    mj[arm].pop(k, None)
                else:
                    mj[arm][k] = v
        for arm in case.get("p99_null", []):
            mj[arm]["p99_decide_ms"] = None
        mj.update(case.get("mech_whole") or {})
        with open(os.path.join(d, "mech.json"), "w") as fh:
            json.dump({"arms": mj}, fh)
        cmd += ["--mechanism", os.path.join(d, "mech.json")]
    p = subprocess.run(cmd, capture_output=True, text=True)
    with open(os.path.join(d, "table.txt"), "w") as fh:
        fh.write(p.stdout + p.stderr)
    v = None
    if p.returncode == 0:
        with open(vp) as fh:
            v = json.load(fh)
        if "save_as" in case:
            SAVED[case["save_as"]] = {"verdict": vp, "cells": cells}
    return p.returncode, v, p.stdout + p.stderr

X = lambda a, s, f, r: (a, s, f, r)
S1 = [1003, 1004, 1005, 1006]
whale7 = {X("R", s, f, "whale"): (-4.0 if (s, f) != (1006, "FD") else 1.0) for s in S1 for f in ("FP", "FD")}
launch7 = {X("R", s, f, "launch"): v for (a, s, f, r), v in whale7.items()}
whale5 = {}
for i, (s, f) in enumerate([(s, f) for s in S1 for f in ("FP", "FD")]):
    whale5[X("R", s, f, "whale")] = -6.0 if i < 5 else 0.5
big2_fd1006 = {X("R", 1006, "FD", "calm"): -3500.0, X("R", 1006, "FD", "crash"): -3500.0}
big2_p2b = {X("R", 1004, "FD", "calm"): -3500.0, X("R", 1005, "FD", "crash"): -3500.0}
def INF(s, f, r=None, ev="anvil setup failed on the rerun too", rerun=None):
    # rerun: (arm, kind) of the failed second run; kind same / clean / badsha / listed (see gen_cells)
    return dict({"seed": s, "field": f, "reason": "infra", "evidence": ev}, **({"regime": r} if r else {}), **({"_rerun": rerun} if rerun else {}))
def tseeds(m, t, seeds=S1):
    # per-seed R effects (both fields) with mean m and t = m / (sd / 2) exactly, sd > the 0.25 floor
    u = [-1.5, -0.5, 0.5, 1.5]
    k = (2.0 * m / t) / math.sqrt(sum(x * x for x in u) / 3)
    return {s: m + k * x for s, x in zip(seeds, u)}
base = {"eff": {"R": 1.25, "C1": 0.3}, "noise": {"R": 0.05, "C1": 0.05, "B'": 0.05}}
def C(**kw):
    c = copy.deepcopy(base)
    c.update(kw)
    return c
def E(R=None, C1=None, dec=None, **extra):
    v = {}
    if R: v["R"] = R
    if C1: v["C1"] = C1
    return dict(extra, v=v, dec=dec)
def X2(frag):
    return {"exit": 2, "stderr": frag}
S2 = dict(stage="2", stage1_from="v1", eff={"R": 1.25}, noise={"R": 0.05})
S2C1 = dict(S2, cands={"C1": "noninferiority"})
RT = dict(stage="retest", stage2_from="v2", reuse_from="v2", eff={"R": 1.25}, noise={"R": 0.05})
RT_S = (1021, 1022, 1023, 1024)
B_SPIKE = ("B", 1006, "FD", "ref_unplaced", ("spike", "stat-arb", None))
cases = [
    # ---- stage 1: the rule's clauses
    ("identical arms", {"eff": {}, "noise": {}}, E("FAIL", "PASS", "F=C1", R_m=0.0, R_f=0.25)),
    ("+1.0 effect, low noise, U4 threshold 0.2", C(eff={"R": 1.0, "C1": 0.3}, threshold=0.2), E("PASS", "PASS", "F=R, F2=C1")),
    ("+1.25 effect, default threshold (saved as v1)", C(save_as="v1"), E("PASS", "PASS", "F=R, F2=C1", placebo="OK")),
    ("+1.25 effect, cells given as --cell flags", C(cli=True), E("PASS", "PASS", "F=R, F2=C1")),
    ("+0.6 effect: approved floor, no ask (saved as v1ask)", C(eff={"R": 0.6, "C1": 0.3}, save_as="v1ask"), E("PASS", "PASS", "F=R, F2=C1", sel_ask=None)),
    ("+0.6 effect, C1 BLOCKED: PENDING names C1", C(eff={"R": 0.6, "C1": 0.3}, mech_patch={"C1": {"step2_mechanism": None}}),
     E("PASS", "BLOCKED", "PENDING", sel_ask=None, note_has=["C1"])),
    ("TRIP n=4, m +1.2, t 0.79 < 0.94", {"by_seed": {"R": tseeds(1.2, 0.79)}, "eff": {"C1": 0.3}, "noise": {"B'": 0.05}},
     E("FAIL", "PASS", "F=C1", R_n=4, R_t=0.79, clause=("R", "1_mean_t", "FAIL"))),
    ("NOT-TRIP n=4, m +1.2, t 0.95 >= 0.94", {"by_seed": {"R": tseeds(1.2, 0.95)}, "eff": {"C1": 0.3}, "noise": {"B'": 0.05}},
     E("PASS", "PASS", "F=R, F2=C1", R_n=4, R_t=0.95, clause=("R", "1_mean_t", "PASS"))),
    ("TRIP n=4, t 0.939 just below the pinned 0.94", {"by_seed": {"R": tseeds(1.2, 0.939)}, "eff": {"C1": 0.3}, "noise": {"B'": 0.05}},
     E("FAIL", "PASS", "F=C1", R_n=4, R_t=0.939, clause=("R", "1_mean_t", "FAIL"))),
    ("whale -4 in 7/8 cells: regime veto", C(eff={"R": 1.5, "C1": 0.3}, cell_dt=whale7, own_pnl={"R": {"whale": -1}}), E("FAIL", "PASS", "F=C1", clause=("R", "3_regime_veto", "FAIL"))),
    ("launch -4 in 7/8 cells: launch FAIL", C(eff={"R": 1.5, "C1": 0.3}, cell_dt=launch7), E("FAIL", "PASS", "F=C1", clause=("R", "6_launch", "FAIL"))),
    ("whale mean -3.6 but 5/8 negative: share not met", C(eff={"R": 1.5, "C1": 0.3}, cell_dt=whale5), E("PASS", "PASS", "F=R, F2=C1", clause=("R", "3_regime_veto", "PASS"))),
    ("2 non-launch epochs dP -3500", C(eff={"R": 1.5, "C1": 0.3}, cell_dp={X("R", 1003, "FP", "calm"): -3500.0, X("R", 1004, "FP", "crash"): -3500.0}), E("FAIL", "PASS", "F=C1", clause=("R", "4_big_losses", "FAIL"))),
    ("1 non-launch epoch dP -3500", C(eff={"R": 1.5, "C1": 0.3}, cell_dp={X("R", 1003, "FP", "calm"): -3500.0}), E("PASS", "PASS", "F=R, F2=C1", clause=("R", "4_big_losses", "PASS"))),
    ("2 launch epochs dP -3500: launch exempt", C(eff={"R": 1.5, "C1": 0.3}, cell_dp={X("R", 1003, "FP", "launch"): -3500.0, X("R", 1004, "FP", "launch"): -3500.0}), E("PASS", "PASS", "F=R, F2=C1", clause=("R", "4_big_losses", "PASS"))),
    ("FP mean -0.4 (FD +2.5)", C(by_field={"R": {"FP": -0.4, "FD": 2.5}}), E("FAIL", "PASS", "F=C1", clause=("R", "2_field_means", "FAIL"))),
    ("FP mean -0.2 (FD +2.5)", C(by_field={"R": {"FP": -0.2, "FD": 2.5}}), E("PASS", "PASS", "F=R, F2=C1", clause=("R", "2_field_means", "PASS"))),
    ("FD mean -0.6 (FP +3.0)", C(by_field={"R": {"FP": 3.0, "FD": -0.6}}), E("FAIL", "PASS", "F=C1", clause=("R", "2_field_means", "FAIL"))),
    ("noisy placebo raises f", C(placebo_seed_offset={1003: 3.0, 1004: -3.0, 1005: 3.0, 1006: -3.0}), E("FAIL", "PASS", "F=C1", clause=("R", "1_mean_t", "FAIL"), R_f_gt=3.0)),
    ("no mechanism JSON", C(mech=None), E("BLOCKED", "BLOCKED", "PENDING", clause=("R", "5_mechanism", "BLOCKED"))),
    ("mechanism JSON path missing", C(mech="missing_file"), E("BLOCKED", "BLOCKED", "PENDING")),
    ("R p99 null with reason: advisory", C(p99_null=["R"], mech_patch={"R": {"p99_decide_ms_reason": "Runtime does not record decide duration"}}),
     E("PASS", "PASS", "F=R, F2=C1", clause=("R", "5_mechanism", "PASS"), sub=("R", "p99_latency", "NOT_MEASURED"), text_has="NOT_MEASURED")),
    ("R p99 null without reason", C(p99_null=["R"]), E("BLOCKED", "PASS", "PENDING", sub=("R", "p99_latency", "BLOCKED"))),
    ("R p99 null blank reason", C(p99_null=["R"], mech_patch={"R": {"p99_decide_ms_reason": "  "}}), E("BLOCKED", "PASS", "PENDING", sub=("R", "p99_latency", "BLOCKED"))),
    ("R p99 null malformed reason", C(p99_null=["R"], mech_patch={"R": {"p99_decide_ms_reason": 1}}), E("BLOCKED", "PASS", "PENDING", sub=("R", "p99_latency", "BLOCKED"))),
    ("R p99 missing even with reason", C(mech_patch={"R": {"p99_decide_ms": None, "p99_decide_ms_reason": "unmeasured"}}), E("BLOCKED", "PASS", "PENDING", sub=("R", "p99_latency", "BLOCKED"))),
    ("R p99 malformed even with reason", C(mech_patch={"R": {"p99_decide_ms": "499", "p99_decide_ms_reason": "unmeasured"}}), E("BLOCKED", "PASS", "PENDING", sub=("R", "p99_latency", "BLOCKED"))),
    ("R p99 499 ms", C(mech_patch={"R": {"p99_decide_ms": 499}}), E("PASS", "PASS", "F=R, F2=C1", sub=("R", "p99_latency", "PASS"))),
    ("R p99 500 ms", C(mech_patch={"R": {"p99_decide_ms": 500}}), E("FAIL", "PASS", "F=C1", sub=("R", "p99_latency", "FAIL"))),
    ("R p99 missing", C(mech_patch={"R": {"p99_decide_ms": None}}), E("BLOCKED", "PASS", "PENDING", sub=("R", "p99_latency", "BLOCKED"))),
    ("TRIP mechanism arms.R is a string, not an object", C(mech_whole={"R": "PASS"}), E("BLOCKED", "PASS", "PENDING", sub=("R", "slot_timeouts", "BLOCKED"))),
    ("R p99 600 ms", C(mech_patch={"R": {"p99_decide_ms": 600}}), E("FAIL", "PASS", "F=C1", sub=("R", "p99_latency", "FAIL"))),
    ("R one slot timeout", C(mech_patch={"R": {"slot_timeouts": 1}}), E("FAIL", "PASS", "F=C1", sub=("R", "slot_timeouts", "FAIL"))),
    ("R STF 3", C(mech_patch={"R": {"stf": 3}}), E("FAIL", "PASS", "F=C1", sub=("R", "stf", "FAIL"))),
    ("R tie-win 14 pt below B", C(mech_patch={"R": {"tie_win_rate": 0.40}}), E("FAIL", "PASS", "F=C1", sub=("R", "tie_win_rate", "FAIL"))),
    ("R tie-win 9 pt below B", C(mech_patch={"R": {"tie_win_rate": 0.45}}), E("PASS", "PASS", "F=R, F2=C1", sub=("R", "tie_win_rate", "PASS"))),
    ("B tie-win missing", C(mech_patch={"B": {"tie_win_rate": None}}), E("BLOCKED", "BLOCKED", "PENDING", sub=("R", "tie_win_rate", "BLOCKED"))),
    ("C1 without the Step 2 verdict", C(mech_patch={"C1": {"step2_mechanism": None}}), E("PASS", "BLOCKED", "PENDING", sub=("C1", "step2_mechanism", "BLOCKED"))),
    ("C1 Step 2 FAIL", C(mech_patch={"C1": {"step2_mechanism": "FAIL"}}), E("PASS", "FAIL", "F=R")),
    ("both null / C1 -0.3 still launch noninferior", {"eff": {"R": 0.0, "C1": -0.3}, "noise": {"R": 0.3, "C1": 0.05, "B'": 0.05}}, E("FAIL", "PASS", "F=C1")),
    ("C1 launch -0.05: no EW positivity gate", C(eff={"R": 1.25, "C1": -0.05}, noise={"R": 0.05, "B'": 0.05}), E("PASS", "PASS", "F=R, F2=C1", clause=("C1", "6_launch", "PASS"))),
    ("3 seeds, t 1.73 < t(2) 1.886 (non-plan design allowed)", {"seeds": [1003, 1004, 1005], "design": {"seeds": [1003, 1004, 1005]}, "allow_nonplan_design": True,
     "by_seed": {"R": {1003: -0.2, 1004: 2.5, 1005: 3.7}}, "eff": {"C1": 0.3}, "noise": {"B'": 0.05}}, E("FAIL", "PASS", "F=C1", R_n=3, clause=("R", "1_mean_t", "FAIL"), nonplan="seeds")),
    ("3 seeds, t 1.92 >= t(2) 1.886 (non-plan design allowed)", {"seeds": [1003, 1004, 1005], "design": {"seeds": [1003, 1004, 1005]}, "allow_nonplan_design": True,
     "by_seed": {"R": {1003: 0.0, 1004: 2.5, 1005: 3.5}}, "eff": {"C1": 0.3}, "noise": {"B'": 0.05}}, E("PASS", "PASS", "F=R, F2=C1", R_n=3)),
    # ---- design completeness (cells, seeds, regimes, file reuse, field labels)
    ("TRIP 3-seed design without --allow-nonplan-design", {"seeds": [1003, 1004, 1005], "design": {"seeds": [1003, 1004, 1005]}, "eff": {"C1": 0.3}}, X2("not the plan's")),
    ("NOT-TRIP late-R seed set 1007-1010 is a plan design", C(seeds=[1007, 1008, 1009, 1010], design={"seeds": [1007, 1008, 1009, 1010]}), E("PASS", "PASS", "F=R, F2=C1")),
    ("NOT-TRIP R loses 2x3500 in FD#1006, cell listed", C(eff={"R": 1.5, "C1": 0.3}, cell_dp=big2_fd1006), E("FAIL", "PASS", "F=C1", clause=("R", "4_big_losses", "FAIL"))),
    ("TRIP same data, FD#1006 left out of the manifest", C(eff={"R": 1.5, "C1": 0.3}, cell_dp=big2_fd1006, omit_cells=[(1006, "FD")]), X2("not listed")),
    ("TRIP stage-2 seed 1011 cells in the stage-1 manifest", C(seeds=[1003, 1004, 1005, 1006, 1011]), X2("outside the design")),
    ("TRIP every arm of FD#1003 lacks spike (planned 12)", C(mutate=[("*", 1003, "FD", "drop_regime", "spike")]), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "partial matrix"))),
    ("TRIP every arm of FD#1003 lacks spike, planned 11", C(mutate=[("*", 1003, "FD", "drop_regime", "spike"), ("*", 1003, "FD", "planned", 11)]), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "scenariosPlanned"))),
    ("TRIP every arm lacks whale where R loses 2x3500", C(eff={"R": 1.5, "C1": 0.3}, cell_dp={X("R", 1003, "FD", "whale"): -3500.0, X("R", 1004, "FD", "crash"): -3500.0},
     mutate=[("*", 1003, "FD", "drop_regime", "whale")]), E("BLOCKED", "BLOCKED", "PENDING")),
    ("TRIP every arm of FD#1003 carries a 13th regime (k 13)", C(mutate=[("*", 1003, "FD", "k13", None)]), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "k = 13"))),
    ("TRIP FP and FD labels swapped (FP -0.4 / FD +2.5 data)", C(by_field={"R": {"FP": -0.4, "FD": 2.5}}, swap_fields=True), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "roster differs from the field"))),
    ("TRIP FD#1004 points at the FP#1004 files", C(cell_paths_from={(1004, "FD"): (1004, "FP")}), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "same matrix file"))),
    # ---- simulation setup of the arms of a cell
    ("TRIP R FD#1003 sourceCommit differs from B's", C(mutate=[("R", 1003, "FD", "setup", ("sourceCommit", "deadbeef" * 5))]), E("BLOCKED", "PASS", "PENDING", problem=("R", "sourceCommit"))),
    ("TRIP R FD#1003 scenarioKey commitment and streams differ", C(mutate=[("R", 1003, "FD", "setup", ("scenarioKey.commitment", "sha256:" + "d" * 64)),
     ("R", 1003, "FD", "setup", ("scenarioStreams", "legacy")), ("R", 1003, "FD", "setup", ("repeat", 3))]), E("BLOCKED", "PASS", "PENDING", problem=("R", "scenarioStreams"))),
    ("TRIP B' FP#1004 resetUnit differs (blocks C1 too)", C(mutate=[("B'", 1004, "FP", "setup", ("resetUnit", "epoch"))]), E("BLOCKED", "BLOCKED", "PENDING", problem=("C1", "resetUnit"))),
    ("TRIP every arm of FD#1003 lacks sourceCommit", C(mutate=[("*", 1003, "FD", "setup", ("sourceCommit", None))]), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "setup field(s) missing"))),
    # ---- rosters, ids, runDirs, seeds
    ("slot renamed in R FD#1004", C(mutate=[("R", 1004, "FD", "slot_absent", None)]), E("BLOCKED", "PASS", "PENDING", problem=("R", "slot agent"))),
    ("R FD#1006 scenarios carry seed 1007", C(mutate=[("R", 1006, "FD", "seed", 1007)]), E("BLOCKED", "PASS", "PENDING", problem=("R", "seed 1007"))),
    ("R and C1 share one matrix file", C(same_file=[("R", 1003, "FP", "C1")]), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "same matrix file"))),
    ("R FD#1003 reuses B's runDirs", C(cross=[("R", 1003, "FD", "rundirs_of", "B")]), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "runDir"))),
    ("TRIP B' FP#1004 noop not baseline (blocks C1 too)", C(mutate=[("B'", 1004, "FP", "noop_not_baseline", None)]), E("BLOCKED", "BLOCKED", "PENDING", problem=("C1", "noop is not marked baseline"))),
    ("C1 FP#1003 has an extra agent", C(mutate=[("C1", 1003, "FP", "extra_agent", None)]), E("PASS", "BLOCKED", "PENDING", problem=("C1", "roster differs"))),
    ("TRIP R FD#1003 lacks spike (partial matrix; blocks C1 too)", C(mutate=[("R", 1003, "FD", "drop_regime", "spike")]), E("BLOCKED", "BLOCKED", "PENDING", problem=("C1", "partial matrix"))),
    ("TRIP no placebo arm (blocks C1 too)", C(drop_arms=["B'"]), E("BLOCKED", "BLOCKED", "PENDING", problem=("C1", "no matrix for arm B'"))),
    ("TRIP C1-only fallback, B' FD#1004 calm max-profit-arb exited", C(cands={"C1": "noninferiority"}, mutate=[("B'", 1004, "FD", "ref_flag", ("calm", "max-profit-arb", "process exited early: OOM"))]),
     E(None, "BLOCKED", "PENDING", problem=("C1", "max-profit-arb"))),
    ("NOT-TRIP C1-only fallback, clean", C(cands={"C1": "noninferiority"}), E(None, "PASS", "F=C1")),
    # ---- infrastructure failures and exclusions
    ("TRIP R FP#1005 calm failed, not excluded (blocks C1 too)", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")]), E("BLOCKED", "BLOCKED", "PENDING", problem=("C1", "left out by the official rule"))),
    ("NOT-TRIP R FP#1005 calm failed, excluded (infra, rerun failed)", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")], exclude=[INF(1005, "FP", "calm", rerun=("R", "same"))]),
     E("PASS", "PASS", "F=R, F2=C1", regimes_in=(1005, "FP", 11), excl="accepted")),
    ("TRIP same, no rerun record", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")], exclude=[INF(1005, "FP", "calm")]), E("BLOCKED", "BLOCKED", "PENDING", glob="no rerun record")),
    ("TRIP same, rerun sha256 wrong", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")], exclude=[INF(1005, "FP", "calm", rerun=("R", "badsha"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="has sha256")),
    ("TRIP same, the rerun is the listed matrix", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")], exclude=[INF(1005, "FP", "calm", rerun=("R", "listed"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="one of the listed")),
    ("TRIP same, the rerun ran clean", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")], exclude=[INF(1005, "FP", "calm", rerun=("R", "clean"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="shows no infrastructure failure")),
    ("TRIP same, the rerun is of B (whose run was clean)", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")], exclude=[INF(1005, "FP", "calm", rerun=("B", "same"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="whose listed matrix has no")),
    ("NOT-TRIP FD#1006 excluded whole: max-profit-arb exited in B", C(mutate=[("B", 1006, "FD", "ref_flag", (None, "max-profit-arb", "process exited early: OOM"))], exclude=[INF(1006, "FD", rerun=("B", "same"))]),
     E("PASS", "PASS", "F=R, F2=C1", R_n=3, excl="accepted")),
    ("TRIP FD#1006 excluded whole with no failure (R loses 2x3500 there)", C(eff={"R": 1.5, "C1": 0.3}, cell_dp=big2_fd1006, exclude=[INF(1006, "FD", rerun=("B", "same"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="no infrastructure failure")),
    ("NOT-TRIP R loses 2x3500 (FD#1004 calm, FD#1005 crash), nothing excluded", C(eff={"R": 1.5, "C1": 0.3}, cell_dp=big2_p2b), E("FAIL", "PASS", "F=C1", clause=("R", "4_big_losses", "FAIL"))),
    ("TRIP same data, clean FD#1004 calm excluded", C(eff={"R": 1.5, "C1": 0.3}, cell_dp=big2_p2b, exclude=[INF(1004, "FD", "calm", rerun=("B", "same"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="no infrastructure failure")),
    ("TRIP whole FD#1006 excluded on B's spike-only failure; R loses 2x3500 in calm/crash", C(eff={"R": 1.5, "C1": 0.3}, cell_dp=big2_fd1006, mutate=[B_SPIKE], exclude=[INF(1006, "FD", rerun=("B", "same"))]),
     E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "exclusion scope"), scope="DIFFERS")),
    ("NOT-TRIP same data, only FD#1006 spike excluded", C(eff={"R": 1.5, "C1": 0.3}, cell_dp=big2_fd1006, mutate=[B_SPIKE], exclude=[INF(1006, "FD", "spike", rerun=("B", "same"))]),
     E("FAIL", "PASS", "F=C1", clause=("R", "4_big_losses", "FAIL"), excl="accepted")),
    ("NOT-TRIP whole FD#1006 excluded on B's spike-only failure, R benign there", C(mutate=[B_SPIKE], exclude=[INF(1006, "FD", rerun=("B", "same"))]),
     E("PASS", "PASS", "F=R, F2=C1", R_n=3, excl="accepted", scope="SAME")),
    ("TRIP exclude entry without reason infra", C(exclude=[{"seed": 1005, "field": "FP", "regime": "calm", "reason": "flaky", "evidence": "x"}]), X2("reason must be")),
    ("TRIP exclude entry without evidence", C(exclude=[{"seed": 1005, "field": "FP", "regime": "calm", "reason": "infra"}]), X2("evidence")),
    ("TRIP exclude entry regime typo 'Calm'", C(exclude=[INF(1003, "FD", "Calm")]), X2("not in the design")),
    ("TRIP exclude entry for a cell outside the manifest", C(exclude=[INF(1011, "FD")]), X2("matches no listed cell")),
    ("TRIP exclude entry with a malformed rerun", C(exclude=[dict(INF(1005, "FP", "calm"), rerun={"arm": "B", "path": "x.json"})]), X2("rerun must be")),
    # ---- candidate-side failures (clause 5) and reference-agent failures (infrastructure)
    ("TRIP R slot 'process exited early' in all of FD#1003", C(mutate=[("R", 1003, "FD", "slot_flag", (None, EXITED))]), E("FAIL", "PASS", "F=C1", sub=("R", "slot_failures", "FAIL"))),
    ("NOT-TRIP R slot with a V_0 information flag", C(mutate=[("R", 1003, "FD", "slot_flag", (None, "V_0 measured at the first boundary was 97 USDC below the endowment"))]),
     E("PASS", "PASS", "F=R, F2=C1", sub=("R", "slot_rule_flags", "PASS"), text_has="[info]")),
    ("TRIP R slot not placed in FD#1004 calm", C(mutate=[("R", 1004, "FD", "slot_unplaced", "calm")]), E("FAIL", "PASS", "F=C1", sub=("R", "slot_failures", "FAIL"))),
    ("TRIP same, FD#1004 calm excluded", C(mutate=[("R", 1004, "FD", "slot_unplaced", "calm")], exclude=[INF(1004, "FD", "calm", rerun=("R", "same"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="candidate's slot")),
    ("TRIP R slot and stat-arb exited in R FD#1004 calm only, excluded", C(mutate=[("R", 1004, "FD", "slot_flag", ("calm", EXITED)), ("R", 1004, "FD", "ref_flag", ("calm", "stat-arb", "process exited early: OOM"))],
     exclude=[INF(1004, "FD", "calm", rerun=("R", "same"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="only in a candidate's own run")),
    ("NOT-TRIP R slot exited and B's stat-arb exited in FD#1004 calm, excluded", C(mutate=[("R", 1004, "FD", "slot_flag", ("calm", EXITED)), ("B", 1004, "FD", "ref_flag", ("calm", "stat-arb", "process exited early: OOM"))],
     exclude=[INF(1004, "FD", "calm", rerun=("B", "same"))]), E("PASS", "PASS", "F=R, F2=C1", excl="accepted")),
    ("TRIP B's own slot exited early in FP#1003 calm", C(mutate=[("B", 1003, "FP", "slot_flag", ("calm", EXITED))]), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "own slot failed"))),
    ("TRIP max-profit-arb exited early only in R FD#1003 (blocks C1 too)", C(mutate=[("R", 1003, "FD", "ref_flag", (None, "max-profit-arb", "process exited early: OOM"))]), E("BLOCKED", "BLOCKED", "PENDING", problem=("C1", "infrastructure"))),
    ("NOT-TRIP random has a V_0 flag only in R FP#1003", C(mutate=[("R", 1003, "FP", "ref_flag", (None, "random", "V_0 measured at the first boundary was 81 USDC below the endowment"))]), E("PASS", "PASS", "F=R, F2=C1")),
    ("TRIP stat-arb 'absent from summary.json' in R FD#1003 calm", C(mutate=[("R", 1003, "FD", "ref_unplaced", ("calm", "stat-arb", "absent from summary.json (was not placed)"))]), E("BLOCKED", "BLOCKED", "PENDING", problem=("C1", "stat-arb"))),
    ("TRIP venue-arb lost its P (no flag) in R FD#1003 calm", C(mutate=[("R", 1003, "FD", "ref_unplaced", ("calm", "venue-arb", None))]), E("BLOCKED", "BLOCKED", "PENDING", problem=("R", "venue-arb"))),
    # ---- rule and log-integrity flags on a candidate's slot
    ("TRIP R slot priority-fee rule violation in every epoch", C(mutate=[("R", s, f, "slot_flag", (None, FEE)) for s in S1 for f in ("FP", "FD")]),
     E("FAIL", "PASS", "F=C1", sub=("R", "slot_rule_flags", "FAIL"), text_has="slot flag R    [rule]")),
    ("TRIP R slot unlogged on-chain txs in FD#1005 crash", C(mutate=[("R", 1005, "FD", "slot_flag", ("crash", UNLOGGED))]), E("FAIL", "PASS", "F=C1", sub=("R", "slot_rule_flags", "FAIL"))),
    ("TRIP R slot derived senders in FP#1003 calm", C(mutate=[("R", 1003, "FP", "slot_flag", ("calm", DERIVED))]), E("FAIL", "PASS", "F=C1", sub=("R", "slot_rule_flags", "FAIL"))),
    ("TRIP R slot roster transfer in FP#1006 whale", C(mutate=[("R", 1006, "FP", "slot_flag", ("whale", TRANSFER))]), E("FAIL", "PASS", "F=C1", sub=("R", "slot_rule_flags", "FAIL"))),
    ("TRIP R slot flag judge2 does not know", C(mutate=[("R", 1004, "FP", "slot_flag", ("calm", "a flag no version of judge2 has seen"))]), E("BLOCKED", "PASS", "PENDING", sub=("R", "slot_rule_flags", "BLOCKED"))),
    ("TRIP R fee flag in an excluded epoch still counts", C(mutate=[("R", 1004, "FD", "slot_flag", ("calm", FEE)), ("B", 1004, "FD", "ref_flag", ("calm", "stat-arb", "process exited early: OOM"))],
     exclude=[INF(1004, "FD", "calm", rerun=("B", "same"))]), E("FAIL", "PASS", "F=C1", sub=("R", "slot_rule_flags", "FAIL"), excl="accepted")),
    ("NOT-TRIP B's own slot fee flag is printed, not judged", C(mutate=[("B", 1003, "FP", "slot_flag", ("calm", FEE))]), E("PASS", "PASS", "F=R, F2=C1", text_has="slot flag B    [rule]")),
    # ---- thresholds
    ("TRIP manifest threshold 0.02 (+0.3 effect)", C(eff={"R": 0.3, "C1": 0.3}, threshold=0.02), X2("not the plan's")),
    ("TRIP manifest threshold 0.5 (+0.6 effect)", C(eff={"R": 0.6, "C1": 0.3}, threshold=0.5), X2("not the plan's")),
    ("TRIP manifest threshold -5", C(threshold=-5.0), X2("not the plan's")),
    ("TRIP manifest ask_floor 0.5", C(ask_floor=0.5), X2("no ask band")),
    ("NOT-TRIP threshold 0.5 with --allow-nonplan-threshold (saved as v1np)", C(eff={"R": 0.6, "C1": 0.3}, threshold=0.5, allow_nonplan_threshold=True, save_as="v1np"), E("PASS", "PASS", "F=R, F2=C1", nonplan="threshold")),
    # ---- placebo check (report only, plan Step 6)
    ("WARN shared offset: B' and R both +1.25 (report only, R passes)", C(eff={"R": 1.25, "C1": 0.3, "B'": 1.25}), E("PASS", "PASS", "F=R, F2=C1", placebo="WARN", text_has="check WARN")),
    ("NOT-WARN B' offset -1.25 (one-sided)", C(eff={"R": 1.25, "C1": 0.3, "B'": -1.25}), E("PASS", "PASS", "F=R, F2=C1", placebo="OK")),
    # ---- mechanism provenance
    ("TRIP R mechanism computed without one judged matrix", C(mech_stale=["R"]), E("BLOCKED", "PASS", "PENDING", sub=("R", "provenance", "BLOCKED"))),
    ("TRIP B mechanism stale", C(mech_stale=["B"]), E("BLOCKED", "BLOCKED", "PENDING", sub=("C1", "provenance", "BLOCKED"))),
    ("TRIP C1 Step 2 report sha256 mismatch", C(step2_bad_sha=True), E("PASS", "BLOCKED", "PENDING", sub=("C1", "step2_mechanism", "BLOCKED"))),
    # ---- stage 2 (plan Step 7): f from the stage-1 verdict, m > 0, F_S
    ("stage 2: R +1.25 (saved as v2)", dict(S2, save_as="v2"), {"v": {"R": "PASS"}, "dec_has": "passes stage 2", "clause": ("R", "6_fs_field", "PASS")}),
    ("stage 2: R no effect", dict(S2, eff={"R": 0.0}), {"v": {"R": "FAIL"}, "clause": ("R", "1_mean_t", "FAIL")}),
    ("TRIP stage 2: FS mean -0.6", dict(S2, by_field={"R": {"FS": -0.6}}), {"v": {"R": "FAIL"}, "clause": ("R", "6_fs_field", "FAIL")}),
    ("NOT-TRIP stage 2: FS mean -0.4", dict(S2, by_field={"R": {"FS": -0.4}}), {"v": {"R": "PASS"}, "clause": ("R", "6_fs_field", "PASS")}),
    ("TRIP stage 2: one non-launch FS epoch dP -3500", dict(S2, cell_dp={X("R", 1101, "FS", "lending-incident"): -3500.0}), {"v": {"R": "FAIL"}, "clause": ("R", "6_fs_field", "FAIL")}),
    ("stage 1 with B' spread +-1 and R +3.0 (saved as v1wide)", C(eff={"R": 3.0, "C1": 0.3}, placebo_seed_offset={1003: 1.0, 1004: -1.0, 1005: 1.0, 1006: -1.0}, save_as="v1wide"), E("PASS", "PASS", "F=R, F2=C1", R_f_gt=1.0)),
    # +0.4 straddles t=0.94 with narrow/wide inherited f; +0.6 passes both now.
    ("NOT-TRIP stage 2 R +0.4 judged with v1's f 0.25", dict(S2, eff={"R": 0.4}), {"v": {"R": "PASS"}, "R_f": 0.25}),
    ("TRIP same stage-2 data judged with v1wide's f", dict(S2, eff={"R": 0.4}, stage1_from="v1wide"), {"v": {"R": "FAIL"}, "R_f_gt": 1.0, "clause": ("R", "1_mean_t", "FAIL")}),
    ("stage 1 with R FAIL (saved as v1c1: F=C1)", {"eff": {"C1": 0.3}, "noise": {"B'": 0.05}, "save_as": "v1c1"}, E("FAIL", "PASS", "F=C1")),
    ("TRIP stage 2 of R when stage 1 selected only C1", dict(S2, stage1_from="v1c1"), X2("does not select R")),
    ("TRIP stage 2 without --stage1-verdict", {k: v for k, v in S2.items() if k != "stage1_from"}, X2("needs --stage1-verdict")),
    ("TRIP stage 2 manifest with a B' arm", dict(S2, extra_arms=["B'"]), X2("does not judge")),
    ("TRIP stage 2 manifest with a threshold", dict(S2, threshold=0.2), X2("no threshold")),
    ("stage 2 F2=C1 shares F seeds 1011-1014", dict(S2, cands={"C1": "noninferiority"}, eff={"C1": 0.3}, noise={"C1": 0.05}, design={"seeds": [1011, 1012, 1013, 1014]}), {"v": {"C1": "PASS"}}),
    ("NOT-TRIP stage 2 of F2=C1 on 1011-1014 (saved as v2c1)", dict(S2C1, eff={"C1": 0.3}, noise={"C1": 0.05}, save_as="v2c1"), {"v": {"C1": "PASS"}}),
    ("stage 2 C1 launch -0.05 passes", dict(S2C1, eff={"C1": -0.05}, noise={}), {"v": {"C1": "PASS"}, "clause": ("C1", "6_launch", "PASS")}),
    ("NOT-TRIP stage 2 F2=C1 m +0.05", dict(S2C1, eff={"C1": 0.05}, noise={}), {"v": {"C1": "PASS"}, "clause": ("C1", "6_launch", "PASS")}),
    ("stage 2 of +0.6 R has no ask", dict(S2, stage1_from="v1ask"), {"v": {"R": "PASS"}, "dec_has": "passes stage 2", "sel_ask": None}),
    ("stage 2 F2=C1 after +0.6 R", dict(S2C1, stage1_from="v1ask", eff={"C1": 0.3}, noise={"C1": 0.05}), {"v": {"C1": "PASS"}}),
    ("TRIP stage 2 from a non-plan-threshold stage 1 without the flag", dict(S2, stage1_from="v1np"), X2("non-plan threshold")),
    ("NOT-TRIP same with --allow-nonplan-threshold (inherited, recorded)", dict(S2, stage1_from="v1np", allow_nonplan_threshold=True), {"v": {"R": "PASS"}, "nonplan": "stage 1: threshold"}),
    # ---- re-test (plan Step 9)
    ("re-test: 1021-1024 R +1.25", dict(RT), {"v": {"R": "KEEP"}, "dec_has": "KEEP"}),
    ("re-test FD -0.875 but combined m>0: KEEP", dict(RT, by_cell={("R", s, "FD"): -3.0 for s in RT_S}), {"v": {"R": "KEEP"}, "dec_has": "KEEP"}),
    ("TRIP re-test: same, and F's slot not placed in calm of FD#1021-1024", dict(RT, by_cell={("R", s, "FD"): -3.0 for s in RT_S}, mutate=[("R", s, "FD", "slot_unplaced", "calm") for s in RT_S]),
     {"v": {"R": "REVERT"}, "dec_has": "REVERT", "text_has": "slot failures: FD#1021"}),
    ("TRIP re-test: R +1.25 but F's slot not placed in FD#1022 calm", dict(RT, mutate=[("R", 1022, "FD", "slot_unplaced", "calm")]), {"v": {"R": "REVERT"}, "dec_has": "REVERT"}),
    ("TRIP re-test: R +1.25 but a fee-rule flag on F's slot", dict(RT, mutate=[("R", 1023, "FP", "slot_flag", ("whale", FEE))]), {"v": {"R": "REVERT"}, "dec_has": "REVERT"}),
    ("TRIP re-test: R +1.25 but an unknown flag on F's slot", dict(RT, mutate=[("R", 1023, "FP", "slot_flag", ("whale", "a flag no version of judge2 has seen"))]), {"v": {"R": "BLOCKED"}}),
    ("TRIP re-test with a stage-2 matrix replaced", dict(RT, replace_file=[(1012, "FD", "R")]), {"v": {"R": "BLOCKED"}}),
    ("re-test accepts a shipped F2 path", dict(RT, stage2_from="v2c1", reuse_from="v2c1", cands={"C1": "noninferiority"}), {"v": {"C1": "BLOCKED"}}),
    ("SK TRIP re-test m<0 with FD fine (FP -4.5 in 1021-1024)", dict(RT, by_cell={("R", s, "FP"): -4.5 for s in RT_S}), {"v": {"R": "REVERT"}, "dec_has": "REVERT"}),
    ("SK NOT-TRIP re-test m>0 with FD fine (FP -3.0 in 1021-1024)", dict(RT, by_cell={("R", s, "FP"): -3.0 for s in RT_S}), {"v": {"R": "KEEP"}, "dec_has": "KEEP"}),
    ("SK stage 2: R no effect (saved as v2fail)", dict(S2, eff={"R": 0.0}, save_as="v2fail"), {"v": {"R": "FAIL"}}),
    ("SK TRIP re-test after a failed stage 2", dict(RT, stage2_from="v2fail", reuse_from="v2fail"), X2("does not pass")),
    ("SK TRIP rerun is a copy of the listed matrix (same runDirs)", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")], exclude=[INF(1005, "FP", "calm", rerun=("R", "copy"))]), E("BLOCKED", "BLOCKED", "PENDING", glob="shares runDirs")),

    ("EW11 excludes launch: zero outside, +12 launch cannot pass", C(eff={"R": 0, "C1": 0.3}, noise={}, cell_dt={X("R", seed, f, "launch"): 12 for seed in S1 for f in ("FP", "FD")}), E("FAIL", "PASS", "F=C1", R_m=0.0, ew12=1.0)),
    ("EW11 +0.6 with launch -2.9 passes independently", C(eff={"R": 0.6, "C1": 0.3}, noise={}, cell_dt={X("R", seed, f, "launch"): -2.9 for seed in S1 for f in ("FP", "FD")}), E("PASS", "PASS", "F=R, F2=C1", R_m=0.6, ew12=(6.6-2.9)/12)),
    ("launch mean -3.01 FAIL despite EW11 +2", C(eff={"R": 2, "C1": 0.3}, noise={}, cell_dt={X("R", seed, f, "launch"): -3.01 for seed in S1 for f in ("FP", "FD")}), E("FAIL", "PASS", "F=C1", R_m=2, clause=("R", "6_launch", "FAIL"))),
    ("floor +0.199 FAIL even with significant t", C(eff={"R": 0.199, "C1": 0.3}, noise={}, placebo_seed_offset={}), E("FAIL", "PASS", "F=C1", clause=("R", "1_mean_t", "FAIL"))),
    ("no ask +0.21 PASS", C(eff={"R": 0.21, "C1": 0.3}, noise={}), E("PASS", "PASS", "F=R, F2=C1", sel_ask=None)),
    ("no ask +0.5 PASS", C(eff={"R": 0.5, "C1": 0.3}, noise={}), E("PASS", "PASS", "F=R, F2=C1", sel_ask=None)),
    ("no ask +0.999 PASS", C(eff={"R": 0.999, "C1": 0.3}, noise={}), E("PASS", "PASS", "F=R, F2=C1", sel_ask=None)),
    ("whale adverse T but own mechanism zero: noise", C(eff={"R": 1.5, "C1": 0.3}, cell_dt=whale7), E("PASS", "PASS", "F=R, F2=C1", attribution=("whale", "noise"))),
    ("whale adverse T but own mechanism positive: noise", C(eff={"R": 1.5, "C1": 0.3}, cell_dt=whale7, own_pnl={"R": {"whale": 1}}), E("PASS", "PASS", "F=R, F2=C1", attribution=("whale", "noise"))),
    ("whale own negative PnL: veto", C(eff={"R": 1.5, "C1": 0.3}, cell_dt=whale7, own_pnl={"R": {"whale": -1}}), E("FAIL", "PASS", "F=C1", attribution=("whale", "veto"))),
    ("whale attribution missing: BLOCKED", C(eff={"R": 1.5, "C1": 0.3}, cell_dt=whale7, mech_patch={"R": {"tagged_mechanism_pnl": None}}), E("BLOCKED", "PASS", "PENDING", attribution=("whale", "missing"))),
    ("C1 launch-only matrices accepted", C(launch_only=True), E("PASS", "PASS", "F=R, F2=C1")),
    ("C1 launch -3.1 FAIL", C(launch_only=True, eff={"R": 1.25, "C1": -3.1}, noise={}), E("PASS", "FAIL", "F=R", clause=("C1", "6_launch", "FAIL"))),
    ("C1 poor non-launch EW ignored", C(eff={"R": 1.25, "C1": -5}, noise={}, cell_dt={X("C1", seed, f, "launch"): 0 for seed in S1 for f in ("FP", "FD")}), E("PASS", "PASS", "F=R, F2=C1")),
    ("R and W rank by EW11 m", C(cands={"R": "superiority", "W": "superiority", "C1": "noninferiority"}, eff={"R": 0.8, "W": 1.5, "C1": 0.3}, noise={}), dict(E("PASS", "PASS", "F=W, F2=R"), v={"R": "PASS", "W": "PASS", "C1": "PASS"})),
    ("field mean below floor but bound passes", C(by_cell={("R", seed, f): ([-1.2, -0.8, 0, 0.4][i] if f == "FP" else 3) for i, seed in enumerate(S1) for f in ("FP", "FD")}, noise={}), E("PASS", "PASS", "F=R, F2=C1", clause=("R", "2_field_means", "PASS"))),
]
bad = 0
cases += [
    ("C1 FS needs all three regimes", dict(S2C1, launch_only=True), {"v": {"C1": "BLOCKED"}}),
    ("prior retest missing matrices", dict(RT, tamper_prior="matrices"), {"v": {"R": "BLOCKED"}}),
    ("prior stage2 changed map", dict(S2, tamper_prior="map"), {"v": {"R": "BLOCKED"}}),
    ("prior retest changed map", dict(RT, tamper_prior="map"), {"v": {"R": "BLOCKED"}}),
    ("prior malformed candidate", dict(S2, tamper_prior="candidate"), X2("malformed candidates")),
    ("REGRESSION C1 arm identity", C(cands={"R": "superiority"}, arm_map={"B": "opus-1", "B'": "opus-1-pb", "R": "opus-1r"}, wrong_arm=True), {"v": {"R": "BLOCKED"}}),
    ("REGRESSION C2 canonical run reuse", C(alias_runs=True, cross=[("R", 1003, "FD", "rundirs_of", "B")]), {"v": {"R": "BLOCKED"}}),
    ("REGRESSION C3 prior selected but FAIL", dict(S2, tamper_prior=True), {"v": {"R": "BLOCKED"}}),
    ("REGRESSION W2 C1 FS lending loss", dict(S2C1, cell_dp={X("C1", 1101, "FS", "lending-incident"): -3500.0}), {"v": {"C1": "FAIL"}, "clause": ("C1", "6_fs_field", "FAIL")}),
    ("REGRESSION W3 rerun setup mismatch", C(mutate=[("R", 1005, "FP", "invalid_epoch", "calm")], exclude=[INF(1005, "FP", "calm", rerun=("R", "wrong_setup"))]), {"v": {"R": "BLOCKED"}}),
]
for i, (name, case, ex) in enumerate(cases):
    d = os.path.join(T, "case%03d" % i)
    rc, v, text = run(case, d)
    errs = []
    want_rc = ex.get("exit", 0)
    if rc != want_rc:
        errs.append("exit %d (want %d): %s" % (rc, want_rc, text.strip()[-300:]))
    elif want_rc != 0:
        if ex["stderr"] not in text:
            errs.append("exit %d but the message lacks %r: %s" % (rc, ex["stderr"], text.strip()[-300:]))
    else:
        c = v["candidates"]
        for a, want in ex["v"].items():
            if c[a]["verdict"] != want:
                errs.append("%s %s (want %s)" % (a, c[a]["verdict"], want))
        if ex.get("dec") and v["selection"]["decision"] != ex["dec"]:
            errs.append("decision %s (want %s)" % (v["selection"]["decision"], ex["dec"]))
        if ex.get("dec_has") and ex["dec_has"] not in v["selection"]["decision"]:
            errs.append("decision %r lacks %r" % (v["selection"]["decision"], ex["dec_has"]))
        if "sel_ask" in ex and v["selection"].get("ask_user_at_submission") != ex["sel_ask"]:
            errs.append("selection ask_user_at_submission %r (want %r)" % (v["selection"].get("ask_user_at_submission"), ex["sel_ask"]))
        for frag in ex.get("note_has", []):
            if frag not in (v["selection"].get("note") or ""):
                errs.append("selection note %r lacks %r" % (v["selection"].get("note"), frag))
        if "clause" in ex:
            a, cl, want = ex["clause"]
            got = c[a].get("clauses", {}).get(cl, {}).get("status")
            if got != want: errs.append("%s %s %s (want %s)" % (a, cl, got, want))
        if "sub" in ex:
            a, sub, want = ex["sub"]
            got = c[a].get("clauses", {}).get("5_mechanism", {}).get("subclauses", {}).get(sub, {}).get("status")
            if got != want: errs.append("%s mechanism %s %s (want %s)" % (a, sub, got, want))
        if "problem" in ex:
            a, frag = ex["problem"]
            if not any(frag in p for p in c[a].get("input_problems", [])): errs.append("%s problems lack %r: %r" % (a, frag, c[a].get("input_problems")))
        if "glob" in ex and not any(ex["glob"] in g for g in v["global_problems"]):
            errs.append("global problems lack %r: %r" % (ex["glob"], v["global_problems"]))
        if "excl" in ex and not (v["exclusions"] and all(x["status"] == ex["excl"] for x in v["exclusions"])):
            errs.append("exclusions %r (want all %s)" % ([x["status"] for x in v["exclusions"]], ex["excl"]))
        if "scope" in ex and (v.get("exclusion_scope") or {}).get("status") != ex["scope"]:
            errs.append("exclusion scope %r (want %s)" % (v.get("exclusion_scope"), ex["scope"]))
        if "nonplan" in ex and not any(ex["nonplan"] in x for x in v["nonplan"]):
            errs.append("nonplan %r lacks %r" % (v["nonplan"], ex["nonplan"]))
        if "placebo" in ex:
            got = ((v.get("placebo") or {}).get("check") or {}).get("status")
            got_r = (c.get("R", {}).get("placebo_check") or {}).get("status")
            if got != ex["placebo"] or got_r != ex["placebo"]:
                errs.append("placebo check %r / R's %r (want %s)" % (got, got_r, ex["placebo"]))
        if "ew12" in ex and abs(c["R"]["ew12"]["m"] - ex["ew12"]) > 1e-9:
            errs.append("EW12 report differs: %r" % c["R"]["ew12"])
        if "attribution" in ex:
            rg, want = ex["attribution"]
            if c["R"].get("regimes", {}).get(rg, {}).get("attribution") != want:
                errs.append("attribution is not %s" % want)
        if "text_has" in ex and ex["text_has"] not in text:
            errs.append("the printed table lacks %r" % ex["text_has"])
        st = c.get("R", {}).get("stats", {})
        if "R_m" in ex and abs(st["m"] - ex["R_m"]) > 1e-9: errs.append("R m %r" % st["m"])
        if "R_f" in ex and abs(st["f"] - ex["R_f"]) > 1e-12: errs.append("R f %r" % st["f"])
        if "R_f_gt" in ex and not st["f"] > ex["R_f_gt"]: errs.append("R f %r" % st["f"])
        if "R_t" in ex and abs(st["t"] - ex["R_t"]) > 1e-6: errs.append("R t %r (want %r)" % (st["t"], ex["R_t"]))
        if "R_n" in ex and st.get("n") != ex["R_n"]: errs.append("R n %r" % st.get("n"))
        if "regimes_in" in ex:
            s, f, n = ex["regimes_in"]
            row = [x for x in v["cells"] if x["seed"] == s and x["field"] == f][0]
            if row["arms"]["R"]["regimes"] != n: errs.append("regimes counted %r" % row["arms"]["R"]["regimes"])
    if v:
        got = " ".join("%s %-8s" % (a, x["verdict"]) for a, x in v["candidates"].items())
        st = next((x.get("stats") for x in v["candidates"].values() if x.get("stats")), None)
        note = (" m %+.3f t %+.3f" % (st["m"], st["t"])) if st and st.get("t") is not None else ""
        shown = "%s | %s%s" % (got, v["selection"]["decision"][:40], note)
    else:
        shown = "exit %d: %s" % (rc, (text.strip().splitlines() or [""])[-1][:110])
    print("%-4s %-64s %s" % ("ok" if not errs else "FAIL", name[:64], shown))
    for e in errs:
        print("       " + e)
    bad += bool(errs)
# Real stage-1 arm map through the CLI, without a C1 launch report.
amap = {"B": "opus-1", "B'": "opus-1-pb", "R": "opus-1r", "W1": "opus-1g2",
        "W2": "ascon-zeta-r3k", "X1": "opus-1g", "X2": "opus-1w", "X3": "ascon-zeta-r3kg"}
candidates = {a: "superiority" for a in amap if a not in ("B", "B'")}
for missing in (False, True):
    case = C(cands=candidates, arm_map=amap, cli_arms=missing, eff={a: 2.0 if a.startswith("X") else 1.0 for a in candidates}, noise={},
             omit_arms=[(1003, "FP", "W2")] if missing else [])
    rc, v, text = run(case, os.path.join(T, "real-arm-map-" + str(missing)))
    assert rc == 0, text
    assert 'C1' not in v['candidates'] and len(v['cells']) == 8
    for a, result in v['candidates'].items():
        assert result['verdict'] == ('BLOCKED' if missing and a == 'W2' else 'PASS'), (a, result)
        if a.startswith('X'):
            assert result['exploratory'] and result['informational'] and result['decision'] == 'informational PASS', result
            assert result['stage1_ship_eligible'] is False
    assert v['selection']['F'] in (None, 'R', 'W1', 'W2')
    assert v['selection']['F2'] in (None, 'R', 'W1', 'W2')
    print('ARM_MAP_JUDGE_OK missing_W2=%s; other five PASS; X informational only; no C1' % missing)
# Informational failures/missing data cannot hold up shipping selection.
case = C(cands=candidates, arm_map=amap, eff={a: 1.0 for a in candidates}, noise={},
         omit_arms=[(1003, "FP", "X1")])
rc, v, text = run(case, os.path.join(T, "informational-missing"))
assert rc == 0 and v['candidates']['X1']['verdict'] == 'BLOCKED', text
assert v['selection']['status'] == 'DECIDED' and v['selection']['F'] == 'R', v
# Even a forged earlier selection cannot admit an informational arm later.
for stage in ('2', 'retest'):
    for label, directory in (('X1', 'opus-1g'), ('R', 'opus-1g')):
        case = C(stage=stage, cands={label: 'superiority'},
                 arm_map={'B': 'opus-1', "B'": 'opus-1-pb', label: directory})
        rc, v, text = run(case, os.path.join(T, 'informational-' + stage + label))
        assert rc == 2 and 'informational arms cannot enter' in text, text
print('INFORMATIONAL_GUARDS_OK missing X does not block; stage 2/retest refused by label and directory')
# Mutation control: removing the X classification must make the control fail.
source = open(J).read()
mutated = source.replace('return label.startswith("X") or (arm_map or {}).get(label) in EXPLORATORY_DIRS', 'return False')
assert mutated != source
ns = {"__name__": "arm_map_red", "__file__": J}
exec(compile(mutated, J, 'exec'), ns)
try:
    assert ns['exploratory_arm']('X1', amap)
except AssertionError:
    print('RED_CHECK_OK X classification removed: exploratory control catches mutation')
else:
    raise AssertionError('X red check survived')
# Each review repair has an executable red control: revert only that guard,
# rerun its adversarial fixture, and require the unsafe PASS to reappear.
original_j = J
source = open(J).read()
mutations = [
    ("C1", 'r["config"] += arm_problems(evidence, (cfg.get("arm_map") or {}).get(arm), r["setup"])', 'pass'),
    ("C2", 'out["run_dirs"].append(os.path.realpath(sc["runDir"] if os.path.isabs(sc["runDir"]) else\n                os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(path)))), sc["runDir"])))', 'out["run_dirs"].append(sc["runDir"])'),
    ("C3", 'cfg["prior_problems"] += prior_problems(v1, cfg, F)', 'pass'),
    ("W2", 'if roles.get(arm) == "noninferiority" and key[1] != FS_FIELD:', 'if roles.get(arm) == "noninferiority":'),
    ("W3", 'elif listed is None or r["setup"] != listed["setup"]:', 'elif False:'),
]
for label, old, new in mutations:
    assert old in source, label
    mutant = source.replace(old, new)
    if label == "W3":
        mutant = mutant.replace('elif identity_errors or not original_proof or proof != original_proof:', 'elif False:')
    mutant = mutant.replace('HERE = os.path.dirname(os.path.abspath(__file__))', 'HERE = ' + repr(os.path.dirname(original_j)))
    J = os.path.join(T, "red-" + label + ".py")
    with open(J, "w") as fh:
        fh.write(mutant)
    case = next(case for name, case, ex in cases if name.startswith("REGRESSION " + label + " "))
    rc, v, text = run(case, os.path.join(T, "red-case-" + label))
    arm = "C1" if label == "W2" else "R"
    assert rc == 0 and v["candidates"][arm]["verdict"] == "PASS", (label, rc, text)
    print("RED_CHECK_OK %s: reverting guard restores unsafe PASS" % label)
J = original_j
with open(os.path.join(T, "saved.json"), "w") as fh:
    json.dump({k: v["verdict"] for k, v in SAVED.items()}, fh)
print("SYNTHETIC %s: %d/%d controls as expected" % ("OK" if not bad else "FAILED", len(cases) - bad, len(cases)))
sys.exit(1 if bad else 0)
EOF

cat > "$T/mccheck.py" <<'EOF'
import argparse, copy, hashlib, importlib.util, json, math, os, random, statistics, subprocess, sys
# Controls for ascon/final/mc.py: the noise file's placebo section is read and changes the stage-1 f;
# a malformed section fails loudly; --launch-sd cap / number / garbage; stage 2 and the re-test go
# through judge2's own functions; placebo-noise builds the section from a stage-1 verdict.
MC, T = sys.argv[1], sys.argv[2]
try:
    V1 = json.load(open(sys.argv[3]))["v1"]
except (OSError, ValueError, KeyError) as e:
    print("MC BLOCKED: no stage-1 verdict from the synthetic part (%s)" % e)
    sys.exit(2)
spec = importlib.util.spec_from_file_location("mc", MC)
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)
J = mc.J
bad = 0
def report(ok, msg):
    global bad
    print("%-4s %s" % ("ok" if ok else "FAIL", msg))
    bad += not ok

# a small synthetic noise file (no real data needed): FP sd 2, FD sd 5, launch 20
def noise_file(placebo):
    vals = {"FP": 2.0, "FD": 5.0}
    fields = {f: {r: {"values": [sd, -sd], "contrast_sd": (20.0 if r == "launch" else sd), "sigma_p": 1000.0, "n": 2}
                  for r in mc.REGIMES} for f, sd in vals.items()}
    n = {"fields": fields, "copies": {"FS": "FD"}, "tau": {"FP": 0.0, "FD": 0.0, "FS": 0.0}, "rho_field": 0.0, "draw": "gaussian"}
    if placebo is not None:
        n["placebo"] = placebo
    return n
def margs(**kw):
    a = argparse.Namespace(scale=1.0, launch_sd=None, rho=None, tau=None, draw=None, stage2_f="stage1", effect_c1=0.0)
    for k, v in kw.items():
        setattr(a, k, v)
    return a
def f_dist(placebo, n=400):
    model = mc.Model(noise_file(placebo), margs())
    rng = random.Random(3)
    fs, gate = [], 0
    for _ in range(n):
        s1 = mc.sim_stage(rng, model, {"B": None, "B'": None, "C1": 0.0, "R": 0.0}, 4, ("FP", "FD"))
        e = J.evaluate("superiority", mc.contrasts(model, s1, "R"), mc.contrasts(model, s1, "B'"), mc.MECH_PASS)
        fs.append(e["stats"]["f"])
        gate += e["placebo_check"]["status"] == "WARN"
        if "0_placebo" in e["clauses"]:
            raise SystemExit("judge2 still has a placebo clause in the verdict")
    return statistics.mean(fs), min(fs), gate / n

m_ph, lo_ph, g_ph = f_dist({"placeholder": True})
m_s0, lo_s0, g_s0 = f_dist({"placeholder": False, "scale": 0.0})
m_f0, lo_f0, g_f0 = f_dist({"placeholder": False, "fields": {f: {r: {"contrast_sd": 0.0} for r in mc.REGIMES} for f in ("FP", "FD")}})
m_f1, _, _ = f_dist({"placeholder": False, "fields": {f: {r: {"contrast_sd": (20.0 if r == "launch" else {"FP": 2.0, "FD": 5.0}[f])} for r in mc.REGIMES} for f in ("FP", "FD")}})
print("     stage-1 f: placeholder mean %.3f (placebo WARN %.3f) | scale 0 mean %.3f min %.3f | fields sd 0 mean %.3f | fields = candidate sd mean %.3f" % (
    m_ph, g_ph, m_s0, lo_s0, m_f0, m_f1))
report(m_ph > 0.5 and abs(m_s0 - 0.25) < 1e-12 and abs(m_f0 - 0.25) < 1e-12 and g_s0 == 0,
       "placebo section is read: placeholder gives f mean %.2f; scale 0 and fields sd 0 pin f to the 0.25 floor and never WARN" % m_ph)
report(abs(m_f1 - m_ph) / m_ph < 0.15, "placebo fields equal to the candidate sd give about the placeholder's f (%.3f vs %.3f)" % (m_f1, m_ph))
report(0 < g_ph < 0.5, "under the placeholder (null B') the placebo check WARNs at %.3f (report only; t is calibrated for the whole tree)" % g_ph)
pc0 = J.placebo_check([0.0] * 4)
pc1 = J.placebo_check([1.0] * 4)
report(pc0["status"] == "OK" and pc1["status"] == "WARN",
       "placebo warning separates zero and positive offsets without a nominal per-stage alpha claim")

# Exact arithmetic boundary controls, independent of fixture inversion/roundoff.
def exact_cells(effect, launch=0.0, n=4):
    return {(seed, f): {"ew": 999, "regimes": {r: (launch if r == "launch" else effect, 0) for r in mc.REGIMES},
                       "mechanism_pnl": {r: 0.0 for r in mc.REGIMES}}
            for seed in range(n) for f in ("FP", "FD")}
zero = exact_cells(0)
report(J.T_CRIT == 0.94 and J.THRESHOLD == 0.20 and J.ASK_FLOOR is None and
       J.t_crit_for(4) == 0.94 and J.t_crit_for(8) == 0.94 and
       J.t_crit_for(3) == 1.886 and J.t_crit_for(2) == 3.078,
       "pin calibrated t_crit 0.94, +0.20 floor, no ask; small-n guards only below four seeds")
for t, expected in ((0.939, J.FAIL), (0.94, J.PASS), (0.941, J.PASS)):
    v = J.evaluate_stage2("superiority", exact_cells(t / 2), exact_cells(1), 1.0,
                          mc.MECH_PASS, noop_sub=mc.MECH_PASS["mc"])
    report(v["stats"]["t"] == t and v["verdict"] == expected,
           "stage 2 uses pinned t_crit: t %.3f -> %s" % (t, expected))
ex = J.evaluate("superiority", exact_cells(0, 12), zero, mc.MECH_PASS)
report(ex["stats"]["m"] == 0 and ex["verdict"] == J.FAIL, "EW11 exclusion ignores launch and a stale cached ew")
# Eight-seed control retained: the +0.20 mean floor is independent of the calibrated t gate.
lo = J.evaluate("superiority", exact_cells(0.199, n=8), exact_cells(0, n=8), mc.MECH_PASS)
edge = J.evaluate("superiority", exact_cells(0.20, n=8), exact_cells(0, n=8), mc.MECH_PASS)
report(lo["stats"]["t"] > J.T_CRIT and lo["verdict"] == J.FAIL and edge["verdict"] == J.PASS,
       "floor +0.20 inclusive, +0.199 FAIL with significant t (eight paired seeds)")
for effect in (0.21, 0.5, 0.999, 1.0):
    e = J.evaluate("superiority", exact_cells(effect), zero, mc.MECH_PASS)
    report(e["verdict"] == J.PASS, "no ask band at +%.3f" % effect)

# A threshold scan must agree with the shared judge, including F2 and SE floor.
# These draws cover real clause failures as well as passes, at both stages.
saved_t = J.T_CRIT
rng = random.Random(231024)
model = mc.Model(noise_file({"placeholder": True}), margs())
agreement = True
for effect in (0.0, 0.5, 1.0):
    for _ in range(30):
        s1 = mc.sim_stage(rng, model, {"B": None, "B'": None, "R": effect, "W": effect}, 4, J.FIELDS)
        s2 = mc.sim_stage(rng, model, {"B": None, "R": effect, "W": effect}, 4, J.FIELDS)
        fs = mc.sim_stage(rng, model, {"B": None, "R": effect, "W": effect}, 2, ("FS",))
        cp = mc.contrasts(model, s1, "B'")
        for t in (0.0, 0.5, 1.0, 1.64, 2.0):
            J.T_CRIT = t
            for arm in ("R", "W"):
                a = J.evaluate("superiority", mc.contrasts(model, s1, arm), cp, mc.MECH_PASS)
                b = J.evaluate_stage2("superiority", mc.contrasts(model, s2, arm), mc.contrasts(model, fs, arm),
                                      a["stats"]["f"], mc.MECH_PASS, noop_sub=mc.MECH_PASS["mc"])
                agreement &= (mc.ship_capacity(a, b) >= t) == (a["verdict"] == b["verdict"] == J.PASS)
J.T_CRIT = saved_t
report(agreement, "calibration capacities agree with judge2 in both stages over 900 arm/threshold cases")

# Each switch removes only its intended condition; stage-2 positivity survives.
a = J.evaluate("superiority", exact_cells(0.199), zero, mc.MECH_PASS)
b = J.evaluate_stage2("superiority", exact_cells(1), exact_cells(1), 0.25, mc.MECH_PASS, noop_sub=mc.MECH_PASS["mc"])
report(mc.ship_capacity(a, b) == -math.inf and mc.ship_capacity(a, b, "floor") > 0,
       "MC floor ablation removes only stage-1 +0.20")
a = J.evaluate("superiority", exact_cells(0.5), zero, mc.MECH_PASS, f_override=2)
report(mc.ship_capacity(a, b, "t_crit") == math.inf and mc.ship_capacity(a, b, "f") > mc.ship_capacity(a, b),
       "MC t ablation removes t gate; f ablation removes SE floor")
for off, clause in mc.ABLATIONS.items():
    if clause is not None:
        broken = copy.deepcopy(b)
        broken["clauses"][clause]["status"] = J.FAIL
        report(mc.ship_capacity(a, broken) == -math.inf and mc.ship_capacity(a, broken, off) >= 0,
               "MC %s ablation removes its clause" % off)
bzero = J.evaluate_stage2("superiority", zero, exact_cells(1), 0.25, mc.MECH_PASS, noop_sub=mc.MECH_PASS["mc"])
report(all(mc.ship_capacity(a, bzero, off) == -math.inf for off in mc.ABLATIONS),
       "every MC ablation retains stage-2 m > 0")
report(J.launch_clause(exact_cells(2, -3))["status"] == J.PASS and
       J.launch_clause(exact_cells(2, -3.001))["status"] == J.FAIL, "launch -3 inclusive / below -3 FAIL")
e = J.evaluate("noninferiority", exact_cells(-10, -2), zero, mc.MECH_PASS)
report(e["verdict"] == J.PASS and set(e["clauses"]) == {"5_mechanism", "6_launch"},
       "C1 ignores non-launch clauses 1-4 and has no trap (e) criterion")
report(J.retest_decision(exact_cells(0))["decision"] == "REVERT" and
       J.retest_decision(exact_cells(0.01))["decision"] == "KEEP", "retest EW11 m <= 0 reverts; m > 0 keeps")
roles = {"R": "superiority", "W": "superiority", "C1": "noninferiority"}
vs = {a: J.PASS for a in roles}
report(J.select(vs, roles, {"R": 2, "W": 1})["F"] == "R" and
       J.select(vs, roles, {"R": 1, "W": 2})["F2"] == "R" and
       J.select({"R": J.FAIL, "W": J.FAIL, "C1": J.PASS}, roles)["F"] == "C1",
       "R/W ranking uses m in both directions; C1 fallback remains")
noops = exact_cells(1)
for cell in noops.values():
    cell["noop_gaps"] = {r: (1, -1) for r in cell["regimes"]}
report(J.noop_clause(noops)["status"] == J.FAIL, "Step 7 noop regression is FAIL")
for cell in noops.values():
    cell["noop_gaps"] = {r: (-1, -2) for r in cell["regimes"]}
report(J.noop_clause(noops)["status"] == J.PASS, "B below noop is not a candidate regression gate")

# judge2 helpers that no CLI input reaches on its own (defensive guards): each must trip and not trip
cv_bad = J.coverage_clause(["FD#1021"], set())
cv_ok = J.coverage_clause(["FD#1021"], {"FD#1021"})
cv_none = J.coverage_clause([], set())
report(cv_bad["status"] == J.BLOCKED and cv_ok["status"] == J.PASS and cv_none["status"] == J.PASS,
       "coverage: a cell without a contrast is BLOCKED unless the candidate's own failure there explains it (%s / %s / %s)" % (
           cv_bad["status"], cv_ok["status"], cv_none["status"]))
kinds = {"process exited early: OOM": "failure", "absent from summary.json (was not placed)": "failure", "no P in summary.json": "failure",
         "priority fee rule violation: over the cap": "rule", "12 on-chain tx(s) absent from the agent's submitted log": "rule",
         "3 on-chain tx(s) sent from 1 address(es) the agent's wallet funded (attributed ...)": "rule",
         "value moved between registered addresses: sent 1 USDC": "rule", "V_0 has no endowment floor in this epoch": "info",
         "V_0 measured at the first boundary was 9 USDC below": "info", "something new": "unknown", 7: "unknown"}
wrong = {k: J.flag_kind(k) for k, want in kinds.items() if J.flag_kind(k) != want}
report(not wrong, "flag_kind sorts the core's slot flags (failure / rule / info / unknown)%s" % ((": wrong " + repr(wrong)) if wrong else ""))
rf = J.rule_flag_clause({"FD#1003": {"calm": ["V_0 measured at the first boundary was 9 USDC below"]}})
rf_bad = J.rule_flag_clause({"FD#1003": {"calm": ["12 on-chain tx(s) absent from the agent's submitted log"], "crash": ["something new"]}})
rf_unk = J.rule_flag_clause({"FD#1003": {"calm": ["something new"]}})
report(rf["status"] == J.PASS and rf_bad["status"] == J.FAIL and rf_unk["status"] == J.BLOCKED,
       "rule flags: info PASS, rule FAIL (over an unknown one), unknown BLOCKED (%s / %s / %s)" % (rf["status"], rf_bad["status"], rf_unk["status"]))
for name, sec in (("placeholder missing", {"scale": 0.5}), ("neither scale nor fields", {"placeholder": False}),
                  ("both scale and fields", {"placeholder": False, "scale": 1.0, "fields": {}}), ("negative scale", {"placeholder": False, "scale": -1.0}),
                  ("a regime missing", {"placeholder": False, "fields": {"FP": {}, "FD": {}}}), ("not an object", "sd 0")):
    try:
        mc.Model(noise_file(sec), margs())
        report(False, "malformed placebo section (%s) must fail loudly: it was accepted" % name)
    except SystemExit as e:
        report(True, "malformed placebo section (%s) fails loudly: %s" % (name, str(e)[:90]))
try:
    mc.Model(noise_file(None), margs())
    report(True, "no placebo section at all is accepted (candidate noise)")
except SystemExit as e:
    report(False, "no placebo section must be accepted: %s" % e)

# --launch-sd
m = mc.Model(noise_file({"placeholder": True}), margs())
report(m.sd["FP"]["launch"] == 20.0 and "upper bound" in m.launch_label, "default launch sd is the measured one, labelled an upper bound (%s)" % m.launch_label)
m = mc.Model(noise_file({"placeholder": True}), margs(launch_sd="cap"))
report(m.sd["FP"]["launch"] == 2.0 and m.sd["FD"]["launch"] == 5.0, "--launch-sd cap = largest non-launch sd per field (FP %.1f, FD %.1f)" % (m.sd["FP"]["launch"], m.sd["FD"]["launch"]))
m = mc.Model(noise_file({"placeholder": True}), margs(launch_sd="4"))
report(m.sd["FP"]["launch"] == 4.0 and m.sd["FD"]["launch"] == 4.0, "--launch-sd 4 sets both fields")
try:
    mc.Model(noise_file({"placeholder": True}), margs(launch_sd="wide"))
    report(False, "--launch-sd wide must be rejected")
except SystemExit:
    report(True, "--launch-sd wide is rejected")

# stage 2 and the re-test run through judge2's own functions: break them and the MC must follow
def ship(eff, patch=None):
    saved = {k: getattr(J, k) for k in ("evaluate_stage2", "retest_decision")}
    try:
        for k, fn in (patch or {}).items():
            setattr(J, k, fn)
        model = mc.Model(noise_file({"placeholder": False, "scale": 0.0}), margs(launch_sd="cap"))
        return mc.run_grid(model, margs(), [eff], {"approved": J.THRESHOLD}, 300, 5)[eff]["approved"]
    finally:
        for k, fn in saved.items():
            setattr(J, k, fn)
r_ok = ship(2.0)
r_s2 = ship(2.0, {"evaluate_stage2": lambda *a, **k: {"verdict": J.FAIL}})
r_rt = ship(2.0, {"retest_decision": lambda cells: {"decision": "REVERT"}})
report(r_ok["ship_RW"] > 0.5 and r_s2["ship_R"] == 0 and r_ok["RW_kept"] > 0.5 and r_rt["R_kept"] == 0 and r_rt["ship_R"] == r_ok["ship_R"],
       "MC stage 2 is judge2.evaluate_stage2 and the re-test judge2.retest_decision (ship_R %.2f -> %.2f when stage 2 always fails; R kept %.2f -> %.2f when the re-test always reverts)" % (
           r_ok["ship_R"], r_s2["ship_R"], r_ok["R_kept"], r_rt["R_kept"]))
r_pl = ship(0.0)
saved_sel = J.select
try:
    J.select = lambda v, r, means=None: {"F": None, "F2": None, "status": "PENDING", "decision": "PENDING"}
    r_pd = ship(0.0)
finally:
    J.select = saved_sel
report(r_pl["s1_pending"] == 0 and r_pd["s1_pending"] == 1.0, "MC counts a PENDING stage-1 selection in its own column (%.2f; %.2f when select always pends)" % (
    r_pl["s1_pending"], r_pd["s1_pending"]))

# mc.py run records the sha256 of the code that produced the table
nz = os.path.join(T, "mc-run-noise.json")
with open(nz, "w") as fh:
    json.dump(noise_file({"placeholder": True}), fh)
oj = os.path.join(T, "mc-run.json")
p = subprocess.run([sys.executable, "-B", "-I", MC, "run", "--noise", nz, "--sims", "50", "--effects", "0", "--json", oj], capture_output=True, text=True)
ok = p.returncode == 0
if ok:
    run_report = json.load(open(oj))
    cs = run_report.get("code_sha256") or {}
    ok = ok and run_report["t_crit"] == 0.94 and run_report["threshold"] == 0.20
    jpath = os.path.join(os.path.dirname(MC), "judge2.py")
    ok = ok and cs.get("mc.py") == hashlib.sha256(open(MC, "rb").read()).hexdigest() and cs.get("judge2.py") == hashlib.sha256(open(jpath, "rb").read()).hexdigest()
    ok = ok and "s1 Bwarn" in p.stdout and "s1 pend" in p.stdout
report(ok, "mc.py run writes code_sha256 of mc.py and judge2.py and pins default t_crit 0.94 / floor 0.20 and prints s1 pend / s1 Bwarn (exit %d)" % p.returncode)

# placebo-noise from a stage-1 verdict
src = os.path.join(T, "mc-noise-in.json")
with open(src, "w") as fh:
    json.dump(noise_file({"placeholder": True}), fh)
out = os.path.join(T, "mc-noise-b.json")
p = subprocess.run([sys.executable, "-B", "-I", MC, "placebo-noise", "--verdict", V1, "--noise", src, "--out", out], capture_output=True, text=True)
ok = p.returncode == 0
if ok:
    nb = json.load(open(out))
    v1 = json.load(open(V1))
    want = {}
    for lab, regs in v1["placebo"]["regime_dT"].items():
        for r, dt in regs.items():
            want.setdefault((lab.split("#")[0], r), []).append(dt)
    err = max(abs(nb["placebo"]["fields"][f][r]["contrast_sd"] - math.sqrt(sum(x * x for x in xs) / len(xs))) for (f, r), xs in want.items())
    ok = nb["placebo"]["placeholder"] is False and err < 1e-12 and all(nb["placebo"]["fields"][f][r]["n"] == 4 for f in ("FP", "FD") for r in mc.REGIMES)
    mc.Model(nb, margs())  # must load
report(ok, "placebo-noise fills the section from the stage-1 verdict's B' - B dT (4 seeds per regime, rms matches)")
bad_v = os.path.join(T, "mc-not-a-verdict.json")
with open(bad_v, "w") as fh:
    json.dump({"tool": "ascon/final/judge2.py", "stage": "2"}, fh)
p = subprocess.run([sys.executable, "-B", "-I", MC, "placebo-noise", "--verdict", bad_v, "--noise", src, "--out", out + ".x"], capture_output=True, text=True)
report(p.returncode != 0 and not os.path.exists(out + ".x"), "placebo-noise refuses a non-stage-1 verdict (exit %d)" % p.returncode)
# Compare the fast three-arm grid with the frozen selector at every grid point.
grid = [0.93, 0.94, 0.95, 1.0, 1.1, 1.2, 2.0]
def trial_verdict(m, t):
    return {"stats": {"m": m, "t": t}, "clauses": {"1_mean_t": {"status": "PASS"}, "other": {"status": "PASS"}}}
rng = random.Random(765)
for _ in range(200):
    pairs = [(a, trial_verdict(rng.uniform(.1, 2), rng.choice(grid)), trial_verdict(.5, rng.choice(grid)))
             for a in ('R', 'W1', 'W2')]
    ranges = mc.finalist_grid_ranges(pairs, grid)
    for i, t in enumerate(grid):
        verdicts = {a: 'PASS' if first['stats']['m'] >= J.THRESHOLD and first['stats']['t'] >= t else 'FAIL'
                    for a, first, second in pairs}
        sel = J.select(verdicts, {a: 'superiority' for a, _, _ in pairs}, {a: first['stats']['m'] for a, first, _ in pairs})
        actual = any(a in (sel['F'], sel['F2']) and second['stats']['t'] >= t for a, _, second in pairs)
        assert actual == any(lo <= i < hi for lo, hi in ranges), (pairs, t, ranges, sel)
# Third ranked arm passes stage 2, but the selected F/F2 fail: cannot ship it.
pairs = [('R', trial_verdict(3, 2), trial_verdict(.5, .7)),
         ('W1', trial_verdict(2, 2), trial_verdict(.5, .7)),
         ('W2', trial_verdict(1, 2), trial_verdict(.5, 2))]
assert mc.finalist_grid_ranges(pairs, [.94]) == []
report(True, 'three-arm calibration grid matches judge selector, including third-arm exclusion and exact boundaries')
print("MC %s" % ("OK" if not bad else "FAILED"))
sys.exit(1 if bad else 0)
EOF

cat > "$T/real.py" <<'EOF'
import copy, glob, hashlib, json, os, subprocess, sys
J, T, R = sys.argv[1], sys.argv[2], sys.argv[3]
labels = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(R, "*", "matrix.json"))
                if os.path.isfile(os.path.join(os.path.dirname(p), "standings.json")))
if len(labels) < 2:
    print("REAL BLOCKED: fewer than 2 matrices with standings.json under %s" % R)
    sys.exit(2)
bad = 0
def run(args):
    return subprocess.run([sys.executable, "-B", "-I", J] + args, capture_output=True, text=True)
def sha(p):
    with open(p, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()
p = run(["validate"] + [os.path.join(R, l) for l in labels])
ok = p.returncode == 0 and ("VALIDATE PASS: %d/%d" % (len(labels), len(labels))) in p.stdout
print("%-4s validate %d real matrices (%s): exit %d, %s" % ("ok" if ok else "FAIL", len(labels), " ".join(labels), p.returncode, p.stdout.strip().splitlines()[-1]))
bad += not ok
# corrupted copies of the first label: each must be caught
src = os.path.join(R, labels[0])
with open(os.path.join(src, "matrix.json")) as fh:
    m0 = json.load(fh)
with open(os.path.join(src, "standings.json")) as fh:
    s0 = fh.read()
def corrupt(name, fn, keep_standings=True, want=1):
    global bad
    d = os.path.join(T, "corrupt-" + name)
    os.makedirs(d)
    m = copy.deepcopy(m0)
    fn(m)
    with open(os.path.join(d, "matrix.json"), "w") as fh:
        json.dump(m, fh)
    if keep_standings:
        with open(os.path.join(d, "standings.json"), "w") as fh:
            fh.write(s0)
    p = run(["validate", d])
    ok = p.returncode == want
    print("%-4s validate catches %-30s exit %d (want %d)" % ("ok" if ok else "FAIL", name + ":", p.returncode, want))
    bad += not ok
def pnl_plus_one(m):
    a = [a for a in m["scenarios"][0]["agents"] if not a.get("baseline")][0]
    a["pnlUsdc"] += 1.0
def noop_unflagged(m):
    for sc in m["scenarios"]:
        for a in sc["agents"]:
            if a.get("baseline"):
                del a["baseline"]
corrupt("one P moved by 1 USDC", pnl_plus_one)
corrupt("baseline flag removed", noop_unflagged)
corrupt("standings.json missing", lambda m: None, keep_standings=False, want=2)
# real null: ascon-zeta-r3 (as R) vs ascon-zeta-r2 (as B), identical code. The seeds (202-606) and the
# rosters (clone fields) are not the plan's, so the manifest declares them and the run needs
# --allow-nonplan-design; without the flag judge2 must refuse it.
seeds = (202, 303, 404, 505, 606)
need = ["%s%d" % (f, s) for f in "QA" for s in seeds]
if not all(l in labels for l in need):
    print("REAL BLOCKED: r3-vs-r2 null needs %s" % " ".join(need))
    sys.exit(2 if not bad else 1)
cells, expect = [], {}
for l in need:
    with open(os.path.join(R, l, "matrix.json")) as fh:
        m = json.load(fh)
    with open(os.path.join(R, l, "standings.json")) as fh:
        st = json.load(fh)
    score = {a["id"]: a["scoreRaw"] for a in st["agents"]}
    field, seed = ("FP" if l[0] == "Q" else "FD"), int(l[1:])
    paths = {}
    for arm, (as_slot, as_twin) in {"B": ("ascon-zeta-r2", "ascon-zeta-r3"), "R": ("ascon-zeta-r3", "ascon-zeta-r2"),
                                    "B'": ("ascon-zeta-r2", "ascon-zeta-r3"), "C1": ("ascon-zeta-r2", "ascon-zeta-r3")}.items():
        mm = copy.deepcopy(m)
        for sc in mm["scenarios"]:
            sc["runDir"] = sc["runDir"] + "-" + arm.replace("'", "p")
            for a in sc["agents"]:
                if a["id"] == as_slot:
                    a["id"] = "slot"
                elif a["id"] == as_twin:
                    a["id"] = "twin"
        p = os.path.join(T, "null-%s-%s.json" % (l, arm.replace("'", "p")))
        with open(p, "w") as fh:
            json.dump(mm, fh)
        paths[arm] = p
    expect["%s#%d" % (field, seed)] = {"R": score["ascon-zeta-r3"], "B": score["ascon-zeta-r2"]}
    cells.append({"seed": seed, "field": field, "arms": paths})
man = os.path.join(T, "null-manifest.json")
with open(man, "w") as fh:
    json.dump({"candidates": {"R": "superiority", "C1": "noninferiority"}, "cells": cells,
               "design": {"seeds": list(seeds), "rosters": "unchecked"}}, fh)
rep = os.path.join(T, "null-step2.txt")
with open(rep, "w") as fh:
    fh.write("no Step 2 report: C1 is a copy of B\n")
mj = {"B": {"tie_win_rate": 0.5}, "R": {"slot_timeouts": 0, "p99_decide_ms": 1, "tie_win_rate": 0.5, "stf": 0},
      "C1": {"slot_timeouts": 0, "p99_decide_ms": 1, "tie_win_rate": 0.5, "stf": 0, "step2_mechanism": "PASS",
             "step2_report": {"path": rep, "sha256": sha(rep)}}}
for arm in mj:
    mj[arm]["matrices_sha256"] = sorted(sha(c["arms"][arm]) for c in cells)
mech = os.path.join(T, "null-mech.json")
with open(mech, "w") as fh:
    json.dump({"arms": mj}, fh)
out = os.path.join(T, "null-verdict.json")
p = run(["judge", "--manifest", man, "--mechanism", mech, "--out", out + ".refused"])
ok = p.returncode == 2 and "not the plan's" in p.stderr and not os.path.exists(out + ".refused")
print("%-4s real null without --allow-nonplan-design is refused: exit %d (%s)" % ("ok" if ok else "FAIL", p.returncode, p.stderr.strip()[:110]))
bad += not ok
p = run(["judge", "--manifest", man, "--mechanism", mech, "--out", out, "--allow-nonplan-design"])
print(p.stdout.rstrip())
if p.returncode != 0:
    print("FAIL real null: judge2 exit %d: %s" % (p.returncode, p.stderr.strip()[-300:]))
    sys.exit(1)
with open(out) as fh:
    v = json.load(fh)
r = v["candidates"]["R"]
ok = r["verdict"] != "PASS" and v["candidates"]["C1"]["verdict"] == "PASS" and v["nonplan"]
print("%-4s real r3-vs-r2 null: R %s (must not PASS; m %+.3f t %+.3f), C1 (= B copy) %s, non-plan recorded: %s" % (
    "ok" if ok else "FAIL", r["verdict"], r["stats"]["m"], r["stats"]["t"], v["candidates"]["C1"]["verdict"], "; ".join(v["nonplan"])))
bad += not ok
worst = 0.0
for row in v["cells"]:
    key = "%s#%d" % (row["field"], row["seed"])
    for arm in ("R", "B"):
        worst = max(worst, abs(row["arms"][arm]["official"] - expect[key][arm]))
ok = worst <= 1e-9
print("%-4s judge2 per-arm official score = standings.json scoreRaw of r3 / r2 on 10 matrices: max|err| %.2e" % ("ok" if ok else "FAIL", worst))
bad += not ok
print("REAL %s" % ("OK" if not bad else "FAILED"))
sys.exit(1 if bad else 0)
EOF

cat > "$T/calibrate.py" <<'EOF'
import concurrent.futures as cf, copy, hashlib, itertools, json, math, os, subprocess, sys
# Plan Step 4 calibration of judge2 against mc.py on real data. Resamples the identical-code pair
# ascon-zeta-r3 / ascon-zeta-r2 (Q = FP proxy, A = FD proxy, seeds 202-606): every 4-of-5 seed subset x
# which twin plays R in each seed (5 x 16 = 80 stage-1 manifests); B' and C1 are copies of B (so f sits on
# the 0.25 floor), R's slot gets +delta T in every epoch (P solved per epoch). Each manifest goes through
# the judge2 CLI at the approved +0.2 floor. mc.py predicts the same stage-1 PASS rate from a
# noise file built from the same 10 matrices (empirical draw, tau 0, rho 0, placebo scale 0).
# Checks: null PASS rate <= alpha + 5pt = 0.15; |judge - MC| <= 0.10 at +0.5 and +1.0. Negative controls:
# the comparator must FAIL when judge's +1.0 rates are held against MC's 0.0 prediction, and the null
# check must FAIL on judge's +1.0 rates. Fewer than MIN_K resamples: BLOCKED.
J, MC, R, W = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
SIMS = int(sys.argv[5]) if len(sys.argv) > 5 else 4000
SEEDS = [202, 303, 404, 505, 606]
EFFECTS = [0.0, 0.5, 1.0]
POL = {"approved": 0.2}
MIN_K, TOL, NULL_MAX = 40, 0.10, 0.15
A3, A2 = "ascon-zeta-r3", "ascon-zeta-r2"
labels = {(s, f): "%s%d" % ("Q" if f == "FP" else "A", s) for s in SEEDS for f in ("FP", "FD")}
if not all(os.path.isfile(os.path.join(R, l, "matrix.json")) for l in labels.values()):
    print("CALIBRATE BLOCKED: needs %s" % " ".join(sorted(labels.values())))
    sys.exit(2)
os.makedirs(W, exist_ok=True)
src = {k: json.load(open(os.path.join(R, l, "matrix.json"))) for k, l in labels.items()}

def sha(p):
    with open(p, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()

def tz(ps, i):
    mu = sum(ps) / len(ps)
    sd = math.sqrt(sum((p - mu) ** 2 for p in ps) / len(ps))
    return 50 + 10 * (ps[i] - mu) / sd

def inject(sc, delta):
    pop = [a for a in sc["agents"] if not a.get("baseline") and "pnlUsdc" in a]
    i = [k for k, a in enumerate(pop) if a["id"] == "slot"][0]
    ps = [a["pnlUsdc"] for a in pop]
    target = tz(ps, i) + delta
    lo, hi = ps[i] - 1e8, ps[i] + 1e8
    for _ in range(70):
        mid = (lo + hi) / 2
        ps[i] = mid
        if tz(ps, i) < target:
            lo = mid
        else:
            hi = mid
    pop[i]["pnlUsdc"] = (lo + hi) / 2

def arm_file(key, slot_id, twin_id, tag, delta):
    p = os.path.join(W, "%s%d-%s-%s-%s.json" % (key[1], key[0], slot_id[-2:], tag, delta))
    if os.path.isfile(p):
        return p
    m = copy.deepcopy(src[key])
    for sc in m["scenarios"]:
        sc["runDir"] = sc["runDir"] + "-" + tag
        for a in sc["agents"]:
            if a["id"] == slot_id:
                a["id"] = "slot"
            elif a["id"] == twin_id:
                a["id"] = "twin"
        if delta and sc["regime"] != "launch":
            inject(sc, delta)
    with open(p, "w") as fh:
        json.dump(m, fh)
    return p

rep = os.path.join(W, "step2-report.txt")
with open(rep, "w") as fh:
    fh.write("calibration: no Step 2 report (C1 is a copy of B)\n")
jobs = []
for subset in itertools.combinations(SEEDS, 4):
    for signs in itertools.product((1, -1), repeat=4):
        for delta in EFFECTS:
            cells = []
            for s, sg in zip(subset, signs):
                r_id, b_id = (A3, A2) if sg > 0 else (A2, A3)
                for f in ("FP", "FD"):
                    k = (s, f)
                    cells.append({"seed": s, "field": f, "arms": {
                        "B": arm_file(k, b_id, r_id, "B", 0.0), "B'": arm_file(k, b_id, r_id, "Bp", 0.0),
                        "C1": arm_file(k, b_id, r_id, "C1", 0.0), "R": arm_file(k, r_id, b_id, "R", delta)}})
            name = "m-%s-%s-%s" % ("".join(str(s)[0] for s in subset), "".join("p" if x > 0 else "n" for x in signs), delta)
            man = os.path.join(W, name + ".json")
            with open(man, "w") as fh:
                json.dump({"candidates": {"R": "superiority", "C1": "noninferiority"}, "cells": cells,
                           "design": {"seeds": list(subset), "rosters": "unchecked"}}, fh)
            mech = {"B": {"tie_win_rate": 0.5}, "R": {"slot_timeouts": 0, "p99_decide_ms": 1, "tie_win_rate": 0.5, "stf": 0},
                    "C1": {"slot_timeouts": 0, "p99_decide_ms": 1, "tie_win_rate": 0.5, "stf": 0, "step2_mechanism": "PASS",
                           "step2_report": {"path": rep, "sha256": sha(rep)}}}
            mech["R"]["tagged_mechanism_pnl"] = {"%s#%s" % (c["field"], c["seed"]): {sc["regime"]: 0.0 for sc in src[(c["seed"], c["field"])]["scenarios"]} for c in cells}
            for arm in mech:
                mech[arm]["matrices_sha256"] = sorted({sha(c["arms"][arm]) for c in cells})
            mp = os.path.join(W, name + "-mech.json")
            with open(mp, "w") as fh:
                json.dump({"arms": mech}, fh)
            for pol, thr in POL.items():
                jobs.append((delta, pol, man, mp, os.path.join(W, "%s-%s-v.json" % (name, pol)), thr))

def judge(job):
    delta, pol, man, mp, out, thr = job
    p = subprocess.run([sys.executable, "-B", "-I", J, "judge", "--manifest", man, "--mechanism", mp, "--out", out,
                        "--threshold", str(thr), "--allow-nonplan-design"], capture_output=True, text=True)
    if p.returncode != 0:
        return job, None, p.stderr.strip()[-200:]
    v = json.load(open(out))
    return job, v, None

res = {}
errors = []
with cf.ThreadPoolExecutor(max_workers=6) as ex:
    for job, v, err in ex.map(judge, jobs):
        if v is None:
            errors.append(err)
            continue
        r = v["candidates"]["R"]
        res.setdefault((job[0], job[1]), []).append((r["verdict"], r.get("stats", {}).get("m"), r.get("d_ew_by_cell", {}), job[2]))
if errors:
    print("CALIBRATE BLOCKED: %d judge2 run(s) failed, first: %s" % (len(errors), errors[0]))
    sys.exit(2)
K = len(res[(0.0, "approved")])
bad = 0
# injection self-check: R's per-cell d_EW moves by exactly delta between the 0.0 and the delta manifests
base = {x[3].replace("-0.0.json", ""): x[2] for x in res[(0.0, "approved")]}
worst = 0.0
for delta in EFFECTS[1:]:
    for x in res[(delta, "approved")]:
        b = base[x[3].replace("-%s.json" % delta, "")]
        worst = max(worst, max(abs(x[2][c] - b[c] - delta) for c in b))
ok = worst <= 1e-6
print("%-4s injection moves R's per-cell EW contrast by exactly delta: max|err| %.1e over %d manifests" % ("ok" if ok else "FAIL", worst, 2 * K))
bad += not ok
rate = {k: sum(1 for x in v if x[0] == "PASS") / len(v) for k, v in res.items()}
# MC prediction from the same matrices
noise = os.path.join(W, "noise.json")
args = [sys.executable, "-B", "-I", MC, "build-noise", "--pair", "%s:%s" % (A3, A2), "--out", noise]
for (s, f), l in sorted(labels.items()):
    args += ["--matrix", "%s=%s" % (f, os.path.join(R, l))]
p = subprocess.run(args, capture_output=True, text=True)
if p.returncode != 0:
    print("CALIBRATE BLOCKED: build-noise failed: %s" % p.stderr[-200:])
    sys.exit(2)
nz = json.load(open(noise))
nz["placebo"] = {"placeholder": False, "scale": 0.0}
with open(noise, "w") as fh:
    json.dump(nz, fh)
mcj = os.path.join(W, "mc.json")
p = subprocess.run([sys.executable, "-B", "-I", MC, "run", "--noise", noise, "--draw", "empirical", "--tau", "0", "--rho", "0",
                    "--sims", str(SIMS), "--effects", ",".join(str(e) for e in EFFECTS), "--json", mcj], capture_output=True, text=True)
if p.returncode != 0:
    print("CALIBRATE BLOCKED: mc.py run failed: %s" % p.stderr[-200:])
    sys.exit(2)
mc = json.load(open(mcj))["results"]
pred = {(float(e), pol): mc[str(float(e))][pol]["s1_R"] for e in EFFECTS for pol in POL}

def compare(judge_rates, mc_rates, pairs):
    """-> (PASS|FAIL, rows) for |judge - MC| <= TOL on each (judge key, MC key) pair."""
    rows, verdict = [], "PASS"
    for jk, mk in pairs:
        d = judge_rates[jk] - mc_rates[mk]
        rows.append("%s %s: judge2 %.3f vs MC %.3f (%+.3f)" % (jk[0], jk[1], judge_rates[jk], mc_rates[mk], d))
        if abs(d) > TOL:
            verdict = "FAIL"
    return verdict, rows

def null_check(judge_rates, keys):
    worst = max(judge_rates[k] for k in keys)
    return ("PASS" if worst <= NULL_MAX else "FAIL"), worst

print("     K = %d resampled stage-1 manifests per effect (correlated: 5 seeds, 2 roles); MC %d sims" % (K, SIMS))
for pol in POL:
    print("     %-6s judge2 PASS rate: %s | MC s1_R: %s" % (pol, "  ".join("%+.1f %.3f" % (e, rate[(e, pol)]) for e in EFFECTS),
                                                       "  ".join("%+.1f %.3f" % (e, pred[(e, pol)]) for e in EFFECTS)))
if K < MIN_K:
    print("CALIBRATE BLOCKED: K %d < %d" % (K, MIN_K))
    sys.exit(2)
v, w = null_check(rate, [(0.0, p) for p in POL])
print("%-4s null PASS rate <= alpha + 5pt = %.2f: worst %.3f -> %s" % ("ok" if v == "PASS" else "FAIL", NULL_MAX, w, v))
bad += v != "PASS"
v, rows = compare(rate, pred, [((e, p), (e, p)) for e in EFFECTS[1:] for p in POL])
print("%-4s injected +0.5/+1.0 PASS rates within MC +-%.2f -> %s" % ("ok" if v == "PASS" else "FAIL", TOL, v))
for r in rows:
    print("       " + r)
bad += v != "PASS"
# negative controls: the two checks must trip on wrong inputs
v, rows = compare(rate, pred, [((1.0, p), (0.0, p)) for p in POL])
print("%-4s negative control: judge +1.0 held against MC 0.0 must FAIL -> %s" % ("ok" if v == "FAIL" else "FAIL", v))
bad += v != "FAIL"
v, w = null_check(rate, [(1.0, p) for p in POL])
print("%-4s negative control: null check on judge's +1.0 rates must FAIL -> %s (worst %.3f)" % ("ok" if v == "FAIL" else "FAIL", v, w))
bad += v != "FAIL"
print("CALIBRATE %s" % ("OK" if not bad else "FAILED"))
sys.exit(1 if bad else 0)
EOF

mkdir -p "$T/syn" "$T/mc" "$T/cal" || exit 2
python3 -B -I "$T/synthetic.py" "$J" "$T/syn"
rc_syn=$?
python3 -B -I "$T/mccheck.py" "$MC" "$T/mc" "$T/syn/saved.json"
rc_mc=$?
if [ -z "$real" ]; then
  echo "REAL / CALIBRATE SKIPPED: optional saved-matrix checks; no REAL_DIR supplied"
  rc_real=0
  rc_cal=0
else
  python3 -B -I "$T/real.py" "$J" "$T" "$real"
  rc_real=$?
  python3 -B -I "$T/calibrate.py" "$J" "$MC" "$real" "$T/cal" 4000
  rc_cal=$?
fi
if [ "$rc_syn" -eq 0 ] && [ "$rc_mc" -eq 0 ] && [ "$rc_real" -eq 0 ] && [ "$rc_cal" -eq 0 ]; then
  echo "ALL_CONTROLS_OK"
  exit 0
fi
if [ "$rc_syn" -eq 1 ] || [ "$rc_mc" -eq 1 ] || [ "$rc_real" -eq 1 ] || [ "$rc_cal" -eq 1 ]; then
  echo "CONTROLS_FAILED (synthetic rc $rc_syn, mc rc $rc_mc, real rc $rc_real, calibration rc $rc_cal)"
  exit 1
fi
echo "CONTROLS_BLOCKED (synthetic rc $rc_syn, mc rc $rc_mc, real rc $rc_real, calibration rc $rc_cal)"
exit 2
