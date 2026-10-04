// H1 data boundary. Never compile/evaluate executorTs. Trusted caller owns observations/tickets.
import type { AgentObservation } from '@eris/sdk';
import { PARAMS, type Params } from './v5.js';

export const POLICY_IDS = ['v5', 'v5-r11', 'v5-r7-strict'] as const;
export type PolicyId = typeof POLICY_IDS[number];
export type Selection = Readonly<{ policyId: PolicyId; ENTRY_BPS: number }>;
const BASELINE: Selection = Object.freeze({ policyId: 'v5', ENTRY_BPS: 50 });
export const REVISION_INTERVAL = 60;
export const PROPOSAL_TTL = 60;
export const POLICY_TTL = 120;

export function validSelection(value: unknown): value is Selection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return Object.keys(o).sort().join(',') === 'ENTRY_BPS,policyId'
    && POLICY_IDS.includes(o.policyId as PolicyId)
    && typeof o.ENTRY_BPS === 'number' && Number.isInteger(o.ENTRY_BPS)
    && o.ENTRY_BPS >= 20 && o.ENTRY_BPS <= 60 && o.ENTRY_BPS % 5 === 0;
}

export function policyParams(selection: Selection): Params {
  if (!validSelection(selection)) throw new Error('invalid H1 selection');
  return Object.freeze({ ...PARAMS, ENTRY_BPS: selection.ENTRY_BPS,
    R11_SMALL_SINGLE_CAP: selection.policyId === 'v5-r11',
    R7_SINGLE_ENTRY: selection.policyId !== 'v5-r7-strict',
    SINGLE_EDGE_BPS: selection.policyId === 'v5-r7-strict' ? 75 : PARAMS.SINGLE_EDGE_BPS,
  });
}

export function literalTemplate(selection: Selection): string {
  if (!validSelection(selection)) throw new Error('invalid H1 selection');
  return `return {"policyId":"${selection.policyId}","ENTRY_BPS":${selection.ENTRY_BPS}};`;
}

type Parsed = { kind: 'selection'; selection: Selection; notes: string }
  | { kind: 'declined'; notes: string } | { kind: 'rejected'; reason: string };
export function parsePolicyReply(raw: string): Parsed {
  try {
    if (typeof raw !== 'string' || raw.length > 8192) throw new Error('reply size/type');
    const o = JSON.parse(raw);
    if (!o || Array.isArray(o) || Object.keys(o).sort().join(',') !== 'executorTs,notes'
      || typeof o.notes !== 'string' || !o.notes.trim() || o.notes.length > 1000)
      throw new Error('expected exactly notes and executorTs');
    if (o.executorTs === null) return { kind: 'declined', notes: o.notes };
    if (typeof o.executorTs !== 'string') throw new Error('executorTs type');
    const match = /^return \{"policyId":"(v5|v5-r11|v5-r7-strict)","ENTRY_BPS":(\d+)\};$/.exec(o.executorTs);
    if (!match) throw new Error('executorTs is not the fixed literal template');
    const selection = { policyId: match[1] as PolicyId, ENTRY_BPS: Number(match[2]) };
    if (!validSelection(selection) || literalTemplate(selection) !== o.executorTs)
      throw new Error('invalid policy or ENTRY range/step');
    return { kind: 'selection', selection: Object.freeze(selection), notes: o.notes };
  } catch (error) {
    return { kind: 'rejected', reason: error instanceof Error ? error.message : 'invalid reply' };
  }
}

export type Ticket = Readonly<{ runId: string; observedAtBlock: number; generation: number }>;
type Outcome = { kind: 'installed'; appliedAtBlock: number; selection: Selection }
  | { kind: 'declined' | 'ignored' | 'rejected'; reason: string };

// State stays outside replaceable/generated source; caller must never call setSource.
// Reset only policy on expiry/rejection. The engine's v5 execution state is independent.
export function createPolicyGate(frozen = false) {
  let current: Selection = BASELINE;
  let runId = '', latest = -1, remaining = Infinity, generation = 0;
  let lastRequest = -1, appliedAt: number | null = null;
  let pending: Ticket | null = null;
  const baseline = () => { current = BASELINE; appliedAt = null; };
  function observe(obs: AgentObservation): void {
    const block = Number(obs.blockNumber);
    const horizons = [obs.blocksRemaining, obs.dayBlocksRemaining].filter((n): n is number =>
      n !== undefined && Number.isFinite(n));
    const left = horizons.length ? Math.min(...horizons) : 0;
    if (!Number.isSafeInteger(block) || block < 0) return;
    if (runId !== obs.runId || block < latest || left > remaining + 5) {
      baseline(); pending = null; generation++; lastRequest = block;
    }
    runId = obs.runId; latest = block; remaining = left;
    if (frozen || (appliedAt !== null && block - appliedAt >= POLICY_TTL)) baseline();
  }
  return {
    observe,
    snapshot: () => Object.freeze({ ...current, appliedAtBlock: appliedAt }),
    params: () => policyParams(current),
    request(): Ticket | null {
      if (frozen || latest < 0 || remaining <= 0 || latest - lastRequest < REVISION_INTERVAL) return null;
      if (pending && latest - pending.observedAtBlock <= PROPOSAL_TTL) return null;
      lastRequest = latest;
      pending = Object.freeze({ runId, observedAtBlock: latest, generation });
      return pending;
    },
    accept(ticket: Ticket, raw: string): Outcome {
      if (frozen) return { kind: 'ignored', reason: 'frozen' };
      if (pending !== ticket || ticket.generation !== generation || ticket.runId !== runId)
        return { kind: 'ignored', reason: 'unknown, consumed, or previous-epoch ticket' };
      pending = null;
      if (latest - ticket.observedAtBlock > PROPOSAL_TTL || remaining <= 0)
        return { kind: 'ignored', reason: 'stale proposal or epoch ended' };
      const parsed = parsePolicyReply(raw);
      if (parsed.kind === 'declined') return { kind: 'declined', reason: parsed.notes };
      if (parsed.kind === 'rejected') {
        baseline(); return { kind: 'rejected', reason: parsed.reason };
      }
      if (Math.abs(parsed.selection.ENTRY_BPS - current.ENTRY_BPS) > 5) {
        baseline(); return { kind: 'rejected', reason: 'ENTRY change exceeds 5 bps' };
      }
      current = parsed.selection; appliedAt = latest;
      return { kind: 'installed', appliedAtBlock: latest, selection: current };
    },
  };
}
