# Offline degradation gate

評価・選抜の入口は **G0**。`degradation-gate.py` の PASS は「負荷のみ」で、
予定シナリオ・ロスターの完全一致や提出許可を意味しない。

```bash
python3 -B ascon-notes/league/g0.py ascon-notes/eval/out/round-1/index.tsv \
  --roster ascon-notes/league/roster-round-1.yaml \
  --regimes 'calm cdp-incident launch' --seeds '201 202 203' \
  --baseline ascon-notes/eval/out/probe-p3 --manifest round-1 --json
```

G0 は予定の regime × seed とロスター全 ID の一致（欠け・余り・重複なし）、全員有限 P、
failedReads=0、violations=[]、360 blocks、362 loops、起動・完了・timing・agent ログ、
blocks.csv と包含数の一致を積集合で確認する。1 人でも P が欠測/NaN/Infinity なら
シナリオ全体を無効にし、残った人で μ/σ を再計算しない。timeout は絶対数 0。
予定値を省略して観測値から補完することはない。

終了コードは PASS=0 / FAIL=1 / BLOCKED=2。既知の不一致は FAIL、必要証跡の欠測・不正は BLOCKED。
両方あれば BLOCKED を優先し、JSON の failed / blocked と表で両方を表示する。
`--json` は標準出力に JSON だけを出す。既定は人間向けの表。

## 負荷の比較

```bash
python3 -B ascon-notes/league/degradation-gate.py \
  --baseline ascon-notes/eval/out/probe-p3 \
  --candidate ascon-notes/eval/out/probe-p5 ascon-notes/eval/out/probe-p6
```

G0 はこのスクリプトの `extract` / `compare` と `league_timing.py` のイベント読取を呼ぶ。
負荷ロジックを複製しない。単体ゲートでも failedReads / violations / 全員有限 P を拒否するが、
選抜に必要な全条件を検査するのは G0。基準が無ければ絶対検査だけを行い、JSON に明記する。

G0 の閾値は `g0_contract.py` に固定: 360 blocks、厳密に362 loops、block time 2秒、
nearest-rank の環境 p99 < 1000ms。R1 launch/201 は361 loopsだったため、
「R1 は全362」という旧記述は誤り。360 blocks 完走だけでは無劣化とはいえない。

基準を渡す場合、同 regime の基準平均から catch-up (`blocksCaughtUp>1`) 増加0、
timeout増加0、判断被覆低下≤1 percentage point。これは統計的有意差検定ではない。
判断ブロック数の差と送信失敗数の差は既定で情報表示のみ（単体ゲートでは引数で有効化可）。
基準も候補も検査し、同じ roster / regime / seed と並列3の事前固定対照を使う。
基準が実際に並列3だったことは開始時 manifest と運用記録で確認する。

## 証跡の意味と限界

- summary: blocksProcessed、loopIterations、runStartBlock / finalBlock、blockTimeSec、agents。
- events.jsonl: run_started_realtime / run_completed の runId、agents_registered / agents_ready の全員一致。
- round_timing: 行数=loops、epoch内ブロックの連続被覆、blocksCaughtUp、totalMs。
- agents/*.jsonl: runtime_start、ID一致、log cap/truncationなし、action / decide timeout / submitted等。
- blocks.csv: agent別 includedTxCount と一致する行数、有限の非負整数のgas/fee値。

判断回数は観測した distinct blocks。実際の decide() 呼出総数や採掘遅延は取得不能。
JSONL に連番・終了マーカーが無いため、構文的に有効な任意の行欠落を完全には証明できない。
G0 は現在の形式で検査できる完全性を保証し、暗号署名や過去コードの遡及証明はしない。

`load-probe.sh --dry-run` のプリフライトは output と TMPDIR の両方に
6.5 GiB × 並列度 + 20 GiB を要求し、ポート範囲を確認する。
メモリ圧力は単一時点の警告。実負荷校正・devnet・anvil はオフライン fixture 検査の対象外。
