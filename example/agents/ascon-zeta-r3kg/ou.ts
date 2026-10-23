// M-OU ported from opus-1g. Pure sizing/signals plus bounded per-epoch state.
// The r3k dispatcher is never changed by OU: all orders use submitOu's ctx.submit boundary.
import type { AgentAction, AgentObservation, AgentContext } from "@eris/sdk";
import { readFileSync, statSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from "node:fs";
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { PARAMS as DELTA_PARAMS } from "./delta.js";
import { GMX, TOKENS } from "@eris/sdk/constants.js";
import { encodeAbiParameters, keccak256 } from "viem";

export const M_OU_ENABLED = true;
export const PARAMS = {
  // -- M-OU GMX anchor pull (opus-1g) ---------------------------------------
  /** Long when (anchor - fair) / fair is above this, short when below its negative, hold between. */
  ouEntryFrac: 0.008,
  /** Notional per base. */
  ouNotionalUsd: 40_000,
  /** Size / collateral. This is sizing, not a liquidation guarantee: cumulative moves, fees
   *  and keeper delay can outrun even the loss/drift exits below. */
  ouLeverage: 4,
  /** Minimum USDC reserve; ouUsdcReserve also protects r3k's maximum next delta trade. */
  ouUsdcReserveUsd: 5_000,
  /** When USDC caps the size, an order smaller than this is not worth its fees. */
  ouMinNotionalUsd: 10_000,
  /** Distinct consecutive observations required before an increase (also after worker reload). */
  ouConfirmBlocks: 3,
  ouLossCollateralFrac: 0.5,
  ouAdverseDriftBlocks: 24,
  /** No new orders once this few blocks remain (the position is valued as it stands at the bell). */
  ouStopBlocks: 5,
  /** The published opening fair per base; used as the anchor when the first fair is within
   *  ouAnchorMatchFrac of it. A persisted anchor always takes precedence. */
  ouPublishedAnchor: { WETH: 3_000, WBTC: 60_000 } as Record<string, number>,
  ouAnchorMatchFrac: 0.02,

};

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


/** Keep max(largest next delta buy, $5k) of the ORIGINAL observed USDC.
 * Delta's maximum is floor(balance * MAX_SIZE_BPS / 10000), currently 25%.
 * Current r3k spending and earlier OU collateral are deducted separately, without crediting
 * sale proceeds. Thus total OU collateral <= balance - currentSpend - this reserve.
 */
export function ouUsdcReserve(balance: bigint): bigint {
  const nextTrade = balance * BigInt(DELTA_PARAMS.MAX_SIZE_BPS) / 10_000n;
  const floor = unitsFromUsd(PARAMS.ouUsdcReserveUsd, 1, 6);
  return nextTrade > floor ? nextTrade : floor;
}

const USD_1E30 = 10n ** 30n;
/** The execution fee the runtime attaches to every GMX order (sdk/src/protocols/gmx.ts). */
const GMX_EXECUTION_FEE_WEI = 30_000_000_000_000_000n;

const OU_BASES = ["WETH", "WBTC"] as const;
const ouAnchors = new Map<string, number>();

/** An emitted intent, not an acknowledgement of validation, submission or cancellation. */
export type OuPending = { expectSignedUsd: number; sentBlock: number; kind: "increase" | "decrease"; logOffset?: number; action?: Record<string, unknown> };
const ouPending = new Map<string, OuPending>();
type OuDrift = { block: number; fair: number; side: number; count: number };
const ouDrift = new Map<string, OuDrift>();
const ouStopped = new Set<string>();
// Deliberately worker-local: disk state cannot waive the reload confirmation window.
const ouObserved = new Map<string, { block: number; size: number; count: number }>();
// A replacement worker cannot see memory-only pending keeper orders in observations.
const OU_COLD_START_GRACE_BLOCKS = 6;
let ouMemoryStartBlock: number | undefined;
type OuEpoch = { key: string; runId: string; startBlock: number; lastBlock: number };
let ouEpoch: OuEpoch | undefined;
let ouStatePath: string | undefined;
let ouLoaded = false;
let ouStorageFailed = false;
type OuRefresh = {
  epoch: OuEpoch;
  block: number;
  settled?: Promise<void>;
  results?: { base: string; pending: OuPending; terminal: boolean }[];
};
let ouRefresh: OuRefresh | undefined;

/** Wait for the current refresh snapshot, including timeout handling, without consuming it. */
export async function ouRefreshSettledForTest(): Promise<void> {
  await ouRefresh?.settled;
}

/** Tests simulate a replacement worker. Disk is intentionally untouched. */
export function resetOuStateForTest(): void {
  ouRefresh = undefined;
  ouAnchors.clear();
  ouPending.clear();
  ouDrift.clear();
  ouStopped.clear();
  ouObserved.clear();
  ouMemoryStartBlock = undefined;
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
  // Without an offered store, the module maps retain intent and risk state for this
  // run/epoch. A configured store's failures must never fall back to memory mode.
  if (dir === undefined) return;
  ouStatePath = join(dir, "ascon-zeta-r3kg-ou-state.json");
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
            !["increase", "decrease"].includes(b.pending.kind) ||
            (b.pending.logOffset !== undefined && (!Number.isSafeInteger(b.pending.logOffset) || b.pending.logOffset < 0)))) ||
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
    // ENOENT is a fresh store; all other load errors latch fail-closed.
  }
}

