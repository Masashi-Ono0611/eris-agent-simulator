# 時間干渉ハーネスのコストモデルと縮小案（2026-10-10）

これは supporting study の設計メモであり、G3 の gate／提出可否判定ではない。本稿では実装変更を行わず、既存閾値の緩和も推奨しない。コード、既存成果物、実行環境は変更せず、この文書だけを新規作成する。

現行 control は1本あたり **784 boundary pairs**、main は **980 boundary pairs と 240 overhead pairs**。timeout のたびに Worker を破棄し、次の測定前に再起動するため、pair 数だけでも過大で、timeout が多い境界領域はさらに高価になる。縮小案は **7点、N=4、W=5、control 各点24 pairs、main 各点64 pairs**。予算は **positive ≤30分、negative ≤30分、main ≤90分、合計≤150分**（探索・再実行は含めない）。完了を保証する予測ではなく、超過時に未完了として停止する資源上限である。

## 1. 読み取れた事実と資料の不一致

以降の数値は Python 標準ライブラリで JSON の集計、コード定数の正規表現抽出、式の算術評価を行ったもの。モデルの仮定値・提案値・ユーザー報告を実測と分けて表示する。

ローカルコピーの基点 `S`:

```text
/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer/3fa0e378-4bdf-4ccc-9162-233272c6689c/scratchpad/mini-controls
```

| 資料 | 確認できた内容 | 限界 |
| --- | --- | --- |
| `S/explore2.json` | schema 3、status `rejected`、2026-10-09T07:16:18.397Z → 2026-10-09T08:39:09.936Z、差 4971.539秒 = 82.859分、94 pairs | ユーザー報告の2026-10-10・約22分の spin run と一致しない |
| 同 JSON | W=5、N=40、23点×4 pairs＋discarded warmup 2 pairs。calibration フィールド: `not found` | 現行 spin の実測と呼ばない |
| `S/explore.json` | schema 2、2026-10-09 の古い探索 | 今回の N/W コスト係数には使わない |
| `S/controls.json` | 2026-10-09 の positive/negative、各148 pairs、complete/failed | 60分で停止した確認 run の結果ではない |
| `S/controls-timeout-summary.txt` | positive/negative とも `running not-run`、`pairs None`、W=5、N=40、49点相当の範囲、load上限8 | `testTimeoutFailure`、3,600,000msの発生記録、75 pairsの進捗行、実行日時: `not found`。行末は切れており load note 全文も `not found` |
| `explore.log` と新 spin JSON | 指定 scratchpad、`/private/tmp`、ASCON の2つのローカルルートを隠しファイル込みでファイル名検索 | `not found`。リモートからの取得はしていない |

`explore2.json` の SHA-256: `118528ee394f9c301737c38dd77a7ac9f4074911af1db4547565dc7f64d10485`。
保存 sourceHashes と現行ローカルファイルを Python で比較すると、`timing-unit.mjs` / `timing-arm.mjs` / `timing-sweep.mjs` / stock runner は一致し、`measure-timing.mjs` / `timing-fixture.mjs` / `timing-delay.mjs` は不一致。したがって旧 JSON は再起動会計の資料にはなるが、新 spin の timeout 曲線・成功時間・負荷の直接証拠にはならない。

**ユーザー報告として採用する事実**: 2026-10-10、START_EXPLORE 04:29:43Z からの spin 探索は94 pairs・約22分。その後 controls→main の確認実行は positive のテスト固有60分上限（testTimeoutFailure 3,600,000ms、進捗約75 boundary pairs）到達後にユーザーが停止。main 完了の証拠は `not found`。`loader-timing.test.mjs` の各 control の timeout 定数が3,600,000msであることはソースで確認した。探索終了の正確なタイムスタンプや停止時の完了 pair 数は推測しない。

`controls-timeout-summary.txt` の T=100、offset範囲 −14.5..+9.5 からは、設定上の **c=97.5ms、d=85.5..109.5ms、c−4=93.5ms** を逆算できる。新探索の c を再計算した結果ではない。旧 explore2 は quality rejection（A幅16.907ms >10ms）なので確認入力に流用しない。

## 2. 1 process／1 pair のコスト

[timing-unit.mjs](timing-unit.mjs) と [stock StrategyRunner](../../../../example/agents/runtime/strategyRunner.ts) に従う記号:

