# dev2 xb-r 診断と次の決定論修理

2026-10-04。基準コード `2ae0d59`。計測・commit・資格seedの利用はしていない。
第1ブロッカーは引き続きQ0。F_refの**全12レジーム等重み平均 T ≥ multi-arb、各レジーム平均(T−Tnoop) ≥ 0、安全条件**を緩めない。
dev2は6レジーム×2seedの12世界であり、全12レジームの契約を判定できない。

## 原ログで確認できた事実

indexの実体は `../upstream-eval/ascon-notes/eval/out/dev2-xb-r/index.tsv`。
その `run_dir` 12本の `summary.json`, `agents/{cand,multi-arb,clean-arb}.jsonl`, `blocks.csv`, `market.json` を読み取りだけで分析した。
`example/agents/xb-r/agent.ts` は開始時点で2ae0d59と同一だった。

| 項目 | 観測 |
|---|---:|
| 1世界平均P cand / multi / clean | 148.96 / 1352.20 / 406.50 |
| includedTx 1世界平均 cand / multi / clean | 44.83 / 300.92 / 70.33 |
| cand P−noop 最小 / 負の世界数 | +147.66 / 0 |
| violations / valueSeries.failedReads / cand mined revert | 0 / 0 / 0 |
| multi / clean mined revert 全世界計 | 9 / 2 |
| cand submitted / submit_failed（レッグ数） | 538 / 23 |
| noop 共通理由 / 期限到達理由 | 3,924 / 9 |

submit_failedは `Too little received` 14、`Slippage` 5、`BAL#507` 4。
取引後のmined revertと区別する。推定サイズの拡大や低edge側の追加で、この事前拒否率が上がる可能性がある。
G0 PASS・362ループは依頼の計測引継ぎ。今回G0判定器を再実行していない。
依頼の平均T 44.36 vs 56.84と整合する低い競争成績であり、取引成立だけでQ0へ進める状態ではない。

**ゲートごとの実測内訳は復元不能**: candの3,924件はすべて
`no funded positive net edge at an affordable bid` という同一文面で、候補別reject理由も完全なAgentObservationも保存されていない。
deadline reserve・invalid observation・duplicateのnoopはログに0件。ただし共通理由内のfunding/gas等を0と断定していない。

## 再構成の方法と限界

再実行用: [diagnose-xb-r-dev2.mjs](../eval/diagnose-xb-r-dev2.mjs)。集計・入力hash:
[dev2-xb-r-analysis.json](../eval/dev2-xb-r-analysis.json)。

```sh
node --import tsx ascon-notes/eval/diagnose-xb-r-dev2.mjs ../upstream-eval /tmp/xb-r-dev2
```

- 各観測blockの事後再構成市場を使用。価格は小数6桁。元の実行時snapshotではない。
- cand残高は初期資金から成功receiptのbaseUnitsとcounter cash=`baseUnits * priceUsd`で再構成。`notionals.usd`は両側の最大評価なのでcashとして使わない。記録されたgasも控除。未記録の初期承認gas・丸め誤差は残る。
- Uniswapのactive liquidityはログにない。既存の300,000 USD fallbackを使用。`depthUsd`のpool総残高をactive liquidityと誤認しない。Balancer/Curveもobserveにreservesがないため既存fallback。
- 入札は同blockのmethodとreceipt baseからrouter/vault/poolへ対応付け、自分以外の全呼出しを対象とする。raw tx.to未保存のため近似。失敗Curveのbase不明や直接pool呼出しなどの完全な入札集合は復元不能。
- cooldownは実測attemptのblockSeenから復元。submit_failedもattemptとして扱う。参照との対応は**同じblockSeenで、後にreceipt successになった取引**。約定blockと観測blockを混ぜない。
- 反実仮想ごとにcandの実測残高・履歴を固定。追加取引を将来へ反映しない。相手価格・競争・在庫のフィードバックも固定。追加候補数は実際の追加約定数ではない。

対象4,329フレーム（noop 3,921、attempt 408）。開始block前のnoop 12件は市場がなく再構成から除外。
旧コードの取引有無一致は **4,084 / 4,329 = 94.3%**。
実attemptを再現237、実attemptを再構成で見送り171、実noopを再構成で取引74、双方noop3,847。
この差があるため、以下を確定的な原因寄与率・実現利益と呼ばない。

### 同ブロックで参照が取引した機会

