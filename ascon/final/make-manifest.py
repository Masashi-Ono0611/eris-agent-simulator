#!/usr/bin/env python3
"""Stage-1 queue-log manifest. Audit/missing attempts go to OUT.audit.json.
--arms accepts comma/space separated LABEL=agent-dir entries (B and B' are always included).
Multiple PASS runs are ambiguous; log order never resolves them.
Matrix paths are preserved/remapped without requiring local copies (validated by the judge).
Exit 0 complete, 2 incomplete/refused (partial manifest and audit still written).
"""
import argparse
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from judge2 import DEFAULT_ARM_MAP, parse_arm_map

DEFAULT = [f"{k}={v}" for k, v in DEFAULT_ARM_MAP.items()]


def path_map(value, mappings):
    for old, new in sorted(mappings, key=lambda x: -len(x[0])):
        if value == old or value.startswith(old + '/'):
            return new + value[len(old):]
    return value


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--logs', required=True, type=Path)
    p.add_argument('--stage', required=True, choices=['1'])
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--arms', nargs='+', default=DEFAULT)
    p.add_argument('--path-map', action='append', default=[])
    a = p.parse_args()
    mappings = []
    for item in a.path_map:
        old, sep, new = item.partition('=')
        if not sep or not Path(old).is_absolute() or not Path(new).is_absolute():
            p.error('--path-map requires absolute mini-prefix=local-prefix')
        mappings.append((old.rstrip('/'), new.rstrip('/')))
    arm_map = parse_arm_map(a.arms)
    arms = list(arm_map.values())
    labels = {directory: label for label, directory in arm_map.items()}
    candidates = {label: 'superiority' for label in arm_map if label not in ('B', "B'")}
    jobs, errors = {}, []
    for log in sorted(a.logs.glob('*.queue.log')):
        try:
            lines = log.read_text().splitlines()
        except (OSError, UnicodeError) as e:
            errors.append(f'{log}: {e}')
            continue
        for no, line in enumerate(lines, 1):
            m = re.match(r'^(NOTE|EXIT)_(s1-(FP|FD)(\d+)-([A-Za-z0-9_.-]+))(?:=([^ ]+))? (.*)$', line)
            if not m:
                continue
            kind, job, field, seed, arm, rc, tail = m.groups()
            kv = dict(re.findall(r'(\w+)=([^\s]+)', tail))
            if 'run' not in kv:
                errors.append(f'{log}:{no}: {job}: missing run id')
                kv['run'] = f'<missing:{no}>'
            attempts = jobs.setdefault(job, {})
            key = (str(log), kv['run'])
            rec = attempts.setdefault(key, dict(job=job, log=str(log), run=kv['run'], field=field,
                                                seed=int(seed), arm=arm, notes={}, exit=None, exits=[], errors=[]))
            if kind == 'NOTE':
                for k in ('slot', 'matrix', 'head', 'arm_tree', 'lib_tree', 'dirty', 'load1'):
                    if k in kv:
                        if k in rec['notes'] and rec['notes'][k] != kv[k]:
                            rec['errors'].append(f'conflicting {k} in same run')
                        rec['notes'][k] = kv[k]
            else:
                rec['exits'].append(dict(kv, rc=rc, line=no))
                rec['exit'] = rec['exits'][-1]
    selected, ignored, missing = [], [], []
    cells = {}
    for seed in range(1003, 1007):
        for field in ('FP', 'FD'):
            for arm in arms:
                job = f's1-{field}{seed}-{arm}'
                attempts = list(jobs.get(job, {}).values())
                passes = [r for r in attempts if any(e.get('VERDICT') == 'PASS' for e in r['exits'])]
                chosen = None
                reason = 'missing or never PASS'
                if len(passes) > 1:
                    reason = 'ambiguous: multiple PASS runs for the same job'
                elif passes:
                    candidate = passes[0]
                    # Line numbers are provenance, not part of the EXIT result.
                    results = {json.dumps({k: v for k, v in e.items() if k != 'line'}, sort_keys=True)
                               for e in candidate['exits']}
                    e, n = candidate['exit'], candidate['notes']
                    if len(results) > 1:
                        reason = 'ambiguous: conflicting EXIT lines in a PASS run'
                    elif candidate['errors']:
                        reason = '; '.join(candidate['errors'])
                    elif e.get('rc') != '0' or any(e.get(k) != 'PASS' for k in ('COLLISION', 'ARM')):
                        reason = 'VERDICT=PASS failed collision/arm validity'
                    elif n.get('slot') != arm or not n.get('matrix'):
                        reason = 'PASS lacks matching slot/matrix NOTE'
                    else:
                        chosen = candidate
                if errors:
                    reason = 'queue log parse/read errors; see audit errors'
                    chosen = None
                if chosen:
                    mapped = path_map(chosen['notes']['matrix'], mappings)
                    cells.setdefault((seed, field), {})[labels[arm]] = mapped
                    selected.append(chosen)
                else:
                    missing.append(dict(job=job, reason=reason))
                for r in attempts:
                    if r is not chosen:
                        r['reason'] = reason if r in passes else 'ignored attempt: never PASS'
                        ignored.append(r)
    # Out-of-design jobs remain visible, never silently become stage-1 cells.
    for group in jobs.values():
        for r in group.values():
            if r['seed'] not in range(1003, 1007) or r['arm'] not in arms:
                r['reason'] = 'ignored attempt: outside selected stage-1 design'
                ignored.append(r)
    manifest = dict(stage='1', slot_id='slot', baseline='B', placebo="B'", candidates=candidates, arm_map=arm_map,
                    cells=[dict(seed=s, field=f, arms=v) for (s, f), v in sorted(cells.items())])
    a.out.write_text(json.dumps(manifest, indent=2) + '\n')
    audit = dict(selected=selected, ignored=ignored, missing=missing, path_maps=mappings, errors=errors)
    Path(str(a.out) + '.audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print(f'MANIFEST {"BLOCKED" if missing else "PASS"}: {len(selected)} selected, {len(missing)} missing, {len(ignored)} ignored; {a.out}.audit.json')
    return 2 if missing else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError) as e:
        print(f'BLOCKED: {e}', file=sys.stderr)
        sys.exit(2)
