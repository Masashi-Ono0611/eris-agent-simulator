# Q-ZETA-02 結果（2026-10-06 JST・Claude 集計・本人受領待ち）

判定: **不合格（基準4）。** 契約どおり再走・seed追加・基準変更はしない。結果は保持する。基準1・2・3は達成。

## 実行
- 候補 `ascon-zeta-r2`（hash ddd7c718…786c）、F_ref、12レジーム×seed 47001–47005＝60世界、1回、4チャンク（3レジーム×5seed）。
- **host=Mac mini（確定・変更なし）**。02:02–06:25 JST（約4.4h）。4チャンクとも G0 PASS（各360blocks/362loops、世界ごとの欠測なし）。sleep・中断なし（miniは常時稼働、caffeinate使用）。mini は Intel/anvil 1.2.3（Air と同コミット a813a2ce）。
- 実行元ファイル: 集計は mini の `~/ascon-run/logs/qzeta2-summary.txt`、各世界の出力は `~/ascon-run/ascon/ascon-notes/eval/out/qb{1..4}-q-zeta-02/`（mini上・編集しない）。

## 基準ごと
| 基準 | 結果 |
|---|---|
| 1 全60世界 G0 PASS | 達成（4チャンク PASS、60世界） |
| 2 12レジーム等重み平均T ≥ multi-arb | 達成（候補 58.91 / multi-arb 42.34） |
| 3 全12レジームで平均(T−Tnoop)≥0 | 達成（12/12、最小 6.15 = depeg-persist） |
| 4 各世界 mined revert ≤1 かつ ≤0.1% | **不達成**: revert のある世界 8/60、各1件（合計8件）。いずれも包含取引 205–314件で比率 0.318–0.488%。全世界の包含が1000件未満（72–339）なので1件でも比率条件を満たさない |
| 5 原因不明の失敗0 | 未判定（submit_failed 160/13,552=1.18%、全件の原因・回収の突き合わせは未実施） |
| 6 未回収資産損失・gas枯渇・無効注文・違反0 | 違反0は確認。他は未判定 |

revert のあった世界: cex-drift/47002, informed-flow/47001, informed-flow/47005, crash/47002, crash/47004, crash/47005, vuln/47001, depeg-persist/47002。

## 参考（基準ではない）
候補 平均P 1343、multi-arb −274、clean-arb 469。revert は 候補 0.1件/世界、multi-arb 3.9、clean-arb 0.6。P−noop が負の世界があるレジーム: calm, cex-drift, depeg, depeg-persist, cdp-incident（世界単位）。

## 扱い
- 失格は新規の試行権を生まない。次の判断は本人: `OPTIONS-AFTER-QZETA02-2026-10-06.md` の選択肢A〜E。
- 診断（zr3〜zr6、48世界）と本試験（60世界）を合わせた r2 の revert 世界率は 12/108=11.1%。P(60世界すべてゼロ) はこの率でも約 0.1% 未満。
