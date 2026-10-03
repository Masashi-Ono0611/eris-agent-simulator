// derived from NyxFoundation/eris-agent-simulator example/agents/multi-arb (MIT)
/** Adjustable, default-compatible fork of multi-arb (ADR 0013). */
import type { AgentAction, AgentObservation } from "@eris/sdk";
import { marketViews, type MarketView } from "../lib/markets.js";

export const DEFAULT_PARAMS = {
  SAFETY_MARGIN_BPS: 50, MIN_SIZE_BPS: 250, MAX_SIZE_BPS: 2500,
  SPREAD_GAIN: 200_000, GAP_GAIN: 200_000, LEG_SLIPPAGE_BPS: 120,
  SINGLE_SLIPPAGE_BPS: 75,
  useExecutableQuotes: false, persistBlocks: 0, inventoryBandBps: 0,
  endgameNoNewBlocks: 0, bidExtraBps: 0,
} as const;
export type DeltaParams = {
  SAFETY_MARGIN_BPS: number; MIN_SIZE_BPS: number; MAX_SIZE_BPS: number;
  SPREAD_GAIN: number; GAP_GAIN: number; LEG_SLIPPAGE_BPS: number; SINGLE_SLIPPAGE_BPS: number;
  useExecutableQuotes: boolean; persistBlocks: number; inventoryBandBps: number;
  endgameNoNewBlocks: number; bidExtraBps: number;
};

const RANGES: Record<keyof DeltaParams, [number, number]> = {
  SAFETY_MARGIN_BPS: [0, 5000], MIN_SIZE_BPS: [0, 10000], MAX_SIZE_BPS: [0, 10000],
  SPREAD_GAIN: [0, 10_000_000], GAP_GAIN: [0, 10_000_000], LEG_SLIPPAGE_BPS: [0, 5000],
  SINGLE_SLIPPAGE_BPS: [0, 5000], useExecutableQuotes: [0, 1], persistBlocks: [0, 10000],
  inventoryBandBps: [0, 9999], endgameNoNewBlocks: [0, 10000], bidExtraBps: [0, 10000],
};
export function parseDeltaParams(raw: string | undefined): DeltaParams {
  const out = { ...DEFAULT_PARAMS } as DeltaParams;
  if (!raw) return out;
  try {
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
    for (const key of Object.keys(DEFAULT_PARAMS) as (keyof DeltaParams)[]) {
      const v = (obj as Record<string, unknown>)[key];
      if (key === "useExecutableQuotes") {
        if (typeof v === "boolean") out[key] = v;
        continue;
      }
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const [min, max] = RANGES[key];
      if (v < min || v > max || !Number.isInteger(v)) continue;
      out[key] = v;
    }
  } catch { /* malformed JSON leaves defaults intact */ }
  if (out.MIN_SIZE_BPS > out.MAX_SIZE_BPS) { out.MIN_SIZE_BPS = DEFAULT_PARAMS.MIN_SIZE_BPS; out.MAX_SIZE_BPS = DEFAULT_PARAMS.MAX_SIZE_BPS; }
  return out;
}
export const PARAMS = parseDeltaParams(process.env.ASCON_DELTA_PARAMS);

function baseToFloat(amountBaseWei: bigint, decimals: number): number { return Number(amountBaseWei) / 10 ** decimals; }
function floatToBase(amount: number, decimals: number): bigint { return BigInt(Math.max(0, Math.floor(amount * 10 ** decimals))); }
type TwoLeg = { base: string; spread: number; cheap: MarketView["venues"][number]; rich: MarketView["venues"][number]; usdcIn: bigint; baseSell: bigint };
type SingleLeg = { base: string; venue: MarketView["venues"][number]; gapAbs: number; tokenIn: string; amountIn: bigint };
const INITIAL: Record<string, { amount: bigint; decimals: number }> = {
  WETH: { amount: 8n * 10n ** 18n, decimals: 18 }, WBTC: { amount: 40_000_000n, decimals: 8 },
};
function inventoryCap(current: bigint, desired: bigint, base: string, buy: boolean, bandBps: number): bigint {
  const initial = INITIAL[base];
  if (!initial || bandBps <= 0) return desired;
  const band = initial.amount * BigInt(bandBps) / 10_000n;
  const limit = buy ? initial.amount + band : initial.amount - band;
  if (buy) return current >= limit ? 0n : (desired < limit - current ? desired : limit - current);
  return current <= limit ? 0n : (desired < current - limit ? desired : current - limit);
}

