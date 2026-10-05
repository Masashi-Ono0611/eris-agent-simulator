// Candidate A: independent, bounded buy/close lot planner. No xb selector reuse.
import type { AgentContext, AgentObservation } from "@eris/sdk";
import { BALANCER, MARKET_LEGS, UNISWAP } from "@eris/sdk/constants.js";
import { balanceOf, canFund } from "../lib/affordable.js";

export type Params = Readonly<{ ENTRY_BPS: number }>;
export const PARAMS: Params = Object.freeze({ ENTRY_BPS: 50 });
export const POLICY = Object.freeze({
  maxHold: 6, entryLag: 2, exitBuffer: 4, minUsd: 50, maxUsd: 1000,
  confirmationBlocks: 8, recoveryObservations: 3,
  lossBps: 200, lossUsd: 20, epochLossUsd: 60, holdBpsPerBlock: 1,
  gasUnits: 200_000, slippageBps: 20, minProfit: 0.05,
});
export type Action = Record<string, any>;
const W = 10n ** 18n, GAS_RESERVE = W / 20n;
const BASES = ["WETH", "WBTC"] as const;
type Base = typeof BASES[number];
const SWAPS = { uniswap: "swap", balancer: "balancerSwap", curve: "curveSwap" } as const;
type Venue = { protocol: keyof typeof SWAPS; mid: number; cost: number; depth: number };
type Market = { base: Base; fair: number; decimals: number; held: bigint; venues: Venue[] };
const positive = (n: number) => Number.isFinite(n) && n > 0;
const min = (...ns: bigint[]) => ns.reduce((a, b) => a < b ? a : b);
const units = (n: number, decimals = 6) => BigInt(Math.floor(n * 10 ** decimals));
const noop = (reason: string): Action => ({ type: "noop", reason });

