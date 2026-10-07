#!/usr/bin/env python3
"""Hand-calculated controls, temporary summaries only; no measurement runs."""
import csv
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import agg_mixed as agg


class AggregationControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='agg-controls-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.index = self.root / 'index.tsv'
        # Agent order: noop, A, B, C. W1: mean=0, population SD=sqrt(2).
        # W2: mean=10, population SD=sqrt(2); W3: mean=7, SD=0.
        # Let q=10*sqrt(2). T vectors:
        # W1 = [50, 50+q, 50-q, 50]; W2 = [50, 50-q, 50+q, 50]; W3 = [50]*4.
        self.rows = []
        for i, (regime, values, loops, rc, violations) in enumerate([
                ('calm', [0, 2, -2, 0], 362, 0, []),
                ('crash', [10, 8, 12, 10], 361, 143, ['fixture violation']),
                ('calm', [7, 7, 7, 7], 362, 0, [])], 1):
            run_dir = f'runs/world{i}'
            directory = self.root / run_dir
            directory.mkdir(parents=True)
            summary = dict(loopIterations=loops, violations=violations,
                           agents=[dict(id=agent, pnlUsdc=pnl) for agent, pnl in zip(['noop', 'A', 'B', 'C'], values)])
            (directory / 'summary.json').write_text(json.dumps(summary))
            self.rows.append(dict(chunk=str(i), regime=regime, seed=str(i), run_dir=run_dir, exit_code=str(rc)))
        self.write_index()

    def write_index(self):
        with self.index.open('w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=agg.COLUMNS, delimiter='\t')
            writer.writeheader()
            writer.writerows(self.rows)

    def cli(self, *args):
        return subprocess.run([sys.executable, '-B', str(Path(agg.__file__)), str(self.root), 'index.tsv', *args],
                              text=True, capture_output=True)

    def test_hand_calculated_tables_and_zero_stdev(self):
        worlds = agg.load_worlds(self.root, self.index)
        q = 10 * math.sqrt(2)
        for world, expected in zip(worlds, [[50, 50+q, 50-q, 50], [50, 50-q, 50+q, 50], [50]*4]):
            for agent, score in zip(['noop', 'A', 'B', 'C'], expected):
                self.assertAlmostEqual(world['scores'][agent], score)
        rows = {row['agent']: row for row in agg.table(worlds)}
        for agent in rows:
            self.assertAlmostEqual(rows[agent]['meanT'], 50)
            self.assertAlmostEqual(rows[agent]['excess'], 0)
            self.assertEqual(rows[agent]['below'], 1 if agent in ['A', 'B'] else 0)
            self.assertEqual(rows[agent]['n'], 3)
        filtered = {row['agent']: row for row in agg.table([worlds[0], worlds[2]])}
        for agent, t, excess in [('A', 50+q/2, 1), ('B', 50-q/2, -1), ('C', 50, 0), ('noop', 50, 0)]:
            self.assertAlmostEqual(filtered[agent]['meanT'], t)
            self.assertEqual(filtered[agent]['excess'], excess)
            self.assertEqual(filtered[agent]['below'], int(agent == 'B'))
            self.assertEqual(filtered[agent]['n'], 2)
        result = self.cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(agg.LABEL, result.stdout)
        self.assertIn('ALL worlds=3', result.stdout)
        self.assertIn('loopIterations==362 ONLY worlds=2', result.stdout)
        self.assertIn('A\t50.000000\t0.000000\t1/3', result.stdout)
        self.assertIn(f'A\t{50+q/2:.6f}\t1.000000\t0/2', result.stdout)

    def test_flagged_world_warning_and_clean_control(self):
        worlds = agg.load_worlds(self.root, self.index)
        # Each predicate alone must warn, and must not silently exclude the world.
        for changes in [dict(loops=361), dict(exit_code=143), dict(violations=['bad'])]:
            with self.subTest(changes=changes):
                output = agg.report([{**worlds[0], **changes}])
                self.assertIn('WARN world chunk=1 regime=calm seed=1', output)
                self.assertIn('ALL worlds=1', output)
        result = self.cli()
        self.assertIn('loopIterations=361 exit_code=143 violations=["fixture violation"]', result.stdout)
        self.assertEqual(result.stdout.count('WARN world'), 1)
        clean = agg.report([worlds[0], worlds[2]])
        self.assertIn('FLAGGED WORLDS\nnone', clean)
        self.assertNotIn('WARN', clean)

    def test_paired_hand_calculation_and_cli(self):
        worlds = agg.load_worlds(self.root, self.index)
        # A-B differences [d, -d, 0], d=20*sqrt(2).
        # Mean=0, sample variance=(d^2+d^2)/2=d^2, SE=d/sqrt(3).
        d = 20 * math.sqrt(2)
        expected_se = d / math.sqrt(3)
        stats = agg.paired(worlds, 'A', 'B')
        self.assertEqual(stats['n'], 3)
        self.assertAlmostEqual(stats['mean'], 0)
        self.assertAlmostEqual(stats['se'], expected_se)
        self.assertAlmostEqual(stats['interval'][0], -2*expected_se)
        self.assertAlmostEqual(stats['interval'][1], 2*expected_se)
        self.assertEqual(stats['wins'], 1)  # Tie is not a win.
        self.assertAlmostEqual(stats['regimes']['calm'], d/2)
        self.assertAlmostEqual(stats['regimes']['crash'], -d)
        # Filtered [d,0]: mean=d/2, sample SD=d/sqrt(2), SE=d/2.
        filtered = agg.paired([worlds[0], worlds[2]], 'A', 'B')
        self.assertAlmostEqual(filtered['mean'], d/2)
        self.assertAlmostEqual(filtered['se'], d/2)
        result = self.cli('--paired', 'A', 'B')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'n=3 meanTdiff=0.000000 SE={expected_se:.6f} approx95%=[{-2*expected_se:.6f}, {2*expected_se:.6f}] wins/n=1/3', result.stdout)
        self.assertIn(f'PAIRED regime=crash meanTdiff={-d:.6f}', result.stdout)
        self.assertIn(f'n=2 meanTdiff={d/2:.6f} SE={d/2:.6f}', result.stdout)

    def test_empty_subset_and_single_pair_uncertainty(self):
        worlds = agg.load_worlds(self.root, self.index)
        stats = agg.paired([worlds[0]], 'A', 'B')
        self.assertIsNone(stats['se'])
        self.assertIsNone(stats['interval'])
        output = agg.report([worlds[1]], ('A', 'B'))
        self.assertIn('loopIterations==362 ONLY worlds=0', output)
        self.assertIn('SE=NA approx95%=NA', output)
        self.assertIn('n=0 meanTdiff=NA', output)

    def test_bad_summary_stops_and_restored_passes(self):
        path = self.root / self.rows[0]['run_dir'] / 'summary.json'
        original = path.read_text()
        for damage in ['missing', 'json', 'noop', 'pnl', 'duplicate', 'roster', 'loops', 'violations']:
            with self.subTest(damage=damage):
                summary = json.loads(original)
                if damage == 'missing':
                    path.unlink()
                elif damage == 'json':
                    path.write_text('{')
                else:
                    if damage == 'noop': summary['agents'][0]['id'] = 'other'
                    if damage == 'pnl': summary['agents'][0]['pnlUsdc'] = float('nan')
                    if damage == 'duplicate': summary['agents'][1]['id'] = 'noop'
                    if damage == 'roster': summary['agents'][1]['id'] = 'different'
                    if damage == 'loops': summary.pop('loopIterations')
                    if damage == 'violations': summary['violations'] = None
                    path.write_text(json.dumps(summary))
                result = self.cli()
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn('STOP:', result.stderr)
                self.assertEqual(result.stdout, '')
                path.write_text(original)
                self.assertEqual(self.cli().returncode, 0)

    def test_bad_index_stops_and_restored_passes(self):
        original = self.index.read_text()
        cases = [original.replace('chunk\t', 'wrong\t', 1), '\t'.join(agg.COLUMNS)+'\n',
                 original + original.splitlines()[1]+'\n',
                 original.replace('runs/world1', '../outside', 1),
                 original.replace('runs/world1', str(self.root / 'runs/world1'), 1)]
        for text in cases:
            with self.subTest(index=text):
                self.index.write_text(text)
                result = self.cli()
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn('STOP:', result.stderr)
                self.assertEqual(result.stdout, '')
                self.index.write_text(original)
                self.assertEqual(self.cli().returncode, 0)

    def test_unknown_pair_stops(self):
        result = self.cli('--paired', 'missing', 'noop')
        self.assertEqual(result.returncode, 2)
        self.assertIn('STOP: paired agents must both exist', result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertEqual(self.cli('--paired', 'A', 'noop').returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
