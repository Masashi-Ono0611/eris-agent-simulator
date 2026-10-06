import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const root='/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-r2';
const {StrategyRunner}=await import(pathToFileURL(root+'/example/agents/runtime/strategyRunner.ts'));
const runner=new StrategyRunner({kind:'executor',source:"ctx.submit({type:'noop'}); while(true) {}"},
 {agentId:'g3-offline',address:'0x0000000000000000000000000000000000000001',config:{chainId:31337},rpcUrl:'http://127.0.0.1:1'},()=>{});
let result;
try{
 await runner.start();const started=performance.now();let timedOut=false;
 try{await runner.decide({round:1});}catch(e){timedOut=e.name==='DecideTimeoutError';}
 const elapsedMs=performance.now()-started;
 runner.setSource({kind:'executor',source:'return null;'});
 const recovered=await runner.decide({round:2});
 result={status:timedOut&&elapsedMs>=5000&&elapsedMs<6000&&recovered.action===null&&recovered.submitted.length===0?'PASS':'FAIL',
  control:'stock StrategyRunner actual 5000ms timeout, buffered submit discarded, new safe executor',elapsedMs,timedOut,submissionsAfterRecovery:recovered.submitted.length,liveRevisionLifecycleVerified:false};
}finally{await runner.close();}
writeFileSync('/tmp/g3-chain/decide-budget-control.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=result.status==='PASS'?0:1;
