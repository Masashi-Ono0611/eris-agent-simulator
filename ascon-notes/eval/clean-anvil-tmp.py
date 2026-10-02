#!/usr/bin/env python3
"""Delete leaked anvil history directories (~/.foundry/anvil/tmp/anvil-state-*).

Why: `npm run backtest` stops its anvil with SIGTERM and anvil leaves the per-block history it wrote
while running (about 4-6.5 GB per 12-minute scenario). Fifty runs filled a 460 GB disk (2026-10-03).

Safety: only directories directly under the anvil tmp dir whose name matches `anvil-state-*` and whose
newest file/dir mtime is older than --idle-min minutes are removed. A running anvil writes every block
(2 s), so its directory is always fresh and is never touched. Nothing else is deleted.

Usage: clean-anvil-tmp.py [--idle-min 3] [--dry-run]   (env ANVIL_TMP_DIR overrides the location, for tests)
"""
import argparse
import os
import re
import shutil
import sys
import time

NAME = re.compile(r"^anvil-state-[A-Za-z0-9_.-]+$")


def newest_mtime(path: str) -> float:
    """Newest mtime among the directory itself and everything inside it (a live anvil keeps adding files)."""
    newest = os.lstat(path).st_mtime
    for root, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            try:
                newest = max(newest, os.lstat(os.path.join(root, name)).st_mtime)
            except OSError:
                pass
    return newest


def dir_size(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:
                pass
    return total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--idle-min", type=float, default=3.0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    base = os.environ.get("ANVIL_TMP_DIR") or os.path.expanduser("~/.foundry/anvil/tmp")
    if not os.path.isdir(base):
        print(f"clean-anvil-tmp: {base} does not exist; nothing to do")
        return 0
    now, removed, kept, freed = time.time(), 0, 0, 0
    for entry in sorted(os.listdir(base)):
        path = os.path.join(base, entry)
        # Only real directories (never a symlink) with the exact anvil naming.
        if not NAME.match(entry) or os.path.islink(path) or not os.path.isdir(path):
            continue
        if os.path.dirname(os.path.realpath(path)) != os.path.realpath(base):
            continue
        idle_min = (now - newest_mtime(path)) / 60.0
        if idle_min < args.idle_min:
            kept += 1
            continue
        size = dir_size(path)
        if args.dry_run:
            print(f"would remove {entry} ({size / 1e9:.2f} GB, idle {idle_min:.0f} min)")
        else:
            shutil.rmtree(path)
        removed += 1
        freed += size
    verb = "would remove" if args.dry_run else "removed"
    print(f"clean-anvil-tmp: {verb} {removed} dir(s) ({freed / 1e9:.1f} GB), kept {kept} active/recent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
