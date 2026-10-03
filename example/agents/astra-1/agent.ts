/**
 * astra-1, derived from multi-arb: bounded inventory, fair-price reversion.
 * Each decision emits ONE independently funded swap. Bundles are non-atomic;
 * estimated buy output must never be treated as already owned sell input.
 * No RPC, global mutable state, environment settings, or random decisions.
 */
import type { AgentAction, AgentObservation } from "@eris/sdk";
import { marketViews, type MarketView, type AgentVenue } from "../lib/markets.js";
import { canFund } from "../lib/affordable.js";

// Only tuning surface for LLM revisions. Impact/gas are conservative models,
// not exact execution quotes; the runtime quotes again before sending a swap.
export const PARAMS = {
  initialWeth: 8,
  initialWbtc: 0.4,
  inventoryBand: 0.20,
  stressInventoryBand: 0.08,
  inventoryPenaltyBps: 60,
  minMarginBps: 18,
  btcUncertaintyBps: 15, // history exposes WETH only, not BTC history
  shockMultiplier: 1.5,
  stressMoveBps: 75,
  maxGapBps: 2500,
  minNotionalUsd: 40,
  maxNotionalUsd: 800,
  stressMaxNotionalUsd: 300,
  cashReserveUsd: 8000,
  minGasEth: 0.02,
  minProfitUsd: 0.50,
  maxDepthFraction: 0.0025,
  minSlippageBps: 8,
  maxSlippageBps: 30,
  reduceOnlyBlocks: 24,
  stopBlocks: 6,
  minCompetitionSamples: 8,
  maxBidMultiple: 3,
  incrementalProfitBudget: 0.25,
} as const;

type Swap = Extract<AgentAction, { type: "swap" | "balancerSwap" | "curveSwap" }>;
type Candidate = { action: Swap; profit: number };

function positive(n: number): boolean { return Number.isFinite(n) && n > 0; }
function units(raw: string | undefined): bigint {
  return raw !== undefined && /^\d{1,78}$/.test(raw) ? BigInt(raw) : 0n;
}
function float(raw: string | undefined, decimals: number): number {
  return Number(units(raw)) / 10 ** decimals;
}
function toUnits(n: number, decimals: number): bigint {
  return positive(n) ? BigInt(Math.floor(n * 10 ** decimals)) : 0n;
}

// canFund's generic base dust floor uses 18 decimals. Normalize the 8-decimal
// BTC balance for that guard only; actual spend checks retain original units.
function funded(obs: AgentObservation, token: string, amount: bigint): boolean {
  const raw = token === "USDC" ? obs.balances.usdcUnits
    : token === "WETH" ? obs.balances.wethWei : obs.baseBalances?.WBTC;
  if (amount <= 0n || amount > units(raw)) return false;
  if (token !== "WBTC") return canFund(obs, token);
  return canFund({ ...obs, balances: {
    ...obs.balances, wethWei: (units(raw) * 10n ** 10n).toString(),
  } }, "WETH");
}

// Largest recent one-step ETH move, in bps. Include current observation even
// when history ends one block earlier. Missing history costs extra margin.
function recentMove(obs: AgentObservation): number {
  const prices = obs.history.slice(-6).map(h => h.fairPriceUsdcPerWeth);
  prices.push(obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth);
  if (prices.length < 3 || prices.some(p => !positive(p))) return 40;
  let move = 0;
  for (let i = 1; i < prices.length; i++)
    move = Math.max(move, Math.abs(prices[i] / prices[i - 1] - 1) * 10000);
  return move;
}

// Quote-side depth in USD. L / sqrt(10^(baseDecimals+6)) converts Uniswap's
// raw sqrt(token0*token1) units; multiply by sqrt(mid) for virtual USDC reserve,
// independently of token address ordering. This is local in-range depth, NOT
// a guarantee across tick crossings. Missing depth means skip that venue.
function depthUsd(obs: AgentObservation, view: MarketView, venue: AgentVenue): number {
  if (venue.protocol === "uniswap") {
    const pool = view.base === "WETH" ? obs.protocols.uniswap?.pool
      : obs.protocols.uniswap?.markets?.[`${view.base}/USDC`];
    return Number(units(pool?.liquidity)) * Math.sqrt(venue.price)
      / 10 ** ((view.baseDecimals + 6) / 2);
  }
  const amm = obs.protocols[venue.protocol];
  const slice = view.base === "WETH" ? amm : amm?.markets?.[`${view.base}/USDC`];
  // These reserves may be stale in this SDK. Use the smaller side and larger
  // impact coefficients; two-sided executable probes are also mandatory.
  return Math.min(float(slice?.reserves?.usdc, 6),
    float(slice?.reserves?.weth, view.baseDecimals) * venue.price);
}

