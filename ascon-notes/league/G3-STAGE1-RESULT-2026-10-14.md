# G3 Stage 1 実時間タイムアウト診断結果 — 2026-10-14

## 判定

これは一つの world・seed・host の実時間診断で、G3 の証拠ではない。G3 status は **BLOCKED** のまま、B07 は未完了。`prestart-check.py` の seedAudit と証拠完全性は **FAIL のまま変化なし**。残り時間は **UNKNOWN**（不明、数値なし）。この診断を G3 の進捗として報告しない。

## 用語

- **PID** はプロセス識別番号、**PPID** は親プロセスの識別番号、**CLI** はコマンドライン操作、**ABI** は Application Binary Interface（プログラム間の呼出し形式）。
- **artifact** はビルド生成物、**index** は実行結果の一覧、**exit code** はプロセスの終了コード、**detached checkout** はブランチに接続せず特定 commit を直接 checkout した状態。
- **p60 ダンプ** はこの記録で2026-10-06生成の状態ダンプを指す呼び名。**runtime** は世界を実行するプログラム、**world** は市場条件と乱数初期値の組。

入力は Mac mini の `~/ascon-dev`、`origin/main` の `65e4f14` detached checkout、`calm`、seed（乱数初期値）`77001`、並列数1、process sandbox（別プロセス実行方式）、偽 CLI の timeout 名簿。実行引数は `raw/world-g3-stage1-timeout-20261014g.log:2-3`、候補の timeout 設定は `ascon-notes/league/g3/fault-timeout.yaml:27-35` に記録されている。時間上限は300,000ミリ秒で、時間短縮設定なし、実モデル呼出しなし（偽プログラムの説明と301秒待機 `ascon-notes/league/g3/fake-claude.py:1-4,23-24`）。実行ラベルは空欄（なし）、`b`、`c`、`d`、`e`、`f`、`g` の7回。各試行 index は外部証跡の `raw/index-g3-stage1-timeout-20261014.tsv:1-2`; `raw/index-g3-stage1-timeout-20261014b.tsv:1-2`; `raw/index-g3-stage1-timeout-20261014c.tsv:1-2`; `raw/index-g3-stage1-timeout-20261014d.tsv:1-2`; `raw/index-g3-stage1-timeout-20261014e.tsv:1-2`; `raw/index-g3-stage1-timeout-20261014f.tsv:1-2`; `raw/index-g3-stage1-timeout-20261014g.tsv:1-2` に記録されている。index の `exit_code` だけでは成功を判定できない。失敗した `b`/`c`/`d` も `exit_code=0` だが、`run_dir` が空欄である。実行全体の成功は `run_dir` が空欄でないことに加え、launcher log に `completed with 0 failed run(s)` があることを条件とする。保存 raw では `e` と `g` の launcher log にこの行がある。`f` は index に run directory と exit code 0 があり、world log は `realtime simulation completed` と報告する一方、launcher log は raw に含まれず、この厳密な成功条件を独立確認できない。各 world log は `e`/`f`/`g` の3つで完了を報告し、所要時間は約12分である（index各 `:1-2`; `raw/g3-stage1-timeout-20261014e.launch.log:3`; `raw/g3-stage1-timeout-20261014g.launch.log:3`; `raw/world-g3-stage1-timeout-20261014e.log:24-28`; `raw/world-g3-stage1-timeout-20261014f.log:15-19`; `raw/world-g3-stage1-timeout-20261014g.log:15-19`）。

## 準備段階の失敗連鎖

7回の起動のうち、最初の4回は runtime の timeout 検証に入る前の準備不足で失敗した。これは前のランブックに書かれていなかった準備上のつまずきである。

