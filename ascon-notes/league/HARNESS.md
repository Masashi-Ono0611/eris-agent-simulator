# ラウンド改善ハーネス

すべて依存追加なし。集計・記録・指示書生成・進捗表示はローカル成果物を読む。
`confirm-candidate.sh` と `spawn-player.py` は `--dry-run` を外すと実行するので、運営が行う。
既存の `eval/*` と `run-league.sh` は変更しない。

## ラウンド終了後

以下の値を実際のラウンド名・ロスター・並列度・存続 ID に置き換える。

```bash
ROUND=round-1
ROSTER=ascon-notes/league/roster-round-1.yaml
python3 ascon-notes/league/league-report.py "$ROUND" --ref inc-zeta --top-k 3 --boot 10000 \
  -o ascon-notes/league/report-round-1.md
python3 ascon-notes/league/ledger.py "$ROUND" --roster "$ROSTER" --parallel 2 \
  --boot 10000 --notes 'round 1; code hashes captured after completion'
python3 ascon-notes/league/next-gen-brief.py "$ROUND" --generation 2 \
  --survivors astra-1,opus-1 --fresh 'grok-3:在庫中立の新しい収益源' --roster "$ROSTER"
```

`league-report.py --json` は全統計を JSON に出す。レポート・ledger・brief は共通の統計コードを使う。
デフォルト bootstrap は 2000 回、乱数 seed=1、上位 k=3 / N=3。
レジームごとに元と同数のシナリオを復元抽出し、レジーム等重みで評価する。
レポートの基準差は各プレイヤーと基準の共通シナリオ、順位は全競争者の共通シナリオで計算する。
少ない seed から狭い CI が出ても、未観測レジームや新 seed の実力を保証しない。
同点の順位確率は均等配分する（ID 順で勝者を決めない）。推奨の同点のみ ID 順で決定する。
選抜対象の既定は noop/multi-arb/clean-arb/crowd/inc-zeta と `--ref` を除いた非 baseline。
他の参照があれば `--players ID,ID,...` で競争者を明示する。
下位半分を脱落候補とし、各系統（末尾 `-数字` を除いた ID）の最高位を保護する。
多様性枠により半数より多く残る場合がある。脱落候補なしは「空」と明示する。
共通の有効採点シナリオが 0 なら report / ledger / brief（fresh のみも含む）/ status は非 0 終了。
共通シナリオが 12 レジーム・各 2 seed 以上を満たさなければ被覆不足を警告する。

区間の端点は `(n-1)*0.025` と `(n-1)*0.975` の対称線形補間。
bootstrap が 1000 回未満なら少数試行の参考区間と表示し、95% CI と呼ばない。
対応差のレジーム内 seed が 1 件でも 1 個、または区間幅が 0 なら「縮退（再標本分散なし）」と表示し、
`ci_degenerate` をレポート JSON と台帳に保存する。
競争者数が top_n 以下の上位枠維持確率は判定不能。順位の安定性は選抜バイアスの補正ではない。

約定欄は `includedTxCount`（包含数であり成功した売買に限定されない）、
リバートは `revertCount`、送信失敗は `agents/<id>.jsonl` の `mempool/submit_failed`。
優先手数料は `mode=backtest` の base fee=0 を前提に、`blocks.csv` の実 gas 使用量と
min(priorityFeeWei, maxFeePerGasWei) を乗算して wei 合計を出す。
summary の包含数と CSV 行数が一致しない場合は取得不能。ログ欠測・空 JSONL をゼロとみなさない。

台帳は `ledger.jsonl` にロック付きで追記し、`ledger.md` を再生成する。
同名ラウンドの二重記録や途中で切れた既存行、既存ハッシュ連鎖の不整合は拒否する。
各行の `row_hash` は自身の row_hash を除く JSON（キー昇順、区切り `,` / `:`、ensure_ascii=True）の SHA256。
`prev_hash` は前行の row_hash（先頭は null）。これは内容・連鎖の整合性検査であり、
外部の信頼済み末尾ハッシュがなければ全履歴の再計算や末尾削除の証明はできない。
台帳と Markdown の resolve 後パスが同一なら書き込み前に拒否する。
Markdown 生成・一時保存は JSONL 追記前。追記後の Markdown 置換失敗は非 0 終了し、JSONL は保持する。
台帳には top_n / top_k / bootstrap seed / 共通シナリオ数も保存する。
`--ledger /path/to/ledger.jsonl` で出力先変更、`--name` で記録名変更。
コードハッシュは **記録時点** のディレクトリ内全ファイル（パスと内容）の SHA256。
記録後のコード変更で過去行は変えない。実走開始時の版を遡って証明するものではない。
`--agent-root` とロスターの `dir` を合わせ、実際に評価したコードの保全済みコピーを指定すること。

