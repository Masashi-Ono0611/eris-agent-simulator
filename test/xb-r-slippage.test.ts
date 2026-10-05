import { single, bundle, safeAction } from './xb-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as xb from '../example/agents/xb-r/agent.js';

const on = { ...xb.PARAMS, R13_EDGE_SLIPPAGE: true };
const legs = (a: xb.Action): xb.Action[] => a.type === 'bundle' ? a.actions : [a];

test('R13 defaults OFF and requires an explicit boolean', () => {
  assert.equal(xb.PARAMS.R13_EDGE_SLIPPAGE, false);
  assert.equal(xb.DEV2_PARAMS.R13_EDGE_SLIPPAGE, false);
  assert.equal(xb.DEV3A_PARAMS.R13_EDGE_SLIPPAGE, false);
  for (const value of [undefined, null, 1, 'true'])
    assert.throws(() => xb.createAgent({ ...on, R13_EDGE_SLIPPAGE: value } as any), /R13_EDGE_SLIPPAGE/);
  for (const o of [single(.0051), single(.02, false), bundle()]) {
    const a = xb.createAgent()(o);
    assert.deepEqual(a, xb.createAgent({ ...xb.PARAMS, R13_EDGE_SLIPPAGE: false })(o));
    assert.notEqual(a.type, 'noop');
    for (const leg of legs(a)) assert.equal(leg.slippageBps, 80);
  }
});

test('R13 singles cap both bases and directions after gas without mutating candidates', () => {
  for (const base of ['WETH', 'WBTC']) for (const buy of [true, false]) {
    const o = single(.0051, buy);
    if (base === 'WBTC') {
      const mid = o.protocols.uniswap!.pool.priceUsdcPerWeth * 20;
      o.protocols.uniswap!.pool.priceUsdcPerWeth = 3000;
      o.protocols.uniswap!.markets = { 'WBTC/USDC': { ...o.protocols.uniswap!.pool, priceUsdcPerWeth: mid } };
    }
    const cs = xb.enumerateCandidates(o, on), snapshot = structuredClone(cs);
    const a = xb.selectCandidate(o, cs, on);
    assert.equal(a.type, 'swap'); assert.equal(a.base, base);
    assert.equal(a.tokenIn, buy ? 'USDC' : base);
    const c = cs.find(c => c.action.amountIn === a.amountIn)!;
    const net = xb.netProfitUsd(o, c, BigInt(a.maxPriorityFeePerGasWei));
    assert.ok(Number.isInteger(a.slippageBps) && a.slippageBps >= 1 && a.slippageBps <= on.ENTRY_BPS);
    assert.ok(a.slippageBps * (c.usd + c.profit) / 10000 <= net - .05 + 1e-12);
    assert.deepEqual(cs, snapshot); safeAction(o, a);
  }
});

test('R13 bundle legs share one cost-adjusted slippage budget', () => {
  const o = bundle(), cs = xb.enumerateCandidates(o, on).filter(c => c.action.type === 'bundle');
  // A thin profitable bundle makes the net budget bind before the ENTRY cap.
  const c = { ...cs[0], profit: cs[0].usd * .006 };
  const a = xb.selectCandidate(o, [c], on), net = xb.netProfitUsd(o, c, BigInt(a.maxPriorityFeePerGasWei));
  assert.equal(a.type, 'bundle');
  const bps = a.actions[0].slippageBps;
  assert.ok(bps >= 1 && bps < on.ENTRY_BPS);
  assert.ok(bps * (2*c.usd + c.profit) / 10000 <= net - .05 + 1e-12);
  for (const leg of a.actions) assert.equal(leg.slippageBps, bps);
  safeAction(o, a);
});

test('R13 ENTRY bounds high-edge trades independently of surplus', () => {
  const o = single(.08);
  for (const entry of [20, 35, 50, 60]) {
    const p = { ...on, ENTRY_BPS: entry }, a = xb.createAgent(p, () => 0)(o);
    assert.equal(a.type, 'swap'); assert.equal(a.slippageBps, entry);
  }
});

test('R13 gas at the selected bid reduces the permitted output loss', () => {
  const o = single(.02), raw = xb.enumerateCandidates(o)[0];
  const c = { ...raw, usd: 1000, profit: 5, action: { ...raw.action, amountIn: '1000000000' } };
  const run = (rival: string) => xb.selectCandidate({ ...o, competition: { ...o.competition!, maxCompetitorPriorityFeeWei: rival } }, [c], on);
  const low = run('500000000'), high = run('700000000');
  assert.equal(low.type, 'swap'); assert.equal(high.type, 'swap');
  assert.equal(low.slippageBps, 45); assert.equal(high.slippageBps, 44);
});

test('R13 sub-bps room rejects or falls through without consuming funds', () => {
  const o = single(.02), raw = xb.enumerateCandidates(o)[0];
  o.competition!.maxCompetitorPriorityFeeWei = '0';
  const thin = { ...raw, usd: 20000, profit: .5, action: { ...raw.action, amountIn: '20000000000' } };
  const fallback = { ...raw, usd: 50, profit: .3, action: { ...raw.action, amountIn: '50000000' } };
  assert.equal(xb.selectCandidate(o, [thin]).amountIn, thin.action.amountIn);
  assert.equal(xb.selectCandidate(o, [thin], on).type, 'noop');
  assert.equal(xb.selectCandidate(o, [thin, fallback], on).amountIn, fallback.action.amountIn);
});

test('R13 retains the minimum profit reserve at the rounding boundary', () => {
  const c = xb.enumerateCandidates(single(.02))[0];
  const exposure = c.usd + c.profit;
  assert.equal(xb.slippageBudgetBps(c, .05 + exposure * .000099, on), 0);
  assert.equal(xb.slippageBudgetBps(c, .05 + exposure * .000101, on), 1);
  for (const net of [.049, NaN, Infinity]) assert.equal(xb.slippageBudgetBps(c, net, on), 0);
});

test('R13 preserves funding gas bid and net rejections', () => {
  for (const mode of ['funding', 'gas', 'bid', 'net']) {
    const o = single(.02), cs = xb.enumerateCandidates(o, on);
    if (mode === 'funding') o.balances.usdcUnits = '0';
    if (mode === 'gas') o.balances.ethWei = '50000000000000000';
    if (mode === 'bid') o.competition!.maxCompetitorPriorityFeeWei = '999999999999';
    if (mode === 'net') cs.forEach(c => c.profit = .04);
    assert.equal(xb.selectCandidate(o, cs, on).type, 'noop', mode);
  }
});
