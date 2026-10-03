/**
 * grok-1: hedged basis, redeemable discounts, and inventory-neutral venue spreads.
 *
 * The score is a relative T-score. The funded basket (WETH and WBTC) is the same for the whole
 * field, so its beta cancels. What does not cancel is inventory this agent alone adds or drops.
 * The strategy therefore never hedges or sells that basket, never buys extra base to enter a
 * carry, and never holds a plain stable or a launch token into the bell.
 *
 * Where it does earn:
 *   - an atomic two-venue spread on WETH or WBTC (the sell leg is funded inside the bundle)
 *   - a buy of base that an AMM quotes below fair, hedged by a GMX short of only the acquired
 *     delta. The rich-side mirror (sell the basket, long the perp) is a naked short of the shared
 *     basket for the keeper delay, which is the worst round the tie-break punishes
 *   - eUSD bought below par and redeemed for collateral, then unwound back to the baseline
 *   - an LST secondary-market discount, only when the withdrawal queue still finishes this epoch,
 *     sized off WETH the wallet already holds, and exited inside the same cycle
 *
 * One action per block. A hedge that has not landed blocks every new spot leg. State lives on
 * globalThis under "__grok1" because a later revision runs in a fresh realm.
 */
import type {
  AgentAction,
  AgentContext,
  AgentObservation,
  BundleActionItem,
  GmxMarketObservation,
} from "@eris/sdk";
import { TOKENS } from "@eris/sdk/constants.js";
import { marketViews, type AgentVenue, type MarketView } from "../lib/markets.js";

/** Every numeric gate. A revision may change these numbers and the comparisons that read them. */
export const PARAMS = {
  twoLegSafetyBps: 50,
  twoLegMinSizeBps: 250,
  twoLegMaxSizeBps: 2500,
  twoLegSpreadGain: 200000,
  twoLegSellFracBps: 9800,
  twoLegSlippageBps: 120,
  minTwoLegUsdc: 100,
  basisSafetyBps: 12,
  basisDelayMult: 0.5,
  basisUnknownDelayBps: 18,
  basisMinSizeBps: 800,
  basisMaxSizeBps: 1800,
  basisSizeGain: 90000,
  basisHedgeTolUsd: 250,
  basisHedgeLeverage: 1.5,
  basisMaxOrderUsd: 25000,
  basisMinLegUsd: 400,
  basisSlippageBps: 100,
  basisOrderCostEth: 0.0001,
  basisGmxRoundTripBps: 0,
  basisMaxBookUsd: 10000,
  hedgeDelayBlocks: 2,
  pendingHedgeTtl: 3,
  redeemSafetyBps: 25,
  redeemExitCostBps: 35,
  redeemBuyFractionBps: 1800,
  redeemMaxPoolShareBps: 800,
  redeemImpactConvexity: 1.5,
  redeemSlippageBps: 80,
  minEusd: 200,
  minUsdc: 250,
  minWeth: 0.01,
  lstPoolCostBps: 12,
  lstSafetyBps: 20,
  lstQueueMarginBlocks: 6,
  lstSliceBps: 800,
  minLstWeth: 0.05,
  lstSlippageBps: 50,
  noNewRiskBlocks: 24,
  cycleAbortBlocks: 4,
  bidEdgeBps: 80,
  bidUpliftBps: 1000,
};

const BASES = ["WETH", "WBTC"] as const;
type BaseName = (typeof BASES)[number];
const LEDGER_KEY = "__grok1";

export type PendingHedge = {
  signedUsd: number;
  sinceRound: number;
  observedUsd: number;
};

export type Ledger = {
  ready: boolean;
  baselineWeth: string;
  baselineWbtc: string;
  baselineEth: string;
  lastWeth: string;
  cycle: "idle" | "redeem" | "lst";
  cycleSince: number;
  frozenWeth: string;
  frozenWbtc: string;
  pendingCredit: string;
  pendingCreditSince: number;
  lstSpent: string;
  pendingWeth: PendingHedge | null;
  pendingWbtc: PendingHedge | null;
};

export type PlanResult = {
  action: AgentAction;
  reason: string;
  edgeBps: number;
};

type Bag = typeof globalThis & { __grok1?: Ledger };

export function freshLedger(): Ledger {
  return {
    ready: false,
    baselineWeth: "0",
    baselineWbtc: "0",
    baselineEth: "0",
    lastWeth: "0",
    cycle: "idle",
    cycleSince: 0,
    frozenWeth: "0",
    frozenWbtc: "0",
    pendingCredit: "0",
    pendingCreditSince: 0,
    lstSpent: "0",
    pendingWeth: null,
    pendingWbtc: null,
  };
}

export function resetLedger(): void {
  delete (globalThis as Bag)[LEDGER_KEY];
}

function loadLedger(): Ledger {
  const g = globalThis as Bag;
  if (!g[LEDGER_KEY]) g[LEDGER_KEY] = freshLedger();
  return g[LEDGER_KEY];
}

