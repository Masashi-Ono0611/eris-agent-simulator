// M-OU ported from opus-1g. Pure sizing/signals plus bounded per-epoch state.
// The r3k dispatcher is never changed by OU: all orders use submitOu's ctx.submit boundary.
import type { AgentAction, AgentObservation, AgentContext } from "@eris/sdk";
import { readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { PARAMS as DELTA_PARAMS } from "./delta.js";

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
  /** An observed position this close to what the pending order should leave counts as reflected. */
  ouReflectTolUsd: 500,
  /** No new orders once this few blocks remain (the position is valued as it stands at the bell). */
  ouStopBlocks: 5,
  /** Native ETH that must remain after an increase; decreases need only the execution fee. */
  ouEthReserveWei: 50_000_000_000_000_000n, // 0.05 ETH
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
  // Without disk this can only mitigate the measured fill delay. An obs-only module cannot
  // guarantee one in-flight order across replacement workers or reconstruct a lost live anchor.
  if (!dir) return;
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
  const runBlocks = ctx.config?.runBlocks;
  const hasRunBudget = Number.isFinite(runBlocks) && runBlocks > 0 &&
    Number.isFinite(obs.blocksRemaining);
  const startBlock = hasRunBudget ? block + obs.blocksRemaining! - runBlocks
    : ouEpoch?.runId === obs.runId ? ouEpoch.startBlock : block;
  const key = obs.epoch
    ? `epoch:${obs.epoch.index}/${obs.epoch.count}` : `start:${startBlock}`;
  // A repeated observation is not a new block. Any other non-unit step starts a fresh record.
  const discontinuity = ouEpoch && block !== ouEpoch.lastBlock && block !== ouEpoch.lastBlock + 1;
  if (!ouEpoch || ouEpoch.key !== key || ouEpoch.runId !== obs.runId || discontinuity) {
    ouAnchors.clear();
    ouPending.clear();
    ouDrift.clear();
    ouStopped.clear();
    ouObserved.clear();
    const origin = discontinuity && !hasRunBudget ? block : startBlock;
    ouEpoch = { key: obs.epoch ? key : `start:${origin}`, runId: obs.runId,
      startBlock: origin, lastBlock: block };
  }
  ouEpoch.lastBlock = block;
}

