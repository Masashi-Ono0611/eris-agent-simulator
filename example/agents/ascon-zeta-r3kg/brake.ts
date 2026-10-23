// r3k K2: own-outcome brake for two-leg bundles.
//
// A bundle is two separate transactions, so in a contested field one leg can fill while the other
// reverts or is never mined, leaving inventory on one side. This module keeps the outcome of our
// last K2_WINDOW settled bundles and, when too many ended one-sided, pauses small-edge bundles for
// K2_PAUSE_BLOCKS blocks. The switch (K2_BUNDLE_BRAKE) and the use of k2Braked() live in delta.ts.
//
// Settlement is read in the background, never awaited by decide(). Match the SDK adapter's
// destination and ABI-decoded selector/token/amount, then read receipts with a local deadline.
// Commit evidence and the cursor together per block; a failed read contributes no outcome.
import type { AgentContext, AgentObservation } from "@eris/sdk";
import { BALANCER, UNISWAP } from "@eris/sdk/constants.js";
import { marketFor, tokenInfo } from "@eris/sdk/markets.js";
import { balancerVaultAbi, curveTricryptoAbi, swapRouterAbi } from "@eris/sdk/abis.js";
import { decodeFunctionData, toFunctionSelector, type Hex } from "viem";

export const K2_WINDOW = 20; // settled own bundles kept
export const K2_MIN_SETTLED = 8; // the brake needs at least this many settled bundles in the window
export const K2_ONE_SIDED_PCT = 40; // ... and at least this share of them one-sided (exactly one leg filled)
export const K2_PAUSE_BLOCKS = 36; // blocks paused after a trigger; bundles resume after them
export const K2_BRAKE_BELOW_NET_EDGE_BPS = 100; // only bundles below this net edge (delta.ts netEdge) are braked
export const K2_SETTLE_AFTER_BLOCKS = 10; // wait for late legs through the tenth scanned block
export const K2_DROP_AFTER_BLOCKS = 20; // unread for this long: dropped, not counted
const K2_MAX_BLOCKS_PER_SCAN = 8;

const K2_RPC_TIMEOUT_MS = 2_000;
const K2_RECEIPT_CONCURRENCY = 4;

type Leg = {
  action: "swap" | "balancerSwap" | "curveSwap";
  to: string; selector: string; token: string; tokenOut: string; amount: bigint;
  fee?: number; poolId?: string; inputIndex?: number; outputIndex?: number;
  filled?: boolean;
};
type Pending = { block: number; legs: Leg[] };
type State = {
  lastBlock?: number;
  pending: Pending[];
  window: boolean[]; // true = one-sided
  brakeAt?: number; // block at which the brake triggered
  scannedThrough?: number;
  scan?: Promise<void>;
};
type Reader = AgentContext["publicClient"];

// Keep transport slots across epoch resets: a timed-out request may still be running.
let receiptsInFlight = 0;
let s: State = { pending: [], window: [] };

/** Reset everything: called on an epoch start (block discontinuity) and by tests. */
export function k2Reset(): void { s = { pending: [], window: [] }; }

/** True while small-edge bundles are paused: the K2_PAUSE_BLOCKS blocks after the trigger block. */
export function k2Braked(block: number): boolean {
  return s.brakeAt !== undefined && block > s.brakeAt && block <= s.brakeAt + K2_PAUSE_BLOCKS;
}

