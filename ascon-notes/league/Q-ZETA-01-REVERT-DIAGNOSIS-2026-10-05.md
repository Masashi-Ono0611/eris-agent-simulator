# Q-ZETA-01 mined revert / submit_failed 診断（2026-10-05）

**[derived] 基準4は不合格のまま。60世界の包含数は163–331なので、0.1%条件は実質「各世界ゼロ mined revert」である。11件すべてのhash・包含ブロック・外側の呼び出しを特定した。[inferred] 共通の有力原因は低い入札順位での価格変動とslippage境界超過。[directly-observed] ただし11件のrevert payload/内部traceは保存されておらず、個別の確定revert reasonは全件未検証。**

## 1. 範囲・証拠の読み方

- [directly-observed] 作業先は `league/v2`。変更は本Markdownのみ。upstream-evalとrun出力は読み取りのみ。commit/push、simulation/backtest/Anvil、RPC、外部照会、`.env`・鍵ファイルの読取は行っていない。既存の未追跡 `node_modules` は変更していない。
- [directly-observed] `E = /Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/upstream-eval`。以下の `Wxx/file:line` は末尾の世界索引にある `E/run_dir/file:line`。`C = /Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/league-v2`。コード参照はC相対。短縮名 `agent.ts` / `delta.ts` は `example/agents/ascon-zeta-r/` 配下、`runtime/` は `example/agents/runtime/`、`lib/` と `launchSwap.ts` は `example/agents/lib/` 配下。世界を示した箇所の `cand:行` / `blocks:行` はその世界の `agents/cand.jsonl:行` / `blocks.csv:行`。index.tsvの2行目を最初のデータ行として数えた。JSONはキーによる参照も併記する。
- `directly-observed` = 保存ファイルまたは現行コードの記載。`derived` = その集計・hash結合・ABI整数デコード。`inferred` = 原因・モジュール帰属・修正効果の推定。表の列名または直前の注記が各セルのラベルになる。
- [directly-observed] 全60世界の `summary.json`、`blocks.csv`、`agents/{cand,multi-arb,clean-arb}.jsonl`、`events.jsonl`、対応するチャンクログを照合。全60ディレクトリのファイル一覧に独立したraw tx/receipt/traceファイルはない。market.json/notionalsには成功取引のreceiptから抽出された売買情報があるが、失敗11hashのnotionalはない。`blocks.csv` はreceipt由来のstatus/gasUsed、tx由来のhash/block/index/fee/methodを保存するが、calldata本体・gas limit・revert dataは保存しない（`core/src/realtime/coordinator.ts:2731`, `:2769`）。
- [derived] eventsのobservation 86,640件は全件 `reconstructed:true`。block/fair/poolPrice/inventory評価額だけであり、決定時の完全なbalances、own-size quote、allowance、competitionはない（`core/src/realtime/reconstruct.ts:1264`）。以下のmarket比較は事後再構成された**ブロック終了状態**であり、agentが実際に読んだ値やtx直前状態とは同一視しない。
- [directly-observed] `agent.ts/delta.ts/launch.ts`、runtime/send、sdk/action、Uniswap/Curve/Balancer adapter、coordinator/reconstructについてCとEの現行ファイルはbyte一致。実行当時の全ソースsnapshotまでは保存資料から認証していない。
- [directly-observed] 既存結果文書 `ascon-notes/league/Q-ZETA-01-RESULT-2026-10-05.md` は基準5と基準6の一部を未判定としている。「基準4だけ失敗」は、他の全項目が検証済みPASSという意味ではない。

## 2. 再集計

| 項目 [derived] | 結果 | 根拠 |
| --- | --- | --- |
| 世界数 / candidate revert | 60世界 / 9世界で11件 | 世界索引の全summaryとblocksを照合 |
| candidate包含 / submitted / submit_failed | 14,999 / 15,031 / 233 | 全cand.jsonlとblocks.csv |
| submit_failed比率 | 233/15,031 = 1.550%; 成功送信と失敗試行の合計を分母にすると233/15,264 = 1.526% | submittedは成功した送信イベント。233は15,031の部分集合ではない |
| 包含との32件差 | 未包含hash32件は全件blockSeen=runStartBlock+360 | 最終ブロックを観測してから送信された取引。採点窓外の最終receiptは未検証 |
| 参照revert総数 / 世界平均 | multi-arb 355 / 5.9167; clean-arb 65 / 1.0833 | 全summaryとblocksのreverted行が一致 |
| candidateの不明status / unloggedTxCount | summary集計の11件は全件status=reverted; unloggedTxCountは全60世界0 | receipt取得失敗をrevertと誤計数した11件ではない |

## 3. mined revert 11件の個別台帳

[directly-observed] 全件fee=maxFeePerGas=100,000,000 wei（0.1 gwei）。全件 `blockSeen → inclusion = +1`。[derived] methodはblocks、action/base/nonce/bundle情報はhash一致するcandログから結合した。blocksの `actionType=direct` と空のbundle列だけで分類していない。

