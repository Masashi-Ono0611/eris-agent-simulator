import { observation, safeAction, single, W } from './xb-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AgentObservation } from '@eris/sdk';
import * as xb from '../example/agents/xb-r/agent.js';
const { UNISWAP, BALANCER, MARKET_LEGS } = await import('@eris/sdk/constants.js');

const fixture = JSON.parse(readFileSync(new URL('./fixtures/xb-r-dev3a.json', import.meta.url), 'utf8'));
const historical = (xb as any).V3_PARAMS ?? xb.PARAMS;
const profile = (entry = 50, settled = true, headroom = false) => ({ ...xb.PARAMS,
  ENTRY_BPS: entry, R8_SETTLED_COOLDOWN: settled, R9_BUNDLE_HEADROOM: headroom });
// Historical-source red control must fail assertions, not a missing export.
const settled = (before: AgentObservation, action: xb.Action, after: AgentObservation) =>
  (xb as any).settledSingle?.(before, action, after) ?? false;
// Independent test accessors: WBTC is never aliased to the WETH balance.
const balance = (o: AgentObservation, token: string): string => token === 'USDC' ? o.balances.usdcUnits
  : token === 'WETH' ? o.balances.wethWei : o.baseBalances![token];
function setBalance(o: AgentObservation, token: string, value: string) {
  if (token === 'USDC') o.balances.usdcUnits = value;
  else if (token === 'WETH') o.balances.wethWei = value;
  else o.baseBalances![token] = value;
}
const btcFixture = JSON.parse(readFileSync(new URL('./fixtures/xb-r-wbtc-settlement.json', import.meta.url), 'utf8'));
const btcFrames = btcFixture.cases.map((x: any) => {
  const before = observation(), after = structuredClone(before);
  after.blockNumber = String(Number(before.blockNumber) + 1);
  after.balances.ethWei = String(BigInt(before.balances.ethWei) - 100000000000000n);
  setBalance(after, 'USDC', String(BigInt(balance(before, 'USDC')) + BigInt(x.cashDelta)));
  setBalance(after, 'WBTC', String(BigInt(balance(before, 'WBTC')) + BigInt(x.baseDelta)));
  return { name: `synthetic_WBTC_${x.side}`, observation: after,
    settledFrame: { observation: before, action: { type: 'swap', base: 'WBTC', tokenIn: x.tokenIn, amountIn: x.amountIn } } };
});
const settlementFrames = [...fixture.frames.filter((x: any) => x.settledFrame), ...btcFrames];
function replay(f: any, p = profile(), cooling: ReadonlySet<string> = new Set(f.cooling)) {
  // Match execution targets to the test SDK deployment, as in the dev1 replay.
  const bids = new Map<string, bigint>();
  for (const tx of f.transactions) {
    const target = tx.method === 'exactInputSingle' ? UNISWAP.swapRouter : tx.method === 'swap' ? BALANCER.vault
      : tx.method === 'exchange' && tx.receiptBase ? MARKET_LEGS.curve[tx.receiptBase]?.pool : undefined;
    if (target) bids.set(target.toLowerCase(), BigInt(tx.priorityFeeWei) > (bids.get(target.toLowerCase()) ?? 0n)
      ? BigInt(tx.priorityFeeWei) : bids.get(target.toLowerCase())!);
  }
  return xb.selectCandidate(f.observation, xb.enumerateCandidates(f.observation, p, cooling), p, bids);
}

