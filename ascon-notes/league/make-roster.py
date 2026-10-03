#!/usr/bin/env python3
"""Create an AUTO-wallet league roster."""
import argparse
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
DEFAULTS = ("multi-arb", "clean-arb", "noop")
def make(players, refs=DEFAULTS):
    ids = list(players) + list(refs)
    if len(ids) != len(set(ids)): raise ValueError("duplicate player/reference id")
    for aid in ids:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", aid): raise ValueError(f"invalid id: {aid}")
        if not (ROOT / "example/agents" / aid).is_dir(): raise ValueError(f"agent directory missing: example/agents/{aid}")
    lines = ["agents:"]
    for aid in ids:
        lines.extend([f"  - id: {aid}", "    wallet: AUTO", f"    dir: example/agents/{aid}"])
        if aid == "noop": lines.append("    baseline: true")
    return "\n".join(lines) + "\n"
def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--players", required=True); p.add_argument("--references", default=",".join(DEFAULTS)); p.add_argument("-o", "--output", type=Path); a = p.parse_args()
    try: result = make([x.strip() for x in a.players.split(",") if x.strip()], tuple(x.strip() for x in a.references.split(",") if x.strip()))
    except ValueError as e: p.error(str(e))
    if a.output: a.output.write_text(result, encoding="utf-8")
    else: print(result, end="")
if __name__ == "__main__": main()
