# ASCON master plan — 2026-10-04 — revision 14

<!-- q-zeta-02-registration:start -->
## 2026-10-06 追記 — Q-ZETA-02 registered-pending-start

Q-ZETA-02 registered-pending-start（登録済み・未起動）。ascon-zeta-r2、1候補1回60世界、4チャンク各110分以下、確認込み5hはforward100h内数。Q-ZETA-01条件4 FAIL・消費1回を保持し回数リセットなし。6条件・閾値は不変。単一host固定: miniは自機G0 smoke PASS時のみ、fallback Airは給電・caffeinate・sleep禁止。host/開始前署名/残費は未確認。診断48001/48002は資格証拠にしない。

契約: [Q-ZETA-02](Q-ZETA-02.md)。候補hash `ddd7c718f2e9091c64b9949e277447868dd82347729d86f899b35dc89156786c`、seed 47001–47005、slot noop/multi-arb/clean-arb/cand、全60世界を同一host。48001/48002は使用済み診断で再使用しない。実行担当Claudeの開始前確認欄は空欄。準備中のreadはupstream-eval/run metadataまで許可、writeはleague-v2のみ。commit/push/network/ssh/計測起動なし。check:strategyは本人実施。

本人原文: 2026-10-05 “limited repair then new contract”、2026-10-06 JST “start quickly and run Air and mini in parallel”。Q-ZETA-02の60世界を2hostへ分割する許可とはしない。Q-ZETA-01の条件5/6未判定とsleep/時間逸脱も保持。

以下のrev14本文・分割PR状況・旧日程は2026-10-05時点の履歴。本追記と更新した実行キューを現在の契約状態とする。過去の合否・署名・予算表は変更せず、未精算費用を0にしない。
<!-- q-zeta-02-registration:end -->

更新: **2026-10-05 09:52:03 JST**（Asia/TokyoによるJST）。文書更新時刻。既存の決定署名日時・計測時刻は変更しない。

**決定の出所**: rev 14の3点は2026-10-05 JSTの本人チャット承認（§2/4/8/10）。rev 9のH1選択と課金なし方針は2026-10-04の本人決定。rev 6の6論点は「本人が 2026-10-04 に Astra へ判断を委任。Astra が決定」の原記録を保持する。 本人のチャット上の「全てコデックス(Astra)に決めさせて」に基づき、直前の`decisions.out`の論点1〜6を本書の各節へ統合した。既決のQ0維持・10/8延期・forward100h・独自戦略のみ・Q0最優先は変更しない。金銭/API上限・自動チャージ・残高・Ollama鍵登録は委任対象外。本人報告による登録・設定確認は§10、前払い判断はG3見積もり後。

**現況**: inc-zetaを条件付き第一候補とし、新契約Q-ZETA-01へ進むことを本人承認済み。移管完了、分割PRとzeta-prepは進行中・結果未確認。既報の全計測終了・走行中なし（プロセス再照会なし）。 [進行中・本人引継ぎ] zeta-prep（Astra）がnoop割れ4レジーム（cex-drift/informed-flow/lending-incident/vuln）の診断、測定設定を焼き込むrelease候補example/agents/ascon-zeta-r/、ascon-notes/league/INC-ZETA-ORIGIN-2026-10-05.md、ascon-notes/league/Q-ZETA-01.mdの下書きを作成中。存在する/作成中の参照のみで、結果は未確認。由来はINC-ZETA-ORIGINへ記録予定。 [進行中・本人報告] 分割点3d86a35からpr/upstream-integration（CIのignore-scripts修正を含む）をmain向けPR1にし、league/v2をPR1ブランチ基点のPR2にする。PR1 merge後にPR2のbaseをmainへ付け替える。独立レビュー・CI後にmerge commitで統合。PR番号・レビュー/CI/merge結果は未確認、進行は本人報告へ。

**診断の引継ぎ**: [measured引継ぎ] 決定論ラインは第3回xa-1で打ち切り、Q0のF_ref平均T≥multiに未達。自由改訂はPILOT-STOP。mix2・48世界集計を受領、混成場はinc-zetaが1位、candは48世界で5位。inczも診断完了、平均T56.30対44.44・noop割れ4/12。全計測終了・走行中なし。 dev4 v3は49.72対55.02、dev5 v5は50.15対55.73で昇格せず。[本人決定・チャット承認 2026-10-05 JST] 3点を「進める」: inc-zeta（ascon-zetaのzeta-a30）の実質的改変を独自戦略と認め、multi-arb派生を開示して条件付き第一候補にする。弱点診断後、現行閾値を維持した新契約・回数枠Q-ZETA-01（F_ref・12レジーム×5新seed=60世界・約4.5h）で資格試験へ進む。上流統合・適応とleague追加分を分割PRにし、Claudeの別エージェント+agyによる独立レビュー・CI後、merge commitで統合する。 H1標準ON拒否。原ログ/プロセス再照会・計測起動・戦略検査なし。

**決定した順序**: inc-zeta弱点診断/設定固定/新契約登録→Q-ZETA-01資格→P60→最小改訂適合/G3/G4→受理S→限定AI→D対照/E3/Q1/G3反復→10/17条件分岐→封印/最終受理。AIは本人がH1（検査済み方針の選択+ENTRY）を選択、標準ONは安全境界不成立で停止。旧ENTRY単独の署名契約は§5/10に保持。R*反復12h＋S full G3 5.2h=17.2h。全費用・hash・未使用seedの証跡が揃うまで新規実走は解放しない。詳細は[DESIGN-AI-LAYER-01](DESIGN-AI-LAYER-01-astra.md)。

**決定署名**: 本人が 2026-10-04 に Astra へ判断を委任。Astra が決定。署名者=本人委任のAstra決定。署名日時=2026-10-04T15:00:11+09:00（今回の決定記録時刻。Masashi本人の署名・過去の委任時刻を代署したものではない）。

作業境界: 計画・正本[ASCON-DASHBOARD.html](ASCON-DASHBOARD.html)・手順・軽量checkerのみ変更。DESIGN-REPAIR-01、xb-r/xa-1/xb-r-ai/xb-r-liveの実装・テストは変更しない。upstream-eval、ascon-notes/eval/out、runs/、鍵・`.env`へアクセスせず、コミットしない。新規計測の起動・停止・別ジョブへの介入なし。

規約/Ollamaのオンライン取得はrev 5の確認記録を継承し、今回は再取得していない。「10/20 発効版」表示との引継ぎで、今日（2026-10-05）の適用版との一致は未確認。初回G4/10/12/10/28に照合する。

## 1. 夜間の証拠と現在地

[measured] は指定資料の集計をそのまま引用した観測。[inferred] は解釈・計画・算術見積。[unverified] は未確認。本書で原ログを再監査した意味ではない。出典は [MORNING](MORNING-2026-10-04.md)、[M1](m1/M1-RESULT.md)、[Grokレビュー](GROK-REVIEW-MASTER-PLAN.md)、[xb README](../../example/agents/xb-core/README.md)、[xb VALIDATION](../../example/agents/xb-core/VALIDATION.md)、正本ダッシュボードと旧revision。Q0bは今回の本人引継ぎを§1.3に保存する。数値は提示集計の桁・母集団を保持し、未提示のレジーム値は補完しない。

### 1.1 F_ref D0: 6候補、各8世界（既見201/202）

<!-- source-d0:start -->
| 候補 | 平均 P | 平均 P−noop | 最悪 P−noop | noop 割れ | 送信 | 優先 0 の送信 | 優先手数料の中央値 (gwei) | revert | 送信失敗 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| inc-zeta | -4.8 | 78.9 | -1388.2 | 4/8 | 1929 | 0 (0.0%) | 0.566 | 1 | 4 |
| zeta-2 | -742.1 | -658.4 | -1380.6 | 7/8 | 1833 | 618 (33.7%) | 0.100 | 14 | 4 |
| zeta-2a | -328.3 | -244.6 | -1390.3 | 6/8 | 1902 | 0 (0.0%) | 0.613 | 2 | 12 |
| zeta-2c | 205.5 | 289.1 | -919.4 | 4/8 | 949 | 0 (0.0%) | 2.031 | 0 | 10 |
| sonnet-1 | 177.3 | 261.0 | 63.2 | 0/8 | 404 | 0 (0.0%) | 0.373 | 0 | 0 |
| opus-1 | 542.7 | 626.4 | -93.4 | 2/8 | 1705 | 0 (0.0%) | 0.100 | 80 | 12 |
<!-- source-d0:end -->

[measured] 6診断は完走。inc-zetaは開始後の計画commitによりG0 FAIL、他5候補はG0 PASSの報告。inc-zetaとの値の比較は診断に限る。zeta-2の回帰は隔離場でも再現し、優先0の送信33.7%。A/Cは0%へ消したがAはPを回復せず、CはP−noop +289.1（対照+78.9）。sonnet-1は0/8 noop割れ、opus-1はP最大だが80 reverts。

[inferred] ゼロ入札の除去だけで利益回復を説明できない。C型の見送りは追試候補だが、8世界は世界ごとのPが±1,500動く診断。順位・採用・モデル能力・効果の因果分解は主張しない。

### 1.2 sonnet-1 Q0: 安全の報告は良好、競争条件はFAIL

[measured] F_ref、12レジーム×新seed41001–41005=60世界。HEAD固定、3チャンクともG0 PASS。全12で平均(T−Tnoop)≥0、最小+3.63。違反/failedReads/未記録取引/mined revert/無効注文は0、送信失敗35、noop割れ2/60。安全集計の良好さと、競争条件の合否を分ける。MORNINGの機械出力にはunrecovered/violations欄がn/aともあるため、未回収資産の完全な証跡は提出適合時に照合し、n/aを0へ書き換えない。

<!-- source-q0:start -->
| レジーム | 世界数 | 平均 P | 平均 P−noop | 最悪 P−noop | 平均(T−T_noop) | 平均 T(候補) | 平均 T(multi-arb) |
|---|---:|---:|---:|---:|---:|---:|---:|
| calm | 5 | 382.4 | 109.1 | 17.8 | 6.52 | 44.58 | 53.37 |
| cex-drift | 5 | 433.8 | 599.4 | 444.3 | 7.98 | 46.57 | 58.46 |
| informed-flow | 5 | 537.5 | 292.0 | 96.5 | 15.03 | 42.73 | 51.12 |
| whale | 5 | 1750.8 | 1702.5 | 546.9 | 6.67 | 39.32 | 49.79 |
| lending-incident | 5 | -91.9 | 590.9 | 433.7 | 18.18 | 46.81 | 62.64 |
| crash | 5 | 111.3 | 630.0 | 307.0 | 9.27 | 47.42 | 58.28 |
| depeg | 5 | 407.1 | 147.0 | 79.0 | 9.56 | 46.52 | 54.52 |
| vuln | 5 | 75.4 | 191.6 | 48.0 | 10.21 | 40.69 | 57.74 |
| spike | 5 | 3171.5 | 989.5 | 550.0 | 11.65 | 48.50 | 58.71 |
| depeg-persist | 5 | -11.9 | 126.3 | 62.4 | 9.58 | 41.50 | 60.72 |
| cdp-incident | 5 | -939.9 | 511.3 | 147.3 | 8.49 | 49.50 | 52.68 |
| launch | 5 | 363.2 | 83.0 | -105.3 | 3.63 | 40.60 | 59.98 |
<!-- source-q0:end -->

**[measured] 現契約「等重み平均T ≥ multi-arb」は44.56対56.50でFAIL。** 過去の判定は変更しない。MORNING §6の「全12レジームのP−noopを満たす」はレジーム平均の話で、全世界無損失ではない（launch最悪−105.3、2/60割れ）。

[measured] 別に示された同じ8レジーム×5seedのF_ref比較では平均Pはsonnet-1 **450.8**、multi-arb **1,296.9**、clean-arb **1,269.4**。u1mの11体混成場はsonnet-1平均T **53.92**、multi-arb **39.45**（最下位）。[inferred] 観測された強弱の順序は場で逆転する。指標・seed・場が違い、u1mはG0 BLOCKEDなので場変更の対応因果実験でも、新F_mixで勝つ証拠でもない。PとTを共通軸へ載せたり、場を跨ぐT差を計算しない。

### 1.3 opus-1 Q0b: 全60世界完了、平均T条件FAIL

[measured: rev 4時点の本人引継ぎ、Claude集計] F_ref、12レジーム×seed41101–41105、q0ba/q0bb/q0bc-opus-1の3チャンク。以下は**G0 FAIL 2世界を含む全60世界の提示集計**で、G0合格標本だけの資格成績ではない。

<!-- source-q0b:start -->
| Q0b項目 | 提示された結果 | 判定・範囲 |
|---|---|---|
| 世界数・チャンク | 60世界 / 3チャンク | 12レジーム×41101–41105、全量完了 |
| G0 | A=PASS / B=FAIL / C=PASS | vulnの41101・41103でloopIterations=361、必要362 |
| 不足2世界のp99 | 648/531ms | 基準内。loop不足とは独立 |
| 全レジーム平均(T−Tnoop) | 全12で≥0 | 最小+2.05 cex-drift、最大+25.74 cdp-incident |
| noop割れ | 6/60世界 | 全世界の無損失を意味しない |
| 12レジーム等重み平均T | 候補48.07 / multi-arb56.43 | 現契約「平均T≥multi-arb」はFAIL |
| cdp-incident 平均T | 候補62.19 / multi-arb47.84 | 候補が明瞭に上回る唯一のレジーム |
| launch 平均T | 候補54.68 / multi-arb54.65 | 実質同等として報告、統計的同等性の証明ではない |
| 安全集計 | 未確認 | 違反/失敗読取/無効注文/revertはClaude側で未集計。0にしない |
<!-- source-q0b:end -->

**[measured] sonnet-1は44.56対56.50、opus-1は48.07対56.43で、両候補とも現Q0契約不合格。** [inferred] 現F_refではmulti-arbに負ける判定となる一方、§1.2のu1m診断では順序が逆転していた。契約がどの場の強さを要求するかは重要だが、異なる場の診断を資格へ転用せず、変更は別の将来契約で扱い、今回のA決定で緩和しない。

以下の安全未確認欄はrev 4引継ぎ時点のスナップショット。[修理設計§1.2](DESIGN-REPAIR-01-astra.md)にはその後の診断集計があるが、本更新では原ログ・全契約証跡を再監査せず、資格認定へ昇格させない。

**論点5の決定: 不合格記録保持・資格救済の再走なし。** 全60世界を診断母集団として保存し、「G0: vuln 41101/41103の2世界FAIL」と「平均T条件FAIL」を独立して記録する。除外して58世界を60世界契約のPASSとは呼ばない。Q0mの再走規定はQ0bへ自動適用しない。今回の平均T条件の不合格は動かない。原因調査の追加占有は0h、救済目的の再走はしない。同じloop欠落の解明がxb-r資格成立に不可欠と証明された場合のみ、別の診断契約・費用を先に登録して検討する。旧失敗の置換は不可。

[unverified] 違反/失敗読取/無効注文/revertに加え、未回収自前資産/gas枯渇/送信失敗/世界別最悪値の証跡は今回未提示。G0のA/C PASSをこれら全項目の0へ読み替えない。

### 1.4 M1とxb-core

[measured] 16仕様・6機構、14/16が他と同機構、ギャップ裁定の外の利益源0。Astra/Sonnetは各3/4、Opus/Grokは各2/4の異なる機構。性能は未測定。

<!-- source-m1:start -->
| クラスタ | 機構 | 仕様 | 作者（開封後） |
|---|---|---|---|
| D | 払える入札が競合に届かない単腿は送らない（zeta-2c と同型） | S06 S11 S13 S14 S15 S16 | Astra×2・Sonnet×2・Grok×2（すべて B0） |
| E | 無条件の余剰 WETH 掃き出しを条件付きに置換 | S07 S10 | Opus×2（B0） |
| A | 自分の約定の事後マークアウトで閾値・サイズ・方向別エントリーを制御 | S01 S02 S05 | Opus×2・Sonnet×1（B1） |
| B | 価格経路（下落・ボラ）で在庫増を抑える／現物を減らす | S03 S04 S12 | Grok×2・Sonnet×1（B1） |
| F | 片脚失敗の未解消在庫を残高照合で隔離 | S08 | Astra（B1） |
| G | 急落時の GMX ショート保険（初期在庫対象） | S09 | Astra（B1） |
<!-- source-m1:end -->

[inferred] 同じ欠陥資料を渡すと修理へ収束する。次の新利益源briefはD/E/A/B/F/Gと既存ギャップ裁定の改良を禁止し、独立な収益源・資金経路・損失経路を必須にする。今回の多様性は各モデル4仕様・1回の生成に限り、モデル一般の優劣ではない。D→E→Aの順に測定可能性を整える。Aは約定価格復元と入札順位の交絡を解決するまで実装完了としない。

[measured: VALIDATION] xb-core V0–V7実装済み、73 tests・typecheck OK、Grok独立レビュー後3欠陥を修正。旧floor/旧bidの赤対照あり。**チェーン上の実行・gas実費・epoch退出は未検証**。本書更新でテストを再実行した意味ではない。

### 1.5 xb-r初期診断とAI適合の境界（履歴）

[measured: 2026-10-04の本人提示結果。原ログ再監査なし] **dev1-xb-r診断完了、現状Q0資格不可**。測定終了の正確な時刻・候補hash・消費区間は未提示。

<!-- source-dev1:start -->
| dev1-xb-r項目 | 提示された結果 | 判定・範囲 |
|---|---|---|
| G0 / ループ | PASS / 362ループ | 診断の計測成立、Q0資格PASSではない |
| 母集団 | F_ref・12世界（6レジーム×seed31001/31002） | 既見の開発集合。Q0・E3・Hへ転用しない |
| P−noop | 全世界0.0 | 全世界でnoopと同じ、利益増なし |
| candの挙動 | 361回「no funded positive net edge at an affordable bid」、取引0 | 提示ログの回数。全12世界の合計回数とは解釈しない |
| multi-arb | 同世界でP約1300 | 本人提示の概数。レジーム別値や全世界平均を補完しない |
| 原因 | オラクルの優先手数料6gweiを競合入札と誤認し、R4要求6.1gweiが実行上限5gweiを超えて全候補落ち | Astra診断のmeasured記録。calm/31001と再構成fixtureの診断で、他11世界は再集計なし |
<!-- source-dev1:end -->

[measured: [Astra診断](XB-R-DEV1-DEBUG-2026-10-04.md)] 2ae0d59で公開ブロックから実行先ごとの競合入札を取得するよう修正。112テスト・赤対照19件・回帰3件が旧コードで赤の記録あり。本人も独立再実行したとの引継ぎ（本更新では再実行なし）。当時は修正後の結果待ちだったが、後続のdev2実測とv2/dev3引継ぎを§1.6に保持。旧15:50頃は見込みで、実完了時刻には転用しない。null固定promptは診断用で、live改訂適合は未完成。担当者が修理後のhash・再生・clock依存・取引成立を照合する。G0 PASSやfixture通過を収益資格にしない。

