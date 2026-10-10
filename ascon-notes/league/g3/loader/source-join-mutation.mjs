// 正対照が壊れた検査器を検出することを確認。元ファイルは変更しない。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const original = readFileSync(new URL('./source-join.mjs', import.meta.url), 'utf8');
const guard = 'BigInt(exit.beforeNs) > BigInt(exit.afterNs)';
assert.equal(original.split(guard).length, 2, '削除する検査が一箇所だけ存在すること');
const broken = original.replace(guard, 'false /* 人工変異: 同期区間の逆転を見逃す */')
  .replace("'./audit-records.mjs'", JSON.stringify(new URL('./audit-records.mjs', import.meta.url).href));
const child = spawnSync(process.execPath, ['--test', '--test-name-pattern=正対照: 時刻逆転',
  fileURLToPath(new URL('../tests/source-join.test.mjs', import.meta.url))], {
  encoding: 'utf8', timeout: 10000,
  env: { PATH: process.env.PATH, G3_REQ2_JOINER_URL: `data:text/javascript;base64,${Buffer.from(broken).toString('base64')}` },
});
assert.equal(child.error, undefined);
assert.equal(child.signal, null);
assert.equal(child.status, 1, '壊れた検査器ではテスト自体が失敗すること');
assert.match(child.stdout, /REQ2_TIME_ORDER/);
assert.match(child.stdout, /CONTRACT_OK_ON_SYNTHETIC/);
assert.match(child.stdout, /ERR_ASSERTION/);
assert.match(child.stdout, /fail 1/);
assert.equal(readFileSync(new URL('./source-join.mjs', import.meta.url), 'utf8'), original);
console.log('人工変異: 同期区間の時刻逆転チェックを削除');
console.log('node --test 子プロセス: exit 1、失敗 1 件');
console.log('正対照: 時刻逆転で REQ2_TIME_ORDER が発火する');
console.log('期待 FAIL / 壊れた検査器の実際 CONTRACT_OK_ON_SYNTHETIC → assertion が失敗');
console.log('元ファイルへの書込みなし');