cand noopと参照成功の重なりは**2,559 block**。multi 2,557、clean 251、重複249。
下表は旧コード順の**候補経路ごとの最初の拒否**。1block内に複数候補があるのでblock数も合算不可。
同経路欄はbase・venue・売買方向が一致する参照取引のある候補。bundleは一方のleg一致も含み、二脚全体の同一性を意味しない。

| 再構成ゲート | 該当block / 2,559 | 該当候補経路 | 同経路の参照成功に対応する候補 |
|---|---:|---:|---:|
| 正のedgeだがR3入口≤50bps | 2,463 | 7,994 | 527 |
| 新規単脚≤100bps | 1,437 | 2,350 | 320 |
| anchorへの復元量が50 USD未満 | 917 | 1,675 | 282 |
| ±20%在庫帯で50 USD未満 | 816 | 1,831 | 361 |
| 競合入札を10%追加予算で払えない | 317 | 478 | 100 |
| 2block cooldown | 110 | 660 | 85 |
| 終盤の新規単脚 / bundle禁止 | 各30 | 180 / 60 | 9 / 0 |
| 資金 / gas予備 / net利益0.05 / サイズ目標自体<50 | 各0 | 各0 | 各0 |

edge≤0は2,559block内45,768経路（同経路1,508）で、そもそも正の機会と扱わない。
再構成上eligibleなのに実noopだった73block・120候補もあり、これをゲート原因へ無理に割り当てない。
全対象では入札842、anchor dust1,846、在庫帯1,997候補。安全ゲート0はこの近似モデルの結果に限る。

## 因子別の反実仮想と設計判断

以下は旧コード比・1因子のみ（組合せ行を除く）。「追加」は再構成baseline noop→tradeの**意思決定回数**で、レッグ数ではない。
金額は追加意思決定のモデル上の実費後利益の和。gasを引いているが確率・将来価格・対戦干渉を扱わず、**実現期待Pでも厳密な利益下限でもない**。

| 緩和 | 追加意思決定 | 実noop内 / 参照対応noop内 | 追加分モデルnet合計USD | リスク・判断 |
|---|---:|---:|---:|---|
| ENTRY 50→20 | 57 | 53 / 27 | 70.35 | 小edgeとquote誤差。採用せず、初期60維持 |
| 新規単脚100→50 | 374 | 363 / 361 | 1,365.82 | 在庫露出・markout悪化。入口重複の原因診断 |
| 十分な新規edge時にanchor通過、帯は維持 | 290 | 271 / 270 | 5,418.40 | 反対側まで保有し得る。R6として採用 |
| 在庫帯20→40% | 573 | 542 / 532 | 15,304.25 | 価格変動時の終値損失と片脚露出増。採用せず |
| 入札を競合超え必須から旧budget bidへ | 473 | 302 / 300 | 964.62 | 相手より後になりstale/revert増。採用せず |
| 最小サイズ50→10（単脚・bundle） | 0 | 0 / 0 | 0 | gas効率悪化。維持 |
| サイズをdepth ceilingへ / 資産cap 8→16% | 各0 | 各0 / 0 | 各0 | この再構成では元から他制約が支配。維持 |
| net floor 0.05→0.01 | 0 | 0 / 0 | 0 | 小額・低余裕化。維持 |
| cooldown 2→0 | 0 | 0 / 0 | 0 | 未確定取引との競合増。維持 |
| 初期60＋単脚ゲートも60（R7） | 265 | 258 / 256 | 1,135.41 | 新既定入口に合わせる |
| 初期60＋R6＋R7 | 837 | 799 / 794 | 7,840.79 | 組合せの相互作用あり、各行を加算しない |

初期60だけでは旧再構成311意思決定から25件を失う。R6/R7込みは1,123意思決定
（311−25＋837）。これは固定残高を使ったモデル結果で、取引量・P・T向上の予測ではない。
実装defaultの出力が組合せ仕様と4,329フレームすべてで一致することをスクリプトで確認。

**H1との照合**: 二重入口、anchor dust、在庫帯、入札で機会が消えることは再構成で支持された。
最低サイズや最大sizeだけを変える設計は支持されない。まず帯を広げずにanchorの不連続を除く。
**H2との照合**: dev2コードには利益0の強制復元がなく、P−noopも全世界正。しかしそれだけで全ての往復が正とは言えない。
FIFO lot対応・実費後往復損益・markoutの分離は未実施。R6で復元が新規保有へ変わるリスクは残る。
DESIGN-REPAIR-01の「負の強制復元も許す」案は今回の安全条件と相反するため採用していない。