| ID | 世界 [directly-observed] | tx hash [directly-observed] | 観測→包含 / txIndex [directly-observed] | action / 呼出し / base [derived] | amount raw / nonce / gasUsed [directly-observed] | モジュール [inferred]・証拠 |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | W07 cex-drift/46002 | `0x0ce07dda4c1a7c5918322c1eccbf911eb24e115ffa9b3ea0880c690268ab5c66` | 1489→1490 / 24 | swap / exactInputSingle / WBTC | 3725 / n187 / 100865 | delta bundle売りleg1; `W07/agents/cand.jsonl:223`, `W07/blocks.csv:4567` |
| R02 | W07 cex-drift/46002 | `0xd1aa30a3882645c44969fcec94d2e1b8c97ea0df27466735b1f5868f4bdb811a` | 1491→1492 / 22 | swap / exactInputSingle / WBTC | 22151186 / n190 / 100629 | delta単独（USDC→WBTC推定）; `W07/agents/cand.jsonl:226`, `W07/blocks.csv:4614` |
| R03 | W12 informed-flow/46002 | `0xe23b878ed453ba0d56ca8604d3b43fc93df24e8741917548d4756059a967a029` | 1564→1565 / 20 | curveSwap / exchange / WBTC | 18141 / n220 / 79512 | delta単独（WBTC→USDC推定）; `W12/agents/cand.jsonl:297`, `W12/blocks.csv:5935` |
| R04 | W15 informed-flow/46005 | `0xd3cbb64f20cc804d9afd4f1f239ee07eda8dd907815c449d968b0611088e3929` | 1601→1602 / 18 | balancerSwap / swap / WBTC | 1089222 / n266 / 62382 | delta単独（WBTC→USDC推定）; `W15/agents/cand.jsonl:361`, `W15/blocks.csv:6792` |
| R05 | W16 whale/46001 | `0xe19dd158b7a41225f07f5158c73b89fee0ca1b9a08c6eefb31ac26bec2749bf9` | 1437→1438 / 26 | swap / exactInputSingle / WETH | 3447544948790408697 / n115 / 102757 | agent.ts超過WETH回収（推定）; `W16/agents/cand.jsonl:128`, `W16/blocks.csv:2586` |
| R06 | W16 whale/46001 | `0xf51be242be995f0dee4dd435ec7cf5e03d7a857dc96b8dad069b114d34e10e13` | 1575→1576 / 26 | swap / exactInputSingle / WETH | 3206725998576509901 / n233 / 103702 | agent.ts超過WETH回収（推定）; `W16/agents/cand.jsonl:286`, `W16/blocks.csv:5572` |
| R07 | W31 depeg/46001 | `0x8dd5fbba98bcd177fe78ef18239a3a8440e1440a02aa6a0faac3c7f932ed8b28` | 1227→1228 / 21 | curveSwap / exchange / WETH | 5817986015065022 / n84 / 79575 | delta単独（WETH→USDC推定）; `W31/agents/cand.jsonl:69`, `W31/blocks.csv:1137` |
| R08 | W33 depeg/46003 | `0x19be67601f23c425391ed84cab994bf2ad3c6185cb1404be09dcb724df096e75` | 1268→1269 / 19 | curveSwap / exchange / WBTC | 45836 / n117 / 79592 | delta bundle買いleg0; `W33/agents/cand.jsonl:117`, `W33/blocks.csv:1873` |
| R09 | W41 spike/46001 | `0xa4549627848fb71be5cda426e64a324c370d4b1bcd15db40c58740ba4c1bdfb1` | 1461→1462 / 17 | curveSwap / exchange / WETH | 2028067376406137 / n153 / 79481 | delta単独（WETH→USDC推定）; `W41/agents/cand.jsonl:179`, `W41/blocks.csv:3620` |
| R10 | W45 spike/46005 | `0x1dc029c3412ca1823d0688dc330cdcefd7c066678dfecf33ff771ff01d32126b` | 1530→1531 / 22 | balancerSwap / swap / WETH | 1720649 / n210 / 62417 | delta単独（USDC→WETH推定）; `W45/agents/cand.jsonl:262`, `W45/blocks.csv:5087` |
| R11 | W50 depeg-persist/46005 | `0x6df3dde347f1cba66c49850386487d4cf39680cdedefc5f0c798485d750779cc` | 1348→1349 / 20 | balancerSwap / swap / WBTC | 2608 / n162 / 62358 | delta単独（WBTC→USDC推定）; `W50/agents/cand.jsonl:193`, `W50/blocks.csv:3261` |

[inferred] R05/R06はLiquity redemption本体ではなく、`agent.ts:38–42` の超過WETH売却分岐が最有力。直前のdelta買い出力と売りamountが一致し、失敗後の次ブロックで同amountの売りが成功（W16/agents/cand.jsonl:127–129,285–287 とmarket.json/notionals）。この分岐はWETH増分の出所を識別しないため、通常arbで増えたWETHも回収する。残り9件はWBTCまたはCurve/Balancer、あるいはdelta bundleであり、`delta.ts:159–162,200–203` と整合する。[derived] 11件にliquityRedeem/liquityLiquidate/SP操作/rawTx/launch swapはない。

### 観測時と包含時の比較・原因仮説

[directly-observed] 保存receiptから回復できるfailing callは上表の外側methodまで。全11件の内部失敗箇所・revert reasonは不明。[inferred] 下表は各件のslippage仮説を支持する事後価格と先行flow。単独deltaの売買方向は同ブロックの再構成fair対venue価格差とコード分岐から推定し、tx calldataから確定した方向ではない。売りはsell価格下落、買いはbuy価格上昇を不利方向とした。buyの出力減少率は表示価格上昇率と同値ではない。quoteサイズも異なるため、数値から実際のminOut超過を直接証明しない。

