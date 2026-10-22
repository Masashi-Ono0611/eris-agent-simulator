// opus-1g = opus-1a plus M-OU, a GMX position on the fair price's pull back to its fixed anchor.
// These pin the module's decision arithmetic: the anchor it picks, the hysteresis band, the
// pending-order table that keeps an in-flight order from being sent twice, the two-step reversal,
// the end-of-epoch stop, a run without GMX, and that inside the band opus-1g is exactly opus-1a.
process.env.ERIS_LOCAL_DEPLOY = "1";

import test from "node:test";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { AgentContext } from "@eris/sdk/agent.js";

const { parseAction, validateAction } = await import("@eris/sdk/action.js");
const g = await import("../example/agents/opus-1g/agent.js");
const a = await import("../example/agents/opus-1a/agent.js");

const GWEI = 1_000_000_000n;
const E30 = 10n ** 30n;
const UNI_L = "1000000000000000000";
const AMM_USDC = "3000000000000";

type Pos = {
  isLong: boolean;
  sizeUsd: string;
  sizeInTokens: string;
  collateral: string;
  collateralAmount: string;
  entryPriceUsd: number;
  pnlUsd: number;
};

function pos(signedUsd: number, collateralUsdc = 10_000): Pos {
  return {
    isLong: signedUsd > 0,
    sizeUsd: (BigInt(Math.abs(signedUsd)) * E30).toString(),
    sizeInTokens: "1",
    collateral: "USDC",
    collateralAmount: (BigInt(collateralUsdc) * 1_000_000n).toString(),
    entryPriceUsd: 3000,
    pnlUsd: 0,
  };
}

