/**
 * opus-1w — opus-1a plus the observation-only M0 whale/incident planner.
 * opus-1 is an edge-gated, inventory-anchored opportunist.
 *
 * ## The thesis
 *
 * The score is a deviation score over the field: T = 50 + 10 (P - mu) / sigma, averaged over many
 * epochs. Two consequences drive every design choice here.
 *
 * 1. **Beta is not alpha.** Roughly two thirds of the starting portfolio (8 WETH + 0.4 WBTC against
 *    25,000 USDC) is directional exposure that *every* agent in the field carries. Whatever the
 *    market does to it lands in mu and cancels. Deviating from that exposure does not add expected
 *    P -- an epoch is twelve minutes of a mean-reverting walk whose crash and spike regimes are
 *    mirror images with a randomised sign -- it only adds variance to T, and the tie-breaks punish
 *    exactly that. So this agent treats the starting basket as an **anchor it returns to**, trades
 *    around it inside a band, and is flat against the anchor when the bell rings.
 * 2. **Sigma is small, so a small reliable edge is worth a lot.** The measured failure of the
 *    bundled arbitrage agents is fee bleed: firing at a gap narrower than the round trip. Every
 *    module here is gated on an edge computed from *executable* prices (fee and measured
 *    half-spread included), with a margin on top, and the default answer is noop. Not trading in
 *    calm is itself a positive deviation when the rest of the field is paying 60 bps round trips
 *    for 40 bps gaps.
 *
 * ## Where the money comes from
 *
 *  M1 cross-venue   buy the cheap venue and sell the rich one in the same block. Inventory-neutral,
 *                   so it adds alpha without moving beta. Fires on whale prints, crash dislocation
 *                   and any block where one venue is alone in being wrong.
 *  M2 inventory     the governor. Buys base when the executable price is far below fair, sells when
 *                   far above, always inside a band around the anchor, and unwinds anything the
 *                   other modules leave behind. Forces the deviation to zero before the bell.
 *  M3 redemption    eUSD below par is a claim on a dollar of collateral the protocol must honour.
 *                   `redemptionEdgeBps` already nets the redemption fee, so this is the one depeg
 *                   trade that does not need the peg to come back -- it works in depeg-persist too.
 *  M4 liquidation   a Liquity Trove under MCR pays its liquidator the gas compensation plus 0.5% of
 *                   collateral. The observation names the riskiest Trove, so no discovery is needed.
 *  M5 stable        a market-priced stable (DAI) is bought only once its discount is *narrowing*.
 *                   In depeg the environment buys back and the trade works; in depeg-persist the
 *                   discount never narrows and the module never fires. The asymmetry is the point.
 *  M6 launch        a token listed mid-epoch is worth zero at the bell, so it is a round trip or
 *                   nothing: enter only on confirmed net buying, exit on the first sign of the
 *                   sell-back, and sell unconditionally once the remaining blocks run short.
 *  M7 wrap          converts windfall native ETH (redemptions, liquidations) into WETH so M2 can
 *                   put it back into the anchor.
 *
 * ## Discipline
 *
 * Every module runs inside its own try/catch and its own error budget: one broken module cannot
 * take the others down, and a module that throws three times stops being called. The only
 * RPC-touching module (M6) is skipped when the decision is already slow, and each of its calls
 * carries its own timeout. M0 persistence alone reads ERIS_AGENT_STATE_DIR; tuning lives in PARAMS.
 */
import { readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { m0Plan, type M0State, type M0Action } from "./m0.js";
import type { AgentObservation } from "@eris/sdk";
import type { AgentContext } from "@eris/sdk/agent.js";
import { swapRouterAbi, erc20Abi } from "@eris/sdk/abis.js";
import { decodeFunctionData, type Hex, encodeFunctionData } from "viem";
import { TOKENS, UNISWAP } from "@eris/sdk/constants.js";
import {
  marketViews,
  type AgentVenue,
  type MarketView,
} from "../lib/markets.js";
import {
  applySlippage,
  approveTx,
  launchPoolState,
  launchPools,
  poolFee,
  poolFlow,
  quoteLaunch,
  swapBundle,
  tokenBalance,
  type LaunchPool,
} from "../lib/launchSwap.js";

const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * The lib's swapBundle approves the router for exactly the amount it swaps. For a USDC leg that
 * replaces the wallet's standing unlimited USDC approval, and once the swap has pulled the amount the
 * allowance is zero: every later USDC->Uniswap swap of the epoch then reverts with STF (opus-1 lost
 * 15-103 submits per launch epoch this way in four held-out runs). So a USDC leg re-approves in
 * full, as the wallet started.
 */
export function launchSwapBundle(args: Parameters<typeof swapBundle>[0]): Record<string, unknown> {
  const bundle = swapBundle(args);
  if (String(args.tokenIn).toLowerCase() !== String(TOKENS.USDC.address).toLowerCase()) return bundle;
  const txs = [...(bundle.txs as unknown[])];
  txs[0] = approveTx(args.tokenIn, UNISWAP.swapRouter, MAX_UINT256);
  return { ...bundle, txs };
}

// ---------------------------------------------------------------------------
// Tuning. Every number the strategy leans on is here, and nothing is read from the environment:
// the competition sets no ERIS_* of mine, so a value that is not in this table does not exist.
// ---------------------------------------------------------------------------
export const PARAMS = {
  // -- M1 cross-venue --------------------------------------------------------
  /** Edge the two executable prices must leave after both venues' costs and the impact estimate. */
  xvMinNetEdgeBps: 35,
  /** Notional at the minimum edge; it scales up with the edge, never past xvMaxNotionalUsd. */
  xvBaseNotionalUsd: 5_000,
  xvMaxNotionalUsd: 18_000,
  /** Slippage bound on each leg. The legs are separate transactions, so a bound tight enough to
   *  revert one of them leaves the other one-sided -- which is worse than a few bps. */
  xvSlippageBps: 40,

  // -- M2 inventory governor -------------------------------------------------
  /** How far the executable price must sit from fair before opening a deviation from the anchor. */
  invEntryBps: 70,
  /** How far *worse* than fair an unwind will accept. Must exceed a venue half-spread or the
   *  position never closes at equilibrium; entry 70 minus this is the floor on a round trip. */
  invExitTolBps: 40,
  /** Notional per opportunistic step. */
  invStepUsd: 2_500,
  /** Maximum |deviation| from the anchor, as a fraction of the anchor's value. */
  invBandFrac: 0.15,
  /** Below this many blocks remaining, drive the deviation to zero at whatever the venue pays. */
  invFlattenBlocks: 18,
  /** Deviations smaller than this are left alone. Set above the size of a runtime gas refill
   *  (which unwraps WETH), so routine housekeeping does not provoke a round trip. */
  invDustUsd: 400,

  // -- M3 eUSD redemption ----------------------------------------------------
  redeemMinEdgeBps: 70,
  redeemNotionalUsd: 4_000,
  redeemMaxShots: 5,
  /** Leave time to redeem what was bought and to sell the collateral back. */
  redeemMinBlocksLeft: 40,

  // -- M4 Liquity liquidation ------------------------------------------------
  liquidateMaxTroves: 3,
  liquidateMinBlocksLeft: 10,
  liquidateCooldownBlocks: 4,
  liquidateMaxAttempts: 12,

  // -- M5 market-priced stable -----------------------------------------------
  stableMinDiscountBps: 40,
  /** The discount has to have come in by this much over two blocks: a decay, not noise. */
  stableNarrowingBps: 8,
  stableNotionalUsd: 3_000,
  stableMaxNotionalUsd: 9_000,
  /** Sell back once it is this close to par. */
  stableExitBps: 15,
  stableMinBlocksLeft: 30,

  // -- M6 launch -------------------------------------------------------------
  launchNotionalUsd: 1_500,
  /** Never take more than this fraction of the pool's USDC side. */
  launchPoolFrac: 0.1,
  /** A pool with less than this much USDC is not a market worth entering. */
  launchMinReserveUsd: 10_000,
  /** Net USDC bought over the confirmation window, as a fraction of the reserve first seen. */
  launchConfirmFrac: 0.05,
  launchConfirmBlocks: 3,
  /** Do not chase a token that has already run this far past where it was first seen. */
  launchMaxChase: 2.5,
  /** Exit once it has given back this much of its peak. */
  launchDrawdownFrac: 0.8,
  launchMinBlocksLeft: 45,
  /** Below this, sell whatever is held, at any price: the bell marks it at zero. */
  launchExitBlocks: 20,
  launchMaxPools: 2,
  launchRpcTimeoutMs: 700,
  /** A timed-out read is weather, not a broken module, so this is far looser than the rest. */
  launchErrorBudget: 15,

  // -- bidding ---------------------------------------------------------------
  /** Share of the expected profit this agent is willing to hand to the ordering auction. */
  bidProfitShare: 0.12,
  /** Gas assumed when turning a profit into a tip. Deliberately generous. */
  bidGasUnits: 450_000,

  // -- housekeeping ----------------------------------------------------------
  /** Native ETH kept back for gas; anything above the anchor plus this is wrapped. */
  wrapMinExcessWei: 50_000_000_000_000_000n, // 0.05 ETH
  maxActionsPerBlock: 2,
  /** Stop calling the RPC-touching module once the decision has used this much of its 5s. */
  decideSoftBudgetMs: 2_200,
  /** And stop it outright here, with room to spare before the parent thread kills the call at 5s
   *  and discards everything it had queued. */
  decideHardBudgetMs: 3_800,
  moduleErrorBudget: 3,
};

/** The official funding (rules §4.2). Used as the beta anchor, because the field holds it too. */
const DEFAULT_ANCHOR: Record<string, bigint> = {
  WETH: 8_000_000_000_000_000_000n, // 8e18
  WBTC: 40_000_000n, // 0.4e8
};
const DEFAULT_ETH_ANCHOR = 1_000_000_000_000_000_000n; // 1 ETH
/** Assumed USDC-side depth of a venue at full health, used only to size against impact. */
const ASSUMED_VENUE_DEPTH_USD = 3_000_000;

const WETH_DEPOSIT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

// ---------------------------------------------------------------------------
// Module-local memory.
//
// The worker is reloaded on a timeout or a revision, which resets everything here. Nothing may be
// *necessary* for correctness, therefore: the anchor falls back to the published funding rather
// than to "whatever I happened to hold when I woke up", and the launch module reads its position
// off the chain instead of trusting a flag.
// ---------------------------------------------------------------------------
const anchors = new Map<string, bigint>();
let ethAnchorWei: bigint | null = null;
/** Deepest depth proxy seen per venue+base, so a liquidity pull scales sizing down as it happens. */
const depthPeak = new Map<string, number>();
/** Last two observed prices of each market-priced stable, for the "is it recovering" test. */
const stableTrail = new Map<string, number[]>();
const launchTracks = new Map<string, LaunchTrack>();
/** Set the first time a launch token is actually seen in the wallet; never cleared within a run. */
let launchEverHeld = false;
let redeemShots = 0;
let liquidateAttempts = 0;
let lastLiquidateBlock = -1_000_000;
const moduleErrors = new Map<string, number>();

type LaunchTrack = {
  firstBlock: number;
  firstPrice: number;
  firstReserveUsd: number;
  peakPrice: number;
  fee?: number;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function num(raw: string | undefined | null, fallback = 0): number {
  if (raw === undefined || raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function big(raw: string | undefined | null): bigint {
  if (raw === undefined || raw === null) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

/** Raw token units for a USD notional. Returns 0n when the inputs do not make a size. */
export function unitsFromUsd(
  usd: number,
  priceUsd: number,
  decimals: number,
): bigint {
  if (!Number.isFinite(usd) || !Number.isFinite(priceUsd)) return 0n;
  if (usd <= 0 || priceUsd <= 0) return 0n;
  const raw = Math.floor((usd / priceUsd) * 10 ** decimals);
  if (!Number.isFinite(raw) || raw <= 0) return 0n;
  return BigInt(raw);
}

function usdFromUnits(units: bigint, priceUsd: number, decimals: number): number {
  return (Number(units) / 10 ** decimals) * priceUsd;
}

/** Executable price for buying one unit of base at this venue (fee included). */
export function venueBuy(v: AgentVenue): number {
  return v.buyPrice !== undefined && v.buyPrice > 0
    ? v.buyPrice
    : v.price * (1 + v.feeBps / 10_000);
}

/** Executable price for selling one unit of base at this venue (fee included). */
export function venueSell(v: AgentVenue): number {
  return v.sellPrice !== undefined && v.sellPrice > 0
    ? v.sellPrice
    : v.price * (1 - v.feeBps / 10_000);
}

/**
 * The ordering auction, priced off the trade rather than off a constant.
 *
 * A fixed 0.1 gwei is what every bundled reference agent bids, and an external agent paying the cap
 * takes the front of the block from all of them. Paying for position is only right when the trade
 * pays for the gas: this bids just past the highest competitor the last block showed, capped by the
 * share of the expected profit the auction is allowed to eat, and never below the default or above
 * the configured maximum (validation rejects a bid over the cap).
 */
export function priorityFeeBid(
  obs: AgentObservation,
  expectedProfitUsd: number,
  gasUnits = PARAMS.bidGasUnits,
): string {
  const def = big(obs.limits?.defaultPriorityFeePerGasWei) || 1n;
  const max = big(obs.limits?.maxPriorityFeePerGasWei) || def;
  const ethUsd = obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
  if (!(ethUsd > 0) || !(expectedProfitUsd > 0) || gasUnits <= 0) {
    return (def > max ? max : def).toString();
  }
  const budgetUsd = expectedProfitUsd * PARAMS.bidProfitShare;
  const affordableWei = BigInt(
    Math.max(0, Math.floor(((budgetUsd / ethUsd) * 1e18) / gasUnits)),
  );
  const rival = big(obs.competition?.maxCompetitorPriorityFeeWei);
  // What it would take to sit in front of what was actually bid last block, not a blind maximum.
  const needed = rival > 0n ? rival + rival / 5n + 1n : def;
  // A bid that cannot reach the front buys nothing and still costs the gas, so when the trade
  // cannot afford the position it does not pay a part of the price for none of the goods.
  let want = needed <= affordableWei ? needed : def;
  if (want < def) want = def;
  if (want > max) want = max;
  return want.toString();
}

/** The anchor this agent holds itself to for one base. */
export function resolveAnchor(base: string, observed: bigint): bigint {
  const cached = anchors.get(base);
  if (cached !== undefined) return cached;
  const published = DEFAULT_ANCHOR[base];
  // The published funding is a constant, so it survives a worker reload; it is only wrong when the
  // run is not funded the official way, which an order-of-magnitude check catches.
  const anchor =
    published !== undefined &&
    observed > published / 4n &&
    observed < published * 4n
      ? published
      : observed;
  anchors.set(base, anchor);
  return anchor;
}

/**
 * Two ledgers, deliberately.
 *
 * `base` is what the wallet actually holds and is what the inventory governor measures its
 * deviation against. `reservedBase` / the running `usdc` are what is still unspent after the
 * modules earlier in this block have claimed their legs, and are what sizing is allowed to use.
 *
 * Collapsing the two is a real bug and it was caught by a test: a cross-venue bundle buys and sells
 * the same quantity, so it changes the holding by nothing -- but if its sell leg is deducted from
 * the holding, the governor reads the reservation as a position outside its band and forces an
 * unwind of a position that does not exist.
 */
type Wallet = {
  usdc: bigint;
  base: Map<string, bigint>;
  reservedBase: Map<string, bigint>;
  stables: Map<string, bigint>;
  ethWei: bigint;
};

function readWallet(obs: AgentObservation): Wallet {
  const base = new Map<string, bigint>();
  base.set("WETH", big(obs.balances?.wethWei));
  for (const [sym, raw] of Object.entries(obs.baseBalances ?? {}))
    base.set(sym, big(raw));
  const stables = new Map<string, bigint>();
  for (const [sym, entry] of Object.entries(obs.balances?.stables ?? {}))
    stables.set(sym, big(entry?.balance));
  return {
    usdc: big(obs.balances?.usdcUnits),
    base,
    reservedBase: new Map<string, bigint>(),
    stables,
    ethWei: big(obs.balances?.ethWei),
  };
}

/** Base units not already claimed by a leg decided earlier in this same block. */
function freeBase(wallet: Wallet, symbol: string): bigint {
  const held = wallet.base.get(symbol) ?? 0n;
  const reserved = wallet.reservedBase.get(symbol) ?? 0n;
  return held > reserved ? held - reserved : 0n;
}

function reserveBase(wallet: Wallet, symbol: string, amount: bigint): void {
  wallet.reservedBase.set(symbol, (wallet.reservedBase.get(symbol) ?? 0n) + amount);
}

type Candidate = {
  tag: string;
  action: Record<string, unknown>;
  /** Higher runs first; forced risk-reducing actions outrank opportunistic ones. */
  priority: number;
  profitUsd: number;
  reason: string;
};

function blocksLeft(obs: AgentObservation): number {
  return obs.blocksRemaining === undefined
    ? Number.POSITIVE_INFINITY
    : obs.blocksRemaining;
}

/** Depth proxy (USDC side, in USD) of one venue for one base. */
function venueDepthUsd(
  obs: AgentObservation,
  base: string,
  protocol: AgentVenue["protocol"],
): number {
  const key = `${protocol}:${base}`;
  let observed: number | undefined;
  if (protocol === "uniswap") {
    const pool =
      base === "WETH"
        ? obs.protocols?.uniswap?.pool
        : obs.protocols?.uniswap?.markets?.[`${base}/USDC`];
    // In-range L is not a USD figure; it is used purely as a ratio against its own peak.
    const liq = pool?.liquidity;
    if (liq !== undefined) observed = num(liq);
  } else {
    const amm =
      protocol === "balancer" ? obs.protocols?.balancer : obs.protocols?.curve;
    const slice = base === "WETH" ? amm : amm?.markets?.[`${base}/USDC`];
    const usdc = slice?.reserves?.usdc;
    if (usdc !== undefined) observed = num(usdc) / 1e6;
  }
  // A depth that could not be read is "unknown", never "an empty book": size as if the venue were a
  // quarter of its assumed self rather than skipping the trade or sizing against nothing.
  if (observed === undefined || !(observed > 0))
    return ASSUMED_VENUE_DEPTH_USD * 0.25;
  const peak = Math.max(depthPeak.get(key) ?? 0, observed);
  depthPeak.set(key, peak);
  // Balancer and Curve report reserves, which already are the USD side. Uniswap reports in-range L,
  // which is not a USD figure at all, so it is only used as a ratio against the deepest L seen --
  // that is what carries the crash regime's liquidity pull (issue #52) into the sizing.
  if (protocol !== "uniswap") return observed;
  return ASSUMED_VENUE_DEPTH_USD * clamp(observed / peak, 0.05, 1);
}

// ---------------------------------------------------------------------------
// M1 — cross-venue arbitrage
// ---------------------------------------------------------------------------

export type CrossVenuePlan = {
  base: string;
  cheap: AgentVenue;
  rich: AgentVenue;
  grossEdgeBps: number;
  netEdgeBps: number;
  notionalUsd: number;
  profitUsd: number;
};

/**
 * The best inventory-neutral two-leg trade for one base, or null when nothing clears the margin.
 *
 * Exported so the arithmetic can be exercised without a chain: the one thing that must never be
 * wrong here is the sign and the fee treatment, because an arbitrage that ignores fees is a
 * measured, structural loser (docs/guide/writing-agents.md, pitfall 1).
 */
export function crossVenuePlan(
  obs: AgentObservation,
  view: MarketView,
  usdcAvailable: bigint,
  baseAvailable: bigint,
): CrossVenuePlan | null {
  if (view.venues.length < 2 || !(view.fair > 0)) return null;
  let cheap: AgentVenue | null = null;
  let rich: AgentVenue | null = null;
  for (const v of view.venues) {
    if (!(v.price > 0)) continue;
    if (cheap === null || venueBuy(v) < venueBuy(cheap)) cheap = v;
    if (rich === null || venueSell(v) > venueSell(rich)) rich = v;
  }
  if (!cheap || !rich || cheap.protocol === rich.protocol) return null;
  const buy = venueBuy(cheap);
  const sell = venueSell(rich);
  if (!(buy > 0) || !(sell > 0)) return null;
  const grossEdgeBps = (sell / buy - 1) * 10_000;
  if (grossEdgeBps <= PARAMS.xvMinNetEdgeBps) return null;

  const depthCheap = venueDepthUsd(obs, view.base, cheap.protocol);
  const depthRich = venueDepthUsd(obs, view.base, rich.protocol);
  // Size grows with the edge, and is bounded by the wallet and by the thinner of the two books.
  const edgeScale = clamp(grossEdgeBps / (PARAMS.xvMinNetEdgeBps * 2), 0.5, 3);
  const walletUsd = Math.min(
    Number(usdcAvailable) / 1e6,
    usdFromUnits(baseAvailable, view.fair, view.baseDecimals),
  );
  let notionalUsd = Math.min(
    PARAMS.xvBaseNotionalUsd * edgeScale,
    PARAMS.xvMaxNotionalUsd,
    walletUsd * 0.9,
    depthCheap * 0.0015,
    depthRich * 0.0015,
  );
  if (!(notionalUsd > 200)) return null;
  // Average execution slips about half the price move a trade of this size makes, on each side.
  const impactBps =
    10_000 * 0.5 * (notionalUsd / depthCheap + notionalUsd / depthRich);
  const netEdgeBps = grossEdgeBps - impactBps;
  if (netEdgeBps < PARAMS.xvMinNetEdgeBps) {
    // Try once at the smaller size the margin can carry rather than dropping the opportunity.
    const allowed = PARAMS.xvMinNetEdgeBps;
    const room = grossEdgeBps - allowed;
    if (room <= 0) return null;
    const scale = room / impactBps;
    notionalUsd *= clamp(scale, 0, 1);
    if (!(notionalUsd > 200)) return null;
  }
  const finalImpact =
    10_000 * 0.5 * (notionalUsd / depthCheap + notionalUsd / depthRich);
  const finalNet = grossEdgeBps - finalImpact;
  if (finalNet < PARAMS.xvMinNetEdgeBps) return null;
  return {
    base: view.base,
    cheap,
    rich,
    grossEdgeBps,
    netEdgeBps: finalNet,
    notionalUsd,
    profitUsd: (notionalUsd * finalNet) / 10_000,
  };
}

function crossVenueModule(
  obs: AgentObservation,
  views: MarketView[],
  wallet: Wallet,
  out: Candidate[],
): void {
  // The two legs are separate transactions, so one can land without the other. In the middle of a
  // run that leaves a deviation the governor unwinds next block; in the last few blocks it leaves
  // one at the mark, with no block left to close it. Stop opening them.
  if (blocksLeft(obs) <= 5) return;
  for (const view of views) {
    const spendable = freeBase(wallet, view.base);
    const plan = crossVenuePlan(obs, view, wallet.usdc, spendable);
    if (!plan) continue;
    const usdcIn = unitsFromUsd(plan.notionalUsd, 1, 6);
    const baseOut = unitsFromUsd(plan.notionalUsd, venueBuy(plan.cheap), view.baseDecimals);
    if (usdcIn <= 0n || baseOut <= 0n) continue;
    if (usdcIn > wallet.usdc || baseOut > spendable) continue;
    const baseField = view.base === "WETH" ? {} : { base: view.base };
    const action = {
      type: "bundle",
      actions: [
        {
          type: plan.cheap.swapType,
          tokenIn: "USDC",
          ...baseField,
          amountIn: usdcIn.toString(),
          slippageBps: PARAMS.xvSlippageBps,
        },
        {
          type: plan.rich.swapType,
          tokenIn: view.base,
          ...baseField,
          amountIn: baseOut.toString(),
          slippageBps: PARAMS.xvSlippageBps,
        },
      ],
      maxPriorityFeePerGasWei: priorityFeeBid(obs, plan.profitUsd, PARAMS.bidGasUnits * 2),
    };
    // Reserve so a later module cannot spend the same balance twice in one block. The two legs net
    // to no change in the holding, so the *holding* is left alone -- only the claim on it is taken.
    wallet.usdc -= usdcIn;
    reserveBase(wallet, view.base, baseOut);
    out.push({
      tag: `xv:${view.base}`,
      action,
      priority: 1,
      profitUsd: plan.profitUsd,
      reason:
        `cross-venue ${view.base}: buy ${plan.cheap.protocol} @${venueBuy(plan.cheap).toFixed(2)}, ` +
        `sell ${plan.rich.protocol} @${venueSell(plan.rich).toFixed(2)}, ` +
        `net ${plan.netEdgeBps.toFixed(1)}bps on ${Math.round(plan.notionalUsd)} USDC`,
    });
  }
}

// ---------------------------------------------------------------------------
// M2 — the inventory governor
// ---------------------------------------------------------------------------

export type InventoryPlan = {
  base: string;
  side: "buy" | "sell";
  notionalUsd: number;
  venue: AgentVenue;
  forced: boolean;
  edgeBps: number;
};

/**
 * Keep the base holding near its anchor, and get paid for the times it drifts.
 *
 * Opening a deviation needs the executable price to be `invEntryBps` away from fair; closing one
 * accepts anything no worse than `invExitTolBps` from fair, which is wider than a venue's
 * half-spread so the position can actually be closed at equilibrium. Entry minus exit tolerance is
 * the floor on a completed round trip (70 - 40 = 30 bps today). Outside the band, and inside the
 * last `invFlattenBlocks`, the trade happens regardless of price: being beta-matched to the field
 * when the epoch is marked is worth more than the half-spread it costs.
 */
export function inventoryPlan(
  view: MarketView,
  heldUnits: bigint,
  anchorUnits: bigint,
  blocksRemaining: number,
): InventoryPlan | null {
  if (!(view.fair > 0) || view.venues.length === 0) return null;
  let bestBuy: AgentVenue | null = null;
  let bestSell: AgentVenue | null = null;
  for (const v of view.venues) {
    if (!(v.price > 0)) continue;
    if (bestBuy === null || venueBuy(v) < venueBuy(bestBuy)) bestBuy = v;
    if (bestSell === null || venueSell(v) > venueSell(bestSell)) bestSell = v;
  }
  if (!bestBuy || !bestSell) return null;

  const anchorUsd = usdFromUnits(anchorUnits, view.fair, view.baseDecimals);
  const heldUsd = usdFromUnits(heldUnits, view.fair, view.baseDecimals);
  const devUsd = heldUsd - anchorUsd;
  const bandUsd = Math.max(PARAMS.invDustUsd * 2, anchorUsd * PARAMS.invBandFrac);
  const flatten = blocksRemaining <= PARAMS.invFlattenBlocks;

  // 1. Forced: past the band, or the bell is close enough that beta mismatch is the bigger cost.
  const forcedTarget = flatten ? 0 : devUsd > bandUsd ? bandUsd * 0.5 : devUsd < -bandUsd ? -bandUsd * 0.5 : null;
  if (forcedTarget !== null) {
    const size = Math.abs(devUsd - forcedTarget);
    if (size >= PARAMS.invDustUsd) {
      const side = devUsd > forcedTarget ? "sell" : "buy";
      const venue = side === "sell" ? bestSell : bestBuy;
      return {
        base: view.base,
        side,
        notionalUsd: size,
        venue,
        forced: true,
        edgeBps:
          side === "sell"
            ? (venueSell(venue) / view.fair - 1) * 10_000
            : (1 - venueBuy(venue) / view.fair) * 10_000,
      };
    }
    if (flatten) return null;
  }

  // 2. Unwind an existing deviation at any price no worse than the exit tolerance.
  if (devUsd > PARAMS.invDustUsd) {
    const edge = (venueSell(bestSell) / view.fair - 1) * 10_000;
    if (edge >= -PARAMS.invExitTolBps)
      return {
        base: view.base,
        side: "sell",
        notionalUsd: Math.min(devUsd, PARAMS.invStepUsd * 2),
        venue: bestSell,
        forced: false,
        edgeBps: edge,
      };
  }
  if (devUsd < -PARAMS.invDustUsd) {
    const edge = (1 - venueBuy(bestBuy) / view.fair) * 10_000;
    if (edge >= -PARAMS.invExitTolBps)
      return {
        base: view.base,
        side: "buy",
        notionalUsd: Math.min(-devUsd, PARAMS.invStepUsd * 2),
        venue: bestBuy,
        forced: false,
        edgeBps: edge,
      };
  }

  // 3. Open a new deviation only when the dislocation is wide enough to pay for the round trip.
  const buyEdge = (1 - venueBuy(bestBuy) / view.fair) * 10_000;
  if (buyEdge >= PARAMS.invEntryBps && devUsd < bandUsd - PARAMS.invDustUsd)
    return {
      base: view.base,
      side: "buy",
      notionalUsd: Math.min(PARAMS.invStepUsd, bandUsd - devUsd),
      venue: bestBuy,
      forced: false,
      edgeBps: buyEdge,
    };
  const sellEdge = (venueSell(bestSell) / view.fair - 1) * 10_000;
  if (sellEdge >= PARAMS.invEntryBps && devUsd > -bandUsd + PARAMS.invDustUsd)
    return {
      base: view.base,
      side: "sell",
      notionalUsd: Math.min(PARAMS.invStepUsd, bandUsd + devUsd),
      venue: bestSell,
      forced: false,
      edgeBps: sellEdge,
    };
  return null;
}

function inventoryModule(
  obs: AgentObservation,
  views: MarketView[],
  wallet: Wallet,
  out: Candidate[],
): void {
  const left = blocksLeft(obs);
  for (const view of views) {
    const held = wallet.base.get(view.base) ?? 0n;
    const anchor = resolveAnchor(view.base, held);
    const plan = inventoryPlan(view, held, anchor, left);
    if (!plan) continue;
    const baseField = view.base === "WETH" ? {} : { base: view.base };
    let amountIn: bigint;
    let tokenIn: string;
    if (plan.side === "buy") {
      tokenIn = "USDC";
      amountIn = unitsFromUsd(plan.notionalUsd, 1, 6);
      if (amountIn > wallet.usdc) amountIn = wallet.usdc;
      if (amountIn < 1_000_000n) continue; // under a dollar is not a transaction
      wallet.usdc -= amountIn;
    } else {
      tokenIn = view.base;
      amountIn = unitsFromUsd(plan.notionalUsd, view.fair, view.baseDecimals);
      const spendable = freeBase(wallet, view.base);
      if (amountIn > spendable) amountIn = spendable;
      if (amountIn <= 0n) continue;
      if (usdFromUnits(amountIn, view.fair, view.baseDecimals) < 50) continue;
      reserveBase(wallet, view.base, amountIn);
    }
    // A forced unwind must land; an opportunistic one may revert without costing anything.
    const slippage = plan.forced ? 150 : 60;
    const profitUsd = plan.forced
      ? 0
      : (plan.notionalUsd * Math.max(0, plan.edgeBps)) / 10_000;
    out.push({
      tag: `inv:${view.base}:${plan.side}`,
      action: {
        type: plan.venue.swapType,
        tokenIn,
        ...baseField,
        amountIn: amountIn.toString(),
        slippageBps: slippage,
        maxPriorityFeePerGasWei: priorityFeeBid(obs, profitUsd),
      },
      priority: plan.forced ? 2 : 0,
      profitUsd,
      reason:
        `inventory ${plan.side} ${view.base} ${Math.round(plan.notionalUsd)} USDC on ` +
        `${plan.venue.protocol} (${plan.forced ? "forced" : "edge"} ${plan.edgeBps.toFixed(1)}bps)`,
    });
  }
}

// ---------------------------------------------------------------------------
// M3/M4 — Liquity: redemption arbitrage and liquidation
// ---------------------------------------------------------------------------

function liquityModule(
  obs: AgentObservation,
  wallet: Wallet,
  out: Candidate[],
): void {
  const liq = obs.protocols?.liquity;
  if (!liq) return;
  const left = blocksLeft(obs);

  // M4: a Trove under MCR (or under TCR in Recovery Mode) pays its liquidator the gas compensation
  // plus 0.5% of the collateral. No discovery needed -- the observation names the riskiest one.
  const riskiest = liq.riskiestTrove;
  const threshold = liq.recoveryMode ? liq.tcr : liq.mcr;
  if (
    riskiest &&
    riskiest.icr > 0 &&
    threshold > 0 &&
    riskiest.icr < threshold &&
    left >= PARAMS.liquidateMinBlocksLeft &&
    // A Trove can sit under MCR for a long time with a Stability Pool too small to absorb it, and
    // every attempt then reverts and pays its gas. Try, but do not stand there trying.
    liquidateAttempts < PARAMS.liquidateMaxAttempts &&
    obs.round - lastLiquidateBlock >= PARAMS.liquidateCooldownBlocks
  ) {
    liquidateAttempts += 1;
    lastLiquidateBlock = obs.round;
    const gasComp = Number(big(liq.gasCompensationEusdWei)) / 1e18;
    out.push({
      tag: "liquity:liquidate",
      action: {
        type: "liquityLiquidate",
        maxTroves: PARAMS.liquidateMaxTroves,
        maxPriorityFeePerGasWei: priorityFeeBid(obs, Math.max(gasComp, 50)),
      },
      priority: 1,
      profitUsd: Math.max(gasComp, 50),
      reason: `liquidate: riskiest ICR ${riskiest.icr.toFixed(3)} < ${threshold.toFixed(3)}${liq.recoveryMode ? " (recovery)" : ""}`,
    });
  }

  // M3, step 2: redeem eUSD held from an earlier block (bought below par, or taken as a
  // liquidation's gas compensation). Buying and redeeming cannot share one bundle -- the validator
  // does not credit a swap's eUSD output to the redeem leg -- so the trade is two blocks, and this
  // is the half that must not be skipped.
  //
  // Redeeming is only better than sitting on the position while the edge is positive: eUSD is a
  // registry stable marked at its market price, so holding it is not a loss waiting to happen and
  // selling it back at par would just pay the pool fee twice. Below the threshold the right move
  // is to hold -- and, either way, not to open a second position on top of this one.
  const eusd = big(liq.eusdBalanceWei);
  if (eusd > 10n ** 18n) {
    if (liq.redemptionEdgeBps > 20 && left >= 5) {
      const feeCap = clamp(Math.round(liq.redemptionRateBps + 100), 100, 500);
      const profitUsd = ((Number(eusd) / 1e18) * liq.redemptionEdgeBps) / 10_000;
      out.push({
        tag: "liquity:redeem",
        action: {
          type: "liquityRedeem",
          amountEusdWei: eusd.toString(),
          maxIterations: 8,
          maxFeeBps: feeCap,
          maxPriorityFeePerGasWei: priorityFeeBid(obs, profitUsd),
        },
        priority: 2,
        profitUsd,
        reason: `redeem ${(Number(eusd) / 1e18).toFixed(0)} eUSD at edge ${liq.redemptionEdgeBps.toFixed(0)}bps`,
      });
    }
    return;
  }

  // M3, step 1: buy eUSD below par when the redemption fee still leaves an edge. Unlike a bet on
  // the peg coming back, this works in depeg-persist: the protocol owes a dollar of collateral.
  if (
    liq.marketQuoted &&
    liq.redemptionEdgeBps >= PARAMS.redeemMinEdgeBps &&
    redeemShots < PARAMS.redeemMaxShots &&
    left >= PARAMS.redeemMinBlocksLeft
  ) {
    let spend = unitsFromUsd(PARAMS.redeemNotionalUsd, 1, 6);
    if (spend > wallet.usdc / 2n) spend = wallet.usdc / 2n;
    // Never buy more than the Trove at the front of the queue can actually absorb.
    const absorbable = riskiest ? Number(big(riskiest.netDebtEusdWei)) / 1e18 : 0;
    if (absorbable > 0) {
      const cap = unitsFromUsd(absorbable * 0.9, 1, 6);
      if (cap < spend) spend = cap;
    }
    if (spend >= 500_000_000n) {
      wallet.usdc -= spend;
      redeemShots += 1;
      const profitUsd =
        ((Number(spend) / 1e6) * (liq.redemptionEdgeBps - 30)) / 10_000;
      out.push({
        tag: "liquity:buy-eusd",
        action: {
          type: "liquitySwapEusd",
          tokenIn: "USDC",
          amountIn: spend.toString(),
          slippageBps: 100,
          maxPriorityFeePerGasWei: priorityFeeBid(obs, profitUsd),
        },
        priority: 1,
        profitUsd,
        reason: `buy eUSD ${Number(spend) / 1e6} USDC to redeem, edge ${liq.redemptionEdgeBps.toFixed(0)}bps`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// M5 — market-priced stables (DAI): buy the recovery, never the fall
// ---------------------------------------------------------------------------

export type StableSignal = "buy" | "sell" | null;

/**
 * The trail is the last three observed prices. A discount is only bought once it has *narrowed*,
 * which is the one observable difference between `depeg` (the environment buys back, so the
 * discount decays) and `depeg-persist` (it does not). Getting this wrong in the persistent regime
 * is the single worst trade available in the whole competition, so the test is deliberately strict.
 */
export function stableSignal(trail: number[], blocksRemaining: number): StableSignal {
  if (trail.length < 3) return null;
  const [a, b, c] = trail.slice(-3);
  const discountBps = (1 - c) * 10_000;
  if (discountBps <= PARAMS.stableExitBps) return "sell";
  if (blocksRemaining < PARAMS.stableMinBlocksLeft) return "sell";
  const narrowed = (c - b) * 10_000 + (b - a) * 10_000;
  if (discountBps >= PARAMS.stableMinDiscountBps && narrowed >= PARAMS.stableNarrowingBps)
    return "buy";
  return null;
}

function stableModule(
  obs: AgentObservation,
  wallet: Wallet,
  out: Candidate[],
): void {
  const entries = obs.balances?.stables ?? {};
  const left = blocksLeft(obs);
  for (const [symbol, entry] of Object.entries(entries)) {
    if (symbol === "USDC" || symbol === "EUSD") continue; // eUSD belongs to M3
    if (!entry?.marketQuoted) continue;
    const price = entry.priceUsdc;
    if (!(price > 0) || !(price < 1.2)) continue;
    const trail = stableTrail.get(symbol) ?? [];
    trail.push(price);
    while (trail.length > 3) trail.shift();
    stableTrail.set(symbol, trail);

    const held = wallet.stables.get(symbol) ?? 0n;
    const decimals = entry.decimals ?? 18;
    const signal = stableSignal(trail, left);
    if (signal === "sell") {
      if (usdFromUnits(held, price, decimals) < 50) continue;
      wallet.stables.set(symbol, 0n);
      out.push({
        tag: `stable:${symbol}:sell`,
        action: {
          type: "stableSwap",
          stable: symbol,
          tokenIn: symbol,
          amountIn: held.toString(),
          slippageBps: 100,
          maxPriorityFeePerGasWei: priorityFeeBid(obs, 0),
        },
        priority: left <= PARAMS.stableMinBlocksLeft ? 2 : 0,
        profitUsd: 0,
        reason: `unwind ${symbol} at ${price.toFixed(4)}`,
      });
      continue;
    }
    if (signal !== "buy") continue;
    const heldUsd = usdFromUnits(held, price, decimals);
    if (heldUsd >= PARAMS.stableMaxNotionalUsd) continue;
    let spend = unitsFromUsd(
      Math.min(PARAMS.stableNotionalUsd, PARAMS.stableMaxNotionalUsd - heldUsd),
      1,
      6,
    );
    if (spend > wallet.usdc / 3n) spend = wallet.usdc / 3n;
    if (spend < 500_000_000n) continue;
    wallet.usdc -= spend;
    const profitUsd = ((Number(spend) / 1e6) * (1 - price) * 10_000 * 0.5) / 10_000;
    out.push({
      tag: `stable:${symbol}:buy`,
      action: {
        type: "stableSwap",
        stable: symbol,
        tokenIn: "USDC",
        amountIn: spend.toString(),
        slippageBps: 100,
        maxPriorityFeePerGasWei: priorityFeeBid(obs, profitUsd),
      },
      priority: 0,
      profitUsd,
      reason: `${symbol} discount ${( (1 - price) * 10_000).toFixed(0)}bps and narrowing`,
    });
  }
}

// ---------------------------------------------------------------------------
// M7 — wrap windfall ETH so the governor can put it back into the anchor
// ---------------------------------------------------------------------------

function wrapEthModule(
  obs: AgentObservation,
  wallet: Wallet,
  out: Candidate[],
): void {
  if (ethAnchorWei === null) {
    const observed = wallet.ethWei;
    ethAnchorWei =
      observed > DEFAULT_ETH_ANCHOR / 4n && observed < DEFAULT_ETH_ANCHOR * 4n
        ? DEFAULT_ETH_ANCHOR
        : observed;
  }
  // Never wrap below a hard floor, whatever the anchor resolved to: the runtime pays for gas out of
  // this balance and refills it by unwrapping WETH, and an agent that keeps wrapping the refill
  // back has invented a loop that costs a spread every round.
  const floor = DEFAULT_ETH_ANCHOR / 2n;
  const keep = ethAnchorWei > floor ? ethAnchorWei : floor;
  const excess = wallet.ethWei - keep;
  if (excess < PARAMS.wrapMinExcessWei) return;
  wallet.ethWei -= excess;
  out.push({
    tag: "wrap",
    action: {
      type: "rawTx",
      tx: {
        to: TOKENS.WETH.address,
        data: encodeFunctionData({ abi: WETH_DEPOSIT_ABI, functionName: "deposit" }),
        value: excess.toString(),
      },
      maxPriorityFeePerGasWei: priorityFeeBid(obs, 0),
    },
    priority: 1,
    profitUsd: 0,
    reason: `wrap ${(Number(excess) / 1e18).toFixed(3)} windfall ETH`,
  });
}

// ---------------------------------------------------------------------------
// M6 — launch pools
// ---------------------------------------------------------------------------

/**
 * Every RPC this agent makes goes through here, with two bounds rather than one: its own timeout,
 * and the decision's deadline. `decide()` is killed at five seconds by the parent thread and the
 * actions it had queued are discarded with it, so a module that can issue five sequential reads
 * must not be allowed to spend a whole second on each of them.
 */
function withTimeout<T>(p: Promise<T>, label: string, deadlineAt: number): Promise<T> {
  const ms = Math.max(50, Math.min(PARAMS.launchRpcTimeoutMs, deadlineAt - Date.now()));
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function launchModule(
  obs: AgentObservation,
  ctx: AgentContext,
  wallet: Wallet,
  out: Candidate[],
  deadlineAt: number,
): Promise<void> {
  const pools = launchPools(obs).slice(0, PARAMS.launchMaxPools);
  if (pools.length === 0) return;
  const block = Number(obs.blockNumber);
  const left = blocksLeft(obs);

  for (const pool of pools) {
    if (Date.now() > deadlineAt - 150) return;
    const key = pool.pool.toLowerCase();
    let track = launchTracks.get(key);
    // The position is read off the chain, never off a flag: a worker reload must not be able to
    // leave a token behind, because the bell marks it at zero. Read it alongside the pool rather
    // than after it -- the round trips are what the deadline is spent on.
    const [state, heldRead, feeTier] = await Promise.all([
      withTimeout(launchPoolState(ctx.publicClient, pool), "launchPoolState", deadlineAt),
      withTimeout(tokenBalance(ctx.publicClient, pool.token, ctx.address), "tokenBalance", deadlineAt),
      track?.fee !== undefined
        ? Promise.resolve(track.fee)
        : withTimeout(poolFee(ctx.publicClient, pool.pool), "poolFee", deadlineAt),
    ]);
    if (heldRead === undefined) continue; // gas-capped read failed (upstream issue #213): skip this pool this block
    const held = heldRead;
    const reserveUsd = Number(state.usdcReserveUnits) / 1e6;
    if (!track) {
      track = {
        firstBlock: block,
        firstPrice: state.priceUsdcPerToken,
        firstReserveUsd: reserveUsd,
        peakPrice: state.priceUsdcPerToken,
      };
      launchTracks.set(key, track);
    }
    track.peakPrice = Math.max(track.peakPrice, state.priceUsdcPerToken);
    track.fee = feeTier;
    const poolFeeTier = feeTier;

    if (held > 0n) {
      launchEverHeld = true;
      const flow = await withTimeout(
        poolFlow(ctx.publicClient, pool, Math.max(0, block - 2), block),
        "poolFlow",
        deadlineAt,
      ).catch(() => ({ usdcInUnits: 0n, usdcOutUnits: 0n, swaps: 0 }));
      const sellingOff = flow.usdcOutUnits > (flow.usdcInUnits * 12n) / 10n;
      const drawdown =
        track.peakPrice > 0 &&
        state.priceUsdcPerToken <= track.peakPrice * PARAMS.launchDrawdownFrac;
      const forced = left <= PARAMS.launchExitBlocks;
      if (!forced && !sellingOff && !drawdown) continue;
      // A forced exit sells at whatever the pool pays: the alternative is a holding the bell marks
      // at zero, so there is no price at which not selling is better.
      let minOut = 1n;
      if (!forced) {
        try {
          const quoted = await withTimeout(
            quoteLaunch(ctx.publicClient, {
              tokenIn: pool.token,
              tokenOut: TOKENS.USDC.address,
              fee: poolFeeTier,
              amountIn: held,
            }),
            "quoteLaunch",
            deadlineAt,
          );
          minOut = applySlippage(quoted, 500);
        } catch {
          minOut = 1n;
        }
      }
      const valueUsd = state.priceUsdcPerToken * (Number(held) / 1e18);
      out.push({
        tag: "launch:exit",
        action: launchSwapBundle({
          tokenIn: pool.token,
          tokenOut: TOKENS.USDC.address,
          fee: poolFeeTier,
          recipient: ctx.address,
          amountIn: held,
          minOut,
          reason: "launch exit",
          maxPriorityFeePerGasWei: priorityFeeBid(obs, Math.max(valueUsd * 0.05, 20)),
        }),
        priority: 3,
        profitUsd: valueUsd,
        reason: `launch exit ${pool.token.slice(0, 10)} (${forced ? "bell" : sellingOff ? "sell-off" : "drawdown"})`,
      });
      continue;
    }

    // Entry. Everything here is a reason not to: the dud is the default case.
    if (left < PARAMS.launchMinBlocksLeft) continue;
    if (block - track.firstBlock < 2 || block - track.firstBlock > 90) continue;
    if (reserveUsd < PARAMS.launchMinReserveUsd) continue;
    if (
      track.firstPrice > 0 &&
      state.priceUsdcPerToken > track.firstPrice * PARAMS.launchMaxChase
    )
      continue;
    const flow = await withTimeout(
      poolFlow(
        ctx.publicClient,
        pool,
        Math.max(0, block - PARAMS.launchConfirmBlocks),
        block,
      ),
      "poolFlow",
      deadlineAt,
    );
    const netInUsd = Number(flow.usdcInUnits - flow.usdcOutUnits) / 1e6;
    if (netInUsd < track.firstReserveUsd * PARAMS.launchConfirmFrac) continue;

    let spend = unitsFromUsd(
      Math.min(PARAMS.launchNotionalUsd, reserveUsd * PARAMS.launchPoolFrac),
      1,
      6,
    );
    if (spend > wallet.usdc / 4n) spend = wallet.usdc / 4n;
    if (spend < 200_000_000n) continue;
    let minOut = 1n;
    try {
      const quoted = await withTimeout(
        quoteLaunch(ctx.publicClient, {
          tokenIn: TOKENS.USDC.address,
          tokenOut: pool.token,
          fee: poolFeeTier,
          amountIn: spend,
        }),
        "quoteLaunch",
        deadlineAt,
      );
      minOut = applySlippage(quoted, 400);
    } catch {
      continue; // no quote, no entry: an unpriced buy into an unknown pool is a donation
    }
    wallet.usdc -= spend;
    out.push({
      tag: "launch:enter",
      action: launchSwapBundle({
        tokenIn: TOKENS.USDC.address,
        tokenOut: pool.token,
        fee: poolFeeTier,
        recipient: ctx.address,
        amountIn: spend,
        minOut,
        reason: "launch entry",
        maxPriorityFeePerGasWei: priorityFeeBid(obs, Number(spend) / 1e6 * 0.2),
      }),
      priority: 1,
      profitUsd: (Number(spend) / 1e6) * 0.2,
      reason: `launch entry ${pool.token.slice(0, 10)}: net +${netInUsd.toFixed(0)} USDC bought in ${PARAMS.launchConfirmBlocks}b`,
    });
  }
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

// M0 uses observations only. Disk holds intent before emission, so a replacement worker
// cannot double-fire. A crash between persistence and emission may conservatively miss a trade.
let m0State: M0State | undefined;
let m0PendingUntil: number | undefined;
const M0_PENDING_BLOCKS = 3;
let m0Loaded = false;
let m0Path: string | undefined;
let m0StorageFailed = false;

export function resetM0StateForTest(): void {
  m0State = undefined;
  m0PendingUntil = undefined;
  m0Loaded = false;
  m0Path = undefined;
  m0StorageFailed = false;
}

function loadM0(): void {
  if (m0Loaded) return;
  m0Loaded = true;
  const dir = process.env.ERIS_AGENT_STATE_DIR;
  if (!dir) {
    m0StorageFailed = true;
    return;
  }
  m0Path = join(dir, "opus-1w-m0-state.json");
  try {
    if (statSync(m0Path).size > 262144) throw new Error("oversized M0 state");
    const saved = JSON.parse(readFileSync(m0Path, "utf8"));
    const s = saved.state;
    if (saved.schema !== 1 || !s || typeof s.runId !== "string" ||
        !Number.isSafeInteger(s.lastBlock) || !s.anchors || !s.fairTrail ||
        !s.whales || !s.incidents) throw new Error("invalid M0 state");
    if (saved.pendingUntil !== undefined && !Number.isSafeInteger(saved.pendingUntil))
      throw new Error("invalid M0 deadline");
    m0State = s;
    // Older snapshots get a bounded migration window; never renew on observation.
    m0PendingUntil = s.order ? saved.pendingUntil ?? s.lastBlock + M0_PENDING_BLOCKS : undefined;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") m0StorageFailed = true;
  }
}

function planM0(obs: AgentObservation, views: MarketView[]): M0Action[] {
  loadM0();
  if (m0StorageFailed || !m0Path) return []; // Never waive lost intent on a corrupt/unwritable store.
  const sameEpoch = m0State?.runId === obs.runId && m0State?.epochIndex === obs.epoch?.index;
  const order = sameEpoch ? m0State?.order : undefined;
  const position = sameEpoch ? m0State?.position : undefined;
  const expired = !!order && Number(obs.blockNumber) >= m0PendingUntil!;
  let pendingOwnTxs = 0;
  if (order && position) {
    const held = BigInt(position.base === "WETH" ? obs.balances.wethWei : obs.baseBalances?.[position.base] ?? "0");
    const delta = held - BigInt(order.beforeBaseUnits);
    const expected = BigInt(order.expectedBaseUnits);
    // Full fills settle early; partial/unobserved fills settle at the fixed deadline.
    pendingOwnTxs = expired || (expected > 0n ? delta >= expected : delta <= expected) ? 0 : 1;
  }
  // Preserve the reservation across missed observations instead of the planner's freshness reset.
  const previous = order && m0State && Number(obs.blockNumber) > m0State.lastBlock + 1
    ? { ...m0State, lastBlock: Number(obs.blockNumber) - 1 } : m0State;
  // Expiry reconciles the observed partial fill, but cannot renew the lock this block.
  const plan = m0Plan(obs, expired ? [] : views, previous, { pendingOwnTxs });
  const pendingUntil = plan.actions.length ? Number(obs.blockNumber) + M0_PENDING_BLOCKS
    : plan.state.order ? m0PendingUntil : undefined;
  if (m0Path) {
    try {
      writeFileSync(`${m0Path}.tmp`, JSON.stringify({ schema: 1, state: plan.state, pendingUntil }));
      renameSync(`${m0Path}.tmp`, m0Path);
    } catch {
      m0StorageFailed = true;
      return [];
    }
  }
  m0State = plan.state;
  m0PendingUntil = pendingUntil;
  return plan.actions.map(action => ({ ...action, maxPriorityFeePerGasWei:
    (BigInt(action.maxPriorityFeePerGasWei) < BigInt(obs.limits.maxPriorityFeePerGasWei)
      ? action.maxPriorityFeePerGasWei : obs.limits.maxPriorityFeePerGasWei) }));
}

/** Pair reservation applies in either direction and to every leg of a bundle. */
function tradesM0Pair(action: Record<string, unknown>, base: string): boolean {
  if (action.type === "bundle")
    return (action.actions as Record<string, unknown>[]).some(a => tradesM0Pair(a, base));
  if (["swap", "curveSwap", "balancerSwap"].includes(String(action.type)))
    return (action.base ?? "WETH") === base;
  if (action.type === "rawTx" || action.type === "rawBundle") {
    const txs = (action.type === "rawTx" ? [action.tx] : action.txs) as { data: Hex }[];
    const baseAddress = Object.entries(TOKENS).find(([symbol]) => symbol === base)?.[1].address.toLowerCase();
    return txs.some(tx => {
      try {
        const d = decodeFunctionData({ abi: swapRouterAbi, data: tx.data });
        if (d.functionName !== "exactInputSingle") return false;
        const { tokenIn, tokenOut } = d.args[0];
        const pair = [tokenIn.toLowerCase(), tokenOut.toLowerCase()];
        return !!baseAddress && pair.includes(baseAddress) && pair.includes(TOKENS.USDC.address.toLowerCase());
      } catch { return false; } // Approvals, wrapping and other pairs are independent.
    });
  }
  return false;
}

/** Typed actions receive distinct nonces from the runtime's serialized sender.
 * A bundle conflicts if ANY leg spends M0's input. Decode the base arm's
 * launch swaps and ETH wraps too; approvals alone do not spend token balances.
 */
function conflictsM0(action: Record<string, unknown>, m0: M0Action): boolean {
  if (action.type === "bundle")
    return (action.actions as Record<string, unknown>[]).some(a => conflictsM0(a, m0));
  if (action.type === "rawTx" || action.type === "rawBundle") {
    const txs = (action.type === "rawTx" ? [action.tx] : action.txs) as { to: string; data: Hex }[];
    const inputAddress = Object.entries(TOKENS).find(([symbol]) => symbol === m0.tokenIn)?.[1].address.toLowerCase();
    return txs.some(tx => {
      if (tx.to.toLowerCase() === TOKENS.WETH.address.toLowerCase() && tx.data === "0xd0e30db0") return false;
      try {
        const d = decodeFunctionData({ abi: erc20Abi, data: tx.data });
        if (d.functionName === "approve") return false;
      } catch { /* Not an approval. */ }
      try {
        const d = decodeFunctionData({ abi: swapRouterAbi, data: tx.data });
        if (d.functionName === "exactInputSingle") return d.args[0].tokenIn.toLowerCase() === inputAddress;
      } catch { /* Unknown raw call: cannot establish independent funding. */ }
      return true;
    });
  }
  const token = action.tokenIn ?? (action.type === "liquityRedeem" ? "EUSD" : undefined);
  return token === m0.tokenIn;
}

function guard(name: string, fn: () => void, ctx: AgentContext): void {
  if ((moduleErrors.get(name) ?? 0) >= PARAMS.moduleErrorBudget) return;
  try {
    fn();
  } catch (error) {
    const n = (moduleErrors.get(name) ?? 0) + 1;
    moduleErrors.set(name, n);
    ctx.log({
      reason: `module ${name} failed (${n}/${PARAMS.moduleErrorBudget}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

export async function decide(
  obs: AgentObservation,
  ctx: AgentContext,
): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now();
  const candidates: Candidate[] = [];
  let views: MarketView[] = [];
  const wallet = readWallet(obs);

  guard("markets", () => {
    views = marketViews(obs);
  }, ctx);
  let m0Actions: M0Action[] = [];
  guard("m0", () => { m0Actions = planM0(obs, views); }, ctx);
  guard("crossVenue", () => crossVenueModule(obs, views, wallet, candidates), ctx);
  guard("inventory", () => inventoryModule(obs, views, wallet, candidates), ctx);
  guard("liquity", () => liquityModule(obs, wallet, candidates), ctx);
  guard("stable", () => stableModule(obs, wallet, candidates), ctx);
  guard("wrap", () => wrapEthModule(obs, wallet, candidates), ctx);

  // The launch module is the only one that touches the chain, and the only one whose job includes
  // an exit that *must* happen -- a token still held at the bell is marked at zero. So it gets its
  // own, much larger error budget (a timed-out read is weather, not a broken module), and once a
  // position has been seen the budget stops applying at all: there is nothing worse than giving up
  // on the sell.
  const launchBudget = launchEverHeld
    ? Number.POSITIVE_INFINITY
    : PARAMS.launchErrorBudget;
  if (
    obs.registry !== undefined &&
    (moduleErrors.get("launch") ?? 0) < launchBudget &&
    Date.now() - startedAt < PARAMS.decideSoftBudgetMs
  ) {
    try {
      await launchModule(
        obs,
        ctx,
        wallet,
        candidates,
        startedAt + PARAMS.decideHardBudgetMs,
      );
    } catch (error) {
      const n = (moduleErrors.get("launch") ?? 0) + 1;
      moduleErrors.set("launch", n);
      ctx.log({
        reason: `module launch failed (${n}/${launchBudget}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  candidates.sort((a, b) =>
    b.priority !== a.priority ? b.priority - a.priority : b.profitUsd - a.profitUsd,
  );
  const pendingBase = m0State?.runId === obs.runId && m0State?.epochIndex === obs.epoch?.index &&
    m0State.order && Number(obs.blockNumber) < (m0PendingUntil ?? 0) ? m0State.position?.base : undefined;
  const chosen = candidates.slice(0, PARAMS.maxActionsPerBlock)
    .filter(c => !(pendingBase && tradesM0Pair(c.action, pendingBase)) &&
      !m0Actions.some(m => conflictsM0(c.action, m)));

  const weth = views.find((v) => v.base === "WETH");
  ctx.log({
    round: obs.round,
    action: m0Actions[0] ?? chosen[0]?.action ?? { type: "noop" },
    reason:
      m0Actions.length > 0
        ? "M0 whale/incident trade"
        : chosen.length === 0
        ? "no edge over the round trip"
        : chosen.map((c) => c.reason).join(" | "),
    signals: {
      blocksRemaining: obs.blocksRemaining,
      valueUsdc: obs.inventory?.valueUsdc,
      fairWeth: obs.fairPriceUsdcPerWeth,
      wethDevUsd: weth
        ? usdFromUnits(
            (wallet.base.get("WETH") ?? 0n) - resolveAnchor("WETH", wallet.base.get("WETH") ?? 0n),
            weth.fair,
            weth.baseDecimals,
          )
        : undefined,
      candidates: candidates.length,
    },
    state: { tags: [...m0Actions.map(() => m0State?.position?.tag ?? "m0"), ...chosen.map((c) => c.tag)],
      elapsedMs: Date.now() - startedAt },
  });

  const emitted = [...m0Actions, ...chosen.map(c => c.action)];
  if (emitted.length === 0) return null;
  for (const action of emitted.slice(1)) ctx.submit(action);
  return emitted[0];
}
