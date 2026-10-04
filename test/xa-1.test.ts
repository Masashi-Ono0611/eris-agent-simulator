import { observation, single, safeAction, W, U } from "./xb-fixtures.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAgent, createLiveAgent, funded, bidWei, planEntry, PARAMS, POLICY } from "../example/agents/xa-1/agent.js";
import { MARKET_LEGS, UNISWAP, BALANCER } from "@eris/sdk/constants.js";
import type { AgentContext, AgentObservation } from "@eris/sdk";

const obs = (block = 100) => single(0.04, true, block);
const clone = <T>(x: T): T => structuredClone(x);
function at(o: AgentObservation, block: number) {
  const x = clone(o); x.blockNumber = String(block); x.round = block; x.blocksRemaining = 360 - block; return x;
}
function putBase(o: AgentObservation, base: string, qty: bigint) {
  if (base === "WETH") o.balances.wethWei = String(qty); else o.baseBalances![base] = String(qty);
}
function baseOf(o: AgentObservation, base: string) { return BigInt(base === "WETH" ? o.balances.wethWei : o.baseBalances![base]!); }
function execute(o: AgentObservation, action: Record<string, any>, block = Number(o.blockNumber) + 1,
  output?: bigint, gas = 200_000n * BigInt(action.maxPriorityFeePerGasWei)) {
  const next = at(o, block), amount = BigInt(action.amountIn);
  next.balances.ethWei = String(BigInt(o.balances.ethWei) - gas);
  if (action.tokenIn === "USDC") {
    next.balances.usdcUnits = String(BigInt(o.balances.usdcUnits) - amount);
    const scale = action.base === "WBTC" ? 1e8 : 1e18;
    const price = action.base === "WBTC" ? 57526 : o.protocols.uniswap!.pool.priceUsdcPerWeth;
    putBase(next, action.base, baseOf(o, action.base) + (output ?? BigInt(Math.floor(Number(amount) / 1e6 / (price * 1.003) * scale))));
  } else {
    putBase(next, action.base, baseOf(o, action.base) - amount);
    next.balances.usdcUnits = String(BigInt(o.balances.usdcUnits) + (output ?? 1030n * U));
  }
  return next;
}
function entered(o = obs()) {
  const c = createAgent(), a = c.decide(o); assert.notEqual(a.type, "noop");
  const next = execute(o, a);
  const b = c.decide(next); assert.equal(b.type, "noop"); // no positive round trip yet
  assert.ok(c.inspect().lot);
  return { c, o, a, next };
}
function fairExit(o: AgentObservation, block: number) {
  const next = at(o, block); next.protocols.uniswap!.pool.priceUsdcPerWeth = 3000; return next;
}
const initial = (o: AgentObservation) => ({ USDC: BigInt(o.balances.usdcUnits), WETH: BigInt(o.balances.wethWei), WBTC: BigInt(o.baseBalances!.WBTC), ETH: BigInt(o.balances.ethWei) });

