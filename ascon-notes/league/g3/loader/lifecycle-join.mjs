// 要件5の人工契約。実時計・子プロセス・状態ファイル・実行器を操作せず、入力を書き換えない。
// 人工時計の300秒は実300秒の検証ではない。人工時間倍率を実時間の測定として扱わない。
export const INFERENCE_TIMEOUT_MS = 300000;
export const INFERENCE_TIMEOUT_UPPER_MS = 301000;
export const DECISION_BUDGET_MS = 5000;
const NS_PER_MS = 1000000n;

export function joinLifecycle(input) {
  const issues = [], calls = [], carryOver = [];
  let restore = null;
  const add = (verdict, suffix) => {
    const code = `REQ5_${suffix}`;
    if (!issues.some(i => i.verdict === verdict && i.code === code)) issues.push({ verdict, code });
  };
  const fail = code => add('FAIL', code), blocked = code => add('BLOCKED', code);
  const finish = () => {
    const ok = !issues.length;
    return {
      verdict: issues.some(i => i.verdict === 'FAIL') ? 'FAIL' : ok ? 'CONTRACT_OK_ON_SYNTHETIC' : 'BLOCKED',
      g3Status: 'BLOCKED', liveRecorderVerified: false, timeBasis: 'synthetic-clock-not-real-time',
      calls: ok ? calls : [], carryOver: ok ? carryOver : [], restore: ok ? restore : null, issues,
    };
  };
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const id = v => Number.isSafeInteger(v) && v > 0;
  const ns = v => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
  const hash = v => typeof v === 'string' && /^sha256:[0-9a-f]{64}$/.test(v);
  const label = v => typeof v === 'string' && v.length > 0;
  const oneOf = values => v => values.includes(v);
  const present = (r, key) => r[key] !== undefined && r[key] !== null;
  const field = (r, key, valid) => {
    if (!present(r, key)) blocked('FIELD_MISSING');
    else if (!valid(r[key])) fail('FIELD_INVALID');
  };
  // 欠測を個別の BLOCKED で扱う欄は、値がある場合だけ形式を検査する。
  const optional = (r, key, valid) => { if (present(r, key) && !valid(r[key])) fail('FIELD_INVALID'); };
  const array = (r, key, validate) => {
    field(r, key, Array.isArray);
    if (!Array.isArray(r[key])) return;
    for (const item of r[key]) {
      if (!object(item)) fail('INPUT_INVALID');
      else validate(item);
    }
  };

  if (input == null) { blocked('INPUT_MISSING'); return finish(); }
  if (!object(input)) { fail('INPUT_INVALID'); return finish(); }
  if (input.provenance !== 'SYNTHETIC') { blocked('PROVENANCE'); return finish(); }
  field(input, 'schema', v => v === 1); field(input, 'worldId', label); field(input, 'worldEndNs', ns);
  field(input, 'limits', object);
  if (object(input.limits)) {
    field(input.limits, 'inferenceTimeoutMs', Number.isSafeInteger);
    field(input.limits, 'decisionBudgetMs', Number.isSafeInteger);
  }
  field(input, 'clock', object);
  if (object(input.clock)) {
    field(input.clock, 'kind', label); field(input.clock, 'scale', id);
    field(input.clock, 'realTimeMeasured', v => typeof v === 'boolean');
  }
  array(input, 'calls', c => {
    field(c, 'callId', id); field(c, 'decisionId', id); field(c, 'childId', id);
    field(c, 'outcome', oneOf(['timed_out', 'completed']));
    for (const key of ['startedNs', 'childStartedNs', 'deadlineNs']) field(c, key, ns);
    if (c.outcome === 'timed_out') {
      field(c, 'timedOutNs', ns); field(c, 'lateDueNs', ns); optional(c, 'killRequestedNs', ns);
    } else if (c.outcome === 'completed') field(c, 'completedNs', ns);
  });
  array(input, 'exits', e => {
    field(e, 'callId', id); field(e, 'childId', id); field(e, 'kind', oneOf(['exit', 'close'])); field(e, 'atNs', ns);
  });
  array(input, 'lateWindows', w => { field(w, 'callId', id); field(w, 'fromNs', ns); field(w, 'toNs', ns); });
  array(input, 'sourceEvents', e => {
    field(e, 'callId', id); field(e, 'atNs', ns); field(e, 'action', oneOf(['reject', 'select', 'apply', 'submit']));
  });
  array(input, 'saves', s => {
    field(s, 'epoch', id); field(s, 'requestedNs', ns); optional(s, 'completedNs', ns);
    field(s, 'stateHash', hash); optional(s, 'writtenHash', hash);
  });
  array(input, 'reloads', r => {
    field(r, 'epoch', id); field(r, 'fromEpoch', id); field(r, 'atNs', ns); field(r, 'loadedHash', hash);
  });
  field(input, 'restore', object);
  if (object(input.restore)) {
    const r = input.restore;
    field(r, 'atNs', ns); field(r, 'originalSourceHash', hash); field(r, 'restoredSourceHash', hash);
    field(r, 'managedVersion', id); field(r, 'generation', id);
    if (present(r, 'firstDecision')) {
      if (!object(r.firstDecision)) fail('FIELD_INVALID');
      else {
        const d = r.firstDecision;
        field(d, 'decisionId', id); field(d, 'atNs', ns); field(d, 'generation', id); field(d, 'sourceHash', hash);
      }
    }
  }
  if (issues.length) return finish();
  if (!input.calls.length) { blocked('EMPTY'); return finish(); }

  // 推論呼出しの300000ミリ秒と判断の5000ミリ秒は別の契約。取り違えを FAIL にする。
  const { inferenceTimeoutMs, decisionBudgetMs } = input.limits;
  if (inferenceTimeoutMs === DECISION_BUDGET_MS || decisionBudgetMs === INFERENCE_TIMEOUT_MS) fail('LIMIT_CONFUSED');
  else if (inferenceTimeoutMs !== INFERENCE_TIMEOUT_MS || decisionBudgetMs !== DECISION_BUDGET_MS) fail('LIMIT_INVALID');
  // 人工時間倍率による記録を実時間の測定として受け付けない。
  if (input.clock.kind !== 'synthetic' || input.clock.realTimeMeasured !== false) fail('TIME_SCALE_AS_REAL');
  const scale = BigInt(input.clock.scale);
  const elapsed = (from, to) => (BigInt(to) - BigInt(from)) * scale;
  const before = (a, b) => BigInt(a) < BigInt(b);
  const limitNs = BigInt(INFERENCE_TIMEOUT_MS) * NS_PER_MS, upperNs = BigInt(INFERENCE_TIMEOUT_UPPER_MS) * NS_PER_MS;
  const budgetNs = BigInt(DECISION_BUDGET_MS) * NS_PER_MS;
  const worldEnd = input.worldEndNs;

  const byCall = new Map();
  for (const c of input.calls) {
    if (byCall.has(c.callId)) fail('CALL_DUPLICATE');
    byCall.set(c.callId, c);
  }
  const exits = new Map();
  for (const e of input.exits) {
    const c = byCall.get(e.callId);
    if (!c) { fail('CHILD_EXIT_UNJOINED'); continue; }
    if (exits.has(e.callId)) fail('CHILD_EXIT_DUPLICATE');
    exits.set(e.callId, e);
  }
  const windows = new Map();
  for (const w of input.lateWindows) {
    if (windows.has(w.callId)) blocked('LATE_WINDOW_DUPLICATE');
    windows.set(w.callId, w);
  }
  const events = new Map();
  for (const e of input.sourceEvents) {
    if (!byCall.has(e.callId)) { blocked('SOURCE_EVENT_UNJOINED'); continue; }
    events.set(e.callId, [...(events.get(e.callId) ?? []), e]);
  }

  const results = [];
  for (const c of input.calls) {
    if (before(c.childStartedNs, c.startedNs)) fail('ORDER_INVALID');
    const deadline = elapsed(c.startedNs, c.deadlineNs);
    if (deadline === budgetNs) fail('LIMIT_CONFUSED');
    else if (deadline !== limitNs) fail('DEADLINE_INVALID');
    const own = events.get(c.callId) ?? [];
    if (c.outcome === 'completed') {
      const took = elapsed(c.startedNs, c.completedNs);
      if (took < 0n) fail('ORDER_INVALID');
      if (took > limitNs) fail('COMPLETED_AFTER_LIMIT');
      results.push({ callId: c.callId, outcome: c.outcome, syntheticElapsedMs: String(took / NS_PER_MS),
        lateApplied: null, lateSubmitted: null });
      continue;
    }
    // 時間切れ: 300000〜301000ミリ秒の契約境界（両端を含む）。
    const took = elapsed(c.startedNs, c.timedOutNs);
    if (took < limitNs || took > upperNs) fail('TIMEOUT_OUT_OF_BOUND');
    if (!present(c, 'killRequestedNs')) blocked('KILL_MISSING');
    else if (before(c.killRequestedNs, c.timedOutNs)) fail('ORDER_INVALID');
    // kill 要求とは独立した終了通知が必要。欠測を終了済みとみなさない。
    const e = exits.get(c.callId);
    if (!e) blocked('CHILD_EXIT_MISSING');
    else {
      if (e.childId !== c.childId) fail('CHILD_EXIT_MISMATCH');
      if (present(c, 'killRequestedNs') && before(e.atNs, c.killRequestedNs)) fail('ORDER_INVALID');
    }
    if (before(c.lateDueNs, c.timedOutNs) || before(worldEnd, c.lateDueNs)) fail('ORDER_INVALID');
    // 遅着予定以後から世界終了までを欠けなく観測した区間が必要。
    const w = windows.get(c.callId);
    if (!w) blocked('LATE_WINDOW_MISSING');
    else if (before(c.lateDueNs, w.fromNs) || before(w.toNs, worldEnd)) blocked('LATE_WINDOW_TRUNCATED');
    // 時間切れ呼出しの source 適用・送信は、記録時刻に関係なく FAIL。
    const lateApplied = own.some(x => x.action === 'apply' || x.action === 'select');
    const lateSubmitted = own.some(x => x.action === 'submit');
    if (lateApplied) fail('LATE_APPLIED');
    if (lateSubmitted) fail('LATE_SUBMITTED');
    results.push({ callId: c.callId, outcome: c.outcome, syntheticElapsedMs: String(took / NS_PER_MS),
      lateApplied, lateSubmitted });
  }
  calls.push(...results.sort((a, b) => a.callId - b.callId));

  // 保存完了・状態ハッシュ・次epochの再読込
  const saves = new Map();
  for (const s of input.saves) {
    if (saves.has(s.epoch)) fail('SAVE_DUPLICATE');
    saves.set(s.epoch, s);
  }
  const reloads = new Map();
  for (const r of input.reloads) {
    if (!saves.has(r.fromEpoch)) { fail('RELOAD_UNJOINED'); continue; }
    if (reloads.has(r.fromEpoch)) fail('RELOAD_DUPLICATE');
    reloads.set(r.fromEpoch, r);
  }
  const carried = [];
  for (const s of input.saves) {
    if (!present(s, 'completedNs') || !present(s, 'writtenHash')) { blocked('SAVE_INCOMPLETE'); continue; }
    if (before(s.completedNs, s.requestedNs)) fail('ORDER_INVALID');
    if (s.writtenHash !== s.stateHash) fail('SAVE_HASH_MISMATCH');
    const r = reloads.get(s.epoch);
    if (!r) { blocked('RELOAD_MISSING'); continue; }
    if (r.epoch !== s.epoch + 1) fail('EPOCH_NOT_NEXT');
    if (before(r.atNs, s.completedNs)) fail('RELOAD_BEFORE_SAVE');
    if (r.loadedHash !== s.stateHash) fail('RELOAD_HASH_MISMATCH');
    carried.push({ epoch: s.epoch, nextEpoch: r.epoch });
  }
  carryOver.push(...carried.sort((a, b) => a.epoch - b.epoch));

  // 元モジュールへの復帰・新管理版・世代・最初の判断
  const r = input.restore;
  if (r.restoredSourceHash !== r.originalSourceHash) fail('RESTORE_TARGET_MISMATCH');
  const d = r.firstDecision;
  if (!present(r, 'firstDecision')) blocked('FIRST_DECISION_MISSING');
  else {
    if (d.generation !== r.generation || d.sourceHash !== r.restoredSourceHash) fail('FIRST_DECISION_MISMATCH');
    if (before(d.atNs, r.atNs)) fail('ORDER_INVALID');
    restore = { managedVersion: r.managedVersion, generation: r.generation, firstDecisionId: d.decisionId };
  }
  return finish();
}
