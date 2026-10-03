#!/usr/bin/env python3
"""Render per-scenario P, T, alpha, transaction counts, and failure flags."""
import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "league"))
from g0_contract import summary_errors, scoring_errors

def read_records(index_file):
    with index_file.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))
    if not rows: raise ValueError("empty index: no scenarios")
    counts = defaultdict(int)
    for row in rows:
        if row.get("run_dir"):
            counts[row["run_dir"]] += 1
    records = []
    for row in rows:
        location = row.get("run_dir", "")
        invalid_reason = None
        if counts.get(location, 0) > 1:
            invalid_reason = "run_dir重複"
        elif row.get("exit_code", "") != "0":
            invalid_reason = "exit_code不正"
        summary = None
        try:
            if location:
                summary = json.loads((Path(location) / "summary.json").read_text(encoding="utf-8"))
            else:
                raise OSError("missing run_dir")
        except (OSError, ValueError, KeyError, TypeError):
            if not invalid_reason:
                invalid_reason = "summary欠測/不正"
        value_series = (summary.get("valueSeries") or {}) if isinstance(summary, dict) else {}
        if summary is not None:
            errors = summary_errors(summary)
            if errors: invalid_reason = invalid_reason or "; ".join(errors)
        agents = None
        alpha = {}
        if summary is not None:
            try:
                agents = {a["id"]: a for a in summary["agents"]}
                alpha = value_series.get("alphaByAgent", {})
            except (KeyError, TypeError):
                invalid_reason = "agents不正"
                agents = None
        records.append({"regime": row.get("regime", ""), "seed": row.get("seed", ""),
                        "agents": agents, "alpha": alpha,
                        "invalid": invalid_reason})
    expected_ids = {aid for r in records if r['agents'] for aid in r['agents']}
    for r in records:
        if r['agents']:
            errors = scoring_errors(list(r['agents'].values()), expected_ids)
            if errors: r['invalid'] = r['invalid'] or '; '.join(errors)
    return records


def fmt(value, digits=2):
    return "欠測" if value is None else f"{value:.{digits}f}"


def render(records):
    ids = sorted({aid for rec in records if rec["agents"] for aid in rec["agents"]})
    regimes = sorted({rec["regime"] for rec in records})
    output = ["| レジーム | seed | エージェント | P (USDC) | T | alpha (USDC) | 約定 | 状態 |",
              "|---|---:|---|---:|---:|---:|---:|---|"]
    per_agent_regime = defaultdict(lambda: defaultdict(lambda: {"p": [], "t": [], "noop": []}))
    for rec in records:
        agents = rec["agents"]
        errors = scoring_errors(list(agents.values()), ids) if agents else ['agents missing']
        if errors: rec['invalid'] = rec['invalid'] or '; '.join(errors)
        if rec["invalid"]:
            for aid in ids or ["全体"]:
                output.append(f"| {rec['regime']} | {rec['seed']} | {aid} | 欠測 | 欠測 | 欠測 | 欠測 | 無効: {rec['invalid']} |")
            continue
        if not agents:
            continue
        pnl_values = [a["pnlUsdc"] for a in agents.values() if not a.get("baseline") and isinstance(a.get("pnlUsdc"), (int, float))]
        mean = sum(pnl_values) / len(pnl_values) if pnl_values else None
        sigma = math.sqrt(sum((p - mean) ** 2 for p in pnl_values) / len(pnl_values)) if pnl_values and mean is not None else 0
        noop = agents.get("noop", {}).get("pnlUsdc")
        for aid in ids:
            agent = agents.get(aid)
            if agent is None:
                output.append(f"| {rec['regime']} | {rec['seed']} | {aid} | 欠測 | 欠測 | 欠測 | 欠測 | 正常 |")
                continue
            pnl = agent.get("pnlUsdc")
            t_score = (50.0 if sigma == 0 else 50 + 10 * (pnl - mean) / sigma) if isinstance(pnl, (int, float)) and mean is not None else None
            output.append(f"| {rec['regime']} | {rec['seed']} | {aid} | {fmt(pnl)} | {fmt(t_score, 1)} | {fmt(rec['alpha'].get(aid))} | {agent.get('includedTxCount', '欠測')} | 正常 |")
            if isinstance(pnl, (int, float)):
                item = per_agent_regime[aid][rec['regime']]
                item['p'].append(pnl)
                if isinstance(noop, (int, float)):
                    item['noop'].append(noop)
            if t_score is not None:
                per_agent_regime[aid][rec['regime']]['t'].append(t_score)
    output.extend(["", "### エージェント別集計", "", "| エージェント | 平均 T | 最悪レジーム T | noop を下回ったレジーム数 | Tカバレッジ | 有効/対象レジーム | 無効run |", "|---|---:|---:|---:|---:|---:|---:|"])
    invalid_count = sum(bool(r['invalid']) for r in records)
    for aid in ids:
        regime_t = [sum(v['t']) / len(v['t']) for v in per_agent_regime[aid].values() if v['t']]
        covered = len(regime_t)
        average = sum(regime_t) / covered if covered else None
        worst = min(regime_t) if regime_t else None
        below = sum(1 for v in per_agent_regime[aid].values()
                    if v['p'] and v['noop'] and sum(v['p']) / len(v['p']) < sum(v['noop']) / len(v['noop']))
        valid_regimes = sum(1 for v in per_agent_regime[aid].values() if v['p'])
        output.append(f"| {aid} | {fmt(average, 1)} | {fmt(worst, 1)} | {below} | {covered}/{len(regimes)} | {valid_regimes}/{len(regimes)} | {invalid_count} |")
    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_tsv", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    args = parser.parse_args()
    try:
        records = read_records(args.index_tsv)
        result = render(records) + "\n"
    except (OSError, ValueError) as e: parser.error(str(e))
    if args.output:
        args.output.write_text(result, encoding="utf-8")
    else:
        print(result, end="")
    if any(r["invalid"] for r in records):
        print("ERROR: invalid scenarios; no partial scoring", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