function obsFor(opts: {
  block?: number;
  fairWeth?: number;
  fairWbtc?: number;
  uniMid?: number;
  curveMid?: number;
  usdc?: string;
  ethWei?: string;
  blocksRemaining?: number;
  gmx?: boolean;
  wbtcMarket?: boolean;
  wethPos?: Pos;
  wbtcPos?: Pos;
} = {}): AgentObservation {
  const fairWeth = opts.fairWeth ?? 3000;
  const fairWbtc = opts.fairWbtc ?? 60_000;
  const block = opts.block ?? 100;
  const gmxOn = opts.gmx ?? true;
  const protocols: Record<string, unknown> = {
    uniswap: {
      pool: {
        pair: "WETH/USDC",
        fee: 3000,
        priceUsdcPerWeth: opts.uniMid ?? fairWeth,
        tick: 0,
        tickSpacing: 60,
        liquidity: UNI_L,
      },
      positions: [],
    },
    curve: {
      priceUsdcPerWeth: opts.curveMid ?? fairWeth,
      reserves: { weth: "1000000000000000000000", usdc: AMM_USDC },
    },
  };
  if (gmxOn) {
    protocols.gmx = {
      marketPriceUsd: fairWeth,
      ...(opts.wethPos ? { position: opts.wethPos } : {}),
      ...(opts.wbtcMarket === false
        ? {}
        : {
            markets: {
              "WBTC/USDC": {
                marketPriceUsd: fairWbtc,
                ...(opts.wbtcPos ? { position: opts.wbtcPos } : {}),
              },
            },
          }),
    };
  }
  return {
    kind: "observation",
    runId: "t",
    round: block,
    blockNumber: String(block),
    agentAddress: "0x0000000000000000000000000000000000000001",
    fairPriceUsdcPerWeth: fairWeth,
    fairPricesUsd: { WETH: fairWeth, WBTC: fairWbtc },
    oraclePrices: { wethUsd: fairWeth, usdcUsd: 1 },
    baseDecimals: { WETH: 18, WBTC: 8 },
    baseBalances: { WETH: "8000000000000000000", WBTC: "40000000" },
    enabledProtocols: gmxOn ? ["uniswap", "curve", "gmx"] : ["uniswap", "curve"],
    blocksRemaining: opts.blocksRemaining ?? 300,
    balances: {
      ethWei: opts.ethWei ?? "1000000000000000000",
      wethWei: "8000000000000000000",
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
    inventory: { valueUsdc: 75_000, weth: 8, usdc: 25_000, eth: 1 },
    history: [],
    limits: {
      defaultPriorityFeePerGasWei: (GWEI / 10n).toString(),
      maxPriorityFeePerGasWei: (5n * GWEI).toString(),
      defaultSlippageBps: 50,
    },
    protocols,
  } as unknown as AgentObservation;
}

function fakeCtx(): AgentContext & { submitted: unknown[]; logs: unknown[] } {
  const submitted: unknown[] = [];
  const logs: unknown[] = [];
  return {
    agentId: "opus-1g",
    address: "0x0000000000000000000000000000000000000001",
    publicClient: {} as AgentContext["publicClient"],
    config: {} as AgentContext["config"],
    latestObservation: () => null,
    onObservation: () => () => undefined,
    submit: (x: unknown) => submitted.push(x),
    log: (e: unknown) => logs.push(e),
    submitted,
    logs,
  } as unknown as AgentContext & { submitted: unknown[]; logs: unknown[] };
}

type Act = Record<string, unknown>;

/** Everything one decide() call sends: the return value first, then the submits. */
async function emitted(obs: AgentObservation, decide = g.decide): Promise<Act[]> {
  const ctx = fakeCtx();
  const action = await decide(obs, ctx);
  return [action, ...ctx.submitted].filter(Boolean) as Act[];
}

const gmxOnly = (xs: Act[]) =>
  xs.filter((x) => x.type === "gmxIncrease" || x.type === "gmxDecrease");

// Fair 2% under the anchor for WETH (g = +2.04%); WBTC stays at its anchor (g = 0).
const LOW = 3000 / 1.0204;

// ---------------------------------------------------------------------------
// anchor
// ---------------------------------------------------------------------------

test("anchor: the published opening fair when the first fair is within 2%, else the first fair", () => {
  g.resetOuStateForTest();
  assert.equal(g.resolveOuAnchor("WETH", 3_030), 3_000);
  assert.equal(g.resolveOuAnchor("WETH", 2_000), 3_000, "cached: later fairs never move it");
  assert.equal(g.resolveOuAnchor("WBTC", 63_000), 63_000, "5% off the published 60k");
  g.resetOuStateForTest();
  assert.equal(g.resolveOuAnchor("WETH", 3_059), 3_000, "just inside 2%");
  g.resetOuStateForTest();
  assert.equal(g.resolveOuAnchor("WETH", 3_061), 3_061);
  g.resetOuStateForTest();
  assert.equal(g.resolveOuAnchor("WBTC", 58_900), 60_000);
  assert.equal(g.resolveOuAnchor("DAI", 1), 1, "a base with no published fair takes the first fair");
});

// ---------------------------------------------------------------------------
// hysteresis
// ---------------------------------------------------------------------------

test("hysteresis: long above +0.8%, short below -0.8%, hold in between", () => {
  assert.equal(g.ouSignal(0.0081), 1);
  assert.equal(g.ouSignal(0.008), 0);
  assert.equal(g.ouSignal(0), 0);
  assert.equal(g.ouSignal(-0.008), 0);
  assert.equal(g.ouSignal(-0.0081), -1);
  assert.equal(g.ouSignal(Number.NaN), 0);
});

const base = {
  base: "WETH",
  anchor: 3000,
  pending: undefined,
  block: 100,
  blocksRemaining: 300,
  usdcFreeUnits: 25_000_000_000n,
  ethWei: 10n ** 18n,
  priorityFeeWei: "100000000",
};

test("hysteresis: a held position is kept anywhere inside the band, on either side of the anchor", () => {
  // Long held, fair now 0.5% *over* the anchor (g = -0.5%): the signal is hold, not close.
  const held = g.ouPlan({ ...base, fair: 3000 * 1.005, position: pos(40_000) as never });
  assert.equal(held.action, undefined, held.note);
  // Short held, fair 0.5% under (g = +0.5%): hold too.
  const heldShort = g.ouPlan({ ...base, fair: 3000 / 1.005, position: pos(-40_000) as never });
  assert.equal(heldShort.action, undefined, heldShort.note);
  // Flat inside the band: nothing opens.
  const flat = g.ouPlan({ ...base, fair: 3000 / 1.007, position: undefined });
  assert.equal(flat.action, undefined, flat.note);
  // Flat just outside: it opens, on the side of the pull.
  const open = g.ouPlan({ ...base, fair: 3000 / 1.009, position: undefined });
  assert.equal(open.action?.type, "gmxIncrease");
  assert.equal(open.action?.isLong, true);
  const openShort = g.ouPlan({ ...base, fair: 3000 * 1.009, position: undefined });
  assert.equal(openShort.action?.type, "gmxIncrease");
  assert.equal(openShort.action?.isLong, false);
});

test("sizing: $40k at 4x on USDC, scaled down to what leaves the $5k reserve, skipped below $10k", () => {
  const full = g.ouPlan({ ...base, fair: LOW, position: undefined });
  assert.equal(full.action?.sizeDeltaUsd, (40_000n * E30).toString());
  assert.equal(full.action?.collateralAmount, "10000000000");
  assert.equal(full.action?.collateral, "USDC");
  assert.equal(full.usdcSpent, 10_000_000_000n);
  // $12k free: $7k above the reserve carries $28k at 4x.
  const part = g.ouPlan({ ...base, fair: LOW, position: undefined, usdcFreeUnits: 12_000_000_000n });
  assert.equal(part.action?.sizeDeltaUsd, (28_000n * E30).toString());
  assert.equal(part.action?.collateralAmount, "7000000000");
  // $7k free: $2k above the reserve is $8k, under the $10k floor.
  const none = g.ouPlan({ ...base, fair: LOW, position: undefined, usdcFreeUnits: 7_000_000_000n });
  assert.equal(none.action, undefined);
  // ETH below the 0.03 execution fee plus the 0.05 reserve: nothing.
  const dry = g.ouPlan({ ...base, fair: LOW, position: undefined, ethWei: 70_000_000_000_000_000n });
  assert.equal(dry.action, undefined);
});

// ---------------------------------------------------------------------------
// pending orders, reversal, end of epoch (through decide, with the module's own memory)
// ---------------------------------------------------------------------------

test("pending: an increase is not re-sent while its fill is not yet reflected; expires after 6 blocks", async () => {
  g.resetOuStateForTest();
  // Block 100 sets the anchors (3000 / 60000).
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 100 }))), []);
  const first = gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW })));
  assert.equal(first.length, 1);
  assert.equal(first[0].type, "gmxIncrease");
  assert.equal(first[0].isLong, true);
  // Blocks 102..106: the position has not shown up, the signal is unchanged -> nothing new.
  for (let b = 102; b <= 106; b++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block: b, fairWeth: LOW }))), [], `block ${b}`);
  // Block 107 = sent + 6: the order is presumed lost and the module may act again.
  const again = gmxOnly(await emitted(obsFor({ block: 107, fairWeth: LOW })));
  assert.equal(again.length, 1);
  assert.equal(again[0].type, "gmxIncrease");
});

