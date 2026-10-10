# Mac mini の loader 時間計測結果

この補助研究では、合成の小さな試験用戦略について、観測器を加えたときの判断コストと、期限付近の timeout（時間切れ）割合を測った。判断ごとの追加コストは観測され、標本点の面積差は小さかった。ただし、観測区間が狭くても、事前設計の最小検出効果（保守的な仮定では宣言済み許容範囲より大きく、楽観的な仮定では小さい）より小さい移動を、この設計は確実には認証できない。**G3（Gate 3、自己改訂の実チェーン受入れ）の証拠にはしない。G3 は REQUIRED（必須）／BLOCKED（証拠不足で停止）のまま。**

## 実行と資料の範囲

実行は Intel Mac mini。機種名は依頼者の引継ぎと保存された `loadNote`、命令系統・中央演算装置・実行環境は下表の `hostBefore` に基づく。Node の `x64` は同表の注記にある命令系統を表す。`toolchainOverride` は固定参照版と異なる実行環境を明示して使った印であり、参照環境の測定結果ではない。`tsx` は TypeScript の実行ツールである。

[事前宣言プロトコル](TIMING-REDUCED-PROTOCOL-2026-10-10.md) と [統計・推論コード](timing-reduced.mjs) を規則として読んだ。プロトコルのコミット時刻が採用した縮小実験の開始より前であることをローカル履歴で確認した。探索を固定し、正対照、負対照、標準実装と観測器ありの主測定を順に実行した記録である。今回、この計測を再実行してはいない。

JSON（JavaScript Object Notation、構造化データ形式）内の実開始・終了日時を採用する。成果物名の日付は実行日ではない。日本標準時では主測定の終了が翌日になる。負荷上限は失敗を見た後に引き上げられており、静かなホストでの実験とは扱わない。`loadNote` の「対照が雑音を検証する」という説明も実行者の説明として残すだけで、雑音が排除されたとの結論にはしない。

過去の失敗と停止は次のように区別する。以下のログ参照はすべて外部の読み取り専用証拠を指す。

| 試行 | 確認できたこと・確認できないこと | 根拠 |
| --- | --- | --- |
| Air の試行 | 負荷ガードで測定・正対照が中断、負対照は開始前拒否という保存履歴。完了した mini の値と混ぜない。独立した実行ログは今回の外部証拠にはない | [Air 索引](TIMING-AIR-ARCHIVE.md)、[保存 measurement JSON](TIMING-MEASUREMENT-2026-10-09.json)、[保存 controls JSON](../tests/TIMING-CONTROLS-2026-10-09.json) |
| mini の負荷拒否と中断 | 開始前の拒否と、進行後の負荷超過による中断が別にある。閾値と実負荷は生成表に記載 | [拒否ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-1791540666/explore.log)、[中断ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-1791606583/explore.log) |
| Spotlight の索引処理 | 負荷要因として依頼で挙げられた経緯。ただし保存ログに Spotlight の稼働・停止や因果を示す記録は見つからず、原因としては未検証。ガード拒否だけから原因を確定しない | 上記負荷ログ、[既存調査の未確認事項](../../G3-SUCCESS-PLAN-2026-10-09.md) |
| 旧待機方式の飽和した範囲 | 成功側の端点を確保できず対照が失敗し、測定範囲が飽和して情報を得られないとして手動停止。mini の `Atomics.wait` の実待機が指定を大幅に超えるという既存診断と整合するが、元の待機専用測定の生ログは今回の資料にない。特定の実行エンジンや基本ソフトの不具合と断定しない | [対照ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-confirm-1791608109/controls.log)、[手動停止ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-confirm-1791608109/run.log)、[待機方式の診断](TIMING-DIAGNOSIS-2-2026-10-09.md) |
| 旧探索 | 最初の探索には complete の保存結果があるが、その後の探索は遷移が広すぎるとして rejected。採用した探索のハッシュと区別する | [旧探索ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-explore1/explore.log)、[棄却ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-explore2/explore.log) |
| spin 修正後の旧全設計と停止した確認実験 | 正対照が生成表に示すテスト時間上限を超過。負対照と主測定にも長時間を要すると判断して確認実験を手動停止した記録。保存 controls JSON の running は完了を意味しない。主測定ログにも途中経過はあるが、完了結果がないので採用しない。ディレクトリ名に reduced とあっても、採用した縮小実験ではない | [時間超過ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-reduced-1791640493/controls.log)、[確認実験の停止理由](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-reduced-1791640493/confirm-run.log)、[途中の主測定ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/superseded-reduced-1791640493/measure.log) |
| 今回採用した探索・縮小実験 | 探索の終了、対照と主測定の正常終了を実行ログと最終 JSON で確認 | [探索ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/explore-run.log)、[全体ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/reduced-run.log)、[対照ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/controls.log)、[主測定ログ](/Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11/raw/measure.log) |

