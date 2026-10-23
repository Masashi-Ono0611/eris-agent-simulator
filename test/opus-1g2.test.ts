// opus-1g2 = opus-1a plus M-OU, a GMX position on the fair price's pull back to its fixed anchor.
// These pin the module's decision arithmetic: the anchor it picks, the hysteresis band, the
// pending-order table that keeps an in-flight order from being sent twice, the two-step reversal,
// the end-of-epoch stop, a run without GMX, and that inside the band opus-1g2 is exactly opus-1a.
process.env.ERIS_LOCAL_DEPLOY = "1";

import test, { beforeEach, afterEach } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { AgentContext } from "@eris/sdk/agent.js";

const { parseAction, validateAction } = await import("@eris/sdk/action.js");
const g = await import("../example/agents/opus-1g2/agent.js");
const a = await import("../example/agents/opus-1a/agent.js");

let originalStateDir: string | undefined;
let testStateDir: string | undefined;
beforeEach(() => {
  originalStateDir = process.env.ERIS_AGENT_STATE_DIR;
  persistentState();
  g.resetOuStateForTest();
});
afterEach(() => {
  if (originalStateDir === undefined) delete process.env.ERIS_AGENT_STATE_DIR;
  else process.env.ERIS_AGENT_STATE_DIR = originalStateDir;
  if (testStateDir) rmSync(testStateDir, { recursive: true, force: true });
  testStateDir = undefined;
  g.resetOuStateForTest();
});
function persistentState(): string {
  if (testStateDir) rmSync(testStateDir, { recursive: true, force: true });
  testStateDir = mkdtempSync(join(tmpdir(), "opus-1g2-state-"));
  process.env.ERIS_AGENT_STATE_DIR = testStateDir;
  return join(testStateDir, "opus-1g2-ou-state.json");
}

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
  epoch?: AgentObservation["epoch"];
  runId?: string;
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
    runId: opts.runId ?? "t",
    epoch: opts.epoch,
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
    agentId: "opus-1g2",
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

/** Everything one decide() call sends: submissions first, then the returned action, exactly like botMain. */
async function emitted(obs: AgentObservation, decide = g.decide): Promise<Act[]> {
  const ctx = fakeCtx();
  const action = await decide(obs, ctx);
  return [...ctx.submitted, action].filter(Boolean) as Act[];
}

const gmxOnly = (xs: Act[]) =>
  xs.filter((x) => x.type === "gmxIncrease" || x.type === "gmxDecrease");

// Fair 2% under the anchor for WETH (g = +2.04%); WBTC stays at its anchor (g = 0).
const LOW = 3000 / 1.0204;

async function warmup(opts: Parameters<typeof obsFor>[0] = {}): Promise<void> {
  for (let block = 98; block <= 100; block++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ ...opts, block }))), []);
}

test("send order: base0 and base1 precede OU orders", async () => {
  const prior = process.env.ERIS_MAX_AGENT_BLOCK_GAS;
  process.env.ERIS_MAX_AGENT_BLOCK_GAS = "20000000";
  try {
    await warmup();
    const obs = obsFor({ block: 101, fairWeth: LOW, fairWbtc: 61200,
      uniMid: 2900, curveMid: 3100, usdc: "100000000000" });
    // opus-1a returns its highest-ranked candidate and submits the optional second.
    // Use that selection as the independent base0/base1 oracle, not its send order.
    const baseCtx = fakeCtx();
    const base0 = await a.decide(obs, baseCtx);
    const bases = [base0, ...baseCtx.submitted].filter(Boolean) as Act[];
    assert.equal(bases.length, 2);
    assert.equal(bases[0].type, "bundle", "exercise the main arbitrage");
    const sent = await emitted(obs);
    assert.equal(gmxOnly(sent).length, 2, "exercise both OU markets in the same block");
    assert.deepEqual(sent.slice(0, bases.length), bases, "base0 must be first, base1 second");
    assert.deepEqual(sent.slice(bases.length).map(x => [x.type, x.base]),
      [["gmxIncrease", "WETH"], ["gmxIncrease", "WBTC"]]);
  } finally {
    if (prior === undefined) delete process.env.ERIS_MAX_AGENT_BLOCK_GAS;
    else process.env.ERIS_MAX_AGENT_BLOCK_GAS = prior;
  }
});

