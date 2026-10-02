import type { AgentAction, AgentObservation } from "@eris/sdk";
import { affordable, canFund } from "../lib/affordable.js";
import { marketViews, type MarketView } from "../lib/markets.js";

const DEFAULT_PARAMS = {
  marginBps: 45,
  adverseBps: 35,
  sizeGain: 200_000,
  maxSizeBps: 1_500,
  inventoryToleranceBps: 2_000,
  endgameBlocks: 12,
  slippageBps: 80,
  sellReserveBps: 10_000,
} as const;
type GammaParams = { -readonly [K in keyof typeof DEFAULT_PARAMS]: number };

function parseParams(raw: string | undefined): GammaParams {
  const result: GammaParams = { ...DEFAULT_PARAMS };
  if (!raw) return result;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const key of Object.keys(DEFAULT_PARAMS) as Array<keyof GammaParams>) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) continue;
      if (key === "maxSizeBps" && candidate > 10_000) continue;
      if (key === "inventoryToleranceBps" && candidate >= 10_000) continue;
      if (key === "slippageBps" && candidate > 5_000) continue;
      if (key === "sellReserveBps" && candidate > 10_000) continue;
      result[key] = candidate;
    }
  } catch { /* invalid JSON uses defaults */ }
  return result;
}
export const PARAMS: GammaParams = parseParams(process.env.ASCON_GAMMA_PARAMS);
export { parseParams as parseGammaParams };
const INITIAL: Record<string, { amount: bigint; decimals: number }> = {
  WETH: { amount: 8n * 10n ** 18n, decimals: 18 },
  WBTC: { amount: 4n * 10n ** 7n, decimals: 8 },
};

type Candidate = { edge: number; action: AgentAction };
function baseBalance(obs: AgentObservation, base: string): bigint {
  return base === "WETH" ? BigInt(obs.balances.wethWei || "0") : BigInt(obs.baseBalances?.[base] ?? "0");
}
function bpsAmount(amount: bigint, bps: number): bigint { return amount * BigInt(Math.floor(bps)) / 10_000n; }
function floatToBase(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value * 10 ** decimals));
}
function bounds(base: string, params: GammaParams) {
  const initial = INITIAL[base];
  if (!initial) return null;
  const delta = bpsAmount(initial.amount, params.inventoryToleranceBps);
  return { initial: initial.amount, low: initial.amount - delta, high: initial.amount + delta, decimals: initial.decimals };
}
function afterBuySize(current: bigint, maxBuy: bigint, band: ReturnType<typeof bounds>): bigint {
  if (!band || current >= band.high) return 0n;
  const room = band.high - current;
  return maxBuy < room ? maxBuy : room;
}
function afterSellSize(current: bigint, maxSell: bigint, band: ReturnType<typeof bounds>, endgame: boolean): bigint {
  if (!band) return 0n;
  const floor = endgame ? band.initial : band.low;
  if (current <= floor) return 0n;
  const room = current - floor;
  return maxSell < room ? maxSell : room;
}

