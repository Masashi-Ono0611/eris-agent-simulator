import type { AgentContext, AgentObservation } from "@eris/sdk";
import { TOKENS, UNISWAP } from "@eris/sdk/constants.js";
import { erc20Abi } from "@eris/sdk/abis.js";
import { keccak256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { launchPools, poolFee, launchPoolState, tokenBalance, quoteLaunch, swapBundle,
  applySlippage, type LaunchPool } from "../lib/launchSwap.js";
import { PARAMS as P } from "./params.js";

type Position = { pool: LaunchPool; fee: number; block: number; cost: bigint; peak: bigint; exiting: boolean; seen: boolean };
export function createLaunchState() {
  return { position: undefined as Position | undefined, spent: 0n, used: new Set<string>(),
    cursor: 0, pauseUntil: -1, inFlight: 0 };
}
export type LaunchState = ReturnType<typeof createLaunchState>;
const U = 10n ** 6n;
const extraAbi = parseAbi([
  "function factory() view returns (address)",
  "function getPool(address,address,uint24) view returns (address)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);
const min = (...xs: bigint[]) => xs.reduce((a, b) => a < b ? a : b);

/** Structural screening, NOT a proof of arbitrary ERC20 semantics. Accept only the plain
 * ERC20 selector surface, and reject calls, proxies, creation and time-dependent code.
 * A custom token can still hide conditional transfer accounting; the small risk cap remains.
 */
export function screenTokenCode(code: Hex | undefined): boolean {
  if (!code || code.length < 200 || code.length > 24000) return false;
  const bytes = code.slice(2).match(/../g)?.map(x => parseInt(x, 16)) ?? [];
  const metadata = bytes.length > 2 ? bytes.at(-2)! * 256 + bytes.at(-1)! : 0;
  // Solidity CBOR metadata starts with a map. Do not strip arbitrary trailing opcodes.
  const start = bytes.length - metadata - 2;
  const end = metadata > 0 && start > 0 && bytes[start] >= 0xa0 && bytes[start] <= 0xbf ? start : bytes.length;
  const allowed = new Set(["06fdde03", "95d89b41", "313ce567", "18160ddd", "70a08231", "dd62ed3e", "095ea7b3", "a9059cbb", "23b872dd"]);
  const selectors = new Set<string>();
  for (let i = 0; i < end; i++) {
    const op = bytes[i];
    if ([0x32, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x48, 0xf0, 0xf1, 0xf2, 0xf4, 0xf5, 0xfa, 0xff].includes(op)) return false;
    if (op === 0x63 && (bytes[i + 5] === 0x14 || bytes[i + 5] === 0x11)) {
      const selector = bytes.slice(i + 1, i + 5).map(b => b.toString(16).padStart(2, "0")).join("");
      if (!allowed.has(selector)) return false;
      selectors.add(selector);
    }
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return [...allowed].every(s => selectors.has(s));
}

/** A bound on EACH call and on total calls. Late promises never mutate strategy state.
 * In-flight accounting survives decisions, preventing failed RPCs accumulating without bound.
 */
export function boundedClient(client: PublicClient, state: LaunchState, block: number): PublicClient {
  let calls = 0;
  const permitted = new Set(["readContract", "simulateContract", "getCode", "getLogs"]);
  return new Proxy(client, {
    get(target, key) {
      if (typeof key !== "string" || !permitted.has(key)) throw new Error("unsupported read method");
      return async (args: Record<string, unknown>) => {
        if (++calls > P.rpcMaxCalls || state.inFlight >= P.rpcMaxCalls) throw new Error("RPC budget exhausted");
        state.inFlight++;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const fn = Reflect.get(target, key) as (a: Record<string, unknown>) => Promise<unknown>;
        const request = Promise.resolve().then(() => fn.call(target, key === "getLogs" ? args : { ...args, blockNumber: BigInt(block) }));
        void request.then(() => { state.inFlight--; }, () => { state.inFlight--; });
        try {
          return await Promise.race([request, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("RPC deadline")), P.rpcTimeoutMs);
          })]);
        } finally { if (timer) clearTimeout(timer); }
      };
    },
  });
}

