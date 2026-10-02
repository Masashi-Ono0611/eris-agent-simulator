import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentObservation } from "@eris/sdk";
import { decide, decideWithParams, chooseAction, DEFAULT_PARAMS, parseDeltaParams } from "../example/agents/ascon-delta/agent.js";
import { decide as multiDecide } from "../example/agents/multi-arb/agent.js";

function obs(opts: { cheap?: number; rich?: number; fair?: number; wbtc?: boolean; usdc?: string; weth?: string; baseBal?: string; remaining?: number } = {}): AgentObservation {
  const cheap = opts.cheap ?? 3000, rich = opts.rich ?? cheap, fair = opts.fair ?? 3000;
  const protocols: any = { uniswap: { pool: { priceUsdcPerWeth: cheap, fee: 3000 } }, balancer: { priceUsdcPerWeth: rich,
    sellPriceUsdcPerWeth: rich * .997, buyPriceUsdcPerWeth: rich * 1.003, effectiveHalfSpreadBps: 30 } };
  const baseBalances: Record<string,string> = { WBTC: opts.baseBal ?? "40000000" };
  const fairPricesUsd: Record<string,number> = { WETH: fair };
  const baseDecimals: Record<string,number> = {};
  if (opts.wbtc) {
    protocols.uniswap.markets = { "WBTC/USDC": { priceUsdcPerWeth: cheap, fee: 3000 } };
    protocols.balancer.markets = { "WBTC/USDC": { priceUsdcPerWeth: rich, sellPriceUsdcPerWeth: rich*.997, buyPriceUsdcPerWeth: rich*1.003, effectiveHalfSpreadBps: 30 } };
    fairPricesUsd.WBTC = opts.fair ?? 60000; baseDecimals.WBTC = 8;
  }
  return { balances: { usdcUnits: opts.usdc ?? "100000000", wethWei: opts.weth ?? "8000000000000000000", stables: {} },
    baseBalances, baseDecimals, fairPriceUsdcPerWeth: 3000, fairPricesUsd, blocksRemaining: opts.remaining ?? 100,
    limits: { defaultPriorityFeePerGasWei: "10", maxPriorityFeePerGasWei: "100" }, protocols } as unknown as AgentObservation;
}
function same(a: unknown,b: unknown) { assert.deepEqual(a,b); }

test("default decide matches multi-arb for 26 synthesized observations", () => {
  const cases: AgentObservation[] = [];
  for (const p of [2900, 2998, 3000, 3001, 3100]) for (const wbtc of [false,true])
    cases.push(obs({ cheap:p, rich:p===2900?3100:p===3100?2900:p, wbtc }));
  cases.push(obs({ cheap:2800,rich:3200 }), obs({ cheap:3200,rich:2800 }), obs({ cheap:3000,rich:3300 }),
    obs({ cheap:2700,rich:3000,wbtc:true }), obs({ cheap:65000,rich:70000,wbtc:true,fair:60000 }),
    obs({ usdc:"0" }), obs({ weth:"0",baseBal:"0" }), obs({ usdc:"0",wbtc:true,baseBal:"0" }),
    obs({ cheap:3200,rich:3200,fair:2800 }), obs({ cheap:2800,rich:2800,fair:3200 }),
    obs({ cheap:3050,rich:3150 }), obs({ cheap:2500,rich:3500,wbtc:true }), obs({ cheap:3000,rich:3300,remaining:1 }),
    obs({ cheap:2950,rich:3050 }), obs({ cheap:3500,rich:3600,fair:3000 }), obs({ cheap:2500,rich:2600,fair:3000 }));
  assert.ok(cases.length >= 20);
  for (const o of cases) same(decide(o), multiDecide(o));
  assert.equal(cases.length, 26);
});

test("all added controls are inert by default", () => {
  for (const o of [obs(),obs({cheap:2700,rich:3300}),obs({cheap:65000,rich:70000,wbtc:true,fair:60000})])
    same(chooseAction(o, { ...DEFAULT_PARAMS }), multiDecide(o));
});

