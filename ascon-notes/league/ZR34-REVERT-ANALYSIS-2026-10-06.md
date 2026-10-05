# zr3 / zr4 ascon-zeta-r2 revert 分析（2026-10-06）

**[derived] cand の mined revert は zr3（48002）0件、zr4（48003）2件。zr4 は calm と lending-incident の各1件で、いずれも包含数1000未満のため提示された基準4に適合しない。これは F_ref 診断の評価であり、Q-ZETA-02 の結果ではない。[inferred] 今回は単一変更を採用せず、r3・r3テストは作成しない。価格競合の証拠はあるが、利益を保つ cushion または取引を抑制しない freshness 閾値を確定するデータが不足する。live での改善は未検証。**

## 1. 対象・証拠の区別

- [directly-observed] cwd は `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/league-v2`、branch は `league/v2`。書込みは本新規Markdownのみ。r2、Q-ZETA-02.md、lock/roster/auditファイルを変更していない。mini の結果は取得していない。
- [directly-observed] `E = /Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/upstream-eval`。`ZR3-01` 等は付録Aの `E/run_dir`。例 `ZR4-01/agents/cand.jsonl:354` はその実ファイルの354行目。コードは league-v2 相対。market.json は各世界1行なので `market.json:1` とJSONキーを併記する。
- `directly-observed` = 保存された行・現行コードの事実、`derived` = hash結合・集計・数式による値、`inferred` = モジュール/方向/原因/効果の推定。原因の推定をreceiptの確定reasonとして扱わない。
- [directly-observed] 全24世界の summary.json、blocks.csv、4 agent のjsonl、market.json、events.jsonlを照合。34,656件の observation はすべて `reconstructed:true`。失敗2件の観測位置も完全な決定時入力ではなく、block終了時の事後再構成である（`ZR4-01/events.jsonl:5948,5952`; `ZR4-05/events.jsonl:5806,5810`; 生成コード `core/src/realtime/reconstruct.ts:1264`）。
- [directly-observed] submittedログにはhash/nonce/fee/actionType/base/amount/blockSeen/bundle情報はあるが、成功送信時のcalldata、minOut、own-size quote、quote読取blockは保存されない（`example/agents/runtime/send.ts:277,359`）。blocks.csvにもcalldata、gas limit、revert payload/traceはない（`core/src/realtime/coordinator.ts:2770`）。今回の2hashはmarket.notionalsにもない。
- [directly-observed] r2の5ファイル（agent.ts、delta.ts、launch.ts、launchSwap.ts、prompt.md）はC/Eの現行コピーでbyte一致。これは実行当時の完全なソースsnapshot認証ではない。

## 2. 再集計

| 指標 [derived] | zr3 / seed 48002 | zr4 / seed 48003 |
| --- | ---: | ---: |
| 世界数 | 12 | 12 |
| cand submitted | 2,779 | 2,966 |
| cand included（失敗を含む） | 2,774 | 2,960 |
| cand mined revert / 該当世界数 | 0 / 0 | 2 / 2 |
| revert / 世界（未丸め） | 0 | 0.166667 |
| cand submit_failed | 32 | 14 |
| submitted + submit_failed | 2,811 | 2,980 |
| submit_failed / 全送信試行イベント | 1.1384% | 0.4698% |
| submittedとの差：窓内未包含 | 5 | 6 |

[derived] `14/2980` の2980は **成功した送信イベント2966 + 失敗試行14**。14はsubmitted2966の部分集合ではない。zr4の平均0.2は2/12を小数1桁に丸めた値。未包含の11hashは全てblockSeen=summary.finalBlockであり、窓外で最終的に包含されたかは未検証。全24世界・全4agentでsummaryのincluded/revertとblocks.csvが一致し、unloggedTxCountは0。出典は付録Aの全summary/blocks/agentログ。

## 3. mined revert 全2件（zr3 は該当なし）

