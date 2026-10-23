// Unit tests for opus-1-pb, placebo arm B' of opus-1. The strategy is opus-1's and is covered by
// test/opus-1.test.ts; what is pinned here is the one difference:
//
//   1. placeboScale multiplies every sized amount by exactly 999/1000 with bigint rounding down,
//      leaves every other field alone, and leaves the close-outs (including the launch exit's
//      rawBundle) unscaled; placeboScaleSwapBundle rebuilds the M6 launch entry with its approve,
//      amountIn and minOut scaled and every other calldata field unchanged (the coverage table in
//      the agent's header);
//   2. decide(), fed the same observation as opus-1, emits the same actions -- same types, same
//      tokens, same venues, same bids and slippage -- with only the amounts scaled. The expected
//      amounts are computed here from opus-1's output or by python3, not by calling the scaler
//      under test.
//
// Same env pattern as test/opus-1.test.ts: the local-deploy overlay has to be set before the
// modules that read it load, hence the dynamic imports.
process.env.ERIS_LOCAL_DEPLOY = "1";

import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, type Hex } from "viem";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { AgentContext } from "@eris/sdk/agent.js";

const { validateAction } = await import("@eris/sdk/action.js");
const { erc20Abi, swapRouterAbi } = await import("@eris/sdk/abis.js");
const { TOKENS, UNISWAP } = await import("@eris/sdk/constants.js");
const pb = await import("../example/agents/opus-1-pb/agent.js");
const opus1 = await import("../example/agents/opus-1/agent.js");
const { placeboScale, placeboScaleSwapBundle, PLACEBO_SIZE_NUM, PLACEBO_SIZE_DEN } = pb;

type Action = Record<string, unknown>;

/** An action can carry a bigint; a failure message must not die trying to print one. */
function show(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)) ?? String(value);
}

// ---------------------------------------------------------------------------
// placeboScale
// ---------------------------------------------------------------------------

test("placeboScale: the factor is 999/1000", () => {
  assert.equal(PLACEBO_SIZE_NUM, 999n);
  assert.equal(PLACEBO_SIZE_DEN, 1000n);
});

test("placeboScale: amounts are scaled exactly, in bigint, rounding down", () => {
  // Expected values computed independently (python3: v * 999 // 1000). The 21-digit case is past
  // 2^53, where a Number-based multiply would already be wrong in the last digits.
  const cases: Array<[string, string]> = [
    ["1000", "999"],
    ["1999", "1997"], // 1997.001 -> 1997
    ["999", "998"], // 998.001 -> 998
    ["1", "0"], // rounding down, not to nearest
    ["25000000000", "24975000000"],
    ["8000000000000000000", "7992000000000000000"],
    ["123456789012345678901", "123333332223333333222"],
  ];
  for (const [input, expected] of cases) {
    const out = placeboScale({ type: "swap", tokenIn: "USDC", amountIn: input });
    assert.equal(out.amountIn, expected, `${input} -> ${String(out.amountIn)}`);
  }
});

test("placeboScale: every swap-shaped action scales amountIn and nothing else", () => {
  for (const type of ["swap", "curveSwap", "balancerSwap", "liquitySwapEusd"]) {
    const input: Action = {
      type,
      tokenIn: "USDC",
      base: "WBTC",
      amountIn: "5000000000",
      slippageBps: 60,
      maxPriorityFeePerGasWei: "120000001",
    };
    const before = structuredClone(input);
    const out = placeboScale(input);
    assert.deepEqual(out, { ...before, amountIn: "4995000000" }, type);
    assert.deepEqual(input, before, `${type}: the input must not be mutated`);
  }
});

test("placeboScale: a bundle scales every leg and keeps its own bid", () => {
  const input: Action = {
    type: "bundle",
    actions: [
      { type: "swap", tokenIn: "USDC", amountIn: "5000000000", slippageBps: 40 },
      { type: "curveSwap", tokenIn: "WETH", amountIn: "1661681292788301429", slippageBps: 40 },
    ],
    maxPriorityFeePerGasWei: "1200000001",
  };
  const before = structuredClone(input);
  const out = placeboScale(input);
  assert.deepEqual(out, {
    type: "bundle",
    actions: [
      { type: "swap", tokenIn: "USDC", amountIn: "4995000000", slippageBps: 40 },
      // 1661681292788301429 * 999 // 1000 = 1660019611495513127 (python3)
      { type: "curveSwap", tokenIn: "WETH", amountIn: "1660019611495513127", slippageBps: 40 },
    ],
    maxPriorityFeePerGasWei: "1200000001",
  });
  assert.deepEqual(input, before, "the input bundle must not be mutated");
});