/** Pure decision core. */
export function chooseAction(obs: AgentObservation, params: DeltaParams = PARAMS): AgentAction | Record<string, unknown> | null {
  try {
    const views = marketViews(obs);
    const usdcBal = BigInt(obs.balances.usdcUnits || "0");
    const fee = obs.limits.defaultPriorityFeePerGasWei;
    let bestTwo: TwoLeg | null = null;
    for (const view of views) {
      if (view.venues.length < 2) continue;
      let cheap = view.venues[0], rich = view.venues[0];
      for (const v of view.venues) { if (v.price < cheap.price) cheap = v; if (v.price > rich.price) rich = v; }
      if (cheap.price <= 0 || rich.price <= 0) continue;
      const spread = rich.price / cheap.price - 1;
      const roundtripCost = (cheap.feeBps + rich.feeBps + params.SAFETY_MARGIN_BPS) / 10000;
      if (spread <= roundtripCost || usdcBal <= 0n) continue;
      const netEdge = spread - roundtripCost;
      const sizeBps = Math.min(params.MAX_SIZE_BPS, Math.max(params.MIN_SIZE_BPS, Math.floor(netEdge * params.SPREAD_GAIN)));
      const usdcIn = usdcBal * BigInt(sizeBps) / 10000n;
      if (usdcIn <= 0n) continue;
      const boughtBase = baseToFloat(usdcIn, 6) / cheap.price;
      const baseSell = floatToBase(boughtBase * 0.98, view.baseDecimals);
      if (baseSell <= 0n) continue;
      if (!bestTwo || spread > bestTwo.spread) bestTwo = { base: view.base, spread, cheap, rich, usdcIn, baseSell };
    }
    const bidFee = (edge: number): string => {
      if (params.bidExtraBps <= 0 || edge <= 0) return fee;
      // bidExtraBps scales how much of the headroom (default fee -> maxPriorityFeePerGasWei) is bid:
      // a 100 bps edge with bidExtraBps=10000 bids the ceiling; smaller edges bid proportionally less.
      // (A wei-sized add-on, as first written, is ~1e-6 of the 0.1 gwei default and changes nothing.)
      const ceiling = BigInt(obs.limits.maxPriorityFeePerGasWei ?? fee);
      const base = BigInt(fee);
      if (ceiling <= base) return fee;
      const share = Math.min(1, (edge / 0.01) * (params.bidExtraBps / 10000));
      const extra = ((ceiling - base) * BigInt(Math.floor(share * 1_000_000))) / 1_000_000n;
      return (base + extra).toString();
    };
    if (bestTwo && !(params.endgameNoNewBlocks > 0 && obs.blocksRemaining !== undefined && obs.blocksRemaining <= params.endgameNoNewBlocks)) {
      let usdcIn = bestTwo.usdcIn, baseSell = bestTwo.baseSell;
      if (params.inventoryBandBps > 0) {
        const current = BigInt(bestTwo.base === "WETH" ? obs.balances.wethWei || "0" : obs.baseBalances?.[bestTwo.base] ?? "0");
        const buyBase = floatToBase(baseToFloat(usdcIn, 6) / bestTwo.cheap.price, viewDecimals(views, bestTwo.base));
        const initial = INITIAL[bestTwo.base], band = initial.amount * BigInt(params.inventoryBandBps) / 10_000n;
        const lower = initial.amount - band, upper = initial.amount + band;
        // Buy output uses displayed price as an estimate; execution may differ.
        // Use the estimated net change for the band; at a boundary, trim the
        // conservative 2% sell reserve so a nominally neutral bundle remains eligible.
        if (baseSell < buyBase) baseSell = buyBase;
        const net = buyBase - baseSell;
        if (buyBase <= 0n || current < lower || current > upper) bestTwo = null;
        else if (net > 0n && current + net > upper) {
          const scale = (upper - current) * 10_000n / net;
          usdcIn = usdcIn * scale / 10_000n; baseSell = baseSell * scale / 10_000n;
        } else if (net < 0n && current + net < lower) {
          const scale = (current - lower) * 10_000n / (-net);
          usdcIn = usdcIn * scale / 10_000n; baseSell = baseSell * scale / 10_000n;
        }
        if (bestTwo && (usdcIn <= 0n || baseSell <= 0n)) bestTwo = null;
      }
      if (bestTwo) {
        const withBase = (a: Record<string, unknown>): Record<string, unknown> => bestTwo!.base === "WETH" ? a : { ...a, base: bestTwo!.base };
        return { type: "bundle", actions: [
          withBase({ type: bestTwo.cheap.swapType, tokenIn: "USDC", amountIn: usdcIn.toString(), slippageBps: params.LEG_SLIPPAGE_BPS }),
          withBase({ type: bestTwo.rich.swapType, tokenIn: bestTwo.base, amountIn: baseSell.toString(), slippageBps: params.LEG_SLIPPAGE_BPS }),
        ], maxPriorityFeePerGasWei: bidFee(bestTwo.spread) } as unknown as AgentAction;
      }
    }
    let bestOne: SingleLeg | null = null;
    for (const view of views) for (const venue of view.venues) {
      const buyQuote = params.useExecutableQuotes ? venue.buyPrice : undefined;
      const sellQuote = params.useExecutableQuotes ? venue.sellPrice : undefined;
      const buyEdge = (buyQuote !== undefined && buyQuote > 0 ? view.fair / buyQuote - 1 : view.fair / venue.price - 1) - (buyQuote !== undefined ? params.SAFETY_MARGIN_BPS : venue.feeBps + params.SAFETY_MARGIN_BPS) / 10000;
      const sellEdge = (sellQuote !== undefined && sellQuote > 0 ? sellQuote / view.fair - 1 : venue.price / view.fair - 1) - (sellQuote !== undefined ? params.SAFETY_MARGIN_BPS : venue.feeBps + params.SAFETY_MARGIN_BPS) / 10000;
      // Only profitable directions are candidates. A losing quote in the opposite
      // direction must not affect ranking, sizing, or the priority bid.
      const buyBase = buyEdge > 0 && buyEdge >= sellEdge;
      const sellBase = sellEdge > 0 && sellEdge > buyEdge;
      if (!buyBase && !sellBase) continue;
      const gapAbs = buyBase ? buyEdge : sellEdge;
      const tokenIn = buyBase ? "USDC" : view.base;
      const cap = buyBase ? usdcBal : BigInt(view.baseBalanceWei || "0");
      if (cap <= 0n) continue;
      const sizeBps = Math.min(params.MAX_SIZE_BPS, Math.max(params.MIN_SIZE_BPS, Math.floor(gapAbs * params.GAP_GAIN)));
      let amountIn = cap * BigInt(sizeBps) / 10000n;
      if (params.inventoryBandBps > 0) {
        const current = BigInt(view.baseBalanceWei || "0");
        if (buyBase) {
          const amountBase = floatToBase(baseToFloat(amountIn, 6) / (params.useExecutableQuotes ? venue.buyPrice ?? venue.price : venue.price), view.baseDecimals);
          const capped = inventoryCap(current, amountBase, view.base, true, params.inventoryBandBps);
          amountIn = amountBase > 0n ? amountIn * capped / amountBase : 0n;
        } else amountIn = inventoryCap(current, amountIn, view.base, false, params.inventoryBandBps);
      }
      if (amountIn <= 0n) continue;
      if (!bestOne || gapAbs > bestOne.gapAbs) bestOne = { base: view.base, venue, gapAbs, tokenIn, amountIn };
    }
    if (!bestOne) return { type: "noop", reason: "no funded venue gap" };
    
    const action: Record<string, unknown> = { type: bestOne.venue.swapType, tokenIn: bestOne.tokenIn,
      amountIn: bestOne.amountIn.toString(), maxPriorityFeePerGasWei: bidFee(bestOne.gapAbs), slippageBps: params.SINGLE_SLIPPAGE_BPS };
    if (bestOne.base !== "WETH") action.base = bestOne.base;
    return action;
  } catch { return null; }
}
function viewDecimals(views: MarketView[], base: string): number { return views.find(v => v.base === base)?.baseDecimals ?? 18; }