// Adapted verbatim from xb-r: decoding, canFund normalization, bounded bid
// and block-pinned public route-bid adapters only.
export function funded(obs: AgentObservation, token: string, amount: bigint): boolean {
  const held = balanceOf(obs, token);
  // Preserve xb-core's WBTC dust normalization, but check the real 8-decimal amount.
  const normalized = token === "WBTC" ? { ...obs, baseBalances: {
    ...obs.baseBalances, WBTC: (held * 10n ** 10n).toString(),
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

function priorityFloor(obs: AgentObservation): bigint {
  const configured = BigInt(obs.limits.defaultPriorityFeePerGasWei);
  return min(configured > 0n ? configured : 1n, BigInt(obs.limits.maxPriorityFeePerGasWei));
}
// Same profit/gas inputs as V0: its floor-plus-10%-extra bid is a hard upper bound.
export function bidWei(obs: AgentObservation, profit: number, gas: number, competitive: boolean): bigint {
  const ethPrice = obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
  if (![profit, gas, ethPrice].every(positive)) return 0n;
  const floor = priorityFloor(obs), ceiling = BigInt(obs.limits.maxPriorityFeePerGasWei);
  if (floor <= 0n) return 0n;
  const extra = BigInt(Math.floor(0.1 * profit / ethPrice / gas * 1e18));
  const budget = min(floor + extra, ceiling);
  if (!competitive) return budget;
  const rival = BigInt(obs.competition?.maxCompetitorPriorityFeeWei ?? "0");
  if (rival < 0n) return 0n;
  const target = rival + 100_000_000n;
  const wanted = target > floor ? target : floor;
  // An unaffordable target is a rejection, never a clipped or zero-fee submission.
  return wanted <= budget ? wanted : 0n;
}
type SpotBids = ReadonlyMap<string, bigint>;
function candidateObservation(obs: AgentObservation, c: { action: Action; base: Base }, bids?: SpotBids): AgentObservation {
  if (!bids) return obs;
  let rival = 0n;
  for (const leg of c.action.type === "bundle" ? c.action.actions : [c.action]) {
    // Router/vault calls are conservatively shared across bases. Curve has a
    // separate pool per market. Count ALL calls to these execution targets,
    // including direct pool calls, liquidity changes and reverted transactions.
    const targets = leg.type === "swap" && MARKET_LEGS.uniswap[c.base]
      ? [UNISWAP.swapRouter, MARKET_LEGS.uniswap[c.base].pool]
      : leg.type === "balancerSwap" && MARKET_LEGS.balancer[c.base] ? [BALANCER.vault]
      : leg.type === "curveSwap" && MARKET_LEGS.curve[c.base] ? [MARKET_LEGS.curve[c.base].pool] : undefined;
    if (!targets) return obs; // Unknown route retains the aggregate conservative signal.
    for (const target of targets) {
      const fee = bids.get(target.toLowerCase()) ?? 0n;
      if (fee > rival) rival = fee;
    }
  }
  return { ...obs, competition: { maxBlockPriorityFeeWei: "0", lastTxIndex: null,
    recentRevertRate: 0, recentSampleSize: 0, ...obs.competition,
    maxCompetitorPriorityFeeWei: rival.toString() } };
}

// The SDK aggregate includes oracle/keeper transactions. Use one public,
// block-pinned read to measure bids at the candidate's execution targets.
// Never infer a competitor from sender identity, run metadata or a fixed fee.
async function readSpotBids(obs: AgentObservation, ctx: AgentContext): Promise<SpotBids | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const block = await Promise.race([
      ctx.publicClient.getBlock({ blockNumber: BigInt(obs.blockNumber), includeTransactions: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("bid read deadline")), 750); }),
    ]);
    if (block.number !== BigInt(obs.blockNumber)) return undefined;
    const bids = new Map<string, bigint>();
    for (const tx of block.transactions) {
      if (typeof tx === "string" || !/^0x[0-9a-f]{40}$/i.test(tx.from) ||
          (tx.to !== null && !/^0x[0-9a-f]{40}$/i.test(tx.to))) return undefined;
      const fee = tx.maxPriorityFeePerGas ?? tx.gasPrice;
      if (typeof fee !== "bigint" || fee < 0n) return undefined;
      if (tx.from.toLowerCase() === obs.agentAddress.toLowerCase() || tx.to === null) continue;
      const target = tx.to.toLowerCase();
      if (fee > (bids.get(target) ?? 0n)) bids.set(target, fee);
    }
    return bids;
  } catch {
    return undefined; // Failed/incomplete reads never turn into "no competitors".
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}