test("send order: without a base trade OU submissions and return stay unchanged", async () => {
  await warmup();
  const ctx = fakeCtx();
  const returned = await g.decide(obsFor({ block: 101, fairWeth: LOW, fairWbtc: 61200 }), ctx);
  const sent = [...ctx.submitted, returned].filter(Boolean) as Act[];
  assert.deepEqual(sent.map(x => [x.type, x.base]),
    [["gmxIncrease", "WBTC"], ["gmxIncrease", "WETH"]]);
  assert.equal(ctx.submitted.length, 1);
  assert.equal((returned as Act).base, "WETH");
});

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
  confirmedBlocks: 3,
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

test("pending: an expired unreflected increase never permits replacement exposure", async () => {
  g.resetOuStateForTest();
  // Three observations establish the anchors and the initial flat position.
  await warmup();
  const first = gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW })));
  assert.equal(first.length, 1);
  assert.equal(first[0].type, "gmxIncrease");
  assert.equal(first[0].isLong, true);
  // Blocks 102..106: the position has not shown up, the signal is unchanged -> nothing new.
  for (let b = 102; b <= 106; b++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block: b, fairWeth: LOW }))), [], `block ${b}`);
  for (let block = 107; block <= 120; block++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
});

test("pending: once the fill is reflected the module stops waiting and holds", async () => {
  g.resetOuStateForTest();
  await warmup();
  assert.equal(gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW }))).length, 1);
  await emitted(obsFor({ block: 102, fairWeth: LOW }));
  // Reflected at block 103: positioned, nothing more.
  assert.deepEqual(
    gmxOnly(await emitted(obsFor({ block: 103, fairWeth: LOW, wethPos: pos(40_000) }))),
    [],
  );
  // An absent position must remain flat for three consecutive observed blocks before re-entry.
  for (const block of [104, 105])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
  const reentry = gmxOnly(await emitted(obsFor({ block: 106, fairWeth: LOW })));
  assert.equal(reentry.length, 1);
  assert.equal(reentry[0].type, "gmxIncrease");
});

test("reversal: decrease all now, the opposite increase once the decrease is reflected", async () => {
  g.resetOuStateForTest();
  await warmup();
  const HIGH = 3000 * 1.0204; // g = -2%: short wanted
  for (let block = 101; block < 110; block++) await emitted(obsFor({ block }));
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
  // The long is gone: require three flat blocks before opening the short.
  for (const block of [112, 113])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: HIGH }))), []);
  const open = gmxOnly(await emitted(obsFor({ block: 114, fairWeth: HIGH })));
  assert.equal(open.length, 1);
  assert.equal(open[0].type, "gmxIncrease");
  assert.equal(open[0].isLong, false);
});

test("end of epoch: no new orders at 5 blocks remaining or fewer", async () => {
  g.resetOuStateForTest();
  await warmup();
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
  for (const block of [103, 104])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW, blocksRemaining: 6 }))), []);
  assert.equal(
    gmxOnly(await emitted(obsFor({ block: 105, fairWeth: LOW, blocksRemaining: 6 }))).length,
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
  await warmup({ wbtcMarket: false });
  const out = gmxOnly(
    await emitted(obsFor({ block: 101, fairWeth: LOW, fairWbtc: 60_000 / 1.02, wbtcMarket: false })),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].base, "WETH");
});

test("both bases open in one block and the orders parse and validate", async () => {
  g.resetOuStateForTest();
  await warmup();
  const obs = obsFor({ block: 101, fairWeth: LOW, fairWbtc: 60_000 * 1.02 });
  const out = gmxOnly(await emitted(obs));
  assert.equal(out.length, 2);
  const [wbtc, weth] = out;
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
// inside the band opus-1g2 is opus-1a
// ---------------------------------------------------------------------------

test("inside the band opus-1g2 emits exactly opus-1a's actions", async () => {
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
    // Preserve opus-1a's selected actions, in candidate order. Its runtime send
    // order still puts the returned first candidate last, which we now fix here.
    const baseCtx = fakeCtx();
    const first = await a.decide(obs, baseCtx);
    const theirs = [first, ...baseCtx.submitted].filter(Boolean) as Act[];
    assert.deepEqual(mine, theirs, `block ${obs.blockNumber}`);
    assert.deepEqual(gmxOnly(mine), []);
    if (theirs.length > 0) acted += 1;
  }
  assert.ok(acted >= 2, `the sequence must exercise opus-1a's own actions (acted in ${acted})`);
});


test("reload: persisted intent prevents an increase during the two-block fill window", async () => {
  g.resetOuStateForTest();
  for (let block = 98; block <= 100; block++) await emitted(obsFor({ block }));
  assert.equal(gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW }))).length, 1);
  g.resetOuStateForTest();
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 102, fairWeth: LOW }))), []);
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 103, fairWeth: LOW, wethPos: pos(40_000) }))), []);
});

