# 時間干渉計測: 実行結果と未完了事項

**未完了。負荷条件を維持できず、要求された件数と正対照・負対照の成功を確認できなかった。G3 evidenceではない。**

この文書の件数・時刻・exit code・表は保存JSONと実行ログから自動生成した。

生成時刻: 2026-10-09T03:13:20.373Z
git HEAD: ab5ad98f121b26e7738ef23874180eea6e8b3868

## 保存された実測

| 試行 | 状態 | 休止 ms | 予定n | 実測n | 最大1分load | 拒否閾値 |
| --- | --- | ---: | --- | --- | ---: | ---: |
| 本計測 | aborted | 300 | overhead 240/arm、境界 24/点/arm | overhead 13/arm、境界 0 pairs | 2.71435546875 | 2.5 |
| 正対照の再試行 | aborted / failed | 1500 | 16/点/arm | 7〜8/点/arm | 2.69580078125 | 2.5 |
| 負対照 | 開始前拒否 | — | — | 未開始 | — | — |

最初の正対照も負荷超過で中断し、負対照は開始前拒否となった（下記command 1）。
その後の本計測も中断したため、呼出時間の計測区間外の休止を延ばし、対照実験を再試行した。負荷上限と正負対照の受入基準は緩めていない。
最終コードの予定設定はoverhead 240/arm、境界 20/点/arm、休止 1500ms。この設定の本計測は未実行。上表の本計測JSONは改定前の設定をそのまま保存している。

正対照は規定の全反復数に届かず、finishProbe/記録監査および境界差の受入判定まで到達していない。途中の割合差を「干渉検出の証明」と扱わない。負対照の差がnoise内かどうかも未検証。
本計測のoverheadは要求された200件/armに未達で、probe有無のdeadline境界実験は未開始。部分分布を一般的なoverheadの推定や上限として採用しない。

- [本計測の自動生成レポート](TIMING-MEASUREMENT-2026-10-09.md)
- [本計測の全取得pairと設定JSON](TIMING-MEASUREMENT-2026-10-09.json)
- [対照実験の部分データJSON](../tests/TIMING-CONTROLS-2026-10-09.json)
- [実行コマンドと保存ログJSON](TIMING-VALIDATION-2026-10-09.json)

## 実行したコマンドと結果

### command 1

```sh
node --test --test-reporter=tap ascon-notes/league/g3/tests/loader-timing.test.mjs
```

exit 1、tests=4 / pass=2 / fail=2 / skipped=0。

### command 2

```sh
node ascon-notes/league/g3/loader/measure-timing.mjs --output ascon-notes/league/g3/loader/TIMING-MEASUREMENT-2026-10-09
```

exit 1。
保存したconsole出力はツール上限で省略あり。測定値は別途保存した本計測JSONを参照する。

### command 3

```sh
G3_TIMING_CONTROL_OUTPUT=ascon-notes/league/g3/tests/TIMING-CONTROLS-2026-10-09 node --test --test-reporter=tap ascon-notes/league/g3/tests/loader-timing.test.mjs
```

exit 1、tests=4 / pass=2 / fail=2 / skipped=0。

### command 4

```sh
npm run typecheck
```

exit 0。

### command 5

```sh
node --import tsx --test --test-reporter=tap ascon-notes/league/g3/tests/loader-probe.test.mjs
```

exit 0、tests=13 / pass=13 / fail=0 / skipped=0。

### command 6

```sh
git diff --check
```

exit 0。

### command 7

```sh
node ascon-notes/league/g3/loader/validate-timing-artifacts.mjs
```

exit 0。

## 整合性と残作業

既存プローブsuiteはprotected stock 178ファイルのSHA-256と全trackedファイルの未変更を確認した。typecheckは成功。artifact validatorはJSONから集計とMarkdownを再生成・照合し、fixture/probe/stockのhash、追加先、git diff --check、新規ファイルへのgit diff --no-index --checkを検査する。validatorのexit 0は計測完了を意味しない。

実測JSON内のdriver hashはその試行時の値。driverの休止・予定反復数・表示文は後で改定しており、現在のdriver hashとの一致は主張しない。既存のprobe-loaderとstockのソースは変更していない。

次に必要なのは、低負荷を維持できるホストで正対照・負対照を完走し、未使用の出力名で本計測を完走すること。閾値超過を自動再試行して成功runだけを選ぶ機能はない。

単一ホスト、定義した低負荷条件、小さい非送信fixture、StrategyRunnerレベルのみが対象。実戦略・実5秒境界・高負荷・botMain・chain・モデル・backtest・G3要件はいずれも未検証。今回commit/push/network/Docker/Anvil/backtest/SSH/model呼出は行っていない。
