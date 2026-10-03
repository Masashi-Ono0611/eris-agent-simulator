// Unit tests for the opus-1 strategy's decision arithmetic.
//
// The agent cannot be backtested from here, so these tests exist to pin the three things that
// would be silently catastrophic if they were wrong, and that a run would only reveal as a slow
// bleed:
//
//   1. the fee treatment of a cross-venue edge (an arbitrage that ignores fees is a measured,
//      structural loser -- docs/guide/writing-agents.md pitfall 1), including the negative control
//      that a gap *inside* the round trip produces no trade at all;
//   2. the inventory governor's beta discipline: no trade in calm, a forced unwind past the band,
//      and a forced flatten before the bell;
//   3. the depeg asymmetry: a *narrowing* discount is bought and a widening one is not, which is
//      the only thing separating the depeg regime from depeg-persist.
//
// Each case is written so that it would fail if the sign or the fee term were dropped, not merely
// if the number changed.
// The local-deploy overlay is the registry the competition actually runs on, and the only one that
// carries the WBTC pools (ADR 0013). It has to be set before the modules that read it are loaded,
// hence the dynamic imports; node's test runner gives this file its own process.
process.env.ERIS_LOCAL_DEPLOY = "1";

import test from "node:test";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { AgentContext } from "@eris/sdk/agent.js";
import type { MarketView } from "../example/agents/lib/markets.js";

const { validateAction } = await import("@eris/sdk/action.js");
const { TOKENS } = await import("@eris/sdk/constants.js");
const USDC_ADDRESS = TOKENS.USDC.address;
const {
  PARAMS,
  crossVenuePlan,
  decide,
  inventoryPlan,
  priorityFeeBid,
  resolveAnchor,
  stableSignal,
  unitsFromUsd,
  venueBuy,
  venueSell,
} = await import("../example/agents/opus-1/agent.js");

/** An action can carry a bigint; a failure message must not die trying to print one. */
function show(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)) ?? String(value);
}

const GWEI = 1_000_000_000n;
// Uniswap in-range L. The same value everywhere so the module's depth-peak ratio stays 1 and the
// sizing in these tests is deterministic.
const UNI_L = "1000000000000000000";
// 3,000,000 USDC of reserves on the two-sided venues (6 decimals).
const AMM_USDC = "3000000000000";

function uniView(uniMid: number, curveMid: number | null): MarketView {
  const venues: MarketView["venues"] = [
    { protocol: "uniswap", swapType: "swap", price: uniMid, feeBps: 30 },
  ];
  if (curveMid !== null)
    venues.push({
      protocol: "curve",
      swapType: "curveSwap",
      price: curveMid,
      feeBps: 16,
      sellPrice: curveMid * (1 - 16 / 10_000),
      buyPrice: curveMid * (1 + 16 / 10_000),
    });
  return {
    base: "WETH",
    fair: 3000,
    venues,
    baseBalanceWei: "8000000000000000000",
    baseDecimals: 18,
  };
}

function obsFor(opts: {
  uniMid?: number;
  curveMid?: number;
  usdc?: string;
  weth?: string;
  blocksRemaining?: number;
  defaultFeeWei?: bigint;
  maxFeeWei?: bigint;
  rivalFeeWei?: bigint;
} = {}): AgentObservation {
  return {
    kind: "observation",
    runId: "t",
    round: 100,
    blockNumber: "100",
    agentAddress: "0x0000000000000000000000000000000000000001",
    fairPriceUsdcPerWeth: 3000,
    fairPricesUsd: { WETH: 3000 },
    oraclePrices: { wethUsd: 3000, usdcUsd: 1 },
    baseDecimals: { WETH: 18 },
    baseBalances: { WETH: opts.weth ?? "8000000000000000000" },
    enabledProtocols: ["uniswap", "curve"],
    blocksRemaining: opts.blocksRemaining ?? 300,
    balances: {
      ethWei: "1000000000000000000",
      wethWei: opts.weth ?? "8000000000000000000",
      usdcUnits: opts.usdc ?? "25000000000",
      stables: {
        USDC: {
          token: "0x0000000000000000000000000000000000000002",
          decimals: 6,
          balance: opts.usdc ?? "25000000000",
          priceUsdc: 1,
          marketQuoted: false,
        },
      },
    },
    inventory: { valueUsdc: 50_000, weth: 8, usdc: 25_000, eth: 1 },
    history: [],
    limits: {
      defaultPriorityFeePerGasWei: (opts.defaultFeeWei ?? GWEI / 10n).toString(),
      maxPriorityFeePerGasWei: (opts.maxFeeWei ?? 5n * GWEI).toString(),
      defaultSlippageBps: 50,
    },
    protocols: {
      uniswap: {
        pool: {
          pair: "WETH/USDC",
          fee: 3000,
          priceUsdcPerWeth: opts.uniMid ?? 3000,
          tick: 0,
          tickSpacing: 60,
          liquidity: UNI_L,
        },
        positions: [],
      },
      curve: {
        priceUsdcPerWeth: opts.curveMid ?? 3000,
        reserves: { weth: "1000000000000000000000", usdc: AMM_USDC },
      },
    },
    ...(opts.rivalFeeWei === undefined
      ? {}
      : {
          competition: {
            maxCompetitorPriorityFeeWei: opts.rivalFeeWei.toString(),
            maxBlockPriorityFeeWei: opts.rivalFeeWei.toString(),
            lastTxIndex: null,
            recentRevertRate: 0,
            recentSampleSize: 0,
          },
        }),
  } as unknown as AgentObservation;
}