function bi(value: string | undefined | null): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function minBI(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function fraction(amount: bigint, bps: number): bigint {
  const b = Math.max(0, Math.round(bps));
  return (amount * BigInt(b)) / 10_000n;
}

function minEusdWei(): bigint {
  return BigInt(PARAMS.minEusd) * 10n ** 18n;
}
function minUsdcUnits(): bigint {
  return BigInt(PARAMS.minUsdc) * 1_000_000n;
}
function minWethWei(): bigint {
  return BigInt(Math.round(PARAMS.minWeth * 1e18));
}
function minLstWei(): bigint {
  return BigInt(Math.round(PARAMS.minLstWeth * 1e18));
}

/** Token count plus 8 decimal digits. Avoids Number() on a raw 18-decimal wei. */
function weiToFloat(wei: bigint, decimals: number): number {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = v / scale;
  const rest = v % scale;
  let n: number;
  if (decimals <= 8) {
    n = Number(whole) + Number(rest) / 10 ** decimals;
  } else {
    const fracDiv = 10n ** BigInt(decimals - 8);
    n = Number(whole) + Number(rest / fracDiv) / 1e8;
  }
  return neg ? -n : n;
}

function usdTo1e30(usd: number): string {
  return BigInt(Math.max(0, Math.floor(usd * 1e6))).toString() + "0".repeat(24);
}

function done(action: AgentAction, reason: string, edgeBps = 0): PlanResult {
  return { action, reason, edgeBps };
}

function noop(reason: string, edgeBps = 0): PlanResult {
  return done({ type: "noop", reason }, reason, edgeBps);
}

function isBase(base: string): base is BaseName {
  return base === "WETH" || base === "WBTC";
}

function decimalsOf(obs: AgentObservation, base: BaseName): number {
  if (base === "WBTC") return obs.baseDecimals?.WBTC ?? 8;
  return obs.baseDecimals?.WETH ?? 18;
}

function balanceOf(obs: AgentObservation, base: BaseName): bigint {
  if (base === "WETH") return bi(obs.balances.wethWei);
  return bi(obs.baseBalances?.WBTC);
}

function baselineOf(ledger: Ledger, base: BaseName): bigint {
  return bi(base === "WETH" ? ledger.baselineWeth : ledger.baselineWbtc);
}

function frozenOf(ledger: Ledger, base: BaseName): bigint {
  return bi(base === "WETH" ? ledger.frozenWeth : ledger.frozenWbtc);
}

function fairOf(obs: AgentObservation, base: BaseName): number {
  if (base === "WETH") return obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
  const fair = obs.fairPricesUsd?.WBTC;
  return typeof fair === "number" ? fair : 0;
}

function excessWei(obs: AgentObservation, ledger: Ledger, base: BaseName): bigint {
  if (ledger.cycle !== "idle") return frozenOf(ledger, base);
  return balanceOf(obs, base) - baselineOf(ledger, base);
}

function boot(obs: AgentObservation, ledger: Ledger): void {
  if (ledger.ready) return;
  ledger.baselineWeth = obs.balances.wethWei || "0";
  ledger.baselineWbtc = obs.baseBalances?.WBTC || "0";
  ledger.baselineEth = obs.balances.ethWei || "0";
  ledger.lastWeth = obs.balances.wethWei || "0";
  ledger.ready = true;
}

/**
 * A claim or harvest pays WETH. Only the part above what the cycle spent is new inventory;
 * booking that part into the baseline stops the hedge from shorting a profit or from treating
 * a round-trip fee as a short the basket did not have.
 */
function settleClaim(obs: AgentObservation, ledger: Ledger): void {
  const weth = bi(obs.balances.wethWei);
  const credit = bi(ledger.pendingCredit);
  if (credit > 0n) {
    const last = bi(ledger.lastWeth);
    if (weth > last) {
      const delta = weth - last;
      const spent = bi(ledger.lstSpent);
      const profit = delta > spent ? delta - spent : 0n;
      if (profit > 0n) {
        ledger.baselineWeth = (bi(ledger.baselineWeth) + profit).toString();
      }
      ledger.pendingCredit = "0";
      ledger.lstSpent = "0";
      ledger.frozenWeth = "0";
      ledger.frozenWbtc = "0";
      if (ledger.cycle === "lst") ledger.cycle = "idle";
    } else if (obs.round - ledger.pendingCreditSince >= PARAMS.cycleAbortBlocks) {
      ledger.pendingCredit = "0";
    }
  }
  ledger.lastWeth = weth.toString();
}

function snapshotFrozen(obs: AgentObservation, ledger: Ledger): void {
  ledger.frozenWeth = (balanceOf(obs, "WETH") - baselineOf(ledger, "WETH")).toString();
  ledger.frozenWbtc = (balanceOf(obs, "WBTC") - baselineOf(ledger, "WBTC")).toString();
}

function clearCycle(ledger: Ledger): void {
  ledger.cycle = "idle";
  ledger.frozenWeth = "0";
  ledger.frozenWbtc = "0";
}

function gmxMarket(
  obs: AgentObservation,
  base: BaseName,
): GmxMarketObservation | undefined {
  const gmx = obs.protocols?.gmx;
  if (!gmx) return undefined;
  if (base === "WETH") return gmx;
  const markets = gmx.markets ?? {};
  if (markets[`${base}/USDC`]) return markets[`${base}/USDC`];
  if (markets[base]) return markets[base];
  for (const [key, market] of Object.entries(markets)) {
    if (key.startsWith(base)) return market;
  }
  return undefined;
}

function perpSignedUsd(market: GmxMarketObservation | undefined): number {
  const pos = market?.position;
  if (!pos) return 0;
  const size = Number(pos.sizeUsd) / 1e30;
  if (!Number.isFinite(size)) return 0;
  return pos.isLong ? size : -size;
}

function pendingOf(ledger: Ledger, base: BaseName): PendingHedge | null {
  return base === "WETH" ? ledger.pendingWeth : ledger.pendingWbtc;
}

function setPending(ledger: Ledger, base: BaseName, pending: PendingHedge | null): void {
  if (base === "WETH") ledger.pendingWeth = pending;
  else ledger.pendingWbtc = pending;
}

/** Clears a hedge once the position moves by more than a dollar, or the order has had its TTL. */
function takePending(
  obs: AgentObservation,
  ledger: Ledger,
  base: BaseName,
  observedUsd: number,
): number {
  const pending = pendingOf(ledger, base);
  if (!pending) return 0;
  const landed = Math.abs(observedUsd - pending.observedUsd) > 1;
  const expired = obs.round - pending.sinceRound >= PARAMS.pendingHedgeTtl;
  if (landed || expired) {
    setPending(ledger, base, null);
    return 0;
  }
  return pending.signedUsd;
}

function anyPending(ledger: Ledger): boolean {
  return ledger.pendingWeth !== null || ledger.pendingWbtc !== null;
}

function quoteOf(v: AgentVenue): { buy: number; sell: number } {
  const edge = v.feeBps / 10_000;
  return {
    buy: v.buyPrice ?? v.price * (1 + edge),
    sell: v.sellPrice ?? v.price * (1 - edge),
  };
}

function viewsOf(obs: AgentObservation): MarketView[] {
  return marketViews(obs).filter((v) => isBase(v.base));
}

/**
 * Keeper delay as a cost. A full standard deviation is a risk premium, so only half is charged.
 * With no history the charge is a flat unknown-delay bps, not that half times zero.
 */
function delayBps(obs: AgentObservation): number {
  const history = obs.history;
  if (!history || history.length < 3) return PARAMS.basisUnknownDelayBps;
  const recent = history.slice(-24);
  const rets: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1].fairPriceUsdcPerWeth;
    const b = recent[i].fairPriceUsdcPerWeth;
    if (a > 0 && b > 0) rets.push(b / a - 1);
  }
  if (rets.length < 2) return PARAMS.basisUnknownDelayBps;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return (
    Math.sqrt(variance) *
    Math.sqrt(PARAMS.hedgeDelayBlocks) *
    10_000 *
    PARAMS.basisDelayMult
  );
}

