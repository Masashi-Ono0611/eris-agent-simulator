/**
 * Copied from NyxFoundation/eris-agent-simulator example/agents/launch-confirm (MIT license).
 * launch-confirm: waits for the tape to confirm demand before buying a new listing (issue #29).
 *
 * The judgment side of the `launch` regime. The only evidence that a wave is coming is the first
 * blocks of its ramp -- net USDC flowing *into* the pool, block after block. This strategy reads
 * the pool's Swap logs, enters only after `CONFIRM_BLOCKS` consecutive blocks of net
 * buying above a floor, sizes against the pool's USDC reserve rather than against its own stack,
 * and exits on the first block of net selling, on a maximum hold, or when the run is about to end.
 *
 * It forgoes the first part of every move (the confirmation lag is the price of not buying duds)
 * and it can be shaken out by one noisy block. Both are the trade-off the regime is about.
 *
 * Everything about the token is read from the chain through `ctx.publicClient`; see
 * lib/launchSwap.ts for the reads and the two transactions.
 */
import type { Address, Hex } from "viem";
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
} from "../lib/launchSwap.js";

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
const FORCE_EXIT_BLOCKS = 3;
// The wave moves a thin pool several percent per block and the swap lands the block after the
// quote; 3% lost the entry on the first measured run.
const SLIPPAGE_BPS = 1000;
const MIN_USDC_UNITS = 1_000_000n;
const RPC_TIMEOUT_MS = 1_200, DECIDE_BUDGET_MS = 4_000, PENDING_BLOCKS = 5;
const MAX_PENDING_READS = 4;
const IDLE_BLOCKS = 30, MAX_WATCHES = 32, MAX_GAP_SCAN_BLOCKS = 16;
// Cool down retired listings so an unchanged registry cannot immediately re-add
// them. Bound this bookkeeping too; evicted cooldowns may be rediscovered later.
const retired = new Map<string, number>();

type Watch = {
  pool: LaunchPool;
  fee: number;
  readThrough: number;
  buyStreak: number;
  lastActivity: number;
  state?: { reserve: bigint; price: number; liquidity: bigint };
  entered?: { block: number; exiting: boolean; reconcile?: boolean; exitAfterBlock?: number };
};
const watches = new Map<string, Watch>();
let shapeOnlyNoted = false;
let lastBlock: number | undefined;
// PublicClient does not expose per-call cancellation here. Expired requests are
// stale, not active slots; the underlying transport may still have work in flight.
// Optional reads use at most three slots, reserving one for holdings/exit quotes.
const pendingByClient = new WeakMap<object, Map<string, { expires: number }>>();
// Explicit lifecycle reset for isolated offline tests (test/zeta-2.test.ts).
// Never call this on a runtime tape gap: that would discard tracked holdings.
export function resetLaunchState(): void { watches.clear(); retired.clear(); lastBlock = undefined; }
export function hasLaunchPositions(): boolean { return [...watches.values()].some(w => !!w.entered); }
function timed<T>(client: object, key: string, work: () => Promise<T>, deadline: number, priority = false): Promise<T> {
  const ms = Math.min(RPC_TIMEOUT_MS, deadline - Date.now());
  let pending = pendingByClient.get(client);
  if (!pending) { pending = new Map(); pendingByClient.set(client, pending); }
  for (const [oldKey, old] of pending) if (old.expires <= Date.now()) pending.delete(oldKey);
  if (ms <= 0 || pending.has(key) || pending.size >= MAX_PENDING_READS - (priority ? 0 : 1))
    return Promise.reject(new Error("launch RPC budget exhausted or request still pending"));
  const request = { expires: Date.now() + ms };
  pending.set(key, request);
  return new Promise<T>((resolve, reject) => {
    const release = () => { if (pending!.get(key) === request) pending!.delete(key); };
    const timer = setTimeout(() => { release(); reject(new Error("launch RPC timeout")); }, ms);
    const finish = () => { clearTimeout(timer); release(); };
    try { work().then(value => { finish(); resolve(value); }, error => { finish(); reject(error); }); }
    catch (error) { finish(); reject(error); }
  });
}

