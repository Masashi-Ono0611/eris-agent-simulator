#!/usr/bin/env python3
"""Read-only offline preflight. PASS here is NOT permission or G3 certification.
No dotenv/auth access, RPC, simulation or automatic repair. JSON on stdout only.
"""
import argparse
import csv
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CANDIDATE = 'example/agents/ascon-zeta-r2'
EXPECTED = '153becef74bebb21acf8674191407ee941b2844a4cb4fa25716b111390eade59'
SEEDS = [49001, 49002, 49003, 49101, 49102, 49103]
SCOPES = ['example/agents/runtime', 'example/agents/lib', 'sdk']
PRUNE = {'.git', 'node_modules', '.claude', '.codex', '.agents', '.aws', '.ssh',
         '.cache', 'cache', 'artifacts', '__pycache__'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def aggregate(files):
    # Byte-for-byte algorithm of verify-q-zeta-02-lock.py aggregate()/tree().
    return digest(json.dumps(files, sort_keys=True, separators=(',', ':')).encode())


def safe(path):
    return not any(p.startswith('.env') or re.search(r'secret|credential|private.?key', p, re.I)
                   or Path(p).suffix.lower() in {'.pem', '.key', '.p12'} for p in Path(path).parts)


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)


def tree(ref, prefix, root=ROOT):
    files = {}
    for name in git(root, 'ls-tree', '-r', '--name-only', ref, '--', prefix).decode().splitlines():
        if not safe(name):
            raise ValueError('sensitive path rejected')
        files[name[len(prefix) + 1:]] = digest(git(root, 'show', f'{ref}:{name}'))
    if not files:
        raise ValueError('empty committed tree')
    return dict(files=files, sha256=aggregate(files))


def local_tree(path):
    if not path.is_dir() or path.is_symlink():
        raise ValueError('missing/symlink tree')
    files = {}
    for p in sorted(path.rglob('*')):
        if not safe(p) or p.is_symlink():
            raise ValueError('sensitive/symlink path rejected')
        if p.is_file():
            files[p.relative_to(path).as_posix()] = digest(p.read_bytes())
    if not files:
        raise ValueError('empty local tree')
    return dict(files=files, sha256=aggregate(files))


def candidate_check(root=ROOT):
    committed, local = tree('HEAD', CANDIDATE, root), local_tree(root / CANDIDATE)
    return {'pass': committed == local and local['sha256'] == EXPECTED,
            'sha256': local['sha256'], 'expected': EXPECTED}


def tracked_check(root=ROOT):
    status = git(root, 'status', '--porcelain=v1', '--untracked-files=no').decode()
    return {'pass': not status, 'statusLines': status.splitlines()}


def visible_roots(root=ROOT):
    text = git(root, 'worktree', 'list', '--porcelain').decode()
    roots = {Path(s[9:]).resolve() for s in text.splitlines() if s.startswith('worktree ')}
    roots.update(p.resolve() for p in root.parent.iterdir() if p.is_dir())
    return sorted(roots)


def seed_fields(value):
    result = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in {'seed', 'seeds', 'seedproposal', 'proposedseeds', 'reservedseeds', 'usedseeds'}:
                for seed in child if isinstance(child, list) else [child]:
                    if seed is not None:
                        if isinstance(seed, bool) or not re.fullmatch(r'\d+', str(seed)):
                            raise ValueError('malformed seed field')
                        result.append(int(seed))
            elif isinstance(child, (dict, list)):
                result.extend(seed_fields(child))
    elif isinstance(value, list):
        for child in value:
            result.extend(seed_fields(child))
    return result


