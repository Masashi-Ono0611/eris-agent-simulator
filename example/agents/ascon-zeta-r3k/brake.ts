// r3k K2: own-outcome brake for two-leg bundles.
//
// A bundle is two separate transactions, so in a contested field one leg can fill while the other
// reverts or is never mined, leaving inventory on one side. This module keeps the outcome of our
// last K2_WINDOW settled bundles and, when too many ended one-sided, pauses small-edge bundles for
// K2_PAUSE_BLOCKS blocks. The switch (K2_BUNDLE_BRAKE) and the use of k2Braked() live in delta.ts.
//
// Settlement is read in the background and never awaited by decide(): each observation starts (at
// most one) scan of the blocks mined since the last scan, finds our own transactions in them, matches
// each to a pending leg by its amountIn calldata word (the swap adapters put amountIn into calldata
// unchanged; approvals are standing ones made at wallet setup), and reads that transaction's receipt.
// decide() reads only the in-memory result. A leg not seen within K2_SETTLE_AFTER_BLOCKS scanned
// blocks did not fill. A bundle whose blocks could not be read for K2_DROP_AFTER_BLOCKS is dropped
// uncounted, so a failing RPC can only switch the brake off, never on.
import type { AgentContext, AgentObservation } from "@eris/sdk";

export const K2_WINDOW = 20; // settled own bundles kept
export const K2_MIN_SETTLED = 8; // the brake needs at least this many settled bundles in the window
export const K2_ONE_SIDED_PCT = 40; // ... and at least this share of them one-sided (exactly one leg filled)
export const K2_PAUSE_BLOCKS = 36; // blocks paused after a trigger; bundles resume after them
export const K2_BRAKE_BELOW_NET_EDGE_BPS = 100; // only bundles below this net edge (delta.ts netEdge) are braked
export const K2_SETTLE_AFTER_BLOCKS = 5; // a leg not mined in the 5 blocks after its decision did not fill
export const K2_DROP_AFTER_BLOCKS = 20; // unread for this long: dropped, not counted
const K2_MAX_BLOCKS_PER_SCAN = 8;

type Leg = { word: string; claimed: boolean; filled?: boolean };
type Pending = { block: number; legs: Leg[] };
type State = {
  lastBlock?: number;
  pending: Pending[];
  window: boolean[]; // true = one-sided
  brakeAt?: number; // block at which the brake triggered
  scannedThrough?: number;
  scan?: Promise<void>;
};
type Reader = AgentContext["publicClient"];

let s: State = { pending: [], window: [] };

/** Reset everything: called on an epoch start (block discontinuity) and by tests. */
export function k2Reset(): void { s = { pending: [], window: [] }; }

/** True while small-edge bundles are paused: the K2_PAUSE_BLOCKS blocks after the trigger block. */
export function k2Braked(block: number): boolean {
  return s.brakeAt !== undefined && block > s.brakeAt && block <= s.brakeAt + K2_PAUSE_BLOCKS;
}

/** Remember a bundle returned at `block`, so its legs can be settled later. Synchronous. */
export function k2RecordBundle(block: number, action: unknown): void {
  try {
    const a = action as { type?: string; actions?: { amountIn?: string }[] } | null;
    if (!Number.isSafeInteger(block) || a?.type !== "bundle" || !Array.isArray(a.actions) || a.actions.length !== 2) return;
    const amounts = a.actions.map(leg => BigInt(leg.amountIn ?? "0"));
    if (amounts.some(amount => amount <= 0n)) return; // a zero word would match almost any calldata
    const legs = amounts.map(amount => ({ word: amount.toString(16).padStart(64, "0"), claimed: false }));
    if (s.pending.length === 0) s.scannedThrough = block;
    s.pending.push({ block, legs });
  } catch { /* an unreadable action is simply not tracked */ }
}

/** Called once per observation, before the decision. Starts a background scan; never awaits it. */
export function k2Observe(obs: AgentObservation, ctx: AgentContext | undefined): void {
  try {
    const block = Number(obs.blockNumber);
    if (!Number.isSafeInteger(block)) return;
    if (s.lastBlock !== undefined && (block < s.lastBlock || block > s.lastBlock + 1)) k2Reset();
    s.lastBlock = block;
    s.pending = s.pending.filter(p => block - p.block <= K2_DROP_AFTER_BLOCKS);
    if (s.pending.length === 0) { s.scannedThrough = undefined; return; }
    const client = ctx?.publicClient;
    const me = String(obs.agentAddress ?? ctx?.address ?? "").toLowerCase();
    if (s.scan || !client || !me) return;
    const state = s;
    state.scan = scan(state, client, me, block)
      .catch(() => { /* retried from the same block at the next observation */ })
      .finally(() => { state.scan = undefined; });
  } catch { /* the brake must never affect a decision through an exception */ }
}

/** Test/diagnostic view: resolves when no scan is running. */
export async function k2Idle(): Promise<void> { while (s.scan) await s.scan; }
export function k2Snapshot(): { pending: number; window: boolean[]; brakeAt?: number; scannedThrough?: number; scanning: boolean } {
  return { pending: s.pending.length, window: [...s.window], brakeAt: s.brakeAt, scannedThrough: s.scannedThrough, scanning: !!s.scan };
}

function findLeg(state: State, block: number, input: string): Leg | undefined {
  for (const p of state.pending) {
    if (block <= p.block || block > p.block + K2_SETTLE_AFTER_BLOCKS) continue;
    for (const leg of p.legs) if (!leg.claimed && input.includes(leg.word)) return leg;
  }
  return undefined;
}

async function scan(state: State, client: Reader, me: string, to: number): Promise<void> {
  const from = (state.scannedThrough ?? to) + 1;
  const last = Math.min(to, from + K2_MAX_BLOCKS_PER_SCAN - 1);
  for (let b = from; b <= last; b++) {
    const block = await client.getBlock({ blockNumber: BigInt(b), includeTransactions: true });
    if (s !== state) return; // a new epoch started while reading
    const reads: Promise<void>[] = [];
    for (const tx of block.transactions) {
      if (typeof tx === "string" || String(tx.from).toLowerCase() !== me) continue;
      const leg = findLeg(state, b, String(tx.input ?? "").toLowerCase());
      if (!leg) continue;
      leg.claimed = true;
      reads.push(client.getTransactionReceipt({ hash: tx.hash }).then(
        r => { leg.filled = r.status === "success"; },
        error => { leg.claimed = false; throw error; },
      ));
    }
    await Promise.all(reads);
    if (s !== state) return;
    state.scannedThrough = b;
    settle(state);
  }
}

function settle(state: State): void {
  for (const p of [...state.pending]) {
    const read = p.legs.every(l => !l.claimed || l.filled !== undefined);
    const done = p.legs.every(l => l.filled !== undefined);
    const expired = state.scannedThrough !== undefined && state.scannedThrough >= p.block + K2_SETTLE_AFTER_BLOCKS;
    if (!read || (!done && !expired)) continue;
    state.pending.splice(state.pending.indexOf(p), 1);
    state.window.push(p.legs.filter(l => l.filled === true).length === 1);
    if (state.window.length > K2_WINDOW) state.window.shift();
    const oneSided = state.window.filter(Boolean).length;
    if (state.window.length >= K2_MIN_SETTLED && oneSided * 100 >= K2_ONE_SIDED_PCT * state.window.length) {
      state.brakeAt = state.lastBlock ?? p.block;
      // A fresh window after each trigger, so bundles resume when the pause ends instead of the
      // same outcomes re-triggering it; a new trigger needs K2_MIN_SETTLED new settlements.
      state.window = [];
    }
  }
}
