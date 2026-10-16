import hashlib
import fcntl
import io
import json
import os
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from pathlib import Path

import stage2_guard as guard

REQUIRES_STAT_BIRTHTIME = unittest.skipUnless(
    hasattr(os.stat(__file__), "st_birthtime"),
    "log scanner cursor identity requires macOS/Python stat birth-time support",
)


@contextmanager
def clean_work_log_scan_when_birthtime_unavailable():
    """Keep non-scanner supervisor tests portable without changing native Mac scans."""
    if hasattr(os.stat(__file__), "st_birthtime"):
        yield
    else:
        with patch.object(guard, "_scan_work_logs", side_effect=_clean_work_log_scan):
            yield


def _clean_work_log_scan(work_dir, _offsets, _tails, cursor, final=False, deferred_since=None):
    """Keep non-scanner tests clean while preserving production candidate coverage accounting."""
    candidate = Path(work_dir) / "cand.llm.jsonl"
    try:
        info = os.stat(candidate, follow_symlinks=False)
    except OSError:
        count = 0
    else:
        count = int(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size > 0)
    cursor["nonempty_candidate_log_count"] = count
    return None, False


def _bounded_diagnostic_text(value, limit=400):
    text = " ".join(str(value).split())
    text = re.sub(r"(?<![\w])/(?:[^\s:;,]+)", "<path>", text)
    return text[:limit]


def _failure_marker_snapshot(job):
    allowed = {
        "stop.json": ("reason", "source", "time_unix"),
        "completion-fence.json": ("reason", "source", "time_unix"),
        "terminal.json": ("reason", "source", "world_returncode"),
    }
    snapshot = {}
    for name, fields in allowed.items():
        path = Path(job) / name
        try:
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size > 2048:
                snapshot[name] = "not-regular-or-oversized"
                continue
            with path.open("rb") as marker_file:
                raw = marker_file.read(2049)
            if len(raw) > 2048:
                snapshot[name] = "not-regular-or-oversized"
                continue
            record = json.loads(raw)
        except FileNotFoundError:
            snapshot[name] = "absent"
            continue
        except (OSError, ValueError, TypeError):
            snapshot[name] = "unreadable-or-malformed"
            continue
        if not isinstance(record, dict):
            snapshot[name] = "malformed"
            continue
        bounded = {}
        for field in fields:
            value = record.get(field)
            if field in ("reason", "source") and isinstance(value, str):
                bounded[field] = _bounded_diagnostic_text(value, 120)
            elif type(value) is int:
                bounded[field] = value
        snapshot[name] = bounded
    return json.dumps(snapshot, sort_keys=True)