// ---------------------------------------------------------------------------
// executable prices
// ---------------------------------------------------------------------------

test("venueBuy/venueSell: a venue without a two-sided quote still pays its fee", () => {
  // Uniswap reports slot0's mid only. Treating that mid as executable is precisely the mistake that
  // makes a 40 bps gap look like a 40 bps profit when the round trip costs 60.
  const [uni, curve] = uniView(3000, 3060).venues;
  assert.equal(venueBuy(uni), 3000 * 1.003);
  assert.equal(venueSell(uni), 3000 * 0.997);
  // A venue that measured its own executable prices is used as measured, not re-derived.
  assert.equal(venueBuy(curve), curve.buyPrice);
  assert.equal(venueSell(curve), curve.sellPrice);
});

// ---------------------------------------------------------------------------
// M1 cross-venue
// ---------------------------------------------------------------------------

test("crossVenuePlan: a gap inside the round trip produces no trade", () => {
  // Negative control, and the one that matters most. Curve 40 bps above Uniswap looks like an
  // opportunity on mids and is a loss once both venues are paid: buy at 3009, sell at 3007.
  const obs = obsFor({ uniMid: 3000, curveMid: 3012 });
  const plan = crossVenuePlan(
    obs,
    uniView(3000, 3012),
    25_000_000_000n,
    8_000_000_000_000_000_000n,
  );
  assert.equal(plan, null);
});

test("crossVenuePlan: a gap that clears both fees fires, and names the right direction", () => {
  const obs = obsFor({ uniMid: 3000, curveMid: 3060 });
  const plan = crossVenuePlan(
    obs,
    uniView(3000, 3060),
    25_000_000_000n,
    8_000_000_000_000_000_000n,
  );
  assert.ok(plan, "a 200 bps dislocation must be tradable");
  assert.equal(plan.cheap.protocol, "uniswap");
  assert.equal(plan.rich.protocol, "curve");
  // sell 3060*(1-0.0016) = 3055.1 against buy 3009 -> ~153 bps gross.
  assert.ok(plan.grossEdgeBps > 140 && plan.grossEdgeBps < 165, `gross ${plan.grossEdgeBps}`);
  // The impact allowance is subtracted, so the net is strictly smaller and still over the gate.
  assert.ok(plan.netEdgeBps < plan.grossEdgeBps);
  assert.ok(plan.netEdgeBps >= PARAMS.xvMinNetEdgeBps);
  assert.ok(plan.profitUsd > 0);
});

test("crossVenuePlan: the direction inverts with the gap", () => {
  const obs = obsFor({ uniMid: 3060, curveMid: 3000 });
  const plan = crossVenuePlan(
    obs,
    uniView(3060, 3000),
    25_000_000_000n,
    8_000_000_000_000_000_000n,
  );
  assert.ok(plan);
  assert.equal(plan.cheap.protocol, "curve");
  assert.equal(plan.rich.protocol, "uniswap");
});

test("crossVenuePlan: an empty wallet is not an opportunity", () => {
  // A leg the wallet cannot fund is rejected by the runtime and reads in the score exactly like a
  // decision not to trade (issue #54). It has to be caught here instead.
  const obs = obsFor({ uniMid: 3000, curveMid: 3060 });
  assert.equal(crossVenuePlan(obs, uniView(3000, 3060), 0n, 0n), null);
});

