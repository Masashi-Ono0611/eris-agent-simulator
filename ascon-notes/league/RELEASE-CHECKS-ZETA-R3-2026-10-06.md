# ascon-zeta-r3 release 事前確認の記録

作成: 2026-10-06（JST）。提出候補は本人の選択（2026-10-06）で r3（C-EXCEPTION-01 §8）。r3 は r2 とコード 4 ファイルが同一で、prompt.md のみが違う。結果は**この 1 回の実行の記録**で、提出準備の完了ではない。P60・G3・G4 は未実施。射程と限界は SELFTEST-ZETA-R2-2026-10-06.md と同じ。

| 項目 | 結果 | 根拠 |
|---|---|---|
| 型検査・`check:strategy`・r3 のテスト（12 件） | PASS（check:strategy は 102 ファイル） | PR 12 の作業で私が実行。出力は未添付の自己申告（PR 12 の CI でも全テストが通っている） |
| `ci-local.sh --ref 64e4990 --full` | PASS（pass 2337、skip 9、fail 0） | 私が実行（`/tmp/cilocal-full-r3.log` の末尾） |
| release の bundle（`bundle:agent -- ascon-zeta-r3`、main `1f49117`） | 成功。forge artifact（AgentERC20）同梱。候補コードに環境変数の読み取りなし | 私が実行・展開して grep（出力ファイルは未添付）。ZIP の SHA-256 は byte 再現しないので提出用に 1 つへ固定すること |
| selftest（`agent:selftest -- ascon-zeta-r3`） | PASS（11 件包含、revert 0、2 CPU/4GB）。**ただし live week の隔離なし（ネットワークは bridge）での実行**。ログに警告が出ている | 同梱 `selftest-r3-log.txt` |
| release ZIP と selftest 用 worktree の ZIP | 中身一致（96 ファイル、mtime 除く） | 比較の出力の抜粋を `release-r3-evidence-excerpts.txt` に同梱（`ZIP payload equal: True 96 96`）。release ZIP の SHA-256 は実行前後で一致 |

注: ci-local は main `64e4990`（PR 14 まで）、bundle と selftest は `1f49117` で行った。両者の差は文書のみ（コード差分なし）で、これは差分の確認によるもの。
