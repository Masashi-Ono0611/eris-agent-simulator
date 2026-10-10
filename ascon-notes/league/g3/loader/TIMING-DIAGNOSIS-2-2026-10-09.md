# Timing diagnosis 2 — 2026-10-09

## 後日追記：ユーザーの直接測定による原因確認（2026-10-09）

Mac mini（x86_64、Node v24.13.1）では `Atomics.wait` の要求10/25msに対し
中央値85.8/171.3ms、`performance.now()` busy-spinでは10.01/25.01msだった。
Air（arm64）の `Atomics.wait(10)` は約12.5ms。これはユーザー提供の直接測定であり、
今回の修正作業で再測定した結果ではない。miniで計測用sleepが大幅に超過する原因は
確認済み。OS/Node内部の具体的な原因までは断定しない。

fixtureのsleepを全区間spinに置き換え、受信遅延も同じプリミティブを共有し、
各run開始時に両者の校正と中央値誤差1msの中断条件を追加した。
詳細は [TIMING-HARNESS.md](TIMING-HARNESS.md)。変更後のmini実測は未検証。
以下は修正前のソースと保存成果物による調査記録であり、当時の未確定判断を残す。

## 修正前の調査記録

結論：最有力は **fixture の `Atomics.wait` を含む worker 内滞在時間の大幅な超過（待機からの復帰・再スケジュールの遅延）**。指定 dwell `d` は実測滞在時間ではない。既存 JSON は、deadline が短縮されたという説明より、worker 内で既に時間を費やしている説明を支持する。ただし `Atomics.wait` と末尾ループの区間別記録がないので、待機 API・OS スケジューラ・worker の停止時間のどれが原因かは **undetermined**。特定の Node/V8/macOS の不具合や一定倍率の時間伸長とは断定しない。

## 対象と数値の出典

- `explore2.json` は `/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer/3fa0e378-4bdf-4ccc-9162-233272c6689c/scratchpad/mini-controls/explore2.json` を指す。以下の実験数値は Python 標準ライブラリの `json.loads` でこの JSON から直接転記した。再計測・新しい統計計算はしていない。
- コード引用の `L/` は `ascon-notes/league/g3/loader/`、`R/` は `example/agents/runtime/`。行番号は今回読んだ作業ツリーのもの。
- 状態 `rejected`、mode `exploration`、T = 100 ms、stockDefaultTimeoutMs = 5000 ms。`explore2.json:3-9`, `explore2.json:357535`。
- warm-up W = 5、unit あたり計測 N = 40、各点・各 arm の process 数 = 4。両 arm は probe=true、人工 delayMs はそれぞれ 0 / 0。stock 対 probe の比較ではない。`explore2.json:6-32`。
- warm fixed cost（d=0 の decide wall 中央値）A = 0.7778205000000185 ms、B = 0.7246739999999932 ms。以前の cold-path 値の原記録は今回未読であり、その値をここから再検証していない。`explore2.json:354998-355001`; 集計定義 `L/measure-timing.mjs:93-98`。

| arm | transition min dwell ms | max dwell ms | width ms |
| --- | ---: | ---: | ---: |
| A | 10.592592592592592 | 27.5 | 16.90740740740741 |
| B | 10.601503759398497 | 19.230769230769234 | 8.629265471370736 |

上限 10 ms、rejected=true、理由 `too blurred to detect a 3 ms shift`。出典 `explore2.json:355002-355019`。transition は隣接点を線形補間した timeout fraction の帯の包絡であり、個々の timeout 発火時刻ではない（`L/timing-sweep.mjs:11-41`）。

