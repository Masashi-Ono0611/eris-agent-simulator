import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPracticeEnv } from '../ascon-notes/practice/env.js';
import { headerStatus, resultsExitCode } from '../ascon-notes/practice/check-practice.js';

const base = ['ASCON_RPC_URL=https://ascon-rpc.nyx.foundation/','ASCON_CHAIN_ID=31337','ASCON_HEADER_1_NAME=X-ASCON-Key','ASCON_HEADER_1_VALUE=secret-one','ASCON_HEADER_2_NAME=CF-Access-Client-Id','ASCON_HEADER_2_VALUE=secret-two','ASCON_HEADER_3_NAME=CF-Access-Client-Secret','ASCON_HEADER_3_VALUE=secret-three','AGENT_PRIVATE_KEY=0x'+'1'.repeat(64)].join('\n');

test('practice env validates required and malformed values without echoing secrets', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ascon-env-')), file=join(dir,'.env.practice');
  try {
    await writeFile(file,base.replace('ASCON_HEADER_2_VALUE=secret-two',''));
    await assert.rejects(loadPracticeEnv(file),e=>{assert.match(String(e),/ASCON_HEADER_2_VALUE/);assert.doesNotMatch(String(e),/secret/);return true;});
    await writeFile(file,base.replace('ASCON_CHAIN_ID=31337','ASCON_CHAIN_ID=nope'));
    await assert.rejects(loadPracticeEnv(file),e=>{assert.match(String(e),/ASCON_CHAIN_ID/);assert.doesNotMatch(String(e),/secret/);return true;});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('wallet-new writes mode 600 and never prints key', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ascon-wallet-')), file=join(dir,'.env.wallet.local');
  try {
    const result=spawnSync('node',['--import','tsx','--input-type=module','-e',`import {createWallet} from ${JSON.stringify(resolve('ascon-notes/practice/wallet-new.ts'))}; console.log(await createWallet(${JSON.stringify(file)}))`],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const stored=await readFile(file,'utf8');
    const key=stored.match(/0x[0-9a-f]{64}/)?.[0]; assert.ok(key); assert.ok(!result.stdout.includes(key)); assert.ok(!result.stderr.includes(key));
    assert.equal((await stat(file)).mode & 0o777,0o600);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('missing practice headers are BLOCKED',()=>{
  assert.equal(headerStatus({}).status,'BLOCKED');
});

test('practice exit codes distinguish FAIL, BLOCKED and PASS',()=>{
  const row=(status:'PASS'|'FAIL'|'BLOCKED')=>({name:'stub',status,detail:''});
  assert.equal(resultsExitCode([row('PASS')]),0);
  assert.equal(resultsExitCode([row('PASS'),row('BLOCKED')]),2);
  assert.equal(resultsExitCode([row('BLOCKED'),row('FAIL')]),1);
  assert.equal(resultsExitCode([row('FAIL'),row('BLOCKED')]),1);
});

test('practice CLI with missing config exits BLOCKED offline',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ascon-practice-cli-'));
  try {
    const env={...process.env};
    for(const key of Object.keys(env)) if(key.startsWith('ASCON_') || key==='AGENT_PRIVATE_KEY') delete env[key];
    const result=spawnSync('node',['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('ascon-notes/practice/check-practice.ts')],{cwd:dir,env,encoding:'utf8'});
    assert.equal(result.status,2,result.stderr);
    assert.match(result.stdout,/BLOCKED/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
