#!/usr/bin/env python3
"""Fail-closed G3 F_ref plan. No source mutations. --dry-run never starts a child."""
import argparse
import csv
from contextlib import contextmanager
import fcntl
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import stat
import tempfile
import sys
import time

# Restrictive permissions apply to standalone initialization and imported helpers too.
os.umask(0o077)
BASE=Path('/tmp/g3-chain')
TOOL_ROOT=BASE
# Recorded tool manifest, kept inline to limit edits to the approved four files.
# Refresh only after reviewing changed tool bytes; never derive expected hashes at run time.
TOOL_MANIFEST={
    'gates.py':'0a3970e720e0b81051bdbaf3e1ff7c83b355a95795f2ef5c8bed36c5f620ed0a',
    'revision_audit.py':'f2ff12581e8bdbed29962ed1019aa2ba140cfcb05096f3c9cb5dc57b4d114f52',
}
SOURCE=Path('/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-r2')
VIEW=BASE/'source-view'
EVAL=BASE/'eval'
G3='ascon-notes/league/g3'
LEAGUE='ascon-notes/league'
F_MIX='fixed-bid-5gwei implementation/configuration absent; both F_mix rosters intentionally invalid'
CHECKS={'candidate','inputs','trackedTree','upstreamByteEquality','upstreamRefPinned','seedAudit','disk','noAnvil','parentFrozenUnset','unitTimingOverrideAbsent','completeness'}
MANIFEST=json.loads((BASE/'source-manifest.json').read_text())
BUDGET=json.loads((VIEW/G3/'budget.json').read_text())

class Stop(Exception):
    def __init__(self, message, rc=2): super().__init__(message); self.rc=rc

def prestart_gate(doc, rc):
    """Only the exact F_mix completeness item is exempted; never whole FAIL."""
    checks=doc.get('checks')
    if not isinstance(checks,dict) or not CHECKS <= set(checks): return False
    if rc not in (0,1): return False
    if any(not isinstance(v,dict) or type(v.get('pass')) is not bool for v in checks.values()): return False
    raw_pass=all(v['pass'] for v in checks.values())
    if doc.get('status') != ('PASS' if raw_pass else 'FAIL') or rc != (0 if raw_pass else 1): return False
    for name,value in checks.items():
        if name!='completeness' and value['pass'] is not True: return False
    comp=checks['completeness']; blocked=comp.get('blocked')
    if not isinstance(blocked,list) or len(set(map(str,blocked)))!=len(blocked): return False
    if comp['pass'] != (blocked==[]): return False
    return blocked==[] or blocked==[F_MIX]

def rows():
    with (VIEW/G3/'schedule.tsv').open() as f: allrows=list(csv.DictReader(f,delimiter='\t'))
    normal=[r for r in allrows if r['group']=='normal']
    ref=[r for r in normal if r['field']=='ref']
    assert len(ref)==18 and len(normal)==36
    assert [(r['regime'],r['seed'],r['mode']) for r in ref]==[(reg,str(seed),mode) for reg in ['calm','crash','depeg'] for seed in range(49001,49004) for mode in (['on','off'] if seed==49002 else ['off','on'])]
    assert BUDGET['parallel']==1 and 0<BUDGET['maxChunkMinutes']<=110 and 0<BUDGET['maxDailyHours']<=6
    for r in ref:
        assert (r['parallel'],r['blocks'],r['block_seconds'],r['base_port'],r['state'])==('1','360','2','8847','fresh-v0')
        assert r['roster']==G3+'/ref-'+r['mode']+'.yaml' and r['gate']=='UNVERIFIED'
        roster=json.loads('\n'.join(line for line in (VIEW/r['roster']).read_text().splitlines() if not line.startswith('#')))
        assert [a['id'] for a in roster['agents']]==['noop','multi-arb','clean-arb','cand']
        candidate=roster['agents'][-1]
        assert candidate['dir']=='ascon-zeta-r2'
        ce=candidate['env']
        assert ce.get('ERIS_AGENT_FROZEN')=='1' if r['mode']=='off' else 'ERIS_AGENT_FROZEN' not in ce
        assert all(a['env'].get('ERIS_AGENT_FROZEN')=='1' and a['wallet']=='AUTO' for a in roster['agents'][:-1])
        assert ce['ERIS_LLM_MODEL']=='claude-cli:haiku' and ce['ERIS_LLM_CALL_TIMEOUT_MS']=='300000'
        config=(VIEW/'config/regimes'/str(r['regime']+'.yaml')).read_text()
        assert re.search(r'^  blockTimeSec: 2(?:\s|$)',config,re.M)
    return normal,ref