| ID | 方向 [inferred]・事後再構成価格 [derived] | slippage設定 [inferred] | 同base・同methodの主な先行成功flow [derived] | 同時参照失敗 [derived] | 根拠 |
| --- | --- | --- | --- | --- | --- |
| R01 | sell: 60571.500003→59374.189271 (-197.7 bps) | 120 bps（コード帰属推定） | #16 flow-uniswap:uninformed, sell $30,292.74, 0.119 gwei (`blocks.csv:4559`) | 同ブロック・同methodの参照revertなし | `W07/market.json` series[block=1489,1490] / notionals; `W07/events.jsonl:5649` |
| R02 | buy: 59807.514440→60668.307505 (+143.9 bps) | 75 bps（コード帰属推定） | #20 flow-uniswap:uninformed, buy $20,848.13, 0.111 gwei (`blocks.csv:4612`) | 同ブロック・同methodの参照revertなし | `W07/market.json` series[block=1491,1492] / notionals; `W07/events.jsonl:5657` |
| R03 | sell: 59999.976980→59399.410130 (-100.1 bps) | 75 bps（コード帰属推定） | #17 flow-curve:uninformed, sell $29,903.00, 0.143 gwei (`blocks.csv:5932`) | multi-arb #21 gas=79512 (`blocks.csv:5936`) | `W12/market.json` series[block=1564,1565] / notionals; `W12/events.jsonl:5642` |
| R04 | sell: 60263.287390→59809.112130 (-75.4 bps) | 75 bps（コード帰属推定） | #14 flow-balancer:uninformed, sell $10,698.07, 0.146 gwei (`blocks.csv:6788`) | multi-arb #19 gas=62382 (`blocks.csv:6793`) | `W15/market.json` series[block=1601,1602] / notionals; `W15/events.jsonl:5840` |
| R05 | sell: 3013.207338→2968.430752 (-148.6 bps) | 100 bps（コード帰属推定） | #18 flow-uniswap:uninformed, sell $13,893.03, 0.134 gwei (`blocks.csv:2578`) | 同ブロック・同methodの参照revertなし | `W16/market.json` series[block=1437,1438] / notionals; `W16/events.jsonl:4993` |
| R06 | sell: 3019.148638→2765.572428 (-839.9 bps) | 100 bps（コード帰属推定） | #25 flow-whale:uninformed, sell $135,595.57, 0.1 gwei (`blocks.csv:5571`) | 同ブロック・同methodの参照revertなし | `W16/market.json` series[block=1575,1576] / notionals; `W16/events.jsonl:5545` |
| R07 | sell: 2970.135370→2932.776990 (-125.8 bps) | 75 bps（コード帰属推定） | #17 flow-curve:uninformed, sell $19,230.95, 0.116 gwei (`blocks.csv:1133`) | multi-arb #20 gas=79575 (`blocks.csv:1136`) | `W31/market.json` series[block=1227,1228] / notionals; `W31/events.jsonl:4584` |
| R08 | buy: 60542.297441→61666.104002 (+185.6 bps) | 120 bps（コード帰属推定） | #13 flow-curve:uninformed, buy $31,244.29, 0.148 gwei (`blocks.csv:1867`) | 同ブロック・同methodの参照revertなし | `W33/market.json` series[block=1268,1269] / notionals; `W33/events.jsonl:4714` |
| R09 | sell: 3139.730360→3107.011330 (-104.2 bps) | 75 bps（コード帰属推定） | #15 flow-curve:uninformed, sell $14,313.00, 0.145 gwei (`blocks.csv:3618`) | multi-arb #18 gas=79481 (`blocks.csv:3621`) | `W41/market.json` series[block=1461,1462] / notionals; `W41/events.jsonl:5311` |
| R10 | buy: 2885.674492→2944.116258 (+202.5 bps) | 75 bps（コード帰属推定） | #20 flow-balancer:uninformed, buy $29,123.40, 0.128 gwei (`blocks.csv:5085`) | multi-arb #23 gas=62417 (`blocks.csv:5088`) | `W45/market.json` series[block=1530,1531] / notionals; `W45/events.jsonl:5640` |
| R11 | sell: 58547.544640→57859.845470 (-117.5 bps) | 75 bps（コード帰属推定） | #17 flow-balancer:uninformed, sell $12,550.25, 0.114 gwei (`blocks.csv:3258`) | multi-arb #19 gas=62358 (`blocks.csv:3260`) | `W50/market.json` series[block=1348,1349] / notionals; `W50/events.jsonl:5061` |

[inferred] R01/R02/R05/R06のUniswapは `Too little received`、R03/R07/R08/R09のCurveは `Slippage`、R04/R10/R11のBalancerは出力下限違反が有力。これらの文字列を当該11件の観測済みreasonとは扱わない。R04は価格変化が75 bps付近で、own-size/手数料/丸め/quote時刻の差も未復元。全件で不利な同市場flowの先行があるが、意図的なfront-runを示す証拠はなく、通常flowとの順序競合と区別する。

### bundle・gas・nonce・allowanceの切り分け

| 対象 | 観測・推定 |
| --- | --- |
| R01 bundle | [derived] leg0 Curve買いは同ブロックで成功、leg1 Uniswap売りが失敗。同bundleId・nonce186→187。自己legの逆転はない（W07/agents/cand.jsonl:222–223、blocksのhash結合）。 |
| R08 bundle | [derived] leg0 Curve買いが失敗してもleg1 Uniswap売りは同ブロックtxIndex20で成功。nonce117→118。bundleは原子的ではない（W33/agents/cand.jsonl:117–118、blocks:1873–1874）。[inferred] 売りは既存在庫を消費した可能性が高い。 |
| 残り9件 | [derived] 該当送信ログにbundleIdなし。後続nonceも存在し、全11件が+1 block包含。[inferred] nonce詰まり/長期pendingを主原因とする証拠はない。 |
| gas | [directly-observed] gasUsed=62,358–103,702。gas limitは未保存。[inferred] 価格変動・同時参照失敗がslippageを支持するが、gasUsedだけでout-of-gasを完全排除できない。senderは通常estimateに30%または50,000gas以上の余裕を付け、pending依存時は固定gasを使う（runtime/send.ts:208–227）。どの経路を各txが通ったかは未記録。 |
| allowance/残高 | [directly-observed] mined11件には残高・allowanceの失敗文字列がない。[inferred] それを「問題なし」の証明にはしない。launchのSTFとは別クラスの有力仮説を置くが、実値不足で完全排除はできない。 |
| decision/quoteのstaleness | [derived] 全件で1 blockの差と先行flowが存在。[inferred] stale quoteが有力。ただしSDKは決定後にown-size quoteを取りminOutを組み立てる（sdk/src/protocols/uniswap.ts:260, curve.ts:434, balancer.ts:354）。blockSeenだけではquoteを読んだ正確なheadを特定できない。 |

### 同じ世界の参照agent

| 世界 | cand revert/包含 [derived] | multi-arb revert/包含・method別 [derived] | clean-arb revert/包含・method別 [derived] |
| --- | --- | --- | --- |
| W07 cex-drift/46002 | 2/297 | 2/284 (exactInputSingle:2) | 0/28 (なし) |
| W12 informed-flow/46002 | 1/259 | 7/251 (exactInputSingle:2, exchange:1, swap:4) | 1/28 (swap:1) |
| W15 informed-flow/46005 | 1/258 | 7/251 (exactInputSingle:3, exchange:1, swap:3) | 1/77 (swap:1) |
| W16 whale/46001 | 2/278 | 28/268 (exactInputSingle:20, swap:8) | 0/82 (なし) |
| W31 depeg/46001 | 1/215 | 6/207 (exactInputSingle:4, exchange:1, swap:1) | 1/32 (swap:1) |
| W33 depeg/46003 | 1/253 | 3/245 (exactInputSingle:1, swap:2) | 0/40 (なし) |
| W41 spike/46001 | 1/243 | 19/235 (exactInputSingle:6, exchange:6, swap:7) | 2/46 (exactInputSingle:1, exchange:1) |
| W45 spike/46005 | 1/317 | 5/313 (exchange:2, swap:3) | 0/98 (なし) |
| W50 depeg-persist/46005 | 1/249 | 4/249 (exchange:1, swap:3) | 1/20 (exactInputSingle:1) |

