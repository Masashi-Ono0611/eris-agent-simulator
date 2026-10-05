import { observation, single, safeAction, W, U } from "./xb-fixtures.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createJsonlAppender } from "../example/agents/runtime/agentLog.js";
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

const dev6 = JSON.parse(readFileSync(new URL("./fixtures/xa-1-dev6s.json", import.meta.url), "utf8"));
function dev6Obs(block: number, wallet: Record<string, string>): AgentObservation {
  // Only the balances and block are historical; a synthetic admissible market
  // drives the same exact-input amount without claiming historical quote replay.
  const o = obs(block); o.blocksRemaining = 1646 - block;
  o.balances = { usdcUnits: wallet.USDC, wethWei: wallet.WETH, ethWei: wallet.ETH };
  o.baseBalances = { WETH: wallet.WETH, WBTC: wallet.WBTC };
  return o;
}
const dev6Frame = (block: number) => dev6.frames.find((f: any) => f.block === block);

test("XA dev6s measured buy and sell confirm actual debit proceeds and gas", () => {
  const c = createAgent(), entry = dev6Frame(1298), filled = dev6Frame(1299), closed = dev6Frame(1306);
  const a = c.decide(dev6Obs(1298, entry.wallet));
  assert.equal(a.amountIn, entry.action.amountIn);
  c.decide(dev6Obs(1299, filled.wallet));
  assert.equal(String(c.inspect().lot!.quantity), filled.lot.quantity);
  assert.equal(String(c.inspect().lot!.entryGasWei), filled.lot.entryGasWei);
  const exitObs = dev6Obs(1305, filled.wallet);
  exitObs.protocols.uniswap!.pool.priceUsdcPerWeth = 3000;
  const exit = c.decide(exitObs);
  assert.equal(exit.amountIn, dev6Frame(1305).action.amountIn);
  c.decide(dev6Obs(1306, closed.wallet));
  assert.equal(c.inspect().closed, 1);
  assert.equal(String(c.inspect().lastClose!.cashOut), "996298130");
  assert.equal(String(c.inspect().lastClose!.gasWei), "59130462000000");
});

test("XA dev6s rejected entry leaves bounded waiting and recovers a late fill only", () => {
  const failed = dev6.runtime.find((r: any) => r.event === "submit_failed");
  assert.equal(failed.blockSeen, 1312); assert.match(failed.error, /Too little received/);
  assert.deepEqual(dev6.mined.map((r: any) => Number(r.blockNumber)), [1299, 1306]);
  const c = createAgent(), o = dev6Obs(1312, dev6Frame(1312).wallet), entry = c.decide(o);
  assert.equal(entry.amountIn, failed.amount);
  for (let b = 1313; b < 1320; b++) {
    assert.equal(c.decide(dev6Obs(b, dev6Frame(1312).wallet)).type, "noop");
    assert.ok(c.inspect().pending);
  }
  const expired = c.decide(dev6Obs(1320, dev6Frame(1312).wallet));
  assert.match(expired.reason, /recovery only/);
  assert.equal(c.inspect().pending, undefined, "ordinary confirmation wait has a deadline");
  assert.ok(c.inspect().unresolved, "in-flight reservation is retained, not time-released");
  assert.match(c.inspect().halt!, /confirmation deadline/);
  // Worst case: a lost submit response was actually accepted and fills late.
  // Use a synthetic fill before the ordinary lot deadline to prove immediate
  // recovery is due after confirmation timeout, not another maxHold wait.
  const late = execute(o, entry, 1321);
  late.blocksRemaining = 325;
  const recovery = c.decide(late);
  assert.notEqual(recovery.type, "noop"); assert.equal(recovery.tokenIn, "WETH");
  assert.equal(BigInt(recovery.amountIn), baseOf(late, "WETH") - baseOf(o, "WETH"));
  assert.equal(c.inspect().unresolved, undefined);
  assert.equal(c.decide(at(late, 1322)).type, "noop", "no duplicate recovery exit");
  const closed = execute(late, recovery, 1323); closed.blocksRemaining = 323;
  const resumed = c.decide(closed);
  assert.equal(resumed.tokenIn, "USDC", "only a fully recovered cycle may admit a fresh entry");
  assert.equal(c.inspect().closed, 1); assert.equal(c.inspect().lot, undefined);
  assert.equal(c.inspect().pending?.phase, "entry");
});