test("risk: stop loss closes an aligned position and disables re-entry", async () => {
  g.resetOuStateForTest();
  const losing = { ...pos(40_000), pnlUsd: -5001 };
  const close = gmxOnly(await emitted(obsFor({ block: 100, fairWeth: LOW, wethPos: losing })));
  assert.equal(close.length, 1);
  assert.equal(close[0].type, "gmxDecrease");
  for (let block = 101; block <= 110; block++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
});


test("confirmation: three distinct consecutive blocks, never repeated snapshots", async () => {
  for (const block of [100, 100, 100, 101])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
  assert.equal(gmxOnly(await emitted(obsFor({ block: 102, fairWeth: LOW }))).length, 1);
});

test("persistence: anchor and pending survive reload at fair 2700, including after six blocks", async () => {
  const path = persistentState();
  await warmup();
  assert.equal(gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW }))).length, 1);
  g.resetOuStateForTest();
  for (let block = 102; block <= 110; block++) {
    const ctx = fakeCtx();
    const action = await g.decide(obsFor({ block, fairWeth: 2700 }), ctx);
    assert.deepEqual(gmxOnly([action, ...ctx.submitted].filter(Boolean) as Act[]), []);
    const log = ctx.logs.at(-1) as { signals: Record<string, number> };
    assert.equal(log.signals.ouAnchorWETH, 3000);
  }
  const raw = readFileSync(path, "utf8");
  assert.ok(raw.length < 2048, `small bounded record: ${raw.length} bytes`);
  const saved = JSON.parse(raw);
  assert.equal(saved.epoch.key, "start:98");
  assert.equal(saved.bases.find((b: Act) => b.base === "WETH").pending.sentBlock, 101);
});

test("persistence: an anchor survives reload even when there is no pending order", async () => {
  persistentState();
  await warmup();
  g.resetOuStateForTest();
  for (const block of [101, 102])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: 2700 }))), []);
  const out = gmxOnly(await emitted(obsFor({ block: 103, fairWeth: 2700 })));
  assert.equal(out.length, 1);
  assert.equal(out[0].isLong, true);
});

test("pending: a missing GMX market does not cancel an increase", async () => {
  persistentState();
  await warmup();
  await emitted(obsFor({ block: 101, fairWeth: LOW }));
  await emitted(obsFor({ block: 102, gmx: false }));
  g.resetOuStateForTest();
  for (let block = 103; block <= 110; block++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
});

test("emission: logging and submit exceptions do not record phantom pending intents", async () => {
  const path = persistentState();
  await warmup();
  const ctx = fakeCtx();
  ctx.log = () => { throw new Error("injected log failure"); };
  await assert.rejects(g.decide(obsFor({ block: 101, fairWeth: LOW }), ctx), /injected/);
  let saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.bases.find((b: Act) => b.base === "WETH").pending, undefined);
  assert.equal(gmxOnly(await emitted(obsFor({ block: 102, fairWeth: LOW }))).length, 1);

  // A fresh epoch builds two OU actions, placing at least one on the ctx.submit path.
  g.resetOuStateForTest();
  const epoch = { index: 2, count: 60 };
  for (let block = 200; block < 203; block++) await emitted(obsFor({ block, epoch }));
  const failingSubmit = fakeCtx();
  failingSubmit.submit = () => { throw new Error("injected submit failure"); };
  await assert.rejects(g.decide(obsFor({ block: 203, epoch, fairWeth: LOW,
    fairWbtc: 60_000 * 1.02 }), failingSubmit), /injected/);
  saved = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(saved.bases.every((b: Act) => b.pending === undefined));
  assert.equal(gmxOnly(await emitted(obsFor({ block: 204, epoch, fairWeth: LOW,
    fairWbtc: 60_000 * 1.02 }))).length, 2);
});

test("persistence: corrupt or unwritable state disables increases", async () => {
  const path = persistentState();
  writeFileSync(path, "{incomplete");
  for (const block of [100, 101])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
  assert.equal(gmxOnly(await emitted(obsFor({ block: 102, fairWeth: LOW }))).length, 0);
  // A regular file cannot serve as a directory. No permissions assumptions (e.g. root) needed.
  process.env.ERIS_AGENT_STATE_DIR = path;
  g.resetOuStateForTest();
  for (const block of [103, 104])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
  assert.equal(gmxOnly(await emitted(obsFor({ block: 105, fairWeth: LOW }))).length, 0);
});

