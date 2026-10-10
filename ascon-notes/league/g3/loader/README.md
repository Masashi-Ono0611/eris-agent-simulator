# StrategyRunner 計測 preload — オフライン試作

これは G3-LOADER-FEASIBILITY-2026-10-08.md §8 の最小工程を試す、計測専用の
**オフライン prototype**。対象はこの worktree の **stock StrategyRunner のみ**。
**stock botMain の観測ではない。live run ではない。提出 artifact ではない。
G3 evidence ではなく、G3 PASS や要件充足を主張しない。**

既存ファイルを編集せず、preload がメモリ上の prototype と Worker constructor を包む。
ディスクの stock bytes が同じでも、評価する実効構成・起動引数・時間は異なる。
bot.ts の prelude 順序、botMain 内部の既存 instance、提出環境への適用は未検証。

## 固定した対象

- Node **v24.13.0**、tsx **4.23.13**。異なる版は `G3_TOOLCHAIN_MISMATCH`。
- ローカル git HEAD: `f9a3c0a061267177044d0a7f2e98fc0b9703cf81`。
- canonical URL の `example/agents/runtime/strategyRunner.ts` を import する。
  stock の `strategyWorker.mjs` → `tsx/esm/api.register()` → `strategyWorker.ts` を使う。
- fixture は新規の import なし module、null/noop executor、submit/return executor、
  例外 executor。Sender を作らず、submit は stock の返す配列を比較するだけ。
  チェーン・モデルへの呼出はない。

## 計測方式と値の意味

`probe-loader.mjs` は stock の元 method を各 wrapper 呼出につき一度だけ呼ぶ。
`setSource` は同期関数のまま、元の返値・例外を保つ。`start/decide/close` は
Promise の返値・例外を保つが、Promise identity や microtask の時間的同一性は主張しない。
stock の `spawn`、TypeScript private property の `source/instance` が現在の tsx 変換で
アクセス可能なことに依存する。汎用・将来互換の instrumentation API ではない。

JSONL の出力先は親プロセスの `G3_PROBE_JSONL`。専用の新規ファイルを使う。
各記録は固定 schema のフィールドだけを持ち、env、パス、RPC URL/header、wallet、
source 本文、observation/context、action、log 本文、例外本文・stack を保存しない。
stdout に記録を流さず、失敗コードだけを例外として通知する。

| 記録 | 意味 |
| --- | --- |
| `runner_seen` | 最初に観測した stock instance、初期 source descriptor の kind/hash/version |
| `setSource_enter/exit` | 同期境界の callId、source SHA-256、version、成功/例外。exit 内の before/after UTC・単調時計は元関数を直接挟む区間 |
| `start/decide/close_enter/exit` | 論理 callId と決定結果の成否。decide には独立した decisionId |
| `worker_create` | 実生成した generation と、その時点の source hash/version |
| `worker_attach` | 当該 Worker の JavaScript realm で preload が実行され、記録に成功した証拠 |
| `worker_post` | 論理 decisionId と stock workerDecisionId の結合 |
| `worker_ready/result/submit/log/error` | 親側での受信。stock が採用したことや worker callback 実行時刻を意味しない |
| `worker_error_event/exit` | Worker の error event / 実 exit code。close 呼出だけを終了証拠にしない |
| `probe_complete` | 明示 finish 時点で全 generation 登録済み・exit 済み、観測 call が完了 |

stock Runner は version を持たない。fixture が `bindSourceVersion(descriptor, version)`
で指定した値を `versionOrigin: "fixture-explicit"` として記録する。
**botMain の active/highestVersion/runningVersion を読んだ値ではない。**
hash を version とみなさない。同じ hash の version 1/2、新たな version 3 での元 module
再選択、選択されたまま未実行の version 5 を区別する。
module hash は entry file の実 byte のみ。依存 module graph の manifest ではない。
executor hash は受け取った body の UTF-8 bytes であり、VM wrapper の hash ではない。

