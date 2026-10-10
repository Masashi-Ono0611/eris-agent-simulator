import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticSourceJoin, seal, source } from './fixtures/SYNTHETIC-source-join.mjs';

// 変異検査時だけ、検査器の一時コピーを読み込む。通常は固定の実装。
const { joinSourceApplications } = await import(process.env.G3_REQ2_JOINER_URL
  ?? '../loader/source-join.mjs');
const run = input => joinSourceApplications(input);
const mutate = change => {
  const input = syntheticSourceJoin();
  change(input.records, input);
  return run(input);
};
const issue = (result, verdict, code) => {
  assert.equal(result.verdict, verdict);
  assert.equal(result.g3Status, 'BLOCKED');
  assert.equal(result.liveRecorderVerified, false);
  assert.ok(result.issues.some(i => i.code === code), `${code} が発火すること`);
};

test('人工契約: 時刻区間、版、ハッシュ、初回送信識別子を結ぶ', () => {
  const input = syntheticSourceJoin();
  const before = structuredClone(input);
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.equal(result.g3Status, 'BLOCKED');
  assert.equal(result.liveRecorderVerified, false);
  assert.equal(result.firstDecisionBasis, 'parent-worker_post');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.applications.map(a => [a.version, a.firstDecisionId, a.generation]),
    [[1, 2, 2], [2, 3, 3], [3, 4, 4]]);
  for (const app of result.applications) {
    const exit = input.records.find(r => r.event === 'setSource_exit' && r.callId === app.setSourceCallId);
    assert.deepEqual(app.setSourceInterval, {
      beforeUtc: exit.beforeUtc, afterUtc: exit.afterUtc, beforeNs: exit.beforeNs, afterNs: exit.afterNs,
    });
    assert.equal(app.sourceSha256, exit.sourceSha256);
    assert.equal(app.versionOrigin, 'fixture-explicit');
    assert.equal(app.firstWorkerDecisionId, 1);
    assert.equal(app.workerExecutionVerified, false);
    assert.equal(app.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
    assert.equal(Object.hasOwn(app, 'callBlock'), false);
  }
  assert.deepEqual(input, before, '入力を変更しない');
});

test('同じハッシュの別版、元モジュールを新管理版で選択、複数実行器を混同しない', () => {
  const result = run(syntheticSourceJoin({ runners: 2 }));
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.equal(result.applications.length, 6);
  assert.equal(result.applications[0].sourceSha256, result.applications[1].sourceSha256);
  assert.equal(result.applications[2].sourceSha256, source(0, true).sourceSha256);
  assert.equal(result.applications[3].runnerId, 2);
  assert.equal(result.applications[3].firstDecisionId, 6);
});

