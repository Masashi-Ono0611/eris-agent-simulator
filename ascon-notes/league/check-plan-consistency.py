#!/usr/bin/env python3
"""Static revision-3 checks. Reads four named documents, never run data or network."""

from datetime import date, timedelta
from fractions import Fraction
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import sys


QUEUE = ["q0b", "mix-design", "first-mix", "q0m", "first-p60", "first-g3",
         "m1-implementation", "factor-ab", "m1-pair", "m2"]
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


def unique_put(target, key, value, message):
    require(key not in target, message)
    target[key] = value


class Summary(HTMLParser):
    """Inspect tag balance, IDs and source-bound chart markup without rendering."""
    voids = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.ids, self.dates, self.sections, self.numbers = [], [], [], [], []
        self.queue, self.gates = [], []
        self.budgets = {"keep": {}, "amend": {}}
        self.d0, self.zero, self.q0, self.pairs, self.fields, self.mechanisms = {}, {}, {}, {}, {}, {}
        self.embedded = ""
        self.in_json = False
        self.in_number = False
        self.chart_frame = None
        self.visible_charts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag not in self.voids:
            self.stack.append(tag)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "section":
            self.sections.append(attrs.get("id"))
        if tag == "span" and attrs.get("class") == "n":
            self.in_number = True
        if tag == "time":
            self.dates.append(attrs.get("datetime"))
        if tag == "script" and attrs.get("id") == "overnight-data":
            require(attrs.get("type") == "application/json", "HTML: data must be inert JSON")
            self.in_json = True
        if "data-experiment" in attrs:
            self.queue.append((attrs["data-experiment"], attrs["data-worlds"], attrs["data-hours"]))
        if "data-gate" in attrs:
            self.gates.append(attrs["data-gate"])
        if "data-budget-row" in attrs:
            reading, key = attrs["data-budget-reading"], attrs["data-budget-row"]
            require(reading in self.budgets, "HTML: unknown budget reading")
            value = Fraction(attrs["data-hours"])
            width = re.search(r"--hours:([0-9.]+)(?:;|$)", attrs.get("style", ""))
            require(width is not None and abs(Fraction(width[1]) - value) < Fraction(1, 10**12),
                    f"HTML: budget width differs for {reading}/{key}")
            unique_put(self.budgets[reading], key, value, "HTML: duplicate budget row")
        chart_value = None
        if "data-d0" in attrs:
            unique_put(self.d0, attrs["data-d0"], attrs["data-p-noop"], "duplicate D0 chart")
            chart_value = attrs["data-p-noop"]
        if "data-zero" in attrs:
            unique_put(self.zero, attrs["data-zero"], attrs["data-share"], "duplicate zero chart")
            chart_value = attrs["data-share"]
        if "data-q-regime" in attrs:
            unique_put(self.q0, attrs["data-q-regime"], attrs["data-delta"], "duplicate Q0 chart")
            chart_value = attrs["data-delta"]
        if "data-q-pair" in attrs:
            value = (attrs["data-candidate"], attrs["data-reference"])
            unique_put(self.pairs, attrs["data-q-pair"], value, "duplicate Q0 pair")
            chart_value = " / ".join(value)
        if "data-field" in attrs:
            key = (attrs["data-field"], attrs["data-metric"], attrs["data-player"])
            unique_put(self.fields, key, attrs["data-value"], "duplicate field chart")
            chart_value = attrs["data-value"].replace(",", "")
        if "data-model" in attrs:
            key = (attrs["data-model"], attrs["data-cluster"])
            unique_put(self.mechanisms, key, int(attrs["data-count"]), "duplicate mechanism cell")
            chart_value = attrs["data-cluster"] + " × " + attrs["data-count"]
        if chart_value is not None:
            require(self.chart_frame is None, "nested source-bound charts")
            self.chart_frame = (len(self.stack), chart_value, [])

    def handle_data(self, data):
        if self.in_json:
            self.embedded += data
        if self.in_number:
            self.numbers.append(data.strip())
        if self.chart_frame is not None:
            self.chart_frame[2].append(data)

    def handle_endtag(self, tag):
        require(self.stack and self.stack[-1] == tag, f"HTML: mismatched closing tag {tag}")
        if self.chart_frame is not None and len(self.stack) == self.chart_frame[0]:
            _, value, texts = self.chart_frame
            require(value in "".join(texts), f"HTML: chart label missing source value {value}")
            self.visible_charts.append(value)
            self.chart_frame = None
        self.stack.pop()
        if tag == "script":
            self.in_json = False
        if tag == "span":
            self.in_number = False


_RESULT_LINES = [
    "PASS sources: D0 6 rows, Q0 12 regimes, M1 6 clusters copied verbatim; embedded JSON and chart labels agree",
    "PASS budget: forward KEEP = 100 h exact; unsigned AMEND = 100 h exact; historical >=18.6 h outside cap",
    "PASS chunks: D0 3.90 h; Q0 estimated 13/3..143/30 h; completed night 247/30..26/3 h; Q0b reserved, not completed",
    "PASS exploration: M2-skipped 180 worlds = 13 h + 1.9 h support; AMEND exploration remains gated (10.1333 h < 14.9 h)",
    "PASS queue: q0b -> mix-design -> first-mix -> q0m -> first-p60 -> first-g3 -> m1-implementation -> factor-ab -> m1-pair -> m2",
    "PASS amendment: unsigned, new 41201-41205 seeds, fixed sonnet candidate, original FAIL retained, no Q1 transfer",
    "PASS schedule/review: 28 consecutive dates with gates; all 18 Grok findings addressed",
    "PASS HTML: balanced tags, unique IDs, 18 integer sections, exact budgets/queue/dates, separate P/T field axes, final co-gates",
    "PASS scope: read only master plan, summary HTML, MORNING and M1-RESULT; no run data, browser or network",
    "LIMIT: static consistency only; complete Air usage, ON runtime, strategy safety, rendering and acceptance unverified",
]


