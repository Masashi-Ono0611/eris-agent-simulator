// Candidate-local allowance repair; reads/encoding remain the MIT upstream helpers.
import type { PublicClient, Address } from "viem";
import { erc20Abi } from "@eris/sdk/abis.js";
import { TOKENS, UNISWAP } from "@eris/sdk/constants.js";
import { approveTx, exactInputSingleTx } from "../lib/launchSwap.js";
export { applySlippage, bpsOf, launchPoolState, launchPools, launchTokenCodehash,
  poolFee, poolFlow, quoteLaunch, tokenBalance, type LaunchPool } from "../lib/launchSwap.js";

export async function swapBundle(client: PublicClient, args: Parameters<typeof exactInputSingleTx>[0] & {
  reason: string; maxPriorityFeePerGasWei: string;
}): Promise<Record<string, unknown>> {
  const allowance = await client.readContract({ address: args.tokenIn, abi: erc20Abi,
    functionName: "allowance", args: [args.recipient, UNISWAP.swapRouter] }) as bigint;
  // Never shrink the normal USDC router allowance. A missing approval is a separate
  // action: only a later confirmed allowance observation permits the swap.
  if (allowance < args.amountIn) return { type: "rawTx",
    tx: approveTx(args.tokenIn, UNISWAP.swapRouter,
      args.tokenIn.toLowerCase() === TOKENS.USDC.address.toLowerCase() ? (1n << 256n) - 1n : args.amountIn),
    reason: `${args.reason}: awaiting allowance`, maxPriorityFeePerGasWei: args.maxPriorityFeePerGasWei };
  return { type: "rawBundle", txs: [exactInputSingleTx(args)],
    reason: args.reason, maxPriorityFeePerGasWei: args.maxPriorityFeePerGasWei };
}