明示 `start()` は判断を dispatch しないので decisionId は null。
`decide()` 内部の start は同じ論理 decisionId を持つ。backoff / closed の decide も
入口・出口を記録し、dispatch されなかったものに workerDecisionId を捏造しない。
世代内の最初の `worker_post` から初回 dispatch を求められるが、worker callback 入口は
今回の対象外。判断中に setSource された旧判断は生成時の version のまま受信記録を残す。

Worker は起動引数から preload を継承する。補助 workerData に sink path と共有メモリを
追加し、登録記録の書込完了後にその世代の登録印を立てる。stock の通信路には追加
message を入れない。親は ready 等の受信時と exit/finish 時に登録印を検査する。
これは bootstrap 到達の検査であり、read transcript や無効化後の submit 試行は観測しない。

単一プロセス内の全 thread が専用ファイルへ同期 O_APPEND の一回の write で記録する。
共有連番 `seq` は write 前の採番順。thread 間で物理的な行順が前後する可能性があるため、
監査では seq 順へ並べる。連番・call 終端・世代登録・exit・完了印の欠落は成功としない。
fsync、電源断、SIGKILL、複数プロセスの同時 append、ログ改竄への耐性は証明していない。
同じ path に過去のログが残っていても、書込みは追記モードで開くため古い行は消えない。これを成功ログと混ぜない保証はなく、連番の欠落・重複を監査が検出した場合にだけ気づける。この点は未テスト。run ごとに新しい path を使うこと。

書込例外・short write は `G3_WRITE_FAILED` に統一して共有 failure flag を立てる。
失敗した計測 run は stock 動作同一性の対象外。記録失敗は共有 failure flag と `process.exitCode=1` で示すが、
probe の例外は呼出側へ投げられる。stock 側が decide の例外を捕捉して継続した場合、実行は続き得る。
後から明示的に exit code を上書きされても失敗の印は消える。したがって「fail closed」は
監査（`auditRecords`）を必ず走らせた場合にだけ成立する。stock エラーの内容は返却時には保存するが記録へはコピーしない。
終了前に `await runner.close(); finishProbe();` を呼び、JSONL を `auditRecords` で検査する。
完了印がない run は未完了であり、PASS と扱わない。

## 実行と検査

リポジトリ root で実行した検証コマンド:

```sh
node --import tsx --test ascon-notes/league/g3/tests/loader-probe.test.mjs
npm run typecheck
git diff --check
```

最終実行結果は **13 tests / 13 pass / 0 fail / 0 skip**（約11.33秒、exit 0）。
`npm run typecheck` は exit 0。`git diff --check` は exit 0。
今回の変更前にも全10件を実行し、10 pass / 0 fail を確認した。
従来の10件では下記2 guard の削除を検知できなかったため、独立した control を追加した。

手動で JSONL を残す場合の起動例（この表記のコマンド自体は未実行。テスト内では同じ
preload 構成を一時 sink と制限した env で実行済み）。出力先は未使用の path を指定する。

```sh
G3_PROBE_JSONL="$PWD/ascon-notes/league/g3/loader/probe-run.jsonl" \
G3_TEST_WITH_PROBE=1 \
node --import tsx \
  --import ./ascon-notes/league/g3/loader/offline-guard.mjs \
  --import ./ascon-notes/league/g3/loader/probe-loader.mjs \
  ascon-notes/league/g3/loader/run-fixtures.mjs normal
```

テストは child process ごとに新規 sink を作り、終了後に削除する。新規ファイルのみに
書き込み、両比較 arm の env を最小化して合成 canary 値を渡す。
`offline-guard.mjs` は両 arm と worker でネットワーク入口・子プロセス呼出を拒否する。
これは fixture の事故防止であり、悪意ある任意コードを隔離する sandbox ではない。
テスト harness 自身は固定 Node の fixture process と read-only git を起動する。