function stableRegistry(obs: AgentObservation, p: LaunchPool): boolean {
  if (obs.registry?.error || p.mine) return false;
  const e = obs.registry?.entries.find(e => e.market.toLowerCase() === p.pool.toLowerCase());
  return !!e?.verified && e.kind === "uniswapV3Pool" && !!e.codehashNow &&
    e.codehashNow.toLowerCase() === e.codehashAtRegistration.toLowerCase();
}

async function inspect(obs: AgentObservation, client: PublicClient, p: LaunchPool, fee: number): Promise<boolean> {
  if (!stableRegistry(obs, p) || ![100, 500, 3000].includes(fee)) return false;
  const [code, decimals, factory] = await Promise.all([
    client.getCode({ address: p.token }),
    client.readContract({ address: p.token, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: UNISWAP.swapRouter, abi: extraAbi, functionName: "factory" }),
  ]);
  if (decimals !== 18 || !screenTokenCode(code)) return false;
  const tokenEntry = obs.registry?.entries.find(e => e.market.toLowerCase() === p.token.toLowerCase());
  if (!tokenEntry || !code || !tokenEntry.codehashNow ||
    keccak256(code).toLowerCase() !== tokenEntry.codehashAtRegistration.toLowerCase() ||
    tokenEntry.codehashNow.toLowerCase() !== tokenEntry.codehashAtRegistration.toLowerCase()) return false;
  const actual = await client.readContract({ address: factory, abi: extraAbi, functionName: "getPool", args: [p.token, TOKENS.USDC.address, fee] });
  return actual.toLowerCase() === p.pool.toLowerCase();
}

async function flow(client: PublicClient, p: LaunchPool, block: number, self: Address) {
  const logs = await client.getLogs({ address: p.pool, event: extraAbi[2], fromBlock: BigInt(Math.max(p.registeredAtBlock + 1, block - 2)), toBlock: BigInt(block) });
  const nets = [0n, 0n, 0n];
  for (const log of logs) {
    if (log.removed || log.blockNumber === null || log.args.recipient?.toLowerCase() === self.toLowerCase()) continue;
    const i = Number(log.blockNumber) - block + 2;
    if (i >= 0 && i < 3) nets[i] += (p.tokenIsToken0 ? log.args.amount1 : log.args.amount0) ?? 0n;
  }
  return nets;
}

