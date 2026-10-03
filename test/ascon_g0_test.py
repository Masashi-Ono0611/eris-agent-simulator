"""Offline fault injection. All runtime artifacts are synthetic; no simulator/network."""
import contextlib
import importlib.util
import io
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
sys.path[:0] = [str(LEAGUE), str(ROOT/'test')]
import league_harness as h
import ascon_degradation_gate_test as fixtures


def module(path):
    spec = importlib.util.spec_from_file_location(path.stem.replace('-', '_'), path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


class G0Tests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.GateTests(); self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.run = self.fixture.candidate
        self.roster = self.root/'roster.yaml'
        self.roster.write_text('agents:\n  - id: a\n  - id: b\n')
        self.index = self.root/'index.tsv'
        self.index.write_text('regime\tseed\trun_dir\texit_code\ncalm\t1\t'+str(self.run)+'\t0\n')
        s = json.loads((self.run/'summary.json').read_text())
        s.update(valueSeries={'failedReads':0}, violations=[], agents=[dict(id=i,pnlUsdc=p,includedTxCount=0) for i,p in [('a',1),('b',2)]])
        self.fixture.write(self.run/'summary.json',s)
        (self.run/'blocks.csv').write_text('ownerId,gasUsed,priorityFeeWei,maxFeePerGasWei\n')
        (self.run/'agents/b.jsonl').write_text((self.run/'agents/a.jsonl').read_text().replace('"a"','"b"'))
        events = [json.loads(x) for x in (self.run/'events.jsonl').read_text().splitlines()]
        for e in events:
            if e['type']=='agents_registered': e['agents']=[{'id':'a'},{'id':'b'}]
            if e['type']=='agents_ready': e.update(ready=[{'id':'a'},{'id':'b'}],launched=2)
        self.fixture.jsonl(self.run/'events.jsonl',events)

    def mutate(self, **kw):
        s=json.loads((self.run/'summary.json').read_text()); s.update(kw)
        self.fixture.write(self.run/'summary.json',s)

    def cli(self, script='g0.py', extra=()):
        return subprocess.run(['python3','-B',str(LEAGUE/script),str(self.index),'--roster',str(self.roster),
                               '--regimes','calm','--seeds','1',*extra],text=True,capture_output=True)

    def gate(self, expected=0):
        r=self.cli(extra=['--json'])
        self.assertEqual(r.returncode,expected,r.stdout+r.stderr)
        d=json.loads(r.stdout); self.assertEqual(d['status'],{0:'PASS',1:'FAIL',2:'BLOCKED'}[expected]); return d

    def test_healthy_pass(self): self.gate()
    def test_failed_reads_and_violations(self):
        for changes in [dict(valueSeries={'failedReads':7}),dict(violations=['bad'])]:
            with self.subTest(changes=changes):
                self.mutate(valueSeries={'failedReads':0},violations=[]); self.mutate(**changes); self.gate(1)
    def test_nonfinite_one_player_invalidates_scenario(self):
        for value in [float('nan'),float('inf'),None]:
            self.mutate(agents=[dict(id='a',pnlUsdc=1,includedTxCount=0),dict(id='b',pnlUsdc=value,includedTxCount=0)])
            self.gate(1)
    def test_missing_extra_duplicate_roster(self):
        for agents in [[dict(id='a',pnlUsdc=1,includedTxCount=0)], [dict(id=i,pnlUsdc=1,includedTxCount=0) for i in ['a','b','c']], [dict(id=i,pnlUsdc=1,includedTxCount=0) for i in ['a','a']]]:
            self.mutate(agents=agents)
            r=self.cli(extra=['--json']); self.assertNotEqual(r.returncode,0)
            self.assertTrue(any('roster mismatch' in x for x in json.loads(r.stdout)['failed']))
    def test_missing_extra_duplicate_scenario(self):
        header='regime\tseed\trun_dir\texit_code\n'; row=f'calm\t1\t{self.run}\t0\n'
        for body in ['',row+row,row+row.replace('calm','crash')]:
            self.index.write_text(header+body); self.gate(1)
    def test_missing_logs_blocked(self): (self.run/'agents/b.jsonl').unlink(); self.gate(2)
    def test_blocks_csv_mismatch(self):
        (self.run/'blocks.csv').write_text('ownerId,gasUsed,priorityFeeWei,maxFeePerGasWei\na,1,1,1\n'); self.gate(1)
    def test_loop_missing_blocked_and_wrong_fail(self):
        self.mutate(loopIterations=None); self.gate(2)
        self.mutate(loopIterations=361); self.assertNotEqual(self.cli().returncode,0)
    def test_p99_boundary(self):
        p=self.run/'events.jsonl'; text=p.read_text()
        p.write_text(text.replace('"totalMs": 100','"totalMs": 1000')); self.gate(1)
        p.write_text(text.replace('"totalMs": 100','"totalMs": 999')); self.gate()
    def test_timeout_fails_without_baseline(self):
        with (self.run/'agents/a.jsonl').open('a') as f: f.write(json.dumps(dict(agentId='a',round=101,reason='decide timeout: fixture'))+'\n')
        self.gate(1)
    def test_report_suppresses_and_override_labels(self):
        self.mutate(valueSeries={'failedReads':7})
        r=self.cli('league-report.py'); self.assertNotEqual(r.returncode,0)
        self.assertIn('未検証（G0 FAIL）',r.stdout); self.assertNotIn('脱落候補:',r.stdout)
        # Failed timing still has finite P for explicitly unverified diagnosis.
        self.mutate(valueSeries={'failedReads':0}); (self.run/'events.jsonl').unlink()
        r=self.cli('league-report.py',['--allow-unverified','--boot','5','--players','a,b'])
        self.assertEqual(r.returncode,0,r.stdout+r.stderr); self.assertIn('未検証（G0 BLOCKED）',r.stdout)
        self.assertIn('脱落候補:',r.stdout)
    def test_ledger_refuses_before_write(self):
        target=self.root/'ledger.jsonl'; self.mutate(valueSeries={'failedReads':7})
        r=self.cli('ledger.py',['--parallel','1','--ledger',str(target)])
        self.assertNotEqual(r.returncode,0); self.assertFalse(target.exists()); self.assertIn('G0 FAIL',r.stdout+r.stderr)

    def test_override_cannot_partially_score_globally_missing_roster_member(self):
        self.mutate(agents=[dict(id='a',pnlUsdc=1,includedTxCount=0)])
        r=self.cli('league-report.py',['--allow-unverified','--players','a','--boot','2'])
        self.assertNotEqual(r.returncode,0); self.assertNotIn('脱落候補:',r.stdout)

    def test_report_pass_and_ledger_override_record(self):
        r=self.cli('league-report.py',['--boot','5','--players','a,b'])
        self.assertEqual(r.returncode,0,r.stdout+r.stderr); self.assertTrue(r.stdout.startswith('G0 PASS'))
        agents=self.root/'source'
        for aid in ['a','b']:
            (agents/aid).mkdir(parents=True); (agents/aid/'agent.ts').write_text('fixture'); (agents/aid/'prompt.md').write_text('fixture')
        target=self.root/'ledger.jsonl'
        args=['--parallel','1','--ledger',str(target),'--agent-root',str(agents),'--boot','5','--players','a,b']
        r=self.cli('ledger.py',args)
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        row=json.loads(target.read_text()); self.assertEqual(row['g0']['status'],'PASS'); self.assertEqual(row['manifest_sha256'],'未記録')
        (self.run/'events.jsonl').unlink()
        r=self.cli('ledger.py',args+['--name','diagnostic','--allow-unverified'])
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        row=json.loads(target.read_text().splitlines()[-1]); self.assertTrue(row['allow_unverified']); self.assertEqual(row['g0']['status'],'BLOCKED')
        self.assertIn('allow-unverified',target.with_suffix('.md').read_text())

    def test_manifest_binds_and_detects_changed_prompt(self):
        import g0
        import round_manifest as m
        agents=self.root/'source'
        for aid in ['a','b']:
            (agents/aid).mkdir(parents=True); (agents/aid/'agent.ts').write_text('fixture'); (agents/aid/'prompt.md').write_text('fixture')
        zip_path=self.root/'bundle.zip'; zip_path.write_bytes(b'fixture archive')
        with patch.object(m,'MANIFESTS',self.root/'manifests'):
            m.begin('g0-fixture',self.roster,['calm'],['1'],3,agents,zip_path)
            d=g0.evaluate(self.index,self.roster,['calm'],['1'],manifest='g0-fixture')
            self.assertEqual(d['status'],'PASS',d); self.assertTrue(d['manifest_verified']); self.assertEqual(len(d['zip_sha256']),64)
            (agents/'a/prompt.md').write_text('changed')
            self.assertEqual(g0.evaluate(self.index,self.roster,['calm'],['1'],manifest='g0-fixture')['status'],'FAIL')

    def test_baseline_comparison_is_called(self):
        import g0
        import shutil
        base=self.root/'base2'; shutil.copytree(self.run,base)
        for name in ['summary.json','events.jsonl']:
            p=base/name; p.write_text(p.read_text().replace('candidate','base2'))
        # Matrix gives the comparison its regime rather than the direct-run placeholder.
        index=self.root/'base.tsv'; index.write_text('regime\tseed\trun_dir\texit_code\ncalm\t2\t'+str(base)+'\t0\n')
        # sources accepts an index named index.tsv.
        folder=self.root/'baseline'; folder.mkdir(); index.rename(folder/'index.tsv')
        d=g0.evaluate(self.index,self.roster,['calm'],['1'],baseline=[str(folder)])
        self.assertEqual(d['status'],'PASS',d)
        self.fixture.agent(self.run,drop=4)
        d=g0.evaluate(self.index,self.roster,['calm'],['1'],baseline=[str(folder)])
        self.assertEqual(d['status'],'FAIL',d); self.assertTrue(any('coverage' in x for x in d['failed']))

    def test_changed_baseline_membership_fails(self):
        s=json.loads((self.run/'summary.json').read_text()); s['agents'][0]['baseline']=True
        self.mutate(agents=s['agents']); self.gate(1)


class ExistingHoles(unittest.TestCase):
    def test_header_only_aggregate_fails(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'index.tsv'; p.write_text('regime\tseed\trun_dir\texit_code\n')
            r=subprocess.run(['python3','-B',str(ROOT/'ascon-notes/eval/aggregate.py'),str(p)],capture_output=True,text=True)
            self.assertNotEqual(r.returncode,0,r.stdout)
    def test_nan_and_missing_loops_do_not_partially_score(self):
        for loops, p in [(None,float('nan')),(362,float('nan')),(None,2),(362,None)]:
            r=dict(regime='calm',seed='1',loops=loops,reason=None,agents={'a':{'pnlUsdc':1},'b':{'pnlUsdc':p}})
            d=h.analyze([r],boot=2,collect_behavior=False)
            self.assertEqual(d['excluded_scenarios'],1); self.assertEqual(d['players'],{})
        r.update(loops=362,agents={'a':{'pnlUsdc':1},'b':{'pnlUsdc':2}})
        self.assertEqual(h.analyze([r],boot=2,collect_behavior=False)['excluded_scenarios'],0)
    def test_astra_standalone_gate_fault(self):
        f=fixtures.GateTests(); f.setUp()
        try:
            for p in [f.base,f.candidate]:
                s=json.loads((p/'summary.json').read_text()); s.update(valueSeries={'failedReads':0},violations=[])
                s['agents'][0]['pnlUsdc']=1; f.write(p/'summary.json',s)
            s['valueSeries']['failedReads']=7; s['violations']=['fixture violation']; f.write(f.candidate/'summary.json',s)
            f.gate(1)
        finally: f.doCleanups()

    def test_aggregate_nonfinite_or_missing_p_invalidates_every_player(self):
        aggregate=module(ROOT/'ascon-notes/eval/aggregate.py')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory); index=path/'index.tsv'
            index.write_text('regime\tseed\trun_dir\texit_code\ncalm\t1\t'+str(path)+'\t0\n')
            for bad in [float('nan'),float('inf'),None]:
                (path/'summary.json').write_text(json.dumps(dict(valueSeries={'failedReads':0},violations=[],agents=[dict(id='a',pnlUsdc=1),dict(id='b',pnlUsdc=bad)])))
                records=aggregate.read_records(index)
                self.assertTrue(records[0]['invalid']); text=aggregate.render(records)
                self.assertNotIn('正常',text); self.assertNotIn('nan',text.lower())


if __name__=='__main__': unittest.main()