// Persistence counts the chosen opportunity and is idempotent within a block.
type PersistState = Map<string, { block: number; count: number }>;
const persistence: PersistState = new Map();
const lastBlocks = new WeakMap<object, number>();
function persistenceGate(obs: AgentObservation, params: DeltaParams, state: PersistState, action: any): boolean {
  if (params.persistBlocks <= 0) return true;
  const block = Number((obs as any).blockNumber ?? 0), last = lastBlocks.get(state);
  if (!Number.isSafeInteger(block) || block < 0 || last !== undefined && (block < last || block > last + 1)) state.clear();
  if (Number.isSafeInteger(block) && block >= 0) lastBlocks.set(state, block);
  if (!action || action.type === "noop") return false;
  const base = action.base ?? "WETH", view = marketViews(obs).find(v => v.base === base);
  if (!view) return false;
  const legs = action.type === "bundle" ? action.actions : [action];
  const venues = legs.map((leg: any) => view.venues.find(v => v.swapType === leg.type)?.protocol ?? "unknown");
  const dir = action.type === "bundle" ? "buy:${venues[0]}->sell:${venues[1]}" : action.tokenIn === "USDC" ? "buy" : "sell";
  const key = `${base}:${dir}:${venues.join("+")}`;
  const old = state.get(key);
  if (old?.block === block) return old.count >= params.persistBlocks;
  const count = old?.block === block - 1 ? old.count + 1 : 1;
  state.set(key, { block, count }); return count >= params.persistBlocks;
}
export function decideWithParams(obs: AgentObservation, params: DeltaParams, state: PersistState): AgentAction | Record<string, unknown> | null {
  try { const action = chooseAction(obs, params) ?? { type: "noop", reason: "no funded venue gap" }; return persistenceGate(obs, params, state, action) ? action : { type: "noop", reason: "gap has not persisted" }; }
  catch { return { type: "noop", reason: "invalid observation" }; }
}
export function decide(obs: AgentObservation): AgentAction | Record<string, unknown> | null { return decideWithParams(obs, PARAMS, persistence); }