### 1.6 dev2/dev3aの診断引継ぎ履歴（10/4夕・rev 7）

[measured: 今回の本人提示集計] dev2-xb-r。原ログを今回再監査した意味ではない。dev2の正確な完了時刻は未提示。

<!-- source-dev2:start -->
| dev2-xb-r項目 | 提示された結果 | 判定・範囲 |
|---|---|---|
| 母集団・G0 | F_ref・seed31001/31002・6レジーム12世界 / G0 PASS | 提示されたmeasured集計。原ログ再監査なし |
| P−noop | 全12世界で正、最小+147.7、noop割れ0 | 取引成立を確認。全12レジームの資格ではない |
| 1世界平均P | cand 149.0 / multi-arb 1352.2 | 同じ12世界。提示値の桁を保持 |
| 1世界平均取引数 | cand 44.8 / multi-arb 300.9 | 同じ12世界。提示値の桁を保持 |
| 診断6レジーム平均T | cand 44.36 / multi-arb 56.84 | Q0平均T基準未達。Q0資格判定ではない |
| 違反 / revert | 0 / 0 | 診断の安全集計。新版・資格の安全保証ではない |
<!-- source-dev2:end -->

[measured引継ぎ] xb-r v2 commit **a646e9b**。単脚の追加100bpsゲートと初期在庫停止を独立スイッチ化。**テスト123件・赤対照25件**。本更新で再実行していない。詳細原表は[DEV2-XB-R-REPAIR](DEV2-XB-R-REPAIR.md)を保持し、概要の丸め値と区別する。

[measured: 本人提示集計、原ログ再監査なし] **dev3a-xb-rは16:24 JST開始、17:39 JST完了**（分単位の引継ぎ。秒は不明）。旧17:40頃完了見込みは予測として退役し、完了時刻に転用しない。

<!-- source-dev3a:start -->
| dev3a-xb-r項目 | 提示された結果 | 判定・範囲 |
|---|---|---|
| 母集団・G0 | F_ref・seed35001/35002・9レジーム18世界 / G0 PASS | v2 a646e9b。全12レジームの資格ではない |
| P−noop / noop割れ | 全18世界で正 / 0 | 最小値は未提示。dev2の+147.7を流用しない |
| 違反 / revert | 0 / 0 | 提示集計。未提示の安全項目を0にしない |
| 送信失敗 / 送信 | submit_failed 27 / submitted 980 | 送信と包含成功数は別。revert率の分母へ転用しない |
| 1世界平均P | cand 842.3 / multi-arb 2032.9 / clean-arb 1050.3 | 同じ18世界 |
| 1世界平均取引数 | cand 54.4 / multi-arb 288.7 / clean-arb 61.3 | 同じ18世界 |
| 診断9レジーム平均T | cand 46.83 / multi-arb 55.93 | 比較対象未達。12レジーム平均は未確認 |
| informed-flow 平均T | cand 55.23 / multi-arb 36.01 | 候補が上回る |
| lending-incident 平均T | cand 52.52 / multi-arb 49.15 | 候補が上回る |
| vuln 平均T | cand 49.35 / multi-arb 50.10 | 小差で下回る。ほぼ同等との記述であり、勝利/統計的同等ではない |
<!-- source-dev3a:end -->

[unverified: rev 7時点の履歴] dev3bは残り3レジーム走行中、v3はAstra実装中との引継ぎだった。dev3bのseed・世界数・G0・開始/完了時刻・結果は今回も未受領。dev3aと合算しない。v3の凍結hashと全12診断dev4は§1.7で更新する。dev2→dev3aはseedとレジーム数が違い、平均値の差をv2の因果効果と断定しない。

35001/35002は開発既見seed。旧AI D対照案は失効し、将来のD対照は実行前に未使用の全集合を再登録する。資格の41301–41305や契約閾値は変更しない。

Ollama登録・Free・残高$0・Auto-reload Off・クリップボード消去は**本人報告**。gpt-oss:120b前提。dec-008 resolved、dec-007は10/28の運営一覧・無料枠量・疎通の再確認。当時の登録について本人が今やることは**なし**との記録。現在の分割PRは§8/10。MASTER revision 6の決定は維持。

### 1.7 診断結果と条件付き第一候補（10/5・rev 14）

[measured: 本人提示集計、原ログ再監査なし] dev4はv3 d30cbbbの全12レジーム24世界。開始/完了の実時刻は未提示。

<!-- source-dev4:start -->
| dev4-xb-r項目 | 提示された結果 | 判定・範囲 |
|---|---|---|
| 母集団・G0 | v3 d30cbbb・F_ref・seed36001/36002・12レジーム24世界 / G0 PASS / 362ループ | 本人提示measured。原ログ再監査なし |
| 12レジーム等重み平均T | cand 49.72 / multi-arb 55.02（差5.3T） | 平均T条件未達・資格合格ではない |
| レジーム平均(T−Tnoop) | 全12レジームで正 / 最小+7.85 | レジーム平均の最小値。世界別Pの最小値ではない |
| noop割れ / violations / cand revert | 0 / 0 / 0 | 未提示の安全項目は補完しない |
| 送信 / 送信失敗 | submitted 1652 / failed 23（1.4%） | 失敗率は23/(1652+23)の丸め。mined revertと別 |
| 1世界平均P | cand 488.2 / multi-arb 1460.8 / clean-arb 440.0 | 同じ24世界 |
| 1世界平均取引数 | cand 68.8 / multi-arb 273.4 / clean-arb 46.3 | 同じ24世界 |
<!-- source-dev4:end -->

<!-- source-dev4-regimes:start -->
| dev4レジーム | cand 平均T | multi-arb 平均T | 比較 |
|---|---|---|---|
| calm | 56.12 | 35.90 | candが上回る |
| crash | 52.45 | 50.31 | candが上回る |
| vuln | 54.14 | 48.69 | candが上回る |
| spike | 50.20 | 49.99 | candが上回る |
| depeg-persist | 57.02 | 50.54 | candが上回る |
| launch | 53.46 | 49.92 | candが上回る |
| whale | 38.86 | 62.79 | candが下回る |
| cex-drift | 45.67 | 63.80 | candが下回る |
| depeg | 42.73 | 63.85 | candが下回る |
| lending-incident | 46.48 | 63.61 | candが下回る |
| cdp-incident | 47.24 | 62.98 | candが下回る |
| informed-flow | 52.33 | 57.81 | candが下回る |
<!-- source-dev4-regimes:end -->

[決定] **v5 = v3 + R9(bundle用在庫余地)ON**。根拠は [DEV4-XB-R-V5.md](DEV4-XB-R-V5.md)、commit **7b1448b**、テスト**183**・赤対照**59**の既存検証引継ぎ。今回再実行していない。R9のみを診断採用し、性能確認済みへの昇格ではない。安全条件や他因子は変更しない。

[measured引継ぎ] **dev5は平均T 50.15対55.73、v5は昇格せず、基準はxb-r v3**。2/3回目。2026-10-04 22:07 JST開始、旧2026-10-05 00:00 JST頃見込みを実完了へ転用しない。完了時刻・G0・安全内訳は今回未提示。

<!-- source-dev5:start -->
| dev5項目 | 提示値・境界 |
| --- | --- |
| 平均T | cand 50.15 / multi 55.73 |
| 母集団 | F_ref・36001/36002・12レジーム24世界・2/3回目 |
| 判定 | v5昇格せず、基準はxb-r v3。独立screen/Q0ではない |
| 未提示 | 完了時刻・完了数・G0・安全内訳は未確認 |
<!-- source-dev5:end -->

同seed対応診断の昇格条件は根拠文書どおり、平均対応ΔT≥+1.0、各レジームΔT≥−2.0、全レジーム平均T−noop≥0、24世界noop割れ0、violations/mined revert0、failed率≤23/1675、片脚bundle率≤2/114、成功bundle数≥143 ID。failedReads/未解消片脚等の安全条件も必要。絶対平均T≥multiと独立fresh screenは別の必要条件であり、対応改善だけではQ0へ進まない。旧37001/37002 fresh screen案は未解放。第3回xa-1打ち切りで追加起動しない。

[measured引継ぎ] xa-1 7179efe→6cd9e70→3ad4f60。dev6は判断ログにround無し+取引停止でG0 BLOCKED、修理1後dev7は提出18・回収専用264/362、修理2後xas2はcalm/38005・G0 PASS・提出10件<30・回収専用4/710（ロック解消）・violations0/revert0。HEALTHY=no。2回修理後も不健全のため打ち切り、第3回未達扱いは本人報告事項。

<!-- source-xa1:start -->
| xa-1段階 | 版・結果 |
| --- | --- |
| dev6 | 7179efe: 判断ログにround無し+取引停止、G0 BLOCKED |
| 修理1 → dev7 | 6cd9e70: 提出18・回収専用264/362 |
| 修理2 → xas2 | 3ad4f60: calm/38005、G0 PASS、提出10件<30、回収専用4/710（ロック解消）、violations0/revert0 |
| 判定 | HEALTHY=no。2回修理後も不健全で打ち切り。第3回未達扱いは本人報告事項 |
<!-- source-xa1:end -->

初期7179efeのテスト39・赤対照39は履歴で今回再実行なし。時間制限付き単脚往復+lot台帳の旧診断案はsmoke 38003、本計測38001/38002×12=24世界（約104分+終了確認）。第3回はsmokeで打ち切り、本計測完了や平均T不合格の実測値は作らない。**決定論ライン全体は第2回まで収益未達、第3回も未達扱いで終了し、Q0のF_ref平均T≥multiには届かなかった。契約は緩めていない。**

[measured引継ぎ] xb-r-liveはv3初期コード・prompt v2・claude-cli:haiku・課金なし。F_ref、calm/whale/crash/depeg-persist×39001/39002、OFF1+ON3=32世界、全群G0 PASS・安全OK。全反復dT>0を満たさずPILOT-STOP。H1とは別のsim内自由改訂診断で、資格/提出許可ではない。 詳細は§5。

<!-- source-mix1:start -->
| 混成場診断・incz項目 | 引継ぎ・結果 |
| --- | --- |
| 構成 | u1の11体、zeta-2をcand=xb-r v3凍結に置換。xb-r-liveのagent.ts=d30cbbbとバイト同一（本人提示） |
| 範囲 | 12レジーム×seed40001/40002=24世界、mix1a/mix1b、p=3 |
| 時刻 | 2026-10-05 03:52 JST開始。旧06:30 JST頃見込みは実績に使わず、完了時刻は未提示 |
| 結果 | cand平均T52.18・5/11位・worst regime T47.6（全員で最良の最悪値） |
| G0 | G0は24世界中23世界PASS、crash/40001のみBLOCKED（grok-1のtelemetryが原因、candではない）。診断として全24世界を保持し、BLOCKEDをPASSとは扱わない。violations 0。 |
| 境界 | 契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。 |
| 総合1位 inc-zeta | 12レジーム等重み平均T 54.98 / worst regime T 39.4 |
| 総合2位 venue-arb | 12レジーム等重み平均T 54.35 / worst regime T 36.7 |
| 総合3位 grok-1 | 12レジーム等重み平均T 53.52 / worst regime T 43.9 |
| 総合4位 sonnet-1 | 12レジーム等重み平均T 53.34 / worst regime T 47.1 |
| 総合5位 cand(xb-r v3) | 12レジーム等重み平均T 52.18 / worst regime T 47.6 |
| 総合6位 opus-1 | 12レジーム等重み平均T 51.66 / worst regime T 44.4 |
| 総合7位 clean-arb | 12レジーム等重み平均T 50.20 / worst regime T 40.3 |
| 総合8位 astra-1 | 12レジーム等重み平均T 49.08 / worst regime T 41.4 |
| 総合9位 astra-2 | 12レジーム等重み平均T 48.97 / worst regime T 39.6 |
| 総合10位 sonnet-2 | 12レジーム等重み平均T 45.00 / worst regime T 35.2 |
| 総合11位 multi-arb | 12レジーム等重み平均T 36.73 / worst regime T 23.0 |
| cand calm | 平均T 53.0 / 平均順位 7.0 |
| cand cex-drift | 平均T 53.5 / 平均順位 3.5 |
| cand informed-flow | 平均T 52.0 / 平均順位 6.0 |
| cand whale | 平均T 49.0 / 平均順位 6.0 |
| cand lending-incident | 平均T 57.0 / 平均順位 2.5 |
| cand crash | 平均T 50.0 / 平均順位 5.5 |
| cand depeg | 平均T 54.1 / 平均順位 6.0 |
| cand vuln | 平均T 52.8 / 平均順位 6.5 |
| cand spike | 平均T 55.4 / 平均順位 2.5 |
| cand depeg-persist | 平均T 52.7 / 平均順位 6.5 |
| cand cdp-incident | 平均T 49.1 / 平均順位 5.5 |
| cand launch | 平均T 47.6 / 平均順位 6.0 |
| 観測の解釈 | [measured] mix1は12レジーム等重み平均Tでcand(xb-r v3)52.18・11体中5位、平均(50)より上。worst regime T47.6は全員で最良の最悪値。multi-arbは36.73・最下位。F_refの対multi-arb基準での負けと混成場での順位は逆の見え方。 |
| mix1単独時点の推測（rev 11履歴） | [inferred] 2 seed×12レジームなのでinc-zetaとの差約2.8Tはノイズの範囲とみる。sonnet-1(53.34)・opus-1(51.66)など既存候補とも有意に区別できないという見立てで、統計検定の結果ではない。 |
| mix2結果 | [measured] mix2はmix1と同じroster（u1の11体、zeta-2をcand=xb-r v3凍結に置換）。fresh seed40003/40004・12レジーム24世界、mix2a/mix2bともG0 PASS、violations 0。candは平均T51.63・6位・最悪46.2、inc-zetaは61.54・1位・最悪53.2。05:34 JST開始の引継ぎを保持し、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。 |
| mix2順位1 / inc-zeta | 平均T 61.54 / worst regime T 53.2 |
| mix2順位2 / venue-arb | 平均T 53.07 / worst regime T 39.5 |
| mix2順位3 / sonnet-1 | 平均T 52.49 / worst regime T 46.1 |
| mix2順位4 / opus-1 | 平均T 52.11 / worst regime T 43.6 |
| mix2順位5 / grok-1 | 平均T 52.07 / worst regime T 45.1 |
| mix2順位6 / cand(xb-r v3) | 平均T 51.63 / worst regime T 46.2 |
| mix2順位7 / clean-arb | 平均T 49.88 / worst regime T 42.9 |
| mix2順位8 / astra-1 | 平均T 49.20 / worst regime T 42.1 |
| mix2順位9 / astra-2 | 平均T 49.07 / worst regime T 40.8 |
| mix2順位10 / sonnet-2 | 平均T 44.40 / worst regime T 30.0 |
| mix2順位11 / multi-arb | 平均T 34.54 / worst regime T 23.5 |
| 48世界の範囲 | mix1+mix2・seed40001–40004・12レジーム等重み。mix1の1世界BLOCKEDを含め全48世界を診断として保持 |
| 48世界順位1 / inc-zeta | 平均T 58.26 / worst regime T 46.8 |
| 48世界順位2 / venue-arb | 平均T 53.71 / worst regime T 42.5 |
| 48世界順位3 / sonnet-1 | 平均T 52.92 / worst regime T 47.2 |
| 48世界順位4 / grok-1 | 平均T 52.80 / worst regime T 45.1 |
| 48世界順位5 / cand(xb-r v3) | 平均T 51.91 / worst regime T 47.6 |
| 48世界順位6 / opus-1 | 平均T 51.88 / worst regime T 44.5 |
| 48世界順位7 / clean-arb | 平均T 50.04 / worst regime T 42.8 |
| 48世界順位8 / astra-1 | 平均T 49.14 / worst regime T 41.7 |
| 48世界順位9 / astra-2 | 平均T 49.02 / worst regime T 42.5 |
| 48世界順位10 / sonnet-2 | 平均T 44.70 / worst regime T 36.3 |
| 48世界順位11 / multi-arb | 平均T 35.63 / worst regime T 24.9 |
| 48世界の観測 | [measured] mix1/mix2でseedを替えても順位は概ね安定（inc-zeta 1位・venue-arb 2位・multi-arb 11位）。mix1+mix2は12レジーム等重み・seed40001–40004の48世界。inc-zetaは平均T58.26、2位53.71との差は約4.5T（表示値の差4.55T）、最悪レジームT46.8。観測した混成場では明確な最強。cand(xb-r v3)は平均T51.91・5位・最悪47.6で、sonnet-1/grok-1/opus-1と約1T以内（表示値ではsonnet-1との差1.01T、grok-1との差0.89T、opus-1との差0.03T）。 |
| 現時点の推測 | [inferred] xb-r v3とsonnet-1/grok-1/opus-1はこの集計では区別できないとの見立てで、統計検定の結果ではない。決定論ラインxb-rの追加改良より、混成場で強い既存の独自戦略inc-zeta=zeta-a30（Claude+Codex作成の本命）を提出基盤にする案が示唆される。ただしinc-zetaはF_ref契約(Q0)未通過。D0のF_ref診断はcommit不一致でG0 FAIL、性能は診断のみ。 |
| incz完了・診断結果 | [measured] inczはinc-zeta（ascon-zetaのzeta-a30パラメータ・frozen）をF_ref(cand+noop+multi-arb+clean-arb)で12レジーム×seed40005=12世界。全計測終了・走行中なし。G0 PASS・362ループ・違反0。12レジーム等重み平均T cand 56.30 / multi-arb 44.44（candが上）。1世界平均P 1343.6 / 730.0 / 281.1、取引数254.2 / 253.0 / 42.2（cand/multi/clean）。noop割れ4/12世界、平均(T−Tnoop)<0のレジーム4（最悪informed-flow −8.12）。cand mined revert平均0.2/世界（multi-arb 8.4）、submitted3057/failed90（2.9%）。07:20 JST頃開始との引継ぎ（旧05:40頃開始見込みを訂正）、約55分。旧08:15 JST頃の完了見込みは実績ではなく、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。 |
| incz解釈・資格境界 | [measured] inc-zetaは混成場48世界で明確に1位。F_refの1 seed診断でも平均Tがmulti-arbを上回り、Q0の「平均T≥multi-arb」は満たす方向。一方「全12レジームで平均(T−Tnoop)≥0」は8/12のみで、4レジームのnoop割れは契約の安全/対noop条件に反する方向。[inferred] 各レジーム1世界でノイズが大きく、資格の合否判定にはならない。inc-zetaの資格試験は5 seed×12=60世界・約4.5hの見込み。第1・第2候補sonnet-1/opus-1で初回資格枠は使用済みのため、新しい契約・回数の枠Q-ZETA-01へ進むことを2026-10-05の本人チャットで承認済み。契約下書き・結果は未確認。既決の修理済み1候補1回枠をinc-zetaへ自動転用しない。 |
| incz noop割れ P−noop | cex-drift −52.8 / informed-flow −131.4 / lending-incident −104.8 / vuln −142.1 |
| inczレジーム / calm | 平均T cand 61.00 / multi-arb 36.80 |
| inczレジーム / cex-drift | 平均T cand 43.68 / multi-arb 64.12 |
| inczレジーム / informed-flow | 平均T cand 47.59 / multi-arb 39.14 |
| inczレジーム / whale | 平均T cand 60.32 / multi-arb 53.22 |
| inczレジーム / lending-incident | 平均T cand 44.61 / multi-arb 41.37 |
| inczレジーム / crash | 平均T cand 64.06 / multi-arb 41.67 |
| inczレジーム / depeg | 平均T cand 55.78 / multi-arb 35.93 |
| inczレジーム / vuln | 平均T cand 54.35 / multi-arb 36.17 |
| inczレジーム / spike | 平均T cand 56.58 / multi-arb 57.55 |
| inczレジーム / depeg-persist | 平均T cand 60.03 / multi-arb 36.35 |
| inczレジーム / cdp-incident | 平均T cand 63.49 / multi-arb 46.95 |
| inczレジーム / launch | 平均T cand 64.09 / multi-arb 43.96 |
<!-- source-mix1:end -->

