# inc-zeta 弱点診断・release 準備（2026-10-05）

対象は既見の診断ログ。資格判定や将来性能の主張ではない。upstream-eval HEAD `8303d85c1ac80792ad7c17da97b78c46df40bbc7` を読み取り、計測は起動していない。

## 証拠と方法

- 主対象: `../upstream-eval/ascon-notes/eval/out/incz-inc-zeta/index.tsv` の全12 run、seed40005、F_ref。各 run の `summary.json` / `market.json` / `blocks.csv` / `agents/cand.jsonl`。
- 比較: mix1a/mix1b/mix2a/mix2b の同4レジーム・seed40001–40004（16世界、**inc-zeta.jsonl** を使用。mix の cand は xb-r）、D0=`fref-inc-zeta` の informed-flow/vuln・201/202（4世界）、u1m の同4レジーム・201–203（12世界）。計44世界。D0 には cex-drift/lending-incident の行がない。
- 再計算スクリプト: [diagnose-inc-zeta.py](../eval/diagnose-inc-zeta.py)。数値・run_dir・ファイルSHA256・各分類は [inc-zeta-diagnosis.json](../eval/inc-zeta-diagnosis.json)。このworktreeだけに出力する。
- 成功現物取引の signed quantity を q（買い正）、約定単価を p、包含ブロック fair を f、終了 fair を F として、`E=Σq(f−p)`、`M=Σq(F−f)`。E は取引所手数料・実際の価格影響を含む実受払からの約定寄与。M は取得/売却後の評価価格変化による在庫寄与。`P−Pnoop = E+M−G+R`。R は専門モジュール・評価差等を含む残差として残す。
- G は `gasUsed × min(priorityFeeWei,maxFeePerGasWei) × 終了WETH価格`。4世界では全receiptが `maxFee=tip` のため effective gas price はこのcapと一致する。base fee 自体はCSVにないので、**base fee / 実際に支払った priority 部分の厳密な分離は未検証**。下表の「上乗せ相当」はcapのうち0.1 gwei超の会計分解であり、低入札時の反実仮想利益ではない。
- 開始ブロック以前ではなく、market artifact に存在する開始ブロックから最終ブロックまでのreceiptを含める（開始境界で成立した eUSD 購入も含む）。終了後の提出を期末損益へ混ぜない。ログは完全な `AgentObservation` を保存していない。残高はreceipt notionalsからの浮動小数再構成であり、独立したchain残高取得ではない。

## 4世界の事実

単位USDC。Rは約−0.50で、これを無視して損益を一致したことにしない。

| レジーム | P−noop | E 約定 | M 期末までの在庫評価差 | G gas総額 | E+M | R |
|---|---:|---:|---:|---:|---:|---:|
| cex-drift | −52.790 | +298.655 | −140.867 | 210.078 | +157.788 | −0.500 |
| informed-flow | −131.394 | +1542.237 | −1490.924 | 182.207 | +51.313 | −0.500 |
| lending-incident | −104.838 | +4095.161 | −3991.896 | 207.603 | +103.265 | −0.500 |
| vuln | −142.104 | +2113.302 | −2092.861 | 162.045 | +20.441 | −0.500 |

約定時点の正の寄与を在庫評価差が相殺し、残った E+M より gas が大きい。約定の機会損失を金額に推定して足してはいない。

| レジーム | 包含tx / mined revert | gas units | ETH支払 | 0.1 gweiまで / 超過分相当(USDC) | 期末 WETH / WBTC（再構成） |
|---|---:|---:|---:|---:|---:|
| cex-drift | 304 / 0 | 36,265,133 | 0.066976 | 11.375 / 198.703 | 11.101545 / 0.135384 |
| informed-flow | 227 / 1 | 26,609,164 | 0.059683 | 8.124 / 174.084 | 8.000000 / 0.429962 |
| lending-incident | 259 / 0 | 30,341,673 | 0.069676 | 9.040 / 198.563 | 5.329393 / 0.266745 |
| vuln | 250 / 0 | 30,029,542 | 0.053434 | 9.107 / 152.938 | 8.000000 / 0.069526 |

初期在庫は WETH=8、WBTC=0.4。期末ETHは各0.93–0.95で、4世界ではgas枯渇ではない。特に cex-drift/lending/vuln は方向性在庫が初期から大きくずれている。通常の単脚取引と、バンドルの片側失敗を区別する。