function costBps(obs: AgentObservation, notionalUsd: number, fair: number): number {
  const exec =
    notionalUsd > 0 ? ((PARAMS.basisOrderCostEth * fair) / notionalUsd) * 10_000 : 0;
  return PARAMS.basisGmxRoundTripBps + exec + delayBps(obs) + PARAMS.basisSafetyBps;
}

function priorityFee(obs: AgentObservation, edgeBps: number, aggressive: boolean): string {
  const fallback = obs.limits.defaultPriorityFeePerGasWei;
  if (!aggressive || !(edgeBps > PARAMS.bidEdgeBps)) return fallback;
  const competitor = bi(obs.competition?.maxCompetitorPriorityFeeWei);
  const floor = bi(fallback);
  if (!(competitor > floor)) return fallback;
  const uplift = (competitor * BigInt(PARAMS.bidUpliftBps)) / 10_000n;
  const bump = uplift > 1n ? uplift : 1n;
  const cap = bi(obs.limits.maxPriorityFeePerGasWei);
  const bid = competitor + bump;
  return (bid > cap && cap > 0n ? cap : bid).toString();
}

function tooLate(obs: AgentObservation): boolean {
  return obs.blocksRemaining !== undefined && obs.blocksRemaining < PARAMS.noNewRiskBlocks;
}

function positionOpen(obs: AgentObservation, ledger: Ledger): boolean {
  for (const base of BASES) {
    const fair = fairOf(obs, base);
    if (!(fair > 0)) continue;
    const live = balanceOf(obs, base) - baselineOf(ledger, base);
    const usd = Math.abs(weiToFloat(live, decimalsOf(obs, base))) * fair;
    if (usd > PARAMS.basisHedgeTolUsd) return true;
    if (Math.abs(perpSignedUsd(gmxMarket(obs, base))) > PARAMS.basisHedgeTolUsd) return true;
  }
  return false;
}

