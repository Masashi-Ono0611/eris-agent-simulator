"""Synthetic fixtures only; never invoke a real simulator, model or anvil."""
import argparse
import contextlib
import csv
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / 'ascon-notes/league'
sys.path.insert(0, str(HERE))
import league_harness as h
import ledger
import round_status
import confirm_candidate as confirm


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


report = module('league-report')
briefs = module('next-gen-brief')
spawn = module('spawn-player')


class Harness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='league-harness-', dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.out = self.path / 'round'; self.out.mkdir()
        self.ids = ['astra-1','astra-2','opus-1','inc-zeta']

    def fixture(self, values=None, loops=None, regimes=None):
        values = values or [[30,10,-20,0]] * 4
        loops = loops or [360] * len(values)
        regimes = regimes or ['calm'] * len(values)
        rows = []
        for i, (ps, loop, regime) in enumerate(zip(values, loops, regimes)):
            run = self.out / f'run-{i}'; run.mkdir(exist_ok=True)
            summary = dict(mode='backtest', loopIterations=loop, valueSeries={'failedReads':0}, violations=[],
                           agents=[dict(id=aid,pnlUsdc=v,includedTxCount=2,revertCount=1) for aid,v in zip(self.ids,ps)])
            (run/'summary.json').write_text(json.dumps(summary))
            rows.append(dict(regime=regime,seed=str(i+1),run_dir=str(run.relative_to(ROOT)),exit_code='0'))
        index = self.out/'index.tsv'
        with index.open('w') as f:
            w=csv.DictWriter(f,fieldnames=['regime','seed','run_dir','exit_code'],delimiter='\t'); w.writeheader(); w.writerows(rows)
        return index, rows

    def analysis(self, index, **kw):
        return h.analyze(h.read(index), boot=400, **kw)

    def cli(self, name, *args, success=True):
        command = ['/bin/bash' if name.endswith('.sh') else 'python3', str(HERE/name), *map(str,args)]
        result = subprocess.run(command, text=True, capture_output=True, env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        if success: self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        else: self.assertNotEqual(result.returncode,0)
        return result.stdout+result.stderr

    def test_review_ledger_collision_and_projection_failure(self):
        target=self.path/'ledger.md'; target.write_text('preserve history')
        with self.assertRaises(ValueError): ledger.append(target, {'round':'r'})
        self.assertEqual(target.read_text(),'preserve history')
        target=self.path/'ledger.jsonl'
        with patch.object(ledger,'markdown',side_effect=ValueError('projection failed')):
            with self.assertRaises(ValueError): ledger.append(target, {'round':'r'})
        self.assertFalse(target.exists() and target.read_text())

    def test_review_chain_tampering_unicode_and_settings(self):
        index,_=self.fixture(); agents,roster=self.agents(); target=self.path/'ledger.jsonl'
        args=[index,'--roster',roster,'--agent-root',agents,'--parallel','1','--ledger',target,
              '--boot','20','--top-n','1','--top-k','2','--seed','42','--notes','a\u2028b\u2029c']
        self.cli('ledger.py',*args,'--name','r1'); self.cli('ledger.py',*args,'--name','r2')
        rows=[json.loads(x) for x in target.read_text().splitlines()]
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[1]['prev_hash'],rows[0]['row_hash'])
        self.assertIsNone(rows[0]['prev_hash'])
        self.assertEqual(rows[0]['analysis']['top_n'],1)
        self.assertEqual(rows[0]['analysis']['top_k'],2)
        self.assertEqual(rows[0]['analysis']['seed'],42)
        self.assertEqual(rows[0]['analysis']['rank_scenarios'],4)
        self.assertTrue(rows[0]['players']['astra-1']['ci_degenerate'])
        rows[0]['notes']='tampered'
        target.write_text(''.join(json.dumps(r)+'\n' for r in rows)); before=target.read_bytes()
        self.cli('ledger.py',*args,'--name','r3',success=False)
        self.assertEqual(before,target.read_bytes())

    def test_review_empty_and_all_invalid_cli(self):
        index,rows=self.fixture(); agents,roster=self.agents()
        for empty in (False,True):
            if empty: index.write_text('regime\tseed\trun_dir\texit_code\n')
            else:
                for row in rows: (Path(row['run_dir'])/'summary.json').write_text('{}')
            for name,args in [('league-report.py',[]),('ledger.py',['--roster',roster,'--parallel','1']),
                ('next-gen-brief.py',['--generation','2','--fresh','grok-8:LP']),('round-status.sh',[])]:
                with self.subTest(empty=empty,name=name):
                    self.assertIn('0',self.cli(name,index,*args,success=False))

    def test_review_paths_and_bad_summary_status(self):
        index,rows=self.fixture()
        for value in [str((ROOT/rows[0]['run_dir']).resolve()), '../escape', '/tmp/escape']:
            bad=dict(rows[0],run_dir=value)
            with index.open('w') as f:
                w=csv.DictWriter(f,fieldnames=bad,delimiter='\t'); w.writeheader(); w.writerow(bad)
            with patch.object(Path,'read_text',side_effect=AssertionError('must not read summary')):
                self.assertIsNotNone(h.read(index)[0]['reason'])
        index,rows=self.fixture()
        for field,value in [('violations',['bad']),('valueSeries',{'failedReads':1}),('agents',[{'id':123}]),('agents',{} )]:
            index,rows=self.fixture()
            path=Path(rows[0]['run_dir'])/'summary.json'; doc=json.loads(path.read_text()); doc[field]=value; path.write_text(json.dumps(doc))
            s=round_status.status(self.out)
            self.assertEqual(s['invalid_runs'],1)
            self.assertEqual(s['failed'],1)
        stage=self.out/'.matrix-tmp-test'; stage.mkdir()
        (stage/'ok.row').write_text('\t'.join(rows[1].values())+'\n')
        (stage/'short.row').write_text('calm\t2\n')
        (stage/'empty.row').write_text('')
        s=round_status.status(self.out)
        self.assertEqual(s['malformed_rows'],2)
        self.assertEqual(s['completed'],3)

    def test_review_agent_paths_and_root_symlink(self):
        agents,roster=self.agents(); alias=self.path/'link'; alias.symlink_to(agents/'astra-1')
        with self.assertRaises(ValueError): h.tree_hash(alias)
        for value in ['/tmp','../escape','link']:
            (agents/'link').symlink_to(self.path) if not (agents/'link').exists() else None
            with self.assertRaises(ValueError): h.agent_path(agents,value)
        self.assertEqual(h.agent_path(agents,'astra-1'),agents/'astra-1')

    def test_review_statistics_labels_intervals_and_coverage(self):
        index,_=self.fixture(); data=self.analysis(index)
        self.assertTrue(data['players']['astra-1']['ci_degenerate'])
        self.assertIsNone(data['top_stability'])
        text=report.render_analysis(data)
        for term in ['縮退（再標本分散なし）','競争者が少なすぎる','選抜バイアス','警告','脱落候補: 空']:
            self.assertIn(term,text)
        self.assertAlmostEqual(sum(h.interval(list(range(40)))),39)
        self.assertIsNone(h.interval([]))
        index,_=self.fixture([[30,0,-20,5],[0,30,-20,5]]*4)
        self.assertFalse(self.analysis(index,top_n=1)['players']['astra-1']['ci_degenerate'])
        self.assertIsNotNone(self.analysis(index,top_n=1)['top_stability'])
        self.assertIn('少数',report.render_analysis(h.analyze(h.read(index),boot=2)))

    def test_review_empty_behavior_and_brief_sanitizing(self):
        index,rows=self.fixture(); run=Path(rows[0]['run_dir']); (run/'agents').mkdir()
        log=run/'agents/astra-1.jsonl'; log.write_text('')
        self.assertIsNone(h.behavior(h.read(index)[0],'astra-1')['submit_failed'])
        log.write_text('{"kind":"other"}\n')
        self.assertEqual(h.behavior(h.read(index)[0],'astra-1')['submit_failed'],0)
        data=self.analysis(index,ref='absent'); x=data['players']['astra-1']
        x['regimes']={'calm\n# injected':50}
        template='{{GENERATION_CONTEXT}} {{ARCHETYPE_DETAIL}}'
        paths={aid:Path('/safe') for aid in data['ranking']}
        text=briefs.generate(data,'r','astra-1',template,paths)
        self.assertNotIn('\n# injected',text); self.assertIn('取得不能',text)
        text=briefs.generate(data,'r','grok-9',template,paths,'LP\n# injected `x`')
        self.assertNotIn('\n# injected',text); self.assertNotIn('`x`',text)

    def test_review_copy_filters_and_reuse_rejection(self):
        src=self.path/'src'; src.mkdir(); (src/'agent.ts').write_text('code'); (src/'prompt.md').write_text('prompt')
        for name in ['.env','.env.local','.hidden','debug.log']: (src/name).write_text('synthetic')
        for name in ['node_modules','.cache']:
            (src/name).mkdir(); (src/name/'file').write_text('synthetic')
        (src/'nested').mkdir(); (src/'nested/.env').write_text('synthetic'); (src/'nested/keep.ts').write_text('ok')
        dest=self.path/'copy'; spawn.copy_previous(src,dest)
        self.assertEqual(sorted(p.relative_to(dest).as_posix() for p in dest.rglob('*') if p.is_file()),['agent.ts','nested/keep.ts','prompt.md'])
        wt=self.path/'fake-worktree'; wt.mkdir(); (wt/'BRIEF.md').write_text('untouched')
        with patch.object(sys,'argv',['spawn','astra-99','--reuse','--worktree',str(wt)]), patch.object(spawn.subprocess,'Popen') as launch, patch.object(spawn.subprocess,'check_output',side_effect=subprocess.CalledProcessError(1,['git'])):
            with self.assertRaises(SystemExit): spawn.main()
            launch.assert_not_called()
        self.assertEqual((wt/'BRIEF.md').read_text(),'untouched')

    def test_review_no_common_rejects_all_clis(self):
        index,rows=self.fixture(); agents,roster=self.agents()
        for i,row in enumerate(rows):
            path=Path(row['run_dir'])/'summary.json'; doc=json.loads(path.read_text())
            doc['agents']=[doc['agents'][i%2],doc['agents'][-1]]; path.write_text(json.dumps(doc))
        out=self.path/'briefs'; target=self.path/'ledger.jsonl'
        for name,args in [('league-report.py',[]),('ledger.py',['--roster',roster,'--parallel','1','--ledger',target]),
            ('next-gen-brief.py',['--generation','2','--fresh','grok-9:LP','--output-dir',out]),('round-status.sh',[])]:
            with self.subTest(name=name): self.assertIn('0',self.cli(name,index,*args,success=False))
        self.assertFalse(out.exists()); self.assertFalse(target.exists())

    def test_review_brief_roster_escape_rejected(self):
        index,_=self.fixture(); agents,roster=self.agents(); out=self.path/'briefs'
        (agents/'escape').symlink_to(self.path)
        for directory in [str(agents/'astra-1'),'../agents/astra-1','escape']:
            roster.write_text(json.dumps({'agents':[dict(id='astra-1',dir=directory)]}))
            self.cli('next-gen-brief.py',index,'--generation','2','--fresh','grok-9:LP','--agent-root',agents,
                     '--roster',roster,'--output-dir',out,'--boot','2',success=False)
            self.assertFalse(out.exists())

    def test_review_run_symlink_escape_and_missing_corrupt_summary(self):
        index,rows=self.fixture()
        for content in [None, '{broken', '[]', '{"agents":[null]}']:
            path=Path(rows[0]['run_dir'])/'summary.json'
            if content is None: path.unlink()
            else: path.write_text(content)
            self.assertEqual(round_status.status(self.out)['invalid_runs'],1)
        with tempfile.TemporaryDirectory() as outside:
            link=self.path/'escape'; link.symlink_to(outside)
            row=dict(rows[0],run_dir=str(link.relative_to(ROOT)))
            with patch.object(Path,'read_text',side_effect=AssertionError('external read')):
                self.assertIsNotNone(h.read_rows([row])[0]['reason'])

    def test_review_ledger_symlink_alias_and_post_append_projection_error(self):
        target=self.path/'ledger.jsonl'; target.write_text('unchanged')
        target.with_suffix('.md').symlink_to(target)
        with self.assertRaises(ValueError): ledger.append(target,{'round':'r'})
        self.assertEqual(target.read_text(),'unchanged')
        target.with_suffix('.md').unlink(); target.unlink()
        with patch.object(ledger,'markdown',return_value='rendered'), patch.object(Path,'replace',side_effect=OSError('replace failed')):
            with self.assertRaises(OSError): ledger.append(target,{'round':'r'})
        self.assertEqual(len(ledger.validate_chain(target.read_text())),1)
        self.assertEqual(list(self.path.glob('*.tmp-*')),[])

    def test_review_degenerate_single_seed_and_full_coverage_warning(self):
        index,_=self.fixture([[30,0,-20,5],[0,30,-20,5],[10,20,-10,0]],regimes=['calm','calm','crash'])
        data=self.analysis(index)
        self.assertTrue(data['players']['astra-1']['ci_degenerate'])
        self.assertIn('縮退',h.ci_text(data['players']['astra-1']))
        index,_=self.fixture([[30,0,-20,5],[0,30,-20,5]]*12,regimes=[f'reg{i//2}' for i in range(24)])
        data=self.analysis(index)
        self.assertFalse(any('被覆不足' in w for w in data['warnings']))
        x=data['players']['astra-1']; x['ci_small_boot']=False
        self.assertIn('95% CI',h.ci_text(x))
        self.assertEqual(h.interval([10]),[10,10])
        self.assertEqual(h.interval([0,100]),[2.5,97.5])

    def test_review_status_skips_telemetry_and_warns_single_seed_coverage(self):
        index,_=self.fixture([[30,0,-20,5]]*12,regimes=[f'reg{i}' for i in range(12)])
        with patch.object(h,'behavior',side_effect=AssertionError('status must only inspect summary')):
            data=round_status.status(self.out)
        self.assertEqual(data['scored_scenarios'],12)
        self.assertTrue(any('被覆不足' in w for w in data['warnings']))
        index,_=self.fixture([[30,0,-20,5]]*24,regimes=[f'reg{i//2}' for i in range(24)])
        self.assertEqual(round_status.status(self.out)['warnings'],[])

    def test_review_reuse_requires_git_and_registration(self):
        wt=self.path/'wt'; wt.mkdir()
        with patch.object(spawn.subprocess,'check_output',side_effect=[b'.git',b'worktree '+str(wt).encode()+b'\0HEAD x\0\0']):
            spawn.validate_worktree(wt)
        for results in [[b'.git',b'worktree /elsewhere\0\0'],subprocess.CalledProcessError(1,['git'])]:
            with patch.object(spawn.subprocess,'check_output',side_effect=results):
                with self.assertRaises(ValueError): spawn.validate_worktree(wt)

    def test_review_child_immediate_exit_and_running(self):
        child=Mock()
        for code in [0,7]:
            child.wait.return_value=code
            with self.assertRaisesRegex(ValueError,'exited immediately'): spawn.check_started(child,self.path/'log')
        child.wait.side_effect=subprocess.TimeoutExpired('synthetic',.3)
        spawn.check_started(child,self.path/'log')

    def test_review_copy_failure_reports_new_worktree_cleanup(self):
        src=self.path/'source/example/agents/astra-99'; src.mkdir(parents=True)
        (src/'agent.ts').write_text('code'); (src/'prompt.md').write_text('prompt')
        wt=self.path/'new-worktree'; error=io.StringIO()
        argv=['spawn','astra-99','--worktree',str(wt),'--from-worktree',str(self.path/'source')]
        with patch.object(sys,'argv',argv), patch.object(spawn.subprocess,'check_call') as git, \
             patch.object(spawn,'copy_previous',side_effect=OSError('synthetic copy error')), \
             patch.object(spawn.subprocess,'Popen') as launch, contextlib.redirect_stderr(error):
            with self.assertRaises(SystemExit): spawn.main()
        git.assert_called_once(); launch.assert_not_called()
        self.assertIn('newly created worktree remains',error.getvalue()); self.assertIn('worktree remove',error.getvalue())

    def test_review_env_allowlist_json_bounds_and_no_secret_output(self):
        index,_=self.fixture(); a=self.confirm_args(index)
        for value in ['ERIS_AGENT_FROZEN=1','ASCON_X_PARAMS={"x":true}', 'ASCON_X_PARAMS="'+('x'*8190)+'"']:
            a.env=[value]; confirm.plan(a)
        for value in ['OTHER=1','ASCON_X_PARAM={}', 'CREDENTIAL=1','ERIS_AGENT_FROZEN=not-json',
                      'ASCON_X_PARAMS=NaN','ASCON_X_PARAMS="'+('x'*8191)+'"']:
            a.env=[value]
            with self.subTest(key=value.split('=')[0]), self.assertRaises(ValueError): confirm.plan(a)
        output=self.cli('confirm-candidate.sh','--dir','ascon-zeta','--label','confirm-test','--seeds','9001',
            '--selection-index',index,'--env','ASCON_X_PARAMS=synthetic-private-value','--dry-run',success=False)
        self.assertNotIn('synthetic-private-value',output)

    def test_review_confirmation_ledger_overlap_and_seed_record(self):
        index,_=self.fixture(); a=self.confirm_args(index); target=self.path/'ledger.jsonl'
        with patch.object(ledger,'markdown',return_value='fixture'):
            ledger.append(target,dict(round='selection',seeds=['09001'],scenarios=[]))
        a.selection_ledger=[target]; warning=io.StringIO()
        with contextlib.redirect_stderr(warning): confirm.plan(a)
        self.assertIn('9001',warning.getvalue())
        a.seeds='9003'; warning=io.StringIO()
        with contextlib.redirect_stderr(warning): confirm.plan(a)
        self.assertEqual(warning.getvalue(),'')
        roster=self.path/'plan.yaml'; record=self.path/'seed-record.json'; output=io.StringIO()
        argv=['confirm','--dir','fake','--label','fake','--seeds','0099','--selection-index','fake','--seed-record',str(record)]
        with patch.object(sys,'argv',argv), patch.object(confirm,'plan',return_value=(roster,[{'env':{}}],['fake'],['fake'])), \
             patch.object(confirm.subprocess,'call',return_value=7), contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit): confirm.main()
        data=json.loads(record.read_text()); self.assertEqual(data['seeds'],['99'])
        self.assertTrue(all(x['seed']=='99' for x in data['scenarios']))
        self.assertIn('seed_record:',output.getvalue()); self.assertFalse(roster.exists())

    def test_strong_weak_stability_diversity_and_paired_ci(self):
        index,_ = self.fixture()
        data = self.analysis(index, top_k=1)
        self.assertEqual(data['players']['astra-1']['stability']['first'],1)
        self.assertEqual(data['players']['opus-1']['stability']['top_k'],0)
        self.assertGreater(data['players']['astra-1']['delta_ci'][0],0)
        self.assertLess(data['players']['opus-1']['delta_ci'][1],0)
        self.assertIn('opus-1', data['survivors'])
        self.assertEqual(data['eliminate'],[])  # Diversity can retain more than half.
        self.assertNotIn('inc-zeta', data['ranking'])
        text=report.render_analysis(data)
        for expected in ['シナリオ対応差','勝者の呪い','機械的な推奨','取得不能','系統別平均']:
            self.assertIn(expected,text)

    def test_diversity_eliminates_only_unprotected_lower_half(self):
        self.ids = ['astra-1','astra-2','astra-3','opus-1','inc-zeta']
        index,_ = self.fixture([[40,30,20,-20,0]] * 4)
        data = self.analysis(index)
        self.assertEqual(data['survivors'], ['astra-1','astra-2','opus-1'])
        self.assertEqual(data['eliminate'], ['astra-3'])

    def test_noisy_ranks_and_ties_do_not_invent_winner(self):
        index,_=self.fixture([[30,0,-20,5],[0,30,-20,5]]*4)
        data=self.analysis(index, top_k=1)
        for aid in ['astra-1','astra-2']:
            self.assertGreater(data['players'][aid]['stability']['first'],.3)
            self.assertLess(data['players'][aid]['stability']['first'],.7)
        self.assertAlmostEqual(sum(x['stability'].get('first',0) for x in data['players'].values()),1)
        index,_=self.fixture([[1,1,1,1]]*4)
        data=self.analysis(index,top_k=2)
        for aid in data['ranking']:
            self.assertAlmostEqual(data['players'][aid]['stability']['first'],1/3)
            self.assertAlmostEqual(data['players'][aid]['stability']['top_k'],2/3)

    def test_equal_regime_weight_and_common_missing_coverage(self):
        index,rows=self.fixture([[30,0,-20,5]]*3+[[0,30,-20,5]], regimes=['calm']*3+['crash'])
        data=self.analysis(index)
        x=data['players']['astra-1']
        self.assertAlmostEqual(x['mean_t'],sum(x['regimes'].values())/2)
        self.assertAlmostEqual(x['delta_ci'][0],x['delta_ci'][1])
        path=Path(rows[0]['run_dir'])/'summary.json'; s=json.loads(path.read_text()); s['agents'].pop(0); path.write_text(json.dumps(s))
        data=self.analysis(index)
        self.assertEqual(data['rank_scenarios'],3)
        self.assertEqual(data['players']['astra-1']['paired_n'],3)
        no_ref=self.analysis(index, ref='missing')
        self.assertIsNone(no_ref['players']['astra-1']['delta_ci'])
        self.assertEqual(no_ref['players']['astra-1']['paired_n'],0)

    def test_load_guard_on_off_missing_and_invalid(self):
        index,rows=self.fixture(loops=[359,360,None,361])
        self.assertEqual(self.analysis(index)['excluded_scenarios'],1)
        self.assertEqual(self.analysis(index,minimum=0)['excluded_scenarios'],0)
        self.assertEqual(self.analysis(index)['missing_loops'],1)
        path=Path(rows[1]['run_dir'])/'summary.json'; s=json.loads(path.read_text()); s['valueSeries']['failedReads']=1; path.write_text(json.dumps(s))
        self.assertEqual(self.analysis(index)['excluded_scenarios'],2)
        with index.open('a') as f: f.write('\t'.join(rows[2].values())+'\n')
        self.assertTrue(any(r['reason']=='run_dir重複' for r in h.read(index)))
        self.cli('league-report.py',index,'--boot','0',success=False)

    def test_no_common_scenarios_refuses_rank_recommendations(self):
        index,rows=self.fixture()
        for i,row in enumerate(rows):
            path=Path(row['run_dir'])/'summary.json'; value=json.loads(path.read_text())
            value['agents']=[value['agents'][i % 2],value['agents'][-1]]
            path.write_text(json.dumps(value))
        data=self.analysis(index)
        self.assertEqual(data['rank_scenarios'],0)
        self.assertEqual(data['ranking'],[])
        self.assertEqual(data['eliminate'],[])
        self.assertIsNone(data['top_stability'])

    def test_behavior_complete_missing_and_partial(self):
        index,rows=self.fixture()
        run=Path(rows[0]['run_dir']); (run/'agents').mkdir()
        (run/'agents/astra-1.jsonl').write_text(json.dumps({'kind':'mempool','event':'submit_failed'})+'\n')
        (run/'blocks.csv').write_text('ownerId,gasUsed,priorityFeeWei,maxFeePerGasWei\nastra-1,10,5,3\nastra-1,20,2,4\n')
        record=h.read(index)[0]; metric=h.behavior(record,'astra-1')
        self.assertEqual(metric,dict(included=2,reverted=1,submit_failed=1,priority_fee_wei=70))
        self.assertIsNone(h.behavior(record,'astra-2')['priority_fee_wei'])
        data=self.analysis(index)
        self.assertIn('取得不能（観測分 70; 1/4 run）',h.metric_text(data['players']['astra-1']['behavior']['priority_fee_wei']))
        record['mode']='realtime'; self.assertIsNone(h.behavior(record,'astra-1')['priority_fee_wei'])
        (run/'agents/astra-1.jsonl').write_text('{broken')
        self.assertIsNone(h.behavior(record,'astra-1')['submit_failed'])

    def agents(self):
        agents=self.path/'agents'; agents.mkdir()
        for aid in self.ids:
            path=agents/aid; path.mkdir(); (path/'agent.ts').write_text('first version'); (path/'prompt.md').write_text('prompt')
        roster=self.path/'roster.yaml'; roster.write_text(json.dumps({'agents':[dict(id=aid,dir=aid,wallet='AUTO') for aid in self.ids]}))
        return agents,roster

    def test_ledger_append_only_hash_changes_duplicate_rejected(self):
        index,_=self.fixture(); agents,roster=self.agents(); target=self.path/'ledger.jsonl'
        args=[index,'--roster',roster,'--agent-root',agents,'--parallel','2','--ledger',target,'--boot','20']
        self.cli('ledger.py',*args,'--name','round-1')
        before=target.read_bytes(); old=json.loads(before)
        (agents/'astra-1/agent.ts').write_text('second version')
        roster.write_text(roster.read_text()+'\n')
        self.cli('ledger.py',*args,'--name','round-2')
        self.assertTrue(target.read_bytes().startswith(before))
        new=json.loads(target.read_text().splitlines()[1])
        self.assertNotEqual(old['agents']['astra-1']['sha256'],new['agents']['astra-1']['sha256'])
        self.assertNotEqual(old['roster']['sha256'],new['roster']['sha256'])
        self.assertEqual(old['agents']['opus-1']['sha256'],new['agents']['opus-1']['sha256'])
        self.assertIn('round-1',target.with_suffix('.md').read_text())
        self.assertIn('round-2',target.with_suffix('.md').read_text())
        before=target.read_bytes(); self.cli('ledger.py',*args,'--name','round-2',success=False)
        self.assertEqual(before,target.read_bytes())
        target.write_bytes(before+b'{bad')
        damaged=target.read_bytes(); self.cli('ledger.py',*args,'--name','round-3',success=False)
        self.assertEqual(damaged,target.read_bytes())

    def test_briefs_survivor_fresh_and_validation(self):
        index,_=self.fixture(regimes=['calm','calm','crash','crash']); agents,roster=self.agents()
        out=self.path/'briefs'
        args=[index,'--generation','2','--survivors','astra-1','--fresh','grok-9:LP inventory neutral',
              '--agent-root',agents,'--roster',roster,'--output-dir',out,'--boot','20']
        self.cli('next-gen-brief.py',*args)
        text=(out/'astra-1.md').read_text(); self.assertNotIn('{{',text)
        for term in ['前世代の結果','最悪レジーム','基準 inc-zeta','submit_failed','読んでよい参考','過剰最適化']:
            self.assertIn(term,text)
        fresh=(out/'grok-9.md').read_text(); self.assertIn('白紙＋新しい型',fresh); self.assertIn('LP inventory neutral',fresh)
        self.cli('next-gen-brief.py',*args,success=False)
        self.cli('next-gen-brief.py',index,'--generation','2','--survivors','unknown','--boot','20',success=False)

    def test_status_final_active_missing_and_eta(self):
        index,rows=self.fixture(loops=[359,360,365,400])
        os.utime(index,(1000,1000))
        s=json.loads(self.cli('round-status.sh',self.out,'--started-at','900','--json'))
        self.assertEqual((s['completed'],s['total'],s['min_loop_iterations'],s['below_threshold']),(4,4,359,1))
        self.assertEqual((s['elapsed_seconds'],s['eta_seconds']),(100,0))
        s=json.loads(self.cli('round-status.sh',self.out,'--min-loop-iterations','0','--json'))
        self.assertEqual(s['below_threshold'],0)
        stage=self.out/'.matrix-tmp-123'; stage.mkdir()
        (stage/'calm-1.row').write_text('\t'.join(rows[0].values())+'\n')
        # Active stage must override final index from previous invocation.
        with patch.object(round_status.time,'time',return_value=1000):
            s=round_status.status(self.out,4,360,900)
        self.assertEqual((s['completed'],s['eta_seconds']),(1,300))
        self.assertIsNone(round_status.status(self.out)['total'])
        result=self.cli('round-status.sh',self.out,'--regimes','calm crash','--seeds','1 2','--json',success=False)
        self.assertEqual(json.loads(result)['total'],4)
        self.cli('round-status.sh',self.path/'absent',success=False)
        (stage/'calm-2.row').write_text('calm\t2\t\t1\n')
        self.assertEqual(round_status.status(self.out,4)['failed'],1)

    def test_spawn_copy_reuse_and_no_launch_dry_run(self):
        source=self.path/'old'; src=source/'example/agents/astra-99'; src.mkdir(parents=True)
        (src/'agent.ts').write_text('previous'); (src/'prompt.md').write_text('prompt')
        dest=self.path/'new'; bf=self.path/'brief.md'; bf.write_text('custom generation brief')
        args=['astra-99','blank','--worktree',dest,'--from-worktree',source,'--brief-file',bf,'--dry-run']
        result=self.cli('spawn-player.py',*args); self.assertIn('copy:',result); self.assertFalse(dest.exists())
        self.cli('spawn-player.py','astra-99','--worktree',dest,'--brief-file',bf,'--dry-run')
        spawn.copy_previous(src,dest/'example/agents/astra-99')
        self.assertEqual((dest/'example/agents/astra-99/agent.ts').read_text(),'previous')
        with self.assertRaises(ValueError): spawn.copy_previous(src,dest/'example/agents/astra-99')
        self.cli('spawn-player.py','astra-99','blank','--worktree',dest,'--dry-run',success=False)
        self.cli('spawn-player.py','astra-99','blank','--worktree',dest,'--reuse','--dry-run',success=False)
        self.assertNotIn('{{',spawn.brief('astra-99','blank'))
        self.cli('spawn-player.py',*args,'--reuse',success=False)

    def test_spawn_main_copies_previous_and_delivers_custom_brief_with_stub_model(self):
        source=self.path/'previous'; src=source/'example/agents/astra-99'; src.mkdir(parents=True)
        (src/'agent.ts').write_text('previous code'); (src/'prompt.md').write_text('prompt')
        dest=self.path/'generation-2'; dest.mkdir()
        brief=self.path/'generation.md'; brief.write_text('CUSTOM GENERATION BRIEF')
        argv=['spawn-player','astra-99','--reuse','--worktree',str(dest),
              '--from-worktree',str(source),'--brief-file',str(brief)]
        def started(command, **kwargs):
            self.assertIn('CUSTOM GENERATION BRIEF',command[-1])
            self.assertIn('CUSTOM GENERATION BRIEF',(dest/'BRIEF.md').read_text())
            self.assertEqual((dest/'example/agents/astra-99/agent.ts').read_text(),'previous code')
            self.assertEqual(Path(kwargs['cwd']).resolve(),dest.resolve())
            child=Mock(); child.wait.side_effect=subprocess.TimeoutExpired(command, .3); return child
        with patch.object(sys,'argv',argv), patch.object(spawn,'SCAFFOLD',self.path), \
             patch.object(spawn.subprocess,'Popen',side_effect=started) as child, \
             patch.object(spawn.subprocess,'check_call') as git, patch.object(spawn,'validate_worktree'), contextlib.redirect_stdout(io.StringIO()):
            spawn.main()
            child.assert_called_once(); git.assert_not_called()
        self.assertTrue((self.path/'.codex-task/players/generation-2.log').exists())

    def confirm_args(self, index):
        return argparse.Namespace(label='confirm-test',seeds='9001 9002',selection_index=[str(index)],parallel=1,
                base_port=8647,regimes='calm',dir='ascon-zeta',env=['ASCON_TEST_PARAMS={"x":1}'],min_loop_iterations=360,dry_run=True)

    def test_confirmation_dry_run_and_seed_overlap(self):
        index,_=self.fixture(); a=self.confirm_args(index)
        roster,agents,run,compare=confirm.plan(a)
        self.assertEqual([x['id'] for x in agents],['noop','multi-arb','crowd','clean-arb','cand'])
        self.assertEqual(agents[-1]['env']['ASCON_TEST_PARAMS'],'{"x":1}')
        self.assertIn('multi-arb',compare); self.assertFalse(roster.exists())
        text=self.cli('confirm-candidate.sh','--dir','ascon-zeta','--label','confirm-test','--seeds','9001',
                      '--selection-index',index,'--dry-run')
        self.assertIn('DRY RUN',text); self.assertFalse(roster.exists())
        a.seeds='01'
        with self.assertRaisesRegex(ValueError,'overlaps'): confirm.plan(a)
        a.seeds='9001'; a.env=['PRIVATE_KEY=secret']
        with self.assertRaises(ValueError): confirm.plan(a)

    def test_confirmation_execution_uses_stubs_and_stops_on_failure(self):
        # All paths and child commands are synthetic. Test both wrapper branches.
        roster=self.path/'plan.yaml'; run=['fake-matrix']; compare=['fake-compare']
        argv=['confirm','--dir','fake','--label','fake','--seeds','99','--selection-index','fake']
        for rc,expected in [(0,2),(7,1)]:
            if roster.exists(): roster.unlink()
            with patch.object(sys,'argv',argv), patch.object(confirm,'plan',return_value=(roster,[{'env':{}}],run,compare)), \
                 patch.object(confirm.subprocess,'call',side_effect=[rc,0]) as call, contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as exit_: confirm.main()
                self.assertEqual(exit_.exception.code,rc)
                self.assertEqual(call.call_count,expected)
            self.assertFalse(roster.exists())


if __name__ == '__main__': unittest.main()
