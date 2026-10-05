#!/usr/bin/env python3
"""Offline behavioral controls. All files/processes are temporary, no real runners."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('remote_queue', HERE / 'queue.py')
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='ascon-offline-', dir=HERE)
        self.root = Path(self.tmp.name)
        self.home = self.root / 'home'; self.home.mkdir()
        self.repo = self.root / 'repo'; self.repo.mkdir()
        self.q = self.root / 'queue'
        self.bin = self.root / 'bin'; self.bin.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), TMPDIR=str(self.root),
                        PATH=str(self.bin) + os.pathsep + os.environ['PATH'], PYTHONDONTWRITEBYTECODE='1')
        self.shim('df', 'echo "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "fake 999999999 0 60000000 0% /"')
        self.shim('pgrep', 'exit 1')
        self.shim('sysctl', 'echo fake-boot-001')
        self.job = dict(ID='mini-diag-001', HOST='mini', KIND='diagnostic', ROUND='research',
                        REGIMES='calm', SEEDS='90001', ROSTER='roster.yaml', COMMIT='a'*40,
                        PARALLEL='3', DEADLINE=str(int(time.time())+600), MAX_SECONDS='30',
                        STOP_REVERT='1', SAFETY_AGENTS='cand')
        self.plan = self.root / 'plan.json'
        self.plan.write_text(json.dumps({'jobs': [self.job]}))
        self.call('init', self.q, self.plan, 'mini', self.repo)
        c = queue.read(self.q / 'config.json'); c['test_only'] = True
        queue.save(self.q / 'config.json', c)
        self.jobfile = self.root / 'job.env'
        self.jobfile.write_text(''.join(k+'='+v+'\n' for k, v in self.job.items()))
        self.call('enqueue', self.q, self.jobfile)
        self.fake = self.root / 'fake.py'
        self.fake.write_text('#!' + sys.executable + '''
import json, pathlib, sys, time
a=pathlib.Path(sys.argv[2]); j=json.loads((a/'job.json').read_text())
with (a.parent/'calls').open('a') as f: f.write('called\\n')
if (a.parent/'sleep').exists(): time.sleep(60)
mode=(a.parent/'mode').read_text() if (a.parent/'mode').exists() else 'PASS'
r=dict(g0=mode if mode in ('FAIL','BLOCKED') else 'PASS', violations=1 if mode=='violations' else 0,
       reverts=1 if mode=='reverts' else 0, safety='PASS',
       finished_worlds=[r+'/'+s for r in j['REGIMES'].split() for s in j['SEEDS'].split()])
(a/'result.json').write_text(json.dumps(r))
''')
        self.fake.chmod(0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def shim(self, name, body):
        p = self.bin / name; p.write_text('#!/bin/bash\n'+body+'\n'); p.chmod(0o755)

    def call(self, *args, ok=True):
        p = subprocess.run(['/bin/bash', str(HERE/'job-queue.sh'), *map(str, args)],
                           env=self.env, text=True, capture_output=True, timeout=20)
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr + p.stdout)
        else:
            self.assertNotEqual(p.returncode, 0, 'red control unexpectedly accepted')
        return p

    def runq(self, ok=True):
        return self.call('run', self.q, '--once', '--fake-runner', self.fake, ok=ok)

    def attempt_root(self):
        p = self.q / 'attempts' / self.job['ID']; p.mkdir(exist_ok=True); return p

    def state(self):
        return queue.read(self.q/'state'/(self.job['ID']+'.json'))

    def wait_calls(self):
        for _ in range(100):
            if (self.attempt_root()/'calls').exists(): return
            time.sleep(.05)
        self.fail('fake child never started')

    def test_lock_second_runner_red_control(self):
        (self.attempt_root()/'sleep').touch()
        p = subprocess.Popen(['/bin/bash', str(HERE/'job-queue.sh'), 'run', str(self.q), '--once',
                              '--fake-runner', str(self.fake)], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.wait_calls()
            failed = self.runq(ok=False)
            self.assertIn('second runner refused', failed.stderr)
            self.assertEqual((self.attempt_root()/'calls').read_text().count('called'), 1)
            self.call('stop', self.q)
            self.assertNotEqual(p.wait(timeout=10), 0)
        finally:
            if p.poll() is None: p.send_signal(signal.SIGTERM); p.wait(timeout=10)

    def test_disk_low_and_unreadable_red_controls(self):
        for body in ('echo "header"; echo "fake 90000000 0 26000000 0% /"', 'echo broken'):
            with self.subTest(body=body):
                self.shim('df', body)
                self.runq(ok=False)
                self.assertFalse((self.attempt_root()/'calls').exists())
                self.assertTrue((self.q/'STOP').exists())
                (self.q/'STOP').unlink()

    def test_disk_drops_during_run_stops_child(self):
        (self.attempt_root()/'sleep').touch()
        p = subprocess.Popen(['/bin/bash', str(HERE/'job-queue.sh'), 'run', str(self.q), '--once',
                              '--fake-runner', str(self.fake)], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.wait_calls()
            self.shim('df', 'echo header; echo "fake 90000000 0 20000000 0% /"')
            stdout, stderr = p.communicate(timeout=10)
            self.assertNotEqual(p.returncode, 0)
            self.assertEqual(self.state()['status'], 'failed', stdout + stderr)
        finally:
            if p.poll() is None: p.terminate(); p.wait(timeout=10)

    def test_finished_never_rerun_even_stale_running_state(self):
        self.runq()
        self.assertEqual(self.state()['status'], 'done')
        self.runq()  # positive control, completed queue is idle
        s = self.state(); s['status'] = 'running'
        queue.save(self.q/'state'/(self.job['ID']+'.json'), s)
        self.runq()  # crash between finished manifest and done state
        self.assertEqual(self.state()['status'], 'done')
        self.assertEqual((self.attempt_root()/'calls').read_text().count('called'), 1)
        self.call('enqueue', self.q, self.jobfile, ok=False)

    def test_partial_world_red_control(self):
        self.runq()
        s = self.state(); s['status'] = 'running'
        queue.save(self.q/'state'/(self.job['ID']+'.json'), s)
        mpath = Path(s['attempt'])/'manifest.json'; m=queue.read(mpath); m['finished']=False; m['interrupted']=True
        queue.save(mpath, m)
        self.runq(ok=False)
        self.assertEqual((self.attempt_root()/'calls').read_text().count('called'), 1)

    def test_interrupted_empty_diagnostic_restarts_whole_job(self):
        a = self.attempt_root()/'a0001'; a.mkdir()
        queue.save(a/'manifest.json', dict(job_sha256=queue.digest(self.job), label='old', finished=False, finished_worlds=[], interrupted=True))
        self.runq()
        self.assertEqual(self.state()['status'], 'done')
        self.assertTrue((self.attempt_root()/'a0002'/'manifest.json').exists())

    def test_g0_safety_red_controls_latch_stop(self):
        for mode in ('FAIL', 'BLOCKED', 'violations', 'reverts'):
            with self.subTest(mode=mode):
                # Each mode gets an independent queue fixture.
                self.tearDown(); self.setUp()
                (self.attempt_root()/'mode').write_text(mode)
                self.runq(ok=False)
                self.assertEqual(self.state()['status'], 'failed')
                self.assertTrue((self.q/'STOP').exists())
                self.runq(ok=False)
                self.assertEqual((self.attempt_root()/'calls').read_text().count('called'), 1)

    def test_process_probe_failure_red_control(self):
        self.shim('pgrep', 'exit 2')
        self.runq(ok=False)
        self.assertFalse((self.attempt_root()/'calls').exists())

    def test_deadline_red_control(self):
        self.job['DEADLINE'] = '1'
        self.replace_job()
        self.runq(ok=False)
        self.assertFalse((self.attempt_root()/'calls').exists())

    def replace_job(self):
        plan = {'jobs':[self.job]}; queue.save(self.q/'plan.json', plan)
        c=queue.read(self.q/'config.json'); c['plan_sha256']=queue.digest(plan); queue.save(self.q/'config.json',c)
        (self.q/'jobs'/(self.job['ID']+'.env')).write_text(''.join(k+'='+v+'\n' for k,v in self.job.items()))

    def test_plan_disjoint_hosts_red_controls(self):
        other = dict(self.job, ID='air-diag-001', HOST='air', SEEDS='90002')
        queue.validate({'jobs':[self.job, other]})
        other['SEEDS'] = self.job['SEEDS']
        with self.assertRaisesRegex(ValueError, 'world allocated twice'):
            queue.validate({'jobs':[self.job, other]})
        self.jobfile.write_text(''.join(k+'='+v+'\n' for k,v in other.items()))
        self.call('enqueue', self.q, self.jobfile, ok=False)

    def test_qualification_one_host_and_60_worlds(self):
        j=dict(self.job, KIND='qualification', REGIMES=' '.join(sorted(queue.REGIMES)), SEEDS='91001 91002 91003 91004 91005')
        queue.validate({'jobs':[j]})
        js=[dict(j, ID='q1', REGIMES='calm'), dict(j, ID='q2', HOST='air', REGIMES=' '.join(sorted(queue.REGIMES-{'calm'})))]
        with self.assertRaisesRegex(ValueError, 'ONE host'): queue.validate({'jobs':js})
        j['REGIMES']='calm'
        with self.assertRaisesRegex(ValueError, '12 x 5'): queue.validate({'jobs':[j]})

    def test_completion_log_survives_missing_receipt(self):
        # Actual adapter observer, synthetic files ONLY in this fixture repo.
        sys.path.insert(0, str(HERE))
        old = sys.modules.get('queue'); sys.modules['queue'] = queue
        try:
            import matrix_worker
            out=self.repo/'ascon-notes/eval/out/example'; out.mkdir(parents=True)
            run=self.repo/'runs/fake'; run.mkdir(parents=True)
            (out/'calm-90001.log').write_text('{"type":"run_completed","runDir":"runs/fake"}\n')
            (run/'summary.json').write_text(json.dumps(dict(violations=[], agents=[dict(id='cand',revertCount=0,includedTxCount=4)])))
            finished, errors=matrix_worker.observe(self.repo,self.job,'example')
            self.assertEqual(finished,['calm/90001']); self.assertEqual(errors,[])
            # Negative safety control uses the real adapter, not fake receipt fields.
            (run/'summary.json').write_text(json.dumps(dict(violations=[], agents=[dict(id='cand',revertCount=1,includedTxCount=4)])))
            self.assertTrue(matrix_worker.observe(self.repo,self.job,'example')[1])
        finally:
            sys.path.pop(0)
            if old is None: sys.modules.pop('queue',None)
            else: sys.modules['queue']=old


if __name__ == '__main__':
    unittest.main(verbosity=2)
