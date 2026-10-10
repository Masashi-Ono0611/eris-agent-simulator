# 時間干渉の測定ハーネス

stockソースを変更せず、stock StrategyRunner + stock Workerをoffline guard付きで実行する。
chain / モデル / Sender は使わない。これはG3 evidenceではない。

高速な設定・出力保護・レポートのテストだけ（計測プロセス/Workerを起動しない）:

```sh
node --import tsx --test --test-concurrency=1 ascon-notes/league/g3/tests/timing-calibration.test.mjs ascon-notes/league/g3/tests/timing-options.test.mjs ascon-notes/league/g3/tests/timing-sweep.test.mjs ascon-notes/league/g3/tests/timing-unit.test.mjs
npm run typecheck
git diff --check
python3 ascon-notes/league/g3/loader/mutation-check.py --fast
```

以下は **Mac miniで後日実行する例。今回のAirでは未実行**。
`3.5` は明示的な緩和設定例で、検証済みの推奨閾値ではない。実行前に閾値と理由を固定する。
ユーザー提供の予定ホスト情報はIntel x86_64 / 12 logical CPUs / background services共用 / load1約2.6。
レポートには実行時に取得したOS・arch（Nodeではx64）・CPU model・論理CPU数を記録する。
ホスト名は取得せず、noteにもホスト名・秘密情報を書かない。

```sh
# 毎回新しいprefixを使う。json/mdのどちらかがあれば計測開始前に失敗する。
g3_run_id="mac-mini-intel-$(date -u +%Y%m%dT%H%M%SZ)"
g3_load_note='Mac mini Intel, 12 logical CPUs: shared background services; expected load1 about 2.6, so an explicitly relaxed guard is used'
g3_measurement="ascon-notes/league/g3/loader/TIMING-MEASUREMENT-${g3_run_id}"
g3_exploration="ascon-notes/league/g3/loader/TIMING-EXPLORATION-${g3_run_id}"
g3_controls="ascon-notes/league/g3/tests/TIMING-CONTROLS-${g3_run_id}"

# このホストの実バージョンを確認して期待値を明示する。例はNode v24.13.1 / tsx 4.23.13。
# node --version / node -p "require('tsx/package.json').version" で事前確認する。
g3_expected_node='v24.13.1'
g3_expected_tsx='4.23.13'

# 探索は独立した成果物。T=100ms、d=0..110ms、5ms刻み、各点4 process pairs × N=40 measured decides/arm、両probe・介入なし。
G3_PROBE_EXPECT_NODE="$g3_expected_node" G3_PROBE_EXPECT_TSX="$g3_expected_tsx" \
  node ascon-notes/league/g3/loader/measure-timing.mjs --explore \
  --output "$g3_exploration" --max-load1 3.5 --load-note "$g3_load_note"

# 対照実験: 2つの単体テスト + positive/negativeの実測テスト。逐次実行。
G3_PROBE_EXPECT_NODE="$g3_expected_node" G3_PROBE_EXPECT_TSX="$g3_expected_tsx" \
  G3_TIMING_CONTROL_OUTPUT="$g3_controls" G3_TIMING_SWEEP_FROM="$g3_exploration.json" \
  G3_TIMING_MAX_LOAD1=3.5 G3_TIMING_LOAD_NOTE="$g3_load_note" \
  node --import tsx --test ascon-notes/league/g3/tests/loader-timing.test.mjs

# 本測定: 240反復/arm、49点 × 20反復/arm、warmup 10/arm。
G3_PROBE_EXPECT_NODE="$g3_expected_node" G3_PROBE_EXPECT_TSX="$g3_expected_tsx" \
  node ascon-notes/league/g3/loader/measure-timing.mjs \
  --output "$g3_measurement" --sweep-from "$g3_exploration.json" --max-load1 3.5 --load-note "$g3_load_note"

# 新しい実行の整合性だけを検査。exit 0は実測完了/対照PASSを意味しない。
node ascon-notes/league/g3/loader/validate-timing-artifacts.mjs \
  --measurement "$g3_measurement" --controls "$g3_controls"
```