function withBase(
  swapType: AgentVenue["swapType"],
  tokenIn: string,
  amountIn: string,
  base: string,
  slippageBps: number,
): BundleActionItem {
  const common = { tokenIn, amountIn, slippageBps };
  const tagged = base === "WETH" ? common : { ...common, base };
  if (swapType === "balancerSwap") return { type: "balancerSwap", ...tagged };
  if (swapType === "curveSwap") return { type: "curveSwap", ...tagged };
  return { type: "swap", ...tagged };
}

function spotAction(
  venue: AgentVenue,
  tokenIn: string,
  amountIn: bigint,
  base: string,
  slippageBps: number,
  fee: string,
): AgentAction {
  const action: AgentAction = withBase(venue.swapType, tokenIn, amountIn.toString(), base, slippageBps);
  return { ...action, maxPriorityFeePerGasWei: fee };
}

function hedgeDeltaUsd(action: AgentAction): number {
  if (action.type !== "gmxIncrease" && action.type !== "gmxDecrease") return 0;
  const size = Number(action.sizeDeltaUsd) / 1e30;
  if (!Number.isFinite(size)) return 0;
  const sign = action.type === "gmxDecrease" ? -1 : 1;
  return sign * (action.isLong ? size : -size);
}

function hedgeAction(
  obs: AgentObservation,
  market: GmxMarketObservation,
  base: BaseName,
  currentSignedUsd: number,
  gapUsd: number,
  fee: string,
): AgentAction | null {
  const holdingLong = currentSignedUsd > 0;
  const holdingSize = Math.abs(currentSignedUsd);
  const wantSigned = currentSignedUsd + gapUsd;
  const flipping =
    holdingSize > 0 && Math.sign(wantSigned) === -Math.sign(currentSignedUsd);
  const reducing = holdingSize > 0 && Math.abs(wantSigned) < holdingSize;

  if (flipping || reducing) {
    const sizeUsd = Math.min(
      flipping ? holdingSize : Math.min(holdingSize, Math.abs(gapUsd)),
      PARAMS.basisMaxOrderUsd,
    );
    if (!(sizeUsd > 0)) return null;
    const collateralUnits = bi(market.position?.collateralAmount);
    const frac = Math.min(1, sizeUsd / holdingSize);
    const collateralDelta = (collateralUnits * BigInt(Math.round(frac * 10_000))) / 10_000n;
    return {
      type: "gmxDecrease",
      isLong: holdingLong,
      base,
      collateral: "USDC",
      collateralDeltaAmount: collateralDelta.toString(),
      sizeDeltaUsd: usdTo1e30(sizeUsd),
      maxPriorityFeePerGasWei: fee,
    };
  }

  const sizeUsd = Math.min(Math.abs(gapUsd), PARAMS.basisMaxOrderUsd);
  if (!(sizeUsd > 0)) return null;
  const collateralUsdc = BigInt(Math.floor((sizeUsd / PARAMS.basisHedgeLeverage) * 1e6));
  const usdcBal = bi(obs.balances.usdcUnits);
  if (collateralUsdc <= 0n || collateralUsdc > usdcBal) return null;
  return {
    type: "gmxIncrease",
    isLong: wantSigned > 0,
    base,
    collateral: "USDC",
    collateralAmount: collateralUsdc.toString(),
    sizeDeltaUsd: usdTo1e30(sizeUsd),
    maxPriorityFeePerGasWei: fee,
  };
}

function unwindAcquired(
  obs: AgentObservation,
  ledger: Ledger,
  view: MarketView,
  fee: string,
): AgentAction | null {
  if (!isBase(view.base) || view.venues.length === 0) return null;
  const base = view.base;
  const bal = balanceOf(obs, base);
  const baseline = baselineOf(ledger, base);
  const acquired = bal > baseline ? bal - baseline : 0n;
  if (acquired <= 0n) return null;
  const amount = minBI(acquired, bal);
  const notional = weiToFloat(amount, view.baseDecimals) * view.fair;
  if (!(notional >= PARAMS.basisMinLegUsd)) return null;
  let best = view.venues[0];
  for (const venue of view.venues) {
    if (quoteOf(venue).sell > quoteOf(best).sell) best = venue;
  }
  return spotAction(best, base, amount, base, PARAMS.basisSlippageBps, fee);
}

type HedgeNeed = {
  base: BaseName;
  gapUsd: number;
  current: number;
  observed: number;
  view: MarketView | undefined;
  market: GmxMarketObservation | undefined;
};