test("XA recovery timeout never unlocks unchanged partial or gas-only entry funds", () => {
  for (const kind of ["unchanged", "partial", "gas-only", "other-base"] as const) {
    const c = createAgent(), o = obs(), entry = c.decide(o), next = at(o, 108);
    if (kind === "partial") Object.assign(next.balances, execute(o, entry, 108).balances,
      { usdcUnits: String(BigInt(o.balances.usdcUnits) - BigInt(entry.amountIn) + 100_000n) });
    if (kind === "gas-only") next.balances.ethWei = String(W - 1n);
    if (kind === "other-base") next.baseBalances!.WBTC = "39999999";
    for (const b of [108, 109, 125, 300]) {
      const a = c.decide(at(next, b));
      assert.equal(a.type, "noop"); assert.match(a.reason, /recovery only/);
      assert.ok(c.inspect().unresolved); assert.equal(c.inspect().pending, undefined);
      assert.equal(c.inspect().lot, undefined);
    }
  }
});

test("XA recovery timeout never resells an in-flight exit and books its late fill once", () => {
  const { c, next } = entered(), x = fairExit(next, 102), exit = c.decide(x);
  for (const b of [110, 111, 200]) {
    const a = c.decide(at(x, b)); assert.equal(a.type, "noop");
    assert.match(a.reason, /recovery only/);
    assert.ok(c.inspect().unresolved); assert.equal(c.inspect().pending, undefined);
  }
  const closed = execute(x, exit, 201);
  assert.equal(c.decide(closed).type, "noop");
  assert.equal(c.inspect().closed, 1); assert.equal(c.inspect().unresolved, undefined);
  c.decide(at(closed, 202)); assert.equal(c.inspect().closed, 1);
});

test("XA recovery WBTC late fill uses eight decimal proceeds and preserves ETH gas", () => {
  const o = observation(); o.protocols.uniswap!.markets = {
    "WBTC/USDC": { ...o.protocols.uniswap!.pool, pair: "WBTC/USDC", priceUsdcPerWeth: 57526 },
  };
  const c = createAgent(), entry = c.decide(o); assert.equal(entry.base, "WBTC");
  c.decide(at(o, 108));
  const late = execute(o, entry, 109), exit = c.decide(late);
  assert.equal(exit.tokenIn, "WBTC");
  assert.equal(BigInt(exit.amountIn), baseOf(late, "WBTC") - baseOf(o, "WBTC"));
  assert.equal(c.inspect().lot!.entryGasWei, BigInt(o.balances.ethWei) - BigInt(late.balances.ethWei));
});


const dev7 = JSON.parse(readFileSync(new URL("./fixtures/xa-1-dev7.json", import.meta.url), "utf8"));
const dev7Frame = (block: number) => dev7.frames.find((f: any) => f.block === block);
function nonceEvidence(block: number, sentBlock = 100, confirmed = 48, pending = confirmed) {
  return { block, sentBlock, before: 48, confirmed, pending };
}
function nonceContext(o: AgentObservation, sentBlock: number, confirmed = 48, pending = confirmed,
  log = (_x: any) => {}) {
  const ctx = context(o, [], log);
  (ctx.publicClient as any).getTransactionCount = async (args: any) => {
    assert.equal(args.address, o.agentAddress);
    if (args.blockTag) { assert.equal(args.blockTag, "pending"); return pending; }
    assert.ok(args.blockNumber === BigInt(sentBlock) || args.blockNumber === BigInt(o.blockNumber));
    return args.blockNumber === BigInt(sentBlock) ? 48 : confirmed;
  };
  return ctx;
}

