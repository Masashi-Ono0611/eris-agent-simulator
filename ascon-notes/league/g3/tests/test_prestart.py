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
    def test_zero_sources_fail_closed(self):
        self.assertFalse(m.audit_seeds([])['pass'])
        with tempfile.TemporaryDirectory(prefix='g3-empty-') as tmp:
            result=m.audit_seeds([Path(tmp)])
            self.assertFalse(result['pass'])
            self.assertTrue(result['errors'])

    def test_sensitive_ancestor_does_not_hide_used_seed(self):
        with tempfile.TemporaryDirectory(prefix='g3-ancestor-') as tmp:
            for ancestor in ['secret', 'credential', 'private-key']:
                with self.subTest(ancestor=ancestor):
                    root=Path(tmp)/ancestor/'scan-root';root.mkdir(parents=True)
                    index=root/'index.tsv'
                    index.write_text('seed\n49001\n')
                    result=m.audit_seeds([root])
                    self.assertFalse(result['pass'])
                    self.assertEqual(result['hits'][0]['seed'],49001)
                    index.write_text('seed\n12001\n')
                    self.assertTrue(m.audit_seeds([root])['pass'])

    def test_each_root_must_contribute(self):
        with tempfile.TemporaryDirectory(prefix='g3-roots-') as tmp:
            full=Path(tmp)/'full';full.mkdir()
            empty=Path(tmp)/'empty';empty.mkdir()
            (full/'index.tsv').write_text('seed\n12001\n12002\n')
            result=m.audit_seeds([full,empty])
            self.assertFalse(result['pass'])
            self.assertEqual(result['rootSourceCounts'],{str(full):1,str(empty):0})
            (empty/'index.tsv').write_text('seed\n12003\n')
            self.assertTrue(m.audit_seeds([full,empty])['pass'])

    def test_skips_are_reported_without_reading(self):
        with tempfile.TemporaryDirectory(prefix='g3-skips-') as tmp:
            root=Path(tmp)
            (root/'index.tsv').write_text('seed\n12001\n')
            for name in ['node_modules','secret','credential','private-key']:
                (root/name).mkdir()
            (root/'linked-index.tsv').symlink_to(root/'index.tsv')
            # Mock directory entries: never create or read actual env/key files.
            walk=[(str(root),['node_modules','secret','credential','private-key'],
                   ['index.tsv','.env','signing.key','linked-index.tsv'])]
            read_bytes=Path.read_bytes
            def guarded_read(path):
                self.assertEqual(path,(root/'index.tsv').resolve())
                return read_bytes(path)
            with patch.object(m.os,'walk',return_value=iter(walk)), patch.object(Path,'read_bytes',guarded_read):
                result=m.audit_seeds([root])
            self.assertTrue(result['pass'])
            skipped={Path(r['path']).name:r['reason'] for r in result['skipped']}
            self.assertEqual(skipped,{'node_modules':'pruned-directory','secret':'sensitive-path',
                'credential':'sensitive-path','private-key':'sensitive-path','.env':'sensitive-path',
                'signing.key':'sensitive-path','linked-index.tsv':'symlink'})

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
            self.assertFalse(m.audit_seeds([root],exclusions)['pass'])
            (root/'index.tsv').write_text('seed\n12001\n')
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