[directly-observed] fee は2件ともpriorityFee=maxFeePerGas=100,000,000 wei（0.1 gwei）。[derived] action等はsubmittedとreceipt行をhashで一意に結合。base省略はWETHを意味する（`example/agents/runtime/send.ts:367`; `sdk/src/protocols/curve.ts:277`）。blocks.csvの `direct` / 空bundle列だけでは単独取引と判断しない。

| ID | 世界・regime/seed [directly-observed] | hash [directly-observed] | 観測→包含 / txIndex [directly-observed] | method / action / base [derived] | amount raw / nonce / gasUsed [directly-observed] | module・方向 [inferred] | 出典 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | ZR4-01 calm/48003 | `0x00c3d330ff234f59b71382649a0c82dabe89cbaae14846effabf0ade0325d32d` | 1606→1607 / 19 | exchange / curveSwap / WETH | 1354179 / 302 / 79676 | delta single、USDC→WETH（1.354179 USDC） | `ZR4-01/agents/cand.jsonl:354`; `ZR4-01/blocks.csv:7230` |
| R2 | ZR4-05 lending-incident/48003 | `0xf1e37214a2b18256a5271a619a31a4a41a177ce33f6fe8b4d14a407d4b062341` | 1590→1591 / 23 | exactInputSingle / swap / WETH | 26786681109525180 / 211 / 103709 | delta bundle sell leg1、WETH→USDC（0.02678668110952518 WETH） | `ZR4-05/agents/cand.jsonl:297`; `ZR4-05/blocks.csv:5889` |

[derived] R2のbundleIdは `2026-10-05T16-46-51-767Z:1590:247294dd`。leg0は `0x5a2a21a3509a7f5b757b26c323ac9d86a568f1e58a0ad62560090a0b9f8a1ed7`、81724306 raw USDC、nonce210、同blockのindex20でCurve買い成功（`ZR4-05/agents/cand.jsonl:296`; `blocks.csv:5886`; `market.json:1` notionals[hash]）。買い出力は0.027255994713032392 WETH。売りは独立txでありbundleは原子的でない（`example/agents/runtime/send.ts:335`）。

[inferred] R1はCurveかつbundle情報なし、事後fair>venueでdeltaのsingle買い分岐と整合（`example/agents/ascon-zeta-r2/delta.ts:224,239,260`）。R2は同bundleのCurve買い→Uni売りと `delta.ts:216` が整合。現行コードからslippageはR1=75 bps、R2=120 bpsと推定する（`delta.ts:9,11,217,261`）。実txのminOutから確認した値ではない。launch rawTxやLiquity本体、r2の回収売りを示す証拠はない。

### 3.1 観測blockと包含blockの状態

[directly-observed] 以下は `market.json:1` のseries[block].fair/venues。**agentが実際に読んだquoteおよび失敗tx直前状態ではない。**[derived] buyの出力減少率は `10000*(1-buy_old/buy_new)`、sellは `10000*(1-sell_new/sell_old)`。価格上昇率と買い出力減少率を区別する。

| ID | fair WETH [directly-observed] | venue mid [directly-observed] | 方向別probe価格 [directly-observed] | 不利変化 [derived] | 出典 |
| --- | --- | --- | --- | --- | --- |
| R1 | 3088.360440→3096.745470 | Curve 3021.658039→3054.970385 | buy 3032.369958→3066.920261 | buy価格 +113.9383 bps / 出力 -112.6547 bps | `ZR4-01/market.json:1` series[1606,1607] |
| R2 | 3090.963414→3080.818457 | Uni 3025.973056→2980.408832 | sell 3016.895137→2971.467606 | 出力 -150.5771 bps | `ZR4-05/market.json:1` series[1590,1591] |

