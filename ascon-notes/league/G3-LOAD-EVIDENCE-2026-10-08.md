# r3 混成場の既存 G0 証拠 — 2026-10-08

**同一ホスト負荷校正の前提は BLOCKED のまま。既存証拠の整理のみ partly（一部完了）。G3 の結果・合格判定ではない。**

指定された mini 側の r3 集計（E1・E3・E6・E9）は合計 **144 世界**。このうち **137 世界が 362 loops、7 世界が 361 loops** と読める。しかし、**世界単位の G0 合格率は `not found in files`**。362 loops の割合 `137 / 144 = 95.14%`（小数点以下を丸めた計算値）を G0 合格率として扱ってはいけない。根拠と加算式は §2・§5 に示す。

## 1. 範囲・用語・読み方

- G0（Gate 0）は計測のタイミング・証拠の完全性を確認するゲート。本依頼の条件は 360 blocks（ブロック）、2 秒/block、362 loops（環境ループ反復）、p99（99th percentile、所要時間の99パーセンタイル）< 1000 ms（ミリ秒）。条件の文書根拠は [G3-PREREQ-2026-10-07.md](G3-PREREQ-2026-10-07.md)「契約と既存証拠」の G0 項、および [G3-LOCK-R3-2026-10-08.md](G3-LOCK-R3-2026-10-08.md) §2 のスケジュール段落・§4 の「全46世界と受入れの出口証拠」行。条件の記載と実測の確認は別である。
- G3（Gate 3）は自己改訂戦略の実チェーン受入れ判定。F_mix（mixed field）は固定対戦相手を混ぜた場。本書の「既存 F_mix」は依頼で指定された混成実験を指し、現在の G3 ロックのロスター（参加者構成）と同一とは認定しない。
- world（世界）は集計中の regime（市場局面）と seed（乱数初期値）で識別する実行。chunk（チャンク、ログ中の `c1` 等）は世界をまとめた実行単位。**chain-log の `G0 PASS/FAIL` はチャンク名を対象とする。世界別の判定一覧ではない。** PASS は当該 G0 ログの記載、FAIL は不成立の記載、BLOCKED は証拠不足等による判定保留を指す。
- 集計の `loopIterations==362 ONLY` はループ数だけの抽出。終了コードや違反で除外しないとの注記がある（A1/A3/A6 各 L22–23、A2 L30–31、A9 L21–22）。欠測をゼロ扱いせず、チャンク判定から世界別 PASS/FAIL/BLOCKED の正確な件数を補完しない。
- 計測証拠には下表の既存ファイルだけを使用した。背景文書は前提条件の説明に限る。`L` は当該ファイルの先頭を起点とする行番号。本書の数値は引用値または明記した算術集計であり、新規計測値ではない。E は既存の実験識別子である。

| 出典記号 | ファイル（全て `results-2026-10-07/` 内） |
|---|---|
| C1 | [chain-log-e1-mini.txt](results-2026-10-07/chain-log-e1-mini.txt) |
| C2 | [chain-log-e2-air.txt](results-2026-10-07/chain-log-e2-air.txt) |
| C3 | [chain-log-e3-mini.txt](results-2026-10-07/chain-log-e3-mini.txt) |
| C4 | [chain-log-e4-mini.txt](results-2026-10-07/chain-log-e4-mini.txt) |
| C57 | [chain-log-e5-e7-mini.txt](results-2026-10-07/chain-log-e5-e7-mini.txt) |
| C810 | [chain-log-e8-e10-mini.txt](results-2026-10-07/chain-log-e8-e10-mini.txt) |
| A1 | [e1-mixed-r3-seeds65001-3.txt](results-2026-10-07/e1-mixed-r3-seeds65001-3.txt) |
| A2 | [e2-mixed-r-seeds65001-3.txt](results-2026-10-07/e2-mixed-r-seeds65001-3.txt) |
| A3 | [e3-mixed-r3-seeds66001-3.txt](results-2026-10-07/e3-mixed-r3-seeds66001-3.txt) |
| A5 | [e5-mixed-r3a-seeds68001-3.txt](results-2026-10-07/e5-mixed-r3a-seeds68001-3.txt) |
| A6 | [e6-mixed-r3-seeds68001-3.txt](results-2026-10-07/e6-mixed-r3-seeds68001-3.txt) |
| A7 | [e7-mixed-r3c-seeds68001-3.txt](results-2026-10-07/e7-mixed-r3c-seeds68001-3.txt) |
| A8 | [e8-mixed-r3c-seeds69001-3.txt](results-2026-10-07/e8-mixed-r3c-seeds69001-3.txt) |
| A9 | [e9-mixed-r3-seeds69001-3.txt](results-2026-10-07/e9-mixed-r3-seeds69001-3.txt) |

