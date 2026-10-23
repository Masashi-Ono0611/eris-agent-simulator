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
mode = sys.argv[1]


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
            self.assertEqual(kill.call_count, 2)
            kill.assert_any_call(12345, m.signal.SIGTERM)
            kill.assert_any_call(12345, m.signal.SIGKILL)

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

    def test_fixture_zip(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / 'arm'
            source.mkdir()
            (source / 'agent.ts').write_bytes(b'export const decide = () => [];\n')
            (source / 'extra.bin').write_bytes(bytes(range(256)))
            archive = root / 'fixture.zip'
            for missing, changed in ((False, False), (True, False), (False, True)):
                with zipfile.ZipFile(archive, 'w') as z:
                    z.write(source / 'agent.ts', 'agents/arm/agent.ts')
                    if not missing:
                        z.writestr('agents/arm/extra.bin', b'changed' if changed else (source / 'extra.bin').read_bytes())
                if missing or changed:
                    with self.assertRaises(ValueError):
                        m.check_zip(source, archive, 'arm')
                else:
                    self.assertEqual(len(m.check_zip(source, archive, 'arm')), 2)

    def test_bundle_record_and_commands(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / 'example/agents/arm'
            source.mkdir(parents=True)
            (source / 'agent.ts').write_bytes(b'hello')
            output = root / 'output'
            output.mkdir()
            def build(cmd, **kw):
                self.assertEqual(cmd[:5], ['node', '--import', 'tsx', 'scripts/bundleAgent.ts', 'arm'])
                self.assertNotIn('--submission', cmd)
                with zipfile.ZipFile(cmd[-1], 'w') as z:
                    z.write(source / 'agent.ts', 'agents/arm/agent.ts')
            with patch.object(m, 'run', side_effect=build), patch.object(m.sp, 'run', return_value=Mock(returncode=0, stdout='{"accept": true, "blocks": 0}')):
                self.assertEqual(m.bundle(root, 'arm', 'abcdef01', output)[0], 'RELEASE_PASS')
                record = m.json.loads((output / 'bundle-arm.json').read_text())
                self.assertEqual(record['commit'], 'abcdef01')
                self.assertEqual(record['file_list'], ['agents/arm/agent.ts'])
                self.assertEqual(record['zip_sha256'], m.hashlib.sha256((output / 'bundle-arm.zip').read_bytes()).hexdigest())
                with self.assertRaises(m.Blocked):
                    m.bundle(root, 'arm', 'abcdef01', output)


suite = unittest.defaultTestLoader.loadTestsFromTestCase(SelftestControls if mode == 'selftest' else BundleControls)
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