| ID | 同base・同venueの先行成功flow [derived] | 出典 |
| --- | --- | --- |
| R1 | #12 flow-curve:informed 買い0.4390028304 WETH、0.153 gwei；#13 flow-curve:uninformed 買い5.4709690288 WETH、0.137 gwei（fair評価notional $1,359.48 / $16,942.20）。#14のflowもrevert、0.128 gwei。 | `ZR4-01/blocks.csv:7223,7224,7225`; `market.json:1` notionals[対応hash] |
| R2 | #16 informed 買い0.6086703014 WETH、0.163 gwei；#18 uninformed 買い0.0972634603 WETH、0.127 gwei；#19 uninformed 売り8.313083 WETH、0.106 gwei（fair評価notional $25,611.10）。#17はWBTCなのでWETH競合に数えない。 | `ZR4-05/blocks.csv:5882,5884,5885`; `market.json:1` notionals[対応hash] |

[inferred] 2件とも遅い0.1 gweiの包含と、先行する不利方向flowがprice-race/minOut違反仮説を支持する。receiptのrevert reasonがないため、R1を確定Slippage、R2を確定Too little receivedとは呼ばない。意図的front-run・gas不足・allowance原因の確定/完全除外もできない。blockSeenから包含まで1blockという事実は、adapterのquoteも必ず同じblockだったことを意味しない。

### 3.2 multi-arb の同世界 / 同method revert

| ID | 同世界の全revert / 同method数 [derived] | 同block・同method [directly-observed] | 出典 |
| --- | --- | --- | --- |
| R1 | 2 / exchange 1 | block1607 #20、hash `0x40ae6bc79a14b340396463d6133ed5d211da52f4e5c193bd325e728877ac56fa`、gas79676、0.1 gwei。candと同gas。 | `ZR4-01/blocks.csv:2018,7231`; `agents/multi-arb.jsonl:356`; `summary.json:438` |
| R2 | 10 / exactInputSingle 4 | block1591 #24、hash `0x03baf2d41379077d6550722daf2f256b198b4b55b4d2708dfc880de91686fa25`、gas103743、0.1 gwei。 | `ZR4-05/blocks.csv:1388,5662,5890,7528`; `agents/multi-arb.jsonl:298`; `summary.json:465` |

[derived] R2世界の残るmulti-arb revertはBalancer swap 3、Curve exchange 3（`ZR4-05/blocks.csv:1273,2382,5267,5480,5616,6513`）。clean-arbもblock1591 #25でexactInputSingle revert（`blocks.csv:5891`）。[inferred] 参照も同じ価格競合を受けた可能性が高いが、同reasonとの証明ではない。

## 4. submit_failed 原因文字列ヒストグラム

[directly-observed] 全46件のerror先頭行は下記3種類のみ。表の省略名はそれぞれ `Execution reverted with reason: Too little received.` / `Execution reverted with reason: BAL#507.` / `Execution reverted with reason: Slippage.`。[derived] 未分類0。全件venue swap、STF/残高不足/nonce/transportという先頭reasonは0。**文字列を全分類できたことは、各件の価格変化や内部根本原因を確定したこととは異なる。** send失敗はmined revertと別集計（`example/agents/runtime/send.ts:284,348`）。

| action / protocol | reason [directly-observed] | zr3 [derived] | zr4 [derived] | 合計 |
| --- | --- | ---: | ---: | ---: |
| swap / uniswap | Too little received | 5 | 2 | 7 |
| balancerSwap / balancer | BAL#507 | 17 | 10 | 27 |
| curveSwap / curve | Slippage | 10 | 2 | 12 |
| 合計 | | 32 | 14 | 46 |

[inferred] 出力下限/価格競合クラスが有力。今回のログには失敗試行のerrorとcalldata情報がある一方、同じ取引の採用前quoteと不利変動の時系列はないので、46件を「同一価格競合原因が確定」と数えない。BAL#507も観測値はコード文字列そのものであり、内部理由の独立再現はしていない。

[derived] 次表は全46行を重複なく列挙。baseはログ値、省略はWETH。legの `single` はbundleIndexなし。全件amountが記録されておりadapter build失敗だけの行形状ではないが、失敗したRPC段階はログから確定しない。ZR3-04の335/336行は同bundleのleg0/leg1両方が失敗し、理由はそれぞれBAL#507/Slippageである（残高不足とは記録されていない）。