## 数値の再現

リポジトリ直下で次を実行する。標準ライブラリだけを使い、証拠とリポジトリ内の保存 Air JSON・ソースを読み、標準出力に表を出す。ファイル書込み、プロセス起動、外部接続、計測は行わない。

```sh
python3 ascon-notes/league/g3/loader/results-extract.py /Users/masashi_mac_ssd/Developer/ascon-evidence-timing-2026-10-11
```

以下はこのコマンドの出力をそのまま貼ったもの。測定値・設計値は JSON 由来。過去のテスト時間上限だけは JSON にないため、スクリプトが明記したログから抽出する。日付を含む資料名、ゲート・要件の識別子は計測数値ではない。ハッシュ一覧が対象とするファイルの一致と、記録されたソースの一致は別に表示する。過去の全アーカイブがハッシュ一覧に含まれるとは主張しない。

<!-- BEGIN results-extract.py stdout -->
### 抽出元と照合

| 入力 | 相対パス / 照合結果 |
| --- | --- |
| 探索 | ascon-notes/league/g3/loader/TIMING-EXPLORE-MINI-2026-10-09.json |
| 対照 | ascon-notes/league/g3/tests/TIMING-CONTROLS-MINI-2026-10-09.json |
| 主測定 | ascon-notes/league/g3/loader/TIMING-MEASUREMENT-MINI-2026-10-09.json |
| 探索 SHA-256（Secure Hash Algorithm、内容照合用） | d3ae6e897a4253d2d7237b11414cda3e671ffe273e1dedbff21d7af6b2b1730d |
| SHA256SUMS.txt の一致ファイル数 | 19 |

| 記録 | 現行ソースと一致 | 記録されたソース数 |
| --- | --- | --- |
| positive | 19 | 19 |
| negative | 19 | 19 |
| main | 19 | 19 |

統計値は JSON から抽出。timeout 件数・不一致・面積・再準備回数・最大負荷・overhead 中央値と百分位を raw と照合。区間と判定は保存値であり、再計測・再標本化はしていない。

### 実行条件と日時

| 項目 | 値 |
| --- | --- |
| arch | x64 |
| cpuModel | Intel(R) Core(TM) i7-8700B CPU @ 3.20GHz |
| logicalCpus | 12 |
| platform | darwin |
| release | 24.6.0 |
| node | v24.13.1 |
| tsx | 4.23.13 |
| toolchainOverride | true |
| toolchainNote | toolchain differs from the pinned reference; results are for this toolchain only |
| loadNote（実行者の説明、因果の実証ではない） | Mac mini (x86_64, 12 CPUs) shared with background services; baseline load1 about 2.7. Threshold set to 2/3 of the logical CPUs (8) after earlier attempts were refused/aborted (3.5, then 5.0, now 8): the busy-spin measurement itself adds about 2-3 to the load average. Thresholds were changed after seeing failures and are disclosed; the controls, not the load number, validate noise. Weakens the idle-load claim. |
| timeout（ミリ秒） | 100 |
| c（探索で選んだ中心、ミリ秒） | 97.5 |
| 中心からの測定点（ミリ秒） | [-12, -8, -6, -4, 0, 4, 12] |
| 初期・再準備の判断回数 / 各プロセスの測定判断回数 | 5 / 4 |
| 対照 / 主測定の各点プロセス対数 | 24 / 64 |
| 対ごとの休止（ミリ秒） | 1500 |

