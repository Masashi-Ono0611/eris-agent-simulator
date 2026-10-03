import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import type { AgentObservation } from "@eris/sdk";
import {
  DEFAULT_PARAMS,
  decide,
  decideWith,
  newState,
  priorityBid,
} from "../example/agents/sonnet-2/agent.js";
import { decide as multiDecide } from "../example/agents/multi-arb/agent.js";
import { loadImproveAgent } from "../example/agents/runtime/improve.js";

const FEE = 100_000_000n; // 0.10 gwei
const CAP = 5_000_000_000n; // 5 gwei

type Opts = {
  cheap?: number;
  rich?: number;
  fair?: number;
  wbtc?: boolean;
  usdc?: string;
  weth?: string;
  wbtcBal?: string;
  ethWei?: string;
  block?: number;
  remaining?: number;
  fee?: string;
  cap?: string | undefined;
};

function obs(o: Opts = {}): AgentObservation {
  const cheap = o.cheap ?? 3000;
  const rich = o.rich ?? cheap;
  const fair = o.fair ?? 3000;
  const protocols: any = {
    uniswap: { pool: { priceUsdcPerWeth: cheap, fee: 3000 } },
    balancer: {
      priceUsdcPerWeth: rich,
      sellPriceUsdcPerWeth: rich * 0.997,
      buyPriceUsdcPerWeth: rich * 1.003,
      effectiveHalfSpreadBps: 30,
    },
  };
  const fairPricesUsd: Record<string, number> = { WETH: fair };
  const baseDecimals: Record<string, number> = {};
  const baseBalances: Record<string, string> = { WBTC: o.wbtcBal ?? "40000000" };
  if (o.wbtc) {
    protocols.uniswap.markets = { "WBTC/USDC": { priceUsdcPerWeth: cheap * 20, fee: 3000 } };
    protocols.balancer.markets = {
      "WBTC/USDC": {
        priceUsdcPerWeth: rich * 20,
        sellPriceUsdcPerWeth: rich * 20 * 0.997,
        buyPriceUsdcPerWeth: rich * 20 * 1.003,
        effectiveHalfSpreadBps: 30,
      },
    };
    fairPricesUsd.WBTC = fair * 20;
    baseDecimals.WBTC = 8;
  }
  const limits: Record<string, string> = {
    defaultPriorityFeePerGasWei: o.fee ?? FEE.toString(),
  };
  if (o.cap !== undefined || !("cap" in o)) limits.maxPriorityFeePerGasWei = o.cap ?? CAP.toString();
  return {
    kind: "observation",
    blockNumber: String(o.block ?? 100),
    blocksRemaining: o.remaining ?? 200,
    balances: {
      ethWei: o.ethWei ?? "1000000000000000000",
      usdcUnits: o.usdc ?? "25000000000",
      wethWei: o.weth ?? "8000000000000000000",
      stables: {},
    },
    baseBalances,
    baseDecimals,
    fairPriceUsdcPerWeth: fair,
    fairPricesUsd,
    limits,
    protocols,
  } as unknown as AgentObservation;
}

const bidOf = (a: any): bigint => BigInt(a.maxPriorityFeePerGasWei);

function strip(a: any): any {
  const { maxPriorityFeePerGasWei: _f, ...rest } = a;
  return rest;
}

// ---- self-containment and baked-in configuration ----

test("agent files import only lib/ and runtime/ siblings and read no environment", async () => {
  const dir = new URL("../example/agents/sonnet-2/", import.meta.url);
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".ts")) continue;
    const src = await readFile(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /from\s+["']\.\.\/(?!lib\/|runtime\/)/, f);
    assert.doesNotMatch(src, /process\.env|process\.argv/, f);
  }
});

test("the shipped parameters are the ones adopted (pinned, no env override)", () => {
  assert.deepEqual(DEFAULT_PARAMS, {
    SAFETY_MARGIN_BPS: 50,
    MIN_SIZE_BPS: 250,
    MAX_SIZE_BPS: 2500,
    SPREAD_GAIN: 200_000,
    GAP_GAIN: 200_000,
    LEG_SLIPPAGE_BPS: 120,
    SINGLE_SLIPPAGE_BPS: 75,
    CAPTURE_BPS: 5000,
    BID_SHARE_BPS: 2000,
    BID_STEP_BPS: 5000,
    EPOCH_PREMIUM_BUDGET_USDC: 50,
    GAS_PER_LEG: 200_000,
    INVENTORY_BAND_BPS: 6000,
  });
});

