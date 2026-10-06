/**
 * Copied from NyxFoundation/eris-agent-simulator example/agents/launch-confirm (MIT license).
 * launch-confirm: waits for the tape to confirm demand before buying a new listing (issue #29).
 *
 * The judgment side of the `launch` regime. The only evidence that a wave is coming is the first
 * blocks of its ramp -- net USDC flowing *into* the pool, block after block. This strategy reads
 * the pool's Swap logs, enters only after `ERIS_LAUNCH_CONFIRM_BLOCKS` consecutive blocks of net
 * buying above a floor, sizes against the pool's USDC reserve rather than against its own stack,
 * and exits on the first block of net selling, on a maximum hold, or when the run is about to end.
 *
 * It forgoes the first part of every move (the confirmation lag is the price of not buying duds)
 * and it can be shaken out by one noisy block. Both are the trade-off the regime is about.
 *
 * Everything about the token is read from the chain through `ctx.publicClient`; see
 * lib/launchSwap.ts for the reads and the two transactions.
 */
import type { Address } from "viem";
import type { AgentAction, AgentContext, AgentObservation } from "@eris/sdk";
import { TOKENS } from "@eris/sdk/constants.js";
import {
  applySlippage,
  bpsOf,
  launchPoolState,
  launchPools,
  launchTokenCodehash,
  poolFee,
  poolFlow,
  quoteLaunch,
  swapBundle,
  tokenBalance,
  type LaunchPool,
} from "./launchSwap.js";

// Consecutive blocks of net buying before the strategy believes a wave is real.
const CONFIRM_BLOCKS = 3;
// A block counts as net buying only if the net USDC into the pool is at least this fraction of
// the pool's USDC reserve. Below it the tape is noise, not a ramp.
const MIN_FLOW_BPS = 25;
// Fraction of the USDC balance committed per launch, in bps ...
const SIZE_BPS = 2000;
// ... capped at this fraction of the pool's USDC reserve, so a $20k pool is not hit with a $5k
// order that moves it 25% against itself.
const MAX_RESERVE_BPS = 1000;
// Sell on the first block whose net flow is out of the pool by at least this much of the reserve.
const EXIT_FLOW_BPS = 10;
// Sell anyway after this many blocks, and when this many remain.
const MAX_HOLD_BLOCKS = 60;
// 0 turns the end-of-run guard off (see launch-sniper for why that has to be possible).
const EXIT_BEFORE_END_BLOCKS = 12;
// The wave moves a thin pool several percent per block and the swap lands the block after the
// quote; 3% lost the entry on the first measured run.
const SLIPPAGE_BPS = 1000;
const MIN_USDC_UNITS = 1_000_000n;
const RPC_TIMEOUT_MS = 1_200, DECIDE_BUDGET_MS = 4_000, PENDING_BLOCKS = 5, FORCE_EXIT_BLOCKS = 3;

type Watch = {
  pool: LaunchPool;
  fee: number;
  // The last block whose Swap logs were read.
  readThrough: number;
  buyStreak: number;
  entered?: { block: number; exiting: boolean; done: boolean };
};

const watches = new Map<string, Watch>();
let shapeOnlyNoted = false;
let lastBlock: number | undefined;
export function resetLaunchState(): void { watches.clear(); lastBlock = undefined; }
function timed<T>(work: Promise<T>, deadline: number): Promise<T> {
  const ms = Math.max(1, Math.min(RPC_TIMEOUT_MS, deadline - Date.now()));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("launch RPC timeout")), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Keep base arbitrage from consuming the USDC needed to manage an open launch position. */
