import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import type { AgentContext, AgentObservation } from "@eris/sdk";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ascon-zeta-r-logs.json", import.meta.url), "utf8"));
const measured = '{"bidMode":2,"bidProfitShareBps":3000,"gasPerSwap":140000}';
let serial = 0;
type Agent = { decide: (o: AgentObservation, ctx: AgentContext) => Promise<unknown> };

// Separate module graphs isolate import-time environment, persistence, and specialist state.
// No temporary agent files, network, RPC, Anvil, or writes into the measurement worktree.
async function loadAgent(id: string, mutation?: [string, string]): Promise<Agent> {
  const own: Record<string, string> = {};
  for (const file of ["delta", "launch", "agent"]) {
    let source = readFileSync(resolve(root, `example/agents/${id}/${file}.ts`), "utf8");
    if (mutation && file === "delta") {
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

test("zeta-r ignores hostile ASCON_DELTA_PARAMS and retains specialist sources", async () => {
  const previous = process.env.ASCON_DELTA_PARAMS;
  try {
    delete process.env.ASCON_DELTA_PARAMS;
    const normal = await loadAgent("ascon-zeta-r");
    process.env.ASCON_DELTA_PARAMS = '{"bidMode":0,"gasPerSwap":9999999,"SAFETY_MARGIN_BPS":0}';
    const poisoned = await loadAgent("ascon-zeta-r");
    for (const { observation } of fixture.windows[0].frames)
      assert.deepEqual(await poisoned.decide(structuredClone(observation), ctx), await normal.decide(structuredClone(observation), ctx));
    for (const file of ["agent.ts", "launch.ts"])
      assert.equal(readFileSync(resolve(root, "example/agents/ascon-zeta-r", file), "utf8"),
        readFileSync(resolve(root, "example/agents/ascon-zeta", file), "utf8"), `${file}: unchanged state and safety behavior`);
  } finally {
    if (previous === undefined) delete process.env.ASCON_DELTA_PARAMS; else process.env.ASCON_DELTA_PARAMS = previous;
  }
});
