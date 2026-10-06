import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import type { AgentContext, AgentObservation } from "@eris/sdk";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ascon-zeta-r-logs.json", import.meta.url), "utf8"));
const bakedParams = 'const PARAMS: Params = { ...DEFAULTS };';
const envParams = 'const PARAMS = parseZetaParams(process.env.ASCON_ZETA_PARAMS);';
let serial = 0;
type Agent = { decide: (o: AgentObservation, ctx: AgentContext) => Promise<unknown> };

// Separate module graphs isolate import-time environment, persistence, and specialist state.
// No temporary agent files, network, RPC, Anvil, or writes into the measurement worktree.
async function loadAgent(id: string, mutation?: [string, string], mutationFile = "delta", entry = "agent"): Promise<any> {
  const own: Record<string, string> = {};
  for (const file of (id === "ascon-zeta-r2" ? ["launchSwap", "delta", "launch", "agent"] : ["delta", "launch", "agent"])) {
    let source = readFileSync(resolve(root, `example/agents/${id}/${file}.ts`), "utf8");
    if (mutation && file === mutationFile) {
      assert.equal(source.split(mutation[0]).length, 2, "mutation must hit exactly once");
      source = source.replace(...mutation);
    }
    source = source.replace(/from "([^"]+)"/g, (match, spec: string) => {
      if (spec.startsWith("@eris/sdk")) {
        const suffix = spec === "@eris/sdk" ? "index.ts" : spec.slice("@eris/sdk/".length).replace(/\.js$/, ".ts");
        return `from ${JSON.stringify(pathToFileURL(resolve(root, "sdk/src", suffix)).href)}`;
      }
      if (spec.startsWith("./")) return `from ${JSON.stringify(own[spec.slice(2, -3)])}`;
      if (spec.startsWith("../lib/")) return `from ${JSON.stringify(pathToFileURL(resolve(root, "example/agents/lib", spec.slice(7).replace(/\.js$/, ".ts"))).href)}`;
      if (spec === "viem") return `from ${JSON.stringify(import.meta.resolve("viem"))}`;
      return match;
    });
    own[file] = 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source + `\n// isolated ${serial++}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText).toString('base64');
  }
  return import(own[entry]);
}

const ctx = { publicClient: new Proxy({}, { get() { throw new Error("offline replay must not use RPC"); } }),
  log() {} } as unknown as AgentContext;


const candidate = "ascon-zeta-r2";
const fundingMutation: [string, string] = ["const sellFunded = canFund(fundedObs, bestTwo.base) && held >= baseSell;", "const sellFunded = true;"];

function probe(base = "WETH"): any {
  const o = structuredClone(fixture.windows[0].frames[0].observation);
  o.blockNumber = "1"; o.agentAddress = "0x1111111111111111111111111111111111111111";
  o.fairPriceUsdcPerWeth = 3000; o.fairPricesUsd = { [base]: base === "WETH" ? 3000 : 60000 };
  o.balances = { usdcUnits: "20000000000", wethWei: "8000000000000000000", ethWei: "1000000000000000000" };
  const cheap = { priceUsdcPerWeth: base === "WETH" ? 2800 : 56000, fee: 3000 };
  const rich = { priceUsdcPerWeth: base === "WETH" ? 3100 : 62000,
    buyPriceUsdcPerWeth: base === "WETH" ? 3110 : 62200,
    sellPriceUsdcPerWeth: base === "WETH" ? 3090 : 61800, effectiveHalfSpreadBps: 30 };
  o.protocols = base === "WETH" ? { uniswap: { pool: cheap }, curve: rich }
    : { uniswap: { markets: { "WBTC/USDC": cheap } }, curve: { markets: { "WBTC/USDC": rich } } };
  o.competition.maxCompetitorPriorityFeeWei = "100000000";
  o.limits.maxPriorityFeePerGasWei = "10000000000";
  return o;
}

test("32 real-log frames: original decisions preserved except witnessed fixes 1/2/4", async t => {
  let compared = 0, identical = 0;
  const differences: unknown[] = [];
  for (const window of fixture.windows) {
    const old = await loadAgent("ascon-zeta-r"), fixed = await loadAgent(candidate);
    const fundingRestored = await loadAgent(candidate, fundingMutation);
    for (const { observation: o } of window.frames) {
      // These fixtures have no launch or Liquity observations: fixes 1 and 4 cannot apply.
      assert.ok(!o.registry?.entries?.some((e: any) => e.kind === "uniswapV3Pool"));
      assert.ok(!o.protocols.liquity);
      const expected = await old.decide(structuredClone(o), ctx);
      const actual = await fixed.decide(structuredClone(o), ctx);
      const oldFundingAction = await fundingRestored.decide(structuredClone(o), ctx);
      compared++;
      if (JSON.stringify(actual) === JSON.stringify(expected)) { identical++; continue; }
      const reasons = [];
      if (expected?.type === "bundle" && actual?.type !== "bundle") {
        assert.deepEqual(oldFundingAction, expected);
        reasons.push("fix2: sell leg not independently funded");
      }
      assert.ok(reasons.length, `unexplained difference ${window.run}:${o.blockNumber}`);
      differences.push({ run: window.run, regime: window.regime, block: o.blockNumber, reasons });
    }
  }
  assert.equal(compared, 32); assert.ok(identical > 0); assert.equal(identical + differences.length, 32);
  t.diagnostic(JSON.stringify({ compared, identical, differences,
    ...(differences.length === 0 ? { result: "No differing frames; fixes 1/2/4 do not change these decisions" } : {}) }));
});

test("fix1 allowance: preserve normal router allowance, confirm approval before swap; old exact approve is red", async () => {
  const { TOKENS } = await import("../sdk/src/constants.js");
  const { decodeFunctionData } = await import("viem");
  const { erc20Abi } = await import("../sdk/src/abis.js");
  const fixed = await loadAgent(candidate, undefined, "delta", "launchSwap");
  const broken = await loadAgent(candidate, [
    'txs: [exactInputSingleTx(args)]',
    'txs: [approveTx(args.tokenIn, UNISWAP.swapRouter, args.amountIn), exactInputSingleTx(args)]',
  ], "launchSwap", "launchSwap");
  const args = { tokenIn: TOKENS.USDC.address, tokenOut: TOKENS.WETH.address,
    fee: 3000, recipient: probe().agentAddress, amountIn: 1000000n, minOut: 1n,
    reason: "test", maxPriorityFeePerGasWei: "100000000" };
  let allowance = (1n << 256n) - 1n;
  const client = { readContract: async (q: any) => { assert.equal(q.functionName, "allowance"); return allowance; } };
  const invariant = async (agent: any) => assert.equal((await agent.swapBundle(client, args)).txs.length, 1, "must not shrink allowance");
  await invariant(fixed);
  await assert.rejects(invariant(broken), { code: "ERR_ASSERTION" });
  allowance = 0n;
  const approve = await fixed.swapBundle(client, args);
  assert.equal(approve.type, "rawTx");
  assert.equal(decodeFunctionData({ abi: erc20Abi, data: approve.tx.data }).functionName, "approve");
  assert.equal((decodeFunctionData({ abi: erc20Abi, data: approve.tx.data }).args as any)[1], (1n << 256n) - 1n);
  assert.equal((await fixed.swapBundle(client, args)).type, "rawTx", "no inclusion, no swap");
  allowance = args.amountIn;
  assert.equal((await fixed.swapBundle(client, args)).txs.length, 1);
});

test("fix2 independent confirmed funding, including WBTC decimals; dependent bundle is red", async () => {
  for (const base of ["WETH", "WBTC"]) {
    const fixed = await loadAgent(candidate), broken = await loadAgent(candidate, fundingMutation);
    const o = probe(base);
    if (base === "WETH") o.balances.wethWei = "0"; else o.baseBalances.WBTC = "0";
    const invariant = async (agent: any) => {
      const a = await agent.decide(structuredClone(o), ctx);
      assert.notEqual(a.type, "bundle", "unconfirmed buy cannot fund sell");
      assert.equal(a.tokenIn, "USDC"); assert.equal(a.slippageBps, 120);
    };
    await invariant(fixed); await assert.rejects(invariant(broken), { code: "ERR_ASSERTION" });
    o.blockNumber = "2";
    assert.notEqual((await fixed.decide(o, ctx)).type, "bundle", "still unconfirmed");
    if (base === "WETH") o.balances.wethWei = "8000000000000000000"; else o.baseBalances.WBTC = "40000000";
    o.blockNumber = "3";
    assert.equal((await fixed.decide(o, ctx)).type, "bundle", "confirmed WBTC raw units fund a leg");
  }
});

async function recoverySequence(agent: any, quoted = 3000000000n, pending = false): Promise<any> {
  const o = probe(); o.protocols = { uniswap: { pool: { priceUsdcPerWeth: 3000, fee: 3000 } },
    liquity: { eusdBalanceWei: "0", spDepositEusdWei: "0", spEthGainWei: "0", suggestedGasReserveWei: "0", marketQuoted: false } };
  const local = { log() {}, publicClient: {
    getTransactionCount: async ({ blockTag }: any) => pending && blockTag === "pending" ? 2 : 1,
    simulateContract: async ({ args }: any) => { assert.equal(args[0].amountIn, 1000000000000000000n); return { result: [quoted] }; },
  } };
  await agent.decide(o, local);
  o.blockNumber = "2"; o.balances.ethWei = "2000000000000000000";
  const wrap = await agent.decide(o, local);
  if (pending) return wrap;
  assert.equal(wrap.type, "rawTx"); assert.equal(wrap.tx.value, "1000000000000000000");
  o.blockNumber = "3"; o.balances.ethWei = "999900000000000000"; o.balances.wethWei = "9000000000000000000";
  const sell = await agent.decide(o, local);
  if (sell.type === "swap") {
    o.blockNumber = "4";
    assert.equal((await agent.decide(o, local)).type, "noop", "do not duplicate a pending sell");
  }
  return sell;
}

test("fix4 attribution/quote/cost/pending guards; all surplus recovery is red", async () => {
  // Own wrap plus unrelated inventory predating the wrap: recover only the wrap.
  const run = async (agent: any) => {
    const o = probe(); o.protocols.liquity = { eusdBalanceWei: "0", spDepositEusdWei: "0", spEthGainWei: "0", suggestedGasReserveWei: "0", marketQuoted: false };
    await agent.decide(o, ctx);
    o.blockNumber = "2"; o.balances.wethWei = "10000000000000000000";
    const a = await agent.decide(o, ctx);
    assert.notEqual(a?.amountIn, "2000000000000000000", "delta inventory is not redemption proceeds");
  };
  await run(await loadAgent(candidate));
  // Restore precisely the original early, unquoted surplus branch.
  const oldRecovery = ['      // Recovery owns only WETH',
    '      const oldExcess = weth > initialWeth! ? weth - initialWeth! : 0n;\n      if (oldExcess >= 10n ** 16n) return { type: "swap", tokenIn: "WETH", amountIn: oldExcess.toString(), slippageBps: 100, maxPriorityFeePerGasWei: fee };\n      // Recovery owns only WETH'] as [string, string];
  await assert.rejects(run(await loadAgent(candidate, oldRecovery, "agent")), { code: "ERR_ASSERTION" });
  const sell = await recoverySequence(await loadAgent(candidate));
  assert.equal(sell.type, "swap"); assert.equal(sell.amountIn, "1000000000000000000"); assert.equal(sell.slippageBps, 100);
  assert.equal((await recoverySequence(await loadAgent(candidate), 2900000000n)).type, "noop", "bad quote/cost");
  assert.equal((await recoverySequence(await loadAgent(candidate), 0n)).type, "noop", "zero quote");
  assert.equal((await recoverySequence(await loadAgent(candidate), 3000000000n, true)).type, "noop", "pending nonce");
});
test("zeta-r2 ignores hostile delta/zeta env on 32 real-log frames and an SP probe; restored env read fails", async (t) => {
  const beforeDelta = process.env.ASCON_DELTA_PARAMS;
  const beforeZeta = process.env.ASCON_ZETA_PARAMS;
  let compared = 0;
  // The real-log frames contain neither Liquity nor launch observations. This
  // separate synthetic probe makes the restored-env red control non-vacuous.
  const probe = structuredClone(fixture.windows[0].frames[0].observation);
  probe.protocols.liquity = {
    eusdBalanceWei: "0", spDepositEusdWei: "0",
    spEthGainWei: "10000000000000000", suggestedGasReserveWei: "0",
  };
  async function assertSameDecision(normal: Agent, poisoned: Agent, observation: AgentObservation, label: string) {
    const expected = await normal.decide(structuredClone(observation), ctx);
    const actual = await poisoned.decide(structuredClone(observation), ctx);
    assert.deepEqual(actual, expected, label);
    return expected;
  }
  try {
    for (const poison of ["delta", "zeta", "both"]) {
      for (const window of fixture.windows) {
        delete process.env.ASCON_DELTA_PARAMS;
        delete process.env.ASCON_ZETA_PARAMS;
        const normal = await loadAgent("ascon-zeta-r2");
        if (poison !== "zeta") process.env.ASCON_DELTA_PARAMS = '{"bidMode":0,"gasPerSwap":9999999,"SAFETY_MARGIN_BPS":0}';
        if (poison !== "delta") process.env.ASCON_ZETA_PARAMS = '{"launch":false,"redemption":false,"stabilityPool":false}';
        const poisoned = await loadAgent("ascon-zeta-r2");
        for (const { observation } of window.frames) {
          await assertSameDecision(normal, poisoned, observation, `${poison}:${window.run}:${observation.blockNumber}`);
          compared++;
        }
      }
    }
    assert.equal(compared, 3 * 32);
    delete process.env.ASCON_DELTA_PARAMS;
    delete process.env.ASCON_ZETA_PARAMS;
    const normal = await loadAgent("ascon-zeta-r2");
    process.env.ASCON_ZETA_PARAMS = '{"launch":false,"redemption":false,"stabilityPool":false}';
    const poisoned = await loadAgent("ascon-zeta-r2");
    const restored = await loadAgent("ascon-zeta-r2", [bakedParams, envParams], "agent");
    const expected = await assertSameDecision(normal, poisoned, probe, "SP probe: baked defaults ignore poison");
    assert.equal((expected as { type: string }).type, "liquityWithdrawFromSP");
    await assert.rejects(assertSameDecision(normal, restored, probe, "SP probe: restored env read"),
      { code: "ERR_ASSERTION", message: /SP probe: restored env read/ });
    t.diagnostic(JSON.stringify({ hostileEnvFrames: compared, framesPerPoison: 32, restoredEnvRedControl: "PASS (SP probe assertion rejected)" }));
  } finally {
    if (beforeDelta === undefined) delete process.env.ASCON_DELTA_PARAMS; else process.env.ASCON_DELTA_PARAMS = beforeDelta;
    if (beforeZeta === undefined) delete process.env.ASCON_ZETA_PARAMS; else process.env.ASCON_ZETA_PARAMS = beforeZeta;
  }
});


test("candidate has baked parameters and no environment reads", () => {
  for (const file of readdirSync(resolve(root, `example/agents/${candidate}`))) {
    if (/\.(ts|md)$/.test(file)) assert.doesNotMatch(readFileSync(resolve(root, `example/agents/${candidate}`, file), "utf8"), /process\s*\.\s*env|numberEnv\(/);
  }
});
