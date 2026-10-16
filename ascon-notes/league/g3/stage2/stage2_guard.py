#!/usr/bin/env python3
"""Fail-closed diagnostic-only launcher guard; uses only the Python stdlib."""

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
import select
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


REQUIRED_PREREQUISITES = (
    "B05", "B07", "B08b", "auth_schema", "account_exclusivity",
    "extra_usage_off", "node_toolchain", "cli_restrictions", "managed_settings_inventory",
    "frontmatter_model_routing",
)
DISALLOWED_TOOLS = (
    "Bash", "Edit", "Read", "Write", "Glob", "Grep", "WebFetch", "WebSearch", "Task",
    "SlashCommand", "TodoWrite", "BashOutput", "KillShell", "NotebookEdit",
)
PROVIDER_PREFIXES = (
    "ANTHROPIC_", "CLAUDE_CODE_", "AWS_", "GOOGLE_", "GEMINI_", "CLOUD_ML",
    "VERTEX_", "BEDROCK_", "ERIS_INFERENCE_", "ERIS_OLLAMA_", "OLLAMA_", "OPENAI_",
    "GROK_", "XAI_", "DEEPSEEK_", "MISTRAL_",
)
STRIP_EXACT = {"NODE_OPTIONS", "G3_PROBE_JSONL", "G3_PROBE_EXPECT_NODE", "G3_PROBE_EXPECT_TSX",
               "ERIS_CLAUDE_BIN", "ERIS_CODEX_BIN"}
BLOCKED_EXACT = {"CLAUDE_CONFIG_DIR", "CLAUDECODE", "AI_AGENT", "BASH_ENV", "ENV", "CDPATH",
                 "NODE_PATH", "NODE_EXTRA_CA_CERTS", "ERIS_VERIFY_LLM", "ERIS_VULN_LLM"}
BLOCKED_PREFIXES = ("DYLD_", "LD_", "PYTHON")
STOP_PATTERNS = (
    ("429", re.compile(r"(?<![A-Za-z0-9])(?:HTTP(?:/\d+(?:\.\d+)?)?\s+429|(?:API\s+)?Error\s*:\s*429|429\s+Too Many Requests|[\"']?(?:status|status(?:\s+code|[_ -]?code)?|http_status|httpStatusCode|responseCode|errorCode|code)[\"']?\s*[:= ]\s*[\"']?429)\b", re.I)),
    ("rate_limit", re.compile(r"\b(?:rate[_ -]+limit|too many requests)(?:\s+(?:was\s+)?(?:exceeded|reached|error|exhausted))\b|\bRateLimitError\b", re.I)),
    ("quota", re.compile(r"\bquota(?:[_ -]+(?:exceeded|reached))\b|\b(?:usage|account|subscription|5-hour|weekly)[_ -]+limit(?:\s+(?:has been|was))?\s+reached\b|\bout of extra usage\b|\bhit your (?:usage|account) limit\b|\byou['’]ve hit your limit\b", re.I)),
    ("overloaded", re.compile(r"\b(?:service[_ -]+overloaded|overloaded[_ -]+error)\b|message[\"\']?\s*:\s*[\"\']overloaded[\"\']", re.I)),
    ("529", re.compile(r"(?<![A-Za-z0-9])(?:HTTP(?:/\d+(?:\.\d+)?)?\s+529|(?:API\s+)?Error\s*:\s*529|529\s+Overloaded|[\"']?(?:status|status(?:\s+code|[_ -]?code)?|http_status|httpStatusCode|responseCode|errorCode|code)[\"']?\s*[:= ]\s*[\"']?529)\b", re.I)),
    ("fallback", re.compile(r"\"(?:model_)?fallback\"\s*:\s*(?:true|\"[^\"]+\")", re.I)),
    ("billing", re.compile(r"[\"']billing_error[\"']\s*:\s*true|\bpayment required\b|\b(?:insufficient|exhausted) (?:credits|credit balance)\b|\byour credit balance is too low\b", re.I)),
    ("provider_error", re.compile(r"[\"']is_error[\"']\s*:\s*true|[\"'](?:type|error_type)[\"']\s*:\s*[\"'](?:error|rate_limit_error|overloaded_error|authentication_error|invalid_request_error)[\"']|\\[\"'](?:type|error_type)\\[\"']\s*:\s*\\[\"'](?:error|rate_limit_error|overloaded_error|authentication_error|invalid_request_error)\\[\"']", re.I)),
)

MAX_LOG_READ_PER_POLL = 1024 * 1024
MAX_LOG_BACKLOG = 8 * 1024 * 1024
LOG_CHUNK_BYTES = 64 * 1024
MAX_LOG_FILES = 8192
MAX_LOG_TREE_ENTRIES = 16384
MAX_LOG_DEPTH = 128
MAX_CONTROL_JSON_BYTES = 4 * 1024 * 1024
MAX_START_LEDGER_BYTES = 64 * 1024
CONTROL_LOCK_WAIT_SECONDS = 5
NUMERIC_STOP_IDLE_SECONDS = 1.0
# Runtime CLI timeout is 300 seconds; allow 30 seconds for shim startup and cleanup.
CLI_OWNER_DEADLINE_SECONDS = 330
WORLD_STDOUT_EOF_TIMEOUT_SECONDS = 5.0
CLI_STDOUT_EOF_TIMEOUT_SECONDS = 5.0
MAX_FINAL_SCAN_ATTEMPTS = 3
MAX_FINAL_SCAN_POLLS = 64
HARD_MAX_INPUT_FILE_BYTES = 64 * 1024 * 1024
HARD_MAX_INPUT_TOTAL_BYTES = 128 * 1024 * 1024
HARD_MAX_INPUT_FILES = 1024


class GuardError(Exception):
    pass


class FileChangedDuringOpen(GuardError):
    """A regular file was replaced between lstat and its no-follow open."""