[measured] mix1は12レジーム等重み平均Tでcand(xb-r v3)52.18・11体中5位、平均(50)より上。worst regime T47.6は全員で最良の最悪値。multi-arbは36.73・最下位。F_refの対multi-arb基準での負けと混成場での順位は逆の見え方。 G0は24世界中23世界PASS、crash/40001のみBLOCKED（grok-1のtelemetryが原因、candではない）。診断として全24世界を保持し、BLOCKEDをPASSとは扱わない。violations 0。 契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。

[inferred] xb-r v3とsonnet-1/grok-1/opus-1はこの集計では区別できないとの見立てで、統計検定の結果ではない。決定論ラインxb-rの追加改良より、混成場で強い既存の独自戦略inc-zeta=zeta-a30（Claude+Codex作成の本命）を提出基盤にする案が示唆される。ただしinc-zetaはF_ref契約(Q0)未通過。D0のF_ref診断はcommit不一致でG0 FAIL、性能は診断のみ。

[measured] mix2はmix1と同じroster（u1の11体、zeta-2をcand=xb-r v3凍結に置換）。fresh seed40003/40004・12レジーム24世界、mix2a/mix2bともG0 PASS、violations 0。candは平均T51.63・6位・最悪46.2、inc-zetaは61.54・1位・最悪53.2。05:34 JST開始の引継ぎを保持し、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。

[measured] mix1/mix2でseedを替えても順位は概ね安定（inc-zeta 1位・venue-arb 2位・multi-arb 11位）。mix1+mix2は12レジーム等重み・seed40001–40004の48世界。inc-zetaは平均T58.26、2位53.71との差は約4.5T（表示値の差4.55T）、最悪レジームT46.8。観測した混成場では明確な最強。cand(xb-r v3)は平均T51.91・5位・最悪47.6で、sonnet-1/grok-1/opus-1と約1T以内（表示値ではsonnet-1との差1.01T、grok-1との差0.89T、opus-1との差0.03T）。

[measured] inczはinc-zeta（ascon-zetaのzeta-a30パラメータ・frozen）をF_ref(cand+noop+multi-arb+clean-arb)で12レジーム×seed40005=12世界。全計測終了・走行中なし。G0 PASS・362ループ・違反0。12レジーム等重み平均T cand 56.30 / multi-arb 44.44（candが上）。1世界平均P 1343.6 / 730.0 / 281.1、取引数254.2 / 253.0 / 42.2（cand/multi/clean）。noop割れ4/12世界、平均(T−Tnoop)<0のレジーム4（最悪informed-flow −8.12）。cand mined revert平均0.2/世界（multi-arb 8.4）、submitted3057/failed90（2.9%）。07:20 JST頃開始との引継ぎ（旧05:40頃開始見込みを訂正）、約55分。旧08:15 JST頃の完了見込みは実績ではなく、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。

## 2. 維持する本人決定

[本人決定・チャット承認 2026-10-05 JST] 3点を「進める」: inc-zeta（ascon-zetaのzeta-a30）の実質的改変を独自戦略と認め、multi-arb派生を開示して条件付き第一候補にする。弱点診断後、現行閾値を維持した新契約・回数枠Q-ZETA-01（F_ref・12レジーム×5新seed=60世界・約4.5h）で資格試験へ進む。上流統合・適応とleague追加分を分割PRにし、Claudeの別エージェント+agyによる独立レビュー・CI後、merge commitで統合する。 承認は準備と新枠の方針を確定したもので、資格合格・merge完了・提出許可ではない。Q-ZETA-01の契約登録・試行上限の明文化・未使用seed監査・焼き込み設定/hash・診断/安全・全残費の証跡は未確認。約4.5hは見積で、通常6h/日・forward100hと既決留保を維持する。旧Q0-A-REQUAL-01の1候補1回・41301–41305・5h枠を自動転用せず、旧3/3回目打ち切りを解除しない。

- **Step1は決定論コアのQ0を優先、10/8受理目標の延期は既決**。新受理日は資格・ON校正・G4の証拠から見積もる。診断のFROZENと提出時の改訂構成は別。
- 独自戦略1体のみ。参照の改名・設定移植のみへ戻さない。由来と意思決定・資金・退出の実質差を説明する。
- V2は最大約20h・2新世代まで。予備15→3hへの交換は既決。20hの承認上限と、残枠による実際の解放額は別。
- **forward 100h（10/4以降）は既決**。過去込み案へ戻して再質問しない。18.6h以上の過去消費は別記する。
- dec-008（旧期日10/7）は本人報告でresolved。本人の現在作業なし。10/28最後にdec-007で未確認事項を再確認。送信・登録・確認・受理は別状態（§10）。
- 運営への質問なし。10/8未受理なら10/9に本人が質問方針を再判断する。
- p=3・等速、同一ホストのCPUを使う生成/検査/buildとmatrixは排他。軽量な解析・設計・隔離した次版編集は並行し、測定入力を変更しない（§8）。背景コマンドは2h未満・hard limit110分。親roundのchunk間も入力/HEAD/実行中スクリプトを変更しない。
- 約8hの夜間自律枠は過去の許可。夜間に実際にM1/Q0まで進んだ事実を記録し、revision 2の未解放記載を遡って承認へ変えない。次の拡張許可には使わない。

優先: **xb-r修理・再診断/G0 → 現Q0 → mix/P60・最小改訂適合/G3/G4・受理S → 決定済み限定AIの全費用確認 → AI検証 → 既資格候補がある時だけ深いリーグへ切替 → 二場封印確認 → 最終適合/受理**。旧「M1未実施」「Q0未着手」「2c running」は失効。Q0不合格の緩和、20hの再承認、過去u1mの資格流用はしない。

## 3. 場とゲート

### 3.1 固定する場

| 場 | 構成 | 役割 |
|---|---|---|
| F_ref | 候補＋noop＋multi-arb＋clean-arb、採点3体 | D0/因子、現行Q0/Q0b/Q1、最終非劣性co-gate |
| F_mix | 固定相手10＋候補置換slot1＋noop、採点11体 | smoke、旧Q0mは不採用、新しい主yardstick。u1mとは別集合 |
| F_bid | 狭い高入札専用場 | 基本予算から廃止。F_mixの代用なし |

相手案: venue-arb、multi-arb、clean-arb、astra-1、astra-2、sonnet-1、sonnet-2、opus-1、inc-zeta、fixed-bid-5gwei。最後の対照の存在/適合/hashは未確認。候補と同名の固定相手もslotを保持し、別財布・独立状態とする。競技へ複数提出する意味ではない。ロスター/依存/prompt/hash/財布順を初回結果の前に固定する。不適格相手は結果前に全体再登録、結果後の選択除外は禁止。既存契約は全員FROZEN（G3/H/最終P60/配置の候補はON）。AI専用E3/Q1は§6で候補ONと決定。S/R*は同居させず同slot・同seedの別世界で比較する。

### 3.2 Gate契約（Q0はA維持、追加revert条件は新資格だけ）

| Gate | 必須条件 | 現状 / 不成立時 |
|---|---|---|
| G0 | begin、予定集合100%・重複0、有限P、360blocks/2秒/362loops、failedReads/violations/timeout/早期終了0、p99<1,000ms。同場p3対照から被覆低下≤1pp・catch-up増加0、親/chunk/hash一致 | sonnet Q0は3chunk PASS。opus Q0bはA/C PASS・B FAIL（vuln 2世界361/362loops）。旧FAIL保存・救済再走なし（論点5決定） |
| G1 | 新E3全12×3のR*−P平均≥+1T、最悪レジーム差≥−2、平均Δ(P−noop)≥0、安全/仕様一致 | 実用screen。有意性/採用保証ではない。失敗で次点/同seed修理へ戻らない |
| G2-Q現行 | F_ref全12×新5seed、等重み平均T≥multi-arb、全12の平均(T−Tnoop)≥0、未回収自前資産損失/gas枯渇/無効注文0、世界別P確認 | sonnet Q0・opus Q0bとも平均T FAIL。Q0b後続診断あり、全契約証跡は未確認。旧保存値のnullを0にせず、閾値を後付けしない |
| G2-Q0m草案 | 旧F_mix競争条件案。将来再検討時は既知情報開示と新契約が必要 | 未署名・失効・今回不採用。旧Q0 FAILは永久保持。Q1へ自動拡張しない |
| G2-final | F_mix改善＋F_ref非劣性＋両場安全/尾部、独立10seed、§6で一回判定 | 未実施。不明/同点/欠測なら適合受理版S維持。S不適合時は本人判断 |
| G3 | 最小: 正常cycle≥3、制御ケースで実変更適用/復帰、全改訂検査100%、遅延/無効出力/枠切れで危険取引0。full: SはF_mix ON/OFF各36、R*はON3/OFF1の各36、各反復平均差≥−1T・最悪≥−3 | 未実施。提案/拒否/受理/適用を区別。FROZENでは本番改訂を代替できない |
| G4 | clean release、envなし既定、decide＋frontmatter、自己完結import。typecheck→関連/必須検査・check:strategy→public60→bundle/scan 0 BLOCK→build/selftest(2vCPU/4GB)、提出commit ci-local full、固定upstream住所bytes/ZIP hash | 未実施。ローカル73 testsは実装証拠のみ。最新仕様/外部適合は今回未検証 |

D0/E1/E2/決定論E3/Q0/P60初回/smokeはFROZEN。AI専用E3/Q1は候補ON、G3はON/OFF対応、H/最終P60/配置は候補ON。全改訂履歴hashを残す。AI-G3-01はR*のみON3応答履歴/OFF1、Sは既存full G3、epoch間学習持越しなしと決定。LLM待ちが非同期でもG0免除にはならない。G0の故障注入は通常matrixと別にする。

夜間の運用注記: キュー実行中の書換えで末尾構文エラー（測定は完走・G0 PASSとの報告）。生成/検証の並行実施も報告され、G0の負荷PASSだけで排他手順の遵守を証明できない。報告されたG0を勝手に再判定はしないが、実行スクリプト固定・排他記録・親manifest監査は次の入口条件。事後manifestでbegin欠落を埋めない。

## 4. 現行閾値の新資格契約と初回提出

[measured] inc-zetaは混成場48世界で明確に1位。F_refの1 seed診断でも平均Tがmulti-arbを上回り、Q0の「平均T≥multi-arb」は満たす方向。一方「全12レジームで平均(T−Tnoop)≥0」は8/12のみで、4レジームのnoop割れは契約の安全/対noop条件に反する方向。[inferred] 各レジーム1世界でノイズが大きく、資格の合否判定にはならない。inc-zetaの資格試験は5 seed×12=60世界・約4.5hの見込み。第1・第2候補sonnet-1/opus-1で初回資格枠は使用済みのため、新しい契約・回数の枠Q-ZETA-01へ進むことを2026-10-05の本人チャットで承認済み。契約下書き・結果は未確認。既決の修理済み1候補1回枠をinc-zetaへ自動転用しない。

### 4.1 Step1: inc-zetaの新資格を通し、受理Sを確保する

[本人決定・チャット承認 2026-10-05 JST] 3点を「進める」: inc-zeta（ascon-zetaのzeta-a30）の実質的改変を独自戦略と認め、multi-arb派生を開示して条件付き第一候補にする。弱点診断後、現行閾値を維持した新契約・回数枠Q-ZETA-01（F_ref・12レジーム×5新seed=60世界・約4.5h）で資格試験へ進む。上流統合・適応とleague追加分を分割PRにし、Claudeの別エージェント+agyによる独立レビュー・CI後、merge commitで統合する。

[進行中・本人引継ぎ] zeta-prep（Astra）がnoop割れ4レジーム（cex-drift/informed-flow/lending-incident/vuln）の診断、測定設定を焼き込むrelease候補example/agents/ascon-zeta-r/、ascon-notes/league/INC-ZETA-ORIGIN-2026-10-05.md、ascon-notes/league/Q-ZETA-01.mdの下書きを作成中。存在する/作成中の参照のみで、結果は未確認。由来はINC-ZETA-ORIGINへ記録予定。

[独立意見・引継ぎ] Codex(Astra)は賛成。ただし「今のまま merge/提出してよいとは判断しない」。分割点候補は3d86a35。提出物混入は確認範囲で重大なしだが、直書き秘密の全件監査・実ZIP検査・運営配布版との一致は未確認。現行CIのnpm ciにNPM_CONFIG_IGNORE_SCRIPTS=trueが無く作業ルールと不整合のため修正対象。inc-zetaの測定設定（bidMode:2等はrosterの環境変数）はコード既定値（bidMode:0）と違い、そのままbundleすると再現しないため焼き込み候補を固定する。noop割れ4レジームを先に診断する。契約の場を混成場へ変える案は結果を見たあとの基準変更になるため推奨しない。

承認は準備と新枠の方針を確定したもので、資格合格・merge完了・提出許可ではない。Q-ZETA-01の契約登録・試行上限の明文化・未使用seed監査・焼き込み設定/hash・診断/安全・全残費の証跡は未確認。約4.5hは見積で、通常6h/日・forward100hと既決留保を維持する。旧Q0-A-REQUAL-01の1候補1回・41301–41305・5h枠を自動転用せず、旧3/3回目打ち切りを解除しない。

反証条件: 独立60世界で平均T<multi-arb、いずれかのレジーム平均(T−Tnoop)<0、mined revert>1件または包含取引比>0.1%、原因不明の失敗、未回収自前資産損失/gas枯渇/無効注文>0のいずれかで停止する。G0・既決安全条件も維持し、閾値緩和・結果後の場変更・救済再走で合格にしない。

**旧xb-r枠の決定・証拠（不変）**: 以下のQ0-A-REQUAL-01と§8.3は旧系統の契約として保持し、Q-ZETA-01へ自動転用しない。

**10/8延期・設計修理は本人決定済み。延期自体を再承認へ戻さない。** 現状Q0資格不可。dev4 v3とdev5 v5は平均T条件未達、第3回xa-1は2回修理後もHEALTHY=noで打ち切り。§8.3のfresh screen未成立につきQ0停止を維持し、旧系統の打ち切りを維持する。inc-zetaは本人承認済みの別契約へ進む。mix1は5/11位・最悪値1位の診断結果（§1.7）で、G0の1世界BLOCKEDを保持する。mix2・48世界集計は診断として受領。inczは診断完了・平均T56.30対44.44、noop割れ4/12。全計測終了・走行中なし。inc-zetaもF_ref契約(Q0)未通過。いずれも資格合格・旧Q0m・提出可否への転用不可。受理済み版の確保は未完了。

**論点4の決定: A（現行維持）**。厳しいF_ref資格条件として維持し、届かなければ停止する。Bの場変更は不採用、CのF_u1m追加資格も不採用。3体採点で参照2体のPが等しい極限では候補との差が約±21.21Tとなるため大勝額だけでは多数の負けを埋めにくいが、これを旧FAIL無効化の根拠にはしない。

新Q0再資格は**修理済み1候補・1回・F_ref/FROZEN・全12×41301–41305=60世界**。旧「第2候補1回まで」とは別の追加1回としてAstraが決定する。seedは担当者の全履歴未使用性監査・stream/scorer整合・候補/依存/prompt/roster/slot/判定コードhash固定後に登録完了とする。Q0用固定hashは§8.3の診断screen・担当照合待ちで未確定、架空値で埋めない。衝突時は結果閲覧前に全seed集合を差し替え記録。最大18世界、18+18+18+6の4chunk、基本13/3h＋終了確認2/3h=**5h上限枠**を§7のdeep内で優先留保し、校正で超過なら開始しない。修理/再診断・dev1既消費は別途精算。全量一回開封、欠測/不良で停止、性能救済再走・次点・seed追加なし。

| 現行維持と別の追加条件 | 採否 | 理由・残す記録 |
|---|---|---|
| 等重み平均(P候補−Pmulti)≥0 | 不採用 | 現Q0の平均T条件と別条件。P差は全量報告し、最終二場で評価 |
| 全資格世界P−noop≥0 | 不採用 | 全世界無損失を新たに必須にせず、全世界値・割れ数・最悪値を報告 |
| 絶対P≥0 | 不採用 | P−noop・未回収元本と別指標。市場損失を資金回収欠陥と同一視しない |
| F_u1m非劣性 | 不採用 | 追加120世界/費用を解放しない。既存の最終F_mix/F_ref二場判定を維持 |
| 送信失敗率の親に対する非劣性 | 不採用 | submit_failedは別欄全件報告。承認/資金不備の反復や未処理状態は許容しない |
| mined revertの数値上限 | 採用（論点6、新資格のみ） | 下記件数・比率を同時要求。現行競争条件の緩和ではない |

**論点6の決定**: 候補自身の各60世界セットで **mined revert≤1件、かつ全包含取引数比≤0.1%**。分母はその候補の同セットの全包含取引（成功＋revert）、送信前失敗は含めない。分母0でrevert0なら件数条件は満たすが比率はN/Aと記録し、取引なしを資格PASSとはしない。分母0でrevert>0は計数不整合でFAIL。1件なら包含数≥1000が必要。原因不明・片脚回収不明・承認/資金不備の反復は件数内でもFAIL。これは政策閾値で、旧結果へ遡及適用しない。結果を見て当該試験の閾値を緩めない。60以外のG3/H等の集合へ無断で換算せず、それぞれの既存安全条件を維持する。

**DR-Q-01との関係**: [修理設計](DESIGN-REPAIR-01-astra.md)は変更せず設計案として保存する。その未署名追加P/F_u1m条件・費用一式を承認した意味ではない。実行契約は本節のQ0-A-REQUAL-01。損失許容を事前明文化し、未回収自前資産損失/gas枯渇/無効注文0と現Q0閾値は維持する。