class Stage2GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.evidence = self.root / "evidence"
        self.evidence.mkdir()
        self.cli = self.root / "fake-claude"
        self.cli.write_text("#!/bin/sh\nprintf '%s\\n' \"$*\"\n")
        self.cli.chmod(0o755)
        self.inputs = self.root / "inputs.json"
        self.inputs.write_text('{"candidate":"diagnostic-fixture"}\n')
        self.prompt_input = self.root / "agent" / "prompt.md"
        self.prompt_input.parent.mkdir()
        self.prompt_input.write_text("---\nmodel: claude-cli:haiku\n---\nfixture prompt\n")
        self.roster_input = self.root / "roster.yaml"
        self.roster_input.write_text("fixture: fake-only\n")
        self.plan_path = self.root / "plan.json"
        self.plan = {
            "schema": 2,
            "job_id": "fixture-job-1",
            "max_cli_starts": 6,
            "input_hash_policy": {
                "version": 1,
                "max_file_bytes": 4 * 1024 * 1024,
                "max_unique_bytes": 8 * 1024 * 1024,
                "max_unique_files": 32,
            },
            "diagnostic_only": True,
            "cli": {"path": str(self.cli), "sha256": guard.sha256_file(self.cli)},
            "forced_args": ["--restricted", "--tools", "", "--strict-mcp-config", "--mcp-config",
                            str(self.root / "empty-mcp.json"), "--setting-sources", ""],
            "empty_mcp_config": str(self.root / "empty-mcp.json"),
            "empty_mcp_sha256": None,
            "input_files": [str(self.inputs), str(self.prompt_input), str(self.roster_input)],
            "model_routing_inputs": {"prompt": str(self.prompt_input), "roster": str(self.roster_input)},
            "prerequisites": {},
        }
        (self.root / "empty-mcp.json").write_text('{"mcpServers":{}}\n')
        self.plan["empty_mcp_sha256"] = guard.sha256_file(self.root / "empty-mcp.json")
        for key in guard.REQUIRED_PREREQUISITES:
            ev = self.evidence / (key + ".txt")
            ev.write_text("fixture evidence for " + key + "\n")
            self.plan["prerequisites"][key] = {
                "status": "verified",
                "path": str(ev),
                "sha256": guard.sha256_file(ev),
            }
        self.plan["evidence_root"] = str(self.evidence)
        self.plan_path.write_text(json.dumps(self.plan, sort_keys=True) + "\n")

    def prepare_job(self, job):
        result = guard.prepare(self.plan_path, job)
        guard.authorize_for_run(job, result["receipt_sha256"])
        return result

    def seed_successful_job_records(self, job):
        self.prepare_job(job)
        (job / "work" / "cand.llm.jsonl").write_text('{"usage":{}}\n')
        argv_digest = "a" * 64
        guard.reserve_start(job, argv_digest)
        log = job / "cli-01.log"
        log.write_bytes(b"start=1 argv_sha256=" + argv_digest.encode("ascii") + b"\nfixture\n")
        (job / "cli-01-result.json").write_text(json.dumps({
            "start": 1, "returncode": 0, "completed_unix": int(time.time()),
            "cli_log_sha256": guard.sha256_file(log), "argv_sha256": argv_digest,
        }) + "\n")
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        (job / "terminal.json").write_text(json.dumps({
            "reason": "world_exit", "source": "supervisor", "world_returncode": 0,
        }) + "\n")

    @staticmethod
    def valid_cli_args(prompt="diagnostic"):
        return ["-p", prompt, "--model", "haiku", "--permission-mode", "bypassPermissions",
                "--append-system-prompt", "fixture system", "--disallowed-tools",
                *guard.DISALLOWED_TOOLS]

    @staticmethod
    def internal_invoke_command(job, cli_args):
        code = (
            "import runpy,sys\nmodule=runpy.run_path(sys.argv[1])\n"
            "try:\n    status=module['invoke'](sys.argv[2],sys.argv[3:])\n"
            "except module['GuardError'] as exc:\n"
            "    print('stage2 guard: '+str(exc),file=sys.stderr)\n    raise SystemExit(78)\n"
            "raise SystemExit(status)\n"
        )
        return [sys.executable, "-I", "-c", code, str(Path(guard.__file__).resolve()),
                str(job), *cli_args]

    def tearDown(self):
        self.tmp.cleanup()

    def test_prepare_records_hashes_and_creates_immutable_receipt(self):
        job = self.root / "job"
        result = guard.prepare(self.plan_path, job)
        receipt = json.loads((job / "receipt.json").read_text())
        self.assertEqual(result["status"], "prepared_blocked_until_parent_review")
        self.assertEqual(receipt["schema"], 2)
        self.assertEqual(receipt["max_cli_starts"], 6)
        self.assertEqual(receipt["input_hash_policy"], self.plan["input_hash_policy"])
        self.assertGreater(receipt["input_hash_accounting"]["unique_file_count"], 0)
        self.assertGreater(receipt["input_hash_accounting"]["unique_bytes_read"], 0)
        self.assertEqual(receipt["cli"]["sha256"], guard.sha256_file(self.cli))
        self.assertIn(str(self.inputs.resolve()), receipt["input_hashes"])
        self.assertFalse(os.stat(job / "receipt.json").st_mode & 0o222)
        with self.assertRaises(guard.GuardError):
            guard.prepare(self.plan_path, job)

    def test_missing_or_malformed_hash_policy_fails_before_job_creation(self):
        for policy in (None, {"version": 1},
                       {"version": True, "max_file_bytes": 100, "max_unique_bytes": 1000,
                        "max_unique_files": 16},
                       {"version": 1, "max_file_bytes": 100, "max_unique_bytes": 1000,
                        "max_unique_files": 16, "extra": 1}):
            with self.subTest(policy=policy):
                plan = dict(self.plan)
                if policy is None:
                    plan.pop("input_hash_policy")
                else:
                    plan["input_hash_policy"] = policy
                self.plan_path.write_text(json.dumps(plan))
                job = self.root / ("bad-policy-" + str(len(list(self.root.glob("bad-policy-*")))))
                with self.assertRaises(guard.GuardError):
                    guard.prepare(self.plan_path, job)
                self.assertFalse(job.exists())

    def test_hash_budget_exact_file_limit_succeeds_and_one_byte_over_fails_without_job(self):
        self.inputs.write_bytes(b"x" * 4096)
        self.plan["input_hash_policy"].update(max_file_bytes=4096, max_unique_bytes=8192)
        self.plan_path.write_text(json.dumps(self.plan))
        exact_job = self.root / "exact-budget"
        guard.prepare(self.plan_path, exact_job)
        self.inputs.write_bytes(b"x" * 4097)
        over_job = self.root / "over-budget"
        with self.assertRaisesRegex(guard.GuardError, "per-file budget"):
            guard.prepare(self.plan_path, over_job)
        self.assertFalse(over_job.exists())

    def test_hash_budget_combines_files_and_evidence_and_rejects_aggregate_overflow(self):
        sizes = [Path(path).stat().st_size for path in self.plan["input_files"]]
        sizes += [Path(item["path"]).stat().st_size
                  for item in self.plan["prerequisites"].values()]
        total = sum(sizes)
        self.plan["input_hash_policy"].update(
            max_file_bytes=max(sizes), max_unique_bytes=total, max_unique_files=len(sizes))
        self.plan_path.write_text(json.dumps(self.plan))
        guard.prepare(self.plan_path, self.root / "aggregate-exact")
        self.plan["input_hash_policy"]["max_unique_bytes"] = total - 1
        self.plan_path.write_text(json.dumps(self.plan))
        over_job = self.root / "aggregate-over"
        with self.assertRaisesRegex(guard.GuardError, "aggregate budget"):
            guard.prepare(self.plan_path, over_job)
        self.assertFalse(over_job.exists())

    def test_hashing_rejects_symlink_and_fifo_without_creating_job(self):
        symlink = self.root / "input-link.json"
        symlink.symlink_to(self.inputs)
        self.plan["input_files"][0] = str(symlink)
        self.plan_path.write_text(json.dumps(self.plan))
        symlink_job = self.root / "symlink-input"
        with self.assertRaisesRegex(guard.GuardError, "symlink"):
            guard.prepare(self.plan_path, symlink_job)
        self.assertFalse(symlink_job.exists())

        fifo = self.root / "input.fifo"
        os.mkfifo(fifo)
        self.plan["input_files"][0] = str(fifo)
        self.plan_path.write_text(json.dumps(self.plan))
        fifo_job = self.root / "fifo-input"
        with self.assertRaisesRegex(guard.GuardError, "safe regular file"):
            guard.prepare(self.plan_path, fifo_job)
        self.assertFalse(fifo_job.exists())

    def test_hardlink_alias_is_charged_once_but_keeps_each_input_hash_path(self):
        alias = self.root / "inputs-hardlink.json"
        os.link(self.inputs, alias)
        self.plan["input_files"].append(str(alias))
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "hardlink-dedup"
        guard.prepare(self.plan_path, job)
        receipt = json.loads((job / "receipt.json").read_text())
        self.assertIn(str(alias.resolve()), receipt["input_hashes"])
        self.assertEqual(receipt["input_hash_accounting"]["unique_file_count"],
                         len(self.plan["input_files"]) - 1 + len(self.plan["prerequisites"]))

    def test_unique_file_cap_rejects_before_opening_excess_file_and_closes_prior_fd(self):
        self.plan["input_hash_policy"]["max_unique_files"] = 1
        self.plan_path.write_text(json.dumps(self.plan))
        original_open = guard._open_regular_file
        opened_fds = []
        input_paths = {str(Path(path).resolve()) for path in self.plan["input_files"]}

        def tracked_open(*args, **kwargs):
            fd, metadata = original_open(*args, **kwargs)
            if str(Path(args[0]).resolve()) in input_paths:
                opened_fds.append(fd)
            return fd, metadata

        job = self.root / "file-count-cap"
        with patch.object(guard, "_open_regular_file", side_effect=tracked_open):
            with self.assertRaisesRegex(guard.GuardError, "unique-file budget"):
                guard.prepare(self.plan_path, job)
        self.assertEqual(len(opened_fds), 1)
        with self.assertRaises(OSError):
            os.fstat(opened_fds[0])
        self.assertFalse(job.exists())

    def test_hardlink_alias_replacement_during_read_is_rejected(self):
        alias_dir = self.root / "alias-parent"
        alias_dir.mkdir()
        alias = alias_dir / "inputs-hardlink-race.json"
        os.link(self.inputs, alias)
        self.plan["input_files"].append(str(alias))
        self.plan_path.write_text(json.dumps(self.plan))
        original_read = os.read
        target_stat = self.inputs.stat()
        replaced = False
        preserved_dir = self.root / "preserved-parent"

        def replacing_read(fd, size):
            nonlocal replaced
            chunk = original_read(fd, size)
            current = os.fstat(fd)
            if chunk and (current.st_dev, current.st_ino) == (target_stat.st_dev, target_stat.st_ino) and not replaced:
                alias_dir.rename(preserved_dir)
                alias_dir.mkdir()
                alias.write_text("replacement inode\n")
                replaced = True
            return chunk

        job = self.root / "alias-race"
        with patch.object(guard.os, "read", side_effect=replacing_read):
            with self.assertRaisesRegex(guard.GuardError, "alias changed"):
                guard.prepare(self.plan_path, job)
        self.assertTrue(replaced)
        self.assertFalse(job.exists())

    def test_schema_one_plan_is_rejected_without_creating_job(self):
        self.plan["schema"] = 1
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "schema-one"
        with self.assertRaisesRegex(guard.GuardError, "unsupported plan schema"):
            guard.prepare(self.plan_path, job)
        self.assertFalse(job.exists())

    def test_receipt_hash_policy_tampering_is_rejected(self):
        job = self.root / "receipt-policy-tamper"
        guard.prepare(self.plan_path, job)
        receipt_path = job / "receipt.json"
        receipt = json.loads(receipt_path.read_text())
        receipt["input_hash_policy"]["max_unique_bytes"] -= 1
        receipt_path.chmod(0o600)
        receipt_path.write_text(json.dumps(receipt))
        receipt_path.chmod(0o400)
        with self.assertRaisesRegex(guard.GuardError, "policy does not match"):
            guard.verify_receipt_inputs(job)

    def test_receipt_hash_accounting_tampering_is_rejected(self):
        job = self.root / "receipt-accounting-tamper"
        guard.prepare(self.plan_path, job)
        receipt_path = job / "receipt.json"
        receipt = json.loads(receipt_path.read_text())
        receipt["input_hash_accounting"]["unique_bytes_read"] -= 1
        receipt_path.chmod(0o600)
        receipt_path.write_text(json.dumps(receipt))
        receipt_path.chmod(0o400)
        with self.assertRaisesRegex(guard.GuardError, "accounting does not match"):
            guard.verify_receipt_inputs(job)

    def test_run_cli_is_hard_disabled_before_review_or_world_launch(self):
        job = self.root / "job"
        result = guard.prepare(self.plan_path, job)
        with patch.object(guard, "authorize_for_run") as authorize, \
                patch.object(guard, "supervise") as supervise, \
                patch("sys.stderr", new_callable=io.StringIO) as stderr:
            code = guard.main(["run", "--job", str(job), "--reviewed-receipt",
                               result["receipt_sha256"], "--", "world-command-must-remain-disabled"])
        self.assertEqual(code, 78)
        self.assertIn("runtime launch is disabled", stderr.getvalue())
        authorize.assert_not_called()
        supervise.assert_not_called()

    def test_invoke_cli_is_hard_disabled_before_model_launch(self):
        job = self.root / "job"
        self.prepare_job(job)
        with patch.object(guard, "invoke") as invoke, \
                patch("sys.stderr", new_callable=io.StringIO) as stderr:
            code = guard.main(["invoke", "--job", str(job), "--", *self.valid_cli_args()])
        self.assertEqual(code, 78)
        self.assertIn("direct CLI invoke is disabled", stderr.getvalue())
        invoke.assert_not_called()

    def test_unknown_prerequisite_fails_without_creating_job(self):
        self.plan["prerequisites"]["B07"]["status"] = "unknown"
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"
        with self.assertRaisesRegex(guard.GuardError, "B07"):
            guard.prepare(self.plan_path, job)
        self.assertFalse(job.exists())

    def test_frontmatter_routing_requires_pinned_prompt_roster_and_evidence(self):
        self.plan["input_files"] = [str(self.inputs), str(self.prompt_input)]
        self.plan_path.write_text(json.dumps(self.plan))
        with self.assertRaisesRegex(guard.GuardError, "model-routing files must be declared"):
            guard.prepare(self.plan_path, self.root / "missing-roster")
        self.plan["input_files"] = [str(self.inputs), str(self.prompt_input), str(self.roster_input)]
        self.plan["prerequisites"]["frontmatter_model_routing"]["status"] = "unknown"
        self.plan_path.write_text(json.dumps(self.plan))
        with self.assertRaisesRegex(guard.GuardError, "frontmatter_model_routing"):
            guard.prepare(self.plan_path, self.root / "missing-routing-evidence")

    def test_receipt_does_not_infer_missing_b05_b07_b08b_or_exclusion(self):
        for key in ("B05", "B07", "B08b", "account_exclusivity"):
            with self.subTest(key=key):
                altered = dict(self.plan)
                altered["prerequisites"] = dict(self.plan["prerequisites"])
                altered["prerequisites"].pop(key)
                self.plan_path.write_text(json.dumps(altered))
                with self.assertRaises(guard.GuardError):
                    guard.prepare(self.plan_path, self.root / ("job-" + key))

    def test_prerequisite_evidence_files_must_be_distinct(self):
        first = self.plan["prerequisites"]["B05"]
        self.plan["prerequisites"] = {key: dict(first) for key in guard.REQUIRED_PREREQUISITES}
        self.plan_path.write_text(json.dumps(self.plan))
        with self.assertRaisesRegex(guard.GuardError, "distinct"):
            guard.prepare(self.plan_path, self.root / "job-reused-evidence")

    def test_cli_hash_and_model_are_pinned(self):
        self.cli.write_text("#!/bin/sh\nexit 0\n")
        with self.assertRaisesRegex(guard.GuardError, "CLI hash"):
            guard.prepare(self.plan_path, self.root / "job")
        self.plan["cli"]["sha256"] = guard.sha256_file(self.cli)
        self.plan["forced_args"] = ["--tools", "--strict-mcp-config"]
        self.plan_path.write_text(json.dumps(self.plan))
        with self.assertRaisesRegex(guard.GuardError, "forced CLI restrictions"):
            guard.prepare(self.plan_path, self.root / "job2")

    def test_start_cap_requires_a_plain_integer_not_bool_float_or_string(self):
        for value in (True, 6.0, "6"):
            with self.subTest(value=value):
                self.plan["max_cli_starts"] = value
                self.plan_path.write_text(json.dumps(self.plan))
                with self.assertRaisesRegex(guard.GuardError, "plain integer"):
                    guard.prepare(self.plan_path, self.root / ("job-cap-" + str(value)))

    def test_invoke_rejects_wrong_model_before_cli_start(self):
        job = self.root / "job"
        guard.prepare(self.plan_path, job)
        with self.assertRaisesRegex(guard.GuardError, "haiku"):
            guard.invoke(job, ["-p", "diagnostic", "--model", "sonnet"])
        self.assertEqual((job / "starts.jsonl").read_text(), "")

    def test_invoke_stops_on_rejected_environment_without_consuming_start(self):
        job = self.root / "job"
        self.prepare_job(job)
        with patch.dict(os.environ, {"BASH_ENV": "unsafe"}, clear=True):
            with self.assertRaisesRegex(guard.GuardError, "provider environment"):
                guard.invoke(job, self.valid_cli_args())
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "cli_environment_rejected")
        self.assertEqual(stop["source"], "claude_cli_environment")
        self.assertEqual((job / "starts.jsonl").read_text(), "")

    def test_invoke_rejects_duplicate_model_before_cli_start(self):
        job = self.root / "job"
        guard.prepare(self.plan_path, job)
        with self.assertRaisesRegex(guard.GuardError, "exactly once"):
            guard.invoke(job, ["-p", "diagnostic", "--model", "haiku", "--model", "sonnet"])
        self.assertEqual((job / "starts.jsonl").read_text(), "")

    def test_invoke_rejects_model_equals_and_short_alias_forms(self):
        cases = (
            ["-p", "x", "--model=opus"],
            ["-p", "x", "-m", "opus"],
            ["-p", "x", "-m=opus"],
        )
        for args in cases:
            with self.subTest(args=args):
                job = self.root / ("job-model-" + str(cases.index(args)))
                self.prepare_job(job)
                with self.assertRaisesRegex(guard.GuardError, "model|argv"):
                    guard.invoke(job, args)
                self.assertEqual((job / "starts.jsonl").read_text(), "")

    def test_invoke_rejects_unlisted_cli_option_smuggling(self):
        additions = (
            ["--settings=/tmp/evil.json"], ["--mcp-config=/tmp/evil.json"],
            ["--allowedTools=Bash"], ["--tools=Read"], ["--permission-mode=bypassPermissions"],
            ["--permission-mode", "bypassPermissions"], ["--"], ["--dangerously-skip-permissions"],
            ["-m", "opus"],
        )
        for index, extra in enumerate(additions):
            with self.subTest(extra=extra):
                job = self.root / ("job-smuggle-" + str(index))
                self.prepare_job(job)
                args = self.valid_cli_args()
                args[-len(guard.DISALLOWED_TOOLS) - 1:-len(guard.DISALLOWED_TOOLS)] += extra
                with self.assertRaises(guard.GuardError):
                    guard.invoke(job, args)
                self.assertEqual((job / "starts.jsonl").read_text(), "")

    def test_empty_mcp_file_change_after_prepare_refuses_start(self):
        job = self.root / "job"
        guard.prepare(self.plan_path, job)
        (self.root / "empty-mcp.json").write_text('{"mcpServers":{"unexpected":{}}}\n')
        with self.assertRaisesRegex(guard.GuardError, "empty MCP config hash changed"):
            guard.reserve_start(job)

    def test_nonempty_mcp_config_is_rejected_even_when_its_hash_matches(self):
        mcp = self.root / "empty-mcp.json"
        mcp.write_text('{"mcpServers":{"unexpected":{"command":"fake"}}}\n')
        self.plan["empty_mcp_sha256"] = guard.sha256_file(mcp)
        self.plan_path.write_text(json.dumps(self.plan))
        with self.assertRaisesRegex(guard.GuardError, "must contain an empty mcpServers"):
            guard.prepare(self.plan_path, self.root / "job")

    def test_invoke_applies_restrictions_and_counts_one_cli_start(self):
        self.cli.write_text("#!/bin/sh\nprintf '%s\\n' \"$*\"\n")
        self.plan["cli"]["sha256"] = guard.sha256_file(self.cli)
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"
        self.prepare_job(job)
        status = guard.invoke(job, self.valid_cli_args())
        self.assertEqual(status, 0)
        output = (job / "cli-01.log").read_text()
        self.assertIn("--restricted --tools  --strict-mcp-config", output)
        self.assertNotIn("bypassPermissions", output)
        self.assertEqual(len((job / "starts.jsonl").read_text().splitlines()), 1)

    def test_invoke_marker_stops_only_the_cli_process_group_it_created(self):
        fake = self.root / "fake-claude"
        child_started = self.root / "cli-child-started"
        child_terminated = self.root / "cli-child-terminated"
        child_code = (
            "import signal,time,pathlib,sys; started=pathlib.Path(sys.argv[1]); "
            "p=pathlib.Path(sys.argv[2]); started.touch(); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.write_text('term'),sys.exit(0))); time.sleep(30)"
        )
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import subprocess,sys,time,pathlib\n"
            "started=pathlib.Path(" + repr(str(child_started)) + ")\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + "," + repr(str(child_started)) + "," + repr(str(child_terminated)) + "])\n"
            "deadline=time.time()+2\n"
            "while time.time()<deadline and not started.exists(): time.sleep(.01)\n"
            "sys.stdout.write('HTTP 429\\n'); sys.stdout.flush(); time.sleep(30)\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        started = time.monotonic()
        status = guard.invoke(job, self.valid_cli_args())
        self.assertEqual(status, 78)
        self.assertLess(time.monotonic() - started, 3)
        self.assertTrue((job / "stop.json").exists())
        deadline = time.time() + 2
        while time.time() < deadline and not child_terminated.exists(): time.sleep(.05)
        self.assertTrue(child_terminated.exists(), "CLI child survived partial-output stop")

    def test_invoke_does_not_stop_when_numeric_marker_continues_in_next_chunk(self):
        fake = self.root / "fake-claude"
        fake.write_text("#!" + sys.executable + "\nimport sys,time\n"
                        "sys.stdout.write('HTTP 429'); sys.stdout.flush(); time.sleep(.15)\n"
                        "sys.stdout.write('1\\n'); sys.stdout.flush()\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        self.assertEqual(guard.invoke(job, self.valid_cli_args()), 0)
        self.assertFalse((job / "stop.json").exists())

    def test_invoke_drains_cli_stdout_after_process_exit(self):
        fake = self.root / "fake-claude"
        fake.write_text("#!" + sys.executable + "\nimport sys\nsys.stdout.write('x' * 12000 + ' HTTP 429')\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        self.assertEqual(guard.invoke(job, self.valid_cli_args()), 78)
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "429")

    def test_invoke_bounds_wait_when_escaped_cli_descendant_holds_stdout(self):
        job = self.root / "job"
        child_pid_file = self.root / "escaped-cli-child.pid"
        fake = self.root / "fake-claude-escaped"
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import pathlib,subprocess,sys\n"
            "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'],start_new_session=True)\n"
            "pathlib.Path(" + repr(str(child_pid_file)) + ").write_text(str(child.pid))\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        self.prepare_job(job)
        child_pid = None
        try:
            self.assertEqual(guard.invoke(job, self.valid_cli_args()), 78)
            self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                             "cli_stdout_eof_timeout")
            child_pid = int(child_pid_file.read_text())
        finally:
            if child_pid is None and child_pid_file.exists():
                child_pid = int(child_pid_file.read_text())
            if child_pid is not None:
                try:
                    os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_invoke_scans_entire_chunk_before_trimming_tail(self):
        fake = self.root / "fake-claude"
        fake.write_text(
            "#!" + sys.executable + "\nimport sys,time\n"
            "sys.stdout.write('HTTP 429 ' + 'x' * 4090); sys.stdout.flush(); time.sleep(.3)\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        self.assertEqual(guard.invoke(job, self.valid_cli_args()), 78)
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "429")

    def test_invoke_signal_stops_cli_session_and_child(self):
        fake = self.root / "fake-claude"
        child_started = self.root / "signal-cli-child-started"
        child_stopped = self.root / "signal-cli-child-stopped"
        child_code = (
            "import pathlib,signal,sys,time; started=pathlib.Path(sys.argv[1]); "
            "stopped=pathlib.Path(sys.argv[2]); started.touch(); "
            "signal.signal(signal.SIGTERM,lambda *_:(stopped.touch(),sys.exit(0))); time.sleep(30)"
        )
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import subprocess,sys,time,pathlib\n"
            "started=pathlib.Path(" + repr(str(child_started)) + ")\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + ","
            + repr(str(child_started)) + "," + repr(str(child_stopped)) + "])\n"
            "deadline=time.time()+2\n"
            "while time.time()<deadline and not started.exists(): time.sleep(.01)\n"
            "time.sleep(30)\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        command = self.internal_invoke_command(job, self.valid_cli_args("signal"))
        invocation = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      start_new_session=True)
        deadline = time.time() + 5
        while time.time() < deadline and not child_started.exists(): time.sleep(.05)
        self.assertTrue(child_started.exists(), "fake CLI child did not start")
        os.kill(invocation.pid, signal.SIGTERM)
        output = invocation.communicate(timeout=8)[0].decode("utf-8", "replace")
        self.assertEqual(invocation.returncode, 78, output)
        deadline = time.time() + 2
        while time.time() < deadline and not child_stopped.exists(): time.sleep(.05)
        self.assertTrue(child_stopped.exists(), "CLI child survived invocation SIGTERM")
        self.assertTrue((job / "stop.json").exists())

    def test_invoke_catches_signal_before_cli_process_start(self):
        job = self.root / "job"; self.prepare_job(job)
        real_control_lock = guard.control_lock
        calls = {"count": 0}

        @contextmanager
        def signal_at_cli_start(lock_job):
            calls["count"] += 1
            with real_control_lock(lock_job):
                if calls["count"] == 1:
                    os.kill(os.getpid(), signal.SIGTERM)
                yield

        with patch.object(guard, "control_lock", side_effect=signal_at_cli_start):
            with self.assertRaisesRegex(guard.GuardError, "before process start"):
                guard.invoke(job, self.valid_cli_args())
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_sigterm")
        self.assertEqual(list((job / "active-cli").glob("*.json")), [])

    def test_invoke_observes_stop_sentinel_and_stops_cli_child(self):
        fake = self.root / "fake-claude"
        child_started = self.root / "sentinel-cli-child-started"
        child_stopped = self.root / "sentinel-cli-child-stopped"
        child_code = (
            "import pathlib,signal,sys,time; started=pathlib.Path(sys.argv[1]); "
            "stopped=pathlib.Path(sys.argv[2]); started.touch(); "
            "signal.signal(signal.SIGTERM,lambda *_:(stopped.touch(),sys.exit(0))); time.sleep(30)"
        )
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import subprocess,sys,time,pathlib\n"
            "started=pathlib.Path(" + repr(str(child_started)) + ")\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + ","
            + repr(str(child_started)) + "," + repr(str(child_stopped)) + "])\n"
            "deadline=time.time()+2\n"
            "while time.time()<deadline and not started.exists(): time.sleep(.01)\n"
            "time.sleep(30)\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        command = self.internal_invoke_command(job, self.valid_cli_args("sentinel"))
        invocation = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      start_new_session=True)
        deadline = time.time() + 5
        while time.time() < deadline and not child_started.exists(): time.sleep(.05)
        self.assertTrue(child_started.exists(), "fake CLI child did not start")
        guard.write_stop(job, "test_stop", "test")
        output = invocation.communicate(timeout=8)[0].decode("utf-8", "replace")
        self.assertEqual(invocation.returncode, 78, output)
        deadline = time.time() + 2
        while time.time() < deadline and not child_stopped.exists(): time.sleep(.05)
        self.assertTrue(child_stopped.exists(), "CLI child survived stop sentinel")

    def test_invoke_nonzero_exit_writes_stop_sentinel(self):
        fake = self.root / "fake-claude"
        fake.write_text("#!/bin/sh\nexit 7\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        self.assertEqual(guard.invoke(job, self.valid_cli_args()), 7)
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "cli_exit_nonzero")

    def test_invoke_retains_unresolved_group_record_when_cleanup_fails(self):
        fake = self.root / "fake-claude"
        pid_file = self.root / "fake-claude.pid"
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import os,pathlib,sys,time\n"
            "pathlib.Path(" + repr(str(pid_file)) + ").write_text(str(os.getpid()))\n"
            "import signal\n"
            "signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))\n"
            "sys.stdout.write('HTTP 429\\n'); sys.stdout.flush(); time.sleep(30)\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        real_terminate_group = guard._terminate_group

        def stop_then_report_failure(pgid, **kwargs):
            real_terminate_group(pgid, **kwargs)
            raise guard.GuardError("simulated cleanup failure")

        with patch.object(guard, "_terminate_group", side_effect=stop_then_report_failure):
            with self.assertRaisesRegex(guard.GuardError, "simulated cleanup failure"):
                guard.invoke(job, self.valid_cli_args())
        self.assertTrue(pid_file.exists())
        records = list((job / "active-cli").glob("*.json"))
        self.assertEqual(len(records), 1, "unresolved owned group must remain registered")
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "429")

    def test_invoke_waits_without_busy_spinning_after_stdout_eof(self):
        fake = self.root / "fake-claude"
        fake.write_text("#!/bin/sh\nexec 1>&-\nsleep .3\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        started = time.monotonic()
        self.assertEqual(guard.invoke(job, self.valid_cli_args()), 0)
        elapsed = time.monotonic() - started
        self.assertGreaterEqual(elapsed, .2)
        self.assertLess(elapsed, 2)

    def test_invoke_rejects_tool_override_before_start(self):
        job = self.root / "job"
        guard.prepare(self.plan_path, job)
        with self.assertRaisesRegex(guard.GuardError, "runtime argument contract"):
            guard.invoke(job, ["-p", "diagnostic", "--model", "haiku", "--allowedTools", "Bash"])
        self.assertEqual((job / "starts.jsonl").read_text(), "")

    def test_provider_environment_is_rejected_and_probe_environment_is_removed(self):
        env = {
            "ANTHROPIC_AUTH_TOKEN": "never-print",
            "NODE_OPTIONS": "--require=x",
            "G3_PROBE_JSONL": "/tmp/probe",
            "PATH": "/usr/bin",
        }
        with self.assertRaisesRegex(guard.GuardError, "provider environment"):
            guard.clean_environment(env)
        clean = guard.clean_environment({k: v for k, v in env.items() if k != "ANTHROPIC_AUTH_TOKEN"})
        self.assertNotIn("NODE_OPTIONS", clean)
        self.assertNotIn("G3_PROBE_JSONL", clean)
        self.assertEqual(clean["PATH"], "/usr/bin")

    def test_alternate_provider_and_runtime_injection_environment_is_rejected(self):
        for key in ("XAI_API_KEY", "HTTPS_PROXY", "DYLD_INSERT_LIBRARIES", "NODE_PATH",
                    "PYTHONPATH", "PYTHONHOME", "ERIS_LLM_MODEL"):
            with self.subTest(key=key):
                value = "codex:opus" if key == "ERIS_LLM_MODEL" else "fixture"
                with self.assertRaises(guard.GuardError):
                    guard.clean_environment({key: value})

    def test_start_ledger_enforces_six_starts_under_lock(self):
        job = self.root / "job"
        self.prepare_job(job)
        for n in range(6):
            guard.reserve_start(job)
        with self.assertRaisesRegex(guard.GuardError, "call cap"):
            guard.reserve_start(job)
        lines = (job / "starts.jsonl").read_text().splitlines()
        self.assertEqual(len(lines), 6)

    def test_start_ledger_corruption_fails_closed(self):
        job = self.root / "job"
        self.prepare_job(job)
        (job / "starts.jsonl").write_text("not-json\n")
        with self.assertRaisesRegex(guard.GuardError, "ledger is malformed"):
            guard.reserve_start(job)

    def test_start_ledger_torn_valid_record_fails_closed_before_append(self):
        job = self.root / "job"
        self.prepare_job(job)
        ledger = job / "starts.jsonl"
        ledger.write_text('{"kind":"cli_start","n":1}')
        with self.assertRaisesRegex(guard.GuardError, "incomplete record"):
            guard.reserve_start(job)
        self.assertEqual(ledger.read_text(), '{"kind":"cli_start","n":1}')

    def test_stop_markers_are_detected_case_insensitively(self):
        for line in ("HTTP 429 rate limit", "HTTP 529 overloaded", "usage limit reached", "quota exceeded",
                     '\"model_fallback\":true', '\"is_error\":true'):
            with self.subTest(line=line):
                self.assertTrue(guard.stop_reason(line))
        self.assertIsNone(guard.stop_reason("request completed"))
        self.assertIsNone(guard.stop_reason("0xdeadbeef429abc"))
        self.assertIsNone(guard.stop_reason("partial HTTP 429"))
        self.assertEqual(guard.stop_reason("partial HTTP 429", final=True), "429")
        self.assertIsNone(guard.stop_reason("partial HTTP 4291", final=True))
        for ordinary in (
                "new Error('ordinary code text')", "quotation size limit reached",
                "1.529", "$3,429", "30.429+00:00", "rateLimit",
                "request error handling", "size limit reached", "fallback model to sonnet",
                "rate limit", "rate-limit", "Rate limit"):
            with self.subTest(ordinary=ordinary):
                self.assertIsNone(guard.stop_reason(ordinary))

    def test_stop_markers_cover_json_envelopes_and_explicit_failure_phrases(self):
        positives = (
            ('{"status":429}', "429"), ('{"code":"429"}', "429"),
            ('{"http_status":429}', "429"), ('errorCode: 429', "429"),
            ('httpStatusCode=429', "429"), ('responseCode: 529', "529"),
            ('Request failed with status code 429', "429"), ('API Error: 429', "429"),
            ('Error: 529', "529"), ('429 Too Many Requests', "429"),
            (r'{\"status\":429}', "429"), (r'{\"code\":429}', "429"),
            (r'{\\"status\\":429}', "429"),
            ('{"message":"rate limit exceeded"}', "rate_limit"),
            ('{"message":"RateLimitError"}', "rate_limit"),
            ('5-hour limit reached', "quota"), ('Weekly limit reached', "quota"),
            ("You've hit your limit", "quota"), ('Your credit balance is too low', "billing"),
            ('{"message":"Overloaded"}', "overloaded"),
            ('{"error":"API Error: 429 {\\"type\\":\\"error\\",\\"error\\":{\\"type\\":\\"rate_limit_error\\"}}"}', "429"),
        )
        for text, expected in positives:
            with self.subTest(text=text):
                self.assertEqual(guard.stop_reason(text, final=True), expected)
        self.assertIsNone(guard.stop_reason('{"message":"rate limit documentation"}', final=True))

    def test_supervisor_does_not_stop_when_numeric_marker_continues_in_next_chunk(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "split-numeric-world.py"
        world.write_text("import os,pathlib,sys,time\n"
                        "sys.stdout.write('HTTP 429'); sys.stdout.flush(); time.sleep(.15)\n"
                        "sys.stdout.write('1\\n'); sys.stdout.flush()\n"
                        "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('{\\\"usage\\\":{}}\\n')\n")
        with clean_work_log_scan_when_birthtime_unavailable():
            with self.assertRaisesRegex(guard.GuardError, "diagnostic coverage incomplete"):
                guard.supervise(job, [sys.executable, str(world)])
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "cli_start_missing")

    def test_supervisor_cleanup_uses_lock_free_cli_group_fallback(self):
        job = self.root / "job"; self.prepare_job(job)
        child_started = self.root / "registered-child-started"
        child_stopped = self.root / "registered-child-stopped"
        lock_unavailable = self.root / "control-lock-unavailable"
        child_code = (
            "import pathlib,signal,sys,time; started=pathlib.Path(sys.argv[1]); "
            "stopped=pathlib.Path(sys.argv[2]); started.touch(); "
            "signal.signal(signal.SIGTERM,lambda *_:(stopped.touch(),sys.exit(0))); time.sleep(30)"
        )
        world = self.root / "lock-failure-world.py"
        world.write_text(
            "import json,os,pathlib,subprocess,sys,time\n"
            "job=pathlib.Path(os.environ['STAGE2_GUARD_JOB'])\n"
            "child=subprocess.Popen([sys.executable,'-c'," + repr(child_code) + ","
            + repr(str(child_started)) + "," + repr(str(child_stopped)) + "],start_new_session=True)\n"
            "deadline=time.time()+3\n"
            "while time.time()<deadline and not pathlib.Path(" + repr(str(child_started)) + ").exists(): time.sleep(.01)\n"
            "process_start=subprocess.check_output(['ps','-p',str(child.pid),'-o','lstart='],text=True).strip()\n"
            "receipt=json.loads((job/'receipt.json').read_text())\n"
            "(job/'active-cli'/'fixture.json').write_text(json.dumps({'job_id':receipt['job_id'],'phase':'registered','pid':child.pid,'pgid':child.pid,'process_start':process_start})+'\\n')\n"
            "pathlib.Path(" + repr(str(lock_unavailable)) + ").touch()\n"
            "time.sleep(30)\n"
        )
        real_control_lock = guard.control_lock

        def lock_until_fixture_signal(job_dir):
            if lock_unavailable.exists():
                raise guard.GuardError("injected control lock failure")
            return real_control_lock(job_dir)

        with patch.object(guard, "control_lock", side_effect=lock_until_fixture_signal):
            with self.assertRaisesRegex(guard.GuardError, "control lock unavailable"):
                guard.supervise(job, [sys.executable, str(world)])
        self.assertTrue(child_started.exists())
        self.assertTrue(child_stopped.exists(), "separately-sessioned CLI group survived lock failure")
        self.assertTrue((job / "active-cli" / "fixture.json").exists(),
                        "lock-free fallback must retain the ownership record")

    @REQUIRES_STAT_BIRTHTIME
    def test_supervisor_stops_only_its_owned_fake_process_group_on_run_log_marker(self):
        job = self.root / "job"
        self.prepare_job(job)
        terminated = self.root / "child-terminated"
        pidfile = self.root / "child.pid"
        child_code = (
            "import signal,time,pathlib,sys; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.write_text('term'),sys.exit(0))); "
            "time.sleep(30)"
        )
        world = self.root / "fake-world.py"
        world.write_text(
            "import os,subprocess,sys,time,pathlib\n"
            "child=subprocess.Popen([sys.executable,'-c'," + repr(child_code) + "," + repr(str(terminated)) + "])\n"
            "pathlib.Path(" + repr(str(pidfile)) + ").write_text(str(child.pid))\n"
            "time.sleep(.25)\n"
            "p=pathlib.Path(os.environ['ERIS_RUN_DIR'])/'cand.llm.jsonl'\n"
            "p.write_text('ERROR: quota exceeded\\n')\n"
            "time.sleep(30)\n"
        )
        with self.assertRaisesRegex(
                guard.GuardError,
                "^owned world process group stopped by diagnostic sentinel$"):
            guard.supervise(job, [sys.executable, str(world)])
        deadline = time.time() + 2
        while time.time() < deadline and not terminated.exists():
            time.sleep(0.05)
        self.assertTrue(terminated.exists(), "owned child did not receive group termination")
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "quota")
        self.assertEqual(stop["source"], "run_log")

    def test_cleanup_attempts_both_groups_when_stop_write_fails(self):
        calls = []

        def publish_stop():
            calls.append("stop")
            raise guard.GuardError("injected stop write failure")

        def terminate_cli():
            calls.append("cli")

        def terminate_world():
            calls.append("world")

        with self.assertRaisesRegex(guard.GuardError, "injected stop write failure"):
            guard._cleanup_owned_groups(publish_stop, terminate_cli, terminate_world)
        self.assertEqual(calls, ["stop", "cli", "world"])

    def test_cleanup_attempts_world_when_cli_cleanup_fails(self):
        calls = []

        def terminate_cli():
            calls.append("cli")
            raise guard.GuardError("injected CLI cleanup failure")

        with self.assertRaisesRegex(guard.GuardError, "injected CLI cleanup failure"):
            guard._cleanup_owned_groups(lambda: calls.append("stop"), terminate_cli,
                                        lambda: calls.append("world"))
        self.assertEqual(calls, ["stop", "cli", "world"])

    def test_supervisor_terminates_owned_children_after_world_leader_exits(self):
        job = self.root / "job"; self.prepare_job(job)
        terminated = self.root / "orphan-terminated"
        child_code = (
            "import signal,time,pathlib,sys; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.write_text('term'),sys.exit(0))); time.sleep(30)"
        )
        world = self.root / "world-exits.py"
        world.write_text(
            "import subprocess,sys,time\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + "," + repr(str(terminated)) + "])\n"
            "time.sleep(.1)\n"
        )
        with self.assertRaisesRegex(guard.GuardError, "diagnostic coverage missing"):
            guard.supervise(job, [sys.executable, str(world)])
        deadline = time.time() + 2
        while time.time() < deadline and not terminated.exists(): time.sleep(.05)
        self.assertTrue(terminated.exists(), "child survived normal world leader exit")

    def test_supervisor_stops_waiting_when_escaped_descendant_holds_stdout_open(self):
        job = self.root / "job"; self.prepare_job(job)
        child_pid_file = self.root / "escaped-child.pid"
        world = self.root / "escaped-stdout-world.py"
        world.write_text(
            "import pathlib,subprocess,sys\n"
            "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'],start_new_session=True)\n"
            "pathlib.Path(" + repr(str(child_pid_file)) + ").write_text(str(child.pid))\n"
        )
        child_pid = None
        try:
            with self.assertRaisesRegex(guard.GuardError, "descendant kept stdout open"):
                guard.supervise(job, [sys.executable, str(world)])
            self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                             "world_stdout_eof_timeout")
            child_pid = int(child_pid_file.read_text())
        finally:
            if child_pid is None and child_pid_file.exists():
                child_pid = int(child_pid_file.read_text())
            if child_pid is not None:
                try:
                    os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    @REQUIRES_STAT_BIRTHTIME
    def test_supervisor_drains_more_than_one_log_chunk_after_world_exit(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "large-final-log.py"
        marker_offset = guard.LOG_CHUNK_BYTES + 7
        world.write_text(
            "import os,pathlib\n"
            "p=pathlib.Path(os.environ['ERIS_RUN_DIR'])/'final.log'\n"
            "p.write_bytes(b'x' * " + str(marker_offset) + " + b' HTTP 429')\n"
        )
        with self.assertRaisesRegex(guard.GuardError, "owned world process group stopped"):
            guard.supervise(job, [sys.executable, str(world)])
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "429")

    def test_active_cli_cleanup_continues_after_malformed_registry_record(self):
        job = self.root / "job"; self.prepare_job(job)
        stopped = self.root / "registry-child-stopped"
        started = self.root / "registry-child-started"
        child_code = (
            "import pathlib,signal,sys,time; started=pathlib.Path(sys.argv[1]); "
            "p=pathlib.Path(sys.argv[2]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.touch(),sys.exit(0))); started.touch(); time.sleep(30)"
        )
        child = subprocess.Popen([sys.executable, "-c", child_code, str(started), str(stopped)], start_new_session=True)
        deadline = time.time() + 3
        while time.time() < deadline and not started.exists(): time.sleep(.01)
        self.assertTrue(started.exists(), "registered child did not start")
        registry = job / "active-cli"
        (registry / "000-invalid.json").write_text("not-json\n")
        (registry / "999-valid.json").write_text(json.dumps({
            "job_id": self.plan["job_id"], "phase": "registered", "pid": child.pid, "pgid": child.pid,
            "process_start": guard._process_start_token(child.pid),
        }) + "\n")
        with self.assertRaisesRegex(guard.GuardError, "active CLI cleanup incomplete"):
            guard.terminate_active_cli_groups(job)
        deadline = time.time() + 3
        while time.time() < deadline and not stopped.exists(): time.sleep(.05)
        self.assertTrue(stopped.exists(), "valid later process group was skipped after malformed record")
        child.wait(timeout=2)
        self.assertTrue((registry / "000-invalid.json").exists(), "malformed ownership record must be retained")
        self.assertFalse((registry / "999-valid.json").exists(), "successfully stopped ownership record remains")

    def test_cli_group_cleanup_finds_child_after_session_leader_exits(self):
        job = self.root / "job"
        stopped = self.root / "orphan-cli-child-stopped"
        fake = self.root / "fake-claude"
        child_code = (
            "import pathlib,signal,sys,time; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.touch(),sys.exit(0))); time.sleep(30)"
        )
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import subprocess,sys,time\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + "," + repr(str(stopped)) + "])\n"
            "time.sleep(.2)\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        self.prepare_job(job)
        self.assertEqual(guard.invoke(job, self.valid_cli_args()), 0)
        deadline = time.time() + 3
        while time.time() < deadline and not stopped.exists(): time.sleep(.05)
        self.assertTrue(stopped.exists(), "CLI descendant survived session-leader exit")

    def test_group_cleanup_falls_back_to_exact_owned_pids_on_darwin_eperm(self):
        for phase in ("term", "kill"):
            with self.subTest(phase=phase):
                ready = self.root / (phase + "-ready")
                stopped = self.root / (phase + "-stopped")
                child_code = (
                    "import pathlib,signal,sys,time; ready=pathlib.Path(sys.argv[1]); "
                    "stopped=pathlib.Path(sys.argv[2]); "
                    + ("signal.signal(signal.SIGTERM,signal.SIG_IGN); " if phase == "kill" else
                       "signal.signal(signal.SIGTERM,lambda *_:(stopped.touch(),sys.exit(0))); ")
                    + "ready.touch(); time.sleep(30)"
                )
                child = subprocess.Popen([sys.executable, "-c", child_code, str(ready), str(stopped)],
                                         start_new_session=True)
                deadline = time.time() + 3
                while time.time() < deadline and not ready.exists(): time.sleep(.01)
                self.assertTrue(ready.exists(), "fake process did not become ready")
                real_killpg = os.killpg

                def eperm_owned_group(pgid, signum):
                    if (phase == "term" and signum == signal.SIGTERM) or (
                            phase == "kill" and signum == signal.SIGKILL):
                        raise PermissionError("simulated Darwin group-signal EPERM")
                    return real_killpg(pgid, signum)

                with patch.object(guard.os, "killpg", side_effect=eperm_owned_group):
                    guard._terminate_group(child.pid, grace=0.2, leader=child)
                child.wait(timeout=2)
                if phase == "term":
                    self.assertTrue(stopped.exists(), "TERM fallback did not reach owned PID")

    def test_supervisor_shim_reaches_only_the_pinned_fake_cli(self):
        fake = self.root / "fake-claude"
        fake.write_text("#!/bin/sh\nprintf 'fake-cli-ok\\n'\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "shim-world.py"
        args = self.valid_cli_args("fake-only")
        world.write_text(
            "import os,pathlib,subprocess,sys\n"
            "status=subprocess.run([os.environ['ERIS_CLAUDE_BIN'], *" + repr(args) + "]).returncode\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('{\\\"usage\\\":{}}\\n')\n"
            "raise SystemExit(status)\n"
        )
        driver = (
            "import os,re,runpy,stat,sys\n"
            "module=runpy.run_path(sys.argv[1])\n"
            "if not hasattr(os.stat(sys.argv[1]), 'st_birthtime'):\n"
            "    def clean_scan(work_dir, _offsets, _tails, cursor, final=False, deferred_since=None):\n"
            "        candidate=os.path.join(work_dir,'cand.llm.jsonl')\n"
            "        try: info=os.stat(candidate, follow_symlinks=False)\n"
            "        except OSError: count=0\n"
            "        else: count=int(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size > 0)\n"
            "        cursor['nonempty_candidate_log_count']=count\n"
            "        return None, False\n"
            "    module['supervise'].__globals__['_scan_work_logs'] = clean_scan\n"
            "    assert module['supervise'].__globals__['_scan_work_logs'] is clean_scan\n"
            "try:\n    status=module['supervise'](sys.argv[2],sys.argv[3:])\n"
            "except module['GuardError'] as exc:\n"
            "    detail=re.sub(r'(?<![\\w])/(?:[^\\s:;,]+)', '<path>', ' '.join(str(exc).split()))[:300]\n"
            "    print('Stage2 GuardError: '+detail, file=sys.stderr)\n    raise SystemExit(78)\n"
            "raise SystemExit(status)\n"
        )
        supervisor = subprocess.run(
            [sys.executable, "-I", "-c", driver, str(guard.__file__), str(job),
             sys.executable, str(world)], check=False, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, timeout=20,
        )
        self.assertEqual(supervisor.returncode, 0, supervisor.stderr)
        self.assertTrue(guard.verify_job_outcome(job, supervisor.returncode))
        self.assertIn(" -I ", (job / "bin" / "claude").read_text())
        self.assertEqual(len((job / "starts.jsonl").read_text().splitlines()), 1)
        self.assertIn("fake-cli-ok", (job / "cli-01.log").read_text())
        result = json.loads((job / "cli-01-result.json").read_text())
        self.assertEqual((result["start"], result["returncode"]), (1, 0))

    def test_killed_supervisor_after_terminal_rejects_complete_disk_evidence(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "shim-world.py"
        args = self.valid_cli_args("fake-only")
        world.write_text(
            "import os,pathlib,subprocess,sys\n"
            "status=subprocess.run([os.environ['ERIS_CLAUDE_BIN'], *" + repr(args) + "]).returncode\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('{\\\"usage\\\":{}}\\n')\n"
            "raise SystemExit(status)\n"
        )
        driver = (
            "import os,re,runpy,stat,sys,time\nmodule=runpy.run_path(sys.argv[1])\n"
            "if not hasattr(os.stat(sys.argv[1]), 'st_birthtime'):\n"
            "    def clean_scan(work_dir, _offsets, _tails, cursor, final=False, deferred_since=None):\n"
            "        candidate=os.path.join(work_dir,'cand.llm.jsonl')\n"
            "        try: info=os.stat(candidate, follow_symlinks=False)\n"
            "        except OSError: count=0\n"
            "        else: count=int(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size > 0)\n"
            "        cursor['nonempty_candidate_log_count']=count\n"
            "        return None, False\n"
            "    module['supervise'].__globals__['_scan_work_logs'] = clean_scan\n"
            "    assert module['supervise'].__globals__['_scan_work_logs'] is clean_scan\n"
            "try:\n    module['supervise'](sys.argv[2],sys.argv[3:])\n"
            "except module['GuardError'] as exc:\n"
            "    detail=re.sub(r'(?<![\\w])/(?:[^\\s:;,]+)', '<path>', ' '.join(str(exc).split()))[:300]\n"
            "    print('Stage2 GuardError: '+detail, file=sys.stderr)\n    raise SystemExit(78)\n"
            "time.sleep(40)\n"
        )
        supervisor = subprocess.Popen(
            [sys.executable, "-I", "-c", driver, str(guard.__file__), str(job),
             sys.executable, str(world)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        killer = subprocess.Popen(
            [sys.executable, "-I", "-c",
             "import os,signal,sys,time\np=sys.argv[1]; pid=int(sys.argv[2]); end=time.monotonic()+30\n"
             "while time.monotonic()<end:\n"
             " if os.path.exists(p): os.kill(pid,signal.SIGKILL); raise SystemExit(0)\n"
             " time.sleep(.01)\nraise SystemExit(2)\n",
             str(job / "terminal.json"), str(supervisor.pid)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        killer_stderr = ""
        supervisor_stderr = ""
        marker_snapshot = "unavailable"
        try:
            _killer_stdout, killer_stderr = killer.communicate(timeout=35)
            marker_snapshot = _failure_marker_snapshot(job)
            if killer.returncode == 0:
                _stdout, supervisor_stderr = supervisor.communicate(timeout=5)
        finally:
            # The world and its CLI use separate sessions, so killing only
            # these direct children can leave their fake process groups alive.
            try:
                guard.terminate_active_cli_groups(job)
            except (guard.GuardError, OSError, subprocess.TimeoutExpired):
                pass
            try:
                raw_pgid = (job / "owned-pgid").read_text(encoding="ascii").strip()
                if raw_pgid.isdigit() and int(raw_pgid) > 0:
                    guard._terminate_group(int(raw_pgid), grace=0.1)
            except (guard.GuardError, OSError, ValueError, subprocess.TimeoutExpired):
                pass
            for child in (killer, supervisor):
                if child.poll() is None:
                    child.kill()
                if child.stdout is not None or child.stderr is not None:
                    try:
                        _stdout, child_stderr = child.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        _stdout, child_stderr = child.communicate(timeout=5)
                    if child is supervisor:
                        supervisor_stderr = child_stderr or supervisor_stderr
                    elif child is killer and child_stderr:
                        killer_stderr = child_stderr
            if killer.returncode != 0:
                marker_snapshot = _failure_marker_snapshot(job)
        killer_failure = json.dumps({
            "returncode": killer.returncode,
            "stderr": _bounded_diagnostic_text(killer_stderr, 300),
            "markers": marker_snapshot,
            "supervisor_returncode": supervisor.returncode,
            "supervisor_stderr": _bounded_diagnostic_text(supervisor_stderr, 300),
        }, sort_keys=True)
        self.assertEqual(killer.returncode, 0, killer_failure)
        supervisor_failure = json.dumps({
            "returncode": supervisor.returncode,
            "stderr": _bounded_diagnostic_text(supervisor_stderr, 300),
            "markers": marker_snapshot,
        }, sort_keys=True)
        self.assertEqual(supervisor.returncode, -signal.SIGKILL, supervisor_failure)
        self.assertTrue((job / "terminal.json").exists())
        self.assertTrue(guard.verify_job_outcome(job, 0), "complete disk evidence is the positive control")
        with self.assertRaisesRegex(guard.GuardError, "exact integer supervisor exit code 0"):
            guard.verify_job_outcome(job, supervisor.returncode)

    def test_supervisor_terminal_failure_uses_lock_free_stop_fallback(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "shim-world.py"
        args = self.valid_cli_args("fake-only")
        world.write_text(
            "import os,pathlib,subprocess,sys\n"
            "status=subprocess.run([os.environ['ERIS_CLAUDE_BIN'], *" + repr(args) + "]).returncode\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('{\\\"usage\\\":{}}\\n')\n"
            "raise SystemExit(status)\n"
        )
        with clean_work_log_scan_when_birthtime_unavailable(), \
                patch.object(guard, "_publish_terminal_success", side_effect=OSError("injected terminal lock failure")):
            with self.assertRaisesRegex(guard.GuardError, "terminal record cannot be verified"):
                guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "terminal_publication_failure")

    def test_dangling_stop_symlink_blocks_all_completion_paths(self):
        job = self.root / "job"; self.prepare_job(job)
        (job / "stop.json").symlink_to(self.root / "missing-stop-target")
        with self.assertRaisesRegex(guard.GuardError, "job is stopped"):
            guard.reserve_start(job, "a" * 64)
        self.assertEqual(guard._cli_completion_gate_issue(job), "job_stopped")
        with self.assertRaisesRegex(guard.GuardError, "STOP takes precedence"):
            guard.verify_job_outcome(job, 0)
        self.assertEqual(guard.write_stop(job, "later_failure", "test"), "existing_stop_invalid")
        with self.assertRaisesRegex(guard.GuardError, "job is stopped"):
            guard.invoke(job, self.valid_cli_args())

    def test_dangling_completion_markers_block_new_starts_and_gate(self):
        job = self.root / "job"; self.prepare_job(job)
        fence = job / "completion-fence.json"
        fence.symlink_to(self.root / "missing-fence-target")
        self.assertEqual(guard._cli_completion_gate_issue(job), "completion_fence_preexisting")
        with self.assertRaisesRegex(guard.GuardError, "already fenced"):
            guard._assert_job_not_finalized(job)
        with self.assertRaisesRegex(guard.GuardError, "already fenced"):
            guard.reserve_start(job, "a" * 64)
        fence.unlink()
        (job / "terminal.json").symlink_to(self.root / "missing-terminal-target")
        with self.assertRaisesRegex(guard.GuardError, "already fenced"):
            guard.reserve_start(job, "a" * 64)
        with self.assertRaisesRegex(guard.GuardError, "already fenced"):
            guard.invoke(job, self.valid_cli_args())

    def test_supervisor_maps_oserror_from_completion_gate_to_specific_stop(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "gate-oserror-world.py"
        world.write_text(
            "import os,pathlib\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('fixture\\n')\n"
        )
        with clean_work_log_scan_when_birthtime_unavailable(), \
                patch.object(guard, "_cli_completion_gate_issue", side_effect=OSError("fixture read error")):
            with self.assertRaisesRegex(guard.GuardError, "coverage could not be verified"):
                guard.supervise(job, [sys.executable, str(world)])
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "cli_completion_unverified")

    def test_supervisor_publishes_gate_stop_when_control_lock_is_unavailable(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "gate-lock-error-world.py"
        world.write_text(
            "import os,pathlib\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('fixture\\n')\n"
        )
        with clean_work_log_scan_when_birthtime_unavailable(), \
                patch.object(guard, "_cli_completion_gate_issue",
                          side_effect=guard.GuardError("control lock unavailable")), \
                patch.object(guard, "write_stop", side_effect=guard.GuardError("control lock unavailable")):
            with self.assertRaisesRegex(guard.GuardError, "coverage could not be verified"):
                guard.supervise(job, [sys.executable, str(world)])
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "cli_completion_unverified")

    def test_supervisor_maps_completion_issue_to_specific_stop(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "gate-issue-world.py"
        world.write_text(
            "import os,pathlib\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('fixture\\n')\n"
        )
        with clean_work_log_scan_when_birthtime_unavailable(), \
                patch.object(guard, "_cli_completion_gate_issue", return_value="cli_completion_incomplete"):
            with self.assertRaisesRegex(guard.GuardError, "coverage incomplete"):
                guard.supervise(job, [sys.executable, str(world)])
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "cli_completion_incomplete")

    def test_completion_fence_and_late_stop_prevent_terminal_success(self):
        fake = self.root / "fake-claude"
        fake.write_text("#!/bin/sh\nexit 0\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "post-cleanup-stop-world.py"
        args = self.valid_cli_args("post-cleanup-stop")
        world.write_text(
            "import os,pathlib,subprocess,sys\n"
            "status=subprocess.run([os.environ['ERIS_CLAUDE_BIN'], *" + repr(args) + "]).returncode\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('{\\\"usage\\\":{}}\\n')\n"
            "raise SystemExit(status)\n"
        )
        real_cleanup = guard._cleanup_owned_groups

        def publish_late_stop(_on_complete, terminate_cli, stop_world):
            result = real_cleanup(lambda: None, terminate_cli, stop_world)
            guard.write_stop(job, "late_external_stop", "test_race")
            return result

        with clean_work_log_scan_when_birthtime_unavailable(), \
                patch.object(guard, "_cleanup_owned_groups", side_effect=publish_late_stop):
            with self.assertRaisesRegex(guard.GuardError, "terminal record cannot be verified"):
                guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "completion-fence.json").read_text())["reason"],
                         "completion_gate_passed")
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "late_external_stop")
        self.assertFalse((job / "terminal.json").exists())

    def test_supervisor_cleanup_failure_after_gate_publishes_failure_stop(self):
        fake = self.root / "fake-claude"
        fake.write_text("#!/bin/sh\nexit 0\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "cleanup-failure-world.py"
        args = self.valid_cli_args("cleanup-failure")
        world.write_text(
            "import os,pathlib,subprocess,sys\n"
            "status=subprocess.run([os.environ['ERIS_CLAUDE_BIN'], *" + repr(args) + "]).returncode\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('{\\\"usage\\\":{}}\\n')\n"
            "raise SystemExit(status)\n"
        )
        with clean_work_log_scan_when_birthtime_unavailable(), \
                patch.object(guard, "_cleanup_owned_groups",
                          side_effect=guard.GuardError("injected cleanup failure")):
            with self.assertRaisesRegex(guard.GuardError, "injected cleanup failure"):
                guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "completion-fence.json").read_text())["reason"],
                         "completion_gate_passed")
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "supervisor_cleanup_failure")
        self.assertFalse((job / "terminal.json").exists())

    def test_supervisor_exception_does_not_publish_normal_terminal_success(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "unexpected-error-world.py"
        world.write_text(
            "import os,pathlib\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('x')\n"
        )
        with patch.object(guard, "stop_if_cli_owner_stale", side_effect=RuntimeError("injected supervisor bug")):
            with self.assertRaisesRegex(RuntimeError, "injected supervisor bug"):
                guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "supervisor_error")
        self.assertFalse((job / "terminal.json").exists())

    def test_supervisor_stops_on_nonzero_world_exit_after_candidate_write(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "nonzero-world.py"
        world.write_text(
            "import os,pathlib,sys\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('fixture\\n')\n"
            "raise SystemExit(7)\n"
        )
        with clean_work_log_scan_when_birthtime_unavailable():
            with self.assertRaisesRegex(guard.GuardError, "world process exited nonzero"):
                guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "world_exit_nonzero")

    def test_supervisor_rechecks_stop_published_after_completion_gate(self):
        fake = self.root / "fake-claude"
        fake.write_text("#!/bin/sh\nexit 0\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "stop-race-world.py"
        args = self.valid_cli_args("stop-race")
        world.write_text(
            "import os,pathlib,subprocess,sys\n"
            "status=subprocess.run([os.environ['ERIS_CLAUDE_BIN'], *" + repr(args) + "]).returncode\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('{\\\"usage\\\":{}}\\n')\n"
            "raise SystemExit(status)\n"
        )
        def publish_stop_at_gate(job_dir, **_kwargs):
            guard._write_completion_fence_locked(job_dir)
            guard.write_stop(job_dir, "injected_completion_race", "test_race")
            return None

        with clean_work_log_scan_when_birthtime_unavailable(), \
                patch.object(guard, "_cli_completion_gate_issue", side_effect=publish_stop_at_gate):
            with self.assertRaisesRegex(guard.GuardError, "job stopped before normal completion"):
                guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "injected_completion_race")

    def test_supervisor_signal_stops_registered_cli_session_and_child(self):
        fake = self.root / "fake-claude"
        child_started = self.root / "cli-child-started"
        child_stopped = self.root / "cli-child-stopped"
        child_code = (
            "import pathlib,signal,sys,time; started=pathlib.Path(sys.argv[1]); "
            "stopped=pathlib.Path(sys.argv[2]); started.touch(); "
            "signal.signal(signal.SIGTERM,lambda *_:(stopped.touch(),sys.exit(0))); time.sleep(30)"
        )
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import subprocess,sys,time\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + ","
            + repr(str(child_started)) + "," + repr(str(child_stopped)) + "])\n"
            "time.sleep(30)\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; result = self.prepare_job(job)
        world = self.root / "signal-world.py"
        world.write_text(
            "import os,pathlib,subprocess,sys,time\n"
            "subprocess.Popen([os.environ['ERIS_CLAUDE_BIN'], *" + repr(self.valid_cli_args("signal")) + "])\n"
            "pathlib.Path(" + repr(str(self.root / "world-started")) + ").touch()\n"
            "time.sleep(30)\n"
        )
        supervisor_code = (
            "import runpy,sys\nmodule=runpy.run_path(sys.argv[1])\n"
            "try:\n    rc=module['supervise'](sys.argv[2],sys.argv[3:])\n"
            "except module['GuardError'] as exc:\n"
            "    print(str(exc),file=sys.stderr)\n    raise SystemExit(78)\n"
            "raise SystemExit(rc)\n"
        )
        command = [sys.executable, "-I", "-c", supervisor_code, str(Path(guard.__file__).resolve()),
                   str(job), sys.executable, str(world)]
        supervisor = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      start_new_session=True)
        deadline = time.time() + 5
        while time.time() < deadline and not child_started.exists(): time.sleep(.05)
        if not child_started.exists():
            if supervisor.poll() is None:
                os.kill(supervisor.pid, signal.SIGTERM)
            output = supervisor.communicate(timeout=8)[0].decode("utf-8", "replace")
            self.fail("owned CLI child did not start through the shim; supervisor output: " + output)
        os.kill(supervisor.pid, signal.SIGTERM)
        output = supervisor.communicate(timeout=8)[0].decode("utf-8", "replace")
        self.assertEqual(supervisor.returncode, 78, output)
        deadline = time.time() + 2
        while time.time() < deadline and not child_stopped.exists(): time.sleep(.05)
        self.assertTrue(child_stopped.exists(), "CLI process-group child survived supervisor SIGTERM")

    def test_supervisor_cleans_cli_group_after_shim_sigkill(self):
        fake = self.root / "fake-claude"
        child_started = self.root / "orphan-child-started"
        child_stopped = self.root / "orphan-child-stopped"
        child_code = (
            "import pathlib,signal,sys,time; started=pathlib.Path(sys.argv[1]); "
            "stopped=pathlib.Path(sys.argv[2]); "
            "signal.signal(signal.SIGTERM,lambda *_:(stopped.touch(),sys.exit(0))); "
            "started.touch(); time.sleep(30)"
        )
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import subprocess,sys,time\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + ","
            + repr(str(child_started)) + "," + repr(str(child_stopped)) + "])\n"
            "time.sleep(30)\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; result = self.prepare_job(job)
        args = self.valid_cli_args("orphan-test")
        world = self.root / "kill-shim-world.py"
        world.write_text(
            "import os,pathlib,subprocess,sys,time\n"
            "shim=os.environ['ERIS_CLAUDE_BIN']; args=" + repr(args) + "\n"
            "first=subprocess.Popen([shim,*args],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n"
            "started=pathlib.Path(" + repr(str(child_started)) + ")\n"
            "deadline=time.time()+5\n"
            "while time.time()<deadline and not started.exists(): time.sleep(.02)\n"
            "if not started.exists(): raise SystemExit('fake CLI child did not start')\n"
            "os.kill(first.pid,9); first.wait(timeout=2)\n"
            "time.sleep(30)\n"
        )
        with self.assertRaisesRegex(guard.GuardError, "owned world process group stopped"):
            guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(len((job / "starts.jsonl").read_text().splitlines()), 1,
                         "supervisor cleanup must not reserve another CLI start")
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_owner_lost")
        deadline = time.time() + 2
        while time.time() < deadline and not child_stopped.exists(): time.sleep(.05)
        self.assertTrue(child_stopped.exists(), "orphan CLI session survived shim SIGKILL")

    def test_world_identity_is_published_before_immediate_shim_can_register(self):
        fake = self.root / "fake-claude"
        ready = self.root / "world-before-shim"
        observed = self.root / "supervised-record-value"
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import json,os,pathlib\n"
            "rows=list((pathlib.Path(os.environ['STAGE2_GUARD_JOB'])/'active-cli').glob('*.json'))\n"
            "row=json.loads(rows[0].read_text())\n"
            "pathlib.Path(" + repr(str(observed)) + ").write_text(str(row['supervised']).lower())\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        args = self.valid_cli_args("identity-race")
        world = self.root / "identity-race-world.py"
        world.write_text(
            "import os,pathlib,subprocess\n"
            "pathlib.Path(" + repr(str(ready)) + ").touch()\n"
            "status=subprocess.run([os.environ['ERIS_CLAUDE_BIN'],*" + repr(args)
            + "],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'cand.llm.jsonl').write_text('{\\\"usage\\\":{}}\\n')\n"
            "raise SystemExit(status)\n"
        )
        real_popen = subprocess.Popen
        wrapped = {"world": False}
        world_process = {"value": None}

        def hold_after_world_spawn(*popen_args, **kwargs):
            proc = real_popen(*popen_args, **kwargs)
            argv = popen_args[0] if popen_args else kwargs.get("args")
            if not wrapped["world"] and argv == [sys.executable, str(world)]:
                wrapped["world"] = True
                world_process["value"] = proc
                deadline = time.time() + 3
                while time.time() < deadline and not ready.exists(): time.sleep(.01)
                if not ready.exists():
                    raise AssertionError("world did not reach its immediate shim call")
                deadline = time.time() + 3
                while time.time() < deadline and not observed.exists():
                    time.sleep(.01)
            return proc

        original_publish = guard.publish_owned_world_group
        published = {"called": False}

        def verify_publication_precedes_registration(job_dir, pid):
            registry = Path(job_dir) / "active-cli"
            if not ready.exists():
                raise guard.GuardError("test control: world did not reach its immediate shim call")
            if observed.exists() or any(p.suffix == ".json" for p in registry.iterdir()):
                raise guard.GuardError(
                    "test control: CLI shim ran before world identity publication",
                )
            published["called"] = True
            return original_publish(job_dir, pid)

        def terminate_only_test_world(pgid, **_kwargs):
            proc = world_process["value"]
            if proc is None or pgid != proc.pid:
                raise guard.GuardError("test cleanup refused an unowned process group")
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=3)

        with clean_work_log_scan_when_birthtime_unavailable(), \
                patch.object(guard.subprocess, "Popen", side_effect=hold_after_world_spawn), \
                patch.object(guard, "publish_owned_world_group",
                             side_effect=verify_publication_precedes_registration), \
                patch.object(guard, "_terminate_group", side_effect=terminate_only_test_world):
            try:
                guard.supervise(job, [sys.executable, str(world)])
            except guard.GuardError as exc:
                self.assertRegex(str(exc), r"world process exited nonzero|diagnostic coverage (incomplete|missing)")
        self.assertTrue(wrapped["world"])
        self.assertTrue(published["called"])
        self.assertEqual(observed.read_text(), "true")

    def test_reserve_start_publishes_stop_and_cleans_cli_with_dead_owner(self):
        job = self.root / "job"; self.prepare_job(job)
        stopped = self.root / "dead-owner-child-stopped"
        child_code = (
            "import pathlib,signal,sys,time; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.touch(),sys.exit(0))); time.sleep(30)"
        )
        cli = subprocess.Popen([sys.executable, "-c", child_code, str(stopped)],
                               start_new_session=True)
        registry = job / "active-cli" / (str(cli.pid) + ".json")
        registry.write_text(json.dumps({
            "phase": "registered",
            "pid": cli.pid, "pgid": cli.pid, "owner_pid": 99999999,
            "owner_process_start": "Mon Jan 1 00:00:00 2001",
            "process_start": guard._process_start_token(cli.pid),
            "owner_pgid": os.getpgid(os.getpid()), "owner_sid": os.getsid(os.getpid()),
            "deadline_unix": time.time() + guard.CLI_OWNER_DEADLINE_SECONDS,
            "supervised": False,
            "job_id": "fixture-job-1",
        }))
        with self.assertRaisesRegex(guard.GuardError, "cli_owner_lost"):
            guard.reserve_start(job)
        self.assertEqual((job / "starts.jsonl").read_text(), "")
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_owner_lost")
        deadline = time.time() + 2
        while time.time() < deadline and not stopped.exists(): time.sleep(.05)
        self.assertTrue(stopped.exists(), "reserve_start did not clean the recorded orphan session")
        cli.wait(timeout=2)

    def test_reserve_start_rejects_reused_owner_pid(self):
        job = self.root / "job"; self.prepare_job(job)
        stopped = self.root / "reused-owner-cli-stopped"
        cli_code = (
            "import pathlib,signal,sys,time; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.touch(),sys.exit(0))); time.sleep(30)"
        )
        cli = subprocess.Popen([sys.executable, "-c", cli_code, str(stopped)], start_new_session=True)
        registry = job / "active-cli" / (str(cli.pid) + ".json")
        registry.write_text(json.dumps({
            "phase": "registered", "pid": cli.pid, "pgid": cli.pid,
            "process_start": guard._process_start_token(cli.pid),
            "owner_pid": os.getpid(), "owner_process_start": "Mon Jan 1 00:00:00 2001",
            "owner_pgid": os.getpgid(os.getpid()), "owner_sid": os.getsid(os.getpid()),
            "deadline_unix": time.time() + guard.CLI_OWNER_DEADLINE_SECONDS,
            "supervised": False, "job_id": "fixture-job-1",
        }))
        with self.assertRaisesRegex(guard.GuardError, "cli_owner_lost"):
            guard.reserve_start(job)
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_owner_lost")
        deadline = time.time() + 2
        while time.time() < deadline and not stopped.exists(): time.sleep(.05)
        self.assertTrue(stopped.exists(), "reused owner PID left its registered CLI group alive")
        cli.wait(timeout=2)

    def test_cli_completion_gate_requires_all_successes_and_no_active_records(self):
        job = self.root / "job"; self.prepare_job(job)
        self.assertEqual(guard._cli_completion_gate_issue(job), "cli_start_missing")
        (job / "starts.jsonl").write_text(
            '{"argv_sha256":"' + "a" * 64 + '","kind":"cli_start","n":1}\n'
            '{"argv_sha256":"' + "a" * 64 + '","kind":"cli_start","n":2}\n'
        )
        for number in (1, 2):
            argv_sha = "a" * 64
            log = job / "cli-{:02d}.log".format(number)
            log.write_text("start={} argv_sha256={}\nfixture\n".format(number, argv_sha))
            (job / "cli-{:02d}-result.json".format(number)).write_text(json.dumps({
                "start": number, "returncode": 0, "completed_unix": 1,
                "cli_log_sha256": guard.sha256_file(log), "argv_sha256": argv_sha,
            }) + "\n")
        self.assertIsNone(guard._cli_completion_gate_issue(job))
        log = job / "cli-02.log"
        original_log = log.read_text()
        log.write_text(original_log + "tampered\n")
        with self.assertRaisesRegex(guard.GuardError, "does not match its diagnostic log"):
            guard._cli_completion_gate_issue(job)
        log.write_text(original_log)
        (job / "cli-02-result.json").write_text(json.dumps({
            "start": 2, "returncode": 0, "completed_unix": 1,
            "cli_log_sha256": guard.sha256_file(log), "argv_sha256": "b" * 64,
        }) + "\n")
        with self.assertRaisesRegex(guard.GuardError, "does not match its argument record"):
            guard._cli_completion_gate_issue(job)
        (job / "starts.jsonl").write_text(
            '{"argv_sha256":"' + "a" * 64 + '","kind":"cli_start","n":1}\n'
            '{"argv_sha256":"' + "b" * 64 + '","kind":"cli_start","n":2}\n'
        )
        (job / "cli-02-result.json").write_text(json.dumps({
            "start": 2, "returncode": 0, "completed_unix": 1,
            "cli_log_sha256": guard.sha256_file(log), "argv_sha256": "a" * 64,
        }) + "\n")
        with self.assertRaisesRegex(guard.GuardError, "reserved argv digest"):
            guard._cli_completion_gate_issue(job)
        (job / "starts.jsonl").write_text(
            '{"argv_sha256":"' + "a" * 64 + '","kind":"cli_start","n":1}\n'
            '{"argv_sha256":"' + "a" * 64 + '","kind":"cli_start","n":2}\n'
        )
        log.unlink()
        with self.assertRaisesRegex(guard.GuardError, "diagnostic log cannot be verified"):
            guard._cli_completion_gate_issue(job)
        log.write_text(original_log)
        (job / "cli-02-result.json").unlink()
        self.assertEqual(guard._cli_completion_gate_issue(job), "cli_completion_incomplete")
        log = job / "cli-02.log"
        (job / "cli-02-result.json").write_text(json.dumps({
            "start": 2, "returncode": 0, "completed_unix": 2,
            "cli_log_sha256": guard.sha256_file(log), "argv_sha256": "a" * 64,
        }) + "\n")
        (job / "active-cli" / "starting.json").write_text("{}\n")
        self.assertEqual(guard._cli_completion_gate_issue(job), "cli_still_active")

    def test_completion_gate_publishes_start_blocking_fence_before_unlock(self):
        job = self.root / "job"; self.prepare_job(job)
        argv_sha = "c" * 64
        (job / "starts.jsonl").write_text(
            json.dumps({"argv_sha256": argv_sha, "kind": "cli_start", "n": 1}) + "\n"
        )
        log = job / "cli-01.log"
        log.write_text("start=1 argv_sha256={}\nfixture\n".format(argv_sha))
        (job / "cli-01-result.json").write_text(json.dumps({
            "start": 1, "returncode": 0, "completed_unix": 1,
            "cli_log_sha256": guard.sha256_file(log), "argv_sha256": argv_sha,
        }) + "\n")
        self.assertIsNone(guard._cli_completion_gate_issue(job, publish_completion=True))
        self.assertEqual(json.loads((job / "completion-fence.json").read_text())["reason"],
                         "completion_gate_passed")
        self.assertFalse((job / "stop.json").exists())
        with self.assertRaisesRegex(guard.GuardError, "job completion is already fenced"):
            guard.reserve_start(job)
        with self.assertRaisesRegex(guard.GuardError, "job completion is already fenced"):
            guard.invoke(job, self.valid_cli_args("late-invoke"))
        self.assertEqual(len(guard._read_cli_start_rows(job)), 1)

    def test_completion_gate_does_not_publish_fence_over_an_existing_stop(self):
        job = self.root / "job"; self.prepare_job(job)
        guard.write_stop(job, "preexisting_failure", "test")
        self.assertEqual(guard._cli_completion_gate_issue(job, publish_completion=True), "job_stopped")
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "preexisting_failure")
        self.assertFalse((job / "completion-fence.json").exists())

    def test_completion_gate_rejects_preexisting_fence_without_cli_evidence(self):
        job = self.root / "job"; self.prepare_job(job)
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        self.assertEqual(
            guard._cli_completion_gate_issue(job, publish_completion=True),
            "completion_fence_preexisting",
        )
        self.assertEqual(guard._count_cli_starts(job), 0)

    def test_completion_gate_rejects_preexisting_fence_with_complete_cli_evidence(self):
        job = self.root / "job"; self.prepare_job(job)
        argv_sha = "9" * 64
        (job / "starts.jsonl").write_text(
            json.dumps({"argv_sha256": argv_sha, "kind": "cli_start", "n": 1}) + "\n"
        )
        log = job / "cli-01.log"
        log.write_text("start=1 argv_sha256={}\nfixture\n".format(argv_sha))
        (job / "cli-01-result.json").write_text(json.dumps({
            "start": 1, "returncode": 0, "completed_unix": 1,
            "cli_log_sha256": guard.sha256_file(log), "argv_sha256": argv_sha,
        }) + "\n")
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        self.assertEqual(
            guard._cli_completion_gate_issue(job, publish_completion=True),
            "completion_fence_preexisting",
        )

    def test_success_recorder_rejects_preexisting_completion_fence(self):
        job = self.root / "job"; self.prepare_job(job)
        log = job / "cli-01.log"
        log.write_text("start=1 argv_sha256={}\nfixture\n".format("e" * 64))
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        with self.assertRaisesRegex(guard.GuardError, "stopped before CLI success"):
            guard._record_cli_success(job, 1, log)
        self.assertFalse((job / "cli-01-result.json").exists())

    def test_reserve_start_rejects_terminal_without_appending_ledger(self):
        job = self.root / "job"; self.prepare_job(job)
        (job / "terminal.json").write_text(json.dumps({
            "reason": "world_exit", "source": "supervisor", "world_returncode": 0,
        }) + "\n")
        with self.assertRaisesRegex(guard.GuardError, "job completion is already fenced"):
            guard.reserve_start(job)
        self.assertEqual(guard._read_cli_start_rows(job), [])

    def test_finalized_job_guard_rejects_terminal_record(self):
        job = self.root / "job"; self.prepare_job(job)
        (job / "terminal.json").write_text(json.dumps({
            "reason": "world_exit", "source": "supervisor", "world_returncode": 0,
        }) + "\n")
        with self.assertRaisesRegex(guard.GuardError, "job completion is already fenced"):
            guard._assert_job_not_finalized(job)

    def test_success_recorder_rejects_preexisting_terminal(self):
        job = self.root / "job"; self.prepare_job(job)
        log = job / "cli-01.log"
        log.write_text("start=1 argv_sha256={}\nfixture\n".format("f" * 64))
        (job / "terminal.json").write_text(json.dumps({
            "reason": "world_exit", "source": "supervisor", "world_returncode": 0,
        }) + "\n")
        with self.assertRaisesRegex(guard.GuardError, "stopped before CLI success"):
            guard._record_cli_success(job, 1, log)
        self.assertFalse((job / "cli-01-result.json").exists())

    def test_invoke_rechecks_fence_after_start_reservation_before_cli_launch(self):
        marker = self.root / "fake-cli-ran"
        fake = self.root / "race-fake-claude"
        fake.write_text("#!/bin/sh\ntouch " + str(marker) + "\nexit 0\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        real_reserve = guard.reserve_start

        def reserve_then_fence(*args, **kwargs):
            number = real_reserve(*args, **kwargs)
            with guard.control_lock(job):
                guard._write_completion_fence_locked(job)
            return number

        with patch.object(guard, "reserve_start", side_effect=reserve_then_fence):
            with self.assertRaisesRegex(guard.GuardError, "job completion is already fenced"):
                guard.invoke(job, self.valid_cli_args("fence-race"))
        self.assertFalse(marker.exists())
        self.assertFalse((job / "cli-01-result.json").exists())

    def test_existing_stop_repairs_terminal_from_prior_crash_window(self):
        job = self.root / "job"; self.prepare_job(job)
        guard.write_stop(job, "existing_failure", "test")
        (job / "terminal.json").write_text(json.dumps({
            "reason": "world_exit", "source": "supervisor", "world_returncode": 0,
        }) + "\n")
        self.assertEqual(guard.write_stop(job, "later_failure", "test"), "existing_failure")
        self.assertFalse((job / "terminal.json").exists())

    def test_stop_published_after_terminal_removes_terminal_and_wins(self):
        job = self.root / "job"; self.prepare_job(job)
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        guard._publish_terminal_success(job, 0)
        self.assertEqual(guard.write_stop(job, "late_failure", "test"), "late_failure")
        self.assertTrue((job / "stop.json").exists())
        self.assertFalse((job / "terminal.json").exists())

    def test_terminal_directory_sync_failure_rolls_back_and_records_stop(self):
        job = self.root / "job"; self.prepare_job(job)
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        real_fsync = os.fsync
        calls = {"count": 0}

        def fail_terminal_directory_sync(fd):
            calls["count"] += 1
            if calls["count"] == 2:
                raise OSError("injected directory fsync failure")
            return real_fsync(fd)

        with patch.object(guard.os, "fsync", side_effect=fail_terminal_directory_sync):
            with self.assertRaisesRegex(guard.GuardError, "cannot publish normal supervisor terminal"):
                guard._publish_terminal_success(job, 0)
        self.assertFalse((job / "terminal.json").exists())
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "terminal_publication_failure")

    def test_terminal_rollback_failure_still_publishes_authoritative_stop(self):
        job = self.root / "job"; self.prepare_job(job)
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        real_fsync = os.fsync
        calls = {"count": 0}

        def fail_terminal_directory_sync(fd):
            calls["count"] += 1
            if calls["count"] == 2:
                raise OSError("injected directory fsync failure")
            return real_fsync(fd)

        with patch.object(guard, "_remove_terminal_for_stop",
                          side_effect=PermissionError("injected unlink failure")), \
                patch.object(guard.os, "fsync", side_effect=fail_terminal_directory_sync):
            with self.assertRaisesRegex(guard.GuardError, "cannot publish normal supervisor terminal"):
                guard._publish_terminal_success(job, 0)
        self.assertTrue((job / "terminal.json").exists())
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "terminal_publication_failure")

    def test_terminal_and_stop_double_failure_is_not_accepted_without_supervisor_rc(self):
        job = self.root / "job"
        self.seed_successful_job_records(job)
        real_fsync = os.fsync
        calls = {"count": 0}

        def fail_terminal_directory_sync(fd):
            calls["count"] += 1
            if calls["count"] == 2:
                raise OSError("injected directory fsync failure")
            return real_fsync(fd)

        with patch.object(guard, "_remove_terminal_for_stop",
                          side_effect=PermissionError("injected terminal unlink failure")), \
                patch.object(guard, "_write_stop_locked",
                             side_effect=OSError("injected STOP persistence failure")), \
                patch.object(guard.os, "fsync", side_effect=fail_terminal_directory_sync):
            with self.assertRaisesRegex(guard.GuardError, "cannot publish normal supervisor terminal"):
                guard._publish_terminal_success(job, 0)
        self.assertTrue((job / "terminal.json").exists())
        self.assertFalse((job / "stop.json").exists())
        with self.assertRaisesRegex(guard.GuardError, "independently observed exact integer"):
            guard.verify_job_outcome(job, 1)

    def test_verify_job_outcome_requires_disk_evidence_and_external_zero(self):
        job = self.root / "job"
        self.seed_successful_job_records(job)
        self.assertTrue(guard.verify_job_outcome(job, 0))
        with self.assertRaisesRegex(guard.GuardError, "independently observed exact integer"):
            guard.verify_job_outcome(job, 78)
        guard.write_stop(job, "late_failure", "test")
        with self.assertRaisesRegex(guard.GuardError, "STOP takes precedence"):
            guard.verify_job_outcome(job, 0)

    def test_verify_job_outcome_rejects_incomplete_or_mismatched_evidence(self):
        mutations = (
            ("missing fence", lambda job: (job / "completion-fence.json").unlink()),
            ("missing terminal", lambda job: (job / "terminal.json").unlink()),
            ("nonzero world", lambda job: (job / "terminal.json").write_text(json.dumps({
                "reason": "world_exit", "source": "supervisor", "world_returncode": 2,
            }) + "\n")),
            ("boolean zero world", lambda job: (job / "terminal.json").write_text(json.dumps({
                "reason": "world_exit", "source": "supervisor", "world_returncode": False,
            }) + "\n")),
            ("float zero world", lambda job: (job / "terminal.json").write_text(json.dumps({
                "reason": "world_exit", "source": "supervisor", "world_returncode": 0.0,
            }) + "\n")),
            ("empty starts", lambda job: (job / "starts.jsonl").write_text("")),
            ("missing result", lambda job: (job / "cli-01-result.json").unlink()),
            ("log mismatch", lambda job: (job / "cli-01.log").write_text("changed\n")),
            ("missing candidate", lambda job: (job / "work" / "cand.llm.jsonl").unlink()),
            ("empty candidate", lambda job: (job / "work" / "cand.llm.jsonl").write_text("")),
            ("candidate symlink", lambda job: ((job / "work" / "cand.llm.jsonl").unlink(),
                                                  (job / "work" / "cand.llm.jsonl").symlink_to(job / "cli-01.log"))),
            ("candidate fifo", lambda job: ((job / "work" / "cand.llm.jsonl").unlink(),
                                              os.mkfifo(job / "work" / "cand.llm.jsonl"))),
            ("candidate hardlink", lambda job: ((job / "work" / "cand.llm.jsonl").unlink(),
                                                   os.link(job / "cli-01.log", job / "work" / "cand.llm.jsonl"))),
            ("fence symlink", lambda job: ((job / "completion-fence.json").unlink(),
                                             (job / "completion-fence.json").symlink_to(job / "terminal.json"))),
            ("malformed fence", lambda job: ((job / "completion-fence.json").chmod(0o600),
                                                (job / "completion-fence.json").write_text("{broken\n"))),
            ("terminal symlink", lambda job: ((job / "terminal.json").unlink(),
                                                (job / "terminal.json").symlink_to(job / "cli-01-result.json"))),
            ("active temp", lambda job: (job / "active-cli" / "pending.tmp").write_text("pending")),
            ("missing review token", lambda job: (job / "review-token.json").unlink()),
        )
        for label, mutate in mutations:
            with self.subTest(label=label):
                job = self.root / ("job-" + label.replace(" ", "-"))
                self.seed_successful_job_records(job)
                mutate(job)
                with self.assertRaises(guard.GuardError):
                    guard.verify_job_outcome(job, 0)

    def test_verify_job_outcome_rejects_non_integer_zero_returncodes(self):
        for value in (True, 0.0, None, "0"):
            with self.subTest(value=value):
                job = self.root / ("job-rc-" + str(value))
                self.seed_successful_job_records(job)
                with self.assertRaisesRegex(guard.GuardError, "exact integer"):
                    guard.verify_job_outcome(job, value)

    def test_verify_job_outcome_rejects_non_integer_cli_zero_returncodes(self):
        for value in (False, 0.0):
            with self.subTest(value=value):
                job = self.root / ("job-cli-rc-" + str(value))
                self.seed_successful_job_records(job)
                result = job / "cli-01-result.json"
                record = json.loads(result.read_text())
                record["returncode"] = value
                result.write_text(json.dumps(record) + "\n")
                with self.assertRaisesRegex(guard.GuardError, "success record is invalid"):
                    guard.verify_job_outcome(job, 0)

    def test_verify_review_token_normalizes_receipt_read_race(self):
        job = self.root / "job"; self.prepare_job(job)
        real_sha256_file = guard.sha256_file

        def disappear_receipt(path):
            if Path(path).resolve() == (job / "receipt.json").resolve():
                raise FileNotFoundError(path)
            return real_sha256_file(path)

        with patch.object(guard, "sha256_file", side_effect=disappear_receipt):
            with self.assertRaisesRegex(guard.GuardError, "receipt disappeared or became unreadable"):
                guard.verify_review_token(job)

    def test_authorize_for_run_normalizes_receipt_hash_race(self):
        job = self.root / "job"; self.prepare_job(job)
        reviewed = guard.sha256_file(job / "receipt.json")
        real_sha256_file = guard.sha256_file

        def disappear_receipt(path):
            if Path(path).resolve() == (job / "receipt.json").resolve():
                raise FileNotFoundError(path)
            return real_sha256_file(path)

        with patch.object(guard, "sha256_file", side_effect=disappear_receipt):
            with self.assertRaisesRegex(guard.GuardError, "receipt disappeared or became unreadable during authorization"):
                guard.authorize_for_run(job, reviewed)

    def test_authorize_for_run_atomically_cleans_failed_token_write(self):
        job = self.root / "job"; self.prepare_job(job)
        reviewed = guard.sha256_file(job / "receipt.json")
        (job / "review-token.json").unlink()
        with patch.object(guard.os, "fsync", side_effect=OSError("injected review token write failure")):
            with self.assertRaisesRegex(guard.GuardError, "cannot atomically publish internal parent-review record"):
                guard.authorize_for_run(job, reviewed)
        self.assertFalse((job / "review-token.json").exists())
        self.assertEqual(list(job.glob(".review-token-*")), [])

    def test_authorize_for_run_accepts_verified_token_when_directory_fsync_fails(self):
        job = self.root / "job"; self.prepare_job(job)
        reviewed = guard.sha256_file(job / "receipt.json")
        (job / "review-token.json").unlink()
        real_fsync = os.fsync
        calls = {"count": 0}

        def fail_directory_fsync(fd):
            calls["count"] += 1
            if calls["count"] == 2:
                raise OSError("injected directory fsync failure")
            return real_fsync(fd)

        with patch.object(guard.os, "fsync", side_effect=fail_directory_fsync):
            self.assertEqual(guard.authorize_for_run(job, reviewed), reviewed)
        self.assertEqual(calls["count"], 2)
        self.assertTrue(guard.verify_review_token(job))
        self.assertEqual(json.loads((job / "review-token.json").read_text())["receipt_sha256"], reviewed)

    def test_control_markers_as_fifo_fail_closed_without_blocking(self):
        for marker in ("stop.json", "completion-fence.json", "terminal.json"):
            with self.subTest(marker=marker):
                job = self.root / ("job-fifo-" + marker.replace(".", "-"))
                self.prepare_job(job)
                os.mkfifo(job / marker)
                if marker == "stop.json":
                    with self.assertRaisesRegex(guard.GuardError, "job is stopped"):
                        guard.reserve_start(job, "a" * 64)
                else:
                    with self.assertRaisesRegex(guard.GuardError, "already fenced"):
                        guard.reserve_start(job, "a" * 64)

    def test_verify_job_outcome_rechecks_stop_after_reading_evidence(self):
        job = self.root / "job"
        self.seed_successful_job_records(job)
        real_count = guard._count_cli_successes

        def publish_stop_after_evidence(*args):
            count = real_count(*args)
            guard.write_stop(job, "late_failure", "test_reader_race")
            return count

        with patch.object(guard, "_count_cli_successes", side_effect=publish_stop_after_evidence):
            with self.assertRaisesRegex(guard.GuardError, "STOP takes precedence"):
                guard.verify_job_outcome(job, 0)

    def test_terminal_publication_rolls_back_when_lock_free_stop_wins_race(self):
        job = self.root / "job"; self.prepare_job(job)
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        real_mkstemp = guard.tempfile.mkstemp
        injected = {"done": False}

        def inject_terminal_before_stop_link(*args, **kwargs):
            result = real_mkstemp(*args, **kwargs)
            if kwargs.get("prefix", "").startswith(".stop-") and not injected["done"]:
                injected["done"] = True
                guard._publish_terminal_success(job, 0)
            return result

        with patch.object(guard.tempfile, "mkstemp", side_effect=inject_terminal_before_stop_link):
            reason = guard._write_stop_locked(job, "race_failure", "test_race")
        self.assertEqual(reason, "race_failure")
        self.assertTrue((job / "stop.json").exists())
        self.assertFalse((job / "terminal.json").exists())

    def test_terminal_publication_rolls_back_when_stop_precedes_terminal_link(self):
        job = self.root / "job"; self.prepare_job(job)
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        real_mkstemp = guard.tempfile.mkstemp
        injected = {"done": False}

        def inject_stop_before_terminal_link(*args, **kwargs):
            result = real_mkstemp(*args, **kwargs)
            if kwargs.get("prefix", "").startswith(".terminal-") and not injected["done"]:
                injected["done"] = True
                guard._write_stop_locked(job, "race_failure", "test_race")
            return result

        with patch.object(guard.tempfile, "mkstemp", side_effect=inject_stop_before_terminal_link):
            with self.assertRaisesRegex(guard.GuardError, "failure STOP raced with terminal publication"):
                guard._publish_terminal_success(job, 0)
        self.assertTrue((job / "stop.json").exists())
        self.assertFalse((job / "terminal.json").exists())

    def test_supervise_refuses_a_finalized_job_before_creating_shim_or_log(self):
        job = self.root / "job"; self.prepare_job(job)
        with guard.control_lock(job):
            guard._write_completion_fence_locked(job)
        marker = self.root / "world-ran"
        command = [sys.executable, "-c", "import pathlib,sys; pathlib.Path(sys.argv[1]).touch()", str(marker)]
        with self.assertRaisesRegex(guard.GuardError, "job completion is already fenced"):
            guard.supervise(job, command)
        self.assertFalse(marker.exists())
        self.assertFalse((job / "world.log").exists())
        self.assertFalse((job / "bin" / "claude").exists())

    def test_second_supervisor_shim_collision_does_not_stop_first_job(self):
        job = self.root / "job"; self.prepare_job(job)
        (job / "bin" / "claude").write_text("already-owned shim\n")
        marker = self.root / "world-ran"
        command = [sys.executable, "-c", "import pathlib,sys; pathlib.Path(sys.argv[1]).touch()", str(marker)]
        with self.assertRaisesRegex(guard.GuardError, "supervisor shim already exists"):
            guard.supervise(job, command)
        self.assertFalse(marker.exists())
        self.assertFalse((job / "stop.json").exists())

    def test_shim_open_error_does_not_stop_job_with_existing_shim(self):
        job = self.root / "job"; self.prepare_job(job)
        shim = job / "bin" / "claude"
        shim.write_text("#!/bin/sh\nexit 0\n")
        real_open = os.open

        def fail_existing_shim(path, *args, **kwargs):
            if Path(path).resolve() == shim.resolve():
                raise PermissionError("injected shim open failure")
            return real_open(path, *args, **kwargs)

        with patch.object(guard.os, "open", side_effect=fail_existing_shim):
            with self.assertRaisesRegex(guard.GuardError, "cannot create unique Claude shim"):
                guard.supervise(job, [sys.executable, "-c", "pass"])
        self.assertFalse((job / "stop.json").exists())
        self.assertEqual(shim.read_text(), "#!/bin/sh\nexit 0\n")

    def test_completion_gate_lock_serializes_a_competing_cli_reservation(self):
        job = self.root / "job"; self.prepare_job(job)
        argv_sha = "d" * 64
        (job / "starts.jsonl").write_text(
            json.dumps({"argv_sha256": argv_sha, "kind": "cli_start", "n": 1}) + "\n"
        )
        log = job / "cli-01.log"
        log.write_text("start=1 argv_sha256={}\nfixture\n".format(argv_sha))
        (job / "cli-01-result.json").write_text(json.dumps({
            "start": 1, "returncode": 0, "completed_unix": 1,
            "cli_log_sha256": guard.sha256_file(log), "argv_sha256": argv_sha,
        }) + "\n")
        original_publish = guard._write_completion_fence_locked
        original_flock = guard.fcntl.flock
        contended = threading.Event()
        finished = threading.Event()
        outcome = []
        contenders = []

        def observed_flock(fd, operation):
            try:
                return original_flock(fd, operation)
            except BlockingIOError:
                if threading.current_thread().name == "reservation-contender":
                    contended.set()
                raise

        def competing_reservation():
            try:
                guard.reserve_start(job)
            except guard.GuardError as exc:
                outcome.append(str(exc))
            finally:
                finished.set()

        def publish_after_competitor_starts(job_dir):
            contender = threading.Thread(target=competing_reservation, name="reservation-contender")
            contenders.append(contender)
            contender.start()
            self.assertTrue(contended.wait(5), "contender never observed the held OS lock")
            return original_publish(job_dir)

        with patch.object(guard.fcntl, "flock", side_effect=observed_flock), \
                patch.object(guard, "_write_completion_fence_locked", side_effect=publish_after_competitor_starts):
            self.assertIsNone(guard._cli_completion_gate_issue(job, publish_completion=True))
        for contender in contenders:
            contender.join(timeout=2)
            self.assertFalse(contender.is_alive(), "reservation did not resume after gate unlock")
        self.assertEqual(outcome, ["job completion is already fenced"])
        self.assertEqual(len((job / "starts.jsonl").read_text().splitlines()), 1)
        self.assertEqual(len(guard._read_cli_start_rows(job)), 1)

    def test_reserve_start_stops_cli_when_owner_deadline_expires(self):
        job = self.root / "job"; self.prepare_job(job)
        cli = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                               start_new_session=True)
        registry = job / "active-cli" / (str(cli.pid) + ".json")
        registry.write_text(json.dumps({
            "phase": "registered",
            "pid": cli.pid, "pgid": cli.pid, "owner_pid": os.getpid(),
            "owner_process_start": guard._process_start_token(os.getpid()),
            "process_start": guard._process_start_token(cli.pid),
            "owner_pgid": os.getpgid(os.getpid()), "owner_sid": os.getsid(os.getpid()),
            "deadline_unix": time.time() - 1, "job_id": "fixture-job-1",
            "supervised": False,
        }))
        with self.assertRaisesRegex(guard.GuardError, "cli_owner_deadline"):
            guard.reserve_start(job)
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_owner_deadline")
        cli.wait(timeout=2)

    def test_unreaped_zombie_shim_owner_is_detected_as_lost(self):
        job = self.root / "job"; self.prepare_job(job)
        owner = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        registry = job / "active-cli" / "zombie-owner.json"
        owner_start = guard._process_start_token(owner.pid)
        registry.write_text(json.dumps({
            "phase": "registered", "pid": 99999998, "pgid": 99999998,
            "owner_pid": owner.pid, "owner_pgid": os.getpgid(owner.pid),
            "owner_process_start": owner_start,
            "owner_sid": os.getsid(owner.pid), "deadline_unix": time.time() + 300,
            "supervised": False, "job_id": "fixture-job-1",
        }))
        try:
            owner.kill()
            deadline = time.time() + 3
            state = None
            while time.time() < deadline:
                state = guard._owner_process_state(owner.pid)
                if state and state.startswith("Z"):
                    break
                time.sleep(.02)
            self.assertTrue(state and state.startswith("Z"),
                            "positive control did not observe an unreaped zombie owner")
            self.assertEqual(guard._stale_cli_owner_reason(job), "cli_owner_lost")
        finally:
            owner.wait(timeout=2)

    def test_process_group_inventory_timeout_fails_closed(self):
        with patch.object(guard.subprocess, "run",
                          side_effect=subprocess.TimeoutExpired("ps", 2)):
            with self.assertRaisesRegex(guard.GuardError, "process-group inventory timed out"):
                guard._live_group_members(12345)

    def test_sigkill_between_cli_popen_and_registration_stops_with_unknown_owner(self):
        fake = self.root / "fake-claude"
        started = self.root / "pre-register-cli-started"
        finished = self.root / "pre-register-cli-finished"
        fake.write_text(
            "#!" + sys.executable + "\n"
            "import pathlib,time\n"
            "pathlib.Path(" + repr(str(started)) + ").touch()\n"
            "time.sleep(.4)\n"
            "pathlib.Path(" + repr(str(finished)) + ").touch()\n"
        )
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        job = self.root / "job"; self.prepare_job(job)
        args = self.valid_cli_args("registration-window")
        invoker = self.root / "kill-in-registration-window.py"
        invoker.write_text(
            "import os,signal,sys\n"
            "sys.path.insert(0," + repr(str(Path(guard.__file__).resolve().parent)) + ")\n"
            "import stage2_guard as guard\n"
            "guard.register_cli_group=lambda *args: os.kill(os.getpid(), signal.SIGKILL)\n"
            "try:\n guard.invoke(" + repr(str(job)) + "," + repr(args) + ")\n"
            "except guard.GuardError as exc:\n print(str(exc),file=sys.stderr); raise SystemExit(78)\n"
        )
        invoke = subprocess.Popen([sys.executable, str(invoker)], stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL)
        self.assertEqual(invoke.wait(timeout=5), -signal.SIGKILL)
        deadline = time.time() + 2
        while time.time() < deadline and not started.exists(): time.sleep(.02)
        self.assertTrue(started.exists(), "fake CLI did not start in the targeted post-Popen window")
        with self.assertRaisesRegex(guard.GuardError, "cli_registration_incomplete"):
            guard.reserve_start(job)
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "cli_registration_incomplete")
        pending = list((job / "active-cli").glob("pending-*.json"))
        self.assertEqual(len(pending), 1, "unknown process-group ownership must be retained")
        self.assertEqual(json.loads(pending[0].read_text())["phase"], "starting")
        self.assertEqual(len((job / "starts.jsonl").read_text().splitlines()), 1)
        deadline = time.time() + 3
        while time.time() < deadline and not finished.exists(): time.sleep(.02)
        self.assertTrue(finished.exists(), "fake CLI should self-terminate after the orphan observation")

    def test_invoke_oserror_publishes_stop_before_retry(self):
        job = self.root / "job"; self.prepare_job(job)
        with patch.object(guard.subprocess, "Popen", side_effect=OSError("simulated ENOENT")), \
                patch.object(guard, "_process_start_token", return_value="fixture-owner-start"):
            with self.assertRaisesRegex(guard.GuardError, "cannot start pinned Claude CLI"):
                guard.invoke(job, self.valid_cli_args())
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_launch_failure")

    def test_invoke_normalizes_non_oserror_cli_launch_failure(self):
        job = self.root / "job"; self.prepare_job(job)
        with patch.object(guard.subprocess, "Popen", side_effect=ValueError("embedded NUL")), \
                patch.object(guard, "_process_start_token", return_value="fixture-start"):
            with self.assertRaisesRegex(guard.GuardError, "cannot start pinned Claude CLI"):
                guard.invoke(job, self.valid_cli_args())
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_launch_failure")
        self.assertEqual(list((job / "active-cli").glob("*.json")), [])

    def test_invoke_registration_failure_publishes_stop_even_after_cleanup(self):
        job = self.root / "job"
        fake = self.root / "fake-claude"
        fake.write_text("#!" + sys.executable + "\nimport time; time.sleep(30)\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        self.prepare_job(job)
        with patch.object(guard, "register_cli_group", side_effect=guard.GuardError("injected failure")):
            with self.assertRaisesRegex(guard.GuardError, "injected failure"):
                guard.invoke(job, self.valid_cli_args())
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_registration_failure")
        self.assertEqual(list((job / "active-cli").glob("*.json")), [])

    def test_invoke_broken_stdout_publishes_stop_and_cleans_cli(self):
        job = self.root / "job"; self.prepare_job(job)

        class BrokenBuffer:
            def write(self, _data):
                raise BrokenPipeError("simulated closed parent pipe")

            def flush(self):
                return None

        class BrokenStdout:
            buffer = BrokenBuffer()

        with patch.object(guard.sys, "stdout", BrokenStdout()):
            with self.assertRaisesRegex(guard.GuardError, "diagnostic I/O failed"):
                guard.invoke(job, self.valid_cli_args())
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "cli_io_failure")

    def test_stop_sentinel_creation_is_idempotent_under_race(self):
        job = self.root / "job"; self.prepare_job(job)
        self.assertEqual(guard.write_stop(job, "quota", "test"), "quota")
        self.assertEqual(guard.write_stop(job, "429", "other-test"), "quota")
        saved = json.loads((job / "stop.json").read_text())
        self.assertEqual(saved["reason"], "quota")
        self.assertEqual(saved["source"], "test")
        self.assertEqual((job / "stop.json").stat().st_nlink, 1)
        self.assertEqual(list(job.glob(".stop-*")), [])

    def test_cli_cleanup_falls_back_to_exact_registered_group_when_lock_is_unavailable(self):
        job = self.root / "job"; self.prepare_job(job)
        stopped = self.root / "lock-fallback-child-stopped"
        child_code = (
            "import pathlib,signal,sys,time; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.touch(),sys.exit(0))); time.sleep(30)"
        )
        child = subprocess.Popen([sys.executable, "-c", child_code, str(stopped)], start_new_session=True)
        registry = job / "active-cli"
        record = registry / "fallback.json"
        record.write_text(json.dumps({"job_id": self.plan["job_id"], "phase": "registered",
                                      "pid": child.pid, "pgid": child.pid,
                                      "process_start": guard._process_start_token(child.pid)}) + "\n")
        with patch.object(guard, "control_lock", side_effect=guard.GuardError("lock unavailable")):
            with self.assertRaisesRegex(guard.GuardError, "control lock unavailable"):
                guard.terminate_active_cli_groups(job)
        child.wait(timeout=5)
        self.assertTrue(stopped.exists(), "registered CLI group survived lock-free emergency cleanup")
        self.assertTrue(record.exists(), "fallback must retain the ownership record for audit")
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "cli_cleanup_lock_unavailable")

    def test_lock_free_cleanup_never_kills_mismatched_or_starting_records(self):
        for name, fields in (
                ("wrong-job.json", {"job_id": "other", "phase": "registered", "pid": 90001, "pgid": 90001}),
                ("starting.json", {"job_id": "fixture-job-1", "phase": "starting", "pid": None, "pgid": None})):
            with self.subTest(name=name):
                job = self.root / name.removesuffix(".json"); self.prepare_job(job)
                record = job / "active-cli" / name
                record.write_text(json.dumps(fields) + "\n")
                with patch.object(guard, "control_lock", side_effect=guard.GuardError("lock unavailable")), \
                        patch.object(guard, "_terminate_group") as terminate:
                    with self.assertRaisesRegex(guard.GuardError, "cleanup incomplete"):
                        guard.terminate_active_cli_groups(job)
                terminate.assert_not_called()
                self.assertTrue(record.exists())
                self.assertTrue((job / "stop.json").exists())

    def test_lock_free_cleanup_refuses_reused_process_group_pid(self):
        job = self.root / "job"; self.prepare_job(job)
        stopped = self.root / "reused-pid-child-stopped"
        child_code = (
            "import pathlib,signal,sys,time; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.touch(),sys.exit(0))); time.sleep(30)"
        )
        child = subprocess.Popen([sys.executable, "-c", child_code, str(stopped)], start_new_session=True)
        record = job / "active-cli" / "reused.json"
        record.write_text(json.dumps({"job_id": self.plan["job_id"], "phase": "registered",
                                      "pid": child.pid, "pgid": child.pid,
                                      "process_start": "Mon Jan 1 00:00:00 2001"}) + "\n")
        try:
            with patch.object(guard, "control_lock", side_effect=guard.GuardError("lock unavailable")):
                with self.assertRaisesRegex(guard.GuardError, "process-group leader PID was reused"):
                    guard.terminate_active_cli_groups(job)
            self.assertIsNone(child.poll(), "unrelated reused-PID group was signaled")
            self.assertFalse(stopped.exists())
            self.assertTrue(record.exists(), "unverified process identity must remain for audit")
        finally:
            if child.poll() is None:
                child.terminate(); child.wait(timeout=3)

    def test_lock_free_cleanup_persists_stop_then_resnapshots_late_registration(self):
        job = self.root / "late-registration"; self.prepare_job(job)
        stopped = self.root / "late-registration-stopped"
        child_code = (
            "import pathlib,signal,sys,time; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.touch(),sys.exit(0))); time.sleep(30)"
        )
        child = subprocess.Popen([sys.executable, "-c", child_code, str(stopped)], start_new_session=True)
        record = job / "active-cli" / "late.json"
        record.write_text(json.dumps({"job_id": self.plan["job_id"], "phase": "starting",
                                      "pid": None, "pgid": None}) + "\n")
        real_lock = guard.control_lock
        attempts = {"n": 0}

        def fail_once_then_register(job_dir):
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise guard.GuardError("injected first lock failure")
            from contextlib import contextmanager
            @contextmanager
            def registration_window():
                record.write_text(json.dumps({"job_id": self.plan["job_id"], "phase": "registered",
                                              "pid": child.pid, "pgid": child.pid,
                                              "process_start": guard._process_start_token(child.pid)}) + "\n")
                yield
            return registration_window()

        try:
            with patch.object(guard, "control_lock", side_effect=fail_once_then_register):
                with self.assertRaisesRegex(guard.GuardError, "cleanup incomplete"):
                    guard.terminate_active_cli_groups(job)
            child.wait(timeout=5)
            self.assertTrue(stopped.exists(), "late registered CLI group was not stopped after STOP")
            self.assertTrue((job / "stop.json").exists())
            self.assertEqual(attempts["n"], 2, "fallback did not perform a post-STOP lock reacquisition")
        finally:
            if child.poll() is None:
                child.kill(); child.wait(timeout=2)

    def test_cleanup_persists_stop_when_lock_api_raises_oserror(self):
        job = self.root / "job"; self.prepare_job(job)
        with patch.object(guard, "control_lock", side_effect=OSError("simulated ENOLCK")):
            with self.assertRaisesRegex(guard.GuardError, "control lock unavailable"):
                guard.terminate_active_cli_groups(job)
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "cli_cleanup_lock_unavailable")

    def test_cleanup_persists_stop_when_locked_registry_read_fails(self):
        job = self.root / "job"; self.prepare_job(job)
        real_validate = guard._validate_cli_registry
        with patch.object(guard, "_validate_cli_registry",
                          side_effect=guard.GuardError("simulated registry read failure")):
            with self.assertRaisesRegex(guard.GuardError, "registry cannot be read safely"):
                guard.terminate_active_cli_groups(job)
        self.assertTrue((job / "stop.json").exists())
        self.assertEqual(real_validate(job), job / "active-cli")

    def test_invoke_refuses_new_cli_after_lock_free_stop(self):
        job = self.root / "job"; self.prepare_job(job)
        guard.write_stop(job, "prior_cleanup_failure", "test")
        with patch.object(guard.subprocess, "Popen") as popen:
            with self.assertRaisesRegex(guard.GuardError, "job is stopped"):
                guard.invoke(job, self.valid_cli_args())
        popen.assert_not_called()

    def test_invoke_restores_signal_handlers_and_stops_on_control_lock_failure(self):
        job = self.root / "job"; self.prepare_job(job)
        signals = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
        before = {item: signal.getsignal(item) for item in signals}
        real_lock = guard.control_lock
        calls = {"n": 0}

        def fail_after_reservation(job_dir):
            calls["n"] += 1
            if calls["n"] == 2:
                raise guard.GuardError("injected launch lock timeout")
            return real_lock(job_dir)

        try:
            with patch.object(guard, "control_lock", side_effect=fail_after_reservation), \
                    patch.object(guard.subprocess, "Popen") as popen:
                with self.assertRaisesRegex(guard.GuardError, "injected launch lock timeout"):
                    guard.invoke(job, self.valid_cli_args())
                popen.assert_not_called()
            self.assertEqual({item: signal.getsignal(item) for item in signals}, before)
            self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                             "cli_control_failure")
        finally:
            for item, handler in before.items():
                signal.signal(item, handler)

    def test_supervise_restores_signal_handlers_when_launch_lock_fails(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "world.py"; world.write_text("pass\n")
        signals = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
        before = {item: signal.getsignal(item) for item in signals}
        try:
            with patch.object(guard, "control_lock", side_effect=guard.GuardError("launch lock unavailable")), \
                    patch.object(guard.subprocess, "Popen") as popen:
                with self.assertRaisesRegex(guard.GuardError, "launch lock unavailable"):
                    guard.supervise(job, [sys.executable, str(world)])
                popen.assert_not_called()
            self.assertEqual({item: signal.getsignal(item) for item in signals}, before)
        finally:
            for item, handler in before.items():
                signal.signal(item, handler)

    def test_supervise_normalizes_non_oserror_world_launch_failure(self):
        job = self.root / "job"; self.prepare_job(job)
        with self.assertRaisesRegex(guard.GuardError, "cannot start supervised world"):
            guard.supervise(job, [sys.executable, "invalid\x00argument"])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"],
                         "world_launch_failure")

    def test_missing_or_symlink_cli_registry_is_a_stale_stop_reason(self):
        job = self.root / "job"; self.prepare_job(job)
        registry = job / "active-cli"
        registry.rename(job / "active-cli-saved")
        self.assertEqual(guard._stale_cli_owner_reason(job), "cli_registry_invalid")
        registry.symlink_to(job / "active-cli-saved", target_is_directory=True)
        self.assertEqual(guard._stale_cli_owner_reason(job), "cli_registry_invalid")

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_defers_numeric_marker_until_final_eof(self):
        work = self.root / "work"; work.mkdir()
        nested = work / "runs" / "fixture"; nested.mkdir(parents=True)
        candidate = nested / "candidate.log"
        candidate.write_text("HTTP 429")
        offsets, tails, cursor = {}, {}, {"index": 0}
        self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor), (None, False))
        self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor, final=True), ("429", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_flushes_idle_numeric_marker(self):
        work = self.root / "work"; work.mkdir()
        candidate = work / "candidate.log"; candidate.write_text('"status":429')
        offsets, tails, cursor = {}, {}, {"index": 0}
        deferred = {candidate: (("429", '"status":429'), 0.0)}
        with patch.object(guard.time, "monotonic", return_value=2.0):
            self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor,
                                                   deferred_since=deferred), ("429", False))

    def test_cli_idle_numeric_marker_publishes_stop(self):
        job = self.root / "job"
        fake = self.root / "fake-claude"
        fake.write_text("#!" + sys.executable + "\nimport os,time; os.write(1,b'API Error: 429'); time.sleep(30)\n")
        fake.chmod(0o755)
        self.plan["cli"] = {"path": str(fake), "sha256": guard.sha256_file(fake)}
        self.plan_path.write_text(json.dumps(self.plan))
        self.prepare_job(job)
        self.assertEqual(guard.invoke(job, self.valid_cli_args()), 78)
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "429")

    def test_world_idle_numeric_marker_stops_owned_group(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "idle-numeric-world.py"
        world.write_text("import os,time; os.write(1,b'API Error: 429'); time.sleep(30)\n")
        with self.assertRaisesRegex(guard.GuardError, "stopped on 429"):
            guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "429")

    def test_numeric_marker_idle_deadline_is_bounded(self):
        self.assertIsNone(guard._numeric_idle_expired("API Error: 429", 4.0, now=4.5))
        self.assertEqual(guard._numeric_idle_expired("API Error: 429", 4.0, now=5.0), "429")
        self.assertIsNone(guard._numeric_idle_expired("API Error: 4291", 4.0, now=9.0))
        self.assertNotEqual(guard._numeric_marker_signature('"status":429'),
                            guard._numeric_marker_signature('"status":529'))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_positive_control_detects_nested_marker(self):
        work = self.root / "work"
        nested = work / "runs" / "fixture"
        nested.mkdir(parents=True)
        (nested / "candidate.log").write_text("ordinary prelude\nHTTP 429\n")
        reason, pending = guard._scan_work_logs(work, {}, {}, {"index": 0})
        self.assertEqual((reason, pending), ("429", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_rotates_past_large_early_file(self):
        work = self.root / "work"
        work.mkdir()
        (work / "a-large.log").write_bytes(b"x" * 32)
        (work / "z-stop.log").write_text("HTTP 429\n")
        offsets, tails, cursor = {}, {}, {"index": 0}
        with patch.object(guard, "MAX_LOG_READ_PER_POLL", 16), patch.object(guard, "LOG_CHUNK_BYTES", 16):
            reason, pending = guard._scan_work_logs(work, offsets, tails, cursor)
            self.assertIsNone(reason)
            self.assertTrue(pending)
            self.assertEqual(cursor["index"], 1)
            reason, pending = guard._scan_work_logs(work, offsets, tails, cursor)
        self.assertEqual(reason, "429")
        self.assertFalse(pending)

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_ignores_symlinked_files(self):
        work = self.root / "work"
        work.mkdir()
        outside = self.root / "outside.log"
        outside.write_text("quota exceeded\n")
        (work / "linked.log").symlink_to(outside)
        outside_dir = self.root / "outside-dir"
        outside_dir.mkdir()
        (outside_dir / "external.log").write_text("HTTP 429\n")
        (work / "linked-dir").symlink_to(outside_dir, target_is_directory=True)
        offsets, tails, cursor = {}, {}, {"index": 0}
        self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor),
                         ("log_scan_unsafe_path", False))
        self.assertEqual(offsets, {})

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_rejects_non_log_symlinks(self):
        work = self.root / "work"
        work.mkdir()
        outside = self.root / "outside.bin"
        outside.write_text("quota exceeded\n")
        (work / "unrelated-link.bin").symlink_to(outside)
        offsets, tails, cursor = {}, {}, {"index": 0}
        self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor),
                         ("log_scan_unsafe_path", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_rejects_extensionless_regular_output(self):
        work = self.root / "work"
        work.mkdir()
        (work / "session-output").write_text("HTTP 429\\n")
        self.assertEqual(guard._scan_work_logs(work, {}, {}, {"index": 0}),
                         ("log_scan_unclassified_output", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_rejects_unclassified_regular_output(self):
        work = self.root / "work"
        work.mkdir()
        (work / "session.ndjson").write_text('{"error":"HTTP 429"}\\n')
        self.assertEqual(guard._scan_work_logs(work, {}, {}, {"index": 0}),
                         ("log_scan_unclassified_output", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_rejects_extensionless_directory_symlink(self):
        work = self.root / "work"
        work.mkdir()
        outside = self.root / "outside-dir"
        outside.mkdir()
        (outside / "candidate.log").write_text("HTTP 429\n")
        (work / "output").symlink_to(outside, target_is_directory=True)
        self.assertEqual(guard._scan_work_logs(work, {}, {}, {"index": 0}),
                         ("log_scan_unsafe_path", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_candidate_coverage_requires_direct_child_path(self):
        work = self.root / "work"; work.mkdir()
        nested = work / "nested"; nested.mkdir()
        (nested / "cand.llm.jsonl").write_text('{"usage":{}}\n')
        cursor = {"index": 0}
        self.assertEqual(guard._scan_work_logs(work, {}, {}, cursor, final=True), (None, False))
        self.assertEqual(cursor["nonempty_candidate_log_count"], 0)

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_rejects_hardlinked_candidate(self):
        work = self.root / "work"; work.mkdir()
        source = work / "source.log"
        source.write_text("fixture\n")
        os.link(source, work / "cand.llm.jsonl")
        self.assertEqual(guard._scan_work_logs(work, {}, {}, {"index": 0}, final=True),
                         ("log_scan_unsafe_path", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_prunes_caches_for_removed_entries(self):
        work = self.root / "work"
        work.mkdir()
        stale = work / "removed.log"
        current = work / "current.log"
        current.write_text("tail")
        info = current.stat()
        offsets = {stale: (1, 2, 3), current: (info.st_dev, info.st_ino, info.st_size)}
        tails = {stale: "old", current: "HTTP 429"}
        active_deferred = (guard._numeric_marker_signature("HTTP 429"), 100.0)
        deferred = {stale: (("old",), 100.0), current: active_deferred}
        cursor = {"index": 0}
        with patch.object(guard.time, "monotonic", return_value=100.5):
            result = guard._scan_work_logs(work, offsets, tails, cursor, deferred_since=deferred)
        self.assertEqual(result, (None, False))
        self.assertNotIn(stale, offsets)
        self.assertNotIn(stale, tails)
        self.assertNotIn(stale, deferred)
        self.assertEqual(offsets[current], (info.st_dev, info.st_ino, info.st_size,
                                           guard._file_incarnation(info)))
        self.assertEqual(tails[current], "HTTP 429")
        self.assertEqual(deferred[current], active_deferred)

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_skips_entry_removed_before_stat(self):
        work = self.root / "work"
        work.mkdir()
        (work / "vanish.log").write_text("quota exceeded\n")
        offsets = {work / "vanish.log": (1, 2, 3)}
        tails = {work / "vanish.log": "cached tail"}
        deferred = {work / "vanish.log": (("HTTP 429",), 10.0)}
        cursor = {"index": 0}
        real_stat = os.stat

        def remove_before_stat(path, *args, **kwargs):
            if path == "vanish.log" and kwargs.get("dir_fd") is not None:
                raise FileNotFoundError(path)
            return real_stat(path, *args, **kwargs)

        with patch.object(guard.os, "stat", side_effect=remove_before_stat):
            result = guard._scan_work_logs(work, offsets, tails, cursor, final=True,
                                           deferred_since=deferred)
        self.assertEqual(result, (None, True))
        self.assertEqual(offsets, {})
        self.assertEqual(tails, {})
        self.assertEqual(deferred, {})

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_detects_reused_inode_creation_identity(self):
        work = self.root / "work"; work.mkdir()
        path = work / "candidate.log"
        path.write_text("HTTP 429\n")
        info = path.stat()
        offsets = {path: (info.st_dev, info.st_ino, info.st_size, ("birth", -1))}
        tails = {path: "ordinary\n"}
        deferred = {path: (("ordinary",), 1.0)}
        cursor = {"index": 0}
        real_stat = os.stat
        real_open = guard._open_regular_file

        def same_inode_new_birth(path_arg, *args, **kwargs):
            value = real_stat(path_arg, *args, **kwargs)
            if path_arg == "candidate.log" and kwargs.get("dir_fd") is not None:
                attrs = ("st_mode", "st_ino", "st_dev", "st_nlink", "st_size", "st_ctime",
                         "st_ctime_ns", "st_mtime", "st_mtime_ns")
                values = {name: getattr(value, name) for name in attrs}
                values["st_birthtime"] = 123456.0
                values["st_birthtime_ns"] = None
                return type("StatWithBirthtime", (), values)()
            return value

        def opened_with_new_birth(path_arg, *args, **kwargs):
            fd, value = real_open(path_arg, *args, **kwargs)
            if path_arg == "candidate.log" and kwargs.get("dir_fd") is not None:
                attrs = ("st_mode", "st_ino", "st_dev", "st_nlink", "st_size", "st_ctime",
                         "st_ctime_ns", "st_mtime", "st_mtime_ns")
                values = {name: getattr(value, name) for name in attrs}
                values["st_birthtime"] = 123456.0
                values["st_birthtime_ns"] = None
                return fd, type("OpenedStatWithReusedInode", (), values)()
            return fd, value

        with patch.object(guard.os, "stat", side_effect=same_inode_new_birth), \
                patch.object(guard, "_open_regular_file", side_effect=opened_with_new_birth):
            result = guard._scan_work_logs(work, offsets, tails, cursor, final=True,
                                           deferred_since=deferred)
        self.assertEqual(result, ("429", False))
        self.assertEqual(offsets[path][2], info.st_size)
        self.assertEqual(offsets[path][3], ("birth", 123456.0))

    def test_log_scan_fails_closed_without_birthtime_identity(self):
        work = self.root / "work"; work.mkdir()
        (work / "candidate.log").write_text("fixture\n")
        real_stat = os.stat

        def no_birthtime(path_arg, *args, **kwargs):
            value = real_stat(path_arg, *args, **kwargs)
            if path_arg == "candidate.log" and kwargs.get("dir_fd") is not None:
                attrs = ("st_mode", "st_ino", "st_dev", "st_nlink", "st_size", "st_ctime",
                         "st_ctime_ns", "st_mtime", "st_mtime_ns")
                values = {name: getattr(value, name) for name in attrs}
                return type("StatWithoutBirthtime", (), values)()
            return value

        with patch.object(guard.os, "stat", side_effect=no_birthtime):
            result = guard._scan_work_logs(work, {}, {}, {"index": 0})
        self.assertEqual(result, ("log_scan_unavailable", False))

    @unittest.skipIf(
        hasattr(os.stat(__file__), "st_birthtime"),
        "integration case requires native host stat without birth-time support",
    )
    def test_supervisor_fails_closed_without_birthtime_and_stops_owned_world(self):
        job = self.root / "job"; self.prepare_job(job)
        ready = self.root / "no-birthtime-child-ready"
        child_stopped = self.root / "no-birthtime-child-stopped"
        child_code = (
            "import pathlib,signal,sys,time; ready=pathlib.Path(sys.argv[1]); "
            "stopped=pathlib.Path(sys.argv[2]); "
            "signal.signal(signal.SIGTERM,lambda *_:(stopped.touch(),sys.exit(0))); "
            "ready.touch(); time.sleep(30)"
        )
        world = self.root / "no-birthtime-world.py"
        world.write_text(
            "import os,pathlib,subprocess,sys,time\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + ","
            + repr(str(ready)) + "," + repr(str(child_stopped)) + "])\n"
            "ready=pathlib.Path(" + repr(str(ready)) + ")\n"
            "deadline=time.time()+3\n"
            "while time.time()<deadline and not ready.exists(): time.sleep(.01)\n"
            "pathlib.Path(os.environ['ERIS_RUN_DIR'],'candidate.log').write_text('ordinary fixture\\n')\n"
            "time.sleep(30)\n"
        )
        with self.assertRaisesRegex(
                guard.GuardError, "owned world process group stopped by diagnostic sentinel"):
            guard.supervise(job, [sys.executable, str(world)])
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "log_scan_unavailable")
        self.assertEqual(stop["source"], "run_log")
        deadline = time.time() + 2
        while time.time() < deadline and not child_stopped.exists(): time.sleep(.05)
        self.assertTrue(child_stopped.exists(), "owned world child survived unsupported-scanner STOP")

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_rechecks_incarnation_after_open(self):
        work = self.root / "work"; work.mkdir()
        path = work / "candidate.log"
        path.write_text("HTTP 429\n")
        info = path.stat()
        offsets = {path: (info.st_dev, info.st_ino, info.st_size, guard._file_incarnation(info))}
        tails = {path: "ordinary\n"}
        deferred = {path: (("ordinary",), 1.0)}
        real_open = guard._open_regular_file
        changed = {"done": False}

        def changed_incarnation_at_open(open_path, *args, **kwargs):
            fd, current = real_open(open_path, *args, **kwargs)
            if open_path == "candidate.log" and kwargs.get("dir_fd") is not None and not changed["done"]:
                changed["done"] = True
                attrs = ("st_mode", "st_ino", "st_dev", "st_nlink", "st_size", "st_ctime",
                         "st_ctime_ns", "st_mtime", "st_mtime_ns")
                values = {name: getattr(current, name) for name in attrs}
                values["st_birthtime"] = 123456.0
                values["st_birthtime_ns"] = None
                return fd, type("OpenedStatWithNewBirthtime", (), values)()
            return fd, current

        with patch.object(guard, "_open_regular_file", side_effect=changed_incarnation_at_open):
            first = guard._scan_work_logs(work, offsets, tails, {"index": 0}, final=True,
                                          deferred_since=deferred)
            second = guard._scan_work_logs(work, offsets, tails, {"index": 0}, final=True,
                                           deferred_since=deferred)
        self.assertTrue(changed["done"])
        self.assertEqual(first, (None, True))
        self.assertEqual(second, ("429", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_rechecks_link_count_after_open(self):
        work = self.root / "work"; work.mkdir()
        path = work / "candidate.log"
        path.write_text("fixture\n")
        real_open = guard._open_regular_file
        linked = {"done": False}

        def add_link_after_enumeration(open_path, *args, **kwargs):
            if open_path == "candidate.log" and kwargs.get("dir_fd") is not None and not linked["done"]:
                linked["done"] = True
                os.link(path, work / "alias.log")
            return real_open(open_path, *args, **kwargs)

        with patch.object(guard, "_open_regular_file", side_effect=add_link_after_enumeration):
            first = guard._scan_work_logs(work, {}, {}, {"index": 0}, final=True)
            second = guard._scan_work_logs(work, {}, {}, {"index": 0}, final=True)
        self.assertTrue(linked["done"])
        self.assertEqual(first, (None, True))
        self.assertEqual(second, ("log_scan_unsafe_path", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_retries_file_removed_after_enumeration(self):
        work = self.root / "work"; work.mkdir()
        vanished = work / "vanish.log"
        vanished.write_text("ordinary\n")
        offsets, tails, deferred = ({vanished: (1, 2, 4)}, {vanished: "tail"},
                                     {vanished: time.monotonic()})
        real_open_regular = guard._open_regular_file

        def remove_before_open(path, *args, **kwargs):
            if path == "vanish.log" and kwargs.get("dir_fd") is not None:
                raise FileNotFoundError(path)
            return real_open_regular(path, *args, **kwargs)

        with patch.object(guard, "_open_regular_file", side_effect=remove_before_open):
            result = guard._scan_work_logs(work, offsets, tails, {"index": 0},
                                           deferred_since=deferred)
        self.assertEqual(result, (None, False))
        self.assertNotIn(vanished, offsets)
        self.assertNotIn(vanished, tails)
        self.assertNotIn(vanished, deferred)

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_final_race_retries_before_reporting_marker(self):
        work = self.root / "work"; work.mkdir()
        candidate = work / "cand.llm.jsonl"
        candidate.write_text("HTTP 429\n")
        offsets, tails, cursor = {}, {}, {"index": 0}
        real_open_regular = guard._open_regular_file
        races = {"left": 1}

        def disappear_once(path, *args, **kwargs):
            if path == "cand.llm.jsonl" and kwargs.get("dir_fd") is not None and races["left"]:
                races["left"] -= 1
                raise FileNotFoundError(path)
            return real_open_regular(path, *args, **kwargs)

        with patch.object(guard, "_open_regular_file", side_effect=disappear_once):
            first = guard._scan_work_logs(work, offsets, tails, cursor, final=True)
            second = guard._scan_work_logs(work, offsets, tails, cursor, final=True)
        self.assertEqual(first, (None, True))
        self.assertEqual(second, ("429", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_final_budget_keeps_unvisited_cached_tail_pending(self):
        work = self.root / "work"; work.mkdir()
        first = work / "a.log"
        deferred = work / "z.log"
        first.write_bytes(b"abcd")
        deferred.write_bytes(b"")
        offsets = {first: (first.stat().st_dev, first.stat().st_ino, 0),
                   deferred: (deferred.stat().st_dev, deferred.stat().st_ino, 0)}
        tails = {deferred: "HTTP 429"}
        cursor = {"index": 0}
        with patch.object(guard, "MAX_LOG_READ_PER_POLL", 4), \
                patch.object(guard, "LOG_CHUNK_BYTES", 4):
            first_scan = guard._scan_work_logs(work, offsets, tails, cursor, final=True)
            second_scan = guard._scan_work_logs(work, offsets, tails, cursor, final=True)
        self.assertEqual(first_scan, (None, True))
        self.assertEqual(second_scan, ("429", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_final_stat_race_retries_before_empty_tree_completion(self):
        work = self.root / "work"; work.mkdir()
        candidate = work / "cand.llm.jsonl"
        candidate.write_text("HTTP 429\n")
        offsets, tails, cursor = {}, {}, {"index": 0}
        real_stat = os.stat
        races = {"left": 1}

        def disappear_once(path, *args, **kwargs):
            if path == "cand.llm.jsonl" and kwargs.get("dir_fd") is not None and races["left"]:
                races["left"] -= 1
                raise FileNotFoundError(path)
            return real_stat(path, *args, **kwargs)

        with patch.object(guard.os, "stat", side_effect=disappear_once):
            first = guard._scan_work_logs(work, offsets, tails, cursor, final=True)
            second = guard._scan_work_logs(work, offsets, tails, cursor, final=True)
        self.assertEqual(first, (None, True))
        self.assertEqual(second, ("429", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_final_race_stops_after_bounded_retries(self):
        work = self.root / "work"; work.mkdir()
        (work / "unstable.log").write_text("ordinary\n")
        offsets, tails, cursor = {}, {}, {"index": 0}
        real_open_regular = guard._open_regular_file

        def always_disappear(path, *args, **kwargs):
            if path == "unstable.log" and kwargs.get("dir_fd") is not None:
                raise FileNotFoundError(path)
            return real_open_regular(path, *args, **kwargs)

        with patch.object(guard, "_open_regular_file", side_effect=always_disappear):
            results = [guard._scan_work_logs(work, offsets, tails, cursor, final=True)
                       for _ in range(guard.MAX_FINAL_SCAN_ATTEMPTS)]
        self.assertEqual(results, [(None, True), (None, True), ("log_scan_unstable_tree", False)])

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_final_stat_race_stops_after_bounded_attempts_when_tree_is_empty(self):
        work = self.root / "work"; work.mkdir()
        (work / "vanish.log").write_text("ordinary\n")
        real_stat = os.stat

        def always_disappear(path, *args, **kwargs):
            if path == "vanish.log" and kwargs.get("dir_fd") is not None:
                raise FileNotFoundError(path)
            return real_stat(path, *args, **kwargs)

        cursor = {"index": 0}
        with patch.object(guard.os, "stat", side_effect=always_disappear):
            results = [guard._scan_work_logs(work, {}, {}, cursor, final=True)
                       for _ in range(guard.MAX_FINAL_SCAN_ATTEMPTS)]
        self.assertEqual(results, [(None, True), (None, True), ("log_scan_unstable_tree", False)])

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_final_race_budget_counts_interleaved_clean_polls(self):
        work = self.root / "work"; work.mkdir()
        (work / "unstable.log").write_bytes(b"x" * 10)
        real_open = guard._open_regular_file
        calls = {"count": 0}

        def disappear_every_other_open(*args, **kwargs):
            calls["count"] += 1
            if calls["count"] % 2:
                raise FileNotFoundError("intermittent disappearance")
            return real_open(*args, **kwargs)

        cursor = {"index": 0}
        with patch.object(guard, "MAX_LOG_READ_PER_POLL", 1), \
                patch.object(guard, "LOG_CHUNK_BYTES", 1), \
                patch.object(guard, "_open_regular_file", side_effect=disappear_every_other_open):
            results = [guard._scan_work_logs(work, {}, {}, cursor, final=True)
                       for _ in range(5)]
        self.assertEqual(results, [(None, True), (None, True), (None, True),
                                   (None, True), ("log_scan_unstable_tree", False)])

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_nonfinal_empty_tree_does_not_reset_final_limits(self):
        work = self.root / "work"; work.mkdir()
        log = work / "growing.log"
        log.write_bytes(b"x" * 10)
        cursor = {"index": 0}
        with patch.object(guard, "MAX_LOG_READ_PER_POLL", 1), \
                patch.object(guard, "LOG_CHUNK_BYTES", 1), \
                patch.object(guard, "MAX_FINAL_SCAN_POLLS", 1):
            self.assertEqual(guard._scan_work_logs(work, {}, {}, cursor, final=True), (None, True))
            log.unlink()
            self.assertEqual(guard._scan_work_logs(work, {}, {}, cursor, final=False), (None, False))
            log.write_bytes(b"x" * 10)
            self.assertEqual(guard._scan_work_logs(work, {}, {}, cursor, final=True),
                             ("log_scan_unstable_tree", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_nonfinal_empty_tree_does_not_reset_observed_races(self):
        work = self.root / "work"; work.mkdir()
        log = work / "candidate.log"
        log.write_bytes(b"HTTP 429\n")

        def disappear(*args, **kwargs):
            raise FileNotFoundError("fixture race")

        cursor = {"index": 0}
        with patch.object(guard, "_open_regular_file", side_effect=disappear):
            self.assertEqual(guard._scan_work_logs(work, {}, {}, cursor, final=True), (None, True))
        log.unlink()
        self.assertEqual(guard._scan_work_logs(work, {}, {}, cursor, final=False), (None, False))
        log.write_bytes(b"HTTP 429\n")
        with patch.object(guard, "_open_regular_file", side_effect=disappear):
            second = guard._scan_work_logs(work, {}, {}, cursor, final=True)
            third = guard._scan_work_logs(work, {}, {}, cursor, final=True)
        self.assertEqual(second, (None, True))
        self.assertEqual(third, ("log_scan_unstable_tree", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_directory_disappearance_during_read_fails_closed(self):
        work = self.root / "work"; work.mkdir()
        nested = work / "nested"; nested.mkdir()
        (nested / "candidate.log").write_text("HTTP 429\n")
        real_open = os.open
        calls = {"nested": 0}

        def disappear_on_second_directory_open(path, flags, *args, **kwargs):
            if path == "nested" and kwargs.get("dir_fd") is not None:
                calls["nested"] += 1
                if calls["nested"] == 2:
                    raise FileNotFoundError(path)
            return real_open(path, flags, *args, **kwargs)

        with patch.object(guard.os, "open", side_effect=disappear_on_second_directory_open):
            result = guard._scan_work_logs(work, {}, {}, {"index": 0}, final=True)
        self.assertEqual(result, ("log_scan_unstable_tree", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_final_poll_count_is_bounded_while_more_bytes_arrive(self):
        work = self.root / "work"; work.mkdir()
        (work / "growing.log").write_bytes(b"x" * 100)
        cursor = {"index": 0}
        with patch.object(guard, "MAX_LOG_READ_PER_POLL", 1), \
                patch.object(guard, "LOG_CHUNK_BYTES", 1):
            results = [guard._scan_work_logs(work, {}, {}, cursor, final=True)
                       for _ in range(guard.MAX_FINAL_SCAN_POLLS + 1)]
        self.assertTrue(all(result == (None, True) for result in results[:-1]))
        self.assertEqual(results[-1], ("log_scan_unstable_tree", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_retries_regular_file_replaced_after_enumeration(self):
        work = self.root / "work"; work.mkdir()
        replaced = work / "replace.log"
        replaced.write_text("old content\n")
        offsets, tails, deferred = ({replaced: (1, 2, 4)}, {replaced: "tail"},
                                     {replaced: time.monotonic()})
        replacement = work / "replacement.log"
        replacement.write_text("HTTP 429\n")
        original_inode = replaced.stat().st_ino
        replacement_inode = replacement.stat().st_ino
        self.assertNotEqual(original_inode, replacement_inode)
        real_open = os.open
        changed = {"done": False}

        def replace_before_open(path, flags, *args, **kwargs):
            if path == "replace.log" and kwargs.get("dir_fd") is not None and not changed["done"]:
                changed["done"] = True
                os.replace(replacement, replaced)
            return real_open(path, flags, *args, **kwargs)

        with patch.object(guard.os, "open", side_effect=replace_before_open):
            result = guard._scan_work_logs(work, offsets, tails, {"index": 0},
                                           deferred_since=deferred)
        self.assertEqual(result, (None, False))
        self.assertTrue(changed["done"])
        self.assertNotIn(replaced, offsets)
        self.assertNotIn(replaced, tails)
        self.assertNotIn(replaced, deferred)
        self.assertEqual(guard._scan_work_logs(work, {}, {}, {"index": 0}, final=True),
                         ("429", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_skips_file_replaced_with_fifo_before_open(self):
        work = self.root / "work"
        work.mkdir()
        (work / "a.log").write_text("ordinary text\n")
        offsets, tails, cursor = {}, {}, {"index": 0}
        real_open = os.open
        replaced = {"done": False}

        def replace_before_open(path, flags, *args, **kwargs):
            if path == "a.log" and kwargs.get("dir_fd") is not None and not replaced["done"]:
                os.unlink(work / path)
                os.mkfifo(work / path)
                replaced["done"] = True
            return real_open(path, flags, *args, **kwargs)

        with patch.object(guard.os, "open", side_effect=replace_before_open):
            result = guard._scan_work_logs(work, offsets, tails, cursor)
        self.assertTrue(replaced["done"])
        self.assertEqual(result, ("log_scan_unstable_tree", False))
        self.assertEqual(offsets, {})

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_skips_directory_replaced_with_fifo_before_open(self):
        work = self.root / "work"
        work.mkdir()
        (work / "sub").mkdir()
        offsets, tails, cursor = {}, {}, {"index": 0}
        real_open = os.open
        replaced = {"done": False}

        def replace_before_open(path, flags, *args, **kwargs):
            if path == "sub" and kwargs.get("dir_fd") is not None and not replaced["done"]:
                (work / "sub").rmdir()
                os.mkfifo(work / "sub")
                replaced["done"] = True
            return real_open(path, flags, *args, **kwargs)

        with patch.object(guard.os, "open", side_effect=replace_before_open):
            result = guard._scan_work_logs(work, offsets, tails, cursor)
        self.assertTrue(replaced["done"])
        self.assertEqual(result, ("log_scan_unstable_tree", False))
        self.assertEqual(offsets, {})

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_fails_closed_when_subdirectory_cannot_be_scanned(self):
        work = self.root / "work"
        (work / "sub").mkdir(parents=True)
        (work / "sub" / "candidate.log").write_text("quota\n")
        real_scandir = os.scandir
        calls = {"count": 0}

        def fail_child_scan(path):
            calls["count"] += 1
            if calls["count"] == 2:
                raise PermissionError("injected permission failure")
            return real_scandir(path)

        with patch.object(guard.os, "scandir", side_effect=fail_child_scan):
            result = guard._scan_work_logs(work, {}, {}, {"index": 0})
        self.assertEqual(calls["count"], 2)
        self.assertEqual(result, ("log_scan_unavailable", False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_does_not_stop_when_numeric_marker_continues_across_file_chunk(self):
        work = self.root / "work"; work.mkdir()
        candidate = work / "candidate.log"
        candidate.write_bytes(b"x" * (guard.LOG_CHUNK_BYTES - len(b"HTTP 4")) + b"HTTP 4")
        offsets, tails, cursor = {}, {}, {"index": 0}
        self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor), (None, False))
        with candidate.open("ab") as stream:
            stream.write(b"29")
        self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor), (None, False))
        with candidate.open("ab") as stream:
            stream.write(b"1\\n")
        self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor), (None, False))

    @REQUIRES_STAT_BIRTHTIME
    def test_log_scan_counts_backlog_across_all_files_before_reading(self):
        work = self.root / "work"
        work.mkdir()
        (work / "a.log").write_bytes(b"x" * 6)
        (work / "b.log").write_bytes(b"y" * 6)
        offsets, tails, cursor = {}, {}, {"index": 0}
        with patch.object(guard, "MAX_LOG_BACKLOG", 10):
            self.assertEqual(guard._scan_work_logs(work, offsets, tails, cursor),
                             ("log_scan_overrun", False))
        self.assertEqual(offsets, {})

    def test_control_json_fifo_is_rejected_without_blocking(self):
        fifo = self.root / "control.json"
        os.mkfifo(fifo)
        guard_path = str(Path(guard.__file__).resolve())
        script = (
            "import sys; sys.path.insert(0, " + repr(str(Path(guard_path).parent)) + "); "
            "import stage2_guard; stage2_guard._read_json(sys.argv[1])"
        )
        result = subprocess.run([sys.executable, "-c", script, str(fifo)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"cannot read JSON input", result.stderr)

    def test_control_lock_rejects_fifo_without_blocking(self):
        job = self.root / "job"
        job.mkdir()
        os.mkfifo(job / "control.lock")
        with self.assertRaisesRegex(guard.GuardError, "cannot open job control lock"):
            with guard.control_lock(job):
                self.fail("FIFO control lock must not be accepted")

    def test_control_lock_contention_times_out(self):
        job = self.root / "job"
        job.mkdir()
        lock_path = job / "control.lock"
        lock_path.touch()
        fd = os.open(lock_path, os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(guard, "CONTROL_LOCK_WAIT_SECONDS", 0.02):
                with self.assertRaisesRegex(guard.GuardError, "job control lock acquisition timed out"):
                    with guard.control_lock(job):
                        self.fail("contended control lock must not be acquired")
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def test_start_ledger_fifo_is_rejected_without_blocking(self):
        job = self.root / "job"
        self.prepare_job(job)
        ledger = job / "starts.jsonl"
        ledger.unlink()
        os.mkfifo(ledger)
        with self.assertRaisesRegex(guard.GuardError, "non-regular file"):
            guard.reserve_start(job)

    def test_supervisor_stops_on_partial_stdout_without_waiting_for_newline(self):
        job = self.root / "job"; self.prepare_job(job)
        release = self.root / "release"
        world = self.root / "partial-stdout.py"
        world.write_text(
            "import pathlib,sys,time\n"
            "sys.stdout.write('ERROR quota exceeded'); sys.stdout.flush()\n"
            "p=pathlib.Path(" + repr(str(release)) + ")\n"
            "deadline=time.time()+4\n"
            "while time.time()<deadline and not p.exists(): time.sleep(.02)\n"
            "sys.stdout.write('\\n'); sys.stdout.flush()\n"
        )
        outcome = {}
        done = __import__("threading").Event()
        def run_world():
            try:
                guard.supervise(job, [sys.executable, str(world)])
            except Exception as exc:
                outcome["error"] = exc
            finally:
                done.set()
        thread = __import__("threading").Thread(target=run_world, daemon=True)
        started = time.monotonic(); thread.start()
        completed_before_release = done.wait(1.0)
        release.touch()
        thread.join(3)
        self.assertTrue(completed_before_release, "supervisor blocked waiting for a newline")
        self.assertLess(time.monotonic() - started, 3)
        self.assertIsInstance(outcome.get("error"), guard.GuardError)

    def test_supervisor_drains_world_stdout_after_process_exit(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "final-stdout.py"
        world.write_text("import sys\nsys.stdout.write('x' * 12000 + ' quota exceeded')\n")
        with self.assertRaisesRegex(guard.GuardError, "owned world process group stopped"):
            guard.supervise(job, [sys.executable, str(world)])
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "quota")

    def test_supervisor_scans_entire_chunk_before_trimming_tail(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "chunk-marker.py"
        world.write_text(
            "import sys,time\n"
            "sys.stdout.write('HTTP 429 ' + 'x' * 4090); sys.stdout.flush(); time.sleep(.3)\n"
        )
        with self.assertRaisesRegex(guard.GuardError, "owned world process group stopped"):
            guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "429")

    def test_supervisor_catches_signal_arriving_during_world_spawn(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "signal-window.py"
        world.write_text("import time\ntime.sleep(30)\n")
        real_popen = subprocess.Popen
        fired = {"once": False}

        def signal_before_world_spawn(*args, **kwargs):
            if not fired["once"]:
                fired["once"] = True
                os.kill(os.getpid(), signal.SIGTERM)
            return real_popen(*args, **kwargs)

        with patch.object(guard.subprocess, "Popen", side_effect=signal_before_world_spawn):
            with self.assertRaisesRegex(guard.GuardError, "supervisor stopped on SIGTERM"):
                guard.supervise(job, [sys.executable, str(world)])
        self.assertTrue(fired["once"])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "supervisor_sigterm")

    @REQUIRES_STAT_BIRTHTIME
    def test_supervisor_carries_stop_patterns_across_file_read_boundaries(self):
        job = self.root / "job"; self.prepare_job(job)
        terminated = self.root / "split-marker-child-terminated"
        child_code = (
            "import signal,time,pathlib,sys; p=pathlib.Path(sys.argv[1]); "
            "signal.signal(signal.SIGTERM,lambda *_:(p.write_text('term'),sys.exit(0))); time.sleep(30)"
        )
        world = self.root / "split-log.py"
        world.write_text(
            "import os,pathlib,subprocess,sys,time\n"
            "subprocess.Popen([sys.executable,'-c'," + repr(child_code) + "," + repr(str(terminated)) + "])\n"
            "p=pathlib.Path(os.environ['ERIS_RUN_DIR'])/'cand.llm.jsonl'\n"
            "p.write_text('HTTP 4'); time.sleep(.6)\n"
            "with p.open('a') as f: f.write('29\\n')\n"
            "time.sleep(30)\n"
        )
        with self.assertRaisesRegex(guard.GuardError, "owned world process group stopped"):
            guard.supervise(job, [sys.executable, str(world)])
        self.assertEqual(json.loads((job / "stop.json").read_text())["reason"], "429")
        deadline = time.time() + 2
        while time.time() < deadline and not terminated.exists(): time.sleep(.05)
        self.assertTrue(terminated.exists(), "split stop marker did not terminate owned process tree")

    @REQUIRES_STAT_BIRTHTIME
    def test_supervisor_fails_closed_on_log_backlog_over_limit(self):
        job = self.root / "job"; self.prepare_job(job)
        world = self.root / "log-backlog.py"
        world.write_text(
            "import pathlib,os,time\n"
            "p=pathlib.Path(os.environ['ERIS_RUN_DIR'])/'huge.log'\n"
            "p.write_bytes(b'x' * (" + str(guard.MAX_LOG_BACKLOG + 1) + "))\n"
            "time.sleep(30)\n"
        )
        with self.assertRaisesRegex(guard.GuardError, "owned world process group stopped"):
            guard.supervise(job, [sys.executable, str(world)])
        stop = json.loads((job / "stop.json").read_text())
        self.assertEqual(stop["reason"], "log_scan_overrun")

    def test_launch_requires_parent_review_of_exact_receipt_hash(self):
        job = self.root / "job"
        result = guard.prepare(self.plan_path, job)
        with self.assertRaisesRegex(guard.GuardError, "no parent review token"):
            guard.invoke(job, self.valid_cli_args())
        with self.assertRaisesRegex(guard.GuardError, "parent review must name"):
            guard.authorize_for_run(job, "0" * 64)
        with self.assertRaisesRegex(guard.GuardError, "no parent review token"):
            guard.reserve_start(job)
        guard.authorize_for_run(job, result["receipt_sha256"])
        self.assertTrue(guard.verify_review_token(job))

    def test_receipt_policy_tampering_cannot_be_authorized_by_rehashed_digest(self):
        job = self.root / "job"
        guard.prepare(self.plan_path, job)
        receipt_path = job / "receipt.json"
        receipt = json.loads(receipt_path.read_text())
        receipt["max_cli_starts"] = 600
        receipt_path.chmod(0o600)
        receipt_path.write_text(json.dumps(receipt))
        receipt_path.chmod(0o400)
        with self.assertRaisesRegex(guard.GuardError, "start cap"):
            guard.authorize_for_run(job, guard.sha256_file(receipt_path))
        self.assertFalse((job / "review-token.json").exists())

    def test_input_hash_change_after_prepare_refuses_run(self):
        job = self.root / "job"
        guard.prepare(self.plan_path, job)
        self.inputs.write_text('{"candidate":"changed"}\n')
        with self.assertRaisesRegex(guard.GuardError, "input hash changed"):
            guard.verify_receipt_inputs(job)


if __name__ == "__main__":
    unittest.main()