`call-witness.mjs` は probe より先に stock method の直外へ独立したカウンタを設置する。
probe の自己申告件数だけに依存せず、loader あり／なしで元関数の呼出数と実結果を比較する。
witness なしの直接 preload 比較も別に行う。通常 fixture の期待値は
setSource=6、start=13、decide=13、close=1、spawn/create=8、post=11、result=7、submit=3、exit=8。

positive control は非ゼロ終了だけでは通さず、以下のコードや branch の発火を検査する。

| control | 必須の発火証拠 |
| --- | --- |
| 第2世代だけ preload を除外 | 第1世代 attach あり、第2世代 create あり・attach なし、`G3_WORKER_GAP` と generation=2 |
| query URL で preload を再評価 | `G3_DOUBLE_REGISTRATION`、登録成功は1回だけ |
| query URL で distinct stock Runner class を生成 | class identity 不一致を先に assert、guard record `G3_WRONG_INSTANCE`、発火箇所 `worker-constructor`、Worker 作成なし |
| subclass の継承した `setSource()` を呼ぶ | guard record `G3_WRONG_INSTANCE`、発火箇所 `state`、runner/Worker 登録なし |
| canonical stock instance の初期 source を version 未登録にする | guard record `G3_VERSION_UNBOUND`、発火箇所 `describe`、runner/Worker 登録なし |
| canonical stock instance に version 未登録 source を `setSource()` する | guard record `G3_VERSION_UNBOUND`、発火箇所 `describe`、初期 runner の登録のみ、setSource/Worker 記録なし |
| 書込済み sink を directory に置換 | `G3_WRITE_FAILED` を捕捉し専用 exit 23、完了印なし |
| attach 記録除去 / 完了行切詰め | `G3_WORKER_GAP` / `G3_INCOMPLETE` |
| stock エラー・backoff・closed | 各結果・エラー内容、未 dispatch の decisionId を assert |
| redaction | log / submit / worker error が実際に発生した上で、合成秘密文字列と未許可 key がない |
| offline guard | 親の network/child、Worker の fetch 拒否が実際に発火 |

`state()` の prototype guard と Worker constructor の guard は冗長ではない。
distinct module copy は patched prototype を通らず、Worker constructor 側で止まる。
subclass は継承 wrapper から `state()` に到達する。今回の `setSource()` control は
Worker を生成しないため、constructor guard が代わりに発火する余地がない。
`describe()` の version guard も canonical stock instance から到達できる。
初期 source と差替え source の両経路を検査し、いずれも Worker 作成前に止まる。
新しい3 control は witness あり／なしで実行し、probe なしでは同じ操作が成功することも検査する。

発火箇所の判定は test fixture 内だけで行う。捕捉した例外 stack の `fail()` の直後の
frame を読み、固定 allowlist の `describe` / `state` / `worker-constructor` だけを
stdout に出す。親テストはその code/site と、JSONL の唯一の guard record の code を照合し、
記録全体の event 列・guard の許可 key・合成秘密値の非出力も検査する。
stack、path、例外本文を出力・記録しない。固定 Node/tsx の frame 表記への依存はある。
production loader と JSONL schema は変更していない。

変異テストはリポジトリ内の `ascon-notes/league/g3/loader/mutation-check.py` で再現できる（リポジトリ直下で `python3 ascon-notes/league/g3/loader/mutation-check.py`）。
3つのガードを個別に外し、いずれも suite が red になること、復元後に元の byte と一致し
suite が 13 pass になることを確認する。3 mutant で全て red だったという結果であり、
ガード一般の網羅性や「等価 mutant が存在しない」ことの証明ではない。

