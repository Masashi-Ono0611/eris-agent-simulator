"""Offline regression checks: all shell runners use isolated roots and fake executables."""
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True


def module(relative):
    spec = importlib.util.spec_from_file_location('subject', ROOT / relative)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def executable(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(0o755)


class PlayerVerification(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ascon-verify-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.agent = self.root/'league-fixture/example/agents/fixture'
        self.agent.mkdir(parents=True)
        (self.agent/'agent.ts').write_text('export const decide = () => null;')
        (self.agent/'prompt.md').write_text('---\nkind: improve\nname: fixture\ndescription: test\n---\n')
        self.test = self.root/'league-fixture/test/fixture.test.ts'
        self.test.parent.mkdir()
        self.verify = module('ascon-notes/league/verify-player.py')
        self.verify.__file__ = str(self.root/'scaffold/ascon-notes/league/verify-player.py')

    def verify_tests(self, source, output, exit_code=0):
        self.test.write_text(source)
        def run(command, **kwargs):
            return subprocess.CompletedProcess(command, exit_code if '--test' in command else 0,
                                               output if '--test' in command else 'PASS')
        # Never start Node/npm: only their captured output is under test.
        with patch.object(self.verify.subprocess, 'run', side_effect=run), \
                patch.object(sys, 'argv', ['verify-player', 'fixture', '--json']), \
                contextlib.redirect_stdout(io.StringIO()) as stdout:
            code = self.verify.main()
        return code, json.loads(stdout.getvalue())['checks']['tests']

    def test_empty_and_all_skipped_suite_fail(self):
        for prefix in ('#', 'ℹ'):
            for source, count in [('// empty file', 0),
                                  ("import { test } from 'node:test'; test.skip('skipped', () => {});", 1)]:
                with self.subTest(prefix=prefix, source=source):
                    output = f'{prefix} tests {count}\n{prefix} pass 0\n{prefix} fail 0\n{prefix} skipped {count}\n'
                    code, check = self.verify_tests(source, output)
                    self.assertEqual(code, 1)
                    self.assertEqual(check, {'status':'FAIL', 'exit_code':0})

    def test_executed_test_required_with_no_failures(self):
        for prefix in ('#', 'ℹ'):
            for output, exit_code, expected in [
                (f'{prefix} pass 1\n{prefix} fail 0\n', 0, 'PASS'),
                (f'{prefix} pass 1\n{prefix} fail 1\n', 0, 'FAIL'),
                (f'{prefix} pass 1\n{prefix} fail 0\n', 7, 'FAIL'),
                (f'{prefix} pass 1\n', 0, 'FAIL'), ('PASS\n', 0, 'FAIL'), ('', 0, 'FAIL')]:
                with self.subTest(output=output, exit_code=exit_code):
                    _, check = self.verify_tests('// output fixture', output, exit_code)
                    self.assertEqual(check['status'], expected)

    def test_imported_lib_forbidden_rpc(self):
        lib = self.agent.parent/'lib'
        lib.mkdir()
        (lib/'helper.ts').write_text("client.request({ method: 'anvil_setBalance' });")
        for statement in ["import { helper } from '../lib/helper.js';",
                          "export * from '../lib/helper.js';", "import '../lib/helper.js';",
                          "require('../lib/helper.js');", "import('../lib/helper.js');"]:
            with self.subTest(statement=statement):
                (self.agent/'agent.ts').write_text(statement)
                self.assertIn('forbidden RPC: ../lib/helper.ts', self.verify.scan(self.agent))

    def test_transitive_runtime_dependency_and_cycle(self):
        lib = self.agent.parent/'lib'; lib.mkdir()
        runtime = self.agent.parent/'runtime'; runtime.mkdir()
        (runtime/'nested').mkdir()
        (self.agent/'agent.ts').write_text("import '../lib/helper.js';")
        (lib/'helper.ts').write_text("export * from '../runtime/nested';")
        helper = runtime/'nested/index.ts'
        helper.write_text("import '../../lib/helper.js';")
        self.assertEqual(self.verify.scan(self.agent), [])
        helper.write_text("import '../../lib/helper.js'; client.request({ method: 'evm_mine' });")
        self.assertEqual(self.verify.scan(self.agent), ['forbidden RPC: ../runtime/nested/index.ts'])

    def test_shared_dependency_escape_and_missing_import_fail(self):
        lib = self.agent.parent/'lib'; lib.mkdir()
        (self.agent/'agent.ts').write_text("import '../lib/helper.js';")
        for source, error in [("import '../other/agent.js';", 'cross-agent import:'),
                              ("import './missing.js';", 'unresolved local import:')]:
            with self.subTest(source=source):
                (lib/'helper.ts').write_text(source)
                self.assertTrue(any(e.startswith(error) for e in self.verify.scan(self.agent)))


class OfflineTools(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ascon-tools-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', TMPDIR=str(self.root), MIN_FREE_GB='0')

    def copy(self, relative):
        dest = self.root / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, dest)
        return dest

    def shell(self, path, *args):
        return subprocess.run(['/bin/bash', str(path), *args], cwd=self.root, env=self.env, capture_output=True, text=True, timeout=10)

    def index(self, label, entries):
        dest = self.root / 'out' / label / 'index.tsv'
        dest.parent.mkdir(parents=True)
        lines = ['regime\tseed\trun_dir\texit_code']
        for i, (regime, seed, summary) in enumerate(entries):
            run = dest.parent / f'run-{i}'
            run.mkdir()
            (run / 'summary.json').write_text(json.dumps(summary))
            lines.append(f'{regime}\t{seed}\t{run}\t0')
        dest.write_text('\n'.join(lines) + '\n')
        return dest

    def summary(self, pnl=10, loops=362):
        return dict(loopIterations=loops, valueSeries={'failedReads': 0}, agents=[
            {'id': aid, 'pnlUsdc': p} for aid, p in [('candidate', pnl), ('noop', 0), ('multi-arb', 0), ('crowd', 0)]])

    def test_compare_empty_and_disjoint(self):
        m = module('ascon-notes/eval/compare.py')
        a = self.index('iso-a', [('calm', 1, self.summary())])
        b = self.index('iso-b', [('crash', 1, self.summary())])
        empty = self.index('iso-empty', [])
        low = self.index('iso-low', [('calm', 1, self.summary(loops=1))])
        for inputs in ([a, b], [empty], [low], [a, low]):
            with self.subTest(inputs=inputs):
                self.assertIn('比較不能', m.render(inputs, 'multi-arb', 10, 1))

    def test_compare_directory_labels(self):
        m = module('ascon-notes/eval/compare.py')
        a = self.index('iso-a', [('calm', 1, self.summary())])
        b = self.index('iso-b', [('calm', 1, self.summary())])
        output = m.render([a.parent, b.parent], 'multi-arb', 10, 1)
        self.assertIn('## a\n', output)
        self.assertIn('## b\n', output)

    def test_compare_three_duplicates_across_inputs(self):
        m = module('ascon-notes/eval/compare.py')
        inputs = [self.index(f'iso-a-s{i}', [('calm', 1, self.summary()), ('crash', i, self.summary())]) for i in range(1, 4)]
        output = m.render(inputs, 'multi-arb', 10, 1)
        self.assertIn('使用した (regime, seed): 3（候補別の合計）', output)
        self.assertIn('候補内の対重複: 3', output)

    def test_compare_rejects_nonpositive_boot(self):
        index = self.index('iso-a', [('calm', 1, self.summary())])
        for boot in ('0', '-1'):
            result = subprocess.run(['python3', str(ROOT / 'ascon-notes/eval/compare.py'), str(index), '--boot', boot], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn('--boot', result.stderr)
            self.assertNotIn('Traceback', result.stderr)

    def test_malformed_summary_recorded_by_both_readers(self):
        for value in (None, [], 'bad', 42, {'valueSeries': []}, {'valueSeries': 'bad'}, {'valueSeries': 1}):
            index = self.index(f'iso-bad-{len(list(self.root.glob("out/*")))}', [('calm', 1, value)])
            for file in ('eval/compare.py', 'league/league-report.py'):
                with self.subTest(value=value, file=file):
                    m = module('ascon-notes/' + file)
                    rows = m.read_index(index) if hasattr(m, 'read_index') else m.read(index)
                    self.assertTrue(rows[0][3] if isinstance(rows[0], tuple) else rows[0]['reason'])
                    output = m.render([index], 'multi-arb', 10, 1) if hasattr(m, 'read_index') else m.render(rows)
                    self.assertIn('不正', output)

    def test_league_equal_regime_weight(self):
        m = module('ascon-notes/league/league-report.py')
        records = []
        for i, (regime, p) in enumerate([('calm', 10), ('calm', 10), ('crash', -10)]):
            records.append(dict(regime=regime, seed=str(i), loops=362, reason=None,
                agents={'astra-1': {'pnlUsdc': p}, 'opus-1': {'pnlUsdc': -p}}))
        # Uneven exclusions leave 2 calm runs and 1 crash run: equal weight is 50, not 53.3.
        records.append(dict(records[-1], seed='excluded', reason='failedReads不正'))
        output = m.render(records)
        # report prints two decimals; the point is equal regime weight (50.00), not the per-run mean (53.33)
        self.assertIn('| astra-1 | 50.00 | 40.00 |', output)
        self.assertIn('| astra | 50.00 |', output)
        self.assertIn('| opus | 50.00 |', output)
        self.assertNotIn('53.33', output)

    def test_roster_ids_are_quoted(self):
        m = module('ascon-notes/league/make-roster.py')
        m.ROOT = self.root
        for aid in ('123', 'true', 'null'):
            (self.root / 'example/agents' / aid).mkdir(parents=True)
        output = m.make(['123', 'true', 'null'], refs=())
        for aid in ('123', 'true', 'null'):
            self.assertIn(f'id: "{aid}"', output)

    def test_cleaner_pgrep_status(self):
        m = module('ascon-notes/eval/clean-anvil-tmp.py')
        for status in (0, 1, 2, 3, -15, -9):
            with self.subTest(status=status), patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], status)):
                self.assertEqual(m.anvil_running(), status != 1)

    def matrix(self):
        script = self.copy('ascon-notes/eval/run-matrix.sh')
        executable(self.root / 'ascon-notes/eval/anvil-shim/anvil', '#!/bin/bash\nexit 97\n')
        executable(self.bin / 'anvil', '#!/bin/bash\nexit 98\n')
        executable(self.bin / 'sleep', '#!/bin/bash\nexit 0\n')
        executable(self.bin / 'npm', '''#!/bin/bash
mkdir -p "$ASCON_ANVIL_HOME"
printf '%s' "$ASCON_ANVIL_HOME" > "$TMPDIR/home-path"
printf '%s\\n' '{"type":"run_completed","runDir":"runs/stub"}'
''')
        executable(self.bin / 'pgrep', '''#!/usr/bin/env python3
import os,signal,subprocess,sys
status=os.environ.get('PGREP_STATUS')
if status == 'signal': os.kill(os.getpid(),signal.SIGTERM)
if status is not None: sys.exit(int(status))
sys.exit(subprocess.run(['grep', '-E', '-q', sys.argv[-1]], input=os.environ['FAKE_COMMAND'], text=True).returncode)
''')
        (self.root / 'config/regimes').mkdir(parents=True)
        (self.root / 'config/regimes/calm.yaml').write_text('')
        (self.root / 'roster.yaml').write_text('')
        return script

    def run_matrix(self, script, regime='calm', seed='101'):
        return self.shell(script, '--label', 'test', '--roster', 'roster.yaml', '--regimes', regime, '--seeds', seed, '--parallel', '1')

    def test_matrix_pgrep_errors_keep_home(self):
        script = self.matrix()
        for status in ('1', '2', '3', 'signal'):
            with self.subTest(status=status):
                self.env['PGREP_STATUS'] = status
                result = self.run_matrix(script)
                self.assertEqual(result.returncode, 0, result.stderr)
                home = Path((self.root / 'home-path').read_text())
                self.assertEqual(home.exists(), status != '1', result.stderr)
                if status != '1': self.assertIn('warning:', result.stderr)

    def test_matrix_anvil_argument_order_and_boundaries(self):
        script = self.matrix()
        for command, live in [
            ('/opt/foundry/anvil --port 8547 --load-state state', True),
            ('/bin/bash /repo/anvil-shim/anvil --silent --port 8547', True),
            ('/opt/foundry/anvil --silent --port 8547 --load-state state', True),
            ('/opt/foundry/anvil --port 85470', False),
            ('/opt/foundry/not-anvil --port 8547', False),
        ]:
            with self.subTest(command=command):
                self.env['FAKE_COMMAND'] = command
                result = self.run_matrix(script)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(Path((self.root / 'home-path').read_text()).exists(), live)

    def test_matrix_identifier_validation(self):
        script = self.matrix()
        self.env['PGREP_STATUS'] = '1'
        for regime, seed in [('calm', '../escape'), ('../regimes/calm', '101'), ('calm', 'x.y')]:
            with self.subTest(regime=regime, seed=seed):
                result = self.run_matrix(script, regime, seed)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse((self.root / 'home-path').exists())

    def test_matrix_delete_resolves_path(self):
        source = (ROOT / 'ascon-notes/eval/run-matrix.sh').read_text()
        function = source.split('remove_anvil_home() {', 1)[1].split('\n}\n', 1)[0]
        script = self.root / 'remove.sh'
        script.write_text('remove_anvil_home() {' + function + '\n}\nremove_anvil_home "$1"\n')
        homes = self.root / 'homes'
        homes.mkdir()
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'keep').write_text('important')
        (homes / 'link').symlink_to(outside, target_is_directory=True)
        self.env['HOMES_ROOT'] = str(homes)
        for path in (str(homes) + '/../outside', str(homes / 'link')):
            with self.subTest(path=path):
                outside.mkdir(exist_ok=True)
                (outside / 'keep').write_text('important')
                self.shell(script, path)
                self.assertTrue((outside / 'keep').exists())
        owned = homes / 'calm-101'
        owned.mkdir()
        self.shell(script, str(owned))
        self.assertFalse(owned.exists())

    def test_iso_suite_preserves_child_failure(self):
        script = self.copy('ascon-notes/eval/run-iso-suite.sh')
        executable(self.bin / 'sleep', '#!/bin/bash\nexit 0\n')
        executable(self.root / 'ascon-notes/eval/run-matrix.sh', '#!/bin/bash\nprintf "call\\n" >> calls\ncase "$*" in *delta-bid*) exit 7;; esac\nexit 0\n')
        result = self.shell(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len((self.root / 'calls').read_text().splitlines()), 4)
        executable(self.root / 'ascon-notes/eval/run-matrix.sh', '#!/bin/bash\nexit 0\n')
        self.assertEqual(self.shell(script).returncode, 0)

    def probe(self):
        script = self.copy('ascon-notes/league/load-probe.sh')
        for aid in ('multi-arb', 'clean-arb', 'noop', 'venue-arb'):
            (self.root / 'example/agents' / aid).mkdir(parents=True)
        executable(self.root / 'ascon-notes/eval/run-matrix.sh', '#!/bin/bash\ntouch matrix-called\nexit 0\n')
        # load-probe runs a disk preflight with the real df; a CI runner has ~13 GB free. Stub it so these tests do not depend on the host's disk.
        executable(self.bin / 'df', '#!/bin/bash\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 999999999 0 999999999 0%% /\\n"\n')
        return script

    def test_load_probe_reused_label_preserves_roster(self):
        script = self.probe()
        old = script.parent / 'repeat-roster.yaml'
        old.write_text('preserve me')
        for _ in range(2):
            result = self.shell(script, '--agents', '8', '--parallel', '1', '--label', 'repeat', '--dry-run')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(old.exists())
            self.assertEqual(old.read_text(), 'preserve me')
        self.assertFalse((self.root / 'matrix-called').exists())
        self.assertEqual(list(script.parent.glob('*roster*')), [old])

    def test_load_probe_generation_failure_stops(self):
        script = self.probe()
        (self.root / 'example/agents/noop').rmdir()
        for extra in ([], ['--dry-run']):
            result = self.shell(script, '--agents', '8', '--parallel', '1', *extra)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((self.root / 'matrix-called').exists())
        self.assertEqual(list(script.parent.glob('*roster*')), [])

    def test_release_static_only_is_not_ready(self):
        import contextlib
        import io
        import zipfile
        m = module('ascon-notes/release/prepare-release.py')
        source = self.root / 'example/agents/src'
        source.mkdir(parents=True)
        (source / 'prompt.md').write_text('---\nname: src\n---\n')
        (source / 'agent.ts').write_text('export function decide() { return []; }')
        def fake_run(root, command):
            output = ''
            if 'scripts/bundleAgent.ts' in command:
                with zipfile.ZipFile(root / f'bundle-{command[-1]}.zip', 'w') as z:
                    z.writestr('sdk/src/constants.local.ts', 'constants')
            elif 'infra/submission/scan-submission.py' in command: output = '--- 0 BLOCK, 0 WARN -> ACCEPT\n'
            elif command[:2] == ['git', 'show']: output = 'constants'
            return subprocess.CompletedProcess(command, 0, output)
        with patch.object(m, 'run', side_effect=fake_run), patch.object(sys, 'argv', ['prepare', '--root', str(self.root), '--source', 'src', '--name', 'out']), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(m.main(), 3)
            self.assertNotIn('RELEASE READY', out.getvalue())
            self.assertIn('静的検査のみ通過（READY ではない）', out.getvalue())



if __name__ == '__main__':
    unittest.main()
