// Offline policy/context contract only: this does not prove model compliance or soak results.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadImproveAgent, buildRevisionSystem } from "../example/agents/runtime/improve.js";
import { estimatePromptTokens, DEFAULT_OLLAMA_CONTEXT_TOKENS } from "../example/agents/runtime/llm.js";
import type { ProtocolId } from "@eris/sdk";

const protocols: ProtocolId[] = ["uniswap", "balancer", "curve", "liquity", "aave", "gmx", "lst"];
const arms = [
  { id: "opus-1r", context: 65_536, modules: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "R mechanisms", "M4-first"] },
  { id: "opus-1g2", context: 65_536, modules: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M-OU", "WETH and WBTC", "unmanaged", "not open GMX"] },
  { id: "ascon-zeta-r3k", context: undefined, modules: ["launch first", "Stability Pool", "own-wrap WETH", "K1:", "K2:", "K3:", "both 0 (disabled)"] },
];

for (const { id, context, modules } of arms) {
  test(`${id}: shipping P1 identity, decision gates and arm-specific install losses`, () => {
    const policy = loadImproveAgent(`example/agents/${id}`);
    assert.equal(policy.name, id);
    assert.equal(policy.model, "gpt-oss:120b");
    assert.equal(policy.reviseEveryBlocks, 60);
    assert.equal(policy.contextTokens, context);
    assert.ok(policy.body.includes(`You are maintaining \`${id}\``));
    const losses = policy.body.split("## What a change does\n")[1]?.split("## Read these numbers first")[0];
    assert.ok(losses);
    for (const module of modules) assert.ok(losses.includes(module), `${id}: ${module}`);
    for (const gate of [
      "The target is always 0, never another rewrite.",
      "X is -500 USDC or lower",
      "F is at least 12 and at least half of T",
      "that error names a cause in the strategy's own code",
      "neither your note nor the history shows an earlier install for the same error",
      "you can write a body that trades",
      "3. **Keep** (`executorTs: null`) otherwise.",
    ]) assert.ok(policy.body.includes(gate), `${id}: ${gate}`);
  });

  test(`${id}: revision system plus records and reply fits declared context`, () => {
    const dir = `example/agents/${id}`;
    const policy = loadImproveAgent(dir);
    const system = buildRevisionSystem(policy, readFileSync(`${dir}/agent.ts`, "utf8"), protocols);
    // Same budget as opus-1r.test.ts: typical records 10k, reasoning/keep reply 4k.
    // Runtime's chars/4 estimate can undercount code; this is not a tokenizer guarantee.
    const required = estimatePromptTokens({ system, messages: [] }) + 10_000 + 4_000;
    const window = policy.contextTokens ?? DEFAULT_OLLAMA_CONTEXT_TOKENS;
    assert.ok(required <= window, `${id}: ~${required} tokens exceeds ${window}`);
  });
}

test("opus-1g2: install bar references the defined rule directly", () => {
  const policy = loadImproveAgent("example/agents/opus-1g2");
  assert.ok(policy.body.includes("the bar is exactly rule 2 below"));
  assert.ok(!policy.body.includes("as in P1"));
});
