process.env.ERIS_LOCAL_DEPLOY = "1";

import test, { beforeEach, afterEach } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { AgentContext } from "@eris/sdk/agent.js";

const { parseAction, validateAction } = await import("@eris/sdk/action.js");
const g = await import("../example/agents/opus-1w/agent.js");
const { m0Plan } = await import("../example/agents/m0/m0.js");
const { marketViews } = await import("../example/agents/lib/markets.js");
const a = await import("../example/agents/opus-1a/agent.js");

let originalStateDir: string | undefined;
let testStateDir: string | undefined;
beforeEach(() => {
  originalStateDir = process.env.ERIS_AGENT_STATE_DIR;
  delete process.env.ERIS_AGENT_STATE_DIR;
  g.resetM0StateForTest();
});
afterEach(() => {
  if (originalStateDir === undefined) delete process.env.ERIS_AGENT_STATE_DIR;
  else process.env.ERIS_AGENT_STATE_DIR = originalStateDir;
  if (testStateDir) rmSync(testStateDir, { recursive: true, force: true });
  testStateDir = undefined;
  g.resetM0StateForTest();
});
function persistentState(): string {
  testStateDir = mkdtempSync(join(tmpdir(), "opus-1w-state-"));
  process.env.ERIS_AGENT_STATE_DIR = testStateDir;
  return join(testStateDir, "opus-1w-m0-state.json");
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
  const gmxOn = opts.gmx ?? false;
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
    agentId: "opus-1w",
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


function planned(before: AgentObservation, now: AgentObservation) {
  const initial = m0Plan(before, marketViews(before), undefined, { pendingOwnTxs: 0 });
  return m0Plan(now, marketViews(now), initial.state, { pendingOwnTxs: 0 });
}

test("whale sends the exact single-leg M0 plan once, with no RPC", async () => {
  persistentState();
  const before = obsFor();
  const now = obsFor({ block: 101, uniMid: 2700 });
  await emitted(before);
  const plan = planned(before, now);
  assert.equal(plan.actions.length, 1);
  const ctx = fakeCtx();
  ctx.publicClient = new Proxy({}, { get() { throw new Error("unexpected RPC"); } }) as AgentContext["publicClient"];
  const action = await g.decide(now, ctx);
  assert.deepEqual(action, plan.actions[0]);
  assert.equal(validateAction(parseAction(action), now, {
    ethWei: BigInt(now.balances.ethWei), wethWei: BigInt(now.balances.wethWei),
    usdcUnits: BigInt(now.balances.usdcUnits),
  }).ok, true);
  const path = join(testStateDir!, "opus-1w-m0-state.json"); // simulate worker replacement
  g.resetM0StateForTest();
  await emitted(before);
  await emitted(now);
  g.resetM0StateForTest();
  assert.ok(!(await emitted(obsFor({ block: 102, uniMid: 2700 }))).some(x => JSON.stringify(x) === JSON.stringify(plan.actions[0])));
  const state = JSON.parse(readFileSync(path, "utf8")).state;
  assert.equal(state.order.beforeBaseUnits, "8000000000000000000");
  assert.equal(state.whales["WETH:uniswap:buy"].attempted, true);
  assert.equal(state.position.tag, "m0:whale:WETH:101");
  assert.ok(!(await emitted(now)).some(x => JSON.stringify(x) === JSON.stringify(plan.actions[0])));
});

test("no M0 signal preserves opus-1a's actions, including an active inventory trade", async () => {
  for (const o of [obsFor(), obsFor({ block: 101, uniMid: 2960, curveMid: 2960 })])
    assert.deepEqual(await emitted(o), await emitted(o, a.decide));
});

test("incident sends the planner's sized action and persists its one-shot cooldown", async () => {
  const path = persistentState();
  const observations = [obsFor(), obsFor({ block: 101, fairWeth: 3036, uniMid: 3000, curveMid: 3000 }),
    obsFor({ block: 102, fairWeth: 3036, uniMid: 3000, curveMid: 3000 })];
  let state;
  for (const o of observations) {
    const plan = m0Plan(o, marketViews(o), state, { pendingOwnTxs: 0 });
    state = plan.state;
    const actions = await emitted(o);
    if (plan.actions.length) assert.deepEqual(actions[0], plan.actions[0]);
  }
  assert.equal(state?.incidents.WETH.attempted, true);
  g.resetM0StateForTest();
  await emitted(obsFor({ block: 103, fairWeth: 3036, uniMid: 3000, curveMid: 3000 }));
  assert.equal(JSON.parse(readFileSync(path, "utf8")).state.incidents.WETH.firstBlock, 101);
});

test("epoch change resets whale and incident state and permits a fresh whale", async () => {
  const path = persistentState();
  const epoch = (index: number) => ({ index, count: 2 }) as AgentObservation["epoch"];
  await emitted(obsFor({ epoch: epoch(0) }));
  await emitted(obsFor({ block: 101, uniMid: 2700, epoch: epoch(0) }));
  await emitted(obsFor({ block: 102, epoch: epoch(1) }));
  const state = JSON.parse(readFileSync(path, "utf8")).state;
  assert.deepEqual(state.whales, {});
  assert.deepEqual(state.incidents, {});
  assert.equal(state.order, undefined);
  const now = obsFor({ block: 103, uniMid: 2700, epoch: epoch(1) });
  assert.deepEqual((await emitted(now))[0], planned(obsFor({ block: 102, epoch: epoch(1) }), now).actions[0]);
});

test("M0 bid obeys the observation fee cap", async () => {
  persistentState();
  const before = obsFor();
  await emitted(before);
  const now = obsFor({ block: 101, uniMid: 2700 });
  now.limits.maxPriorityFeePerGasWei = "7";
  now.competition = { maxCompetitorPriorityFeeWei: "1000000000" } as AgentObservation["competition"];
  assert.equal((await emitted(now))[0].maxPriorityFeePerGasWei, "7");
});

test("conflicting cross-venue bundle is dropped in full; independent ETH wrap is unchanged", async () => {
  persistentState();
  await emitted(obsFor());
  const now = obsFor({ block: 101, uniMid: 2700 });
  assert.ok((await emitted(now, a.decide)).some(x => x.type === "bundle"));
  const actions = await emitted(now);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "swap");
  g.resetM0StateForTest();
  await emitted(obsFor());
  const wrap = obsFor({ block: 101, uniMid: 2700, ethWei: "10000000000000000000", blocksRemaining: 3 });
  const base = await emitted(wrap, a.decide);
  const independent = base.find(x => x.type === "rawTx");
  assert.ok(independent);
  assert.deepEqual((await emitted(wrap)).find(x => x.type === "rawTx"), independent);
});

