#!/usr/bin/env python3
"""Local gates. Revision audit is fail-closed; runtime readiness remains separate."""
import argparse, csv, json, math, os, re, shlex, shutil, subprocess, sys
from pathlib import Path
from chain import BASE, SOURCE, VIEW, EVAL, G3, MANIFEST, Stop, clean_env, prestart_gate

def emit(verdict,**fields):
    print(json.dumps({'status':verdict,**fields},indent=2)); return 0 if verdict.startswith('PASS') else 1 if verdict=='FAIL' else 2

def strict_g0(p):
    d=json.loads(Path(p).read_text()); runs=d.get('runs')
    return (d.get('status')=='PASS' and d.get('failed')==[] and d.get('blocked')==[] and d.get('manifest_verified') is True
            and isinstance(runs,list) and len(runs)==1 and all(r.get('status')=='PASS' and r.get('blocks')==360 and r.get('loops')==362
            and type(r.get('p99_ms')) in (float,int) and math.isfinite(r['p99_ms']) and 0<=r['p99_ms']<1000 for r in runs))

def auth():
    binary=shutil.which('claude')
    if not binary: return emit('BLOCKED',reason='claude binary missing')
    binary=str(Path(binary).resolve())
    if not Path(binary).is_file() or not os.access(binary,os.X_OK): return emit('BLOCKED',reason='claude is not an executable file')
    env=clean_env(); env['PATH']=str(Path(binary).parent)+os.pathsep+env.get('PATH','')
    # Capture to memory only. Never print identity, email, tokens, stderr or raw auth output.
    result=subprocess.run([binary,'auth','status','--json'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
    if result.returncode: return emit('BLOCKED',reason='claude auth status nonzero',authExit=result.returncode)
    try: record=json.loads(result.stdout)
    except ValueError: return emit('BLOCKED',reason='auth JSON unavailable')
    if record.get('loggedIn') is not True or record.get('authMethod')!='claude.ai' or record.get('subscriptionType') not in ['pro','max','team','enterprise']:
        return emit('BLOCKED',reason='subscription OAuth not established')
    # Extra usage OFF cannot be inferred from OAuth; no call without explicit future verification.
    # This sentinel is not present or manufactured by this preparation task.
    billing=BASE/'subscription-check.json'
    if not billing.is_file(): return emit('BLOCKED',binary=binary,auth='subscription OAuth',reason='extra-usage OFF/current budget verification absent; probe NOT RUN')
    b=json.loads(billing.read_text())
    import datetime as dt
    stamp=dt.datetime.fromisoformat(b['checkedAt'])
    age=(dt.datetime.now(dt.timezone.utc)-stamp).total_seconds()
    if b.get('extraUsageOff') is not True or b.get('haikuAllowed') is not True or not 0<=age<=3600:
        return emit('BLOCKED',reason='billing/Haiku check absent, stale or invalid')
    # No re-probe on retry, even if an earlier probe crashed. A previous PASS is reusable.
    receipt=BASE/'probe-result.json'
    if receipt.exists():
        old=json.loads(receipt.read_text())
        return emit('PASS' if old.get('status')=='PASS' and old.get('binary')==binary else 'BLOCKED',probe='prior receipt; no new model call')
    claim=BASE/'probe-attempted'
    try: claim.open('x').close()
    except FileExistsError: return emit('BLOCKED',reason='probe already attempted without PASS; no automatic retry')
    env.update(ERIS_RUN_DIR=str(BASE/'probe'),ERIS_AGENT_ID='g3-probe')
    wrapper=SOURCE/'ascon-notes/league/xb-r-live-claude-timed.sh'
    args=[str(wrapper),'-p','Reply exactly OK.','--model','haiku','--max-turns','1','--tools','','--disable-slash-commands','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--no-session-persistence']
    p=subprocess.run(args,cwd=BASE,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=60)
    output={'status':'PASS' if p.returncode==0 and p.stdout.strip()=='OK' else 'FAIL','binary':binary,'probeExit':p.returncode,'rawOutputSaved':False}
    receipt.write_text(json.dumps(output)+'\n')
    return emit(output['status'],binary=binary,auth='subscription OAuth',probeExit=p.returncode,model='haiku',probeCalls=1)


def revision_audit_gate(argv):
    parser=argparse.ArgumentParser()
    parser.add_argument('world');parser.add_argument('mode',choices=('on','off'))
    parser.add_argument('--audit-cmd',default=shlex.join([sys.executable,'-B',str(BASE/'revision_audit.py')]))
    args=parser.parse_args(argv)
    run=Path(args.world)
    if not run.is_absolute():
        if not re.fullmatch(r'[A-Za-z0-9_-]+',args.world): return emit('BLOCKED',reason='invalid world label')
        index=EVAL/'ascon-notes/eval/out'/args.world/'index.tsv'
        with index.open() as stream: rows=list(csv.DictReader(stream,delimiter='\t'))
        if len(rows)!=1 or rows[0].get('exit_code')!='0': return emit('BLOCKED',reason='world index must have exactly one finished run')
        rel=Path(rows[0]['run_dir'])
        if rel.is_absolute() or '..' in rel.parts: return emit('BLOCKED',reason='run path escapes eval')
        run=EVAL/rel
        if not run.resolve().is_relative_to(EVAL.resolve()): return emit('BLOCKED',reason='run path escapes eval')
    argv=shlex.split(args.audit_cmd)
    if not argv:return emit('BLOCKED',reason='empty audit command')
    proc=subprocess.run(argv+[str(run),'--mode',args.mode],capture_output=True,text=True,env=clean_env(),timeout=2400)
    try: result=json.loads(proc.stdout)
    except ValueError:return emit('BLOCKED',reason='auditor produced no valid JSON')
    status=result.get('status');expected={'PASS':0,'FAIL':1,'BLOCKED':2}
    if status not in expected or proc.returncode!=expected[status]:return emit('BLOCKED',reason='audit exit/verdict disagreement')
    # A hook is executable trusted code, not a PASS-file escape hatch. Require the audit protocol.
    if not isinstance(result.get('counts'),dict) or not isinstance(result.get('calls'),list):return emit('BLOCKED',reason='audit protocol missing counts/call ledger')
    if status=='PASS' and (result.get('blocked')!=[] or result.get('failures')!=[] or not result.get('evidenceSha256')):
        return emit('BLOCKED',reason='PASS without complete evidence')
    print(json.dumps(result,indent=2));return expected[status]

def main():
    action=sys.argv[1]
    if action=='prestart':
        d=json.loads(Path(sys.argv[2]).read_text()); rc=int(Path(sys.argv[3]).read_text())
        ok=prestart_gate(d,rc)
        return emit('PASS_F_REF_ONLY' if ok else 'BLOCKED',exemption='ONLY exact F_mix missing fixed-bid-5gwei completeness item',otherFailures=[k for k,v in d.get('checks',{}).items() if not v.get('pass') and k!='completeness'],remainingBlocked=[x for x in d.get('checks',{}).get('completeness',{}).get('blocked',[]) if x!='fixed-bid-5gwei implementation/configuration absent; both F_mix rosters intentionally invalid'])
    if action=='strict-g0': return emit('PASS' if strict_g0(sys.argv[2]) else 'FAIL',required='360 blocks, 362 loops, p99 strictly <1000ms, manifest verified, zero G0 failures')
    if action=='auth': return auth()
    if action=='revision-audit': return revision_audit_gate(sys.argv[2:])
    if action=='runtime-ready':
        # Deliberately no --skip-audit / user-written PASS JSON escape hatch.
        # A generic slippage script or outcome counter cannot certify all code/actions.
        return emit('BLOCKED',reason='Offline auditor implemented; live full-frame recorder and isolated eval dependencies/state not validated; no safe automatic continuation',
                    isolatedEvalExists=EVAL.is_dir(),isolatedStateExists=(EVAL/'backtest/state').is_dir(),
                    required=['all raw calls and unfinished calls','60-block cadence/in-flight <=1/300s','ON completed cycles >=3; OFF calls=0','100% code/type/economic safety diffs','actual first execution version','return and ctx.submit actions, balances and receipts','zero mined reverts/violations/unsafe attempts','consecutive rejections/quota/late apply'],
                    existingTools=['round-manifest.py','g0.py','g0_contract.py','degradation-gate.py','league-report.py','g3/harness.mjs'],
                    insufficientTool='ascon-notes/eval/audit-xb-r-slippage.py (old dev2/dev3 proxy audit, not r2 full audit)')
    return emit('BLOCKED',reason='unknown gate')

if __name__=='__main__':
    try: sys.exit(main())
    except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError):
        sys.exit(emit('BLOCKED',reason='gate error or missing/malformed evidence; raw error suppressed'))
