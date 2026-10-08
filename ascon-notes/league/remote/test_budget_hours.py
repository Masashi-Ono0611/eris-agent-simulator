"""Tiny hand-calculated fixtures; no hosts, network or simulation processes."""
from datetime import datetime
from pathlib import Path
import copy
import json
import subprocess
import sys
import tempfile
import unittest

import budget_hours as b


def t(value):
    return datetime.fromisoformat(value).replace(tzinfo=b.JST)


class BudgetHoursTests(unittest.TestCase):
    def test_union_day_boundary_and_parallel_positive_control(self):
        # 23:30..00:30 + overlapping 00:00..01:00 = 1.5h, NOT 2h.
        intervals=[(t('2026-10-04T23:30'),t('2026-10-05T00:30')),
                   (t('2026-10-05T00:00'),t('2026-10-05T01:00'))]
        self.assertEqual(b.hours(intervals),1.5)
        self.assertNotEqual(b.hours(intervals),2.0)  # detects naive run-hour sum
        self.assertEqual(b.days(intervals),{'2026-10-04':0.5,'2026-10-05':1.0})

    def test_naive_sum_mutant_is_detected(self):
        # Positive control: with the union replaced by a naive sum of run hours the same fixture gives 2.0h,
        # so the 1.5h assertion above would fail. This makes the detection ability itself observable.
        intervals=[(t('2026-10-04T23:30'),t('2026-10-05T00:30')),
                   (t('2026-10-05T00:00'),t('2026-10-05T01:00'))]
        original=b.union
        b.union=lambda xs: sorted(xs)  # naive: overlaps are not merged
        try:
            mutated=b.hours(intervals)
        finally:
            b.union=original
        self.assertEqual(mutated,2.0)
        self.assertNotEqual(mutated,1.5)
        self.assertEqual(b.hours(intervals),1.5)

    def test_forward_cutoff_normal_pass(self):
        # 00:30..02:00 clipped at 01:00 = 1h; earlier run entirely excluded.
        self.assertEqual(b.hours([(t('2026-10-04T00:30'),t('2026-10-04T02:00')),
                                  (t('2026-10-03T10:00'),t('2026-10-03T11:00'))]),1.0)

    def test_reversed_end_positive_control(self):
        # Air-like marker contradiction must never produce negative usage.
        with self.assertRaisesRegex(ValueError,'end precedes'):
            b.hours([(t('2026-10-07T14:12'),t('2026-10-07T13:57'))])

    def test_tiny_index_fixture_and_duplicate_copies(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); (root/'indexes').mkdir()
            raw=('e1-c1\tcalm\t1\truns/2026-10-04T14-30-00-000Z\t0\n'
                 'e1-c1\tcalm\t2\truns/2026-10-04T15-30-00-000Z\t0\n')
            (root/'indexes/a-index.tsv').write_text(raw)
            (root/'indexes/b-index.tsv').write_text(raw)
            data=b.indexes(root)['e1-c1']
            self.assertEqual(len(data),2)
            self.assertEqual(data[0][0],t('2026-10-04T23:30'))
            self.assertEqual(b.hours([(data[0][0],data[1][0])]),1.0)
            # Same run ID with contradictory exit evidence must fail, not dedup silently.
            (root/'indexes/b-index.tsv').write_text(raw.replace('\t0\n','\t1\n'))
            with self.assertRaisesRegex(ValueError,'conflicting index'):
                b.indexes(root)

    def test_hosts_are_additive(self):
        # Two hosts occupying the same 1h consume 2 host-hours.
        host=[(t('2026-10-04T01:00'),t('2026-10-04T02:00'))]
        self.assertEqual(sum(b.hours(x) for x in [host,host]),2.0)


