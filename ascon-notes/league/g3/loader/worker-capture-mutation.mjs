import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const auditPath = new URL('./worker-capture-audit.mjs', import.meta.url);
const original = readFileSync(auditPath, 'utf8');
const pin = '11a625f89c254766df314460cf501783753442161e2a3db2d96fad0098c7ed79';
function input() {
  const parentRecords = [
    { event: 'worker_create', generation: 1, seq: 1, threadId: 0 },
    { event: 'worker_post', generation: 1, workerDecisionId: 7, decisionId: 3, seq: 2, threadId: 0 },
    { event: 'worker_submit', generation: 1, workerDecisionId: 7, decisionId: 3, submitOrdinal: 1,
      actionSha256: 'a'.repeat(64), seq: 3, threadId: 0 },
    { event: 'worker_result', generation: 1, workerDecisionId: 7, decisionId: 3, seq: 4, threadId: 0 },
    { event: 'decide_exit', generation: 1, decisionId: 3, seq: 5, threadId: 0 },
    { event: 'capture_parent_ready', seq: 1, threadId: 100 },
    { event: 'parent_generation', generation: 1, seq: 2, threadId: 100 },
    { event: 'worker_submit_identity', generation: 1, workerDecisionId: 7,
      submitOrdinal: 1, actionSha256: 'a'.repeat(64), seq: 3, threadId: 100 },
    { event: 'capture_summary', recordCount: 3, gap: false, seq: 4, threadId: 100 },
  ];
  const workerRecords = [
    { event: 'capture_hook_applied', generation: 1, stockSha256: pin, seq: 1, threadId: 1 },
    { event: 'callback_entry', generation: 1, workerDecisionId: 7, seq: 2, threadId: 1 },
    { event: 'read_call', generation: 1, workerDecisionId: 7, readId: 1, seq: 3, threadId: 1 },
    { event: 'read_resolve', generation: 1, workerDecisionId: 7, readId: 1, seq: 4, threadId: 1 },
    { event: 'submit_attempt', generation: 1, workerDecisionId: 7,
      submitOrdinal: 1, actionSha256: 'a'.repeat(64), active: true, seq: 5, threadId: 1 },
    { event: 'result_before_post', generation: 1, workerDecisionId: 7, submitCount: 1, seq: 6, threadId: 1 },
    { event: 'callback_finally', generation: 1, workerDecisionId: 7, seq: 7, threadId: 1 },
    { event: 'capture_summary', generation: 1, recordCount: 7, gap: false, seq: 8, threadId: 1 },
  ];
  return { schema: 1, provenance: 'SYNTHETIC', expectedGenerations: [1], parentRecords, workerRecords };
}
function reindexCapture(inputValue) {
  const rows = inputValue.parentRecords.filter(row => row.threadId === 100 && row.event !== 'capture_summary');
  inputValue.parentRecords = inputValue.parentRecords.filter(row => row.threadId !== 100);
  rows.forEach((row, i) => { row.seq = i + 1; });
  inputValue.parentRecords.push(...rows, { event: 'capture_summary', recordCount: rows.length,
    gap: false, seq: rows.length + 1, threadId: 100 });
}
function resequenceWorker(inputValue) {
  inputValue.workerRecords.forEach((row, i) => { row.seq = i + 1; });
  const summary = inputValue.workerRecords.at(-1);
  summary.recordCount = inputValue.workerRecords.length - 1;
}
const mutants = [
  { name: 'malformed record rows are rejected before dereference',
    needle: "if ([...p,...w].some(r => r === null || typeof r !== 'object' || Array.isArray(r)))\n    return blocked('record_shape_invalid');",
    replacement: "if (false) return blocked('record_shape_invalid');",make:()=>{const value=input();value.workerRecords.push(null);return value;},
    expectGoodReason:'record_shape_invalid',expectBroken:'THROWS',expectError:'TypeError' },
  { name: 'parent submit receipt must precede decision completion',
    needle: "if (receipts.some(r => r.seq <= post.seq || r.seq >= parentTerminal[0].seq || r.seq >= decisionExit.seq))\n      return fail('parent_submit_order_contradiction', [key]);",
    replacement: "if (false) return fail('parent_submit_order_contradiction', [key]);", make: () => {
      const value=input();value.parentRecords.find(r=>r.event==='worker_submit').seq=6;return value;
    } },
  { name: 'empty callback entry must precede terminal',
    needle: "if (entrySeq >= terminalEvent.seq) return fail('callback_terminal_before_entry', [key]);",
    replacement: "if (false) return fail('callback_terminal_before_entry', [key]);", make: () => {
      const value=input();
      value.workerRecords=value.workerRecords.filter(r=>!['read_call','read_resolve','submit_attempt'].includes(r.event));
      const entry=value.workerRecords.find(r=>r.event==='callback_entry');const terminal=value.workerRecords.find(r=>r.event==='result_before_post');
      value.workerRecords.splice(value.workerRecords.indexOf(entry),1);value.workerRecords.splice(value.workerRecords.indexOf(terminal)+1,0,entry);
      terminal.submitCount=0;resequenceWorker(value);
      value.parentRecords=value.parentRecords.filter(r=>!['worker_submit','worker_submit_identity'].includes(r.event));
      reindexCapture(value);return value;
    } },
  { name: 'hook is tied to the callback thread',
    needle: "if (callbackThreads.size !== 1 || !callbackThreads.has(hooks[0].threadId))",
    replacement: 'if (false)', make: () => {
      const value = input();
      const hook = value.workerRecords[0];
      const workerRows = value.workerRecords.slice(1, -1);
      workerRows.forEach((row, i) => { row.threadId = 2; row.seq = i + 1; });
      workerRows.push({ event: 'capture_summary', generation: 1, recordCount: workerRows.length,
        gap: false, seq: workerRows.length + 1, threadId: 2 });
      value.workerRecords = [hook, { event: 'capture_summary', generation: 1, recordCount: 1,
        gap: false, seq: 2, threadId: 1 }, ...workerRows];
      return value;
    } },
  { name: 'parent sequence is contiguous',
    needle: "if (rows.some((row, i) => row.seq !== i + 1)) return blocked('parent_sequence_gap', [key]);",
    replacement: 'if (false) return blocked(\'parent_sequence_gap\', [key]);', make: () => {
      const value = input(); const identity = value.parentRecords.find(row => row.event === 'worker_submit_identity');
      identity.seq = 4; value.parentRecords.find(row => row.event === 'capture_summary').seq = 5; return value;
    } },
  { name: 'parent capture summary count matches',
    needle: "if (rows.at(-1) !== summary || summary.recordCount !== rows.length - 1)\n      return blocked('parent_capture_summary_count_mismatch', [key]);",
    replacement: 'if (false) return blocked(\'parent_capture_summary_count_mismatch\', [key]);', make: () => {
      const value = input(); value.parentRecords.find(row => row.event === 'capture_summary').recordCount = 9; return value;
    } },
  { name: 'terminal submit count prevents joint deletion',
    needle: "if (!Number.isSafeInteger(terminalEvent.submitCount) || terminalEvent.submitCount !== attempts.length)",
    replacement: 'if (false)', make: () => {
      const value = input();
      value.workerRecords = value.workerRecords.filter(row => row.event !== 'submit_attempt');
      value.parentRecords = value.parentRecords.filter(row => !['worker_submit', 'worker_submit_identity'].includes(row.event));
      reindexCapture(value); resequenceWorker(value); return value;
    } },
  { name: 'submit identity hash and ordinal are required',
    needle: "receiptIdentity.some(r => !Number.isSafeInteger(r.submitOrdinal) || typeof r.actionSha256 !== 'string'))",
    replacement: 'false)', make: () => {
      const value = input(); const identity = value.parentRecords.find(row => row.event === 'worker_submit_identity');
      delete identity.actionSha256; return value;
    }, expectBroken: 'FAIL' },
  { name: 'unsupported accessor action digest blocks the synthetic join',
    needle: "if ([...attemptIdentity, ...receipts, ...receiptIdentity].some(r => r.actionSha256 === null))\n      return blocked('submit_action_hash_unsupported', [key]);",
    replacement: "if (false) return blocked('submit_action_hash_unsupported', [key]);", make: () => {
      const value = input();
      value.workerRecords.find(row => row.event === 'submit_attempt').actionSha256 = null;
      return value;
    }, expectBroken: 'FAIL' },
  { name: 'worker sequence is contiguous',
    needle: "if (rows.some((row, i) => row.seq !== i + 1)) return blocked('worker_sequence_gap', [key]);",
    replacement: 'if (false) return blocked(\'worker_sequence_gap\', [key]);', make: () => {
      const value = input();
      value.workerRecords.find(row => row.event === 'callback_finally').seq = 9;
      value.workerRecords.at(-1).seq = 10;
      return value;
    } },
  { name: 'worker summary count matches',
    needle: "if (rows.at(-1) !== summary || summary.recordCount !== rows.length - 1)\n      return blocked('capture_summary_count_mismatch', [key]);",
    replacement: 'if (false) return blocked(\'capture_summary_count_mismatch\', [key]);', make: () => {
      const value = input(); value.workerRecords.at(-1).recordCount = 99; return value;
    } },
  { name: 'worker summary gap is rejected',
    needle: "if (rows.at(-1) !== summary || summary.recordCount !== rows.length - 1)\n      return blocked('capture_summary_count_mismatch', [key]);\n    if (summary.gap !== false) return blocked('recording_gap', [key]);",
    replacement: "if (rows.at(-1) !== summary || summary.recordCount !== rows.length - 1)\n      return blocked('capture_summary_count_mismatch', [key]);\n    if (false) return blocked('recording_gap', [key]);", make: () => {
      const value = input(); value.workerRecords.at(-1).gap = true; return value;
    } },
  { name: 'worker hook digest is pinned',
    needle: "if (hooks[0].stockSha256 !== PINNED_WORKER_SHA256) return blocked('worker_hook_digest_missing_or_mismatched', [String(generation)]);",
    replacement: 'if (false) return blocked(\'worker_hook_digest_missing_or_mismatched\', [String(generation)]);', make: () => {
      const value = input(); delete value.workerRecords[0].stockSha256; return value;
    } },
  { name: 'callback entry precedes all activity',
    needle: "if (beforeTerminal.some(r => r.seq <= entrySeq)) return fail('callback_entry_after_activity', [key]);",
    replacement: 'if (false) return fail(\'callback_entry_after_activity\', [key]);', make: () => {
      const value = input(); const entry = value.workerRecords.find(row => row.event === 'callback_entry');
      const call = value.workerRecords.find(row => row.event === 'read_call');
      [entry.seq, call.seq] = [call.seq, entry.seq];
      value.workerRecords.sort((a, b) => a.seq - b.seq); resequenceWorker(value); return value;
    } },
  { name: 'activity precedes callback terminal',
    needle: "if (beforeTerminal.some(r => r.seq >= terminalEvent.seq)) return fail('callback_activity_after_terminal', [key]);",
    replacement: 'if (false) return fail(\'callback_activity_after_terminal\', [key]);', make: () => {
      const value = input(); const terminal = value.workerRecords.find(row => row.event === 'result_before_post');
      const attempt = value.workerRecords.find(row => row.event === 'submit_attempt');
      [terminal.seq, attempt.seq] = [attempt.seq, terminal.seq];
      value.workerRecords.sort((a, b) => a.seq - b.seq); resequenceWorker(value); return value;
    } },
  { name: 'callback terminal precedes finally',
    needle: "if (finallyEvent.seq <= terminalEvent.seq) return fail('callback_finally_before_terminal', [key]);",
    replacement: 'if (false) return fail(\'callback_finally_before_terminal\', [key]);', make: () => {
      const value = input(); const terminal = value.workerRecords.find(row => row.event === 'result_before_post');
      const final = value.workerRecords.find(row => row.event === 'callback_finally');
      [terminal.seq, final.seq] = [final.seq, terminal.seq];
      value.workerRecords.sort((a, b) => a.seq - b.seq); resequenceWorker(value); return value;
    } },
  { name: 'one read terminal per read call',
    needle: "if (terminal.length !== 1) return blocked('read_terminal_gap_or_duplicate', [key, String(call.readId)]);",
    replacement: 'if (false) return blocked(\'read_terminal_gap_or_duplicate\', [key, String(call.readId)]);', make: () => {
      const value = input(); const terminal = value.workerRecords.find(row => row.event === 'read_resolve');
      value.workerRecords.splice(value.workerRecords.indexOf(terminal) + 1, 0, { ...terminal });
      resequenceWorker(value); return value;
    } },
  { name: 'parent submit receipts match active attempt count',
    needle: "if (receipts.length !== expectedReceipts) return receipts.length < expectedReceipts\n      ? blocked('active_submit_parent_receipt_missing', [key])\n      : fail('parent_submit_without_worker_attempt', [key]);",
    replacement: 'if (false) return blocked(\'active_submit_parent_receipt_missing\', [key]);', make: () => {
      const value = input(); value.parentRecords.push({ event: 'worker_submit', generation: 1,
        workerDecisionId: 7, decisionId: 3, submitOrdinal: 2, actionSha256: 'b'.repeat(64), seq: 3, threadId: 0 });
      return value;
    } },
  { name: 'unrecorded disposition claims are unsupported',
    needle: "if (w.some(r => r.event === 'submit_attempt' && Object.hasOwn(r, 'claimedDisposition')))\n    return blocked('submit_disposition_claim_unsupported');",
    replacement: 'if (false) return blocked(\'submit_disposition_claim_unsupported\');', make: () => {
      const value = input(); value.workerRecords.find(row => row.event === 'submit_attempt').claimedDisposition = 'discarded';
      return value;
    } },
  { name: 'submit attempt active flag must be boolean',
    needle: "if (attempts.some(r => typeof r.active !== 'boolean'))\n      return blocked('submit_attempt_active_missing_or_invalid', [key]);",
    replacement: 'if (false) return blocked(\'submit_attempt_active_missing_or_invalid\', [key]);', make: () => {
      const value = input();
      delete value.workerRecords.find(row => row.event === 'submit_attempt').active;
      value.parentRecords = value.parentRecords.filter(row => !['worker_submit', 'worker_submit_identity'].includes(row.event));
      reindexCapture(value); return value;
    } },
  { name: 'inactive submit before terminal fails',
    needle: "if (attempts.some(r => r.active === false && r.seq < terminalEvent.seq))\n      return fail('inactive_submit_before_terminal', [key]);",
    replacement: 'if (false) return fail(\'inactive_submit_before_terminal\', [key]);', make: () => {
      const value = input(); const attempt = value.workerRecords.find(row => row.event === 'submit_attempt');
      attempt.active = false;
      value.parentRecords = value.parentRecords.filter(row => !['worker_submit', 'worker_submit_identity'].includes(row.event));
      reindexCapture(value); return value;
    } },
  { name: 'late submit after finally fails',
    needle: "if (beforeTerminal.some(r => r.seq >= terminalEvent.seq)) return fail('callback_activity_after_terminal', [key]);",
    replacement: 'if (false) return fail(\'callback_activity_after_terminal\', [key]);', make: () => {
      const value = input();
      value.workerRecords.splice(value.workerRecords.length - 1, 0, { event: 'submit_attempt', generation: 1,
        workerDecisionId: 7, decisionId: 3, submitOrdinal: 2, actionSha256: 'b'.repeat(64), active: false,
        seq: 8, threadId: 1 });
      value.workerRecords.at(-1).seq = 9;
      value.workerRecords.at(-1).recordCount = 8;
      value.workerRecords.find(row => row.event === 'result_before_post').submitCount = 1;
      return value;
    }, expectBroken: 'BLOCKED' },
  { name: 'raw probe receipt requires identity fields',
    needle: "if (receipts.some(r => !Number.isSafeInteger(r.submitOrdinal) || typeof r.actionSha256 !== 'string') ||\n        receiptIdentity.some(r => !Number.isSafeInteger(r.submitOrdinal) || typeof r.actionSha256 !== 'string'))",
    replacement: "if (false || receiptIdentity.some(r => !Number.isSafeInteger(r.submitOrdinal) || typeof r.actionSha256 !== 'string'))",
    make: () => { const value = input(); delete value.parentRecords.find(row => row.event === 'worker_submit').actionSha256; return value; },
    expectBroken: 'FAIL' },
  { name: 'submit receipt and attempt use a one-to-one identity match',
    needle: "if (matchesIdentity.length !== 1 || matchesReceipt.length !== 1)\n        return fail('submit_identity_contradiction', [key]);",
    replacement: 'if (false) return fail(\'submit_identity_contradiction\', [key]);', make: () => {
      const value = input();
      const attempt = value.workerRecords.find(row => row.event === 'submit_attempt');
      attempt.submitOrdinal = 2;
      const raw = value.parentRecords.find(row => row.event === 'worker_submit');
      raw.submitOrdinal = 2;
      const identity = value.parentRecords.find(row => row.event === 'worker_submit_identity');
      identity.submitOrdinal = 1;
      return value;
    }, expectGoodReason: 'submit_identity_contradiction' },
  { name: 'expected generations match independent parent generation records',
    needle: "if (!Array.isArray(expectedGenerations) || expectedGenerations.some(g => !Number.isSafeInteger(g)) ||\n      new Set(expectedGenerations).size !== expectedGenerations.length ||\n      expectedGenerations.length !== parentGenerationSet.size || expectedGenerations.some(g => !parentGenerationSet.has(g)) ||\n      [...parentGenerationSet].some(g => !generations.has(g)) || observedGenerations.size !== expectedGenerations.length ||\n      [...observedGenerations].some(g => !parentGenerationSet.has(g)))\n    return blocked('independent_generation_expectation_missing');",
    replacement: 'if (false) return blocked(\'independent_generation_expectation_missing\');', make: () => {
      const value = input();
      value.parentRecords.push({ event: 'parent_disposition', generation: 2, disposition: 'discarded' });
      return value;
    } },
];

