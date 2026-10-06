import copy, json, subprocess, sys, tempfile, unittest
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
    def test_daily_budget_survives_restart(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=chain.BASE) as td:
            root=Path(td)
            with patch.object(chain,'BASE',root):
                charges=[chain.reserve_budget() for _ in range(4)]
                self.assertEqual(charges,[6600,6600,6600,1800])
                with self.assertRaises(chain.Stop): chain.reserve_budget()
                ledger=json.loads((root/'budget-ledger.json').read_text())
                self.assertEqual(sum(x['reservedSeconds'] for x in ledger),21600)

    def test_no_arbitrary_audit_pass(self):
        p=subprocess.run([sys.executable,'-B',str(chain.BASE/'gates.py'),'revision-audit','test','on'],capture_output=True,text=True)
        self.assertEqual(p.returncode,2); self.assertEqual(json.loads(p.stdout)['status'],'BLOCKED')

if __name__=='__main__': unittest.main(verbosity=2)
