// 元ファイルを変更せず、メモリ上で3つの検査を個別に壊す。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const url = new URL('./decision-join.mjs', import.meta.url);
const original = readFileSync(url, 'utf8');
const mutations = [
  {
    name: '協定世界時だけの逆転検査を削除', test: '正対照: 協定世界時だけ逆転',
    guard: "if (Date.parse(rows[i].utc) < Date.parse(rows[i - 1].utc)) fail('TIME_ORDER');",
    replacement: '/* 人工変異: 協定世界時を検査しない */', code: 'REQ3_TIME_ORDER', verdict: 'FAIL',
  },
  {
    name: '世代を含む判断帰属検査を削除', test: '正対照: 旧世代結果の付替え',
    guard: "else if (!same(r, owner, bindingKeys)) fail('BINDING');",
    replacement: '/* 人工変異: 判断帰属を検査しない */', code: 'REQ3_BINDING', verdict: 'FAIL',
  },
  {
    name: '読出し期待集合の欠測を空配列に補完', test: '正対照: 空配列の補完を許さない',
    guard: 'const expected = input.expected;',
    replacement: 'const expected = { ...input.expected, reads: input.expected.reads ?? [] };',
    code: 'REQ3_FIELD_MISSING', verdict: 'BLOCKED',
  },
];
for (const mutation of mutations) {
  assert.equal(original.split(mutation.guard).length, 2, '対象検査は一箇所だけ');
  const broken = original.replace(mutation.guard, mutation.replacement);
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    `--test-name-pattern=^${mutation.test}$`,
    fileURLToPath(new URL('../tests/decision-join.test.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 10000,
    env: { PATH: process.env.PATH, G3_REQ3_JOINER_URL: `data:text/javascript;base64,${Buffer.from(broken).toString('base64')}` },
  });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, 1, '正対照テスト自体の失敗が必要');
  assert.ok(child.stdout.includes(mutation.code));
  assert.match(child.stdout, /ERR_ASSERTION/);
  assert.match(child.stdout, /# fail 1\b/);
  assert.ok(child.stdout.includes(`expected: '${mutation.verdict}'`));
  assert.match(child.stdout, /actual: 'CONTRACT_OK_ON_SYNTHETIC'/);
  assert.equal(readFileSync(url, 'utf8'), original);
  console.log(`人工変異: ${mutation.name} → 子テスト終了コード1、正対照1件失敗`);
}
console.log('3つの検査を個別に除去して検出。元ファイルへの書込みなし。');
