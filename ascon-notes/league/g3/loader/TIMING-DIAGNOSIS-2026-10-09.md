# Timing 対照実験の読取診断（2026-10-09）

結論: positive の格子は全点で両 arm が timeout に飽和しており、boundary では B の result 受信 delay が発火していない。積分差がゼロなのは、この格子で追加干渉を観測できなかったことを示す。stock deadline が受信 delay を除外する証拠ではない。negative も積分差の許容値違反ではなく、成功側を含まない格子を拒否する共通 assertion で失敗した。

以下は既存 JSON・Markdown 内の TAP 抜粋とローカルコードの静的照合。Node、npm、typecheck、テスト、計測、外部ネットワークは実行していない。変更は本ファイルの新規作成のみ。数表の値は Python で JSON から直接転記し、派生値は「再集計」と明記した。閾値はユーザー指定およびテストコードの定数であり実測値ではない。

## 引用元と実行物の同一性

- `controls.json` = `/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer/3fa0e378-4bdf-4ccc-9162-233272c6689c/scratchpad/mini-controls/controls.json`。
- `controls.md` = `/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer/3fa0e378-4bdf-4ccc-9162-233272c6689c/scratchpad/mini-controls/controls.md`。TAP 抜粋はこの Markdown の末尾（`controls.md:76-147`）。同ディレクトリの独立したログファイル: **not found**。
- `measure-timing.mjs` / `timing-delay.mjs` / `timing-arm.mjs` / `timing-fixture.mjs` / `probe-loader.mjs` / `probe-io.mjs` / `timing-options.mjs` は `ascon-notes/league/g3/loader/` 配下。
- `loader-timing.test.mjs` は `ascon-notes/league/g3/tests/` 配下。`strategyRunner.ts` / `strategyWorker.ts` / `strategyWorker.mjs` は `example/agents/runtime/` 配下。以下の `file:line` はこの対応で引用する。

ホスト: Intel(R) Core(TM) i7-8700B CPU @ 3.20GHz / x64 / 論理 CPU 12。Node v24.13.1、tsx 4.23.13、toolchainOverride=true（`controls.json:31-48`）。実機情報の取得は行っていない。

JSON に保存された全 sourceHashes を、Python のファイル読取と SHA-256 でローカルファイルに照合した。次表は両 control の照合結果。

| JSON の sourceHashes キー | positive | negative |
| --- | --- | --- |
| `measure-timing.mjs` | 一致 | 一致 |
| `timing-options.mjs` | 一致 | 一致 |
| `timing-arm.mjs` | 一致 | 一致 |
| `timing-delay.mjs` | 一致 | 一致 |
| `timing-fixture.mjs` | 一致 | 一致 |
| `probe-loader.mjs` | 一致 | 一致 |
| `probe-toolchain.mjs` | 一致 | 一致 |
| `probe-io.mjs` | 一致 | 一致 |
| `audit-records.mjs` | 一致 | 一致 |
| `offline-guard.mjs` | 一致 | 一致 |
| `../../../../example/agents/runtime/strategyRunner.ts` | 一致 | 一致 |
| `../../../../example/agents/runtime/decideTimeout.ts` | 一致 | 一致 |

出典: `controls.json:69-82`、`controls.json:6261-6274`。`strategyWorker.ts` / `strategyWorker.mjs` / `loader-timing.test.mjs` の実行時ハッシュ: **not found**。これらの実行時バイト同一性は未検証。テストについては TAP の失敗文言・行番号と現コードが整合する。

## JSON からの転記

| control | status / controlVerdict | T ms | offset min / max ms | step ms | n/point | warmupPairs | overhead repetitions | boundaryShiftMs |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| positive | complete / failed | 80 | -12 / 4 | 2 | 16 | 4 | 0 | 0 |
| negative | complete / failed | 80 | -12 / 4 | 2 | 16 | 4 | 0 | 0.375 |

設定: `controls.json:6-30`、`controls.json:6198-6222`。積分差: `controls.json:6189`、`controls.json:12381`。stockDefaultTimeoutMs=5000 は参考値で、今回の T は config を constructor に渡した値（`controls.json:5711`、`timing-arm.mjs:24`）。

