#!/usr/bin/env python3
"""Offline, fail-closed G3 per-world evidence auditor. No simulation/provider/RPC calls.

Stock files are always inventoried. g3-audit.json and agents/cand.audit-frames.jsonl
are an explicit *future recorder contract*, not files present in earlier pinned-source runs.
See REVISION-AUDIT.md. Exit: PASS=0, FAIL=1, BLOCKED=2.
"""
import argparse
from collections import Counter
import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

BASE = Path(__file__).resolve().parent
EXIT = {'PASS': 0, 'FAIL': 1, 'BLOCKED': 2}
# Source path, source commit and eval base are REQUIRED explicit inputs (same names as
# chain.py). No default and no fallback to an earlier round's worktree or commit.
TEMP_ROOTS = ('/tmp', '/var/tmp', '/private/tmp', '/private/var/tmp')

def under_temp_root(path):
    return any(path.is_relative_to(r) or path.resolve().is_relative_to(Path(r).resolve()) for r in TEMP_ROOTS)

def explicit_inputs(environ=os.environ):
    """Return (source, commit) or raise ValueError naming the missing/invalid input."""
    def directory(name):
        value = environ.get(name)
        if not value: raise ValueError(name + ' missing or empty; explicit value required (no default)')
        path = Path(value)
        if not path.is_absolute(): raise ValueError(name + ' must be an absolute path')
        if under_temp_root(path):
            raise ValueError(name + ' must not be under /tmp or /var/tmp')
        if not path.is_dir(): raise ValueError(name + ' does not exist or is not a directory')
        return path
    source = directory('G3_CHAIN_SOURCE')
    commit = environ.get('G3_CHAIN_SOURCE_COMMIT')
    if not commit: raise ValueError('G3_CHAIN_SOURCE_COMMIT missing or empty; explicit value required (no default)')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('G3_CHAIN_SOURCE_COMMIT must be exactly 40 lowercase hex characters (full commit, no prefix)')
    # The auditor reads the manifest next to itself, so it must be deployed in the eval base.
    if directory('G3_CHAIN_BASE').resolve() != BASE:
        raise ValueError('revision_audit.py must be placed directly in G3_CHAIN_BASE')
    return source, commit

def sha(data): return hashlib.sha256(data).hexdigest()
def timestamp(value):
    stamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None: raise ValueError('timezone required')
    return stamp.timestamp()
def integer(v): return type(v) is int and v >= 0

def replay(calls, frames):
    # Bind the compile path and its local dependencies to the explicit commit-bound view.
    SOURCE, commit = explicit_inputs()
    manifest = json.loads((BASE/'source-manifest.json').read_text())
    if manifest.get('head') != commit or manifest.get('source') != str(SOURCE):
        raise ValueError('source manifest differs from explicit source inputs')
    prefixes = ('example/agents/runtime/', 'sdk/src/', 'ascon-notes/league/g3/')
    for name, digest in manifest['files'].items():
        if name.startswith(prefixes) and name.endswith(('.ts', '.mjs', '.json')):
            p = SOURCE/name
            if p.is_symlink() or sha(p.read_bytes()) != digest:
                raise ValueError('pinned compiler/harness dependency drift')
    env = {k: os.environ[k] for k in ('PATH',) if k in os.environ}
    env.update(TSX_DISABLE_CACHE='1', TMPDIR=str(BASE), NODE_COMPILE_CACHE=str(BASE/'node-compile-cache'))
    proc = subprocess.run(['node', '--import', str(SOURCE/'node_modules/tsx/dist/loader.mjs'),
                           str(BASE/'revision_replay.mjs'), str(SOURCE)],
                          input=json.dumps({'calls': calls, 'frames': frames}), capture_output=True,
                          text=True, cwd=SOURCE, env=env, timeout=70 + 6*len(frames))
    if proc.returncode: raise ValueError('offline compiler/replay process failed')
    return json.loads(proc.stdout)

