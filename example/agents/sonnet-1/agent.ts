/**
 * sonnet-1: a defensive cross-venue / fair-gap arbitrage agent over WETH and WBTC.
 *
 * Same profit source as multi-arb (mid-vs-fair gaps and cross-venue spreads, marked at fair) with five
 * rules that cap the worst epoch rather than raise the best one:
 *   1. Only WETH / WBTC on uniswap / balancer / curve. Stables, LST, Liquity, launched or discovered
 *      tokens are never touched (nothing to lose on a depeg, a rug or a launch that is worth 0 at the bell).
 *   2. Edge is measured per side after the venue's own cost plus MARGIN_BPS, never from the raw gap.
 *   3. Size never passes the point where the pool price would cross fair: for x*y=k, the trade that closes a
 *      net edge e against USDC-side depth y is e*y/2, and we take DEPTH_FRACTION of it. Depth is read from the
 *      observation every block, so a liquidityPull window shrinks the size by itself.
 *   4. Base inventory stays within +-BAND_BPS of the starting stack (beta is variance without edge).
 *   5. No new trades in the last ENDGAME_BLOCKS blocks, and at most one trade per base every COOLDOWN_BLOCKS
 *      (the observation lags the chain, so a back-to-back repeat would size the same gap twice).
 * Self-contained on purpose: a revision replaces this file with a function body, which cannot import.
 */
import type { AgentAction, AgentObservation } from "@eris/sdk";
import type { AgentContext } from "@eris/sdk/agent.js";

export const PARAMS = {
  BASES: ["WETH", "WBTC"] as readonly string[],
  INITIAL_BASE: { WETH: 8n * 10n ** 18n, WBTC: 40_000_000n } as Record<string, bigint>,
  MARGIN_BPS: 60,
  DEPTH_FRACTION: 0.5,
  MAX_TRADE_PORTFOLIO_FRAC: 0.08,
  MIN_TRADE_USDC: 50,
  MIN_PROFIT_USDC: 0.5,
  BAND_BPS: 2000,
  ENDGAME_BLOCKS: 4,
  COOLDOWN_BLOCKS: 2,
  UNKNOWN_DEPTH_USDC: 300_000,
  MIN_DEPTH_USDC: 20_000,
  BUNDLE_HAIRCUT: 0.8,
  SELL_LEG_FACTOR: 0.985,
  SINGLE_SLIPPAGE_BPS: 80,
  LEG_SLIPPAGE_BPS: 120,
  BID_BUDGET_FRAC: 0.1,
  GAS_SINGLE: 200_000,
  GAS_BUNDLE: 350_000,
};
type Params = typeof PARAMS;

type Protocol = "uniswap" | "balancer" | "curve";
const SWAP_TYPE: Record<Protocol, string> = { uniswap: "swap", balancer: "balancerSwap", curve: "curveSwap" };
type Venue = { protocol: Protocol; mid: number; costBps: number; depthUsdc: number };
type Market = { base: string; fair: number; decimals: number; balance: bigint; venues: Venue[] };

const num = (x: unknown): number => (typeof x === "string" || typeof x === "number" ? Number(x) : NaN);
const big = (x: unknown): bigint => {
  try {
    return typeof x === "string" || typeof x === "number" || typeof x === "bigint" ? BigInt(x) : 0n;
  } catch {
    return 0n;
  }
};

