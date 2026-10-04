// xb-r v5 diagnostic: R9 only ON after dev4; no measured performance claim.
// Market decoding and funding normalization below are copied from xb-core.
import type { AgentContext, AgentObservation } from "@eris/sdk";
import { BALANCER, MARKET_LEGS, UNISWAP } from "@eris/sdk/constants.js";
import { balanceOf, canFund } from "../lib/affordable.js";

export type Params = Readonly<{
  R1_BUNDLE_PRIORITY: boolean;
  R2_BALANCE_FLOOR: boolean;
  R3_ENTRY_ONLY: boolean;
  R4_COMPETITOR_BID: boolean;
  R5_PROFITABLE_RESTORE: boolean;
  R6_ANCHOR_CROSS: boolean;
  R7_SINGLE_ENTRY: boolean;
  R8_SETTLED_COOLDOWN: boolean;
  R9_BUNDLE_HEADROOM: boolean;
  R10_FULL_DEPTH_SIZE: boolean;
  R11_SMALL_SINGLE_CAP: boolean;
  R12_UNCONFIRMED_BACKOFF: boolean;
  R13_EDGE_SLIPPAGE: boolean;
  ENTRY_BPS: number;
  SINGLE_EDGE_BPS: number;
}>;
export const V3_PARAMS: Params = Object.freeze({
  R1_BUNDLE_PRIORITY: true, R2_BALANCE_FLOOR: true, R3_ENTRY_ONLY: true,
  R4_COMPETITOR_BID: true, R5_PROFITABLE_RESTORE: true,
  R6_ANCHOR_CROSS: true, R7_SINGLE_ENTRY: true,
  R8_SETTLED_COOLDOWN: true, R9_BUNDLE_HEADROOM: false,
  R10_FULL_DEPTH_SIZE: false, R11_SMALL_SINGLE_CAP: false, R12_UNCONFIRMED_BACKOFF: false,
  R13_EDGE_SLIPPAGE: false,
  ENTRY_BPS: 50, SINGLE_EDGE_BPS: 100,
});
// One-factor ablation, not promotion to a qualified/performance-proven policy.
// R9 OFF returns the frozen d30cbbb policy; other probes remain independent.
export const PARAMS: Params = Object.freeze({ ...V3_PARAMS, R9_BUNDLE_HEADROOM: true });
// v2 replay profile; v3 factors are independently switchable and not AI controls.
export const DEV3A_PARAMS: Params = Object.freeze({ ...V3_PARAMS,
  R8_SETTLED_COOLDOWN: false, R9_BUNDLE_HEADROOM: false, ENTRY_BPS: 60,
});
// Historical diagnostic profile. All factors are baked, never read from environment.
export const DEV2_PARAMS: Params = Object.freeze({ ...DEV3A_PARAMS,
  R6_ANCHOR_CROSS: false, R7_SINGLE_ENTRY: false, ENTRY_BPS: 50,
});
export type Action = Record<string, any>;
const W = 10n ** 18n;
const BASES = ["WETH", "WBTC"] as const;
type Base = typeof BASES[number];
const INITIAL = { WETH: 8n * W, WBTC: 40_000_000n };
const GAS_RESERVE = W / 20n;
const INV_BAND = 0.2;
const SLIPPAGE_BPS = 80; // Historical ceiling; R13 can only tighten it.
const MIN_PROFIT_USDC = 0.05;
const SWAPS = { uniswap: "swap", balancer: "balancerSwap", curve: "curveSwap" } as const;
type Venue = { protocol: keyof typeof SWAPS; mid: number; cost: number; depth: number };
type Market = { base: Base; fair: number; decimals: number; held: bigint; venues: Venue[] };
export type Candidate = {
  action: Action; base: Base; profit: number; gas: number; usd: number;
  edge: number; slope: number; restoring: boolean;
};
const positive = (n: number) => Number.isFinite(n) && n > 0;
const min = (...ns: bigint[]) => ns.reduce((a, b) => a < b ? a : b);
const units = (n: number, decimals = 6) => BigInt(Math.floor(n * 10 ** decimals));
const noop = (reason: string): Action => ({ type: "noop", reason });

