"""Offline red controls. All mutations are in temporary copies; no commits."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
G3=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prestart',G3/'prestart-check.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class PrestartControls(unittest.TestCase):
    def test_candidate_mutation(self):
        with tempfile.TemporaryDirectory(prefix='g3-candidate-') as tmp:
            root=Path(tmp);copy=root/m.CANDIDATE
            shutil.copytree(m.ROOT/m.CANDIDATE,copy)
            baseline=m.tree('HEAD',m.CANDIDATE)
            with patch.object(m,'tree',return_value=baseline):
                self.assertTrue(m.candidate_check(root)['pass'])
                with (copy/'agent.ts').open('a') as f:f.write('\n// red control\n')
                self.assertFalse(m.candidate_check(root)['pass'])

    def test_used_seed(self):
        with tempfile.TemporaryDirectory(prefix='g3-seed-') as tmp:
            root=Path(tmp);(root/'index.tsv').write_text('regime\tseed\ncalm\t12001\n')
            self.assertTrue(m.audit_seeds([root])['pass'])
            shutil.copyfile(G3/'tests/fixtures/used-index.tsv',root/'index.tsv')
            result=m.audit_seeds([root]);self.assertFalse(result['pass'])
            self.assertEqual(result['hits'][0]['seed'],49001)

    def test_range_band_and_malformed(self):
        with tempfile.TemporaryDirectory(prefix='g3-range-') as tmp:
            root=Path(tmp);notes=root/'ascon-notes';notes.mkdir()
            for content in ['reserved 49000–49005','reserved 49xxx']:
                (notes/'plan.md').write_text(content)
                self.assertFalse(m.audit_seeds([root])['pass'])
            (notes/'plan.md').unlink();(root/'index.tsv').write_text('seed\ninvalid\n')
            self.assertFalse(m.audit_seeds([root])['pass'])

    def test_dirty_tree(self):
        with tempfile.TemporaryDirectory(prefix='g3-git-') as tmp:
            root=Path(tmp)/'copy'
            # Local shared object store, no network/commit, only one public source checked out.
            subprocess.run(['git','clone','--shared','--no-checkout','--quiet',str(m.ROOT),str(root)],check=True,capture_output=True)
            def git(*a):return subprocess.run(['git','-C',str(root),*a],check=True,capture_output=True)
            git('config','core.sparseCheckout','true')
            (root/'.git/info/sparse-checkout').write_text('/'+m.CANDIDATE+'/agent.ts\n')
            git('read-tree','-mu','HEAD')
            self.assertTrue(m.tracked_check(root)['pass'])
            with (root/m.CANDIDATE/'agent.ts').open('a') as f:f.write('\n// dirty red control\n')
            self.assertFalse(m.tracked_check(root)['pass'])

    def test_unknown_process_state_fails_closed(self):
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],3,'','inspection denied')):
            self.assertFalse(m.no_anvil()['pass'])
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','')):
            self.assertTrue(m.no_anvil()['pass'])

    def test_self_reservation_cannot_hide_drift(self):
        with tempfile.TemporaryDirectory(prefix='g3-self-') as tmp:
            root=Path(tmp);notes=root/'ascon-notes';notes.mkdir()
            plan=notes/'plan.md';plan.write_text('registered 49001')
            exclusions={str(plan.resolve()):m.digest(plan.read_bytes())}
            self.assertTrue(m.audit_seeds([root],exclusions)['pass'])
            plan.write_text('registered 49001 and 49102')
            self.assertFalse(m.audit_seeds([root],exclusions)['pass'])

    def test_roster_drift(self):
        with tempfile.TemporaryDirectory(prefix='g3-roster-') as tmp:
            root=Path(tmp);p=root/'ref.yaml';p.write_text('agents: []\n')
            lock={'inputs':{'ref.yaml':m.digest(p.read_bytes())},'agentTrees':{}}
            self.assertTrue(m.check_inputs(root,lock)['pass'])
            p.write_text('changed\n');self.assertFalse(m.check_inputs(root,lock)['pass'])

if __name__=='__main__':unittest.main()
