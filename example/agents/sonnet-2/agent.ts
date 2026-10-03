/**
 * sonnet-2: multi-arb's entry logic with a priority-fee bid priced from each opportunity.
 *
 * Blocks are ordered by priority fee, highest first, and the reference clones all bid the same
 * default (0.10 gwei). Entry decisions follow multi-arb (same thresholds, sizing and legs); what
 * differs is the fee. The bid is a bounded premium over the default:
 *
 *   premium budget = BID_SHARE x expected profit        (expected profit = notional x fee-net edge x CAPTURE)
 *   bid            = default + budget / (gas per wei of bid)
 *   clamped to [default x (1 + STEP), obs cap], to what the ETH balance can reserve, and to what is
 *   left of the epoch's premium budget. If the budget cannot even pay the minimum step, bid the default.
 *
 * Below the minimum step a bump buys nothing against a field fixed at the default, and above the cap
 * nothing can be bid, so the schedule is a floor (just ahead of the crowd) plus a ramp that reaches
 * the cap only on opportunities big enough to pay for it. Every constant is an assumption, not a
 * measurement: GAS_PER_LEG, CAPTURE_BPS and BID_SHARE_BPS have not been calibrated against a run.
 */
import type { AgentAction, AgentObservation } from "@eris/sdk";
import { marketViews, type MarketView } from "../lib/markets.js";

export const DEFAULT_PARAMS = {
  // entry (identical to multi-arb)
  SAFETY_MARGIN_BPS: 50,
  MIN_SIZE_BPS: 250,
  MAX_SIZE_BPS: 2500,
  SPREAD_GAIN: 200_000,
  GAP_GAIN: 200_000,
  LEG_SLIPPAGE_BPS: 120,
  SINGLE_SLIPPAGE_BPS: 75,
  // bid
  CAPTURE_BPS: 5000, // share of the fee-net edge assumed to be realised (impact, contention)
  BID_SHARE_BPS: 2000, // share of expected profit that may be spent on priority premium; 0 = never bid
  BID_STEP_BPS: 5000, // smallest premium worth paying, as a share of the default fee
  EPOCH_PREMIUM_BUDGET_USDC: 50, // cumulative premium over the default fee per epoch
  GAS_PER_LEG: 200_000, // gas used by one swap (estimate)
  // guard
  INVENTORY_BAND_BPS: 6000, // single-leg trades may not take a base beyond initial +/- this share
};
export type Params = typeof DEFAULT_PARAMS;

// Gas limit the runtime assumes per tx; the node reserves limit x fee up front.
const GAS_RESERVE_PER_TX = 1_500_000n;
const INITIAL_BASE: Record<string, bigint> = {
  WETH: 8n * 10n ** 18n,
  WBTC: 40_000_000n,
};

type Venue = MarketView["venues"][number];
type TwoLeg = {
  base: string;
  spread: number;
  cheap: Venue;
  rich: Venue;
  usdcIn: bigint;
  baseSell: bigint;
};
type SingleLeg = {
  base: string;
  venue: Venue;
  gapAbs: number;
  tokenIn: string;
  amountIn: bigint;
  notionalUsdc: number;
};

export type BidState = {
  lastBlock: number;
  lastRemaining: number | undefined;
  committedUsdc: number; // premium of blocks already decided
  block: number; // block the pending premium belongs to
  pendingUsdc: number; // premium decided for `block` (replaced, not added, if that block is decided again)
};
export function newState(): BidState {
  return {
    lastBlock: -1,
    lastRemaining: undefined,
    committedUsdc: 0,
    block: -1,
    pendingUsdc: 0,
  };
}
const globalState = newState();

function syncState(state: BidState, obs: AgentObservation): number {
  const block = Number(obs.blockNumber);
  const remaining = obs.blocksRemaining;
  const rewound =
    (Number.isFinite(block) && block < state.lastBlock) ||
    (remaining !== undefined &&
      state.lastRemaining !== undefined &&
      remaining > state.lastRemaining);
  if (rewound) Object.assign(state, newState());
  if (Number.isFinite(block)) {
    if (block !== state.block) {
      state.committedUsdc += state.pendingUsdc;
      state.pendingUsdc = 0;
      state.block = block;
    }
    state.lastBlock = block;
  }
  state.lastRemaining = remaining;
  return state.committedUsdc;
}

function bigOr(v: string | undefined, fallback: bigint): bigint {
  try {
    return v === undefined ? fallback : BigInt(v);
  } catch {
    return fallback;
  }
}

