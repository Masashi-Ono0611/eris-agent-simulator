import copy, datetime as dt, hashlib, json, os, shutil, stat, subprocess, sys, tempfile, unittest
from unittest.mock import patch
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
# chain.py now requires explicit G3_CHAIN_SOURCE / G3_CHAIN_SOURCE_COMMIT / G3_CHAIN_BASE
# and a source manifest in that base. Without them the launcher-dependent classes ERROR
# (never skip): they need a reviewed view. ExplicitInputs below runs without them.
try:
    import chain
    from gates import strict_g0
    CHAIN_UNAVAILABLE=None
except Exception as exc:
    chain=None; CHAIN_UNAVAILABLE=type(exc).__name__+': '+str(exc)

class NeedsChain(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if chain is None: raise RuntimeError('BLOCKED: chain.py not importable with current explicit inputs ('+CHAIN_UNAVAILABLE+')')

class RepositoryTools(NeedsChain):
    def setUp(self):
        # Verify the checked-in tools against the checked-in manifest. Do not mix
        # this launcher's new pins with a previously staged /tmp tool snapshot.
        tools = patch.object(chain, 'TOOL_ROOT', TOOLS)
        tools.start(); self.addCleanup(tools.stop)

class Gates(RepositoryTools):
    def base(self):
        return {'status':'FAIL','checks':{**{k:{'pass':True} for k in chain.CHECKS if k!='completeness'},'completeness':{'pass':False,'blocked':[chain.F_MIX]}}}
    def test_no_mix_exemption(self): self.assertFalse(chain.prestart_gate(self.base(),1))
    def test_complete_positive_control(self):
        d=self.base(); d['status']='PASS'; d['checks']['completeness']={'pass':True,'blocked':[]}
        self.assertTrue(chain.prestart_gate(d,0))
    def test_every_other_check_red(self):
        for name in chain.CHECKS-{'completeness'}:
            with self.subTest(name=name):
                d=self.base(); d['status']='PASS'; d['checks']['completeness']={'pass':True,'blocked':[]}
                self.assertTrue(chain.prestart_gate(d,0))
                d['status']='FAIL'; d['checks'][name]['pass']=False
                self.assertFalse(chain.prestart_gate(d,1))
    def test_other_completeness_red(self):
        d=self.base(); d['checks']['completeness']['blocked'].append('audited natural-Haiku safe-change fixture absent; delayed/change-revert world not ready')
        self.assertFalse(chain.prestart_gate(d,1))
    def test_malformed_and_exit_red(self):
        for rc in [0,2,124,-9]: self.assertFalse(chain.prestart_gate(self.base(),rc))
        d=self.base(); del d['checks']['seedAudit']; self.assertFalse(chain.prestart_gate(d,1))
        d=self.base(); d['checks']['futureCheck']={'pass':False}; self.assertFalse(chain.prestart_gate(d,1))
    def test_actual_pinned_blockers_red(self):
        d=self.base(); d['checks']['completeness']['blocked']=json.loads((chain.VIEW/chain.G3/'inputs.lock.json').read_text())['blocked']
        self.assertFalse(chain.prestart_gate(d,1))
    def test_gate_process_stops_next_command(self):
        # Red control runs the same gate process; a sentinel must never be reached.
        with tempfile.TemporaryDirectory(dir=chain.BASE) as td:
            root=Path(td); d=self.base(); d['checks']['candidate']['pass']=False
            (root/'pre.json').write_text(json.dumps(d)); (root/'rc').write_text('1')
            code='import subprocess,sys; p=subprocess.run(sys.argv[1:]); sys.exit(p.returncode) if p.returncode else print("SHOULD_NOT_REACH")'
            p=subprocess.run([sys.executable,'-B','-c',code,sys.executable,'-B',str(TOOLS/'gates.py'),'prestart',str(root/'pre.json'),str(root/'rc')],capture_output=True,text=True)
            self.assertEqual(p.returncode,2); self.assertNotIn('SHOULD_NOT_REACH',p.stdout)
    def test_schedule_order_and_freeze(self):
        normal,ref=chain.rows(); self.assertEqual(len(ref),18); self.assertEqual(sum(r['field']=='mix' for r in normal),18)
        for i,r in enumerate(ref):
            commands=chain.world_commands(r,paired=i%2==1)
            self.assertTrue(all('ERIS_AGENT_FROZEN' not in c['env'] for c in commands))
            run=next(c for c in commands if c['argv'][0]=='bash')
            self.assertEqual(run['env']['BACKTEST_EXTRA_ARGS'],'--blocks 360')
        # Pair labels come from the commit-bound schedule (ON row ref[2], OFF row ref[3]).
        self.assertEqual((ref[2]['regime'],ref[2]['seed'],ref[2]['mode'],ref[3]['mode']),('calm','49002','on','off'))
        paired=chain.world_commands(ref[3],True)[-2]['argv']
        self.assertIn(ref[2]['label'],paired); self.assertEqual(paired[-2:],[ref[3]['label'],'--json'])
    def test_dry_never_executes(self):
        from unittest.mock import patch
        with patch.object(sys,'argv',['chain.py','--dry-run']),patch.object(subprocess,'Popen',side_effect=AssertionError('process forbidden')),patch('builtins.print'):
            self.assertEqual(chain.main(),0)
    def test_strict_boundary_and_missing(self):
        with tempfile.TemporaryDirectory(dir=chain.BASE) as td:
            p=Path(td)/'g0.json'
            d={'status':'PASS','failed':[],'blocked':[],'manifest_verified':True,'runs':[{'status':'PASS','blocks':360,'loops':362,'p99_ms':999.9}]}
            p.write_text(json.dumps(d)); self.assertTrue(strict_g0(p))
            for v in [1000,1001,None,float('nan')]:
                d['runs'][0]['p99_ms']=v; p.write_text(json.dumps(d)); self.assertFalse(strict_g0(p))
    def test_supervisor_failure_and_deadline(self):
        import time
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=chain.BASE) as td:
            root=Path(td)
            with patch.object(chain,'BASE',root):
                supervisor=chain.Supervisor(); supervisor.deadline=time.monotonic()+10
                c=chain.command([sys.executable,'-B','-c','raise SystemExit(7)'],root,log='failure.log')
                with self.assertRaises(chain.Stop) as stopped: supervisor.run(c)
                self.assertEqual(stopped.exception.rc,7)
                self.assertEqual((root/'failure.log.exit').read_text().strip(),'7')
                supervisor.deadline=time.monotonic()+.1
                c=chain.command([sys.executable,'-B','-c','import time; time.sleep(10)'],root,log='deadline.log')
                with self.assertRaises(chain.Stop) as stopped: supervisor.run(c)
                self.assertEqual(stopped.exception.rc,124)
                self.assertEqual((root/'deadline.log.exit').read_text().strip(),'124')
                self.assertIsNone(supervisor.child)
    def test_no_arbitrary_audit_pass(self):
        p=subprocess.run([sys.executable,'-B',str(TOOLS/'gates.py'),'revision-audit','test','on'],capture_output=True,text=True)
        self.assertEqual(p.returncode,2); self.assertEqual(json.loads(p.stdout)['status'],'BLOCKED')