### 片脚と回収

4世界の成功バンドルleg数が2未満なのは informed-flow の1組だけ。他3世界は0。informed-flow は `runs/2026-10-04T22-17-11-594Z`:

1. 観測1508 → 包含1509: Curveで766.112718 USDCを払い0.25824770165850336 WETHを取得。hash `0x261cebb9b9474b66cb6a3035f99dcbe43cca7d0dadabb5771ffb1c031423c856`。
2. 同1509: Balancer売りlegは **mined revert**。hash `0xc3c7e27fd9da26caf2ce982b88920206a8004427978c8bd2f8adcf5fc7944746`、gas62,430、cap0.1 gwei（終了評価で約0.0191 USDC）。receiptにはrevert理由がない。
3. 観測1509 → 包含1510: Uniswapで**取得量と同量**を売却、receipt success。hash `0x9492b2482c011b87074d4a83ec45fcf4f5f8e2a83fea9894136571ea92e5b81d`。数量回収は追跡できる。売却単価2955.41486758は購入単価2966.58097276を下回るため、回収したことと利益は別。

別途、観測1572の Balancer `submit_failed` が1件（`BAL#507`）。これを上のmined revertの理由と同一視しない。mined revertの原因はreceiptだけでは確定できず、**理由の完全同定は未検証**。他3世界のsubmit_failedは0。包含比は1/227=0.4405%なので、この診断世界は新契約の0.1%条件を満たさない（新資格への遡及判定ではない）。

### Liquity / launch / 通常裁定の相互作用

- **事実:** 全4世界で初期に2500 USDCの `liquitySwapEusd` と `liquityProvideToSP` 各1件のみ。期末SPは2499.131005 EUSD、wallet eUSD=0、Trove debt/collateral=0。Liquity redemption/liquidation/withdraw・launch rawTxは4世界とも0。`unpricedHoldings=[]`、failedReads=0。
- **評価:** SP預入はSDKの評価対象（`sdk/src/protocols/liquity.ts:1393`、`:1535`）。自前コントラクトに残したゼロ評価資産ではない。小口売値1.000296で概算するとSP寄与は−0.129252、なお−0.370732程度の残差がある。実際の評価は全保有量でのown-size quote/境界評価を使うため、小口価格と一致しない。残差全体約−0.50はその専門資産・評価差と整合するが、個別mark読取値はログにないため断定しない。SP資金2500 USDCが使えない機会費用も未測定。
- **事実:** `agent.ts:37` の `excessWeth = weth−initialWeth` に由来すると見られる、超過WETH全量のUniswap売りが、receipt数量と開始8 WETHアンカーの照合で48/44/53/25件見つかった。該当売却群の E は−8585.071 / −3018.897 / −3250.665 / −1148.251。多くの買い取引の正のEと対になるため、これらを独立した損失総額として加算しない。
- **コード上の事実:** 超過WETH売りはLiquity redemptionの有効時にdeltaより先に走るが、WETHが償還由来か通常裁定由来かを区別していない。`inventoryBandBps=0`、delta `endgameNoNewBlocks=0`。WETHの売却は必ずしも「償還の出口」とは限らない。ただしログに呼出元タグはなく、48等の件数は**数量に基づく推定分類**。
- **コード上の事実:** `runtime/send.ts:518` は自己以外の全senderの最大tipを競合とするため、oracle/flowも含む。再構成fixtureでもこれに合わせた。zetaはこの値+0.1gweiを狙い、上限5gwei・想定利益30%・gasPerSwap140000で制限する。
- **推測:** 高額な優先入札、通常裁定買いとLiquityの超過WETH売りの往復、WBTC単脚在庫の方向性が弱点候補。どれを変えると全レジームの終了Pが改善するかは未測定。oracleを除けば約定順も変わり、超過売りを止めれば回収・期末在庫リスクも変わる。

### 終了時valuationの区別

`summary.agents[].pnlUsdc` と `valueSeries.epochSeries` の最終境界を採用した。legacy `finalValueUsdc` や mid の `markedValueUsdc` で置き換えない。

| レジーム | 採点境界 V_K(cand) | legacy finalValueUsdc | markedValueUsdc |
|---|---:|---:|---:|
| cex-drift | 77251.236434 | 77241.767392 | 77252.106468 |
| informed-flow | 76287.338106 | 76189.890349 | 76288.208140 |
| lending-incident | 75305.200282 | 75338.448899 | 75306.070316 |
| vuln | 76031.578469 | 76031.478718 | 76032.448503 |

