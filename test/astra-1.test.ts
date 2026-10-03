import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import type { AgentAction, AgentObservation } from "@eris/sdk";
import { swapSchema, balancerSwapSchema, curveSwapSchema } from "../sdk/src/actionSchema.js";
import { parseAction, validateAction } from "../sdk/src/action.js";
import { initProtocols } from "../sdk/src/protocols/registry.js";
import { decide, PARAMS, selectFee } from "../example/agents/astra-1/agent.js";

const E18 = 10n ** 18n;
function obs(price = 2940, depth = 1_000_000): AgentObservation {
  return {
    kind: "observation", runId: "astra-unit", round: 90, blockNumber: "90000",
    agentAddress: "0x0000000000000000000000000000000000000001",
    fairPriceUsdcPerWeth: 3000, fairPricesUsd: { WETH: 3000 },
    oraclePrices: { wethUsd: 3000, usdcUsd: 1 },
    blocksRemaining: 270, enabledProtocols: ["uniswap", "balancer", "curve"],
    balances: { ethWei: E18.toString(), wethWei: (8n * E18).toString(), usdcUnits: "25000000000" },
    inventory: { valueUsdc: 76000, weth: 8, usdc: 25000, eth: 1 },
    history: Array.from({ length: 6 }, (_, i) => ({ round: i + 84,
      fairPriceUsdcPerWeth: 3000, poolPriceUsdcPerWeth: price })),
    limits: { defaultPriorityFeePerGasWei: "100000000",
      maxPriorityFeePerGasWei: "10000000000", defaultSlippageBps: 50 },
    protocols: { uniswap: { positions: [], pool: {
      pair: "WETH/USDC", priceUsdcPerWeth: price, fee: 3000, tick: 0, tickSpacing: 60,
      liquidity: BigInt(Math.floor(depth * 1e12 / Math.sqrt(price))).toString(),
    } } },
  };
}
function swap(o: AgentObservation) {
  const a = decide(o);
  assert.ok(a.type === "swap" || a.type === "balancerSwap" || a.type === "curveSwap", JSON.stringify(a));
  const schemas = { swap: swapSchema, balancerSwap: balancerSwapSchema, curveSwap: curveSwapSchema };
  schemas[a.type].parse(a);
  return a;
}
function btc(price = 58800): AgentObservation {
  const o = obs(3000);
  o.fairPricesUsd!.WBTC = 60000;
  o.baseBalances = { WBTC: "40000000" };
  o.baseDecimals = { WETH: 18, WBTC: 8 };
  o.protocols.uniswap!.markets = { "WBTC/USDC": {
    pair: "WBTC/USDC", priceUsdcPerWeth: price, fee: 3000, tick: 0, tickSpacing: 60,
    liquidity: BigInt(Math.floor(1_000_000 * 1e7 / Math.sqrt(price))).toString(),
  } };
  return o;
}
function amm(price: number, halfSpread = 30) {
  return { priceUsdcPerWeth: price,
    buyPriceUsdcPerWeth: price * (1 + halfSpread / 10000),
    sellPriceUsdcPerWeth: price / (1 + halfSpread / 10000),
    effectiveHalfSpreadBps: halfSpread,
    reserves: { weth: (400n * E18).toString(), usdc: "1000000000000" } };
}

test("fair-price buys/sells are funded single swaps accepted by SDK validation", () => {
  initProtocols(["uniswap", "balancer", "curve"]);
  for (const price of [2940, 3060]) {
    const o = obs(price);
    const a = swap(o);
    assert.equal(a.tokenIn, price < 3000 ? "USDC" : "WETH");
    const parsed = parseAction(a);
    const v = validateAction(parsed, o, {
      ethWei: E18, wethWei: 8n * E18, usdcUnits: 25000000000n,
    });
    assert.equal(v.ok, true, JSON.stringify(v, (_, v) => typeof v === "bigint" ? String(v) : v));
    assert.ok(a.slippageBps! <= PARAMS.maxSlippageBps);
  }
});

test("quiet and fee-only deviations do not churn", () => {
  for (const price of [3000, 2990, 3010]) assert.equal(decide(obs(price)).type, "noop");
});

test("dynamic executable spreads reject phantom Curve profit", () => {
  const o = obs(3000);
  o.protocols.curve = amm(2940, 250);
  assert.equal(decide(o).type, "noop");
  o.protocols.curve = amm(2940, 30);
  assert.equal(swap(o).type, "curveSwap");
});

test("all three venue paths can trade and rich quotes sell correctly", () => {
  for (const venue of ["balancer", "curve"] as const) {
    const o = obs(3000);
    o.protocols[venue] = amm(3060);
    const a = swap(o);
    assert.equal(a.type, venue === "curve" ? "curveSwap" : "balancerSwap");
    assert.equal(a.tokenIn, "WETH");
  }
});

