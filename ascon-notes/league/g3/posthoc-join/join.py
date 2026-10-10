#!/usr/bin/env python3
"""Read-only, four-file post-hoc join. synthetic-only / not G3 evidence."""
import argparse
from collections import defaultdict
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys

NOTICE = "synthetic-only / not G3 evidence"
FILES = ("summary.json", "events.jsonl", "agents/cand.jsonl", "blocks.csv")
IMPLEMENTED = ("J01", "J02", "J03", "J06", "J07", "J08", "J14")
COLUMNS = ("round blockNumber txIndex hash from priorityFeeWei status ownerId role "
           "actionType bundleId bundleIndex method gasUsed maxFeePerGasWei to valueWei "
           "derivedFrom").split()
HASH = re.compile(r"0x[0-9a-fA-F]{64}\Z")
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
NUMBERS = set(("round blockNumber txIndex nonce priorityFeeWei bundleIndex gasUsed "
               "maxFeePerGasWei valueWei blockSeen amount amountWei runStartBlock "
               "finalBlock transactionIndex gasLimit maxLineBytes maxBytes origBytes").split())
TOKENS = {
    "status": {"1", "success", "0x1", "0", "reverted", "0x0", "mined"},
    "kind": {"mempool", "decision"},
    "event": {"submitted", "submit_failed", "bad_action", "rejected", "approval_failed",
              "approvals_granted", "log_line_truncated", "log_cap_reached"},
    "type": {"run_completed", "run_started", "segment_started", "segment_completed"},
    "role": {"agent", "external", "environment"},
    "actionType": {"direct", "swap", "noop", "gasRefillSwap", "gasRefillUnwrap"},
    "method": {"approve", "swap", "withdraw", "transfer"},
    "agentId": {"cand"}, "ownerId": {"cand"},
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def integer(value):
    """Exact nonnegative integer; bool, float, signs and whitespace are not integers."""
    if type(value) is int and value >= 0:
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        return int(value)
    return None


def tx_hash(value):
    return value.lower() if isinstance(value, str) and HASH.fullmatch(value) else None


def world_label(value):
    # Opaque identifiers can themselves contain credentials; never echo them.
    return "world:" + sha(value.encode()) if isinstance(value, str) and value else None


def status_class(value):
    if type(value) not in (str, int):
        return "unknown"
    if str(value) in ("1", "success", "0x1"):
        return "success"
    if str(value) in ("0", "reverted", "0x0"):
        return "reverted"
    return "unknown"


def safe_row(raw):
    """Keep typed audit fields verbatim, explicitly redact all opaque/free text.

    This is a redacted source view, never advertised as a complete original.
    Unknown field NAMES are opaque too. The sourceRef locates the unchanged original.
    """
    if not isinstance(raw, dict):
        return {"originalRow": None, "redactedFields": ["entire_unparseable_row"]}
    result, redacted = {}, []
    known = set(COLUMNS) | NUMBERS | set(TOKENS) | {
        "runId", "worldId", "ts", "reason", "error", "violations", "segment",
        "segmentIndex", "segmented", "transactionHash", "blockHash", "gasLimit",
    }
    for index, (key, value) in enumerate(raw.items()):
        output_key = key if key in known else "redacted_field_" + str(index)
        allowed = value is None or value == ""
        if key in NUMBERS:
            allowed = allowed or integer(value) is not None
        elif key in ("hash", "transactionHash", "blockHash"):
            allowed = allowed or tx_hash(value) is not None
        elif key in ("from", "to", "derivedFrom"):
            allowed = allowed or (isinstance(value, str) and ADDRESS.fullmatch(value) is not None)
        elif key in TOKENS:
            allowed = allowed or (type(value) in (str, int) and str(value) in TOKENS[key])
        elif key == "ts":
            allowed = allowed or (isinstance(value, str) and re.fullmatch(
                r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z", value) is not None)
        elif key == "violations" and value == []:
            allowed = True
        if output_key != key:
            allowed = False
        result[output_key] = value if allowed else "[REDACTED]"
        if not allowed:
            redacted.append(output_key)
    return {"originalRow": result, "redactedFields": redacted}


def source_view(row):
    return {"notice": NOTICE, "sourceRef": row["ref"],
            "endLine": row.get("endLine", row["ref"]["line"]), **safe_row(row["raw"])}


def strict_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value


def parse_json(text):
    def invalid_constant(_):
        raise ValueError("nonfinite JSON")
    value = json.loads(text, object_pairs_hook=strict_object, parse_constant=invalid_constant)
    if not isinstance(value, dict):
        raise ValueError("object required")
    return value


def read_bytes(root, relative):
    """No symlink traversal, including intermediate components; regular files only."""
    flags = os.O_RDONLY | os.O_NOFOLLOW
    fd = os.open(root, flags | os.O_DIRECTORY)
    try:
        parts = Path(relative).parts
        for part in parts[:-1]:
            child = os.open(part, flags | os.O_DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        child = os.open(parts[-1], flags | os.O_NONBLOCK, dir_fd=fd)
        try:
            if not stat.S_ISREG(os.fstat(child).st_mode):
                raise ValueError("not regular")
            with os.fdopen(child, "rb", closefd=False) as stream:
                return stream.read()
        finally:
            os.close(child)
    finally:
        os.close(fd)


class Capture:
    def __init__(self, root, expected_digests=None):
        self.root = Path(root)
        self.expected = expected_digests
        self.rows, self.inputs, self.findings, self.groups = [], [], [], []
        self.read_issues = []
        self.summary = None
        self.world = None

    def finding(self, check, status, code, rows=(), subject=None):
        self.findings.append({"notice": NOTICE, "checkId": check, "status": status,
                              "code": code, "subjectKey": subject,
                              "sourceRows": [source_view(r) for r in rows]})

    def read(self):
        for name in FILES:
            item = {"path": name, "sha256": None, "availability": "missing",
                    "observedRows": None}
            self.inputs.append(item)
            try:
                data = read_bytes(self.root, name)
            except (OSError, ValueError):
                ref = {"relativePath": name, "line": None, "fileSha256": None}
                self.read_issues.append(("INPUT_UNAVAILABLE_OR_UNSAFE", [{"ref": ref, "raw": None}]))
                continue
            item.update(sha256=sha(data), availability="read", observedRows=0)

            def add(raw, start, end=None):
                row = {"raw": raw, "ref": {"relativePath": name, "line": start,
                       "fileSha256": item["sha256"]}, "endLine": end or start}
                self.rows.append(row)
                item["observedRows"] += 1
                return row

            if name.endswith(".jsonl"):
                for line, content in enumerate(data.splitlines(), 1):
                    try:
                        row = add(parse_json(content), line)
                    except (ValueError, UnicodeError):
                        row = add(None, line)
                        self.read_issues.append(("MALFORMED_JSONL", [row]))
                if data and not data.endswith(b"\n"):
                    self.read_issues.append(("JSONL_MISSING_FINAL_NEWLINE", [self.rows[-1]]))
            elif name.endswith(".json"):
                try:
                    self.summary = add(parse_json(data), 1)
                except (ValueError, UnicodeError):
                    self.read_issues.append(("MALFORMED_JSON", [add(None, 1)]))
            else:
                previous = 0
                try:
                    stream = csv.reader(io.StringIO(data.decode("utf-8"), newline=""), strict=True)
                    header = next(stream)
                    if len(set(header)) != len(header) or not {"hash", "status", "ownerId", "blockNumber", "txIndex"} <= set(header):
                        raise ValueError("invalid header")
                    previous = stream.line_num
                    while True:
                        try:
                            cells = next(stream)
                        except StopIteration:
                            break
                        raw = dict(zip(header, cells)) if len(cells) == len(header) else None
                        row = add(raw, previous + 1, stream.line_num)
                        previous = stream.line_num
                        if raw is None:
                            self.read_issues.append(("MALFORMED_CSV_ROW", [row]))
                except (UnicodeError, csv.Error, ValueError, StopIteration):
                    # Parsing cannot establish logical rows in the remainder. Retain
                    # EVERY physical line as opaque evidence, never silently discard it.
                    # bytes.splitlines uses CR/LF/CRLF like csv.line_num;
                    # str.splitlines would also count Unicode separators.
                    remainder = [add(None, line) for line in range(previous + 1, len(data.splitlines()) + 1)]
                    self.read_issues.append(("MALFORMED_CSV", remainder or [add(None, 1)]))
        if self.summary:
            self.world = world_label(self.summary["raw"].get("runId"))

    def index(self):
        buckets = {}
        self.unbound = []
        for row in self.rows:
            raw = row["raw"]
            name = row["ref"]["relativePath"]
            endpoint = ("csv" if name == "blocks.csv" else "submits"
                        if name == "agents/cand.jsonl" and isinstance(raw, dict)
                        and raw.get("kind") == "mempool" and raw.get("event") == "submitted" else None)
            hash_value = tx_hash(raw.get("hash")) if isinstance(raw, dict) else None
            if endpoint is None or hash_value is None:
                self.unbound.append(row)
                continue
            explicit = [world_label(raw[k]) for k in ("worldId", "runId") if k in raw]
            world = explicit[0] if explicit else self.world
            # Unknown worlds never collapse into a shared null-world hash bucket.
            scope = world or ("unbound:" + name + ":" + str(row["ref"]["line"]))
            key = (scope, hash_value)
            if key not in buckets:
                buckets[key] = {"key": [scope, hash_value], "worldId": world,
                                "hash": hash_value, "submits": [], "csv": [], "receipts": []}
            buckets[key][endpoint].append(row)
        self.groups = list(buckets.values())  # first source occurrence; never sort source rows
        for group in self.groups:
            rows = group["submits"] + group["csv"]
            owners = [r["raw"].get("ownerId") for r in group["csv"]]
            agents = [r["raw"].get("agentId") for r in group["submits"]]
            group["candidate"] = (True if "cand" in owners + agents else
                                  None if any(not isinstance(v, str) or not v for v in owners + agents) else False)
            group["rows"] = rows

    def check_j01(self):
        for code, rows in self.read_issues:
            self.finding("J01", "BLOCKED", code, rows)
        completed = [r for r in self.rows if isinstance(r["raw"], dict)
                     and r["ref"]["relativePath"] == "events.jsonl"
                     and r["raw"].get("type") == "run_completed"]
        if len(completed) != 1:
            self.finding("J01", "BLOCKED", "COMPLETION_NOT_UNIQUE", completed or self.summary_rows())
        for row in self.rows:
            raw = row["raw"] or {}
            if raw.get("event") in ("log_line_truncated", "log_cap_reached"):
                self.finding("J01", "BLOCKED", "TRUNCATED_OR_CAPPED", [row])
            if (any(k in raw for k in ("segment", "segmentIndex", "segments", "segmentId"))
                    or raw.get("segmented") is True
                    or raw.get("type") in ("segment_started", "segment_completed")):
                self.finding("J01", "BLOCKED", "SEGMENT_SCOPE_UNEXPLAINED", [row])
        if self.expected is None:
            self.finding("J01", "BLOCKED", "DIGEST_REFERENCE_MISSING", self.summary_rows())
        else:
            if set(self.expected) != set(FILES):
                self.finding("J01", "BLOCKED", "DIGEST_MANIFEST_SCOPE_INVALID", self.summary_rows())
            for item in self.inputs:
                if self.expected.get(item["path"]) != item["sha256"] or item["sha256"] is None:
                    rows = [r for r in self.rows if r["ref"]["relativePath"] == item["path"]]
                    self.finding("J01", "BLOCKED", "INPUT_DIGEST_MISMATCH", rows or [{
                        "raw": None, "ref": {"relativePath": item["path"], "line": None,
                                              "fileSha256": item["sha256"]}}])

    def summary_rows(self):
        return [self.summary] if self.summary else [{"raw": None, "ref": {
            "relativePath": "summary.json", "line": None, "fileSha256": None}}]

    def check_j02(self):
        if self.world is None:
            self.finding("J02", "BLOCKED", "WORLD_UNKNOWN", self.summary_rows())
        self.finding("J02", "BLOCKED", "CHAIN_INSTANCE_UNBOUND", self.summary_rows())
        for row in self.rows:
            raw = row["raw"] or {}
            for field in ("worldId", "runId"):
                if field in raw:
                    world = world_label(raw[field])
                    if world is None:
                        self.finding("J02", "BLOCKED", "ROW_WORLD_UNKNOWN", [row])
                    elif self.world and world != self.world:
                        self.finding("J02", "FAIL", "WORLD_CONFLICT", self.summary_rows() + [row])
            if row["ref"]["relativePath"] == "agents/cand.jsonl" and raw:
                if not raw.get("agentId"):
                    self.finding("J02", "BLOCKED", "CANDIDATE_ID_UNKNOWN", [row])
                elif raw["agentId"] != "cand":
                    self.finding("J02", "FAIL", "AGENT_FILE_OWNER_CONFLICT", [row])
        for group in self.groups:
            owners = {r["raw"].get("ownerId") for r in group["csv"] if isinstance(r["raw"].get("ownerId"), str)}
            if group["candidate"] is None or any(not isinstance(r["raw"].get("ownerId"), str)
                                                  or not r["raw"]["ownerId"] for r in group["csv"]):
                self.finding("J02", "BLOCKED", "CANDIDATE_OWNER_UNKNOWN", group["rows"], group["key"])
            if len(owners - {""}) > 1 or (any(r["raw"].get("agentId") == "cand" for r in group["submits"])
                                          and owners - {"cand", ""}):
                self.finding("J02", "FAIL", "OWNER_CONFLICT", group["rows"], group["key"])

    def check_j03(self):
        if any(r["ref"]["relativePath"] == "blocks.csv" for _, rows in self.read_issues for r in rows):
            self.finding("J03", "BLOCKED", "CSV_DUPLICATE_SCOPE_INCOMPLETE", [r for _, rows in self.read_issues
                         for r in rows if r["ref"]["relativePath"] == "blocks.csv"])
        # Source-local duplicate evidence does not require a bound world.
        # Keep this independent of the world-scoped outer join in index().
        hashes, nonces, positions = defaultdict(list), defaultdict(list), defaultdict(list)
        for row in self.rows:
            name, raw = row["ref"]["relativePath"], row["raw"]
            if raw is None:
                continue
            submitted = (name == "agents/cand.jsonl" and raw.get("kind") == "mempool"
                         and raw.get("event") == "submitted")
            hash_value = tx_hash(raw.get("hash"))
            if hash_value and (name == "blocks.csv" or submitted):
                hashes[(name, hash_value)].append(row)
                nonce = integer(raw.get("nonce"))
                if submitted and nonce is not None:
                    explicit = [world_label(raw[k]) for k in ("worldId", "runId") if k in raw]
                    world = explicit[0] if explicit else self.world
                    nonces[(name, world, nonce)].append(row)
        for key, rows in hashes.items():
            if key[0] == "blocks.csv":
                self.duplicates("CSV_HASH_DUPLICATE", rows, list(key))
            elif len(rows) > 1:
                self.finding("J03", "BLOCKED", "SUBMIT_HASH_DUPLICATE", rows, list(key))
        for key, rows in nonces.items():
            if len({tx_hash(r["raw"]["hash"]) for r in rows}) > 1:
                # Sender/attempt identity is unavailable: report ambiguity,
                # not a proven nonce collision or a replacement decision.
                self.finding("J03", "BLOCKED", "SUBMIT_NONCE_REPEATED_ACROSS_HASHES", rows, list(key))
        # Position collisions must also include rows with malformed hashes.
        for row in self.rows:
            if row["ref"]["relativePath"] != "blocks.csv" or row["raw"] is None:
                continue
            raw = row["raw"]
            explicit = [world_label(raw[k]) for k in ("worldId", "runId") if k in raw]
            world = explicit[0] if explicit else self.world
            block, index = integer(raw.get("blockNumber")), integer(raw.get("txIndex"))
            if block is not None and index is not None:
                scope = world or "source:blocks.csv"
                positions[(scope, block, index)].append(row)
        for key, rows in positions.items():
            self.duplicates("CSV_POSITION_DUPLICATE", rows, list(key))

    def duplicates(self, code, rows, subject):
        if len(rows) > 1:
            self.finding("J03", "BLOCKED", code, rows, subject)
            if any(row["raw"] != rows[0]["raw"] for row in rows[1:]):
                self.finding("J03", "FAIL", "DUPLICATE_CONTENT_CONFLICT", rows, subject)

    def check_j06(self):
        for row in self.unbound:
            raw = row["raw"] or {}
            if row["ref"]["relativePath"] == "blocks.csv" or (
                    raw.get("kind") == "mempool" and raw.get("event") == "submitted"):
                self.finding("J06", "BLOCKED", "HASH_MISSING_OR_INVALID", [row])
        for group in self.groups:
            if group["candidate"] is False:
                continue
            for endpoint, code in (("csv", "SUBMIT_WITHOUT_CSV"), ("submits", "CSV_WITHOUT_SUBMIT")):
                if not group[endpoint]:
                    self.finding("J06", "BLOCKED", code, group["rows"], group["key"])
            self.finding("J06", "BLOCKED", "FULL_RECEIPT_UNAVAILABLE", group["rows"], group["key"])
        if not any(g["candidate"] is not False for g in self.groups):
            self.finding("J06", "BLOCKED", "CANDIDATE_SET_NOT_INDEPENDENTLY_KNOWN", self.summary_rows())

    def check_j07(self):
        if not any(g["candidate"] is not False and g["csv"] for g in self.groups):
            self.finding("J07", "BLOCKED", "CANDIDATE_STATUS_SCOPE_UNKNOWN", self.summary_rows())
        for group in self.groups:
            if group["candidate"] is False:
                continue
            if not group["receipts"]:
                self.finding("J07", "BLOCKED", "RECEIPT_UNAVAILABLE", group["rows"], group["key"])
            if not group["csv"]:
                self.finding("J07", "BLOCKED", "CSV_STATUS_UNAVAILABLE", group["rows"], group["key"])
            for row in group["csv"]:
                raw = row["raw"].get("status")
                if raw not in ("1", "success"):
                    self.finding("J07", "FAIL", "CSV_STATUS_NOT_ACCEPTED", [row], group["key"])
                if status_class(raw) == "unknown":
                    self.finding("J07", "BLOCKED", "STATUS_RESULT_UNKNOWN", [row], group["key"])
            self.compare_receipts(group, "J07")

    def compare_receipts(self, group, check):
        """Contract-level comparison only: stock four-file adapter provides no full receipts.

        Synthetic unit tests exercise this branch with source-backed in-memory rows.
        Arbitrary strategy logs are NEVER promoted to authoritative receipt records.
        """
        for receipt in group["receipts"]:
            rr = receipt["raw"]
            if check == "J07" and status_class(rr.get("status")) == "reverted":
                self.finding(check, "FAIL", "RECEIPT_REVERTED", [receipt], group["key"])
            for row in group["csv"]:
                pairs = (("status", "status"),) if check == "J07" else (
                    ("transactionHash", "hash"), ("blockNumber", "blockNumber"),
                    ("transactionIndex", "txIndex"), ("status", "status"), ("gasUsed", "gasUsed"))
                for left, right in pairs:
                    a, b = rr.get(left), row["raw"].get(right)
                    if a is None or a == "" or b is None or b == "":
                        self.finding(check, "BLOCKED", "RECEIPT_FIELD_MISSING", [row, receipt], group["key"])
                        continue
                    if left in NUMBERS and (integer(a) is None or integer(b) is None):
                        self.finding(check, "BLOCKED", "RECEIPT_FIELD_INVALID", [row, receipt], group["key"])
                        continue
                    if left == "transactionHash" and (tx_hash(a) is None or tx_hash(b) is None):
                        self.finding(check, "BLOCKED", "RECEIPT_HASH_INVALID", [row, receipt], group["key"])
                        continue
                    same = (tx_hash(a) == tx_hash(b) if left == "transactionHash" else
                            integer(a) == integer(b) if left in NUMBERS else str(a) == str(b))
                    if not same:
                        self.finding(check, "FAIL", "RECEIPT_" + left.upper() + "_MISMATCH", [row, receipt], group["key"])

    def check_j08(self):
        if not any(g["candidate"] is not False for g in self.groups):
            self.finding("J08", "BLOCKED", "CANDIDATE_TX_SCOPE_UNKNOWN", self.summary_rows())
        for group in self.groups:
            if group["candidate"] is False:
                continue
            for row in group["csv"]:
                for field in ("blockNumber", "txIndex", "gasUsed"):
                    if integer(row["raw"].get(field)) is None:
                        self.finding("J08", "BLOCKED", "CSV_" + field.upper() + "_UNKNOWN", [row], group["key"])
            self.compare_receipts(group, "J08")
            self.finding("J08", "BLOCKED", "BLOCK_HASH_SIGNED_TX_GAS_LIMIT_UNAVAILABLE", group["rows"], group["key"])
            if not group["submits"] or any(integer(r["raw"].get("nonce")) is None for r in group["submits"]):
                self.finding("J08", "BLOCKED", "NONCE_UNAVAILABLE", group["rows"], group["key"])

    def check_j14(self):
        if not any(g["candidate"] is not False for g in self.groups):
            self.finding("J14", "BLOCKED", "CANDIDATE_FRAME_SCOPE_UNKNOWN", self.summary_rows())
        for group in self.groups:
            if group["candidate"] is False:
                continue
            self.finding("J14", "BLOCKED", "FRAME_CONTRACT_UNBOUND", group["rows"], group["key"])
            if not origin_claims(group):
                self.finding("J14", "BLOCKED", "ORIGIN_UNKNOWN", group["rows"], group["key"])
            if not group["submits"] or not group["csv"]:
                self.finding("J14", "BLOCKED", "CANDIDATE_OR_AUXILIARY_ORPHAN", group["rows"], group["key"])

    def report(self):
        checks = {}
        for number in range(1, 15):
            key = "J%02d" % number
            findings = [f for f in self.findings if f["checkId"] == key]
            checks[key] = {"notice": NOTICE, "status": verdict(findings, "PASS") if key in IMPLEMENTED else "not_evaluated",
                           "findingCount": len(findings) if key in IMPLEMENTED else None}
        joined = []
        for group in self.groups:
            csv_rows = group["csv"]
            joined.append({
                "notice": NOTICE, "rowKey": group["key"], "worldId": group["worldId"],
                "hash": group["hash"], "candidate": group["candidate"],
                "origin": "unknown", "originClaims": origin_claims(group), "attemptKey": None, "frameKey": None,
                "submitRows": [source_view(r) for r in group["submits"]],
                "blockRows": [source_view(r) for r in csv_rows],
                "receipt": {"availability": "csv_projection" if csv_rows else "missing",
                            "fullReceipt": None, "blockHash": None,
                            "statusObservations": [{"sourceRef": r["ref"],
                                "statusRaw": (None if "status" in safe_row(r["raw"])["redactedFields"]
                                              else r["raw"].get("status")),
                                "statusRawAvailability": ("redacted" if "status" in safe_row(r["raw"])["redactedFields"]
                                                          else "observed" if "status" in r["raw"] else "missing"),
                                "statusClass": status_class(r["raw"].get("status"))} for r in csv_rows]},
                "transaction": {"gasLimit": None, "signedTxRef": None,
                                "nonceObservations": [{"sourceRef": r["ref"], "value": integer(r["raw"].get("nonce"))}
                                                      for r in group["submits"]]},
                "ordering": {"sourcePositions": [r["ref"] for r in group["rows"]],
                             "inclusions": [{"sourceRef": r["ref"], "blockNumber": integer(r["raw"].get("blockNumber")),
                                             "txIndex": integer(r["raw"].get("txIndex"))} for r in csv_rows],
                             "causalOrder": None, "submissionBlock": None},
            })
        missing = ["capture_provenance_and_independent_counts", "chain_instance", "full_receipts",
                   "action_sender_queue_tx_edges", "frames_and_all_attempts", "economic_boundary_values",
                   "reservation_and_gas_policy", "causal_order_and_versions"]
        return {"notice": NOTICE, "schema": "b04-capture-join-v1-partial", "evidenceClass": "SYNTHETIC",
                "captureSetId": sha(json.dumps(self.inputs, sort_keys=True).encode()),
                "worldId": self.world, "candidateId": "cand", "chainInstanceRef": None,
                "verdict": verdict(self.findings, "BLOCKED"), "gateDecision": "not_evaluated",
                "checks": checks, "findings": self.findings, "joined": joined,
                "inputs": self.inputs, "sourceRows": [source_view(r) for r in self.rows],
                "unboundEvidence": [source_view(r) for r in self.unbound],
                "coverage": {"declaredScope": list(FILES), "observedRows": len(self.rows),
                             "joinedSourceRows": sum(len(g["rows"]) for g in self.groups),
                             "unboundSourceRows": len(self.unbound), "joinedHashes": len(joined),
                             "expectedWholeRunRows": None, "fullReceiptCount": None,
                             "unsafeAttempts": None, "minedReverts": None, "lateSubmits": None},
                "unavailableComparisons": {
                    "frameAndAttemptDuplicateKeys": "not_evaluated",
                    "receiptVersusCsv": "BLOCKED", "signedVersusReturnedHash": "BLOCKED",
                    "probeWorldBinding": "not_evaluated", "segmentStitching": "not_evaluated"},
                "unresolved": [{"notice": NOTICE, "status": "BLOCKED", "reason": reason,
                                "value": None} for reason in missing]}


def origin_claims(group):
    claims = []
    for row in group["rows"]:
        raw = row["raw"]
        label = ("derived_sender" if isinstance(raw.get("derivedFrom"), str) and ADDRESS.fullmatch(raw["derivedFrom"])
                 else "gas_refill" if raw.get("actionType") in ("gasRefillSwap", "gasRefillUnwrap") else None)
        if label:
            claims.append({"origin": label, "sourceRef": row["ref"], "authority": "source_claim_only"})
    return claims


def verdict(findings, default):
    return "FAIL" if any(f["status"] == "FAIL" for f in findings) else "BLOCKED" if any(
        f["status"] == "BLOCKED" for f in findings) else default


def join_run(root, expected_digests=None):
    capture = Capture(root, expected_digests)
    capture.read()
    capture.index()
    for check in IMPLEMENTED:
        getattr(capture, "check_" + check.lower())()
    return capture.report()


def write_report(report, output, root):
    if (report.get("notice") != NOTICE or report.get("evidenceClass") != "SYNTHETIC"
            or report.get("gateDecision") != "not_evaluated"
            or report.get("verdict") not in ("CONSISTENT_ON_SYNTHETIC", "FAIL", "BLOCKED")):
        raise ValueError("synthetic report contract required")
    output = Path(output)
    # Even an absent input must not be created in the run directory.
    if output.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError("output inside input root")
    payload = json.dumps(report, ensure_ascii=True, sort_keys=True, indent=2, allow_nan=False) + "\n"
    with output.open("x", encoding="utf-8") as stream:
        stream.write(payload)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default message can echo credential-bearing argv.
        self.exit(2, NOTICE + ": invalid arguments (use --help)\n")


def main(argv=None):
    parser = Parser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--expect-sha256", action="append", default=[], metavar="RELATIVE_PATH=HEX",
                        help="optional independent digests; supply all four fixed paths")
    args = parser.parse_args(argv)
    try:
        expected = None
        if args.expect_sha256:
            expected = {}
            for value in args.expect_sha256:
                name, digest = value.split("=", 1)
                if name not in FILES or name in expected or not re.fullmatch(r"[a-f0-9]{64}", digest):
                    raise ValueError("invalid digest manifest")
                expected[name] = digest
        report = join_run(args.run_dir, expected)
        write_report(report, args.output, args.run_dir)
    except (OSError, ValueError, RecursionError):
        print(NOTICE + ": BLOCKED; input/output unavailable or invalid (details suppressed)", file=sys.stderr)
        return 2
    print(NOTICE + ": " + report["verdict"])
    return {"CONSISTENT_ON_SYNTHETIC": 0, "FAIL": 1, "BLOCKED": 2}[report["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