for (const side of ['buy', 'sell']) {
  test(`DEV3 entry ${side} recovers a same-block reference opportunity with positive net`, () => {
    const f = fixture.frames.find((x: any) => x.name === `entry_${side}`);
    assert.equal(f.candDecision.action.type, 'noop');
    assert.ok(f.referenceTrades.some((r: any) => r.agent === 'multi-arb'));
    assert.equal(replay(f, profile(60)).type, 'noop');
    const a = replay(f); assert.deepEqual(a, f.expected.action); safeAction(f.observation, a);
    const cs = xb.enumerateCandidates(f.observation, profile());
    const c = cs.find(c => c.action.type === a.type && c.action.amountIn === a.amountIn)!;
    assert.ok(c.edge * 10000 > 50 && c.edge * 10000 <= 60);
    assert.ok(xb.netProfitUsd(f.observation, c, BigInt(a.maxPriorityFeePerGasWei)) >= .05);
  });
  test(`DEV3 R8 confirms ${side} from logged input debit and reconstructed proceeds`, () => {
    const f = fixture.frames.find((x: any) => x.name === `settled_${side}`), prev = f.settledFrame;
    assert.equal(prev.status, 'success'); assert.ok(prev.receiptBlock <= Number(f.observation.blockNumber));
    assert.equal(settled(prev.observation, prev.action, f.observation), true);
    assert.equal(replay(f, profile(60)).type, 'noop');
    const cooling = new Set<string>(f.cooling); cooling.delete(prev.action.base);
    const a = replay(f, profile(60), cooling); assert.deepEqual(a, f.expected.action); safeAction(f.observation, a);
  });
}

test('DEV3 defaults and historical profiles freeze separate experiments', () => {
  assert.equal(xb.PARAMS.ENTRY_BPS, 50);
  assert.equal((xb.PARAMS as any).R8_SETTLED_COOLDOWN, true);
  assert.equal(historical.R9_BUNDLE_HEADROOM, false);
  assert.equal((xb as any).DEV3A_PARAMS?.ENTRY_BPS, 60);
  assert.equal((xb as any).DEV3A_PARAMS?.R8_SETTLED_COOLDOWN, false);
});

test('DEV3 R8 rejects unchanged failed partial and ambiguous settlement', () => {
  for (const f of settlementFrames) {
    const { observation: before, action } = f.settledFrame;
    assert.equal(settled(before, action, f.observation), true, `${f.name}: positive control`);
    for (const mode of ['pending', 'input', 'output', 'gas', 'otherBase', 'bundle', 'run', 'gap', 'invalid']) {
      const after = structuredClone(f.observation), a = structuredClone(action);
      if (mode === 'pending') {
        after.balances = structuredClone(before.balances);
        after.baseBalances = structuredClone(before.baseBalances);
      }
      if (mode === 'input') {
        setBalance(after, a.tokenIn, String(BigInt(balance(after, a.tokenIn)) + 1n));
      }
      if (mode === 'output') {
        const token = a.tokenIn === 'USDC' ? a.base : 'USDC';
        setBalance(after, token, balance(before, token));
      }
      if (mode === 'gas') after.balances.ethWei = before.balances.ethWei;
      if (mode === 'otherBase') {
        const token = a.base === 'WETH' ? 'WBTC' : 'WETH';
        setBalance(after, token, String(BigInt(balance(before, token)) + 1n));
      }
      if (mode === 'bundle') a.type = 'bundle';
      if (mode === 'run') after.runId = 'another-run';
      if (mode === 'gap') after.blockNumber = String(Number(before.blockNumber) + 2);
      if (mode === 'invalid') a.amountIn = 'invalid';
      assert.equal(settled(before, a, after), false, `${f.name}: ${mode}`);
    }
  }
});

for (const mode of ['block+1', 'runId', 'bundle']) test(`DEV3 R8 guard ${mode}`, () => {
  for (const f of settlementFrames) {
    const { observation: before, action } = f.settledFrame;
    assert.equal(settled(before, action, f.observation), true);
    const after = structuredClone(f.observation), a = structuredClone(action);
    if (mode === 'block+1') after.blockNumber = String(Number(before.blockNumber) + 2);
    if (mode === 'runId') after.runId = `${before.runId}-different`;
    if (mode === 'bundle') a.type = 'bundle'; // partial bundle that otherwise looks like a single
    assert.equal(settled(before, a, after), false, f.name);
  }
});

