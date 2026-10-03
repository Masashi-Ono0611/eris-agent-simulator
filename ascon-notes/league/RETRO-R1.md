# R1 独立振り返りと計画更新案

2026-10-03、R1 終了後のローカル資料・既存 run に基づく提案。日付は JST。未承認の計画変更・将来の検証は実施していない。

## 結論

- **本命は zeta-a30 系を維持。ただし提出可能性・優勝確率は未立証。zeta-2 は安全修正と新評価式での再測定が終わるまで挑戦者扱い。**
- **「R1 全 run 健全」「手数料が成績を強く説明する」は修正が必要。** launch/201 は 361 loops・catch-up 1 回。手数料と平均 T の Pearson 相関は 0.510、本命を除くと −0.013（下表）。
- inc-zeta は総合首位でも、noop 未満が 11/36 run、レジーム平均では calm・depeg・depeg-persist の 3/12。総合 T の改善と損失防御を別々に判定する。
- 次の投資先は **評価の信頼性 → upstream 整合 → 入札の因果確認・出口防御 → 局所的な強みの移植**。モデル数を増やすリーグは最大あと 1 回に制限する。
- **初回受理目標 10/8、性能変更凍結 10/25、最終受理 10/29、10/30 予備日。** dec-007 は「初回送信直前」と「10/28 再確認」に分ける提案。10/31 23:59 の一発勝負を避ける。

## 1. 振り返り：成果と信頼性の負債

外部資料の略記：計画=`/Users/masashi_mac_ssd/.claude/plans/elegant-soaring-sloth.md`、L2=`/Users/masashi_mac_ssd/.claude/projects/-Users-masashi-mac-ssd-Developer/memory/project_ascon_competition.md`。以下の「提案」「推測」は実測とは区別する。

| 事実・根拠 | 評価・追加すべき仕組み |
|---|---|
| 分離評価 zeta-a30 の P 差 +790.0、95%区間 [342.5,1268.8]、25/30 勝。レジーム等重みでは +941.8（`ascon-notes/eval/iso-compare-seeds101-103.md:107-135`）。 | 候補を同居させるだけの探索から前進。ただし「有意だった 1 体」は他候補との有意差を意味しない（同:139-146）。欠測で launch/spike は各 1 seed、+790 を公式の T と混同しない。 |
| 6 プレイヤーを分離 worktree で作り、固定参照・FROZEN・36 本を記録（`ascon-notes/league/roster-league-r1.yaml:1-27`）。 | 発想と実装を並列化できた。6 体とも本命未満という負の結果も有用。次は生成量より仮説の切り分けに投資。モデル能力ランキングとは解釈しない。 |
| 別系統レビューで台帳破壊・空集計成功・不正 summary の見逃しを発見（`.codex-task/review-harness-astra.md:1324-1337`）。修正仕様と限界を記録（`ascon-notes/league/HARNESS.md:32-58`）。 | 作成者の自己検証だけでは足りなかった。異なるモデルも同じ diff に依存すると共通の盲点を持つ。レビューに実成果物・故障注入を必須入力として足す。 |
| 二重パスの roster dir で全滅しても backtest は exit 0・run_dir 空。陽性対照で発火確認と L2:31 に記録、現在の検出は `ascon-notes/eval/run-matrix.sh:180-204`。 | 終了コードを成果の代用にした誤り。起動→全員 ready→完走→採点→提出まで、各段階の必要成果物と次段への合否を一つの検査契約にする。 |
| 初版ゲートは expected-loops=360・判断数/送信失敗差=0（`.codex-task/taskY.out:1718-1725`）。現在は 362、後二者は既定無効（`ascon-notes/league/degradation-gate.py:151-159`）。説明は差=0 のまま（`ascon-notes/league/DEGRADATION-GATE.md:15-27`）。 | 正常 run も落とす校正不良は偽失敗であり、解除し過ぎれば偽成功になる。閾値を実測・文書・テストで同期し、健康/劣化/欠測の三群で感度と誤検知率を示す。合否を見てから閾値を緩めない。 |
| Anvil 履歴が 50 回で約180GB、ENOSPC。専用領域による所有権付き清掃を導入（L2:16-18）。スリープでは 722 秒→7,534 秒、run ID 衝突も実害（L2:16）。 | 計算量より運用不良が時間を奪った。単一 matrix ロック、run UUID、caffeinate、容量監視、所有した領域だけ清掃、実行中ファイル固定を標準化。古い結果の上書き・混入も検査する。 |
| 禁止 RPC `anvil_setBalance(...,0)` を「拒否確認」で devnet に送る実装をレビューで検出（`.codex-task/review-pr3-tooling.md:1800-1802`）、削除済みとの L2:31。 | 403 は安全性の証明ではない。practice の transport を許可リスト化し、禁止呼出は**送信前**に阻止するオフライン偽 transport テストへ。戦略スキャンだけでは運用スクリプトを守れない。 |
| テストの Python crash が空 stdout のため PASS し得た（`.codex-task/review-pr3-tests.md:439-444`）。現在は status 検査あり（`test/ascon-release-prepare.test.ts:82`）、dry-run の接続された陽性対照も追加（`test/ascon-league.test.ts:65-77`）。 | 改善は確認できるが本レビューでは全テストを再実行していない。exit・stderr・実行件数・skip 数・期待成果物をセットで検証する。 |
| CI 用 fixture の相対パス修正を別 commit a5ddac0 で確認（`test/ascon-league.test.ts:19-27`）。commit 漏れによる CI 失敗は依頼記載だが、その失敗ログは未確認。CI は main 向けのみ（`.github/workflows/ci.yml:8-12`）。 | 原因を fixture 不整合と commit 漏れで混同しない。予定ファイル一覧と tracked 一覧を照合し、**提出する commit の clean checkout**で関連検証。CI 0 jobs/skip は green としない。最新 hosted CI は未確認。 |
| zsh の未一致 glob で調査コマンドが停止（`.codex-task/taskX.out:3378`、`.codex-task/taskY.out:1487`）。 | 運用は bash 3.2 を明示、glob は列挙結果を検査、特殊変数 status/HOME を一般用途に転用しない。空一致・空白パス・子異常終了・pipeline の故障 fixture を追加。CI の `npm ci` も ignore-scripts 指定がない（`.github/workflows/ci.yml:30`）：repo ルールに合わせる。 |
| zeta-2 は 12 項目の修正後に、出口 minOut=1 の適用拡大という Critical を新設（`.codex-task/review-zeta2-astra.md:651-665`、`.codex-task/review-zeta2-grok.md:1-11`）。 | 「バグ修正だから性能改善」は誤り。出口・入札・在庫・RPC を分けた ablation と、変更しない枝の差分同値テストが必要。残り ≤3 ブロックの緊急出口にも損失リスクは残る。 |

