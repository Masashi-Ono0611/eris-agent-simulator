import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticLifecycleJoin, hashes, nsAt } from './fixtures/SYNTHETIC-lifecycle-join.mjs';

const { joinLifecycle } = await import(process.env.G3_REQ5_JOINER_URL ?? '../loader/lifecycle-join.mjs');
const run = input => joinLifecycle(input);
const call = (input, id) => input.calls.find(c => c.callId === id);
const exit = (input, id) => input.exits.find(e => e.callId === id);
const windowOf = (input, id) => input.lateWindows.find(w => w.callId === id);
const issue = (result, verdict, code) => {
  assert.equal(result.verdict, verdict, code);
  assert.equal(result.g3Status, 'BLOCKED');
  assert.equal(result.liveRecorderVerified, false);
  assert.ok(result.issues.some(i => i.code === code), `${code} が発火すること: ${JSON.stringify(result.issues)}`);
  assert.deepEqual(result.calls, [], '不完全な記録から呼出し結果を作らない');
  assert.deepEqual(result.carryOver, []);
  assert.equal(result.restore, null);
};
const check = (name, verdict, code, change) => test(`正対照: ${name}`, () => {
  const input = syntheticLifecycleJoin(); change(input);
  const before = structuredClone(input);
  issue(run(input), verdict, `REQ5_${code}`);
  assert.deepEqual(input, before, '入力を変更しない');
});