| 世界 | cand.jsonl行 [directly-observed] | blockSeen | action | base [derived] | leg | reason |
| --- | ---: | ---: | --- | --- | --- | --- |
| ZR3-01 | `agents/cand.jsonl:35` | 1318 | swap | WBTC | single | Too little received |
| ZR3-01 | `agents/cand.jsonl:318` | 1596 | balancerSwap | WETH | single | BAL#507 |
| ZR3-03 | `agents/cand.jsonl:80` | 1363 | swap | WBTC | single | Too little received |
| ZR3-03 | `agents/cand.jsonl:419` | 1630 | balancerSwap | WBTC | single | BAL#507 |
| ZR3-04 | `agents/cand.jsonl:191` | 1478 | balancerSwap | WETH | single | BAL#507 |
| ZR3-04 | `agents/cand.jsonl:192` | 1479 | balancerSwap | WETH | single | BAL#507 |
| ZR3-04 | `agents/cand.jsonl:193` | 1480 | balancerSwap | WETH | single | BAL#507 |
| ZR3-04 | `agents/cand.jsonl:197` | 1483 | curveSwap | WETH | single | Slippage |
| ZR3-04 | `agents/cand.jsonl:201` | 1486 | swap | WETH | single | Too little received |
| ZR3-04 | `agents/cand.jsonl:239` | 1521 | balancerSwap | WETH | single | BAL#507 |
| ZR3-04 | `agents/cand.jsonl:335` | 1608 | balancerSwap | WETH | 0 | BAL#507 |
| ZR3-04 | `agents/cand.jsonl:336` | 1608 | curveSwap | WETH | 1 | Slippage |
| ZR3-04 | `agents/cand.jsonl:382` | 1652 | balancerSwap | WETH | single | BAL#507 |
| ZR3-05 | `agents/cand.jsonl:193` | 1500 | curveSwap | WETH | single | Slippage |
| ZR3-05 | `agents/cand.jsonl:194` | 1501 | balancerSwap | WETH | single | BAL#507 |
| ZR3-05 | `agents/cand.jsonl:196` | 1503 | curveSwap | WETH | single | Slippage |
| ZR3-05 | `agents/cand.jsonl:199` | 1505 | curveSwap | WETH | single | Slippage |
| ZR3-07 | `agents/cand.jsonl:282` | 1434 | balancerSwap | WBTC | single | BAL#507 |
| ZR3-09 | `agents/cand.jsonl:59` | 1354 | swap | WETH | single | Too little received |
| ZR3-09 | `agents/cand.jsonl:107` | 1402 | curveSwap | WETH | single | Slippage |
| ZR3-09 | `agents/cand.jsonl:110` | 1405 | curveSwap | WETH | single | Slippage |
| ZR3-09 | `agents/cand.jsonl:111` | 1406 | balancerSwap | WETH | single | BAL#507 |
| ZR3-09 | `agents/cand.jsonl:112` | 1407 | curveSwap | WETH | single | Slippage |
| ZR3-09 | `agents/cand.jsonl:185` | 1478 | balancerSwap | WBTC | single | BAL#507 |
| ZR3-09 | `agents/cand.jsonl:204` | 1496 | balancerSwap | WETH | single | BAL#507 |
| ZR3-09 | `agents/cand.jsonl:205` | 1497 | balancerSwap | WETH | single | BAL#507 |
| ZR3-09 | `agents/cand.jsonl:206` | 1498 | curveSwap | WETH | single | Slippage |
| ZR3-09 | `agents/cand.jsonl:207` | 1499 | balancerSwap | WETH | single | BAL#507 |
| ZR3-09 | `agents/cand.jsonl:216` | 1505 | balancerSwap | WETH | single | BAL#507 |
| ZR3-09 | `agents/cand.jsonl:325` | 1611 | curveSwap | WETH | single | Slippage |
| ZR3-09 | `agents/cand.jsonl:356` | 1642 | swap | WETH | single | Too little received |
| ZR3-12 | `agents/cand.jsonl:280` | 1633 | balancerSwap | WBTC | single | BAL#507 |
| ZR4-01 | `agents/cand.jsonl:84` | 1366 | balancerSwap | WETH | single | BAL#507 |
| ZR4-03 | `agents/cand.jsonl:89` | 1367 | curveSwap | WETH | single | Slippage |
| ZR4-03 | `agents/cand.jsonl:92` | 1369 | balancerSwap | WETH | single | BAL#507 |
| ZR4-03 | `agents/cand.jsonl:140` | 1411 | balancerSwap | WETH | single | BAL#507 |
| ZR4-03 | `agents/cand.jsonl:225` | 1490 | balancerSwap | WETH | single | BAL#507 |
| ZR4-04 | `agents/cand.jsonl:234` | 1523 | balancerSwap | WBTC | single | BAL#507 |
| ZR4-06 | `agents/cand.jsonl:268` | 1536 | balancerSwap | WETH | single | BAL#507 |
| ZR4-08 | `agents/cand.jsonl:212` | 1499 | swap | WBTC | single | Too little received |
| ZR4-08 | `agents/cand.jsonl:261` | 1547 | balancerSwap | WETH | single | BAL#507 |
| ZR4-09 | `agents/cand.jsonl:157` | 1439 | balancerSwap | WETH | single | BAL#507 |
| ZR4-09 | `agents/cand.jsonl:158` | 1440 | curveSwap | WETH | single | Slippage |
| ZR4-09 | `agents/cand.jsonl:243` | 1520 | balancerSwap | WETH | single | BAL#507 |
| ZR4-09 | `agents/cand.jsonl:304` | 1572 | swap | WBTC | single | Too little received |
| ZR4-12 | `agents/cand.jsonl:23` | 1502 | balancerSwap | WBTC | single | BAL#507 |