test("risk: loss threshold is strict and closes either side with fee and gas", async () => {
  for (const side of [1, -1]) {
    persistentState();
    g.resetOuStateForTest();
    const fairWeth = side > 0 ? LOW : 3000 * 1.019;
    const atThreshold = { ...pos(side * 40_000), pnlUsd: -5000 };
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 100, fairWeth,
      wethPos: atThreshold }))), []);
    const out = gmxOnly(await emitted(obsFor({ block: 101, fairWeth,
      wethPos: { ...atThreshold, pnlUsd: -5000.01 },
      blocksRemaining: 1, ethWei: "42000000000000000" })));
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "gmxDecrease");
    assert.equal(out[0].isLong, side > 0);
    for (let block = 102; block <= 108; block++)
      assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth }))), []);
  }
});

test("risk: a stop remains latched without fee funds and across reload after the close", async () => {
  persistentState();
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 100, fairWeth: LOW,
    wethPos: { ...pos(40_000), pnlUsd: -6000 }, ethWei: "29999999999999999" }))), []);
  g.resetOuStateForTest();
  // PnL recovery cannot unlatch an already-triggered risk exit.
  const out = gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW, wethPos: pos(40_000) })));
  assert.equal(out[0]?.type, "gmxDecrease");
  g.resetOuStateForTest();
  for (let block = 102; block <= 110; block++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
});

test("risk: 24 consecutive adverse drift steps close long and short, with no re-entry after reload", async () => {
  persistentState();
  for (const side of [1, -1]) {
    // A new epoch clears the previous side's stop; all prices remain on its adverse anchor side.
    const epoch = { index: side > 0 ? 1 : 2, count: 60 };
    const fair = (step: number) => 3000 - side * (30 + step);
    for (let step = 0; step < 24; step++) {
      if (step === 12) g.resetOuStateForTest();
      assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 100 + step, epoch,
        fairWeth: fair(step), wethPos: pos(side * 40_000) }))), [], `step ${step}`);
    }
    const out = gmxOnly(await emitted(obsFor({ block: 124, epoch,
      fairWeth: fair(24), wethPos: pos(side * 40_000) })));
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "gmxDecrease");
    assert.equal(out[0].isLong, side > 0);
    g.resetOuStateForTest();
    for (let block = 125; block <= 132; block++)
      assert.deepEqual(gmxOnly(await emitted(obsFor({ block, epoch, fairWeth: fair(24) }))), []);
  }
});

test("risk: a plateau or favorable tick breaks the adverse drift streak", async () => {
  for (const breakFair of [2947, 2950]) {
    persistentState();
    g.resetOuStateForTest();
    for (let step = 0; step < 24; step++)
      assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 100 + step,
        fairWeth: 2970 - step, wethPos: pos(40_000) }))), []);
    for (let step = 0; step < 24; step++)
      assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 124 + step,
        fairWeth: breakFair - step, wethPos: pos(40_000) }))), []);
    assert.equal(gmxOnly(await emitted(obsFor({ block: 148,
      fairWeth: breakFair - 24, wethPos: pos(40_000) })))[0]?.type, "gmxDecrease");
  }
});

test("ETH: reversal decrease accepts 0.03 to below 0.08 ETH, entry still needs the reserve", () => {
  for (const ethWei of [30_000_000_000_000_000n, 50_000_000_000_000_000n,
    79_999_999_999_999_999n]) {
    const d = g.ouPlan({ ...base, fair: 3060, position: pos(40_000) as never, ethWei });
    assert.equal(d.action?.type, "gmxDecrease");
    assert.equal(g.ouPlan({ ...base, fair: LOW, position: undefined, ethWei }).action, undefined);
  }
  assert.equal(g.ouPlan({ ...base, fair: 3060, position: pos(40_000) as never,
    ethWei: 29_999_999_999_999_999n }).action, undefined);
});