### 今回追加で見つけた未封鎖の穴（修正はしていない）

- **R1 の「全362」は誤り**。`ascon-notes/eval/out/league-r1/index.tsv:35` → `runs/2026-10-03T08-05-50-336Z/summary.json:6-7` は 360 blocks / 361 loops。`events.jsonl:337` は blocksCaughtUp=2、totalMs=422。旧 report の閾値 <360 では採用、新ゲートの厳密362では FAIL。完走と無劣化は別。launch/201 を隔離し、同条件再測定まで R1 は暫定診断に格下げする。
- **ゲート間の合格条件が分裂**。既存 calm/201 の summary をメモリ上だけ failedReads=7・violations ありに置換し、ゲート extract を実行すると failed=[] / blocked=[]（`ascon-notes/league/degradation-gate.py:47-143` はこの検査を持たない）。単体の PASS を選抜許可にしない。採点・完全性・負荷検査の積集合を必須化。
- **集計も fail-open が残る**。`aggregate.py /dev/stdin` にヘッダだけ渡すと空表・exit 0（`ascon-notes/eval/aggregate.py:110-123`）。league のメモリ内 fixture でも loops 欠測＋1 人の P=NaN が除外 0・採点1件（`ascon-notes/league/league_harness.py:204-222`）。予定 roster 全員の有限 P、12×seed の完全一致を要求し、欠けた選手だけ落として μ/σ を変えない。
- **検査 PASS が表記依存**。`verify-player.sh:15-21` はテスト・prompt チェッカーの exit code を保持せず出力で判定、同:24-26 は直下 *.ts と二重引用符 import 等しか見ない。機械可読結果＋全依存の走査＋ZIP 実起動で補う（完全な安全性証明ではない）。
- **RELEASE READY は実測証拠と未結合**。`ascon-notes/release/prepare-release.py:174-181` の確認フラグは自己申告、静的検査のみでも exit 0。run manifest・selftest 証跡・ZIP hash が一致しなければ提出 READY に遷移させない。
- **追跡可能性はまだ事後記録**。`ascon-notes/league/ledger.md:3` / `HARNESS.md:56-58` の hash は記録時点。実行開始時の simulator SHA・agent/prompt/roster hash・seed・parallel・閾値・起動/終了を保存し、終了時一致を検査。現 R1 の全コードが開始時と同一だったことは遡及保証できない。
- `approvals_granted.count` は成功数でなく対象数（`ascon-notes/analysis-approval-failed.md:12-21`）。allowance 23 組と着地20件の実測で「承認全滅」は否定できるが、失敗確認 RPC の原因と submit_failed 2 件は未解明（同:4-6）。tx送信・包含・receipt成功・経済利益を別カウンタにする。