test("inventory band caps a buy using post-trade inventory", () => {
  const o=obs({cheap:2800,rich:3300,usdc:"100000000000",weth:"8000000000000000000"});
  const a=chooseAction(o,{...DEFAULT_PARAMS,inventoryBandBps:1000}) as any;
  assert.equal(a.type,"bundle");
  const buyWeth=Number(a.actions[0].amountIn)/1e6/2800;
  assert.ok(buyWeth <= .800001);
});

test("endgame suppresses new bundles within configured remaining blocks", () => {
  const a=chooseAction(obs({cheap:2800,rich:3300,remaining:3}),{...DEFAULT_PARAMS,endgameNoNewBlocks:3}) as any;
  assert.notEqual(a?.type,"bundle");
});

test("bidExtra is capped by maxPriorityFeePerGasWei", () => {
  const a=chooseAction(obs({cheap:2800,rich:3300}),{...DEFAULT_PARAMS,bidExtraBps:100}) as any;
  assert.ok(BigInt(a.maxPriorityFeePerGasWei) > 10n);
  assert.ok(BigInt(a.maxPriorityFeePerGasWei) <= 100n);
});

test("bidExtraBps=10000 bids the ceiling at >=100bps edge, 0 bids the default, and the bid scales with edge", () => {
  const at = (bidExtraBps: number, rich: number) =>
    BigInt((chooseAction(obs({ cheap: 3000, rich }), { ...DEFAULT_PARAMS, bidExtraBps }) as any).maxPriorityFeePerGasWei);
  const o = obs({ cheap: 3000, rich: 3600 }) as any;
  const fee = BigInt(o.limits.defaultPriorityFeePerGasWei), ceiling = BigInt(o.limits.maxPriorityFeePerGasWei);
  assert.equal(at(0, 3600), fee, "off = default fee");
  assert.equal(at(10000, 3600), ceiling, "large edge + full scale = ceiling");
  const small = at(3000, 3300), large = at(3000, 3600);
  assert.ok(small > fee && small <= large && large <= ceiling, `scaling: ${fee} < ${small} <= ${large} <= ${ceiling}`);
});

test("executable quote mode compares net executable prices without subtracting venue fee twice", () => {
  const o=obs({cheap:3000,rich:3000});
  // Fair is above the venue's executable buy quote by 100bps. The quote already includes cost.
  (o.protocols as any).uniswap.pool.priceUsdcPerWeth=3000;
  (o.protocols as any).balancer.buyPriceUsdcPerWeth=2980;
  const a=chooseAction(o,{...DEFAULT_PARAMS,useExecutableQuotes:true}) as any;
  assert.notEqual(a.type,"noop");
});

test("persistBlocks waits for N consecutive qualifying observations", () => {
  const p={...DEFAULT_PARAMS,persistBlocks:3}, state=new Map();
  for (const n of [100,101]) assert.equal((decideWithParams({...obs({cheap:2800,rich:3000}),blockNumber:n} as any,p,state) as any).type,"noop");
  assert.equal((decideWithParams({...obs({cheap:2800,rich:3000}),blockNumber:102} as any,p,state) as any).type,"bundle");
});

test("invalid parameter JSON, negative values, and out-of-range values retain defaults", () => {
  same(parseDeltaParams("{"),DEFAULT_PARAMS);
  const p=parseDeltaParams(JSON.stringify({MAX_SIZE_BPS:-1,SAFETY_MARGIN_BPS:99999,persistBlocks:-4,bidExtraBps:20000}));
  assert.equal(p.MAX_SIZE_BPS,DEFAULT_PARAMS.MAX_SIZE_BPS); assert.equal(p.SAFETY_MARGIN_BPS,DEFAULT_PARAMS.SAFETY_MARGIN_BPS);
  assert.equal(p.persistBlocks,0); assert.equal(p.bidExtraBps,0);
});
