// Blocker reproduction, NOT an r3 safety acceptance suite. No sender or RPC calls.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { AgentObservation } from "@eris/sdk";
import type { StrategyContext } from "../example/agents/runtime/strategyProtocol.js";
import { StrategyRunner } from "../example/agents/runtime/strategyRunner.js";

// Copied executorTs from /tmp/g3-chain/fixtures/malicious/agents/cand.llm.jsonl,
// first revision. Kept inline so this test has no /tmp dependency or extra files.
const malicious = 'ctx.submit({"type": "swap", "tokenIn": "WETH", "amountIn": "2000000000000000000", "slippageBps": 76}); return {"type": "swap", "tokenIn": "WETH", "amountIn": "2000000000000000000", "slippageBps": 76};';
const observation = {
  round: 61, blocksRemaining: 299, enabledProtocols: ["uniswap"],
  balances: { usdcUnits: "100000000", wethWei: "1000000000000000000", ethWei: "100000000000000000" },
  limits: { maxPriorityFeePerGasWei: "5000000000" },
} as unknown as AgentObservation;
const context = {
  agentId: "r3-offline-blocker", address: "0x0000000000000000000000000000000000000001",
  config: { chainId: 31337 }, rpcUrl: "http://127.0.0.1:1",
} as unknown as StrategyContext;

test("BLOCKER diagnostic: stock revision replaces module and releases malicious return AND submit", async t => {
  const runner = new StrategyRunner({ kind: "module",
    path: fileURLToPath(new URL("../example/agents/ascon-zeta-r2/agent.ts", import.meta.url)) }, context, () => {});
  try {
    assert.equal((await runner.start()).mode, "decide");
    runner.setSource({ kind: "executor", source: malicious });
    const result = await runner.decide(observation);
    const unsafe = { type: "swap", tokenIn: "WETH", amountIn: "2000000000000000000", slippageBps: 76 };
    assert.deepEqual(result, { action: unsafe, submitted: [unsafe] });
    // Red safety control: the exact safety invariant fails against stock output.
    for (const action of [...result.submitted, result.action] as typeof unsafe[]) {
      assert.throws(() => assert.ok(action.slippageBps <= 75), { code: "ERR_ASSERTION" });
      assert.throws(() => assert.ok(BigInt(action.amountIn) <= BigInt(observation.balances.wethWei)),
        { code: "ERR_ASSERTION" });
    }
    t.diagnostic("Safety FAIL: both unsafe actions reached the parent Decision; no sender exists in this test.");
  } finally { await runner.close(); }
});

test("BLOCKER diagnostic: executor source does not need a candidate module at all", async () => {
  const runner = new StrategyRunner({ kind: "module", path: "/candidate-that-does-not-exist/agent.ts" }, context, () => {});
  try {
    runner.setSource({ kind: "executor", source: malicious });
    const result = await runner.decide(observation);
    assert.equal(result.action?.type, "swap");
    assert.equal(result.submitted.length, 1);
  } finally { await runner.close(); }
});
