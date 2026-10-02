import test from "node:test";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk";
import { chooseArbitrage } from "../example/agents/ascon-alpha/agent.js";

function observation(prices: [number, number, number], overrides: Record<string, unknown> = {}) {
  return {
    kind: "observation",
    round: 1,
    fairPriceUsdcPerWeth: 2000,
    fairPricesUsd: { WETH: 2000 },
    baseDecimals: { WETH: 18 },
    balances: { wethWei: "1000000000000000000", usdcUnits: "25000000000", ethWei: "1000000000000000000" },
    baseBalances: {},
    protocols: {
      uniswap: { pool: { priceUsdcPerWeth: prices[0], fee: 3000 } },
      balancer: { priceUsdcPerWeth: prices[1], sellPriceUsdcPerWeth: prices[1] * 0.997, buyPriceUsdcPerWeth: prices[1] * 1.003, effectiveHalfSpreadBps: 30 },
      curve: { priceUsdcPerWeth: prices[2], sellPriceUsdcPerWeth: prices[2] * 0.996, buyPriceUsdcPerWeth: prices[2] * 1.004, effectiveHalfSpreadBps: 40 },
    },
    limits: { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: "3000000000", defaultSlippageBps: 100 },
    competition: { maxCompetitorPriorityFeeWei: "0", maxBlockPriorityFeeWei: "0", lastTxIndex: null, recentRevertRate: 0, recentSampleSize: 0 },
    blocksRemaining: 100,
    ...overrides,
  } as unknown as AgentObservation;
}

test("spread inside fees and safety allowance is a no-op", () => {
  assert.equal(chooseArbitrage(observation([2000, 2003, 1998])), null);
});

test("large cross-venue spread buys cheap and sells rich in a bundle", () => {
  const action = chooseArbitrage(observation([2000, 2200, 1900]));
  assert.equal(action?.type, "bundle");
  if (action?.type !== "bundle") return;
  assert.equal(action.actions[0].type, "curveSwap");
  assert.equal(action.actions[0].tokenIn, "USDC");
  assert.equal(action.actions[1].type, "balancerSwap");
  assert.equal(action.actions[1].tokenIn, "WETH");
});

test("zero quote balance cannot send the buy leg", () => {
  assert.equal(chooseArbitrage(observation([2000, 2200, 1900], { balances: { wethWei: "1000000000000000000", usdcUnits: "0", ethWei: "1000000000000000000" } })), null);
});

test("final blocks open no new bundle and never unwind starting inventory", () => {
  // Same large spread that triggers a bundle with 100 blocks left must be a no-op near the boundary.
  assert.equal(chooseArbitrage(observation([2000, 2200, 1900], { blocksRemaining: 2 })), null);
  assert.equal(chooseArbitrage(observation([2000, 2200, 1900], { blocksRemaining: 3 })), null);
  assert.equal(chooseArbitrage(observation([2000, 2200, 1900], { blocksRemaining: 4 }))?.type, "bundle");
});