test("prompt.md passes the submission checks", async () => {
  const agent = loadImproveAgent(
    new URL("../example/agents/sonnet-2/", import.meta.url).pathname,
  );
  assert.equal(agent.name, "sonnet-2");
  assert.equal(agent.reviseEveryBlocks, 60);
  for (const phrase of [
    "transactions since the last revision",
    "market history",
    "mean inclusion latency",
    "executorTs",
    "revertTo",
  ])
    assert.ok(agent.body.includes(phrase), phrase);
  assert.ok(!agent.body.includes("rolled back automatically"));
});

// ---- entry decisions are multi-arb's; only the fee differs ----

test("with bidding and the band off, decisions equal multi-arb exactly (2000 seeded observations)", () => {
  let seed = 0x5eed2026;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const off = { ...DEFAULT_PARAMS, BID_SHARE_BPS: 0, INVENTORY_BAND_BPS: 0 };
  let bundles = 0;
  let singles = 0;
  for (let i = 0; i < 2000; i++) {
    const fair = 2500 + rand() * 1000;
    const o = obs({
      cheap: fair * (0.9 + rand() * 0.2),
      rich: fair * (0.9 + rand() * 0.2),
      fair,
      wbtc: rand() < 0.5,
      usdc: String(Math.floor(rand() * 50_000_000_000)),
      weth: String(BigInt(Math.floor(rand() * 16)) * 10n ** 18n),
      fee: "10",
      cap: "100",
    });
    const mine = decideWith(o, off, newState()).action as any;
    const ref = multiDecide(o) as any;
    assert.deepEqual(mine, ref, `case ${i}`);
    if (ref.type === "bundle") bundles++;
    else if (ref.type !== "noop") singles++;
  }
  assert.ok(bundles > 50 && singles > 50, `coverage: ${bundles} bundles, ${singles} singles`);
});

test("with default parameters only the priority fee differs from multi-arb, and stays within [default, cap]", () => {
  let seed = 0xb1d0b1d0;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  let bumped = 0;
  for (let i = 0; i < 1000; i++) {
    const fair = 2500 + rand() * 1000;
    const o = obs({
      cheap: fair * (0.9 + rand() * 0.2),
      rich: fair * (0.9 + rand() * 0.2),
      fair,
      wbtc: rand() < 0.5,
    });
    const mine = decideWith(o, DEFAULT_PARAMS, newState()).action as any;
    const ref = multiDecide(o) as any;
    assert.deepEqual(strip(mine), strip(ref), `case ${i}`);
    if (mine.type === "noop") continue;
    assert.ok(bidOf(mine) >= FEE && bidOf(mine) <= CAP, `case ${i}: ${mine.maxPriorityFeePerGasWei}`);
    if (bidOf(mine) > FEE) bumped++;
  }
  assert.ok(bumped > 50, `bumped ${bumped}`);
});

// ---- the bid schedule ----

test("a large single-leg edge bids above the default and reaches the cap", () => {
  const d = decideWith(obs({ cheap: 2970, fair: 3000 }), DEFAULT_PARAMS, newState());
  const a = d.action as any;
  assert.equal(a.tokenIn, "USDC");
  assert.equal(bidOf(a), CAP);
  assert.ok(d.premiumUsdc > 0);
  // the premium is within the share of expected profit
  assert.ok(d.premiumUsdc <= (DEFAULT_PARAMS.BID_SHARE_BPS / 10000) * d.expectedProfitUsdc + 1e-9);
});

test("a marginal single-leg edge bids strictly between the default and the cap, and rises with the edge", () => {
  const at = (cheap: number) => bidOf(decideWith(obs({ cheap, fair: 3000 }), DEFAULT_PARAMS, newState()).action);
  const small = at(2975); // ~84 bps gap, just past the entry threshold
  const larger = at(2972);
  assert.ok(small > FEE && small < CAP, `${small}`);
  assert.ok(larger > small && larger <= CAP, `${small} < ${larger}`);
});

test("no edge past the entry threshold means no action and no bid", () => {
  const d = decideWith(obs({ cheap: 2995, fair: 3000 }), DEFAULT_PARAMS, newState());
  assert.equal((d.action as any).type, "noop");
  assert.equal(d.premiumUsdc, 0);
});

test("priorityBid: a budget that cannot pay the minimum step bids the default", () => {
  const base = { fee: FEE, cap: CAP, ethUsd: 3000, legs: 1, budgetLeftUsdc: 1e9 };
  const tiny = priorityBid(DEFAULT_PARAMS, { ...base, expectedProfitUsdc: 0.05 });
  assert.equal(tiny.bidWei, FEE);
  assert.equal(tiny.premiumUsdc, 0);
  const ok = priorityBid(DEFAULT_PARAMS, { ...base, expectedProfitUsdc: 1 });
  assert.ok(ok.bidWei >= FEE + FEE / 2n, "at least the minimum step");
  assert.ok(ok.bidWei < CAP);
});