[derived] candidateの失敗9世界すべてでmulti-arbにもrevert、うち6件はcandidateと同ブロック・同method・同gasUsed。clean-arbは5/9世界でrevertするが、この11件と同ブロックのrevertはない。[inferred] 共通の市場競合クラスを支持するが、参照のrevert理由も保存されていないので「同一reason確定」ではない。根拠は各Wのsummary.agentsとblocks、上の11件台帳。

## 4. submit_failed 233件

[derived] 233件のerror先頭行は5種類、protocolとの組合せは6種類。全件にactionType、amount、blockSeen、ABI calldataがあり分類漏れは0。nonce/transport/gas不足を理由とする行は0。**エラー文字列の未分類0と、根本原因の不明0は違う。** allowance実値・決定時残高・quoteの時系列が不足するため、基準5の「原因不明0」を完全達成とは判定しない。

| regime [derived] | Uni Too little | Bal BAL#507 | Curve Slippage | Uni STF | Curve WETH残高 | Bal WETH残高 | 計 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| calm | 1 | 3 | 0 | 0 | 0 | 0 | 4 |
| cex-drift | 4 | 1 | 2 | 0 | 0 | 0 | 7 |
| informed-flow | 3 | 5 | 0 | 0 | 0 | 0 | 8 |
| whale | 3 | 5 | 7 | 2 | 0 | 2 | 19 |
| lending-incident | 1 | 1 | 2 | 0 | 0 | 0 | 4 |
| crash | 1 | 1 | 1 | 0 | 0 | 0 | 3 |
| depeg | 1 | 1 | 0 | 0 | 0 | 0 | 2 |
| vuln | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| spike | 4 | 2 | 4 | 0 | 0 | 0 | 10 |
| depeg-persist | 3 | 5 | 0 | 0 | 0 | 0 | 8 |
| cdp-incident | 4 | 6 | 1 | 0 | 0 | 0 | 11 |
| launch | 1 | 2 | 1 | 135 | 12 | 4 | 155 |
| 合計 | 26 | 33 | 19 | 137 | 12 | 6 | 233 |

[derived] actionTypeはswap=163、balancerSwap=39、curveSwap=31。全233件は通常venue actionであり、launch rawTxやLiquity redemption/SP本体のsubmit_failedは0。tokenIn・bundleIndex・feeとコードから、232件はdelta由来、spike/46001の1件は超過WETH回収分岐由来と整合する [inferred]。後者はW41/agents/cand.jsonl:93（Too little received、0.1 gwei、1.384908864842097630 WETH）で、直前のdelta買い出力と一致し、次観測の同額売りは成功（cand:92–94、market.json/notionals）。delta失敗にはlaunchによる共有allowanceへの影響を受けるものを含む。

[inferred] モジュール帰属のregime別集計（行番号とreasonは付録B、帰属は現行コードと送信メタデータによる）：

| regime | delta | 超過WETH回収 | launch rawTx / Liquity本体 / SP |
| --- | --- | --- | --- |
| calm | 4 | 0 | 0 |
| cex-drift | 7 | 0 | 0 |
| informed-flow | 8 | 0 | 0 |
| whale | 19 | 0 | 0 |
| lending-incident | 4 | 0 | 0 |
| crash | 3 | 0 | 0 |
| depeg | 2 | 0 | 0 |
| vuln | 2 | 0 | 0 |
| spike | 9 | 1 | 0 |
| depeg-persist | 8 | 0 | 0 |
| cdp-incident | 11 | 0 | 0 |
| launch | 155 | 0 | 0 |
| 合計 | 232 | 1 | 0 |

| 原因クラス | 件数 [derived] | 直接観測 / 推定 / 未検証 |
| --- | --- | --- |
| Uniswap出力下限 | 26 | [directly-observed] Too little received、exactInputSingle calldata。[inferred] quote→送信前検査の間の変動が有力。 |
| Curve slippage | 19 | [directly-observed] Slippage、exchange calldata。[inferred] quote→送信前検査の間の変動が有力。 |
| Balancer BAL#507 | 33 | [directly-observed] BAL#507、swap calldataにlimit。[inferred] swap出力制約違反と整合。本保存資料に507のエラー定義原文はなく、コード名称の独立照合は未検証。 |
| launch後のUSDC transferFrom失敗 | 135 | [directly-observed] launchの5seed、全てSTFでtokenIn=USDC。single99件、bundle leg0が36件。[inferred] launchのexact approveが通常routerの既存allowanceを上書きし、消費後に通常買いが失敗する機構が有力。 |
| whaleのWETH transferFrom失敗 | 2 | [derived] whale/46003 cand:57,61、WETH売りleg1。対応買いleg0は直前行56,60でSlippage送信失敗。[inferred] 買い資金化が起きずWETH不足が有力、STF単独ではallowanceとの識別は未完了。 |
| WETH残高不足 | 18 | [directly-observed] WETH9: insufficient balance。Curve12、Balancer6。[derived] 全18件がleg1で対応leg0も送信失敗（launch16件はSTF、whale2件はToo little）。 |
| 原因未分類 | 0（文字列分類） | [inferred] 全233件に機序仮説はあるが、STF137件のbalance/allowance実値と価格制約78件のquote→検査状態は完全復元できず、根本原因の確定では未検証が残る。 |

[directly-observed] STFはERC20.transferFromの失敗を包む文字列であり、allowance不足専用ではない（`E/deployer/node_modules/@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol:8–21`）。WETH残高とallowanceは別require（`deployer/contracts/WETH9.sol:50–55`）。`launchSwap.ts:313–325,363–377` はexact approve＋swap、通常venueのapprovalは起動時（`runtime/botMain.ts:559–584,732`）。本診断ではそれらのコードを読んだだけで、接続/実行していない。

### launch allowance仮説の5seed対応

| 世界 | STF数 [derived] | 最初のSTFより前のraw approve/swap [derived] | 最初のSTF [directly-observed] |
| --- | --- | --- | --- |
| W56 / 46001 | 47 | approve success b1607 (cand:161, blocks:3189); exactInputSingle success b1607 (cand:162, blocks:3190) | blockSeen 1610; cand:170 |
| W57 / 46002 | 25 | approve success b1544 (cand:142, blocks:2983); exactInputSingle success b1544 (cand:143, blocks:2984) | blockSeen 1544; cand:145 |
| W58 / 46003 | 26 | approve success b1590 (cand:116, blocks:2694); exactInputSingle success b1590 (cand:117, blocks:2695) | blockSeen 1602; cand:143 |
| W59 / 46004 | 18 | approve success b1504 (cand:98, blocks:2078); exactInputSingle success b1504 (cand:99, blocks:2079) | blockSeen 1530; cand:154 |
| W60 / 46005 | 19 | approve success b1579 (cand:169, blocks:3728); exactInputSingle success b1579 (cand:170, blocks:3729) | blockSeen 1580; cand:174 |