scorer根拠は `core/src/scoring/epochPnl.ts` と `core/src/realtime/coordinator.ts` のsummary生成。4世界の開始capitalはnoopと同じendowment。上記の列差を収益や未回収損失として重複計上しない。

## 過去ログとの照合

各セルはnoop割れ件数とP−noop範囲(USDC)。レジーム間/場間でTを混ぜていない。

| レジーム | mix1 (2seed) | mix2 (2seed) | D0 (2seed) | u1m (3seed) |
|---|---|---|---|---|
| cex-drift | 2/2, −672.3〜−209.0 | 0/2, +234.6〜+1207.9 | ログなし | 1/3, −1116.6〜+1224.1 |
| informed-flow | 1/2, −370.0〜+265.3 | 0/2, +514.6〜+932.3 | 1/2, −1388.2〜+449.8 | 0/3, +19.4〜+1401.6 |
| lending-incident | 1/2, −243.5〜+922.7 | 0/2, +222.4〜+718.1 | ログなし | 1/3, −701.7〜+1515.2 |
| vuln | 2/2, −557.5〜−101.9 | 1/2, −354.9〜+175.9 | 1/2, −792.5〜+402.3 | 0/3, +97.4〜+309.3 |

照合した過去32世界も E>0、M<0、gas>0という会計傾向は共通。ただしnoop割れの符号はseed/対戦構成で変わり、レジーム固定の必敗とは言えない。D0は既存記録のcommit不一致G0 FAILを保持。u1mは旧版/旧評価のため専門資産等の残差が約−1.19〜−1.74と異なる。mix1の既存G0 BLOCKEDも取り消さない。比較は診断限定。

## release同一性と最小修理の判断

`ascon-zeta-r` は ascon-zeta をコピーし、delta既定を `bidMode=2, bidProfitShareBps=3000, gasPerSwap=140000` に固定、`ASCON_DELTA_PARAMS` 読取を除去した。agent.ts/launch.tsはbyte一致。元ascon-zetaは計測worktreeと同じtree hash `3a9f3cc0076f6e64625be4150967af8d7e693268d6951446587c75061f0ebe3b` のまま。incz、mix1a、mix2aの測定manifestに記録された対象tree hashとも一致することを読み取り照合した。

[test/ascon-zeta-r.test.ts](../../test/ascon-zeta-r.test.ts) は、incz2窓・mix1/2各1窓の連続8フレーム（合計32、active19）で、元ascon-zeta+測定envとrelease+envなしの `decide` 全出力一致を確認。fixtureにはrun/log行番号・SHA256を保存。赤対照はbidModeを0へ→19不一致、gasを200000へ→13不一致、配分を1000へ→17不一致。これらが0不一致ならテスト自体がFAILする。環境変数で既定を壊せないことも確認。

**限界:** 完全なobs/RPC履歴がないため、このfixtureは市場/receiptからの再構成で、Liquity/registry/RPCを含む完全historical replayではない。過去actionそのものの再現、閉ループ損益、全入力空間の同一性は主張しない。専門モジュールはbyte一致と既存の軽量テストで確認。

**Cは診断のみ。修理因子を実装しない。事前登録の推奨はBだけ。** 低入札化・WETH売却元の分離・WBTC在庫制限はいずれも執行/回収の振る舞いを変える。1診断seedから閾値を選んだり、回収安全を緩めたりしない。今回明らかになった会計的弱点は、全レジームに安全な小修理を立証するものではない。

検証: `npm run typecheck` PASS、delta/epsilon/zeta/release関連31テスト PASS。`npm run check:strategy -- <3 files>` はtsx CLIのIPC作成がsandbox EPERMとなり、同じスクリプトを `TSX_DISABLE_CACHE=1 node --import tsx scripts/checkStrategyCode.ts <3 files>` で実行し3files PASS（findings/hints=0）。

未検証: 新F_ref60世界、public backtest、Docker selftest、bundle/提出受理、推論改訂ON、実行費用残量、mined revert理由の完全同定。incz全12世界の軽量集計ではlaunchにSTF submit_failed87件もあるが、その全回収監査は本4世界の診断範囲外であり、安全0認定をしない。
