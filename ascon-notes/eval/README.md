# ASCON 評価行列

1. roster YAML を用意し、`caffeinate -i bash ascon-notes/eval/run-matrix.sh --label trial --roster roster.yaml --seeds "101 202"` を実行（`caffeinate` が無いと Mac のスリープで時計ベースのシミュレーションが壊れる）。
2. `--regimes "calm crash"` と `--parallel 3` は必要に応じて指定（10 コアでは 3 並列が目安。4 以上は処理遅延が結果に混ざる懸念）。
3. 集計は `python3 ascon-notes/eval/aggregate.py ascon-notes/eval/out/trial/index.tsv`。Markdown を保存する場合は `-o report.md`。
比較時は `compare.py` が `loopIterations < 360` のシナリオを全候補共通で除外し、冒頭に一覧を表示する。
閾値は `--min-loop-iterations N` で変更でき、`0` で負荷ガードを無効にする。
`summary.json` に `loopIterations` がないシナリオは除外せず、件数を警告する。

## 運用上の注意（実害由来）
- **ディスク**: anvil は 1 シナリオ（約 12 分）ごとに数 GB〜十数 GB の履歴を `$HOME/.foundry/anvil/tmp/anvil-state-*` に書き、SIGTERM で止めても消えない。50 回で 460GB のディスクが埋まり、sweep が途中で止まった（2026-10-03）。`FOUNDRY_DIR` は anvil に無視される（実測）が `HOME` は効くので、`run-matrix.sh` は `anvil-shim/anvil`（PATH の先頭に置くラッパー）経由で、**シナリオごとの専用 HOME**（`$TMPDIR/ascon-anvil-homes.*/<regime>-<seed>`）で anvil を動かし、anvil の終了を確認してから、そのディレクトリごと削除する。所有が自明なので、他プロジェクトの anvil や、並列に動かした別の `run-matrix.sh` を巻き込まない。起動前に空き `MIN_FREE_GB`（既定 40・履歴の書き込み先で測定・測定不能なら中止）を確認し、足りなければ何も起動せず中止する（未実行のシナリオは失敗として記録）。別の matrix を同時に動かすときは `--base-port` を変える。
- `clean-anvil-tmp.py` は、**旧方式で漏れた履歴の手動清掃用**。`--snapshot` で起動前のディレクトリ一覧を取り、そこに無い `anvil-state-*` だけを消す。anvil が 1 本でも動いていれば何もしない（「更新が止まっている」は「死んでいる」の証明にならず、lsof でも anvil は履歴を開いていないため）。`--dry-run` で確認できる。
- **run ID 衝突**: 並列の起動は 3 秒ずらす（同じミリ秒だと `runs/<id>` が衝突）。最後に重複 run_dir を検出して失敗扱いにする。
- バリアントを同じ世界に置くと互いに干渉する（同一コードのコピーは先着順で P が大きく変わる）。T は同じ matrix 内でしか比べられない。P・alpha も併記して読む。