## 2. 対象実験ごとの世界数・G0・タイミング

世界数は集計ファイルの `ALL worlds`。中断した先行実行を含む全試行世界数とは限らない。特に E2/E3 は runner/manifest failure（実行器／実行条件記録の不成立）が chain-log に別途残る（§4）。E2 は **baked r variant（依頼で指定された焼込み版 r）であり r3 ではない**。ファイルで確認できる候補名は `ascon-zeta-r`（A2 L26/L42）。焼込みの具体的設定・コードの同一性は `not found in files`。C2 の実行 prefix にある `e2r3` は候補 `ascon-zeta-r3` を意味しない。

| 実験・候補・ホスト区分 | 集計世界数 | loops の記録（世界数） | 世界別 G0 PASS / FAIL / BLOCKED の正確な件数 | p99 実測値 | 数値・候補の出典 |
|---|---:|---|---|---|---|
| E1 / ascon-zeta-r3 / mini | 36 | 362: 34、361: 2 | 各件数 `not found in files`。ループ条件不成立は少なくとも2世界 | `not found in files` | A1 L4–7, L14, L22–23 |
| E3 / ascon-zeta-r3 / mini | 36 | 362: 34、361: 2 | 各件数 `not found in files`。ループ条件不成立は少なくとも2世界 | `not found in files` | A3 L4–7, L14, L22–23 |
| E6 / ascon-zeta-r3 / mini | 36 | 362: 34、361: 2 | 各件数 `not found in files`。ループ条件不成立は少なくとも2世界。別チャンクの FAIL 理由も不明 | `not found in files` | A6 L4–7, L18, L22–23; C57 L40–41 |
| E9 / ascon-zeta-r3 / mini | 36 | 362: 35、361: 1 | 各件数 `not found in files`。ループ条件不成立は少なくとも1世界 | `not found in files` | A9 L4–6, L10, L21–22 |
| E2 / ascon-zeta-r（r3 ではない）/ Air | 36 | 362: 26、361: 3、360: 3、359: 1、356: 1、355: 2 | 各件数 `not found in files`。ループ条件不成立は少なくとも10世界 | `not found in files` | A2 L4–15, L26, L30–31。ループ別件数は L4–13 を数えたもの |

指定ファイル内には実測のブロック数・ブロック間隔も `not found in files`。基準の 360 blocks / 2 秒を実測値として転記しない。

以下は**チャンク単位**で明記された判定の件数。世界単位の件数には変換していない。BLOCKED と断定できない停止は別欄に保持した。

| 実験 | 明記 G0 PASS チャンク | 明記 G0 FAIL チャンク | 明記 G0 BLOCKED チャンク | 判定が確定しない停止・欠落 | 出典 |
|---|---|---|---|---|---|
| E1 | 3（c2/c3/c4） | 1（c1） | 0 | なし | C1 L7–20 |
| E3 | 3（e3b の c1/c2/c4） | 1（e3b の c3） | 0 | 先行 e3 の c1 が runner/manifest failure。G0 recorded だが値なし | C3 L8–10, L18–32 |
| E6 | 1（c2） | 3（c1/c3/c4） | 0 | c1 の世界別理由なし | C57 L40–54 |
| E9 | 3（c1/c2/c3） | 1（c4） | 0 | なし | C810 L38–52 |
| E2（非 r3） | 2（e2r の c1、e2r3 の c3） | 2（e2r の c2、e2r4 の c4） | 0 | e2r の c3 は runner/manifest failure。e2r3 の c4 は判定なしで CHAIN_END=143 | C2 L8–13, L20–30, L38–40 |

この表の「0」は明記されたチャンク行を数えた結果であり、BLOCKED 世界が存在しなかった証明ではない。終了コードから G0 判定・停止原因を推定しない。

## 3. ホストと他の CPU 作業の記録