/** Priority fee for one decision. Returns the default fee (premium 0) unless a bump pays for itself. */
export function priorityBid(
  p: Params,
  i: {
    fee: bigint;
    cap: bigint;
    ethUsd: number;
    legs: number;
    expectedProfitUsdc: number;
    budgetLeftUsdc: number;
    ethWei?: bigint;
  },
): { bidWei: bigint; premiumUsdc: number } {
  const none = { bidWei: i.fee, premiumUsdc: 0 };
  if (i.cap <= i.fee || p.BID_SHARE_BPS <= 0) return none;
  // USDC cost of one wei/gas of bid across all legs
  const usdcPerWei = (i.legs * p.GAS_PER_LEG * 1e-18) * i.ethUsd;
  if (!(usdcPerWei > 0) || !Number.isFinite(usdcPerWei)) return none;
  const allow = Math.min(
    (p.BID_SHARE_BPS / 10000) * i.expectedProfitUsdc,
    i.budgetLeftUsdc,
  );
  if (!(allow > 0)) return none;
  let extra = Math.min(allow / usdcPerWei, Number(i.cap - i.fee));
  if (i.ethWei !== undefined) {
    const reserve = BigInt(i.legs) * GAS_RESERVE_PER_TX * 2n;
    const byEth = i.ethWei / reserve - i.fee;
    extra = Math.min(extra, byEth > 0n ? Number(byEth) : 0);
  }
  let step = (i.fee * BigInt(p.BID_STEP_BPS)) / 10000n;
  if (step < 1n) step = 1n;
  if (step > i.cap - i.fee) step = i.cap - i.fee;
  if (!(extra >= Number(step))) return none;
  const bump = BigInt(Math.floor(extra));
  return { bidWei: i.fee + bump, premiumUsdc: Number(bump) * usdcPerWei };
}

function toBase(amount: number, decimals: number): bigint {
  return BigInt(Math.max(0, Math.floor(amount * 10 ** decimals)));
}

// How much more of `view.base` a single-leg trade may take in the given direction without leaving
// the band around the initial inventory. Returns base units; null when no band applies.
function bandRoom(
  current: bigint,
  base: string,
  buying: boolean,
  bandBps: number,
): bigint | null {
  const initial = INITIAL_BASE[base];
  if (!initial || bandBps <= 0) return null;
  const band = (initial * BigInt(bandBps)) / 10000n;
  const room = buying ? initial + band - current : current - (initial - band);
  return room > 0n ? room : 0n;
}

export type Decision = {
  action: AgentAction | Record<string, unknown>;
  expectedProfitUsdc: number;
  premiumUsdc: number;
  bidWei: bigint;
};

