#!/usr/bin/env python3
"""Tiny synthetic evidence only; the G0 producer and simulator are never executed."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('g0_blocked_classify.py').resolve()


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fixture(repo, roster, label='testUTC-c1', regimes=('calm', 'crash'), seeds=('1',),
            status='BLOCKED', defect='known'):
    """Also used by the chain's fake manifest/G0 runners, with real classifier code."""
    out = repo / 'ascon-notes/eval/out' / label
    out.mkdir(parents=True)
    agents = {aid: dict(directory=str(repo / aid), sha256='a' * 64,
                       files={'agent.ts': 'b' * 64}) for aid in ('candidate', 'opponent')}
    manifest = dict(schema='ascon-round-manifest-v1', label=label, agents=agents,
                    roster=dict(path=str(roster), sha256=sha(roster)),
                    regimes=list(regimes), seeds=list(seeds))
    mp = repo / 'ascon-notes/league/manifests' / (label + '.json')
    save(mp, manifest)
    aid = {'candidate': 'candidate', 'unknown': 'unknown'}.get(defect, 'opponent')
    rows = [dict(agentId=aid, kind='mempool', event='runtime_start'),
            dict(agentId=aid, round=11, action={'type': 'noop'}),
            dict(agentId=aid, kind='mempool', event='rejected',
                 reason='sizeDeltaUsd must be positive',
                 action=dict(type='gmxDecrease', sizeDeltaUsd='000', isLong=True,
                             collateral='USDC', collateralDeltaAmount='3'))]
    if defect == 'no-action':
        del rows[-1]['action']
    if defect == 'other-round':
        del rows[1]['round']
    if defect == 'timeout':
        rows.append(dict(agentId=aid, round=12, reason='decide timeout: synthetic'))
    if defect == 'wrong-reason':
        rows[-1]['reason'] = 'some other rejection'
    if defect == 'cap':
        rows.append(dict(agentId=aid, event='log_cap_reached'))
    if defect == 'no-start':
        rows.pop(0)
    if defect == 'wrong-id':
        rows[0]['agentId'] = 'different'
    if defect == 'no-decisions':
        rows[1]['round'] = 10
    if defect == 'null-round':
        rows[-1]['round'] = None
    if defect == 'bad-blockSeen':
        rows.append(dict(agentId=aid, kind='mempool', event='submitted'))
    if defect == 'extra-rejected':
        rows.append(dict(agentId=aid, kind='mempool', event='rejected'))
    if defect == 'second-known':
        rows.append(deepcopy(rows[-1]))
    runs, index_rows = [], []
    log = None
    for regime in regimes:
        for seed in seeds:
            world_status = status if not runs else 'PASS'
            path = out / (regime + '-' + seed)
            blocked = ['agent telemetry ' + aid] if world_status == 'BLOCKED' else []
            failed = ['environment p99'] if world_status == 'FAIL' or (not runs and defect == 'mixed') else []
            run = dict(regime=regime, seed=seed, status=world_status, failed=failed,
                       blocked=blocked, run_id=regime + '-' + seed)
            if world_status == 'BLOCKED':
                save(path / 'summary.json', dict(runId=run['run_id'], runStartBlock=10,
                                                finalBlock=20, agents=[{'id': x} for x in agents]))
                log = path / 'agents' / (aid + '.jsonl')
                log.parent.mkdir()
                text = ''.join(json.dumps(row) + '\n' for row in rows)
                if defect == 'newline':
                    text = text.rstrip('\n')
                if defect == 'corrupt':
                    text += '{bad tail}\n'
                if defect == 'array':
                    text += '[]\n'
                if defect == 'duplicate-key':
                    text += '{"agentId":"opponent","agentId":"opponent"}\n'
                if defect == 'non-finite':
                    text += '{"agentId":"opponent","round":1e999,"action":{}}\n'
                if defect != 'missing':
                    log.write_text(text)
            runs.append(run)
            index_rows.append(f'{regime}\t{seed}\t{path}\t0\n')
    index = out / 'index.tsv'
    index.write_text('regime\tseed\trun_dir\texit_code\n' + ''.join(index_rows))
    g = dict(schema='ascon-g0-v1', status=status, runs=runs,
             failed=[f"{r['regime']}/{r['seed']}: {x}" for r in runs for x in r['failed']],
             blocked=[f"{r['regime']}/{r['seed']}: {x}" for r in runs for x in r['blocked']],
             expected=dict(regimes=list(regimes), seeds=list(seeds), agents=list(agents)),
             timing_mode='absolute only (no baseline)', manifest_verified=True,
             manifest_sha256=sha(mp), roster_sha256=sha(roster), index_sha256=sha(index))
    gp = out / 'fixture-g0.json'
    save(gp, g)
    return dict(manifest=mp, g0=gp, log=log, index=index, g=g)


class ClassifierControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='g0-classifier-')
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name).resolve()
        self.roster = self.repo / 'roster.yaml'
        # baseline=false does NOT imply candidate; opponents may also be false.
        self.roster.write_text('agents: [{id: candidate, baseline: false}, {id: opponent, baseline: false}]\n')
        self.context = self.repo / 'context.json'
        self.verdict = self.repo / 'verdict.json'

    def prepare(self, defect='known'):
        self.f = fixture(self.repo, self.roster, defect=defect)
        result = self.call('bind')
        self.assertEqual(result.returncode, 0, result.stdout)

    def call(self, command, *extra):
        return subprocess.run([sys.executable, '-B', str(SCRIPT), command,
                               '--repo', str(self.repo), '--roster', str(self.roster),
                               '--manifest', str(self.f['manifest']), '--g0', str(self.f['g0']),
                               '--context', str(self.context), '--candidate', 'candidate',
                               '--verdict', str(self.verdict), '--g0-rc', '2', *extra],
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def assert_denied(self):
        result = self.call('classify')
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn('STOP:', result.stdout)
        self.assertNotIn('DEVIATION', result.stdout)
        verdict = json.loads(self.verdict.read_text())
        self.assertFalse(verdict['approved'])
        self.assertFalse(verdict['eligible_for_gate'])

    def test_approval_preserves_log_and_records_lines_and_denominator(self):
        self.prepare('second-known')
        before = self.f['log'].read_bytes()
        result = self.call('classify')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(result.stdout, 'DEVIATION diagnostic continuation; G0=BLOCKED; '
                         'world=calm/1; agent=opponent; eligible_for_gate=false\n')
        verdict = json.loads(self.verdict.read_text())
        self.assertTrue(verdict['approved'])
        self.assertFalse(verdict['eligible_for_gate'])
        self.assertEqual((verdict['expected_worlds'], verdict['blocked_worlds']), (2, 1))
        self.assertEqual([x['line'] for x in verdict['evidence'][0]['defects']], [3, 4])
        self.assertEqual(self.f['log'].read_bytes(), before)
        # No raw files exist for the PASS world: approval must not read them.
        self.assertFalse((self.f['index'].parent / 'crash-1').exists())

    def test_candidate_same_defect_denied(self):
        self.prepare('candidate')
        self.assert_denied()

    def test_unknown_id_denied(self):
        self.prepare('unknown')
        self.assert_denied()

    def test_defect_controls(self):
        for defect in ('newline', 'no-action', 'other-round', 'timeout', 'wrong-reason',
                       'cap', 'no-start', 'wrong-id', 'no-decisions', 'null-round',
                       'bad-blockSeen', 'extra-rejected', 'corrupt', 'missing', 'array',
                       'duplicate-key', 'non-finite'):
            with self.subTest(defect=defect):
                with tempfile.TemporaryDirectory(dir=self.repo) as root:
                    original = self.repo
                    self.repo = Path(root)
                    self.f = fixture(self.repo, self.roster, defect=defect)
                    self.context = self.repo / 'context.json'
                    self.verdict = self.repo / 'verdict.json'
                    self.assertEqual(self.call('bind').returncode, 0)
                    self.assert_denied()
                    self.repo = original

    def test_fail_and_blocked_denied(self):
        self.prepare('mixed')
        self.assert_denied()

    def test_structured_inconsistencies_denied(self):
        self.prepare()
        original = deepcopy(self.f['g'])
        for field, value in [('failed', ['hidden fail']), ('blocked', ['unexpected']),
                             ('status', 'PASS'), ('manifest_verified', False),
                             ('index_sha256', 'wrong'), ('manifest_sha256', 'wrong'),
                             ('runs', []), ('timing_mode', 'relative + absolute')]:
            with self.subTest(field=field):
                data = deepcopy(original)
                data[field] = value
                save(self.f['g0'], data)
                self.assert_denied()
                self.verdict.unlink()

    def test_hidden_world_fail_denied(self):
        self.prepare()
        self.f['g']['runs'][0]['failed'] = ['hidden fail']
        save(self.f['g0'], self.f['g'])
        self.assert_denied()

    def test_fail_in_different_world_denied(self):
        self.prepare()
        run = self.f['g']['runs'][1]
        run.update(status='FAIL', failed=['environment p99'])
        self.f['g']['failed'] = ['crash/1: environment p99']
        save(self.f['g0'], self.f['g'])
        self.assert_denied()

    def test_world_status_disagreement_denied(self):
        self.prepare()
        self.f['g']['runs'][0]['status'] = 'PASS'
        save(self.f['g0'], self.f['g'])
        self.assert_denied()

    def test_pass_header_cannot_hide_blocked_world(self):
        self.prepare()
        self.f['g'].update(status='PASS', blocked=[])
        save(self.f['g0'], self.f['g'])
        result = self.call('status', '--g0-rc', '0')
        self.assertEqual(result.returncode, 2)
        self.assertNotIn('G0 PASS', result.stdout)

    def test_multiple_blocked_worlds_all_must_approve(self):
        self.prepare()
        second = self.f['index'].parent / 'crash-1'
        shutil.copytree(self.f['log'].parent.parent, second)
        summary = json.loads((second / 'summary.json').read_text())
        summary['runId'] = 'crash-1'
        save(second / 'summary.json', summary)
        self.f['g']['runs'][1].update(status='BLOCKED', blocked=['agent telemetry opponent'])
        self.f['g']['blocked'].append('crash/1: agent telemetry opponent')
        save(self.f['g0'], self.f['g'])
        result = self.call('classify')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(result.stdout.count('DEVIATION diagnostic continuation;'), 2)
        self.assertIn('world=crash/1; agent=opponent;', result.stdout)
        verdict = json.loads(self.verdict.read_text())
        self.assertEqual(verdict['blocked_worlds'], 2)
        self.verdict.unlink()
        (second / 'agents/opponent.jsonl').write_text('corrupt\n')
        self.assert_denied()

    def test_missing_or_corrupt_structured_output_denied(self):
        self.prepare()
        self.f['g0'].unlink()
        self.assert_denied()
        self.verdict.unlink()
        self.f['g0'].write_text('not JSON\n')
        self.assert_denied()

    def test_index_changed_since_g0_denied(self):
        self.prepare()
        with self.f['index'].open('a') as stream:
            stream.write('extra\t1\tunknown\t0\n')
        self.assert_denied()

    def test_status_exit_mismatch_denied(self):
        self.prepare()
        result = self.call('classify', '--g0-rc', '0')
        self.assertEqual(result.returncode, 2)
        self.assertNotIn('DEVIATION', result.stdout)

    def test_roster_change_denied(self):
        self.prepare()
        self.roster.write_text('changed\n')
        self.assert_denied()

    def test_candidate_change_between_chunks_denied(self):
        self.prepare()
        result = self.call('bind', '--candidate', 'opponent')
        self.assertEqual(result.returncode, 2)
        self.assertIn('changed between chunks', result.stdout)

    def test_agent_tree_change_between_chunks_denied(self):
        self.prepare()
        m = json.loads(self.f['manifest'].read_text())
        m['agents']['opponent']['sha256'] = 'c' * 64
        save(self.f['manifest'], m)
        result = self.call('bind')
        self.assertEqual(result.returncode, 2)
        self.assertIn('changed between chunks', result.stdout)

    def test_unknown_candidate_cannot_bind(self):
        self.prepare()
        result = self.call('bind', '--candidate', 'unknown')
        self.assertEqual(result.returncode, 2)
        self.assertIn('candidate absent', result.stdout)

    def test_verdict_write_failure_denied(self):
        self.prepare()
        self.verdict.mkdir()
        result = self.call('classify')
        self.assertEqual(result.returncode, 2)
        self.assertIn('cannot save classifier verdict', result.stdout)
        self.assertNotIn('DEVIATION', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
