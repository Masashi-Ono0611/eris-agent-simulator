#!/usr/bin/env python3
"""Offline, deterministic r3 registration. No readiness approval or runtime repair.

Default/--check is read-only. --write refreshes reviewed repository bytes only;
never run this automatically at launch to conceal drift.
"""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PREFIX = 'ascon-notes/league/g3/'
spec = importlib.util.spec_from_file_location('g3_prestart', HERE / 'prestart-check.py')
pre = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pre)
ADDITIONS = ['register-inputs.py', 'tests/test_lock.py', 'chain/chain.py',
             'chain/gates.py', 'chain/revision_audit.py', 'chain/revision_replay.mjs',
             'chain/malicious.mjs', 'chain/make-view.py', 'chain/g3-ref-chain.sh',
             'chain/test_chain.py', 'chain/decide-budget-control.mjs',
             'chain/timeout-control.mjs', 'chain/timeout-child.cjs',
             'chain/test_revision_audit.py', 'chain/revision_exchange.mjs']


def roster(path):
    # These checked-in .yaml files use JSON with leading # comments, no YAML deps.
    return json.loads('\n'.join(x for x in path.read_text().splitlines()
                                if not x.startswith('#')))


def build(root, old):
    candidate = pre.local_tree(root / pre.CANDIDATE)
    if candidate['sha256'] != pre.EXPECTED:
        raise ValueError('STOP: r3 candidate differs from C-EXCEPTION-01 section 8')
    if pre.tree('HEAD', pre.CANDIDATE, root) != candidate:
        raise ValueError('STOP: committed/local candidate mismatch')
    lock = copy.deepcopy(old)
    lock.update(candidateId='cand', candidateDir=Path(pre.CANDIDATE).name,
                candidateSha256=candidate['sha256'])
    names = set()
    for path in sorted((root / PREFIX).glob('*.yaml')):
        agents = roster(path).get('agents', [])
        for agent in agents:
            if agent['id'] == 'cand' and agent.get('dir') != lock['candidateDir']:
                raise ValueError('candidate roster mismatch: ' + path.name)
            names.add(agent.get('dir', agent['id']))
    if not {'fixed-bid-5gwei', lock['candidateDir']} <= names:
        raise ValueError('required roster agent missing')
    lock['agentTrees'] = {name: pre.local_tree(root / 'example/agents' / name)
                          for name in sorted(names)}
    # Refresh the existing fixed tool manifest at registration time, NOT launch.
    chain_path = root / PREFIX / 'chain/chain.py'
    chain = chain_path.read_text()
    for name in ('gates.py', 'revision_audit.py'):
        digest = pre.digest((chain_path.parent / name).read_bytes())
        chain, count = re.subn(r"('" + re.escape(name) + r"':')[0-9a-f]{64}(')",
                              lambda m: m[1] + digest + m[2], chain)
        if count != 1:
            raise ValueError('tool manifest entry missing/ambiguous: ' + name)
    chain_bytes = chain.encode()
    paths = set(old['inputs']) | {PREFIX + x for x in ADDITIONS}
    lock['inputs'] = {}
    for name in sorted(paths):
        p = root / name
        if not pre.safe(p, root) or p.is_symlink() or not p.is_file():
            raise ValueError('unsafe/missing pinned input: ' + name)
        lock['inputs'][name] = pre.digest(chain_bytes if p == chain_path else p.read_bytes())
    lock['selfReservations'] = {name: lock['inputs'][name]
                                for name in sorted(old['selfReservations'])}
    # Preserve every older blocker except the now-false agent-absent assertion.
    lock['blocked'] = list(dict.fromkeys(
        [x for x in old['blocked'] if x != pre.OBSOLETE_ABSENT] + pre.REQUIRED_BLOCKERS))
    # localUpstreamRef and historical initial-state are deliberately preserved.
    return lock, chain_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = HERE / 'inputs.lock.json'
    lock, chain_bytes = build(ROOT, json.loads(path.read_text()))
    serialized = (json.dumps(lock, indent=2) + '\n').encode()
    chain_path = HERE / 'chain/chain.py'
    if args.write:
        chain_path.write_bytes(chain_bytes)
        path.write_bytes(serialized)
    matches = path.read_bytes() == serialized and chain_path.read_bytes() == chain_bytes
    verified = pre.check_inputs(ROOT, lock)
    ok = matches and verified['pass']
    print(json.dumps({'status': 'PASS' if ok else 'FAIL', 'g3Status': 'BLOCKED',
                      'registrationMatches': matches, 'verification': verified,
                      'candidateSha256': lock['candidateSha256']}, indent=2))
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