test("epoch: ordinal change clears anchors, pending, confirmation and risk stops on disk and in memory", async () => {
  const path = persistentState();
  const epoch1 = { index: 1, count: 60 };
  const epoch2 = { index: 2, count: 60 };
  await emitted(obsFor({ block: 100, epoch: epoch1, fairWeth: LOW,
    wethPos: { ...pos(40_000), pnlUsd: -6000 } }));
  // Consecutive block numbers: the ordinal alone must cause a reset.
  await emitted(obsFor({ block: 101, epoch: epoch2, fairWeth: 2700 }));
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.epoch.key, "epoch:2/60");
  const weth = saved.bases.find((b: Act) => b.base === "WETH");
  assert.equal(weth.anchor, 2700);
  assert.equal(weth.pending, undefined);
  assert.equal(weth.stopped, false);
  g.resetOuStateForTest();
  for (const block of [102, 103])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, epoch: epoch2, fairWeth: 2650 }))), []);
  assert.equal(gmxOnly(await emitted(obsFor({ block: 104, epoch: epoch2, fairWeth: 2650 }))).length, 1);
});

test("epoch: block discontinuities preserve anchors and cannot permit replacement entry", async () => {
  for (const nextBlock of [10, 200]) {
    const path = persistentState();
    g.resetOuStateForTest();
    await warmup();
    await emitted(obsFor({ block: 101, fairWeth: LOW }));
    g.resetOuStateForTest();
    for (const block of [nextBlock, nextBlock + 1, nextBlock + 2])
      assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: 2700 }))), []);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.epoch.key, "start:98");
    const weth = saved.bases.find((b: Act) => b.base === "WETH");
    assert.equal(weth.anchor, 3000);
    if (nextBlock < 101) assert.equal(weth.pending.sentBlock, 101);
    else { assert.equal(weth.pending, undefined); assert.equal(weth.stopped, true); }
  }
});

test("epoch: declared run start is stable over reload and run identity isolates reused block numbers", async () => {
  const path = persistentState();
  const call = async (block: number, runId = "first") => {
    const ctx = fakeCtx();
    ctx.config.runBlocks = 360;
    await g.decide(obsFor({ block, runId, blocksRemaining: 360 - (block - 90) }), ctx);
  };
  await call(100);
  g.resetOuStateForTest();
  await call(101);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).epoch.key, "start:90");
  await call(110); // forward discontinuity resets the record, not the declared run origin
  g.resetOuStateForTest();
  await call(111);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).epoch.key, "start:90");
  await call(112, "second");
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.epoch.runId, "second");
  assert.equal(saved.epoch.key, "start:90");
});


test("pending: persisted decrease survives reload and a transient missing position", async () => {
  persistentState();
  await warmup();
  const high = 3057;
  const first = gmxOnly(await emitted(obsFor({ block: 101, fairWeth: high, wethPos: pos(40_000) })));
  assert.equal(first[0]?.type, "gmxDecrease");
  g.resetOuStateForTest();
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 102, fairWeth: high }))), []);
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 103, fairWeth: high, wethPos: pos(40_000) }))), []);
  for (const block of [104, 105])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: high }))), []);
  const opposite = gmxOnly(await emitted(obsFor({ block: 106, fairWeth: high })));
  assert.equal(opposite[0]?.type, "gmxIncrease");
  assert.equal(opposite[0]?.isLong, false);
});

test("fix ETH: two increases cannot spend their closing fees and base gas", async () => {
  await warmup();
  const obs = obsFor({ block: 101, fairWeth: LOW, fairWbtc: 61200,
    ethWei: "110000000000000000", uniMid: 2900, curveMid: 3100 });
  obs.limits!.defaultPriorityFeePerGasWei = (5n * GWEI).toString();
  const actions = await emitted(obs);
  assert.ok(actions.some(a => a.type === "bundle"), "exercise base bundle");
  assert.equal(gmxOnly(actions).length, 0);
  // A pre-existing position also needs a funded close before opening the other market.
  const existingObs = obsFor({ block: 102, fairWeth: LOW, fairWbtc: 61200,
    wethPos: pos(40000), ethWei: "150000000000000000" });
  existingObs.limits!.defaultPriorityFeePerGasWei = (5n * GWEI).toString();
  const existing = await emitted(existingObs);
  assert.deepEqual(gmxOnly(existing), []);
});

test("fix skipped block: pending and risk stop survive a same-epoch gap", async () => {
  const path = persistentState();
  await warmup();
  await emitted(obsFor({ block: 101, fairWeth: LOW }));
  g.resetOuStateForTest();
  for (const block of [105, 106, 107])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.bases.find((b: Act) => b.base === "WETH").pending.sentBlock, 101);
  await emitted(obsFor({ block: 108, fairWeth: LOW, wethPos: { ...pos(40000), pnlUsd: -6000 } }));
  g.resetOuStateForTest();
  for (const block of [112, 113, 114])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
});

