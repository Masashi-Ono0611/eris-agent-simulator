import importlib.util
from pathlib import Path
import os
import subprocess
import sys

script, tmp = map(Path, sys.argv[1:3])
spec = importlib.util.spec_from_file_location('eta', script)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def regression(case):
    logs = tmp/'logs'; logs.mkdir()
    chains = tmp/'chains'; chains.mkdir()
    a = chains/'chain-A'
    (a/'pending').mkdir(parents=True); (a/'running').mkdir()
    def run(rid, stem, jobs):
        text = f'QUEUE_START_A run={rid} 2026-10-20T00:00:00Z jobs={len(jobs)} queue=/remote/{stem}.txt\n'
        for job, verdict, duration in jobs:
            text += f'NOTE_{job} run={rid} slot=opus-1 2026-10-20T00:00:00Z\n'
            hours, minutes = divmod(duration, 60)
            text += (f'EXIT_{job}={0 if verdict == "PASS" else 137} VERDICT={verdict} '
                     f'COLLISION=PASS ARM=PASS run={rid} 2026-10-20T{hours:02}:{minutes:02}:00Z\n')
        return text
    text = run('A-night1-01', '01', [('s1-smoke','PASS',1), ('s1-smoke2','PASS',1)])
    text += run('A-final-20', '20', [('s1-first','PASS',156)])
    text += run('A-final-23', '23', [('s1-second','PASS',156), ('s1-killed','FAIL',1),
                                    ('s1-lock','BLOCKED',1), ('s2-short','PASS',1)])
    (logs/'A.queue.log').write_text(text)
    cmd = [sys.executable, str(script), '--logs', str(logs), '--chains', str(chains)]
    if case == 'mean':
        r = subprocess.run(cmd, capture_output=True, text=True)
        assert r.returncode == 0, r.stdout+r.stderr
        assert 'mean_hours=2.60 (measured-proxy; samples=2)' in r.stdout, r.stdout
        assert 'sample_jobs=A-final-20/s1-first,A-final-23/s1-second' in r.stdout, r.stdout
        # Latest family with only one PASS must fall back, not borrow old successes.
        (logs/'A.queue.log').write_text(text + run('A-restart-24', '24', [('s1-new','PASS',156)]))
        r = subprocess.run(cmd, capture_output=True, text=True)
        assert 'mean_hours=2.50 (default; samples=1)' in r.stdout, r.stdout
    else:
        (a/'pending/current.txt').write_text('s1-current r a s\n')
        nxt = chains/'chain-A2'; (nxt/'pending').mkdir(parents=True)
        (nxt/'pending/later.txt').write_text('s1-next r a s\ns1-next2 r a s\n')
        r = subprocess.run(cmd, capture_output=True, text=True)
        assert r.returncode == 0 and 'pending=3' in r.stdout, r.stdout+r.stderr
        assert 'auto-detected' in r.stdout and 'chain-A2' in r.stdout and '\nA2:' not in r.stdout, r.stdout
        extra = tmp/'extra'; (extra/'pending').mkdir(parents=True)
        (extra/'pending/more.txt').write_text('s1-extra r a s\n')
        r = subprocess.run(cmd + ['--next', f'A={nxt}', '--next', f'A={extra}', '--next', f'A={extra}'], capture_output=True, text=True)
        assert r.returncode == 0 and 'pending=4' in r.stdout, r.stdout+r.stderr
        # Explicit queue outside --chains works without automatic detection.
        nxt.rename(tmp/'moved-next')
        r = subprocess.run(cmd + ['--next', f'A={extra}'], capture_output=True, text=True)
        assert r.returncode == 0 and 'pending=2' in r.stdout, r.stdout+r.stderr
        # ETA charges current pending plus following work, with a fixed clock.
        import contextlib
        import io
        output = io.StringIO()
        now = m.timestamp('2026-10-22T00:00:00Z')
        with contextlib.redirect_stdout(output):
            m.report('A', logs, a, 2.5, now, [extra])
        eta = m.datetime.fromtimestamp(now + 2 * 2.6 * 3600).astimezone().isoformat(timespec='seconds')
        assert f'ETA={eta}' in output.getvalue(), output.getvalue()
    print('REGRESSION_OK_' + case)

if len(sys.argv) > 3:
    regression(sys.argv[3])
    sys.exit(0)

logs = tmp/'logs'; logs.mkdir()
chains = tmp/'chains'; chains.mkdir()
a = chains/'chain-A'; (a/'pending').mkdir(parents=True); (a/'running').mkdir()
start = '2026-10-20T00:00:00+00:00'
t0 = m.timestamp(start)
def begin(run, count=3):
    return f'QUEUE_START_A run={run} {start} jobs={count} queue=/remote/running/q.txt\n'
def note(job, run):
    return f'NOTE_{job} run={run} slot=opus-1\n'
def end(job, run, verdict='PASS'):
    return f'EXIT_{job}={0 if verdict == "PASS" else 2} VERDICT={verdict} COLLISION=PASS ARM=PASS run={run}\n'