function readMarkets(obs: AgentObservation, p: Params): Market[] {
  const fairs = obs.fairPricesUsd ?? { WETH: obs.fairPriceUsdcPerWeth };
  const out: Market[] = [];
  for (const base of p.BASES) {
    const fair = num(fairs[base]);
    if (!(fair > 0)) continue;
    const decimals = obs.baseDecimals?.[base] ?? (base === "WBTC" ? 8 : 18);
    const key = `${base}/USDC`;
    const venues: Venue[] = [];
    const uni: any = base === "WETH" ? obs.protocols?.uniswap?.pool : obs.protocols?.uniswap?.markets?.[key];
    if (uni && num(uni.priceUsdcPerWeth) > 0) {
      const mid = num(uni.priceUsdcPerWeth);
      const liq = big(uni.liquidity);
      const depth = liq > 0n ? (Number(liq) * Math.sqrt(mid * 10 ** (6 - decimals))) / 1e6 : p.UNKNOWN_DEPTH_USDC;
      const fee = num(uni.fee);
      venues.push({ protocol: "uniswap", mid, costBps: fee > 0 ? fee / 100 : 30, depthUsdc: depth });
    }
    for (const protocol of ["balancer", "curve"] as const) {
      const amm: any = base === "WETH" ? obs.protocols?.[protocol] : obs.protocols?.[protocol]?.markets?.[key];
      if (!amm || !(num(amm.priceUsdcPerWeth) > 0)) continue;
      const half = num(amm.effectiveHalfSpreadBps);
      const twoSided = half >= 0 && num(amm.sellPriceUsdcPerWeth) > 0 && num(amm.buyPriceUsdcPerWeth) > 0;
      const costBps = twoSided ? half : 30;
      const mid = twoSided ? num(amm.priceUsdcPerWeth) : num(amm.priceUsdcPerWeth) / (1 - costBps / 10000);
      const usdc = Number(big(amm.reserves?.usdc)) / 1e6;
      venues.push({ protocol, mid, costBps, depthUsdc: usdc > 0 ? usdc : p.UNKNOWN_DEPTH_USDC });
    }
    const balance = base === "WETH" ? big(obs.balances.wethWei) : big(obs.baseBalances?.[base]);
    out.push({ base, fair, decimals, balance, venues: venues.filter((v) => v.depthUsdc >= p.MIN_DEPTH_USDC) });
  }
  return out;
}

type Candidate = { base: string; profit: number; action: Record<string, unknown>; legs: number };

function bidFor(obs: AgentObservation, p: Params, profitUsdc: number, legs: number, ethUsd: number): string {
  const floor = big(obs.limits.defaultPriorityFeePerGasWei);
  const ceiling = big(obs.limits.maxPriorityFeePerGasWei ?? obs.limits.defaultPriorityFeePerGasWei);
  if (ceiling <= floor || !(ethUsd > 0)) return floor.toString();
  const gas = legs > 1 ? p.GAS_BUNDLE : p.GAS_SINGLE;
  const extraWei = Math.floor(((profitUsdc * p.BID_BUDGET_FRAC) / (ethUsd * gas)) * 1e18);
  const bid = floor + BigInt(Math.max(0, extraWei));
  return (bid > ceiling ? ceiling : bid).toString();
}