test("placeboScale: a stable buy is scaled, the exit of the whole holding is not", () => {
  const buy = { type: "stableSwap", stable: "DAI", tokenIn: "USDC", amountIn: "3000000000", slippageBps: 100 };
  assert.deepEqual(placeboScale(buy), { ...buy, amountIn: "2997000000" });
  const sell = {
    type: "stableSwap",
    stable: "DAI",
    tokenIn: "DAI",
    amountIn: "3000000000000000000000",
    slippageBps: 100,
  };
  assert.deepEqual(placeboScale(sell), sell);
});

test("placeboScale: the wrap's value is scaled, its target and calldata are not", () => {
  const wrap = {
    type: "rawTx",
    tx: { to: "0x00000000000000000000000000000000000000ee", data: "0xd0e30db0", value: "1000000000000000000" },
    maxPriorityFeePerGasWei: "100000000",
  };
  assert.deepEqual(placeboScale(wrap), {
    ...wrap,
    tx: { ...wrap.tx, value: "999000000000000000" },
  });
  // A rawTx without a value does not grow one.
  const noValue = { type: "rawTx", tx: { to: "0x00000000000000000000000000000000000000ee", data: "0x" } };
  const out = placeboScale(noValue);
  assert.deepEqual(out, noValue);
  assert.equal("value" in (out.tx as Action), false);
});

test("placeboScale: close-outs, encoded calldata and count fields are left alone", () => {
  // A rawBundle reaching placeboScale is the launch exit (a close-out): the entry never comes here,
  // it is rebuilt from its arguments by placeboScaleSwapBundle.
  const untouched: Action[] = [
    { type: "liquityRedeem", amountEusdWei: "4000000000000000000000", maxIterations: 8, maxFeeBps: 150 },
    {
      type: "rawBundle",
      txs: [
        { to: "0x00000000000000000000000000000000000000cc", data: "0x095ea7b3" },
        { to: "0x00000000000000000000000000000000000000dd", data: "0x414bf389" },
      ],
      reason: "launch exit",
      maxPriorityFeePerGasWei: "100000000",
    },
    { type: "liquityLiquidate", maxTroves: 3, maxPriorityFeePerGasWei: "100000000" },
    { type: "noop" },
  ];
  for (const a of untouched) assert.deepEqual(placeboScale(a), structuredClone(a), show(a));
});

test("placeboScale: anything that is not a raw integer amount passes through instead of throwing", () => {
  // BigInt("1e18") throws; the choke point sits outside the module guards, so it must not.
  for (const amountIn of ["1e18", "-5", "12.5", "", " 100", 1000, undefined]) {
    const input: Action = { type: "swap", tokenIn: "USDC", amountIn };
    assert.deepEqual(placeboScale(input), { ...input }, show(amountIn));
  }
});

// ---------------------------------------------------------------------------
// placeboScaleSwapBundle: the M6 launch entry
// ---------------------------------------------------------------------------

const LAUNCH_POOL = "0x00000000000000000000000000000000000000aa";
const LAUNCH_CREATOR = "0x00000000000000000000000000000000000000bb";
const LAUNCH_TOKEN = "0x00000000000000000000000000000000000000cc";

type DecodedLaunchBundle = {
  txKeys: string[][];
  approveTo: string;
  spender: string;
  approveAmount: bigint;
  swapTo: string;
  params: Record<string, unknown>;
};

/** The two calldatas of an approve + exactInputSingle rawBundle, decoded with the real ABIs. */
function decodeLaunchBundle(action: Action): DecodedLaunchBundle {
  assert.equal(action.type, "rawBundle", show(action));
  const txs = action.txs as Array<{ to: string; data: Hex }>;
  assert.equal(txs.length, 2, show(action));
  const approve = decodeFunctionData({ abi: erc20Abi, data: txs[0].data });
  assert.equal(approve.functionName, "approve", show(action));
  const swap = decodeFunctionData({ abi: swapRouterAbi, data: txs[1].data });
  assert.equal(swap.functionName, "exactInputSingle", show(action));
  const [spender, approveAmount] = approve.args as readonly [string, bigint];
  const [params] = swap.args as readonly [Record<string, unknown>];
  return {
    txKeys: txs.map((tx) => Object.keys(tx).sort()),
    approveTo: txs[0].to,
    spender,
    approveAmount,
    swapTo: txs[1].to,
    params: { ...params },
  };
}