test("XA dev7 all nine measured round trips reconcile native balances and gas", () => {
  for (let i = 0; i < 18; i += 2) {
    const buy = dev7.trades[i], sell = dev7.trades[i + 1], base = buy.action.base;
    const make = (block: number, funds: any, exit = false) => {
      const o = dev6Obs(block, funds);
      o.protocols.uniswap!.pool.priceUsdcPerWeth = base === "WETH" ? (exit ? 3100 : 2876.3) : 3000;
      if (base === "WBTC") o.protocols.uniswap!.markets = { "WBTC/USDC": {
        ...o.protocols.uniswap!.pool, pair: "WBTC/USDC", priceUsdcPerWeth: exit ? 62000 : 57526,
      } };
      return o;
    };
    const c = createAgent(), entry = c.decide(make(buy.event.blockSeen, buy.before));
    assert.equal(entry.base, base); assert.equal(entry.amountIn, buy.action.amountIn);
    const onFill = c.decide(make(buy.observedBlock, buy.after, buy.observedBlock === sell.event.blockSeen));
    const lot = c.inspect().lot!;
    assert.equal(lot.quantity, BigInt(buy.delta[base]));
    assert.equal(lot.entryGasWei, -BigInt(buy.delta.ETH));
    assert.notEqual(lot.quantity, lot.expectedQuantity, "proceeds are not the model quote/minOut");
    const exit = buy.observedBlock === sell.event.blockSeen ? onFill : c.decide(make(sell.event.blockSeen, sell.before, true));
    assert.equal(exit.amountIn, sell.action.amountIn);
    c.decide(make(sell.observedBlock, sell.after, true));
    assert.equal(c.inspect().closed, 1);
    assert.equal(c.inspect().lastClose!.cashOut, BigInt(sell.delta.USDC));
    assert.equal(c.inspect().lastClose!.gasWei, -BigInt(buy.delta.ETH) - BigInt(sell.delta.ETH));
    for (const t of [buy, sell]) {
      assert.equal(-BigInt(t.delta.ETH), BigInt(t.mined.gasUsed) * BigInt(t.mined.priorityFeeWei));
      assert.equal(t.observedBlock, t.event.blockSeen + 1);
    }
  }
});

test("XA dev7 failed submit resumes after stable nonce drain and wallet reconstruction", async () => {
  const failed = dev7.trades[18], funds = dev7Frame(1374).wallet;
  assert.match(failed.event.error, /Too little received/);
  assert.deepEqual(failed.delta, { USDC: "0", WETH: "0", WBTC: "0", ETH: "0" });
  assert.deepEqual(dev7Frame(1645).wallet, funds);
  const c = createLiveAgent(), rows: any[] = [];
  const step = async (b: number) => {
    const o = dev6Obs(b, funds);
    return c.decide(o, nonceContext(o, 1374, 48, 48, x => rows.push(x)));
  };
  assert.equal((await step(1374)).amountIn, failed.action.amountIn);
  for (let b = 1375; b <= 1383; b++) assert.equal((await step(b)).type, "noop");
  assert.ok(c.inspect().unresolved);
  assert.match((await step(1384)).reason, /ledger rebuilt/);
  assert.equal(c.inspect().unresolved, undefined); assert.equal(c.inspect().pending, undefined);
  assert.equal(c.inspect().halt, undefined); assert.deepEqual(c.inspect().wallet, initial(dev6Obs(1384, funds)));
  const again = await step(1385); assert.equal(again.tokenIn, "USDC"); safeAction(dev6Obs(1385, funds), again);
  assert.equal(c.inspect().pending!.sentBlock, 1385);
  assert.equal((await step(1385)).type, "noop");
  assert.equal(rows.find(x => x.round === 1384).state.recovered.sentBlock, 1374);
});

test("XA dev7 tolerant debit uses actual cost and requires consecutive stable observations", () => {
  const buy = dev7.trades[0];
  for (const correction of [-1001n, 1n, 1001n]) {
    const c = createAgent(), o = dev6Obs(1298, buy.before); c.decide(o);
    const funds = { ...buy.after, USDC: String(BigInt(buy.after.USDC) + correction) };
    c.decide(dev6Obs(1299, funds)); assert.ok(c.inspect().pending); assert.equal(c.inspect().lot, undefined);
    c.decide(dev6Obs(1299, funds)); assert.equal(c.inspect().lot, undefined, "duplicate is not a second observation");
    c.decide(dev6Obs(1300, funds));
    assert.ok(c.inspect().lot, "stable bounded debit must settle");
    assert.equal(c.inspect().lot!.cashIn, 1_000_000_000n - correction);
    assert.equal(c.inspect().lot!.quantity, BigInt(buy.delta.WETH));
    assert.equal(c.inspect().lot!.entryGasWei, -BigInt(buy.delta.ETH));
    assert.equal(c.inspect().halt, undefined);
  }
});

