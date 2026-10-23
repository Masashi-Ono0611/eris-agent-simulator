/**
 * opus-1g2 — opus-1a (C1) plus one module, M-OU, that holds a GMX perp position on the fair price's
 * pull back to its fixed anchor. Everything opus-1a does is unchanged; see "M-OU" below.
 *
 * opus-1a — opus-1 with the launch module's USDC approval kept unlimited (see launchSwapBundle).
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
 *  M-OU perp        (opus-1g2) the environment's fair price is an Ornstein-Uhlenbeck walk around an
 *                   anchor fixed at the run's opening price (sdk/src/rng.ts nextFairPrice,
 *                   core/src/realtime/coordinator.ts fairAnchor). A GMX position in the direction of
 *                   (anchor - fair) earns that pull. Long when the fair sits more than 0.8% under the
 *                   anchor, short when more than 0.8% over, otherwise hold what is held. USDC
 *                   collateral, so the wallet's base balances -- what M2 governs -- never change.
 *
 * ## Discipline
 *
 * Every module runs inside its own try/catch and its own error budget: one broken module cannot
 * take the others down, and a module that throws three times stops being called. The only
 * RPC-touching module (M6) is skipped when the decision is already slow, and each of its calls
 * carries its own timeout. Tuning lives in PARAMS; only M-OU persistence reads ERIS_AGENT_STATE_DIR.
 */
