import { observation, single, bundle, safeAction, liquity, W } from './xb-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AgentObservation } from '@eris/sdk';
import * as xb from '../example/agents/xb-r/agent.js';
const { UNISWAP, BALANCER, MARKET_LEGS } = await import('@eris/sdk/constants.js');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/xb-r-dev3-v4.json', import.meta.url), 'utf8'));
const keys = ['R10_FULL_DEPTH_SIZE', 'R11_SMALL_SINGLE_CAP', 'R12_UNCONFIRMED_BACKOFF'] as const;
const profile = (overrides: Partial<xb.Params> = {}): xb.Params => ({ ...xb.PARAMS, ...overrides });

function replay(f: any, p = profile()): xb.Action {
  const bids = new Map<string, bigint>(), cooling = new Set<string>(f.cooling);
  for (const tx of f.transactions) {
    const target = tx.method === 'exactInputSingle' ? UNISWAP.swapRouter : tx.method === 'swap' ? BALANCER.vault
      : tx.method === 'exchange' && tx.receiptBase ? MARKET_LEGS.curve[tx.receiptBase]?.pool : undefined;
    if (target && BigInt(tx.priorityFeeWei) > (bids.get(target.toLowerCase()) ?? 0n))
      bids.set(target.toLowerCase(), BigInt(tx.priorityFeeWei));
  }
  if (p.R8_SETTLED_COOLDOWN && f.settledFrame &&
      xb.settledSingle(f.settledFrame.observation, f.settledFrame.action, f.observation))
    cooling.delete(f.settledFrame.action.base);
  return xb.selectCandidate(f.observation, xb.enumerateCandidates(f.observation, p, cooling), p, bids);
}

for (const f of fixture.frames) test(`V4 golden d30cbbb ${f.name}`, () => {
  assert.equal(fixture.goldenCommit, 'd30cbbb46ca472b5a7a72fc1b99deab96dc97bf3');
  assert.deepEqual(replay(f), f.expectedV3);
  safeAction(f.observation, replay(f));
});

test('V4 defaults freeze v3 and all new factors are OFF', () => {
  for (const key of keys) assert.equal(xb.PARAMS[key], false, key);
  assert.equal(xb.PARAMS.R9_BUNDLE_HEADROOM, false);
  assert.equal(xb.PARAMS.R7_SINGLE_ENTRY, true);
  assert.equal(xb.PARAMS.R8_SETTLED_COOLDOWN, true);
  assert.equal(xb.PARAMS.ENTRY_BPS, 50);
  for (const key of keys) for (const value of [undefined, null, 1, 'true'])
    assert.throws(() => xb.createAgent({ ...profile(), [key]: value }), new RegExp(key));
});

test('V4 R10 full depth sizes a cash-limited synthetic opportunity within old ceilings', () => {
  const o = single(.008); o.balances.usdcUnits = '1000000000';
  const base = xb.createAgent(profile(), () => 0)(o);
  const on = xb.createAgent(profile({ R10_FULL_DEPTH_SIZE: true }), () => 0)(o);
  assert.equal(base.type, 'swap'); assert.equal(on.type, 'swap');
  assert.ok(BigInt(on.amountIn) > BigInt(base.amountIn));
  assert.ok(BigInt(on.amountIn) <= 900_000_000n, 'at most 90% of current cash');
  assert.equal(xb.sizeUsd(.008, 1 / 300000, 1000, 4000, true, true), 900);
  assert.equal(xb.sizeUsd(.008, 1 / 300000, 1000, 500, true, true), 500);
  safeAction(o, on);
});