test('物理行順が前後しても共有連番で結合する', () => {
  const input = syntheticSourceJoin();
  input.records.reverse();
  assert.equal(run(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

test('未送信判断を飛ばし、同世代の複数送信では最初の識別子を保持する', () => {
  const input = syntheticSourceJoin();
  const rows = input.records;
  const fields = { schema: 1, threadId: 0, runnerId: 1, ...source(1) };
  const before = rows.findIndex(r => r.event === 'decide_enter' && r.version === 1);
  rows.splice(before, 0,
    { ...fields, event: 'decide_enter', callId: 90, decisionId: 90 },
    { ...fields, event: 'decide_exit', callId: 90, decisionId: 90, outcome: 'return' });
  const exitIndex = rows.findIndex(r => r.event === 'worker_exit' && r.generation === 2);
  const [exit] = rows.splice(exitIndex, 1);
  rows.splice(exitIndex + 1, 0,
    { ...fields, event: 'decide_enter', callId: 99, decisionId: 99 },
    { ...fields, event: 'worker_post', generation: 2, decisionId: 99, workerDecisionId: 2 },
    { ...fields, event: 'worker_result', generation: 2, decisionId: 99, workerDecisionId: 2 },
    { ...fields, event: 'decide_exit', callId: 99, decisionId: 99, outcome: 'return' }, exit);
  const result = run(seal(rows));
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.equal(result.applications[0].firstDecisionId, 2);
});

test('旧判断の完了が新選択より後でも、初回判断を新世代の送信へ結ぶ', () => {
  const input = syntheticSourceJoin();
  const selected = input.records.filter(r => r.event.startsWith('setSource_') && r.version === 1);
  const records = input.records.filter(r => !selected.includes(r));
  records.splice(records.findIndex(r => r.event === 'worker_result'), 0, ...selected);
  const result = run(seal(records));
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.equal(result.applications[0].firstDecisionId, 2);
});

test('例外を返した setSource は適用扱いせず、初回識別子を作らない', () => {
  const input = syntheticSourceJoin();
  const at = input.records.length - 1;
  input.records.splice(at, 0,
    { schema: 1, threadId: 0, event: 'setSource_enter', runnerId: 1, callId: 99, ...source(4) },
    { schema: 1, threadId: 0, event: 'setSource_exit', runnerId: 1, callId: 99, ...source(4), outcome: 'throw' });
  const result = run(seal(input.records));
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.equal(result.applications.at(-1).outcome, 'throw');
  assert.equal(result.applications.at(-1).firstDecisionId, null);
});

test('選択後に判断がない版は BLOCKED、例外・未送信判断を初回としない', () => {
  const input = syntheticSourceJoin();
  const records = input.records.filter(r => !(r.version === 3 && !r.event.startsWith('setSource_'))
    && !(r.event === 'worker_attach' && r.generation === 4));
  const result = run(seal(records));
  issue(result, 'BLOCKED', 'REQ2_FIRST_DISPATCH_MISSING');
  assert.equal(result.applications.at(-1).firstDecisionId, null);
});

test('同一版の再選択は descriptor 同一性がないため曖昧な結合を拒否', () => {
  const input = syntheticSourceJoin();
  const at = input.records.findIndex(r => r.event === 'decide_enter' && r.version === 1);
  input.records.splice(at, 0,
    { schema: 1, threadId: 0, event: 'setSource_enter', runnerId: 1, callId: 99, ...source(1) },
    { schema: 1, threadId: 0, event: 'setSource_exit', runnerId: 1, callId: 99, ...source(1), outcome: 'return' });
  issue(run(seal(input.records)), 'BLOCKED', 'REQ2_SELECTION_AMBIGUOUS');
});

const controls = [
  ['親イベントのスレッド偽装', 'FAIL', 'REQ2_THREAD_INVALID', rows => {
    rows.find(r => r.event === 'setSource_exit').threadId = 1;
  }],
  ['同期入口と出口のハッシュ不一致', 'FAIL', 'REQ2_SOURCE_MISMATCH', rows => {
    rows.find(r => r.event === 'setSource_exit').sourceSha256 = 'f'.repeat(64);
  }],
  ['ハッシュ誤結合', 'FAIL', 'REQ2_SOURCE_MISMATCH', rows => {
    rows.find(r => r.event === 'worker_create' && r.version === 1).sourceSha256 = 'f'.repeat(64);
  }],
  ['版誤結合', 'FAIL', 'REQ2_SOURCE_MISMATCH', rows => {
    rows.find(r => r.event === 'worker_post' && r.version === 2).version = 1;
  }],
  ['別実行器への付替え', 'FAIL', 'REQ2_RUNNER_MISMATCH', rows => {
    rows.find(r => r.event === 'worker_post').runnerId = 9;
  }],
  ['判断識別子誤結合', 'FAIL', 'REQ2_DECISION_BINDING', rows => {
    rows.find(r => r.event === 'worker_post').decisionId = 999;
  }],
  ['時刻逆転', 'FAIL', 'REQ2_TIME_ORDER', rows => {
    rows.find(r => r.event === 'setSource_exit').afterNs = '0';
  }],
  ['協定世界時逆転', 'FAIL', 'REQ2_TIME_ORDER', rows => {
    rows.find(r => r.event === 'setSource_exit').afterUtc = '2000-01-01T00:00:00.000Z';
  }],
  ['時刻欠落', 'BLOCKED', 'REQ2_FIELD_MISSING', rows => {
    delete rows.find(r => r.event === 'setSource_exit').beforeNs;
  }],
  ['版由来欠落', 'BLOCKED', 'REQ2_FIELD_MISSING', rows => {
    delete rows.find(r => r.event === 'setSource_enter').versionOrigin;
  }],
  ['版由来の自己宣言', 'BLOCKED', 'REQ2_VERSION_ORIGIN', rows => {
    rows.find(r => r.event === 'setSource_enter').versionOrigin = 'live-verified';
  }],
  ['切詰め', 'BLOCKED', 'G3_INCOMPLETE', rows => { rows.pop(); }],
  ['世代登録欠落', 'BLOCKED', 'G3_WORKER_GAP', rows => {
    rows.splice(rows.findIndex(r => r.event === 'worker_attach'), 1);
    rows.forEach((r, i) => { r.seq = i + 1; });
  }],
  ['判断結果欠落', 'BLOCKED', 'G3_TERMINAL_GAP', rows => {
    rows.splice(rows.findIndex(r => r.event === 'worker_result'), 1);
    rows.forEach((r, i) => { r.seq = i + 1; });
  }],
  ['完了件数の偽装', 'FAIL', 'G3_DECISION_COUNT', rows => {
    rows.find(r => r.event === 'probe_complete').decisions += 1;
  }],
  ['呼出終端欠落', 'BLOCKED', 'REQ2_CALL_GAP', rows => {
    rows.splice(rows.findIndex(r => r.event === 'setSource_exit'), 1);
    rows.forEach((r, i) => { r.seq = i + 1; });
  }],
  ['連番欠落', 'BLOCKED', 'REQ2_SEQUENCE_GAP', rows => { rows.splice(1, 1); }],
  ['連番重複', 'FAIL', 'REQ2_SEQUENCE_DUPLICATE', rows => { rows[1].seq = rows[0].seq; }],
  ['呼出識別子重複', 'FAIL', 'REQ2_CALL_DUPLICATE', rows => {
    rows.find(r => r.event === 'setSource_enter').callId = 1;
  }],
  ['孤立した終端', 'FAIL', 'REQ2_ORPHAN_EXIT', rows => {
    rows.find(r => r.event === 'setSource_exit').callId = 999;
  }],
  ['入力数値の不正', 'FAIL', 'REQ2_FIELD_INVALID', rows => {
    rows.find(r => r.event === 'worker_post').decisionId = -1;
  }],
];
for (const [name, verdict, code, change] of controls) {
  test(`正対照: ${name}で ${code} が発火する`, () => issue(mutate(change), verdict, code));
}

test('人工由来ラベルなし・空記録・不正形式は契約成立にしない', () => {
  const input = syntheticSourceJoin();
  delete input.provenance;
  issue(run(input), 'BLOCKED', 'REQ2_PROVENANCE');
  issue(run({ schema: 1, provenance: 'SYNTHETIC', records: [] }), 'BLOCKED', 'REQ2_EMPTY');
  issue(run(null), 'BLOCKED', 'REQ2_INPUT_MISSING');
  issue(run({ schema: 1, provenance: 'SYNTHETIC', records: 'bad' }), 'FAIL', 'REQ2_INPUT_INVALID');
});

test('入力中の余分な本文や合成秘密文字列を結果へ転記しない', () => {
  const input = syntheticSourceJoin();
  for (const r of input.records) r.raw = 'SYNTHETIC_SECRET_CANARY';
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET_CANARY'));
});
