// opus-1r = opus-1a (C1) + the attribution memo's R overlay on M1 + M4-first ordering.
//
// What has to hold, and what each block below pins:
//   1. Without an R opportunity (and with the depth cache empty) opus-1r plans exactly as opus-1a,
//      on every fixture opus-1's own tests use -- R is an overlay, not a rewrite.
//   2. R's arithmetic: N* = e / (2(1/Rc + 1/Rr)) (R.e/4 at equal depth), the caps, the two gates
//      (100 bps net edge, $25 expected profit), every venue pair tried, Balancer (and WBTC) priced off
//      the pool fee rather than the probe's half-spread, and R only where it beats C1 after its bid.
//   3. The bid: one wei past rival x1.2, capped at 0.30.E/(fair.140k.legs), the default when there is
//      no rival.
//   4. The leg guard: the memo requires fair net of the venue fee with no extra allowance. The
//      chosen default relaxes only a near-fair leg by up to 40 bps so whale windows can trade;
//      explicit zero-allowance controls retain coverage of the strict memo rule.
//   5. The brake: settle from receipts over +1..+3, bad = one-sided only (memo §2.3), pause on >= 40%
//      of >= 8, half size after, half size in a worker reloaded mid-run, unreadable outcomes age out
//      uncounted, reads shared per block and backed off, reset on an epoch start; while paused M1 is C1.
//   6. M4 goes out first and M1/M2 wait; otherwise R goes out ahead of the block's other actions, but
//      never takes the slot of M3's eUSD buy or a launch entry.
//   7. The depth estimator's guards, the cache scaled by L and capped by the spread estimate, and
//      decide() never waiting on a depth read. R stands down for a base M2 is force-unwinding, and
//      M2 waits on the same base when R is submitted; other bases remain eligible.
//      R's look at a Uniswap pair never changes C1's later Uniswap sizing.
//   8. The revision prompt the shipped bytes make fits the context window prompt.md declares.
process.env.ERIS_LOCAL_DEPLOY = "1";

import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionResult, type Address, type Hex } from "viem";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { AgentContext } from "@eris/sdk/agent.js";

const { TOKENS, BALANCER, MARKET_LEGS, UNISWAP } = await import("@eris/sdk/constants.js");
const { swapRouterAbi, balancerVaultAbi, curveTricryptoAbi, quoterV2Abi, balancerQueriesAbi } =
  await import("@eris/sdk/abis.js");
const { validateAction } = await import("@eris/sdk/action.js");
const { uniswapAdapter } = await import("@eris/sdk/protocols/uniswap.js");
const { balancerAdapter } = await import("@eris/sdk/protocols/balancer.js");
const { curveAdapter } = await import("@eris/sdk/protocols/curve.js");
const { marketViews } = await import("../example/agents/lib/markets.js");
const A = await import("../example/agents/opus-1a/agent.js");
const R = await import("../example/agents/opus-1r/agent.js");

const unhandled: unknown[] = [];
process.on("unhandledRejection", (e) => unhandled.push(e));

const GWEI = 1_000_000_000n;
const UNI_L = "1000000000000000000";
const AMM_USDC = "3000000000000";
const ME = "0x0000000000000000000000000000000000000001" as Address;

function show(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)) ?? String(value);
}
const flush = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// fixtures: opus-1's own (verbatim shape), and R's
// ---------------------------------------------------------------------------