test("crossVenuePlan: one venue is not a cross-venue trade", () => {
  const obs = obsFor({ uniMid: 3000 });
  assert.equal(
    crossVenuePlan(obs, uniView(3000, null), 25_000_000_000n, 8n * 10n ** 18n),
    null,
  );
});

test("crossVenuePlan: a thinner book sizes the trade down, not up", () => {
  // The crash regime pulls depth while the price is gapping (issue #52), so the block where the
  // edge looks biggest is the block where the size has to be smallest.
  const deep = obsFor({ uniMid: 3000, curveMid: 3060 });
  const thin = obsFor({ uniMid: 3000, curveMid: 3060 });
  (thin.protocols.curve as { reserves?: { weth: string; usdc: string } }).reserves = {
    weth: "100000000000000000000",
    usdc: "300000000000", // 300,000 USDC: a tenth of the deep book
  };
  const a = crossVenuePlan(deep, uniView(3000, 3060), 25_000_000_000n, 8n * 10n ** 18n);
  const b = crossVenuePlan(thin, uniView(3000, 3060), 25_000_000_000n, 8n * 10n ** 18n);
  assert.ok(a && b);
  assert.ok(b.notionalUsd < a.notionalUsd, `${b.notionalUsd} should be under ${a.notionalUsd}`);
});

// ---------------------------------------------------------------------------
// M2 inventory governor
// ---------------------------------------------------------------------------

const ANCHOR_WETH = 8n * 10n ** 18n;

test("inventoryPlan: a market at fair, holding the anchor, is left alone", () => {
  // The calm control. Every bundled arbitrage agent that bled did so by having something to do here.
  assert.equal(inventoryPlan(uniView(3000, 3000), ANCHOR_WETH, ANCHOR_WETH, 300), null);
});

test("inventoryPlan: a dislocation past the entry gate opens a deviation on the better venue", () => {
  // Uniswap 100 bps under fair: the executable buy is still ~70 bps under, which clears the gate.
  const plan = inventoryPlan(uniView(2970, 3000), ANCHOR_WETH, ANCHOR_WETH, 300);
  assert.ok(plan);
  assert.equal(plan.side, "buy");
  assert.equal(plan.forced, false);
  assert.ok(plan.edgeBps >= PARAMS.invEntryBps);
  assert.ok(plan.notionalUsd <= PARAMS.invStepUsd);
});

test("inventoryPlan: a dislocation just short of the gate is not traded", () => {
  // 90 bps under fair leaves 60 bps after the Uniswap fee: under the gate, so nothing happens.
  const plan = inventoryPlan(uniView(2973, 3000), ANCHOR_WETH, ANCHOR_WETH, 300);
  assert.equal(plan, null);
});

test("inventoryPlan: an open deviation unwinds at the exit tolerance, not only at a new edge", () => {
  // Holding one WETH over the anchor in a market sitting exactly at fair. The executable sell is
  // 30 bps under fair -- worse than fair, better than the 40 bps tolerance -- so the position
  // closes. If the exit demanded an edge as wide as the entry, the deviation would ride to the bell.
  const plan = inventoryPlan(uniView(3000, 3000), ANCHOR_WETH + 10n ** 18n, ANCHOR_WETH, 300);
  assert.ok(plan);
  assert.equal(plan.side, "sell");
  assert.equal(plan.forced, false);
  assert.ok(Math.abs(plan.notionalUsd - 3000) < 1);
});

test("inventoryPlan: past the band the unwind is forced regardless of price", () => {
  // Four WETH over an eight WETH anchor is 50%, far outside the 15% band. Staying there is a beta
  // bet the field is not taking, and the score is relative.
  const plan = inventoryPlan(uniView(3000, 3000), ANCHOR_WETH + 4n * 10n ** 18n, ANCHOR_WETH, 300);
  assert.ok(plan);
  assert.equal(plan.side, "sell");
  assert.equal(plan.forced, true);
});

test("inventoryPlan: the deviation is flattened before the bell", () => {
  const plan = inventoryPlan(
    uniView(3000, 3000),
    ANCHOR_WETH + 10n ** 18n,
    ANCHOR_WETH,
    PARAMS.invFlattenBlocks - 1,
  );
  assert.ok(plan);
  assert.equal(plan.forced, true);
  assert.ok(Math.abs(plan.notionalUsd - 3000) < 1, "the whole deviation, not a step");
});

