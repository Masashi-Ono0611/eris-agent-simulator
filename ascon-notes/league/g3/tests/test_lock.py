"""Dependency-free registration/stop controls; no world, model or live manifest."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

G3 = Path(__file__).resolve().parents[1]
ROOT = G3.parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


register = load('register', G3 / 'register-inputs.py')
pre = register.pre


def gate_modules():
    # The legacy launcher reads as-built /tmp files during import. Supply ONLY
    # inert test config in memory; never create/renew a real source manifest.
    read = Path.read_text
    def config(path, *args, **kwargs):
        if path == Path('/tmp/g3-chain/source-manifest.json'):
            return '{}'
        if path == Path('/tmp/g3-chain/source-view/ascon-notes/league/g3/budget.json'):
            return read(G3 / 'budget.json')
        return read(path, *args, **kwargs)
    mask = os.umask(0o077)
    try:
        with patch.object(Path, 'read_text', config):
            chain = load('test_r3_chain', G3 / 'chain/chain.py')
        with patch.dict(sys.modules, {'chain': chain}):
            gates = load('test_r3_gates', G3 / 'chain/gates.py')
        return chain, gates
    finally:
        os.umask(mask)


class Registration(unittest.TestCase):
    def setUp(self):
        self.lock = json.loads((G3 / 'inputs.lock.json').read_text())

    def test_deterministic_and_matches_real_verifier(self):
        rebuilt, chain_bytes = register.build(ROOT, self.lock)
        self.assertEqual(rebuilt, self.lock)
        self.assertEqual(register.build(ROOT, rebuilt), (rebuilt, chain_bytes))
        self.assertEqual(chain_bytes, (G3 / 'chain/chain.py').read_bytes())
        self.assertTrue(pre.check_inputs(ROOT, rebuilt)['pass'])
        self.assertTrue(pre.candidate_check(ROOT)['pass'])
        self.assertEqual(rebuilt['candidateSha256'], pre.EXPECTED)
        self.assertIn('fixed-bid-5gwei', rebuilt['agentTrees'])
        self.assertNotIn('ascon-zeta-r2', rebuilt['agentTrees'])

    def test_real_pins_mutation_positive_controls(self):
        with tempfile.TemporaryDirectory(prefix='g3-pins-') as tmp:
            root = Path(tmp)
            for name in self.lock['inputs']:
                dest = root / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, dest)
            for name in self.lock['agentTrees']:
                shutil.copytree(ROOT / 'example/agents' / name, root / 'example/agents' / name)
            self.assertTrue(pre.check_inputs(root, self.lock)['pass'])
            for name in ('mix-on.yaml', 'validate-inputs.mjs', 'chain/gates.py'):
                rel = register.PREFIX + name
                p = root / rel
                original = p.read_bytes()
                p.write_bytes(original + b'\n# drift\n')
                result = pre.check_inputs(root, self.lock)
                self.assertFalse(result['pass'])
                self.assertEqual(result['hashMismatches'], [rel])
                p.write_bytes(original)
            for agent in ('fixed-bid-5gwei', 'ascon-zeta-r3'):
                p = root / 'example/agents' / agent / 'prompt.md'
                original = p.read_bytes()
                p.write_bytes(original + b'\nchanged\n')
                result = pre.check_inputs(root, self.lock)
                self.assertFalse(result['pass'])
                self.assertFalse(result['agentTrees'][agent])
                if agent == 'ascon-zeta-r3':
                    with self.assertRaisesRegex(ValueError, 'STOP: r3 candidate differs'):
                        register.build(root, self.lock)
                p.write_bytes(original)
            self.assertTrue(pre.check_inputs(root, self.lock)['pass'])

    def test_candidate_metadata_cannot_still_name_r2(self):
        for key, value in [('candidateId', 'r2'), ('candidateDir', 'ascon-zeta-r2'),
                           ('candidateSha256', '0' * 64)]:
            lock = copy.deepcopy(self.lock)
            lock[key] = value
            self.assertFalse(pre.check_inputs(ROOT, lock)['pass'])

    def test_all_scheduled_rosters_bind_r3(self):
        import csv
        with (G3 / 'schedule.tsv').open() as f:
            rows = list(csv.DictReader(f, delimiter='\t'))
        self.assertEqual(len(rows), 46)
        for row in rows:
            self.assertTrue(row['label'].startswith('g3-r3-'))
            agents = register.roster(ROOT / row['roster'])['agents']
            candidate = next(a for a in agents if a['id'] == 'cand')
            self.assertEqual(candidate['dir'], 'ascon-zeta-r3')
            if row['field'] == 'mix':
                self.assertEqual(row['gate'], 'BLOCKED-F_mix')
                fixed = next(a for a in agents if a['id'] == 'fixed-bid-5gwei')
                self.assertEqual(fixed['env']['ERIS_AGENT_FROZEN'], '1')
        for field, ids in [('ref', ['noop', 'multi-arb', 'clean-arb', 'cand']),
                           ('mix', ['noop', 'venue-arb', 'multi-arb', 'clean-arb',
                                    'astra-1', 'astra-2', 'sonnet-1', 'sonnet-2',
                                    'opus-1', 'inc-zeta', 'fixed-bid-5gwei', 'cand'])]:
            on = register.roster(G3 / (field + '-on.yaml'))
            off = register.roster(G3 / (field + '-off.yaml'))
            self.assertEqual([a['id'] for a in on['agents']], ids)
            self.assertEqual(off['agents'][-1]['env'].pop('ERIS_AGENT_FROZEN'), '1')
            self.assertEqual(off, on)


class StartControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chain, cls.gates = gate_modules()

    def green(self):
        return {'status': 'PASS', 'checks': {
            **{k: {'pass': True} for k in self.chain.CHECKS},
            'completeness': {'pass': True, 'blocked': []}}}

    def test_each_real_blocker_stops_next_command_with_reason(self):
        self.assertTrue(self.chain.prestart_gate(self.green(), 0))
        lock = json.loads((G3 / 'inputs.lock.json').read_text())
        self.assertNotIn(pre.OBSOLETE_ABSENT, lock['blocked'])
        self.assertIn(self.chain.F_MIX, lock['blocked'])
        for reason in lock['blocked'] + [pre.OBSOLETE_ABSENT]:
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as tmp:
                doc = self.green()
                doc.update(status='FAIL')
                doc['checks']['completeness'] = {'pass': False, 'blocked': [reason]}
                root = Path(tmp)
                (root / 'pre.json').write_text(json.dumps(doc))
                (root / 'exit').write_text('1')
                output = io.StringIO()
                downstream = []
                with patch.object(sys, 'argv', ['gates.py', 'prestart', str(root / 'pre.json'), str(root / 'exit')]), contextlib.redirect_stdout(output):
                    rc = self.gates.main()
                    if rc == 0:
                        downstream.append('world would start')
                self.assertEqual(rc, 2)
                self.assertEqual(downstream, [])
                self.assertEqual(json.loads(output.getvalue())['remainingBlocked'], [reason])

    def test_today_missing_natural_fixture_blocks_even_if_lock_text_removed(self):
        self.assertFalse((G3 / 'fixtures/AUDITED-HAIKU-CHANGE-MISSING.json').exists())
        comp = pre.completeness_check(ROOT, {'blocked': []})
        self.assertFalse(comp['pass'])
        self.assertIn(pre.NATURAL_MISSING, comp['blocked'])
        doc = self.green()
        doc.update(status='FAIL')
        doc['checks']['completeness'] = comp
        self.assertFalse(self.chain.prestart_gate(doc, 1))

    def test_live_recorder_readiness_always_blocks_without_process(self):
        out = io.StringIO()
        with patch.object(sys, 'argv', ['gates.py', 'runtime-ready']), \
             patch.object(self.gates.subprocess, 'run', side_effect=AssertionError('no subprocess')), \
             contextlib.redirect_stdout(out):
            self.assertEqual(self.gates.main(), 2)
        result = json.loads(out.getvalue())
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertIn('live full-frame recorder', result['reason'])

    def test_each_other_prestart_check_has_a_positive_control(self):
        self.assertTrue(self.chain.prestart_gate(self.green(), 0))
        for name in self.chain.CHECKS - {'completeness'}:
            doc = self.green()
            doc['checks'][name]['pass'] = False
            doc['status'] = 'FAIL'
            self.assertFalse(self.chain.prestart_gate(doc, 1), name)

    def test_missing_corrupt_budget_ledger_is_not_zero_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / 'home/.ascon-g3/budget-ledger.json'
            ledger.parent.parent.mkdir()
            with patch.object(self.chain, 'ledger_path', return_value=ledger):
                with self.assertRaisesRegex(self.chain.Stop, 'BLOCKED.*MISSING'):
                    self.chain.reserve_budget()
                self.assertFalse(ledger.exists())
                with self.chain.budget_ledger(init=True):
                    pass
                with self.chain.budget_ledger() as (_, records):
                    self.assertEqual(records[0]['event'], 'init')
                ledger.write_text('{broken')
                with self.assertRaisesRegex(self.chain.Stop, 'BLOCKED'):
                    self.chain.reserve_budget()
                self.assertEqual(ledger.read_text(), '{broken')

    def test_current_tool_pins_match_and_drift_stops_before_child(self):
        with patch.object(self.chain, 'TOOL_ROOT', G3 / 'chain'):
            self.chain.tool_check()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in self.chain.TOOL_MANIFEST:
                shutil.copyfile(G3 / 'chain' / name, root / name)
            with (root / 'gates.py').open('a') as f:
                f.write('\n# changed\n')
            with patch.object(self.chain, 'TOOL_ROOT', root), \
                 patch.object(sys, 'argv', ['chain.py', '--run']), \
                 patch.object(self.chain.subprocess, 'Popen') as child:
                with self.assertRaisesRegex(self.chain.Stop, 'BLOCKED: tool manifest mismatch: gates.py'):
                    self.chain.main()
                child.assert_not_called()


if __name__ == '__main__':
    unittest.main()
