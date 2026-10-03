import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decide, decideWithParams, parseZetaParams } from "../example/agents/ascon-zeta/agent.js";
import { decide as delta } from "../example/agents/ascon-zeta/delta.js";
import { TOKENS } from "@eris/sdk/constants.js";
import { decide as multiDecide } from "../example/agents/multi-arb/agent.js";
import { decideWithParams as deltaWithParams, DEFAULT_PARAMS as DELTA_DEFAULTS } from "../example/agents/ascon-zeta/delta.js";
import { chooseAction, parseDeltaParams } from "../example/agents/ascon-zeta/delta.js";
import { resetLaunchState } from "../example/agents/ascon-zeta/launch.js";

function observation(overrides: Record<string, unknown> = {}): any {
  return { round: 10, blockNumber: 10, blocksRemaining: 100, enabledProtocols: ["uniswap"],
    balances: { usdcUnits: "25000000000", wethWei: "8000000000000000000", ethWei: "1000000000000000000" },
    limits: { defaultPriorityFeePerGasWei: "100000000" }, protocols: {}, ...overrides };
}
const allOff = { launch: false, redemption: false, stabilityPool: false };
const launchPool = "0x0000000000000000000000000000000000000100";
const token = "0x0000000000000000000000000000000000000200";
const registry = { entries: [{ kind: "uniswapV3Pool", market: launchPool, token0: token, token1: TOKENS.USDC.address,
  creator: "0x0000000000000000000000000000000000000003", mine: false, registeredAtBlock: "1" }] };