test("inventoryPlan: at the bell with nothing to unwind there is nothing to do", () => {
  assert.equal(inventoryPlan(uniView(2970, 3000), ANCHOR_WETH, ANCHOR_WETH, 2), null);
});

test("inventoryPlan: a short deviation is closed by buying, not by selling more", () => {
  const plan = inventoryPlan(uniView(3000, 3000), ANCHOR_WETH - 10n ** 18n, ANCHOR_WETH, 300);
  assert.ok(plan);
  assert.equal(plan.side, "buy");
});

// ---------------------------------------------------------------------------
// the ordering auction
// ---------------------------------------------------------------------------

test("priorityFeeBid: no expected profit means no bid above the default", () => {
  const obs = obsFor({});
  assert.equal(priorityFeeBid(obs, 0), (GWEI / 10n).toString());
});

test("priorityFeeBid: a rival's bid is outbid when the trade can pay for it", () => {
  const obs = obsFor({ rivalFeeWei: GWEI });
  const bid = BigInt(priorityFeeBid(obs, 500));
  assert.ok(bid > GWEI, `${bid} should beat the rival's 1 gwei`);
  assert.ok(bid <= 5n * GWEI);
});

test("priorityFeeBid: a trade that cannot pay for position does not part-pay for it", () => {
  // The whole point of pricing the bid off the trade: a 2 USDC edge is not worth 5 gwei of gas.
  // And a bid that lands between the default and the rival's buys nothing at all -- it loses the
  // ordering just the same and pays more gas for the privilege -- so the fallback is the default,
  // not "as much as it can afford".
  const obs = obsFor({ rivalFeeWei: 5n * GWEI });
  assert.equal(priorityFeeBid(obs, 2), (GWEI / 10n).toString());
});

test("priorityFeeBid: the configured cap is never exceeded", () => {
  // Validation rejects a bid over the cap and the round is lost, so this has to hold for any input.
  const obs = obsFor({ rivalFeeWei: 5n * GWEI });
  assert.equal(priorityFeeBid(obs, 1_000_000), (5n * GWEI).toString());
});

// ---------------------------------------------------------------------------
// M5 depeg asymmetry
// ---------------------------------------------------------------------------

test("stableSignal: a widening discount is not bought", () => {
  // depeg-persist. The level does not come back, and buying into the fall is the worst trade on
  // offer anywhere in the competition.
  assert.equal(stableSignal([0.99, 0.985, 0.98], 300), null);
});

test("stableSignal: a narrowing discount is bought", () => {
  // depeg. The environment buys its position back as the window decays, so the recovery is real.
  assert.equal(stableSignal([0.98, 0.985, 0.992], 300), "buy");
});

test("stableSignal: a flat discount is not a recovery", () => {
  assert.equal(stableSignal([0.985, 0.985, 0.985], 300), null);
});

test("stableSignal: back at par means get out", () => {
  assert.equal(stableSignal([0.98, 0.99, 0.9995], 300), "sell");
});

test("stableSignal: too late in the epoch to round-trip means get out", () => {
  assert.equal(stableSignal([0.98, 0.985, 0.992], 5), "sell");
});

test("stableSignal: two observations are not a trend", () => {
  assert.equal(stableSignal([0.98, 0.992], 300), null);
});

// ---------------------------------------------------------------------------
// anchoring and units
// ---------------------------------------------------------------------------

test("resolveAnchor: the published funding survives a worker reload", () => {
  // Module state is reset when the worker reloads, so an anchor read from "whatever I held when I
  // woke up" would silently become the mid-run position. The published basket is a constant.
  assert.equal(resolveAnchor("WETH", 7_900_000_000_000_000_000n), 8n * 10n ** 18n);
});

test("resolveAnchor: a run funded some other way anchors to what it was actually given", () => {
  assert.equal(resolveAnchor("MADEUP", 1234n), 1234n);
});

test("unitsFromUsd: sizes convert, and nonsense converts to nothing", () => {
  assert.equal(unitsFromUsd(3000, 3000, 18), 10n ** 18n);
  assert.equal(unitsFromUsd(1_000, 1, 6), 1_000_000_000n);
  assert.equal(unitsFromUsd(100, 0, 18), 0n);
  assert.equal(unitsFromUsd(-5, 3000, 18), 0n);
  assert.equal(unitsFromUsd(Number.NaN, 3000, 18), 0n);
});