[derived] 参考として参照agentのsubmit_failedも同じ3reasonで全分類した。数値は下表、行根拠は付録B。noopは両runとも0。

| label / agent | Too little received | BAL#507 | Slippage | 計 |
| --- | ---: | ---: | ---: | ---: |
| zr3-zeta-r2 / multi-arb | 4 | 6 | 4 | 14 |
| zr3-zeta-r2 / clean-arb | 1 | 1 | 0 | 2 |
| zr4-zeta-r2 / multi-arb | 0 | 3 | 4 | 7 |
| zr4-zeta-r2 / clean-arb | 0 | 0 | 0 | 0 |

## 5. 変更候補の評価：今回は採用なし

### (a) freshness / edge reserve

[derived] 失敗2例の不利な出力変化proxyは112.6547・150.5771 bps（3.1の式・出典、n=2）。この2例だけを包む整数reserveは151 bpsになる。しかしこれはminOutからの必要量でも、今後の分布上限でもない。選択バイアスを避ける参考として、全24世界のmarket.seriesの連続360区間 × 3venue × 2base × 2方向を同じ式で算出し、良化方向は0に丸めた。以下は **全市場probeの分布でありcandの発注条件付き分布ではない**。quantileはnearest-rank、元データは付録Aの各 `market.json:1`。

| label | N | >0 | p95 bps | p99 bps | max bps | >151 bps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zr3 | 51,840 | 20,756 | 16.7903 | 77.5007 | 1020.6657 | 81 |
| zr4 | 51,840 | 20,959 | 16.6193 | 76.8176 | 1012.5544 | 65 |

[derived] 最大値はzr3 whale/Balancer/WETH sell、block1404→1405（`ZR3-04/market.json:1`）、zr4 whale/Uni/WETH sell、1535→1536（`ZR4-04/market.json:1`）。Q-ZETA-01既存診断にもwhaleの約839.9 bps下落が記録されている（`ascon-notes/league/Q-ZETA-01-REVERT-DIAGNOSIS-2026-10-05.md:57`、既存二次資料）。