CPU は Central Processing Unit（中央処理装置）。mini/Air は依頼と chain-log のファイル名によるホスト区分である。指定ファイル内の正式なホスト名、機種仕様、稼働プロセス一覧、CPU 使用率は `not found in files`。パスの一致だけで物理ホストの同一性は証明できない。

| 実験 | ホスト区分・ログにある実行領域 | activity note（並行作業の申告） | 出典・確認範囲 |
|---|---|---|---|
| E1 | mini、`/Users/masa-ws1/ascon-run/p60` | `not found in files` | C1 L1–21 |
| E3 | mini、`/Users/masa-ws1/ascon-run/p60` | `not found in files` | C3 L1–32 |
| E6 | mini、`/Users/masa-ws1/ascon-run/p60` | `not found in files` | C57 L29–54 |
| E9 | mini、`/Users/masa-ws1/ascon-run/p60` | `not found in files` | C810 L27–52 |
| E2（非 r3） | Air、`/private/tmp/g3-chain/eval2` | `not found in files` | C2 L1–40 |

申告の欠落を「他の CPU 作業なし」「ホストが空いていた」とは解釈しない。

## 4. FAIL／BLOCKED 関連の世界と未特定箇所

### 世界を特定できるループ条件不成立の全件

以下は対象実験の集計 `WARN world` 全件。362 loops 条件への不成立を確認でき、所属チャンクにも G0 FAIL の記載がある。ただし世界別 G0 判定レコードそのものは指定ファイルにない。表の候補席／相手側分類は全行 **`not found in files`（環境ループの不足として記録され、責任のある席は不明）**。候補の処理遅延、相手の処理遅延、ホスト競合のいずれとも断定しない。

| 実験 | チャンク | regime | seed | loops（不成立理由） | 世界の出典 | チャンク G0 FAIL の出典 |
|---|---|---|---:|---:|---|---|
| E1 | e1-c1 | calm | 65001 | 361 | A1 L4 | C1 L7–8 |
| E1 | e1-c1 | cex-drift | 65002 | 361 | A1 L5 | C1 L7–8 |
| E3 | e3-c3 | vuln | 66002 | 361 | A3 L4 | C3 L26–27 |
| E3 | e3-c3 | vuln | 66003 | 361 | A3 L5 | C3 L26–27 |
| E6 | e6-c3 | vuln | 68003 | 361 | A6 L4 | C57 L48–49 |
| E6 | e6-c4 | launch | 68001 | 361 | A6 L5 | C57 L52–53 |
| E9 | e9-c4 | launch | 69001 | 361 | A9 L4 | C810 L50–51 |
| E2（非 r3） | e2r-20261007T034113Z-c2 | whale | 65001 | 361 | A2 L4 | C2 L24–25 |
| E2（非 r3） | e2r-20261007T034113Z-c2 | whale | 65002 | 361 | A2 L5 | C2 L24–25 |
| E2（非 r3） | e2r-20261007T034113Z-c2 | lending-incident | 65001 | 360 | A2 L6 | C2 L24–25 |
| E2（非 r3） | e2r-20261007T034113Z-c2 | lending-incident | 65002 | 360 | A2 L7 | C2 L24–25 |
| E2（非 r3） | e2r4-20261007T060658Z-c4 | cdp-incident | 65001 | 355 | A2 L8 | C2 L38–39 |
| E2（非 r3） | e2r4-20261007T060658Z-c4 | cdp-incident | 65002 | 356 | A2 L9 | C2 L38–39 |
| E2（非 r3） | e2r4-20261007T060658Z-c4 | cdp-incident | 65003 | 355 | A2 L10 | C2 L38–39 |
| E2（非 r3） | e2r4-20261007T060658Z-c4 | launch | 65001 | 359 | A2 L11 | C2 L38–39 |
| E2（非 r3） | e2r4-20261007T060658Z-c4 | launch | 65002 | 361 | A2 L12 | C2 L38–39 |
| E2（非 r3） | e2r4-20261007T060658Z-c4 | launch | 65003 | 360 | A2 L13 | C2 L38–39 |

集計側が省略したチャンク名（例 `e3-c3`）は原表記を保持した。chain-log 側の該当実験・チャンクとの対応を示しているが、生 manifest による結合は今回行っていない。上記の WARN 行はすべて `exit_code=0 violations=[]` だが、これだけで完全な計測や p99 を確認したことにはならない。

