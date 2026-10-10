// 要件3の人工契約。実行器・ファイル・通信を操作せず、入力を書き換えない。
// 独立期待集合も人工の明示指定であり、実観測の完全性を認定しない。
export function joinDecisions(input) {
  const issues = [], decisions = [];
  const add = (verdict, suffix) => {
    const code = `REQ3_${suffix}`;
    if (!issues.some(i => i.verdict === verdict && i.code === code)) issues.push({ verdict, code });
  };
  const fail = code => add('FAIL', code), blocked = code => add('BLOCKED', code);
  const finish = () => ({
    verdict: issues.some(i => i.verdict === 'FAIL') ? 'FAIL'
      : issues.length ? 'BLOCKED' : 'CONTRACT_OK_ON_SYNTHETIC',
    g3Status: 'BLOCKED', liveRecorderVerified: false,
    decisions: issues.length ? [] : decisions, issues,
  });
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const id = v => integer(v) && v > 0;
  const ns = v => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
  const utc = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const oneOf = values => v => values.includes(v);
  const field = (r, key, valid) => {
    if (r[key] === undefined || r[key] === null) blocked('FIELD_MISSING');
    else if (!valid(r[key])) fail('FIELD_INVALID');
  };
  const nullableId = (r, key) => {
    if (r[key] === undefined || (r.dispatched && r[key] === null)) blocked('FIELD_MISSING');
    else if (r.dispatched ? !id(r[key]) : r[key] !== null) fail('FIELD_INVALID');
  };
  const binding = r => {
    for (const key of ['decisionId', 'runnerId']) field(r, key, id);
    field(r, 'version', integer); field(r, 'dispatched', v => typeof v === 'boolean');
    if (typeof r.dispatched === 'boolean') {
      nullableId(r, 'generation'); nullableId(r, 'workerDecisionId');
    }
  };
  const outcome = r => field(r, 'outcome', oneOf(['noop', 'return', 'throw', 'not_dispatched']));
  const readCall = r => {
    field(r, 'readId', id); field(r, 'callOrdinal', id);
    field(r, 'method', oneOf(['getBalance', 'getAllowance'])); field(r, 'args', object);
    if (object(r.args)) {
      field(r.args, 'encoding', v => v === 'sha256'); field(r.args, 'sha256', hash);
    }
  };
  const readResult = r => {
    field(r, 'resolutionOrdinal', id); field(r, 'result', object);
    if (object(r.result)) {
      field(r.result, 'type', oneOf(['integer', 'exception']));
      if (r.result.type === 'integer') field(r.result, 'decimal',
        v => typeof v === 'string' && /^(0|-?[1-9][0-9]*)$/.test(v));
      if (r.result.type === 'exception') {
        field(r.result, 'name', oneOf(['Error', 'TypeError', 'RangeError']));
        field(r.result, 'messageSha256', hash);
      }
    }
  };
  const action = r => {
    field(r, 'path', oneOf(['return', 'submit'])); field(r, 'ordinal', id);
    field(r, 'payloadSha256', hash); field(r, 'timing', oneOf(['during', 'late']));
    field(r, 'disposition', oneOf(['sent', 'discarded', 'not_sent']));
  };
  if (input == null) { blocked('INPUT_MISSING'); return finish(); }
  if (!object(input)) { fail('INPUT_INVALID'); return finish(); }
  if (input.provenance !== 'SYNTHETIC') { blocked('PROVENANCE'); return finish(); }
  field(input, 'schema', v => v === 1);
  field(input, 'clockBasis', v => v === 'synthetic-single-clock');
  field(input, 'expected', object); field(input, 'records', Array.isArray);
  if (issues.length) return finish();
  const expected = input.expected;
  for (const key of ['starts', 'finishes', 'reads', 'actions']) field(expected, key, Array.isArray);
  if (issues.length) return finish();
  const validateObjects = (rows, validate) => {
    for (const r of rows) {
      if (!object(r)) fail('INPUT_INVALID');
      else validate(r);
    }
  };
  validateObjects(expected.starts, binding);
  validateObjects(expected.finishes, r => { field(r, 'decisionId', id); outcome(r); });
  validateObjects(expected.reads, r => { field(r, 'decisionId', id); readCall(r); readResult(r); });
  validateObjects(expected.actions, r => { field(r, 'decisionId', id); action(r); });
  const events = ['worker_create', 'decision_start', 'dispatch', 'worker_start', 'read_call',
    'read_resolve', 'action_attempt', 'action_delivery', 'worker_finish', 'decision_finish'];
  validateObjects(input.records, r => {
    field(r, 'event', oneOf(events)); field(r, 'seq', id); field(r, 'monoNs', ns); field(r, 'utc', utc);
    if (!events.includes(r.event)) return;
    if (r.event === 'worker_create') {
      field(r, 'runnerId', id); field(r, 'generation', id); field(r, 'version', integer);
    } else binding(r);
    if (['worker_finish', 'decision_finish'].includes(r.event)) outcome(r);
    if (['read_call', 'read_resolve'].includes(r.event)) readCall(r);
    if (r.event === 'read_resolve') readResult(r);
    if (['action_attempt', 'action_delivery'].includes(r.event)) action(r);
  });
  if (issues.length) return finish();
  if (!expected.starts.length || !input.records.length) { blocked('EMPTY'); return finish(); }
  const unique = (rows, key, code) => {
    if (new Set(rows.map(key)).size !== rows.length) fail(code);
  };
  const readKey = r => `${r.decisionId}:${r.readId}`;
  const actionKey = a => `${a.decisionId}:${a.path}:${a.ordinal}`;
  const workerKey = r => `${r.generation}:${r.workerDecisionId}`;
  const bindingKeys = ['decisionId', 'runnerId', 'generation', 'version', 'dispatched', 'workerDecisionId'];
  const same = (a, b, keys) => keys.every(k => a[k] === b[k]);
  unique(expected.starts, r => r.decisionId, 'EXPECTED_DUPLICATE');
  unique(expected.finishes, r => r.decisionId, 'EXPECTED_DUPLICATE');
  unique(expected.reads, readKey, 'EXPECTED_DUPLICATE');
  unique(expected.actions, actionKey, 'EXPECTED_DUPLICATE');
  unique(expected.starts.filter(r => r.dispatched), workerKey, 'EXPECTED_DUPLICATE');
  const starts = new Map(expected.starts.map(r => [r.decisionId, r]));
  const finishes = new Map(expected.finishes.map(r => [r.decisionId, r]));
  if (expected.starts.some(r => !finishes.has(r.decisionId))
    || expected.finishes.some(r => !starts.has(r.decisionId))) blocked('EXPECTED_GAP');
  for (const r of [...expected.reads, ...expected.actions]) {
    if (!starts.get(r.decisionId)?.dispatched) fail('EXPECTED_BINDING');
  }
  if (issues.length) return finish();
  const rows = [...input.records].sort((a, b) => a.seq - b.seq);
  unique(rows, r => r.seq, 'SEQUENCE_DUPLICATE');
  if (!rows.every((r, i) => r.seq === i + 1)) blocked('SEQUENCE_GAP');
  // この人工形式だけが単一時計を宣言する。実スレッド間の時刻順へ一般化しない。
  for (let i = 1; i < rows.length; i++) {
    if (BigInt(rows[i].monoNs) < BigInt(rows[i - 1].monoNs)) fail('TIME_ORDER');
    if (Date.parse(rows[i].utc) < Date.parse(rows[i - 1].utc)) fail('TIME_ORDER');
  }
  const creates = rows.filter(r => r.event === 'worker_create');
  unique(creates, r => r.generation, 'GENERATION_DUPLICATE');
  for (const c of creates) {
    const owners = expected.starts.filter(r => r.generation === c.generation);
    if (!owners.length) fail('GENERATION_UNEXPECTED');
    if (owners.some(r => !same(r, c, ['runnerId', 'version']))) fail('GENERATION_BINDING');
  }
  for (const r of rows.filter(r => r.event !== 'worker_create')) {
    const owner = starts.get(r.decisionId);
    if (!owner) fail('DECISION_UNEXPECTED');
    else if (!same(r, owner, bindingKeys)) fail('BINDING');
  }
  if (issues.length) return finish();
  const one = (own, event, missing) => {
    const found = own.filter(r => r.event === event);
    if (!found.length) blocked(missing);
    if (found.length > 1) fail('EVENT_DUPLICATE');
    return found[0];
  };
  const before = (a, b) => { if (a && b && a.seq >= b.seq) fail('ORDER'); };
  const stamp = r => r ? { utc: r.utc, monoNs: r.monoNs } : null;
  const safeResult = r => r.type === 'integer' ? { type: r.type, decimal: r.decimal }
    : { type: r.type, name: r.name, messageSha256: r.messageSha256 };
  for (const b of expected.starts) {
    const own = rows.filter(r => r.decisionId === b.decisionId && r.event !== 'worker_create');
    const start = one(own, 'decision_start', 'DECISION_MISSING');
    const end = one(own, 'decision_finish', 'DECISION_MISSING');
    const ending = finishes.get(b.decisionId).outcome;
    before(start, end);
    if ((end && end.outcome !== ending) || (b.dispatched === (ending === 'not_dispatched'))) fail('OUTCOME');
    let workerStart = null, workerFinish = null;
    if (b.dispatched) {
      const create = creates.find(r => r.generation === b.generation);
      if (!create) blocked('GENERATION_MISSING');
      const dispatch = one(own, 'dispatch', 'WORKER_MISSING');
      workerStart = one(own, 'worker_start', 'WORKER_MISSING');
      workerFinish = one(own, 'worker_finish', 'WORKER_MISSING');
      before(create, dispatch); before(start, dispatch); before(dispatch, workerStart);
      before(workerStart, workerFinish); before(workerFinish, end);
      if (workerFinish && workerFinish.outcome !== ending) fail('OUTCOME');
    } else if (own.some(r => !['decision_start', 'decision_finish'].includes(r.event))) fail('UNSENT_EXECUTION');
    const reads = [], actions = [];
    const expectedReads = expected.reads.filter(r => r.decisionId === b.decisionId);
    const calls = own.filter(r => r.event === 'read_call');
    const resolutions = own.filter(r => r.event === 'read_resolve');
    for (const r of [...calls, ...resolutions]) {
      if (!expectedReads.some(e => e.readId === r.readId)) fail('READ_UNEXPECTED');
    }
    for (const e of expectedReads) {
      const events = own.filter(r => r.readId === e.readId);
      const call = one(events, 'read_call', 'READ_MISSING');
      const resolved = one(events, 'read_resolve', 'READ_MISSING');
      for (const r of [call, resolved].filter(Boolean)) {
        if (!same(r, e, ['callOrdinal', 'method']) || r.args.sha256 !== e.args.sha256) fail('READ_BINDING');
      }
      if (resolved && (resolved.resolutionOrdinal !== e.resolutionOrdinal
        || JSON.stringify(safeResult(resolved.result)) !== JSON.stringify(safeResult(e.result)))) fail('READ_BINDING');
      before(workerStart, call); before(call, resolved); before(resolved, workerFinish);
      if (call && resolved) reads.push({
        readId: call.readId, callOrdinal: call.callOrdinal, resolutionOrdinal: resolved.resolutionOrdinal,
        method: call.method, args: { encoding: 'sha256', sha256: call.args.sha256 },
        result: safeResult(resolved.result), calledAt: stamp(call), resolvedAt: stamp(resolved),
      });
    }
    // 呼出順と解決順は独立に比較。片側欠測では順序を断定しない。
    if (calls.length === expectedReads.length && !calls.every((r, i) => r.callOrdinal === i + 1)) fail('READ_ORDER');
    if (resolutions.length === expectedReads.length && !resolutions.every((r, i) => r.resolutionOrdinal === i + 1)) fail('READ_ORDER');
    const expectedActions = expected.actions.filter(a => a.decisionId === b.decisionId);
    if (ending === 'return' && !expectedActions.some(a => a.path === 'return')) blocked('ACTION_EXPECTATION_MISSING');
    const attempts = own.filter(r => r.event === 'action_attempt');
    for (const r of own.filter(r => ['action_attempt', 'action_delivery'].includes(r.event))) {
      if (!expectedActions.some(e => actionKey(e) === actionKey(r))) fail('ACTION_UNEXPECTED');
    }
    for (const e of expectedActions) {
      const events = own.filter(r => actionKey(r) === actionKey(e));
      const attempted = events.filter(r => r.event === 'action_attempt');
      // 独立期待集合に存在する試行の消失は、人工契約の確定矛盾。
      if (!attempted.length) fail('ACTION_MISSING');
      if (attempted.length > 1) fail('EVENT_DUPLICATE');
      const attempt = attempted[0], delivery = one(events, 'action_delivery', 'DELIVERY_MISSING');
      for (const r of [attempt, delivery].filter(Boolean)) {
        if (!same(r, e, ['payloadSha256', 'disposition', 'timing'])) fail('ACTION_BINDING');
      }
      if ((e.timing === 'late' && (e.path !== 'submit' || e.disposition !== 'discarded'))
        || (e.path === 'return' && ending !== 'return')) fail('ACTION_STATE');
      before(workerStart, attempt); before(attempt, delivery);
      if (e.timing === 'late') { before(workerFinish, attempt); before(end, attempt); }
      else before(attempt, workerFinish);
      if (attempt && delivery) actions.push({
        path: attempt.path, ordinal: attempt.ordinal, payloadSha256: attempt.payloadSha256,
        timing: attempt.timing, disposition: delivery.disposition,
        attemptedAt: stamp(attempt), handledAt: stamp(delivery),
      });
    }
    for (const path of ['return', 'submit']) {
      const ownAttempts = attempts.filter(r => r.path === path);
      if (ownAttempts.length === expectedActions.filter(a => a.path === path).length
        && !ownAttempts.every((r, i) => r.ordinal === i + 1)) fail('ACTION_ORDER');
    }
    const identity = Object.fromEntries(bindingKeys.map(k => [k, b[k]]));
    decisions.push({ ...identity, outcome: ending, start: stamp(start), finish: stamp(end),
      workerStart: stamp(workerStart), workerFinish: stamp(workerFinish),
      reads: reads.sort((a, c) => a.callOrdinal - c.callOrdinal),
      actions: actions.sort((a, c) => attempts.findIndex(r => r.path === a.path && r.ordinal === a.ordinal)
        - attempts.findIndex(r => r.path === c.path && r.ordinal === c.ordinal)),
    });
  }
  return finish();
}
