import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AgentObservation } from "@eris/sdk";
import { agentActionSchema } from "../sdk/src/actionSchema.js";
import { PARAMS, chooseAction, decide } from "../example/agents/sonnet-1/agent.js";

const WETH0 = 8n * 10n ** 18n;
const WBTC0 = 40_000_000n;

type Opts = {
  uni?: number; bal?: number; cur?: number; fair?: number;
  wbtc?: { uni?: number; bal?: number; cur?: number; fair?: number };
  usdc?: string; weth?: bigint; wbtcBal?: bigint; remaining?: number; block?: number;
  uniLiquidity?: string | null; balUsdc?: string | null; curUsdc?: string | null;
  extraBase?: boolean;
};

// Depths: uniswap 1000 WETH / 3M USDC => L = 5.477e16; balancer/curve 3M USDC reserves.
const L_WETH = "54772255750516611";
const amm = (price: number, usdc: string | null) => ({
  priceUsdcPerWeth: price, sellPriceUsdcPerWeth: price * 0.997, buyPriceUsdcPerWeth: price * 1.003,
  effectiveHalfSpreadBps: 30, ...(usdc === null ? {} : { reserves: { weth: "1", usdc } }),
});

function obs(o: Opts = {}): AgentObservation {
  const fair = o.fair ?? 3000;
  const u = o.uni ?? fair, b = o.bal ?? fair, c = o.cur ?? fair;
  const protocols: any = {
    uniswap: { pool: { priceUsdcPerWeth: u, fee: 3000, ...(o.uniLiquidity === null ? {} : { liquidity: o.uniLiquidity ?? L_WETH }) } },
    balancer: amm(b, o.balUsdc === undefined ? "3000000000000" : o.balUsdc),
    curve: amm(c, o.curUsdc === undefined ? "3000000000000" : o.curUsdc),
  };
  const fairPricesUsd: Record<string, number> = { WETH: fair };
  const baseBalances: Record<string, string> = { WBTC: String(o.wbtcBal ?? WBTC0) };
  const baseDecimals: Record<string, number> = { WBTC: 8 };
  if (o.wbtc) {
    const wf = o.wbtc.fair ?? 60000;
    fairPricesUsd.WBTC = wf;
    protocols.uniswap.markets = { "WBTC/USDC": { pair: "WBTC/USDC", fee: 3000, priceUsdcPerWeth: o.wbtc.uni ?? wf, liquidity: "4800000000000" } };
    protocols.balancer.markets = { "WBTC/USDC": amm(o.wbtc.bal ?? wf, "1200000000000") };
    protocols.curve.markets = { "WBTC/USDC": amm(o.wbtc.cur ?? wf, "1200000000000") };
  }
  if (o.extraBase) {
    fairPricesUsd.LAUNCH = 1;
    protocols.uniswap.markets = { ...(protocols.uniswap.markets ?? {}), "LAUNCH/USDC": { pair: "LAUNCH/USDC", fee: 3000, priceUsdcPerWeth: 0.5, liquidity: "1000000000000" } };
  }
  return {
    kind: "observation", blockNumber: String(o.block ?? 100),
    balances: { usdcUnits: o.usdc ?? "25000000000", wethWei: String(o.weth ?? WETH0), stables: {} },
    baseBalances, baseDecimals, fairPriceUsdcPerWeth: fair, fairPricesUsd,
    blocksRemaining: o.remaining ?? 200,
    limits: { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: "5000000000" },
    protocols,
  } as unknown as AgentObservation;
}
const act = (o: AgentObservation, cooling: string[] = []) => chooseAction(o, new Set(cooling)) as any;

test("defaults are baked into the code and do not read the environment", () => {
  const src = readFileSync(new URL("../example/agents/sonnet-1/agent.ts", import.meta.url), "utf8");
  assert.ok(!/process\.env|process\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "no process access");
  assert.deepEqual([...PARAMS.BASES], ["WETH", "WBTC"]);
  assert.equal(PARAMS.MARGIN_BPS, 60);
  assert.equal(PARAMS.BAND_BPS, 2000);
  assert.equal(PARAMS.ENDGAME_BLOCKS, 4);
  assert.equal(PARAMS.INITIAL_BASE.WETH, WETH0);
  assert.equal(PARAMS.INITIAL_BASE.WBTC, WBTC0);
});

