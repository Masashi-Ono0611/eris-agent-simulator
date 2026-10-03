"""Counterexamples for player verification, release evidence, and begin manifests."""
import contextlib
import hashlib
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

ROOT=Path(__file__).resolve().parents[1]
LEAGUE=ROOT/'ascon-notes/league'
sys.path.insert(0,str(LEAGUE))

def load(path):
    spec=importlib.util.spec_from_file_location(path.stem.replace('-','_'),path)
    m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


class PlayerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name); self.wt=self.root/'league-fixture'
        self.agent=self.wt/'example/agents/fixture'; self.agent.mkdir(parents=True)
        (self.agent/'agent.ts').write_text('export const decide = () => null;')
        (self.agent/'prompt.md').write_text('---\nkind: improve\nname: fixture\ndescription: test\n---\n')
        (self.wt/'test').mkdir(); (self.wt/'test/fixture.test.ts').write_text('// stubbed')
        self.bin=self.root/'bin'; self.bin.mkdir()
        self.stub('npm', 'echo "PASS (1 files)"\nexit 0')
        self.node(0)
        # Old shell derives sibling league-<id> from script location; preserve that layout.
        scaffold=self.root/'scaffold/ascon-notes/league'; scaffold.mkdir(parents=True)
        for p in LEAGUE.glob('verify-player.*'): (scaffold/p.name).write_text(p.read_text())
        self.script=scaffold/'verify-player.sh'
    def stub(self,name,body):
        p=self.bin/name; p.write_text('#!/bin/bash\n'+body+'\n'); p.chmod(0o755)
    def node(self,code,prompt=False):
        self.stub('node','case "$*" in *check-prompts*) echo "PASS staged/fixture"; exit '+str(code if prompt else 0)+';; esac\nprintf "PASS\\nℹ tests 1\\nℹ pass 1\\nℹ fail 0\\n"\nexit '+str(0 if prompt else code))
    def call(self):
        return subprocess.run(['/bin/bash',str(self.script),'fixture'],text=True,capture_output=True,
                              env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH']})
    def test_valid(self): self.assertEqual(self.call().returncode,0)
    def test_failing_test_prints_pass(self): self.node(7); self.assertNotEqual(self.call().returncode,0)
    def test_failing_prompt_prints_pass(self): self.node(7,prompt=True); self.assertNotEqual(self.call().returncode,0)
    def test_nested_forbidden_rpc(self):
        (self.agent/'nested').mkdir(); (self.agent/'nested/helper.ts').write_text("const method='anvil_setBalance';")
        self.assertNotEqual(self.call().returncode,0)
    def test_relative_import_variants(self):
        (self.agent/'nested').mkdir()
        for code in ["import x from '../../other/agent.js'", "const x=require('../../other/agent.js')", "import('../../other/agent.js')", "import '../../other/agent.js'", "import(`../../other/agent.js`)", "require('./' + '../../other/agent.js')"]:
            (self.agent/'nested/helper.ts').write_text(code)
            with self.subTest(code=code): self.assertNotEqual(self.call().returncode,0)
        (self.agent/'nested/helper.ts').write_text("import x from '../agent.js'")
        self.assertEqual(self.call().returncode,0)
    def test_json_exit_codes(self):
        r=subprocess.run(['/bin/bash',str(self.script),'fixture','--json'],text=True,capture_output=True,env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH']})
        d=json.loads(r.stdout); self.assertEqual(d['status'],'PASS'); self.assertEqual(d['checks']['tests']['exit_code'],0)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); self.root=Path(self.tmp.name)
        self.prep=load(ROOT/'ascon-notes/release/prepare-release.py')
        src=self.root/'example/agents/src'; src.mkdir(parents=True)
        (src/'agent.ts').write_text('export const decide = () => null;')
        (src/'prompt.md').write_text('---\nname: src\n---\n')
        import zipfile
        with zipfile.ZipFile(self.root/'bundle-out.zip','w') as z: z.writestr('sdk/src/constants.local.ts','constants\n')
        self.digest=hashlib.sha256((self.root/'bundle-out.zip').read_bytes()).hexdigest()
        self.commit='a'*40
    def call(self,extra=()):
        def run(root,command):
            out=''
            if command[:2]==['git','show']: out='constants\n'
            if command[:2]==['git','rev-parse']: out=self.commit+'\n'
            if 'scan-submission.py' in ' '.join(command): out='--- 0 BLOCK, 0 WARN -> ACCEPT\n'
            return subprocess.CompletedProcess(command,0,out)
        out=io.StringIO()
        with patch.object(sys,'argv',['prep','--root',str(self.root),'--source','src','--name','out',*extra]), patch.object(self.prep,'run',side_effect=run),contextlib.redirect_stdout(out):
            code=self.prep.main()
        return code,out.getvalue()
    def evidence(self,**changes):
        back=dict(schema='ascon-g0-v1',status='PASS',failed=[],blocked=[],manifest_verified=True,manifest_sha256='b'*64,
                  commit=self.commit,zip_sha256=self.digest,expected={'agents':['out']})
        back.update(changes)
        selftest=dict(schema='ascon-selftest-v1',status='PASS',exit_code=0,commit=self.commit,zip_sha256=self.digest,
                      agent_id='out',command='agent:selftest',stdout='[3/3] PASS out: completed the self-test at memory cap 4g; 0 included transactions, 0 reverted.\nReport: runs/fixture/summary.json\n')
        b=self.root/'g0.json'; t=self.root/'selftest.json'; b.write_text(json.dumps(back)); t.write_text(json.dumps(selftest))
        return ['--backtest-evidence',str(b),'--selftest-evidence',str(t)]
    def test_legacy_self_attestation_not_ready(self):
        try:
            code,out=self.call(['--confirm-backtest','--confirm-selftest'])
        except SystemExit as e:
            code,out=e.code,''
        self.assertNotEqual(code,0); self.assertNotIn('RELEASE READY',out)

    def test_static_only_nonzero(self):
        code,out=self.call(); self.assertEqual(code,3,out); self.assertIn('READY ではない',out)
    def test_matching_evidence_ready(self):
        code,out=self.call(self.evidence()); self.assertEqual(code,0,out); self.assertIn('RELEASE READY',out)
    def test_stale_zip_not_ready(self):
        code,out=self.call(self.evidence(zip_sha256='0'*64)); self.assertNotEqual(code,0); self.assertNotIn('RELEASE READY',out)
    def test_stale_commit_not_ready(self):
        code,out=self.call(self.evidence(commit='c'*40)); self.assertNotEqual(code,0); self.assertNotIn('RELEASE READY',out)
    def test_unverified_g0_not_ready(self):
        code,out=self.call(self.evidence(status='FAIL')); self.assertNotEqual(code,0); self.assertNotIn('RELEASE READY',out)
    def test_selftest_nonzero_even_with_pass(self):
        args=self.evidence(); p=self.root/'selftest.json'; d=json.loads(p.read_text()); d['exit_code']=7; p.write_text(json.dumps(d))
        code,out=self.call(args); self.assertNotEqual(code,0); self.assertNotIn('RELEASE READY',out)

    def test_selftest_missing_success_output_rejected(self):
        args=self.evidence(); p=self.root/'selftest.json'; d=json.loads(p.read_text()); d['stdout']='PASS'; p.write_text(json.dumps(d))
        code,out=self.call(args); self.assertNotEqual(code,0); self.assertNotIn('RELEASE READY',out)

    def test_verify_existing_does_not_rebundle(self):
        code,_=self.call(); self.assertEqual(code,3)
        code,out=self.call(['--verify-existing',*self.evidence()])
        self.assertEqual(code,0,out)



class ManifestTests(unittest.TestCase):
    def test_begin_no_overwrite_verify_and_mutations(self):
        m=load(LEAGUE/'round_manifest.py')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); agents=root/'agents'; (agents/'a').mkdir(parents=True)
            (agents/'a/agent.ts').write_text('code'); prompt=agents/'a/prompt.md'; prompt.write_text('prompt')
            roster=root/'roster.yaml'; roster.write_text('agents:\n - id: a\n')
            with patch.object(m,'MANIFESTS',root/'manifests'),patch.object(m,'git_sha',return_value='a'*40):
                m.begin('r',roster,['calm'],['1'],3,agents)
                original=(root/'manifests/r.json').read_bytes()
                with self.assertRaises(FileExistsError): m.begin('r',roster,['calm'],['1'],3,agents)
                self.assertEqual((root/'manifests/r.json').read_bytes(),original)
                self.assertEqual(m.verify('r')['status'],'PASS')
                prompt.write_text('changed'); self.assertEqual(m.verify('r')['status'],'FAIL')
                prompt.write_text('prompt'); roster.write_text('agents:\n - id: b\n'); self.assertEqual(m.verify('r')['status'],'FAIL')
                roster.write_text('agents:\n - id: a\n')
                with patch.object(m,'git_sha',return_value='b'*40): self.assertEqual(m.verify('r')['status'],'FAIL')


if __name__=='__main__': unittest.main()
