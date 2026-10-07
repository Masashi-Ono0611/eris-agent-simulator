// Offline research diagnostics: mocked chain reads, no sender or transaction execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import type { AgentContext } from "@eris/sdk";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ascon-zeta-r-logs.json", import.meta.url), "utf8"));
let serial = 0;

// Separate module graphs isolate import-time environment, persistence, and specialist state.
// No temporary agent files, network, RPC, Anvil, or writes into the measurement worktree.
async function loadAgent(id: string): Promise<any> {
  const own: Record<string, string> = {};
  for (const file of ["launchSwap", "delta", "launch", "agent"]) {
    let source = readFileSync(resolve(root, `example/agents/${id}/${file}.ts`), "utf8");
    if (file === "agent") source += "\nexport function recoveryState() { return structuredClone({ recoveryWeth, wrapPending, recoverySellPending }); }";
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
  return import(own.agent);
}

const candidates = ["ascon-zeta-r3", "ascon-zeta-r3a"];
const WAD = 10n ** 18n;
function probe(): any {
  const o = structuredClone(fixture.windows[0].frames[0].observation);
  o.blockNumber = "1";
  o.agentAddress = "0x1111111111111111111111111111111111111111";
  o.enabledProtocols = ["uniswap", "curve", "liquity"];
  o.registry = { entries: [] };
  o.fairPriceUsdcPerWeth = 3000;
  o.fairPricesUsd = { WETH: 3000 };
  o.balances = { usdcUnits: "20000000000", wethWei: String(8n * WAD), ethWei: String(WAD) };
  o.protocols = {
    uniswap: { pool: { priceUsdcPerWeth: 2800, fee: 3000 } },
    curve: { priceUsdcPerWeth: 3100, buyPriceUsdcPerWeth: 3110,
      sellPriceUsdcPerWeth: 3090, effectiveHalfSpreadBps: 30 },
    liquity: { eusdBalanceWei: "0", spDepositEusdWei: "0", spEthGainWei: "0",
      suggestedGasReserveWei: "0", marketQuoted: false },
  };
  o.competition.maxCompetitorPriorityFeeWei = "100000000";
  o.limits.maxPriorityFeePerGasWei = "10000000000";
  return o;
}
function mockContext(quote = 2900000000n) {
  const state = { quote, pending: false, amounts: [] as bigint[] };
  const ctx = { log() {}, publicClient: {
    getTransactionCount: async ({ blockTag }: any) => state.pending && blockTag === "pending" ? 2 : 1,
    simulateContract: async ({ functionName, args }: any) => {
      assert.equal(functionName, "quoteExactInputSingle");
      state.amounts.push(args[0].amountIn);
      return { result: [state.quote] };
    },
  } } as unknown as AgentContext;
  return { state, ctx };
}
// Establish one confirmed own wrap. Initial delta actions are not applied to balances.
async function prepareRecovery(agent: any, ctx: AgentContext) {
  const o = probe();
  assert.equal((await agent.decide(structuredClone(o), ctx)).type, "bundle");
  o.blockNumber = "2"; o.balances.ethWei = String(2n * WAD);
  const wrap = await agent.decide(structuredClone(o), ctx);
  assert.equal(wrap.type, "rawTx");
  assert.equal(wrap.tx.data, "0xd0e30db0");
  assert.equal(wrap.tx.value, String(WAD));
  o.blockNumber = "3"; o.balances.ethWei = "999900000000000000";
  o.balances.wethWei = String(9n * WAD);
  return o;
}
const bytes = (action: unknown) => Buffer.from(JSON.stringify(action));

for (const quote of [0n, -1n, 2900000000n]) {
  test(`r3 suppression control and r3a delta fall-through: recovery quote ${quote}`, async () => {
    const r3 = await loadAgent(candidates[0]), r3a = await loadAgent(candidates[1]);
    const a = mockContext(quote), b = mockContext(quote);
    const obs = await prepareRecovery(r3, a.ctx);
    assert.deepEqual(await prepareRecovery(r3a, b.ctx), obs);
    assert.deepEqual(await r3.decide(structuredClone(obs), a.ctx),
      { type: "noop", reason: "recovery quote/cost not competitive" });
    const action = await r3a.decide(structuredClone(obs), b.ctx);
    assert.equal(action.type, "bundle");
    assert.deepEqual(action.actions.map((leg: any) => [leg.type, leg.tokenIn]),
      [["swap", "USDC"], ["curveSwap", "WETH"]]);
    const withoutRecovery = structuredClone(obs);
    delete withoutRecovery.protocols.liquity;
    const baseline = await loadAgent(candidates[0]);
    assert.deepEqual(bytes(action), bytes(await baseline.decide(withoutRecovery, mockContext().ctx)));
    assert.deepEqual(b.state.amounts, [WAD]);
    assert.deepEqual(r3a.recoveryState(), r3.recoveryState());
  });
}

test("r3a preserves deferred recovery state and later sells the same own-wrap WETH exactly once", async () => {
  const agent = await loadAgent(candidates[1]);
  const { state, ctx } = mockContext();
  const obs = await prepareRecovery(agent, ctx);
  assert.equal((await agent.decide(structuredClone(obs), ctx)).type, "bundle");
  const deferred = { recoveryWeth: WAD, wrapPending: undefined, recoverySellPending: undefined };
  assert.deepEqual(agent.recoveryState(), deferred);
  obs.blockNumber = "4";
  // Fresh ETH must not cause another wrap while the recovery sell is deferred.
  obs.balances.ethWei = String(2n * WAD);
  // Unrelated inventory acquired meanwhile must not enlarge recovery's one-WETH ownership.
  obs.balances.wethWei = String(10n * WAD);
  assert.equal((await agent.decide(structuredClone(obs), ctx)).type, "bundle");
  assert.deepEqual(agent.recoveryState(), deferred);
  state.quote = 3000000000n;
  obs.blockNumber = "5"; obs.balances.ethWei = "999900000000000000";
  const sell = await agent.decide(structuredClone(obs), ctx);
  assert.equal(sell.type, "swap"); assert.equal(sell.tokenIn, "WETH");
  assert.equal(sell.amountIn, String(WAD)); assert.equal(sell.slippageBps, 100);
  const pending = { ...deferred, recoverySellPending: { weth: 10n * WAD, amount: WAD } };
  assert.deepEqual(agent.recoveryState(), pending);
  obs.blockNumber = "6";
  assert.deepEqual(await agent.decide(structuredClone(obs), ctx),
    { type: "noop", reason: "awaiting recovery sell balance" });
  assert.deepEqual(agent.recoveryState(), pending);
  obs.blockNumber = "7"; obs.balances.wethWei = String(9n * WAD);
  assert.equal((await agent.decide(structuredClone(obs), ctx)).type, "bundle");
  assert.deepEqual(agent.recoveryState(), { ...deferred, recoveryWeth: 0n });
  obs.blockNumber = "8";
  assert.equal((await agent.decide(structuredClone(obs), ctx)).type, "bundle");
  assert.deepEqual(state.amounts, [WAD, WAD, WAD], "no second recovery quote or sell after confirmation");
});

for (const row of [
  { name: "competitive recovery", recovery: true, quote: 3000000000n, type: "swap" },
  { name: "better recovery quote", recovery: true, quote: 3010000000n, type: "swap" },
  { name: "no recovery inventory", recovery: false, quote: 0n, type: "bundle" },
  { name: "no Liquity observation", recovery: false, quote: 0n, type: "bundle", absent: true },
]) {
  test(`r3a/r3 byte-equal actions: ${row.name}`, async () => {
    const actions = [];
    for (const id of candidates) {
      const agent = await loadAgent(id), { ctx } = mockContext(row.quote);
      const obs = row.recovery ? await prepareRecovery(agent, ctx) : probe();
      if (row.absent) delete obs.protocols.liquity;
      const action = await agent.decide(obs, ctx);
      assert.equal(action.type, row.type);
      actions.push(bytes(action));
    }
    assert.deepEqual(actions[1], actions[0]);
  });
}

for (const path of ["stability pool", "liquidation"]) {
  test(`r3a reaches Liquity ${path} after uncompetitive recovery`, async () => {
    const agent = await loadAgent(candidates[1]), { ctx } = mockContext();
    const obs = await prepareRecovery(agent, ctx);
    if (path === "stability pool") obs.protocols.liquity.spEthGainWei = String(WAD / 100n);
    else Object.assign(obs.protocols.liquity, { spDepositEusdWei: String(201n * WAD), mcr: 1.1,
      riskiestTrove: { owner: obs.agentAddress, icr: 1.0 } });
    assert.equal((await agent.decide(obs, ctx)).type,
      path === "stability pool" ? "liquityWithdrawFromSP" : "liquityLiquidate");
    assert.deepEqual(agent.recoveryState(),
      { recoveryWeth: WAD, wrapPending: undefined, recoverySellPending: undefined });
  });
}

for (const reason of ["recovery quote unavailable", "awaiting confirmed wrap balance", "recovery transaction pending"]) {
  test(`r3a/r3 retain attribution guard: ${reason}`, async () => {
    const actions = [];
    for (const id of candidates) {
      const agent = await loadAgent(id), { state, ctx } = mockContext();
      const obs = await prepareRecovery(agent, ctx);
      if (reason === "recovery quote unavailable") delete obs.protocols.uniswap;
      if (reason === "awaiting confirmed wrap balance") {
        obs.balances.wethWei = String(8n * WAD); obs.balances.ethWei = String(2n * WAD);
      }
      if (reason === "recovery transaction pending") state.pending = true;
      const action = await agent.decide(obs, ctx);
      assert.deepEqual(action, { type: "noop", reason }); actions.push(bytes(action));
    }
    assert.deepEqual(actions[1], actions[0]);
  });
}

// Line-multiset checks are order-independent across hunks; byte checks also pin placement.
const candidateDir = (id: string) => resolve(root, "example/agents", id);
const source = (id: string, file: string) => readFileSync(resolve(candidateDir(id), file), "utf8");
function minus(from: string[], other: string[]) {
  const left = [...other], out: string[] = [];
  for (const line of from) {
    const at = left.indexOf(line);
    if (at >= 0) left.splice(at, 1); else out.push(line);
  }
  return out.sort();
}
test("r3a identity: copied file set and only intended source lines differ from r3", () => {
  assert.deepEqual(readdirSync(candidateDir(candidates[1])).sort(), readdirSync(candidateDir(candidates[0])).sort());
  const before = [
    '    if (liq && params.redemption && canSwap) {',
    '          if (quoted <= 0n || priority === null) return noop("recovery quote/cost not competitive");',
  ];
  const after = [
    '    recovery: if (liq && params.redemption && canSwap) {',
    '          if (quoted <= 0n || priority === null) break recovery; // r3a: fall through instead of ending the block',
  ];
  const r3 = source(candidates[0], "agent.ts"), r3a = source(candidates[1], "agent.ts");
  assert.deepEqual(minus(r3.split("\n"), r3a.split("\n")), [...before].sort());
  assert.deepEqual(minus(r3a.split("\n"), r3.split("\n")), [...after].sort());
  assert.equal(r3a, r3.replace(before[0], after[0]).replace(before[1], after[1]));
  for (const file of ["delta.ts", "launch.ts", "launchSwap.ts"])
    assert.equal(source(candidates[1], file), source(candidates[0], file), file);
});
test("r3a prompt identity: only name, description and one research sentence differ", () => {
  const r3 = source(candidates[0], "prompt.md"), r3a = source(candidates[1], "prompt.md");
  const oldName = "name: ascon-zeta-r3";
  const newName = "name: ascon-zeta-r3a";
  const oldDescription = 'description: "ascon-zeta-r3: byte-identical r2 strategy with evidence-gated revision prompt hardening; no enforced revision guard."';
  const newDescription = 'description: "ascon-zeta-r3a: research variant of r3 with recovery quote/cost fall-through only; not a submission candidate."';
  const sentence = "This is a research variant of r3 whose only change is to fall through to the remaining decision logic when the recovery quote/cost check fails.";
  assert.deepEqual(minus(r3.split("\n"), r3a.split("\n")), [oldName, oldDescription].sort());
  assert.deepEqual(minus(r3a.split("\n"), r3.split("\n")), ["", newName, newDescription, sentence].sort());
  assert.equal(r3a, r3.replace(oldName, newName).replace(oldDescription, newDescription) + `\n${sentence}\n`);
});
