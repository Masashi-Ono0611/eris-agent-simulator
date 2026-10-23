// ascon-zeta-r3kg: M-OU behavioral tests ported from opus-1g, plus r3k parity/resource contracts.
// These pin the module's decision arithmetic: the anchor it picks, the hysteresis band, the
// pending-order table that keeps an in-flight order from being sent twice, the two-step reversal,
// the end-of-epoch stop, a run without GMX, and that inside the band opus-1g is exactly opus-1a.
process.env.ERIS_LOCAL_DEPLOY = "1";

import test, { beforeEach, afterEach } from "node:test";
import { mkdirSync, appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { AgentContext } from "@eris/sdk/agent.js";

const { parseAction, validateAction } = await import("@eris/sdk/action.js");
const g = { ...await import("../example/agents/ascon-zeta-r3kg/ou.js"),
  ...await import("../example/agents/ascon-zeta-r3kg/agent.js") };
const a = await import("../example/agents/ascon-zeta-r3k/agent.js");

let receiptBlock: bigint | undefined;
let originalRunDir: string | undefined;
let originalStateDir: string | undefined;
let testStateDir: string | undefined;
beforeEach(() => {
  receiptBlock = undefined;
  originalRunDir = process.env.ERIS_RUN_DIR;
  delete process.env.ERIS_RUN_DIR;
  originalStateDir = process.env.ERIS_AGENT_STATE_DIR;
  persistentState();
  g.resetOuStateForTest();
});
afterEach(() => {
  if (originalRunDir === undefined) delete process.env.ERIS_RUN_DIR;
  else process.env.ERIS_RUN_DIR = originalRunDir;
  if (originalStateDir === undefined) delete process.env.ERIS_AGENT_STATE_DIR;
  else process.env.ERIS_AGENT_STATE_DIR = originalStateDir;
  if (testStateDir) rmSync(testStateDir, { recursive: true, force: true });
  testStateDir = undefined;
  g.resetOuStateForTest();
});
function persistentState(): string {
  if (testStateDir) rmSync(testStateDir, { recursive: true, force: true });
  testStateDir = mkdtempSync(join(tmpdir(), "ascon-zeta-r3kg-state-"));
  process.env.ERIS_AGENT_STATE_DIR = testStateDir;
  return join(testStateDir, "ascon-zeta-r3kg-ou-state.json");
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
    agentId: "ascon-zeta-r3kg",
    address: "0x0000000000000000000000000000000000000001",
    publicClient: {
      getTransactionReceipt: async () => {
        if (receiptBlock === undefined) throw new Error("no receipt");
        return { status: "success", blockNumber: receiptBlock };
      },
      readContract: async () => 0n,
    } as unknown as AgentContext["publicClient"],
    // Explicit bounded test profile permits simultaneous orders; default 10M per-tx is tested separately.
    config: { maxTxGas: 2_000_000n, maxAgentBlockGas: 10_000_000n } as AgentContext["config"],
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

async function warmup(opts: Parameters<typeof obsFor>[0] = {}): Promise<void> {
  for (let block = 98; block <= 100; block++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ ...opts, block }))), []);
}

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
  orderGasWei: 10_000_000_000_000_000n,
  closeReserveWei: 80_000_000_000_000_000n,
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
  // ETH cannot cover the entry transaction plus both future closes.
  const dry = g.ouPlan({ ...base, fair: LOW, position: undefined, ethWei: 70_000_000_000_000_000n });
  assert.equal(dry.action, undefined);
});

// ---------------------------------------------------------------------------
// pending orders, reversal, end of epoch (through decide, with the module's own memory)
// ---------------------------------------------------------------------------

test("pending: an unreflected increase never expires without cancellation evidence", async () => {
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

test("pending: execution evidence releases the intent, with confirmation before re-entry", async () => {
  const log = runtimeLog();
  g.resetOuStateForTest();
  await warmup();
  assert.equal(gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW }))).length, 1);
  await emitted(obsFor({ block: 102, fairWeth: LOW }));
  settleOrder(log, 101, "gmxIncrease", 103);
  // Mined and removed from the order set at block 103: positioned, nothing more.
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