function hedgeStep(
  obs: AgentObservation,
  ledger: Ledger,
  views: MarketView[],
  fee: string,
): PlanResult | null {
  const needs: HedgeNeed[] = [];
  for (const base of BASES) {
    const fair = fairOf(obs, base);
    if (!(fair > 0)) continue;
    const market = gmxMarket(obs, base);
    const observed = perpSignedUsd(market);
    const pending = market ? takePending(obs, ledger, base, observed) : 0;
    const excess = excessWei(obs, ledger, base);
    const target = -weiToFloat(excess, decimalsOf(obs, base)) * fair;
    const current = observed + pending;
    const gapUsd = target - current;
    if (Math.abs(gapUsd) > PARAMS.basisHedgeTolUsd) {
      needs.push({
        base,
        gapUsd,
        current,
        observed,
        view: views.find((v) => v.base === base),
        market,
      });
    }
  }
  if (needs.length === 0) return null;
  needs.sort((a, b) => Math.abs(b.gapUsd) - Math.abs(a.gapUsd));
  const top = needs[0];
  if (top.market) {
    const action = hedgeAction(obs, top.market, top.base, top.current, top.gapUsd, fee);
    if (action) {
      setPending(ledger, top.base, {
        signedUsd: hedgeDeltaUsd(action),
        sinceRound: obs.round,
        observedUsd: top.observed,
      });
      return done(action, `hedge ${top.base} gap ${top.gapUsd.toFixed(0)}`);
    }
  }
  if (ledger.cycle === "idle" && top.view) {
    const unwind = unwindAcquired(obs, ledger, top.view, fee);
    if (unwind) return done(unwind, `unwind acquired ${top.base}; hedge unaffordable`);
  }
  return noop(`hedge gap unaffordable ${top.gapUsd.toFixed(0)}`);
}

function twoLeg(obs: AgentObservation, views: MarketView[]): PlanResult | null {
  const usdcBal = bi(obs.balances.usdcUnits);
  const minUsdc = BigInt(PARAMS.minTwoLegUsdc) * 1_000_000n;
  if (usdcBal < minUsdc) return null;
  let best: {
    spread: number;
    edgeBps: number;
    cheap: AgentVenue;
    rich: AgentVenue;
    base: string;
    usdcIn: bigint;
    baseSell: bigint;
  } | null = null;

  for (const view of views) {
    for (const cheap of view.venues) {
      for (const rich of view.venues) {
        if (cheap.protocol === rich.protocol) continue;
        if (!(cheap.price > 0) || !(rich.price > cheap.price)) continue;
        const bothExec =
          cheap.sellPrice !== undefined &&
          cheap.buyPrice !== undefined &&
          rich.sellPrice !== undefined &&
          rich.buyPrice !== undefined;
        const spread = bothExec
          ? rich.sellPrice! / cheap.buyPrice! - 1
          : rich.price / cheap.price - 1;
        const roundtrip = bothExec
          ? PARAMS.twoLegSafetyBps / 10_000
          : (cheap.feeBps + rich.feeBps + PARAMS.twoLegSafetyBps) / 10_000;
        if (!(spread > roundtrip)) continue;
        const net = spread - roundtrip;
        const sizeBps = Math.min(
          PARAMS.twoLegMaxSizeBps,
          Math.max(PARAMS.twoLegMinSizeBps, Math.floor(net * PARAMS.twoLegSpreadGain)),
        );
        const usdcIn = (usdcBal * BigInt(sizeBps)) / 10_000n;
        if (usdcIn < minUsdc) continue;
        const buyPx = bothExec
          ? cheap.buyPrice!
          : (cheap.buyPrice ?? cheap.price * (1 + cheap.feeBps / 10_000));
        if (!(buyPx > 0)) continue;
        const price1e6 = BigInt(Math.round(buyPx * 1e6));
        if (price1e6 <= 0n) continue;
        const scale = 10n ** BigInt(view.baseDecimals);
        const baseSell =
          (usdcIn * scale * BigInt(PARAMS.twoLegSellFracBps)) / (price1e6 * 10_000n);
        if (baseSell <= 0n) continue;
        if (!best || spread > best.spread) {
          best = {
            spread,
            edgeBps: spread * 10_000,
            cheap,
            rich,
            base: view.base,
            usdcIn,
            baseSell,
          };
        }
      }
    }
  }
  if (!best) return null;
  const fee = priorityFee(obs, best.edgeBps, true);
  const action: AgentAction = {
    type: "bundle",
    actions: [
      withBase(best.cheap.swapType, "USDC", best.usdcIn.toString(), best.base, PARAMS.twoLegSlippageBps),
      withBase(best.rich.swapType, best.base, best.baseSell.toString(), best.base, PARAMS.twoLegSlippageBps),
    ],
    maxPriorityFeePerGasWei: fee,
  };
  return done(action, `two-leg ${best.base} ${best.edgeBps.toFixed(1)} bps`, best.edgeBps);
}

function canSellEth(obs: AgentObservation): boolean {
  return obs.enabledProtocols.includes("uniswap");
}