function beginOuObservation(obs: AgentObservation, ctx: AgentContext): void {
  if (!ouLoaded) loadOuState();
  const block = ouBlock(obs);
  // The runtime's block budget gives the run origin, even on a late worker start. With no
  // declared budget, retain the first observed block across reloads of a continuous run.
  const runBlocks = ctx.config?.runBlocks;
  const hasRunBudget = Number.isFinite(runBlocks) && runBlocks > 0 &&
    Number.isFinite(obs.blocksRemaining);
  const startBlock = hasRunBudget ? block + obs.blocksRemaining! - runBlocks
    : ouEpoch?.runId === obs.runId ? ouEpoch.startBlock : block;
  const key = obs.epoch
    ? `epoch:${obs.epoch.index}/${obs.epoch.count}` : `start:${startBlock}`;
  // Only an explicit run/epoch change clears durable intent and risk state.
  // Gaps reset consecutive confirmation naturally, never pending orders.
  if (!ouEpoch || ouEpoch.key !== key || ouEpoch.runId !== obs.runId) {
    ouRefresh = undefined;
    ouAnchors.clear();
    ouPending.clear();
    ouDrift.clear();
    ouStopped.clear();
    ouObserved.clear();
    ouMemoryStartBlock = ouStatePath === undefined ? block : undefined;
    const origin = startBlock;
    ouEpoch = { key: obs.epoch ? key : `start:${origin}`, runId: obs.runId,
      startBlock: origin, lastBlock: block };
  }
  ouEpoch.lastBlock = block;
}