test("priorityBid: premium cost matches the gas model and never exceeds the share of profit", () => {
  const base = { fee: FEE, cap: CAP, ethUsd: 3000, legs: 1, budgetLeftUsdc: 1e9 };
  for (const profit of [0.5, 1, 2, 3.5, 20]) {
    const r = priorityBid(DEFAULT_PARAMS, { ...base, expectedProfitUsdc: profit });
    const gasUsdc = (Number(r.bidWei - FEE) * DEFAULT_PARAMS.GAS_PER_LEG * 1e-18) * 3000;
    assert.ok(Math.abs(gasUsdc - r.premiumUsdc) < 1e-9, `profit ${profit}`);
    assert.ok(r.premiumUsdc <= 0.2 * profit + 1e-9, `profit ${profit}: ${r.premiumUsdc}`);
  }
});

test("priorityBid: a two-leg bundle pays gas twice, so the same profit buys a smaller bump", () => {
  const base = { fee: FEE, cap: CAP, ethUsd: 3000, expectedProfitUsdc: 3, budgetLeftUsdc: 1e9 };
  const one = priorityBid(DEFAULT_PARAMS, { ...base, legs: 1 });
  const two = priorityBid(DEFAULT_PARAMS, { ...base, legs: 2 });
  assert.ok(two.bidWei < one.bidWei && two.bidWei > FEE, `${two.bidWei} < ${one.bidWei}`);
});

test("priorityBid: never above the cap; no cap or cap at the default means no bump", () => {
  const base = { fee: FEE, ethUsd: 3000, legs: 1, expectedProfitUsdc: 1e6, budgetLeftUsdc: 1e9 };
  assert.equal(priorityBid(DEFAULT_PARAMS, { ...base, cap: CAP }).bidWei, CAP);
  assert.equal(priorityBid(DEFAULT_PARAMS, { ...base, cap: FEE }).bidWei, FEE);
  assert.equal(priorityBid(DEFAULT_PARAMS, { ...base, cap: 1n }).bidWei, FEE);
  const d = decideWith(obs({ cheap: 2970, fair: 3000, cap: undefined }), DEFAULT_PARAMS, newState());
  assert.equal(bidOf(d.action), FEE, "missing cap in observation");
});

test("priorityBid: an unaffordable ETH balance limits the bid to what can be reserved", () => {
  const base = { fee: FEE, cap: CAP, ethUsd: 3000, legs: 1, expectedProfitUsdc: 1e6, budgetLeftUsdc: 1e9 };
  // reserve = 1 leg x 1.5M gas x 2; 1.2e15 wei of ETH => at most 4e8 wei/gas
  const r = priorityBid(DEFAULT_PARAMS, { ...base, ethWei: 1_200_000_000_000_000n });
  assert.ok(r.bidWei <= 400_000_000n && r.bidWei >= FEE, `${r.bidWei}`);
  assert.equal(priorityBid(DEFAULT_PARAMS, { ...base, ethWei: 0n }).bidWei, FEE);
});

test("tiny fee units (obs limits of 10 / 100 wei) still produce a valid bid in range", () => {
  const d = decideWith(obs({ cheap: 2970, fair: 3000, fee: "10", cap: "100" }), DEFAULT_PARAMS, newState());
  const b = bidOf(d.action);
  assert.ok(b >= 10n && b <= 100n, `${b}`);
});

// ---- the epoch premium budget ----

test("the epoch premium budget is spent down, then every trade bids the default", () => {
  const state = newState();
  const p = { ...DEFAULT_PARAMS, EPOCH_PREMIUM_BUDGET_USDC: 5 };
  let block = 100;
  let atCap = 0;
  let spent = 0;
  for (; block < 140; block++) {
    const d = decideWith(obs({ cheap: 2970, fair: 3000, block }), p, state);
    spent += d.premiumUsdc;
    if (bidOf(d.action) > FEE) atCap++;
  }
  assert.ok(spent <= 5 + 1e-9, `spent ${spent}`);
  assert.ok(atCap >= 1 && atCap < 40, `${atCap} bumped blocks`);
  const after = decideWith(obs({ cheap: 2970, fair: 3000, block }), p, state);
  assert.equal(bidOf(after.action), FEE);
  assert.equal(after.premiumUsdc, 0);
});

test("deciding the same block twice does not double-count its premium", () => {
  const state = newState();
  const p = { ...DEFAULT_PARAMS, EPOCH_PREMIUM_BUDGET_USDC: 1000 };
  const first = decideWith(obs({ cheap: 2970, fair: 3000, block: 200 }), p, state);
  const again = decideWith(obs({ cheap: 2970, fair: 3000, block: 200 }), p, state);
  assert.equal(again.premiumUsdc, first.premiumUsdc);
  decideWith(obs({ cheap: 2970, fair: 3000, block: 201 }), p, state);
  assert.ok(Math.abs(state.committedUsdc - first.premiumUsdc) < 1e-9);
});

