// grok-1 decision surface. Synthetic observations only: no chain, no anvil.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentContext } from "@eris/sdk";
import type { AgentObservation, LiquityObservation, LstObservation } from "@eris/sdk/types.js";
import { decide, freshLedger, plan, resetLedger } from "../example/agents/grok-1/agent.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WETH = "8000000000000000000";
const NINE = "9000000000000000000";
const ONE = "1000000000000000000";
const SLICE = "640000000000000000";
const WBTC = "40000000";
const USDC = "25000000000";
const EUSD_HELD = (500n * 10n ** 18n).toString();

function twoSided(mid: number, halfBps: number) {
  const edge = halfBps / 10_000;
  return {
    priceUsdcPerWeth: mid,
    sellPriceUsdcPerWeth: mid * (1 - edge),
    buyPriceUsdcPerWeth: mid * (1 + edge),
    effectiveHalfSpreadBps: halfBps,
  };
}

function liquity(overrides: Partial<LiquityObservation> = {}): LiquityObservation {
  return {
    priceUsd: 3000,
    tcr: 2,
    recoveryMode: false,
    mcr: 1.1,
    ccr: 1.5,
    troveCount: 3,
    totalCollWei: (100n * 10n ** 18n).toString(),
    totalDebtEusdWei: (150_000n * 10n ** 18n).toString(),
    borrowingRateBps: 50,
    redemptionRateBps: 50,
    baseRateBps: 0,
    minNetDebtEusdWei: (1800n * 10n ** 18n).toString(),
    gasCompensationEusdWei: (200n * 10n ** 18n).toString(),
    eusdBalanceWei: "0",
    marketPriceUsdc: 0.988,
    marketQuoted: true,
    discountBps: 0,
    redemptionEdgeBps: 0,
    collSurplusWei: "0",
    spDepositEusdWei: "0",
    spEthGainWei: "0",
    spLqtyGainWei: "0",
    spTotalDepositsEusdWei: "0",
    spShareBps: 0,
    ethBalanceWei: ONE,
    suggestedGasReserveWei: "100000000000000000",
    lqtyBalanceWei: "0",
    lqtyStakedWei: "0", stakingEthGainWei: "0", stakingEusdGainWei: "0",
    ...overrides,
  };
}

function lst(overrides: Partial<LstObservation> = {}): LstObservation {
  return {
    redemptionRateWeth: 1,
    marketPriceWeth: 1,
    discountBps: 0,
    marketQuoted: true,
    apyBps: 300,
    yieldPerBlockBps: 0.03,
    withdrawalDelayBlocks: 20,
    estimatedQueueDelayBlocks: 20,
    queueLength: 0,
    rewardReserveWei: (50n * 10n ** 18n).toString(),
    lstBalanceWei: "0",
    lstRedemptionValueWethWei: "0",
    instantExitWethWei: "0",
    pendingWithdrawals: [],
    pendingWithdrawalWethWei: "0",
    claimableWithdrawalWethWei: "0",
    queueThroughputWeiPerBlock: (10n ** 18n).toString(),
    ...overrides,
  };
}

type Shape = {
  round?: number;
  blocksRemaining?: number;
  wethWei?: string;
  wbtc?: string;
  usdc?: string;
  ethWei?: string;
  fairWeth?: number;
  fairBtc?: number;
  extraFairs?: Record<string, number>;
  history?: AgentObservation["history"];
  uniWeth?: number;
  uniFee?: number;
  uniBtc?: number;
  curveWeth?: ReturnType<typeof twoSided> | null;
  balancerWeth?: ReturnType<typeof twoSided> | null;
  curveBtc?: ReturnType<typeof twoSided> | null;
  gmx?: boolean;
  gmxBtc?: boolean;
  liquity?: LiquityObservation;
  lst?: LstObservation;
  competition?: AgentObservation["competition"];
  stables?: NonNullable<AgentObservation["balances"]["stables"]>;
  discoveredPools?: AgentObservation["discoveredPools"];
  newMarket?: boolean;
};