test("reversal: decrease all now, opposite increase after terminal evidence and flat confirmation", async () => {
  const log = runtimeLog();
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
  settleOrder(log, 110, "gmxDecrease", 112);
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
// inside the band r3kg is r3k
// ---------------------------------------------------------------------------

test("inside the band r3kg emits exactly r3k's actions", async () => {
  g.resetOuStateForTest();
  // A sequence that makes r3k act (a cross-venue dislocation, an inventory edge) and not act,
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
  assert.ok(acted >= 2, `the sequence must exercise r3k's own actions (acted in ${acted})`);
});


test("reload: durable intent prevents another increase during the fill window", async () => {
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

test("emission: logging/submit failures preserve r3k's return and uncertain intents persist", async () => {
  const path = persistentState();
  await warmup();
  const ctx = fakeCtx();
  ctx.log = () => { throw new Error("injected log failure"); };
  const observation = obsFor({ block: 101, fairWeth: LOW });
  assert.deepEqual(await g.decide(observation, ctx), await a.decide(observation, fakeCtx()));
  assert.equal(gmxOnly(ctx.submitted as Act[]).length, 1);
  let saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.bases.find((b: Act) => b.base === "WETH").pending.sentBlock, 101);

  g.resetOuStateForTest();
  for (let block = 200; block < 203; block++) await emitted(obsFor({ block }));
  const failing = fakeCtx();
  failing.submit = () => { throw new Error("injected submit failure"); };
  const next = obsFor({ block: 203, fairWeth: LOW, fairWbtc: 60_000 * 1.02 });
  assert.deepEqual(await g.decide(next, failing), await a.decide(next, fakeCtx()));
  saved = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(saved.bases.every((b: Act) => b.pending !== undefined));
  assert.equal(gmxOnly(await emitted(obsFor({ block: 204, fairWeth: LOW,
    fairWbtc: 60_000 * 1.02 }))).length, 0);
});

test("persistence: corrupt or unwritable state fails closed", async () => {
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

test("risk: loss threshold is strict and closes either side with execution fee and gas", async () => {
  for (const side of [1, -1]) {
    persistentState();
    g.resetOuStateForTest();
    const fairWeth = side > 0 ? LOW : 3000 * 1.019;
    const atThreshold = { ...pos(side * 40_000), pnlUsd: -5000 };
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 100, fairWeth,
      wethPos: atThreshold }))), []);
    const out = gmxOnly(await emitted(obsFor({ block: 101, fairWeth,
      wethPos: { ...atThreshold, pnlUsd: -5000.01 },
      blocksRemaining: 6, ethWei: "40000000000000000" })));
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

test("ETH: close requires 0.04 including gas; entry also retains 0.08 for both closes", () => {
  for (const ethWei of [40_000_000_000_000_000n, 60_000_000_000_000_000n,
    119_999_999_999_999_999n]) {
    const d = g.ouPlan({ ...base, fair: 3060, position: pos(40_000) as never, ethWei });
    assert.equal(d.action?.type, "gmxDecrease");
    assert.equal(g.ouPlan({ ...base, fair: LOW, position: undefined, ethWei }).action, undefined);
  }
  assert.equal(g.ouPlan({ ...base, fair: 3060, position: pos(40_000) as never,
    ethWei: 39_999_999_999_999_999n }).action, undefined);
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

test("epoch: discontinuities retain pending and anchor until an explicit epoch change", async () => {
  const path = persistentState();
  for (const nextBlock of [10, 200]) {
    g.resetOuStateForTest();
    for (const block of [98, 99, 100]) await emitted(obsFor({ block }));
    await emitted(obsFor({ block: 101, fairWeth: LOW }));
    g.resetOuStateForTest();
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block: nextBlock, fairWeth: 2700 }))), []);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.epoch.key, "start:98");
    const weth = saved.bases.find((b: Act) => b.base === "WETH");
    assert.equal(weth.anchor, 3000);
    assert.equal(weth.pending.sentBlock, 101);
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block: nextBlock + 1, fairWeth: 2650 }))), []);
    assert.equal(gmxOnly(await emitted(obsFor({ block: nextBlock + 2, fairWeth: 2650 }))).length, 0);
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
  const log = runtimeLog();
  await warmup();
  const high = 3057;
  const first = gmxOnly(await emitted(obsFor({ block: 101, fairWeth: high, wethPos: pos(40_000) })));
  assert.equal(first[0]?.type, "gmxDecrease");
  g.resetOuStateForTest();
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 102, fairWeth: high }))), []);
  assert.deepEqual(gmxOnly(await emitted(obsFor({ block: 103, fairWeth: high, wethPos: pos(40_000) }))), []);
  settleOrder(log, 101, "gmxDecrease", 104);
  for (const block of [104, 105])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: high }))), []);
  const opposite = gmxOnly(await emitted(obsFor({ block: 106, fairWeth: high })));
  assert.equal(opposite[0]?.type, "gmxIncrease");
  assert.equal(opposite[0]?.isLong, false);
});

import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ascon-zeta-r-logs.json", import.meta.url), "utf8"));
let serial = 0;
const SWITCHES = ["K1_SINGLE_LEG_FLOOR", "K2_BUNDLE_BRAKE", "K3_LARGE_EDGE_BID"] as const;
type Switch = typeof SWITCHES[number];

