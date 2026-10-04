#!/usr/bin/env python3
"""Static revision-4 plan/dashboard checks. Never reads run data or network."""

from datetime import date, timedelta
from fractions import Fraction
from pathlib import Path
import json
import re
import sys


QUEUE = ["q0b-evidence", "human-branch", "mix-design", "first-mix", "q0m",
         "first-p60", "first-g3", "m1-implementation", "factor-ab", "m1-pair", "m2"]
FINDINGS = ([f"C{i}" for i in range(1, 6)] + [f"W{i}" for i in range(6, 14)] +
            [f"S{i}" for i in range(14, 19)])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def block(document, name):
    start, end = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    require(document.count(start) == document.count(end) == 1,
            f"{name}: expected one marker pair")
    return document.split(start, 1)[1].split(end, 1)[0].strip()


def parsed_table(content):
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    require(len(lines) >= 3 and all(line.startswith("|") and line.endswith("|")
                                   for line in lines), "malformed table")
    cells = [[cell.strip() for cell in line[1:-1].split("|")] for line in lines]
    require(all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells[1]), "table separator")
    header = cells[0]
    require(len(set(header)) == len(header), "duplicate table column")
    require(all(len(row) == len(header) for row in cells[2:]), "table column count")
    return {"header": header, "rows": cells[2:]}


def table(document, name):
    obj = parsed_table(block(document, name))
    return [dict(zip(obj["header"], row)) for row in obj["rows"]]


def source_table(document, heading):
    require(document.count(heading) == 1, f"source heading: {heading}")
    match = re.search(r"(?m)^\|[^\n]+\n(?:\|[^\n]+\n)+", document.split(heading, 1)[1])
    require(match is not None, f"missing source table: {heading}")
    return match[0].rstrip()


_RESULT_LINES = [
    "PASS sources: D0 6 rows, Q0 12 regimes, M1 6 clusters unchanged; Q0b handoff table matches dashboard",
    "PASS Q0b: 60 completed; mean-T FAIL; G0 A/C PASS, B FAIL; safety unknown; no automatic rerun",
    "PASS budget: KEEP = 100 h; unsigned AMEND = 100 h; Q0b completed-time estimate, actual usage unverified",
    "PASS exploration: M2-skipped 180 worlds = 13 h + 1.9 h support; no new runs released",
    "PASS queue: Claude evidence -> human decision -> design only; qualification/exploration blocked",
    "PASS amendment: original unsigned and pre-view condition expired; new version/signature required; old FAIL retained",
    "PASS schedule/review: 28 consecutive JST dates; 18 Grok findings; dec-008 Oct 7 / dec-007 Oct 28 preserved",
    "PASS dashboard correspondence: budgets, queue, schedule, Q0b data and pending decisions match plan",
    "LIMIT: static consistency only; raw results, actual hours, strategy safety, browser layout and acceptance unverified",
    "PASS check-plan-consistency",
]