export function funded(obs: AgentObservation, token: string, amount: bigint): boolean {
  const held = balanceOf(obs, token);
  // Preserve xb-core's WBTC dust normalization, but check the real 8-decimal amount.
  const normalized = token === "WBTC" ? { ...obs, baseBalances: {
    ...obs.baseBalances, WBTC: (held * 10n ** 10n).toString(),
  } } : obs;
  return amount > 0n && amount <= held && canFund(normalized, token);
}

function markets(obs: AgentObservation): Market[] {
  return BASES.flatMap(base => {
    const fair = obs.fairPricesUsd?.[base] ?? (base === "WETH" ? obs.fairPriceUsdcPerWeth : NaN);
    const decimals = base === "WETH" ? 18 : 8;
    if (!positive(fair) || (obs.baseDecimals?.[base] ?? decimals) !== decimals) return [];
    const venues: Venue[] = [];
    for (const protocol of ["uniswap", "balancer", "curve"] as const) {
      if (!obs.enabledProtocols.includes(protocol)) continue;
      const q: any = protocol === "uniswap"
        ? (base === "WETH" ? obs.protocols.uniswap?.pool : obs.protocols.uniswap?.markets?.[`${base}/USDC`])
        : (base === "WETH" ? obs.protocols[protocol] : obs.protocols[protocol]?.markets?.[`${base}/USDC`]);
      if (!q || !positive(Number(q.priceUsdcPerWeth))) continue;
      let mid = Number(q.priceUsdcPerWeth), cost: number, depth: number;
      if (protocol === "uniswap") {
        cost = Number(q.fee ?? 3000) / 1e6;
        depth = q.liquidity === undefined ? 300_000
          : Number(BigInt(q.liquidity)) * Math.sqrt(mid * 10 ** (6 - decimals)) / 1e6;
      } else {
        const twoSided = Number(q.effectiveHalfSpreadBps) >= 0 &&
          positive(Number(q.buyPriceUsdcPerWeth)) && positive(Number(q.sellPriceUsdcPerWeth));
        cost = twoSided ? Number(q.effectiveHalfSpreadBps) / 10000 : 0.003;
        if (!twoSided) mid /= 1 - cost;
        depth = q.reserves?.usdc === undefined ? 300_000 : Number(BigInt(q.reserves.usdc)) / 1e6;
      }
      if (positive(mid) && Number.isFinite(cost) && cost >= 0 && cost < 0.2 && positive(depth) && depth >= 20_000)
        venues.push({ protocol, mid, cost, depth });
    }
    return [{ base, fair, decimals, held: balanceOf(obs, base), venues }];
  });
}

export const entryAllowed = (edge: number, p: Params) =>
  edge * 10000 > (p.R3_ENTRY_ONLY ? p.ENTRY_BPS : 60);
// The factor-off diagnostic recreates sonnet's margin subtraction, not xb-v0 equivalence.
export const economicEdge = (edge: number, p: Params) => edge - (p.R3_ENTRY_ONLY ? 0 : 0.006);
export function sizeUsd(edge: number, slope: number, balance: number, cap: number, floor: boolean,
  fullDepth = false): number {
  if (![edge, slope, balance, cap].every(positive)) return 0;
  const depthTarget = 0.5 * edge / (2 * slope); // xb-core V0 desired size
  const balanceTarget = balance * Math.max(0.025, Math.min(0.25, edge * 10));
  const desired = floor ? Math.max(depthTarget, balanceTarget) : depthTarget;
  // Hard depth ceiling is the edge-closing size; the floor is a target, not an override.
  return Math.min(fullDepth ? edge / (2 * slope) : desired, edge / (2 * slope), cap, balance * 0.9);
}
export const profitUsd = (usd: number, edge: number, slope: number, legs: number) =>
  usd * (edge - usd * slope) * (legs === 2 ? 0.8 : 1);

