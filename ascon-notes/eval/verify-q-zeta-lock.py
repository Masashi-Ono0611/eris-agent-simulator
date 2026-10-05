"""Read-only check of the draft Q-ZETA-01 payload/dependency freeze. No run or RPC."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[2]
lock = json.loads((root/'ascon-notes/league/q-zeta-01-lock.json').read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(path):
    files = {p.relative_to(path).as_posix(): digest(p) for p in sorted(path.rglob('*')) if p.is_file()}
    return dict(files=files, sha256=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest())


assert tree(root/'example/agents/ascon-zeta-r') == lock['candidate'], 'candidate drift'
assert tree(root/'example/agents/ascon-zeta') == lock['original'], 'original modified'
for name, expected in lock['references'].items():
    assert tree(root/'example/agents'/name) == expected, f'reference drift: {name}'
actual = {name:digest(root/name) for name in lock['runtimeAndEvaluationFiles']}
assert actual == lock['runtimeAndEvaluationFiles'], 'dependency/runner/roster drift'
assert hashlib.sha256(json.dumps(actual,sort_keys=True,separators=(',',':')).encode()).hexdigest() == lock['runtimeAndEvaluationSha256']
contract = (root/'ascon-notes/league/Q-ZETA-01.md').read_text()
assert lock['candidate']['sha256'] in contract, 'contract hash mismatch'
assert lock['runtimeAndEvaluationSha256'] in contract, 'contract dependency hash mismatch'
assert '本人確認待ち' in contract
print(json.dumps(dict(status='PASS', candidateSha256=lock['candidate']['sha256'], files=len(actual),
                      note='Draft content identity only; not runtime G0, budget, or qualification approval.')))