export function decideWith(
  obs: AgentObservation,
  p: Params = DEFAULT_PARAMS,
  state: BidState = globalState,
): Decision {
  const noop =(reason: string): Decision => {
    state.pendingUsdc = 0;
    return {
      action: { type: "noop", reason },
      expectedProfitUsdc: 0,
      premiumUsdc: 0,
      bidWei: 0n,
    };
  };
  try {
    const spent = syncState(state, obs);
    const views = marketViews(obs);
    const usdcBal = BigInt(obs.balances.usdcUnits || "0");
    const feeStr = obs.limits.defaultPriorityFeePerGasWei;
    const fee = BigInt(feeStr);
    const cap = bigOr(obs.limits.maxPriorityFeePerGasWei, fee);
    const ethUsd = obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
    const ethWei =
      obs.balances.ethWei === undefined ? undefined : bigOr(obs.balances.ethWei, 0n);
    const budgetLeftUsdc = Math.max(0, p.EPOCH_PREMIUM_BUDGET_USDC - spent);
    const bid = (legs: number, notionalUsdc: number, edge: number) => {
      const expectedProfitUsdc = Math.max(
        0,
        notionalUsdc * edge * (p.CAPTURE_BPS / 10000),
      );
      return {
        expectedProfitUsdc,
        ...priorityBid(p, {
          fee,
          cap,
          ethUsd,
          legs,
          expectedProfitUsdc,
          budgetLeftUsdc,
          ethWei,
        }),
      };
    };
    const finish = (
      action: Decision["action"],
      b: ReturnType<typeof bid>,
    ): Decision => {
      state.pendingUsdc = b.premiumUsdc;
      return {
        action,
        expectedProfitUsdc: b.expectedProfitUsdc,
        premiumUsdc: b.premiumUsdc,
        bidWei: b.bidWei,
      };
    };

    // ---- 1) 2-leg cross-venue arbitrage (largest cross-venue spread) ----
    let bestTwo: TwoLeg | null = null;
    for (const view of views) {
      if (view.venues.length < 2) continue;
      let cheap = view.venues[0];
      let rich = view.venues[0];
      for (const v of view.venues) {
        if (v.price < cheap.price) cheap = v;
        if (v.price > rich.price) rich = v;
      }
      if (cheap.price <= 0 || rich.price <= 0) continue;
      const spread = rich.price / cheap.price - 1;
      const roundtripCost =
        (cheap.feeBps + rich.feeBps + p.SAFETY_MARGIN_BPS) / 10000;
      if (spread <= roundtripCost) continue;
      if (usdcBal <= 0n) continue;
      const netEdge = spread - roundtripCost;
      const sizeBps = Math.min(
        p.MAX_SIZE_BPS,
        Math.max(p.MIN_SIZE_BPS, Math.floor(netEdge * p.SPREAD_GAIN)),
      );
      const usdcIn = (usdcBal * BigInt(sizeBps)) / 10000n;
      if (usdcIn <= 0n) continue;
      const boughtBase = Number(usdcIn) / 1e6 / cheap.price;
      const baseSell = toBase(boughtBase * 0.98, view.baseDecimals);
      if (baseSell <= 0n) continue;
      if (!bestTwo || spread > bestTwo.spread)
        bestTwo = { base: view.base, spread, cheap, rich, usdcIn, baseSell };
    }
    if (bestTwo) {
      const t = bestTwo;
      const withBase = (a: Record<string, unknown>): Record<string, unknown> =>
        t.base === "WETH" ? a : { ...a, base: t.base };
      const b = bid(
        2,
        Number(t.usdcIn) / 1e6,
        t.spread - (t.cheap.feeBps + t.rich.feeBps) / 10000,
      );
      const bundle: Record<string, unknown> = {
        type: "bundle",
        actions: [
          withBase({
            type: t.cheap.swapType,
            tokenIn: "USDC",
            amountIn: t.usdcIn.toString(),
            slippageBps: p.LEG_SLIPPAGE_BPS,
          }),
          withBase({
            type: t.rich.swapType,
            tokenIn: t.base,
            amountIn: t.baseSell.toString(),
            slippageBps: p.LEG_SLIPPAGE_BPS,
          }),
        ],
        maxPriorityFeePerGasWei: b.bidWei.toString(),
      };
      return finish(bundle, b);
    }

    // ---- 2) single-leg: pull the (base, venue) most deviated from fair back toward fair ----
    let bestOne: SingleLeg | null = null;
    for (const view of views) {
      for (const venue of view.venues) {
        const gap = view.fair / venue.price - 1;
        const gapAbs = Math.abs(gap);
        if (gapAbs <= (venue.feeBps + p.SAFETY_MARGIN_BPS) / 10000) continue;
        const buyBase = gap > 0;
        const current = BigInt(view.baseBalanceWei || "0");
        const cap0 = buyBase ? usdcBal : current;
        if (cap0 <= 0n) continue;
        const sizeBps = Math.min(
          p.MAX_SIZE_BPS,
          Math.max(p.MIN_SIZE_BPS, Math.floor(gapAbs * p.GAP_GAIN)),
        );
        let amountIn = (cap0 * BigInt(sizeBps)) / 10000n;
        const room = bandRoom(current, view.base, buyBase, p.INVENTORY_BAND_BPS);
        if (room !== null) {
          if (buyBase) {
            const roomUsdc = BigInt(
              Math.floor((Number(room) / 10 ** view.baseDecimals) * venue.price * 1e6),
            );
            if (amountIn > roomUsdc) amountIn = roomUsdc;
          } else if (amountIn > room) amountIn = room;
        }
        if (amountIn <= 0n) continue;
        const notionalUsdc = buyBase
          ? Number(amountIn) / 1e6
          : (Number(amountIn) / 10 ** view.baseDecimals) * view.fair;
        if (!bestOne || gapAbs > bestOne.gapAbs)
          bestOne = {
            base: view.base,
            venue,
            gapAbs,
            tokenIn: buyBase ? "USDC" : view.base,
            amountIn,
            notionalUsdc,
          };
      }
    }
    if (!bestOne) return noop("no funded venue gap");
    const s = bestOne;
    const b = bid(1, s.notionalUsdc, s.gapAbs - s.venue.feeBps / 10000);
    const action: Record<string, unknown> = {
      type: s.venue.swapType,
      tokenIn: s.tokenIn,
      amountIn: s.amountIn.toString(),
      maxPriorityFeePerGasWei: b.bidWei.toString(),
      slippageBps: p.SINGLE_SLIPPAGE_BPS,
    };
    if (s.base !== "WETH") action.base = s.base;
    return finish(action, b);
  } catch {
    return noop("invalid observation");
  }
}

export function decide(
  obs: AgentObservation,
  ctx?: { log?: (entry: Record<string, unknown>) => void },
): AgentAction | Record<string, unknown> | null {
  const d = decideWith(obs);
  try {
    ctx?.log?.({
      reason:
        d.action.type === "noop"
          ? String((d.action as { reason?: string }).reason)
          : `${String(d.action.type)} bid ${d.bidWei} (premium ${d.premiumUsdc.toFixed(3)} USDC)`,
      signals: {
        expectedProfitUsdc: d.expectedProfitUsdc,
        premiumUsdc: d.premiumUsdc,
        premiumSpentUsdc: globalState.committedUsdc + globalState.pendingUsdc,
      },
    });
  } catch {
    /* logging must never break a decision */
  }
  return d.action;
}