def save_json(dest,value):
    dest=Path(dest); temp=dest.with_suffix(dest.suffix+'.new')
    temp.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n'); temp.replace(dest)

def summary_init():
    dest=BASE/'summary.tsv'
    if dest.exists(): return
    normal,_=rows()
    with dest.open('x') as f:
        w=csv.writer(f,delimiter='\t',lineterminator='\n')
        w.writerow(['order','label','field','mode','result','exit_code','reason'])
        for r in normal: w.writerow([r['order'],r['label'],r['field'],r['mode'],'NOT RUN','', 'BLOCKED: fixed-bid-5gwei missing; excluded F_mix' if r['field']=='mix' else 'planned only; prestart/malicious/audit gates required'])

def summary_update(row,result,rc,reason):
    dest=BASE/'summary.tsv'
    with dest.open() as f: data=list(csv.DictReader(f,delimiter='\t'))
    for r in data:
        if r['label']==row['label']: r.update(result=result,exit_code=str(rc),reason=reason)
    tmp=dest.with_suffix('.new')
    with tmp.open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(data[0]),delimiter='\t',lineterminator='\n'); w.writeheader(); w.writerows(data)
    tmp.replace(dest)

def clean_env():
    # Retain the existing HOME only for the CLI's own auth; never inspect auth files.
    # All API keys, arbitrary ERIS_* variables, nested-session flags and dotenv hooks are absent.
    return {k:os.environ[k] for k in ['PATH','HOME','USER','LOGNAME'] if k in os.environ} | {
        'TMPDIR':str(BASE/'tmp'),'PYTHONDONTWRITEBYTECODE':'1','TSX_DISABLE_CACHE':'1','GIT_OPTIONAL_LOCKS':'0',
        'NPM_CONFIG_OFFLINE':'true','NPM_CONFIG_IGNORE_SCRIPTS':'true',
        'NPM_CONFIG_UPDATE_NOTIFIER':'false','NPM_CONFIG_CACHE':str(BASE/'npm-cache')}

def command(argv,cwd,env=None,log=None):
    env=dict(env or {})
    if Path(cwd)==EVAL:
        env.update(GIT_DIR=MANIFEST['absoluteGitDir'],GIT_WORK_TREE=str(EVAL),GIT_OPTIONAL_LOCKS='0')
    return {'argv':list(map(str,argv)),'cwd':str(cwd),'env':env or {},'log':log}

def printable(c):
    # These are EXACT command arguments, shell-quoted; sanitized env contains paths only.
    e=clean_env(); e.update(c['env'])
    line='(cd '+shlex.quote(c['cwd'])+' && env -i '+ ' '.join(shlex.quote(k+'='+v) for k,v in sorted(e.items()))+' '+shlex.join(c['argv'])+')'
    if c['log']: line+=' > '+shlex.quote(str(BASE/c['log']))+' 2>&1'
    return line

def preflight_commands(prefix=""):
    def evidence(name): return prefix+name
    return [
        command(['python3','-B',SOURCE/G3/'prestart-check.py'],SOURCE,log=evidence('prestart.json')),
        command(['python3','-B',BASE/'gates.py','prestart',BASE/evidence('prestart.json'),BASE/evidence('prestart.json.exit')],BASE,log=evidence('prestart-gate.json')),
        command(['node','--import',SOURCE/'node_modules/tsx/dist/loader.mjs',BASE/'malicious.mjs'],SOURCE,log=evidence('malicious.json')),
        command(['python3','-B',BASE/'gates.py','auth'],BASE,log=evidence('auth.json')),
        command(['python3','-B',BASE/'gates.py','runtime-ready'],BASE,log=evidence('runtime-ready.json')),
    ]

