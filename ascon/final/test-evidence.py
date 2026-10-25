#!/usr/bin/env python3
"""Small synthetic runs only; invoked in a mktemp directory by test-evidence.sh."""
import copy
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

src, temp = map(Path, sys.argv[1:3])
sys.path.insert(0, str(src))
which = sys.argv[3] if len(sys.argv) > 3 else 'all'

def load(name):
    spec = importlib.util.spec_from_file_location(name, src / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def invoke(name, *args, rc):
    p = subprocess.run([sys.executable, str(src / (name + '.py')), *map(str, args)], capture_output=True, text=True)
    assert p.returncode == rc, (name, p.returncode, p.stdout, p.stderr)
    return p


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def baseline_compare(name, args, out, rc):
    """Same inputs/paths, byte-for-byte against the pre-retest main scripts."""
    baseline = temp / 'baseline-9452b947'
    baseline.mkdir(exist_ok=True)
    repo = Path(__file__).resolve().parents[2]
    for module in ('make-manifest', 'mechanism', 'judge2', 'stage2-plan'):
        result = subprocess.run(['git', '-C', str(repo), 'show',
                                 f'9452b947523818fba05d5de651deeabded4aba2f:ascon/final/{module}.py'],
                                capture_output=True, check=True)
        (baseline / (module + '.py')).write_bytes(result.stdout)
    paths = [out] + ([Path(str(out) + '.audit.json')] if name == 'make-manifest' else [])
    expected = [p.read_bytes() for p in paths]
    result = subprocess.run([sys.executable, str(baseline / (name + '.py')), *map(str, args)],
                            capture_output=True, text=True)
    assert result.returncode == rc, (result.stdout, result.stderr)
    assert [p.read_bytes() for p in paths] == expected, (name, 'baseline bytes differ')


def manifest_controls():
    logs = temp / 'logs'
    logs.mkdir()
    local = temp / 'copy'
    out = temp / 'manifest.json'
    args = ['--logs', logs, '--stage', '1', '--out', out]

    def read():
        return json.loads(out.read_text()), json.loads(Path(str(out) + '.audit.json').read_text())

    def passing(job, arm, run):
        path = local / job / 'matrix.json'
        dump(path, {'fixture': job})
        return (f'NOTE_{job} run={run} slot={arm} matrix={path} head={"e" * 12} arm_tree={"a" * 12}\n'
                f'EXIT_{job}=0 VERDICT=PASS COLLISION=PASS ARM=PASS run={run}\n')

    baseline = ''.join(passing(f's1-FD1003-{arm}', arm, f'B-{arm}')
                       for arm in ('opus-1', 'opus-1-pb'))
    (logs / 'B.queue.log').write_text(baseline)
    # Synthetic killed queues: repeated FAIL, interruption, stale lock, new run ids.
    for lane, arm in zip('CDEF', ('opus-1g', 'opus-1r', 'ascon-zeta-r3k', 'ascon-zeta-r3kg')):
        job = f's1-FP1003-{arm}'
        fail = f'EXIT_{job}=1 VERDICT=FAIL COLLISION=SKIP ARM=SKIP run={lane}-killed\n'
        text = (f'NOTE_{job} run={lane}-killed slot={arm}\n' + fail * 2 +
                f'EXIT_{job}=- VERDICT=FAIL interrupted run={lane}-killed\n' +
                f'NOTE_{job} run={lane}-rerun slot={arm}\n')
        if lane in 'CD':
            text += f'EXIT_{job}=1 VERDICT=BLOCKED run={lane}-stale-lock\n'
        (logs / f'{lane}.queue.log').write_text(text)
    invoke('make-manifest', *args, rc=2)
    man, audit = read()
    assert set(man) <= load('judge2').MANIFEST_KEYS
    assert len(man['cells']) == 1 and man['cells'][0]['field'] == 'FD'
    assert man['cells'][0]['seed'] == 1003 and set(man['cells'][0]['arms']) == {'B', "B'"}
    assert len(audit['selected']) == 2 and len(audit['missing']) == 62
    assert len(audit['ignored']) == 10
    killed = [r for r in audit['ignored'] if r['run'].endswith('-killed')]
    assert len(killed) == 4 and all(len(r['exits']) == 3 for r in killed)
    assert all(r['reason'].startswith('ignored attempt:') for r in audit['ignored'])
    assert len([r for r in audit['ignored'] if 'outside selected' in r['reason']]) == 0
    print('KILLED_QUEUE_CONTROLS_OK selected=2 missing=62 ignored=10')

    job, arm = 's1-FD1003-opus-1', 'opus-1'
    lane_b = logs / 'B.queue.log'
    # Identical PASS repeats preserve one result; conflicting PASS lines do not.
    duplicate = baseline.splitlines()[1] + '\n'
    lane_b.write_text(baseline + duplicate)
    invoke('make-manifest', *args, rc=2)
    assert len(read()[1]['selected']) == 2
    lane_b.write_text(baseline + duplicate.replace('ARM=PASS', 'ARM=FAIL'))
    invoke('make-manifest', *args, rc=2)
    assert any(m['job'] == job and 'conflicting EXIT' in m['reason'] for m in read()[1]['missing'])
    # A lone PASS still needs successful exit, collision/arm checks and provenance.
    for old, new in [('=0 VERDICT=PASS', '=1 VERDICT=PASS'),
                     ('COLLISION=PASS', 'COLLISION=FAIL'), ('ARM=PASS', 'ARM=FAIL'),
                     ('slot=opus-1 ', 'slot=wrong ')]:
        lane_b.write_text(baseline.replace(old, new, 1))
        invoke('make-manifest', *args, rc=2)
        assert len(read()[1]['selected']) == 1
    # Two PASS runs are ambiguous both within a lane and across lanes.
    for cross_lane in (False, True):
        lane_b.write_text(baseline + ('' if cross_lane else passing(job, arm, 'second')))
        other = logs / 'A.queue.log'
        other.write_text(passing(job, arm, 'second') if cross_lane else '')
        invoke('make-manifest', *args, rc=2)
        assert any(m['job'] == job and 'multiple PASS' in m['reason'] for m in read()[1]['missing'])
        assert len(read()[1]['selected']) == 1
    other.write_text('')
    # A later successful retry of a failed run is eligible under its new id.
    lane_b.write_text(baseline)
    c = logs / 'C.queue.log'
    c.write_text(c.read_text() + passing('s1-FP1003-opus-1g', 'opus-1g', 'C-success'))
    invoke('make-manifest', *args, rc=2)
    assert len(read()[1]['selected']) == 3
    # Conflicting NOTE and malformed run evidence still write both partial files.
    lane_b.write_text(baseline + f'NOTE_{job} run=B-opus-1 slot=wrong\n')
    invoke('make-manifest', *args, rc=2)
    assert any('conflicting slot' in m['reason'] for m in read()[1]['missing'])
    lane_b.write_text(baseline + f'EXIT_{job}=1 VERDICT=FAIL\n')
    invoke('make-manifest', *args, rc=2)
    assert read()[1]['errors'] and not read()[0]['cells']
    # Queue extraction preserves remote paths even without local matrix copies.
    lane_b.write_text(baseline.replace(str(local), '/missing-mini-matrices'))
    invoke('make-manifest', *args, rc=2)
    assert len(read()[1]['selected']) == 3
    fd = next(c for c in read()[0]['cells'] if c['field'] == 'FD')
    assert fd['arms']['B'] == '/missing-mini-matrices/s1-FD1003-opus-1/matrix.json'
    # Complete design and path mapping remain supported.
    for log in logs.glob('*.queue.log'):
        log.write_text('')
    lines = ''.join(passing(f's1-{field}{seed}-{arm}', arm, 'only')
                    for seed in range(1003, 1007) for field in ('FP', 'FD')
                    for arm in tuple(load('judge2').DEFAULT_ARM_MAP.values()))
    lane_b.write_text(lines.replace(str(local), '/mini'))
    invoke('make-manifest', *args, '--path-map', f'/mini={local}', rc=0)
    man, audit = read()
    assert len(man['cells']) == 8 and len(audit['selected']) == 64 and not audit['missing']
    assert all(Path(path).is_file() for cell in man['cells'] for path in cell['arms'].values())
    assert 'C1' not in man['candidates']
    for cell in man['cells']:
        for arm, proof in cell['arm_evidence'].items():
            assert proof == dict(ARM='PASS', COLLISION='PASS', slot=man['arm_map'][arm], head='e'*12, arm_tree='a'*12, matrix=str(Path(cell['arms'][arm]).resolve()))
    amap = load('judge2').DEFAULT_ARM_MAP
    assert amap == {'B': 'opus-1', "B'": 'opus-1-pb', 'R': 'opus-1r',
                    'W1': 'opus-1g2', 'W2': 'ascon-zeta-r3k', 'X1': 'opus-1g',
                    'X2': 'opus-1w', 'X3': 'ascon-zeta-r3kg'}
    explicit = [f'{k}={v}' for k, v in amap.items() if k not in ('B', "B'")]
    invoke('make-manifest', *args, '--arms', *explicit, rc=0)
    assert read()[0]['arm_map'] == amap
    lane_b.write_text('\n'.join(line for line in lines.splitlines() if '-ascon-zeta-r3k ' not in line and '-ascon-zeta-r3k=' not in line))
    invoke('make-manifest', *args, '--arms', *explicit, rc=2)
    man, audit = read()
    assert len(audit['missing']) == 8 and all(x['job'].endswith('-ascon-zeta-r3k') for x in audit['missing'])
    assert all('W2' not in cell['arms'] and 'R' in cell['arms'] for cell in man['cells'])
    for entries in [('R=one', 'R=two'), ('R=opus-1',), ('B=wrong', 'R=right'), ('R',)]:
        invoke('make-manifest', *args, '--arms', *entries, rc=2)
    print('ARM_MAP_CONTROLS_OK no C1, explicit 8 arms, missing W2 only, invalid maps refused')
    print('MANIFEST_CONTROLS_OK')


def mechanism_controls():
    root = temp / 'data'
    matrix = root / 'runs' / 'matrix-fixture' / 'matrix.json'
    run = root / 'runs' / 'one'
    agent = run / 'agents' / 'slot.jsonl'
    agent.parent.mkdir(parents=True)
    summary = run / 'summary.json'
    dump(summary, {'runStartBlock': 1639, 'finalBlock': 1999, 'blocksProcessed': 360, 'loopIterations': 362})
    decision = {'agentId': 'slot', 'round': 1998, 'action': {'type': 'noop'}}
    events = [{'event': 'runtime_start'}, {'event': 'submit_failed', 'error': 'STF'},
              {'reason': 'launch entry token: net +20'},
              {'event': 'submitted', 'error': 'STF'},
              {'event': 'submit_failed', 'error': 'not STF-like?'}]
    # Non-STF failure, before-entry STF, submitted STF are all negative controls.
    events[-1]['error'] = 'other revert'
    agent.write_text('\n'.join(map(json.dumps, events)) + '\n')
    (agent.parent / 'other.jsonl').write_text(json.dumps({'reason': 'decide timeout: no answer'}))
    dump(matrix, {'scenarios': [{'runDir': 'runs/one'}]})
    cols = ['blockNumber', 'txIndex', 'from', 'priorityFeeWei', 'ownerId', 'to']
    txs = [[1, 1, 'a', 10, 'slot', 'router'], [1, 0, 'b', 10, 'other', 'router'],
           [1, 2, 'c', 10, 'other', 'router'], [1, 3, 'd', 10, 'other', 'router'],
           [1, 4, 'a', 10, 'slot', 'elsewhere'], [2, 0, 'e', 10, 'other', 'router'],
           [1, 5, 'f', 11, 'other', 'router'], [1, 6, 'a', 10, 'other', 'router']]
    with (run / 'blocks.csv').open('w', newline='') as f:
        w = csv.writer(f); w.writerow(cols); w.writerows(txs)
    mech = load('mechanism')
    saved_log = agent.read_text()
    def decisions(last=1998, start=1638):
        rows = []
        for i in range(start, last + 1):
            rows.append(dict(decision, round=i, reason='strategy decision'))
            if i < 1922:
                rows.append(dict(decision, round=i, reason='decide returned nothing'))
        return ''.join(json.dumps(row) + '\n' for row in rows)
    saved_log += decisions(1628, 1628)
    assert len((decisions(1628, 1628) + decisions()).splitlines()) == 647
    for last_round in (None, 140, 1996, 2002):
        agent.write_text(saved_log + (decisions(last_round) if last_round is not None else ''))
        try:
            mech.measure(matrix, 'slot', [])
        except ValueError:
            pass
        else:
            raise AssertionError(f'incomplete slot log accepted: {last_round}')
    for last_round in (1997, 1998, 1999, 2001):
        agent.write_text(saved_log + decisions(last_round))
        assert mech.measure(matrix, 'slot', [])['slot_timeouts'] == 0
    agent.write_text(saved_log + decisions(1700) + decisions(start=1703))
    assert mech.measure(matrix, 'slot', [])['slot_timeouts'] == 0
    agent.write_text(saved_log + decisions())
    complete = agent.read_text()
    for truncated in (decisions(start=1900), decisions(1700) + decisions(start=1704),
                      decisions(1700) + decisions(start=1706),
                      decisions() + decisions(1997, 1997)):
        agent.write_text(saved_log + truncated)
        try:
            mech.measure(matrix, 'slot', [])
        except ValueError:
            pass
        else:
            raise AssertionError('discontinuous slot log accepted')
    agent.write_text(complete)
    print('CONTINUOUS_SLOT_LOG_OK missing prefix, middle gap, reversed round rejected')
    saved_summary = summary.read_text()
    for invalid in (None, '{broken', '{}', '{"finalBlock": 1999}',
                    '{"finalBlock": "1999", "blocksProcessed": 2000}'):
        if invalid is None:
            summary.unlink()
        else:
            summary.write_text(invalid)
        try:
            mech.measure(matrix, 'slot', [])
        except (OSError, ValueError):
            pass
        else:
            raise AssertionError(f'invalid summary accepted: {invalid}')
    summary.write_text(saved_summary)
    result = mech.measure(matrix, 'slot', [])
    assert result == dict(slot_timeouts=0, stf=0, tie_wins=2, tie_pairs=3), result
    with agent.open('a') as f:
        f.write(json.dumps({'reason': 'decide timeout: no answer within 5000ms'}) + '\n')
        f.write(json.dumps({'event': 'submit_failed', 'error': 'Execution reverted: STF'}) + '\n')
    result = mech.measure(matrix, 'slot', [])
    assert result['slot_timeouts'] == 1 and result['stf'] == 1
    # Reset entry tracking between scenarios.
    run2 = root / 'runs' / 'two'
    (run2 / 'agents').mkdir(parents=True)
    dump(run2 / 'summary.json', {'runStartBlock': 1639, 'finalBlock': 1999, 'blocksProcessed': 360, 'loopIterations': 362})
    (run2 / 'agents' / 'slot.jsonl').write_text('\n'.join(map(json.dumps, [
        {'event': 'runtime_start'}, {'event': 'submit_failed', 'error': 'STF'}])) + '\n' + decisions())
    (run2 / 'blocks.csv').write_text(','.join(cols) + '\n')
    dump(matrix, {'scenarios': [{'runDir': '/mini/runs/one'}, {'runDir': '/mini/runs/two'}]})
    man = temp / 'M.json'
    dump(man, dict(candidates={'R': 'superiority'}, cells=[dict(seed=1003, field='FP', arms={'R': str(matrix)})]))
    dump(Path(str(man) + '.audit.json'), {'path_maps': [['/mini', str(root)]]})
    out = temp / 'MECH.json'
    invoke('mechanism', man, '--out', out, rc=2)
    r = json.loads(out.read_text())['arms']['R']
    # Collector and judge must preserve BLOCKED for incomplete execution evidence.
    complete_log = agent.read_text()
    for control in ('early-slot', 'five-block-gap', 'missing-summary'):
        if control == 'early-slot':
            agent.write_text(saved_log + decisions(1800))
        elif control == 'five-block-gap':
            agent.write_text(saved_log + decisions(1700) + decisions(start=1706))
        else:
            summary.unlink()
        invoke('mechanism', man, '--out', out, rc=2)
        blocked = json.loads(out.read_text())['arms']['R']
        assert blocked['errors'] and blocked['slot_timeouts'] is None and blocked['stf'] is None
        j = load('judge2')
        hashes = set(blocked['matrices_sha256'])
        subs = j.mechanism_clause({'R': blocked, 'B': r}, 'R', 'B', 'superiority',
                                 {'R': hashes, 'B': hashes})
        assert j._combine(subs) == 'BLOCKED', subs
        print(f'COMPLETION_CONTROL_OK {control} -> BLOCKED')
        agent.write_text(complete_log)
        summary.write_text(saved_summary)
    print('COMPLETION_CONTROL_OK summary + last decision round 1998 / finalBlock 1999; no runtime_end')
    # The same explicit mapping flows through extraction, including absent W2/X.
    mapped = json.loads(man.read_text())
    mapped['arm_map'] = {'B': 'opus-1', "B'": 'opus-1-pb', 'R': 'opus-1r',
                         'W2': 'ascon-zeta-r3k', 'X1': 'opus-1g'}
    mapped['candidates'] = {a: 'superiority' for a in ('R', 'W2', 'X1')}
    dump(man, mapped)
    invoke('mechanism', man, '--out', out, '--arms', 'R=opus-1r', 'W2=ascon-zeta-r3k', 'X1=opus-1g', rc=2)
    extracted = json.loads(out.read_text())
    assert extracted['arm_map'] == mapped['arm_map'] and 'C1' not in extracted['arms']
    assert extracted['arms']['R']['slot_timeouts'] == 1
    assert extracted['arms']['W2']['errors'] == ['no matrices']
    assert extracted['arms']['X1']['errors'] == ['no matrices']
    # A conflicting CLI map is rejected without overwriting evidence.
    before = out.read_bytes()
    invoke('mechanism', man, '--out', out, '--arms', 'R=wrong', rc=2)
    assert out.read_bytes() == before
    print('MECHANISM_ARM_MAP_OK missing W2/X explicit, no C1, mismatch refused')
    assert r['stf'] == 1 and r['slot_timeouts'] == 1 and r['tie_win_rate'] == 2/3
    assert r['matrices_sha256'] == [hashlib.sha256(matrix.read_bytes()).hexdigest()]
    assert r['p99_decide_ms'] is None and r['p99_decide_ms_reason']
    # Approved advisory: explicit null with reason does not block clause 5.
    j = load('judge2')
    h = r['matrices_sha256']
    good = dict(r, slot_timeouts=0, stf=0)
    evidence = {'R': good, 'B': dict(good)}
    subs = j.mechanism_clause(evidence, 'R', 'B', 'superiority', {'R': set(h), 'B': set(h)})
    assert subs['p99_latency']['status'] == 'NOT_MEASURED'
    assert all(v['status'] == 'PASS' for k, v in subs.items() if k != 'p99_latency')
    cells = {(s, f): {'regimes': {reg: (1.0, 1.0) for reg in j.REGIMES12}}
             for s in range(1003, 1007) for f in j.FIELDS}
    verdict = j.evaluate('superiority', cells, mechanism_subs=subs, f_override=.25)
    assert verdict['verdict'] == 'PASS', verdict
    for duration, expected in [(499, 'PASS'), (500, 'FAIL')]:
        good['p99_decide_ms'] = duration
        ss = j.mechanism_clause(evidence, 'R', 'B', 'superiority', {'R': set(h), 'B': set(h)})
        assert ss['p99_latency']['status'] == expected
        assert j.evaluate('superiority', cells, mechanism_subs=ss, f_override=.25)['verdict'] == expected
    good['p99_decide_ms'] = None
    good['slot_timeouts'] = 1
    ss = j.mechanism_clause(evidence, 'R', 'B', 'superiority', {'R': set(h), 'B': set(h)})
    assert ss['p99_latency']['status'] == 'NOT_MEASURED'
    assert j.evaluate('superiority', cells, mechanism_subs=ss, f_override=.25)['verdict'] == 'FAIL'
    print('P99_NULL_WITH_TIMEOUT=FAIL (FAIL takes precedence)')
    print('P99_NULL_WITH_REASON=NOT_MEASURED (candidate PASS) P99_499=PASS P99_500=FAIL (clause and candidate)')
    assert r['matrices'][0]['tie_win_rate'] == 2/3
    # Global collector dedupe: relabelled copies cannot contribute another observation.
    original_man = man.read_text()
    duplicate = matrix.parent / 'copy.json'
    original_matrix = json.loads(matrix.read_text())
    for different_bytes in (False, True):
        copied = dict(original_matrix, seed=9999) if different_bytes else original_matrix
        if different_bytes:
            copied['scenarios'] = [dict(row, runDir=row['runDir'].replace('/runs/', '/runs/./'))
                                   for row in original_matrix['scenarios']]
        dump(duplicate, copied)
        for other_arm in ('R', 'W2'):
            mm = json.loads(original_man)
            mm['cells'].append(dict(seed=1004, field='FP', arms={other_arm: str(duplicate)}))
            dump(man, mm)
            invoke('mechanism', man, '--out', out, rc=2)
            failed = json.loads(out.read_text())['arms'][other_arm]
            assert failed['slot_timeouts'] is None and failed['stf'] is None
            assert any('duplicate' in error for error in failed['errors']), failed
    man.write_text(original_man)
    print('GLOBAL_DEDUPE_OK copied hashes and aliased runs across cells/arms')
    # Byte-identical relative matrices under distinct roots are independent.
    import shutil
    independent = []
    for name in ('independent-a', 'independent-b'):
        base = temp / name
        shutil.copytree(run, base / 'runs' / 'one')
        path = base / 'runs' / 'matrix' / 'matrix.json'
        dump(path, {'scenarios': [{'runDir': 'runs/one'}]})
        independent.append(path)
    mm = json.loads(original_man)
    mm['cells'] = [dict(seed=1003+i, field='FP', arms={'R': str(path)})
                   for i, path in enumerate(independent)]
    dump(man, mm)
    invoke('mechanism', man, '--out', out, rc=2)
    rr = json.loads(out.read_text())['arms']['R']
    assert not rr['errors'] and rr['slot_timeouts'] == 2, rr
    assert len(rr['matrices']) == 2
    provenance = j.mechanism_clause({'R': rr, 'B': rr}, 'R', 'B', 'superiority',
                                  {'R': set(rr['matrices_sha256']), 'B': set(rr['matrices_sha256'])})
    assert provenance['provenance']['status'] == 'PASS', provenance
    man.write_text(original_man)
    print('INDEPENDENT_IDENTICAL_MATRICES_OK collector')

    # A header-only CSV is a valid no-tie sample, never a fabricated 0 or 0.5.
    (run / 'blocks.csv').write_text(','.join(cols) + '\n')
    invoke('mechanism', man, '--out', out, rc=2)
    rr = json.loads(out.read_text())['arms']['R']
    assert rr['tie_win_rate'] is None and rr['tie_pairs'] == 0 and not rr['errors']
    # Truncated CSV cannot be interpreted as a clean no-tie sample.
    (run / 'blocks.csv').write_text(','.join(cols) + '\n1,0,a,10\n')
    invoke('mechanism', man, '--out', out, rc=2)
    rr = json.loads(out.read_text())['arms']['R']
    assert rr['tie_win_rate'] is None and rr['errors']
    # Broken or absent logs must not become zero failures.
    agent.write_text('{broken\n')
    invoke('mechanism', man, '--out', out, rc=2)
    rr = json.loads(out.read_text())['arms']['R']
    assert rr['stf'] is None and rr['slot_timeouts'] is None and rr['errors']
    agent.unlink()
    invoke('mechanism', man, '--out', out, rc=2)
    assert json.loads(out.read_text())['arms']['R']['tie_win_rate'] is None
    print('MECHANISM_CONTROLS_OK')


def stage2_controls():
    """Real CLI chain on synthetic matrices AND execution logs, with no doubles."""
    j = load('judge2')
    root = temp / 'stage2'
    root.mkdir()
    mapping = {'B': 'opus-1', "B'": 'opus-1-pb', 'R': 'opus-1r'}

    def fixtures(stage):
        logs = root / ('logs' + stage)
        logs.mkdir()
        seeds = {'1': range(1003, 1007), '2': range(1011, 1015), 'retest': range(1021, 1025)}
        cells = [(s, f) for s in seeds[stage]
                 for f in ('FP', 'FD')]
        if stage == '2':
            cells += [(s, 'FS') for s in (1101, 1102)]
        lines = []
        for seed, field in cells:
            regimes = j.FS_REGIMES if field == 'FS' else j.REGIMES12
            for label, directory in mapping.items():
                if stage != '1' and label == "B'":
                    continue
                prefix = 'rt' if stage == 'retest' else 's' + stage
                job = f'{prefix}-{field}{seed}-{directory}'
                matrix = root / 'runs' / ('matrix-' + job) / 'matrix.json'
                rows = []
                for i, regime in enumerate(regimes, 1):
                    run = root / 'runs' / f'{job}-{i}'
                    (run / 'agents').mkdir(parents=True)
                    dump(run / 'summary.json', dict(runStartBlock=100, finalBlock=110, blocksProcessed=10))
                    (run / 'agents' / 'slot.jsonl').write_text(''.join(
                        json.dumps(dict(agentId='slot', round=r, action={'type': 'noop'})) + '\n'
                        for r in range(99, 111)))
                    (run / 'blocks.csv').write_text(
                        'blockNumber,txIndex,from,priorityFeeWei,ownerId,to\n'
                        '101,0,a,10,slot,router\n101,1,b,10,other,router\n')
                    agents = [dict(id=name, baseline=base, pnlUsdc=100*k)
                              for k, (name, base) in enumerate(j.read_roster(field)) if name != 'slot']
                    agents.append(dict(id='slot', pnlUsdc=400 if label == 'R' else 300))
                    rows.append(dict(s=i, regime=regime, seed=seed, agents=agents,
                                     runDir='/mini/runs/' + run.name))
                dump(matrix, dict(schema=2, sourceCommit='e'*40, resetUnit='scenario', repeat=1,
                                  k=len(rows), scenariosPlanned=len(rows), scenarios=rows,
                                  scenarioKey={'commitment': 'sha256:' + '5'*64}, scenarioStreams='regime-v1'))
                lines.append(f'NOTE_{job} run=only slot={directory} matrix=/mini/runs/{matrix.parent.name}/matrix.json '
                             + 'head=' + 'e'*12 + ' arm_tree=' + 'a'*12 + '\n'
                             + f'EXIT_{job}=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=only\n')
        (logs / 'A.queue.log').write_text(''.join(lines))
        return logs

    v1, v2 = root / 'V1.json', root / 'V2.json'
    m1, m2 = root / 'M1.json', root / 'M2.json'
    mech1, mech2 = root / 'MECH1.json', root / 'MECH2.json'
    logs1, logs2 = fixtures('1'), fixtures('2')
    invoke('make-manifest', '--stage', '1', '--logs', logs1, '--out', m1,
           '--arms', 'R=opus-1r', '--path-map', f'/mini={root}', rc=0)
    invoke('mechanism', m1, '--out', mech1, rc=2)
    baseline_compare('make-manifest', ['--stage', '1', '--logs', logs1, '--out', m1,
                                     '--arms', 'R=opus-1r', '--path-map', f'/mini={root}'], m1, 0)
    baseline_compare('mechanism', [m1, '--out', mech1], mech1, 2)
    invoke('judge2', 'judge', '--manifest', m1, '--mechanism', mech1, '--out', v1, rc=0)
    prior = json.loads(v1.read_text())
    assert prior['candidates']['R']['verdict'] == 'PASS', prior
    assert prior['selection']['F'] == 'R'
    args = ['--stage', '2', '--logs', logs2, '--out', m2, '--path-map', f'/mini={root}']
    invoke('make-manifest', *args, '--stage1-verdict', v1, rc=0)
    complete = m2.read_bytes()
    man = json.loads(complete)
    assert man['stage'] == '2' and man['arm_map'] == mapping
    assert man['candidates'] == {'R': 'superiority'} and len(man['cells']) == 10
    assert {(c['seed'], c['field']) for c in man['cells']} == {
        *((s, f) for s in range(1011, 1015) for f in ('FP', 'FD')), (1101, 'FS'), (1102, 'FS')}
    assert all(set(c['arms']) == set(c['arm_evidence']) == {'B', 'R'} for c in man['cells'])
    for c in man['cells']:
        for arm, proof in c['arm_evidence'].items():
            assert not j.arm_problems(proof, mapping[arm], {'sourceCommit': 'e'*40}, c['arms'][arm])
    # Explicit selection has identical bytes, with or without the prior verdict.
    for extra in ([], ['--stage1-verdict', v1]):
        invoke('make-manifest', *args, '--arms', 'R=opus-1r', *extra, rc=0)
        assert m2.read_bytes() == complete
    invoke('mechanism', m2, '--out', mech2, rc=2)
    baseline_compare('make-manifest', [*args, '--stage1-verdict', v1], m2, 0)
    baseline_compare('mechanism', [m2, '--out', mech2], mech2, 2)
    print('BASELINE_BYTES_OK stage 1/2 manifests, audits and mechanisms == main 9452b947')
    measured = json.loads(mech2.read_text())
    assert set(measured['arms']) == {'B', 'R'} and measured['arm_map'] == mapping
    for arm, evidence in measured['arms'].items():
        assert not evidence['errors'] and len(evidence['matrices']) == 10
        assert evidence['matrices_sha256'] == sorted(hashlib.sha256(Path(c['arms'][arm]).read_bytes()).hexdigest()
                                                    for c in man['cells'])
        assert evidence['slot_timeouts'] == evidence['stf'] == 0
        assert evidence['tie_pairs'] == 102  # 8*12 + 2*3 scenarios, including FS
    judge_args = ['judge', '--stage', '2', '--stage1-verdict', v1,
                  '--manifest', m2, '--mechanism', mech2, '--out', v2]
    invoke('judge2', *judge_args, rc=0)
    verdict = json.loads(v2.read_text())
    assert verdict['candidates']['R']['verdict'] == 'PASS', verdict
    assert verdict['prior']['f'] == prior['placebo']['f']
    print('STAGE2_CHAIN_OK 10 cells -> manifest -> mechanism (10 hashes/arm, no B-prime) -> judge PASS')
    if which in ('all', 'retest'):
        retest_controls(root, fixtures('retest'), logs2, v2, mapping)

    # Candidate identity is inherited, never hardcoded to R.
    renamed = copy.deepcopy(prior)
    for obj in (renamed['arm_map'], renamed['candidates'], renamed['inputs']['matrices']):
        obj['W1'] = obj.pop('R')
    renamed['selection']['F'] = 'W1'
    alternate = root / 'alternate.json'
    dump(alternate, renamed)
    invoke('make-manifest', *args, '--stage1-verdict', alternate, rc=0)
    assert json.loads(m2.read_text())['candidates'] == {'W1': 'superiority'}
    for extra in ([], ['--arms', 'R=opus-1r', 'W1=opus-1g2'], ['--arms', 'X1=opus-1g'],
                  ['--stage1-verdict', alternate, '--arms', 'R=opus-1r']):
        invoke('make-manifest', *args, *extra, rc=2)
    malformed = root / 'invalid-prior.json'
    for value in ({}, [], dict(prior, selection={'status': 'PENDING', 'F': 'R'})):
        dump(malformed, value)
        invoke('make-manifest', *args, '--stage1-verdict', malformed, rc=2)
    print('STAGE2_SELECTION_OK prior label, explicit map, invalid/multiple/informational candidates refused')

    lane = logs2 / 'A.queue.log'
    original = lane.read_text()
    target = 's2-FS1102-opus-1r'
    attempt = ''.join(line + '\n' for line in original.splitlines() if target in line)
    def extract(text, rc=2, other=''):
        lane.write_text(text)
        (logs2 / 'B.queue.log').write_text(other)
        invoke('make-manifest', *args, '--stage1-verdict', v1, rc=rc)
        return json.loads(Path(str(m2) + '.audit.json').read_text())

    # A failed attempt plus a successful retry is eligible; duplicate PASS is not.
    failed = attempt.replace('run=only', 'run=killed').replace('=0 VERDICT=PASS', '=1 VERDICT=FAIL')
    assert len(extract(failed + original, rc=0)['selected']) == 20
    assert len(extract(original + attempt.splitlines()[1] + '\n', rc=0)['selected']) == 20
    for cross_lane in (False, True):
        duplicate = attempt.replace('run=only', 'run=second')
        audit = extract(original + ('' if cross_lane else duplicate), other=duplicate if cross_lane else '')
        assert audit['missing'] == [dict(job=target, reason='ambiguous: multiple PASS runs for the same job')]
    for old, new in [('=0 VERDICT=PASS', '=1 VERDICT=PASS'), ('ARM=PASS', 'ARM=FAIL'),
                     ('COLLISION=PASS', 'COLLISION=FAIL'), ('slot=opus-1r', 'slot=wrong'),
                     ('head=' + 'e'*12, 'head=')]:
        audit = extract(original.replace(attempt, attempt.replace(old, new)))
        assert len(audit['missing']) == 1 and audit['missing'][0]['job'] == target
    audit = extract(original + attempt.splitlines()[1].replace('ARM=PASS', 'ARM=FAIL') + '\n')
    assert 'conflicting EXIT' in audit['missing'][0]['reason']
    audit = extract(original + f'NOTE_{target} run=only slot=wrong\n')
    assert 'conflicting slot' in audit['missing'][0]['reason']
    audit = extract(original + f'EXIT_{target}=1 VERDICT=FAIL\n')
    assert audit['errors'] and len(audit['missing']) == 20
    # Stage-1 and out-of-design jobs (including B-prime) never become stage-2 cells.
    outside = attempt.replace('FS1102', 'FS1011') + attempt.replace('opus-1r', 'opus-1-pb')
    audit = extract(original + outside + (logs1 / 'A.queue.log').read_text(), rc=0)
    assert len(audit['ignored']) == 2 and m2.read_bytes() == complete
    # One missing arm is BLOCKED by the judge; an absent whole FS cell is rejected as incomplete.
    audit = extract(original.replace(attempt, ''))
    assert len(audit['missing']) == 1 and audit['missing'][0]['job'] == target
    invoke('mechanism', m2, '--out', mech2, rc=2)
    invoke('judge2', *judge_args, rc=0)
    assert json.loads(v2.read_text())['candidates']['R']['verdict'] == 'BLOCKED'
    audit = extract(''.join(line + '\n' for line in original.splitlines() if 's2-FS1102-' not in line))
    assert len(audit['missing']) == 2
    result = invoke('judge2', *judge_args, rc=2)
    assert 'FS#1102' in result.stderr and 'not listed' in result.stderr
    print('STAGE2_GUARDS_OK retries, duplicates, invalid guards, missing FS arm/cell -> BLOCKED/incomplete')
    extract(original, rc=0)
    invoke('mechanism', m2, '--out', mech2, rc=2)
    # Tamper with an FS matrix after extraction: hash provenance must block.
    fs_path = Path(next(c for c in man['cells'] if c['field'] == 'FS')['arms']['R'])
    saved = fs_path.read_bytes()
    fs_path.write_bytes(saved + b'\n')
    invoke('judge2', *judge_args, rc=0)
    blocked = json.loads(v2.read_text())['candidates']['R']
    assert blocked['verdict'] == 'BLOCKED'
    assert blocked['clauses']['5_mechanism']['subclauses']['provenance']['status'] == 'BLOCKED', blocked
    fs_path.write_bytes(saved)
    print('STAGE2_HASH_MISMATCH_OK FS matrix tampering -> BLOCKED')


def retest_controls(root, logs, logs2, v2, mapping):
    """Protect combined coverage/provenance at the actual three CLI boundaries."""
    m, mech, v = (root / name for name in ('RT.json', 'RT-MECH.json', 'RT-V.json'))
    args = ['--stage', 'retest', '--logs', logs, '--out', m, '--path-map', f'/mini={root}']
    judge_args = ['judge', '--stage', 'retest', '--stage2-verdict', v2,
                  '--manifest', m, '--mechanism', mech, '--out', v]
    invoke('make-manifest', *args, '--stage2-verdict', v2, rc=0)
    complete = m.read_bytes()
    man = json.loads(complete)
    assert man['stage'] == 'retest' and man['arm_map'] == mapping
    assert man['candidates'] == {'R': 'superiority'}
    assert {(c['seed'], c['field']) for c in man['cells']} == {
        (s, f) for s in (*range(1011, 1015), *range(1021, 1025)) for f in ('FP', 'FD')}
    assert all(set(c['arms']) == set(c['arm_evidence']) == {'B', 'R'} for c in man['cells'])
    invoke('mechanism', m, '--out', mech, rc=2)
    measured = json.loads(mech.read_text())
    assert set(measured['arms']) == {'B', 'R'}
    for arm, evidence in measured['arms'].items():
        assert not evidence['errors'] and len(evidence['matrices']) == 16
        assert evidence['p99_decide_ms'] is None and evidence['p99_decide_ms_reason']
        assert evidence['matrices_sha256'] == sorted(
            hashlib.sha256(Path(c['arms'][arm]).read_bytes()).hexdigest() for c in man['cells'])
        assert evidence['tie_pairs'] == 192 and evidence['slot_timeouts'] == evidence['stf'] == 0
    invoke('judge2', *judge_args, rc=0)
    result = json.loads(v.read_text())
    assert result['candidates']['R']['verdict'] == 'KEEP', result
    assert result['candidates']['R']['n'] == 8
    assert len(result['cells']) == 16 and result['design']['fs_seeds'] == []
    print('RETEST_CHAIN_OK 16 FP/FD cells -> manifest -> mechanism (exit 2, 16 hashes/arm, no FS/B-prime) -> KEEP')

    # With no verdict, original stage-2 lane logs are required; never synthesize old cells.
    old_logs = logs / 'stage2.queue.log'
    old_logs.write_text((logs2 / 'A.queue.log').read_text())
    invoke('make-manifest', *args, '--arms', 'R=opus-1r', rc=0)
    assert m.read_bytes() == complete
    old_logs.unlink()
    invoke('make-manifest', *args, '--arms', 'R=opus-1r', rc=2)
    assert len(json.loads(Path(str(m) + '.audit.json').read_text())['missing']) == 16
    invoke('make-manifest', *args, rc=2)
    invoke('make-manifest', *args, '--stage2-verdict', v2, '--arms', 'W1=opus-1g2', rc=2)
    renamed = json.loads(v2.read_text())
    for obj in (renamed['arm_map'], renamed['candidates'], renamed['inputs']['matrices']):
        obj['F'] = obj.pop('R')
    renamed['selection']['F'] = 'F'
    alternate = root / 'RT-alternate.json'
    dump(alternate, renamed)
    invoke('make-manifest', *args, '--stage2-verdict', alternate, rc=0)
    assert json.loads(m.read_text())['candidates'] == {'F': 'superiority'}
    invoke('mechanism', m, '--out', mech, rc=2)
    invoke('judge2', *[alternate if x == v2 else x for x in judge_args], rc=0)
    assert json.loads(v.read_text())['candidates']['F']['verdict'] == 'KEEP'

    lane = logs / 'A.queue.log'
    original = lane.read_text()
    target = 'rt-FP1021-opus-1r'
    attempt = ''.join(line + '\n' for line in original.splitlines() if target in line)
    def extract(text, rc=2, other=''):
        lane.write_text(text)
        (logs / 'B.queue.log').write_text(other)
        invoke('make-manifest', *args, '--stage2-verdict', v2, rc=rc)
        return json.loads(Path(str(m) + '.audit.json').read_text())

    failed = attempt.replace('run=only', 'run=killed').replace('=0 VERDICT=PASS', '=1 VERDICT=FAIL')
    audit = extract(failed + original, rc=0)
    assert len(audit['selected']) == 32 and len(audit['ignored']) == 1
    assert m.read_bytes() == complete
    assert len(extract(original + attempt.splitlines()[1] + '\n', rc=0)['selected']) == 32
    for cross_lane in (False, True):
        duplicate = attempt.replace('run=only', 'run=second')
        audit = extract(original + ('' if cross_lane else duplicate), other=duplicate if cross_lane else '')
        assert audit['missing'] == [dict(job=target, reason='ambiguous: multiple PASS runs for the same job')]
        invoke('mechanism', m, '--out', mech, rc=2)
        invoke('judge2', *judge_args, rc=0)
        assert json.loads(v.read_text())['candidates']['R']['verdict'] == 'BLOCKED'
    for replacement in ('', attempt.replace('1021', '1025'), attempt.replace('1021', '1011')):
        audit = extract(original.replace(attempt, replacement))
        assert len(audit['missing']) == 1 and audit['missing'][0]['job'] == target
        assert len(audit['ignored']) == bool(replacement)
        invoke('mechanism', m, '--out', mech, rc=2)
        invoke('judge2', *judge_args, rc=0)
        assert json.loads(v.read_text())['candidates']['R']['verdict'] == 'BLOCKED'
    audit = extract(''.join(line + '\n' for line in original.splitlines() if 'rt-FP1021-' not in line))
    assert len(audit['missing']) == 2
    assert 'not listed' in invoke('judge2', *judge_args, rc=2).stderr
    audit = extract(original + f'EXIT_{target}=1 VERDICT=FAIL\n')
    assert audit['errors'] and len(audit['missing']) == 32 and not json.loads(m.read_text())['cells']
    extract(original, rc=0)
    assert m.read_bytes() == complete
    invoke('mechanism', m, '--out', mech, rc=2)
    # Both new hashes and reused stage-2 hashes are bound; even re-extracting
    # mechanism cannot legitimize a modified stage-2 matrix.
    for seed in (1021, 1011):
        path = Path(next(c for c in man['cells'] if c['seed'] == seed)['arms']['R'])
        saved = path.read_bytes()
        path.write_bytes(saved + b'\n')
        invoke('judge2', *judge_args, rc=0)
        assert json.loads(v.read_text())['candidates']['R']['verdict'] == 'BLOCKED'
        if seed == 1011:
            invoke('mechanism', m, '--out', mech, rc=2)
            invoke('judge2', *judge_args, rc=0)
            blocked = json.loads(v.read_text())['candidates']['R']
            assert blocked['verdict'] == 'BLOCKED' and 'not the matrix' in str(blocked)
        path.write_bytes(saved)
    print('RETEST_GUARDS_OK prior label, log fallback, retries, missing cell, duplicate attempt, wrong seed, hash mismatch')


def review_controls(kind):
    """Regression controls for the full-code review; independently runnable red probes."""
    j = load('judge2')
    if kind == 'fs-label':
        j.FS_FIELD = 'FS-test'
        cfg = dict(stage='retest', baseline='B', slot_id='slot', arm_map=None,
                   candidates={'R': 'superiority'})
        rec = dict(sha256='a'*64, setup={k: 1 for k in j.SETUP_KEYS})
        labels = [f'{f}#1003' for f in j.FIELDS] + [f'{j.FS_FIELD}#{s}' for s in j.FS_SEEDS]
        v = dict(candidates={'R': dict(verdict='PASS', rule='superiority')},
                 params=dict(slot_id='slot', baseline='B'),
                 design=dict(seeds=[1003], fs_seeds=list(j.FS_SEEDS)),
                 inputs=dict(matrices={a: {lab: rec for lab in labels} for a in ('B', 'R')}))
        assert j.prior_problems(v, cfg, 'R') == []
        v['inputs']['matrices']['R'].pop(labels[-1])
        assert j.prior_problems(v, cfg, 'R')
    elif kind == 'relative-path':
        logs = temp / 'relative-logs'
        logs.mkdir()
        out = temp / 'nested' / 'manifest.json'
        out.parent.mkdir()
        # Deliberately no local copy; paths follow the manifest-relative contract.
        (logs / 'one.queue.log').write_text(
            'NOTE_s1-FP1003-opus-1 run=x slot=opus-1 matrix=runs/matrix.json '
            + 'head=' + 'a'*12 + ' arm_tree=' + 'b'*12 + '\n'
            + 'EXIT_s1-FP1003-opus-1=0 VERDICT=PASS COLLISION=PASS ARM=PASS run=x\n')
        invoke('make-manifest', '--logs', logs, '--stage', '1', '--out', out, rc=2)
        cell = json.loads(out.read_text())['cells'][0]
        path = Path(cell['arms']['B'])
        resolved = path if path.is_absolute() else out.parent / path
        proof = cell['arm_evidence']['B']
        assert not j.arm_problems(proof, 'opus-1', {'sourceCommit': 'a'*40}, str(resolved))
        assert j.arm_problems(proof, 'opus-1', {'sourceCommit': 'a'*40}, str(temp / 'wrong.json'))
    else:
        run = temp / ('review-' + kind)
        (run / 'agents').mkdir(parents=True)
        matrix = run / 'matrix.json'
        dump(matrix, {'scenarios': [{'runDir': str(run)}]})
        summary = run / 'summary.json'
        agent = run / 'agents' / 'slot.jsonl'
        (run / 'blocks.csv').write_text(
            'blockNumber,txIndex,from,priorityFeeWei,ownerId,to\n'
            '101,0,a,10,slot,router\n101,1,b,10,other,router\n')
        def write_log(timeout_rounds=()):
            rows = []
            for r in range(99, 111):
                e = dict(agentId='slot', round=r)
                if r in timeout_rounds:
                    if kind == 'stf-rounds':
                        e = dict(agentId='slot', blockSeen=r, event='submit_failed', error='execution reverted: STF')
                    else:
                        e['reason'] = 'decide timeout: no answer within 5000ms'
                    rows.append(e)
                else:
                    e['action'] = {'type': 'noop'}
                    rows.extend([e, e])
            if kind == 'stf-rounds':
                rows.insert(0, dict(agentId='slot', reason='launch entry token'))
            agent.write_text(''.join(json.dumps(e) + '\n' for e in rows))
        mech = load('mechanism')
        dump(summary, dict(runStartBlock=100, finalBlock=110, blocksProcessed=10))
        write_log()
        assert mech.measure(matrix, 'slot', [])['slot_timeouts'] == 0
        if kind in ('timeout-rounds', 'stf-rounds'):
            failure_key = 'stf' if kind == 'stf-rounds' else 'slot_timeouts'
            for rounds in (range(102, 108), range(107, 111)):
                write_log(rounds)
                if kind == 'stf-rounds':
                    lines = agent.read_text().splitlines()
                    agent.write_text('\n'.join([x for x in lines if 'submit_failed' not in x]
                                               + [x for x in lines if 'submit_failed' in x]))
                measured = mech.measure(matrix, 'slot', [])
                assert measured[failure_key] == len(rounds)
                h = hashlib.sha256(matrix.read_bytes()).hexdigest()
                evidence = dict(measured, matrices_sha256=[h], tie_win_rate=1,
                                p99_decide_ms=None, p99_decide_ms_reason='not recorded')
                # B uses the same collector and must retain its timeout count too.
                for arm in ('R', 'B'):
                    subs = j.mechanism_clause({arm: evidence}, arm, arm, 'superiority', {arm: {h}})
                    assert subs[failure_key]['status'] == 'FAIL'
                    assert j._combine(subs) == 'FAIL', subs
                    cells = {(seed, field): {'regimes': {reg: (1.0, 1.0) for reg in j.REGIMES12}}
                             for seed in range(1003, 1007) for field in j.FIELDS}
                    verdict = j.evaluate('superiority', cells, mechanism_subs=subs, f_override=.25)
                    assert verdict['clauses']['5_mechanism']['status'] == 'FAIL'
                    assert verdict['verdict'] == 'FAIL'
                    manifest, output = run / 'manifest.json', run / 'measured.json'
                    dump(manifest, dict(candidates={'R': 'superiority'},
                         cells=[dict(seed=1003, field='FP', arms={arm: str(matrix)})]))
                    invoke('mechanism', manifest, '--out', output, rc=2)
                    collected = json.loads(output.read_text())['arms'][arm]
                    assert not collected['errors'] and collected[failure_key] == len(rounds)
                # Unattributed failures cannot supply coverage for the slot.
                complete_log = agent.read_text()
                rows = [json.loads(line) for line in complete_log.splitlines()]
                for row in rows:
                    if 'decide timeout:' in row.get('reason', '') or row.get('event') == 'submit_failed':
                        row['agentId'] = 'other'
                agent.write_text('\n'.join(map(json.dumps, rows)))
                try:
                    mech.measure(matrix, 'slot', [])
                except ValueError:
                    pass
                else:
                    raise AssertionError('other agent failure supplied slot coverage')
                agent.write_text(complete_log)
                # Removing the failure records must still expose missing coverage.
                agent.write_text('\n'.join(line for line in agent.read_text().splitlines()
                                           if 'decide timeout:' not in line and 'submit_failed' not in line))
                try:
                    mech.measure(matrix, 'slot', [])
                except ValueError:
                    pass
                else:
                    raise AssertionError('missing timeout rounds accepted as complete')
        elif kind == 'summary-bounds':
            for start, end, count in ((100, 100, 0), (101, 100, 1), (100, 110, 0), (100, 110, 9)):
                dump(summary, dict(runStartBlock=start, finalBlock=end, blocksProcessed=count))
                agent.write_text(json.dumps(dict(agentId='slot', round=start-1, action={})))
                if end == 110:
                    write_log()
                try:
                    mech.measure(matrix, 'slot', [])
                except ValueError:
                    pass
                else:
                    raise AssertionError(f'invalid summary accepted: {start}, {end}, {count}')
    print('REVIEW_CONTROL_OK ' + kind)

for control in ('fs-label', 'relative-path', 'timeout-rounds', 'stf-rounds', 'summary-bounds'):
    if which in ('all', control):
        review_controls(control)

if which in ('all', 'manifest'):
    manifest_controls()
if which in ('all', 'mechanism'):
    mechanism_controls()

if which in ('all', 'stage2', 'retest'):
    stage2_controls()