test("pending: once the fill is reflected the module stops waiting and holds", async () => {
  g.resetOuStateForTest();
  await emitted(obsFor({ block: 100 }));
  assert.equal(gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW }))).length, 1);
  // Reflected at block 103: positioned, nothing more.
  assert.deepEqual(
    gmxOnly(await emitted(obsFor({ block: 103, fairWeth: LOW, wethPos: pos(40_000) }))),
    [],
  );
  // And it is not pending any more: a later liquidation (position gone) is re-entered at once,
  // well inside the 6-block window of the original order.
  const reentry = gmxOnly(await emitted(obsFor({ block: 104, fairWeth: LOW })));
  assert.equal(reentry.length, 1);
  assert.equal(reentry[0].type, "gmxIncrease");
});

test("reversal: decrease all now, the opposite increase once the decrease is reflected", async () => {
  g.resetOuStateForTest();
  await emitted(obsFor({ block: 100 }));
  const HIGH = 3000 * 1.0204; // g = -2%: short wanted
  const close = gmxOnly(await emitted(obsFor({ block: 110, fairWeth: HIGH, wethPos: pos(40_000) })));
  assert.equal(close.length, 1);
  assert.equal(close[0].type, "gmxDecrease");
  assert.equal(close[0].isLong, true);
  assert.equal(close[0].sizeDeltaUsd, (40_000n * E30).toString());
  assert.equal(close[0].collateralDeltaAmount, "10000000000");
  assert.equal(close[0].collateral, "USDC");
  // Still showing the long one block later: waiting, not a second close.
  assert.deepEqual(
    gmxOnly(await emitted(obsFor({ block: 111, fairWeth: HIGH, wethPos: pos(40_000) }))),
    [],
  );
  // The long is gone: open the short.
  const open = gmxOnly(await emitted(obsFor({ block: 112, fairWeth: HIGH })));
  assert.equal(open.length, 1);
  assert.equal(open[0].type, "gmxIncrease");
  assert.equal(open[0].isLong, false);
});

