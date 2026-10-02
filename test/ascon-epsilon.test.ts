import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decide, decideWithParams, parseEpsilonParams } from "../example/agents/ascon-epsilon/agent.js";
import { decide as delta } from "../example/agents/ascon-epsilon/delta.js";
import { TOKENS } from "@eris/sdk/constants.js";

function observation(overrides: Record<string, unknown> = {}): any {
  return { round: 10, blockNumber: 10, blocksRemaining: 100, enabledProtocols: ["uniswap"],
    balances: { usdcUnits: "25000000000", wethWei: "8000000000000000000", ethWei: "1000000000000000000" },
    limits: { defaultPriorityFeePerGasWei: "100000000" }, protocols: {}, ...overrides };
}
const allOff = { launch: false, redemption: false, stabilityPool: false };
const launchPool = "0x0000000000000000000000000000000000000100";
const token = "0x0000000000000000000000000000000000000200";
const registry = { entries: [{ kind: "uniswapV3Pool", market: launchPool, token0: token, token1: TOKENS.USDC.address,
  creator: "0x0000000000000000000000000000000000000003", mine: false, registeredAtBlock: "1" }] };

test("epsilon is self-contained from other agent directories", async () => {
  const { readdir } = await import("node:fs/promises");
  for (const f of await readdir(new URL("../example/agents/ascon-epsilon/", import.meta.url))) {
    if (!f.endsWith(".ts")) continue;
    const source = await readFile(new URL(`../example/agents/ascon-epsilon/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']\.\.\/(?!lib\/|runtime\/)/, f);
  }
});

test("no specialist opportunity and all experts off exactly match local delta", () => {
  const obs = observation();
  assert.deepEqual(decideWithParams(obs, allOff), delta(obs));
  assert.deepEqual(parseEpsilonParams("bad"), { launch: true, redemption: true, stabilityPool: true });
  assert.deepEqual(parseEpsilonParams('{"launch":false}'), { launch: false, redemption: true, stabilityPool: true });
});

test("launch confirms consecutive buying, then exits on selling, max hold, and endgame", async () => {
  let logs: any[] = [], held = 0n;
  const client: any = {
    readContract: async ({ functionName, address }: any) => functionName === "fee" ? 3000n : functionName === "slot0" ? [2n ** 96n] : functionName === "liquidity" ? 100000n : address.toLowerCase() === token.toLowerCase() ? held : 1_000_000_000_000n,
    getLogs: async () => logs,
    simulateContract: async () => ({ result: [2_000_000_000n] }),
  };
  const messages: string[] = [];
  const ctx: any = { address: "0x0000000000000000000000000000000000000004", publicClient: client, log(x: any) { messages.push(x.reason); } };
  const obsAt = (block: number, remaining = 100) => observation({ blockNumber: block, round: block, blocksRemaining: remaining, registry });
  const buyFlow = () => { logs = [{ args: { amount0: -3_000_000_000n, amount1: 3_000_000_000n } }]; };
  await decide(obsAt(2), ctx); buyFlow(); await decide(obsAt(3), ctx); buyFlow(); await decide(obsAt(4), ctx); buyFlow();
  const buy: any = await decide(obsAt(5), ctx);
  assert.equal(buy.type, "rawBundle"); assert.match(buy.reason, /entry/); held = 5n * 10n ** 18n;
  logs = [{ args: { amount0: 2_000_000_000n, amount1: -2_000_000_000n } }];
  const sell: any = await decide(obsAt(6), ctx);
  assert.equal(sell.type, "rawBundle"); assert.match(sell.reason, /exit/);
  logs = [];
  const hold: any = await decide(obsAt(65), ctx);
  assert.equal(hold.type, "rawBundle"); assert.ok(messages.some(x => /held/.test(x)));
  const endgame: any = await decide(obsAt(66, 12), ctx);
  assert.equal(endgame.type, "rawBundle"); assert.ok(messages.some(x => /blocks remain/.test(x)));
});