function priorityFloor(obs: AgentObservation): bigint {
  const configured = BigInt(obs.limits.defaultPriorityFeePerGasWei);
  return min(configured > 0n ? configured : 1n, BigInt(obs.limits.maxPriorityFeePerGasWei));
}
// Same profit/gas inputs as V0: its floor-plus-10%-extra bid is a hard upper bound.
export function bidWei(obs: AgentObservation, profit: number, gas: number, competitive: boolean): bigint {
  const ethPrice = obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
  if (![profit, gas, ethPrice].every(positive)) return 0n;
  const floor = priorityFloor(obs), ceiling = BigInt(obs.limits.maxPriorityFeePerGasWei);
  if (floor <= 0n) return 0n;
  const extra = BigInt(Math.floor(0.1 * profit / ethPrice / gas * 1e18));
  const budget = min(floor + extra, ceiling);
  if (!competitive) return budget;
  const rival = BigInt(obs.competition?.maxCompetitorPriorityFeeWei ?? "0");
  if (rival < 0n) return 0n;
  const target = rival + 100_000_000n;
  const wanted = target > floor ? target : floor;
  // An unaffordable target is a rejection, never a clipped or zero-fee submission.
  return wanted <= budget ? wanted : 0n;
}
export function netProfitUsd(obs: AgentObservation, c: Candidate, fee: bigint): number {
  // Base fee = 0 in the target simulator. The total sent fee includes the default floor.
  const ethPrice = obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
  return c.profit - Number(fee) * c.gas * ethPrice / 1e18;
}
// A model budget, not an executable-price guarantee: the SDK quotes again
// when building each transaction. Reserve MIN_PROFIT after modeled gas and
// charge every bundle leg against the same budget (no double spending).
// Include modeled profit in output exposure so output slippage is not treated
// as an equal percentage of input. Actual quotes/receipts are unavailable here.
export function slippageBudgetBps(c: Candidate, net: number, p: Params): number {
  const legs = c.action.type === "bundle" ? c.action.actions.length : 1;
  const exposure = legs * c.usd + Math.max(0, c.profit);
  if (!positive(c.usd) || !positive(exposure) || !Number.isFinite(net) || legs < 1) return 0;
  return Math.max(0, Math.floor(Math.min(SLIPPAGE_BPS, p.ENTRY_BPS,
    (net - MIN_PROFIT_USDC) / exposure * 10000)));
}
function swap(m: Market, v: Venue, token: string, amount: bigint): Action {
  return { type: SWAPS[v.protocol], ...(m.base === "WETH" ? {} : { base: m.base }),
    tokenIn: token, amountIn: amount.toString(), slippageBps: SLIPPAGE_BPS };
}
function remaining(obs: AgentObservation): number {
  const values = [obs.blocksRemaining, obs.dayBlocksRemaining].filter((v): v is number =>
    v !== undefined && Number.isFinite(v));
  return values.length ? Math.min(...values) : 0;
}