1分load平均の既定上限は **2.5（絶対値、CPU数で正規化しない）**。
CLIは `--max-load1 <number>` と `--load-note <text>` を受け付ける。
2.5以外に変更する場合、上げ下げどちらも空でないload-noteが必須。非正数・NaN・Infinityは拒否する。
対照テストは `G3_TIMING_MAX_LOAD1` と `G3_TIMING_LOAD_NOTE` に同じ規則を適用する。
CLIはこれらの環境変数を読まず、指定を省略すれば2.5のまま。
JSONの `config.maxLoad1` / `config.loadNote` に実際の設定を保存し、Markdownにもホストと変更理由を出す。
**緩和した閾値はidle-loadの主張を弱める。2.5の既定条件を満たした証拠にはならない。**

本測定は `--output`、実測を行う対照テストは `G3_TIMING_CONTROL_OUTPUT` に新しい出力prefixが必須。
最初の保存は `wx`（既存ファイルの上書き禁止）。起動前に同じJSON/Markdownへ `planned` と探索SHA・導出範囲を保存し、その実行が予約したファイルだけを完了・拒否・中断時に更新する。
旧Air成果物6件は [aborted, Air, load guard の索引](TIMING-AIR-ARCHIVE.md) にSHA-256付きで保存し、内容は変更しない。
Mac miniのレポートにAirの値を転記しない。validatorにも新しいprefixを明示し、旧Airファイルを既定入力にしない。
過去のvalidation JSON/Markdownを生成し直す処理はない。新しいvalidationログを保存する場合も新規名を使う。

測定開始前に超過していればexit 2、子プロセスは作らず、JSONとMarkdownに拒否理由とホスト情報を残す。
各pair前または終了後の超過は`aborted`、exit 1となり、不完全データを保存する。
`complete`かつ各点・各armのnが設定値を満たすことを確認する。
loadは完全なアイドルの証明ではなく、瞬間的な競合を排除する指標でもない。
実行中は他のテストやtypecheckを並走させない。
計測自身の負荷を抑えるため、pair終了後に1500ms休止する。A/Bの間には入れず、
呼出時間の計測区間には含めない。正対照・負対照も同じ休止を使う。

分布は各armの呼出時間と、近接したpairのB−A差。全pairをJSONに残す。
境界の指標は`step × Σ(timeout割合B − timeout割合A)`。正値が早いtimeout側。
50%境界へのfitはせず、サンプル間の独立性や母集団の等価性は仮定しない。
主実測と対照は探索JSONのTを使用し、c±12ms、0.5ms刻み。既定の実5秒境界は未検証。

この版ではhash/readFileはmethod wrapperやspawnで行い、受信listenerは計算済みfieldsを
同期writeする。deadline設置後のworker_post記録とstock判定前の受信記録は期限を消費し得る。

`timing-delay.mjs`は測定専用の人工遅延。親のresult listenerをstock判定より先に
登録し、指定時間busy-waitする。main threadだけに作用し、両armに同じpreloadを
入れる（0msならpatchなし）。本測定は両armとも0ms。
対照実験は両armともproduction probeを使い、positiveのBだけ6msを設定する。
人工遅延のためにprobe-loader.mjsやStrategyRunnerのソースは変更しない。

対照実験の受入閾値は実行前固定:

- positive: 探索と同じT、c±12ms、0.5ms刻み、各点16反復。積分差3〜9ms、c−4msで
  B−Aのtimeout割合が0.5以上、boundaryのdelay listener発火数が16以上（warmupは除外）。
- negative: 同じsweepで両armの設定を同一にする。積分差の絶対値2ms以下。
- 両実験とも両端が境界を挟む（低端timeout割合≤0.125、高端≥0.875）。
- 両実験とも全点でAB/BAが半数ずつ。失敗や負荷超過を成功扱いせず、再試行して
  良いrunだけを自動採択する機能はない。