function makeObs(shape: Shape = {}): AgentObservation {
  const fairWeth = shape.fairWeth ?? 3000;
  const fairBtc = shape.fairBtc ?? 60_000;
  const wethWei = shape.wethWei ?? WETH;
  const wbtc = shape.wbtc ?? WBTC;
  const protocols: AgentObservation["protocols"] = {
    uniswap: {
      pool: {
        pair: "WETH/USDC",
        fee: shape.uniFee ?? 3000,
        priceUsdcPerWeth: shape.uniWeth ?? fairWeth,
        tick: 0,
        tickSpacing: 60,
      },
      positions: [],
      markets: {
        ...(shape.uniBtc !== undefined
          ? {
              "WBTC/USDC": {
                pair: "WBTC/USDC",
                fee: 3000,
                priceUsdcPerWeth: shape.uniBtc,
                tick: 0,
                tickSpacing: 60,
              },
            }
          : {}),
        ...(shape.newMarket
          ? {
              "NEW/USDC": {
                pair: "NEW/USDC",
                fee: 3000,
                priceUsdcPerWeth: 1,
                tick: 0,
                tickSpacing: 60,
              },
            }
          : {}),
      },
    },
  };
  if (shape.curveWeth) protocols.curve = { ...shape.curveWeth };
  if (shape.balancerWeth) protocols.balancer = { ...shape.balancerWeth };
  if (shape.curveBtc) {
    protocols.curve = {
      ...(protocols.curve ?? { priceUsdcPerWeth: fairWeth }),
      markets: { "WBTC/USDC": shape.curveBtc },
    };
  }
  if (shape.gmx !== false) {
    protocols.gmx = {
      marketPriceUsd: fairWeth,
      ...(shape.gmxBtc
        ? { markets: { "WBTC/USDC": { marketPriceUsd: fairBtc } } }
        : {}),
    };
  }
  if (shape.liquity) protocols.liquity = shape.liquity;
  if (shape.lst) protocols.lst = shape.lst;
  return {
    kind: "observation",
    runId: "grok-1",
    round: shape.round ?? 1,
    blockNumber: "1",
    agentAddress: "0x0000000000000000000000000000000000000001",
    fairPriceUsdcPerWeth: fairWeth,
    fairPricesUsd: { WETH: fairWeth, WBTC: fairBtc, ...shape.extraFairs },
    oraclePrices: { wethUsd: fairWeth, usdcUsd: 1 },
    enabledProtocols: ["uniswap", "balancer", "curve", "gmx", "lst", "liquity"],
    balances: {
      ethWei: shape.ethWei ?? ONE,
      wethWei,
      usdcUnits: shape.usdc ?? USDC,
      stables: shape.stables,
    },
    baseBalances: { WETH: wethWei, WBTC: wbtc },
    baseDecimals: { WETH: 18, WBTC: 8 },
    inventory: { valueUsdc: 0, weth: 8, usdc: 25_000, eth: 1 },
    history: shape.history ?? [],
    blocksRemaining: shape.blocksRemaining ?? 200,
    limits: {
      defaultPriorityFeePerGasWei: "100",
      maxPriorityFeePerGasWei: "5000",
      defaultSlippageBps: 50,
    },
    protocols,
    competition: shape.competition,
    discoveredPools: shape.discoveredPools,
  };
}

function act(shape: Shape = {}) {
  return plan(makeObs(shape), freshLedger());
}

