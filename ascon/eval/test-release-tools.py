#!/usr/bin/env python3
"""Offline controls; optional module path supports deliberate broken-helper red checks."""
import importlib.util
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
import zipfile

spec = importlib.util.spec_from_file_location('release_tools', sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).with_name('release-tools.py')))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
mode = sys.argv[1] if len(sys.argv) > 1 else 'all'


class SelftestControls(unittest.TestCase):
    BUILD_INPUTS = (
        'deployer/node_modules', 'deployer/out', 'deployer/cache',
        'deployer/vendor/aave/node_modules',
        'deployer/vendor/gmx-src', 'deployer/vendor/liquity-src',
    )

    # Independent list: dropping an output from production must fail these fixtures.
    WRITABLE_PATHS = (
        'deployer/deployments', 'deployer/vendor/aave/deployments',
        'deployer/vendor/aave/cache', 'deployer/vendor/aave/artifacts',
        'deployer/vendor/gmx-src/deployments/localhost',
        'deployer/vendor/gmx-src/cache', 'deployer/vendor/gmx-src/artifacts',
        'deployer/vendor/gmx-src/typechain', 'deployer/vendor/gmx-src/typechain-types',
    )

    SEEDED_PATHS = (
        'deployer/vendor/aave/cache', 'deployer/vendor/aave/artifacts',
        'deployer/vendor/gmx-src/cache', 'deployer/vendor/gmx-src/artifacts',
        'deployer/vendor/gmx-src/typechain', 'deployer/vendor/gmx-src/typechain-types',
    )

    def test_missing_build_outputs_stay_absent(self):
        with tempfile.TemporaryDirectory() as td:
            main, tree = Path(td) / 'main', Path(td) / 'tree'
            for name in self.BUILD_INPUTS:
                (main / name).mkdir(parents=True)
            m.prepare_deployer(tree, main)
            for name in self.SEEDED_PATHS:
                self.assertFalse((tree / name).exists(), name)
                self.assertFalse((tree / name).is_symlink(), name)

    def test_clone_fallback_only_when_unsupported(self):
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / 'source'
            source.mkdir()
            (source / 'sentinel').write_text('prebuilt')
            actual_run = subprocess.run
            for error in ('Operation not supported', 'Permission denied', 'No space left on device'):
                target = Path(td) / error
                def copy(cmd, **kw):
                    if cmd[1] == '-cR':
                        return subprocess.CompletedProcess(cmd, 1, '', 'cp: fixture: ' + error)
                    return actual_run(cmd, **kw)
                with patch.object(m.sys, 'platform', 'darwin'), patch.object(m.sp, 'run', side_effect=copy) as calls:
                    if error == 'Operation not supported':
                        with patch('builtins.print') as log:
                            m.seed_build_output(source, target)
                        self.assertIn('cp -R (clone unsupported)', log.call_args.args[0])
                        self.assertEqual((target / 'sentinel').read_text(), 'prebuilt')
                        self.assertEqual(calls.call_count, 2)
                    else:
                        with self.assertRaises(subprocess.CalledProcessError):
                            m.seed_build_output(source, target)
                        self.assertEqual(calls.call_count, 1)

    def test_vendor_deploy_writes_are_isolated(self):
        with tempfile.TemporaryDirectory() as td:
            main, tree = Path(td) / 'main', Path(td) / 'tree'
            for name in self.BUILD_INPUTS + self.WRITABLE_PATHS:
                (main / name).mkdir(parents=True, exist_ok=True)
            gmx = 'deployer/vendor/gmx-src'
            for name in ('node_modules', 'contracts', 'deployments/arbitrum'):
                (main / gmx / name).mkdir(parents=True)
                (main / gmx / name / 'input').write_text('shared input')
            for name in self.WRITABLE_PATHS:
                (main / name / 'sentinel').write_text('original')
            m.prepare_deployer(tree, main)
            for name in self.WRITABLE_PATHS:
                with self.subTest(path=name):
                    target = tree / name
                    # Exercise writes BEFORE layout assertions: the red check must
                    # detect changed main bytes, not merely a different link shape.
                    (target / 'sentinel').write_text('deploy overwrite')
                    (target / 'new-output').write_text('deploy create')
                    self.assertEqual((main / name / 'sentinel').read_text(), 'original', name)
                    self.assertFalse((main / name / 'new-output').exists(), name)
                    self.assertFalse(target.is_symlink(), name)
                    shutil.rmtree(target)
                    target.mkdir()
                    (target / 'after-reset').touch()
                    self.assertTrue((main / name / 'sentinel').is_file(), name)
            for name in ('', 'deployments'):
                self.assertFalse((tree / gmx / name).is_symlink())
            for name in ('node_modules', 'contracts', 'deployments/arbitrum'):
                self.assertTrue((tree / gmx / name).is_symlink())
                self.assertEqual((tree / gmx / name).resolve(), (main / gmx / name).resolve())

    def test_missing_deploy_build_inputs(self):
        for missing in self.BUILD_INPUTS:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                for name in self.BUILD_INPUTS:
                    if name != missing:
                        (root / 'main' / name).mkdir(parents=True)
                with self.assertRaises(m.Blocked) as caught:
                    m.prepare_deployer(root / 'tree', root / 'main')
                self.assertIn(missing, str(caught.exception))
                self.assertFalse((root / 'tree').exists())

    def test_deploy_inputs_and_local_outputs(self):
        for has_env in (False, True):
            with self.subTest(has_env=has_env), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                main, tree = root / 'main', root / 'tree'
                for name in self.BUILD_INPUTS:
                    (main / name).mkdir(parents=True)
                outputs = self.WRITABLE_PATHS
                for name in outputs:
                    (main / name).mkdir(parents=True, exist_ok=True)
                    (main / name / 'sentinel').write_text('preserve')
                # Simulate presence with a link to a harmless fixture; never open an .env.
                fixture = main / 'empty-fixture'
                fixture.touch()
                if has_env:
                    (main / 'deployer/.env').symlink_to(fixture)
                with patch.object(Path, 'open', side_effect=AssertionError('must not read inputs')):
                    m.prepare_deployer(tree, main)
                for name in self.BUILD_INPUTS:
                    if name == 'deployer/vendor/gmx-src':
                        continue
                    self.assertTrue((tree / name).is_symlink(), name)
                    self.assertEqual((tree / name).resolve(), (main / name).resolve())
                for name in outputs:
                    self.assertTrue((tree / name).is_dir(), name)
                    self.assertFalse((tree / name).is_symlink(), name)
                    if name in self.SEEDED_PATHS:
                        self.assertEqual((tree / name / 'sentinel').read_text(), 'preserve')
                    else:
                        self.assertEqual(list((tree / name).iterdir()), [])
                    (tree / name / 'new-output').touch()
                    self.assertFalse((main / name / 'new-output').exists())
                    self.assertEqual((main / name / 'sentinel').read_text(), 'preserve')
                env_link = tree / 'deployer/.env'
                self.assertEqual(env_link.is_symlink(), has_env)
                if has_env:
                    self.assertEqual(env_link.readlink(), main / 'deployer/.env')
                else:
                    self.assertFalse(env_link.exists())

    def test_arguments(self):
        for args in ([], ['arm'], ['../arm', 'abcdef0'], ['noop', 'abcdef0'], ['arm', '--HEAD'], ['arm', 'abcdef0', 'extra']):
            with self.assertRaises(m.Blocked):
                m.validate(args)
        self.assertEqual(m.validate(['arm-1', 'abcdef0']), ['arm-1', 'abcdef0'])

    def test_wrappers_reject(self):
        for script in ('docker-selftest.sh', 'release-bundle.sh'):
            p = subprocess.run(['/bin/bash', str(Path(__file__).with_name(script))], capture_output=True, text=True)
            self.assertEqual(p.returncode, 2)
            self.assertIn('BLOCKED', p.stdout)

    def test_marker_fixtures(self):
        passed = '[3/3] PASS arm: completed the self-test at memory cap 4g; 7 included transactions, 2 reverted.'
        self.assertEqual(m.verdict(passed, 'arm', 0), ('SELFTEST_PASS', passed))
        self.assertEqual(m.verdict('FAIL self-test: baseline died', 'arm', 1)[0], 'SELFTEST_FAIL')
        self.assertEqual(m.verdict('[3/3] FAIL arm: exit 137', 'arm', 1)[0], 'SELFTEST_FAIL')
        self.assertEqual(m.verdict(passed, 'arm', 1)[0], 'SELFTEST_FAIL')
        for log in ('PASS arm: no counts', passed.replace('arm:', 'other:'), passed + '\n' + passed, ''):
            self.assertEqual(m.verdict(log, 'arm', 0)[0], 'BLOCKED')

    def test_readiness_timeout_and_missing_file(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            log, dep = root / 'deploy.log', root / 'deployments.json'
            log.write_text('anvil is still running')
            proc = Mock()
            proc.poll.return_value = None
            with self.assertRaises(m.Blocked):
                m.wait_ready(log, dep, proc, 0)
            dep.write_text('{}')
            m.wait_ready(log, dep, proc, 0)
            log.write_text('deployed addresses; anvil is already running')
            with self.assertRaises(m.Blocked):
                m.wait_ready(log, dep, proc, 0)
            log.write_text('anvil is still running')
            proc.poll.return_value = 1
            with self.assertRaises(m.Blocked):
                m.wait_ready(log, dep, proc, 0)

    def test_port_collision(self):
        for port in (8700, 8750, 8810, 0, 65536):
            with self.assertRaises(m.Blocked):
                m.check_port(port)
        with patch.object(m.socket, 'socket') as sock:
            sock.return_value.__enter__.return_value.bind.side_effect = OSError('busy')
            with self.assertRaises(m.Blocked):
                m.check_port(8855)
        with patch.object(m.socket, 'socket'):
            m.check_port(8855)

    def test_lane_refusal(self):
        for path in ('/tmp/ascon-wt-12345678', '/tmp/lane-A/subdir', '/tmp/ascon-final/state-A'):
            with self.assertRaises(m.Blocked):
                m.safe_location(path)
        with tempfile.TemporaryDirectory() as td:
            lane = Path(td) / 'ascon-wt-12345678'
            lane.mkdir()
            alias = Path(td) / 'alias'
            alias.symlink_to(lane)
            with self.assertRaises(m.Blocked):
                m.safe_location(alias)

    def test_group_cleanup_after_leader_exit(self):
        proc = Mock(pid=12345)
        proc.poll.return_value = 0
        with patch.object(m.os, 'killpg') as kill, patch.object(m.time, 'sleep'):
            m.stop_group(proc)
            kill.assert_not_called()

    def test_group_cleanup_checks_leader_before_each_signal(self):
        for polls, signals in (([None, None], [m.signal.SIGTERM, m.signal.SIGKILL]),
                               ([None, 0], [m.signal.SIGTERM])):
            proc = Mock(pid=12345)
            proc.poll.side_effect = polls
            with patch.object(m.os, 'killpg') as kill, patch.object(m.time, 'sleep'):
                m.stop_group(proc)
                self.assertEqual([c.args[1] for c in kill.call_args_list], signals)
                proc.wait.assert_called_once()

    def test_container_cleanup_ownership(self):
        own = '[{"Mounts":[{"Source":"/tmp/owned/runs/a"}]}]'
        lane = '[{"Mounts":[{"Source":"/tmp/ascon-wt-123/runs/a"}]}]'
        with patch.object(m, 'containers', side_effect=[['own', 'lane'], ['lane']]), patch.object(m, 'run') as run:
            run.side_effect = [Mock(stdout=own), Mock(), Mock(stdout=lane), Mock(stdout=lane)]
            m.cleanup_containers('arm', Path('/tmp/owned'))
            removes = [c.args[0] for c in run.call_args_list if c.args[0][1] == 'rm']
            self.assertEqual(removes, [['docker', 'rm', '-f', 'own']])


class BundleControls(unittest.TestCase):
    def test_arguments(self):
        with self.assertRaises(m.Blocked):
            m.validate(['arm', 'HEAD'])

    def bundle_fixture(self, extra=None, changed=None, scan=None, missing=False):
        """Git blobs are immutable; the fake bundler can change both disk and ZIP."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            blobs = {'example/agents/arm/agent.ts': b'original',
                     'example/agents/lib/helper.ts': b'lib',
                     'example/agents/runtime/bot.ts': b'runtime',
                     'sdk/src/index.ts': b'sdk'}
            if extra and extra[0] == 'tracked':
                blobs['example/agents/arm/' + extra[1]] = b'fixture'
            for path, body in blobs.items():
                dest = root / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(body)
            output = root / 'output'
            output.mkdir()
            def command(cmd, **kw):
                if cmd[0] == 'git':
                    self.assertEqual(kw['cwd'], root)
                    if cmd[1] == 'ls-tree':
                        self.assertIn('abcdef01', cmd)
                        return Mock(stdout=b''.join(b'100644 blob ' + b'a' * 40 + b'\t' + p.encode() + b'\0' for p in blobs))
                    self.assertEqual(cmd[:2], ['git', 'show'])
                    self.assertTrue(cmd[2].startswith('abcdef01:'))
                    return Mock(stdout=blobs[cmd[2].split(':', 1)[1]])
                self.assertEqual(cmd[:5], ['node', '--import', 'tsx', 'scripts/bundleAgent.ts', 'arm'])
                self.assertNotIn('--submission', cmd)
                with zipfile.ZipFile(cmd[-1], 'w') as z:
                    for path, body in blobs.items():
                        name = path.removeprefix('example/')
                        if missing and name == 'agents/arm/agent.ts':
                            continue
                        if name == changed:
                            body = b'mutated by bundler'
                            (root / path).write_bytes(body)
                        z.writestr(name, body)
                    if extra and extra[0] == 'untracked':
                        z.writestr(extra[1], b'fixture')
            result = scan or {'accept': True, 'blocks': 0, 'findings': []}
            with patch.object(m, 'run', side_effect=command), patch.object(m.sp, 'run', return_value=Mock(returncode=0, stdout=m.json.dumps(result))):
                marker, detail = m.bundle(root, 'arm', 'abcdef01', output)
            receipt = output / 'bundle-arm.json'
            if marker == 'RELEASE_PASS':
                record = m.json.loads(receipt.read_text())
                self.assertEqual(record['commit'], 'abcdef01')
                self.assertEqual(record['zip_sha256'], m.hashlib.sha256((output / 'bundle-arm.zip').read_bytes()).hexdigest())
            return marker, receipt.exists()

    def test_bundle_record_and_commands(self):
        self.assertEqual(self.bundle_fixture(), ('RELEASE_PASS', True))

    def test_missing_agent_file(self):
        self.assertEqual(self.bundle_fixture(missing=True)[0], 'RELEASE_FAIL')

    def test_unexpected_zip_members(self):
        for prefix in ('agents/arm/', 'agents/lib/', 'agents/runtime/', 'sdk/'):
            with self.subTest(prefix=prefix):
                self.assertEqual(self.bundle_fixture(extra=('untracked', prefix + 'extra.ts'))[0], 'RELEASE_FAIL')

    def test_compares_release_blobs_after_bundler_mutates_disk(self):
        for name in ('agents/arm/agent.ts', 'agents/lib/helper.ts', 'agents/runtime/bot.ts', 'sdk/src/index.ts'):
            with self.subTest(name=name):
                self.assertEqual(self.bundle_fixture(changed=name)[0], 'RELEASE_FAIL')

    def test_agent_extension_allowlist(self):
        # Synthetic names and bytes only; never open actual credential files.
        for name in ('.env', 'private.pem', 'private.key', 'payload.bin', '.env.md'):
            with self.subTest(name=name):
                self.assertEqual(self.bundle_fixture(extra=('tracked', name))[0], 'RELEASE_FAIL')
        self.assertEqual(self.bundle_fixture(extra=('tracked', 'prompt.md'))[0], 'RELEASE_PASS')

    def test_secret_warn_rejects(self):
        scan = {'accept': True, 'blocks': 0, 'findings': [
            {'severity': 'WARN', 'path': 'agents/arm/agent.ts',
             'message': 'looks like a hardcoded secret/key/token'}]}
        self.assertEqual(self.bundle_fixture(scan=scan)[0], 'RELEASE_FAIL')
        scan['findings'][0]['message'] = 'reads process env (may try to exfiltrate operator secrets)'
        self.assertEqual(self.bundle_fixture(scan=scan)[0], 'RELEASE_PASS')

    def test_rejected_scan_has_no_release_receipt(self):
        self.assertEqual(self.bundle_fixture(scan={'accept': False, 'blocks': 1, 'findings': []}),
                         ('RELEASE_FAIL', False))

    def test_release_commit_git_reads(self):
        repo = Path(__file__).resolve().parents[2]
        full = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, check=True,
                              capture_output=True, text=True).stdout.strip()
        paths = ('example/agents/opus-1g2/agent.ts', 'example/agents/opus-1g2/prompt.md',
                 'example/agents/lib/affordable.ts', 'example/agents/runtime/llm.ts', 'sdk/package.json')
        with tempfile.TemporaryDirectory() as td:
            archive = Path(td) / 'fixture.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                for path in paths:
                    blob = subprocess.run(['git', 'show', full + ':' + path], cwd=repo,
                                          check=True, capture_output=True).stdout
                    z.writestr(path.removeprefix('example/'), blob)
            self.assertEqual(len(m.check_zip(repo / 'example/agents/opus-1g2', archive, 'opus-1g2', full)), 5)
            with zipfile.ZipFile(archive, 'a') as z:
                z.writestr('sdk/unexpected.ts', b'fixture')
            with self.assertRaises(ValueError):
                m.check_zip(repo / 'example/agents/opus-1g2', archive, 'opus-1g2', full)

    def test_scanner_secret_warning_contract(self):
        repo = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as td:
            archive = Path(td) / 'fixture.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('agents/arm/agent.ts', "const fixture = 'sk-" + 'x' * 24 + "';")
            result = subprocess.run(['python3', 'infra/submission/scan-submission.py', str(archive), '--json'],
                                    cwd=repo, check=True, capture_output=True, text=True)
            scan = m.json.loads(result.stdout)
            self.assertTrue(scan['accept'])
            self.assertIn({'severity': 'WARN', 'path': 'agents/arm/agent.ts',
                           'message': 'looks like a hardcoded secret/key/token'}, scan['findings'])
            self.assertEqual(self.bundle_fixture(scan=scan), ('RELEASE_FAIL', False))

    def test_documented_diff_failure_is_blocked(self):
        repo = Path(__file__).resolve().parents[2]
        for doc in ('docs/plan-final.md', 'docs/submission-runbook.md'):
            with self.subTest(doc=doc):
                text = (repo / doc).read_text()
                if doc.endswith('runbook.md'):
                    commands = [line.strip() for line in text.splitlines()
                                if line.strip().startswith(('git diff --name-only', 'grep -vxF'))]
                else:
                    commands = m.re.findall(r'`((?:git diff --name-only|grep -vxF)[^`]+)`', text)
                for evaluated in ('unknown-evaluated-commit', 'HEAD'):
                    with tempfile.TemporaryDirectory() as td:
                        command = commands[0].replace('<測った commit>', evaluated).replace('<出荷 commit>', 'HEAD').replace('<arm>', 'opus-1g2')
                        command = command.replace('/tmp/ascon-release-diff.out', str(Path(td) / 'out'))
                        result = subprocess.run(['/bin/bash', '-c', command], cwd=repo, capture_output=True, text=True)
                        if evaluated != 'HEAD':
                            self.assertIn('BLOCKED', result.stdout, doc)
                        else:
                            self.assertEqual(result.returncode, 0)
                            self.assertEqual(result.stdout, '')
                            self.assertEqual(len(commands), 2)
                            grep = commands[1].replace('<arm>', 'opus-1g2').replace('/tmp/ascon-release-diff.out', str(Path(td) / 'out'))
                            result = subprocess.run(['/bin/bash', '-c', grep], cwd=repo, capture_output=True, text=True)
                            self.assertEqual(result.stdout, '')
                            self.assertEqual(result.returncode, 1)  # grep: no forbidden paths


suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in
                           ([SelftestControls, BundleControls] if mode == 'all' else
                            [SelftestControls if mode == 'selftest' else BundleControls]))
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