[inferred] 151 bpsはこの2件への当てはめに留まり、p99約77 bpsでは2例を覆わず、全probeのmax約1021 bpsをreserve化する案は取引抑制リスクが大きい。これは実際の取引減少率を測った主張ではない。全時点の実観測・残高・own-size quoteがないので、edge gateやsize縮小後の発注数/在庫遷移を認証できない。32-frame fixtureも「再構成・完全なobservation replayではない」と明記し、Liquity/registry/RPC履歴を欠く（`test/fixtures/ascon-zeta-r-logs.json:2`; `test/ascon-zeta-r2.test.ts:9,16`）。このfixtureを通すだけで12regimeの非抑制を示すことはできない。以前のskip-uncompetitive-bid案（2.9 tx/world、ユーザー提示）は再採用しない。

### (b) bounded venue slippage cushion

[directly-observed] adapterは決定後に実amountでquoteを取得し、slippageを掛けてminOutを作る（`sdk/src/protocols/curve.ts:428`; `sdk/src/protocols/uniswap.ts:278`; `sdk/src/protocols/balancer.ts:352`）。保存されていないquote読取時点をmarket[blockSeen]と等置できない。

| ID | 観測blockの手数料込みprobe利益余地 [derived] | 50 bps安全余白控除後 [derived] | cushion判断 [inferred] |
| --- | --- | --- | --- |
| R1 | fair/Curve.buy−1 = 184.6426 bps | 134.6426 bps | 出力減少proxy112.6547 bpsより大きいが、1.354179 USDCに対し現行gasPerSwap=140000と0.1 gweiの費用proxyだけで319.2860 bps。利益でcushionを賄うとは認定できない。 |
| R2 | Uni.sell/Curve.buy−1 = 62.5228 bps（買い2998.149879、売り3016.895137） | 12.5228 bps | sell出力減少150.5771 bpsを吸収できない。旧買い価格に対する包含block売り価格ではpair edge −88.9958 bps、gas前でも負。 |

[derived] R2の売りをfair基準で単独評価すると−239.6284 bpsであり、利益源は同時買いとのvenue差。2%売り留保・独立保有在庫の終価まで含む実損益をこのpair比率だけで断定しない。R1のgasは現行パラメータによる仮定であり実成功gasの観測値ではない（`example/agents/ascon-zeta-r2/delta.ts:14`）。数式の入力は3.1のmarketと3のamount/fee。

[inferred] たとえばR1を75→115 bps、R2を120→155 bpsへ緩めるとprobe上の変化は覆うが、実際のminOut・tx直前quote・確定reasonがないため **そのcushionなら通ったとは言えない**。R2では利益余地条件も満たさない。無制限slippage・保護削除は検討対象外。

**[inferred] 採用する単一変更：なし。** 複数原因への別々の修正や、根拠の弱い151 bps固定値を追加しない。r3が存在するかのような32-frame差分0件、red control PASS、poisoned-env PASSを報告しない。これらは実装を採用した場合の条件であり今回はN/A。

## 6. 検証結果・未検証

- **PASS [directly-observed]** `npm run typecheck` → `tsc --noEmit`、exit 0（2026-10-06）。コード変更なし。
- **PASS [derived]** オフラインの資料整合性assert：24世界×4agentのincluded/revertとsummary一致、不明status0、unlogged0、全included hashのsubmittedへの一意結合、cand revert=0/2、submit_failed=32/14、reason未分類0、窓内未包含11件は全て最終block観測、observation全34,656件がreconstructed。
- **FAIL [derived]** zr4を提示の基準4で診断するとcalm=1/300、lending-incident=1/271のため不適合。Q-ZETA-02をFAILと判定したものではない。
- **N/A [directly-observed]** r3 synthetic/red control/poisoned-env/32-frame差分テスト。新戦略を実装していないため未実行。既存r2テストも再実行していない。資料集計assertを戦略テストPASSと混同しない。
- **未検証** mined2件の確定reason、正確なminOut、own-size quoteと直前状態、変更によるrevert減少、取引量/損益維持、live・qualification。miniの結果、Q-ZETA-02の結果は読んでいない。
- [directly-observed] simulation/backtest/Anvil、network/SSH/RPC、check:strategy、install、commit/pushは実行していない。`.env`・鍵ファイルの読取なし。新規コード/fixture/テスト/一時スクリプトファイルを作成せず、集計はstdin上で実行した。