// No capital is reserved during enumeration. Every venue and ordered pair sees the same wallet.
export function enumerateCandidates(obs: AgentObservation, p: Params = PARAMS,
  cooling: ReadonlySet<string> = new Set()): Candidate[] {
  const out: Candidate[] = [], ms = markets(obs);
  const cash = Number(BigInt(obs.balances.usdcUnits)) / 1e6;
  const cap = 0.08 * (cash + ms.reduce((sum, m) => sum + Number(m.held) / 10 ** m.decimals * m.fair, 0));
  // Allocation probe: smaller singles leave capital and inventory room for
  // subsequent opportunities. Neither probe expands the common 8% ceiling.
  const singleCap = p.R11_SMALL_SINGLE_CAP ? cap / 2 : cap;
  const left = remaining(obs);
  if (left <= 0) return out;
  const endgame = left <= 4;
  for (const m of ms) {
    const held = Number(m.held) / 10 ** m.decimals, initial = Number(INITIAL[m.base]) / 10 ** m.decimals;
    const upper = initial * (1 + INV_BAND), lower = initial * (1 - INV_BAND);
    // Only endgame restoration bypasses the two-block single cooldown.
    if (!endgame || p.R5_PROFITABLE_RESTORE) {
      for (const v of m.venues) for (const buy of [true, false]) {
        const restoring = buy ? held < initial : held > initial;
        if (endgame && !restoring) continue;
        if (cooling.has(m.base) && !(endgame && restoring)) continue;
        const rawEdge = buy ? m.fair / v.mid - 1 - v.cost : v.mid / m.fair - 1 - v.cost;
        if (!entryAllowed(rawEdge, p)) continue;
        if (p.R1_BUNDLE_PRIORITY && !p.R7_SINGLE_ENTRY && !restoring && rawEdge * 10000 <= p.SINGLE_EDGE_BPS) continue;
        const edge = economicEdge(rawEdge, p), slope = 1 / v.depth;
        // The anchor is not a hard barrier during ordinary profitable trading.
        // Crossing it is NEW risk and must pass that gate; endgame never crosses.
        // Keep the same independent-leg band even when the anchor residue is dust.
        const crossAnchor = p.R6_ANCHOR_CROSS && !endgame &&
          (p.R7_SINGLE_ENTRY || rawEdge * 10000 > p.SINGLE_EDGE_BPS);
        // Optional allocation probe: reserve half the band for independently
        // funded bundle legs. This tightens single risk; never widens the hard band.
        const singleUpper = p.R9_BUNDLE_HEADROOM ? initial * (1 + INV_BAND / 2) : upper;
        const singleLower = p.R9_BUNDLE_HEADROOM ? initial * (1 - INV_BAND / 2) : lower;
        const room = Math.max(0, restoring && !crossAnchor ? Math.abs(held - initial)
          : buy ? singleUpper - held : held - singleLower);
        const usd = Math.min(sizeUsd(edge, slope, buy ? cash : held * v.mid, singleCap, p.R2_BALANCE_FLOOR, p.R10_FULL_DEPTH_SIZE),
          room * v.mid / (buy ? 1.008 : 1), singleCap * Math.min(1, v.mid / m.fair));
        if (!(usd >= 50)) continue;
        const amount = units(buy ? usd : usd / v.mid, buy ? 6 : m.decimals);
        const actualUsd = Number(amount) / 10 ** (buy ? 6 : m.decimals) * (buy ? 1 : v.mid);
        out.push({ action: swap(m, v, buy ? "USDC" : m.base, amount), base: m.base,
          usd: actualUsd, edge, slope, restoring: restoring && !crossAnchor,
          profit: profitUsd(actualUsd, edge, slope, 1), gas: 200_000 });
      }
    }
    if (endgame || (!p.R1_BUNDLE_PRIORITY && cooling.has(m.base))) continue;
    for (const cheap of m.venues) for (const rich of m.venues) {
      if (cheap.protocol === rich.protocol) continue;
      const rawEdge = rich.mid / cheap.mid - 1 - cheap.cost - rich.cost;
      if (!entryAllowed(rawEdge, p)) continue;
      const edge = economicEdge(rawEdge, p), slope = 1 / cheap.depth + 1 / rich.depth;
      const usd = Math.min(sizeUsd(edge, slope, cash, cap, p.R2_BALANCE_FLOOR, p.R10_FULL_DEPTH_SIZE),
        held * cheap.mid / 1.008, Math.max(0, upper - held) * cheap.mid / 1.008,
        Math.max(0, held - lower) * cheap.mid, cap * Math.min(1, cheap.mid / m.fair));
      if (!(usd >= 50)) continue;
      const spend = units(usd), actualUsd = Number(spend) / 1e6;
      const bought = actualUsd / (cheap.mid * (1 + cheap.cost)) * (1 - actualUsd / cheap.depth);
      const sell = units(bought * 0.985, m.decimals);
      out.push({ action: { type: "bundle", actions: [swap(m, cheap, "USDC", spend), swap(m, rich, m.base, sell)] },
        base: m.base, usd: actualUsd, edge, slope, restoring: false,
        profit: profitUsd(actualUsd, edge, slope, 2), gas: 350_000 });
    }
  }
  return out;
}

