import type { AgentContext, AgentObservation, LiquityObservation } from "@eris/sdk";
import { LOCAL_DEPLOYMENT } from "@eris/sdk/constants.local.js";
import { balanceOf, canFund } from "../lib/affordable.js";

export type Params = Readonly<{
  A_EDGE_BPS: 60 | 20;
  BID_MODE: "budget10" | "competitor+0.1gwei capped by the same 10% budget";
  SIZ_MODE: "depth" | "balance-2.5-25";
  INV_BAND: 0.2 | 0.4;
  MOD: "none" | "liquity-liquidate-redeem capped 1200 USDC with safe exit";
  GATE: "off" | "pause new risk 3 blocks when fair moved >=75bps in one step, recoveries continue";
}>;
export const BASE_PARAMS: Params = Object.freeze({
  A_EDGE_BPS: 60, BID_MODE: "budget10", SIZ_MODE: "depth", INV_BAND: 0.2,
  MOD: "none", GATE: "off",
});
export type Action = Record<string, any>;
const W = 10n ** 18n;
const U = 10n ** 6n;
const BASES = ["WETH", "WBTC"] as const;
type Base = typeof BASES[number];
const INITIAL = { WETH: 8n * W, WBTC: 40_000_000n };
const GAS_RESERVE = W / 20n;
const SWAPS = { uniswap: "swap", balancer: "balancerSwap", curve: "curveSwap" } as const;
type Venue = { protocol: keyof typeof SWAPS; mid: number; cost: number; depth: number };
type Market = { base: Base; fair: number; decimals: number; held: bigint; venues: Venue[] };
type Candidate = { action: Action; profit: number; gas: number; base: Base };
const positive = (n: number) => Number.isFinite(n) && n > 0;
const min = (...ns: bigint[]) => ns.reduce((a, b) => a < b ? a : b);
const units = (n: number, decimals = 6) => BigInt(Math.floor(n * 10 ** decimals));
const noop = (reason: string): Action => ({ type: "noop", reason });