保護対象 `example/agents/runtime/**`、`sdk/**`、`core/**` と `example/agents/lib/**`
の tracked **178 ファイル**を SHA-256 で git HEAD と比較する。root の `lib/` は存在しない。
加えて全 tracked file の `git diff HEAD --name-only` が空であることを assert する。
新規未追跡ファイルは `git diff --check` だけでは対象外なので、別途
`git diff --no-index --check /dev/null <new-file>` でも空白検査する。

## 既知の限界（独立レビューで指摘され、未対応のもの）

- **時間干渉**: probe の同期 open/write/close と hash は message listener 内で、stock の deadline 判定より前に走り得る。
  deadline 近傍の結果を timeout に変え得る。deadline 境界のテストは無い（テストの timeout は 3000ms）。
- 全 start/decide/close で hash と `readFileSync` を行う。module の hash は読込時でなく呼出時（TOCTOU）。
- sink path と共有メモリを strategy の `workerData` に追加している。stock が渡すのは source と context だけなので、
  戦略コードから見える・触れる状態が増える。
- timeout した decision には終端記録が無く、監査は `G3_TERMINAL_GAP` で失敗する。`python` kind は未対応で fail closed。
- 秘密の非出力は JSONL だけを検査しており、stdout/stderr は検査していない。setSource と close の throw 経路は未テスト。

## この試作で未検証のもの

時間干渉は大規模・deadline 近傍では測定していない。同期 hash/write、listener 順序、
Promise wrapper、Worker の追加データは遅延や実効構成を変える。有限の非送信 fixture の
一致は、全 branch、全 seed、実 5 秒境界、取引・nonce・fee・receipt の一致を証明しない。

**要件4・要件5は未着手のまま。** 取引境界の全経済値、実300秒、子終了、遅着なし、
epoch 持越し・復帰、自然改訂、botMain version closure、全 read/submit attempt、
提出 ZIP / live run 同等性、現行オンライン規約は検証していない。
ネットワーク、Docker、Anvil、backtest、SSH、モデル呼出、commit/push は行わない。
既存 G3 監査器・manifest・要件の判定は変更しない。

## 要件2の人工記録結合器（2026-10-11追加）

[`source-join.mjs`](source-join.mjs) は既存の記録形式を受け取る純粋な後処理関数
`joinSourceApplications({schema: 1, provenance: "SYNTHETIC", records})` を提供する。
[`SYNTHETIC-source-join.mjs`](../tests/fixtures/SYNTHETIC-source-join.mjs) は人工入力の生成器。
本機能からローダー、実行器、ネットワークを起動しない。

同期呼出し前後の時刻区間、SHA-256（Secure Hash Algorithm 256-bit、内容ハッシュ）、
版、実行器、生成世代を結び、`firstDecisionId`（最初の判断の識別子）を出す。
この識別子の根拠は親の `worker_post` のみで、実worker内の判断開始を観測した値ではない。
`firstDecisionBasis: "parent-worker_post"` と `workerExecutionVerified: false` を明記する。
版は人工入力の明示指定。元モジュールのハッシュ範囲は入口ファイルのみ。
選択後に判断がない版、同版の再選択で対象が曖昧な場合、記録欠落は `BLOCKED`。
時刻逆転・誤結合は `FAIL`。正常な人工記録だけ `CONTRACT_OK_ON_SYNTHETIC` とし、
常に `g3Status: "BLOCKED"`、`liveRecorderVerified: false` を出す。

```sh
node --test ascon-notes/league/g3/tests/source-join.test.mjs
node ascon-notes/league/g3/loader/source-join-mutation.mjs
```

変異検査は時刻逆転条件を除去したコピーで、正対照テストがexit 1になることを確認する。
元の実装ファイルには書かない。今回の検査は人工記録のみで、既存ローダーを起動した
記録との結合は未検証。`callBlock`（改訂呼出し時のブロック番号）は生成せず、
G3監査器への直接接続も行わない。テスト一覧、要件2〜5の期限と未完了は
[期限計画](../../G3-REQ25-PLAN-2026-10-11.md) に記載した。