test("XA parameters restrict and freeze sole AI authority", () => {
  assert.deepEqual(PARAMS, { ENTRY_BPS: 50 });
  for (const value of [15, 65, 19, 61, 21, NaN, Infinity]) assert.throws(() => createAgent({ ENTRY_BPS: value }), RangeError);
  assert.throws(() => createAgent({ ENTRY_BPS: 50, maxHold: 999 } as any), RangeError);
  for (const value of [20, 25, 60]) assert.doesNotThrow(() => createAgent({ ENTRY_BPS: value }));
  const p = { ENTRY_BPS: 50 }, c = createAgent(p); p.ENTRY_BPS = NaN;
  assert.notEqual(c.decide(obs()).type, "noop");
});
test("XA complete plan reserves both legs and explicit costs", () => {
  const o = obs(), c = createAgent(), a = c.decide(o);
  assert.notEqual(a.type, "noop"); assert.ok(c.inspect().pending);
  const p = c.inspect().pending!.plan;
  safeAction(o, a); assert.equal(a.tokenIn, "USDC"); assert.equal(a.slippageBps, 20);
  assert.ok(p.cashIn <= 1000n * U); assert.ok(p.reservedBase <= 8n * W / 10n);
  assert.equal(p.reservedGas, 2n * 200_000n * BigInt(o.limits.maxPriorityFeePerGasWei));
  assert.equal(p.exitGas * 2n, p.reservedGas); assert.ok(p.plannedNet > 0.05);
  assert.equal(p.deadlineBlock, 108); assert.equal(p.exitByBlock, 356);
  assert.equal(p.lossLimit, 20);
  const q = Number(p.expectedQuantity) / 1e18;
  const conservativeCashOut = q * 3000 * 0.997 / (1 + q * 3000 / 300000) * 0.998;
  const bothGasUsd = Number(200000n * BigInt(a.maxPriorityFeePerGasWei) + p.exitGas) / 1e18 * 3000;
  assert.ok(Math.abs(p.plannedNet - (conservativeCashOut - 1000 - 0.6 - bothGasUsd)) < 1e-8,
    "both leg costs and six-block holding haircut must be charged exactly once");
});
test("XA small initial holdings cap exposure independently of cash", () => {
  const o = obs(); o.balances.wethWei = String(W / 2n); o.limits.maxPriorityFeePerGasWei = "500000000";
  const c = createAgent(), a = c.decide(o); assert.notEqual(a.type, "noop");
  const p = c.inspect().pending!.plan;
  assert.ok(p.reservedBase <= W / 20n); assert.ok(p.cashIn < 150n * U);
});
test("XA ENTRY threshold is admission only", () => {
  // Ample observed second-venue price makes a 45bps entry a profitable cycle;
  // ENTRY must remain an independent admission gate, not an economic deduction.
  const o = single(0.0055);
  o.protocols.uniswap!.pool.fee = 0;
  o.protocols.uniswap!.pool.priceUsdcPerWeth = 3000 / 1.0055;
  // Use deep pools to remove impact/gas as the reason for rejecting this edge.
  o.protocols.uniswap!.pool.liquidity = "1000000000000000000000000";
  o.limits.maxPriorityFeePerGasWei = "200000000";
  assert.equal(createAgent({ ENTRY_BPS: 60 }).decide(o).type, "noop");
  assert.notEqual(createAgent({ ENTRY_BPS: 20 }).decide(o).type, "noop");
});
test("XA single edge alone cannot admit an unprofitable round trip", () => {
  const o = single(0.008); assert.equal(createAgent().decide(o).type, "noop");
  assert.equal(createAgent().decide(single(0.016)).type, "noop", "positive gross cannot cover reserved exit gas");
  o.protocols.uniswap!.pool.priceUsdcPerWeth = 2900;
  assert.notEqual(createAgent().decide(o).type, "noop");
});
test("XA cash and independent exit prefunding use canFund", () => {
  const o = obs(); o.balances.usdcUnits = "0"; assert.equal(createAgent().decide(o).type, "noop");
  const zero = obs(); zero.balances.wethWei = "0"; assert.equal(createAgent().decide(zero).type, "noop");
  assert.equal(planEntry(zero, initial(obs())), undefined, "do not fund exit from predicted buy output");
  assert.equal(funded(obs(), "WETH", 9n * W), false);
  const dust = obs(); dust.balances.wethWei = "1"; assert.equal(funded(dust, "WETH", 1n), false);
  assert.equal(funded(obs(), "WBTC", 100_000n), true);
});
test("XA two ceiling gas reservations preserve one wei boundary", () => {
  const o = obs(), required = W / 20n + 400_000n * BigInt(o.limits.maxPriorityFeePerGasWei);
  o.balances.ethWei = String(required - 1n); assert.equal(createAgent().decide(o).type, "noop");
  o.balances.ethWei = String(required); assert.notEqual(createAgent().decide(o).type, "noop");
});
test("XA bid target is exact competitive increment or skip", () => {
  const o = obs(); assert.equal(createAgent().decide(o).maxPriorityFeePerGasWei, "200000000");
  o.competition!.maxCompetitorPriorityFeeWei = "10000000000";
  assert.equal(createAgent().decide(o).type, "noop");
  assert.equal(bidWei(o, 0.01, 200000, true), 0n);
  o.limits.maxPriorityFeePerGasWei = "0";
  assert.equal(createAgent().decide(o).type, "noop");
  o.limits.maxPriorityFeePerGasWei = "10000000000"; o.limits.defaultPriorityFeePerGasWei = "0";
  o.competition!.maxCompetitorPriorityFeeWei = "0";
  assert.ok(BigInt(createAgent().decide(o).maxPriorityFeePerGasWei) > 0n);
});
test("XA entry requires a currently affordable liquid exit", () => {
  const o = obs();
  o.protocols.uniswap!.pool.liquidity = "1";
  assert.equal(createAgent().decide(o).type, "noop");
  const a = obs(); a.protocols.uniswap!.pool.fee = 190000;
  a.protocols.uniswap!.pool.priceUsdcPerWeth = 2300;
  assert.equal(createAgent().decide(a).type, "noop");
});
test("XA observed exit depth and loss budget constrain the plan", () => {
  const o = obs();
  assert.equal(planEntry(o, initial(o), 60), undefined);
  assert.equal(planEntry(o, initial(o), 59.99), undefined);
  assert.ok(planEntry(o, initial(o), 0));
});
test("XA initial allocation is never a sell signal", () => {
  const o = single(0.2, false);
  assert.equal(createAgent().decide(o).type, "noop");
});
test("XA pending entry never expires or reuses balances", () => {
  const c = createAgent(), o = obs(), a = c.decide(o); assert.notEqual(a.type, "noop");
  for (const n of [100, 101, 105, 125]) assert.equal(c.decide(at(o, n)).type, "noop");
  assert.equal(c.inspect().pending!.phase, "entry"); assert.equal(c.inspect().lot, undefined);
});
test("XA settlement requires exact debit proceeds gas and other base", () => {
  for (const corrupt of [
    (x: AgentObservation) => x.balances.usdcUnits = String(BigInt(x.balances.usdcUnits) + 1n),
    (x: AgentObservation) => x.balances.wethWei = String(8n * W),
    (x: AgentObservation) => x.balances.ethWei = String(W),
    (x: AgentObservation) => x.baseBalances!.WBTC = "39999999",
  ]) {
    const c = createAgent(), o = obs(), a = c.decide(o), next = execute(o, a);
    corrupt(next); assert.equal(c.decide(next).type, "noop");
    assert.ok(c.inspect().pending); assert.equal(c.inspect().lot, undefined);
  }
});
test("XA delayed balance confirmation records actual lot only", () => {
  const c = createAgent(), o = obs(), a = c.decide(o), next = execute(o, a, 104, W / 3n);
  c.decide(next);
  assert.equal(c.inspect().lot!.quantity, W / 3n);
  assert.equal(c.inspect().initial!.WETH, 8n * W);
  assert.equal(c.inspect().lot!.confirmedBlock, 104);
  assert.equal(c.inspect().lot!.entryGasWei, 40_000_000_000_000n);
});
test("XA gas only failure locks instead of repeating reverts", () => {
  const c = createAgent(), o = obs(); c.decide(o);
  const next = at(o, 101); next.balances.ethWei = String(W - 10n ** 12n);
  for (const n of [101, 110, 130]) assert.equal(c.decide(at(next, n)).type, "noop");
  assert.match(c.inspect().halt!, /ambiguous/); assert.ok(c.inspect().pending);
});
test("XA profitable exit needs no positive single leg edge", () => {
  const { c, next } = entered(), x = fairExit(next, 102), lot = c.inspect().lot!;
  const a = c.decide(x); assert.notEqual(a.type, "noop"); safeAction(x, a);
  assert.equal(a.tokenIn, "WETH"); assert.equal(BigInt(a.amountIn), lot.quantity);
  // At fair with a 30bps fee the SELL leg's standalone edge is negative.
  assert.equal(x.protocols.uniswap!.pool.priceUsdcPerWeth, x.fairPriceUsdcPerWeth);
});
test("XA time limit permits only prebudgeted loss recovery", () => {
  const { c, next } = entered();
  assert.equal(c.decide(at(next, 106)).type, "noop");
  const a = c.decide(at(next, 107)); assert.notEqual(a.type, "noop");
  assert.equal(a.tokenIn, "WETH"); assert.ok(BigInt(a.maxPriorityFeePerGasWei) > 0n);
});
test("XA loss floor forbids unconditional terminal liquidation", () => {
  const { c, next } = entered(), x = at(next, 358);
  x.protocols.uniswap!.pool.priceUsdcPerWeth = 2000;
  assert.equal(c.decide(x).type, "noop"); assert.ok(c.inspect().lot);
  const recovery = fairExit(next, 359);
  assert.notEqual(c.decide(recovery).type, "noop");
});
test("XA exit unavailable blocks all new entries even on other base", () => {
  const { c, next } = entered(), x = at(next, 108);
  x.protocols.uniswap!.pool.liquidity = "1";
  x.protocols.uniswap!.markets = { "WBTC/USDC": { ...observation().protocols.uniswap!.pool, pair: "WBTC/USDC", priceUsdcPerWeth: 55000 } };
  assert.equal(c.decide(x).type, "noop"); assert.equal(c.inspect().lot!.base, "WETH");
});
test("XA exit depth must cover the entire confirmed lot", () => {
  const { c, next } = entered(), x = fairExit(next, 102);
  x.protocols.uniswap!.pool.priceUsdcPerWeth = 3500;
  x.protocols.uniswap!.pool.liquidity = String(BigInt(Math.ceil(25000 * 1e6 / Math.sqrt(3500 * 1e-12))));
  assert.equal(c.decide(x).type, "noop"); assert.ok(c.inspect().lot);
});
test("XA exit cannot spend initial inventory after balance corruption", () => {
  const { c, next } = entered(), x = fairExit(next, 102);
  x.balances.wethWei = String(8n * W);
  assert.equal(c.decide(x).type, "noop"); assert.ok(c.inspect().lot);
});
test("XA pending exit cannot be resold or reopened", () => {
  const { c, next } = entered(), x = fairExit(next, 102), a = c.decide(x);
  assert.notEqual(a.type, "noop");
  for (const block of [103, 105, 359]) assert.equal(c.decide(at(x, block)).type, "noop");
  assert.equal(c.inspect().pending!.phase, "exit");
});
test("XA exact closure restores anchor and books both actual gas payments", () => {
  const { c, next } = entered(), x = fairExit(next, 102), a = c.decide(x);
  const closed = execute(x, a, 103, 1030n * U);
  assert.equal(c.decide(closed).type, "noop");
  const s = c.inspect(); assert.equal(s.closed, 1); assert.equal(s.lot, undefined);
  assert.equal(s.lastClose!.gasWei, 80_000_000_000_000n);
  assert.ok(Math.abs(s.lastClose!.netUsd - 29.76) < 1e-9);
  assert.equal(BigInt(closed.balances.wethWei), s.initial!.WETH);
});
test("XA realized loss is charged once and breaches halt future entry", () => {
  const { c, next } = entered(), x = fairExit(next, 102), a = c.decide(x);
  const closed = execute(x, a, 103, 970n * U);
  c.decide(closed); const s = c.inspect();
  assert.ok(s.lossSpent > 30); assert.match(s.halt!, /realized loss/);
  assert.equal(c.decide(at(closed, 104)).type, "noop"); assert.equal(c.inspect().lossSpent, s.lossSpent);
});
test("XA entry horizon includes hold and both execution buffers", () => {
  for (const left of [0, 1, 4, 8, 12]) {
    const o = obs(); o.blocksRemaining = left; assert.equal(createAgent().decide(o).type, "noop");
  }
  const o = obs(); o.blocksRemaining = 13; assert.notEqual(createAgent().decide(o).type, "noop");
  o.dayBlocksRemaining = 12; assert.equal(createAgent().decide(o).type, "noop");
  delete o.blocksRemaining; delete o.dayBlocksRemaining; assert.equal(createAgent().decide(o).type, "noop");
});
test("XA terminal buffer accelerates bounded recovery", () => {
  const { c, next } = entered(), x = at(next, 102); x.blocksRemaining = 4;
  assert.notEqual(c.decide(x).type, "noop");
});
test("XA final block reconciles fills but sends no action", () => {
  const { c, next } = entered(), x = fairExit(next, 359), a = c.decide(x);
  const closed = execute(x, a, 360, 1030n * U);
  assert.equal(c.decide(closed).type, "noop"); assert.equal(c.inspect().closed, 1);
  assert.equal(c.inspect().pending, undefined);
  const open = entered();
  assert.equal(open.c.decide(fairExit(open.next, 360)).type, "noop");
  assert.ok(open.c.inspect().lot);
});

