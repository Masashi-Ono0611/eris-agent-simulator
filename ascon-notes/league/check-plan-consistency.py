#!/usr/bin/env python3
"""Check revision-2 plan/HTML arithmetic and contracts; never read evaluation data."""

from datetime import date, timedelta
from fractions import Fraction
from html.parser import HTMLParser
from pathlib import Path
import re
import sys


QUEUE = ["fref-zeta-2c", "fref-sonnet-1", "fref-opus-1",
         "fref-zeta-2a", "fref-zeta-2"]
FINDINGS = ([f"C{i}" for i in range(1, 6)] +
            [f"W{i}" for i in range(6, 14)] +
            [f"S{i}" for i in range(14, 19)])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def table(document, name):
    start, end = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    require(document.count(start) == document.count(end) == 1,
            f"{name}: expected exactly one marker pair")
    content = document.split(start, 1)[1].split(end, 1)[0]
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    require(len(lines) >= 3 and all(line.startswith("|") and line.endswith("|")
                                   for line in lines), f"{name}: malformed table")
    rows = [[cell.strip() for cell in line[1:-1].split("|")] for line in lines]
    require(all(re.fullmatch(r":?-{3,}:?", cell) for cell in rows[1]),
            f"{name}: malformed separator")
    header = rows[0]
    require(len(set(header)) == len(header), f"{name}: duplicate columns")
    require(all(len(row) == len(header) for row in rows[2:]),
            f"{name}: inconsistent column count")
    return [dict(zip(header, row)) for row in rows[2:]]


class Summary(HTMLParser):
    """Static HTML validation only; does not render or execute JavaScript."""
    voids = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.ids = []
        self.dates = []
        self.queue = []
        self.budgets = {"total": {}, "forward": {}}
        self.gates = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag not in self.voids:
            self.stack.append(tag)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "time":
            self.dates.append(attrs.get("datetime"))
        if "data-experiment" in attrs:
            self.queue.append(attrs["data-experiment"])
        if "data-gate" in attrs:
            self.gates.append(attrs["data-gate"])
        if "data-budget-row" in attrs:
            reading, key = attrs["data-budget-reading"], attrs["data-budget-row"]
            require(reading in self.budgets, "HTML: unknown budget reading")
            require(key not in self.budgets[reading], "HTML: duplicate budget row")
            value = Fraction(attrs["data-hours"])
            # The rendered width must agree with the accounting attribute.
            width = re.search(r"--hours:([0-9.]+)(?:;|$)", attrs.get("style", ""))
            require(width is not None and Fraction(width[1]) == value,
                    f"HTML: rendered budget width differs for {reading}/{key}")
            self.budgets[reading][key] = value

    def handle_endtag(self, tag):
        require(self.stack and self.stack[-1] == tag,
                f"HTML: mismatched closing tag {tag}")
        self.stack.pop()