test('V4 R11 logged cdp and calm singles respect the 4 percent cap', () => {
  for (const f of fixture.frames.filter((x: any) => x.name.endsWith('-size'))) {
    const a = replay(f, profile({ R11_SMALL_SINGLE_CAP: true })), old = replay(f);
    assert.deepEqual(a, f.expectedV4.v4smallSingles);
    assert.notEqual(a.type, 'noop'); assert.notEqual(a.type, 'bundle');
    assert.ok(BigInt(a.amountIn) < BigInt(old.amountIn));
    const o = f.observation, base = a.base, decimals = base === 'WETH' ? 18 : 8;
    const equity = Number(o.balances.usdcUnits) / 1e6 + Number(o.balances.wethWei) / 1e18 * o.fairPricesUsd.WETH
      + Number(o.baseBalances.WBTC) / 1e8 * o.fairPricesUsd.WBTC;
    const usd = a.tokenIn === 'USDC' ? Number(a.amountIn) / 1e6 : Number(a.amountIn) / 10 ** decimals * o.fairPricesUsd[base];
    assert.ok(usd <= .04 * equity + 1e-6);
    safeAction(o, a);
  }
});

test('V4 R11 never shrinks the independently funded bundle cap', () => {
  const o = bundle(), bundles = (p: xb.Params) => xb.enumerateCandidates(o, p).filter(c => c.action.type === 'bundle');
  assert.ok(bundles(profile()).length > 0);
  assert.deepEqual(bundles(profile({ R11_SMALL_SINGLE_CAP: true })), bundles(profile()));
});

test('V4 logged headroom and stricter single gate have a real opportunity cost', () => {
  for (const name of ['depeg-persist', 'launch']) {
    const f = fixture.frames.find((x: any) => x.name === name);
    const a = replay(f, profile({ R7_SINGLE_ENTRY: false, SINGLE_EDGE_BPS: 75 }));
    assert.notDeepEqual(a, replay(f));
    assert.deepEqual(a, f.expectedV4.v4singleGate);
  }
  const f = fixture.frames.find((x: any) => x.name === 'whale-headroom');
  assert.notEqual(replay(f).type, 'noop');
  assert.equal(replay(f, profile({ R9_BUNDLE_HEADROOM: true })).type, 'noop');
});

function next(o: AgentObservation, delta: number): AgentObservation {
  const n = structuredClone(o); n.blockNumber = String(Number(o.blockNumber) + delta); n.blocksRemaining! -= delta; return n;
}
function confirm(o: AgentObservation, a: xb.Action): AgentObservation {
  const n = next(o, 1);
  n.balances.usdcUnits = String(BigInt(o.balances.usdcUnits) - BigInt(a.amountIn));
  n.balances.wethWei = String(BigInt(o.balances.wethWei) + W / 2n);
  n.balances.ethWei = String(BigInt(o.balances.ethWei) - 100000000000000n);
  return n;
}

test('V4 R12 ambiguous singles wait four blocks while OFF retains two', () => {
  for (const enabled of [false, true]) {
    const agent = xb.createAgent(profile({ R12_UNCONFIRMED_BACKOFF: enabled }), () => 0), o = single(.012);
    assert.equal(agent(o).type, 'swap');
    assert.equal(agent(next(o, 1)).type, 'noop');
    if (enabled) {
      assert.equal(agent(next(o, 2)).type, 'noop');
      assert.equal(agent(next(o, 3)).type, 'noop');
      assert.equal(agent(next(o, 4)).type, 'swap');
    } else assert.equal(agent(next(o, 2)).type, 'swap');
  }
});

test('V4 R12 confirmed singles keep the v3 next-block release', () => {
  const agent = xb.createAgent(profile({ R12_UNCONFIRMED_BACKOFF: true }), () => 0), o = single(.012);
  const a = agent(o), n = confirm(o, a);
  assert.equal(agent(n).type, 'swap');
  assert.equal(agent(n).reason, 'duplicate observation');
});

test('V4 R12 with R8 OFF clears confirmation but keeps the two-block wait', () => {
  const agent = xb.createAgent(profile({ R12_UNCONFIRMED_BACKOFF: true, R8_SETTLED_COOLDOWN: false }), () => 0);
  const o = single(.012), n = confirm(o, agent(o));
  assert.equal(agent(n).type, 'noop');
  assert.equal(agent(next(n, 1)).type, 'swap');
});