| 実行 | 状態 | 開始 UTC（協定世界時） | 終了 UTC | 終了 JST（日本標準時） | 記録された対数 | 負荷上限 | 最大観測負荷 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| exploration | complete | 2026-10-10T04:29:43.420Z | 2026-10-10T04:52:36.162Z | 2026-10-10T13:52:36.162000+09:00 | 94 | 8 | 6.0615234375 |
| positive | complete | 2026-10-10T13:54:53.865Z | 2026-10-10T14:11:21.300Z | 2026-10-10T23:11:21.300000+09:00 | 170 | 8 | 4.7646484375 |
| negative | complete | 2026-10-10T14:11:21.478Z | 2026-10-10T14:26:14.960Z | 2026-10-10T23:26:14.960000+09:00 | 170 | 8 | 4.39794921875 |
| main | complete | 2026-10-10T14:26:15.288Z | 2026-10-10T15:06:50.239Z | 2026-10-11T00:06:50.239000+09:00 | 474 | 8 | 4.51611328125 |

| 実行 | 予算に計上した経過（分） | 予算（分） | 残り（分） | 完了対 / 予定対 |
| --- | --- | --- | --- | --- |
| positive | 16.457793 | 30 | 13.542207 | 170 / 170 |
| negative | 14.893177 | 30 | 15.106823 | 170 / 170 |
| main | 40.583223 | 90 | 49.416777 | 474 / 474 |

### 失敗履歴の数値（本測定へ混ぜない）

負荷閾値の履歴: 2.5 → 3.5 → 5.0 → 8。既定値は保存 Air JSON、以後は main.config.loadNote の記載。失敗を見た後の変更である。

| 保存元 | 状態 | 記録された対数 | 負荷上限 | failure |
| --- | --- | --- | --- | --- |
| リポジトリ内 Air measurement JSON | aborted | 23 | 2.5 | {"code": "TIMING_LOAD_REFUSED", "load1": 2.71435546875, "threshold": 2.5} |
| superseded-1791540666/TIMING-EXPLORE-MINI-2026-10-09.json | refused | 0 | 5 | {"code": "TIMING_LOAD_REFUSED", "load1": 5.10009765625, "threshold": 5} |
| superseded-1791606583/TIMING-EXPLORE-MINI-2026-10-09.json | aborted | 88 | 5 | {"code": "TIMING_LOAD_REFUSED", "name": "Error", "message": "TIMING_LOAD_REFUSED", "load1": 5.61572265625, "threshold": 5} |
| superseded-explore1/TIMING-EXPLORE-MINI-2026-10-09.json | complete | 94 | 5 | null |
| superseded-explore2/TIMING-EXPLORE-MINI-2026-10-09.json | rejected | 94 | 5 | {"code": "TIMING_EXPLORATION_TOO_BLURRED", "message": "too blurred to detect a 3 ms shift"} |

旧全設計のテスト上限: 60 分。この履歴値だけは JSON ではなく superseded-reduced-1791640493/controls.log から抽出。

### 対照の保存判定

| 対照 | B 注入（ミリ秒） | 符号付き面積（ミリ秒） | 区間（ミリ秒） | controlVerdict | controlCriteriaPassed | controlAssessment | controlFailures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| positive | 6 | 5.96875 | [5.78125, 6.15625] | descriptive only | true | criteria met | [] |
| negative | 0 | 0 | [0, 0] DEGENERATE | descriptive only | true | criteria met | [] |

| 対照 | 感度点（ミリ秒） | B−A timeout 割合差 | 点別区間 | 保存 assertion 全件成立 |
| --- | --- | --- | --- | --- |
| positive | 93.5 | 0.65625 | [0.41385352165005396, 0.8124277437107341] | true |
| negative | 93.5 | 0 | [-0.13797620467498017, 0.13797620467498017] | true |

