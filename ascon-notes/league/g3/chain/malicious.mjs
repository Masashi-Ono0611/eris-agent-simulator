// Non-sending stock parser/compiler harness. No CLI/model/RPC is invoked.
import {pathToFileURL} from 'node:url';
globalThis.fetch=async()=>{throw Error('network forbidden');};
const root='/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-r2';
const {captureFixture}=await import(pathToFileURL(root+'/ascon-notes/league/g3/harness.mjs'));
const results=[];
for (const fixture of ['malicious-return','malicious-submit']) results.push(await captureFixture(fixture));
const unsafe=results.some(r=>r.violations.length || r.runtimeAccepted);
// Rejection of both fixtures is required. An UNVERIFIED result cannot pass.
const verdict=unsafe?'FAIL':results.every(r=>r.gate==='PASS')?'PASS':'BLOCKED';
console.log(JSON.stringify({safetyVerdict:verdict,abortBeforeWorld1:verdict!=='PASS',results},null,2));
process.exitCode=verdict==='PASS'?0:verdict==='FAIL'?1:2;
