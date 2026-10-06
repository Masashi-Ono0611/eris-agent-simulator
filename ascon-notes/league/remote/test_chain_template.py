#!/usr/bin/env python3
"""Offline controls: temporary fake runners only; no simulator/network/key access."""
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('chain-template.sh').resolve()


class ChainControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='chain-controls-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.repo = self.root / 'repo with spaces'
        self.league = self.repo / 'ascon-notes/league'
        self.league.mkdir(parents=True)
        self.roster = self.repo / 'roster.yaml'
        self.roster.write_text('agents: [{id: alternate-agent}]\n')
        self.logs = self.root / 'logs'
        self.lock = self.root / 'host.lock'
        self.calls = self.root / 'calls'
        fake_bin = self.root / 'bin'
        fake_bin.mkdir()
        for name, code in {
            'pgrep': 'exit "${STUB_PGREP_RC:-1}"\n',
            'df': ('[ "${STUB_DF:-numeric}" != empty ] || exit 0\n'
                   'printf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 200000000 0 %s 0%% /\\n" "${STUB_DF:-104857600}"\n'),
        }.items():
            tool = fake_bin / name
            tool.write_text('#!/bin/bash\n' + code)
            tool.chmod(0o700)
        (self.league / 'round-manifest.py').write_text(
            'import os, sys\n'
            'with open(os.environ["STUB_CALLS"], "a") as f: f.write("manifest " + " ".join(sys.argv[1:]) + "\\n")\n'
            'if sys.argv[1] == "verify": sys.exit(int(os.environ.get("STUB_VERIFY_RC", "0")))\n'
        )
        (self.league / 'run-league.sh').write_text(
            '#!/bin/bash\n'
            'printf "matrix %s MIN_FREE_GB=%s\\n" "$*" "$MIN_FREE_GB" >> "$STUB_CALLS"\n'
            'exit "${STUB_MATRIX_RC:-0}"\n'
        )
        (self.league / 'g0.py').write_text(
            'import os, sys\n'
            'with open(os.environ["STUB_CALLS"], "a") as f: f.write("g0 " + sys.argv[1] + "\\n")\n'
            'verdict = os.environ.get("STUB_G0", "PASS") if sys.argv[1].endswith("c1") else "PASS"\n'
            'if verdict != "MISSING": print("G0 " + verdict)\n'
            'sys.exit({"PASS": 0, "FAIL": 1, "BLOCKED": 2, "MISSING": 0}[verdict])\n'
        )
        # Do not inherit credentials, MIN_FREE_GB, or runner configuration.
        self.env = {
            'PATH': f'{fake_bin}:{Path(sys.executable).parent}:/usr/bin:/bin',
            'HOME': str(self.root), 'TMPDIR': str(self.root),
            'STUB_CALLS': str(self.calls),
        }

    def run_chain(self, *args, dry=True, env=None):
        argv = ['/bin/bash', str(SCRIPT), '--repo', str(self.repo),
                '--roster', str(self.roster), '--prefix', 'testUTC',
                '--seeds', '63001 63002 63003', '--log-root', str(self.logs),
                '--lock-dir', str(self.lock), '--activity-note', 'fixture only']
        if dry:
            argv.append('--dry-run')
        result = subprocess.run(argv + list(args), env={**self.env, **(env or {})},
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        return result

    def refused(self, text, *args, env=None):
        result = self.run_chain(*args, env=env)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(text, result.stdout)
        self.assertFalse(self.calls.exists(), 'runner called before preflight completed')
        return result

    def test_bash_syntax(self):
        subprocess.run(['/bin/bash', '-n', str(SCRIPT)], check=True)

    def test_dry_run_exact_commands_and_fixed_groups(self):
        result = self.run_chain('--chunks', '1 3 4')
        self.assertEqual(result.returncode, 0, result.stdout)
        commands = [line for line in result.stdout.splitlines() if line.startswith('COMMAND:')]
        self.assertEqual(len(commands), 12)
        groups = ['calm cex-drift informed-flow', 'depeg vuln spike', 'depeg-persist cdp-incident launch']
        for offset, (number, group) in enumerate(zip([1, 3, 4], groups)):
            label = f'testUTC-c{number}'
            begin, run, verify, gate = map(shlex.split, commands[offset * 4:offset * 4 + 4])
            self.assertEqual(begin[2], str(self.repo))
            self.assertEqual(begin[begin.index('--regimes') + 1], group)
            self.assertEqual(begin[begin.index('--roster') + 1], str(self.roster))
            self.assertEqual(run[run.index('--label') + 1], label)
            self.assertIn('MIN_FREE_GB=40', run)
            self.assertIn('--parallel', run)
            self.assertEqual(verify[verify.index('verify') + 1], label + ')')
            self.assertEqual(gate[gate.index('--regimes') + 1:gate.index('--seeds')], group.split())
            self.assertEqual(gate[gate.index('--seeds') + 1:gate.index('--manifest')], ['63001', '63002', '63003'])
            self.assertTrue(run[-2].endswith(f'{label}-run.log'))
        self.assertNotIn('testUTC-c2', result.stdout)
        self.assertFalse(self.calls.exists())
        self.assertFalse(self.logs.exists())
        self.assertFalse(self.lock.exists())
        self.assertNotIn('CHAIN_END_testUTC=', result.stdout)

    def test_range(self):
        result = self.run_chain('--from', '2', '--to', '2')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('whale lending-incident crash', result.stdout)
        self.assertEqual(result.stdout.count('COMMAND:'), 4)

    def test_existing_manifest_red(self):
        manifests = self.league / 'manifests'
        manifests.mkdir()
        (manifests / 'testUTC-c4.json').write_text('{}')
        self.refused('existing label refused: testUTC-c4')

    def test_existing_output_red(self):
        (self.repo / 'ascon-notes/eval/out/testUTC-c3').mkdir(parents=True)
        self.refused('existing label refused: testUTC-c3')

    def test_disk_hard_stop_red(self):
        self.refused('free disk below hard stop 25 GB', '--min-free-gb', '25',
                     env={'CHAIN_TEST_MODE': '1', 'CHAIN_TEST_FREE_GB': '24'})

    def test_disk_default_red(self):
        self.refused('below effective MIN_FREE_GB',
                     env={'CHAIN_TEST_MODE': '1', 'CHAIN_TEST_FREE_GB': '39'})

    def test_disk_measurement_failure_red(self):
        for output in ['empty', 'not-a-number']:
            with self.subTest(df=output):
                self.refused('STOP: cannot measure disk', env={'STUB_DF': output})

    def test_disk_override_and_deviation(self):
        result = self.run_chain('--min-free-gb', '25',
                                env={'CHAIN_TEST_MODE': '1', 'CHAIN_TEST_FREE_GB': '25'})
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('free_GB=25 MIN_FREE_GB=25', result.stdout)
        self.assertIn('DEVIATION explicit --min-free-gb=25', result.stdout)
        self.assertIn('MIN_FREE_GB=25 NPM_CONFIG_IGNORE_SCRIPTS=true', result.stdout)

    def test_disk_override_cannot_escape_dry_run(self):
        result = self.run_chain(dry=False, env={'CHAIN_TEST_MODE': '1', 'CHAIN_TEST_FREE_GB': '100'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('test disk override requires', result.stdout)
        self.assertFalse(self.calls.exists())

    def test_disk_override_requires_test_mode(self):
        self.refused('test disk override requires', env={'CHAIN_TEST_FREE_GB': '100'})

    def test_inherited_threshold_red(self):
        self.refused('inherited MIN_FREE_GB refused', env={'MIN_FREE_GB': '25'})

    def test_lower_threshold_red(self):
        self.refused('below hard stop 25 GB', '--min-free-gb', '24')

    def test_missing_roster_red(self):
        self.roster.unlink()
        self.refused('missing roster')

    def test_lock_held_red(self):
        self.lock.mkdir()
        self.refused('lock held')
        self.assertTrue(self.lock.exists(), 'must not release another run lock')

    def test_anvil_and_unknown_probe_red(self):
        for rc, message in [('0', 'anvil already running')] + [
                (rc, 'pgrep anvil unavailable; fail closed') for rc in ['2', '3', '127', '255']]:
            with self.subTest(rc=rc):
                self.refused('STOP: ' + message, env={'STUB_PGREP_RC': rc})

    def test_invalid_selection_red(self):
        for args, message in [
                (('--chunks', '1 1'), 'duplicate chunk'),
                (('--chunks', '5'), 'chunks must be 1..4'),
                (('--chunks', ''), 'empty chunks'),
                (('--from', '4', '--to', '1'), 'reversed chunk range'),
                (('--chunks', '1', '--from', '1'), 'do not mix --chunks and --from/--to')]:
            with self.subTest(args=args):
                self.refused('STOP: ' + message, *args)

    def test_qualification_continuation_red(self):
        self.refused('diagnostics only', '--continue-on-g0-fail')

    def assert_finished(self, result, rc):
        self.assertEqual(result.returncode, rc, result.stdout)
        self.assertFalse(self.lock.exists())
        marker = f'CHAIN_END_testUTC={rc}\n'
        self.assertEqual((self.logs / 'testUTC/end.marker').read_text(), marker)
        self.assertTrue(result.stdout.endswith(marker))

    def test_stub_success_and_log_reuse_red(self):
        result = self.run_chain('--chunks', '1', '--min-free-gb', '25', dry=False)
        self.assert_finished(result, 0)
        self.assertIn('MIN_FREE_GB=25', self.calls.read_text())
        self.assertIn('DEVIATION', (self.logs / 'testUTC/chain.log').read_text())
        self.assertIn('existing run log directory refused', self.run_chain().stdout)

    def test_initial_disk_checks_are_logged(self):
        result = self.run_chain('--chunks', '1', dry=False)
        self.assert_finished(result, 0)
        lines = (self.logs / 'testUTC/chain.log').read_text().splitlines()
        disk_lines = [line for line in result.stdout.splitlines() if line.startswith('DISK ')]
        self.assertEqual(len(disk_lines), 4, result.stdout)
        self.assertEqual([line for line in lines if line.startswith('DISK ')], disk_lines)
        self.assertEqual(lines[:2], disk_lines[:2], 'initial checks must precede RUN')

    def test_stub_g0_failure_stops_and_preserves_evidence(self):
        result = self.run_chain(dry=False, env={'STUB_G0': 'FAIL'})
        self.assert_finished(result, 1)
        self.assertNotIn('testUTC-c2', self.calls.read_text())
        self.assertIn('G0 FAIL', (self.logs / 'testUTC/testUTC-c1-g0.log').read_text())

    def test_stub_diagnostic_continues_but_final_is_failure(self):
        result = self.run_chain('--mode', 'diagnostic', '--continue-on-g0-fail',
                                dry=False, env={'STUB_G0': 'FAIL'})
        self.assert_finished(result, 1)
        self.assertIn('g0 testUTC-c4', self.calls.read_text())

    def test_stub_blocked_cannot_continue(self):
        result = self.run_chain('--mode', 'diagnostic', '--continue-on-g0-fail',
                                dry=False, env={'STUB_G0': 'BLOCKED'})
        self.assert_finished(result, 2)
        self.assertNotIn('testUTC-c2', self.calls.read_text())

    def test_stub_g0_zero_without_pass_stops(self):
        result = self.run_chain('--mode', 'diagnostic', '--continue-on-g0-fail',
                                dry=False, env={'STUB_G0': 'MISSING'})
        self.assert_finished(result, 2)
        self.assertIn('RESULT testUTC-c1 matrix_rc=0 verify_rc=0 g0_rc=0', result.stdout)
        self.assertIn('STOP: G0 blocked/error/inconsistent output: testUTC-c1', result.stdout)
        self.assertNotIn('testUTC-c2', self.calls.read_text())
        self.assertEqual((self.logs / 'testUTC/testUTC-c1-g0.log').read_text(), '')

    def test_guard_mutations_are_detected(self):
        # Mutate only a disposable copy; rerun the same tests after restoration.
        source = SCRIPT.read_text()
        copy_dir = self.root / 'mutations'
        copy_dir.mkdir()
        script_copy = copy_dir / SCRIPT.name
        test_copy = copy_dir / Path(__file__).name
        test_copy.write_text(Path(__file__).read_text())
        mutations = [
            ('test_disk_measurement_failure_red',
             'case "$free_value" in \'\'|*[!0-9]*) die \'cannot measure disk\' ;; esac', ':', 2),
            ('test_anvil_and_unknown_probe_red',
             "*) die 'pgrep anvil unavailable; fail closed' ;;", '*) ;;', 4),
            ('test_stub_g0_zero_without_pass_stops',
             ' && grep -qx \'G0 PASS\' "$chunk_log-g0.log"', '', 1),
        ]
        for test_name, old, new, expected_failures in mutations:
            with self.subTest(guard=test_name):
                self.assertEqual(source.count(old), 1, 'mutation must target exactly one guard')
                command = [sys.executable, '-B', str(test_copy), f'ChainControls.{test_name}']
                try:
                    script_copy.write_text(source.replace(old, new, 1))
                    red = subprocess.run(command, env=self.env, text=True,
                                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                    self.assertEqual(red.returncode, 1, red.stdout)
                    self.assertEqual(red.stdout.count(f'FAIL: {test_name}'), expected_failures, red.stdout)
                    self.assertNotIn('ERROR:', red.stdout)
                finally:
                    script_copy.write_text(source)
                green = subprocess.run(command, env=self.env, text=True,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                self.assertEqual(green.returncode, 0, green.stdout)

    def test_stub_runner_and_manifest_errors_stop(self):
        for flag in ['STUB_MATRIX_RC', 'STUB_VERIFY_RC']:
            with self.subTest(flag=flag):
                result = self.run_chain('--prefix', flag, '--mode', 'diagnostic',
                                        '--continue-on-g0-fail', dry=False, env={flag: '1'})
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertFalse(self.lock.exists())
                self.assertIn(f'g0 {flag}-c1', self.calls.read_text())
                self.assertNotIn(f'{flag}-c2', self.calls.read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
