/**
 * Pure M0 planner. Call once per block and persist the returned (JSON-safe) state.
 * Submit ALL returned actions and persist state together; if submission is discarded, retain
 * the old state. Run M0 before inventory bands, reserving its input and excluding its signed
 * position.baseUnits (and pending order) from other modules. Only one M0 position is open.
 *
 * AgentObservation has no pending-tx field: the caller must supply its observed count via
 * params.pendingOwnTxs. Missing/invalid counts fail closed. While an order awaits settlement,
 * the caller must isolate that base from other modules: balance deltas attribute its fill.
 * A zero pending count on a later block means the submitted order has settled or been dropped.
 * No RPC, clocks, environment reads, module-local memory, or ctx calls occur here.
 *
 * Typed swaps only support quote-relative slippage (SDK re-quotes at execution time). We derive
 * a target min-out from FAIR, then translate it against a conservative CP output estimate.
 * This approximates, but CANNOT guarantee, an absolute fair floor if the runtime quote changes.
 * Curve is not CP and is used only as corroborating evidence, never as an execution venue.
 */
import type { AgentObservation } from "@eris/sdk/types.js";
import { canFund } from "../lib/affordable.js";
import type { AgentVenue, MarketView } from "../lib/markets.js";

export const BPS = 10_000;
export const USDC_DECIMALS = 6;
export const WEI_PER_ETH = 1e18;
export const WHALE_EDGE_BPS = 350;
export const WHALE_DEPTH_FACTOR = 0.8;
export const WHALE_FAIR_MOVE_MAX_BPS = 50;
export const WHALE_PEER_DEVIATION_MAX_BPS = 100;
export const WHALE_MIN_PEERS = 1;
export const WHALE_FAIR_SLIPPAGE_BPS = 0;
export const WHALE_EXIT_BPS = 0;
export const BID_RIVAL_NUMERATOR = 6n;
export const BID_RIVAL_DENOMINATOR = 5n;
export const BID_TIE_WEI = 1n;
export const BID_PROFIT_SHARE = 0.30;
export const BID_MAX_WEI = 100_000_000_000n;
export const BID_GAS_UNITS = 140_000;
export const INCIDENT_LOOKBACK_BLOCKS = 2;
export const INCIDENT_FAIR_CHANGE_BPS = 100;
export const INCIDENT_ENTRY_MIN_BLOCKS = 1;
export const INCIDENT_ENTRY_MAX_BLOCKS = 3;
export const INCIDENT_SKEW_FRACTION = 0.4;
export const INCIDENT_FAIR_SLIPPAGE_BPS = 60;
export const INCIDENT_EXIT_BPS = 40;
export const TYPED_SLIPPAGE_MAX_BPS = 1000;
export const FALLBACK_DEPTH_USD = 750_000;
export const MIN_TRADE_USD = 1;
export const PRICE_EPSILON_BPS = 1e-8;

export type M0Mode = "whale" | "incident";
export type M0Side = "buy" | "sell";
export type M0Params = {
  mode?: M0Mode | "both"; // default both; exits run even if entries are disabled
  pendingOwnTxs: number;
  /** Optional reservations by earlier modules; these are clamped to observed balances. */
  freeUsdcUnits?: string;
  freeBaseUnits?: Record<string, string>;
};
export type M0Action = {
  type: "swap" | "balancerSwap";
  base: string;
  tokenIn: string;
  amountIn: string;
  slippageBps: number;
  maxPriorityFeePerGasWei: string;
};
type WhaleEvent = { firstBlock: number; accepted: boolean; attempted: boolean };
type IncidentEvent = { firstBlock: number; side: M0Side; attempted: boolean };
export type M0Position = {
  tag: string;
  mode: M0Mode;
  base: string;
  /** Actual signed deviation: positive = bought base; negative = sold existing base. */
  baseUnits: string;
};
type Order = {
  phase: "entry" | "exit";
  beforeBaseUnits: string;
  side: M0Side;
  /** Pending inventory reservation, not a confirmed fill. */
  expectedBaseUnits: string;
};
export type M0State = {
  runId: string;
  epochIndex?: number;
  lastBlock: number;
  v0: number;
  anchors: Record<string, string>;
  fairTrail: Record<string, Array<{ block: number; fair: number }>>;
  whales: Record<string, WhaleEvent>;
  incidents: Record<string, IncidentEvent>;
  position?: M0Position;
  order?: Order;
};
export type M0Log = {
  reason: string;
  tag?: string;
  edgeBps?: number;
  optimalInput?: number;
  expectedProfitUsd?: number;
  modelOutUnits?: string;
  fairMinOutUnits?: string;
  effectiveMinOutUnits?: string;
};
export type M0Plan = { actions: M0Action[]; state: M0State; log: M0Log[] };