test("XA exit settlement requires full debit and positive cash proceeds", () => {
  for (const mode of ["partial", "noCash", "noGas", "other"]) {
    const { c, next } = entered(), x = fairExit(next, 102), a = c.decide(x), y = execute(x, a, 103);
    if (mode === "partial") y.balances.wethWei = String(BigInt(y.balances.wethWei) + 1n);
    if (mode === "noCash") y.balances.usdcUnits = x.balances.usdcUnits;
    if (mode === "noGas") y.balances.ethWei = x.balances.ethWei;
    if (mode === "other") y.baseBalances!.WBTC = "40000001";
    assert.equal(c.decide(y).type, "noop"); assert.equal(c.inspect().closed, 0);
    assert.equal(c.inspect().pending!.phase, "exit"); assert.ok(c.inspect().lot);
  }
});
test("XA exit gas and competitive cost cannot bypass reserved limits", () => {
  const { c, next } = entered(), x = fairExit(next, 102);
  x.balances.ethWei = String(W / 20n);
  assert.equal(c.decide(x).type, "noop");
  const other = entered(), y = fairExit(other.next, 102);
  y.competition!.maxCompetitorPriorityFeeWei = "10000000000";
  assert.equal(other.c.decide(y).type, "noop"); assert.ok(other.c.inspect().lot);
});
test("XA rewind and horizon jump retain pending reservations", () => {
  const c = createAgent(), o = obs(); c.decide(o);
  const x = at(o, 101); x.blocksRemaining = 999;
  assert.equal(c.decide(x).type, "noop"); assert.ok(c.inspect().pending);
  assert.equal(c.decide(at(o, 99)).type, "noop"); assert.ok(c.inspect().pending);
  assert.match(c.inspect().halt!, /rewind/);
  const n = obs(); n.runId = "next-independent-run";
  assert.notEqual(c.decide(n).type, "noop"); assert.equal(c.inspect().closed, 0);
});
test("XA malformed observations retain lock and fail closed", () => {
  const c = createAgent(); c.decide(obs());
  const o = at(obs(), 101); o.balances.usdcUnits = "bad";
  assert.equal(c.decide(o).type, "noop"); assert.ok(c.inspect().pending);
  assert.equal(c.decide(null as any).type, "noop");
});
test("XA WBTC accounting uses eight decimal actual lot", () => {
  const o = observation(); o.protocols.uniswap!.markets = {
    "WBTC/USDC": { ...o.protocols.uniswap!.pool, pair: "WBTC/USDC", priceUsdcPerWeth: 57526 },
  };
  const c = createAgent(), a = c.decide(o); assert.equal(a.base, "WBTC"); safeAction(o, a);
  const next = execute(o, a), q = baseOf(next, "WBTC") - 40_000_000n;
  c.decide(next); assert.equal(c.inspect().lot!.quantity, q);
  const x = at(next, 102); x.protocols.uniswap!.markets!["WBTC/USDC"]!.priceUsdcPerWeth = 60000;
  const exit = c.decide(x); assert.equal(exit.tokenIn, "WBTC"); assert.equal(BigInt(exit.amountIn), q); safeAction(x, exit);
  const closed = execute(x, exit, 103); c.decide(closed);
  assert.equal(baseOf(closed, "WBTC"), 40_000_000n);
});
test("XA deterministic instances ignore metadata and exported snapshots cannot mutate state", () => {
  const o = obs(), x: any = clone(o); x.regime = "crash"; x.seed = 987; x.future = { price: 1 };
  const a = createAgent(), b = createAgent(); assert.deepEqual(a.decide(o), b.decide(x));
  a.inspect().pending!.action.amountIn = "0";
  assert.notEqual(a.inspect().pending!.action.amountIn, "0");
  assert.notEqual(createAgent().decide(o).type, "noop");
});

