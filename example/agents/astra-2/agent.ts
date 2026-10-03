/** multi-arb-derived inventory-funded arbitrage plus bounded new-regime trades. */
import type { AgentContext, AgentObservation, LiquityObservation } from "@eris/sdk";
import { TOKENS } from "@eris/sdk/constants.js";
import { marketViews, type MarketView, type AgentVenue } from "../lib/markets.js";
import { balanceOf, canFund } from "../lib/affordable.js";
import { PARAMS as P } from "./params.js";
import { createLaunchState, launchDecision } from "./launch.js";

export type Action = Record<string, unknown>;
const U = 10n ** 6n;
const W = 10n ** 18n;
const min = (...xs: bigint[]) => xs.reduce((a, b) => a < b ? a : b);
const units = (usd: number) => BigInt(Math.floor(Math.max(0, usd) * 1e6));
const positive = (n: number) => Number.isFinite(n) && n > 0;

export function remaining(obs: AgentObservation): number {
  const values = [obs.blocksRemaining, obs.dayBlocksRemaining].filter(
    (x): x is number => x !== undefined && Number.isFinite(x) && x >= 0,
  );
  // Without a known end, new specialty positions are unsafe.
  return values.length ? Math.min(...values) : 0;
}

export function priority(obs: AgentObservation, race = false): string {
  const cap = BigInt(obs.limits.maxPriorityFeePerGasWei);
  const normal = BigInt(obs.limits.defaultPriorityFeePerGasWei);
  return min(cap, race ? normal * 2n : normal, 1_000_000_000n).toString();
}

function funded(obs: AgentObservation, token: string, amount: bigint): boolean {
  // affordable.ts's generic non-WETH dust is 18-decimal. Normalize that check for WBTC.
  const decimals = obs.baseDecimals?.[token] ?? (token === "WBTC" ? 8 : 18);
  const check = token === "WBTC" && decimals === 8
    ? { ...obs, baseBalances: { ...obs.baseBalances, WBTC: (balanceOf(obs, token) * 10n ** 10n).toString() } }
    : obs;
  return amount > 0n && amount <= balanceOf(obs, token) && canFund(check, token);
}

function venues(obs: AgentObservation): MarketView[] {
  return marketViews(obs).filter(v => ["WETH", "WBTC"].includes(v.base) && positive(v.fair))
    .map(v => ({ ...v, baseDecimals: obs.baseDecimals?.[v.base] ?? (v.base === "WBTC" ? 8 : 18),
      venues: v.venues.filter(q => obs.enabledProtocols.includes(q.protocol) && positive(q.price) &&
        Number.isFinite(q.feeBps) && q.feeBps >= 0 && q.feeBps < 2000),
    }));
}
const ask = (v: AgentVenue) => v.buyPrice ?? v.price / (1 - v.feeBps / 10000);
const bid = (v: AgentVenue) => v.sellPrice ?? v.price * (1 - v.feeBps / 10000);
function swap(v: AgentVenue, base: string, tokenIn: string, amount: bigint): Action {
  return { type: v.swapType, ...(base === "WETH" ? {} : { base }), tokenIn,
    amountIn: amount.toString(), slippageBps: P.slippageBps };
}

