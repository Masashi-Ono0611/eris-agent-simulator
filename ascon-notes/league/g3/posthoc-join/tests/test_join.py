"""Positive controls and ordinary cases. synthetic-only / not G3 evidence."""
import ast
from contextlib import redirect_stderr, redirect_stdout
import copy
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("posthoc_join", BASE / "join.py")
join = importlib.util.module_from_spec(spec)
spec.loader.exec_module(join)
H1, H2 = "0x" + "1" * 64, "0x" + "2" * 64


class JoinTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=BASE / "tests")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.run = self.directory / "run"
        shutil.copytree(BASE / "fixtures/standard", self.run)

    def jsonl(self, name):
        return [json.loads(line) for line in (self.run / name).read_text().splitlines()]

    def put_jsonl(self, name, rows):
        (self.run / name).write_text("".join(json.dumps(row) + "\n" for row in rows))

    def csv(self):
        with (self.run / "blocks.csv").open(newline="") as stream:
            return list(csv.DictReader(stream))

    def put_csv(self, rows):
        with (self.run / "blocks.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(stream, join.COLUMNS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)

    def digests(self):
        return {name: hashlib.sha256((self.run / name).read_bytes()).hexdigest() for name in join.FILES}

    def report(self):
        return join.join_run(self.run, self.digests())

    def assert_finding(self, report, check, code, status, path=None, line=None):
        found = [f for f in report["findings"] if (f["checkId"], f["code"], f["status"]) == (check, code, status)]
        self.assertTrue(found, (check, code, status))
        for finding in found:
            self.assertEqual(finding["notice"], join.NOTICE)
            self.assertTrue(finding["sourceRows"])
            for row in finding["sourceRows"]:
                self.assertIn("originalRow", row)
                self.assertIn("fileSha256", row["sourceRef"])
        if path:
            self.assertTrue(any(r["sourceRef"]["relativePath"] == path and
                                (line is None or r["sourceRef"]["line"] == line)
                                for f in found for r in f["sourceRows"]))
        return found

    def assert_no_code(self, report, code):
        self.assertNotIn(code, [f["code"] for f in report["findings"]])

    def test_handwritten_union_and_counts_no_loss(self):
        expected = json.loads((BASE / "fixtures/expected.json").read_text())
        report = self.report()
        self.assertEqual([r["hash"] for r in report["joined"]], expected["hashes"])
        self.assertEqual([len(r["submitRows"]) for r in report["joined"]], expected["submitCounts"])
        self.assertEqual([len(r["blockRows"]) for r in report["joined"]], expected["csvCounts"])
        counts = report["coverage"]
        self.assertEqual(counts["observedRows"], expected["sourceRows"])
        self.assertEqual(counts["joinedSourceRows"], expected["joinedSourceRows"])
        self.assertEqual(counts["unboundSourceRows"], expected["unboundSourceRows"])
        self.assertEqual(counts["observedRows"], counts["joinedSourceRows"] + counts["unboundSourceRows"])
        self.assertEqual(len(report["sourceRows"]), counts["observedRows"])
        assigned = [s["sourceRef"] for g in report["joined"] for k in ("submitRows", "blockRows") for s in g[k]]
        assigned += [s["sourceRef"] for s in report["unboundEvidence"]]
        self.assertCountEqual(assigned, [s["sourceRef"] for s in report["sourceRows"]])

    def test_normal_checks_pass_but_whole_report_blocked(self):
        report = self.report()
        for check in ("J01",):
            self.assertEqual(report["checks"][check]["status"], "PASS")
        for check in ("J02", "J03", "J06", "J07", "J08", "J14"):
            self.assertEqual(report["checks"][check]["status"], "BLOCKED")
        for check in ("J04", "J05", "J09", "J10", "J11", "J12", "J13"):
            self.assertEqual(report["checks"][check]["status"], "not_evaluated")
        self.assertEqual(report["verdict"], "BLOCKED")
        self.assertEqual(report["evidenceClass"], "SYNTHETIC")
        self.assertEqual(report["gateDecision"], "not_evaluated")
        for field in ("unsafeAttempts", "minedReverts", "lateSubmits", "fullReceiptCount", "expectedWholeRunRows"):
            self.assertIsNone(report["coverage"][field])

    def test_j01_each_missing_file(self):
        for name in join.FILES:
            with self.subTest(name=name):
                path = self.run / name
                data = path.read_bytes()
                path.unlink()
                report = join.join_run(self.run)
                self.assert_finding(report, "J01", "INPUT_UNAVAILABLE_OR_UNSAFE", "BLOCKED", name)
                self.assertIsNone(next(i for i in report["inputs"] if i["path"] == name)["observedRows"])
                path.write_bytes(data)

    def test_j01_final_newline_and_malformed_jsonl_retained(self):
        path = self.run / "agents/cand.jsonl"
        path.write_bytes(path.read_bytes().rstrip(b"\n"))
        self.assert_finding(self.report(), "J01", "JSONL_MISSING_FINAL_NEWLINE", "BLOCKED", "agents/cand.jsonl", 4)
        with path.open("a") as stream:
            stream.write('\n{"error":"SYNTHETIC_SECRET_BROKEN"\n')
        report = self.report()
        self.assert_finding(report, "J01", "MALFORMED_JSONL", "BLOCKED", "agents/cand.jsonl", 5)
        self.assertEqual(report["coverage"]["observedRows"], 12)
        self.assertNotIn("SYNTHETIC_SECRET_BROKEN", json.dumps(report))

    def test_j01_json_shape_duplicates_nonfinite(self):
        for bad in ('[]', '{"runId":"a","runId":"b"}', '{"runId":NaN}', '{'):
            with self.subTest(bad=bad):
                (self.run / "summary.json").write_text(bad)
                self.assert_finding(self.report(), "J01", "MALFORMED_JSON", "BLOCKED", "summary.json", 1)

    def test_j01_csv_malformed_header_and_rows(self):
        path = self.run / "blocks.csv"
        good = path.read_text()
        for content, code in (("hash,hash\na,b\n", "MALFORMED_CSV"),
                              (good + "a,b\n", "MALFORMED_CSV_ROW"),
                              (good + '"unterminated\n', "MALFORMED_CSV")):
            with self.subTest(code=code):
                path.write_text(content)
                self.assert_finding(self.report(), "J01", code, "BLOCKED", "blocks.csv")

    def test_j01_cap_and_truncation_markers(self):
        rows = self.jsonl("agents/cand.jsonl")
        for event in ("log_cap_reached", "log_line_truncated"):
            with self.subTest(event=event):
                self.put_jsonl("agents/cand.jsonl", rows + [{"agentId": "cand", "event": event}])
                self.assert_finding(self.report(), "J01", "TRUNCATED_OR_CAPPED", "BLOCKED", "agents/cand.jsonl", 5)

    def test_j01_completion_missing_duplicate_segment(self):
        rows = self.jsonl("events.jsonl")
        for events in ([], rows * 2):
            self.put_jsonl("events.jsonl", events)
            self.assert_finding(self.report(), "J01", "COMPLETION_NOT_UNIQUE", "BLOCKED")
        self.put_jsonl("events.jsonl", rows + [{"type": "segment_started", "segmentIndex": 1}])
        self.assert_finding(self.report(), "J01", "SEGMENT_SCOPE_UNEXPLAINED", "BLOCKED", "events.jsonl", 2)

    def test_j01_digest_mutation_and_scope(self):
        digests = self.digests()
        with (self.run / "events.jsonl").open("a") as stream:
            stream.write('{}\n')
        self.assert_finding(join.join_run(self.run, digests), "J01", "INPUT_DIGEST_MISMATCH", "BLOCKED", "events.jsonl")
        self.assert_finding(join.join_run(self.run), "J01", "DIGEST_REFERENCE_MISSING", "BLOCKED")
        self.assert_finding(join.join_run(self.run, {"../secret": "0" * 64}), "J01", "DIGEST_MANIFEST_SCOPE_INVALID", "BLOCKED")

    def test_j01_symlink_file_and_parent_never_followed(self):
        path = self.run / "events.jsonl"
        outside = self.directory / "secret.jsonl"
        outside.write_text('{"secret":"SYNTHETIC_SECRET_OUTSIDE"}\n')
        path.unlink()
        path.symlink_to(outside)
        report = join.join_run(self.run)
        self.assert_finding(report, "J01", "INPUT_UNAVAILABLE_OR_UNSAFE", "BLOCKED", "events.jsonl")
        self.assertNotIn("SYNTHETIC_SECRET_OUTSIDE", json.dumps(report))
        shutil.move(str(self.run / "agents"), self.directory / "agents")
        (self.run / "agents").symlink_to(self.directory / "agents", target_is_directory=True)
        self.assert_finding(join.join_run(self.run), "J01", "INPUT_UNAVAILABLE_OR_UNSAFE", "BLOCKED", "agents/cand.jsonl")

    def test_j02_world_missing_does_not_merge_unknown_worlds(self):
        (self.run / "summary.json").write_text('{}\n')
        report = self.report()
        self.assert_finding(report, "J02", "WORLD_UNKNOWN", "BLOCKED", "summary.json")
        self.assertIsNone(report["worldId"])
        self.assertEqual(len(report["joined"]), 8)

    def test_j02_world_conflict_no_cross_world_join(self):
        rows = self.jsonl("agents/cand.jsonl")
        rows[0]["worldId"] = "different-synthetic-world"
        self.put_jsonl("agents/cand.jsonl", rows)
        report = self.report()
        self.assert_finding(report, "J02", "WORLD_CONFLICT", "FAIL", "agents/cand.jsonl", 1)
        groups = [g for g in report["joined"] if g["hash"] == H1]
        self.assertEqual(len(groups), 2)
        self.assertEqual(len(groups[0]["blockRows"]), 0)
        self.assertEqual(len(groups[1]["submitRows"]), 1)

    def test_j02_completion_world_conflict(self):
        self.put_jsonl("events.jsonl", [{"type": "run_completed", "runId": "other"}])
        self.assert_finding(self.report(), "J02", "WORLD_CONFLICT", "FAIL", "events.jsonl", 1)

    def test_j02_owner_mismatch_and_missing(self):
        rows = self.csv()
        rows[0]["ownerId"] = "different-owner"
        self.put_csv(rows)
        found = self.assert_finding(self.report(), "J02", "OWNER_CONFLICT", "FAIL", "blocks.csv", 2)
        self.assertEqual(found[0]["subjectKey"][1], H1)
        rows[0]["ownerId"] = ""
        self.put_csv(rows)
        self.assert_finding(self.report(), "J02", "CANDIDATE_OWNER_UNKNOWN", "BLOCKED")

    def test_j02_agent_file_id_mismatch_and_missing(self):
        rows = self.jsonl("agents/cand.jsonl")
        rows[0]["agentId"] = "other"
        self.put_jsonl("agents/cand.jsonl", rows)
        self.assert_finding(self.report(), "J02", "AGENT_FILE_OWNER_CONFLICT", "FAIL")
        del rows[0]["agentId"]
        self.put_jsonl("agents/cand.jsonl", rows)
        self.assert_finding(self.report(), "J02", "CANDIDATE_ID_UNKNOWN", "BLOCKED")

    def test_j03_identical_csv_duplicates_preserved(self):
        rows = self.csv()
        self.put_csv(rows + [rows[0]])
        report = self.report()
        self.assert_finding(report, "J03", "CSV_HASH_DUPLICATE", "BLOCKED", "blocks.csv", 7)
        self.assert_finding(report, "J03", "CSV_POSITION_DUPLICATE", "BLOCKED")
        self.assert_no_code(report, "DUPLICATE_CONTENT_CONFLICT")
        self.assertEqual(len(report["joined"][0]["blockRows"]), 2)

    def test_j03_world_unknown_conflicting_csv_duplicate(self):
        (self.run / "summary.json").write_text('{}\n')
        row = dict(self.csv()[0], hash="0x" + "Ab" * 32)
        self.put_csv([row, dict(row, hash=row["hash"].lower(), gasUsed="22000")])
        report = self.report()
        self.assert_finding(report, "J02", "WORLD_UNKNOWN", "BLOCKED", "summary.json", 1)
        found = self.assert_finding(report, "J03", "DUPLICATE_CONTENT_CONFLICT", "FAIL", "blocks.csv", 3)
        self.assert_finding(report, "J03", "CSV_HASH_DUPLICATE", "BLOCKED", "blocks.csv", 2)
        self.assertEqual(found[0]["subjectKey"], ["blocks.csv", row["hash"].lower()])
        self.assertEqual([r["sourceRef"]["line"] for r in found[0]["sourceRows"]], [2, 3])
        self.assertEqual(report["checks"]["J03"]["status"], "FAIL")
        self.assertEqual(report["verdict"], "FAIL")

    def test_j03_world_unknown_position_collision(self):
        (self.run / "summary.json").write_text('{}\n')
        row = self.csv()[0]
        self.put_csv([row, dict(row, hash=H2)])
        report = self.report()
        self.assert_finding(report, "J03", "CSV_POSITION_DUPLICATE", "BLOCKED", "blocks.csv", 3)
        self.assert_finding(report, "J03", "DUPLICATE_CONTENT_CONFLICT", "FAIL")
        self.assert_no_code(report, "CSV_HASH_DUPLICATE")

    def test_j03_submit_duplicates_and_repeated_nonce_are_reported(self):
        for summary in ({"runId": "synthetic"}, {}):
            with self.subTest(summary=summary):
                (self.run / "summary.json").write_text(json.dumps(summary) + '\n')
                report = self.report()
                duplicate = self.assert_finding(report, "J03", "SUBMIT_HASH_DUPLICATE", "BLOCKED")
                repeated = self.assert_finding(report, "J03", "SUBMIT_NONCE_REPEATED_ACROSS_HASHES", "BLOCKED")
                self.assertEqual([r["sourceRef"]["line"] for r in duplicate[0]["sourceRows"]], [1, 3])
                self.assertEqual([r["sourceRef"]["line"] for r in repeated[0]["sourceRows"]], [1, 2, 3])
                self.assertEqual({r["originalRow"]["hash"] for r in repeated[0]["sourceRows"]}, {H1, H2})
                self.assert_no_code(report, "DUPLICATE_CONTENT_CONFLICT")

    def test_j03_unique_submits_and_nonces_have_no_duplicate_findings(self):
        rows = self.jsonl("agents/cand.jsonl")[:2]
        rows[1]["nonce"] += 1
        self.put_jsonl("agents/cand.jsonl", rows)
        report = self.report()
        self.assertEqual(report["checks"]["J03"]["status"], "PASS")
        self.assert_no_code(report, "SUBMIT_HASH_DUPLICATE")
        self.assert_no_code(report, "SUBMIT_NONCE_REPEATED_ACROSS_HASHES")

    def test_j03_conflicting_status_and_position(self):
        rows = self.csv()
        duplicate = dict(rows[0], status="reverted")
        self.put_csv(rows + [duplicate])
        self.assert_finding(self.report(), "J03", "DUPLICATE_CONTENT_CONFLICT", "FAIL")
        rows[1]["txIndex"] = rows[0]["txIndex"]
        self.put_csv(rows)
        self.assert_finding(self.report(), "J03", "CSV_POSITION_DUPLICATE", "BLOCKED")
        self.assert_finding(self.report(), "J03", "DUPLICATE_CONTENT_CONFLICT", "FAIL")

    def test_j03_position_collision_with_invalid_hash_is_still_detected(self):
        rows = self.csv()
        self.put_csv(rows + [dict(rows[0], hash="invalid")])
        report = self.report()
        self.assert_finding(report, "J03", "CSV_POSITION_DUPLICATE", "BLOCKED", "blocks.csv", 7)
        self.assert_finding(report, "J06", "HASH_MISSING_OR_INVALID", "BLOCKED", "blocks.csv", 7)

    def test_j03_retries_and_same_nonce_different_hash_are_preserved(self):
        report = self.report()
        self.assertEqual(report["checks"]["J03"]["status"], "BLOCKED")
        self.assert_no_code(report, "DUPLICATE_CONTENT_CONFLICT")
        self.assertEqual(report["joined"][0]["transaction"]["nonceObservations"][0]["value"], 9007199254740993)
        self.assertEqual(len(report["joined"][0]["submitRows"]), 2)
        self.assertEqual(report["joined"][1]["hash"], H2)

    def test_j06_orphans_and_full_receipt_missing(self):
        rows = self.csv()
        self.put_csv(rows[1:])
        report = self.report()
        self.assert_finding(report, "J06", "SUBMIT_WITHOUT_CSV", "BLOCKED", "agents/cand.jsonl", 1)
        self.assert_finding(report, "J06", "CSV_WITHOUT_SUBMIT", "BLOCKED", "blocks.csv")
        self.assert_finding(report, "J06", "FULL_RECEIPT_UNAVAILABLE", "BLOCKED")
        self.assertEqual(report["joined"][0]["receipt"]["availability"], "missing")
        self.assertEqual(len(report["joined"]), 5)

    def test_j06_matched_hash_has_no_orphan_reason(self):
        report = self.report()
        orphan_hashes = {f["subjectKey"][1] for f in report["findings"] if f["code"] in ("SUBMIT_WITHOUT_CSV", "CSV_WITHOUT_SUBMIT")}
        self.assertNotIn(H1, orphan_hashes)
        self.assertNotIn(H2, orphan_hashes)

    def test_invalid_hash_is_unbound_and_not_lost(self):
        rows = self.csv()
        rows[0]["hash"] = "SYNTHETIC_SECRET_INVALID_HASH"
        self.put_csv(rows)
        report = self.report()
        self.assert_finding(report, "J06", "HASH_MISSING_OR_INVALID", "BLOCKED", "blocks.csv", 2)
        self.assertEqual(report["coverage"]["observedRows"], 11)
        self.assertEqual(report["coverage"]["unboundSourceRows"], 4)
        self.assertNotIn("SYNTHETIC_SECRET_INVALID_HASH", json.dumps(report))

    def test_hash_case_normalized_only_in_key(self):
        hash_value = "0x" + "Ab" * 32
        rows = self.csv()
        rows[0]["hash"] = hash_value
        self.put_csv(rows)
        agents = self.jsonl("agents/cand.jsonl")
        agents[0]["hash"] = agents[2]["hash"] = hash_value.lower()
        self.put_jsonl("agents/cand.jsonl", agents)
        report = self.report()
        self.assertEqual(report["joined"][0]["hash"], hash_value.lower())
        self.assertEqual(report["joined"][0]["blockRows"][0]["originalRow"]["hash"], hash_value)

    def test_j07_status_positive_controls(self):
        rows = self.csv()
        for value, classification in (("reverted", "reverted"), ("0", "reverted"), ("0x0", "reverted"),
                                      ("mined", "unknown"), ("unrecognized", "unknown"), ("", "unknown"), ("0x1", "success")):
            with self.subTest(status=value):
                rows[0]["status"] = value
                self.put_csv(rows)
                report = self.report()
                self.assert_finding(report, "J07", "CSV_STATUS_NOT_ACCEPTED", "FAIL", "blocks.csv", 2)
                self.assertEqual(report["joined"][0]["receipt"]["statusObservations"][0]["statusClass"], classification)
                if classification == "unknown":
                    self.assert_finding(report, "J07", "STATUS_RESULT_UNKNOWN", "BLOCKED")
                self.assertEqual(report["verdict"], "FAIL")
                self.assertIsNone(report["coverage"]["minedReverts"])
                self.assertTrue(any(f["status"] == "BLOCKED" for f in report["findings"]))

    def test_j07_accepted_raw_statuses(self):
        rows = self.csv()
        for value in ("1", "success"):
            rows[0]["status"] = value
            self.put_csv(rows)
            report = self.report()
            self.assertEqual(report["checks"]["J07"]["status"], "BLOCKED")
            self.assert_no_code(report, "CSV_STATUS_NOT_ACCEPTED")
        self.assertEqual(join.status_class(True), "unknown")

    def test_j07_successful_csv_without_receipt_is_blocked(self):
        self.put_jsonl("agents/cand.jsonl", [])
        row = self.csv()[0]
        for value in ("1", "success"):
            with self.subTest(status=value):
                row["status"] = value
                self.put_csv([row])
                report = self.report()
                found = self.assert_finding(report, "J07", "RECEIPT_UNAVAILABLE", "BLOCKED", "blocks.csv", 2)
                self.assertEqual(len(found), 1)
                self.assertEqual(found[0]["sourceRows"], report["joined"][0]["blockRows"])
                self.assertEqual(found[0]["sourceRows"][0]["originalRow"], row)
                self.assertEqual(report["checks"]["J07"]["status"], "BLOCKED")
                self.assert_no_code(report, "CSV_STATUS_NOT_ACCEPTED")

    def contract_capture(self):
        capture = join.Capture(self.run, self.digests())
        capture.read()
        capture.index()
        group = capture.groups[0]
        # Deliberately test-only; no new receipt producer/file format is inferred.
        group["receipts"] = [{"raw": {"transactionHash": H1, "blockNumber": 101, "transactionIndex": 1,
                                      "status": "success", "gasUsed": 21000},
                              "ref": {"relativePath": "synthetic-contract-only", "line": 1, "fileSha256": "a" * 64}}]
        return capture, group

    def test_j07_receipt_raw_status_mismatch_even_same_display(self):
        capture, group = self.contract_capture()
        group["receipts"][0]["raw"]["status"] = "1"
        capture.check_j07()
        self.assert_finding({"findings": capture.findings}, "J07", "RECEIPT_STATUS_MISMATCH", "FAIL")
        self.assertEqual(join.status_class("1"), join.status_class("success"))

    def test_j07_matching_receipt_and_csv_status_can_pass(self):
        for status in ("1", "success"):
            with self.subTest(status=status):
                capture, group = self.contract_capture()
                capture.groups = [group]
                group["receipts"][0]["raw"]["status"] = status
                group["csv"][0]["raw"]["status"] = status
                capture.check_j07()
                report = capture.report()
                self.assertEqual(report["checks"]["J07"]["status"], "PASS")
                self.assertEqual(capture.findings, [])

    def test_j07_receipt_revert_contract(self):
        capture, group = self.contract_capture()
        group["receipts"][0]["raw"]["status"] = "reverted"
        capture.check_j07()
        self.assert_finding({"findings": capture.findings}, "J07", "RECEIPT_REVERTED", "FAIL")

    def test_j08_receipt_field_mismatch_contract_each_field(self):
        for field, bad in (("transactionHash", H2), ("blockNumber", 102), ("transactionIndex", 2),
                           ("gasUsed", 22000), ("status", "1")):
            with self.subTest(field=field):
                capture, group = self.contract_capture()
                group["receipts"][0]["raw"][field] = bad
                capture.check_j08()
                self.assert_finding({"findings": capture.findings}, "J08", "RECEIPT_" + field.upper() + "_MISMATCH", "FAIL")

    def test_j08_receipt_contract_match_and_missing(self):
        capture, group = self.contract_capture()
        capture.check_j08()
        self.assertFalse(any(f["status"] == "FAIL" for f in capture.findings))
        group["receipts"][0]["raw"].pop("gasUsed")
        capture.findings = []
        capture.check_j08()
        self.assert_finding({"findings": capture.findings}, "J08", "RECEIPT_FIELD_MISSING", "BLOCKED")

    def test_j08_missing_block_index_gas_nonce(self):
        rows = self.csv()
        for field in ("blockNumber", "txIndex", "gasUsed"):
            changed = copy.deepcopy(rows)
            changed[0][field] = ""
            self.put_csv(changed)
            self.assert_finding(self.report(), "J08", "CSV_" + field.upper() + "_UNKNOWN", "BLOCKED")
        report = self.report()
        self.assert_finding(report, "J08", "BLOCK_HASH_SIGNED_TX_GAS_LIMIT_UNAVAILABLE", "BLOCKED")
        self.assert_finding(report, "J08", "NONCE_UNAVAILABLE", "BLOCKED")
        self.assertIsNone(report["joined"][0]["transaction"]["gasLimit"])

    def test_j14_auxiliary_candidates_never_excluded_or_given_fake_frames(self):
        report = self.report()
        self.assertEqual(len(report["joined"]), 5)
        for row in report["joined"]:
            self.assertIsNone(row["frameKey"])
            self.assertIsNone(row["attemptKey"])
            self.assertEqual(row["origin"], "unknown")
        self.assertEqual(report["joined"][2]["originClaims"], [])  # approve is not startup proof
        self.assertEqual(report["joined"][3]["originClaims"][0]["origin"], "derived_sender")
        self.assertEqual(report["joined"][4]["originClaims"][0]["origin"], "gas_refill")
        self.assert_finding(report, "J14", "FRAME_CONTRACT_UNBOUND", "BLOCKED")
        self.assert_finding(report, "J14", "ORIGIN_UNKNOWN", "BLOCKED")
        self.assert_finding(report, "J14", "CANDIDATE_OR_AUXILIARY_ORPHAN", "BLOCKED")

    def test_ordering_is_not_global_nonce_or_blockseen_sort(self):
        report = self.report()
        self.assertEqual([g["ordering"]["inclusions"][0]["txIndex"] for g in report["joined"]], [1, 0, 1, 0, 1])
        self.assertEqual([r["sourceRef"]["line"] for r in report["joined"][0]["submitRows"]], [1, 3])
        self.assertEqual(report["joined"][0]["submitRows"][0]["originalRow"]["blockSeen"], 100)
        self.assertIsNone(report["joined"][0]["ordering"]["submissionBlock"])
        self.assertIsNone(report["joined"][0]["ordering"]["causalOrder"])
        self.assertEqual(report["checks"]["J09"]["status"], "not_evaluated")
        self.assertEqual(report["checks"]["J03"]["status"], "BLOCKED")
        self.assert_no_code(report, "DUPLICATE_CONTENT_CONFLICT")

    def test_no_promoting_receipt_or_frame_strategy_logs(self):
        rows = self.jsonl("agents/cand.jsonl")
        rows.append({"agentId": "cand", "kind": "receipt", "hash": H1, "status": "success",
                     "frameId": "fake", "complete": True})
        self.put_jsonl("agents/cand.jsonl", rows)
        report = self.report()
        self.assertEqual(report["coverage"]["unboundSourceRows"], 4)
        self.assertIsNone(report["joined"][0]["receipt"]["fullReceipt"])
        self.assertIsNone(report["joined"][0]["frameKey"])

    def test_readonly_deterministic_exclusive_output(self):
        before = self.digests()
        report = self.report()
        self.assertEqual(report, self.report())
        a, b = self.directory / "a.json", self.directory / "b.json"
        join.write_report(report, a, self.run)
        join.write_report(report, b, self.run)
        self.assertEqual(a.read_bytes(), b.read_bytes())
        with self.assertRaises(FileExistsError):
            join.write_report(report, a, self.run)
        with self.assertRaises(ValueError):
            join.write_report(report, self.run / "new.json", self.run)
        self.assertEqual(before, self.digests())

    def test_j01_invalid_csv_header_retains_all_physical_lines(self):
        (self.run / "blocks.csv").write_text('unknown,header\none,two\nthree,four\n')
        report = self.report()
        rows = [r for r in report["sourceRows"] if r["sourceRef"]["relativePath"] == "blocks.csv"]
        self.assertEqual([r["sourceRef"]["line"] for r in rows], [1, 2, 3])
        self.assertTrue(all(r["originalRow"] is None for r in rows))
        self.assert_finding(report, "J01", "MALFORMED_CSV", "BLOCKED", "blocks.csv", 3)

    def test_j01_quoted_multiline_csv_preserves_physical_source_positions(self):
        rows = self.csv()
        rows[0]["bundleId"] = 'synthetic\nmultiline,"quoted"'
        self.put_csv(rows)
        report = self.report()
        first = report["joined"][0]["blockRows"][0]
        second = report["joined"][1]["blockRows"][0]
        self.assertEqual(first["sourceRef"]["line"], 2)
        self.assertEqual(first["endLine"], 3)
        self.assertEqual(second["sourceRef"]["line"], 4)
        self.assertEqual(report["checks"]["J01"]["status"], "PASS")

    def test_j01_csv_error_line_count_matches_csv_newlines(self):
        path = self.run / "blocks.csv"
        # CRLF counts once; CR/LF count once each; Unicode/VT/FF do not.
        path.write_bytes(('hash,status,ownerId,blockNumber,txIndex\r\n'
                          + H1 + ',success,cand,101,1\r'
                          + '"broken\u2028\u0085\v\f\nlast').encode())
        report = self.report()
        rows = [r for r in report["sourceRows"] if r["sourceRef"]["relativePath"] == "blocks.csv"]
        self.assertEqual([r["sourceRef"]["line"] for r in rows], [2, 3, 4])
        self.assertEqual([r["endLine"] for r in rows], [2, 3, 4])
        self.assertEqual(next(i for i in report["inputs"] if i["path"] == "blocks.csv")["observedRows"], 3)
        found = self.assert_finding(report, "J01", "MALFORMED_CSV", "BLOCKED")
        self.assertEqual([r["sourceRef"]["line"] for r in found[0]["sourceRows"]], [3, 4])

    def test_j08_invalid_integer_does_not_match_another_unknown(self):
        capture, group = self.contract_capture()
        group["receipts"][0]["raw"]["gasUsed"] = "unknown"
        group["csv"][0]["raw"]["gasUsed"] = "unknown"
        capture.check_j08()
        self.assert_finding({"findings": capture.findings}, "J08", "RECEIPT_FIELD_INVALID", "BLOCKED")
        for value in (True, False, 1.5, -1, "1.5", "1e10", " 1", "-1", None):
            self.assertIsNone(join.integer(value))
        self.assertEqual(join.integer("0"), 0)

    def test_output_symlink_existing_target_is_never_overwritten(self):
        target = self.directory / "target"
        target.write_text("unchanged")
        output = self.directory / "report.json"
        output.symlink_to(target)
        with self.assertRaises(FileExistsError):
            join.write_report(self.report(), output, self.run)
        self.assertEqual(target.read_text(), "unchanged")

    def test_output_boundary_rejects_real_pass_or_missing_notice(self):
        report = self.report()
        output = self.directory / "forbidden.json"
        for field, value in (("verdict", "PASS"), ("evidenceClass", "RUN_FILES"),
                             ("notice", ""), ("gateDecision", "PASS")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                join.write_report(dict(report, **{field: value}), output, self.run)
            self.assertFalse(output.exists())

    def test_non_candidate_csv_rows_are_preserved_without_candidate_status_fail(self):
        rows = self.csv()
        extra = dict(rows[0], hash="0x" + "6" * 64, ownerId="environment", txIndex="9", status="reverted")
        self.put_csv(rows + [extra])
        report = self.report()
        self.assertEqual(len(report["joined"]), 6)
        self.assertIs(report["joined"][-1]["candidate"], False)
        self.assertEqual(report["checks"]["J07"]["status"], "BLOCKED")
        self.assert_no_code(report, "CSV_STATUS_NOT_ACCEPTED")

    def test_j02_missing_csv_owner_with_matching_submit_is_unknown(self):
        path = self.run / "blocks.csv"
        lines = path.read_text().splitlines()
        index = lines[0].split(",").index("ownerId")
        path.write_text("\n".join(",".join(cell for i, cell in enumerate(line.split(",")) if i != index)
                                 for line in lines) + "\n")
        self.assert_finding(self.report(), "J01", "MALFORMED_CSV", "BLOCKED")

    def test_j07_unknown_raw_status_redaction_is_explicit_not_success(self):
        rows = self.csv()
        rows[0]["status"] = "SYNTHETIC_SECRET_STATUS"
        self.put_csv(rows)
        report = self.report()
        observation = report["joined"][0]["receipt"]["statusObservations"][0]
        self.assertIsNone(observation["statusRaw"])
        self.assertEqual(observation["statusRawAvailability"], "redacted")
        self.assertEqual(observation["statusClass"], "unknown")
        self.assertNotIn("SYNTHETIC_SECRET_STATUS", json.dumps(report))
        self.assert_finding(report, "J07", "CSV_STATUS_NOT_ACCEPTED", "FAIL")

    def test_cli_and_secret_non_output(self):
        rows = self.jsonl("agents/cand.jsonl")
        secret = "SYNTHETIC_SECRET_ANYWHERE"
        rows[-1].update(error=secret, reason=secret, params=[secret], env={secret: secret},
                        url="https://user:" + secret + "@invalid", headers={"Authorization": secret})
        rows[-1][secret] = secret
        self.put_jsonl("agents/cand.jsonl", rows)
        output = self.directory / "report.json"
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            rc = join.main([str(self.run), "--output", str(output)])
        self.assertEqual(rc, 2)
        for text in (stdout.getvalue(), stderr.getvalue(), output.read_text()):
            self.assertNotIn(secret, text)
            self.assertNotIn("SYNTHETIC_SECRET_ERROR", text)
            self.assertNotIn("SYNTHETIC_SECRET_HEADER", text)
        self.assertIn(join.NOTICE, stdout.getvalue())
        self.assertIn(join.NOTICE, output.read_text())
        with redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertEqual(join.main([str(self.run), "--output", str(output)]), 2)
        self.assertIn(join.NOTICE, stderr.getvalue())

    def test_cli_suppresses_credential_bearing_argument_errors(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit):
            join.main(["--SYNTHETIC_SECRET_ARG"])
        self.assertNotIn("SYNTHETIC_SECRET_ARG", stderr.getvalue())
        self.assertIn(join.NOTICE, stderr.getvalue())

    def test_empty_run_is_not_success_or_zero_safety(self):
        self.put_csv([])
        self.put_jsonl("agents/cand.jsonl", [])
        report = self.report()
        self.assertEqual(report["verdict"], "BLOCKED")
        self.assert_finding(report, "J06", "CANDIDATE_SET_NOT_INDEPENDENTLY_KNOWN", "BLOCKED")
        self.assertIsNone(report["coverage"]["minedReverts"])
        for check in ("J07", "J08", "J14"):
            self.assertEqual(report["checks"][check]["status"], "BLOCKED")

    def test_imports_are_stdlib_without_network_subprocess_runtime(self):
        allowed = {"argparse", "collections", "csv", "hashlib", "io", "json", "os", "pathlib", "re", "stat", "sys"}
        tree = ast.parse((BASE / "join.py").read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                self.assertTrue(all(a.name in allowed for a in node.names))
            elif isinstance(node, ast.ImportFrom):
                self.assertIn(node.module, allowed)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if isinstance(node.func.value, ast.Name) and node.func.value.id == "os":
                    self.assertIn(node.func.attr, {"open", "close", "fstat", "fdopen"})


if __name__ == "__main__":
    print(join.NOTICE)
    unittest.main()