- d: 測定 fixture の dwell。T: deadline。N: measured decides/process、W: discarded warm-up decides/世代。
- K: N回中の timeout 数。R: rewarm 数。**R=K−I(最後の measured decide が timeout)**。最後の timeout 後は次の measured decide がないため rewarm しない。
- discarded decide 数は **W×(1+R)**。1 process に runner は1つだが、Worker 世代は timeout ごとに増える。
- C0: setSource＋cold start＋ready start＋close。U0(W): initial warm-up 合計。
- Ls(d): 成功した measured decide の wall。Lt(T): timeout＋Worker termination の wall。
- B(W): replacement warm-up 1セットの wall。最初の call に Worker cold startup を含む。
- Hout: process spawn/import/IPC/終了/audit/coordinator 等の、JSON 内の計測区間外の費用。

```text
Cprocess = Hout + C0 + U0(W)
           + Σ成功 Ls(d) + Σtimeout Lt(T) + Σ Rセット B(W)
E[Cprocess(d,p,N,W)] ≈ Hout + C0 + U0(W)
           + N[(1−p)Ls(d) + p Lt(T)] + (N−1)p B(W)
Cpair = Cprocess,A + Cprocess,B + cooldown(1.5秒)
```

最後の期待値は測定位置ごとの timeout 確率が同じ p という仮定。独立性がなくても平均確率が同じなら期待 R=(N−1)p。依存・非定常性は分散と検出力に影響する。

**「W 回とも約 d ms」は現行実装と異なる。** `warm()` は `decide(0, phase)` を W 回呼ぶ。旧 JSON の全 warm-up の `durationMs` も0のみ。仮に d で rewarm する別設計なら B≈startup+W(d+固定費) だが、その設計ではない。現行は **B≈replacement startup＋W×Lwarm(0)**。Wを減らすだけでは支配的な再起動費を消せない。

### 旧 JSON から直接算出した会計（新 spin の係数とは未検証）

全188 processes、measured 7,520回、timeout 6,140回、rewarm 5,986セット、discarded 30,870回。

| 項目 | 算出値 |
| --- | ---: |
| `finishedAt−startedAt` | 4971.539秒 |
| durations＋全 measured/warm-up wall の合計 | 4790.323秒 |
| pair cooldown 合計 | 141.000秒 |
| 残差（上記以外） | 40.216秒 |
| 残差を均等配分した Hout/process | 213.916ms |
| cold start 平均 | 693.598ms |
| initial W回の合計平均 | 6.490ms |
| rewarm W回の合計平均 B | 663.381ms |
| rewarm の最初の call 平均 | 659.750ms |
| 残り W−1回の1 call 平均 | 0.908ms |
| timeout measured wall 平均 Lt | 105.319ms |
| d=0 measured wall 平均 F（cold startを含まない） | 0.762ms |
| rewarm wall 全体 | 3971.000秒 |

Hout は直接計測値ではなく残差の配賦。pair 個別の開始・終了時刻は `not found`。以下の process は記録区間の合計、pair はその2倍＋平均配賦残差＋cooldown の推定であり、pair の直接 wall 計測ではない。各 d は4 pairs＝8 processesを集計。

| d ms | pooled timeout割合 | R/process平均 | measured wall平均 ms | process記録区間 秒 | pair推定 秒 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0.00000 | 0.000 | 0.762 | 0.734 | 3.397 |
| 10 | 0.00000 | 0.000 | 60.898 | 3.141 | 8.210 |
| 15 | 0.83750 | 32.750 | 96.085 | 26.233 | 54.394 |
| 20 | 0.88125 | 34.250 | 98.229 | 27.298 | 56.523 |
| 95 | 1.00000 | 39.000 | 105.298 | 30.730 | 63.388 |
| 100 | 1.00000 | 39.000 | 105.295 | 31.236 | 64.400 |
| 110 | 1.00000 | 39.000 | 105.380 | 30.738 | 63.404 |

旧 run では d=95ms の process が約31秒になる。N=40の測定は約4.2秒だが、39回の rewarm に平均係数で **39×0.663381=25.872秒** を追加するため。これが timeout に伴う主なコスト増である。

### 新 spin 用の条件付き計画モデル

再起動係数が旧 run と同程度で、spin 成功が Ls(d)≈d+F と仮定する。旧 run の成功 wall を spin の測定値として転用しない。秒単位で:

```text
H = Hout + C0 + U0(5) = 0.916314
Cprocess(d,p,N,5) ≈ H
  + N[(1−p)(d/1000 + 0.000762276) + p×0.105318748]
  + (N−1)p×0.663381247
```

