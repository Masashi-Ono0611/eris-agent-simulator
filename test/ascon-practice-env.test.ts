import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPracticeEnv } from '../ascon-notes/practice/env.js';
import { headerStatus } from '../ascon-notes/practice/check-practice.js';

const base = ['ASCON_RPC_URL=https://ascon-rpc.nyx.foundation/','ASCON_CHAIN_ID=31337','ASCON_HEADER_1_NAME=X-ASCON-Key','ASCON_HEADER_1_VALUE=secret-one','ASCON_HEADER_2_NAME=CF-Access-Client-Id','ASCON_HEADER_2_VALUE=secret-two','ASCON_HEADER_3_NAME=CF-Access-Client-Secret','ASCON_HEADER_3_VALUE=secret-three','AGENT_PRIVATE_KEY=0x'+'1'.repeat(64)].join('\n');

test('practice env validates required and malformed values without echoing secrets', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ascon-env-')), file=join(dir,'.env.practice');
  await writeFile(file,base.replace('ASCON_HEADER_2_VALUE=secret-two',''));
  await assert.rejects(loadPracticeEnv(file),e=>{assert.match(String(e),/ASCON_HEADER_2_VALUE/);assert.doesNotMatch(String(e),/secret/);return true;});
  await writeFile(file,base.replace('ASCON_CHAIN_ID=31337','ASCON_CHAIN_ID=nope'));
  await assert.rejects(loadPracticeEnv(file),e=>{assert.match(String(e),/ASCON_CHAIN_ID/);assert.doesNotMatch(String(e),/secret/);return true;});
});

test('wallet-new writes mode 600 and never prints key', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ascon-wallet-')), file=join(dir,'.env.wallet.local');
  const result=spawnSync('node',['--import','tsx','--input-type=module','-e',`import {createWallet} from ${JSON.stringify(resolve('ascon-notes/practice/wallet-new.ts'))}; console.log(await createWallet(${JSON.stringify(file)}))`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const stored=await readFile(file,'utf8');
  const key=stored.match(/0x[0-9a-f]{64}/)?.[0]; assert.ok(key); assert.ok(!result.stdout.includes(key));
  assert.equal((await stat(file)).mode & 0o777,0o600);
});

test('missing practice headers are BLOCKED',()=>{
  assert.equal(headerStatus({}).status,'BLOCKED');
});