class BudgetLedger(NeedsChain):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=chain.BASE)
        self.addCleanup(self.temp.cleanup)
        self.ledger=Path(self.temp.name)/'home'/'.ascon-g3'/'budget-ledger.json'
        self.ledger.parent.parent.mkdir()
        # Only tests redirect persistence into the approved scratch tree; no real HOME writes.
        self.path_patch=patch.object(chain,'ledger_path',return_value=self.ledger)
        self.path_patch.start(); self.addCleanup(self.path_patch.stop)
        fixed=dt.datetime(2026,10,6,12,tzinfo=dt.timezone.utc)
        clock=patch.object(chain.dt,'datetime',wraps=dt.datetime)
        self.clock=clock.start(); self.addCleanup(clock.stop)
        self.clock.now.return_value=fixed

    def initialize(self):
        with patch.object(sys,'argv',['chain.py','--init-ledger']),patch.object(subprocess,'Popen',side_effect=AssertionError('process forbidden')),patch('builtins.print'):
            self.assertEqual(chain.main(),0)

    def test_missing_blocks_without_creation(self):
        with self.assertRaisesRegex(chain.Stop,'BLOCKED.*MISSING'): chain.reserve_budget()
        self.assertFalse(self.ledger.exists())
        self.initialize(); self.ledger.unlink()
        with self.assertRaisesRegex(chain.Stop,'BLOCKED.*MISSING'): chain.reserve_budget()
        self.assertFalse(self.ledger.exists())

    def test_corrupt_blocks_and_cannot_be_reinitialized(self):
        self.initialize()
        valid=json.loads(self.ledger.read_text())
        cases=['{broken','null','{}','[]','[1]',json.dumps([{}])]
        for changes in ({'reservedSeconds':-1},{'reservedSeconds':float('nan')},{'day':'bad-date'},{'started':'2026-10-06T12:00:00'}):
            bad=copy.deepcopy(valid); bad[0].update(changes); cases.append(json.dumps(bad))
        for raw in cases:
            with self.subTest(raw=raw):
                self.ledger.write_text(raw)
                with self.assertRaisesRegex(chain.Stop,'BLOCKED'): chain.reserve_budget()
                with self.assertRaisesRegex(chain.Stop,'BLOCKED'): chain.reserve_budget(init=True)
                self.assertEqual(self.ledger.read_text(),raw)

    def test_explicit_init_record_permissions_and_reservation(self):
        self.initialize()
        record=json.loads(self.ledger.read_text())
        self.assertEqual(record[0]['event'],'init')
        self.assertEqual(record[0]['reservedSeconds'],0)
        self.assertEqual(stat.S_IMODE(self.ledger.parent.stat().st_mode),0o700)
        self.assertEqual(stat.S_IMODE(self.ledger.stat().st_mode),0o600)
        self.assertEqual(chain.reserve_budget(),6600)
        self.assertEqual(stat.S_IMODE(self.ledger.stat().st_mode),0o600)
        with self.assertRaisesRegex(chain.Stop,'BLOCKED.*already exists'): self.initialize()

    def test_init_and_reserve_in_one_invocation(self):
        self.assertEqual(chain.reserve_budget(init=True),6600)
        self.assertEqual([x['event'] for x in json.loads(self.ledger.read_text())],['init','reserve'])

    def test_daily_budget_survives_restart(self):
        self.initialize()
        charges=[chain.reserve_budget() for _ in range(4)]
        self.assertEqual(charges,[6600,6600,6600,1800])
        self.assertTrue(all(charge<=110*60 for charge in charges))
        before=self.ledger.read_text()
        with self.assertRaisesRegex(chain.Stop,'BLOCKED.*exhausted'): chain.reserve_budget()
        self.assertEqual(self.ledger.read_text(),before)
        self.assertEqual(sum(x['reservedSeconds'] for x in json.loads(before)),6*3600)
        self.clock.now.return_value=dt.datetime(2026,10,7,12,tzinfo=dt.timezone.utc)
        self.assertEqual(chain.reserve_budget(),6600)

    def test_symlink_ledger_blocks(self):
        self.initialize()
        target=self.ledger.with_name('original.json'); self.ledger.rename(target)
        before=target.read_text(); self.ledger.symlink_to(target)
        with self.assertRaisesRegex(chain.Stop,'BLOCKED'): chain.reserve_budget()
        self.assertEqual(target.read_text(),before)

    def test_dry_run_cannot_initialize(self):
        with patch.object(sys,'argv',['chain.py','--dry-run','--init-ledger']),patch('sys.stderr'),self.assertRaises(SystemExit):
            chain.main()
        self.assertFalse(self.ledger.exists())