test("XA dev7 split balance reads across blocks do not permanently poison confirmation", () => {
  const buy = dev7.trades[0], c = createAgent(); c.decide(dev6Obs(1298, buy.before));
  c.decide(dev6Obs(1299, { ...buy.before, USDC: buy.after.USDC }));
  assert.ok(c.inspect().pending); assert.equal(c.inspect().lot, undefined);
  c.decide(dev6Obs(1300, { ...buy.after, ETH: buy.before.ETH }));
  assert.ok(c.inspect().pending);
  c.decide(dev6Obs(1301, buy.after));
  assert.equal(c.inspect().lot!.quantity, BigInt(buy.delta.WETH));
  assert.equal(c.inspect().halt, undefined); assert.equal(c.inspect().pending, undefined);
});

test("XA tolerant bounds reject partial fills and tolerate other-base dust only after stability", () => {
  for (const delta of [-1002n, 1002n, 500_000_000n]) {
    const c = createAgent(), o = obs(), a = c.decide(o), filled = execute(o, a);
    filled.balances.usdcUnits = String(BigInt(filled.balances.usdcUnits) + delta);
    for (const b of [101, 102, 108, 109, 110]) {
      assert.equal(c.decide(at(filled, b), undefined, nonceEvidence(b, 100, 49)).type, "noop");
      assert.equal(c.inspect().lot, undefined);
    }
    assert.ok(c.inspect().unresolved);
  }
  const c = createAgent(), o = obs(), a = c.decide(o), filled = execute(o, a);
  filled.baseBalances!.WBTC = "40000001";
  c.decide(filled); assert.ok(c.inspect().pending);
  c.decide(at(filled, 102)); assert.ok(c.inspect().lot); assert.equal(c.inspect().halt, undefined);
  const bad = createAgent(), start = obs(), entry = bad.decide(start), unrelated = execute(start, entry);
  unrelated.baseBalances!.WBTC = "40000002";
  bad.decide(unrelated); bad.decide(at(unrelated, 102));
  assert.equal(bad.inspect().lot, undefined); assert.ok(bad.inspect().pending);
});

test("XA tolerant exit books actual proceeds once without selling residual or initial inventory", () => {
  for (const base of ["WETH", "WBTC"]) {
    const o = obs();
    if (base === "WBTC") {
      o.protocols.uniswap!.pool.priceUsdcPerWeth = 3000;
      o.protocols.uniswap!.markets = { "WBTC/USDC": { ...o.protocols.uniswap!.pool, pair: "WBTC/USDC", priceUsdcPerWeth: 57526 } };
    }
    const { c, next } = entered(o), x = fairExit(next, 102);
    if (base === "WBTC") x.protocols.uniswap!.markets!["WBTC/USDC"]!.priceUsdcPerWeth = 62000;
    const a = c.decide(x), closed = execute(x, a, 103);
    putBase(closed, base, baseOf(closed, base) + 1n);
    c.decide(closed); assert.equal(c.inspect().closed, 0);
    c.decide(at(closed, 104)); assert.equal(c.inspect().closed, 1);
    assert.equal(c.inspect().lastClose!.cashOut, 1030n * U);
    assert.equal(c.inspect().initial![base as "WETH" | "WBTC"], baseOf(o, base));
    c.decide(at(closed, 105)); assert.equal(c.inspect().closed, 1);
  }
});

