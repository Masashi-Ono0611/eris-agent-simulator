import { auditRecords } from './audit-records.mjs';

// 既存 probe の記録形式に対する人工データ専用の結合契約。
// ファイル・通信・実行器を操作せず、入力を変更しない。
export function joinSourceApplications(input) {
  const issues = [], applications = [];
  const add = (verdict, code) => {
    if (!issues.some(i => i.verdict === verdict && i.code === code)) issues.push({ verdict, code });
  };
  const finish = () => ({
    verdict: issues.some(i => i.verdict === 'FAIL') ? 'FAIL'
      : issues.length ? 'BLOCKED' : 'CONTRACT_OK_ON_SYNTHETIC',
    g3Status: 'BLOCKED', liveRecorderVerified: false,
    firstDecisionBasis: 'parent-worker_post', applications, issues,
  });
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (input == null) { add('BLOCKED', 'REQ2_INPUT_MISSING'); return finish(); }
  if (!object(input) || input.schema !== 1 || !Array.isArray(input.records)) {
    add('FAIL', 'REQ2_INPUT_INVALID'); return finish();
  }
  if (input.provenance !== 'SYNTHETIC') add('BLOCKED', 'REQ2_PROVENANCE');
  if (!input.records.length) { add('BLOCKED', 'REQ2_EMPTY'); return finish(); }
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const id = value => integer(value) && value > 0;
  const ns = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
  const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const field = (r, name, valid) => {
    if (r[name] === undefined || r[name] === null) add('BLOCKED', 'REQ2_FIELD_MISSING');
    else if (!valid(r[name])) add('FAIL', 'REQ2_FIELD_INVALID');
  };
  const hasSource = r => r.event === 'runner_seen' || /^(setSource|start|decide|close)_(enter|exit)$/.test(r.event)
    || (r.event.startsWith('worker_') && r.event !== 'worker_attach');
  const sourceKeys = ['kind', 'sourceSha256', 'version', 'versionOrigin', 'hashScope'];
  const sameSource = (a, b) => sourceKeys.every(key => a[key] === b[key]);
  const rows = [...input.records];
  for (const r of rows) {
    if (!object(r)) { add('FAIL', 'REQ2_INPUT_INVALID'); continue; }
    field(r, 'schema', v => v === 1);
    field(r, 'seq', id); field(r, 'threadId', integer);
    field(r, 'event', v => typeof v === 'string' && v.length > 0);
    field(r, 'monoNs', ns); field(r, 'utc', utc);
    if (typeof r.event !== 'string') continue;
    if (r.event !== 'worker_attach' && r.threadId !== 0) add('FAIL', 'REQ2_THREAD_INVALID');
    if (hasSource(r)) {
      field(r, 'runnerId', id); field(r, 'kind', v => ['executor', 'module'].includes(v));
      field(r, 'sourceSha256', v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v));
      field(r, 'version', integer); field(r, 'versionOrigin', v => typeof v === 'string');
      field(r, 'hashScope', v => ['entry-bytes-only', 'executor-body'].includes(v));
      if (r.versionOrigin !== undefined && r.versionOrigin !== 'fixture-explicit') add('BLOCKED', 'REQ2_VERSION_ORIGIN');
      if (r.kind && r.hashScope && r.hashScope !== (r.kind === 'module' ? 'entry-bytes-only' : 'executor-body')) {
        add('FAIL', 'REQ2_SOURCE_MISMATCH');
      }
    }
    if (/^(setSource|start|decide|close)_(enter|exit)$/.test(r.event)) field(r, 'callId', id);
    if (/^(setSource|start|decide|close)_exit$/.test(r.event)) field(r, 'outcome', v => ['return', 'throw'].includes(v));
    if (r.event.startsWith('worker_')) field(r, 'generation', id);
    if (/^decide_/.test(r.event) || ['worker_post', 'worker_result', 'worker_submit', 'worker_error'].includes(r.event)) {
      field(r, 'decisionId', id);
    }
    if (['worker_post', 'worker_result', 'worker_submit', 'worker_error'].includes(r.event)) field(r, 'workerDecisionId', id);
    if (r.event === 'setSource_exit') {
      for (const key of ['beforeNs', 'afterNs']) field(r, key, ns);
      for (const key of ['beforeUtc', 'afterUtc']) field(r, key, utc);
    }
  }
  if (issues.length) return finish();
  rows.sort((a, b) => a.seq - b.seq);
  if (new Set(rows.map(r => r.seq)).size !== rows.length) add('FAIL', 'REQ2_SEQUENCE_DUPLICATE');
  if (!rows.every((r, i) => r.seq === i + 1)) add('BLOCKED', 'REQ2_SEQUENCE_GAP');
  // 共有連番はスレッド間の時計順を保証しない。親側のみで比較する。
  const parent = rows.filter(r => r.threadId === 0);
  for (let i = 1; i < parent.length; i++) {
    if (BigInt(parent[i].monoNs) < BigInt(parent[i - 1].monoNs)) add('FAIL', 'REQ2_TIME_ORDER');
  }
  const enters = new Map(), exits = new Map(), decisions = new Map();
  for (const r of rows) {
    if (/^(setSource|start|decide|close)_enter$/.test(r.event)) {
      if (enters.has(r.callId)) add('FAIL', 'REQ2_CALL_DUPLICATE');
      enters.set(r.callId, r);
      if (r.event === 'decide_enter') {
        if (decisions.has(r.decisionId)) add('FAIL', 'REQ2_DECISION_DUPLICATE');
        decisions.set(r.decisionId, r);
      }
    }
    if (/^(setSource|start|decide|close)_exit$/.test(r.event)) {
      if (exits.has(r.callId)) add('FAIL', 'REQ2_CALL_DUPLICATE');
      exits.set(r.callId, r);
    }
  }
  for (const [callId, exit] of exits) {
    const enter = enters.get(callId);
    if (!enter || enter.event.replace('_enter', '_exit') !== exit.event) {
      add('FAIL', 'REQ2_ORPHAN_EXIT'); continue;
    }
    if (enter.runnerId !== exit.runnerId) add('FAIL', 'REQ2_RUNNER_MISMATCH');
    if (!sameSource(enter, exit)) add('FAIL', 'REQ2_SOURCE_MISMATCH');
    if (enter.decisionId !== exit.decisionId) add('FAIL', 'REQ2_DECISION_BINDING');
    if (enter.seq >= exit.seq) add('FAIL', 'REQ2_TIME_ORDER');
    if (exit.event === 'setSource_exit' && (BigInt(enter.monoNs) > BigInt(exit.beforeNs)
      || BigInt(exit.beforeNs) > BigInt(exit.afterNs) || BigInt(exit.afterNs) > BigInt(exit.monoNs)
      || Date.parse(enter.utc) > Date.parse(exit.beforeUtc) || Date.parse(exit.beforeUtc) > Date.parse(exit.afterUtc)
      || Date.parse(exit.afterUtc) > Date.parse(exit.utc))) add('FAIL', 'REQ2_TIME_ORDER');
  }
  for (const key of enters.keys()) if (!exits.has(key)) add('BLOCKED', 'REQ2_CALL_GAP');
  if (issues.length) return finish();

  const runners = new Map(), generations = new Map(), posts = new Map();
  for (const r of rows) {
    if (r.event === 'runner_seen') {
      if (runners.has(r.runnerId)) add('FAIL', 'REQ2_RUNNER_DUPLICATE');
      runners.set(r.runnerId, { selection: r, history: [r], application: null });
    }
    if (r.event === 'setSource_exit') {
      const state = runners.get(r.runnerId);
      if (!state) { add('BLOCKED', 'REQ2_RUNNER_MISSING'); continue; }
      const app = {
        runnerId: r.runnerId, setSourceCallId: r.callId, outcome: r.outcome,
        kind: r.kind, sourceSha256: r.sourceSha256, version: r.version,
        versionOrigin: r.versionOrigin, hashScope: r.hashScope,
        setSourceInterval: { beforeUtc: r.beforeUtc, afterUtc: r.afterUtc, beforeNs: r.beforeNs, afterNs: r.afterNs },
        firstDecisionId: null, firstWorkerDecisionId: null, generation: null,
        workerExecutionVerified: false, verdict: 'CONTRACT_OK_ON_SYNTHETIC',
      };
      applications.push(app);
      if (r.outcome === 'return') {
        // 同版再選択には source オブジェクト識別子が必要。hash で補わない。
        if (state.history.some(s => s.version === r.version)) {
          app.verdict = 'BLOCKED'; add('BLOCKED', 'REQ2_SELECTION_AMBIGUOUS');
        }
        state.history.push(r); state.selection = r; state.application = app;
      }
    }
    if (r.event === 'worker_create') {
      const state = runners.get(r.runnerId);
      if (!state) { add('BLOCKED', 'REQ2_RUNNER_MISSING'); continue; }
      if (generations.has(r.generation)) add('FAIL', 'REQ2_GENERATION_DUPLICATE');
      if (!sameSource(r, state.selection)) add('FAIL', 'REQ2_SOURCE_MISMATCH');
      generations.set(r.generation, { create: r, application: state.application, exited: false });
    }
    if (r.event.startsWith('worker_') && !['worker_attach', 'worker_create'].includes(r.event)) {
      const gen = generations.get(r.generation);
      if (!gen) { add('BLOCKED', 'REQ2_GENERATION_MISSING'); continue; }
      if (gen.create.runnerId !== r.runnerId) add('FAIL', 'REQ2_RUNNER_MISMATCH');
      if (!sameSource(r, gen.create)) add('FAIL', 'REQ2_SOURCE_MISMATCH');
      if (gen.exited) add('FAIL', 'REQ2_GENERATION_CLOSED');
      if (r.event === 'worker_exit') gen.exited = true;
      if (r.event === 'worker_post') {
        const decision = decisions.get(r.decisionId);
        const exit = decision && exits.get(decision.callId);
        if (!decision || decision.runnerId !== r.runnerId || decision.seq >= r.seq || exit.seq <= r.seq) {
          add('FAIL', 'REQ2_DECISION_BINDING');
        }
        const key = `${r.generation}:${r.workerDecisionId}`;
        if (posts.has(key) || [...posts.values()].some(p => p.decisionId === r.decisionId)) add('FAIL', 'REQ2_POST_DUPLICATE');
        posts.set(key, r);
        const app = gen.application;
        if (app && app.firstDecisionId === null && app.verdict !== 'BLOCKED') {
          app.firstDecisionId = r.decisionId; app.firstWorkerDecisionId = r.workerDecisionId; app.generation = r.generation;
        }
      }
      if (['worker_result', 'worker_error', 'worker_submit'].includes(r.event)) {
        const post = posts.get(`${r.generation}:${r.workerDecisionId}`);
        if (!post || post.decisionId !== r.decisionId) add('FAIL', 'REQ2_DECISION_BINDING');
      }
    }
  }
  for (const app of applications) {
    if (app.outcome === 'return' && app.firstDecisionId === null) {
      app.verdict = 'BLOCKED'; add('BLOCKED', 'REQ2_FIRST_DISPATCH_MISSING');
    }
  }
  if (!applications.length) add('BLOCKED', 'REQ2_SELECTION_MISSING');
  // 既存の世代登録・終端・件数検査も再利用し、不完全な記録を閉じない。
  try { auditRecords(rows); }
  catch (error) {
    const missing = new Set(['G3_INCOMPLETE', 'G3_WORKER_GAP', 'G3_WORKER_EXIT_GAP',
      'G3_TERMINAL_GAP', 'G3_CALL_GAP', 'G3_SEQUENCE_GAP']);
    add(missing.has(error.code) ? 'BLOCKED' : 'FAIL', error.code ?? 'REQ2_AUDIT_INVALID');
  }
  if (issues.some(i => i.verdict === 'BLOCKED')) {
    for (const app of applications) app.verdict = 'BLOCKED';
  }
  if (issues.some(i => i.verdict === 'FAIL')) for (const app of applications) app.verdict = 'FAIL';
  return finish();
}