/**
 * Asserts `base` carries the expected base sizes, and `placebo` is `base` with the approve amount
 * and amountIn equal to `want.amountIn`, the amountOutMinimum equal to `want.minOut`, and every
 * other field -- top-level keys, reason, bid, tx targets, spender, tokens, fee tier, recipient,
 * deadline, price limit -- identical.
 */
function assertSameLaunchBundle(
  base: Action,
  placebo: Action,
  want: { baseAmountIn: bigint; baseMinOut: bigint; amountIn: bigint; minOut: bigint },
): void {
  const b = decodeLaunchBundle(base);
  const p = decodeLaunchBundle(placebo);
  assert.deepEqual(Object.keys(placebo).sort(), Object.keys(base).sort(), "action keys");
  for (const key of Object.keys(base))
    if (key !== "txs") assert.deepEqual(placebo[key], base[key], key);
  assert.deepEqual(p.txKeys, b.txKeys, "tx keys");
  assert.equal(p.approveTo, b.approveTo, "approve target");
  assert.equal(p.spender, b.spender, "approve spender");
  assert.equal(p.swapTo, b.swapTo, "swap target");
  // The base is what was decided, so the comparison is not vacuous.
  assert.equal(b.approveAmount, want.baseAmountIn, "base approve");
  assert.equal(b.params.amountIn, want.baseAmountIn, "base amountIn");
  assert.equal(b.params.amountOutMinimum, want.baseMinOut, "base minOut");
  assert.equal(p.approveAmount, want.amountIn, "placebo approve");
  assert.equal(p.params.amountIn, want.amountIn, "placebo amountIn");
  assert.equal(p.params.amountOutMinimum, want.minOut, "placebo minOut");
  const rest = (d: DecodedLaunchBundle) => ({ ...d.params, amountIn: 0n, amountOutMinimum: 0n });
  assert.deepEqual(rest(p), rest(b), "every other exactInputSingle field");
}

test("placeboScaleSwapBundle: the entry is rebuilt with approve, amountIn and minOut scaled", async () => {
  const { swapBundle } = await import("../example/agents/lib/launchSwap.js");
  const args = {
    tokenIn: TOKENS.USDC.address,
    tokenOut: LAUNCH_TOKEN as `0x${string}`,
    fee: 10_000,
    recipient: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    amountIn: 1_999_999_999n,
    minOut: 7_777_777_777_777_777_777n,
    reason: "launch entry",
    maxPriorityFeePerGasWei: "100000000",
  };
  const before = structuredClone(args);
  const out = placeboScaleSwapBundle(args);
  // python3: a = 1999999999 * 999 // 1000 = 1997999999 (1997999999.001, rounded down);
  // minOut * a // 1999999999 = 7769999999996111110, the realised ratio -- a hair under
  // minOut * 999 // 1000 = 7769999999999999999, because a itself was rounded down.
  assertSameLaunchBundle(swapBundle(args), out, {
    baseAmountIn: 1_999_999_999n,
    baseMinOut: 7_777_777_777_777_777_777n,
    amountIn: 1_997_999_999n,
    minOut: 7_769_999_999_996_111_110n,
  });
  const decoded = decodeLaunchBundle(out);
  assert.equal(decoded.approveTo.toLowerCase(), TOKENS.USDC.address.toLowerCase());
  assert.equal(decoded.spender.toLowerCase(), UNISWAP.swapRouter.toLowerCase());
  assert.deepEqual(args, before, "the arguments must not be mutated");
  // A zero size does not divide by zero: the choke point sits outside the module guards.
  const zero = placeboScaleSwapBundle({ ...args, amountIn: 0n });
  assert.equal(decodeLaunchBundle(zero).params.amountOutMinimum, args.minOut);
});

// ---------------------------------------------------------------------------
// decide(): opus-1-pb against opus-1 on the same observations
// ---------------------------------------------------------------------------

const GWEI = 1_000_000_000n;
// Same fixture constants as test/opus-1.test.ts.
const UNI_L = "1000000000000000000";
const AMM_USDC = "3000000000000";

