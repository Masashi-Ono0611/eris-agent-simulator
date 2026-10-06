import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFunctionData, keccak256, type Hex, type PublicClient } from "viem";
import type { AgentContext, AgentObservation, LiquityObservation } from "@eris/sdk";
import { TOKENS, UNISWAP } from "@eris/sdk/constants.js";
import { erc20Abi, swapRouterAbi } from "@eris/sdk/abis.js";
import { parseAction, validateAction } from "@eris/sdk/action.js";
import { swapSchema, liquityLiquidateSchema, liquitySwapEusdSchema, liquityRedeemSchema, stableSwapSchema } from "@eris/sdk/actionSchema.js";
import { arbitrage, createAgent, liquidatable, remaining } from "../example/agents/astra-2/agent.js";
import { boundedClient, createLaunchState, launchDecision, screenTokenCode } from "../example/agents/astra-2/launch.js";
import { loadImproveAgent } from "../example/agents/runtime/improve.js";

const W = 10n ** 18n, U = 10n ** 6n;
const SELF = "0x0000000000000000000000000000000000000011";
const TOKEN = "0x0000000000000000000000000000000000000022";
const POOL = "0x0000000000000000000000000000000000000033";
const FACTORY = "0x0000000000000000000000000000000000000044";
const HASH = `0x${"12".repeat(32)}`;
function observation(block = 100): AgentObservation {
  return {
    kind: "observation", runId: "test-astra-2", round: block, blockNumber: String(block),
    blocksRemaining: 360 - block, agentAddress: SELF, fairPriceUsdcPerWeth: 3000,
    oraclePrices: { wethUsd: 3000, usdcUsd: 1 }, enabledProtocols: ["uniswap", "balancer", "curve", "liquity"],
    balances: { ethWei: String(W), wethWei: String(8n * W), usdcUnits: String(25000n * U) },
    inventory: { valueUsdc: 76000, weth: 8, usdc: 25000, eth: 1 }, history: [],
    limits: { defaultPriorityFeePerGasWei: "100000000", maxPriorityFeePerGasWei: "150000000", defaultSlippageBps: 50 },
    protocols: { uniswap: { pool: { pair: "WETH/USDC", fee: 3000, tick: 0, tickSpacing: 60, priceUsdcPerWeth: 3000 }, positions: [] } },
  };
}
function liquity(over: Partial<LiquityObservation> = {}): LiquityObservation {
  return { priceUsd: 3000, tcr: 2, recoveryMode: false, mcr: 1.1, ccr: 1.5, troveCount: 4,
    totalCollWei: String(250n * W), totalDebtEusdWei: String(250000n * W),
    borrowingRateBps: 50, redemptionRateBps: 50, baseRateBps: 0,
    minNetDebtEusdWei: String(1800n * W), gasCompensationEusdWei: String(200n * W), eusdBalanceWei: "0",
    marketPriceUsdc: 1, marketQuoted: true, discountBps: 0, redemptionEdgeBps: -50,
    poolReserves: { eusd: String(100000n * W), usdc: String(100000n * U) },
    riskiestTrove: { owner: TOKEN, icr: 1.4, netDebtEusdWei: String(10000n * W) },
    collSurplusWei: "0", spDepositEusdWei: "0", spEthGainWei: "0", spLqtyGainWei: "0",
    spTotalDepositsEusdWei: String(50000n * W), spShareBps: 0, ethBalanceWei: String(W), suggestedGasReserveWei: String(W / 20n), lqtyBalanceWei: "0", lqtyStakedWei: "0", stakingEthGainWei: "0", stakingEusdGainWei: "0", ...over };
}