**決定署名**: 本人が 2026-10-04 に Astra へ判断を委任。Astra が決定。署名者=本人委任のAstra決定。署名日時=2026-10-04T15:00:11+09:00（今回の決定記録時刻。Masashi本人の署名・過去の委任時刻を代署したものではない）。
入口は現Q0閾値と測定適合。出口はQ0 PASS→mix smoke/P60→最小の実改訂可能policy・機械的安全境界→最小G3/G4→本人送信/受理メール・ZIP hash。**「Step1決定論のみ」はQ0で利益機構を検証する方針であり、改訂を永久無効にした提出を適合扱いする意味ではない。** xb-rのnull固定promptは受理用policyではない。AIで性能を伸ばす研究はS受理後へ回すが、提出上必要な改訂適合は受理前に済ませる。

独自性は由来・借用・意思決定・資金/退出の実質差で確認する。ascon-*の隔離releaseへ移す際、policy/core/runtime変更の範囲と再資格/ON検査費を事前固定する。FROZENのPASSを、変更済みコアやON版へ自動移転しない。

### 4.2 Q0失敗・境界不成立時の停止

契約の判断は確定済みだが実行証跡は未成立。§8.3の診断screen、修理・再診断後の固定hash、未使用seed、G0/安全、5h枠と全残費の校正が揃うまでQ0を開始しない。Q0不合格なら後続AI・深い探索へ進まず停止する。受理Sは未確認で、参加可能とは断定しない。旧Q0bの救済再走はしない。

別版F_mix Q0mは今回不採用。§4.3の原案は失効した未署名記録のみで、現在の待ち判断や実行キューとして扱わない。新たな対応比較でF_refと混成場の持続的な逆行が示された場合だけ、将来の別契約として再検討する。

### 4.3 Q0-AMEND-01（未署名・失効記録・今回不採用）

**原案は未署名の記録として保持。Q0b結果が既知になったため、下記「閲覧前」の原案では署名・実行へ進めない。** 別版F_mix Q0mを選ぶ場合は既知Q0bとG0不良を明記した別版を作り、新F_mix結果の閲覧前に署名する。以下は原案の条件であり現行契約ではない。

> **目的（原案の記録）**: 既知のsonnet-1 Q0 FAILを保存したうえで、初回候補の競争条件を新たな混成場で検証する。原案の既知情報はMORNING引継ぎ（07:45 JST）、D0/Q0/u1m/M1。当時未知のQ0b結果および新F_mixのsmoke/資格結果を本人・判定担当が閲覧する前に署名する条件だった。この時点を過ぎたため、この版を事前登録として有効にせず、既知情報を開示した別版・別集合を作る。
>
> **候補**: sonnet-1 Q0と政策/設定/prompt/依存の同一hash。Q0bの強弱でopusへ切替えない。F_refでの現行Q0 FAILは保存し、F_ref全12の対noop・安全証跡を保持する。未回収欄等の欠落は埋まるまでBLOCKED、n/aを0にしない。
>
> **場・測定**: §3.1の固定10相手＋候補slot＋noop。全員FROZEN、p=3、同一scorer/stream/共有入力。候補と同じ世界のmulti-arbを比較する。12レジーム×**41201–41205**=60世界。世界別P/P−noop/T/Tnoop/Tmulti、相手P、μ/σ、gas枯渇/未回収自前資産/無効注文/違反/revert/送信失敗/G0を保存する。seed未使用性は実行担当が別途確認し署名前に証明。衝突時は集合全体と本文を結果前に差替え、再署名する。
>
> **PASS（すべて必要）**: 全60世界G0 PASS・欠測/重複0、12レジーム等重みの平均(T候補−Tmulti)≥0、各12レジームの平均(T候補−Tnoop)≥0、未回収自前資産損失/gas枯渇/無効注文/違反0。既存F_refの対noop/安全条件も維持。世界ごとの負け件数・最悪P−noop・revert/送信失敗は全件報告し、事後に除外も新しい許容閾値も作らない。
>
> **開封/停止**: smokeは43001全12の別集合で、G0/安全/執行だけを点検する。smokeの収益を候補調整へ渡さず、欠陥で修理した場合このhash契約を無効として停止。Q0mは18+18+18+6世界の4chunk案、全予定G0後一回開封。G0不良は停止、性能不良の再走/seed追加/次点候補なし。u1mを新F_mixの代用品にしない。
>
> **費用/効力**: forward予算の改訂列143/30hを上限予約（4chunk案自体は13/3h見積）。これは競争の評価場だけを移す別契約で、安全/G3/G4/独自性/最終二場基準は緩和しない。Q1には波及しない。Q0bは現契約で完了・FAILを別記済み。本原案の候補選択に使わず、未署名の効力も生じない。
>
> **原案の署名状態**: 未署名のまま失効、署名者・署名日時とも「該当なし（未署名・今回不採用）」と記録する。Masashi本人や担当者の署名を代署しない。固定hash/未使用性/未閲覧証跡も未提出。論点4のA決定はこの原案への署名ではない。

## 5. S受理後のAI提案層と実験棚

現在のAI権限は本人決定のH1。設計時点で未決だった[AI-PILOT-DESIGN](AI-PILOT-DESIGN-2026-10-04.md)の推奨案を選択した。実行仕様は[XB-R-AI-PILOT](XB-R-AI-PILOT-2026-10-04.md)を参照する。決定と実装の成立範囲、形式確認と性能を以下のように区別する。

<!-- h1-current:start -->
| AIパイロット項目 | rev 10の事実・境界 |
| --- | --- |
| 本人決定・仮説 | [本人決定 2026-10-04] AI-PILOT-DESIGNのH1・推奨案「検査済み方針の選択+ENTRY」を選択。全面コード改訂（executorTs自由）は見送り。決定論の改良で大きな改善が見込めないなら、推論ありモードなど大きく改善される仮説へ切替える（本人提案）。 |
| 実装・安全境界 | [measured・コード確認の引継ぎ] xb-r-ai a95054aはH1を実装、テスト213・赤対照25。標準runtimeはdecide全体（executorTs）を差し替えるため、(a)固定テンプレ限定・(b)エージェント側検証のどちらも安全境界として成立せず、現状はON起動を拒否する。強制には運営側の受付機構/専用adapterが必要。提出物はruntimeを改変できず、scan-submissionのVENDOREDがBLOCKする。本番の改訂は事実上プロンプト誘導に頼り、機械的な安全保証はない。今回コード・テストの再確認はしていない。 |
| H1の設定 | 3方針（v5標準 / v5+R11 / v5+R7厳格化）とENTRY 20–60bps・5bps刻み・最大±5bps。初期・復帰v5/50、更新なし120blockで復帰。旧rev 6のENTRY単独・初期60の署名契約は履歴として不変。 |
| 形式確認 | [measured引継ぎ] agy GPT-OSS 120B（Medium・無料枠・本番と同系統のモデル）の形式確認はsparse/selection/injection各1回、validator ok=true。sparseとinjectionはnullで期待どおり。selectionは答えを指定した形式試験で能力評価ではない。runtime/haiku/性能へ外挿しない。本人Ollama鍵の疎通確認や本番無料枠の検証ではない。 |
| 推論の費用方針 | [方針] 課金なし。シミュレーション内の改訂はclaude-cli:haikuを第一、既存サブスクのcodex小型モデルを第二候補とする（利用可能なmodel IDは未確認）。ローカルOllamaと本人のOllama鍵・無料枠（本番と共有）は使わない。追加課金・APIへの暗黙fallbackは認めない。 |
| パイロット仕様・停止条件 | H1専用adapterは未実装・標準ON拒否のまま。旧H1の32世界案は未解放。別系統xb-r-live（v3初期コード、標準runtime自由改訂）は同4レジーム×39001/39002・OFF1+ON3=32世界を測定しPILOT-STOP。使用済みseedをH1のfresh seedとして再利用しない。 |
| 本人に残る判断 | [本人決定・チャット承認 2026-10-05 JST] 3点を「進める」: inc-zeta（ascon-zetaのzeta-a30）の実質的改変を独自戦略と認め、multi-arb派生を開示して条件付き第一候補にする。弱点診断後、現行閾値を維持した新契約・回数枠Q-ZETA-01（F_ref・12レジーム×5新seed=60世界・約4.5h）で資格試験へ進む。上流統合・適応とleague追加分を分割PRにし、Claudeの別エージェント+agyによる独立レビュー・CI後、merge commitで統合する。 10/4の全面改訂見送りは原記録に保持。sim内の自由改訂結果は、本番で安全保証なしで本番と同条件で測るかという判断や提出承認を代替しない。 |
<!-- h1-current:end -->

[measured引継ぎ] xb-r-liveはv3初期コード・prompt v2・claude-cli:haiku・課金なし。F_ref、calm/whale/crash/depeg-persist×39001/39002、OFF1+ON3=32世界、全群G0 PASS・安全OK。全反復dT>0を満たさずPILOT-STOP。H1とは別のsim内自由改訂診断で、資格/提出許可ではない。

<!-- source-live:start -->
| live群 | 平均T | dT | dAlpha | worst | installed / declined / rejected |
| --- | --- | --- | --- | --- | --- |
| OFF | 54.74 | — | — | — | — |
| ON1 | 48.91 | -5.83 | -229.4 | -19.75 | 9 / 26 / 5 |
| ON2 | 52.80 | -1.93 | -26.9 | -5.68 | 1 / 25 / 14 |
| ON3 | 53.62 | -1.11 | +178.7 | -4.50 | 1 / 26 / 13 |
<!-- source-live:end -->

<!-- source-live-safety:start -->
| live校正・安全・解釈 | 提示事実 / 境界 |
| --- | --- |
| 初回校正 39101 / prompt v1 | TSモジュール全体を返しcompile failed、installed 0 |
| 再校正 39102 / prompt v2 | installed 1。WBTC slippage許容80→100bps、安全節に反する変更（sim内のみ） |
| WBTC除外の根拠 | 実ログで支持できない。WBTC 16取引の固定価格損益+63.34 USDC |
| 全群の安全と性能 | 全群G0 PASS・安全OKは観測。平均Tの増分は全ONで負、適用の多い群ほど悪化、形式不備rejectedが多い。因果効果/安全保証ではない |
| 本番の見立て | gpt-oss:120bはHaikuより弱い可能性が高い（推測、実測比較なし）。標準runtimeは安全な枠を強制できず、提出物はruntime改変不可。H1 ON拒否を維持 |
<!-- source-live-safety:end -->

dT/dAlphaは各ONと同じ8セルのOFFとの差、worstはレジームごとのseed平均dTの最小。事前登録は**全反復でdT>0、dAlpha>0、worst≥−2**が必要（[OVERNIGHT §3.3](OVERNIGHT-2026-10-05.md)）。全ONのdTが負でPILOT-STOP。ON3のdAlphaが正でも救済しない。AI改訂は平均Tでプラスにならず、適用の多いON1ほど悪化した観測で、適用回数の因果効果とは断定しない。形式不備のrejectedも多い。

校正smokeは初回39101/prompt v1がTSモジュール全体を返してcompile failed、installed 0。v2/39102でinstalled 1。適用した改訂は**WBTCのslippage許容80→100bps**で、prompt安全節に反する変更（sim内のみ）。HaikuのWBTC除外根拠は実ログで支持できず、WBTC **16取引の固定価格損益+63.34 USDC**との引継ぎ。全群G0 PASS・安全OKという観測は、このprompt違反や機械的安全境界の不成立を打ち消さない。

[推測・方針] 本番gpt-oss:120bはHaikuより弱い可能性が高いという見立てで、モデル間の実測比較ではない。標準runtimeでは改訂に安全な枠を強制できず、提出物はruntimeを改変できない。**H1（xb-r-ai）はON拒否を維持**。自由改訂simの結果を本番許可・安全保証・Q0/G3合格へ拡張せず、ON4/同seed救済再走は行わない。

**rev 6の論点1・署名契約の保存**: Step2/3は事後分析からENTRY_BPS限定、因子switch/任意executorTs不採用という当時の決定を変更せず保持する。H1パイロットの3方針・初期50は今回の本人選択であり、この旧契約を遡及変更したものではない。R*反復・Q0・費用・受理順序の既決契約は不変。

<!-- ai-parameters:start -->
| 許可パラメータ | 初期値 | 許可範囲 | 刻み | 1回の最大変更幅 | 更新間隔 |
|---|---|---|---|---|---|
| ENTRY_BPS（新規entryの入口だけ） | 60 bps | 20–60 bps | 5 bps | ±5 bps | 60 block以上 |
<!-- ai-parameters:end -->

旧契約の根拠はE1の60→20bpsで、最適値や検証済み利益の意味ではない。初期/復帰60bps、5bps刻み・最大±5bpsは政策値。観測から60block有効、更新なし120blockで復帰、epoch開始は60bps・学習memoryなし。受付時は整数・範囲・刻み・直前値との差・観測鮮度を検査し、同一intervalで複数適用しない。入口値をnet利益式・サイズ・bid予算の控除へ流用しない。epoch内の未解消在庫・予約・cooldown・receipt照合状態は保持し、前epochの改訂コードを復元しない。H1は初期/復帰v5/50を用いる別仕様で、受理版Sへ無断で置換しない。

canFund・資金予約・在庫/サイズ上限・MIN_PROFIT・bid・slippage・退出・送信先をAIから保護し、return/submit双方を外側ゲートへ通す要求は維持する。ただし標準runtime上の固定テンプレート限定もエージェント側validatorも改訂で置換できるため、その要求を満たさない。ローカル専用adapterの工学試験は本番の安全保証・提出適合を証明しない。全面改訂の本人判断が未許可の間は標準ONを開始しない。

以下のxb/M1/M2は**AI実装・反復の置換元となる棚**。深い探索にAI費を足し増さない。AI受付/費用/実効性が成立しなければSを維持し、無理にAI機能を増やさない。

### 5.1 xb-core因子（実装済み、実測0）

V0=B、V1=A入口60→20bps、V2=BID、V3=A×BIDの完全2×2。E1はcalm/cex-drift/informed-flow/crash/cdp-incident/launch×31001/31002、各12・計48世界。入口edgeをサイズ/利益式から分離し、P−noopとTの対応差の差を出す。

**BIDの水準は「10%の追加予算を使い切る」対「競合の少し上までで支出を止める」**。利益の10%は既定floorに上乗せするextraの上限。BID0=min(ceiling,F+E)、BID1=min(ceiling,F+E,max(F,competitor+0.1gwei))。BID1はBID0より高くならない。「競争を強める」因子ではなく、低い競合下の支出節約。払えない競合targetはclipし、見送りDとは別。共通guardはBID0で資金予約し、BIDだけで候補/sizeを変えない。floorは10%の外、共通MIN_PROFIT=0.05、正priority、canFund/現有売り脚/退出を維持。

V4 SIZ、V5 INV、V6 Liquity、V7 GATEは実装棚、単独48世界は未解放。READMEのbase fee=0、固定gas見積、gas実費未測定の制約を残す。**実走前にxb-core/xb-v0–v7と依存を計測用worktreeへ揃え、固定commit・完全hash・begin-manifest・mode=FROZENを記録**する。dev1-xb-rは§1.5の完了診断で、E1の31001/31002は既見。ここにある因子棚は別契約/解放なしにコピー・実走しない。本担当はそのworktreeを開かない。

### 5.2 M1からD/E/A、M2は既定で省略

D=払えるbidが競合へ届かない単脚は見送る。E=無条件余剰WETH掃き出しを条件付きへ替える。A=事後markoutで閾値/サイズ/方向別entryを制御。D/Eを共通親から1因子ずつ作り、既存coreの修理と独立利益源の発明を区別する。Dはvenueに無関係な競合maxと75bps控除による入口変更を混ぜない。Eは0.1gweiの強制売りを残して漏れを再導入しない。Aは2legの約定復元/評価幅/入札順位の交絡を先に規定する。

D/E実装各0.75h＋A仕様/観測復元0.40h=1.9hの支援上限。A本実装は追加0.75hの見積棚（未予約）。観測復元が成立し、未使用枠から明示振替できた時だけ開始する。追加修理も未予約、時間切れは未完のまま残す。M1全16を再生成しない。D/E/親を各8世界、新診断34001/34002で測る棚は1.95h。これはE1又はM2の代替として事前に選び、単純追加で20hを越えない。測る前に実装/親/hashと下流E3/Q1費を予約する。

M2は従来のAstra/Opus×F−/F＋の4生成、共通親・許可2因子、各20分/4k tokens。現担当はCodex(Astra)主・Claude副、独立レビューはClaudeの別エージェント+agy（§8.1）。Grokは残高切れ402で外れた。本作業でM2は起動しない。F＋だけE1、F−は同量一般資料。E2開封前に4版と親を凍結。**論点3によりM2配分は0h**。M1の重複と初回経路の追加費用から、生成を増やすより機構を分ける。

<!-- deep-stages:start -->
| ID | 世界数 | 13分/p3の正確h | 用途 |
|---|---|---|---|
| factor-ab | 48 | 52/15 | E1 V0–V3、従来の決定論棚（AI費振替前） |
| m2 | 60 | 13/3 | 任意。基本配分では省略 |
| e3-full | 72 | 26/5 | Pと固定R*、新E3全12×3 |
| q1 | 60 | 13/3 | 新Q1、現契約F_ref。Q0m改訂を自動適用しない |
<!-- deep-stages:end -->

全4段階は240世界=52/3h、支援8/3を含め20h（従来上限）。M2省略の旧棚は180世界13h＋支援1.9h=14.9hだが、現在はG3へ5.2hを振替済みでdeepは9.7h。この棚一式・AI・追加Q0を同時予約しない。M2は0h、因子/D/Eは保留。deepからはQ0再資格5hを先に留保し、残4.7hもdev1精算・修理/再診断を優先する。AI専用E3/Q1は9.5333hだけでdeepをほぼ使い切るため、実装・D対照・追加Q0を含む全費用の証明なしにAI実走0。どの経路も研究最大20h・2世代、E3失敗で打切り。

M2を実施する場合もE2は選抜専用、別E3全12×3×親/R*を最初から測る。安全/仕様→T→P−noop→最悪差→固定IDで1候補のみ。E3で修理/次点再選抜しない。モデル一般の優劣は各セル1生成から識別できない。

## 6. 凍結/改訂ON・seed・最後の採用規則

**論点2の決定: AI-G3-01はR*一案だけを反復する。凍結性能は改訂ON性能の代用にならない。** 次の順序を固定する（詳細[設計C](DESIGN-AI-LAYER-01-astra.md)）。

