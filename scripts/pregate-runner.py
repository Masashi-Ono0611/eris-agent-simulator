#!/usr/bin/env python3
"""Run pregate's selected existing Node/tsx and unittest files without dropping lanes."""
from pathlib import Path
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEST_TIMEOUT_SECONDS = 300
MAX_TEST_TIMEOUT_SECONDS = 1800
CHAIN_TEST_FILES = {
    "ascon-notes/league/g3/chain/test_chain.py",
    "ascon-notes/league/g3/chain/test_revision_audit.py",
}
TEMP_ROOTS = tuple(Path(value) for value in ("/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"))


def configured_timeout(raw=None):
    if raw is None:
        raw = os.environ.get("PREGATE_TEST_TIMEOUT_SECONDS", str(DEFAULT_TEST_TIMEOUT_SECONDS))
    if not re.fullmatch(r"[0-9]+", raw):
        raise ValueError("PREGATE_TEST_TIMEOUT_SECONDS must be a positive integer")
    timeout = int(raw)
    if not 1 <= timeout <= MAX_TEST_TIMEOUT_SECONDS:
        raise ValueError(f"PREGATE_TEST_TIMEOUT_SECONDS must be between 1 and {MAX_TEST_TIMEOUT_SECONDS}")
    return timeout


def selected_files(arguments, root):
    groups = {"node": [], "python": []}
    for argument in arguments:
        path = (root / argument).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            raise ValueError(f"Missing or outside-repository test: {argument}")
        relative = str(path.relative_to(root.resolve()))
        if re.search(r"\.(?:test|spec)\.[cm]?[jt]s$", path.name):
            groups["node"].append(relative)
        elif path.suffix == ".py" and (path.name.startswith("test_") or path.name.endswith("_test.py")):
            groups["python"].append(relative)
        else:
            raise ValueError(f"Unsupported test file (not silently omitted): {argument}")
    if not any(groups.values()):
        raise ValueError("No selected tests; refusing a zero-run lane")
    return groups


def test_count(output, kind):
    if kind == "node":
        total = re.search(r"^(?:#|ℹ)\s+tests\s+(\d+)\s*$", output, re.M)
        passed = re.search(r"^(?:#|ℹ)\s+pass\s+(\d+)\s*$", output, re.M)
        failed = re.search(r"^(?:#|ℹ)\s+fail\s+(\d+)\s*$", output, re.M)
        if not total or not passed or (int(passed[1]) == 0 and (not failed or int(failed[1]) == 0)):
            raise ValueError("Node runner did not report any executed tests")
        return int(total[1])
    totals = re.findall(r"^Ran (\d+) tests? in ", output, re.M)
    summary = re.search(r"^OK(?: \((.*)\))?$", output, re.M)
    skipped = re.search(r"(?:^|,\s*)skipped=(\d+)(?:,|$)", (summary[1] or "") if summary else "")
    if not totals or int(totals[-1]) == 0 or (skipped and int(skipped[1]) >= int(totals[-1])):
        raise ValueError("Python runner did not report any executed tests")
    return int(totals[-1])


def run_command(command, root, timeout=300, env=None):
    process = None
    interrupted = []
    previous_handlers = {signum: signal.getsignal(signum) for signum in (signal.SIGTERM, signal.SIGINT)}
    # Defer cancellation until the new session has an owned handle. Blocking the
    # OS signal mask here would also block SIGTERM in the executed tests.
    for signum in previous_handlers:
        signal.signal(signum, lambda signum, frame: interrupted.append(signum))
    try:
        process = subprocess.Popen(command, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, start_new_session=True)
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
        if interrupted:
            raise SystemExit(128 + interrupted[0])
        stdout, stderr = process.communicate(timeout=timeout)
        return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    except subprocess.TimeoutExpired:
        # Only this freshly created session is owned by this lane.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired as error:
            # A descendant that escaped the session may retain pipes. Close our
            # handles after reaping the owned child; never claim successful output.
            stdout = error.stdout or b""
            stderr = error.stderr or b""
            stdout = stdout.decode(errors="replace") if isinstance(stdout, bytes) else stdout
            stderr = stderr.decode(errors="replace") if isinstance(stderr, bytes) else stderr
            process.stdout.close()
            process.stderr.close()
            stderr += "\nPREGATE_RUNNER_OUTPUT_INCOMPLETE\n"
        return subprocess.CompletedProcess(command, 124, stdout, stderr + "\nPREGATE_RUNNER_TIMEOUT\n")
    finally:
        # Success, cancellation and exceptions all release this owned session.
        try:
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)