test("no gap, or a gap inside cost + margin, does nothing", () => {
  assert.equal(act(obs()).type, "noop");
  // uniswap fee 30 + margin 60 = 90 bps; a 80 bps gap must not fire.
  assert.equal(act(obs({ uni: 3000 * (1 - 0.008), bal: 3000 * (1 - 0.008), cur: 3000 * (1 - 0.008) })).type, "noop");
});

test("buys when the venue is cheap against fair and sells when it is rich", () => {
  const all = (x: number) => ({ uni: x, bal: x, cur: x });
  const buy = act(obs(all(2900)));
  assert.match(buy.type, /^(swap|balancerSwap|curveSwap)$/);
  assert.equal(buy.tokenIn, "USDC");
  assert.ok(!("base" in buy), "WETH carries no base key");
  const sell = act(obs(all(3100)));
  assert.equal(sell.tokenIn, "WETH");
  assert.ok(BigInt(sell.amountIn) > 0n);
});

test("size stays below the trade that would take the pool price to fair, and shrinks with depth", () => {
  // uniswap 2% under fair and balancer/curve 2% over: the cross-venue bundle has the larger edge.
  const deep = act(obs({ uni: 2940, bal: 3060, cur: 3060 }));
  const thin = act(obs({ uni: 2940, bal: 3060, cur: 3060, uniLiquidity: "5477225575051661", balUsdc: "300000000000", curUsdc: "300000000000" }));
  const usd = (a: any) => Number(a.actions[0].amountIn) / 1e6;
  assert.equal(deep.type, "bundle");
  assert.equal(thin.type, "bundle");
  const net = 3060 / 2940 - 1 - 0.003 - 0.003 - 0.006;
  assert.ok(usd(deep) <= (0.5 * net) / (2 * (1 / 3e6 + 1 / 3e6)) + 1, "never passes the closing size");
  const thinClosing = (0.5 * net) / (2 * (1 / 3e5 + 1 / 3e5));
  assert.ok(usd(thin) <= thinClosing + 1, `thin pool size ${usd(thin)} stays under its own closing size ${thinClosing}`);
  assert.ok(usd(thin) < usd(deep), "thinner pools => smaller trade");
});

test("a drained pool is skipped and unknown depth uses the conservative default", () => {
  const drained = act(obs({ uni: 2900, bal: 2900, cur: 2900, uniLiquidity: "1000000", balUsdc: "1000000", curUsdc: "1000000" }));
  assert.equal(drained.type, "noop", "every venue below MIN_DEPTH_USDC");
  const unknown = act(obs({ uni: 2900, bal: 2900, cur: 2900, uniLiquidity: null, balUsdc: null, curUsdc: null }));
  assert.notEqual(unknown.type, "noop");
  assert.ok(Number(unknown.amountIn) / 1e6 <= PARAMS.UNKNOWN_DEPTH_USDC, "bounded by the unknown-depth default");
});

test("inventory band: no buying above +20%, no selling below -20%, reduction always allowed", () => {
  const cheap = { uni: 2900, bal: 2900, cur: 2900 }, rich = { uni: 3100, bal: 3100, cur: 3100 };
  const upper = WETH0 + (WETH0 * 2000n) / 10000n, lower = WETH0 - (WETH0 * 2000n) / 10000n;
  assert.equal(act(obs({ ...cheap, weth: upper })).type, "noop", "at the upper band a buy is refused");
  assert.equal(act(obs({ ...rich, weth: upper })).tokenIn, "WETH", "at the upper band a sell reduces skew");
  assert.equal(act(obs({ ...rich, weth: lower })).type, "noop", "at the lower band a sell is refused");
  assert.equal(act(obs({ ...cheap, weth: lower })).tokenIn, "USDC", "at the lower band a buy reduces skew");
  const nearUpper = act(obs({ ...cheap, weth: upper - 10n ** 17n }));
  assert.ok(BigInt(nearUpper.amountIn) / 10n ** 6n <= 0.1 * 2900 + 1, "buy trimmed to the remaining headroom");
});

