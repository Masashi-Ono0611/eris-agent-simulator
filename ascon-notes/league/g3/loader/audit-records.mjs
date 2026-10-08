import { probeError } from './probe-io.mjs';

// Offline completeness check for THIS prototype, not the G3 gate/auditor contract.
export function auditRecords(records) {
  const check = (condition, code) => { if (!condition) throw probeError(code); };
  const ordered = [...records].sort((a, b) => a.seq - b.seq);
  check(ordered.length > 0 && ordered.every((r, i) => r.seq === i + 1), 'G3_SEQUENCE_GAP');
  check(ordered.filter(r => r.event === 'probe_registered').length === 1, 'G3_REGISTRATION_COUNT');
  check(!ordered.some(r => r.event === 'guard'), 'G3_GUARD_RECORDED');
  const complete = ordered.filter(r => r.event === 'probe_complete');
  check(complete.length === 1 && ordered.at(-1) === complete[0], 'G3_INCOMPLETE');
  const creates = ordered.filter(r => r.event === 'worker_create');
  check(creates.length === complete[0].generations, 'G3_GENERATION_COUNT');
  check(new Set(creates.map(r => r.generation)).size === creates.length, 'G3_DUPLICATE_GENERATION');
  for (const create of creates) {
    const own = ordered.filter(r => r.generation === create.generation);
    const attach = own.filter(r => r.event === 'worker_attach');
    check(attach.length === 1 && attach[0].threadId !== 0, 'G3_WORKER_GAP');
    check(own.filter(r => r.event === 'worker_exit').length === 1, 'G3_WORKER_EXIT_GAP');
    for (const post of own.filter(r => r.event === 'worker_post')) {
      check(Number.isSafeInteger(post.decisionId), 'G3_DECISION_UNBOUND');
      check(post.version === create.version && post.sourceSha256 === create.sourceSha256, 'G3_SOURCE_BINDING');
      const terminals = own.filter(r => ['worker_result', 'worker_error'].includes(r.event)
        && r.workerDecisionId === post.workerDecisionId && r.decisionId === post.decisionId);
      check(terminals.length === 1, 'G3_TERMINAL_GAP');
    }
  }
  for (const record of ordered.filter(r => r.event.startsWith('worker_'))) {
    check(creates.some(r => r.generation === record.generation), 'G3_UNKNOWN_GENERATION');
  }
  const enters = ordered.filter(r => /^(start|decide|close|setSource)_enter$/.test(r.event));
  check(enters.length === complete[0].calls, 'G3_CALL_COUNT');
  for (const enter of enters) {
    const exits = ordered.filter(r => r.callId === enter.callId && r.event === enter.event.replace('_enter', '_exit'));
    check(exits.length === 1 && exits[0].seq > enter.seq, 'G3_CALL_GAP');
  }
  check(ordered.filter(r => r.event === 'decide_enter').length === complete[0].decisions, 'G3_DECISION_COUNT');
  return { generations: creates.length, decisions: complete[0].decisions, records: ordered.length };
}