## 次世代を開始する前の計画確認

```bash
python3 ascon-notes/league/spawn-player.py astra-1 \
  --brief-file .codex-task/briefs-gen2/astra-1.md \
  --from-worktree ../league-astra-1 \
  --worktree ../league-gen2-astra-1 --dry-run
```

`--from-worktree` は同じ ID の `example/agents/<id>/` をコピーする。
既存エージェントへの上書きは拒否する。新世代は別の `--worktree` を使う。
コピーは全階層のドットファイル（`.env*` 含む）、node_modules、*.log を除外し、symlink は拒否する。
`--reuse` は git rev-parse 成功かつ当該リポジトリの worktree list に登録済みであることを、変更前に検証する。
コピー失敗時は作成した worktree の場所と手動削除コマンドを案内し、自動削除しない。
モデルが起動から 0.3 秒以内に終了すれば、終了コードが 0 でも起動失敗とする。
途中失敗の再開は従来どおり `--reuse`。コピー済みなら `--from-worktree` は外す。
指定した worktree 名はブランチ名とログ名にも使う。
brief は既存ファイルを上書きしない。新規枠は `--fresh ID:型` を繰り返せる。
上位の参照コードが別場所にある場合は `--agent-root` を指定する。
roster dir は相対パスのみ。`..`、root 外への symlink、agent ディレクトリ自体の symlink は拒否する。
brief に入れるレジーム名・新しい型は英数字、日本語、空白と `_/-` の許可文字に制限する。

## 進捗（読み取り専用）

```bash
bash ascon-notes/league/round-status.sh "$ROUND" --regimes 'calm crash' --seeds '101 102'
```

総数は実際に予定した全レジーム・seed を指定するか `--total` を使う。
実行中は `.matrix-tmp-*/*.row`、終了後は `index.tsv` を読む。
途中成果物だけで総数が不明なら取得不能とする。経過は成果物の時刻からの推定、
`--started-at UNIX秒` で正確な開始時刻を指定可能。ETA は完了処理率からの概算。
loopIterations は完了 run の summary から取得し、稼働中の loop 数は推測しない。
`--json` では全 run を出す。anvil 数はホスト全体、ディスク空きは out があるファイルシステム。
不正 run は採点と同じ summary / violations / failedReads / agents 判定で数える。
failed は不正 run + 壊れた .row、invalid_runs / malformed_rows / execution_failed は内訳。
空・短い・壊れた .row も完了成果物として数えるが、採点には使用しない。
run_dir は repo 内の相対パスのみ（絶対パス、`..`、symlink 脱出を拒否）。

## 最終候補の未使用 seed 確認

```bash
bash ascon-notes/league/confirm-candidate.sh --dir ascon-zeta \
  --env 'ASCON_DELTA_PARAMS={"bidMode":2,"bidProfitShareBps":3000,"gasPerSwap":140000}' \
  --label confirm-zeta-new --seeds '901 902 903' \
  --selection-index "$ROUND" --parallel 1 --base-port 8647 --dry-run
```

選抜に使用した **全ラウンド** を `--selection-index` で繰り返し指定する。
既使用 seed と重なれば拒否する。計画が正しければ運営が `--dry-run` を外して実行する。
既存 iso ロスターと同じ `cand` + noop/multi-arb/crowd/clean-arb の単独世界。
候補 env は `--env KEY=VALUE` を繰り返す。キーは ERIS_AGENT_FROZEN または ASCON_*_PARAMS のみ、
値は 8192 UTF-8 bytes 以下の有効な JSON に限定する（秘密情報は渡さない）。
既定の ledger.jsonl または `--selection-ledger PATH`（繰り返し可）の選抜 seed との重複も警告する。
使用 seed は正規化した文字列配列 seeds と regime/seed の scenarios として標準出力へ記録し、
`--seed-record PATH` で同じ JSON をファイルにも保存できる（dry-run は標準出力のみ）。
一時 roster は実行成功・失敗いずれでも削除し、seed 記録は実行失敗時も残す。
run-matrix 成功後に既存 `compare.py --ref multi-arb` を実行し、out 内の `compare.md` に出力する。
同じ出力ラベル・生成済みロスターへの上書きは拒否する。

## オフライン検証

```bash
npm run typecheck
node --import tsx --test test/ascon-league.test.ts test/ascon-league-harness.test.ts
```

新規テストは合成 summary/index/log、モデル・matrix 呼び出しのスタブのみ。
実バックテスト、anvil、モデルの実起動、実行中ラウンドでの status は未検証。