// Loads an agent directory as its own module graph. `off` turns r3k switches off in the loaded copy
// only (the file on disk is not touched); whatever value the file has, the copy gets `false`.
async function load(id: string, off: Switch[] = [], ouOff = false): Promise<{ agent: any; delta: any; brake: any; ou: any }> {
  const files = id === "ascon-zeta-r3kg" ? ["launchSwap", "brake", "delta", "launch", "ou", "agent"] : id === "ascon-zeta-r3k" ? ["launchSwap", "brake", "delta", "launch", "agent"] : ["launchSwap", "delta", "launch", "agent"];
  const own: Record<string, string> = {};
  for (const file of files) {
    let source = readFileSync(resolve(root, `example/agents/${id}/${file}.ts`), "utf8");
    if (file === "ou" && ouOff) source = source.replace("export const M_OU_ENABLED = true;", "export const M_OU_ENABLED = false;");
    if (file === "delta") for (const name of off) {
      const re = new RegExp(`export const ${name} = (true|false);`);
      assert.equal(source.split(re).length, 3, `${name} must be declared exactly once`);
      source = source.replace(re, `export const ${name} = false;`);
    }
    source = source.replace(/from "([^"]+)"/g, (match, spec: string) => {
      if (spec.startsWith("@eris/sdk")) {
        const suffix = spec === "@eris/sdk" ? "index.ts" : spec.slice("@eris/sdk/".length).replace(/\.js$/, ".ts");
        return `from ${JSON.stringify(pathToFileURL(resolve(root, "sdk/src", suffix)).href)}`;
      }
      if (spec.startsWith("./")) return `from ${JSON.stringify(own[spec.slice(2, -3)])}`;
      if (spec.startsWith("../lib/")) return `from ${JSON.stringify(pathToFileURL(resolve(root, "example/agents/lib", spec.slice(7).replace(/\.js$/, ".ts"))).href)}`;
      if (spec === "viem") return `from ${JSON.stringify(import.meta.resolve("viem"))}`;
      return match;
    });
    own[file] = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source + `\n// isolated ${serial++}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText).toString("base64");
  }
  return { agent: await import(own.agent), delta: await import(own.delta), ou: own.ou ? await import(own.ou) : undefined, brake: own.brake ? await import(own.brake) : undefined };
}
// A context whose chain must not be touched.
const noRpc = { publicClient: new Proxy({}, { get() { throw new Error("offline replay must not use RPC"); } }), log() {} } as unknown as AgentContext;

const ME = "0x1111111111111111111111111111111111111111";
// WETH only, Uniswap (30 bps pool) and Curve (two-sided, 30 bps half-spread), no Liquity and no launch,
// so agent.decide falls through to delta. Prices are set per case.
function obs(o: { block?: number; uni: number; curve?: number; curveFee?: number; usdc?: bigint; rival?: string | null; max?: string }): AgentObservation {
  const x = structuredClone(fixture.windows[0].frames[0].observation);
  const block = o.block ?? 100;
  x.blockNumber = String(block); x.round = block; x.blocksRemaining = 200;
  x.agentAddress = ME;
  x.enabledProtocols = ["uniswap", "curve"];
  x.registry = { entries: [] };
  x.fairPriceUsdcPerWeth = 3000; x.fairPricesUsd = { WETH: 3000 }; x.baseBalances = {}; x.baseDecimals = { WETH: 18 };
  x.balances = { usdcUnits: String(o.usdc ?? 20_000_000_000n), wethWei: String(8n * 10n ** 18n), ethWei: String(10n ** 18n) };
  x.protocols = { uniswap: { pool: { priceUsdcPerWeth: o.uni, fee: 3000 } } };
  if (o.curve !== undefined) x.protocols.curve = { priceUsdcPerWeth: o.curve, buyPriceUsdcPerWeth: o.curve,
    sellPriceUsdcPerWeth: o.curve, effectiveHalfSpreadBps: o.curveFee ?? 30 };
  if (o.rival === null) delete x.competition; else x.competition = { maxCompetitorPriorityFeeWei: o.rival ?? "6000000000" };
  x.limits = { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: o.max ?? "1000000000000000000", defaultSlippageBps: 50 };
  return x as AgentObservation;
}
// Gross gap |fair/mid - 1| of a single venue against fair 3000.
const below = (bps: number) => 3000 / (1 + bps / 10000);
// Bundle shapes: net edge = spread - (30 + 30 + 50) bps.
const SMALL_EDGE = { uni: 2976, curve: 3023.6 }; // spread 160 bps, net 50 bps; venue gaps 81 / 78 bps
const LARGE_EDGE = { uni: 2960, curve: 3040 }; // spread 270 bps, net 160 bps
const brief = (a: any) => a.type === "bundle" ? `bundle:${a.actions.map((l: any) => `${l.type}:${l.tokenIn}`).join("+")}`
  : a.type === "noop" ? `noop:${a.reason}` : `${a.type}:${a.tokenIn}`;

// ---------------- switched off = r3 ----------------

const synthetic = (): AgentObservation[] => [
  obs({ uni: below(100) }), obs({ uni: below(124) }), obs({ uni: below(130) }), obs({ uni: 3000 / 0.985 }),
  obs({ uni: below(400), usdc: 400_000_000_000n, rival: "50000000000" }),
  obs({ ...SMALL_EDGE }), obs({ ...LARGE_EDGE }), obs({ ...LARGE_EDGE, usdc: 100_000_000_000n, rival: "50000000000" }),
  obs({ ...LARGE_EDGE, usdc: 100_000_000_000n, rival: "0" }), obs({ ...LARGE_EDGE, usdc: 100_000_000_000n, rival: null }),
  obs({ uni: 2990, curve: 3000 / 1.013, curveFee: 50 }),
];


test("OU disabled: r3kg decisions equal r3k on all 32 real-log and 11 synthetic fixtures", async () => {
  let count = 0;
  for (const window of fixture.windows) {
    const reference = await load("ascon-zeta-r3k"), candidate = await load("ascon-zeta-r3kg", [], true);
    assert.equal(candidate.ou.M_OU_ENABLED, false);
    for (const { observation } of window.frames) {
      assert.deepEqual(await candidate.agent.decide(structuredClone(observation), noRpc),
        await reference.agent.decide(structuredClone(observation), noRpc));
      count++;
    }
  }
  for (const observation of synthetic()) {
    const reference = await load("ascon-zeta-r3k"), candidate = await load("ascon-zeta-r3kg", [], true);
    assert.deepEqual(await candidate.agent.decide(structuredClone(observation), noRpc),
      await reference.agent.decide(structuredClone(observation), noRpc));
    count++;
  }
  assert.equal(count, 43);
  const disabled = await load("ascon-zeta-r3kg", [], true);
  const reference = await load("ascon-zeta-r3k");
  for (let block = 100; block <= 103; block++) {
    const observation = obsFor({ block, fairWeth: LOW, fairWbtc: 61_200 });
    const ctx = fakeCtx();
    assert.deepEqual(await disabled.agent.decide(observation, ctx), await reference.agent.decide(observation, fakeCtx()));
    assert.deepEqual(ctx.submitted, [], "disabled despite confirmed OU signals on both bases");
  }
});

test("OU enabled: r3k action unchanged, all OU orders appear only via submit", async () => {
  const reference = await load("ascon-zeta-r3k"), candidate = await load("ascon-zeta-r3kg");
  assert.equal(candidate.ou.M_OU_ENABLED, true);
  for (let block = 98; block <= 100; block++) {
    await candidate.agent.decide(obsFor({ block }), fakeCtx());
    await reference.agent.decide(obsFor({ block }), fakeCtx());
  }
  const observation = obsFor({ block: 101, fairWeth: LOW, uniMid: LOW / 1.04, curveMid: LOW * 1.04 });
  const before = structuredClone(observation);
  const ctx = fakeCtx();
  const result = await candidate.agent.decide(observation, ctx);
  const original = await reference.agent.decide(structuredClone(observation), fakeCtx());
  assert.equal(original.type, "bundle", "non-vacuous active r3k trade");
  assert.deepEqual(result, original, "r3k action unchanged");
  assert.deepEqual(observation, before, "no observation mutation");
  assert.equal(ctx.submitted.length, 1);
  assert.equal((ctx.submitted[0] as Act).type, "gmxIncrease");
  // Inactivity is also returned unchanged; OU never replaces even a noop.
  persistentState();
  candidate.ou.resetOuStateForTest();
  for (let block = 200; block <= 202; block++) await candidate.agent.decide(obsFor({ block }), fakeCtx());
  const idle = obsFor({ block: 203, fairWeth: LOW });
  const idleCtx = fakeCtx();
  assert.deepEqual(await candidate.agent.decide(idle, idleCtx), await reference.agent.decide(idle, fakeCtx()));
  assert.equal(idleCtx.submitted.length, 1);
});

test("USDC reserve: original balance protects the largest next r3k trade, both bases and current spend", async () => {
  for (const balance of [0n, 4_000n, 7_000n, 12_000n, 25_000n, 40_000n, 100_000n]) {
    const units = balance * 1_000_000n;
    const expected = units / 4n > 5_000_000_000n ? units / 4n : 5_000_000_000n;
    assert.equal(g.ouUsdcReserve(units), expected);
    const d = g.ouPlan({ ...base, fair: LOW, position: undefined, usdcFreeUnits: units });
    assert.ok(d.usdcSpent <= (units > expected ? units - expected : 0n));
  }
  await warmup();
  const observation = obsFor({ block: 101, fairWeth: LOW, fairWbtc: 61_200,
    uniMid: LOW / 1.04, curveMid: LOW * 1.04 });
  const ctx = fakeCtx();
  const returned = await g.decide(observation, ctx) as { type: string; actions: Act[] };
  assert.equal(returned.type, "bundle");
  const spent = returned.actions.filter(x => x.tokenIn === "USDC")
    .reduce((sum, x) => sum + BigInt(String(x.amountIn)), 0n);
  const collateral = (ctx.submitted as Act[]).reduce((sum, x) => sum + BigInt(String(x.collateralAmount)), 0n);
  assert.equal(spent, 6_250_000_000n);
  assert.equal(collateral, 12_500_000_000n, "10k WETH + 2.5k WBTC collateral");
  assert.equal(25_000_000_000n - spent - collateral, 6_250_000_000n, "USDC reserve, not just the $5k floor");
});

test("runtime gas capacity: a typical r3k bundle permits OU under explicit 2M per-tx / 10M block limits", async () => {
  const candidate = await load("ascon-zeta-r3kg"), reference = await load("ascon-zeta-r3k");
  for (let block = 100; block <= 102; block++) {
    const ctx = fakeCtx();
    const observation = obsFor({ block, fairWeth: LOW, uniMid: LOW / 1.04, curveMid: LOW * 1.04 });
    const original = await reference.agent.decide(structuredClone(observation), fakeCtx());
    const before = structuredClone(original);
    assert.equal(original.type, "bundle");
    assert.deepEqual(await candidate.agent.decide(observation, ctx), before, "r3k return unchanged");
    assert.deepEqual(original, before);
    assert.equal(ctx.submitted.length, block === 102 ? 1 : 0, "OU submits once confirmation completes");
    if (block === 102) assert.equal((ctx.submitted[0] as Act).type, "gmxIncrease");
  }
});

test("runtime gas capacity: realistic total over budget waits without changing r3k or marking pending", async () => {
  const candidate = await load("ascon-zeta-r3kg"), reference = await load("ascon-zeta-r3k");
  // Two swap ceilings and one OU ceiling reserve exactly 6M gas.
  for (let block = 100; block <= 104; block++) {
    const ctx = fakeCtx();
    ctx.config.maxAgentBlockGas = block <= 102 ? 1_000_000n : block === 103 ? 5_999_999n : 6_000_000n;
    const observation = obsFor({ block, fairWeth: LOW, uniMid: LOW / 1.04, curveMid: LOW * 1.04 });
    const original = await reference.agent.decide(structuredClone(observation), fakeCtx());
    assert.equal(original.type, "bundle");
    assert.deepEqual(await candidate.agent.decide(observation, ctx), original);
    if (block < 104) assert.deepEqual(ctx.submitted, [], "both an over-budget total and insufficient margin wait");
    else {
      assert.equal(ctx.submitted.length, 1, "waiting did not create a phantom pending order");
      assert.equal((ctx.submitted[0] as Act).type, "gmxIncrease");
    }
  }
});

test("runtime gas capacity: cumulative legs, two OU orders, per-tx cap and opaque actions", () => {
  const ctx = fakeCtx(), observation = obsFor();
  const swap = { type: "swap", tokenIn: "USDC", amountIn: "1" };
  const bundle = { type: "bundle", actions: [swap, { type: "curveSwap", tokenIn: "WETH", amountIn: "1" }] };
  const before = structuredClone(bundle);
  assert.equal(g.ouBudget(observation, ctx, bundle).slots, 2);
  ctx.config.maxAgentBlockGas = 4_000_000n;
  assert.equal(g.ouBudget(observation, ctx, swap).slots, 1);
  assert.equal(g.ouBudget(observation, ctx, bundle).slots, 0, "reserve every bundle leg");
  ctx.config.maxAgentBlockGas = 8_000_000n;
  assert.equal(g.ouBudget(observation, ctx, bundle).slots, 2, "two orders including margin fit exactly");
  ctx.config.maxAgentBlockGas--;
  assert.equal(g.ouBudget(observation, ctx, bundle).slots, 1);
  ctx.config.maxAgentBlockGas = 0n;
  assert.equal(g.ouBudget(observation, ctx, bundle).slots, 2, "zero disables the per-block cap in send.ts");
  ctx.config.maxTxGas = 1_124_499n;
  assert.equal(g.ouBudget(observation, ctx, null).slots, 2, "finite enforced cap bounds accepted transactions");
  ctx.config.maxTxGas++;
  assert.equal(g.ouBudget(observation, ctx, null).slots, 2);
  assert.equal(g.ouBudget(observation, fakeCtx(), { type: "rawTx", tx: { data: "0x" } }).slots, 0);
  assert.equal(g.ouBudget(observation, fakeCtx(), { type: "unknown" }).slots, 0);
  assert.deepEqual(bundle, before, "budget calculation never mutates r3k's action");
});

test("final five blocks suppress risk exits too, but retain the no-reentry latch", async () => {
  const observation = obsFor({ block: 100, fairWeth: LOW, blocksRemaining: 5,
    wethPos: { ...pos(40_000), pnlUsd: -6000 } });
  for (const remaining of [5, 4, 1, 0]) {
    observation.blocksRemaining = remaining;
    assert.deepEqual(gmxOnly(await emitted(observation)), []);
  }
  for (let block = 101; block <= 104; block++)
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
});


test("pending across bases: unreflected collateral and fees cannot be spent again", async () => {
  await warmup();
  const first = fakeCtx();
  await g.decide(obsFor({ block: 101, fairWeth: LOW, usdc: "16000000000" }), first);
  assert.equal((first.submitted[0] as Act)?.collateralAmount, "10000000000");
  // Same observed balance while the WETH increase is in flight: no funding for WBTC.
  const next = fakeCtx();
  await g.decide(obsFor({ block: 102, fairWeth: LOW, fairWbtc: 61_200, usdc: "16000000000" }), next);
  assert.deepEqual(next.submitted, []);
});

test("partial submit: first intent survives second-submit failure and real module reload", async () => {
  const path = persistentState();
  const first = await load("ascon-zeta-r3kg");
  for (let block = 98; block <= 100; block++) await first.agent.decide(obsFor({ block }), fakeCtx());
  const ctx = fakeCtx();
  ctx.submit = x => {
    if (ctx.submitted.length) throw new Error("second submit failed");
    ctx.submitted.push(x);
  };
  const observation = obsFor({ block: 101, fairWeth: LOW, fairWbtc: 61_200 });
  const reference = await load("ascon-zeta-r3k");
  assert.deepEqual(await first.agent.decide(observation, ctx), await reference.agent.decide(observation, fakeCtx()));
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.bases.find((b: Act) => b.base === "WETH").pending.sentBlock, 101);
  assert.equal(saved.bases.find((b: Act) => b.base === "WBTC").pending.sentBlock, 101);
  const reloaded = await load("ascon-zeta-r3kg");
  for (const block of [102, 103]) {
    const next = fakeCtx();
    await reloaded.agent.decide(obsFor({ block, fairWeth: 2700, fairWbtc: 61_200 }), next);
    assert.deepEqual(next.submitted, []);
  }
  const next = fakeCtx();
  await reloaded.agent.decide(obsFor({ block: 104, fairWeth: 2700, fairWbtc: 61_200 }), next);
  assert.equal(next.submitted.length, 0, "throwing submit retains uncertain intent");
});

test("repeated block does not give OU another gas slot", async () => {
  await warmup();
  const observation = obsFor({ block: 101, fairWeth: LOW, fairWbtc: 61_200 });
  const first = fakeCtx(); first.config.maxAgentBlockGas = 2_000_000n;
  await g.decide(observation, first);
  assert.equal(first.submitted.length, 1);
  const repeat = fakeCtx(); repeat.config.maxAgentBlockGas = 2_000_000n;
  await g.decide(observation, repeat);
  assert.deepEqual(repeat.submitted, []);
});

// Review regressions: each test was run against the pre-fix implementation.
test("review ETH: reserve base gas and both future closes before opening", () => {
  const ctx = fakeCtx();
  const observation = obsFor({ ethWei: "110000000000000000" });
  const budget = g.ouBudget(observation, ctx, { type: "swap", tokenIn: "WETH", amountIn: "1", maxPriorityFeePerGasWei: "5000000000" });
  assert.ok(budget.ethWei < 110000000000000000n, "base gas must be deducted");
  const d = g.ouPlan({ ...base, fair: LOW, position: undefined, ethWei: 80000000000000000n,
    orderGasWei: 1000000000000000n, closeReserveWei: 62000000000000000n });
  assert.equal(d.action, undefined, "opening must retain two execution fees plus close gas");
});

test("review gap: pending intent and risk latch survive skipped blocks and reload", async () => {
  persistentState();
  await warmup();
  assert.equal(gmxOnly(await emitted(obsFor({ block: 101, fairWeth: LOW }))).length, 1);
  g.resetOuStateForTest();
  for (const block of [110, 111, 112, 113])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), [], "live intent survives gap");
  // Separate epoch: latch without submitting a close, then skip and reload.
  await emitted(obsFor({ block: 200, runId: "risk", fairWeth: LOW, ethWei: "0", wethPos: { ...pos(40000), pnlUsd: -6000 } }));
  g.resetOuStateForTest();
  for (const block of [210, 211, 212])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, runId: "risk", fairWeth: LOW }))), [], "stop survives gap");
});

test("review persistence: absent storage blocks increases and intent is durable before submit", async () => {
  delete process.env.ERIS_AGENT_STATE_DIR;
  for (const block of [100, 101, 102, 103])
    assert.deepEqual(gmxOnly(await emitted(obsFor({ block, fairWeth: LOW }))), []);
  const path = persistentState(); g.resetOuStateForTest();
  await warmup();
  const ctx = fakeCtx();
  ctx.submit = action => {
    const state = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(state.bases.find((b: Act) => b.base === "WETH").pending?.sentBlock, 101);
    ctx.submitted.push(action);
  };
  await g.decide(obsFor({ block: 101, fairWeth: LOW }), ctx);
  assert.equal(ctx.submitted.length, 1, "write-ahead intent visible inside submit");
});

test("review pending: terminal execution evidence releases a partial fill for risk exit", () => {
  const pending = { kind: "increase" as const, sentBlock: 99, expectSignedUsd: 40000 };
  const args = { ...base, fair: LOW, position: { ...pos(20000), pnlUsd: -6000 }, pending, riskStopped: true };
  assert.equal(g.ouPlan(args).action, undefined, "unknown/live order still blocks duplicate");
  const d = g.ouPlan({ ...args, pendingTerminal: true });
  assert.equal(d.action?.type, "gmxDecrease");
  assert.equal(d.action?.sizeDeltaUsd, (20000n * E30).toString());
});

test("review gas: reserve enforceable transaction caps, not measured estimates", () => {
  const ctx = fakeCtx(); ctx.config.maxTxGas = 10000000n; ctx.config.maxAgentBlockGas = 10000000n;
  const bundle = { type: "bundle", actions: [{ type: "swap", tokenIn: "USDC", amountIn: "1" }, { type: "curveSwap", tokenIn: "WETH", amountIn: "1" }] };
  assert.equal(g.ouBudget(obsFor(), ctx, bundle).slots, 0, "OU cannot consume the base bundle fallback capacity");
  ctx.config.maxTxGas = 0n;
  assert.equal(g.ouBudget(obsFor(), ctx, null).slots, 0, "unbounded gas fails closed");
});

test("review recovery: unacknowledged wrap and sell do not starve liquidation", async () => {
  const candidate = await load("ascon-zeta-r3kg");
  const ctx = fakeCtx();
  ctx.publicClient = { getTransactionCount: async () => 0 } as any;
  const make = (block: number, eth: string) => {
    const o = obsFor({ block, ethWei: eth });
    o.protocols.liquity = { suggestedGasReserveWei: "1000000000000000000", eusdBalanceWei: "0", spDepositEusdWei: "0", mcr: 1.1 } as any;
    return o;
  };
  const params = { launch: false, redemption: true, stabilityPool: true };
  await candidate.agent.decideWithParams(make(100, "1000000000000000000"), params, ctx);
  assert.equal((await candidate.agent.decideWithParams(make(101, "2000000000000000000"), params, ctx)).type, "rawTx");
  const next = make(102, "2000000000000000000");
  Object.assign(next.protocols.liquity!, { spDepositEusdWei: String(300n * 10n ** 18n), riskiestTrove: { owner: ME, icr: 1 } });
  assert.equal((await candidate.agent.decideWithParams(next, params, ctx)).type, "liquityLiquidate");
});

function runtimeLog(): string {
  process.env.ERIS_RUN_DIR = testStateDir!;
  mkdirSync(join(testStateDir!, "agents"));
  const path = join(testStateDir!, "agents", "ascon-zeta-r3kg.jsonl");
  writeFileSync(path, "");
  return path;
}

test("pending evidence: rejected decrease retries, mined partial increase exits only after orders clear", async () => {
  const log = runtimeLog();
  const ctx = fakeCtx();
  const losing = { ...pos(40000), pnlUsd: -6000 };
  await g.submitOu(obsFor({ block: 100, wethPos: losing }), ctx, null);
  assert.equal(ctx.submitted.length, 1);
  appendFileSync(log, JSON.stringify({ kind: "mempool", event: "rejected",
    action: parseAction(ctx.submitted[0]) }) + "\n");
  await g.submitOu(obsFor({ block: 101, wethPos: losing }), ctx, null);
  assert.equal(ctx.submitted.length, 2, "explicit rejection permits risk-exit retry");

  // New run: successful order creation, partial position, live order still present.
  for (const block of [200, 201, 202]) await g.submitOu(obsFor({ block, runId: "partial" }), ctx, null);
  await g.submitOu(obsFor({ block: 203, runId: "partial", fairWeth: LOW }), ctx, null);
  assert.equal(ctx.submitted.length, 3);
  appendFileSync(log, JSON.stringify({ kind: "mempool", event: "submitted", blockSeen: 203,
    actionType: "gmxIncrease", hash: "0x" + "ab".repeat(32) }) + "\n");
  let live = 1n;
  ctx.publicClient = { getTransactionReceipt: async () => ({ status: "success", blockNumber: 204n }),
    readContract: async (args: any) => { assert.equal(args.functionName, "getBytes32Count"); assert.ok(args.blockNumber >= 204n); return live; } } as any;
  const partial = { ...pos(20000), pnlUsd: -6000 };
  await g.submitOu(obsFor({ block: 204, runId: "partial", fairWeth: LOW, wethPos: partial }), ctx, null);
  assert.equal(ctx.submitted.length, 3, "live order cannot be assumed cancelled");
  live = 0n;
  await g.submitOu(obsFor({ block: 205, runId: "partial", fairWeth: LOW, wethPos: partial }), ctx, null);
  assert.equal(ctx.submitted.length, 4);
  assert.equal((ctx.submitted[3] as Act).type, "gmxDecrease");
  assert.equal((ctx.submitted[3] as Act).sizeDeltaUsd, (20000n * E30).toString());
});

test("ETH integration: two signals cannot spend the ETH reserved for both closes", async () => {
  for (const block of [100, 101]) await g.submitOu(obsFor({ block }), fakeCtx(), null);
  const ctx = fakeCtx();
  await g.submitOu(obsFor({ block: 102, fairWeth: LOW, fairWbtc: 61200,
    ethWei: "110000000000000000" }), ctx, null);
  assert.equal(ctx.submitted.length, 0, "0.11 cannot fund a 0.04 entry plus 0.08 closing reserve");
  await g.submitOu(obsFor({ block: 103, fairWeth: LOW, fairWbtc: 61200,
    ethWei: "160000000000000000" }), ctx, null);
  assert.equal(ctx.submitted.length, 2, "0.16 covers two entries and both closes including gas");
});

test("persistence: a write failure after successful load prevents submit and reload duplication", async () => {
  const path = join(testStateDir!, "ascon-zeta-r3kg-ou-state.json");
  await warmup();
  mkdirSync(path + ".tmp"); // force the next atomic write to fail
  const ctx = fakeCtx();
  await g.submitOu(obsFor({ block: 101, fairWeth: LOW }), ctx, null);
  assert.deepEqual(ctx.submitted, []);
  g.resetOuStateForTest();
  for (const block of [110, 111, 112]) await g.submitOu(obsFor({ block, fairWeth: LOW }), ctx, null);
  assert.deepEqual(ctx.submitted, []);
});

function settleOrder(log: string, sentBlock: number, actionType: string, included: number): void {
  appendFileSync(log, JSON.stringify({ kind: "mempool", event: "submitted", blockSeen: sentBlock,
    actionType, hash: "0x" + "ab".repeat(32) }) + "\n");
  receiptBlock = BigInt(included);
}

test("recovery evidence: rejected wrap and reverted sell release retries without starving other work", async () => {
  const log = runtimeLog();
  for (const kind of ["wrap", "sell"] as const) {
    const candidate = await load("ascon-zeta-r3kg");
    const ctx = fakeCtx();
    ctx.publicClient = {
      getTransactionCount: async () => 0,
      simulateContract: async () => ({ result: [3000_000000n] }),
      getTransactionReceipt: async () => ({ status: "reverted", blockNumber: 103n }),
    } as any;
    const params = { launch: false, redemption: true, stabilityPool: true };
    const make = (block: number, eth: bigint, weth = 8n) => {
      const o = obsFor({ block, ethWei: String(eth * 10n ** 18n) });
      o.balances.wethWei = String(weth * 10n ** 18n);
      o.competition = { maxCompetitorPriorityFeeWei: "0", maxBlockPriorityFeeWei: "0", lastTxIndex: null, recentRevertRate: 0, recentSampleSize: 0 };
      o.protocols.liquity = { suggestedGasReserveWei: String(10n ** 18n), eusdBalanceWei: "0", spDepositEusdWei: "0", mcr: 1.1 } as any;
      return o;
    };
    await candidate.agent.decideWithParams(make(100, 1n), params, ctx);
    const wrap = await candidate.agent.decideWithParams(make(101, 2n), params, ctx);
    assert.equal(wrap.type, "rawTx");
    let action = wrap;
    if (kind === "wrap") {
      await candidate.agent.decideWithParams(make(102, 2n), params, ctx);
      await candidate.agent.decideWithParams(make(103, 2n), params, ctx);
    }
    if (kind === "sell") {
      action = await candidate.agent.decideWithParams(make(102, 1n, 9n), params, ctx);
      assert.equal(action.type, "swap");
      // Unchanged balances and no terminal evidence must still allow liquidation.
      const unknown = make(103, 1n, 9n);
      Object.assign(unknown.protocols.liquity!, { spDepositEusdWei: String(300n * 10n ** 18n), riskiestTrove: { owner: ME, icr: 1 } });
      assert.equal((await candidate.agent.decideWithParams(unknown, params, ctx)).type, "liquityLiquidate");
    }
    appendFileSync(log, JSON.stringify({ kind: "mempool", event: kind === "wrap" ? "rejected" : "submitted",
      blockSeen: kind === "wrap" ? 101 : 102, actionType: action.type,
      ...(kind === "sell" ? { hash: "0x" + "cd".repeat(32) } : {}) }) + "\n");
    const next = make(104, kind === "wrap" ? 2n : 1n, kind === "wrap" ? 8n : 9n);
    Object.assign(next.protocols.liquity!, { spDepositEusdWei: String(300n * 10n ** 18n), riskiestTrove: { owner: ME, icr: 1 } });
    assert.equal((await candidate.agent.decideWithParams(next, params, ctx)).type, "liquityLiquidate");
    const retry = await candidate.agent.decideWithParams(make(105, kind === "wrap" ? 2n : 1n, kind === "wrap" ? 8n : 9n), params, ctx);
    assert.equal(retry.type, kind === "wrap" ? "rawTx" : "swap");
  }
});

test("audit gas: open-position risk exit has capacity before base candidates", async t => {
  for (const market of ["WETH", "WBTC"] as const) await t.test(market, async () => {
    persistentState();
    const candidate = await load("ascon-zeta-r3kg");
    const ctx = fakeCtx();
    ctx.config.maxAgentBlockGas = 2_000_000n;
    const observation = obsFor({ uniMid: 2800, curveMid: 3200,
      ...(market === "WETH" ? { wethPos: { ...pos(40000), pnlUsd: -6000 } }
        : { wbtcPos: { ...pos(40000), pnlUsd: -6000 } }) });
    const returned = await candidate.agent.decide(observation, ctx);
    assert.equal(ctx.submitted.length, 1, `${market} risk exit must have the sole gas slot`);
    assert.equal((ctx.submitted[0] as Act).type, "gmxDecrease");
    assert.equal((ctx.submitted[0] as Act).base, market);
    assert.equal(returned.type, "noop", "base cannot spend the reserved exit capacity");
  });
});

test("audit reserve: base wraps, sells and bundles preserve every open position's closing ETH", async t => {
  for (const kind of ["wrap", "sell", "bundle"] as const) await t.test(kind, async () => {
    for (const count of [1, 2]) {
      persistentState();
      const candidate = await load("ascon-zeta-r3kg");
      const ctx = fakeCtx();
      ctx.publicClient = { getTransactionCount: async () => 0 } as any;
      const reserve = BigInt(count) * 40_000_000_000_000_000n; // 0.03 fee + 2M * 5gwei
      const make = (block: number, eth: bigint) => {
        const o = obsFor({ block, ethWei: String(eth), wethPos: pos(40000),
          ...(count === 2 ? { wbtcPos: pos(40000) } : {}),
          uniMid: kind === "bundle" ? 2800 : kind === "sell" ? 3200 : 3000,
          curveMid: kind === "bundle" || kind === "sell" ? 3200 : 3000 });
        if (kind === "wrap") o.protocols.liquity = { suggestedGasReserveWei: "10000000000000000",
          eusdBalanceWei: "0", spDepositEusdWei: "0", mcr: 1.1 } as any;
        return o;
      };
      if (kind === "wrap") await candidate.agent.decide(make(100, 10_000_000_000_000_000n), ctx);
      const eth = kind === "wrap" ? 200_000_000_000_000_000n : reserve;
      const o = make(101, eth), before = structuredClone(o);
      if (kind !== "wrap") {
        const reference = await load("ascon-zeta-r3k");
        const original = await reference.agent.decide(structuredClone(o), fakeCtx());
        assert.equal(original.type, kind === "bundle" ? "bundle" : "curveSwap");
        if (kind === "sell") assert.equal(original.tokenIn, "WETH");
      }
      const action = await candidate.agent.decide(o, ctx);
      if (kind === "wrap") assert.equal(action.type, "rawTx", "a funded wrap remains available");
      const legs = action.type === "bundle" ? action.actions : action.type === "noop" ? [] : [action];
      const spend = legs.reduce((sum: bigint, leg: any) => sum + BigInt(leg.tx?.value ?? 0) + 10_000_000_000_000_000n, 0n);
      assert.ok(eth - spend >= reserve, `${kind}/${count}: base must retain ${reserve}, left ${eth - spend}`);
      assert.deepEqual(o, before, "planning must not mutate the caller's observation");
    }
  });
});