export function chooseAction(
  obs: AgentObservation,
  cooling: ReadonlySet<string> = new Set(),
  p: Params = PARAMS,
): AgentAction | Record<string, unknown> {
  const noop = (reason: string) => ({ type: "noop", reason });
  try {
    if (obs.blocksRemaining !== undefined && obs.blocksRemaining <= p.ENDGAME_BLOCKS) return noop("endgame: no new trades");
    const markets = readMarkets(obs, p);
    const usdc = big(obs.balances.usdcUnits);
    const usdcUsd = Number(usdc) / 1e6;
    const ethUsd = markets.find((m) => m.base === "WETH")?.fair ?? 0;
    const portfolio = usdcUsd + markets.reduce((s, m) => s + (Number(m.balance) / 10 ** m.decimals) * m.fair, 0);
    const capUsd = portfolio * p.MAX_TRADE_PORTFOLIO_FRAC;
    const margin = p.MARGIN_BPS / 10000;
    let best: Candidate | null = null;
    const consider = (c: Candidate) => {
      if (c.profit >= p.MIN_PROFIT_USDC && (!best || c.profit > best.profit)) best = c;
    };

    for (const m of markets) {
      if (cooling.has(m.base)) continue;
      const initial = p.INITIAL_BASE[m.base] ?? m.balance;
      const bandWei = (initial * BigInt(p.BAND_BPS)) / 10000n;
      const upper = initial + bandWei;
      const lower = initial > bandWei ? initial - bandWei : 0n;
      const toBase = (wei: bigint) => Number(wei) / 10 ** m.decimals;
      const fromBase = (amount: number) => BigInt(Math.max(0, Math.floor(amount * 10 ** m.decimals)));
      const withBase = (a: Record<string, unknown>) => (m.base === "WETH" ? a : { ...a, base: m.base });

      // 1) single leg: pull one venue back toward fair (never past it).
      for (const v of m.venues) {
        const cost = v.costBps / 10000;
        const netBuy = m.fair / v.mid - 1 - cost - margin;
        const netSell = v.mid / m.fair - 1 - cost - margin;
        const buy = netBuy >= netSell;
        const net = buy ? netBuy : netSell;
        if (!(net > 0)) continue;
        let usd = Math.min((p.DEPTH_FRACTION * net * v.depthUsdc) / 2, capUsd);
        if (buy) {
          usd = Math.min(usd, usdcUsd * 0.9, toBase(upper > m.balance ? upper - m.balance : 0n) * v.mid);
        } else {
          usd = Math.min(usd, toBase(m.balance > lower ? m.balance - lower : 0n) * v.mid);
        }
        if (!(usd >= p.MIN_TRADE_USDC)) continue;
        const amountIn = buy ? BigInt(Math.floor(usd * 1e6)) : fromBase(usd / v.mid);
        if (amountIn <= 0n) continue;
        const profit = usd * (net - usd / v.depthUsdc);
        consider({
          base: m.base,
          profit,
          legs: 1,
          action: withBase({
            type: SWAP_TYPE[v.protocol],
            tokenIn: buy ? "USDC" : m.base,
            amountIn: amountIn.toString(),
            slippageBps: p.SINGLE_SLIPPAGE_BPS,
            maxPriorityFeePerGasWei: bidFor(obs, p, profit, 1, ethUsd),
          }),
        });
      }

      // 2) two legs: buy on the cheapest venue, sell what it returns on the richest.
      if (m.venues.length < 2) continue;
      let cheap = m.venues[0];
      let rich = m.venues[0];
      for (const v of m.venues) {
        if (v.mid < cheap.mid) cheap = v;
        if (v.mid > rich.mid) rich = v;
      }
      const net = rich.mid / cheap.mid - 1 - cheap.costBps / 10000 - rich.costBps / 10000 - margin;
      if (!(net > 0) || cheap === rich) continue;
      const slope = 1 / cheap.depthUsdc + 1 / rich.depthUsdc;
      const usd = Math.min((p.DEPTH_FRACTION * net) / (2 * slope), capUsd, usdcUsd * 0.9);
      if (!(usd >= p.MIN_TRADE_USDC)) continue;
      const bought = (usd / (cheap.mid * (1 + cheap.costBps / 10000))) * (1 - usd / cheap.depthUsdc);
      const sellBase = bought * p.SELL_LEG_FACTOR;
      const netInventory = fromBase(bought - sellBase);
      if (m.balance + netInventory > upper) continue;
      const usdcIn = BigInt(Math.floor(usd * 1e6));
      const baseSell = fromBase(sellBase);
      if (usdcIn <= 0n || baseSell <= 0n) continue;
      const profit = usd * (net - usd * slope) * p.BUNDLE_HAIRCUT;
      consider({
        base: m.base,
        profit,
        legs: 2,
        action: {
          type: "bundle",
          actions: [
            withBase({ type: SWAP_TYPE[cheap.protocol], tokenIn: "USDC", amountIn: usdcIn.toString(), slippageBps: p.LEG_SLIPPAGE_BPS }),
            withBase({ type: SWAP_TYPE[rich.protocol], tokenIn: m.base, amountIn: baseSell.toString(), slippageBps: p.LEG_SLIPPAGE_BPS }),
          ],
          maxPriorityFeePerGasWei: bidFor(obs, p, profit, 2, ethUsd),
        },
      });
    }

    const chosen = best as Candidate | null;
    return chosen ? chosen.action : noop("no edge after cost, margin, depth and inventory limits");
  } catch {
    return noop("invalid observation");
  }
}

const lastSent = new Map<string, number>();
let lastBlock = -1;

export function decide(obs: AgentObservation, ctx?: Pick<AgentContext, "log">): AgentAction | Record<string, unknown> {
  const block = Number(obs?.blockNumber);
  if (Number.isFinite(block)) {
    if (block < lastBlock) lastSent.clear();
    lastBlock = block;
  }
  const cooling = new Set<string>();
  for (const [base, at] of lastSent) if (block - at < PARAMS.COOLDOWN_BLOCKS) cooling.add(base);
  const action = chooseAction(obs, cooling) as Record<string, any>;
  if (action.type !== "noop" && Number.isFinite(block)) {
    const base = action.base ?? action.actions?.[0]?.base ?? "WETH";
    lastSent.set(base, block);
  }
  try {
    ctx?.log({ reason: action.type === "noop" ? String(action.reason) : `${action.type} ${action.base ?? "WETH"}` });
  } catch {
    // logging must never break a decision
  }
  return action;
}