[inferred] 5seedの共通順序はallowance干渉仮説を強く支持する。しかしrawTxログにはapproveのtoken/spender/amountを含むcalldataもApproval logも保存されず、launch後allowance=0の実値は未検証。STF135件を「launch tokenの売り失敗」とは分類しない。

### bundle依存失敗の全件対応

| 世界 | blockSeen [directly-observed] | leg1失敗 [directly-observed] | 対応leg0失敗 [derived] |
| --- | --- | --- | --- |
| W18 whale/46003 | 1371 | cand:55 BAL#507 (balancer) | cand:54 Slippage. |
| W18 whale/46003 | 1372 | cand:57 STF (uniswap) | cand:56 Slippage. |
| W18 whale/46003 | 1373 | cand:59 BAL#507 (balancer) | cand:58 Slippage. |
| W18 whale/46003 | 1374 | cand:61 STF (uniswap) | cand:60 Slippage. |
| W20 whale/46005 | 1362 | cand:47 WETH9: insufficient balance (balancer) | cand:46 Too little received. |
| W20 whale/46005 | 1363 | cand:49 WETH9: insufficient balance (balancer) | cand:48 Too little received. |
| W56 launch/46001 | 1642 | cand:235 WETH9: insufficient balance (curve) | cand:234 STF. |
| W57 launch/46002 | 1626 | cand:314 WETH9: insufficient balance (curve) | cand:313 STF. |
| W57 launch/46002 | 1627 | cand:317 WETH9: insufficient balance (curve) | cand:316 STF. |
| W58 launch/46003 | 1602 | cand:144 WETH9: insufficient balance (curve) | cand:143 STF. |
| W58 launch/46003 | 1604 | cand:149 WETH9: insufficient balance (curve) | cand:148 STF. |
| W58 launch/46003 | 1605 | cand:152 WETH9: insufficient balance (curve) | cand:151 STF. |
| W58 launch/46003 | 1752 | cand:472 WETH9: insufficient balance (balancer) | cand:471 STF. |
| W58 launch/46003 | 1753 | cand:475 WETH9: insufficient balance (balancer) | cand:474 STF. |
| W58 launch/46003 | 1789 | cand:551 WETH9: insufficient balance (balancer) | cand:550 STF. |
| W58 launch/46003 | 1792 | cand:558 WETH9: insufficient balance (balancer) | cand:557 STF. |
| W59 launch/46004 | 1662 | cand:421 WETH9: insufficient balance (curve) | cand:420 STF. |
| W59 launch/46004 | 1674 | cand:447 WETH9: insufficient balance (curve) | cand:446 STF. |
| W60 launch/46005 | 1705 | cand:436 WETH9: insufficient balance (curve) | cand:435 STF. |
| W60 launch/46005 | 1707 | cand:441 WETH9: insufficient balance (curve) | cand:440 STF. |
| W60 launch/46005 | 1708 | cand:444 WETH9: insufficient balance (curve) | cand:443 STF. |
| W60 launch/46005 | 1709 | cand:447 WETH9: insufficient balance (curve) | cand:446 STF. |

[derived] leg1失敗22件は全件、同じbundleIdのleg0もsubmit_failed（上表）。[directly-observed] senderは各intentを順に独立送信し、送信失敗をcatchして続行する（`runtime/send.ts:284–290,335–374`）。validatorは買い出力を推計creditする（`sdk/src/action.ts:352–357,411–435`）。[inferred] 「買いが実際に成功する前提」で後続売りを選ぶ構造が連鎖失敗を生む。nonce順序は原子性を提供しない。

## 5. 修正可能性と60世界ゼロrevertの見込み（実装・新runなし）

| 区分 | 原因クラスと限定変更案 [inferred] | 既存データで言える効果・限界 |
| --- | --- | --- |
| (a) agentで限定修正可能 | 共有allowance干渉：candidate内のlaunch helperを局所化し、既存allowanceが十分ならexact approveで小さく上書きしない。不足時は承認完了を観測してから使用し、通常delta側でもtoken/spender単位で必要量を確認する。共有upstream helperの変更は不要。 | STF135件とその後続残高不足16件が対象候補。135件全部がこの理由との実値証明はなく、除去数151を保証しない。今回mined11件の直接修理にはならない。 |
| (a) agentで限定修正可能 | bundle資金依存：canFundと正確なtoken残高で各legを独立に賄える場合だけbundleを作る。未包含の買い出力を売り資金に数えず、必要なら買い包含確認後の次観測で売りを選ぶ。WBTCはdecimalsを考慮した額チェックも併用。 | 失敗した買いに続く売り22件を抑止する候補。R08の買い失敗自体は解決しない。canFundだけではamount全体やpending消費を保証しない（lib/affordable.ts:33–60,82）。 |
| (a) agentで軽減可能 | 低priorityでのvenue取引：own-size quoteと残存edgeから、実行費用を賄って先行flowに競える時だけ送信し、予算不足時はdefault feeに戻して送らず見送る。delta.ts:94–122のfallbackとagent.ts:40の回収売りのfee選択を対象にする。 | 観測11件はいずれも0.1 gweiなので対象になり得る。しかし次ブロックのflow/同入札/市場変化は未知。maxCompetitorPriorityFeeWeiは全ての他senderを含みsystemも入り得る（runtime/send.ts:524–540）。無条件にその値を超える案や入札上限超過は不可。 |
| (a) agentで局所修正可能 | 回収売りの由来：agent.tsのinitialWeth超過全量をredemption収益と見なさず、実際のredeem/ETH wrap由来とdelta在庫を区別し、回収時もquote・費用・pendingを確認する。 | R05/R06はdelta買い直後の反転売りと整合。分岐修理でこの2件を避ける余地はあるが、回収を止めた在庫の終価・Pへの影響は未検証。 |
| (b) field/raceに内在 | 観測/quoteから包含までに他者の正常な取引が価格を変える。whale/1576では先行whale売り約$135,596、再構成sell価格は約8.40%低下。 | 保存11件はこのクラスに整合。agentによる見送り/入札で曝露を下げられるが、競争下で通常swapを行う限りゼロの保証はない。slippageを無制限にして損失を受け入れることを修理としない。 |
| (c) unknown | mined11件の確定revert payload、内部call、gas limit、正確なquote/allowance/balance、実行時minOut、実行時コードsnapshot。 | 保存証拠の上限。RPC/trace復元や新runは今回の範囲外なので停止し、未検証として残す。 |

