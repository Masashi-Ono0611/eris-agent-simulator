import assert from 'node:assert/strict';
import test from 'node:test';
import { guardedFetch, practiceTransport, rpc } from '../ascon-notes/practice/transport.js';

const forbidden = ['anvil_setBalance','evm_mine','eth_sendTransaction','txpool_status','eth_subscribe','debug_traceTransaction','eth_unknown'];
test('forbidden RPC sends zero bytes through every practice transport entry', async () => {
  let calls = 0;
  const fake = (async () => { calls++; return new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', { status: 200 }); }) as typeof fetch;
  for (const method of forbidden) {
    await assert.rejects(() => rpc('https://fixture.invalid', method, [], {}, fake));
    await assert.rejects(() => guardedFetch(fake)('https://fixture.invalid', { method:'POST', body:JSON.stringify({jsonrpc:'2.0',method,params:[]}) }));
    const request = practiceTransport('https://fixture.invalid', {}, fake)({}).request;
    await assert.rejects(() => request({method} as never));
  }
  assert.equal(calls, 0);
});
test('whole mixed batch is blocked before first request; malformed body fails closed', async () => {
  let calls=0;
  const fake=(async () => { calls++; return new Response('{}'); }) as typeof fetch;
  const send=guardedFetch(fake);
  await assert.rejects(() => send('https://fixture.invalid',{method:'POST',body:JSON.stringify([{method:'eth_blockNumber'},{method:'evm_mine'}])}));
  await assert.rejects(() => send('https://fixture.invalid',{method:'POST',body:'bad JSON'}));
  assert.equal(calls,0);
});
test('allowed reads and signed sends reach fake transport', async () => {
  let calls=0;
  const fake=(async () => { calls++; return new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}',{status:200}); }) as typeof fetch;
  for(const method of ['eth_blockNumber','eth_getBalance','eth_call','eth_getTransactionCount','eth_sendRawTransaction']) {
    assert.equal((await rpc('https://fixture.invalid',method,[],{},fake)).status,200);
  }
  assert.equal(calls,5);
});

test('runtime preload also guards upstream viem HTTP and Request bodies', async () => {
  const original = globalThis.fetch;
  let calls=0;
  globalThis.fetch=(async () => { calls++; return new Response('{}'); }) as typeof fetch;
  try {
    await import('../ascon-notes/practice/rpc-guard.js');
    const { http }=await import('viem');
    const transport=http('https://fixture.invalid',{retryCount:0})({});
    await assert.rejects(() => transport.request({method:'debug_traceTransaction'} as never));
    await assert.rejects(() => globalThis.fetch(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({method:'evm_mine'})})));
    await assert.rejects(() => globalThis.fetch('https://fixture.invalid',{method:'GET',body:JSON.stringify({method:'evm_mine'})}));
    assert.equal(calls,0);
  } finally { globalThis.fetch=original; }
});
