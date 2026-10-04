import { safeAction, single, W } from './xb-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AgentObservation } from '@eris/sdk';
import * as xb from '../example/agents/xb-r/agent.js';
const { UNISWAP, BALANCER, MARKET_LEGS } = await import('@eris/sdk/constants.js');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/xb-r-dev4-v5.json', import.meta.url), 'utf8'));

function replay(f: any, p: xb.Params): xb.Action {
  const bids = new Map<string, bigint>();
  for (const tx of f.transactions) {
    const target = tx.method === 'exactInputSingle' ? UNISWAP.swapRouter : tx.method === 'swap' ? BALANCER.vault
      : tx.method === 'exchange' && tx.receiptBase ? MARKET_LEGS.curve[tx.receiptBase]?.pool : undefined;
    if (target && BigInt(tx.priorityFeeWei) > (bids.get(target.toLowerCase()) ?? 0n))
      bids.set(target.toLowerCase(), BigInt(tx.priorityFeeWei));
  }
  return xb.selectCandidate(f.observation, xb.enumerateCandidates(f.observation, p, new Set(f.cooling)), p, bids);
}

test('V5 defaults enable only R9 and preserve a frozen independent v3 profile', () => {
  assert.equal(xb.PARAMS.R9_BUNDLE_HEADROOM, true);
  assert.equal(xb.V3_PARAMS.R9_BUNDLE_HEADROOM, false);
  assert.deepEqual({ ...xb.PARAMS, R9_BUNDLE_HEADROOM: false }, xb.V3_PARAMS);
  assert.equal(Object.isFrozen(xb.PARAMS), true);
  assert.equal(Object.isFrozen(xb.V3_PARAMS), true);
  assert.equal(xb.PARAMS.ENTRY_BPS, 50);
  for (const p of [xb.V3_PARAMS, xb.DEV3A_PARAMS, xb.DEV2_PARAMS]) {
    for (const key of ['R9_BUNDLE_HEADROOM', 'R10_FULL_DEPTH_SIZE', 'R11_SMALL_SINGLE_CAP', 'R12_UNCONFIRMED_BACKOFF', 'R13_EDGE_SLIPPAGE'] as const)
      assert.equal(p[key], false, key);
  }
});

for (const f of fixture.frames) test(`V5 logged ${f.name} reproduces v3 OFF and the R9-only golden`, () => {
  assert.equal(fixture.sourceCommit, 'd30cbbb46ca472b5a7a72fc1b99deab96dc97bf3');
  assert.equal(fixture.sourceSha256, '78d8fa43156cee872e1bcbcaf86c1da00f1aa1646c6b210e7af4b499edea4d04');
  assert.deepEqual(replay(f, xb.V3_PARAMS), f.expectedV3);
  assert.deepEqual(replay(f, { ...xb.PARAMS, R9_BUNDLE_HEADROOM: false }), f.expectedV3);
  const on = replay(f, xb.PARAMS);
  assert.deepEqual(on, f.expectedProbes.R9);
  safeAction(f.observation, on);
  if (f.name === 'matched-inventory') {
    assert.ok(f.loggedNoop && f.inventoryBlocked);
    assert.ok(f.referenceTrades.some((r: any) => r.agent === 'multi-arb'));
  }
  if (f.name === 'bundle-unchanged') {
    assert.equal(on.type, 'bundle'); assert.deepEqual(on, f.expectedV3);
  }
  if (f.name === 'entry45-only') assert.equal(on.type, 'noop');
});

test('V5 headroom buy and sell remain inside the half band with independent funding', () => {
  for (const name of ['headroom-buy', 'headroom-sell']) {
    const f = fixture.frames.find((x: any) => x.name === name), o = f.observation, a = replay(f, xb.PARAMS);
    assert.equal(a.base, 'WETH'); assert.notEqual(a.type, 'noop'); assert.notEqual(a.type, 'bundle');
    assert.ok(BigInt(a.amountIn) < BigInt(f.expectedV3.amountIn));
    const held = Number(o.balances.wethWei) / 1e18;
    const protocol = ({ swap: 'uniswap', balancerSwap: 'balancer', curveSwap: 'curve' } as const)[a.type as 'swap'];
    const q = protocol === 'uniswap' ? o.protocols.uniswap.pool : o.protocols[protocol];
    const mid = q.priceUsdcPerWeth;
    const after = a.tokenIn === 'USDC' ? held + Number(a.amountIn)/1e6/mid*1.008 : held - Number(a.amountIn)/1e18;
    assert.ok(after >= 7.2 - 1e-8 && after <= 8.8 + 1e-8, `${name}: ${after}`);
    safeAction(o, a);
  }
});

test('V5 R9 keeps bundle room at the full band even outside the single half band', () => {
  const f = fixture.frames.find((x: any) => x.name === 'bundle-unchanged');
  const o = structuredClone(f.observation) as AgentObservation;
  o.balances.wethWei = String(9n * W);
  const on = replay({ ...f, observation: o }, xb.PARAMS), off = replay({ ...f, observation: o }, xb.V3_PARAMS);
  assert.equal(on.type, 'bundle'); assert.deepEqual(on, off); safeAction(o, on);
});

test('V5 R9 WBTC half-band tightens both directions without widening the hard band', () => {
  for (const buy of [true, false]) {
    const o = single(.05, buy);
    o.protocols.uniswap!.markets = { 'WBTC/USDC': { ...o.protocols.uniswap!.pool,
      priceUsdcPerWeth: o.protocols.uniswap!.pool.priceUsdcPerWeth * 20 } };
    o.protocols.uniswap!.pool.priceUsdcPerWeth = 3000;
    const a = xb.createAgent(xb.PARAMS, () => 0)(o), b = xb.createAgent(xb.V3_PARAMS, () => 0)(o);
    assert.equal(a.base, 'WBTC'); assert.equal(a.type, 'swap');
    assert.ok(BigInt(a.amountIn) < BigInt(b.amountIn));
    const mid = o.protocols.uniswap!.markets!['WBTC/USDC'].priceUsdcPerWeth;
    const after = buy ? .4 + Number(a.amountIn)/1e6/mid*1.008 : .4 - Number(a.amountIn)/1e8;
    assert.ok(after >= .36 - 1e-8 && after <= .44 + 1e-8); safeAction(o,a);
  }
});
