// opus-1a = opus-1 with the launch module's USDC approval kept unlimited. The lib's swapBundle
// approves exactly the swapped amount, which zeroes the wallet's standing USDC approval after a
// launch entry; opus-1 then failed every later USDC->Uniswap swap of the epoch with STF.
process.env.ERIS_LOCAL_DEPLOY = "1";

import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { TOKENS, UNISWAP } from "@eris/sdk/constants.js";
import { swapBundle } from "../example/agents/lib/launchSwap.js";

const a = await import("../example/agents/opus-1a/agent.js");
const MAX = (1n << 256n) - 1n;
const TOKEN = "0x00000000000000000000000000000000000000aa" as Address;
const ME = "0x00000000000000000000000000000000000000bb" as Address;

const args = (tokenIn: Address, tokenOut: Address) => ({
  tokenIn,
  tokenOut,
  fee: 3000,
  recipient: ME,
  amountIn: 1_500_000_000n,
  minOut: 1n,
  reason: "launch",
  maxPriorityFeePerGasWei: "100000000",
});

function approval(bundle: Record<string, unknown>): { to: string; spender: string; amount: bigint } {
  const tx = (bundle.txs as { to: Address; data: Hex }[])[0];
  const d = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  assert.equal(d.functionName, "approve");
  const [spender, amount] = d.args as [Address, bigint];
  return { to: tx.to.toLowerCase(), spender: spender.toLowerCase(), amount };
}

test("a USDC launch entry approves the router in full, so the standing approval survives", () => {
  const b = a.launchSwapBundle(args(TOKENS.USDC.address, TOKEN));
  const ap = approval(b);
  assert.equal(ap.to, TOKENS.USDC.address.toLowerCase());
  assert.equal(ap.spender, UNISWAP.swapRouter.toLowerCase());
  assert.equal(ap.amount, MAX);
  // The lib's own bundle is what opus-1 sent: an exact approval that the swap uses up.
  assert.equal(approval(swapBundle(args(TOKENS.USDC.address, TOKEN))).amount, 1_500_000_000n);
});

test("a launch-token exit keeps the lib's exact approval; the rest of the bundle is unchanged", () => {
  const exit = args(TOKEN, TOKENS.USDC.address);
  assert.deepEqual(a.launchSwapBundle(exit), swapBundle(exit));
  const entry = args(TOKENS.USDC.address, TOKEN);
  const ours = a.launchSwapBundle(entry);
  const lib = swapBundle(entry);
  assert.deepEqual((ours.txs as unknown[])[1], (lib.txs as unknown[])[1]);
  assert.equal(ours.type, lib.type);
  assert.equal(ours.maxPriorityFeePerGasWei, lib.maxPriorityFeePerGasWei);
});
