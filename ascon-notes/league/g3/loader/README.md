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