def world_commands(r,paired=False,audit_cmd=None):
    label=r['label']; roster=r['roster']; reg=r['regime']; seed=r['seed']
    base=['--roster',roster,'--regimes',reg,'--seeds',seed]
    py=['python3','-B']
    commands=[
        command(py+[LEAGUE+'/round-manifest.py','begin',label]+base+['--parallel',r['parallel']],EVAL,log=label+'/begin.json'),
        # run-league does NOT accept --blocks/--block-seconds. The matrix's documented
        # BACKTEST_EXTRA_ARGS forwards --blocks; 2s is pinned in regime config and G0.
        # Parent FROZEN absent for BOTH; OFF is set solely by ref-off.yaml.
        command(['bash',LEAGUE+'/run-league.sh','--label',label]+base+['--parallel',r['parallel'],'--base-port',r['base_port']],EVAL,{'BACKTEST_EXTRA_ARGS':'--blocks '+r['blocks']},label+'/run.log'),
        command(py+[LEAGUE+'/round-manifest.py','verify',label],EVAL,log=label+'/verify.json'),
        command(py+[LEAGUE+'/g0.py',label]+base+['--manifest',label,'--json'],EVAL,log=label+'/g0.json'),
        command(py+[BASE/'gates.py','strict-g0',BASE/label/'g0.json'],EVAL,log=label+'/strict-g0.json'),
        command(py+[BASE/'gates.py','revision-audit',label,r['mode']]+(['--audit-cmd',audit_cmd] if audit_cmd else []),EVAL,log=label+'/revision-audit.json'),
        command(py+[LEAGUE+'/league-report.py',label]+base+['--manifest',label,'--ref','noop','--json'],EVAL,log=label+'/report.json')]
    if paired:
        on='g3-r2-ref-'+reg+'-'+seed+'-on'; off='g3-r2-ref-'+reg+'-'+seed+'-off'
        commands += [command(py+[LEAGUE+'/g0.py',on,'--roster',G3+'/ref-on.yaml','--regimes',reg,'--seeds',seed,'--manifest',on,'--baseline',off,'--json'],EVAL,log=label+'/pair-g0.json'),
                     command(py+[BASE/'gates.py','strict-g0',BASE/label/'pair-g0.json'],EVAL,log=label+'/pair-strict-g0.json')]
    return commands

def idle():
    for args in [['pgrep','-x','anvil'],['pgrep','-f',r'run-matrix\.sh|run-league\.sh|core/src/cli/backtest\.(ts|js)|matrix_worker\.py|run-queue-[^ /]*\.sh']]:
        p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if p.returncode!=1 or p.stderr: raise Stop('BLOCKED: Anvil/matrix alive or process inspection unavailable')

def source_check():
    sha=subprocess.check_output(['git','-C',str(SOURCE),'rev-parse','HEAD'],text=True).strip()
    if sha!=MANIFEST['head']: raise Stop('FAIL: source HEAD changed',1)
    for name,digest in MANIFEST['files'].items():
        p=VIEW/name
        if p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest: raise Stop('FAIL: source view drift',1)
        original=SOURCE/name
        if original.is_symlink() or hashlib.sha256(original.read_bytes()).hexdigest()!=digest: raise Stop('FAIL: source working bytes drift',1)
    # Prestart checks candidate/input working bytes; no untracked/credential files are read here.

def tool_check():
    for name,digest in TOOL_MANIFEST.items():
        path=TOOL_ROOT/name
        try:
            if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
                raise Stop('BLOCKED: tool manifest mismatch: '+name)
        except OSError:
            raise Stop('BLOCKED: tool manifest input unavailable: '+name) from None

def default_audit_cmd():
    return shlex.join([sys.executable,'-B',str(BASE/'revision_audit.py')])