設定から逆算した c=97.5ms における例（実測結果ではない）:

| N | p | process推定 秒 | 同じpの2 arms＋cooldown 秒 |
| ---: | ---: | ---: | ---: |
| 40 | 0 | 4.847 | 11.194 |
| 40 | 0.5 | 17.924 | 37.348 |
| 40 | 1 | 31.001 | 63.502 |
| 4 | 0 | 1.309 | 4.119 |
| 4 | 0.5 | 2.319 | 6.137 |
| 4 | 1 | 3.328 | 8.155 |

旧 JSON の実時間平均は 52.889秒/pair。一方、ユーザー報告22分÷94 pairsは 14.043秒/pair（cooldownを含む概算）。d=0..110ms を均等に回す探索は低 d の成功が多く、c付近の確認より安いので、この平均だけを確認の予測にしてはいけない。

## 3. 現行設計の総量と60分超過

[measure-timing.mjs](measure-timing.mjs) DEFAULTS、[timing-sweep.mjs](timing-sweep.mjs) SWEEP、[loader-timing.test.mjs](../tests/loader-timing.test.mjs) config を抽出。実際の確認点数は DEFAULTS の旧 min/max ではなく探索から導出した **2×12/0.5+1=49点**。AB/BAは実行順を半々にするもので、armsを並列実行して時間半減する機能ではない。

| 実行 | boundary points×reps | discarded warmup pairs | d=0 overhead pairs | total pairs | arm processes | boundary measured（両arm計） | cooldownのみ 分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| positive | 49 × 16 = 784 | 4 | 0 | 788 | 1576 | 62,720 | 19.70 |
| negative | 49 × 16 = 784 | 4 | 0 | 788 | 1576 | 62,720 | 19.70 |
| main | 49 × 20 = 980 | 10 | 240 | 1230 | 2460 | 78,400 | 30.75 |

各点の timeout割合の分母は control 16×40=640/arm、main 20×40=800/arm。warmup pairs 自体も **各arm processで W=5＋N=40** を実行し、集計から除外される。初期 W回だけを意味しない。main の240 overhead pairsも N=40の d=0測定なのでゼロ費用ではない。

総時間の基本式は `calibration + R Σ点(CA+CB+1.5秒) + (warmupPairs+overheadPairs)×Cpair(d=0)`。以下は**予測シナリオ**で、完了 run の時間ではない（分）。calibration はこの比較表では省略、縮小予算には別計上。

| 実行 | 22分/94の単純比例（過小評価し得る） | 約75pairs/60分の48秒をboundaryへ適用 | 条件付きstep曲線モデル | 全boundary timeoutの係数モデル |
| --- | ---: | ---: | ---: | ---: |
| positive | 184.4 | 627.4 | 569.1 | 830.0 |
| negative | 184.4 | 627.4 | 485.0 | 830.0 |
| main | 287.9 | 798.1 | 620.2 | 1051.3 |

step曲線モデルは pA=0/0.5/1 を d<c / d=c / d>c に置き、positive の pB は c−6を中心、negative/main は同じ曲線とした**仮想例**。保存 spin 曲線からの fit ではない。後半3列の d=0追加 pairs はモデル 3.394秒/pair。 positiveの表は移動に伴うtimeout増を計上し、listener自体の追加spin要求時間は別枠。最大788 B processes×(N+WN=240) calls×6ms=18.912分をさらに見込む（全callが発火する保守的要求量で、実wallの上限ではない）。all-timeout 列は古い平均係数によるストレス試算で、OS待ち時間等を含めた保証上限ではない。

約75 boundary pairs/60分は約48秒/pair。784 pairsには約627分（約10.5時間）が必要で、60分では約9.6%にすぎない。進捗コードは `index % 25 === 0` のときだけ出力し、indexにwarmup pairsも含むので、「75」の厳密な completed boundary 件数や正確なレートはログなしに復元できない。この概算と再起動会計は超過の構造を説明するが、特定のサービス／負荷が原因だったとの断定はしない。テスト60分上限だけを延長する案は採らない。

## 4. 縮小設計（提案のみ、現行 CLI では実行不可）

確認用の新しい完全な探索資料を固定し、現行 suitability／calibration／load条件を満たすことが前提。旧 rejected JSON を採択したり、閾値を変更したりしない。

