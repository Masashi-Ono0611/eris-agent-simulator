"""Hand-calculated JSONL fixtures; no external data or dependencies required."""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import behaviour_compare as bc


class BehaviourTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def fixture(self, extra_candidate=False, header=False):
        for exp, candidate in bc.EXPERIMENTS.items():
            base = self.root / exp
            directory = base / 'runs' / 'tiny'
            (directory / 'agents').mkdir(parents=True)
            index = '\t'.join(bc.COLUMNS) + '\n' if header else ''
            (base / 'index.tsv').write_text(index + 'c1\tcalm\t1\truns/tiny\t0\n')
            agents = []
            for seat, pnl in [('inc-zeta', -10), (candidate, 10)]:
                agents.append(dict(id=seat, includedTxCount=3, revertCount=1,
                                   unloggedTxCount=0, pnlUsdc=pnl, netPnlUsdc=pnl - 2))
                rows = [dict(agentId=seat, event='runtime_start', mode='decide',
                             agentDir='/fixture/r3', ts='2026-01-01T00:00:00Z')]
                for n, fee in enumerate([100_000_000, 200_000_000, 300_000_000]):
                    r = dict(agentId=seat, event='submitted', hash=f'{seat}-{n}',
                             ts=f'2026-01-01T00:00:0{n + 1}Z', blockSeen=9+n,
                             priorityFeeWei=str(fee), actionType='swap', protocol='uniswap')
                    if n < 2:
                        r.update(bundleId='bundle', bundleIndex=n)
                    rows.append(r)
                # Duplicate noop records still represent only one round.
                for _ in range(2):
                    rows.append(dict(agentId=seat, ts='2026-01-01T00:00:04Z', round=12,
                                     action={'type': 'noop'}, reason='no funded venue gap'))
                rows.append(dict(agentId=seat, event='submit_failed', actionType='swap', blockSeen=12))
                if extra_candidate and exp != 'e4' and seat == candidate:
                    rows.append(dict(agentId=seat, event='submitted', hash='extra',
                                     ts='2026-01-01T00:00:05Z', blockSeen=13,
                                     priorityFeeWei='100000000', actionType='liquityProvideToSP', protocol='liquity'))
                (directory / 'agents' / (seat + '.jsonl')).write_text(''.join(json.dumps(r) + '\n' for r in rows))
            summary = dict(agents=agents, runStartBlock=10, finalBlock=13,
                           loopIterations=4, violations=[], mode='backtest', resetUnit='continuous')
            (directory / 'summary.json').write_text(json.dumps(summary))
        return bc.analyse(self.root)

    def test_normal_pass_and_hand_calculated_metrics(self):
        result = self.fixture()
        w = result['worlds'][0]
        m = w['seats']['inc']['metrics']
        self.assertEqual(m['submitted'], 3)
        self.assertEqual(m['fee_mean_wei'], 200_000_000)
        self.assertEqual(m['fee_median_wei'], 200_000_000)
        self.assertEqual(m['fee_min_wei'], 100_000_000)
        self.assertEqual(m['fee_max_wei'], 300_000_000)
        self.assertAlmostEqual(m['fee_default_share'], 1/3)
        self.assertAlmostEqual(m['fee_bumped_share'], 2/3)
        self.assertEqual(m['two_leg_submitted_groups'], 1)
        self.assertEqual(m['bundle_tagged_tx'], 2)
        self.assertEqual(m['unbundled_tx'], 1)
        self.assertEqual(m['noop_records'], 2)
        self.assertEqual(m['noop_rounds'], 1)
        self.assertEqual(m['window_blocks_without_submission'], 2)  # 12 and 13
        self.assertEqual(m['pre_start_submitted'], 1)  # block 9
        self.assertEqual(m['first_block_from_run_start'], -1)
        self.assertAlmostEqual(m['first_submit_from_runtime_ms'], 1000)
        self.assertEqual(m['included_per_submitted'], 1)
        self.assertAlmostEqual(m['reverts_per_included'], 1/3)
        self.assertEqual(m['event/submit_failed'], 1)
        self.assertEqual(w['delta']['simplified_t'], 20)  # {-10,+10}: T={40,60}
        self.assertFalse(result['comparison']['submitted']['flag'])
        self.assertEqual(result['flags'], [])  # E4 has same differences, strict boundary
        self.assertEqual(result['aggregate']['e1e3']['seats']['inc']['totals']['submitted'], 6)

    def test_positive_control_seeded_difference_fires(self):
        result = self.fixture(extra_candidate=True, header=True)
        self.assertTrue(result['comparison']['submitted']['flag'])
        self.assertEqual(result['comparison']['submitted']['e4']['mean'], 0)
        self.assertEqual(result['comparison']['submitted']['e1']['mean'], 1)
        self.assertEqual(result['worlds'][0]['seats']['inc']['metrics']['action/liquityProvideToSP'], 0)
        self.assertEqual(result['worlds'][0]['seats']['candidate']['metrics']['stability_pool_tx'], 1)

    def test_iqr_rule_spread_sign_and_boundary(self):
        baseline = bc.distribution([-4, -2, 2, 4])  # interpolated Q1=-2.5, Q3=2.5
        self.assertEqual((baseline['q1'], baseline['q3']), (-2.5, 2.5))
        self.assertTrue(bc.clearly_outside(baseline, [bc.distribution([3])] * 3))
        self.assertFalse(bc.clearly_outside(baseline, [bc.distribution([2.5])] * 3))
        self.assertFalse(bc.clearly_outside(baseline, [bc.distribution([3]), bc.distribution([-3]), bc.distribution([3])]))
        self.assertFalse(bc.clearly_outside(baseline, [bc.distribution([])] * 3))

    def test_duplicate_world_fails(self):
        self.fixture()
        path = self.root / 'e1/index.tsv'
        path.write_text(path.read_text() * 2)
        with self.assertRaisesRegex(ValueError, 'duplicate world'):
            bc.analyse(self.root)

    def test_no_submission_and_partial_bundle(self):
        self.fixture()
        directory = self.root / 'e1/runs/tiny'
        path = directory / 'agents/inc-zeta.jsonl'
        summary = bc.read_json(directory / 'summary.json')
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        path.write_text(json.dumps(rows[0]) + '\n')
        result = bc.extract_seat(path, summary['agents'][0], summary, 100_000_000)
        self.assertIsNone(result['metrics']['fee_mean_wei'])
        self.assertIsNone(result['first_submission'])
        self.assertIsNone(result['metrics']['included_per_submitted'])
        self.assertEqual(result['metrics']['window_blocks_without_submission'], 4)
        path.write_text('\n'.join(json.dumps(row) for row in rows[:2]) + '\n')
        result = bc.extract_seat(path, summary['agents'][0], summary, 100_000_000)
        self.assertEqual(result['metrics']['one_record_bundle_groups'], 1)
        self.assertEqual(result['metrics']['two_leg_submitted_groups'], 0)

    def test_parameter_search_reports_names_not_values(self):
        self.fixture()
        path = self.root / 'e1/runs/tiny/summary.json'
        summary = bc.read_json(path)
        summary['env'] = {'ASCON_DELTA_PARAMS': 'DO_NOT_ECHO_THIS_VALUE'}
        path.write_text(json.dumps(summary))
        result = bc.analyse(self.root)
        self.assertEqual(result['parameter_name_hits'][0]['names'], ['ASCON_DELTA_PARAMS'])
        self.assertNotIn('DO_NOT_ECHO_THIS_VALUE', json.dumps(result))


class SameWorldTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def fixture(self, seeded=False):
        # Counts by seed 1,2,3. Index order deliberately differs across runs.
        inc_counts = [[2, 4, 6], [1, 4, 7], [3, 3, 6]]
        candidate_counts = [[2, 4, 6], [6, 10, 14], [5, 8, 11]] if seeded else inc_counts
        runs = []
        for ri, name in enumerate(('r3', 'r3a', 'r3c')):
            candidate = 'candidate-' + name
            base = self.root / name
            runs.append((name, base, candidate))
            index = ['\t'.join(bc.COLUMNS)] if ri == 1 else []
            for seed in ([3, 1, 2] if ri == 1 else [1, 2, 3]):
                directory = base / 'runs' / str(seed)
                (directory / 'agents').mkdir(parents=True)
                index.append(f'c1\tcalm\t{seed}\truns/{seed}\t0')
                agents = []
                for seat, counts in [('inc-zeta', inc_counts), (candidate, candidate_counts)]:
                    n = counts[ri][seed - 1]
                    reverts = ([[0, 1, 2], [0, 0, 1], [1, 1, 1]][ri][seed - 1]
                               if seeded and seat == candidate else 0)
                    agents.append(dict(id=seat, includedTxCount=n, revertCount=reverts,
                                       unloggedTxCount=0, pnlUsdc=0, netPnlUsdc=0))
                    rows = [dict(agentId=seat, event='runtime_start', mode='decide',
                                 agentDir='/fixture/' + name, ts='2026-01-01T00:00:00Z')]
                    for j in range(n):
                        row = dict(agentId=seat, event='submitted', hash=f'{seat}-{j}',
                                   ts=f'2026-01-01T00:00:{j+1:02d}Z', blockSeen=j,
                                   priorityFeeWei=str(100_000_000 if j == 0 else 300_000_000),
                                   actionType='swap', protocol='uniswap')
                        if j < 2:
                            row.update(bundleId='pair', bundleIndex=j)
                        rows.append(row)
                    for j in range(n, 16):
                        reason = ('recovery quote/cost not competitive'
                                  if seeded and ri == 0 and seat == candidate else 'no funded venue gap')
                        rows.append(dict(agentId=seat, round=j, action={'type': 'noop'}, reason=reason))
                    (directory / 'agents' / (seat + '.jsonl')).write_text(
                        ''.join(json.dumps(row) + '\n' for row in rows))
                (directory / 'summary.json').write_text(json.dumps(dict(
                    agents=agents, runStartBlock=0, finalBlock=16, loopIterations=17,
                    violations=[], mode='backtest', resetUnit='continuous')))
            (base / 'index.tsv').write_text('\n'.join(index) + '\n')
        return runs

    def test_normal_pass_with_background_drift(self):
        result = bc.analyse_same_world(self.fixture())
        self.assertEqual(result['audit']['matched_worlds'], 3)
        self.assertEqual(result['audit']['seat_logs'], 18)
        self.assertEqual(result['scanned_files'], 30)
        for pair in result['comparisons']:
            self.assertEqual(pair['flags'], [])  # candidate changes exactly match control
            self.assertEqual(pair['metrics']['submitted']['candidate'], pair['metrics']['submitted']['control'])
        self.assertEqual(result['aggregate']['r3a']['delta']['submitted']['mean'], 0)
        self.assertEqual(result['aggregate']['r3a']['seats']['candidate']['totals']['noop_reason/recovery_cost'], 0)

    def test_positive_control_hand_calculated_three_worlds_three_runs(self):
        result = bc.analyse_same_world(self.fixture(seeded=True))
        pairs = result['comparisons']
        self.assertEqual([(p['run_a'], p['run_b']) for p in pairs],
                         [('r3a', 'r3'), ('r3c', 'r3'), ('r3c', 'r3a')])
        first = pairs[0]['metrics']
        for key in ('submitted', 'action_protocol/swap/uniswap', 'includedTxCount'):
            row = first[key]
            # [4,6,8]: mean=6, sample SD=2, SE=2/sqrt(3).
            self.assertEqual(row['candidate']['mean'], 6)
            self.assertAlmostEqual(row['candidate']['se'], 2 / math.sqrt(3))
            self.assertEqual((row['candidate']['wins'], row['candidate']['n']), (3, 3))
            # Control [-1,0,1]: mean=0, SD=1, SE=1/sqrt(3), radius=1.
            self.assertEqual(row['control']['mean'], 0)
            self.assertAlmostEqual(row['control']['se'], 1 / math.sqrt(3))
            self.assertEqual((row['control']['wins'], row['control']['ties']), (1, 1))
            self.assertEqual(row['control_radius'], 1)
            self.assertTrue(row['flag'])
        self.assertEqual(first['unbundled_tx']['candidate']['mean'], 6)
        # Inc has one partial bundle at r3a/seed1: unbundled differences [0,0,1].
        self.assertAlmostEqual(first['unbundled_tx']['control']['mean'], 1/3)
        self.assertAlmostEqual(first['unbundled_tx']['control']['se'], 1/3)
        self.assertEqual([w['candidate']['submitted'] for w in pairs[0]['paired_worlds']], [4, 6, 8])
        self.assertEqual(first['noop_rounds']['candidate']['mean'], -6)
        self.assertEqual(first['noop_rounds']['candidate']['wins'], 3)  # lower direction
        recovery = first['noop_reason/recovery_cost']
        self.assertEqual(recovery['candidate']['mean'], -12)  # [-14,-12,-10]
        self.assertAlmostEqual(recovery['candidate']['se'], 2 / math.sqrt(3))
        self.assertTrue(recovery['flag'])
        self.assertEqual(first['two_leg_submitted_groups']['candidate']['mean'], 0)
        self.assertEqual(first['two_leg_submitted_groups']['candidate']['wins'], 0)
        self.assertAlmostEqual(first['revertCount']['candidate']['mean'], -2/3)  # [0,-1,-1]
        self.assertAlmostEqual(first['revertCount']['candidate']['se'], 1/3)
        self.assertEqual(first['revertCount']['candidate']['wins'], 2)
        self.assertIsNone(first['fee_mean_wei']['candidate']['wins'])
        self.assertIsNone(first['fee_mean_wei']['candidate']['direction'])
        # r3c-r3 [3,4,5]; r3c-r3a [-1,-2,-3], control [2,-1,-1].
        second, third = (p['metrics']['submitted'] for p in pairs[1:])
        self.assertEqual(second['candidate']['mean'], 4)
        self.assertAlmostEqual(second['candidate']['se'], 1/math.sqrt(3))
        self.assertTrue(second['flag'])
        self.assertEqual(third['candidate']['mean'], -2)
        self.assertAlmostEqual(third['candidate']['se'], 1/math.sqrt(3))
        self.assertEqual(third['control_radius'], 2)
        self.assertFalse(third['flag'])
        gap = result['aggregate']['r3a']['delta']['submitted']  # [5,6,7]
        self.assertEqual(gap['mean'], 6)
        self.assertAlmostEqual(gap['se'], 1/math.sqrt(3))
        a = result['aggregate']['r3a']['seats']['candidate']
        self.assertEqual(a['totals']['submitted'], 30)
        self.assertEqual(a['totals']['bundle_tagged_tx'], 6)
        self.assertEqual(a['totals']['two_leg_submitted_groups'], 3)
        self.assertEqual(a['totals']['unbundled_tx'], 24)
        # Three 0.1 gwei + twenty-seven 0.3 gwei; transaction-weighted.
        self.assertEqual(a['pooled_fees']['mean'], 280_000_000)
        self.assertEqual(a['pooled_fees']['median'], 300_000_000)
        self.assertEqual(a['pooled_fee_shares']['default'], .1)
        self.assertAlmostEqual(a['world_metrics']['fee_mean_wei']['mean'] / 1_000_000_000,
                               (1.6/6 + 2.8/10 + 4/14)/3)

    def test_missing_measurement_uses_same_worlds_for_both_rows(self):
        runs = self.fixture(seeded=True)
        path = self.root / 'r3a/runs/2/agents/inc-zeta.jsonl'
        start = path.read_text().splitlines()[0]
        path.write_text(start + '\n')  # no fees/timing; submission count is measured zero
        result = bc.analyse_same_world(runs)
        rows = result['comparisons'][0]['metrics']['fee_mean_wei']
        for label in ('candidate', 'control'):
            self.assertEqual((rows[label]['n'], rows[label]['missing']), (2, 1))
        self.assertIsNone(result['comparisons'][0]['paired_worlds'][1]['candidate']['fee_mean_wei'])
        self.assertEqual(result['comparisons'][0]['metrics']['submitted']['control']['n'], 3)

    def test_world_mismatch_and_duplicate_names_rejected(self):
        runs = self.fixture()
        with self.assertRaisesRegex(ValueError, 'uniquely named'):
            bc.analyse_same_world([runs[0], runs[0]])
        path = self.root / 'r3a/index.tsv'
        path.write_text('\n'.join(path.read_text().splitlines()[:-1]) + '\n')
        with self.assertRaisesRegex(ValueError, 'world set mismatch'):
            bc.analyse_same_world(runs)

    def test_screen_strict_boundary_missing_and_negative(self):
        control = bc.distribution([-1, 0, 1])
        self.assertFalse(bc.control_screen(bc.distribution([1, 1, 1]), control)['flag'])
        self.assertTrue(bc.control_screen(bc.distribution([-2, -2, -2]), control)['flag'])
        self.assertFalse(bc.control_screen(bc.distribution([10]), control)['flag'])
        self.assertFalse(bc.control_screen(bc.distribution([]), control)['flag'])
        self.assertFalse(bc.control_screen(bc.distribution([10, 10]), bc.distribution([]))['flag'])

    def test_cli_mode_and_parameter_values_not_exposed(self):
        runs = self.fixture()
        path = self.root / 'r3/runs/1/summary.json'
        summary = bc.read_json(path)
        summary['env'] = {'ASCON_DELTA_PARAMS': 'DO_NOT_ECHO_THIS_VALUE'}
        path.write_text(json.dumps(summary))
        command = [sys.executable, '-B', str(Path(bc.__file__)), '--same-world']
        for name, directory, candidate in runs:
            command.extend(['--run', name, str(directory), candidate])
        proc = subprocess.run(command, capture_output=True, text=True, check=True)
        result = json.loads(proc.stdout)
        self.assertEqual(result['mode'], 'same-world')
        self.assertEqual(result['parameter_name_hits'][0]['names'], ['ASCON_DELTA_PARAMS'])
        self.assertNotIn('DO_NOT_ECHO_THIS_VALUE', proc.stdout)
        invalid = subprocess.run(command[:3] + ['--run', 'x', 'unused', 'candidate'],
                                 capture_output=True, text=True)
        self.assertEqual(invalid.returncode, 2)
        self.assertIn('--run requires --same-world', invalid.stderr)


if __name__ == '__main__':
    unittest.main()
