#!/usr/bin/env python3
"""Monte Carlo of the approved final plan: B, B', C1 (launch only), R and one W.

python3 ascon/final/mc.py run --noise noise.json --sims 20000 --effects 0,0.5,1.0
R/W effects apply to the 11 non-launch regimes, equally by regime/field. Both
have the grid effect unless --effect-w overrides W. Launch effect defaults to
zero (--effect-launch); C1's --effect-c1 is launch-only. U4 is fixed: +0.20,
no ask band. Each verdict uses judge2's shared decision functions. F and F2
use the same fresh stage-2 B cells, followed by an eight-seed combined retest.
FS uses only launch/cdp-incident/lending-incident. No G0 or trap (e) gate.

The input noise model uses identical-code per-regime contrast RMS (build-noise),
with per-arm sd = contrast_sd/sqrt(2), empirical or Gaussian draws, placeholder
seed heterogeneity tau and FP/FD correlation rho. FS copies FD unless supplied.
Measured launch noise is an upper bound from clone races; --launch-sd cap or a
number is an explicitly labelled sensitivity. Placebo-noise can replace the
placeholder B' model with measured B'-B spreads. dP uses delta T*sigma_P/10.

Clause 3 needs OWN tagged mechanism PnL, not delta P. Its default here is an
explicit nonnegative assumption (0), conservative for false-ship; override
with --mechanism-pnl for sensitivity. Timeouts, latency, ties, STF, c1L (a)-(d),
input validity and the noop guard are assumed to pass, not measured. These
assumptions limit calibration; this is not a backtest or live acceptance.

Reports false-ship of EITHER R or W under zero effect (target <=2%), R/W ship
rates at +0.5/+1.0, kept rate after retest, C1 fallback and no-ship. It also
reports EW12 and official-weighted delta means, neither used for superiority.
Code/noise SHA256, assumptions, seed and simulation count accompany the table.
Tuning is opt-in and searches only stricter t/f values; it never changes files.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import random
import sys
import time

_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("judge2", os.path.join(_here, "judge2.py"))
J = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(J)

REGIMES = ["calm", "cex-drift", "informed-flow", "whale", "lending-incident", "crash", "depeg", "vuln",
           "spike", "depeg-persist", "cdp-incident", "launch"]
MECH_PASS = {"mc": {"status": J.PASS, "detail": "assumed (not modelled)"}}
STAGE1_SEEDS, STAGE2_SEEDS, RETEST_SEEDS, FS_SEEDS = 4, 4, 4, 2


# ---------------------------------------------------------------- build-noise

def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def cmd_build_noise(args):
    a, b = args.pair.split(":", 1)
    fields = {}
    sources = {}
    for spec in args.matrix:
        field, path = spec.split("=", 1)
        mpath = path if path.endswith(".json") else os.path.join(path, "matrix.json")
        with open(mpath) as f:
            st = J.compute_standings(json.load(f))
        seeds = {e["seed"] for e in st["epochs"]}
        sources.setdefault(field, []).append({"path": os.path.abspath(mpath), "sha256": _sha(mpath), "seeds": sorted(seeds)})
        for e in st["epochs"]:
            if "excluded" in e or a not in e["tByAgent"] or b not in e["tByAgent"]:
                continue
            reg = fields.setdefault(field, {}).setdefault(e["regime"], {"values": [], "sigma_p": []})
            reg["values"].append(e["tByAgent"][a] - e["tByAgent"][b])
            reg["sigma_p"].append(e["sigma"])
    out_fields = {}
    for field, regs in fields.items():
        out_fields[field] = {}
        for r in REGIMES:
            if r not in regs:
                raise SystemExit("build-noise: field %s has no %s epoch with both %s and %s" % (field, r, a, b))
            v = regs[r]["values"]
            out_fields[field][r] = {"values": v, "contrast_sd": math.sqrt(sum(x * x for x in v) / len(v)),
                                    "sigma_p": sum(regs[r]["sigma_p"]) / len(regs[r]["sigma_p"]), "n": len(v)}
    for need in ("FP", "FD"):
        if need not in out_fields:
            raise SystemExit("build-noise: no matrices for field %s" % need)
    model = {
        "schema": "ascon-mc-noise/1",
        "built_by": "ascon/final/mc.py build-noise", "built_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "pair": [a, b],
        "measure": "per regime: T(%s) - T(%s) in the same epoch; contrast_sd = root mean square about 0 "
                   "(the pair runs identical code, so any mean is noise too)" % (a, b),
        "proxy": {"FP": args.fp_label, "FD": args.fd_label, "FS": "copy of FD (placeholder: no specialist-field data)"},
        "sources": sources,
        "fields": out_fields,
        "copies": {"FS": "FD"},
        "placebo": {"placeholder": True, "model": "same per-regime noise as the candidate arms; replace with stage-1 B' contrasts"},
        "tau": {"FP": 0.25, "FD": 0.5, "FS": 0.5, "placeholder": True,
                "note": "sd of a candidate's true per-(seed, field) effect around its mean; not measured"},
        "rho_field": 0.0,
        "rho_note": "correlation of one seed's FP and FD noise (same market path); placeholder",
        "draw": "gaussian",
    }
    with open(args.out, "w") as f:
        json.dump(model, f, indent=1)
    print("noise model -> %s" % args.out)
    for field in ("FP", "FD"):
        ew = math.sqrt(sum(out_fields[field][r]["contrast_sd"] ** 2 for r in REGIMES if r != J.LAUNCH)) / 11
        print("  %s: per-regime contrast sd %s | implied EW11-contrast sd per cell %.2f" % (
            field, " ".join("%s %.1f" % (r[:5], out_fields[field][r]["contrast_sd"]) for r in REGIMES), ew))
    return 0


# ---------------------------------------------------------------- simulation

def _finite_nonneg(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0


def read_placebo(section):
    """The noise file's "placebo" section -> None (B' gets the candidate noise), ("scale", s) or
    ("sd", {field: {regime: sd}}). Raises SystemExit on anything malformed."""
    if section is None:
        return None
    if not isinstance(section, dict) or not isinstance(section.get("placeholder"), bool):
        raise SystemExit("mc: noise placebo section needs a boolean 'placeholder': %r" % (section,))
    if section["placeholder"]:
        return None
    has = [k for k in ("scale", "fields") if k in section]
    if len(has) != 1:
        raise SystemExit("mc: noise placebo section (placeholder false) needs exactly one of 'scale' or 'fields'")
    if has[0] == "scale":
        if not _finite_nonneg(section["scale"]):
            raise SystemExit("mc: noise placebo scale must be a finite number >= 0: %r" % (section["scale"],))
        return ("scale", float(section["scale"]))
    flds = section["fields"]
    out = {}
    for f in ("FP", "FD"):
        if not isinstance(flds, dict) or not isinstance(flds.get(f), dict):
            raise SystemExit("mc: noise placebo fields.%s missing" % f)
        out[f] = {}
        for r in REGIMES:
            v = flds[f].get(r)
            sd = v.get("contrast_sd") if isinstance(v, dict) else None
            if not _finite_nonneg(sd):
                raise SystemExit("mc: noise placebo fields.%s.%s.contrast_sd missing or not a finite number >= 0: %r" % (f, r, sd))
            out[f][r] = float(sd)
    return ("sd", out)


class Model:
    def __init__(self, noise, args):
        self.f = {}
        for field in ("FP", "FD"):
            self.f[field] = noise["fields"][field]
        self.f["FS"] = noise["fields"].get("FS") or noise["fields"][noise.get("copies", {}).get("FS", "FD")]
        self.scale = args.scale
        self.effect_launch = getattr(args, "effect_launch", 0.0)
        self.mechanism_pnl = getattr(args, "mechanism_pnl", 0.0)
        self.launch_label = "measured r3-r2 (upper bound: clone launch race)"
        if args.launch_sd is None:
            self.launch_sd = None
        elif args.launch_sd == "cap":
            self.launch_sd = {f: max(self.f[f][r]["contrast_sd"] for r in REGIMES if r != J.LAUNCH) * self.scale for f in self.f}
            self.launch_label = "cap = largest non-launch sd (%s)" % ", ".join("%s %.2f" % (f, v) for f, v in sorted(self.launch_sd.items()))
        else:
            try:
                x = float(args.launch_sd)
            except ValueError:
                raise SystemExit("mc: --launch-sd wants a number or 'cap': %r" % args.launch_sd)
            if not _finite_nonneg(x):
                raise SystemExit("mc: --launch-sd must be >= 0")
            self.launch_sd = {f: x for f in self.f}
            self.launch_label = "%.2f (given)" % x
        self.rho = noise.get("rho_field", 0.0) if args.rho is None else args.rho
        tau = noise.get("tau", {})
        self.tau = {f: (tau.get(f, 0.0) if args.tau is None else args.tau) for f in ("FP", "FD", "FS")}
        self.draw = args.draw or noise.get("draw", "gaussian")
        self.sd = {f: {r: self._sd(f, r) for r in REGIMES} for f in self.f}
        self.pool = {f: {r: [x for v in self.f[f][r]["values"] for x in (v, -v)] for r in REGIMES} for f in self.f}
        self.sigp = {f: {r: self.f[f][r]["sigma_p"] for r in REGIMES} for f in self.f}
        pl = read_placebo(noise.get("placebo"))
        self.placebo_label = "candidate noise (placeholder)"
        self.placebo_sd = None
        if pl is not None and pl[0] == "scale":
            self.placebo_sd = {f: {r: pl[1] * self.sd[f][r] for r in REGIMES} for f in ("FP", "FD")}
            self.placebo_label = "B + N(0, %.2f x candidate contrast sd)" % pl[1]
        elif pl is not None:
            self.placebo_sd = pl[1]
            self.placebo_label = "B + N(0, measured B'-B sd per regime)"

    def _sd(self, f, r):
        if r == J.LAUNCH and self.launch_sd is not None:
            return self.launch_sd[f]
        return self.f[f][r]["contrast_sd"] * self.scale

    def eta(self, rng, f, r, z=None):
        """One arm's noise in one cell; z (a standard normal) lets FP and FD share a seed's draw.
        empirical: a sign-randomised measured contrast (rho is not applied); an overridden launch sd stays
        Gaussian."""
        if self.draw == "empirical" and not (r == J.LAUNCH and self.launch_sd is not None):
            return rng.choice(self.pool[f][r]) * self.scale / math.sqrt(2)
        return (z if z is not None else rng.gauss(0.0, 1.0)) * self.sd[f][r] / math.sqrt(2)


def sim_stage(rng, model, arms, n_seeds, fields):
    """arms: {arm: true per-regime effect}. Returns {arm: {(seed, field): {regime: T}}} (T relative to 50).
    With a placebo section in the noise file, B' is B's own draw plus the placebo noise (B must come first)."""
    out = {a: {} for a in arms}
    for s in range(n_seeds):
        for a, eff in arms.items():
            if a == "B'" and model.placebo_sd is not None:
                for f in fields:
                    out[a][(s, f)] = {r: out["B"][(s, f)][r] + rng.gauss(0.0, model.placebo_sd[f][r]) for r in REGIMES}
                continue
            het = {f: (rng.gauss(0.0, model.tau[f]) if eff is not None and a not in ("B", "B'") else 0.0) for f in fields}
            for r in REGIMES:
                z1 = rng.gauss(0.0, 1.0)
                z2 = model.rho * z1 + math.sqrt(1 - model.rho ** 2) * rng.gauss(0.0, 1.0)
                for f in fields:
                    z = z1 if f == fields[0] else z2
                    effect = (eff or 0.0) if r != J.LAUNCH or a == "C1" else model.effect_launch if a not in ("B", "B'") else 0.0
                    t = effect + het[f] + model.eta(rng, f, r, z)
                    if a == "C1" and r != J.LAUNCH:
                        t = out["B"][(s, f)][r]
                    out[a].setdefault((s, f), {})[r] = t
    return out


def contrasts(model, sim, arm, base="B", launch_only=False):
    cells = {}
    for key, regs in sim[arm].items():
        b = sim[base][key]
        f = key[1]
        names = [J.LAUNCH] if launch_only or arm == "C1" else list(J.FS_REGIMES) if f == "FS" else REGIMES
        d = {r: regs[r] - b[r] for r in names}
        primary = [r for r in names if r != J.LAUNCH] or names
        cells[key] = {"ew": J.mean([d[r] for r in primary]), "ew12": J.mean(list(d.values())),
                      "official": sum(J.weight_of(REGIMES.index(r) + 1, 12) * d[r] for r in names) / sum(J.weight_of(REGIMES.index(r) + 1, 12) for r in names),
                      "mechanism_pnl": {r: model.mechanism_pnl for r in names},
                      "regimes": {r: (d[r], d[r] * model.sigp[f][r] / 10.0) for r in names}}
    return cells


def stage2(model, rng, rule, eff, f1, args, n_seeds=STAGE2_SEEDS):
    """Single-arm helper; the tree below evaluates F/F2 with shared stage-2 B draws."""
    arm = "C1" if rule == "noninferiority" else "R"
    sim = sim_stage(rng, model, {"B": None, arm: eff}, n_seeds, ("FP", "FD"))
    cells = contrasts(model, sim, arm)
    fsim = sim_stage(rng, model, {"B": None, arm: eff}, FS_SEEDS, ("FS",))
    f = f1 if args.stage2_f == "stage1" else J.PLACEBO_FLOOR
    v = J.evaluate_stage2(rule, cells, contrasts(model, fsim, arm), f, MECH_PASS, noop_sub=MECH_PASS["mc"])
    return v["verdict"] == J.PASS, cells


def retest_keeps(model, rng, eff, stage2_cells):
    sim = sim_stage(rng, model, {"B": None, "R": eff}, RETEST_SEEDS, ("FP", "FD"))
    cells = {(s + 100, f): v for (s, f), v in contrasts(model, sim, "R").items()}
    cells.update(stage2_cells)
    return J.retest_decision(cells)["decision"] == "KEEP"


def replicate(model, rng, eff_r, eff_c1, args, policies):
    eff_w = getattr(args, "effect_w", None)
    effects = {"C1": eff_c1, "R": eff_r, "W": eff_r if eff_w is None else eff_w}
    roles = {"R": "superiority", "W": "superiority", "C1": "noninferiority"}
    s1 = sim_stage(rng, model, {"B": None, "B'": None, **effects}, STAGE1_SEEDS, ("FP", "FD"))
    cells = {a: contrasts(model, s1, a) for a in effects}
    cp = contrasts(model, s1, "B'")
    rows = {}
    for name, thr in policies.items():
        ev = {a: J.evaluate(roles[a], cells[a], cp, MECH_PASS, threshold=thr) for a in roles}
        sel = J.select({a: v["verdict"] for a, v in ev.items()}, roles, {a: v["stats"]["m"] for a, v in ev.items()})
        row = {"s1_R": ev["R"]["verdict"] == J.PASS, "s1_W": ev["W"]["verdict"] == J.PASS,
               "s1_C1": ev["C1"]["verdict"] == J.PASS, "s1_pending": sel["status"] != "DECIDED",
               "s1_Bwarn": ev["R"]["placebo_check"]["status"] == "WARN", "ship": None, "kept": False,
               "ew12_R": J.mean([v["ew12"] for v in cells["R"].values()]),
               "official_R": J.mean([v["official"] for v in cells["R"].values()])}
        chosen = [a for a in (sel["F"], sel["F2"]) if a is not None]
        if chosen and sel["status"] == "DECIDED":
            arms = {"B": None, **{a: effects[a] for a in chosen}}
            sim2 = sim_stage(rng, model, arms, STAGE2_SEEDS, ("FP", "FD"))
            simfs = sim_stage(rng, model, arms, FS_SEEDS, ("FS",))
            f = ev["R"]["stats"]["f"] if args.stage2_f == "stage1" else J.PLACEBO_FLOOR
            for a in chosen:
                cc = contrasts(model, sim2, a)
                vv = J.evaluate_stage2(roles[a], cc, contrasts(model, simfs, a), f, MECH_PASS, noop_sub=MECH_PASS["mc"])
                if vv["verdict"] == J.PASS:
                    row["ship"] = a
                    if a in ("R", "W"):
                        row["kept"] = retest_keeps(model, rng, effects[a], cc)
                    break
        rows[name] = row
    return rows


def run_grid(model, args, effects, policies, sims, seed):
    res = {}
    for eff in effects:
        rng = random.Random(seed)
        keys = ("s1_R", "s1_W", "s1_C1", "s1_pending", "s1_Bwarn", "ship_R", "ship_W", "ship_RW",
                "ship_C1", "ship_none", "R_kept", "RW_kept", "ew12_R", "official_R")
        acc = {p: dict.fromkeys(keys, 0) for p in policies}
        for _ in range(sims):
            rows = replicate(model, rng, eff, args.effect_c1, args, policies)
            for p, row in rows.items():
                a = acc[p]
                for k in ("s1_R", "s1_W", "s1_C1", "s1_pending", "s1_Bwarn", "ew12_R", "official_R"):
                    a[k] += row[k]
                a["ship_" + (row["ship"] or "none")] += 1
                a["ship_RW"] += row["ship"] in ("R", "W")
                a["R_kept"] += row["ship"] == "R" and row["kept"]
                a["RW_kept"] += row["ship"] in ("R", "W") and row["kept"]
        res[eff] = {p: {k: v / sims for k, v in a.items()} for p, a in acc.items()}
    return res


def upper95(p, n):
    # Wilson score upper bound
    z = 1.96
    den = 1 + z * z / n
    centre = p + z * z / (2 * n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centre + half) / den


def cmd_run(args):
    with open(args.noise) as f:
        noise = json.load(f)
    model = Model(noise, args)
    effects = [float(x) for x in args.effects.split(",")]
    policies = {"approved": J.THRESHOLD}
    t0 = time.time()
    res = run_grid(model, args, effects, policies, args.sims, args.rng_seed)
    out = {"code_sha256": {"mc.py": _sha(os.path.abspath(__file__)), "judge2.py": _sha(os.path.join(_here, "judge2.py"))},
           "noise": os.path.abspath(args.noise), "noise_sha256": _sha(args.noise), "sims": args.sims, "rng_seed": args.rng_seed,
           "draw": model.draw, "scale": args.scale, "launch_sd": args.launch_sd, "launch_label": model.launch_label,
           "placebo_model": model.placebo_label, "rho": model.rho, "tau": model.tau,
           "effect_c1": args.effect_c1, "effect_w": args.effect_w, "effect_launch": args.effect_launch,
           "mechanism_pnl_assumed": args.mechanism_pnl, "stage2_f": args.stage2_f,
           "assumed_pass": ["mechanism clause 5", "c1L (a)-(d)", "input guards", "noop guard"],
           "statistic": "EW11", "threshold": J.THRESHOLD, "ask_band": False,
           "t_crit": J.T_CRIT, "placebo_floor": J.PLACEBO_FLOOR, "results": {str(k): v for k, v in res.items()},
           "seconds": round(time.time() - t0, 1)}
    print("mc: %s, %d sims/effect, draw %s, scale %.2f, launch sd %s, B' %s, rho %.2f, tau %s, C1 effect %+.2f, stage-2 f %s%s" % (
        os.path.basename(args.noise), args.sims, model.draw, args.scale, model.launch_label, model.placebo_label,
        model.rho, {k: round(v, 2) for k, v in model.tau.items()}, args.effect_c1, args.stage2_f,
        "" if args.stage2_f == "stage1" else " (sensitivity, not the pinned rule)"))
    print("  code sha256: mc.py %s judge2.py %s" % (out["code_sha256"]["mc.py"][:12], out["code_sha256"]["judge2.py"][:12]))
    print("  effect  policy    s1 R     s1 W   s1 C1  s1 pend s1 Bwarn  ship R  ship W ship R/W R/W kept ship C1    none   EW12 R official R")
    for eff in effects:
        for p in policies:
            r = res[eff][p]
            keys = ("s1_R", "s1_W", "s1_C1", "s1_pending", "s1_Bwarn", "ship_R", "ship_W", "ship_RW", "RW_kept", "ship_C1", "ship_none", "ew12_R", "official_R")
            print("  %+.2f %-8s %s" % (eff, p, " ".join("%7.4f" % r[k] for k in keys)))
    print("  assumptions: clause 5, c1L (a)-(d), noop and input guards PASS; own tagged mechanism PnL = %g per cell/regime" % args.mechanism_pnl)
    verdicts = {}
    if 0.0 in res:
        for p in policies:
            fs = res[0.0][p]["ship_RW"]
            ub = upper95(fs, args.sims)
            calib = res[0.0][p]["s1_R"]
            verdicts[p] = {"false_ship": fs, "false_ship_upper95": ub, "meets_target": ub <= args.target,
                           "stage1_null_pass": calib, "stage1_null_ok_alpha_plus_5pt": calib <= 0.10 + 0.05}
            print("  %-6s false-ship (R or W shipped, true effect 0) %.4f (95%% upper %.4f) -> %s target %.3f; stage-1 null pass %.4f (<= alpha+5pt = 0.15: %s)" % (
                p, fs, ub, "MEETS" if ub <= args.target else "EXCEEDS", args.target, calib, "yes" if calib <= 0.15 else "NO"))
    out["verdicts"] = verdicts
    if args.tune:
        out["tune"] = tune(model, args, policies, verdicts)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(out, f, indent=1)
    return 0


def tune(model, args, policies, verdicts):
    """Tighter-only search: the smallest (t_crit, floor) at or above the current pair that meets the target."""
    rec = {}
    base_t, base_f = J.T_CRIT, J.PLACEBO_FLOOR
    for p, v in verdicts.items():
        if v["meets_target"]:
            rec[p] = {"recommend": "keep t_crit %.2f, floor %.2f (meets target; no loosening is ever recommended)" % (base_t, base_f)}
            print("  tune %-6s keep current thresholds" % p)
            continue
        found = None
        for t in (1.64, 1.8, 2.0, 2.2, 2.4, 2.6, 3.0, 3.5):
            for fl in (0.25, 0.5, 0.75, 1.0, 1.5):
                if t < base_t or fl < base_f:
                    continue
                J.T_CRIT, J.PLACEBO_FLOOR = t, fl
                try:
                    r = run_grid(model, args, [0.0, 1.0], {p: policies[p]}, args.tune_sims, args.rng_seed + 7)
                finally:
                    J.T_CRIT, J.PLACEBO_FLOOR = base_t, base_f
                fs = r[0.0][p]["ship_RW"]
                if upper95(fs, args.tune_sims) <= args.target:
                    found = {"t_crit": t, "floor": fl, "false_ship": fs, "ship_R_at_1.0": r[1.0][p]["ship_R"]}
                    break
            if found:
                break
        rec[p] = found or {"recommend": "no tested pair meets the target"}
        print("  tune %-6s %s" % (p, found or "no tested pair meets the target"))
    return rec


def cmd_placebo_noise(args):
    """Fill a noise file's placebo section from a stage-1 judge2 verdict: per field and regime, the root mean
    square of B' - B dT over the verdict's placebo cells (the same 'about 0' measure build-noise uses)."""
    with open(args.verdict) as f:
        v = json.load(f)
    if v.get("tool") != "ascon/final/judge2.py" or v.get("stage") != "1" or not isinstance(v.get("placebo"), dict):
        raise SystemExit("placebo-noise: %s is not a stage-1 judge2 verdict with placebo contrasts" % args.verdict)
    cells = v["placebo"].get("regime_dT") or {}
    vals = {}
    for lab, regs in cells.items():
        field = lab.split("#")[0]
        for r, dt in regs.items():
            vals.setdefault(field, {}).setdefault(r, []).append(dt)
    flds = {}
    for f in ("FP", "FD"):
        flds[f] = {}
        for r in REGIMES:
            x = vals.get(f, {}).get(r) or []
            if len(x) < 2:
                raise SystemExit("placebo-noise: %s %s has %d placebo value(s); need >= 2" % (f, r, len(x)))
            flds[f][r] = {"contrast_sd": math.sqrt(sum(d * d for d in x) / len(x)), "n": len(x), "values": x}
    with open(args.noise) as f:
        noise = json.load(f)
    noise["placebo"] = {"placeholder": False, "fields": flds, "source": os.path.abspath(args.verdict), "source_sha256": _sha(args.verdict),
                        "measure": "per regime: T(B') - T(B) in each placebo cell; contrast_sd = root mean square about 0"}
    with open(args.out, "w") as f:
        json.dump(noise, f, indent=1)
    print("placebo noise -> %s (%s)" % (args.out, "; ".join("%s ew-sd/cell %.2f" % (
        f, math.sqrt(sum(flds[f][r]["contrast_sd"] ** 2 for r in REGIMES)) / len(REGIMES)) for f in ("FP", "FD"))))
    return 0


def main(argv):
    ap = argparse.ArgumentParser(prog="mc.py")
    sub = ap.add_subparsers(dest="cmd")
    pn = sub.add_parser("placebo-noise")
    pn.add_argument("--verdict", required=True)
    pn.add_argument("--noise", required=True)
    pn.add_argument("--out", required=True)
    b = sub.add_parser("build-noise")
    b.add_argument("--pair", required=True, help="A:B, identical-code agents present in every matrix")
    b.add_argument("--matrix", action="append", required=True, help="FIELD=<matrix dir or matrix.json>, FIELD in FP/FD")
    b.add_argument("--fp-label", default="quiet field (10 agents incl. r2/r3/opus-1 clones), seeds 202-606")
    b.add_argument("--fd-label", default="active field (14 agents incl. r2/r3/opus-1 clones), seeds 202-606")
    b.add_argument("--out", required=True)
    r = sub.add_parser("run")
    r.add_argument("--noise", required=True)
    r.add_argument("--sims", type=int, default=20000)
    r.add_argument("--tune-sims", type=int, default=10000, dest="tune_sims")
    r.add_argument("--rng-seed", type=int, default=1, dest="rng_seed")
    r.add_argument("--effects", default="0,0.5,1.0")
    r.add_argument("--effect-c1", type=float, default=0.0, dest="effect_c1")
    r.add_argument("--draw", choices=("gaussian", "empirical"))
    r.add_argument("--scale", type=float, default=1.0)
    r.add_argument("--launch-sd", dest="launch_sd", help="a number, or 'cap' (largest non-launch sd per field)")
    r.add_argument("--rho", type=float)
    r.add_argument("--tau", type=float)
    r.add_argument("--stage2-f", choices=("stage1", "floor"), default="stage1", dest="stage2_f")
    r.add_argument("--effect-w", type=float, help="W non-launch effect (default: same as R grid)")
    r.add_argument("--effect-launch", type=float, default=0.0, help="R/W launch effect, judged separately")
    r.add_argument("--mechanism-pnl", type=float, default=0.0, help="assumed own tagged PnL per cell/regime; sensitivity only")
    r.add_argument("--target", type=float, default=0.02)
    r.add_argument("--tune", action="store_true")
    r.add_argument("--json")
    args = ap.parse_args(argv)
    if args.cmd == "build-noise":
        return cmd_build_noise(args)
    if args.cmd == "placebo-noise":
        return cmd_placebo_noise(args)
    if args.cmd == "run":
        return cmd_run(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