function handleRedeem(
  obs: AgentObservation,
  ledger: Ledger,
  fee: string,
): PlanResult | "fall" {
  const liquity = obs.protocols?.liquity;
  const weth = bi(obs.balances.wethWei);
  const eth = bi(obs.balances.ethWei);
  if (canSellEth(obs) && liquity) {
    const floor = baselineOf(ledger, "WETH") + frozenOf(ledger, "WETH");
    const sellable = weth > floor ? weth - floor : 0n;
    if (sellable >= minWethWei()) {
      const view = viewsOf(obs).find((v) => v.base === "WETH");
      const venue = view?.venues.find((v) => v.protocol === "uniswap") ?? view?.venues[0];
      if (venue) {
        return done(
          spotAction(venue, "WETH", sellable, "WETH", PARAMS.redeemSlippageBps, fee),
          "sell redemption proceeds above baseline",
        );
      }
    }
    const ethBase = bi(ledger.baselineEth);
    const suggested = bi(liquity.suggestedGasReserveWei);
    const reserve = ethBase > suggested ? ethBase : suggested;
    if (eth > reserve + minWethWei()) {
      return done(
        {
          type: "rawTx",
          tx: {
            to: TOKENS.WETH.address,
            data: "0xd0e30db0",
            value: (eth - reserve).toString(),
          },
          maxPriorityFeePerGasWei: fee,
        },
        "wrap redemption eth",
      );
    }
  }

  const eusd = liquity ? bi(liquity.eusdBalanceWei) : 0n;
  if (liquity && eusd >= minEusdWei()) {
    if (liquity.marketQuoted && liquity.discountBps <= 0) {
      return done(
        {
          type: "liquitySwapEusd",
          tokenIn: "EUSD",
          amountIn: eusd.toString(),
          slippageBps: PARAMS.redeemSlippageBps,
          maxPriorityFeePerGasWei: fee,
        },
        "sell eUSD at or above par",
        -liquity.discountBps,
      );
    }
    const redeemEdge = liquity.redemptionEdgeBps - PARAMS.redeemExitCostBps;
    if (redeemEdge > 0) {
      return done(
        {
          type: "liquityRedeem",
          amountEusdWei: eusd.toString(),
          maxPriorityFeePerGasWei: fee,
        },
        "redeem eUSD",
        redeemEdge,
      );
    }
    return noop(
      `holding eUSD; redeem edge ${redeemEdge.toFixed(1)} bps and discount ${liquity.discountBps.toFixed(1)}`,
      redeemEdge,
    );
  }

  if (obs.round - ledger.cycleSince >= PARAMS.cycleAbortBlocks) {
    clearCycle(ledger);
    return "fall";
  }
  return noop("redeem settlement pending");
}

function queueDelayBlocks(lst: NonNullable<AgentObservation["protocols"]["lst"]>): number {
  return Number.isFinite(lst.estimatedQueueDelayBlocks)
    ? lst.estimatedQueueDelayBlocks
    : lst.withdrawalDelayBlocks;
}

function queueFits(
  obs: AgentObservation,
  lst: NonNullable<AgentObservation["protocols"]["lst"]>,
): boolean {
  if (obs.blocksRemaining === undefined) return true;
  return obs.blocksRemaining > queueDelayBlocks(lst) + PARAMS.lstQueueMarginBlocks;
}

function queueableShares(
  obs: AgentObservation,
  lst: NonNullable<AgentObservation["protocols"]["lst"]>,
  shares: bigint,
): bigint {
  const throughput = bi(lst.queueThroughputWeiPerBlock);
  const redemptionValue = bi(lst.lstRedemptionValueWethWei);
  if (throughput <= 0n || obs.blocksRemaining === undefined || redemptionValue <= 0n) {
    return shares;
  }
  const marginal = lst.queueDelayPerWethBlocks ?? lst.withdrawalDelayBlocks;
  const drain = obs.blocksRemaining - marginal - PARAMS.lstQueueMarginBlocks;
  if (drain <= 0) return 0n;
  const affordable = BigInt(drain) * throughput;
  if (affordable >= redemptionValue) return shares;
  return (shares * affordable) / redemptionValue;
}

function lstEdgeBps(lst: NonNullable<AgentObservation["protocols"]["lst"]>): number {
  if (lst.marketQuoted === false) return Number.NEGATIVE_INFINITY;
  return lst.discountBps - PARAMS.lstPoolCostBps - PARAMS.lstSafetyBps;
}

