#!/usr/bin/env python3
"""Real Git trees and real judge inputs; no simulator or network required."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("judge2", Path(__file__).with_name("judge2.py"))
judge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(judge)


class SetupEquivalence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="judge-setup-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.env = patch.dict(os.environ, {
            "ASCON_JUDGE_REPO": str(self.repo), "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.git("init", "-q")
        self.git("config", "user.name", "Judge fixture")
        self.git("config", "user.email", "judge@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", str(self.root / "no-hooks"))
        for path in ("docs/guide.md", "src/runner.ts", "ascon/final/roster-FP.yaml",
                     "example/agents/opus-1/agent.ts", "example/agents/opus-1-pb/agent.ts",
                     "example/agents/opus-1r/agent.ts", "example/agents/lib/affordable.ts",
                     "example/agents/runtime/index.ts", "example/agents/opus-1r/prompt.md"):
            self.write(path, "original\n")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args],
                                       stderr=subprocess.PIPE, text=True).strip()

    def write(self, path, text="changed\n"):
        dest = self.repo / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text)

    def commit(self):
        self.git("add", "--all")
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def change(self, path):
        self.write(path)
        return self.commit()

    def verdict(self, commit, repeat=1, bad_head=False):
        cells, hashes = [], {a: [] for a in ("B", "B'", "R")}
        mapping = {"B": "opus-1", "B'": "opus-1-pb", "R": "opus-1r"}
        for seed in (1003, 1004, 1005, 1006):
            for field in ("FP", "FD"):
                cell = {"seed": seed, "field": field, "arms": {}, "arm_evidence": {}}
                for arm in mapping:
                    head = commit if arm == "R" else self.base
                    p = self.root / ("%s-%s-%s.json" % (seed, field, arm))
                    rows = []
                    for i, regime in enumerate(judge.REGIMES12, 1):
                        agents = [{"id": aid, "baseline": baseline,
                                   "pnlUsdc": (700 if arm == "R" else 400) if aid == "slot" else j * 100}
                                  for j, (aid, baseline) in enumerate(judge.read_roster(field))]
                        rows.append(dict(s=i, regime=regime, seed=seed, agents=agents,
                                         runDir="runs/%s-%s-%s-%s" % (seed, field, arm, i)))
                    matrix = dict(schema=2, sourceCommit=head, resetUnit="scenario", k=12,
                                  repeat=repeat if arm == "R" else 1, scenarioStreams="regime-v1",
                                  scenarioKey=dict(source="public", commitment="sha256:" + "5" * 64),
                                  scenariosPlanned=12, scenarios=rows)
                    p.write_text(json.dumps(matrix))
                    hashes[arm].append(hashlib.sha256(p.read_bytes()).hexdigest())
                    cell["arms"][arm] = str(p)
                    cell["arm_evidence"][arm] = dict(
                        ARM="PASS", COLLISION="PASS", slot=mapping[arm], matrix=str(p),
                        head=self.base if bad_head and arm == "R" else head,
                        arm_tree=self.git("rev-parse", self.base + ":example/agents/" + mapping[arm]))
                cells.append(cell)
        manifest = self.root / "manifest.json"
        manifest.write_text(json.dumps(dict(stage="1", arm_map=mapping, cells=cells)))
        mechanism = self.root / "mechanism.json"
        mechanism.write_text(json.dumps({"arms": {a: dict(
            slot_timeouts=0, p99_decide_ms=100, tie_win_rate=0.5, stf=0, matrices_sha256=hashes[a])
            for a in ("B", "R")}}))
        out = self.root / "verdict.json"
        table = io.StringIO()
        with contextlib.redirect_stdout(table):
            rc = judge.main(["judge", "--manifest", str(manifest), "--mechanism", str(mechanism), "--out", str(out)])
        self.assertEqual(rc, 0, table.getvalue())
        return json.loads(out.read_text()), table.getvalue()

    def test_docs_verdict(self):
        changed = self.change("docs/guide.md")
        result, table = self.verdict(changed)
        self.assertEqual(result["candidates"]["R"]["verdict"], "PASS", result["input_problems"])
        records = result["setup_equivalence"]
        self.assertEqual(len(records), 8)
        for record in records:
            self.assertEqual(record["arm"], "R")
            self.assertEqual(record["sourceCommit"], changed)
            self.assertEqual(record["baseline_sourceCommit"], self.base)
            self.assertEqual(record["changed_paths"], 1)
        self.assertEqual({r["lab"] for r in records}, {f"{f}#{s}" for f in ("FP", "FD") for s in range(1003, 1007)})
        self.assertIn("setup equivalence", table)

    def test_new_agent_and_removal(self):
        self.write("example/agents/newcomer/agent.ts")
        self.write("example/agents/newcomer/prompt.md")
        changed = self.commit()
        for a, b in ((self.base[:12], changed[:12]), (changed, self.base)):
            ok, detail = judge.simulation_equivalent(a, b)
            self.assertTrue(ok, detail)
            self.assertEqual(detail["changed_paths"], 2)
        result, _ = self.verdict(changed)
        self.assertEqual(result["candidates"]["R"]["verdict"], "PASS", result["input_problems"])

    def test_existing_agent_and_runtime_paths(self):
        for path in ("example/agents/opus-1r/agent.ts", "example/agents/opus-1r/prompt.md",
                     "example/agents/lib/affordable.ts", "example/agents/runtime/index.ts",
                     "example/agents/opus-1r/new-file.ts", "ascon/final/roster-FP.yaml", "src/runner.ts",
                     "sdk/new.ts", "scripts/new.sh", "package.json", "ascon/eval/run-matrix.sh",
                     "ascon/final/test-roster.yaml", "ascon/final/nested/tool.py"):
            with self.subTest(path=path):
                before = self.git("rev-parse", "HEAD")
                changed = self.change(path)
                ok, detail = judge.simulation_equivalent(before, changed)
                self.assertFalse(ok, detail)
                self.assertIn(path, detail["reason"])

    def assert_not_equivalent(self, before, after):
        for a, b in ((before, after), (after, before)):
            ok, detail = judge.simulation_equivalent(a, b)
            self.assertFalse(ok, detail)

    def test_whole_shared_folder_addition_and_removal(self):
        for folder, filename in (("lib", "affordable.ts"), ("runtime", "index.ts")):
            with self.subTest(folder=folder):
                before = self.git("rev-parse", "HEAD")
                (self.repo / "example/agents" / folder / filename).unlink()
                self.assert_not_equivalent(before, self.commit())

    def test_roster_referenced_folder_removal(self):
        for roster, text in (("roster.yaml", "agents:\n  - id: roster-agent\n"),
                             ("config/nested/roster.yml", "agents:\n  - id: other\n    dir: 'roster-agent'  # pinned\n")):
            with self.subTest(roster=roster):
                self.write(roster, text)
                self.write("example/agents/roster-agent/agent.ts")
                before = self.commit()
                (self.repo / "example/agents/roster-agent/agent.ts").unlink()
                after = self.commit()
                (self.repo / roster).unlink()
                self.commit()
                self.assert_not_equivalent(before, after)

    def test_folder_name_outside_arm_alphabet(self):
        self.write("example/agents/odd+name/agent.ts")
        self.assert_not_equivalent(self.base, self.commit())

    def test_imported_new_folder(self):
        for path, reference in (
                ("example/agents/opus-1/agent.ts", "'../newcomer/helper'"),
                ("example/agents/opus-1/agent.ts", '"../newcomer"'),
                ("src/runner.ts", "'../example/agents/newcomer/helper'")):
            with self.subTest(path=path, reference=reference):
                self.write(path, "import helper from %s;\n" % reference)
                before = self.commit()
                self.write("example/agents/newcomer/helper.ts")
                after = self.commit()
                (self.repo / "example/agents/newcomer/helper.ts").unlink()
                self.write(path, "original\n")
                self.commit()
                self.assert_not_equivalent(before, after)

    def test_unreferenced_folder_literal_search_and_internal_import(self):
        self.write("src/runner.ts", "import helper from '../example/agents/newXagent/helper';\n")
        # Neither a bare mention nor an id that merely contains the folder name references it.
        self.write("roster.yaml", "agents:\n  - id: prefix_new.agent_suffix\n  - id: beta-new.agent\n"
                   "    description: new.agent\n  - id: newXagent\n")
        before = self.commit()
        self.write("example/agents/new.agent/agent.ts", "import helper from '../new.agent/helper';\n")
        self.write("example/agents/new.agent/helper.ts")
        ok, detail = judge.simulation_equivalent(before, self.commit())
        self.assertTrue(ok, detail)

    def test_grep_errors_fail_closed(self):
        self.write("example/agents/newcomer/agent.ts")
        changed = self.commit()
        real_run = judge.subprocess.run
        for roster in (False, True):
            with self.subTest(roster=roster):
                judge._simulation_equivalent_trees.cache_clear()

                def fail_grep(cmd, **kwargs):
                    if "grep" in cmd and ("-E" in cmd) == roster:
                        return subprocess.CompletedProcess(cmd, 2, stdout="", stderr="fixture error")
                    return real_run(cmd, **kwargs)

                with patch.object(judge.subprocess, "run", side_effect=fail_grep):
                    ok, detail = judge.simulation_equivalent(self.base, changed)
                self.assertFalse(ok, detail)
                self.assertIn("git grep failed (exit 2", detail["reason"])

    def test_unsupported_diff_status(self):
        changed = self.change("docs/guide.md")
        real_git = judge._equivalence_git

        def unsupported(repo, *args, **kwargs):
            if args[0] == "diff":
                return "R100\0docs/guide.md\0"
            return real_git(repo, *args, **kwargs)

        with patch.object(judge, "_equivalence_git", side_effect=unsupported):
            ok, detail = judge.simulation_equivalent(self.base, changed)
        self.assertFalse(ok, detail)
        self.assertIn("unsupported git diff status", detail["reason"])

    def test_allowed_paths(self):
        paths = ("ascon-notes/note.md", "test/nested/test.ts", "ascon/final/helper.py",
                 "ascon/final/test-something.sh", "ascon/final/README.md", "ascon/final/LINEAGE.md",
                 "ascon/eval/README.md", "ascon/eval/test-run.sh", "ascon/eval/lane-eta.py",
                 "docs/name\twith\nseparators.md")
        for path in paths:
            self.write(path)
        # Deletion and mode changes in docs are allowed too.
        (self.repo / "docs/guide.md").unlink()
        (self.repo / "ascon/eval/lane-eta.py").chmod(0o755)
        ok, detail = judge.simulation_equivalent(self.base, self.commit())
        self.assertTrue(ok, detail)
        self.assertEqual(detail["changed_paths"], len(paths) + 1)

    def test_unknown_and_git_error(self):
        for value in ("deadbeef" * 5, "--help", None, ["bad"]):
            with self.subTest(commit=value):
                ok, detail = judge.simulation_equivalent(self.base, value)
                self.assertFalse(ok, detail)
                self.assertTrue(detail["reason"])
        with patch.dict(os.environ, {"ASCON_JUDGE_REPO": str(self.root / "missing")}):
            ok, detail = judge.simulation_equivalent(self.base, self.base)
            self.assertFalse(ok, detail)
        with patch.object(judge.subprocess, "run", side_effect=subprocess.TimeoutExpired("git", 30)):
            ok, detail = judge.simulation_equivalent(self.base, self.base)
            self.assertFalse(ok, detail)

    def test_ambiguous_prefix(self):
        tree = self.git("rev-parse", self.base + "^{tree}")
        seen = {}
        for i in range(20000):
            data = ("tree %s\nparent %s\nauthor Fixture <fixture@example.invalid> 1 +0000\n"
                    "committer Fixture <fixture@example.invalid> 1 +0000\n\ncollision %d\n" %
                    (tree, self.base, i)).encode()
            prefix = hashlib.sha1(b"commit " + str(len(data)).encode() + b"\0" + data).hexdigest()[:4]
            if prefix in seen:
                for payload in (seen[prefix], data):
                    subprocess.run(["git", "-C", str(self.repo), "hash-object", "-w", "-t", "commit", "--stdin"],
                                   input=payload, capture_output=True, check=True)
                ok, detail = judge.simulation_equivalent(self.base, prefix)
                self.assertFalse(ok, detail)
                self.assertIn("ambiguous", detail["reason"])
                break
            seen[prefix] = data
        else:
            self.fail("could not construct ambiguous commit prefix")

    def test_cache_and_default_root(self):
        changed = self.change("docs/guide.md")
        with patch.object(judge, "_equivalence_git", wraps=judge._equivalence_git) as git:
            self.assertTrue(judge.simulation_equivalent(self.base, changed)[0])
            self.assertTrue(judge.simulation_equivalent(changed[:12], self.base[:12])[0])
            self.assertEqual(sum(call.args[1] == "diff" for call in git.call_args_list), 1)
        # Default root comes from the script's directory, even with an unrelated cwd.
        nested = self.repo / "ascon/final"
        with patch.dict(os.environ, {"ASCON_JUDGE_REPO": ""}), patch.object(judge, "HERE", str(nested)):
            ok, detail = judge.simulation_equivalent(self.base, changed)
            self.assertTrue(ok, detail)

    def test_other_setup_key_still_blocks(self):
        changed = self.change("docs/guide.md")
        for commit in (self.base, changed):
            result, _ = self.verdict(commit, repeat=2)
            self.assertEqual(result["candidates"]["R"]["verdict"], "BLOCKED")
            self.assertIn("repeat", str(result["input_problems"]))
            self.assertEqual(result["setup_equivalence"], [])

    def test_rejection_reason_and_own_head_guard(self):
        changed = self.change("src/runner.ts")
        result, _ = self.verdict(changed)
        self.assertEqual(result["candidates"]["R"]["verdict"], "BLOCKED")
        self.assertIn("src/runner.ts", str(result["input_problems"]))
        docs = self.change("docs/guide.md")
        self.base = changed
        result, _ = self.verdict(docs, bad_head=True)
        self.assertEqual(result["candidates"]["R"]["verdict"], "BLOCKED")
        self.assertIn("head", str(result["input_problems"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