| label | 失敗・対応 | 証拠 |
|---|---|---|
| なし | backtest の state manifest が無く起動できなかった。既存ダンプをコピーして使い、古いダンプの中身は変更しなかった。 | `raw/world-g3-stage1-timeout-20261014.log:2-6`; index `raw/index-g3-stage1-timeout-20261014.tsv:1-2` |
| `b` | forge artifact が無かった。`ERIS_FORGE_OUT` が古い checkout を向いていたため、次の試行で mini の `~/ascon-dev` 内に artifact を用意した。 | `raw/world-g3-stage1-timeout-20261014b.log:17-22`; index `raw/index-g3-stage1-timeout-20261014b.tsv:1-2` |
| `c` | 古い artifact と現在の constructor 引数の ABI が合わなかった。mini の checkout で `forge build`（forge 1.8.4）を実行した。 | `raw/world-g3-stage1-timeout-20261014c.log:16-26`; forge の版は実行記録（下記の未検証事項） |
| `d` | 2026-10-03 状態ダンプで LQTYStaking の預け入れが0、環境の必要量1,000,000未満だった。より新しい p60 ダンプへ切り替え、古いものを `backtest/state.from-ascon-run-20261003` に移した。 | `raw/world-g3-stage1-timeout-20261014d.log:16-18`; p60 の生成元 commit 短縮値は `raw/world-g3-stage1-timeout-20261014e.log:6` |
| `e`, `f`, `g` | 各 world log は p60 状態での realtime simulation 完了を報告。index はそれぞれ run directory と exit code 0。launcher の `completed with 0 failed run(s)` は保存 raw で `e` と `g` のみ確認でき、`f` は launcher log が無く独立確認できない。以降の分析対象は最後の `g`。 | `raw/index-g3-stage1-timeout-20261014e.tsv:1-2`; `raw/index-g3-stage1-timeout-20261014f.tsv:1-2`; `raw/index-g3-stage1-timeout-20261014g.tsv:1-2`; `raw/g3-stage1-timeout-20261014e.launch.log:3`; `raw/g3-stage1-timeout-20261014g.launch.log:3`; `raw/world-g3-stage1-timeout-20261014e.log:24-28`; `raw/world-g3-stage1-timeout-20261014f.log:15-19`; `raw/world-g3-stage1-timeout-20261014g.log:15-19` |

標準 Mac mini Anvil は Homebrew 版1.8.4だったため、すべての実行で `~/ascon-run/bin/anvil` の1.2.3を PATH の先頭に置いた。seed `77001` は grep で main の単語境界検索0件、mini のファイル名検索と seed パターン検索0件を確認しただけで、正式な事前 seed 監査ではない。runbook はこの経緯と再現前提を記録している。これらの版、PATH、grep 集計の元コマンド出力は、保存済み raw 25ファイルには含まれないため、ここでは実行記録として扱い、raw ファイルからの再確認済みとはしない。

## プロセス監視の試行履歴

run `e` の監視は `comm` が `python3` または `Python` と完全一致するプロセスを探し、対象の子プロセスを表示できなかった。run `d` と `e` の process-watch raw log は保存されていない。run `f` の監視スクリプトは引用符なし heredoc による `$` の展開で awk syntax error を起こした。これは作成者側のミスで、raw log に `awk: syntax error` / `awk: illegal statement` が繰り返しあり、`FAKE-CLAUDE` 行は0件だった（`raw/g3-stage1-timeout-20261014f.process-watch.log:1-6` および全ログ集計）。run `g` では最終版を使い、使用前に `fake-claude.py` の引数を持つ偽 Python プロセスで自己試験し、監視に `FAKE-CLAUDE(...)` 行が出ることを確認した。最終版スクリプトと自己試験手順はランブック §2.5 に記載した。当時のスクリプト原本と自己試験のログは raw に含まれない。

## R5a — 300秒 timeout

**観察：この実行の偽 CLI 呼出しは、候補ログに300,000ミリ秒 timeout として記録された。** run `g` の block 1352 呼出しは `12:17:15.820Z` に timeout となり、候補イベントは同時刻に「revision rejected」と記録した（`raw/runG-agents-cand.llm.jsonl:1`; `raw/runG-agents-cand.jsonl:225`）。プロセス監視では子 PID 17605 が `12:12:17Z` に初めて見え、`12:17:14Z` に経過時間04:59、2秒後の `12:17:16Z` には見えない（`raw/g3-stage1-timeout-20261014g.process-watch.log:530-539,1840-1849`）。これは観測した子が約300秒で消えたことを示す。kill 信号そのものは観測していない。

block 1352 の呼出しが継続中だったため、改訂予定 block 1412 と1472はそれぞれスキップされた（`raw/runG-agents-cand.jsonl:130,194`）。

## R5b — 子プロセスの観測と世界終了

run `g` の2秒間隔監視では、timeout対象の子 PID 17605 は agent-sandbox の Node.js PID 17064（PPID 16916）の子として観測され、timeout後に監視出力から消えた（`raw/g3-stage1-timeout-20261014g.process-watch.log:530-539,1830-1849`）。PID 17064 は agent-sandbox のプロセスであり、PID 16915（PPID 16900）とは別である。