test("agent source does not read the process environment", () => {
  const source = readFileSync(join(root, "example/agents/grok-1/agent.ts"), "utf8");
  assert.equal(source.includes("process.env"), false);
  const specs = [...source.matchAll(/from\s+["'](\.\.[^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(specs, ["../lib/markets.js"]);
});

test("a wide cross-venue spread is an atomic bundle, not a single swap", () => {
  const out = act({
    gmx: false,
    uniWeth: 2900,
    curveWeth: twoSided(3310, 30),
  });
  assert.equal(out.action.type, "bundle");
  if (out.action.type !== "bundle") return;
  assert.equal(out.action.actions.length, 2);
  assert.equal(out.action.actions[0].type, "swap");
  assert.equal(out.action.actions[0].tokenIn, "USDC");
  assert.equal(out.action.actions[1].type, "curveSwap");
  assert.equal(out.action.actions[1].tokenIn, "WETH");
});

test("a 10 bps mixed quote does not clear the two-leg cost", () => {
  const out = act({
    uniWeth: 3000,
    balancerWeth: twoSided(3003, 30),
  });
  assert.equal(out.action.type, "noop");
});

test("a fair gap with no GMX market is not taken as a naked swap", () => {
  const out = act({ gmx: false, uniWeth: 2800 });
  assert.equal(out.action.type, "noop");
});

test("a cheap venue with GMX buys, then hedges once, then waits", () => {
  const ledger = freshLedger();
  const first = plan(makeObs({ round: 1, uniWeth: 2800 }), ledger);
  assert.equal(first.action.type, "swap");
  if (first.action.type !== "swap") return;
  assert.equal(first.action.tokenIn, "USDC");
  assert.equal(first.action.amountIn, "2700000000");

  const second = plan(makeObs({ round: 2, uniWeth: 2800, wethWei: NINE }), ledger);
  assert.equal(second.action.type, "gmxIncrease");
  if (second.action.type !== "gmxIncrease") return;
  assert.equal(second.action.isLong, false);
  assert.equal(second.action.collateral, "USDC");
  // $3000 / 1.5 = 2000 USDC, and USDC has 6 decimals.
  assert.equal(second.action.collateralAmount, "2000000000");
  assert.equal(second.action.base, "WETH");
  assert.equal(second.action.sizeDeltaUsd, `${"3000000000"}${"0".repeat(24)}`);

  const third = plan(makeObs({ round: 3, uniWeth: 2800, wethWei: NINE }), ledger);
  assert.equal(third.action.type, "noop");
  assert.match(third.reason, /hedge in flight/);
});

test("the funded basket is not hedged on a flat book", () => {
  const out = act();
  assert.equal(out.action.type, "noop");
});

test("an unaffordable hedge sells only the acquired surplus", () => {
  const ledger = freshLedger();
  plan(makeObs(), ledger);
  const out = plan(makeObs({ round: 2, wethWei: NINE, usdc: "0" }), ledger);
  assert.equal(out.action.type, "swap");
  if (out.action.type !== "swap") return;
  assert.equal(out.action.tokenIn, "WETH");
  assert.equal(out.action.amountIn, ONE);
});

test("a rich AMM does not sell the funded basket", () => {
  const out = act({ uniWeth: 3300 });
  assert.equal(out.action.type, "noop");
});

test("a discounted plain stable is not a stable swap", () => {
  const out = act({
    stables: {
      DAI: {
        token: "0x00000000000000000000000000000000000000da",
        decimals: 18,
        balance: (10_000n * 10n ** 18n).toString(),
        priceUsdc: 0.9,
        marketQuoted: true,
      },
    },
  });
  assert.notEqual(out.action.type, "stableSwap");
  assert.equal(JSON.stringify(out.action).includes("stableSwap"), false);
});

test("eUSD is bought only when the redemption still clears exit cost and safety", () => {
  const buy = act({
    blocksRemaining: 100,
    liquity: liquity({ discountBps: 120, redemptionEdgeBps: 70, redemptionRateBps: 50 }),
  });
  assert.equal(buy.action.type, "liquitySwapEusd");
  if (buy.action.type !== "liquitySwapEusd") return;
  assert.equal(buy.action.tokenIn, "USDC");
  assert.equal(buy.action.amountIn, "4500000000");

  const skip = act({
    blocksRemaining: 100,
    liquity: liquity({ discountBps: 80, redemptionEdgeBps: 30, redemptionRateBps: 50 }),
  });
  assert.equal(skip.action.type, "noop");
});

test("held eUSD is redeemed before a new buy", () => {
  const out = act({
    liquity: liquity({
      eusdBalanceWei: EUSD_HELD,
      discountBps: 120,
      redemptionEdgeBps: 70,
      redemptionRateBps: 50,
    }),
  });
  assert.equal(out.action.type, "liquityRedeem");
  if (out.action.type !== "liquityRedeem") return;
  assert.equal(out.action.amountEusdWei, EUSD_HELD);
});

test("a dead redeem edge holds eUSD and does not take a wide two-leg", () => {
  const out = act({
    uniWeth: 2900,
    curveWeth: twoSided(3310, 30),
    liquity: liquity({
      eusdBalanceWei: EUSD_HELD,
      discountBps: 40,
      redemptionEdgeBps: 10,
      redemptionRateBps: 30,
    }),
  });
  assert.equal(out.action.type, "noop");
  assert.match(out.reason, /holding eUSD/);
});

test("the late window blocks a new eUSD buy and still redeems a position already held", () => {
  const blocked = act({
    blocksRemaining: 10,
    liquity: liquity({ discountBps: 120, redemptionEdgeBps: 70, redemptionRateBps: 50 }),
  });
  assert.equal(blocked.action.type, "noop");
  assert.match(blocked.reason, /no new risk/);

  const held = act({
    blocksRemaining: 10,
    liquity: liquity({
      eusdBalanceWei: EUSD_HELD,
      discountBps: 120,
      redemptionEdgeBps: 70,
      redemptionRateBps: 50,
    }),
  });
  assert.equal(held.action.type, "liquityRedeem");
});

test("an LST discount is bought only when the queue still fits", () => {
  const buy = act({
    blocksRemaining: 30,
    lst: lst({ discountBps: 50 }),
  });
  assert.equal(buy.action.type, "lstSwap");
  if (buy.action.type !== "lstSwap") return;
  assert.equal(buy.action.tokenIn, "WETH");
  assert.equal(buy.action.amountIn, SLICE);

  const lateQueue = act({
    blocksRemaining: 25,
    lst: lst({ discountBps: 50 }),
  });
  assert.equal(lateQueue.action.type, "noop");
});

test("shares bought at a discount are queued, not bought again", () => {
  const ledger = freshLedger();
  const buy = plan(
    makeObs({ blocksRemaining: 30, lst: lst({ discountBps: 50 }) }),
    ledger,
  );
  assert.equal(buy.action.type, "lstSwap");
  const queued = plan(
    makeObs({
      round: 2,
      blocksRemaining: 100,
      wethWei: "7360000000000000000",
      lst: lst({
        discountBps: 50,
        lstBalanceWei: SLICE,
        lstRedemptionValueWethWei: SLICE,
      }),
    }),
    ledger,
  );
  assert.equal(queued.action.type, "lstRequestWithdraw");
  if (queued.action.type !== "lstRequestWithdraw") return;
  assert.equal(queued.action.amountLstWei, SLICE);
});

test("yield without a discount does not stake", () => {
  const out = act({
    blocksRemaining: 100,
    lst: lst({ apyBps: 900, discountBps: 0 }),
  });
  assert.notEqual(out.action.type, "lstDeposit");
  assert.equal(out.action.type, "noop");
});

test("a claimable LST withdrawal beats a fresh discount", () => {
  const out = act({
    blocksRemaining: 100,
    lst: lst({
      discountBps: 200,
      claimableWithdrawalWethWei: ONE,
    }),
  });
  assert.equal(out.action.type, "lstClaimWithdraw");
});

test("a launch token and a discovered pool are not traded", () => {
  const pool = "0x1111111111111111111111111111111111111111";
  const out = act({
    extraFairs: { NEW: 100 },
    newMarket: true,
    discoveredPools: [
      {
        address: pool,
        token0: "0x0000000000000000000000000000000000000002",
        token1: "0x0000000000000000000000000000000000000003",
        token0Decimals: 18,
        token1Decimals: 6,
        feeBps: 30,
        createdAtBlock: 10,
        reserve0: "1",
        reserve1: "1",
        impliedPriceToken1PerToken0: 100,
        codehash: `0x${"ab".repeat(32)}`,
      },
    ],
  });
  assert.equal(out.action.type, "noop");
  const encoded = JSON.stringify(out.action);
  assert.equal(encoded.includes("NEW"), false);
  assert.equal(encoded.includes(pool), false);
});

test("a two-leg spread beats a same-block basis open", () => {
  const out = act({
    uniWeth: 2900,
    curveWeth: twoSided(3310, 30),
  });
  assert.equal(out.action.type, "bundle");
});

test("an unhedged surplus is hedged before a wide spread is taken", () => {
  const ledger = freshLedger();
  plan(makeObs(), ledger);
  const out = plan(
    makeObs({
      round: 2,
      wethWei: NINE,
      uniWeth: 2900,
      curveWeth: twoSided(3310, 30),
    }),
    ledger,
  );
  assert.equal(out.action.type, "gmxIncrease");
  if (out.action.type !== "gmxIncrease") return;
  assert.equal(out.action.isLong, false);
  assert.equal(out.action.base, "WETH");
});

test("WBTC surplus is hedged on its own market, short, USDC collateral", () => {
  const ledger = freshLedger();
  plan(makeObs({ gmxBtc: true, uniBtc: 60_000 }), ledger);
  const out = plan(
    makeObs({ round: 2, gmxBtc: true, uniBtc: 60_000, wbtc: "50000000" }),
    ledger,
  );
  assert.equal(out.action.type, "gmxIncrease");
  if (out.action.type !== "gmxIncrease") return;
  assert.equal(out.action.base, "WBTC");
  assert.equal(out.action.isLong, false);
  assert.equal(out.action.collateral, "USDC");
  // 0.1 WBTC * $60000 = $6000; collateral is $4000 in 6-decimal units.
  assert.equal(out.action.collateralAmount, "4000000000");
});

test("a WBTC venue spread is a bundle and beats the cheap-side basis", () => {
  const out = act({
    uniBtc: 56_000,
    curveBtc: twoSided(64_000, 30),
    gmxBtc: true,
  });
  assert.equal(out.action.type, "bundle");
  if (out.action.type !== "bundle") return;
  assert.equal(out.action.actions[0].type, "swap");
  assert.equal(out.action.actions[0].tokenIn, "USDC");
  assert.equal(out.action.actions[0].base, "WBTC");
  assert.equal(out.action.actions[1].type, "curveSwap");
  assert.equal(out.action.actions[1].tokenIn, "WBTC");
  assert.equal(out.action.actions[1].base, "WBTC");
});

test("keeper-delay vol shuts a 100 bps basis buy", () => {
  const fairs = [3000, 3150, 3000, 3150, 3000, 3150];
  const out = act({
    uniWeth: 2961,
    history: fairs.map((fair, i) => ({
      round: i,
      poolPriceUsdcPerWeth: fair,
      fairPriceUsdcPerWeth: fair,
    })),
  });
  assert.notEqual(out.action.type, "swap");
  assert.notEqual(out.action.type, "gmxIncrease");
  assert.equal(out.action.type, "noop");
});

test("an edge trade outbids a visible competitor by the uplift, inside the cap", () => {
  const out = act({
    uniWeth: 2900,
    curveWeth: twoSided(3310, 30),
    competition: {
      maxCompetitorPriorityFeeWei: "1000",
      maxBlockPriorityFeeWei: "1000",
      lastTxIndex: 2,
      recentRevertRate: 0,
      recentSampleSize: 4,
    },
  });
  assert.equal(out.action.type, "bundle");
  if (out.action.type !== "bundle") return;
  assert.equal(out.action.maxPriorityFeePerGasWei, "1100");
});

test("the improve prompt names its evidence and does not promise an automatic rollback", () => {
  const prompt = readFileSync(join(root, "example/agents/grok-1/prompt.md"), "utf8");
  for (const phrase of [
    "transactions since the last revision",
    "market history",
    "mean inclusion latency",
    "executorTs",
    "revertTo",
  ]) {
    assert.equal(prompt.includes(phrase), true, phrase);
  }
  assert.equal(prompt.includes("rolled back automatically"), false);
  assert.match(prompt, /^---\n[\s\S]*\nname: grok-1\n/);
});

test("decide on a flat book logs a numeric cycle and does not throw", () => {
  resetLedger();
  const logs: Array<{ signals?: Record<string, number | undefined> }> = [];
  const action = decide(makeObs(), {
    log(entry) {
      logs.push(entry);
    },
  } as AgentContext);
  assert.equal(action.type, "noop");
  assert.equal(logs.length, 1);
  assert.equal(typeof logs[0].signals?.cycle, "number");
  assert.equal(typeof logs[0].signals?.edgeBps, "number");
});