type Wallet = { USDC: bigint; WETH: bigint; WBTC: bigint; ETH: bigint };
export type Plan = {
  base: Base; entryVenue: Venue["protocol"]; exitVenue: Venue["protocol"];
  cashIn: bigint; reservedBase: bigint; reservedGas: bigint; exitGas: bigint;
  expectedQuantity: bigint; plannedNet: number; lossLimit: number;
  bidProfit: number; openedBlock: number; deadlineBlock: number; exitByBlock: number;
};
export type Lot = Plan & {
  id: number; quantity: bigint; entryGasWei: bigint; entryGasUsd: number;
  confirmedBlock: number;
};
type Pending = {
  phase: "entry" | "exit"; action: Action; before: Wallet; sentBlock: number; plan: Plan;
  match?: { wallet: Wallet; block: number };
  quiet?: { wallet: Wallet; block: number; count: number; nonce: number };
};
// Public chain evidence, never inferred from a timeout or a submit error string.
type NonceEvidence = { block: number; sentBlock: number; before: number; confirmed: number; pending: number };
type Close = { id: number; cashIn: bigint; cashOut: bigint; gasWei: bigint; netUsd: number; heldBlocks: number };
type State = {
  runId: string; lastBlock: number; initial?: Wallet; wallet?: Wallet;
  lot?: Lot; pending?: Pending; unresolved?: Pending; halt?: string; nextId: number;
  closed: number; realizedNet: number; lossSpent: number; lastClose?: Close;
  recovered?: { sentBlock: number; block: number; phase: "entry" | "exit" };
};
function wallet(obs: AgentObservation): Wallet {
  const w = { USDC: balanceOf(obs, "USDC"), WETH: balanceOf(obs, "WETH"),
    WBTC: balanceOf(obs, "WBTC"), ETH: BigInt(obs.balances.ethWei) };
  if (Object.values(w).some(v => v < 0n)) throw Error("negative wallet");
  return w;
}
function horizon(obs: AgentObservation): number {
  const values = [obs.blocksRemaining, obs.dayBlocksRemaining].filter(v => v !== undefined);
  return values.length && values.every(v => Number.isSafeInteger(v) && v! >= 0) ? Math.min(...values as number[]) : 0;
}
function ethPrice(obs: AgentObservation): number {
  return obs.fairPricesUsd?.WETH ?? obs.fairPriceUsdcPerWeth;
}
function gasUsd(obs: AgentObservation, wei: bigint): number { return Number(wei) / 1e18 * ethPrice(obs); }
function gasCeiling(obs: AgentObservation): bigint {
  const fee = BigInt(obs.limits.maxPriorityFeePerGasWei);
  return fee > 0n ? fee * BigInt(POLICY.gasUnits) : 0n;
}
function trade(base: Base, v: Venue, token: string, amount: bigint, fee: bigint): Action {
  return { type: SWAPS[v.protocol], base, tokenIn: token, amountIn: String(amount),
    slippageBps: POLICY.slippageBps, maxPriorityFeePerGasWei: String(fee) };
}
// Amount-aware conservative model, NOT an executable quote. The SDK quotes again.
function bought(usd: number, v: Venue): number {
  return usd / (v.mid * (1 + v.cost) * (1 + usd / v.depth)) * (1 - POLICY.slippageBps / 10000);
}
function sold(q: number, v: Venue, price = v.mid): number {
  return q * price * (1 - v.cost) / (1 + q * price / v.depth) * (1 - POLICY.slippageBps / 10000);
}
function routeFee(obs: AgentObservation, base: Base, v: Venue, profit: number, bids?: SpotBids): bigint {
  return bidWei(candidateObservation(obs, { base, action: { type: SWAPS[v.protocol] } }, bids), profit, POLICY.gasUnits, true);
}
function validateParams(p: Params): void {
  if (Object.keys(p).some(k => k !== "ENTRY_BPS") || !Number.isFinite(p.ENTRY_BPS) ||
      p.ENTRY_BPS < 20 || p.ENTRY_BPS > 60 || p.ENTRY_BPS % 5 !== 0)
    throw new RangeError("only ENTRY_BPS, 20 to 60 in 5bps steps");
}