test('V4 R12 incomplete confirmation cannot clear backoff', () => {
  for (const mode of ['input', 'gas', 'otherBase', 'skipped']) {
    const agent = xb.createAgent(profile({ R12_UNCONFIRMED_BACKOFF: true }), () => 0), o = single(.012);
    let n = confirm(o, agent(o));
    if (mode === 'input') n.balances.usdcUnits = o.balances.usdcUnits;
    if (mode === 'gas') n.balances.ethWei = o.balances.ethWei;
    if (mode === 'otherBase') n.baseBalances!.WBTC = '40000001';
    if (mode === 'skipped') n = next(n, 1);
    assert.equal(agent(n).type, 'noop', mode);
    if (mode !== 'skipped') assert.equal(agent(next(n, 1)).type, 'noop', mode);
  }
});

test('V4 R12 state resets on run change rollback and restarted horizon', () => {
  for (const mode of ['run', 'rollback', 'horizon']) {
    const agent = xb.createAgent(profile({ R12_UNCONFIRMED_BACKOFF: true }), () => 0), o = single(.012);
    agent(o); const n = next(o, 1);
    if (mode === 'run') n.runId = 'new-run';
    if (mode === 'rollback') n.blockNumber = '1';
    if (mode === 'horizon') n.blocksRemaining = 1000;
    assert.equal(agent(n).type, 'swap', mode);
  }
});

test('V4 R12 does not impose single backoff on priority bundles', () => {
  const agent = xb.createAgent(profile({ R12_UNCONFIRMED_BACKOFF: true }), () => 0), o = bundle();
  assert.equal(agent(o).type, 'bundle');
  assert.equal(agent(next(o, 1)).type, 'bundle');
});

test('V4 R12 keeps unresolved attempts separate across both bases', () => {
  const agent = xb.createAgent(profile({ R12_UNCONFIRMED_BACKOFF: true }), () => 0), o = single(.012);
  assert.equal(agent(o).base, 'WETH');
  const btc = next(o, 1); btc.protocols.uniswap!.pool.priceUsdcPerWeth = 3000;
  btc.protocols.uniswap!.markets = { 'WBTC/USDC': { ...btc.protocols.uniswap!.pool, priceUsdcPerWeth: 60000 / 1.015 } };
  const a = agent(btc); assert.equal(a.base, 'WBTC'); safeAction(btc, a);
  assert.equal(agent(next(o, 2)).type, 'noop', 'a WBTC attempt must not erase WETH backoff');
  assert.equal(agent(next(o, 4)).base, 'WETH');
});

test('V4 R12 backoff preserves profitable endgame restoration only', () => {
  for (const profitable of [false, true]) {
    const agent = xb.createAgent(profile({ R12_UNCONFIRMED_BACKOFF: true }), () => 0), o = single(.012, false);
    o.balances.wethWei = String(9n * W); o.blocksRemaining = 5; agent(o);
    const n = next(o, 1);
    if (!profitable) n.protocols.uniswap!.pool.priceUsdcPerWeth = 3000;
    const a = agent(n); assert.equal(a.type !== 'noop', profitable);
    if (profitable) assert.ok(BigInt(a.amountIn) <= W, 'restoration never crosses the anchor');
  }
});

