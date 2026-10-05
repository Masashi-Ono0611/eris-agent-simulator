#!/usr/bin/env python3
"""Offline allocation, durable queue, and process-group supervision. No SSH/RPC."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
GIB = 1024 ** 3
KEYS = set('ID HOST KIND ROUND REGIMES SEEDS ROSTER COMMIT PARALLEL DEADLINE MAX_SECONDS STOP_REVERT SAFETY_AGENTS'.split())
REGIMES = set('calm cex-drift informed-flow whale lending-incident crash depeg vuln spike depeg-persist cdp-incident launch'.split())


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read(path):
    return json.loads(Path(path).read_text())


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def save(path, value):
    """Replace a control file atomically; never rewrite a simulation result."""
    path = Path(path)
    tmp = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    with tmp.open('x') as f:
        json.dump(value, f, indent=2, sort_keys=True)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(str(path.parent), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def identifier(s):
    return isinstance(s, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', s)


def worlds(job):
    return [r + '/' + s for r in job['REGIMES'].split() for s in job['SEEDS'].split()]


def validate(plan):
    require(isinstance(plan, dict) and set(plan) == {'jobs'} and plan['jobs'], 'plan needs jobs only')
    ids, seen, rounds = set(), set(), {}
    for j in plan['jobs']:
        require(set(j) == KEYS and all(isinstance(v, str) for v in j.values()), 'job keys/types invalid')
        require(all(identifier(j[k]) for k in ('ID', 'ROUND')), 'invalid ID/ROUND')
        require(j['HOST'] in ('mini', 'air'), 'HOST must be mini or air')
        require(j['KIND'] in ('smoke', 'diagnostic', 'qualification'), 'invalid KIND')
        require(j['ID'] not in ids, 'duplicate job ID')
        ids.add(j['ID'])
        require(set(j['REGIMES'].split()) <= REGIMES, 'unknown regime')
        require(all(re.fullmatch(r'[1-9][0-9]*', s) for s in j['SEEDS'].split()), 'invalid seed')
        ws = worlds(j)
        require(ws and len(ws) == len(set(ws)), 'empty/duplicate worlds')
        require(not seen.intersection(ws), 'world allocated twice (even with another job ID)')
        seen.update(ws)
        require(j['PARALLEL'] in ('1', '2', '3'), 'parallel must be 1..3')
        require(j['STOP_REVERT'] in ('0', '1'), 'STOP_REVERT must be 0/1')
        require(j['SAFETY_AGENTS'].split() and all(identifier(x) for x in j['SAFETY_AGENTS'].split()), 'safety agent IDs required')
        require(re.fullmatch(r'[0-9a-f]{40}', j['COMMIT']), 'full COMMIT required')
        require(j['DEADLINE'].isdigit() and int(j['DEADLINE']) > 0, 'UTC epoch DEADLINE required')
        require(j['MAX_SECONDS'].isdigit() and 0 < int(j['MAX_SECONDS']) <= 6600, 'chunk limit is 110 minutes')
        p = Path(j['ROSTER'])
        require(not p.is_absolute() and '..' not in p.parts and p.suffix == '.yaml', 'relative YAML roster required')
        if j['KIND'] == 'smoke':
            require(j['REGIMES'] == 'calm' and j['SEEDS'] == ' '.join(str(101+i) for i in range(int(j['PARALLEL']))), 'load-probe seeds must be 101..100+p')
        if j['KIND'] == 'qualification':
            rounds.setdefault(j['ROUND'], []).append(j)
    for js in rounds.values():
        require(len({j['HOST'] for j in js}) == 1, 'qualification all 60 worlds must use ONE host')
        require(len({(j['COMMIT'], j['ROSTER'], j['PARALLEL'], j['DEADLINE']) for j in js}) == 1, 'qualification inputs/deadline differ')
        require(len({j['SEEDS'] for j in js}) == 1 and len(js[0]['SEEDS'].split()) == 5, 'qualification needs same five seeds')
        require(sum(len(worlds(j)) for j in js) == 60 and set().union(*(set(j['REGIMES'].split()) for j in js)) == REGIMES, 'qualification needs all 12 x 5 worlds')
    return plan


def parse_env(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        key, sep, value = line.partition('=')
        require(sep and key in KEYS and key not in result, 'invalid/duplicate env key')
        require(not any(c in value for c in ('\x00', '\r', '$', '`', '"', "'")), 'env values are literal, no quoting/expansion')
        result[key] = value
    return result


def config(q):
    c = read(q / 'config.json')
    plan = validate(read(q / 'plan.json'))
    require(c['plan_sha256'] == digest(plan), 'allocation plan changed')
    require(c['machine'] == socket.gethostname(), 'queue belongs to another physical host')
    return c, plan


class Lock:
    def __init__(self):
        # One fixed lock across all queue directories/worktrees of this login.
        self.path = Path.home() / 'ascon-run' / 'host.lock'

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        token = boot_token()
        if self.path.exists():
            repair = self.path.parent / 'recovery.lock'
            try:
                repair.mkdir()
            except FileExistsError:
                raise ValueError('lock recovery already active; refuse second runner')
            try:
                owner = read(self.path / 'owner.json')
                if owner.get('boot') and owner['boot'] != token:
                    require(not busy(), 'reboot recovery: another matrix/anvil active')
                    archived = self.path.with_name('host.lock.previous-' + str(time.time_ns()))
                    self.path.rename(archived)
            finally:
                repair.rmdir()
        try:
            self.path.mkdir()
        except FileExistsError:
            raise ValueError('host lock exists; second runner refused (stale lock requires inspection)')
        save(self.path / 'owner.json', dict(pid=os.getpid(), machine=socket.gethostname(), started=time.time(), boot=token))
        return self

    def __exit__(self, *args):
        (self.path / 'owner.json').unlink()
        self.path.rmdir()


def boot_token():
    if sys.platform == 'darwin':
        return subprocess.check_output(['sysctl', '-n', 'kern.boottime'], text=True).strip()
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def disk_guard(paths, minimum=25 * GIB):
    for path in paths:
        out = subprocess.check_output(['df', '-Pk', str(path)], text=True)
        fields = out.splitlines()[1].split()
        require(len(fields) >= 4 and fields[3].isdigit(), 'df unreadable')
        require(int(fields[3]) * 1024 >= minimum, 'disk below required free space: ' + str(path))


def busy():
    for cmd in (['pgrep', '-x', 'anvil'], ['pgrep', '-f', r'(^|[ /])run-matrix\.sh([ ]|$)']):
        rc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
        require(rc in (0, 1), 'pgrep failed; exclusive load unknown')
        if rc == 0:
            return True
    return False


def stop(q, reason):
    save(q / 'STOP', dict(reason=reason, at=time.time()))


def guard(q, c, job=None, startup=False):
    require(not (q / 'STOP').exists(), 'STOP latched; inspect status')
    minimum = 25 * GIB
    if startup and job:
        minimum = max(minimum, (20 + 6.5 * int(job['PARALLEL'])) * GIB)
    disk_guard([q, Path(c['repo']), Path(os.environ.get('TMPDIR', '/tmp'))], minimum)
    if job:
        require(time.time() < int(job['DEADLINE']), 'absolute deadline reached')


def state(q, jid, status, **details):
    save(q / 'state' / (jid + '.json'), dict(status=status, **details))


def preflight(c, job):
    repo = c['repo']
    sha = subprocess.check_output(['git', '-C', repo, 'rev-parse', 'HEAD'], text=True).strip()
    require(sha == job['COMMIT'], 'HEAD differs from job COMMIT')
    rc = subprocess.run(['git', '-C', repo, 'diff', '--quiet', 'HEAD', '--', '.', ':!sdk/src/constants.local.ts']).returncode
    require(rc == 0, 'tracked inputs dirty')
    require((Path(repo) / job['ROSTER']).is_file() or job['KIND'] == 'smoke', 'roster missing')


def terminate(proc):
    # Only the child process group we created; never pkill anvil globally.
    # macOS returns EPERM (not ESRCH) when the group holds only an unreaped zombie, so treat it
    # like "already gone" and let proc.wait() reap it.
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass
        if sig == signal.SIGTERM:
            time.sleep(1)
    proc.wait()


def run_job(q, c, job, runner):
    from matrix_worker import observe
    jid = job['ID']
    root = q / 'attempts' / jid
    root.mkdir(exist_ok=True)
    previous = sorted(root.glob('a[0-9]*'))
    for attempt in previous:
        m = read(attempt / 'manifest.json')
        require(m['job_sha256'] == digest(job), 'attempt/job mismatch')
        # Observation is read-only. A receipt lost just before power loss is not a rerun license.
        if runner is None:
            observed, _ = observe(Path(c['repo']), job, m['label'])
            m['finished_worlds'] = sorted(set(m['finished_worlds']) | set(observed))
            save(attempt / 'manifest.json', m)
        if m['finished']:
            require(m['finished_worlds'] == sorted(worlds(job)), 'finished manifest lacks world coverage')
            state(q, jid, 'done', attempt=str(attempt), qualification_accepted=False)
            return
        require(not m['finished_worlds'], 'partial/finished worlds retained; whole-job retry forbidden')
        require(job['KIND'] == 'diagnostic', 'qualification/smoke retry forbidden; report interruption')
        require(m.get('interrupted', False), 'failed attempt is not eligible for automatic retry')
    guard(q, c, job, startup=True)
    if runner is None:
        preflight(c, job)
    if job['KIND'] == 'qualification' and c['host'] == 'mini':
        receipt = read(q / 'mini-g0.json')
        require(receipt['host'] == socket.gethostname() and receipt['commit'] == job['COMMIT'] and receipt['parallel'] == job['PARALLEL'] and receipt['status'] == 'PASS', 'mini OWN G0 smoke required for this commit/parallel')
    attempt = root / ('a%04d' % (len(previous) + 1))
    attempt.mkdir()
    label = 'remote-' + jid + '-' + attempt.name
    m = dict(job_sha256=digest(job), label=label, finished=False, finished_worlds=[], interrupted=True,
             started=time.time(), host=socket.gethostname())
    save(attempt / 'manifest.json', m)
    save(attempt / 'job.json', job)
    state(q, jid, 'running', attempt=str(attempt))
    cmd = ([str(runner)] if runner else [sys.executable, '-B', str(HERE / 'matrix_worker.py')])
    cmd += [c['repo'], str(attempt), label]
    # No shell init or parent strategy overrides/secrets in worker environment.
    env = {k: os.environ[k] for k in ('HOME', 'PATH', 'TMPDIR', 'LANG') if k in os.environ}
    env.update(PYTHONDONTWRITEBYTECODE='1', ERIS_AGENT_FROZEN='1', MIN_FREE_GB='40')
    with (attempt / 'runner.log').open('x') as log:
        proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        try:
            while True:
                guard(q, c, job)
                require(time.time() - m['started'] < int(job['MAX_SECONDS']), 'chunk deadline reached')
                if runner is None:
                    observed, errors = observe(Path(c['repo']), job, label)
                    m['finished_worlds'] = sorted(set(m['finished_worlds']) | set(observed))
                    save(attempt / 'manifest.json', m)
                    require(not errors, '; '.join(errors))
                if proc.poll() is not None:
                    break
                time.sleep(1)
            require(proc.returncode == 0, 'runner exit != 0')
            result = read(attempt / 'result.json')
            m['finished_worlds'] = sorted(set(m['finished_worlds']) | set(result['finished_worlds']))
            save(attempt / 'manifest.json', m)
            require(m['finished_worlds'] == sorted(worlds(job)), 'world coverage mismatch')
            require(result['g0'] == 'PASS', 'G0 not PASS')
            require(type(result['violations']) is int and result['violations'] == 0, 'violations nonzero/missing')
            require(type(result['reverts']) is int and result['reverts'] >= 0, 'reverts invalid/missing')
            require(job['STOP_REVERT'] == '0' or result['reverts'] == 0, 'diagnostic revert > 0')
            require(result['safety'] == 'PASS', 'safety not PASS')
            m.update(finished=True, interrupted=False)
            save(attempt / 'manifest.json', m)
            if job['KIND'] == 'smoke' and c['host'] == 'mini':
                save(q / 'mini-g0.json', dict(host=socket.gethostname(), commit=job['COMMIT'], parallel=job['PARALLEL'], status='PASS', attempt=str(attempt)))
            state(q, jid, 'done', attempt=str(attempt), qualification_accepted=False)
        except BaseException as e:
            terminate(proc)
            m['interrupted'] = isinstance(e, (KeyboardInterrupt, SystemExit))
            save(attempt / 'manifest.json', m)
            state(q, jid, 'failed', reason=str(e), attempt=str(attempt))
            raise


def run_queue(q, once=False, runner=None):
    with Lock():
        c, plan = config(q)
        # Tests may supply a fake executable only to explicitly marked fixture queues.
        require(runner is None or c.get('test_only') is True, 'fake runner only allowed in test-only fixture')
        try:
            while True:
                guard(q, c)
                pending = []
                for job in plan['jobs']:
                    jid = job['ID']
                    f = q / 'jobs' / (jid + '.env')
                    if not f.exists():
                        continue
                    require(job['HOST'] == c['host'] and parse_env(f) == job, 'job allocation/input drift')
                    s = read(q / 'state' / (jid + '.json'))
                    if s['status'] == 'done':
                        m = read(Path(s['attempt']) / 'manifest.json')
                        require(m['finished'] and m['job_sha256'] == digest(job), 'done state/manifest mismatch')
                        continue
                    require(s['status'] in ('queued', 'running'), 'failed job needs manual investigation')
                    pending.append(job)
                if pending:
                    for job in pending:
                        guard(q, c, job)
                    if busy():
                        if once:
                            raise ValueError('another matrix/anvil is active')
                        time.sleep(5)
                        continue
                    run_job(q, c, pending[0], runner)
                elif once:
                    return
                else:
                    time.sleep(5)
        except BaseException as e:
            stop(q, str(e) or 'signal/interrupted')
            raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('init'); s.add_argument('queue', type=Path); s.add_argument('plan', type=Path); s.add_argument('host', choices=['mini', 'air']); s.add_argument('repo', type=Path)
    s = sub.add_parser('enqueue'); s.add_argument('queue', type=Path); s.add_argument('job', type=Path)
    s = sub.add_parser('run'); s.add_argument('queue', type=Path); s.add_argument('--once', action='store_true'); s.add_argument('--fake-runner', type=Path)
    for name in ('status', 'stop'):
        s = sub.add_parser(name); s.add_argument('queue', type=Path)
    a = p.parse_args(); q = a.queue.resolve()
    if a.cmd == 'init':
        plan = validate(read(a.plan))
        require(a.repo.is_dir(), 'repo missing')
        c = dict(repo=str(a.repo.resolve()), host=a.host, machine=socket.gethostname(), plan_sha256=digest(plan))
        # Permanent host allocation registry prevents making a second queue with a divergent plan.
        with Lock():
            registry = Path.home() / 'ascon-run' / 'allocation.json'
            if registry.exists():
                require(read(registry) == dict(queue=str(q), **c), 'host already assigned another queue/plan; no automatic reassignment')
            else:
                save(registry, dict(queue=str(q), **c))
            q.mkdir(parents=True, exist_ok=True)
            if (q / 'config.json').exists():
                require(read(q / 'config.json') == c and read(q / 'plan.json') == plan, 'queue already initialized differently')
            else:
                save(q / 'plan.json', plan); save(q / 'config.json', c)
            for name in ('jobs', 'state', 'attempts'):
                (q / name).mkdir(exist_ok=True)
    elif a.cmd == 'enqueue':
        c, plan = config(q); j = parse_env(a.job)
        require(j in plan['jobs'] and j['HOST'] == c['host'], 'job not assigned to this host')
        path = q / 'jobs' / (j['ID'] + '.env')
        # Enqueue lock is separate: publication is jobs/env last, after durable queued state.
        lock = q / '.enqueue.lock'; lock.mkdir()
        try:
            require(not path.exists() and not (q / 'state' / (j['ID'] + '.json')).exists(), 'job already enqueued; never reset state')
            state(q, j['ID'], 'queued')
            tmp = q / (j['ID'] + '.pending')
            with tmp.open('x') as f:
                f.write(''.join(k + '=' + j[k] + '\n' for k in sorted(j)))
                f.flush(); os.fsync(f.fileno())
            os.replace(tmp, path)
        finally:
            lock.rmdir()
    elif a.cmd == 'run':
        run_queue(q, a.once, a.fake_runner)
    elif a.cmd == 'stop':
        stop(q, 'operator stop')
    else:
        c, _ = config(q)
        print(json.dumps(c, ensure_ascii=False))
        for f in sorted((q / 'state').glob('*.json')):
            print(f.stem, json.dumps(read(f), ensure_ascii=False))
        for f in (q / 'STOP', Path.home() / 'ascon-run/host.lock/owner.json'):
            if f.exists():
                print(f.name, json.dumps(read(f), ensure_ascii=False))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit('SIGTERM'))
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(2)