/** Remember a bundle returned at `block`, so its legs can be settled later. Synchronous. */
export function k2RecordBundle(block: number, action: unknown): void {
  try {
    const a = action as { type?: string; actions?: { type?: string; base?: string; tokenIn?: string; amountIn?: string }[] } | null;
    if (!Number.isSafeInteger(block) || a?.type !== "bundle" || !Array.isArray(a.actions) || a.actions.length !== 2) return;
    // Capture the same market metadata the SDK bundle adapters use, at decision time.
    const legs: Leg[] = a.actions.map(leg => {
      const amount = BigInt(leg.amountIn ?? "0");
      if (amount <= 0n) throw new Error("invalid amount");
      const base = leg.base ?? "WETH";
      if (leg.tokenIn !== base && leg.tokenIn !== "USDC") throw new Error("invalid token");
      const buying = leg.tokenIn === "USDC";
      const baseToken = tokenInfo(base).address.toLowerCase();
      if (leg.type === "swap") {
        const market = marketFor("uniswap", base)?.uniswap;
        if (!market) throw new Error("unknown market");
        const quote = tokenInfo("USDC").address.toLowerCase();
        return { action: leg.type, to: UNISWAP.swapRouter.toLowerCase(),
          selector: toFunctionSelector("exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))"),
          token: buying ? quote : baseToken, tokenOut: buying ? baseToken : quote, amount, fee: market.fee };
      }
      if (leg.type === "balancerSwap") {
        const market = marketFor("balancer", base)?.balancer;
        if (!market) throw new Error("unknown market");
        const quote = market.stable.toLowerCase();
        return { action: leg.type, to: BALANCER.vault.toLowerCase(),
          selector: toFunctionSelector("swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)"),
          token: buying ? quote : baseToken, tokenOut: buying ? baseToken : quote, amount, poolId: market.poolId.toLowerCase() };
      }
      if (leg.type === "curveSwap") {
        const market = marketFor("curve", base)?.curve;
        if (!market) throw new Error("unknown market");
        const quote = market.stable.toLowerCase();
        return { action: leg.type, to: market.pool.toLowerCase(),
          selector: toFunctionSelector("exchange(uint256,uint256,uint256,uint256)"),
          token: buying ? quote : baseToken, tokenOut: buying ? baseToken : quote, amount,
          inputIndex: buying ? market.quoteIndex : market.baseIndex,
          outputIndex: buying ? market.baseIndex : market.quoteIndex };
      }
      throw new Error("unsupported action");
    });
    if (s.pending.length === 0) s.scannedThrough = block;
    s.pending.push({ block, legs });
  } catch { /* an unreadable action is simply not tracked */ }
}

/** Called once per observation, before the decision. Starts a background scan; never awaits it. */
export function k2Observe(obs: AgentObservation, ctx: AgentContext | undefined): void {
  try {
    const block = Number(obs.blockNumber);
    if (!Number.isSafeInteger(block)) return;
    if (s.lastBlock !== undefined && (block < s.lastBlock || block > s.lastBlock + 1)) k2Reset();
    s.lastBlock = block;
    s.pending = s.pending.filter(p => block - p.block <= K2_DROP_AFTER_BLOCKS);
    if (s.pending.length === 0) { s.scannedThrough = undefined; return; }
    const client = ctx?.publicClient;
    const me = String(obs.agentAddress ?? ctx?.address ?? "").toLowerCase();
    if (s.scan || !client || !me) return;
    const state = s;
    state.scan = scan(state, client, me, block)
      .catch(() => { /* retried from the same block at the next observation */ })
      .finally(() => { state.scan = undefined; });
  } catch { /* the brake must never affect a decision through an exception */ }
}

/** Test/diagnostic view: resolves when no scan is running. */
export async function k2Idle(): Promise<void> { while (s.scan) await s.scan; }
export function k2Snapshot(): { pending: number; window: boolean[]; brakeAt?: number; scannedThrough?: number; scanning: boolean } {
  return { pending: s.pending.length, window: [...s.window], brakeAt: s.brakeAt, scannedThrough: s.scannedThrough, scanning: !!s.scan };
}

function matches(leg: Leg, input: Hex): boolean {
  if (input.slice(0, 10) !== leg.selector) return false;
  try {
    // ABI decoding reads amountIn at its actual argument position, including Balancer's
    // dynamic singleSwap tuple. Other amount-shaped words (limits/deadlines) cannot match.
    if (leg.action === "swap") {
      const call = decodeFunctionData({ abi: swapRouterAbi, data: input });
      if (call.functionName !== "exactInputSingle") return false;
      const [p] = call.args;
      return p.amountIn === leg.amount && p.tokenIn.toLowerCase() === leg.token
        && p.tokenOut.toLowerCase() === leg.tokenOut && p.fee === leg.fee;
    }
    if (leg.action === "balancerSwap") {
      const call = decodeFunctionData({ abi: balancerVaultAbi, data: input });
      if (call.functionName !== "swap") return false;
      const [p] = call.args;
      return p.kind === 0 && p.amount === leg.amount && p.assetIn.toLowerCase() === leg.token
        && p.assetOut.toLowerCase() === leg.tokenOut && p.poolId.toLowerCase() === leg.poolId;
    }
    const call = decodeFunctionData({ abi: curveTricryptoAbi, data: input });
    if (call.functionName !== "exchange") return false;
    const [i, j, amount] = call.args;
    return i === BigInt(leg.inputIndex!) && j === BigInt(leg.outputIndex!) && amount === leg.amount;
  } catch { return false; }
}

