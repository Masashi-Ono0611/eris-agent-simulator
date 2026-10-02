import type { AgentAction, AgentObservation, BundleActionItem } from "@eris/sdk";
import { marketViews } from "../lib/markets.js";
import { canFund, sized } from "../lib/affordable.js";

// Cross-venue round-trip costs are both venue half-spreads/fees plus this conservative
// allowance for size impact and one-block quote staleness. This is an entry guard, not
// a claim that every admitted trade will be profitable; calibrate against realized fills.
const EXTRA_COST_BPS = 75;
const MIN_NET_EDGE_BPS = 25;
const MAX_TRADE_BALANCE_BPS = 500;
const LIQUIDATION_BUFFER_BPS = 100;
const ENDGAME_BLOCKS = 3;

export function chooseArbitrage(obs: AgentObservation): AgentAction | null {
  const views = marketViews(obs);
  // Scoring marks ETH/WBTC at the reference price, so the starting inventory needs no unwinding
  // (selling it only pays fees + impact). Near the boundary we simply stop opening new
  // two-leg bundles: the second leg could land after the final block and leave a one-sided fill.
  if ((obs.blocksRemaining ?? Number.POSITIVE_INFINITY) <= ENDGAME_BLOCKS) return null;
  const usdc = BigInt(obs.balances.usdcUnits || "0");
  if (usdc <= 0n) return null;

  let best: {
    base: string;
    cheap: ReturnType<typeof marketViews>[number]["venues"][number];
    rich: ReturnType<typeof marketViews>[number]["venues"][number];
    netBps: number;
    buyPrice: number;
    amountUsdc: bigint;
  } | undefined;

  for (const view of views) {
    if (view.venues.length < 2) continue;
    const cheap = view.venues.reduce((a, b) => (b.price < a.price ? b : a));
    const rich = view.venues.reduce((a, b) => (b.price > a.price ? b : a));
    if (!(cheap.price > 0) || !(rich.price > cheap.price)) continue;

    // Use executable quotes for Balancer/Curve when available; otherwise mid prices.
    // Uniswap's observation is a mid, so its 30bps pool fee is included in costBps.
    const buy = cheap.buyPrice ?? cheap.price * (1 + cheap.feeBps / 10_000);
    const sell = rich.sellPrice ?? rich.price * (1 - rich.feeBps / 10_000);
    const grossBps = (sell / buy - 1) * 10_000;
    // buy/sell above already include each venue's fee/half-spread, so only the extra
    // impact + staleness allowance is charged here (no second fee deduction).
    const netBps = grossBps - EXTRA_COST_BPS;
    if (!Number.isFinite(netBps) || netBps < MIN_NET_EDGE_BPS) continue;

    const amountUsdc = sized(obs, "USDC", Math.min(MAX_TRADE_BALANCE_BPS, Math.max(100, Math.floor(netBps * 5))));
    if (amountUsdc === 0n) continue;
    if (!best || netBps > best.netBps) best = { base: view.base, cheap, rich, netBps, buyPrice: buy, amountUsdc };
  }
  if (!best || !canFund(obs, "USDC")) return null;

  // Keep the sell leg slightly below estimated buy output so rounding/impact cannot
  // make the second leg unfundable. Residual exposure is bounded to ~1% of this small order.
  // Size the sell from the executable buy price (fee/half-spread included), not the mid.
  const baseOut = Number(best.amountUsdc) / 1e6 / best.buyPrice;
  const baseSell = BigInt(Math.floor(baseOut * (1 - LIQUIDATION_BUFFER_BPS / 10_000) * 10 **
    (obs.baseDecimals?.[best.base] ?? 18)));
  if (baseSell <= 0n || !canFund(obs, "USDC")) return null;

  const feeDefault = BigInt(obs.limits.defaultPriorityFeePerGasWei);
  const competitor = BigInt(obs.competition?.maxCompetitorPriorityFeeWei ?? "0");
  const feeCap = BigInt(obs.limits.maxPriorityFeePerGasWei);
  // Bid one small increment above observed competition only for a material edge.
  const bid = best.netBps >= 150 ? competitor + feeDefault / 2n : feeDefault;
  const priority = (bid > feeCap ? feeCap : bid).toString();
  const withBase = (action: Record<string, unknown>) => best!.base === "WETH" ? action : { ...action, base: best!.base };

  return {
    type: "bundle",
    actions: [
      withBase({ type: best.cheap.swapType, tokenIn: "USDC", amountIn: best.amountUsdc.toString(), slippageBps: 100 }),
      withBase({ type: best.rich.swapType, tokenIn: best.base, amountIn: baseSell.toString(), slippageBps: 100 }),
    ] as BundleActionItem[],
    maxPriorityFeePerGasWei: priority,
  };
}

export function decide(obs: AgentObservation): AgentAction | null {
  try {
    return chooseArbitrage(obs);
  } catch {
    return null;
  }
}
