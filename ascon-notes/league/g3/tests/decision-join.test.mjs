import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticDecisionJoin, resequence } from './fixtures/SYNTHETIC-decision-join.mjs';

const { joinDecisions } = await import(process.env.G3_REQ3_JOINER_URL ?? '../loader/decision-join.mjs');
const run = input => joinDecisions(input);
const row = (input, event, decisionId = 2) => input.records.find(r => r.event === event && r.decisionId === decisionId);
const drop = (input, predicate) => {
  input.records = input.records.filter(r => !predicate(r)); resequence(input);
};
const issue = (result, verdict, code) => {
  assert.equal(result.verdict, verdict, code);
  assert.equal(result.g3Status, 'BLOCKED');
  assert.equal(result.liveRecorderVerified, false);
  assert.ok(result.issues.some(i => i.code === code), `${code} が発火すること`);
  assert.deepEqual(result.decisions, [], '不完全な判断を成立済みとして出力しない');
};
const check = (name, verdict, code, change) => test(`正対照: ${name}`, () => {
  const input = syntheticDecisionJoin(); change(input);
  const before = structuredClone(input);
  issue(run(input), verdict, code);
  assert.deepEqual(input, before);
});

test('人工契約: 初期版・取引なし・通常版・未送信・例外・遅着を別に保持', () => {
  const input = syntheticDecisionJoin(), before = structuredClone(input);
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.equal(result.g3Status, 'BLOCKED'); assert.equal(result.liveRecorderVerified, false);
  assert.deepEqual(result.issues, []); assert.equal(result.decisions.length, 5);
  assert.deepEqual(result.decisions.map(d => [d.version, d.outcome]),
    [[0, 'noop'], [1, 'return'], [1, 'not_dispatched'], [2, 'throw'], [3, 'noop']]);
  const normal = result.decisions[1];
  assert.deepEqual(normal.reads.map(r => [r.callOrdinal, r.resolutionOrdinal]), [[1, 2], [2, 1]]);
  assert.equal(normal.reads[0].result.decimal, '900719925474099312345');
  assert.equal(normal.reads[1].result.type, 'exception');
  assert.deepEqual(normal.actions.map(a => [a.path, a.ordinal, a.disposition]),
    [['submit', 1, 'sent'], ['submit', 2, 'not_sent'], ['return', 1, 'sent']]);
  assert.equal(normal.actions[0].payloadSha256, normal.actions[2].payloadSha256);
  assert.equal(result.decisions[4].actions[0].timing, 'late');
  assert.equal(result.decisions[4].actions[0].disposition, 'discarded');
  assert.equal(result.decisions[2].workerStart, null);
  for (const d of result.decisions) {
    assert.deepEqual(d.start, { utc: row(input, 'decision_start', d.decisionId).utc,
      monoNs: row(input, 'decision_start', d.decisionId).monoNs });
    assert.deepEqual(d.finish, { utc: row(input, 'decision_finish', d.decisionId).utc,
      monoNs: row(input, 'decision_finish', d.decisionId).monoNs });
    if (d.dispatched) {
      assert.equal(d.workerStart.utc, row(input, 'worker_start', d.decisionId).utc);
      assert.equal(d.workerFinish.utc, row(input, 'worker_finish', d.decisionId).utc);
    }
  }
  assert.deepEqual(input, before);
});
test('物理行順を変えても共有連番で結合', () => {
  const input = syntheticDecisionJoin(); input.records.reverse();
  assert.equal(run(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});
test('同一世代の別判断・別実行器・旧世代の遅い完了を結合', () => {
  const shared = syntheticDecisionJoin();
  Object.assign(shared.expected.starts[4], { generation: 2, workerDecisionId: 2, version: 1 });
  drop(shared, r => r.event === 'worker_create' && r.generation === 4);
  for (const r of shared.records.filter(r => r.decisionId === 5)) {
    Object.assign(r, { generation: 2, workerDecisionId: 2, version: 1 });
  }
  assert.equal(run(shared).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  const concurrent = syntheticDecisionJoin();
  concurrent.expected.starts[4].runnerId = 2;
  for (const r of concurrent.records.filter(r => r.generation === 4)) r.runnerId = 2;
  const early = concurrent.records.filter(r => r.generation === 4
    && ['worker_create', 'decision_start', 'dispatch', 'worker_start'].includes(r.event));
  concurrent.records = concurrent.records.filter(r => !early.includes(r));
  concurrent.records.splice(concurrent.records.indexOf(row(concurrent, 'worker_finish', 4)), 0, ...early);
  resequence(concurrent);
  const result = run(concurrent);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.equal(result.decisions[3].generation, 3);
  assert.equal(result.decisions[4].runnerId, 2);
});
test('同時刻を許し、凍結した入力にも書き込まない', () => {
  const input = syntheticDecisionJoin();
  for (const r of input.records) { r.utc = input.records[0].utc; r.monoNs = '1'; }
  input.expected.actions.reverse(); input.expected.reads.reverse();
  const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(input);
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.deepEqual(result.decisions[1].actions.map(a => [a.path, a.ordinal]),
    [['submit', 1], ['submit', 2], ['return', 1]]);
});
for (const [first, second] of [
  ['decision_start', 'dispatch'], ['dispatch', 'worker_start'], ['worker_start', 'worker_finish'],
  ['worker_finish', 'decision_finish'], ['worker_start', 'read_call'], ['read_call', 'read_resolve'],
  ['read_resolve', 'worker_finish'], ['worker_start', 'action_attempt'],
  ['action_attempt', 'action_delivery'], ['action_attempt', 'worker_finish'],
]) {
  check(`順序制約 ${first} → ${second}`, 'FAIL', 'REQ3_ORDER', i => {
    const a = row(i, first), b = second === 'read_resolve'
      ? i.records.find(r => r.event === second && r.readId === (a.readId ?? 2)) : row(i, second);
    const ai = i.records.indexOf(a), bi = i.records.indexOf(b);
    [i.records[ai], i.records[bi]] = [b, a]; resequence(i);
  });
}

const controls = [
  ['初期版の開始と全記録を同時に除去', 'BLOCKED', 'DECISION_MISSING', i => drop(i, r => r.decisionId === 1)],
  ['完了欠落', 'BLOCKED', 'DECISION_MISSING', i => drop(i, r => r.event === 'decision_finish' && r.decisionId === 2)],
  ['世代入口欠落', 'BLOCKED', 'WORKER_MISSING', i => drop(i, r => r.event === 'worker_start' && r.decisionId === 2)],
  ['世代完了欠落', 'BLOCKED', 'WORKER_MISSING', i => drop(i, r => r.event === 'worker_finish' && r.decisionId === 2)],
  ['送信欠落', 'BLOCKED', 'WORKER_MISSING', i => drop(i, r => r.event === 'dispatch' && r.decisionId === 2)],
  ['世代生成欠落', 'BLOCKED', 'GENERATION_MISSING', i => drop(i, r => r.event === 'worker_create' && r.generation === 2)],
  ['旧世代結果の付替え', 'FAIL', 'BINDING', i => { row(i, 'worker_finish').generation = 4; }],
  ['実行器付替え', 'FAIL', 'BINDING', i => { row(i, 'worker_finish').runnerId = 9; }],
  ['版付替え', 'FAIL', 'BINDING', i => { row(i, 'worker_finish').version = 0; }],
  ['世代内判断付替え', 'FAIL', 'BINDING', i => { row(i, 'worker_finish').workerDecisionId = 8; }],
  ['送信有無の付替え', 'FAIL', 'BINDING', i => { row(i, 'decision_finish').dispatched = false; row(i, 'decision_finish').generation = null; row(i, 'decision_finish').workerDecisionId = null; }],
  ['世代所有者矛盾', 'FAIL', 'GENERATION_BINDING', i => { i.records.find(r => r.event === 'worker_create').version = 99; }],
  ['世代重複', 'FAIL', 'GENERATION_DUPLICATE', i => { i.records.push({ ...i.records[0] }); resequence(i); }],
  ['未知世代', 'FAIL', 'GENERATION_UNEXPECTED', i => { i.records.push({ ...i.records[0], generation: 99 }); resequence(i); }],
  ['世代生成順逆転', 'FAIL', 'ORDER', i => { const at = i.records.findIndex(r => r.event === 'worker_create'); const [r] = i.records.splice(at, 1); i.records.push(r); resequence(i); }],
  ['未知判断', 'FAIL', 'DECISION_UNEXPECTED', i => { row(i, 'decision_start').decisionId = 99; }],
  ['開始重複', 'FAIL', 'EVENT_DUPLICATE', i => { i.records.push({ ...row(i, 'decision_start') }); resequence(i); }],
  ['未送信への実行記録', 'FAIL', 'UNSENT_EXECUTION', i => { i.records.push({ ...row(i, 'decision_start', 3), event: 'dispatch' }); resequence(i); }],
  ['完了種別矛盾', 'FAIL', 'OUTCOME', i => { row(i, 'decision_finish').outcome = 'noop'; }],
  ['世代完了種別矛盾', 'FAIL', 'OUTCOME', i => { row(i, 'worker_finish').outcome = 'throw'; }],
  ['未送信種別矛盾', 'FAIL', 'OUTCOME', i => { i.expected.finishes[2].outcome = 'noop'; row(i, 'decision_finish', 3).outcome = 'noop'; }],
  ['単調時計逆転', 'FAIL', 'TIME_ORDER', i => { row(i, 'worker_finish').monoNs = '0'; }],
  ['協定世界時だけ逆転', 'FAIL', 'TIME_ORDER', i => { row(i, 'worker_finish').utc = '2000-01-01T00:00:00.000Z'; }],
  ['入口出口順逆転', 'FAIL', 'ORDER', i => { const a = row(i, 'decision_start'), b = row(i, 'decision_finish'); [a.event, b.event] = [b.event, a.event]; a.outcome = 'return'; resequence(i); }],
  ['連番欠落', 'BLOCKED', 'SEQUENCE_GAP', i => { i.records.splice(0, 1); }],
  ['連番重複', 'FAIL', 'SEQUENCE_DUPLICATE', i => { i.records[1].seq = i.records[0].seq; }],
  ['読出し呼出し欠落', 'BLOCKED', 'READ_MISSING', i => drop(i, r => r.event === 'read_call' && r.readId === 1)],
  ['未解決読出し', 'BLOCKED', 'READ_MISSING', i => drop(i, r => r.event === 'read_resolve' && r.readId === 1)],
  ['解決順で呼出番号を付替え', 'FAIL', 'READ_BINDING', i => { for (const r of i.records.filter(r => r.event.startsWith('read_'))) r.callOrdinal = r.resolutionOrdinal; }],
  ['解決順矛盾', 'FAIL', 'READ_BINDING', i => { row(i, 'read_resolve').resolutionOrdinal = 2; }],
  ['読出引数差替え', 'FAIL', 'READ_BINDING', i => { row(i, 'read_call').args.sha256 = 'b'.repeat(64); }],
  ['読出結果差替え', 'FAIL', 'READ_BINDING', i => { row(i, 'read_resolve').result.messageSha256 = 'b'.repeat(64); }],
  ['読出方法差替え', 'FAIL', 'READ_BINDING', i => { row(i, 'read_call').method = 'getAllowance'; }],
  ['未知読出し', 'FAIL', 'READ_UNEXPECTED', i => { row(i, 'read_call').readId = 99; }],
  ['読出順番矛盾', 'FAIL', 'READ_ORDER', i => { const r = i.expected.reads; [r[0].callOrdinal, r[1].callOrdinal] = [2, 1]; for (const e of i.records.filter(e => e.event.startsWith('read_'))) e.callOrdinal = 3 - e.callOrdinal; }],
  ['読出解決順番矛盾', 'FAIL', 'READ_ORDER', i => { for (const r of [...i.expected.reads, ...i.records.filter(r => r.event === 'read_resolve')]) r.resolutionOrdinal = 3 - r.resolutionOrdinal; }],
  ['読出呼出重複', 'FAIL', 'EVENT_DUPLICATE', i => { i.records.push({ ...row(i, 'read_call') }); resequence(i); }],
  ['読出解決重複', 'FAIL', 'EVENT_DUPLICATE', i => { i.records.push({ ...row(i, 'read_resolve') }); resequence(i); }],
  ['読出時間範囲外', 'FAIL', 'ORDER', i => { const r = row(i, 'read_call'); i.records.splice(i.records.indexOf(r), 1); i.records.push(r); resequence(i); }],
  ['経路をハッシュで畳む', 'FAIL', 'ACTION_MISSING', i => drop(i, r => r.event.startsWith('action_') && r.path === 'return')],
  ['遅着試行を除去', 'FAIL', 'ACTION_MISSING', i => drop(i, r => r.event === 'action_attempt' && r.decisionId === 5)],
  ['親処理欠落', 'BLOCKED', 'DELIVERY_MISSING', i => drop(i, r => r.event === 'action_delivery' && r.decisionId === 5)],
  ['出力試行重複', 'FAIL', 'EVENT_DUPLICATE', i => { i.records.push({ ...row(i, 'action_attempt') }); resequence(i); }],
  ['親処理重複', 'FAIL', 'EVENT_DUPLICATE', i => { i.records.push({ ...row(i, 'action_delivery') }); resequence(i); }],
  ['返却出力期待欠落', 'BLOCKED', 'ACTION_EXPECTATION_MISSING', i => { i.expected.actions = i.expected.actions.filter(a => a.path !== 'return'); drop(i, r => r.path === 'return'); }],
  ['破棄を送信済みに変更', 'FAIL', 'ACTION_BINDING', i => { row(i, 'action_delivery', 5).disposition = 'sent'; }],
  ['出力内容差替え', 'FAIL', 'ACTION_BINDING', i => { row(i, 'action_attempt').payloadSha256 = 'b'.repeat(64); }],
  ['出力時機差替え', 'FAIL', 'ACTION_BINDING', i => { row(i, 'action_attempt').timing = 'late'; }],
  ['未知出力経路番号', 'FAIL', 'ACTION_UNEXPECTED', i => { row(i, 'action_attempt').ordinal = 99; }],
  ['出力経路内順番逆転', 'FAIL', 'ACTION_ORDER', i => { for (const a of [...i.expected.actions, ...i.records.filter(r => r.event.startsWith('action_'))].filter(a => a.decisionId === 2 && a.path === 'submit')) a.ordinal = 3 - a.ordinal; }],
  ['遅着送信の自己申告', 'FAIL', 'ACTION_STATE', i => { i.expected.actions.at(-1).disposition = 'sent'; for (const r of i.records.filter(r => r.event.startsWith('action_') && r.decisionId === 5)) r.disposition = 'sent'; }],
  ['取引なしから返却出力', 'FAIL', 'ACTION_STATE', i => { i.expected.finishes[1].outcome = 'noop'; row(i, 'worker_finish').outcome = 'noop'; row(i, 'decision_finish').outcome = 'noop'; }],
  ['遅着時刻範囲矛盾', 'FAIL', 'ORDER', i => { i.expected.actions.at(-1).timing = 'during'; for (const r of i.records.filter(r => r.event.startsWith('action_') && r.decisionId === 5)) r.timing = 'during'; }],
  ['期待開始重複', 'FAIL', 'EXPECTED_DUPLICATE', i => { i.expected.starts.push({ ...i.expected.starts[0] }); }],
  ['期待完了集合の欠落', 'BLOCKED', 'EXPECTED_GAP', i => { i.expected.finishes.pop(); }],
  ['期待完了だけ余剰', 'BLOCKED', 'EXPECTED_GAP', i => { i.expected.finishes.push({ decisionId: 99, outcome: 'noop' }); }],
  ['期待読出しの未知判断', 'FAIL', 'EXPECTED_BINDING', i => { i.expected.reads[0].decisionId = 99; }],
  ['期待読出しの未送信判断', 'FAIL', 'EXPECTED_BINDING', i => { i.expected.reads[0].decisionId = 3; }],
  ['期待出力の未知判断', 'FAIL', 'EXPECTED_BINDING', i => { i.expected.actions[0].decisionId = 99; }],
  ['期待出力の未送信判断', 'FAIL', 'EXPECTED_BINDING', i => { i.expected.actions[0].decisionId = 3; }],
  ['期待世代内判断の重複', 'FAIL', 'EXPECTED_DUPLICATE', i => { Object.assign(i.expected.starts[1], { generation: 1, workerDecisionId: 1 }); }],
  ['期待世代版矛盾', 'FAIL', 'GENERATION_BINDING', i => { Object.assign(i.expected.starts[1], { generation: 1, workerDecisionId: 2 }); }],
  ['空の独立期待集合', 'BLOCKED', 'EMPTY', i => { i.expected.starts = []; i.expected.finishes = []; }],
  ['空の記録', 'BLOCKED', 'EMPTY', i => { i.records = []; }],
  ['空配列の補完を許さない', 'BLOCKED', 'FIELD_MISSING', i => { delete i.expected.reads; drop(i, r => r.event.startsWith('read_')); }],
];
for (const [name, verdict, code, change] of controls) check(name, verdict, `REQ3_${code}`, change);

for (const name of ['starts', 'finishes', 'reads', 'actions']) {
  check(`期待集合 ${name} 欠落`, 'BLOCKED', 'REQ3_FIELD_MISSING', i => { delete i.expected[name]; });
  check(`期待集合 ${name} 不正`, 'FAIL', 'REQ3_FIELD_INVALID', i => { i.expected[name] = {}; });
  check(`期待集合 ${name} 要素不正`, 'FAIL', 'REQ3_INPUT_INVALID', i => { i.expected[name].push(null); });
  check(`期待集合 ${name} 重複`, 'FAIL', 'REQ3_EXPECTED_DUPLICATE', i => { i.expected[name].push({ ...i.expected[name][0] }); });
}
for (const [name, select, key, invalid] of [
  ['時刻', i => row(i, 'worker_finish'), 'utc', '2026-02-30T00:00:00.000Z'],
  ['単調時計', i => row(i, 'worker_finish'), 'monoNs', '-1'],
  ['識別子', i => row(i, 'worker_finish'), 'decisionId', -1],
  ['版', i => i.expected.starts[0], 'version', -1],
  ['世代', i => i.expected.starts[0], 'generation', 0],
  ['世代内判断', i => i.expected.starts[0], 'workerDecisionId', 0],
  ['未送信世代', i => i.expected.starts[2], 'generation', 8],
  ['未送信判断番号', i => i.expected.starts[2], 'workerDecisionId', 8],
  ['送信有無', i => i.expected.starts[0], 'dispatched', 'true'],
  ['完了種別', i => i.expected.finishes[0], 'outcome', 'SECRET'],
  ['連番', i => i.records[0], 'seq', 0],
  ['読出識別子', i => i.expected.reads[0], 'readId', 0],
  ['読出呼出番号', i => i.expected.reads[0], 'callOrdinal', 0],
  ['読出解決番号', i => i.expected.reads[0], 'resolutionOrdinal', 0],
  ['出力ハッシュ', i => i.expected.actions[0], 'payloadSha256', 'SECRET'],
  ['親処理', i => i.expected.actions[0], 'disposition', 'SECRET'],
  ['出力時機', i => i.expected.actions[0], 'timing', 'SECRET'],
  ['経路番号', i => i.expected.actions[0], 'ordinal', 0],
  ['経路', i => i.expected.actions[0], 'path', 'raw-secret'],
  ['引数', i => row(i, 'read_call'), 'args', { encoding: 'raw', raw: 'SECRET' }],
  ['整数形式', i => i.expected.reads[0], 'result', { type: 'integer', decimal: 42 }],
  ['例外形式', i => i.expected.reads[1], 'result', { type: 'exception', name: 'SECRET' }],
  ['引数ハッシュ', i => row(i, 'read_call').args, 'sha256', 'SECRET'],
  ['引数符号化', i => row(i, 'read_call').args, 'encoding', 'raw'],
  ['結果種別', i => i.expected.reads[0].result, 'type', 'raw'],
  ['整数文字列', i => i.expected.reads[0].result, 'decimal', '01'],
  ['例外名', i => i.expected.reads[1].result, 'name', 'SECRET'],
  ['例外本文ハッシュ', i => i.expected.reads[1].result, 'messageSha256', 'SECRET'],
  ['読出方法', i => i.expected.reads[0], 'method', 'SECRET'],
  ['イベント', i => i.records[0], 'event', 'SECRET'],
  ['時計由来', i => i, 'clockBasis', 'live'],
  ['入力版', i => i, 'schema', 2],
  ['期待集合全体', i => i, 'expected', []],
  ['記録全体', i => i, 'records', {}],
]) {
  check(`${name} 欠落`, 'BLOCKED', 'REQ3_FIELD_MISSING', i => { delete select(i)[key]; });
  check(`${name} 不正`, 'FAIL', 'REQ3_FIELD_INVALID', i => { select(i)[key] = invalid; });
}
test('入力なし・不正要素・人工由来以外は成立にしない', () => {
  issue(run(null), 'BLOCKED', 'REQ3_INPUT_MISSING');
  issue(run([]), 'FAIL', 'REQ3_INPUT_INVALID');
  const input = syntheticDecisionJoin(); input.records.push(null);
  issue(run(input), 'FAIL', 'REQ3_INPUT_INVALID');
  for (const provenance of [undefined, null, 'UNVERIFIED', 'NATURAL', 'VERIFIED']) {
    const i = syntheticDecisionJoin(); i.provenance = provenance;
    // 由来がなければ内容の不整合より先に BLOCKED。
    i.records[0].generation = -1;
    issue(run(i), 'BLOCKED', 'REQ3_PROVENANCE');
  }
});
test('余分な本文・秘密フィールドは入れ子を含めて返さない', () => {
  const input = syntheticDecisionJoin();
  const poison = value => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) poison(child);
      if (!Array.isArray(value)) value.raw = value.secret = 'SYNTHETIC_SECRET_CANARY';
    }
  };
  poison(input);
  const before = structuredClone(input), result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET_CANARY'));
  assert.deepEqual(input, before);
  row(input, 'read_call').method = 'SYNTHETIC_SECRET_CANARY';
  assert.ok(!JSON.stringify(run(input)).includes('SYNTHETIC_SECRET_CANARY'));
});