// Transactional, candidate-local reservation: a rejected candidate cannot consume another's funds.
// Each bundle leg must be funded from the observation; no credit for predicted buy proceeds.
export function reserveCandidate(obs: AgentObservation, c: Candidate): boolean {
  const spent = new Map<string, bigint>();
  for (const leg of c.action.type === "bundle" ? c.action.actions : [c.action]) {
    const token = leg.tokenIn as string, amount = BigInt(leg.amountIn);
    if (amount <= 0n) return false;
    const total = (spent.get(token) ?? 0n) + amount;
    if (!funded(obs, token, total)) return false;
    spent.set(token, total);
  }
  return true;
}
type SpotBids = ReadonlyMap<string, bigint>;
function candidateObservation(obs: AgentObservation, c: Candidate, bids?: SpotBids): AgentObservation {
  if (!bids) return obs;
  let rival = 0n;
  for (const leg of c.action.type === "bundle" ? c.action.actions : [c.action]) {
    // Router/vault calls are conservatively shared across bases. Curve has a
    // separate pool per market. Count ALL calls to these execution targets,
    // including direct pool calls, liquidity changes and reverted transactions.
    const targets = leg.type === "swap" && MARKET_LEGS.uniswap[c.base]
      ? [UNISWAP.swapRouter, MARKET_LEGS.uniswap[c.base].pool]
      : leg.type === "balancerSwap" && MARKET_LEGS.balancer[c.base] ? [BALANCER.vault]
      : leg.type === "curveSwap" && MARKET_LEGS.curve[c.base] ? [MARKET_LEGS.curve[c.base].pool] : undefined;
    if (!targets) return obs; // Unknown route retains the aggregate conservative signal.
    for (const target of targets) {
      const fee = bids.get(target.toLowerCase()) ?? 0n;
      if (fee > rival) rival = fee;
    }
  }
  return { ...obs, competition: { maxBlockPriorityFeeWei: "0", lastTxIndex: null,
    recentRevertRate: 0, recentSampleSize: 0, ...obs.competition,
    maxCompetitorPriorityFeeWei: rival.toString() } };
}