## 要件3の人工判断結合器（2026-10-11追加）

[`decision-join.mjs`](decision-join.mjs) の純粋関数 `joinDecisions(input)` は、
[期限計画の要件3(a)](../../G3-REQ25-PLAN-2026-10-11.md#要件3-全判断世代読出し履歴returnsubmit)
にある人工契約を検査する。計画内の候補名 `decision-contract.mjs` に対応する実装。
SYNTHETIC（人工）専用で、実行環境・別スレッドの作業実行器（worker）を起動しない。
既存 `source-join` の純粋関数・固定診断コード・正対照・メモリ上の変異検査という構成を踏襲する。
高水準の読出し・試行を表す新しい人工形式なので、既存ローダーの記録をそのまま入力できない。
既存の `source-join` と記録監査器は変更していない。

入力は次の構造を持つ。`expected` は記録列から算出しない独立した人工期待集合。
[`SYNTHETIC-decision-join.mjs`](../tests/fixtures/SYNTHETIC-decision-join.mjs) では
期待値を別に明示し、記録を削除する正対照でも期待値を残す。

```js
{
  schema: 1,
  provenance: 'SYNTHETIC',
  clockBasis: 'synthetic-single-clock',
  expected: { starts: [], finishes: [], reads: [], actions: [] },
  records: []
}
```

上記は構造の説明であり、空の開始集合・記録では `BLOCKED` となる。
4つの期待配列はすべて明示が必要。読出しや出力のゼロ件も明示的な空配列で表し、
欠落を空配列・ゼロ・安全値へ補完しない。

| 入力 | 照合する内容 |
| --- | --- |
| `expected.starts` | 判断識別子、実行器、生成世代、世代内判断識別子、版、送信有無。v0（初期版）とnoop（取引しない判断）も含める |
| `expected.finishes` | 独立した完了識別子集合と、`noop` / `return` / `throw` / `not_dispatched`（未送信）の終端種別 |
| `expected.reads` | 判断ごとの読出し識別子、呼出順番号、解決順番号、方法、引数ハッシュ、整数または例外の結果形式 |
| `expected.actions` | 判断・経路（`return` または `ctx.submit`）・経路内順番、内容ハッシュ、通常／遅着、親の処理（送信済み／破棄／未送信） |
| `records` | 世代生成、判断開始、親からの送信、worker開始、読出し呼出し／解決、出力試行／親処理、worker完了、判断完了のイベント列 |

各イベントには共有連番 `seq`、`utc`（UTC: Coordinated Universal Time、協定世界時）、
`monoNs`（単調時計のナノ秒文字列）を要求する。物理行順は共有連番で整列する。
この人工形式は単一時計を宣言し、単調時計と協定世界時を**別々に**逆転検査する。
単調時計が正常でも協定世界時だけの逆転を `FAIL / REQ3_TIME_ORDER` にする。
同時刻は許すが、開始→送信→worker開始→worker完了→判断完了の連番順は検査する。
この時計条件を、実スレッド間の計測へ一般化しない。

読出方法は `getBalance` と `getAllowance` の人工契約に限定する。
引数は `{encoding: 'sha256', sha256: ...}`。
SHA-256（Secure Hash Algorithm 256-bit、256ビットの内容ハッシュ）の一致を比較し、
引数本文は返さない。整数は `{type: 'integer', decimal: '900719925474099312345'}` のように
十進文字列で桁を保つ。例外は `{type: 'exception', name: 'Error', messageSha256: ...}` とし、
名前は `Error` / `TypeError` / `RangeError` に限定する。例外本文や呼出履歴本文は返さない。
呼出順と解決順を別々に保存・検査するため、並列読出しの解決順で呼出番号を付け替えると失敗する。
他の結果型・読出方法はこの形式の対象外であり、不明な値を成功へ変換しない。

同じ内容ハッシュの返却と送信試行も、経路と経路内順番で別々に保持する。
遅着submitはworker完了・判断完了より後の試行として表し、親の破棄まで照合する。
`sent` は人工の親処理ラベルであり、実取引の送信や採掘の証明ではない。
通信に出ない試行の削除、親の破棄を送信済みへ変更、旧世代結果の付替えは `FAIL`。
独立期待集合にある出力試行の消失も人工契約の確定矛盾として `FAIL / REQ3_ACTION_MISSING`。
開始・完了・世代生成・読出し・親処理の欠落は `BLOCKED`。
生成世代を持たない未送信判断は `generation` と `workerDecisionId` を明示的な `null` にし、
worker開始・完了時刻を作らない。

出力の判定語は `CONTRACT_OK_ON_SYNTHETIC` / `BLOCKED` / `FAIL` の3種類だけ。
人工由来の指定がなければ内容検査に進まず `BLOCKED`。
常に `g3Status: 'BLOCKED'`、`liveRecorderVerified: false` を返す。
正常時だけ `decisions` に判断・workerの開始／完了時刻、読出し履歴、経路別試行を返し、
欠落や矛盾があれば空の `decisions` と固定の診断コードを返す。
入力を変更せず、余分な本文・秘密フィールドは入れ子も含めて転記しない。

```sh
node --test ascon-notes/league/g3/tests/decision-join.test.mjs ascon-notes/league/g3/tests/source-join.test.mjs
node ascon-notes/league/g3/loader/decision-join-mutation.mjs
bun run typecheck
bun test ./ascon-notes/league/g3/tests/decision-join.test.mjs ./ascon-notes/league/g3/tests/source-join.test.mjs
git diff --check
```

テストを先に追加し、実装未存在の `ERR_MODULE_NOT_FOUND`、終了コード1を確認してから実装した。
Codex実行環境のNode `v26.8.2`（別途、Claudeが再実行したNode `v24.13.0`でも同じ結果）で新規165件と既存31件、計196件が成功、失敗・省略は0件。
変異検査は協定世界時逆転・世代帰属の検査を個別に削除し、さらに読出し期待集合の欠測を
空配列へ補完するコピーを実行する。3つとも対応する正対照が1件失敗し、子テストは終了コード1。
変異検査自身はその検出を確認して終了コード0。元ファイルには書き込まない。

未検証: 実workerの全判断・省略・読出し・送信試行の採取、独立期待集合の実際の生成元、
標準実行環境の記録との接続、実チェーン、経済値、実時間制限、子終了、状態持越し・復帰。
引数・出力ハッシュの採取元や内容の真正性も認定しない。
実観測を含む要件3全体とG3（Gate 3、自己改訂の実チェーン受入判定）は `BLOCKED` のまま。
この追加は計画の要件3(a)だけを実装した記録であり、既存計画書の過去の実行記録は更新していない。

## 要件4の人工取引境界結合器（2026-10-11追加）

[`boundary-join.mjs`](boundary-join.mjs) の純粋関数 `joinBoundaries(input)` は、
要件4（実取引境界の残高・支出先別許可額・予約・ガス費と予備・receipt（採掘後の実行結果）・
events/blocks との対応）のうち、既存の事後結合器 [`posthoc-join/join.py`](../posthoc-join/join.py)
が `not_evaluated` とする J11（残高・支出許可額）、J12（予約・ガス）、J05 の境界〜取引ハッシュ部分、
J09 と J14 の各1点だけを人工入力で検査する。差分の整理は
[要件4の差分表](../../G3-REQ4-GAP-2026-10-11.md)。J06〜J08 は再計算せず、取引ごとに
既存結合器の判定を投影した `posthoc: {J06, J07, J08}` を受け取り、`PASS` 以外を引き継ぐ。
出力試行は要件3人工結合器の出力（判断識別子・経路・経路内順番・親処理）の投影として受け取る。
どちらも人工入力で宣言された値で、既存結合器を実行した結果ではない。実際の `join.py` は
receipt 全文を読めず J06 を常に `BLOCKED` とするため、その実出力を渡すと必ず `BLOCKED` になる。

```js
{
  schema: 1, provenance: 'SYNTHETIC', worldId: '...', owner: '0x...',
  attempts: [{ decisionId, path, ordinal, disposition }],           // sent / not_sent / discarded
  transactions: [{ hash, worldId, origin, blockNumber, posthoc: { J06, J07, J08 } }],
  boundaries: [{ boundaryId, attempt, outcome, observedAtBlock,     // outcome: sent / not_sent
    legs: [{ token, spender, amount }],
    txs: [{ hash, from, nonce, gasLimit, maxFeePerGasWei }],
    evidence: [{ kind, owner, token?, spender?, value, availability, boundaryId, resolvedBlockNumber }] }],
}
```

`kind` は `balance` / `allowance` / `reservation` / `ethBalance` / `pendingGas` / `gasReserve`。
`availability` が `observed` 以外（`derived` 導出値、`missing` 欠測、`error` 読取失敗、`ambiguous` 曖昧）、
別の境界・別のブロック断面・別 spender・別保有者の値は `BLOCKED`。値は十進文字列で BigInt 計算し、
欠測を0にしない。最大ガス費は署名済み取引欄から `Σ gasLimit × maxFeePerGasWei` として導出し、
自己申告値を受け取らない。同じ送信元・nonce（送信者の取引連番）の別ハッシュは合算せず `BLOCKED`。
送信済み境界での残高（予約控除後）・spender 別許可額・ガス予備の不足は `FAIL`。
未送信（送信前拒否）境界の超過は拒否理由になり得るため矛盾にしない。

判定語は `CONTRACT_OK_ON_SYNTHETIC` / `BLOCKED` / `FAIL` のみ。常に `g3Status: 'BLOCKED'`、
`liveRecorderVerified: false`。人工由来の指定がなければ内容を見ずに `BLOCKED`。入力を変更せず、
世界識別子や余分な本文・秘密フィールドを出力に転記しない。

```sh
node --test ascon-notes/league/g3/tests/boundary-join.test.mjs ascon-notes/league/g3/tests/source-join.test.mjs ascon-notes/league/g3/tests/decision-join.test.mjs
node ascon-notes/league/g3/loader/boundary-join-mutation.mjs
git diff --check
```

テストと人工入力 [`SYNTHETIC-boundary-join.mjs`](../tests/fixtures/SYNTHETIC-boundary-join.mjs) を先に追加し、
実装未存在で `ERR_MODULE_NOT_FOUND`、終了コード1を確認してから実装した。Node `v24.13.0` で
新規106件と既存の要件2・要件3の計196件、合計302件が成功、失敗・省略0件。正対照は検査ごとに
固定の診断コードの発火を確かめ、負対照（観測済みの0、境界ちょうどの残高、未送信境界の超過、
物理順の変更）は誤検出しないことを確かめる。変異検査は、残高超過検査の削除、許可額照合から
spender を外す、欠測値の0補完、既存判定の `BLOCKED` を引き継がない、同 nonce の合算、の5つを
個別にメモリ上で適用し、各々対応する正対照1件が失敗（子テスト終了コード1、期待判定に対し
実際は `CONTRACT_OK_ON_SYNTHETIC`）することを確認した。元ファイルには書き込まない。
既存の要件2・要件3の変異検査と事後結合器の53件のテストも再実行し成功した（事後結合器は無変更）。

未検証: 実際の送信直前の状態・送信待ち行列・Worker 内で捨てた試行の値の採取、予約・ガス予備の
実際の生成元、receipt 全文、実チェーン実体の同定、通信記録（P01〜P07）、全試行の件数（J13）、
既存結合器の実出力との接続、型検査。要件4全体と G3 は `BLOCKED` のまま。
