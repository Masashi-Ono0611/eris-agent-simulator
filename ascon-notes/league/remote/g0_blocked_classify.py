#!/usr/bin/env python3
"""Diagnostic launcher only: recognize one rejected-row defect, never repair G0."""
import argparse
from collections import Counter
import csv
import hashlib
import json
import math
from pathlib import Path
import re


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError('non-finite JSON number')


def finite_float(value):
    result = float(value)
    require(math.isfinite(result), 'non-finite JSON number')
    return result


def decode(text):
    return json.loads(text, object_pairs_hook=unique_object, parse_constant=invalid_constant,
                      parse_float=finite_float)


def read_json(path):
    return decode(Path(path).read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]+', value), 'invalid ID')
    return value


def integer(value):
    return (type(value) in (int, float) and math.isfinite(value)
            and value >= 0 and int(value) == value)


def strings(value):
    require(isinstance(value, list) and all(isinstance(x, str) for x in value), 'expected string list')
    return value


def fixed_inputs(args):
    """The begin manifest already parses YAML and pins every agent's directory tree.

    Explicit candidate ID defines the remaining pinned IDs as fixed opponents;
    baseline flags are deliberately irrelevant. No YAML/node dependency here.
    """
    m = read_json(args.manifest)
    require(m['schema'] == 'ascon-round-manifest-v1', 'manifest schema')
    identifier(m['label'])
    require(m['roster']['sha256'] == digest(args.roster), 'roster changed')
    require(Path(m['roster']['path']).resolve() == args.roster.resolve(), 'roster path mismatch')
    agents = m['agents']
    require(isinstance(agents, dict) and agents, 'manifest agents')
    for aid, agent in agents.items():
        identifier(aid)
        require(isinstance(agent['directory'], str) and agent['directory'], 'unfixed agent directory')
        require(re.fullmatch(r'[0-9a-f]{64}', agent['sha256']), 'unfixed agent hash')
        require(isinstance(agent['files'], dict) and agent['files'], 'unfixed agent files')
    candidate = identifier(args.candidate)
    require(candidate in agents, 'candidate absent from roster')
    require(len(agents) > 1, 'no fixed opponents')
    return m, dict(candidate=candidate, roster=m['roster'], agents=agents,
                   fixed_opponents=sorted(set(agents) - {candidate}))


def bind(args):
    _, context = fixed_inputs(args)
    if args.context.exists():
        require(read_json(args.context) == context, 'candidate/roster/agent trees changed between chunks')
    else:
        with args.context.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(context, indent=2) + '\n')


def structured(args):
    g = read_json(args.g0)
    require(g['schema'] == 'ascon-g0-v1', 'G0 schema')
    failed, blocked = strings(g['failed']), strings(g['blocked'])
    status = 'BLOCKED' if blocked else 'FAIL' if failed else 'PASS'
    require(g['status'] == status and args.g0_rc == {'PASS': 0, 'FAIL': 1, 'BLOCKED': 2}[status],
            'G0 status/exit/reasons inconsistent')
    require(isinstance(g['runs'], list) and g['runs'], 'G0 runs missing')
    for run in g['runs']:
        f, b = strings(run['failed']), strings(run['blocked'])
        require(run['status'] == ('BLOCKED' if b else 'FAIL' if f else 'PASS'), 'world status inconsistent')
        for local, aggregate in ((f, failed), (b, blocked)):
            for reason in local:
                require(f"{run['regime']}/{run['seed']}: {reason}" in aggregate,
                        'world reason missing from aggregate')
    return g


def inspect_log(path, aid, start, end):
    rows = []
    # Read the entire file before allowing any known defect; a bad tail must stop.
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            require(line.endswith('\n'), 'incomplete JSONL line')
            row = decode(line)
            require(isinstance(row, dict), 'JSONL object required')
            rows.append(row)
    require(rows and all(row.get('agentId') == aid for row in rows), 'empty log/agent ID mismatch')
    require(not any(row.get('event') in ('log_cap_reached', 'log_line_truncated') for row in rows),
            'capped/truncated log')
    require(sum(row.get('kind') == 'mempool' and row.get('event') == 'runtime_start'
                for row in rows) == 1, 'runtime_start count')
    defects, decisions = [], set()
    for line_no, row in enumerate(rows, 1):
        reason = str(row.get('reason', ''))
        # A missing round can mask timeout evidence in G0's early-aborted reader.
        require(not reason.startswith(('decide timeout:', 'decide error:')), 'decide error/timeout')
        mem = row.get('kind') == 'mempool'
        if mem and row.get('event') == 'rejected':
            action = row.get('action')
            require(isinstance(action, dict), 'rejected without action')
            require(row.get('reason') == 'sizeDeltaUsd must be positive'
                    and action.get('type') == 'gmxDecrease'
                    and isinstance(action.get('sizeDeltaUsd'), str)
                    and re.fullmatch(r'0+', action['sizeDeltaUsd'])
                    and type(action.get('isLong')) is bool
                    and action.get('collateral') in ('USDC', 'WETH')
                    and isinstance(action.get('collateralDeltaAmount'), str)
                    and re.fullmatch(r'[0-9]+', action['collateralDeltaAmount']),
                    'unknown rejected shape/reason')
            require('round' not in row, 'rejected has round (unknown shape)')
            defects.append(dict(line=line_no, reason='rejected action missing round'))
            continue
        submission = mem and row.get('event') in ('submitted', 'submit_failed')
        if submission or 'action' in row:
            block = row.get('blockSeen') if submission else row.get('round')
            require(integer(block), f'invalid decision block at line {line_no}')
            if start < block <= end:
                decisions.add(block)
    require(decisions, 'no valid in-epoch decisions')
    require(defects, 'no known rejected-row defect')
    return defects