def audit_seeds(roots, self_files=None):
    """Audit metadata across visible roots; only hash-bound *local* self plans exempt.
    Errors fail closed. No scores are read for seed selection. Text, range and band hits
    are conservative reservations, even when a document calls a seed unused.
    """
    self_files = self_files or {}
    sources, hits, errors, excluded = {}, [], [], []
    for root in roots:
        if not root.is_dir():
            errors.append('missing root: ' + str(root)); continue
        def onerror(err):
            errors.append(str(err))
        for base, dirs, files in os.walk(root, followlinks=False, onerror=onerror):
            dirs[:] = [d for d in dirs if d not in PRUNE and safe(d) and not (Path(base)/d).is_symlink()]
            for name in files:
                p = Path(base) / name
                if not safe(p) or p.is_symlink():
                    continue
                low = name.lower()
                kind = ('index' if name == 'index.tsv' else
                        'manifest' if p.suffix == '.json' and ('manifest' in low or 'manifests' in p.parts) else
                        'ledger' if 'ledger' in low and p.suffix in {'.jsonl','.json','.md','.tsv','.csv','.yaml','.yml'} else
                        'reservation' if p.suffix == '.json' and any(x in low for x in ['seed-audit','lock','reservation']) else
                        'plan' if 'ascon-notes' in p.parts and p.suffix in {'.md','.yaml','.yml','.tsv'} else None)
                if kind:
                    sources[p.resolve()] = kind
    records = []
    for p, kind in sorted(sources.items()):
        try:
            raw = p.read_bytes(); sha = digest(raw)
            if str(p) in self_files:
                if sha != self_files[str(p)]:
                    raise ValueError('self reservation hash drift')
                excluded.append(str(p)); continue
            body = raw.decode('utf-8')
            rec = {'path': str(p), 'kind': kind, 'sha256': sha}
            if kind == 'index':
                rows = csv.DictReader(body.splitlines(), delimiter='\t')
                if 'seed' not in (rows.fieldnames or []):
                    raise ValueError('missing seed column')
                count = 0
                for n, row in enumerate(rows, 2):
                    seed = int(row['seed']); count += 1
                    if seed in SEEDS:
                        hits.append({'path':str(p),'line':n,'seed':seed,'kind':'used-index'})
                rec['rows'] = count
            else:
                if p.suffix in {'.json','.jsonl'}:
                    docs = [json.loads(x) for x in body.splitlines() if x.strip()] if p.suffix == '.jsonl' else [json.loads(body)]
                    for doc in docs:
                        for seed in seed_fields(doc):
                            if seed in SEEDS:
                                hits.append({'path':str(p),'seed':seed,'kind':kind})
                for n, line in enumerate(body.splitlines(), 1):
                    numbers = {int(x) for x in re.findall(r'(?<![\w.])([1-9]\d{4})(?![\w.])',line)}
                    ranges = [(int(a),int(b)) for a,b in re.findall(r'(?<!\d)(\d{5})\s*[–—〜~\-]\s*(\d{5})(?!\d)',line)]
                    bands = {int(x) for x in re.findall(r'(?<!\d)(\d{2})[xX]{3}',line)}
                    for seed in SEEDS:
                        if seed in numbers or any(a<=seed<=b for a,b in ranges) or seed//1000 in bands:
                            hits.append({'path':str(p),'line':n,'seed':seed,'kind':kind})
            records.append(rec)
        except (OSError, UnicodeError, ValueError, TypeError, KeyError) as exc:
            errors.append(str(p) + ': ' + str(exc))
    return {'pass': not hits and not errors, 'proposedSeeds':SEEDS,
            'roots':list(map(str,roots)), 'sources':records,'hits':hits,'errors':errors,
            'selfReservationExclusions':excluded,
            'sourceSetSha256':aggregate({r['path']:r['sha256'] for r in records}),
            'unverified':'Unrecorded runs, other devices, remote and private metadata. Re-run immediately before start.'}


def check_inputs(root, lock):
    mismatches = []
    for name, expected in lock['inputs'].items():
        p = root / name
        if not safe(p) or p.is_symlink() or not p.is_file() or digest(p.read_bytes()) != expected:
            mismatches.append(name)
    agents = {}
    for name, expected in lock['agentTrees'].items():
        try: agents[name] = local_tree(root/'example/agents'/name) == expected
        except (ValueError, OSError): agents[name] = False
    return {'pass':not mismatches and all(agents.values()),'hashMismatches':mismatches,'agentTrees':agents}


def upstream_check(root=ROOT):
    mismatches=[]
    for scope in SCOPES:
        if tree('upstream/main',scope,root) != local_tree(root/scope):
            mismatches.append(scope)
    return {'pass':not mismatches,'mismatches':mismatches,
            'ref':git(root,'rev-parse','upstream/main').decode().strip(),
            'note':'Local upstream/main reference only; no fetch.'}


def no_anvil():
    p = subprocess.run(['pgrep','-x','anvil'],capture_output=True,text=True)
    return {'pass':p.returncode==1 and not p.stderr.strip(),'returncode':p.returncode,
            'pids':p.stdout.splitlines(),'error':p.stderr.strip()}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    lock=json.loads((HERE/'inputs.lock.json').read_text())
    checks={}
    def check(name, fn):
        try: checks[name]=fn()
        except Exception as e: checks[name]={'pass':False,'error':type(e).__name__+': '+str(e)}
    check('candidate',candidate_check)
    check('inputs',lambda:check_inputs(ROOT,lock))
    check('trackedTree',tracked_check)
    check('upstreamByteEquality',upstream_check)
    check('upstreamRefPinned',lambda:{'pass':git(ROOT,'rev-parse','upstream/main').decode().strip()==lock['localUpstreamRef']})
    check('seedAudit',lambda:audit_seeds(visible_roots(), {str(ROOT/p):h for p,h in lock['selfReservations'].items()}))
    check('disk',lambda:{'pass':shutil.disk_usage(ROOT).free>=25*1024**3,'freeBytes':shutil.disk_usage(ROOT).free,'minimumBytes':25*1024**3})
    check('noAnvil',no_anvil)
    check('parentFrozenUnset',lambda:{'pass':'ERIS_AGENT_FROZEN' not in os.environ,'note':'ON omits flag, so parent must unset it for BOTH paired launches.'})
    check('unitTimingOverrideAbsent',lambda:{'pass':'G3_UNIT_TIME_SCALE' not in os.environ})
    checks['completeness']={'pass':not lock['blocked'],'blocked':lock['blocked']}
    passed=all(v['pass'] for v in checks.values())
    print(json.dumps({'status':'PASS' if passed else 'FAIL','checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks},indent=2))
    return 0 if passed else 1

if __name__=='__main__':
    raise SystemExit(main())