// The SDK aggregate includes oracle/keeper transactions. Use one public,
// block-pinned read to measure bids at the candidate's execution targets.
// Never infer a competitor from sender identity, run metadata or a fixed fee.
async function readSpotBids(obs: AgentObservation, ctx: AgentContext): Promise<SpotBids | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const block = await Promise.race([
      ctx.publicClient.getBlock({ blockNumber: BigInt(obs.blockNumber), includeTransactions: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("bid read deadline")), 750); }),
    ]);
    if (block.number !== BigInt(obs.blockNumber)) return undefined;
    const bids = new Map<string, bigint>();
    for (const tx of block.transactions) {
      if (typeof tx === "string" || !/^0x[0-9a-f]{40}$/i.test(tx.from) ||
          (tx.to !== null && !/^0x[0-9a-f]{40}$/i.test(tx.to))) return undefined;
      const fee = tx.maxPriorityFeePerGas ?? tx.gasPrice;
      if (typeof fee !== "bigint" || fee < 0n) return undefined;
      if (tx.from.toLowerCase() === obs.agentAddress.toLowerCase() || tx.to === null) continue;
      const target = tx.to.toLowerCase();
      if (fee > (bids.get(target) ?? 0n)) bids.set(target, fee);
    }
    return bids;
  } catch {
    return undefined; // Failed/incomplete reads never turn into "no competitors".
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function selectCandidate(obs: AgentObservation, all: readonly Candidate[], p: Params = PARAMS,
  bids?: SpotBids): Action {
  const ranked = all.map(c => {
    const bidObs = candidateObservation(obs, c, bids);
    const fee = bidWei(bidObs, c.profit, c.gas, p.R4_COMPETITOR_BID);
    return { c, fee, net: netProfitUsd(obs, c, fee) };
  }).sort((a, b) => {
    const priority = p.R1_BUNDLE_PRIORITY
      ? Number(b.c.action.type === "bundle") - Number(a.c.action.type === "bundle") : 0;
    return priority || b.net - a.net;
  });
  for (const { c, fee, net } of ranked) {
    if (fee <= 0n || !Number.isFinite(net) || net < MIN_PROFIT_USDC) continue;
    if (!reserveCandidate(obs, c)) continue;
    if (BigInt(obs.balances.ethWei) - BigInt(c.gas) * fee < GAS_RESERVE) continue;
    let action = c.action;
    if (p.R13_EDGE_SLIPPAGE) {
      const slippageBps = slippageBudgetBps(c, net, p);
      // Less than one integer bps of modeled room: try the next candidate.
      if (slippageBps < 1) continue;
      action = c.action.type === "bundle"
        ? { ...c.action, actions: c.action.actions.map((leg: Action) => ({ ...leg, slippageBps })) }
        : { ...c.action, slippageBps };
    }
    return { ...action, base: c.base, maxPriorityFeePerGasWei: fee.toString() };
  }
  return noop("no funded positive net edge at an affordable bid");
}

function validateParams(p: Params): void {
  for (const key of ["R1_BUNDLE_PRIORITY", "R2_BALANCE_FLOOR", "R3_ENTRY_ONLY",
    "R4_COMPETITOR_BID", "R5_PROFITABLE_RESTORE", "R6_ANCHOR_CROSS", "R7_SINGLE_ENTRY",
    "R8_SETTLED_COOLDOWN", "R9_BUNDLE_HEADROOM", "R10_FULL_DEPTH_SIZE",
    "R11_SMALL_SINGLE_CAP", "R12_UNCONFIRMED_BACKOFF", "R13_EDGE_SLIPPAGE"] as const) {
    if (typeof p[key] !== "boolean") throw new TypeError(`${key} must be boolean`);
  }
  if (!Number.isFinite(p.ENTRY_BPS) || p.ENTRY_BPS < 20 || p.ENTRY_BPS > 60 || p.ENTRY_BPS % 5 !== 0)
    throw new RangeError("ENTRY_BPS must be 20 to 60 in 5bps steps");
  if (!Number.isFinite(p.SINGLE_EDGE_BPS) || p.SINGLE_EDGE_BPS < 0)
    throw new RangeError("SINGLE_EDGE_BPS must be finite and nonnegative");
}

// Balance confirmation, not a receipt oracle. Release just the next-block
// cooldown for an exact-input single whose debit AND proceeds are now visible.
// Any ambiguity (partial bundle, unchanged wallet, gas refill, another base
// moving, skipped block) keeps the historical two-block wait. No extra RPC.
export function settledSingle(before: AgentObservation, action: Action, after: AgentObservation): boolean {
  try {
    if (before.runId !== after.runId || Number(after.blockNumber) !== Number(before.blockNumber) + 1 ||
        !Object.values(SWAPS).includes(action.type) || !BASES.includes(action.base) ||
        BigInt(after.balances.ethWei) >= BigInt(before.balances.ethWei)) return false;
    const base = action.base as Base, other = base === "WETH" ? "WBTC" : "WETH";
    if (balanceOf(before, other) !== balanceOf(after, other)) return false;
    const cashDelta = balanceOf(after, "USDC") - balanceOf(before, "USDC");
    const baseDelta = balanceOf(after, base) - balanceOf(before, base);
    const amount = BigInt(action.amountIn);
    if (amount <= 0n) return false;
    return action.tokenIn === "USDC" ? cashDelta === -amount && baseDelta > 0n
      : action.tokenIn === base && baseDelta === -amount && cashDelta > 0n;
  } catch { return false; }
}

export function createAgent(params: Params = PARAMS, now: () => number = () => performance.now(),
  resolvePolicy?: () => Params) {
  const initialParams = Object.freeze({ ...params });
  validateParams(initialParams);
  let run = "", lastBlock = -1, lastRemaining = Infinity;
  const lastSent = new Map<Base, number>();
  const unconfirmedSingles = new Map<Base, { observation: AgentObservation; action: Action }>();
  let previous: { observation: AgentObservation; action: Action } | undefined;
  return function decide(obs: AgentObservation, _ctx?: AgentContext,
    execution?: { started: number; bids: SpotBids | undefined }): Action {
    try {
      const p = resolvePolicy ? Object.freeze({ ...resolvePolicy() }) : initialParams;
      validateParams(p);
      const started = execution?.started ?? now(), block = Number(obs.blockNumber), left = remaining(obs);
      if (!Number.isSafeInteger(block) || block < 0) return noop("invalid block");
      if (run !== obs.runId || block < lastBlock || left > lastRemaining + 5) {
        run = obs.runId; lastBlock = -1; lastSent.clear(); previous = undefined; unconfirmedSingles.clear();
      }
      if (block === lastBlock) return noop("duplicate observation");
      lastBlock = block; lastRemaining = left;
      if (left <= 0) return noop("valuation boundary or unknown horizon");
      const cooling = new Set<Base>();
      // Back off ambiguous/failed single attempts, per base. Only the same
      // exact next-block balance confirmation as R8 can clear this early.
      for (const [base, sent] of unconfirmedSingles)
        if (settledSingle(sent.observation, sent.action, obs)) unconfirmedSingles.delete(base);
      for (const [base, at] of lastSent) {
        const wait = p.R12_UNCONFIRMED_BACKOFF && unconfirmedSingles.has(base) ? 4 : 2;
        if (block - at < wait) cooling.add(base);
      }
      if (p.R8_SETTLED_COOLDOWN && previous && settledSingle(previous.observation, previous.action, obs))
        cooling.delete(previous.action.base);
      const all = enumerateCandidates(obs, p, cooling);
      const action = selectCandidate(obs, all, p, execution?.bids);
      if (now() - started >= 4000) return noop("decision deadline reserve");
      if (action.type !== "noop") {
        lastSent.set(action.base, block);
        previous = { observation: structuredClone(obs), action: structuredClone(action) };
        if (p.R12_UNCONFIRMED_BACKOFF) {
          if (action.type === "bundle") unconfirmedSingles.delete(action.base);
          else unconfirmedSingles.set(action.base, previous);
        }
      }
      return action;
    } catch {
      return noop("invalid observation");
    }
  };
}
export function createLiveAgent(params: Params = PARAMS, now: () => number = () => performance.now(),
  resolvePolicy?: () => Params) {
  const p = Object.freeze({ ...params }), core = createAgent(p, now, resolvePolicy);
  return async function decide(obs: AgentObservation, ctx?: AgentContext): Promise<Action> {
    const started = now();
    const bids = ctx && p.R4_COMPETITOR_BID && obs && remaining(obs) > 0
      ? await readSpotBids(obs, ctx) : undefined;
    return core(obs, undefined, { started, bids });
  };
}
export const decide = createLiveAgent(PARAMS);