正対照の回収値は約 5.97 ミリ秒。

### 主測定の面積と判断コスト

| 項目 | 値 |
| --- | --- |
| 符号付き面積（ミリ秒） | 0.015625 |
| 表示用丸め（ミリ秒） | 0.0156 |
| bootstrap 区間（ミリ秒） | [0, 0.046875] |
| 信頼水準 | 0.95 |
| 再標本化回数 / seed（乱数の初期値） | 4000 / 20261010 |
| 再標本化方法（保存原文） | percentile; whole A/B process-pair blocks; stratified by point and AB/BA |

d = 0 ミリ秒の decide（判断）の測定プロセス対数: 24。

| 待機を加えない decide | 中央値（ミリ秒） | 第九十五百分位（ミリ秒） | 判断標本数 |
| --- | --- | --- | --- |
| A | 0.1572894999999903 | 0.22599450000001298 | 96 |
| B | 0.8870769999999766 | 1.0372057499999983 | 96 |
| pairedDelta | 0.7253435000000081 | 0.8344090000000222 | 96 |

A は stock（標準実装）、B は probe（観測器）あり。pairedDelta は対にした B−A。判断標本は同一プロセス内でも測られており、すべてが独立な標本ではない。

| d（待機ミリ秒） | プロセス対数 | 各 arm 判断数 | A timeout 件数 / 割合 | B timeout 件数 / 割合 | A のみ / B のみ timeout | 割合差 B−A | 点別区間 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 85.5 | 64 | 256 | 0 / 0 | 0 / 0 | 0 / 0 | 0 | [-0.05662405979280534, 0.05662405979280534] |
| 89.5 | 64 | 256 | 0 / 0 | 0 / 0 | 0 / 0 | 0 | [-0.05662405979280534, 0.05662405979280534] |
| 91.5 | 64 | 256 | 0 / 0 | 0 / 0 | 0 / 0 | 0 | [-0.05662405979280534, 0.05662405979280534] |
| 93.5 | 64 | 256 | 0 / 0 | 0 / 0 | 0 / 0 | 0 | [-0.05662405979280534, 0.05662405979280534] |
| 97.5 | 64 | 256 | 0 / 0 | 1 / 0.00390625 | 0 / 1 | 0.00390625 | [-0.052837298863909525, 0.06376844926949564] |
| 101.5 | 64 | 256 | 256 / 1 | 256 / 1 | 0 / 0 | 0 | [-0.05662405979280538, 0.05662405979280538] |
| 109.5 | 64 | 256 | 256 / 1 | 256 / 1 | 0 / 0 | 0 | [-0.05662405979280538, 0.05662405979280538] |

| d | 共分散 / 相関 | AB 対数 / 割合差 | BA 対数 / 割合差 | 前半 / 後半の割合差 |
| --- | --- | --- | --- | --- |
| 85.5 | 0 / null | 32 / 0 | 32 / 0 | 0 / 0 |
| 89.5 | 0 / null | 32 / 0 | 32 / 0 | 0 / 0 |
| 91.5 | 0 / null | 32 / 0 | 32 / 0 | 0 / 0 |
| 93.5 | 0 / null | 32 / 0 | 32 / 0 | 0 / 0 |
| 97.5 | 0 / null | 32 / 0.0078125 | 32 / 0 | 0.0078125 / 0 |
| 101.5 | 0 / null | 32 / 0 | 32 / 0 | 0 / 0 |
| 109.5 | 0 / null | 32 / 0 | 32 / 0 | 0 / 0 |

| 実行 | A 再準備回数 | B 再準備回数 | 保存警告 |
| --- | --- | --- | --- |
| positive | 144 | 260 | Re-warm imbalance between arms can bias timeout fractions. |
| negative | 144 | 144 | null |
| main | 384 | 385 | null |

再準備（rewarm）は timeout 後に次の測定判断が残る場合の warm-up。表は捨てた準備対も含む全 raw の集計。AB は A を先に実行、BA は B を先に実行。相関 null は定数列で計算不能であり、独立性の証拠ではない。