class ToolManifest(RepositoryTools):
    def test_recorded_manifest_matches(self):
        self.assertEqual(set(chain.TOOL_MANIFEST),{'gates.py','revision_audit.py','revision_replay.mjs'})
        chain.tool_check()

    def test_recorded_manifest_equals_recomputed_bytes(self):
        recomputed = {name: hashlib.sha256((TOOLS/name).read_bytes()).hexdigest()
                      for name in chain.TOOL_MANIFEST}
        self.assertEqual(chain.TOOL_MANIFEST, recomputed)

    def test_drift_blocks_run_before_any_process(self):
        with tempfile.TemporaryDirectory(dir=chain.BASE) as td:
            root=Path(td)
            for name in chain.TOOL_MANIFEST: shutil.copyfile(chain.TOOL_ROOT/name,root/name)
            with patch.object(chain,'TOOL_ROOT',root): chain.tool_check()
            for name in chain.TOOL_MANIFEST:
                with self.subTest(name=name):
                    p=root/name; original=p.read_bytes(); p.write_bytes(original+b'\n# red control\n')
                    with patch.object(chain,'TOOL_ROOT',root),patch.object(sys,'argv',['chain.py','--run']),patch.object(subprocess,'Popen') as child:
                        with self.assertRaisesRegex(chain.Stop,'BLOCKED.*manifest mismatch'): chain.main()
                        child.assert_not_called()
                    p.write_bytes(original)
                    with patch.object(chain,'TOOL_ROOT',root): chain.tool_check()
            (root/'gates.py').unlink()
            with patch.object(chain,'TOOL_ROOT',root),self.assertRaisesRegex(chain.Stop,'BLOCKED'): chain.tool_check()

    def test_drift_after_start_blocks_next_child(self):
        with tempfile.TemporaryDirectory(dir=chain.BASE) as td:
            with patch.object(chain,'TOOL_ROOT',Path(td)),patch.object(subprocess,'Popen') as child:
                supervisor=chain.Supervisor()
                with self.assertRaisesRegex(chain.Stop,'BLOCKED'):
                    supervisor.run(chain.command(['unused'],chain.BASE,log='NEVER_CREATED.log'))
                child.assert_not_called()

    def test_run_rejects_unpinned_audit_override(self):
        with patch.object(sys,'argv',['chain.py','--run','--audit-cmd','python3 unknown.py']),patch.object(subprocess,'Popen') as child:
            with self.assertRaisesRegex(chain.Stop,'BLOCKED.*manifest-pinned'): chain.main()
            child.assert_not_called()

    def test_main_applies_private_umask(self):
        with patch.object(os,'umask') as mask,patch.object(sys,'argv',['chain.py','--dry-run']),patch('builtins.print'):
            self.assertEqual(chain.main(),0)
            mask.assert_called_with(0o077)

    def test_persistent_default_path_and_temporary_home_blocked(self):
        with patch.dict(os.environ,{'HOME':'/Users/g3-ledger-test'}):
            self.assertEqual(chain.ledger_path(),Path('/Users/g3-ledger-test/.ascon-g3/budget-ledger.json'))
        with patch.dict(os.environ,{'HOME':'/tmp/g3-ledger-test/fake-home'}),self.assertRaisesRegex(chain.Stop,'BLOCKED'):
            chain.ledger_path()
        with patch.dict(os.environ,{'HOME':'/private/var/tmp/g3-ledger-test/fake-home'}),self.assertRaisesRegex(chain.Stop,'BLOCKED'):
            chain.ledger_path()

