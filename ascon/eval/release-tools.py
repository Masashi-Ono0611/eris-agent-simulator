#!/usr/bin/env python3
"""Local release helpers. No fetch, checkout reuse, recursive deletion or lane state writes."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess as sp
import sys
import tempfile
import time
import zipfile


class Blocked(Exception):
    pass


def validate(args):
    if len(args) != 2 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', args[0]) or args[0] == 'noop' or not re.fullmatch(r'[0-9a-f]{7,40}', args[1]):
        raise Blocked('usage: <arm other than noop> <commit: 7-40 lowercase hex>')
    return args


def safe_location(path):
    path = Path(path).resolve()
    if any(p.startswith(('ascon-wt-', 'lane-', 'chain-', 'state-')) or p == 'ascon-final' for p in path.parts):
        raise Blocked('refusing lane tree or final state location')
    return path


def check_port(port):
    if not 1024 <= port <= 65535 or 8700 <= port <= 8810:
        raise Blocked('port forbidden (lanes reserve 8700-8810)')
    try:
        with socket.socket() as sock:
            sock.bind(('0.0.0.0', port))
    except OSError as e:
        raise Blocked('deploy port unavailable') from e


def ready(log, deployments):
    return 'anvil is still running' in log and deployments.is_file()


def wait_ready(log, deployments, process, timeout):
    deadline = time.monotonic() + timeout
    while True:
        if process.poll() is not None:
            raise Blocked('deploy exited before readiness')
        if ready(log.read_text(errors='replace'), deployments):
            return
        if time.monotonic() >= deadline:
            raise Blocked('deploy readiness timeout (log marker AND deployments.json required)')
        time.sleep(0.2)


def verdict(log, arm, rc):
    lines = log.splitlines()
    failures = [s for s in lines if re.match(r'^(?:\[3/3\] )?FAIL (?:' + re.escape(arm) + r':|self-test:)', s)]
    passes = [s for s in lines if re.match(r'^(?:\[3/3\] )?PASS ' + re.escape(arm) + r':.*\b\d+ included transactions, \d+ reverted\.', s)]
    if failures or rc != 0:
        return 'SELFTEST_FAIL', failures[-1] if failures else 'selftest exited nonzero'
    if len(passes) == 1:
        return 'SELFTEST_PASS', passes[0]
    return 'BLOCKED', 'no unique PASS line with included/reverted counts'


def check_zip(source, archive, arm, full='HEAD'):
    tree = source.parents[2]
    prefixes = ('agents/' + arm + '/', 'agents/lib/', 'agents/runtime/', 'sdk/')
    paths = ['example/' + prefix.rstrip('/') if prefix.startswith('agents/') else 'sdk'
             for prefix in prefixes]
    entries = run(['git', 'ls-tree', '-r', '-z', full, '--', *paths], cwd=tree,
                  capture_output=True).stdout
    expected = {}
    for entry in entries.split(b'\0'):
        if not entry:
            continue
        meta, path = entry.split(b'\t', 1)
        mode, kind, oid = meta.split()
        path = path.decode('utf-8')
        expected[path.removeprefix('example/')] = (mode, kind, path)
    agent_names = {name for name in expected if name.startswith(prefixes[0])}
    if not agent_names:
        raise ValueError('empty agent directory at release commit')
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError('duplicate ZIP members')
        for name in names:
            if name.startswith('/') or any(part in ('.', '..') for part in name.split('/')):
                raise ValueError('invalid ZIP path: ' + name)
            if not name.startswith(prefixes):
                continue  # Bundler also generates root metadata and out/ artifacts.
            if name.endswith('/'):
                if not any(path.startswith(name) for path in expected):
                    raise ValueError('unexpected ZIP directory: ' + name)
                continue
            if name.startswith(prefixes[0]):
                relative = name[len(prefixes[0]):]
                if Path(relative).suffix not in ('.ts', '.md') or any(part.startswith('.') for part in relative.split('/')):
                    raise ValueError('disallowed agent file: ' + name)
            if name not in expected:
                raise ValueError('unexpected ZIP member: ' + name)
            mode, kind, path = expected[name]
            if mode not in (b'100644', b'100755') or kind != b'blob':
                raise ValueError('non-regular release file: ' + name)
            blob = run(['git', 'show', full + ':' + path], cwd=tree, capture_output=True).stdout
            if z.read(name) != blob:
                raise ValueError('different release file: ' + name)
        if not agent_names.issubset(names):
            raise ValueError('missing agent file in ZIP')
        return sorted(names)


def run(cmd, cwd=None, **kwargs):
    return sp.run(cmd, cwd=cwd, check=True, **kwargs)


def stop_group(proc):
    # A reaped leader no longer proves PGID ownership; it may have been reused.
    for sig in (signal.SIGTERM, signal.SIGKILL):
        if proc.poll() is not None:
            break
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            break
        if sig == signal.SIGTERM:
            time.sleep(2)
    proc.wait()


def containers(arm):
    return run(['docker', 'ps', '-aq', '--filter', 'name=^eris-(' + arm + '|noop)$'], capture_output=True, text=True, timeout=15).stdout.split()


def cleanup_containers(arm, tree):
    # Names alone are NOT ownership: only remove containers mounted from our unique tree.
    for cid in containers(arm):
        info = json.loads(run(['docker', 'inspect', cid], capture_output=True, text=True, timeout=15).stdout)[0]
        if any(Path(m.get('Source', '/')).is_relative_to(tree) for m in info.get('Mounts', [])):
            run(['docker', 'rm', '-f', cid], stdout=sp.DEVNULL, timeout=30)
    for cid in containers(arm):
        info = json.loads(run(['docker', 'inspect', cid], capture_output=True, text=True, timeout=15).stdout)[0]
        if any(Path(m.get('Source', '/')).is_relative_to(tree) for m in info.get('Mounts', [])):
            raise Blocked('owned container survived cleanup')


DEPLOY_BUILD_INPUTS = (
    'deployer/node_modules', 'deployer/out', 'deployer/cache',
    'deployer/vendor/aave/node_modules',
    'deployer/vendor/gmx-src', 'deployer/vendor/liquity-src',
)
# Both hardhat deploy invocations compile by default. Aave uses external
# prebuilt artifacts but still owns its local Hardhat cache/artifact outputs.
# Liquity only reads packages/contracts/out; no build is invoked by deploy.
DEPLOY_LOCAL_DIRS = (
    'deployer/deployments', 'deployer/vendor/aave/deployments',
)


def seed_build_output(source, target):
    """Seed a private file or directory, preferring APFS copy-on-write on macOS."""
    if not source.exists():
        return
    if source.is_dir():
        target.mkdir(parents=True)
        paths = [str(source.resolve()) + '/.', str(target)]
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        paths = [str(source.resolve()), str(target)]
    # Copy contents into the destination, so an unsupported clone can be retried
    # even if cp already copied some files. Never retry unrelated I/O failures.
    if sys.platform == 'darwin':
        result = sp.run(['cp', '-cR', *paths], capture_output=True, text=True,
                        env=dict(os.environ, LC_ALL='C'))
        if result.returncode == 0:
            print(f'SEED cp -cR: {source} -> {target}', flush=True)
            return
        errors = [line for line in result.stderr.splitlines() if line.strip()]
        if not errors or not all('not supported' in line.lower() for line in errors):
            raise sp.CalledProcessError(result.returncode, result.args,
                                        result.stdout, result.stderr)
        reason = 'clone unsupported'
    else:
        reason = 'clone unsupported on this platform'
    run(['cp', '-R', *paths])
    print(f'SEED cp -R ({reason}): {source} -> {target}', flush=True)


def private_gmx_omitted(relative):
    # Names only: never open credentials, even to classify their contents.
    return (relative.is_relative_to('cache') or
            relative.is_relative_to('deployments/localhost') or
            any(part.lower() in {'.git', '.npmrc', '.yarnrc.yml', '.netrc',
                                 '.pypirc', '.git-credentials', '.ssh', '.aws',
                                 '.kube', '.docker', '.config', '.codex', '.claude.json',
                                 'auth.json', 'id_rsa', 'id_ed25519'} or
                part.lower().startswith(('.env', '.dev.vars')) or
                part.lower().endswith(('.pem', '.key', '.p12', '.pfx', '.keystore')) or
                re.search(r'credential|secret|service[-_]?account|private[-_]?key|mnemonic', part, re.I)
                for part in relative.parts))


def prepare_private_gmx(source, target):
    """Clone project modules so Node's realpath/__dirname stays in the fresh tree.

    Plan before copying: prune credentials without reading them, reject escaping
    links, and rebase internal links. Clean subtrees use one recursive APFS clone.
    node_modules is the sole shared link; never traverse it.
    """
    source = source.resolve()

    def plan(relative):
        entry = source / relative
        if private_gmx_omitted(relative):
            return [], False
        if relative == Path('node_modules'):
            return [('dependencies', relative, None)], False
        if entry.is_symlink():
            try:
                resolved = entry.resolve(strict=True)
            except (OSError, RuntimeError) as e:
                raise Blocked('invalid GMX symlink: ' + str(relative)) from e
            if not resolved.is_relative_to(source):
                raise Blocked('escaping GMX symlink: ' + str(relative))
            destination = resolved.relative_to(source)
            if private_gmx_omitted(destination) or destination.is_relative_to('node_modules'):
                raise Blocked('GMX symlink targets omitted/shared path: ' + str(relative))
            return [('link', relative, destination)], False
        if entry.is_dir():
            children = [plan(relative / child.name) for child in entry.iterdir()]
            if all(clean for _, clean in children):
                return [('copy', relative, None)], True
            return ([('mkdir', relative, None)] +
                    [op for ops, _ in children for op in ops]), False
        if not entry.is_file():
            raise Blocked('non-regular GMX input: ' + str(relative))
        return [('copy', relative, None)], True

    operations = [op for entry in source.iterdir()
                  for op in plan(Path(entry.name))[0]]
    target.mkdir(parents=True)
    for kind, relative, destination in operations:
        output = target / relative
        if kind == 'copy':
            seed_build_output(source / relative, output)
        elif kind == 'mkdir':
            output.mkdir(parents=True, exist_ok=True)
        elif kind == 'dependencies':
            output.symlink_to(source / relative, target_is_directory=True)
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.symlink_to(os.path.relpath(target / destination, output.parent))
    # A's cache embeds absolute source paths. Recompile instead of trusting a
    # relocated cache; artifacts/TypeChain remain private clones of the originals.
    (target / 'cache').mkdir()
    (target / 'deployments/localhost').mkdir(parents=True)


def prepare_deployer(tree, main_checkout):
    # Check the entire input set before linking anything. Never inspect .env contents.
    for name in DEPLOY_BUILD_INPUTS:
        if not (main_checkout / name).is_dir():
            raise Blocked('missing build input: ' + name)
    for name in DEPLOY_BUILD_INPUTS:
        target = tree / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if name == 'deployer/vendor/gmx-src':
            prepare_private_gmx(main_checkout / name, target)
        else:
            target.symlink_to((main_checkout / name).resolve(), target_is_directory=True)
    # --keep-fresh and Aave deploy reset these outputs. Never share them.
    for name in DEPLOY_LOCAL_DIRS:
        (tree / name).mkdir(parents=True)
    for name in ('cache', 'artifacts'):
        relative = Path('deployer/vendor/aave') / name
        seed_build_output(main_checkout / relative, tree / relative)
    # config.ts imports dotenv/config. Defaults permit absence, but preserve a configured
    # checkout's MNEMONIC/ADMIN_ADDRESS/etc. Only stat/link: no reading or logging.
    env_file = main_checkout / 'deployer/.env'
    if env_file.is_file():
        (tree / 'deployer/.env').symlink_to(env_file)


def selftest(tree, arm, output, port, timeout):
    procs = []
    deploy_log = output / 'deploy.log'
    test_log = output / 'selftest.log'
    env = dict(os.environ, RPC_URL=f'http://127.0.0.1:{port}', ERIS_RPC_URL=f'http://127.0.0.1:{port}',
               MANAGE_ANVIL='true', ERIS_LOCAL_DEPLOY='1', ERIS_AGENT_BUILD_ALLOW_OVERLAY_MISMATCH='1')
    # Avoid inherited lane/runtime overrides. The fresh tree supplies its own config and state.
    for key in list(env):
        if key.startswith('ERIS_') and key not in ('ERIS_RPC_URL', 'ERIS_LOCAL_DEPLOY', 'ERIS_AGENT_BUILD_ALLOW_OVERLAY_MISMATCH', 'ERIS_DOCKER_MEM'):
            del env[key]
    try:
        check_port(port)
        if containers(arm):
            raise Blocked('selftest container names already in use')
        with deploy_log.open('x') as log:
            proc = sp.Popen(['npm', 'run', 'deploy', '--', '--keep-fresh'], cwd=tree / 'deployer', env=env,
                            stdout=log, stderr=sp.STDOUT, start_new_session=True)
            procs.append(proc)
            wait_ready(deploy_log, tree / 'deployer/deployments/deployments.json', proc, timeout)
            with test_log.open('x') as test:
                generator = sp.Popen(['npm', 'run', 'gen:local-constants'], cwd=tree, env=env,
                                     stdout=test, stderr=sp.STDOUT, start_new_session=True)
                procs.append(generator)
                try:
                    if generator.wait(timeout=120) != 0:
                        raise Blocked('gen:local-constants failed')
                except sp.TimeoutExpired:
                    raise Blocked('gen:local-constants timed out')
                proc = sp.Popen(['npm', 'run', 'agent:selftest', '--', arm], cwd=tree, env=env,
                                stdout=test, stderr=sp.STDOUT, start_new_session=True)
                procs.append(proc)
                try:
                    rc = proc.wait(timeout=3600)
                except sp.TimeoutExpired:
                    raise Blocked('selftest exceeded 3600 seconds')
        return verdict(test_log.read_text(errors='replace'), arm, rc)
    finally:
        for proc in reversed(procs):
            stop_group(proc)
        cleanup_containers(arm, tree)


def bundle(tree, arm, full, output):
    archive = output / ('bundle-' + arm + '.zip')
    if archive.exists():
        raise Blocked('ZIP already exists')
    with (output / 'bundle.log').open('x') as log:
        run(['node', '--import', 'tsx', 'scripts/bundleAgent.ts', arm, '--out', str(archive)], cwd=tree, stdout=log, stderr=sp.STDOUT)
    scan = sp.run(['python3', 'infra/submission/scan-submission.py', str(archive), '--json'], cwd=tree, capture_output=True, text=True)
    (output / 'scan.json').write_text(scan.stdout)
    result = json.loads(scan.stdout)
    try:
        names = check_zip(tree / 'example/agents' / arm, archive, arm, full)
    except ValueError as e:
        return 'RELEASE_FAIL', str(e)
    # scan-submission emits secret matches as WARN messages, not BLOCKs or codes.
    secrets = [f for f in result.get('findings', [])
               if f.get('message') == 'looks like a hardcoded secret/key/token']
    if scan.returncode or result.get('accept') is not True or result.get('blocks') != 0 or secrets:
        return 'RELEASE_FAIL', 'submission scan rejected ZIP or found secret-like content'
    for name in names:
        print(name)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    record = dict(arm=arm, commit=full, zip_sha256=digest, scan_result=result, file_list=names)
    with archive.with_suffix('.json').open('x') as f:
        json.dump(record, f, indent=2)
    print(f'ZIP={archive} size={archive.stat().st_size} sha256={digest}', flush=True)
    return 'RELEASE_PASS', 'scan ACCEPT without secret findings; ZIP sources byte-identical to release commit'


def main(mode, args):
    output = None
    lock = None
    try:
        arm, commit = validate(args)
        safe_location(Path.cwd())
        repo = safe_location(os.environ.get('ASCON_HOME', Path(__file__).resolve().parents[2]))
        base = safe_location(os.environ.get('ASCON_WT_BASE', Path.home() / 'Developer'))
        port = int(os.environ.get('ASCON_SELFTEST_PORT', '8855'))
        timeout = int(os.environ.get('ASCON_DEPLOY_TIMEOUT', '600'))
        if timeout <= 0:
            raise Blocked('timeout must be positive')
        if mode == 'selftest':
            check_port(port)
        full = run(['git', 'rev-parse', '--verify', commit + '^{commit}'], cwd=repo, capture_output=True, text=True).stdout.strip()
        for name in ('node_modules', 'out'):
            if not (repo / name).is_dir():
                raise Blocked('missing dependency directory: ' + name)
        base.mkdir(parents=True, exist_ok=True)
        if mode == 'selftest':
            candidate = base / f'.ascon-selftest-{port}.lock'
            candidate.mkdir()  # never remove somebody else's lock
            lock = candidate
        output = Path(tempfile.mkdtemp(prefix='ascon-' + mode + '-'))
        print(f'LOG_PATH={output} deploy_log={output / "deploy.log"}', flush=True)
        if mode == 'selftest':
            tree = base / ('ascon-selftest-' + full[:8])
        else:
            tree = output / ('ascon-release-' + full[:8])
        if tree.exists() or tree.is_symlink():
            raise Blocked('throwaway tree already exists; retain it for inspection, use a fresh ASCON_WT_BASE')
        run(['git', 'worktree', 'add', '--detach', str(tree), full], cwd=repo, stdout=sp.DEVNULL, stderr=sp.DEVNULL)
        for name in ('node_modules', 'out'):
            (tree / name).symlink_to((repo / name).resolve(), target_is_directory=True)
        if mode == 'selftest':
            common = run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                         cwd=repo, capture_output=True, text=True).stdout.strip()
            prepare_deployer(tree, Path(common).parent)
        if not (tree / 'example/agents' / arm).is_dir():
            raise Blocked('arm absent at release commit')
        marker, detail = selftest(tree, arm, output, port, timeout) if mode == 'selftest' else bundle(tree, arm, full, output)
        print(f'{marker} {detail} log={output}', flush=True)
        return 0 if marker.endswith('_PASS') else 2 if marker == 'BLOCKED' else 1
    except (Blocked, OSError, ValueError, sp.SubprocessError, zipfile.BadZipFile) as e:
        # Never echo subprocess output: deployment logs may contain sensitive values.
        print(f'BLOCKED {type(e).__name__}: {e if isinstance(e, Blocked) else "operation failed; inspect local logs"} log={output or "not-created"}', flush=True)
        return 2
    finally:
        if lock:
            lock.rmdir()


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise Blocked('interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main(sys.argv[1], sys.argv[2:]))