test("memory persistence: unset state directory trades and retains intents across blocks", async () => {
  delete process.env.ERIS_AGENT_STATE_DIR;
  await warmup();
  const call = async (block: number) => {
    const ctx = fakeCtx();
    const returned = await g.decide(obsFor({ block, fairWeth: LOW }), ctx);
    const actions = gmxOnly([...ctx.submitted, returned].filter(Boolean) as Act[]);
    return { ctx, actions };
  };
  const first = await call(101);
  assert.equal(first.actions[0]?.type, "gmxIncrease");
  assert.equal(first.actions[0]?.isLong, true);
  assert.equal(first.actions[0]?.sizeDeltaUsd, (40_000n * E30).toString());
  for (const block of [101, 102, 103, 108]) {
    const next = await call(block);
    assert.deepEqual(next.actions, [], `pending intent retained at ${block}`);
    assert.equal(next.ctx.logs.length, 1);
    const signals = (next.ctx.logs[0] as { signals: Record<string, number> }).signals;
    assert.equal(signals.ouPersistenceMemory, 1);
    assert.equal(signals.ouPersistenceDegraded, 0);
    assert.equal(signals.ouPendingWETH, 101);
    assert.equal(signals.ouAnchorWETH, 3000);
  }
});

test("memory persistence: run and epoch changes clear old pending intents", async () => {
  delete process.env.ERIS_AGENT_STATE_DIR;
  for (const opts of [
    { runId: "first", epoch: { index: 1, count: 60 } },
    { runId: "first", epoch: { index: 2, count: 60 } },
    { runId: "second", epoch: { index: 2, count: 60 } },
  ]) {
    await warmup(opts);
    assert.equal(gmxOnly(await emitted(obsFor({ ...opts, block: 101, fairWeth: LOW })))[0]?.type,
      "gmxIncrease");
  }
});

test("fix persistence: corrupt loads and failed saves prohibit entries but permit risk exits", async () => {
  for (const mode of ["corrupt", "save", "final-save"]) {
    const path = persistentState();
    g.resetOuStateForTest();
    if (mode === "corrupt") writeFileSync(path, "{");
    await warmup();
    if (mode === "save") {
      // Fail the atomic temporary write after a successful load/save.
      const { mkdirSync } = await import("node:fs");
      mkdirSync(`${path}.tmp`);
    }
    const ctx = fakeCtx();
    if (mode === "final-save") {
      const { mkdirSync } = await import("node:fs");
      ctx.log = () => { mkdirSync(`${path}.tmp`, { recursive: true }); };
    }
    const returned = await g.decide(obsFor({ block: 101, fairWeth: LOW }), ctx);
    assert.deepEqual(gmxOnly([returned, ...ctx.submitted].filter(Boolean) as Act[]), [], mode);
    const out = gmxOnly(await emitted(obsFor({ block: 102, fairWeth: LOW,
      wethPos: { ...pos(40000), pnlUsd: -6000 } })));
    assert.equal(out[0]?.type, "gmxDecrease", mode);
  }
});

test("fix pending: unreflected intent allows risk exit and expires without replacement exposure", async () => {
  const path = persistentState();
  await warmup();
  await emitted(obsFor({ block: 101, fairWeth: LOW }));
  const close = gmxOnly(await emitted(obsFor({ block: 102, fairWeth: LOW,
    wethPos: { ...pos(20000), pnlUsd: -6000 } })));
  assert.equal(close[0]?.type, "gmxDecrease");
  for (let block = 103; block <= 140; block++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.bases.find((b: Act) => b.base === "WETH").pending, undefined);
  // A genuinely unreflected increase expires too, latching entries off even after reload.
  persistentState(); g.resetOuStateForTest(); await warmup();
  await emitted(obsFor({ block: 101, fairWeth: LOW }));
  for (let block = 102; block <= 140; block++) await emitted(obsFor({ block, fairWeth: LOW }));
  g.resetOuStateForTest();
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 141, fairWeth: LOW }))), []);
  const expired = JSON.parse(readFileSync(join(testStateDir!, "opus-1g2-ou-state.json"), "utf8"));
  assert.equal(expired.bases.find((b: Act) => b.base === "WETH").pending, undefined);
});