/** Pure strategy decision; all malformed observations fail closed. */
export function chooseAction(obs: AgentObservation, params: GammaParams = PARAMS): AgentAction | null {
  try {
    const views = marketViews(obs);
    const usdc = BigInt(obs.balances.usdcUnits || "0");
    const candidates: Candidate[] = [];
    const endgame = obs.blocksRemaining !== undefined && obs.blocksRemaining <= params.endgameBlocks;
    const fee = obs.limits.defaultPriorityFeePerGasWei;
    for (const view of views) {
      const band = bounds(view.base, params);
      if (!band) continue;
      const current = baseBalance(obs, view.base);
      const cheapest = [...view.venues].sort((a, b) => a.price - b.price)[0];
      const richest = [...view.venues].sort((a, b) => b.price - a.price)[0];
      if (cheapest && richest && cheapest !== richest && canFund(obs, "USDC")) {
        // Use the mid spread to select venues, executable quotes to estimate proceeds/cost.
        const buyPrice = cheapest.buyPrice ?? cheapest.price * (1 + cheapest.feeBps / 10_000);
        const sellPrice = richest.sellPrice ?? richest.price * (1 - richest.feeBps / 10_000);
        const netBps = (sellPrice / buyPrice - 1) * 10_000 - params.marginBps - params.adverseBps;
        if (netBps > 0 && sellPrice > buyPrice) {
          const fraction = Math.min(params.maxSizeBps, Math.max(1, Math.floor(netBps * params.sizeGain / 10_000)));
          const desiredUsdc = bpsAmount(usdc, fraction);
          const desiredBase = floatToBase(Number(desiredUsdc) / 1e6 / buyPrice, band.decimals);
          const buyBase = afterBuySize(current, desiredBase, band);
          const buySpend = buyBase < desiredBase
            ? BigInt(Math.floor(Number(buyBase) / 10 ** band.decimals * buyPrice * 1e6))
            : desiredUsdc;
          // Since bundles may partially execute, sell only inventory available before this call.
          const inventoryCap = bpsAmount(current, params.sellReserveBps);
          const sellBase = affordable(obs, view.base, afterSellSize(current, buyBase < inventoryCap ? buyBase : inventoryCap, band, endgame));
          const fundedBuySpend = affordable(obs, "USDC", buySpend);
          if (buyBase > 0n && sellBase > 0n && fundedBuySpend > 0n) {
            const action = { type: "bundle", actions: [
              { type: cheapest.swapType, tokenIn: "USDC", amountIn: fundedBuySpend.toString(), base: view.base === "WETH" ? undefined : view.base, slippageBps: params.slippageBps },
              { type: richest.swapType, tokenIn: view.base, amountIn: sellBase.toString(), base: view.base === "WETH" ? undefined : view.base, slippageBps: params.slippageBps },
            ], maxPriorityFeePerGasWei: fee } as unknown as AgentAction;
            candidates.push({ edge: netBps, action });
          }
        }
      }
      // Secondary single-leg pull toward fair; executable prices already include fees, so no fee is subtracted twice.
      for (const venue of view.venues) {
        const buyPrice = venue.buyPrice ?? venue.price * (1 + venue.feeBps / 10_000);
        const sellPrice = venue.sellPrice ?? venue.price * (1 - venue.feeBps / 10_000);
        const buyEdgeBps = (view.fair / buyPrice - 1) * 10_000 - params.marginBps - params.adverseBps;
        const sellEdgeBps = (sellPrice / view.fair - 1) * 10_000 - params.marginBps - params.adverseBps;
        if (buyEdgeBps > 0 && canFund(obs, "USDC")) {
          const fraction = Math.min(params.maxSizeBps, Math.max(1, Math.floor(buyEdgeBps * params.sizeGain / 10_000)));
          const spend = affordable(obs, "USDC", bpsAmount(usdc, fraction));
          const amount = afterBuySize(current, floatToBase(Number(spend) / 1e6 / buyPrice, band.decimals), band);
          if (amount > 0n) candidates.push({ edge: buyEdgeBps, action: { type: venue.swapType, tokenIn: "USDC", amountIn: spend.toString(), ...(view.base === "WETH" ? {} : { base: view.base }), maxPriorityFeePerGasWei: fee, slippageBps: params.slippageBps } as AgentAction });
        }
        if (sellEdgeBps > 0 && canFund(obs, view.base) && !endgame) {
          const fraction = Math.min(params.maxSizeBps, Math.max(1, Math.floor(sellEdgeBps * params.sizeGain / 10_000)));
          const desired = bpsAmount(current, fraction);
          const amount = affordable(obs, view.base, afterSellSize(current, desired, band, endgame));
          if (amount > 0n) candidates.push({ edge: sellEdgeBps, action: { type: venue.swapType, tokenIn: view.base, amountIn: amount.toString(), ...(view.base === "WETH" ? {} : { base: view.base }), maxPriorityFeePerGasWei: fee, slippageBps: params.slippageBps } as AgentAction });
        }
      }
    }
    candidates.sort((a, b) => b.edge - a.edge);
    return candidates[0]?.action ?? null;
  } catch { return null; }
}
export function decide(obs: AgentObservation): AgentAction | null { return chooseAction(obs) ?? { type: "noop", reason: "no funded, inventory-safe edge" }; }
