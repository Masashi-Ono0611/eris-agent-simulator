#!/usr/bin/env python3
"""Static revision-5 plan/dashboard checks. Never reads run data or network."""

from datetime import date, timedelta
from fractions import Fraction
from pathlib import Path
import json
import copy
import re
import sys


QUEUE = ["dev1-evidence", "q0b-evidence", "human-branch", "mix-design", "first-mix", "q0m",
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
    "PASS Q0b: 60 completed; mean-T FAIL; G0 A/C PASS, B FAIL; rev-4 safety snapshot retained; no automatic rerun",
    "PASS budget: KEEP = 100 h; unsigned AMEND = 100 h; Q0b completed-time estimate, actual usage unverified",
    "PASS exploration: M2-skipped 180 worlds = 13 h + 1.9 h support; no new runs released",
    "PASS queue: dev1 evidence -> Q0/acceptance first; AI/exploration not released",
    "PASS amendment: original unsigned and pre-view condition expired; new version/signature required; old FAIL retained",
    "PASS schedule/review: 28 consecutive JST dates; 18 Grok findings; dec-008 Oct 7 / dec-007 Oct 28 preserved",
    "PASS dashboard correspondence: budgets, queue, schedule, Q0b data and pending decisions match plan",
    "PASS AI: five steps match; unsigned 3-ON/1-OFF contract; 144/288 worlds and 12/22.4 h verified; no budget transfer",
    "PASS current state: Q0 first, Oct 8 deferred, dev1 user-reported only; safety boundary and rule-version caveats retained",
    "LIMIT: static consistency only; raw results, actual hours, strategy safety, browser layout and acceptance unverified",
    "PASS check-plan-consistency",
]


def check_documents(document, html, morning, m1, ai):
    require("revision 5" in document.splitlines()[0], "plan revision 5 title")
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
    require(set(QUEUE[3:]) <= set(experiment_ids), "reserved experiments missing from budget")
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
    expected_queue = [("0", "未見積"), ("0", "未見積"), ("0", "未見積"), ("0", "1/2"), ("12", "13/15"),
                      ("60", "143/30"), ("60", "13/3"), ("36", "13/5"),
                      ("0", "19/10"), ("48", "52/15"), ("24", "39/20"), ("60", "13/3")]
    require([(r["世界数"], r["全量見積h"]) for r in queue] == expected_queue, "queue worlds/hours")
    require(queue[0]["状態"] == "担当証跡待ち" and queue[1]["状態"] == "未確認証跡の補完" and queue[5]["状態"] == "未署名・未実施", "evidence/unsigned status")
    require(all(queue[i]["状態"] == "停止" for i in (4, 6, 7)), "qualification queue needs Q0 contract evidence")
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
                   "第2候補1回まで", "損失許容を事前明文化", "延期・設計修理は本人決定済み",
                   "Q0b結果が既知", "別版", "10/8は旧受理目標、延期済み"):
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
    # Revision 5: source-backed AI plan; proposal is not a signed budget or a live result.
    require(ai is not None and "AI-G3-01" in ai, "AI design document missing")
    require("DESIGN-AI-LAYER-01-astra.md" in document, "AI design link missing")
    ac = data["plan"]["ai_contract"]
    require(ac["status"] == "unsigned" and ac["name"] == "AI-G3-01", "AI contract must remain unsigned")
    require((ac["on_repeats"], ac["off_repeats"], ac["market_cells"]) == (3, 1, 36), "AI repetition contract")
    worlds = ac["market_cells"] * (ac["on_repeats"] + ac["off_repeats"])
    require(ac["candidate_worlds"] == worlds == 144, "AI worlds arithmetic")
    one = Fraction(worlds, 3) * batch + Fraction(8, 5)
    two = Fraction(worlds * 2, 3) * batch + Fraction(8, 5)
    extra = two - amounts["keep"]["final-g3"]
    require(Fraction(ac["one_candidate_hours"]) == one == 12, "AI one-candidate cost")
    require(Fraction(ac["two_candidate_hours"]) == two == Fraction(112, 5), "AI two-candidate cost")
    require(Fraction(ac["extra_hours"]) == extra == Fraction(52, 5), "AI extra cost")
    require(ac["e3_q1_mode"] == "ON-proposed-unsigned", "AI-only E3/Q1 mode must be explicit and unsigned")
    require(Fraction(ac["e3_q1_base_hours"]) == costs["e3-full"] + costs["q1"] == Fraction(143, 15), "AI downstream cost")
    require(Fraction(ac["keep_deep_after_transfer"]) == amounts["keep"]["deep"] - extra == Fraction(9, 2), "AI KEEP residual")
    require(Fraction(ac["amend_deep_after_transfer"]) == amounts["amend"]["deep"] - extra == -Fraction(4, 15), "AI AMEND deficit")
    for phrase in ("22.4h", "10.4h", "4.5h", "凍結性能は改訂ON性能の代用にならない"):
        require(phrase in document and phrase in ai, "AI plan/design safeguard: " + phrase)
    for phrase in ("1,440世界", "104h", "3独立応答履歴", "performance.now()", "10/4適用版との一致は未確認", "AIは鍵に触れない"):
        require(phrase in ai, "AI evidence/limit missing: " + phrase)
    require(decisions["dec-step1-policy"]["status"] == "decided", "Step1/defer decision must stay decided")
    require(decisions["dec-ai-contract"]["status"] == "unsigned", "AI signature cannot be inferred")
    require(all(decisions[i]["status"] == "open" for i in ("dec-ai-scope", "dec-ai-budget")), "AI choices pending")
    dev1 = data["status"]["dev1"]
    require(dev1["state"] == "reported-running" and dev1["verified"] is False, "dev1 is user-reported, not live-verified")
    require("延期済み" in data["status"]["notice"], "dashboard deferral decision")
    roadmap = table(document, "ai-roadmap")
    protocols = {p["id"]: p for p in data["plan"]["protocol"]}
    step_ids = ["protocol-first", "protocol-ai-min", "protocol-ai-eval", "protocol-sealed", "protocol-ai-release"]
    require(len(roadmap) == len(step_ids) == 5, "five AI roadmap steps")
    for step, identity in zip(roadmap, step_ids):
        protocol = protocols[identity]
        require(protocol["title"] == step["Step"] and
                protocol["body"] == step["期間JST"] + "。入口: " + step["入口"] and
                protocol["exit"] == step["出口"] + "。" + step["費用・停止・本人判断"], "AI roadmap/dashboard mismatch: " + identity)
    require(any(s["path"] == "ascon-notes/league/DESIGN-AI-LAYER-01-astra.md" for s in data["sources"]["sources"]), "dashboard AI source missing")
    return list(_RESULT_LINES)


