# P60リハーサル・混成場の結果（2026-10-06）

r3は**条件付きの提出保険**。弱い参照場での優位は確認できるが、優勝の根拠にはならない。混成場では旧自作inc-zetaが首位、r3はnoop近傍。公式資格・提出READYは未成立のまま。

## 出典と実行条件

数値は指定集計の表示桁をそのまま転記。原ログ・実機・集計コードの再監査はしていない。`verified: true` は集計ファイルの事実を読取確認した範囲だけを示す。実行条件の補足は今回の依頼者引継ぎ、運用上の留意点は [OPS-LESSONS](OPS-LESSONS-2026-10-06.md)。測定SHAは `8c29964`（この資料の編集HEADとは別）。終了時刻は未提示。

| 計測 | host / roster | seeds / 規模 | chunks / G0 |
| --- | --- | --- | --- |
| P60リハーサル | mini / r3 FROZEN・F_ref 4体（ascon-zeta-r3、multi-arb、clean-arb、noop） | 62001–62005 / 12×5=60世界 | 1–4すべてG0 PASS（依頼者引継ぎ）、集計loops [362] |
| 混成場 | Air eval2 / r3 FROZEN＋固定10相手＋noop、計12体（下表）、p3 | 63001–63003 / 12×3=36世界 | 1–3・4bに計7世界G0 FAIL。除外・救済なし |

| chunk | レジーム |
| --- | --- |
| 1 | calm / cex-drift / informed-flow |
| 2 | whale / lending-incident / crash |
| 3 | depeg / vuln / spike |
| 4（混成4b） | depeg-persist / cdp-incident / launch |

ラベル `mb4→mb4b`、`MIN_FREE_GB=25` overrideは依頼者引継ぎ。ラベル変更の経緯・実効設定の原ログは未監査で、再試行による救済とは扱わない。OPS既定40 GBに対する25 GBは逸脱・絶対下限。Airの同時作業とloop不足の因果は未検証。同一hostのcodex jobs / npm ci / builds / ci-localとの競合を避け、入力固定・ホスト占有を記録する。

## P60リハーサル（非公式）

**公式P60ではない。F_refは弱い4体場**であり、本番相手への勝率は示さない。

| 指標 | 集計値 |
| --- | --- |
| mean(T−T_noop)≥0 | 12 / 12レジーム、最小7.93 |
| 等重みmean T | r3 58.82 / multi-arb 43.42 |
| P<noop | 5/60世界 |
| violations | 0 |
| r3 revert | 0.2/世界 |
| submit failures / submitted | 168/14167 |

| レジーム | 世界数 | 平均 P | 平均 P−noop | 最悪 P−noop | 平均(T−T_noop) | 平均 T(候補) | 平均 T(multi-arb) |
|---|---:|---:|---:|---:|---:|---:|---:|
| calm | 5 | 288.7 | 671.7 | -225.9 | 11.24 | 58.70 | 40.19 |
| cex-drift | 5 | 2856.9 | 1913.0 | 996.5 | 29.24 | 61.51 | 48.07 |
| informed-flow | 5 | 1313.8 | 1226.5 | 212.5 | 23.72 | 59.92 | 42.62 |
| whale | 5 | 3505.5 | 3293.3 | 78.6 | 18.78 | 50.01 | 40.01 |
| lending-incident | 5 | 1245.9 | 2096.9 | 1901.5 | 22.68 | 61.85 | 46.97 |
| crash | 5 | 1964.6 | 2490.1 | 576.2 | 19.29 | 59.14 | 50.19 |
| depeg | 5 | 712.8 | 265.4 | -608.1 | 7.93 | 58.46 | 37.77 |
| vuln | 5 | 403.6 | 335.6 | -128.2 | 11.05 | 59.65 | 38.08 |
| spike | 5 | 2328.5 | 1108.6 | -1374.7 | 11.50 | 53.09 | 50.81 |
| depeg-persist | 5 | 482.4 | 813.3 | 272.4 | 13.03 | 61.47 | 38.02 |
| cdp-incident | 5 | 162.5 | 1196.2 | 266.9 | 21.63 | 58.63 | 47.31 |
| launch | 5 | 1690.5 | 1896.7 | 387.9 | 19.23 | 63.42 | 40.94 |

集計末尾には `Traceback (most recent call last):` と `q0_summary_r3.py`, `line 23` が残る。上記値はその後に提示された集計値の引用であり、スクリプト正常終了を認定しない。revert平均は資格基準の再認定に使わない。

## 混成場（診断・FAILを保持）

原文: `SIMPLIFIED T = 50+10*(P-mean)/popstdev over the 12 agents per world, equal weight; NOT the official weighted T.`

36世界のみ、後半重みを反映しない簡易T。G0 FAILの7世界を含む全36世界の結果で、適格な合格集合ではない。旧自作inc-zeta（r3と同じbid paramsとの依頼者引継ぎ）が1位57.42（約57.4）、r3は7位50.65、noopは49.44。bid設定・コード同一性は今回再監査していない。