function obsFor(opts: {
  uniMid?: number;
  curveMid?: number;
  usdc?: string;
  weth?: string;
  blocksRemaining?: number;
  defaultFeeWei?: bigint;
  maxFeeWei?: bigint;
  rivalFeeWei?: bigint;
  round?: number;
} = {}): AgentObservation {
  const round = opts.round ?? 100;
  return {
    kind: "observation",
    runId: "t",
    round,
    blockNumber: String(round),
    agentAddress: ME,
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

function wbtcObs(): AgentObservation {
  const obs = obsFor({ uniMid: 3000, curveMid: 3000 });
  const o = obs as unknown as Record<string, Record<string, unknown>>;
  o.fairPricesUsd.WBTC = 60_000;
  o.baseDecimals.WBTC = 8;
  o.baseBalances.WBTC = "40000000";
  (obs.protocols.uniswap as unknown as { markets: Record<string, unknown> }).markets = {
    "WBTC/USDC": { pair: "WBTC/USDC", fee: 3000, priceUsdcPerWeth: 59_400, tick: 0, tickSpacing: 60, liquidity: UNI_L },
  };
  (obs.protocols.curve as unknown as { markets: Record<string, unknown> }).markets = {
    "WBTC/USDC": { priceUsdcPerWeth: 60_000, reserves: { weth: "5000000000", usdc: AMM_USDC } },
  };
  return obs;
}

function registryObs(): AgentObservation {
  const obs = obsFor({ uniMid: 3000, curveMid: 3000 });
  (obs as { registry?: unknown }).registry = {
    address: "0x0000000000000000000000000000000000000003",
    entries: [
      {
        market: "0x00000000000000000000000000000000000000aa",
        kind: "uniswapV3Pool",
        creator: "0x00000000000000000000000000000000000000bb",
        mine: false,
        token0: TOKENS.USDC.address,
        token1: "0x00000000000000000000000000000000000000cc",
        codehashAtRegistration: "0x",
        verified: true,
        registeredAtBlock: "90",
      },
      {
        market: "0x00000000000000000000000000000000000000cc",
        kind: "erc20",
        creator: "0x00000000000000000000000000000000000000bb",
        mine: false,
        codehashAtRegistration: `0x${"e".repeat(64)}`,
        codehashNow: `0x${"e".repeat(64)}`,
        verified: false,
        registeredAtBlock: "90",
      },
    ],
    allowances: [],
    strandedUnknown: [],
    dropped: 0,
  };
  return obs;
}

function brokenLiquityObs(): AgentObservation {
  const broken = obsFor({ uniMid: 3000, curveMid: 3000 });
  Object.defineProperty(broken.protocols, "liquity", {
    get() {
      throw new Error("boom");
    },
  });
  return broken;
}

/** A two-sided AMM quote at mid `mid` with per-side cost `hBps` (sdk twoSidedQuote's shape). */
function amm(mid: number, hBps: number) {
  const h = hBps / 10_000;
  return {
    priceUsdcPerWeth: mid,
    sellPriceUsdcPerWeth: mid / (1 + h),
    buyPriceUsdcPerWeth: mid * (1 + h),
    effectiveHalfSpreadBps: hBps,
  };
}

type ROpts = {
  fair?: number;
  uni?: number;
  uniL?: string | null;
  bal?: number | null;
  balH?: number;
  cur?: number | null;
  curH?: number;
  nav?: number;
  usdc?: string;
  weth?: string;
  rival?: bigint | null;
  maxFeeWei?: bigint;
  block?: number;
  blocksRemaining?: number;
  /** competition.recentSampleSize: own transactions the parent has already seen resolve. */
  sample?: number;
};

/**
 * R's fixture. Default: fair 3000, Uniswap 150 bps under it (the cheap venue), Balancer 150 bps
 * over it with Balancer's real per-side cost (31.1 bps = 30.09 fee + 1 bp probe impact), Curve at
 * fair (neither best). Fair sits between the two venues, so both legs clear the fair-based guard.
 */
function rObs(o: ROpts = {}): AgentObservation {
  const block = o.block ?? 100;
  const fair = o.fair ?? 3000;
  const usdc = o.usdc ?? "25000000000";
  const weth = o.weth ?? "8000000000000000000";
  const protocols: Record<string, unknown> = {
    uniswap: {
      pool: {
        pair: "WETH/USDC",
        fee: 3000,
        priceUsdcPerWeth: o.uni ?? 2955,
        tick: 0,
        tickSpacing: 60,
        ...(o.uniL === null ? {} : { liquidity: o.uniL ?? UNI_L }),
      },
      positions: [],
    },
  };
  if (o.bal !== null) protocols.balancer = amm(o.bal ?? 3045, o.balH ?? 31.1);
  if (o.cur !== null) protocols.curve = amm(o.cur ?? 3000, o.curH ?? 20);
  return {
    kind: "observation",
    runId: "r",
    round: block,
    blockNumber: String(block),
    agentAddress: ME,
    fairPriceUsdcPerWeth: fair,
    fairPricesUsd: { WETH: fair },
    oraclePrices: { wethUsd: fair, usdcUsd: 1 },
    baseDecimals: { WETH: 18 },
    baseBalances: { WETH: weth },
    enabledProtocols: ["uniswap", "balancer", "curve"],
    blocksRemaining: o.blocksRemaining ?? 300,
    balances: { ethWei: "1000000000000000000", wethWei: weth, usdcUnits: usdc },
    inventory: { valueUsdc: o.nav ?? 76_000, weth: 8, usdc: 25_000, eth: 1 },
    history: [],
    limits: {
      defaultPriorityFeePerGasWei: (GWEI / 10n).toString(),
      maxPriorityFeePerGasWei: (o.maxFeeWei ?? 1000n * GWEI).toString(),
      defaultSlippageBps: 50,
    },
    protocols,
    ...(o.rival === null
      ? {}
      : {
          competition: {
            maxCompetitorPriorityFeeWei: (o.rival ?? 50n * GWEI).toString(),
            maxBlockPriorityFeeWei: (o.rival ?? 50n * GWEI).toString(),
            lastTxIndex: null,
            recentRevertRate: 0,
            recentSampleSize: o.sample ?? 0,
          },
        }),
  } as unknown as AgentObservation;
}

/** WBTC beside WETH: WBTC's venues at the given mids (null drops one), WETH's all at fair. */
function rWbtcObs(o: { uni: number; bal: number | null; balH: number; cur?: number | null; curH?: number }): AgentObservation {
  const obs = rObs({ uni: 3000, bal: 3000, cur: 3000 });
  const x = obs as unknown as Record<string, Record<string, unknown>>;
  x.fairPricesUsd.WBTC = 60_000;
  x.baseDecimals.WBTC = 8;
  x.baseBalances.WBTC = "40000000";
  const p = obs.protocols as unknown as Record<string, Record<string, unknown>>;
  p.uniswap.markets = {
    "WBTC/USDC": { pair: "WBTC/USDC", fee: 3000, priceUsdcPerWeth: o.uni, tick: 0, tickSpacing: 60, liquidity: UNI_L },
  };
  if (o.bal !== null) p.balancer.markets = { "WBTC/USDC": amm(o.bal, o.balH) };
  if (o.cur !== null && o.cur !== undefined) p.curve.markets = { "WBTC/USDC": amm(o.cur, o.curH ?? 20) };
  return obs;
}

/** Run `fn` with some PARAMS overridden, and put them back whatever happens. */
async function withParams<T>(over: Partial<typeof R.PARAMS>, fn: () => T | Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(over).map((k) => [k, (R.PARAMS as Record<string, unknown>)[k]]));
  Object.assign(R.PARAMS, over);
  try {
    return await fn();
  } finally {
    Object.assign(R.PARAMS, saved);
  }
}

function fakeCtx(publicClient: unknown = {}): AgentContext & { submitted: unknown[]; logs: unknown[] } {
  const submitted: unknown[] = [];
  const logs: unknown[] = [];
  return {
    agentId: "opus-1r",
    address: ME,
    publicClient: publicClient as AgentContext["publicClient"],
    config: {} as AgentContext["config"],
    latestObservation: () => null,
    onObservation: () => () => undefined,
    submit: (a: unknown) => submitted.push(a),
    log: (e: unknown) => logs.push(e),
    submitted,
    logs,
  } as unknown as AgentContext & { submitted: unknown[]; logs: unknown[] };
}

type Out = { action: unknown; submitted: unknown[]; tags: string[]; reasons: string[] };
async function run(
  agent: { decide: (o: AgentObservation, c: AgentContext) => Promise<unknown> },
  obs: AgentObservation,
  client: unknown = {},
): Promise<Out> {
  const ctx = fakeCtx(client);
  const action = await agent.decide(obs, ctx);
  const tags = ctx.logs.flatMap((l) => ((l as { state?: { tags?: string[] } }).state?.tags ?? []));
  const reasons = ctx.logs.map((l) => (l as { reason?: string }).reason ?? "");
  return { action, submitted: ctx.submitted, tags, reasons };
}
const emitted = (o: Out) => [o.action, ...o.submitted].filter(Boolean) as Array<Record<string, unknown>>;
const rBundleOf = (o: Out) => emitted(o).find((a) => a.type === "rawBundle") as
  | { type: string; txs: Array<{ to: Address; data: Hex }>; maxPriorityFeePerGasWei: string }
  | undefined;

function weth(view: ReturnType<typeof marketViews>) {
  const v = view.find((x) => x.base === "WETH");
  assert.ok(v);
  return v;
}

// ---------------------------------------------------------------------------
// 1. C1 equivalence
// ---------------------------------------------------------------------------

const hangingClient = {
  readContract: () => new Promise(() => undefined),
  simulateContract: () => new Promise(() => undefined),
  getLogs: () => new Promise(() => undefined),
  call: () => new Promise(() => undefined),
  getBlock: () => new Promise(() => undefined),
  getTransactionReceipt: () => new Promise(() => undefined),
};

const C1_FIXTURES: Array<[string, () => AgentObservation, unknown?]> = [
  ["calm", () => obsFor({ uniMid: 3000, curveMid: 3000 })],
  ["wide dislocation with a rival bid", () => obsFor({ uniMid: 3000, curveMid: 3060, rivalFeeWei: GWEI })],
  ["the gap inverted", () => obsFor({ uniMid: 3060, curveMid: 3000 })],
  ["a gap inside the round trip", () => obsFor({ uniMid: 3000, curveMid: 3012 })],
  ["the validator fixture (70 bps under fair)", () => obsFor({ uniMid: 2970, curveMid: 3000, rivalFeeWei: GWEI })],
  ["WBTC with its own decimals", wbtcObs],
  ["last blocks of the epoch", () => obsFor({ uniMid: 3000, curveMid: 3060, blocksRemaining: 3 })],
  ["a module that throws", brokenLiquityObs],
  ["a chain read that never answers", registryObs, hangingClient],
];

test("C1 equivalence: with the cache empty and no R opportunity, opus-1r plans exactly as opus-1a", async () => {
  R.resetROverlay();
  for (const [name, make, client] of C1_FIXTURES) {
    const a = await run(A, make(), client ?? {});
    const r = await run(R, make(), client ?? {});
    assert.equal(show(r.action), show(a.action), `${name}: returned action`);
    assert.equal(show(r.submitted), show(a.submitted), `${name}: submitted actions`);
    assert.ok(!r.tags.some((t) => t.startsWith("xvR:")), `${name}: R must not have fired`);
  }
  // Negative control: the comparison can see a difference. On a fair-straddling dislocation R
  // fires, and opus-1a's $1,125 bundle is not what opus-1r sends.
  R.resetROverlay();
  const a = await run(A, rObs());
  const r = await run(R, rObs());
  assert.notEqual(show(r.action), show(a.action));
  assert.ok(r.tags.includes("xvR:WETH"));
  assert.equal((a.action as { type: string }).type, "bundle");
});

test("C1 equivalence: the shared helpers and the launch bundle are opus-1a's", () => {
  const views = marketViews(obsFor({ uniMid: 3000, curveMid: 3060 }));
  const v = weth(views);
  const obs = obsFor({ uniMid: 3000, curveMid: 3060, rivalFeeWei: GWEI });
  assert.equal(
    show(R.crossVenuePlan(obs, v, 25_000_000_000n, 8n * 10n ** 18n)),
    show(A.crossVenuePlan(obs, v, 25_000_000_000n, 8n * 10n ** 18n)),
  );
  for (const held of [8n * 10n ** 18n, 9n * 10n ** 18n, 12n * 10n ** 18n])
    assert.equal(show(R.inventoryPlan(v, held, 8n * 10n ** 18n, 300)), show(A.inventoryPlan(v, held, 8n * 10n ** 18n, 300)));
  for (const e of [0, 2, 500, 1_000_000]) assert.equal(R.priorityFeeBid(obs, e), A.priorityFeeBid(obs, e));
  const args = {
    tokenIn: TOKENS.USDC.address,
    tokenOut: "0x00000000000000000000000000000000000000aa" as Address,
    fee: 3000,
    recipient: ME,
    amountIn: 1_500_000_000n,
    minOut: 1n,
    reason: "launch",
    maxPriorityFeePerGasWei: "100000000",
  };
  assert.deepEqual(R.launchSwapBundle(args), A.launchSwapBundle(args));
});

// ---------------------------------------------------------------------------
// 2. R sizing and gates
// ---------------------------------------------------------------------------

/** The memo's model, recomputed here rather than read back from the agent. */
function model(e: number, rc: number, rr: number, caps: number[]) {
  const nStar = e / (2 * (1 / rc + 1 / rr));
  const n = Math.min(nStar, ...caps);
  return { nStar, n, profit: n * (e - n * (1 / rc + 1 / rr)) };
}

test("R fires on a fair-straddling dislocation: one raw two-leg bundle at the $6k cap", async () => {
  R.resetROverlay();
  const obs = rObs();
  const out = await run(R, obs);
  const b = rBundleOf(out);
  assert.ok(b, show(emitted(out)));
  assert.equal(b.txs.length, 2, "two legs, never one");
  assert.ok(out.tags.includes("xvR:WETH"));
  assert.ok(!out.tags.includes("xv:WETH"), "C1 does not also trade the base R took");
  // e after fees: buy Uniswap 2955 x 1.003, sell Balancer at its mid less the pool's 0.3% (not its
  // probe's 31.1 bp half-spread). Depth: Uniswap 3M (L at its peak), Balancer from its spread:
  // 0.1 x 3045 / (0.00311 - 0.003/0.997) = 3.02M -> 3M.
  const e = (3045 * 0.997) / (2955 * 1.003) - 1;
  const m = model(e, 3e6, 3e6, [6000, 76_000 * 0.08]);
  assert.ok(e * 1e4 > 200, "whale tier");
  assert.equal(m.n, 6000);
  const plan = R.rPlan(obs, weth(marketViews(obs)), 25_000_000_000n, 8n * 10n ** 18n, 100);
  assert.ok(plan);
  assert.equal(plan.binding, "max");
  assert.equal(plan.tier, "whale");
  assert.equal(plan.depthCheap.source, "uniswap");
  assert.equal(plan.depthRich.source, "spread");
  // Both venues are 150 bps from fair: neither leg needs the allowance.
  assert.equal(plan.allowCheapBps, 0);
  assert.equal(plan.allowRichBps, 0);
  assert.ok(Math.abs(plan.notionalUsd - 6000) < 1e-9);
  assert.ok(Math.abs(plan.profitUsd - m.profit) < 1e-6, `${plan.profitUsd} vs ${m.profit}`);
  assert.equal(plan.usdcIn, 6_000_000_000n);
  // Everything emitted passes the runtime's own validator.
  const balances = {
    ethWei: 10n ** 18n,
    wethWei: 8n * 10n ** 18n,
    usdcUnits: 25_000_000_000n,
    bases: { WETH: 8n * 10n ** 18n },
    stables: {},
  } as unknown as Parameters<typeof validateAction>[2];
  for (const a of emitted(out)) {
    const v = validateAction(a as never, obs, balances);
    assert.equal(v.ok, true, `${show(a)} -> ${v.ok ? "" : v.reason}`);
  }
});

test("R sizing: N* = R.e/4 at equal depth, and each cap binds when it is the smallest", async () => {
  R.resetROverlay();
  // Balancer cheap, Curve rich, both 1M deep in a fresh cache; Uniswap at fair (neither best).
  R.seedDepthCache("balancer", "WETH", 1_000_000, 100);
  R.seedDepthCache("curve", "WETH", 1_000_000, 100);
  const obs = rObs({ uni: 3000, bal: 2965, balH: 30, cur: 3035, curH: 30 });
  const plan = R.rPlan(obs, weth(marketViews(obs)), 25_000_000_000n, 8n * 10n ** 18n, 100);
  assert.ok(plan);
  assert.equal(plan.cheap.protocol, "balancer");
  assert.equal(plan.rich.protocol, "curve");
  assert.equal(plan.depthCheap.source, "cache");
  const e = plan.edgeBps / 1e4;
  assert.equal(plan.binding, "nStar");
  assert.ok(Math.abs(plan.notionalUsd - (1_000_000 * e) / 4) < 1e-6, `${plan.notionalUsd} vs ${(1e6 * e) / 4}`);
  // Unequal depths (1M / 2M): the harmonic form e / (2(1/Rc + 1/Rr)), not R.e/4 of either.
  R.seedDepthCache("curve", "WETH", 2_000_000, 100);
  const uneq = R.rPlan(obs, weth(marketViews(obs)), 25_000_000_000n, 8n * 10n ** 18n, 100);
  assert.ok(uneq);
  assert.equal(uneq.binding, "nStar");
  assert.ok(Math.abs(uneq.notionalUsd - e / (2 * (1 / 1e6 + 1 / 2e6))) < 1e-6);
  assert.ok(Math.abs(uneq.notionalUsd - (1e6 * e) / 4) > 100 && Math.abs(uneq.notionalUsd - (2e6 * e) / 4) > 100);

  R.resetROverlay();
  const base = (o: ROpts, usdc = 25_000_000_000n) => {
    const ob = rObs(o);
    return R.rPlan(ob, weth(marketViews(ob)), usdc, 8n * 10n ** 18n, 100);
  };
  const nav = base({ nav: 50_000 });
  assert.equal(nav?.binding, "nav");
  assert.ok(Math.abs((nav?.notionalUsd ?? 0) - 4000) < 1e-9);
  const wallet = base({}, 3_000_000_000n);
  assert.equal(wallet?.binding, "wallet");
  assert.ok(Math.abs((wallet?.notionalUsd ?? 0) - 2700) < 1e-9);
  // The strict memo guard (explicit zero-allowance control): Uniswap only 16.7 bps under fair, its leg may spend half of
  // that on its own impact.
  const strict = await withParams({ rLegAllowanceBps: 0 }, () => base({ uni: 2995, bal: 3080, cur: null }));
  assert.equal(strict?.binding, "guardCheap");
  assert.ok(Math.abs((strict?.notionalUsd ?? 0) - 0.5 * (3000 / 2995 - 1) * 3e6) < 1e-6);
  assert.equal(strict?.allowCheapBps, 0);
  // The allowance variant: the same leg has its room plus 40 bps, and Uniswap 16.7 bps *over* fair
  // still carries 0.5 x (40 - 16.6) bps x 3M -- with its limit exactly the full allowance past fair + fee.
  const room = 3000 / 3005 - 1;
  assert.equal(await withParams({ rLegAllowanceBps: 0 }, () => base({ uni: 3005, bal: 3080, cur: null })), null, "the strict rule leaves no room on the wrong side of fair");
  const guard = base({ uni: 3005, bal: 3080, cur: null });
  assert.equal(guard?.binding, "guardCheap");
  assert.ok(Math.abs((guard?.notionalUsd ?? 0) - 0.5 * (room + 0.004) * 3e6) < 1e-6, `${guard?.notionalUsd}`);
  assert.ok(Math.abs((guard?.allowCheapBps ?? 0) - 40) < 1e-6);
  assert.equal(guard?.allowRichBps, 0, "the pushed Balancer leg keeps the strict limit");
  // Never above $6k, whatever the edge.
  const huge = base({ uni: 2700, bal: 3300 });
  assert.ok(huge && huge.notionalUsd <= 6000 + 1e-9);
});

test("R gates: 100 bps of net edge and $25 of expected profit, each on its own", () => {
  R.resetROverlay();
  // Edge gate. Uniswap 100 bps under fair is the cheap leg; Balancer is priced to give e exactly
  // (it is sold at its mid less the pool's 0.3%).
  const at = (eBps: number) => {
    const balMid = ((1 + eBps / 1e4) * 2970 * 1.003) / 0.997;
    const ob = rObs({ uni: 2970, bal: balMid });
    return R.rPlan(ob, weth(marketViews(ob)), 25_000_000_000n, 8n * 10n ** 18n, 100);
  };
  assert.equal(at(99.5), null, "under 100 bps: no R");
  const ok = at(100.5);
  assert.ok(ok, "over 100 bps with 3M of depth: R");
  assert.ok(ok.profitUsd >= 25);
  // Profit gate. Same 110 bps edge; only the depth differs. At 750k a side (Uniswap L unknown,
  // Curve uncached) N* = 2,062 and the profit is $11; at 3M it is the $6k cap and $42.
  const thin = rObs({ uni: 2985, uniL: null, bal: null, cur: (1.011 * 2985 * 1.003 * 1.002), curH: 20 });
  const thinPlan = R.rPlan(thin, weth(marketViews(thin)), 25_000_000_000n, 8n * 10n ** 18n, 100);
  assert.equal(thinPlan, null);
  const tm = model(0.011, 750_000, 750_000, [6000]);
  assert.ok(tm.profit < 25 && tm.profit > 10, `model profit ${tm.profit}`);
  R.seedDepthCache("curve", "WETH", 3_000_000, 100);
  const deep = rObs({ uni: 2985, bal: null, cur: (1.011 * 2985 * 1.003 * 1.002), curH: 20 });
  const deepPlan = R.rPlan(deep, weth(marketViews(deep)), 25_000_000_000n, 8n * 10n ** 18n, 100);
  assert.ok(deepPlan, "the same edge at 3M of depth clears $25");
  assert.ok(Math.abs(deepPlan.edgeBps - 110) < 0.5);
});

// ---------------------------------------------------------------------------
// 3. the bid
// ---------------------------------------------------------------------------

test("R bid: one wei past rival x1.2, capped at 0.30.E/(fair.140k.legs), the default with no rival", () => {
  const gwei = (s: string) => Number(BigInt(s)) / 1e9;
  const obs = (rival: bigint | null, maxFeeWei = 1000n * GWEI) => rObs({ rival, maxFeeWei });
  // The memo's table (fair 3000, two legs): $25 -> 8.9, $168 -> 60, $1,163 -> 415 gwei.
  assert.ok(Math.abs(gwei(R.rPriorityFeeBid(obs(10_000n * GWEI), 25)) - 8.93) < 0.01);
  assert.ok(Math.abs(gwei(R.rPriorityFeeBid(obs(10_000n * GWEI), 168)) - 60) < 0.01);
  assert.ok(Math.abs(gwei(R.rPriorityFeeBid(obs(10_000n * GWEI), 1163)) - 415.4) < 0.1);
  // Under the cap the bid is one wei past rival x1.2: keeper 50 -> 60 gwei + 1 wei, in front of
  // max-profit-arb and adaptive-arb, whose own rule (rival x1.2) gives exactly 60 (memo §2.3).
  const mpaRule = (50n * GWEI * 12n) / 10n;
  assert.equal(R.rPriorityFeeBid(obs(50n * GWEI), 2000), (60n * GWEI + 1n).toString());
  assert.ok(BigInt(R.rPriorityFeeBid(obs(50n * GWEI), 2000)) > mpaRule, "not a tie with the rival x1.2 bidders");
  // Over it the cap is (a part-paid bid, as the memo's mpa rule): $25 against a 50 gwei rival.
  assert.ok(Math.abs(gwei(R.rPriorityFeeBid(obs(50n * GWEI), 25)) - 8.93) < 0.01);
  // No rival (0, or no competition block at all): the default, not a guess.
  assert.equal(R.rPriorityFeeBid(obs(0n), 2000), (GWEI / 10n).toString());
  assert.equal(R.rPriorityFeeBid(obs(null), 2000), (GWEI / 10n).toString());
  // Never below the default, never above the configured max.
  assert.equal(R.rPriorityFeeBid(obs(50n * GWEI), 0.05), (GWEI / 10n).toString());
  assert.equal(R.rPriorityFeeBid(obs(50n * GWEI, 5n * GWEI), 2000), (5n * GWEI).toString());
  // And the bundle carries it.
  R.resetROverlay();
  const o = rObs({ rival: 20n * GWEI });
  return run(R, o).then((out) => {
    const b = rBundleOf(out);
    assert.ok(b);
    assert.equal(b.maxPriorityFeePerGasWei, (24n * GWEI + 1n).toString());
  });
});

// ---------------------------------------------------------------------------
// 4. the leg guard
// ---------------------------------------------------------------------------

function quoteClient(quote: bigint) {
  return {
    call: async ({ to }: { to: Address }) => ({
      data:
        to.toLowerCase() === UNISWAP.quoterV2.toLowerCase()
          ? encodeFunctionResult({ abi: quoterV2Abi, functionName: "quoteExactInputSingle", result: [quote, 0n, 0, 0n] })
          : encodeFunctionResult({ abi: balancerQueriesAbi, functionName: "querySwap", result: quote }),
    }),
    readContract: async () => quote,
  };
}

const ABI = { uniswap: swapRouterAbi, balancer: balancerVaultAbi, curve: curveTricryptoAbi } as const;

/** The leg's calldata with the limit taken out, and the limit. */
function legParts(protocol: "uniswap" | "balancer" | "curve", data: Hex): { rest: string; limit: bigint } {
  const d = decodeFunctionData({ abi: ABI[protocol] as never, data }) as { functionName: string; args: unknown[] };
  if (protocol === "uniswap") {
    const p = { ...(d.args[0] as Record<string, unknown>) };
    const limit = p.amountOutMinimum as bigint;
    delete p.amountOutMinimum;
    return { rest: show([d.functionName, p]), limit };
  }
  if (protocol === "balancer")
    return { rest: show([d.functionName, d.args[0], d.args[1], d.args[3]]), limit: d.args[2] as bigint };
  return { rest: show([d.functionName, d.args[0], d.args[1], d.args[2]]), limit: d.args[3] as bigint };
}

test("R legs: the sdk adapter's own calldata, with only the limit replaced (every venue, side, base)", async () => {
  const adapters = { uniswap: uniswapAdapter, balancer: balancerAdapter, curve: curveAdapter } as const;
  const types = { uniswap: "swap", balancer: "balancerSwap", curve: "curveSwap" } as const;
  const client = quoteClient(10n ** 6n);
  let compared = 0;
  for (const base of ["WETH", "WBTC"])
    for (const protocol of ["uniswap", "balancer", "curve"] as const)
      for (const side of ["buy", "sell"] as const) {
        const amountIn = 123_456_789n;
        const ours = R.rLegTx(protocol, base, side, amountIn, 777n, ME);
        assert.ok(ours, `${protocol} ${base} ${side}`);
        const action = {
          type: types[protocol],
          tokenIn: side === "buy" ? "USDC" : base,
          ...(base === "WETH" ? {} : { base }),
          amountIn: amountIn.toString(),
        };
        const [sdk] = await adapters[protocol].buildTxs(
          { publicClient: client } as never,
          ME,
          action as never,
          undefined,
        );
        assert.equal(ours.to.toLowerCase(), sdk.to!.toLowerCase(), `${protocol} ${base} ${side}: target`);
        const a = legParts(protocol, ours.data);
        const b = legParts(protocol, sdk.data as Hex);
        assert.equal(a.rest, b.rest, `${protocol} ${base} ${side}: calldata`);
        assert.equal(a.limit, 777n);
        compared += 1;
      }
  assert.equal(compared, 12);
  // Negative control for the comparison itself: the wrong side does not match.
  const wrong = R.rLegTx("curve", "WETH", "sell", 123_456_789n, 777n, ME);
  const [sdkBuy] = await curveAdapter.buildTxs({ publicClient: client } as never, ME, { type: "curveSwap", tokenIn: "USDC", amountIn: "123456789" } as never, undefined);
  assert.notEqual(legParts("curve", wrong!.data).rest, legParts("curve", sdkBuy.data as Hex).rest);
});

test("R legs: pushed legs keep minOut at fair net of the venue fee", async () => {
  R.resetROverlay();
  const obs = rObs();
  const out = await run(R, obs);
  const b = rBundleOf(out);
  assert.ok(b);
  const [buyLeg, sellLeg] = b.txs;
  assert.equal(buyLeg.to.toLowerCase(), UNISWAP.swapRouter.toLowerCase());
  assert.equal(sellLeg.to.toLowerCase(), BALANCER.vault.toLowerCase());
  const buy = decodeFunctionData({ abi: swapRouterAbi, data: buyLeg.data });
  const p = buy.args[0];
  assert.equal(p.tokenIn.toLowerCase(), TOKENS.USDC.address.toLowerCase());
  assert.equal(p.recipient.toLowerCase(), ME.toLowerCase());
  const usdcIn = Number(p.amountIn) / 1e6;
  const baseMin = Number(p.amountOutMinimum) / 1e18;
  // Buy: never pay more than fair plus Uniswap's 30 bps per WETH (tight to rounding).
  const maxPaid = usdcIn / baseMin;
  assert.ok(maxPaid <= 3000 * 1.003 + 1e-6 && maxPaid > 3000 * 1.003 - 1e-6, `${maxPaid}`);
  const sell = decodeFunctionData({ abi: balancerVaultAbi, data: sellLeg.data });
  assert.equal(sell.functionName, "swap");
  const single = sell.args[0] as { assetIn: Address; amount: bigint };
  assert.equal(single.assetIn.toLowerCase(), TOKENS.WETH.address.toLowerCase());
  const sold = Number(single.amount) / 1e18;
  const usdcMin = Number(sell.args[2] as bigint) / 1e6;
  // Sell: never take less than fair less Balancer's pool fee (the leg is 150 bps from fair: no
  // allowance).
  const minGot = usdcMin / sold;
  assert.ok(minGot >= 3000 * 0.997 - 1e-6 && minGot < 3000 * 0.997 + 1e-6, `${minGot}`);
  // The sell leg sells what the buy leg is expected to bring in (inventory-neutral in expectation).
  assert.ok(sold < usdcIn / (2955 * 1.003) && sold > (usdcIn / (2955 * 1.003)) * 0.99);

  // What the guard buys. Suppose a rival closes the Balancer gap and overshoots to 0.5% under fair
  // before our sell lands, and the transaction was built (and its quote read) after that: C1's leg
  // takes anything within 40 bps of that quote, so it fills under fair. R's calldata limit does not
  // move with the venue, so the same fill is refused.
  const filledAt = sold * 3000 * 0.995 * 0.997 * (1 - 6000 / 3e6);
  assert.ok(filledAt < usdcMin, "R: the sell reverts rather than fill under fair net of fee");
  const quoteAtBuild = filledAt;
  assert.ok(filledAt >= quoteAtBuild * (1 - 40 / 1e4) && filledAt < sold * 3000 * 0.997);
  // And at a fair-or-better price R's sell does fill: the limit is not simply "never".
  assert.ok(sold * 3000 * 1.005 * 0.997 * (1 - 6000 / 3e6) >= usdcMin);
});

test("R legs: the chosen 40 bps default relaxes only the near-fair leg; strict zero stays C1", async () => {
  assert.equal(R.PARAMS.rLegAllowanceBps, 40, "the orchestrator chose 40 to avoid starving R");
  R.resetROverlay();
  // Uniswap 5 bps over fair is the cheapest buy. Under the guard buying there costs more than fair +
  // fee once its own impact is added: no room, R stands down, and C1's bundle goes as before.
  const obs = (uni = 3001.5) => rObs({ uni, bal: 3080, cur: null });
  const view = weth(marketViews(obs()));
  await withParams({ rLegAllowanceBps: 0 }, async () => {
    assert.equal(R.rPlan(obs(), view, 25_000_000_000n, 8n * 10n ** 18n, 100), null);
    const a = await run(A, obs());
    const r = await run(R, obs());
    assert.equal(show(r.action), show(a.action));
    assert.equal(show(r.submitted), show(a.submitted));
    assert.ok(r.tags.includes("xv:WETH"), "C1's bundle still fires");
  });
  // The chosen default (rLegAllowanceBps 40): the near leg carries the trade; only its limit is
  // moved -- never past fair + Uniswap's fee + 40 bps. The pushed Balancer leg keeps fair less its fee.
  {
    R.resetROverlay();
    const plan = R.rPlan(obs(), view, 25_000_000_000n, 8n * 10n ** 18n, 100);
    assert.ok(plan);
    assert.equal(plan.cheap.protocol, "uniswap");
    assert.ok(plan.allowCheapBps > 0 && plan.allowCheapBps <= 40 + 1e-9, `${plan.allowCheapBps}`);
    assert.equal(plan.allowRichBps, 0);
    const out = await run(R, obs());
    const b = rBundleOf(out);
    assert.ok(b, show(emitted(out)));
    const p = decodeFunctionData({ abi: swapRouterAbi, data: b.txs[0].data }).args[0];
    const maxPaid = Number(p.amountIn) / 1e6 / (Number(p.amountOutMinimum) / 1e18);
    assert.ok(maxPaid <= 3000 * 1.003 * 1.004 + 1e-6 && maxPaid > 3000 * 1.003, `${maxPaid}`);
    const s = decodeFunctionData({ abi: balancerVaultAbi, data: b.txs[1].data });
    const minGot = Number(s.args[2] as bigint) / 1e6 / (Number((s.args[0] as { amount: bigint }).amount) / 1e18);
    assert.ok(Math.abs(minGot - 3000 * 0.997) < 1e-6, `${minGot}`);
    // 45 bps over fair is past the allowance: no R, C1 as before.
    const far = () => obs(3000 * 1.0045);
    assert.equal(R.rPlan(far(), weth(marketViews(far())), 25_000_000_000n, 8n * 10n ** 18n, 100), null);
    const a2 = await run(A, far());
    const r2 = await run(R, far());
    assert.equal(show(r2.action), show(a2.action));
    assert.equal(show(r2.submitted), show(a2.submitted));
  }
});

test("R in the whale envelope: strict zero starves R; the chosen 40 bps default lets $6k through", async () => {
  // The reviewer's probe: Uniswap pushed 500 bps under fair, Balancer at fair + off bps, no Curve.
  const f = 0.003;
  const hW = (f / (1 - f) + 300 / 3e6) * 1e4;
  const plan = (off: number) => {
    R.resetROverlay();
    const ob = rObs({ uni: 3000 * 0.95, bal: 3000 * (1 + off / 1e4), balH: hW, cur: null });
    return R.rPlan(ob, weth(marketViews(ob)), 25_000_000_000n, 8n * 10n ** 18n, 100);
  };
  // The memo's guard: no R at or under fair, ~$150 per bp the near venue sits over it.
  const strict = await withParams({ rLegAllowanceBps: 0 }, () => [-10, 0, 5].map(plan));
  assert.deepEqual(strict.map((p) => (p ? Math.round(p.notionalUsd) : null)), [null, null, 750]);
  assert.equal(strict[2]?.allowRichBps, 0);
  {
    const at0 = plan(0);
    assert.ok(at0);
    // The $6k cap and the guard's 0.5 x 40 bps x 3M meet here (to float rounding).
    assert.ok(["max", "guardRich"].includes(at0.binding), at0.binding);
    assert.ok(Math.abs(at0.notionalUsd - 6000) < 0.01, `${at0.notionalUsd}`);
    assert.ok(at0.allowRichBps > 0 && at0.allowRichBps <= 40 + 1e-9);
    assert.equal(at0.allowCheapBps, 0, "the pushed leg is strict");
    // 10 bps on the wrong side: room -10 + 40 bps, half of it, on Balancer's depth.
    const under = plan(-10);
    assert.ok(under);
    assert.equal(under.binding, "guardRich");
    const room = 1 - 1 / 0.999;
    assert.ok(Math.abs(under.notionalUsd - 0.5 * (room + 0.004) * under.depthRich.usd) < 1e-6);
    assert.ok(Math.abs(under.allowRichBps - 40) < 1e-6);
    // The worst a lone Balancer sell can fill at under the variant: fair less the pool fee less 40 bps.
    const worst = (Number(under.sellMinOut) / 1e6) / (Number(under.sellUnits) / 1e18);
    assert.ok(Math.abs(worst - 3000 * 0.997 * 0.996) < 1e-3, `${worst}`);
  }
});

test("R on WBTC: edge and leg limit use Balancer's pool fee, not its $6k probe's half-spread", () => {
  R.resetROverlay();
  // WBTC's probe is 0.1 BTC = $6,000, so Balancer's observed half-spread is the 30.09 bp fee plus
  // ~20 bps of probe impact. Balancer pushed 300 bps under fair (cheap), Uniswap 300 over (rich).
  const f = 0.003;
  const hB = (f / (1 - f) + 6000 / 3e6) * 1e4;
  const obs = rWbtcObs({ uni: 61_800, bal: 58_200, balH: hB });
  const view = marketViews(obs).find((v) => v.base === "WBTC");
  assert.ok(view);
  const plan = R.rPlan(obs, view, 25_000_000_000n, 40_000_000n, 100);
  assert.ok(plan);
  assert.equal(plan.cheap.protocol, "balancer");
  assert.equal(plan.rich.protocol, "uniswap");
  // e from Balancer's mid / (1 - 0.003): 61,800 x 0.997 / (58,200 / 0.997) - 1 = 554.9 bps. The
  // probe's buy price (mid x (1 + h)) would have given 533.9: 21 bps of the probe's impact, counted
  // again by the k.N/R model.
  const e = (61_800 * 0.997) / (58_200 / 0.997) - 1;
  assert.ok(Math.abs(plan.edgeBps - e * 1e4) < 1e-6, `${plan.edgeBps}`);
  const probeE = (61_800 * 0.997) / (58_200 * (1 + hB / 1e4)) - 1;
  assert.ok(plan.edgeBps - probeE * 1e4 > 20);
  // The buy leg's worst accepted price: fair plus the pool fee, i.e. 60,000 / 0.997 = 60,180.5 --
  // not fair x (1 + h) = 60,300.5, which let a lone leg fill ~20 bps worse than fair + fee.
  assert.equal(plan.allowCheapBps, 0, "the pushed leg is strict");
  const worstBuy = Number(plan.usdcIn) / 1e6 / (Number(plan.buyMinOut) / 1e8);
  assert.ok(Math.abs(worstBuy - 60_000 / 0.997) < 0.05, `${worstBuy}`);
  assert.ok(60_000 * (1 + hB / 1e4) - worstBuy > 100);
});

test("R tries every venue pair: the best-priced seller with no room loses to one with room (strict memo guard)", async () => withParams({ rLegAllowanceBps: 0 }, () => {
  R.resetROverlay();
  // Curve sits exactly at fair: its sell price (2994.0) is the best, but its leg has no room under the
  // guard. Balancer 5 bps over fair sells a little worse (2992.5) with 5 bps of room on ~3M of depth:
  // the guard's 0.5 x 5 bps x 3M, ~$745 and ~$34.
  const obs = rObs({ uni: 2850, bal: 3001.5, cur: 3000, curH: 20 });
  const view = weth(marketViews(obs));
  const sells = view.venues.map((v) => [v.protocol, R.rVenuePrices("WETH", v).sell] as const);
  const bestPriced = sells.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.equal(bestPriced[0], "curve");
  const plan = R.rPlan(obs, view, 25_000_000_000n, 8n * 10n ** 18n, 100);
  assert.ok(plan);
  assert.equal(plan.rich.protocol, "balancer");
  assert.equal(plan.binding, "guardRich");
  assert.ok(plan.notionalUsd > 700 && plan.notionalUsd < 760, `${plan.notionalUsd}`);
  assert.ok(plan.profitUsd > 25, `${plan.profitUsd}`);
  // Control: the best-priced seller alone (Balancer gone) gives no plan at all.
  const curveOnly = rObs({ uni: 2850, bal: null, cur: 3000, curH: 20 });
  assert.equal(R.rPlan(curveOnly, weth(marketViews(curveOnly)), 25_000_000_000n, 8n * 10n ** 18n, 100), null);
}));

test("R takes a base from C1 only when it is worth more after its own bid (strict memo guard)", async () => withParams({ rLegAllowanceBps: 0 }, async () => {
  // Uniswap pushed 500 bps under fair; Balancer only 5 bps over fair, so R's guard holds it to ~$745
  // and ~$34, ~$24 after its bid (a 50 gwei rival: the 30% cap) -- under C1's $1,125 bundle (~$51 by
  // C1's own model, at the floor bid).
  const obs = (bal: number) => rObs({ uni: 2850, bal, cur: null });
  const near = obs(3000 * (1 + 5 / 1e4));
  R.resetROverlay();
  const plan = R.rPlan(near, weth(marketViews(near)), 25_000_000_000n, 8n * 10n ** 18n, 100);
  assert.ok(plan, "an R plan clears R's own gates");
  assert.ok(plan.notionalUsd < 1125 && plan.profitUsd >= 25, `${plan.notionalUsd} ${plan.profitUsd}`);
  const c1 = R.crossVenuePlan(near, weth(marketViews(near)), 25_000_000_000n, 8n * 10n ** 18n);
  assert.ok(c1 && c1.profitUsd > plan.profitUsd);
  const a = await run(A, obs(3000 * (1 + 5 / 1e4)));
  R.resetROverlay();
  const r = await run(R, obs(3000 * (1 + 5 / 1e4)));
  assert.ok(!r.tags.includes("xvR:WETH"));
  assert.equal(show(r.action), show(a.action), "C1's trade, exactly");
  assert.equal(show(r.submitted), show(a.submitted));
  // Control: Balancer 150 bps over fair, R's trade is the $6k one and it goes.
  R.resetROverlay();
  const r2 = await run(R, obs(3045));
  assert.ok(r2.tags.includes("xvR:WETH"), r2.tags.join(","));
}));

// ---------------------------------------------------------------------------
// 5. the brake
// ---------------------------------------------------------------------------

test("brake: >= 8 settled with >= 40% one-sided pauses R for 36 blocks, then half size until it heals", () => {
  const b = new R.RBrake();
  b.onBlock(100);
  for (let i = 0; i < 5; i++) b.push(false, 100);
  for (let i = 0; i < 2; i++) b.push(true, 100);
  assert.equal(b.mode(100), "full", "7 settled is under the minimum");
  b.push(true, 100); // 3 of 8 = 37.5%
  assert.equal(b.mode(100), "full", "37.5% is under 40%");
  b.push(true, 100); // 4 of 9 = 44%
  assert.equal(b.mode(100), "paused");
  assert.equal(b.mode(135), "paused");
  assert.equal(b.mode(136), "half", `pause is ${R.PARAMS.brakePauseBlocks} blocks`);
  assert.equal(b.window.length, 0, "pre-pause outcomes do not carry into the resumed state");
  b.push(true, 120); // during the pause: ignored
  assert.equal(b.window.length, 0);
  // Half size until 8 settle under 25%: 2 of 8 is 25% -> still half; then a clean run heals it.
  for (const x of [true, true, false, false, false, false, false, false]) b.push(x, 140);
  assert.equal(b.mode(140), "half", "25% is not under 25%");
  b.push(false, 141); // last 8: 1 of 8
  assert.equal(b.mode(141), "full");
  // Relapse in probation pauses again.
  const c = new R.RBrake();
  c.onBlock(100);
  for (let i = 0; i < 8; i++) c.push(i < 4, 100);
  assert.equal(c.mode(100), "paused");
  for (let i = 0; i < 8; i++) c.push(i < 4, 140);
  assert.equal(c.mode(140), "paused", "4 of 8 one-sided again after resuming");
});

test("brake: the window is the last 20 settled bundles", () => {
  const b = new R.RBrake();
  b.onBlock(100);
  for (let i = 0; i < 30; i++) b.push(false, 100);
  for (let i = 0; i < 7; i++) b.push(true, 100);
  assert.equal(b.mode(100), "full", "7 of the last 20 is 35%");
  b.push(true, 100);
  assert.equal(b.mode(100), "paused", "8 of the last 20 is 40% (8 of 38 would not be)");
});

test("brake: an epoch start (block discontinuity) resets it, an ordinary gap does not", () => {
  const trip = (b: InstanceType<typeof R.RBrake>, block: number) => {
    for (let i = 0; i < 8; i++) b.push(true, block);
    assert.equal(b.mode(block), "paused");
  };
  const back = new R.RBrake();
  back.onBlock(200, 100);
  trip(back, 200);
  assert.equal(back.onBlock(150, 300), true, "block went backwards");
  assert.equal(back.mode(150), "full");
  const jump = new R.RBrake();
  jump.onBlock(200, 100);
  trip(jump, 200);
  assert.equal(jump.onBlock(200 + R.PARAMS.epochGapBlocks + 1, 99), true);
  assert.equal(jump.window.length, 0);
  const rem = new R.RBrake();
  rem.onBlock(200, 10);
  trip(rem, 200);
  assert.equal(rem.onBlock(201, 360), true, "blocksRemaining went up");
  const ep = new R.RBrake();
  ep.onBlock(200, 100, 3);
  trip(ep, 200);
  assert.equal(ep.onBlock(201, 99, 4), true, "epoch ordinal changed");
  const same = new R.RBrake();
  same.onBlock(200, 100);
  trip(same, 200);
  assert.equal(same.onBlock(205, 95), false);
  assert.equal(same.mode(205), "paused");
  // A bundle whose receipts never came back ages out instead of waiting forever.
  same.record({ base: "WETH", block: 205, legs: [], checking: true });
  same.onBlock(205 + R.PARAMS.brakePendingMaxBlocks, 95 - R.PARAMS.brakePendingMaxBlocks);
  assert.equal(same.pending.length, 1);
  same.onBlock(206 + R.PARAMS.brakePendingMaxBlocks, 94 - R.PARAMS.brakePendingMaxBlocks);
  assert.equal(same.pending.length, 0);
});

/** A chain where block N holds the given txs and each hash has a receipt status. */
function receiptClient(blocks: Record<number, Array<{ from: string; to: string; input: string; hash: string }>>, status: Record<string, string>) {
  return {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ transactions: blocks[Number(blockNumber)] ?? [] }),
    getTransactionReceipt: async ({ hash }: { hash: string }) => ({ status: status[hash] ?? "reverted" }),
  };
}