既存のprobe監査はtimeout時の終端欠落をG3_TERMINAL_GAPとする。
測定はその結果も保存し、全世代・全呼出の構造を独立に検査する。正常結果の終端欠落、
別の監査失敗、意図しない例外は中断する。生JSONLは検査後に削除するので、保存JSONは
完全なprobe監査ログの代用ではない。

生成レポートの数値はすべてその実行の保存JSONから計算する。新形式は `renderReport` /
`renderRefusal` / `renderControlReport` で再生成できる。旧Air Markdownは歴史的成果物として保持し、
新しいrendererで再生成しない。既存ファイルの上書きはしない。

適用範囲は単一ホスト・指定負荷閾値内・小さいfixture・StrategyRunnerレベルだけ。
botMain / 実戦略 / 大量log・submit / chain / モデル / backtest / liveの結果ではない。

測定専用の明示的toolchain override:

- 未指定の既定値はNode `v24.13.0` / tsx `4.23.13`。異なる実バージョンは `G3_TOOLCHAIN_MISMATCH` で拒否する。
- `G3_PROBE_EXPECT_NODE` / `G3_PROBE_EXPECT_TSX` はそれぞれ指定した期待値だけを置き換える。
  完全一致が必須で、空文字や誤った期待値も拒否する。通常のprobe検証では指定しない。
- 測定ハーネスはこの2変数を子プロセスへ明示的に渡す。probe先頭の `probe_registered` に
  実Node/tsxと `toolchainOverride` を記録する。JSONの `hostBefore` / `hostAfter` に実バージョン、
  arch、期待値、overrideフラグ、注意書きを保存し、起動済みの各armの実バージョンを `armToolchains` に保存する。
- override使用時のJSON/Markdownには `toolchain differs from the pinned reference; results are for this toolchain only`
  を記載する。overrideをpinと同じ値に設定しても、明示指定の事実としてフラグはtrueになる。
- `G3_TIMING_MAX_LOAD1` 変更時のnote不足は、エラー中で `G3_TIMING_LOAD_NOTE` を名指しする。

上記の別toolchainでの実測・時間干渉対照実験は今回未実行。高速テストの別Node条件は
子プロセスの `process.version` を合成したguard検証であり、別Nodeバイナリでの実行証拠ではない。

## 探索から確認範囲を固定する新プロトコル（実測未検証）

`--explore` は探索専用JSONに `mode: exploration` / `summary.exploration` の点別n・timeout数・割合を保存する。
探索の `boundary` は空、`boundaryShiftMs` はnull。探索にcontrol verdictは付けず、確認の集計はboundary phaseだけを使用する。
確認には `--sweep-from <exploration.json>` または `G3_TIMING_SWEEP_FROM` が必須。CLI指定が環境変数に優先する。
両controlsのCLI指定は、Nodeのtest runner引数との混同を避け、直接
`node --import tsx ascon-notes/league/g3/tests/loader-timing.test.mjs --sweep-from <exploration.json>`
とする（出力prefix/load設定は上記と同じ環境変数）。`node --test` 使用時は環境変数を使う。

純粋関数 `selectSweep` は完了済み・両probe・介入なしの探索だけを受け付ける。
Aのtimeout割合が0.5未満の点と0.5超の点の両方を必須とし、d昇順で最初の上向きcrossingを選ぶ。
隣接点 `(d0,p0)` / `(d1,p1)` から `c=d0+(0.5-p0)*(d1-d0)/(p1-p0)`。
単調化や平滑化はしない。p1=0.5ならそのd1を選ぶ。全成功・全timeout・逆向きだけの探索は拒否する。
sweep半幅=12ms、step=0.5ms、sensitive=c−4msは固定で、49点格子にsensitiveを含む。
範囲の両端が探索の観測d範囲に含まれ、両armで端点の線形補間割合が低端≤0.125、高端≥0.875であることが必要。
外挿・範囲のクリップ・失敗後の自動拡張はしない。拒否時は実験を起動しない。
少数探索サンプルでの補間は実機でのbracketing保証ではないため、確認のendpoint guardも同じ閾値で残す。

