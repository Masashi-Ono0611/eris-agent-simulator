import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import type { AgentContext, AgentObservation } from "@eris/sdk";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ascon-zeta-r-logs.json", import.meta.url), "utf8"));
const measured = '{"bidMode":2,"bidProfitShareBps":3000,"gasPerSwap":140000}';
const bakedParams = 'const PARAMS: Params = { ...DEFAULTS };';
const envParams = 'const PARAMS = parseZetaParams(process.env.ASCON_ZETA_PARAMS);';
let serial = 0;
type Agent = { decide: (o: AgentObservation, ctx: AgentContext) => Promise<unknown> };

// Separate module graphs isolate import-time environment, persistence, and specialist state.
// No temporary agent files, network, RPC, Anvil, or writes into the measurement worktree.
async function loadAgent(id: string, mutation?: [string, string], mutationFile = "delta"): Promise<Agent> {
  const own: Record<string, string> = {};
  for (const file of ["delta", "launch", "agent"]) {
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
      // viem imports here are type-only and erased by transpileModule.
      return match;
    });
    own[file] = 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source + `\n// isolated ${serial++}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText).toString('base64');
  }
  return import(own.agent);
}

const ctx = { publicClient: new Proxy({}, { get() { throw new Error("offline replay must not use RPC"); } }),
  log() {} } as unknown as AgentContext;

test("zeta-r: measured original env and environment-free release agree on 32 log-derived frames; broken defaults fail", async (t) => {
  const beforeDelta = process.env.ASCON_DELTA_PARAMS;
  const beforeZeta = process.env.ASCON_ZETA_PARAMS;
  let compared = 0, active = 0;
  const mismatches = { bidMode: 0, gasPerSwap: 0, bidProfitShare: 0 };
  try {
    delete process.env.ASCON_ZETA_PARAMS;
    for (const window of fixture.windows) {
      process.env.ASCON_DELTA_PARAMS = measured;
      const original = await loadAgent("ascon-zeta");
      delete process.env.ASCON_DELTA_PARAMS;
      const release = await loadAgent("ascon-zeta-r");
      const mutants = {
        bidMode: await loadAgent("ascon-zeta-r", ["bidMode: 2,", "bidMode: 0,"]),
        gasPerSwap: await loadAgent("ascon-zeta-r", ["gasPerSwap: 140_000,", "gasPerSwap: 200_000,"]),
        bidProfitShare: await loadAgent("ascon-zeta-r", ["bidProfitShareBps: 3000,", "bidProfitShareBps: 1000,"]),
      };
      for (const frame of window.frames) {
        const obs = frame.observation;
        const expected = await original.decide(structuredClone(obs), ctx);
        const actual = await release.decide(structuredClone(obs), ctx);
        assert.deepEqual(actual, expected, `${window.run}:${obs.blockNumber}`);
        compared++;
        if ((actual as { type?: string })?.type !== "noop") active++;
        for (const key of Object.keys(mutants) as (keyof typeof mutants)[]) {
          const broken = await mutants[key].decide(structuredClone(obs), ctx);
          if (JSON.stringify(broken) !== JSON.stringify(expected)) mismatches[key]++;
        }
      }
    }
    assert.equal(compared, 32);
    assert.ok(active > 0, "not a vacuous all-noop comparison");
    for (const [factor, count] of Object.entries(mismatches))
      assert.ok(count > 0, `red control ${factor} must break decision identity`);
    t.diagnostic(JSON.stringify({ compared, active, redControlMismatches: mismatches }));
  } finally {
    if (beforeDelta === undefined) delete process.env.ASCON_DELTA_PARAMS; else process.env.ASCON_DELTA_PARAMS = beforeDelta;
    if (beforeZeta === undefined) delete process.env.ASCON_ZETA_PARAMS; else process.env.ASCON_ZETA_PARAMS = beforeZeta;
  }
});

test("zeta-r ignores hostile delta/zeta env on 32 real-log frames and an SP probe; restored env read fails", async (t) => {
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
        const normal = await loadAgent("ascon-zeta-r");
        if (poison !== "zeta") process.env.ASCON_DELTA_PARAMS = '{"bidMode":0,"gasPerSwap":9999999,"SAFETY_MARGIN_BPS":0}';
        if (poison !== "delta") process.env.ASCON_ZETA_PARAMS = '{"launch":false,"redemption":false,"stabilityPool":false}';
        const poisoned = await loadAgent("ascon-zeta-r");
        for (const { observation } of window.frames) {
          await assertSameDecision(normal, poisoned, observation, `${poison}:${window.run}:${observation.blockNumber}`);
          compared++;
        }
      }
    }
    assert.equal(compared, 3 * 32);
    delete process.env.ASCON_DELTA_PARAMS;
    delete process.env.ASCON_ZETA_PARAMS;
    const normal = await loadAgent("ascon-zeta-r");
    process.env.ASCON_ZETA_PARAMS = '{"launch":false,"redemption":false,"stabilityPool":false}';
    const poisoned = await loadAgent("ascon-zeta-r");
    const restored = await loadAgent("ascon-zeta-r", [bakedParams, envParams], "agent");
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

test("zeta-r retains launch source and changes only the agent PARAMS line; no env reads", () => {
  const read = (id: string, file: string) => readFileSync(resolve(root, "example/agents", id, file), "utf8");
  assert.equal(read("ascon-zeta-r", "launch.ts"), read("ascon-zeta", "launch.ts"), "launch.ts: byte-identical");
  const original = read("ascon-zeta", "agent.ts"), release = read("ascon-zeta-r", "agent.ts");
  assert.equal(original.split(envParams).length, 2, "original PARAMS line occurs once");
  assert.equal(release.split(bakedParams).length, 2, "baked PARAMS line occurs once");
  assert.equal(release, original.replace(envParams, bakedParams), "only the PARAMS line differs");
  for (const file of readdirSync(resolve(root, "example/agents/ascon-zeta-r"), { recursive: true })) {
    if (typeof file === "string" && /\.(ts|md)$/.test(file))
      assert.doesNotMatch(read("ascon-zeta-r", file), /process\s*\.\s*env/, `${file}: no environment reads`);
  }
});
