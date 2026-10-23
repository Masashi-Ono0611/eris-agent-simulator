process.env.ERIS_LOCAL_DEPLOY = "1";

import test from "node:test";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { MarketView, AgentVenue } from "../example/agents/lib/markets.js";
import type { M0State, M0Params, M0Plan } from "../example/agents/m0/m0.js";

const m = await import("../example/agents/m0/m0.js");
const { validateAction } = await import("@eris/sdk/action.js");
const GWEI = 1_000_000_000n;
const BASE = 10n ** 18n;
const Q = 10n ** 6n;
const whale: M0Params = { mode: "whale", pendingOwnTxs: 0 };
const incident: M0Params = { mode: "incident", pendingOwnTxs: 0 };
type Options = {
  fair?: number; mid?: number; peer?: number; fee?: number; base?: string; decimals?: number;
  held?: bigint; cash?: bigint; v0?: number; depth?: number; rival?: bigint; maxBid?: bigint;
  protocol?: "uniswap" | "balancer" | "curve";
};
function fixture(block: number, o: Options = {}): { obs: AgentObservation; views: MarketView[] } {
  const fair = o.fair ?? 3000;
  const base = o.base ?? "WETH";
  const decimals = o.decimals ?? 18;
  const held = o.held ?? 8n * 10n ** BigInt(decimals);
  const protocol = o.protocol ?? "balancer";
  const v: AgentVenue = {
    protocol, swapType: protocol === "balancer" ? "balancerSwap" : protocol === "uniswap" ? "swap" : "curveSwap",
    price: o.mid ?? fair, feeBps: o.fee ?? 30,
  };
  const views: MarketView[] = [{
    base, fair, baseBalanceWei: held.toString(), baseDecimals: decimals,
    venues: [v, { protocol: protocol === "uniswap" ? "curve" : "uniswap", swapType: protocol === "uniswap" ? "curveSwap" : "swap",
      price: o.peer ?? fair, feeBps: 30 }],
  }];
  const ethFair = base === "WETH" ? fair : 3000;
  const amm = { priceUsdcPerWeth: v.price,
    reserves: { weth: held.toString(), usdc: Math.floor((o.depth ?? 750_000) * 1e6).toString() } };
  const obs: AgentObservation = {
    kind: "observation", runId: "m0-unit", round: block, blockNumber: String(block),
    agentAddress: "0x0000000000000000000000000000000000000001",
    fairPriceUsdcPerWeth: ethFair, fairPricesUsd: { WETH: ethFair, [base]: fair },
    oraclePrices: { wethUsd: ethFair, usdcUsd: 1 },
    baseBalances: { [base]: held.toString() }, baseDecimals: { [base]: decimals },
    balances: { ethWei: BASE.toString(), wethWei: (base === "WETH" ? held : 8n * BASE).toString(),
      usdcUnits: (o.cash ?? 25_000n * Q).toString() },
    inventory: { valueUsdc: o.v0 ?? 100_000, weth: 8, usdc: 25_000, eth: 1 },
    history: [], enabledProtocols: ["uniswap", "balancer", "curve"],
    limits: { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: (o.maxBid ?? 1000n * GWEI).toString(),
      defaultSlippageBps: 50 },
    protocols: { balancer: base === "WETH" ? amm : { priceUsdcPerWeth: 3000, markets: { [`${base}/USDC`]: amm } } },
    competition: { maxCompetitorPriorityFeeWei: (o.rival ?? GWEI).toString(),
      maxBlockPriorityFeeWei: "0", lastTxIndex: null, recentRevertRate: 0, recentSampleSize: 0 },
  };
  return { obs, views };
}
function plan(block: number, o: Options = {}, state?: M0State, params = whale): M0Plan {
  const f = fixture(block, o);
  return m.m0Plan(f.obs, f.views, state, params);
}
function baseline(o: Options = {}): M0State { return plan(100, o).state; }
function entry(o: Options = {}, params = whale): M0Plan {
  return plan(101, { mid: 2700, ...o }, baseline({ ...o, mid: o.fair ?? 3000, peer: o.fair ?? 3000 }), params);
}
function tradeLog(p: M0Plan) {
  const log = p.log.find(l => l.modelOutUnits !== undefined);
  assert.ok(log, JSON.stringify(p.log));
  return log;
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("fresh dislocation enters once; cold-start/stale dislocation never enters", () => {
  const cold = plan(100, { mid: 2700 });
  assert.equal(cold.actions.length, 0);
  assert.equal(plan(101, { mid: 2700 }, cold.state).actions.length, 0);
  const p = entry();
  assert.equal(p.actions.length, 1);
  // Simulate a reverted/dropped order: balance unchanged, no pending transactions.
  const reverted = plan(102, { mid: 2700 }, p.state);
  assert.equal(reverted.actions.length, 0);
  assert.equal(reverted.state.position, undefined);
  const clear = plan(103, {}, reverted.state);
  assert.equal(plan(104, { mid: 2700 }, clear.state).actions.length, 1);
});

test("350 bps threshold is net of fee, in both directions", () => {
  for (const side of ["buy", "sell"] as const) {
    const mid = (edgeBps: number) => side === "buy" ? 3000 * 0.997 / (1 + edgeBps / 10_000) :
      3000 * (1 + edgeBps / 10_000) / 0.997;
    assert.equal(entry({ mid: mid(349.99) }).actions.length, 0);
    assert.equal(entry({ mid: mid(350.01) }).actions.length, 1);
  }
});

test("whale gate is evaluated only at first detection, including pending deferral", () => {
  const p = plan(101, { mid: 2700 }, baseline(), { ...whale, pendingOwnTxs: 1 });
  assert.equal(p.actions.length, 0);
  assert.equal(p.state.whales["WETH:balancer:buy"].accepted, true);
  // Peer is now dislocated too: the already accepted whale must not be re-gated.
  assert.equal(plan(102, { mid: 2700, peer: 2800 }, p.state).actions.length, 1);
  const rejected = plan(101, { mid: 2700, peer: 2800 }, baseline());
  assert.equal(rejected.actions.length, 0);
  // Conversely, a rejected episode is not promoted just because peers returned to fair.
  assert.equal(plan(102, { mid: 2700 }, rejected.state).actions.length, 0);
});

test("whale gate rejects fair shocks and missing peers; explicit executable quotes include fees once", () => {
  assert.equal(plan(101, { mid: 2700, fair: 3050 }, baseline()).actions.length, 0);
  const f = fixture(101, { mid: 2700 });
  f.views[0].venues.length = 1;
  assert.equal(m.m0Plan(f.obs, f.views, baseline(), whale).actions.length, 0);
  const q = fixture(101, { mid: 2800 });
  q.views[0].venues[0].buyPrice = 2995;
  assert.equal(m.m0Plan(q.obs, q.views, baseline(), whale).actions.length, 0);
});

test("CP U* uses depth x0.8, maximizes modeled profit, and free USDC caps buying", () => {
  const p = entry({ cash: 1_000_000n * Q });
  const expected = 750_000 * 0.8 / 0.997 * (Math.sqrt(3000 * 0.997 / 2700) - 1);
  assert.ok(Math.abs(Number(p.actions[0].amountIn) / 1e6 - expected) < 1e-6);
  const f = fixture(101, { mid: 2700 });
  const cp = m.m0Cpmm(f.views[0], f.views[0].venues[0], "buy", 750_000);
  const profit = (u: number) => cp.output(u) * 3000 - u;
  assert.ok(profit(expected) > profit(expected * 0.9));
  assert.ok(profit(expected) > profit(expected * 1.1));
  const limited = entry({}, { ...whale, freeUsdcUnits: "1234000000" });
  assert.equal(limited.actions[0].amountIn, "1234000000");
  assert.equal(entry({ cash: 100n * Q }, { ...whale, freeUsdcUnits: (1_000_000n * Q).toString() }).actions[0].amountIn, (100n * Q).toString());
  assert.equal(entry({ cash: 0n }).actions.length, 0);
});

test("sell size is CP-optimal, bounded by free base, and never invents inventory", () => {
  const p = entry({ mid: 3300, held: 100n * BASE });
  const expected = 750_000 * 0.8 / 3300 / 0.997 * (Math.sqrt(3300 * 0.997 / 3000) - 1);
  assert.ok(Math.abs(Number(p.actions[0].amountIn) / 1e18 - expected) < 1e-12);
  assert.equal(p.actions[0].tokenIn, "WETH");
  const capped = entry({ mid: 3300 }, { ...whale, freeBaseUnits: { WETH: BASE.toString() } });
  assert.equal(capped.actions[0].amountIn, BASE.toString());
  assert.equal(entry({ mid: 3300, held: 0n }).actions.length, 0);
});

test("fair-based min-out translates to typed slippage, not a fixed quote haircut", () => {
  for (const mid of [2700, 3300]) {
    const p = entry({ mid });
    const a = p.actions[0];
    const l = tradeLog(p);
    const input = Number(a.amountIn) / (mid < 3000 ? 1e6 : 1e18);
    const fairUnits = BigInt(Math.floor((mid < 3000 ? input / 3000 * 1e18 : input * 3000 * 1e6)));
    assert.equal(l.fairMinOutUnits, fairUnits.toString());
    assert.ok(a.slippageBps > 60, `expected fair-derived allowance, got ${a.slippageBps}`);
    const effective = BigInt(l.modelOutUnits!) * BigInt(10_000 - a.slippageBps) / 10_000n;
    assert.ok(effective >= fairUnits);
    assert.ok(effective - fairUnits <= BigInt(l.modelOutUnits!) / 10_000n + 1n);
  }
  assert.equal(m.m0FairSlippage(1000n, 800n), 1000);
  assert.equal(m.m0FairSlippage(999n, 1000n), null);
  assert.equal(m.m0FairSlippage(0n, 0n), null);
});

test("bid adds exactly +1 wei after rival x1.2, even without a rival", () => {
  const { obs } = fixture(101, { rival: 1_234_567_891n });
  assert.equal(m.m0Bid(obs, 100_000), (1_234_567_891n * 6n / 5n + 1n).toString());
  obs.competition!.maxCompetitorPriorityFeeWei = "0";
  assert.equal(m.m0Bid(obs, 100_000), "1");
});

test("bid clamps at profit budget, 100 gwei and runtime max, never at a default-fee floor", () => {
  const { obs } = fixture(101, { rival: 600n * GWEI });
  assert.equal(m.m0Bid(obs, 100_000), "100000000000");
  assert.equal(m.m0Bid(obs, 0.01), BigInt(Math.floor(0.30 * 0.01 / 3000 / 140_000 * 1e18)).toString());
  obs.limits.maxPriorityFeePerGasWei = "77";
  assert.equal(m.m0Bid(obs, 100_000), "77");
  assert.equal(m.m0Bid(obs, 0), "0");
  const btc = fixture(101, { base: "WBTC", decimals: 8, fair: 60_000, rival: 600n * GWEI }).obs;
  assert.equal(m.m0Bid(btc, 1), BigInt(Math.floor(0.30 / 3000 / 140_000 * 1e18)).toString());
});

test("pending own transactions suppress entries and exits; unknown count fails closed", () => {
  for (const count of [1, 3, -1, NaN, undefined]) {
    assert.equal(entry({}, { ...whale, pendingOwnTxs: count as number }).actions.length, 0);
  }
  const p = entry();
  const held = 8n * BASE + BigInt(tradeLog(p).modelOutUnits!);
  const waiting = plan(102, { held, mid: 3200, peer: 3000 }, p.state, { ...whale, pendingOwnTxs: 1 });
  assert.equal(waiting.actions.length, 0);
  assert.ok(waiting.state.order);
});

test("actual fill creates a signed inventory tag; whale exit waits for fair-or-better execution", () => {
  const p = entry();
  assert.equal(p.state.position!.baseUnits, "0"); // planning is not a fill
  const bought = BigInt(tradeLog(p).modelOutUnits!);
  const held = 8n * BASE + bought;
  const hold = plan(102, { held, mid: 2990, peer: 2990 }, p.state);
  assert.equal(hold.state.position!.baseUnits, bought.toString());
  assert.equal(hold.actions.length, 0);
  const exit = plan(103, { held, mid: 3300, peer: 3000 }, hold.state);
  assert.equal(exit.actions.length, 1);
  assert.equal(exit.actions[0].tokenIn, "WETH");
  assert.equal(exit.actions[0].amountIn, bought.toString());
  assert.equal(exit.state.order!.phase, "exit");
  const l = tradeLog(exit);
  assert.ok(Number(l.modelOutUnits) / 1e6 / (Number(bought) / 1e18) >= 3000);
  const settled = plan(104, {}, exit.state);
  assert.equal(settled.state.position, undefined);
});

test("sell tags are negative, buy-to-cover closes them, and failed exits retain inventory", () => {
  const p = entry({ mid: 3300 });
  const sold = BigInt(p.actions[0].amountIn);
  const held = 8n * BASE - sold;
  const hold = plan(102, { held, mid: 3100, peer: 3100 }, p.state);
  assert.equal(hold.state.position!.baseUnits, (-sold).toString());
  const exit = plan(103, { held, mid: 2700 }, hold.state);
  assert.equal(exit.actions[0].tokenIn, "USDC");
  const covered = BigInt(tradeLog(exit).modelOutUnits!);
  assert.ok(covered >= sold, "rounding must cover the entire sold inventory");
  const closed = plan(104, { held: held + covered }, exit.state);
  assert.equal(closed.state.position, undefined);
  const failed = plan(104, { held, mid: 3100, peer: 3100 }, exit.state);
  assert.equal(failed.state.position!.baseUnits, (-sold).toString());
  assert.equal(failed.state.order, undefined);
});

test("existing whale inventory prevents taking the next whale before unwinding", () => {
  const p = entry();
  const held = 8n * BASE + BigInt(tradeLog(p).modelOutUnits!);
  const hold = plan(102, { held, mid: 2990, peer: 2990 }, p.state);
  const next = plan(103, { held, mid: 2700, peer: 2990 }, hold.state);
  assert.equal(next.actions.length, 0);
  assert.equal(next.state.position!.tag, p.state.position!.tag);
});

function incidentStart(params = incident, o: Options = {}): M0Plan {
  const a = plan(100, o, undefined, params);
  const b = plan(101, { ...o, fair: 3036, mid: 3000, peer: 3000 }, a.state, params);
  return plan(102, { ...o, fair: 3036, mid: 3000, peer: 3000 }, b.state, params);
}

test("incident requires two-block fair change >=100bps, not venue agreement", () => {
  const a = plan(100, {}, undefined, incident);
  const b = plan(101, { fair: 3012, mid: 3000, peer: 3000 }, a.state, incident);
  const c = plan(102, { fair: 3024, mid: 3000, peer: 3000 }, b.state, incident);
  assert.equal(c.actions.length, 0);
  assert.equal(c.state.incidents.WETH, undefined);
  const e = plan(102, { fair: 3036, mid: 3000, peer: 3000 }, b.state, incident);
  assert.equal(e.actions.length, 1);
  assert.equal(e.state.incidents.WETH.firstBlock, 101);
  assert.equal(e.state.incidents.WETH.attempted, true);
});

test("incident entry window is 1-3 blocks after first move, never same-block or late", () => {
  const a = plan(100, {}, undefined, incident);
  const b = plan(101, {}, a.state, incident);
  const first = plan(102, { fair: 3036, mid: 3000, peer: 3000 }, b.state, incident);
  assert.equal(first.actions.length, 0);
  assert.equal(first.state.incidents.WETH.firstBlock, 102);
  assert.equal(plan(103, { fair: 3036, mid: 3000, peer: 3000 }, first.state, incident).actions.length, 1);
  const wait = { ...incident, pendingOwnTxs: 1 };
  const at1 = plan(103, { fair: 3036, mid: 3000 }, first.state, wait);
  const at2 = plan(104, { fair: 3036, mid: 3000 }, at1.state, wait);
  assert.equal(plan(105, { fair: 3036, mid: 3000 }, at2.state, incident).actions.length, 1);
  const at3 = plan(105, { fair: 3036, mid: 3000 }, at2.state, wait);
  assert.equal(plan(106, { fair: 3036, mid: 3000 }, at3.state, incident).actions.length, 0);
});

test("incident skew cap is 0.4 V0 in base value, and min-out is fair minus 60bps", () => {
  const p = incidentStart(incident, { v0: 1000 });
  assert.equal(p.actions.length, 1);
  const l = tradeLog(p);
  const skew = Number(l.modelOutUnits) / 1e18 * 3036;
  assert.ok(skew <= 400);
  assert.ok(skew > 399.99);
  const expected = BigInt(Math.floor(Number(p.actions[0].amountIn) / 1e6 / 3036 * (1 - 60 / 10_000) * 1e18));
  assert.equal(l.fairMinOutUnits, expected.toString());
  assert.ok(BigInt(l.effectiveMinOutUnits!) >= expected);
});

test("incident accounts for existing skew rather than adding another 0.4 V0", () => {
  const a = plan(100, { v0: 1000 }, undefined, incident);
  const extra = BigInt(Math.floor(300 / 3036 * 1e18));
  const b = plan(101, { fair: 3036, mid: 3000, held: 8n * BASE + extra }, a.state, incident);
  const c = plan(102, { fair: 3036, mid: 3000, held: 8n * BASE + extra }, b.state, incident);
  assert.equal(c.actions.length, 1);
  assert.ok(Number(BigInt(tradeLog(c).modelOutUnits!) + extra) / 1e18 * 3036 <= 400);
});

test("incident downward fair move sells, using the same skew and fair-minimum caps", () => {
  const a = plan(100, { v0: 1000 }, undefined, incident);
  const b = plan(101, { fair: 2964, mid: 3000, peer: 3000 }, a.state, incident);
  const p = plan(102, { fair: 2964, mid: 3000, peer: 3000 }, b.state, incident);
  assert.equal(p.actions.length, 1);
  assert.equal(p.actions[0].tokenIn, "WETH");
  assert.ok(Number(p.actions[0].amountIn) / 1e18 * 2964 <= 400);
  assert.ok(Number(p.actions[0].amountIn) / 1e18 * 2964 > 399.99);
});

test("incident is one-shot even after revert or another threshold crossing", () => {
  const p = incidentStart();
  assert.equal(p.actions.length, 1);
  const next = plan(103, { fair: 3036, mid: 3000, peer: 3000 }, p.state, incident);
  assert.equal(next.actions.length, 0);
  const recover = plan(104, { fair: 3000, mid: 2990 }, next.state, incident);
  const again = plan(105, { fair: 3060, mid: 2990 }, recover.state, incident);
  assert.equal(again.actions.length, 0);
  assert.equal(again.state.incidents.WETH.firstBlock, 101);
});

test("incident exits only within 40bps executable fair, then never re-enters", () => {
  const p = incidentStart(incident, { v0: 1000 });
  const bought = BigInt(tradeLog(p).modelOutUnits!);
  const held = 8n * BASE + bought;
  const bad = plan(103, { fair: 3036, mid: 3000, peer: 3000, held }, p.state, incident);
  assert.equal(bad.actions.length, 0);
  const exit = plan(104, { fair: 3036, mid: 3036, peer: 3036, held }, bad.state, incident);
  assert.equal(exit.actions.length, 1);
  assert.equal(exit.actions[0].tokenIn, "WETH");
  const price = Number(tradeLog(exit).modelOutUnits!) / 1e6 / (Number(exit.actions[0].amountIn) / 1e18);
  assert.ok(Math.abs(price / 3036 - 1) * 10_000 <= 40);
  const close = plan(105, { fair: 3036 }, exit.state, incident);
  assert.equal(close.state.position, undefined);
  assert.equal(plan(106, { fair: 3090, mid: 3000, peer: 3000 }, close.state, incident).actions.length, 0);
});

test("incident sell position exits via buy-to-cover only within 40bps", () => {
  const a = plan(100, { v0: 1000 }, undefined, incident);
  const b = plan(101, { fair: 2964, mid: 3000, peer: 3000 }, a.state, incident);
  const p = plan(102, { fair: 2964, mid: 3000, peer: 3000 }, b.state, incident);
  const sold = BigInt(p.actions[0].amountIn);
  const held = 8n * BASE - sold;
  const hold = plan(103, { fair: 2964, mid: 3000, peer: 3000, held }, p.state, incident);
  assert.equal(hold.actions.length, 0);
  const exit = plan(104, { fair: 2964, mid: 2964, peer: 2964, held }, hold.state, incident);
  assert.equal(exit.actions[0].tokenIn, "USDC");
  const price = Number(exit.actions[0].amountIn) / 1e6 / (Number(tradeLog(exit).modelOutUnits!) / 1e18);
  assert.ok(Math.abs(price / 2964 - 1) * 10_000 <= 40);
});

test("a market missing from a block breaks both freshness and the two-block fair trail", () => {
  const a = baseline();
  const { obs } = fixture(101);
  const absent = m.m0Plan(obs, [], a, whale);
  assert.equal(plan(102, { mid: 2700 }, absent.state).actions.length, 0);
  assert.equal(plan(102, { fair: 3060, mid: 3000 }, absent.state, incident).actions.length, 0);
});

test("tagged exit dust is not blocked by the entry notional floor", () => {
  const state = baseline();
  state.position = { tag: "m0:whale:dust", mode: "whale", base: "WETH", baseUnits: "100000000000000" };
  const p = plan(101, { held: 8n * BASE + 100000000000000n, mid: 3300 }, state);
  assert.equal(p.actions[0].amountIn, "100000000000000");
  assert.equal(p.state.order!.phase, "exit");
});

test("epoch reset discards tags, attempts, anchors and fair history; duplicate calls are inert", () => {
  const p = entry();
  const duplicate = plan(101, { mid: 2700 }, p.state);
  assert.equal(duplicate.actions.length, 0);
  assert.deepEqual(duplicate.state, p.state);
  for (const block of [1, 103]) {
    const reset = plan(block, { v0: 1234, held: BASE, mid: 2700 }, p.state);
    assert.equal(reset.actions.length, 0);
    assert.equal(reset.state.position, undefined);
    assert.equal(reset.state.order, undefined);
    assert.equal(reset.state.v0, 1234);
    assert.equal(reset.state.anchors.WETH, BASE.toString());
    assert.equal(reset.state.fairTrail.WETH.length, 1);
    assert.deepEqual(reset.state.incidents, {});
  }
  const f = fixture(102);
  f.obs.runId = "another-run";
  assert.equal(m.m0Plan(f.obs, f.views, p.state, whale).state.position, undefined);
  f.obs.runId = "m0-unit";
  f.obs.epoch = { index: 2, count: 60 };
  assert.equal(m.m0Plan(f.obs, f.views, p.state, whale).state.position, undefined);
});

test("incident latch resets on discontinuity, allowing a new epoch's incident", () => {
  const p = incidentStart();
  const a = plan(1, {}, p.state, incident);
  assert.deepEqual(a.state.incidents, {});
  const b = plan(2, { fair: 3036, mid: 3000, peer: 3000 }, a.state, incident);
  assert.equal(plan(3, { fair: 3036, mid: 3000, peer: 3000 }, b.state, incident).actions.length, 1);
});

test("pure replay survives JSON persistence without mutating any inputs", () => {
  const state = deepFreeze(baseline());
  const f = deepFreeze(fixture(101, { mid: 2700 }));
  const params = deepFreeze({ ...whale });
  const p = m.m0Plan(f.obs, f.views, state, params);
  assert.deepEqual(m.m0Plan(f.obs, f.views, state, params), p);
  const saved = JSON.parse(JSON.stringify(p.state)) as M0State;
  assert.deepEqual(plan(102, { mid: 2700 }, saved), plan(102, { mid: 2700 }, p.state));
});

test("CP depth reads reserves or virtual Uniswap L, falls back only when unknown, skips Curve", () => {
  const f = fixture(101, { mid: 2700 });
  assert.equal(m.m0DepthUsd(f.obs, f.views[0], f.views[0].venues[0]), 750_000);
  delete f.obs.protocols.balancer!.reserves;
  assert.equal(m.m0DepthUsd(f.obs, f.views[0], f.views[0].venues[0]), m.FALLBACK_DEPTH_USD);
  const uni = { ...f.views[0].venues[0], protocol: "uniswap", swapType: "swap" } as AgentVenue;
  f.obs.protocols.uniswap = { pool: { pair: "WETH/USDC", priceUsdcPerWeth: 2700, fee: 3000,
    tick: 0, tickSpacing: 60, liquidity: "10000000000000000" }, positions: [] };
  assert.equal(m.m0DepthUsd(f.obs, f.views[0], uni), 1e16 * Math.sqrt(2700 * 1e-12) / 1e6);
  assert.equal(entry({ depth: 0 }).actions.length, 0);
  assert.equal(entry({ protocol: "curve" }).actions.length, 0);
});

test("WBTC uses 8-decimal funding and sell tags, and emitted swaps pass SDK validation", () => {
  const a = plan(100, { base: "WBTC", decimals: 8, fair: 60_000, mid: 60_000, held: 40_000_000n });
  const f = fixture(101, { base: "WBTC", decimals: 8, fair: 60_000, mid: 66_000, held: 40_000_000n });
  const p = m.m0Plan(f.obs, f.views, a.state, whale);
  assert.equal(p.actions.length, 1);
  assert.equal(p.actions[0].base, "WBTC");
  assert.ok(BigInt(p.actions[0].amountIn) <= 40_000_000n);
  const validate = (p: M0Plan, obs: AgentObservation) => {
    const verdict = validateAction(p.actions[0], obs, {
      ethWei: BigInt(obs.balances.ethWei), wethWei: BigInt(obs.balances.wethWei),
      usdcUnits: BigInt(obs.balances.usdcUnits),
      bases: Object.fromEntries(Object.entries(obs.baseBalances ?? {}).map(([k, v]) => [k, BigInt(v)])),
    });
    assert.equal(verdict.ok, true, JSON.stringify(verdict, (_k, v) => typeof v === "bigint" ? v.toString() : v));
  };
  validate(p, f.obs);
  for (const mid of [2700, 3300]) {
    const w = entry({ mid });
    validate(w, fixture(101, { mid }).obs);
  }
});