test("selection ranks modeled dollars, not the widest raw gap", () => {
  const o = obs(2940, 20000); // wider edge but thin book
  o.protocols.balancer = amm(2960);
  assert.equal(swap(o).type, "balancerSwap");
});

test("a liquidity pull shrinks size; absent or zero depth skips venue", () => {
  const thick = BigInt(swap(obs()).amountIn);
  const thin = BigInt(swap(obs(2940, 80000)).amountIn);
  assert.ok(thin < thick && thin <= 200000000n);
  for (const liquidity of [undefined, "0", "bad"]) {
    const o = obs();
    o.protocols.uniswap!.pool.liquidity = liquidity;
    assert.equal(decide(o).type, "noop");
  }
});

test("unknown two-sided quotes and reserves fail closed", () => {
  for (const venue of ["balancer", "curve"] as const) {
    const o = obs(3000);
    o.protocols[venue] = { priceUsdcPerWeth: 2900 };
    assert.equal(decide(o).type, "noop");
    o.protocols[venue] = amm(2900);
    delete o.protocols[venue]!.reserves;
    assert.equal(decide(o).type, "noop");
  }
});

test("WBTC buys and sells use 8 decimals, including missing-decimals fallback", () => {
  for (const explicit of [true, false]) {
    const buy = btc();
    const sell = btc(61200);
    if (!explicit) { delete buy.baseDecimals; delete sell.baseDecimals; }
    assert.equal(swap(buy).base, "WBTC");
    const a = swap(sell);
    assert.equal(a.base, "WBTC");
    assert.equal(a.tokenIn, "WBTC");
    assert.ok(BigInt(a.amountIn) > 1000n && BigInt(a.amountIn) < 2000000n);
  }
});

test("cash reserve and zero-base funding guard prevent unfundable trades", () => {
  const buy = obs();
  buy.balances.usdcUnits = "8000000000";
  assert.equal(decide(buy).type, "noop");
  const sell = obs(3060);
  sell.balances.wethWei = "0";
  assert.equal(decide(sell).type, "noop");
  const b = btc(61200);
  b.baseBalances!.WBTC = "0";
  assert.equal(decide(b).type, "noop");
});

test("inventory upper/lower band blocks expansion and permits restoration", () => {
  const high = obs(); high.balances.wethWei = "9600000000000000000";
  assert.equal(decide(high).type, "noop");
  high.protocols.uniswap!.pool.priceUsdcPerWeth = 3060;
  assert.equal(swap(high).tokenIn, "WETH");
  const low = obs(3060); low.balances.wethWei = "6400000000000000000";
  assert.equal(decide(low).type, "noop");
  low.protocols.uniswap!.pool.priceUsdcPerWeth = 2940;
  assert.equal(swap(low).tokenIn, "USDC");
});

test("crash/spike uncertainty blocks marginal gaps symmetrically", () => {
  for (const previous of [3300, 2700]) {
    const o = obs();
    o.history.forEach(h => { h.fairPriceUsdcPerWeth = previous; });
    assert.equal(decide(o).type, "noop");
  }
});

test("moderate stress keeps strong edges but cuts per-trade size", () => {
  const normal = obs(2760);
  const stress = structuredClone(normal);
  stress.history.forEach(h => { h.fairPriceUsdcPerWeth = 2970; });
  assert.ok(BigInt(swap(stress).amountIn) < BigInt(swap(normal).amountIn));
  assert.ok(BigInt(swap(stress).amountIn) <= 300000000n);
});

test("lending oracle incident does not replace the fair reference", () => {
  const o = obs();
  const before = decide(o);
  o.oraclePrices.wethUsd = 300;
  assert.deepEqual(decide(o), before);
});

test("last 24 blocks only restore initial inventory; last 6 stop", () => {
  const o = obs(); o.blocksRemaining = 24;
  assert.equal(decide(o).type, "noop");
  o.balances.wethWei = "7900000000000000000";
  const a = swap(o);
  assert.equal(a.tokenIn, "USDC");
  assert.ok(Number(a.amountIn) / 1e6 / (2940 / 0.997) <= 0.100001);
  o.blocksRemaining = 6;
  assert.equal(decide(o).type, "noop");
  o.blocksRemaining = 0;
  assert.equal(decide(o).type, "noop");
});

test("shortest epoch/day clock wins; unknown/invalid clock stops", () => {
  for (const remaining of [undefined, NaN, -1]) {
    const o = obs(); o.blocksRemaining = remaining;
    assert.equal(decide(o).type, "noop");
  }
  const o = obs(); o.dayBlocksRemaining = 5;
  assert.equal(decide(o).type, "noop");
});

test("gas floor and uneconomic gas reject otherwise profitable opportunities", () => {
  const o = obs(); o.balances.ethWei = "10000000000000000";
  assert.equal(decide(o).type, "noop");
  const expensive = obs();
  expensive.limits.defaultPriorityFeePerGasWei = "100000000000";
  expensive.limits.maxPriorityFeePerGasWei = "100000000000";
  assert.equal(decide(expensive).type, "noop");
});

