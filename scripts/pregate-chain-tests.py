#!/usr/bin/env python3
"""Run the source-bound G3 Python tests from a disposable exact-commit copy."""
from pathlib import Path, PurePosixPath
import os
import re
import subprocess
import sys
import tarfile
import time

ROOT = Path(__file__).resolve().parents[1]
CHAIN_TESTS = {
    "ascon-notes/league/g3/chain/test_chain.py",
    "ascon-notes/league/g3/chain/test_revision_audit.py",
}
TEMP_ROOTS = tuple(Path(value) for value in ("/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"))
MAX_ARCHIVE_MEMBERS = 50_000
MAX_ARCHIVE_FILE_BYTES = 128 * 1024 * 1024
MAX_ARCHIVE_TOTAL_BYTES = 1024 * 1024 * 1024
class SetupError(ValueError):
    pass


def explicit_directory(environ, name, *, must_exist=True):
    value = environ.get(name)
    if not value:
        raise SetupError(f"{name} missing or empty; explicit value required")
    path = Path(value)
    if not path.is_absolute():
        raise SetupError(f"{name} must be an absolute path")
    try:
        resolved = path.resolve(strict=must_exist)
    except (OSError, RuntimeError):
        raise SetupError(f"{name} does not resolve") from None
    if any(path.is_relative_to(root) or resolved.is_relative_to(root.resolve()) for root in TEMP_ROOTS):
        raise SetupError(f"{name} must not be under a temporary root")
    if must_exist and not resolved.is_dir():
        raise SetupError(f"{name} must be an existing directory")
    return resolved


def git_environment(paths, base=None):
    env = dict(os.environ if base is None else base)
    try:
        count = int(env.get("GIT_CONFIG_COUNT", "0"))
    except ValueError:
        raise SetupError("invalid process-local Git configuration") from None
    if count < 0 or count > 128:
        raise SetupError("invalid process-local Git configuration count")
    for path in paths:
        env[f"GIT_CONFIG_KEY_{count}"] = "safe.directory"
        env[f"GIT_CONFIG_VALUE_{count}"] = str(path)
        count += 1
    env["GIT_CONFIG_COUNT"] = str(count)
    return env


def git_text(directory, *arguments, env=None):
    result = subprocess.run(["git", "-C", str(directory), *arguments],
                            check=False, capture_output=True, text=True, env=env)
    if result.returncode:
        raise SetupError(f"git {arguments[0]} failed for explicit source")
    return result.stdout.strip()


def check_checkout_clean(checkout, env):
    tracked = subprocess.run(["git", "-C", str(checkout), "status", "--porcelain=v1",
                              "--untracked-files=no"], check=False, capture_output=True,
                             text=True, env=env)
    if tracked.returncode or tracked.stdout.strip():
        raise SetupError("tracked files differ from the exact committed candidate")
    untracked = subprocess.run(["git", "-C", str(checkout), "status", "--porcelain=v1",
                                "--untracked-files=all"],
                               check=False, capture_output=True, text=True, env=env)
    if untracked.returncode or untracked.stdout.strip():
        raise SetupError("untracked files differ from the exact committed candidate")