| 順位 | agent | meanT | meanP-noop | P<noop |
| --- | --- | --- | --- | --- |
| 1 | inc-zeta | 57.42 | 621.7 | 13/36 |
| 2 | venue-arb | 53.98 | 349.3 | 15/36 |
| 3 | sonnet-1 | 53.24 | 259.2 | 8/36 |
| 4 | opus-1 | 52.90 | 265.3 | 9/36 |
| 5 | grok-1 | 52.67 | 228.7 | 6/36 |
| 6 | clean-arb | 50.69 | 134.8 | 20/36 |
| 7 | ascon-zeta-r3 | 50.65 | 115.5 | 19/36 |
| 8 | astra-2 | 50.18 | 35.6 | 18/36 |
| 9 | astra-1 | 49.55 | 11.5 | 14/36 |
| 10 | noop | 49.44 | 0.0 | 0/36 |
| 11 | sonnet-2 | 43.03 | -282.1 | 26/36 |
| 12 | multi-arb | 36.26 | -701.0 | 28/36 |

| 混成レジーム | r3 meanT | venue-arb meanT | inc-zeta meanT | noop meanT |
| --- | --- | --- | --- | --- |
| calm | 40.5 | 55.9 | 48.5 | 54.9 |
| cdp-incident | 47.1 | 49.2 | 60.4 | 45.7 |
| cex-drift | 60.7 | 72.7 | 41.1 | 48.8 |
| crash | 45.4 | 55.9 | 59.7 | 45.7 |
| depeg | 63.0 | 44.7 | 65.0 | 47.7 |
| depeg-persist | 46.0 | 48.2 | 57.7 | 55.2 |
| informed-flow | 44.9 | 56.5 | 55.9 | 50.5 |
| launch | 49.5 | 47.5 | 72.1 | 49.3 |
| lending-incident | 37.2 | 53.5 | 64.9 | 52.0 |
| spike | 53.5 | 61.5 | 52.4 | 49.3 |
| vuln | 54.6 | 56.1 | 56.7 | 51.3 |
| whale | 65.2 | 46.2 | 54.6 | 42.7 |

期待loopIterationsは362。以下の7世界をflaggedのまま保存し、再実行・除外で救済しない。

| G0 FAILレジーム | seed | loopIterations |
| --- | --- | --- |
| informed-flow | 63001 | 361 |
| crash | 63001 | 360 |
| vuln | 63001 | 359 |
| depeg-persist | 63001 | 360 |
| depeg-persist | 63002 | 359 |
| cdp-incident | 63001 | 361 |
| cdp-incident | 63002 | 360 |

## 判断への含意・振り返り

| 論点 | 観測／仮説と次の判断 | 担当 |
| --- | --- | --- |
| r3 vs inc-zeta gap | 観測は上表。3修理が挙動を変えた可能性は未検証。資産別・約定edge・gas・片脚・期末在庫・専門処理への分岐で損益差を分解する | Codex（分析）、本人（採否） |
| venue-arb機構 | OPTIONSのコード読取報告ではWETH単脚・10bps入口・残高2.5–25%・既定tip。r3/inc-zetaはWETH/WBTC両脚優先、単脚fee＋50bps、競合追随入札、前段にLiquity/launch。小機会捕捉、WBTC損失回避、機会逸失回避、期末在庫の寄与は仮説 | Codex |
| 方針 | OPTIONS推奨はA（r3を保険）＋D（場への頑健性）→根拠があればB（独自在庫制御）。C（取引／待機切替）も提案段階。追加実験は未実行・未承認 | 本人 |
| 本人判断待ち | C+Eの新候補停止を限定1候補だけ解除するか、独自性、優勝探索と提出確保の優先度、最悪損失許容、未精算分・両host予約を差し引いた研究枠。AI性能研究停止は維持 | 本人 |

OPTIONSは少数世界時点の戦略メモであり、その数値を今回の36世界結果へ混ぜない。F_refと混成場のTは母集団も約定・在庫経路も異なり、単純な因果比較ではない。

## 未検証

- 公式重み付きTとの一致、公式P60、G3、G4、実提出・受理。既存資格フラグ、Q-ZETA条件4 FAIL／原条件5・6 BLOCKEDは不変。
- 原ログ／manifest／end.marker、実完了時刻、入力・dump・ZIP hashの一致、miniの集計Traceback原因、混成場の安全内訳。
- 7世界loop不足と同時負荷の因果、mb4→mb4bの操作経緯、容量overrideの実効値、正確なhost-h精算。
- r3の3修理とinc-zetaとの差の因果、同bid paramsの再照合、venue-arb収益機構、未知seed・複数場・本番での優勝力。

### ローカル出典（生ログへのリンクなし）

| 出典 | 用途 | SHA-256 |
| --- | --- | --- |
| `/tmp/results-2026-10-06/p60-rehearsal-60worlds.txt` | P60リハーサル全数値 | `4bfdf71f1254de192965863cd14cf4786e67133c16ee9c87a6e82b7dd98b4aa6` |
| `/tmp/results-2026-10-06/mixed-field-36worlds.txt` | 混成場全数値・G0 FAIL一覧 | `d183a5fbc1683160f5b09a5a2b44748fb436e95b1a86973b433254ef02e3c6fe` |
| `/tmp/strategy-rethink/OPTIONS.md` | 戦略機構・選択肢・本人判断の要約のみ | `04dc5f833dc209e31eedbf62bc4bb8fe0dcd5db685a6a651c8851cff71d6c413` |

ファイル内容と今回の依頼者引継ぎを保存資料に要約したもの。ネットワーク・SSH・Docker・新計測・commitは実施しない。
