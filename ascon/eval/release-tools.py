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


def check_zip(source, archive, arm):
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError('duplicate ZIP members')
        files = sorted(p for p in source.rglob('*') if p.is_file() or p.is_symlink())
        if not files:
            raise ValueError('empty agent directory')
        for p in files:
            name = 'agents/' + arm + '/' + p.relative_to(source).as_posix()
            if p.is_symlink() or name not in names or z.read(name) != p.read_bytes():
                raise ValueError('missing, symlink or different agent file: ' + name)
        return sorted(names)


def run(cmd, cwd=None, **kwargs):
    return sp.run(cmd, cwd=cwd, check=True, **kwargs)


def stop_group(proc):
    # The group can outlive its leader. Always signal the owned PGID, not just the PID.
    for sig in (signal.SIGTERM, signal.SIGKILL):
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
GMX_LOCAL_DIRS = ('deployments/localhost', 'cache', 'artifacts',
                  'typechain', 'typechain-types')


def seed_build_output(source, target):
    """Seed private outputs, preferring APFS copy-on-write on macOS."""
    if not source.exists():
        return
    target.mkdir(parents=True)
    # Copy contents into the destination, so an unsupported clone can be retried
    # even if cp already copied some files. Never retry unrelated I/O failures.
    paths = [str(source.resolve()) + '/.', str(target)]
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


def link_readonly_children(source, target, local_dirs):
    """Materialize mutable branches and seed existing build outputs.

    TypeChain output names are isolated defensively in both common layouts.
    Non-local deployment networks and large dependencies remain shared links.
    """
    target.mkdir(parents=True, exist_ok=True)
    branches = {name.split('/')[0] for name in local_dirs}
    if source.is_dir():
        for child in source.iterdir():
            if child.name not in branches:
                (target / child.name).symlink_to(child.absolute(), target_is_directory=child.is_dir())
    for branch in sorted(branches):
        nested = tuple(name.split('/', 1)[1] for name in local_dirs
                       if name.startswith(branch + '/'))
        if nested:
            link_readonly_children(source / branch, target / branch, nested)
        elif branch == 'localhost':
            (target / branch).mkdir()
        else:
            seed_build_output(source / branch, target / branch)



def prepare_deployer(tree, main_checkout):
    # Check the entire input set before linking anything. Never inspect .env contents.
    for name in DEPLOY_BUILD_INPUTS:
        if not (main_checkout / name).is_dir():
            raise Blocked('missing build input: ' + name)
    for name in DEPLOY_BUILD_INPUTS:
        target = tree / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if name == 'deployer/vendor/gmx-src':
            link_readonly_children(main_checkout / name, target, GMX_LOCAL_DIRS)
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
        names = check_zip(tree / 'example/agents' / arm, archive, arm)
    except ValueError as e:
        return 'RELEASE_FAIL', str(e)
    for name in names:
        print(name)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    record = dict(arm=arm, commit=full, zip_sha256=digest, scan_result=result, file_list=names)
    with archive.with_suffix('.json').open('x') as f:
        json.dump(record, f, indent=2)
    print(f'ZIP={archive} size={archive.stat().st_size} sha256={digest}', flush=True)
    if scan.returncode or result.get('accept') is not True or result.get('blocks') != 0:
        return 'RELEASE_FAIL', 'submission scan rejected ZIP'
    return 'RELEASE_PASS', 'scan ACCEPT; all agent files byte-identical'


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