class Auditor:
    def __init__(self, root, mode):
        self.root, self.mode = Path(root).resolve(), mode
        self.failures, self.blocked, self.calls = [], [], []
        self.counts = Counter({k: 0 for k in ('starts','responses','outcomes','unfinished','installed','reverted',
            'declined','rejected','timeout','quota','empty','invalid','normalCycles','frames','replayedFrames','adoptedExecutors','auditedExecutors')})
        self.hashes = {}
    def read(self, name, jsonl=False):
        p = self.root/name
        try:
            if p.is_symlink() or not p.resolve().is_relative_to(self.root): raise ValueError()
            raw = p.read_bytes(); self.hashes[name] = sha(raw)
            if jsonl:
                if raw and not raw.endswith(b'\n'): raise ValueError()
                rows = [json.loads(x) for x in raw.splitlines()]
                if any(not isinstance(x,dict) for x in rows): raise ValueError()
                if any(x.get('event') in ('log_line_truncated','log_cap_reached') for x in rows):
                    self.blocked.append(name+': truncated/capped evidence')
                return rows
            doc = json.loads(raw)
            if not isinstance(doc,dict): raise ValueError()
            return doc
        except (OSError, ValueError):
            self.blocked.append(name+': missing/malformed evidence')
            return [] if jsonl else {}
    def run(self):
        starts = self.read('agents/cand.cli-timing.jsonl', True)
        replies = self.read('agents/cand.llm.jsonl', True)
        agent = self.read('agents/cand.jsonl', True)
        events = self.read('events.jsonl', True)
        summary = self.read('summary.json')
        meta = self.read('g3-audit.json')
        frames = self.read('agents/cand.audit-frames.jsonl', True)
        outcomes = [x for x in agent if str(x.get('reason','')).startswith('revision ')]
        self.counts.update(starts=len(starts),responses=len(replies),outcomes=len(outcomes),frames=len(frames))
        if any(x.get('kind')!='cli_call_started' or x.get('agentId')!='cand' for x in starts): self.blocked.append('unknown call-start record')
        if any(x.get('kind')!='revision_call' or x.get('agentId')!='cand' for x in replies): self.blocked.append('unknown response record')
        if any(x.get('agentId')!='cand' for x in outcomes): self.blocked.append('outcome agent mismatch')
        if self.mode == 'off' and (starts or replies or outcomes): self.failures.append('OFF world made revision calls')
        if not summary.get('runId') or not any(e.get('type')=='run_completed' and e.get('runId')==summary.get('runId') for e in events):
            self.blocked.append('world completion not evidenced')
        completions=[e for e in events if e.get('type')=='run_completed' and e.get('runId')==summary.get('runId')]
        world_end=timestamp(completions[0]['ts']) if len(completions)==1 else None
        if world_end is None:self.blocked.append('unique world completion timestamp missing')
        if 'violations' not in summary: self.blocked.append('summary violations missing')
        elif summary['violations']: self.failures.append('world violations')
        receipt_by_hash={}
        try:
            p=self.root/'blocks.csv'
            if p.is_symlink() or not p.resolve().is_relative_to(self.root): raise ValueError()
            raw=p.read_bytes(); self.hashes['blocks.csv']=sha(raw)
            rows=list(csv.DictReader(raw.decode().splitlines()))
            receipt_by_hash={r['hash']:r for r in rows if r.get('ownerId')=='cand'}
            if not {'ownerId','status','hash'} <= set(next(csv.reader(raw.decode().splitlines()))): raise ValueError()
            if any(r['ownerId']=='cand' and r['status'] not in ('1','success') for r in rows): self.failures.append('candidate mined revert')
        except (OSError,ValueError,StopIteration): self.blocked.append('blocks.csv: missing/malformed receipts')
        valid_meta = (meta.get('schema')==1 and meta.get('complete') is True and meta.get('worldId')==summary.get('runId')
                      and meta.get('mode')==self.mode and meta.get('reviseEveryBlocks')==60
                      and meta.get('decideTimeoutMs')==5000 and meta.get('inferenceTimeoutMs')==300000
                      and meta.get('case') in ('normal','timeout','invalid','empty','quota','malicious','delayed','change-revert'))
        if not valid_meta: self.blocked.append('finished recorder contract absent/invalid (60 blocks / 5s / 300s)')
        if meta.get('expectedCalls')!=len(starts) or meta.get('expectedFrames')!=len(frames): self.blocked.append('recorder coverage counts disagree')
        if not frames: self.blocked.append('no full observation/decision frames')
        for name,digest in self.hashes.items():
            if name=='g3-audit.json': continue
            if meta.get('files',{}).get(name)!=digest: self.blocked.append(name+': recorder digest absent/mismatch')
        # Native start records contain no block/call ID. Serial order is provisional only;
        # a PASS additionally requires the recorder callStarts binding and unambiguous timing.
        bindings=meta.get('callStarts',[])
        if len(bindings)!=len(starts): self.blocked.append('call-start block binding missing')
        previous_block=meta.get('firstObservationRound'); previous_end=None; prior_rejected=False
        if not integer(previous_block): self.blocked.append('first observation round missing');previous_block=None
        versions={}; applications=[]; replay_calls=[]; call_records=[]
        for i in range(max(len(starts),len(replies))):
            start=starts[i] if i<len(starts) else None
            reply=replies[i] if i<len(replies) else None
            bind=bindings[i] if i<len(bindings) else {}
            block=reply.get('block') if reply else bind.get('block')
            outcome_matches=[x for x in outcomes if x.get('round')==block]
            outcome=outcome_matches[0] if len(outcome_matches)==1 else None
            record={'index':i,'block':block,'startedAt':start.get('ts') if start else None,
                    'completedAt':reply.get('ts') if reply else None,'outcome':outcome.get('state',{}).get('kind') if outcome else None,
                    'outcomeAt':outcome.get('ts') if outcome else None,'classification':'unfinished'}
            self.calls.append(record)
            if not integer(block): self.blocked.append(f'call {i}: block unavailable')
            else:
                if previous_block is not None and block-previous_block<60: self.failures.append('revision cadence exceeds 1 per reviseEveryBlocks')
                previous_block=block
            if not start or not reply or not outcome:
                self.counts['unfinished']+=1; self.blocked.append(f'call {i}: start/response/outcome missing or ambiguous')
            if start and (bind.get('ts')!=start.get('ts') or bind.get('pid')!=start.get('pid') or bind.get('block')!=block):
                self.blocked.append(f'call {i}: unbound start')
            try:
                begin=timestamp(start['ts'])
                if previous_end is not None and begin < previous_end: self.failures.append('overlapping inference calls')
                if reply:
                    end=timestamp(reply['ts']); elapsed=(end-begin)*1000
                    record['elapsedMs']=round(elapsed,3)
                    if elapsed<0: self.failures.append('response before call start')
                    if elapsed>301000: self.failures.append('inference exceeded 300s plus 1s logging tolerance')
                    previous_end=timestamp(outcome['ts']) if outcome else end
                    if world_end is not None and previous_end>world_end:self.failures.append('revision completed/applied after world ended')
                    if previous_end<end: self.failures.append('outcome before response')
            except (KeyError,TypeError,ValueError): self.blocked.append(f'call {i}: timestamp evidence missing/invalid')
            if reply:
                for field in ('system','context','model'):
                    if not isinstance(reply.get(field),str) or not reply[field]: self.blocked.append(f'call {i}: {field} missing')
                if ('raw' in reply)==('error' in reply): self.blocked.append(f'call {i}: raw/error ambiguous')
                text=str(reply.get('error',''))
                kind='timeout' if 'timed out after 300000ms' in text else 'quota' if re.search(r'quota|429|rate.limit|usage.limit',text,re.I) else 'error' if text else 'response'
                record['classification']=kind
                if kind in ('timeout','quota'): self.counts[kind]+=1
                if kind=='error':
                    if 'timed out after' in text:self.failures.append('inference timeout differs from 300000ms')
                    if 'no JSON object' in text:
                        category='empty' if re.search(r'output:\s*$',text) else 'invalid'
                        record['classification']=category;self.counts[category]+=1
                    self.blocked.append(f'call {i}: provider error lacks full raw output classification evidence')
                if kind=='quota' and meta.get('case')!='quota': self.failures.append('quota exhaustion in non-quota world')
                if 'raw' in reply:
                    if not isinstance(reply['raw'],str): self.blocked.append('raw response not text')
                    else:
                        replay_calls.append({'raw':reply['raw']});call_records.append((record,reply,outcome))
                        record['rawSha256']=sha(reply['raw'].encode())
                elif outcome and outcome.get('state',{}).get('kind')!='rejected': self.failures.append('failed inference adopted/declined')
            if outcome:
                kind=outcome.get('state',{}).get('kind')
                if kind not in ('installed','reverted','rejected','declined') or outcome.get('reason')!='revision '+str(kind): self.blocked.append('unknown outcome')
                else: self.counts[kind]+=1
                if kind in ('installed','reverted','declined'): self.counts['normalCycles']+=1
                if kind=='rejected' and prior_rejected and meta.get('case')=='normal': self.failures.append('two consecutive rejected revisions')
                prior_rejected=kind=='rejected'
        if len({x.get('block') for x in replies})!=len(replies): self.failures.append('duplicate revision block')
        if len(outcomes)!=sum(c['outcome'] is not None for c in self.calls): self.blocked.append('orphan/duplicate revision outcomes')
        if self.mode=='on' and meta.get('case')=='normal' and self.counts['normalCycles']<3: self.failures.append('normal ON world has fewer than 3 completed cycles')
        # Parse every raw reply with stock parseRevision and compileExecutor, even rejected ones.
        parsed_results = replay(replay_calls, [])['parsed'] if replay_calls else []
        version=0
        for (record,reply,outcome), parsed in zip(call_records,parsed_results):
            if parsed['empty']: self.counts['empty']+=1;record['classification']='empty'
            elif not parsed['ok'] or parsed['compiled'] is False: self.counts['invalid']+=1;record['classification']='invalid'
            self.failures.extend(parsed['unsafe'])
            kind=record['outcome']; rev={}
            if parsed['ok']:
                rev=json.loads(re.sub(r'^```[^\n]*\n|\n```$','',reply['raw']))
            expected='rejected' if not parsed['ok'] or parsed['compiled'] is False else 'declined' if parsed['kind']=='declined' else 'reverted' if parsed['kind']=='revert' else 'installed'
            if parsed['kind']=='revert' and parsed['revertTo'] not in versions and parsed['revertTo']!=0:
                expected='rejected';self.counts['invalid']+=1;record['classification']='invalid'
            if kind and kind!=expected: self.failures.append('stock parse/compile disagrees with adoption/rejection')
            if kind not in ('installed','reverted'): continue
            version+=1
            source=rev.get('executorTs') if kind=='installed' else versions.get(parsed['revertTo'])
            versions[version]=source
            self.counts['adoptedExecutors']+=1
            if kind=='installed' and outcome['state'].get('version')!=version: self.failures.append('installed version not monotonic')
            matches=[a for a in meta.get('applications',[]) if a.get('callBlock')==record['block']]
            if len(matches)!=1: self.blocked.append('setSource/application binding absent');continue
            app=matches[0];applications.append(app)
            if source is None: self.blocked.append('restored v0 module replay unavailable')
            elif app.get('sourceSha256')!=sha(source.encode()): self.failures.append('adopted executor hash mismatch')
            if app.get('version')!=version: self.failures.append('application version mismatch')
            if not timestamp(record['completedAt'])<=timestamp(app['ts'])<=timestamp(record['outcomeAt']): self.failures.append('application outside response/outcome interval')
        if len(meta.get('applications',[]))!=len(applications): self.blocked.append('orphan/duplicate applications')
        telemetry=[e for e in events if e.get('type')=='g3_decision_started' and e.get('agentId')=='cand']
        if [e.get('id') for e in telemetry]!=[f.get('id') for f in frames] or len({f.get('id') for f in frames})!=len(frames):
            self.blocked.append('decision-start coverage incomplete/duplicate')
        to_replay=[]; seen_versions=set(); linked_receipts=[]; expected_attempts=[]
        for f in frames:
            ident=f.get('id')
            required={'id','startedAt','completedAt','version','workerGeneration','observation','returned','submitted','reads','safety','status'}
            if not required<=f.keys() or not isinstance(f.get('submitted'),list): self.blocked.append(f'frame {ident}: incomplete');continue
            begin=timestamp(f['startedAt']); end=timestamp(f['completedAt'])
            if world_end is not None and end>world_end:self.failures.append('decision completed after world ended')
            if not 0<=end-begin<=5: self.failures.append('logged decide outside 5000ms budget')
            if f['status']!='ok': self.failures.append('logged decide timeout/error')
            if not integer(f['version']) or not integer(f['workerGeneration']): self.blocked.append('frame version/generation missing');continue
            obs=f['observation']
            if not isinstance(obs,dict) or not {'round','balances','limits','blocksRemaining'}<=obs.keys(): self.blocked.append('full observation missing');continue
            event=next((e for e in telemetry if e.get('id')==ident),{})
            if event.get('ts')!=f['startedAt'] or event.get('round')!=obs['round'] or event.get('version')!=f['version']: self.blocked.append('decision telemetry/frame mismatch')
            active=[a for a in applications if timestamp(a['ts'])<=begin]
            expected_version=active[-1]['version'] if active else 0
            if f['version']!=expected_version:
                if len(applications)==len(meta.get('applications',[])): self.failures.append('actual decision version differs from applied version')
                else: self.blocked.append('actual version cannot be matched without application evidence')
            for route,actions in [('submit',f['submitted']),('return',[f['returned']])]:
                for ordinal,action in enumerate(actions):
                    if action is not None and action.get('type')!='noop':
                        expected_attempts.append({'frameId':ident,'route':route,'ordinal':ordinal,
                            'actionSha256':sha(json.dumps(action,sort_keys=True,separators=(',',':')).encode())})
            safety=f['safety']
            # Require concrete snapshots, not a precomputed PASS or boolean safety assertion.
            for k in ('allowances','pendingReservations','receipts'):
                if not isinstance(safety.get(k),dict if k!='receipts' else list): self.blocked.append(f'frame {ident}: {k} missing')
            for receipt in safety.get('receipts',[]):
                linked_receipts.append(receipt.get('hash'))
                row=receipt_by_hash.get(receipt.get('hash'))
                if row is None: self.blocked.append('action receipt missing from blocks.csv')
                elif str(receipt.get('status'))!=row['status']: self.failures.append('receipt status mismatch')
            if safety.get('unsafeAttempts')!=0 or safety.get('minedReverts')!=0 or safety.get('lateSubmits')!=0:
                if any(safety.get(k,0) for k in ('unsafeAttempts','minedReverts','lateSubmits')): self.failures.append('unsafe attempt/revert/late submit')
                else: self.blocked.append('frame safety counts missing')
            item=dict(f)
            if f['version']>0:
                source=versions.get(f['version'])
                if not isinstance(source,str): self.blocked.append('frame source unavailable');continue
                item['source']=source;seen_versions.add(f['version'])
            to_replay.append(item)
        attempts=[{k:e.get(k) for k in ('frameId','route','ordinal','actionSha256')} for e in events if e.get('type')=='g3_action_attempt' and e.get('agentId')=='cand']
        if attempts!=expected_attempts:self.blocked.append('action-attempt coverage differs from logged return/submit')
        if set(linked_receipts)!=set(receipt_by_hash) or len(set(linked_receipts))!=len(linked_receipts):self.blocked.append('orphan/duplicate candidate receipts')
        for app in applications:
            matching=[f for f in frames if f.get('version')==app['version']]
            if not matching: self.blocked.append('adopted version has no first decision frame')
            elif app.get('firstDecisionId')!=matching[0].get('id'): self.failures.append('first application frame mismatch')
        self.counts['auditedExecutors']=len(seen_versions)
        if self.counts['auditedExecutors']!=self.counts['adoptedExecutors']: self.blocked.append('not every adopted executor replayable')
        if to_replay:
            result=replay([],to_replay)
            for r in result['results']:
                self.failures.extend(r['failures']);self.blocked.extend(r['blocked'])
                if 'replay' in r:self.counts['replayedFrames']+=1
        if meta.get('case')=='timeout':
            proof=meta.get('timeoutInjection',{})
            call=next((c for c in self.calls if c['index']==proof.get('callIndex')),None)
            if not call or call['classification']!='timeout': self.failures.append('injected 5-minute timeout did not fire')
            elif not 300000<=call.get('elapsedMs',0)<=301000: self.failures.append('timeout is not the real 300000ms bound')
            required={'delayMs':301000,'configuredTimeoutMs':300000,'unitTimeScale':1,'killSignal':'SIGKILL','childExitObserved':True,'lateApplied':False}
            for k,v in required.items():
                if k not in proof:self.blocked.append('timeout kill/late-output evidence missing')
                elif proof[k]!=v:self.failures.append('timeout injection/kill/late-output mismatch: '+k)
            if call and call['outcome']!='rejected':self.failures.append('timeout response applied')
        self.world=summary.get('runId',self.root.name)
        return self.verdict()
    def verdict(self):
        status='FAIL' if self.failures else 'BLOCKED' if self.blocked else 'PASS'
        return {'status':status,'world':getattr(self,'world',self.root.name),'mode':self.mode,'counts':dict(self.counts),
                'calls':self.calls,'failures':sorted(set(self.failures)),'blocked':sorted(set(self.blocked)),
                'scope':'logged-world evidence and offline replay; not full G3 or proof for unseen observations',
                'liveRecorderVerified':False,'evidenceSha256':self.hashes}

def audit(root,mode):
    a=Auditor(root,mode)
    try:return a.run()
    except (OSError,ValueError,KeyError,TypeError,AttributeError,subprocess.SubprocessError,IndexError):
        a.blocked.append('malformed evidence or unavailable pinned offline replay; raw error suppressed')
        return a.verdict()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run_dir',type=Path);parser.add_argument('--mode',choices=('on','off'),required=True)
    args=parser.parse_args()
    try: explicit_inputs()
    except ValueError as exc:
        a=Auditor(args.run_dir,args.mode); a.blocked.append('BLOCKED: '+str(exc)); result=a.verdict()
        print(json.dumps(result,indent=2,allow_nan=False));return EXIT['BLOCKED']
    result=audit(args.run_dir,args.mode)
    print(json.dumps(result,indent=2,allow_nan=False));return EXIT[result['status']]
if __name__=='__main__':sys.exit(main())