[derived] 仮に元ログから0.1 gweiのcandidate txを除外するだけなら、5,305件（全包含の35.37%、成功5,294＋失敗11）を除き、9,694成功・0 revertが残る。高feeだけの包含数は各世界103–228件。[inferred] これは**観測レコードの選別**であり、新戦略の反実仮想backtestではない。取引を減らすと残高、価格、後続actionが変わるので、既存の他基準PASSや全60世界ゼロrevertを再現する証明にはならない。低fee全削除は修正推奨そのものではなく、原因候補の集中度を示す。

[derived] 世界ごとの条件は `R≤min(1, floor(0.001×N))`。N=163–331では右辺0。1件でも0.302–0.613%で不合格となり、2件の世界だけを1件に減らしても不合格。[inferred] bounded fixで11件を減らす合理的な見込みはあるが、**全60世界がゼロになる確度・確率は既存データだけでは推定不能、達成見込みを認定できない**。allowance/bundle修理だけでは、価格競合が有力な11件は残る。新契約・新runを行わずに合格へ改判定できない。基準を緩める提案はしない。

## 6. 検証・未検証

- [directly-observed] `npm run typecheck` PASS（tsc --noEmit、exit 0）。コード変更なし。関連検証はread-onlyの資料整合性チェックを実施し、60世界の3agentのrevert数、11件のhash一意結合、233件のエラー分類合計を確認した。戦略を実行するtestやsimulationは実施していない。
- [directly-observed] 外部ネットワーク、Docker、Anvil、RPC、修正後戦略、backtest、採点再計算は未実施。receipt payload欠落が原因確定の限界であり、そこを推定で埋めて完了扱いにしていない。

## 付録A. 60世界の出典・包含・revert

[directly-observed] indexは `E/ascon-notes/eval/out/qz{chunk}-q-zeta-01/index.tsv:行`。[derived] 数値は各run_dir/summary.jsonのagentsとblocks.csvを照合。cand/M/Cのrevertはcandidate/multi-arb/clean-arb。

