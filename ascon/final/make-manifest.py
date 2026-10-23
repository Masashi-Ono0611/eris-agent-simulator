#!/usr/bin/env python3
"""Stage-1 queue-log manifest. Audit/missing attempts go to OUT.audit.json.
--arms accepts comma/space separated directory names (B and B' are always included).
No log mtime or lexical run-id ordering is trusted across lanes: ambiguous jobs are missing.
Exit 0 complete, 2 incomplete/refused (partial manifest and audit still written).
"""
import argparse
import json
from pathlib import Path
import re
import sys

DEFAULT = ['opus-1', 'opus-1-pb', 'opus-1a', 'opus-1r', 'opus-1g']
LABEL = {'opus-1': 'B', 'opus-1-pb': "B'", 'opus-1a': 'C1', 'opus-1r': 'R', 'opus-1g': 'W'}


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
    arms = list(dict.fromkeys(['opus-1', 'opus-1-pb'] + [x for s in a.arms for x in s.split(',')]))
    if any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', x) for x in arms):
        p.error('invalid arm directory')
    labels = {x: LABEL.get(x, x) for x in arms}
    candidates = {labels[x]: 'noninferiority' if x == 'opus-1a' else 'superiority'
                  for x in arms if x not in ('opus-1', 'opus-1-pb')}
    if not candidates or sum(v == 'superiority' for v in candidates.values()) > 2:
        p.error('frozen judge accepts at most two superiority candidates; select a comparison with --arms')
    if len(set(labels.values())) != len(labels):
        p.error("arm labels collide with reserved B, placebo, C1, R, W labels")
    jobs = {}
    for log in sorted(a.logs.glob('*.queue.log')):
        for no, line in enumerate(log.read_text().splitlines(), 1):
            m = re.match(r'^(NOTE|EXIT)_(s1-(FP|FD)(\d+)-([A-Za-z0-9_.-]+))(?:=([^ ]+))? (.*)$', line)
            if not m:
                continue
            kind, job, field, seed, arm, rc, tail = m.groups()
            if arm not in arms:
                continue
            kv = dict(re.findall(r'(\w+)=([^\s]+)', tail))
            if 'run' not in kv:
                raise ValueError(f'{log}:{no}: missing run id')
            attempts = jobs.setdefault(job, {})
            key = (str(log), kv['run'])
            rec = attempts.setdefault(key, dict(job=job, log=str(log), run=kv['run'], field=field,
                                                seed=int(seed), arm=arm, notes={}, exit=None))
            if kind == 'NOTE':
                for k in ('slot', 'matrix', 'head', 'arm_tree', 'lib_tree', 'dirty', 'load1'):
                    if k in kv:
                        if k in rec['notes'] and rec['notes'][k] != kv[k]:
                            raise ValueError(f'{job}: conflicting {k} in same run')
                        rec['notes'][k] = kv[k]
            else:
                if rec['exit'] is not None:
                    raise ValueError(f'{job}: duplicate EXIT for run {kv["run"]}')
                rec['exit'] = dict(kv, rc=rc, line=no)
    selected, ignored, missing = [], [], []
    cells = {}
    for seed in range(1003, 1007):
        for field in ('FP', 'FD'):
            for arm in arms:
                job = f's1-{field}{seed}-{arm}'
                attempts = list(jobs.get(job, {}).values())
                passes = [r for r in attempts if r['exit'] and r['exit'].get('VERDICT') == 'PASS']
                chosen = None
                reason = 'missing or never PASS'
                if passes:
                    if len({r['log'] for r in passes}) > 1:
                        reason = 'PASS attempts across lanes have no provable order'
                    else:
                        chosen = max(passes, key=lambda r: r['exit']['line'])
                        e, n = chosen['exit'], chosen['notes']
                        if e.get('rc') != '0' or any(e.get(k) != 'PASS' for k in ('COLLISION', 'ARM')):
                            reason = 'last VERDICT=PASS failed collision/arm validity'
                            chosen = None
                        elif n.get('slot') != arm or not n.get('matrix'):
                            reason = 'last PASS lacks matching slot/matrix NOTE'
                            chosen = None
                if chosen:
                    mapped = path_map(chosen['notes']['matrix'], mappings)
                    if not Path(mapped).is_file():
                        reason = 'selected matrix not available locally'
                        chosen = None
                if chosen:
                    cells.setdefault((seed, field), {})[labels[arm]] = str(Path(mapped).resolve())
                    selected.append(chosen)
                else:
                    missing.append(dict(job=job, reason=reason))
                ignored.extend(r for r in attempts if r is not chosen)
    # Out-of-design jobs remain visible, never silently become stage-1 cells.
    ignored.extend(r for group in jobs.values() for r in group.values() if r['seed'] not in range(1003, 1007))
    manifest = dict(stage='1', slot_id='slot', baseline='B', placebo="B'", candidates=candidates,
                    cells=[dict(seed=s, field=f, arms=v) for (s, f), v in sorted(cells.items())])
    a.out.write_text(json.dumps(manifest, indent=2) + '\n')
    audit = dict(selected=selected, ignored=ignored, missing=missing, path_maps=mappings)
    Path(str(a.out) + '.audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print(f'MANIFEST {"BLOCKED" if missing else "PASS"}: {len(selected)} selected, {len(missing)} missing, {len(ignored)} ignored; {a.out}.audit.json')
    return 2 if missing else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError) as e:
        print(f'BLOCKED: {e}', file=sys.stderr)
        sys.exit(2)
