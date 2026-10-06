// Offline identity checks only; prompt hardening is not revision enforcement.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
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
  for (const file of ["launchSwap", "delta", "launch", "agent"]) {
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


const codeFiles = ["agent.ts", "delta.ts", "launch.ts", "launchSwap.ts"];
const candidateDir = (id: string) => resolve(root, "example/agents", id);

test("r3 contains only the five candidate files; all four code SHA-256 hashes equal r2", () => {
  assert.deepEqual(readdirSync(candidateDir("ascon-zeta-r3")).sort(), [...codeFiles, "prompt.md"].sort());
  for (const file of codeFiles) {
    const sha256 = (id: string) => createHash("sha256")
      .update(readFileSync(resolve(candidateDir(id), file))).digest("hex");
    assert.equal(sha256("ascon-zeta-r3"), sha256("ascon-zeta-r2"), file);
  }
});

test("prompt diff contains only the r3 name/description and the hardening sentence", () => {
  const path = (id: string) => resolve(candidateDir(id), "prompt.md");
  const diff = spawnSync("diff", ["-U", "0", path("ascon-zeta-r2"), path("ascon-zeta-r3")], { encoding: "utf8" });
  assert.ifError(diff.error);
  assert.equal(diff.status, 1, diff.stderr);
  const changes = diff.stdout.split("\n").filter(line => /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line));
  assert.deepEqual(changes, [
    "-name: ascon-zeta-r2",
    '-description: "ascon-zeta-r with 3 bounded fixes: launch allowance, independent bundle funding, and attributable WETH recovery; original venue bidding preserved."',
    "+name: ascon-zeta-r3",
    '+description: "ascon-zeta-r3: byte-identical r2 strategy with evidence-gated revision prompt hardening; no enforced revision guard."',
    "+executorTs: null unless the evidence shows a clear improvement",
    "+",
  ]);
  const prompt = readFileSync(path("ascon-zeta-r3"), "utf8");
  const frontmatter = prompt.split("---")[1];
  assert.match(frontmatter, /^kind: improve$/m);
  assert.match(frontmatter, /^reviseEveryBlocks: 60$/m);
  assert.doesNotMatch(frontmatter, /^\s*model\s*:/m);
});

test("unrevised r3 matches r2 decisions on all 32 real-log frames", async () => {
  let compared = 0;
  for (const window of fixture.windows) {
    const r2 = await loadAgent("ascon-zeta-r2"), r3 = await loadAgent("ascon-zeta-r3");
    for (const { observation } of window.frames) {
      assert.deepEqual(await r3.decide(structuredClone(observation), ctx),
        await r2.decide(structuredClone(observation), ctx), `${window.run}:${observation.blockNumber}`);
      compared++;
    }
  }
  assert.equal(compared, 32);
});

test("zeta-r3 matches r2 despite hostile delta/zeta env on 32 real-log frames and an SP probe; restored env read fails", async (t) => {
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
        const poisoned = await loadAgent("ascon-zeta-r3");
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
    const poisoned = await loadAgent("ascon-zeta-r3");
    const restored = await loadAgent("ascon-zeta-r3", [bakedParams, envParams], "agent");
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