## 2. R1 の軽量再集計と結論の限界

出典：`ascon-notes/eval/out/league-r1/index.tsv:2-37` が指す 36 個の summary.json / blocks.csv / agents/*.jsonl / events.jsonl。末尾の Python により表を生成（手入力で数値を転記していない）。
11体中 noop を μ/σ から除外、P=`pnlUsdc`、σは母標準偏差、T=50+10(P−μ)/σ。全レジーム3本なので全36本平均=レジーム等重み。noop の T は同じ μ/σ へ投影した比較用値。
36 run ID 一意・全員11体・360 blocks・failedReads=0・violationsなし・CSV包含数一致。loops は362が35本、361が1本。環境p99（nearest-rank）範囲108〜737ms、catch-up計1回、記録上decide timeout計0。これは全健全性の証明ではない。
優先手数料は base fee=0 の backtest 前提で gasUsed×min(tip,cap)、リバート含む。包含≠成功売買、送信失敗は mempool/submit_failed 件数。順位は各 seed の12レジーム平均、非baseline10体中。
index SHA-256: `f5f0f6237dd1b2927115dff928de44571e3d33edee767ae698b9df2df48e2440`。

| agent | 平均T | tip合計ETH | 包含 | revert（包含比） | 送信失敗 | seed201 / 202 / 203 順位 |
|---|---:|---:|---:|---:|---:|---|
| inc-zeta | 59.68 | 1.337729 | 5263 | 9 (0.17%) | 370 | 1 / 1 / 1 |
| grok-1 | 53.58 | 0.488680 | 2312 | 8 (0.35%) | 89 | 2 / 5 / 2 |
| opus-1 | 52.98 | 0.149044 | 4013 | 669 (16.67%) | 789 | 3 / 6 / 3 |
| sonnet-1 | 52.74 | 0.087021 | 750 | 5 (0.67%) | 152 | 4 / 3 / 4 |
| clean-arb | 52.22 | 0.008478 | 767 | 39 (5.08%) | 55 | 5 / 4 / 5 |
| astra-2 | 49.88 | 0.009547 | 818 | 160 (19.56%) | 305 | 6 / 7 / 7 |
| astra-1 | 49.55 | 0.002628 | 254 | 134 (52.76%) | 200 | 7 / 8 / 6 |
| venue-arb | 49.46 | 0.138126 | 11898 | 177 (1.49%) | 198 | 8 / 2 / 8 |
| sonnet-2 | 41.15 | 0.360951 | 3816 | 205 (5.37%) | 404 | 9 / 9 / 9 |
| multi-arb | 38.75 | 0.060492 | 5204 | 248 (4.77%) | 271 | 10 / 10 / 10 |

| レジーム | inc-zeta T | noop T | 平均首位・T | seed201 / 202 / 203 の首位 |
|---|---:|---:|---|---|
| calm | 51.96 | 56.41 | grok-1 58.39 | grok-1 / sonnet-1 / grok-1 |
| cdp-incident | 52.35 | 46.21 | opus-1 68.05 | opus-1 / venue-arb / opus-1 |
| cex-drift | 58.84 | 46.00 | venue-arb 60.93 | inc-zeta / venue-arb / grok-1 |
| crash | 52.95 | 46.15 | venue-arb 56.63 | multi-arb / venue-arb / venue-arb |
| depeg | 52.94 | 54.72 | grok-1 57.19 | sonnet-1 / grok-1 / sonnet-1 |
| depeg-persist | 54.29 | 54.36 | grok-1 60.29 | grok-1 / grok-1 / sonnet-1 |
| informed-flow | 66.68 | 51.24 | inc-zeta 66.68 | grok-1 / inc-zeta / inc-zeta |
| launch | 74.39 | 49.89 | inc-zeta 74.39 | inc-zeta / inc-zeta / inc-zeta |
| lending-incident | 64.99 | 45.34 | venue-arb 65.19 | venue-arb / venue-arb / inc-zeta |
| spike | 62.82 | 49.14 | inc-zeta 62.82 | inc-zeta / venue-arb / venue-arb |
| vuln | 59.53 | 54.37 | inc-zeta 59.53 | inc-zeta / clean-arb / inc-zeta |
| whale | 64.38 | 41.77 | inc-zeta 64.38 | inc-zeta / inc-zeta / clean-arb |

- 手数料合計対平均T：10体 Pearson **0.510** / Spearman **0.467**、inc-zetaを除く9体では **−0.013 / 0.267**。sonnet-2 は0.361 ETHを費やしてT41.15。利益機会・戦略・包含量が交絡し、勝者が多く支払う逆因果もあり得る（推測）。金額増加を成功条件にしない。
- agent別総数と平均Tの Pearson：revert **−0.236**、送信失敗 **−0.006**。包含数で割った比率でも **−0.070 / 0.015**。失敗を減らすだけで高Tになる証拠はないが、astra-1 のrevert52.76%、opus-1 の16.67%は原因別診断に値する。
- inc-zeta は全 seed の総合首位だが、シナリオ首位は12/36。レジーム内でseed間の首位が変わるのは11/12。venue-arbの総合順位8→2→8も大きい。「上位3枠維持100%」は**新規6プレイヤー内**の再標本化指標で、本命を含む勝率ではない（`.codex-task/league-r1-report.md:390-405`）。
- launch/201 を全員共通で除き、レジーム等重みを再計算すると inc-zeta **60.05**、grok-1 **53.40**、multi-arb **39.18**。首位は維持されるが、欠測を採用正当化に使わず再測定する。
- 参照・派生が多い11体の μ/σ と市場機会は本番と異なる。最終の独立世界にも対戦相手選択バイアスが残るので「身内過適合を潰す」（計画:9）は言い過ぎ。固定参照場と高入札場の両方を使う。
- 同じseedを全員で共有する対応比較は有効だが、360個の agent×run 観測が独立になるわけではない。レジーム毎3seedは小さく、同一seedのレジーム横断依存・実時間順序ノイズも残る。今のレジーム内bootstrap（`league_harness.py:156-163`）に加えseed単位の感度分析を行う。
- 4候補からの本命選抜・6新規の順位・レジーム最良部品の探索は多重選択。holdoutを見て直した版は再び探索扱い。上位順位の安定性は勝者の呪いを補正しない。
- 全員FROZENなので推論費・改訂遅延・改訂失敗・改訂後の損益はゼロ観測。本番の60エポック、独立レジーム抽選、後半加重もR1の単純平均では再現していない（`competition-notes.md:33,41-42`）。優勝確率の数値推定はできない。
- 練習場「25 = baseline1+参照8+canary1+外部15」は算術上27（`field-observation-2026-10-03.md:3-8`）。重複区分か誤記か未確認で、Grok報告も未独立再取得。5gweiの標本を感度条件に使えても、本番人数・入札分布の推定値にはしない。

## 3. 勝ち筋の順位（期待効果・コストは推測）

| 優先 | レバー | 期待効果 / コスト | 主要リスク・採否 |
|---|---|---|---|
| 0 | 検査統合・upstream・受理/改訂経路 | 失格/誤選抜を防ぐ効果大、2〜3日 | 利益探索を止め過ぎない。最小の反例検査と受理までを先に固定。 |
| 1 | 出口・資金・ガス予算の防御＋zeta-2切り分け | calm/depeg系のnoop割れと致命損失を削る、1〜2日＋36本単位 | 保守化でlaunch等を失う。非劣性とレジーム別の損失を確認。 |
| 2 | **入札の最適化**（額の単純増加ではない） | 順序獲得と費用の差分を改善し得る、最大4版×36本 | 同一売買ロジックで bid off / a30 / 低share / 保守利益capを比較。順序・純P・T・ガス残高を記録し因果を近づける。 |
| 3 | opusのcdp、grokのdepeg-persistを個別移植 | 局所の差は+15.70T / +6.00T、各1日＋36本 | 同一世界の差が移植利益になるとは限らない。単独移植と合成版を分け、相互作用を検査。 |
| 4 | LLM改訂の安全な実用化 | 適合性には必須、性能の上積みは未知、2〜3日＋72本 | promptの「PARAMSのみ」は強制サンドボックスではない。改訂diff・無効コード・遅延・枠切れ・最後の正常版維持を実測。 |
| 5 | フィールド観察→2種類の場で頑健性確認 | 相手構成の偏りを減らす、半日＋最終比較に含む | 練習の標本/区分誤り、追随による過適合。観察に合わせて無限に場を増やさない。 |
| 6 | 新規プレイヤー追加 | 新しい機構が出る場合だけ価値、最大2体・追加リーグ1回 | 6体で本命超え0は探索終了の証明ではないが、派生追加は相関・多重検定・レビュー負債を増やす。モデル系統枠を利益機構の多様性枠へ変更。 |

## 4. 10/3〜10/31 更新計画案

**現行計画との差分**：upstreamを「最終/提出直前」（計画:47,55）から10/4〜5へ前倒し／自動的な多世代リーグを1回までに制限／本命への無条件統合を廃止／形式・改訂確認を10/8までに前倒し／noop・固定対戦場・実測証拠を必須化／最終用seedと計算上限を先に封印。
ローカル追跡upstream/main=cbec5adはHEADより13 commit先（本レビューのread-only git確認、fetchなし）。評価のown-size stable変更2fd6b30とseed stream変更9b07a09を含む。**旧新の数値・同じ整数seedを同一条件として混ぜない**。

### 共通の判定契約（数字は事前登録する提案）

- G0（実行責任者=Codex/統括、独立レビュー担当が監査）：予定シナリオ/roster 100%一致、重複0、全員有限P、failedReads/violations/早期終了/timeout=0、360blocks、完全ログ。負荷基準は362loops・環境p99<1,000ms・被覆低下≤1pp・catch-up増加0。逸脱は隔離、閾値変更には別の校正証拠が必要。
- 並列3対照と候補並列で**同じ12体・同じ3レジーム(calm/cdp/launch)×3seed**を比較。負荷由来と取引競合由来を区別できない送信失敗は、事前に固定した同条件対照の上限超過で要診断。自動合格させない。合格までp=3、p=5→6を一段ずつ。8体probeだけで11〜16体の採用を決めない。
- F_ref=`cand+noop+multi-arb+clean-arb`、F_bid=F_ref＋高入札参照コピー2体（0.1/5gweiを固定した感度条件）。候補/本命は**置換した別世界**、同じseedと参照配置で比較、実行順を交互化。既存confirmはcrowdも入れる（`confirm_candidate.py:93`）ため、計画との不一致を解消してから実行。
- G1（探索、統括判断）：12本診断はクラッシュ等だけで止める。通過なら24本追加して各3seedにし、全レジーム平均ΔT≥+1.0、レジーム平均ΔTの最悪≥−2.0を次段目安とする。安全修正は平均ΔT≥−0.5＋危険挙動消失で保留可。単一seed順位で脱落させない。
- G2（採用、独立レビューが証拠確認→本人が決定）：固定した挑戦者1体とfallback1体を新5seed以上×12×2場。主指標はF_refのレジーム等重みΔT、95%対応区間下限>0、点推定≥+1.0。F_bidはΔT区間下限≥−1.0、各場のレジーム平均ΔT最悪≥−2.0。seedクラスタ感度で逆転なら保留。参考に各世界の対multi-arb差と純P差も併記し、μ/σ変更の影響を隠さない。
- 提出候補はさらに各場で平均T≥multi-arb、**全12レジームで平均(Tcand−Tnoop)≥0**、未回収の自前資産損失とgas枯渇0。R1はこの提出用の場ではないが、fallbackも自動免除しない。安全性要件を満たさない場合は変更を撤回し、適合する最終受理版を維持する。
- G3（本人）：公表モデル照合、改訂が実際に≥3回受理・適用、改訂前後の型/戦略/禁止API検査100%、障害3種（遅延・無効出力・枠切れ）で危険取引0。推論ON/OFFの72本で平均ΔT≥−1、最悪レジームΔT≥−3を暫定非劣性基準。FROZENを本番の代替にしない。
- G4（本人送信）：clean release worktree、envなし同一既定、typecheck/関連全テスト/check:strategy/public60、bundle展開・0 BLOCK・2vCPU/4GB selftest、住所表byte一致、ZIP/commit/run証跡一致。未確認の `--submission` は10/5までに仕様と実挙動を確認し、黙って無視された成功を認めない。

### 日付・入口/出口・予算

以下は**最大の本予算**。R36=12レジーム×3seed、V60=12×新5seed、P60=公式公開60。1バッチ13分（実run約12分＋起動余裕）、等速360blocks。時間はp=3の保守枠、校正だけp=3/5/6各条件。G=上記ゲート。

| 期間 | 入口 → 目的・出口 | run数・壁時計予算 | 決定者 |
|---|---|---:|---|
| 10/3夕〜10/5 | R1保存→G0反例修正、zeta-2 Critical解消、upstream別branch取込み。旧/新評価で同じ本命R36を比較し新基準を固定。校正は最大3水準×9本。 | 72＋27本、312＋91=403分 | 統括実装、独立担当がG0と評価式差分確認。本人が取り込み/merge判断。 |
| 10/6〜10/8 | 新基準→焼込みfallbackのV60＋P60、G4、最小改訂疎通/G3安全部分。F0を最後に確認し初回ZIP+鍵登録、**受理メール1件**を確保。 | 120本、520分＋Docker/推論確認枠 | 本人が費用上限/鍵/モデル/送信。10/8未受理なら10/9に探索停止し解消。 |
| 10/9〜10/13 | G0・受理経路確保→入札/防御を最大4版、各12＋24本。G1で最大2案へ。10/12規約発効・モデル公表・upstream差分を再点検。 | 4×R36=144本、624分 | 統括が事前登録、独立担当が因果・費用控除確認。 |
| 10/14〜10/17 | G1→移植最大2版×R36＋追加リーグ最大1R36（新規機構2体まで）。既存fieldは固定。最終挑戦者1体を選ぶ。 | 108本、468分 | 本人が追加生成/統合の価値を判断。2案連続でΔT≤0なら生成打切り。 |
| 10/18〜10/20 | 候補固定→同一戦略の改訂ON/OFF各R36、G3。改訂後artifactを保存、エポックを跨ぐ状態を確認。 | 72本、312分＋推論待ち最大6時間 | 独立担当が危険差分を確認、本人が改訂間隔と推論予算決定。 |
| 10/21〜10/25 | G3→挑戦者/fallback×F_ref/F_bid×V60。G2で採否。**10/25性能変更凍結**。 | 4×V60=240本、1,040分 | 独立担当がholdout監査、本人が1版選定。 |
| 10/26〜10/28 | 凍結版→最終版/fallback各P60＋合計24本の配置/実行順反復、G4。10/28 dec-007再確認。 | 144本、624分＋selftest枠 | 統括が証拠整合、本人が最終版承認。 |
| 10/29〜10/30 | G4→10/29最終版送信・受理、10/30受理版照合と予備。 | 新規探索0。再実行は予備枠内。 | 本人のみ送信。 |
| 10/31 | 最後の受理ZIP/hashを確認、23:59 JST凍結。 | 新規変更0、確認のみ。 | 本人。緊急rollbackは保存済み適合版への差し替えに限定。 |

合計 **927 run、約66.5時間(p=3中心)**、p=5採用後なら約42.7時間（各試験ごと端数切上げ）。再測定/仕様更新用25%と推論・selftest枠を合わせ、**Air占有上限100時間、通常1日6時間**。上限超過時は新規生成→追加移植→パラメータ候補数の順に削り、最終holdout・公開60・受理確認は削らない。
最大容量は p=3:40GiB / p=5:53GiB / p=6:59GiB を事前確保、batch間にも確認、単一matrixのみ（`DEGRADATION-GATE.md:56-60`）。run本数を削っても2秒/360blocksは変更しない。ミニ移行は本予算外、現負荷測定と同時実行しない。
探索seedは既使用101〜103/201〜203を識別し、新規台帳で予約。最終5seedは全探索終了まで未開封、既使用検査に全roundを渡す。曖昧なG2結果で追加5seedを使うなら**先に停止規則を決めた独立確認**とし、見ながら都合よく標本を足さない。
LLMの約360改訂/競技は既定間隔60からの見積り（`submission-checklist.md:42`）。まず少数呼出の使用率/遅延を測り、競技総量＋確認用に2倍余裕の見積りを本人が承認。%が粗く推定不能なら十分と扱わず、適法な間隔調整か前払額を本人判断。

### 提出・撤退の運用

- 初回は「形式だけの未検証ZIP」ではなく、G4を通した保守的zeta-a30系。初回F_refでのV60を入口にし、追加のF_bidによるG2は最終採用までに完了させる。初回不受理やモデル未公表なら、10/9に本人が運営照会方針を決定（現在の「当面質問しない」からの変更提案）。
- dec-007を単純に10/28まで延期すると初回提出とLLM実測が詰まる。**「最後」は送信作業の最後**と解釈する変更を本人に提案し、10/8前と10/28にF0全項目（残高・auto-charge Off・対象モデル・代表メール・鍵登録）を確認。鍵は本人だけが運営専用フォームへ入力する（`submission-checklist.md:31-46`）。
- 差し替えはローカルG4通過後、通常1日1受理まで・公式上限5回/日を厳守。commit/ZIP SHA-256/送信時刻/受理メールを1対1保存。不受理・送信完了だけでは受理版を更新しない。最後の受理が唯一の本番版（`competition-notes.md:9-18`）。
- 10/20までにG3不通過なら自由なコード改訂の追求を止め、規約に適合する保守的なパラメータ改訂に限定して再検証。必須改訂を無効化して提出しない。10/25にG2優位性未達ならfallbackを維持。fallbackも不適合なら「提出しない/既受理版維持」を本人が決める。
- 10/25以後は失格・資産喪失・受理不能の修正だけ。修正した版は影響範囲とG4を再検証、holdout性能の主張を引き継がない。規約対応の新upstreamが出た場合も必要範囲を取り込み再評価し、古い採点で選んだまま提出しない。

### リスク登録簿（確率は推測、影響1〜5、積=確率×影響；優勝確率ではない）

| リスク | 確率×影響=優先度 | 対策 / owner |
|---|---:|---|
| 不正run・計測抜けを合格扱い | 50%×5=2.50 | G0共通化、反例fixture、開始時manifest / 統括 |
| LLM改訂が壊れる・枠不足 | 50%×5=2.50 | 10/8疎通、ON/OFF、障害注入、使用量余裕 / 本人＋統括 |
| 新seed/相手で本命逆転 | 50%×4=2.00 | 未開封holdout、2場、選抜後の変更禁止 / 独立担当 |
| 高入札による費用超過・順序優位消失 | 40%×4=1.60 | 固定売買ロジックのablation、ガス残高と純P / 戦略担当 |
| upstream採点/stream変更で結論失効 | 既知100%×4=4.00 | 10/5更新・旧新比較、10/12再確認 / 統括 |
| 出口改修で全額損失・回収不能 | 30%×5=1.50 | ≤3境界、dust、hung RPC、在庫不足テスト＋実run / 戦略担当 |
| ZIP/鍵/モデル/住所表不整合で不受理 | 30%×5=1.50 | 10/8初回受理、release分離、G4 / 本人 |
| 負荷・容量・sleepで結果無効 | 30%×3=0.90 | 等速、容量/負荷監視、単一matrix、25%再測定枠 / 実行担当 |

## 5. 反証条件

- 新基準・新seedでzeta-2がzeta-a30より平均ΔT<−0.5、又は1レジーム<−2なら「修正一式が土台」は棄却し、修正単位に戻す。安全修正の必要性と性能採用は分ける。
- 入札強化の純P差≤0、G2下限≤0、他レジームΔT<−2、又はgas枯渇>0なら入札強化案を撤回。相関だけでは採用しない。
- cdp/depeg移植が新seedで対象レジームを改善しない、または他レジームの損失で総合ΔT≤0なら移植案を棄却。
- 高入札場で本命の対multi-arb差が≤0、seed/配置反復で順位が逆転するなら「参照への先着」が本命の実力を説明した可能性（推測）。場の頑健性へ予算を移す。
- 改訂ONで平均ΔT<−1、最悪レジーム<−3、改訂後の危険挙動が1件でもあれば自由度を縮める。LLMが明確に+1T以上改善し安全なら、生成リーグ枠を改訂活用に再配分する。
- 別機構の新規1体が未使用seedで本命を+2T以上上回りG0/G3も通るなら「追加生成は低効用」を見直す。ただし締切凍結日は維持。
- 新ゲートが既知の壊れたfixtureを1件でもPASS、または開始/終了hash不一致を許せば、以後のランキングを採用せず検査から直す。

## 6. 今すぐ行う最優先5つ（本レビューでは実行しない）

1. **R1証跡を保全しlaunch/201を隔離**。レポート・台帳の「全362/健全」と旧<360判定の食い違いを明示し、負荷測定終了後に同条件再測定を予約。
2. **G0の単一入口を作る**。空/欠測/NaN/violations/不完全roster/偽exit0の反例を追加、閾値と説明を一致、clean commitのCIで必要検査の実行件数を確認。
3. **upstream13 commitを別branchで評価し、新基準を固定**。zeta-a30を対照保存、旧新の評価式・seed stream・提出形式を確認してから次の大型評価。
4. **zeta-2のCritical修正を回収・再レビューし、入札/出口/移植を別々に測る計画を登録**。本命設定を焼いただけで本命を置換しない。
5. **10/8初回受理の逆算を本人と固定**。モデル/--submission/鍵F0/実改訂/selftestをクリティカルパスへ移し、dec-007の前倒し＋10/28再確認を決める。

## 表の再生成（stdlib、読取のみ）

repo rootで `python3 -B` に以下を渡す。旧評価式でR1を記述するコードであり、本番の新採点を代用しない。
```python
import csv,json,math,statistics as S,collections as C
from pathlib import Path
rows=list(csv.DictReader(open("ascon-notes/eval/out/league-r1/index.tsv"),delimiter="\t")); D=[]
assert len(rows)==len({r["run_dir"] for r in rows})==36
for r in rows:
 p=Path(r["run_dir"]); s=json.loads((p/"summary.json").read_text())
 assert r["exit_code"]=="0" and s["valueSeries"]["failedReads"]==0 and not s["violations"]
 A=s["agents"]; ids={a["id"] for a in A}; assert len(A)==len(ids)==11
 P=[a["pnlUsdc"] for a in A if not a.get("baseline")]; assert all(math.isfinite(v) for v in P); mu,sd=S.mean(P),S.pstdev(P)
 fee=C.Counter(); n=C.Counter()
 for b in csv.DictReader((p/"blocks.csv").open()):
  if b["ownerId"] in ids:
   fee[b["ownerId"]]+=int(b["gasUsed"])*min(int(b["priorityFeeWei"]),int(b["maxFeePerGasWei"])); n[b["ownerId"]]+=1
 for a in A:
  i=a["id"]; assert n[i]==a["includedTxCount"]
  log=[json.loads(l) for l in (p/"agents"/f"{i}.jsonl").open()]; assert log
  f=sum(e.get("kind")=="mempool" and e.get("event")=="submit_failed" for e in log)
  D.append(dict(i=i,r=r["regime"],s=r["seed"],t=50+10*(a["pnlUsdc"]-mu)/sd,fee=fee[i]/1e18,n=n[i],v=a["revertCount"],f=f))
ids=sorted({d["i"] for d in D}-{"noop"}); regs=sorted({d["r"] for d in D}); seeds=["201","202","203"]
def ts(i,r=None,s=None): return S.mean(d["t"] for d in D if d["i"]==i and (r is None or d["r"]==r) and (s is None or d["s"]==s))
def total(i,k): return sum(d[k] for d in D if d["i"]==i)
for i in sorted(ids,key=lambda i:-ts(i)):
 rank=" / ".join(str(1+sum(ts(j,s=s)>ts(i,s=s) for j in ids)) for s in seeds)
 print(f"| {i} | {ts(i):.2f} | {total(i,'fee'):.6f} | {total(i,'n')} | {total(i,'v')} ({100*total(i,'v')/total(i,'n'):.2f}%) | {total(i,'f')} | {rank} |")
for r in regs:
 best=max(ids,key=lambda i:ts(i,r)); wins=" / ".join(max(ids,key=lambda i:ts(i,r,s)) for s in seeds)
 print(f"| {r} | {ts('inc-zeta',r):.2f} | {ts('noop',r):.2f} | {best} {ts(best,r):.2f} | {wins} |")
def corr(x,y):
 a,b=S.mean(x),S.mean(y)
 return sum((v-a)*(w-b) for v,w in zip(x,y))/math.sqrt(sum((v-a)**2 for v in x)*sum((w-b)**2 for w in y))
def rank(v): return [1+sum(y<x for y in v)+(sum(y==x for y in v)-1)/2 for x in v]
for I in (ids,[i for i in ids if i!="inc-zeta"]):
 x=[total(i,"fee") for i in I]; y=[ts(i) for i in I]
 print("fee/T Pearson, Spearman",corr(x,y),corr(rank(x),rank(y)))
for k in ("v","f"): print(k,"/T Pearson",corr([total(i,k) for i in ids],[ts(i) for i in ids]))
```

## 未確認・できなかったこと

- ネットワーク・実バックテスト・anvil・重い計算・git commit/pushは行っていない。型チェック/全テスト/Docker/公式selftest/hosted CIも再実行していない。本レビューの検証は既存runの逐次読取、独立集計、書込なしの小さな故障注入と文書検査のみ。
- 並列5/6の最終判定、zeta-2修正中worktreeの最終版、公式モデル一覧、--submission実挙動、鍵登録/受理状況、現時点の最新upstream・最新規約は未確認。規約URLへ接続せず、指定メモと依頼の前提を使用した。
- CI失敗の原ログとcommit漏れの直接証拠、フィールド25体の区分重複、手数料の因果、トランザクション毎の純利益、ログに残らない判断や欠落行は確認できない。L2の過去実測・レビュー指摘を現行実装の完全な保証とはしていない。
