import type { AgentObservation, LiquityObservation } from "@eris/sdk";
import assert from "node:assert/strict";
import type { Action } from "../example/agents/xb-core/agent.js";

// Test-only SDK registry selection; agents have no environment reads.
process.env.ERIS_LOCAL_DEPLOY = "1";
const { parseAction, validateAction } = await import("@eris/sdk/action.js");
const { setEnabledProtocols } = await import("@eris/sdk/protocols/registry.js");
setEnabledProtocols(["uniswap", "balancer", "curve", "liquity"]);

export const W = 10n ** 18n, U = 10n ** 6n;
export function observation(block = 100): AgentObservation {
  return {
    kind: "observation", runId: "xb-fixed", round: block, blockNumber: String(block), blocksRemaining: 360 - block,
    agentAddress: "0x0000000000000000000000000000000000000011", fairPriceUsdcPerWeth: 3000,
    fairPricesUsd: { WETH: 3000, WBTC: 60000 }, baseDecimals: { WETH: 18, WBTC: 8 }, baseBalances: { WBTC: "40000000" },
    oraclePrices: { wethUsd: 3000, usdcUsd: 1 }, enabledProtocols: ["uniswap", "balancer", "curve", "liquity"],
    balances: { ethWei: String(W), wethWei: String(8n * W), usdcUnits: String(25000n * U) },
    inventory: { valueUsdc: 76000, weth: 8, usdc: 25000, eth: 1 }, history: [],
    limits: { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: "10000000000", defaultSlippageBps: 50 },
    competition: { maxCompetitorPriorityFeeWei: "100000000", maxBlockPriorityFeeWei: "100000000", lastTxIndex: null,
      recentRevertRate: 0, recentSampleSize: 0 },
    protocols: { uniswap: { pool: { pair: "WETH/USDC", fee: 3000, tick: 0, tickSpacing: 60, priceUsdcPerWeth: 3000 }, positions: [] } },
  };
}
export function single(edge = 0.01, buy = true, block = 100): AgentObservation {
  const o = observation(block);
  o.protocols.uniswap!.pool.priceUsdcPerWeth = buy ? 3000 / (1 + 0.003 + edge) : 3000 * (1 + 0.003 + edge);
  return o;
}
export function bundle(block = 100): AgentObservation {
  const o = observation(block);
  o.protocols.uniswap!.pool.priceUsdcPerWeth = 2900;
  o.protocols.balancer = { priceUsdcPerWeth: 3100, effectiveHalfSpreadBps: 30,
    buyPriceUsdcPerWeth: 3109.3, sellPriceUsdcPerWeth: 3090.7, reserves: { usdc: String(300000n * U), weth: String(100n * W) } };
  return o;
}
export function liquity(overrides: Partial<LiquityObservation> = {}): LiquityObservation {
  return {
    priceUsd: 3000, tcr: 2, recoveryMode: false, mcr: 1.1, ccr: 1.5, troveCount: 4,
    totalCollWei: String(250n * W), totalDebtEusdWei: String(500000n * W),
    borrowingRateBps: 50, redemptionRateBps: 50, baseRateBps: 0,
    minNetDebtEusdWei: String(1800n * W), gasCompensationEusdWei: String(200n * W), eusdBalanceWei: "0",
    marketPriceUsdc: 0.95, marketSellPriceUsdc: 0.949, marketBuyPriceUsdc: 0.951, marketQuoted: true,
    discountBps: 500, redemptionEdgeBps: 450,
    poolReserves: { eusd: String(250000n * W), usdc: String(200000n * U) },
    riskiestTrove: { owner: "0x0000000000000000000000000000000000000022", icr: 1.4, netDebtEusdWei: String(10000n * W) },
    collSurplusWei: "0", spDepositEusdWei: "0", spEthGainWei: "0", spLqtyGainWei: "0",
    spTotalDepositsEusdWei: String(50000n * W), spShareBps: 0, ethBalanceWei: String(W), suggestedGasReserveWei: String(W / 20n),
    ...overrides,
  };
}
export function safeAction(o: AgentObservation, a: Action): void {
  const parsed = parseAction(a);
  const result = validateAction(parsed, o, {
    ethWei: BigInt(o.balances.ethWei), wethWei: BigInt(o.balances.wethWei), usdcUnits: BigInt(o.balances.usdcUnits),
    bases: { WETH: BigInt(o.balances.wethWei), WBTC: BigInt(o.baseBalances?.WBTC ?? "0") },
  });
  assert.equal(result.ok, true, JSON.stringify(result, (_, v) => typeof v === "bigint" ? v.toString() : v));
  if (a.type === "noop") return;
  const spent = new Map<string, bigint>();
  const cap = 0.08 * (Number(o.balances.usdcUnits) / 1e6 + Number(o.balances.wethWei) / 1e18 * (o.fairPricesUsd?.WETH ?? o.fairPriceUsdcPerWeth)
    + Number(o.baseBalances?.WBTC ?? 0) / 1e8 * (o.fairPricesUsd?.WBTC ?? 0));
  for (const leg of a.type === "bundle" ? a.actions : [a]) {
    for (const key of ["amountIn", "amountEusdWei"])
      if (leg[key] !== undefined) assert.ok(BigInt(leg[key]) > 0n);
    if (leg.amountEusdWei) {
      spent.set("EUSD", (spent.get("EUSD") ?? 0n) + BigInt(leg.amountEusdWei));
      assert.ok(spent.get("EUSD")! <= BigInt(o.protocols.liquity?.eusdBalanceWei ?? "0"), "existing inventory funds redemption");
    }
    if (leg.amountIn) {
      const token = leg.tokenIn as string;
      const held = token === "USDC" ? BigInt(o.balances.usdcUnits) : token === "WETH" ? BigInt(o.balances.wethWei)
        : token === "EUSD" ? BigInt(o.protocols.liquity?.eusdBalanceWei ?? "0") : BigInt(o.baseBalances?.[token] ?? "0");
      spent.set(token, (spent.get(token) ?? 0n) + BigInt(leg.amountIn));
      assert.ok(spent.get(token)! <= held, `existing inventory funds ${token}`);
      if (["swap", "balancerSwap", "curveSwap"].includes(leg.type)) {
        const usd = token === "USDC" ? Number(leg.amountIn) / 1e6
          : Number(leg.amountIn) / (token === "WBTC" ? 1e8 : 1e18) * (o.fairPricesUsd?.[token] ?? o.fairPriceUsdcPerWeth);
        assert.ok(usd <= cap + 1e-6, "common 8 percent asset cap");
      }
    }
  }
  if (a.tx?.value) assert.ok(BigInt(a.tx.value) > 0n && BigInt(a.tx.value) < BigInt(o.balances.ethWei));
  assert.ok(BigInt(a.maxPriorityFeePerGasWei) > 0n);
  assert.ok(BigInt(a.maxPriorityFeePerGasWei) <= BigInt(o.limits.maxPriorityFeePerGasWei));
}

// Independent monetary invariant: only the EXTRA over the effective default floor
// spends the profit budget. Notional rounding can change estimated profit by <1e-6.
export function profitBid(o: AgentObservation, a: Action, profit: number, gas: number): void {
  assert.ok(profit > 0);
  assert.notEqual(a.type, "noop");
  const fee = BigInt(a.maxPriorityFeePerGasWei);
  const ceiling = BigInt(o.limits.maxPriorityFeePerGasWei);
  const configured = BigInt(o.limits.defaultPriorityFeePerGasWei);
  const requested = configured > 0n ? configured : 1n;
  const floor = requested < ceiling ? requested : ceiling;
  assert.ok(fee > 0n, "positive profit must send a positive priority fee");
  assert.ok(fee >= floor && fee <= ceiling, "default floor and runtime ceiling");
  const ethPrice = o.fairPricesUsd?.WETH ?? o.fairPriceUsdcPerWeth;
  assert.ok(Number(fee - floor) * gas * ethPrice / 1e18 <= profit * 0.1 + 1e-7, "EXTRA costs at most 10 percent of profit");
  assert.ok(BigInt(o.balances.ethWei) - BigInt(gas) * fee >= W / 20n, "actual sent fee preserves gas reserve");
}
