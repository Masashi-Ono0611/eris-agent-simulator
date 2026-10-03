"""Append-only pre-run provenance. Verification reads current files; never rewrites history."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
from league_harness import ROOT, identifier, roster_agents, agent_path, tree_hash
from g0_contract import THRESHOLDS

MANIFESTS = Path(__file__).with_name('manifests')


def git_sha():
    return subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()


def manifest_path(label):
    return MANIFESTS / (identifier(label)+'.json')


def snapshot(roster, agent_root, zip_path=None):
    roster, agent_root = Path(roster).resolve(), Path(agent_root).resolve()
    agents = {}
    for a in roster_agents(roster):
        if a['command']: raise ValueError('command agent cannot be directory-hashed')
        path = agent_path(agent_root,a['dir'])
        version = tree_hash(path)
        if 'prompt.md' not in version['files']: raise ValueError('missing prompt.md: '+a['id'])
        agents[a['id']] = dict(directory=str(path), **version)
    result = dict(commit=git_sha(),roster=dict(path=str(roster),sha256=hashlib.sha256(roster.read_bytes()).hexdigest()),
                  agent_root=str(agent_root),agents=agents)
    if zip_path:
        path=Path(zip_path).resolve()
        result.update(zip_path=str(path),zip_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    return result


def begin(label, roster, regimes, seeds, parallel, agent_root=None, zip_path=None):
    from g0 import tokens
    if parallel < 1: raise ValueError('parallel must be positive')
    path=manifest_path(label)
    if path.exists(): raise FileExistsError('manifest already exists: '+label)
    if (ROOT/'ascon-notes/eval/out'/label).exists():
        raise ValueError('round output already exists; begin must precede the run')
    data=dict(schema='ascon-round-manifest-v1',label=label,started_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              regimes=tokens(regimes),seeds=tokens(seeds),parallel=parallel,thresholds=THRESHOLDS,
              **snapshot(roster,agent_root or ROOT/'example/agents',zip_path))
    MANIFESTS.mkdir(parents=True,exist_ok=True)
    with path.open('x',encoding='utf-8') as f:
        json.dump(data,f,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)
        f.write('\n'); f.flush(); os.fsync(f.fileno())
    return data


def verify(label):
    data=json.loads(manifest_path(label).read_text())
    failed=[]
    try:
        if data.get('schema') != 'ascon-round-manifest-v1' or data.get('label') != label: raise ValueError('schema/label')
        current=snapshot(data['roster']['path'],data['agent_root'],data.get('zip_path'))
        for key,value in current.items():
            if data.get(key)!=value: failed.append('manifest mismatch: '+key)
        if data['thresholds'] != THRESHOLDS: failed.append('manifest threshold mismatch')
    except (OSError,ValueError,KeyError,TypeError,subprocess.CalledProcessError): failed.append('manifest source missing/malformed')
    return dict(status='FAIL' if failed else 'PASS',failed=failed,manifest=data,
                verified_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