def validate_source(environ, runner_root=ROOT):
    source = explicit_directory(environ, "G3_CHAIN_SOURCE")
    commit = environ.get("G3_CHAIN_SOURCE_COMMIT", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SetupError("G3_CHAIN_SOURCE_COMMIT must be the explicit full lowercase 40-hex commit")
    root = runner_root.resolve()
    git_env = git_environment((source, root))
    source_top = Path(git_text(source, "rev-parse", "--show-toplevel", env=git_env)).resolve()
    if source_top != source or git_text(source, "rev-parse", "HEAD", env=git_env) != commit:
        raise SetupError("G3_CHAIN_SOURCE HEAD/top-level differs from the explicit candidate")

    if Path(git_text(root, "rev-parse", "--show-toplevel", env=git_env)).resolve() != root:
        raise SetupError("Pregate runner root is not the repository top-level")
    if git_text(root, "rev-parse", "HEAD", env=git_env) != commit:
        raise SetupError("Pregate runner root HEAD differs from the explicit candidate")

    for checkout in (source, root):
        checkout_env = git_environment((source, root), base=git_env)
        check_checkout_clean(checkout, checkout_env)
    gitdir = Path(git_text(source, "rev-parse", "--absolute-git-dir", env=git_env)).resolve()
    if not gitdir.is_dir():
        raise SetupError("explicit source git directory is unavailable")
    return source, commit, gitdir


def validate_dependencies(environ):
    dependencies = explicit_directory(environ, "ASCON_PREGATE_NODE_MODULES")
    source = explicit_directory(environ, "G3_CHAIN_SOURCE")
    if dependencies != (source / "node_modules").resolve(strict=True):
        raise SetupError("ASCON_PREGATE_NODE_MODULES must resolve to the explicit source's node_modules")
    return dependencies


def validate_scratch(environ):
    root = explicit_directory(environ, "ASCON_PREGATE_SCRATCH_ROOT")
    source = explicit_directory(environ, "G3_CHAIN_SOURCE")
    if root.is_relative_to(ROOT.resolve()) or root.is_relative_to(source):
        raise SetupError("ASCON_PREGATE_SCRATCH_ROOT must be outside the product and source worktrees")
    scratch_value = environ.get("ASCON_PREGATE_SCRATCH_DIR", "")
    if not scratch_value:
        raise SetupError("ASCON_PREGATE_SCRATCH_DIR missing; owned scratch path required")
    scratch = Path(scratch_value)
    if not scratch.is_absolute():
        raise SetupError("ASCON_PREGATE_SCRATCH_DIR must be absolute")
    try:
        resolved = scratch.resolve(strict=True)
    except (OSError, RuntimeError):
        raise SetupError("ASCON_PREGATE_SCRATCH_DIR does not resolve") from None
    try:
        device = int(environ.get("ASCON_PREGATE_SCRATCH_DEVICE", ""))
        inode = int(environ.get("ASCON_PREGATE_SCRATCH_INODE", ""))
        current = scratch.lstat()
    except (OSError, ValueError):
        raise SetupError("owned scratch identity is missing or invalid") from None
    if (resolved.parent != root or resolved == root or scratch.is_symlink() or not resolved.is_dir() or
            (current.st_dev, current.st_ino) != (device, inode) or current.st_uid != os.getuid()):
        raise SetupError("ASCON_PREGATE_SCRATCH_DIR must be an owned direct child of SCRATCH_ROOT")
    if any(resolved.iterdir()):
        raise SetupError("ASCON_PREGATE_SCRATCH_DIR must be empty before setup")
    return root, resolved


def safe_member_path(root, name):
    if not isinstance(name, str) or "\\" in name:
        raise SetupError("archive contains an unsafe path")
    if any(part in ("", ".", "..") for part in name.split("/")):
        raise SetupError("archive contains an unsafe path")
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        raise SetupError("archive contains an unsafe path")
    destination = root.joinpath(*path.parts)
    if not destination.resolve(strict=False).is_relative_to(root.resolve()):
        raise SetupError("archive path escapes scratch source")
    return destination


def archive_source(source, commit, gitdir, destination, env):
    process = subprocess.Popen(["git", "-C", str(source), "archive", "--format=tar", commit],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    members = total_bytes = 0
    try:
        with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
            for member in archive:
                members += 1
                if members > MAX_ARCHIVE_MEMBERS:
                    raise SetupError("candidate archive exceeds member limit")
                path = safe_member_path(destination, member.name)
                if member.isdir():
                    path.mkdir(parents=True, exist_ok=True, mode=0o700)
                    path.chmod(0o700)
                    continue
                if not member.isfile():
                    raise SetupError("candidate archive contains a non-regular entry")
                if member.size < 0 or member.size > MAX_ARCHIVE_FILE_BYTES:
                    raise SetupError("candidate archive member exceeds size limit")
                total_bytes += member.size
                if total_bytes > MAX_ARCHIVE_TOTAL_BYTES:
                    raise SetupError("candidate archive exceeds total size limit")
                path.parent.mkdir(parents=True, exist_ok=True)
                source_file = archive.extractfile(member)
                if source_file is None:
                    raise SetupError("candidate archive member could not be read")
                with source_file, path.open("xb") as output:
                    remaining = member.size
                    while remaining:
                        chunk = source_file.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise SetupError("candidate archive member was truncated")
                        output.write(chunk)
                        remaining -= len(chunk)
                path.chmod(0o700 if member.mode & 0o111 else 0o600)
        stderr = process.stderr.read().decode(errors="replace")
        if process.wait(timeout=30) != 0:
            raise SetupError("git archive failed: " + stderr[:500])
    except BaseException:
        if process.poll() is None:
            process.kill()
        process.wait()
        raise
    git_pointer = destination / ".git"
    if git_pointer.exists() or git_pointer.is_symlink():
        raise SetupError("candidate archive unexpectedly contains a .git entry")
    git_pointer.write_text(f"gitdir: {gitdir}\n")
    return members, total_bytes


def summarize_python(output):
    total = re.findall(r"^Ran (\d+) tests? in ([0-9.]+)s", output, re.M)
    summary = re.search(r"^OK(?: \((.*)\))?$", output, re.M)
    if not total or not summary:
        raise SetupError("selected chain test did not produce a passing unittest summary")
    count = int(total[-1][0])
    skipped = re.search(r"(?:^|,\s*)skipped=(\d+)(?:,|$)", summary[1] or "")
    if count <= 0 or (skipped and int(skipped[1]) >= count):
        raise SetupError("selected chain test ran zero tests or skipped all tests")
    return count


def run_tests(source_copy, chain_base, files, environ, source):
    env = git_environment((source, source_copy), base=environ)
    env.update(
        G3_CHAIN_SOURCE=str(source_copy),
        G3_CHAIN_SOURCE_COMMIT=environ["G3_CHAIN_SOURCE_COMMIT"],
        G3_CHAIN_BASE=str(chain_base),
        PYTHONDONTWRITEBYTECODE="1",
        TMPDIR=str(chain_base),
        TSX_DISABLE_CACHE="1",
        NODE_COMPILE_CACHE=str(chain_base / "node-compile-cache"),
    )
    for path in files:
        if path not in CHAIN_TESTS:
            raise SetupError("unsupported source-bound chain test: " + path)
        copied_test = source_copy / path
        if not copied_test.is_file() or copied_test.is_symlink():
            raise SetupError("selected test missing from exact source archive: " + path)

    started = time.monotonic()
    total = 0
    outputs = []
    for path in files:
        command = [sys.executable, "-B", str(source_copy / path)]
        result = subprocess.run(command, cwd=chain_base, env=env, check=False,
                                capture_output=True, text=True)
        combined = result.stdout + result.stderr
        outputs.append((command, result.returncode, result.stdout, result.stderr))
        if result.returncode:
            return result.returncode, total, outputs
        try:
            total += summarize_python(combined)
        except SetupError:
            return 1, total, outputs
    return 0, total, outputs, time.monotonic() - started


def main(arguments):
    files = arguments
    if not files or any(path not in CHAIN_TESTS for path in files):
        print("PREGATE_CHAIN_ERROR: unsupported or empty chain test selection", file=sys.stderr)
        return 1
    try:
        source, commit, gitdir = validate_source(os.environ)
        dependencies = validate_dependencies(os.environ)
        _scratch_root, scratch = validate_scratch(os.environ)
        os.umask(0o077)
        source_copy = scratch / "source"
        source_copy.mkdir(mode=0o700)
        git_env = git_environment((source, ROOT))
        members, size = archive_source(source, commit, gitdir, source_copy, git_env)
        if (source_copy / "node_modules").exists() or (source_copy / "node_modules").is_symlink():
            raise SetupError("candidate archive already contains node_modules")
        (source_copy / "node_modules").symlink_to(dependencies, target_is_directory=True)
        chain_base = source_copy / "ascon-notes/league/g3/chain"
        make_view_env = git_environment((source, source_copy))
        make_view_env.update(
            G3_CHAIN_SOURCE=str(source_copy), G3_CHAIN_SOURCE_COMMIT=commit,
            G3_CHAIN_BASE=str(chain_base), PYTHONDONTWRITEBYTECODE="1",
            TMPDIR=str(chain_base), TSX_DISABLE_CACHE="1",
            NODE_COMPILE_CACHE=str(chain_base / "node-compile-cache"),
        )
        maker = subprocess.run([sys.executable, "-B", str(chain_base / "make-view.py")],
                               cwd=chain_base, env=make_view_env, check=False,
                               capture_output=True, text=True)
        print(f"PREGATE_CHAIN_ARCHIVE: members={members} bytes={size} commit={commit}")
        print(maker.stdout, end="")
        print(maker.stderr, end="", file=sys.stderr)
        if maker.returncode:
            return maker.returncode
        test_result = run_tests(source_copy, chain_base, files, os.environ, source)
        if len(test_result) == 3:
            returncode, _total, outputs = test_result
            elapsed = 0.0
        else:
            returncode, _total, outputs, elapsed = test_result
        for command, rc, stdout, stderr in outputs:
            print(f"PREGATE_CHAIN_COMMAND: {command!r} exit={rc}")
            print(stdout, end="")
            print(stderr, end="", file=sys.stderr)
        if returncode:
            return returncode
        print(f"Ran {_total} tests in {elapsed:.2f}s\nOK", file=sys.stderr)
        return 0
    except (OSError, subprocess.SubprocessError, SetupError) as error:
        print(f"PREGATE_CHAIN_ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