- offsets は **c＋[−12, −8, −6, −4, 0, +4, +12]ms** の7点。両端を保持し、positive の予想中心 c−6 と必須 sensitive c−4 を含める。0.5msの全格子を削る。
- **W=5維持、N=4**。timeout後の Worker破棄・d=0 rewarm・最後のtimeout後はrewarmなし、という意味を維持する。Wを減らす案ではない。
- positive/negative は各点 **24 process pairs**、main は各点 **64 process pairs**。各点AB/BAを同数（control 12/12、main 32/32）とし、seed付き点順shuffle、pair cooldown 1500msを保持する。
- discarded warmup pairsは各実行2。main の d=0 overhead測定は24 pairsに縮小（96 measured/arm）。この標本数でp99 tailを精密推定できるとは主張しない。
- control は両arm probe、positive Bだけ6ms注入。main はstock対probe、両arm注入なし。全て逐次実行し、calibration・source hashes・toolchain・load条件・全失敗／partial unitを記録する。

| 実行 | pairs/点 | measured n/点/arm | boundary pairs | overhead pairs | total pairs / processes | 係数モデル 分 | 予算 分 | 余裕 分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| positive | 24 | 96 | 168 | 0 | 170 / 340 | 23.38 | 30 | 6.62 |
| negative | 24 | 96 | 168 | 0 | 170 / 340 | 22.97 | 30 | 7.03 |
| main | 64 | 256 | 448 | 24 | 474 / 948 | 62.37 | 90 | 27.63 |

モデルは全boundaryで p=1（N=4なら最大R=3）、d=0追加pairsはp=0を使用。calibrationはソースの2 primitives×20×(5+10+25)ms＝**1.6秒の要求時間**を加算したが、その実 wall は `not found`、超過分は余裕から消費する。positive は全170 pairsの B に最大 `N+WN=24` result hits/process×6msを追加し、**0.408分**を計上（実発火数の予測ではない）。stock/probeコスト差や新runの再起動速度は未検証。

control 約23.38分（positive）／22.97分（negative）、main約62.37分。旧係数でも成立する予算を選んだが、30／90分以内に完走できる実証ではない。controlの余裕は約6.6〜7.0分、main約27.6分。実行中の更新予測が予算を超えたら sample不足のまま停止し、結果は `incomplete / inconclusive`。予算のために load／quality／endpoint／control閾値を緩めない。

現行 `selectSweep` は49点固定、`prepareTimingConfig` は導出格子を上書きし、CLIにはN/W変更項目がない。縮小時は新protocolとして点集合・数・推定量・report／validator・停止時の永続化を実装レビューする必要がある。本作業では変更していない。

### 早期停止・逐次解析

固定標本数＋**予算／安全性／妥当性の停止だけ**を勧める。開始から終了までの coordinator wall を予算対象にし、完了pairを逐次保存することは将来の提案。中断時は現在armを終了させ、partialを保存し、未達を成功扱いしない。positive不成立・未完了なら続く高価なmainを省略して supporting study 未成立と報告する。これはG3 gateの追加ではない。

通常の95%区間を何度も見て「有意になったら終了」は採用しない。必要なら process-pair block 単位の confidence sequence／alpha spending と最大sample数を事前定義し、相関・複数点・予算停止を扱う別解析が必要。現行コードにはその実装も較正も `not found`。途中で効果が小さいから停止したデータを等価性の根拠にしない。

## 5. 検出力と解釈の限界

### 二項／Wilson による設計計算

timeout の二値結果について、同じ点の2 armsが独立、定常、等しいnという**計画上の仮定**を置く。Δ=pB−pAの標準誤差は `sqrt(pA(1−pA)/n+pB(1−pB)/n)`、最大は `sqrt(0.5/n)`。両側α=0.05、power=0.80の正規近似 MDE は `(1.959964+0.841621) sqrt(0.5/n)`。これは0との差を検出する概算で、正確な二項powerやcontrol合格確率ではない。

process内 N=4 の相関ρに対して設計効果 `1+(N−1)ρ=1+3ρ`、`n_eff=4R/(1+3ρ)`。実ρは新資料がなく `not found`。ρ=0の楽観ケースとρ=1のprocess単位ケースを示す。process間まで相関するなら後者も保証下限にならず、さらに検出力が下がる。実解析は process pair を単位にΔと区間を算出し、AB/BA、時間順のdrift、rewarm差を併記する。