test("brake: R bundles are settled from their receipts over +1..+3, in the background", async () => {
  type Legs = Array<{ to: Address; data: Hex }>;
  const tx = (l: Legs, i: number, hash: string) => ({ from: ME, to: l[i].to, input: l[i].data, hash });
  const cases: Array<[string, (legs: Legs) => Parameters<typeof receiptClient>, boolean[]]> = [
    ["buy filled, sell reverted", (l) => [{ 101: [tx(l, 0, "0xa"), tx(l, 1, "0xb")] }, { "0xa": "success", "0xb": "reverted" }], [true]],
    ["both filled", (l) => [{ 101: [tx(l, 0, "0xa"), tx(l, 1, "0xb")] }, { "0xa": "success", "0xb": "success" }], [false]],
    // Legs that land late, one block apart, are still one completed bundle (the window was +1..+2).
    ["both filled, landing at +2 and +3", (l) => [{ 102: [tx(l, 0, "0xa")], 103: [tx(l, 1, "0xb")] }, { "0xa": "success", "0xb": "success" }], [false]],
    ["sell landed late and alone", (l) => [{ 103: [tx(l, 1, "0xb")] }, { "0xb": "success" }], [true]],
    // Both legs reverted (here at R's raised bid, a 50 gwei rival): settled, and not one-sided.
    ["both reverted", (l) => [{ 101: [tx(l, 0, "0xa"), tx(l, 1, "0xb")] }, { "0xa": "reverted", "0xb": "reverted" }], [false]],
    ["dropped: no leg landed", () => [{}, {}], []],
    // Someone else sending the same calldata is not our leg.
    ["a stranger's identical tx", (l) => [{ 101: [{ from: "0x00000000000000000000000000000000000000ff", to: l[0].to, input: l[0].data, hash: "0xa" }] }, { "0xa": "success" }], []],
  ];
  for (const [name, chain, expected] of cases) {
    R.resetROverlay();
    const at = (block: number) => rObs({ block, blocksRemaining: 400 - block });
    const first = await run(R, at(100));
    const b = rBundleOf(first);
    assert.ok(b, name);
    assert.equal(R.rBrakeState().pending.length, 1, `${name}: recorded`);
    const [blocks, status] = chain(b.txs);
    const client = receiptClient(blocks, status);
    // Blocks 101 and 102: too early (the legs get three blocks to land), nothing is read.
    for (const block of [101, 102]) {
      await run(R, at(block), client);
      await flush();
      assert.equal(R.rBrakeState().window.length, 0, `${name}: not settled at ${block}`);
    }
    await run(R, at(103), client);
    await flush();
    assert.deepEqual(R.rBrakeState().window, expected, name);
  }
});