1. Q0/最小G3/G4で受理Sを確保し、Sのcode/prompt/model/許可値/受付/state/roster/slot/hashを固定。同一版Sのfull G3証跡は現在未確認のため5.2hを予約する。
2. calの最大batch時間×1.2とAPI同時呼出枠で全残費を校正。S full G3はF_mix・12×3市場seed、ON36/OFF36の72世界で既存G3閾値を要求する。同一版・全条件・失敗履歴を含む証跡が既に有効なら重複再走をせず消費済みとして精算する。SのG3性能をR*の調整へ渡さず、R*固定までG0/安全だけを開示する。既有G3性能を開発に使っていた場合は独立集合として使えないため、結果を見る前に新G3集合全体と費用を登録し直す。
3. 開発専用集合でA=AIとD=同じ観測/許可値を用いる決定論適応を比較。少なくとも全12×2新seed×A/D=48世界、基本52/15h＋支援を別予約する。Dの更新則/hash・集合を結果前に固定し、平均対応ΔT>0、平均Δ(P−noop)>0、最悪レジームΔT≥−2・全安全を満たすことをAI継続のscreenとする。有意性や採用証明ではない。予算不足なら実施せずAIを停止する。
4. 一つのR*を固定し、AI専用E3=F_mixでS/R*ともON、新12×3×2=72世界、既存G1閾値。Q1=F_ref・候補ON、新12×5=60世界、現平均T/対noop/安全条件（論点6を含む）。同seed修理・次点なし。core変更があればFROZEN再資格費も別途必要。
5. R*のG3はF_mix・12×51001–51003=36セル。OFF1回36世界に対してON3独立応答履歴108世界、計144世界。履歴は別呼出し、replayを独立試行に数えない。事前固定順にOFF/ONを交互化し、p3排他と全hashを保つ。OFFはclock固定replayで注文/状態の再現性を確認し、不一致なら停止する（追加支援費も記帳）。
6. 各ON反復に平均ON−OFF≥−1T・最悪regime≥−3T、G0/全安全を要求。反復平均で不良を隠さない。欠測/退行/反復間の結論反転/予算超過は停止。3反復は検出力保証ではない。R*計測10.4h＋障害1.6h=12h、S 5.2hと合わせて**17.2h**。二候補比較全体を12hとは呼ばない。

**state決定**: 初版はepoch間の学習持越しなし。提出動作もepoch開始時に基準コード/ENTRY_BPS=60と空学習memoryへ戻す。epoch内の安全state・未解消在庫/cooldownは改訂/復帰を跨いで保持し、経済的な負債/保有を学習resetで消さない。提出境界でこの一致を保証できなければ導入停止。持越しあり・系列試験・reset追加対照は今回は不採用。

### 6.1 役割を固定する

| 集合 | 予約値 / 用途 | 閲覧・再利用の制約 |
|---|---|---|
| D0 | 201/202、夜間4regime | 既見診断、性能選抜/資格にはしない |
| E1 | 31001/31002、6regime | 親の開発とF＋feedback。以後コードの評価に再利用しない |
| E2 | 32001/32002、6regime | 4改訂のコード凍結後に初開封。R*選抜専用。E3への世界再利用なし |
| E3 | 33001–33003、全12 | R*選抜後の新たな全域screen。失敗で終了、同seed修理認定なし |
| Q0 / Q0b / Q1 | 41001–41005 / 41101–41105 / 42001–42005 | 初回/一度限りの第2候補/挑戦者資格。開発者へ結果を渡した集合は開発済みに格下げ |
| Q0再資格 | 41301–41305全12、F_ref/FROZEN | 修理済み1候補1回。担当者の全履歴未使用性監査・hash・5h枠校正が先 |
| xb-r診断 | 35001/35002はdev3、36001/36002はdev4/dev5で既見 | dev5はv5同seed診断（2/3回目）・昇格せず。独立screen/資格/E3/Hへ再利用不可 |
| xa-1診断 | 旧smoke38003、dev7 38004、xas2 38005。本体案38001/38002 | 2回修理後も不健全で第3回打ち切り。本体未達、予約seedを未使用と断定しない |
| 自由改訂live / 旧H1案 | live本体39001/39002、校正39101/39102 | OFF1+ON3=32世界・PILOT-STOP。H1 adapter未実装/ON拒否、使用済みseedのfresh再利用不可 |
| mix1診断 | 40001/40002、全12レジーム | u1構成11体・v3凍結・24世界。5/11位、23 PASS/1 BLOCKED。資格/契約とは無関係 |
| mix2診断 | fresh 40003/40004、全12レジーム（結果受領・以後既見） | 同roster・24世界。mix2a/mix2bともG0 PASS・violations 0。48世界集計も受領、資格ではない |
| incz診断 | 40005、F_ref全12レジーム | inc-zetaの12世界診断は完了、40005は既見。G0 PASS、平均T56.30対44.44・noop割れ4/12。全12×2 screen/Q0の代用不可 |
| 次版の調整 / 診断検証 | 各試行前に別のfresh seed集合を登録 | 調整・1世界smoke・全12×2の検証を分離。開封後は使い捨て、Q0/E3/Q1/G3/H予約と交差0 |
| D対照開発 | seed全集合を実行前に再登録、A/D各24 | 旧35001/35002案は開発使用で失効。基本48世界52/15h＋支援は未予約 |
| Q0m草案 | 41201–41205全12、F_mix | 未署名・今回不採用。将来別契約を作る場合だけ既知情報開示/未使用性確認。旧FAIL保持 |
| M1修理診断 | 34001/34002、D0と同じ4regime | 親/D/Eの開発専用。E3/Q/Hへ再利用しない |
| MVP mix / Cal | 43001全12 / 50001–50003のcalm/crash/depeg | smokeとON時間校正。資格/Hから分離、性能優位に使わない |
| G3 | 51001–51003全12 | 各候補ON/OFF、履歴と適合。性能変更後の修正版へ認定移転なし |
| Hfinal | 未使用10seed、本文/HTMLには値を書かない | 10/18までにsalt付きcommitment、runnerだけ開示、全予定完了まで成績封印 |
| P60 | 101/202/303/404/505全12 | **公開回帰のみ。202はu1mと重複。汎化・holdout・安全証明と呼ばない** |

未使用性は[unverified]。既存実行担当が全試行・敗退案・途中失敗の履歴と照合し、衝突なら結果を見る前に集合丸ごと変更。今回の文書担当は禁じられた実行記録を読まない。seed名の違いだけで独立streamを保証せず、stream/scorer版も束縛する。

### 6.2 最終比較の事前登録

S=資格・G3・受理証跡のある安全版、R*=E3/Q1/G3済みの挑戦者1体。**2候補×2場(F_ref/F_mix)×12×10=480世界**。候補がない場合はSだけ240世界。モードは候補ON、固定相手OFF。コード/prompt/改訂modelと提供版・許可範囲・受付方式・state/順序/初期snapshot、roster/slot、全入力、seed commitment、再走条件、統計コード/hash、次の閾値を10/18前に固定する。Hは各世界1つの新規応答履歴で、G3の3反復を全Hの反復証明と呼ばない。後から都合の良い場へ交換しない。

監視者はG0/安全/時間だけを閲覧し、候補別P/Tを見ない。全予定G0成立後、10/25に一度だけ開封する。成績で再走・seed追加・候補追加・次点再挑戦をしない。障害再走は同じ入力で失敗履歴を残す。欠測は除外せず比較全体を保留する。

### 6.3 採用判定（すべて必要、満たさなければS）

各場fで `d[f,r,s]=T(R*)−T(S)`、`dbar[f,s]=12regimeの等重み平均`、`Delta[f]=10seedのdbar平均`。P−noopも同じ対応差で計算する。

1. **絶対適合**: 両候補ともQ/G3、両場で未回収自前資産損失/gas枯渇/無効注文0、全regime平均対noop≥0。Sが外れた場合もR*を無条件採用しない。全ゲートを満たす資格済みR*だけが更新候補で、そうでなければ本人の安全判断へ。
2. **主yardstick F_mix**: 95%区間の保守的下限 `L_mix > 0`、かつ **`J = 0.5 * Delta_mix − 1 > 0`**。半分へのshrinkageと1Tの切替費用により点推定>2Tが必要。これは政策的な保守ペナルティで、統計的に校正された事後確率ではない。混成場の平均Δ(P−noop)の保守的下限も≥0を要求し、σ縮小だけの改善を棄却する。
3. **F_ref co-gate**: `L_ref ≥ −1T`、平均Δ(P−noop)≥0。F_refだけ大勝しても採用しない。F_refの改善を必須にせず、混成場の利益と隔離場の非劣性を別々に守る。
4. **regimeと本番型尾部**: 両場の最悪regime平均d≥−2T。さらに下記60epochストレスで、両場の下側5%平均スコア(ES5)差 `ES5(R*)−ES5(S)` の外側seed bootstrap下限≥−1T。等重みだけ通った候補でも、後半集中でこの条件が落ちれば更新しない。
5. **頑健性と既受理版優先**: seedを1クラスタずつ抜いた10通りでもF_mixの平均ΔT/Δ(P−noop)の符号が負へ逆転しない。G4/配置が未達なら新ZIPを送らない。閾値境界・差不明・低検出力はS維持。安全修正だけの別採用経路をこの比較へ後付けしない。

95%区間は同seedを全regime/両候補/両場で一緒に再抽出するcluster bootstrap（10,000回、RNG固定）。平均指標は10個のdbarによるt9区間も併記し、**下限は両者の小さい方**を使う。少数クラスタの被覆率は未保証。regime内を独立再抽出した区間は感度表示だけで、狭い方を採らない。σ=0/非有限量なら保留。

60epochストレスは各epochのregimeを独立一様抽選し、重み `w_e=1+0.5*(e−1)/59` を使う。凍結した対応観測を共同抽出し、重み付き平均Tの分布とES5差を計算する（内側10,000系列、外側seedクラスタ1,000回、固定RNG）。crash/depegが後半に偏る系列も入る。これは採用拒否のための有限データ上のストレスco-gateであり、本番勝率や60epochを通じた資産/改訂履歴の忠実再現ではない。状態持越しや未知相手に対する弱さは残る。

### 6.4 10 seedsが示すこと・示さないこと

- 1regimeあたり独立seedは10、全域の保守的な独立クラスタ数も**最大10**。120セル、2場、2候補、480世界、60epoch再標本化、10,000bootstrapを独立標本数へ足さない。欠測・seed依存・共通モデル障害があれば実効数はさらに小さくなる。正常10クラスタ未満なら本契約の更新判定は不成立。
- G0成立の固定場で大きい退行/改善の方向、安全欠陥、局面差は見られる。**差が出なかったことは同等性の証明ではなく、+0.5〜1T程度の小改善の確実な検出や稀な損失率の保証はできない。**
- V2のu1m由来半幅3.305T@3seedを仮に1/√n換算すると10で約1.81T。ただし場/ONが異なるので今回の検出力ではない。正規近似なら80%検出力で約2.6Tが必要という参考算術に留める。10seedで+1Tを必ず選べるとは書かない。
- 探索で選んだ最大値にはwinner's curseがある。E3/Q/Hの分離、最終1対1、一回開封、固定shrinkage/切替費用、S優先で抑えるが、固定場の選択・単一生成・ON非決定性の偏りまで消えない。厳しいゲートは偽陽性を抑える代わりに真の小改善も捨てる。

## 7. Forward 100hと消費の更新

### 7.1 実測下限・推定・予約を分ける

[measured: 前回本人記録] 夜間前の完了327 run（360block完走326）の区間和集合は**18.6h以上**。run-hours単純和71.1hを足さない。[inferred] 今夜の費用は`ceil(chunk世界数/3) × 13/60 h`で推定し、計測資料の数値を再導出したものではない。実占有の区間和集合が未提示なので、以下の推定を新しい実測下限とは呼ばない。

<!-- chunk-estimates:start -->
| 対象 | 世界数 | batches | 推定h | 会計状態 |
|---|---|---|---|---|
| D0六候補 | 6×8=48 | 6×ceil(8/3)=18 | 39/10 | 完了報告・時間は推定3.90 |
| sonnet Q0 | 60、3chunk | 20–22 | 13/3–143/30 | 完了報告。分割数しか不明なので切上げ余白込み |
| 今夜完了分合計 | 108 | 38–40 | 247/30–26/3 | 推定8.2333–8.6667、上側をforwardに予約 |
| opus Q0b | 60、3chunk | 20–22 | 13/3–143/30 | 全60世界完了・平均T FAIL/G0 FAIL。時間は推定4.3333–4.7667、区間証跡待ち |
<!-- chunk-estimates:end -->

Q0/Q0bの実chunk配分と開始/終了区間は今回の引継ぎにない。3chunkを合算して60/3=20batchは下側、丸め余白最大2batchを加え22とする。仮に20/20/20なら21batch=4.55hだが、これを実際の分割と断定しない。D0は8世界ごとに切り上げるため、48/3=16batchとして過小計上しない。

**Q0bの完了実測60世界を既存13分/p3へ当てた概算は4.3333–4.7667h**（壁時計の実測ではない）。要求された下限18.6h＋Q0b概算は**22.9333–23.3667h相当＋未計上分**。さらにD0/Q0の夜間推定を重複なく加える仮置きは31.1667–32.0333h相当だが、境界/重複未精算のため確定累積にしない。真の累積の確認済み下限は引き続き18.6h。M1/xb生成・検査・失敗など非run占有も同時刻を一度だけ数え、区間和集合で後から精算する。約8hの旧夜間枠に推定上側が収まるとは言わない。

forward起点は既存ダッシュボードの10/4 01:00 JST（Mac現地00:00）を維持。旧本文の00:00 JSTを訂正し、既決の解釈と未了の実区間精算を区別する。D0の境界前後は原区間未読のため、**今夜完了分を全量forwardへ仮予約**する保守的処理。境界前の部分が18.6hに含まれていた場合の重複は、実行担当の区間証跡で精算するまで探索へ再解放しない。100hはここから新しくリセットしない。Q0bは完了分の上側143/30hを仮計上し、未着手予約や残時間として表示しない。Q0b救済再走は0h。不可欠な原因診断だけ将来の別契約とする。

**10/5夜間の記帳（本人提示の概算）**: [本人提示概算] 00:26 JST以降: xa-1 smoke約13分×2 + live smoke約13分×2 + live本計測32世界約150分 + mix1約100分 + mix2約100分 + incz約55分 = 単純和457分（7h37）。非重複を仮定した単純和で、確定値・区間和集合ではない。修理/検査/非run・重複・当日/forward消費は未精算。p3を3倍しない。C_forward + R_remaining + N_next ≤ 100h、同一区間のC/R二重計上禁止。不明なら追加起動BLOCKED。旧rev 10の202分（3h22）・352分（5h52）は当時の部分見積として保持し、現行合計や残量には使わない。

<!-- overnight-accounting:start -->
| 10/5夜間会計（00:26以降） | 概算分 | 状態 |
| --- | --- | --- |
| xa-1 smoke | 13×2 = 26 | 概算。失敗分も保持 |
| live校正smoke | 13×2 = 26 | 概算。compile failed分を含む |
| live本計測32世界 | 150 | 完了分の概算 |
| 完了分単純和 | 202（3h22） | 区間和集合は不明 |
| mix1 | 150 | rev 10時点の見込み。結果受領後も実時間は未精算 |
| mix1込み単純和 | 352（5h52） | 非重複仮定、実消化/残時間ではない |
| 修理・検査・確認・非run・00:26前の当日占有 | 不明 | 当日/forward全量は未精算 |
<!-- overnight-accounting:end -->

### 7.2 両列ともforward 100h（現行KEEPは論点3の振替を反映）

<!-- budget-forward:start -->
| ID | 用途 | 維持h | 改訂h | 実験ID | 配分の意味 |
|---|---|---|---|---|---|
| historical | 境界前の実測下限（枠外） | 0 | 0 | historical-consumption | 18.6h以上。履歴を消した意味ではない |
| overnight | 完了D0＋Q0の推定予約 | 26/3 | 26/3 | d0-completed; q0 | 108世界、38–40 batches。上側8.6667hを仮計上 |
| q0b | 完了opus-1の時間推定 | 143/30 | 143/30 | q0b | 全60世界完了・不合格。上側4.7667hを仮計上、実占有は未確認 |
| q0m | 旧F_mix資格案（今回不採用） | 0 | 143/30 | q0m | 旧60世界案。KEEPは0、AMENDの上側予約は履歴のみ |
| g0-support | 場設計・manifest・負荷入口 | 1 | 1 | mix-design; g0-calibration | 設計0.5h＋入口/証跡0.5h、実測に置換 |
| first-next | 残る初回経路 | 35/3 | 35/3 | first-mix; first-p60; first-g3; first-g4 | smoke13/15＋P60 13/3＋cal13/5＋検査58/15 |
| deep | Q0優先・修理・AI支援（研究上限20h内） | 97/10 | 152/15 | q0-requal; factor-ab; m1-implementation; m1-pair; m2; ai-implementation; ai-d-control; e3-full; q1 | 現行9.7h。Q0再資格5h優先留保、残4.7hはdev1精算/修理優先。旧AMENDは未適用 |
| final-g3 | S full G3＋R*反復・障害 | 86/5 | 12 | g3-fallback; g3-challenger; g3-faults | 現行17.2h=R*12h＋S5.2h、deepから5.2h振替。旧AMENDは未適用 |
| final-g2 | 二場10seed最終確認 | 35 | 35 | sealed-final | 480世界104/3h＋1/3h。Sのみなら240世界 |
| final-g4 | 最終P60・配置・適合 | 9 | 9 | final-p60; placement; release | 84世界91/15h＋検査44/15h、ON再校正 |
| reserve | 共通予備 | 3 | 3 | recovery | 既決の3hを維持。未知非run占有・失敗も記帳 |
| TOTAL | forward 100h | 100 | 100 | - | KEEP振替済みが現行、AMENDは旧未署名比較の保存 |
<!-- budget-forward:end -->

夜間とQ0b完了分の上側仮計上は計13.4333h、将来配分は86.5667h。実測の残時間・自由枠ではない。dev1占有・非run・再設計/再診断費は未精算で0hにしない。AMEND列は旧未署名比較を保存しただけで選択不可、今回の実行配分ではない。100hを再起算しない。

### 7.3 論点3の決定: 配分・10/17切替とON校正

**確定配分**は上表KEEP。final-g3を12→17.2h、deepを14.9→9.7hへ5.2h振替し、first-next 35/3h・final-g2 35h・final-g4 9h・予備3hを維持。M2=0h、因子/D/Eは保留、研究費は限定AIを優先するが**Q0/受理が最優先**。deep9.7h内の5hは新Q01回の条件付き留保、残4.7hもdev1精算・修理/再診断を先に充当する。未消費のAI枠はQ0/受理不足が判明した時に先に取り下げ、精算表に振替元/先を記録する。消費済み費用は戻さない。

AI専用E3/Q1だけで143/15h=約9.5333h、deep9.7hとの差は1/6h。D対照48世界52/15h・実装・追加Q0/修理・終了確認が別に要るため、**現見積ではAI挑戦者の全工程を解放できない**。17.2hはON倍率1の基本予約で実測予算保証ではない。既有S full G3は同一hashの証跡を受領した場合だけ重複分を精算し、現時点で追加12hだけとは表示しない。S/R*双方を3反復する22.4h案は不採用。