test("corrupt durable state fails closed for M0 while the base arm still runs", async () => {
  const path = persistentState();
  writeFileSync(path, "invalid-json");
  await emitted(obsFor());
  const now = obsFor({ block: 101, uniMid: 2700 });
  assert.deepEqual(await emitted(now), await emitted(now, a.decide));
});

test("planner copy and frozen prompt stay identical to their sources", () => {
  assert.equal(readFileSync("example/agents/opus-1w/m0.ts", "utf8"), readFileSync("example/agents/m0/m0.ts", "utf8"));
  assert.equal(readFileSync("example/agents/opus-1w/prompt.md", "utf8"),
    readFileSync("example/agents/opus-1a/prompt.md", "utf8").replace("name: opus-1a", "name: opus-1w"));
});


test("observed fill reconciles after restart and emits M0's single-leg restore", async () => {
  const path = persistentState();
  await emitted(obsFor());
  await emitted(obsFor({ block: 101, uniMid: 2700 }));
  const state = JSON.parse(readFileSync(path, "utf8")).state;
  const filled = BigInt(state.order.beforeBaseUnits) + BigInt(state.order.expectedBaseUnits);
  const restore = obsFor({ block: 102, uniMid: 3300, curveMid: 3300 });
  restore.balances.wethWei = filled.toString();
  restore.baseBalances!.WETH = filled.toString();
  const expected = m0Plan(restore, marketViews(restore), state, { pendingOwnTxs: 0 });
  assert.equal(expected.actions.length, 1);
  assert.equal(expected.actions[0].tokenIn, "WETH");
  g.resetM0StateForTest();
  assert.deepEqual((await emitted(restore))[0], expected.actions[0]);
});