test("XA recovery requires matching pinned nonce evidence and no in-flight debit", () => {
  for (const mode of ["missing", "pending", "backwards", "jump", "stale", "wrong-send", "fraction", "gas-without-nonce", "token-change"]) {
    const c = createAgent(), o = obs(); c.decide(o);
    for (let b = 108; b <= 113; b++) {
      let proof: any = nonceEvidence(b); const x = at(o, b);
      if (mode === "missing") proof = undefined;
      if (mode === "pending") proof.pending = 49;
      if (mode === "backwards") proof.confirmed = proof.pending = 47;
      if (mode === "jump") proof.confirmed = proof.pending = 50;
      if (mode === "stale") proof.block--;
      if (mode === "wrong-send") proof.sentBlock--;
      if (mode === "fraction") proof.before = 48.5;
      if (mode === "gas-without-nonce") x.balances.ethWei = String(W - 1n);
      if (mode === "token-change") x.balances.usdcUnits = String(BigInt(o.balances.usdcUnits) - 1n);
      assert.equal(c.decide(x, undefined, proof).type, "noop", mode);
      assert.ok(c.inspect().unresolved, mode); assert.equal(c.inspect().recovered, undefined, mode);
    }
  }
});

test("XA recovery consecutive observations reset on missing proof gap or wallet movement", () => {
  const c = createAgent(), o = obs(); c.decide(o);
  for (const b of [108, 109, 109, 111, 112]) {
    c.decide(at(o, b), undefined, nonceEvidence(b)); assert.ok(c.inspect().unresolved);
  }
  c.decide(at(o, 113)); assert.ok(c.inspect().unresolved);
  assert.equal(c.inspect().unresolved!.quiet, undefined, "failed proof invalidates the quiet streak immediately");
  for (const b of [114, 115]) { c.decide(at(o, b), undefined, nonceEvidence(b)); assert.ok(c.inspect().unresolved); }
  assert.match(c.decide(at(o, 116), undefined, nonceEvidence(116)).reason, /ledger rebuilt/);
  assert.equal(c.inspect().unresolved, undefined);
});

test("XA recovery late fill wins over release and never duplicates an in-flight exit", () => {
  const c = createAgent(), o = obs(), entry = c.decide(o);
  for (const b of [108, 109]) c.decide(at(o, b), undefined, nonceEvidence(b));
  const late = execute(o, entry, 110), exit = c.decide(late, undefined, nonceEvidence(110, 100, 49));
  assert.equal(exit.tokenIn, "WETH"); assert.equal(exit.amountIn, String(c.inspect().lot!.quantity));
  for (const b of [118, 119, 120, 121]) {
    const proof = { ...nonceEvidence(b, 110, 49, 50), before: 49 };
    assert.equal(c.decide(at(late, b), undefined, proof).type, "noop");
    assert.ok(c.inspect().unresolved);
  }
  const closed = execute(late, exit, 122); closed.protocols.uniswap!.pool.priceUsdcPerWeth = 3000;
  c.decide(closed); assert.equal(c.inspect().closed, 1); assert.equal(c.inspect().halt, undefined);
  c.decide(at(closed, 123)); assert.equal(c.inspect().closed, 1);
});

test("XA recovery failed exit retains the lot and charges retry gas once on actual close", () => {
  const { c, next } = entered(), x = fairExit(next, 102), exit = c.decide(x);
  const reverted = at(x, 110), gas = 30_000_000_000_000n;
  reverted.balances.ethWei = String(BigInt(x.balances.ethWei) - gas);
  for (const b of [110, 111, 112]) c.decide(at(reverted, b), undefined, nonceEvidence(b, 102, 49));
  assert.equal(c.inspect().unresolved, undefined); assert.ok(c.inspect().lot);
  assert.equal(c.inspect().closed, 0); assert.equal(c.inspect().realizedNet, 0);
  const retryObs = at(reverted, 113), retry = c.decide(retryObs);
  assert.equal(retry.amountIn, exit.amountIn); safeAction(retryObs, retry);
  const closed = execute(retryObs, retry, 114);
  c.decide(closed); assert.equal(c.inspect().closed, 1);
  assert.equal(c.inspect().lastClose!.gasWei, 40_000_000_000_000n + gas + 40_000_000_000_000n);
  assert.equal(c.inspect().realizedNet, c.inspect().lastClose!.netUsd);
});

