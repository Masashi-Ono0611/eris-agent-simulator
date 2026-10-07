# ASCON 全体回顧 — 2026-10-07

## 読み方・対象範囲

- [doc] 対象は Nyx Foundation の DeFi エージェント競技 ASCON。upstream を取り込んで独自候補を開発したプログラム全体を扱う。リポジトリは `Masashi-Ono0611/ascon`。移管自体は過去の実施記録であり、今回オンラインで再確認していない。出典: [ascon-notes/README.md](../README.md)、[MASTER-PLAN-2026-10-04.md](MASTER-PLAN-2026-10-04.md) §移管。
- [inferred] 本稿は main `ba6a0bd` の保存資料を照合した文書レビュー。実走、ネットワーク、SSH、Docker、モデル照会、認証情報の読取りは行っていない。資料にある「測定済み」と、今回の独立再測定・生ログ監査を区別する。
- [inferred] **出典記号**: `[doc]` はリポジトリ文書・保存表に記載された事実、`[supervisor]` は **supervisor-supplied** の `/tmp/retro-extra-facts.md` による補足、`[inferred]` は本稿の解釈・提案。リンクは出典のリポジトリ内パスを示す。以下、ファイル名だけのリンクはすべて `ascon-notes/league/` 以下。異なる場所は明示する。文書の記載は、それ自体では実行時の真実を再証明しない。
- [inferred] 台帳の判定は仮説の範囲に対する本稿の評価。`supported` は限定した観測で支持、`refuted` はその範囲で反証、`inconclusive` は交絡・欠測・少数標本で未決、`untested` は適切な検証未実施。「テスト PASS」「G0 PASS」「資格 PASS」「提出受理」は別の状態である。
- [supervisor] **supervisor-supplied**: r3x の新しい対照結果を [results-2026-10-06/r3x-experiment.txt](results-2026-10-06/r3x-experiment.txt) に原文コピーした。これは監督者提供の集計であり、各世界の raw receipts / inventory / action ledger を本稿で独立監査した結果ではない。

## 1. 目的・規則・採点と意思決定の枠組み

### 1.1 何を最大化し、何を守るか