## 実装と回帰証拠

`example/agents/xb-r/agent.ts`だけで経済挙動を変更。参照multi-arb/clean-arbのコード移植なし。

- `R6_ANCHOR_CROSS`: 通常時は十分な新規edgeなら初期在庫を跨げる。残4blockは従来どおりanchorまで。±20%帯・資産8%cap・depth上限は不変。
- `R7_SINGLE_ENTRY`: 単脚にもENTRYを適用し、100bpsの追加拒否だけを外す。R6とは独立にOFF可能。R7 OFFでanchorを跨ぐ場合は100bpsを要求。
- `PARAMS`は両方ON、ENTRY初期60、範囲20–60・5bps刻み。AI用に留保するパラメータはENTRYだけ。R6/R7は固定コード因子。AI受付・更新をこの作業で実装したわけではない。
- `DEV2_PARAMS`はR6/R7 OFF・ENTRY50。旧112件のassertionをこの歴史設定でそのまま維持。新defaultは別11件で検証。
- canFund、候補ごとの累積予約、独立脚資金、0.05 ETH予備、正net、priority0禁止、実行先別競合入札、80bps slippage、deadline、2block cooldownを維持。

fixtureはdev2の4フレーム、約17KB。calm/31001 block 1315・1393・1493、cex-drift/31001 block 1380。
4ケースは旧2ae0d59で**AssertionErrorによる赤**、修正後緑。完全なruntime snapshotではなく、上述の再構成fixture。

検査結果:

```text
npm run typecheck                              PASS
xb-core + xb-variants + xb-r + xb-r-dev2        123 / 123 PASS
node test/xb-r-red-controls.mjs                25 / 25 intended RED
  historical controls                         19 preserved
  dev2 original source + new mutants           6 added
restored suite                                123 / 123 PASS, skipped 0
restored source sha256                         904f54a99326ffe36ad86d43421c2ffbf9c79670acd821624a5433ec4e9d874c
```

赤対照のログとhash確認は `/var/folders/yk/mx8jn78j6xq0w5l4z9d8hbvw0000gn/T/xb-r-red-controls-W0p8qC/`。
フルnpm test、Docker、外部ネットワーク検証、戦略の実走・bundle/selftestは実行していない。

## 次の診断とseed予約

**35001 / 35002を次の診断専用として予約（未実行）**。
upstream-evalの `runs/` と `ascon-notes/eval/out/` をrgで検索し、seed/flowSeedフィールド・TSV列・CLI seed引数・ファイル名は0一致。
league-v2にはこの2ディレクトリ自体が存在しない。価格小数やhash内の数字一致はseed使用と扱わない。
実行直前に他担当の新規利用を再監査する。41xxx・44xxx・Hfinalの結果は調整・fixture作成・反実仮想に一切使用していない。

```sh
rg -l --hidden -g '!*.env*' '("(seed|flowSeed)"\s*:\s*3500[12]\b|\b(seed|flowSeed):\s*3500[12]\b|\t3500[12]\t|--(?:seed|flow-seed)[ =]+3500[12]\b)' ../upstream-eval/runs ../upstream-eval/ascon-notes/eval/out
rg --files --hidden ../upstream-eval/runs ../upstream-eval/ascon-notes/eval/out | rg '35001|35002'
```

次は **F_ref/FROZEN、35001/35002 × 全12レジーム = 24世界、p3、18＋6世界**を提案。
今回欠けた6レジームも含め、現Q0の等重み平均Tと各レジーム対noop・安全を診断する。
defaultを事前凍結し、途中結果を見て残りのパラメータやseedを変更しない。この診断を資格PASSと呼ばない。
追加の因子調査が必要なら使用済み31001/31002だけで行い、35001/35002の結果を見て反復最適化しない。

実測世界本体は721,554–722,016ms（約12.03分）、dev2のp3投入間隔は約12.5分。
計画は20%余裕を含め1batch約15分、8batch＋chunk終了確認20分で**約2時間20分**。
新コードの取引増による遅延は未測定なので再校正前の概算。CPU排他・費用台帳・候補/参照hashは実行前に確認が必要。

**未検証**: 新版の実現P/T、Q0、安全条件の実走確認、過去未計測の6レジーム、実費後往復損益、正確なruntime観測に基づくゲート寄与。
コード上の安全制約とユニットテストが通った事実を、新版の実測性能や資格合格へ読み替えない。