世界末尾の block 1532 で始まった別の偽 CLI PID 19228 は、親 PID 17064 とともに最初に記録された（`raw/g3-stage1-timeout-20261014g.process-watch.log:2083-2092`）。PID 17064（PPID 16916）は `12:22:17Z` の標本にあり、`12:22:19Z` の標本では見えず、子の PPID は1となった。最初の `PPID=1` 行は `raw/g3-stage1-timeout-20261014g.process-watch.log:3123-3147` にある。この標本列から、PID 17064 の終了後に子 PID 19228 が親から孤立して世界末尾を越えて残ったと観察できる。PID 16915（PPID 16900）はその後も標本にあり、PID 17064とは異なるプロセスである（同 `:3123-3147`）。summary ファイルの filesystem mtime は `2026-10-14 12:22:51Z`（日本時間21:22:51）で、JSON本文に mtime の行はない。監視ログの `12:22:51Z` と `12:23:16Z` には PID 19228 が残り、経過時間04:36と05:01を記録し、`12:23:18Z` の次の標本には出ていない（`raw/g3-stage1-timeout-20261014g.process-watch.log:3213-3221,3250-3267`; run ID と処理 block 数は `raw/runG-summary.json:1-8`）。runtime が world end で子を終了させなかった、という結論はこの orphaning からの**推論**で、kill 信号や終了動作を直接観測した事実ではない。

呼出し中だった block 1532 のため、後続改訂の block 1592 と1652もスキップされた（`raw/runG-agents-cand.jsonl:318,379`）。

## R5c — 改訂の適用有無

候補イベントに block 1352 の「revision rejected」があり、block 1412・1472は同じ呼出しの継続中としてスキップされている。全381行の候補ログに block 1352 の `installed` 記録はなく、時間切れになった呼出しの子は301秒より前に監視から消えた。ゆえにこの診断では、timeout後の遅着応答がその改訂として適用されなかったと判断する。これは fake CLI と実行ログを使った一回の診断であり、稼働中の提出プログラムでの挙動を証明しない（`raw/runG-agents-cand.jsonl:1-381`; 拒否・スキップ行 `:130,194,225`; `raw/runG-agents-cand.llm.jsonl:1`; 偽プログラムの301秒待機 `ascon-notes/league/g3/fake-claude.py:23-24`; `raw/g3-stage1-timeout-20261014g.process-watch.log:1830-1849`）。

世界末尾の block 1532 呼出しでは agent-sandbox の Node.js PID 17064 が監視から消え、その後に子が孤立して残った。PID 16915（PPID 16900）は、その後も監視に残っていた（PID 16947 は PID 17064 と同じ PPID 16916 で、17064 と同時に消えており、runtime とは言えない）。この観測から、world-end 時にruntimeが子をkillしなかった可能性は推測できるが、runtimeの kill 動作は直接観測していない（`raw/g3-stage1-timeout-20261014g.process-watch.log:3123-3147,3213-3221,3250-3267`）。

## 未確認の点と限界

- 一つの world、一つの seed、一つの市場条件、Mac mini（Intel）一台だけの結果。
- 子プロセスは2秒間隔の監視で観測した。kill 信号と消失の厳密な時刻は記録されていない。
- CLI は偽物で、実モデル呼出しはない。
- `run-league` から起動したリポジトリ標準 runtime の backtest である。提出 artifact の実行経路は検証していない。
- 要件5のうち、epoch 間の状態引き継ぎ・復元、実際の kill 後の再開、多数 world の実行は未検証。
- したがって、実提出プログラムの振る舞い、正式な seed 未使用、全状況での子終了、遅着応答に対する一般的な安全性は未証明。

## 証跡の完全性と未検証事項

生証跡は `/Users/masashi_mac_ssd/Developer/ascon-evidence-stage1-2026-10-14/raw/` にあり、親ディレクトリの `SHA256SUMS.txt` にある25項目は raw ディレクトリから照合し、全て一致した（`SHA256SUMS.txt:1-25`）。ファイル本文の引用は各節にファイル名と行番号を示した。

保存 raw のみでは、seed grep の標準出力、forge と Anvil の版確認出力、当日の監視スクリプトと自己試験コマンドの原本、summary.json の filesystem mtime を含むファイルメタデータ、p60 ダンプの完全な source commit（raw の実行ログは `223f24459734` まで表示）を再確認できなかった。これらは実行担当の記録として与えられた事実であり、raw の行内容で独立検証した項目ではない。runbook には再現用の監視スクリプトとその自己試験手順を記したが、当日使われた原本との完全一致を主張しない。`raw/runG-summary.json:1-8` は run ID と処理 block 数を示すが、mtimeは記録していない。
