import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {realpathSync,statSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
// Required explicit input (same names as chain.py). No default; no fallback to an earlier
// round's worktree or the old /tmp base. Missing/empty, relative, under /tmp or /var/tmp,
// or absent directory exits 2 before anything is imported or written.
const explicitDir=name=>{
 const stop=m=>{console.error('BLOCKED: '+name+' '+m);process.exit(2);};
 const value=process.env[name];
 if(!value) stop('missing or empty; explicit value required (no default)');
 if(!isAbsolute(value)) stop('must be an absolute path');
 const temp=p=>['/tmp','/var/tmp','/private/tmp','/private/var/tmp'].some(r=>p===r||p.startsWith(r+'/'));
 if(temp(resolve(value))) stop('must not be under /tmp or /var/tmp');
 let real;try{real=realpathSync(value);}catch{stop('does not exist or is not a directory');}
 if(temp(real)) stop('must not be under /tmp or /var/tmp');
 if(!statSync(real).isDirectory()) stop('does not exist or is not a directory');
 return value;
};
const root=explicitDir('G3_CHAIN_SOURCE'),base=explicitDir('G3_CHAIN_BASE');
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
writeFileSync(base+'/decide-budget-control.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=result.status==='PASS'?0:1;