| 指定 d ms | arm | timeout / n | timeout fraction | decide wall median ms（成功・timeout 混在） | 成功 fixture elapsed median ms | 出典 |
| ---: | --- | --- | ---: | ---: | ---: | --- |
| 0 | A | 0/160 | 0 | 0.7778205000000185 | 0.0007620000000088112 | `explore2.json:353432` の当該点 |
| 0 | B | 0/160 | 0 | 0.7246739999999932 | 0.0007164999999531574 | `explore2.json:353432` の当該点 |
| 5 | A | 0/160 | 0 | 22.594135499999993 | 20.99619400000006 | `explore2.json:353500` の当該点 |
| 5 | B | 0/160 | 0 | 22.378191499999957 | 21.045420499999977 | `explore2.json:353500` の当該点 |
| 10 | A | 0/160 | 0 | 69.07876900000008 | 67.43857750000006 | `explore2.json:353568` の当該点 |
| 10 | B | 0/160 | 0 | 69.05751200000009 | 67.52723750000007 | `explore2.json:353568` の当該点 |
| 15 | A | 135/160 | 0.84375 | 105.00584250000065 | 28.9245549999996 | `explore2.json:353636` の当該点 |
| 15 | B | 133/160 | 0.83125 | 105.32411549999938 | 50.249079000000165 | `explore2.json:353636` の当該点 |
| 20 | A | 136/160 | 0.85 | 105.1768949999996 | 36.79004400000122 | `explore2.json:353704` の当該点 |
| 20 | B | 146/160 | 0.9125 | 105.1461594999995 | 29.91055349999965 | `explore2.json:353704` の当該点 |
| 25 | A | 140/160 | 0.875 | 105.20823799999971 | 41.28053799999998 | `explore2.json:353772` の当該点 |
| 25 | B | 145/160 | 0.90625 | 105.15003600000091 | 36.24446199999875 | `explore2.json:353772` の当該点 |

この表で重要なのは timeout のない点でも fixture 内 elapsed が指定 d を大幅に超えること。fixture elapsed は worker 自身の `performance.now()` 差であり、parent の受信 listener の時間を含まない（`L/timing-fixture.mjs:7-10`）。成功標本だけの統計なので、timeout が増える点の fixture 中央値を全試行の中央値と読まない。timeout 時の `fixtureElapsedMs` は null のまま（`L/timing-unit.mjs:18-35`; 集計 `L/measure-timing.mjs:79-83`）。wall の中央値同士の差を IPC 時間の実測値とも扱わない。

## 仮説ごとの判定

### (1) dwell の実装・倍率・per-step 対 total

**confirmed：単一 decide 内で Atomics.wait と末尾 busy loop。refuted：この経路での倍率変換・step ごとの dwell 加算。**

`timingDurationMs` をそのまま d とし、開始時刻を一度採る。d がコード中の `2` を超える場合 `Atomics.wait(sleeper, 0, 0, d - 2)` を一度実行し、続いて同じ開始時刻からの経過が d 未満の間だけループする。sleep 後に別途 d を加算しない。コメントの「final 2ms」は厳密な実測上限の保証ではなく、復帰が遅ければループを素通りする（`L/timing-fixture.mjs:3-10`）。これは一決定の目標総滞在時間であり、warm-up 回数や N を掛ける処理はない（`L/timing-unit.mjs:17-22,60-67`）。

`G3_UNIT_TIME_SCALE` はタイミング経路では **not found**。検索した別 fixture `ascon-notes/league/g3/fake-claude.py:18-24,31` には Python sleep の倍率として存在するが、今回の module fixture では使われない。arm の子環境は明示列挙で、toolchain の転送対象も限定される（`L/measure-timing.mjs:120-129`; `L/probe-toolchain.mjs:9-11`）。`Atomics.wait` 自体を置換するコードも読んだ preload 群では **not found**。実行時の native 待機実装・時計の正確性は未検証。

### (2) T の渡し方・単位・環境変数・clamp

**confirmed：constructor 第4引数の timeoutMs に設定 T を渡す。refuted：ms/s の変換ミス、stock 既定への取り違え、読んだ runner 内の min/max clamp。**

探索点は `timeoutMs + minOffsetMs + i * stepMs` で生成し、送る `durationMs` はそのまま。探索では command.timeoutMs に config.timeoutMs を設定する（`L/measure-timing.mjs:227-239,295-324`）。受け側は `new StrategyRunner(source, context, () => {}, command.timeoutMs, 15000)`。最後の引数は別の startup timeout（`L/timing-arm.mjs:28-30`; `R/strategyRunner.ts:53-59,104-112`）。

