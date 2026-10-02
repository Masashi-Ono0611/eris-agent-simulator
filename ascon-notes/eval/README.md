# ASCON 評価行列

1. roster YAML を用意し、`ascon-notes/eval/run-matrix.sh --label trial --roster roster.yaml --seeds "101 202"` を実行。
2. `--regimes "calm crash"` と `--parallel 4` は必要に応じて指定。
3. 集計は `python3 ascon-notes/eval/aggregate.py ascon-notes/eval/out/trial/index.tsv`。
4. Markdown を保存する場合は `-o report.md` を指定。