test("brake: only a one-sided bundle is bad (memo §2.3); both legs reverted is settled and not bad", () => {
  const legs = [{ to: "0x01", data: "0x" }, { to: "0x02", data: "0x" }];
  const feed = (found: number, filled: number) => {
    const b = new R.RBrake();
    b.onBlock(100);
    for (let i = 0; i < 20; i++) {
      const p = { base: "WETH", block: 100, legs, checking: true };
      b.record(p);
      b.resolve(p, found, filled);
    }
    return { mode: b.mode(100), settled: b.window.length };
  };
  assert.deepEqual(feed(2, 1), { mode: "paused", settled: 0 }, "one leg filled, one reverted");
  assert.deepEqual(feed(1, 1), { mode: "paused", settled: 0 }, "one leg filled, the other never landed");
  assert.deepEqual(feed(2, 0), { mode: "full", settled: 20 }, "both legs reverted: settled, not bad");
  assert.deepEqual(feed(1, 0), { mode: "full", settled: 20 }, "one leg landed and reverted");
  assert.deepEqual(feed(2, 2), { mode: "full", settled: 20 }, "both filled");
  assert.deepEqual(feed(0, 0), { mode: "full", settled: 0 }, "nothing landed: dropped, not settled");
});

test("brake: a worker reloaded mid-run starts at half size; a run's first block does not", async () => {
  R.resetROverlay();
  const fresh = rBundleOf(await run(R, rObs({ block: 100, sample: 0 })));
  assert.ok(fresh);
  assert.equal(R.rBrakeState().mode(100), "full");
  // A fresh module (the reload) seeing an observation whose parent has resolved own transactions.
  R.resetROverlay();
  const reloaded = await run(R, rObs({ block: 150, sample: 6 }));
  const half = rBundleOf(reloaded);
  assert.ok(half);
  assert.equal(R.rBrakeState().mode(150), "half");
  assert.ok(reloaded.reasons.some((x) => x.includes("half size")));
  const usdc = (bundle: { txs: Array<{ data: Hex }> }) =>
    decodeFunctionData({ abi: swapRouterAbi, data: bundle.txs[0].data }).args[0].amountIn;
  assert.equal(usdc(half) * 2n, usdc(fresh));
  // Only the first block a brake sees: later blocks of the same run do not re-enter probation.
  R.resetROverlay();
  await run(R, rObs({ block: 100, sample: 0 }));
  await run(R, rObs({ block: 101, blocksRemaining: 299, sample: 6 }));
  assert.equal(R.rBrakeState().mode(101), "full");
});