def check_documents(document, html, morning, m1):
    require("revision 4" in document.splitlines()[0], "plan revision 4 title")
    sources = {"d0": source_table(morning, "## 2."),
               "q0": source_table(morning, "## 5."),
               "m1": source_table(m1, "## 結果")}
    for name, raw in sources.items():
        require(block(document, f"source-{name}") == raw,
                f"{name}: plan table must be verbatim from its source")

    budget = table(document, "budget-forward")
    totals = [row for row in budget if row["ID"] == "TOTAL"]
    require(len(totals) == 1, "budget TOTAL count")
    b = [row for row in budget if row["ID"] != "TOTAL"]
    require(len({row["ID"] for row in b}) == len(b) == 11, "budget IDs")
    amounts = {}
    for reading, column in (("keep", "維持h"), ("amend", "改訂h")):
        amounts[reading] = {r["ID"]: Fraction(r[column]) for r in b}
        require(all(v >= 0 for v in amounts[reading].values()), "negative budget")
        require(sum(amounts[reading].values()) == Fraction(totals[0][column]) == 100,
                f"budget {reading}: expected exactly 100 h")
    experiment_ids = [i.strip() for row in b for i in row["実験ID"].split(";")]
    require(len(experiment_ids) == len(set(experiment_ids)), "budget duplicate experiment")
    require(set(QUEUE[2:]) <= set(experiment_ids), "reserved experiments missing from budget")
    for reading in amounts:
        a = amounts[reading]
        require(a["historical"] == 0 and a["overnight"] == Fraction(26, 3), "history/overnight accounting")
        require(a["q0b"] == Fraction(143, 30), "Q0b full reservation")
        require(a["first-next"] == Fraction(13, 15) + Fraction(13, 3) + Fraction(13, 5) + Fraction(58, 15), "first path budget")
        require(a["reserve"] == 3 and a["deep"] <= 20, "approved reserve/exploration cap")
    require(amounts["keep"]["q0m"] == 0 and amounts["amend"]["q0m"] == Fraction(143, 30), "unsigned amendment reservation")
    require(amounts["keep"]["deep"] == Fraction(149, 10) and
            amounts["amend"]["deep"] == Fraction(152, 15), "exploration allocations")
    require(amounts["keep"]["deep"] - amounts["amend"]["deep"] == amounts["amend"]["q0m"], "amendment transfer")

    # Six separate 8-world chunks must not be costed as one 48-world chunk.
    batch = Fraction(13, 60)
    d0_cost = 6 * ((8 + 2) // 3) * batch
    q_lower, q_upper = 20 * batch, 22 * batch
    estimates = table(document, "chunk-estimates")
    require([r["推定h"] for r in estimates] == ["39/10", "13/3–143/30", "247/30–26/3", "13/3–143/30"], "chunk estimate table")
    require(d0_cost == Fraction(39, 10) and d0_cost + q_lower == Fraction(247, 30) and
            d0_cost + q_upper == Fraction(26, 3), "overnight ceil arithmetic")
    require(Fraction(1) + Fraction(13, 15) + 18 * batch == Fraction(173, 30) < 6,
            "amendment next-day window")

    stages = table(document, "deep-stages")
    require([r["ID"] for r in stages] == ["factor-ab", "m2", "e3-full", "q1"], "deep stage order")
    require([int(r["世界数"]) for r in stages] == [48, 60, 72, 60], "deep world counts")
    costs = {}
    for row in stages:
        cost = ((int(row["世界数"]) + 2) // 3) * batch
        require(cost == Fraction(row["13分/p3の正確h"]), "deep stage cost")
        costs[row["ID"]] = cost
    require(sum(costs.values()) == Fraction(52, 3), "full research shelf")
    require(sum(costs.values()) - costs["m2"] + Fraction(19, 10) == amounts["keep"]["deep"],
            "M2-skipped path must fit keep budget")
    require(amounts["amend"]["deep"] < 13, "amendment exploration must remain gated")

    queue = table(document, "next-24h")
    require([int(r["順序"]) for r in queue] == list(range(1, len(QUEUE)+1)), "queue numbers")
    require([r["実験ID"] for r in queue] == QUEUE, "queue priority")
    require(all(r["状態"] and r["窓"] and r["依存・停止"] for r in queue), "queue gates missing")
    expected_queue = [("0", "未見積"), ("0", "未見積"), ("0", "1/2"), ("12", "13/15"),
                      ("60", "143/30"), ("60", "13/3"), ("36", "13/5"),
                      ("0", "19/10"), ("48", "52/15"), ("24", "39/20"), ("60", "13/3")]
    require([(r["世界数"], r["全量見積h"]) for r in queue] == expected_queue, "queue worlds/hours")
    require(queue[0]["状態"] == "未確認証跡の補完" and queue[4]["状態"] == "未署名・未実施", "evidence/unsigned status")
    require(all(queue[i]["状態"] == "停止" for i in (3, 5, 6)), "qualification queue must stop after both FAIL")
    require(3 * ((8 + 2) // 3) * batch == Fraction(39, 20), "D/E/parent independent-chunk cost")

    schedule = table(document, "schedule")
    dates = [date.fromisoformat(r["日付"]) for r in schedule]
    require(dates == [date(2026, 10, 4) + timedelta(days=i) for i in range(28)], "28 consecutive schedule dates")
    require(all(r["依存"] and r["停止・反転条件"] for r in schedule), "schedule gates")
    findings = table(document, "findings")
    require([r["ID"] for r in findings] == FINDINGS, "all 18 review findings")
    for row in findings:
        require(row["判定"] in {"accept", "partly", "reject"}, "finding disposition")
        require(all(re.search(r"\[(measured|inferred|unverified)(?::[^\]]+)?\]", row[k])
                    for k in ("根拠・理由（tag）", "正確な変更箇所・内容（tag）")), "finding evidence tags")
    for required in ("Q0-AMEND-01（署名待ち・未適用）", "41201–41205", "Masashi:",
                     "Q0bの強弱でopusへ切替えない", "旧Q0 FAILは永久保持", "Q1へ自動拡張しない"):
        require(required in document, f"amendment safeguard missing: {required}")

    require(html is not None, "canonical dashboard is required")
    data = {name: json.loads(raw) for name, raw in re.findall(
        r'<script type="application/json" id="data-([\w-]+)">\s*(.*?)\s*</script>', html, re.S)}
    q0b = parsed_table(block(document, "source-q0b"))
    require(data["results"]["q0b"]["header"] == q0b["header"] and
            data["results"]["q0b"]["rows"] == q0b["rows"], "Q0b handoff table differs")
    for phrase in ("候補48.07 / multi-arb56.43", "6/60世界", "A=PASS / B=FAIL / C=PASS",
                   "loopIterations=361、必要362", "648/531ms", "最小+2.05", "最大+25.74"):
        require(phrase in block(document, "source-q0b"), "Q0b fact missing: "+phrase)
    qs = data["results"]["q0b_summary"]
    require(qs["candidate_t"] == "48.07" and qs["multi_t"] == "56.43" and
            qs["noop_below"] == "6/60" and qs["g0_failed_worlds"] == 2, "Q0b summary mismatch")
    require(all(qs[key] is None for key in ("violations", "failed_reads", "invalid_orders", "reverts")),
            "Q0b uncollected safety must remain null, not zero")
    status = data["status"]["q0b"]
    require(status["state"] == "failed" and status["completed_worlds"] == status["worlds"] == 60,
            "Q0b completed FAIL status")
    require(status["expected_end"] is None and status["completed_at"] is None and
            data["status"]["measurement_as_of"] is None, "unreported times must stay unknown")
    require("終了見込み ${" not in html, "renderer must not show a stale forecast")
    for phrase in ("Q0bへ自動適用しない", "今回の平均T条件の不合格は動かない",
                   "第2候補1回まで", "損失許容を事前明文化", "推奨は(a)延期して設計を修理",
                   "Q0b結果が既知", "別版", "10/8は旧受理目標"):
        require(phrase in document, "post-Q0b safeguard missing: "+phrase)
    require("**22.9333–23.3667h相当＋未計上分**" in document, "baseline plus Q0b estimate")
    require("17.4333hの基本見積" in document, "conditional Q0m path estimate")
    path_cost = Fraction(1) + Fraction(13,15) + Fraction(143,30) + Fraction(13,3) + Fraction(13,5) + Fraction(58,15)
    require(path_cost == Fraction(523,30), "conditional path arithmetic")
    budget_data = data["budget"]
    require(budget_data["consumed_lower_bound_hours"] == "18.6" and budget_data["consumed_exact_hours"] is None,
            "actual consumption must not be inferred from estimates")
    estimate = budget_data["consumption_estimate"]
    require(Fraction(estimate["baseline_plus_q0b_min"]) == Fraction("18.6") + q_lower and
            Fraction(estimate["baseline_plus_q0b_max"]) == Fraction("18.6") + q_upper,
            "baseline plus Q0b estimate arithmetic")
    for column, reading in (("keep_hours", "keep"), ("amend_hours", "amend")):
        require({r["id"].removeprefix("budget-"): Fraction(r[column]) for r in budget_data["rows"]} == amounts[reading],
                "dashboard budget differs: "+reading)
    dq = data["queue"]["items"]
    require([q["experiment"] for q in dq] == QUEUE, "dashboard queue order")
    for r, q in zip(queue, dq):
        require((q["priority"], q["state"], q["worlds"], q["hours"], q["window"], q["dependency"]) ==
                (int(r["順序"]), r["状態"], int(r["世界数"]), None if r["全量見積h"] == "未見積" else r["全量見積h"], r["窓"], r["依存・停止"]),
                "dashboard queue row differs: "+r["実験ID"])
    require(all(not q["active"] for q in dq[3:]), "post-failure experiments cannot be active")
    milestones = data["milestones"]["items"]
    require([(m["date"], m["title"], m["dependency"], m["stop"]) for m in milestones] ==
            [(r["日付"], r["主な出口"], r["依存"], r["停止・反転条件"]) for r in schedule], "dashboard schedule differs")
    decisions = {d["id"]: d for d in data["decisions"]["items"]}
    for identity, due in (("dec-008", "2026-10-07"), ("dec-007", "2026-10-28")):
        require(decisions[identity]["status"] == "open" and decisions[identity]["due_date"] == due,
                "existing human operation changed: "+identity)
    require(decisions["dec-amend"]["status"] == "unsigned", "no automatic amendment signature")
    require(all(decisions[i]["status"] == "open" for i in ("dec-q0-failure-branch", "dec-q0b-g0")),
            "human decisions must remain pending")
    return list(_RESULT_LINES)


def check():
    directory = Path(__file__).resolve().parent
    names = ("MASTER-PLAN-2026-10-04.md", "ASCON-DASHBOARD.html",
             "MORNING-2026-10-04.md", "m1/M1-RESULT.md")
    documents = [(directory / name).read_text(encoding="utf-8") if (directory / name).exists() else None for name in names]
    if documents[0] is None or documents[2] is None or documents[3] is None:
        raise OSError("a required source document is missing")
    return check_documents(*documents)


def main():
    try:
        for line in check():
            print(line)
    except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