def run_groups(groups, root, timeout=DEFAULT_TEST_TIMEOUT_SECONDS):
    commands = []
    if groups["node"]:
        commands.append(("node", ["node", "--import", "tsx", "--test", *groups["node"]]))
    chain_files = [file for file in groups["python"] if file in CHAIN_TEST_FILES]
    commands.extend(("python", [sys.executable, "-B", file]) for file in groups["python"] if file not in CHAIN_TEST_FILES)
    owned_scratch = []
    setup_failure = 0
    if chain_files:
        try:
            scratch_value = os.environ.get("ASCON_PREGATE_SCRATCH_ROOT")
            if not scratch_value:
                raise ValueError("ASCON_PREGATE_SCRATCH_ROOT missing; explicit existing directory required")
            scratch_root = Path(scratch_value)
            if not scratch_root.is_absolute():
                raise ValueError("ASCON_PREGATE_SCRATCH_ROOT must be absolute")
            scratch_root = scratch_root.resolve(strict=True)
            if not scratch_root.is_dir() or any(scratch_root.is_relative_to(p) for p in TEMP_ROOTS) or \
               any(scratch_root.is_relative_to(p.resolve()) for p in TEMP_ROOTS):
                raise ValueError("ASCON_PREGATE_SCRATCH_ROOT must be an existing directory outside temp roots")
            if scratch_root.is_relative_to(ROOT.resolve()):
                raise ValueError("ASCON_PREGATE_SCRATCH_ROOT must be outside the product worktree")
            scratch_path = Path(tempfile.mkdtemp(prefix="ascon-pregate-", dir=scratch_root))
            stat = scratch_path.lstat()
            owned_scratch.append((scratch_root, scratch_path, stat.st_dev, stat.st_ino))
            helper_env = dict(os.environ)
            helper_env["ASCON_PREGATE_SCRATCH_DIR"] = str(scratch_path)
            helper_env["ASCON_PREGATE_SCRATCH_DEVICE"] = str(stat.st_dev)
            helper_env["ASCON_PREGATE_SCRATCH_INODE"] = str(stat.st_ino)
            commands.insert(0, ("python", [sys.executable, str(root / "scripts/pregate-chain-tests.py"),
                                           *chain_files], helper_env))
        except (OSError, RuntimeError, ValueError) as error:
            print(f"PREGATE_RUNNER_ERROR: ASCON chain scratch setup: {error}", file=sys.stderr)
            setup_failure = 1
    results = []
    total = 0
    failure = setup_failure
    try:
        for entry in commands:
            kind, command = entry[:2]
            env = entry[2] if len(entry) == 3 else None
            try:
                result = run_command(command, root, timeout=timeout, env=env)
            except (OSError, subprocess.TimeoutExpired) as error:
                print(f"PREGATE_RUNNER_ERROR: {command}: {error}", file=sys.stderr)
                failure = 1
                continue
            results.append((command, result))
            if result.returncode:
                failure = 1
            try:
                total += test_count(result.stdout + "\n" + result.stderr, kind)
            except ValueError as error:
                print(f"PREGATE_RUNNER_ERROR: {command}: {error}", file=sys.stderr)
                failure = 1
    finally:
        for scratch_root, scratch_path, device, inode in owned_scratch:
            try:
                current = scratch_path.lstat()
                if scratch_path.is_symlink() or (current.st_dev, current.st_ino) != (device, inode) or \
                   scratch_path.resolve(strict=True).parent != scratch_root:
                    raise OSError("owned scratch path identity changed; preserving it")
                for directory, names, _files in os.walk(scratch_path, topdown=True, followlinks=False):
                    os.chmod(directory, 0o700)
                    for name in names:
                        child = Path(directory) / name
                        if not child.is_symlink():
                            os.chmod(child, 0o700)
                shutil.rmtree(scratch_path)
            except OSError as error:
                print(f"PREGATE_RUNNER_ERROR: owned scratch cleanup failed: {error}", file=sys.stderr)
                failure = 1
    # First summary is the aggregate, so pregate's summary parser counts both runtimes.
    print(f"# tests {total}\n# fail {failure}")
    for command, result in results:
        print(f"PREGATE_COMMAND: {command!r} exit={result.returncode}")
        print(result.stdout, end="")
        print(result.stderr, end="", file=sys.stderr)
    return failure


def main():
    def terminate(signum, frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    try:
        timeout = configured_timeout()
        groups = selected_files(sys.argv[1:], ROOT)
    except ValueError as error:
        print(f"PREGATE_RUNNER_ERROR: {error}", file=sys.stderr)
        return 1
    return run_groups(groups, ROOT, timeout=timeout)


if __name__ == "__main__":
    sys.exit(main())