### 世界別の全件一覧を復元できない箇所

指定ファイルには **telemetry blocked（計測情報不足による保留）という具体的理由や原因席は `not found in files`**。`blocked/error/inconsistent output` の混合メッセージを telemetry による BLOCKED と断定しない。次表は取りこぼしを防ぐため、世界が未特定の停止・失敗と、同じファイルに含まれる対象外実験も記す。後者は r3 の集計に含めない。

| 実験・範囲 | 保存された状態／理由 | 世界・loops・p99 の追加情報 | 候補席／相手側 | 出典 |
|---|---|---|---|---|
| E6 c1 | G0 FAIL | 世界・具体的理由・p99 は `not found in files`。A6 の WARN は c3/c4 だけで、c1 の失敗をループ不足と説明できない | `not found in files` | C57 L40–41; A6 L3–5 |
| E3 先行 e3-20261007T063846Z-c1 | STOP: runner/manifest failure、G0 recorded | 世界別件数・判定・loops・p99 は `not found in files`。後続 e3b の集計と足し合わせない | `not found in files` | C3 L3–10, L13–19 |
| E2 先行 e2r-20261007T034113Z-c3 | STOP: runner/manifest failure、G0 recorded | 世界別件数・判定・loops・p99 は `not found in files` | `not found in files` | C2 L28–30 |
| E2 e2r3-20261007T051203Z-c4 | CHUNK 開始後 CHAIN_END=143、G0 判定行なし | 世界別件数・判定・loops・p99・終了理由は `not found in files` | `not found in files` | C2 L12–13 |
| E4 e4aa-20261007T093737Z-c2（対象外） | STOP: G0 blocked/error/inconsistent output | 世界の特定・候補版・loops・p99・具体的原因は `not found in files` | `not found in files` | C4 L12–14 |
| E5 r3a c2（対象外） | STOP: G0 blocked/error/inconsistent output | 世界の特定・p99・具体的原因は `not found in files`。集計は全36世界が362 loops で WARN none | `not found in files` | C57 L12–14; A5 L3–6, L10, L21–22 |
| E7 r3c c3（対象外） | G0 FAIL。spike / seed 68002 が361 loops | その他の世界別判定・p99 は `not found in files` | `not found in files` | C57 L74–75; A7 L4, L13 |
| E8 r3c c2（対象外） | G0 FAIL | 世界・具体的理由・p99 は `not found in files` | `not found in files` | C810 L16–17; A8 L3–4, L13 |
| E8 r3c c3（対象外） | G0 FAIL。vuln / seed 69002 が361 loops | その他の世界別判定・p99 は `not found in files` | `not found in files` | C810 L20–21; A8 L4, L13 |
| E8 r3c c4（対象外） | G0 FAIL | 世界・具体的理由・p99 は `not found in files` | `not found in files` | C810 L24–25; A8 L3–4, L13 |

E10 はログの `e10fref` として別実験であり、依頼で指定された r3 混成場集計の対象ではない（C810 L55–78）。**全 G0 FAIL/BLOCKED 世界の完全なリストは `not found in files`**。上表は、特定できる世界を全件列挙し、残りを未特定のまま明示したもの。

## 5. 証拠が支持すること・支持しないこと

支持するのは、既存の mini 区分の混成場で r3 の集計が残っていることと、その限定された失敗形状である。

- 世界数は `36 + 36 + 36 + 36 = 144`（A1 L7、A3 L7、A6 L7、A9 L6）。候補は `ascon-zeta-r3`（A1 L14、A3 L14、A6 L18、A9 L10）。先行停止試行を含む総試行数は `not found in files`。
- 362 loops は `34 + 34 + 34 + 35 = 137` 世界（A1/A3/A6 各 L22、A9 L21）。361 loops は `2 + 2 + 2 + 1 = 7` 世界（A1/A3/A6 各 L4–5、A9 L4）。ループ条件だけの割合は `137 / 144 = 95.14%`。**世界単位の G0 PASS 数・合格率は `not found in files`**。
- 主たる後続実行のチャンク記録を足すと G0 PASS は `3 + 3 + 1 + 3 = 10`、FAIL は `1 + 1 + 3 + 1 = 6`（§2 のチャンク表の各出典）。これは世界数や世界別合格率ではない。r3 にはループ不足のほか、E6 c1 の理由未記載の FAIL と、E3 の先行 runner/manifest failure がある（§4）。原因席も CPU 競合の因果も特定できない。