function findLeg(state: State, block: number, me: string,
  tx: { from: string; to: string | null; input: string }, reserved: Set<Leg>): Leg | undefined {
  if (tx.from.toLowerCase() !== me) return undefined;
  // Pending entries are recorded chronologically. Reserve before any receipt await so a tx
  // can claim only the oldest unmatched leg, even when several bundles reuse an amount.
  for (const p of state.pending) {
    if (block <= p.block || block > p.block + K2_SETTLE_AFTER_BLOCKS) continue;
    for (const leg of p.legs) {
      if (leg.filled === undefined && !reserved.has(leg) && tx.to?.toLowerCase() === leg.to
        && matches(leg, tx.input.toLowerCase() as Hex)) return leg;
    }
  }
  return undefined;
}

async function rpc<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("K2 RPC timeout")), K2_RPC_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function scan(state: State, client: Reader, me: string, to: number): Promise<void> {
  const from = (state.scannedThrough ?? to) + 1;
  const last = Math.min(to, from + K2_MAX_BLOCKS_PER_SCAN - 1);
  for (let b = from; b <= last; b++) {
    const block = await rpc(() => client.getBlock({ blockNumber: BigInt(b), includeTransactions: true }));
    if (s !== state) return; // a new epoch started while reading
    const reserved = new Set<Leg>(), hashes = new Set<string>();
    const jobs: { leg: Leg; hash: Hex; filled?: boolean }[] = [];
    for (const tx of block.transactions) {
      if (typeof tx === "string" || hashes.has(tx.hash)) continue;
      hashes.add(tx.hash);
      const leg = findLeg(state, b, me, tx, reserved);
      if (!leg) continue;
      reserved.add(leg);
      jobs.push({ leg, hash: tx.hash });
    }
    for (let i = 0; i < jobs.length; i += K2_RECEIPT_CONCURRENCY) {
      const reads = await Promise.allSettled(jobs.slice(i, i + K2_RECEIPT_CONCURRENCY).map(async job => {
        const r = await rpc(async () => {
          // Timed-out requests may still be in flight at the transport. Keep their slots
          // until they finish, including across retries, rather than exceeding the cap.
          if (receiptsInFlight >= K2_RECEIPT_CONCURRENCY) throw new Error("K2 receipts busy");
          receiptsInFlight++;
          try { return await client.getTransactionReceipt({ hash: job.hash }); }
          finally { receiptsInFlight--; }
        });
        if (r.status !== "success" && r.status !== "reverted") throw new Error("K2 receipt has no outcome");
        job.filled = r.status === "success";
      }));
      const failed = reads.find(r => r.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (s !== state) return;
    }
    if (s !== state) return;
    // No partial claims survive errors/timeouts, so a retry cannot attribute the same tx twice.
    for (const job of jobs) job.leg.filled = job.filled;
    state.scannedThrough = b;
    settle(state);
  }
}

function settle(state: State): void {
  for (const p of [...state.pending]) {
    const done = p.legs.every(l => l.filled !== undefined);
    const expired = state.scannedThrough !== undefined && state.scannedThrough >= p.block + K2_SETTLE_AFTER_BLOCKS;
    if (!done && !expired) continue;
    state.pending.splice(state.pending.indexOf(p), 1);
    if (p.legs.every(l => l.filled === undefined)) continue; // no observed legs: no outcome
    state.window.push(p.legs.filter(l => l.filled === true).length === 1);
    if (state.window.length > K2_WINDOW) state.window.shift();
    const oneSided = state.window.filter(Boolean).length;
    if (state.window.length >= K2_MIN_SETTLED && oneSided * 100 >= K2_ONE_SIDED_PCT * state.window.length) {
      state.brakeAt = state.lastBlock ?? p.block;
      // A fresh window after each trigger, so bundles resume when the pause ends instead of the
      // same outcomes re-triggering it; a new trigger needs K2_MIN_SETTLED new settlements.
      state.window = [];
    }
  }
}
