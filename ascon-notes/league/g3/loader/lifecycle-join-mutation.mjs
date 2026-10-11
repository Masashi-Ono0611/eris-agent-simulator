// 元ファイルを変更せず、メモリ上で検査を1つずつ壊し、対応する正対照が失敗することを確認する。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const url = new URL('./lifecycle-join.mjs', import.meta.url);
const original = readFileSync(url, 'utf8');
const mutations = [
  {
    name: '時間切れ呼出しの遅着適用を検査しない', test: '正対照: 時間切れ呼出しの遅着source適用',
    guard: "if (lateApplied) fail('LATE_APPLIED');",
    replacement: '/* 人工変異: 遅着適用を見逃す */', code: 'REQ5_LATE_APPLIED', verdict: 'FAIL',
  },
  {
    name: '契約境界の下限を外す', test: '正対照: 299999ミリ秒で時間切れ',
    guard: 'if (took < limitNs || took > upperNs)',
    replacement: 'if (took > upperNs) /* 人工変異: 下限を検査しない */', code: 'REQ5_TIMEOUT_OUT_OF_BOUND', verdict: 'FAIL',
  },
  {
    name: '終了通知の欠測を終了済みとみなす', test: '正対照: kill要求のみで終了通知なし',
    guard: "if (!e) blocked('CHILD_EXIT_MISSING');",
    replacement: 'if (!e) { /* 人工変異: 欠測でも lateApplied:false を作る */ }', code: 'REQ5_CHILD_EXIT_MISSING', verdict: 'BLOCKED',
  },
  {
    name: '再読込ハッシュを照合しない', test: '正対照: 読込ハッシュ差替え',
    guard: "if (r.loadedHash !== s.stateHash) fail('RELOAD_HASH_MISMATCH');",
    replacement: '/* 人工変異: 読込ハッシュを見ない */', code: 'REQ5_RELOAD_HASH_MISMATCH', verdict: 'FAIL',
  },
  {
    name: '人工時間倍率の実測宣言を受け付ける', test: '正対照: 人工時間倍率を実測と宣言',
    guard: "if (input.clock.kind !== 'synthetic' || input.clock.realTimeMeasured !== false) fail('TIME_SCALE_AS_REAL');",
    replacement: "if (input.clock.kind !== 'synthetic') fail('TIME_SCALE_AS_REAL'); /* 人工変異 */",
    code: 'REQ5_TIME_SCALE_AS_REAL', verdict: 'FAIL',
  },
  {
    name: '観測区間の末尾切詰めを検査しない', test: '正対照: 観測区間の末尾切詰め',
    guard: '|| before(w.toNs, worldEnd)) blocked',
    replacement: ') blocked', code: 'REQ5_LATE_WINDOW_TRUNCATED', verdict: 'BLOCKED',
  },
];
for (const mutation of mutations) {
  assert.equal(original.split(mutation.guard).length, 2, `対象検査は一箇所だけ: ${mutation.name}`);
  const broken = original.replace(mutation.guard, mutation.replacement);
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    `--test-name-pattern=^${mutation.test}$`,
    fileURLToPath(new URL('../tests/lifecycle-join.test.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 10000,
    env: { PATH: process.env.PATH, G3_REQ5_JOINER_URL: `data:text/javascript;base64,${Buffer.from(broken).toString('base64')}` },
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