test("end of epoch: no new orders at 5 blocks remaining or fewer", async () => {
  g.resetOuStateForTest();
  await emitted(obsFor({ block: 100 }));
  for (const left of [5, 3, 1, 0])
    assert.deepEqual(
      gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW, blocksRemaining: left }))),
      [],
      `blocksRemaining ${left}`,
    );
  // Nor a close of a wrong-side position.
  assert.deepEqual(
    gmxOnly(
      await emitted(obsFor({ block: 102, fairWeth: 3000 * 1.02, wethPos: pos(40_000), blocksRemaining: 4 })),
    ),
    [],
  );
  assert.equal(
    gmxOnly(await emitted(obsFor({ block: 103, fairWeth: LOW, blocksRemaining: 6 }))).length,
    1,
  );
});

test("absent GMX: no venue -> no orders; no WBTC market -> WETH only", async () => {
  g.resetOuStateForTest();
  await emitted(obsFor({ block: 100, gmx: false }));
  assert.deepEqual(
    gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW, fairWbtc: 60_000 / 1.02, gmx: false }))),
    [],
  );
  g.resetOuStateForTest();
  await emitted(obsFor({ block: 100, wbtcMarket: false }));
  const out = gmxOnly(
    await emitted(obsFor({ block: 101, fairWeth: LOW, fairWbtc: 60_000 / 1.02, wbtcMarket: false })),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].base, "WETH");
});

test("both bases open in one block and the orders parse and validate", async () => {
  g.resetOuStateForTest();
  await emitted(obsFor({ block: 100 }));
  const obs = obsFor({ block: 101, fairWeth: LOW, fairWbtc: 60_000 * 1.02 });
  const out = gmxOnly(await emitted(obs));
  assert.equal(out.length, 2);
  const [weth, wbtc] = out;
  assert.equal(weth.base, "WETH");
  assert.equal(weth.isLong, true);
  assert.equal(wbtc.base, "WBTC");
  assert.equal(wbtc.isLong, false);
  const balances = {
    ethWei: 10n ** 18n,
    wethWei: 8n * 10n ** 18n,
    usdcUnits: 25_000_000_000n,
    bases: { WETH: 8n * 10n ** 18n, WBTC: 40_000_000n },
    stables: {},
  } as unknown as Parameters<typeof validateAction>[2];
  for (const x of out) {
    const parsed = parseAction(x);
    const r = validateAction(parsed, obs, balances);
    assert.equal(r.ok, true, `rejected ${JSON.stringify(x)}: ${r.ok ? "" : r.reason}`);
  }
});

// ---------------------------------------------------------------------------
// inside the band opus-1g is opus-1a
// ---------------------------------------------------------------------------

test("inside the band opus-1g emits exactly opus-1a's actions", async () => {
  g.resetOuStateForTest();
  // A sequence that makes opus-1a act (a cross-venue dislocation, an inventory edge) and not act,
  // with every fair inside +-0.8% of the anchor. Both agents see the same observations in order.
  const seq = [
    obsFor({ block: 200 }),
    obsFor({ block: 201, fairWeth: 3010, uniMid: 3010, curveMid: 3070 }),
    obsFor({ block: 202, fairWeth: 2990, uniMid: 2950, curveMid: 2990 }),
    obsFor({ block: 203, fairWeth: 3020, fairWbtc: 60_300 }),
    obsFor({ block: 204, fairWeth: 2980, uniMid: 2980, curveMid: 2900, wethPos: pos(40_000) }),
    obsFor({ block: 205, fairWeth: 3000, blocksRemaining: 10 }),
  ];
  let acted = 0;
  for (const obs of seq) {
    const mine = await emitted(obs, g.decide);
    const theirs = await emitted(obs, a.decide);
    assert.deepEqual(mine, theirs, `block ${obs.blockNumber}`);
    assert.deepEqual(gmxOnly(mine), []);
    if (theirs.length > 0) acted += 1;
  }
  assert.ok(acted >= 2, `the sequence must exercise opus-1a's own actions (acted in ${acted})`);
});
