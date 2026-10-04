import { observation, safeAction, single, W } from './xb-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AgentObservation } from '@eris/sdk';
import * as xb from '../example/agents/xb-r/agent.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/xb-r-dev2.json', import.meta.url), 'utf8'));
// Extra properties are deliberately structural: the exact old source can load
// these tests and must fail behavioral assertions, not missing-export errors.
const profile = (r6: boolean, r7: boolean, entry = 60) => ({ ...xb.PARAMS,
  ENTRY_BPS: entry, R6_ANCHOR_CROSS: r6, R7_SINGLE_ENTRY: r7 }) as xb.Params;
const replay = (frame: any, p: xb.Params) => xb.createAgent(p, () => 0)(
  structuredClone(frame.observation), undefined,
  { started: 0, bids: new Map(frame.bids.map(([k,v]: string[]) => [k, BigInt(v)])) });
for (const side of ['buy', 'sell']) {
  test(`DEV2 R6 anchor ${side} crosses dust only inside the existing band`, () => {
    const f = fixture.frames.find((f: any) => f.name === `anchor_${side}`);
    assert.equal(f.candDecision.action.type, 'noop');
    assert.ok(f.referenceTrades.some((r: any) => r.agent === 'multi-arb'));
    assert.deepEqual(f.cooling, []);
    assert.equal(replay(f, profile(false, false, 50)).type, 'noop');
    const a = replay(f, profile(true, false, 50));
    assert.notEqual(a.type, 'noop');
    assert.equal(a.tokenIn, side === 'buy' ? 'USDC' : 'WETH');
    safeAction(f.observation, a);
    assert.equal(replay(f, profile(false, false, 50)).type, 'noop', 'factor-off restores old behavior');
  });
  test(`DEV2 R7 single ${side} uses the entry gate without the 100bps duplicate`, () => {
    const f = fixture.frames.find((f: any) => f.name === `single_${side}`);
    assert.equal(replay(f, profile(false, false, 50)).type, 'noop');
    const a = replay(f, profile(false, true, 50));
    assert.notEqual(a.type, 'noop');
    assert.equal(a.tokenIn, side === 'buy' ? 'USDC' : 'WETH');
    safeAction(f.observation, a);
    assert.equal(replay(f, profile(false, false, 50)).type, 'noop');
  });
}
test('DEV2 defaults retain initial entry60 and independently switch both repairs', () => {
  assert.equal(xb.PARAMS.ENTRY_BPS, 60);
  assert.equal((xb.PARAMS as any).R6_ANCHOR_CROSS, true);
  assert.equal((xb.PARAMS as any).R7_SINGLE_ENTRY, true);
  for (const f of fixture.frames) {
    const a = replay(f, xb.PARAMS);
    assert.notEqual(a.type, 'noop'); safeAction(f.observation, a);
  }
});
test('DEV2 entry admits only 20 to 60 in 5bps steps and affects admission only', () => {
  for (let e = 20; e <= 60; e += 5) assert.doesNotThrow(() => xb.createAgent(profile(true, true, e)));
  for (const e of [19, 61, 22, 60.5, Infinity, NaN]) assert.throws(() => xb.createAgent(profile(true, true, e)), /ENTRY_BPS/);
  const o = single(.02);
  assert.deepEqual(xb.enumerateCandidates(o, profile(true, true, 20)), xb.enumerateCandidates(o, profile(true, true, 60)));
  assert.equal(xb.entryAllowed(.006, profile(true, true, 60)), false);
});
test('DEV2 new factor switches reject malformed values', () => {
  for (const key of ['R6_ANCHOR_CROSS', 'R7_SINGLE_ENTRY']) for (const value of [0, null, undefined, 'true'])
    assert.throws(() => xb.createAgent({ ...profile(true, true), [key]: value }), new RegExp(key));
});
test('DEV2 endgame cannot cross the anchor or open new inventory', () => {
  for (const f of fixture.frames) {
    const o = structuredClone(f.observation) as AgentObservation; o.blocksRemaining = 4;
    for (const c of xb.enumerateCandidates(o, profile(true, true))) {
      assert.notEqual(c.action.type, 'bundle'); assert.equal(c.restoring, true);
      const initial = c.base === 'WETH' ? 8 : .4, decimals = c.base === 'WETH' ? 18 : 8;
      const held = Number(c.base === 'WETH' ? o.balances.wethWei : o.baseBalances!.WBTC) / 10 ** decimals;
      if (c.action.tokenIn !== 'USDC') assert.ok(Number(c.action.amountIn) / 10 ** decimals <= held - initial + 1e-12);
      else assert.ok(c.usd <= (initial - held) * o.fairPricesUsd![c.base] * 1.1);
    }
    assert.deepEqual(xb.enumerateCandidates(o, profile(true, true)), xb.enumerateCandidates(o, profile(false, true)));
  }
});
test('DEV2 crossing with R7 off still requires the full new-risk edge', () => {
  const o = single(.007, false); o.balances.wethWei = String(8n * W + W / 1000n);
  assert.equal(xb.createAgent(profile(true, false, 50))(o).type, 'noop');
  assert.notEqual(xb.createAgent(profile(true, true, 50))(o).type, 'noop');
});
test('DEV2 all repaired singles and independent bundle legs preserve 20 percent bands', () => {
  for (const f of fixture.frames) for (const held of [6.4, 7.999, 8, 8.001, 9.6]) {
    const o = structuredClone(f.observation) as AgentObservation;
    o.balances.wethWei = String(BigInt(Math.round(held * 1e6)) * 10n ** 12n);
    for (const c of xb.enumerateCandidates(o, profile(true, true))) {
      if (c.base !== 'WETH') continue;
      for (const a of c.action.type === 'bundle' ? c.action.actions : [c.action]) {
        const v = { swap: o.protocols.uniswap!.pool, balancerSwap: o.protocols.balancer, curveSwap: o.protocols.curve }[a.type as string] as any;
        const after = a.tokenIn === 'USDC' ? held + Number(a.amountIn) / 1e6 / v.priceUsdcPerWeth * 1.008
          : held - Number(a.amountIn) / 1e18;
        assert.ok(after <= 9.6 + 1e-12 && after >= 6.4 - 1e-12);
      }
    }
  }
});
test('DEV2 repair cannot bypass funding gas reserve bid or positive net safeguards', () => {
  for (const f of fixture.frames) {
    for (const mode of ['funding', 'gas', 'zeroFee', 'expensive']) {
      const x = structuredClone(f), o = x.observation;
      if (mode === 'funding') { o.balances.usdcUnits = '0'; o.balances.wethWei = '0'; o.baseBalances.WBTC = '0'; }
      if (mode === 'gas') o.balances.ethWei = String(W / 20n);
      if (mode === 'zeroFee') o.limits.maxPriorityFeePerGasWei = '0';
      if (mode === 'expensive') { o.limits.defaultPriorityFeePerGasWei = '1000000000000'; o.limits.maxPriorityFeePerGasWei = '1000000000000'; }
      assert.equal(replay(x, profile(true, true)).type, 'noop', mode);
    }
  }
  const o = observation(); o.balances.wethWei = String(10n * W); o.blocksRemaining = 3;
  assert.equal(xb.createAgent(profile(true, true))(o).type, 'noop', 'no profit-zero forced selling');
});