runner は `setTimeout(..., this.timeoutMs)` と `deadline: performance.now() + this.timeoutMs` に直接使う（`R/strategyRunner.ts:190-205`）。秒換算、乗除算、decision timeout の最小・最大 clamp、`ERIS_DECIDE_TIMEOUT` の読取りは当該ファイルで **not found**。`decideTimeout.ts` の standalone helper も引数をそのまま setTimeout に渡す（`R/decideTimeout.ts:39-49`）。backoff の `Math.min` は失敗後に飛ばすブロック数で、期限の clamp ではない（`R/strategyRunner.ts:219-224`）。

JSON の stockDefaultTimeoutMs は起動時に報告された既定定数であり、有効 T の置換ではない（`L/timing-arm.mjs:17`; `L/measure-timing.mjs:317-324`; `R/decideTimeout.ts:8`）。例外文は既定定数を埋め込むため実際の設定 T を示さない。分類は wall 時間でも例外文字列でもなく `DecideTimeoutError` の型（`R/decideTimeout.ts:28-33`; `L/timing-arm.mjs:30`; `L/timing-unit.mjs:23-30`）。

### (3) warm-up / replacement / re-warm が次の期限を消費するか

**refuted：前の決定の残り deadline を継承する、ready 前から次の measured deadline が進む、という機構。undetermined：再起動の間接的な負荷・スケジューラ状態の影響。**

初回は start を await し、ready 後の start も await、続いて d=0 の W 回を順次 await する。直前の measured decide が timeout なら W 回の re-warm を await してから次の計測に入る。warm-up が timeout すれば中断する（`L/timing-unit.mjs:39-67`）。各 decide は `await this.start()` が終わってから新しい timer と deadline を作る。start は `instance.ready` を await する（`R/strategyRunner.ts:67-81,185-205`）。

失敗した decide は discard と worker.terminate を await してから呼出元に例外を返す。前の pending timer も破棄時に解除される（`R/strategyRunner.ts:117-125,214-244`）。このため timeout の wallMs は期限だけでなく worker 終了や probe の後処理も含み得る（`L/timing-unit.mjs:20-27`）。re-warm の cold 起動時間は re-warm 自身の wall に入り得るが、次の measured timer の予算を直接減らさない。再起動に伴うホスト負荷の持越しは別問題で、既存の集計だけでは定量化できない。

### (4) measured decide に複数 dwell / probe listener の仕事があるか

**refuted：start と decide の両方で dwell、または fixture decide の複数回呼出。confirmed：probe による parent の同期処理。undetermined：それが今回の遷移の主因か。**

fixture の top-level は sleeper の生成のみで、dwell は decide 内だけ（`L/timing-fixture.mjs:3-11`）。worker は module.decide を選び、message ごとに一度 `await decide(observation, ctx)`、その後 result を送る。start は module の読込み・ready 待ちで、fixture decide を実行しない（`R/strategyWorker.ts:29-39,47-85`; `R/strategyRunner.ts:67-81`）。

probe は deadline 設置後の postMessage 前に `worker_post` を同期記録し、stock listener より先に登録した受信 listener でも記録する（`L/probe-loader.mjs:117-133`; `R/strategyRunner.ts:85-94,131-145,190-205`）。writer は openSync/writeSync/closeSync を実行するため期限の余裕を消費し得る（`L/probe-io.mjs:10-23`）。受信時に fixture dwell を再実行する処理は **not found**。readFile/hash は describe や method wrapper / spawn で実行され、受信 listener の fields は生成済み（`L/probe-loader.mjs:72-79,109-132,172-188`）。

人工 delay の preload には parent で result 受信時に spin する機能があるが、delayMs が正の場合だけ有効（`L/timing-delay.mjs:5-19`）。今回の設定と phase 別 delayHits は以下の JSON 転記どおり。両 arm が probe 有効なので、A/B が似ることだけでは probe 共通の干渉を否定できない。ただし parent 処理だけでは、成功時の worker 内 elapsed の増大を直接説明できない。

