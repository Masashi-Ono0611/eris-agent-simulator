// 人工契約のみ。期待集合はイベント列から集計せず、別に明示する。
export const digest = 'a'.repeat(64);
const args = () => ({ encoding: 'sha256', sha256: digest });
const binding = (decisionId, generation, version, dispatched = true) => ({
  decisionId, runnerId: 1, generation, version, dispatched,
  workerDecisionId: dispatched ? 1 : null,
});
export function resequence(input) {
  input.records.forEach((r, i) => {
    r.seq = i + 1;
    r.monoNs = String((i + 1) * 10000);
    r.utc = new Date(Date.UTC(2026, 9, 11) + i * 10).toISOString();
  });
  return input;
}

export function syntheticDecisionJoin() {
  const starts = [binding(1, 1, 0), binding(2, 2, 1), binding(3, null, 1, false),
    binding(4, 3, 2), binding(5, 4, 3)];
  const finishes = [
    { decisionId: 1, outcome: 'noop' }, { decisionId: 2, outcome: 'return' },
    { decisionId: 3, outcome: 'not_dispatched' }, { decisionId: 4, outcome: 'throw' },
    { decisionId: 5, outcome: 'noop' },
  ];
  const reads = [
    { decisionId: 2, readId: 1, callOrdinal: 1, resolutionOrdinal: 2,
      method: 'getBalance', args: args(), result: { type: 'integer', decimal: '900719925474099312345' } },
    { decisionId: 2, readId: 2, callOrdinal: 2, resolutionOrdinal: 1,
      method: 'getAllowance', args: args(), result: { type: 'exception', name: 'Error', messageSha256: digest } },
  ];
  const actions = [
    { decisionId: 2, path: 'submit', ordinal: 1, payloadSha256: digest, disposition: 'sent', timing: 'during' },
    { decisionId: 2, path: 'submit', ordinal: 2, payloadSha256: digest, disposition: 'not_sent', timing: 'during' },
    { decisionId: 2, path: 'return', ordinal: 1, payloadSha256: digest, disposition: 'sent', timing: 'during' },
    { decisionId: 5, path: 'submit', ordinal: 1, payloadSha256: digest, disposition: 'discarded', timing: 'late' },
  ];
  const records = [];
  const add = (event, fields) => records.push({ event, ...structuredClone(fields) });
  for (const b of starts) {
    if (b.dispatched) add('worker_create', { runnerId: b.runnerId, generation: b.generation, version: b.version });
    add('decision_start', b);
    const ownReads = reads.filter(r => r.decisionId === b.decisionId);
    const ownActions = actions.filter(a => a.decisionId === b.decisionId);
    if (b.dispatched) {
      add('dispatch', b); add('worker_start', b);
      for (const r of ownReads) add('read_call', { ...b, ...r });
      for (const r of [...ownReads].sort((a, c) => a.resolutionOrdinal - c.resolutionOrdinal)) {
        add('read_resolve', { ...b, ...r });
      }
      for (const a of ownActions.filter(a => a.timing === 'during')) {
        add('action_attempt', { ...b, ...a }); add('action_delivery', { ...b, ...a });
      }
      add('worker_finish', { ...b, outcome: finishes.find(f => f.decisionId === b.decisionId).outcome });
    }
    add('decision_finish', { ...b, outcome: finishes.find(f => f.decisionId === b.decisionId).outcome });
    for (const a of ownActions.filter(a => a.timing === 'late')) {
      add('action_attempt', { ...b, ...a }); add('action_delivery', { ...b, ...a });
    }
  }
  return resequence({ schema: 1, provenance: 'SYNTHETIC', clockBasis: 'synthetic-single-clock',
    expected: { starts, finishes, reads, actions }, records });
}