// New decision logic: rank complete plans, with entry/exit depth, cost, time and
// loss envelopes. A one-lot lock reserves BOTH legs from the CURRENT wallet.
export function planEntry(obs: AgentObservation, initial: Wallet, lossSpent = 0,
  p: Params = PARAMS, bids?: SpotBids): { action: Action; plan: Plan } | undefined {
  const left = horizon(obs), block = Number(obs.blockNumber);
  if (left <= POLICY.entryLag + POLICY.maxHold + POLICY.exitBuffer) return;
  const w = wallet(obs), all = markets(obs), ceiling = gasCeiling(obs);
  if (ceiling <= 0n || w.ETH - 2n * ceiling < GAS_RESERVE) return;
  const liquid = Number(w.USDC) / 1e6 + all.reduce((sum, m) => sum + Number(m.held) / 10 ** m.decimals * m.fair, 0);
  const choices: { action: Action; plan: Plan }[] = [];
  for (const m of all) for (const entry of m.venues) {
    const edge = m.fair / (entry.mid * (1 + entry.cost)) - 1;
    if (!(edge * 10000 > p.ENTRY_BPS)) continue;
    // Upper output collateral is limited to 10% of initial inventory. Initial
    // holdings stay in the wallet; only the confirmed increment is ever sold.
    const room = Number(initial[m.base] / 10n) / 10 ** m.decimals;
    const cap = Math.min(POLICY.maxUsd, 0.08 * liquid, Number(w.USDC) / 1e6 * 0.9,
      room * entry.mid / 1.008, entry.depth * 0.005);
    for (const fraction of [1, 0.5, 0.25]) {
      const cashIn = units(cap * fraction), usd = Number(cashIn) / 1e6;
      if (usd < POLICY.minUsd || !funded(obs, "USDC", cashIn)) continue;
      const quantity = units(bought(usd, entry), m.decimals), q = Number(quantity) / 10 ** m.decimals;
      const reservedBase = BigInt(Math.ceil(usd / entry.mid * 1.008 * 10 ** m.decimals));
      if (!funded(obs, m.base, reservedBase) || reservedBase > initial[m.base] / 10n) continue;
      const lossLimit = Math.min(POLICY.lossUsd, usd * POLICY.lossBps / 10000,
        POLICY.epochLossUsd - lossSpent);
      if (!positive(lossLimit)) continue;
      for (const exit of m.venues) {
        if (q * Math.max(exit.mid, m.fair) > exit.depth * 0.005) continue;
        // Reversion to CURRENT fair is a hypothesis, never future input.
        const holdCost = usd * POLICY.holdBpsPerBlock * POLICY.maxHold / 10000;
        const gross = sold(q, exit, m.fair) - usd - holdCost;
        const fee = routeFee(obs, m.base, entry, gross, bids);
        const exitFee = routeFee(obs, m.base, exit, gross, bids);
        if (fee <= 0n || exitFee <= 0n) continue;
        const plannedNet = gross - gasUsd(obs, BigInt(POLICY.gasUnits) * fee + ceiling);
        if (plannedNet < POLICY.minProfit) continue;
        // Exit must be liquidatable NOW within the precommitted loss envelope,
        // after BOTH currently required bids. Future bids are rechecked; the
        // wallet separately reserves both ceiling gas costs, not these quotes.
        const liquidation = sold(q, exit) - usd - gasUsd(obs, BigInt(POLICY.gasUnits) * (fee + exitFee));
        if (liquidation < -lossLimit) continue;
        const action = trade(m.base, entry, "USDC", cashIn, fee);
        choices.push({ action, plan: { base: m.base, entryVenue: entry.protocol,
          exitVenue: exit.protocol, cashIn, reservedBase, reservedGas: 2n * ceiling,
          exitGas: ceiling, expectedQuantity: quantity, plannedNet, lossLimit,
          bidProfit: gross, openedBlock: block, deadlineBlock: block + POLICY.entryLag + POLICY.maxHold,
          exitByBlock: block + left - POLICY.exitBuffer } });
      }
    }
  }
  choices.sort((a, b) => b.plan.plannedNet - a.plan.plannedNet);
  return choices[0];
}

function exitLot(obs: AgentObservation, lot: Lot, initial: Wallet, bids?: SpotBids): Action {
  const block = Number(obs.blockNumber), left = horizon(obs), w = wallet(obs);
  const m = markets(obs).find(m => m.base === lot.base);
  if (!m) return noop("exit market unavailable; new entries locked");
  const q = Number(lot.quantity) / 10 ** m.decimals;
  const due = block >= lot.deadlineBlock || block >= lot.exitByBlock || left <= POLICY.exitBuffer;
  const options: { action: Action; net: number }[] = [];
  for (const v of m.venues) {
    if (q * v.mid > v.depth * 0.005) continue;
    const fee = routeFee(obs, lot.base, v, lot.bidProfit, bids);
    const costWei = BigInt(POLICY.gasUnits) * fee;
    if (fee <= 0n || costWei > lot.exitGas || w.ETH - costWei < GAS_RESERVE) continue;
    if (!funded(obs, lot.base, lot.quantity) || w[lot.base] - lot.quantity < initial[lot.base]) continue;
    const net = sold(q, v) - Number(lot.cashIn) / 1e6 - lot.entryGasUsd - gasUsd(obs, costWei);
    // No per-leg positive-edge requirement and no synthetic profit=0 bypass.
    // Only a complete profitable cycle or an explicitly budgeted timed recovery.
    if (!(net >= POLICY.minProfit || (due && net >= -lot.lossLimit))) continue;
    options.push({ action: trade(lot.base, v, lot.base, lot.quantity, fee), net });
  }
  options.sort((a, b) => b.net - a.net);
  return options[0]?.action ?? noop("no budgeted liquid exit; new entries locked");
}

