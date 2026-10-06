import { installLaunchArtifactFixture, launchEntries, LAUNCH_RUNTIME } from "./fixtures/ascon-launch.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TOKENS } from "@eris/sdk/constants.js";
import { decodeFunctionData } from "viem";
import { swapRouterAbi } from "@eris/sdk/abis.js";
import { decide, decideWithParams as specialist } from "../example/agents/zeta-2/agent.js";
import { chooseAction, decide as delta, decideWithParams as persisted, DEFAULT_PARAMS as D } from "../example/agents/zeta-2/delta.js";
import { chooseAction as original, DEFAULT_PARAMS as OLD } from "../example/agents/ascon-zeta/delta.js";
import { decide as launch, resetLaunchState } from "../example/agents/zeta-2/launch.js";
const selected = { ...OLD, bidMode: 2, bidProfitShareBps: 3000, gasPerSwap: 140000 };
const off = { launch: false, redemption: false, stabilityPool: false };
function obs(extra: any = {}): any {
  return { round: 10, blockNumber: 10, blocksRemaining: 100, enabledProtocols: ["uniswap"],
    balances: { usdcUnits: "25000000000", wethWei: "8000000000000000000", ethWei: "1000000000000000000" },
    limits: { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: "5000000000" },
    competition: { maxCompetitorPriorityFeeWei: "2000000000" },
    fairPriceUsdcPerWeth: 3000, fairPricesUsd: { WETH: 3000 }, protocols: {}, ...extra };
}
function arb(extra: any = {}): any { return obs({ protocols: {
  uniswap: { pool: { priceUsdcPerWeth: 2800, fee: 3000 } },
  balancer: { priceUsdcPerWeth: 3200, effectiveHalfSpreadBps: 30, buyPriceUsdcPerWeth: 3209.6, sellPriceUsdcPerWeth: 3190.4 },
}, ...extra }); }
function baseArb(base: string, block = 10): any {
  const o = arb({ blockNumber: block, fairPricesUsd: { [base]: 3000 }, baseBalances: { [base]: "8000000000000000000" }, baseDecimals: { [base]: 18 } });
  o.protocols.uniswap = { markets: { [`${base}/USDC`]: o.protocols.uniswap.pool } };
  o.protocols.balancer = { markets: { [`${base}/USDC`]: o.protocols.balancer } };
  return o;
}
test("adopted a30 defaults are baked in without environment reads", async () => {
  assert.deepEqual(D, selected);
  for (const file of ["agent.ts", "delta.ts", "launch.ts"]) {
    const src = await readFile(new URL(`../example/agents/zeta-2/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /process\.env|numberEnv\(/);
    assert.doesNotMatch(src, /from\s+["']\.\.\/(?!lib\/|runtime\/)/);
  }
});
test("1 rejects an unfunded sell bundle and keeps the funded alternative", () => {
  const o = arb(); o.balances.wethWei = "0";
  assert.equal((original(o, selected) as any).type, "bundle");
  const a: any = chooseAction(o);
  assert.notEqual(a.type, "bundle"); assert.equal(a.tokenIn, "USDC");
  o.balances.wethWei = "10000000000000000";
  assert.notEqual((chooseAction(o) as any).type, "bundle", "positive but insufficient balance");
});
test("1 skips the strongest unfunded base in favor of a funded bundle", () => {
  const o = arb(); o.protocols.uniswap.markets = { "WBTC/USDC": { priceUsdcPerWeth: 1000, fee: 3000 } };
  o.protocols.balancer.markets = { "WBTC/USDC": { priceUsdcPerWeth: 5000 } };
  o.fairPricesUsd.WBTC = 3000; o.baseBalances = { WBTC: "0" }; o.baseDecimals = { WBTC: 8 };
  const a: any = chooseAction(o); assert.equal(a.type, "bundle"); assert.equal(a.actions[1].tokenIn, "WETH");
});
test("2 inventory lower bound includes fees and adverse execution instead of nominal zero net", () => {
  const o = arb(); o.balances.wethWei = "7200000000000000000";
  o.protocols.uniswap.pool.fee = 40000;
  const a: any = chooseAction(o, { ...D, inventoryBandBps: 1000 });
  if (a.type === "bundle") {
    const conservativeBuy = BigInt(Math.floor(Number(a.actions[0].amountIn) / 1e6 / 2800 * .96 * .988 * 1e18));
    assert.ok(BigInt(o.balances.wethWei) + conservativeBuy - BigInt(a.actions[1].amountIn) >= 7200000000000000000n);
  } else assert.equal(a.tokenIn, "USDC", "safe single leg fallback remains available");
});
test("3 unknown initial inventory never swallows a funded decision", () => {
  const a: any = chooseAction(baseArb("OTHER"), { ...D, inventoryBandBps: 1000 });
  assert.ok(a); assert.equal(a.type, "bundle"); assert.equal(a.actions[1].base, "OTHER");
});
for (const direction of ["buy", "sell"]) test(`4 invalid ${direction} quote retains spot fee deduction`, () => {
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const price = direction === "buy" ? 2979 : 3021;
    const o = obs({ protocols: { balancer: { priceUsdcPerWeth: price, effectiveHalfSpreadBps: 30,
      buyPriceUsdcPerWeth: direction === "buy" ? invalid : 4000,
      sellPriceUsdcPerWeth: direction === "sell" ? invalid : 2000 } } });
    assert.equal((chooseAction(o, { ...D, useExecutableQuotes: true }) as any).type, "noop");
  }
});
test("5 bundle persistence follows leg base without WETH view or shared credit", () => {
  const state = new Map(), p = { ...D, persistBlocks: 2 };
  assert.equal((persisted(arb({ blockNumber: 20 }), p, state) as any).type, "noop");
  assert.equal((persisted(baseArb("WBTC", 21), p, state) as any).type, "noop");
  assert.equal((persisted(baseArb("WBTC", 22), p, state) as any).type, "bundle");
});
for (const executable of [false, true]) for (const buy of [false, true]) test(`6 actual expected profit funds bid once (quote=${executable}, buy=${buy})`, () => {
  const price = buy ? 2955 : 3045;
  const o = obs({ protocols: { balancer: { priceUsdcPerWeth: price, effectiveHalfSpreadBps: 30,
    buyPriceUsdcPerWeth: buy ? price : 4000, sellPriceUsdcPerWeth: buy ? 2000 : price } } });
  const p = { ...selected, useExecutableQuotes: executable, GAP_GAIN: 199999 };
  const before: any = original(o, p), after: any = chooseAction(o, p);
  assert.ok(BigInt(before.maxPriorityFeePerGasWei) >= 100000000n);
  assert.ok(BigInt(after.maxPriorityFeePerGasWei) > 100000000n);
  assert.equal(after.amountIn, before.amountIn, "selection/sizing unchanged");
  const notional = buy ? Number(after.amountIn) / 1e6 : Number(after.amountIn) / 1e18 * 3000;
  const edge = (buy ? 3000 / price : price / 3000) * (executable ? 1 : .997) * .9925 - 1;
  const budget = BigInt(Math.floor(notional * edge * 1e6)) * 3000n * 10n ** 14n / (140000n * 3000000000n);
  assert.equal(BigInt(after.maxPriorityFeePerGasWei), budget < 2100000000n ? budget : 2100000000n);
});
const liq = { eusdBalanceWei: "0", spDepositEusdWei: "0", spEthGainWei: "0", suggestedGasReserveWei: "0", marketQuoted: false,
  discountBps: 20, redemptionRateBps: 100, redemptionEdgeBps: -80, mcr: 1.1 };
test("7 endgame withdraws all SP principal before liquidation and attempts dust in final three blocks", () => {
  const p = { ...off, stabilityPool: true, redemption: true };
  const o = obs({ blockNumber: 10000, blocksRemaining: 20, protocols: { liquity: { ...liq, spDepositEusdWei: "500000000000000000000", riskiestTrove: { icr: 1, owner: TOKENS.WETH.address } } } });
  const a: any = specialist(o, p); assert.equal(a.type, "liquityWithdrawFromSP"); assert.equal(a.amountEusdWei, o.protocols.liquity.spDepositEusdWei);
  o.blocksRemaining = 3;
  for (const amount of ["1", "500000000000000000000"]) {
    o.protocols.liquity = { ...liq, eusdBalanceWei: amount };
    const exit: any = specialist(o, p); assert.equal(exit.type, "liquitySwapEusd"); assert.equal(exit.tokenIn, "EUSD"); assert.equal(exit.amountIn, amount);
  }
});
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
installLaunchArtifactFixture();
function harness(count = 1) {
  resetLaunchState();
  const tokens = Array.from({ length: count }, (_, i) => address(0x200 + i));
  const pools = Array.from({ length: count }, (_, i) => address(0x100 + i));
  const h = { held: new Map<string, bigint>(), flow: 3000000000n, failState: false, failFlow: false, failQuote: false,
    quote: 2000000000n, calls: [] as string[], entries: pools.flatMap((market, i) => launchEntries(market, tokens[i], address(3))) };
  const ctx: any = { address: address(4), log() {}, publicClient: {
    call: async () => ({ data: LAUNCH_RUNTIME }),
    readContract: async ({ address: addr, functionName }: any) => {
      h.calls.push(functionName);
      if (functionName === "fee") return 3000n;
      if (functionName === "slot0") { if (h.failState) throw Error("state unavailable"); return [2n ** 96n]; }
      if (functionName === "liquidity") return 100000n;
      return addr.toLowerCase() === TOKENS.USDC.address.toLowerCase() ? 1000000000000n : h.held.get(addr.toLowerCase()) ?? 0n;
    },
    getLogs: async () => { h.calls.push("flow"); if (h.failFlow) throw Error("flow unavailable"); return [{ args: { amount0: -h.flow, amount1: h.flow } }]; },
    simulateContract: async () => { h.calls.push("quote"); if (h.failQuote) throw Error("quote unavailable"); return { result: [h.quote] }; },
  } };
  const at = (block: number, remaining = 100) => obs({ blockNumber: block, round: block, blocksRemaining: remaining, registry: { entries: h.entries } });
  const run = (block: number, remaining = 100) => launch(at(block, remaining), ctx) as Promise<any>;
  const enter = async () => { await run(2); await run(3); const a = await run(4); assert.match(a.reason, /entry/); h.held.set(tokens[0], 5n * 10n ** 18n); };
  return { h, ctx, at, run, enter, tokens };
}
test("launch codehash RPC timeout is bounded and retries on the next decision", async () => {
  const f = harness(); let starts = 0;
  f.ctx.publicClient.call = () => { starts++; return new Promise(() => {}); };
  const began = Date.now();
  await f.run(2);
  assert.equal(starts, 1, "the artifact's creation call was attempted");
  assert.ok(Date.now() - began < 2500, "codehash discovery must share the RPC timeout");
  f.ctx.publicClient.call = async () => { starts++; return { data: LAUNCH_RUNTIME }; };
  await f.run(3);
  assert.equal(starts, 2, "failed hash lookup must not poison the next decision");
});

for (const trap of ["missing token", "other creator", "changed code", "foreign code", "own pool"]) {
  for (const mixed of [false, true]) test(`launch excludes ${trap}, mixed=${mixed}`, async () => {
    const f = harness(mixed ? 2 : 1);
    const pool = f.h.entries[0], token = f.h.entries[1];
    if (trap === "missing token") f.h.entries.splice(1, 1);
    if (trap === "other creator") token.creator = address(99);
    if (trap === "changed code") token.codehashNow = `0x${"f".repeat(64)}`;
    if (trap === "foreign code") token.codehashAtRegistration = token.codehashNow = `0x${"f".repeat(64)}`;
    if (trap === "own pool") pool.mine = true;
    const read = f.ctx.publicClient.readContract;
    const readAddresses: string[] = [];
    f.ctx.publicClient.readContract = (args: any) => {
      readAddresses.push(args.address);
      return read(args);
    };
    assert.equal((await f.run(2)).type, "noop");
    assert.equal((await f.run(3)).type, "noop");
    const action = await f.run(4);
    assert.ok(!readAddresses.includes(pool.market), "rejected pool must not even be watched");
    if (mixed) {
      assert.equal(action.type, "rawBundle");
      assert.match(action.reason, /entry/);
      assert.equal(swapToken(action), f.tokens[1], "only the environment-shaped token is bought");
    } else {
      assert.equal(action.type, "noop");
      assert.equal(f.h.calls.length, 0, "trap-only registry starts no trading RPCs");
    }
  });
}

for (const block of [4, 8]) test(`8 launch tracks held positions across same/missing block ${block}`, async () => {
  const f = harness(); await f.enter(); f.h.flow = 0n;
  const a = await f.run(block, 3); assert.equal(a.type, "rawBundle"); assert.match(a.reason, /exit/);
});
test("8 dispatcher does not reset launch holdings on a gap", async () => {
  const f = harness();
  await decide(f.at(100), f.ctx); await decide(f.at(101), f.ctx); const entry: any = await decide(f.at(102), f.ctx); assert.match(entry.reason, /entry/);
  f.h.held.set(f.tokens[0], 5n * 10n ** 18n); f.h.flow = 0n;
  const a: any = await decide(f.at(110, 3), f.ctx); assert.match(a.reason, /exit/);
});
test("9 expired budget starts no new RPC work across a large registry", async () => {
  const f = harness(100); let now = 0, starts = 0;
  const originalNow = Date.now; Date.now = () => now;
  f.ctx.publicClient.readContract = async () => { starts++; now = 4001; return 3000n; };
  try { await f.run(2); assert.equal(starts, 1); } finally { Date.now = originalNow; }
});
test("9 timeouts bound each decision and stale slots recover on later decisions", async () => {
  const f = harness(20); let starts = 0;
  f.ctx.publicClient.readContract = () => { starts++; return new Promise(() => {}); };
  const begin = Date.now(); await f.run(2); const first = starts; await f.run(3);
  assert.ok(first <= 4); assert.ok(starts > first && starts <= first + 4);
  assert.ok(Date.now() - begin < 9000, "each decision obeys its four-second budget");
});
test("9 early rejected state reads cannot orphan unbounded sibling RPCs", async () => {
  const f = harness(); await f.run(2);
  let hanging = 0;
  f.ctx.publicClient.readContract = ({ functionName }: any) => {
    if (functionName === "slot0") return Promise.reject(Error("unavailable"));
    hanging++; return new Promise(() => {});
  };
  for (let block = 3; block < 10; block++) await f.run(block);
  assert.equal(hanging, 2, "same pending liquidity/reserve reads must not restart");
});
for (const failure of ["failState", "failFlow", "failQuote"] as const) for (const remaining of [3, 12, 100]) test(`10 mandatory exit survives ${failure}, remaining=${remaining}`, async () => {
  const f = harness(); await f.enter(); f.h[failure] = true;
  const a = await f.run(remaining === 100 ? 64 : 5, remaining);
  if (failure === "failQuote" && remaining > 3) assert.equal(a.type, "noop");
  else { assert.equal(a.type, "rawBundle"); assert.match(a.reason, /exit/); }
});
test("10 dust quote never permanently retires a held position", async () => {
  const f = harness(); await f.enter(); f.h.quote = 1n;
  assert.equal((await f.run(5, 12)).type, "noop", "G1 retries a rounded-to-zero protected quote");
  f.h.quote = 2000000000n; assert.equal((await f.run(6, 3)).type, "rawBundle");
});
for (const noise of [0n, 1n]) test(`11 ${noise} flow resets confirmation streak`, async () => {
  const f = harness(); await f.run(2); f.h.flow = noise; await f.run(3); f.h.flow = 3000000000n;
  assert.equal((await f.run(4)).type, "noop"); assert.equal((await f.run(5)).type, "noop"); assert.equal((await f.run(6)).type, "rawBundle");
});
test("11 duplicate blocks do not advance streak and gaps cannot count as consecutive", async () => {
  const f = harness(); await f.run(2); await f.run(2); await f.run(3); assert.equal((await f.run(5)).type, "noop");
  assert.equal((await f.run(6)).type, "noop"); assert.equal((await f.run(7)).type, "rawBundle");
});
function swapToken(a: any): string { return ((decodeFunctionData({ abi: swapRouterAbi, data: a.txs[1].data }).args as any)[0].tokenOut as string).toLowerCase(); }
test("12 only the returned entry is marked pending", async () => {
  const f = harness(2); await f.run(2); await f.run(3);
  const first = await f.run(4); assert.equal(swapToken(first), f.tokens[0]);
  const second = await f.run(5); assert.equal(second.type, "rawBundle"); assert.equal(swapToken(second), f.tokens[1]);
});
test("12 exit priority does not mark an unreturned entry pending", async () => {
  const f = harness(2); await f.run(2); await f.run(3); await f.run(4); f.h.held.set(f.tokens[0], 5n * 10n ** 18n);
  // Only the held first pool has selling flow; the second still qualifies.
  f.ctx.publicClient.getLogs = async ({ address: pool }: any) => [{ args: { amount0: 0n, amount1: pool === address(0x100) ? -3000000000n : 3000000000n } }];
  const exit = await f.run(5); assert.match(exit.reason, /exit/); f.h.held.set(f.tokens[0], 0n);
  const next = await f.run(6); assert.match(next.reason, /entry/); assert.equal(swapToken(next), f.tokens[1]);
});
test("default decisions equal explicit selected a30 settings over 3000 seeded observations", async () => {
  resetLaunchState();
  let seed = 0x5eed1234;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  let unchanged = 0;
  for (let i = 0; i < 3000; i++) {
    const fair = 500 + rand() * 70000;
    const o = obs({ blockNumber: 20000 + i, fairPriceUsdcPerWeth: fair, fairPricesUsd: { WETH: fair }, balances: {
      usdcUnits: String(Math.floor(rand() * 1e12)), wethWei: String(BigInt(Math.floor(rand() * 30)) * 10n ** 18n), ethWei: "0" }, protocols: {
      uniswap: { pool: { priceUsdcPerWeth: fair * (.85 + rand() * .3), fee: 3000 } },
      balancer: { priceUsdcPerWeth: fair * (.85 + rand() * .3) },
    } });
    const explicit = chooseAction(o, selected), actual = delta(o);
    assert.deepEqual(actual, explicit); assert.deepEqual(specialist(o, off), explicit);
    assert.deepEqual(await decide(o, {} as any), explicit);
    if (i % 2 === 0) {
      const btc = baseArb("WBTC", 20000 + i);
      btc.baseDecimals.WBTC = 8; btc.baseBalances.WBTC = String(Math.floor(rand() * 1e9));
      btc.competition.maxCompetitorPriorityFeeWei = String(Math.floor(rand() * 5e9));
      assert.deepEqual(delta(btc), chooseAction(btc, selected));
    }
    const prior: any = original(o, selected);
    if (prior.type !== "bundle") {
      const withoutFee = ({ maxPriorityFeePerGasWei: _fee, ...action }: any) => action;
      assert.deepEqual(withoutFee(actual), withoutFee(prior), "single-leg changes are limited to bid profit");
    }
    if (prior.type === "bundle" && BigInt(prior.actions[1].amountIn) <= BigInt(o.balances.wethWei)) {
      assert.deepEqual(actual, prior, "funded default bundles preserve baseline decisions"); unchanged++;
    }
  }
  assert.ok(unchanged > 1000);
});

test("launch RPC failure falls through to delta and normal specialist behavior remains", async () => {
  const f = harness(); f.ctx.publicClient.readContract = async () => { throw Error("offline mock"); };
  const o = arb({ blockNumber: 40000, registry: { entries: f.h.entries } });
  assert.deepEqual(await decide(o, f.ctx), delta(o));
  const p = { ...off, stabilityPool: true, redemption: true };
  const mid = obs({ blockNumber: 40001, protocols: { liquity: { ...liq, eusdBalanceWei: "500000000000000000000" } } });
  assert.equal((specialist(mid, p) as any).type, "liquityProvideToSP");
  mid.protocols.liquity = { ...liq, marketQuoted: true, eusdBalanceWei: "500000000000000000000", discountBps: 200, redemptionEdgeBps: 100 };
  assert.equal((specialist(mid, p) as any).type, "liquityRedeem");
});

function minOut(a: any): bigint { return (decodeFunctionData({ abi: swapRouterAbi, data: a.txs[1].data }).args as any)[0].amountOutMinimum; }
for (const remaining of [0, 1, 2, 3, 4, 11, 12, 13]) test(`C1 quote failure fallback boundary remaining=${remaining}`, async () => {
  const f = harness(); await f.enter(); f.h.failQuote = true; f.h.failState = true; f.h.failFlow = true;
  const a = await f.run(64, remaining); // Hold limit also requires exit at remaining=13.
  if (remaining <= 3) { assert.equal(a.type, "rawBundle"); assert.equal(minOut(a), 1n); }
  else {
    assert.equal(a.type, "noop");
    f.h.failQuote = false;
    const retry = await f.run(65, remaining - 1);
    assert.equal(retry.type, "rawBundle"); assert.equal(minOut(retry), f.h.quote * 9000n / 10000n);
  }
});
test("W1 unchanged eUSD attempts yield to WETH after three blocks, duplicate calls do not count", () => {
  const p = { ...off, redemption: true };
  const o = obs({ blockNumber: 1, protocols: { liquity: { ...liq, marketQuoted: true, discountBps: -1, eusdBalanceWei: String(500n * 10n ** 18n) } } });
  specialist(o, off); o.balances.wethWei = String(9n * 10n ** 18n); o.blocksRemaining = 20;
  for (let block = 2; block <= 4; block++) {
    o.blockNumber = block;
    for (let duplicate = 0; duplicate < 3; duplicate++) assert.equal((specialist(o, p) as any).type, "liquitySwapEusd");
  }
  o.blockNumber = 5; assert.equal((specialist(o, p) as any).tokenIn, "WETH");
  o.blockNumber = 24; assert.equal((specialist(o, p) as any).tokenIn, "WETH");
  o.blockNumber = 25; assert.equal((specialist(o, p) as any).type, "liquitySwapEusd");
  o.blockNumber = 26; o.blocksRemaining = 3; assert.equal((specialist(o, p) as any).type, "liquitySwapEusd");
  o.blockNumber = 27; o.blocksRemaining = 2; assert.equal((specialist(o, p) as any).tokenIn, "WETH");
});
test("W1 dust yields to delta but gets one last-three-block attempt; balance progress resets failures", () => {
  const p = { ...off, redemption: true };
  const o = arb({ blockNumber: 0, blocksRemaining: 20 }); o.protocols.liquity = { ...liq, eusdBalanceWei: "1" };
  assert.equal((specialist(o, p) as any).type, "bundle");
  o.blockNumber = 1; o.blocksRemaining = 3; assert.equal((specialist(o, p) as any).type, "liquitySwapEusd");
  o.blockNumber = 2; o.blocksRemaining = 2; assert.equal((specialist(o, p) as any).type, "bundle");
  o.blockNumber = 0; o.blocksRemaining = 20; o.protocols.liquity.eusdBalanceWei = String(500n * 10n ** 18n);
  for (let block = 0; block < 6; block++) {
    o.blockNumber = block; o.protocols.liquity.eusdBalanceWei = String(BigInt(o.protocols.liquity.eusdBalanceWei) - 10n ** 18n);
    assert.equal((specialist(o, p) as any).type, "liquitySwapEusd");
  }
});
for (const executable of [false, true]) for (const buy of [false, true]) test(`W2 adverse is deducted once and bids obey profit and existing caps quote=${executable} buy=${buy}`, () => {
  const price = buy ? 2900 : 3100;
  const o = obs({ protocols: { balancer: { priceUsdcPerWeth: price, effectiveHalfSpreadBps: 30,
    buyPriceUsdcPerWeth: buy ? price : 4000, sellPriceUsdcPerWeth: buy ? 2000 : price } } });
  for (const ceiling of [5000000000n, 150000000n]) {
    o.limits.maxPriorityFeePerGasWei = String(ceiling);
    const a: any = chooseAction(o, { ...D, useExecutableQuotes: executable });
    const notional = buy ? Number(a.amountIn) / 1e6 : Number(a.amountIn) / 1e18 * 3000;
    const gross = (buy ? 3000 / price : price / 3000) * (executable ? 1 : .997);
    const profitMicro = BigInt(Math.floor(notional * Math.max(0, gross * .9925 - 1) * 1e6));
    const budget = profitMicro * 3000n * 10n ** 14n / (140000n * 3000000000n);
    const expected = [budget, ceiling, 2100000000n].reduce((a, b) => a < b ? a : b);
    assert.equal(BigInt(a.maxPriorityFeePerGasWei), expected);
  }
  o.protocols.balancer.priceUsdcPerWeth = buy ? 2970 : 3030;
  const a: any = chooseAction(o); assert.equal(a.maxPriorityFeePerGasWei, "0", "nonpositive conservative profit cannot fund a bid");
});
for (const quote of [false, true]) for (const currentBalance of [7200500000000000000n, 8780000000000000000n]) test(`W3 inventory estimate pads both tails quote=${quote} balance=${currentBalance}`, () => {
  const o = arb(); o.balances.wethWei = String(currentBalance);
  if (quote) {
    o.protocols.uniswap.pool.priceUsdcPerWeth = 3200;
    o.protocols.balancer = { priceUsdcPerWeth: 2800, effectiveHalfSpreadBps: 30,
      buyPriceUsdcPerWeth: 2800 / .997, sellPriceUsdcPerWeth: 2800 * .997 };
  }
  const a: any = chooseAction(o, { ...D, inventoryBandBps: 1000 });
  assert.equal(a.type, "bundle");
  const gross = Number(a.actions[0].amountIn) / 1e6 / 2800;
  const low = BigInt(Math.floor(gross * .997 * (1 - (quote ? .012 : .024)) * 1e18));
  const high = BigInt(Math.floor(gross * 1.012 * 1e18));
  const current = BigInt(o.balances.wethWei), sell = BigInt(a.actions[1].amountIn);
  assert.ok(current + high - sell <= 8800000000000000000n);
  assert.ok(current + low - sell >= 7200000000000000000n);
});
test("W4 rewind drops zero-balance pending entry immediately", async () => {
  const f = harness(); await f.run(100); await f.run(101); await f.run(102);
  await f.run(10); await f.run(11); await f.run(12);
  assert.match((await f.run(13)).reason, /entry/);
});
test("W4 rewind rebases held timestamp, forward gap preserves hold age", async () => {
  const f = harness(); await f.run(100); await f.run(101); await f.run(102); f.h.held.set(f.tokens[0], 5n * 10n ** 18n); f.h.flow = 0n;
  assert.equal((await f.run(10)).type, "noop");
  assert.equal((await f.run(69)).type, "noop");
  assert.match((await f.run(70)).reason, /exit/);
});
test("W5 expired holdings request releases its key for a recovered client", async (t) => {
  const f = harness(); await f.enter(); const read = f.ctx.publicClient.readContract;
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  let release!: (value: bigint) => void;
  f.ctx.publicClient.readContract = () => new Promise<bigint>(resolve => { release = resolve; });
  assert.equal((await f.run(5, 12)).type, "noop");
  // readUntrusted returns after 1000 ms; expire the wrapper's 1200 ms key too.
  now += 1201;
  f.ctx.publicClient.readContract = read;
  assert.equal((await f.run(6, 11)).type, "rawBundle");
  release(0n);
  assert.equal((await f.run(7, 10)).type, "rawBundle");
});
test("W5 optional hanging reads leave a slot for mandatory holdings and quote", async () => {
  const f = harness(2); await f.enter(); const read = f.ctx.publicClient.readContract;
  let starts = 0;
  f.ctx.publicClient.readContract = (args: any) => {
    if (args.functionName === "slot0") return Promise.reject(Error("state unavailable"));
    if (args.functionName === "liquidity" || args.address.toLowerCase() === TOKENS.USDC.address.toLowerCase()) {
      starts++; return new Promise(() => {});
    }
    return read(args);
  };
  await f.run(5); assert.ok(starts <= 3);
  assert.equal((await f.run(6, 12)).type, "rawBundle");
});

test("W2 one-percent gross edge becomes 0.2425 percent, including budgets below default fee", () => {
  const o = obs({ balances: { usdcUnits: "100000000", wethWei: "0", ethWei: "0" }, protocols: {
    balancer: { priceUsdcPerWeth: 3000 / 1.01, effectiveHalfSpreadBps: 0,
      buyPriceUsdcPerWeth: 3000 / 1.01, sellPriceUsdcPerWeth: 2000 } } });
  const a: any = chooseAction(o);
  const profitMicro = BigInt(Math.floor(Number(a.amountIn) / 1e6 * (1.01 * .9925 - 1) * 1e6));
  const budget = profitMicro * 3000n * 10n ** 14n / (140000n * 3000000000n);
  assert.ok(budget > 0n && budget < 100000000n);
  assert.equal(BigInt(a.maxPriorityFeePerGasWei), budget);
  o.limits.maxPriorityFeePerGasWei = "1000";
  assert.equal((chooseAction(o) as any).maxPriorityFeePerGasWei, "1000");
});
test("W3 single buy leaves favorable-fill headroom below upper inventory band", () => {
  const o = obs({ balances: { usdcUnits: "25000000000", wethWei: "8790000000000000000", ethWei: "0" },
    protocols: { uniswap: { pool: { priceUsdcPerWeth: 2800, fee: 3000 } } } });
  const a: any = chooseAction(o, { ...D, inventoryBandBps: 1000 });
  assert.equal(a.tokenIn, "USDC");
  const favorable = BigInt(Math.floor(Number(a.amountIn) / 1e6 / 2800 * 1.0075 * 1e18));
  assert.ok(BigInt(o.balances.wethWei) + favorable <= 8800000000000000000n);
});
test("W4 rewind reconciliation survives a failed balance read through dispatcher", async () => {
  const f = harness(); await decide(f.at(100), f.ctx); await decide(f.at(101), f.ctx); await decide(f.at(102), f.ctx);
  const read = f.ctx.publicClient.readContract;
  f.ctx.publicClient.readContract = async () => { throw Error("balance unavailable"); };
  await decide(f.at(10), f.ctx);
  f.ctx.publicClient.readContract = read;
  await decide(f.at(11), f.ctx); await decide(f.at(12), f.ctx); await decide(f.at(13), f.ctx);
  assert.match((await decide(f.at(14), f.ctx) as any).reason, /entry/);
});
test("W5 late stale settlement cannot remove a still-pending replacement with the same key", async () => {
  const f = harness(); await f.enter();
  let now = 0, starts = 0;
  const oldNow = Date.now, releases: ((value: bigint) => void)[] = [];
  Date.now = () => now;
  f.ctx.publicClient.readContract = () => { starts++; return new Promise<bigint>(resolve => { releases.push(resolve); }); };
  try {
    const first = f.run(5, 12);
    now = 1201;
    const second = f.run(6, 11);
    releases[0](0n); await first;
    assert.equal(starts, 2);
    assert.equal((await f.run(7, 10)).type, "noop");
    assert.equal(starts, 2, "old completion must not release replacement's slot/key");
    releases[1](0n); await second;
  } finally { Date.now = oldNow; for (const release of releases) release(0n); }
});

// G1 supersedes the old dust test's nonterminal minOut=1 expectation.
for (const remaining of [0, 3, 4, 12, 13]) for (const quote of [0n, 1n, 2n, 3n])
  test(`G1 minOut boundary remaining=${remaining} quote=${quote}`, async () => {
    const f = harness(); await f.enter(); f.h.quote = quote;
    const a = await f.run(64, remaining);
    const calculated = quote * 9000n / 10000n;
    if (remaining > 3 && calculated < 1n) {
      assert.equal(a.type, "noop"); f.h.quote = 2n;
      assert.equal(minOut(await f.run(65, remaining)), 1n, "retry retains the holding");
    } else { assert.equal(a.type, "rawBundle"); assert.equal(minOut(a), calculated || 1n); }
  });

test("G2 quote timeout releases its key and never forces a nonterminal sale", async () => {
  const f = harness(); await f.enter(); const quote = f.ctx.publicClient.simulateContract;
  let release!: (value: any) => void, starts = 0;
  f.ctx.publicClient.simulateContract = () => { starts++; return new Promise(resolve => { release = resolve; }); };
  assert.equal((await f.run(5, 12)).type, "noop");
  f.ctx.publicClient.simulateContract = (args: any) => { starts++; return quote(args); };
  const retry = await f.run(6, 11);
  assert.equal(starts, 2); assert.equal(minOut(retry), f.h.quote * 9000n / 10000n);
  release({ result: [0n] });
  assert.equal(minOut(await f.run(7, 10)), f.h.quote * 9000n / 10000n);
});

function captureWatchCount(f: ReturnType<typeof harness>) {
  let count = -1;
  f.ctx.log = (event: any) => { if (event.signals?.launchPools !== undefined) count = event.signals.launchPools; };
  return () => count;
}
test("G3 idle zero-balance watch is pruned at 30 blocks and not immediately rediscovered", async () => {
  const f = harness(); f.h.flow = 0n; const count = captureWatchCount(f);
  for (let b = 2; b <= 31; b++) await f.run(b);
  assert.equal(count(), 1); await f.run(32); assert.equal(count(), 0);
  f.h.calls.length = 0; await f.run(33); assert.equal(count(), 0); assert.equal(f.h.calls.length, 0);
});
test("G3 fresh discovery is protected and precedes old optional reads", async () => {
  const f = harness(2); const fresh = f.h.entries.splice(2); f.h.flow = 0n;
  await f.run(2); const count = captureWatchCount(f);
  f.h.entries.push(...fresh); const read = f.ctx.publicClient.readContract; const order: string[] = [];
  f.ctx.publicClient.readContract = (args: any) => { order.push(args.functionName); return read(args); };
  await f.run(32); assert.equal(count(), 1); assert.equal(order[0], "fee");
  await f.run(33); assert.equal(count(), 1);
});
test("G3 recent pool activity renews the idle grace period", async () => {
  const f = harness(); f.h.flow = 0n; const count = captureWatchCount(f);
  for (let b = 2; b <= 30; b++) await f.run(b);
  f.h.flow = 1n; await f.run(31); f.h.flow = 0n; await f.run(32);
  assert.equal(count(), 1);
});
for (const mode of ["held", "exiting", "untracked", "unknown"])
  test(`G3 pruning protects ${mode} balances`, async () => {
    const f = harness(); const count = captureWatchCount(f);
    if (mode === "held" || mode === "exiting") { await f.enter(); if (mode === "exiting") await f.run(5, 12); }
    else { f.h.flow = 0n; await f.run(2); }
    if (mode === "untracked") f.h.held.set(f.tokens[0], 1n);
    if (mode === "unknown") {
      const read = f.ctx.publicClient.readContract;
      f.ctx.publicClient.readContract = (args: any) => args.address === f.tokens[0] ? Promise.reject(Error("unknown balance")) : read(args);
    }
    f.h.flow = 0n; await f.run(32); assert.equal(count(), 1);
  });
test("G3 watch cap preserves holdings and prevents unbounded discovery", async () => {
  const f = harness(100); const entries = f.h.entries.splice(2); await f.enter();
  f.h.flow = 0n; f.h.entries.push(...entries); const count = captureWatchCount(f);
  await f.run(5); assert.equal(count(), 32);
  f.h.failState = true; assert.match((await f.run(6, 12)).reason, /exit/);
});
test("G3 stale failed pool can retire after a successful zero balance read", async () => {
  const f = harness(); f.h.flow = 0n; const count = captureWatchCount(f); await f.run(2);
  f.h.failState = true; await f.run(32); assert.equal(count(), 0);
});

test("G4 gap inspects missing sales in one bounded log request even when buying offsets them", async () => {
  const f = harness(); await f.enter(); const ranges: [bigint, bigint][] = [];
  f.ctx.publicClient.getLogs = async ({ fromBlock, toBlock }: any) => {
    ranges.push([fromBlock, toBlock]);
    return fromBlock === 5n ? [{ args: { amount1: -3000000000n } }, { args: { amount1: 9000000000n } }] : [];
  };
  assert.match((await f.run(8)).reason, /exit/); assert.deepEqual(ranges, [[5n, 8n]]);
});
for (const mode of ["logs", "state", "long"]) test(`G4 ${mode} gap uncertainty schedules protected exit on the next block`, async () => {
  const f = harness(); await f.enter(); f.h.flow = 0n;
  const gapBlock = mode === "long" ? 25 : 8;
  // Long gap is still younger than the ordinary 60-block hold limit.
  if (mode === "logs") f.h.failFlow = true;
  if (mode === "state") f.h.failState = true;
  f.h.failQuote = true;
  assert.equal((await f.run(gapBlock)).type, "noop");
  f.h.failQuote = false; f.h.failState = true; f.h.failFlow = true;
  const retry = await f.run(gapBlock + 1); assert.match(retry.reason, /exit/);
  assert.equal(minOut(retry), f.h.quote * 9000n / 10000n);
});

test("G5 prompt describes current exit safeguards and fixed adopted defaults", async () => {
  const p = await readFile(new URL("../example/agents/zeta-2/prompt.md", import.meta.url), "utf8");
  for (const phrase of ["transactions since the last revision", "market history", "mean inclusion latency", "executorTs", "revertTo",
    "minOut", "30", "32", "missing blocks", "endgameNoNewBlocks=0", "legacy raw gap"]) assert.ok(p.includes(phrase), phrase);
  assert.doesNotMatch(p, /rolled back automatically|including[^\n]*endgame bundle-stop/);
});
for (const buy of [true, false]) test(`G6 intentional legacy raw-gap order survives nonpositive conservative profit buy=${buy}`, () => {
  const o = obs({ protocols: { balancer: { priceUsdcPerWeth: buy ? 2970 : 3030, effectiveHalfSpreadBps: 30,
    buyPriceUsdcPerWeth: 3040, sellPriceUsdcPerWeth: 2960 } } });
  const a: any = chooseAction(o), previous: any = original(o, selected);
  assert.equal(a.type, "balancerSwap"); assert.equal(a.tokenIn, buy ? "USDC" : "WETH");
  assert.equal(a.amountIn, previous.amountIn); assert.ok(BigInt(a.amountIn) > 0n);
  assert.equal(a.maxPriorityFeePerGasWei, "0", "intended a30 behavior: clamp bid input, keep the raw-gap trade");
});

test("G4 gap cannot dismiss past selling using a later larger reserve", async () => {
  const f = harness(); await f.enter();
  // The missing block's reserve is unavailable. Its sell may have breached the
  // exit threshold even though it is tiny relative to today's reserve.
  f.h.flow = -1n;
  assert.match((await f.run(8)).reason, /exit/);
});
test("G6 intentional legacy ranking prefers raw gap over conservative profit", () => {
  const o = obs({ protocols: {
    uniswap: { pool: { priceUsdcPerWeth: 2955, fee: 9000 } },
    balancer: { priceUsdcPerWeth: 2958, effectiveHalfSpreadBps: 0,
      buyPriceUsdcPerWeth: 2958, sellPriceUsdcPerWeth: 2958 },
  } });
  const a: any = chooseAction(o), previous: any = original(o, selected);
  assert.equal(a.type, "swap"); assert.equal(a.type, previous.type);
  assert.equal(a.amountIn, previous.amountIn); assert.equal(a.maxPriorityFeePerGasWei, "0");
});