export async function decide(
  obs: AgentObservation,
  ctx: AgentContext,
): Promise<AgentAction | Record<string, unknown>> {
  const block = Number(obs.blockNumber);
  const deadline = Date.now() + DECIDE_BUDGET_MS;
  if (Number.isSafeInteger(block) && lastBlock !== undefined && (block <= lastBlock || block > lastBlock + 1)) watches.clear();
  if (Number.isSafeInteger(block)) lastBlock = block;
  const fee = obs.limits.defaultPriorityFeePerGasWei;
  const self = ctx.address as Address;
  const remaining =
    EXIT_BEFORE_END_BLOCKS > 0
      ? (obs.blocksRemaining ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;

  // ---- register every launch pool the registry shows ----
  // Match upstream launch-confirm, including its explicit shape-only fallback.
  // Time out the call itself so the shared helper can clear its failed cache and retry.
  const hashClient = { ...ctx.publicClient,
    call: (args: Parameters<typeof ctx.publicClient.call>[0]) => timed(ctx.publicClient.call(args), deadline),
  } as typeof ctx.publicClient;
  const tokenCodehash = await launchTokenCodehash(hashClient);
  if (tokenCodehash === null && !shapeOnlyNoted) {
    shapeOnlyNoted = true;
    ctx.log({ round: obs.round, reason: "AgentERC20 artifact or node unavailable: launch pools are matched by listing shape only" });
  }
  for (const pool of launchPools(obs, { tokenCodehash })) {
    if (pool.mine) continue;
    const key = pool.pool.toLowerCase();
    if (watches.has(key)) continue;
    try { watches.set(key, {
      pool,
      fee: await timed(poolFee(ctx.publicClient, pool.pool), deadline),
      // Start reading from the block after registration: the listing's own seed is not demand.
      readThrough: Math.max(pool.registeredAtBlock, block - 1),
      buyStreak: 0,
    }); } catch { /* one unavailable pool must not suppress other decisions */ }
  }

  // ---- read the tape since the last look, one pool at a time ----
  let exitAction: Record<string, unknown> | null = null, entryAction: Record<string, unknown> | null = null;
  const notes: string[] = [];
  for (const w of watches.values()) {
    try {
    if (w.entered?.done) continue;
    const state = await timed(launchPoolState(ctx.publicClient, w.pool), deadline);
    const reserve = state.usdcReserveUnits;
    const flow = await timed(poolFlow(
      ctx.publicClient,
      w.pool,
      w.readThrough + 1,
      block,
    ), deadline);
    w.readThrough = block;
    const net = flow.usdcInUnits - flow.usdcOutUnits;
    const netBps = reserve > 0n ? Number((net * 10_000n) / reserve) : 0;
    if (net > 0n && netBps >= MIN_FLOW_BPS) w.buyStreak++;
    else if (net < 0n) w.buyStreak = 0;
    notes.push(
      `${w.pool.pool.slice(0, 8)} net ${netBps}bps streak ${w.buyStreak}`,
    );
    if (w.entered) {
      // ---- exit? ----
      const held = await timed(tokenBalance(ctx.publicClient, w.pool.token, self), deadline);
      if (held === 0n) {
        if (w.entered.exiting || block - w.entered.block >= PENDING_BLOCKS) w.entered = undefined;
        continue;
      }
      const sellSignal = net < 0n && -netBps >= EXIT_FLOW_BPS;
      const due =
        sellSignal ||
        block - w.entered.block >= MAX_HOLD_BLOCKS ||
        remaining <= EXIT_BEFORE_END_BLOCKS;
      if (!due) continue;
      let quoted: bigint;
      try {
        quoted = await timed(quoteLaunch(ctx.publicClient, {
          tokenIn: w.pool.token,
          tokenOut: TOKENS.USDC.address,
          fee: w.fee,
          amountIn: held,
        }), deadline);
      } catch (error) {
        if (remaining <= FORCE_EXIT_BLOCKS) {
          w.entered.exiting = true;
          exitAction ??= await timed(swapBundle(ctx.publicClient, { tokenIn: w.pool.token, tokenOut: TOKENS.USDC.address, fee: w.fee,
            recipient: self, amountIn: held, minOut: 1n, reason: "launch-confirm forced exit", maxPriorityFeePerGasWei: fee }), deadline);
        }
        notes.push(`sell quote failed: ${String(error).split("\n")[0]}`);
        continue;
      }
      if (quoted < MIN_USDC_UNITS) {
        w.entered.done = true;
        continue;
      }
      w.entered.exiting = true;
      ctx.log({
        round: obs.round,
        reason: `selling ${held} tokens on ${w.pool.pool}: ${
          sellSignal
            ? `net selling ${-netBps}bps of reserve`
            : remaining <= EXIT_BEFORE_END_BLOCKS
              ? `${remaining} blocks remain`
              : `held ${block - w.entered.block} blocks`
        }`,
        signals: { quotedUsdcUnits: Number(quoted), netFlowBps: netBps },
      });
      exitAction ??= await timed(swapBundle(ctx.publicClient, {
        tokenIn: w.pool.token,
        tokenOut: TOKENS.USDC.address,
        fee: w.fee,
        recipient: self,
        amountIn: held,
        minOut: applySlippage(quoted, SLIPPAGE_BPS),
        reason: "launch-confirm exit",
        maxPriorityFeePerGasWei: fee,
      }), deadline);
      continue;
    }

    // ---- enter? ----
    if (w.buyStreak < CONFIRM_BLOCKS || remaining <= EXIT_BEFORE_END_BLOCKS)
      continue;
    const usdc = BigInt(obs.balances.usdcUnits);
    const amountIn = min(
      bpsOf(usdc, SIZE_BPS),
      bpsOf(reserve, MAX_RESERVE_BPS),
    );
    if (amountIn < MIN_USDC_UNITS) continue;
    let quoted: bigint;
    try {
      quoted = await timed(quoteLaunch(ctx.publicClient, {
        tokenIn: TOKENS.USDC.address,
        tokenOut: w.pool.token,
        fee: w.fee,
        amountIn,
      }), deadline);
    } catch (error) {
      notes.push(`buy quote failed: ${String(error).split("\n")[0]}`);
      continue;
    }
    ctx.log({
      round: obs.round,
      reason: `buying ${amountIn} USDC units of ${w.pool.token}: ${w.buyStreak} blocks of net buying, last ${netBps}bps of a ${reserve} USDC-unit reserve, price ${state.priceUsdcPerToken.toFixed(4)}`,
      signals: {
        amountInUsdcUnits: Number(amountIn),
        quotedTokens: Number(quoted),
        buyStreak: w.buyStreak,
        priceUsdcPerToken: state.priceUsdcPerToken,
      },
    });
    entryAction ??= await timed(swapBundle(ctx.publicClient, {
      tokenIn: TOKENS.USDC.address,
      tokenOut: w.pool.token,
      fee: w.fee,
      recipient: self,
      amountIn,
      minOut: applySlippage(quoted, SLIPPAGE_BPS),
      reason: "launch-confirm entry",
      maxPriorityFeePerGasWei: fee,
    }), deadline);
    if (entryAction?.type === "rawBundle") w.entered = { block, exiting: false, done: false };
    } catch (error) { notes.push(`pool read failed: ${String(error).split("\n")[0]}`); }
  }

  if (exitAction) return exitAction;
  if (entryAction) return entryAction;
  ctx.log({
    round: obs.round,
    reason:
      watches.size === 0
        ? "no launch pool on the registry yet"
        : `watching ${watches.size} pool(s): ${notes.join("; ")}`,
    signals: {
      launchPools: watches.size,
      blocksRemaining: Number.isFinite(remaining) ? remaining : -1,
    },
  });
  return { type: "noop", reason: "no confirmed demand" };
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
