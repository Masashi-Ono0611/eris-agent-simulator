import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext, AgentObservation } from "@eris/sdk";
import { BASE_PARAMS, bidWei, createAgent, entryAllowed, funded, profitUsd, sizeUsd } from "../example/agents/xb-core/agent.js";
import { PARAMS as MOD } from "../example/agents/xb-v6/agent.js";
import { PARAMS as GATE } from "../example/agents/xb-v7/agent.js";
import { bundle, liquity, observation, safeAction, single, U, W } from "./xb-fixtures.js";

test("entry uses strict cost-adjusted thresholds without changing size or profit", () => {
  assert.equal(entryAllowed(0.006, 60), false);
  assert.equal(entryAllowed(0.002, 20), false);
  assert.equal(entryAllowed(0.004, 60), false);
  assert.equal(entryAllowed(0.004, 20), true);
  assert.equal(sizeUsd(0.01, 1 / 300000, 25000, 5840, "depth"), 750);
  assert.equal(profitUsd(750, 0.01, 1 / 300000, 1), 5.625);
  assert.deepEqual(createAgent(BASE_PARAMS)(single()), createAgent({ ...BASE_PARAMS, A_EDGE_BPS: 20 })(single()));
});
test("balance sizing clamps its desired fraction to 2.5-25 percent with the same 8 percent cap", () => {
  assert.equal(sizeUsd(0.001, 1 / 300000, 10000, 8000, "balance-2.5-25"), 250);
  assert.equal(sizeUsd(0.01, 1 / 300000, 10000, 8000, "balance-2.5-25"), 1000);
  assert.equal(sizeUsd(0.1, 1 / 300000, 10000, 8000, "balance-2.5-25"), 2500);
  for (const mode of ["depth", "balance-2.5-25"] as const)
    assert.equal(sizeUsd(0.1, 1 / 300000, 10000, 100, mode), 100);
});
test("bids are absolute 10 percent budgets, never default plus budget or a forced minimum", () => {
  const o = observation(); o.limits.defaultPriorityFeePerGasWei = "9000000000";
  for (const mode of ["budget10", "competitor+0.1gwei capped by the same 10% budget"] as const) {
    for (const profit of [0, 0.0000001, 0.5, 5, 500]) {
      const fee = bidWei(o, profit, 200000, mode);
      assert.ok(Number(fee) * 200000 * 3000 / 1e18 <= profit * 0.1 + 1e-12);
      assert.ok(fee <= BigInt(o.limits.maxPriorityFeePerGasWei));
    }
  }
  assert.equal(bidWei(o, 50, 200000, "competitor+0.1gwei capped by the same 10% budget"), 200000000n);
  o.competition!.maxCompetitorPriorityFeeWei = "999999999999";
  assert.equal(bidWei(o, 1, 200000, "competitor+0.1gwei capped by the same 10% budget"), bidWei(o, 1, 200000, "budget10"));
  o.limits.maxPriorityFeePerGasWei = "1";
  assert.equal(bidWei(o, 1, 200000, "budget10"), 1n);
});
test("canFund normalization preserves WBTC's real balance limit", () => {
  const o = observation();
  assert.equal(funded(o, "WBTC", 100000n), true);
  assert.equal(funded(o, "WBTC", 40000001n), false);
  assert.equal(funded(o, "USDC", 0n), false);
  assert.equal(funded(o, "WETH", -1n), false);
  o.baseBalances!.WBTC = "1";
  assert.equal(funded(o, "WBTC", 1n), false);
});
test("bundles and single sells are validated against existing inventory", () => {
  const o = bundle(), a = createAgent()(o);
  assert.equal(a.type, "bundle"); safeAction(o, a);
  o.balances.wethWei = "0";
  const empty = createAgent()(o); assert.notEqual(empty.type, "bundle"); safeAction(o, empty);
  const sell = single(0.02, false); const sale = createAgent()(sell);
  assert.equal(sale.tokenIn, "WETH"); safeAction(sell, sale);
});
test("WBTC market uses 8 decimals and can actually sell", () => {
  const o = observation();
  o.protocols.uniswap!.markets = { "WBTC/USDC": { ...o.protocols.uniswap!.pool, pair: "WBTC/USDC", priceUsdcPerWeth: 61500 } };
  const a = createAgent()(o); assert.equal(a.base, "WBTC"); assert.equal(a.tokenIn, "WBTC"); safeAction(o, a);
});
test("zero depth, disabled venues, malformed input and invalid decimals fail closed", () => {
  const o = single(); o.protocols.uniswap!.pool.liquidity = "0";
  assert.equal(createAgent()(o).type, "noop");
  const disabled = single(); disabled.enabledProtocols = [];
  assert.equal(createAgent()(disabled).type, "noop");
  const bad = single(); bad.balances.usdcUnits = "bad";
  assert.equal(createAgent()(bad).type, "noop");
  assert.equal(createAgent()(null as unknown as AgentObservation).type, "noop");
  const decimals = single(); decimals.baseDecimals!.WETH = 8;
  assert.equal(createAgent()(decimals).type, "noop");
});
test("gas reserve is shared and no bid is emitted without transaction headroom", () => {
  const o = single(); o.balances.ethWei = String(W / 20n);
  assert.equal(createAgent()(o).reason, "gas reserve");
  o.balances.ethWei = "0"; assert.equal(createAgent()(o).type, "noop");
});
test("endgame restores both sides of initial inventory and honors the earliest boundary", () => {
  for (const held of [9n * W, 7n * W]) {
    const o = observation(); o.balances.wethWei = String(held); o.dayBlocksRemaining = 4;
    const a = createAgent()(o); assert.equal(a.type, "swap"); assert.equal(a.tokenIn, held > 8n * W ? "WETH" : "USDC"); safeAction(o, a);
  }
  const o = single(); o.blocksRemaining = 0;
  assert.equal(createAgent()(o).type, "noop");
  o.blocksRemaining = undefined;
  assert.equal(createAgent()(o).type, "noop");
});
test("duplicate, cooldown, run change, rewind and horizon reset are bounded", () => {
  const decide = createAgent();
  assert.equal(decide(single()).type, "swap");
  assert.equal(decide(single()).reason, "duplicate observation");
  assert.equal(decide(single(0.01, true, 101)).type, "noop");
  assert.equal(decide(single(0.01, true, 102)).type, "swap");
  const next = single(0.01, true, 103); next.runId = "new";
  assert.equal(decide(next).type, "swap");
  assert.equal(decide(single(0.01, true, 1)).type, "swap");
  const horizon = single(0.01, true, 2); horizon.blocksRemaining = 400;
  assert.equal(decide(horizon).type, "swap");
});
test("GATE stops exactly the shock block plus two blocks, and retriggers on another shock", () => {
  const decide = createAgent(GATE); decide(observation());
  for (const block of [101, 102, 103, 104]) {
    const o = single(0.02, true, block); o.fairPricesUsd!.WETH = 3022.5;
    assert.equal(decide(o).type, block < 104 ? "noop" : "swap");
  }
  const retrigger = single(0.02, true, 105); retrigger.fairPricesUsd!.WETH = 3050;
  assert.equal(decide(retrigger).type, "noop");
});
test("GATE permits endgame and inherited eUSD recoveries during a shock", () => {
  for (const specialty of [false, true]) {
    const decide = createAgent(GATE); decide(observation());
    const o = observation(101); o.fairPricesUsd!.WETH = 3030;
    if (specialty) o.protocols.liquity = liquity({ eusdBalanceWei: String(200n * W) });
    else { o.blocksRemaining = 4; o.balances.wethWei = String(9n * W); }
    const a = decide(o); assert.equal(a.type, specialty ? "liquityRedeem" : "swap"); safeAction(o, a);
  }
});
test("GATE recognizes negative and WBTC shocks, ignores subthreshold moves, and resets on a new run", () => {
  for (const [base, ratio, paused] of [["WETH", 0.9925, true], ["WBTC", 1.0075, true], ["WETH", 1.0074, false]] as const) {
    const decide = createAgent(GATE); decide(observation());
    const o = single(0.03, true, 101); o.fairPricesUsd![base] *= ratio;
    assert.equal(decide(o).type, paused ? "noop" : "swap");
    o.runId = "fresh"; o.blockNumber = "102";
    assert.equal(decide(o).type, "swap");
  }
});
test("RPC budget is zero even with a throwing context; deadline reserve returns noop", () => {
  let touches = 0;
  const ctx = new Proxy({}, { get() { touches++; throw Error("RPC forbidden"); } }) as AgentContext;
  assert.equal(createAgent()(single(), ctx).type, "swap"); assert.equal(touches, 0);
  let tick = 0;
  assert.equal(createAgent(BASE_PARAMS, () => (tick++ ? 4000 : 0))(single()).reason, "decision deadline reserve");
});
test("Liquity buys once within 1200 USDC and redeems only an observed holding", () => {
  const decide = createAgent(MOD), o = observation(); o.protocols.liquity = liquity();
  const a = decide(o); assert.equal(a.type, "liquitySwapEusd"); assert.equal(a.tokenIn, "USDC");
  assert.ok(BigInt(a.amountIn) <= 1200n * U); safeAction(o, a);
  assert.equal(decide({ ...o, blockNumber: "101" }).type, "noop");
  assert.equal(decide({ ...o, blockNumber: "103" }).type, "noop");
  const acquired = observation(104); acquired.protocols.liquity = liquity({ eusdBalanceWei: String(1200n * W) });
  const redeem = decide(acquired); assert.equal(redeem.type, "liquityRedeem");
  assert.equal(redeem.amountEusdWei, String(1200n * W)); safeAction(acquired, redeem);
});
test("Liquity redemption collateral wraps above reserve, confirms balance, then sells only observed proceeds", () => {
  const decide = createAgent(MOD);
  const o = observation(); o.protocols.liquity = liquity({ eusdBalanceWei: String(1000n * W) });
  assert.equal(decide(o).type, "liquityRedeem");
  const paid = observation(103); paid.balances.ethWei = String(W + W / 3n); paid.protocols.liquity = liquity();
  const wrap = decide(paid); assert.equal(wrap.type, "rawTx"); assert.equal(wrap.tx.value, String(W / 3n)); safeAction(paid, wrap);
  assert.equal(decide({ ...paid, blockNumber: "104" }).reason, "await wrapped collateral balance");
  const wrapped = observation(105); wrapped.balances.wethWei = String(8n * W + W / 3n);
  const sale = decide(wrapped); assert.equal(sale.tokenIn, "WETH"); assert.equal(sale.amountIn, String(W / 3n)); safeAction(wrapped, sale);
  assert.equal(decide({ ...wrapped, blockNumber: "106" }).reason, "await collateral sale balance");
  const filled = observation(108);
  assert.equal(decide(filled).type, "noop");
});
test("Liquity failed wrap and sale wait five blocks before bounded retries", () => {
  const decide = createAgent(); const o = observation(); o.balances.ethWei = String(W + W / 5n);
  assert.equal(decide(o).type, "rawTx");
  assert.equal(decide({ ...o, blockNumber: "104" }).type, "noop");
  assert.equal(decide({ ...o, blockNumber: "105" }).type, "rawTx");
  const wrapped = observation(106); wrapped.balances.wethWei = String(8n * W + W / 5n);
  assert.equal(decide(wrapped).tokenIn, "WETH");
  assert.equal(decide({ ...wrapped, blockNumber: "110" }).type, "noop");
  assert.equal(decide({ ...wrapped, blockNumber: "111" }).tokenIn, "WETH");
});
test("Liquity common exits survive restart, high fees and closing boundary without betting on repeg", () => {
  for (const left of [10, 3]) {
    const o = observation(); o.blocksRemaining = left;
    o.protocols.liquity = liquity({ eusdBalanceWei: String(700n * W), redemptionRateBps: 2100 });
    const a = createAgent()(o); assert.equal(a.type, "liquitySwapEusd"); assert.equal(a.tokenIn, "EUSD"); safeAction(o, a);
  }
  const unknown = observation(); unknown.protocols.liquity = liquity({ eusdBalanceWei: String(700n * W), marketQuoted: false, troveCount: 1 });
  assert.equal(createAgent()(unknown).reason, "await eUSD recovery route");
});
test("Liquity has no entry near close, without an exit, with thin pool, or without a redeemable trove", () => {
  for (const fault of ["close", "exit", "thin", "trove", "fee", "quote"]) {
    const o = observation(); o.protocols.liquity = liquity();
    if (fault === "close") o.blocksRemaining = 40;
    if (fault === "exit") o.protocols.uniswap = undefined;
    if (fault === "thin") o.protocols.liquity.poolReserves!.usdc = String(100n * U);
    if (fault === "trove") o.protocols.liquity.troveCount = 1;
    if (fault === "fee") o.protocols.liquity.redemptionRateBps = 2100;
    if (fault === "quote") o.protocols.liquity.marketQuoted = false;
    assert.equal(createAgent(MOD)(o).type, "noop", fault);
  }
});
test("Liquity liquidation uses bounded attempts and recovery-mode deposit coverage", () => {
  const o = observation(); o.protocols.liquity = liquity(); o.protocols.liquity.riskiestTrove!.icr = 1.05;
  const decide = createAgent(MOD);
  for (const block of [100, 105, 110]) {
    const a = decide({ ...o, blockNumber: String(block) }); assert.equal(a.type, "liquityLiquidate"); safeAction(o, a);
  }
  assert.equal(decide({ ...o, blockNumber: "115" }).type, "noop");
  o.protocols.liquity.recoveryMode = true; o.protocols.liquity.tcr = 1.4; o.protocols.liquity.riskiestTrove!.icr = 1.2;
  assert.equal(createAgent(MOD)(o).type, "liquityLiquidate");
  o.protocols.liquity.spTotalDepositsEusdWei = "0";
  assert.notEqual(createAgent(MOD)(o).type, "liquityLiquidate");
});
test("MOD plus GATE pauses liquidation and buying while observed rewards still recover", () => {
  const params = { ...MOD, GATE: GATE.GATE };
  for (const liquidate of [false, true]) {
    const decide = createAgent(params); decide(observation());
    const o = observation(101); o.fairPricesUsd!.WETH = 3030; o.protocols.liquity = liquity();
    if (liquidate) o.protocols.liquity.riskiestTrove!.icr = 1.05;
    assert.equal(decide(o).reason, "fair shock: new risk paused");
    o.blockNumber = "102"; o.protocols.liquity.eusdBalanceWei = String(200n * W);
    const recovery = decide(o); assert.notEqual(recovery.type, "noop"); safeAction(o, recovery);
  }
});