**10/17 18:00 JSTにAstraが下記の証拠条件で切替を適用する（判断自体は今回決定済み）。**
- **H480**: 受理Sあり、AIのD対照に対する正の増分、固定R*のE3/Q1/G3全成立、hash/state/未使用10seed/二場、cal最大×1.2で終了確認込みの全残費が100h内、10/18〜25の通常6h/日窓で完了可能。この全条件が揃う場合だけ二候補Hへ進む。
- **SのみH240**: 上記のどれかが欠ければAI拡張終了。受理適合Sと単独H240＋最終G4＋予備の全残費/日程が確保できる場合に切替。比較を捨てた節約で未比較AIを採用しない。
- **H未実施**: S未受理/不適合、又は単独Hでも全残費/日程が不足ならcampaign開始なし。適合受理Sがあれば維持し、なければ提出可能と表示しない。安全/seed数/場を削って帳尻を合わせない。
- 深いリーグへの切替は**その時点で既にE3/Q1/G3を満たす候補1体**と全残費/日程がある場合だけ。10/17から新規探索しない。H480の最終採用条件はAI候補と同じ。

鍵登録受理・Free/残高$0/Auto-reload Offは本人報告（§10）。無料枠の量の十分性は未確認。足りない場合の前払いはG3見積もり後に本人の承認が必要で、現在の本人作業ではなくAir100hの決定にも含めない。追加費は未使用研究/AI枠→精算済み余白→予備の順で記帳し、受理/最終安全費を確保できなければ次chunkを開始しない。

最小G3は資格成立後・受理前。10/10を再予算判断日とし、受理/cal未達なら後続AI性能研究・深い探索を削る。calm/crash/depeg×50001–50003×2場×ON/OFF=36世界。場/mode別3batch、ON/OFF順序交互、p3・提出model・既定改訂間隔・CPU排他。開始/終了、待ち、retry、検査/実際の適用block/復帰、API usageと同時呼出枠を記録。p3の推論同時実行可否も校正する。**観測最大batch時間×1.2**で全残工程を再見積する（p95保証ではない）。

| ON倍率（13分比） | H480全ON | SのみH240全ON | G3決定案 / Sのみ（障害別） |
|---|---|---|---|
| 1 | 104/3h | 52/3h | 17.2 / 5.2h |
| 1.5 | 52h | 26h | 22.4 / 6.5h |
| 2 | 208/3h | 104/3h | 27.6 / 7.8h |

最終P60/配置84世界もON、基本91/15hがr=1.5で9.1h、r=2で182/15h（検査44/15h別）。1.5–2倍ならH480は7日×6h窓に入らない。探索を削り、10/18前にSだけ240世界へ事前切替（優位比較なし）を適用。seed10→5、F_mix除外、途中開封は不可。S単独でも不足なら最終campaignは開始せず、適合受理版があれば維持する。

各chunkは終了検査10分を含め110分以内、`3*floor(100/校正後batch分)`以下かつ新規FROZEN最大18世界。ONで26分なら9世界、19.5分なら15世界。既存Q0bの分割は本書で書き換えない。

## 8. 運用・移管と次の24h: 準備 → 新資格 → 受理

決定論ラインは第3回xa-1で打ち切り、Q0のF_ref平均T≥multiに未達。自由改訂はPILOT-STOP。mix2・48世界集計を受領、混成場はinc-zetaが1位、candは48世界で5位。inczも診断完了、平均T56.30対44.44・noop割れ4/12。全計測終了・走行中なし。 [本人決定・チャット承認 2026-10-05 JST] 3点を「進める」: inc-zeta（ascon-zetaのzeta-a30）の実質的改変を独自戦略と認め、multi-arb派生を開示して条件付き第一候補にする。弱点診断後、現行閾値を維持した新契約・回数枠Q-ZETA-01（F_ref・12レジーム×5新seed=60世界・約4.5h）で資格試験へ進む。上流統合・適応とleague追加分を分割PRにし、Claudeの別エージェント+agyによる独立レビュー・CI後、merge commitで統合する。 [OVERNIGHT](OVERNIGHT-2026-10-05.md)の停止/会計規則と[当日振り返り](RETRO-2026-10-04-DAY.md)の運用上限を維持。本更新で計測の起動/停止や戦略への介入は行わない。

### 8.1 作業分担・移管実績と完了監視

[measured/実施済み・本人引継ぎ 2026-10-05 JST] ローカル~/Developer/majisuke/ascon→~/Developer/asconへ移管（旧パスは相対symlink）。11 worktreeのbranch/HEAD/tracked変更数が前後一致、worktree repair・node_modulesの絶対symlink張り直し済み。GitHubはMajisuke-dev/ascon→Masashi-Ono0611/ascon（private・ADMIN）へ本人が画面からtransfer実施（auto modeの判定はgh apiのtransferを拒否）。旧URLはredirect、open PR #2も移動。ローカルremote URL更新・fetch/push確認済み。league/v2（cca4005）とeval/upstream-merge（8303d85）を新しい場所へpush、pre-push ci-local quick PASS。mainへ直pushなし。本更新で移管・ネットワークの再検証はしていない。

[進行中・本人報告] 分割点3d86a35からpr/upstream-integration（CIのignore-scripts修正を含む）をmain向けPR1にし、league/v2をPR1ブランチ基点のPR2にする。PR1 merge後にPR2のbaseをmainへ付け替える。独立レビュー・CI後にmerge commitで統合。PR番号・レビュー/CI/merge結果は未確認、進行は本人報告へ。

[進行中・本人引継ぎ] zeta-prep（Astra）がnoop割れ4レジーム（cex-drift/informed-flow/lending-incident/vuln）の診断、測定設定を焼き込むrelease候補example/agents/ascon-zeta-r/、ascon-notes/league/INC-ZETA-ORIGIN-2026-10-05.md、ascon-notes/league/Q-ZETA-01.mdの下書きを作成中。存在する/作成中の参照のみで、結果は未確認。由来はINC-ZETA-ORIGINへ記録予定。

[運用: 本人引継ぎ] **Codex(Astra)主・Claude副**。Grokは利用残高切れ(402)で体制から外す。**agy（Gemini 3.8 Flash High・ハーネス反映済 masa-harness#409）**を補助レビューに使い、**独立レビューはClaudeの別エージェント+agy**。agyは**「ツール使用禁止・差分埋め込み・`echo "" | …`」**で使う。差分はプロンプト内に渡し、空stdinで入力待ちを避ける。呼び出し先のツール使用を禁止する。本更新でレビューの起動・外部照会はしていない。過去のGrokレビューと署名記録は保持する。

計測担当Claudeは常にmatrixを1本だけ、p=3・等速で実行する。解析/設計担当Astraは直前の確定結果の分解、次仮説、隔離した次版の編集を並行する。重いローカル生成・テスト・build・CIは計測間の排他枠で行う。実行中の親roundはchunk間もHEAD/入力/実行スクリプトを凍結する。別ファイルでもrunnerが読む場所には編集せず、凍結入力と切り離せない編集は待つ。

全ジョブに、起動シェルから独立した完了監視と引継ぎ先を**起動前**に設定する。job ID・親/chunk ID・hash・予定世界・worker/監視の識別子・期限・次タスクを台帳へ記録。状態はLAUNCHED/RUNNING/COMPLETED/FAILED/BLOCKEDを分ける。**起動シェル終了≠計測完了**。launcherのrc=0はLAUNCHEDまで。COMPLETEDはworker終了コード、全予定世界の終端記録、欠測/重複0、G0/安全集計が揃って初めて付ける。欠落はUNKNOWN/BLOCKEDにし、成功通知へ変換しない。

監視は60秒以下の間隔で軽量に確認し、完了/異常を2分以内に実行担当へ通知、担当は5分以内に受領・結果を記録する。次の許可済み作業へ完了から10分以内に移る。5分間ログ進展なし、予定終了+5分、監視停止は要点検通知とし、計測を無断再起動しない。未受領5分で担当への再通知、10分で次ジョブをBLOCKEDとして本人へ報告する。待つ間は解析・費用精算・文書更新を進め、無言の待機にしない。通知設定/テスト受信の証跡がないジョブは開始不可。

[本人報告 2026-10-05 JST] 夜間のハートビートは取消済み。記憶(ASCON)は移管・体制・教訓を更新済み。decisions.jsonのdec-007参照先文字列は追跡ファイルのため未更新（次にハーネスを触る時にPR）。ASCON repo内ドキュメント18件の旧パス/旧オーナー文字列は未更新（symlink/redirectで動く）。本更新はこれらの一括置換や記憶更新を行わない。 旧運用は8分ごと・/tmp/night-state.md・監視30分で失効という履歴。既決の60秒以下監視・2分検知/5分受領/10分次着手は将来の実走入口として維持する。

### 8.2 段階別の上限と実測fixture

<!-- continuous-stages:start -->
| 段階 | 担当・並行可能な作業 | 目標 / 上限 | 次へ進む証跡 |
|---|---|---|---|
| 診断結果の確定 | Claude。Astraは直前結果を解析 | 完了検知2分・受領5分・次着手10分以内 | worker終了＋全予定終端＋G0/安全＋hash。launcher終了は不可 |
| 解析・隔離実装 | Astra。現matrixと軽量作業のみ並行 | 仮説/変更案30分、実装60分上限 | 主因・予測する行動差・1変更群・次のfresh seed用途を先に記録 |
| 排他検査・入力凍結 | 実装担当、計測間のみ | 目標15分 / 上限20分 | typecheck・関連テスト・赤対照・実ログfixture・hash固定 |
| 1世界ゲートsmoke | Claude、F_ref・1レジーム1fresh seed | 短縮120block以内、目標5分 / 上限10分 | cand submitted>0・包含成功>0、revert/violations/failedReads/未解消片脚0 |
| 全域診断検証 | Claude、固定候補F_ref/FROZEN・12×2=24世界 | 18+6世界、基本104分＋終了確認、各chunk110分上限 | 全24世界・G0・12レジーム等重みT・対noop・安全・失敗明細 |
| 判定・引継ぎ | Astra解析、Claudeが次ジョブ準備 | 開封から10分以内 | §8.3ならQ0準備、不足なら残枠内の次診断、停止条件なら本人報告 |
<!-- continuous-stages:end -->

fixtureは公開実観測から秘密を除いた**実ログ由来入力を必須**とする。出典run/観測形式/対象hashを記録し、dev1のoracle 6gweiを競合へ混入させる旧コードが赤、修正版が緑になることを確認する。合成fixtureだけの緑で入口を解除しない。smokeでは短縮範囲の健全性を確認し、360blocks/362loopsの本G0 PASSや利益資格とは呼ばない。取引0なら本計測を開始せず、機会欠如/ゲート/観測不一致を分解し、変更後は別fresh seedでやり直す。smokeと検査の失敗もイテレーション・費用に数える。

**1イテレーションは次版hashの検証着手から判定まで目標150分、上限180分**（並行する解析/編集を二重加算しない）。全域24世界は18世界だけの約50〜80分ジョブより長い。校正で180分に入らなければ開始前に停止・再見積し、世界/安全条件を削らない。v3の最初のsmokeから**最大3回**、dev3a/dev3bは既知のベースラインとして別記する。smoke失敗・G0 FAILも回数を消さず、再起動/名前変更/日付変更でリセットしない。

上限3回は実行予算の追加許可ではない。通常6h/日、forward100h、deep9.7h中Q0留保5h、既消費精算後の修理枠、既決20h/2新世代のうち最も早い限界を適用する。3回を同日へ詰め込まない。次の1回全量＋Q0＋受理/最終安全費が未確保なら開始不可。現時点の実消化は未精算で、3回分の枠は未解放。

### 8.3 旧xb-r系統をQ0へ回す事前screenと停止（既決・不変）

<!-- diagnostic-screen:start -->
| 項目 | Q0準備へ進む条件（すべて必要） |
|---|---|
| 母集団 | 修正版hash固定後に未開封の検証用fresh seed 2本、F_ref/FROZEN全12×2=24世界、全G0 PASS、欠測/重複0 |
| 相対収益 | 12レジーム等重み平均(Tcand−Tmulti)≥0、各12レジームの平均(Tcand−Tnoop)≥0 |
| 安全・執行 | violations/failedReads/無効注文/未回収自前資産損失/gas枯渇/未解消片脚/mined revert=0、候補の包含成功>0。submit_failed全件の理由を照合し、承認/資金不備反復・原因不明0 |
| 尾部報告 | 全世界P/P−noop・noop割れ数・最悪P−noop・最悪レジームT差・送信/包含/失敗数を報告。欠落は未達、全世界P非負や対multi P条件は追加しない |
| 独立性・費用 | 調整/短縮smoke/診断検証/Q0のseed交差0、全履歴未使用性監査、stream/scorer整合、候補/依存/prompt/roster/slot/hash固定、Q0 5hと全残費確保 |
<!-- diagnostic-screen:end -->

このscreenは診断からQ0へ費用を配分する基準で、Q0契約の変更・合格ではない。診断24世界のrevert=0と新Q0の60世界≤1件かつ≤0.1%を混同しない。診断検証は調整seedから分離し、開封後は既見扱いで調整後の再検証に再利用しない。41301–41305を含むQ0/E3/Q1/G3/Hの予約seedを診断に使わない。修正版を選ぶ検証集合をQ0の代用にも使わない。

**3回で全12レジーム平均T≥multi-arbに届かなければ打ち切り、本人へ結果・最悪値・失敗理由・残費を報告して判断を仰ぐ。** 平均だけ届いても上記screenの他条件が不成立なら同様に停止。回数を増やす、seedを追加する、閾値を下げる変更を自動でしない。G0 FAIL/安全違反/入力hash不一致はその時点で新規起動停止、当該runを隔離し原因と修理・再検査の証跡が揃うまで再開しない。ディスク/リース異常、chunk110分、イテレーション180分、予算/日次/世代上限も停止条件。本人専用の鍵/API金銭/自動チャージ判断を自律処理へ広げない。

### 8.4 現在のキュー（引継ぎ時点）

[measured] mix1は12レジーム等重み平均Tでcand(xb-r v3)52.18・11体中5位、平均(50)より上。worst regime T47.6は全員で最良の最悪値。multi-arbは36.73・最下位。F_refの対multi-arb基準での負けと混成場での順位は逆の見え方。 G0は24世界中23世界PASS、crash/40001のみBLOCKED（grok-1のtelemetryが原因、candではない）。診断として全24世界を保持し、BLOCKEDをPASSとは扱わない。violations 0。 契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。

[inferred] xb-r v3とsonnet-1/grok-1/opus-1はこの集計では区別できないとの見立てで、統計検定の結果ではない。決定論ラインxb-rの追加改良より、混成場で強い既存の独自戦略inc-zeta=zeta-a30（Claude+Codex作成の本命）を提出基盤にする案が示唆される。ただしinc-zetaはF_ref契約(Q0)未通過。D0のF_ref診断はcommit不一致でG0 FAIL、性能は診断のみ。

[measured] mix1/mix2でseedを替えても順位は概ね安定（inc-zeta 1位・venue-arb 2位・multi-arb 11位）。mix1+mix2は12レジーム等重み・seed40001–40004の48世界。inc-zetaは平均T58.26、2位53.71との差は約4.5T（表示値の差4.55T）、最悪レジームT46.8。観測した混成場では明確な最強。cand(xb-r v3)は平均T51.91・5位・最悪47.6で、sonnet-1/grok-1/opus-1と約1T以内（表示値ではsonnet-1との差1.01T、grok-1との差0.89T、opus-1との差0.03T）。 [measured] inczはinc-zeta（ascon-zetaのzeta-a30パラメータ・frozen）をF_ref(cand+noop+multi-arb+clean-arb)で12レジーム×seed40005=12世界。全計測終了・走行中なし。G0 PASS・362ループ・違反0。12レジーム等重み平均T cand 56.30 / multi-arb 44.44（candが上）。1世界平均P 1343.6 / 730.0 / 281.1、取引数254.2 / 253.0 / 42.2（cand/multi/clean）。noop割れ4/12世界、平均(T−Tnoop)<0のレジーム4（最悪informed-flow −8.12）。cand mined revert平均0.2/世界（multi-arb 8.4）、submitted3057/failed90（2.9%）。07:20 JST頃開始との引継ぎ（旧05:40頃開始見込みを訂正）、約55分。旧08:15 JST頃の完了見込みは実績ではなく、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。 決定論ラインは3/3回目xa-1で打ち切り。日付変更で回数をリセットせず、第4回/追加AIを自動解放しない。最大3回・目標150分/上限180分・Q0留保・独立seed条件は維持。

[別ジョブ・unverified] **PLATEAU-ANALYSIS**（構造の異なる独自設計候補の検討）を**Astraが作成中、結果未確認**。計測キューとは別の軽量解析。候補の実装/性能/採用、新規計測や追加予算を確定したものではない。