function saveOuState(): boolean {
  if (ouStorageFailed || !ouEpoch) return false;
  if (!ouStatePath) return true; // no store offered: state already lives in module maps
  try {
    const body = JSON.stringify({ schema: 1, epoch: ouEpoch,
      bases: OU_BASES.filter(base => ouAnchors.has(base)).map(base => ({
        base, anchor: ouAnchors.get(base), pending: ouPending.get(base),
        drift: ouDrift.get(base), stopped: ouStopped.has(base),
      })),
    });
    // One bounded record, atomically replaced; no observation history accumulates across epochs.
    writeFileSync(`${ouStatePath}.tmp`, body);
    const fd = openSync(`${ouStatePath}.tmp`, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(`${ouStatePath}.tmp`, ouStatePath);
    const dirFd = openSync(join(ouStatePath, ".."), "r");
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    return true;
  } catch {
    ouStorageFailed = true;
    return false; // retain the intent in memory; block entries after a failed write
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
  /** 0 none, 1 pending, 2 epoch end, 3 ETH, 4 persistence, 5 risk, 6 confirmation, 7 USDC, 8 capacity, 9 cold-start grace. */
  skipReason: number;
  requiredEthWei: bigint;
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
  /** Original observed balance, before r3k and other OU reservations. */
  usdcBalanceUnits?: bigint;
  ethWei: bigint;
  priorityFeeWei: string;
  confirmedBlocks: number;
  riskStopped?: boolean;
  persistenceFailed?: boolean;
  coldStartGrace?: boolean;
  pendingTerminal?: boolean;
  orderGasWei: bigint;
  closeReserveWei: bigint;
}): OuDecision {
  const { base, fair, anchor, position, block } = args;
  const g = (anchor - fair) / fair;
  const signedUsd = signedSizeUsd(position);
  const requiredEthWei = GMX_EXECUTION_FEE_WEI + args.orderGasWei +
    (signedUsd === 0 ? args.closeReserveWei : 0n);
  const out: OuDecision = { base, g, signedUsd, usdcSpent: 0n, note: "",
    skipReason: 0, requiredEthWei };

  // Only terminal execution/cancellation evidence releases an intent. Neither exact
  // balances nor three flat snapshots establish that a live order has disappeared.
  if (args.pending && !args.pendingTerminal) {
    out.skipReason = 1;
    out.pending = args.pending;
    out.note = `waiting for ${args.pending.kind} sent at ${args.pending.sentBlock}`;
    return out;
  }
  out.pending = undefined;

  // 2. The bell: what is held is valued as it stands; a new order might not even execute in time.
  if (args.blocksRemaining <= PARAMS.ouStopBlocks) {
    out.skipReason = 2;
    out.note ||= "end of epoch: no new orders";
    return out;
  }

  const want = ouSignal(g);
  const held = signedUsd > 0 ? 1 : signedUsd < 0 ? -1 : 0;
  if (!args.riskStopped && (want === 0 || want === held)) {
    out.note ||= want === 0 ? "inside the band: hold" : "positioned";
    return out;
  }
  if (args.ethWei < requiredEthWei) {
    out.skipReason = 3;
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

  if (args.persistenceFailed) {
    out.skipReason = 4;
    out.note = "persistence unavailable: entries disabled";
    return out;
  }

  if (args.coldStartGrace) {
    out.skipReason = 9;
    out.note = "cold-start grace: waiting for memory-only keeper orders";
    return out;
  }

  // 4. A risk exit disables entries for the remainder of this epoch. Three observations
  // mitigate the measured two-block fill window without claiming exactly-once submission.
  if (args.riskStopped || args.confirmedBlocks < PARAMS.ouConfirmBlocks) {
    out.skipReason = args.riskStopped ? 5 : 6;
    out.note = args.riskStopped ? "risk exit: entries disabled" : "waiting for stable position";
    return out;
  }
  // Flat: open the signalled side at the notional the free USDC can carry.
  const reserve = ouUsdcReserve(args.usdcBalanceUnits ?? args.usdcFreeUnits);
  const spendable = args.usdcFreeUnits > reserve ? args.usdcFreeUnits - reserve : 0n;
  const affordableUsd = (Number(spendable) / 1e6) * PARAMS.ouLeverage;
  const notionalUsd = Math.floor(Math.min(PARAMS.ouNotionalUsd, affordableUsd));
  if (notionalUsd < PARAMS.ouMinNotionalUsd) {
    out.skipReason = 7;
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

type ReturnedAction = AgentAction | Record<string, unknown> | null;

/** OU submits this same bid; a venue validation ceiling is not a transaction price. */
function ouBid(obs: AgentObservation): bigint {
  return big(obs.limits?.defaultPriorityFeePerGasWei) || 1n;
}

/** Match SDK bid precedence: bundle override, leaf bid, observation default. */
function actionBid(obs: AgentObservation, action: NonNullable<ReturnedAction>, bundleBid?: string): bigint {
  return big(bundleBid ?? (action as { maxPriorityFeePerGasWei?: string }).maxPriorityFeePerGasWei ??
    obs.limits?.defaultPriorityFeePerGasWei);
}

/** Open positions own closing ETH and block capacity before any base candidate. */
export function ouClosingReserve(obs: AgentObservation, ctx: AgentContext): {
  positions: number; gas: bigint; eth: bigint;
} {
  const positions = OU_BASES.filter(base => big(gmxMarketOf(obs, base)?.position?.sizeUsd) > 0n).length;
  const perTx = ctx.config?.maxTxGas ?? 10_000_000n;
  const fee = ouBid(obs);
  return { positions, gas: BigInt(positions) * perTx,
    eth: BigInt(positions) * (GMX_EXECUTION_FEE_WEI + perTx * fee) };
}

/** Unknown multi-transaction actions fail closed only while a close is owed. */
export function baseFitsOuReserve(obs: AgentObservation, ctx: AgentContext, action: ReturnedAction): boolean {
  const reserve = ouClosingReserve(obs, ctx);
  if (!reserve.positions || !action || action.type === "noop") return true;
  const perTx = ctx.config?.maxTxGas ?? 10_000_000n;
  const perBlock = ctx.config?.maxAgentBlockGas ?? 10_000_000n;
  const fee = ouBid(obs);
  if (perTx <= 0n || fee <= 0n) return false;
  let gas = 0n, gasWei = 0n, value = 0n;
  function count(a: ReturnedAction, bundleBid?: string): boolean {
    if (!a || a.type === "noop") return true;
    if (a.type === "bundle") return (a as { actions: ReturnedAction[] }).actions.every(
      leg => count(leg, (a as { maxPriorityFeePerGasWei?: string }).maxPriorityFeePerGasWei));
    gas += perTx;
    const bid = actionBid(obs, a, bundleBid);
    if (bid < 0n) return false;
    gasWei += perTx * bid;
    if (["swap", "curveSwap", "balancerSwap"].includes(String(a.type))) return true;
    if (a.type === "rawTx") {
      const tx = (a as { tx: { to?: string; data?: string; value?: string } }).tx;
      // The recovery wrap is one transaction with an explicit native value.
      if (tx.to?.toLowerCase() === TOKENS.WETH.address.toLowerCase() && tx.data === "0xd0e30db0") {
        value += big(tx.value);
        return true;
      }
    }
    return false;
  }
  return count(action) && (perBlock <= 0n || reserve.gas + gas <= perBlock) &&
    big(obs.balances.ethWei) >= reserve.eth + value + gasWei;
}

/** Reserve gas units at the sender's enforced transaction ceiling, priced at actual bids. The supported swap adapters and
 * GMX buildTxs return one transaction each; approvals belong to setupWallet. Any other
 * action (including Liquity's potentially multi-tx operations) disables OU sharing.
 * Without a finite transaction gas cap there is no defensible capacity bound. */
export function ouBudget(obs: AgentObservation, ctx: AgentContext, action: ReturnedAction): {
  slots: number; usdcFreeUnits: bigint; usdcBalanceUnits: bigint; ethWei: bigint;
  orderGasWei: bigint; closeReserveWei: bigint;
} {
  const balance = big(obs.balances?.usdcUnits);
  const perTx = ctx.config?.maxTxGas ?? 10_000_000n;
  const perBlock = ctx.config?.maxAgentBlockGas ?? 10_000_000n;
  const fee = ouBid(obs);
  let spend = 0n, nativeSpend = 0n, reservedGas = 0n, baseGasWei = 0n, opaque = perTx <= 0n || fee <= 0n;
  function count(a: ReturnedAction, bundleBid?: string): void {
    if (!a || a.type === "noop") return;
    if (a.type === "bundle") {
      for (const leg of (a as { actions: ReturnedAction[] }).actions)
        count(leg, (a as { maxPriorityFeePerGasWei?: string }).maxPriorityFeePerGasWei);
      return;
    }
    reservedGas += perTx;
    const bid = actionBid(obs, a, bundleBid);
    if (bid < 0n) opaque = true;
    baseGasWei += perTx * bid;
    if (["swap", "curveSwap", "balancerSwap"].includes(String(a.type))) {
      const trade = a as { tokenIn?: string; amountIn?: string };
      if (trade.tokenIn === "USDC") spend += big(trade.amountIn);
    } else if (a.type === "rawTx" && ouClosingReserve(obs, ctx).positions && baseFitsOuReserve(obs, ctx, a)) {
      nativeSpend += big((a as { tx: { value?: string } }).tx.value);
    } else opaque = true;
  }
  count(baseFitsOuReserve(obs, ctx, action) ? action : null);
  const orderGasWei = perTx > 0n && fee > 0n ? perTx * fee : 0n;
  let slots = 0;
  if (!opaque) for (let orders = 1; orders <= OU_BASES.length; orders++) {
    if (perBlock > 0n && reservedGas + BigInt(orders) * perTx > perBlock) break;
    slots = orders;
  }
  return { slots, usdcFreeUnits: balance > spend ? balance - spend : 0n,
    usdcBalanceUnits: balance,
    ethWei: big(obs.balances?.ethWei) - nativeSpend - baseGasWei,
    orderGasWei,
    // Reserve every supported position, including an unreflected increase. No assumed
    // keeper refund or collateral proceeds fund a future exit.
    closeReserveWei: BigInt(OU_BASES.length) * (GMX_EXECUTION_FEE_WEI + orderGasWei),
  };
}

/** Runtime self-report evidence, never a timeout or a stable-balance guess. Only this
 * agent's known JSONL log is read. Missing/truncated evidence leaves the intent pending. */
function ownLogPath(ctx: AgentContext): string | undefined {
  const dir = process.env.ERIS_RUN_DIR;
  if (!dir || process.env.ERIS_RUN_DIR_POINTER || !/^[a-zA-Z0-9_-]+$/.test(ctx.agentId)) return;
  return join(dir, "agents", `${ctx.agentId}.jsonl`);
}
export function intentLogOffset(ctx: AgentContext): number | undefined {
  const path = ownLogPath(ctx);
  if (!path) return;
  try { return statSync(path).size; } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
  }
}
async function boundedRead<T>(read: Promise<T>, timeoutMs = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("OU evidence timeout")), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
export type IntentEvidence = { sentBlock: number; logOffset?: number; action: Record<string, unknown> };
/** Returns a rejection or a mined receipt. submit_failed is deliberately unknown:
 * a transport failure can hide an accepted transaction. */
export async function intentOutcome(ctx: AgentContext, obs: AgentObservation, p: IntentEvidence, background = false, isCurrent = () => true): Promise<"rejected" | "success" | "reverted" | undefined> {
  const path = ownLogPath(ctx);
  if (!path || p.logOffset === undefined || ouBlock(obs) <= p.sentBlock) return;
  try {
    const size = background ? (await stat(path)).size : statSync(path).size;
    if (!isCurrent() || size > 4_000_000 || size < p.logOffset) return;
    const data = background ? await readFile(path) : readFileSync(path);
    if (!isCurrent()) return;
    const lines = data.subarray(p.logOffset).toString("utf8").split("\n");
    const matches = lines.filter(Boolean).map(line => JSON.parse(line)).filter(e => {
      if (e.kind !== "mempool") return false;
      if (e.blockSeen === p.sentBlock && e.actionType === p.action.type &&
          (e.base ?? "WETH") === (p.action.base ?? "WETH")) return true;
      // Validation rejections predate blockSeen metadata. The write-ahead log cursor
      // and exact action shape identify those without interpreting a balance snapshot.
      if (e.event !== "rejected" || !e.action) return false;
      const expected = { ...p.action };
      // parseAction canonicalizes the default WETH market by omitting base.
      if (expected.base === "WETH" && e.action.base === undefined) delete expected.base;
      return isDeepStrictEqual(e.action, expected);
    });
    if (matches.length !== 1) return;
    const e = matches[0];
    if (e.event === "rejected") return "rejected";
    if (e.event !== "submitted" || !/^0x[0-9a-fA-F]{64}$/.test(e.hash)) return;
    const receipt = await boundedRead(ctx.publicClient.getTransactionReceipt({ hash: e.hash }));
    if (receipt.blockNumber > BigInt(obs.blockNumber)) return;
    return receipt.status;
  } catch { return; }
}
async function terminalIntent(ctx: AgentContext, obs: AgentObservation, base: string, p: OuPending, isCurrent: () => boolean): Promise<boolean> {
  const outcome = await intentOutcome(ctx, obs, { ...p,
    action: p.action ?? { type: p.kind === "increase" ? "gmxIncrease" : "gmxDecrease", base } }, true, isCurrent);
  if (!isCurrent()) return false;
  if (outcome === "rejected" || outcome === "reverted") return true;
  if (outcome !== "success") return false;
  try {
    // A mined createOrder is terminal only once no account orders remain at the
    // observation's block. This handles cancellations and partial execution too.
    const key = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }],
      [keccak256(encodeAbiParameters([{ type: "string" }], ["ACCOUNT_ORDER_LIST"])), ctx.address]));
    const count = await boundedRead(ctx.publicClient.readContract({ address: GMX.DataStore,
      abi: [{ type: "function", name: "getBytes32Count", stateMutability: "view",
        inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] }],
      functionName: "getBytes32Count", args: [key], blockNumber: BigInt(obs.blockNumber) }));
    return count === 0n;
  } catch { return false; }
}

