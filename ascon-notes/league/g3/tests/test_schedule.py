import csv
from pathlib import Path
import unittest
G3=Path(__file__).resolve().parents[1]
class Schedule(unittest.TestCase):
    def test_exact_design_order(self):
        with (G3/'schedule.tsv').open() as stream:
            rows=list(csv.DictReader(stream,delimiter='\t'))
        expected=[]
        for regime in ['calm','crash','depeg']:
            for field in ['ref','mix']:
                for seed in [49001,49002,49003]:
                    for mode in (['on','off'] if seed==49002 else ['off','on']):
                        expected.append(('normal',regime,str(seed),field,mode,''))
        for case in ['malicious','invalid','empty','quota','delayed','timeout','change-revert']:
            expected.append(('fault','calm','49101','ref','on',case))
        for regime,seed in [('calm',49102),('crash',49103),('depeg',49102)]:
            expected.append(('state-boundary',regime,str(seed),'ref','on',''))
        self.assertEqual([tuple(r[k] for k in ['group','regime','seed','field','mode','fault_case']) for r in rows],expected)
        self.assertEqual([int(r['order']) for r in rows],list(range(1,47)))
        self.assertEqual(len({r['label'] for r in rows}),46)
        self.assertEqual(len({r['host'] for r in rows}),1)
        self.assertTrue(all(r['parallel']=='1' and (G3.parents[2]/r['roster']).is_file() for r in rows))
        self.assertEqual([(r['s'],r['k']) for r in rows[-3:]],[('1','3'),('2','3'),('3','3')])
        self.assertAlmostEqual(sum(float(r['expected_hours']) for r in rows),46*13/60,places=6)
if __name__=='__main__':unittest.main()
