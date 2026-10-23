#!/usr/bin/env python3
"""Offline controls; optional module path supports deliberate broken-helper red checks."""
import importlib.util
from pathlib import Path
import subprocess
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