test('DEV3 R8 run reset discards previous settlement before reading new run data', () => {
  const reused = xb.createAgent(profile(), () => 0), fresh = xb.createAgent(profile(), () => 0);
  assert.equal(reused(single(.012)).type, 'swap');
  const next = observation(101); next.enabledProtocols = [];
  // No new attempt replaces previous. Compare with a fresh agent's observation
  // access, since cleared lastSent alone can mask a stale previous in actions.
  let reads = 0;
  Object.defineProperty(next, 'runId', { enumerable: true, get() { reads++; return 'new-run'; } });
  const actual = reused(next), reusedReads = reads;
  reads = 0;
  assert.deepEqual(actual, fresh(next));
  assert.equal(reusedReads, reads, 'reset must not consult the previous run for settlement');
});

for (const f of btcFrames) test(`DEV3 R8 ${f.name} checks the WBTC input and output legs`, () => {
  const { observation: before, action } = f.settledFrame;
  assert.equal(before.balances.wethWei, f.observation.balances.wethWei);
  assert.equal(settled(before, action, f.observation), true);
  for (const token of ['USDC', 'WBTC']) {
    const after = structuredClone(f.observation);
    setBalance(after, token, balance(before, token));
    assert.equal(settled(before, action, after), false, `missing ${token} leg`);
  }
});

// Integration test uses a synthetic market with exact settlement of the
// action actually selected. It is not a replay of a hypothetical v3 trajectory.
test('DEV3 R8 state machine releases only confirmed singles and can switch off', () => {
  for (const enabled of [false, true]) for (const confirmed of [false, true]) {
    const p = profile(50, enabled), agent = xb.createAgent(p, () => 0), o = single(.012);
    const a = agent(o); assert.notEqual(a.type, 'noop'); assert.notEqual(a.type, 'bundle');
    const next = structuredClone(o); next.blockNumber = String(Number(o.blockNumber) + 1); next.blocksRemaining!--;
    if (confirmed) {
      next.balances.usdcUnits = String(BigInt(o.balances.usdcUnits) - BigInt(a.amountIn));
      next.balances.wethWei = String(BigInt(o.balances.wethWei) + W / 2n);
      next.balances.ethWei = String(BigInt(o.balances.ethWei) - 100000000000000n);
    }
    const b = agent(next);
    assert.equal(b.type !== 'noop', enabled && confirmed);
    safeAction(next, b);
    assert.equal(agent(next).reason, 'duplicate observation');
  }
});

test('DEV3 R8 reset cannot reuse a previous run or a restarted horizon', () => {
  const agent = xb.createAgent(profile(), () => 0), o = single(.012);
  agent(o);
  const next = structuredClone(o); next.runId = 'reset'; next.blockNumber = String(Number(o.blockNumber) + 1);
  assert.notEqual(agent(next).type, 'noop', 'new run starts with no previous attempt');
  next.blocksRemaining = 360; next.blockNumber = String(Number(next.blockNumber) + 1);
  assert.notEqual(agent(next).type, 'noop', 'new epoch clears cooldown');
});

test('DEV3 R9 reserves half band for bundles without relaxing their independent legs', () => {
  const o = single(.08);
  const full = xb.enumerateCandidates(o, profile(50, true, false));
  const reserved = xb.enumerateCandidates(o, profile(50, true, true));
  assert.ok(reserved[0].usd < full[0].usd);
  for (const c of reserved) assert.ok(c.usd / o.protocols.uniswap!.pool.priceUsdcPerWeth * 1.008 <= .8 + 1e-9);
  o.protocols.balancer = { priceUsdcPerWeth: 3100 } as any;
  assert.deepEqual(xb.enumerateCandidates(o, profile(50, true, true)).filter(c => c.action.type === 'bundle'),
    xb.enumerateCandidates(o, profile(50, true, false)).filter(c => c.action.type === 'bundle'));
});

