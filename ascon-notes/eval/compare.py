#!/usr/bin/env python3
"""Compare isolated ASCON candidates against roster references using paired bootstrap."""
import argparse
import csv
import json
import random
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
OUT_DIR = EVAL_DIR / "out"
REFERENCES = {"noop", "multi-arb", "crowd", "clean-arb"}


def resolve_index(value):
    path = Path(value)
    if path.is_dir():
        path = path / "index.tsv"
    if path.name != "index.tsv":
        path = OUT_DIR / value / "index.tsv"
    return path.resolve()


def candidate_name(value, index):
    p = Path(value)
    label = p.parent.name if p.name == "index.tsv" or p.is_dir() else str(value)
    label = re.sub(r"-s\d+(?:_\d+)*$", "", label)
    return label[4:] if label.startswith("iso-") else label


def read_index(value):
    index = resolve_index(value)
    with index.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))
    counts = Counter(row.get("run_dir", "") for row in rows if row.get("run_dir"))
    parsed = []
    for row in rows:
        reason = None
        location = row.get("run_dir", "")
        if counts.get(location, 0) > 1:
            reason = "run_dir重複"
        elif row.get("exit_code") != "0":
            reason = "exit_code不正"
        try:
            run_dir = Path(location) if Path(location).is_absolute() else index.parents[4] / location
            summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            summary = None
            reason = reason or "summary欠測/不正"
        if summary is not None and not reason:
            if (summary.get("valueSeries") or {}).get("failedReads") != 0:
                reason = "failedReads不正/欠測"
            elif summary.get("violations"):
                reason = "violationsあり"
        agents = {}
        if summary is not None:
            try:
                agents = {a["id"]: a["pnlUsdc"] for a in summary["agents"] if isinstance(a.get("pnlUsdc"), (int, float))}
            except (KeyError, TypeError, AttributeError):
                reason = reason or "agents不正"
        parsed.append((row.get("regime", ""), row.get("seed", ""), agents, reason))
    return parsed


def bootstrap(values, count, seed):
    rng = random.Random(seed)
    n = len(values)
    means = [sum(values[rng.randrange(n)] for _ in range(n)) / n for _ in range(count)]
    means.sort()
    return means[int(.025 * count)], means[min(count - 1, int(.975 * count))]


def fmt(x):
    return "欠測" if x is None else f"{x:.1f}"


def stats(values, boot, seed):
    if not values:
        return None, None, None
    lo, hi = bootstrap(values, boot, seed)
    return statistics.mean(values), (lo, hi), sum(x > 0 for x in values)


def verdict(ci, n, minimum=1):
    if ci is None or n < minimum:
        return "対が少なく判定不能" if n < minimum else "判定不能"
    return "有意に正" if ci[0] > 0 else "有意に負" if ci[1] < 0 else "有意差なし"


def render(inputs, ref, boot, seed):
    candidates = {}
    excluded = Counter()
    for value in inputs:
        index = resolve_index(value)
        name = candidate_name(value, index)
        target = candidates.setdefault(name, {})
        for regime, scenario_seed, agents, reason in read_index(value):
            if reason:
                excluded[reason] += 1
                continue
            key = (regime, scenario_seed)
            if key in target:
                excluded["候補内の対重複"] += 1
                target.pop(key, None)
                continue
            if all(k in agents for k in (ref, "noop", "crowd")):
                candidate = next((a for a in agents if a not in REFERENCES), None)
                if candidate is None:
                    excluded["候補P欠測"] += 1
                    continue
                target[key] = {"cand": agents[candidate], ref: agents[ref], "noop": agents["noop"], "crowd": agents["crowd"]}
            else:
                excluded["必要roster P欠測"] += 1
    total_pairs = sum(len(data) for data in candidates.values())
    out = [f"# ASCON 候補比較", "", f"使用した (regime, seed): {total_pairs}（候補別の合計）", f"除外した run: {sum(excluded.values())}"]
    out.extend([f"- {reason}: {count}" for reason, count in sorted(excluded.items())] or ["- なし"])
    out.extend([f"候補: {len(candidates)} / bootstrap: {boot}, seed: {seed}", ""])
    for name, data in candidates.items():
        out.append(f"## {name}")
        out.append(f"使用した (regime, seed): {len(data)}")
        out.append("")
        out.extend(["| 差 | 平均差 | 95% CI | 正の件数/全件数 | 判定 |", "|---|---:|---:|---:|---|"])
        for key, label in ((ref, "d_ref"), ("noop", "d_noop"), ("crowd", "d_crowd")):
            vals = [v["cand"] - v[key] for v in data.values()]
            mean, ci, pos = stats(vals, boot, seed)
            out.append(f"| {label} | {fmt(mean)} | {fmt(ci[0])} – {fmt(ci[1])} | {pos}/{len(vals)} | {verdict(ci, len(vals))} |")
        out.extend(["", "レジーム別平均差（seed 平均）", "", "| レジーム | 件数 | d_ref | d_noop | d_crowd |", "|---|---:|---:|---:|---:|"])
        regimes = sorted({r for r, _ in data})
        for regime in regimes:
            subset = [v for (r, _), v in data.items() if r == regime]
            cells = [fmt(statistics.mean(v["cand"] - v[k] for v in subset)) for k in (ref, "noop", "crowd")]
            out.append(f"| {regime} | {len(subset)} | " + " | ".join(cells) + " |")
        out.append("")
        for key, label in ((ref, "d_ref"), ("noop", "d_noop"), ("crowd", "d_crowd")):
            means = [statistics.mean(v["cand"] - v[key] for (r, _), v in data.items() if r == regime) for regime in regimes]
            out.append(f"レジーム等重み {label}: {fmt(statistics.mean(means)) if means else '欠測'}")
        out.append("")
    names = list(candidates)
    if len(names) > 1:
        out.extend(["## 候補間比較（d_ref 差）", "", "| 比較 | 共通対 | 平均差 | 95% CI | 判定 |", "|---|---:|---:|---:|---|"])
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                common = set(candidates[a]) & set(candidates[b])
                vals = [(candidates[a][k]["cand"] - candidates[a][k][ref]) - (candidates[b][k]["cand"] - candidates[b][k][ref]) for k in common]
                mean, ci, _ = stats(vals, boot, seed)
                out.append(f"| {a} − {b} | {len(vals)} | {fmt(mean)} | {fmt(ci[0])} – {fmt(ci[1])} | {verdict(ci, len(vals), 12)} |")
    return "\n".join(out) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("--ref", default="multi-arb")
    parser.add_argument("--boot", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("-o", "--output", type=Path)
    args = parser.parse_args()
    result = render(args.inputs, args.ref, args.boot, args.seed)
    if args.output:
        args.output.write_text(result, encoding="utf-8")
    else:
        print(result, end="")


if __name__ == "__main__":
    main()