class Supervisor:
    def __init__(self):
        self.child=None; self.deadline=0
    def kill(self):
        if self.child:
            try: os.killpg(self.child.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            self.child.wait(); self.child=None
    def run(self,c,allow_failure=False):
        tool_check()
        e=clean_env(); e.update(c['env'])
        dest=BASE/c['log']; dest.parent.mkdir(parents=True,exist_ok=True)
        with dest.open('xb') as stream:
            self.child=subprocess.Popen(c['argv'],cwd=c['cwd'],env=e,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
            try:
                rc=self.child.wait(timeout=max(.01,self.deadline-time.monotonic()))
                # Refuse leaked descendants; kill only this launcher's owned process group.
                try:
                    os.killpg(self.child.pid,0)
                    os.killpg(self.child.pid,signal.SIGKILL)
                    if rc==0: rc=125
                except ProcessLookupError: pass
                self.child=None
            except subprocess.TimeoutExpired:
                self.kill(); rc=124
        (dest.parent/(dest.name+'.exit')).write_text(str(rc)+'\n')
        with (BASE/'exit-codes.tsv').open('a') as f: f.write(c['log']+'\t'+str(rc)+'\n')
        if rc and not allow_failure: raise Stop('FAIL/BLOCKED: '+c['log']+' (exit '+str(rc)+')',rc)
        return rc

def ledger_path():
    home=os.environ.get('HOME')
    if not home or not Path(home).is_absolute():
        raise Stop('BLOCKED: absolute HOME required for persistent budget ledger')
    path=Path(home)/'.ascon-g3'/'budget-ledger.json'
    # macOS /tmp resolves to /private/tmp; neither is a persistent ledger location.
    if any(path.resolve().is_relative_to(Path(root).resolve()) for root in ('/tmp','/var/tmp')):
        raise Stop('BLOCKED: budget ledger must live outside temporary storage')
    return path

def validate_ledger(data):
    try:
        if not isinstance(data,list) or not data: raise ValueError()
        totals={}
        for index,item in enumerate(data):
            if not isinstance(item,dict): raise ValueError()
            stamp=dt.datetime.fromisoformat(item['started'])
            day=dt.date.fromisoformat(item['day']).isoformat()
            seconds=item['reservedSeconds']
            if stamp.tzinfo is None or stamp.date().isoformat()!=day: raise ValueError()
            if type(seconds) not in (int,float) or not math.isfinite(seconds): raise ValueError()
            if index==0:
                if item.get('event')!='init' or seconds!=0: raise ValueError()
            elif item.get('event')!='reserve' or not 0<seconds<=110*60: raise ValueError()
            totals[day]=totals.get(day,0)+seconds
            if totals[day]>6*3600: raise ValueError()
    except (ValueError,TypeError,KeyError,OverflowError):
        raise Stop('BLOCKED: corrupt budget ledger; never reset automatically') from None

@contextmanager
def budget_ledger(init=False):
    ledger=ledger_path(); directory=ledger.parent
    try:
        if init: directory.mkdir(mode=0o700,exist_ok=True)
        if directory.is_symlink(): raise Stop('BLOCKED: ledger directory is a symlink')
        fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            if os.fstat(fd).st_uid!=os.getuid(): raise Stop('BLOCKED: ledger directory owner mismatch')
            os.fchmod(fd,0o700)
            # Persistent directory lock survives atomic ledger replacement and /tmp cleanup.
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            if init:
                now=dt.datetime.now().astimezone()
                initial=[{'event':'init','day':now.date().isoformat(),'started':now.isoformat(),
                          'reservedSeconds':0,'accounting':'explicit --init-ledger'}]
                try:
                    newfd=os.open(ledger,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                except FileExistsError:
                    raise Stop('BLOCKED: ledger already exists; --init-ledger never resets it') from None
                with os.fdopen(newfd,'w') as stream:
                    json.dump(initial,stream,allow_nan=False); stream.write('\n')
                    stream.flush(); os.fsync(stream.fileno())
                os.fsync(fd)
            readfd=os.open(ledger,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            with os.fdopen(readfd) as stream:
                info=os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid():
                    raise Stop('BLOCKED: ledger is not an owned regular file')
                os.fchmod(stream.fileno(),0o600)
                data=json.load(stream)
            validate_ledger(data)
            yield ledger,data
        finally:
            os.close(fd)
    except FileNotFoundError:
        raise Stop('BLOCKED: budget ledger MISSING; operator must explicitly --init-ledger') from None
    except (OSError,ValueError):
        raise Stop('BLOCKED: budget ledger unavailable, locked or corrupt') from None

def save_ledger(ledger,data):
    fd,temp=tempfile.mkstemp(prefix='.budget-ledger-',dir=ledger.parent)
    try:
        with os.fdopen(fd,'w') as stream:
            os.fchmod(stream.fileno(),0o600)
            json.dump(data,stream,allow_nan=False); stream.write('\n')
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temp,ledger)
        directory_fd=os.open(ledger.parent,os.O_RDONLY|os.O_DIRECTORY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def reserve_budget(init=False):
    # Persist a conservative FULL chunk charge before any work; restart/crash cannot erase cost.
    with budget_ledger(init) as (ledger,data):
        now=dt.datetime.now().astimezone(); day=now.date().isoformat()
        used=sum(x['reservedSeconds'] for x in data if x['day']==day)
        midnight=dt.datetime.combine(now.date()+dt.timedelta(days=1),dt.time(),tzinfo=now.tzinfo)
        cap=min(BUDGET['maxChunkMinutes']*60,110*60,BUDGET['maxDailyHours']*3600-used,6*3600-used,(midnight-now).total_seconds())
        if cap<60: raise Stop('BLOCKED: daily/time budget exhausted; no automatic wait or retry',75)
        data.append({'event':'reserve','day':day,'started':now.isoformat(),'reservedSeconds':cap,'accounting':'full chunk charged even on early abort'})
        save_ledger(ledger,data)
        return cap

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run',action='store_true')
    mode.add_argument('--run',action='store_true')
    parser.add_argument('--init-ledger',action='store_true',help='explicitly create missing persistent ledger; never reset existing ledger')
    parser.add_argument('--audit-cmd',default=default_audit_cmd(),
                        help='auditor argv prefix (no shell); run_dir --mode on/off appended')
    args=parser.parse_args()
    if args.init_ledger and args.dry_run:
        parser.error('--init-ledger cannot be combined with --dry-run')
    if args.init_ledger and not args.run:
        with budget_ledger(init=True): pass
        print('PASS: persistent budget ledger initialized; no work executed')
        return 0
    if args.run:
        tool_check()
        if shlex.split(args.audit_cmd)!=shlex.split(default_audit_cmd()):
            raise Stop('BLOCKED: --run requires the manifest-pinned auditor')
    arg='--run' if args.run else '--dry-run'
    _,ref=rows()
    if arg=='--dry-run':
        print('# F_REF ONLY: 18 normal worlds; all 18 F_mix = NOT RUN / BLOCKED.')
        print('# Conditional full plan, NOT an execution log. Each non-PASS stops. F_mix exemption is exact-match only.')
        print('# --run acquires /tmp/g3-chain/chain.lock; checks pgrep; reserves <=110min from $HOME/.ascon-g3/budget-ledger.json (6h/day; missing/corrupt = BLOCKED).')
        print('caffeinate -i -s -w "${LAUNCHER_PID}"')
        print('# Auth helper (only after PASS prestart + malicious): resolve executable claude; capture auth status --json without raw output.')
        print('# Project wrapper probe (single attempted call): xb-r-live-claude-timed.sh -p \'Reply exactly OK.\' --model haiku --max-turns 1 --tools \'\' --disable-slash-commands --strict-mcp-config --mcp-config \'{"mcpServers":{}}\' --setting-sources \'\' --no-session-persistence')
        for c in preflight_commands(): print(printable(c))
        print('# prestart exit 1 is accepted ONLY if prestart-gate.json is PASS_F_REF_ONLY. Other exits stop.')
        print('# runtime-ready is currently BLOCKED (live recorder missing, no isolated dependencies/state).')
        print('# Before every world: no Anvil/matrix, source hashes, budget admission; hard monotonic deadline including audits.')
        for i,r in enumerate(ref):
            if i%6==0: print('# CHUNK '+str(i//6+1)+': <=6 worlds, nominal 78min; estimate*1.2 + audits must fit <=110min.')
            print('# '+r['label']+' parent ERIS_AGENT_FROZEN ABSENT; candidate '+('1 via ref-off.yaml' if r['mode']=='off' else 'ABSENT via ref-on.yaml'))
            for c in world_commands(r,paired=i%2==1,audit_cmd=args.audit_cmd): print(printable(c))
            print('# Save exit codes and per-world summary.tsv; pair G0 before next pair, including ON-first pairs.')
        return 0
    os.umask(0o077); (BASE/'tmp').mkdir(exist_ok=True)
    lock=BASE/'chain.lock'
    try: lock.mkdir()
    except FileExistsError: raise Stop('BLOCKED: chain lock exists; never steal a stale lock')
    supervisor=Supervisor(); awake=None
    try:
        idle(); source_check(); summary_init()
        if not shutil.which('caffeinate'): raise Stop('BLOCKED: caffeinate unavailable')
        seconds=reserve_budget(init=args.init_ledger); supervisor.deadline=time.monotonic()+seconds
        awake=subprocess.Popen(['caffeinate','-i','-s','-w',str(os.getpid())],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        def interrupted(signum,frame): raise Stop('interrupted',128+signum)
        signal.signal(signal.SIGTERM,interrupted); signal.signal(signal.SIGINT,interrupted)
        progress_file=BASE/'progress.json'
        progress=json.loads(progress_file.read_text()) if progress_file.exists() else {'completed':[], 'inProgress':None, 'evidence':{}}
        if progress['inProgress'] is not None: raise Stop('BLOCKED: interrupted or failed pair; no rescue rerun')
        if progress['completed'] != [r['label'] for r in ref[:len(progress['completed'])]] or len(progress['completed'])%2: raise Stop('BLOCKED: invalid progress ordering')
        for name,digest in progress['evidence'].items():
            if hashlib.sha256((BASE/name).read_bytes()).hexdigest()!=digest: raise Stop('FAIL: prior evidence changed',1)
        prefix='attempts/'+str(time.time_ns())+'/'
        pre=preflight_commands(prefix)
        supervisor.run(pre[0],allow_failure=True)
        for c in pre[1:]: supervisor.run(c)
        # Never reached with the pinned source: prestart, malicious and audit readiness block.
        # Future reviewed implementation must satisfy all preceding gates without exemptions.
        max_elapsed=0
        start_index=len(progress['completed'])
        for i,r in enumerate(ref):
            if i<start_index: continue
            idle(); source_check()
            if awake.poll() is not None: raise Stop('FAIL: caffeinate stopped',1)
            # Admission for a COMPLETE pair; never split ON-first from its OFF baseline.
            if i%2==0:
                reserve=max(float(r['expected_hours'])*3600,max_elapsed)*BUDGET['multiplier']*2+600
                if time.monotonic()+reserve>=supervisor.deadline: raise Stop('BLOCKED: next pair exceeds chunk/daily budget',75)
            if i-start_index>=6: raise Stop('PAUSED: six-world chunk complete; next --run resumes at next pair',75)
            if i%2==0:
                progress['inProgress']=r['label']; save_json(progress_file,progress)
            started=time.monotonic(); summary_update(r,'RUNNING','','not yet audited')
            try:
                for c in world_commands(r,paired=i%2==1,audit_cmd=args.audit_cmd): supervisor.run(c)
                summary_update(r,'PASS' if i%2 else 'PENDING_PAIR',0,'G0, revision/action audit; paired G0 required')
                if i%2:
                    summary_update(ref[i-1],'PASS',0,'paired G0 and complete audit PASS')
                    progress['completed'].extend([ref[i-1]['label'],r['label']])
                    progress['inProgress']=None
                    for previous in ref[i-1:i+1]:
                        for artifact in (BASE/previous['label']).glob('*'):
                            if artifact.is_file(): progress['evidence'][str(artifact.relative_to(BASE))]=hashlib.sha256(artifact.read_bytes()).hexdigest()
                    save_json(progress_file,progress)
            except Stop as exc:
                summary_update(r,'FAIL/BLOCKED',exc.rc,str(exc)); raise
            max_elapsed=max(max_elapsed,time.monotonic()-started)
        return 0
    finally:
        supervisor.kill()
        if awake:
            awake.terminate(); awake.wait()
        lock.rmdir()

if __name__=='__main__':
    try: sys.exit(main())
    except Stop as exc:
        print(str(exc),file=sys.stderr); sys.exit(exc.rc)
    except (OSError,ValueError,AssertionError,KeyError) as exc:
        print('BLOCKED: invalid/missing input ('+type(exc).__name__+')',file=sys.stderr); sys.exit(2)