test("two-leg bundle buys cheap, sells on the rich venue, nets near zero, WBTC carries base and 8 decimals", () => {
  const o = obs({ uni: 2950, bal: 3050, cur: 3000, wbtc: { uni: 58000, bal: 63000, cur: 60000 } });
  const a = act(o);
  assert.equal(a.type, "bundle");
  assert.equal(a.actions.length, 2);
  assert.equal(a.actions[0].tokenIn, "USDC");
  const base = a.actions[0].base;
  assert.equal(a.actions[1].tokenIn, base ?? "WETH");
  assert.equal(a.actions[0].base, a.actions[1].base);
  const bought = Number(a.actions[0].amountIn) / 1e6 / (base === "WBTC" ? 58000 : 2950);
  const sold = Number(a.actions[1].amountIn) / 10 ** (base === "WBTC" ? 8 : 18);
  assert.ok(sold < bought && sold > bought * 0.9, `sold ${sold} within 10% under bought ${bought}`);
});

test("only WETH and WBTC are ever traded", () => {
  const a = act(obs({ extraBase: true }));
  assert.equal(a.type, "noop");
  const json = JSON.stringify(act(obs({ extraBase: true, uni: 2900, bal: 2900, cur: 2900 })));
  assert.ok(!json.includes("LAUNCH"));
});

test("endgame stop and per-base cooldown", () => {
  const cheap = { uni: 2900, bal: 2900, cur: 2900 };
  assert.equal(act(obs({ ...cheap, remaining: 4 })).type, "noop");
  assert.notEqual(act(obs({ ...cheap, remaining: 5 })).type, "noop");
  assert.equal(act(obs(cheap), ["WETH"]).type, "noop", "cooling base skipped");
  assert.notEqual(decide(obs({ ...cheap, block: 500 })).type, "noop");
  assert.equal(decide(obs({ ...cheap, block: 501 })).type, "noop", "next block is inside the cooldown");
  assert.notEqual(decide(obs({ ...cheap, block: 502 })).type, "noop", "cooldown expired");
  assert.equal(decide(obs({ ...cheap, block: 503 })).type, "noop", "and the new trade restarts it");
  assert.notEqual(decide(obs({ ...cheap, block: 10 })).type, "noop", "a rewound block number clears the cooldown");
});

test("priority fee: default for dust, scales with profit, never above the ceiling", () => {
  const fee = (o: AgentObservation) => BigInt(act(o).maxPriorityFeePerGasWei);
  const floor = 100_000_000n, ceiling = 5_000_000_000n;
  const small = fee(obs({ uni: 2960, bal: 2960, cur: 2960, usdc: "500000000" }));
  const mid = fee(obs({ uni: 2950, bal: 2950, cur: 2950 }));
  const big = fee(obs({ uni: 2700, bal: 2700, cur: 2700 }));
  assert.ok(small >= floor && small <= mid && mid <= big && big <= ceiling, `${small} <= ${mid} <= ${big}`);
  assert.equal(big, ceiling);
});

test("fuzz: never throws, never emits a malformed or non-positive amount, always passes the action schema", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let trades = 0;
  for (let i = 0; i < 400; i++) {
    const shift = (x: number) => x * (1 + (rnd() - 0.5) * 0.4);
    const o = obs({
      fair: 3000, uni: shift(3000), bal: shift(3000), cur: shift(3000),
      wbtc: rnd() < 0.7 ? { uni: shift(60000), bal: shift(60000), cur: shift(60000) } : undefined,
      weth: BigInt(Math.floor(rnd() * 16e18)), wbtcBal: BigInt(Math.floor(rnd() * 8e7)),
      usdc: String(Math.floor(rnd() * 5e10)), remaining: Math.floor(rnd() * 360),
      uniLiquidity: rnd() < 0.2 ? null : String(Math.floor(rnd() * 8e16)),
      balUsdc: rnd() < 0.2 ? null : String(Math.floor(rnd() * 4e12)),
    });
    const a = chooseAction(o) as any;
    assert.ok(agentActionSchema.safeParse(a).success, JSON.stringify(a));
    const legs = a.type === "bundle" ? a.actions : a.type === "noop" ? [] : [a];
    for (const leg of legs) {
      assert.match(leg.amountIn, /^[1-9][0-9]*$/);
      if (leg.tokenIn === "USDC") assert.ok(BigInt(leg.amountIn) <= BigInt(o.balances.usdcUnits));
    }
    if (legs.length) trades++;
  }
  assert.ok(trades > 20, `fuzz exercised trades (${trades})`);
});

test("garbage observations degrade to a noop instead of throwing", () => {
  for (const bad of [{}, { balances: {} }, null as any]) {
    assert.equal((chooseAction(bad) as any).type, "noop");
    assert.equal((decide(bad) as any).type, "noop");
  }
});