function positive(n: number): boolean { return Number.isFinite(n) && n > 0; }
function units(n: number, decimals: number): bigint {
  return positive(n) ? BigInt(Math.floor(n * 10 ** decimals)) : 0n;
}
function minBig(a: bigint, b: bigint): bigint { return a < b ? a : b; }
function balance(obs: AgentObservation, base: string): bigint {
  return BigInt(base === "WETH" ? obs.balances.wethWei : obs.baseBalances?.[base] ?? "0");
}
function available(obs: AgentObservation, base: string, p: M0Params): bigint {
  const held = base === "USDC" ? BigInt(obs.balances.usdcUnits) : balance(obs, base);
  const raw = base === "USDC" ? p.freeUsdcUnits : p.freeBaseUnits?.[base];
  const free = raw === undefined ? held : minBig(held, BigInt(raw));
  return free > 0n ? free : 0n;
}
function spot(v: AgentVenue, side: M0Side): number {
  const a = 1 - v.feeBps / BPS;
  return side === "buy" ? (v.buyPrice ?? v.price / a) : (v.sellPrice ?? v.price * a);
}
function edge(view: MarketView, v: AgentVenue, side: M0Side): number {
  return (side === "buy" ? view.fair / spot(v, side) - 1 : spot(v, side) / view.fair - 1) * BPS;
}
function validVenue(v: AgentVenue): boolean {
  return positive(v.price) && Number.isFinite(v.feeBps) && v.feeBps >= 0 &&
    v.feeBps < BPS && positive(spot(v, "buy")) && positive(spot(v, "sell"));
}

/** Effective quote-side reserve. Uniswap L gives a local virtual CP reserve, not full-range TVL. */
export function m0DepthUsd(obs: AgentObservation, view: MarketView, v: AgentVenue): number {
  let depth: number;
  if (v.protocol === "uniswap") {
    const pool = view.base === "WETH" ? obs.protocols.uniswap?.pool :
      obs.protocols.uniswap?.markets?.[`${view.base}/USDC`];
    depth = Number(pool?.liquidity) * Math.sqrt(v.price * 10 ** (USDC_DECIMALS - view.baseDecimals)) /
      10 ** USDC_DECIMALS;
  } else {
    const amm = v.protocol === "balancer" ? obs.protocols.balancer : obs.protocols.curve;
    const slice = view.base === "WETH" ? amm : amm?.markets?.[`${view.base}/USDC`];
    depth = Number(slice?.reserves?.usdc) / 10 ** USDC_DECIMALS;
  }
  // Explicit zero depth is unusable. Only missing/non-finite depth gets the memo's fallback.
  return Number.isFinite(depth) && depth >= 0 ? depth : FALLBACK_DEPTH_USD;
}

/** Input/output in human token units; the derivative of fair-valued profit is zero at U*. */
export function m0Cpmm(view: MarketView, v: AgentVenue, side: M0Side, depthUsd: number) {
  const a = 1 - v.feeBps / BPS;
  const reserve = depthUsd * WHALE_DEPTH_FACTOR / (side === "buy" ? 1 : v.price);
  const price = spot(v, side);
  const ratio = side === "buy" ? view.fair / price : price / view.fair;
  const optimalInput = Math.max(0, reserve / a * (Math.sqrt(ratio) - 1));
  const output = (input: number) => reserve > 0
    ? (side === "buy" ? input / price : input * price) / (1 + a * input / reserve) : 0;
  const inputForOutput = (out: number) => {
    const linearInput = side === "buy" ? out * price : out / price;
    const denominator = 1 - a * linearInput / reserve;
    return denominator > 0 ? linearInput / denominator : Number.POSITIVE_INFINITY;
  };
  return { optimalInput, output, inputForOutput, reserve, a, price };
}

