# G3 Stage 1 実時間タイムアウト診断ランブック

## 目的と判定

偽のコマンドラインプログラムを使い、1つの市場条件、1つの乱数初期値、1つの実時間世界で、要件5の R5a（呼出しが300秒で時間切れになるか）、R5b（直接の子プロセスが消えるか）、R5c（遅れて返る応答が適用されないか）を観察する手順。これは診断であり、G3 の証拠や合格判定ではない。実施結果は [G3-STAGE1-RESULT-2026-10-14.md](G3-STAGE1-RESULT-2026-10-14.md) を参照。

## 用語

- **G3** は Gate 3（自己改訂戦略の受入れ段階）、**R5a/R5b/R5c** は要件5の確認項目。
- **PID** は Process Identifier（プロセス識別番号）、**PPID** は親プロセスの識別番号、**PATH** はコマンドを探す場所、**forge** は Solidity のビルド道具。
- **Anvil** はローカル検証用チェーン実行器、**artifact** はビルドで生成される実行用ファイル、**manifest** は入力と状態の識別情報を記した目録。
- **CLI** は Command-Line Interface（コマンドライン操作）、**seed** は乱数初期値、**regime** は市場条件、**world** は市場条件と seed の組、**roster** は参加者名簿。
- **JSON** は構造化データ形式、**TSV** はタブ区切り表、**YAML** は設定用テキスト形式、**UTC** は協定世界時。

## 1. 固定する入力

| 項目 | 値 |
|---|---|
| 作業場所 | Mac mini の `~/ascon-dev` |
| 候補ソース | Mac mini `origin/main`、commit `65e4f14`、detached HEAD |
| 名簿 | `ascon-notes/league/g3/fault-timeout.yaml` |
| 市場条件 / seed / 並列数 | `calm` / `77001` / `1` |
| 起動経路 | `run-league.sh`、`--agent-sandbox process` |
| 呼出し先 / ケース | 名簿の偽プログラム / `G3_FAULT_CASE=timeout` |
| 時間上限 | `ERIS_LLM_CALL_TIMEOUT_MS=300000`（300秒） |
| 時間短縮 | `G3_UNIT_TIME_SCALE` は設定しない |
| モデル通信 | 行わない。偽プログラムは待機後に遅着予定の応答を出す |

実施時、Air の負荷が高かったため Mac mini の `~/ascon-dev` で行った。mini は `origin/main` の `65e4f14` を detached HEAD で使用した。診断時の入力固定は [結果記録](G3-STAGE1-RESULT-2026-10-14.md) にある。seed `77001` の事前確認は grep のみであり、完全な seed 監査ではない。この制約を認識し、正式な評価や G3 証拠として使わない。

## 2. 前提条件と準備

### 2.1 状態ダンプを選ぶ

`backtest/state` に、現在のチェックアウトに対応する状態ダンプと `manifest.json` が必要。候補は次の2つ。

1. **2026-10-03 の古いダンプ**：Mac mini の `~/ascon-run/ascon/backtest/state`、生成元 commit `7d3855abb786...`、Anvil 1.2.3。初回試行では LQTYStaking の預け入れ量が0で、環境が必要とする1,000,000を下回ったため使用できなかった。
2. **2026-10-06 の p60 ダンプ**：Mac mini の `~/ascon-run/p60/backtest/state`、生成元 commit `223f244597347f6e686ddc2946be075a50473b24`、Anvil 1.2.3。この診断で使用した状態。LQTY の事前ステークを含むため選ぶ。

どちらの原本もコピー元としてのみ扱い、移動・変更しない。診断専用 checkout の `backtest/state` がまだ無い状態で、mini の `~/ascon-dev` から次のようにコピーする。最初に古い方を別名で複製し、使う p60 ダンプを `backtest/state` に複製する。

```sh
cd "$HOME/ascon-dev" || exit 1
mkdir -p backtest
test ! -e backtest/state || { echo 'STOP: backtest/state already exists; inspect it first' >&2; exit 1; }
test ! -e backtest/state.from-ascon-run-20261003 || { echo 'STOP: backup destination already exists; inspect it first' >&2; exit 1; }
cp -a "$HOME/ascon-run/ascon/backtest/state" backtest/state.from-ascon-run-20261003 || exit 1
cp -a "$HOME/ascon-run/p60/backtest/state" backtest/state || exit 1
```

状態の出自と LQTY 残高を確認してから進む。manifest が無い場合は state dump を用意する必要があるが、今回の再現では稼働中チェーンから新規生成せず、既存 p60 ダンプを使用する。

### 2.2 Anvil と Solidity 成果物

使用したもの：`~/ascon-run/bin/anvil`（Anvil 1.2.3）。Mac mini の標準 Anvil は Homebrew 版 1.8.4 なので、診断の全コマンドで `~/ascon-run/bin` を PATH の先頭に置く。

```sh
cd "$HOME/ascon-dev" || exit 1
export PATH="$HOME/ascon-run/bin:$PATH"
command -v anvil
anvil --version
```

