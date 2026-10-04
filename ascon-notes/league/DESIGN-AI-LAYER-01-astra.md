# DESIGN-AI-LAYER-01 — 決定論コアと限定されたAI改訂

状態: **本人委任に基づく決定・評価契約。未実装、AI実測なし**。2026-10-04 15:00:11 JST。MASTER revision 6の詳細根拠。本人が 2026-10-04 に Astra へ判断を委任。Astra が決定。dev1は本人提示measuredの診断完了（G0 PASS・362ループ・12世界・全世界P−noop=0.0・取引なし）、現状Q0資格不可。原因は別ジョブで調査中、修理・再診断が先。

**決定署名**: 本人が 2026-10-04 に Astra へ判断を委任。Astra が決定。署名者=本人委任のAstra決定。署名日時=2026-10-04T15:00:11+09:00（今回の決定記録時刻。Masashi本人の署名・過去の委任時刻を代署したものではない）。

**確定した方針**: Q0を決定論コアで通す順番に賛成する。AIは競技の改訂構成として必要だが、利益への寄与は仮説であり、導入そのものを勝因としない。最初は約定後の原因分析から限定パラメータの改訂へ進む。AIを取引の最終判断者にせず、資金・注文・退出のゲートを改訂対象から機械的に隔離する。単純な決定論適応に勝てなければ、AIの権限を増やさない。

## 1. 確認した事実と未確認の境界

参照はleague-v2内のソース。以下の数値はコードの設定値・既存契約・明記した提案算術であり、新しい実測ではない。オンライン/コード確認はrev 5の記録を継承し、本更新で再取得・再監査していない。

| 記号 | 読んだ根拠 |
|---|---|
| G | [competition-start §3/5/10](../../docs/competition-start.md)、[LLMガイド](../../docs/guide/llm-agents.md) |
| R | [改訂policy・parser・compiler・context](../../example/agents/runtime/improve.ts)、[改訂ループ](../../example/agents/runtime/botMain.ts)、[worker](../../example/agents/runtime/strategyRunner.ts)、[状態保存](../../example/agents/runtime/state.ts) |
| L | [LLM呼出](../../example/agents/runtime/llm.ts)、[proxy CLI](../../core/src/cli/inferenceProxy.ts)、[proxy実装](../../core/src/inference/proxy.ts)、[proxyガイド](../../infra/inference-proxy/README.md)、[例示設定](../../infra/inference-proxy/models.example.yaml) |
| S | [SDK agent契約](../../sdk/src/agent.ts)、[観測](../../sdk/src/types.ts)、[epoch情報](../../sdk/src/epoch.ts)、[起動時注入](../../core/src/realtime/agentProcess.ts) |
| X | [xb-rコード](../../example/agents/xb-r/agent.ts)、[README](../../example/agents/xb-r/README.md)、[診断prompt](../../example/agents/xb-r/prompt.md)、[修理設計](DESIGN-REPAIR-01-astra.md) |
| C | [提出チェックリスト C/D/F0](../submission-checklist.md)、[競技メモ](../competition-notes.md)、[MASTER §3/6/7](MASTER-PLAN-2026-10-04.md) |

