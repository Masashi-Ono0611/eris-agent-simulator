// 元ファイルを変更せず、メモリ上で検査を1つずつ壊し、対応する正対照が失敗することを確認する。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const url = new URL('./boundary-join.mjs', import.meta.url);
const original = readFileSync(url, 'utf8');
const mutations = [
  {
    name: '送信済み境界の残高超過検査を削除', test: '正対照: 残高超過',
    guard: "if (sent && balance !== null && reserved !== null && spent > balance - reserved) fail('J11_FUNDS_EXCEEDED');",
    replacement: '/* 人工変異: 残高超過を検査しない */', code: 'REQ4_J11_FUNDS_EXCEEDED', verdict: 'FAIL',
  },
  {
    name: '許可額の照合からspenderを外す', test: '正対照: 別spenderの許可額を流用',
    guard: "const e = values.get([kind, input.owner, token, spender].join('|')), group = category(kind);",
    replacement: "const e = values.get([kind, input.owner, token, spender].join('|'))"
      + ' ?? [...values.values()].find(v => v.kind === kind && v.token === token), group = category(kind);',
    code: 'REQ4_J11_VALUE_MISSING', verdict: 'BLOCKED',
  },
  {
    name: '欠測した境界値を0で補完', test: '正対照: 予約の欠測',
    guard: 'if (!e) { blocked(`${group}_VALUE_MISSING`); return null; }',
    replacement: 'if (!e) return 0n; /* 人工変異: 欠測を0にする */', code: 'REQ4_J12_VALUE_MISSING', verdict: 'BLOCKED',
  },
  {
    name: '既存事後結合器のBLOCKED判定を引き継がない', test: '正対照: receipt全文なし（J06）',
    guard: "else if (value !== 'PASS') blocked(`${check}_POSTHOC_NOT_PASS`);",
    replacement: '/* 人工変異: PASS以外を無視する */', code: 'REQ4_J06_POSTHOC_NOT_PASS', verdict: 'BLOCKED',
  },
  {
    name: '同じnonceの別hashを合算してしまう', test: '正対照: 同nonceの別hashを合算しない',
    guard: "if (nonces.has(nonceKey)) { blocked('J12_NONCE_GROUP_UNRESOLVED'); complete = false; }",
    replacement: '/* 人工変異: 置換候補を合算する */', code: 'REQ4_J12_NONCE_GROUP_UNRESOLVED', verdict: 'BLOCKED',
  },
];
for (const mutation of mutations) {
  assert.equal(original.split(mutation.guard).length, 2, `対象検査は一箇所だけ: ${mutation.name}`);
  const broken = original.replace(mutation.guard, mutation.replacement);
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    `--test-name-pattern=^${mutation.test}$`,
    fileURLToPath(new URL('../tests/boundary-join.test.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 10000,
    env: { PATH: process.env.PATH, G3_REQ4_JOINER_URL: `data:text/javascript;base64,${Buffer.from(broken).toString('base64')}` },
  });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, 1, `正対照テスト自体の失敗が必要: ${mutation.name}`);
  assert.ok(child.stdout.includes(mutation.code));
  assert.match(child.stdout, /ERR_ASSERTION/);
  assert.match(child.stdout, /# fail 1\b/);
  assert.match(child.stdout, /# pass 0\b/);
  assert.ok(child.stdout.includes(`expected: '${mutation.verdict}'`));
  assert.match(child.stdout, /actual: 'CONTRACT_OK_ON_SYNTHETIC'/);
  assert.equal(readFileSync(url, 'utf8'), original);
  console.log(`人工変異: ${mutation.name} → 子テスト終了コード1、正対照1件失敗`);
}
console.log(`${mutations.length}つの検査を個別に除去して検出。元ファイルへの書込みなし。`);