function saveOuState(): void {
  if (!ouStatePath || !ouEpoch) return;
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
  } catch {
    ouStorageFailed = true;
    ouStatePath = undefined; // fail soft for this worker, retaining in-memory protection
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
  /** Original observed balance, before r3k and other OU reservations. */
  usdcBalanceUnits?: bigint;
  ethWei: bigint;
  priorityFeeWei: string;
  confirmedBlocks: number;
  riskStopped?: boolean;
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
    } else {
      out.pending = pending;
      out.note = `waiting for ${pending.kind} sent at ${pending.sentBlock}`;
      return out;
    }
  }
  out.pending = undefined;

  // 2. The bell: what is held is valued as it stands; a new order might not even execute in time.
  if (args.blocksRemaining <= PARAMS.ouStopBlocks) {
    out.note ||= "end of epoch: no new orders";
    return out;
  }

  const want = ouSignal(g);
  const held = signedUsd > 0 ? 1 : signedUsd < 0 ? -1 : 0;
  if (!args.riskStopped && (want === 0 || want === held)) {
    out.note ||= want === 0 ? "inside the band: hold" : "positioned";
    return out;
  }
  if (args.ethWei < GMX_EXECUTION_FEE_WEI + (held === 0 ? PARAMS.ouEthReserveWei : 0n)) {
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
  if (args.riskStopped || args.confirmedBlocks < PARAMS.ouConfirmBlocks) {
    out.note = args.riskStopped ? "risk exit: entries disabled" : "waiting for stable position";
    return out;
  }
  // Flat: open the signalled side at the notional the free USDC can carry.
  const reserve = ouUsdcReserve(args.usdcBalanceUnits ?? args.usdcFreeUnits);
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

type ReturnedAction = AgentAction | Record<string, unknown> | null;

// Measured order creation, not the keeper's later execution transaction.
const OU_ORDER_GAS = 865_000n;
const withGasMargin = (gas: bigint) => (gas * 120n + 99n) / 100n;
// send.ts reserves estimated limits, not receipts: default 30% or 50k headroom.
// Apply the strategy's 20% margin on top of these projected limits.
const senderGas = (gas: bigint) => {
  const buffered = (gas * 130n + 99n) / 100n;
  return buffered > gas + 50_000n ? buffered : gas + 50_000n;
};

/** r3k currently has no submits. Bundles consume a transaction per leg. Unknown/raw
 * actions get no shared budget: their USDC use cannot be inferred safely from the shape.
 * botMain.ts sends submissions BEFORE the returned action. Reserve realistic swap/order
 * costs with the sender's buffer, then add 20% to the combined reservation. obs.limits has
 * no gas estimates in this SDK; delta's gasPerSwap supplies the swap estimate. Liquity
 * operations without a cost estimate retain the conservative per-tx reservation.
 * No RPC estimates or edits to r3k's action. Sender rejection remains authoritative
 * (e.g. a dependent estimate can fall back to 2M, or an adapter can add an approval).
 */
export function ouBudget(obs: AgentObservation, ctx: AgentContext, action: ReturnedAction): {
  slots: number; usdcFreeUnits: bigint; usdcBalanceUnits: bigint; ethWei: bigint;
} {
  const balance = big(obs.balances?.usdcUnits);
  const perTx = ctx.config?.maxTxGas ?? 10_000_000n;
  const perBlock = ctx.config?.maxAgentBlockGas ?? 10_000_000n;
  let spend = 0n, reservedGas = 0n, opaque = false;
  function count(a: ReturnedAction): void {
    if (!a || a.type === "noop") return;
    if (a.type === "bundle") {
      for (const leg of (a as { actions: ReturnedAction[] }).actions) count(leg);
      return;
    }
    const isSwap = ["swap", "curveSwap", "balancerSwap"].includes(String(a.type));
    const estimate = isSwap ? BigInt(DELTA_PARAMS.gasPerSwap) : perTx;
    const reservation = isSwap ? senderGas(estimate) : perTx;
    reservedGas += reservation;
    if (reservation > perTx) opaque = true;
    // These are the only non-raw shapes produced by the copied r3k dispatcher.
    if (["swap", "curveSwap", "balancerSwap", "liquitySwapEusd"].includes(String(a.type))) {
      const trade = a as { tokenIn?: string; amountIn?: string };
      if (trade.tokenIn === "USDC") spend += big(trade.amountIn);
    } else if (!["liquityLiquidate", "liquityWithdrawFromSP", "liquityProvideToSP", "liquityRedeem"].includes(String(a.type))) {
      opaque = true;
    }
  }
  count(action);
  let slots = 0;
  if (!opaque && senderGas(OU_ORDER_GAS) <= perTx) {
    for (let orders = 1; orders <= OU_BASES.length; orders++) {
      const count = BigInt(orders);
      if (perBlock > 0n && withGasMargin(reservedGas + count * senderGas(OU_ORDER_GAS)) > perBlock) break;
      slots = orders;
    }
  }
  return {
    slots,
    usdcFreeUnits: balance > spend ? balance - spend : 0n,
    usdcBalanceUnits: balance,
    ethWei: big(obs.balances?.ethWei),
  };
}

/** Observe even when there is no order budget, so anchors, risk and confirmation keep up.
 * An intent becomes pending only after submit returns. No callback after that can erase it.
 * A queued intent is not a runtime/chain acknowledgement; an unreflected intent blocks retries.
 */
export function submitOu(obs: AgentObservation, ctx: AgentContext, action: ReturnedAction): void {
  beginOuObservation(obs, ctx);
  const wallet = ouBudget(obs, ctx, action);
  const block = ouBlock(obs);
  // Repeated snapshots in one block do not create fresh gas capacity.
  wallet.slots -= [...ouPending.values()].filter(p => p.sentBlock === block).length;
  const fee = (big(obs.limits?.defaultPriorityFeePerGasWei) || 1n).toString();
  const signals: Record<string, number> = {};
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
    const pending = ouPending.get(base);
    if (pending) {
      const tol = Math.max(PARAMS.ouReflectTolUsd, Math.abs(pending.expectSignedUsd) * 0.02);
      if (Math.abs(signedSizeUsd(market.position) - pending.expectSignedUsd) <= tol &&
          (pending.kind === "increase" || confirmedBlocks >= PARAMS.ouConfirmBlocks))
        ouPending.delete(base);
    }
    observations.push({ base, fair, anchor, position: market.position, confirmedBlocks, riskStopped });
    signals[`ouAnchor${base}`] = anchor;
    signals[`ouFair${base}`] = fair;
    signals[`ouPos${base}Usd`] = signedSizeUsd(market.position);
  }
  for (const pending of ouPending.values()) {
    if (pending.kind === "increase")
      wallet.usdcFreeUnits -= unitsFromUsd(Math.abs(pending.expectSignedUsd) / PARAMS.ouLeverage, 1, 6);
    wallet.ethWei -= GMX_EXECUTION_FEE_WEI;
  }
  saveOuState();
  signals.ouPersistenceDegraded = ouStorageFailed ? 1 : 0;
  // Isolate diagnostics as well as OU itself; logging failure must not suppress r3k or orders.
  try { ctx.log({ round: obs.round, signals }); } catch { /* optional diagnostics */ }

  for (const o of observations) {
    const d = ouPlan({ ...o, pending: ouPending.get(o.base), block,
      blocksRemaining: obs.blocksRemaining ?? Infinity, ...wallet, priorityFeeWei: fee });
    if (!d.action || wallet.slots <= 0) continue;
    try { ctx.submit(d.action); } catch { continue; }
    // Immediately preserve each successful queue operation, including a partial two-base send.
    ouPending.set(o.base, d.pending!);
    ouObserved.delete(o.base);
    wallet.slots--;
    wallet.usdcFreeUnits -= d.usdcSpent;
    wallet.ethWei -= GMX_EXECUTION_FEE_WEI;
    saveOuState();
  }
}