function gasUnits(venue: AgentVenue): number {
  // Includes approval headroom; actual gas is not exposed in observations.
  return venue.protocol === "uniswap" ? 450000 : venue.protocol === "balancer" ? 550000 : 650000;
}

/** Bump only when a conservative incremental-fill model pays for extra gas.
 * Revert rate is an imperfect contention proxy, not proof bidding fixes it.
 */
export function selectFee(obs: AgentObservation, edgeUsd: number, gas: number, ethUsd: number): bigint {
  const limit = units(obs.limits.maxPriorityFeePerGasWei);
  const def = units(obs.limits.defaultPriorityFeePerGasWei);
  const normal = def < limit ? def : limit;
  const c = obs.competition;
  if (!c || c.recentSampleSize < PARAMS.minCompetitionSamples ||
      c.lastTxIndex === null || c.lastTxIndex < 3 ||
      !Number.isFinite(c.recentRevertRate) || c.recentRevertRate < 0.10 ||
      c.recentRevertRate > 1 || !positive(edgeUsd) || !positive(ethUsd)) return normal;
  const rival = units(c.maxCompetitorPriorityFeeWei);
  if (rival < normal) return normal;
  const target = rival + 1n;
  // A partial bid still losing ordering has no claimed incremental benefit.
  if (target > limit || target > normal * BigInt(PARAMS.maxBidMultiple)) return normal;
  const incrementalFill = Math.min(0.20, c.recentRevertRate * 0.5);
  const extraGasUsd = Number(target - normal) * gas * ethUsd / 1e18;
  return extraGasUsd < edgeUsd * incrementalFill * PARAMS.incrementalProfitBudget
    ? target : normal;
}

