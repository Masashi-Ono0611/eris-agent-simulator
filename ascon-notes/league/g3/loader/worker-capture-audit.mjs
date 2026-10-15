const VERDICTS = new Set(['CONTRACT_OK_ON_SYNTHETIC', 'BLOCKED', 'FAIL']);
const PINNED_WORKER_SHA256 = '11a625f89c254766df314460cf501783753442161e2a3db2d96fad0098c7ed79';
const blocked = (reason, diagnostics = []) => ({ verdict: 'BLOCKED', g3Status: 'BLOCKED',
  liveRecorderVerified: false, reason, diagnostics });
const fail = (reason, diagnostics = []) => ({ verdict: 'FAIL', g3Status: 'BLOCKED',
  liveRecorderVerified: false, reason, diagnostics });

export function auditWorkerCapture(input) {
  if (!input || input.schema !== 1 || input.provenance !== 'SYNTHETIC' ||
      !Array.isArray(input.parentRecords) || !Array.isArray(input.workerRecords))
    return blocked('input_contract_missing');
  const p = input.parentRecords, w = input.workerRecords;
  if ([...p,...w].some(r => r === null || typeof r !== 'object' || Array.isArray(r)))
    return blocked('record_shape_invalid');
  const workerCaptureEvents = new Set(['capture_parent_ready', 'capture_worker_ready', 'parent_generation',
    'worker_submit_identity', 'capture_hook_applied', 'callback_entry', 'read_call', 'read_resolve',
    'read_reject', 'read_error', 'submit_attempt', 'result_before_post', 'error_before_post',
    'callback_finally', 'capture_gap', 'capture_summary']);
  const parentEvents = new Set(['worker_create', 'worker_post', 'worker_submit', 'worker_result', 'worker_error',
    'worker_exit', 'worker_ready', 'worker_attach', 'worker_error_event', 'decide_exit', 'parent_disposition', 'capture_parent_ready',
    'parent_generation', 'worker_submit_identity', 'capture_gap', 'capture_summary', 'probe_registered',
    'probe_complete', 'runner_seen', 'start_enter', 'start_exit', 'setSource_enter', 'setSource_exit',
    'decide_enter', 'close_enter', 'close_exit']);
  if (p.some(r => typeof r.event !== 'string' || !parentEvents.has(r.event)))
    return blocked('parent_event_unrecognized');
  if (w.some(r => typeof r.event !== 'string' || !workerCaptureEvents.has(r.event)))
    return blocked('worker_event_unrecognized');
  if (w.some(r => r.event === 'submit_attempt' && Object.hasOwn(r, 'claimedDisposition')))
    return blocked('submit_disposition_claim_unsupported');
  if ([...p, ...w].some(r => typeof r?.stockSha256 === 'string' && r.stockSha256 !== PINNED_WORKER_SHA256))
    return blocked('stock_digest_mismatch');
  if (p.some(r => r?.event === 'capture_gap') || w.some(r => r?.event === 'capture_gap'))
    return blocked('recording_gap', ['capture_gap']);
  if (p.filter(r => r?.event === 'parent_generation').length === 0)
    return blocked('parent_generation_missing');
  const creates = p.filter(r => r?.event === 'worker_create');
  const parentGenerations = p.filter(r => r?.event === 'parent_generation');
  const posts = p.filter(r => r?.event === 'worker_post');
  const callbacks = w.filter(r => r?.event === 'callback_entry');
  const parentDecisions = p.filter(r => r?.event === 'decide_exit');
  const parentJoinEvents = new Set(['worker_post', 'worker_submit', 'worker_submit_identity', 'worker_result', 'worker_error']);
  const parentJoinRows = p.filter(r => parentJoinEvents.has(r?.event));
  const workerJoinEvents = new Set(['callback_entry', 'callback_finally', 'read_call', 'read_resolve', 'read_reject',
    'read_error', 'submit_attempt', 'result_before_post', 'error_before_post']);
  const workerJoinRows = w.filter(r => workerJoinEvents.has(r?.event));
  if (parentJoinRows.some(r => !Number.isSafeInteger(r.generation) || !Number.isSafeInteger(r.workerDecisionId)))
    return blocked('parent_worker_identity_missing');
  const parentDecisionIdRows = p.filter(r => ['worker_post', 'worker_submit', 'worker_result', 'worker_error', 'decide_exit']
    .includes(r?.event));
  if (parentDecisionIdRows.some(r => !Number.isSafeInteger(r.decisionId)))
    return blocked('parent_decision_identity_missing');
  if (workerJoinRows.some(r => !Number.isSafeInteger(r.generation) || !Number.isSafeInteger(r.workerDecisionId)))
    return blocked('worker_decision_identity_missing');
  const threadKey = r => `${r.threadId ?? 'missing'}`;
  const captureParentEvents = new Set(['capture_parent_ready', 'parent_generation', 'worker_submit_identity', 'capture_gap', 'capture_summary']);
  const captureParentRows = p.filter(r => captureParentEvents.has(r?.event));
  if (!captureParentRows.length) return blocked('parent_capture_missing');
  const parentThreads = new Map();
  for (const row of captureParentRows) {
    const key = threadKey(row);
    if (!parentThreads.has(key)) parentThreads.set(key, []);
    parentThreads.get(key).push(row);
  }
  for (const [key, rows] of parentThreads) {
    if (rows.some(row => !Number.isSafeInteger(row.seq))) return blocked('parent_sequence_missing', [key]);
    rows.sort((a, b) => a.seq - b.seq);
    if (rows.some((row, i) => row.seq !== i + 1)) return blocked('parent_sequence_gap', [key]);
    const summaries = rows.filter(row => row.event === 'capture_summary');
    if (summaries.length !== 1) return blocked('parent_capture_summary_missing_or_duplicated', [key]);
    const summary = summaries[0];
    if (rows.at(-1) !== summary || summary.recordCount !== rows.length - 1)
      return blocked('parent_capture_summary_count_mismatch', [key]);
    if (summary.gap !== false) return blocked('recording_gap', [key]);
  }
  const threads = new Map();
  for (const row of w) {
    const key = threadKey(row);
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(row);
  }
  for (const [key, rows] of threads) {
    if (rows.some(row => !Number.isSafeInteger(row.seq))) return blocked('worker_sequence_missing', [key]);
    rows.sort((a, b) => a.seq - b.seq);
    if (rows.some((row, i) => row.seq !== i + 1)) return blocked('worker_sequence_gap', [key]);
    const summaries = rows.filter(row => row.event === 'capture_summary');
    if (summaries.length !== 1) return blocked('capture_summary_missing_or_duplicated', [key]);
    const summary = summaries[0];
    if (rows.at(-1) !== summary || summary.recordCount !== rows.length - 1)
      return blocked('capture_summary_count_mismatch', [key]);
    if (summary.gap !== false) return blocked('recording_gap', [key]);
  }
  if (!creates.length || !posts.length || !callbacks.length) return blocked('required_boundary_missing');
  const generations = new Set(creates.map(r => r.generation));
  if ([...generations].some(g => !Number.isSafeInteger(g))) return blocked('generation_unbound');
  const observedGenerations = new Set([...p, ...w].map(r => r?.generation).filter(Number.isSafeInteger));
  for (const generation of generations) {
    const hooks = w.filter(r => r?.event === 'capture_hook_applied' && r.generation === generation);
    if (hooks.length !== 1) return hooks.length > 1
      ? fail('worker_hook_duplicated', [String(generation)])
      : blocked('worker_hook_not_observed', [String(generation)]);
    if (hooks[0].stockSha256 !== PINNED_WORKER_SHA256) return blocked('worker_hook_digest_missing_or_mismatched', [String(generation)]);
    const callbackThreads = new Set(callbacks.filter(r => r.generation === generation).map(r => r.threadId));
    if (callbackThreads.size !== 1 || !callbackThreads.has(hooks[0].threadId))
      return blocked('worker_hook_thread_mismatch', [String(generation)]);
  }
  if (parentGenerations.length !== creates.length || parentGenerations.some(r => !generations.has(r.generation)))
    return blocked('parent_generation_create_mismatch');
  if (generations.size !== creates.length || new Set(posts.map(r => `${r.generation}/${r.workerDecisionId}`)).size !== posts.length)
    return fail('duplicate_parent_or_worker_identity');

  const decisionKey = r => `${r.generation}/${r.workerDecisionId}`;
  const postKeys = new Set(posts.map(decisionKey));
  for (const row of parentJoinRows) {
    if (row.event !== 'worker_post' && !postKeys.has(decisionKey(row)))
      return fail('parent_event_without_worker_post', [decisionKey(row), row.event]);
  }
  const callbackKeys = new Set(callbacks.map(decisionKey));
  for (const row of workerJoinRows) {
    if (row.event !== 'callback_entry' && !callbackKeys.has(decisionKey(row)))
      return fail('worker_event_without_callback', [decisionKey(row), row.event]);
  }

  const parentPairs = new Map(posts.map(r => [`${r.generation}/${r.workerDecisionId}`, r]));
  for (const callback of callbacks) {
    const key = `${callback.generation}/${callback.workerDecisionId}`;
    if (!parentPairs.has(key)) return fail('worker_callback_without_parent_post', [key]);
  }
  for (const post of posts) {
    const key = `${post.generation}/${post.workerDecisionId}`;
    const matches = callbacks.filter(c => `${c.generation}/${c.workerDecisionId}` === key);
    if (!matches.length)
      return blocked('worker_callback_missing', [key]);
    if (matches.length !== 1) return fail('worker_callback_duplicated', [key]);
    const parentDecision = p.filter(r => r?.event === 'decide_exit' && r.decisionId === post.decisionId);
    if (parentDecision.length !== 1) return blocked('parent_decision_exit_missing_or_duplicated', [key]);
    if (![parentDecision[0].seq, post.seq].every(Number.isSafeInteger))
      return blocked('parent_sequence_missing', [key]);
    if (parentDecision[0].seq <= post.seq) return fail('parent_order_contradiction', [key]);
  }
  for (const callback of callbacks) {
    const key = `${callback.generation}/${callback.workerDecisionId}`;
    const events = w.filter(r => r.threadId === callback.threadId && r.generation === callback.generation &&
      r.workerDecisionId === callback.workerDecisionId);
    const seq = events.map(r => r.seq).sort((a, b) => a - b);
    if (seq.some(n => !Number.isSafeInteger(n))) return blocked('worker_sequence_missing', [key]);
    if (seq.some((n, i) => i > 0 && n <= seq[i - 1])) return fail('worker_order_contradiction', [key]);
    const entries = events.filter(r => r.event === 'callback_entry');
    if (entries.length !== 1) return blocked('callback_entry_missing_or_duplicated', [key]);
    if (events.filter(r => r.event === 'callback_finally').length !== 1)
      return blocked('callback_finally_missing_or_duplicate', [key]);
    const terminalCount = events.filter(r => ['result_before_post', 'error_before_post'].includes(r.event)).length;
    if (terminalCount !== 1) return blocked('worker_terminal_missing_or_duplicated', [key]);
    const entrySeq = entries[0].seq;
    const terminalEvent = events.find(r => ['result_before_post', 'error_before_post'].includes(r.event));
    const finallyEvent = events.find(r => r.event === 'callback_finally');
    if (entrySeq >= terminalEvent.seq) return fail('callback_terminal_before_entry', [key]);
    const beforeTerminal = events.filter(r => ['read_call', 'read_resolve', 'read_reject', 'read_error', 'submit_attempt'].includes(r.event));
    if (beforeTerminal.some(r => r.seq <= entrySeq)) return fail('callback_entry_after_activity', [key]);
    if (beforeTerminal.some(r => r.seq >= terminalEvent.seq)) return fail('callback_activity_after_terminal', [key]);
    if (finallyEvent.seq <= terminalEvent.seq) return fail('callback_finally_before_terminal', [key]);
    const parentTerminalType = events.some(r => r.event === 'result_before_post') ? 'worker_result' : 'worker_error';
    const parentTerminal = p.filter(r => r.event === parentTerminalType && r.generation === callback.generation &&
      r.workerDecisionId === callback.workerDecisionId);
    if (parentTerminal.length !== 1) return blocked('parent_terminal_missing_or_duplicated', [key]);
    const post = parentPairs.get(key);
    if (![parentTerminal[0].seq, post.seq].every(Number.isSafeInteger))
      return blocked('parent_sequence_missing', [key]);
    if (parentTerminal[0].decisionId !== post.decisionId || parentTerminal[0].seq <= post.seq)
      return fail('parent_terminal_order_or_identity_contradiction', [key]);
    const decisionExit = p.find(r => r.event === 'decide_exit' && r.decisionId === post.decisionId);
    if (!Number.isSafeInteger(decisionExit?.seq)) return blocked('parent_sequence_missing', [key]);
    if (parentTerminal[0].seq >= decisionExit.seq)
      return fail('parent_terminal_after_decide_exit', [key]);
    const readCalls = events.filter(r => r.event === 'read_call');
    const readTerminals = events.filter(r => ['read_resolve', 'read_reject', 'read_error'].includes(r.event));
    if (new Set(readCalls.map(r => r.readId)).size !== readCalls.length)
      return fail('read_call_duplicated', [key]);
    for (const call of readCalls) {
      const terminal = readTerminals.filter(r => r.readId === call.readId);
      if (terminal.length !== 1) return blocked('read_terminal_gap_or_duplicate', [key, String(call.readId)]);
      if (terminal[0].seq < call.seq) return fail('read_order_contradiction', [key]);
    }
    for (const terminal of readTerminals) {
      if (readCalls.filter(call => call.readId === terminal.readId).length !== 1)
        return blocked('read_terminal_without_call', [key, String(terminal.readId)]);
    }
    const attempts = events.filter(r => r.event === 'submit_attempt');
    if (!Number.isSafeInteger(terminalEvent.submitCount) || terminalEvent.submitCount !== attempts.length)
      return blocked('terminal_submit_count_mismatch', [key]);
    if (attempts.some(r => typeof r.active !== 'boolean'))
      return blocked('submit_attempt_active_missing_or_invalid', [key]);
    if (attempts.some(r => r.active === false && r.seq < terminalEvent.seq))
      return fail('inactive_submit_before_terminal', [key]);
    const receipts = p.filter(r => r.event === 'worker_submit' && r.generation === callback.generation &&
      r.workerDecisionId === callback.workerDecisionId);
    if (receipts.some(r => !Number.isSafeInteger(r.seq))) return blocked('parent_submit_sequence_missing', [key]);
    if (receipts.some(r => r.seq <= post.seq || r.seq >= parentTerminal[0].seq || r.seq >= decisionExit.seq))
      return fail('parent_submit_order_contradiction', [key]);
    const expectedReceipts = attempts.filter(r => r.active === true).length;
    if (receipts.length !== expectedReceipts) return receipts.length < expectedReceipts
      ? blocked('active_submit_parent_receipt_missing', [key])
      : fail('parent_submit_without_worker_attempt', [key]);
    const attemptIdentity = attempts.filter(r => r.active === true).map(r => r);
    const receiptIdentity = p.filter(r => r.event === 'worker_submit_identity' && r.generation === callback.generation &&
      r.workerDecisionId === callback.workerDecisionId);
    if (receiptIdentity.length !== expectedReceipts) return blocked('active_submit_identity_missing_or_duplicated', [key]);
    if ([...attemptIdentity, ...receipts, ...receiptIdentity].some(r => r.actionSha256 === null))
      return blocked('submit_action_hash_unsupported', [key]);
    if (receipts.some(r => !Number.isSafeInteger(r.submitOrdinal) || typeof r.actionSha256 !== 'string') ||
        receiptIdentity.some(r => !Number.isSafeInteger(r.submitOrdinal) || typeof r.actionSha256 !== 'string'))
      return blocked('worker_submit_identity_missing', [key]);
    for (const attempt of attemptIdentity) {
      const post = parentPairs.get(key);
      if (!Number.isSafeInteger(attempt.submitOrdinal) || typeof attempt.actionSha256 !== 'string')
        return fail('submit_identity_contradiction', [key]);
      const identityKey = r => `${r.generation}/${r.workerDecisionId}/${r.actionSha256}/${r.submitOrdinal}`;
      const expectedKey = `${attempt.generation}/${attempt.workerDecisionId}/${attempt.actionSha256}/${attempt.submitOrdinal}`;
      const matchesIdentity = receiptIdentity.filter(r => identityKey(r) === expectedKey);
      const matchesReceipt = receipts.filter(r => identityKey(r) === expectedKey);
      if (matchesIdentity.length !== 1 || matchesReceipt.length !== 1)
        return fail('submit_identity_contradiction', [key]);
      if (matchesReceipt[0]?.decisionId !== post.decisionId)
        return fail('parent_submit_identity_contradiction', [key]);
    }
  }
  const expectedGenerations = input.expectedGenerations;
  const parentGenerationSet = new Set(parentGenerations.map(r => r.generation));
  if (!Array.isArray(expectedGenerations) || expectedGenerations.some(g => !Number.isSafeInteger(g)) ||
      new Set(expectedGenerations).size !== expectedGenerations.length ||
      expectedGenerations.length !== parentGenerationSet.size || expectedGenerations.some(g => !parentGenerationSet.has(g)) ||
      [...parentGenerationSet].some(g => !generations.has(g)) || observedGenerations.size !== expectedGenerations.length ||
      [...observedGenerations].some(g => !parentGenerationSet.has(g)))
    return blocked('independent_generation_expectation_missing');
  const result = { verdict: 'CONTRACT_OK_ON_SYNTHETIC', g3Status: 'BLOCKED', liveRecorderVerified: false,
    generations: generations.size, joinedDecisions: callbacks.length, diagnostics: [],
    limitations: [
      'submit_action_sha256_is_bounded_summary_not_full_serialization',
      'accessor_action_hash_is_unsupported_and_blocks',
      'worker_return_sha256_is_not_joined_to_parent_result_or_delivery',
      'native_promise_rejection_observer_suppresses_unhandled_rejection',
      'measurement_timing_and_live_equivalence_are_unproven',
    ] };
  if (!VERDICTS.has(result.verdict)) return blocked('internal_verdict_invalid');
  return result;
}
