"""Contracts: mixed selection is complete, unsupported/empty paths and zero-run fail."""
import importlib.util
import contextlib
import io
import os
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("pregate_runner", Path(__file__).resolve().parents[1] / "scripts/pregate-runner.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_timeout_defaults_and_bounded_override(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(runner.configured_timeout(), 300)
        with patch.dict(os.environ, {"PREGATE_TEST_TIMEOUT_SECONDS": "1800"}):
            self.assertEqual(runner.configured_timeout(), 1800)

    def test_timeout_override_reaches_each_selected_runner(self):
        result = subprocess.CompletedProcess(["python"], 0, "Ran 1 test in 0.01s\nOK\n", "")
        for timeout in (300, 1800):
            with self.subTest(timeout=timeout), tempfile.TemporaryDirectory() as directory:
                with patch.object(runner, "run_command", return_value=result) as execute:
                    self.assertEqual(runner.run_groups({"node": [], "python": ["test_lane.py"]},
                                                       Path(directory), timeout=timeout), 0)
                self.assertEqual(execute.call_args.kwargs["timeout"], timeout)

    def test_invalid_timeout_is_rejected_before_selection_or_jobs(self):
        for raw in ("0", "not-a-number", "1801"):
            with self.subTest(raw=raw), patch.dict(os.environ, {"PREGATE_TEST_TIMEOUT_SECONDS": raw}):
                error = io.StringIO()
                with patch.object(runner, "selected_files") as select, \
                     patch.object(runner, "run_groups") as run, \
                     contextlib.redirect_stderr(error):
                    self.assertEqual(runner.main(), 1)
                select.assert_not_called()
                run.assert_not_called()
                self.assertIn("PREGATE_TEST_TIMEOUT_SECONDS", error.getvalue())

    def test_mixed_selection_preserves_both_languages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("lane.test.ts", "test_lane.py"):
                (root / name).touch()
            self.assertEqual(runner.selected_files(["lane.test.ts", "test_lane.py"], root),
                             {"node": ["lane.test.ts"], "python": ["test_lane.py"]})

    def test_empty_missing_unsupported_and_escape_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "doc.md").touch()
            for arguments in ([], ["missing.test.ts"], ["doc.md"], ["../outside_test.py"]):
                with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                    runner.selected_files(arguments, root)

    def test_native_summaries_count_real_tests(self):
        self.assertEqual(runner.test_count("# tests 3\n# pass 2\n# skipped 1\n", "node"), 3)
        self.assertEqual(runner.test_count("Ran 4 tests in 0.01s\nOK\n", "python"), 4)
        self.assertEqual(runner.test_count("Ran 1 test in 0.01s\nOK\nRan 6 tests in 0.1s\nOK\n", "python"), 6)

    def test_empty_and_all_skipped_summaries_fail(self):
        for kind, output in (("node", "# tests 0\n# pass 0\n"),
                             ("node", "# tests 2\n# pass 0\n# skipped 2\n"),
                             ("python", "Ran 0 tests in 0.1s\nOK\n"),
                             ("python", "Ran 2 tests in 0.1s\nOK (skipped=2)\n"),
                             ("python", "Ran 2 tests in 0.1s\nOK (skipped=2, expected failures=1)\n"),
                             ("node", "missing native summary"), ("python", "OK\n")):
            with self.subTest(kind=kind, output=output), self.assertRaises(ValueError):
                runner.test_count(output, kind)
        self.assertEqual(runner.test_count("Ran 3 tests in 0.1s\nOK (skipped=1, expected failures=1)\n", "python"), 3)

    def test_python_assertion_failure_is_not_swallowed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "test_red.py").write_text("import unittest\nclass Red(unittest.TestCase):\n def test_red(self): self.fail('negative control')\nunittest.main()\n")
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                self.assertEqual(runner.run_groups({"node": [], "python": ["test_red.py"]}, root), 1)
            self.assertIn("negative control", err.getvalue())

    def test_mixed_real_runners_and_typescript_failure(self):
        with tempfile.TemporaryDirectory(dir=runner.ROOT / "test", prefix="pregate-fixture-") as directory:
            fixture = Path(directory)
            ts = fixture / "lane.test.ts"
            py = fixture / "test_lane.py"
            ts.write_text("import test from 'node:test'; import assert from 'node:assert/strict'; test('node contract', () => assert.equal(2 + 2, 4));\n")
            py.write_text("import unittest\nclass Green(unittest.TestCase):\n def test_green(self): self.assertEqual(2 + 2, 4)\nunittest.main()\n")
            groups = runner.selected_files([str(ts.relative_to(runner.ROOT)), str(py.relative_to(runner.ROOT))], runner.ROOT)
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                self.assertEqual(runner.run_groups(groups, runner.ROOT), 0)
            self.assertIn("# tests 2", out.getvalue())
            ts.write_text("import test from 'node:test'; import assert from 'node:assert/strict'; test('negative control', () => assert.equal(2 + 2, 5));\n")
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                self.assertEqual(runner.run_groups(groups, runner.ROOT), 1)
            self.assertIn("4 !== 5", out.getvalue())

    def test_timeout_stops_owned_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = "import time; from pathlib import Path; Path('started').write_text('yes'); time.sleep(3); Path('survived').write_text('bad')"
            parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,sys.argv[1],sys.argv[2]]); time.sleep(60)"
            result = runner.run_command([sys.executable, "-c", parent, "-c", child], root, timeout=2)
            self.assertEqual(result.returncode, 124)
            self.assertIn("PREGATE_RUNNER_TIMEOUT", result.stderr)
            self.assertTrue((root / "started").exists(), "descendant never started; cleanup was not exercised")
            time.sleep(3.1)
            self.assertFalse((root / "survived").exists(), "test descendant survived its lane timeout")

    def test_success_exit_without_execution_evidence_fails_lane(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "test_empty.py").write_text("print('OK')\n")
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                result = runner.run_groups(runner.selected_files(["test_empty.py"], root), root)
            self.assertEqual(result, 1)
            self.assertIn("did not report any executed tests", err.getvalue())

    def test_missing_node_executable_fails_lane(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "lane.test.ts").touch()
            out, err = io.StringIO(), io.StringIO()
            with patch.dict(os.environ, {"PATH": ""}), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                result = runner.run_groups(runner.selected_files(["lane.test.ts"], root), root)
            self.assertEqual(result, 1)
            self.assertIn("PREGATE_RUNNER_ERROR", err.getvalue())

    def test_cli_rejects_invalid_selection(self):
        result = subprocess.run([sys.executable, str(runner.ROOT / "scripts/pregate-runner.py"),
                                 "missing.test.ts"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Missing or outside-repository test", result.stderr)

    def test_sigterm_cleans_started_test_descendants(self):
        with tempfile.TemporaryDirectory(dir=runner.ROOT / "test", prefix="pregate-cancel-") as directory:
            fixture = Path(directory)
            child = "import time; from pathlib import Path; Path('started').write_text('yes'); time.sleep(2); Path('survived').write_text('bad')"
            script = fixture / "test_wait.py"
            script.write_text("import os,subprocess,sys,time\nfrom pathlib import Path\n"
                              f"Path({str(fixture / 'owned-pid')!r}).write_text(str(os.getpid()))\n"
                              f"subprocess.Popen([sys.executable, '-c', {child!r}], cwd={str(fixture)!r})\n"
                              "time.sleep(60)\n")
            process = subprocess.Popen([sys.executable, str(runner.ROOT / "scripts/pregate-runner.py"),
                                        str(script.relative_to(runner.ROOT))], cwd=fixture,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 5
                while not (fixture / "started").exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue((fixture / "started").exists(), "test descendant never started")
                process.terminate()
                process.communicate(timeout=5)
                self.assertNotEqual(process.returncode, 0)
                time.sleep(2.1)
                self.assertFalse((fixture / "survived").exists(), "SIGTERM left a test descendant alive")
            finally:
                if (fixture / "owned-pid").exists():
                    try:
                        os.killpg(int((fixture / "owned-pid").read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=5)

    def test_normal_completion_cleans_owned_background_child(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = "import time; from pathlib import Path; Path('started').write_text('yes'); time.sleep(2); Path('survived').write_text('bad')"
            parent = ("import subprocess,sys,time; from pathlib import Path; "
                      "subprocess.Popen([sys.executable,'-c',sys.argv[1]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); "
                      "\nwhile not Path('started').exists(): time.sleep(0.01)\n")
            result = runner.run_command([sys.executable, "-c", parent, child], root, timeout=5)
            self.assertEqual(result.returncode, 0)
            self.assertTrue((root / "started").exists())
            time.sleep(2.1)
            self.assertFalse((root / "survived").exists(), "successful command left its owned child alive")

    def test_sigterm_during_popen_creation_cleans_owned_session(self):
        self.assert_creation_cancellation(signal.SIGTERM)

    def test_sigint_during_popen_creation_cleans_owned_session(self):
        self.assert_creation_cancellation(signal.SIGINT)

    def assert_creation_cancellation(self, cancel_signal):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = "import time; from pathlib import Path; Path('started').write_text('yes'); time.sleep(1); Path('survived').write_text('bad')"
            real_popen = subprocess.Popen
            owned = []

            def interrupt_after_creation(*args, **kwargs):
                process = real_popen(*args, **kwargs)
                owned.append(process)
                deadline = time.monotonic() + 5
                while not (root / "started").exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue((root / "started").exists(), "owned command never started")
                os.kill(os.getpid(), cancel_signal)
                return process

            previous = signal.getsignal(cancel_signal)
            signal.signal(cancel_signal, lambda signum, frame: sys.exit(128 + signum))
            try:
                with patch.object(runner.subprocess, "Popen", interrupt_after_creation):
                    with self.assertRaises(SystemExit) as interrupted:
                        runner.run_command([sys.executable, "-c", child], root)
                self.assertEqual(interrupted.exception.code, 128 + cancel_signal)
                time.sleep(1.1)
                self.assertFalse((root / "survived").exists(), "cancellation during Popen leaked its owned session")
            finally:
                signal.signal(cancel_signal, previous)
                for process in owned:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                    process.stdout.close()
                    process.stderr.close()


if __name__ == "__main__":
    unittest.main()