```json
{
  "A": {
    "warmup": 0,
    "overhead": 0,
    "exploration": 0,
    "boundary": 0
  },
  "B": {
    "warmup": 0,
    "overhead": 0,
    "exploration": 0,
    "boundary": 0
  }
}
```
出典 `explore2.json:357541-357554`。

### (5) worker の spin による parent event-loop starvation

**undetermined：CPU 競合などを介する間接的な starvation。refuted：fixture の同期ループが parent と同じ event loop 上で直接ブロックする説明。**

fixture は Worker 内で実行され、parent の timer/受信処理とはスレッドが別（`R/strategyRunner.ts:84-94,131-145`; `R/strategyWorker.ts:47-73`）。fixture は大半を Atomics.wait に任せる設計で、d 全体を意図的に spin するコードでもない（`L/timing-fixture.mjs:7-9`）。ただしスレッド分離は CPU 競合を排除しない。parent の受信が遅れると、応答ができていても stock が受信時に deadline を検査して timeout にできる（`R/strategyRunner.ts:139-145`）。timer callback の遅延それ自体は deadline の設定値を短縮しない。

この JSON の Node=v24.13.1、tsx=4.23.13、OS=darwin 24.6.0 x64、論理 CPU=12、最大 load1=4.603515625、設定上限=5（`explore2.json:18-19,35-51,357555`）。これらは parent loop の遅延や worker の CPU 時間の測定値ではない。eventLoopDelay・CPU profile・scheduler trace は **not found**。arm の起動は順次 await する構造（`L/measure-timing.mjs:306-340`）。今回、OS の稼働状態は照会していない。

## 最小の確認案（提案のみ・未実行）

同じ Mac mini・同じ toolchain/preload・同じ warm-worker 条件で、まず timeout のない既存の短い dwell 点を一つだけ使う。fixture の開始時刻に加え、`Atomics.wait` の直前・直後と末尾ループ後の worker-local timestamp を返し、wait 区間と loop 区間を分ける。それ以外の fixture・T・warm-up 条件は変えない。

wait 直後の時点で既存 JSON と同程度の超過が現れ、末尾ループの時間が小さければ、最有力の「待機／復帰が実 dwell を膨らませる」を確認できる。wait は短いのに loop 区間が長ければ worker の実行中の停止等へ仮説を移す。どちらも短ければ再現しておらず、この案だけで元の timeout の原因は確定しない。native 待機実装と OS スケジューリングの区別はこの最小確認の範囲外。timeout 標本の区間分解も元 JSON からは復元できない。

## 読んだもの・未検証のもの

- 読取り：ルート AGENTS.md、指定 explore2.json（config / host / raw の先頭例 / summary.exploration / explorationQuality / fixedCostEstimateMs / diagnostics / sourceHashes / delayHits）、L の timing-fixture・unit・arm・options・delay・measure-timing・timing-sweep・probe-loader・probe-io・probe-toolchain・offline-guard、R の strategyRunner・decideTimeout・strategyWorker.mjs/ts・strategyEnv、および G3_UNIT_TIME_SCALE 検索で見つかった fake-claude.py。measure-timing 等は該当箇所を読んだ。全 raw 標本の個別再監査はしていない。
- 読取り・抽出に rg / sed / Python のテキスト・JSON 読取りを使用。この診断 Markdown だけを新規作成。Node scripts、tests、typecheck、計測、ネットワーク、git 操作は実行していない。
- JSON の sourceHashes は確認したが、今回の作業ツリーとのハッシュ照合は未実施。測定時と現行コードの完全一致は未検証。strategyWorker.ts/mjs と strategyEnv.ts の個別 hash はその sourceHashes では **not found**（`explore2.json:355073-355088`; 保存対象 `L/measure-timing.mjs:288-292`）。
- wait/loop 区間別時間、worker 受信開始時刻、timeout 時の fixture 完了時刻、parent event-loop 遅延の専用記録は指定 JSON で **not found**。実測時計と native Atomics.wait の動作は未検証。生 probe JSONL は今回未読であり、harness は finally で scratch を削除するコードになっている（`L/measure-timing.mjs:369-372`）。
- 結論は既存の観測値と現行コードによる診断であり、修正・原因の再現確認・探索の受理を報告するものではない。
