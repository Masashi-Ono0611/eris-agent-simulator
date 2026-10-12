import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
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
const base=explicitDir('G3_CHAIN_BASE'),root=explicitDir('G3_CHAIN_SOURCE');
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