def check():
    directory = Path(__file__).resolve().parent
    names = ("MASTER-PLAN-2026-10-04.md", "ASCON-DASHBOARD.html",
             "MORNING-2026-10-04.md", "m1/M1-RESULT.md", "DESIGN-AI-LAYER-01-astra.md")
    documents = [(directory / name).read_text(encoding="utf-8") if (directory / name).exists() else None for name in names]
    if documents[0] is None or documents[2] is None or documents[3] is None:
        raise OSError("a required source document is missing")
    lines = check_documents(*documents)
    if "--self-check" in sys.argv:
        lines.append(f"PASS plan controls: {self_check(documents)} unsafe/stale mutations rejected in memory")
    return lines


def self_check(documents):
    """Exercise changed contracts without touching files, secrets or measurement paths."""
    def mutate(block_name, apply):
        def change(ds):
            pattern = r'(<script type="application/json" id="data-' + block_name + r'">)\s*(.*?)\s*(</script>)'
            def update(match):
                data = json.loads(match[2])
                apply(data)
                return match[1] + json.dumps(data, ensure_ascii=False) + match[3]
            ds[1] = re.sub(pattern, update, ds[1], count=1, flags=re.S)
        return change
    controls = [
        lambda ds: ds.__setitem__(0, ds[0].replace("revision 5", "revision 4", 1)),
        mutate("plan", lambda d: d["ai_contract"].update(status="signed")),
        mutate("plan", lambda d: d["ai_contract"].update(on_repeats=1)),
        mutate("plan", lambda d: d["ai_contract"].update(two_candidate_hours="12")),
        mutate("plan", lambda d: d["protocol"][1].update(exit="already implemented")),
        mutate("status", lambda d: d["dev1"].update(verified=True)),
        mutate("plan", lambda d: d["ai_contract"].update(e3_q1_mode="FROZEN")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-step1-policy").update(status="open")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-ai-contract").update(status="signed")),
        mutate("budget", lambda d: d["rows"][6].update(keep_hours="4.5")),
        mutate("results", lambda d: d["q0b_summary"].update(reverts=0)),
        mutate("queue", lambda d: d["items"][4].update(active=True)),
        lambda ds: ds.__setitem__(4, ds[4].replace("凍結性能は改訂ON性能の代用にならない", "凍結で十分")),
    ]
    for number, control in enumerate(controls, 1):
        changed = copy.deepcopy(documents)
        control(changed)
        try:
            check_documents(*changed)
        except (ValueError, KeyError, IndexError, TypeError):
            continue
        raise ValueError(f"negative plan control incorrectly passed: {number}")
    return len(controls)


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