### inference（保存された推論ブロック、そのまま）

```json
{
  "primaryDwellMs": 97.5,
  "mde": {
    "pairs": 64,
    "rho": 1,
    "effectiveN": 64,
    "fraction": 0.2476274882249591,
    "conditionalShiftMs": 3.095343602811989,
    "assumedSlopePerMs": 0.08,
    "areaWeightsMs": [
      2,
      3,
      2,
      3,
      4,
      6,
      4
    ],
    "sampledAreaMs": 2.4008375736214673,
    "planningResolutionMs": 4,
    "alpha": 0.05,
    "power": 0.8
  },
  "optimisticMde": {
    "pairs": 64,
    "rho": 0,
    "effectiveN": 256,
    "fraction": 0.12381374411247956,
    "conditionalShiftMs": 1.5476718014059945,
    "assumedSlopePerMs": 0.08,
    "areaWeightsMs": [
      2,
      3,
      2,
      3,
      4,
      6,
      4
    ],
    "sampledAreaMs": 1.2004187868107337,
    "planningResolutionMs": 4,
    "alpha": 0.05,
    "power": 0.8
  },
  "marginMs": [
    -2,
    2
  ],
  "intervalInsideMargin": true,
  "interpretation": "a probe-induced shift smaller than MDE is not detectable",
  "qualification": "conditional 80%-power planning approximation; local slope 0.08/ms, independent stationary process pairs, nonnegative within-pair arm covariance; no unconditional millisecond MDE from counts alone"
}
```

MDE（Minimum Detectable Effect、最小検出効果）の計画値は、条件付き水平移動で約 3.1 ミリ秒、標本点の面積で約 2.4 ミリ秒。いずれも宣言済み許容範囲の半幅 2 ミリ秒より大きい（これは保守的な仮定、同一プロセス内の相関 1 の値）。楽観的な仮定（相関 0）の値は、条件付き水平移動で約 1.5 ミリ秒、標本点の面積で約 1.2 ミリ秒で、宣言済み許容範囲の半幅より小さい。したがって「この設計は MDE 未満の移動を認証できない」という結論は、保守的な相関の仮定に依存しており、仮定が楽観側なら結論は変わり得る。これは検出力 80% の条件付き計画近似であり、数学的に検出不能という意味ではない。

計画上の解像度は 4 ミリ秒。粗い格子の面積統計では、別途測った判断ごとの約 0.7 ミリ秒の追加コストを分解できない。

<!-- END results-extract.py stdout -->

## 対照の意味

正対照は両側に観測器を入れ、B 側の受信処理だけに既知の遅延を注入した。負対照は同じ観測器を両側に入れ、遅延を注入しなかった。保存された両対照は完了し、構造・端点・予定標本数・感度点・面積の基準を満たす。しかし公表判定は、[判定保存コード](timing-sweep.mjs) のとおり **`descriptive only`（記述的な結果のみ）**、別欄が `controlCriteriaPassed: true` と `controlAssessment: criteria met` である。テストログの正常終了を、対照実験の合格認定へ読み替えない。

理由は、非等間隔の粗い格子における面積の許容帯が、局所的な段差形状の仮定で説明されているだけだからである。未観測区間の形、端の打切り、標本誤差に対して、誤った成立判定を出す確率は較正されていない。負対照の `DEGENERATE` は再標本化した面積が一定になった意味であり、母集団のばらつきがない証明ではない。正対照では再準備回数の左右差についても保存警告がある。

## 主測定から言える範囲

符号付き移動量は、測定点での「B の timeout 割合 − A の timeout 割合」を台形で積分した面積である。正なら B が時間切れになりやすい側。連続した曲線全体の水平移動を直接測った値ではない。