const abs = (n: bigint) => n < 0n ? -n : n;
const sameWallet = (a: Wallet, b: Wallet) => Object.keys(a).every(k => a[k as keyof Wallet] === b[k as keyof Wallet]);
// One part per million plus one native token unit, NOT the output quote/minOut.
const debitMatches = (debit: bigint, amount: bigint) => debit > 0n && abs(debit - amount) <= amount / 1_000_000n + 1n;
function clearConfirmationHalt(s: State): void {
  if (s.halt === "confirmation deadline; recovery only" || s.halt === "ambiguous settlement or failed transaction") s.halt = undefined;
}

// Exact fills keep the one-observation fast path. Small debit/other-base dust
// differences require two identical wallets on consecutive blocks. A split read
// or missing gas leg waits without poisoning a later complete confirmation.
function reconcile(s: State, obs: AgentObservation, w: Wallet): void {
  const pending = s.pending ?? s.unresolved;
  if (!pending) {
    if (s.wallet && (w.USDC !== s.wallet.USDC || w.WETH !== s.wallet.WETH ||
        w.WBTC !== s.wallet.WBTC || w.ETH !== s.wallet.ETH)) s.halt = "unexplained wallet change";
    return;
  }
  const { before, action, plan } = pending, base = plan.base, other = base === "WETH" ? "WBTC" : "WETH";
  const cash = w.USDC - before.USDC, qty = w[base] - before[base], gas = before.ETH - w.ETH;
  const block = Number(obs.blockNumber);
  const debit = pending.phase === "entry" ? -cash : -qty, amount = BigInt(action.amountIn);
  const otherDust = other === "WBTC" ? 1n : 1000n;
  const confirmed = gas > 0n && abs(w[other] - before[other]) <= otherDust &&
    debitMatches(debit, amount) && (pending.phase === "entry" ? qty > 0n : cash > 0n);
  if (!confirmed) { pending.match = undefined; return; }
  const exact = debit === amount && w[other] === before[other];
  const stable = pending.match?.block === block - 1 && sameWallet(pending.match.wallet, w);
  pending.match = { wallet: { ...w }, block };
  if (!exact && !stable) return;
  clearConfirmationHalt(s);
  if (pending.phase === "entry") {
    s.lot = { ...plan, cashIn: -cash, id: s.nextId++, quantity: qty, entryGasWei: gas,
      entryGasUsd: gasUsd(obs, gas), confirmedBlock: block,
      deadlineBlock: Math.min(plan.deadlineBlock, block + POLICY.maxHold) };
    if (gas > plan.reservedGas - plan.exitGas || qty > plan.reservedBase)
      s.halt = "entry exceeded reservation; recovery only";
  } else {
    const lot = s.lot!;
    const netUsd = Number(cash - lot.cashIn) / 1e6 - lot.entryGasUsd - gasUsd(obs, gas);
    s.lastClose = { id: lot.id, cashIn: lot.cashIn, cashOut: cash, gasWei: lot.entryGasWei + gas,
      netUsd, heldBlocks: block - lot.confirmedBlock };
    s.closed++; s.realizedNet += netUsd; s.lossSpent += Math.max(0, -netUsd);
    if (netUsd < -lot.lossLimit || gas > lot.exitGas) s.halt = "realized loss or gas exceeded reservation";
    s.lot = undefined;
  }
  if (BASES.some(b => w[b] < s.initial![b])) s.halt = "initial inventory deficit; recovery only";
  s.pending = undefined; s.unresolved = undefined; s.wallet = w;
}

