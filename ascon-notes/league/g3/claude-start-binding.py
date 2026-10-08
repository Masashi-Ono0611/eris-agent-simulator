#!/usr/bin/env python3
"""Requirement 1 start binding only; no response capture or G3 verdict."""

import datetime
import fcntl
import hashlib
import json
import os
import re
import stat
import sys


def refuse(guard, code=2):
    # Never expose argv, prompt, environment values, paths, or raw exceptions.
    print(f"g3-cli-binding: guard={guard}; refusing CLI call", file=sys.stderr)
    raise SystemExit(code)


def context_binding(args):
    # llm.ts buildClaudeCliArgs emits [-p, context, ...]. Do not search system
    # text or later arguments for a plausible block when this contract changes.
    if len(args) < 2 or args[0] != "-p":
        refuse("context_argument")
    context = args[1]
    first = context.partition("\n")[0]
    if not first.startswith("block:"):
        refuse("missing_block")
    match = re.fullmatch(r"block: (0|[1-9][0-9]{0,15})", first)
    if match is None or int(match[1]) > 9007199254740991:
        refuse("malformed_block")
    # Hash the exact argv bytes, including newlines; no trim/normalization.
    return int(match[1]), hashlib.sha256(os.fsencode(context)).hexdigest()


def append_start(run, agent, block, context_sha256):
    # Require an existing absolute run directory. Open each child relative to
    # its parent fd, refusing symlinks and non-regular log destinations.
    if not run or not os.path.isabs(run):
        refuse("destination")
    descriptors = []
    try:
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        # A trailing slash must not make the final symlink bypass O_NOFOLLOW.
        root = os.open(run.rstrip("/") or "/", flags)
        descriptors.append(root)
        try:
            os.mkdir("agents", mode=0o700, dir_fd=root)
        except FileExistsError:
            pass
        directory = os.open("agents", flags, dir_fd=root)
        descriptors.append(directory)
        log = os.open(
            agent + ".cli-timing.jsonl",
            os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK,
            0o600, dir_fd=directory,
        )
        descriptors.append(log)
        info = os.fstat(log)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("invalid log type")
        # Serialize cooperating collectors, retaining duplicates verbatim.
        fcntl.flock(log, fcntl.LOCK_EX)
        record = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "kind": "cli_call_started", "agentId": agent, "pid": os.getpid(),
            "block": block, "contextSha256": context_sha256,
        }
        line = (json.dumps(record, separators=(",", ":")) + "\n").encode("ascii")
        if os.write(log, line) != len(line):
            raise OSError("short append")
        os.fsync(log)
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def main():
    args = sys.argv[1:]
    block, context_sha256 = context_binding(args)
    agent = os.environ.get("ERIS_AGENT_ID", "")
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", agent) is None:
        refuse("invalid_agent_id")
    try:
        append_start(os.environ.get("ERIS_RUN_DIR", ""), agent, block, context_sha256)
    except (OSError, ValueError):
        refuse("destination")
    # No subprocess, stdin read, or stream redirection: this PID becomes claude.
    # A failed exec leaves an unfinished start record, never a success marker.
    try:
        os.execvp("claude", ["claude", *args])
    except OSError:
        refuse("exec", code=127)


if __name__ == "__main__":
    main()
