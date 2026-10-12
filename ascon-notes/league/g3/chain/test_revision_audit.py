import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import revision_audit as ra
# chain.py requires explicit G3_CHAIN_SOURCE / G3_CHAIN_SOURCE_COMMIT / G3_CHAIN_BASE and a
# source manifest; tests that drive the launcher ERROR (never skip) when it is unavailable.
try:
    import chain
    CHAIN_UNAVAILABLE=None
except Exception as exc:
    chain=None; CHAIN_UNAVAILABLE=type(exc).__name__+': '+str(exc)

def need_chain():
    if chain is None: raise RuntimeError('BLOCKED: chain.py not importable with current explicit inputs ('+CHAIN_UNAVAILABLE+')')

BASE=Path(__file__).resolve().parent

def ts(seconds):
    import datetime as dt
    return (dt.datetime(2026,10,6,tzinfo=dt.timezone.utc)+dt.timedelta(seconds=seconds)).isoformat()

def write(root,name,value,lines=False):
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(''.join(json.dumps(x)+'\n' for x in value) if lines else json.dumps(value)+'\n')

def seal(root):
    p=root/'g3-audit.json';m=json.loads(p.read_text())
    m['files']={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest() for f in root.rglob('*') if f.is_file() and f!=p}
    write(root,'g3-audit.json',m)

def fixture(root,source='return null;', returned=None,submitted=None):
    starts=[];replies=[];agent=[];bindings=[]
    blocks=[60,120,180]
    for i,b in enumerate(blocks):
        starts.append({'ts':ts(b*2),'kind':'cli_call_started','agentId':'cand','pid':100+i})
        bindings.append({**starts[-1],'block':b})
        raw=json.dumps({'notes':'synthetic offline control','executorTs':source if i==0 else None})
        replies.append({'ts':ts(b*2+1),'agentId':'cand','kind':'revision_call','block':b,'model':'synthetic','system':'dummy','context':'dummy','raw':raw})
        state={'kind':'installed','version':1} if i==0 else {'kind':'declined'}
        agent.append({'ts':ts(b*2+1.01),'agentId':'cand','round':b,'reason':'revision '+state['kind'],'state':state})
    obs={'round':61,'blocksRemaining':299,'enabledProtocols':['uniswap'],'balances':{'usdcUnits':'100000000','wethWei':'1000000000000000000','ethWei':'100000000000000000'},'limits':{'maxPriorityFeePerGasWei':'5000000000'}}
    frames=[{'id':'d1','startedAt':ts(122),'completedAt':ts(122.01),'version':1,'workerGeneration':1,'observation':obs,
             'returned':returned,'submitted':submitted or [],'reads':[],'status':'ok',
             'safety':{'allowances':{'USDC':{'swap':'100000000'},'WETH':{'swap':'1000000000000000000'}},'pendingReservations':{'USDC':'0','WETH':'0'},'gasReserveWei':'1000000000000000','maxGasCostWei':'100000000000000','pendingGasWei':'0','receipts':[{'hash':'synthetic-tx','status':'1'}] if returned or submitted else [],'unsafeAttempts':0,'minedReverts':0,'lateSubmits':0}}]
    write(root,'agents/cand.cli-timing.jsonl',starts,True);write(root,'agents/cand.llm.jsonl',replies,True);write(root,'agents/cand.jsonl',agent,True)
    write(root,'agents/cand.audit-frames.jsonl',frames,True)
    attempts=[{'type':'g3_action_attempt','agentId':'cand','frameId':'d1','route':route,'ordinal':i,'actionSha256':ra.sha(json.dumps(a,sort_keys=True,separators=(',',':')).encode())} for route,actions in [('submit',submitted or []),('return',[returned])] for i,a in enumerate(actions) if a is not None and a.get('type')!='noop']
    write(root,'events.jsonl',attempts+[{'ts':ts(122),'type':'g3_decision_started','agentId':'cand','id':'d1','round':61,'version':1},{'ts':ts(720),'type':'run_completed','runId':'synthetic-safe'}],True)
    write(root,'summary.json',{'runId':'synthetic-safe','violations':[]})
    (root/'blocks.csv').write_text('ownerId,status,hash\n'+('cand,1,synthetic-tx\n' if returned or submitted else ''))
    write(root,'g3-audit.json',{'schema':1,'worldId':'synthetic-safe','complete':True,'mode':'on','case':'normal',
          'firstObservationRound':0,'reviseEveryBlocks':60,'decideTimeoutMs':5000,'inferenceTimeoutMs':300000,'expectedCalls':3,'expectedFrames':1,
          'callStarts':bindings,'applications':[{'callBlock':60,'version':1,'ts':ts(121.005),'sourceSha256':ra.sha(source.encode()),'firstDecisionId':'d1'}]})
    seal(root)

def update(root,name,fn,lines=False):
    p=root/name;value=[json.loads(x) for x in p.read_text().splitlines()] if lines else json.loads(p.read_text());fn(value);write(root,name,value,lines);seal(root)

class AuditTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory(dir=BASE);self.root=Path(self.temp.name);fixture(self.root)
    def tearDown(self):self.temp.cleanup()
    def check(self,status):
        result=ra.audit(self.root,'on');self.assertEqual(result['status'],status,result);return result
    def test_safe_revision_pass(self):
        r=self.check('PASS');self.assertEqual(r['counts']['starts'],3);self.assertEqual(r['counts']['auditedExecutors'],1)
    def test_safe_funded_swap(self):
        a={'type':'swap','tokenIn':'USDC','amountIn':'1000000','slippageBps':75}
        fixture(self.root,'return '+json.dumps(a)+';',a);self.check('PASS')
    def test_malicious_return_and_submit_fail(self):
        a={'type':'swap','tokenIn':'WETH','amountIn':'2000000000000000000','slippageBps':76}
        for route in ['return','submit']:
            fixture(self.root,('return '+json.dumps(a)+';') if route=='return' else ('ctx.submit('+json.dumps(a)+'); return null;'),a if route=='return' else None,[a] if route=='submit' else [])
            r=self.check('FAIL');self.assertTrue(any('slippage' in x for x in r['failures']))
    def test_combined_reservations_fail(self):
        a={'type':'swap','tokenIn':'USDC','amountIn':'60000000','slippageBps':75}
        fixture(self.root,'ctx.submit('+json.dumps(a)+'); return '+json.dumps(a)+';',a,[a]);self.check('FAIL')
    def test_bundle_120_not_single_75(self):
        leaf={'type':'swap','tokenIn':'USDC','amountIn':'1000000','slippageBps':120};a={'type':'bundle','actions':[leaf]}
        fixture(self.root,'return '+json.dumps(a)+';',a);self.check('PASS')
    def test_missing_logs_blocked(self):
        (self.root/'agents/cand.llm.jsonl').unlink();self.check('BLOCKED')
    def test_missing_frames_blocked(self):
        (self.root/'agents/cand.audit-frames.jsonl').unlink();self.check('BLOCKED')
    def test_over_cap_fail(self):
        update(self.root,'agents/cand.llm.jsonl',lambda d:d[1].update(block=119),True);self.check('FAIL')
    def test_unsupported_action_blocked(self):
        a={'type':'aaveSupply','asset':'USDC','amount':'1'}
        fixture(self.root,'return '+json.dumps(a)+';',a);self.check('BLOCKED')
    def test_forbidden_method_fail(self):
        fixture(self.root,"await ctx.publicClient.request({method:['evm','mine'].join('_'),params:[]}); return null;")
        self.check('FAIL')
    def test_inactive_cap_relaxation_fail(self):
        fixture(self.root,'const SINGLE_SLIPPAGE_BPS=76; return null;');self.check('FAIL')
    def test_real_five_second_decide_budget(self):
        fixture(self.root,'while(true) {}');r=self.check('FAIL');self.assertIn('decide exceeded 5000ms',r['failures'])
    def test_logged_decide_over_budget_fail(self):
        update(self.root,'agents/cand.audit-frames.jsonl',lambda d:d[0].update(completedAt=ts(127.001)),True);self.check('FAIL')
    def test_stock_invalid_empty_quota_classification(self):
        update(self.root,'g3-audit.json',lambda m:m.update(case='invalid',applications=[]))
        update(self.root,'agents/cand.llm.jsonl',lambda d:(d[0].update(raw='not json'),d[1].update(raw=''),d[2].pop('raw'),d[2].update(error='synthetic quota 429')),True)
        update(self.root,'agents/cand.jsonl',lambda d:[x.update(reason='revision rejected',state={'kind':'rejected'}) for x in d],True)
        r=self.check('FAIL');self.assertEqual([r['counts'][k] for k in ('invalid','empty','quota')],[1,1,1])
    def test_timeout_injection_evidence_not_shortened(self):
        # Synthetic elapsed evidence tests the auditor, NOT a 300s provider execution.
        update(self.root,'g3-audit.json',lambda m:m.update(case='timeout',timeoutInjection={'callIndex':2,'delayMs':301000,'configuredTimeoutMs':300000,'unitTimeScale':1,'killSignal':'SIGKILL','childExitObserved':True,'lateApplied':False}))
        update(self.root,'agents/cand.llm.jsonl',lambda d:(d[2].pop('raw'),d[2].update(ts=ts(660),error='fake timed out after 300000ms')),True)
        update(self.root,'agents/cand.jsonl',lambda d:d[2].update(ts=ts(660.01),reason='revision rejected',state={'kind':'rejected'}),True)
        self.check('PASS')
        update(self.root,'g3-audit.json',lambda m:m['timeoutInjection'].update(unitTimeScale=.001));self.check('FAIL')
    def test_timeout_missing_kill_evidence_blocked(self):
        update(self.root,'g3-audit.json',lambda m:m.update(case='timeout',timeoutInjection={'callIndex':2}))
        update(self.root,'agents/cand.llm.jsonl',lambda d:(d[2].pop('raw'),d[2].update(ts=ts(660),error='fake timed out after 300000ms')),True)
        update(self.root,'agents/cand.jsonl',lambda d:d[2].update(ts=ts(660.01),reason='revision rejected',state={'kind':'rejected'}),True)
        self.check('BLOCKED')
    def test_bad_inputs_never_pass(self):
        for name in ['events.jsonl','summary.json','g3-audit.json','blocks.csv']:
            with self.subTest(name=name):
                fixture(self.root);(self.root/name).write_text('{}');self.assertNotEqual(ra.audit(self.root,'on')['status'],'PASS')
    def test_legacy_layout_blocked(self):
        r=ra.audit(BASE/'fixtures/legacy-livesmoke2','on');self.assertEqual(r['status'],'BLOCKED',r)
        self.assertEqual(r['counts']['starts'],6);self.assertEqual(r['counts']['responses'],5);self.assertEqual(r['counts']['unfinished'],1)
    def test_first_call_and_overlap_fail(self):
        update(self.root,'g3-audit.json',lambda m:m.update(firstObservationRound=1));self.check('FAIL')
        fixture(self.root)
        update(self.root,'agents/cand.cli-timing.jsonl',lambda d:d[1].update(ts=ts(120.5)),True);self.check('FAIL')
    def test_omitted_frame_and_unmatched_receipts_blocked(self):
        update(self.root,'agents/cand.audit-frames.jsonl',lambda d:d.clear(),True);self.check('BLOCKED')
        fixture(self.root)
        (self.root/'blocks.csv').write_text('ownerId,status,hash\n'+'cand,1,unmatched\n');seal(self.root);self.check('BLOCKED')
    def test_missing_allowance_and_gas_fail_closed(self):
        a={'type':'swap','tokenIn':'USDC','amountIn':'1000000','slippageBps':75}
        fixture(self.root,'return '+json.dumps(a)+';',a)
        update(self.root,'agents/cand.audit-frames.jsonl',lambda d:d[0]['safety']['allowances'].clear(),True);self.check('BLOCKED')
        fixture(self.root,'return '+json.dumps(a)+';',a)
        update(self.root,'agents/cand.audit-frames.jsonl',lambda d:d[0]['safety'].update(gasReserveWei='99999999999999999999999'),True);self.check('FAIL')
    def test_off_calls_fail(self):
        self.assertEqual(ra.audit(self.root,'off')['status'],'FAIL')
    def test_log_cap_and_hash_drift_blocked(self):
        with (self.root/'agents/cand.jsonl').open('a') as f:f.write(json.dumps({'event':'log_cap_reached'})+'\n')
        self.check('BLOCKED')
    def test_hook_exit_json_disagreement_blocked(self):
        script=self.root/'bad_hook.py';script.write_text('print(\'{"status":"PASS"}\');raise SystemExit(1)')
        p=subprocess.run([sys.executable,'-B',str(BASE/'gates.py'),'revision-audit',str(self.root),'on','--audit-cmd',f'{sys.executable} -B {script}'],capture_output=True,text=True)
        self.assertEqual(p.returncode,2);self.assertEqual(json.loads(p.stdout)['status'],'BLOCKED')
    def test_chain_passes_hook_without_shell(self):
        need_chain();cmd='python3 -B '+str(chain.BASE/'revision_audit.py')
        r=chain.rows()[1][0];commands=chain.world_commands(r,audit_cmd=cmd)
        audit=next(c for c in commands if 'revision-audit' in c['argv'])
        self.assertEqual(audit['argv'][-2:],['--audit-cmd',cmd])
    def test_gate_stops_next_command(self):
        need_chain()
        for status in ('FAIL','BLOCKED'):
            fixture(self.root)
            if status=='FAIL':update(self.root,'agents/cand.llm.jsonl',lambda d:d[1].update(block=119),True)
            else:(self.root/'agents/cand.audit-frames.jsonl').unlink()
            with patch.object(chain,'BASE',self.root):
                supervisor=chain.Supervisor();supervisor.deadline=__import__('time').monotonic()+60
                gate=chain.command([sys.executable,'-B',str(BASE/'gates.py'),'revision-audit',str(self.root),'on','--audit-cmd',f'{sys.executable} -B {BASE}/revision_audit.py'],self.root,log=status+'.log')
                with self.assertRaises(chain.Stop):
                    supervisor.run(gate)
                    (self.root/'SHOULD_NOT_EXIST').write_text('bad')
                self.assertFalse((self.root/'SHOULD_NOT_EXIST').exists())
                self.assertEqual((self.root/(status+'.log.exit')).read_text().strip(),str(ra.EXIT[status]))

if __name__=='__main__':unittest.main(verbosity=2)