test("quiet market does nothing; duplicate observations do not resubmit", async () => {
  const decide = createAgent(), o = observation();
  assert.equal((await decide(o)).type, "noop");
  assert.match(String((await decide(o)).reason), /duplicate/);
});
test("two-leg arb uses pre-existing balances and SDK-valid actions", () => {
  const o = observation(); o.protocols.balancer = { priceUsdcPerWeth: 3120 };
  const a = arbitrage(o)!; assert.equal(a.type, "bundle"); parseAction(a);
  const validated = validateAction(parseAction(a), o, { ethWei: W, wethWei: 8n * W, usdcUnits: 25000n * U });
  assert.ok(validated.ok);
  const legs = a.actions as Array<{ tokenIn: string; amountIn: string }>;
  assert.ok(BigInt(legs[0].amountIn) <= BigInt(o.balances.usdcUnits));
  assert.ok(BigInt(legs[1].amountIn) <= BigInt(o.balances.wethWei));
  o.balances.wethWei = "0";
  assert.notEqual(arbitrage(o)?.type, "bundle");
});
test("WBTC uses eight decimals and does not trip shared 18-decimal dust floor", () => {
  const o = observation(); o.fairPricesUsd = { WBTC: 60000 }; o.baseBalances = { WBTC: "40000000" };
  o.protocols.uniswap!.markets = { "WBTC/USDC": { pair: "WBTC/USDC", fee: 3000, tick: 0, tickSpacing: 60, priceUsdcPerWeth: 60000 } };
  o.protocols.balancer = { priceUsdcPerWeth: 3000, markets: { "WBTC/USDC": { priceUsdcPerWeth: 63000 } } };
  const a = arbitrage(o)!; assert.equal(a.type, "bundle");
  swapSchema.parse((a.actions as unknown[])[0]);
  const legs = a.actions as Array<{ base: string; amountIn: string }>;
  assert.equal(legs[1].base, "WBTC"); assert.ok(BigInt(legs[1].amountIn) < 40000000n);
});
test("effective quote spread, disabled markets and malformed prices cannot manufacture an edge", () => {
  const o = observation(); o.protocols.balancer = { priceUsdcPerWeth: 3000, buyPriceUsdcPerWeth: 3090, sellPriceUsdcPerWeth: 2910, effectiveHalfSpreadBps: 300 };
  assert.equal(arbitrage(o), null);
  o.protocols.balancer.priceUsdcPerWeth = Infinity;
  assert.equal(arbitrage(o), null);
  o.protocols.balancer = { priceUsdcPerWeth: 4000 }; o.enabledProtocols = ["uniswap"];
  assert.equal(arbitrage(o), null);
});
test("spike blocks directional chasing, then releases after fresh stable observations", async () => {
  const decide = createAgent(); await decide(observation());
  const o = observation(101); o.fairPriceUsdcPerWeth = 3300;
  assert.equal((await decide(o)).type, "noop");
  for (let b = 102; b <= 104; b++) assert.equal((await decide({ ...o, blockNumber: String(b), blocksRemaining: 360 - b })).type, "noop");
  assert.equal((await decide({ ...o, blockNumber: "105", blocksRemaining: 255 })).type, "swap");
});
test("directional position cap prevents endlessly buying an apparent discount", () => {
  const o = observation(); o.balances.wethWei = String(11n * W); o.protocols.uniswap!.pool.priceUsdcPerWeth = 2700;
  assert.equal(arbitrage(o), null);
});
test("CDP liquidation handles recovery SP coverage and protects the last Trove", async () => {
  const l = liquity({ recoveryMode: true, tcr: 1.45 }); assert.equal(liquidatable(l), true);
  l.spTotalDepositsEusdWei = String(10199n * W); assert.equal(liquidatable(l), false);
  l.riskiestTrove!.icr = 1.08; assert.equal(liquidatable(l), true);
  l.troveCount = 1; assert.equal(liquidatable(l), false);
  const o = observation(); o.protocols.liquity = liquity({ riskiestTrove: { owner: TOKEN, icr: 1.07, netDebtEusdWei: String(10000n * W) } });
  const a = await createAgent()(o); liquityLiquidateSchema.parse(a); assert.equal(a.type, "liquityLiquidate");
  assert.equal(a.maxPriorityFeePerGasWei, o.limits.maxPriorityFeePerGasWei);
});
test("eUSD buy clears all costs; final blocks and unavailable quotes forbid entries", async () => {
  const o = observation(); o.protocols.liquity = liquity({ marketPriceUsdc: 0.96, discountBps: 400,
    poolReserves: { eusd: String(140000n * W), usdc: String(60000n * U) } });
  const a = await createAgent()(o); assert.equal(a.type, "liquitySwapEusd"); assert.equal(a.tokenIn, "USDC");
  assert.ok(BigInt(String(a.amountIn)) <= 1200n * U); liquitySwapEusdSchema.parse(a);
  o.blocksRemaining = 30; assert.equal((await createAgent()(o)).type, "noop");
  o.blocksRemaining = 200; o.protocols.liquity.marketQuoted = false;
  assert.equal((await createAgent()(o)).type, "noop");
});
test("eUSD already held chooses redemption or sale, and is never averaged down", async () => {
  const o = observation(); o.protocols.liquity = liquity({ marketPriceUsdc: 0.96, eusdBalanceWei: String(500n * W) });
  let a = await createAgent()(o); assert.equal(a.type, "liquityRedeem"); liquityRedeemSchema.parse(a);
  o.blocksRemaining = 5; a = await createAgent()(o); assert.equal(a.type, "liquitySwapEusd"); assert.equal(a.tokenIn, "EUSD");
  o.blocksRemaining = 100; o.protocols.liquity.marketPriceUsdc = 1.01;
  assert.equal((await createAgent()(o)).tokenIn, "EUSD");
});
test("unconfirmed eUSD purchase cannot stack duplicate orders; late balance is still redeemed", async () => {
  const o = observation(), decide = createAgent();
  o.protocols.liquity = liquity({ marketPriceUsdc: 0.96,
    poolReserves: { eusd: String(140000n * W), usdc: String(60000n * U) } });
  assert.equal((await decide(o)).tokenIn, "USDC");
  assert.equal((await decide({ ...o, blockNumber: "104", blocksRemaining: 256 })).type, "noop");
  const late = { ...o, blockNumber: "110", blocksRemaining: 250,
    protocols: { ...o.protocols, liquity: { ...o.protocols.liquity, eusdBalanceWei: String(500n * W) } } };
  assert.equal((await decide(late)).type, "liquityRedeem");
});
test("native collateral wraps only excess ETH, then sells only the observed wrapped amount", async () => {
  const decide = createAgent(), o = observation(); o.protocols.liquity = liquity(); o.balances.ethWei = String(W + W / 5n);
  const a = await decide(o); assert.equal(a.type, "rawTx"); assert.equal((a.tx as { value: string }).value, String(W / 5n));
  parseAction(a);
  const next = observation(102); next.protocols.liquity = liquity(); next.balances.wethWei = String(8n * W + W / 5n);
  const sale = await decide(next); assert.equal(sale.type, "swap"); assert.equal(sale.amountIn, String(W / 5n));
  assert.equal((await decide({ ...next, blockNumber: "104", blocksRemaining: 256 })).type, "noop");
  const retry = await decide({ ...next, blockNumber: "107", blocksRemaining: 253 });
  assert.equal(retry.amountIn, String(W / 5n));
  const filled = { ...next, blockNumber: "109", blocksRemaining: 251, balances: { ...next.balances, wethWei: String(8n * W) } };
  assert.equal((await decide(filled)).type, "noop");
});
test("persistent DAI discount and falling price are not entry signals", async () => {
  const decide = createAgent();
  for (let i = 0; i < 12; i++) {
    const o = observation(100 + i); o.balances.stables = { DAI: { token: TOKEN, balance: "0", decimals: 18, priceUsdc: 0.97 - i * 0.001, marketQuoted: true } };
    assert.equal((await decide(o)).type, "noop");
  }
});
test("DAI recovery requires consecutive samples, commits once, and obeys stop", async () => {
  const decide = createAgent(); let a: Record<string, unknown> = {};
  for (let i = 0; i < 4; i++) {
    const o = observation(100 + i); o.balances.stables = { DAI: { token: TOKEN, balance: "0", decimals: 18, priceUsdc: 0.97 + i * 0.001, marketQuoted: true } };
    a = await decide(o);
  }
  assert.equal(a.type, "stableSwap"); assert.equal(a.amountIn, String(350n * U)); stableSwapSchema.parse(a);
  const o = observation(106); o.balances.stables = { DAI: { token: TOKEN, balance: String(359n * W), decimals: 18, priceUsdc: 0.96, marketQuoted: true } };
  a = await decide(o); assert.equal(a.tokenIn, "DAI"); assert.equal(a.amountIn, String(359n * W));
});
test("unknown DAI entry is recovered on restart; earliest valuation boundary wins", async () => {
  const o = observation(); o.balances.stables = { DAI: { token: TOKEN, balance: String(30n * W), decimals: 18, priceUsdc: 0.97, marketQuoted: true } };
  assert.equal((await createAgent()(o)).tokenIn, "DAI");
  o.dayBlocksRemaining = 12; assert.equal(remaining(o), 12);
  o.dayBlocksRemaining = undefined; o.blocksRemaining = undefined; assert.equal(remaining(o), 0);
});