/** Refresh owns snapshots only: callbacks never mutate trading state or submit orders.
 * Keep completed results until a later block consumes them. Identity checks prevent
 * stale epoch/intent evidence from releasing a replacement intent.
 */
function refreshOuEvidence(obs: AgentObservation, ctx: AgentContext): void {
  const block = ouBlock(obs);
  if (ouRefresh?.results && block > ouRefresh.block) {
    if (ouRefresh.epoch === ouEpoch) for (const result of ouRefresh.results) {
      if (result.terminal && ouPending.get(result.base) === result.pending)
        ouPending.delete(result.base);
    }
    ouRefresh = undefined;
  }
  if (ouRefresh || !ouEpoch) return;
  const pending = [...ouPending].filter(([, p]) => p.sentBlock < block);
  if (!pending.length) return;
  const refresh: OuRefresh = { epoch: ouEpoch, block };
  ouRefresh = refresh;
  let finished = false;
  const isCurrent = () => !finished && ouRefresh === refresh;
  // Defer log I/O and RPC until after the current decision. The whole refresh,
  // including filesystem I/O, is bounded; timeout is unknown, never terminal.
  refresh.settled = boundedRead(new Promise<NonNullable<OuRefresh["results"]>>(resolve => {
    setImmediate(() => {
      if (!isCurrent()) { resolve([]); return; }
      resolve(Promise.all(pending.map(async ([base, intent]) => ({
        base, pending: intent, terminal: await terminalIntent(ctx, obs, base, intent, isCurrent),
      }))));
    });
  }), 1100).then(results => {
    finished = true;
    if (ouRefresh === refresh) refresh.results = results;
  }, () => {
    finished = true;
    if (ouRefresh === refresh) refresh.results = [];
  });
}