export function arbitrage(obs: AgentObservation, shocked = new Set<string>()): Action | null {
  const views = venues(obs);
  const cash = BigInt(obs.balances.usdcUnits);
  let best: { value: number; action: Action } | undefined;
  for (const v of views) {
    for (const buy of v.venues) for (const sell of v.venues) {
      if (buy.protocol === sell.protocol || !positive(ask(buy)) || !positive(bid(sell))) continue;
      const edge = bid(sell) / ask(buy) - 1;
      if (edge * 10000 <= P.arbMarginBps + 2 * P.slippageBps) continue;
      const held = BigInt(v.baseBalanceWei);
      const cashSize = min(units(P.arbMaxUsd), cash * BigInt(P.arbFractionBps) / 10000n);
      const baseSize = min(held / 5n, BigInt(Math.floor(Number(cashSize) / 1e6 / ask(buy) * 10 ** v.baseDecimals)));
      const spend = units(Number(baseSize) / 10 ** v.baseDecimals * ask(buy));
      if (spend < 20n * U || !funded(obs, "USDC", spend) || !funded(obs, v.base, baseSize)) continue;
      const value = Number(spend) / 1e6 * (edge - 2 * P.slippageBps / 10000);
      if (!best || value > best.value) best = { value, action: {
        type: "bundle", actions: [swap(buy, v.base, "USDC", spend), swap(sell, v.base, v.base, baseSize)],
        maxPriorityFeePerGasWei: priority(obs), reason: "inventory-funded cross-venue spread",
      } };
    }
  }
  if (best) return best.action;
  for (const v of views) {
    // A sudden oracle move can be a spike or crash: wait for fresh observations before
    // taking directional inventory. Funded cross-venue trades above remain available.
    if (shocked.has(v.base)) continue;
    const held = BigInt(v.baseBalanceWei);
    const heldUsd = Number(held) / 10 ** v.baseDecimals * v.fair;
    for (const q of v.venues) {
      const buying = ask(q) < v.fair;
      const edge = buying ? v.fair / ask(q) - 1 : bid(q) / v.fair - 1;
      if (!Number.isFinite(edge) || edge * 10000 <= P.arbMarginBps + P.slippageBps) continue;
      const token = buying ? "USDC" : v.base;
      // Cap accumulated directional inventory, not just each order.
      const initial = v.base === "WETH" ? 8 : 0.4;
      const room = buying ? Math.max(0, initial * 1.35 * v.fair - heldUsd)
        : Math.max(0, heldUsd - initial * 0.65 * v.fair);
      const usd = Math.min(P.singleMaxUsd, room, (buying ? Number(cash) / 1e6 : heldUsd) * P.singleFractionBps / 10000);
      const amount = buying ? units(usd) : BigInt(Math.floor(usd / bid(q) * 10 ** v.baseDecimals));
      if (usd < 20 || !funded(obs, token, amount)) continue;
      const value = usd * edge;
      if (!best || value > best.value) best = { value, action: {
        ...swap(q, v.base, token, amount), maxPriorityFeePerGasWei: priority(obs), reason: "bounded fair-price dislocation",
      } };
    }
  }
  return best?.action ?? null;
}

export function liquidatable(l: LiquityObservation): boolean {
  const r = l.riskiestTrove;
  if (!r || !positive(r.icr) || l.troveCount <= 1) return false;
  if (r.icr < l.mcr - 0.015) return true;
  return l.recoveryMode && r.icr < l.tcr - 0.015 &&
    BigInt(r.netDebtEusdWei) + BigInt(l.gasCompensationEusdWei) <= BigInt(l.spTotalDepositsEusdWei);
}