export async function decide(obs: AgentObservation, ctx: AgentContext): Promise<AgentAction | Record<string, unknown>> {
  const block = Number(obs.blockNumber), deadline = Date.now() + DECIDE_BUDGET_MS;
  if (!Number.isSafeInteger(block)) return { type: "noop", reason: "invalid block" };
  if (lastBlock !== undefined && (block < lastBlock || block > lastBlock + 1)) {
    // A discontinuous tape is not consecutive entry confirmation. Holdings keep
    // their cursor on forward gaps so missed selling can be inspected below.
    for (const w of watches.values()) {
      w.buyStreak = 0;
      if (!w.entered || block < lastBlock) w.readThrough = block - 1;
      if (block < lastBlock) w.lastActivity = block;
      if (block < lastBlock && w.entered) {
        w.entered.block = block;
        // Keep this flag until a successful balance read, even if this RPC fails.
        w.entered.reconcile = true;
        w.entered.exitAfterBlock = undefined;
      }
    }
    if (block < lastBlock) retired.clear();
  }
  lastBlock = block;
  const fee = obs.limits.defaultPriorityFeePerGasWei, self = ctx.address as Address;
  const remaining = EXIT_BEFORE_END_BLOCKS > 0 ? obs.blocksRemaining ?? Infinity : Infinity;
  const rawClient = ctx.publicClient;
  // Limit individual RPCs, including all three reads inside launchPoolState.
  // Promise.all rejection does not release unfinished siblings before expiry.
  const keyFor = (method: string, args: unknown) => `${method}:${JSON.stringify(args, (_, value) => typeof value === "bigint" ? value.toString() : value)}`;
  const wrapClient = (priority: boolean) => ({
    ...rawClient,
    call: (args: Parameters<typeof rawClient.call>[0]) => timed(rawClient, keyFor("call", args), () => rawClient.call(args), deadline, priority),
    readContract: (args: Parameters<typeof rawClient.readContract>[0]) => timed(rawClient, keyFor("read", args), () => rawClient.readContract(args), deadline, priority),
    getLogs: (args: Parameters<typeof rawClient.getLogs>[0]) => timed(rawClient, keyFor("logs", args), () => rawClient.getLogs(args), deadline, priority),
    simulateContract: (args: Parameters<typeof rawClient.simulateContract>[0]) => timed(rawClient, keyFor("quote", args), () => rawClient.simulateContract(args), deadline, priority),
  // Preserve viem's generic call signatures; each wrapper passes arguments/results through.
  } as unknown as typeof rawClient);
  const client = wrapClient(false), exitClient = wrapClient(true);
  const notes: string[] = [];
  let entry: { watch: Watch; action: Record<string, unknown>; amountIn: bigint; quoted: bigint; price: number } | undefined;
  const read = <T>(work: () => Promise<T>): Promise<T> => Date.now() >= deadline
    ? Promise.reject(new Error("launch decision deadline")) : work();

  const processWatch = async (w: Watch): Promise<Record<string, unknown> | null> => {
    try {
      if (!w.entered && block - w.lastActivity >= IDLE_BLOCKS) {
        // Unknown balances fail closed; only a confirmed zero may be retired.
        const balance = await read(() => tokenBalance(client, w.pool.token, self));
        if (balance === 0n) {
          const key = w.pool.pool.toLowerCase();
          watches.delete(key); retired.set(key, block + IDLE_BLOCKS);
          if (retired.size > MAX_WATCHES * 4) retired.delete(retired.keys().next().value!);
          return null;
        }
        // A delayed fill must be retained and routed through protected exits.
        w.entered = { block, exiting: false, exitAfterBlock: block + 1 };
      }
      let held = 0n;
      if (w.entered) {
        // Holdings and mandatory exits do not depend on pool state or tape reads.
        const heldRead = await read(() => tokenBalance(exitClient, w.pool.token, self));
        if (heldRead === undefined) return null; // gas-capped read failed (upstream issue #213)
        held = heldRead;
        if (held === 0n) {
          if (w.entered.reconcile || w.entered.exiting || block - w.entered.block >= PENDING_BLOCKS) w.entered = undefined;
          return null;
        }
        w.entered.reconcile = false;
      }
      const mandatory = !!w.entered && (block - w.entered.block >= MAX_HOLD_BLOCKS || remaining <= EXIT_BEFORE_END_BLOCKS
        || (w.entered.exitAfterBlock !== undefined && block >= w.entered.exitAfterBlock));
      const gap = !!w.entered && block > w.readThrough + 1;
      if (!mandatory && gap && block - w.readThrough > MAX_GAP_SCAN_BLOCKS) {
        w.entered!.exitAfterBlock = block + 1;
        return null; // No unbounded historical query; retry a protected exit next block.
      }
      let reserve = 0n, netBps = 0, net = 0n, price = 0;
      if (!mandatory && block > w.readThrough) {
        const state = await read(() => launchPoolState(client, w.pool));
        reserve = state.usdcReserveUnits; price = state.priceUsdcPerToken;
        const flow = await read(() => poolFlow(client, w.pool, gap ? w.readThrough + 1 : block, block));
        if (flow.usdcInUnits > 0n || flow.usdcOutUnits > 0n || (w.state &&
          (w.state.reserve !== reserve || w.state.price !== price || w.state.liquidity !== state.liquidity))) w.lastActivity = block;
        w.state = { reserve, price, liquidity: state.liquidity };
        // Failed/missed reads also interrupt the streak.
        if (w.readThrough !== block - 1) w.buyStreak = 0;
        w.readThrough = block;
        // Across missing blocks, later buys must not hide an earlier exit signal.
        // Any sell is conservative gap evidence: the historical reserve needed
        // to disprove a threshold breach is unknown. One bounded logs RPC.
        net = gap ? -flow.usdcOutUnits : flow.usdcInUnits - flow.usdcOutUnits;
        netBps = reserve > 0n ? Number(net * 10_000n / reserve) : 0;
        w.buyStreak = !gap && net > 0n && netBps >= MIN_FLOW_BPS ? w.buyStreak + 1 : 0;
        if (gap && net < 0n) w.entered!.exitAfterBlock = block;
        notes.push(`${w.pool.pool.slice(0, 8)} net ${netBps}bps streak ${w.buyStreak}`);
      }
      if (w.entered) {
        if (!mandatory && !(net < 0n && (gap || -netBps >= EXIT_FLOW_BPS))) return null;
        let minOut = 1n, forced = false, quotedUsdc = 0n;
        try {
          const quoted = await read(() => quoteLaunch(exitClient, { tokenIn: w.pool.token, tokenOut: TOKENS.USDC.address, fee: w.fee, amountIn: held }));
          quotedUsdc = quoted;
          if (quoted < MIN_USDC_UNITS && !mandatory) return null;
          minOut = applySlippage(quoted, SLIPPAGE_BPS);
          if (minOut < 1n) {
            if (remaining > FORCE_EXIT_BLOCKS) return null;
            minOut = 1n;
          }
        } catch (error) {
          // Retry protected exits next block; only terminal zero valuation risk
          // justifies selling without a usable quote in the last three blocks.
          if (!mandatory || remaining > FORCE_EXIT_BLOCKS) throw error;
          forced = true;
        }
        w.entered.exiting = true;
        ctx.log({ round: obs.round, reason: `selling ${held} tokens on ${w.pool.pool}: ${
          mandatory ? remaining <= EXIT_BEFORE_END_BLOCKS ? `${remaining} blocks remain` : w.entered.exitAfterBlock !== undefined ? "unresolved tape gap or delayed fill" : `held ${block - w.entered.block} blocks` : `net selling ${-netBps}bps of reserve`}`,
          signals: { quotedUsdcUnits: Number(quotedUsdc), netFlowBps: netBps } });
        return swapBundle({ tokenIn: w.pool.token, tokenOut: TOKENS.USDC.address, fee: w.fee, recipient: self,
          amountIn: held, minOut, reason: forced ? "launch-confirm forced exit" : "launch-confirm exit", maxPriorityFeePerGasWei: fee });
      }
      if (selectedExit || entry || reserve <= 0n || w.buyStreak < CONFIRM_BLOCKS || remaining <= EXIT_BEFORE_END_BLOCKS) return null;
      const amountIn = min(bpsOf(BigInt(obs.balances.usdcUnits), SIZE_BPS), bpsOf(reserve, MAX_RESERVE_BPS));
      if (amountIn < MIN_USDC_UNITS) return null;
      const quoted = await read(() => quoteLaunch(client, { tokenIn: TOKENS.USDC.address, tokenOut: w.pool.token, fee: w.fee, amountIn }));
      entry = { watch: w, amountIn, quoted, price, action: swapBundle({ tokenIn: TOKENS.USDC.address, tokenOut: w.pool.token, fee: w.fee,
        recipient: self, amountIn, minOut: applySlippage(quoted, SLIPPAGE_BPS), reason: "launch-confirm entry", maxPriorityFeePerGasWei: fee }) };
    } catch (error) {
      if (w.entered && block > w.readThrough + 1) w.entered.exitAfterBlock ??= block + 1;
      w.buyStreak = 0;
      notes.push(`pool read failed: ${String(error).split("\n")[0]}`);
    }
    return null;
  };

  // Service existing holdings before optional discovery and entries consume budget.
  const existing = [...watches.values()];
  const idle = existing.filter(w => !w.entered);
  let selectedExit: Record<string, unknown> | null = null;
  for (const w of existing) {
    if (Date.now() >= deadline) break;
    if (!w.entered) continue;
    const exit = await processWatch(w);
    selectedExit ??= exit;
    if (selectedExit) break;
  }
  for (const [key, until] of retired) if (block >= until) retired.delete(key);
  // Fresh discoveries precede idle watches, after holdings have had first claim
  // on the existing four-second / four-pending-read budget.
  // Hash discovery is optional RPC work: holdings/exits above keep first claim
  // on the budget. Match upstream launch-confirm's logged shape-only fallback.
  let tokenCodehash: Hex | null = null;
  if (!selectedExit && Date.now() < deadline) {
    tokenCodehash = await launchTokenCodehash(client);
    if (tokenCodehash === null && !shapeOnlyNoted) {
      shapeOnlyNoted = true;
      ctx.log({ round: obs.round, reason: "AgentERC20 artifact or node unavailable: launch pools are matched by listing shape only" });
    }
  }
  for (const pool of launchPools(obs, { tokenCodehash })) {
    if (selectedExit || Date.now() >= deadline) break;
    const key = pool.pool.toLowerCase();
    if (pool.mine || watches.has(key) || retired.has(key)) continue;
    if (watches.size >= MAX_WATCHES) break;
    try {
      const poolFeeValue = await read(() => poolFee(client, pool.pool));
      const w: Watch = { pool, fee: poolFeeValue, readThrough: Math.max(pool.registeredAtBlock, block - 1), buyStreak: 0, lastActivity: block };
      watches.set(key, w);
      if (Date.now() < deadline) await processWatch(w);
    } catch { /* An unavailable listing cannot suppress other decisions. */ }
  }
  for (const w of idle) {
    if (Date.now() >= deadline) break;
    if (watches.has(w.pool.pool.toLowerCase())) {
      const exit = await processWatch(w);
      selectedExit ??= exit;
    }
  }
  if (selectedExit) return selectedExit;
  if (entry) {
    // Only this action will be submitted. Other candidates remain eligible.
    entry.watch.entered = { block, exiting: false };
    ctx.log({ round: obs.round, reason: `buying ${entry.amountIn} USDC units of ${entry.watch.pool.token}: ${entry.watch.buyStreak} blocks of net buying, price ${entry.price.toFixed(4)}`,
      signals: { amountInUsdcUnits: Number(entry.amountIn), quotedTokens: Number(entry.quoted), buyStreak: entry.watch.buyStreak, priceUsdcPerToken: entry.price } });
    return entry.action;
  }
  ctx.log({ round: obs.round, reason: `watching ${watches.size} pool(s): ${notes.join("; ")}`,
    signals: { launchPools: watches.size, blocksRemaining: Number.isFinite(remaining) ? remaining : -1 } });
  return { type: "noop", reason: "no confirmed demand" };
}
function min(a: bigint, b: bigint): bigint { return a < b ? a : b; }