text = begin('old') + note('s1-j1', 'old') + end('s1-j1', 'old', 'FAIL')*2 + 'STOPPED_A run=old\n'
text += begin('lock') + ''.join(note(j, 'lock') + end(j, 'lock', 'BLOCKED') for j in ('s1-j1','s1-j2','s1-j3'))
text += 'QUEUE_DONE_A run=lock\n' + begin('new')
text += note('s1-j1','new') + end('s1-j1','new') + note('s1-j2','new') + end('s1-j2','new','FAIL') + note('s1-j3','new')
(logs/'A.queue.log').write_text(text)
(logs/'A.chain.log').write_text(f'CHAIN_START_A {start} pid=1\nCHAIN_QUEUE_A file=q.txt run=new\n')
for job, hours in [('s1-j1',2), ('s1-j2',5)]:
    p = logs/(job+'.log'); p.write_text('fixture\n'); os.utime(p, (t0+hours*3600, t0+hours*3600))
(a/'running/q.txt').write_text(''.join(f'{j} r arm s\n' for j in ('s1-j1','s1-j2','s1-j3')))
(a/'pending/next.txt').write_text('s1-j4 r arm s\ns1-j5 r arm s\n')
# Another lane deliberately has earlier timestamps; never subtract across lanes.
(logs/'B.queue.log').write_text(begin('b').replace('START_A','START_B') + note('s1-other','b') + end('s1-other','b'))
def snapshot():
    return {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in tmp.rglob('*') if p.is_file()}
before = snapshot()
r = subprocess.run([sys.executable, str(script), '--logs', str(logs), '--chains', str(chains)], capture_output=True, text=True)
assert r.returncode == 0, r.stdout+r.stderr
assert 'A: done_PASS=1 done_not_PASS=1 mean_hours=2.50 (default; samples=1) running_remaining=1 pending=2' in r.stdout, r.stdout
assert 'superseded_runs=2' in r.stdout
assert 'B: done_PASS=1 done_not_PASS=0 mean_hours=2.50 (default; samples=0)' in r.stdout
assert before == snapshot(), 'tool wrote inputs'
# No per-job logs / chain data: duplicates count once; explicit degraded report.
(logs/'s1-j1.log').unlink(); (logs/'s1-j2.log').unlink()
r = subprocess.run([sys.executable, str(script), '--logs', str(logs)], capture_output=True, text=True)
assert r.returncode == 0 and 'default; samples=0' in r.stdout and 'pending=unknown' in r.stdout
assert 'fewer than 2 timed finished jobs' in r.stdout
# latest in-flight retry invalidates a previous finished attempt.
(logs/'B.queue.log').write_text(begin('old',1)+note('s1-x','old')+end('s1-x','old')+begin('new',1)+note('s1-x','new'))
r = subprocess.run([sys.executable, str(script), '--logs', str(logs)], capture_output=True, text=True)
assert 'B: done_PASS=0 done_not_PASS=0' in r.stdout
print('LANE_ETA_OK')
# A stale-lock EXIT must not borrow an old job file mtime, even with a slot NOTE.
(logs/'B.queue.log').write_text(begin('blocked',1)+note('s1-stale','blocked')+end('s1-stale','blocked','BLOCKED'))
(logs/'s1-stale.log').write_text('old job\n'); os.utime(logs/'s1-stale.log', (t0+3600, t0+3600))
r = subprocess.run([sys.executable, str(script), '--logs', str(logs)], capture_output=True, text=True)
assert 'B: done_PASS=0 done_not_PASS=1 mean_hours=2.50 (default; samples=0)' in r.stdout
# Explicit NOTE/EXIT times do not depend on mtimes. A single sample still uses default.
s = begin('timed',2)+note('s1-u','timed').rstrip()+' '+start+'\n'
s += end('s1-u','timed').rstrip()+' 2026-10-20T01:00:00+00:00\n'
(logs/'B.queue.log').write_text(s)
r = subprocess.run([sys.executable, str(script), '--logs', str(logs)], capture_output=True, text=True)
assert 'B: done_PASS=1 done_not_PASS=0 mean_hours=2.50 (default; samples=1)' in r.stdout
s += note('s1-v','timed').rstrip()+' 2026-10-20T02:00:00+00:00\n'
s += end('s1-v','timed').rstrip()+' 2026-10-20T03:00:00+00:00\n'
(logs/'B.queue.log').write_text(s)
r = subprocess.run([sys.executable, str(script), '--logs', str(logs)], capture_output=True, text=True)
assert 'B: done_PASS=2 done_not_PASS=0 mean_hours=1.00 (measured-proxy; samples=2)' in r.stdout
r = subprocess.run([sys.executable, str(script), '--logs', str(logs), '--job-hours-default', 'nan'], capture_output=True, text=True)
assert r.returncode == 2 and 'BLOCKED' in r.stdout