/** No default-fee floor: it must not override the profit or 100-gwei cap. ETH fair prices gas. */
export function m0Bid(obs: AgentObservation, profitUsd: number): string {
  const ethFair = obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
  if (!positive(ethFair) || !positive(profitUsd)) return "0";
  const budget = BigInt(Math.floor(BID_PROFIT_SHARE * profitUsd / ethFair / BID_GAS_UNITS * WEI_PER_ETH));
  const rival = BigInt(obs.competition?.maxCompetitorPriorityFeeWei ?? "0");
  const needed = rival * BID_RIVAL_NUMERATOR / BID_RIVAL_DENOMINATOR + BID_TIE_WEI;
  return minBig(minBig(needed, budget), minBig(BID_MAX_WEI, BigInt(obs.limits.maxPriorityFeePerGasWei))).toString();
}

/** Round DOWN the slippage allowance, so the modeled effective minimum is never below fair's. */
export function m0FairSlippage(modelOut: bigint, fairMinOut: bigint): number | null {
  if (modelOut <= 0n || fairMinOut <= 0n || modelOut < fairMinOut) return null;
  return Math.min(TYPED_SLIPPAGE_MAX_BPS, Number((modelOut - fairMinOut) * BigInt(BPS) / modelOut));
}

function initialState(obs: AgentObservation, views: readonly MarketView[], block: number): M0State {
  return {
    runId: obs.runId, ...(obs.epoch ? { epochIndex: obs.epoch.index } : {}), lastBlock: block,
    v0: positive(obs.inventory.valueUsdc) ? obs.inventory.valueUsdc : 0,
    anchors: Object.fromEntries(views.map(v => [v.base, balance(obs, v.base).toString()])),
    fairTrail: {}, whales: {}, incidents: {},
  };
}

/** First detection latches the whale gate until the edge disappears, including while pending.
 * One attempted entry per episode: a failed fill cannot turn a stale dislocation into a new one.
 * Cold starts establish a baseline; they cannot prove freshness. Duplicate calls are no-ops.
 * Forward gaps, backwards blocks, run/epoch changes reset ALL state (a new epoch contract).
 */