// Synthetic dispatcher fixture ONLY: not a claim that arbitrary token semantics are safe.
const selectors = ["06fdde03", "95d89b41", "313ce567", "18160ddd", "70a08231", "dd62ed3e", "095ea7b3", "a9059cbb", "23b872dd"];
const CODE = (`0x${selectors.map(s => `63${s}1461000057`).join("")}${"00".repeat(40)}`) as Hex;
function launchFixture(block = 100) {
  const o = observation(block); o.protocols = {};
  o.registry = { address: FACTORY, allowances: [], strandedUnknown: [], dropped: 0, entries: [
    { market: POOL, kind: "uniswapV3Pool", creator: FACTORY, mine: false, token0: TOKEN, token1: TOKENS.USDC.address,
      codehashAtRegistration: HASH, codehashNow: HASH, verified: true, registeredAtBlock: "90" },
    { market: TOKEN, kind: "erc20", creator: FACTORY, mine: false, codehashAtRegistration: keccak256(CODE), codehashNow: keccak256(CODE), verified: false, registeredAtBlock: "90" },
  ] };
  const data = { held: 0n, quoteFail: false, flow: [100n * U, 100n * U, 100n * U], code: CODE, factoryPool: POOL, rejectTransfer: false };
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    async readContract(a: Record<string, unknown>) {
      calls.push(a);
      if (a.functionName === "balanceOf") return a.address === TOKEN ? data.held : 20000n * U;
      if (a.functionName === "fee") return 3000;
      if (a.functionName === "slot0") return [2n ** 96n];
      if (a.functionName === "liquidity") return 100000000n;
      if (a.functionName === "decimals") return 18;
      if (a.functionName === "factory") return FACTORY;
      if (a.functionName === "getPool") return data.factoryPool;
      throw Error("unexpected read");
    },
    async getCode(a: Record<string, unknown>) { calls.push(a); return data.code; },
    async getLogs(a: Record<string, unknown>) { calls.push(a); return data.flow.map((n, i) => ({ blockNumber: BigInt(Number(a.toBlock) - 2 + i), removed: false, args: { amount0: -W, amount1: n, recipient: FACTORY } })); },
    async simulateContract(a: Record<string, unknown>) {
      calls.push(a); if (data.quoteFail) throw Error("no quote");
      if (a.functionName === "transfer") return { result: !data.rejectTransfer };
      const input = (a.args as Array<{ tokenIn: string; amountIn: bigint }>)[0];
      return { result: [input.tokenIn === TOKENS.USDC.address ? input.amountIn * 10n ** 12n : input.amountIn / 10n ** 12n * 99n / 100n] };
    },
  } as unknown as PublicClient;
  const ctx = { address: SELF, publicClient: client } as unknown as AgentContext;
  return { o, ctx, data, calls };
}
test("token screening rejects owner switches, external calls, proxies and empty code", () => {
  assert.equal(screenTokenCode(CODE), true);
  assert.equal(screenTokenCode(`${CODE}638da5cb5b14`), false);
  for (const op of ["f1", "f4", "fa", "ff", "42"]) assert.equal(screenTokenCode(`${CODE}${op}`), false);
  assert.equal(screenTokenCode("0x"), false);
});
test("launch entry needs real three-block demand, exact approval and bounded spend", async () => {
  const { o, ctx, calls } = launchFixture(); const state = createLaunchState();
  const a = await launchDecision(o, ctx, state, 260, 100, "10"); assert.equal(a?.type, "rawBundle"); parseAction(a);
  const txs = a!.txs as Array<{ to: Hex; data: Hex }>;
  const approval = decodeFunctionData({ abi: erc20Abi, data: txs[0].data });
  assert.equal(approval.functionName, "approve"); assert.equal(approval.args[0], UNISWAP.swapRouter);
  assert.equal(approval.args[1], 200n * U); assert.equal(state.spent, 200n * U);
  assert.ok(calls.length <= 18); assert.ok(calls.every(c => c.blockNumber === 100n || c.toBlock === 100n));
});
test("launch rejects missing flow block, factory mismatch, changed code and transfer refusal", async () => {
  for (const fault of ["flow", "factory", "code", "transfer", "unverified", "stale"]) {
    const f = launchFixture();
    if (fault === "flow") f.data.flow[1] = 0n;
    if (fault === "factory") f.data.factoryPool = FACTORY;
    if (fault === "code") f.o.registry!.entries[1].codehashNow = HASH;
    if (fault === "transfer") f.data.rejectTransfer = true;
    if (fault === "unverified") f.o.registry!.entries[0].verified = false;
    if (fault === "stale") f.o.registry!.error = "stale read";
    assert.equal(await launchDecision(f.o, f.ctx, createLaunchState(), 260, 100, "10"), null, fault);
  }
});
test("launch deadline exits all dust and only marks complete after zero actual balance", async () => {
  const f = launchFixture(), state = createLaunchState();
  await launchDecision(f.o, f.ctx, state, 260, 100, "10"); f.data.held = 10n ** 12n;
  const a = await launchDecision(f.o, f.ctx, state, 24, 110, "10"); assert.equal(a?.type, "rawBundle");
  const tx = (a!.txs as Array<{ data: Hex }>)[1];
  const decoded = decodeFunctionData({ abi: swapRouterAbi, data: tx.data });
  assert.equal(decoded.functionName, "exactInputSingle");
  const args = decoded.args[0] as { amountIn: bigint; amountOutMinimum: bigint };
  assert.equal(args.amountIn, f.data.held); assert.ok(args.amountOutMinimum >= 1n);
  assert.ok(state.position); assert.ok(await launchDecision(f.o, f.ctx, state, 23, 111, "10"));
  f.data.held = 0n; await launchDecision(f.o, f.ctx, state, 22, 112, "10"); assert.equal(state.position, undefined);
});
test("failed launch buy does not duplicate; late fill still unwinds", async () => {
  const f = launchFixture(), state = createLaunchState();
  await launchDecision(f.o, f.ctx, state, 260, 100, "10");
  assert.equal(await launchDecision(f.o, f.ctx, state, 250, 110, "10"), null);
  f.data.held = 200n * W;
  assert.equal((await launchDecision(f.o, f.ctx, state, 230, 130, "10"))?.type, "rawBundle");
  assert.equal(state.spent, 200n * U);
});
test("emergency exit survives quote failures; restart discovers holdings before buying", async () => {
  const f = launchFixture(), state = createLaunchState(); f.data.held = 50n * W;
  assert.equal(await launchDecision(f.o, f.ctx, state, 10, 100, "10"), null); assert.ok(state.position);
  f.data.quoteFail = true;
  const a = await launchDecision(f.o, f.ctx, state, 5, 101, "10"); assert.equal(a?.type, "rawBundle");
  const d = decodeFunctionData({ abi: swapRouterAbi, data: (a!.txs as Array<{ data: Hex }>)[1].data });
  assert.equal((d.args[0] as { amountOutMinimum: bigint }).amountOutMinimum, 1n);
});
test("launch entry deadline, one-position limit and lifetime budget are hard bounds", async () => {
  for (const left of [0, 24, 60]) {
    const f = launchFixture(); assert.equal(await launchDecision(f.o, f.ctx, createLaunchState(), left, 100, "10"), null);
  }
  const f = launchFixture(), state = createLaunchState(); state.spent = 750n * U;
  assert.equal(await launchDecision(f.o, f.ctx, state, 260, 100, "10"), null);
  state.spent = 740n * U;
  assert.equal(await launchDecision(f.o, f.ctx, state, 260, 100, "10"), null);
  state.spent = 0n;
  assert.equal((await launchDecision(f.o, f.ctx, state, 260, 100, "10"))?.type, "rawBundle");
  assert.equal(await launchDecision(f.o, f.ctx, state, 259, 101, "10"), null);
  assert.equal(state.spent, 200n * U);
});
test("new epoch discards stale trade state; final valuation block sends nothing", async () => {
  const decide = createAgent(), o = observation(); o.balances.ethWei = String(W + W / 5n);
  assert.equal((await decide(o)).type, "rawTx");
  const fresh = observation(100); fresh.runId = "next-epoch";
  assert.equal((await decide(fresh)).type, "noop");
  const end = observation(360); end.protocols.balancer = { priceUsdcPerWeth: 4000 };
  assert.equal((await decide(end)).type, "noop");
});
test("redemption never proposes a fee below the current protocol rate", async () => {
  const o = observation(); o.protocols.liquity = liquity({ redemptionRateBps: 2100, marketPriceUsdc: 0.7, eusdBalanceWei: String(500n * W) });
  const a = await createAgent()(o); assert.equal(a.type, "liquitySwapEusd"); assert.equal(a.tokenIn, "EUSD");
});
test("timeout is bounded, falls through to spot, and in-flight requests cannot grow indefinitely", async () => {
  const f = launchFixture(); f.o.protocols.uniswap = observation().protocols.uniswap;
  f.o.protocols.balancer = { priceUsdcPerWeth: 3120 };
  f.ctx.publicClient = { readContract: () => new Promise(() => {}) } as unknown as PublicClient;
  const before = performance.now(); const a = await createAgent()(f.o, f.ctx);
  assert.equal(a.type, "bundle"); assert.ok(performance.now() - before < 1500);
  const state = createLaunchState(); state.inFlight = 18;
  await assert.rejects(boundedClient(f.ctx.publicClient, state, 100).readContract({ address: TOKEN, abi: erc20Abi, functionName: "decimals" }), /budget/);
});
test("prompt contract and source portability", () => {
  const root = new URL("../example/agents/astra-2/", import.meta.url);
  const p = loadImproveAgent(root.pathname); assert.equal(p.name, "astra-2");
  for (const word of ["transactions since the last revision", "market history", "mean inclusion latency", "executorTs", "revertTo", "PARAMS"]) assert.ok(p.body.includes(word));
  assert.ok(!p.body.includes("rolled back automatically"));
  for (const file of ["agent.ts", "launch.ts", "params.ts"]) {
    const source = readFileSync(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /process\.env|Math\.random|\bfetch\s*\(/);
    const imports = [...source.matchAll(/from\s+["'](\.\.[^"']+)["']/g)];
    assert.ok(imports.every(m => m[1].startsWith("../lib/") || m[1].startsWith("../runtime/")));
  }
});