test("fix gas capacity: preserve both base bundle legs before admitting queued OU", async () => {
  const prior = process.env.ERIS_MAX_AGENT_BLOCK_GAS;
  process.env.ERIS_MAX_AGENT_BLOCK_GAS = "4800000";
  try {
    await warmup();
    const obs = obsFor({ block: 101, fairWeth: LOW, uniMid: 2900, curveMid: 3100 });
    const actions = await emitted(obs);
    assert.ok(actions.some(a => a.type === "bundle"));
    assert.deepEqual(gmxOnly(actions), []);
  } finally {
    if (prior === undefined) delete process.env.ERIS_MAX_AGENT_BLOCK_GAS;
    else process.env.ERIS_MAX_AGENT_BLOCK_GAS = prior;
  }
});

test("review pending decrease: risk exit waits until reflection or deadline", async () => {
  const path = persistentState();
  const losing = { ...pos(40000), pnlUsd: -6000 };
  const snapshot = (block: number) => obsFor({ block, fairWeth: LOW, wethPos: losing });
  assert.equal(gmxOnly(await emitted(snapshot(100)))[0]?.type, "gmxDecrease");
  for (let block = 101; block < 112; block++) {
    if (block === 105) g.resetOuStateForTest();
    assert.deepEqual(gmxOnly(await emitted(snapshot(block))), [], `pending at ${block}`);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.bases.find((b: Act) => b.base === "WETH").pending.sentBlock, 100);
  }
  assert.equal(gmxOnly(await emitted(snapshot(112)))[0]?.type, "gmxDecrease");
  for (const block of [113, 114, 115])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.bases.find((b: Act) => b.base === "WETH").pending, undefined);
});

test("review exit capacity: reserve gas ahead of base bundles", async () => {
  const prior = process.env.ERIS_MAX_AGENT_BLOCK_GAS;
  process.env.ERIS_MAX_AGENT_BLOCK_GAS = "4800000";
  try {
    const actions = await emitted(obsFor({ block: 100, fairWeth: LOW,
      uniMid: 2900, curveMid: 3100, wethPos: { ...pos(40000), pnlUsd: -6000 } }));
    assert.equal(gmxOnly(actions)[0]?.type, "gmxDecrease");
    const gas = (a: Act): bigint => a.type === "bundle"
      ? (a.actions as Act[]).reduce((n, a) => n + gas(a), 0n) : 2_400_000n;
    assert.ok(actions.reduce((n, a) => n + gas(a), 0n) <= 4_800_000n);
  } finally {
    if (prior === undefined) delete process.env.ERIS_MAX_AGENT_BLOCK_GAS;
    else process.env.ERIS_MAX_AGENT_BLOCK_GAS = prior;
  }
});

test("review closing funds: base wrapping preserves every open position reserve", async () => {
  await warmup();
  for (const block of [101, 102]) {
    const obs = obsFor({ block, ethWei: "10000000000000000000",
      wethPos: pos(40000), wbtcPos: pos(-40000) });
    obs.limits!.maxPriorityFeePerGasWei = (500n * GWEI).toString();
    obs.limits!.defaultPriorityFeePerGasWei = (500n * GWEI).toString();
    const actions = await emitted(obs);
    const wraps = actions.filter(a => a.type === "rawTx");
    assert.equal(wraps.length, 1, "exercise base ETH spending on later observations");
    const spent = wraps.reduce((n, a) => n + BigInt((a.tx as { value: string }).value), 0n);
    const gasWei = 2_400_000n * 500n * GWEI;
    const closeReserve = 2n * (30_000_000_000_000_000n + gasWei);
    assert.ok(10n ** 19n - spent - gasWei >= closeReserve,
      "base value plus gas must leave both closing fees and gas untouched");
  }
});

// Real calm/1003 FD log, round 1482. Fee limits are not logged: use the SDK's
// economicGas observation contract (1 ETH/gas cap), default 0.1 gwei bid.
test("calm 1003: economicGas cap is not the order price; logged balances can enter", async () => {
  delete process.env.ERIS_AGENT_STATE_DIR;
  const snapshot = (block: number) => {
    const obs = obsFor({ block, fairWeth: 2941.76934754, fairWbtc: 60488.02178585,
      ethWei: "997775518644049000", usdc: "25012059364", blocksRemaining: 204 });
    obs.limits!.maxPriorityFeePerGasWei = (10n ** 18n).toString();
    return obs;
  };
  const oldOrderGas = 2_400_000n * 10n ** 18n;
  assert.equal(2n * (30_000_000_000_000_000n + oldOrderGas) + g.PARAMS.ouEthReserveWei,
    4_800_000_110_000_000_000_000_000n);
  assert.equal(g.ouPlan({ ...base, fair: 2941.76934754, position: undefined,
    ethWei: 997775518644049000n, orderGasWei: oldOrderGas }).note,
    "ETH short of the execution fee");
  for (const block of [1480, 1481]) await emitted(snapshot(block));
  const actions = await emitted(snapshot(1482));
  assert.equal(gmxOnly(actions)[0]?.type, "gmxIncrease");
  assert.ok(gmxOnly(actions).some(a => a.base === "WETH"));
});