export function m0Plan(
  obs: AgentObservation, views: readonly MarketView[], previous: M0State | null | undefined,
  params: M0Params,
): M0Plan {
  const block = Number(obs.blockNumber);
  if (!Number.isSafeInteger(block) || block < 0) throw new Error("M0 requires an integer blockNumber");
  const sameEpoch = previous?.runId === obs.runId && previous?.epochIndex === obs.epoch?.index;
  if (previous && sameEpoch && block === previous.lastBlock) {
    return { actions: [], state: structuredClone(previous), log: [{ reason: "duplicate block" }] };
  }
  const reset = !previous || !sameEpoch || block !== previous.lastBlock + 1;
  const state = reset ? initialState(obs, views, block) : structuredClone(previous);
  const log: M0Log[] = reset ? [{ reason: "epoch reset / freshness baseline" }] : [];
  const result: M0Plan = { actions: [], state, log };
  const pending = !Number.isSafeInteger(params.pendingOwnTxs) || params.pendingOwnTxs !== 0;
  const oldTrails = state.fairTrail;
  state.fairTrail = {};
  const currentWhales: M0State["whales"] = {};
  const usable = views.filter(v => positive(v.fair));

  // Reconcile actual inventory only after the caller observes no outstanding own transaction.
  if (!pending && state.order && state.position) {
    const order = state.order;
    const delta = balance(obs, state.position.base) - BigInt(order.beforeBaseUnits);
    const signedFill = order.side === "buy" ? (delta > 0n ? delta : 0n) : (delta < 0n ? delta : 0n);
    if (order.phase === "entry") state.position.baseUnits = signedFill.toString();
    else {
      const old = BigInt(state.position.baseUnits);
      // Never reverse a tag when a buy-to-cover receives slightly more base than needed.
      state.position.baseUnits = (old > 0n ? (old + signedFill > 0n ? old + signedFill : 0n) :
        (old + signedFill < 0n ? old + signedFill : 0n)).toString();
    }
    log.push({ reason: signedFill === 0n ? "order settled without observed fill" : "inventory reconciled",
      tag: state.position.tag });
    delete state.order;
    if (BigInt(state.position.baseUnits) === 0n) delete state.position;
  }

  for (const view of usable) {
    const trail = oldTrails[view.base] ?? [];
    const last = trail.at(-1);
    const old = trail.at(-INCIDENT_LOOKBACK_BLOCKS);
    state.fairTrail[view.base] = [...trail, { block, fair: view.fair }].slice(-INCIDENT_LOOKBACK_BLOCKS);
    // A missing market sample does not become a two-block fair observation later.
    if (old && last && old.block === block - INCIDENT_LOOKBACK_BLOCKS && last.block === block - 1 &&
        !state.incidents[view.base] &&
        Math.abs(view.fair / old.fair - 1) * BPS >= INCIDENT_FAIR_CHANGE_BPS) {
      state.incidents[view.base] = {
        firstBlock: last.fair !== old.fair ? last.block : block,
        side: view.fair > old.fair ? "buy" : "sell", attempted: false,
      };
    }
    for (const venue of view.venues.filter(validVenue)) for (const side of ["buy", "sell"] as const) {
      if (edge(view, venue, side) < WHALE_EDGE_BPS) continue;
      const key = `${view.base}:${venue.protocol}:${side}`;
      const existing = state.whales[key];
      if (existing) { currentWhales[key] = existing; continue; }
      const peers = view.venues.filter(v => v.protocol !== venue.protocol && validVenue(v));
      const accepted = !reset && last?.block === block - 1 &&
        Math.abs(view.fair / last.fair - 1) * BPS <= WHALE_FAIR_MOVE_MAX_BPS &&
        peers.length >= WHALE_MIN_PEERS && peers.every(v =>
          Math.abs(v.price / view.fair - 1) * BPS <= WHALE_PEER_DEVIATION_MAX_BPS);
      currentWhales[key] = { firstBlock: block, accepted, attempted: false };
      log.push({ reason: accepted ? "fresh whale accepted" : "fresh whale rejected", tag: key });
    }
  }
  state.whales = currentWhales;
  state.lastBlock = block;
  if (pending) { log.push({ reason: "pending own transactions / unknown pending count" }); return result; }

  type Candidate = { view: MarketView; venue: AgentVenue; side: M0Side; mode: M0Mode; event?: WhaleEvent | IncidentEvent };
  const candidates: Candidate[] = [];
  if (state.position) {
    const view = usable.find(v => v.base === state.position!.base);
    if (view) for (const venue of view.venues) candidates.push({ view, venue,
      side: BigInt(state.position.baseUnits) > 0n ? "sell" : "buy", mode: state.position.mode });
  } else {
    for (const view of usable) for (const venue of view.venues) {
      if (params.mode !== "incident") for (const side of ["buy", "sell"] as const) {
        const event = state.whales[`${view.base}:${venue.protocol}:${side}`];
        if (event?.accepted && !event.attempted) candidates.push({ view, venue, side, mode: "whale", event });
      }
      const incident = state.incidents[view.base];
      if (params.mode !== "whale" && incident && !incident.attempted &&
          block - incident.firstBlock >= INCIDENT_ENTRY_MIN_BLOCKS &&
          block - incident.firstBlock <= INCIDENT_ENTRY_MAX_BLOCKS && edge(view, venue, incident.side) > 0) {
        candidates.push({ view, venue, side: incident.side, mode: "incident", event: incident });
      }
    }
  }
  // Unwinds first by construction; whale entries precede incident, then the strongest net edge.
  candidates.sort((a, b) => (a.mode === b.mode ? 0 : a.mode === "whale" ? -1 : 1) ||
    edge(b.view, b.venue, b.side) - edge(a.view, a.venue, a.side));
  for (const { view, venue, side, mode, event } of candidates) {
    if (venue.protocol === "curve" || !validVenue(venue) || !obs.enabledProtocols.includes(venue.protocol)) continue;
    const tokenIn = side === "buy" ? "USDC" : view.base;
    // canFund's legacy base dust is 18-decimal-specific. Use its USDC check; for bases use
    // the decimal-aware USD floor below, so e.g. an 8-decimal WBTC balance remains tradable.
    if (tokenIn === "USDC" && !canFund(obs, tokenIn)) continue;
    const depth = m0DepthUsd(obs, view, venue);
    if (!positive(depth)) continue;
    const model = m0Cpmm(view, venue, side, depth);
    const exiting = state.position !== undefined;
    let input = model.optimalInput;
    const tolerance = exiting ? (mode === "whale" ? WHALE_EXIT_BPS : INCIDENT_EXIT_BPS) :
      (mode === "whale" ? WHALE_FAIR_SLIPPAGE_BPS : INCIDENT_FAIR_SLIPPAGE_BPS);
    if (exiting) {
      const tagged = Math.abs(Number(state.position!.baseUnits)) / 10 ** view.baseDecimals;
      input = side === "sell" ? tagged : model.inputForOutput(tagged);
      // Split an unwind into tranches whose average execution meets the exit price.
      const acceptable = view.fair * (1 + (side === "buy" ? tolerance : -tolerance) / BPS);
      const priceCapacity = model.reserve / model.a *
        ((side === "buy" ? acceptable / model.price : model.price / acceptable) - 1);
      input = Math.min(input, Math.max(0, priceCapacity));
    } else if (mode === "incident") {
      // Cap total absolute base skew at current fair against the opening basket, not just spend.
      const otherSkew = usable.filter(v => v.base !== view.base).reduce((sum, v) => sum +
        Math.abs(Number(balance(obs, v.base) - BigInt(state.anchors[v.base] ?? balance(obs, v.base).toString()))) /
          10 ** v.baseDecimals * v.fair, 0);
      const room = Math.max(0, state.v0 * INCIDENT_SKEW_FRACTION - otherSkew);
      const skew = Number(balance(obs, view.base) - BigInt(state.anchors[view.base] ?? balance(obs, view.base).toString())) /
        10 ** view.baseDecimals * view.fair;
      const baseRoom = Math.max(0, room + (side === "buy" ? -skew : skew)) / view.fair;
      input = Math.min(input, side === "buy" ? model.inputForOutput(baseRoom) : baseRoom);
    }
    const decimalsIn = side === "buy" ? USDC_DECIMALS : view.baseDecimals;
    const decimalsOut = side === "buy" ? view.baseDecimals : USDC_DECIMALS;
    // Cover rounding goes up by at most one quote unit, so a completed short cannot leave
    // an untradeable base remainder that blocks the next whale. The exit-price check still runs.
    const desired = exiting && side === "buy" && positive(input)
      ? BigInt(Math.ceil(input * 10 ** decimalsIn)) : units(input, decimalsIn);
    const amount = minBig(desired, available(obs, tokenIn, params));
    input = Number(amount) / 10 ** decimalsIn;
    if (amount <= 0n || (!exiting && input * (side === "buy" ? 1 : view.fair) < MIN_TRADE_USD)) continue;
    const output = model.output(input);
    const executionPrice = side === "buy" ? input / output : output / input;
    if (exiting && (mode === "incident" ? Math.abs(executionPrice / view.fair - 1) * BPS >
        INCIDENT_EXIT_BPS + PRICE_EPSILON_BPS :
      (side === "sell" ? executionPrice < view.fair : executionPrice > view.fair))) continue;
    const modelOut = units(output, decimalsOut);
    const fairOutput = (side === "buy" ? input / view.fair : input * view.fair) * (1 - tolerance / BPS);
    // Round the fair target down to native token units, as the SDK does for quote minima.
    const fairMinOut = units(fairOutput, decimalsOut);
    const slippageBps = m0FairSlippage(modelOut, fairMinOut);
    if (slippageBps === null) continue;
    const profit = side === "buy" ? output * view.fair - input : output - input * view.fair;
    if (!exiting && !positive(profit)) continue;
    const tag = state.position?.tag ?? `m0:${mode}:${view.base}:${block}`;
    result.actions.push({ type: venue.protocol === "uniswap" ? "swap" : "balancerSwap", base: view.base,
      tokenIn, amountIn: amount.toString(), slippageBps, maxPriorityFeePerGasWei: m0Bid(obs, Math.max(0, profit)) });
    if (event) event.attempted = true;
    if (!state.position) state.position = { tag, mode, base: view.base, baseUnits: "0" };
    state.order = { phase: exiting ? "exit" : "entry", side,
      beforeBaseUnits: balance(obs, view.base).toString(),
      expectedBaseUnits: (side === "buy" ? modelOut : -amount).toString() };
    log.push({ reason: exiting ? "exit" : "entry", tag, edgeBps: edge(view, venue, side),
      optimalInput: model.optimalInput, expectedProfitUsd: profit, modelOutUnits: modelOut.toString(),
      fairMinOutUnits: fairMinOut.toString(),
      effectiveMinOutUnits: (modelOut * BigInt(BPS - slippageBps) / BigInt(BPS)).toString() });
    return result;
  }
  log.push({ reason: state.position ? "hold tagged inventory" : "no eligible entry" });
  return result;
}
