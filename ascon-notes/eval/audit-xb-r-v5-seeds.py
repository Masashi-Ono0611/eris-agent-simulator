from pathlib import Path
import subprocess,csv,json,hashlib
root=Path(__file__).resolve().parents[2]; worktrees=root.parent
paths=[]
# Inventory only run/index ledgers; never open environment or key material.
for w in sorted(worktrees.iterdir()):
 if not w.is_dir():continue
 for rel in ['runs','ascon-notes/eval/out']:
  d=w/rel
  if not d.exists():continue
  result=subprocess.run(['rg','--files','--hidden','--no-ignore','-g','index.tsv',str(d)],capture_output=True,text=True)
  if result.returncode not in [0,1]:raise RuntimeError(result.stderr)
  paths.extend(Path(p) for p in result.stdout.splitlines())
seen={}; ledgers=[]
for p in sorted(set(paths)):
 raw=p.read_bytes();reader=csv.DictReader(raw.decode().splitlines(),delimiter='\t');rows=list(reader)
 if 'seed' not in (reader.fieldnames or []):raise ValueError(f'no seed column: {p}')
 for r in rows:seen.setdefault(r['seed'],[]).append({'index':str(p),'regime':r.get('regime'),'run_dir':r.get('run_dir')})
 ledgers.append({'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'rows':len(rows)})
out={'scope':'All visible sibling worktrees: runs/**/index.tsv and ascon-notes/eval/out/**/index.tsv; exact seed column, not filename/text search.', 'ledgerCount':len(ledgers),'rowCount':sum(x['rows'] for x in ledgers),'ledgers':ledgers,'candidates':{s:seen.get(s,[]) for s in ['36001','36002','36003','37001','37002','37003','37004']},'usedSeeds':sorted(seen,key=int)}
(root/'ascon-notes/eval/dev4-v5-seed-audit.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'ledgerCount':out['ledgerCount'],'rowCount':out['rowCount'],'seedOccurrences':{k:len(v) for k,v in out['candidates'].items()}},indent=2))
