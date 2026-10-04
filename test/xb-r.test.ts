import { bundle, liquity, observation, safeAction, single, U, W } from "./xb-fixtures.js";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AgentContext, AgentObservation } from "@eris/sdk";
import { loadImproveAgent } from "../example/agents/runtime/improve.js";
import { bidWei as v0Bid } from "../example/agents/xb-core/agent.js";
import {
  PARAMS, bidWei, createAgent, decide, economicEdge, entryAllowed, enumerateCandidates,
  netProfitUsd, profitUsd, reserveCandidate, selectCandidate, sizeUsd, type Params,
} from "../example/agents/xb-r/agent.js";

const action = (o: AgentObservation, p: Params = PARAMS) => createAgent(p)(structuredClone(o));
function restoring(edge = 0.0055, buy = true): AgentObservation {
  const o = single(edge, buy);
  o.balances.wethWei = String((buy ? 75n : 85n) * W / 10n);
  return o;
}
// Both venues are below fair: the single has more modeled profit than the bundle.
function preferBundle(): AgentObservation {
  const o = bundle(); o.protocols.uniswap!.pool.priceUsdcPerWeth = 2700;
  Object.assign(o.protocols.balancer!, {
    priceUsdcPerWeth: 2760, buyPriceUsdcPerWeth: 2768.28, sellPriceUsdcPerWeth: 2751.72,
  });
  return o;
}
function red(t: TestContext, label: string, check: (p: Params) => void, key: keyof Params): void {
  check(PARAMS);
  assert.throws(() => check({ ...PARAMS, [key]: false }), { name: "AssertionError" });
  check(PARAMS);
  t.diagnostic(`RED-CONTROL ${label}: factor-off failed the same assertion; restored Params passed`);
}