const stranger = "0x0000000000000000000000000000000000000022";
function tx(to: string, fee: bigint, from = stranger) { return { from, to, maxPriorityFeePerGas: fee }; }
function context(o: AgentObservation, transactions: any[], log = (_x: any) => {}) {
  return { log, publicClient: { getBlock: async (args: any) => {
    assert.equal(args.blockNumber, BigInt(o.blockNumber)); assert.equal(args.includeTransactions, true);
    return { number: BigInt(o.blockNumber), transactions };
  } } } as unknown as AgentContext;
}
test("XA LIVE scopes route bids excluding own and unrelated oracle", async () => {
  const o = obs(); o.competition!.maxCompetitorPriorityFeeWei = "6000000000";
  o.limits.maxPriorityFeePerGasWei = "5000000000";
  const rows = [tx(UNISWAP.swapRouter, 200_000_000n), tx(MARKET_LEGS.uniswap.WETH!.pool, 300_000_000n),
    tx(UNISWAP.swapRouter, 4_000_000_000n, o.agentAddress), tx(stranger, 6_000_000_000n), tx(BALANCER.vault, 4_000_000_000n)];
  const a = await createLiveAgent().decide(o, context(o, rows));
  assert.equal(a.maxPriorityFeePerGasWei, "400000000");
});
test("XA LIVE separate execution venue determines exit competitor", async () => {
  const c = createLiveAgent(), o = obs();
  const a = await c.decide(o, context(o, [tx(UNISWAP.swapRouter, 100_000_000n)]));
  const next = execute(o, a); await c.decide(next, context(next, []));
  const x = fairExit(next, 102);
  x.protocols.balancer = { priceUsdcPerWeth: 3010, effectiveHalfSpreadBps: 30, buyPriceUsdcPerWeth: 3019.03, sellPriceUsdcPerWeth: 3000.97 };
  const exit = await c.decide(x, context(x, [tx(UNISWAP.swapRouter, 10_000_000_000n), tx(BALANCER.vault, 100_000_000n)]));
  assert.equal(exit.type, "balancerSwap"); assert.equal(exit.maxPriorityFeePerGasWei, "200000000");
});
test("XA LIVE failed incomplete wrong-block reads keep conservative aggregate", async () => {
  const o = obs(); o.competition!.maxCompetitorPriorityFeeWei = "10000000000";
  for (const getBlock of [async () => { throw Error("read failed"); },
    async () => ({ number: 99n, transactions: [] }), async () => ({ number: 100n, transactions: ["0xhash"] })]) {
    const ctx = { publicClient: { getBlock } } as any;
    assert.equal((await createLiveAgent().decide(o, ctx)).type, "noop");
  }
});
test("XA LIVE logs serializable lot reservations without config reads", async () => {
  const o = obs(), logs: any[] = [], ctx = context(o, [], x => logs.push(x));
  Object.defineProperty(ctx, "config", { get() { throw Error("forbidden config"); } });
  const c = createLiveAgent(), a = await c.decide(o, ctx);
  assert.notEqual(a.type, "noop"); assert.equal(logs[0].state.pending.phase, "entry");
  assert.equal(typeof logs[0].state.pending.plan.cashIn, "string");
  assert.doesNotThrow(() => JSON.stringify(logs));
});
test("XA diagnostic prompt freezes null executor and AI bounds", () => {
  const prompt = readFileSync(resolve("example/agents/xa-1/prompt.md"), "utf8");
  assert.match(prompt, /kind: improve/); assert.match(prompt, /name: xa-1/);
  assert.match(prompt, /"executorTs": null/); assert.match(prompt, /20–60/);
  assert.match(prompt, /disable inference/);
});