function handleLst(
  obs: AgentObservation,
  ledger: Ledger,
  fee: string,
): PlanResult | "fall" | null {
  const lst = obs.protocols?.lst;
  const shares = lst ? bi(lst.lstBalanceWei) : 0n;
  const pending = lst ? bi(lst.pendingWithdrawalWethWei) : 0n;
  const claimable = lst ? bi(lst.claimableWithdrawalWethWei) : 0n;
  if (lst && shares > 0n) {
    const edge = lstEdgeBps(lst);
    const queued = queueableShares(obs, lst, shares);
    if (edge > 0 && queueFits(obs, lst) && queued >= minLstWei()) {
      return done(
        {
          type: "lstRequestWithdraw",
          amountLstWei: queued.toString(),
          maxPriorityFeePerGasWei: fee,
        },
        "queue lst discount",
        edge,
      );
    }
    ledger.pendingCredit = bi(ledger.lstSpent) > 0n ? ledger.lstSpent : "1";
    ledger.pendingCreditSince = obs.round;
    return done(
      {
        type: "lstSwap",
        tokenIn: "LST",
        amountIn: shares.toString(),
        slippageBps: PARAMS.lstSlippageBps,
        maxPriorityFeePerGasWei: fee,
      },
      "harvest lst inside the cycle",
      edge,
    );
  }
  if (shares === 0n && pending === 0n && claimable === 0n) {
    if (obs.round - ledger.cycleSince >= PARAMS.cycleAbortBlocks) {
      clearCycle(ledger);
      return "fall";
    }
    return noop("lst buy in flight");
  }
  return null;
}

function poolImbalanceUsdc(l: NonNullable<AgentObservation["protocols"]["liquity"]>): bigint {
  if (!l.poolReserves) return 0n;
  const eusd = bi(l.poolReserves.eusd) / 10n ** 12n;
  const usdc = bi(l.poolReserves.usdc);
  return eusd > usdc ? (eusd - usdc) / 2n : 0n;
}

function redeemBuy(obs: AgentObservation, ledger: Ledger): PlanResult | null {
  const l = obs.protocols?.liquity;
  if (!l || l.marketQuoted === false) return null;
  if (bi(l.eusdBalanceWei) >= minEusdWei()) return null;
  if (positionOpen(obs, ledger)) return null;
  const edge = l.discountBps - l.redemptionRateBps - PARAMS.redeemExitCostBps - PARAMS.redeemSafetyBps;
  if (!(edge > 0)) return null;
  const usdc = bi(obs.balances.usdcUnits);
  if (usdc < minUsdcUnits()) return null;
  let size = fraction(usdc, PARAMS.redeemBuyFractionBps);
  const poolEusd = l.poolReserves ? bi(l.poolReserves.eusd) : 0n;
  if (poolEusd > 0n) {
    const capUsdc = fraction(poolEusd, PARAMS.redeemMaxPoolShareBps) / 10n ** 12n;
    if (capUsdc > 0n) size = minBI(size, capUsdc);
  }
  const room = l.discountBps - (l.redemptionRateBps + PARAMS.redeemExitCostBps) - PARAMS.redeemSafetyBps;
  const imbalance = poolImbalanceUsdc(l);
  if (imbalance > 0n && l.discountBps > 0) {
    const affordable =
      room > 0
        ? (imbalance * BigInt(Math.floor(room * 1000))) /
          BigInt(Math.ceil(2 * PARAMS.redeemImpactConvexity * l.discountBps * 1000))
        : 0n;
    size = minBI(size, affordable);
  }
  if (size < minUsdcUnits()) return null;
  snapshotFrozen(obs, ledger);
  ledger.cycle = "redeem";
  ledger.cycleSince = obs.round;
  return done(
    {
      type: "liquitySwapEusd",
      tokenIn: "USDC",
      amountIn: size.toString(),
      slippageBps: PARAMS.redeemSlippageBps,
      maxPriorityFeePerGasWei: priorityFee(obs, edge, true),
    },
    "buy discounted eUSD",
    edge,
  );
}

function usdcSpendable(usdc: bigint): bigint {
  const l = BigInt(Math.round(PARAMS.basisHedgeLeverage * 1000));
  return (usdc * l) / (l + 1000n);
}

function basisSizeBps(netEdge: number): number {
  if (!Number.isFinite(netEdge)) return 0;
  const scaled = Math.floor(netEdge * PARAMS.basisSizeGain);
  return Math.min(PARAMS.basisMaxSizeBps, Math.max(PARAMS.basisMinSizeBps, scaled));
}

function basisOpen(obs: AgentObservation, views: MarketView[]): PlanResult | null {
  let best: { edgeBps: number; action: AgentAction } | null = null;
  for (const base of BASES) {
    const market = gmxMarket(obs, base);
    const view = views.find((v) => v.base === base);
    if (!market || !view || !(view.fair > 0)) continue;
    const book = Math.abs(perpSignedUsd(market));
    if (book >= PARAMS.basisMaxBookUsd - PARAMS.basisMinLegUsd) continue;
    const roomUsd = PARAMS.basisMaxBookUsd - book;
    const spendable = usdcSpendable(bi(obs.balances.usdcUnits));
    if (spendable <= 0n) continue;
    for (const venue of view.venues) {
      const q = quoteOf(venue);
      if (!(q.buy > 0) || !Number.isFinite(q.buy)) continue;
      const edgeBps = (1 - q.buy / view.fair) * 10_000;
      const probeUsd = Number(spendable) / 1e6;
      const net = edgeBps / 10_000 - costBps(obs, probeUsd, view.fair) / 10_000;
      const sizeBps = basisSizeBps(net);
      if (!(sizeBps > 0)) continue;
      let amountIn = (spendable * BigInt(sizeBps)) / 10_000n;
      const roomUnits = BigInt(Math.floor(roomUsd * 1e6));
      if (amountIn > roomUnits) amountIn = roomUnits;
      const legUsd = Number(amountIn) / 1e6;
      if (!(edgeBps > costBps(obs, legUsd, view.fair))) continue;
      if (amountIn < BigInt(Math.floor(PARAMS.basisMinLegUsd * 1e6))) continue;
      if (!best || edgeBps > best.edgeBps) {
        best = {
          edgeBps,
          action: spotAction(
            venue,
            "USDC",
            amountIn,
            base,
            PARAMS.basisSlippageBps,
            priorityFee(obs, edgeBps, true),
          ),
        };
      }
    }
  }
  if (!best) return null;
  return done(best.action, `basis buy ${best.edgeBps.toFixed(1)} bps`, best.edgeBps);
}