test("brake: outcomes it cannot read (refused or hanging) age out uncounted, never a pause; reads back off", async () => {
  const runBlocks = async (client: unknown, last: number) => {
    R.resetROverlay();
    const modes: Array<[number, string]> = [];
    for (let block = 100; block <= last; block++) {
      await run(R, rObs({ block, blocksRemaining: 400 - block }), client);
      await flush();
      modes.push([block, R.rBrakeState().mode(block)]);
    }
    return modes;
  };
  const firstPaused = (m: Array<[number, string]>) => m.find(([, x]) => x !== "full")?.[0];
  let getBlocks = 0;
  const refusing = {
    getBlock: () => {
      getBlocks += 1;
      return Promise.reject(new Error("429 Too Many Requests"));
    },
    getTransactionReceipt: () => Promise.reject(new Error("429 Too Many Requests")),
  };
  // One R bundle a block from 100. Undetermined outcomes are not in the denominator (plan §5): R is
  // never paused for them, nothing settles, and each bundle leaves the brake 13 blocks on.
  const refused = await runBlocks(refusing, 120);
  assert.equal(firstPaused(refused), undefined, show(refused));
  assert.equal(R.rBrakeState().window.length, 0);
  assert.equal(R.rBrakeState().expired, 8, "bundles from 100..107 aged out by 120");
  // Backed off 2, 4, 8, 8 blocks: one read at 103, two each at 105, 109 and 117 (oldest two due).
  assert.equal(getBlocks, 7, `getBlock calls over 21 blocks: ${getBlocks}`);
  const hanging = await runBlocks(hangingClient, 120);
  assert.equal(firstPaused(hanging), undefined, show(hanging));
  assert.equal(R.rBrakeState().expired, 8);
  // Control: reads answer and every bundle completes -- never paused, nothing expires.
  R.resetROverlay();
  const legs = rBundleOf(await run(R, rObs({ block: 99, blocksRemaining: 301 })))!.txs;
  const answering = {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      transactions: [
        { from: ME, to: legs[0].to, input: legs[0].data, hash: `0xa${blockNumber}` },
        { from: ME, to: legs[1].to, input: legs[1].data, hash: `0xb${blockNumber}` },
      ],
    }),
    getTransactionReceipt: async () => ({ status: "success" }),
  };
  const ok = await runBlocks(answering, 115);
  assert.equal(firstPaused(ok), undefined, show(ok));
  assert.equal(R.rBrakeState().expired, 0);
  assert.ok(R.rBrakeState().window.length >= 10, `${R.rBrakeState().window.length} settled`);
});