// ---------------------------------------------------------------------------
// decide(), end to end against a synthetic observation
// ---------------------------------------------------------------------------

function fakeCtx(): AgentContext & { submitted: unknown[]; logs: unknown[] } {
  const submitted: unknown[] = [];
  const logs: unknown[] = [];
  return {
    agentId: "opus-1",
    address: "0x0000000000000000000000000000000000000001",
    publicClient: {} as AgentContext["publicClient"],
    config: {} as AgentContext["config"],
    latestObservation: () => null,
    onObservation: () => () => undefined,
    submit: (a: unknown) => submitted.push(a),
    log: (e: unknown) => logs.push(e),
    submitted,
    logs,
  } as unknown as AgentContext & { submitted: unknown[]; logs: unknown[] };
}

test("decide: a calm market produces no action and still leaves a decision log", () => {
  const ctx = fakeCtx();
  return decide(obsFor({ uniMid: 3000, curveMid: 3000 }), ctx).then((action) => {
    assert.equal(action, null);
    assert.equal(ctx.submitted.length, 0);
    assert.equal(ctx.logs.length, 1);
  });
});

test("decide: a wide dislocation produces a two-leg bundle with a priced bid", () => {
  const ctx = fakeCtx();
  return decide(obsFor({ uniMid: 3000, curveMid: 3060, rivalFeeWei: GWEI }), ctx).then(
    (action) => {
      assert.ok(action, "a 200 bps dislocation must produce an action");
      const a = action as { type: string; actions?: unknown[]; maxPriorityFeePerGasWei?: string };
      assert.equal(a.type, "bundle");
      assert.equal(a.actions?.length, 2);
      const legs = a.actions as Array<{ type: string; tokenIn: string; amountIn: string }>;
      assert.equal(legs[0].tokenIn, "USDC");
      assert.equal(legs[1].tokenIn, "WETH");
      assert.notEqual(legs[0].type, legs[1].type);
      assert.ok(BigInt(legs[0].amountIn) > 0n);
      assert.ok(BigInt(legs[1].amountIn) > 0n);
      assert.ok(BigInt(a.maxPriorityFeePerGasWei ?? "0") > GWEI);
    },
  );
});

test("decide: everything it emits survives the runtime's own validator", () => {
  // The positive control for the failure mode that is invisible in the score: a rejected action and
  // a decision not to trade look identical afterwards, which is how venue-arb managed 359
  // rejections out of 359 decisions in a measured run (issue #54). So the actions are put through
  // the real validateAction rather than being eyeballed.
  const ctx = fakeCtx();
  const obs = obsFor({ uniMid: 2970, curveMid: 3000, rivalFeeWei: GWEI });
  const balances = {
    ethWei: 10n ** 18n,
    wethWei: 8n * 10n ** 18n,
    usdcUnits: 25_000_000_000n,
    bases: { WETH: 8n * 10n ** 18n },
    stables: {},
  } as unknown as Parameters<typeof validateAction>[2];
  return decide(obs, ctx).then((action) => {
    const emitted = [action, ...ctx.submitted].filter(Boolean);
    assert.ok(emitted.length > 0, "a 70 bps dislocation should produce something");
    for (const a of emitted) {
      const result = validateAction(a as never, obs, balances);
      assert.equal(
        result.ok,
        true,
        `rejected: ${show(a)} -> ${result.ok ? "" : result.reason}`,
      );
    }
  });
});