`command -v` が `$HOME/ascon-run/bin/anvil` を指し、版が1.2.3と確認できなければ停止する。古い forge artifact が別チェックアウトを参照していたり、ABI（Application Binary Interface、コントラクト呼出し形式）が現行コンストラクターと一致しないと実行前に失敗する。mini のこのリポジトリ内で次を一度実行する。

```sh
forge build
forge --version
```

今回 forge は1.8.4だった。ビルド後は `ERIS_FORGE_OUT` を設定しない。環境変数が古いチェックアウトの artifact を指すと同じ不一致を再発させる。

### 2.3 seed の確認

seed `77001` の事前確認に使ったのは次の単純検索で、正式な seed 監査ではない。Air または Mac mini の checkout で、main の tracked files を単語境界検索する。

```sh
git grep -nw 77001 origin/main -- .
```

Mac mini では次にファイル名検索と、seed 配列・設定の形を想定した内容検索を行う。

```sh
find ~/ascon-run ~/ascon-dev ~/Developer/ascon-g3-eval -name '*77001*'
grep -rIlE '[Ss]eeds?\"?[:= ]+\[?\"?77001' ~/ascon-run ~/ascon-dev ~/Developer/ascon-g3-eval
```

単語境界 grep は小数値 `.77001` も拾うため、mini では単純検索に171件の誤検出があった（この171件は操作記録で、`raw/` の証跡には含まれない）。seed形式を狙う上記パターンを併用する。このseed形式のパターンは、`[2, 77001]` のように77001が配列の先頭でない書き方には一致しない。それでも検索した範囲だけの結果であり、予約台帳・実行記録全体の監査や未使用の証明にはならない。実行後の index には今回使われた `77001` が載るため、再実行時は再確認する。

### 2.4 静穏時間と負荷

Air の負荷が高いときはそこで実行せず、診断に使う Mac mini 側の負荷と同時作業を確認する。1世界が約12分、準備を含めて約13分かかる。Mac mini では実行中に別の重いビルド、試験、コンテナ、Anvil、定期ジョブを走らせない。数値の負荷閾値は今回確立していないため、負荷が高い、他作業の有無が分からない、または必要な観測を保てない場合は開始を延期する。スリープ防止と電源接続も確認する。

### 2.5 子プロセス監視と事前自己試験

過去の監視は期待どおり動かなかった。run `e` では `comm` が `python3` または `Python` と完全一致するものだけを拾う監視を使い、子を確認できなかった。run `d` と `e` の watch raw log は保存されていない。run `f` の watch script は、引用符なし heredoc によって awk の `$` 展開が起きる形になり、awk syntax error を出した。これは作成者側のミスである。最終版 run `g` の監視スクリプトは、使用前に `fake-claude.py` 引数を持つ偽 Python プロセスで自己試験し、出力を確認した。

```sh
#!/bin/bash
# Records pid/ppid/stat/etime/comm for node processes and for any process whose command line
# mentions fake-claude (the command line itself is NOT kept; only the marker). Diagnostic only.
while :; do
  date -u +%Y-%m-%dT%H:%M:%SZ
  ps -Ao pid,ppid,stat,etime,comm,command | awk '
    NR==1 { print $1, $2, $3, $4, $5; next }
    /awk/ { next }
    /fake-claude/ { print $1, $2, $3, $4, "FAKE-CLAUDE(" $5 ")"; next }
    $5 == "node" { print $1, $2, $3, $4, $5 }'
  sleep 2
done
```

自己試験では、別 Terminal で引数に `fake-claude.py` を含む Python プロセスを起動し（例：`python3 -c 'import time; time.sleep(10)' fake-claude.py`）、別の Terminal でこの監視を約6秒動かして Ctrl-C で止め、その PID に対応する `FAKE-CLAUDE(...)` 行が出ることを確認する。行が見えなければ停止する。自己試験後、world の起動前に監視を開始し、出力を `~/g3-stage1-timeout-20261014.process-watch.log` に保存する。たとえばスクリプトを `~/g3-watch3.sh` に保存した場合は `bash "$HOME/g3-watch3.sh" > "$HOME/g3-stage1-timeout-20261014.process-watch.log" 2>&1` で起動する。コマンドライン全体は記録されず `/fake-claude/` の marker のみが出力される。

timeout の直前と直後に同じ偽プログラムの PID があるか確認する。PID と PPID を記録する。2秒間隔の監視では、消えた厳密な瞬間も kill 信号自体も確認できない。プロセス名に合致した子が特定できない場合は R5b を判定不能とする。

## 3. 一回の実行手順

必要条件が揃ったら、Mac mini の `~/ascon-dev` で実行する。label が既にある場合は別の label に変えず停止し、既存出力と衝突の理由を調べる。