## 付録A. 全世界索引と照合数

[directly-observed] indexの所在は `E/ascon-notes/eval/out/<label>/index.tsv:行`。[derived] I/Rはcand included/reverted、M/Cはmulti-arb/clean-arbのmined revert。U/B/C列はcandのToo little received/BAL#507/Slippage件数。summary行はcand.includedTxCountの位置（直後がrevertCount/unloggedTxCount）。各世界の全blocks.csvと全agents/cand.jsonlを集計した。

| 世界 | regime / seed | label / index行 | E相対run_dir | cand I/R | M/C revert | submitted | submit_failed U/B/C | summary.json行 |
| --- | --- | --- | --- | --- | --- | ---: | --- | ---: |
| ZR3-01 | calm / 48002 | zr3-zeta-r2 / 2 | `runs/2026-10-05T10-24-13-365Z` | 189/0 | 5/0 | 189 | 1/1/0 | 475 |
| ZR3-02 | cex-drift / 48002 | zr3-zeta-r2 / 3 | `runs/2026-10-05T10-24-16-338Z` | 258/0 | 5/2 | 259 | 0/0/0 | 501 |
| ZR3-03 | informed-flow / 48002 | zr3-zeta-r2 / 4 | `runs/2026-10-05T10-24-19-529Z` | 346/0 | 2/0 | 346 | 1/1/0 | 513 |
| ZR3-04 | whale / 48002 | zr3-zeta-r2 / 5 | `runs/2026-10-05T10-36-48-351Z` | 264/0 | 9/6 | 264 | 1/6/2 | 525 |
| ZR3-05 | lending-incident / 48002 | zr3-zeta-r2 / 6 | `runs/2026-10-05T10-36-51-188Z` | 223/0 | 4/3 | 223 | 0/1/3 | 502 |
| ZR3-06 | crash / 48002 | zr3-zeta-r2 / 7 | `runs/2026-10-05T10-36-54-284Z` | 284/0 | 5/0 | 284 | 0/0/0 | 502 |
| ZR3-07 | depeg / 48002 | zr3-zeta-r2 / 8 | `runs/2026-10-05T10-49-23-072Z` | 154/0 | 3/0 | 154 | 0/1/0 | 489 |
| ZR3-08 | vuln / 48002 | zr3-zeta-r2 / 9 | `runs/2026-10-05T10-49-25-861Z` | 215/0 | 5/0 | 217 | 0/0/0 | 475 |
| ZR3-09 | spike / 48002 | zr3-zeta-r2 / 10 | `runs/2026-10-05T10-49-28-980Z` | 150/0 | 10/0 | 150 | 2/6/5 | 527 |
| ZR3-10 | depeg-persist / 48002 | zr3-zeta-r2 / 11 | `runs/2026-10-05T11-02-01-418Z` | 298/0 | 3/0 | 299 | 0/0/0 | 489 |
| ZR3-11 | cdp-incident / 48002 | zr3-zeta-r2 / 12 | `runs/2026-10-05T11-02-04-285Z` | 167/0 | 5/1 | 167 | 0/0/0 | 514 |
| ZR3-12 | launch / 48002 | zr3-zeta-r2 / 13 | `runs/2026-10-05T11-02-07-447Z` | 226/0 | 0/0 | 227 | 0/1/0 | 489 |
| ZR4-01 | calm / 48003 | zr4-zeta-r2 / 2 | `runs/2026-10-05T16-34-15-612Z` | 300/1 | 2/0 | 300 | 0/1/0 | 475 |
| ZR4-02 | cex-drift / 48003 | zr4-zeta-r2 / 3 | `runs/2026-10-05T16-34-18-399Z` | 202/0 | 1/0 | 202 | 0/0/0 | 513 |
| ZR4-03 | informed-flow / 48003 | zr4-zeta-r2 / 4 | `runs/2026-10-05T16-34-21-503Z` | 376/0 | 3/2 | 377 | 0/3/1 | 501 |
| ZR4-04 | whale / 48003 | zr4-zeta-r2 / 5 | `runs/2026-10-05T16-46-48-887Z` | 265/0 | 2/7 | 266 | 0/1/0 | 525 |
| ZR4-05 | lending-incident / 48003 | zr4-zeta-r2 / 6 | `runs/2026-10-05T16-46-51-767Z` | 271/1 | 10/1 | 272 | 0/0/0 | 502 |
| ZR4-06 | crash / 48003 | zr4-zeta-r2 / 7 | `runs/2026-10-05T16-46-54-924Z` | 275/0 | 11/0 | 275 | 0/1/0 | 527 |
| ZR4-07 | depeg / 48003 | zr4-zeta-r2 / 8 | `runs/2026-10-05T16-59-21-002Z` | 261/0 | 4/0 | 261 | 0/0/0 | 489 |
| ZR4-08 | vuln / 48003 | zr4-zeta-r2 / 9 | `runs/2026-10-05T16-59-23-816Z` | 182/0 | 2/1 | 183 | 1/1/0 | 475 |
| ZR4-09 | spike / 48003 | zr4-zeta-r2 / 10 | `runs/2026-10-05T16-59-26-902Z` | 255/0 | 15/2 | 256 | 1/2/1 | 527 |
| ZR4-10 | depeg-persist / 48003 | zr4-zeta-r2 / 11 | `runs/2026-10-05T17-11-53-069Z` | 242/0 | 2/0 | 243 | 0/0/0 | 489 |
| ZR4-11 | cdp-incident / 48003 | zr4-zeta-r2 / 12 | `runs/2026-10-05T17-11-55-935Z` | 118/0 | 1/1 | 118 | 0/0/0 | 514 |
| ZR4-12 | launch / 48003 | zr4-zeta-r2 / 13 | `runs/2026-10-05T17-11-59-037Z` | 213/0 | 5/0 | 213 | 0/1/0 | 489 |

