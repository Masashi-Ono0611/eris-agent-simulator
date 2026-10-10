# 時間干渉ハーネスの対照実験

loader-timing.test.mjs が実測JSONから生成。以下は対照実験の数値で、production probeのoverheadの推定ではない。

事前閾値: positiveの積分差3〜9ms、T−4msでtimeout割合増加≥0.5。negativeの積分差の絶対値≤2ms。
両armはstock StrategyRunner + production probe。positiveのBのみ測定専用listenerで6ms追加。negativeは同一設定。

| control | 実行状態 / 対照判定 | T ms | 点ごとの予定n | 積分差 ms | load開始 | load終了 | load最大 | delay発火 A/B |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| positive | aborted / failed | 80 | 16 | 3.8928571428571423 | 1.64013671875 | 2.69580078125 | 2.69580078125 |  |

## positive

| d ms | n/arm | A timeout | B timeout | B−A割合 |
| ---: | ---: | ---: | ---: | ---: |
| 68 | 8 | 0 | 3 | 0.375 |
| 70 | 8 | 0 | 7 | 0.875 |
| 72 | 8 | 6 | 7 | 0.125 |
| 74 | 7 | 6 | 7 | 0.1428571428571429 |
| 76 | 7 | 5 | 7 | 0.2857142857142857 |
| 78 | 7 | 6 | 7 | 0.1428571428571429 |
| 80 | 7 | 7 | 7 | 0 |
| 82 | 8 | 8 | 8 | 0 |
| 84 | 7 | 7 | 7 | 0 |

単一ホストの低負荷条件内での有限サンプル。noise閾値の通過は一般的な等価性を意味しない。G3 evidenceではない。