def classify(args):
    g = structured(args)
    require(g['status'] == 'BLOCKED' and not g['failed'], 'requires BLOCKED without FAIL')
    m, context = fixed_inputs(args)
    require(read_json(args.context) == context, 'start context changed')
    require(g.get('manifest_verified') is True, 'G0 manifest not verified')
    require(g['manifest_sha256'] == digest(args.manifest), 'G0 manifest hash mismatch')
    require(g['roster_sha256'] == context['roster']['sha256'], 'G0 roster hash mismatch')
    require(g['timing_mode'] == 'absolute only (no baseline)', 'unexpected baseline')
    expected = g['expected']
    require(Counter(strings(expected['agents'])) == Counter(context['agents'].keys()), 'G0 roster mismatch')
    for field in ('regimes', 'seeds'):
        values = strings(m[field])
        require(values and len(values) == len(set(values)), 'invalid manifest worlds')
        require(strings(expected[field]) == values, 'G0 expectations mismatch')
    worlds = {(r, s) for r in m['regimes'] for s in m['seeds']}
    runs = {(r['regime'], r['seed']): r for r in g['runs']}
    require(set(runs) == worlds and len(runs) == len(g['runs']), 'G0 world coverage mismatch')
    reasons = []
    for (regime, seed), run in runs.items():
        require(not run['failed'], 'world FAIL together with BLOCKED')
        reasons.extend(f'{regime}/{seed}: {reason}' for reason in run['blocked'])
    require(Counter(reasons) == Counter(g['blocked']), 'aggregate/world BLOCKED mismatch')
    index = args.repo / 'ascon-notes/eval/out' / m['label'] / 'index.tsv'
    require(g['index_sha256'] == digest(index), 'G0 index hash mismatch')
    with index.open(newline='', encoding='utf-8') as stream:
        reader = csv.DictReader(stream, delimiter='\t')
        require({'regime', 'seed', 'run_dir', 'exit_code'} <= set(reader.fieldnames or []), 'index header')
        rows = list(reader)
    paths = {}
    for row in rows:
        require(None not in row and row['run_dir'] and row['exit_code'] == '0', 'index row/exit')
        key = (row['regime'], row['seed'])
        require(key not in paths, 'duplicate index world')
        path = Path(row['run_dir'])
        paths[key] = (path if path.is_absolute() else args.repo / path).resolve()
    require(set(paths) == worlds and len(set(paths.values())) == len(paths), 'index worlds/paths mismatch')
    evidence = []
    # PASS worlds' raw logs are not read or silently added to the exception set.
    for key, run in runs.items():
        if run['status'] != 'BLOCKED':
            continue
        path = paths[key]
        summary = read_json(path / 'summary.json')
        require(summary['runId'] == run['run_id'], 'summary run ID mismatch')
        require(Counter(a['id'] for a in summary['agents']) == Counter(context['agents'].keys()),
                'summary roster mismatch')
        start, end = summary['runStartBlock'], summary['finalBlock']
        require(integer(start) and integer(end) and end > start, 'invalid epoch extent')
        for reason in run['blocked']:
            match = re.fullmatch(r'agent telemetry ([A-Za-z0-9_-]+)', reason)
            require(match is not None, 'non-agent telemetry BLOCKED')
            aid = match.group(1)
            require(aid != args.candidate and aid in context['fixed_opponents'], 'candidate/unknown agent')
            log = path / 'agents' / (aid + '.jsonl')
            defects = inspect_log(log, aid, start, end)
            evidence.append(dict(world='/'.join(key), agent=aid, log=str(log),
                                 log_sha256=digest(log), defects=defects))
    require(evidence, 'no approved worlds')
    return dict(approved=True, eligible_for_gate=False, g0_status='BLOCKED',
                expected_worlds=len(worlds), blocked_worlds=sum(r['status'] == 'BLOCKED' for r in runs.values()),
                evidence=evidence)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('bind', 'status', 'classify'))
    for name in ('manifest', 'roster', 'context', 'g0', 'repo', 'verdict'):
        parser.add_argument('--' + name, type=Path)
    parser.add_argument('--candidate')
    parser.add_argument('--g0-rc', type=int)
    args = parser.parse_args()
    try:
        if args.command == 'bind':
            bind(args)
            return 0
        if args.command == 'status':
            print('G0 ' + structured(args)['status'])
            return 0
        verdict = classify(args)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError) as error:
        verdict = dict(approved=False, eligible_for_gate=False, reason=str(error))
    if args.command == 'classify':
        try:
            with args.verdict.open('x', encoding='utf-8') as stream:
                stream.write(json.dumps(verdict, indent=2, allow_nan=False) + '\n')
        except (OSError, ValueError, AttributeError):
            print('STOP: cannot save classifier verdict')
            return 2
    if not verdict['approved']:
        print('STOP: telemetry classification refused: ' + verdict['reason'])
        return 2
    for item in verdict['evidence']:
        print('DEVIATION diagnostic continuation; G0=BLOCKED; '
              f"world={item['world']}; agent={item['agent']}; eligible_for_gate=false")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