test("xb-r frozen defaults, decide wrapper and improve prompt", () => {
  assert.equal(Object.isFrozen(PARAMS), true);
  assert.equal(PARAMS.ENTRY_BPS, 50);
  assert.equal(PARAMS.SINGLE_EDGE_BPS, 100);
  const o = bundle(); o.runId = "wrapper";
  assert.deepEqual(decide(o), action(o));
  assert.equal(loadImproveAgent(new URL("../example/agents/xb-r/", import.meta.url).pathname).name, "xb-r");
});
test("R1 selects a funded bundle before a more profitable single", t => {
  const o = preferBundle(), all = enumerateCandidates(o);
  assert.ok(Math.max(...all.filter(c => c.action.type !== "bundle").map(c => c.profit)) >
    Math.max(...all.filter(c => c.action.type === "bundle").map(c => c.profit)));
  red(t, "R1-priority", p => assert.equal(action(o, p).type, "bundle"), "R1_BUNDLE_PRIORITY");
  safeAction(o, action(o));
});
test("R1 bundle ignores cooldown after either a single or a bundle", t => {
  for (const first of [single(0.02), bundle()]) {
    red(t, `R1-cooldown-${first.protocols.balancer ? "bundle" : "single"}`, p => {
      const next = createAgent(p);
      assert.notEqual(next(first).type, "noop");
      assert.equal(next(bundle(101)).type, "bundle");
    }, "R1_BUNDLE_PRIORITY");
  }
});
test("R1 singles require restoration or a large net edge and still cool down", () => {
  assert.equal(action(single(0.007)).type, "noop");
  assert.equal(action(restoring(0.007)).type, "swap");
  assert.equal(action(single(0.0101)).type, "swap");
  const next = createAgent();
  assert.equal(next(single(0.02)).type, "swap");
  assert.equal(next(single(0.02, true, 101)).type, "noop");
  assert.equal(next(single(0.02, true, 102)).type, "swap");
});
test("R2 balance floor raises size while the depth ceiling remains binding", t => {
  red(t, "R2-size", p => {
    const a = action(single(0.012), p);
    assert.equal(a.type, "swap");
    // Independently: e * depth / 2 = 1,800, versus V0's 900 target.
    assert.ok(Math.abs(Number(a.amountIn) / 1e6 - 1800) < 0.00001);
  }, "R2_BALANCE_FLOOR");
  assert.equal(sizeUsd(0.001, 1 / 10_000_000, 1_000_000, 1e6, true), 5000);
  assert.equal(sizeUsd(0.001, 1 / 10_000_000, 10000, 1e6, true), 2500);
  assert.equal(sizeUsd(0.001, 1 / 800000, 10000, 1e6, true), 250, "2.5 percent balance floor");
  assert.equal(sizeUsd(0.01, 1 / 1_000_000, 40000, 1e6, true), 4000);
  assert.equal(sizeUsd(0.03, 1 / 1_000_000, 40000, 1e6, true), 10000);
  assert.equal(sizeUsd(0.03, 1 / 1_000_000, 40000, 123, true), 123);
});
test("R2 candidate-local reservations roll back rejected bundles before single fallback", () => {
  const o = preferBundle();
  const all = enumerateCandidates(o), before = structuredClone(o);
  assert.ok(all.some(c => c.action.type === "bundle"));
  assert.deepEqual(o, before);
  assert.equal(action(o).type, "bundle");
  // A bundle reserves the same cash but cannot afford gas; a buy single can.
  o.balances.ethWei = String(W / 20n + 200000n * 200000000n);
  const a = action(o);
  assert.equal(a.type, "swap"); assert.equal(a.tokenIn, "USDC"); safeAction(o, a);
  const candidate = all.find(c => c.action.type === "swap")!;
  const unfunded = { ...candidate, profit: candidate.profit * 2,
    action: { ...candidate.action, amountIn: String(30000n * U) } };
  assert.equal(reserveCandidate(o, unfunded), false);
  assert.equal(reserveCandidate(o, candidate), true);
  assert.deepEqual(selectCandidate(o, [unfunded, candidate]), selectCandidate(o, [candidate]));
});
test("R2 cumulative reservation rejects two legs spending the same observed balance", () => {
  const o = single(0.03), c = enumerateCandidates(o)[0];
  const leg = { ...c.action, amountIn: String(15000n * U) };
  assert.equal(reserveCandidate(o, { ...c, action: { type: "bundle", actions: [leg, leg] } }), false);
  assert.equal(reserveCandidate(o, c), true);
});
test("R3 admits fee-adjusted 55bps without subtracting the old 60bps again", t => {
  red(t, "R3-entry", p => assert.equal(action(restoring(), p).type, "swap"), "R3_ENTRY_ONLY");
  const o = restoring(), c = enumerateCandidates(o)[0];
  assert.ok(Math.abs(c.edge - 0.0055) < 1e-12);
  assert.ok(Math.abs(c.usd - 825) < 0.00001);
  assert.ok(Math.abs(c.profit - c.usd * (0.0055 - c.usd / 300000)) < 1e-8);
});
test("R3 threshold changes admission only, never admitted size or profit", () => {
  const p45 = { ...PARAMS, ENTRY_BPS: 45 } as const;
  assert.equal(entryAllowed(0.005, PARAMS), false);
  assert.equal(entryAllowed(0.0045, p45), false);
  assert.equal(action(restoring(0.0048)).type, "noop");
  assert.equal(action(restoring(0.0048), p45).type, "swap");
  for (const o of [single(0.02), restoring(), bundle()]) {
    assert.deepEqual(enumerateCandidates(o, PARAMS), enumerateCandidates(o, p45));
    assert.deepEqual(action(o, PARAMS), action(o, p45));
  }
  assert.equal(economicEdge(0.02, PARAMS), 0.02);
  assert.equal(profitUsd(1000, 0.02, 1 / 300000, 1), 1000 * (0.02 - 1000 / 300000));
});
test("R3 an extra 60bps deduction changes the economics even when both entries pass", () => {
  const o = single(0.02), c = enumerateCandidates(o)[0], a = action(o);
  assert.equal(a.type, "swap");
  assert.ok(Math.abs(c.edge - 0.02) < 1e-12);
  assert.ok(Math.abs(c.usd - 3000) < 0.00001);
  assert.ok(Math.abs(c.profit - 30) < 0.00001);
  const off = enumerateCandidates(o, { ...PARAMS, R3_ENTRY_ONLY: false })[0];
  assert.ok(off.usd < c.usd); assert.ok(off.profit < c.profit);
});
test("R3 subtracts impact and the actual total gas bid before final admission", () => {
  const o = restoring();
  const c = enumerateCandidates(o)[0], a = action(o);
  assert.equal(a.type, "swap");
  const fee = BigInt(a.maxPriorityFeePerGasWei);
  assert.ok(Math.abs(netProfitUsd(o, c, fee) - (c.profit - Number(fee) * 200000 * 3000 / 1e18)) < 1e-12);
  assert.ok(netProfitUsd(o, c, fee) > 0);
  o.limits.defaultPriorityFeePerGasWei = "100000000000";
  o.limits.maxPriorityFeePerGasWei = "100000000000";
  assert.ok(c.profit > 0);
  assert.ok(netProfitUsd(o, c, 100000000000n) < 0);
  assert.equal(action(o).type, "noop", "positive gross profit cannot bypass gas cost");
});
test("R4 pays competitor plus 0.1gwei and never exceeds the same-input V0 bid", t => {
  red(t, "R4-bid", p => assert.equal(action(single(0.02), p).maxPriorityFeePerGasWei, "200000000"), "R4_COMPETITOR_BID");
  for (const profit of [0.01, 0.1, 1, 10, 100]) for (const gas of [200000, 350000]) {
    const o = observation(), fee = bidWei(o, profit, gas, true);
    assert.ok(fee <= v0Bid(o, profit, gas, "budget10"));
    if (fee > 0n) {
      assert.equal(fee, 200000000n);
      assert.ok(Number(fee - 100000000n) * gas * 3000 / 1e18 <= profit * 0.1);
    }
  }
});
test("R4 unaffordable competitor or zero ceiling is a skip, never priority0 submission", () => {
  for (const o of [single(0.02), bundle()]) {
    o.competition!.maxCompetitorPriorityFeeWei = "999999999999";
    assert.equal(action(o).type, "noop");
    assert.notEqual(action(o, { ...PARAMS, R4_COMPETITOR_BID: false }).type, "noop");
    o.competition!.maxCompetitorPriorityFeeWei = "0";
    o.limits.maxPriorityFeePerGasWei = "0";
    assert.equal(action(o).type, "noop");
  }
  const o = restoring();
  assert.equal(bidWei(o, 0.01, 200000, true), 0n, "economic budget cannot afford target");
  o.limits.maxPriorityFeePerGasWei = "150000000";
  assert.equal(action(o).type, "noop", "ceiling cannot afford target");
});
test("R4 native gas reserve includes the whole bid, with exact headroom boundary", () => {
  const o = single(0.02), a = action(o);
  const required = 200000n * BigInt(a.maxPriorityFeePerGasWei);
  o.balances.ethWei = String(W / 20n + required);
  assert.equal(action(o).type, "swap");
  o.balances.ethWei = String(W / 20n + required - 1n);
  assert.equal(action(o).type, "noop");
  o.balances.ethWei = String(W / 20n);
  assert.equal(action(o).type, "noop");
});
test("R5 endgame restores only profitable inventory deviations", t => {
  for (const buy of [true, false]) {
    const o = restoring(0.02, buy); o.dayBlocksRemaining = 4;
    red(t, `R5-restore-${buy ? "buy" : "sell"}`, p => {
      const a = action(o, p);
      assert.equal(a.type, "swap"); assert.equal(a.tokenIn, buy ? "USDC" : "WETH");
      assert.equal(a.slippageBps, 80); safeAction(o, a);
    }, "R5_PROFITABLE_RESTORE");
  }
});
test("R5 never forces a zero-profit or negative-profit sale at the boundary", () => {
  for (const held of [7n * W, 9n * W, 12n * W]) {
    const o = observation(); o.balances.wethWei = String(held); o.blocksRemaining = 3;
    assert.equal(action(o).type, "noop");
  }
  const o = bundle(); o.blocksRemaining = 4;
  assert.equal(action(o).type, "noop", "no new bundle or directional risk in endgame");
});
test("R5 restoration cannot pass when gas consumes its gross edge", () => {
  const o = restoring(0.02, false); o.blocksRemaining = 3;
  assert.equal(action(o).type, "swap");
  o.limits.defaultPriorityFeePerGasWei = "100000000000";
  o.limits.maxPriorityFeePerGasWei = "100000000000";
  assert.equal(action(o).type, "noop");
});
test("R5 single and bundle slippage remain 80bps", () => {
  for (const o of [single(0.02), bundle()]) {
    const a = action(o); assert.notEqual(a.type, "noop");
    for (const leg of a.type === "bundle" ? a.actions : [a]) assert.equal(leg.slippageBps, 80);
  }
});
test("R5 one funded leg never becomes an unfunded bundle", () => {
  for (const token of ["USDC", "WETH"]) {
    const o = bundle();
    if (token === "USDC") o.balances.usdcUnits = "0";
    else o.balances.wethWei = "0";
    const a = action(o);
    assert.notEqual(a.type, "bundle"); assert.notEqual(a.type, "noop");
    safeAction(o, a);
  }
  const o = bundle(); o.balances.wethWei = "1"; safeAction(o, action(o));
});
test("R2/R5 preserve the 20 percent band for each independent bundle leg", () => {
  for (const held of [6.4, 6.5, 8, 9.5, 9.6]) {
    const o = bundle(); o.balances.wethWei = String(BigInt(Math.round(held * 1e6)) * 10n ** 12n);
    const all = enumerateCandidates(o);
    for (const c of all) {
      const legs = c.action.type === "bundle" ? c.action.actions : [c.action];
      for (const leg of legs) {
        if (leg.tokenIn === "USDC") {
          const mid = leg.type === "swap" ? 2900 : 3100;
          assert.ok(held + Number(leg.amountIn) / 1e6 / mid * 1.008 <= 9.6 + 1e-12);
        } else assert.ok(held - Number(leg.amountIn) / 1e18 >= 6.4 - 1e-12);
        assert.equal(leg.slippageBps, 80);
      }
    }
    safeAction(o, action(o));
  }
});
test("WBTC bundles and singles retain real eight-decimal funding and band bounds", () => {
  const o = observation();
  o.protocols.uniswap!.markets = { "WBTC/USDC": { ...o.protocols.uniswap!.pool,
    pair: "WBTC/USDC", priceUsdcPerWeth: 57000 } };
  o.protocols.balancer = { priceUsdcPerWeth: 3000, markets: { "WBTC/USDC": {
    priceUsdcPerWeth: 63000, effectiveHalfSpreadBps: 30, buyPriceUsdcPerWeth: 63189,
    sellPriceUsdcPerWeth: 62811, reserves: { usdc: String(300000n * U), weth: "500000000" },
  } } };
  const a = action(o); assert.equal(a.type, "bundle");
  for (const leg of a.actions) assert.equal(leg.base, "WBTC");
  safeAction(o, a);
  assert.ok(BigInt(a.actions[1].amountIn) <= 8000000n);
  o.baseBalances!.WBTC = "0";
  const empty = action(o); assert.notEqual(empty.type, "bundle"); safeAction(o, empty);
});
test("specialty modules stay off, including inherited collateral and excess ETH", () => {
  const o = observation(); o.protocols.liquity = liquity({ eusdBalanceWei: String(1000n * W) });
  o.protocols.liquity.riskiestTrove!.icr = 1.05;
  o.balances.ethWei = String(3n * W);
  o.balances.stables = { DAI: { token: "DAI", balance: String(1000n * W), decimals: 18, priceUsdc: 0.9, marketQuoted: true } };
  assert.equal(action(o).type, "noop");
  o.protocols.uniswap!.pool.priceUsdcPerWeth = 2900;
  assert.equal(action(o).type, "swap");
});
test("malformed inputs, unavailable venues, horizons and deadline fail closed", () => {
  const cases = [single(0.02), single(0.02), single(0.02), single(0.02), single(0.02)];
  cases[0].balances.usdcUnits = "bad";
  cases[1].protocols.uniswap!.pool.liquidity = "0";
  cases[2].enabledProtocols = [];
  cases[3].blocksRemaining = undefined;
  cases[4].baseDecimals!.WETH = 8;
  for (const o of cases) assert.equal(action(o).type, "noop");
  assert.equal(createAgent()(null as unknown as AgentObservation).type, "noop");
  const o = bundle(); o.dayBlocksRemaining = 0; assert.equal(action(o).type, "noop");
  let clock = 0;
  assert.equal(createAgent(PARAMS, () => clock++ ? 4000 : 0)(bundle()).reason, "decision deadline reserve");
});
test("duplicate guard and run, block and horizon resets preserve independent state", () => {
  const next = createAgent();
  assert.equal(next(single(0.02)).type, "swap");
  assert.equal(next(single(0.02)).reason, "duplicate observation");
  const fresh = single(0.02, true, 101); fresh.runId = "new";
  assert.equal(next(fresh).type, "swap");
  assert.equal(next(single(0.02, true, 1)).type, "swap");
  const horizon = single(0.02, true, 2); horizon.blocksRemaining = 400;
  assert.equal(next(horizon).type, "swap");
  const a = createAgent(), b = createAgent();
  a(single(0.02)); assert.equal(b(single(0.02, true, 101)).type, "swap");
});
test("source closure has only SDK types and affordable; context and hidden inputs are unused", () => {
  const source = readFileSync(new URL("../example/agents/xb-r/agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\s*[.[]|import\.meta\.env|Math\.random|\bfetch\s*\(|publicClient\s*\.|\bseed\b|\bregime\b|futureEvents|rawTx|approve/);
  assert.doesNotMatch(source, /from ["'].*(?:multi-arb|clean-arb|xb-core)/);
  let touches = 0;
  const ctx = new Proxy({}, { get() { touches++; throw Error("context access"); } }) as AgentContext;
  const o = bundle();
  assert.equal(createAgent()(o, ctx).type, "bundle"); assert.equal(touches, 0);
  o.runId = "opaque-seed-and-regime"; o.agentAddress = "0x0000000000000000000000000000000000000099";
  assert.deepEqual(action(o), action(bundle()));
});