test("XA real dev4 fixtures reject oracle aggregate and retain failed-attempt lock", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/xa-1-dev4.json", import.meta.url), "utf8"));
  assert.equal(fixture.sources.length, 3);
  for (const frame of fixture.frames) {
    const o = observation(frame.block), m = frame.market;
    // Reconstruction with explicitly synthetic initial funds: not a wallet replay.
    o.blocksRemaining = 1646 - frame.block;
    o.fairPriceUsdcPerWeth = m.fair.WETH; o.fairPricesUsd = m.fair;
    o.protocols.uniswap!.pool.priceUsdcPerWeth = m.venues.uniswap.WETH.mid;
    for (const venue of ["balancer", "curve"] as const) {
      const q = m.venues[venue].WETH;
      (o.protocols as any)[venue] = { priceUsdcPerWeth: q.mid, buyPriceUsdcPerWeth: q.buy,
        sellPriceUsdcPerWeth: q.sell, effectiveHalfSpreadBps: (q.buy / q.mid - 1) * 10000 };
    }
    o.limits.maxPriorityFeePerGasWei = "5000000000";
    o.competition!.maxCompetitorPriorityFeeWei = "6000000000"; // explicit oracle-contamination control
    assert.equal(createAgent().decide(o).type, "noop");
    const bids = frame.records.filter((r: any) => r.record.agentId === "multi-arb" && r.record.event === "submitted")
      .map((r: any) => tx(r.record.protocol === "uniswap" ? UNISWAP.swapRouter : r.record.protocol === "balancer"
        ? BALANCER.vault : MARKET_LEGS.curve.WETH!.pool, BigInt(r.record.priorityFeeWei)));
    const c = createLiveAgent(), a = await c.decide(o, context(o, bids));
    assert.notEqual(a.type, "noop"); safeAction(o, a);
    // Historical failed submissions supply no settlement evidence. An unchanged
    // balance observation must keep our hypothetical attempt fully reserved.
    const next = at(o, frame.block + 5); next.blocksRemaining = o.blocksRemaining! - 5;
    assert.equal((await c.decide(next, context(next, bids))).type, "noop");
    assert.equal(c.inspect().pending!.phase, "entry");
  }
  assert.ok(fixture.frames[0].records.some((r: any) => r.record.event === "submit_failed"));
});
