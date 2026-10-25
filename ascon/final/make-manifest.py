#!/usr/bin/env python3
"""Stage-1/2 queue-log manifest. Audit/missing attempts go to OUT.audit.json.
Default map shared with judge2: B=opus-1, B'=opus-1-pb; shipping R=opus-1r,
W1=opus-1g2 (defect-fixed), W2=ascon-zeta-r3k; informational X1=opus-1g
(frozen original), X2=opus-1w, X3=ascon-zeta-r3kg. X never advances or ships.
--arms accepts comma/space separated LABEL=agent-dir entries (B and B' are always included).
Stage 2 uses only B and one candidate's matrices, including FS. Its candidate is
the stage-1 verdict's F, or an explicit --arms LABEL=dir (F or F2 with a verdict).
Multiple PASS runs are ambiguous; log order never resolves them.
Matrix paths are preserved/remapped without requiring local copies (validated by the judge).
Exit 0 complete, 2 incomplete/refused (partial manifest and audit still written).
"""
import argparse
import importlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import judge2
from judge2 import DEFAULT_ARM_MAP, parse_arm_map

DEFAULT = [f"{k}={v}" for k, v in DEFAULT_ARM_MAP.items()]


def path_map(value, mappings):
    for old, new in sorted(mappings, key=lambda x: -len(x[0])):
        if value == old or value.startswith(old + '/'):
            return new + value[len(old):]
    return value


def stage2_map(items, verdict):
    mapping = parse_arm_map(items) if items is not None else None
    if verdict is not None:
        prior = json.loads(verdict.read_text())
        names, prior_map = importlib.import_module('stage2-plan').selected(prior, judge2)
        if mapping is None:
            mapping = parse_arm_map([f'{names[1]}={prior_map[names[1]]}'])
        if any(label not in names or prior_map[label] != directory
               for label, directory in mapping.items() if label != "B'"):
            raise ValueError('--arms must match a selected stage-1 candidate')
    if mapping is None:
        raise ValueError('stage 2 needs --stage1-verdict or --arms LABEL=dir')
    candidates = [label for label in mapping if label not in ('B', "B'")]
    if len(candidates) != 1 or judge2.exploratory_arm(candidates[0], mapping):
        raise ValueError('stage 2 needs exactly one non-informational candidate')
    if verdict is not None and prior['candidates'][candidates[0]]['rule'] != 'superiority':
        raise ValueError('stage 2 arm map requires a superiority candidate')
    return mapping


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--logs', required=True, type=Path)
    p.add_argument('--stage', required=True, choices=['1', '2'])
    p.add_argument('--stage1-verdict', type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--arms', nargs='+')
    p.add_argument('--path-map', action='append', default=[])
    a = p.parse_args()
    mappings = []
    for item in a.path_map:
        old, sep, new = item.partition('=')
        if not sep or not Path(old).is_absolute() or not Path(new).is_absolute():
            p.error('--path-map requires absolute mini-prefix=local-prefix')
        mappings.append((old.rstrip('/'), new.rstrip('/')))
    if a.stage == '1' and a.stage1_verdict is not None:
        p.error('--stage1-verdict belongs to stage 2')
    arm_map = (parse_arm_map(a.arms if a.arms is not None else DEFAULT) if a.stage == '1'
               else stage2_map(a.arms, a.stage1_verdict))
    arms = [directory for label, directory in arm_map.items() if a.stage == '1' or label != "B'"]
    design = ([(seed, field) for seed in range(1003, 1007) for field in ('FP', 'FD')]
              if a.stage == '1' else
              [(seed, field) for seed in range(1011, 1015) for field in ('FP', 'FD')]
              + [(seed, 'FS') for seed in judge2.FS_SEEDS])
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
            fields = 'FP|FD' if a.stage == '1' else 'FP|FD|FS'
            m = re.match(r'^(NOTE|EXIT)_(s' + a.stage + r'-(' + fields + r')(\d+)-([A-Za-z0-9_.-]+))(?:=([^ ]+))? (.*)$', line)
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
    cells, evidence = {}, {}
    for seed, field in design:
        for arm in arms:
            job = f's{a.stage}-{field}{seed}-{arm}'
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
                elif n.get('slot') != arm or not all(n.get(k) for k in ('matrix', 'head', 'arm_tree')):
                    reason = 'PASS lacks matching slot/matrix NOTE'
                else:
                    chosen = candidate
            if errors:
                reason = 'queue log parse/read errors; see audit errors'
                chosen = None
            if chosen:
                mapped = path_map(chosen['notes']['matrix'], mappings)
                cells.setdefault((seed, field), {})[labels[arm]] = mapped
                evidence.setdefault((seed, field), {})[labels[arm]] = {
                    **{k: chosen['notes'][k] for k in ('slot', 'head', 'arm_tree')},
                    **{k: chosen['exit'][k] for k in ('ARM', 'COLLISION')},
                    "matrix": str((Path(mapped) if Path(mapped).is_absolute() else
                                   a.out.resolve().parent / mapped).resolve())}
                selected.append(chosen)
            else:
                missing.append(dict(job=job, reason=reason))
            for r in attempts:
                if r is not chosen:
                    r['reason'] = reason if r in passes else 'ignored attempt: never PASS'
                    ignored.append(r)
    # Out-of-design jobs remain visible, never silently become selected cells.
    for group in jobs.values():
        for r in group.values():
            if (r['seed'], r['field']) not in design or r['arm'] not in arms:
                r['reason'] = f'ignored attempt: outside selected stage-{a.stage} design'
                ignored.append(r)
    manifest = dict(stage=a.stage, slot_id='slot', baseline='B', placebo="B'", candidates=candidates, arm_map=arm_map,
                    cells=[dict(seed=s, field=f, arms=v, arm_evidence=evidence[(s, f)]) for (s, f), v in sorted(cells.items())])
    a.out.write_text(json.dumps(manifest, indent=2) + '\n')
    audit = dict(selected=selected, ignored=ignored, missing=missing, path_maps=mappings, errors=errors)
    Path(str(a.out) + '.audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print(f'MANIFEST {"BLOCKED" if missing else "PASS"}: {len(selected)} selected, {len(missing)} missing, {len(ignored)} ignored; {a.out}.audit.json')
    return 2 if missing else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as e:
        print(f'BLOCKED: {e}', file=sys.stderr)
        sys.exit(2)