test('V4 all allocation factors preserve funding bid profit gas and the hard inventory band', () => {
  for (let mask = 0; mask < 16; mask++) {
    const p = profile({ R9_BUNDLE_HEADROOM: !!(mask & 1), R10_FULL_DEPTH_SIZE: !!(mask & 2),
      R11_SMALL_SINGLE_CAP: !!(mask & 4), R12_UNCONFIRMED_BACKOFF: !!(mask & 8) });
    for (const base of ['WETH', 'WBTC']) for (const ratio of [.8, 1, 1.2]) {
      const o = bundle(), initial = base === 'WETH' ? 8 : .4, decimals = base === 'WETH' ? 18 : 8;
      if (base === 'WETH') o.balances.wethWei = String(BigInt(Math.round(initial * ratio * 1e6)) * 10n ** 12n);
      else { o.baseBalances!.WBTC = String(Math.round(initial * ratio * 1e8));
        o.protocols.uniswap!.markets = { 'WBTC/USDC': { ...o.protocols.uniswap!.pool, priceUsdcPerWeth: 58000 } };
        (o.protocols.balancer as any).markets = { 'WBTC/USDC': { priceUsdcPerWeth: 62000 } }; }
      for (const c of xb.enumerateCandidates(o, p).filter(c => c.base === base)) {
        assert.ok(c.usd <= c.edge / (2 * c.slope) + 1e-6, 'old depth ceiling');
        assert.equal(xb.reserveCandidate(o, c), true);
        for (const leg of c.action.type === 'bundle' ? c.action.actions : [c.action]) {
          const mid = base === 'WETH' ? (leg.type === 'swap' ? 2900 : 3100 / 1.003)
            : (leg.type === 'swap' ? 58000 : 62000 / .997);
          const delta = leg.tokenIn === 'USDC' ? Number(leg.amountIn) / 1e6 / mid * 1.008
            : -Number(leg.amountIn) / 10 ** decimals;
          assert.ok(initial * ratio + delta >= initial * .8 - 1e-8);
          assert.ok(initial * ratio + delta <= initial * 1.2 + 1e-8);
        }
      }
      safeAction(o, xb.createAgent(p, () => 0)(o));
    }
    for (const mode of ['funding', 'gas', 'priority', 'bid', 'profit']) {
      const o = single(.02);
      if (mode === 'funding') { o.balances.usdcUnits = '0'; o.balances.wethWei = '0'; o.baseBalances!.WBTC = '0'; }
      if (mode === 'gas') o.balances.ethWei = String(W / 20n);
      if (mode === 'priority') o.limits.maxPriorityFeePerGasWei = '0';
      if (mode === 'bid') o.competition!.maxCompetitorPriorityFeeWei = '999999999999';
      const cs = xb.enumerateCandidates(o, p).map(c => mode === 'profit' ? { ...c, profit: 0 } : c);
      assert.equal(xb.selectCandidate(o, cs, p).type, 'noop', mode);
    }
  }
});

test('V4 specialist opportunities remain outside the executable spot-only policy', () => {
  const o = observation(); o.protocols.liquity = liquity({ redemptionEdgeBps: 9000,
    riskiestTrove: { owner: '0x0000000000000000000000000000000000000022', icr: .9, netDebtEusdWei: String(10000n * W) } });
  const p = profile({ R10_FULL_DEPTH_SIZE: true, R11_SMALL_SINGLE_CAP: true, R12_UNCONFIRMED_BACKOFF: true });
  assert.equal(xb.createAgent(p, () => 0)(o).type, 'noop');
  assert.equal(xb.enumerateCandidates(o, p).length, 0);
});

test('V4 final selection independently rejects stale unfunded and gas-starved candidates', () => {
  const p = profile({ R10_FULL_DEPTH_SIZE: true, R11_SMALL_SINGLE_CAP: true, R12_UNCONFIRMED_BACKOFF: true });
  const o = single(.02), cs = xb.enumerateCandidates(o, p);
  assert.notEqual(xb.selectCandidate(o, cs, p).type, 'noop');
  const empty = structuredClone(o); empty.balances.usdcUnits = '0';
  assert.equal(xb.selectCandidate(empty, cs, p).type, 'noop');
  const gas = structuredClone(o); gas.balances.ethWei = String(W / 20n);
  assert.equal(xb.selectCandidate(gas, cs, p).type, 'noop');
  assert.equal(xb.selectCandidate(o, cs.map(c => ({ ...c, profit: 0 })), p).type, 'noop');
});

test('V4 ENTRY remains the bounded sole AI-reserved parameter', () => {
  for (const entry of [20, 25, 45, 50, 60]) assert.doesNotThrow(() => xb.createAgent(profile({ ENTRY_BPS: entry })));
  for (const entry of [19, 21, 61, NaN, Infinity])
    assert.throws(() => xb.createAgent(profile({ ENTRY_BPS: entry })), /ENTRY_BPS/);
});
