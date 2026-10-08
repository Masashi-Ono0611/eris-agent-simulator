#!/usr/bin/env python3
"""Offline controls: temporary fake runners only; no simulator/network/key access."""
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import pty
import shlex
import shutil
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
        self.hours = self.root / '.ascon-hours/chain-hours.jsonl'
        fake_bin = self.root / 'bin'
        fake_bin.mkdir()
        self.fake_bin = fake_bin
        # Hermetic PATH: never depend on or invoke a real Anvil/node/tmutil.
        for name in ['awk', 'mkdir', 'rmdir', 'grep', 'env', 'bash', 'date', 'cat']:
            (fake_bin / name).symlink_to(shutil.which(name))
        (fake_bin / 'python3').symlink_to(sys.executable)
        for name, code in {
            'anvil': 'exit 99\n',
            'node': 'exit 99\n',
            'hostname': '[ "$1" = -s ] || exit 99\necho fixture-host\n',
            'uname': 'echo "${STUB_OS:-Linux}"\n',
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
            'if sys.argv[1] == "begin": sys.exit(int(os.environ.get("STUB_BEGIN_RC", "0")))\n'
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
            'PATH': str(fake_bin),
            'HOME': str(self.root), 'TMPDIR': str(self.root),
            'STUB_CALLS': str(self.calls),
        }

    def run_chain(self, *args, dry=True, env=None, stdin=subprocess.DEVNULL, unset_home=False):
        argv = ['/bin/bash', str(SCRIPT), '--repo', str(self.repo),
                '--roster', str(self.roster), '--prefix', 'testUTC',
                '--seeds', '63001 63002 63003', '--log-root', str(self.logs),
                '--lock-dir', str(self.lock), '--activity-note', 'fixture only']
        if dry:
            argv.append('--dry-run')
        if unset_home:
            argv = [str(self.fake_bin / 'env'), '-u', 'HOME'] + argv
        result = subprocess.run(argv + list(args), env={**self.env, **(env or {})},
                                stdin=stdin, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        return result

    def stub_snapshots(self):
        tool = self.fake_bin / 'tmutil'
        tool.write_text('#!/bin/bash\n'
                        '[ "$*" = "listlocalsnapshots /" ] || exit 99\n'
                        '[ "${STUB_TM_FAIL:-0}" = 0 ] || exit 1\n'
                        'echo "Snapshots for disk /:"\n'
                        'i=0; while [ "$i" -lt "${STUB_SNAPSHOTS:-10}" ]; do\n'
                        '  echo "com.apple.TimeMachine.fixture-$i.local"; i=$((i+1))\n'
                        'done\n')
        tool.chmod(0o700)

    def test_path_missing_stops_before_manifest(self):
        for name in ['anvil', 'node', 'python3']:
            with self.subTest(tool=name):
                tool = self.fake_bin / name
                hidden = self.root / name
                tool.rename(hidden)
                try:
                    result = self.run_chain('--prefix', name, dry=False)
                    self.assertEqual(result.returncode, 3, result.stdout)
                    self.assertIn(f'STOP: required command not found in PATH: {name}', result.stdout)
                    self.assertNotIn('COMMAND:', result.stdout)
                    self.assertFalse(self.calls.exists())
                    self.assertFalse(self.lock.exists())
                    self.assertEqual((self.logs / name / 'end.marker').read_text(), f'CHAIN_END_{name}=3\n')
                finally:
                    hidden.rename(tool)

    def test_path_resolved_passes_without_forge(self):
        result = self.run_chain('--chunks', '1', dry=False)
        self.assert_finished(result, 0)
        for name in ['anvil', 'node', 'python3']:
            line = f'PREFLIGHT {name}={self.fake_bin / name}'
            self.assertIn(line, result.stdout)
            self.assertIn(line, (self.logs / 'testUTC/chain.log').read_text())
        self.assertIn('manifest begin', self.calls.read_text())

    def test_launch_env_tty_warns(self):
        master, slave = pty.openpty()
        try:
            result = self.run_chain('--chunks', '1', stdin=slave)
        finally:
            os.close(slave)
            os.close(master)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn(f'LAUNCH_ENV PATH_head={self.fake_bin} stdin_tty=yes', result.stdout)
        self.assertIn('WARN stdin is a tty', result.stdout)

    def test_launch_env_detached_input_passes(self):
        result = self.run_chain('--chunks', '1', dry=False)
        self.assert_finished(result, 0)
        line = f'LAUNCH_ENV PATH_head={self.fake_bin} stdin_tty=no'
        self.assertIn(line, (self.logs / 'testUTC/chain.log').read_text())
        self.assertNotIn('WARN stdin', result.stdout)

    def test_snapshot_warning_threshold(self):
        self.stub_snapshots()
        for count in [0, 9, 10, 12]:
            with self.subTest(count=count):
                result = self.run_chain('--chunks', '1', env={'STUB_OS': 'Darwin', 'STUB_SNAPSHOTS': str(count)})
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertEqual('WARN local TimeMachine snapshots=' in result.stdout, count >= 10)
                if count >= 10:
                    self.assertIn(f'WARN local TimeMachine snapshots={count}', result.stdout)

    def test_snapshot_low_disk_remedy(self):
        self.stub_snapshots()
        for free in ['24', '39']:
            with self.subTest(free=free):
                result = self.refused('STOP: free disk below', env={
                    'STUB_OS': 'Darwin', 'CHAIN_TEST_MODE': '1', 'CHAIN_TEST_FREE_GB': free})
                stop = next(line for line in result.stdout.splitlines() if line.startswith('STOP:'))
                self.assertIn('local TimeMachine snapshots=10; remedy:', stop)
                self.assertIn('recheck df', stop)

    def test_snapshot_absent_or_linux_passes(self):
        for system in ['Darwin', 'Linux']:
            with self.subTest(system=system):
                result = self.run_chain('--chunks', '1', env={'STUB_OS': system})
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertNotIn('TimeMachine', result.stdout)
        self.stub_snapshots()
        result = self.run_chain('--chunks', '1', env={'STUB_OS': 'Linux'})
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn('TimeMachine', result.stdout)

    def test_snapshot_probe_failure_warns(self):
        self.stub_snapshots()
        result = self.run_chain('--chunks', '1', env={'STUB_OS': 'Darwin', 'STUB_TM_FAIL': '1'})
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('WARN cannot list local TimeMachine snapshots', result.stdout)

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
        self.assertFalse(self.hours.parent.exists())
        self.assertNotIn('CHAIN_END_testUTC=', result.stdout)

    def hours_records(self, path=None):
        raw = (path or self.hours).read_bytes()
        self.assertTrue(raw.endswith(b'\n'))
        return [json.loads(line) for line in raw.splitlines()]

    def assert_hours_pair(self, start, end, result):
        self.assertEqual(start['event'], 'chunk_start')
        self.assertEqual(end['event'], 'chunk_end')
        self.assertIsNone(start['result'])
        self.assertIsNone(start['utc_end'])
        self.assertTrue(all(v is None for v in start['exit_codes'].values()))
        self.assertEqual(end['result'], result)
        for key in ('prefix', 'label', 'chunk', 'host', 'pid', 'utc_start', 'flags'):
            self.assertEqual(start[key], end[key])
        for value in (start['utc_start'], end['utc_end']):
            self.assertRegex(value, r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        begin = datetime.strptime(start['utc_start'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        finish = datetime.strptime(end['utc_end'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        self.assertLessEqual(begin, finish)
        self.assertLess(abs((datetime.now(timezone.utc) - finish).total_seconds()), 60)
        self.assertRegex(start['local_utc_offset'], r'^[+-]\d{4}$')

    def test_hours_pass_pairs_metadata_and_append(self):
        note = 'idle; "quoted" \\ path\n日本語\t$(no execution)'
        result = self.run_chain('--chunks', '1 3', '--activity-note', note, dry=False)
        self.assert_finished(result, 0)
        records = self.hours_records()
        self.assertEqual(len(records), 4)
        for offset, chunk in [(0, 1), (2, 3)]:
            start, end = records[offset:offset + 2]
            self.assert_hours_pair(start, end, 'PASS')
            self.assertEqual(start['schema_version'], 1)
            self.assertEqual(start['host'], 'fixture-host')
            self.assertIn('hostname -s', start['host_id_source'])
            self.assertEqual(start['chunk'], chunk)
            self.assertEqual(start['label'], f'testUTC-c{chunk}')
            self.assertEqual(start['seeds'], [63001, 63002, 63003])
            self.assertEqual(start['parallel'], 3)
            self.assertEqual(start['activity_note'], note)
            self.assertEqual(start['mode'], 'qualification')
            self.assertEqual(start['flags'], [])
            self.assertIsNone(start['relaunch_of'])
            self.assertGreater(start['pid'], 0)
            self.assertEqual(end['exit_codes'], dict(manifest_begin=0, telemetry_bind=None,
                             matrix=0, verify=0, g0=0, telemetry_status=None, telemetry_classify=None))
        self.assertEqual(records[0]['regimes'], ['calm', 'cex-drift', 'informed-flow'])
        self.assertEqual(self.hours.parent.stat().st_mode & 0o777, 0o700)
        before = self.hours.read_bytes()
        result = self.run_chain('--prefix', 'secondUTC', '--chunks', '2',
                                '--relaunch-of', 'testUTC', dry=False)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(self.hours.read_bytes().startswith(before))
        self.assertEqual(len(self.hours_records()), 6)
        self.assertEqual(self.hours_records()[-1]['relaunch_of'], 'testUTC')

    def test_hours_override_and_dry_run(self):
        custom = self.root / 'custom ledger/records.jsonl'
        result = self.run_chain('--hours-ledger', str(custom))
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertFalse(custom.parent.exists())
        self.assertFalse(self.hours.parent.exists())
        result = self.run_chain('--hours-ledger', str(custom), '--chunks', '1', dry=False)
        self.assert_finished(result, 0)
        self.assertEqual(len(self.hours_records(custom)), 2)
        self.assertFalse(self.hours.exists())

    def test_hours_fail_continue_and_blocked_stop(self):
        result = self.run_chain('--mode', 'diagnostic', '--continue-on-g0-fail',
                                dry=False, env={'STUB_G0': 'FAIL'})
        self.assert_finished(result, 1)
        records = self.hours_records()
        self.assertEqual(len(records), 8)
        for offset, verdict in zip(range(0, 8, 2), ['FAIL', 'PASS', 'PASS', 'PASS']):
            self.assert_hours_pair(*records[offset:offset + 2], verdict)
        self.assertEqual(records[1]['exit_codes']['g0'], 1)
        self.assertEqual(records[1]['flags'], ['--continue-on-g0-fail'])
        result = self.run_chain('--prefix', 'blockedUTC', dry=False, env={'STUB_G0': 'BLOCKED'})
        self.assertEqual(result.returncode, 2, result.stdout)
        records = self.hours_records()
        self.assertEqual(len(records), 10)
        self.assert_hours_pair(*records[-2:], 'BLOCKED')
        self.assertEqual(records[-1]['exit_codes']['g0'], 2)

    def test_hours_runner_failure_and_stopped(self):
        for flag, code in [('STUB_BEGIN_RC', 'manifest_begin'), ('STUB_MATRIX_RC', 'matrix'),
                           ('STUB_VERIFY_RC', 'verify'), ('STUB_G0', 'g0')]:
            with self.subTest(flag=flag):
                env = {flag: 'MISSING' if flag == 'STUB_G0' else '7'}
                result = self.run_chain('--prefix', flag, dry=False, env=env)
                self.assertEqual(result.returncode, 2, result.stdout)
                records = self.hours_records()
                self.assert_hours_pair(*records[-2:], 'STOPPED' if flag == 'STUB_G0' else 'RUNNER_FAILED')
                self.assertEqual(records[-1]['exit_codes'][code], 0 if flag == 'STUB_G0' else 7)
        self.assertEqual(len(self.hours_records()), 8)

    def test_hours_interrupted_leaves_unmatched_start(self):
        for signal in ['TERM', 'KILL']:
            with self.subTest(signal=signal):
                (self.league / 'run-league.sh').write_text(
                    f'#!/bin/bash\nkill -{signal} "$PPID"\nexit 143\n')
                result = self.run_chain('--prefix', signal, dry=False)
                self.assertEqual(result.returncode, 143 if signal == 'TERM' else -9, result.stdout)
                records = [r for r in self.hours_records() if r['prefix'] == signal]
                self.assertEqual(len(records), 1)
                self.assertEqual(records[0]['event'], 'chunk_start')
                self.assertIsNone(records[0]['utc_end'], 'missing END must never become zero hours')
                self.assertNotIn('g0 ', self.calls.read_text())

    def test_hours_unwritable_path_stops_before_chunk(self):
        # A directory as the file, and a regular file as its parent, fail even
        # under root (unlike chmod-only controls).
        parent_file = self.root / 'not-a-directory'
        parent_file.write_text('preserve me')
        for prefix, path in [('file-blocked', self.root), ('parent-blocked', parent_file / 'hours.jsonl')]:
            with self.subTest(path=path):
                result = self.run_chain('--prefix', prefix, '--hours-ledger', str(path), dry=False)
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertIn('STOP: HOURS_LEDGER_START_FAILED:', result.stdout)
                self.assertFalse(self.calls.exists())
                self.assertFalse(self.lock.exists())
        self.assertEqual(parent_file.read_text(), 'preserve me')

    def test_hours_start_append_failure_stops_before_chunk(self):
        # Ledger directory creation succeeds, but the actual printf append fails.
        self.hours.parent.mkdir()
        self.hours.symlink_to(self.root / 'absent-parent/ledger.jsonl')
        result = self.run_chain(dry=False)
        self.assert_finished(result, 2)
        self.assertIn('HOURS_LEDGER_START_FAILED: cannot append START:', result.stdout)
        self.assertFalse(self.calls.exists())

    def test_hours_missing_home_help(self):
        for options in ({'unset_home': True}, {'env': {'HOME': ''}}):
            with self.subTest(options=options):
                result = self.run_chain('--help', dry=False, **options)
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertIn('Usage: bash chain-template.sh', result.stdout)
                self.assertFalse(self.calls.exists())
                self.assertFalse(self.hours.exists())
                self.assertFalse(self.logs.exists())
                self.assertFalse(self.lock.exists())

    def test_hours_missing_home_dry_run(self):
        for options in ({'unset_home': True}, {'env': {'HOME': ''}}):
            with self.subTest(options=options):
                result = self.run_chain('--chunks', '1', **options)
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertIn('PLAN_ONLY:', result.stdout)
                self.assertEqual(result.stdout.count('COMMAND:'), 4)
                self.assertNotIn('CHAIN_END_', result.stdout)
                self.assertFalse(self.calls.exists())
                self.assertFalse(self.hours.exists())
                self.assertFalse(self.logs.exists())
                self.assertFalse(self.lock.exists())

    def test_hours_missing_home_explicit_path_runs(self):
        for prefix, options in [('unset', {'unset_home': True}), ('empty', {'env': {'HOME': ''}})]:
            with self.subTest(prefix=prefix):
                path = self.root / f'{prefix}.jsonl'
                result = self.run_chain('--prefix', prefix, '--chunks', '1',
                                        '--hours-ledger', str(path), dry=False, **options)
                self.assertEqual(result.returncode, 0, result.stdout)
                records = self.hours_records(path)
                self.assertEqual([row['event'] for row in records], ['chunk_start', 'chunk_end'])
                self.assertEqual(records[-1]['result'], 'PASS')
                self.assertIn(f'g0 {prefix}-c1', self.calls.read_text())
                marker = f'CHAIN_END_{prefix}=0\n'
                self.assertTrue(result.stdout.endswith(marker))
                self.assertEqual((self.logs / prefix / 'end.marker').read_text(), marker)
                self.assertNotIn('HOURS_LEDGER_END_FAILED', result.stdout)
                self.assertFalse(self.hours.exists())
                self.assertFalse(self.lock.exists())

    def test_hours_missing_home_without_path_stops_before_chunk(self):
        for options in ({'unset_home': True}, {'env': {'HOME': ''}}):
            with self.subTest(options=options):
                result = self.run_chain(dry=False, **options)
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertIn('STOP: HOURS_LEDGER_START_FAILED:', result.stdout)
                self.assertIn('pass --hours-ledger PATH', result.stdout)
                self.assertTrue(result.stdout.endswith('CHAIN_END_testUTC=2\n'))
                self.assertNotIn('COMMAND:', result.stdout)
                self.assertFalse(self.calls.exists())
                self.assertFalse(self.hours.exists())
                self.assertFalse(self.logs.exists())
                self.assertFalse(self.lock.exists())

    def test_hours_end_failure_warns_and_preserves_exit_and_marker(self):
        # Simulate a storage failure after a successful START. Save the original
        # ledger, then block its pathname with a directory before END.
        gate = self.league / 'g0.py'
        gate.write_text('from pathlib import Path\n'
                        'import os\n'
                        'p = Path(os.environ["STUB_HOURS"])\n'
                        'p.rename(p.with_suffix(".saved")); p.mkdir()\n' + gate.read_text())
        for verdict, rc in [('PASS', 0), ('FAIL', 1), ('BLOCKED', 2)]:
            with self.subTest(verdict=verdict):
                path = self.root / f'{verdict}.jsonl'
                result = self.run_chain('--prefix', verdict, '--chunks', '1', '--hours-ledger', str(path),
                                        dry=False, env={'STUB_HOURS': str(path), 'STUB_G0': verdict})
                self.assertEqual(result.returncode, rc, result.stdout)
                self.assertIn('WARN: HOURS_LEDGER_END_FAILED:', result.stdout)
                marker = f'CHAIN_END_{verdict}={rc}\n'
                log_lines = f'HOURS_LEDGER_END_FAILED_{verdict}=1\n' + marker
                self.assertTrue(result.stdout.endswith(log_lines))
                self.assertEqual((self.logs / verdict / 'end.marker').read_text(), marker)
                self.assertIn(log_lines, (self.logs / verdict / 'chain.log').read_text())
                self.assertEqual(len(self.hours_records(path.with_suffix('.saved'))), 1)

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

    def telemetry_stubs(self):
        # Real stdlib classifier; only manifest, matrix and G0 are synthetic.
        remote = self.league / 'remote'
        remote.mkdir()
        shutil.copyfile(SCRIPT.with_name('g0_blocked_classify.py'), remote / 'g0_blocked_classify.py')
        self.roster.write_text('agents: [{id: candidate, baseline: false}, {id: opponent, baseline: false}]\n')
        (self.league / 'round-manifest.py').write_text(
            'import os, sys\nfrom pathlib import Path\n'
            f'sys.path.insert(0, {str(SCRIPT.parent)!r})\n'
            'from test_g0_blocked_classify import fixture\n'
            'with open(os.environ["STUB_CALLS"], "a") as f: f.write("manifest " + " ".join(sys.argv[1:]) + "\\n")\n'
            'if sys.argv[1] == "verify": sys.exit(int(os.environ.get("STUB_VERIFY_RC", "0")))\n'
            'def value(flag): return sys.argv[sys.argv.index(flag) + 1]\n'
            'status = "BLOCKED" if sys.argv[2].endswith("c1") else os.environ.get("STUB_LATER_G0", "PASS")\n'
            'fixture(Path.cwd(), Path(value("--roster")), label=sys.argv[2],\n'
            '        regimes=value("--regimes").split(), seeds=value("--seeds").split(),\n'
            '        status=status, defect=os.environ.get("STUB_DEFECT", "known"))\n'
        )
        (self.league / 'g0.py').write_text(
            'import json, os, sys\nfrom pathlib import Path\n'
            'with open(os.environ["STUB_CALLS"], "a") as f: f.write("g0 " + sys.argv[1] + "\\n")\n'
            'p = Path("ascon-notes/eval/out") / sys.argv[1] / "fixture-g0.json"\n'
            'raw = p.read_text(); data = json.loads(raw)\n'
            'if os.environ.get("STUB_VERDICT_BLOCK"): Path(os.environ["STUB_VERDICT_BLOCK"]).mkdir()\n'
            'print(raw if "--json" in sys.argv else "G0 " + data["status"], end="\\n")\n'
            'sys.exit({"PASS":0, "FAIL":1, "BLOCKED":2}[data["status"]])\n'
        )

    def run_telemetry(self, *args, env=None):
        return self.run_chain('--mode', 'diagnostic',
                              '--continue-on-opponent-telemetry-blocked', 'candidate',
                              *args, dry=False, env=env)

    def test_telemetry_approval_continues_and_final_stays_blocked(self):
        self.telemetry_stubs()
        result = self.run_telemetry()
        self.assert_finished(result, 2)
        self.assertIn('g0 testUTC-c4', self.calls.read_text())
        records = self.hours_records()
        self.assertEqual(len(records), 8)
        self.assert_hours_pair(*records[:2], 'BLOCKED')
        self.assert_hours_pair(*records[-2:], 'PASS')
        self.assertEqual(records[1]['flags'], ['--continue-on-opponent-telemetry-blocked'])
        self.assertEqual(records[1]['exit_codes']['telemetry_classify'], 0)
        deviation = ('DEVIATION diagnostic continuation; G0=BLOCKED; '
                     'world=calm/63001; agent=opponent; eligible_for_gate=false')
        self.assertIn(deviation, result.stdout)
        chain = (self.logs / 'testUTC/chain.log').read_text()
        self.assertIn(deviation, chain)
        self.assertIn('G0 BLOCKED testUTC-c1', chain)
        self.assertIn('G0 PASS testUTC-c4', chain)
        verdict = json.loads((self.logs / 'testUTC/testUTC-c1-classifier.json').read_text())
        self.assertTrue(verdict['approved'])
        self.assertFalse(verdict['eligible_for_gate'])
        self.assertEqual((verdict['blocked_worlds'], verdict['expected_worlds']), (1, 9))
        original = (self.repo / 'ascon-notes/eval/out/testUTC-c1/fixture-g0.json').read_text()
        self.assertEqual((self.logs / 'testUTC/testUTC-c1-g0.json').read_text(), original + '\n')

    def test_telemetry_candidate_same_defect_stops(self):
        self.telemetry_stubs()
        result = self.run_telemetry(env={'STUB_DEFECT': 'candidate'})
        self.assert_telemetry_stopped(result)

    def assert_telemetry_stopped(self, result):
        self.assert_finished(result, 2)
        self.assertIn('STOP:', result.stdout)
        self.assertNotIn('testUTC-c2', self.calls.read_text())
        self.assertNotIn('DEVIATION diagnostic continuation; G0=BLOCKED;', result.stdout)

    def test_telemetry_unknown_id_stops(self):
        self.telemetry_stubs()
        result = self.run_telemetry(env={'STUB_DEFECT': 'unknown'})
        self.assert_telemetry_stopped(result)

    def test_telemetry_non_diagnostic_refuses(self):
        result = self.refused('requires --mode diagnostic',
                              '--continue-on-opponent-telemetry-blocked', 'candidate')
        self.assertEqual(result.returncode, 2)

    def test_telemetry_empty_candidate_refuses(self):
        result = self.refused('invalid telemetry candidate ID', '--mode', 'diagnostic',
                              '--continue-on-opponent-telemetry-blocked', '')
        self.assertEqual(result.returncode, 2)

    def test_telemetry_other_defects_stop(self):
        self.telemetry_stubs()
        for defect in ('newline', 'no-action', 'other-round', 'corrupt', 'missing'):
            with self.subTest(defect=defect):
                result = self.run_telemetry('--prefix', defect, env={'STUB_DEFECT': defect})
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertIn('classification refused', result.stdout)
                self.assertNotIn(f'g0 {defect}-c2', self.calls.read_text())
                self.assertNotIn('DEVIATION diagnostic continuation; G0=BLOCKED;', result.stdout)
                self.assertEqual((self.logs / defect / 'end.marker').read_text(), f'CHAIN_END_{defect}=2\n')

    def test_telemetry_fail_and_blocked_stops_even_with_both_flags(self):
        self.telemetry_stubs()
        result = self.run_telemetry('--continue-on-g0-fail', env={'STUB_DEFECT': 'mixed'})
        self.assert_telemetry_stopped(result)

    def test_telemetry_flag_absent_still_stops(self):
        self.telemetry_stubs()
        result = self.run_chain('--mode', 'diagnostic', '--continue-on-g0-fail', dry=False)
        self.assert_telemetry_stopped(result)
        self.assertFalse((self.logs / 'testUTC/testUTC-c1-classifier.json').exists())

    def test_telemetry_matrix_or_manifest_error_stops_before_classification(self):
        self.telemetry_stubs()
        for flag in ('STUB_MATRIX_RC', 'STUB_VERIFY_RC'):
            with self.subTest(flag=flag):
                result = self.run_telemetry('--prefix', flag, env={flag: '1'})
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertIn('runner/manifest failure', result.stdout)
                self.assertNotIn(f'g0 {flag}-c2', self.calls.read_text())
                self.assertFalse((self.logs / flag / f'{flag}-c1-classifier.json').exists())

    def test_telemetry_later_fail_never_overwrites_blocked(self):
        self.telemetry_stubs()
        for continue_fail in (False, True):
            with self.subTest(continue_fail=continue_fail):
                prefix = 'later' + str(continue_fail)
                args = ['--prefix', prefix] + (['--continue-on-g0-fail'] if continue_fail else [])
                result = self.run_telemetry(*args, env={'STUB_LATER_G0': 'FAIL'})
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertEqual(f'g0 {prefix}-c4' in self.calls.read_text(), continue_fail)
                self.assertEqual((self.logs / prefix / 'end.marker').read_text(), f'CHAIN_END_{prefix}=2\n')

    def test_telemetry_verdict_write_failure_stops(self):
        self.telemetry_stubs()
        result = self.run_telemetry(env={
            'STUB_VERDICT_BLOCK': str(self.logs / 'testUTC/testUTC-c1-classifier.json')})
        self.assert_telemetry_stopped(result)

    def test_telemetry_unknown_candidate_stops_before_matrix(self):
        self.telemetry_stubs()
        result = self.run_telemetry('--continue-on-opponent-telemetry-blocked', 'unknown')
        self.assert_finished(result, 2)
        self.assertIn('cannot fix candidate/opponents at start', result.stdout)
        self.assertNotIn('matrix ', self.calls.read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
