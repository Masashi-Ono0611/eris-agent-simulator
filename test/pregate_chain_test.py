"""Fail-closed contracts for source-bound G3 Pregate dispatch."""
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("pregate_chain_tests", ROOT / "scripts/pregate-chain-tests.py")
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)
RUNNER_SPEC = importlib.util.spec_from_file_location("pregate_runner", ROOT / "scripts/pregate-runner.py")
runner = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(runner)


class ChainPregateContracts(unittest.TestCase):
    def test_only_exact_chain_test_paths_are_dispatchable(self):
        self.assertEqual(helper.CHAIN_TESTS, {
            "ascon-notes/league/g3/chain/test_chain.py",
            "ascon-notes/league/g3/chain/test_revision_audit.py",
        })

    def test_explicit_source_commit_requires_full_lowercase_hash(self):
        with self.assertRaisesRegex(helper.SetupError, "40-hex"):
            helper.validate_source({"G3_CHAIN_SOURCE": str(ROOT), "G3_CHAIN_SOURCE_COMMIT": "main"})
        with self.assertRaisesRegex(helper.SetupError, "40-hex"):
            helper.validate_source({"G3_CHAIN_SOURCE": str(ROOT), "G3_CHAIN_SOURCE_COMMIT": "A" * 40})

    def test_any_tracked_runtime_drift_rejects_the_candidate(self):
        dirty_runtime = subprocess.CompletedProcess(
            ["git", "status"], 0, " M runtime/sdk/core.ts\n", "",
        )
        with patch.object(helper.subprocess, "run", return_value=dirty_runtime) as status:
            with self.assertRaisesRegex(helper.SetupError, "tracked files"):
                helper.check_checkout_clean(ROOT, {})
        self.assertIn("--untracked-files=no", status.call_args.args[0])
        self.assertNotIn("--", status.call_args.args[0])

    def test_any_nonignored_untracked_file_rejects_the_candidate(self):
        clean = subprocess.CompletedProcess(["git", "status"], 0, "", "")
        untracked_runtime = subprocess.CompletedProcess(
            ["git", "status"], 0, "?? runtime/sdk/new-file.ts\n", "",
        )
        with patch.object(helper.subprocess, "run", side_effect=(clean, untracked_runtime)) as status:
            with self.assertRaisesRegex(helper.SetupError, "untracked files"):
                helper.check_checkout_clean(ROOT, {})
        self.assertEqual(status.call_count, 2)
        untracked_command = status.call_args_list[1].args[0]
        self.assertIn("--untracked-files=all", untracked_command)
        self.assertNotIn("--", untracked_command)

    def test_archive_paths_reject_escape_and_normalization(self):
        for name in ("../escape", "/absolute", "a/../b", "a/./b", "a//b", "a\\b"):
            with self.subTest(name=name), self.assertRaises(helper.SetupError):
                helper.safe_member_path(ROOT, name)

    def test_safe_directory_entries_are_process_local_and_preserve_existing_config(self):
        original = {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "safe.directory",
                    "GIT_CONFIG_VALUE_0": "/existing"}
        env = helper.git_environment((Path("/source"), Path("/copy")), base=original)
        self.assertEqual(env["GIT_CONFIG_COUNT"], "3")
        self.assertEqual(env["GIT_CONFIG_VALUE_0"], "/existing")
        self.assertEqual(env["GIT_CONFIG_VALUE_1"], "/source")
        self.assertEqual(env["GIT_CONFIG_VALUE_2"], "/copy")
        self.assertEqual(original["GIT_CONFIG_COUNT"], "1")

    def test_python_summary_must_execute_non_skipped_tests(self):
        self.assertEqual(helper.summarize_python("Ran 3 tests in 0.1s\nOK (skipped=1)\n"), 3)
        for output in ("OK\n", "Ran 0 tests in 0.1s\nOK\n",
                       "Ran 2 tests in 0.1s\nOK (skipped=2)\n"):
            with self.subTest(output=output), self.assertRaises(helper.SetupError):
                helper.summarize_python(output)

    def test_helper_aggregate_is_last_summary_seen_by_generic_parser(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source, gitdir, dependencies = (base / "source", base / "git", base / "node_modules")
            scratch_root, scratch = base / "scratch", base / "scratch/run"
            for path in (source, gitdir, dependencies, scratch_root, scratch):
                path.mkdir()
            commit = "a" * 40
            maker = subprocess.CompletedProcess(["make-view.py"], 0, "view ready\n", "")
            outputs = [
                (["python", "test-a.py"], 0, "Ran 95 tests in 1.0s\nOK\n", ""),
                (["python", "test-b.py"], 0, "", "Ran 41 tests in 1.0s\nOK\n"),
            ]
            with patch.dict(os.environ, {"G3_CHAIN_SOURCE": str(source),
                                         "G3_CHAIN_SOURCE_COMMIT": commit}), \
                 patch.object(helper, "validate_source", return_value=(source, commit, gitdir)), \
                 patch.object(helper, "validate_dependencies", return_value=dependencies), \
                 patch.object(helper, "validate_scratch", return_value=(scratch_root, scratch)), \
                 patch.object(helper, "archive_source", return_value=(10, 1234)), \
                 patch.object(helper.subprocess, "run", return_value=maker), \
                 patch.object(helper, "run_tests", return_value=(0, 136, outputs, 2.0)), \
                 contextlib.redirect_stdout(io.StringIO()) as stdout, \
                 contextlib.redirect_stderr(io.StringIO()) as stderr:
                self.assertEqual(helper.main(sorted(helper.CHAIN_TESTS)), 0)
            combined = stdout.getvalue() + "\n" + stderr.getvalue()
            self.assertEqual(runner.test_count(combined, "python"), 136)

    def test_pregate_mapping_selects_helper_contract(self):
        config = json.loads((ROOT / ".gstack/pregate.json").read_text())
        self.assertIn("test/pregate_chain_test.py", config["dependencies"]["scripts/pregate-chain-tests.py"])
        self.assertIn("test/pregate_chain_test.py", config["dependencies"]["scripts/pregate-runner.py"])
        self.assertIn("test/pregate_chain_test.py", config["dependencies"]["ascon-notes/pregate.md"])
        self.assertIn("test/pregate_chain_test.py", config["dependencies"])

    def test_runner_rejects_missing_scratch_without_dropping_regular_python_lane(self):
        result = subprocess.CompletedProcess(["python"], 0, "Ran 1 test in 0.01s\nOK\n", "")
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {}, clear=True), patch.object(runner, "run_command", return_value=result) as execute, \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = runner.run_groups({"node": [], "python": [
                "ascon-notes/league/g3/chain/test_chain.py", "test/plain_test.py",
            ]}, ROOT)
        self.assertEqual(status, 1)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(execute.call_args.args[0][-1], "test/plain_test.py")
        self.assertIn("ASCON_PREGATE_SCRATCH_ROOT missing", err.getvalue())

    def test_scratch_root_rejects_temporary_and_product_worktree_paths(self):
        with self.assertRaisesRegex(helper.SetupError, "temporary root"):
            helper.validate_scratch({
                "G3_CHAIN_SOURCE": str(ROOT), "ASCON_PREGATE_SCRATCH_ROOT": "/tmp",
            })
        with patch.dict(os.environ, {"ASCON_PREGATE_SCRATCH_ROOT": str(ROOT)}), \
             patch.object(runner.tempfile, "mkdtemp") as create:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                status = runner.run_groups({"node": [], "python": [
                    "ascon-notes/league/g3/chain/test_chain.py",
                ]}, ROOT)
        self.assertEqual(status, 1)
        create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
