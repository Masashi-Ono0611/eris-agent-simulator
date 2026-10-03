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


def scan(path):
    errors=[]
    roots=[path.resolve(),(path.parent/'lib').resolve(),(path.parent/'runtime').resolve()]
    for file in sorted(path.rglob('*')):
        if file.is_symlink(): errors.append('symlink: '+str(file.relative_to(path))); continue
        if not file.is_file() or file.suffix not in ('.ts','.mts','.cts','.tsx','.js','.mjs','.cjs'): continue
        text=file.read_text()
        if FORBIDDEN.search(text): errors.append('forbidden RPC: '+str(file.relative_to(path)))
        if DYNAMIC.search(text): errors.append('unresolved dynamic import: '+str(file.relative_to(path)))
        for call in re.finditer(r'\b(?:import|require)\s*\(([^)]*)\)', text):
            if not re.fullmatch(r'''\s*(["'`])[^"'`]*\1\s*''', call.group(1)):
                errors.append('nonliteral dynamic import: '+str(file.relative_to(path)))
        for m in IMPORT.finditer(text):
            target=m.group(2)
            if '${' in target: errors.append('unresolved template import: '+target); continue
            if not target.startswith('.'): continue
            resolved=(file.parent/target).resolve()
            if not any(resolved.is_relative_to(root) for root in roots):
                errors.append('cross-agent import: '+str(file.relative_to(path))+': '+target)
    return errors


def main():
    p=argparse.ArgumentParser(); p.add_argument('id'); p.add_argument('--json',action='store_true'); a=p.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*',a.id): p.error('bad id')
    scaffold=Path(__file__).resolve().parents[2]; wt=scaffold.parent/('league-'+a.id)
    agent=wt/'example/agents'/a.id; checks={}
    def command(name,cmd):
        try:
            r=subprocess.run(cmd,cwd=wt,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            checks[name]=dict(status='PASS' if r.returncode==0 else 'FAIL',exit_code=r.returncode)
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