function lstBuy(obs: AgentObservation, ledger: Ledger): PlanResult | null {
  const lst = obs.protocols?.lst;
  if (!lst || positionOpen(obs, ledger)) return null;
  const edge = lstEdgeBps(lst);
  if (!(edge > 0) || !queueFits(obs, lst)) return null;
  const weth = bi(obs.balances.wethWei);
  const amount = (weth * BigInt(PARAMS.lstSliceBps)) / 10_000n;
  if (amount < minLstWei()) return null;
  snapshotFrozen(obs, ledger);
  ledger.lstSpent = amount.toString();
  ledger.cycle = "lst";
  ledger.cycleSince = obs.round;
  return done(
    {
      type: "lstSwap",
      tokenIn: "WETH",
      amountIn: amount.toString(),
      slippageBps: PARAMS.lstSlippageBps,
      maxPriorityFeePerGasWei: priorityFee(obs, edge, true),
    },
    "buy lst discount",
    edge,
  );
}

/**
 * One block, one action. Hedges and exits run before any new risk. A two-leg spread is the
 * exception that may run while an LST redemption is merely waiting, because the bundle does not
 * leave a directional residual above the hedge tolerance.
 */
export function plan(obs: AgentObservation, ledger: Ledger): PlanResult {
  boot(obs, ledger);
  settleClaim(obs, ledger);
  const fee = obs.limits.defaultPriorityFeePerGasWei;
  const views = viewsOf(obs);
  const lst = obs.protocols?.lst;

  if (lst && bi(lst.claimableWithdrawalWethWei) > 0n) {
    ledger.pendingCredit = lst.claimableWithdrawalWethWei;
    ledger.pendingCreditSince = obs.round;
    return done(
      { type: "lstClaimWithdraw", maxPriorityFeePerGasWei: fee },
      "claim lst withdrawal",
    );
  }

  const liquity = obs.protocols?.liquity;
  if (
    ledger.cycle === "idle" &&
    liquity &&
    bi(liquity.eusdBalanceWei) >= minEusdWei()
  ) {
    snapshotFrozen(obs, ledger);
    ledger.cycle = "redeem";
    ledger.cycleSince = obs.round;
  }

  if (ledger.cycle === "redeem") {
    const step = handleRedeem(obs, ledger, fee);
    if (step !== "fall") return step;
  }

  if (ledger.cycle === "lst") {
    const step = handleLst(obs, ledger, fee);
    if (step !== "fall" && step !== null) return step;
  }

  const hedged = hedgeStep(obs, ledger, views, fee);
  if (hedged) return hedged;
  if (anyPending(ledger)) return noop("hedge in flight");

  if (ledger.cycle !== "redeem") {
    const spread = twoLeg(obs, views);
    if (spread) return spread;
  }

  if (tooLate(obs) || ledger.cycle !== "idle") {
    const left = obs.blocksRemaining === undefined ? -1 : obs.blocksRemaining;
    return noop(`no new risk (cycle ${ledger.cycle}, ${left} blocks left)`);
  }

  const bought = redeemBuy(obs, ledger);
  if (bought) return bought;
  const basis = basisOpen(obs, views);
  if (basis) return basis;
  const carry = lstBuy(obs, ledger);
  if (carry) return carry;

  const sample = costBps(obs, 1000, fairOf(obs, "WETH") || obs.fairPriceUsdcPerWeth);
  const left = obs.blocksRemaining === undefined ? -1 : obs.blocksRemaining;
  return noop(`no edge above ~${sample.toFixed(0)} bps (${left} blocks left)`, sample);
}

export function decide(
  obs: AgentObservation,
  ctx?: AgentContext,
): AgentAction {
  try {
    const ledger = loadLedger();
    const out = plan(obs, ledger);
    const cycle = ledger.cycle === "redeem" ? 1 : ledger.cycle === "lst" ? 2 : 0;
    ctx?.log({
      round: obs.round,
      reason: out.reason,
      signals: { cycle, edgeBps: out.edgeBps },
    });
    return out.action;
  } catch {
    return { type: "noop", reason: "decide failed closed" };
  }
}