function contention(): AgentObservation {
  const o = obs();
  o.competition = { maxCompetitorPriorityFeeWei: "150000000",
    maxBlockPriorityFeeWei: "150000000", lastTxIndex: 4,
    recentRevertRate: 0.4, recentSampleSize: 12 };
  return o;
}
test("fee bump requires positive modeled incremental profit net of gas", () => {
  const o = contention();
  assert.equal(selectFee(o, 10, 450000, 3000), 150000001n);
  assert.equal(selectFee(o, 0.1, 450000, 3000), 100000000n);
  const extraGas = Number(150000001n - 100000000n) * 450000 * 3000 / 1e18;
  assert.ok(10 * 0.2 - extraGas > 0);
});

test("no blind fee escalation, no partial losing bid, always enforce max fee", () => {
  const o = contention();
  o.competition!.recentSampleSize = 2;
  assert.equal(selectFee(o, 100, 450000, 3000), 100000000n);
  o.competition!.recentSampleSize = 12;
  o.competition!.maxCompetitorPriorityFeeWei = "400000000";
  assert.equal(selectFee(o, 100, 450000, 3000), 100000000n);
  o.limits.maxPriorityFeePerGasWei = "50000000";
  assert.equal(selectFee(o, 100, 450000, 3000), 50000000n);
});

test("nonfinite prices/fees and wrong decimals do not produce actions", () => {
  for (const bad of [NaN, Infinity, 0, -1]) {
    const o = obs(); o.fairPricesUsd!.WETH = bad;
    assert.equal(decide(o).type, "noop");
    const p = obs(); p.protocols.uniswap!.pool.priceUsdcPerWeth = bad;
    assert.equal(decide(p).type, "noop");
  }
  const b = btc(); b.baseDecimals!.WBTC = 18;
  assert.equal(decide(b).type, "noop");
  const o = obs(); o.protocols.uniswap!.pool.fee = Infinity;
  assert.equal(decide(o).type, "noop");
});

test("launch tokens, disabled venues and excessive gaps are skipped", () => {
  const o = obs(3000);
  o.fairPricesUsd!.LAUNCH = 10;
  o.protocols.uniswap!.markets = { "LAUNCH/USDC": {
    pair: "LAUNCH/USDC", fee: 3000, priceUsdcPerWeth: 1,
    tick: 0, tickSpacing: 60, liquidity: "99999999999999999999",
  } };
  assert.equal(decide(o).type, "noop");
  const disabled = obs(); disabled.enabledProtocols = [];
  assert.equal(decide(disabled).type, "noop");
  assert.equal(decide(obs(1000)).type, "noop");
});

test("deterministic stateless decisions do not mutate observations", () => {
  const o = btc(); const before = structuredClone(o);
  assert.deepEqual(decide(o), decide(structuredClone(o)));
  assert.deepEqual(o, before);
  decide(obs(3100));
  assert.deepEqual(decide(o), decide(before));
});

test("synthetic state grid preserves funding, cash and planned inventory bounds", () => {
  let traded = 0;
  for (const price of [2850, 2940, 3000, 3060, 3150])
    for (const held of [0, 6.4, 7.9, 8, 8.1, 9.6, 12])
      for (const cash of [0, 8000, 8100, 25000]) {
        const o = obs(price); o.balances.wethWei = BigInt(Math.round(held * 1e18)).toString();
        o.balances.usdcUnits = String(cash * 1e6);
        const a = decide(o);
        if (a.type === "noop") continue;
        assert.ok(a.type === "swap"); traded++;
        const amount = Number(a.amountIn) / (a.tokenIn === "USDC" ? 1e6 : 1e18);
        if (a.tokenIn === "USDC") {
          assert.ok(cash - amount >= PARAMS.cashReserveUsd - 1e-6);
          assert.ok(held + amount / (price / 0.997) <= 9.6 + 1e-9);
        } else {
          assert.ok(amount <= held);
          assert.ok(held - amount >= 6.4 - 1e-9);
        }
      }
  assert.ok(traded > 20, "positive control: grid must exercise trades");
});

test("decision computation is lightweight (1000 synthetic observations, no RPC)", () => {
  const o = btc(); const start = performance.now();
  for (let i = 0; i < 1000; i++) decide(o);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 5000, `1000 decisions took ${elapsed}ms`);
});

test("prompt contains release contract and restricts revision scope", () => {
  const prompt = readFileSync(new URL("../example/agents/astra-1/prompt.md", import.meta.url), "utf8");
  for (const phrase of ["kind: improve", "name: astra-1", "reviseEveryBlocks: 60",
    "transactions since the last revision", "market history", "mean inclusion latency",
    "executorTs", "revertTo", "ONLY numeric PARAMS and safety guards"])
    assert.ok(prompt.includes(phrase), phrase);
  assert.ok(!prompt.includes("rolled back automatically"));
});
