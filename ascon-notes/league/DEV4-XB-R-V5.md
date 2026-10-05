# dev4 実ログの判断ルール適用と xb-r v5

1. **決定: 次の単因子診断は R9 のみ ON。候補の性能確認済み既定への昇格ではない。**

   [DEV3-XB-R-V4-PREP §4](DEV3-XB-R-V4-PREP.md#4-dev4後のon判断ルール事前の運用判断性能予測ではない)を適用。
   入力は upstream-eval の `ascon-notes/eval/out/{dev4a-xb-r,dev4b-xb-r}/index.tsv` の24 `run_dir`。
   F_ref・36001/36002・凍結v3 `d30cbbb46ca472b5a7a72fc1b99deab96dc97bf3`、G0 PASS は本人報告。
   今回原ログで24世界、12レジーム×2seed、exit=0、360 blocks/362 loops、violations/failedReads/mined revert=0を確認。
   現在の upstream-eval の agent.ts も凍結v3とbyte一致（SHA256 `78d8fa43156cee872e1bcbcaf86c1da00f1aa1646c6b210e7af4b499edea4d04`）。
   完全なG0判定器・実行時の全依存hashの再監査はしていない。

   | §4 条件 | dev4 全24世界の数値 | 判断 |
   |---|---|---|
   | 全体T条件達成なら新因子OFF | 等重み T 49.72478 vs 55.01632、差 −5.29154 | 未達 |
   | R9: 成功bundle比<0.5、在庫ブロック≥25% | cand 114 / multi 925 = **12.32%**。multi成功付きcand noopの **3,858/4,076 = 94.65%** が在庫帯でブロック（再構成） | **R9のみONの診断** |
   | R11: 平均単脚cash比≥1.25、在庫ブロック≥25% | 世界別平均を等重み: $2,261.18 / $1,920.18 = **1.1776倍**。全単脚をpoolしても1.1924倍 | OFF |
   | R10: 正net候補のうち深さ目標だけで抑制≥5%、他hard cap余地あり | 安全selector通過正net候補 **0/1,326 = 0%**。R10単独によるサイズ/判断変更も0 | OFF |
   | R12: failed率≥3%かつ未確認同base4block内再失敗≥2、又は同パターンmined revert≥1 | **23/(1,652+23)=1.373%**、再失敗 **1件**（4block以内・次block残高未確認、再構成）、同パターンrevert 0 | OFF |
   | R7厳格化: 50<edge≤75bps成功単脚≥20かつΣ(E−gas)<0 | **1,103脚、Σ(E−gas)=+$12,491.24**。決定blockのquote/feeでedge bucketを復元、Eは包含時fair、gasはreceipt実費・終値換算 | R7 ONを維持、75bps化しない |
   | ENTRY=45: 45<edge≤50かつ他gate合格が参照成功付きnoopの≥10% | **64/4,076 = 1.570%** | **ENTRY=50維持** |
   | R13・専門因子 | §4にR13のON条件なし。専門因子は対象外。R13実行quote/fill保証を示す新証拠なし | OFF維持 |

   優先順は安全R12→在庫R9→R11→ENTRY→R10/R7。今回成立するのはR9のみで、複数因子を同時に足さない。
   成功bundle数は **submitted.bundleId をhashで成功receiptに結合したID数**。両脚成功のみでも112/919=12.19%で判定不変。
   candの片脚成功IDは2/114=1.754%（cex-drift/36002、spike/36002）、multiは6/925。
   これは「未解消片脚0」の証明ではない。次診断で全試行の送信/包含/回復を別途確認する。
   23件のsubmit_failedは先頭エラーが Too little received 8 / BAL#507 11 / Slippage 4。原因不明の先頭エラー0、mined revertと区別する。

   gate値はruntimeが保存した拒否理由ではなく、ログの残高・quote・receiptからの**再構成値**。
   分母は同じblockSeenでmultiの包含成功があるcand noopの一意フレーム、分子はENTRY/冷却を通過した経路で在庫幅により$50未満となるフレーム。
   経路を重複加算せず、clean-arbは主分母に含めない。全12レジームの比率は88.3–99.0%で単一レジーム依存ではない。
   在庫後のbid/netも落ちる経路を含み、「在庫だけが原因」の比率ではない。
   Uniswap active liquidity欠測の300,000 USD fallback、出力残高丸め、raw tx.to欠測からの入札復元がある。
   全体のtrade/noop一致は7,970/8,664=91.99%、実attemptの再現は872/1,561=55.86%。実送信増や収益の因果効果とは呼ばない。
   §4が許す再構成判定としてR9を**診断に限り**採用する。
   固定したv3の残高上ではR9で追加判断0、消える判断180、サイズ等の変更75。将来のbundle回復は未実測。

   [全世界の会計・入力SHA256・集計](../eval/dev4-v5-xb-r-analysis.json) / [オフライン再集計スクリプト](../eval/diagnose-xb-r-dev4-v5.mjs)。
   P平均もcand488.16469 / multi1460.80460、全世界noop割れ0、最悪P−noop +73.76389（depeg/36001）、最悪レジーム平均T−Tnoop +7.84944。
   dev3の48.42→dev4の49.72は別seed比較であり、v3の効果ΔTと解釈しない。

2. **実装と復帰方法。**

   [agent.ts](../../example/agents/xb-r/agent.ts)の `V3_PARAMS` に凍結v3設定を保存し、`PARAMS={...V3_PARAMS,R9_BUNDLE_HEADROOM:true}` とした。
   本番のアルゴリズム変更は既存R9の既定切替のみ。単脚の在庫帯を初期±10%とし、bundle各脚の±20%帯は維持。
   `R9_BUNDLE_HEADROOM:false`、又は `createAgent(V3_PARAMS)` / `createLiveAgent(V3_PARAMS)` でv3の挙動へ戻せる。
   R10/R11/R12/R13は個別スイッチのままOFF、R7/R8はON、ENTRY=50。
   canFund/各脚の独立資金確認、8%資産上限、残高90%、gas予備0.05 ETH、net≥$0.05、正priority、slippage80bpsを変更していない。
   ENTRYのみAI権限20–60・5bps刻みを維持。promptは固定診断用、runner側の推論無効化が必要。
   DEV3A_PARAMS/DEV2_PARAMSがR9 ONを継承しないよう、歴史設定の起点もV3_PARAMSに固定。
   multi-arb実装は移植していない。既存参照agent/SDK/runtimeは変更なし。

3. **検証: 183/183 PASS、59/59 intended RED、復元確認済み。**

   実行前の既存xbテストは**173件**（依頼時の165件より8件多い）。全173件を維持し、dev4由来6フレームのfixtureと10テストを追加。
   古いv3/v4テストは歴史設定を明示し、assertionやテストを削除していない。
   fixtureは約50 KB、run/seed/原ログhash/凍結v3golden/各単因子の期待actionを含む再構成入力。
   買い/売りの半帯、見送り、bundle不変、参照成功付きnoop、ENTRY45のみの機会を収録。
   WBTC両方向と「単脚の半帯外でもbundleは元の帯を使う」回帰も確認。
   さらに全8,664フレームで、R9等OFFとgit d30cbbb原本の候補選択・状態付きcreateAgentの一致を確認。
   この一致は同じ固定入力列上の互換性で、動的チェーンの性能を示さない。

   `npm run typecheck` (tsc --noEmit): PASS。
   `TSX_DISABLE_CACHE=1 node --import tsx scripts/checkStrategyCode.ts example/agents/xb-r/agent.ts`: PASS、findings0。
   xb全8ファイル・並列度1: 183 PASS / fail0 / skip0。
   赤対照は既存54を維持＋5=59。全てexit1、対象名のERR_ASSERTIONを確認し、ロード/構文エラーを赤と数えていない。
   各変異後と最終finallyで原本を復元、復元後も全183件PASS。
   **復元agent.ts SHA256: `a4ab7664cf87155ad193cc79ae038ecf4d2e6289d71179b3bc356b52c4a36b54`**。
   [検証記録・59件内訳・ログhash](../eval/dev4-v5-validation.json) / [fixture](../../test/fixtures/xb-r-dev4-v5.json) / [回帰テスト](../../test/xb-r-v5.test.ts)。

   ```sh
   npm run typecheck
   TSX_DISABLE_CACHE=1 node --import tsx scripts/checkStrategyCode.ts example/agents/xb-r/agent.ts
   TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 test/xb-core.test.ts test/xb-variants.test.ts test/xb-r.test.ts test/xb-r-dev2.test.ts test/xb-r-dev3a.test.ts test/xb-r-v4.test.ts test/xb-r-slippage.test.ts test/xb-r-v5.test.ts
   TSX_DISABLE_CACHE=1 node test/xb-r-red-controls.mjs
   TSX_DISABLE_CACHE=1 node --import tsx ascon-notes/eval/diagnose-xb-r-dev4-v5.mjs ../upstream-eval /tmp/xb-r-dev4-v5
   python3 -B ascon-notes/eval/audit-xb-r-v5-seeds.py
   ```

4. **次の診断の推奨は同seed36001/36002の24世界。通算は今回v5が第2回/最大3回。**

   確認できた履歴ではv3のsmoke dev4s（calm/36003）＋dev4a/bが第1回。
   v4は全新因子OFFの準備で、独立したsmoke/全域診断の台帳なし。今回のv5検証着手からを第2回として管理する。
   未記録の失敗smoke/検証があれば通算を繰り上げる。本人への履歴照会に追加報告がないため、この番号は確認可能な履歴に基づく。
   dev3a/bはrev7どおり既知ベースライン。名称v5を5回目とは数えず、失敗や再起動で回数を消さない。

   | 案 | 利点 | 不利・運用制約 |
   |---|---|---|
   | **同seed36001/36002でv5を24世界（推奨）** | 既存dev4の凍結v3を対照に、各(regime,seed)の対応ΔTを追加24世界で得る | seedは既見。dev4から因子を選んだ開発診断であり、独立screen/Q0には使えない |
   | 新seed37001/37002でv5のみ24世界 | rev7の未使用seedの全域screenに適する | v3/dev4とseedが違い、§4の対応ΔTを得られない |
   | 新seed37001/37002でv3とv5を各24世界 | 同一fresh seedで対応比較できる | 計48世界、p3・13分/batchで**208分＋支援**。1反復上限180分超。無承認でchunk分割や回数名変更により回避しない |

   次はv5固定・F_ref/FROZEN、全12×2=24世界、p=3、18+6、基本**104分＋終了確認**。
   先に短縮smoke用 **37003 / calm / 最大120block** を使う案（目標5分・上限10分）。
   同seed診断は調整用途として登録し、rev7の独立した「診断検証」合格へ読み替えない。
   各世界で `ΔT=T(v5)−T(dev4/v3)` を作り、2seed平均→12レジーム等重み平均で判定する。
   相手はv3/v5を同居させず同じcand slotへ交代。F_refの相手/順番・推論OFF・scenario stream/scorer・horizon・依存設定を揃え、hashとG0を記録する。
   同seedでも非同期包含や競合応答の差はあり、単回の差を統計的な保証にしない。

   昇格条件は§4原文どおり: 平均対応ΔT≥+1.0、各レジームΔT≥−2.0、全レジーム平均T−noop≥0、24世界noop割れ0、violations/mined revert0。
   failed率≤**23/1675**、片脚bundle率≤**2/114**、R9成功bundle数≥v3の125%=**143 ID以上**（同じ分類/窓を使う）。
   failedReads/未解消片脚等rev7の安全条件も別途確認。絶対平均Tcand≥Tmultiは独立した必要条件のまま。
   対応条件成立後、同一v5 hashを変えず **37001/37002・24世界** のfresh screenを残り第3回として保守的に数える案。
   第3回にもsmokeを置くなら37004を別用途に登録する。これは次回結果と残費確認に条件付きの案で、自動予約・実走解放ではない。
   対応条件不成立ならR9を昇格せず、その失敗を報告して残り1回の用途を改めて決める。

   未使用性は見える全兄弟worktreeの `runs/**/index.tsv` と `ascon-notes/eval/out/**/index.tsv` を列名seedで走査。
   隠し/空台帳も含む**42 index、564行**、37001/37002/37003/37004は全て0件、36001/36002は各12件、36003は1件。
   [seed監査証跡](../eval/dev4-v5-seed-audit.json)。計画予約集合との交差も開始担当が照合し、実走直前に再監査する。
   公開されているMASTERのQ0/E3/Q1/G3予約値との交差はない。Hfinalの値は本文非公開のため、runner側の非交差確認は未検証・実走前必須。smoke失敗後はそのseedを未使用へ戻さない。
   1反復目標150分/上限180分、chunk110分、6h/日、forward/deep/Q0留保/2世代の最も早い上限を守る。
   全残費と監視/通知設定は未精算・未確認なので本タスクでは起動しない。
   **第3回終了時にも絶対平均T≥multi又は他screenが未達なら打切り。結果・最悪値・失敗理由・残費を本人へ報告し、4回目/seed追加/基準緩和を自動実行しない。**

5. **未検証・境界。**

   v5の動的在庫・bundle回復・包含/片脚率・P/T・対応ΔT・fresh汎化は未測定。ローカル回帰の合格から性能を主張しない。
   Docker、smoke、本診断、public60、bundle/selftest、全npm test、完全G0再監査、提出適合・受理は未検証。
   計測は開始していない。コミットなし。upstream-evalは読むだけで、鍵/.envを開いていない。
   既存node_modules symlinkは維持し、tscはnoEmit、tsxはcache無効で実行。書込みはleague-v2と一時出力だけ。