| 条件 | 計画用nまたはn_eff | Δの95%幅（最悪分散の正規近似） | 80% MDE（割合差） | p=0.5のWilson 95%区間 |
| --- | ---: | ---: | ---: | --- |
| control: decide独立 | 96 | ±0.141 | 0.202 | [0.402, 0.598] |
| control: process内完全相関 | 24 | ±0.283 | 0.404 | [0.314, 0.686] |
| main: decide独立 | 256 | ±0.087 | 0.124 | [0.439, 0.561] |
| main: process内完全相関 | 64 | ±0.173 | 0.248 | [0.381, 0.619] |

Wilsonは1 armの割合の区間であって、単に2区間の重なりで差の検定を置き換えない。n_effを用いた列は相関の影響を示す設計計算で、実測のcluster区間を計算したものではない。確認前に primary point／contrast を固定する。この表は単一比較であり、全7点を探索して最良点だけ有意と呼ぶ多重比較には適用できない。

### Positive: 6ms注入

同形の曲線の水平移動が成り立つなら `pB(d)≈pA(d+6)` で、sensitiveでは `Δ=pA(c+2)−pA(c−4)`。両端が飽和する十分な範囲の真の面積差は約6ms。実際にはOS scheduling／IPC／termination／delay listenerの発火条件があり、6msの移動も **sensitiveでΔ≥0.5も未実証**。

例として真の pA=0.25、pB=0.75（観測値ではない）なら、n_eff=24でWilsonはA [0.120,0.449]、B [0.551,0.880]、n=96ならA [0.174,0.345]、B [0.655,0.826]。Δ=0.5は上記MDEの0.404を上回る。帰無時最悪SEと対立時SEを使う正規近似では、n_eff=24でも0との差の検出powerは約95.9%。ただし **真のΔ=0.5のとき「観測Δ≥0.5」を通る確率は概ね半分**であり、検出powerを既存sensitive条件の通過率に読み替えない。

quality幅≤10msという条件だけからc−4での局所傾きは保証されない。10–90%を10msで直線的に横切る仮想曲線なら平均傾き0.8/10=0.08/ms、6ms移動によるΔは0.48にとどまり、既存0.5条件に達しないこともある。positive判定を通すためにこの条件を緩めるのではなく、不成立／不足をそのまま報告する。

### Negative: 同一 arms

帰無はΔ=0。controlの点別95%のばらつき目安は独立decideなら±0.141、process内完全相関なら±0.283。後者の80% MDEは0.404なので、0.1等の小さな割合差を「存在しない」とは言えない。特にc−4で両armがほぼ0なら、そこで差が小さくても中心の差は見逃す。cの中心点、端点、全点の区間も併記する。

「有意差なし」は同一性・等価性の証明ではない。既存の積分差±2ms内を観測することと、その範囲内の等価性を区間で示すことも異なる。

### Main: ms単位で何を結論できるか

mainのprimary比較は事前指定した **d=c の割合差**とする（c−4はpositiveのprimary sensitive点として維持し、mainでは補助）。有効局所傾きsが既知で、形が共通で、小さい水平差δに対しΔ≈sδなら `δ_MDE≈Δ_MDE/s`。

仮に **s=0.08/ms** と置けば、mainは独立decideで **1.548ms**、process内完全相関で **3.095ms** が80% powerの概算下限。後者では **約3.1ms未満のA/B差は80% powerで検出できない**。計画上の解像度目標は余裕を取り **X=4ms** とし、4ms未満の差を検出・除外できる研究とは位置付けない。これは「4ms未満が数学的に絶対検出不能」という断言ではない。

s=0.08は観測推定ではなく上の仮想直線例。幅≤10msからcでその傾きを保証することはできず、実データに基づく X は **`not found`**。平坦なc−4なら検出可能なδはさらに大きくなる。粗い7点では特に端の8ms間隔に未観測の形状があり、仮定なしの1〜2ms境界推定もできない。

完了した縮小研究からは「指定host/toolchain/load条件・fixture・T=100msで、事前指定点のtimeout割合にどの程度の差を観測したか」を区間付きで報告できる。新protocolの解析が妥当と確認できれば粗い水平移動の整合性も調べられる。sub-ms overhead、厳密な±2ms等価性、既定5秒deadline、実戦略・botMain・chain・他hostへの一般化、競技成績、G3合格は結論できない。

## 6. 既存閾値をどう扱うか（変更なし）

