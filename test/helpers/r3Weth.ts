// Offline research diagnostics: mocked chain reads, no sender or transaction execution.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import type { AgentContext } from "@eris/sdk";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../fixtures/ascon-zeta-r-logs.json", import.meta.url), "utf8"));
let serial = 0;

// Separate module graphs isolate import-time environment, persistence, and specialist state.
// No temporary agent files, network, RPC, Anvil, or writes into the measurement worktree.
export async function loadAgent(id: string): Promise<any> {
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

export const WAD = 10n ** 18n;
export function probe(): any {
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
export function mockContext(quote = 2900000000n) {
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

export const params = { launch: false, redemption: true, stabilityPool: false };
export const cleanState = (recoveryWeth = 0n) => ({ recoveryWeth, wrapPending: undefined, recoverySellPending: undefined });
export function market(o: any, price: number, curve?: number) {
  o.protocols.uniswap.pool.priceUsdcPerWeth = price;
  delete o.protocols.curve;
  if (curve !== undefined) o.protocols.curve = { priceUsdcPerWeth: curve,
    buyPriceUsdcPerWeth: curve, sellPriceUsdcPerWeth: curve, effectiveHalfSpreadBps: 30 };
}
export function brief(a: any): string {
  if (a.type === "noop") return `noop:${a.reason}`;
  if (a.type === "rawTx") return `wrap:${a.tx.value}`;
  if (a.type === "bundle") return `bundle:${a.actions.map(brief).join("+")}`;
  return `${a.type}:${a.tokenIn}:${a.amountIn}`;
}
export const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x);
export async function harness(id: string, initialWeth = 0n) {
  const agent = await loadAgent(id), { state: rpc, ctx } = mockContext(0n), obs = probe();
  obs.balances.wethWei = String(initialWeth);
  market(obs, 3000);
  const trace: any[] = [];
  async function step(block: number) {
    obs.blockNumber = String(block);
    const action = await agent.decideWithParams(structuredClone(obs), params, ctx);
    trace.push({ block, action: structuredClone(action), state: agent.recoveryState() });
    return action;
  }
  assert.equal((await step(1)).type, "noop");
  obs.balances.ethWei = String(2n * WAD);
  assert.equal(brief(await step(2)), `wrap:${WAD}`);
  assert.deepEqual(agent.recoveryState(), { ...cleanState(),
    wrapPending: { weth: initialWeth, eth: 2n * WAD, amount: WAD } });
  obs.balances.ethWei = String(WAD); obs.balances.wethWei = String(initialWeth + WAD);
  return { agent, rpc, ctx, obs, trace, step };
}
export function record(t: { diagnostic(message: string): void }, id: string, trace: unknown) {
  t.diagnostic(`${id} ${json(trace)}`);
}
