#!/usr/bin/env python3
"""Offline player checks. Recursive static scan is conservative, not a sandbox proof."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

FORBIDDEN = re.compile(r'anvil_|evm_|eth_sendTransaction|txpool_|eth_subscribe|debug_')
IMPORT = re.compile(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)(["'`])([^"'`]+)\1''')
DYNAMIC = re.compile(r'''\b(?:import|require)\s*\(\s*(?![\s"'`])\S''')
SOURCE_SUFFIXES = ('.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs')


def tests_passed(returncode, stdout):
    """Require Node's executed-test summary, not just a successful process."""
    passed = re.findall(r'^(?:#|ℹ)\s+pass\s+(\d+)\s*$', stdout, re.M)
    failed = re.findall(r'^(?:#|ℹ)\s+fail\s+(\d+)\s*$', stdout, re.M)
    return (returncode == 0 and bool(passed) and all(int(n) > 0 for n in passed)
            and bool(failed) and all(int(n) == 0 for n in failed))


def dependency_files(target):
    """Resolve local JS/TS spellings, including TS sources imported as .js."""
    candidates = [target]
    replacements = {'.js': ('.ts', '.tsx'), '.mjs': ('.mts',), '.cjs': ('.cts',)}
    candidates.extend(target.with_suffix(suffix) for suffix in replacements.get(target.suffix, ()))
    if not target.suffix:
        candidates.extend(Path(str(target) + suffix) for suffix in SOURCE_SUFFIXES)
    candidates.extend(target / ('index' + suffix) for suffix in SOURCE_SUFFIXES)
    return [file for file in candidates if file.is_file() or file.is_symlink()]


def scan(path):
    path = path.resolve()
    errors=[]
    roots=[path,path.parent/'lib',path.parent/'runtime']
    pending = sorted(path.rglob('*'), reverse=True)
    seen = set()
    def label(file):
        return str(file.relative_to(path)) if file.is_relative_to(path) else '../' + str(file.relative_to(path.parent))
    while pending:
        file = pending.pop()
        # Check ancestors too: an imported directory can itself be a symlink.
        if any(p.is_symlink() for p in (file, *file.parents) if p.is_relative_to(path.parent)):
            errors.append('symlink: '+label(file)); continue
        file = file.resolve()
        if file in seen: continue
        seen.add(file)
        if not file.is_file() or file.suffix not in SOURCE_SUFFIXES: continue
        text=file.read_text()
        if FORBIDDEN.search(text): errors.append('forbidden RPC: '+label(file))
        if DYNAMIC.search(text): errors.append('unresolved dynamic import: '+label(file))
        for call in re.finditer(r'\b(?:import|require)\s*\(([^)]*)\)', text):
            if not re.fullmatch(r'''\s*(["'`])[^"'`]*\1\s*''', call.group(1)):
                errors.append('nonliteral dynamic import: '+label(file))
        for m in IMPORT.finditer(text):
            target=m.group(2)
            if '${' in target: errors.append('unresolved template import: '+target); continue
            if not target.startswith('.'): continue
            resolved=(file.parent/target).resolve()
            if not any(resolved.is_relative_to(root) for root in roots):
                errors.append('cross-agent import: '+label(file)+': '+target); continue
            dependencies = dependency_files(file.parent/target)
            if not dependencies:
                errors.append('unresolved local import: '+label(file)+': '+target)
            for dependency in dependencies:
                if not any(dependency.resolve().is_relative_to(root) for root in roots):
                    errors.append('cross-agent import: '+label(file)+': '+target)
                else:
                    pending.append(dependency)
    return errors


def main():
    p=argparse.ArgumentParser(); p.add_argument('id'); p.add_argument('--json',action='store_true'); a=p.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*',a.id): p.error('bad id')
    scaffold=Path(__file__).resolve().parents[2]; wt=scaffold.parent/('league-'+a.id)
    agent=wt/'example/agents'/a.id; checks={}
    def command(name,cmd):
        try:
            r=subprocess.run(cmd,cwd=wt,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            passed = tests_passed(r.returncode, r.stdout) if name == 'tests' else r.returncode == 0
            checks[name]=dict(status='PASS' if passed else 'FAIL',exit_code=r.returncode)
        except OSError: checks[name]=dict(status='BLOCKED',exit_code=None)
    if not agent.is_dir(): checks['agent']=dict(status='BLOCKED',exit_code=None)
    else:
        command('typecheck',['npm','run','typecheck'])
        sources = [str(f) for f in sorted(agent.rglob('*.ts')) if f.is_file() and not f.is_symlink()]
        if sources: command('check:strategy',['npm','run','check:strategy','--',*sources])
        else: checks['check:strategy']=dict(status='BLOCKED',exit_code=None)
        test=wt/'test'/(a.id+'.test.ts')
        if test.is_file(): command('tests',['node','--import','tsx','--test',str(test)])
        else: checks['tests']=dict(status='BLOCKED',exit_code=None)
        with tempfile.TemporaryDirectory(prefix='ascon-player-') as stage:
            try:
                shutil.copyfile(agent/'prompt.md',Path(stage)/(a.id+'.md'))
                command('prompt',['node','--import','tsx',str(scaffold/'ascon-notes/release/check-prompts.ts'),stage])
            except OSError: checks['prompt']=dict(status='BLOCKED',exit_code=None)
        try:
            errors=scan(agent)
            checks['recursive_scan']=dict(status='FAIL' if errors else 'PASS',errors=errors)
        except (OSError,UnicodeError): checks['recursive_scan']=dict(status='BLOCKED',errors=['unreadable source'])
    status='FAIL' if any(c['status']=='FAIL' for c in checks.values()) else 'BLOCKED' if any(c['status']=='BLOCKED' for c in checks.values()) else 'PASS'
    result=dict(status=status,player=a.id,checks=checks)
    if a.json: print(json.dumps(result,ensure_ascii=False,indent=2))
    else:
        for name,c in checks.items(): print(c['status'],name,'exit='+str(c.get('exit_code')), '; '.join(c.get('errors',[])))
    return {'PASS':0,'FAIL':1,'BLOCKED':2}[status]


if __name__=='__main__': raise SystemExit(main())
