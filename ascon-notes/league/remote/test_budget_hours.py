"""Tiny hand-calculated fixtures; no hosts, network or simulation processes."""
from datetime import datetime
from pathlib import Path
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


if __name__=='__main__': unittest.main()
