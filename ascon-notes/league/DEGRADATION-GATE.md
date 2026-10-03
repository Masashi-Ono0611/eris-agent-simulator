# Offline degradation gate

```
python3 -B ascon-notes/league/degradation-gate.py \
  --baseline ascon-notes/eval/out/probe-p3 \
  --candidate ascon-notes/eval/out/probe-p5 ascon-notes/eval/out/probe-p6
bash ascon-notes/league/load-probe.sh --agents 12 --parallel 6 --base-port 8800 --dry-run
```

ラウンドの出力ディレクトリ、`index.tsv`、個別の `runs/<id>` を受け取る。
相対 `run_dir` はリポジトリルート基準。全入力を通じて run ID / 実パスの重複を拒否。
実行中の `.matrix-tmp-*` がある出力は BLOCKED。基準も候補も全 run の検査を通る必要がある。
終了コードは PASS=0 / FAIL=1 / BLOCKED=2。欠測と違反が同時にある場合は BLOCKED を優先し、違反も表示する。

既定は 360 blocks、**厳密に 362 loops**（実測: 正常な run は常に 360 blocks + 開始前の 2 パス = 362。league-r1・load-probe・分離スイートの全 run で確認）、block time 2 秒、環境 p99 < 1000 ms。
362 以外の loops（例 361・360・352）は既定では FAIL（355 などの負荷劣化も検出する）。実ログには開始前の `blocksCaughtUp=0` の pass があり、
360 blocks / 362 loops も実在する。`--expected-loops` で明示的に変更できるが、
loops と timing 行数の一致・epoch 内 block の連続被覆・他の全条件を満たす必要がある。
`--expected-loops` を `--blocks` 未満にはできない。

p99 は run ごとの nearest-rank。最大値だけを p99 と呼ばず、最悪の run も平均で隠さない。
catch-up は `blocksCaughtUp > 1` の run ごとの発生回数を、同 regime の基準 run 群の平均と比較する。
ポリシーには有意差検定の方式・閾値が無いため、暫定の保守的な許容増加 0 を使用する。
これは統計的有意差の検定ではない。`--max-catchup-increase` で許容回数を指定できる。
判断数低下・timeout 増加・送信失敗増加はそれぞれ既定 0、被覆低下は 1 percentage point 以下。
`--max-decision-drop` / `--max-timeout-increase` / `--max-submit-failure-increase` /
`--max-coverage-drop-pp` / `--max-p99-fraction` / `--block-time-sec` / `--blocks` で変更する。

`--baseline` が実際に 3 並列だったことは実験者が保証する（既存出力に並列度の記録なし）。
index 入力では regime ごとに比較し、基準にない regime は BLOCKED。
個別 run 入力は同じ条件の比較対象を渡すこと。個別 run をまとめた `direct` 群として扱う。
seed の違いによる変動はこのゲートでは補正しない。同じ roster / 同じ regime・seed の反復測定を推奨する。

## 実在の取得元と限界

- `core/src/realtime/coordinator.ts:3865-3887` → `events.jsonl` の `round_timing`:
  `blockNumber`, `blocksCaughtUp`, `keeperMs`, `oracleMs`, `stateFlowMs`, `totalMs`。
  protocol 別 `*Ms`、`boundaryMs`, `blocksMs`, `notifiedBlock` は条件付き。
- `coordinator.ts:4360-4388` → `summary.json`:
  `runId`, `blockTimeSec`, `blocksProcessed`, `loopIterations`, `runStartBlock`, `finalBlock`, `agents`。
- `events.jsonl` の `agents_registered`, `agents_ready` と agent log の `runtime_start` を照合し起動確認する。
- `example/agents/runtime/botMain.ts:599-640` と `send.ts:263-275` → `agents/<id>.jsonl`:
  `round` を持つ action / decide error / decide timeout、または `blockSeen` を持つ
  `mempool submitted / submit_failed` から観測判断ブロック数を得る。同一ブロックを重複計上しない。
  被覆の分母は `finalBlock - runStartBlock`、対象は `runStartBlock < block <= finalBlock`。
- **decide() 呼出総数は取得不能**。同じブロックに複数判断・複数送信があり、完全な呼出ログではない。
  観測判断ブロック数を代理指標として比較する。採掘遅延もこの実装では取得不能。
  出力でこれらを明記し、取得できる範囲の agent 指標で判定する。
- 必須 timing / summary / 起動記録 / agent log の欠測、壊れた JSONL、log cap / truncation、
  timing の block 欠落・重複は BLOCKED。JSONL 自体に連番・終了マーカーはないため、
  構文的に有効な agent log の任意の行欠落を完全に証明することはできない。

`round_status.py` は完了行に加え、その round の `.log` に出た runId の実行中 events も読む。
最大値は観測分であり、欠測数も併記する。書き込み途中の不完全な JSONL 行は欠測扱い。

プリフライトは output と `${TMPDIR:-/tmp}` の両 filesystem を `df -Pk` で確認し、
6.5 GiB × 並列度 + 20 GiB を要求する（既存 matrix と同じ GiB 換算で保守的）。
ポートは `base + parallel <= 65535`。`memory_pressure -Q` の free <10% は警告のみ、
`vm_stat` は compressor / swap の単一時点値を表示する。swap 増加の継続観測は未実装。
実行時は既存 matrix の `MIN_FREE_GB` に必要量を整数切り上げして渡し、バッチ前再確認にも適用する。
`--dry-run` は roster / 出力 / 一時ディレクトリを作らず、何も起動しない。