def sha256_file(path):
    h = hashlib.sha256()
    fd, _ = _open_regular_file(path)
    with os.fdopen(fd, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _open_regular_file(path, dir_fd=None, expected=None, flags=os.O_RDONLY, mode=0o600):
    required = ("O_NOFOLLOW", "O_NONBLOCK")
    if any(not getattr(os, name, 0) for name in required):
        raise GuardError("platform lacks safe regular-file open flags")
    safe_flags = flags | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = (os.open(path, safe_flags, mode, dir_fd=dir_fd) if dir_fd is not None
          else os.open(path, safe_flags, mode))
    try:
        current = os.fstat(fd)
        if not stat.S_ISREG(current.st_mode):
            raise GuardError("refusing to read a non-regular file")
        if expected is not None and (current.st_dev != expected.st_dev or current.st_ino != expected.st_ino):
            raise FileChangedDuringOpen("file changed during safe open")
        return fd, current
    except Exception:
        os.close(fd)
        raise


def _file_incarnation(st):
    """Return the filesystem creation identity, or None if it is unavailable."""
    birth = getattr(st, "st_birthtime_ns", None)
    if birth is None:
        birth = getattr(st, "st_birthtime", None)
    if birth is not None:
        return ("birth", birth)
    return None


def _read_json(path):
    fd = None
    try:
        fd, _ = _open_regular_file(path)
        with os.fdopen(fd, "rb") as stream:
            fd = None
            data = stream.read(MAX_CONTROL_JSON_BYTES + 1)
            if len(data) > MAX_CONTROL_JSON_BYTES:
                raise ValueError("JSON input exceeds size limit")
            return json.loads(data.decode("utf-8"))
    except (OSError, ValueError, GuardError) as exc:
        raise GuardError("cannot read JSON input: {}".format(path)) from exc
    finally:
        if fd is not None:
            os.close(fd)


def _contained_file(path, root):
    if not isinstance(path, (str, os.PathLike)) or not isinstance(root, (str, os.PathLike)):
        raise GuardError("evidence/input path must be a filesystem path")
    if Path(path).is_symlink():
        raise GuardError("evidence/input path cannot be a symlink")
    candidate = Path(path).resolve(strict=True)
    base = Path(root).resolve(strict=True)
    if not candidate.is_file() or not candidate.is_relative_to(base):
        raise GuardError("evidence/input path is not a file under its declared root")
    return candidate


def _check_cli_contract(plan):
    if not isinstance(plan, dict):
        raise GuardError("plan must be a JSON object")
    cli = plan.get("cli", {})
    if not isinstance(cli, dict):
        raise GuardError("pinned CLI record must be an object")
    if not isinstance(cli.get("path"), str):
        raise GuardError("pinned CLI path must be a string")
    path = Path(cli.get("path", ""))
    if not path.is_absolute() or not path.is_file() or not os.access(str(path), os.X_OK):
        raise GuardError("pinned CLI path is missing, non-absolute, or not executable")
    if not re.fullmatch(r"[0-9a-f]{64}", str(cli.get("sha256", ""))) or sha256_file(path) != cli["sha256"]:
        raise GuardError("pinned CLI hash mismatch")
    forced = plan.get("forced_args")
    if forced != ["--restricted", "--tools", "", "--strict-mcp-config", "--mcp-config",
                  plan.get("empty_mcp_config"), "--setting-sources", ""]:
        raise GuardError("forced CLI restrictions must disable tools, MCP, and local settings")
    if not isinstance(plan.get("empty_mcp_config"), str) or not Path(plan["empty_mcp_config"]).is_absolute():
        raise GuardError("empty MCP config path must be absolute")
    if not plan.get("diagnostic_only") is True:
        raise GuardError("plan is not marked diagnostic_only")
    start_cap = plan.get("max_cli_starts")
    if type(start_cap) is not int or not 1 <= start_cap <= 6:
        raise GuardError("max_cli_starts must be a plain integer in 1..6")
    empty_config = Path(plan["empty_mcp_config"]).resolve(strict=True)
    config_data = _read_json(empty_config)
    if config_data != {"mcpServers": {}}:
        raise GuardError("pinned MCP config must contain an empty mcpServers object only")
    if sha256_file(empty_config) != plan.get("empty_mcp_sha256"):
        raise GuardError("empty MCP config hash mismatch")
    return path.resolve(strict=True)


def _canonical_forced_args(mcp_path):
    return ["--restricted", "--tools", "", "--strict-mcp-config", "--mcp-config",
            str(Path(mcp_path).resolve(strict=True)), "--setting-sources", ""]


def _model_routing_input_paths(plan):
    declared = plan.get("model_routing_inputs")
    if not isinstance(declared, dict) or set(declared) != {"prompt", "roster"}:
        raise GuardError("plan must declare pinned prompt and roster model-routing inputs")
    result = {}
    for kind in ("prompt", "roster"):
        raw = declared[kind]
        if not isinstance(raw, str):
            raise GuardError("model-routing input paths must be strings")
        try:
            path = Path(raw).resolve(strict=True)
        except OSError as exc:
            raise GuardError("model-routing input is unavailable: {}".format(kind)) from exc
        if not path.is_file():
            raise GuardError("model-routing input is not a regular file: {}".format(kind))
        if kind == "prompt" and path.name != "prompt.md":
            raise GuardError("prompt model-routing input must be named prompt.md")
        result[kind] = str(path)
    if result["prompt"] == result["roster"]:
        raise GuardError("prompt and roster model-routing inputs must be distinct")
    return result


def _validate_input_hash_policy(policy):
    fields = {"version", "max_file_bytes", "max_unique_bytes", "max_unique_files"}
    if not isinstance(policy, dict) or set(policy) != fields:
        raise GuardError("input_hash_policy must declare exactly version and all three limits")
    for field in fields:
        if type(policy[field]) is not int:
            raise GuardError("input_hash_policy {} must be a plain integer".format(field))
    if policy["version"] != 1:
        raise GuardError("unsupported input_hash_policy version")
    if not (1 <= policy["max_file_bytes"] <= HARD_MAX_INPUT_FILE_BYTES):
        raise GuardError("input_hash_policy max_file_bytes exceeds fixed hard ceiling")
    if not (1 <= policy["max_unique_bytes"] <= HARD_MAX_INPUT_TOTAL_BYTES):
        raise GuardError("input_hash_policy max_unique_bytes exceeds fixed hard ceiling")
    if not (1 <= policy["max_unique_files"] <= HARD_MAX_INPUT_FILES):
        raise GuardError("input_hash_policy max_unique_files exceeds fixed hard ceiling")
    return dict(policy)


def _hash_stat_tuple(st):
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def _hash_plan_files(input_refs, evidence_refs, policy):
    """Hash the combined plan-selected file set under one explicit finite budget."""
    policy = _validate_input_hash_policy(policy)
    descriptors = []
    seen_paths = set()
    identities = {}
    identity_paths = {}
    advertised_bytes = 0
    logical_inputs = {}
    logical_evidence = {}
    try:
        for category, refs, logical in (("input", input_refs, logical_inputs),
                                        ("evidence", evidence_refs, logical_evidence)):
            for reference, raw_path in refs:
                try:
                    path = Path(raw_path)
                    if path.is_symlink():
                        raise GuardError("input hashing refuses symlink paths")
                    resolved = path.resolve(strict=True)
                except OSError as exc:
                    raise GuardError("input hashing path is unavailable: {}".format(reference)) from exc
                canonical = str(resolved)
                logical[reference] = canonical
                if canonical in seen_paths:
                    continue
                seen_paths.add(canonical)
                try:
                    path_before = resolved.stat(follow_symlinks=False)
                except (OSError, GuardError) as exc:
                    raise GuardError("input hashing requires a safe regular file: {}".format(reference)) from exc
                if not stat.S_ISREG(path_before.st_mode):
                    raise GuardError("input hashing requires a safe regular file: {}".format(reference))
                identity = (path_before.st_dev, path_before.st_ino)
                if identity in identities:
                    identity_paths[identity][canonical] = _hash_stat_tuple(path_before)
                    continue
                if path_before.st_size > policy["max_file_bytes"]:
                    raise GuardError("input hashing per-file budget exceeded: {}".format(reference))
                if len(identities) + 1 > policy["max_unique_files"]:
                    raise GuardError("input hashing unique-file budget exceeded")
                if advertised_bytes + path_before.st_size > policy["max_unique_bytes"]:
                    raise GuardError("input hashing aggregate budget exceeded")
                try:
                    fd, before = _open_regular_file(resolved, expected=path_before)
                except (OSError, GuardError) as exc:
                    raise GuardError("input hashing requires a safe regular file: {}".format(reference)) from exc
                if _hash_stat_tuple(before) != _hash_stat_tuple(path_before):
                    os.close(fd)
                    raise GuardError("input changed while opening: {}".format(reference))
                identities[identity] = True
                identity_paths[identity] = {canonical: _hash_stat_tuple(before)}
                descriptors.append((category, reference, canonical, fd, before, identity))
                advertised_bytes += before.st_size

        identity_hashes = {}
        bytes_read = 0
        for category, reference, canonical, fd, before, identity in descriptors:
            digest = hashlib.sha256()
            count = 0
            remaining = min(policy["max_file_bytes"], policy["max_unique_bytes"] - bytes_read)
            while True:
                chunk = os.read(fd, min(1024 * 1024, remaining - count + 1))
                if not chunk:
                    break
                count += len(chunk)
                if count > remaining:
                    raise GuardError("input hashing byte budget exceeded: {}".format(reference))
                digest.update(chunk)
            after = os.fstat(fd)
            stable_before = _hash_stat_tuple(before)
            if _hash_stat_tuple(after) != stable_before or count != before.st_size:
                raise GuardError("input changed while hashing: {}".format(reference))
            for alias_path, alias_before in identity_paths[identity].items():
                if _hash_stat_tuple(os.stat(alias_path, follow_symlinks=False)) != alias_before:
                    raise GuardError("input alias changed while hashing: {}".format(alias_path))
            bytes_read += count
            identity_hashes[identity] = digest.hexdigest()
        path_hashes = {path: identity_hashes[identity]
                       for identity, paths in identity_paths.items() for path in paths}
        input_paths = set(logical_inputs.values())
        evidence_paths = set(logical_evidence.values())
        input_hashes = {path: path_hashes[path] for path in input_paths}
        evidence_hashes = {path: path_hashes[path] for path in evidence_paths}
        accounting = {
            "unique_file_count": len(descriptors),
            "unique_bytes_read": bytes_read,
            "input_refs": logical_inputs,
            "evidence_refs": logical_evidence,
        }
        return input_hashes, evidence_hashes, accounting
    except OSError as exc:
        raise GuardError("input hashing read failed") from exc
    finally:
        for item in descriptors:
            try:
                os.close(item[3])
            except OSError:
                pass


def _option_value(argv, option):
    try:
        return argv[argv.index(option) + 1]
    except (ValueError, IndexError):
        return None


def prepare(plan_path, job_dir):
    plan_path = Path(plan_path).resolve(strict=True)
    plan = _read_json(plan_path)
    if (not isinstance(plan, dict) or plan.get("schema") != 2
            or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", str(plan.get("job_id", "")))):
        raise GuardError("unsupported plan schema or invalid job_id")
    cli_path = _check_cli_contract(plan)
    if not isinstance(plan.get("evidence_root"), str):
        raise GuardError("evidence_root must be a path string")
    evidence_root = Path(plan["evidence_root"]).resolve(strict=True)
    if evidence_root == Path(evidence_root.anchor):
        raise GuardError("evidence_root cannot be the filesystem root")
    prerequisites = plan.get("prerequisites", {})
    if not isinstance(prerequisites, dict):
        raise GuardError("plan prerequisite evidence is malformed")
    hash_policy = _validate_input_hash_policy(plan.get("input_hash_policy"))
    evidence_refs = {}
    evidence_paths = set()
    evidence_hash_refs = []
    for key in REQUIRED_PREREQUISITES:
        item = prerequisites.get(key)
        if not isinstance(item, dict) or item.get("status") != "verified":
            raise GuardError("required prerequisite is unknown or unverified: {}".format(key))
        evidence_path = _contained_file(item.get("path", ""), evidence_root)
        if evidence_path in evidence_paths:
            raise GuardError("prerequisite evidence files must be distinct")
        evidence_paths.add(evidence_path)
        evidence_hash_refs.append((key, evidence_path))
        evidence_refs[key] = {"path": str(evidence_path), "sha256": item.get("sha256")}
    input_files = plan.get("input_files", [])
    if not isinstance(input_files, list) or any(not isinstance(raw, str) for raw in input_files):
        raise GuardError("plan input_files must be a list of paths")
    input_hash_refs = [("input_files[{}]".format(index), raw)
                       for index, raw in enumerate(input_files)]
    input_hashes, evidence_hashes, hash_accounting = _hash_plan_files(
        input_hash_refs, evidence_hash_refs, hash_policy)
    for key, item in evidence_refs.items():
        if evidence_hashes.get(item["path"]) != item["sha256"]:
            raise GuardError("prerequisite evidence hash mismatch: {}".format(key))
    model_routing_inputs = _model_routing_input_paths(plan)
    if not set(model_routing_inputs.values()).issubset(input_hashes):
        raise GuardError("prompt and roster model-routing files must be declared in input_files")
    guard_path = Path(__file__).resolve()
    target = Path(job_dir).absolute()
    try:
        target.mkdir(mode=0o700, parents=False, exist_ok=False)
    except FileExistsError as exc:
        raise GuardError("job directory already exists; receipts are immutable") from exc
    (target / "bin").mkdir(mode=0o700)
    (target / "work").mkdir(mode=0o700)
    (target / "active-cli").mkdir(mode=0o700)
    receipt = {
        "schema": 2,
        "job_id": plan["job_id"],
        "created_unix": int(time.time()),
        "diagnostic_only": True,
        "status": "prepared_blocked_until_parent_review",
        "max_cli_starts": plan["max_cli_starts"],
        "cli": {"path": str(cli_path), "sha256": sha256_file(cli_path)},
        "forced_args": _canonical_forced_args(plan["empty_mcp_config"]),
        "empty_mcp_config": str(Path(plan["empty_mcp_config"]).resolve()),
        "empty_mcp_sha256": plan["empty_mcp_sha256"],
        "plan_path": str(plan_path),
        "plan_sha256": sha256_file(plan_path),
        "guard_path": str(guard_path),
        "guard_sha256": sha256_file(guard_path),
        "input_hashes": input_hashes,
        "input_hash_policy": hash_policy,
        "input_hash_accounting": hash_accounting,
        "model_routing_inputs": model_routing_inputs,
        "prerequisite_evidence": evidence_refs,
        "receipt_note": "Evidence references are recorded as supplied; this helper does not grant or infer approval.",
    }
    receipt_path = target / "receipt.json"
    fd = os.open(str(receipt_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(receipt, stream, sort_keys=True, separators=(",", ":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(str(receipt_path), 0o400)
    (target / "starts.jsonl").touch(mode=0o600)
    return {"status": receipt["status"], "job_dir": str(target), "receipt_sha256": sha256_file(receipt_path)}


def _verify_receipt_inputs(job_dir):
    job = Path(job_dir).resolve(strict=True)
    receipt = _read_json(job / "receipt.json")
    if not isinstance(receipt, dict) or receipt.get("schema") != 2:
        raise GuardError("unsupported receipt schema")
    cap = receipt.get("max_cli_starts")
    if type(cap) is not int or not 1 <= cap <= 6:
        raise GuardError("receipt CLI start cap must be a plain integer in 1..6")
    if receipt.get("diagnostic_only") is not True:
        raise GuardError("receipt is not diagnostic_only")
    mcp_path = receipt.get("empty_mcp_config")
    if not isinstance(mcp_path, str) or not Path(mcp_path).is_absolute():
        raise GuardError("receipt MCP config path is not absolute")
    expected_forced = ["--restricted", "--tools", "", "--strict-mcp-config", "--mcp-config",
                       mcp_path, "--setting-sources", ""]
    if receipt.get("forced_args") != expected_forced:
        raise GuardError("receipt forced CLI restrictions are not canonical")
    cli = receipt.get("cli")
    if not isinstance(cli, dict) or not isinstance(cli.get("path"), str):
        raise GuardError("receipt pinned CLI record is malformed")
    cli_path = Path(cli["path"])
    if not cli_path.is_absolute() or not cli_path.is_file() or not os.access(str(cli_path), os.X_OK):
        raise GuardError("receipt pinned CLI path is unavailable")
    if not re.fullmatch(r"[0-9a-f]{64}", str(cli.get("sha256", ""))):
        raise GuardError("receipt pinned CLI hash is malformed")
    if sha256_file(receipt["plan_path"]) != receipt["plan_sha256"]:
        raise GuardError("plan hash changed")
    if sha256_file(receipt["guard_path"]) != receipt["guard_sha256"]:
        raise GuardError("guard source hash changed")
    mcp_path = Path(mcp_path)
    if not mcp_path.is_file() or sha256_file(mcp_path) != receipt["empty_mcp_sha256"]:
        raise GuardError("empty MCP config hash changed")
    if _read_json(mcp_path) != {"mcpServers": {}}:
        raise GuardError("pinned MCP config is not empty")
    if sha256_file(cli_path) != cli["sha256"]:
        raise GuardError("pinned CLI hash changed")
    plan = _read_json(receipt["plan_path"])
    if not isinstance(plan, dict) or plan.get("schema") != 2:
        raise GuardError("plan must be a supported JSON object")
    if receipt.get("job_id") != plan.get("job_id"):
        raise GuardError("receipt job identity does not match the pinned plan")
    planned_cli = _check_cli_contract(plan)
    planned_hash_policy = _validate_input_hash_policy(plan.get("input_hash_policy"))
    if (receipt.get("max_cli_starts") != plan.get("max_cli_starts")
            or receipt.get("forced_args") != _canonical_forced_args(plan["empty_mcp_config"])
            or receipt.get("empty_mcp_config") != str(Path(plan["empty_mcp_config"]).resolve())
            or receipt.get("empty_mcp_sha256") != plan.get("empty_mcp_sha256")
            or receipt.get("cli") != {"path": str(planned_cli), "sha256": plan["cli"]["sha256"]}):
        raise GuardError("receipt policy fields do not match the pinned plan")
    planned_input_refs = []
    try:
        planned_input_refs = [("input_files[{}]".format(index), raw)
                              for index, raw in enumerate(plan.get("input_files", []))]
    except (TypeError, OSError) as exc:
        raise GuardError("plan input paths are malformed or unavailable") from exc
    if receipt.get("input_hash_policy") != planned_hash_policy:
        raise GuardError("receipt input hash policy does not match the pinned plan")
    routing_inputs = _model_routing_input_paths(plan)
    if (receipt.get("model_routing_inputs") != routing_inputs
            or not set(routing_inputs.values()).issubset(receipt.get("input_hashes", {}))):
        raise GuardError("receipt model-routing input references do not match pinned inputs")
    planned_evidence = {}
    evidence_hash_refs = []
    prerequisites = plan.get("prerequisites", {})
    if not isinstance(prerequisites, dict):
        raise GuardError("plan prerequisite evidence is malformed")
    evidence_root = Path(plan.get("evidence_root", "")).resolve(strict=True)
    if evidence_root == Path(evidence_root.anchor):
        raise GuardError("evidence_root cannot be the filesystem root")
    evidence_paths = set()
    for key in REQUIRED_PREREQUISITES:
        item = prerequisites.get(key)
        if not isinstance(item, dict) or item.get("status") != "verified":
            raise GuardError("required prerequisite is unknown or unverified: {}".format(key))
        path = _contained_file(item.get("path", ""), evidence_root)
        if path in evidence_paths:
            raise GuardError("prerequisite evidence files must be distinct")
        evidence_paths.add(path)
        evidence_hash_refs.append((key, path))
        planned_evidence[key] = {"path": str(path), "sha256": item.get("sha256")}
    planned_inputs, evidence_hashes, planned_accounting = _hash_plan_files(
        planned_input_refs, evidence_hash_refs, planned_hash_policy)
    for key, item in planned_evidence.items():
        if evidence_hashes.get(item["path"]) != item["sha256"]:
            raise GuardError("prerequisite evidence hash mismatch: {}".format(key))
    if receipt.get("input_hashes") != planned_inputs:
        all_paths = sorted(set(receipt.get("input_hashes", {})) | set(planned_inputs))
        changed_path = next((path for path in all_paths
                             if receipt.get("input_hashes", {}).get(path) != planned_inputs.get(path)),
                            "receipt does not match the pinned plan")
        raise GuardError("input hash changed: {}".format(changed_path))
    if receipt.get("input_hash_accounting") != planned_accounting:
        raise GuardError("receipt input hash accounting does not match pinned files")
    if receipt.get("prerequisite_evidence") != planned_evidence:
        raise GuardError("receipt prerequisite references do not match the pinned plan")
    return receipt


def verify_receipt_inputs(job_dir):
    try:
        return _verify_receipt_inputs(job_dir)
    except GuardError:
        raise
    except (KeyError, TypeError, ValueError, OSError, AttributeError, IndexError) as exc:
        raise GuardError("receipt or plan is malformed or incomplete") from exc


def clean_environment(source):
    blocked = sorted(k for k in source if k.startswith(PROVIDER_PREFIXES + BLOCKED_PREFIXES)
                     or k in BLOCKED_EXACT or k.lower().endswith("_proxy"))
    if blocked:
        raise GuardError("provider environment variables are present: " + ", ".join(blocked))
    selected_model = source.get("ERIS_LLM_MODEL")
    if selected_model is not None and selected_model != "claude-cli:haiku":
        raise GuardError("ERIS_LLM_MODEL must explicitly select claude-cli:haiku")
    return {k: v for k, v in source.items() if k not in STRIP_EXACT and not k.startswith("G3_")}


def _marker_present(job, name):
    """Treat any marker path, including a dangling symlink, as present."""
    try:
        os.lstat(Path(job) / name)
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise GuardError("{} state cannot be inspected safely".format(name)) from exc
    return True


def _stop_present(job):
    return _marker_present(job, "stop.json")


def _assert_job_not_finalized(job):
    with control_lock(job):
        if _stop_present(job):
            raise GuardError("job is stopped")
        if (_marker_present(job, "completion-fence.json")
                or _marker_present(job, "terminal.json")):
            raise GuardError("job completion is already fenced")


def reserve_start(job_dir, argv_sha256=None):
    job = Path(job_dir).resolve(strict=True)
    receipt = verify_receipt_inputs(job)
    verify_review_token(job)
    if argv_sha256 is not None and not re.fullmatch(r"[0-9a-f]{64}", str(argv_sha256)):
        raise GuardError("expected CLI argv digest is invalid")
    ledger = job / "starts.jsonl"
    stale_reason = None
    with control_lock(job):
        if _stop_present(job):
            raise GuardError("job is stopped")
        if _marker_present(job, "completion-fence.json") or _marker_present(job, "terminal.json"):
            raise GuardError("job completion is already fenced")
        stale_reason = _stale_cli_owner_reason(job)
        if stale_reason:
            _write_stop_locked(job, stale_reason, "cli_owner_watch")
        else:
            ledger_fd, _ = _open_regular_file(ledger, flags=os.O_RDWR)
            with os.fdopen(ledger_fd, "r+", encoding="utf-8") as stream:
                try:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError as exc:
                    raise GuardError("CLI start ledger lock is busy") from exc
                if os.fstat(stream.fileno()).st_size > MAX_START_LEDGER_BYTES:
                    raise GuardError("CLI start ledger exceeds size limit")
                stream.seek(0)
                ledger_data = stream.read(MAX_START_LEDGER_BYTES + 1)
                if len(ledger_data) > MAX_START_LEDGER_BYTES:
                    raise GuardError("CLI start ledger exceeds size limit")
                if ledger_data and not ledger_data.endswith("\n"):
                    raise GuardError("CLI start ledger ends with an incomplete record")
                lines = [line for line in ledger_data.splitlines() if line.strip()]
                for index, line in enumerate(lines, start=1):
                    try:
                        row = json.loads(line)
                    except ValueError as exc:
                        raise GuardError("CLI start ledger is malformed; refusing another start") from exc
                    if not isinstance(row, dict) or row.get("n") != index or row.get("kind") != "cli_start":
                        raise GuardError("CLI start ledger sequence is invalid; refusing another start")
                if len(lines) >= receipt["max_cli_starts"]:
                    raise GuardError("CLI call cap reached")
                record = {"n": len(lines) + 1, "time_unix": int(time.time()), "kind": "cli_start"}
                if argv_sha256 is not None:
                    record["argv_sha256"] = argv_sha256
                stream.seek(0, os.SEEK_END)
                stream.write(json.dumps(record, sort_keys=True) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
    if stale_reason:
        try:
            terminate_active_cli_groups(job)
        except GuardError as exc:
            raise GuardError("{}; {}".format(stale_reason, exc)) from exc
        raise GuardError(stale_reason)
    return record["n"]


def _read_cli_start_rows(job):
    ledger = Path(job) / "starts.jsonl"
    try:
        fd, _ = _open_regular_file(ledger)
    except GuardError:
        raise
    except OSError as exc:
        raise GuardError("CLI start ledger cannot be read safely") from exc
    try:
        with os.fdopen(fd, "rb") as stream:
            data = stream.read(MAX_START_LEDGER_BYTES + 1)
    except OSError as exc:
        raise GuardError("CLI start ledger cannot be read safely") from exc
    if len(data) > MAX_START_LEDGER_BYTES:
        raise GuardError("CLI start ledger exceeds size limit")
    if data and not data.endswith(b"\n"):
        raise GuardError("CLI start ledger ends with an incomplete record")
    rows = []
    try:
        for line in data.splitlines():
            if line.strip():
                rows.append(json.loads(line.decode("utf-8")))
    except (UnicodeDecodeError, ValueError) as exc:
        raise GuardError("CLI start ledger is malformed") from exc
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict) or row.get("n") != index or row.get("kind") != "cli_start":
            raise GuardError("CLI start ledger sequence is invalid")
    for row in rows:
        digest = row.get("argv_sha256")
        if digest is not None and not re.fullmatch(r"[0-9a-f]{64}", str(digest)):
            raise GuardError("CLI start ledger argv digest is invalid")
    return rows


def _count_cli_starts(job):
    return len(_read_cli_start_rows(job))


def _record_cli_success(job, number, log_path):
    if (_stop_present(job)
            or _marker_present(job, "completion-fence.json")
            or _marker_present(job, "terminal.json")):
        raise GuardError("job stopped before CLI success could be recorded")
    try:
        with open(log_path, "rb") as stream:
            header = stream.readline(256)
        match = re.fullmatch(rb"start=(\d+) argv_sha256=([0-9a-f]{64})\n", header)
        if not match or int(match.group(1)) != number:
            raise GuardError("CLI diagnostic log header is invalid")
        log_sha = sha256_file(log_path)
    except OSError as exc:
        raise GuardError("cannot verify completed CLI diagnostic log") from exc
    path = Path(job) / "cli-{:02d}-result.json".format(number)
    payload = json.dumps({"start": number, "returncode": 0, "completed_unix": int(time.time()),
                          "cli_log_sha256": log_sha,
                          "argv_sha256": match.group(2).decode("ascii")},
                         sort_keys=True, separators=(",", ":")) + "\n"
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
        os.unlink(temporary)
        temporary = None
        dir_fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError as exc:
        try:
            write_stop(job, "cli_success_record_failure", "claude_cli_result")
        except GuardError:
            pass
        raise GuardError("cannot record completed guarded CLI call") from exc
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def _count_cli_successes(job, starts):
    start_rows = _read_cli_start_rows(job)
    if len(start_rows) != starts:
        raise GuardError("CLI start ledger changed during completion verification")
    completed = 0
    for number in range(1, starts + 1):
        path = Path(job) / "cli-{:02d}-result.json".format(number)
        if not path.exists():
            continue
        record = _read_json(path)
        if (not isinstance(record, dict) or record.get("start") != number
                or type(record.get("returncode")) is not int or record.get("returncode") != 0
                or type(record.get("completed_unix")) is not int
                or not re.fullmatch(r"[0-9a-f]{64}", str(record.get("cli_log_sha256", "")))
                or not re.fullmatch(r"[0-9a-f]{64}", str(record.get("argv_sha256", "")))):
            raise GuardError("guarded CLI success record is invalid")
        cli_log = Path(job) / "cli-{:02d}.log".format(number)
        try:
            if sha256_file(cli_log) != record["cli_log_sha256"]:
                raise GuardError("guarded CLI result does not match its diagnostic log")
            with open(cli_log, "rb") as stream:
                header = stream.readline(256)
        except OSError as exc:
            raise GuardError("guarded CLI diagnostic log cannot be verified") from exc
        match = re.fullmatch(rb"start=(\d+) argv_sha256=([0-9a-f]{64})\n", header)
        if (not match or int(match.group(1)) != number
                or match.group(2).decode("ascii") != record["argv_sha256"]):
            raise GuardError("guarded CLI result does not match its argument record")
        expected_argv_sha = start_rows[number - 1].get("argv_sha256")
        if not expected_argv_sha or record["argv_sha256"] != expected_argv_sha:
            raise GuardError("guarded CLI result does not match its reserved argv digest")
        completed += 1
    return completed


def _cli_completion_gate_issue(job, publish_completion=False):
    try:
        with control_lock(job):
            if _stop_present(job):
                return "job_stopped"
            if _marker_present(job, "completion-fence.json"):
                # Only this gate invocation may create the fence, after all
                # evidence below has passed. A preexisting marker is not proof
                # that the current world satisfied the completion checks.
                return "completion_fence_preexisting"
            receipt = verify_receipt_inputs(job)
            starts = _count_cli_starts(job)
            if starts <= 0:
                return "cli_start_missing"
            if starts > receipt["max_cli_starts"]:
                return "cli_start_cap_exceeded"
            if _count_cli_successes(job, starts) != starts:
                return "cli_completion_incomplete"
            registry = _validate_cli_registry(job)
            with os.scandir(registry) as entries:
                if any(True for _ in entries):
                    return "cli_still_active"
            if publish_completion:
                if _stop_present(job):
                    return "job_stopped"
                _write_completion_fence_locked(job)
            return None
    except GuardError:
        raise
    except OSError as exc:
        raise GuardError("CLI completion evidence could not be read safely") from exc


def verify_job_outcome(job, supervisor_returncode):
    """Accept normal completion only with disk evidence and observed rc=0.

    This is a same-UID consistency check, not attestation. The caller must pass
    the supervisor's independently observed process return code.
    """
    job = Path(job)
    if type(supervisor_returncode) is not int or supervisor_returncode != 0:
        raise GuardError("outcome requires independently observed exact integer supervisor exit code 0")
    if _stop_present(job):
        raise GuardError("failure STOP takes precedence over terminal success")
    fence = _read_json(job / "completion-fence.json")
    if (not isinstance(fence, dict) or fence.get("reason") != "completion_gate_passed"
            or fence.get("source") != "supervisor_completion_gate"):
        raise GuardError("completion fence is missing or invalid")
    terminal = _read_json(job / "terminal.json")
    if (not isinstance(terminal, dict) or terminal.get("reason") != "world_exit"
            or terminal.get("source") != "supervisor"
            or type(terminal.get("world_returncode")) is not int
            or terminal.get("world_returncode") != 0):
        raise GuardError("normal terminal record is missing or invalid")
    receipt = verify_receipt_inputs(job)
    verify_review_token(job)
    candidate = job / "work" / "cand.llm.jsonl"
    try:
        candidate_fd, candidate_stat = _open_regular_file(candidate)
        if candidate_stat.st_nlink != 1:
            os.close(candidate_fd)
            raise GuardError("candidate diagnostic log must have exactly one hard link")
        with os.fdopen(candidate_fd, "rb") as stream:
            if not stream.read(1):
                raise GuardError("candidate diagnostic log is empty")
    except GuardError:
        raise
    except OSError as exc:
        raise GuardError("candidate diagnostic log cannot be verified") from exc
    starts = _count_cli_starts(job)
    if starts <= 0 or starts > receipt["max_cli_starts"] or _count_cli_successes(job, starts) != starts:
        raise GuardError("guarded CLI completion evidence is incomplete")
    registry = _validate_cli_registry(job)
    try:
        with os.scandir(registry) as entries:
            if any(True for _ in entries):
                raise GuardError("CLI ownership registry is not empty")
    except OSError as exc:
        raise GuardError("CLI ownership registry cannot be verified") from exc
    if _stop_present(job):
        raise GuardError("failure STOP takes precedence over terminal success")
    return True


def authorize_for_run(job_dir, reviewed_receipt_sha256):
    try:
        job = Path(job_dir).resolve(strict=True)
    except OSError as exc:
        raise GuardError("job directory is unavailable for parent review") from exc
    receipt_path = job / "receipt.json"
    verify_receipt_inputs(job)
    try:
        actual = sha256_file(receipt_path)
    except OSError as exc:
        raise GuardError("receipt disappeared or became unreadable during authorization") from exc
    if not re.fullmatch(r"[0-9a-f]{64}", str(reviewed_receipt_sha256 or "")) or reviewed_receipt_sha256 != actual:
        raise GuardError("parent review must name the exact prepared receipt SHA-256")
    approval = {"reviewed": True, "receipt_sha256": actual, "time_unix": int(time.time())}
    path = job / "review-token.json"
    fd = None
    temporary = None
    published = False
    try:
        fd, temporary = tempfile.mkstemp(prefix=".review-token-", dir=str(job))
        os.fchmod(fd, 0o400)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            fd = None
            json.dump(approval, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
            published = True
        except FileExistsError:
            verify_review_token(job)
            return actual
        dir_fd = os.open(str(job), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError as exc:
        # Once the no-replace link is visible, the authorization record is
        # published. Directory fsync improves process-crash ordering but is
        # not a hardware durability guarantee; report success only if the
        # published token still verifies against the reviewed receipt.
        if published:
            try:
                verify_review_token(job)
                return actual
            except GuardError:
                pass
        raise GuardError("cannot atomically publish internal parent-review record") from exc
    finally:
        if fd is not None:
            os.close(fd)
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    return actual


def verify_review_token(job_dir):
    job = Path(job_dir)
    try:
        receipt_sha256 = sha256_file(job / "receipt.json")
    except OSError as exc:
        raise GuardError("receipt disappeared or became unreadable during review-token verification") from exc
    try:
        record = _read_json(job / "review-token.json")
    except GuardError as exc:
        raise GuardError("no parent review token; job remains blocked") from exc
    if (not isinstance(record, dict) or record.get("reviewed") is not True
            or record.get("receipt_sha256") != receipt_sha256):
        raise GuardError("parent review token does not match this receipt")
    return True


def stop_reason(line, final=False):
    # Runtime envelopes may contain JSON nested inside an escaped JSON string.
    # Normalize a bounded number of escape layers before matching; retain source logs.
    for _ in range(3):
        line = line.replace(r'\"', '"')
    for name, pattern in STOP_PATTERNS:
        for match in pattern.finditer(line):
            # A chunk ending in a bare numeric code is ambiguous: the next
            # bytes may continue an ID such as 4291. Defer it until a delimiter
            # arrives or the stream/file is known to be complete.
            if name in ("429", "529") and match.end() == len(line) and not final:
                continue
            return name
    return None


def _deferred_numeric_stop_reason(line):
    reason = stop_reason(line, final=True)
    return reason if reason in ("429", "529") and stop_reason(line) is None else None


def _numeric_marker_signature(line):
    reason = _deferred_numeric_stop_reason(line)
    return (reason, line[-32:]) if reason else None


def _numeric_idle_expired(line, started_at, now=None):
    if started_at is None:
        return None
    reason = _deferred_numeric_stop_reason(line)
    now = time.monotonic() if now is None else now
    return reason if reason and now - started_at >= NUMERIC_STOP_IDLE_SECONDS else None


@contextmanager
def control_lock(job):
    path = Path(job) / "control.lock"
    try:
        fd, _ = _open_regular_file(path, flags=os.O_RDWR | os.O_CREAT, mode=0o600)
    except (OSError, GuardError) as exc:
        raise GuardError("cannot open job control lock") from exc
    with os.fdopen(fd, "r+") as stream:
        deadline = time.monotonic() + CONTROL_LOCK_WAIT_SECONDS
        locked = False
        while not locked:
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except BlockingIOError as exc:
                if time.monotonic() >= deadline:
                    raise GuardError("job control lock acquisition timed out") from exc
                time.sleep(0.05)
            except OSError as exc:
                raise GuardError("job control lock acquisition failed") from exc
        try:
            yield
        finally:
            if locked:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def _owner_record_fields(job):
    owner_pid = os.getpid()
    try:
        owner_pgid = os.getpgid(owner_pid)
        owner_sid = os.getsid(owner_pid)
    except ProcessLookupError as exc:
        raise GuardError("cannot identify CLI shim owner process") from exc
    process_start = _process_start_token(owner_pid)
    if process_start is None:
        raise GuardError("cannot establish CLI shim owner start identity")
    now = time.time()
    return {"owner_pid": owner_pid, "owner_pgid": owner_pgid, "owner_sid": owner_sid,
              "owner_process_start": process_start,
              "started_unix": now, "deadline_unix": now + CLI_OWNER_DEADLINE_SECONDS,
              "supervised": (Path(job) / "owned-pgid").is_file(),
              "job_id": _read_json(Path(job) / "receipt.json")["job_id"]}


def _process_start_token(pid):
    """Return the OS-reported process start identity used to detect PID reuse."""
    if type(pid) is not int or pid <= 0:
        raise GuardError("process identity PID is invalid")
    try:
        result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart="], check=False,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
    except subprocess.TimeoutExpired as exc:
        raise GuardError("process start-identity inspection timed out") from exc
    except OSError as exc:
        raise GuardError("cannot inspect process start identity") from exc
    token = " ".join(result.stdout.split())
    if result.returncode != 0 or not token:
        return None
    if len(token) > 128 or "\n" in token:
        raise GuardError("process start identity is malformed")
    return token


def publish_owned_world_group(job, pid):
    path = Path(job) / "owned-pgid"
    try:
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="ascii") as stream:
            stream.write(str(pid) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as exc:
        raise GuardError("cannot pin supervised world process group") from exc


def reserve_cli_registration(job, start_number):
    registry = Path(job) / "active-cli"
    fields = _owner_record_fields(job)
    path = registry / ("pending-{}-{:02d}.json".format(fields["owner_pid"], start_number))
    record = dict(fields, phase="starting", pid=None, pgid=None, start_number=start_number)
    try:
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(record, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as exc:
        raise GuardError("cannot reserve CLI process ownership before spawn") from exc
    return path


def register_cli_group(job, proc, path):
    path = Path(path)
    record = _read_json(path)
    if (not isinstance(record, dict) or record.get("phase") != "starting"
            or record.get("owner_pid") != os.getpid()):
        raise GuardError("pending CLI ownership record is invalid")
    process_start = _process_start_token(proc.pid)
    if process_start is None:
        raise GuardError("cannot establish CLI process start identity")
    record.update({"phase": "registered", "pid": proc.pid, "pgid": proc.pid,
                   "process_start": process_start})
    try:
        fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(record, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        dir_fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError as exc:
        raise GuardError("cannot complete owned CLI process-group registration") from exc
    return path


def _stale_cli_owner_reason(job):
    """Return a stop reason when a registered shim owner is gone or expired."""
    registry = Path(job) / "active-cli"
    expected_job_id = _read_json(Path(job) / "receipt.json").get("job_id")
    try:
        registry = _validate_cli_registry(job)
    except GuardError:
        return "cli_registry_invalid"
    paths = sorted(registry.glob("*.json"))
    if not paths:
        return None
    try:
        fd, _ = _open_regular_file(Path(job) / "owned-pgid")
        with os.fdopen(fd, "r", encoding="ascii") as stream:
            raw_world_pgid = stream.read(64)
        if len(raw_world_pgid) >= 64:
            raise GuardError("owned world group record is too large")
        expected_world_pgid = int(raw_world_pgid.strip())
    except (OSError, ValueError, GuardError):
        expected_world_pgid = None
    for path in paths:
        try:
            record = _read_json(path)
        except GuardError:
            return "cli_owner_record_invalid"
        if (not isinstance(record, dict) or record.get("job_id") != expected_job_id
                or record.get("phase") not in ("starting", "registered")
                or (record.get("phase") == "starting"
                    and (record.get("pid") is not None or record.get("pgid") is not None))
                or (record.get("phase") == "registered"
                    and (type(record.get("pid")) is not int or record.get("pgid") != record.get("pid")))
                or type(record.get("owner_pid")) is not int
                or type(record.get("owner_pgid")) is not int
                or type(record.get("owner_sid")) is not int
                or not isinstance(record.get("owner_process_start"), str)
                or not record.get("owner_process_start")
                or type(record.get("supervised")) is not bool
                or (record.get("supervised") and expected_world_pgid is None)
                or (expected_world_pgid is not None
                    and record.get("supervised")
                    and (record.get("owner_pgid") != expected_world_pgid
                         or record.get("owner_sid") != expected_world_pgid))
                or type(record.get("deadline_unix")) not in (int, float)):
            return "cli_owner_record_invalid"
        if time.time() >= record["deadline_unix"]:
            return ("cli_registration_incomplete" if record["phase"] == "starting"
                    else "cli_owner_deadline")
        owner_pid = record["owner_pid"]
        try:
            state = _owner_process_state(owner_pid)
        except GuardError:
            return "cli_owner_identity_unknown"
        if state is None or state.startswith("Z"):
            return ("cli_registration_incomplete" if record["phase"] == "starting"
                    else "cli_owner_lost")
        if state == "unknown":
            return "cli_owner_identity_unknown"
        try:
            if (os.getpgid(owner_pid) != record["owner_pgid"]
                    or os.getsid(owner_pid) != record["owner_sid"]):
                return "cli_owner_lost"
        except ProcessLookupError:
            return ("cli_registration_incomplete" if record["phase"] == "starting"
                    else "cli_owner_lost")
        except PermissionError:
            return "cli_owner_identity_unknown"
        try:
            current_start = _process_start_token(owner_pid)
        except GuardError:
            return "cli_owner_identity_unknown"
        if current_start is None:
            return "cli_owner_identity_unknown"
        if current_start != record["owner_process_start"]:
            return "cli_owner_lost"
    return None


def _owner_process_state(pid):
    try:
        result = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], check=False,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
    except subprocess.TimeoutExpired as exc:
        raise GuardError("CLI shim owner inspection timed out") from exc
    except OSError as exc:
        raise GuardError("cannot inspect CLI shim owner state") from exc
    state = result.stdout.strip()
    if result.returncode != 0 or not state:
        return None
    if "\n" in state or not re.fullmatch(r"[A-Za-z+<>-]+", state):
        return "unknown"
    return state.upper()


def _write_stop_locked(job, reason, source):
    path = Path(job) / "stop.json"
    fd = None
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".stop-", dir=str(Path(job)))
    except OSError as exc:
        raise GuardError("cannot stage stop sentinel") from exc
    try:
        os.fchmod(fd, 0o400)
        with os.fdopen(fd, "w", encoding="utf-8") as stop:
            fd = None
            json.dump({"reason": reason, "source": source, "time_unix": int(time.time())}, stop)
            stop.write("\n")
            stop.flush()
            os.fsync(stop.fileno())
        try:
            # Same-directory hard-link creation atomically publishes the full
            # fsynced sentinel without replacing an earlier STOP record.
            os.link(temporary, path)
        except FileExistsError:
            try:
                existing = _read_json(path)
                existing_reason = (existing.get("reason") if isinstance(existing, dict)
                                   and isinstance(existing.get("reason"), str) else None)
            except GuardError:
                existing_reason = None
            try:
                _remove_terminal_for_stop(job)
            except OSError:
                # The STOP link is already authoritative even if a stale
                # terminal cannot be removed; consumers must check STOP first.
                pass
            return existing_reason or "existing_stop_invalid"
        # STOP always takes precedence over terminal success. Readers must
        # check STOP first; removing terminal also repairs a prior crash window.
        try:
            _remove_terminal_for_stop(job)
        except OSError:
            # Keep the published STOP authoritative if rollback cleanup fails.
            pass
        directory_fd = os.open(str(Path(job)), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return reason
    except OSError as exc:
        raise GuardError("cannot atomically publish stop sentinel") from exc
    finally:
        if fd is not None:
            os.close(fd)
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def _write_completion_fence_locked(job):
    """Publish the non-error completion fence separately from failure STOPs."""
    path = Path(job) / "completion-fence.json"
    payload = {"reason": "completion_gate_passed", "source": "supervisor_completion_gate",
               "time_unix": int(time.time())}
    fd = None
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".completion-fence-", dir=str(Path(job)))
        os.fchmod(fd, 0o400)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            fd = None
            json.dump(payload, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            existing = _read_json(path)
            if (not isinstance(existing, dict)
                    or existing.get("reason") != "completion_gate_passed"
                    or existing.get("source") != "supervisor_completion_gate"):
                raise GuardError("existing completion fence is malformed")
            return existing
        directory_fd = os.open(str(Path(job)), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return payload
    except OSError as exc:
        raise GuardError("cannot atomically publish completion fence") from exc
    finally:
        if fd is not None:
            os.close(fd)
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def _validate_cli_registry(job):
    path = Path(job) / "active-cli"
    try:
        info = os.lstat(path)
    except OSError as exc:
        raise GuardError("CLI ownership registry is missing or unavailable") from exc
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        raise GuardError("CLI ownership registry is not an owned real directory")
    return path


def stop_if_cli_owner_stale(job, source="supervisor_owner_watch"):
    """Publish STOP atomically with CLI-start reservation when an owner is stale."""
    with control_lock(job):
        if (_stop_present(job)
                or _marker_present(job, "completion-fence.json")
                or _marker_present(job, "terminal.json")):
            return None
        reason = _stale_cli_owner_reason(job)
        if reason:
            _write_stop_locked(job, reason, source)
        return reason


def unregister_cli_group(job, path):
    with control_lock(job):
        try:
            Path(path).unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise GuardError("cannot remove owned CLI process-group record") from exc


def _remove_cli_group_record(job, path):
    with control_lock(job):
        try:
            Path(path).unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise GuardError("cannot remove stopped CLI process-group record") from exc


def terminate_active_cli_groups(job):
    job = Path(job)
    errors = []
    lock_unavailable = False
    stop_error = None
    try:
        lock = control_lock(job)
        lock.__enter__()
    except (GuardError, OSError):
        # A broken or contended control lock must not prevent an emergency
        # attempt to stop already-registered, exact-session CLI groups. Read
        # records without mutation; retain them because the lock was unavailable.
        lock_unavailable = True
    else:
        try:
            registry = _validate_cli_registry(job)
            paths = sorted(registry.glob("*.json"))
            expected_job_id = _read_json(job / "receipt.json").get("job_id")
        except Exception:
            lock_unavailable = True
        finally:
            lock.__exit__(*sys.exc_info())
    if lock_unavailable:
        try:
            _write_stop_locked(job, "cli_cleanup_lock_unavailable", "supervisor_cli_cleanup")
        except GuardError as exc:
            stop_error = exc
        # STOP prevents new shim starts. Reacquire the lock once after publishing
        # it so an invocation already in Popen/registration can finish and be
        # included in the final bounded snapshot. If unavailable, keep the
        # lock-free snapshot as best effort and report incomplete cleanup.
        try:
            retry_lock = control_lock(job)
            retry_lock.__enter__()
        except (GuardError, OSError):
            retry_lock = None
        registry_snapshot_locked = retry_lock is not None
        if registry_snapshot_locked:
            try:
                registry = _validate_cli_registry(job)
                expected_job_id = _read_json(job / "receipt.json").get("job_id")
                paths = sorted(registry.glob("*.json"))
            except Exception:
                registry_snapshot_locked = False
            finally:
                retry_lock.__exit__(*sys.exc_info())
        if not registry_snapshot_locked:
            try:
                registry = _validate_cli_registry(job)
                expected_job_id = _read_json(job / "receipt.json").get("job_id")
                paths = sorted(registry.glob("*.json"))
            except GuardError as read_error:
                raise GuardError("control lock unavailable and CLI registry cannot be read safely") from read_error
    for path in paths:
        try:
            record = _read_json(path)
        except GuardError as exc:
            if not path.exists():
                continue
            errors.append("{}: {}".format(path.name, exc))
            continue
        if isinstance(record, dict) and record.get("phase") == "starting":
            errors.append("{}: CLI registration incomplete; process-group identity is unknown; record retained"
                          .format(path.name))
            continue
        if (not isinstance(record, dict) or record.get("job_id") != expected_job_id
                or record.get("phase") != "registered"
                or type(record.get("pid")) is not int or record.get("pid") <= 0
                or record.get("pgid") != record.get("pid")
                or not isinstance(record.get("process_start"), str)
                or not record.get("process_start")):
            errors.append("{}: owned CLI process-group record is malformed".format(path.name))
            continue
        try:
            pgid = record["pgid"]
            current_start = _process_start_token(pgid)
            if current_start is not None and current_start != record["process_start"]:
                errors.append("{}: CLI process-group leader PID was reused; record retained".format(path.name))
                continue
            if _live_group_members(pgid):
                _terminate_group(pgid, expected_start=record["process_start"])
                if _live_group_members(pgid):
                    errors.append("{}: live members remain in owned CLI process group {}".format(path.name, pgid))
                    continue
            if lock_unavailable:
                errors.append("{}: group stopped or absent; registry retained because control lock is unavailable"
                              .format(path.name))
            else:
                _remove_cli_group_record(job, path)
        except GuardError as exc:
            errors.append("{}: {}".format(path.name, exc))
    if errors or lock_unavailable or stop_error:
        detail = "; ".join(errors) if errors else "no registered CLI records found"
        prefix = "control lock unavailable; " if lock_unavailable else ""
        if stop_error:
            detail += "; STOP sentinel could not be persisted"
        raise GuardError(prefix + "active CLI cleanup incomplete: " + detail)


def write_stop(job, reason, source):
    with control_lock(job):
        return _write_stop_locked(job, reason, source)


def write_stop_lock_free_fallback(job, reason, source):
    try:
        return write_stop(job, reason, source)
    except (GuardError, OSError):
        try:
            return _write_stop_locked(job, reason, source)
        except (GuardError, OSError) as fallback_error:
            raise GuardError("cannot publish STOP with or without control lock") from fallback_error


def _publish_terminal_success(job, result_status):
    job = Path(job)
    with control_lock(job):
        fence = _read_json(job / "completion-fence.json")
        if (not isinstance(fence, dict) or fence.get("reason") != "completion_gate_passed"
                or fence.get("source") != "supervisor_completion_gate" or result_status != 0
                or _stop_present(job)):
            raise GuardError("completion fence, STOP state, or world exit status is not successful")
        terminal = job / "terminal.json"
        payload = json.dumps({"reason": "world_exit", "source": "supervisor",
                              "time_unix": int(time.time()), "world_returncode": result_status},
                             sort_keys=True, separators=(",", ":")) + "\n"
        temporary = None
        terminal_published = False
        try:
            fd, temporary = tempfile.mkstemp(prefix=".terminal-", dir=str(job))
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.link(temporary, terminal)
            terminal_published = True
            os.unlink(temporary)
            temporary = None
            if _stop_present(job):
                try:
                    os.unlink(terminal)
                except FileNotFoundError:
                    pass
                raise GuardError("failure STOP raced with terminal publication")
            directory_fd = os.open(str(job), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError as exc:
            # A fence without terminal success is never acceptance. Record an
            # explicit failure when possible; if terminal was linked, remove
            # it first so STOP can become authoritative.
            if terminal_published:
                try:
                    _remove_terminal_for_stop(job)
                except OSError:
                    pass
            if terminal_published or not terminal.exists():
                try:
                    _write_stop_locked(job, "terminal_publication_failure", "supervisor_terminal")
                except (GuardError, OSError):
                    pass
            raise GuardError("cannot publish normal supervisor terminal record") from exc
        finally:
            if temporary is not None:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
        return json.loads(payload)


def _remove_terminal_for_stop(job):
    terminal = Path(job) / "terminal.json"
    try:
        os.unlink(terminal)
    except FileNotFoundError:
        return
    directory_fd = os.open(str(Path(job)), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _live_group_members(pgid):
    try:
        result = subprocess.run(["ps", "-axo", "pid=,pgid=,uid=,stat="], check=False,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=2)
    except subprocess.TimeoutExpired as exc:
        raise GuardError("process-group inventory timed out") from exc
    except OSError as exc:
        raise GuardError("cannot inspect owned process group") from exc
    if result.returncode != 0:
        raise GuardError("cannot inspect owned process group")
    found = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) != 4:
            raise GuardError("cannot parse process-group inventory")
        try:
            pid, found_pgid, uid = map(int, fields[:3])
        except ValueError as exc:
            raise GuardError("cannot parse process-group inventory") from exc
        if found_pgid == pgid and not fields[3].startswith("Z"):
            if uid != os.geteuid():
                raise GuardError("owned process group contains a different user")
            try:
                if os.getsid(pid) != pgid:
                    raise GuardError("owned process group identity does not match its session")
                found.append(pid)
            except ProcessLookupError:
                continue
    return found


def _signal_group_members(pgid, members, signum):
    for pid in members:
        try:
            if os.getpgid(pid) == pgid and os.getsid(pid) == pgid:
                os.kill(pid, signum)
        except ProcessLookupError:
            continue
        except PermissionError as exc:
            raise GuardError("cannot signal a live member of the owned process group") from exc


def _terminate_group(pgid, grace=3, leader=None, expected_start=None):
    members = _live_group_members(pgid)
    if not members:
        return
    if expected_start is not None:
        current_start = _process_start_token(pgid)
        if current_start is not None and current_start != expected_start:
            raise GuardError("owned process-group leader identity changed before termination")
    members = _live_group_members(pgid)
    if not members:
        return
    try:
        if expected_start is not None:
            current_start = _process_start_token(pgid)
            if current_start is not None and current_start != expected_start:
                raise GuardError("owned process-group leader identity changed before TERM")
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except PermissionError:
        _signal_group_members(pgid, members, signal.SIGTERM)
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        # Reap the session leader before probing its group. On macOS a live
        # zombie leader can make killpg(..., 0) report EPERM even though every
        # member has already exited.
        if leader is not None:
            leader.poll()
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            if not _live_group_members(pgid):
                return
            break
        time.sleep(0.05)
    try:
        if expected_start is not None:
            current_start = _process_start_token(pgid)
            if current_start is not None and current_start != expected_start:
                raise GuardError("owned process-group leader identity changed before KILL")
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError as exc:
        members = _live_group_members(pgid)
        if not members:
            return
        # Darwin can report EPERM for a group containing a zombie leader even
        # when live descendants remain. Signal only PIDs revalidated as members
        # of this exact owned PGID; never fall back to process-name matching.
        for pid in members:
            try:
                if os.getpgid(pid) == pgid and os.getsid(pid) == pgid:
                    os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                continue
            except PermissionError as member_exc:
                raise GuardError("cannot force-stop a live member of the owned process group") from member_exc
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        if leader is not None:
            leader.poll()
        if not _live_group_members(pgid):
            return
        time.sleep(0.05)
    if _live_group_members(pgid):
        raise GuardError("cannot confirm or force-stop owned process group")


def invoke(job_dir, passed_argv):
    receipt = verify_receipt_inputs(job_dir)
    if not isinstance(passed_argv, list) or any(not isinstance(x, str) for x in passed_argv):
        raise GuardError("CLI arguments must be strings")
    if any(x == "-m" or x.startswith(("--model=", "-m=")) for x in passed_argv):
        raise GuardError("CLI model must use the single canonical --model <value> form")
    if passed_argv.count("--model") != 1:
        raise GuardError("CLI model must be specified exactly once")
    if _option_value(passed_argv, "--model") != "haiku":
        raise GuardError("CLI must explicitly require --model haiku")
    expected_length = 9 + len(DISALLOWED_TOOLS)
    if len(passed_argv) != expected_length:
        raise GuardError("CLI argv does not match the pinned runtime argument contract")
    if (passed_argv[0] != "-p" or not passed_argv[1]
            or passed_argv[2:4] != ["--model", "haiku"]
            or passed_argv[4:6] != ["--permission-mode", "bypassPermissions"]
            or passed_argv[6] != "--append-system-prompt" or not passed_argv[7]
            or passed_argv[8] != "--disallowed-tools"
            or tuple(passed_argv[9:]) != DISALLOWED_TOOLS):
        raise GuardError("CLI argv does not match the pinned runtime argument contract")
    # Rebuild from the validated shape, omitting bypassPermissions because the
    # forced --restricted option intentionally refuses it.
    actual = passed_argv[:4] + passed_argv[6:]
    try:
        env = clean_environment(os.environ)
    except GuardError:
        write_stop(job_dir, "cli_environment_rejected", "claude_cli_environment")
        raise
    command = [receipt["cli"]["path"]] + actual + receipt["forced_args"]
    argv_sha256 = hashlib.sha256("\0".join(command).encode()).hexdigest()
    requested_signal = {"number": None}
    previous_handlers = {}

    def request_stop(signum, _frame):
        requested_signal["number"] = signum

    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            previous_handlers[signum] = signal.signal(signum, request_stop)
    try:
        number = reserve_start(job_dir, argv_sha256=argv_sha256)
    except Exception:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
        raise
    log_path = Path(job_dir) / "cli-{:02d}.log".format(number)
    try:
        log_stream = open(log_path, "xb")
    except OSError as exc:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
        raise GuardError("cannot create unique CLI log") from exc
    with log_stream as log:
        try:
            log.write(("start={} argv_sha256={}\n".format(number, argv_sha256)).encode())
        except OSError as exc:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
            try:
                write_stop(job_dir, "cli_log_failure", "claude_cli_log")
            except GuardError:
                pass
            raise GuardError("cannot write CLI diagnostic log") from exc
        partial = ""
        prelaunch_signal = None
        try:
            with control_lock(job_dir):
                if _stop_present(job_dir):
                    for signum, handler in previous_handlers.items():
                        signal.signal(signum, handler)
                    raise GuardError("job is stopped")
                if (_marker_present(job_dir, "completion-fence.json")
                        or _marker_present(job_dir, "terminal.json")):
                    for signum, handler in previous_handlers.items():
                        signal.signal(signum, handler)
                    raise GuardError("job completion is already fenced")
                if requested_signal["number"] is not None:
                    prelaunch_signal = signal.Signals(requested_signal["number"]).name
                else:
                    try:
                        cli_group_record = reserve_cli_registration(job_dir, number)
                    except GuardError:
                        _write_stop_locked(job_dir, "cli_registration_failure", "claude_cli_registration")
                        for signum, handler in previous_handlers.items():
                            signal.signal(signum, handler)
                        raise
                    try:
                        proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                                stderr=subprocess.STDOUT, env=env,
                                                start_new_session=True, bufsize=0)
                    except Exception as exc:
                        _write_stop_locked(job_dir, "cli_launch_failure", "claude_cli_spawn")
                        try:
                            Path(cli_group_record).unlink()
                        except OSError:
                            pass
                        for signum, handler in previous_handlers.items():
                            signal.signal(signum, handler)
                        raise GuardError("cannot start pinned Claude CLI") from exc
                    try:
                        register_cli_group(job_dir, proc, cli_group_record)
                    except GuardError:
                        try:
                            _write_stop_locked(job_dir, "cli_registration_failure", "claude_cli_registration")
                        except GuardError:
                            pass
                        try:
                            _terminate_group(proc.pid, leader=proc)
                            proc.wait()
                            proc.stdout.close()
                            Path(cli_group_record).unlink()
                        except GuardError:
                            _write_stop_locked(job_dir, "cli_registration_failure", "claude_cli_registration")
                        for signum, handler in previous_handlers.items():
                            signal.signal(signum, handler)
                        raise
        except Exception:
            if "proc" in locals():
                try:
                    _terminate_group(proc.pid, leader=proc)
                    proc.wait(timeout=5)
                    if proc.stdout is not None:
                        proc.stdout.close()
                    if "cli_group_record" in locals():
                        Path(cli_group_record).unlink(missing_ok=True)
                except (GuardError, OSError, subprocess.TimeoutExpired):
                    pass
            try:
                write_stop(job_dir, "cli_control_failure", "claude_cli_control")
            except GuardError:
                pass
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
            raise
        if prelaunch_signal is not None:
            write_stop(job_dir, "cli_" + prelaunch_signal.lower(), "claude_cli_signal")
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
            raise GuardError("CLI shim received a stop signal before process start")
        group_stopped = False
        cleanup_failed = False
        try:
            stdout_eof = False
            cli_leader_exit_seen_at = None
            numeric_pending = None
            while True:
                if requested_signal["number"] is not None:
                    signal_name = signal.Signals(requested_signal["number"]).name
                    write_stop(job_dir, "cli_" + signal_name.lower(), "claude_cli_signal")
                    _terminate_group(proc.pid, leader=proc)
                    group_stopped = True
                    proc.wait()
                    return 78
                if _stop_present(job_dir):
                    _terminate_group(proc.pid, leader=proc)
                    group_stopped = True
                    proc.wait()
                    return 78
                pending_since = numeric_pending[1] if numeric_pending else None
                idle_reason = _numeric_idle_expired(partial, pending_since)
                if idle_reason:
                    write_stop(job_dir, idle_reason, "claude_cli_idle_marker")
                    _terminate_group(proc.pid, leader=proc)
                    group_stopped = True
                    proc.wait()
                    return 78
                ready, _, _ = select.select([] if stdout_eof else [proc.stdout], [], [], 0.2)
                chunk = os.read(proc.stdout.fileno(), 4096) if ready else b""
                if chunk:
                    log.write(chunk)
                    log.flush()
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                    combined_output = partial + chunk.decode("utf-8", "replace")
                    reason = stop_reason(combined_output)
                    partial = combined_output[-512:]
                    signature = _numeric_marker_signature(partial)
                    if signature:
                        if not numeric_pending or numeric_pending[0] != signature:
                            numeric_pending = (signature, time.monotonic())
                    else:
                        numeric_pending = None
                    if reason:
                        write_stop(job_dir, reason, "claude_cli")
                        _terminate_group(proc.pid, leader=proc)
                        group_stopped = True
                        proc.wait()
                        return 78
                elif ready:
                    stdout_eof = True
                    reason = stop_reason(partial, final=True)
                    if reason:
                        write_stop(job_dir, reason, "claude_cli")
                        _terminate_group(proc.pid, leader=proc)
                        group_stopped = True
                        proc.wait()
                        return 78
                if proc.poll() is not None:
                    if cli_leader_exit_seen_at is None:
                        cli_leader_exit_seen_at = time.monotonic()
                    if not group_stopped:
                        _terminate_group(proc.pid, leader=proc)
                        group_stopped = True
                    if (not stdout_eof and
                            time.monotonic() - cli_leader_exit_seen_at >= CLI_STDOUT_EOF_TIMEOUT_SECONDS):
                        write_stop(job_dir, "cli_stdout_eof_timeout", "claude_cli_stdout_drain")
                        return 78
                    if stdout_eof:
                        break
                if stdout_eof:
                    time.sleep(0.05)
            status = proc.wait()
            if status != 0 and not _stop_present(job_dir):
                write_stop(job_dir, "cli_exit_nonzero", "claude_cli")
            elif status == 0:
                log.flush()
                os.fsync(log.fileno())
                _record_cli_success(job_dir, number, log_path)
            return status
        except OSError as exc:
            try:
                write_stop(job_dir, "cli_io_failure", "claude_cli_io")
            except GuardError:
                pass
            raise GuardError("CLI diagnostic I/O failed; retries stopped") from exc
        finally:
            try:
                try:
                    if not group_stopped:
                        try:
                            _terminate_group(proc.pid, leader=proc)
                            group_stopped = True
                        except GuardError:
                            cleanup_failed = True
                            try:
                                write_stop(job_dir, "cli_cleanup_failure", "claude_cli_cleanup")
                            except GuardError:
                                pass
                            raise
                finally:
                    if proc.poll() is None and not cleanup_failed:
                        proc.wait()
                    proc.stdout.close()
            finally:
                try:
                    if group_stopped:
                        unregister_cli_group(job_dir, cli_group_record)
                finally:
                    for signum, handler in previous_handlers.items():
                        signal.signal(signum, handler)


def _scan_work_logs(work_dir, offsets, tails, cursor, final=False, deferred_since=None):
    root = Path(os.path.abspath(work_dir))
    entries = []
    deferred_since = {} if deferred_since is None else deferred_since
    backlogged = 0
    enumeration_race = False
    root_fd = None
    stack = []

    if final:
        final_polls = cursor.get("final_scan_polls", 0) + 1
        cursor["final_scan_polls"] = final_polls
        if final_polls > MAX_FINAL_SCAN_POLLS:
            return "log_scan_unstable_tree", False

    def final_scan_race_result():
        attempts = cursor.get("final_scan_race_attempts", 0) + 1
        cursor["final_scan_race_attempts"] = attempts
        if attempts >= MAX_FINAL_SCAN_ATTEMPTS:
            return "log_scan_unstable_tree", False
        return None, True

    try:
        if not all(getattr(os, name, 0) for name in ("O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK")):
            return "log_scan_unavailable", False
        dir_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK
        root_fd = os.open(root, dir_flags)
        stack.append((Path(), 0, os.fstat(root_fd)))
        visited_entries = 0
        while stack:
            relative_dir, depth, expected_dir = stack.pop()
            dir_fd = os.dup(root_fd)
            try:
                for component in relative_dir.parts:
                    next_fd = os.open(component, dir_flags, dir_fd=dir_fd)
                    os.close(dir_fd)
                    dir_fd = next_fd
                current_dir = os.fstat(dir_fd)
                if (not stat.S_ISDIR(current_dir.st_mode) or current_dir.st_dev != expected_dir.st_dev
                        or current_dir.st_ino != expected_dir.st_ino):
                    return "log_scan_unstable_tree", False
                try:
                    with os.scandir(dir_fd) as iterator:
                        names = []
                        for entry in iterator:
                            if visited_entries + len(names) >= MAX_LOG_TREE_ENTRIES:
                                return "log_scan_structure_overrun", False
                            names.append(entry.name)
                except OSError:
                    return "log_scan_unavailable", False
                for name in names:
                    visited_entries += 1
                    relative = relative_dir / name
                    path = root / relative
                    try:
                        observed = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
                    except FileNotFoundError:
                        # A transiently removed entry will be reconsidered on
                        # the next poll; discard all prior state so inode reuse
                        # cannot make a replacement inherit this cursor.
                        offsets.pop(path, None)
                        tails.pop(path, None)
                        deferred_since.pop(path, None)
                        enumeration_race = True
                        continue
                    except OSError:
                        return "log_scan_unstable_tree", False
                    if stat.S_ISLNK(observed.st_mode):
                        # Any symlink under the runtime output root can hide
                        # output behind an unobserved name or target. Never
                        # infer safety from the link's filename extension.
                        return "log_scan_unsafe_path", False
                    if stat.S_ISDIR(observed.st_mode):
                        if depth >= MAX_LOG_DEPTH:
                            return "log_scan_structure_overrun", False
                        stack.append((relative, depth + 1, observed))
                        continue
                    if not stat.S_ISREG(observed.st_mode) or observed.st_nlink != 1:
                        return "log_scan_unsafe_path", False
                    if Path(name).suffix.lower() not in (".log", ".json", ".jsonl", ".txt"):
                        return "log_scan_unclassified_output", False
                    path = root / relative
                    size = observed.st_size
                    incarnation = _file_incarnation(observed)
                    if incarnation is None:
                        return "log_scan_unavailable", False
                    prior = offsets.get(path)
                    offset = prior[2] if prior else 0
                    if prior and (prior[0] != observed.st_dev or prior[1] != observed.st_ino
                                  or (len(prior) > 3 and prior[3] != incarnation)
                                  or size < offset):
                        offset = 0
                        tails[path] = ""
                        deferred_since.pop(path, None)
                    backlogged += max(0, size - offset)
                    entries.append((path, relative, observed, offset, size))
                    if len(entries) > MAX_LOG_FILES:
                        return "log_scan_structure_overrun", False
            except OSError:
                return "log_scan_unstable_tree", False
            finally:
                os.close(dir_fd)

        if final and enumeration_race:
            return final_scan_race_result()

        active_paths = {entry[0] for entry in entries}
        for cache in (offsets, tails, deferred_since):
            for stale_path in tuple(cache):
                if stale_path not in active_paths:
                    cache.pop(stale_path, None)
        if backlogged > MAX_LOG_BACKLOG:
            return "log_scan_overrun", False
        entries.sort(key=lambda entry: str(entry[1]))
        if not entries:
            cursor["index"] = 0
            cursor["last_file_count"] = 0
            cursor["nonempty_candidate_log_count"] = 0
            if final:
                cursor.pop("final_scan_race_attempts", None)
                cursor.pop("final_scan_polls", None)
            return None, False

        cursor["last_file_count"] = len(entries)
        cursor["nonempty_candidate_log_count"] = sum(
            1 for entry in entries if entry[1] == Path("cand.llm.jsonl") and entry[4] > 0
        )
        start = cursor.get("index", 0) % len(entries)
        ordered = entries[start:] + entries[:start]
        scanned = 0
        more_pending = False
        visited = 0
        read_race = False
        for index, (path, relative, observed, offset, size) in enumerate(ordered):
            remaining = MAX_LOG_READ_PER_POLL - scanned
            read_size = min(max(0, size - offset), LOG_CHUNK_BYTES, remaining)
            directory_fd = None
            file_fd = None
            file_entry_open_started = False
            try:
                directory_fd = os.dup(root_fd)
                for component in relative.parts[:-1]:
                    next_fd = os.open(component, dir_flags, dir_fd=directory_fd)
                    os.close(directory_fd)
                    directory_fd = next_fd
                file_entry_open_started = True
                file_fd, current = _open_regular_file(relative.parts[-1], dir_fd=directory_fd, expected=observed)
                if (current.st_nlink != 1 or _file_incarnation(current) is None
                        or _file_incarnation(current) != _file_incarnation(observed)):
                    raise FileChangedDuringOpen("file incarnation or link count changed after enumeration")
                os.lseek(file_fd, offset, os.SEEK_SET)
                data = os.read(file_fd, read_size)
            except FileNotFoundError:
                if not file_entry_open_started:
                    return "log_scan_unstable_tree", False
                # A file entry removed after enumeration is retried on the next
                # poll; forget its cursor so replacement bytes start at zero.
                offsets.pop(path, None)
                tails.pop(path, None)
                deferred_since.pop(path, None)
                read_race = True
                continue
            except FileChangedDuringOpen:
                offsets.pop(path, None)
                tails.pop(path, None)
                deferred_since.pop(path, None)
                read_race = True
                continue
            except GuardError as exc:
                return "log_scan_unstable_tree", False
            except OSError:
                return "log_scan_unstable_tree", False
            finally:
                if file_fd is not None:
                    os.close(file_fd)
                if directory_fd is not None:
                    os.close(directory_fd)
            next_offset = offset + len(data)
            offsets[path] = (current.st_dev, current.st_ino, next_offset,
                             _file_incarnation(current))
            scanned += len(data)
            more_pending = more_pending or next_offset < size
            text = tails.get(path, "") + data.decode("utf-8", "replace")
            reason = stop_reason(text, final=final and next_offset >= size)
            if not reason:
                candidate = _deferred_numeric_stop_reason(text)
                if candidate:
                    signature = _numeric_marker_signature(text)
                    entry = deferred_since.get(path)
                    if entry is None or entry[0] != signature:
                        entry = (signature, time.monotonic())
                        deferred_since[path] = entry
                    started = entry[1]
                    reason = _numeric_idle_expired(text, started)
                else:
                    deferred_since.pop(path, None)
            tails[path] = text[-512:]
            visited += 1
            if reason:
                cursor["index"] = (start + visited) % len(entries)
                return reason, False
            if scanned >= MAX_LOG_READ_PER_POLL:
                # A final scan must evaluate every file's cached tail even if
                # its byte offset is already at EOF (for example a deferred
                # numeric marker). Any unvisited entry therefore keeps the
                # finalization pending.
                more_pending = more_pending or bool(final and index + 1 < len(ordered))
                more_pending = more_pending or any(row[4] > row[3] for row in ordered[index + 1:])
                break
        cursor["index"] = (start + max(1, visited)) % len(entries)
        if final and read_race:
            return final_scan_race_result()
        if final and not more_pending:
            cursor.pop("final_scan_race_attempts", None)
            cursor.pop("final_scan_polls", None)
        return None, more_pending
    except OSError:
        return "log_scan_unavailable", False
    finally:
        if root_fd is not None:
            os.close(root_fd)


def _cleanup_owned_groups(publish_stop, terminate_cli, terminate_world):
    """Attempt every independently owned process-group cleanup on all exits."""
    try:
        publish_stop()
    finally:
        try:
            terminate_cli()
        finally:
            terminate_world()


@contextmanager
def _restore_handlers_when_lock_fails(job, previous_handlers):
    try:
        with control_lock(job):
            yield
    except BaseException:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
        raise


def supervise(job_dir, command):
    if not command:
        raise GuardError("supervisor requires a world command after --")
    verify_receipt_inputs(job_dir)
    job = Path(job_dir).resolve(strict=True)
    verify_review_token(job)
    _assert_job_not_finalized(job)
    env = clean_environment(os.environ)
    env["PATH"] = str(job / "bin") + os.pathsep + env.get("PATH", "/usr/bin:/bin")
    env["STAGE2_GUARD_JOB"] = str(job)
    env["ERIS_RUN_DIR"] = str(job / "work")
    env["ERIS_LLM_MODEL"] = "claude-cli:haiku"
    shim = Path(__file__).resolve()
    internal_invoke = (
        "import runpy,sys\nmodule=runpy.run_path(sys.argv[1])\n"
        "try:\n    status=module['invoke'](sys.argv[2],sys.argv[3:])\n"
        "except module['GuardError'] as exc:\n"
        "    print('stage2 guard: '+str(exc),file=sys.stderr)\n    raise SystemExit(78)\n"
        "raise SystemExit(status)\n"
    )
    shim_text = '#!/bin/sh\nexec {} -I -c {} {} {} "$@"\n'.format(
        shlex.quote(sys.executable), shlex.quote(internal_invoke),
        shlex.quote(str(shim)), shlex.quote(str(job)))
    shim_path = job / "bin" / "claude"
    try:
        fd = os.open(str(shim_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o500)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(shim_text)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError as exc:
        raise GuardError("supervisor shim already exists; refusing duplicate supervisor") from exc
    except OSError as exc:
        # A filesystem error opening an already-present shim can belong to a
        # competing supervisor. Do not stop the job owned by that process.
        if not os.path.lexists(shim_path):
            write_stop(job, "shim_setup_failure", "supervisor_shim_setup")
        raise GuardError("cannot create unique Claude shim") from exc
    env["ERIS_CLAUDE_BIN"] = str(shim_path)
    try:
        world_log = open(job / "world.log", "xb")
    except OSError as exc:
        raise GuardError("cannot create unique world log") from exc

    requested_signal = {"number": None}
    previous_handlers = {}

    def request_stop(signum, _frame):
        requested_signal["number"] = signum

    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            previous_handlers[signum] = signal.signal(signum, request_stop)

    with world_log as log:
        with _restore_handlers_when_lock_fails(job, previous_handlers):
            if _stop_present(job):
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)
                raise GuardError("job is stopped")
            if (_marker_present(job, "completion-fence.json")
                    or _marker_present(job, "terminal.json")):
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)
                raise GuardError("job completion is already fenced")
            if requested_signal["number"] is not None:
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)
                raise GuardError("supervisor received a stop signal before world start")
            try:
                proc = subprocess.Popen(command, cwd=str(job / "work"), stdin=subprocess.DEVNULL,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                                        start_new_session=True, bufsize=0)
            except Exception as exc:
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)
                try:
                    _write_stop_locked(job, "world_launch_failure", "supervisor_world_spawn")
                except GuardError:
                    pass
                raise GuardError("cannot start supervised world") from exc
            try:
                publish_owned_world_group(job, proc.pid)
            except GuardError:
                try:
                    _write_stop_locked(job, "world_identity_failure", "supervisor_world_registration")
                except GuardError:
                    pass
                try:
                    _terminate_group(proc.pid, leader=proc)
                    proc.wait()
                    proc.stdout.close()
                finally:
                    for signum, handler in previous_handlers.items():
                        signal.signal(signum, handler)
                raise
        offsets = {}
        tails = {}
        deferred_since = {}
        scan_cursor = {"index": 0}
        world_leader_exit_seen_at = None

        def scan_work_logs(final=False):
            return _scan_work_logs(job / "work", offsets, tails, scan_cursor, final=final,
                                   deferred_since=deferred_since)

        stdout_tail = ""
        world_numeric_pending = None
        owned_group_stopped = False
        world_cleanup_failed = False
        completion_gate_passed = False

        def stop_owned_group():
            nonlocal owned_group_stopped, world_cleanup_failed
            try:
                _terminate_group(proc.pid, leader=proc)
                owned_group_stopped = True
            except GuardError:
                world_cleanup_failed = True
                try:
                    write_stop(job, "world_cleanup_failure", "supervisor_cleanup")
                except GuardError:
                    pass
                raise

        try:
            stdout_eof = False
            while True:
                if requested_signal["number"] is not None:
                    signal_name = signal.Signals(requested_signal["number"]).name
                    write_stop(job, "supervisor_" + signal_name.lower(), "supervisor_signal")
                    terminate_active_cli_groups(job)
                    stop_owned_group()
                    proc.wait()
                    raise GuardError("supervisor stopped on {}".format(signal_name))
                if stop_if_cli_owner_stale(job):
                    # The next iteration observes the immutable sentinel and
                    # stops both the separately-sessioned CLI and owned world.
                    continue
                if _stop_present(job):
                    terminate_active_cli_groups(job)
                    stop_owned_group()
                    proc.wait()
                    raise GuardError("owned world process group stopped by diagnostic sentinel")
                pending_since = (world_numeric_pending[1] if world_numeric_pending else None)
                idle_reason = _numeric_idle_expired(stdout_tail, pending_since)
                if idle_reason:
                    write_stop(job, idle_reason, "world_stdout_idle_marker")
                    terminate_active_cli_groups(job)
                    stop_owned_group()
                    proc.wait()
                    raise GuardError("owned world process group stopped on {}".format(idle_reason))
                watched_reason, scan_more = scan_work_logs()
                if watched_reason:
                    write_stop(job, watched_reason, "run_log")
                    continue
                ready, _, _ = select.select([] if stdout_eof else [proc.stdout], [], [], 0.2)
                chunk = os.read(proc.stdout.fileno(), 4096) if ready else b""
                if chunk:
                    log.write(chunk)
                    log.flush()
                    combined_output = stdout_tail + chunk.decode("utf-8", "replace")
                    reason = stop_reason(combined_output)
                    stdout_tail = combined_output[-512:]
                    signature = _numeric_marker_signature(stdout_tail)
                    if signature:
                        if not world_numeric_pending or world_numeric_pending[0] != signature:
                            world_numeric_pending = (signature, time.monotonic())
                    else:
                        world_numeric_pending = None
                    if reason:
                        write_stop(job, reason, "world_stdout")
                        terminate_active_cli_groups(job)
                        stop_owned_group()
                        proc.wait()
                        raise GuardError("owned world process group stopped on {}".format(reason))
                elif ready:
                    stdout_eof = True
                    reason = stop_reason(stdout_tail, final=True)
                    if reason:
                        write_stop(job, reason, "world_stdout")
                        terminate_active_cli_groups(job)
                        stop_owned_group()
                        proc.wait()
                        raise GuardError("owned world process group stopped on {}".format(reason))
                if proc.poll() is not None:
                    if world_leader_exit_seen_at is None:
                        world_leader_exit_seen_at = time.monotonic()
                    if not owned_group_stopped:
                        stop_owned_group()
                    if (not stdout_eof and
                            time.monotonic() - world_leader_exit_seen_at >= WORLD_STDOUT_EOF_TIMEOUT_SECONDS):
                        write_stop(job, "world_stdout_eof_timeout", "supervisor_stdout_drain")
                        terminate_active_cli_groups(job)
                        raise GuardError("world leader exited but a descendant kept stdout open")
                    if stdout_eof:
                        if _stop_present(job):
                            continue
                        final_reason, final_more = scan_work_logs(final=True)
                        if final_reason:
                            write_stop(job, final_reason, "run_log")
                            continue
                        if not final_more:
                            if scan_cursor.get("nonempty_candidate_log_count", 0) <= 0:
                                write_stop(job, "run_candidate_missing", "supervisor_coverage")
                                raise GuardError("diagnostic coverage missing: no nonempty cand.llm.jsonl was observed")
                            if proc.returncode != 0:
                                write_stop(job, "world_exit_nonzero", "supervisor_coverage")
                                raise GuardError("world process exited nonzero")
                            try:
                                completion_issue = _cli_completion_gate_issue(job, publish_completion=True)
                            except (GuardError, OSError) as exc:
                                write_stop_lock_free_fallback(
                                    job, "cli_completion_unverified", "supervisor_coverage")
                                raise GuardError("diagnostic coverage could not be verified") from exc
                            if completion_issue:
                                write_stop_lock_free_fallback(job, completion_issue, "supervisor_coverage")
                                raise GuardError("diagnostic coverage incomplete: {}".format(completion_issue))
                            gate_fence = _read_json(job / "completion-fence.json")
                            if (not isinstance(gate_fence, dict)
                                    or gate_fence.get("reason") != "completion_gate_passed"
                                    or gate_fence.get("source") != "supervisor_completion_gate"
                                    or _stop_present(job)):
                                raise GuardError("job stopped before normal completion")
                            completion_gate_passed = True
                            break
                if stdout_eof:
                    time.sleep(0.05)
            result_status = proc.wait()
        finally:
            try:
                try:
                    _cleanup_owned_groups(
                        lambda: (None if completion_gate_passed or _stop_present(job)
                                 else write_stop_lock_free_fallback(job, "supervisor_error", "supervisor")),
                        lambda: terminate_active_cli_groups(job),
                        lambda: (None if owned_group_stopped else stop_owned_group()),
                    )
                except BaseException:
                    if completion_gate_passed and not _stop_present(job):
                        try:
                            write_stop_lock_free_fallback(
                                job, "supervisor_cleanup_failure", "supervisor_cleanup")
                        except GuardError:
                            pass
                    raise
            finally:
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)
                if proc.poll() is None and not world_cleanup_failed:
                    proc.wait()
                if owned_group_stopped:
                    try:
                        (job / "owned-pgid").unlink()
                    except FileNotFoundError:
                        pass
                proc.stdout.close()
        if not completion_gate_passed:
            raise GuardError("supervisor ended without passing the completion gate")
        try:
            _publish_terminal_success(job, result_status)
            terminal = _read_json(job / "terminal.json")
        except (GuardError, OSError) as exc:
            try:
                write_stop_lock_free_fallback(job, "terminal_publication_failure", "supervisor_terminal")
            except GuardError:
                pass
            raise GuardError("supervisor terminal record cannot be verified") from exc
        if (not isinstance(terminal, dict) or terminal.get("reason") != "world_exit"
                or terminal.get("source") != "supervisor"
                or type(terminal.get("world_returncode")) is not int
                or terminal.get("world_returncode") != 0):
            raise GuardError("supervisor ended without a valid normal terminal record")
        if _stop_present(job):
            raise GuardError("failure STOP takes precedence over terminal success")
        return result_status

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--plan", required=True)
    prep.add_argument("--job-dir", required=True)
    run = sub.add_parser("run")
    run.add_argument("--job", required=True)
    run.add_argument("--reviewed-receipt", required=True,
                     help="exact receipt SHA-256 recorded by the internal parent review")
    run.add_argument("command", nargs=argparse.REMAINDER)
    inv = sub.add_parser("invoke")
    inv.add_argument("--job", required=True)
    inv.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    try:
        if args.action == "prepare":
            print(json.dumps(prepare(args.plan, args.job_dir), sort_keys=True))
            return 0
        command = args.command[1:] if args.command[:1] == ["--"] else args.command
        if args.action == "invoke":
            raise GuardError("Stage 2 direct CLI invoke is disabled; only fake-test internal calls are enabled")
        raise GuardError(
            "Stage 2 runtime launch is disabled; execution identity binding and "
            "an external supervisor-death watchdog are not verified"
        )
    except GuardError as exc:
        print("stage2 guard: {}".format(exc), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main())