// Balance stability alone cannot rule out an accepted but unmined transaction.
// This uses the standard runtime's single serialized sender and the SAME node's
// pending nonce: no gaps/second sender are allowed. Missing, stale or advancing
// nonce evidence never releases funds. The runtime resets its nonce cache on a
// failed send, so an unconsumed nonce is reused, not skipped, on resumption.
function recover(s: State, obs: AgentObservation, w: Wallet, evidence?: NonceEvidence): boolean {
  const p = s.unresolved;
  if (!p) return false;
  const block = Number(obs.blockNumber), gas = p.before.ETH - w.ETH;
  const valid = evidence && evidence.block === block && evidence.sentBlock === p.sentBlock &&
    [evidence.before, evidence.confirmed, evidence.pending].every(n => Number.isSafeInteger(n) && n >= 0) &&
    evidence.pending === evidence.confirmed &&
    ((evidence.confirmed === evidence.before && gas === 0n) ||
      (evidence.confirmed === evidence.before + 1 && gas > 0n)) &&
    w.USDC === p.before.USDC && BASES.every(b => w[b] === p.before[b]);
  if (!valid) { p.quiet = undefined; return false; }
  const prior = p.quiet;
  p.quiet = { wallet: { ...w }, block, nonce: evidence.confirmed,
    count: prior?.block === block - 1 && prior.nonce === evidence.confirmed && sameWallet(prior.wallet, w)
      ? prior.count + 1 : 1 };
  if (p.quiet.count < POLICY.recoveryObservations) return false;
  // No token fill: rebuild the liquid ledger from observed balances. An exit
  // leaves the unsold lot intact; never manufacture a close or sell its anchor.
  s.wallet = { ...w }; s.pending = undefined; s.unresolved = undefined;
  s.recovered = { sentBlock: p.sentBlock, block, phase: p.phase };
  clearConfirmationHalt(s);
  const cost = gasUsd(obs, gas);
  // Failed exit gas belongs to the existing cycle and is booked on close once.
  if (s.lot) { s.lot.entryGasWei += gas; s.lot.entryGasUsd += cost; }
  else { s.realizedNet -= cost; s.lossSpent += cost; }
  if (gas > (p.phase === "entry" ? p.plan.reservedGas - p.plan.exitGas : p.plan.exitGas) ||
      s.lossSpent + (s.lot?.entryGasUsd ?? 0) >= POLICY.epochLossUsd) s.halt = "failed transaction gas or loss budget exceeded";
  return true;
}