支持しないことは次のとおり。

- **同一ホスト負荷校正の完了。** 専用に隔離した校正実行、固定した負荷定義、他の CPU 作業の申告、世界別の p99・完全な G0 証拠は `not found in files`。mini 区分の過去実験が複数あることは校正の成立を意味しない。E2 はホスト区分も候補版も異なるため r3/mini の分母に加えない。
- **G3 ロックと同じ参加者構成での検証。** 既存混成集計には `grok-1` がある（A1 L12、A2 L20、A3 L13、A6 L12、A9 L12）。G3 ロック §2 の F_mix は `fixed-bid-5gwei` を含む別構成。背景の G3-PREREQ「契約と既存証拠」も E1/E2 の転用を否定している。固定負荷・相手 hash（内容識別値）・実効設定の同一性は本資料では立証できない。
- **通常の停止条件で完走した受入れ結果。** `mode=diagnostic` と `DEVIATION diagnostic continuation after G0 FAIL; failures remain failures` が記録されている（C1 L3–4、C2 L3–5/L16–17/L33–35、C3 L3–5/L13–15、C57 L31–37、C810 L29–35）。これは `continue-on-g0-fail` 型の診断継続であり、FAIL を保存している。`--continue-on-g0-fail` という実コマンド引数の文字列自体は `not found in files`。
- **G3 の結果・公式スコア・戦略の優劣。** 集計の先頭には公式の重み付き T ではない簡易 T（スコア表記）で、世界を等重みに扱うとの注記がある（A1/A2/A3/A5/A6/A7/A8/A9 各 L1–2）。本書はスコアの再計算・成績評価・改訂の受入れを行わない。

**残る作業は、実行担当が、G3 に使うホスト上で r3 とロック対象 F_mix の負荷を明示的に固定し、専用の同一ホスト校正を実行すること。** 他作業の有無、実行条件と相手構成、世界ごとのブロック・loops・p99、完全性判定と不成立理由・該当席を保存し、既存診断とは区別して提示する必要がある。予定ホストはロック §2 に計画・未検証として記載されている。今回、校正の実行・前提解除・G3 開始はしていない。

## 6. 今回の作業と検証範囲

ローカルの指定ログ・集計・背景文書を行番号付きで読み、Python 標準ライブラリで既存集計の世界数・ループ数を再集計した。これはファイルの読取りと算術照合であり、測定・バックテストではない。実装・入力ロックは変更せず、本書とロック文書の未完了項目行だけを編集した。

| 今回実行した確認 | 結果 |
|---|---|
| `pwd`、`git status --short`、`git branch --show-current`、`git rev-parse --short origin/main` | 指定作業領域、開始時差分なし、`docs/g3-load-calibration`、`42cc8bb` を確認 |
| `rg` / `nl -ba` 等のローカル読取り、`python3 -B` の既存集計加算 | 上記出典と算術を確認。新規計測なし |
| `NPM_CONFIG_OFFLINE=true NPM_CONFIG_IGNORE_SCRIPTS=true NPM_CONFIG_UPDATE_NOTIFIER=false npm run typecheck` | 終了127、`tsc: command not found`。型検査は未検証、依存導入なし |
| `git diff --check` | 終了0、空白エラーなし。新規ファイルは `git diff --no-index --check /dev/null ascon-notes/league/G3-LOAD-EVIDENCE-2026-10-08.md` でも確認（追加差分ありで終了1、空白エラー出力なし） |
| 文書のローカルリンク・明示的な出典行範囲・対象 WARN 行の照合（`python3 -B`） | 終了0。リンク先の存在、行範囲、§4 の対象実験の WARN 行と件数を確認 |

ネットワーク、Docker、Anvil、バックテスト、SSH（Secure Shell）、commit、push は実行していない。世界別の生 G0 出力、ホスト実態、CPU 負荷、同一ホスト校正、実チェーン、公式スコア、G3 受入れは未検証。文書のみの変更であり、実行コードの関連テストは追加・実行していない。