test("decide: the WBTC market is traded with its own base and its own decimals", () => {
  // WBTC has eight decimals and lives in a side map (ADR 0013). Sizing it against the WETH balance
  // or against eighteen decimals produces an action that is either refused or three orders of
  // magnitude wrong, and neither is visible without running it through the validator.
  const ctx = fakeCtx();
  const obs = obsFor({ uniMid: 3000, curveMid: 3000 });
  const o = obs as unknown as Record<string, Record<string, unknown>>;
  o.fairPricesUsd.WBTC = 60_000;
  o.baseDecimals.WBTC = 8;
  o.baseBalances.WBTC = "40000000"; // 0.4 WBTC
  (obs.protocols.uniswap as unknown as { markets: Record<string, unknown> }).markets = {
    "WBTC/USDC": {
      pair: "WBTC/USDC",
      fee: 3000,
      priceUsdcPerWeth: 59_400, // 100 bps under fair
      tick: 0,
      tickSpacing: 60,
      liquidity: UNI_L,
    },
  };
  (obs.protocols.curve as unknown as { markets: Record<string, unknown> }).markets = {
    "WBTC/USDC": {
      priceUsdcPerWeth: 60_000,
      reserves: { weth: "5000000000", usdc: AMM_USDC },
    },
  };
  const balances = {
    ethWei: 10n ** 18n,
    wethWei: 8n * 10n ** 18n,
    usdcUnits: 25_000_000_000n,
    bases: { WETH: 8n * 10n ** 18n, WBTC: 40_000_000n },
    stables: {},
  } as unknown as Parameters<typeof validateAction>[2];
  return decide(obs, ctx).then((action) => {
    const emitted = [action, ...ctx.submitted].filter(Boolean) as Array<Record<string, unknown>>;
    const wbtc = emitted.filter((a) => show(a).includes("WBTC"));
    assert.ok(wbtc.length > 0, "the WBTC dislocation should be acted on");
    for (const a of emitted) {
      const result = validateAction(a as never, obs, balances);
      assert.equal(result.ok, true, `rejected: ${show(a)} -> ${result.ok ? "" : result.reason}`);
    }
  });
});

test("decide: no new two-leg trade is opened in the last blocks of the epoch", () => {
  // The legs are separate transactions. Mid-run a half-filled arbitrage is a deviation the governor
  // closes next block; at the bell there is no next block, and it is marked as a beta mismatch
  // against a field that has none. The same dislocation that fires at 300 blocks must not fire here.
  const ctx = fakeCtx();
  const obs = obsFor({ uniMid: 3000, curveMid: 3060, blocksRemaining: 3 });
  return decide(obs, ctx).then((action) => {
    const emitted = [action, ...ctx.submitted].filter(Boolean);
    for (const a of emitted)
      assert.notEqual((a as { type?: string }).type, "bundle", show(a));
  });
});

test("decide: a chain read that never answers does not eat the five-second deadline", () => {
  // The launch module is the only one that touches RPC, and `decide()` is killed at five seconds
  // by the parent thread with everything it had queued discarded. A node that stops answering must
  // therefore cost one timeout, not one timeout per read -- so this is timed, not just awaited.
  const ctx = fakeCtx();
  (ctx as { publicClient: unknown }).publicClient = {
    readContract: () => new Promise(() => undefined),
    simulateContract: () => new Promise(() => undefined),
    getLogs: () => new Promise(() => undefined),
  };
  const obs = obsFor({ uniMid: 3000, curveMid: 3000 });
  (obs as { registry?: unknown }).registry = {
    address: "0x0000000000000000000000000000000000000003",
    entries: [
      {
        market: "0x00000000000000000000000000000000000000aa",
        kind: "uniswapV3Pool",
        creator: "0x00000000000000000000000000000000000000bb",
        mine: false,
        token0: USDC_ADDRESS,
        token1: "0x00000000000000000000000000000000000000cc",
        codehashAtRegistration: "0x",
        verified: true,
        registeredAtBlock: "90",
      },
    ],
    allowances: [],
    strandedUnknown: [],
    dropped: 0,
  };
  const startedAt = Date.now();
  return decide(obs, ctx).then(() => {
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 2_500, `took ${elapsed}ms`);
    const reasons = ctx.logs.map((l) => (l as { reason?: string }).reason ?? "");
    assert.ok(reasons.some((r) => r.includes("module launch failed")), reasons.join(" / "));
  });
});

test("decide: a module that throws does not take the decision down", () => {
  // The isolation guarantee. A malformed protocols section is the kind of thing that turned into a
  // TypeError -> noop for every round in earlier agents.
  const ctx = fakeCtx();
  const broken = obsFor({ uniMid: 3000, curveMid: 3000 });
  Object.defineProperty(broken.protocols, "liquity", {
    get() {
      throw new Error("boom");
    },
  });
  return decide(broken, ctx).then((action) => {
    assert.equal(action, null);
    const reasons = ctx.logs.map((l) => (l as { reason?: string }).reason ?? "");
    assert.ok(reasons.some((r) => r.includes("module liquity failed")), reasons.join(" / "));
  });
});