| 条件／閾値 | 縮小案での扱い |
| --- | --- |
| positive 積分差3〜9ms | 科学的な期待範囲は残るが、**推定量と誤差の再導出が必要**。現行 `0.5×ΣΔ` を非等間隔7点へ適用できない。台形積分 `Σ(d[i+1]−d[i])(Δ[i]+Δ[i+1])/2` 等を別protocolとして定義し、欠測区間の形状・離散化誤差・process相関を評価してから同じ範囲を適用できるか確認する。狭い格子で通らないから3〜9を拡張しない |
| sensitive c−4、Δ≥0.5 | 同じ点と同じ割合推定量なので**数値基準は維持可能**。ただしn=640→96、R=16→24、N=40→4で合格確率・区間が変わる。上記powerを再導出し、Δ=0.5で高確率に合格するとはしない |
| negative 積分差の絶対値≤2ms | **積分推定量／有限標本の誤差を再導出**。閾値は緩和しない。粗い積分の区間が±2msを識別できなければ「この設計では未判定」。単純なno-significanceで置き換えない |
| 端点 low≤0.125、高端≥0.875（両arms） | offsets±12を残すので**同じ記述的基準を維持可能**。標本数を反映した不確実性は別途表示。例えばeffective n=24で全成功でもWilson片側の値を流用せず、両側95%上限は約0.138で0.125を上回る。点推定の通過と母比率の保証は別。失敗なら範囲の自動拡張や採択し直しをしない |
| balancedPoint／予定n | AB/BA半々は維持。control n=96、main n=256と7点を事前保存し、検証側の期待値を新protocolに一致させる必要。分母はdecides、独立単位はprocessとして区別 |
| positive B boundary delayHits ≥ boundaryRepetitions | 現行は16回以上。提案R=24なら式のまま24回以上で、緩和しない。hit数だけでは曲線感度を証明しない。warm-up hitsは除外、実値とphase別整合性を保存 |
| width≤10ms、calibration median error≤1ms、load guard、probe構造、完了条件 | **維持**。新explorationの適合・全予定sample完了を確認。旧rejected探索の再ラベル付けはしない。rewarm imbalanceの既存記述警告（差≥2かつ相対差≥10%）も維持 |

疎な点での積分誤差には分布非依存の小さい上限が自動的に付くわけではない。現行controlsのPASS表示を縮小案に転用しない。再導出で同じ解釈を維持できなければ、閾値を緩めず、点別差のsupporting studyとして報告する。ここでは新しいcontrol verdict実装・合否の再判定は行っていない。

## 7. リスクと未検証事項

- Mac miniはbackground services共有。load平均は瞬間的な競合・熱／周波数・I/O待ちを除去しない。AB/BAとshuffleはdriftの影響を減らすが消さない。新runのサービス一覧、温度、実際の負荷推移は `not found`。
- [timing-wait.mjs](timing-wait.mjs) はdwell全区間で1 coreをbusy-spinする。positiveの親listenerも6ms spinし、自己負荷を生む。coordinator calibrationの通過はWorkerの将来のpreemptionやIPCを保証しない。
- load既定は [timing-options.mjs](timing-options.mjs) の絶対値2.5。旧explore2は5.0・maxObservedLoad1=4.603516、timeout summaryの確認設定は8。これは既定条件の証拠ではない。設定・理由・実load・Node v24.13.1／tsx 4.23.13・overrideをそのrunごとに開示する。本メモはload閾値の緩和を推奨しない。旧noteの「negative controlがnoiseを検証する」という表現も、negative未完了では証拠にならない。
- N=40→4は単なる間引きではなく、W回warm-up後の最初の4測定を多くのprocessで観測する設計になる。JIT／cache／worker年齢に依存すれば元の40回平均と対象分布が変わる。W=5が十分という新たな実証はなく、旧runとの差をprobe効果と解釈しない。
- timeout増→rewarm増→load増→分布変化という経路がある。process内の相関、arm別Rの差、時間順の偏りを報告する。単にN回を独立二項と数えて狭いCIを出さない。
- 保存JSONは旧版と新runが混在。ファイル名の日付やplanned/runningだけで完了を判断しない。新spinのraw・log・source hash・calibration・正確なelapsedが揃わないため、本稿の新runコスト係数／c／曲線感度は未検証。