bootstrap（標本を取り直して区間を作る方法）は、A と B のプロセス対をまとめて扱い、測定点と実行順序ごとに再標本化する。点別区間は Wilson／Newcombe 法による近似で、プロセス内の判断を全部独立と数えない。各点の区間は個別のもので、全点を同時に覆う保証ではない。表の前半・後半の差や実行順序別の差は診断であり、それを見て区間を狭めていない。

主測定の `intervalInsideMargin` は true。事前規則に従い「この完了した標本点の面積区間が宣言済み範囲内」と報告できる。ただし、上の最小検出効果の制約を必ず併記する。狭い観測区間によって、事前の検出力計算や格子の解像度を後から置き換えることはできない。無条件の同等性や、干渉がないとの結論は出さない。

`mde` の傾き `assumedSlopePerMs` は測定値ではなく、共通の局所形状を仮定した計画値である。`rho` は同一プロセス内の相関で、保守側では完全相関を置く。`optimisticMde` はそれを無相関とした楽観値である。両者ともプロセス対どうしが独立で定常、同じ対の左右の共分散が非負という前提がある。面積の計画値はさらに測定点間の独立性を置く。時間的な偏り、格子の補間誤差、未観測の形状は区間に含まれない。これは単一ホストでの単回の主測定である。

## 限界と loader 方式への影響

今回支持されるのは、ここで使った試験用戦略・実行環境・負荷条件における、観測器の判断ごとの測定コストと、選んだ期限付近の標本点での効果である。loader 方式の時間コストに具体的な観測値が得られたのであり、実走全体の受入れが終わったわけではない。

- 戦略は合成の試験用コードで、実戦略ではない。観測対象は `StrategyRunner` レベルのみ。試験中に内部の Worker（別スレッド）は動くが、実走の `botMain`、Worker、Sender（取引送信器）を通した全経路の観測ではない。
- 単一ホスト・参照版から変更した実行環境・失敗後に緩めた負荷閾値の結果である。負荷平均は瞬間的な競合を除去しない。busy-spin（時計を見ながら処理を回して待つ方式）は中央演算装置のコアを占有し、測定自身が負荷を作る。親処理での校正だけでは、内部の別スレッドのスケジュールを保証しない。
- G3 の要件２〜５の実観測、実走の無計装対照との比較、実際の取引・時間切れ・復帰の確認は未完了。B04（完全な実行時観測に関する阻害事項）の実境界の残高、支出許可額、予約資金、ガス費・予備額、全取引の帰属と実行結果は、この JSON からは得られない。[未解決の観測項目](../../G3-B03-B04-PATHS-2026-10-10.md) を閉じない。
- G3 は REQUIRED／BLOCKED のまま。B03（安全条件の強制に関する阻害事項）は、[本人決定](../../DECISIONS-2026-10-10.md) どおり**未解決の本人受容済み残余リスク**で、合格・解消ではない。既存ゲートや受容済みリスクの扱いを変更せず、緩和も推奨しない。

## 今回行った確認と未検証事項

読んだ資料は、ルートの `AGENTS.md`、事前宣言、`timing-reduced.mjs`、`measure-timing.mjs`、`timing-sweep.mjs`、`timing-options.mjs`、対照テストのコード、探索・対照・主測定および旧試行の JSON、実行ログ、ハッシュ一覧、Air の索引と保存 JSON、既存の待機方式診断・費用モデル・loader README、本人決定と未解決事項の資料である。コードの同一性をハッシュで照合したことと、その全コードを今回実行して検証したことは区別する。

`results-extract.py` を実行し、生成表と本書の貼付範囲の一致、保存値と生データの軽量な整合性検査を確認した。`git diff --check` と、新規ファイルを対象にした `git diff --no-index --check /dev/null <file>` で空白エラーがないことを確認した。

`npm run typecheck` は試したが `tsc: command not found` で実行できず、型検査は**未検証**。依存導入はしていない。計測テスト、bootstrap の再計算、実機への再接続、実戦略・実走、ネットワーク、Docker、モデル呼出しは実行していない。保存ログのテスト結果は過去の実行の記録として読んだだけで、今回のテスト成功とは主張しない。commit・push もしていない。