## 付録B. 参照agent submit_failedの全行根拠

[derived] 各行は同世界/agent/action/reasonで集約。原文は `世界/agents/<agent>.jsonl:列挙行`。

| 世界 | agent | action | reason | 件数 | jsonl行 |
| --- | --- | --- | --- | ---: | --- |
| ZR3-01 | clean-arb | balancerSwap | BAL#507 | 1 | 332 |
| ZR3-04 | multi-arb | balancerSwap | BAL#507 | 1 | 161 |
| ZR3-05 | multi-arb | balancerSwap | BAL#507 | 3 | 200, 203, 210 |
| ZR3-05 | multi-arb | curveSwap | Slippage | 2 | 204, 350 |
| ZR3-05 | clean-arb | swap | Too little received | 1 | 322 |
| ZR3-06 | multi-arb | curveSwap | Slippage | 1 | 299 |
| ZR3-06 | multi-arb | balancerSwap | BAL#507 | 1 | 383 |
| ZR3-09 | multi-arb | swap | Too little received | 1 | 60 |
| ZR3-09 | multi-arb | curveSwap | Slippage | 1 | 117 |
| ZR3-09 | multi-arb | balancerSwap | BAL#507 | 1 | 175 |
| ZR3-10 | multi-arb | swap | Too little received | 1 | 240 |
| ZR3-11 | multi-arb | swap | Too little received | 2 | 99, 224 |
| ZR4-02 | multi-arb | balancerSwap | BAL#507 | 1 | 86 |
| ZR4-03 | multi-arb | balancerSwap | BAL#507 | 1 | 142 |
| ZR4-05 | multi-arb | curveSwap | Slippage | 3 | 169, 273, 279 |
| ZR4-05 | multi-arb | balancerSwap | BAL#507 | 1 | 282 |
| ZR4-09 | multi-arb | curveSwap | Slippage | 1 | 308 |