| control | arm | delayMs | delayHits | generations | terminalGaps | expectedTimeouts | measurementStructureChecked | originalAudit | JSON 出典 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| positive | A | 0 | 0 | 148 | 143 | 144 | true | G3_TERMINAL_GAP | `controls.json:5713-5736` |
| positive | B | 6 | 4 | 148 | 144 | 144 | true | G3_TERMINAL_GAP | `controls.json:5737-5760` |
| negative | A | 0 | 0 | 148 | 140 | 141 | true | G3_TERMINAL_GAP | `controls.json:11905-11928` |
| negative | B | 0 | 0 | 148 | 144 | 144 | true | G3_TERMINAL_GAP | `controls.json:11929-11952` |

`terminalGaps` は worker 世代に `worker_result` が存在せず、対応する decide が throw した件数。元 auditor の `G3_TERMINAL_GAP` を測定用検査が許容しており、`measurementStructureChecked=true` は元 auditor の PASS ではない（`measure-timing.mjs:158-183`）。

| control | d ms | offset ms | n | A timeout | A fraction | B timeout | B fraction | B−A fraction | JSON 出典 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| positive | 68 | -12 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:5900-5931` |
| positive | 70 | -10 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:5932-5963` |
| positive | 72 | -8 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:5964-5995` |
| positive | 74 | -6 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:5996-6027` |
| positive | 76 | -4 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:6028-6059` |
| positive | 78 | -2 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:6060-6091` |
| positive | 80 | 0 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:6092-6123` |
| positive | 82 | 2 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:6124-6155` |
| positive | 84 | 4 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:6156-6187` |
| negative | 68 | -12 | 16 | 15 | 0.9375 | 16 | 1 | 0.0625 | `controls.json:12092-12123` |
| negative | 70 | -10 | 16 | 15 | 0.9375 | 16 | 1 | 0.0625 | `controls.json:12124-12155` |
| negative | 72 | -8 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:12156-12187` |
| negative | 74 | -6 | 16 | 15 | 0.9375 | 16 | 1 | 0.0625 | `controls.json:12188-12219` |
| negative | 76 | -4 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:12220-12251` |
| negative | 78 | -2 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:12252-12283` |
| negative | 80 | 0 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:12284-12315` |
| negative | 82 | 2 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:12316-12347` |
| negative | 84 | 4 | 16 | 16 | 1 | 16 | 1 | 0 | `controls.json:12348-12379` |

raw の Python 再集計（新しい計測ではない）:

| control | phase | pairs | A timeout | B timeout | JSON 出典 |
| --- | --- | ---: | ---: | ---: | --- |
| positive | warmup | 4 | 0 | 0 | `controls.json:84-203` |
| positive | boundary | 144 | 144 | 144 | `controls.json:204-4523` |
| negative | warmup | 4 | 0 | 0 | `controls.json:6276-6395` |
| negative | boundary | 144 | 141 | 144 | `controls.json:6396-10715` |

## 候補別判定

### (1) delay hook が対象 receive path に届かない、または check 後に動く

**confirmed（今回の boundary で未到達）。ただし「hook の接続先が違う／check 後に登録される」という実装不良説は refuted（静的コード）。**

positive B の delayHits=4 はゼロではなく、hook 自体は発火している。B の generations=148、terminalGaps=144 なので、result を観測した世代は再集計で 4。warmup は全件成功し、成功には result が必要なので、この全 result は warmup に対応する。boundary の result 受信と delay 発火は再集計でゼロ。phase ごとの delay カウンタそのものは **not found** だが、集計とコードから一意に対応する（上表、`timing-arm.mjs:39-50`、`strategyRunner.ts:139-163`、`measure-timing.mjs:163-175`）。