test("settle reads: each block is fetched once however many bundles search it; at most 2 start a block", async () => {
  R.resetROverlay();
  const fetched = new Map<number, number>();
  const empty = {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      fetched.set(Number(blockNumber), (fetched.get(Number(blockNumber)) ?? 0) + 1);
      return { transactions: [] };
    },
    getTransactionReceipt: async () => ({ status: "success" }),
  };
  // Bundles at 100..105; each searches its next three blocks, which overlap.
  for (let block = 100; block <= 108; block++) {
    await run(R, rObs({ block, blocksRemaining: 400 - block }), empty);
    await flush();
  }
  assert.ok(fetched.size >= 6, show([...fetched]));
  assert.ok([...fetched.values()].every((n) => n === 1), show([...fetched]));
  // Three due at once: only the oldest two start.
  R.resetROverlay();
  const brake = R.rBrakeState();
  brake.onBlock(100);
  for (let i = 0; i < 3; i++) brake.record({ base: "WETH", block: 100 + i, legs: [], checking: false });
  const hang = { getBlock: () => new Promise(() => undefined), getTransactionReceipt: () => new Promise(() => undefined) };
  void R.startBrakeSettle(hang, ME, 103 + 2);
  assert.deepEqual(brake.pending.map((p) => p.checking), [true, true, false]);
});

test("brake: while paused M1 is exactly C1; after the pause R returns at half size", async () => {
  R.resetROverlay();
  const full = await run(R, rObs({ block: 100, blocksRemaining: 300 }));
  const fullPlan = rBundleOf(full);
  assert.ok(fullPlan);
  const brake = R.rBrakeState();
  brake.pending = [];
  for (let i = 0; i < 8; i++) brake.push(true, 100);
  assert.equal(brake.mode(101), "paused");
  const a = await run(A, rObs({ block: 101, blocksRemaining: 299 }));
  const r = await run(R, rObs({ block: 101, blocksRemaining: 299 }));
  assert.equal(show(r.action), show(a.action), "paused: returned action is C1's");
  assert.equal(show(r.submitted), show(a.submitted), "paused: submitted actions are C1's");
  assert.ok(r.tags.includes("xv:WETH") && !r.tags.includes("xvR:WETH"));
  // Decide every block or two, as the runtime does (a gap over epochGapBlocks would be an epoch).
  const mid = await run(R, rObs({ block: 120, blocksRemaining: 280 }));
  assert.ok(!mid.tags.includes("xvR:WETH"), "still paused at block 120");
  const after = await run(R, rObs({ block: 100 + R.PARAMS.brakePauseBlocks, blocksRemaining: 300 - R.PARAMS.brakePauseBlocks }));
  const half = rBundleOf(after);
  assert.ok(half, "R resumes");
  const usdc = (bundle: { txs: Array<{ data: Hex }> }) =>
    decodeFunctionData({ abi: swapRouterAbi, data: bundle.txs[0].data }).args[0].amountIn;
  assert.equal(usdc(half) * 2n, usdc(fullPlan), "half the full-size notional");
  assert.ok(after.reasons.some((x) => x.includes("half size")));
});

// ---------------------------------------------------------------------------
// 6. M4 first
// ---------------------------------------------------------------------------

function liquidatableObs(round: number): AgentObservation {
  const obs = obsFor({ uniMid: 3000, curveMid: 3060, rivalFeeWei: GWEI, round });
  (obs.balances as { ethWei: string }).ethWei = "2000000000000000000"; // windfall ETH: M7 wraps it
  (obs.protocols as Record<string, unknown>).liquity = {
    riskiestTrove: { icr: 1.05, netDebtEusdWei: "10000000000000000000000" },
    mcr: 1.1,
    tcr: 1.6,
    recoveryMode: false,
    gasCompensationEusdWei: "200000000000000000000",
    eusdBalanceWei: "0",
    marketQuoted: false,
    redemptionEdgeBps: 0,
    redemptionRateBps: 50,
  };
  return obs;
}

test("M4: a liquidation goes out first, and M1/M2 wait for the next block", async () => {
  const a = await run(A, liquidatableObs(500));
  const r = await run(R, liquidatableObs(500));
  const order = (o: Out) => [...o.submitted, o.action].filter(Boolean).map((x) => (x as { type: string }).type);
  // opus-1a: the bundle is submitted before the liquidation, so its nonces come first (the Q202 loss).
  assert.deepEqual(order(a), ["bundle", "liquityLiquidate"]);
  // opus-1r: the liquidation is the first nonce; no swap of M1 or M2 rides in the same block.
  assert.equal(order(r)[0], "liquityLiquidate");
  assert.ok(!order(r).some((t) => ["bundle", "rawBundle", "swap", "curveSwap", "balancerSwap"].includes(t)), order(r).join(","));
  assert.ok(!r.tags.some((t) => /^(xv|xvR|inv):/.test(t)), r.tags.join(","));
  assert.deepEqual(order(r), ["liquityLiquidate", "rawTx"], "the other action (wrap) follows it");
  // No windfall to wrap, and M2 past its band (a forced unwind, priority 2): opus-1a sends the M2
  // sell with the liquidation; opus-1r sends the liquidation alone, and M2 goes next block.
  const pastBand = () => {
    const o = liquidatableObs(600);
    const b = o.balances as { ethWei: string; wethWei: string };
    b.ethWei = "1000000000000000000";
    b.wethWei = "11000000000000000000";
    (o.baseBalances as Record<string, string>).WETH = "11000000000000000000";
    return o;
  };
  const a2 = await run(A, pastBand());
  assert.ok(a2.tags.includes("inv:WETH:sell") && a2.tags.includes("liquity:liquidate"), a2.tags.join(","));
  const r2 = await run(R, pastBand());
  assert.deepEqual(r2.tags, ["liquity:liquidate"]);
  assert.deepEqual(order(r2), ["liquityLiquidate"]);
  // A block with no liquidation is untouched (M1 back): next block, past the cooldown.
  const quiet = obsFor({ uniMid: 3000, curveMid: 3060, rivalFeeWei: GWEI, round: 510 });
  const qa = await run(A, quiet);
  const qr = await run(R, quiet);
  assert.equal(show(qr.action), show(qa.action));
});

const sendOrder = (o: Out) =>
  [...o.submitted, o.action].filter(Boolean).map((x) => (x as { type: string }).type);

test("M2: a submitted R bundle suppresses the same-base step that compounds a lone-leg fill", async () => {
  // Without suppression, R's $6k buy plus M2's $2.5k step exposes $8.5k and forces a $6.7k
  // sell next block (the anchor's $3.6k band is reduced to half). R alone can still cross the band,
  // but M2 must not add to that risk before either R leg's outcome is known.
  R.resetROverlay();
  const obs = rObs();
  const view = weth(marketViews(obs));
  const anchor = 8n * 10n ** 18n;
  const step = R.inventoryPlan(view, anchor, anchor, 300);
  assert.equal(step?.side, "buy");
  assert.equal(step?.notionalUsd, 2500);
  const stackedHeld = anchor + BigInt(Math.round(8500 / view.fair * 1e18));
  const unwind = R.inventoryPlan(view, stackedHeld, anchor, 299);
  assert.equal(unwind?.forced, true);
  assert.equal(unwind?.side, "sell");
  assert.ok(Math.abs(unwind!.notionalUsd - 6700) < 1e-6);

  const out = await run(R, obs);
  const bundle = rBundleOf(out);
  assert.ok(bundle, show(emitted(out)));
  const buy = decodeFunctionData({ abi: swapRouterAbi, data: bundle.txs[0].data }).args[0];
  assert.equal(buy.amountIn, 6_000_000_000n);
  assert.deepEqual(out.tags, ["xvR:WETH"]);
  assert.deepEqual(sendOrder(out), ["rawBundle"]);
  // When the next observation actually shows a lone buy filled, M2 is allowed to unwind it.
  const next = await run(R, rObs({ block: 101, blocksRemaining: 299, weth: "10000000000000000000" }));
  assert.ok(next.tags.includes("inv:WETH:sell"), next.tags.join(","));
  assert.ok(!next.tags.includes("xvR:WETH"), next.tags.join(","));
});

test("M2: R also suppresses a same-base sell, while another base can use the freed slot", async () => {
  R.resetROverlay();
  const sellObs = rObs({ uni: 3000, bal: 3100, cur: null });
  const anchor = 8n * 10n ** 18n;
  assert.equal(R.inventoryPlan(weth(marketViews(sellObs)), anchor, anchor, 300)?.side, "sell");
  const sellOut = await run(R, sellObs);
  assert.deepEqual(sellOut.tags, ["xvR:WETH"]);
  assert.deepEqual(sendOrder(sellOut), ["rawBundle"]);

  R.resetROverlay();
  const obs = rObs();
  const btc = rWbtcObs({ uni: 59_400, bal: 59_400, balH: 31.1, cur: 59_400, curH: 20 });
  const x = obs as unknown as Record<string, Record<string, unknown>>;
  x.fairPricesUsd.WBTC = 60_000;
  x.baseDecimals.WBTC = 8;
  x.baseBalances.WBTC = "40000000";
  const p = obs.protocols as unknown as Record<string, Record<string, unknown>>;
  const bp = btc.protocols as unknown as Record<string, Record<string, unknown>>;
  for (const venue of ["uniswap", "balancer", "curve"]) p[venue].markets = bp[venue].markets;
  const out = await run(R, obs);
  assert.deepEqual(out.tags, ["xvR:WETH", "inv:WBTC:buy"]);
  assert.deepEqual(sendOrder(out), ["rawBundle", "curveSwap"]);
  const [first, second] = [...out.submitted, out.action] as Array<{ maxPriorityFeePerGasWei: string }>;
  assert.ok(BigInt(first.maxPriorityFeePerGasWei) > BigInt(second.maxPriorityFeePerGasWei));
});

test("R stands down for a base M2 is force-unwinding; C1's path runs exactly as it would", async () => {
  // A lone $6k R buy leg left 2 WETH over the anchor: $6k against a $3.6k band, so M2 forces a sell.
  // A fresh R bundle on the same venues would stack on it.
  const over = () => rObs({ weth: "10000000000000000000" });
  R.resetROverlay();
  const r = await run(R, over());
  const a = await run(A, over());
  assert.ok(r.tags.includes("inv:WETH:sell"), r.tags.join(","));
  assert.ok(!r.tags.includes("xvR:WETH"), r.tags.join(","));
  assert.equal(show(r.action), show(a.action));
  assert.equal(show(r.submitted), show(a.submitted));
  // Control: at the anchor R fires.
  R.resetROverlay();
  assert.ok((await run(R, rObs())).tags.includes("xvR:WETH"));
});

test("ranking: a lower-value C1 cannot displace R behind a protected eUSD buy", () => {
  const c = (tag: string, profitUsd: number, r = false) => ({ tag, priority: 1, profitUsd, rLeg: r ? {} : undefined });
  const protectedBuy = c("liquity:buy-eusd", 36);
  const c1 = c("xv:WBTC", 40);
  const r = c("xvR:WETH", 150, true);
  // All input orders must produce the probe's intended two slots: eUSD + R.
  for (const xs of [[protectedBuy, c1, r], [protectedBuy, r, c1], [c1, protectedBuy, r],
    [c1, r, protectedBuy], [r, protectedBuy, c1], [r, c1, protectedBuy]]) {
    assert.deepEqual(R.rankCandidates(xs).slice(0, 2).map((x) => x.tag), ["liquity:buy-eusd", "xvR:WETH"]);
  }
  // An unprotected trade genuinely worth more than R still competes on its own value.
  assert.deepEqual(
    R.rankCandidates([protectedBuy, c("xv:WBTC", 200), r]).map((x) => x.tag),
    ["xv:WBTC", "liquity:buy-eusd", "xvR:WETH"],
  );
  assert.equal(r.profitUsd, 150, "ranking does not rewrite R's expected profit");
});