<!-- next-24h:start -->
| 順序 | 実験ID | 状態 | 世界数 | 全量見積h | 窓 | 依存・停止 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | zeta-prep | 登録済み・起動前照合待ち | 0 | 未見積 | 10/6 | Q-ZETA-02 registered-pending-start（登録済み・未起動）。ascon-zeta-r2、1候補1回60世界、4チャンク各110分以下、確認込み5hはforward100h内数。Q-ZETA-01条件4 FAIL・消費1回を保持し回数リセットなし。6条件・閾値は不変。単一host固定: miniは自機G0 smoke PASS時のみ、fallback Airは給電・caffeinate・sleep禁止。host/開始前署名/残費は未確認。診断48001/48002は資格証拠にしない。 |
| 2 | pr-split | 進行中・本人報告待ち | 0 | 未見積 | 10/5以降 | [進行中・本人報告] 分割点3d86a35からpr/upstream-integration（CIのignore-scripts修正を含む）をmain向けPR1にし、league/v2をPR1ブランチ基点のPR2にする。PR1 merge後にPR2のbaseをmainへ付け替える。独立レビュー・CI後にmerge commitで統合。PR番号・レビュー/CI/merge結果は未確認、進行は本人報告へ。 |
| 3 | q-zeta-02 | registered-pending-start | 60 | 5 | 10/6以降・基本4.5h+確認0.5h | Q-ZETA-02 registered-pending-start（登録済み・未起動）。ascon-zeta-r2、1候補1回60世界、4チャンク各110分以下、確認込み5hはforward100h内数。Q-ZETA-01条件4 FAIL・消費1回を保持し回数リセットなし。6条件・閾値は不変。単一host固定: miniは自機G0 smoke PASS時のみ、fallback Airは給電・caffeinate・sleep禁止。host/開始前署名/残費は未確認。診断48001/48002は資格証拠にしない。 |
| 4 | dev1-evidence | incz診断完了・履歴 | 12 | 未見積 | 全12世界完了（本人引継ぎ）、約55分・実完了時刻未提示 | [measured] inczはinc-zeta（ascon-zetaのzeta-a30パラメータ・frozen）をF_ref(cand+noop+multi-arb+clean-arb)で12レジーム×seed40005=12世界。全計測終了・走行中なし。G0 PASS・362ループ・違反0。12レジーム等重み平均T cand 56.30 / multi-arb 44.44（candが上）。1世界平均P 1343.6 / 730.0 / 281.1、取引数254.2 / 253.0 / 42.2（cand/multi/clean）。noop割れ4/12世界、平均(T−Tnoop)<0のレジーム4（最悪informed-flow −8.12）。cand mined revert平均0.2/世界（multi-arb 8.4）、submitted3057/failed90（2.9%）。07:20 JST頃開始との引継ぎ（旧05:40頃開始見込みを訂正）、約55分。旧08:15 JST頃の完了見込みは実績ではなく、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。 第3回xa-1は打ち切り。H1専用adapter/受付未成立、Q0停止。 |
| 5 | q0b-evidence | 証跡精算のみ・再走なし | 0 | 未見積 | 実行担当の次の空き枠 | 旧60世界とG0 2世界FAIL・平均T FAIL保持。安全/区間証跡の照合のみ |
| 6 | q0-requal | 条件付き決定・実行停止 | 60 | 5 | 修理再診断・hash/seed/費用成立後 | A維持、§8.3の全12×2診断screen成立後、新41301–41305の未使用性監査、1候補1回。deep内5h留保、超過/不足は開始しない |
| 7 | mix-design | 設計のみ | 0 | 1/2 | 計測を邪魔しない空き枠 | 固定相手/slot/hashとH1の専用adapter/運営受付・G4経路を整理。標準ON拒否。mix1診断は契約変更ではなく、Q0の扱い・本番自由改訂の継続は本人判断。 |
| 8 | first-mix | 停止 | 12 | 13/15 | Q0契約PASS後のみ | 候補不変・roster/hash/G0。診断完走を資格PASSにしない |
| 9 | q0m | 不採用・旧未署名記録 | 60 | 143/30 | 現契約では実施しない | A維持のため選択しない。旧原案の費用/seedは履歴で実予約なし |
| 10 | first-p60 | 停止 | 60 | 13/3 | Q0 PASS後 | 候補不変・G3/G4費確保。公開回帰は資格代替不可 |
| 11 | first-g3 | 停止 | 36 | 13/5 | P60/資格・最小改訂policy後 | ON/OFF最小校正・実適用/復帰・機械的境界。gpt-oss:120b前提を本人了承・鍵登録受理は本人報告。無料枠不足時の前払い判断はG3見積もり後 |
| 12 | ai-implementation | 全費用待ち | 0 | 未見積 | S受理/cal/費用成立後 | H1実装済みa95054a（213テスト・赤対照25）の引継ぎ。専用adapter接続・検査は未実装、標準ON拒否。別系統xb-r-liveの32世界はPILOT-STOP、追加予約/ON4なし。 |
| 13 | ai-d-control | 未解放 | 48 | 52/15 | S受理後、AI下流全費用確保時のみ | 全12×新seed×A/D、48世界。旧案35001/35002はdev3診断で既見のため再利用不可。実行前に未使用の全seed集合を再登録。費用は基本単価で支援別。 |
| 14 | factor-ab | 保留 | 48 | 52/15 | 既資格候補と全残費がある場合のみ | AI優先、10/17から新規探索なし。二重予約不可 |
| 15 | m2 | 不採用・0h配分 | 60 | 13/3 | 現計画では実施しない | 13/3hは旧棚の全量見積で配分ではない。研究最大20h/2世代を維持 |
<!-- next-24h:end -->

別版Q0mを選ぶ場合の既存**17.4333hの基本見積**は、design/入口1h＋smoke13/15＋Q0m143/30＋P60 13/3＋最小G3 13/5＋G4検査58/15。xb-rの残費見積ではなく、追加修理/AI受付/資格/人間待ちを含まない。Q0経路の残量は担当証跡から更新する。10/8延期を理由に100hを再起算しない。

資源停止: 開始時空き39.5GiB（6.5GiB×p3＋20GiB）、output/TMP緊急下限25GB。排他リース/owner/5秒heartbeat、10秒欠落・重複owner・memory pressure非normal・swap開始比256MiB増・disk/G0不良で新規禁止（既存契約）。生成30秒以内取消、確認不能はリース保留。入力/HEAD/実行スクリプトを変えず、別matrix/CI/buildを重ねない。

## 9. 段階ロードマップと日程（JST）

**本人承認済み方針に沿う日程案**（各実走の契約登録・設定/hash・seed・全費用の証跡は別途必要）:

[日程案・JST] 10/5〜6 診断・設定固定・契約登録、10/6〜8 資格試験、10/9〜12 P60/最小G3/G4・本人送信・初回受理、10/13〜17は受理Sと全残費がある時だけ既決AI工程。10/17 18:00 H480/S240/Hなし分岐、10/18〜25 最終確認、10/26〜28 G4照合と10/28 dec-007、10/29 最終受理目標・10/30 予備・10/31 23:59 JST 照合。初回受理は未確保、日付を理由にゲートを緩めない。

| 判断窓 | 優先する出口 | 不成立なら |
| --- | --- | --- |
| 10/5〜6 | 承認済みのinc-zetaについて4レジームの弱点を診断、ascon-zeta-rの測定設定を固定し、由来とQ-ZETA-01を登録。分割PRも並行 | 契約・費用が決まるまで起動なし。1 seedで原因/合否を断定しない |
| 10/6〜8 | Q-ZETA-01の契約・全費用・新seed・設定/hash成立後、F_ref fresh 5 seed×12の資格試験約4.5hと終了検査を確保。混成場への変更なし | 通常6h/日・100h・安全閾値維持。10/5の単純和を確定残量に使わない。10/8延期は既決 |
| 10/9〜12 | 資格成立後、P60・最小改訂適合/G3/G4・本人送信/受理Sを最優先。新受理日は証拠から確定 | 10/9未受理時の本人判断を維持。H1標準ON拒否や受付問題が残れば探索を削る |
| 10/13〜17 | 受理Sと全残費がある時だけ既決AI工程。10/17 18:00のH480/S240/Hなし分岐を維持 | inc-zetaの未資格を既存Sとして扱わない。不足なら既決停止分岐 |
| 10/18〜25 | 条件成立時だけ封印済み最終試験、一度だけ判定 | 資格/費用不足ならH開始なし。日程を理由にゲートを緩めない |
| 10/26〜28 | G4と受理証跡を整理し、10/28 dec-007で本人がモデル/無料枠/疎通/ZIPを再確認 | 鍵登録済みと提出版受理を分離。本人操作の時間を確保 |
| 10/29〜31 | 10/29送信/受理目標、10/30予備、10/31 23:59 JST締切前に受理メール/hash照合 | 受理済み版は未確保。送信だけを完了と報告しない |


**10/8は旧受理目標、延期済み。** 初回受理日は未定であり、以下は条件付きの判断窓。初回受理が遅れればAI性能研究と深いリーグを先に削る。10/31 23:59 JSTは本人指定期限。規約本文はオンライン取得済みだが未来日付表示のため適用版は未確認。実装と契約・受理を同一視しない。

<!-- ai-roadmap:start -->
| Step | 期間JST | 入口 | 出口 | 費用・停止・本人判断 |
|---|---|---|---|---|
| Step1 決定論Q0・受理 | 10/5〜6準備、10/6〜8資格、10/9〜12初回受理目標 | inc-zeta弱点診断・設定固定・Q-ZETA-01登録・hash/G0/新seed/費用 | 凍結Q0→mix/P60→最小改訂適合/G3/G4→本人受理S | 新枠約4.5hは未精算・全費用確認待ち。旧Q0追加1回5hの自動転用なし。旧FAIL保持・延期は既決 |
| Step2 限定AI最小版 | S受理後〜10/12目安 | S・cal・受付境界/許可model/全費用 | H1（検査済み方針+ENTRY）・専用adapter/受付・適用/拒否/復帰・epoch間学習なし | H1は本人選択済み・標準ON拒否。adapter未実装、実行費未見積。旧署名・反復/費用契約は保持 |
| Step3 AI価値検証 | 10/13〜17 | 固定R*・未使用集合・D/反復/下流費 | Dへの増分・AI専用ON E3/Q1・R* G3三反復PASS | G3はR*12h＋S5.2h=17.2h。全工程未確保なら実走なし、10/17条件分岐 |
| Step4 封印・一回採用 | 10/18〜25 | 二場/10seed・model/reset/判定固定・残費 | H480又は事前指定S240、一回判定・性能凍結 | final-g2 35hはON校正前。不足ならS240、S/費用不足ならH未実施 |
| Step5 最終受理 | 10/26〜31 23:59 | 選定版・G4・本人確認 | 10/28 dec-007→10/29送信/受理目標→10/30予備→締切照合 | final-g4 9h＋予備3h。探索再開なし、受理メール/hashで閉じる |
<!-- ai-roadmap:end -->

詳細は[設計A–D](DESIGN-AI-LAYER-01-astra.md)。Step番号は性能研究の段階であり、Step1に必要な最小改訂適合をStep2後まで遅らせない。

<!-- schedule:start -->
| 日付 | 主な出口 | 依存 | 停止・反転条件 |
| --- | --- | --- | --- |
| 2026-10-04 | dev4/dev5診断、v5昇格せず | dev4 49.72対55.02、dev5 50.15対55.73。基準v3 | 第2回まで未達。既見seedを独立screen/Q0へ使わない |
| 2026-10-05 | 本人承認3点・移管完了、zeta-prepと分割PR進行中 | noop割れ4レジーム診断・測定設定焼き込み・由来/新契約下書き。結果は未確認 | 閾値維持、今のままmerge/提出可とはしない。実消費は未精算 |
| 2026-10-06 | 診断・設定/hash固定・Q-ZETA-01登録、資格入口を照合 | F_ref 12×5新seed=60世界・約4.5h、試行上限/独立性/全残費を登録 | 旧41301–41305/5h枠の自動転用なし、証跡不足なら開始不可 |
| 2026-10-07 | 条件成立時Q-ZETA-01資格試験。dec-008はresolved（旧期日） | 固定候補・新seed・全費用/G0。初回登録は10/4本人報告済み | 結果未確認、閾値緩和なし。モデル/無料枠/疎通は10/28 dec-007へ |
| 2026-10-08 | 資格結果を全量判定、延期済み旧受理目標も照合 | 独立60世界・G0/安全/平均T/全レジーム対noop | 不合格なら停止。10/8延期の再承認なし |
| 2026-10-09 | 未受理なら原因・質問方針を本人判断 | Q0/適合/受理の残工程 | 運営へ無断質問なし、AI性能研究/深い探索は後回し |
| 2026-10-10 | 資格成立後P60・最小G3/G4・受理準備を優先 | 資格・最小改訂受付・model/usage証拠と全残費 | 未受理なら探索窓を受理修復へ振替 |
| 2026-10-11 | P60・最小G3/G4、本人送信・初回受理Sを優先 | 資格・改訂適合・全残費。S受理後だけStep2 | H1標準ON拒否・受付未成立なら停止 |
| 2026-10-12 | 初回受理Sの証跡照合・規約適用版を確認 | 本人送信/受理メール/ZIP hash・最小G3/G4 | 資格/適合/受理を混同しない。未受理ならAI探索を削る |
| 2026-10-13 | S full G3証跡照合、未取得なら72世界 | S固定・ON/OFF各36・全残費 | 同一版の有効証跡だけ再利用。5.2hを二重計上しない |
| 2026-10-14 | 固定R*がある時だけON E3/Q1/G3の残工程 | Dへの増分・新seed・全費用・受理S | 次点再選抜/未検証H移行なし、深い棚との二重追加禁止 |
| 2026-10-15 | 障害/復帰・遅延・epoch reset確認 | 正常cycle・return/submit境界・CPU排他 | 危険取引/持越し不一致/反復間の結論反転なら停止 |
| 2026-10-16 | AI増分・決定論代替・費用を整理 | 全予定の開封条件と証拠 | LLM導入そのものを利益証明にしない |
| 2026-10-17 | 18:00 JSTにAstraが確定条件でH480/S240/未実施へ切替 | 受理S・D増分・R* E3/Q1/G3・cal後の全残費と日程 | 不足ならAI終了。既資格候補がなければ深い探索へ替えずS240、S/費用不足はHなし |
| 2026-10-18 | Step4: 二場/候補/10seed/model/stateを封印 | 資格/G3・独立系列と判定/費用契約 | 未達ならH開始なし、反復数を後付けしない |
| 2026-10-19 | H開始、通常最大6h | 封印・校正後chunk上限 | G0/安全/時間のみ監視 |
| 2026-10-20 | H継続・適用規約版を照合、通常最大6h | 前chunk正常・入力不変・10/20表示版の確認 | 仕様差分が出れば比較可能性を再判定、性能再走禁止 |
| 2026-10-21 | H継続、通常最大6h | 全予定の完了見通し | 相手/seed/版の交換禁止 |
| 2026-10-22 | H継続、通常最大6h | 残枠とG0 | model変更は同一試験へプール不可 |
| 2026-10-23 | H継続、通常最大6h | 予定集合を維持 | 欠測の黙示除外禁止 |
| 2026-10-24 | H継続、通常最大6h | 終了検査の時間も確保 | 部分成績で採用禁止 |
| 2026-10-25 | 全予定Hを一回判定、性能凍結 | 480又は事前指定240全件G0 | 差不明/未完は適合S、比較主張なし |
| 2026-10-26 | 最終P60 60 ON | 選定版・実測時間 | 失格/資産喪失/受理不能以外の性能変更なし |
| 2026-10-27 | 配置/起動順24 ON、G4 | 事前固定の配置・残枠 | 逆転なら優位主張撤回、無検証差替えなし |
| 2026-10-28 | G4照合、最後にdec-007 | 全技術証跡・本人確認 | 修正なら影響検証とF0を再実施 |
| 2026-10-29 | 本人最終送信・受理/hash | READYと鍵登録証跡 | 未受理版を最終扱いしない |
| 2026-10-30 | 受理ZIP/鍵の確認・予備 | 受理メール/commit/hash | 探索再開なし |
| 2026-10-31 | 10/31 23:59 JSTまでに最後の受理版を照合 | 本人指定期限・適用版・受理メール/hash | 駆込み無検証更新なし。未受理版を最終扱いしない |
<!-- schedule:end -->

## 10. 本人決定・委任決定の台帳と本人に残す操作

**本人判断の現在地**: [本人決定・チャット承認 2026-10-05 JST] 3点を「進める」: inc-zeta（ascon-zetaのzeta-a30）の実質的改変を独自戦略と認め、multi-arb派生を開示して条件付き第一候補にする。弱点診断後、現行閾値を維持した新契約・回数枠Q-ZETA-01（F_ref・12レジーム×5新seed=60世界・約4.5h）で資格試験へ進む。上流統合・適応とleague追加分を分割PRにし、Claudeの別エージェント+agyによる独立レビュー・CI後、merge commitで統合する。

**本人が今やること**: [進行中・本人報告] 分割点3d86a35からpr/upstream-integration（CIのignore-scripts修正を含む）をmain向けPR1にし、league/v2をPR1ブランチ基点のPR2にする。PR1 merge後にPR2のbaseをmainへ付け替える。独立レビュー・CI後にmerge commitで統合。PR番号・レビュー/CI/merge結果は未確認、進行は本人報告へ。 資格成立後の本人送信・初回受理、10/28 dec-007・最終受理確認は本人操作として残す。

[独立意見・引継ぎ] Codex(Astra)は賛成。ただし「今のまま merge/提出してよいとは判断しない」。分割点候補は3d86a35。提出物混入は確認範囲で重大なしだが、直書き秘密の全件監査・実ZIP検査・運営配布版との一致は未確認。現行CIのnpm ciにNPM_CONFIG_IGNORE_SCRIPTS=trueが無く作業ルールと不整合のため修正対象。inc-zetaの測定設定（bidMode:2等はrosterの環境変数）はコード既定値（bidMode:0）と違い、そのままbundleすると再現しないため焼き込み候補を固定する。noop割れ4レジームを先に診断する。契約の場を混成場へ変える案は結果を見たあとの基準変更になるため推奨しない。

反証条件: 独立60世界で平均T<multi-arb、いずれかのレジーム平均(T−Tnoop)<0、mined revert>1件または包含取引比>0.1%、原因不明の失敗、未回収自前資産損失/gas枯渇/無効注文>0のいずれかで停止する。G0・既決安全条件も維持し、閾値緩和・結果後の場変更・救済再走で合格にしない。 承認は準備と新枠の方針を確定したもので、資格合格・merge完了・提出許可ではない。Q-ZETA-01の契約登録・試行上限の明文化・未使用seed監査・焼き込み設定/hash・診断/安全・全残費の証跡は未確認。約4.5hは見積で、通常6h/日・forward100hと既決留保を維持する。旧Q0-A-REQUAL-01の1候補1回・41301–41305・5h枠を自動転用せず、旧3/3回目打ち切りを解除しない。

rev 10〜13の未決提案は判断・ログの原記録として保持し、現在の再承認待ちとして扱わない。混成場へ変更する契約変更は未決定であり、独立意見は推奨しない。

**2026-10-04本人決定（原記録を維持）**: H1「検査済み方針の選択+ENTRY」を選択、全面コード改訂は見送り。課金なし方針、H1標準ON拒否は維持。別系統liveのsim内測定は本番全面改訂承認へ拡張しない。鍵の再登録は不要。

**以下はrev 6の委任決定原記録（不変）**。本人が 2026-10-04 に Astra へ判断を委任。Astra が決定。原判断資料は本人指定の`/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer/b274e4c9-6365-44d8-96d5-84b3db6e48ad/scratchpad/decisions.out`。推奨の論点1〜6を以下の決定へ確定した。資料の「本人にしか決められない部分」は今回の明示委任で解消した範囲のみ更新し、秘密・金銭事項へ拡張しない。

| 論点 / dashboard ID | 決定 | 本文の契約 |
|---|---|---|
| 1 / dec-ai-scope | 限定パラメータのみ、ENTRY_BPS 20–60・初期60・最大±5bps | §5 / AI設計B。固定ゲート・epoch内安全state保持 |
| 2 / dec-ai-contract | R* ON3/OFF1の12h＋S既存full G3 5.2h、持越しなし、D対照・AI E3/Q1 ON | §6 / AI設計C。17.2hを全量予約、実行条件は未成立 |
| 3 / dec-ai-budget | deep9.7h / G3 17.2h、M2 0h、Q0/受理/最終確認優先 | §7.2–7.3。10/17のH480/S240/未実施分岐を決定済み |
| 4 / dec-q0-failure-branch | A現行維持、修理済み1候補1回の追加Q0、追加P/F_u1m条件は不採用 | §4.1。新seed/hash/費用の技術証跡待ち |
| 5 / dec-q0b-g0 | 全60世界・不合格記録保持、資格救済再走なし | §1.3。G0 FAILと平均T FAILを別記 |
| 6 / dec-revert-limit | 各60世界≤1件かつ包含比≤0.1%、原因/回収不明はFAIL | §4.1。新資格だけ、旧結果へ遡及しない |