| 項目 | 内容・含意 | 根拠 |
|---|---|---|
| 目的 | 競技で優勝するため、終了時の損益と相対順位を改善する。途中の含み益、売買回数、実装の複雑さは採点目標そのものではない | [doc] [ascon-notes/competition-notes.md](../competition-notes.md)、[docs/competition-start.en.md](../../docs/competition-start.en.md) |
| 損益 | `P_i = V_i,end − V_i,start`（USDC換算）。wallet と指定プロトコルのポジションを評価。WETH/WBTC は基準価格、gas を含む。自作コントラクトに残した資産と終了時の launch token はゼロ評価 | [doc] [docs/competition-start.en.md](../../docs/competition-start.en.md) |
| T 式 | 各エポックで `T_i = 50 + 10 × (P_i − μ) / σ`。μ/σ はその場の採点対象全員に依存。σ=0 のエポックは除外。最終値は後半ほど重い重み付き平均（1.0→1.5） | [doc] [docs/competition-start.en.md](../../docs/competition-start.en.md) |
| 世界 | 360 blocks、2秒/block、約12分。各エポックで世界・残高を reset。12レジームをほぼ等しく扱うが、独立抽選なので必ず各5世界になる保証ではない | [doc] [docs/competition-start.en.md](../../docs/competition-start.en.md) |
| レジーム | calm / cex-drift / informed-flow / whale / lending-incident / depeg / crash / vuln / spike / depeg-persist / cdp-incident / launch | [doc] [docs/competition-start.en.md](../../docs/competition-start.en.md)、[RETRO-U1.md](RETRO-U1.md) |
| 提出形式 | `decide(obs)` と frontmatter `kind: improve / name / description` を持つ prompt。`run(ctx)` は提出用形式ではない。判断5,000ms、公式環境2 vCPU/4GB、AI改訂は推論5分上限、既定60 blocks間隔 | [doc] [docs/competition-start.en.md](../../docs/competition-start.en.md)、[ascon-notes/submission-checklist.md](../submission-checklist.md) |
| 最終提出 | 期間終了時点で**最後に受理された1件**。1日5回まで差替え。「2件指名」は古い記述として記録済み。送信操作と受理確認は別 | [doc] [ascon-notes/competition-notes.md](../competition-notes.md)、[RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |
| 規約・期限 | 規約が最優先。評価価格を歪める取引、複数提出間の資産移動・自己取引、devnet の cheatcode 等は禁止。最終期限は **2026-10-31 23:59 JST**。保存された適用版の日程は将来確認事項で、今回最新規約を取得していない | [doc] [ascon-notes/competition-notes.md](../competition-notes.md)、[MASTER-PLAN-2026-10-04.md](MASTER-PLAN-2026-10-04.md)、[RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |

[inferred] T は損益を正規化するので、別の相手・世界・採点母集団の T を引き算して「戦略が何点改善した」とは言えない。P−noop、同一世界の対照差、レジーム最悪値、取引の資金・損失経路を併記する必要がある。終了時の在庫評価まで追うことが、途中の裁定益だけを見るより目的に近い。

### 1.2 開発から提出までのゲート

| ゲート・決定 | 意味と現在位置 | 根拠 |
|---|---|---|
| G0 | 予定世界・roster完全一致、全員有限P、failedReads=0、violations=[]、360 blocks / **362 loops**、必要ログ、包含数、負荷等の積集合。PASS=0、既知不一致FAIL=1、必要証跡欠測BLOCKED=2。欠測者を抜いた再採点は禁止 | [doc] [DEGRADATION-GATE.md](DEGRADATION-GATE.md)、[G0-VERIFICATION.md](G0-VERIFICATION.md) |
| Q0 / Q-ZETA | 参照場での性能・noop比較・安全性を判定する内部資格。Q01/Q02 は条件4（revertゼロ）FAIL。条件5/6の欠測を、他条件と一緒に「全部PASS」にしない | [doc] [Q-ZETA-01-RESULT-2026-10-05.md](Q-ZETA-01-RESULT-2026-10-05.md)、[Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md](Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md) |
| C+E | 固定版 r2 を条件付き候補 S_cond として確保し、追加資格走・新候補・AI性能研究を止める。免除は内部の「条件4を含む資格PASSが入口」という要件だけ。G0・規約・P60・G3・G4は免除しない | [doc] [C-EXCEPTION-01-2026-10-06.md](C-EXCEPTION-01-2026-10-06.md) |
| 例外の継承 | 互換性だけの PR8 は本人Goで例外継承。通常、戦略・prompt・sizing変更で失効。その後 promptだけ変更した r3 は、別途本人判断により例外継承。自動継承ではない | [doc] [C-EXCEPTION-01-2026-10-06.md](C-EXCEPTION-01-2026-10-06.md) §8; [supervisor] supervisor-supplied `/tmp/retro-extra-facts.md` |
| G3 | revision ON/OFF、場・局面・故障・状態引継ぎを含む安全性と実行証跡。設計46世界、実走recorder等が未整備。fixtureの検出PASSは安全性PASSではない。1診断世界は本体に数えない | [doc] [G3-DESIGN-ZETA-R2-2026-10-06.md](G3-DESIGN-ZETA-R2-2026-10-06.md)、[g3/chain/REVISION-AUDIT.md](g3/chain/REVISION-AUDIT.md)、[G3-DIAG-WORLD-2026-10-06.md](G3-DIAG-WORLD-2026-10-06.md) |
| P60 | 最終候補・適用版・公式公開60世界・revision条件を固定した受入れ。seed 101/202/303/404/505（202は既使用）。62001–5の frozen リハーサルは代替ではない | [doc] [RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md)、[RESULTS-P60REH-MIXED-2026-10-06.md](RESULTS-P60REH-MIXED-2026-10-06.md) |
| G4 / 受理 | final commit・ZIP・設定・証跡の一致、提出経路・本人確認、受理メール/hashの照合。selftest成功だけでは閉じない | [doc] [RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md)、[ascon-notes/submission-checklist.md](../submission-checklist.md) |
| 役割 | Codex主導、Claude統括、agy補助。技術判断・実装・監視と、本人に残る提出/費用/例外判断を分離 | [doc] [MASTER-PLAN-2026-10-04.md](MASTER-PLAN-2026-10-04.md); [supervisor] supervisor-supplied `/tmp/retro-extra-facts.md` |
| 権限 | 10/6のClaude L2はPR作成・review・CI・merge-commit mergeまで。main直push、force push、PR close、鍵/支払い/運営フォームは本人判断。本稿作成の指示は別途 **commit/push禁止** | [supervisor] supervisor-supplied `/tmp/retro-extra-facts.md`; [inferred] 今回の作業制約を優先 |

[doc] 現在の条件付き候補 r3 の記録hashは `a03da51869cf8c8160aaa25eb5f1e87cfa74a3a9dfdac3050945a71f7d143dff`。これはファイル群の記録hashであり、受理済みZIPを意味しない。出典: [C-EXCEPTION-01-2026-10-06.md](C-EXCEPTION-01-2026-10-06.md)、[RELEASE-CHECKS-ZETA-R3-2026-10-06.md](RELEASE-CHECKS-ZETA-R3-2026-10-06.md)。

## 2. 時系列の設計と実施

| フェーズ | 設計・仮説 → 実施・結果 → 意味 | 出典 |
|---|---|---|
| 初期分析・観測 | noopとの差を起点に alpha/venue/clean/multi を比較。calm/101ではmultiが強かったが、単一世界。cleanの保守的二重ゲート、multiの取引機会、清算/償還/SP/launchの役割を分析。公開場のbid観測は競争の存在を示すに留まる | [doc] [ascon-notes/analysis-multi-arb.md](../analysis-multi-arb.md)、[analysis-clean-arb.md](../analysis-clean-arb.md)、[analysis-specialists.md](../analysis-specialists.md)、[field-observation-2026-10-03.md](../field-observation-2026-10-03.md) |
| delta→epsilon→zeta | multi由来の裁定に実行quote・状態、Liquity/launch、適応bidを統合。30 paired worldsでzetaはmulti比P差+790、CI[342.5,1268.8]、25/30勝ち。ただしepsilonとの差CIは0を含み、launch/spikeは各1seed | [doc] [INC-ZETA-ORIGIN-2026-10-05.md](INC-ZETA-ORIGIN-2026-10-05.md)、[ascon-notes/eval/iso-compare-seeds101-103.md](../eval/iso-compare-seeds101-103.md) |
| 初期リーグ R1 | 6生成候補＋参照＋inc、36世界。incのT59.68が優位。ただしlaunch/201は361loopsでG0不合格、開始hashも欠測。「全362」「除外0」は完全性の証明でなかった | [doc] [RETRO-R1.md](RETRO-R1.md)、[ledger.md](ledger.md) |
| upstream更新→u1 | 評価の自サイズ価格・開始価値・seed stream・launch codehash等が変更。同じseed整数でも世界同一でない。p5 u1は36世界中21FAIL/1BLOCKED/14PASS。速度短縮を先行させた負荷校正の範囲不足 | [doc] [UPSTREAM-EVAL.md](UPSTREAM-EVAL.md)、[RETRO-U1.md](RETRO-U1.md)、[SPEEDUP-POLICY.md](SPEEDUP-POLICY.md) |
| u1m / zeta2 | p3再走は全362loopsでも開始manifest欠測等でG0 BLOCKED。venue54.48、opus54.33、inc53.70、zeta2 40.42。zeta2は手数料後の利益でbidを決める一方、経路選択がraw gapのまま。ゼロbid・遅着・revertが増えた | [doc] [report-u1m.md](report-u1m.md)、[RETRO-U1.md](RETRO-U1.md)、[ZETA2-REGRESSION.md](ZETA2-REGRESSION.md) |
| V2 設計と生成の検証 | 参照コピー案から「独自戦略」へ。A/BIDの2×2＋SIZ/INV/MOD/GATEを計画。M1は4モデル×2brief×2回=16仕様を匿名比較、6機構・重複14・fair-arb外の新機構0。M2の性能比較まで終えた証拠はない | [doc] [PLAN-MASA-ASCON-V2.md](PLAN-MASA-ASCON-V2.md)、[m1/M1-RESULT.md](m1/M1-RESULT.md)、[STRATEGY-CARDS-U1.md](STRATEGY-CARDS-U1.md) |
| sonnet/opus資格→xb-r | sonnet Q0は60世界G0 PASS・revert0だがT44.56対56.50。opus Q0bもT48.07対56.43、2世界G0 FAIL。単なるbid不足ではなく機会制限・在庫復元・carryを疑い、xb-rを再設計 | [doc] [MASTER-PLAN-2026-10-04.md](MASTER-PLAN-2026-10-04.md)、[DESIGN-REPAIR-01-astra.md](DESIGN-REPAIR-01-astra.md) |
| xb-r dev1→5 / xa1 | dev1はoracle由来6gweiを競合bidと誤認し0取引。修正後も参照場で劣勢。dev3全24世界T48.42→dev4 49.72→dev5 50.15、いずれも相手が上。xa1の復元ループは修理後も取引不足で退役。安全化だけでは収益を取り戻せなかった | [doc] [XB-R-DEV1-DEBUG-2026-10-04.md](XB-R-DEV1-DEBUG-2026-10-04.md)、[DEV3-XB-R-V4-PREP.md](DEV3-XB-R-V4-PREP.md)、[DEV4-XB-R-V5.md](DEV4-XB-R-V5.md)、[XA-1-DEV7-REPAIR-2.md](XA-1-DEV7-REPAIR-2.md)、[MASTER-PLAN-2026-10-04.md](MASTER-PLAN-2026-10-04.md) |
| AI層とlive pilot | 検証済みpolicy選択/ENTRY限定案はstock executor置換へのadapter未実装。自由改訂pilotは32世界でONのTがOFFを3回とも下回りSTOP。v2 promptでもslippage 80→100が採用され、説明に経済的誤読があった | [doc] [DESIGN-AI-LAYER-01-astra.md](DESIGN-AI-LAYER-01-astra.md)、[XB-R-AI-PILOT-2026-10-04.md](XB-R-AI-PILOT-2026-10-04.md)、[XB-R-LIVE-PILOT-2026-10-04.md](XB-R-LIVE-PILOT-2026-10-04.md)、[XB-R-LIVE-PROMPT-V2-2026-10-05.md](XB-R-LIVE-PROMPT-V2-2026-10-05.md) |
| mix1/mix2→inc再評価 | xb-rは混成場でもincに及ばず。mix1+2の48世界でinc58.26、venue53.71、xb51.91（1BLOCKEDを含む）。incのF_ref 12世界はT56.30だが4世界でnoop負け。強さと無損失は別 | [doc] [INC-ZETA-DIAGNOSIS-2026-10-05.md](INC-ZETA-DIAGNOSIS-2026-10-05.md)、[MASTER-PLAN-2026-10-04.md](MASTER-PLAN-2026-10-04.md) |
| r / Q-ZETA-01 | incを環境依存なしに固定したr。60世界G0 PASS、T55.75対44.23、全レジームnoop差正だが11revert/9世界で条件4FAIL。launch approvalが共有router allowanceを上書きする問題等を診断 | [doc] [Q-ZETA-01.md](Q-ZETA-01.md)、[Q-ZETA-01-RESULT-2026-10-05.md](Q-ZETA-01-RESULT-2026-10-05.md)、[Q-ZETA-01-REVERT-DIAGNOSIS-2026-10-05.md](Q-ZETA-01-REVERT-DIAGNOSIS-2026-10-05.md) |
| r2診断 / Q-ZETA-02 | 最終修理はlaunch allowance、独立資金、自己wrap分だけ回収。競合bid skip案は取引を止めすぎて撤回。zr3–6診断48世界4revert、Q02の60世界8revert。性能T58.91対42.34でも条件4FAIL、条件5/6BLOCKED | [doc] [Q-ZETA-02.md](Q-ZETA-02.md)、[ZR34-REVERT-ANALYSIS-2026-10-06.md](ZR34-REVERT-ANALYSIS-2026-10-06.md)、[Q-ZETA-02-RESULT-2026-10-06.md](Q-ZETA-02-RESULT-2026-10-06.md)、[Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md](Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md) |
| C+E / release事前確認 | ゼロrevert追求を無制限に続けず条件付き候補を固定。r2 selftestと互換修正後の事前確認を実施。ただしDocker selftestの11包含/0revertは資格・本番提出の証拠にならない | [doc] [OPTIONS-AFTER-QZETA02-2026-10-06.md](OPTIONS-AFTER-QZETA02-2026-10-06.md)、[C-EXCEPTION-01-2026-10-06.md](C-EXCEPTION-01-2026-10-06.md)、[SELFTEST-ZETA-R2-2026-10-06.md](SELFTEST-ZETA-R2-2026-10-06.md) |
| G3事前診断→r3 | stale dumpで初回起動拒否、更新して1世界。Haikuは4回decline/1invalid/1unfinished、改訂採用0。stock runtimeに経済ガードがないことを確認し、candidate側で包めないためprompt抑止のr3へ。本人が例外継承 | [doc] [G3-DIAG-WORLD-2026-10-06.md](G3-DIAG-WORLD-2026-10-06.md)、[ZETA-R3-GUARD-2026-10-06.md](ZETA-R3-GUARD-2026-10-06.md); [supervisor] supervisor-supplied `/tmp/retro-extra-facts.md` |
| r3 release→P60リハーサル | r3はr2と4コードファイル同一、prompt変更。事前checks/selftest PASS。miniのfrozen 60世界G0 PASS、T58.82対43.42、noop負け5/60・revert平均0.2/世界。集計script Tracebackは別問題として残る | [doc] [RELEASE-CHECKS-ZETA-R3-2026-10-06.md](RELEASE-CHECKS-ZETA-R3-2026-10-06.md)、[RESULTS-P60REH-MIXED-2026-10-06.md](RESULTS-P60REH-MIXED-2026-10-06.md) |
| 混成場→r3x診断 | 混成36世界ではinc57.42で1位、r3 50.65で7位、r3は19/36noop負け。7世界G0 FAILを含む。修理2を外すr3xを新seedの3局面で対照比較すると全て悪化 | [doc] [RESULTS-P60REH-MIXED-2026-10-06.md](RESULTS-P60REH-MIXED-2026-10-06.md)、[R3-VS-INCZETA-2026-10-06.md](R3-VS-INCZETA-2026-10-06.md); [supervisor] supervisor-supplied [r3x集計](results-2026-10-06/r3x-experiment.txt) |

[inferred] 設計の重心は「多数案の探索」→「測定を信頼できる形にする」→「取引機会と安全化の両立」→「条件付き候補を確保して受入れ証拠を揃える」へ移った。後から悪い結果が出たことを理由に、過去の停止判断や例外を自動解除してはいけない。

## 3. 仮説台帳

[inferred] 「仮説」は当時の狙いを本稿で検証可能な文にしたもの。根拠・結果は出典記号付き、判定と次の一手は全行 `[inferred]`。次の一手は**提案であり実行許可ではない**。特に新候補・追加資格走・AI性能研究はC+Eの停止範囲にある。

### 3.1 戦略・経済設計

| ID | 仮説 | 根拠・検証方法 | 結果 | 判定 | 次の一手 |
|---|---|---|---|---|---|
| H01 | 独自inc-zeta系は参照戦略より強い | [doc] multi→delta→epsilon→zetaの段階比較、30 paired worlds。[origin](INC-ZETA-ORIGIN-2026-10-05.md)、[iso比較](../eval/iso-compare-seeds101-103.md) | multi比P+790、25/30勝ち。ただしepsilon比は未決。R1・Q・混成でも強い局面がある | supported（特定比較） | 未使用seed・同一場・同一版で最悪レジームも比較。普遍的優位とは呼ばない |
| H02 | F_refで強いr3は混成場でも上位 | [doc] mini F_ref60とAir混成36。[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md) | T58.82→50.65、混成7位、noop負け19/36。ただしhost/seed/μσも変化、7G0FAIL | refuted（今回の上位という予想） | 混成場の同条件対照とG0を揃える。場だけの因果効果は未決 |
| H03 | 場によって相対的な強さが逆転する | [doc] F_refでr3がmultiを上回る一方、混成ではinc/venue等がr3より上。[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md)、[u1m](report-u1m.md) | 順位・P−noopは場/版/seedで大きく異なる。旧R1ではmulti弱、初期calmでは強かった | supported（観測上の非安定性） | rosterだけを変えたpaired設計。現在の比較だけでは「相手が原因」と断定不可 |
| H04 | 取引機会の多いmulti設計がalphaより有利 | [doc] calm/101のalpha10取引等とmultiの比較。[analysis-multi](../analysis-multi-arb.md) | 初期世界ではmulti P+267、alpha−120。別リーグではmulti最下位級 | supported（初期世界のみ） | 回数ではなく終了P・機会別edge/carryを分解 |
| H05 | cleanの二重保守ゲートを緩めれば改善 | [doc] quote価格判定とmidGap条件が重複。[analysis-clean](../analysis-clean-arb.md) | 閾値/サイズの記述が版で異なる。分析時点で変更後backtest未実施 | untested | hash付き単一因子比較。50/60bp、1–5%/2.5–25%を同一版の設定として混ぜない |
| H06 | specialist追加で裁定の弱点を補える | [doc] SP/償還/launch、Aave被清算情報欠落、run形式制約。[analysis-specialists](../analysis-specialists.md)、[cards](STRATEGY-CARDS-U1.md) | 組込みは実施。モジュール数だけでは優位にならず、opusの復元損失を補えなかった | inconclusive | module ON/OFFと終端資産を分解。exploit scanner/atomic contract等の案は実証済み扱いにしない |
| H07 | zeta2の手数料考慮・低bid化は経済改善 | [doc] u1m比較と静的/約定診断。[ZETA2-REGRESSION](ZETA2-REGRESSION.md) | inc比T−13.28、CI[−17.81,−8.80]。bid0は2035/4986、revert239中230がbid0 | refuted（実装全体） | 経路選択とbidの利益定義を一致させる。相関だけでbid単独の因果効果を確定しない |
| H08 | ゼロbidを消せばzeta2を直せる | [doc] D0のa/c比較。[MASTER](MASTER-PLAN-2026-10-04.md) | zeta2aはbid0を消してもP−noop−244.6、cは+289.1。各8世界でinc側G0FAILもある | refuted（十分条件） | 合法資金・機会選択・carryを別因子として扱う |
| H09 | 高いbidが強さの主要原因 | [doc] R1 fee相関、xb機会再構成。[RETRO-R1](RETRO-R1.md)、[DESIGN-REPAIR](DESIGN-REPAIR-01-astra.md) | fee/T相関0.510はinc除外で−0.013。sonnetは先着/高bidでも劣勢 | refuted（単一説明） | gas、機会欠落、inventoryを分ける |
| H10 | r3とincの差は通常裁定の入札パラメータ | [doc] bidMode2/share3000bps/gas140000と式を比較。[R3-VS-INCZETA](R3-VS-INCZETA-2026-10-06.md) | 通常deltaの設定は同じ。違うのは修理・分岐・状態経路。解析HEADと実測HEADのmanifest同一性は未監査 | refuted（静的パラメータ差） | 実際に選ばれたactionと実現tipを比較。同じ設定でも同じ注文にはならない |
| H11 | V2の入口/size/bid/inventory/module/shock gateが改善源 | [doc] A/BID 2×2とV4–V7の計画。[PLAN-V2](PLAN-MASA-ASCON-V2.md) | 全因子を切り分けた予定96世界の完了証拠なし。後続xbは複数変更を含む | untested（因子別） | 採用判断が必要な因子だけ、事前固定の最小対照へ |
| H12 | xb-rは機会抑制を直せば合格水準になる | [doc] dev1→5。[XB-DEV1](XB-R-DEV1-DEBUG-2026-10-04.md)、[DEV2](DEV2-XB-R-REPAIR.md)、[DEV3A](DEV3A-XB-R-REPAIR.md)、[DEV4](DEV4-XB-R-V5.md) | dev1誤認修正で0取引は解消。dev4のinventory block94.65%、dev5でもT50.15対55.73 | refuted（これまでの修理で十分） | incremental調整の継続より機会/在庫設計の可否判断 |
| H13 | 在庫carryが裁定edgeを相殺する | [doc] E+M−G+残差、markoutとcarry分解。[PLATEAU](PLATEAU-ANALYSIS-2026-10-04.md)、[DESIGN-REPAIR](DESIGN-REPAIR-01-astra.md) | 複数候補でcarryが支配的。carryを取り除く反実仮想は利益改善を示すが実行可能戦略ではない | supported（会計上の説明） | 終了在庫を減らす実行可能な出口を測る。単なるPの補正は禁止 |
| H14 | xa1の時間制限往復ならcarryを減らせる | [doc] dev6/7/修理2のsmoke。[XA-1](XA-1-DEV7-REPAIR-2.md)、[MASTER](MASTER-PLAN-2026-10-04.md) | missing roundでBLOCKED、次は264/362復元モード、修理後も10送信で閾値30未達。2修理後に退役 | refuted（試した実装の健全性） | 新設計には別予算/許可が必要。完全matrix成功と記載しない |
| H15 | 参照コピーでもよい／独自性を満たすか | [doc] V2方針変更とMIT由来系譜。[PLAN-V2](PLAN-MASA-ASCON-V2.md)、[origin](INC-ZETA-ORIGIN-2026-10-05.md) | 本人は独自戦略を選択しinc系の由来を条件付き了承。運営による独自性認定ではない | inconclusive（外部認定） | 提出文に由来・独自差分を明示。ユーザー方針と規約審査を分離 |

### 3.2 revert・修理・AI改訂

| ID | 仮説 | 根拠・検証方法 | 結果 | 判定 | 次の一手 |
|---|---|---|---|---|---|
| H16 | 活発な戦略でもrevertゼロ基準は達成可能 | [doc] sonnet0/68、xb0/98の過去集計とQ01/Q02。[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) | 観測ゼロの候補は存在するが競争性能不足。r/r2は不合格 | supported（有限試験での達成可能性） | 「ゼロは不可能」とも「将来もゼロ」とも言わない。性能と同時達成は未決 |
| H17 | r2で60世界ゼロrevertを満たす | [doc] zr3–6診断48とQ02の60。[Q02結果](Q-ZETA-02-RESULT-2026-10-06.md)、[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) | 4/48世界、8/60世界でrevert。条件4FAIL | refuted | 条件付き扱いを維持。追加資格走は停止中 |
| H18 | launch allowance修理が共有router失敗を減らす | [doc] 不足時approve単独、十分ならskip、次回swap。[Q01診断](Q-ZETA-01-REVERT-DIAGNOSIS-2026-10-05.md)、[Q02](Q-ZETA-02.md) | 上書き経路への修正は説明可能。ただし最終r2には他修理も入り、Q02に160送信失敗・8revertが残る | supported（欠陥への対処）、inconclusive（独立効果量） | allowance前後とspender/actionの完全記録で切分け |
| H19 | 独立資金確認で片脚リスクを抑える | [doc] sell資金不足ならbuy-only、decimals/dust考慮。[Q02](Q-ZETA-02.md)、[R3-VS-INCZETA](R3-VS-INCZETA-2026-10-06.md) | 旧SDKはbuy売上を後段に充当するため「旧bundleは常に未資金」は誤り。buy-onlyはinventory/分岐も変える | inconclusive（安全性と一般収益の両立） | 両脚成否・残在庫・carryをpairedで追う。bundleは原子的でない |
| H20 | 回収対象を自分のwrap分だけに限定すると無関係な在庫売却を防ぐ | [doc] confirmed wrapped WETHだけ、残高とのmin。[Q02](Q-ZETA-02.md)、[R3-VS-INCZETA](R3-VS-INCZETA-2026-10-06.md) | 静的な対象限定はできた。pending/quote/bid/noopで回収分岐に留まり通常裁定を抑える可能性が残る | supported（対象限定）、inconclusive（経済効果） | 復元モード滞在・取り逃し機会を記録 |
| H21 | 修理2を無効化したr3xならr3より改善 | [supervisor] supervisor-supplied [r3x集計](results-2026-10-06/r3x-experiment.txt)。同seed64001、同10相手＋noop、3局面×2候補 | 全3局面でP−noopと簡易Tが悪化。平均T66.28→58.49 | refuted（この3対） | 直ちに修理2を戻さない。一般化せず、必要なら生ログで機序を確認 |
| H22 | 競合bidを超えられない取引をskipすれば安全で有利 | [doc] 初期zr2と最終r2の区別。[Q02](Q-ZETA-02.md)、[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) | 初期案は12世界35包含（約2.9/世界）に抑制し撤回。最終「3修理」は当初番号1/2/4 | refuted（試したskip案） | ゼロrevertだけを目的に全取引を消さない |
| H23 | adverse flow / quote劣化がrevert原因で、slippage拡大で直る | [doc] Q01全11件0.1gwei・次block包含、zr34の151bp例。[Q01診断](Q-ZETA-01-REVERT-DIAGNOSIS-2026-10-05.md)、[ZR34](ZR34-REVERT-ANALYSIS-2026-10-06.md) | 候補原因として整合するがraw reason/gas不足でOOG等を排除できない。許容拡大の利益は未証明 | inconclusive | trace/receipt/quote時点を揃える。エラー分類と原因確定を区別 |
| H24 | approval_failedはon-chain approveそのものの失敗 | [doc] 29件、260pair調査と23max allowance、20送信の包含。[analysis-approval](../analysis-approval-failed.md) | ラベルは誤解を招く。確認RPCの正確な失敗原因は未確定。BAL507等も別問題 | refuted（ラベルの直訳） | transport/確認/送信/採掘を別々に記録 |
| H25 | AI改訂で性能が上がる | [doc] xb-live OFF8＋ON8×3。[LIVE-PILOT](XB-R-LIVE-PILOT-2026-10-04.md)、[MASTER](MASTER-PLAN-2026-10-04.md) | T差−5.83/−1.93/−1.11。P−noop差は−229.4/−26.9/+178.7でTと一致しない。pilot STOP | refuted（当該pilot）、inconclusive（AI一般） | 現在は性能研究停止。再開には目的・予算・安全境界を再決定 |
| H26 | 強いpromptで危険な変更を抑止できる | [doc] v2でもWBTC slip80→100採用。[LIVE-PROMPT-V2](XB-R-LIVE-PROMPT-V2-2026-10-05.md)、[ZETA-R3-GUARD](ZETA-R3-GUARD-2026-10-06.md) | promptは強制境界でない。r3のnull推奨prompt自体は実改訂採用を含むG3未検証 | refuted（強制保証）、untested（r3の実効性） | r3 revision ONで採否・理由・行動を記録する受入れ設計 |
| H27 | Haikuが改訂を見送ったので安全 | [doc] 1世界6開始/5応答、4decline/1invalid/1unfinished、採用0。[G3-DIAG](G3-DIAG-WORLD-2026-10-06.md) | 危険な改訂の採用後挙動を一度も試していない。監査recorder不足でBLOCKED | refuted（安全の証明） | declineを安全性証明にしない。Haiku proxyと本番providerの同等性も未確認 |
| H28 | runtimeに経済ガードがある／candidateで追加できる | [doc] executor置換経路、過大支出/76bp fixture。[ZETA-R3-GUARD](ZETA-R3-GUARD-2026-10-06.md)、[g3/README](g3/README.md) | 元candidateのclosureを迂回し直接executorを採用。検出器は危険を検出したがruntimeは経済条件を強制しない | refuted（現stock経路） | runtime無改変の前提を維持し、残余リスクを本人判断。null応答は既採用の危険版を元へ戻さない |
| H29 | 限定policy切替AIなら安全かつ有益 | [doc] 3policyとENTRY20–60/±5、fallback120blocks。[DESIGN-AI](DESIGN-AI-LAYER-01-astra.md)、[AI-PILOT](AI-PILOT-DESIGN-2026-10-04.md)、[XB-AI](XB-R-AI-PILOT-2026-10-04.md) | stockへのadapter未実装。agyの形式fixtureは接続・経済効果・実改訂の証明ではない | untested | 既存研究停止を尊重。合成format成功をON測定と呼ばない |
| H30 | 複数モデル/良いfeedbackで独自で強い案が増える | [doc] M1匿名16仕様、M2計画。[m1結果](m1/M1-RESULT.md)、[PLAN-V2](PLAN-MASA-ASCON-V2.md)、[XB-R-AI-AGY](XB-R-AI-AGY-2026-10-04.md) | M1は機構6・重複14・fair-arb外の新機構0。性能のモデル効果/feedback効果は未測定 | inconclusive | モデル名ではなく実装機構と対照成績で判断。M2を実施済みにしない |

### 3.3 測定・運用・提出の仮説

| ID | 仮説 | 根拠・検証方法 | 結果 | 判定 | 次の一手 |
|---|---|---|---|---|---|
| H31 | p5/p6で意味を変えず高速化できる | [doc] p3→p5負荷比較。[SPEEDUP](SPEEDUP-POLICY.md)、[RETRO-U1](RETRO-U1.md) | 8体calmの校正では12体/全局面を保証できず、u1 p5は21FAIL。倍速/短縮は採用せず | refuted（今回p5の一般化） | 完全roster/同局面で校正。速度よりG0を優先 |
| H32 | Airのloops359–361は同時負荷が原因 | [supervisor] supervisor-supplied `/tmp/retro-extra-facts.md`: 別作業中にAirで発生、miniにはなし | 同時発生のみ。host/roster/seedも違う対照で、因果は分離できない | inconclusive | hostを占有し同一入力の負荷あり/なし対照、時系列CPU/pressureとcatch-upを保存 |
| H33 | upstream変更後もstate dumpは更新不要 | [doc] LQTYStaking=0で診断開始拒否、再生成後起動。[G3-DIAG](G3-DIAG-WORLD-2026-10-06.md)、[UPSTREAM-EVAL](UPSTREAM-EVAL.md)、[OPS](OPS-LESSONS-2026-10-06.md) | 旧dump継続の一般ルールは反証。単にHEAD更新のたび必須とも限らない | refuted（常に不要） | generator/契約/設定互換性とdump hash・deploymentを照合 |
| H34 | 今の簡易Tは公式最終Tと一致する | [doc] 後半重み・母集団の差。[competition-start](../../docs/competition-start.en.md)、[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md); [supervisor] supervisor-supplied r3x | 旧リーグ/Qはnoop除外、最新混成/r3xはnoop込み12体・等重み。公式との完全一致は示していない | refuted（無条件の一致） | 同じordered P/採点対象/重み/σ=0条件で公式scorerと照合 |
| H35 | 高いbootstrap順位確率は大会勝率 | [doc] u1mのopus1位68.7%/top3 100%。[report-u1m](report-u1m.md) | 生成候補内・観測36世界の条件付き再標本化。参照除外、G0欠測、未知相手を扱わない | refuted | CIと対象集合を併記。CIが0を含むことも同等性証明にしない |
| H36 | frozenリハーサル/selftestで提出準備完了 | [doc] selftest11包含0revert、P60reh、未完G3/G4。[RELEASE-CHECKS](RELEASE-CHECKS-ZETA-R3-2026-10-06.md)、[RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) | 一部の実行/梱包確認のみ。公式60、revision ON、安全監査、最終受理が残る | refuted | 各ゲートを別状態で閉じる |
| H37 | G0 PASSならraw資産/全actionの安全を証明できる | [doc] Q02全G0PASSとC56欠測、G3監査仕様。[C56](Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md)、[REVISION-AUDIT](g3/chain/REVISION-AUDIT.md) | raw receipts/実残高/allowance/gas/end ledger欠測。115件未解決は損失確定115件でもない | refuted | 取れる証拠の範囲を限定して開示。BLOCKEDをPASSに置換しない |
| H38 | プロセス開始・launcher rc=0なら測定完了 | [doc] 監視空白・end markerの対策。[OPS](OPS-LESSONS-2026-10-06.md) | background起動とCHAIN_END/終端rcは別。fixture成功だけでは実運用完了を保証しない | refuted | 固有label、end marker、rc、G0を同時確認 |
| H39 | M1の防御機構が独立した利益改善を生む | [doc] D競合bid未達skip、E余剰WETH掃出し条件化、A事後markout、B価格経路/在庫抑制、F片脚在庫隔離、G初期在庫へのGMX hedge。[M1結果](m1/M1-RESULT.md) | 仕様分類であり、6機構を実装して対照比較した結果ではない。約定復元/買戻し/費用/単一因子性に未解決点 | untested（機構別の効果） | 特にF/Gの新規性と品質を混同しない。既存修理と同型のD/Eを新しい利益源と数えない |
| H40 | テスト緑なら設計した因子と安全境界が働く | [doc] xb-coreレビューの$0.5利益床、正利益でbid0、base fee抜け、弱いassert。[GROK-XB](GROK-REVIEW-XB-CORE.md) | 57testが緑でも20–30bp帯のA因子が消える反例等を検出。静的/最小再現のレビュー記録 | refuted | 因子固有の境界値と危険入力の反例を使う。過去指摘を現r3の未修正欠陥と読み替えない |
| H41 | xbのbundle余地・size・待機時間の調整で性能/失敗を改善できる | [doc] R9 bundle headroom、R10 full-depth size、R11単脚cap縮小、R12未確認backoff、R7/ENTRYの条件付き試験案。[DEV3-V4-PREP](DEV3-XB-R-V4-PREP.md)、[DEV4-V5](DEV4-XB-R-V5.md) | R9を試したdev5は昇格せず。他因子は固定フレーム再構成/条件案で、動的P/Tの実証ではない | refuted（R9の昇格）、untested（残る因子の実効） | 静的追加判断数を追加約定/利益に換算しない。複数因子の予測効果を加算しない |
| H42 | cdpで負ける主因はLiquity不足、opusの大量revertもLiquity由来 | [doc] dev3のmultiは専門取引0、cdp差はcarry優位。opusの741revertはbundle/spot/raw等、Liquity購入19・償還19・清算5は成功。[DEV3-V4-PREP](DEV3-XB-R-V4-PREP.md) | specialist欠如だけの説明、741件をLiquityの失敗率とする説明は支持されない | refuted（当該原因説） | モジュール別action/receiptと会計を結ぶ。少数の成功を将来安全へ一般化しない |

### 3.4 r3xの反証を数字で残す

[supervisor] **supervisor-supplied**: Air / eval2 diagnostic branch `77c6ead`（main `8c29964`＋local-only r3x）、10固定相手＋noop＋候補、seed64001、chain-template実走、6世界すべてG0 PASS / 362loops。r3xは `delta.ts` のsell資金不足時buy-only分岐を外してalways bundleにした版。Tは**各世界12体の等重み簡易T**。出典: [r3x-experiment.txt](results-2026-10-06/r3x-experiment.txt)。

| regime | r3 P−noop / T | r3x P−noop / T | r3x−r3 P−noop / T | 根拠 |
|---|---:|---:|---:|---|
| whale | 972.3 / 58.2 | 404.3 / 48.8 | −568.0 / −9.4 | [supervisor] supervisor-supplied 集計; 差は[inferred]算術 |
| lending-incident | 3266.4 / 79.9 | 2079.0 / 70.0 | −1187.4 / −9.9 | [supervisor] supervisor-supplied 集計; 差は[inferred]算術 |
| crash | 1723.8 / 60.7 | 1169.5 / 56.7 | −554.3 / −4.0 | [supervisor] supervisor-supplied 集計; 差は[inferred]算術 |
| 平均T | 66.28 | 58.49 | −7.79 | [supervisor] supervisor-supplied 集計の平均; 差は[inferred]算術 |

[inferred] 結果は「修理2を外すだけで良くなる」という予測をこの3対で反証する。ただし単一seed・選択された3レジームなので、全12レジームの優劣、revert率、安全性まで決まらない。表の小数1桁から計算した平均と、提供された平均66.28/58.49の丸め差は再計算で上書きしていない。

[supervisor] **supervisor-supplied** の補足にある「新seedでr3 T66.3」は3局面の**平均**。whale/lending/crashの各Tがすべて66.3だったという意味ではない。以前の36世界の局面平均65.2/37.2/45.4と、新seedの58.2/79.9/60.7は条件付きの比較である。出典: `/tmp/retro-extra-facts.md`、[r3x集計](results-2026-10-06/r3x-experiment.txt)、[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md)。

## 4. 測定一覧と妥当性

[inferred] Nは原則「世界の実行数」であり、独立seed数でもagent-world数でもない。ON/OFFや候補違いの再実行は別世界として数えるが独立標本が増えたとはしない。host/G0が保存文書から確定しない箇所は「未確認」とする。

[doc] 場の略称: **F_ref** はnoop＋multi-arb＋clean-arb＋候補（計4体、Qの採点母集団はnoop除外3体）。旧リーグR1は計11体/採点10体、u1/u1mは計12体/採点11体。最新混成とr3xは10固定相手＋noop＋候補の計12体で、提供簡易Tはnoopを含む。設計上のG3 F_mixは固定5gwei役等を要求し、今回の混成rosterをそのままG3適格F_mixと認定していない。出典: [RETRO-R1.md](RETRO-R1.md)、[report-u1m.md](report-u1m.md)、[Q-ZETA-02.md](Q-ZETA-02.md)、[RESULTS-P60REH-MIXED-2026-10-06.md](RESULTS-P60REH-MIXED-2026-10-06.md)、[g3/README.md](g3/README.md)。

[inferred] 下表の **T等** は各文書のT式/等重み集計で、公式のエポック順序・後半重みまで照合した最終Tではない。**T簡12** はnoopを含む12体の簡易T。**P** は損益または明記したP−noop。公式一致が未検証なものを「公式T」と呼ばない。

| 測定 | host / N / seed / 場 | G0・主要結果・指標 | 限界・出典 |
|---|---|---|---|
| 初期calm比較 | host未確認 / calm1世界の比較 / 101 / 参照比較 | G0未確認。P: noop−144、alpha−120、venue−17、clean+71、multi+267 | [doc] 単一世界、別runのalpha超過利益と混ぜない。[analysis-multi](../analysis-multi-arb.md) |
| iso比較 | host未確認 / 30 paired worlds / 101–103 / 4候補の比較設計 | G0未確認。zeta対multiのP差+790、25/30勝ち | [doc] launch/spike各1seed、不均衡。Tでない。[iso](../eval/iso-compare-seeds101-103.md) |
| R1 | Air p3 / 36 / 201–203×12 / 旧リーグ | launch201が361loops、開始hash欠測。T等 inc59.68、venue49.46 | [doc] 結果は歴史的診断、選抜の健全な36世界ではない。[RETRO-R1](RETRO-R1.md) |
| u1 | Air p5 / 36 / 201–203×12 / 新リーグ | 21FAIL/1BLOCKED/14PASS、環境p99約1.1–2.7秒 | [doc] 上流変更後、R1と同一seedでも世界同一でない。[RETRO-U1](RETRO-U1.md) |
| u1m（u1b/u1c） | Air p3 / 36 / 201–203×12 / 新リーグ | 362loops、p99≤233msでもG0 BLOCKED。T等 venue54.48、opus54.33、inc53.70、zeta2 40.42 | [doc] 開始manifestなし、grok whale202のinvalid-sizeにround欠測。[u1m](report-u1m.md)、[RETRO-U1](RETRO-U1.md) |
| D0 | Air / 各候補8、6候補 / 201/202×4局面 / F_ref | inc P−noop+78.9（実走中commitでG0FAIL）、zeta2−658.4、a−244.6、c+289.1、sonnet+261、opus+626.4/80revert | [doc] 選定・診断を含む、同じseedの反復。資格でない。[MASTER](MASTER-PLAN-2026-10-04.md) |
| sonnet Q0 | Air / 60 / 41001–41005×12 / F_ref | G0全PASS、T等44.56対multi56.50、全レジーム平均T−Tnoop正（最小+3.63）、noop負け2/60、revert0、submit_failed35 | [doc] 性能FAIL、旧安全欄nullを後日の件数監査で全面PASSにしない。[MASTER](MASTER-PLAN-2026-10-04.md)、[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) |
| opus Q0b | Air / 60 / 41101–41105×12 / F_ref | vuln41101/41103で361loops。T等48.07対56.43、noop負け6/60。59/60世界で計741revert | [doc] 高いPを示したD0を一般化できず、安全性も悪い。741=273+159+309。[MASTER](MASTER-PLAN-2026-10-04.md)、[OPTIONS付録A](OPTIONS-AFTER-QZETA02-2026-10-06.md) |
| xb dev1 | Air / 12 / 31001/31002×6 / F_ref | G0 PASS、取引0、P−noop0。競合oracle bidの誤認 | [doc] 固定tipの読み違い修正をfixtureで再現。[XB-DEV1](XB-R-DEV1-DEBUG-2026-10-04.md) |
| xb dev2 | Air / 12 / 同上 / F_ref | G0 PASS、T等44.36対56.84、P149対1352、revert0、全世界noop差正 | [doc] 活動復活≠競争力回復。[DEV2](DEV2-XB-R-REPAIR.md)、[MASTER](MASTER-PLAN-2026-10-04.md) |
| xb dev3a＋b | Air / 18＋6=24 / 35001/35002×12 / F_ref | G0 PASSとの引継ぎ、T等48.42対54.60、P599対1591。先行18世界だけなら46.83対55.93 | [doc] 部分18世界と全24世界を分ける。[DEV3A](DEV3A-XB-R-REPAIR.md)、[DEV3-V4-PREP](DEV3-XB-R-V4-PREP.md) |
| xb dev4 | Air / 24 / 36001/36002×12 / F_ref | G0 PASS、T等49.72対55.02、P488対1461、revert0、submit_failed23/1652submitted | [doc] 復元解析ではinventory block94.65%。[DEV4-V5](DEV4-XB-R-V5.md)、[MASTER](MASTER-PLAN-2026-10-04.md) |
| xb dev5 | Air / 24 / 同上 / F_ref | T等50.15対55.73、revert0を後日集計。全G0再認証は本稿未確認 | [doc] dev4s/36003、dev5s/36004は各1smokeとして別扱い。[MASTER](MASTER-PLAN-2026-10-04.md)、[OPTIONS付録A](OPTIONS-AFTER-QZETA02-2026-10-06.md) |
| xa1 dev6/7/修理2 | Air / 各1smoke / calm38003/38004/38005 / F_ref | 初回BLOCKED（round欠測）、次は復元264/362、最終G0 PASSでも10送信、healthy未達 | [doc] 後続全域試験の完了証拠なし。[XA-1](XA-1-DEV7-REPAIR-2.md)、[MASTER](MASTER-PLAN-2026-10-04.md) |
| AI format / smoke | agy合成fixture＋Air実走smoke / 39101/39102 / F_ref | 形式fixtureはliveではない。39101は採用0、39102は1採用（slip変更） | [doc] 本番provider・候補r3の受入れとは別。[XB-AI-AGY](XB-R-AI-AGY-2026-10-04.md)、[LIVE-PROMPT-V2](XB-R-LIVE-PROMPT-V2-2026-10-05.md) |
| xb-live main | Air / 8OFF＋8ON×3=32 / 39001/39002×calm/whale/crash/depeg-persist / F_ref | 全G0 PASS。T等OFF54.74、ON48.91/52.80/53.62、採用9/1/1 | [doc] 4局面、同seed反復。各ON最悪T差−19.75/−5.68/−4.50。[MASTER](MASTER-PLAN-2026-10-04.md)、[LIVE-PILOT](XB-R-LIVE-PILOT-2026-10-04.md) |
| mix1 | Air / 24 / 40001/40002×12 / xbを含む混成 | 23PASS/1BLOCKED（crash40001 grok telemetry）。T等 xb52.18、inc54.98、venue54.35 | [doc] 1BLOCKEDを隠さない。[MASTER](MASTER-PLAN-2026-10-04.md) |
| mix2 | Air / 24 / 40003/40004×12 / 同上 | 全G0 PASS。T等 xb51.63、inc61.54。48世界合算inc58.26、xb51.91 | [doc] 合算にはmix1 BLOCKEDも残る。[MASTER](MASTER-PLAN-2026-10-04.md) |
| incz | Air / 12 / 40005×12 / F_ref | G0 PASS、T等56.30対44.44、noop負け4/12、3revert | [doc] cex/informed/lending/vulnでnoop負け。独自性・強さ・無損失は別。[INC診断](INC-ZETA-DIAGNOSIS-2026-10-05.md)、[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) |
| Q-ZETA-01 / r | Air p3 / 60 / 46001–46005×12 / F_ref | 全G0 PASS。T等55.75対44.23、最小レジーム平均ΔTnoop+1.19、11revert/9世界 | [doc] chunk2がsleep込み約2.7hで110分契約逸脱、G0とは別。所要約5.8h。[Q01結果](Q-ZETA-01-RESULT-2026-10-05.md)、[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) |
| zr2旧variant | Air / 12 / 48001×12 / F_ref | 包含35、revert0。calm247blocks/248loopsで打切り、cex361loops | [doc] 最終r2と別版。後続48世界へ混ぜない。[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) |
| zr3–6 / r2診断 | Air / 12×4=48 / 48002/48003/48007/48008×12 / F_ref | T等60.17対41.64、最小レジーム平均ΔTnoop+2.07。revert0/2/0/2、包含計11405。zr3の4世界loops不良 | [doc] 独立seed4つ。zr4/6の2件ずつを全同原因とみなさない。[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md)、[ZR34](ZR34-REVERT-ANALYSIS-2026-10-06.md) |
| Q-ZETA-02 / r2 | Intel mini p3、Anvil1.2.3 / 60 / 47001–47005×12 / F_ref | 全G0 PASS、T等58.91対42.34、最小レジーム平均ΔTnoop+6.15。8revert/8世界。約4.4h | [doc] host違いでQ01との修理効果は非paired。条件4FAIL、5/6BLOCKED。[Q02結果](Q-ZETA-02-RESULT-2026-10-06.md)、[C56](Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md) |
| G3の1診断 | physical hostは本稿未確認 / 1 / calm49002 / F_ref、r2、Haiku ON、p1 | 360blocks/362loops、721.7秒、violations0、改訂採用0。netPnl: noop0/multi−414.9/clean88.4/r2 762.0 | [doc] netPnlは上表のP/Tと混ぜない。recorder欠測でaudit BLOCKED、G3計上0。[G3-DIAG](G3-DIAG-WORLD-2026-10-06.md) |
| r2/r3 selftest | Docker 2vCPU/4GB、ローカルbridge / 各1起動 / seed比較でない | 各11包含/0revert。r3 release check: strategy102、12関連test、CI full2337pass/9skipの記録 | [doc] 実行された住所表/bridgeの制約あり。同一ZIP・本番分離起動の全面証明でない。[SELFTEST](SELFTEST-ZETA-R2-2026-10-06.md)、[RELEASE-CHECKS](RELEASE-CHECKS-ZETA-R3-2026-10-06.md) |
| r3 P60リハーサル | mini / 60 / 62001–62005×12 / F_ref、FROZEN、main8c29964 | 全G0 PASSとの引継ぎ。T58.82対43.42、全レジームΔTnoop正、noop負け5/60、revert平均0.2/世界 | [doc] 公式seedでなく、正式重み照合なし。集計Tracebackあり、後続数値の提示とscript正常終了は別。[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md) |
| r3混成 | Air eval2 p3 / 36 / 63001–63003×12 / 12体、FROZEN、main8c29964 | T簡12: inc57.42、r3 50.65。**7G0 FAILを含む**、29世界と全36の成績を混同しない | [doc] 全36の診断集計。公式順位でもG0適格リーグ順位でもない。[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md) |
| r3/r3x | Air eval2（並列度未提示） / 6 / 64001×3局面×2候補 / 12体 | 全G0 PASS/362loopsとの提供情報。T簡12平均66.28対58.49 | [supervisor] supervisor-supplied [r3x集計](results-2026-10-06/r3x-experiment.txt)。生ログ独立監査なし、1seed。revision設定の実測証跡は未確認 |
| 最小G3本体 / 公式P60 / G4最終 | 計画: G3 p1 46世界、P60公開60世界、最終ZIP受入れ | **未完／BLOCKEDを維持**。G3は通常36＋fault7＋状態3。G3予定seed49001–3/49101/49102→49103→49102 | [doc] seed衝突、F_mix、自然改訂fixture、recorder等の不足。[G3-DESIGN](G3-DESIGN-ZETA-R2-2026-10-06.md)、[g3/chain/README](g3/chain/README.md)、[RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |

[doc] Q02の取引会計は **13,392 submitted = 13,367 included + 25未包含**、**13,367 included = 13,359成功 + 8revert**。別にsubmit_failed160（TooLittle58、Slippage20、BAL507 82）がある。世界別包含72–339では1revertでも0.1%を超える。160をincludedに足した比率をrevert率と呼ばない。C5/C6監査は60世界・候補21,660 observationsを再構成したが、未解決は82 BAL507＋8採掘revert＋25未包含=115件。2片脚事象は8件の内数で重複加算しない。出典: [Q-ZETA-02-RESULT-2026-10-06.md](Q-ZETA-02-RESULT-2026-10-06.md)、[Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md](Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md)。

[doc] 最新混成の7 G0 FAILは informed-flow/63001=361、crash/63001=360、vuln/63001=359、depeg-persist/63001=360・63002=359、cdp-incident/63001=361・63002=360 loops。全36世界のr3レジームT簡12は calm40.5 / cex60.7 / informed44.9 / whale65.2 / lending37.2 / crash45.4 / depeg63.0 / vuln54.6 / spike53.5 / depeg-persist46.0 / cdp47.1 / launch49.5。**depegもinc65.0に及ばない**。「平均で50付近」だけでは局面の弱さを隠す。出典: [RESULTS-P60REH-MIXED-2026-10-06.md](RESULTS-P60REH-MIXED-2026-10-06.md)。

[doc] OPTIONSの既存監査は41 labels / 435 F_ref実走世界 / 1,740 agent-worldを整理した。開発反復・smoke・ON/OFF・部分実行・G0不良を含み、435独立seedの証拠ではない。細かなlabel別件数の正は同文書付録A。本稿の世界数をさらに加えて「全独立試験数」としない。出典: [OPTIONS-AFTER-QZETA02-2026-10-06.md](OPTIONS-AFTER-QZETA02-2026-10-06.md)。

## 5. 分かっていること／分からないこと／過信してはいけない数字

| 区分 | 結論 | 根拠・留保 |
|---|---|---|
| 分かっている | inc系の性能根拠は残る。r/r2/r3はF_refでmultiより高いTを繰り返し示した | [doc] [Q01](Q-ZETA-01-RESULT-2026-10-05.md)、[Q02](Q-ZETA-02-RESULT-2026-10-06.md)、[P60reh](RESULTS-P60REH-MIXED-2026-10-06.md)。[inferred] 相手・版を固定した範囲の根拠 |
| 分かっている | r3は混成場で安定して強い候補だとはまだ言えない | [doc] 最新混成7位、P−noop+115.5、19/36負け、incは+621.7/13負け。[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md)。[inferred] FAIL混在でも無視すべきでない警告 |
| 分かっている | 修理2を外す単純rollbackは直近3対で悪化 | [supervisor] supervisor-supplied [r3x集計](results-2026-10-06/r3x-experiment.txt)。[inferred] 3対を全レジームの結論に拡張しない |
| 分かっている | 安全化が取引機会・在庫・carryを変える。bidだけの物語では説明不足 | [doc] [ZETA2](ZETA2-REGRESSION.md)、[PLATEAU](PLATEAU-ANALYSIS-2026-10-04.md)、[R3対INC](R3-VS-INCZETA-2026-10-06.md) |
| 分からない | r3の混成劣勢を3修理のどれが何割説明するか、最適な回収方針は何か | [doc] 同条件の因子別診断は限定的。[R3対INC](R3-VS-INCZETA-2026-10-06.md)。[inferred] branch滞在・両脚・gas・終了在庫の完全分解が必要 |
| 分からない | 将来の本番相手、適用版、実効model、providerとHaikuの同等性 | [doc] 公開練習場は本番の保証でない。[field-observation](../field-observation-2026-10-03.md)、[RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |
| 分からない | r3 promptの抑止率と、採用された改訂が最後まで安全か | [doc] [GUARD](ZETA-R3-GUARD-2026-10-06.md)、[G3-DIAG](G3-DIAG-WORLD-2026-10-06.md)。[inferred] Haiku採用0を肯定証拠にしない |
| 分からない | Airのloops欠落の因果、raw資金/未包含の帰結、全実消費時間、現在の受理状態 | [doc] [C56](Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md)、[dashboard](ASCON-DASHBOARD.html); [supervisor] supervisor-supplied 負荷補足。今回live確認なし |
| 過信禁止 | 60.17/58.91/58.82/57.42/50.65/66.28は同じ母集団の指標ではない | [doc] [OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md)、[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md); [supervisor] r3x。[inferred] 等重み/母集団/seed/hostを併記する |
| 過信禁止 | 0.5404%という「次60世界ゼロ」予測 | [doc] `(44/48)^60`、独立同分布仮定。Wilson区間を写した範囲は約0.000214%–13.4499%。独立seedは4個、レジーム別仮定なら0.3171%。[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md)。[inferred] 精密な未来確率でも絶対不可能の証明でもない |
| 過信禁止 | u1mの上位差、順位安定性、ゼロrevert観測、CI PASS | [doc] venue−inc+0.78のCI[−2.49,4.12]、G0 BLOCKED。selftestは少数実行。[u1m](report-u1m.md)、[RELEASE-CHECKS](RELEASE-CHECKS-ZETA-R3-2026-10-06.md)。[inferred] 同等性・大会勝率・将来ゼロ・本番安全を示さない |

[inferred] 現時点の一番強い結論は「r3を条件付き保険として保全する根拠はあるが、優勝候補としての頑健性と提出可能性を確証した段階ではない」。負の結果を消すのではなく、どの範囲で反証になったかを残す方が、次の予算配分を誤りにくい。

## 6. 失敗と教訓（process）

[doc] 基礎となる運用記録は [OPS-LESSONS-2026-10-06.md](OPS-LESSONS-2026-10-06.md)、[RETRO-2026-10-04-DAY.md](RETRO-2026-10-04-DAY.md)、[RETRO-2026-10-06.md](RETRO-2026-10-06.md)、[G0-VERIFICATION.md](G0-VERIFICATION.md)。OPSの26 offline testsと反例検査は運用の仕組みを検証したもので、次回実走の健全性を保証しない。

| 失敗・観測 | 教訓と具体的な扱い | 根拠 |
|---|---|---|
| 資格契約の達成見込みを登録前に調べず、Qを2回実行 | [inferred] 既存データで厳しさ・離散性・失敗時の選択肢を先に見積もる。ただし結果を見た後で旧FAILの基準を書き換えない | [doc] [RETRO-10/6](RETRO-2026-10-06.md)、[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) |
| 修理3の19/19非noopフレーム変更を軽く扱い、活動抑制を実走で発見 | [inferred] 全経路が変わる修理を「小変更」と呼ばない。コード差分量と行動差分量を分ける | [doc] [RETRO-10/6](RETRO-2026-10-06.md) |
| 診断完了前にQ02開始、計画上の事前選別を飛ばした | [inferred] 契約に禁止がないことと、合意した計画の順序を守ったことは別。逸脱を記録し、過去のFAILを救済しない | [doc] [RETRO-10/6](RETRO-2026-10-06.md)、[OVERNIGHT-2026-10-06.md](OVERNIGHT-2026-10-06.md) |
| p5負荷・sleep・監視空白で時間と測定品質を失った | [inferred] 起動前に給電/keep-awake/host排他、全rosterの負荷校正、完了後の次工程引継ぎを用意。Air/miniの結果差をCPU性能だけで説明しない | [doc] [RETRO-U1](RETRO-U1.md)、[RETRO-10/6](RETRO-2026-10-06.md)、[SPEEDUP](SPEEDUP-POLICY.md) |
| 開始hash欠測、実走中のcommit、NaN/欠測の旧集計がfail-open | [inferred] begin/end入力map、roster/seedの事前完全登録、全員有限Pを必須にする。実走が読む入力は編集しない。後日のhashは開始hashの代用でない | [doc] [G0-VERIFICATION](G0-VERIFICATION.md)、[RETRO-U1](RETRO-U1.md)、[MASTER](MASTER-PLAN-2026-10-04.md) |
| 「STOP」の広い検索で作業ログを誤検知、background起動を完了と誤認し得る | [inferred] 正確なイベント・行頭条件・固有ID付き `CHAIN_END` と終了rcを使う。FAILは既定停止、診断継続は明示指定された未実行chunkだけ。BLOCKEDは停止 | [doc] [OPS](OPS-LESSONS-2026-10-06.md)、[RETRO-10/6](RETRO-2026-10-06.md) |
| stale dumpのLQTYStaking=0で初回診断開始に失敗 | [inferred] upstream generatorの互換性、deployment、HEAD/Anvil/dump hashを開始前に照合。再生成したことと候補性能を分離 | [doc] [G3-DIAG](G3-DIAG-WORLD-2026-10-06.md)、[OPS](OPS-LESSONS-2026-10-06.md); [supervisor] supervisor-supplied 追加インシデント |
| sedで再開scriptを書換え、labelを再使用 | [inferred] 固定4chunk表から未実行chunkを選び、UTC固有prefixと既存output拒否で二重実行/上書きを防ぐ | [doc] [OPS](OPS-LESSONS-2026-10-06.md); [supervisor] supervisor-supplied `/tmp/retro-extra-facts.md` |
| disk guard40GBに対して空き31GB、削除しても戻らない | [inferred] 空き容量の実測と閾値の例外を明記。Time Machine/APFS snapshotは疑いであり原因確定ではない。既定40GiB・下限25GiBの運用を無断で緩めない | [doc] [OPS](OPS-LESSONS-2026-10-06.md); [supervisor] supervisor-supplied `/tmp/retro-extra-facts.md` |
| Airの不良loopsと別作業が同時発生 | [inferred] 全queueが従うhost lockが必要。lock非参加の作業を防げるとは限らない。pgrep失敗を「プロセス0」と扱わず停止 | [doc] [OPS](OPS-LESSONS-2026-10-06.md); [supervisor] supervisor-supplied 相関情報 |
| env-iで認証に必要なUSER等も落ちた／Colimaのtmp mountやECONNRESET | [inferred] secretを出さず必要な非秘密metadataを用意。local mountと公式runtimeを混同しない。再試行成功だけで根本原因を確定しない | [doc] [G3-DIAG](G3-DIAG-WORLD-2026-10-06.md)、[SELFTEST](SELFTEST-ZETA-R2-2026-10-06.md)、[OPS](OPS-LESSONS-2026-10-06.md) |
| CIだけで不足ファイル/浅い履歴/新upstream test依存が発覚 | [inferred] ローカルのgreen範囲を明記し、CIに近い依存・履歴条件で確認。今回のような依存未導入環境ではtypecheck未実行を隠さない | [doc] [RETRO-10/4](RETRO-2026-10-04-DAY.md)、[RETRO-10/6](RETRO-2026-10-06.md) |
| 集計candidate名hardcode、GNU/BSD差、時刻表記混乱 | [inferred] candidate/rosterを明示入力、構造化出力で照合し、UTC/JSTを明記。後から数値が得られても元scriptのTracebackを成功に置換しない | [doc] [OPS](OPS-LESSONS-2026-10-06.md)、[P60reh/mixed](RESULTS-P60REH-MIXED-2026-10-06.md)、[RETRO-10/4](RETRO-2026-10-04-DAY.md) |
| 監督者が自身のtask branchをforce push | [inferred] 開示済み事故として残す。自身のbranchであることを一般的な権限の根拠にしない。通常のL2からforce push許可は導かれない | [supervisor] **supervisor-supplied** `/tmp/retro-extra-facts.md` |
| masa-harness PR415をCIなしでmerge、2回Codex＋Claude reviewで補完 | [inferred] レビューはCIを実行した証拠ではない。「CIなし・レビュー補完」と報告する。end-markerのL1化とOPSのL2化（PR17）は実施報告として記録 | [supervisor] **supervisor-supplied** `/tmp/retro-extra-facts.md` |

### 文書間の矛盾・古い数字の扱い

| 記述 | 本稿での扱い | 根拠 |
|---|---|---|
| Q01 T58.91という古い要約 | 55.75へ訂正済みの値を採用。58.91はQ02 | [doc] [RETRO-10/6](RETRO-2026-10-06.md)、[Q01結果](Q-ZETA-01-RESULT-2026-10-05.md) |
| 「Qは条件4だけFAIL」 | 5/6までPASSという意味にしない。Q02の5/6はBLOCKEDのまま、本人の限定した証拠範囲で進む選択と分ける | [doc] [C56](Q-ZETA-02-C56-ADJUDICATION-2026-10-06.md); [supervisor] supervisor-supplied 補足 |
| 「他の独自候補にゼロrevert候補なし」 | 旧RETROの一般化は採用しない。sonnet/xbには観測ゼロがあるが性能ゲート未達 | [doc] [RETRO-10/6](RETRO-2026-10-06.md)、[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md) |
| 「r3未作成」「B/C未承認」 | ZR34/OPTIONS執筆時点の状態。現在のr3例外継承/C+E決定とは時点を分ける | [doc] [ZR34](ZR34-REVERT-ANALYSIS-2026-10-06.md)、[OPTIONS](OPTIONS-AFTER-QZETA02-2026-10-06.md)、[C-EXCEPTION](C-EXCEPTION-01-2026-10-06.md) |
| 10/14初回提出目標と10/20施行版P60 | dashboardは不整合を警告、runbookは10/14棚卸し→10/20–22 P60→10/23 G4→10/24–27送信案。現行適用版と工程を確認するまで日程確定扱いにしない | [doc] [dashboard](ASCON-DASHBOARD.html)、[RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |
| clean設定の50/60bp、size範囲の差 | それぞれの資料・版の記述として保持。現候補の設定を旧分析から推測しない | [doc] [analysis-clean](../analysis-clean-arb.md)、[analysis-multi](../analysis-multi-arb.md)、[cards](STRATEGY-CARDS-U1.md) |

## 7. 戦略的選択肢と、決めるための最小実験

[doc] [OPTIONS-AFTER-QZETA02-2026-10-06.md](OPTIONS-AFTER-QZETA02-2026-10-06.md) の旧A–Eは、A=限定修理、B=将来試験のrevert契約変更、C=条件付き提出、D=他候補、E=研究縮小だった。その後の決定はC+E。Bの合算revert比率案を承認済み新基準として扱わない。

[inferred] **以下のA–Dは戦略再考用の別分類**。読取専用メモ `/tmp/strategy-rethink/OPTIONS.md` の提案を、本稿の全36世界・r3xの追加結果で更新した。外部メモの初期9世界の数字を最終成績として使わない。費用はそのメモの概算（人h / host-h）であり、実消費・残予算・予約ではない。

| 案 | 何を目指すか／主なリスク | 判断のための最小実験・証拠 | 採否と費用案 |
|---|---|---|---|
| A 保険：r3を維持 | [inferred] 固定候補と受理経路を保全。競争力の弱さ、revisionの未保証が残る | [inferred] 新しい性能探索ではなく、固定hashの不足表を作り、P60・G3・G4の未充足を一つずつ閉じる。診断1世界をG3代替にしない | [inferred] 既存C+Eと整合。人3–5h / host0–4hは追加整理枠のみ、共通受入れ実走費は別 |
| B 独自強化：在庫・執行の再設計 | [inferred] 実行edge、markout、在庫偏りで機会とsizeを決める。閾値だけのvenueコピーではない。作り直し・過適合の危険 | [inferred] 既存確定ログでWETH/WBTC別edge・carry・gas・片脚・期末在庫・specialist損益を分解。WBTC原因説なら、r3対WETH限定の1因子、新2seed×3局面×2候補=12世界を同slot/相手で登録 | [inferred] 入口は人4h＋host最大4h程度の診断案。改善しなければWBTC説を弱める。全案は人10–16 / host10–16h。C+Eの限定解除が先 |
| C 局面切替：取引/待機を一体内で選ぶ | [inferred] 合法な価格経路・volatility・inventory観測で新規entryを止める。regime名/seed/未来情報を使わない。退出まで止めると危険、noop自体も初期在庫リスクあり | [inferred] まず保存観測で発火と逸失機会を監査。その後固定gate ON/OFFを未知2seed×不利/中立/有利の3局面×2=12世界で比較。損失回避より逸失利益が大なら棄却 | [inferred] 人6–10 / host6–10h概算。全12局面の確認前に採用しない。H39のB機構を実証済み扱いしない |
| D 場の頑健性：相手構成を変えて評価 | [inferred] F_ref・高bid・混成のいずれかへの特化を避ける。本番場を再現できる保証はない | [inferred] 候補を変えず、相手だけを固定3場、共通2seed×3局面=18世界で診断。P−noop・T母集団・機会/約定を別々に比較し、場とseedの交絡を減らす | [inferred] 人3–5 / host4–8h概算。新しいrosterの負荷校正/G0/事前登録が必須。これはG3の既存F_mix認定ではない |

[inferred] 推奨順は **Aを保全→既存ログで原因を絞る→Dの設計→根拠がある場合だけBまたはCを1案**。r3xで悪化したため「独立資金確認を外せば戻る」というB案は優先しない。どの診断も採用試験ではなく、良ければ全12レジーム・未知seed・複数場・安全性と受入れへ進む必要がある。小標本の勝者をすぐ提出しない。

[doc] 早い独立レビューもF_refの外挿、選抜後の有意差、未知の既消費、ON所要時間、受理経路より研究を優先する危険を指摘していた。出典: [GROK-REVIEW-MASTER-PLAN.md](GROK-REVIEW-MASTER-PLAN.md)。[inferred] 今回の負の結果は、この指摘を測定設計と日程へ反映する必要性を強めるが、レビューが未来の結果を実証したという意味ではない。

## 8. 10/31までの残り作業と100h予算

[doc] dashboardの `consumed_forward_hours` と `consumed_exact_hours` は未精算のnull。旧履歴18.6h、MASTERの457分（7h37m）概算、10/5–6 RETROの約15h等は範囲と重複が違う。**forward 100hは残り100hではない**。日次6h、chunk110分、監査と予備を含める設計も残る。出典: [ASCON-DASHBOARD.html](ASCON-DASHBOARD.html)、[MASTER-PLAN-2026-10-04.md](MASTER-PLAN-2026-10-04.md)、[RETRO-2026-10-06.md](RETRO-2026-10-06.md)。

[inferred] まずhostごとの開始/終了・sleep/idle・再実行・監査・人作業を照合し、wall-clock、host-hours、予算に算入する時間を別欄で精算する。Airとminiの並行時間を一方のwall-clockだけで数えたり、同じ実行を複数メモから重複加算したりしない。精算前に深いリーグ20hや新探索枠を「余裕」と見なさない。

[doc] 現行予算契約の機械時間を、p3だからと3倍してはいけない。`C_forward + R_remaining + N_next ≤ 100h`、同一区間の消化/予約二重計上禁止、不明なら追加起動BLOCKEDを維持する。出典: [MORNING-2026-10-05.md](MORNING-2026-10-05.md)、[MASTER-PLAN-2026-10-04.md](MASTER-PLAN-2026-10-04.md)。

| 順序・判断窓（JST、案） | 残り作業 | 完了と呼べる証拠・時間上の注意 | 根拠 |
|---|---|---|---|
| 直近 | 予算精算、候補r3/例外/依存/ZIPの対応表、失敗・欠測一覧、日程矛盾解消 | [inferred] 正確な残費が出るまで新研究枠を解放しない。既存資料の整理と新候補実走を分ける | [doc] [C-EXCEPTION](C-EXCEPTION-01-2026-10-06.md)、[dashboard](ASCON-DASHBOARD.html) |
| G3再開前 | 実runtime recorder、自然改訂fixture、roster F_mix、seed予約衝突、budget/host排他を解消 | [inferred] missingやpgrep異常を0扱いしない。現1世界は診断だけ | [doc] [g3/README](g3/README.md)、[g3/chain/README](g3/chain/README.md)、[REVISION-AUDIT](g3/chain/REVISION-AUDIT.md)、[SNAPSHOT](g3/chain/SNAPSHOT.md) |
| 準備が整ってから最小G3 | 通常36＋fault7＋状態3=46世界を事前固定して実施・全件監査 | [doc] p1基本約9.97h、準備/監査込み14–15h予約案。旧p3の2.6hを流用しない。full G3とは別 | [G3-DESIGN](G3-DESIGN-ZETA-R2-2026-10-06.md)、[RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |
| 10/14 | 送信日と決めつけず準備棚卸し、適用版・provider/入力の不足確認 | [inferred] dashboardの初回目標とrunbookを一致させる。時期だけでゲートを緩めない | [doc] [dashboard](ASCON-DASHBOARD.html)、[RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |
| 10/20–22（適用版確認が前提） | final版の公開P60。runbookではFROZEN、revision ONはG3で別途確認 | [doc] 12×5seed、p1約12–13h＋照合1h。公開202は既使用なのでholdoutでない。後半重みの正式再集計が必要 | [RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |
| 10/23以降のG4 | 最終同一ZIP・実効設定・住所表/chain・2vCPU/4GB・起動/依存/scanの照合 | [doc] ローカル住所へ差替えたコピーだけの起動なら同一ZIP欄はBLOCKED。96 payload一致はmtimeを除く内容確認でbyte再現性ではない | [RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md)、[SELFTEST](SELFTEST-ZETA-R2-2026-10-06.md)、[RELEASE-CHECKS](RELEASE-CHECKS-ZETA-R3-2026-10-06.md) |
| 10/24–27初回送信案 | 本人F0、登録/枠/model/有効性、C開示、本人による運営送信と受理確認 | [doc] 登録は過去の本人報告あり。再登録を無条件に要求せず、有効性・枠を確認。キー値は文書/ログへ残さない | [RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md)、[MASTER](MASTER-PLAN-2026-10-04.md) |
| 10/28–31 | dec-007/F0最終確認→10/29受理照合目標→10/30予備→10/31 23:59 JST最終照合 | [inferred] 最後に受理された意図したZIP/hashを確認して閉じる。未受理の送信や予定を完了と報告しない | [doc] [RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) |

[inferred] P60約13–14hと最小G3約14–15hだけで、準備/監査を含む計画量は約27–29hになる。これにG4・受理・予備が必要で、他メモの共通準備との二重計上を避けた再予算化が先である。「100hに収まる計画表」と「既消費を引いた残枠に実行可能」は同義ではない。締切が近づいた場合は研究を先に削り、未成立の受入れゲートを削らない。

## 9. 本人の判断が必要な点

| 判断 | 既決の範囲 | 残る判断／必要な証拠 |
|---|---|---|
| 提出確保と優勝探索の配分 | [doc] C+Eでr3条件付き保険、研究停止。[C-EXCEPTION](C-EXCEPTION-01-2026-10-06.md) | [inferred] 精算後にA保全へ集中するか、B/C/Dを限定再開するか。現時点で再開承認はない |
| 新候補停止の限定解除 | [supervisor] supervisor-supplied: 当初計画測定を終えて回顧/改善、という希望 | [inferred] 改善希望を無制限の候補追加や追加資格走の許可と解釈しない。候補数・1因子・時間・停止条件・例外失効/再承認を固定 |
| 条件付き安全性の受容 | [doc] 条件4免除、5/6不足を開示したC。G0/規約/P60/G3/G4は免除なし。[C-EXCEPTION](C-EXCEPTION-01-2026-10-06.md) | [inferred] 新たな残余リスクや証拠不足が出た時、受容範囲を広げるか中止するか。元FAILをPASSに直さない |
| revisionの残余リスク | [doc] r3 prompt抑止は強制guardでない、G3未完。[GUARD](ZETA-R3-GUARD-2026-10-06.md) | [inferred] 無改変runtimeで安全要件を満たせない場合の方針。Haikuの見送りだけでは判断を閉じない |
| 独自性・最悪損失 | [doc] 独自戦略方針とinc由来の本人了承。[origin](INC-ZETA-ORIGIN-2026-10-05.md)、[PLAN-V2](PLAN-MASA-ASCON-V2.md) | [inferred] 改良B/Cで何を独自と認め、平均改善と最悪レジーム悪化をどこまで許すか |
| 予算・日程 | [doc] 未精算100h、初回目標と適用版に不整合。[dashboard](ASCON-DASHBOARD.html)、[RUNBOOK](RELEASE-RUNBOOK-ZETA-R2-2026-10-06.md) | [inferred] host別精算、G3/G4/P60留保、監査・再試行・予備を承認可能な1枚にする。超過を自動補充しない |
| 最終登録・提出・受理 | [supervisor] supervisor-supplied: 鍵/支払い/運営フォームは本人操作 | [inferred] 有効なprovider/model/枠と最終ZIPの対応を確認し、提出・受理照合を行う。現時点の受理状態は未確認 |

[inferred] **再確認が不要な既決事項**と、新しいリスクに対する判断を分ける。r3への例外継承、Claudeの通常L2、追加AI性能研究停止を毎回最初から議論し直さない。一方、hash変更・規約変更・予算不足・G3安全性未成立は、過去の承認の範囲を超え得るので証拠と選択肢を具体化して本人判断へ戻す。

### 本稿の作成時検査

- [inferred] 変更は本稿とr3x集計の原文コピーのみ。dashboardへの任意追加は行わず、既存データ・候補・計画・ゲートを変更していない。コピーは元ファイルとbyte一致、SHA-256 `266fba883be10466f17498475447ebcee0cce45dda5ef130592d9708454c727c`。
- [inferred] `dashboard-ui-check.mjs --dump …` は38 UI checksと反例検査PASS。`dashboard-check.py --self-check --rendered …` はPASS。これは最小DOM/静的整合の検査であり、実ブラウザの表示・アクセシビリティ・測定・提出の検証ではない。
- [inferred] `npm run typecheck -- --incremental false` は `tsc: command not found` で実行不能（依存未導入、network/installは行わない）。**typecheck未検証**。追加で調べた `check-plan-consistency.py --self-check` は編集前から `FAIL: dashboard queue order`。本稿で既存計画を修正・PASS化していない。
- [inferred] リポジトリ内参照リンクの存在を確認。simulation、network、SSH、Docker、model calls、commit/push、`.env`/鍵読取は未実施。ここにある実験数値・過去のCI/selftest PASSは出典の記録であり、今回再実行したものではない。