test('人工契約: 境界ちょうどの時間切れ・子終了・遅着不採用・持越し・復帰を結合', () => {
  const input = syntheticLifecycleJoin(), before = structuredClone(input);
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result.issues));
  assert.equal(result.g3Status, 'BLOCKED'); assert.equal(result.liveRecorderVerified, false);
  assert.equal(result.timeBasis, 'synthetic-clock-not-real-time');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.calls.map(c => [c.callId, c.outcome, c.syntheticElapsedMs, c.lateApplied, c.lateSubmitted]), [
    [1, 'timed_out', '300000', false, false],
    [2, 'completed', '40000', null, null],
    [3, 'timed_out', '301000', false, false],
  ]);
  assert.deepEqual(result.carryOver, [{ epoch: 1, nextEpoch: 2 }, { epoch: 2, nextEpoch: 3 }]);
  assert.deepEqual(result.restore, { managedVersion: 4, generation: 2, firstDecisionId: 9 });
  assert.deepEqual(input, before);
});
test('物理順を変えても結合し、凍結した入力に書き込まない', () => {
  const input = syntheticLifecycleJoin();
  for (const key of ['calls', 'exits', 'lateWindows', 'sourceEvents', 'saves', 'reloads']) input[key].reverse();
  const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(input);
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result.issues));
  assert.deepEqual(result.calls.map(c => c.callId), [1, 2, 3]);
});
test('負対照: 人工時間倍率60は人工契約としてのみ成立し、実時間とは扱わない', () => {
  const input = syntheticLifecycleJoin();
  input.clock.scale = 60;
  // 人工時計の5000ミリ秒×60 = 人工300000ミリ秒。
  const scaled = BigInt(call(input, 1).startedNs) + 5000n * 1000000n;
  Object.assign(call(input, 1), { deadlineNs: String(scaled), timedOutNs: String(scaled), killRequestedNs: String(scaled) });
  exit(input, 1).atNs = String(scaled + 1n);
  Object.assign(call(input, 3), { deadlineNs: String(BigInt(call(input, 3).startedNs) + 5000n * 1000000n) });
  call(input, 3).timedOutNs = call(input, 3).deadlineNs; call(input, 3).killRequestedNs = call(input, 3).deadlineNs;
  exit(input, 3).atNs = String(BigInt(call(input, 3).deadlineNs) + 1n);
  call(input, 2).deadlineNs = String(BigInt(call(input, 2).startedNs) + 5000n * 1000000n);
  call(input, 2).completedNs = String(BigInt(call(input, 2).startedNs) + 1000n * 1000000n);
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result.issues));
  assert.equal(result.calls[0].syntheticElapsedMs, '300000');
  assert.equal(result.timeBasis, 'synthetic-clock-not-real-time');
  assert.equal(result.liveRecorderVerified, false);
});
test('負対照: 期限内の呼出しの採用・送信は許す', () => {
  const input = syntheticLifecycleJoin();
  assert.ok(input.sourceEvents.some(e => e.callId === 2 && e.action === 'apply'));
  assert.equal(run(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

const controls = [
  // 時間制限の取り違え・人工倍率の実時間扱い
  ['推論制限に判断予算を入れる', 'FAIL', 'LIMIT_CONFUSED', i => { i.limits.inferenceTimeoutMs = 5000; }],
  ['判断予算に推論制限を入れる', 'FAIL', 'LIMIT_CONFUSED', i => { i.limits.decisionBudgetMs = 300000; }],
  ['推論制限の値が契約と違う', 'FAIL', 'LIMIT_INVALID', i => { i.limits.inferenceTimeoutMs = 299999; }],
  ['判断予算の値が契約と違う', 'FAIL', 'LIMIT_INVALID', i => { i.limits.decisionBudgetMs = 5001; }],
  ['期限を判断予算5000ミリ秒で計算', 'FAIL', 'LIMIT_CONFUSED', i => { call(i, 2).deadlineNs = nsAt(405000); }],
  ['期限が300000ミリ秒でない', 'FAIL', 'DEADLINE_INVALID', i => { call(i, 2).deadlineNs = nsAt(700001); }],
  ['人工時間倍率を実測と宣言', 'FAIL', 'TIME_SCALE_AS_REAL', i => { i.clock.realTimeMeasured = true; }],
  ['人工由来なのに実時計と宣言', 'FAIL', 'TIME_SCALE_AS_REAL', i => { i.clock.kind = 'wall'; }],
  // 300000〜301000ミリ秒の契約境界
  ['299999ミリ秒で時間切れ', 'FAIL', 'TIMEOUT_OUT_OF_BOUND', i => { call(i, 1).timedOutNs = nsAt(299999); }],
  ['301001ミリ秒で時間切れ', 'FAIL', 'TIMEOUT_OUT_OF_BOUND', i => { call(i, 3).timedOutNs = nsAt(801001); call(i, 3).killRequestedNs = nsAt(801001); }],
  ['期限後の完了を完了扱い', 'FAIL', 'COMPLETED_AFTER_LIMIT', i => { call(i, 2).completedNs = nsAt(701001); }],
  ['300000ミリ秒を超えた完了を完了扱い（許容幅内）', 'FAIL', 'COMPLETED_AFTER_LIMIT', i => { call(i, 2).completedNs = nsAt(700500); }],
  // 子の開始・kill要求・独立した終了通知
  ['子の開始記録なし', 'BLOCKED', 'FIELD_MISSING', i => { delete call(i, 1).childStartedNs; }],
  ['kill要求なし', 'BLOCKED', 'KILL_MISSING', i => { delete call(i, 1).killRequestedNs; }],
  ['kill要求のみで終了通知なし', 'BLOCKED', 'CHILD_EXIT_MISSING', i => { i.exits = i.exits.filter(e => e.callId !== 1); }],
  ['別の子の終了を結合', 'FAIL', 'CHILD_EXIT_MISMATCH', i => { exit(i, 1).childId = 13; }],
  ['終了通知の重複', 'FAIL', 'CHILD_EXIT_DUPLICATE', i => { i.exits.push({ ...exit(i, 1), atNs: nsAt(300004) }); }],
  ['kill要求より前の終了', 'FAIL', 'ORDER_INVALID', i => { exit(i, 1).atNs = nsAt(300000); }],
  ['時間切れより前のkill要求', 'FAIL', 'ORDER_INVALID', i => { call(i, 1).killRequestedNs = nsAt(299999); }],
  ['未知の呼出しの終了通知', 'FAIL', 'CHILD_EXIT_UNJOINED', i => { i.exits.push({ callId: 99, childId: 99, kind: 'exit', atNs: nsAt(10) }); }],
  // 遅着予定以後から世界終了まで
  ['遅着予定が時間切れより前', 'FAIL', 'ORDER_INVALID', i => { call(i, 1).lateDueNs = nsAt(299000); }],
  ['観測区間の末尾切詰め', 'BLOCKED', 'LATE_WINDOW_TRUNCATED', i => { windowOf(i, 1).toNs = nsAt(999999); }],
  ['観測区間の開始が遅着予定より後', 'BLOCKED', 'LATE_WINDOW_TRUNCATED', i => { windowOf(i, 3).fromNs = nsAt(850001); }],
  ['観測区間なし', 'BLOCKED', 'LATE_WINDOW_MISSING', i => { i.lateWindows = i.lateWindows.filter(w => w.callId !== 3); }],
  ['時間切れ呼出しの遅着source適用', 'FAIL', 'LATE_APPLIED', i => { i.sourceEvents.push({ callId: 1, atNs: nsAt(320001), action: 'apply' }); }],
  ['時間切れ呼出し後の送信', 'FAIL', 'LATE_SUBMITTED', i => { i.sourceEvents.push({ callId: 3, atNs: nsAt(900000), action: 'submit' }); }],
  ['世界終了後の記録で区間外の適用', 'FAIL', 'LATE_APPLIED', i => { i.sourceEvents.push({ callId: 3, atNs: nsAt(1000001), action: 'apply' }); }],
  ['未知の呼出しのsource記録', 'BLOCKED', 'SOURCE_EVENT_UNJOINED', i => { i.sourceEvents.push({ callId: 77, atNs: nsAt(10), action: 'apply' }); }],
  // 保存完了・状態ハッシュ・次epochの再読込
  ['保存要求だけで完了なし', 'BLOCKED', 'SAVE_INCOMPLETE', i => { i.saves[0].completedNs = null; }],
  ['保存完了の書込みハッシュ差替え', 'FAIL', 'SAVE_HASH_MISMATCH', i => { i.saves[0].writtenHash = hashes.state2; }],
  ['読込ハッシュ差替え', 'FAIL', 'RELOAD_HASH_MISMATCH', i => { i.reloads[0].loadedHash = hashes.state2; }],
  ['次epochの再読込なし', 'BLOCKED', 'RELOAD_MISSING', i => { i.reloads = i.reloads.filter(r => r.fromEpoch !== 2); }],
  ['再読込先が次epochでない', 'FAIL', 'EPOCH_NOT_NEXT', i => { i.reloads[0].epoch = 3; i.reloads[1].epoch = 4; }],
  ['保存完了前の再読込', 'FAIL', 'RELOAD_BEFORE_SAVE', i => { i.reloads[0].atNs = nsAt(450005); }],
  ['保存epochの重複', 'FAIL', 'SAVE_DUPLICATE', i => { i.saves.push({ ...i.saves[0] }); }],
  ['保存の無い再読込', 'FAIL', 'RELOAD_UNJOINED', i => { i.reloads.push({ epoch: 6, fromEpoch: 5, atNs: nsAt(10), loadedHash: hashes.state1 }); }],
  // 元モジュールへの復帰・新管理版・世代・最初の判断
  ['復帰先を別ソースにする', 'FAIL', 'RESTORE_TARGET_MISMATCH', i => { i.restore.restoredSourceHash = hashes.revised; i.restore.firstDecision.sourceHash = hashes.revised; }],
  ['初回判断欠落', 'BLOCKED', 'FIRST_DECISION_MISSING', i => { i.restore.firstDecision = null; }],
  ['初回判断の世代違い', 'FAIL', 'FIRST_DECISION_MISMATCH', i => { i.restore.firstDecision.generation = 1; }],
  ['初回判断のソース違い', 'FAIL', 'FIRST_DECISION_MISMATCH', i => { i.restore.firstDecision.sourceHash = hashes.revised; }],
  ['復帰前の初回判断', 'FAIL', 'ORDER_INVALID', i => { i.restore.firstDecision.atNs = nsAt(949999); }],
  ['復帰記録なし', 'BLOCKED', 'FIELD_MISSING', i => { delete i.restore; }],
  // 入力の形
  ['呼出しが空', 'BLOCKED', 'EMPTY', i => { i.calls = []; i.exits = []; i.lateWindows = []; i.sourceEvents = []; }],
  ['呼出し識別子の重複', 'FAIL', 'CALL_DUPLICATE', i => { call(i, 2).callId = 1; }],
];
for (const [name, verdict, code, change] of controls) check(name, verdict, code, change);

for (const [name, select, key, invalid] of [
  ['入力版', i => i, 'schema', 2],
  ['世界', i => i, 'worldId', 7],
  ['世界終了', i => i, 'worldEndNs', '-1'],
  ['時計倍率', i => i.clock, 'scale', 0],
  ['実測宣言', i => i.clock, 'realTimeMeasured', 'no'],
  ['呼出し識別子', i => i.calls[0], 'callId', 0],
  ['呼出し結果', i => i.calls[0], 'outcome', 'SECRET'],
  ['開始時刻', i => i.calls[0], 'startedNs', 1.5],
  ['時間切れ時刻', i => i.calls[0], 'timedOutNs', '01'],
  ['遅着予定', i => i.calls[0], 'lateDueNs', 'raw-secret'],
  ['子識別子', i => i.calls[0], 'childId', -1],
  ['終了の種類', i => i.exits[0], 'kind', 'SECRET'],
  ['source記録の動作', i => i.sourceEvents[0], 'action', 'SECRET'],
  ['状態ハッシュ', i => i.saves[0], 'stateHash', 'SECRET'],
  ['読込ハッシュ', i => i.reloads[0], 'loadedHash', 'sha256:XYZ'],
  ['管理版', i => i.restore, 'managedVersion', 0],
  ['元ソースハッシュ', i => i.restore, 'originalSourceHash', 'SECRET'],
]) {
  check(`${name} 欠落`, 'BLOCKED', 'FIELD_MISSING', i => { delete select(i)[key]; });
  check(`${name} 不正`, 'FAIL', 'FIELD_INVALID', i => { select(i)[key] = invalid; });
}

test('入力なし・不正要素・人工由来以外は成立にしない', () => {
  issue(run(null), 'BLOCKED', 'REQ5_INPUT_MISSING');
  issue(run(undefined), 'BLOCKED', 'REQ5_INPUT_MISSING');
  issue(run([]), 'FAIL', 'REQ5_INPUT_INVALID');
  const input = syntheticLifecycleJoin(); input.calls.push(null);
  issue(run(input), 'FAIL', 'REQ5_INPUT_INVALID');
  for (const provenance of [undefined, null, 'UNVERIFIED', 'NATURAL', 'VERIFIED', 'RUN_FILES']) {
    const i = syntheticLifecycleJoin(); i.provenance = provenance;
    // 由来がなければ内容の矛盾より先に BLOCKED。
    i.sourceEvents.push({ callId: 1, atNs: nsAt(320001), action: 'apply' });
    issue(run(i), 'BLOCKED', 'REQ5_PROVENANCE');
  }
});
test('余分な本文・秘密フィールドは入れ子を含めて返さない', () => {
  const input = syntheticLifecycleJoin();
  const poison = value => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) poison(child);
      if (!Array.isArray(value)) value.raw = value.stdout = value.prompt = 'SYNTHETIC_SECRET_CANARY';
    }
  };
  poison(input);
  input.worldId = 'SYNTHETIC_SECRET_CANARY';
  const before = structuredClone(input), result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result.issues));
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET_CANARY'));
  assert.deepEqual(input, before);
  input.sourceEvents[0].action = 'SYNTHETIC_SECRET_CANARY';
  assert.ok(!JSON.stringify(run(input)).includes('SYNTHETIC_SECRET_CANARY'));
});
test('2^53を超えるナノ秒をBigIntで比較する', () => {
  const input = syntheticLifecycleJoin();
  const shift = 9007199254740993000n;
  const move = v => String(BigInt(v) + shift);
  input.worldEndNs = move(input.worldEndNs);
  for (const c of input.calls) for (const k of ['startedNs', 'childStartedNs', 'deadlineNs', 'timedOutNs', 'killRequestedNs', 'lateDueNs', 'completedNs']) if (c[k]) c[k] = move(c[k]);
  for (const list of [input.exits, input.sourceEvents, input.reloads]) for (const e of list) e.atNs = move(e.atNs);
  for (const w of input.lateWindows) { w.fromNs = move(w.fromNs); w.toNs = move(w.toNs); }
  for (const s of input.saves) { s.requestedNs = move(s.requestedNs); s.completedNs = move(s.completedNs); }
  input.restore.atNs = move(input.restore.atNs); input.restore.firstDecision.atNs = move(input.restore.firstDecision.atNs);
  assert.equal(run(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  // 1ナノ秒だけ上限を超える
  call(input, 3).timedOutNs = String(BigInt(call(input, 3).timedOutNs) + 1n);
  call(input, 3).killRequestedNs = call(input, 3).timedOutNs;
  exit(input, 3).atNs = String(BigInt(call(input, 3).timedOutNs) + 1n);
  issue(run(input), 'FAIL', 'REQ5_TIMEOUT_OUT_OF_BOUND');
});
