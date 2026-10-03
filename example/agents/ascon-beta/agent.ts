import type { AgentAction, AgentObservation } from "@eris/sdk";
import { canFund, sized } from "../lib/affordable.js";
import { marketViews } from "../lib/markets.js";

const DEFAULT_PARAMS = {
  marginBps: 50,
  sizeGain: 200_000,
  maxSizeBps: 2_500,
  inventoryToleranceBps: 2_500,
  endgameBlocks: 12,
  slippageBps: 75,
};

export function parseBetaParams(raw: string | undefined): typeof DEFAULT_PARAMS {
  if (!raw) return DEFAULT_PARAMS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_PARAMS;
    const source = parsed as Record<string, unknown>;
    const result = { ...DEFAULT_PARAMS };
    for (const key of Object.keys(DEFAULT_PARAMS) as Array<keyof typeof DEFAULT_PARAMS>) {
      const value = source[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      if (key === "maxSizeBps" && value > 10_000) continue;
      if (key === "inventoryToleranceBps" && value >= 10_000) continue;
      if (key === "slippageBps" && value > 5_000) continue;
      result[key] = value;
    }
    return result;
  } catch {
    return DEFAULT_PARAMS;
  }
}

export const PARAMS = parseBetaParams(process.env.ASCON_BETA_PARAMS);
const INITIAL_INVENTORY: Record<string, { amount: bigint; decimals: number }> = {
  WETH: { amount: 8n * 10n ** 18n, decimals: 18 },
  WBTC: { amount: 4n * 10n ** 7n, decimals: 8 },
};

type Candidate = { action: AgentAction; edgeBps: number };

function baseBalance(obs: AgentObservation, base: string): bigint {
  if (base === "WETH") return BigInt(obs.balances.wethWei || "0");
  return BigInt(obs.baseBalances?.[base] ?? "0");
}

function inventoryAllows(obs: AgentObservation, base: string, buying: boolean, params: typeof DEFAULT_PARAMS): boolean {
  const initial = INITIAL_INVENTORY[base];
  if (!initial) return false;
  const current = baseBalance(obs, base);
  const tolerance = initial.amount * BigInt(Math.floor(params.inventoryToleranceBps)) / 10_000n;
  const lower = initial.amount - tolerance;
  const upper = initial.amount + tolerance;
  if (buying && current > upper) return false;
  if (!buying && current < lower) return false;
  const remaining = obs.blocksRemaining;
  if (remaining !== undefined && remaining <= params.endgameBlocks) {
    if (buying) return false;
    // Only reduce inventory above the official endowment; never liquidate the endowment.
    return current > initial.amount;
  }
  return true;
}

/** Pure decision function; malformed or incomplete observations fail closed. */
export function chooseAction(obs: AgentObservation, params = PARAMS): AgentAction | null {
  try {
    const views = marketViews(obs);
    const candidates: Candidate[] = [];
    for (const view of views) {
      const initial = INITIAL_INVENTORY[view.base];
      if (!initial) continue;
      const current = baseBalance(obs, view.base);
      for (const venue of view.venues) {
        if (!(venue.price > 0) || !Number.isFinite(venue.price)) continue;
        const feeBps = Number.isFinite(venue.feeBps) ? venue.feeBps : 30;
        const buyExecution = venue.buyPrice ?? venue.price * (1 + feeBps / 10_000);
        const sellExecution = venue.sellPrice ?? venue.price * (1 - feeBps / 10_000);
        const midGapBps = Math.abs(view.fair / venue.price - 1) * 10_000;

        if (venue.price < view.fair) {
          const edgeBps = (view.fair / buyExecution - 1) * 10_000;
          if (midGapBps <= feeBps + params.marginBps || edgeBps <= params.marginBps) continue;
          if (!inventoryAllows(obs, view.base, true, params) || !canFund(obs, "USDC")) continue;
          const fraction = Math.min(params.maxSizeBps, Math.floor(edgeBps * params.sizeGain / 10_000));
          // sizeGain maps a fractional edge (e.g. 1%) to a balance fraction in bps.
          const amountIn = sized(obs, "USDC", fraction);
          if (amountIn === 0n) continue;
          candidates.push({
            edgeBps,
            action: {
              type: venue.swapType,
              tokenIn: "USDC",
              amountIn: amountIn.toString(),
              ...(view.base === "WETH" ? {} : { base: view.base }),
              maxPriorityFeePerGasWei: obs.limits.defaultPriorityFeePerGasWei,
              slippageBps: params.slippageBps,
            } as AgentAction,
          });
        } else if (venue.price > view.fair) {
          const edgeBps = (sellExecution / view.fair - 1) * 10_000;
          if (midGapBps <= feeBps + params.marginBps || edgeBps <= params.marginBps) continue;
          if (!inventoryAllows(obs, view.base, false, params) || !canFund(obs, view.base)) continue;
          const fraction = Math.min(params.maxSizeBps, Math.floor(edgeBps * params.sizeGain / 10_000));
          let amountIn = sized(obs, view.base, fraction);
          if (obs.blocksRemaining !== undefined && obs.blocksRemaining <= params.endgameBlocks) {
            const excess = current - initial.amount;
            if (amountIn > excess) amountIn = excess;
          }
          if (amountIn === 0n) continue;
          candidates.push({
            edgeBps,
            action: {
              type: venue.swapType,
              tokenIn: view.base,
              amountIn: amountIn.toString(),
              ...(view.base === "WETH" ? {} : { base: view.base }),
              maxPriorityFeePerGasWei: obs.limits.defaultPriorityFeePerGasWei,
              slippageBps: params.slippageBps,
            } as AgentAction,
          });
        }
      }
    }
    candidates.sort((a, b) => b.edgeBps - a.edgeBps);
    return candidates[0]?.action ?? null;
  } catch {
    return null;
  }
}

export function decide(obs: AgentObservation): AgentAction | null {
  return chooseAction(obs) ?? { type: "noop", reason: "no funded, inventory-safe fair-value gap" };
}