参照したローカルソース: [TIMING-HARNESS.md](TIMING-HARNESS.md)、[measure-timing.mjs](measure-timing.mjs)、[timing-sweep.mjs](timing-sweep.mjs)、[timing-unit.mjs](timing-unit.mjs)、[timing-arm.mjs](timing-arm.mjs)、[timing-delay.mjs](timing-delay.mjs)、[timing-fixture.mjs](timing-fixture.mjs)、[timing-wait.mjs](timing-wait.mjs)、[timing-calibration.mjs](timing-calibration.mjs)、[timing-options.mjs](timing-options.mjs)、[loader-timing.test.mjs](../tests/loader-timing.test.mjs)、stock `strategyRunner.ts`、root `AGENTS.md`。scratchpadの実行シェルはログの場所を探すため文字列検索のみ、実行していない。

実施はローカルread-only参照、Python標準ライブラリによるJSON集計・係数／power計算・source hash比較、この1文書の作成のみ。Node scripts、計測、テスト、typecheck、ネットワーク、commit、pushは未実行。typecheck／関連テストは今回の明示的なNode禁止に従い **未検証**。文書の空白検査は末尾の検証記録を参照。

## 付録: 計算の再現方法（読み取りのみ）

本稿を生成したPython計算と同じ主要式。workspace rootから実行する場合の再現用で、計測プロセスは起動しない。ファイルが差し替わっていれば冒頭SHAが異なるため、本稿の係数と混ぜない。

```python
import json, math, re, hashlib, statistics as st
from pathlib import Path
from datetime import datetime
p = Path("/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer/3fa0e378-4bdf-4ccc-9162-233272c6689c/scratchpad/mini-controls/explore2.json")
x = json.loads(p.read_text())
raw = x["raw"]
u = [r[a] for r in raw for a in "AB"]
W, N = x["config"]["warmupDecides"], x["config"]["measuredDecides"]
C = lambda a: sum(a["durations"].values()) + sum(
    d["wallMs"] for k in ("warmup", "decides") for d in a[k])
elapsed = (datetime.fromisoformat(x["finishedAt"])
           - datetime.fromisoformat(x["startedAt"])).total_seconds()
res = (elapsed - sum(map(C, u))/1000
       - len(raw)*x["config"]["cooldownMs"]/1000)/len(u)
H = res + st.mean(sum(a["durations"].values()) + sum(
    d["wallMs"] for d in a["warmup"] if d["phase"] == "initial")
    for a in u)/1000
blocks = [a["warmup"][i:i+W] for a in u
          for i in range(W, len(a["warmup"]), W)]
B = st.mean(sum(d["wallMs"] for d in b) for b in blocks)/1000
F = st.mean(d["wallMs"] for r in raw
            if r["phase"] == "exploration" and r["durationMs"] == 0
            for arm in "AB" for d in r[arm]["decides"])/1000
Lt = st.mean(d["wallMs"] for a in u for d in a["decides"]
             if d["timedOut"])/1000
print(hashlib.sha256(p.read_bytes()).hexdigest(), elapsed, H, B, F, Lt)
def proc(d, q, n):
    return H + n*((1-q)*(d/1000+F)+q*Lt) + (n-1)*q*B
for label, R, overhead, budget in [
    ("positive", 24, 0, 30), ("negative", 24, 0, 30),
    ("main", 64, 24, 90)]:
    pairs = 7*R + overhead + 2
    # c=97.5 is inferred from timeout-summary configuration, not new raw.
    seconds = 7*R*(2*proc(97.5, 1, 4)+1.5)
    seconds += (overhead+2)*(2*proc(0, 0, 4)+1.5)+1.6
    if label == "positive":
        seconds += pairs*(4+5*4)*0.006
    print(label, pairs, seconds/60, budget-seconds/60)
z, z80 = 1.959963984540054, 0.8416212335729143
for n in [96, 24, 256, 64]:
    se = math.sqrt(0.5/n)
    mde = (z+z80)*se
    print(n, "delta95", z*se, "MDE80", mde, "ms if s=.08", mde/.08)
```

検証記録: 指定ファイルのみの `git diff --check -- ascon-notes/league/g3/loader/TIMING-COST-MODEL-2026-10-10.md` を実行し、exit 0・診断なし。新規ファイルの内容も検査するため `git diff --no-index --check /dev/null ascon-notes/league/g3/loader/TIMING-COST-MODEL-2026-10-10.md` を併用し、空白エラーの診断なし（exit 1は追加差分あり）。最終追記後にも同じ2コマンドを再実行し、同じ結果を確認。
