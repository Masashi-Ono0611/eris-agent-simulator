import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const base='/tmp/g3-chain',root='/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-r2';
globalThis.fetch=async()=>{throw Error('network forbidden');};
const {runCli}=await import(pathToFileURL(root+'/example/agents/runtime/llm.ts'));
const start=performance.now();let timedOut=false;
try{await runCli(process.execPath,[base+'/timeout-child.cjs',base+'/timeout-child-start.json',base+'/timeout-late-output.txt'],{},300000);}catch(e){timedOut=e.message.includes('timed out after 300000ms');}
const elapsedMs=performance.now()-start;
await new Promise(r=>setTimeout(r,1500));
const {pid}=JSON.parse(readFileSync(base+'/timeout-child-start.json','utf8'));
let exited=false;try{process.kill(pid,0);}catch(e){exited=e.code==='ESRCH';}
const lateOutput=existsSync(base+'/timeout-late-output.txt');
const result={status:timedOut&&exited&&!lateOutput&&elapsedMs>=300000&&elapsedMs<301000?'PASS':'FAIL',
  control:'stock runCli, local 301s child, actual 300s timeout; no provider/network/simulation',elapsedMs,timedOut,childExitObserved:exited,lateOutput,
  liveRevisionLifecycleVerified:false};
writeFileSync(base+'/timeout-control.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=result.status==='PASS'?0:1;