test("ranking: an R bundle never outranks a launch entry or M3's eUSD buy; otherwise the order is C1's", () => {
  const c = (tag: string, profitUsd: number, priority = 1, r = false) => ({ tag, priority, profitUsd, ...(r ? { rLeg: {} } : {}) });
  const tags = (xs: Array<ReturnType<typeof c>>) => R.rankCandidates(xs).map((x) => x.tag);
  // A launch entry ($300) against a $500 R bundle and C1's $60 on the other base.
  assert.deepEqual(tags([c("xvR:WETH", 500, 1, true), c("xv:WBTC", 60), c("launch:enter", 300)]), ["launch:enter", "xvR:WETH", "xv:WBTC"]);
  assert.deepEqual(tags([c("xvR:WETH", 500, 1, true), c("xv:WBTC", 60), c("liquity:liquidate", 36)]), ["liquity:liquidate", "xvR:WETH", "xv:WBTC"]);
  // Two R bundles under an M3 buy keep their own profit order.
  assert.deepEqual(
    tags([c("xvR:WETH", 120, 1, true), c("xvR:WBTC", 320, 1, true), c("liquity:buy-eusd", 36)]),
    ["liquity:buy-eusd", "xvR:WBTC", "xvR:WETH"],
  );
  // Priority still comes first: a forced M2 unwind outranks all of them.
  assert.deepEqual(tags([c("launch:enter", 300), c("inv:WETH:sell", 0, 2), c("xvR:WETH", 500, 1, true)]), ["inv:WETH:sell", "launch:enter", "xvR:WETH"]);
  // With nothing protected in the block, R ranks on its profit like anything else.
  assert.deepEqual(tags([c("wrap", 0), c("xv:WBTC", 60), c("xvR:WETH", 500, 1, true)]), ["xvR:WETH", "xv:WBTC", "wrap"]);
  // Without an R bundle the order is opus-1a's (priority, then profit) -- where C1's xv may outrank M3.
  const plain = [c("xv:WETH", 47), c("liquity:buy-eusd", 36), c("launch:enter", 300), c("inv:WETH:buy", 10, 0)];
  const c1 = [...plain].sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : b.profitUsd - a.profitUsd));
  assert.deepEqual(tags([...plain]), c1.map((x) => x.tag));
  assert.deepEqual(tags([...plain]), ["launch:enter", "xv:WETH", "liquity:buy-eusd", "inv:WETH:buy"]);
});

test("M3: two R bundles do not take the slot of M3's eUSD buy (memo §5: Liquity is the cdp earner)", async () => {
  // WETH: Uniswap 150 bps under fair, Balancer 150 over. WBTC: Balancer 300 under, Uniswap 300 over.
  // eUSD 120 bps under its redemption value: M3 buys $4,000 (~$36 by its own model).
  const f = 0.003;
  const hB = (f / (1 - f) + 6000 / 3e6) * 1e4;
  const make = () => {
    const obs = rObs();
    const x = obs as unknown as Record<string, Record<string, unknown>>;
    x.fairPricesUsd.WBTC = 60_000;
    x.baseDecimals.WBTC = 8;
    x.baseBalances.WBTC = "40000000";
    const p = obs.protocols as unknown as Record<string, Record<string, unknown>>;
    p.uniswap.markets = {
      "WBTC/USDC": { pair: "WBTC/USDC", fee: 3000, priceUsdcPerWeth: 61_800, tick: 0, tickSpacing: 60, liquidity: UNI_L },
    };
    p.balancer.markets = { "WBTC/USDC": amm(58_200, hB) };
    p.liquity = {
      riskiestTrove: { icr: 1.3, netDebtEusdWei: "10000000000000000000000" },
      mcr: 1.1,
      tcr: 1.6,
      recoveryMode: false,
      gasCompensationEusdWei: "200000000000000000000",
      eusdBalanceWei: "0",
      marketQuoted: true,
      redemptionEdgeBps: 120,
      redemptionRateBps: 50,
    };
    return obs;
  };
  // Both bases carry an R trade worth more than M3's buy.
  R.resetROverlay();
  const o = make();
  for (const base of ["WETH", "WBTC"]) {
    const view = marketViews(o).find((v) => v.base === base)!;
    const plan = R.rPlan(o, view, 25_000_000_000n, base === "WETH" ? 8n * 10n ** 18n : 40_000_000n, 100);
    assert.ok(plan && plan.profitUsd > 36, `${base}: ${plan?.profitUsd}`);
  }
  const a = await run(A, make());
  assert.ok(a.tags.includes("liquity:buy-eusd"), `opus-1a takes M3's buy here: ${a.tags.join(",")}`);
  R.resetROverlay();
  const r = await run(R, make());
  assert.ok(r.tags.includes("liquity:buy-eusd"), r.tags.join(","));
  assert.equal(r.tags.filter((t) => t.startsWith("xvR:")).length, 1, r.tags.join(","));
  assert.ok(r.tags.includes("xvR:WBTC"), "the better of the two R bundles keeps the other slot");
  // Ranked under M3's buy, R's bundle is still the first nonce.
  assert.deepEqual(sendOrder(r), ["rawBundle", "liquitySwapEusd"]);
});

// ---------------------------------------------------------------------------
// 7. depth: the estimator's guards, the cache, and never waiting for it
// ---------------------------------------------------------------------------

const balancerVenue = (mid: number, hBps: number) => {
  const q = amm(mid, hBps);
  return {
    protocol: "balancer" as const,
    swapType: "balancerSwap" as const,
    price: q.priceUsdcPerWeth,
    feeBps: hBps,
    sellPrice: q.sellPriceUsdcPerWeth,
    buyPrice: q.buyPriceUsdcPerWeth,
  };
};

test("depth: the Balancer spread estimate and its guards", () => {
  const f = 0.003;
  // WETH, 3M a side: h = 30.09 + 1.00 bps -> 3M.
  const h3m = (f / (1 - f) + 300 / 3e6) * 1e4;
  assert.ok(Math.abs(R.balancerSpreadDepthUsd(balancerVenue(3000, h3m), f)! - 3e6) < 1);
  // 1.5M: inside the clamp, so returned as is.
  const h15 = (f / (1 - f) + 300 / 1.5e6) * 1e4;
  assert.ok(Math.abs(R.balancerSpreadDepthUsd(balancerVenue(3000, h15), f)! - 1.5e6) < 1);
  // 4M is past the ceiling but under twice it: clamped to 3M.
  const h4 = (f / (1 - f) + 300 / 4e6) * 1e4;
  assert.equal(R.balancerSpreadDepthUsd(balancerVenue(3000, h4), f), 3e6);
  // Denominator small: 0.01 bp implies 30M -- fee noise, not depth. Refused, not clamped.
  assert.equal(R.balancerSpreadDepthUsd(balancerVenue(3000, f / (1 - f) * 1e4 + 0.01), f), null);
  // Denominator negative (the fee is a bp off the other way). Refused.
  assert.equal(R.balancerSpreadDepthUsd(balancerVenue(3000, 29.5), f), null);
  // Very thin: 100k implied, clamped up to the 750k floor (today's behaviour, never below it).
  const hThin = (f / (1 - f) + 300 / 1e5) * 1e4;
  assert.equal(R.balancerSpreadDepthUsd(balancerVenue(3000, hThin), f), 750_000);
  // WBTC's probe is $6,000, so its denominator is ~20 bps and the estimate is robust.
  const hBtc = (f / (1 - f) + 6000 / 3e6) * 1e4;
  assert.ok(Math.abs(R.balancerSpreadDepthUsd(balancerVenue(60_000, hBtc), f)! - 3e6) < 1);
  // Not a two-sided quote, or not Balancer, or no sane fee: no estimate.
  const legacy = { protocol: "balancer" as const, swapType: "balancerSwap" as const, price: 3000, feeBps: 31 };
  assert.equal(R.balancerSpreadDepthUsd(legacy, f), null);
  assert.equal(R.balancerSpreadDepthUsd({ ...balancerVenue(3000, h3m), protocol: "curve" as never }, f), null);
  assert.equal(R.balancerSpreadDepthUsd(balancerVenue(3000, h3m), 0), null);
});

test("depth: fresh cache, else Balancer's spread estimate, else 750k; Curve never borrows the estimate", () => {
  R.resetROverlay();
  const obs = rObs({ bal: 3045, balH: 31.1, cur: 3000, curH: 31.1 });
  const v = weth(marketViews(obs));
  const bal = v.venues.find((x) => x.protocol === "balancer")!;
  const cur = v.venues.find((x) => x.protocol === "curve")!;
  assert.deepEqual(R.rDepthUsd(obs, v, bal, 100).source, "spread");
  assert.deepEqual(R.rDepthUsd(obs, v, cur, 100), { usd: 750_000, source: "fallback" });
  R.seedDepthCache("balancer", "WETH", 1_234_567, 90);
  R.seedDepthCache("curve", "WETH", 2_345_678, 90);
  assert.deepEqual(R.rDepthUsd(obs, v, bal, 102), { usd: 1_234_567, source: "cache" }, "12 blocks old: fresh");
  assert.deepEqual(R.rDepthUsd(obs, v, cur, 102), { usd: 2_345_678, source: "cache" });
  assert.equal(R.rDepthUsd(obs, v, bal, 103).source, "spread", "13 blocks old: stale");
  assert.equal(R.rDepthUsd(obs, v, cur, 103).source, "fallback");
  assert.equal(R.rDepthUsd(obs, v, bal, 80).source, "spread", "a reading from the future is not used");
  // Uniswap keeps C1's L-ratio proxy.
  const uni = v.venues.find((x) => x.protocol === "uniswap")!;
  assert.deepEqual(R.rDepthUsd(obs, v, uni, 100), { usd: 3_000_000, source: "uniswap" });
});

test("depth: a cached reading is scaled by the Uniswap L ratio and never beats a smaller Balancer estimate", () => {
  const f = 0.003;
  const hFor = (mid: number, depth: number) => (f / (1 - f) + (0.1 * mid) / depth) * 1e4;
  // 60% pull: Balancer's own spread says 1.2M this block; a 3-block-old cache says 3M.
  R.resetROverlay();
  const pulled = rObs({ bal: 3045, balH: hFor(3045, 1.2e6) });
  const vp = weth(marketViews(pulled));
  const bal = (v: ReturnType<typeof weth>) => v.venues.find((x) => x.protocol === "balancer")!;
  R.seedDepthCache("balancer", "WETH", 3e6, 97);
  const d = R.rDepthUsd(pulled, vp, bal(vp), 100);
  assert.equal(d.source, "spread");
  assert.ok(Math.abs(d.usd - 1.2e6) < 1, `${d.usd}`);
  // Control: no pull -- the estimate (3M) does not undercut the cache, which is used.
  const calm = rObs({ bal: 3045, balH: hFor(3045, 3e6) });
  const vc = weth(marketViews(calm));
  assert.deepEqual(R.rDepthUsd(calm, vc, bal(vc), 100), { usd: 3e6, source: "cache" });
  // The tolerance is relative: insignificant roundoff keeps the cache, but even a tiny real
  // reduction beyond 1e-9 must win. This also catches accidentally ignoring the spread estimate.
  for (const [drop, source] of [[0.5e-9, "cache"], [2e-9, "spread"]] as const) {
    const depth = 3e6 * (1 - drop);
    const near = rObs({ bal: 3045, balH: hFor(3045, depth) });
    const vn = weth(marketViews(near));
    const read = R.rDepthUsd(near, vn, bal(vn), 100);
    assert.equal(read.source, source, `relative drop ${drop}`);
    assert.ok(Math.abs(read.usd - (source === "cache" ? 3e6 : depth)) < 1e-5);
  }
  // Curve has no estimate: its reading follows Uniswap's L down since the refresh, never up.
  const uniAt = (l: string) => rObs({ uniL: l, cur: 3000 });
  const cur = (o: AgentObservation) => weth(marketViews(o)).venues.find((x) => x.protocol === "curve")!;
  R.seedDepthCache("curve", "WETH", 3e6, 97, 1e18);
  const dropped = uniAt("400000000000000000");
  assert.ok(Math.abs(R.rDepthUsd(dropped, weth(marketViews(dropped)), cur(dropped), 100).usd - 1.2e6) < 1);
  const same = uniAt(UNI_L);
  assert.equal(R.rDepthUsd(same, weth(marketViews(same)), cur(same), 100).usd, 3e6);
  const risen = uniAt("2000000000000000000");
  assert.equal(R.rDepthUsd(risen, weth(marketViews(risen)), cur(risen), 100).usd, 3e6);
});

