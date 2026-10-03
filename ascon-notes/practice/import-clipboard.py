#!/usr/bin/env python3
"""Import the ASCON practice-devnet connection values from the macOS clipboard into .env.practice.

Never prints a secret value: --inspect shows header NAMES and value LENGTHS only. --write stores the
values in .env.practice (mode 600, gitignored) and appends the wallet key from .env.wallet.local.

Accepted clipboard shapes (any mix, one item per line):
  Header-Name: value          -H "Header-Name: value"        Header-Name=value
  KEY=value lines such as ASCON_HEADER_1_NAME / ASCON_HEADER_1_VALUE are also understood.
"""
import os
import re
import stat
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TARGET = os.path.join(REPO, ".env.practice")
WALLET = os.path.join(REPO, ".env.wallet.local")
RPC_URL = "https://ascon-rpc.nyx.foundation/"
LINE = re.compile(r"""^\s*(?:-H\s+)?["']?\s*([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*(.*?)["']?\s*$""")
# Words that appear in prose around the values, not header names.
KNOWN_HEADERS = ("x-ascon-key", "cf-access-client-id", "cf-access-client-secret")
SKIP_NAMES = {"rpc", "url", "chainid", "chain", "http", "https", "note", "id", "team", "email", "from", "to", "subject"}


def read_clipboard() -> str:
    return subprocess.run(["pbpaste"], capture_output=True, text=True, check=True).stdout


def parse(text: str):
    """Return ([(name, value)], notes). Values are returned only to the caller, never printed."""
    pairs = []
    for raw in text.splitlines():
        m = LINE.match(raw)
        if not m:
            continue
        name, value = m.group(1), m.group(2).strip()
        if not value or name.lower() in SKIP_NAMES or value.startswith("//"):
            continue
        pairs.append((name, value))
    # The three headers the gateway requires (observed in the organizers' mail / viem sample).
    # The same name may appear twice (real value + short placeholder in a code sample): keep the longest.
    best = {}
    for n, v in pairs:
        if n.lower() in KNOWN_HEADERS and len(v) > len(best.get(n.lower(), ("", ""))[1]):
            best[n.lower()] = (n, v)
    if len(best) == len(KNOWN_HEADERS):
        return [best[k] for k in KNOWN_HEADERS]
    # KEY=value style (ASCON_HEADER_n_NAME / _VALUE) -> collapse into header pairs
    env = {n: v for n, v in pairs if n.startswith("ASCON_HEADER_")}
    if env:
        collapsed = []
        for i in (1, 2, 3):
            n, v = env.get(f"ASCON_HEADER_{i}_NAME"), env.get(f"ASCON_HEADER_{i}_VALUE")
            if n and v:
                collapsed.append((n, v))
        pairs = collapsed
    return pairs


def mask(value: str) -> str:
    return f"<{len(value)} chars>"


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "--inspect"
    pairs = parse(read_clipboard())
    if mode == "--inspect":
        print(f"clipboard: {len(read_clipboard())} chars, {len(pairs)} header-like item(s)")
        for i, (n, v) in enumerate(pairs, 1):
            print(f"  {i}. name={n}  value={mask(v)}")
        verdict = "OK (3 headers found)" if len(pairs) == 3 else f"CHECK: expected 3 headers, found {len(pairs)}"
        print(verdict)
        return 0 if len(pairs) == 3 else 2
    if mode == "--write":
        if len(pairs) != 3:
            print(f"refusing to write: expected 3 headers, found {len(pairs)} (run --inspect)", file=sys.stderr)
            return 2
        if os.path.exists(TARGET):
            print(f"refusing to overwrite existing {os.path.basename(TARGET)}", file=sys.stderr)
            return 3
        key_line = ""
        if os.path.exists(WALLET):
            for line in open(WALLET, encoding="utf-8"):
                if line.startswith("AGENT_PRIVATE_KEY="):
                    key_line = line.strip()
        lines = [f"ASCON_RPC_URL={RPC_URL}", "ASCON_CHAIN_ID=31337"]
        for i, (n, v) in enumerate(pairs, 1):
            lines += [f"ASCON_HEADER_{i}_NAME={n}", f"ASCON_HEADER_{i}_VALUE={v}"]
        lines.append(key_line or "AGENT_PRIVATE_KEY=")
        fd = os.open(TARGET, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"wrote {os.path.basename(TARGET)} (mode 600): 3 headers, key {'present' if key_line else 'MISSING'}")
        return 0
    print("usage: import-clipboard.py [--inspect|--write]", file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main())