export function createAgent() {
  let run = "", lastBlock = -1, lastRemaining = Infinity;
  let launch = createLaunchState();
  const fair = new Map<string, { price: number; until: number }>();
  let pendingUntil = -1;
  let wrap: { before: bigint; amount: bigint; block: number } | undefined;
  let sellProceeds = 0n;
  let proceedsSale: { before: bigint; amount: bigint; block: number } | undefined;
  let awaitingEusd = false;
  let dai: { prices: number[]; block: number; entered?: number; entry?: number; used: boolean } = { prices: [], block: -1, used: false };
  const liquidationAttempts = new Map<string, number>();

  return async function decide(obs: AgentObservation, ctx?: AgentContext): Promise<Action> {
    const block = Number(obs.blockNumber), left = remaining(obs);
    if (run !== obs.runId || block < lastBlock || left > lastRemaining + 5) {
      run = obs.runId; launch = createLaunchState(); fair.clear(); liquidationAttempts.clear();
      pendingUntil = -1; wrap = undefined; sellProceeds = 0n; proceedsSale = undefined;
      awaitingEusd = false;
      dai = { prices: [], block: -1, used: false }; lastBlock = -1;
    }
    if (block === lastBlock) return { type: "noop", reason: "duplicate observation" };
    lastBlock = block; lastRemaining = left;
    if (left === 0 && obs.blocksRemaining === 0) return { type: "noop", reason: "epoch valuation boundary" };
    const shocked = new Set<string>();
    for (const v of venues(obs)) {
      const prev = fair.get(v.base);
      const until = prev && Math.abs(v.fair / prev.price - 1) * 10000 >= P.shockBps
        ? block + P.shockWaitBlocks : prev?.until ?? -1;
      if (block <= until) shocked.add(v.base);
      fair.set(v.base, { price: v.fair, until });
    }
    // Launch exits/reconciliation always precede any other position or cash allocation.
    if (ctx) {
      const a = await launchDecision(obs, ctx, launch, left, block, priority(obs, true), block >= pendingUntil);
      if (a) return a;
    }
    if (block < pendingUntil) return { type: "noop", reason: "waiting for submitted specialty transaction" };
    const fee = priority(obs);
    const send = (a: Action, wait = 2): Action => { pendingUntil = block + wait; return { ...a, maxPriorityFeePerGasWei: fee }; };
    const weth = BigInt(obs.balances.wethWei), eth = BigInt(obs.balances.ethWei);
    const l = obs.enabledProtocols.includes("liquity") ? obs.protocols.liquity : undefined;
    if (proceedsSale) {
      const sold = proceedsSale.before > weth ? min(proceedsSale.before - weth, proceedsSale.amount) : 0n;
      if (sold > 0n) { sellProceeds -= min(sellProceeds, sold); proceedsSale = undefined; }
      else if (block - proceedsSale.block >= 5) proceedsSale = undefined;
      else return { type: "noop", reason: "await collateral-sale balance confirmation" };
    }
    if (wrap) {
      if (weth > wrap.before) { sellProceeds += min(weth - wrap.before, wrap.amount); wrap = undefined; }
      else if (block - wrap.block >= 5) wrap = undefined;
      else return { type: "noop", reason: "await wrapped collateral balance" };
    }
    if (sellProceeds > 0n) {
      const view = venues(obs).find(v => v.base === "WETH");
      const venue = view?.venues.filter(v => positive(bid(v))).sort((a, b) => bid(b) - bid(a))[0];
      const amount = min(weth, sellProceeds);
      if (venue && funded(obs, "WETH", amount)) {
        proceedsSale = { before: weth, amount, block };
        return send({ ...swap(venue, "WETH", "WETH", amount), reason: "realize CDP collateral proceeds" });
      }
    }
    // Native reward ETH survives a worker restart; retain the full initial gas endowment.
    const gasReserve = l ? (BigInt(l.suggestedGasReserveWei) > W ? BigInt(l.suggestedGasReserveWei) : W) : W;
    if (eth > gasReserve + W / 1000n && venues(obs).some(v => v.base === "WETH" && v.venues.length)) {
      const amount = eth - gasReserve;
      wrap = { before: weth, amount, block };
      return send({ type: "rawTx", tx: { to: TOKENS.WETH.address, data: "0xd0e30db0", value: amount.toString() }, reason: "wrap CDP reward above gas reserve" });
    }
    if (l) {
      const eusd = BigInt(l.eusdBalanceWei);
      if (eusd > 0n) awaitingEusd = false;
      if (left <= P.specialtyCloseBlocks && BigInt(l.spDepositEusdWei) > 0n)
        return send({ type: "liquityWithdrawFromSP", amountEusdWei: "max", reason: "recover inherited SP principal" });
      if (BigInt(l.spEthGainWei) > W / 1000n)
        return send({ type: "liquityWithdrawFromSP", amountEusdWei: "0", reason: "claim collateral" });
      const r = l.riskiestTrove;
      if (r && liquidatable(l) && block - (liquidationAttempts.get(r.owner) ?? -100) >= 5) {
        liquidationAttempts.set(r.owner, block);
        return { ...send({ type: "liquityLiquidate", borrowers: [r.owner], reason: "CDP liquidation compensation" }), maxPriorityFeePerGasWei: priority(obs, true) };
      }
      const sell = l.marketSellPriceUsdc ?? l.marketPriceUsdc * 0.999;
      const buy = l.marketBuyPriceUsdc ?? l.marketPriceUsdc * 1.001;
      const redeemNet = 1 - (l.redemptionRateBps + P.redemptionExitBps) / 10000;
      const redeemable = l.troveCount > 1 && l.tcr >= l.mcr && r && r.icr >= l.mcr &&
        Number.isFinite(l.redemptionRateBps) && l.redemptionRateBps >= 0 && l.redemptionRateBps <= 1940;
      if (eusd > 0n) {
        if (left > 8 && redeemable && positive(redeemNet) && (!l.marketQuoted || redeemNet > sell + 0.002))
          return send({ type: "liquityRedeem", amountEusdWei: eusd.toString(), maxIterations: 8,
            maxFeeBps: Math.min(2000, Math.ceil(l.redemptionRateBps + 60)), reason: "convert discounted eUSD to collateral" }, 3);
        if (l.marketQuoted && positive(sell))
          return send({ type: "liquitySwapEusd", tokenIn: "EUSD", amountIn: eusd.toString(), slippageBps: 60, reason: "recycle eUSD without assuming repeg" });
      } else if (!awaitingEusd && left > P.entryStopBlocks && redeemable && !shocked.has("WETH") &&
        l.marketQuoted && positive(buy) && redeemNet - buy > P.redemptionMarginBps / 10000 && l.poolReserves) {
        const pool = BigInt(l.poolReserves.eusd) / 10n ** 12n;
        const imbalance = (pool - BigInt(l.poolReserves.usdc)) / 2n;
        const headroom = redeemNet - buy - P.redemptionMarginBps / 10000;
        const impactCap = imbalance > 0n ? BigInt(Math.floor(Number(imbalance) * headroom / Math.max(0.001, 4 * (1 - buy)))) : 0n;
        // Include own redemption's approximate base-rate increase (amount / 2 / total debt).
        const feeRiseCap = BigInt(Math.floor(Number(BigInt(l.totalDebtEusdWei) / 10n ** 12n) * headroom / 2));
        const size = min(units(P.redemptionMaxUsd), BigInt(obs.balances.usdcUnits) / 12n, pool / 100n, impactCap, feeRiseCap);
        if (size >= 100n * U && funded(obs, "USDC", size)) {
          awaitingEusd = true;
          return send({ type: "liquitySwapEusd", tokenIn: "USDC", amountIn: size.toString(), slippageBps: 40, reason: "eUSD discount after fee, impact and collateral exit" }, 3);
        }
      }
    }
    const s = obs.balances.stables?.DAI;
    if (s && s.marketQuoted && positive(s.priceUsdc) && obs.enabledProtocols.includes("curve")) {
      if (block !== dai.block + 1) dai.prices = [];
      dai.block = block; dai.prices.push(s.priceUsdc); dai.prices = dai.prices.slice(-4);
      const held = BigInt(s.balance);
      if (held > 0n) {
        // Unknown entry on restart means close, not invent a profitable cost basis.
        if (dai.entry === undefined || left <= P.specialtyCloseBlocks ||
          block - (dai.entered ?? block) >= P.daiHoldBlocks || s.priceUsdc >= dai.entry * 1.003 ||
          s.priceUsdc < dai.entry * (1 - P.daiStopBps / 10000)) {
          dai.used = true;
          return send({ type: "stableSwap", stable: "DAI", tokenIn: "DAI", amountIn: held.toString(), slippageBps: 50, reason: "DAI recovery take-profit or bounded exit" });
        }
      } else if (!dai.used && left > P.entryStopBlocks && dai.prices.length === 4 && s.priceUsdc < 0.995 &&
        dai.prices.every((p, i, ps) => i === 0 || p > ps[i - 1]) &&
        s.priceUsdc / dai.prices[0] - 1 >= P.daiRecoveryBps / 10000) {
        const size = min(units(P.daiMaxUsd), BigInt(obs.balances.usdcUnits) / 50n);
        if (size >= 20n * U && funded(obs, "USDC", size)) {
          dai.used = true; dai.entered = block; dai.entry = s.priceUsdc;
          return send({ type: "stableSwap", stable: "DAI", tokenIn: "USDC", amountIn: size.toString(), slippageBps: 35, reason: "small confirmed DAI recovery; no averaging down" });
        }
      }
    }
    return arbitrage(obs, shocked) ?? { type: "noop", reason: "no funded edge after costs and regime guards" };
  };
}

export const decide = createAgent();
