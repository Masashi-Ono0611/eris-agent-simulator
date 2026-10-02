#!/usr/bin/env python3
"""Render per-scenario P, T, alpha, transaction counts, and failure flags."""
import argparse
import csv
import json
import math
from pathlib import Path


def read_records(index_file):
    records = []
    with index_file.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            location = row.get("run_dir", "")
            try:
                summary = json.loads((Path(location) / "summary.json").read_text(encoding="utf-8"))
                records.append({"regime": row["regime"], "seed": row["seed"],
                                "agents": {a["id"]: a for a in summary["agents"]},
                                "alpha": summary.get("valueSeries", {}).get("alphaByAgent", {}),
                                "failed_reads": summary.get("valueSeries", {}).get("failedReads"),
                                "violations": summary.get("violations", [])})
            except (OSError, ValueError, KeyError, TypeError):
                records.append({"regime": row.get("regime", ""), "seed": row.get("seed", ""), "agents": None})
    return records


def fmt(value, digits=2):
    return "欠測" if value is None else f"{value:.{digits}f}"


def render(records):
    ids = sorted({aid for rec in records if rec["agents"] for aid in rec["agents"]})
    output = ["| レジーム | seed | エージェント | P (USDC) | T | alpha (USDC) | 約定 | 失敗 |",
              "|---|---:|---|---:|---:|---:|---:|---|"]
    stats = {aid: {"scores": [], "worst": None, "below": set()} for aid in ids}
    for rec in records:
        agents = rec["agents"]
        if not agents:
            for aid in ids:
                output.append(f"| {rec['regime']} | {rec['seed']} | {aid} | 欠測 | 欠測 | 欠測 | 欠測 | 欠測 |")
            continue
        field = [a["pnlUsdc"] for a in agents.values()
                 if not a.get("baseline") and isinstance(a.get("pnlUsdc"), (int, float))]
        mean = sum(field) / len(field) if field else None
        sigma = math.sqrt(sum((p - mean) ** 2 for p in field) / len(field)) if field and mean is not None else None
        noop = agents.get("noop", {}).get("pnlUsdc")
        for aid in ids:
            agent = agents.get(aid)
            if agent is None:
                output.append(f"| {rec['regime']} | {rec['seed']} | {aid} | 欠測 | 欠測 | 欠測 | 欠測 | 欠測 |")
                continue
            pnl = agent.get("pnlUsdc")
            t_score = 50 + 10 * (pnl - mean) / sigma if pnl is not None and mean is not None and sigma else None
            if rec.get("failed_reads") is None:
                failure = "欠測"
            else:
                failure = "失敗" if rec["failed_reads"] or rec.get("violations") else "正常"
            output.append(f"| {rec['regime']} | {rec['seed']} | {aid} | {fmt(pnl)} | {fmt(t_score, 1)} | "
                          f"{fmt(rec.get('alpha', {}).get(aid))} | {agent.get('includedTxCount', '欠測')} | {failure} |")
            if t_score is not None:
                stat = stats[aid]
                stat["scores"].append(t_score)
                stat["worst"] = t_score if stat["worst"] is None else min(stat["worst"], t_score)
                if noop is not None and pnl < noop:
                    stat["below"].add(rec["regime"])
    output.extend(["", "### エージェント別集計", "", "| エージェント | 平均 T | 最悪レジーム T | noop を下回ったレジーム数 |", "|---|---:|---:|---:|"])
    for aid, stat in stats.items():
        scores = stat["scores"]
        average = sum(scores) / len(scores) if scores else None
        output.append(f"| {aid} | {fmt(average, 1)} | {fmt(stat['worst'], 1)} | {len(stat['below'])} |")
    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_tsv", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    args = parser.parse_args()
    result = render(read_records(args.index_tsv)) + "\n"
    if args.output:
        args.output.write_text(result, encoding="utf-8")
    else:
        print(result, end="")


if __name__ == "__main__":
    main()