test("R's look at a Uniswap pair never changes C1's later Uniswap sizing (C1's depth peak is C1's)", async () => {
  // Block 10: fair under every venue, so R's guard refuses every pair -- but a Uniswap pair has e >= 100
  // bps, so R reads Uniswap's depth on the way, at an L 5x the next block's. C1's best pair there is
  // Balancer -> Curve, which does not read Uniswap. Block 11: L back to 1e18, C1 trades Uniswap -> Curve.
  const b1 = () => rObs({ block: 10, blocksRemaining: 300, fair: 2700, uni: 2950, uniL: "5000000000000000000", bal: 2900, cur: 3100 });
  const b2 = () => rObs({ block: 11, blocksRemaining: 299, fair: 2700, uni: 2900, bal: 2990, cur: 3100 });
  const v1 = weth(marketViews(b1()));
  const uniBuy = R.rVenuePrices("WETH", v1.venues.find((x) => x.protocol === "uniswap")!).buy;
  const curSell = R.rVenuePrices("WETH", v1.venues.find((x) => x.protocol === "curve")!).sell;
  assert.ok((curSell / uniBuy - 1) * 1e4 >= R.PARAMS.rMinEdgeBps, "R evaluates the Uniswap pair at block 10");
  R.resetROverlay();
  assert.equal(R.rPlan(b1(), v1, 25_000_000_000n, 8n * 10n ** 18n, 10), null, "and does not fire");
  const out: Record<string, Out[]> = { A: [], R: [] };
  R.resetROverlay();
  for (const [name, agent] of [["A", A], ["R", R]] as const)
    for (const make of [b1, b2]) out[name].push(await run(agent, make()));
  assert.ok(!out.R[0].tags.some((t) => t.startsWith("xvR:")) && !out.R[1].tags.some((t) => t.startsWith("xvR:")));
  assert.ok(out.A[1].tags.includes("xv:WETH"), out.A[1].tags.join(","));
  assert.ok(out.A[1].reasons.some((x) => x.includes("buy uniswap") && x.includes("on 1125 USDC")), out.A[1].reasons.join(" / "));
  assert.equal(show(out.R[1].action), show(out.A[1].action), "block 11: C1's bundle is opus-1a's");
  assert.equal(show(out.R[1].submitted), show(out.A[1].submitted));
});

test("depth refresh: records the Uniswap L it was issued under, so a later pull scales the reading", async () => {
  R.resetROverlay();
  const client = {
    readContract: async (args: { functionName: string; args?: unknown[] }) => {
      if (args.functionName === "getPoolTokens") {
        const leg = Object.values(MARKET_LEGS.balancer).find((l) => l.poolId === (args.args as Hex[])[0])!;
        const usdc = 3_000_000n * 10n ** 6n;
        const usdcFirst = leg.tokens[0].toLowerCase() === leg.stable.toLowerCase();
        return [leg.tokens, usdcFirst ? [usdc, 10n ** 21n] : [10n ** 21n, usdc], 1n];
      }
      if (args.functionName === "balances") return 3_000_000n * 10n ** 6n;
      return 3_000_000_000_000_000n;
    },
  };
  await R.startDepthRefresh(client, 100, { WETH: 1e18 });
  const later = rObs({ uniL: "400000000000000000", cur: 3000 });
  const v = weth(marketViews(later));
  const cur = v.venues.find((x) => x.protocol === "curve")!;
  const d = R.rDepthUsd(later, v, cur, 101);
  assert.equal(d.source, "cache");
  assert.ok(Math.abs(d.usd - 1.2e6) < 1, `${d.usd}`);
  // Control: under the same L the reading is the reserve itself.
  const same = rObs({ cur: 3000 });
  const vs = weth(marketViews(same));
  assert.deepEqual(R.rDepthUsd(same, vs, vs.venues.find((x) => x.protocol === "curve")!, 101), { usd: 3e6, source: "cache" });
});

test("depth refresh: reads the vault and the pool in the background, and decide() uses the result next block", async () => {
  R.resetROverlay();
  unhandled.length = 0;
  const calls: Array<{ address: string; functionName: string; args?: unknown[] }> = [];
  const pending: Array<() => void> = [];
  const balLeg = MARKET_LEGS.balancer.WETH;
  const client = {
    readContract: (args: { address: string; functionName: string; args?: unknown[] }) => {
      calls.push(args);
      return new Promise((resolve) => {
        pending.push(() => {
          if (args.functionName === "getPoolTokens") {
            const legs = Object.values(MARKET_LEGS.balancer).find((l) => l.poolId === (args.args as Hex[])[0])!;
            const usdcFirst = legs.tokens[0].toLowerCase() === legs.stable.toLowerCase();
            const usdc = 400_000n * 10n ** 6n;
            resolve([legs.tokens, usdcFirst ? [usdc, 10n ** 20n] : [10n ** 20n, usdc], 1n]);
          } else if (args.functionName === "balances") resolve(5_000_000n * 10n ** 6n);
          else resolve(3_000_000_000_000_000n); // 0.3%
        });
      });
    },
  };
  const t0 = Date.now();
  const first = await run(R, rObs({ block: 100 }), client);
  assert.ok(Date.now() - t0 < 500, "decide did not wait for the reads");
  assert.ok(pending.length > 0, "and they were still outstanding when it returned");
  const firstPlan = rBundleOf(first);
  assert.ok(firstPlan && first.reasons.some((x) => x.includes("depth uniswap/spread")), first.reasons.join(" / "));
  // The reads went to the right contracts.
  const vault = calls.find((c) => c.functionName === "getPoolTokens" && (c.args as Hex[])[0] === balLeg.poolId);
  assert.ok(vault && vault.address.toLowerCase() === BALANCER.vault.toLowerCase());
  const curveRead = calls.find((c) => c.functionName === "balances" && c.address.toLowerCase() === MARKET_LEGS.curve.WETH.pool.toLowerCase());
  assert.ok(curveRead);
  assert.deepEqual(curveRead.args, [BigInt(MARKET_LEGS.curve.WETH.quoteIndex)]);
  // Not again next block (one in flight, and the refresh is every few blocks).
  const before = calls.length;
  await run(R, rObs({ block: 101 }), client);
  assert.equal(calls.length, before);
  for (const done of pending.splice(0)) done();
  await flush();
  // Balancer now reads 400k from the cache: the rich leg's guard cap binds far below $6k.
  const second = await run(R, rObs({ block: 102 }), client);
  assert.ok(second.reasons.some((x) => x.includes("depth uniswap/cache")), second.reasons.join(" / "));
  const n2 = decodeFunctionData({ abi: swapRouterAbi, data: rBundleOf(second)!.txs[0].data }).args[0].amountIn;
  const n1 = decodeFunctionData({ abi: swapRouterAbi, data: firstPlan.txs[0].data }).args[0].amountIn;
  assert.ok(n2 < n1, `${n2} should be under ${n1}`);
  assert.equal(unhandled.length, 0);
});

test("decide() never waits on a depth or receipt read that does not answer", async () => {
  R.resetROverlay();
  const t0 = Date.now();
  const winner = await Promise.race([
    run(R, rObs({ block: 100 }), hangingClient).then(() => "decide"),
    sleep(1_000).then(() => "timeout"),
  ]);
  assert.equal(winner, "decide");
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0}ms`);
  // Three blocks on, the receipt reads for that bundle start -- and hang too, without effect.
  const winner2 = await Promise.race([
    run(R, rObs({ block: 103, blocksRemaining: 297 }), hangingClient).then((o) => (rBundleOf(o) ? "decide" : "no-r")),
    sleep(1_000).then(() => "timeout"),
  ]);
  assert.equal(winner2, "decide");
});

test("depth refresh: failures are silent, back off, and never throw out of decide", async () => {
  R.resetROverlay();
  unhandled.length = 0;
  const rejecting = { readContract: () => Promise.reject(new Error("429 Too Many Requests")) };
  const out = await run(R, rObs({ block: 100 }), rejecting);
  assert.ok(rBundleOf(out), "R still trades on the spread estimate");
  await flush();
  const s = R.depthRefreshSchedule();
  assert.equal(s.failures, 1);
  assert.equal(s.nextBlock, 100 + 2 * R.PARAMS.depthRefreshBlocks, "backed off to 6 blocks");
  assert.equal(s.inFlightSince, null);
  const throwing = {
    readContract: () => {
      throw new Error("sync throw");
    },
  };
  R.resetROverlay();
  const out2 = await run(R, rObs({ block: 100 }), throwing);
  assert.ok(rBundleOf(out2));
  await flush();
  assert.equal(R.depthRefreshSchedule().failures, 1);
  assert.ok(!out2.reasons.some((x) => x.includes("rOverlay failed")), out2.reasons.join(" / "));
  assert.equal(unhandled.length, 0, show(unhandled.map(String)));
  // An epoch start drops the cache and the schedule (a backwards block would otherwise wait for the
  // old schedule's next block).
  R.seedDepthCache("balancer", "WETH", 1_000_000, 100);
  await run(R, rObs({ block: 20, blocksRemaining: 340 }));
  assert.equal(R.depthRefreshSchedule().nextBlock, Number.NEGATIVE_INFINITY);
});

// ---------------------------------------------------------------------------
// 8. the revision prompt
// ---------------------------------------------------------------------------

test("revision prompt: the shipped bytes' system prompt, the records and a reply fit the window prompt.md declares", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const improve = await import("../example/agents/runtime/improve.js");
  const llm = await import("../example/agents/runtime/llm.js");
  // docs/guide/llm-agents.md, "Limits on a revision call": the records are ~10k tokens today, and the
  // window holds the reply as well as the prompt. 4k is room for a "leave it alone" answer and the
  // model's reasoning. (A full rewrite does not fit; a reply cut at the window is not installed.)
  const RECORDS = 10_000;
  const REPLY = 4_000;
  const PROTOCOLS = ["uniswap", "balancer", "curve", "liquity", "aave", "gmx", "lst"] as never[];
  const need = (id: string) => {
    const dir = fileURLToPath(new URL(`../example/agents/${id}`, import.meta.url));
    const agent = improve.loadImproveAgent(dir);
    const system = improve.buildRevisionSystem(agent, readFileSync(`${dir}/agent.ts`, "utf8"), PROTOCOLS);
    return {
      tokens: llm.estimatePromptTokens({ system, messages: [] }) + RECORDS + REPLY,
      window: agent.contextTokens ?? llm.DEFAULT_OLLAMA_CONTEXT_TOKENS,
    };
  };
  const r = need("opus-1r");
  assert.ok(r.tokens <= r.window, `opus-1r needs ~${r.tokens} tokens of a ${r.window}-token window`);
  // Controls: opus-1a's source fits Ollama's default window; opus-1r's does not, which is why its
  // prompt.md declares one (Ollama drops what does not fit without an error).
  const a = need("opus-1a");
  assert.ok(a.tokens <= llm.DEFAULT_OLLAMA_CONTEXT_TOKENS, `opus-1a: ${a.tokens}`);
  assert.ok(r.tokens > llm.DEFAULT_OLLAMA_CONTEXT_TOKENS, `opus-1r: ${r.tokens}`);
});
