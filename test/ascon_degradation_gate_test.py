import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
LEAGUE = ROOT / 'ascon-notes/league'
sys.path.insert(0, str(LEAGUE))
from league_timing import timing_maxima
import round_status


class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.base = self.make('base')
        self.candidate = self.make('candidate')

    def write(self, path, value):
        path.write_text(json.dumps(value))

    def make(self, name, loops=362, catchup=False, ms=100):
        p = self.root / name
        p.mkdir(exist_ok=True)
        (p / 'agents').mkdir(exist_ok=True)
        self.write(p / 'summary.json', dict(runId=name, blocksProcessed=360, loopIterations=loops,
                    runStartBlock=100, finalBlock=460, blockTimeSec=2, agents=[dict(id='a')]))
        logs = [dict(type='run_started_realtime', runId=name, runBlocks=360),
                dict(type='agents_registered', agents=[dict(id='a')]),
                dict(type='agents_ready', ready=[dict(id='a')], launched=1, timedOut=False, late=[], exited=[])]
        for i in range(360):
            # A catch-up followed by a zero-length pass preserves count and contiguous coverage.
            bn, caught = (102, 2) if catchup and i == 0 else (102, 0) if catchup and i == 1 else (101+i, 1)
            logs.append(dict(type='round_timing', blockNumber=bn, blocksCaughtUp=caught, totalMs=ms))
        for _ in range(loops-360):
            logs.append(dict(type='round_timing', blockNumber=460, blocksCaughtUp=0, totalMs=ms))
        logs.append(dict(type='run_completed', runId=name))
        self.jsonl(p / 'events.jsonl', logs)
        self.agent(p)
        return p

    def jsonl(self, path, records):
        path.write_text(''.join(json.dumps(r)+'\n' for r in records))

    def agent(self, p, drop=0, timeout=False, failure=False):
        records = [dict(agentId='a', kind='mempool', event='runtime_start')]
        for i in range(360-drop):
            records.append(dict(agentId='a', round=101+i, action={'type':'noop'}))
        if timeout: records.append(dict(agentId='a', round=101, reason='decide timeout: no answer'))
        if failure: records.append(dict(agentId='a', kind='mempool', event='submit_failed', blockSeen=101))
        self.jsonl(p / 'agents/a.jsonl', records)

    def gate(self, code=0, *extra, candidate=None):
        r = subprocess.run(['python3', '-B', str(LEAGUE/'degradation-gate.py'), '--baseline', str(self.base),
                            '--candidate', str(candidate or self.candidate), *extra], capture_output=True, text=True)
        self.assertEqual(r.returncode, code, r.stdout+r.stderr)
        self.assertEqual(r.stdout.splitlines()[-1], 'GATE '+{0:'PASS',1:'FAIL',2:'BLOCKED'}[code])
        return r.stdout

    def test_equal_pass(self): self.gate()
    def test_loop_361_fail(self): self.make('candidate', loops=361); self.gate(1)
    def test_loop_362_healthy_pass_and_explicit_expected_loops(self):
        self.make('candidate', loops=362); self.gate(0)
        # an explicit override applies to baseline and candidate alike (both must pass every check)
        self.make('base', loops=361); self.make('candidate', loops=361); self.gate(0, '--expected-loops', '361')
    def test_loop_below_fail(self):
        s=json.loads((self.candidate/'summary.json').read_text()); s['loopIterations']=359
        self.write(self.candidate/'summary.json', s)
        logs=[json.loads(l) for l in (self.candidate/'events.jsonl').read_text().splitlines()]
        timings=[e for e in logs if e['type']=='round_timing']; timings[0]['blockNumber']=102; timings[0]['blocksCaughtUp']=2
        for t in (timings[1], timings[360], timings[361]): logs.remove(t)  # timing rows == loopIterations(359), coverage contiguous: the loop-count FAIL (not BLOCKED) is what fires
        self.jsonl(self.candidate/'events.jsonl',logs); self.gate(1)
    def test_catchup_fail_and_override(self):
        self.make('candidate', catchup=True); self.gate(1); self.gate(0, '--max-catchup-increase','1')
    def test_p99_boundary(self):
        self.make('candidate', ms=1000); self.gate(1)
        self.make('candidate', ms=999); self.gate()
    def test_missing_field_blocked(self):
        p=self.candidate/'events.jsonl'; p.write_text(p.read_text().replace('"totalMs": 100','"unknownMs": 100'))
        self.assertIn('取得不能',self.gate(2))
    def test_partial_timing_blocked(self):
        p=self.candidate/'events.jsonl'; lines=p.read_text().splitlines(); del lines[4]; p.write_text('\n'.join(lines)+'\n'); self.gate(2)
    def test_missing_agent_log_blocked(self): (self.candidate/'agents/a.jsonl').unlink(); self.gate(2)
    def test_truncated_log_blocked(self):
        with (self.candidate/'agents/a.jsonl').open('a') as f: f.write('{broken');
        self.gate(2)
    def test_baseline_missing_blocked(self): (self.base/'events.jsonl').unlink(); self.gate(2)
    def test_duplicates_fail(self): self.gate(1,candidate=self.base)
    def test_agent_not_ready_fail(self):
        p=self.candidate/'events.jsonl'; p.write_text(p.read_text().replace('"timedOut": false','"timedOut": true')); self.gate(1)
    def test_timeout_and_send_fail(self):
        self.agent(self.candidate, timeout=True, failure=True); self.gate(1)
        self.gate(0,'--max-timeout-increase','1','--max-submit-failure-increase','1')
    def test_coverage_boundary_and_decision_count(self):
        # coverage (default 1 pp = 3.6 of 360 blocks) is the default decision-loss check; the raw decision-count tolerance is opt-in
        self.agent(self.candidate,drop=3); self.gate(0); self.gate(1,'--max-decision-drop','2'); self.gate(0,'--max-decision-drop','3')
        self.agent(self.candidate,drop=4); self.gate(1); self.gate(1,'--max-decision-drop','4')
    def test_log_cap_blocked(self):
        with (self.candidate/'agents/a.jsonl').open('a') as f: f.write(json.dumps(dict(agentId='a',event='log_cap_reached'))+'\n')
        self.gate(2)
    def test_index_input(self):
        for name,run in [('b',self.base),('c',self.candidate)]:
            out=self.root/name; out.mkdir(); (out/'index.tsv').write_text('regime\tseed\trun_dir\texit_code\ncalm\t101\t'+str(run)+'\t0\n')
        self.base=self.root/'b'; self.gate(candidate=self.root/'c')
    def test_timing_status_maxima(self):
        self.make('candidate',catchup=True,ms=900)
        m=timing_maxima([self.candidate]); self.assertEqual(m['max_blocks_caught_up'],2); self.assertEqual(m['max_environment_total_ms'],900)
        m=timing_maxima([self.root/'absent']); self.assertIsNone(m['max_blocks_caught_up']); self.assertGreater(m['timing_missing'],0)

    def test_running_status_before_first_completion(self):
        out=self.root/'round'; out.mkdir(); (out/'.matrix-tmp-test').mkdir()
        runs=self.root/'runs'; runs.mkdir()
        self.candidate.rename(runs/'candidate')
        (out/'calm-101.log').write_text('{"runId":"candidate"}\n')
        with patch.object(round_status,'ROOT',self.root):
            result=round_status.status(out,total=3)
        self.assertEqual(result['completed'],0)
        self.assertEqual(result['max_blocks_caught_up'],1)
        self.assertEqual(result['max_environment_total_ms'],100)

    def test_invalid_runid_is_blocked(self):
        p=self.candidate/'summary.json'; s=json.loads(p.read_text()); s['runId']={}
        self.write(p,s); self.gate(2)

    def test_incomplete_blocks_fail(self):
        p=self.candidate/'summary.json'; s=json.loads(p.read_text()); s['blocksProcessed']=359
        self.write(p,s); self.gate(1)


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name); self.bin=self.root/'bin'; self.bin.mkdir()
        # Copied minimal workspace makes every filesystem side effect observable.
        self.league=self.root/'ascon-notes/league'; self.league.mkdir(parents=True)
        (self.league/'load-probe.sh').write_text((LEAGUE/'load-probe.sh').read_text())
        for ref in ['multi-arb','clean-arb','noop','venue-arb']:
            (self.root/'example/agents'/ref).mkdir(parents=True)
        self.stub('memory_pressure', 'echo "System-wide memory free percentage: 5%"')
        self.stub('vm_stat', 'echo "Swapouts: 1."')
        for name in ['npm','anvil','mktemp']:
            self.stub(name, 'echo forbidden > "'+str(self.root/'SIDE_EFFECT')+'"; exit 99')

    def stub(self,name,body):
        p=self.bin/name; p.write_text('#!/bin/bash\n'+body+'\n'); p.chmod(0o755)

    def run_probe(self,free,parallel=6,port=8547,dry=True,agents=12):
        self.stub('df', 'printf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 999999999 0 '+str(free)+' 0%% /\\n"')
        before=sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*'))
        r=subprocess.run(['/bin/bash',str(self.league/'load-probe.sh'),'--agents',str(agents),'--parallel',str(parallel),
                          '--base-port',str(port)]+(['--dry-run'] if dry else []),capture_output=True,text=True,
                         env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH'],'TMPDIR':str(self.root)})
        self.assertEqual(before,sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*')),r.stdout+r.stderr)
        return r

    def test_disk_short_rejects_before_start(self):
        r=self.run_probe(61865983,dry=False); self.assertNotEqual(r.returncode,0); self.assertIn('disk preflight FAIL',r.stderr)
    def test_exact_disk_threshold_and_dry_run(self):
        r=self.run_probe(61865984); self.assertEqual(r.returncode,0,r.stderr); self.assertIn('DRY RUN',r.stdout); self.assertIn('WARNING: memory pressure',r.stderr)
    def test_parallel_range(self):
        for p in range(1,9): self.assertEqual(self.run_probe(999999999,p).returncode,0)
        for p in [0,9]: self.assertNotEqual(self.run_probe(999999999,p).returncode,0)
    def test_port_boundary(self):
        self.assertEqual(self.run_probe(999999999,6,65529).returncode,0)
        self.assertNotEqual(self.run_probe(999999999,6,65530).returncode,0)
    def test_bad_df_rejects(self):
        r=self.run_probe('unknown'); self.assertNotEqual(r.returncode,0); self.assertIn('BLOCKED',r.stderr)
    def test_healthy_memory_no_warning(self):
        self.stub('memory_pressure','echo "System-wide memory free percentage: 50%"')
        r=self.run_probe(999999999); self.assertEqual(r.returncode,0); self.assertNotIn('WARNING',r.stderr)

    def test_agents_compatibility(self):
        for agents in [8,12,16]: self.assertEqual(self.run_probe(999999999,agents=agents).returncode,0)
        self.assertNotEqual(self.run_probe(999999999,agents=9).returncode,0)

    def test_execution_forwards_port_parallel_and_disk_threshold_with_stub(self):
        (self.bin/'mktemp').unlink()
        self.stub('df','printf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 999999999 0 999999999 0%% /\\n"')
        matrix=self.root/'ascon-notes/eval/run-matrix.sh'; matrix.parent.mkdir()
        matrix.write_text('#!/bin/bash\n'
            'printf "%s\\n" "$MIN_FREE_GB" "$@" > received.txt\n'
            'mkdir -p ascon-notes/eval/out/test\n'
            'printf "regime\\tseed\\trun_dir\\texit_code\\n" > ascon-notes/eval/out/test/index.tsv\n')
        r=subprocess.run(['/bin/bash',str(self.league/'load-probe.sh'),'--agents','16','--parallel','5',
                          '--base-port','8900','--label','test'],capture_output=True,text=True,
                         env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH'],'TMPDIR':str(self.root)})
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        received=(self.root/'received.txt').read_text()
        self.assertTrue(received.startswith('53\n'))
        self.assertIn('--parallel\n5\n',received)
        self.assertIn('--base-port\n8900\n',received)
        self.assertFalse(list(self.league.glob('load-probe-roster.*')))
        self.assertFalse((self.root/'SIDE_EFFECT').exists())


if __name__=='__main__': unittest.main()
