import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticBoundaryJoin, owner, tokens, spenders, hashes } from './fixtures/SYNTHETIC-boundary-join.mjs';

const { joinBoundaries } = await import(process.env.G3_REQ4_JOINER_URL ?? '../loader/boundary-join.mjs');
const run = input => joinBoundaries(input);
const boundary = (input, id) => input.boundaries.find(b => b.boundaryId === id);
const evidence = (input, id, kind, extra = {}) => boundary(input, id).evidence.find(e => e.kind === kind
  && Object.entries(extra).every(([k, v]) => e[k] === v));
const tx = (input, hash) => input.transactions.find(t => t.hash === hash);
const issue = (result, verdict, code) => {
  assert.equal(result.verdict, verdict, code);
  assert.equal(result.g3Status, 'BLOCKED');
  assert.equal(result.liveRecorderVerified, false);
  assert.ok(result.issues.some(i => i.code === code), `${code} が発火すること: ${JSON.stringify(result.issues)}`);
  assert.deepEqual(result.boundaries, [], '不完全な境界を成立済みとして出力しない');
};
const check = (name, verdict, code, change) => test(`正対照: ${name}`, () => {
  const input = syntheticBoundaryJoin(); change(input);
  const before = structuredClone(input);
  issue(run(input), verdict, code);
  assert.deepEqual(input, before, '入力を変更しない');
});