export function funded(obs: AgentObservation, token: string, amount: bigint): boolean {
  // canFund's generic dust floor assumes 18 decimals; normalize only that check for WBTC.
  const held = token === "EUSD" ? BigInt(obs.protocols.liquity?.eusdBalanceWei ?? "0") : balanceOf(obs, token);
  const normalized = token === "EUSD" ? { ...obs, balances: { ...obs.balances, stables: {
    ...obs.balances.stables, EUSD: { token: "EUSD", balance: held.toString(), decimals: 18, priceUsdc: 1, marketQuoted: true },
  } } } : token === "WBTC" ? { ...obs, baseBalances: {
    ...obs.baseBalances, WBTC: (balanceOf(obs, token) * 10n ** 10n).toString(),
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

// These four stages deliberately have disjoint inputs. The entry threshold is never subtracted
// from economic edge and cannot reach the sizing, profit or auction formulas.
export const entryAllowed = (netEdge: number, threshold: Params["A_EDGE_BPS"]) => netEdge * 10000 > threshold;
export function sizeUsd(edge: number, slope: number, balanceUsd: number, cap: number, mode: Params["SIZ_MODE"]): number {
  const desired = mode === "depth" ? 0.5 * edge / (2 * slope)
    : balanceUsd * Math.max(0.025, Math.min(0.25, edge * 10));
  return Math.min(desired, cap, balanceUsd * 0.9);
}
export const profitUsd = (usd: number, edge: number, slope: number, legs: number) =>
  usd * (edge - usd * slope) * (legs > 1 ? 0.8 : 1);
export function bidWei(obs: AgentObservation, profit: number, gas: number, mode: Params["BID_MODE"]): bigint {
  const fair = obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
  if (!positive(profit) || !positive(fair) || !positive(gas)) return 0n;
  const budget = BigInt(Math.max(0, Math.floor(profit * 0.1 / fair / gas * 1e18)));
  const target = mode === "budget10" ? budget : BigInt(obs.competition?.maxCompetitorPriorityFeeWei ?? "0") + 100_000_000n;
  return min(budget, target, BigInt(obs.limits.maxPriorityFeePerGasWei));
}
function swap(m: Market, v: Venue, tokenIn: string, amount: bigint): Action {
  return { type: SWAPS[v.protocol], ...(m.base === "WETH" ? {} : { base: m.base }),
    tokenIn, amountIn: amount.toString(), slippageBps: 80 };
}
function remaining(obs: AgentObservation): number {
  const values = [obs.blocksRemaining, obs.dayBlocksRemaining].filter((n): n is number => n !== undefined && Number.isFinite(n));
  return values.length ? Math.min(...values) : 0;
}
function gasSafe(obs: AgentObservation, gas: number, bid: bigint, value = 0n): boolean {
  return bid >= 0n && BigInt(obs.balances.ethWei) - value - BigInt(gas) * bid >= GAS_RESERVE;
}

function candidates(obs: AgentObservation, ms: Market[], p: Params, cooling: Set<Base>, cap: number): Candidate[] {
  const out: Candidate[] = [];
  const cash = Number(BigInt(obs.balances.usdcUnits)) / 1e6;
  for (const m of ms) {
    if (cooling.has(m.base)) continue;
    const scale = 10 ** m.decimals;
    const held = Number(m.held) / scale;
    const initial = Number(INITIAL[m.base]) / scale;
    const upper = initial * (1 + p.INV_BAND), lower = initial * (1 - p.INV_BAND);
    for (const v of m.venues) {
      const buyEdge = m.fair / v.mid - 1 - v.cost;
      const sellEdge = v.mid / m.fair - 1 - v.cost;
      const buy = buyEdge >= sellEdge, edge = buy ? buyEdge : sellEdge;
      if (!entryAllowed(edge, p.A_EDGE_BPS)) continue;
      const room = Math.max(0, buy ? upper - held : held - lower);
      // Bound purchases by a conservative high output as well as the quoted notional.
      const usd = Math.min(sizeUsd(edge, 1 / v.depth, buy ? cash : held * v.mid, cap, p.SIZ_MODE),
        room * v.mid / (buy ? 1.008 : 1), cap * Math.min(1, v.mid / m.fair));
      if (!(usd >= 50)) continue;
      const amount = units(buy ? usd : usd / v.mid, buy ? 6 : m.decimals);
      const token = buy ? "USDC" : m.base;
      if (!funded(obs, token, amount)) continue;
      out.push({ action: swap(m, v, token, amount), profit: profitUsd(usd, edge, 1 / v.depth, 1), gas: 200_000, base: m.base });
    }
    for (const cheap of m.venues) for (const rich of m.venues) {
      if (cheap.protocol === rich.protocol) continue;
      const edge = rich.mid / cheap.mid - 1 - cheap.cost - rich.cost;
      if (!entryAllowed(edge, p.A_EDGE_BPS)) continue;
      const slope = 1 / cheap.depth + 1 / rich.depth;
      const usd = Math.min(sizeUsd(edge, slope, cash, cap, p.SIZ_MODE),
        held * cheap.mid / 1.008, Math.max(0, upper - held) * cheap.mid / 1.008,
        Math.max(0, held - lower) * cheap.mid, cap * Math.min(1, cheap.mid / m.fair));
      if (!(usd >= 50)) continue;
      const bought = usd / (cheap.mid * (1 + cheap.cost)) * (1 - usd / cheap.depth);
      const sell = units(bought * 0.985, m.decimals), spend = units(usd);
      if (!funded(obs, "USDC", spend) || !funded(obs, m.base, sell)) continue;
      // Every leg is funded from this observation, even if only one leg executes.
      out.push({ action: { type: "bundle", actions: [swap(m, cheap, "USDC", spend), swap(m, rich, m.base, sell)] },
        profit: profitUsd(usd, edge, slope, 2), gas: 350_000, base: m.base });
    }
  }
  return out.filter(c => Number.isFinite(c.profit) && c.profit >= 0.5).sort((a, b) => b.profit - a.profit);
}

function redeemable(l: LiquityObservation): boolean {
  return l.troveCount > 1 && l.tcr >= l.mcr && !!l.riskiestTrove && l.riskiestTrove.icr >= l.mcr &&
    Number.isFinite(l.redemptionRateBps) && l.redemptionRateBps >= 0 && l.redemptionRateBps <= 1940;
}
function liquidatable(l: LiquityObservation): boolean {
  const r = l.riskiestTrove;
  if (!r || !positive(r.icr) || l.troveCount <= 1) return false;
  return r.icr < l.mcr - 0.015 || (l.recoveryMode && r.icr < l.tcr - 0.015 &&
    BigInt(r.netDebtEusdWei) + BigInt(l.gasCompensationEusdWei) <= BigInt(l.spTotalDepositsEusdWei));
}

export function createAgent(params: Params = BASE_PARAMS, now: () => number = () => performance.now()) {
  const p = Object.freeze({ ...params });
  let run = "", lastBlock = -1, lastRemaining = Infinity, pauseUntil = -1, waitUntil = -1;
  let spent = 0n, liquidationCount = 0;
  let wrap: { before: bigint; amount: bigint; block: number } | undefined;
  let sale: { before: bigint; amount: bigint; block: number } | undefined;
  let proceeds = 0n;
  const fairs = new Map<Base, number>(), lastSent = new Map<Base, number>();
  const attempted = new Map<string, number>();
  return function decide(obs: AgentObservation, _ctx?: AgentContext): Action {
    try {
      const started = now();
      const block = Number(obs.blockNumber), left = remaining(obs);
      if (!Number.isSafeInteger(block) || block < 0) return noop("invalid block");
      if (run !== obs.runId || block < lastBlock || left > lastRemaining + 5) {
        run = obs.runId; lastBlock = -1; pauseUntil = -1; waitUntil = -1; spent = 0n; liquidationCount = 0;
        wrap = undefined; sale = undefined; proceeds = 0n; fairs.clear(); lastSent.clear(); attempted.clear();
      }
      if (block === lastBlock) return noop("duplicate observation");
      lastBlock = block; lastRemaining = left;
      if (left <= 0) return noop("valuation boundary or unknown horizon");
      const ms = markets(obs), cash = Number(BigInt(obs.balances.usdcUnits)) / 1e6;
      const cap = 0.08 * (cash + ms.reduce((sum, m) => sum + Number(m.held) / 10 ** m.decimals * m.fair, 0));
      for (const m of ms) {
        const previous = fairs.get(m.base);
        if (previous !== undefined && Math.abs(m.fair - previous) * 10000 >= previous * 75)
          pauseUntil = block + 3;
        fairs.set(m.base, m.fair);
      }
      const paused = p.GATE !== "off" && block < pauseUntil;
      const finish = (action: Action, gas: number, fee: bigint, value = 0n): Action => {
        if (now() - started >= 4000) return noop("decision deadline reserve");
        return gasSafe(obs, gas, fee, value) ? { ...action, maxPriorityFeePerGasWei: fee.toString() } : noop("gas reserve");
      };
      // Recoveries are identical for every Params combination, including MOD=none and GATE pauses.
      const recoveryFee = min(BigInt(obs.limits.defaultPriorityFeePerGasWei), BigInt(obs.limits.maxPriorityFeePerGasWei));
      const recover = (a: Action, gas = 350_000, value = 0n): Action => {
        const result = finish(a, gas, recoveryFee, value);
        if (result.type !== "noop") waitUntil = block + 3;
        return result;
      };
      const weth = BigInt(obs.balances.wethWei), eth = BigInt(obs.balances.ethWei);
      if (sale) {
        const sold = min(sale.amount, sale.before > weth ? sale.before - weth : 0n);
        if (sold > 0n) { proceeds -= sold; sale = undefined; }
        else if (block - sale.block >= 5) sale = undefined;
        else return noop("await collateral sale balance");
      }
      if (wrap) {
        if (weth > wrap.before) { proceeds += min(weth - wrap.before, wrap.amount); wrap = undefined; }
        else if (block - wrap.block >= 5) wrap = undefined;
        else return noop("await wrapped collateral balance");
      }
      const wm = ms.find(m => m.base === "WETH");
      const exit = wm?.venues.slice().sort((a, b) => b.mid * (1 - b.cost) - a.mid * (1 - a.cost))[0];
      if (proceeds > 0n) {
        if (!wm || !exit) return noop("await collateral exit venue");
        const amount = min(proceeds, weth, units(Math.min(cap, exit.depth * 0.01) / wm.fair, 18));
        if (!funded(obs, "WETH", amount)) return noop("await funded collateral exit");
        const a = recover(swap(wm, exit, "WETH", amount), 200_000);
        if (a.type !== "noop") sale = { before: weth, amount, block };
        return a;
      }
      if (block < waitUntil) return noop("await submitted transaction");
      const l = obs.enabledProtocols.includes("liquity") ? obs.protocols.liquity : undefined;
      const nativeReserve = l && BigInt(l.suggestedGasReserveWei) > W ? BigInt(l.suggestedGasReserveWei) : W;
      if (eth > nativeReserve + W / 1000n && wm && exit) {
        if (!LOCAL_DEPLOYMENT) return noop("missing canonical WETH deployment");
        const amount = min(eth - nativeReserve, units(cap / wm.fair, 18));
        if (amount > 0n) {
          const a = recover({ type: "rawTx", tx: { to: LOCAL_DEPLOYMENT.TOKENS.WETH.address, data: "0xd0e30db0", value: amount.toString() } }, 100_000, amount);
          if (a.type !== "noop") wrap = { before: weth, amount, block };
          return a;
        }
      }
      if (l && BigInt(l.eusdBalanceWei) > 0n) {
        const held = BigInt(l.eusdBalanceWei);
        const sell = l.marketSellPriceUsdc ?? l.marketPriceUsdc * 0.999;
        const redeemNet = 1 - (l.redemptionRateBps + 65) / 10000;
        if (left > 12 && wm && exit && funded(obs, "EUSD", min(held, 1200n * W)) &&
            redeemable(l) && (!l.marketQuoted || redeemNet > sell + 0.002))
          return recover({ type: "liquityRedeem", amountEusdWei: min(held, 1200n * W).toString(),
            maxIterations: 8, maxFeeBps: Math.ceil(l.redemptionRateBps + 60) }, 700_000);
        if (l.marketQuoted && positive(sell) && l.poolReserves) {
          const pool = Number(BigInt(l.poolReserves.usdc)) / 1e6;
          const amount = min(held, units(Math.min(1200, cap, pool * 0.01) / sell, 18));
          if (funded(obs, "EUSD", amount)) return recover({ type: "liquitySwapEusd", tokenIn: "EUSD", amountIn: amount.toString(), slippageBps: 60 });
        }
        return noop("await eUSD recovery route");
      }
      if (left <= 4) {
        for (const m of ms) {
          const delta = m.held - INITIAL[m.base];
          const buying = delta < 0n;
          const v = m.venues.slice().sort((a, b) => buying ? a.mid * (1 + a.cost) - b.mid * (1 + b.cost)
            : b.mid * (1 - b.cost) - a.mid * (1 - a.cost))[0];
          if (!v || delta === 0n) continue;
          const usd = Math.min(cap * Math.min(1, v.mid / m.fair), v.depth * 0.01,
            Number(buying ? -delta : delta) / 10 ** m.decimals * v.mid / (buying ? 1.008 : 1), buying ? cash * 0.9 : Infinity);
          const amount = units(buying ? usd : usd / v.mid, buying ? 6 : m.decimals);
          if (funded(obs, buying ? "USDC" : m.base, amount)) {
            const a = finish(swap(m, v, buying ? "USDC" : m.base, amount), 200_000, recoveryFee);
            return a;
          }
        }
        return noop("endgame inventory recovered");
      }
      if (paused) return noop("fair shock: new risk paused");
      if (p.MOD !== "none" && l && left > 40 && wm && exit && l.marketQuoted && l.poolReserves &&
          positive(l.marketSellPriceUsdc ?? l.marketPriceUsdc) && BigInt(l.poolReserves.usdc) >= 120_000n * U) {
        const r = l.riskiestTrove;
        if (r && /^0x[0-9a-fA-F]{40}$/.test(r.owner) && liquidatable(l) && liquidationCount < 3 &&
            block - (attempted.get(r.owner) ?? -100) >= 5) {
          const profit = Number(BigInt(l.gasCompensationEusdWei)) / 1e18 * (l.marketSellPriceUsdc ?? l.marketPriceUsdc) * 0.9;
          if (!positive(profit) || !gasSafe(obs, 700_000, bidWei(obs, profit, 700_000, "budget10"))) return noop("gas reserve");
          const a = finish({ type: "liquityLiquidate", borrowers: [r.owner] }, 700_000, bidWei(obs, profit, 700_000, p.BID_MODE));
          if (a.type !== "noop") { attempted.set(r.owner, block); liquidationCount++; waitUntil = block + 3; }
          return a;
        }
        const buy = l.marketBuyPriceUsdc ?? l.marketPriceUsdc * 1.001;
        const headroom = 1 - (l.redemptionRateBps + 65) / 10000 - buy - 0.01;
        if (redeemable(l) && positive(buy) && headroom > 0 && spent === 0n) {
          const pool = Number(BigInt(l.poolReserves.eusd)) / 1e18;
          const reserve = Number(BigInt(l.poolReserves.usdc)) / 1e6;
          const debt = Number(BigInt(l.totalDebtEusdWei)) / 1e18;
          const imbalance = Math.max(0, (pool - reserve) / 2);
          const usd = Math.min(1200, cap, cash / 12, pool / 100, reserve / 100,
            imbalance * headroom / Math.max(0.001, 4 * (1 - buy)), debt * headroom / 2,
            Number(BigInt(r!.netDebtEusdWei)) / 1e18 * buy * 0.9);
          if (usd >= 100 && funded(obs, "USDC", units(usd))) {
            if (!gasSafe(obs, 1_500_000, bidWei(obs, usd * headroom, 1_500_000, "budget10"))) return noop("gas reserve");
            const a = finish({ type: "liquitySwapEusd", tokenIn: "USDC", amountIn: units(usd).toString(), slippageBps: 40 },
              350_000, bidWei(obs, usd * headroom, 1_500_000, p.BID_MODE));
            if (a.type !== "noop") { spent += units(usd); waitUntil = block + 3; }
            return a;
          }
        }
      }
      const cooling = new Set<Base>();
      for (const [base, at] of lastSent) if (block - at < 2) cooling.add(base);
      const best = candidates(obs, ms, p, cooling, cap)[0];
      if (!best) return noop("no funded edge");
      // Reserve the same maximum economic bid in both modes so BID cannot change admission.
      if (!gasSafe(obs, best.gas, bidWei(obs, best.profit, best.gas, "budget10"))) return noop("gas reserve");
      const a = finish(best.action, best.gas, bidWei(obs, best.profit, best.gas, p.BID_MODE));
      if (a.type !== "noop") lastSent.set(best.base, block);
      return a;
    } catch {
      return noop("invalid observation");
    }
  };
}