import type { AgentObservation } from "@eris/sdk";
import type { AgentContext } from "@eris/sdk/agent.js";
import { encodeFunctionData } from "viem";
import { readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
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

  // -- M-OU GMX anchor pull (opus-1g2) ---------------------------------------
  /** Long when (anchor - fair) / fair is above this, short when below its negative, hold between. */
  ouEntryFrac: 0.008,
  /** Notional per base. */
  ouNotionalUsd: 40_000,
  /** Size / collateral. This is sizing, not a liquidation guarantee: cumulative moves, fees
   *  and keeper delay can outrun even the loss/drift exits below. */
  ouLeverage: 4,
  /** USDC left in the wallet for M1-M6 after collateral is posted. M1's size is bounded by
   *  depth x 0.0015 (~$4.5k at the assumed depth) and M2 steps by $2.5k, so $5k keeps both able
   *  to fire; M3/M5/M6 already size off a fraction of whatever USDC is there. */
  ouUsdcReserveUsd: 5_000,
  /** When USDC caps the size, an order smaller than this is not worth its fees. */
  ouMinNotionalUsd: 10_000,
  /** Distinct consecutive observations required before an increase (also after worker reload). */
  ouConfirmBlocks: 3,
  ouPendingMaxBlocks: 12,
  ouLossCollateralFrac: 0.5,
  ouAdverseDriftBlocks: 24,
  /** An observed position this close to what the pending order should leave counts as reflected. */
  ouReflectTolUsd: 500,
  /** No new orders once this few blocks remain (the position is valued as it stands at the bell). */
  ouStopBlocks: 5,
  /** Additional native ETH floor, beyond all closing fees and gas reservations. */
  ouEthReserveWei: 50_000_000_000_000_000n, // 0.05 ETH
  /** The published opening fair per base; used as the anchor when the first fair is within
   *  ouAnchorMatchFrac of it. A persisted anchor always takes precedence. */
  ouPublishedAnchor: { WETH: 3_000, WBTC: 60_000 } as Record<string, number>,
  ouAnchorMatchFrac: 0.02,

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
// M-OU — a GMX position on the fair price's pull back to its anchor (opus-1g2)
//
// The walk is f' = f (1 + drift + kappa (A - f) / f + U(+-vol)) with A fixed at the run's opening
// fair (cex-drift episodes move A; stress overlays multiply the walk's output). GMX fills at that
// fair price after the keeper's delay, so a perp in the direction of (A - f) collects the pull.
//
// Observation only: no RPC. Orders go out through ctx.submit next to opus-1a's own choice and never
// displace it. A position is never topped up or partly closed; a reversal is "decrease all" now and
// "increase the other side" once the decrease shows in the observation, because the increase needs
// the collateral the decrease returns, and the observation surfaces one position per market (two
// coexisting ones would hide half the book).
// ---------------------------------------------------------------------------

const USD_1E30 = 10n ** 30n;
/** The execution fee the runtime attaches to every GMX order (sdk/src/protocols/gmx.ts). */
const GMX_EXECUTION_FEE_WEI = 30_000_000_000_000_000n;

const OU_BASES = ["WETH", "WBTC"] as const;
const ouAnchors = new Map<string, number>();

/** An emitted intent, not an acknowledgement of validation, submission or cancellation. */
export type OuPending = { expectSignedUsd: number; sentBlock: number; kind: "increase" | "decrease" };
const ouPending = new Map<string, OuPending>();
type OuDrift = { block: number; fair: number; side: number; count: number };
const ouDrift = new Map<string, OuDrift>();
const ouStopped = new Set<string>();
// Deliberately worker-local: disk state cannot waive the reload confirmation window.
const ouObserved = new Map<string, { block: number; size: number; count: number }>();
type OuEpoch = { key: string; runId: string; startBlock: number; lastBlock: number };
let ouEpoch: OuEpoch | undefined;
let ouStatePath: string | undefined;
let ouLoaded = false;
let ouStorageFailed = false;

/** Tests simulate a replacement worker. Disk is intentionally untouched. */
export function resetOuStateForTest(): void {
  ouAnchors.clear();
  ouPending.clear();
  ouDrift.clear();
  ouStopped.clear();
  ouObserved.clear();
  ouEpoch = undefined;
  ouStatePath = undefined;
  ouLoaded = false;
  ouStorageFailed = false;
}

function ouBlock(obs: AgentObservation): number {
  const block = Number(obs.blockNumber);
  return Number.isFinite(block) ? block : obs.round;
}

function loadOuState(): void {
  ouLoaded = true;
  const dir = process.env.ERIS_AGENT_STATE_DIR;
  // Without durable state, replacement workers cannot safely reconstruct live intents.
  if (!dir) { ouStorageFailed = true; return; }
  ouStatePath = join(dir, "opus-1g2-ou-state.json");
  try {
    // Only this small, strategy-owned file is read. Never read runtime versions or credentials.
    if (statSync(ouStatePath).size > 16_384) throw new Error("oversized OU state");
    const saved = JSON.parse(readFileSync(ouStatePath, "utf8"));
    const e = saved.epoch;
    if (saved.schema !== 1 || !e || typeof e.key !== "string" ||
        typeof e.runId !== "string" || !Number.isSafeInteger(e.startBlock) ||
        !Number.isSafeInteger(e.lastBlock) || !Array.isArray(saved.bases))
      throw new Error("invalid OU state");
    // Validate before installing any of it, so a malformed record cannot partially restore.
    for (const b of saved.bases) {
      if (!OU_BASES.includes(b.base) || !Number.isFinite(b.anchor) || b.anchor <= 0 ||
          typeof b.stopped !== "boolean" ||
          (b.pending && (!Number.isFinite(b.pending.expectSignedUsd) ||
            !Number.isSafeInteger(b.pending.sentBlock) ||
            !["increase", "decrease"].includes(b.pending.kind))) ||
          (b.drift && (!Number.isSafeInteger(b.drift.block) ||
            !Number.isFinite(b.drift.fair) || b.drift.fair <= 0 ||
            ![-1, 0, 1].includes(b.drift.side) || !Number.isSafeInteger(b.drift.count) ||
            b.drift.count < 0))) throw new Error("invalid OU base");
    }
    ouEpoch = e;
    for (const b of saved.bases) {
      ouAnchors.set(b.base, b.anchor);
      if (b.pending) ouPending.set(b.base, b.pending);
      if (b.drift) ouDrift.set(b.base, b.drift);
      if (b.stopped) ouStopped.add(b.base);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") ouStorageFailed = true;
    // No usable state: retain the worker-local confirmation guard.
  }
}

function beginOuObservation(obs: AgentObservation, ctx: AgentContext): void {
  if (!ouLoaded) loadOuState();
  const block = ouBlock(obs);
  // The runtime's block budget gives the run origin, even on a late worker start. With no
  // declared budget, retain the first observed block across reloads of a continuous run.
  const runBlocks = ctx.config.runBlocks;
  const hasRunBudget = Number.isFinite(runBlocks) && runBlocks > 0 &&
    Number.isFinite(obs.blocksRemaining);
  const startBlock = hasRunBudget ? block + obs.blocksRemaining! - runBlocks
    : ouEpoch?.runId === obs.runId ? ouEpoch.startBlock : block;
  const key = obs.epoch
    ? `epoch:${obs.epoch.index}/${obs.epoch.count}` : `start:${startBlock}`;
  // Missing/repeated blocks cannot establish a new epoch or cancel an outstanding intent.
  if (!ouEpoch || ouEpoch.key !== key || ouEpoch.runId !== obs.runId) {
    ouAnchors.clear();
    ouPending.clear();
    ouDrift.clear();
    ouStopped.clear();
    ouObserved.clear();
    const origin = startBlock;
    ouEpoch = { key: obs.epoch ? key : `start:${origin}`, runId: obs.runId,
      startBlock: origin, lastBlock: block };
  }
  ouEpoch.lastBlock = block;
}

function saveOuState(): boolean {
  if (!ouStatePath || !ouEpoch || ouStorageFailed) return false;
  try {
    const body = JSON.stringify({ schema: 1, epoch: ouEpoch,
      bases: OU_BASES.filter(base => ouAnchors.has(base)).map(base => ({
        base, anchor: ouAnchors.get(base), pending: ouPending.get(base),
        drift: ouDrift.get(base), stopped: ouStopped.has(base),
      })),
    });
    // One bounded record, atomically replaced; no observation history accumulates across epochs.
    writeFileSync(`${ouStatePath}.tmp`, body);
    renameSync(`${ouStatePath}.tmp`, ouStatePath);
    return true;
  } catch {
    ouStorageFailed = true;
    ouStatePath = undefined; // Entries stay disabled; risk exits retain in-memory protection.
    return false;
  }
}

function observeOuPosition(base: string, block: number, size: number): number {
  if (block <= (ouPending.get(base)?.sentBlock ?? -Infinity)) return 0;
  const prev = ouObserved.get(base);
  if (prev?.block === block) {
    // Repeated snapshots cannot supply confirmations; conflicting snapshots restart the count.
    if (prev.size !== size) ouObserved.set(base, { block, size, count: 0 });
    return ouObserved.get(base)!.count;
  }
  const count = prev && prev.block === block - 1 && prev.size === size ? prev.count + 1 : 1;
  ouObserved.set(base, { block, size, count: Math.min(count, PARAMS.ouConfirmBlocks) });
  return count;
}

function observeOuRisk(base: string, block: number, fair: number, anchor: number,
  position: GmxPositionObs | undefined): boolean {
  const side = Math.sign(signedSizeUsd(position));
  const prev = ouDrift.get(base);
  if (prev?.block !== block) {
    const adverse = side !== 0 && prev?.side === side && prev.block === block - 1 &&
      side * (fair - prev.fair) < 0 && side * (fair - anchor) < 0;
    ouDrift.set(base, { block, fair, side,
      count: adverse ? Math.min(prev.count + 1, PARAMS.ouAdverseDriftBlocks) : 0 });
  }
  const collateralUsd = Number(big(position?.collateralAmount)) / 1e6;
  const loss = position && side !== 0 &&
    position.pnlUsd < -PARAMS.ouLossCollateralFrac * collateralUsd;
  if (loss || (ouDrift.get(base)?.count ?? 0) >= PARAMS.ouAdverseDriftBlocks)
    ouStopped.add(base);
  return ouStopped.has(base);
}

/** The anchor for one base: the published opening fair when the first fair seen is near it. */
export function resolveOuAnchor(base: string, fair: number): number {
  const cached = ouAnchors.get(base);
  if (cached !== undefined) return cached;
  const published = PARAMS.ouPublishedAnchor[base];
  const anchor =
    published !== undefined &&
    Math.abs(fair / published - 1) <= PARAMS.ouAnchorMatchFrac
      ? published
      : fair;
  ouAnchors.set(base, anchor);
  return anchor;
}

/** +1 long, -1 short, 0 hold (inside the band: keep whatever is held, including nothing). */
export function ouSignal(g: number): -1 | 0 | 1 {
  if (!Number.isFinite(g)) return 0;
  if (g > PARAMS.ouEntryFrac) return 1;
  if (g < -PARAMS.ouEntryFrac) return -1;
  return 0;
}

type GmxMarketObs = NonNullable<NonNullable<AgentObservation["protocols"]>["gmx"]>;
type GmxPositionObs = NonNullable<GmxMarketObs["position"]>;

/** The base's GMX market as observed, or undefined when the venue or the market is not there. */
export function gmxMarketOf(
  obs: AgentObservation,
  base: string,
): GmxMarketObs | undefined {
  const gmx = obs.protocols?.gmx;
  if (!gmx) return undefined;
  if (base === "WETH") return gmx;
  return gmx.markets?.[`${base}/USDC`] as GmxMarketObs | undefined;
}

/** Signed USD size of a position: positive long, negative short, 0 when there is none. */
export function signedSizeUsd(pos: GmxPositionObs | undefined): number {
  if (!pos) return 0;
  const size = Number(big(pos.sizeUsd) / 10n ** 24n) / 1e6;
  if (!Number.isFinite(size) || size <= 0) return 0;
  return pos.isLong ? size : -size;
}

function ouFair(obs: AgentObservation, base: string, market: GmxMarketObs): number {
  const fromObs =
    base === "WETH"
      ? obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth
      : obs.fairPricesUsd?.[base];
  if (fromObs !== undefined && fromObs > 0) return fromObs;
  return market.marketPriceUsd;
}

export type OuDecision = {
  base: string;
  g: number;
  signedUsd: number;
  action?: Record<string, unknown>;
  pending?: OuPending;
  usdcSpent: bigint;
  note: string;
};

/**
 * Pure plan for one base. The caller owns confirmation history, risk latches, pending intents
 * and the wallet, so the arithmetic can be exercised without a chain.
 */
export function ouPlan(args: {
  base: string;
  fair: number;
  anchor: number;
  position: GmxPositionObs | undefined;
  pending: OuPending | undefined;
  block: number;
  blocksRemaining: number;
  usdcFreeUnits: bigint;
  ethWei: bigint;
  priorityFeeWei: string;
  confirmedBlocks: number;
  riskStopped?: boolean;
  orderGasWei?: bigint;
  closingReserveWei?: bigint;
  entriesAllowed?: boolean;
}): OuDecision {
  const { base, fair, anchor, position, block } = args;
  const g = (anchor - fair) / fair;
  const signedUsd = signedSizeUsd(position);
  const out: OuDecision = { base, g, signedUsd, usdcSpent: 0n, note: "" };

  // No order-status API is exposed by obs. Time passing never proves cancellation. Position
  // absence is treated as flat only under the runtime's confirmed-snapshot contract, and a
  // decrease must be reflected in three consecutive observations before an opposite increase.
  let pending = args.pending;
  if (pending) {
    const tol = Math.max(PARAMS.ouReflectTolUsd, Math.abs(pending.expectSignedUsd) * 0.02);
    if (Math.abs(signedUsd - pending.expectSignedUsd) <= tol &&
        (pending.kind === "increase" || args.confirmedBlocks >= PARAMS.ouConfirmBlocks)) {
      pending = undefined;
    } else if (block - pending.sentBlock >= PARAMS.ouPendingMaxBlocks) {
      // Expiration is not cancellation. Keep entries disabled for the epoch.
      args = { ...args, riskStopped: true };
      pending = undefined;
    } else if (pending.kind === "decrease" || !args.riskStopped || signedUsd === 0) {
      out.pending = pending;
      out.note = `waiting for ${pending.kind} sent at ${pending.sentBlock}`;
      return out;
    }
  }
  out.pending = undefined;

  // 2. The bell: what is held is valued as it stands; a new order might not even execute in time.
  if (!args.riskStopped && args.blocksRemaining <= PARAMS.ouStopBlocks) {
    out.note ||= "end of epoch: no new orders";
    return out;
  }

  const want = ouSignal(g);
  const held = signedUsd > 0 ? 1 : signedUsd < 0 ? -1 : 0;
  if (!args.riskStopped && (want === 0 || want === held)) {
    out.note ||= want === 0 ? "inside the band: hold" : "positioned";
    return out;
  }
  const orderCost = GMX_EXECUTION_FEE_WEI + (args.orderGasWei ?? 0n);
  const closeReserve = args.closingReserveWei ?? 0n;
  if (args.ethWei < orderCost + (held === 0
      ? PARAMS.ouEthReserveWei + closeReserve + orderCost : 0n)) {
    out.note = "ETH short of the execution fee";
    return out;
  }

  // 3. Wrong side: close it all. The opposite side opens once this shows as gone.
  if (held !== 0 && position) {
    out.action = {
      type: "gmxDecrease",
      isLong: position.isLong,
      base,
      collateral: position.collateral,
      collateralDeltaAmount: big(position.collateralAmount).toString(),
      sizeDeltaUsd: big(position.sizeUsd).toString(),
      maxPriorityFeePerGasWei: args.priorityFeeWei,
    };
    out.pending = { expectSignedUsd: 0, sentBlock: block, kind: "decrease" };
    out.note = `${args.riskStopped ? "risk exit: " : ""}g ${(g * 100).toFixed(2)}%: close ${held > 0 ? "long" : "short"} ${Math.round(Math.abs(signedUsd))}`;
    return out;
  }

  // 4. A risk exit disables entries for the remainder of this epoch. Three observations
  // mitigate the measured two-block fill window without claiming exactly-once submission.
  if (args.entriesAllowed === false || args.riskStopped || args.confirmedBlocks < PARAMS.ouConfirmBlocks) {
    out.note = args.riskStopped ? "risk exit: entries disabled" : "waiting for stable position";
    return out;
  }
  // Flat: open the signalled side at the notional the free USDC can carry.
  const reserve = unitsFromUsd(PARAMS.ouUsdcReserveUsd, 1, 6);
  const spendable = args.usdcFreeUnits > reserve ? args.usdcFreeUnits - reserve : 0n;
  const affordableUsd = (Number(spendable) / 1e6) * PARAMS.ouLeverage;
  const notionalUsd = Math.floor(Math.min(PARAMS.ouNotionalUsd, affordableUsd));
  if (notionalUsd < PARAMS.ouMinNotionalUsd) {
    out.note = `USDC short: ${Math.round(Number(args.usdcFreeUnits) / 1e6)} free`;
    return out;
  }
  const collateral = unitsFromUsd(notionalUsd / PARAMS.ouLeverage, 1, 6);
  out.action = {
    type: "gmxIncrease",
    isLong: want > 0,
    base,
    collateral: "USDC",
    collateralAmount: collateral.toString(),
    sizeDeltaUsd: (BigInt(notionalUsd) * USD_1E30).toString(),
    maxPriorityFeePerGasWei: args.priorityFeeWei,
  };
  out.usdcSpent = collateral;
  out.pending = {
    expectSignedUsd: want > 0 ? notionalUsd : -notionalUsd,
    sentBlock: block,
    kind: "increase",
  };
  out.note = `g ${(g * 100).toFixed(2)}%: open ${want > 0 ? "long" : "short"} ${notionalUsd}`;
  return out;
}

/** Reservation estimates include 20% headroom over the runtime dependent-tx fallback.
 * These are planning bounds, not measured gas or an execution guarantee. */
function reservedTxGas(): bigint {
  const fallback = big(process.env.ERIS_DEPENDENT_TX_GAS ?? "2000000");
  return (fallback > 2_000_000n ? fallback : 2_000_000n) * 120n / 100n;
}
function actionGas(action: Record<string, unknown>): bigint {
  if (action.type === "bundle" && Array.isArray(action.actions))
    return action.actions.reduce((sum: bigint, a: Record<string, unknown>) => sum + actionGas(a), 0n);
  const explicit = big((action.tx as { gas?: string } | undefined)?.gas);
  return explicit > reservedTxGas() ? explicit : reservedTxGas();
}
function gasPriceReserve(obs: AgentObservation): bigint {
  const def = big(obs.limits?.defaultPriorityFeePerGasWei) || 1n;
  const cap = big(obs.limits?.maxPriorityFeePerGasWei);
  return cap > def ? cap : def;
}

function ouModule(
  obs: AgentObservation,
  wallet: Wallet,
  out: Candidate[],
  signals: Record<string, number | undefined>,
  baseGas: bigint,
): void {
  const blockNo = ouBlock(obs);
  const fee = (big(obs.limits?.defaultPriorityFeePerGasWei) || 1n).toString();
  const gas = reservedTxGas();
  const gasWei = gas * gasPriceReserve(obs);
  const closeCost = GMX_EXECUTION_FEE_WEI + gasWei;
  const cap = big(process.env.ERIS_MAX_AGENT_BLOCK_GAS ?? "10000000");
  let gasUsed = baseGas;
  // Count both observed positions and unreflected increases, once per market.
  let closingReserve = OU_BASES.reduce((sum, base) => sum +
    (signedSizeUsd(gmxMarketOf(obs, base)?.position) !== 0 ||
      ouPending.get(base)?.kind === "increase" || ouStopped.has(base) ? closeCost : 0n), 0n);
  // Process existing exposure first so an entry cannot consume another market's exit slot.
  const bases = [...OU_BASES].sort((a, b) =>
    Number(signedSizeUsd(gmxMarketOf(obs, b)?.position) !== 0) -
    Number(signedSizeUsd(gmxMarketOf(obs, a)?.position) !== 0));
  for (const base of bases) {
    const intent = ouPending.get(base);
    if (intent && blockNo - intent.sentBlock >= PARAMS.ouPendingMaxBlocks) {
      ouPending.delete(base);
      ouStopped.add(base); // A deadline never proves the original order was cancelled.
    }
    const market = gmxMarketOf(obs, base);
    if (!market) {
      ouObserved.delete(base);
      ouDrift.delete(base);
      // A missing venue says nothing about settlement: retain pending orders and the anchor.
      continue;
    }
    const fair = ouFair(obs, base, market);
    if (!(fair > 0) || !Number.isFinite(fair)) {
      ouObserved.delete(base);
      ouDrift.delete(base);
      continue;
    }
    const anchor = resolveOuAnchor(base, fair);
    const confirmedBlocks = observeOuPosition(base, blockNo, signedSizeUsd(market.position));
    const riskStopped = observeOuRisk(base, blockNo, fair, anchor, market.position);
    const d = ouPlan({
      base,
      fair,
      anchor,
      position: market.position,
      pending: ouPending.get(base),
      block: blockNo,
      blocksRemaining: blocksLeft(obs),
      usdcFreeUnits: wallet.usdc,
      ethWei: wallet.ethWei,
      priorityFeeWei: fee,
      confirmedBlocks,
      riskStopped,
      entriesAllowed: !ouStorageFailed,
      orderGasWei: gasWei,
      closingReserveWei: closingReserve,
    });
    // Only reconcile existing intents here. New pending state is committed at the return boundary.
    if (!d.action && !d.pending) ouPending.delete(base);
    // Log only: the position path, its fill price and collateral against the fair, for measuring.
    signals[`ouG${base}Bps`] = Math.round(d.g * 100_000) / 10;
    signals[`ouPos${base}Usd`] = Math.round(d.signedUsd);
    signals[`ouFair${base}`] = fair;
    signals[`ouAnchor${base}`] = anchor;
    if (market.position) {
      signals[`ouEntry${base}`] = market.position.entryPriceUsd;
      signals[`ouColl${base}`] = Number(big(market.position.collateralAmount)) / 1e6;
      signals[`ouPnl${base}`] = market.position.pnlUsd;
    }
    if (d.pending) signals[`ouPending${base}`] = d.pending.sentBlock;
    if (!d.action) continue;
    if (d.action.type === "gmxIncrease" && cap > 0n && gasUsed + gas > cap) continue;
    gasUsed += gas;
    wallet.usdc -= d.usdcSpent;
    wallet.ethWei -= closeCost;
    if (d.action.type === "gmxIncrease") closingReserve += closeCost;
    // A decrease is only an intent: retain its closing reserve until reflection.
    out.push({
      tag: `ou:${base}:${d.action.type === "gmxIncrease" ? (d.action.isLong ? "long" : "short") : "close"}`,
      action: d.action,
      priority: 0,
      profitUsd: 0,
      reason: `ou ${base} ${d.note} (fair ${fair.toFixed(2)} anchor ${anchor})`,
    });
  }
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

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
  beginOuObservation(obs, ctx);
  const candidates: Candidate[] = [];
  let views: MarketView[] = [];
  const wallet = readWallet(obs);
  const gasPrice = gasPriceReserve(obs);
  const closeGas = reservedTxGas();
  const openPositions = OU_BASES.filter(base =>
    signedSizeUsd(gmxMarketOf(obs, base)?.position) !== 0).length;
  // Hide closing funds from every base planner, including wrapping. Pending increases
  // may still fill, and a stopped market may have an unresolved expired intent.
  const closingReserve = OU_BASES.reduce((sum, base) => sum +
    (signedSizeUsd(gmxMarketOf(obs, base)?.position) !== 0 ||
      ouPending.get(base)?.kind === "increase" || ouStopped.has(base)
      ? GMX_EXECUTION_FEE_WEI + closeGas * gasPrice : 0n), 0n);
  wallet.ethWei -= closingReserve;

  guard("markets", () => {
    views = marketViews(obs);
  }, ctx);
  guard("crossVenue", () => crossVenueModule(obs, views, wallet, candidates), ctx);
  guard("inventory", () => inventoryModule(obs, views, wallet, candidates), ctx);
  guard("liquity", () => liquityModule(obs, wallet, candidates), ctx);
  guard("stable", () => stableModule(obs, wallet, candidates), ctx);
  // A wrap must fund its own transaction as well as leave the closing reserve intact.
  const wrapGasWei = closingReserve > 0n ? closeGas * gasPrice : 0n;
  wallet.ethWei -= wrapGasWei;
  guard("wrap", () => wrapEthModule(obs, wallet, candidates), ctx);
  wallet.ethWei += wrapGasWei;

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
  const cap = big(process.env.ERIS_MAX_AGENT_BLOCK_GAS ?? "10000000");
  const exitGas = BigInt(openPositions) * closeGas;
  const chosen: Candidate[] = [];
  let baseGas = 0n;
  for (const candidate of candidates) {
    if (chosen.length >= PARAMS.maxActionsPerBlock) break;
    const gas = actionGas(candidate.action);
    // An open position gets close capacity before any base action. Keep bundles atomic.
    if (openPositions > 0 && cap > 0n && baseGas + gas + exitGas > cap) continue;
    if (closingReserve > 0n && (baseGas + gas) * gasPrice > wallet.ethWei) continue;
    chosen.push(candidate);
    baseGas += gas;
  }

  // OU orders ride beside the base action slots. Restore the protected closing funds
  // for OU only; base actions have already been checked against the unreserved balance.
  const ouOrders: Candidate[] = [];
  const ouSignals: Record<string, number | undefined> = {};
  wallet.ethWei += closingReserve;
  wallet.ethWei -= baseGas * gasPrice;
  guard("ou", () => ouModule(obs, wallet, ouOrders, ouSignals, baseGas), ctx);

  if (!saveOuState()) {
    for (let i = ouOrders.length - 1; i >= 0; i--)
      if (ouOrders[i].action.type === "gmxIncrease") ouOrders.splice(i, 1);
  } // anchors/risk history survive even if logging below throws; no new intents yet
  ouSignals.ouPersistenceDegraded = ouStorageFailed ? 1 : 0;
  const weth = views.find((v) => v.base === "WETH");
  const reasons = [...chosen, ...ouOrders].map((c) => c.reason);
  ctx.log({
    round: obs.round,
    action: chosen[0]?.action ?? ouOrders[0]?.action ?? { type: "noop" },
    reason: reasons.length === 0 ? "no edge over the round trip" : reasons.join(" | "),
    signals: {
      ...ouSignals,
      ethWei: Number(big(obs.balances?.ethWei)) / 1e18,
      usdc: Number(big(obs.balances?.usdcUnits)) / 1e6,
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
    state: {
      tags: [...chosen, ...ouOrders].map((c) => c.tag),
      elapsedMs: Date.now() - startedAt,
    },
  });

  const previousPending = new Map(ouPending);
  const previousObserved = new Map(ouObserved);
  // Record intents before queuing. The runtime still may reject/discard a successful call;
  // expiration therefore latches entries off rather than assuming cancellation.
  for (const c of ouOrders) {
    const action = c.action;
    const base = String(action.base);
    const increase = action.type === "gmxIncrease";
    const size = Number(big(String(action.sizeDeltaUsd)) / 10n ** 24n) / 1e6;
    ouPending.set(base, { expectSignedUsd: increase ? (action.isLong ? size : -size) : 0,
      sentBlock: ouBlock(obs), kind: increase ? "increase" : "decrease" });
    ouObserved.delete(base);
  }
  // Persist intents before any queued/returned increase can leave a successful call.
  if (!saveOuState()) {
    for (let i = ouOrders.length - 1; i >= 0; i--)
      if (ouOrders[i].action.type === "gmxIncrease") ouOrders.splice(i, 1);
  }
  const emitted = [...chosen, ...ouOrders];
  if (emitted.length === 0) return null;
  try {
    for (const c of emitted.slice(1)) ctx.submit(c.action);
  } catch (error) {
    // The runtime discards buffered submits when decide throws.
    ouObserved.clear();
    for (const [base, observed] of previousObserved) ouObserved.set(base, observed);
    ouPending.clear();
    for (const [base, pending] of previousPending) ouPending.set(base, pending);
    saveOuState();
    throw error;
  }
  return emitted[0].action;
}