/** Observe even when there is no order budget, so anchors, risk and confirmation keep up.
 * Intents are retained before submission, durably when a store is offered.
 * A queued intent is not a runtime/chain acknowledgement; an unreflected intent blocks retries.
 */
export async function submitOu(obs: AgentObservation, ctx: AgentContext, action: ReturnedAction): Promise<void> {
  beginOuObservation(obs, ctx);
  refreshOuEvidence(obs, ctx);
  const wallet = ouBudget(obs, ctx, action);
  const block = ouBlock(obs);
  // Repeated snapshots in one block do not create fresh gas capacity.
  wallet.slots -= [...ouPending.values()].filter(p => p.sentBlock === block).length;
  const fee = ouBid(obs).toString();
  const signals: Record<string, number> = {};
  for (const base of OU_BASES) {
    signals[`ouSkipReason${base}`] = 0;
    signals[`ouAvailableEth${base}`] = Number(wallet.ethWei) / 1e18;
    signals[`ouRequiredEth${base}`] = 0;
  }
  const observations: { base: string; fair: number; anchor: number;
    position: GmxPositionObs | undefined; confirmedBlocks: number; riskStopped: boolean }[] = [];

  // Reconcile all positions before reserving outstanding collateral. Otherwise WETH could
  // reuse USDC still claimed by an unreflected WBTC increase from a previous observation.
  for (const base of OU_BASES) {
    const market = gmxMarketOf(obs, base);
    const fair = market ? ouFair(obs, base, market) : NaN;
    if (!market || !(fair > 0) || !Number.isFinite(fair) || !obs.enabledProtocols.includes("gmx")) {
      ouObserved.delete(base); ouDrift.delete(base);
      continue;
    }
    const anchor = resolveOuAnchor(base, fair);
    const confirmedBlocks = observeOuPosition(base, block, signedSizeUsd(market.position));
    const riskStopped = observeOuRisk(base, block, fair, anchor, market.position);
    observations.push({ base, fair, anchor, position: market.position, confirmedBlocks, riskStopped });
    signals[`ouAnchor${base}`] = anchor;
    signals[`ouFair${base}`] = fair;
    signals[`ouPos${base}Usd`] = signedSizeUsd(market.position);
  }
  for (const pending of ouPending.values()) {
    if (pending.kind === "increase")
      wallet.usdcFreeUnits -= unitsFromUsd(Math.abs(pending.expectSignedUsd) / PARAMS.ouLeverage, 1, 6);
    const pendingBid = pending.action ? actionBid(obs, pending.action) : ouBid(obs);
    wallet.ethWei -= GMX_EXECUTION_FEE_WEI + (ctx.config?.maxTxGas ?? 10_000_000n) * pendingBid;
  }
  saveOuState();
  signals.ouPersistenceDegraded = ouStorageFailed ? 1 : 0;
  signals.ouPersistenceMemory = ouStatePath === undefined ? 1 : 0;

  // Closing orders precede entries even when only WBTC has an open position.
  observations.sort((a, b) => Number(big(b.position?.sizeUsd) > 0n) - Number(big(a.position?.sizeUsd) > 0n));
  for (const o of observations) {
    const d = ouPlan({ ...o, pending: ouPending.get(o.base), block,
      blocksRemaining: obs.blocksRemaining ?? Infinity, ...wallet, priorityFeeWei: fee,
      persistenceFailed: ouStorageFailed,
      coldStartGrace: ouMemoryStartBlock !== undefined &&
        block - ouMemoryStartBlock < OU_COLD_START_GRACE_BLOCKS });
    signals[`ouSkipReason${o.base}`] = d.skipReason;
    signals[`ouAvailableEth${o.base}`] = Number(wallet.ethWei) / 1e18;
    signals[`ouRequiredEth${o.base}`] = Number(d.requiredEthWei) / 1e18;
    if (!d.action) continue;
    if (wallet.slots <= 0) {
      signals[`ouSkipReason${o.base}`] = 8;
      continue;
    }
    // Write ahead of the queue boundary. Even a throwing submit may have queued the
    // action; retain that intent until terminal evidence arrives.
    ouPending.set(o.base, { ...d.pending!, logOffset: intentLogOffset(ctx), action: d.action });
    if (!saveOuState() && d.action.type !== "gmxDecrease") {
      signals[`ouSkipReason${o.base}`] = 4;
      continue;
    }
    ouObserved.delete(o.base);
    wallet.slots--;
    wallet.usdcFreeUnits -= d.usdcSpent;
    wallet.ethWei -= GMX_EXECUTION_FEE_WEI + wallet.orderGasWei;
    try { ctx.submit(d.action); } catch { /* uncertain queue: retain all reservations */ }
  }
  signals.ouPersistenceDegraded = ouStorageFailed ? 1 : 0;
  // Log final decisions once per observation; diagnostics cannot suppress the base or OU.
  try { ctx.log({ round: obs.round, signals }); } catch { /* optional diagnostics */ }
}