| ID | regime/seed | index chunk:行 | run_dir | cand包含 | revert cand/M/C | submit_failed |
| --- | --- | --- | --- | --- | --- | --- |
| W01 | calm/46001 | 1:2 | runs/2026-10-05T01-53-43-611Z | 248 | 0/7/5 | 2 |
| W02 | calm/46002 | 1:3 | runs/2026-10-05T01-53-46-463Z | 245 | 0/1/0 | 0 |
| W03 | calm/46003 | 1:4 | runs/2026-10-05T01-53-49-536Z | 240 | 0/4/0 | 0 |
| W04 | calm/46004 | 1:5 | runs/2026-10-05T02-06-20-001Z | 270 | 0/2/0 | 0 |
| W05 | calm/46005 | 1:6 | runs/2026-10-05T02-06-22-760Z | 245 | 0/2/0 | 2 |
| W06 | cex-drift/46001 | 1:7 | runs/2026-10-05T02-06-25-886Z | 304 | 0/4/0 | 2 |
| W07 | cex-drift/46002 | 1:8 | runs/2026-10-05T02-18-54-823Z | 297 | 2/2/0 | 2 |
| W08 | cex-drift/46003 | 1:9 | runs/2026-10-05T02-18-57-571Z | 221 | 0/3/0 | 2 |
| W09 | cex-drift/46004 | 1:10 | runs/2026-10-05T02-19-00-613Z | 326 | 0/4/0 | 1 |
| W10 | cex-drift/46005 | 1:11 | runs/2026-10-05T02-31-28-076Z | 241 | 0/4/0 | 0 |
| W11 | informed-flow/46001 | 1:12 | runs/2026-10-05T02-31-30-844Z | 234 | 0/6/0 | 5 |
| W12 | informed-flow/46002 | 1:13 | runs/2026-10-05T02-31-33-910Z | 259 | 1/7/1 | 0 |
| W13 | informed-flow/46003 | 1:14 | runs/2026-10-05T02-44-00-801Z | 218 | 0/4/0 | 3 |
| W14 | informed-flow/46004 | 1:15 | runs/2026-10-05T02-44-03-602Z | 326 | 0/5/0 | 0 |
| W15 | informed-flow/46005 | 1:16 | runs/2026-10-05T02-44-06-803Z | 258 | 1/7/1 | 0 |
| W16 | whale/46001 | 2:2 | runs/2026-10-05T02-56-34-023Z | 278 | 2/28/0 | 0 |
| W17 | whale/46002 | 2:3 | runs/2026-10-05T02-56-36-829Z | 307 | 0/0/5 | 0 |
| W18 | whale/46003 | 2:4 | runs/2026-10-05T02-56-39-903Z | 296 | 0/9/6 | 9 |
| W19 | whale/46004 | 2:5 | runs/2026-10-05T03-09-13-781Z | 331 | 0/7/0 | 1 |
| W20 | whale/46005 | 2:6 | runs/2026-10-05T03-09-17-090Z | 280 | 0/2/0 | 9 |
| W21 | lending-incident/46001 | 2:7 | runs/2026-10-05T03-09-19-958Z | 228 | 0/12/1 | 4 |
| W22 | lending-incident/46002 | 2:8 | runs/2026-10-05T03-21-55-861Z | 234 | 0/5/5 | 0 |
| W23 | lending-incident/46003 | 2:9 | runs/2026-10-05T03-21-58-628Z | 272 | 0/4/0 | 0 |
| W24 | lending-incident/46004 | 2:10 | runs/2026-10-05T03-22-01-678Z | 282 | 0/12/1 | 0 |
| W25 | lending-incident/46005 | 2:11 | runs/2026-10-05T03-34-29-060Z | 259 | 0/10/1 | 0 |
| W26 | crash/46001 | 2:12 | runs/2026-10-05T03-34-31-867Z | 277 | 0/12/0 | 0 |
| W27 | crash/46002 | 2:13 | runs/2026-10-05T03-34-34-879Z | 308 | 0/4/3 | 1 |
| W28 | crash/46003 | 2:14 | runs/2026-10-05T05-22-51-876Z | 194 | 0/3/0 | 0 |
| W29 | crash/46004 | 2:15 | runs/2026-10-05T05-22-54-852Z | 272 | 0/24/7 | 0 |
| W30 | crash/46005 | 2:16 | runs/2026-10-05T05-22-58-336Z | 265 | 0/10/1 | 2 |
| W31 | depeg/46001 | 3:2 | runs/2026-10-05T05-35-27-050Z | 215 | 1/6/1 | 0 |
| W32 | depeg/46002 | 3:3 | runs/2026-10-05T05-35-29-844Z | 278 | 0/4/2 | 0 |
| W33 | depeg/46003 | 3:4 | runs/2026-10-05T05-35-32-929Z | 253 | 1/3/0 | 0 |
| W34 | depeg/46004 | 3:5 | runs/2026-10-05T05-47-56-214Z | 262 | 0/4/0 | 1 |
| W35 | depeg/46005 | 3:6 | runs/2026-10-05T05-47-58-999Z | 207 | 0/4/3 | 1 |
| W36 | vuln/46001 | 3:7 | runs/2026-10-05T05-48-02-081Z | 237 | 0/2/0 | 1 |
| W37 | vuln/46002 | 3:8 | runs/2026-10-05T06-00-27-591Z | 220 | 0/3/0 | 0 |
| W38 | vuln/46003 | 3:9 | runs/2026-10-05T06-00-30-383Z | 259 | 0/6/1 | 0 |
| W39 | vuln/46004 | 3:10 | runs/2026-10-05T06-00-33-468Z | 234 | 0/3/2 | 1 |
| W40 | vuln/46005 | 3:11 | runs/2026-10-05T06-12-59-231Z | 210 | 0/2/3 | 0 |
| W41 | spike/46001 | 3:12 | runs/2026-10-05T06-13-02-168Z | 243 | 1/19/2 | 4 |
| W42 | spike/46002 | 3:13 | runs/2026-10-05T06-13-05-186Z | 244 | 0/4/0 | 0 |
| W43 | spike/46003 | 3:14 | runs/2026-10-05T06-25-30-863Z | 188 | 0/4/0 | 3 |
| W44 | spike/46004 | 3:15 | runs/2026-10-05T06-25-33-652Z | 289 | 0/31/8 | 3 |
| W45 | spike/46005 | 3:16 | runs/2026-10-05T06-25-36-685Z | 317 | 1/5/0 | 0 |
| W46 | depeg-persist/46001 | 4:2 | runs/2026-10-05T06-38-04-358Z | 287 | 0/9/1 | 0 |
| W47 | depeg-persist/46002 | 4:3 | runs/2026-10-05T06-38-07-168Z | 185 | 0/1/0 | 0 |
| W48 | depeg-persist/46003 | 4:4 | runs/2026-10-05T06-38-10-298Z | 224 | 0/5/2 | 1 |
| W49 | depeg-persist/46004 | 4:5 | runs/2026-10-05T06-50-33-533Z | 168 | 0/0/0 | 1 |
| W50 | depeg-persist/46005 | 4:6 | runs/2026-10-05T06-50-36-341Z | 249 | 1/4/1 | 6 |
| W51 | cdp-incident/46001 | 4:7 | runs/2026-10-05T06-50-39-421Z | 238 | 0/2/1 | 0 |
| W52 | cdp-incident/46002 | 4:8 | runs/2026-10-05T07-03-05-051Z | 252 | 0/7/0 | 3 |
| W53 | cdp-incident/46003 | 4:9 | runs/2026-10-05T07-03-07-835Z | 167 | 0/2/0 | 5 |
| W54 | cdp-incident/46004 | 4:10 | runs/2026-10-05T07-03-10-961Z | 287 | 0/1/0 | 0 |
| W55 | cdp-incident/46005 | 4:11 | runs/2026-10-05T07-15-37-819Z | 247 | 0/4/1 | 3 |
| W56 | launch/46001 | 4:12 | runs/2026-10-05T07-15-40-567Z | 223 | 0/4/0 | 48 |
| W57 | launch/46002 | 4:13 | runs/2026-10-05T07-15-43-682Z | 163 | 0/0/0 | 27 |
| W58 | launch/46003 | 4:14 | runs/2026-10-05T07-28-11-616Z | 267 | 0/4/0 | 33 |
| W59 | launch/46004 | 4:15 | runs/2026-10-05T07-28-14-410Z | 191 | 0/6/0 | 22 |
| W60 | launch/46005 | 4:16 | runs/2026-10-05T07-28-17-422Z | 180 | 0/2/0 | 25 |

## 付録B. submit_failed全233件の行単位対応（同世界・理由・action・legで集約）

[directly-observed] 下表の行番号はすべて `Wxx/agents/cand.jsonl` の元行。reasonはerror先頭行、tokenInはerror内calldataのABI語から復元した値 [derived]。moduleはW41/cand:93だけ超過WETH回収分岐推定、残る232行はdelta推定。launch世界のUSDC/STFはlaunchとの共有allowance干渉推定。legは0始まり。`single` はbundleIndexなし。blockSeenは各行で参照できる。重複なく233行を列挙する。

