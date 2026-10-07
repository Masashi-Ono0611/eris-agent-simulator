"""Hand-calculated JSONL fixtures; no external data or dependencies required."""
import json
from pathlib import Path
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


if __name__ == '__main__':
    unittest.main()
