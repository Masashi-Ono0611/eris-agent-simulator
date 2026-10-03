#!/usr/bin/env python3
"""Delete leaked anvil history directories (~/.foundry/anvil/tmp/anvil-state-*) that THIS matrix created.

Why: `npm run backtest` stops its anvil with SIGTERM and anvil leaves the per-block history it wrote while
running (about 4-6.5 GB per 12-minute scenario). Fifty runs filled a 460 GB disk (2026-10-03).

A live anvil does not keep its history directory open (checked with lsof), and "idle" does not prove
"dead" (another project's dev chain can sit idle for minutes), so liveness cannot be inferred from the
directory. Ownership is therefore established the other way round: the matrix records the directories
that existed before it started (--exclude-file, one name per line) and cleans only what appeared after
that, and only while NO anvil process is running at all (--require-no-anvil, the default). With that
the worst case is a skipped cleanup, never a deleted live directory.

Usage:
  clean-anvil-tmp.py --snapshot FILE            record the current directory names (call once at matrix start)
  clean-anvil-tmp.py --exclude-file FILE [--idle-min 3] [--dry-run] [--allow-live-anvil]
Env ANVIL_TMP_DIR overrides the location (tests).
"""
import argparse
import math
import os
import re
import shutil
import subprocess
import sys
import time

NAME = re.compile(r"^anvil-state-[A-Za-z0-9_.-]+$")


def base_dir() -> str:
    return os.environ.get("ANVIL_TMP_DIR") or os.path.expanduser("~/.foundry/anvil/tmp")


def anvil_running() -> bool:
    """True when any anvil process exists, or when that cannot be determined (fail closed)."""
    try:
        res = subprocess.run(["pgrep", "-x", "anvil"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return True
    return res.returncode == 0 or res.returncode > 1


def scan(path: str):
    """Return (newest mtime, bytes, complete). complete=False when anything could not be read."""
    complete = True

    def onerror(_err):
        nonlocal complete
        complete = False

    newest, total = os.lstat(path).st_mtime, 0
    for root, dirs, files in os.walk(path, followlinks=False, onerror=onerror):
        for name in dirs + files:
            try:
                st = os.lstat(os.path.join(root, name))
            except OSError:
                complete = False
                continue
            newest = max(newest, st.st_mtime)
            if name in files:
                total += st.st_size
    return newest, total, complete


def candidates(base: str):
    for entry in sorted(os.listdir(base)):
        path = os.path.join(base, entry)
        if not NAME.match(entry) or os.path.islink(path) or not os.path.isdir(path):
            continue
        if os.path.dirname(os.path.realpath(path)) != os.path.realpath(base):
            continue
        yield entry, path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", metavar="FILE")
    ap.add_argument("--exclude-file", metavar="FILE")
    ap.add_argument("--idle-min", type=float, default=3.0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-live-anvil", action="store_true")
    args = ap.parse_args()
    if not math.isfinite(args.idle_min) or args.idle_min <= 0:
        print("clean-anvil-tmp: --idle-min must be a finite positive number", file=sys.stderr)
        return 2
    base = base_dir()
    if not os.path.isdir(base):
        if args.snapshot:
            open(args.snapshot, "w").close()
        print(f"clean-anvil-tmp: {base} does not exist; nothing to do")
        return 0
    if args.snapshot:
        with open(args.snapshot, "w", encoding="utf-8") as f:
            f.write("".join(name + "\n" for name, _ in candidates(base)))
        print(f"clean-anvil-tmp: snapshot of existing directories saved to {args.snapshot}")
        return 0
    if not args.exclude_file or not os.path.isfile(args.exclude_file):
        print("clean-anvil-tmp: refusing to delete without a snapshot (--exclude-file); run --snapshot first", file=sys.stderr)
        return 2
    existing = set(open(args.exclude_file, encoding="utf-8").read().split())
    if not args.allow_live_anvil and anvil_running():
        print("clean-anvil-tmp: an anvil process is running (or pgrep failed); skipping cleanup this time")
        return 0
    now, removed, kept, freed = time.time(), 0, 0, 0
    for entry, path in candidates(base):
        if entry in existing:
            kept += 1  # existed before the matrix started: not ours
            continue
        newest, size, complete = scan(path)
        if not complete or (now - newest) / 60.0 < args.idle_min:
            kept += 1
            continue
        if args.dry_run:
            print(f"would remove {entry} ({size / 1e9:.2f} GB)")
        else:
            shutil.rmtree(path)
        removed += 1
        freed += size
    verb = "would remove" if args.dry_run else "removed"
    print(f"clean-anvil-tmp: {verb} {removed} dir(s) ({freed / 1e9:.1f} GB), kept {kept}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
