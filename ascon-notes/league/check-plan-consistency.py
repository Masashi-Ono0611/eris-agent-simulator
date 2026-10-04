#!/usr/bin/env python3
"""Static revision-7 plan/dashboard checks. Never reads run data or network."""

from datetime import date, timedelta
from fractions import Fraction
from pathlib import Path
import json
import hashlib
import copy
import re
import sys


QUEUE = ["dev1-evidence", "q0b-evidence", "q0-requal", "mix-design", "first-mix", "q0m",
         "first-p60", "first-g3", "ai-implementation", "ai-d-control", "factor-ab", "m2"]
DECISION_IDS = ["dec-ai-scope", "dec-ai-contract", "dec-ai-budget", "dec-q0-failure-branch", "dec-q0b-g0", "dec-revert-limit"]
ORIGIN = "本人が 2026-10-04 に Astra へ判断を委任。Astra が決定"
SIGNER = "本人委任のAstra決定"
FINDINGS = ([f"C{i}" for i in range(1, 6)] + [f"W{i}" for i in range(6, 14)] +
            [f"S{i}" for i in range(14, 19)])

PRIOR_LOG_DIGEST = "2d41bce950f66f7b06c2e2a567a84d019d05f0201cb529b31f1691b9eb4c19e2"
REDESIGN_LOG_DIGEST = "1129b604c2877fc19e889c77a3c5746d0800d343a3ba2f8a2bacfefe24b24958"


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


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
    "PASS sources: D0/Q0/M1/Q0b tables retained; dev1/dev2 handoffs match plan/dashboard",
    "PASS Q0b: old 60-world result, G0 2-world FAIL and mean-T FAIL retained; no rescue rerun",
    "PASS budget: KEEP 100 h (G3 17.2, deep 9.7); archived unsigned AMEND 100 h; Q0 priority 5 h",
    "PASS queue: repair/rediagnosis -> Q0 -> acceptance; AI execution blocked by full-cost/evidence gates",
    "PASS decisions: 6 delegated Astra decisions with origin/signer/JST; Ollama registration/settings are user-reported; prepayment deferred",
    "PASS Q0: A unchanged; 1 new 60-world attempt; extra P/u1m conditions rejected; revert cap prospective only",
    "PASS AI: ENTRY_BPS 20-60, max step 5; R* ON3/OFF1 + S full = 216 worlds / 17.2 h; no epoch learning carryover",
    "PASS cutover: Oct 17 evidence gates select H480 / S240 / no campaign; no fresh deep exploration",
    "PASS schedule/review: 28 JST dates, 18 findings, five roadmap steps match dashboard",
    "PASS preservation: all 65 pre-redesign logs unchanged; dec-008 resolved / dec-007 open with original dates; old safety nulls retained",
    "PASS current: dev3a measured 18-world handoff; dev3b/v3 unknown; no invented full-12 result or qualification",
    "PASS operations: independent completion monitoring, 150/180 minute iterations, max 3, fresh 12x2 screen; not execution approval",
    "LIMIT: static consistency only; raw runs, actual hours, strategy safety, browser layout and acceptance unverified",
    "PASS check-plan-consistency",
]


