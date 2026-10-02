import type { AgentAction, AgentObservation } from "@eris/sdk";
import { balanceOf } from "../lib/affordable.js";
import { marketViews, type MarketView } from "../lib/markets.js";

const DEFAULT_PARAMS = {
  marginBps: 45,
  // 80bps covers both legs at the 35bps slippage bound plus 10bps execution uncertainty.
  adverseBps: 80,
  sizeGain: 200_000,
  maxSizeBps: 1_500,
  inventoryToleranceBps: 2_000,
  endgameBlocks: 12,
  // Bound each leg to 35bps; adverseBps reserves at least the combined 70bps plus a buffer.
  slippageBps: 35,
  sellReserveBps: 10_000,
  maxFairDeviationBps: 60,
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

function dust(token: string, decimals: number): bigint {
  return token === "USDC" ? 10n ** 6n : 10n ** BigInt(Math.max(0, decimals - 3));
}
function spendable(obs: AgentObservation, token: string, desired: bigint, decimals: number): bigint {
  const held = balanceOf(obs, token);
  const value = desired < held ? desired : held;
  return value >= dust(token, decimals) ? value : 0n;
}
function canSpend(obs: AgentObservation, token: string, decimals: number): boolean {
  return balanceOf(obs, token) >= dust(token, decimals);
}
function quoteForBase(amount: bigint, decimals: number, price: number): bigint {
  return BigInt(Math.floor(Number(amount) / 10 ** decimals * price * 1e6));
}

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
      if (cheapest && richest && cheapest !== richest && canSpend(obs, "USDC", 6) && params.slippageBps <= params.adverseBps) {
        // Use the mid spread to select venues, executable quotes to estimate proceeds/cost.
        const buyPrice = cheapest.buyPrice ?? cheapest.price * (1 + cheapest.feeBps / 10_000);
        const sellPrice = richest.sellPrice ?? richest.price * (1 - richest.feeBps / 10_000);
        const netBps = (sellPrice / buyPrice - 1) * 10_000 - params.marginBps - params.adverseBps;
        const fairSafe = buyPrice <= view.fair * (1 + params.maxFairDeviationBps / 10_000) && sellPrice >= view.fair * (1 - params.maxFairDeviationBps / 10_000);
        if (netBps > 0 && sellPrice > buyPrice && fairSafe) {
          const fraction = Math.min(params.maxSizeBps, Math.max(1, Math.floor(netBps * params.sizeGain / 10_000)));
          const desiredUsdc = bpsAmount(usdc, fraction);
          const desiredBase = floatToBase(Number(desiredUsdc) / 1e6 / buyPrice, band.decimals);
          const buyBase = afterBuySize(current, desiredBase, band);
          const buySpend = quoteForBase(buyBase, band.decimals, buyPrice);
          // Since bundles may partially execute, sell only inventory available before this call.
          const inventoryCap = bpsAmount(current, params.sellReserveBps);
          const possibleSell = afterSellSize(current, buyBase < inventoryCap ? buyBase : inventoryCap, band, endgame);
          const commonBase = buyBase < possibleSell ? buyBase : possibleSell;
          const sellBase = spendable(obs, view.base, commonBase, band.decimals);
          const fundedBuySpend = spendable(obs, "USDC", quoteForBase(sellBase, band.decimals, buyPrice), 6);
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
        if (buyEdgeBps > 0 && canSpend(obs, "USDC", 6)) {
          const fraction = Math.min(params.maxSizeBps, Math.max(1, Math.floor(buyEdgeBps * params.sizeGain / 10_000)));
          const amount = afterBuySize(current, floatToBase(Number(bpsAmount(usdc, fraction)) / 1e6 / buyPrice, band.decimals), band);
          const spend = spendable(obs, "USDC", quoteForBase(amount, band.decimals, buyPrice), 6);
          if (amount > 0n) candidates.push({ edge: buyEdgeBps, action: { type: venue.swapType, tokenIn: "USDC", amountIn: spend.toString(), ...(view.base === "WETH" ? {} : { base: view.base }), maxPriorityFeePerGasWei: fee, slippageBps: params.slippageBps } as AgentAction });
        }
        if (sellEdgeBps > 0 && canSpend(obs, view.base, band.decimals) && !endgame) {
          const fraction = Math.min(params.maxSizeBps, Math.max(1, Math.floor(sellEdgeBps * params.sizeGain / 10_000)));
          const desired = bpsAmount(current, fraction);
          const amount = spendable(obs, view.base, afterSellSize(current, desired, band, endgame), band.decimals);
          if (amount > 0n) candidates.push({ edge: sellEdgeBps, action: { type: venue.swapType, tokenIn: view.base, amountIn: amount.toString(), ...(view.base === "WETH" ? {} : { base: view.base }), maxPriorityFeePerGasWei: fee, slippageBps: params.slippageBps } as AgentAction });
        }
      }
    }
    candidates.sort((a, b) => b.edge - a.edge);
    return candidates[0]?.action ?? null;
  } catch { return null; }
}
export function decide(obs: AgentObservation): AgentAction | null { return chooseAction(obs) ?? { type: "noop", reason: "no funded, inventory-safe edge" }; }
