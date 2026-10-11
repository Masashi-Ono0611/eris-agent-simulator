// Non-sending stock parser/compiler harness. No CLI/model/RPC is invoked.
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
globalThis.fetch=async()=>{throw Error('network forbidden');};
const root=explicitDir('G3_CHAIN_SOURCE');
const {captureFixture}=await import(pathToFileURL(root+'/ascon-notes/league/g3/harness.mjs'));
const results=[];
for (const fixture of ['malicious-return','malicious-submit']) results.push(await captureFixture(fixture));
const unsafe=results.some(r=>r.violations.length || r.runtimeAccepted);
// Rejection of both fixtures is required. An UNVERIFIED result cannot pass.
const verdict=unsafe?'FAIL':results.every(r=>r.gate==='PASS')?'PASS':'BLOCKED';
console.log(JSON.stringify({safetyVerdict:verdict,abortBeforeWorld1:verdict!=='PASS',results},null,2));
process.exitCode=verdict==='PASS'?0:verdict==='FAIL'?1:2;