test("XA recovery gas-only failed entry charges loss once and preserves hard halts", () => {
  for (const expensive of [false, true]) {
    const c = createAgent(), o = obs(); c.decide(o);
    const failed = at(o, 108), gas = expensive ? W / 100n : 30_000_000_000_000n;
    failed.balances.ethWei = String(W - gas);
    for (const b of [108, 109, 110]) c.decide(at(failed, b), undefined, nonceEvidence(b, 100, 49));
    assert.equal(c.inspect().unresolved, undefined);
    const loss = Number(gas) / 1e18 * 3000;
    assert.equal(c.inspect().lossSpent, loss); assert.equal(c.inspect().realizedNet, -loss);
    assert.deepEqual(c.inspect().wallet, initial(failed));
    const again = c.decide(at(failed, 111));
    assert.equal(again.type === "noop", expensive);
    assert.equal(c.inspect().lossSpent, loss);
  }
  const c = createAgent(), o = obs(); c.decide(o); c.decide(at(o, 99));
  for (const b of [108, 109, 110]) c.decide(at(o, b), undefined, nonceEvidence(b));
  assert.equal(c.inspect().unresolved, undefined); assert.match(c.inspect().halt!, /rewind/);
  assert.equal(c.decide(at(o, 111)).type, "noop");
});

test("XA LIVE failed nonce reads retain reservations and later healthy reads can recover", async () => {
  const c = createLiveAgent(), o = obs(); await c.decide(o, context(o, []));
  for (const b of [108, 109, 110]) {
    const x = at(o, b), ctx = nonceContext(x, 100);
    (ctx.publicClient as any).getTransactionCount = async () => { throw Error("RPC unavailable"); };
    assert.equal((await c.decide(x, ctx)).type, "noop"); assert.ok(c.inspect().unresolved);
  }
  for (const b of [111, 112, 113]) { const x = at(o, b); await c.decide(x, nonceContext(x, 100)); }
  assert.equal(c.inspect().unresolved, undefined);
});