def check_documents(document, html, morning, m1, ai):
    require("revision 7" in document.splitlines()[0], "plan revision 7 title")
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
    require(amounts["keep"]["deep"] == Fraction(97, 10) and
            amounts["keep"]["final-g3"] == Fraction(86, 5), "decided AI allocation")
    require(amounts["amend"]["deep"] == Fraction(152, 15) and amounts["amend"]["final-g3"] == 12,
            "archived AMEND must remain unchanged")
    require(Fraction(149, 10) - amounts["keep"]["deep"] == amounts["keep"]["final-g3"] - 12 == Fraction(26, 5),
            "exact 5.2 h deep to G3 transfer")
    require(Fraction(149, 10) - amounts["amend"]["deep"] == amounts["amend"]["q0m"], "archived amendment transfer")
    require(amounts["keep"]["final-g2"] == 35 and amounts["keep"]["final-g4"] == 9, "final verification reservations")

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
    require(sum(costs.values()) - costs["m2"] + Fraction(19, 10) == Fraction(149, 10) > amounts["keep"]["deep"],
            "old M2-skipped shelf no longer fits current deep allocation")
    require(amounts["amend"]["deep"] < 13, "amendment exploration must remain gated")

    queue = table(document, "next-24h")
    require([int(r["順序"]) for r in queue] == list(range(1, len(QUEUE)+1)), "queue numbers")
    require([r["実験ID"] for r in queue] == QUEUE, "queue priority")
    require(all(r["状態"] and r["窓"] and r["依存・停止"] for r in queue), "queue gates missing")
    expected_queue = [("0", "未見積"), ("0", "未見積"), ("60", "5"), ("0", "1/2"), ("12", "13/15"),
                      ("60", "143/30"), ("60", "13/3"), ("36", "13/5"),
                      ("0", "未見積"), ("48", "52/15"), ("48", "52/15"), ("60", "13/3")]
    require([(r["世界数"], r["全量見積h"]) for r in queue] == expected_queue, "queue worlds/hours")
    require(queue[0]["状態"] == "dev3b走行中との引継ぎ・結果未確認" and queue[1]["状態"] == "証跡精算のみ・再走なし" and
            queue[2]["状態"] == "条件付き決定・実行停止" and queue[5]["状態"] == "不採用・旧未署名記録", "repair/requalification/archive state")
    require(all(queue[i]["状態"] == "停止" for i in (4, 6, 7)), "qualification queue needs Q0 evidence")
    require(queue[11]["状態"] == "不採用・0h配分", "M2 must remain zero allocation")
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
    for required in ("Q0-AMEND-01（未署名・失効記録・今回不採用）", "41201–41205", "原案の署名状態",
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
    require(dq[0]["active"] is True and all(not q["active"] for q in dq[1:]),
            "only reported dev3b follow-up may be active; Q0 and downstream remain blocked")
    require('世界数未提示（0は新規予約なし）' in dq[0]['dependency'], 'unknown dev3b world count is not zero measured worlds')
    require('35001/35002はdev3診断で既見のため再利用不可' in dq[9]['dependency'],
            'D-control cannot silently reuse dev3 development seeds')
    milestones = data["milestones"]["items"]
    require([(m["date"], m["title"], m["dependency"], m["stop"]) for m in milestones] ==
            [(r["日付"], r["主な出口"], r["依存"], r["停止・反転条件"]) for r in schedule], "dashboard schedule differs")
    decisions = {d["id"]: d for d in data["decisions"]["items"]}
    for identity, due, state in (("dec-008", "2026-10-07", "resolved"), ("dec-007", "2026-10-28", "open")):
        require(decisions[identity]["status"] == state and decisions[identity]["due_date"] == due and
                decisions[identity]["date"] == "2026-10-03",
                "existing human operation changed: "+identity)
    require(decisions["dec-amend"]["status"] == "unsigned", "no automatic amendment signature")
    # Revision 6 records explicit delegated decisions, never a forged Masashi signature.
    require(ai is not None and "AI-G3-01" in ai and "MASTER revision 6" in ai, "AI design revision")
    require("DESIGN-AI-LAYER-01-astra.md" in document, "AI design link")
    for n, identity in enumerate(DECISION_IDS, 1):
        d = decisions[identity]
        require(d["status"] == "decided" and d["issue"] == n and d["origin"] == ORIGIN and d["signer"] == SIGNER,
                "delegated decision provenance: " + identity)
        require(re.fullmatch(r"2026-10-04T\d{2}:\d{2}:\d{2}\+09:00", d["signed_at"]) is not None,
                "decision signature timestamp: " + identity)
        require(d["signed_at"] <= data["status"]["as_of"] and d["signed_at"] in document and d["signed_at"] in ai,
                "decision signature document correspondence")
        require(ORIGIN in d["note"] and SIGNER in d["note"], "visible decision provenance")
    for doc in (document, ai):
        require(ORIGIN in doc and "署名者=" + SIGNER in doc and "署名日時=" in doc, "document decision signature")
        require("______" not in doc, "no empty signature placeholders")
        require("本人の承認" in doc and "自動チャージ" in doc and "残高" in doc and "鍵登録" in doc,
                "human-only scope disclosure")
        require("凍結性能は改訂ON性能の代用にならない" in doc, "ON evidence boundary")
        require("17.2h" in doc and "9.7h" in doc and "10/17" in doc, "allocation and cutover prose")
    require(data["decisions"]["human_only"]["status"] == "現在の本人作業なし" and
            data["decisions"]["human_only"]["items"] == ["10/28 dec-007再確認", "無料枠不足時の前払い判断（G3見積もり後）"],
            "no current human task; final recheck and conditional prepayment remain future work")
    require(all(decisions[i]["status"] == "decided" for i in ("dec-step1-policy", "dec-q0-keep", "dec-original", "dec-forward")),
            "prior settled decisions must stay decided")
    ac = data["plan"]["ai_contract"]
    require(ac["status"] == "decided" and ac["name"] == "AI-G3-01" and ac["origin"] == ORIGIN and
            ac["signer"] == SIGNER and ac["signed_at"] == decisions["dec-ai-contract"]["signed_at"], "AI delegated signature")
    require(ac["execution_status"] == "blocked-evidence-and-costs" and ac["api_budget_status"] == "無料枠不足時の前払い判断はG3見積もり後",
            "decision is not execution/money approval")
    require((ac["on_repeats"], ac["off_repeats"], ac["market_cells"]) == (3, 1, 36), "AI repetition contract")
    worlds = ac["market_cells"] * (ac["on_repeats"] + ac["off_repeats"])
    require(ac["candidate_worlds"] == worlds == 144 and ac["s_worlds"] == 72 and
            ac["selected_total_worlds"] == worlds + ac["s_worlds"] == 216, "asymmetric G3 worlds")
    one = Fraction(worlds, 3) * batch + Fraction(8, 5)
    fallback = Fraction(ac["s_worlds"], 3) * batch
    total = one + fallback
    require(Fraction(ac["one_candidate_hours"]) == one == 12 and Fraction(ac["s_full_hours"]) == fallback == Fraction(26, 5),
            "R* 12 plus S 5.2")
    require(Fraction(ac["selected_total_hours"]) == total == amounts["keep"]["final-g3"] == Fraction(86, 5), "total 17.2 h")
    require(Fraction(ac["two_candidate_hours"]) == Fraction(112, 5) and ac["two_candidate_status"] == "rejected-both-repeat",
            "both-candidate repetition is rejected")
    require(Fraction(ac["extra_hours"]) == total - 12 == Fraction(26, 5), "G3 transfer")
    require(ac["s_full_evidence"] == "unverified", "cannot assume reusable S evidence")
    require(Fraction(ac["keep_deep_after_transfer"]) == amounts["keep"]["deep"] == Fraction(97, 10), "deep residual")
    require(ac["e3_q1_mode"] == "ON-decided" and ac["epoch_learning_carryover"] is False, "AI mode/reset")
    require(Fraction(ac["e3_q1_base_hours"]) == costs["e3-full"] + costs["q1"] == Fraction(143, 15), "AI downstream cost")
    require(ac["d_control_worlds"] == 48 and Fraction(ac["d_control_base_hours"]) == Fraction(48, 3) * batch == Fraction(52, 15)
            and ac["d_control_cost_status"] == "unreserved", "D control cost cannot disappear")
    require(Fraction(ac["e3_q1_base_hours"]) + Fraction(ac["d_control_base_hours"]) > amounts["keep"]["deep"],
            "AI full path not released")
    params = parsed_table(block(document, "ai-parameters"))
    require(params == parsed_table(block(ai, "ai-parameters")), "parameter contract source mismatch")
    require(data["plan"]["ai_parameters"]["header"] == params["header"] and data["plan"]["ai_parameters"]["rows"] == params["rows"],
            "parameter contract dashboard mismatch")
    require(params["rows"] == [["ENTRY_BPS（新規entryの入口だけ）", "60 bps", "20–60 bps", "5 bps", "±5 bps", "60 block以上"]],
            "allowlist and bounded updates")
    for phrase in ("return/submit", "canFund", "120block", "未解消在庫", "20bps", "政策値"):
        require(phrase in document and phrase in ai, "parameter boundary/rationale: " + phrase)
    q = data["plan"]["q0_requalification"]
    require((q["option"], q["status"], q["candidate_limit"], q["attempt_limit"], q["worlds"], q["mode"], q["field"]) ==
            ("A", "decided", 1, 1, 60, "FROZEN", "F_ref"), "Q0 A fixed one-attempt contract")
    require(q["seeds"] == "41301–41305" and Fraction(q["hours_cap"]) == 5 and q["within_deep"] is True and
            q["execution_status"] == "blocked-repair-rediagnosis-hash-cost", "Q0 fresh inputs/cost/repair gate")
    require(all(q[k] is False for k in ("extra_p_vs_multi", "extra_all_world_p_minus_noop", "extra_absolute_p",
                                       "extra_u1m_noninferiority", "extra_submit_failure_noninferiority")), "extra conditions explicitly rejected")
    require("追加条件" in document and "不採用" in document and "5h上限枠" in document, "Q0 contract prose")
    revert = data["plan"]["revert_contract"]
    require(revert["status"] == "decided" and revert["worlds_per_set"] == 60 and revert["max_count"] == 1 and
            Fraction(revert["max_ratio"]) == Fraction(1, 1000) and revert["retroactive"] is False and
            revert["reject_unknown_cause_or_recovery"] is True, "prospective count AND ratio revert cap")
    for phrase in ("旧結果へ遡及", "≤0.1%", "≤1件", "全包含取引", "片脚回収不明"):
        require(phrase in document and phrase in ai, "revert contract prose: " + phrase)
    cut = data["plan"]["cutover"]
    require(cut["at"] == "2026-10-17T18:00:00+09:00" and cut["h480_requires"] ==
            ["受理S", "Dへの正の増分", "固定R* E3/Q1/G3", "校正後の全残費100h内", "期限内の全日程確保"], "Oct 17 H480 evidence gates")
    require(cut["fallback"] == "AI終了、適合受理Sと全費用ならS240、それ以外H未実施" and
            "10/17から新規探索なし" in cut["deep_switch"], "S240/no-H and no fresh research")
    dev1 = data["status"]["dev1"]
    require(dev1["state"] == "measured-diagnostic-complete" and dev1["verified"] is False and dev1["completed_at"] is None,
            "dev1 measured handoff is not raw/live audit or invented time")
    require((dev1["g0"], dev1["loops"], dev1["worlds"], dev1["regimes"], dev1["seeds"], dev1["p_minus_noop_all_worlds"],
             dev1["trades"], dev1["reported_skip_count"], dev1["q0_eligible"]) ==
            ("PASS", 362, 12, 6, "31001/31002", "0.0", 0, 361, False), "dev1 diagnosis/qualification boundary")
    devtable = parsed_table(block(document, "source-dev1"))
    require(data["results"]["dev1"]["header"] == devtable["header"] and data["results"]["dev1"]["rows"] == devtable["rows"],
            "dev1 source table")
    require("現状Q0資格不可" in document and "現状Q0資格不可" in ai and "延期済み" in data["status"]["notice"],
            "current state not success")
    # Immutable historical entries: corrections are new logs, never edits of prior events.
    prior = [log for log in data["log"]["items"] if log["id"] in {f"log-{i:03}" for i in range(1, 61)}]
    require(len(prior) == 60 and digest(prior) == PRIOR_LOG_DIGEST, "prior 60 log entries changed")
    before_redesign = [log for log in data['log']['items'] if log['id'] in {f'log-{i:03}' for i in range(1,66)}]
    require(len(before_redesign) == 65 and digest(before_redesign) == REDESIGN_LOG_DIGEST,
            'all 65 pre-redesign log entries must be preserved byte-for-value')
    dev2 = data["status"]["dev2"]
    require((dev2["state"], dev2["verified"], dev2["field"], dev2["worlds"], dev2["regimes"], dev2["seeds"], dev2["fix_commit"]) ==
            ("measured-diagnostic-complete", False, "F_ref", 12, 6, "31001/31002", "2ae0d59"), "dev2 measured diagnostic handoff")
    expected_dev2 = dict(p_candidate='149.0', p_multi='1352.2', trades_candidate='44.8', trades_multi='300.9',
                        t_candidate='44.36', t_multi='56.84', min_p_minus_noop='+147.7', positive_worlds=12,
                        noop_below=0, violations=0, reverts=0)
    require(dev2['result'] == expected_dev2 and dev2['g0'] == 'PASS' and dev2['q0_eligible'] is False,
            'dev2 measured numbers and diagnosis/qualification boundary')
    require(dev2['completed_at'] is None and dev2['expected_end'] is None and 'measured' in dev2['evidence_basis'],
            'dev2 completion clock is unknown and obsolete forecast retired')
    dev2_table = parsed_table(block(document, 'source-dev2'))
    require(data['results']['dev2']['header'] == dev2_table['header'] and data['results']['dev2']['rows'] == dev2_table['rows'],
            'dev2 table must match MASTER handoff')
    for value in ('149.0', '1352.2', '44.8', '300.9', '44.36', '56.84', '+147.7'):
        require(value in block(document, 'source-dev2'), 'dev2 handoff value missing: '+value)
    dev3 = data['status']['dev3']
    require((dev3['name'], dev3['state'], dev3['verified'], dev3['field'], dev3['seeds'], dev3['regimes'], dev3['worlds'],
             dev3['started_at'], dev3['expected_end'], dev3['fix_commit'], dev3['next_chunk_regimes']) ==
            ('dev3a-xb-r', 'measured-diagnostic-complete', False, 'F_ref', '35001/35002', 9, 18,
             '2026-10-04T16:24:00+09:00', None, 'a646e9b', 3), 'dev3a measured scope; obsolete forecast retired')
    require((dev3['completed_at'],dev3['completed_at_precision'],dev3['completed_worlds'],dev3['g0'],dev3['q0_eligible']) ==
            ('2026-10-04T17:39:00+09:00','minute',18,'PASS',False), 'dev3a minute-precision completion, G0 and qualification boundary')
    require('本人提示' in dev3['completed_at_basis'] and '実測秒ではない' in dev3['completed_at_basis'] and
            dev3['started_at'] < dev3['completed_at'] <= data['status']['as_of'] and 'measured' in dev3['evidence_basis'],
            'dev3a handoff/time provenance, not a raw-log audit')
    expected_dev3 = dict(p_candidate='842.3',p_multi='2032.9',p_clean='1050.3',
                        trades_candidate='54.4',trades_multi='288.7',trades_clean='61.3',
                        t_candidate='46.83',t_multi='55.93',positive_worlds=18,min_p_minus_noop=None,
                        noop_below=0,violations=0,reverts=0,submit_failed=27,submitted=980,
                        regime_t=[dict(regime='informed-flow',candidate='55.23',multi='36.01'),
                                  dict(regime='lending-incident',candidate='52.52',multi='49.15'),
                                  dict(regime='vuln',candidate='49.35',multi='50.10')])
    require(dev3['result'] == expected_dev3, 'dev3a exact supplied numbers; no invented minimum or other regimes')
    dev3_table = parsed_table(block(document, 'source-dev3a'))
    require(data['results']['dev3a']['header'] == dev3_table['header'] and
            data['results']['dev3a']['rows'] == dev3_table['rows'], 'dev3a MASTER/dashboard table correspondence')
    for phrase in ('9レジーム18世界', '842.3', '2032.9', '1050.3', '54.4', '288.7', '61.3',
                   '46.83', '55.93', '55.23', '36.01', '52.52', '49.15', '49.35', '50.10',
                   'submit_failed 27 / submitted 980', '最小値は未提示', '全18世界で正 / 0', '勝利/統計的同等ではない'):
        require(phrase in block(document,'source-dev3a'), 'dev3a source fact missing: '+phrase)
    dev3b, v3 = data['status']['dev3b'], data['status']['repair_v3']
    require((dev3b['state'],dev3b['verified'],dev3b['regimes']) == ('reported-running-unverified',False,3),
            'dev3b is a reported running job, not current process verification')
    require(all(dev3b[k] is None for k in ('seeds','worlds','started_at','expected_end','completed_at',
                                         'completed_worlds','g0','result','fix_commit')), 'dev3b unknowns must remain null')
    require(v3['state'] == 'reported-implementing-unverified' and v3['verified'] is False and
            all(v3[k] is None for k in ('commit','tests','result')), 'v3 implementation/test/performance unverified')
    op = data['plan']['continuous_operation']
    expected_op = dict(status='defined-not-verified',monitor_status='unverified',iteration_start='v3-first-smoke',
                       iteration_target_minutes=150,iteration_limit_minutes=180,iteration_limit=3,
                       monitor_interval_seconds=60,detect_minutes=2,ack_minutes=5,next_minutes=10,
                       smoke_minutes_cap=10,chunk_minutes_cap=110,validation_worlds=24,validation_regimes=12,
                       validation_seeds=2,mean_t_delta_min='0',regime_t_noop_min='0',diagnostic_revert_max=0,
                       qualification_seeds_excluded='41301–41305',budget_status='unreconciled-not-released')
    require(all(op[k] == v for k,v in expected_op.items()), 'operating limits and diagnostic screen are fixed, execution unverified')
    require(op['stages'] == parsed_table(block(document,'continuous-stages')) and
            op['screen'] == parsed_table(block(document,'diagnostic-screen')), 'operation tables match MASTER')
    for phrase in ('起動シェル終了≠計測完了', '全ジョブに', '全予定世界の終端記録', '通知設定/テスト受信',
                   '60秒以下', '2分以内', '5分以内', '10分以内', '調整/短縮smoke/診断検証/Q0のseed交差0',
                   '12レジーム等重み平均(Tcand−Tmulti)≥0', '各12レジームの平均(Tcand−Tnoop)≥0',
                   'cand submitted>0・包含成功>0', '実ログ由来入力を必須', '上限180分', '目標150分',
                   '最大3回', '本人へ結果・最悪値・失敗理由・残費を報告', 'G0 FAIL/安全違反/入力hash不一致',
                   '開始時空き39.5GiB', '緊急下限25GB', '既決20h/2新世代', '3回分の枠は未解放'):
        require(phrase in document, 'continuous-operation safeguard missing: '+phrase)
    repair = data['status']['repair_v2']
    require((repair['commit'],repair['tests'],repair['red_controls'],repair['verified'],repair['evidence_kind']) ==
            ('a646e9b',123,25,False,'measured引継ぎ'), 'v2 implementation/test evidence cannot become fresh verification')
    require('123' in document and '赤対照25' in document and '16:24 JST開始' in document and '17:39 JST完了' in document,
            'v2/dev3 MASTER handoff missing')
    require(data['status']['human_action'] == 'なし' and data['budget']['consumed_forward_hours'] is None and
            data['budget']['consumption_status'] == '未精算', 'human action and unknown forward consumption')
    require(data['plan']['revision'] == 7 and data['plan']['deadline_at'] == '2026-10-31T23:59:00+09:00',
            'revision and submission deadline')
    report = data["decisions"]["ollama_report"]
    require(report["evidence_kind"] == "本人報告" and report["registration"] == "accepted-display-reported" and
            report["cloud_key_and_email_match"] == "confirmed-by-user", "Ollama report provenance")
    require((report["plan"], report["free_usage"], report["balance_usd"], report["auto_reload"]) ==
            ("Free", "0%", "0", "Off"), "reported Ollama account settings")
    require(report["free_models"] == ["gemma4:31b", "gpt-oss:120b", "gpt-oss:20b", "nemotron-3-nano:30b", "nemotron-3-super", "nemotron-3-ultra"] and
            report["assumed_model"] == "gpt-oss:120b" and report["assumption_approved_by_user"] is True,
            "reported models and approved assumption")
    require(all(report[k] is False for k in ("official_model_list_verified", "free_quota_sufficiency_verified", "key_connectivity_verified")),
            "unverified provider checks cannot become confirmed")
    require(report["clipboard_cleared"] == "reported-by-user" and report["attentionctl_status"] == "resolved-reported",
            "clipboard/attentionctl are user reports")
    require(data["blockers"]["items"][0]["title"] == "資格試験に必要な収益性が不足" and
            data['status']['priority']['blocker_ref'] == data['blockers']['items'][0]['id'],
            "Q0 contract is first blocker")
    progress = {i["id"]: i for i in data["progress"]["items"]}
    require(progress["progress-dev2"]["state"] == "done" and progress['progress-dev3']['state'] == 'done' and
            progress['progress-dev3b']['state'] == progress['progress-xbr-v3']['state'] == 'running' and
            progress['progress-xbr-v2']['state'] == 'done' and progress["progress-xbr-requal"]["state"] == "blocked" and
            progress["progress-ollama"]["state"] == "done", "diagnosis/qualification/registration states are separate")
    require([i["id"] for i in data["log"]["items"][:-60]] == [f"log-{i:03}" for i in range(len(data["log"]["items"]), 60, -1)],
            "logs must be consecutive and prepended")
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
    # Visible comparisons use references to exactly these populations, never cross-field T differences.
    comparisons = data['results']['comparison']
    require([r['scope_ref'] for r in comparisons['diagnostic']] == ['status.dev3','status.dev2','status.dev1'],
            'diagnostic comparison populations')
    require([r['scope_ref'] for r in comparisons['qualification']] ==
            ['plan.q0_requalification','results.q0.scope','status.q0b'], 'qualification comparison populations')
    require([r['state'] for r in comparisons['qualification']] == ['blocked','failed','failed'],
            'visible qualification statuses must preserve failures')
    require(comparisons['diagnostic'][1]['metrics'] == [
        dict(label='平均P',candidate_ref='status.dev2.result.p_candidate',baseline_ref='status.dev2.result.p_multi'),
        dict(label='平均取引数',candidate_ref='status.dev2.result.trades_candidate',baseline_ref='status.dev2.result.trades_multi'),
        dict(label='平均T',candidate_ref='status.dev2.result.t_candidate',baseline_ref='status.dev2.result.t_multi')],
        'visible dev2 metrics cannot substitute another run or unit')
    require(comparisons['diagnostic'][0]['metrics'] == [
        dict(label='平均P',candidate_ref='status.dev3.result.p_candidate',baseline_ref='status.dev3.result.p_multi'),
        dict(label='平均取引数',candidate_ref='status.dev3.result.trades_candidate',baseline_ref='status.dev3.result.trades_multi'),
        dict(label='平均T',candidate_ref='status.dev3.result.t_candidate',baseline_ref='status.dev3.result.t_multi')]
        and comparisons['diagnostic'][0]['state'] == 'warning' and comparisons['diagnostic'][0]['safety_ref'] == 'status.dev3',
        'visible dev3a numbers/population/status must match handoff')
    glossary = parsed_table(block(document, 'glossary'))
    require(glossary['header'] == ['用語','説明'] and glossary['rows'] ==
            [[t['term'],t['definition']] for t in data['glossary']['items']], 'glossary definition source mismatch')
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
        lambda ds: ds.__setitem__(0, ds[0].replace("revision 7", "revision 6", 1)),
        mutate("plan", lambda d: d["ai_contract"].update(status="unsigned")),
        mutate("plan", lambda d: d["ai_contract"].update(on_repeats=1)),
        mutate("plan", lambda d: d["ai_contract"].update(selected_total_hours="12")),
        mutate("plan", lambda d: d["protocol"][1].update(exit="already implemented")),
        mutate("status", lambda d: d["dev1"].update(verified=True)),
        mutate("status", lambda d: d["dev1"].update(q0_eligible=True)),
        mutate("status", lambda d: d["dev1"].update(state="reported-running")),
        mutate("plan", lambda d: d["ai_contract"].update(e3_q1_mode="FROZEN")),
        mutate("plan", lambda d: d["ai_contract"].update(epoch_learning_carryover=True)),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-step1-policy").update(status="open")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-ai-contract").update(signer="Masashi")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-ai-scope").update(origin="")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-ai-scope").update(signed_at="")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-008").update(status="closed")),
        mutate("decisions", lambda d: d["human_only"].update(status="approved")),
        mutate("decisions", lambda d: next(x for x in d["items"] if x["id"] == "dec-008").update(status="open")),
        mutate("decisions", lambda d: d["ollama_report"].update(evidence_kind="measured")),
        mutate("decisions", lambda d: d["ollama_report"].update(official_model_list_verified=True)),
        mutate("decisions", lambda d: d["ollama_report"].update(free_quota_sufficiency_verified=True)),
        mutate("decisions", lambda d: d["ollama_report"].update(key_connectivity_verified=True)),
        mutate("decisions", lambda d: d["ollama_report"].update(auto_reload="On")),
        mutate("status", lambda d: d["dev2"].update(result="PASS")),
        mutate("status", lambda d: d["dev2"].update(completed_at="2026-10-04T15:50:00+09:00")),
        mutate("status", lambda d: d["dev2"].update(verified=True)),
        mutate('status', lambda d: d['dev2']['result'].update(t_candidate='60')),
        mutate('status', lambda d: d['dev2'].update(q0_eligible=True)),
        mutate('status', lambda d: d['dev2'].update(state='running-results-pending')),
        mutate('status', lambda d: d['dev3'].update(result='PASS')),
        mutate('status', lambda d: d['dev3'].update(completed_at='2026-10-04T17:40:00+09:00')),
        mutate('status', lambda d: d['dev3'].update(completed_worlds=24)),
        mutate('status', lambda d: d['dev3'].update(g0=None)),
        mutate('status', lambda d: d['dev3'].update(verified=True)),
        mutate('status', lambda d: d['dev3'].update(worlds=24)),
        mutate('status', lambda d: d['repair_v2'].update(tests=124)),
        mutate('status', lambda d: d['repair_v2'].update(verified=True)),
        mutate('status', lambda d: d.update(human_action='今すぐ鍵を登録')),
        mutate('budget', lambda d: d.update(consumed_forward_hours='18.6')),
        mutate('plan', lambda d: d.update(deadline_at='2026-10-31T23:59:00+08:00')),
        mutate('log', lambda d: next(x for x in d['items'] if x['id']=='log-065').update(summary='rewritten latest history')),
        mutate('results', lambda d: d['comparison']['qualification'][0].update(state='done')),
        mutate('results', lambda d: d['comparison']['diagnostic'][1]['metrics'][0].update(baseline_ref='results.q0_summary.multi_t')),
        mutate('glossary', lambda d: d['items'][0].update(definition='invented definition')),
        mutate("log", lambda d: d["items"][0].update(id="log-999")),
        mutate("budget", lambda d: d["rows"][6].update(keep_hours="14.9")),
        mutate("results", lambda d: d["q0b_summary"].update(reverts=0)),
        mutate("queue", lambda d: d["items"][2].update(active=True)),
        mutate("plan", lambda d: d["ai_contract"].update(d_control_base_hours="0")),
        mutate("plan", lambda d: d["ai_parameters"]["rows"][0].__setitem__(4, "±40 bps")),
        mutate("plan", lambda d: d["q0_requalification"].update(option="B")),
        mutate("plan", lambda d: d["q0_requalification"].update(extra_all_world_p_minus_noop=True)),
        mutate("plan", lambda d: d["revert_contract"].update(retroactive=True)),
        mutate("plan", lambda d: d["revert_contract"].update(max_ratio="1/100")),
        mutate("plan", lambda d: d["revert_contract"].update(max_count=2)),
        mutate("plan", lambda d: d["cutover"].update(h480_requires=["受理S"])),
        mutate("log", lambda d: d["items"][-1].update(summary="rewritten history")),
        lambda ds: ds.__setitem__(4, ds[4].replace("凍結性能は改訂ON性能の代用にならない", "凍結で十分")),
        mutate('status', lambda d: d['dev3']['result'].update(t_candidate='56')),
        mutate('status', lambda d: d['dev3']['result'].update(min_p_minus_noop='+147.7')),
        mutate('status', lambda d: d['dev3']['result'].update(submitted=981)),
        mutate('status', lambda d: d['dev3']['result']['regime_t'][2].update(candidate='50.10')),
        mutate('status', lambda d: d['dev3'].update(q0_eligible=True)),
        mutate('status', lambda d: d['dev3'].update(completed_at_precision='second')),
        mutate('status', lambda d: d['dev3b'].update(result='PASS')),
        mutate('status', lambda d: d['dev3b'].update(completed_at='2026-10-04T19:00:00+09:00')),
        mutate('status', lambda d: d['dev3b'].update(worlds=6)),
        mutate('status', lambda d: d['repair_v3'].update(tests=123)),
        mutate('status', lambda d: d['repair_v3'].update(verified=True)),
        mutate('plan', lambda d: d['continuous_operation'].update(monitor_status='running')),
        mutate('plan', lambda d: d['continuous_operation'].update(iteration_limit=4)),
        mutate('plan', lambda d: d['continuous_operation'].update(mean_t_delta_min='-1')),
        mutate('plan', lambda d: d['continuous_operation'].update(validation_regimes=9)),
        mutate('plan', lambda d: d['continuous_operation'].update(budget_status='released')),
        mutate('results', lambda d: d['comparison']['diagnostic'][0]['metrics'][0].update(baseline_ref='status.dev2.result.p_multi')),
        lambda ds: ds.__setitem__(0, ds[0].replace('調整/短縮smoke/診断検証/Q0のseed交差0','seed共有可')),
        lambda ds: ds.__setitem__(0, ds[0].replace('全予定世界の終端記録','launcher終了')),
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
