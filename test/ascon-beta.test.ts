import assert from "node:assert/strict";
import test from "node:test";
import type { AgentObservation } from "@eris/sdk";
import { chooseAction, parseBetaParams, PARAMS } from "../example/agents/ascon-beta/agent.js";

const WETH = 10n ** 18n;
const USDC = 10n ** 6n;
function observation(price: number, overrides: Record<string, unknown> = {}): AgentObservation {
  return {
    kind: "observation",
    runId: "test",
    round: 1,
    blockNumber: "1",
    agentAddress: "0x0000000000000000000000000000000000000001",
    fairPriceUsdcPerWeth: 100,
    fairPricesUsd: { WETH: 100 },
    baseDecimals: { WETH: 18 },
    baseBalances: {},
    blocksRemaining: 100,
    enabledProtocols: ["uniswap"],
    balances: { ethWei: "1000000000000000000", wethWei: (8n * WETH).toString(), usdcUnits: (25_000n * USDC).toString() },
    inventory: { valueUsdc: 25_800, weth: 8, usdc: 25_000, eth: 1 },
    history: [],
    limits: { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: "1000000000", defaultSlippageBps: 50 },
    protocols: { uniswap: { pool: { priceUsdcPerWeth: price, fee: 3000, liquidity: "1000000000000000000" } } },
    ...overrides,
  } as unknown as AgentObservation;
}

test("gap within venue fee and margin is noop", () => {
  assert.equal(chooseAction(observation(100 * (1 - 0.007))), null);
});

test("cheap venue buys base and rich venue sells base", () => {
  const buy = chooseAction(observation(98));
  assert.equal(buy?.type, "swap");
  assert.equal((buy as { tokenIn: string }).tokenIn, "USDC");
  const sell = chooseAction(observation(102));
  assert.equal(sell?.type, "swap");
  assert.equal((sell as { tokenIn: string }).tokenIn, "WETH");
});

test("inventory beyond upper band rejects buys", () => {
  const obs = observation(98, { balances: { ethWei: "1000000000000000000", wethWei: (11n * WETH).toString(), usdcUnits: (25_000n * USDC).toString() } });
  assert.equal(chooseAction(obs), null);
});

test("endgame never sells the initial endowment", () => {
  const obs = observation(102, { blocksRemaining: 2 });
  assert.equal(chooseAction(obs), null);
  const excess = observation(102, { blocksRemaining: 2, balances: { ethWei: "1000000000000000000", wethWei: (9n * WETH).toString(), usdcUnits: (25_000n * USDC).toString() } });
  const action = chooseAction(excess);
  assert.equal((action as { tokenIn: string }).tokenIn, "WETH");
  assert.ok(BigInt((action as { amountIn: string }).amountIn) <= WETH);
});

test("invalid parameter values fall back per field; partial JSON overrides defaults", () => {
  assert.equal(parseBetaParams("not-json").marginBps, PARAMS.marginBps);
  assert.equal(parseBetaParams('{"marginBps":-1}').marginBps, PARAMS.marginBps);
  assert.equal(parseBetaParams('{"marginBps":80}').marginBps, 80);
  assert.equal(parseBetaParams('{"marginBps":80}').maxSizeBps, PARAMS.maxSizeBps);
});