// Execute the production gate, not a duplicated TypeScript interpretation.
function telemetryGate(records: any[]) {
  const dir = mkdtempSync(join(tmpdir(), "xa-1-gate-"));
  try {
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, "agents/cand.jsonl"), records.map(x => JSON.stringify(x) + "\n").join(""));
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ runId: "fixture", blocksProcessed: 360,
      loopIterations: 362, runStartBlock: 1286, finalBlock: 1646, blockTimeSec: 2,
      valueSeries: { failedReads: 0 }, violations: [], agents: [{ id: "cand", pnlUsdc: 0 }] }));
    const events: any[] = [{ type: "run_started_realtime", runId: "fixture", runBlocks: 360 },
      { type: "agents_registered", agents: [{ id: "cand" }] },
      { type: "agents_ready", ready: [{ id: "cand" }], launched: 1, timedOut: false, late: [], exited: [] }];
    for (let b = 1287; b <= 1646; b++) events.push({ type: "round_timing", blockNumber: b, blocksCaughtUp: 1, totalMs: 1 });
    events.push(...[0, 0].map(() => ({ type: "round_timing", blockNumber: 1646, blocksCaughtUp: 0, totalMs: 1 })),
      { type: "run_completed", runId: "fixture" });
    writeFileSync(join(dir, "events.jsonl"), events.map(x => JSON.stringify(x) + "\n").join(""));
    const py = `import importlib.util,sys,json,argparse
from pathlib import Path
sys.path.insert(0, str(Path('ascon-notes/league').resolve()))
spec=importlib.util.spec_from_file_location('gate','ascon-notes/league/degradation-gate.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
r=gate.extract((Path(sys.argv[1]),'calm','0'),argparse.Namespace(blocks=360,expected_loops=362,block_time_sec=2,max_p99_fraction=.5))
print(json.dumps(r,default=str))`;
    const result = spawnSync("python3", ["-B", "-c", py, dir], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function telemetryFixture() {
  const records: any[] = dev6.runtime.map((x: any) => ({ ...x })), live = createLiveAgent();
  for (let block = 1285; block <= 1646; block++) {
    const o = dev6Obs(block, dev6Frame(1312).wallet); o.round = 0; // never confuse round ordinal with block
    const a = await live.decide(o, context(o, [], x => records.push({ agentId: "cand", ...x })));
    if (a.type === "noop") records.push({ agentId: "cand", round: block, action: { type: "noop" }, reason: a.reason });
  }
  return records;
}

test("XA telemetry production gate accepts integer blocks and rejects missing round", async () => {
  const rows = await telemetryFixture(), good = telemetryGate(rows);
  assert.deepEqual(good.blocked, []); assert.deepEqual(good.failed, []);
  assert.equal(good.agents.cand.decisions, 360);
  assert.equal(good.agents.cand.submit_failed, 1);
  for (const row of rows.filter(x => "action" in x)) assert.ok(Number.isSafeInteger(row.round) && row.round >= 1285);
  const missing = clone(rows); delete missing.find(x => x.state && x.action).round;
  assert.ok(telemetryGate(missing).blocked.includes("agent telemetry cand"));
});

test("XA telemetry production gate enforces identity startup caps and submission blockSeen", async () => {
  const rows = await telemetryFixture();
  const corruptions = [
    (r: any[]) => { r[1].agentId = "xa-1"; },
    (r: any[]) => { r.shift(); },
    (r: any[]) => { r.push(clone(r[0])); },
    ...["log_cap_reached", "log_line_truncated"].map(event => (r: any[]) => { r.push({ agentId: "cand", event }); }),
    ...["submitted", "submit_failed"].flatMap(event => [undefined, "1312", 1312.5].map(blockSeen => (r: any[]) => {
      r.find(x => x.event === event).blockSeen = blockSeen;
    })),
  ];
  for (const corrupt of corruptions) {
    const broken = clone(rows); corrupt(broken);
    assert.ok(telemetryGate(broken).blocked.includes("agent telemetry cand"));
  }
});

test("XA telemetry compact ledger fits actual runtime logger budget", async () => {
  const rows = await telemetryFixture(), dir = mkdtempSync(join(tmpdir(), "xa-1-log-"));
  try {
    const log = createJsonlAppender(dir, "cand");
    rows.forEach(log);
    const raw = readFileSync(join(dir, "agents/cand.jsonl"), "utf8");
    assert.ok(Buffer.byteLength(raw) < 240_000, `${Buffer.byteLength(raw)} bytes exceeds fixture budget`);
    const parsed = raw.trim().split("\n").map(x => JSON.parse(x));
    assert.equal(parsed.length, rows.length);
    assert.ok(!parsed.some(x => ["log_cap_reached", "log_line_truncated"].includes(x.event)));
    assert.ok(Math.max(...raw.trim().split("\n").map(x => Buffer.byteLength(x))) < 2048);
    for (const x of parsed.filter(x => x.state)) {
      assert.equal(x.state.initial, undefined); assert.equal(x.state.wallet, undefined);
      assert.equal(x.state.pending?.before, undefined); assert.equal(x.state.pending?.plan, undefined);
    }
    console.log(`xa-1 362-block telemetry fixture: ${Buffer.byteLength(raw)} bytes; historical cand ${dev6.counts.bytes}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
test("XA pending entry reservation never expires or reuses balances", () => {
  const c = createAgent(), o = obs(), a = c.decide(o); assert.notEqual(a.type, "noop");
  for (const n of [100, 101, 105, 125]) assert.equal(c.decide(at(o, n)).type, "noop");
  assert.equal(c.inspect().unresolved!.phase, "entry"); assert.equal(c.inspect().lot, undefined);
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
  assert.match(c.inspect().halt!, /ambiguous|confirmation deadline/); assert.ok(c.inspect().unresolved);
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
  assert.equal(c.inspect().unresolved!.phase, "exit");
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
    if (mode === "partial") y.balances.wethWei = String(BigInt(y.balances.wethWei) + BigInt(a.amountIn) / 1_000_000n + 2n);
    if (mode === "noCash") y.balances.usdcUnits = x.balances.usdcUnits;
    if (mode === "noGas") y.balances.ethWei = x.balances.ethWei;
    if (mode === "other") y.baseBalances!.WBTC = "40000001";
    assert.equal(c.decide(y).type, "noop"); assert.equal(c.inspect().closed, 0);
    if (mode === "partial") { c.decide(at(y, 104)); assert.equal(c.inspect().closed, 0); }
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
  assert.equal(typeof logs[0].state.observed.USDC, "string");
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
