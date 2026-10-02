# ASCON 評価行列

1. roster YAML を用意し、`caffeinate -i bash ascon-notes/eval/run-matrix.sh --label trial --roster roster.yaml --seeds "101 202"` を実行（`caffeinate` が無いと Mac のスリープで時計ベースのシミュレーションが壊れる）。
2. `--regimes "calm crash"` と `--parallel 3` は必要に応じて指定（10 コアでは 3 並列が目安。4 以上は処理遅延が結果に混ざる懸念）。
3. 集計は `python3 ascon-notes/eval/aggregate.py ascon-notes/eval/out/trial/index.tsv`。Markdown を保存する場合は `-o report.md`。

## 運用上の注意（実害由来）
- **ディスク**: anvil は 1 シナリオ（約 12 分）ごとに 4〜6.5GB の履歴を `~/.foundry/anvil/tmp/anvil-state-*` に書き、SIGTERM で止めても消えない。50 回で 460GB のディスクが埋まり、sweep が途中で止まった（2026-10-03）。`run-matrix.sh` は各ラウンドの前に空き `MIN_FREE_GB`（既定 40）を確認し、足りなければ `clean-anvil-tmp.py` で清掃、それでも足りなければ中止する（未実行のシナリオは失敗として記録）。ラウンド後・終了時にも清掃する。
- `clean-anvil-tmp.py` は「`anvil-state-*` かつ最終更新が 3 分以上前」のディレクトリだけを消す（生きている anvil は 2 秒ごとに書くので対象外）。`--dry-run` で確認できる。
- **run ID 衝突**: 並列の起動は 3 秒ずらす（同じミリ秒だと `runs/<id>` が衝突）。最後に重複 run_dir を検出して失敗扱いにする。
- バリアントを同じ世界に置くと互いに干渉する（同一コードのコピーは先着順で P が大きく変わる）。T は同じ matrix 内でしか比べられない。P・alpha も併記して読む。