```sh
cd "$HOME/ascon-dev" || exit 1
export PATH="$HOME/ascon-run/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24.19.0 || exit 1
test "$(node -v)" = v24.19.0 || exit 1
anvil --version | head -1 | grep -Eq '(^|[^0-9])1\.2\.3([^0-9]|$)' || exit 1
test -f backtest/state/manifest.json || exit 1
test ! -e ascon-notes/eval/out/g3-stage1-timeout-20261014 || exit 1
unset ERIS_FORGE_OUT
export MIN_FREE_GB=40
export BACKTEST_EXTRA_ARGS='--blocks 360'
RUN_LABEL='g3-stage1-timeout-20261014'
nohup caffeinate -ims /bin/bash ascon-notes/league/run-league.sh \
  --label "$RUN_LABEL" \
  --roster ascon-notes/league/g3/fault-timeout.yaml \
  --regimes calm \
  --seeds 77001 \
  --parallel 1 \
  --base-port 8847 \
  </dev/null >"$HOME/g3-stage1-timeout-20261014.launch.log" 2>&1 &
printf 'launcher_pid=%s label=%s\n' "$!" "$RUN_LABEL"
```

監視 Terminal はこの起動前から動かす。roster が偽 CLI、timeout 故障、300000ミリ秒を設定する。実モデルに切り替わる、予想外のネットワーク呼出しがある、別の seed / roster / source が使われる、監視が欠ける場合は継続しない。

## 4. 成功記録と読み方

完了後、launcher の終了、index の1行、run directory、summary、Anvil の終了を確認してからログを読む。index の `exit_code` だけでは成功を判定しない。成功には index の `run_dir` が空欄でないことと、launcher log に `completed with 0 failed run(s)` の行があることの両方を確認する。期待される保存先は以下。

| ファイル | 用途 |
|---|---|
| `~/g3-stage1-timeout-20261014.launch.log` | launcher 結果 |
| `~/ascon-dev/ascon-notes/eval/out/g3-stage1-timeout-20261014/index.tsv` | 実行した条件、run directory、終了コード |
| `~/ascon-dev/ascon-notes/eval/out/g3-stage1-timeout-20261014/calm-77001.log` | 1世界の開始・終了・失敗理由 |
| `~/ascon-dev/runs/<runId>/summary.json` | 世界の完了状態 |
| `~/ascon-dev/runs/<runId>/agents/cand.llm.jsonl` | 呼出しとtimeout記録 |
| `~/ascon-dev/runs/<runId>/agents/cand.jsonl` | 改訂拒否・適用、次回改訂のスキップ |
| `~/g3-stage1-timeout-20261014.process-watch.log` | 2秒間隔の子プロセス観測 |

- **R5a**：候補の呼出しが `timed out after 300000ms` となり、開始から約300秒後だったかを照合する。
- **R5b**：同じ子 PID がtimeout記録の直前に存在し、直後には見えないかを照合する。2秒間隔なので終了の厳密な時刻やkill信号は断定しない。
- **R5c**：該当呼出しに対する `installed` 記録がないことと、子プロセスの観測を合わせる。世界末尾時点で子が残っていないかも別に見る。

行列が正常終了したこと、summary が存在すること、timeout 文字列だけを根拠に三項目すべてを合格にしない。実行前からの監視欠落、index欠落、run directory不明、予期しない相手・市場条件、部分ログは判定不能として残す。

## 5. 後片付け

証跡を外部保存先へ複製し、保存先と SHA256（Secure Hash Algorithm 256-bit、ファイル照合値）を確認する。Anvil と launcher が終了したことを先に確認する。

診断で mini 側に置いた／生成されたもの：

- `backtest/state`：使用した p60 状態ダンプ。
- `backtest/state.from-ascon-run-20261003`：診断時に元の古い状態ダンプを置いた場所。再現時の手順では mini の元ダンプを変更・移動せず、ここへコピーする。
- `out/`：forge が生成した Solidity artifact。
- `sdk/src/constants.local.ts`：state manifest に合わせて backtest が再生成した tracked file。診断用 checkout でのみ元の内容へ戻すには `git checkout -- sdk/src/constants.local.ts` を実行する。
- `runs/`：完了した世界のログ・manifest・summary。
- `ascon-notes/eval/out/g3-stage1-timeout-20261014/`：label ごとの行列ログと index。
- `~/g3-stage1-timeout-20261014.launch.log` と `~/g3-stage1-timeout-20261014.process-watch.log`：外部ログ。

状態ダンプ、forge 出力、世界ログ、行列ログは必要な証跡を退避する前に削除しない。tracked file を復元するときは `~/ascon-dev` がこの診断専用の作業ツリーであることを確かめてから行う。共有作業の差分を誤って消さない。外部証跡の保存確認前に label 出力、run directory、watch log を消さない。Anvil が残った場合は所有者を確認せず HOME や state を消さない。

## 6. 適用範囲と未確認事項

この診断で評価環境との同等性、実モデルの挙動、複数seed・市場条件・worldにわたる再現性、epochをまたぐ状態の保存・復元、実際に子をkillした後の再開、子孫プロセスの終了、判断時間制限の全条件は確認できない。G3 status は BLOCKED のまま、B07 は未完了。`prestart-check.py` の seedAudit と証拠完全性は FAIL のまま変化なし。残り時間は UNKNOWN（不明、数値なし）。G3 の進捗として報告しない。