def check():
    directory = Path(__file__).resolve().parent
    document = (directory / "MASTER-PLAN-2026-10-04.md").read_text(encoding="utf-8")
    html = (directory / "summary-2026-10-03.html").read_text(encoding="utf-8")
    require("revision 2" in document.splitlines()[0], "plan: revision 2 title missing")
    amounts, experiments = {}, {}
    for reading in ("total", "forward"):
        name = f"budget-{reading}"
        budget = table(document, name)
        require(sum(row["ID"] == "TOTAL" for row in budget) == 1,
                f"{name}: expected one TOTAL")
        total = next(row for row in budget if row["ID"] == "TOTAL")
        rows = [row for row in budget if row["ID"] != "TOTAL"]
        require(len({row["ID"] for row in rows}) == len(rows), f"{name}: duplicate ID")
        values = {row["ID"]: Fraction(row["Air上限h"]) for row in rows}
        require(all(value >= 0 for value in values.values()), f"{name}: negative hours")
        require(sum(values.values()) == Fraction(total["Air上限h"]) == 100,
                f"{name}: expected exactly 100 h, got {sum(values.values())}")
        amounts[reading] = values
        ids = [item.strip() for row in rows for item in row["実験ID"].split(";")]
        require(all(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", item) for item in ids),
                f"{name}: malformed experiment ID")
        require(len(set(ids)) == len(ids), f"{name}: duplicate experiment ID")
        experiments[reading] = set(ids)
    require(amounts["total"].keys() == amounts["forward"].keys(), "budget: row IDs differ")
    require(amounts["total"]["historical"] == Fraction("18.6"), "A: C_used floor must be 18.6")
    require(100 - amounts["total"]["historical"] == Fraction("81.4"), "A: forward remainder")
    require(amounts["forward"]["historical"] == 0, "B: history must be outside forward cap")
    require(amounts["total"]["deep"] == Fraction("1.4") and
            amounts["forward"]["deep"] == 20, "budget: deep allocations changed")

    stages = table(document, "deep-stages")
    require([row["ID"] for row in stages] == ["factor-ab", "m2", "e3-full", "q1"],
            "deep: expected E1 -> E2 -> independent E3 -> Q1")
    counts, costs = [], []
    for row in stages:
        n = int(row["世界数"])
        require(n > 0, "deep: world count must be positive")
        cost = Fraction((n + 2) // 3 * 13, 60)
        require(cost == Fraction(row["13分/p3の正確h"]), "deep: stage cost mismatch")
        counts.append(n)
        costs.append(cost)
    require(counts == [48, 60, 72, 60] and sum(costs) == Fraction(52, 3), "deep: totals")
    require(sum(costs) + Fraction(8, 3) == amounts["forward"]["deep"], "deep: support envelope")

    queue = table(document, "overnight")
    require([int(row["順序"]) for row in queue] == list(range(1, 6)), "queue: numbering")
    ids = [row["実験ID"] for row in queue]
    require(ids == QUEUE, "queue: must be 2c -> sonnet-1 -> opus-1 -> 2a -> 2")
    for reading in ("total", "forward"):
        require(set(ids) <= experiments[reading], f"{reading}: queue missing from budget")
    require(all(row["A解放"] and row["B解放"] for row in queue), "queue: missing reading release")

    schedule = table(document, "schedule")
    dates = [date.fromisoformat(row["日付"]) for row in schedule]
    first = date(2026, 10, 4)
    require(dates == [first + timedelta(days=i) for i in range(28)], "schedule: 28 consecutive days")
    require(all(row["依存"] and row["停止・反転条件"] for row in schedule), "schedule: missing gates")
    findings = table(document, "findings")
    require([row["ID"] for row in findings] == FINDINGS, "review: expected every finding exactly once")
    for row in findings:
        require(row["判定"] in {"accept", "partly", "reject"}, "review: invalid disposition")
        for key in ("根拠・理由（tag）", "正確な変更箇所・内容（tag）"):
            require(re.search(r"\[(?:measured|inferred|unverified)(?::[^\]]+)?\]", row[key]),
                    f"review: missing evidence tag in {row['ID']}")

    summary = Summary()
    summary.feed(html)
    summary.close()
    require(not summary.stack, "HTML: unclosed tags")
    require(len(summary.ids) == len(set(summary.ids)), "HTML: duplicate IDs")
    require(all(f"s{i}" in summary.ids for i in range(1, 13)), "HTML: missing section")
    require(summary.budgets == amounts, "HTML: both budget bars must match exact plan rows")
    require(summary.queue == QUEUE, "HTML: overnight queue order differs")
    require(summary.dates == [day.isoformat() for day in dates], "HTML: schedule differs")
    require(set(summary.gates) == {"F_mix", "F_ref", "tail", "safe-version"}, "HTML: co-gates missing")

    print("PASS budget A: 8 rows = 100 h exact; C_used floor 18.6 h; forward 81.4 h before delta")
    print("PASS budget B: 8 rows = 100 h exact forward; historical >=18.6 h outside cap")
    print("PASS deep B: 48+60+72+60 = 240 worlds; 52/3 h runs + 8/3 h support = 20 h")
    print("PASS overnight A/B: fref-zeta-2c -> fref-sonnet-1 -> fref-opus-1 -> fref-zeta-2a -> fref-zeta-2")
    print("PASS schedule: 28 consecutive dates, 2026-10-04 through 2026-10-31; dependencies/stops present")
    print("PASS review: 5 Critical + 8 Warning + 5 Suggestion; all dispositions/reasons/changes tagged")
    print("PASS HTML: balanced tags, unique IDs, both exact budget bars, queue, 28 dates, four co-gate markers")
    print("PASS scope: read only master-plan Markdown and summary HTML; no evaluation data or network")
    print("LIMIT: static consistency only; statistics, complete C_used, ON runtime, strategy and acceptance unverified")


def main():
    try:
        check()
    except (OSError, ValueError, KeyError, StopIteration) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