/** test/opus-1.test.ts's obsFor, plus an ETH balance (for the wrap) and optional extras. */
function obsFor(opts: {
  uniMid?: number;
  curveMid?: number;
  usdc?: string;
  weth?: string;
  eth?: string;
  blocksRemaining?: number;
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
      ethWei: opts.eth ?? "1000000000000000000",
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
      defaultPriorityFeePerGasWei: (GWEI / 10n).toString(),
      maxPriorityFeePerGasWei: (5n * GWEI).toString(),
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

function fakeCtx(publicClient: unknown = {}): AgentContext & { submitted: unknown[]; logs: unknown[] } {
  const submitted: unknown[] = [];
  const logs: unknown[] = [];
  return {
    agentId: "opus-1-pb",
    address: "0x0000000000000000000000000000000000000001",
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

type Run = { emitted: Action[]; ctx: ReturnType<typeof fakeCtx> };

/**
 * One observation through both agents, each on its own deep copy, so neither can see what the
 * other did to it. Module state (anchors, depth peaks, stable trails, shot counters) lives per
 * module file and advances identically as long as every step goes through both.
 */
async function both(
  obs: AgentObservation,
  clients: { base?: unknown; placebo?: unknown } = {},
): Promise<{ base: Run; placebo: Run }> {
  const baseCtx = fakeCtx(clients.base);
  const pbCtx = fakeCtx(clients.placebo);
  const baseAction = await opus1.decide(structuredClone(obs), baseCtx);
  const pbAction = await pb.decide(structuredClone(obs), pbCtx);
  const emitted = (a: unknown, ctx: ReturnType<typeof fakeCtx>) =>
    [a, ...ctx.submitted].filter(Boolean) as Action[];
  return {
    base: { emitted: emitted(baseAction, baseCtx), ctx: baseCtx },
    placebo: { emitted: emitted(pbAction, pbCtx), ctx: pbCtx },
  };
}

/**
 * Asserts `got` is `orig` with every amount (amountIn anywhere, value inside a tx) equal to
 * floor(orig * 999 / 1000) and every other field identical. Returns how many amounts it checked,
 * so a caller can refuse a vacuous pass.
 */
function assertScaledCopy(orig: unknown, got: unknown, path = "$", parentKey = ""): number {
  if (Array.isArray(orig)) {
    assert.ok(Array.isArray(got), `${path}: expected an array, got ${show(got)}`);
    assert.equal(got.length, orig.length, `${path}: length`);
    return orig.reduce((n: number, v, i) => n + assertScaledCopy(v, got[i], `${path}[${i}]`, parentKey), 0);
  }
  if (orig !== null && typeof orig === "object") {
    assert.ok(got !== null && typeof got === "object" && !Array.isArray(got), `${path}: expected an object`);
    const o = orig as Action;
    const g = got as Action;
    assert.deepEqual(Object.keys(g).sort(), Object.keys(o).sort(), `${path}: keys`);
    let n = 0;
    for (const key of Object.keys(o)) {
      const isAmount = key === "amountIn" || (key === "value" && parentKey === "tx");
      if (isAmount) {
        assert.equal(typeof o[key], "string", `${path}.${key}: amount must be a string`);
        const want = (BigInt(o[key] as string) * 999n) / 1000n;
        assert.ok(want < BigInt(o[key] as string), `${path}.${key}: a zero amount proves nothing`);
        assert.equal(g[key], want.toString(), `${path}.${key}: ${String(o[key])} -> ${String(g[key])}`);
        n += 1;
      } else {
        n += assertScaledCopy(o[key], g[key], `${path}.${key}`, key);
      }
    }
    return n;
  }
  assert.equal(got, orig, `${path}`);
  return 0;
}

function assertSameActionsScaled(base: Run, placebo: Run, minAmounts: number): void {
  assert.equal(
    placebo.emitted.length,
    base.emitted.length,
    `action count: ${show(base.emitted)} vs ${show(placebo.emitted)}`,
  );
  let amounts = 0;
  for (let i = 0; i < base.emitted.length; i++)
    amounts += assertScaledCopy(base.emitted[i], placebo.emitted[i], `$[${i}]`);
  assert.ok(amounts >= minAmounts, `only ${amounts} amounts compared, expected at least ${minAmounts}`);
}

const VALIDATOR_BALANCES = {
  ethWei: 10n ** 18n,
  wethWei: 8n * 10n ** 18n,
  usdcUnits: 25_000_000_000n,
  bases: { WETH: 8n * 10n ** 18n, WBTC: 40_000_000n },
  stables: {},
} as unknown as Parameters<typeof validateAction>[2];

function assertValid(actions: Action[], obs: AgentObservation): void {
  for (const a of actions) {
    const result = validateAction(a as never, obs, VALIDATOR_BALANCES);
    assert.equal(result.ok, true, `rejected: ${show(a)} -> ${result.ok ? "" : result.reason}`);
  }
}

test("decide: a calm market is a noop for both arms", async () => {
  const { base, placebo } = await both(obsFor({ uniMid: 3000, curveMid: 3000 }));
  assert.deepEqual(base.emitted, []);
  assert.deepEqual(placebo.emitted, []);
  assert.equal(placebo.ctx.logs.length, 1);
});

test("decide: the cross-venue bundle is opus-1's, with both legs scaled", async () => {
  const { base, placebo } = await both(obsFor({ uniMid: 3000, curveMid: 3060, rivalFeeWei: GWEI }));
  assert.ok(base.emitted.length > 0, "the fixture must make opus-1 trade, or the comparison is empty");
  assert.equal(placebo.emitted[0].type, "bundle");
  assertSameActionsScaled(base, placebo, 2);
  // The log carries what was actually sent, not the pre-scale action.
  const logged = (placebo.ctx.logs[0] as { action?: unknown }).action;
  assert.deepEqual(logged, placebo.emitted[0]);
});

test("decide: an inventory dislocation emits opus-1's actions scaled, and they still validate", async () => {
  const obs = obsFor({ uniMid: 2970, curveMid: 3000, rivalFeeWei: GWEI });
  const { base, placebo } = await both(obs);
  assert.ok(base.emitted.length > 0, "a 100 bps dislocation should produce something");
  assertSameActionsScaled(base, placebo, 1);
  assertValid(placebo.emitted, obs);
});

test("decide: the WBTC market keeps its base and decimals, amounts scaled", async () => {
  const obs = obsFor({ uniMid: 3000, curveMid: 3000 });
  const o = obs as unknown as Record<string, Record<string, unknown>>;
  o.fairPricesUsd.WBTC = 60_000;
  o.baseDecimals.WBTC = 8;
  o.baseBalances.WBTC = "40000000";
  (obs.protocols.uniswap as unknown as { markets: Record<string, unknown> }).markets = {
    "WBTC/USDC": {
      pair: "WBTC/USDC",
      fee: 3000,
      priceUsdcPerWeth: 59_400,
      tick: 0,
      tickSpacing: 60,
      liquidity: UNI_L,
    },
  };
  (obs.protocols.curve as unknown as { markets: Record<string, unknown> }).markets = {
    "WBTC/USDC": { priceUsdcPerWeth: 60_000, reserves: { weth: "5000000000", usdc: AMM_USDC } },
  };
  const { base, placebo } = await both(obs);
  assert.ok(placebo.emitted.some((a) => show(a).includes("WBTC")), show(placebo.emitted));
  assertSameActionsScaled(base, placebo, 1);
  assertValid(placebo.emitted, obs);
});

test("decide: the windfall-ETH wrap sends 0.999 of opus-1's value to the same deposit", async () => {
  const { base, placebo } = await both(obsFor({ uniMid: 3000, curveMid: 3000, eth: "2000000000000000000" }));
  assert.equal(base.emitted.length, 1, show(base.emitted));
  assert.equal(base.emitted[0].type, "rawTx");
  assertSameActionsScaled(base, placebo, 1);
});

function withLiquity(obs: AgentObservation, eusdBalanceWei: string): AgentObservation {
  (obs.protocols as unknown as Record<string, unknown>).liquity = {
    priceUsd: 3000,
    tcr: 2,
    recoveryMode: false,
    mcr: 1.1,
    ccr: 1.5,
    troveCount: 10,
    totalCollWei: "0",
    totalDebtEusdWei: "0",
    borrowingRateBps: 50,
    redemptionRateBps: 50,
    baseRateBps: 0,
    minNetDebtEusdWei: "1800000000000000000000",
    gasCompensationEusdWei: "200000000000000000000",
    eusdBalanceWei,
    marketPriceUsdc: 0.986,
    marketQuoted: true,
    discountBps: 140,
    redemptionEdgeBps: 90,
  };
  return obs;
}

test("decide: the eUSD buy is scaled, the redemption of the whole balance is not", async () => {
  // Step 1: no eUSD held and a 90 bps redemption edge -> buy eUSD with USDC (a size: scaled).
  const buy = await both(withLiquity(obsFor({ uniMid: 3000, curveMid: 3000 }), "0"));
  assert.ok(buy.base.emitted.some((a) => a.type === "liquitySwapEusd"), show(buy.base.emitted));
  assertSameActionsScaled(buy.base, buy.placebo, 1);

  // Step 2: eUSD held -> redeem all of it (a close-out: identical to opus-1, not 0.999 of it).
  const held = "4000000000000000000000";
  const redeem = await both(withLiquity(obsFor({ uniMid: 3000, curveMid: 3000 }), held));
  const r = redeem.placebo.emitted.find((a) => a.type === "liquityRedeem");
  assert.ok(r, show(redeem.placebo.emitted));
  assert.equal(r.amountEusdWei, held);
  assert.deepEqual(redeem.placebo.emitted, redeem.base.emitted);
});

function withDai(obs: AgentObservation, priceUsdc: number, balance: string): AgentObservation {
  (obs.balances.stables as unknown as Record<string, unknown>).DAI = {
    token: "0x00000000000000000000000000000000000000da",
    decimals: 18,
    balance,
    priceUsdc,
    marketQuoted: true,
  };
  return obs;
}

test("decide: a recovering stable is bought 0.999x and the whole holding is sold back", async () => {
  // Three observations of a narrowing discount make the buy; the fourth, back near par, the exit.
  // Every step goes through both arms so their per-module trails stay in lockstep.
  let step = await both(withDai(obsFor({}), 0.98, "0"));
  assert.deepEqual(step.placebo.emitted, step.base.emitted);
  step = await both(withDai(obsFor({}), 0.985, "0"));
  assert.deepEqual(step.placebo.emitted, step.base.emitted);
  step = await both(withDai(obsFor({}), 0.992, "0"));
  const buy = step.base.emitted.find((a) => a.type === "stableSwap");
  assert.ok(buy && buy.tokenIn === "USDC", show(step.base.emitted));
  assertSameActionsScaled(step.base, step.placebo, 1);

  const held = "3000000000000000000000";
  step = await both(withDai(obsFor({}), 0.9995, held));
  const sell = step.placebo.emitted.find((a) => a.type === "stableSwap");
  assert.ok(sell && sell.tokenIn === "DAI", show(step.placebo.emitted));
  assert.equal(sell.amountIn, held);
  assert.deepEqual(step.placebo.emitted, step.base.emitted);
});

/** The registry entries of one launch pool: USDC is token0, the launch token token1. */
function withLaunch(obs: AgentObservation, block: number): AgentObservation {
  (obs as unknown as { blockNumber: string }).blockNumber = String(block);
  (obs as { registry?: unknown }).registry = {
    address: "0x0000000000000000000000000000000000000003",
    entries: [
      {
        market: LAUNCH_POOL,
        kind: "uniswapV3Pool",
        creator: LAUNCH_CREATOR,
        mine: false,
        token0: TOKENS.USDC.address,
        token1: LAUNCH_TOKEN,
        codehashAtRegistration: "0x",
        verified: true,
        registeredAtBlock: "99",
      },
      {
        market: LAUNCH_TOKEN,
        kind: "erc20",
        creator: LAUNCH_CREATOR,
        mine: false,
        codehashAtRegistration: `0x${"e".repeat(64)}`,
        codehashNow: `0x${"e".repeat(64)}`,
        verified: false,
        registeredAtBlock: "99",
      },
    ],
    allowances: [],
    strandedUnknown: [],
    dropped: 0,
  };
  return obs;
}

type LaunchChain = { held: bigint; quote: bigint; quoted: bigint[] };

/**
 * A node that answers for that one pool: about 0.1 USDC per token, 100,000 USDC in the pool, 6,000
 * USDC net bought over any window asked about, a fixed quote, and the wallet holding `held` of the
 * token. Every amount the agent asks a quote for is recorded.
 */
function launchClient(chain: LaunchChain): unknown {
  return {
    readContract: async (req: { address: string; functionName: string }) => {
      switch (req.functionName) {
        case "slot0":
          return [2n ** 96n * 3_162_278n, 0, 0, 0, 0, 0, true];
        case "liquidity":
          return 10n ** 24n;
        case "fee":
          return 10_000;
        case "balanceOf":
          return req.address.toLowerCase() === LAUNCH_TOKEN ? chain.held : 100_000_000_000n;
      }
      throw new Error(`unexpected read ${req.functionName}`);
    },
    getLogs: async () => [{ args: { amount0: 6_000_000_000n, amount1: -(60_000n * 10n ** 18n) } }],
    simulateContract: async (req: { functionName: string; args: [{ amountIn: bigint }] }) => {
      assert.equal(req.functionName, "quoteExactInputSingle");
      chain.quoted.push(req.args[0].amountIn);
      return { result: [chain.quote] };
    },
  };
}

test("decide: the launch entry is opus-1's with approve, amountIn and minOut scaled; the exit sells everything", async () => {
  const quote = 14_987_654_321_098_765_432_101n;
  const baseChain: LaunchChain = { held: 0n, quote, quoted: [] };
  const pbChain: LaunchChain = { held: 0n, quote, quoted: [] };
  const clients = { base: launchClient(baseChain), placebo: launchClient(pbChain) };
  const tags = (r: Run) => (r.ctx.logs.at(-1) as { state?: { tags?: string[] } }).state?.tags;

  // Block 100: the pool is first seen, too new to enter, and the market is calm.
  let step = await both(withLaunch(obsFor({}), 100), clients);
  assert.deepEqual(step.base.emitted, []);
  assert.deepEqual(step.placebo.emitted, []);

  // Block 102: confirmed net buying. opus-1 enters with 1,500 USDC (launchNotionalUsd; 10% of the
  // reserve would be 10,000).
  const entryObs = withLaunch(obsFor({}), 102);
  step = await both(entryObs, clients);
  assert.deepEqual(tags(step.base), ["launch:enter"], show(step.base.emitted));
  assert.deepEqual(tags(step.placebo), ["launch:enter"], show(step.placebo.emitted));
  assert.equal(step.base.emitted.length, 1, show(step.base.emitted));
  assert.equal(step.placebo.emitted.length, 1, show(step.placebo.emitted));
  // Both arms quoted the size opus-1 decided on: the placebo scales after the decision.
  assert.deepEqual(baseChain.quoted, [1_500_000_000n]);
  assert.deepEqual(pbChain.quoted, [1_500_000_000n]);
  // python3: minOut = quote * 9600 // 10000 = 14388148148254814814816;
  // amountIn' = 1500000000 * 999 // 1000 = 1498500000;
  // minOut' = 14388148148254814814816 * 1498500000 // 1500000000 = 14373760000106560000001.
  assertSameLaunchBundle(step.base.emitted[0], step.placebo.emitted[0], {
    baseAmountIn: 1_500_000_000n,
    baseMinOut: 14_388_148_148_254_814_814_816n,
    amountIn: 1_498_500_000n,
    minOut: 14_373_760_000_106_560_000_001n,
  });
  assertValid(step.placebo.emitted, entryObs);
  // The log carries what was actually sent.
  assert.deepEqual((step.placebo.ctx.logs.at(-1) as { action?: unknown }).action, step.placebo.emitted[0]);

  // Block 103, 15 blocks left: each arm holds what its own entry bought -- the placebo 0.999 of
  // it -- and the bell forces the exit. Both sell their whole holding at minOut 1: a close-out, so
  // the placebo's exit is not scaled again.
  baseChain.held = 14_400_000_000_000_000_000_000n;
  pbChain.held = 14_385_600_000_000_000_000_000n; // python3: 14400000000000000000000 * 999 // 1000
  step = await both(withLaunch(obsFor({ blocksRemaining: 15 }), 103), clients);
  assert.deepEqual(tags(step.base), ["launch:exit"], show(step.base.emitted));
  assert.deepEqual(tags(step.placebo), ["launch:exit"], show(step.placebo.emitted));
  assertSameLaunchBundle(step.base.emitted[0], step.placebo.emitted[0], {
    baseAmountIn: baseChain.held,
    baseMinOut: 1n,
    amountIn: pbChain.held,
    minOut: 1n,
  });
  // A forced exit needs no quote, so neither arm asked for another one.
  assert.deepEqual(pbChain.quoted, [1_500_000_000n]);
});