`timing-delay.mjs:10-18` は stock が作る同じ strategyWorker URL の Worker に `message.type === "result"` の listener を付ける。別の通信経路ではない。`ready` では発火しない。deadline の timer は result なしでも reject し、catch で worker を terminate する（`strategyRunner.ts:191-194,219,239-244`）。したがって、boundary の worker_result が観測される前に timeout と廃棄が進み、受信専用の delay が作用する機会を失った説明が整合する。worker 内部で result の生成まで進んだか、キューのどこにいたかは **not found**。

### (2) stock の時計の起点が delay 区間を除外する

**refuted（ハッシュ一致した stock コードの計測範囲）。**

`strategyRunner.ts:189-205` は start 完了後に timer と `deadline = performance.now() + timeoutMs` を作り、その後 worker.postMessage を呼ぶ。受信 listener は `performance.now() >= pending.deadline` を読む（同 `:131-145`）。pending が生きた result に対して先行 listener が同期 delay を挟めば、その時間は deadline 判定に含まれる。fixture 内から時計を開始し直す処理はない。

ただし sweep の d は親の経過時間ではなく worker 内の dwell（`timing-fixture.mjs:1-10`）。`Atomics.wait` の overshoot、送受信の待ち、deadline 設置後の `worker_post` 同期記録、stock 判定前の probe 受信記録を含む余分な時間があり得る（`probe-loader.mjs:117-132`、`probe-io.mjs:16-24`）。その各時間の内訳・今回の支配要因: **not found**。外側の `durations.decide` は probe wrapper や timeout 後の discard 待ちまで含むため、`durations.decide − d` をそのまま deadline の余分な時間と見なせない（`timing-arm.mjs:39-49`、`strategyRunner.ts:219`）。

### (3) sweep の範囲／分解能が真の境界を挟まない

**confirmed（範囲の不適合）。分解能だけが原因かは undetermined。**

positive は d=68〜84 ms の全点で A/B fraction=1/1。T−4 の差も 0。negative の下端も A/B=0.9375/1 で成功側を含まない（上の per-point 表）。同じ範囲を細かく刻むだけでは成功側の確保を保証しない。

`boundaryShiftMs` は `stepMs × Σ(B fraction − A fraction)` という有限格子上の符号付き面積であり、実際の deadline 移動や d50 の推定値ではない（`measure-timing.mjs:46-62`）。両 arm が飽和すれば大きな介入でも差が出ない。真の遷移位置・必要な下端 offset: **not found**。warmup は dwell をゼロにし boundary と異なる timeout を使うため、今回の T での成功側を保証しない（同 `:218-222`）。

### (4) Node/event-loop の listener 順序

**undetermined（この実機での timer と message の詳細な実行順）。stock listener が先に登録され delay を迂回する説は refuted（静的構造）。**

起動引数は timing-delay → probe-loader（`measure-timing.mjs:84-88`）。delay が Worker を置換して builtin export を同期し（`timing-delay.mjs:9-22`）、probe はその Worker を継承する（`probe-loader.mjs:99-112`）。constructor 内では super が戻る前に delay listener、その後 probe listener を登録し、new Worker が戻ってから stock listener が登録される（`timing-delay.mjs:13-18`、`probe-loader.mjs:112-132`、`strategyRunner.ts:84-94,131`）。想定する同期 message 配信では **delay → probe → stock**。preload の実際の評価順が異なっても両 constructor listener は stock の登録前であり、stock が先という根拠はない。

一方、独立した deadline timer と result 配信のどちらが先になったかは別問題。timer が pending を消してから遅い result が届けば stock は deadline 比較前の pending guard で戻る（`strategyRunner.ts:139-145,191-194`）。この区別の per-decision trace、listener 一覧、Mac mini の Node 内部 event-loop trace: **not found**。今回 Node の挙動実験はしていない。

### (5) assertion の単純なバグで negative が失敗した

**refuted（今回の失敗理由として）。**

negative の積分差 0.375 ms は事前条件 |差|≤2 ms を数値上満たす。しかし `loader-timing.test.mjs:77-81` はまず verdict を failed にし、`verify(result)` を呼び、成功した後で積分差を判定する。verify の下端条件は両 arm の timeout fraction≤0.125（同 `:46-48`）。下端 A=0.9375 なので先にここで止まる。TAP は両 control とも `low endpoint must bracket success`、verify の行を示す（`controls.md:90-106,115-131`）。negative の積分差 assertion には到達していない。