**決定署名**: 本人が 2026-10-04 に Astra へ判断を委任。Astra が決定。署名者=本人委任のAstra決定。署名日時=2026-10-04T15:00:11+09:00（今回の決定記録時刻。Masashi本人の署名・過去の委任時刻を代署したものではない）。

[本人報告] 2026-10-04 15:07頃 JST、運営フォームの鍵登録受理表示を本人が提示。Ollama Cloud鍵・代表者メール一致は本人確認。画面はFree・無料枠0%・残高$0・Auto-reload Off。無料枠モデル一覧はgemma4:31b、gpt-oss:120b、gpt-oss:20b、nemotron-3-nano:30b、nemotron-3-super、nemotron-3-ultra。許可モデルは既定例gpt-oss:120bを前提に進める（本人了承）。dec-008=resolved、attentionctl記録済み。クリップボードの鍵は本人が消去済み（本人報告）。 運営公表モデル一覧との照合・無料枠の量の十分性・鍵の疎通は未確認で、10/28 dec-007で再確認。鍵/登録について現在の本人作業なし。本番自由改訂の継続/提出は別の本人判断で、今回の3点承認へ拡張しない。無料枠不足時の前払い判断は将来のG3見積もり後で、支払承認ではない。 初回登録と最終再確認は別、ZIP送信と受理も別。

既決事項は再承認へ戻さない。新受理日は技術証拠と残工程で再見積する。10/8未受理時の10/9運営質問方針、ZIPの本人送信は従来の本人操作として維持し、本作業から連絡/送信しない。

## Appendix A. Grok全18件への回答（revision 6）

旧回答のうち夜間未実施・二つの予算起点・未実装xbの記載を更新した。acceptは対策の実効が実証済みという意味ではない。

<!-- findings:start -->
| ID | 判定 | 根拠・理由（tag） | 正確な変更箇所・内容（tag） |
|---|---|---|---|
| C1 | accept | [measured] F_ref/u1mで順序逆転。ただし対応因果比較ではない | [inferred] §3/4/6: 新F_mixと旧FAILを分離、署名案・最終二場ゲート |
| C2 | accept | [inferred] 10seedでは小差と選抜楽観が残る | [inferred] §6: 新E3/Q/H、最大10クラスタ、保守下限・shrinkage・S優先を維持 |
| C3 | accept | [measured] 過去18.6h以上、夜間の所要実時間は未提示 | [inferred] §7: forward使用、夜間ceil見積/上側予約、Q0b完了分の時間推定、両選択100h・実走解放0 |
| C4 | accept | [inferred] 初回受理とON/混成安全が先 | [inferred] §4/8: Q分岐→smoke/P60/G3/G4、探索は未解放 |
| C5 | accept | [measured] sonnet Q0・opus Q0bとも平均T FAIL、Q0b G0 2世界FAIL | [inferred] §4.2: 全滅で探索停止・延期済み、追加資格は対象契約を照合 |
| W6 | accept | [inferred] 等重みだけでは後半集中尾部を守れない | [inferred] §6.3: 60epoch/後半1→1.5/ES5下限の拒否権を維持 |
| W7 | partly | [inferred] 旧E1/E2は別seedだがE2拡張確認は弱い | [inferred] §5/6: 独立E3の72世界、修理後再認定/次点再選抜なし |
| W8 | accept | [measured] MVP優先の5診断は完了、Q0まで進行 | [inferred] §8: queueをxb-r修理/再診断→現Q0/受理へ更新、AI実走/探索は未解放 |
| W9 | accept | [measured: 本人決定] 最大20h/2世代は既決 | [inferred] §2/7: 再承認なし。現行deep9.7h・Q0優先留保と研究承認上限を区別 |
| W10 | accept | [inferred] 設定焼込みは独自設計を証明しない | [inferred] §4.1: 由来/資金/退出/意思決定の実質差、xb≠sonnet、hash変更時再資格 |
| W11 | accept | [measured] 夜間並行作業の報告はG0 PASSだけで排他証明にならない | [inferred] §3/8: 運用逸脱を明示、固定script/排他/heartbeat/取消/入口監査 |
| W12 | accept | [unverified] ONの13分batch保証はない | [inferred] §7.3: 最小cal36、最大×1.2、1.5/2倍とS単独切替/開始停止 |
| W13 | accept | [measured] inc-zeta D0 FAIL、Q0の3chunkはPASS報告 | [inferred] §1/3: D0順位認定なし、F_mixは新beginと場別G0を要求 |
| S14 | accept | [measured: 既存資料] P60の202はu1mと重複 | [inferred] §6: 公開回帰のみ、汎化holdoutと呼ばない |
| S15 | accept | [inferred] 狭い高入札専用場では相互作用が不足 | [inferred] §3: F_bid廃止、固定10相手F_mix、未確認hashを明示 |
| S16 | accept | [measured] M1完了、14/16重複、利益源追加0 | [inferred] §5: 再生成なし、D/E/A支援1.9h、M2既定省略、brief機構禁止 |
| S17 | accept | [unverified] 規約本文はオンライン取得、未来日付表示のため適用版/提出形式は未確定 | [inferred] §1/10・AI設計: 初回前/10月12日/28日に適用版と実装を照合 |
| S18 | accept | [inferred] checkerは静的整合のみ | [inferred] Appendix B: 出典表一致/予算/queue/HTMLを検査、実時間・描画・受理は未検証 |
<!-- findings:end -->

## Appendix B. 軽量整合性検査

`python3 -B ascon-notes/league/check-plan-consistency.py` は本書・MORNING・M1の表/予算/queue/日程/委任決定と旧未署名記録と、正本HTMLデータとの対応を検査する。退役summary HTMLの固定状態は使わない。`python3 -B ascon-notes/league/dashboard-check.py --self-check` はJSON/出典表/ID/JST/ログ/予算/タグとメモリ内反例を検査する。原run・測定worktree・ネットワークは参照しない。

<!-- self-check-output:start -->
```text
PASS check-plan-consistency: rev 14 facts, unchanged contracts, 95 preserved logs / 20 preserved decisions + 3 approvals
PASS plan controls: 558 unsafe/stale mutations rejected in memory
PASS dashboard-check: 14 blocks / 100 logs / 19 source tables / 53 terms
PASS checker controls: 23 invalid cases rejected in memory
PASS dashboard UI: 33 checks / 8 pages + qualification / KPI only on overview / 375px static containment
PASS rendered HTML: 9 views / balanced tags / safe links / unique IDs
PASS git diff --check
LIMIT: static consistency only; zeta-prep results, PR review/CI/merge, raw runs, actual hours, current rules, ZIP, browser layout and acceptance unverified
```
<!-- self-check-output:end -->

PASSは静的整合だけ。zeta-prepの作成物・資格結果、分割PRのレビュー/CI/merge、提出物の全件監査・実ZIP・運営配布版との一致、移管の再監査は未検証。提示値の原ログ、実占有区間、incz原ログ、監視失効対策の実稼働、本番モデル比較/規約適用版/受理/ブラウザ描画は未検証。本人指定の重い処理禁止を優先し、`npm run typecheck`と戦略テストは未実行。本更新の軽量検査は提出時G4を代替しない。

## 11. 未解決事項と引継ぎ

決定論ラインは第3回xa-1で打ち切り、Q0のF_ref平均T≥multiに未達。自由改訂はPILOT-STOP。mix2・48世界集計を受領、混成場はinc-zetaが1位、candは48世界で5位。inczも診断完了、平均T56.30対44.44・noop割れ4/12。全計測終了・走行中なし。 [本人決定・チャット承認 2026-10-05 JST] 3点を「進める」: inc-zeta（ascon-zetaのzeta-a30）の実質的改変を独自戦略と認め、multi-arb派生を開示して条件付き第一候補にする。弱点診断後、現行閾値を維持した新契約・回数枠Q-ZETA-01（F_ref・12レジーム×5新seed=60世界・約4.5h）で資格試験へ進む。上流統合・適応とleague追加分を分割PRにし、Claudeの別エージェント+agyによる独立レビュー・CI後、merge commitで統合する。

mix1/mix2の各24世界と48世界集計は本人提示の診断結果を記録済み。mix1のG0 BLOCKEDは保持。incz全12世界の結果/G0/安全を本人提示measuredとして受領済み。実完了時刻は未提示のまま保持。[朝報告](MORNING-2026-10-05.md)はrev 13時点の履歴として保持し、現在の方針は本書と正本JSONを参照する。H1 ON拒否、PILOT-STOP、第3回未達、Q0/旧FAIL/署名・時間枠は維持。

[本人報告 2026-10-05 JST] 夜間のハートビートは取消済み。記憶(ASCON)は移管・体制・教訓を更新済み。decisions.jsonのdec-007参照先文字列は追跡ファイルのため未更新（次にハーネスを触る時にPR）。ASCON repo内ドキュメント18件の旧パス/旧オーナー文字列は未更新（symlink/redirectで動く）。本更新はこれらの一括置換や記憶更新を行わない。 旧運用は8分ごと・/tmp/night-state.md・監視30分で失効という履歴。既決の60秒以下監視・2分検知/5分受領/10分次着手は将来の実走入口として維持する。 Codex(Astra)主・Claude副・agy補助、Grok離脱。モデル照会・別エージェント起動・鍵/登録/送信操作は行わない。10/28 dec-007と10/31 23:59 JSTの期限、受理済み版の確保は別に追跡する。コミットなし。

## Appendix B. ダッシュボード用語・表示整理

用語の説明は競技ガイド・採点仕様・本計画・修理設計・xb-r README（R1–R5）・DEV2-XB-R-REPAIR（R6/R7）に基づく。外部サイトの再取得なし。文書の過去形の状態を現在状態に転用しない。

<!-- glossary:start -->
| 用語 | 説明 |
| --- | --- |
| ASCON | Nyx Foundation主催の、自動売買エージェントが仮想の金融市場で資産を増やす競技。 |
| エージェント | 市場を観測して売買を決めるプログラム。candは測定対象の候補を指す。 |
| T（相対スコア） | 同じエポックの参加者の損益Pを基に標準化した点数。相手の構成が変わると値も変わるため、別の場のTを直接比べない。 |
| P（損益） | エポック終了時の資産価値から開始時を引いた損益。P−noopは何もしない場合からどれだけ増やせたか。途中の含み益だけでは決まらない。 |
| noop（何もしない比較対象） | 取引せず初期資産を保有する参照エージェント。資産価格が動くので、何もしなくても損益は変わる。 |
| multi-arb | 複数市場の価格差を使う参照エージェント。2脚を優先し、条件がなければ単脚も使う。現Q0ではこの相対スコア以上が必要。 |
| clean-arb | multi-arbの2脚裁定部分を使う参照エージェント。独自の提出候補ではない。 |
| レジーム（市場の状況） | 平穏、急落などの市場条件。競技では12種類をほぼ等しい重みで評価する。 |
| エポック（採点区間） | 区切られた採点期間。終了時に資産価値を評価し、後半の区間ほど重く集計する。 |
| seed（再現用の番号） | 乱数の流れを固定する番号。同じ条件の再現や、開発で見ていない試験集合の管理に使う。 |
| 世界（1回の市場シミュレーション） | レジーム・seed・対戦構成などを組み合わせた1回の測定単位。エージェントの人数とは別。 |
| F_ref（固定の参照相手） | 標準の参照エージェントと対戦する評価構成。現在の初回資格試験で使う。 |
| F_mix（混成の対戦相手） | 複数の性質を持つ相手を混ぜた評価構成。相手・順番・コードを測定前に固定する。 |
| Q0（初回の資格試験） | 固定した候補を未使用seedの全12レジームで検査する60世界の試験。平均Tがmulti-arb以上、各レジームでnoop以上、安全条件などが必要。診断の好成績だけでは合格しない。 |
| Q0b（2候補目の資格試験） | opus-1に実施した初回資格試験。平均T条件不合格と、2世界の計測不成立を別々に保存している。 |
| Q0m（混成場の資格試験案） | F_mixを使う別の資格契約案。未署名で不採用。実行待ちの試験ではない。 |
| G0（計測成立の確認） | 入力が固定され、必要な処理が欠けず、負荷条件を満たしたかを確認する入口。利益の合格を意味しない。 |
| G3（AI改訂の動作・安全確認） | AIによる改訂を動かした状態で、適用・拒否・復帰・反復・安全を確認する。改訂停止中の性能では代替できない。 |
| G4（提出適合の確認） | 提出ファイル・設定・型・検査・起動・受付条件などを照合する最終確認。鍵登録だけで提出版の受理にはならない。 |
| P60（公開60シナリオ） | 公開されている60シナリオで既存の動作が壊れていないか確認する。未使用の資格試験とは別。 |
| 診断計測 dev1 / dev2 / dev3 | 原因や改善点を調べる開発用測定。dev1は無取引、dev2は取引成立後の収益不足、dev3は修正版を確認する。いずれも資格試験の合格を表さない。 |
| xb-r（独自戦略の修理候補） | sonnet由来のxb-coreを土台に、実費後の利益・在庫・払える入札額で売買を選ぶ候補。R1–R7は個別に切り分ける機能スイッチ。 |
| R1–R7（機能を分けて調べる因子） | 同じ戦略の機能を一つずつ有効・無効にして影響を調べる番号。モデル名や競技の順位ではない。 |
| R1：2脚取引を先に選ぶ | 条件を満たすbundleを単脚より先に選ぶ。古いログのR1（第1ラウンド）とは別の番号。 |
| R2：残高も使って売買量を決める | 市場の厚みだけでなく残高からの目標量も使う。資金・在庫の上限を外す機能ではない。 |
| R3：入口の安全幅を二重に引かない | 取引を始める閾値と利益計算を分け、入口で使った安全幅をサイズ・利益から再び引かない。 |
| R4：払える競合入札だけ送る | 実行先の競合より優先される手数料を予算内で払える場合だけ送る。dev1では競合手数料の誤認を修正した。 |
| R5：終盤も利益が残る在庫復元 | 終了直前は新規リスクを抑え、利益条件を満たす場合だけ初期在庫へ戻す。損失を出す強制売却は導入しない。 |
| R6：初期在庫の地点を通過できる | 十分な新規利益が見込める通常時は、初期在庫の量で売買を止めず反対側へ進める。在庫帯と終盤制限は維持。 |
| R7：単脚の入口を共通化 | 単脚にもENTRY_BPSを使い、追加100bpsの拒否だけを外す。R6と独立して切り替える。 |
| bundle（複数の脚をまとめて送る） | 買いと売りなどをまとめた取引。必ず全部同時に成功する仕組みではなく、片方だけ成功する場合がある。提出bundleはエージェントを配布用にまとめたファイルを指す。 |
| 単脚（1方向だけの売買） | 片方の売買だけを実行する取引。買いと売りを組み合わせる2脚と区別する。 |
| revert（チェーン上の実行失敗） | チェーンに取り込まれたが処理が取り消された取引。送信前の拒否や読取失敗とは別に数える。 |
| 凍結 / FROZEN | 試験中のコードや条件を固定し、AIの改訂を止めた状態。提出時の改訂ONでの検証は別に必要。 |
| 改訂 / revision | エージェントをAIが更新すること。ONは更新あり、OFFは停止。MASTER rev 6のような文書の版番号とは文脈が異なる。 |
| Ollama（AIモデルの実行サービス） | gpt-oss:120bなどのモデルを利用するサービス。鍵の登録受理、モデルの許可、無料枠、疎通、ZIP受理は別の確認。 |
| forward100h（今後の計算時間枠） | 10/4以降に使う計算時間の100時間枠。過去消費は別記し、予約と実消化を混同しない。今回、正確な実消化は未精算。 |
| dec-007：提出前の本人確認 | 10/28にOllamaの運営モデル一覧・無料枠量・鍵の疎通・提出ZIPなどを再確認する判断記録。現在も未完了。 |
| dec-008：初回の鍵登録確認 | 本人報告により初回確認は解決済み。元の期日は10/7。最終確認や提出ZIPの受理とは別。 |
| deterministic（決定論） | 同じ入力と状態なら同じ判断を返すこと。AIによる調整を加える前の比較の基準になる。 |
| measured / 本人報告 / 未確認 | measuredは提示された計測集計。本人報告は本人が確認した画面や操作の報告。どちらも、このダッシュボード担当が原ログ・サービスを再監査した意味ではない。 |
| bps（ベーシスポイント） | 割合の単位。100bpsが1%。ENTRY_BPSは取引を始めるために必要な価格差の設定。 |
| S（受理済みの基準版） | 資格・適合を満たし受理された独自版。上積み候補を採用できない場合の基準。S240はこの版だけを最終240世界で確認する計画。 |
| R*（上積みを狙う候補） | 基準版Sからの改善を検証する固定候補。採用にはAI専用試験や反復の証拠が必要。 |
| E3 / Q1（開発比較と次段階の資格） | E3は候補の改善を調べる独立の比較、Q1はその後の資格確認。AIでは改訂ON専用の試験を別途確保する。 |
| H / H480（封印した最終試験） | 調整に使わない条件を事前固定し、最後に一度だけ開く比較。2候補なら480世界、基準版だけなら240世界。 |
| hash（版を識別する指紋） | コードや設定が測定時と同じか確認する識別値。未提示の値は推測で埋めない。 |
| 赤対照（壊れた実装を検出する検査） | 意図的に欠陥を入れた実装をテストが正しく失敗させるかを確認する。戦略の利益を示す検査ではない。 |
| Astra（過去の記録上の担当名） | 過去の計画・判断で使われるCodex側の担当名。現在の担当欄はCodexに統一し、判断者・署名の原記録は保持する。 |
| R9 / bundle用在庫余地 | 単脚の在庫帯を初期±10%に抑え、bundle各脚の±20%帯の余地を残す因子。v5でON、dev5は平均T 50.15対55.73で昇格せず、基準はv3。 |
| agy / Gemini 3.8 Flash High | 補助レビュー役。masa-harness#409でハーネス反映済との本人引継ぎ。独立レビューはClaudeの別エージェントと組み合わせる。 |
| PLATEAU-ANALYSIS | 構造の異なる独自設計候補を検討する別ジョブ。Astraが作成中との引継ぎで結果未確認。採用や追加計測の承認を表さない。 |
| 同seed対応診断 | 同じレジームとseedの旧版・新版を比較する開発診断。因子選択に使った既見seedなので独立fresh screenやQ0には使えない。 |
<!-- glossary:end -->

画面から省いた重複: 同じ結果を複数の図表で繰り返す表示（MASTER §1と進捗・結果の原表に集約。数値の削除なし。） / 予算配分・AI契約の繰り返し説明（MASTER §5–7。判断・予算の詳細に一度だけ表示。） / トップに並んでいた内部の実行手順・古い経緯（MASTER §8–11。原表・履歴・ログの折りたたみへ移動。）
既存95ログは全フィールドをそのまま保存。rev 14の5件を新しい順に加え全100件。既存20判断も全フィールド不変で、本人承認3件を加え23件。新しい3つの重要イベントはstatus.recentから描画し、ログ件数を水増ししない。
