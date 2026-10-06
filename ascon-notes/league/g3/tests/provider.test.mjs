import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {callLlm,runCli,resolveLlmProvider} from '../../../../example/agents/runtime/llm.ts';
import {parseRevision,compileExecutor} from '../../../../example/agents/runtime/improve.ts';
import {StrategyRunner} from '../../../../example/agents/runtime/strategyRunner.ts';
import {captureFixture,fixture,observation,parsedExecutor,auditAction} from '../harness.mjs';
const bin=resolve('ascon-notes/league/g3/fake-claude.py');
const request={model:'claude-cli:haiku',system:'dummy offline only',messages:[{role:'user',content:'dummy'}]};
process.env.ERIS_CLAUDE_BIN=bin;
// Guard accidental HTTP calls in this parent, even if provider selection regresses.
globalThis.fetch=async()=>{throw Error('NETWORK DISABLED in G3 offline test');};
function fake(caseName) {process.env.G3_FAULT_CASE=caseName;return callLlm(request);}

test('existing CLI hook: malicious/invalid/empty/quota/null and bad revisions',async()=>{
  assert.deepEqual(resolveLlmProvider(request.model),{kind:'claude-cli',model:'haiku'});
  // There is no fake prefix: inventing one would select Ollama.
  assert.deepEqual(resolveLlmProvider('fake:malicious'),{kind:'ollama'});
  parsedExecutor(await fake('malicious'));
  for(const c of ['invalid','empty'])await assert.rejects(fake(c),/no JSON object/);
  await assert.rejects(fake('quota'),/synthetic quota exhausted 429/);
  for(const c of ['wrong-type','empty-executor'])assert.equal(parseRevision(JSON.parse(await fake(c))).ok,false);
  const nil=parseRevision(JSON.parse(await fake('null')));assert.equal(nil.ok,true);assert.equal(nil.revision.executorTs,null);
  const imp=parseRevision(JSON.parse(await fake('import-body')));assert.equal(imp.ok,true);assert.equal(compileExecutor(imp.revision.executorTs).ok,false);
  const unknown=parseRevision(JSON.parse(await fake('unknown-revert')));
  assert.equal(unknown.ok,true);assert.equal(unknown.revision.revertTo,999);
  // Version existence is checked in botMain.maybeRevise, not parseRevision.
});

test('short delayed/timeout hooks and controlled replay sequence (synthetic unit only)',async()=>{
  process.env.G3_UNIT_TIME_SCALE='0.001';
  process.env.G3_FAULT_REPLY=resolve('ascon-notes/league/g3/fixtures/unit-change.json');
  const before=performance.now();parsedExecutor(await fake('delayed'));
  assert.ok(performance.now()-before>=130);
  const env={PATH:process.env.PATH,G3_FAULT_CASE:'timeout',G3_UNIT_TIME_SCALE:'0.01'};
  await assert.rejects(runCli(bin,[],env,80),/timed out after 80ms/);
  const dir=mkdtempSync(join(tmpdir(),'g3-counter-'));
  try {
    process.env.G3_FAULT_COUNTER=join(dir,'counter');
    parsedExecutor(await fake('change-revert'));
    assert.equal(JSON.parse(await fake('change-revert')).revertTo,0);
    assert.equal(JSON.parse(await fake('change-revert')).executorTs,null);
  } finally {rmSync(dir,{recursive:true,force:true});delete process.env.G3_FAULT_COUNTER;delete process.env.G3_FAULT_REPLY;delete process.env.G3_UNIT_TIME_SCALE;}
  await assert.rejects(fake('change-revert'),/no fallback/);
});

test('malicious lawful schema accepted by stock compiler, unsafe return AND submit captured',async()=>{
  for(const route of ['return','submit']) {
    const r=await captureFixture('malicious-'+route);
    assert.equal(r.runtimeAccepted,true);assert.equal(r.gate,'FAIL');
    assert.equal(r.violations.length,2);
    assert.equal(r.submitted.length,route==='submit'?1:0);
  }
});

test('stock StrategyRunner setSource executes both malicious routes; no sender exists',async()=>{
  const context={agentId:'g3-offline',address:'0x0000000000000000000000000000000000000001',config:{chainId:31337},rpcUrl:'http://127.0.0.1:1'};
  const runner=new StrategyRunner({kind:'executor',source:'return null;'},context,()=>{},500,5000);
  try {
    assert.equal((await runner.decide(observation)).action,null);
    for (const route of ['return','submit']) {
      runner.setSource({kind:'executor',source:JSON.parse(fixture('malicious-'+route)).executorTs});
      const r=await runner.decide(observation);
      const actions=[...r.submitted,...(r.action?[r.action]:[])];
      assert.equal(actions.length,1);assert.equal(auditAction(actions[0]).length,2);
    }
    runner.setSource({kind:'executor',source:'return null;'});
    const restored=await runner.decide({...observation,round:360});
    assert.equal(restored.action,null);assert.deepEqual(restored.submitted,[]);
  } finally {await runner.close();}
});