function candidate(obs: AgentObservation, view: MarketView, venue: AgentVenue,
  moveBps: number, remaining: number, ethUsd: number): Candidate | null {
  if (!obs.enabledProtocols.includes(venue.protocol) || !positive(venue.price) ||
      !Number.isFinite(venue.feeBps) || venue.feeBps < 0 || venue.feeBps >= 10000) return null;
  const depth = depthUsd(obs, view, venue);
  if (!positive(depth)) return null;
  const feeFactor = 1 - venue.feeBps / 10000;
  // Never infer Curve/Balancer executable prices from one-sided legacy mids.
  const buyPrice = venue.protocol === "uniswap" ? venue.price / feeFactor : venue.buyPrice;
  const sellPrice = venue.protocol === "uniswap" ? venue.price * feeFactor : venue.sellPrice;
  if (buyPrice === undefined || sellPrice === undefined || !positive(buyPrice) ||
      !positive(sellPrice) || buyPrice < sellPrice) return null;
  if (Math.abs(view.fair / venue.price - 1) * 10000 > PARAMS.maxGapBps) return null;
  const buy = view.fair / buyPrice - 1 > 0;
  const rawEdge = buy ? view.fair / buyPrice - 1 : sellPrice / view.fair - 1;
  if (!positive(rawEdge)) return null;

  const initial = view.base === "WETH" ? PARAMS.initialWeth : PARAMS.initialWbtc;
  const held = float(view.baseBalanceWei, view.baseDecimals);
  const stress = moveBps >= PARAMS.stressMoveBps;
  const band = stress ? PARAMS.stressInventoryBand : PARAMS.inventoryBand;
  const direction = buy ? 1 : -1;
  const skew = (held / initial - 1) * direction;
  const reducing = skew < -0.001;
  const late = remaining <= PARAMS.reduceOnlyBlocks;
  if (late && !reducing) return null;
  // Late trades approach initial inventory, never intentionally cross it.
  // Outside the band, no forced trade at a bad price: only profitable reduction.
  const roomBase = late ? Math.abs(initial - held)
    : buy ? initial * (1 + band) - held : held - initial * (1 - band);
  if (roomBase <= 0) return null;
  const marginBps = PARAMS.minMarginBps + moveBps * PARAMS.shockMultiplier
    + (view.base === "WBTC" ? PARAMS.btcUncertaintyBps : 0)
    + Math.max(0, skew / band) * PARAMS.inventoryPenaltyBps;
  const slippageBps = Math.min(PARAMS.maxSlippageBps,
    Math.max(PARAMS.minSlippageBps, Math.floor(rawEdge * 10000 / 5)));
  const edge = rawEdge - (marginBps + slippageBps) / 10000;
  if (!positive(edge)) return null;

  const impactFactor = venue.protocol === "uniswap" ? 1.5 : venue.protocol === "balancer" ? 2.5 : 4;
  const cash = float(obs.balances.usdcUnits, 6);
  // Optimistic output for BUY room: even a fill at the small-probe price fits.
  // Extra price improvement can still move the realized band.
  const roomUsd = roomBase * (buy ? buyPrice : view.fair);
  const spendableUsd = buy ? Math.max(0, cash - PARAMS.cashReserveUsd) : held * view.fair;
  const cap = Math.min(roomUsd, spendableUsd, depth * PARAMS.maxDepthFraction,
    stress ? PARAMS.stressMaxNotionalUsd : PARAMS.maxNotionalUsd);
  // Maximize n * (edge - impactFactor*n/depth), subject to inventory/cash caps.
  const notional = Math.min(cap, edge * depth / (2 * impactFactor));
  if (notional < PARAMS.minNotionalUsd) return null;
  const tokenIn = buy ? "USDC" : view.base;
  const amount = toUnits(buy ? notional : notional / view.fair, buy ? 6 : view.baseDecimals);
  if (!funded(obs, tokenIn, amount)) return null;
  const gross = notional * (edge - impactFactor * notional / depth);
  const gas = gasUnits(venue);
  const priority = selectFee(obs, gross, gas, ethUsd);
  const gasEth = Number(priority) * gas / 1e18;
  const profit = gross - gasEth * ethUsd;
  if (!Number.isFinite(profit) || profit < PARAMS.minProfitUsd ||
      float(obs.balances.ethWei, 18) < PARAMS.minGasEth + gasEth) return null;
  return {
    profit,
    action: {
      type: venue.swapType, tokenIn, amountIn: amount.toString(), slippageBps,
      maxPriorityFeePerGasWei: priority.toString(),
      ...(view.base === "WETH" ? {} : { base: view.base }),
    },
  };
}

export function decide(obs: AgentObservation): AgentAction {
  const noop = (reason: string): AgentAction => ({ type: "noop", reason });
  // round is not reliably elapsed epoch count. Never guess an end from it.
  const clocks = [obs.blocksRemaining, obs.dayBlocksRemaining]
    .filter((n): n is number => n !== undefined);
  if (clocks.length === 0 || clocks.some(n => !Number.isFinite(n) || n < 0))
    return noop("unknown epoch end");
  const remaining = Math.min(...clocks);
  if (remaining <= PARAMS.stopBlocks) return noop("settlement buffer");
  const ethUsd = obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
  if (!positive(ethUsd) || float(obs.balances.ethWei, 18) < PARAMS.minGasEth)
    return noop("invalid reference or low gas");
  const move = recentMove(obs);
  let best: Candidate | null = null;
  for (const view of marketViews(obs)) {
    // Only initially endowed, terminal-valued bases; ignore launch/discovered
    // pools, lending/oracle dislocations and unknown token metadata entirely.
    if (view.base !== "WETH" && view.base !== "WBTC") continue;
    const decimals = view.base === "WETH" ? 18 : 8;
    if (obs.baseDecimals?.[view.base] !== undefined && obs.baseDecimals[view.base] !== decimals) continue;
    view.baseDecimals = decimals; // BTC fallback must be 8, not generic 18
    if (!positive(view.fair)) continue;
    for (const venue of view.venues) {
      const next = candidate(obs, view, venue, move, remaining, ethUsd);
      if (next && (!best || next.profit > best.profit)) best = next;
    }
  }
  return best?.action ?? noop("no funded edge after impact, risk and gas");
}