R2_COMMIT='ec80bb89df22e4899695a4cf2ba131382e130481'
NAMES=('G3_CHAIN_SOURCE','G3_CHAIN_SOURCE_COMMIT','G3_CHAIN_BASE')
G3_PATH='ascon-notes/league/g3'
VIEW_FILES=[G3_PATH+'/'+n for n in ('budget.json','schedule.tsv','ref-on.yaml','ref-off.yaml','inputs.lock.json','prestart-check.py')]+['config/regimes/'+n+'.yaml' for n in ('calm','crash','depeg')]

def nontmp_dir(case):
    td=tempfile.TemporaryDirectory(); case.addCleanup(td.cleanup)
    root=Path(td.name)
    if any(root.resolve().is_relative_to(Path(r).resolve()) for r in ('/tmp','/var/tmp')):
        case.fail('these controls need TMPDIR outside /tmp and /var/tmp')
    return root

def git_show(rev,name):
    return subprocess.check_output(['git','-C',str(TOOLS),'show',rev+':'+name])

def synthetic_base(base,rev,source,commit):
    """Test-only view: committed bytes of the files a dry run reads. Not make-view, not a real source."""
    for name in VIEW_FILES:
        p=base/'source-view'/name; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(git_show(rev,name))
    (base/'source-manifest.json').write_text(json.dumps({'source':str(source),'head':commit,'absoluteGitDir':str(source/'.git'),'files':{}}))

