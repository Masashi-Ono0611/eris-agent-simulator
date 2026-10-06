import copy, datetime as dt, json, os, shutil, stat, subprocess, sys, tempfile, unittest
from unittest.mock import patch
from pathlib import Path
import chain
from gates import strict_g0

class Gates(unittest.TestCase):
    def base(self):
        return {'status':'FAIL','checks':{**{k:{'pass':True} for k in chain.CHECKS if k!='completeness'},'completeness':{'pass':False,'blocked':[chain.F_MIX]}}}
    def test_exact_exemption_green(self): self.assertTrue(chain.prestart_gate(self.base(),1))
    def test_every_other_check_red(self):
        for name in chain.CHECKS-{'completeness'}:
            with self.subTest(name=name):
                d=self.base(); d['checks'][name]['pass']=False
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
            p=subprocess.run([sys.executable,'-B','-c',code,sys.executable,'-B',str(chain.BASE/'gates.py'),'prestart',str(root/'pre.json'),str(root/'rc')],capture_output=True,text=True)
            self.assertEqual(p.returncode,2); self.assertNotIn('SHOULD_NOT_REACH',p.stdout)
    def test_schedule_order_and_freeze(self):
        normal,ref=chain.rows(); self.assertEqual(len(ref),18); self.assertEqual(sum(r['field']=='mix' for r in normal),18)
        for i,r in enumerate(ref):
            commands=chain.world_commands(r,paired=i%2==1)
            self.assertTrue(all('ERIS_AGENT_FROZEN' not in c['env'] for c in commands))
            run=next(c for c in commands if c['argv'][0]=='bash')
            self.assertEqual(run['env']['BACKTEST_EXTRA_ARGS'],'--blocks 360')
        paired=chain.world_commands(ref[3],True)[-2]['argv']
        self.assertIn('g3-r2-ref-calm-49002-on',paired); self.assertEqual(paired[-2:],['g3-r2-ref-calm-49002-off','--json'])
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
        p=subprocess.run([sys.executable,'-B',str(chain.BASE/'gates.py'),'revision-audit','test','on'],capture_output=True,text=True)
        self.assertEqual(p.returncode,2); self.assertEqual(json.loads(p.stdout)['status'],'BLOCKED')

class BudgetLedger(unittest.TestCase):
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

class ToolManifest(unittest.TestCase):
    def test_recorded_manifest_matches(self):
        self.assertEqual(set(chain.TOOL_MANIFEST),{'gates.py','revision_audit.py'})
        chain.tool_check()

    def test_drift_blocks_run_before_any_process(self):
        with tempfile.TemporaryDirectory(dir=chain.BASE) as td:
            root=Path(td)
            for name in chain.TOOL_MANIFEST: shutil.copyfile(chain.TOOL_ROOT/name,root/name)
            for name in chain.TOOL_MANIFEST:
                with self.subTest(name=name):
                    p=root/name; original=p.read_bytes(); p.write_bytes(original+b'\n# red control\n')
                    with patch.object(chain,'TOOL_ROOT',root),patch.object(sys,'argv',['chain.py','--run']),patch.object(subprocess,'Popen') as child:
                        with self.assertRaisesRegex(chain.Stop,'BLOCKED.*manifest mismatch'): chain.main()
                        child.assert_not_called()
                    p.write_bytes(original)
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
        with patch.dict(os.environ,{'HOME':'/tmp/g3-chain/fake-home'}),self.assertRaisesRegex(chain.Stop,'BLOCKED'):
            chain.ledger_path()

if __name__=='__main__': unittest.main(verbosity=2)