def pair(host='mini', prefix='run', start='2026-10-04T14:30:00Z',
         end='2026-10-04T15:30:00Z', result='PASS'):
    # Hand-built schema v1, including the writer's non-accounting metadata.
    row = dict(schema_version=1, event='chunk_start', host=host,
               host_id_source='hostname -s (host-local name; not a globally unique hardware ID)',
               prefix=prefix, label=prefix+'-c1', chunk=1, regimes=['calm'], seeds=[1],
               mode='diagnostic', flags=[], utc_start=start, utc_end=None,
               local_utc_offset='+0800', result=None,
               exit_codes=dict.fromkeys(('manifest_begin', 'telemetry_bind', 'matrix',
                                        'verify', 'g0', 'telemetry_status', 'telemetry_classify')),
               parallel=3, relaunch_of=None, pid=123, activity_note='fixture')
    end_row = copy.deepcopy(row)
    end_row.update(event='chunk_end', utc_end=end, result=result)
    end_row['exit_codes'].update(manifest_begin=0, matrix=0, verify=0, g0=0)
    return [row, end_row]


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, name, rows):
        path = self.root/name
        path.write_text(''.join((r if isinstance(r, str) else json.dumps(r))+'\n' for r in rows))
        return path

    def cli(self, paths, *flags):
        args = [sys.executable, '-B', str(Path(b.__file__))]
        for path in paths:
            args.extend(['--ledger', str(path)])
        proc = subprocess.run(args+list(flags), capture_output=True, text=True)
        return proc, json.loads(proc.stdout)

    def test_two_hosts_overlap_jst_split_and_cli_output(self):
        # Mini 23:30..00:30 + 00:00..01:00 = 1.5h, not 2h (nor parallel*3).
        # Air uses the same prefix/label/chunk at 23:30..00:30 = another 1h.
        mini = self.write('mini.jsonl', pair()+pair(prefix='overlap',
                          start='2026-10-04T15:00:00Z', end='2026-10-04T16:00:00Z', result='FAIL'))
        air = self.write('air.jsonl', pair(host='air', result='BLOCKED'))
        proc, report = self.cli([mini, air])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(report['total_hours'], 2.5)
        self.assertEqual(report['known']['hosts']['mini'],
                         {'hours': 1.5, 'daily_jst': {'2026-10-04': 0.5, '2026-10-05': 1.0}})
        self.assertEqual(report['known']['hosts']['air']['hours'], 1.0)
        self.assertEqual(report['known']['daily_jst'], {'2026-10-04': 1.0, '2026-10-05': 1.5})
        for result in ('PASS', 'FAIL', 'BLOCKED'):
            self.assertEqual(report['result_breakdown'][result], {'chunks': 1, 'hours': 1.0})
        self.assertIn('HOST | known union hours', proc.stderr)
        self.assertIn('2026-10-05: 1.000000', proc.stderr)
        self.assertIn('FAIL | 1 | 1.0', proc.stderr)

    def test_cutoff_and_same_result_union(self):
        # 00:30..02:00 clipped to 01:00..02:00; overlapping 01:30..02:00
        # adds nothing. Previous day's 1h contributes zero. Total = 1h.
        path = self.write('cutoff.jsonl',
                          pair(start='2026-10-03T15:30:00Z', end='2026-10-03T17:00:00Z')+
                          pair(prefix='overlap', start='2026-10-03T16:30:00Z', end='2026-10-03T17:00:00Z')+
                          pair(prefix='before', start='2026-10-02T16:00:00Z', end='2026-10-02T17:00:00Z'))
        report = b.read_ledgers([path])
        self.assertEqual(report['total_hours'], 1.0)
        self.assertEqual(report['known']['daily_jst'], {'2026-10-04': 1.0})
        self.assertEqual(report['result_breakdown']['PASS'], {'chunks': 3, 'hours': 1.0})

    def test_unknown_end_and_explicit_live_estimate(self):
        path = self.write('live.jsonl', pair()+pair(prefix='unfinished', start='2026-10-04T15:00:00Z')[:1])
        proc, report = self.cli([path])
        self.assertEqual(proc.returncode, 3)  # incomplete: not settled, must not look like success
        self.assertEqual(report['status'], 'INCOMPLETE_UNKNOWN_END')
        self.assertEqual(report['known']['hours'], 1.0)
        self.assertIsNone(report['total_hours'])
        self.assertIsNone(report['live_assumed'])
        self.assertIsNone(report['assumed_now_utc'])
        self.assertEqual(len(report['unknown_end']), 1)
        self.assertIsNone(report['unknown_end'][0]['hours'])
        self.assertIsNone(report['unknown_end'][0]['utc_end'])
        self.assertEqual(report['result_breakdown']['UNKNOWN_END'], {'chunks': 1, 'hours': None})
        self.assertIn('UNKNOWN_END | mini | unfinished | unfinished-c1 | 1', proc.stderr)
        # Fixed live snapshot at 01:00 JST: union 23:30..01:00 = 1.5h.
        live = b.read_ledgers([path], assume_end_now=True, now=b.ledger_time('2026-10-04T16:00:00Z'))
        self.assertEqual(live['mode'], 'LIVE_ASSUMED_END_NOW')
        self.assertEqual(live['live_assumed']['hours'], 1.5)
        self.assertEqual(live['known']['hours'], 1.0)
        self.assertIsNone(live['total_hours'])
        self.assertIsNone(live['unknown_end'][0]['hours'])
        self.assertEqual(live['unknown_end'][0]['assumed_utc_end'], '2026-10-04T16:00:00Z')
        proc, live_cli = self.cli([path], '--assume-end-now')
        self.assertEqual(proc.returncode, 3)  # the live view is an estimate, still not a settlement
        self.assertEqual(live_cli['mode'], 'LIVE_ASSUMED_END_NOW')
        self.assertIn('LIVE_ASSUMED_END_NOW', proc.stderr)
        self.assertIn('estimate, not settlement', proc.stderr)

    def test_every_bad_case_fails_closed_and_can_be_reported(self):
        original = pair(prefix='bad')
        cases = [
            ('end without a start', original[1:]),
            ('duplicated pair/event', original+original),
            ('duplicated pair/event', original[:1]+original),
            ('duplicated pair/event', original+original[1:]),
            ('JSON', ['{broken']),
            ('JSON', ['']),
            ('JSON object', [[]]),
            ('duplicate object field', ['{"schema_version": 1, "schema_version": 2}']),
            ('non-finite number', ['{"unused": NaN}']),
        ]
        for field, value, reason, index in [
            ('utc_end', '2026-10-04T14:00:00Z', 'end precedes start', 1),
            ('utc_start', '2026-10-04T14:00:00Z', 'differs', 1),
            ('schema_version', 2, 'unknown schema', 0),
            ('schema_version', True, 'unknown schema', 1),
            ('utc_start', 'bad-time', 'unparseable time', 0),
            ('utc_end', '2026-02-30T00:00:00Z', 'unparseable time', 1),
            ('utc_end', '2026-10-04T15:30:00', 'unparseable time', 1),
            ('utc_end', '2026-10-04T15:30:00+00:00', 'unparseable time', 1),
            ('event', 'unknown', 'unknown event', 1),
            ('result', 'UNKNOWN', 'unknown result', 1),
            ('result', 'PASS', 'requires null', 0),
            ('chunk', True, 'positive integer', 0),
            ('host', '', 'nonempty strings', 0),
            ('local_utc_offset', '+2500', 'invalid local_utc_offset', 1),
            ('pid', '123', 'invalid pid', 1),
            ('exit_codes', {'matrix': '0'}, 'invalid exit_codes', 1),
            ('relaunch_of', [], 'invalid relaunch_of', 1),
        ]:
            rows = copy.deepcopy(original)
            rows[index][field] = value
            cases.append((reason, rows))
        for reason, rows in cases:
            with self.subTest(reason=reason, rows=rows):
                path = self.write('bad.jsonl', pair(prefix='good')+rows)
                proc, report = self.cli([path])
                self.assertNotEqual(proc.returncode, 0, 'positive control must reject corruption')
                self.assertEqual(report['status'], 'INVALID')
                self.assertIsNone(report['known'])
                self.assertIsNone(report['total_hours'])
                self.assertTrue(report['issues'])
                self.assertIn('BAD / EXCLUDED', proc.stderr)
                if reason != 'JSON':
                    self.assertTrue(any(reason in i['reason'] for i in report['issues']))
                proc, report = self.cli([path], '--report-bad-lines')
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertEqual(report['status'], 'PARTIAL_BAD_LINES_EXCLUDED')
                self.assertEqual(report['known']['hours'], 1.0)
                self.assertIsNone(report['total_hours'])
                self.assertTrue(report['issues'])

    def test_corrupt_end_never_becomes_live_unknown(self):
        rows = pair()
        rows[1]['utc_end'] = 'broken'
        path = self.write('broken-end.jsonl', rows)
        report = b.read_ledgers([path], report_bad_lines=True, assume_end_now=True)
        self.assertEqual(report['chunks'], [])
        self.assertEqual(report['live_assumed']['hours'], 0)
        self.assertTrue(report['issues'])

    def test_duplicate_across_files_and_unreadable_input(self):
        a = self.write('a.jsonl', pair())
        b_path = self.write('b.jsonl', pair())
        for paths in ([a, b_path], [self.root/'missing.jsonl']):
            proc, report = self.cli(paths)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIsNone(report['known'])
            self.assertTrue(report['issues'])

    def test_invalid_utf8_is_a_bad_line(self):
        path = self.root/'encoding.jsonl'
        path.write_bytes(b'\xff\n')
        proc, report = self.cli([path])
        self.assertNotEqual(proc.returncode, 0)
        self.assertTrue(report['issues'])

    def test_all_results_and_key_includes_label(self):
        rows = []
        for result in b.RESULTS:
            records = pair(result=result)
            for record in records:
                record['label'] = result
            rows.extend(records)
        report = b.read_ledgers([self.write('results.jsonl', rows)])
        self.assertEqual(report['total_hours'], 1.0)
        self.assertEqual(len(report['chunks']), 6)
        for result in b.RESULTS:
            self.assertEqual(report['result_breakdown'][result], {'chunks': 1, 'hours': 1.0})

    def test_future_start_cannot_be_assumed_to_end_now(self):
        path = self.write('future.jsonl', pair()[:1])
        report = b.read_ledgers([path], assume_end_now=True,
                                now=b.ledger_time('2026-10-04T14:00:00Z'))
        self.assertEqual(report['status'], 'INVALID')
        self.assertIsNone(report['live_assumed'])
        self.assertEqual(report['issues'][0]['reason'], 'assumed end precedes start')

    def test_ledger_cli_rejects_missing_input_and_mixed_modes(self):
        for flags in ([], ['--assume-end-now'], ['--report-bad-lines'],
                      ['legacy-data', '--ledger', 'ledger.jsonl']):
            proc = subprocess.run([sys.executable, '-B', str(Path(b.__file__)), *flags],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 2)
            self.assertIn('error:', proc.stderr)


if __name__=='__main__': unittest.main()