探索ファイルのバイト列SHA-256、絶対パス、c、sweep半幅、step、格子、sensitive、探索端点割合、閾値を
`config.sweepSelection` とMarkdownに起動前から保存する。探索ファイルを読み直して確認結果を更新しない。
各controlは自身の起動前に保存する。両controls間で入力ファイルを変更しないこと。
`raw[*].A/B.delayHits` は各command前後の差。`delayHitsByPhase` とarm diagnosticsに
warmup / overhead / exploration / boundary別合計を保存する。完了時には合計とfinishカウンタを照合する。
途中で失われたcommandは保存済みrawのphase合計には含まれない。
`controlAssertions` / `controlFailures` は名前、pass/fail、実値・期待値を保存し、assertで停止する前に永続化する。

この変更は旧T−4ms条件をc−4msへ変更する新プロトコル。旧failed成果物を再判定しない。
実測・controls・Mac miniでの検出能力は未検証。合成データのテストは範囲選択と判定ロジックの検証だけ。

## Warm-worker protocol and exploration quality gate

Implemented execution unit (schema 3), shared by exploration, both controls and main measurement: `warmupDecides` W=5 and `measuredDecides`
N=40 per arm process. A raw process pair holds `A.decides` / `B.decides`; each
measured record contains `timedOut`, `wallMs`, and `fixtureElapsedMs` (null on
timeout). Warm-up records are excluded from these arrays and all fractions,
quantiles, fixed-cost estimates, and control thresholds. `boundaryRepetitions`
counts process pairs; per-point `n` counts measured decisions per arm, so the
planned denominator is `boundaryRepetitions * measuredDecides`. AB/BA balancing
counts processes, not decisions. Decisions within a process are correlated.

Each exploration point reports `A/B.decideWallMs` (including median and p95).
`summary.fixedCostEstimateMs.A/B` is the median measured decide wall time at d=0;
no cold-start cost is inferred from it. Wall times on actual stock timeouts include
worker termination, so these are not uncensored worker execution times.

`summary.explorationQuality` reports a transition range and width for each arm.
For adjacent observed points, linearly interpolate the timeout fraction and take
the envelope of **all** segments in the inclusive band [0.1, 0.9]. Later noisy
returns count toward the width; no monotonic smoothing is applied. A sampled
0-to-1 jump has width 0.8 times its grid spacing, rather than zero. An arm with no
observed transition has null width; existing coverage and endpoint guards remain
necessary. The declared `maxTransitionWidthMs` limit is 10ms (a stricter positive
limit is allowed; loosening above 10ms is rejected).

Completed exploration with excessive width is saved as `status: rejected` with
`TIMING_EXPLORATION_TOO_BLURRED` and exits nonzero. `selectSweep` recomputes quality from point counts instead of trusting a saved
quality label. Either arm exceeding the limit causes rejection with
`too blurred to detect a 3 ms shift` before any confirmation process can launch.
This is an exploration suitability gate, not a control PASS/FAIL verdict. The
existing c±12ms range, c−4ms sensitive point, 0.5ms confirmation step, positive
3–9ms contrast, negative absolute 2ms tolerance, and endpoint thresholds are
unchanged. Exploration observations never contribute to confirmation fractions.

The fixture `../tests/fixtures/mini-cold-exploration.json` is an extraction of the
user-provided Mac mini exploration's actual point counts and arm settings, with
source SHA-256. It is used only for a rejection test, not as new warm-worker
measurement evidence. Its later noisy returns extend the width beyond the
approximately 40ms central transition described in the initial hypothesis.

Stock behavior confirmed by source inspection: stock `StrategyRunner.decide`
awaits `start()` before arming its deadline and destroys the worker on every thrown
timeout. Repeated stock timeouts cannot occur on one unchanged worker. Re-warming
replacement workers preserves stock timeout semantics; classifying wall times on
a retained worker would be a different measurement. The accepted policy is to keep **one stock StrategyRunner per arm process**,
reusing its worker until stock destroys it on timeout. Timeout classification
remains exclusively `instanceof DecideTimeoutError`; long successful wall time
is never reclassified. Neither the stock runner nor its deadline/backoff code is
changed.

