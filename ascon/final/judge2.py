#!/usr/bin/env python3
"""Final plan (2026-10-23, U4 approved): Step 6 / Step 7 / chapter 4.

CLI: judge --manifest M.json --mechanism MECH.json [--stage 1|2|retest]
     [--stage1-verdict V1.json | --stage2-verdict V2.json] [--out V.json] [--json]
     validate <matrix.json or matrix directory> ...

Arms: explicit --arms LABEL=agent-dir (or manifest arm_map), with B/B' required.
Stage 1 has R, W1, W2 and exploratory X1/X2/X3; no implicit C1.
Legacy explicitly requested C1 noninferiority remains supported. Stage 1 uses seeds 1003-1006, or the late-R set 1007-1010;
stage 2 uses 1011-1014 for both F and F2, plus FS seeds 1101-1102. Retest combines
stage 2 with 1021-1024. FS covers launch, cdp-incident and lending-incident.

R/W: d = EW11(candidate)-EW11(B), excluding launch. Pair FP/FD within seed;
m = mean(c), f = max(0.25, sample_sd(placebo c)), SE = max(sample_sd(c), f)/sqrt(n).
Stage 1 requires t >= 0.94 and m >= +0.20, with NO ask band (U4 approved).
Stage 2 uses stage-1 f, t >= 0.94 and m > 0. With fewer than four paired seeds,
t uses the stricter t(n-1) critical value. Other clauses:
2: mean(d_f) + 1.64*sd(d_f)/2 >= -0.5 FD / -0.25 FP (non-launch).
3: non-launch regime mean <= -3 and >=75% negative (6/8 planned), AND the
candidate's OWN tagged mechanism PnL sum < 0. Nonnegative PnL is reported as
noise; missing attribution for such a regime is BLOCKED, never assumed zero.
4: fewer than two non-launch epochs with delta P < -3000 USDC.
5: timeouts 0, p99 < 500ms (null with a reason: NOT_MEASURED, advisory), tie-win difference <=10pt, STF 0; candidate slot
failures and rule flags count as FAIL, unknown flags BLOCKED.
6: launch mean over eight cells >= -3 T (STF 0 also required by clause 5).
C1: launch noninferiority and clause 5 only; stage 1 also needs the c1L (a)-(d)
report (STF 0, M1/M2 fills >= B, launch mean >= -3). No trap criterion (e).
FS: mean delta T >= -0.5 and no non-launch delta P < -3000. Retest reverts on
combined EW11 m <= 0 or mechanism failures. Selection ranks passing R/W by m,
then falls back to passing C1. No G0 gate. EW12 and official weighted values
are reported separately and never used for R/W superiority.

Mechanism JSON: {"arms": {"B": {"tie_win_rate": .54, "matrices_sha256": [...]},
"R": {"slot_timeouts": 0, "p99_decide_ms": 300, "tie_win_rate": .52, "stf": 0,
"matrices_sha256": [...], "tagged_mechanism_pnl": {"FP#1003": {"whale": -12.5}}},
"C1": {..., "step2_mechanism": "PASS", "step2_report": {"path": "...", "sha256": "..."}}}}
Tagged PnL is in USDC, summed over the candidate's own tagged trades (including
fees/reverts), NOT delta P against B. Supply every counted cell of a triggered
regime, including explicit zero for no trades. It shares matrix-hash provenance
with clause 5. C1 matrices may be launch-only or full matrices (only launch is
judged); B/B'/R/W use all 12 regimes in FP/FD. Reports label their actual scope.

Input guards retain the official standings replica, strict design/roster/setup
checks, unique files/runDirs, fail-closed missing data and infrastructure rerun
proofs. Exclusions require reason infra, evidence and a failed rerun {arm,path,
sha256}; they apply across arms, and whole-cell exclusions are checked against
the narrowest possible exclusion. Non-plan thresholds/designs require explicit
CLI flags and propagate through prior verdicts. Legacy ask bands are rejected.
Exit 0 means a verdict was produced, 2 means input rejected; validate exits 1
on a mismatch and 2 on unreadable inputs. No backtests are run by this tool.
"""
import argparse
import hashlib
import json
import math
import os
import sys

PASS, FAIL, BLOCKED = "PASS", "FAIL", "BLOCKED"
NOT_MEASURED = "NOT_MEASURED"
FIELDS = ("FP", "FD")
FS_FIELD = "FS"
LAUNCH = "launch"
REGIMES12 = ("calm", "cex-drift", "informed-flow", "whale", "lending-incident", "crash", "depeg", "vuln",
             "spike", "depeg-persist", "cdp-incident", "launch")
T_CRIT = 0.94  # post-freeze three-candidate whole-tree MC tightening; mean floor remains +0.20
T90 = {1: 3.078, 2: 1.886, 3: 1.638}  # one-sided 10% t quantiles; n >= 4 uses calibrated T_CRIT
PLACEBO_FLOOR = 0.25
THRESHOLD = 0.20
ASK_FLOOR = None
PLAN_THRESHOLDS = (0.20,)  # U4 approved 2026-10-23; no ask band
FIELD_FLOOR = {"FD": -0.50, "FP": -0.25}
REGIME_VETO_MEAN = -3.0
REGIME_VETO_SHARE = 0.75
BIG_LOSS_USDC = -3000.0
BIG_LOSS_MAX = 2  # fewer than this many
P99_MS = 500.0
TIE_PT = 0.10
FS_MEAN_FLOOR = -0.5
LAUNCH_FLOOR = -3.0
FS_REGIMES = ("launch", "cdp-incident", "lending-incident")
STAGES = ("1", "2", "retest")
PLAN_SEEDS = {"1": ((1003, 1004, 1005, 1006), (1007, 1008, 1009, 1010)),
              "2F": ((1011, 1012, 1013, 1014),), "2F2": ((1011, 1012, 1013, 1014),),
              "retest": ((1011, 1012, 1013, 1014, 1021, 1022, 1023, 1024),)}
FS_SEEDS = (1101, 1102)
# Flags (core/src/backtest/scenarioScores.ts) that mean an agent did not run its epoch to the end.
INFRA_FLAGS = ("process exited early:", "absent from summary.json", "no P in summary.json")
# Rule (2.6 / 8) and log-integrity flags (scenarioScores.ts scoresFromSummary, rosterTransfers.ts):
# prefixes, and parts of the count-led ones ("<n> on-chain tx(s) ...").
RULE_FLAGS = ("priority fee rule violation", "value moved between registered addresses")
RULE_FLAG_PARTS = ("on-chain tx(s) absent from the agent's submitted log", "address(es) the agent's wallet funded")
INFO_FLAGS = ("V_0 ",)  # issue #207 notes on how V_0 was taken
# The simulation setup every arm of a cell must share (core/src/backtest/resume.ts refuses to mix them).
SETUP_KEYS = ("schema", "sourceCommit", "scenarioKey.commitment", "scenarioStreams", "repeat", "resetUnit")
try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:  # run from stdin (validate only)
    HERE = None


# Explicit stage-1 identity map. Legacy manifests remain readable without adding C1.
DEFAULT_ARM_MAP = {"B": "opus-1", "B'": "opus-1-pb", "R": "opus-1r",
                   "W1": "opus-1g", "W2": "ascon-zeta-r3k", "X1": "opus-1g2",
                   "X2": "opus-1w", "X3": "ascon-zeta-r3kg"}
EXPLORATORY_DIRS = {"opus-1g2", "opus-1w", "ascon-zeta-r3kg"}