test("a rewind (new epoch in the same process) resets the budget", () => {
  const state = newState();
  const p = { ...DEFAULT_PARAMS, EPOCH_PREMIUM_BUDGET_USDC: 4 };
  for (let b = 300; b < 320; b++) decideWith(obs({ cheap: 2970, fair: 3000, block: b, remaining: 400 - b }), p, state);
  assert.equal(bidOf(decideWith(obs({ cheap: 2970, fair: 3000, block: 320, remaining: 80 }), p, state).action), FEE);
  const fresh = decideWith(obs({ cheap: 2970, fair: 3000, block: 50, remaining: 360 }), p, state);
  assert.ok(bidOf(fresh.action) > FEE, "budget restored after the block number went backwards");
});

// ---- guards ----

test("inventory band: no further buying at the upper edge, no further selling at the lower edge", () => {
  const buyAtTop = decideWith(
    obs({ cheap: 2900, fair: 3000, weth: "12800000000000000000", wbtcBal: "64000000" }),
    DEFAULT_PARAMS,
    newState(),
  ).action as any;
  assert.equal(buyAtTop.type, "noop");
  const sellAtBottom = decideWith(
    obs({ cheap: 3100, fair: 3000, weth: "3200000000000000000", wbtcBal: "16000000" }),
    DEFAULT_PARAMS,
    newState(),
  ).action as any;
  assert.equal(sellAtBottom.type, "noop");
  // inside the band the same observation trades
  const inside = decideWith(obs({ cheap: 2900, fair: 3000 }), DEFAULT_PARAMS, newState()).action as any;
  assert.equal(inside.type, "swap");
});

test("inventory band trims a buy to the room left and handles 8-decimal WBTC", () => {
  // WETH 12.0 of an upper limit 12.8: room 0.8 WETH, about 2,320 USDC at 2,900
  const a = decideWith(
    obs({ cheap: 2900, fair: 3000, weth: "12000000000000000000", wbtcBal: "64000000" }),
    DEFAULT_PARAMS,
    newState(),
  ).action as any;
  assert.equal(a.tokenIn, "USDC");
  assert.ok(Number(a.amountIn) / 1e6 <= 0.8 * 2900 + 1, `${a.amountIn}`);
  // WBTC sell is capped to the room above the lower limit (0.4 BTC -> floor 0.16 BTC)
  const w = decideWith(
    obs({ cheap: 3100, fair: 3000, wbtc: true, weth: "3200000000000000000", wbtcBal: "20000000" }),
    DEFAULT_PARAMS,
    newState(),
  ).action as any;
  assert.equal(w.base, "WBTC");
  assert.equal(w.tokenIn, "WBTC");
  assert.ok(BigInt(w.amountIn) <= 20_000_000n - 16_000_000n, `${w.amountIn}`);
});

test("legs are always fundable: a sell never exceeds the base balance, a buy never exceeds USDC", () => {
  for (const o of [
    obs({ cheap: 3100, fair: 3000, weth: "1000000000000000" }),
    obs({ cheap: 2900, fair: 3000, usdc: "1000000" }),
    obs({ cheap: 2800, rich: 3300, usdc: "5000000" }),
  ]) {
    const a = decideWith(o, DEFAULT_PARAMS, newState()).action as any;
    if (a.type === "noop") continue;
    const leg = a.type === "bundle" ? a.actions[0] : a;
    if (leg.tokenIn === "USDC") assert.ok(BigInt(leg.amountIn) <= BigInt((o.balances as any).usdcUnits));
    else assert.ok(BigInt(leg.amountIn) <= BigInt((o.balances as any).wethWei));
  }
});

test("garbage observations return a noop instead of throwing", () => {
  for (const o of [{}, null, { balances: {} }, { limits: {}, balances: { usdcUnits: "x" } }]) {
    const d = decideWith(o as any, DEFAULT_PARAMS, newState());
    assert.equal((d.action as any).type, "noop");
  }
});

test("decide logs the premium and works without a ctx", () => {
  const logged: any[] = [];
  const a = decide(obs({ cheap: 2970, fair: 3000, block: 900 }), { log: (e) => logged.push(e) }) as any;
  assert.equal(a.type, "swap");
  assert.equal(logged.length, 1);
  assert.equal(typeof logged[0].signals.premiumUsdc, "number");
  assert.doesNotThrow(() => decide(obs({ cheap: 2970, fair: 3000, block: 901 })));
  assert.doesNotThrow(() => decide(obs(), { log: () => { throw new Error("boom"); } }));
});