test("zeta is self-contained from other agent directories", async () => {
  const { readdir } = await import("node:fs/promises");
  for (const f of await readdir(new URL("../example/agents/ascon-zeta/", import.meta.url))) {
    if (!f.endsWith(".ts")) continue;
    const source = await readFile(new URL(`../example/agents/ascon-zeta/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']\.\.\/(?!lib\/|runtime\/)/, f);
  }
});

test("no specialist opportunity and all experts off exactly match local delta", () => {
  const obs = observation();
  assert.deepEqual(decideWithParams(obs, allOff), delta(obs));
  assert.deepEqual(parseZetaParams("bad"), { launch: true, redemption: true, stabilityPool: true });
  assert.deepEqual(parseZetaParams('{"launch":false}'), { launch: false, redemption: true, stabilityPool: true });
});

test("delta defaults and all specialists off match multi-arb across 3000 seeded observations", () => {
  let seed = 0x5eed1234;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  let mismatches = 0; const causes = new Map<string, number>();
  for (let i = 0; i < 3000; i++) {
    const venueCount = 2 + Math.floor(rand() * 2), fair = 500 + rand() * 70000;
    const prices = [0, 1, 2].map(() => fair * (0.85 + rand() * 0.3));
    const fee = () => Math.floor(rand() * 501);
    const zero = rand() < 0.12;
    const o: any = observation({ blockNumber: 100 + i, balances: {
      usdcUnits: zero ? "0" : String(Math.floor(rand() * 1e12)),
      wethWei: rand() < 0.15 ? "0" : String(BigInt(Math.floor(rand() * 20 + 1)) * 10n ** 18n), ethWei: "0", stables: {},
    }, fairPriceUsdcPerWeth: fair, fairPricesUsd: { WETH: fair, ...(rand() < 0.5 ? { WBTC: 60000 + rand() * 10000 } : {}) },
    baseBalances: { WBTC: rand() < 0.15 ? "0" : String(Math.floor(rand() * 1e9)) }, baseDecimals: { WBTC: 8 } });
    const protocols: any = { uniswap: { pool: { priceUsdcPerWeth: prices[0], fee: fee() * 100 } }, balancer: { priceUsdcPerWeth: prices[1], effectiveHalfSpreadBps: fee(), sellPriceUsdcPerWeth: prices[1] * .997, buyPriceUsdcPerWeth: prices[1] * 1.003 } };
    if (venueCount === 3) protocols.curve = { priceUsdcPerWeth: prices[2], effectiveHalfSpreadBps: fee(), sellPriceUsdcPerWeth: prices[2] * .997, buyPriceUsdcPerWeth: prices[2] * 1.003 };
    if (o.fairPricesUsd.WBTC) {
      protocols.uniswap.markets = { "WBTC/USDC": { priceUsdcPerWeth: 50000 + rand() * 20000, fee: fee() * 100 } };
      protocols.balancer.markets = { "WBTC/USDC": { priceUsdcPerWeth: 50000 + rand() * 20000, effectiveHalfSpreadBps: fee(), sellPriceUsdcPerWeth: 60000, buyPriceUsdcPerWeth: 61000 } };
      if (protocols.curve) protocols.curve.markets = { "WBTC/USDC": { priceUsdcPerWeth: 50000 + rand() * 20000, effectiveHalfSpreadBps: fee(), sellPriceUsdcPerWeth: 60000, buyPriceUsdcPerWeth: 61000 } };
    }
    o.protocols = protocols;
    for (const [label, actual] of [["delta", deltaWithParams(o, { ...DELTA_DEFAULTS }, new Map())], ["zeta-off", decideWithParams(o, allOff)]] as const) {
      try { assert.deepEqual(actual, multiDecide(o)); }
      catch { mismatches++; const key = `${label}:${String((actual as any)?.type)}!=${String((multiDecide(o) as any)?.type)}`; causes.set(key, (causes.get(key) ?? 0) + 1); }
    }
  }
  assert.equal(mismatches, 0, `mismatches=${mismatches}; causes=${JSON.stringify([...causes])}`);
});

test("persistBlocks uses distinct interpolated candidate keys when enabled", async () => {
  const { decideWithParams: persisted, DEFAULT_PARAMS } = await import("../example/agents/ascon-zeta/delta.js");
  const state = new Map(), p = { ...DEFAULT_PARAMS, persistBlocks: 2 };
  const obsAt = (blockNumber: number, cheap: number) => ({ ...observation(), blockNumber,
    fairPriceUsdcPerWeth: 3000, fairPricesUsd: { WETH: 3000 }, protocols: {
      uniswap: { pool: { priceUsdcPerWeth: cheap, fee: 3000 } }, balancer: { priceUsdcPerWeth: 3000, effectiveHalfSpreadBps: 30 },
    } } as any);
  assert.equal((persisted(obsAt(5, 2800), p, state) as any).reason, "gap has not persisted");
  assert.equal((persisted(obsAt(6, 2800), p, state) as any).type, "bundle");
});

test("launch RPC timeout is contained and zeta falls through to delta", async () => {
  resetLaunchState();
  const obs: any = observation({ blockNumber: 8000, registry, fairPriceUsdcPerWeth: 3000,
    fairPricesUsd: { WETH: 3000 }, protocols: {
      uniswap: { pool: { priceUsdcPerWeth: 2800, fee: 3000 } }, balancer: { priceUsdcPerWeth: 3000, effectiveHalfSpreadBps: 30 },
    } });
  const ctx: any = { address: "0x0000000000000000000000000000000000000004",
    publicClient: { readContract: () => new Promise(() => {}) }, log() {} };
  const action: any = await decide(obs, ctx);
  assert.equal(action.type, "bundle");
});

test("launch confirms consecutive buying, then exits on selling, max hold, and endgame", async () => {
  let logs: any[] = [], held = 0n, failQuote = false;
  const client: any = {
    readContract: async ({ functionName, address }: any) => functionName === "fee" ? 3000n : functionName === "slot0" ? [2n ** 96n] : functionName === "liquidity" ? 100000n : address.toLowerCase() === token.toLowerCase() ? held : 1_000_000_000_000n,
    getLogs: async () => logs,
    simulateContract: async () => { if (failQuote) throw new Error("mock quote unavailable"); return { result: [2_000_000_000n] }; },
  };
  const messages: string[] = [];
  const ctx: any = { address: "0x0000000000000000000000000000000000000004", publicClient: client, log(x: any) { messages.push(x.reason); } };
  const obsAt = (block: number, remaining = 100) => observation({ blockNumber: block, round: block, blocksRemaining: remaining, registry,
    fairPriceUsdcPerWeth: 3000, fairPricesUsd: { WETH: 3000 }, protocols: {
      uniswap: { pool: { priceUsdcPerWeth: 2800, fee: 3000 } }, balancer: { priceUsdcPerWeth: 3000, effectiveHalfSpreadBps: 30 },
    } });
  const buyFlow = () => { logs = [{ args: { amount0: -3_000_000_000n, amount1: 3_000_000_000n } }]; };
  await decide(obsAt(2), ctx); buyFlow(); await decide(obsAt(3), ctx); buyFlow(); await decide(obsAt(4), ctx); buyFlow();
  const buy: any = await decide(obsAt(5), ctx);
  assert.equal(buy.type, "rawBundle"); assert.match(buy.reason, /entry/);
  logs = [];
  const fallbackWhileUnfilled: any = await decide(obsAt(6), ctx);
  assert.equal(fallbackWhileUnfilled.type, "bundle", "unfilled launch reservation must not stop delta");
  held = 5n * 10n ** 18n;
  logs = [{ args: { amount0: 2_000_000_000n, amount1: -2_000_000_000n } }];
  const sell: any = await decide(obsAt(7), ctx);
  assert.equal(sell.type, "rawBundle"); assert.match(sell.reason, /exit/);
  failQuote = true;
  const forced: any = await decide(obsAt(8, 3), ctx);
  assert.equal(forced.type, "rawBundle"); assert.match(forced.reason, /forced exit/);
  held = 0n; // simulated confirmation that the exit settled
  const released: any = await decide(obsAt(9, 12), ctx);
  assert.equal(released.type, "bundle", "confirmed exit must release the launch reservation to delta");
});

function bidObs(cheap = 2800, rich = 3300, competitor = "2000000000", fair = 3000): any {
  return { ...observation(), fairPriceUsdcPerWeth: fair, fairPricesUsd: { WETH: fair },
    limits: { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: "5000000000" },
    competition: { maxCompetitorPriorityFeeWei: competitor, maxBlockPriorityFeeWei: competitor, lastTxIndex: null, recentRevertRate: 0 },
    protocols: { uniswap: { pool: { priceUsdcPerWeth: cheap, fee: 3000 } }, balancer: { priceUsdcPerWeth: rich, effectiveHalfSpreadBps: 30 } } };
}
const adaptive = { ...DELTA_DEFAULTS, bidMode: 2 };
test("adaptive bid beats competitor plus bump and respects fee ceiling", () => {
  const o = bidObs();
  const action: any = chooseAction(o, adaptive);
  assert.equal(action.type, "bundle");
  assert.equal(action.maxPriorityFeePerGasWei, "2100000000");
  const capped: any = chooseAction({ ...o, limits: { ...o.limits, maxPriorityFeePerGasWei: "1500000000" } }, adaptive);
  assert.equal(capped.maxPriorityFeePerGasWei, "1500000000");
});
test("adaptive bid stays at default for a poor edge and with no competition", () => {
  const poor = bidObs(); poor.balances.usdcUnits = "1000";
  assert.equal((chooseAction(poor, { ...adaptive, bidBumpWei: 100_000_000_000 }) as any).maxPriorityFeePerGasWei, "100000000");
  assert.equal((chooseAction(bidObs(2800, 3300, "0"), adaptive) as any).maxPriorityFeePerGasWei, "100000000");
  const absent = bidObs(); delete absent.competition;
  assert.equal((chooseAction(absent, adaptive) as any).maxPriorityFeePerGasWei, "100000000");
});
test("bundle fee budget uses two swaps and caps at the exact profit-share boundary", () => {
  const o = bidObs(); o.balances.usdcUnits = "25000000";
  const action: any = chooseAction(o, adaptive);
  const boundary = BigInt((chooseAction({ ...o, competition: { ...o.competition, maxCompetitorPriorityFeeWei: "0" } }, { ...adaptive, bidBumpWei: 5_000_000_000 }) as any).maxPriorityFeePerGasWei);
  const doubleGas = BigInt((chooseAction({ ...o, competition: { ...o.competition, maxCompetitorPriorityFeeWei: "5000000000" } }, { ...adaptive, bidBumpWei: 0, gasPerSwap: 400_000 }) as any).maxPriorityFeePerGasWei);
  assert.ok(doubleGas >= boundary / 2n - 1n && doubleGas <= boundary / 2n + 1n, "bundle's two legs halve the affordable fee when per-swap gas doubles");
  const make = (competitor: bigint, bump: bigint) => chooseAction({ ...o, competition: { ...o.competition, maxCompetitorPriorityFeeWei: competitor.toString() } }, { ...adaptive, bidBumpWei: Number(bump) });
  assert.equal((make(boundary, 0n) as any).maxPriorityFeePerGasWei, boundary.toString());
  assert.equal((make(boundary + 1n, 0n) as any).maxPriorityFeePerGasWei, boundary.toString());
  assert.ok(BigInt(action.maxPriorityFeePerGasWei) <= boundary, "bundle applies twice the per-swap gas");
});
test("parameter parser ignores invalid adaptive bid values", () => {
  const parsed = parseDeltaParams(JSON.stringify({ bidMode: 9, bidBumpWei: -1, bidProfitShareBps: 10001, gasPerSwap: 0 }));
  assert.equal(parsed.bidMode, 0); assert.equal(parsed.bidBumpWei, 100_000_000);
  assert.equal(parsed.bidProfitShareBps, 3000); assert.equal(parsed.gasPerSwap, 200_000);
});
