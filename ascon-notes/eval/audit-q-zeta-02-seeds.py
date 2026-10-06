"""Read all visible worktrees' seed indices/manifests/ledgers/plans, never credentials.

Only this worktree's audit JSON is written. Metadata only; no raw results or RPC.
An unreadable source or malformed seed fails closed. Re-run before launch.
"""
from pathlib import Path
import csv
import datetime
import hashlib
import json
import os
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROPOSED = list(range(47001, 47006))
DIAGNOSTIC = [48001, 48002]
EXCLUDED_PREFIXES = [31, 35, 36, 38, 39, 40, 41, 44, 45, 46, 48]
OUTPUT = ROOT / 'ascon-notes/eval/q-zeta-02-seed-audit.json'
# Only the exact local contract package and marked local plan addendum are self reservations.
SELF_FILES = {ROOT / p for p in ['ascon-notes/league/Q-ZETA-02.md',
                                'ascon-notes/league/q-zeta-02-lock.json',
                                'ascon-notes/eval/q-zeta-02-seed-audit.json',
                                # Overnight plan: refers to the registered Q-ZETA-02 seeds themselves (planned use, written before any run).
                                'ascon-notes/league/OVERNIGHT-2026-10-06.md']}
START, END = '<!-- q-zeta-02-registration:start -->', '<!-- q-zeta-02-registration:end -->'


def seed_fields(value, location=''):
    result = []
    if isinstance(value, dict):
        for key, child in value.items():
            loc = location + '.' + key
            if key.lower() in {'seed', 'seeds', 'seedproposal', 'proposedseeds', 'reservedseeds', 'usedseeds'}:
                for seed in child if isinstance(child, list) else [child]:
                    if seed is not None:
                        result.append((int(seed), loc))
            elif isinstance(child, (dict, list)):
                result.extend(seed_fields(child, loc))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            result.extend(seed_fields(child, location + f'[{i}]'))
    return result


def main():
    raw_wt = subprocess.check_output(['git', '-C', str(ROOT), 'worktree', 'list', '--porcelain']).decode()
    roots = {Path(line[9:]).resolve() for line in raw_wt.splitlines() if line.startswith('worktree ')}
    roots.update(p.resolve() for p in ROOT.parent.iterdir() if p.is_dir())
    sources, excluded = {}, []
    def onerror(exc):
        raise exc
    for wt in sorted(roots):
        assert wt.is_dir(), f'missing worktree: {wt}'
        # Scan metadata anywhere in each worktree; prune dependencies, VCS and credential directories.
        for base, dirs, files in os.walk(wt, onerror=onerror, followlinks=False):
            dirs[:] = [d for d in dirs if d not in {'.git', 'node_modules', '.claude', '.codex', '.agents',
                       '.aws', '.ssh', '.cache', 'cache', 'artifacts', '__pycache__'} and not d.startswith('.env')]
            for name in files:
                p = Path(base) / name
                if p.is_symlink() or name.startswith('.env') or re.search(r'(secret|credential|private.?key)', name, re.I):
                    continue
                if p in SELF_FILES:
                    excluded.append(str(p)); continue
                low = name.lower()
                kind = ('index' if name == 'index.tsv' else
                        'manifest' if p.suffix == '.json' and ('manifest' in low or 'manifests' in p.parts) else
                        'ledger' if 'ledger' in low and p.suffix in {'.jsonl', '.json', '.md', '.tsv', '.csv', '.yaml', '.yml'} else
                        'plan' if p.suffix == '.md' and 'ascon-notes' in p.parts else
                        'reservation' if p.suffix in {'.json', '.yaml', '.yml'} and any(x in low for x in ['seed-audit', 'lock', 'reservation']) and 'ascon-notes' in p.parts else None)
                if kind:
                    sources[p.resolve()] = kind
    hits, records, used, diagnostic = [], [], set(), {str(s): [] for s in DIAGNOSTIC}
    for p, kind in sorted(sources.items()):
        raw = p.read_bytes(); body = raw.decode()
        rec = dict(path=str(p), kind=kind, sha256=hashlib.sha256(raw).hexdigest())
        if kind == 'index':
            reader = csv.DictReader(body.splitlines(), delimiter='\t')
            assert 'seed' in (reader.fieldnames or []), f'missing seed column: {p}'
            count = 0
            for i, row in enumerate(reader, 2):
                seed = int(row['seed']); used.add(seed); count += 1
                evidence = dict(path=str(p), line=i, seed=seed, kind='used-index')
                if seed in PROPOSED: hits.append(evidence)
                if seed in DIAGNOSTIC: diagnostic[str(seed)].append(evidence)
            rec['rows'] = count
        else:
            if p.suffix in {'.json', '.jsonl'}:
                docs = [json.loads(line) for line in body.splitlines() if line.strip()] if p.suffix == '.jsonl' else [json.loads(body)]
                fields = [x for doc in docs for x in seed_fields(doc)]
                rec['seedFields'] = [dict(seed=s, field=f) for s, f in fields]
                for seed, field in fields:
                    if seed in PROPOSED: hits.append(dict(path=str(p), field=field, seed=seed, kind=kind))
            # Text reservations cover enumerations, ranges and whole-band exclusions.
            # Include JSON/JSONL free-text reservations and seed ranges as well.
            if body:
                in_self = False
                for i, line in enumerate(body.splitlines(), 1):
                    if p == ROOT / 'ascon-notes/league/MASTER-PLAN-2026-10-04.md' and line == START:
                        in_self = True; continue
                    if in_self and line == END:
                        in_self = False; continue
                    if in_self: continue
                    numbers = {int(x) for x in re.findall(r'(?<![\w.])([1-9][0-9]{4})(?![\w.])', line)}
                    ranges = [(int(a), int(b)) for a, b in re.findall(r'(?<!\d)(\d{5})\s*[–—〜~\-]\s*(\d{5})(?!\d)', line)]
                    prefixes = {int(x) for x in re.findall(r'(?<!\d)(\d{2})[xX]{3}', line)}
                    for seed in PROPOSED:
                        if seed in numbers or any(a <= seed <= b for a, b in ranges) or seed // 1000 in prefixes:
                            hits.append(dict(path=str(p), line=i, seed=seed, kind=kind))
                assert not in_self, 'unterminated self reservation block'
        records.append(rec)
    assert not any(s // 1000 in EXCLUDED_PREFIXES for s in PROPOSED)
    diagnostics_used = all(diagnostic.values()) and not set(DIAGNOSTIC) & set(PROPOSED)
    passed = not hits and diagnostics_used
    report = dict(checkedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  scope='All locally visible registered and sibling worktrees; recursive index.tsv, manifests, ledgers, ascon-notes Markdown and seed/lock reservation JSON/YAML. Remote/private sources not accessible; re-audit before start.',
                  worktrees=[str(p) for p in sorted(roots)], proposedSeeds=PROPOSED,
                  userExcludedPrefixes=EXCLUDED_PREFIXES, usedSeeds=sorted(used),
                  diagnosticSeedsUsed=diagnostic, diagnosticsRecordedAndNotReused=bool(diagnostics_used),
                  selfReservationExclusions=sorted(excluded), sources=records, hits=hits,
                  passNoVisibleCollision=not hits, status='PASS' if passed else 'FAIL')
    OUTPUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(dict(status=report['status'], proposed=PROPOSED, sources=len(records),
                         indices=sum(r['kind'] == 'index' for r in records),
                         rows=sum(r.get('rows', 0) for r in records), hits=hits,
                         diagnosticSeedsUsed={s: len(v) for s, v in diagnostic.items()}), ensure_ascii=False))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