def parse_arm_map(items):
    import re
    result = {"B": "opus-1", "B'": "opus-1-pb"}
    seen = set()
    for item in items:
        for entry in item.split(","):
            label, sep, directory = entry.partition("=")
            if not sep or not (label in ("B", "B'") or re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", label)):
                raise ValueError("--arms requires LABEL=agent-dir")
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", directory):
                raise ValueError("invalid arm directory")
            if label in seen or (label in result and result[label] != directory):
                raise ValueError("duplicate or reserved arm label: " + label)
            seen.add(label)
            result[label] = directory
    if len(set(result.values())) != len(result):
        raise ValueError("arm directories must be unique")
    if len(result) <= 2:
        raise ValueError("need at least one candidate")
    return result


def resolve_arm_map(man, items=None):
    stored = man.get("arm_map")
    parsed = parse_arm_map([f"{k}={v}" for k, v in stored.items()]) if isinstance(stored, dict) else None
    if stored is not None and parsed is None:
        raise ValueError("arm_map must be an object")
    supplied = parse_arm_map(items) if items else None
    if supplied and parsed and supplied != parsed:
        raise ValueError("--arms differs from manifest arm_map")
    return supplied or parsed


def exploratory_arm(label, arm_map):
    return label.startswith("X") or (arm_map or {}).get(label) in EXPLORATORY_DIRS


# ---------------------------------------------------------------- official standings replica

def _fold(values):
    # JS `reduce((a, b) => a + b, 0)`: a plain left fold. Python 3.12's sum() compensates float error,
    # which would not reproduce the official numbers bit for bit.
    acc = 0.0
    for v in values:
        acc = acc + v
    return acc


def _mean(values):
    return _fold(values) / len(values)


def _pop_std(values, mu):
    return math.sqrt(_fold((v - mu) * (v - mu) for v in values) / len(values))


def round2(x):
    # sign * Math.round(|x| * 100 + 1e-9) / 100; Math.round = nearest integer, ties toward +infinity.
    sign = -1.0 if x < 0 else 1.0
    y = abs(x) * 100 + 1e-9
    r = math.floor(y)
    if y - r >= 0.5:
        r += 1
    return (sign * r) / 100


def weight_of(s, k):
    if not isinstance(s, int) or isinstance(s, bool) or s < 1:
        raise ValueError("epoch ordinal must be a positive integer (got %r)" % (s,))
    if not isinstance(k, int) or isinstance(k, bool) or k < 1:
        raise ValueError("k must be a positive integer (got %r)" % (k,))
    if s > k:
        raise ValueError("epoch ordinal %d exceeds k = %d" % (s, k))
    return 1 if k == 1 else 1 + (0.5 * (s - 1)) / (k - 1)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def compute_standings(matrix):
    """standings.ts computeStandings + deviationScore.ts scoreCompetition, from a parsed matrix.json."""
    k = matrix.get("k")
    results = matrix.get("scenarios")
    if not isinstance(results, list):
        raise ValueError("matrix.json has no scenarios list")
    inputs = []
    for r in results:
        agents = r.get("agents")
        if not agents:
            inputs.append({"s": r.get("s"), "pnl": {}, "bench": set(), "invalid": r.get("error") or "no summary.json"})
            continue
        pnl, bench = {}, set()
        for a in agents:
            if "pnlUsdc" not in a:
                continue
            pnl[a["id"]] = a["pnlUsdc"]
            if a.get("baseline"):
                bench.add(a["id"])
        inputs.append({"s": r.get("s"), "pnl": pnl, "bench": bench, "invalid": None})
    seen = set()
    epochs = []
    for e in sorted(inputs, key=lambda x: x["s"]):
        if e["s"] in seen:
            raise ValueError("epoch ordinal %r appears twice" % (e["s"],))
        seen.add(e["s"])
        w = weight_of(e["s"], k)
        bench_pnl, pop = {}, []
        for aid, p in e["pnl"].items():
            if not _num(p) or not math.isfinite(p):
                raise ValueError("epoch %r: P(%s) is not a finite number (%r)" % (e["s"], aid, p))
            if aid in e["bench"]:
                bench_pnl[aid] = p
            else:
                pop.append((aid, p))
        ep = {"s": e["s"], "w": w, "n": len(pop), "benchmarkPnl": bench_pnl, "mu": None, "sigma": None, "tByAgent": {}}
        if e["invalid"] is not None:
            ep.update(excluded="invalid", invalidReason=e["invalid"])
        elif not pop:
            ep["excluded"] = "empty"
        else:
            vals = [p for _, p in pop]
            mu = _mean(vals)
            sigma = _pop_std(vals, mu)
            ep.update(mu=mu, sigma=sigma)
            if sigma == 0:
                ep["excluded"] = "sigma-zero"
            else:
                ep["tByAgent"] = {aid: 50 + (10 * (p - mu)) / sigma for aid, p in pop}
        epochs.append(ep)
    S = [e["s"] for e in epochs if "excluded" not in e]
    by_agent = {}
    for e, src in zip(epochs, sorted(inputs, key=lambda x: x["s"])):
        if "excluded" in e:
            continue
        for aid, t in e["tByAgent"].items():
            by_agent.setdefault(aid, []).append({"s": e["s"], "pnl": src["pnl"][aid], "t": t, "w": e["w"]})
    for e, src in zip(epochs, sorted(inputs, key=lambda x: x["s"])):
        for aid in src["pnl"]:
            if aid not in e["benchmarkPnl"] and aid not in by_agent:
                by_agent[aid] = []
    agents = []
    for aid, lst in by_agent.items():
        if not lst:
            agents.append({"id": aid, "scoreRaw": None, "score": None, "epochs": [], "tStd": None, "worstT": None})
            continue
        sum_w = _fold(x["w"] for x in lst)
        raw = _fold(x["w"] * x["t"] for x in lst) / sum_w
        ts = [x["t"] for x in lst]
        agents.append({"id": aid, "scoreRaw": raw, "score": round2(raw), "epochs": lst,
                       "tStd": _pop_std(ts, _mean(ts)), "worstT": min(ts)})

    def key(a):  # §4.6 order; ids only order exact ties, which share a rank anyway
        if a["score"] is None:
            return (1, 0.0, 0.0, 0.0, a["id"])
        return (0, -a["score"], a["tStd"], -a["worstT"], a["id"])

    agents.sort(key=key)

    def same(a, b):
        if a["score"] is None or b["score"] is None:
            return a["score"] is None and b["score"] is None
        return a["score"] == b["score"] and a["tStd"] == b["tStd"] and a["worstT"] == b["worstT"]

    for i, a in enumerate(agents):
        a["tied"] = False
        if i > 0 and same(agents[i - 1], a):
            a["rank"] = agents[i - 1]["rank"]
            a["tied"] = agents[i - 1]["tied"] = True
        else:
            a["rank"] = i + 1
    regime_of = {r.get("s"): (r.get("regime"), r.get("seed")) for r in results}
    for e in epochs:
        e["regime"], e["seed"] = regime_of[e["s"]]
    return {"k": k, "S": S, "epochs": epochs, "agents": agents}


# ---------------------------------------------------------------- validate

def _close(a, b, tol):
    if a is None or b is None:
        return a is None and b is None, 0.0
    if not (_num(a) and _num(b)):
        return a == b, 0.0
    d = abs(a - b)
    return d <= tol, d


def compare_standings(mine, official, tol):
    """Returns (problems, max_abs_error) for a recomputed standings dict against standings.json."""
    probs, worst = [], 0.0

    def chk(label, a, b):
        nonlocal worst
        ok, d = _close(a, b, tol)
        worst = max(worst, d)
        if not ok:
            probs.append("%s: recomputed %r, standings.json %r" % (label, a, b))

    chk("k", mine["k"], official.get("k"))
    if list(mine["S"]) != list(official.get("S", [])):
        probs.append("S: recomputed %r, standings.json %r" % (mine["S"], official.get("S")))
    off_ep = {e.get("s"): e for e in official.get("epochs", [])}
    if set(off_ep) != {e["s"] for e in mine["epochs"]}:
        probs.append("epoch ordinals differ: %r vs %r" % (sorted(e["s"] for e in mine["epochs"]), sorted(off_ep)))
    for e in mine["epochs"]:
        o = off_ep.get(e["s"])
        if o is None:
            continue
        lab = "s=%s" % e["s"]
        for fld in ("w", "n", "mu", "sigma"):
            chk("%s %s" % (lab, fld), e[fld], o.get(fld))
        for fld in ("excluded", "regime", "seed"):
            if e.get(fld) != o.get(fld):
                probs.append("%s %s: recomputed %r, standings.json %r" % (lab, fld, e.get(fld), o.get(fld)))
        ot = o.get("tByAgent", {})
        if set(ot) != set(e["tByAgent"]):
            probs.append("%s tByAgent ids differ: %r" % (lab, sorted(set(ot) ^ set(e["tByAgent"]))))
        for aid, t in e["tByAgent"].items():
            if aid in ot:
                chk("%s T(%s)" % (lab, aid), t, ot[aid])
        ob = o.get("benchmarkPnl", {})
        if set(ob) != set(e["benchmarkPnl"]):
            probs.append("%s benchmark ids differ: %r vs %r" % (lab, sorted(e["benchmarkPnl"]), sorted(ob)))
        for aid, p in e["benchmarkPnl"].items():
            if aid in ob:
                chk("%s benchmark P(%s)" % (lab, aid), p, ob[aid])
    off_ag = {a.get("id"): a for a in official.get("agents", [])}
    if set(off_ag) != {a["id"] for a in mine["agents"]}:
        probs.append("agent ids differ: %r" % sorted(set(off_ag) ^ {a["id"] for a in mine["agents"]}))
    for a in mine["agents"]:
        o = off_ag.get(a["id"])
        if o is None:
            continue
        for fld in ("scoreRaw", "score", "tStd", "worstT", "rank"):
            chk("agent %s %s" % (a["id"], fld), a[fld], o.get(fld))
        if a["tied"] != o.get("tied"):
            probs.append("agent %s tied: recomputed %r, standings.json %r" % (a["id"], a["tied"], o.get("tied")))
        oe = o.get("epochs", [])
        if len(oe) != len(a["epochs"]):
            probs.append("agent %s: %d epochs recomputed, %d in standings.json" % (a["id"], len(a["epochs"]), len(oe)))
            continue
        for x, y in zip(a["epochs"], oe):
            for fld in ("s", "pnl", "t", "w"):
                chk("agent %s s=%s %s" % (a["id"], x["s"], fld), x[fld], y.get(fld))
    return probs, worst


def _matrix_paths(p):
    if os.path.isdir(p):
        return os.path.join(p, "matrix.json"), os.path.join(p, "standings.json")
    return p, os.path.join(os.path.dirname(p), "standings.json")


def cmd_validate(args):
    rows = []
    for p in args.paths:
        mpath, spath = _matrix_paths(p)
        row = {"matrix": mpath}
        try:
            with open(mpath) as f:
                matrix = json.load(f)
            with open(spath) as f:
                official = json.load(f)
        except (OSError, ValueError) as e:
            row.update(status=BLOCKED, problems=["unreadable: %s" % e])
            rows.append(row)
            continue
        try:
            mine = compute_standings(matrix)
        except (ValueError, TypeError, KeyError) as e:
            row.update(status="MISMATCH", problems=["official arithmetic refused the matrix: %s" % e], max_abs_error=None)
            rows.append(row)
            continue
        probs, err = compare_standings(mine, official, args.tol)
        n_t = sum(len(e["tByAgent"]) for e in mine["epochs"])
        row.update(status="MATCH" if not probs else "MISMATCH", max_abs_error=err, problems=probs[:20],
                   n_problems=len(probs), epochs=len(mine["epochs"]), k=mine["k"], agents=len(mine["agents"]), t_values=n_t)
        rows.append(row)
    statuses = [r["status"] for r in rows]
    worst_rc = 1 if "MISMATCH" in statuses else 2 if BLOCKED in statuses else 0
    if args.json:
        print(json.dumps({"tolerance": args.tol, "matrices": rows}, indent=1))
    else:
        for r in rows:
            if r["status"] == "MATCH":
                print("MATCH    %s  epochs %d k %d agents %d T-values %d  max|err| %.2e" % (
                    r["matrix"], r["epochs"], r["k"], r["agents"], r["t_values"], r["max_abs_error"]))
            else:
                print("%-8s %s" % (r["status"], r["matrix"]))
                for p in r["problems"]:
                    print("   " + p)
        n_ok = sum(r["status"] == "MATCH" for r in rows)
        print("VALIDATE %s: %d/%d match within %g" % ("PASS" if n_ok == len(rows) and rows else "FAIL", n_ok, len(rows), args.tol))
    return worst_rc if rows else 2


# ---------------------------------------------------------------- statistics core (shared with mc.py)

def mean(xs):
    # Stable statistical means; official standings keep their separate JS-order _mean.
    return math.fsum(xs) / len(xs)


def sample_sd(xs):
    if len(xs) < 2:
        return None
    mu = mean(xs)
    return math.sqrt(_fold((x - mu) * (x - mu) for x in xs) / (len(xs) - 1))


def t_crit_for(n):
    # Four or more seeds use the whole-tree MC calibration. Only incomplete
    # designs retain the stricter small-sample guard (not a hidden df=3 clamp).
    return max(T_CRIT, T90.get(n - 1, 0.0)) if n < 4 else T_CRIT


def seed_contrasts(cells):
    """cells: {(seed, field): {"ew": d, ...}} -> (paired seeds, c_s list, per-field mean d). FP/FD only."""
    seeds = sorted({s for s, f in cells if f in FIELDS})
    paired = [s for s in seeds if all((s, f) in cells for f in FIELDS)]
    c = [(cells[(s, "FP")]["ew"] + cells[(s, "FD")]["ew"]) / 2 for s in paired]
    dbar = {}
    for f in FIELDS:
        v = [cells[(s, f)]["ew"] for s in seeds if (s, f) in cells]
        dbar[f] = mean(v) if v else None
    return paired, c, dbar


def t_statistic(c, placebo_c=None, f_override=None):
    """m, sd(c), f, SE, t for seed contrasts c; f = max(0.25, sd(placebo c)) unless f_override."""
    n = len(c)
    out = {"n": n, "m": mean(c) if c else None, "sd": sample_sd(c), "f": None, "se": None, "t": None,
           "divisor": math.sqrt(n) if n else None, "t_crit": t_crit_for(n) if n >= 2 else None}
    if f_override is not None:
        out["f"] = f_override
    elif placebo_c is not None and len(placebo_c) >= 2:
        out["f"] = max(PLACEBO_FLOOR, sample_sd(placebo_c))
    if n >= 2 and out["f"] is not None:
        out["se"] = max(out["sd"], out["f"]) / math.sqrt(n)
        out["t"] = out["m"] / out["se"]
    return out


def placebo_check(pc):
    """B' - B judged as clause 1 judges a candidate. Plan Step 6 records B''s t; this is a report, not a
    clause: OK, WARN (t' >= t_crit) or UNAVAILABLE. It never changes a verdict."""
    ps = t_statistic(pc or [], pc)
    if ps["t"] is None:
        return {"status": "UNAVAILABLE", "m": ps["m"], "t": None, "detail": "placebo contrasts on %d seed(s); need >= 2" % ps["n"]}
    if ps["t"] >= ps["t_crit"]:
        return {"status": "WARN", "m": ps["m"], "t": ps["t"], "detail": "B' - B has m' %+.3f t' %.3f >= %.3f: a shared offset (arm "
                "order, lane, timing, a stale B run) would pass into every candidate; report it to the user (not a "
                "clause: the verdicts stand)" % (ps["m"], ps["t"], ps["t_crit"])}
    return {"status": "OK", "m": ps["m"], "t": ps["t"], "detail": "B' - B m' %+.3f t' %.3f < %.3f" % (ps["m"], ps["t"], ps["t_crit"])}


def _combine(clauses):
    stat = [x["status"] for x in clauses.values()]
    return FAIL if FAIL in stat else BLOCKED if BLOCKED in stat else PASS


def decision_cells(cells, launch_only=False):
    """Derive the statistic from regime contrasts; never trust a caller's cached EW."""
    out = {}
    for key, cell in cells.items():
        vals = [v[0] for r, v in cell["regimes"].items()
                if (r == LAUNCH if launch_only else r != LAUNCH)]
        if vals:
            out[key] = dict(cell, ew=mean(vals))
    return out


def launch_clause(cells):
    vals = [v["regimes"][LAUNCH][0] for k, v in cells.items()
            if k[1] in FIELDS and LAUNCH in v["regimes"]]
    if not vals or len(vals) != len(cells):
        return {"status": BLOCKED, "detail": "launch contrast missing in a counted cell"}
    m = mean(vals)
    return {"status": PASS if m >= LAUNCH_FLOOR else FAIL,
            "mean_dT": m, "cells": len(vals),
            "detail": "launch mean %+.3f >= %.1f over %d cells; STF checked in clause 5" % (m, LAUNCH_FLOOR, len(vals))}


def evaluate(rule, cells, placebo_cells=None, mechanism_subs=None, threshold=THRESHOLD, ask_floor=None,
             f_override=None, strict_mean=False):
    """Step 6. Cells carry regime (delta T, delta P), plus optional own mechanism_pnl.
    R/W use EW11; C1 uses launch only. All consumers, including MC, use this path."""
    if ask_floor is not None:
        raise ValueError("U4 approved: no ask band")
    main = {k: v for k, v in cells.items() if k[1] in FIELDS}
    paired, c, dbar = seed_contrasts(decision_cells(main, rule == "noninferiority"))
    pc = seed_contrasts(decision_cells(placebo_cells))[1] if placebo_cells else None
    st = t_statistic(c, pc, f_override)
    clauses, table = {}, {}
    if rule == "superiority":
        if st["n"] < 2 or st["t"] is None:
            clauses["1_mean_t"] = {"status": BLOCKED, "detail": "need >=2 paired seeds and a defined placebo f"}
        else:
            above = st["m"] > threshold if strict_mean else st["m"] >= threshold
            clauses["1_mean_t"] = {"status": PASS if st["t"] >= st["t_crit"] and above else FAIL,
                "detail": "EW11 m %+.3f t %.3f (need t >= %.3f and m %s %.2f; no ask band)" %
                          (st["m"], st["t"], st["t_crit"], ">" if strict_mean else ">=", threshold)}
        bounds = {}
        dc = decision_cells(main)
        for f in FIELDS:
            vals = [v["ew"] for k, v in dc.items() if k[1] == f]
            sd = sample_sd(vals)
            bounds[f] = None if sd is None else mean(vals) + 1.64 * sd / 2
        clauses["2_field_means"] = {
            "status": BLOCKED if None in bounds.values() else PASS if all(bounds[f] >= FIELD_FLOOR[f] for f in FIELDS) else FAIL,
            "bounds": bounds, "detail": "EW11 mean + 1.64*sd/2: %s; floors %s" % (bounds, FIELD_FLOOR)}
        per_regime = {}
        for key, cell in sorted(main.items()):
            for r, (dt, _) in cell["regimes"].items():
                per_regime.setdefault(r, []).append((key, dt))
        vetoed, noise, unknown = [], [], []
        for r, vals in sorted(per_regime.items()):
            mu, neg = mean([x for _, x in vals]), sum(x < 0 for _, x in vals)
            triggered = r != LAUNCH and mu <= REGIME_VETO_MEAN and neg >= math.ceil(REGIME_VETO_SHARE * len(vals) - 1e-12)
            rec = table[r] = {"cells": len(vals), "mean_dT": mu, "negative": neg, "attribution": "not_triggered"}
            if triggered:
                pnl = [main[k].get("mechanism_pnl", {}).get(r) for k, _ in vals]
                if not all(_num(x) and math.isfinite(x) for x in pnl):
                    rec["attribution"] = "missing"
                    unknown.append(r)
                else:
                    rec["own_mechanism_pnl"] = total = _fold(pnl)
                    rec["attribution"] = "veto" if total < 0 else "noise"
                    (vetoed if total < 0 else noise).append(r)
        clauses["3_regime_veto"] = {"status": FAIL if vetoed else BLOCKED if unknown else PASS,
            "detail": "own-mechanism veto: %s; noise: %s; missing attribution: %s" %
                      (", ".join(vetoed) or "none", ", ".join(noise) or "none", ", ".join(unknown) or "none")}
        big = _big_losses(main)
        clauses["4_big_losses"] = {"status": PASS if len(big) < BIG_LOSS_MAX else FAIL,
            "detail": "%d non-launch epoch(s) with dP < %.0f%s" % (len(big), BIG_LOSS_USDC, (": " + "; ".join(big)) if big else "")}
    subs = mechanism_subs if mechanism_subs is not None else {"mechanism": {"status": BLOCKED, "detail": "not supplied"}}
    clauses["5_mechanism"] = {"status": _combine(subs), "subclauses": subs}
    clauses["6_launch"] = launch_clause(main)
    return {"rule": rule, "verdict": _combine(clauses), "clauses": clauses,
            "stats": dict(st, statistic="launch" if rule == "noninferiority" else "EW11",
                          seeds=paired, c=c, dbar_FP=dbar["FP"], dbar_FD=dbar["FD"], placebo_c=pc),
            "placebo_check": placebo_check(pc) if placebo_cells else None, "regimes": table}


def _big_losses(cells):
    big = []
    for (s, f) in sorted(cells):
        for r, (_, dp) in sorted(cells[(s, f)]["regimes"].items()):
            if r != LAUNCH and dp < BIG_LOSS_USDC:
                big.append("%s#%s %s dP %+.0f" % (f, s, r, dp))
    return big


def fs_clause(fs_cells):
    """Stage 2's F_S condition: mean d >= -0.5 over the FS cells and no non-launch FS epoch with dP < -3000."""
    if not fs_cells:
        return {"status": BLOCKED, "detail": "no FS cells"}
    md = mean([mean([dt for dt, _ in v["regimes"].values()]) for _, v in sorted(fs_cells.items())])
    big = _big_losses(fs_cells)
    ok = md >= FS_MEAN_FLOOR and not big
    return {"status": PASS if ok else FAIL, "detail": "FS mean d %+.3f (>= %.2f) over %d cell(s); %d non-launch epoch(s) with dP < %.0f%s" % (
        md, FS_MEAN_FLOOR, len(fs_cells), len(big), BIG_LOSS_USDC, (": " + "; ".join(big)) if big else "")}


def noop_clause(cells):
    """No regime where B >= noop but the candidate < noop, using regime mean T gaps."""
    rows = {}
    for cell in cells.values():
        for r in cell["regimes"]:
            pair = cell.get("noop_gaps", {}).get(r)
            if not (isinstance(pair, (tuple, list)) and len(pair) == 2 and
                    all(_num(x) and math.isfinite(x) for x in pair)):
                return {"status": BLOCKED, "detail": "noop comparison missing for " + r}
            rows.setdefault(r, []).append(pair)
    veto = [r for r, vals in rows.items() if mean([b for b, a in vals]) >= 0 and mean([a for b, a in vals]) < 0]
    return {"status": FAIL if veto else PASS, "detail": "B >= noop but candidate < noop: " + (", ".join(veto) or "none")}


def evaluate_stage2(rule, cells, fs_cells, f1, mechanism_subs, noop_sub=None):
    """Step 7: R/W EW11 t and m>0; C1 launch only; F_S on its measured regimes."""
    if rule == "superiority":
        res = evaluate(rule, cells, None, mechanism_subs, threshold=0.0, ask_floor=None, f_override=f1, strict_mean=True)
    else:
        res = evaluate(rule, cells, None, mechanism_subs, threshold=0.0, ask_floor=None)
    res["clauses"]["6_fs_field"] = fs_clause(fs_cells)
    res["clauses"]["7_noop"] = noop_sub if noop_sub is not None else noop_clause(cells)
    res["verdict"] = _combine(res["clauses"])
    return res


def retest_decision(cells):
    """Chapter 4 N5: REVERT if combined non-launch m <= 0."""
    paired, c, dbar = seed_contrasts(decision_cells(cells))
    if len(c) < 2 or dbar["FD"] is None:
        return {"decision": BLOCKED, "detail": "%d seed(s) with both fields; need >= 2" % len(c), "n": len(c)}
    m = mean(c)
    revert = m <= 0
    return {"decision": "REVERT" if revert else "KEEP", "m": m, "dbar_FD": dbar["FD"], "dbar_FP": dbar["FP"],
            "n": len(c), "seeds": paired,
            "detail": "EW11 m %+.3f (REVERT if <= 0); dbar_FD %+.3f (report only)" % (m, dbar["FD"])}


def select(verdicts, roles, means=None):
    """Rank passing R/W by EW11 m, then C1. Unresolved ranking stays PENDING."""
    sup = [a for a, r in roles.items() if r == "superiority"]
    non = [a for a, r in roles.items() if r == "noninferiority"]
    out = {"F": None, "F2": None, "status": "DECIDED"}
    passing = [a for a in sup if verdicts.get(a) == PASS]
    unresolved = [a for a in roles if verdicts.get(a) == BLOCKED]
    if len(passing) > 1 and any(means is None or not _num(means.get(a)) for a in passing):
        unresolved += passing
    if unresolved:
        out.update(status="PENDING", decision="PENDING", note="waiting on " + ", ".join(unresolved))
        return out
    passing.sort(key=lambda a: (-(means or {}).get(a, 0), a))
    passing += [a for a in non if verdicts.get(a) == PASS]
    out["F"] = passing[0] if passing else None
    out["F2"] = passing[1] if len(passing) > 1 else None
    out["decision"] = "N4" if not passing else "F=%s" % out["F"] + (", F2=%s" % out["F2"] if out["F2"] else "")
    return out


def flag_kind(flag):
    """A slot flag -> "failure" (did not run the epoch out), "rule" (rules 2.6 / 8, log integrity),
    "info" (V_0 notes) or "unknown" (for the operator)."""
    if not isinstance(flag, str):
        return "unknown"
    if flag.startswith(INFRA_FLAGS):
        return "failure"
    if flag.startswith(RULE_FLAGS) or any(p in flag for p in RULE_FLAG_PARTS):
        return "rule"
    if flag.startswith(INFO_FLAGS):
        return "info"
    return "unknown"


def rule_flag_clause(flags_by_cell):
    """flags_by_cell: {lab: {regime: [flag]}} of one candidate's slot over every epoch, excluded ones too.
    FAIL on a rule / log-integrity flag, else BLOCKED on an unknown flag, else PASS."""
    rule, unknown = [], []
    for lab, regs in sorted(flags_by_cell.items()):
        for r, fl in sorted(regs.items()):
            for x in fl:
                k = flag_kind(x)
                if k == "rule":
                    rule.append("%s %s: %s" % (lab, r, x))
                elif k == "unknown":
                    unknown.append("%s %s: %s" % (lab, r, x))
    if rule:
        return {"status": FAIL, "detail": "rule / log-integrity flag(s) on the candidate's slot (rules 2.6 / 8), counted as a "
                "candidate-side failure: %s%s" % ("; ".join(rule[:4]), " (+%d more)" % (len(rule) - 4) if len(rule) > 4 else "")}
    if unknown:
        return {"status": BLOCKED, "detail": "slot flag(s) judge2 does not know, for the operator: %s%s" % (
            "; ".join(unknown[:4]), " (+%d more)" % (len(unknown) - 4) if len(unknown) > 4 else "")}
    return {"status": PASS, "detail": "no rule, log-integrity or unknown flag on the slot"}


def coverage_clause(skipped, failed_cells):
    """Every listed, not excluded cell must have a contrast. skipped: cells without one; failed_cells: cells
    where the candidate's own slot failed (that failure is counted elsewhere). Anything else: BLOCKED."""
    unexplained = [c for c in skipped if c not in failed_cells]
    if unexplained:
        return {"status": BLOCKED, "detail": "no contrast in %s and no candidate-side failure there: the verdict would rest "
                "on fewer cells than the design" % ", ".join(unexplained)}
    return {"status": PASS, "detail": "every counted cell has a contrast" + (
        " (%s: candidate-side failure, counted)" % ", ".join(skipped) if skipped else "")}


def mechanism_clause(mech, arm, base, rule, expected_sha=None, mech_dir=None, need_step2=True):
    """Clause 5: missing/malformed values BLOCKED; explicit null p99 with a reason is advisory.
    expected_sha: {arm: set of sha256 of the matrices judged for that arm}; the JSON's matrices_sha256 must
    list exactly those for the arm and for B."""
    subs = {}
    a = (mech or {}).get(arm) if isinstance(mech, dict) else None
    b = (mech or {}).get(base) if isinstance(mech, dict) else None
    a = a if isinstance(a, dict) else None  # a malformed arm entry reads as missing (BLOCKED), never as a crash
    b = b if isinstance(b, dict) else None

    def count(key, label):
        v = None if a is None else a.get(key)
        if not (_num(v) and v >= 0 and float(v).is_integer()):
            subs[label] = {"status": BLOCKED, "detail": "%s missing or not a count: %r" % (key, v)}
        else:
            subs[label] = {"status": PASS if v == 0 else FAIL, "detail": "%s = %d (must be 0)" % (key, v)}

    if mech is None:
        reason = "no mechanism JSON"
        out = {lab: {"status": BLOCKED, "detail": reason} for lab in ("slot_timeouts", "p99_latency", "tie_win_rate", "stf", "provenance")}
        if rule == "noninferiority" and need_step2:
            out["step2_mechanism"] = {"status": BLOCKED, "detail": reason}
        return out
    count("slot_timeouts", "slot_timeouts")
    v = None if a is None else a.get("p99_decide_ms")
    reason = None if a is None else a.get("p99_decide_ms_reason")
    if a is not None and "p99_decide_ms" in a and v is None and isinstance(reason, str) and reason.strip():
        subs["p99_latency"] = {"status": NOT_MEASURED, "detail": "not measured (advisory): " + reason.strip()}
    elif not (_num(v) and math.isfinite(v) and v >= 0):
        subs["p99_latency"] = {"status": BLOCKED, "detail": "p99_decide_ms missing or malformed: %r" % (v,)}
    else:
        subs["p99_latency"] = {"status": PASS if v < P99_MS else FAIL, "detail": "p99 %.1f ms (must be < %.0f)" % (v, P99_MS)}
    ta = None if a is None else a.get("tie_win_rate")
    tb = None if b is None else b.get("tie_win_rate")
    if not all(_num(x) and 0 <= x <= 1 for x in (ta, tb)):
        subs["tie_win_rate"] = {"status": BLOCKED, "detail": "tie_win_rate of %s or %s missing or outside [0, 1]: %r, %r" % (arm, base, ta, tb)}
    else:
        ok = abs(ta - tb) <= TIE_PT + 1e-12
        subs["tie_win_rate"] = {"status": PASS if ok else FAIL,
                                "detail": "%.3f vs B %.3f (%+.1f pt, must be within +-%.0f)" % (ta, tb, 100 * (ta - tb), 100 * TIE_PT)}
    count("stf", "stf")
    prov = []
    for who, x in ((arm, a), (base, b)):
        got = None if x is None else x.get("matrices_sha256")
        want = (expected_sha or {}).get(who)
        if not (isinstance(got, list) and got and all(isinstance(h, str) for h in got)):
            prov.append((BLOCKED, "%s: matrices_sha256 missing or not a list of sha256 strings" % who))
        elif not want:
            prov.append((BLOCKED, "%s: no judged matrices to compare with" % who))
        elif len(set(got)) != len(got) or set(got) != want:
            prov.append((BLOCKED, "%s: computed from %d matrix file(s), not the %d judged ones (%d missing, %d not judged)" % (
                who, len(set(got)), len(want), len(want - set(got)), len(set(got) - want))))
        else:
            prov.append((PASS, "%s: computed from exactly the %d judged matrices" % (who, len(want))))
    subs["provenance"] = {"status": BLOCKED if any(s == BLOCKED for s, _ in prov) else PASS, "detail": "; ".join(d for _, d in prov)}
    if rule == "noninferiority" and need_step2:
        v = None if a is None else a.get("step2_mechanism")
        rep = None if a is None else a.get("step2_report")
        if v not in (PASS, FAIL):
            subs["step2_mechanism"] = {"status": BLOCKED, "detail": "step2_mechanism missing (need PASS or FAIL): %r" % (v,)}
        elif not (isinstance(rep, dict) and isinstance(rep.get("path"), str) and isinstance(rep.get("sha256"), str)):
            subs["step2_mechanism"] = {"status": BLOCKED, "detail": "step2_report {path, sha256} missing: the Step 2 verdict has no source"}
        else:
            rp = rep["path"] if os.path.isabs(rep["path"]) else os.path.join(mech_dir or os.getcwd(), rep["path"])
            try:
                h = _sha256(rp)
            except OSError as e:
                h = None
                err = str(e)
            if h is None:
                subs["step2_mechanism"] = {"status": BLOCKED, "detail": "Step 2 report unreadable: %s" % err}
            elif h != rep["sha256"]:
                subs["step2_mechanism"] = {"status": BLOCKED, "detail": "Step 2 report %s has sha256 %s, the mechanism JSON says %s" % (rp, h[:12], rep["sha256"][:12])}
            else:
                subs["step2_mechanism"] = {"status": v, "detail": "Step 2 (a)-(d) verdict %s (report sha256 %s)" % (v, h[:12])}
    return subs


# ---------------------------------------------------------------- judge: inputs

class InputError(Exception):
    pass


def _die(msg):
    raise InputError(msg)


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def read_roster(field):
    """roster-<field>.yaml beside this file -> sorted [(id, baseline)] of every agent (slot included)."""
    if HERE is None:
        _die("cannot locate roster-%s.yaml (judge2.py was not run from a file)" % field)
    path = os.path.join(HERE, "roster-%s.yaml" % field)
    agents, cur = [], None
    try:
        with open(path) as f:
            lines = f.read().splitlines()
    except OSError as e:
        _die("roster for field %s unreadable: %s" % (field, e))
    for line in lines:
        s = line.split("#", 1)[0].strip()
        if s.startswith("- id:"):
            cur = {"id": s[len("- id:"):].strip(), "baseline": False}
            agents.append(cur)
        elif s.startswith("baseline:") and cur is not None:
            val = s.split(":", 1)[1].strip()
            if val not in ("true", "false"):
                _die("%s: baseline value %r" % (path, val))
            cur["baseline"] = val == "true"
    if not agents or len({a["id"] for a in agents}) != len(agents):
        _die("%s: no agents, or an id twice" % path)
    return sorted((a["id"], a["baseline"]) for a in agents)


def read_scen(seed):
    """scen-<seed>.yaml beside this file -> (regimes, seeds), or None when there is no such file."""
    if HERE is None:
        return None
    path = os.path.join(HERE, "scen-%d.yaml" % seed)
    if not os.path.isfile(path):
        return None
    got = {}
    with open(path) as f:
        for line in f:
            s = line.split("#", 1)[0].strip()
            for key in ("regimes", "seeds"):
                if s.startswith(key + ":"):
                    body = s.split(":", 1)[1].strip()
                    if not (body.startswith("[") and body.endswith("]")):
                        _die("%s: %s is not a [list]" % (path, key))
                    got[key] = [x.strip() for x in body[1:-1].split(",") if x.strip()]
    if set(got) != {"regimes", "seeds"}:
        _die("%s: needs regimes and seeds" % path)
    return got["regimes"], [int(x) for x in got["seeds"]]


def _infra(flags):
    return [f for f in (flags or []) if isinstance(f, str) and f.startswith(INFRA_FLAGS)]


def inspect_arm_cell(path, seed, slot, regimes, roster, launch_only=False):
    """One arm's matrix for one (seed, field) cell. roster: expected sorted [(id, baseline)] without the slot,
    or None (unchecked). Returns a dict:
      sha256, k, epochs [(s, regime)], regs {regime: {T, P, w, s}} (slot scored in a valid epoch),
      config [msg] (always BLOCKED), infra [(regime or None, msg, kind)] (BLOCKED unless excluded; kind
      "partial", "invalid" (the official rule left the epoch out) or "reference"), slot_fail [(regime, msg)]
      (candidate-side), slot_flags {regime: [flag]}, run_dirs [str], roster {regime: sorted non-slot
      (id, baseline)}, setup {SETUP_KEYS: value}."""
    out = {"sha256": None, "k": None, "epochs": [], "regs": {}, "config": [], "infra": [], "slot_fail": [],
           "slot_flags": {}, "run_dirs": [], "roster": {}, "setup": None}
    try:
        with open(path) as f:
            matrix = json.load(f)
        out["sha256"] = _sha256(path)
    except (OSError, ValueError) as e:
        out["config"].append("unreadable %s: %s" % (path, e))
        return out
    try:
        st = compute_standings(matrix)
    except (ValueError, TypeError, KeyError, AttributeError) as e:
        out["config"].append("%s: the official arithmetic refused it: %s" % (path, e))
        return out
    if launch_only and [sc.get("regime") for sc in matrix["scenarios"]] == [LAUNCH]:
        regimes = [LAUNCH]
    cfg, n = out["config"], len(regimes)
    k, planned, scen = st["k"], matrix.get("scenariosPlanned"), matrix["scenarios"]
    out["k"] = k
    sk = matrix.get("scenarioKey")
    out["setup"] = {"schema": matrix.get("schema"), "sourceCommit": matrix.get("sourceCommit"),
                    "scenarioKey.commitment": sk.get("commitment") if isinstance(sk, dict) else None,
                    "scenarioStreams": matrix.get("scenarioStreams"), "repeat": matrix.get("repeat", 1),
                    "resetUnit": matrix.get("resetUnit")}
    no_setup = [x for x in SETUP_KEYS if out["setup"][x] is None]
    if no_setup:
        cfg.append("simulation setup field(s) missing: %s (arms of a cell cannot be shown to share the simulator)" % ", ".join(no_setup))
    if k != n:
        cfg.append("k = %r; the design has %d regimes" % (k, n))
    if not _is_int(planned):
        cfg.append("scenariosPlanned missing or not an integer: %r" % (planned,))
    elif planned != n:
        cfg.append("scenariosPlanned = %d; the design has %d regimes" % (planned, n))
    present = [sc.get("regime") for sc in scen]
    dup = sorted({str(r) for r in present if present.count(r) > 1})
    unknown = sorted({str(r) for r in present if r not in regimes})
    missing = [r for r in regimes if r not in present]
    if dup:
        cfg.append("regime(s) %s appear more than once" % ", ".join(dup))
    if unknown:
        cfg.append("regime(s) %s are not in the design" % ", ".join(unknown))
    if missing:
        if _is_int(planned) and len(scen) < planned and not dup and not unknown:
            out["infra"].append((None, "partial matrix: %d of %d scenarios (missing %s)" % (len(scen), planned, ", ".join(missing)), "partial"))
        else:
            cfg.append("regime(s) %s missing" % ", ".join(missing))
    for sc in scen:
        s, r = sc.get("s"), sc.get("regime")
        if _is_int(s) and 1 <= s <= n:
            if regimes[s - 1] != r:
                cfg.append("scenario s=%d is %r; the design has %r at that position" % (s, r, regimes[s - 1]))
        else:
            cfg.append("scenario %r has ordinal %r outside 1..%d" % (r, s, n))
        if sc.get("seed") != seed:
            cfg.append("scenario %s has seed %r, the cell is seed %r" % (r, sc.get("seed"), seed))
        if sc.get("runDir"):
            out["run_dirs"].append(sc["runDir"])
        else:
            cfg.append("scenario %s has no runDir" % r)
        agents = sc.get("agents") or []
        ids, n_slot = [], 0
        for a in agents:
            if a.get("id") == "noop" and not a.get("baseline"):
                cfg.append("%s: agent noop is not marked baseline, so it would be in the population" % r)
            if a.get("id") == slot:
                n_slot += 1
                if a.get("baseline"):
                    cfg.append("%s: the slot agent %r is marked baseline" % (r, slot))
            else:
                ids.append((a.get("id"), bool(a.get("baseline"))))
        ids.sort(key=lambda x: (str(x[0]), x[1]))
        if agents:
            if n_slot != 1:
                cfg.append("%s: slot agent %r appears %d times in the agent list" % (r, slot, n_slot))
            if len({x[0] for x in ids}) != len(ids):
                cfg.append("%s: an agent id appears twice" % r)
            if roster is not None and ids != roster:
                cfg.append("%s: non-slot roster differs from the field's roster file (missing %s; extra %s)" % (
                    r, sorted(set(roster) - set(ids)) or "-", sorted(set(ids) - set(roster)) or "-"))
        out["roster"][r] = ids
    by_s = {sc.get("s"): sc for sc in scen}
    for e in st["epochs"]:
        r = e["regime"]
        out["epochs"].append((e["s"], r))
        agents = by_s[e["s"]].get("agents") or []
        sa = [a for a in agents if a.get("id") == slot]
        sa = sa[0] if len(sa) == 1 else None
        if sa is not None and sa.get("flags"):
            out["slot_flags"][r] = list(sa["flags"])
        if "excluded" in e:
            out["infra"].append((r, "%s is left out by the official rule (%s%s)" % (
                r, e["excluded"], (": " + str(e.get("invalidReason"))) if e.get("invalidReason") else ""), "invalid"))
            continue
        for a in agents:
            if a.get("id") == slot:
                continue
            bad = _infra(a.get("flags"))
            if "pnlUsdc" not in a and not bad:
                bad = ["no pnlUsdc (not placed)"]
            for fl in bad:
                out["infra"].append((r, "%s: reference agent %s: %s" % (r, a.get("id"), fl), "reference"))
        if sa is None or sa.get("baseline"):
            continue  # reported under config
        sf = _infra(sa.get("flags"))
        if slot not in e["tByAgent"] and not sf:
            sf = ["not scored (no pnlUsdc)"]
        for fl in sf:
            out["slot_fail"].append((r, "%s: slot %s" % (r, fl)))
        if slot in e["tByAgent"]:
            noop_p = e["benchmarkPnl"].get("noop")
            noop_gap = None if noop_p is None else (10 * (sa["pnlUsdc"] - noop_p) / e["sigma"] if e["sigma"] else 0.0)
            out["regs"][r] = {"T": e["tByAgent"][slot], "P": sa["pnlUsdc"], "w": e["w"], "s": e["s"], "noop_gap": noop_gap}
    return out


def ew(regs, names):
    return mean([regs[r]["T"] for r in names])


def official(regs, names):
    names = sorted(names, key=lambda r: regs[r]["s"])  # the official fold runs in ordinal order
    return _fold(regs[r]["w"] * regs[r]["T"] for r in names) / _fold(regs[r]["w"] for r in names)


def parse_cli_cells(specs):
    cells = {}
    for spec in specs:
        try:
            left, path = spec.split("=", 1)
            field, seed, arm = left.split(":", 2)
            cells.setdefault((int(seed), field), {})[arm] = path
        except ValueError:
            _die("--cell wants FIELD:SEED:ARM=PATH, got %r" % spec)
    return [{"seed": s, "field": f, "arms": a} for (s, f), a in sorted(cells.items())]


def parse_cli_excludes(specs):
    out = []
    for x in specs:
        left, eq, evidence = x.partition("=")
        parts = left.split(":")
        if not eq or len(parts) not in (2, 3):
            _die("--exclude wants SEED:FIELD[:REGIME]=EVIDENCE, got %r" % x)
        try:
            seed = int(parts[0])
        except ValueError:
            _die("--exclude seed %r is not an integer" % parts[0])
        e = {"seed": seed, "field": parts[1], "reason": "infra", "evidence": evidence}
        if len(parts) == 3:
            e["regime"] = parts[2]
        out.append(e)
    return out


def _load_verdict(path, stage):
    try:
        with open(path) as f:
            v = json.load(f)
    except (OSError, ValueError) as e:
        _die("stage-%s verdict unreadable: %s" % (stage, e))
    if not isinstance(v, dict) or v.get("tool") != "ascon/final/judge2.py" or v.get("stage") != stage:
        _die("%s is not a judge2 stage-%s verdict" % (path, stage))
    if (v.get("params") or {}).get("statistic") != "EW11" or (v.get("params") or {}).get("ask_floor") is not None:
        _die("prior verdict does not use the approved EW11/no-ask rules; rejudge its saved matrices")
    return v, _sha256(path)


def _nonplan_is_threshold(entry):
    """A non-plan note is about the threshold (needs --allow-nonplan-threshold) or about the design."""
    while entry.startswith("stage ") and ": " in entry:
        entry = entry.split(": ", 1)[1]
    return entry.startswith("threshold")


def _inherit_nonplan(cfg, v, stage, args):
    """An earlier verdict judged under non-plan settings is accepted only with the matching --allow flag, and
    its non-plan notes are copied into this verdict."""
    prior = v.get("nonplan") or []
    if not isinstance(prior, list) or not all(isinstance(x, str) for x in prior):
        _die("the stage-%s verdict's nonplan is not a list of notes: %r" % (stage, prior))
    for x in prior:
        thr = _nonplan_is_threshold(x)
        if thr and not args.allow_nonplan_threshold:
            _die("the stage-%s verdict was judged at a non-plan threshold (%s); pass --allow-nonplan-threshold to go on (recorded)" % (stage, x))
        if not thr and not args.allow_nonplan_design:
            _die("the stage-%s verdict was judged on a non-plan design (%s); pass --allow-nonplan-design to go on (recorded)" % (stage, x))
        cfg["inherited_nonplan"].append("stage %s: %s" % (stage, x))


MANIFEST_KEYS = {"stage", "slot_id", "baseline", "placebo", "candidates", "cells", "exclude", "threshold", "ask_floor", "design", "arm_map"}
DESIGN_KEYS = {"seeds", "fs_seeds", "regimes", "rosters"}


def build_config(args):
    man, base_dir = {}, os.getcwd()
    if args.manifest:
        with open(args.manifest) as f:
            man = json.load(f)
        if not isinstance(man, dict):
            _die("the manifest is not a JSON object")
        base_dir = os.path.dirname(os.path.abspath(args.manifest))
    if set(man) - MANIFEST_KEYS:
        _die("unknown manifest key(s): %s" % sorted(set(man) - MANIFEST_KEYS))
    stage = args.stage or str(man.get("stage", "1"))
    if args.stage and "stage" in man and str(man["stage"]) != args.stage:
        _die("--stage %s but the manifest says stage %r" % (args.stage, man["stage"]))
    if stage not in STAGES:
        _die("stage %r (1, 2 or retest)" % stage)
    cfg = {"stage": stage, "slot_id": args.slot or man.get("slot_id", "slot"), "baseline": args.baseline or man.get("baseline", "B"),
           "placebo": args.placebo or man.get("placebo", "B'"), "candidates": dict(man.get("candidates", {})), "nonplan": [],
           "inherited_nonplan": []}
    for c in args.candidate or []:
        arm, _, rule = c.partition("=")
        cfg["candidates"][arm] = rule
    cfg["arm_map"] = resolve_arm_map(man, getattr(args, "arms", None))
    if cfg["arm_map"]:
        mapped = {a: "superiority" for a in cfg["arm_map"] if a not in ("B", "B'")}
        if cfg["candidates"] and cfg["candidates"] != mapped:
            _die("candidates differ from explicit arm_map superiority candidates")
        if cfg["baseline"] != "B" or cfg["placebo"] != "B'":
            _die("explicit arm_map requires B and B'")
        cfg["candidates"] = mapped
    roles = cfg["candidates"]
    for arm, rule in roles.items():
        if rule not in ("superiority", "noninferiority"):
            _die("candidate %s has rule %r (superiority or noninferiority)" % (arm, rule))
    if not roles:
        _die("need at least one candidate")
    if stage == "1":
        if sum(r == "noninferiority" for r in roles.values()) > 1:
            _die("at most one noninferiority candidate (legacy C1)")
        arms = [cfg["baseline"], cfg["placebo"]] + list(roles)
    else:
        if len(roles) != 1:
            _die("stage %s judges exactly one candidate (F)" % stage)
        arms = [cfg["baseline"]] + list(roles)
    if len(set(arms)) != len(arms):
        _die("arm names collide: %s" % arms)
    cfg["arms"] = arms
    F = list(roles)[0] if stage != "1" else None
    fields = FIELDS + ((FS_FIELD,) if stage == "2" else ())
    cfg["fields"] = fields
    # earlier verdicts
    cfg["prior"] = None
    plan_key = stage
    if stage == "2":
        if not args.stage1_verdict:
            _die("stage 2 needs --stage1-verdict (f and the selected candidate come from it)")
        v1, sha = _load_verdict(args.stage1_verdict, "1")
        sel = v1.get("selection") or {}
        if sel.get("status") != "DECIDED" or F not in (sel.get("F"), sel.get("F2")):
            _die("the stage-1 verdict does not select %s (selection %r)" % (F, sel.get("decision")))
        if (v1.get("candidates", {}).get(F) or {}).get("rule") != roles[F]:
            _die("%s's rule %r differs from its stage-1 rule" % (F, roles[F]))
        _inherit_nonplan(cfg, v1, "1", args)
        f1 = (v1.get("placebo") or {}).get("f")
        cfg["prior"] = {"path": os.path.abspath(args.stage1_verdict), "sha256": sha, "path_role": "F" if F == sel.get("F") else "F2",
                        "f": f1 if _num(f1) and math.isfinite(f1) and f1 > 0 else None}
        plan_key = "2F" if F == sel.get("F") else "2F2"
    elif stage == "retest":
        if not args.stage2_verdict:
            _die("the re-test needs --stage2-verdict")
        v2, sha = _load_verdict(args.stage2_verdict, "2")
        _inherit_nonplan(cfg, v2, "2", args)
        cv = (v2.get("candidates") or {}).get(F) or {}
        if cv.get("verdict") != PASS:
            _die("the stage-2 verdict does not pass %s (%r)" % (F, cv.get("verdict")))
        cfg["prior"] = {"path": os.path.abspath(args.stage2_verdict), "sha256": sha,
                        "matrices": (v2.get("inputs") or {}).get("matrices") or {}}
    elif args.stage1_verdict or args.stage2_verdict:
        _die("--stage1-verdict / --stage2-verdict belong to stage 2 / retest")
    # design
    design = man.get("design", {})
    if not isinstance(design, dict) or set(design) - DESIGN_KEYS:
        _die("design must be an object with keys from %s" % sorted(DESIGN_KEYS))
    plan_sets = PLAN_SEEDS[plan_key]
    seeds = design.get("seeds", list(plan_sets[0]))
    if not (isinstance(seeds, list) and seeds and all(_is_int(s) for s in seeds) and len(set(seeds)) == len(seeds)):
        _die("design seeds must be a list of distinct integers: %r" % (seeds,))
    if tuple(sorted(seeds)) not in plan_sets:
        cfg["nonplan"].append("seeds %s (plan: %s)" % (sorted(seeds), " or ".join(str(list(p)) for p in plan_sets)))
    fs_seeds = []
    if stage == "2":
        fs_seeds = design.get("fs_seeds", list(FS_SEEDS))
        if not (isinstance(fs_seeds, list) and fs_seeds and all(_is_int(s) for s in fs_seeds) and len(set(fs_seeds)) == len(fs_seeds)):
            _die("design fs_seeds must be a list of distinct integers: %r" % (fs_seeds,))
        if tuple(sorted(fs_seeds)) != FS_SEEDS:
            cfg["nonplan"].append("FS seeds %s (plan: %s)" % (sorted(fs_seeds), list(FS_SEEDS)))
    elif "fs_seeds" in design:
        _die("fs_seeds belong to stage 2")
    regimes = design.get("regimes", list(REGIMES12))
    if not (isinstance(regimes, list) and regimes and all(isinstance(r, str) for r in regimes) and len(set(regimes)) == len(regimes)):
        _die("design regimes must be a list of distinct names: %r" % (regimes,))
    if tuple(regimes) != REGIMES12:
        cfg["nonplan"].append("regimes %s (plan: the 12 of scen-<seed>.yaml)" % regimes)
    for s in seeds:
        sc = read_scen(s)
        if sc is not None and (sc[0] != regimes or sc[1] != [s]):
            _die("scen-%d.yaml lists %s at seeds %s; the design has %s at seed %d" % (s, sc[0], sc[1], regimes, s))
    slot = cfg["slot_id"]
    rosters = {}
    want = design.get("rosters")
    if want is not None and not (want == "unchecked" or isinstance(want, dict)):
        _die("design rosters must be an object or \"unchecked\"")
    for f in fields:
        given = want if want is None or want == "unchecked" else want.get(f)
        if given == "unchecked":
            rosters[f] = None
            cfg["nonplan"].append("roster of %s unchecked" % f)
            continue
        # the template's slot entry is id `slot`; the matrices call it slot_id
        plan_r = [x for x in read_roster(f) if x[0] not in ("slot", slot)]
        if given is None:
            rosters[f] = plan_r
        elif isinstance(given, list) and all(isinstance(x, list) and len(x) == 2 and isinstance(x[0], str) and isinstance(x[1], bool) for x in given):
            rosters[f] = sorted((x[0], x[1]) for x in given if x[0] != slot)
            if rosters[f] != plan_r:
                cfg["nonplan"].append("roster of %s differs from roster-%s.yaml" % (f, f))
        else:
            _die("design rosters.%s must be [[id, baseline], ...] or \"unchecked\"" % f)
    cfg["design"] = {"seeds": sorted(seeds), "fs_seeds": sorted(fs_seeds), "regimes": regimes, "rosters": rosters}
    # cells
    cells = list(man.get("cells", [])) + parse_cli_cells(args.cell or [])
    listed = {}
    for c in cells:
        if not isinstance(c, dict) or not _is_int(c.get("seed")) or c.get("field") not in fields or not isinstance(c.get("arms"), dict):
            _die("a cell needs an integer seed, a field in %s and an arms object: %r" % (fields, c))
        key = (c["seed"], c["field"])
        if key in listed:
            _die("cell %s#%s listed twice" % (key[1], key[0]))
        extra = set(c["arms"]) - set(arms)
        if extra:
            _die("cell %s#%s has arm(s) %s that stage %s does not judge (arms: %s)" % (key[1], key[0], sorted(extra), stage, arms))
        if not all(isinstance(p, str) and p for p in c["arms"].values()):
            _die("cell %s#%s: arm paths must be strings" % (key[1], key[0]))
        listed[key] = {"seed": key[0], "field": key[1],
                       "arms": {a: p if os.path.isabs(p) else os.path.join(base_dir, p) for a, p in c["arms"].items()}}
    expected = {(s, f) for s in seeds for f in FIELDS} | {(s, FS_FIELD) for s in fs_seeds}
    outside = sorted(set(listed) - expected)
    missing = sorted(expected - set(listed))
    if outside:
        _die("cell(s) %s are outside the design" % ", ".join("%s#%d" % (f, s) for s, f in outside))
    if missing:
        _die("cell(s) %s of the design are not listed (list every cell; a cell lost to an infrastructure failure "
             "is listed and excluded)" % ", ".join("%s#%d" % (f, s) for s, f in missing))
    cfg["cells"] = [listed[k] for k in sorted(listed)]
    # exclusions
    excl = list(man.get("exclude", [])) + parse_cli_excludes(args.exclude or [])
    seen = set()
    for x in excl:
        if not isinstance(x, dict) or set(x) - {"seed", "field", "regime", "reason", "evidence", "rerun"}:
            _die("exclude entry %r: keys seed, field, [regime], reason, evidence, rerun" % (x,))
        if not _is_int(x.get("seed")) or x.get("field") not in fields:
            _die("exclude entry %r: integer seed and a field in %s" % (x, fields))
        if (x["seed"], x["field"]) not in listed:
            _die("exclude entry %r matches no listed cell" % (x,))
        if "regime" in x and x["regime"] not in regimes:
            _die("exclude entry %r: regime %r is not in the design" % (x, x["regime"]))
        if x.get("reason") != "infra":
            _die("exclude entry %r: reason must be \"infra\" (the plan excludes only infrastructure failures)" % (x,))
        if not (isinstance(x.get("evidence"), str) and x["evidence"].strip()):
            _die("exclude entry %r: evidence (the failure as the run reported it) is required" % (x,))
        if "rerun" in x:
            rr = x["rerun"]
            if not (isinstance(rr, dict) and set(rr) == {"arm", "path", "sha256"} and rr["arm"] in arms
                    and isinstance(rr["path"], str) and rr["path"] and isinstance(rr["sha256"], str) and len(rr["sha256"]) == 64):
                _die("exclude entry %r: rerun must be {arm (one of %s), path, sha256 (64 hex)}" % (x, arms))
            x["rerun"] = dict(rr, path=rr["path"] if os.path.isabs(rr["path"]) else os.path.join(base_dir, rr["path"]))
        k3 = (x["seed"], x["field"], x.get("regime"))
        if k3 in seen:
            _die("exclude entry %r listed twice" % (x,))
        seen.add(k3)
    for s, f, r in seen:
        if r is not None and (s, f, None) in seen:
            _die("%s#%d is excluded whole and by regime" % (f, s))
    cfg["exclude"] = excl
    # thresholds
    if stage == "1":
        thr = args.threshold if args.threshold is not None else man.get("threshold", THRESHOLD)
        ask = args.ask_floor if args.ask_floor is not None else man.get("ask_floor", ASK_FLOOR)
        if not (_num(thr) and math.isfinite(thr)):
            _die("threshold must be finite")
        if ask is not None:
            _die("U4 approved: no ask band; omit ask_floor")
        if thr not in PLAN_THRESHOLDS:
            if not args.allow_nonplan_threshold:
                _die("threshold %r is not the plan's (+0.20, no ask band); pass --allow-nonplan-threshold" % thr)
            cfg["nonplan"].append("threshold %r" % thr)
        cfg["threshold"], cfg["ask_floor"] = float(thr), None
    else:
        if args.threshold is not None or args.ask_floor is not None or "threshold" in man or "ask_floor" in man:
            _die("stage %s has no threshold or ask band (plan Step 7: m' > 0)" % stage)
        cfg["threshold"] = cfg["ask_floor"] = None
    design_nonplan = [x for x in cfg["nonplan"] if not _nonplan_is_threshold(x)]
    if design_nonplan and not args.allow_nonplan_design:
        _die("the design is not the plan's: %s; pass --allow-nonplan-design to judge it anyway (recorded)" % "; ".join(design_nonplan))
    cfg["nonplan"] = cfg["inherited_nonplan"] + cfg["nonplan"]
    return cfg


def _inspect(cfg):
    """Everything that does not depend on the exclusions: each arm's matrix in each cell, file and runDir
    reuse, configuration problems, the arms' simulation setup against B's, and the rerun records."""
    arms, B, slot = cfg["arms"], cfg["baseline"], cfg["slot_id"]
    st = {"insp": {}, "files": {}, "problems": {a: [] for a in arms}, "slot_flags": {}, "rerun": {}}
    path_owner, rd_owner = {}, {}
    for c in cfg["cells"]:
        key = (c["seed"], c["field"])
        lab = "%s#%d" % (key[1], key[0])
        insp = st["insp"][key] = {}
        for arm in arms:
            p = c["arms"].get(arm)
            if p is None:
                st["problems"][arm].append("%s: no matrix for arm %s" % (lab, arm))
                continue
            rp = os.path.realpath(p)
            if rp in path_owner:
                o_lab, o_arm = path_owner[rp]
                for a in {arm, o_arm}:
                    st["problems"][a].append("%s %s and %s %s use the same matrix file %s" % (o_lab, o_arm, lab, arm, p))
            else:
                path_owner[rp] = (lab, arm)
            r = inspect_arm_cell(p, key[0], slot,
                                 list(FS_REGIMES) if key[1] == FS_FIELD else cfg["design"]["regimes"],
                                 cfg["design"]["rosters"].get(key[1]), cfg["candidates"].get(arm) == "noninferiority")
            insp[arm] = r
            if r["sha256"]:
                st["files"].setdefault(arm, {})[lab] = {"path": p, "sha256": r["sha256"], "setup": r["setup"]}
            for rd in r["run_dirs"]:
                if rd in rd_owner and rd_owner[rd] != (lab, arm):
                    o_lab, o_arm = rd_owner[rd]
                    for a in {arm, o_arm}:
                        st["problems"][a].append("runDir %s is in both %s %s and %s %s" % (rd, o_lab, o_arm, lab, arm))
                rd_owner.setdefault(rd, (lab, arm))
            st["problems"][arm] += ["%s: %s" % (lab, m) for m in r["config"]]
            for rg, fl in r["slot_flags"].items():
                st["slot_flags"].setdefault(arm, {}).setdefault(lab, {})[rg] = fl
        b = insp.get(B)
        if b is not None and b["setup"] is not None:
            for arm, r in insp.items():
                if arm == B or r["setup"] is None:
                    continue
                diff = ["%s %r (B %r)" % (k, r["setup"][k], b["setup"][k]) for k in SETUP_KEYS if r["setup"][k] != b["setup"][k]]
                if diff:
                    st["problems"][arm].append("%s: simulation setup differs from %s's: %s" % (lab, B, "; ".join(diff)))
    for x in cfg["exclude"]:
        rr = x.get("rerun")
        if rr is None:
            continue
        k3 = (x["seed"], x["field"], x.get("regime"))
        rec = {"arm": rr["arm"], "path": rr["path"], "sha256": rr["sha256"], "problem": None, "infra": []}
        st["rerun"][k3] = rec
        try:
            h = _sha256(rr["path"])
        except OSError as e:
            rec["problem"] = "rerun matrix unreadable: %s" % e
            continue
        listed = st["insp"].get((x["seed"], x["field"]), {}).get(rr["arm"])
        if h != rr["sha256"]:
            rec["problem"] = "rerun matrix %s has sha256 %s, the manifest says %s" % (rr["path"], h[:12], rr["sha256"][:12])
        elif os.path.realpath(rr["path"]) in path_owner:
            rec["problem"] = "the rerun %s is one of the listed matrices, not a second run" % rr["path"]
        else:
            r = inspect_arm_cell(rr["path"], x["seed"], slot,
                                 list(FS_REGIMES) if x["field"] == FS_FIELD else cfg["design"]["regimes"],
                                 cfg["design"]["rosters"].get(x["field"]), cfg["candidates"].get(rr["arm"]) == "noninferiority")
            if r["config"]:
                rec["problem"] = "rerun matrix: %s" % "; ".join(r["config"][:3])
            elif listed is not None and set(r["run_dirs"]) & set(listed["run_dirs"]):
                rec["problem"] = "the rerun shares runDirs with the listed %s matrix (not a new run)" % rr["arm"]
            else:
                rec["infra"] = r["infra"]
    return st


def _minimal_exclusions(excl, st, n_regimes):
    """Whole-cell entries narrowed to the regimes whose infrastructure failures they cover, when every failure
    in the cell is confined to a regime. -> (entries, [(cell label, [regimes])] narrowed)."""
    out, narrowed = [], []
    for x in excl:
        if "regime" in x:
            out.append(x)
            continue
        regs, confined = set(), True
        for r in st["insp"].get((x["seed"], x["field"]), {}).values():
            for g, _, _ in r["infra"]:
                if g is None:
                    confined = False
                else:
                    regs.add(g)
        if not confined or not regs or len(regs) >= n_regimes:
            out.append(x)
            continue
        narrowed.append(("%s#%d" % (x["field"], x["seed"]), sorted(regs)))
        out += [dict(x, regime=g, _from_whole=True) for g in sorted(regs)]
    return out, narrowed


def _assess(cfg, st, excl, mech, mech_path, mech_problem):
    """Verdicts under one set of exclusions."""
    stage, B, Bp = cfg["stage"], cfg["baseline"], cfg["placebo"]
    roles, arms = cfg["candidates"], cfg["arms"]
    problems = {a: list(v) for a, v in st["problems"].items()}
    open_infra, global_problems, excl_log, cell_rows = [], [], [], []
    slot_fail = {a: [] for a in roles}
    failed_cells = {a: set() for a in roles}
    whole = {(x["seed"], x["field"]): x for x in excl if "regime" not in x}
    reg_ex = {}
    for x in excl:
        if "regime" in x:
            reg_ex.setdefault((x["seed"], x["field"]), {})[x["regime"]] = x
    data = {}
    for c in cfg["cells"]:
        key = (c["seed"], c["field"])
        lab = "%s#%d" % (key[1], key[0])
        insp = st["insp"][key]
        ex = reg_ex.get(key, {})
        is_whole = key in whole
        if not is_whole:
            for arm, r in insp.items():
                for rg, m, _ in r["infra"]:
                    if rg not in ex:
                        open_infra.append("%s %s: infrastructure: %s; rerun once in the same lane, then exclude the cell for all arms" % (lab, arm, m))
                for rg, m in r["slot_fail"]:
                    if rg in ex:
                        continue
                    if arm in roles:
                        slot_fail[arm].append("%s: %s" % (lab, m))
                        failed_cells[arm].add(lab)
                    else:
                        problems[arm].append("%s: %s's own slot failed (%s is not a candidate): %s" % (lab, arm, arm, m))
        # exclusions: accepted only on an infrastructure failure seen in the data and in the rerun
        for rg in ([None] if is_whole else sorted(ex)):
            entry = whole[key] if is_whole else ex[rg]
            seen = [(a, m, kind) for a in arms if a in insp for (g, m, kind) in insp[a]["infra"] if is_whole or g == rg]
            cand = ["%s: %s" % (a, m) for a in arms if a in insp and a in roles for (g, m) in insp[a]["slot_fail"] if is_whole or g == rg]
            what = lab if is_whole else "%s %s" % (lab, rg)
            row = {"cell": lab, "regime": rg, "evidence_given": entry["evidence"], "infra_found": ["%s: %s" % (a, m) for a, m, _ in seen],
                   "candidate_failures": cand, "rerun": None}
            why = None
            if not seen:
                why = ("the only failure there is a candidate's slot (%s); a candidate-side failure counts as a clause-5 FAIL and "
                       "is not excluded" % "; ".join(cand)) if cand else \
                      "no infrastructure failure in any arm there (every epoch valid, the slot scored and every reference agent placed)"
            elif cand and not any(a not in roles or kind == "invalid" for a, _, kind in seen):
                why = ("a candidate's slot failed there (%s) and the infrastructure failure is seen only in a candidate's own run, "
                       "not in %s or as an epoch the official rule leaves out: it may be the candidate's doing" % ("; ".join(cand), " or ".join(
                           x for x in (B, Bp if stage == "1" else None) if x)))
            else:
                rr = st["rerun"].get((key[0], key[1], None if entry.get("_from_whole") else rg))
                if rr is None:
                    why = "no rerun record: the plan reruns the failed job once in the same lane before excluding (rerun {arm, path, sha256})"
                else:
                    row["rerun"] = {"arm": rr["arm"], "path": rr["path"], "sha256": rr["sha256"]}
                    first = insp.get(rr["arm"])
                    if rr["problem"]:
                        why = rr["problem"]
                    elif first is None or not any(is_whole or g == rg for g, _, _ in first["infra"]):
                        why = "the rerun is of arm %s, whose listed matrix has no infrastructure failure there" % rr["arm"]
                    elif not any(is_whole or g == rg for g, _, _ in rr["infra"]):
                        why = "the rerun of %s (%s) shows no infrastructure failure there: use it instead of excluding" % (rr["arm"], rr["path"])
            row["status"] = "rejected" if why else "accepted"
            if why:
                global_problems.append("exclusion of %s rejected: %s" % (what, why))
            excl_log.append(row)
        if is_whole:
            cell_rows.append({"seed": key[0], "field": key[1], "excluded": True})
            continue
        loaded = {a: r for a, r in insp.items() if not r["config"] and r["sha256"] and not any(g not in ex for g, _, _ in r["infra"])}
        if B in loaded:
            def sig(r):
                return (r["k"], tuple(sorted(x for x in r["epochs"] if x[1] not in ex)))
            for arm, r in loaded.items():
                if arm == B:
                    continue
                c1 = roles.get(arm) == "noninferiority"
                if not c1 and sig(r) != sig(loaded[B]):
                    problems[arm].append("%s: scenarios (k, ordinal, regime) differ from %s's" % (lab, B))
                if {g: v for g, v in r["roster"].items() if g not in ex and (not c1 or g == LAUNCH)} != {g: v for g, v in loaded[B]["roster"].items() if g not in ex and (not c1 or g == LAUNCH)}:
                    problems[arm].append("%s: non-slot roster differs from %s's" % (lab, B))
        row = {"seed": key[0], "field": key[1], "excluded_regimes": sorted(ex), "arms": {}}
        for arm, r in loaded.items():
            regs = {g: v for g, v in r["regs"].items() if g not in ex}
            names = sorted(regs)
            if names:
                row["arms"][arm] = {"EW": ew(regs, names), "EW11": ew(regs, [r for r in names if r != LAUNCH]) if any(r != LAUNCH for r in names) else None,
                                      "official": official(regs, names), "regimes": len(names)}
            data[(arm, key)] = regs
        cell_rows.append(row)

    def contrasts(arm):
        out, skipped = {}, []
        for key in sorted({k for (a, k) in data}):
            if (arm, key) not in data or (B, key) not in data:
                continue
            da, db = data[(arm, key)], data[(B, key)]
            if roles.get(arm) == "noninferiority":
                da = {r: v for r, v in da.items() if r == LAUNCH}
                db = {r: v for r, v in db.items() if r == LAUNCH}
            names = sorted(db)
            if not names and not da:
                continue  # every regime of the cell excluded
            if sorted(da) != names:
                skipped.append("%s#%d" % (key[1], key[0]))
                continue
            primary = [r for r in names if r != LAUNCH] if roles.get(arm) != "noninferiority" and key[1] in FIELDS else names
            if not primary:
                skipped.append("%s#%d" % (key[1], key[0]))
                continue
            out[key] = {"ew": ew(da, primary) - ew(db, primary), "ew12": ew(da, names) - ew(db, names), "official": official(da, names) - official(db, names),
                        "regimes": {r: (da[r]["T"] - db[r]["T"], da[r]["P"] - db[r]["P"]) for r in names},
                        "noop_gaps": {r: (db[r]["noop_gap"], da[r]["noop_gap"]) for r in names}}
        return out, skipped

    base_blockers = global_problems + open_infra + problems[B] + (problems[Bp] if stage == "1" else [])
    pl = contrasts(Bp)[0] if stage == "1" and not base_blockers else {}
    # provenance: the mechanism JSON covers the matrices the manifest has judged (its own exclusions)
    judged_out = {(x["seed"], x["field"]) for x in cfg["exclude"] if "regime" not in x}
    sha_by_arm = {a: {v["sha256"] for lab, v in fs.items() if (int(lab.split("#")[1]), lab.split("#")[0]) not in judged_out}
                  for a, fs in st["files"].items()}
    mech_dir = os.path.dirname(os.path.abspath(mech_path)) if mech_path else None
    cands = {}
    for arm, rule in roles.items():
        blockers = base_blockers + problems[arm]
        flags = rule_flag_clause(st["slot_flags"].get(arm, {}))
        sf = slot_fail[arm]
        if stage == "retest":
            subs = mechanism_clause(mech, arm, B, rule, sha_by_arm, mech_dir, need_step2=False)
        else:
            if mech_problem is not None:
                subs = {"mechanism": {"status": BLOCKED, "detail": mech_problem}}
            else:
                subs = mechanism_clause(mech, arm, B, rule, sha_by_arm, mech_dir, need_step2=stage == "1")
            subs["slot_failures"] = {"status": FAIL if sf else PASS,
                                     "detail": ("candidate-side failure(s), counted, not excluded: " + "; ".join(sf[:6]) +
                                                (" (+%d more)" % (len(sf) - 6) if len(sf) > 6 else "")) if sf else "none in the counted epochs"}
            subs["slot_rule_flags"] = flags
        if blockers:
            cands[arm] = {"rule": rule, "verdict": BLOCKED, "input_problems": blockers, "slot_failures": sf, "slot_rule_flags": flags}
            continue
        cc, skipped = contrasts(arm)
        ma = (mech or {}).get(arm)
        tagged = ma.get("tagged_mechanism_pnl", {}) if isinstance(ma, dict) else {}
        for (seed, field), cell in cc.items():
            raw = tagged.get("%s#%s" % (field, seed), {}) if isinstance(tagged, dict) else {}
            cell["mechanism_pnl"] = raw if isinstance(raw, dict) else {}
        main = {k: v for k, v in cc.items() if k[1] in FIELDS}
        fs = {k: v for k, v in cc.items() if k[1] == FS_FIELD}
        cov = coverage_clause(skipped, failed_cells[arm])
        if stage == "retest":
            res = retest_decision(main)
            res["rule"] = rule
            res["rule_decision"] = res["decision"]
            rt_mech = {k: v for k, v in subs.items() if k in ("slot_timeouts", "stf", "provenance")}
            rt_status = _combine(rt_mech)
            res["mechanism"] = rt_mech
            if sf or flags["status"] == FAIL or rt_status == FAIL:
                res["decision"] = "REVERT"
                res["detail"] += "; REVERT: candidate-side failure of %s counted (%s)" % (arm, "; ".join(
                    (["slot failures: " + "; ".join(sf[:3])] if sf else []) + ([flags["detail"][:200]] if flags["status"] == FAIL else [])))
            elif cov["status"] == BLOCKED or flags["status"] == BLOCKED or rt_status == BLOCKED:
                res["decision"] = BLOCKED
                res["detail"] += "; BLOCKED: %s" % "; ".join(x["detail"] for x in (cov, flags, *rt_mech.values()) if x["status"] == BLOCKED)
            res["verdict"] = res["decision"]
            res["coverage"] = cov
            res["slot_rule_flags"] = flags
        elif stage == "2":
            res = evaluate_stage2(rule, main, fs, cfg["prior"]["f"], subs)
        else:
            res = evaluate(rule, main, pl, subs, cfg["threshold"], cfg["ask_floor"])
        if stage != "retest":
            res["clauses"]["coverage"] = cov
            res["verdict"] = _combine(res["clauses"])
        res["slot_failures"] = sf
        res["cells_without_contrast"] = skipped
        seeds_paired = res.get("stats", res).get("seeds", [])
        off = [(cc[(s, "FP")]["official"] + cc[(s, "FD")]["official"]) / 2 for s in seeds_paired]
        res["official_weighted"] = {"c": off, "m": mean(off) if off else None,
                                    "d_by_cell": {"%s#%s" % (f, s): v["official"] for (s, f), v in sorted(cc.items())}}
        ew12 = [(cc[(s, "FP")]["ew12"] + cc[(s, "FD")]["ew12"]) / 2 for s in seeds_paired]
        res["ew12"] = {"m": mean(ew12) if ew12 and rule == "superiority" else None,
                       "scope": "12 regimes (minus exclusions)" if rule == "superiority" else "launch only; EW12 unavailable"}
        res["d_ew_by_cell"] = {"%s#%s" % (f, s): v["ew"] for (s, f), v in sorted(cc.items())}
        cands[arm] = res
    placebo_summary = None
    if pl:
        _, pcs, pdb = seed_contrasts(pl)
        ps = t_statistic(pcs, pcs)
        placebo_summary = {k: ps[k] for k in ("n", "m", "sd", "f", "se", "t", "t_crit")}
        placebo_summary.update(c=pcs, dbar_FP=pdb["FP"], dbar_FD=pdb["FD"], check=placebo_check(pcs),
                               regime_dT={"%s#%d" % (f, s): {r: v[0] for r, v in x["regimes"].items()} for (s, f), x in sorted(pl.items())})
    for arm, result in cands.items():
        result["exploratory"] = exploratory_arm(arm, cfg["arm_map"])
        result["agent_dir"] = (cfg["arm_map"] or {}).get(arm)
        if stage == "1":
            result["decision"] = "go to stage 2" if result["verdict"] == PASS else result["verdict"]
            result["stage1_ship_eligible"] = False
    if stage == "1":
        sel = select({a: v["verdict"] for a, v in cands.items()}, roles,
                     {a: v.get("stats", {}).get("m") for a, v in cands.items()})
    else:
        F = list(roles)[0]
        v = cands[F]["verdict"]
        if stage == "2":
            sel = {"F": F, "status": "DECIDED" if v in (PASS, FAIL) else "PENDING",
                   "decision": ("%s passes stage 2 (packaging and docker runs are not judged here)" % F) if v == PASS else
                   ("%s fails stage 2: F2 if the stage-1 verdict has one, else N4" % F) if v == FAIL else "PENDING"}
        else:
            sel = {"F": F, "status": "DECIDED" if v in ("KEEP", "REVERT") else "PENDING",
                   "decision": "KEEP %s" % F if v == "KEEP" else "REVERT to S-00048" if v == "REVERT" else "PENDING"}
    return {"cands": cands, "sel": sel, "excl_log": excl_log, "global_problems": global_problems, "open_infra": open_infra,
            "problems": problems, "cell_rows": cell_rows, "placebo": placebo_summary, "whole": whole}


def cmd_judge(args):
    cfg = build_config(args)
    stage, B, Bp, slot = cfg["stage"], cfg["baseline"], cfg["placebo"], cfg["slot_id"]
    roles = cfg["candidates"]
    mech, mech_path, mech_problem = None, args.mechanism, None
    if mech_path:
        try:
            with open(mech_path) as f:
                mech = json.load(f).get("arms")
            if not isinstance(mech, dict):
                mech, mech_problem = None, "mechanism JSON has no 'arms' object"
        except (OSError, ValueError, AttributeError) as e:
            mech, mech_problem = None, "mechanism JSON unreadable: %s" % e
    st = _inspect(cfg)
    res = _assess(cfg, st, cfg["exclude"], mech, mech_path, mech_problem)
    cands, sel = res["cands"], res["sel"]
    # exclusion scope: the verdict must not depend on excluding a whole cell rather than its failed regimes
    minimal, narrowed = _minimal_exclusions(cfg["exclude"], st, len(cfg["design"]["regimes"]))
    scope = None
    if narrowed:
        alt = _assess(cfg, st, minimal, mech, mech_path, mech_problem)
        same = all(alt["cands"][a]["verdict"] == cands[a]["verdict"] for a in roles) and alt["sel"]["decision"] == sel["decision"]
        scope = {"status": "SAME" if same else "DIFFERS", "narrowed": [{"cell": c, "regimes": r} for c, r in narrowed],
                 "verdicts_whole": {a: cands[a]["verdict"] for a in roles}, "decision_whole": sel["decision"],
                 "verdicts_narrowest": {a: alt["cands"][a]["verdict"] for a in roles}, "decision_narrowest": alt["sel"]["decision"]}
        if not same:
            msg = ("the verdict depends on the exclusion scope: excluding %s whole gives %s (%s); excluding only the regimes with an "
                   "infrastructure failure (%s) gives %s (%s). Ask the user which scope applies" % (
                       ", ".join(c for c, _ in narrowed), scope["verdicts_whole"], sel["decision"],
                       "; ".join("%s %s" % (c, ",".join(r)) for c, r in narrowed), scope["verdicts_narrowest"], alt["sel"]["decision"]))
            for a in roles:
                cands[a] = {"rule": roles[a], "verdict": BLOCKED, "input_problems": [msg]}
            sel = {"F": None, "F2": None, "status": "PENDING", "decision": "PENDING", "note": "exclusion scope decides the result"}
    if stage == "retest":
        # the stage-2 cells must be the very matrices the stage-2 verdict judged
        for arm, labs in (cfg["prior"]["matrices"] or {}).items():
            for lab, rec in labs.items():
                if lab.split("#")[0] not in FIELDS:
                    continue  # FS cells are not part of the re-test
                mine = st["files"].get(arm, {}).get(lab)
                if mine is None or mine["sha256"] != rec.get("sha256"):
                    msg = "%s %s is not the matrix the stage-2 verdict judged" % (arm, lab)
                    for a in cands:
                        cands[a] = {"rule": roles[a], "verdict": BLOCKED, "input_problems": [msg]}
                    sel = {"F": list(roles)[0], "status": "PENDING", "decision": "PENDING"}
    whole = res["whole"]
    files = {a: {lab: dict(v, excluded=(int(lab.split("#")[1]), lab.split("#")[0]) in whole) for lab, v in fs.items()}
             for a, fs in st["files"].items()}
    here = os.path.abspath(__file__) if HERE else None
    out = {
        "tool": "ascon/final/judge2.py", "tool_sha256": here and _sha256(here), "stage": stage,
        "rule": {"1": "final plan Step 6 (stage 1, D1)", "2": "final plan Step 7 (stage 2)", "retest": "final plan Step 9 (re-test)"}[stage],
        "params": {"t_crit": T_CRIT, "placebo_floor": PLACEBO_FLOOR, "threshold": cfg["threshold"], "ask_floor": cfg["ask_floor"],
                   "field_floor": FIELD_FLOOR, "regime_veto": [REGIME_VETO_MEAN, REGIME_VETO_SHARE], "big_loss_usdc": BIG_LOSS_USDC,
                   "big_loss_max_exclusive": BIG_LOSS_MAX, "p99_ms": P99_MS, "tie_pt": TIE_PT, "launch_regime": LAUNCH,
                   "fs_mean_floor": FS_MEAN_FLOOR, "launch_floor": LAUNCH_FLOOR, "statistic": "EW11",
                   "slot_id": slot, "baseline": B, "placebo": Bp if stage == "1" else None},
        "arm_map": cfg["arm_map"], "design": cfg["design"], "nonplan": cfg["nonplan"],
        "prior": {k: v for k, v in (cfg["prior"] or {}).items() if k != "matrices"} or None,
        "inputs": {"manifest": args.manifest and os.path.abspath(args.manifest),
                   "manifest_sha256": args.manifest and _sha256(args.manifest),
                   "mechanism": mech_path and os.path.abspath(mech_path),
                   "mechanism_sha256": (mech_path and os.path.isfile(mech_path) and _sha256(mech_path)) or None,
                   "mechanism_problem": mech_problem, "matrices": files, "exclude": cfg["exclude"]},
        "exclusions": res["excl_log"], "exclusion_scope": scope, "global_problems": res["global_problems"],
        "infrastructure_open": res["open_infra"],
        "input_problems": {a: p for a, p in res["problems"].items() if p},
        "slot_flags": st["slot_flags"],
        "cells": res["cell_rows"], "placebo": res["placebo"], "candidates": cands, "selection": sel,
    }
    if args.out:
        with open(args.out, "w") as f:
            json.dump(out, f, indent=1, default=list)
    if args.json:
        print(json.dumps(out, indent=1, default=list))
    else:
        print_table(out)
    return 0


def print_table(out):
    p = out["params"]
    st = out["stage"]
    if st == "1":
        print("judge2 (plan Step 6, stage 1): EW11 threshold %+.2f, no ask band, t_crit %.2f, placebo floor %.2f" % (
            p["threshold"], p["t_crit"], p["placebo_floor"]))
    elif st == "2":
        pr = out["prior"] or {}
        print("judge2 (plan Step 7, stage 2): t_crit %.2f, m > 0, f from stage 1 = %s (%s path; stage-1 verdict sha256 %s)" % (
            p["t_crit"], "%.3f" % pr["f"] if pr.get("f") is not None else "-", pr.get("path_role"), (pr.get("sha256") or "")[:12]))
    else:
        print("judge2 (plan Step 9, re-test): REVERT if EW11 m <= 0 or mechanism failure (stage-2 verdict sha256 %s)" %
              ((out["prior"] or {}).get("sha256") or "")[:12])
    if out["nonplan"]:
        print("  NON-PLAN (explicitly allowed): " + "; ".join(out["nonplan"]))
    d = out["design"]
    print("  design: seeds %s%s; cells listed %d, excluded whole %d" % (
        d["seeds"], (" + FS %s" % d["fs_seeds"]) if d["fs_seeds"] else "", len(out["cells"]), sum(1 for c in out["cells"] if c.get("excluded"))))
    for x in out["exclusions"]:
        print("  exclusion %-9s %s%s: %s (evidence given: %s; rerun: %s)" % (
            x["status"], x["cell"], (" " + x["regime"]) if x["regime"] else " (whole cell)",
            ("; ".join(x["infra_found"][:2]) or "; ".join(x["candidate_failures"][:2]) or "nothing found")[:160], x["evidence_given"][:80],
            ("%s %s" % (x["rerun"]["arm"], x["rerun"]["sha256"][:12])) if x.get("rerun") else "-"))
    sc = out.get("exclusion_scope")
    if sc:
        print("  exclusion scope %s: whole %s / narrowest (%s) %s" % (sc["status"], sc["decision_whole"],
              "; ".join("%s %s" % (n["cell"], ",".join(n["regimes"])) for n in sc["narrowed"]), sc["decision_narrowest"]))
    for g in out["global_problems"]:
        print("  MANIFEST PROBLEM: " + g)
    for g in out["infrastructure_open"][:8]:
        print("  INFRASTRUCTURE (blocks every candidate): " + g)
    if len(out["infrastructure_open"]) > 8:
        print("  INFRASTRUCTURE: (+%d more)" % (len(out["infrastructure_open"]) - 8))
    for arm, labs in sorted(out["slot_flags"].items()):
        uniq = {}
        for lab, regs in sorted(labs.items()):
            for r, fl in sorted(regs.items()):
                for x in fl:
                    uniq.setdefault(x, []).append("%s %s" % (lab, r))
        for x, where in uniq.items():
            print("  slot flag %-4s [%s] %s: %s" % (arm, flag_kind(x), ", ".join(where[:4]) + (" +%d" % (len(where) - 4) if len(where) > 4 else ""), x[:150]))
    if st == "1":
        if out["placebo"]:
            q = out["placebo"]
            print("  placebo %s: n %d  m %+.3f  sd %s  f %.3f  t %+.3f  check %s (report only)%s" % (p["placebo"], q["n"], q["m"],
                  "%.3f" % q["sd"] if q["sd"] is not None else "-", q["f"], q["t"] or 0, q["check"]["status"],
                  ": " + q["check"]["detail"] if q["check"]["status"] == "WARN" else ""))
        else:
            print("  placebo %s: not available" % p["placebo"])
    for arm, r in out["candidates"].items():
        if r.get("exploratory"):
            print("  %s exploratory: %s (stage 1 alone cannot ship)" % (arm, r.get("decision", r["verdict"])))
        if r["verdict"] == BLOCKED and "input_problems" in r:
            print("  %-4s %-14s %s" % (arm, r["rule"], r["verdict"]))
            for x in r["input_problems"][:8]:
                print("       - " + x)
            if len(r["input_problems"]) > 8:
                print("       - (+%d more)" % (len(r["input_problems"]) - 8))
            continue
        if st == "retest":
            print("  %-4s %s  %s  (n %d; seeds %s)" % (arm, r["verdict"], r.get("detail", ""), r.get("n", 0), r.get("seeds", [])))
            print("       slot failures: %s" % ("; ".join(r["slot_failures"][:6]) or "none"))
            print("       rule flags: %s %s" % (r["slot_rule_flags"]["status"], r["slot_rule_flags"]["detail"][:200]))
            print("       coverage: %s %s" % (r["coverage"]["status"], r["coverage"]["detail"]))
            continue
        s = r["stats"]
        nf = {f: sum(1 for c in r["d_ew_by_cell"] if c.startswith(f + "#")) for f in ("FP", "FD", "FS")}
        print("  %-4s %-14s %-8s m %s  sd %s  f %s  SE %s  t %s  (n %d; cells FP %d FD %d%s)  dbar FP %s FD %s  official m %s" % (
            arm, r["rule"], r["verdict"], "%+.3f" % s["m"] if s["m"] is not None else "-", "%.3f" % s["sd"] if s["sd"] is not None else "-",
            "%.3f" % s["f"] if s["f"] is not None else "-", "%.3f" % s["se"] if s["se"] is not None else "-",
            "%+.3f" % s["t"] if s["t"] is not None else "-", s["n"], nf["FP"], nf["FD"], (" FS %d" % nf["FS"]) if st == "2" else "",
            "%+.3f" % s["dbar_FP"] if s["dbar_FP"] is not None else "-", "%+.3f" % s["dbar_FD"] if s["dbar_FD"] is not None else "-",
            "%+.3f" % r["official_weighted"]["m"] if r["official_weighted"]["m"] is not None else "-"))
        print("       statistic %s; EW12 m %s (%s)" % (s["statistic"], r["ew12"]["m"], r["ew12"]["scope"]))
        for name, cl in r["clauses"].items():
            if name == "5_mechanism":
                print("       %-16s %-8s %s" % (name, cl["status"], "; ".join("%s %s" % (k, v["status"]) for k, v in cl["subclauses"].items())))
                for k, v in cl["subclauses"].items():
                    if v["status"] != PASS:
                        print("         %s: %s" % (k, v["detail"][:200]))
            else:
                print("       %-16s %-8s %s" % (name, cl["status"], cl["detail"]))
    sel = out["selection"]
    print("  SELECTION: %s%s" % (sel["decision"], ("  (" + sel["note"] + ")") if sel.get("note") else ""))


def main(argv):
    ap = argparse.ArgumentParser(prog="judge2.py", description="Final plan Step 6/7/9 judge and official-standings validator.")
    sub = ap.add_subparsers(dest="cmd")
    j = sub.add_parser("judge")
    j.add_argument("--manifest")
    j.add_argument("--stage", choices=STAGES)
    j.add_argument("--stage1-verdict", dest="stage1_verdict")
    j.add_argument("--stage2-verdict", dest="stage2_verdict")
    j.add_argument("--cell", action="append", help="FIELD:SEED:ARM=PATH (matrix.json)")
    j.add_argument("--arms", nargs="+", help="LABEL=agent-dir; B and B' always required")
    j.add_argument("--candidate", action="append", help="ARM=superiority|noninferiority")
    j.add_argument("--exclude", action="append", help="SEED:FIELD[:REGIME]=EVIDENCE (reason infra)")
    j.add_argument("--baseline")
    j.add_argument("--placebo")
    j.add_argument("--slot")
    j.add_argument("--threshold", type=float)
    j.add_argument("--ask-floor", type=float, dest="ask_floor")
    j.add_argument("--allow-nonplan-threshold", action="store_true", dest="allow_nonplan_threshold")
    j.add_argument("--allow-nonplan-design", action="store_true", dest="allow_nonplan_design")
    j.add_argument("--mechanism")
    j.add_argument("--out")
    j.add_argument("--json", action="store_true")
    v = sub.add_parser("validate")
    v.add_argument("paths", nargs="+")
    v.add_argument("--tol", type=float, default=1e-9)
    v.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "judge":
        try:
            return cmd_judge(args)
        except InputError as e:
            print("judge2: input rejected: %s" % e, file=sys.stderr)
            return 2
        except (OSError, ValueError) as e:
            print("judge2: cannot read the input: %s" % e, file=sys.stderr)
            return 2
    if args.cmd == "validate":
        return cmd_validate(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