positive も verify が先なので delayHits の assertion には未到達。もしそこまで進めば delayHits=4 は必要数 boundaryRepetitions=16 を満たさない（`loader-timing.test.mjs:60-67`）。元の順序を飛ばして積分差だけを通す修正は、この飽和を有効な control と誤認する。verdict に assertion 原因を保存しないため JSON 単体では失敗理由が見えない点は報告上の改善候補であり、比較演算のバグではない。

## 最小の harness 変更案（提案のみ・未実装）

最初に変える対象は stock や hook ではなく **control の sweep 設定と sensitive point の選び方**。`loader-timing.test.mjs:21-22,66-67` の「worker dwell の境界が nominal T 付近にある」という仮定を外す。

1. 別扱いの探索で、同じ T・fixture・両 probe arm のまま下端を短い dwell 側へ広げ、両 arm で成功側と timeout 側を実際に挟む範囲を求める。ゼロ dwell も探索候補だが、今回の T で成功する証拠は **not found**。具体的な offset は推測で固定しない。探索データを合否算出には混ぜない。
2. 探索後に範囲・刻み・sensitive point・合否基準を固定し、新しい独立した確認実験を行う提案。既存の積分差閾値と endpoint guard は残す。sensitive point は nominal T−4 ではなく、探索で得た無介入 A の遷移位置 c に対する c−4 のように介入を検出できる点として事前指定する。ただしその点で要求する timeout 差が観測できるかは未検証。**これは旧 T−4 条件の変更を伴う新プロトコルであり、今回の failed を passed に読み替えない。**
3. delayHits を command 前後の差として phase/decision ごとに出力し、boundary で発火したことを別に確認する提案（`timing-arm.mjs:17-24,39-56`）。合否から warmup 分を除外する。必要なら測定専用 hook に受信時の時刻・delay 前後の時刻だけを記録し、raw probe JSONL を失敗時に残す。これは追加の可観測性改善で、範囲修正の代替ではない。

文字通りの旧 T−4 条件を維持するなら、範囲を広げるだけでは当該点の飽和は解消しない。T と dwell の関係を再設計する必要があり、成功する最小の具体値は **not found**。delay を postMessage に移す案は注入箇所そのものを変えるため、この receive-path control の最小修正としては選ばない。

## 読んだもの・確認できないもの

- 読取: controls.json 全体（JSON parse と raw 再集計）、controls.md 全体と末尾 TAP、上記 runner / worker / timing / probe 実装、offline-guard、timing-options、AGENTS.md。sourceHashes にある他ファイルはバイト列のハッシュ照合のみ。memory の軽いキーワード検索に関連する既往資料はなく、本診断の根拠には使用していない。
- JSON の raw から各点の件数・timeout 数・fraction・AB/BA 内訳と格子積分を Python で再集計し、保存 summary と整合するか読取確認した。これはアプリのテスト実行ではない。
- 個別 worker の probe JSONL: **not found**（提供ディレクトリには JSON と Markdown のみ）。harness は終了時に scratch を削除する（`measure-timing.mjs:266`）。result 未観測を result 未生成と断定できない。
- timeout サンプルの worker dwell 実測値は raw の fixtureElapsedMs=null。sleep overshoot、OS scheduling、probe 同期 I/O、message 配信待ちの寄与を分離する情報: **not found**。真の境界を左へ押した主因は **undetermined**。負荷だけを原因と断定しない。
- maxLoad1=5、maxObservedLoad1 は positive=3.85595703125 / negative=3.79833984375（`controls.json:15`、`controls.json:6191`、`controls.json:12383`）。loadNote は失敗を見た後に閾値を変更したと記録している（`controls.json:16`）。idle の独立確認はしていない。
- Node の listener 順序や timer 競合の実行検証、提案の有効性、production probe の overhead、G3 PASS、一般的な動作等価性は未検証。この診断からそれらを主張しない。