| 世界 | reason | actionType | tokenIn | leg | 件数 | cand.jsonl行番号 |
| --- | --- | --- | --- | --- | --- | --- |
| W01 | BAL#507 | balancerSwap | USDC | single | 2 | 223, 259 |
| W05 | BAL#507 | balancerSwap | WBTC | single | 1 | 64 |
| W05 | Too little received | swap | USDC | single | 1 | 200 |
| W06 | Too little received | swap | USDC | single | 1 | 58 |
| W06 | Slippage | curveSwap | WETH | single | 1 | 124 |
| W07 | Too little received | swap | WETH | single | 2 | 82, 84 |
| W08 | Slippage | curveSwap | WETH | single | 1 | 196 |
| W08 | BAL#507 | balancerSwap | WBTC | single | 1 | 218 |
| W09 | Too little received | swap | USDC | single | 1 | 106 |
| W11 | BAL#507 | balancerSwap | WETH | single | 1 | 71 |
| W11 | Too little received | swap | USDC | single | 1 | 133 |
| W11 | BAL#507 | balancerSwap | USDC | single | 1 | 187 |
| W11 | BAL#507 | balancerSwap | WBTC | single | 1 | 225 |
| W11 | Too little received | swap | USDC | 0 | 1 | 264 |
| W13 | BAL#507 | balancerSwap | USDC | single | 1 | 229 |
| W13 | BAL#507 | balancerSwap | WBTC | single | 1 | 243 |
| W13 | Too little received | swap | WBTC | single | 1 | 299 |
| W18 | Slippage | curveSwap | USDC | 0 | 4 | 54, 56, 58, 60 |
| W18 | BAL#507 | balancerSwap | WETH | 1 | 2 | 55, 59 |
| W18 | STF | swap | WETH | 1 | 2 | 57, 61 |
| W18 | Slippage | curveSwap | USDC | single | 1 | 67 |
| W19 | BAL#507 | balancerSwap | WETH | single | 1 | 73 |
| W20 | Too little received | swap | USDC | 0 | 2 | 46, 48 |
| W20 | WETH9: insufficient balance | balancerSwap | WETH | 1 | 2 | 47, 49 |
| W20 | Too little received | swap | USDC | single | 1 | 52 |
| W20 | BAL#507 | balancerSwap | USDC | single | 1 | 53 |
| W20 | BAL#507 | balancerSwap | WETH | single | 1 | 159 |
| W20 | Slippage | curveSwap | USDC | single | 1 | 217 |
| W20 | Slippage | curveSwap | WETH | single | 1 | 225 |
| W21 | Slippage | curveSwap | WETH | single | 1 | 148 |
| W21 | Slippage | curveSwap | USDC | single | 1 | 182 |
| W21 | Too little received | swap | USDC | single | 1 | 188 |
| W21 | BAL#507 | balancerSwap | WBTC | single | 1 | 314 |
| W27 | Slippage | curveSwap | USDC | single | 1 | 205 |
| W30 | BAL#507 | balancerSwap | USDC | single | 1 | 239 |
| W30 | Too little received | swap | WETH | single | 1 | 291 |
| W34 | BAL#507 | balancerSwap | WETH | single | 1 | 217 |
| W35 | Too little received | swap | USDC | 0 | 1 | 100 |
| W36 | Slippage | curveSwap | USDC | single | 1 | 379 |
| W39 | BAL#507 | balancerSwap | USDC | single | 1 | 140 |
| W41 | Too little received | swap | WETH | single | 1 | 93 |
| W41 | Too little received | swap | USDC | single | 2 | 121, 124 |
| W41 | Slippage | curveSwap | USDC | single | 1 | 214 |
| W43 | BAL#507 | balancerSwap | USDC | single | 1 | 132 |
| W43 | Slippage | curveSwap | USDC | single | 2 | 133, 134 |
| W44 | Too little received | swap | USDC | single | 1 | 158 |
| W44 | BAL#507 | balancerSwap | USDC | single | 1 | 266 |
| W44 | Slippage | curveSwap | WETH | single | 1 | 389 |
| W48 | BAL#507 | balancerSwap | WBTC | single | 1 | 127 |
| W49 | BAL#507 | balancerSwap | USDC | single | 1 | 219 |
| W50 | Too little received | swap | USDC | single | 1 | 247 |
| W50 | BAL#507 | balancerSwap | USDC | single | 1 | 248 |
| W50 | Too little received | swap | WBTC | single | 2 | 293, 342 |
| W50 | BAL#507 | balancerSwap | WBTC | single | 2 | 297, 308 |
| W52 | Slippage | curveSwap | USDC | single | 1 | 106 |
| W52 | BAL#507 | balancerSwap | USDC | single | 1 | 107 |
| W52 | BAL#507 | balancerSwap | WBTC | single | 1 | 230 |
| W53 | Too little received | swap | USDC | single | 2 | 90, 140 |
| W53 | BAL#507 | balancerSwap | USDC | single | 3 | 141, 188, 251 |
| W55 | Too little received | swap | WBTC | single | 2 | 114, 134 |
| W55 | BAL#507 | balancerSwap | WETH | single | 1 | 221 |
| W56 | STF | swap | USDC | single | 40 | 170, 174, 218, 237, 239, 243, 250, 273, 279, 283, 285, 287, 289, 291, 303, 305, 307, 309, 311, 325, 327, 329, 331, 345, 355, 363, 365, 367, 385, 389, 393, 489, 495, 503, 517, 556, 562, 593, 605, 638 |
| W56 | STF | swap | USDC | 0 | 7 | 234, 247, 254, 357, 360, 527, 580 |
| W56 | WETH9: insufficient balance | curveSwap | WETH | 1 | 1 | 235 |
| W57 | STF | swap | USDC | single | 16 | 145, 147, 149, 267, 361, 375, 377, 379, 381, 538, 546, 558, 600, 606, 614, 628 |
| W57 | STF | swap | USDC | 0 | 9 | 313, 316, 422, 425, 428, 490, 503, 506, 515 |
| W57 | WETH9: insufficient balance | curveSwap | WETH | 1 | 2 | 314, 317 |
| W58 | STF | swap | USDC | 0 | 10 | 143, 148, 151, 361, 364, 442, 471, 474, 550, 557 |
| W58 | WETH9: insufficient balance | curveSwap | WETH | 1 | 3 | 144, 149, 152 |
| W58 | STF | swap | USDC | single | 16 | 220, 222, 251, 257, 259, 261, 263, 265, 267, 269, 271, 275, 277, 523, 578, 590 |
| W58 | WETH9: insufficient balance | balancerSwap | WETH | 1 | 4 | 472, 475, 551, 558 |
| W59 | STF | swap | USDC | single | 15 | 154, 197, 203, 209, 225, 229, 356, 552, 606, 616, 642, 646, 648, 650, 656 |
| W59 | BAL#507 | balancerSwap | WETH | single | 1 | 227 |
| W59 | STF | swap | USDC | 0 | 3 | 349, 420, 446 |
| W59 | WETH9: insufficient balance | curveSwap | WETH | 1 | 2 | 421, 447 |
| W59 | Slippage | curveSwap | USDC | single | 1 | 514 |
| W60 | BAL#507 | balancerSwap | WETH | single | 1 | 79 |
| W60 | STF | swap | USDC | single | 12 | 174, 176, 188, 190, 202, 209, 251, 292, 301, 303, 395, 477 |
| W60 | STF | swap | USDC | 0 | 7 | 206, 286, 289, 435, 440, 443, 446 |
| W60 | Too little received | swap | WBTC | single | 1 | 379 |
| W60 | WETH9: insufficient balance | curveSwap | WETH | 1 | 4 | 436, 441, 444, 447 |