let killed = 0;
for (let i = 0; i < mutants.length; i++) {
  const mutant = mutants[i];
  const occurrences = original.split(mutant.needle).length - 1;
  assert.equal(occurrences, 1, `${mutant.name}: mutation needle must occur exactly once, got ${occurrences}`);
  const source = original.replace(mutant.needle, mutant.replacement);
  const path = join(tmpdir(), `worker-capture-mutant-${process.pid}-${i}.mjs`);
  const evidence = mutant.make();
  try {
    writeFileSync(path, source);
    const module = await import(`${pathToFileURL(path).href}?${Date.now()}-${i}`);
    const good = (await import(auditPath.href)).auditWorkerCapture(evidence);
    let broken;
    try { broken=module.auditWorkerCapture(evidence); }
    catch(error) { if (!mutant.expectError || error?.name!==mutant.expectError) throw error; broken={verdict:'THROWS'}; }
    assert.notEqual(good.verdict, 'CONTRACT_OK_ON_SYNTHETIC', `${mutant.name} has no control`);
    if (mutant.expectGoodReason) assert.equal(good.reason,mutant.expectGoodReason,`${mutant.name} must reach the intended guard`);
    assert.equal(broken.verdict, mutant.expectBroken ?? 'CONTRACT_OK_ON_SYNTHETIC',
      `${mutant.name} mutant remains guarded: ${JSON.stringify(broken)}`);
    killed++;
    process.stdout.write(`MUTATION_KILLED ${mutant.name}\n`);
  } finally { rmSync(path, { force: true }); }
}
assert.equal(killed, mutants.length);
process.stdout.write(`MUTATION_SUMMARY killed=${killed}/${mutants.length}\n`);
