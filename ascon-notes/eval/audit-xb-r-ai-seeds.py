"""Read seed columns only; no run results, secrets, runtime launch, or sibling writes."""
from pathlib import Path
import csv
import datetime
import json
import subprocess

root = Path(__file__).resolve().parents[2]
worktrees = [p for p in root.parent.iterdir() if p.is_dir()]
main = root.parents[2]
if (main / '.git').exists():
    worktrees.append(main)
paths = set()
for worktree in sorted(set(worktrees)):
    for rel in ['runs', 'ascon-notes/eval/out']:
        directory = worktree / rel
        if not directory.exists():
            continue
        result = subprocess.run(['rg', '--files', '--hidden', '--no-ignore', '-g', 'index.tsv', str(directory)],
                                capture_output=True, text=True, check=False)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr)
        paths.update(Path(p) for p in result.stdout.splitlines())
candidates = {str(seed): [] for seed in [36001, 36002, 37001, 37002, 38001, 38002, 39001, 39002, 39101, 39102, 39103]}
ledgers = []
for path in sorted(paths):
    count = 0
    with path.open() as stream:
        reader = csv.DictReader(stream, delimiter='\t')
        if 'seed' not in (reader.fieldnames or []):
            raise ValueError(f'missing seed column: {path}')
        for row in reader:
            count += 1
            seed = row['seed']
            if seed in candidates:
                candidates[seed].append({'index': str(path), 'row': count + 1})
    ledgers.append({'path': str(path), 'rows': count})
report = {'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'scope': 'Visible sibling worktrees and main checkout, runs/**/index.tsv and ascon-notes/eval/out/**/index.tsv; seed column only. Active ledgers may grow; absence is not a global reservation.',
          'ledgerCount': len(ledgers), 'rowCount': sum(p['rows'] for p in ledgers),
          'candidates': candidates, 'ledgers': ledgers}
(root / 'ascon-notes/eval/xb-r-ai-seed-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'ledgers': report['ledgerCount'], 'rows': report['rowCount'],
                  'seedOccurrences': {s: len(rows) for s, rows in candidates.items()}}, indent=2))