test('人工契約: 複数取引・spender別許可額・未送信境界・補助送信を別に保持', () => {
  const input = syntheticBoundaryJoin(), before = structuredClone(input);
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result.issues));
  assert.equal(result.g3Status, 'BLOCKED'); assert.equal(result.liveRecorderVerified, false);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.boundaries.map(b => [b.boundaryId, b.outcome, b.txHashes.length]),
    [[1, 'sent', 2], [2, 'not_sent', 0], [3, 'sent', 1]]);
  const first = result.boundaries[0];
  assert.equal(first.maxGasCostWei, '1000000000000000');
  assert.equal(first.maxGasCostBasis, 'derived:sum(gasLimit*maxFeePerGasWei)');
  assert.equal(first.gasHeadroomWei, '8000000000000000');
  assert.deepEqual(first.spentBySpender, [
    { token: tokens.weth, spender: spenders.uniswap, amount: '1000000000000000000' },
    { token: tokens.weth, spender: spenders.curve, amount: '500000000000000000' },
  ]);
  assert.deepEqual(first.spentByToken, [{ token: tokens.weth, amount: '1500000000000000000' }]);
  assert.equal(result.boundaries[1].maxGasCostWei, null, '未送信の最大ガス費を0で作らない');
  assert.equal(result.boundaries[2].spentByToken[0].amount, '900719925474099312000');
  assert.deepEqual(result.auxiliaryTransactions, [{ hash: hashes.refill, origin: 'gas_refill' }]);
  assert.deepEqual(input, before);
});
test('物理順を変えても結合し、凍結した入力に書き込まない', () => {
  const input = syntheticBoundaryJoin();
  input.boundaries.reverse(); input.transactions.reverse(); input.attempts.reverse();
  for (const b of input.boundaries) b.evidence.reverse();
  const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(input);
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result.issues));
  assert.deepEqual(result.boundaries.map(b => b.boundaryId), [1, 2, 3]);
});
test('負対照: 観測済みの0と同額の境界値は成立', () => {
  const input = syntheticBoundaryJoin();
  evidence(input, 1, 'pendingGas').value = '0';
  const result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result.issues));
  assert.equal(result.boundaries[0].gasHeadroomWei, '9000000000000000');
});
test('負対照: 未送信境界の許可額超過は送信前拒否の理由として許す', () => {
  const input = syntheticBoundaryJoin();
  assert.equal(BigInt(evidence(input, 2, 'allowance').value) < BigInt(boundary(input, 2).legs[0].amount), true);
  assert.equal(run(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

const controls = [
  // J11 残高・spender別許可額
  ['残高の欠測', 'BLOCKED', 'J11_VALUE_MISSING', i => { boundary(i, 1).evidence = boundary(i, 1).evidence.filter(e => e.kind !== 'balance'); }],
  ['残高の読取失敗', 'BLOCKED', 'J11_VALUE_UNAVAILABLE', i => { Object.assign(evidence(i, 1, 'balance'), { availability: 'error', value: null }); }],
  ['残高の曖昧', 'BLOCKED', 'J11_VALUE_UNAVAILABLE', i => { Object.assign(evidence(i, 1, 'balance'), { availability: 'ambiguous', value: null }); }],
  ['残高の導出値', 'BLOCKED', 'J11_VALUE_UNAVAILABLE', i => { evidence(i, 1, 'balance').availability = 'derived'; }],
  ['許可額の欠測', 'BLOCKED', 'J11_VALUE_MISSING', i => { boundary(i, 1).evidence = boundary(i, 1).evidence.filter(e => !(e.kind === 'allowance' && e.spender === spenders.curve)); }],
  ['別spenderの許可額を流用', 'BLOCKED', 'J11_VALUE_MISSING', i => { evidence(i, 1, 'allowance', { spender: spenders.curve }).spender = address5(); }],
  ['別保有者の残高', 'BLOCKED', 'J11_VALUE_MISSING', i => { evidence(i, 1, 'balance').owner = address5(); }],
  ['別境界の値', 'BLOCKED', 'J11_BOUNDARY_MISMATCH', i => { evidence(i, 1, 'balance').boundaryId = 3; }],
  ['別ブロック断面の値', 'BLOCKED', 'J11_SNAPSHOT_MIXED', i => { evidence(i, 1, 'balance').resolvedBlockNumber = 99; }],
  ['同値の重複', 'BLOCKED', 'J11_EVIDENCE_DUPLICATE', i => { boundary(i, 1).evidence.push({ ...evidence(i, 1, 'balance') }); }],
  ['異なる値の重複', 'FAIL', 'J11_VALUE_CONFLICT', i => { boundary(i, 1).evidence.push({ ...evidence(i, 1, 'balance'), value: '1' }); }],
  ['残高超過', 'FAIL', 'J11_FUNDS_EXCEEDED', i => { evidence(i, 1, 'balance').value = '1700000000000000000'; evidence(i, 1, 'reservation').value = '200000000000000001'; }],
  ['2^53超の残高で1単位超過', 'FAIL', 'J11_FUNDS_EXCEEDED', i => { evidence(i, 3, 'reservation').value = '346'; }],
  ['spender別許可額超過', 'FAIL', 'J11_ALLOWANCE_EXCEEDED', i => { evidence(i, 1, 'allowance', { spender: spenders.uniswap }).value = '999999999999999999'; }],
  // J12 予約・ガス
  ['予約の欠測', 'BLOCKED', 'J12_VALUE_MISSING', i => { boundary(i, 1).evidence = boundary(i, 1).evidence.filter(e => e.kind !== 'reservation'); }],
  ['未完了ガス費の欠測', 'BLOCKED', 'J12_VALUE_MISSING', i => { boundary(i, 1).evidence = boundary(i, 1).evidence.filter(e => e.kind !== 'pendingGas'); }],
  ['ガス予備の欠測', 'BLOCKED', 'J12_VALUE_MISSING', i => { boundary(i, 1).evidence = boundary(i, 1).evidence.filter(e => e.kind !== 'gasReserve'); }],
  ['ETH残高の欠測', 'BLOCKED', 'J11_VALUE_MISSING', i => { boundary(i, 3).evidence = boundary(i, 3).evidence.filter(e => e.kind !== 'ethBalance'); }],
  ['予約の読取失敗', 'BLOCKED', 'J12_VALUE_UNAVAILABLE', i => { Object.assign(evidence(i, 1, 'reservation'), { availability: 'missing', value: null }); }],
  ['取引のgas上限欠測', 'BLOCKED', 'J12_TX_GAS_MISSING', i => { boundary(i, 1).txs[0].gasLimit = null; }],
  ['取引の上限単価欠測', 'BLOCKED', 'J12_TX_GAS_MISSING', i => { delete boundary(i, 1).txs[1].maxFeePerGasWei; }],
  ['同nonceの別hashを合算しない', 'BLOCKED', 'J12_NONCE_GROUP_UNRESOLVED', i => { boundary(i, 1).txs[1].nonce = 7; }],
  ['ガス予備が0', 'FAIL', 'J12_RESERVE_INVALID', i => { evidence(i, 1, 'gasReserve').value = '0'; }],
  ['ガス予備不足', 'FAIL', 'J12_GAS_RESERVE_EXHAUSTED', i => { evidence(i, 1, 'gasReserve').value = '8000000000000001'; }],
  // J05 試行・境界・取引hash
  ['未知の試行', 'FAIL', 'J05_ATTEMPT_UNKNOWN', i => { boundary(i, 1).attempt.ordinal = 9; }],
  ['送信済み試行の境界欠落', 'BLOCKED', 'J05_BOUNDARY_MISSING', i => { i.boundaries = i.boundaries.filter(b => b.boundaryId !== 3); i.transactions = i.transactions.filter(t => t.hash !== hashes.third); }],
  ['未送信試行の境界欠落', 'BLOCKED', 'J05_BOUNDARY_MISSING', i => { i.boundaries = i.boundaries.filter(b => b.boundaryId !== 2); }],
  ['同じ試行の境界重複', 'FAIL', 'J05_BOUNDARY_DUPLICATE', i => { boundary(i, 2).attempt = { decisionId: 2, path: 'submit', ordinal: 1 }; }],
  ['境界識別子の重複', 'FAIL', 'J05_BOUNDARY_DUPLICATE', i => { boundary(i, 2).boundaryId = 1; for (const e of i.boundaries[1].evidence) e.boundaryId = 1; }],
  ['破棄試行に境界', 'FAIL', 'J05_DISPOSITION_CONFLICT', i => { i.attempts.find(a => a.decisionId === 2 && a.ordinal === 2 && a.path === 'submit').disposition = 'discarded'; }],
  ['未送信試行を送信済み境界に', 'FAIL', 'J05_DISPOSITION_CONFLICT', i => { i.attempts[0].disposition = 'not_sent'; }],
  ['未送信境界にhash', 'FAIL', 'J05_UNSENT_WITH_TX', i => { boundary(i, 2).txs = [{ ...boundary(i, 3).txs[0] }]; }],
  ['送信済み境界にhashなし', 'BLOCKED', 'J05_TX_EDGE_MISSING', i => { boundary(i, 3).txs = []; i.transactions = i.transactions.filter(t => t.hash !== hashes.third); }],
  ['取引表に無いhash', 'BLOCKED', 'J05_TX_UNJOINED', i => { i.transactions = i.transactions.filter(t => t.hash !== hashes.third); }],
  ['同じhashを複数境界に帰属', 'BLOCKED', 'J05_TX_MULTI_ATTRIBUTED', i => { boundary(i, 3).txs = [{ ...boundary(i, 1).txs[1] }]; i.transactions = i.transactions.filter(t => t.hash !== hashes.third); }],
  ['判断由来の孤立取引', 'BLOCKED', 'J05_TX_ORPHAN', i => { i.transactions.push({ ...tx(i, hashes.third), hash: `0x${'9'.repeat(64)}`, origin: 'decision' }); }],
  ['取引表のhash重複', 'FAIL', 'J05_TX_DUPLICATE', i => { i.transactions.push({ ...tx(i, hashes.first) }); }],
  ['別世界の取引', 'FAIL', 'J05_WORLD_CONFLICT', i => { tx(i, hashes.third).worldId = 'synthetic-world-2'; }],
  ['送信元が保有者と違う', 'BLOCKED', 'J05_SENDER_UNBOUND', i => { boundary(i, 3).txs[0].from = address5(); }],
  // 既存J06〜J08の判定を引き継ぐ
  ['receipt全文なし（J06）', 'BLOCKED', 'J06_POSTHOC_NOT_PASS', i => { tx(i, hashes.first).posthoc.J06 = 'BLOCKED'; }],
  ['status矛盾（J07）', 'FAIL', 'J07_POSTHOC_NOT_PASS', i => { tx(i, hashes.first).posthoc.J07 = 'FAIL'; }],
  ['包含位置の欠測（J08）', 'BLOCKED', 'J08_POSTHOC_NOT_PASS', i => { tx(i, hashes.second).posthoc.J08 = 'BLOCKED'; }],
  ['既存判定の欠落', 'BLOCKED', 'J07_POSTHOC_NOT_PASS', i => { delete tx(i, hashes.third).posthoc.J07; }],
  ['補助送信の判定も引き継ぐ', 'BLOCKED', 'J06_POSTHOC_NOT_PASS', i => { tx(i, hashes.refill).posthoc.J06 = 'BLOCKED'; }],
  // J09 と J14 の各1点
  ['包含が境界観測より前', 'FAIL', 'J09_INCLUSION_BEFORE_BOUNDARY', i => { tx(i, hashes.third).blockNumber = 101; }],
  ['補助送信を判断へ帰属', 'FAIL', 'J14_AUX_ATTRIBUTED_TO_DECISION', i => { boundary(i, 3).txs[0].hash = hashes.refill; i.transactions = i.transactions.filter(t => t.hash !== hashes.third); }],
  ['由来不明の取引', 'BLOCKED', 'J14_ORIGIN_UNKNOWN', i => { tx(i, hashes.refill).origin = 'unknown'; }],
  // 入力の形
  ['境界が空', 'BLOCKED', 'EMPTY', i => { i.boundaries = []; i.attempts = []; i.transactions = []; }],
];
function address5() { return `0x${'b'.repeat(40)}`; }
for (const [name, verdict, code, change] of controls) check(name, verdict, `REQ4_${code}`, change);

for (const [name, select, key, invalid] of [
  ['入力版', i => i, 'schema', 2],
  ['世界', i => i, 'worldId', 7],
  ['保有者', i => i, 'owner', 'SECRET'],
  ['試行一覧', i => i, 'attempts', {}],
  ['取引一覧', i => i, 'transactions', {}],
  ['境界一覧', i => i, 'boundaries', {}],
  ['試行の親処理', i => i.attempts[0], 'disposition', 'SECRET'],
  ['試行の経路', i => i.attempts[0], 'path', 'raw-secret'],
  ['境界識別子', i => i.boundaries[0], 'boundaryId', 0],
  ['境界の結果', i => i.boundaries[0], 'outcome', 'mined'],
  ['観測ブロック', i => i.boundaries[0], 'observedAtBlock', -1],
  ['支出一覧', i => i.boundaries[0], 'legs', {}],
  ['支出額', i => i.boundaries[0].legs[0], 'amount', '1.5'],
  ['支出額の数値型', i => i.boundaries[0].legs[0], 'amount', 15],
  ['支出token', i => i.boundaries[0].legs[0], 'token', 'WETH'],
  ['支出spender', i => i.boundaries[0].legs[0], 'spender', 'SECRET'],
  ['取引hash', i => i.boundaries[0].txs[0], 'hash', 'SECRET'],
  ['nonce', i => i.boundaries[0].txs[0], 'nonce', -1],
  ['値の種類', i => i.boundaries[0].evidence[0], 'kind', 'SECRET'],
  ['値の可否', i => i.boundaries[0].evidence[0], 'availability', 'SECRET'],
  ['値の形式', i => i.boundaries[0].evidence[0], 'value', '-1'],
  ['値の先頭0', i => i.boundaries[0].evidence[0], 'value', '01'],
  ['取引の由来', i => i.transactions[0], 'origin', 'SECRET'],
  ['取引の包含ブロック', i => i.transactions[0], 'blockNumber', 1.5],
]) {
  check(`${name} 欠落`, 'BLOCKED', 'REQ4_FIELD_MISSING', i => { delete select(i)[key]; });
  check(`${name} 不正`, 'FAIL', 'REQ4_FIELD_INVALID', i => { select(i)[key] = invalid; });
}
check('既存判定の値の不正', 'FAIL', 'REQ4_FIELD_INVALID', i => { i.transactions[0].posthoc.J06 = 'CONSISTENT'; });
check('観測済みなのに値null', 'FAIL', 'REQ4_FIELD_INVALID', i => { evidence(i, 1, 'balance').value = null; });
check('欠測なのに値あり', 'FAIL', 'REQ4_FIELD_INVALID', i => { evidence(i, 1, 'balance').availability = 'missing'; });

test('入力なし・不正要素・人工由来以外は成立にしない', () => {
  issue(run(null), 'BLOCKED', 'REQ4_INPUT_MISSING');
  issue(run(undefined), 'BLOCKED', 'REQ4_INPUT_MISSING');
  issue(run([]), 'FAIL', 'REQ4_INPUT_INVALID');
  const input = syntheticBoundaryJoin(); input.boundaries.push(null);
  issue(run(input), 'FAIL', 'REQ4_INPUT_INVALID');
  for (const provenance of [undefined, null, 'UNVERIFIED', 'NATURAL', 'VERIFIED', 'RUN_FILES']) {
    const i = syntheticBoundaryJoin(); i.provenance = provenance;
    // 由来がなければ内容の矛盾より先に BLOCKED。
    evidence(i, 1, 'balance').value = '1';
    issue(run(i), 'BLOCKED', 'REQ4_PROVENANCE');
  }
});
test('余分な本文・秘密フィールドは入れ子を含めて返さない', () => {
  const input = syntheticBoundaryJoin();
  const poison = value => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) poison(child);
      if (!Array.isArray(value)) value.raw = value.headers = value.rpcUrl = 'SYNTHETIC_SECRET_CANARY';
    }
  };
  poison(input);
  input.worldId = 'SYNTHETIC_SECRET_CANARY';
  for (const t of input.transactions) t.worldId = 'SYNTHETIC_SECRET_CANARY';
  const before = structuredClone(input), result = run(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result.issues));
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET_CANARY'));
  assert.deepEqual(input, before);
  boundary(input, 1).legs[0].token = 'SYNTHETIC_SECRET_CANARY';
  assert.ok(!JSON.stringify(run(input)).includes('SYNTHETIC_SECRET_CANARY'));
});
test('保有者アドレスは小文字の正規形のみ受け付ける', () => {
  const input = syntheticBoundaryJoin(); input.owner = owner.toUpperCase().replace('0X', '0x');
  issue(run(input), 'FAIL', 'REQ4_FIELD_INVALID');
});
