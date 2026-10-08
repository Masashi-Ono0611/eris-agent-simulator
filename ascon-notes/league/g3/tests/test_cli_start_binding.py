"""Offline controls: PATH contains a fake claude; never calls a real CLI."""

import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest


WRAPPER = Path(__file__).resolve().parents[1] / "claude-start-binding.py"
FIELDS = {"ts", "kind", "agentId", "pid", "block", "contextSha256"}
STDOUT = b"stub stdout\x00\xff\n"
STDERR = b"stub stderr\x00\xfe\n"
STDIN = b"stdin untouched\x00\xff\n"


class StartBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".binding-test-", dir=WRAPPER.parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.run = self.root / "run"
        self.run.mkdir()
        self.log = self.run / "agents/cand.cli-timing.jsonl"
        self.capture = self.root / "stub.json"
        self.stub_pid = self.root / "stub.pid"
        # Shell $$ is captured before exec, independently of collector metadata.
        script = '''import json, os, pathlib, sys
data = {"argv": sys.argv[1:], "stdin": sys.stdin.buffer.read().hex(),
        "pid": os.getpid(), "startsAtEntry": pathlib.Path(os.environ["STUB_LOG"]).read_text()}
pathlib.Path(os.environ["STUB_CAPTURE"]).write_text(json.dumps(data))
sys.stdout.buffer.write(b"stub stdout\\x00\\xff\\n")
sys.stderr.buffer.write(b"stub stderr\\x00\\xfe\\n")
sys.exit(int(os.environ["STUB_EXIT"]))
'''
        self.stub = self.bin / "claude"
        self.stub.write_text(
            '#!/bin/sh\nprintf "%s\\n" "$$" > "$STUB_PID"\nexec '
            + shlex.quote(sys.executable) + " -B -c " + shlex.quote(script) + ' "$@"\n'
        )
        self.stub.chmod(0o700)
        (self.bin / "python3").symlink_to(sys.executable)
        # No inherited credentials or real CLI path. /bin/sh is an absolute shebang.
        self.env = {
            "PATH": str(self.bin), "ERIS_RUN_DIR": str(self.run), "ERIS_AGENT_ID": "cand",
            "STUB_LOG": str(self.log), "STUB_CAPTURE": str(self.capture),
            "STUB_PID": str(self.stub_pid), "STUB_EXIT": "0", "PYTHONDONTWRITEBYTECODE": "1",
        }

    def args(self, context="block: 120\nsynthetic 日本語\nsecond block: 999\n"):
        return ["-p", context, "--model", "haiku", "--permission-mode", "bypassPermissions",
                "--append-system-prompt", "block: 777\nsynthetic system -p decoy",
                "--disallowed-tools", "Bash", "Edit", "Read", "Write", "Glob", "Grep",
                "WebFetch", "WebSearch", "Task", "SlashCommand", "TodoWrite", "BashOutput",
                "KillShell", "NotebookEdit"]

    def invoke(self, args=None):
        return subprocess.run([str(WRAPPER), *(self.args() if args is None else args)],
                              env=self.env, input=STDIN, capture_output=True, timeout=10)

    def assert_guard(self, expected, args=None):
        result = self.invoke(args)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr,
                         f"g3-cli-binding: guard={expected}; refusing CLI call\n".encode())
        self.assertFalse(self.stub_pid.exists(), "guard must fire before the stub starts")
        self.assertFalse(self.capture.exists())

    def rows(self):
        raw = self.log.read_bytes()
        self.assertTrue(raw.endswith(b"\n"))
        return [json.loads(line) for line in raw.splitlines()]

    def test_normal_argv_stream_exit_and_exec_pid_passthrough(self):
        for exit_code in (0, 37):
            with self.subTest(exit_code=exit_code):
                self.env["STUB_EXIT"] = str(exit_code)
                args = self.args()
                before = datetime.datetime.now(datetime.timezone.utc)
                result = self.invoke(args)
                after = datetime.datetime.now(datetime.timezone.utc)
                self.assertEqual(result.returncode, exit_code)
                self.assertEqual(result.stdout, STDOUT)
                self.assertEqual(result.stderr, STDERR)
                capture = json.loads(self.capture.read_text())
                self.assertEqual(capture["argv"], args)
                self.assertEqual(capture["stdin"], STDIN.hex())
                row = self.rows()[-1]
                self.assertEqual(set(row), FIELDS)  # No raw context or verdict.
                self.assertEqual(row["kind"], "cli_call_started")
                self.assertEqual(row["agentId"], "cand")
                self.assertEqual(row["block"], 120)
                self.assertEqual(row["pid"], int(self.stub_pid.read_text()))
                self.assertEqual(row["pid"], capture["pid"])
                self.assertEqual(row["contextSha256"], hashlib.sha256(args[1].encode()).hexdigest())
                self.assertEqual(json.loads(capture["startsAtEntry"].splitlines()[-1]), row)
                stamp = datetime.datetime.fromisoformat(row["ts"])
                self.assertLessEqual(before, stamp)
                self.assertLessEqual(stamp, after)

    def test_context_argument_guard_fires(self):
        for args in ([], ["-p"], ["--append-system-prompt", "block: 1", "-p", "block: 2"]):
            with self.subTest(args=args):
                self.assert_guard("context_argument", args)
        self.assertFalse(self.log.exists())

    def test_missing_block_guard_fires_even_with_later_or_system_block(self):
        for context in ("", "other\nblock: 120", " block: 120", "[user]\nblock: 120"):
            with self.subTest(context=context):
                self.assert_guard("missing_block", self.args(context))
        self.assertFalse(self.log.exists())

    def test_malformed_block_guard_fires(self):
        for suffix in ("", " -1", " +1", " 1.5", " 1x", " 01", " 1 ", "1", " １２",
                       " 9007199254740992", " 1\r"):
            with self.subTest(suffix=suffix):
                self.assert_guard("malformed_block", self.args("block:" + suffix + "\nbody"))
        self.assertFalse(self.log.exists())

    def test_invalid_agent_id_guard_fires(self):
        for agent in ("", "../escape", "/absolute", "cand/id", "cand.name", "cand\n"):
            with self.subTest(agent=agent):
                self.env["ERIS_AGENT_ID"] = agent
                self.assert_guard("invalid_agent_id")
        del self.env["ERIS_AGENT_ID"]
        self.assert_guard("invalid_agent_id")
        self.assertFalse(self.log.exists())

    def test_missing_relative_or_nonexistent_destination_guard_fires(self):
        for run in ("", "relative", str(self.root / "missing"), str(self.stub)):
            with self.subTest(run=run):
                self.env["ERIS_RUN_DIR"] = run
                self.assert_guard("destination")
        del self.env["ERIS_RUN_DIR"]
        self.assert_guard("destination")
        self.assertFalse(self.log.exists())

    def test_unwritable_destination_guard_fires(self):
        self.log.parent.mkdir()
        self.log.write_bytes(b"existing content\n")
        self.log.chmod(0o400)
        self.addCleanup(self.log.chmod, 0o600)
        # This must exercise an actual permission denial, never a mock or skip.
        self.assertFalse(os.access(self.log, os.W_OK), "run controls as an unprivileged user")
        self.assert_guard("destination")
        self.assertEqual(self.log.read_bytes(), b"existing content\n")

    def test_symlink_destination_guard_fires(self):
        self.log.parent.mkdir()
        target = self.root / "untouched"
        target.write_bytes(b"untouched\n")
        self.log.symlink_to(target)
        self.assert_guard("destination")
        self.assertEqual(target.read_bytes(), b"untouched\n")

    def test_symlink_agents_directory_guard_fires(self):
        target = self.root / "outside"
        target.mkdir()
        self.log.parent.symlink_to(target, target_is_directory=True)
        self.assert_guard("destination")
        self.assertEqual(list(target.iterdir()), [])

    def test_symlink_run_directory_guard_fires_with_or_without_trailing_slash(self):
        alias = self.root / "run-alias"
        alias.symlink_to(self.run, target_is_directory=True)
        for run in (str(alias), str(alias) + "/"):
            with self.subTest(run=run):
                self.env["ERIS_RUN_DIR"] = run
                self.assert_guard("destination")
        self.assertFalse(self.log.exists())

    def test_hardlink_destination_guard_fires(self):
        self.log.parent.mkdir()
        target = self.root / "untouched"
        target.write_bytes(b"untouched\n")
        os.link(target, self.log)
        self.assert_guard("destination")
        self.assertEqual(target.read_bytes(), b"untouched\n")

    def test_fifo_destination_guard_fires_without_hanging(self):
        self.log.parent.mkdir()
        os.mkfifo(self.log)
        self.assert_guard("destination")

    def test_duplicate_block_control_retains_both_without_pass_verdict(self):
        for context in ("block: 120\nfirst", "block: 120\nretry"):
            self.assertEqual(self.invoke(self.args(context)).returncode, 0)
        rows = self.rows()
        self.assertEqual(len(rows), 2)
        # Explicit ambiguity control, not a collector rejection/deduplication.
        duplicate_blocks = {row["block"] for row in rows
                            if sum(other["block"] == row["block"] for other in rows) > 1}
        self.assertEqual(duplicate_blocks, {120}, "duplicate-block ambiguity control must fire")
        self.assertNotEqual(rows[0]["contextSha256"], rows[1]["contextSha256"])
        self.assertEqual(len(json.loads(self.capture.read_text())["startsAtEntry"].splitlines()), 2)
        for row in rows:
            self.assertEqual(set(row), FIELDS)  # No passed/status/complete claim.

    def test_exec_failure_keeps_unfinished_start_without_success_claim(self):
        self.stub.unlink()  # PATH now contains only python3, never a real claude.
        result = self.invoke()
        self.assertEqual(result.returncode, 127)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"g3-cli-binding: guard=exec; refusing CLI call\n")
        self.assertFalse(self.stub_pid.exists())
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(set(self.rows()[0]), FIELDS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