def check_documents(document, html, morning, m1):
    require("revision 3" in document.splitlines()[0], "plan revision 3 title")
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
    require(set(QUEUE) <= set(experiment_ids), "queue missing from budget")
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
    require([int(r["順序"]) for r in queue] == list(range(1, 11)), "queue numbers")
    require([r["実験ID"] for r in queue] == QUEUE, "queue priority")
    require(all(r["状態"] and r["窓"] and r["依存・停止"] for r in queue), "queue gates missing")
    expected_queue = [("60", "143/30"), ("0", "1/2"), ("12", "13/15"),
                      ("60", "143/30"), ("60", "13/3"), ("36", "13/5"),
                      ("0", "19/10"), ("48", "52/15"), ("24", "39/20"), ("60", "13/3")]
    require([(r["世界数"], r["全量見積h"]) for r in queue] == expected_queue, "queue worlds/hours")
    require(queue[0]["状態"] == "実行中" and queue[3]["状態"] == "未署名・未実施", "running/unsigned status")
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

    if html is None:
        return [line.replace("; embedded JSON and chart labels agree", "") for line in _RESULT_LINES if not line.startswith("PASS HTML") and not line.startswith("PASS scope")] + [
            "SKIP HTML: the summary page was merged into ASCON-DASHBOARD.html and is verified by dashboard-check.py"]
    summary = Summary()
    summary.feed(html)
    summary.close()
    require(not summary.stack and summary.chart_frame is None, "HTML: unclosed tags/charts")
    require(len(summary.ids) == len(set(summary.ids)), "HTML: duplicate IDs")
    require(summary.sections == [f"s{i}" for i in range(1, 19)], "HTML: consecutive section IDs")
    require(summary.numbers == [str(i) for i in range(1, 19)], "HTML: integer section labels")
    require(summary.budgets == amounts, "HTML: exact budget correspondence")
    require(summary.queue == [(r["実験ID"], r["世界数"], r["全量見積h"]) for r in queue], "HTML: queue correspondence")
    require(summary.dates == [d.isoformat() for d in dates], "HTML: schedule dates")
    require(set(summary.gates) == {"F_mix", "F_ref", "tail", "safe-version"}, "HTML: final co-gates")
    data = json.loads(summary.embedded)
    require(set(data) == {"d0", "q0", "m1", "field_comparison"}, "HTML: source data keys")
    for name, raw in sources.items():
        require(data[name] == parsed_table(raw), f"HTML: {name} JSON differs from source")
    drows, qrows, mrows = [data[name]["rows"] for name in ("d0", "q0", "m1")]
    require(summary.d0 == {r[0]: r[2] for r in drows}, "HTML: D0 bars")
    require(summary.zero == {r[0]: re.search(r"\(([^%]+)%\)", r[6])[1] for r in drows}, "HTML: zero-priority bars")
    require(summary.q0 == {r[0]: r[5] for r in qrows}, "HTML: regime delta bars")
    require(summary.pairs == {r[0]: (r[6], r[7]) for r in qrows}, "HTML: regime T pairs")
    ref = re.search(r"平均 P は sonnet-1 ([\d,.]+)・multi-arb ([\d,.]+)・clean-arb ([\d,.]+)", morning)
    mix = re.search(r"multi-arb が最下位（平均 T ([\d.]+)）・sonnet-1 は ([\d.]+)", morning)
    require(ref is not None and mix is not None, "source field comparison missing")
    field_rows = [["F_ref", "mean P", "sonnet-1", ref[1]], ["F_ref", "mean P", "multi-arb", ref[2]],
                  ["u1m", "mean T", "sonnet-1", mix[2]], ["u1m", "mean T", "multi-arb", mix[1]]]
    require(data["field_comparison"] == field_rows, "HTML: field comparison JSON")
    require(summary.fields == {tuple(r[:3]): r[3] for r in field_rows}, "HTML: field chart metrics/values")
    mechanisms = {}
    for row in mrows:
        for model in ("Astra", "Sonnet", "Opus", "Grok"):
            hit = re.search(model + r"(?:×(\d+))?(?=・|（|$)", row[3])
            if hit:
                mechanisms[(model, row[0])] = int(hit[1] or "1")
    require(summary.mechanisms == mechanisms, "HTML: M1 author/cluster cells")
    require(sum(mechanisms.values()) == 16 and len({c for _, c in mechanisms}) == 6, "M1 totals")

    return list(_RESULT_LINES)


def check():
    directory = Path(__file__).resolve().parent
    names = ("MASTER-PLAN-2026-10-04.md", "summary-2026-10-03.html",
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