**オンライン確認**: 2026-10-04 JSTに[規約本文](https://ascon.dev/rules)を取得した。冒頭は「10/6公表・10/20発効版」と表示され、本作業日と整合しない。取得本文の§2.5は取引判断とLLM改訂を分離し、§8は価格操作・自己取引等を禁止する。**取得は確認済み、10/4適用版との一致は未確認**。将来日付の改訂を遡及適用しない。エポック間状態・シナリオ生成変更は初回G4/10/12/10/28の版照合対象。提出締切**10/31 23:59 JST**は本人指定の計画期限（オンライン本文から分単位時刻まで再確認した意味ではない）。

### 1.1 (a) エポック内の改訂経路

**[code-confirmed: G/R/L]** `prompt.md`は取引指示ではなく、LLMへの改訂方針。`kind: improve` / `name` / `description`必須。`model`・`reviseEveryBlocks`・token上限を宣言し、frontmatterのmodelが環境指定より優先される。`run(ctx)`との共存は不可。初期`agent.ts`に加え、LLMが返す`executorTs`（JS互換のdecide関数本体）をruntimeが検査・選択し、次の判断へ差し替える。モデル自身や人間が運営の提出ZIPを書き換える仕組みではない。

- 頻度は既定60ブロック。最初の観測は起点だけなので、360ブロックを欠落なく観測する標準経路は `floor((360−1)/60)=5` 機会/epoch。60epochなら**300機会**という条件付き算術（G §3、R `DEFAULT_REVISE_EVERY_BLOCKS` / `lastRevisionBlock`）。チェックリストの約360回は概算式であり、実呼出数でも課金上限でもない。旧「1run最大12改訂」はRで撤去済み。欠落・in-flight skip・epoch終了・retryで実数は異なる。
- runtimeが渡すのは現ソース、現在版、版履歴/理由、当epochの損益・保有継続の反実仮想、直近24判断、成功/revert/未包含と包含遅延・順序、market digest、最新観測、利用可能なaction語彙。永続化時はepoch履歴とmemoryも渡る（R `buildRevisionSystem/Context`）。spotの市場要因分離はあるが、perp/lending/LSTの市場損益まで完全分離しない（G）。場全体のT・他候補の反実仮想・秘密seed・未来のeventを渡す仕様ではない。
- 非同期で既存戦略が継続。呼出中の次機会はskipし、待ち行列へ積まない。標準clientは非stream・既定300,000ms。proxyのstream経路は無通信時間に上限、epoch終了で中止（L）。これは**取引判断の5,000ms**とは別。
- JSON parse → 禁止RPC静的検査 → 関数式compile（1,000ms）→ 設置。設置前の利益試験・資金不変条件の証明はない。`executorTs:null`は維持、`revertTo`はモデル指定の旧版へ。失敗は旧版継続、**悪いが正常に動く改訂の自動rollbackはない**（R/G）。
- `installedAtBlock`は呼出開始時のblockを使う実装（R `maybeRevise`）。適用遅延の測定ではこの欄だけを採用時刻とせず、応答完了・`setSource`・実際の初回決定blockを区別する。
- state領域が提供された場合、版とmemoryをepoch間で復元・再検査する。標準capは64 MiB、memoryは4,000文字（R state）。`--agent-state-root`なしのbacktestは非持越し、FROZENは改訂も状態読込も無効（G/R）。本番提供状態と一致しない独立epoch試験だけで本番適合としない。

### 1.2 (b) decide内LLM呼出とproxyの区別

**[code-confirmed: S/L/R]** proxyは存在し、内部ネットワークからOllama `/api/chat`、OpenAI互換、Anthropicの限定endpointへ中継する。モデルは運営設定のallowlist、鍵はproxy側、往復記録/replay機能がある。SDK `AgentContext`には推論メソッドがなく、生成executorには`fetch/process/import`がない。一方、手書きruntimeはHTTP clientを持つので、proxyが存在することだけから「毎block推論が許可される」と推論してはいけない。Gの競技構成は改訂だけをLLMへ任せる。**同期decide内LLMは採用しない**。

**[code-confirmed: L]** `maxCallsPerMinute`はagent単位の移動1分窓、未設定/0はproxy内制限なし、超過429。例示YAMLの30/分は本番の公表値ではない。proxyは金銭残高・token予算を管理しない。Ollama client既定contextは32,768tokens、出力capは明示時のみ。これも許可モデルの文脈長・無料枠を保証しない。公式allowlist・本番の呼出上限・本人の残高は**未確認**。例示の`gpt-oss:120b`やローカルCLI対応を本番許可の根拠にしない。

**[contract: C]** G0の360blocks/2秒/362loops・p99<1,000msはローカル計測契約。5秒timeoutはruntime上限。362はLLM呼出数でも必須改訂数でもない。非同期改訂でもcompile、worker交換、GC、CPU・API競合でG0を壊し得る。推論がブロック生成を待たせないことと、自分の判断被覆を落とさないことは別。

### 1.3 (c) その他のAI、禁止範囲、xb-rの現状

- **[confirmed: G/C]** 提出前のAIによる仕様生成・コードレビュー・既見データの分析は開発経路。ローカル`codex/claude-cli`はprocess用で本番Dockerの推論backendではない。M1等でコードをAI生成した事実だけでは、提出物の改訂構成を満たさない。
- **[confirmed: C/S]** 使えるのは当時点までの合法な観測・自分の記録。regimeラベル/秘密seed/未来スケジュールを特徴にしない。SDKのepoch ordinal/残blockは通知情報だが、レジーム推定用の非公開情報ではない。評価価格歪曲、自己取引による移転、隔離回避、凍結後の人為介入、禁止RPCは禁止。練習RPCは100req/s（eth_call/estimateGas/getLogsは5倍換算）、`anvil_* / evm_* / eth_sendTransaction / txpool_* / eth_subscribe`不可（C競技メモ）。AI経由でも例外なし。
- **[code-confirmed: X]** 現promptは常に`executorTs:null`を指示する**診断用**で、FROZEN診断用とされた。live改訂policy完成・受理可能とは言えない。Step1の凍結Q0と、受理前の最小改訂適合を分ける。永続的に全改訂を無効化して形式だけ通す提出を推奨しない。
- **[code-confirmed: X `createAgent`]** league-v2版には`lastBlock/lastSent`等のclosure状態と、`performance.now()`を使う4,000ms期限分岐がある。厳密な「obsだけの純粋関数／時間非依存」は成立しない。乱数・環境・未来情報に基づく売買は見当たらないが、正確には**観測履歴に基づく決定論コア＋期限監視**。計測中コピーとのhash一致は未確認。別ジョブの編集中コードは触らず、実行担当が同一性・clock固定再生・超過時の扱いを契約と照合する。

### 1.4 Ollama・費用・本人鍵操作

Ollama Cloudは運営指定サービスのローカル確認記録がある経路（C）。ローカルOllamaは開発用の別選択肢であり、Macにモデルを立てる必要や本番代替の許可を意味しない。本作業では立ち上げない。

[公式価格](https://ollama.com/pricing)と[Cloud説明](https://docs.ollama.com/cloud)を公開ページのみ確認した。現在の価格ページはtoken単位credits、モデル別単価、プラン別同時実行制限を説明する。**本人の旧/新プラン・無料対象・自動チャージ・上限設定の実態は未確認**。チェックリストの10/3画面記録を現在のアカウント状態へ読み替えず、価格表の全モデルをASCON許可一覧ともみなさない。

- **dec-008（10/7）**: 本人が指定service/許可model/登録IDの一致、利用枠・金銭上限・自動チャージ・残高（すべて本人確認待ち、Offは推奨）と、少数の改訂で疎通/usageを確認し、専用フォームへ鍵を登録。チェックリストの「初ZIPと同時」と期日がずれる場合、登録を先に確認し、初ZIP時にも対応関係を照合する。鍵登録を受理と呼ばない。
- **dec-007（10/28）**: 最終G4後に同じ項目を再確認。初回確認の代用不可。モデル名が同じでも提供版・料金・枠が変われば再校正対象。
- **AIは鍵に触れない**。Keychain・環境・`.env`・クリップボード・認証画面を読まず、本人が返す秘密なしの「登録確認/モデルID/上限/usage集計」のみ使用する。本設計は鍵の自動読込も許可しない。
- Air時間とAPI費用は別台帳。`C_API = Σ(input_uncached × rate_in + input_cached × rate_cache + output × rate_out) / 10^6`（単価が100万tokens建ての場合）。失敗・timeout・retryの課金も含む。API金銭上限の決定権は委任されておらず、本人の承認待ち。自動チャージ/残高/鍵登録も本人確認待ち。料金・tokens・実呼出数・残高が揃うまでは費用を確定しない。300機会で無料枠に収まるという断定もしない。

## A. 付加価値の仮説と反証

「決定論で代替できない」と証明できた候補は**現時点でない**。LLMも固定入力では関数であり、問うべきは同じ証拠・費用下で単純な代替を上回るか。以下は候補の選別表。

| 候補・順序 | 効果の仮説 | 反証条件 | 決定論代替との違い・代替可能性 |
|---|---|---|---|
| 約定後の分析→限定改訂（第一候補） | 未包含、片脚成功、保有価格変動、利益モデル誤差を文脈で分離し、誤った修理を減らす | 同じevidenceの固定分類＋閾値調整よりout-of-sampleのP−noop/尾部が改善しない、原因説明がreceiptと不一致 | 未知の複合原因への仮説生成に期待。資金会計・receipt照合自体は決定論で行える |
| 状況推定→因子/方針の選択 | 継続的な約定競争・depegの観測から許可policyを選び、機会損失を減らす | 状況分類の正解率だけ上がり終値利益が増えない、遅れて切替、単純switcherに劣る | 非定常な複合状況が仮説。既知12regimeの名前当ては不要、EWMA・有限状態機械・固定routerで十分ならAIを縮小 |
| パラメータ適応 | net edge/約定率に応じENTRY・single entryを限定候補から更新 | clip/拒否ばかり、全更新が同値、決定論grid/online estimatorに対して増分なし | 更新理由の総合に期待。少数離散パラメータなら決定論が有力対照。R1–R5すべてを一度に動かさない |
| 異常の持続判断 | ハード停止未満の違和感から新規entryを一時的に抑え損失を避ける | 誤停止で利益を失う、観測異常の固定判定で同じ尾部保護が得られる | AIは将来改訂としてrisk-off提案のみ。即時停止は決定論の方が速く検査可能 |
| 片脚失敗・例外の事後分類 | 遅延/部分約定パターンから次intervalのpolicyを改善 | 既知状態機械と同じ、誤帰属で再発を増やす | **即時の在庫隔離・残高/receipt照合・再送判定はAI不要**。未知原因の分析だけが候補 |
| epoch間の学習（後段） | 損益の市場要因を除いた知識を持越し、後半の質を上げる | 後半の改訂ドリフト、stateなしON以下、特定の順序だけで有利 | 固定統計量の持越しで足りる可能性。適用規約/本番state構成/順序評価の成立前は追加機能にしない |

AIに渡さない最終権限: canFundと累積予約、独立した各leg資金、token decimals、許可action/venue、gas予備・bid・slippage、在庫帯・注文量上限、期限/退出、未解消在庫の隔離、nonce/署名/submit。AIは損失許容額・Q0閾値・seed・採点・予算・鍵・送金先を変更しない。収益を保証する不変条件は作れないので、価格変動・非原子性の残余損失は別途評価する。

## B. 設計比較と実現条件

| 案 | 改訂する範囲 | 壊れ方と封じ方 | 推奨 |
|---|---|---|---|
| 限定提案＋固定コア | ENTRY_BPSだけを提案し、検証器が固定テンプレートの戦略コードへ反映 | timeout/429/parse失敗は現版継続。範囲外・NaN・古い観測・guard改変は拒否。経済的に悪い範囲内提案は封じ切れない | 第一候補。G3と決定論適応対照が必要 |
| AI中心のコード全面改訂 | stock runtime通りdecide全体 | compile済みでもゲート削除・過剰在庫・停止・誤った原子性を生み得る。promptだけでは封じられない | 今回の期限では非推奨。固定境界と優位の証拠が揃う場合のみ再検討 |
| 各blockでAIが注文 | 同期LLM応答からaction | timeout以前にblock欠落、古い観測、費用増。proxy存在は競技許可ではない | Gの競技構成に合わず採用しない |

**実装上の落とし穴**: 現stock runtimeは生成bodyに`ctx.submit/publicClient`を渡す。action schemaや改訂版rawTx制限はあるが、xb-rの資金/在庫ゲートを残す保証はない。`Object.freeze(PARAMS)`も関数全置換には無効。さらに初期ソースはmodule全文、改訂はimportできないbodyであり、xb-rのclosure/helperをそのまま利用できると仮定しない（R `shippedSource` / `compileExecutor`、X）。

**決定・未実装**: 隔離した提出版で改訂の受付点を用意し、(i) JSON形式の小さい提案へ制約、又は(ii) `executorTs`を固定bodyテンプレート＋許可literalだけとして構造検査する。受け取った任意コードを先に実行してから検査しない。schema/有限数/許可集合/最大変化量/観測有効期限/変更不能領域hashを確認し、固定コードとして再構成。guardは提案実行の外に置き、returnとsubmitの両経路を通す。resume/revertも同じ検証器を通す。改訂時のcooldown/未解消在庫stateをリセットして安全境界を失わない。

<!-- ai-parameters:start -->
| 許可パラメータ | 初期値 | 許可範囲 | 刻み | 1回の最大変更幅 | 更新間隔 |
|---|---|---|---|---|---|
| ENTRY_BPS（新規entryの入口だけ） | 60 bps | 20–60 bps | 5 bps | ±5 bps | 60 block以上 |
<!-- ai-parameters:end -->

**根拠と境界**: 初版はこの1項目のみ。既存E1の60→20bps（MASTER §5.1、修理設計H1/V1）を検証済み利益と誤認せず、探索範囲の根拠にする。60bpsを保守的な初期値とし、5bps刻み・最大5bpsは一度で全幅40bpsを飛ばさないための政策値。最適値・安全保証ではない。入口値をnet利益式・サイズ・bid予算の控除へ流用しない。Sをこの初期値で資格化し、別の値で受理済みなら無断変更せず別版として再資格する。

受付時に整数・範囲・刻み・直前適用値との差・観測鮮度を検査し、同一intervalで複数適用しない。提案の有効期限は観測から60block、適用後120blockで更新がなければ基準60bpsへ決定論で復帰する（この安全復帰はAIの±5bps変更権限とは別）。epoch開始時は60bps・学習memoryなし。epoch内の未解消在庫・予約・cooldown・receipt照合状態は改訂/復帰で保持する。古い記憶や前epochの改訂コードを次epochへ復元しない。

canFund・各leg/累積資金予約・在庫/サイズ上限・MIN_PROFIT・bid・slippage・single entry・退出・送信先・因子switchはAI変更不可。固定テンプレート＋許可literalのみを構造検査し、return/submit双方を外側ゲートへ通す。任意executorTs/因子switchは不採用。標準提出形式で隔離できなければ導入停止。これは設計の決定であり実装済みとはしない。

標準SDKにこの受付hookがあるとは確認できない。runtime変更が必要なら**別のrelease用コピーの明示的な小差分**とし、upstream由来共有ファイルを直接改変せず、bundler/scan/selftestでそのruntimeが実際に使われるか確認する。現提出形式が当該差分を受け入れるかはG4前の未確認事項。prompt制約だけで済ませる場合は「機械的隔離済み」と表示できない。受理前の最小policyにもこの未解決点がある。

反証・停止: guardを迂回できる改訂、submit抜け道、state破壊、費用超過を検出したら導入停止。timeout時の旧版継続は既に悪化した版への復旧ではないため、許可paramの期限失効で検査済み基準値へ戻す決定論ルールと、そのrisk-off/復帰条件を事前登録する。これはstockの機能ではなく、上記120block失効/基準値復帰として実装・検証する契約である。

## C. AI-G3-01 — 本人委任による確定契約

**既存G0/Q0/G3閾値を緩めない。凍結性能は改訂ON性能の代用にならない。** 本人が 2026-10-04 に Astra へ判断を委任。Astra が決定。権限・mode・反復・state・Air振替の決定と、未実装/未計測/未確保費用を分離する。

1. **Sと実行条件**: 決定論Q0→最小改訂適合/G3/G4→受理S。core/prompt/受付/許可literal/modelと提供版/推論設定/間隔/roster/slot/scorer/stream/epoch reset/hashを固定。model/API同時実行枠は本人の秘密なし確認結果を用いる。最小calはcalm/crash/depeg×50001–50003×2場×ON/OFF=36世界。正常cycle≥3、実変更適用/復帰、全改訂検査100%、遅延/無効出力/枠切れで危険取引0。
2. **S full G3**: F_mix・12×51001–51003、ON36/OFF36=72世界、既存の平均ON−OFF≥−1T・最悪regime≥−3T・全G0/安全。基本5.2h。現在有効証跡は未確認のため予約する。同一hash/model/state/場/全条件の既有証拠が確認できた時だけ再走を省き、消費済み費用と重複予約を精算する。SのG3性能はR*凍結まで開発者に渡さない。既有性能をR*調整へ使っていた場合は独立性を失うため、結果前に新G3集合全体・費用を再登録する。
3. **D対照**: 開発時に同じ観測とENTRY_BPS範囲を用いる決定論適応Dを固定し、A=AIと新35001/35002全12×A/D=48世界で比較（基本52/15h＋支援、未予約）。Dは過去の自己約定net markoutの符号を分類し、直近intervalの有効標本5件以上で平均≤0なら+5bps、>0なら−5bps、標本不足は維持、20–60にclipする初版。markout幅は約定後12block、gas/回収費を同じ定義で含め、epoch終端の未確定標本を使わない。Aにも同じ有効観測を渡す。分類/markout復元が実装できなければ開始しない。結果前にhash固定、平均対応ΔT>0・平均Δ(P−noop)>0・最悪regimeΔT≥−2と全安全を継続screenにする。小標本screenは優位の証明ではない。
4. **固定R*のE3/Q1**: 1案選抜後のAI専用E3はF_mix・S/R*ともON・新33001–33003全12×2=72世界。平均ΔT≥+1、最悪regime≥−2、平均Δ(P−noop)≥0、全安全。Q1はF_ref・候補ON・42001–42005全12=60世界、現行Q0の平均T/対noop/安全条件。Q0はFROZENのまま。開発集合は流用しない。core変更なら別のFROZEN資格費も要る。同seed修理/次点救済なし。
5. **R*反復**: 同じG3の12×3市場セル=36を維持。OFF1履歴36世界＋ON3独立応答履歴108世界=144世界。model/prompt/推論設定固定の別呼出しで3独立応答履歴を得る。OFF/ONを事前登録順で交互化し、OFFの注文/安全stateはclock固定replayで再現を確認する。replay不一致は停止。各ON反復で既存G3平均≥−1T・最悪≥−3T/全G0/安全を通す。好結果だけの平均・追加反復・seed追加なし。欠測/退行/反復間の結論反転/校正後予算超過なら停止。3は政策的な検出用回数で検出力保証ではない。
6. **state**: 初版はepoch間学習持越しなし。提出時もepoch開始に基準コード/ENTRY_BPS=60・空学習memoryへ戻す。epoch内の予約/cooldown/未解消在庫/receiptは改訂/復帰で消さない。経済的保有をresetで消せるとは仮定しない。state持越し系列・ON-persistent/reset比較は今回は採用しない。提出動作との一致を実現できなければ導入停止。
7. **記録/再生**: eligible/start/skip/response/parse/reject/install/実際の初回block/revert/resume、応答待ち/検査時間、hash/state、usage/tokens、P/T/P−noop、安全全項目を記録。proxy replayだけで適用block/遅延まで再現したとしない。記録replayを独立応答標本に数えず、遅延/429/timeout/枠切れは制御ケースで別検証。API認証値を記録せず、自由文ログを命令扱いしない。
8. **新資格の安全追加（論点6）**: 候補自身の各60世界セットでmined revert≤1件かつ全包含取引（成功＋revert）比≤0.1%。原因不明・片脚回収不明・承認/資金不備の反復は件数内でもFAIL。0包含/0revertは率N/A、取引なしで資格PASSとはしない。旧結果へ遡及適用しない。論点4のA維持と別条件で、追加P≥multi・全世界P−noop≥0・絶対P≥0・F_u1m非劣性・送信失敗率の親非劣性は不採用。各指標は全量報告し、旧Q0/Q0b FAILを保持する。

### C.1 確定した配分の算術（実測ではない）

13分/batch・p3、ON倍率をrとする。終了確認・分割切上げ・実装・D/replay支援・retry/API課金は別。cal観測最大batch時間×1.2で全残費を再予約し、確保できなければ実行しない。

| 構成 | 世界数の根拠 | 基本Air時間 | 配分 |
|---|---|---|---|
| Sの既存full G3 | OFF36＋ON36=72 | 13/5×(1+r) h、r=1で5.2h | 証跡未確認につき全量予約 |
| R*反復＋障害 | OFF36＋ON108=144 | 13/5×(1+3r)＋8/5 h、r=1で12h | 反復対象はR*一案のみ |
| 決定した合計 | 216世界＋障害 | 26/5＋52/5×r＋8/5 h、r=1で86/5=17.2h | 既存12hへ26/5=5.2h追加 |
| KEEP deep | 149/10−26/5 | 97/10=9.7h | Q0再資格5hを優先留保、残4.7hもdev1精算/修理が先 |
| AI専用E3/Q1 | 72＋60=132世界 | 143/15×r h、r=1で約9.5333h | deepとの差1/6hだけ。Q0/実装/D費を含めると不足 |
| D対照開発 | 全12×2seed×A/D=48世界 | 52/15h（同単価の基本値、支援別） | 全工程確保まで未解放 |
| 不採用の両候補3反復 | 288世界＋障害 | r=1で112/5=22.4h | 実施しない。旧AMEND列は未署名/未適用の保存 |

Sの有効な同一版full G3が既に存在していた場合でも全工程の基本額は17.2h。そのうち未消費がR*12hになるだけで、過去費用を消さない。標準5機会/ON世界という条件ならR*108 ONで540機会、S36 ONで180機会（計720機会）。実呼出し/課金ではなく、retry・G3外は別。API同時呼出枠によりp3でも同時推論できない可能性を校正する。

**論点3**: Q0/受理/最終確認を先に守り、研究は限定AIを因子/M2より優先。M2=0h。AI全工程は現在の見積だけでは未解放。10/17 18:00 JSTに、受理S・Dへの増分・固定R*のE3/Q1/G3・校正後の全残費/日程が揃う時だけH480。不足ならAI終了、適合受理Sと全費用があればS240、それもなければH未実施。深いリーグへ替えるのは既資格候補と全残費がある場合だけで、当日新探索は始めない。100h追加、最終二場/10seedの削減、未比較AI採用はしない。

H480を3反復へ拡大すれば1,440世界・基本104hでforward100hを超えるため、Hは現行10seed・各世界1履歴を維持する。G3三反復をH全域の応答頑健性の証明とはしない。

**決定署名**: 本人が 2026-10-04 に Astra へ判断を委任。Astra が決定。署名者=本人委任のAstra決定。署名日時=2026-10-04T15:00:11+09:00（今回の決定記録時刻。Masashi本人の署名・過去の委任時刻を代署したものではない）。

**署名の対象と未成立条件**: ENTRY_BPS権限、R* ON3/OFF1＋S full、AI専用E3/Q1 ON、epoch reset、D対照仕様/基本費、Air振替、10/17停止分岐は決定済み。実行hash/model提供版/未使用seed監査/費用実測の値は未確定（技術証跡待ち、本人判断の再承認待ちではない）。API金銭上限・自動チャージ・残高・Ollama鍵登録は**本人の承認/確認待ち**で本署名の対象外。署名者や日時をMasashi本人と偽装しない。

## D. 段階ロードマップ（JST）

Step1はxb-r修理・再診断→新Q0-A-REQUAL-01（1候補1回・5h条件付き枠）→最小改訂適合/G3/G4→受理S。Step2はENTRY_BPSのみの機械的受付/epoch reset。Step3はDへの増分→固定R* E3/Q1/G3、Step4は10/17条件分岐後に10/18〜25封印campaign、Step5は10/26〜31の最終適合/受理。日ごとの入口/出口/費用はMASTER §9の5段階表を正本とする。

6論点の判断は確定し、AI実装・性能・資格・受理を証明した意味ではない。本人操作はdec-008（10/7）とdec-007（10/28）の鍵/金銭上限/自動チャージ/残高、従来の本人送信・受理確認に残す。既決のQ0維持・Q0最優先・10/8延期・forward100h・独自戦略のみは変更しない。修理設計DR-Q-01は変更せず、追加条件の採否はMASTER §4.1を現行契約とする。