async function readRecoveryEvidence(obs: AgentObservation, ctx: AgentContext, p: Pending): Promise<NonceEvidence | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = obs.agentAddress as `0x${string}`;
    const [before, confirmed, pending] = await Promise.race([
      Promise.all([
        ctx.publicClient.getTransactionCount({ address, blockNumber: BigInt(p.sentBlock) }),
        ctx.publicClient.getTransactionCount({ address, blockNumber: BigInt(obs.blockNumber) }),
        ctx.publicClient.getTransactionCount({ address, blockTag: "pending" }),
      ]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("nonce read deadline")), 750); }),
    ]);
    return { block: Number(obs.blockNumber), sentBlock: p.sentBlock, before, confirmed, pending };
  } catch { return undefined; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

const freshState = (runId = ""): State => ({ runId, lastBlock: -1, nextId: 1, closed: 0, realizedNet: 0, lossSpent: 0 });
export function createAgent(params: Params = PARAMS) {
  const p = Object.freeze({ ...params }); validateParams(p);
  let s = freshState();
  const inspect = () => structuredClone(s);
  const decide = (obs: AgentObservation, bids?: SpotBids, evidence?: NonceEvidence): Action => {
    try {
      const block = Number(obs.blockNumber);
      if (!Number.isSafeInteger(block) || block < 0 || !positive(ethPrice(obs))) return noop("invalid observation");
      if (s.runId !== obs.runId) s = freshState(obs.runId);
      if (block < s.lastBlock) { s.halt = "block rewind; retain reservations"; return noop(s.halt); }
      if (block === s.lastBlock) return noop("duplicate observation");
      const w = wallet(obs);
      if (!s.initial) { s.initial = { ...w }; s.wallet = { ...w }; }
      reconcile(s, obs, w);
      if (s.pending && block - s.pending.sentBlock >= POLICY.confirmationBlocks) {
        // Quarantine first. Only a complete fill or repeated public nonce and
        // balance evidence below can release it, never the clock alone.
        s.unresolved = s.pending; s.pending = undefined;
        s.halt ??= "confirmation deadline; recovery only";
      }
      const recovered = recover(s, obs, w, evidence);
      s.lastBlock = block;
      // Reconcile final-block fills before returning; no post-valuation orders.
      if (horizon(obs) <= 0) return noop("valuation boundary or unknown horizon");
      if (recovered) return noop("confirmation recovered; ledger rebuilt; retry next block");
      if (s.pending) return noop("pending confirmation; both legs reserved");
      // In particular, never resell a lot whose exit may still be in flight.
      if (s.unresolved) return noop("confirmation unresolved; recovery only; both legs reserved");
      if (s.lot) {
        const action = exitLot(obs, s.lot, s.initial, bids);
        if (action.type !== "noop") s.pending = { phase: "exit", action: { ...action }, before: w, sentBlock: block, plan: { ...s.lot } };
        return action;
      }
      if (s.halt) return noop(s.halt);
      const chosen = planEntry(obs, s.initial, s.lossSpent, p, bids);
      if (!chosen) return noop("no admissible round-trip plan");
      s.pending = { phase: "entry", action: { ...chosen.action }, before: w, sentBlock: block, plan: chosen.plan };
      return chosen.action;
    } catch { s.halt = "invalid observation; retain reservations"; return noop(s.halt); }
  };
  return { decide, inspect };
}

export function createLiveAgent(params: Params = PARAMS) {
  const core = createAgent(params);
  let lastWallet = "";
  const decide = async (obs: AgentObservation, ctx?: AgentContext): Promise<Action> => {
    const prior = core.inspect(), waiting = prior.pending ?? prior.unresolved;
    const [bids, evidence] = await Promise.all([
      ctx && obs && horizon(obs) > 0 ? readSpotBids(obs, ctx) : undefined,
      ctx && waiting && prior.runId === obs.runId && Number(obs.blockNumber) > prior.lastBlock &&
        Number(obs.blockNumber) - waiting.sentBlock >= POLICY.confirmationBlocks
        ? readRecoveryEvidence(obs, ctx, waiting) : undefined,
    ]);
    const action = core.decide(obs, bids, evidence);
    // The runtime owns agentId and runtime_start. Every action row needs an
    // integer absolute block, just like the runtime's xb-r/noop rows. Do not
    // repeat the full plan, initial wallet and before wallet on every block.
    // Logging failure cannot erase an already-created reservation.
    try {
      const round = Number(obs.blockNumber);
      if (!Number.isSafeInteger(round) || round < 0) {
        ctx?.log({ reason: "invalid block; no decision telemetry" });
      } else {
        const s = core.inspect(), pending = s.pending ?? s.unresolved;
        const observed = Object.fromEntries(Object.entries(wallet(obs)).map(([k, v]) => [k, String(v)]));
        const serialized = JSON.stringify(observed);
        ctx?.log({ round, action, state: {
          mode: s.unresolved ? "recovery_wait" : s.halt ? "recovery_only" : "normal",
          ...(s.halt ? { halt: s.halt } : {}),
          ...(pending ? { pending: { phase: pending.phase, sentBlock: pending.sentBlock, base: pending.plan.base } } : {}),
          ...(s.lot ? { lot: { id: s.lot.id, base: s.lot.base, quantity: String(s.lot.quantity), deadlineBlock: s.lot.deadlineBlock } } : {}),
          closed: s.closed, realizedNet: s.realizedNet,
          ...(s.recovered?.block === round ? { recovered: s.recovered } : {}),
          ...(serialized !== lastWallet ? { observed } : {}),
        } });
        lastWallet = serialized;
      }
    } catch { /* retained */ }
    return action;
  };
  return { decide, inspect: core.inspect };
}
export const decide = createLiveAgent(PARAMS).decide;