test('DEV3 R9 recovery outside inner band never expands the hard band or crosses at endgame', () => {
  for (const base of ['WETH', 'WBTC']) for (const heldRatio of [.8, .9, 1, 1.1, 1.2]) {
    const o = single(.08), initial = base === 'WETH' ? 8 : .4, decimals = base === 'WETH' ? 18 : 8;
    if (base === 'WETH') o.balances.wethWei = String(BigInt(Math.round(initial * heldRatio * 1e6)) * 10n ** 12n);
    else { o.baseBalances!.WBTC = String(Math.round(initial * heldRatio * 1e8));
      o.protocols.uniswap!.markets = { 'WBTC/USDC': { ...o.protocols.uniswap!.pool, priceUsdcPerWeth: 56000 } }; }
    for (const left of [100, 4]) {
      o.blocksRemaining = left;
      for (const c of xb.enumerateCandidates(o, profile(50, true, true)).filter(c => c.base === base)) {
        safeAction(o, { ...c.action, base, maxPriorityFeePerGasWei: '100000000' });
        const held = initial * heldRatio;
        const mid = base === 'WETH' ? o.protocols.uniswap!.pool.priceUsdcPerWeth : 56000;
        const after = c.action.tokenIn === 'USDC' ? held + c.usd / mid * 1.008 : held - Number(c.action.amountIn) / 10 ** decimals;
        assert.ok(after >= initial * .8 - 1e-9 && after <= initial * 1.2 + 1e-9);
        if (left === 4) { assert.equal(c.restoring, true); assert.notEqual(c.action.type, 'bundle'); }
      }
    }
  }
});

test('DEV3 safety guards still reject zero profit unfunded gas and unaffordable bids', () => {
  for (const f of fixture.frames) for (const mode of ['funding', 'gas', 'priority', 'bid']) {
    const x = structuredClone(f), o = x.observation;
    if (mode === 'funding') { o.balances.usdcUnits = '0'; o.balances.wethWei = '0'; o.baseBalances.WBTC = '0'; }
    if (mode === 'gas') o.balances.ethWei = String(W / 20n);
    if (mode === 'priority') o.limits.maxPriorityFeePerGasWei = '0';
    if (mode === 'bid') x.bids = x.bids.map(([k]: string[]) => [k, '999999999999']);
    // Explicitly bid on every execution target, even if the fixture saw no tx.
    if (mode === 'bid') {
      const cs = xb.enumerateCandidates(o, profile());
      o.competition.maxCompetitorPriorityFeeWei = '999999999999';
      assert.equal(xb.selectCandidate(o, cs, profile()).type, 'noop');
    } else assert.equal(replay(x, profile(), new Set()).type, 'noop', mode);
  }
  const o = observation(); o.blocksRemaining = 3; o.balances.wethWei = String(9n * W);
  assert.equal(xb.createAgent(profile())(o).type, 'noop');
});

test('DEV3 lower entry preserves the positive net floor under quote and gas stress', () => {
  const f = fixture.frames[0], o = f.observation, p = profile();
  const cs = xb.enumerateCandidates(o, p);
  const loss = cs.map(c => ({ ...c, profit: c.profit - c.usd * .008 }));
  assert.equal(xb.selectCandidate(o, loss, p, new Map()).type, 'noop');
  const gross = cs.map(c => ({ ...c, profit: .04 }));
  assert.equal(xb.selectCandidate(o, gross, p, new Map()).type, 'noop');
});

test('DEV3 factor validation and AI entry range remain bounded', () => {
  for (const key of ['R8_SETTLED_COOLDOWN', 'R9_BUNDLE_HEADROOM']) for (const value of [undefined, null, 1, 'true'])
    assert.throws(() => xb.createAgent({ ...profile(), [key]: value }), new RegExp(key));
  for (const entry of [19, 22, 61, NaN, Infinity]) assert.throws(() => xb.createAgent(profile(entry)), /ENTRY_BPS/);
});