Each process executes one unit only, at one d and one timeout setting. It calls
setSource once, start twice (cold/ready timing), then W initial discarded d=0
decides, then N measured decides. W=5 and N=40 are persisted in config before
launch (`warmupDecides` / `measuredDecides`); imported runs may explicitly override
them with positive integers. Existing `warmupPairs` are separate discarded process
pairs and never contribute to point fractions. Arm processes run sequentially;
AB/BA is balanced per point and process repetition, with the seeded point shuffle
unchanged. The load gate runs before each pair and each arm process.

After a measured timeout, **before the next measured decide**, increment
`rewarmCount` and execute exactly W discarded d=0 warmups with the same runner and
the same timeout. The first of these calls lets stock start the replacement worker;
its cold startup and decide are discarded. Only after all W return successfully
can a new measured decide run. A timeout on the final measured decide needs no
replacement, so it does not increment rewarmCount. A timeout during initial or
replacement warmup aborts the unit as `TIMING_WARMUP_TIMEOUT`, preserves its partial
counts/records, and closes the runner. It never silently measures a cold worker or
counts a stock backoff noop. Rounds increase monotonically for all calls; successful
warmup resets stock consecutive-failure state without altering stock semantics.

Each raw arm unit records `rewarmCount`, `discardedDecideCount`,
`measuredDecideCount`, `warmup` (initial/rewarm phase, round, timeout flag, wall time,
delay hits), and measured-only `decides` (round, timeout flag, wall time,
fixture elapsed time, delay hits). Complete units have discarded count
`W * (1 + rewarmCount)` and measured count N. `durations` contains one setSource,
cold start, ready start and close per process; decide distributions use every
measured record. A point fraction is strictly timeout count / measured decide
count, never timeout count / process count. Wall times include stock worker
termination on a measured timeout. Re-warm/startup wall times are excluded.

`summary.rewarm` and each point's `rewarm` carry A/B counts. All three report paths
print these counts and warn when the absolute difference is >=2 **and**
`abs(B-A)/max(A,B,1) >=0.10`. This predeclared descriptive warning can reveal bias
in the fractions; it does not change any control threshold. Both aggregate and
point checks are needed because opposite point imbalances can cancel in aggregate.
Counts in the summary cover completed pairs; partial/failed pairs and their
available per-process records are retained separately in `failedUnits` and printed
in the report, never represented as a completed measurement.

Delay hits from initial/re-warm discarded calls go to the `warmup` phase; only
measured delay hits contribute to `boundary`/`exploration`/`overhead`. Per-process
probe inspection checks one runner, all decides and matching starts, variable
numbers of posts per worker generation, replacement generations, timeout counts
and clean termination. The existing auditor's `G3_TERMINAL_GAP` classification
remains unchanged for missing terminal messages on stock timeouts.

`mutation-check.py --fast` runs only the synthetic sweep/unit/calibration mutation groups,
including the mutant that counts the first post-timeout decide as measured. It
explicitly skips the four existing probe-loader mutants whose fixtures launch
real Workers. The default command retains those original groups for separately
authorized runs; it must not be used under a synthetic-only restriction.

Optional one-process smoke (not a measurement/control run):

```sh
node ascon-notes/league/g3/loader/smoke-timing-unit.mjs
```

This script runs `uptime` immediately before launch and skips unless load1 <4.
It permits exactly one probe arm process, W=5, N=3, d=0, T=100ms, with a declared
loose max-load1=8 and a smoke-only note. It audits that process and removes its
temporary probe log. No timeout is forced, so a passing smoke cannot validate
real timeout/replacement behavior or timing sensitivity.

On 2026-10-09 this one smoke was run: uptime load1=1.54, exit 0, discarded=5,
measured=3, rewarm=0, measured timeout flags=[false,false,false], one generation,
63 probe records, original audit passed. Measured wall times were
0.19262499999996407 / 0.19195799999999963 / 0.171875 ms. These three observations
are a protocol smoke only. Exploration, controls, full measurement and a real
post-timeout replacement run were **not run** for this change.

