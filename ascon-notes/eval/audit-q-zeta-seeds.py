"""Read only index seed columns and planning/ledger text; no run results or credentials.

Writes a proposal audit in this worktree; does not reserve seeds in other worktrees.
"""
from pathlib import Path
import csv
import datetime
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PROPOSED = list(range(46001, 46006))
USER_EXCLUDED_PREFIXES = [31, 35, 36, 38, 39, 40, 41, 44, 45]
indices, plans, manifests = set(), set(), set()
for wt in sorted(ROOT.parent.iterdir()):
    if not wt.is_dir():
        continue
    for rel in ['runs', 'ascon-notes/eval/out']:
        d = wt/rel
        if not d.exists():
            continue
        r = subprocess.run(['rg','--files','--hidden','--no-ignore','-g','index.tsv',str(d)], capture_output=True,text=True)
        assert r.returncode in [0,1], r.stderr
        indices.update(Path(p) for p in r.stdout.splitlines())
    for rel in ['ascon-notes/league', 'ascon-notes/eval']:
        d = wt/rel
        if not d.exists():
            continue
        # Plan and ledger sources only. No raw result payloads, key files, or env files.
        plans.update(d.glob('*.md'))
        if (d/'ledger.jsonl').exists():
            plans.add(d/'ledger.jsonl')
        manifests.update((d/'manifests').glob('*.json'))

hits, seen, index_records, plan_records, reservation_lines, manifest_records = [], set(), [], [], [], []
for p in sorted(indices):
    raw = p.read_bytes()
    reader = csv.DictReader(raw.decode().splitlines(),delimiter='\t')
    assert 'seed' in (reader.fieldnames or []), p
    count = 0
    for i,row in enumerate(reader,2):
        count += 1
        seed = int(row['seed']);seen.add(seed)
        if seed in PROPOSED:
            hits.append(dict(path=str(p),line=i,seed=seed,kind='used-index'))
    index_records.append(dict(path=str(p),sha256=hashlib.sha256(raw).hexdigest(),rows=count))

for p in sorted(manifests):
    raw = p.read_bytes();data=json.loads(raw)
    seeds = [int(x) for x in data.get('seeds', [])]
    manifest_records.append(dict(path=str(p),sha256=hashlib.sha256(raw).hexdigest(),seeds=seeds))
    for seed in set(seeds) & set(PROPOSED):
        hits.append(dict(path=str(p),seed=seed,kind='manifest-reservation'))

for p in sorted(plans):
    if p.name in ['Q-ZETA-01.md', 'INC-ZETA-DIAGNOSIS-2026-10-05.md', 'INC-ZETA-ORIGIN-2026-10-05.md']:
        continue # proposal itself is not evidence of prior use/reservation
    raw = p.read_bytes();body=raw.decode()
    plan_records.append(dict(path=str(p),sha256=hashlib.sha256(raw).hexdigest()))
    for i,line in enumerate(body.splitlines(),1):
        # Enumerations, explicit ranges, and prefix reservations (e.g. 46xxx).
        numbers = {int(x) for x in re.findall(r'(?<![\w.])([1-9][0-9]{4})(?![\w.])',line)}
        ranges = [(int(a),int(b)) for a,b in re.findall(r'(?<!\d)(\d{5})\s*[–—〜~\-]\s*(\d{5})(?!\d)',line)]
        prefixes = {int(x) for x in re.findall(r'(?<!\d)(\d{2})[xX]{3}',line)}
        for seed in PROPOSED:
            if seed in numbers or any(a<=seed<=b for a,b in ranges) or seed//1000 in prefixes:
                hits.append(dict(path=str(p),line=i,seed=seed,kind='planning-mention',text=line[:700]))
        if re.search(r'seed|予約|シード',line,re.I) and (numbers or ranges or prefixes):
            reservation_lines.append(dict(path=str(p),line=i,text=line[:1200]))

assert not any(s//1000 in USER_EXCLUDED_PREFIXES for s in PROPOSED)
report=dict(checkedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            scope='All visible sibling worktrees: runs/**/index.tsv, eval/out/**/index.tsv; league/eval manifests seeds, top-level Markdown and ledger.jsonl. No run-result opening for proposed seeds. External/private reservations cannot be proven absent; re-audit before launch.',
            proposedSeeds=PROPOSED,userExcludedPrefixes=USER_EXCLUDED_PREFIXES,usedSeeds=sorted(seen),
            indices=index_records,manifests=manifest_records,plans=plan_records,reservationEvidence=reservation_lines,hits=hits,
            passNoVisibleCollision=not hits)
(ROOT/'ascon-notes/eval/q-zeta-01-seed-audit.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(dict(proposed=PROPOSED,indices=len(index_records),manifests=len(manifest_records),rows=sum(x['rows'] for x in index_records),
                     plans=len(plan_records),hits=hits,usedSeeds=sorted(seen)),ensure_ascii=False))