test("M0 requires durable storage while base actions remain available", async () => {
  const before = obsFor();
  const now = obsFor({ block: 101, uniMid: 2700 });
  assert.equal(planned(before, now).actions.length, 1);
  await emitted(before);
  assert.deepEqual(await emitted(now), await emitted(now, a.decide));
});

test("failure saving a pending intent suppresses M0 and preserves the base", async () => {
  const path = persistentState();
  await emitted(obsFor());
  mkdirSync(`${path}.tmp`); // deterministic write failure, even with elevated permissions
  const now = obsFor({ block: 101, uniMid: 2700 });
  assert.deepEqual(await emitted(now), await emitted(now, a.decide));
  assert.equal(JSON.parse(readFileSync(path, "utf8")).state.order, undefined);
});

test("pending M0 isolates its pair across restart and releases it after three blocks", async () => {
  const path = persistentState();
  await emitted(obsFor());
  await emitted(obsFor({ block: 101, uniMid: 2700 }));
  for (const block of [102, 103]) {
    g.resetM0StateForTest();
    const now = obsFor({ block, uniMid: 2700, ethWei: "10000000000000000000" });
    const base = await emitted(now, a.decide);
    assert.ok(base.some(x => x.type === "bundle"));
    const actions = await emitted(now);
    assert.ok(!actions.some(x => x.type === "bundle"), "pending pair must be held back");
    assert.deepEqual(actions, base.filter(x => x.type === "rawTx"), "independent wrap survives");
    assert.ok(JSON.parse(readFileSync(path, "utf8")).state.order);
  }
  g.resetM0StateForTest();
  const expired = obsFor({ block: 104, uniMid: 2700 });
  assert.deepEqual(await emitted(expired), await emitted(expired, a.decide));
  assert.equal(JSON.parse(readFileSync(path, "utf8")).state.order, undefined);
});


test("pending WETH intent permits WBTC trades sharing USDC and blocks WETH sells", async () => {
  persistentState();
  await emitted(obsFor());
  await emitted(obsFor({ block: 101, uniMid: 2700 }));
  const now = obsFor({ block: 102, uniMid: 3300, curveMid: 3300 });
  now.protocols!.uniswap!.markets = {
    "WBTC/USDC": { ...now.protocols!.uniswap!.pool!, priceUsdcPerWeth: 58000 },
  };
  const base = await emitted(now, a.decide);
  const btc = base.filter(x => x.base === "WBTC");
  assert.ok(btc.length > 0);
  assert.ok(base.some(x => x.tokenIn === "WETH"));
  assert.deepEqual(await emitted(now), btc);
});

test("partial fill expires across an observation gap without renewing the reservation", async () => {
  const path = persistentState();
  await emitted(obsFor());
  await emitted(obsFor({ block: 101, uniMid: 2700 }));
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.pendingUntil, 104);
  const partial = BigInt(saved.state.order.expectedBaseUnits) / 2n;
  const now = obsFor({ block: 104, uniMid: 3300, curveMid: 3300 });
  now.balances.wethWei = (BigInt(saved.state.order.beforeBaseUnits) + partial).toString();
  now.baseBalances!.WETH = now.balances.wethWei;
  g.resetM0StateForTest();
  assert.deepEqual(await emitted(now), await emitted(now, a.decide));
  const expired = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(expired.state.order, undefined);
  assert.equal(expired.pendingUntil, undefined);
  assert.equal(expired.state.position.baseUnits, partial.toString());
});