export async function launchDecision(obs: AgentObservation, ctx: AgentContext, state: LaunchState,
  left: number, block: number, priority: string, allowEntry = true): Promise<Record<string, unknown> | null> {
  if (block < state.pauseUntil && !state.position) return null;
  const client = boundedClient(ctx.publicClient, state, block), self = ctx.address as Address;
  try {
    // One outstanding position; balance confirmation is authoritative, never the submitted action.
    if (state.position) {
      const pos = state.position;
      const held = (await tokenBalance(client, pos.pool.token, self)) ?? 0n;
      if (held === 0n) {
        if (pos.seen && pos.exiting) state.position = undefined;
        // Keep reconciling a failed/pending purchase through the epoch. A late fill must not
        // be forgotten just because it took longer than expected. Other strategies may run.
        return null;
      }
      pos.seen = true;
      let quoted: bigint | undefined;
      try { quoted = await quoteLaunch(client, { tokenIn: pos.pool.token, tokenOut: TOKENS.USDC.address, fee: pos.fee, amountIn: held }); } catch { /* exit fallback below */ }
      if (quoted !== undefined && quoted > pos.peak) pos.peak = quoted;
      let due = pos.exiting || left <= P.launchExitBlocks || block - pos.block >= P.launchHoldBlocks || !stableRegistry(obs, pos.pool);
      if (quoted !== undefined) due ||= quoted * 10000n <= pos.cost * BigInt(10000 - P.launchStopBps) ||
        quoted * 10000n < pos.peak * BigInt(10000 - P.launchTrailBps) ||
        quoted * 10000n >= pos.cost * BigInt(10000 + P.launchTakeBps);
      if (!due) {
        try { const nets = await flow(client, pos.pool, block, self); due = nets[2] < 0n; }
        catch { due = true; }
      }
      if (!due) return null;
      if (quoted === undefined && left > 6) return null;
      pos.exiting = true;
      // Do not discard dust: any unpriced launch balance at the bell scores zero.
      const minOut = left <= 6 || quoted === undefined ? 1n : applySlippage(quoted, P.launchExitSlippageBps);
      return swapBundle({ tokenIn: pos.pool.token, tokenOut: TOKENS.USDC.address, fee: pos.fee,
        recipient: self, amountIn: held, minOut: minOut > 0n ? minOut : 1n,
        reason: "astra-2 launch full exit; confirm zero balance next observation", maxPriorityFeePerGasWei: priority });
    }

    // Bounded one-pool scan also recovers held tokens after a worker restart. It continues
    // during the final blocks even though new purchases have already stopped.
    const pools = launchPools(obs).filter(p => !p.mine);
    if (!pools.length) return null;
    const p = pools[state.cursor++ % pools.length];
    const held = (await tokenBalance(client, p.token, self)) ?? 0n;
    const fee = await poolFee(client, p.pool);
    if (held > 0n) {
      state.position = { pool: p, fee, block: block - P.launchHoldBlocks, cost: 0n, peak: 0n, exiting: true, seen: true };
      return null;
    }
    if (!allowEntry || left <= P.entryStopBlocks || block - p.registeredAtBlock > 45 ||
      block - p.registeredAtBlock < 3 || state.used.has(p.token.toLowerCase()) ||
      state.spent >= BigInt(P.launchTotalUsd) * U || !stableRegistry(obs, p)) return null;
    const [pool, nets] = await Promise.all([launchPoolState(client, p), flow(client, p, block, self)]);
    if (pool.liquidity <= 0n || pool.usdcReserveUnits < 5000n * U ||
      !nets.every(n => n * 10000n >= pool.usdcReserveUnits * BigInt(P.launchFlowBps))) return null;
    if (!await inspect(obs, client, p, fee)) { state.used.add(p.token.toLowerCase()); return null; }
    const size = min(BigInt(P.launchMaxUsd) * U, BigInt(obs.balances.usdcUnits) / 50n,
      pool.usdcReserveUnits * BigInt(P.launchReserveBps) / 10000n,
      BigInt(P.launchTotalUsd) * U - state.spent);
    if (size < 20n * U) return null;
    const bought = await quoteLaunch(client, { tokenIn: TOKENS.USDC.address, tokenOut: p.token, fee, amountIn: size });
    if (bought <= 0n) return null;
    const back = await quoteLaunch(client, { tokenIn: p.token, tokenOut: TOKENS.USDC.address, fee, amountIn: bought });
    if (back * 10000n < size * 9500n) return null;
    // Test transfer INTO the pool at the actual proposed token size, not a dust probe.
    // The pool is a funded caller before entry. This catches the supplied honeypot's
    // destination restriction, but is not proof of arbitrary sender-specific behavior.
    const sim = await client.simulateContract({ address: p.token, abi: erc20Abi, functionName: "transfer", args: [p.pool, bought], account: p.pool });
    if (sim.result !== true) return null;
    state.used.add(p.token.toLowerCase()); state.spent += size;
    state.position = { pool: p, fee, block, cost: size, peak: back, exiting: false, seen: false };
    return swapBundle({ tokenIn: TOKENS.USDC.address, tokenOut: p.token, fee, recipient: self,
      amountIn: size, minOut: applySlippage(bought, P.launchEntrySlippageBps),
      reason: "astra-2 launch confirmed three-block demand", maxPriorityFeePerGasWei: priority });
  } catch {
    // Never log raw RPC errors: endpoints can contain credentials. Avoid hammering failures.
    state.pauseUntil = block + 4;
    return null;
  }
}