test("skip telemetry: confirmation, ETH, pending, risk, persistence and gas capacity", async () => {
  delete process.env.ERIS_AGENT_STATE_DIR;
  const call = async (block: number, ethWei = "1000000000000000000") => {
    const ctx = fakeCtx();
    const returned = await g.decide(obsFor({ block, fairWeth: LOW, ethWei }), ctx);
    const signals = (ctx.logs.at(-1) as { signals: Record<string, number> }).signals;
    return { signals, actions: gmxOnly([...ctx.submitted, returned].filter(Boolean) as Act[]) };
  };
  assert.equal((await call(100)).signals.ouSkipReasonWETH, g.OU_SKIP.confirmation);
  await call(101);
  const poor = await call(102, "110000000000000000");
  assert.equal(poor.signals.ouSkipReasonWETH, g.OU_SKIP.eth);
  assert.equal(poor.signals.ouEthRequiredWETH, 0.11048);
  assert.equal(poor.signals.ouEthAvailableWETH, 0.11);
  assert.equal((await call(103)).actions[0]?.type, "gmxIncrease");
  assert.equal((await call(104)).signals.ouSkipReasonWETH, g.OU_SKIP.pending);
  assert.equal((await call(115)).signals.ouSkipReasonWETH, g.OU_SKIP.risk);
  const path = persistentState();
  writeFileSync(path, "{");
  g.resetOuStateForTest();
  assert.equal((await call(100)).signals.ouSkipReasonWETH, g.OU_SKIP.persistence);
  delete process.env.ERIS_AGENT_STATE_DIR;
  g.resetOuStateForTest();
  const prior = process.env.ERIS_MAX_AGENT_BLOCK_GAS;
  process.env.ERIS_MAX_AGENT_BLOCK_GAS = "1";
  try {
    await call(100); await call(101);
    assert.equal((await call(102)).signals.ouSkipReasonWETH, g.OU_SKIP.gasCapacity);
  } finally {
    if (prior === undefined) delete process.env.ERIS_MAX_AGENT_BLOCK_GAS;
    else process.env.ERIS_MAX_AGENT_BLOCK_GAS = prior;
  }
});

test("economicGas: base bundle's bid is funded before OU, not the venue cap", async () => {
  delete process.env.ERIS_AGENT_STATE_DIR;
  await warmup();
  const obs = obsFor({ block: 101, fairWeth: LOW, uniMid: 2900, curveMid: 3100 });
  obs.limits!.maxPriorityFeePerGasWei = (10n ** 18n).toString();
  obs.competition = { maxCompetitorPriorityFeeWei: (2n * GWEI).toString() } as AgentObservation["competition"];
  const ctx = fakeCtx();
  const result = await g.decide(obs, ctx);
  const actions = [...ctx.submitted, result].filter(Boolean) as Act[];
  assert.equal(actions[0]?.type, "bundle");
  assert.ok(gmxOnly(actions).length > 0);
  const cost = (a: Act, inherited?: bigint): bigint => {
    const fee = inherited ?? BigInt(String(a.maxPriorityFeePerGasWei ?? GWEI / 10n));
    return a.type === "bundle" ? (a.actions as Act[]).reduce((n, child) =>
      n + cost(child, a.maxPriorityFeePerGasWei === undefined ? undefined : fee), 0n)
      : 2_400_000n * fee;
  };
  const baseCost = actions.filter(a => !a.type?.toString().startsWith("gmx"))
    .reduce((n, a) => n + cost(a), 0n);
  const signals = (ctx.logs[0] as { signals: Record<string, number> }).signals;
  assert.equal(signals.ouBaseGasEth, Number(baseCost) / 1e18);
  assert.ok(baseCost > 4_800_000n * GWEI / 10n, "exercise bids above the default");
  assert.ok(10n ** 18n - baseCost - 2n * 30_240_000_000_000_000n >= g.PARAMS.ouEthReserveWei);
});