class ExplicitInputs(unittest.TestCase):
    """Positive controls: each new guard must fire (exit 2, named input) before any work."""
    def setUp(self):
        root=nontmp_dir(self); self.source=root/'source'; self.base=root/'base'
        self.source.mkdir(); self.base.mkdir()
        self.good={'G3_CHAIN_SOURCE':str(self.source),'G3_CHAIN_SOURCE_COMMIT':R2_COMMIT,'G3_CHAIN_BASE':str(self.base)}
    def env(self,changes=()):
        e={k:v for k,v in os.environ.items() if k not in NAMES}; e.update(self.good)
        for k,v in changes:
            if v is None: e.pop(k,None)
            else: e[k]=v
        return e
    def cases(self):
        absent=str(self.source/'absent')
        out=[]
        for name in ('G3_CHAIN_SOURCE','G3_CHAIN_BASE'):
            out += [(name,None,'missing or empty'),(name,'','missing or empty'),(name,'relative/dir','absolute path'),
                    (name,'/tmp','under /tmp'),(name,'/private/tmp','under /tmp'),(name,'/var/tmp','under /tmp'),
                    (name,'/private/var/tmp','under /tmp'),
                    (name,absent,'does not exist')]
        out.append(('G3_CHAIN_BASE','/tmp/g3-chain','under /tmp'))  # the old r2 base is not accepted
        out += [('G3_CHAIN_SOURCE_COMMIT',None,'missing or empty'),('G3_CHAIN_SOURCE_COMMIT','','missing or empty'),
                ('G3_CHAIN_SOURCE_COMMIT','ec80bb8','40 lowercase hex'),('G3_CHAIN_SOURCE_COMMIT',R2_COMMIT[:39],'40 lowercase hex'),
                ('G3_CHAIN_SOURCE_COMMIT',R2_COMMIT+'0','40 lowercase hex'),('G3_CHAIN_SOURCE_COMMIT','g'*40,'40 lowercase hex'),
                ('G3_CHAIN_SOURCE_COMMIT',R2_COMMIT.upper(),'40 lowercase hex'),('G3_CHAIN_SOURCE_COMMIT',' '+R2_COMMIT,'40 lowercase hex')]
        return out
    def run_tool(self,argv,changes):
        return subprocess.run(argv,env=self.env(changes),capture_output=True,text=True,timeout=60,cwd=self.base)
    def check_blocked(self,argv,names,stdout=False):
        for name,value,reason in self.cases():
            if name not in names: continue
            with self.subTest(tool=' '.join(map(str,argv[1:])),name=name,value=value):
                p=self.run_tool(argv,[(name,value)])
                text=p.stdout if stdout else p.stderr
                self.assertEqual(p.returncode,2,text)
                self.assertIn('BLOCKED',text); self.assertIn(name,text); self.assertIn(reason,text)
                self.assertEqual(sorted(os.listdir(self.base)),[])  # nothing written before the guard
    def test_chain_py_guards(self):
        self.check_blocked([sys.executable,'-B',str(TOOLS/'chain.py'),'--dry-run'],NAMES)
    def test_make_view_guards(self):
        self.check_blocked([sys.executable,'-B',str(TOOLS/'make-view.py')],NAMES)
    def test_revision_audit_guards(self):
        self.check_blocked([sys.executable,'-B',str(TOOLS/'revision_audit.py'),str(self.base),'--mode','on'],NAMES,stdout=True)
    def test_shell_entry_guards(self):
        self.check_blocked(['bash',str(TOOLS/'g3-ref-chain.sh'),'--dry-run'],('G3_CHAIN_BASE',))
    def test_node_tool_guards(self):
        node=shutil.which('node')
        self.assertIsNotNone(node,'node required for the .mjs guard controls')
        self.check_blocked([node,str(TOOLS/'malicious.mjs')],('G3_CHAIN_SOURCE',))
        self.check_blocked([node,str(TOOLS/'decide-budget-control.mjs')],('G3_CHAIN_SOURCE','G3_CHAIN_BASE'))
        self.check_blocked([node,str(TOOLS/'timeout-control.mjs')],('G3_CHAIN_SOURCE','G3_CHAIN_BASE'))
    def test_revision_audit_requires_deployment_in_base(self):
        p=self.run_tool([sys.executable,'-B',str(TOOLS/'revision_audit.py'),str(self.base),'--mode','on'],[])
        self.assertEqual(p.returncode,2); self.assertIn('placed directly in G3_CHAIN_BASE',p.stdout)
    def test_r2_values_pass_input_guard_then_need_manifest(self):
        # Explicit r2 commit passes the input guard; the launcher then stops at the next real check.
        p=self.run_tool([sys.executable,'-B',str(TOOLS/'chain.py'),'--dry-run'],[])
        self.assertEqual(p.returncode,2); self.assertIn('source-manifest.json missing',p.stderr)
        self.assertNotIn('G3_CHAIN_SOURCE_COMMIT must',p.stderr)
    def test_manifest_head_must_equal_explicit_commit(self):
        synthetic_base(self.base,'HEAD',self.source,'0'*40)
        p=self.run_tool([sys.executable,'-B',str(TOOLS/'chain.py'),'--dry-run'],[])
        self.assertEqual(p.returncode,2); self.assertIn('head/source differ',p.stderr)
    def test_r2_dry_run_reachable_only_when_explicit(self):
        # Synthetic view from the committed r2 bytes (ec80bb8) plus explicit r2 commit:
        # candidate dir and pair labels are derived from that view, not hardcoded.
        synthetic_base(self.base,R2_COMMIT,self.source,R2_COMMIT)
        p=self.run_tool([sys.executable,'-B',str(TOOLS/'chain.py'),'--dry-run'],[])
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertIn('g3-r2-ref-calm-49002-on',p.stdout); self.assertNotIn('g3-r3-',p.stdout)
        self.assertIn('G3_CHAIN_SOURCE_COMMIT='+R2_COMMIT,p.stdout)
    def test_r3_dry_run_from_current_commit_bytes(self):
        head=subprocess.check_output(['git','-C',str(TOOLS),'rev-parse','HEAD'],text=True).strip()
        synthetic_base(self.base,head,self.source,head); self.good['G3_CHAIN_SOURCE_COMMIT']=head
        p=self.run_tool([sys.executable,'-B',str(TOOLS/'chain.py'),'--dry-run'],[])
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertIn('g3-r3-ref-calm-49002-on',p.stdout); self.assertNotIn('g3-r2-',p.stdout)
    def test_candidate_mismatch_blocks(self):
        head=subprocess.check_output(['git','-C',str(TOOLS),'rev-parse','HEAD'],text=True).strip()
        synthetic_base(self.base,head,self.source,head); self.good['G3_CHAIN_SOURCE_COMMIT']=head
        pre=self.base/'source-view'/G3_PATH/'prestart-check.py'
        pre.write_text(pre.read_text().replace("CANDIDATE = 'example/agents/ascon-zeta-r3'","CANDIDATE = 'example/agents/ascon-zeta-r2'"))
        p=self.run_tool([sys.executable,'-B',str(TOOLS/'chain.py'),'--dry-run'],[])
        self.assertNotEqual(p.returncode,0); self.assertNotIn('g3-r3-ref-calm-49002-on',p.stdout)