## Dwell accuracy correction (2026-10-09; real runs pending)

User-supplied direct measurements confirmed that `Atomics.wait` is unreliable
for measured durations on the Mac mini (x86_64, Node v24.13.1): requested 10/25ms
produced median **85.8/171.3ms**, versus **10.01/25.01ms** with a
`performance.now()` busy-spin. The Air (arm64) returned about 12.5ms for a 10ms
Atomics wait. These are the user's measurements, not a measurement made during
this patch. See the dated addendum in [the diagnosis](TIMING-DIAGNOSIS-2-2026-10-09.md).
The old sleep-plus-final-spin fixture could not undo a sleep overshoot.

`timing-wait.mjs` now supplies the shared full-duration spin primitive used by
both `timing-fixture.mjs` dwell and `timing-delay.mjs` injected receive delay.
It intentionally burns one core to avoid timer coalescing. The receive listener
was already spinning; it now shares the calibrated implementation. OS preemption
can still overshoot a spin. The added CPU load is intentional, and load gates
remain unchanged; prior sleep-based artifacts are historical and are not revised
or evidence for this implementation.

Wait inventory for this timing path:

- Measured fixture dwell: former `Atomics.wait(d-2)` plus tail loop replaced with full spin.
- Injected result receive delay: shared full spin before the stock deadline check.
- Pair cooldown: `setTimeout` stays between complete pairs, outside all measured intervals.
- Child watchdog: `setTimeout` stays as a deadline, not a requested measured dwell.
- `noop-fixture.mjs` selection-race timer belongs to the separate loader guard
  fixtures, not the timing path. Chain timeout controls and fake-model delays are
  separate harnesses; none supply timing experiment dwell or injected receive delay.
- Stock runner deadline/backoff behavior is unchanged. No cooldown inside the
  timing experiment's measured intervals was found.

Every exploration, positive control, negative control and measurement invokes
startup calibration in the common `runExperiment` path, after the initial load
gate and before any arm process or measured interval. Each primitive is measured
separately at **5, 10, 25ms, 20 samples each**. The fixed absolute median-error
limit is **1ms**; there is no CLI/environment override. A load-refused run records
`calibration.status: not-run`, without launching calibration or a worker.

The run JSON contains `calibration` with profile, clock, execution context and
`primitives.dwell` / `primitives.injectedReceiveDelay`. Each length records
`requestedMs`, `n`, all `achievedMs`, `medianAchievedMs`, `p95AchievedMs`,
`medianErrorMs` (absolute median minus request), `maxErrorMs` (maximum absolute
sample error), and `passed`. Quantiles use linear interpolation at `(n-1)*p`.
Both sets of samples are persisted before checking the gate. Any median error
above 1ms aborts with **TIMING_DWELL_INACCURATE** or **TIMING_DELAY_INACCURATE**,
and zero measured pairs; the normal caller saves the aborted result and exits
nonzero. Every report path prints the calibration table (or explicitly says it
was not run/not recorded). Both new source modules are included in source hashes.

Calibration runs in the coordinator's thread on the same host/runtime using the
exact shared functions. It does not establish per-Worker scheduling accuracy,
guarantee future samples, or measure IPC, and its durations never enter the
experimental summary. p95 and max error are reported, not extra acceptance gates.

Fast tests use a short live spin calibration, a deliberately oversleeping
`setTimeout` positive control, and deterministic injected clocks/waits. Synthetic
startup tests cover exploration, measurement and both control configurations,
persist JSON/Markdown, and replace arm launch with a throwing tripwire (no real
Worker or measurement). They assert both named aborts and the exact 1ms boundary.
Two new `--fast` mutants remove the abort and bypass the startup gate; each must
be killed. Real exploration, controls, measurement and Mac mini validation of the
new primitive remain unverified. The earlier smoke above predates this correction.