class MakeViewExactCommit(unittest.TestCase):
    """make-view.py against a throwaway local git repository (no network)."""
    def setUp(self):
        root=nontmp_dir(self); self.repo=root/'repo'; self.repo.mkdir()
        g=['git','-C',str(self.repo),'-c','user.name=t','-c','user.email=t@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null']
        subprocess.run(g+['init','-q','-b','main'],check=True)
        (self.repo/'a.txt').write_text('a\n'); (self.repo/'.env').write_text('SECRET=x\n')
        subprocess.run(g+['add','a.txt','.env'],check=True); subprocess.run(g+['commit','-qm','x'],check=True)
        self.head=subprocess.check_output(['git','-C',str(self.repo),'rev-parse','HEAD'],text=True).strip()
        self.root=root
    def run_view(self,commit,base):
        base.mkdir()
        env={k:v for k,v in os.environ.items() if k not in NAMES}
        env.update(G3_CHAIN_SOURCE=str(self.repo),G3_CHAIN_SOURCE_COMMIT=commit,G3_CHAIN_BASE=str(base))
        return subprocess.run([sys.executable,'-B',str(TOOLS/'make-view.py')],env=env,capture_output=True,text=True,timeout=60)
    def test_exact_commit_view_and_manifest(self):
        base=self.root/'base'; p=self.run_view(self.head,base)
        self.assertEqual(p.returncode,0,p.stderr)
        m=json.loads((base/'source-manifest.json').read_text())
        self.assertEqual(m['head'],self.head); self.assertEqual(m['source'],str(self.repo))
        gitdir=subprocess.check_output(['git','-C',str(self.repo),'rev-parse','--absolute-git-dir'],text=True).strip()
        self.assertEqual(m['absoluteGitDir'],gitdir)
        self.assertEqual(set(m['files']),{'a.txt'}); self.assertIn('.env',m['skippedPaths'])
        self.assertEqual((base/'source-view'/'a.txt').read_text(),'a\n')
        again=subprocess.run([sys.executable,'-B',str(TOOLS/'make-view.py')],env={**os.environ,'G3_CHAIN_SOURCE':str(self.repo),'G3_CHAIN_SOURCE_COMMIT':self.head,'G3_CHAIN_BASE':str(base)},capture_output=True,text=True)
        self.assertEqual(again.returncode,2); self.assertIn('refuse overwriting',again.stderr)
    def test_other_valid_commit_rejected(self):
        # A well-formed explicit commit (r2's) that is not the source HEAD stops before writing.
        base=self.root/'base2'; p=self.run_view(R2_COMMIT,base)
        self.assertEqual(p.returncode,2); self.assertIn('HEAD differs',p.stderr); self.assertEqual(os.listdir(base),[])
    def test_prefix_commit_rejected(self):
        base=self.root/'base3'; p=self.run_view(self.head[:7],base)
        self.assertEqual(p.returncode,2); self.assertIn('40 lowercase hex',p.stderr); self.assertEqual(os.listdir(base),[])

if __name__=='__main__': unittest.main(verbosity=2)
