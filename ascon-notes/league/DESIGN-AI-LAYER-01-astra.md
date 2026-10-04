# DESIGN-AI-LAYER-01 — 決定論コアと限定されたAI改訂

状態: **設計・評価契約案。未署名、未実装、AI実測なし**。2026-10-04 14:25:52 JST（`TZ=Asia/Tokyo date`）。MASTER revision 5の詳細根拠。今回の本人依頼を方針の出典とし、10/8受理目標の延期は既決として扱う。dev1-xb-r走行中は本人申告であり、計測worktree・原ログを確認していない。

**Astraの見解**: Q0を決定論コアで通す順番に賛成する。AIは競技の改訂構成として必要だが、利益への寄与は仮説であり、導入そのものを勝因としない。最初は約定後の原因分析から限定パラメータの改訂へ進む。AIを取引の最終判断者にせず、資金・注文・退出のゲートを改訂対象から機械的に隔離する。単純な決定論適応に勝てなければ、AIの権限を増やさない。

## 1. 確認した事実と未確認の境界

参照はleague-v2内のソース。以下の数値はコードの設定値・既存契約・明記した提案算術であり、新しい実測ではない。

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
- **[code-confirmed: X]** 現promptは常に`executorTs:null`を指示する**診断用**で、本人申告のFROZEN計測に適する。live改訂policy完成・受理可能とは言えない。Step1の凍結Q0と、受理前の最小改訂適合を分ける。永続的に全改訂を無効化して形式だけ通す提出を推奨しない。
- **[code-confirmed: X `createAgent`]** league-v2版には`lastBlock/lastSent`等のclosure状態と、`performance.now()`を使う4,000ms期限分岐がある。厳密な「obsだけの純粋関数／時間非依存」は成立しない。乱数・環境・未来情報に基づく売買は見当たらないが、正確には**観測履歴に基づく決定論コア＋期限監視**。計測中コピーとのhash一致は未確認。今の測定は変えず、完了後に実行担当が同一性・clock固定再生・超過時の扱いを契約と照合する。

### 1.4 Ollama・費用・本人鍵操作

Ollama Cloudは運営指定サービスのローカル確認記録がある経路（C）。ローカルOllamaは開発用の別選択肢であり、Macにモデルを立てる必要や本番代替の許可を意味しない。本作業では立ち上げない。

[公式価格](https://ollama.com/pricing)と[Cloud説明](https://docs.ollama.com/cloud)を公開ページのみ確認した。現在の価格ページはtoken単位credits、モデル別単価、プラン別同時実行制限を説明する。**本人の旧/新プラン・無料対象・自動チャージ・上限設定の実態は未確認**。チェックリストの10/3画面記録を現在のアカウント状態へ読み替えず、価格表の全モデルをASCON許可一覧ともみなさない。

- **dec-008（10/7）**: 本人が指定service/許可model/登録IDの一致、利用枠・金銭上限・自動チャージOff、少数の改訂で疎通/usageを確認し、専用フォームへ鍵を登録。チェックリストの「初ZIPと同時」と期日がずれる場合、登録を先に確認し、初ZIP時にも対応関係を照合する。鍵登録を受理と呼ばない。
- **dec-007（10/28）**: 最終G4後に同じ項目を再確認。初回確認の代用不可。モデル名が同じでも提供版・料金・枠が変われば再校正対象。
- **AIは鍵に触れない**。Keychain・環境・`.env`・クリップボード・認証画面を読まず、本人が返す秘密なしの「登録確認/モデルID/上限/usage集計」のみ使用する。本設計は鍵の自動読込も許可しない。
- Air時間とAPI費用は別台帳。`C_API = Σ(input_uncached × rate_in + input_cached × rate_cache + output × rate_out) / 10^6`（単価が100万tokens建ての場合）。失敗・timeout・retryの課金も含む。料金・tokens・実呼出数・残高が揃うまでは金額を記入しない。300機会で無料枠に収まるという断定もしない。

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
| 限定提案＋固定コア | 許可されたpolicy ID/小さいparam集合を提案し、検証器が固定テンプレートの戦略コードへ反映 | timeout/429/parse失敗は現版継続。範囲外・NaN・古い観測・guard改変は拒否。経済的に悪い範囲内提案は封じ切れない | 第一候補。G3と決定論適応対照が必要 |
| AI中心のコード全面改訂 | stock runtime通りdecide全体 | compile済みでもゲート削除・過剰在庫・停止・誤った原子性を生み得る。promptだけでは封じられない | 今回の期限では非推奨。固定境界と優位の証拠が揃う場合のみ再検討 |
| 各blockでAIが注文 | 同期LLM応答からaction | timeout以前にblock欠落、古い観測、費用増。proxy存在は競技許可ではない | Gの競技構成に合わず採用しない |

**実装上の落とし穴**: 現stock runtimeは生成bodyに`ctx.submit/publicClient`を渡す。action schemaや改訂版rawTx制限はあるが、xb-rの資金/在庫ゲートを残す保証はない。`Object.freeze(PARAMS)`も関数全置換には無効。さらに初期ソースはmodule全文、改訂はimportできないbodyであり、xb-rのclosure/helperをそのまま利用できると仮定しない（R `shippedSource` / `compileExecutor`、X）。

**提案・未実装**: 隔離した提出版で改訂の受付点を用意し、(i) JSON形式の小さい提案へ制約、又は(ii) `executorTs`を固定bodyテンプレート＋許可literalだけとして構造検査する。受け取った任意コードを先に実行してから検査しない。schema/有限数/許可集合/最大変化量/観測有効期限/変更不能領域hashを確認し、固定コードとして再構成。guardは提案実行の外に置き、returnとsubmitの両経路を通す。resume/revertも同じ検証器を通す。改訂時のcooldown/未解消在庫stateをリセットして安全境界を失わない。

標準SDKにこの受付hookがあるとは確認できない。runtime変更が必要なら**別のrelease用コピーの明示的な小差分**とし、upstream由来共有ファイルを直接改変せず、bundler/scan/selftestでそのruntimeが実際に使われるか確認する。現提出形式が当該差分を受け入れるかはG4前の未確認事項。prompt制約だけで済ませる場合は「機械的隔離済み」と表示できない。受理前の最小policyにもこの未解決点がある。

反証・停止: guardを迂回できる改訂、submit抜け道、state破壊、費用超過を検出したら導入停止。timeout時の旧版継続は既に悪化した版への復旧ではないため、許可paramの期限失効で検査済み基準値へ戻す決定論ルールと、そのrisk-off/復帰条件を事前登録する。これはstockの自動rollback機能ではなく提案である。

## C. AI-G3-01 — 未署名の評価契約案

**既存G0/Q0/G3閾値を緩めない。凍結性能は改訂ON性能の代用にならない。** 無応答・文書更新は署名ではなく、今回の計測起動もない。

1. **固定対象**: core/prompt/改訂受付コード/許可param/model名と提供版/推論設定/間隔/roster/財布slot/scorer/stream/初期stateをhashで固定。Q0結果を見てpromptを変えたら、変更後の版にQ0のON認定はない。提出予定modeで測り、FROZENをZIPの通常動作にしない。
2. **対照**: F=同一提出版のFROZEN、A=改訂ON。別世界で同slot・同市場seed・同相手OFF。開発段階でD=同じ許可paramを同じevidenceから更新する単純な決定論適応とも比較する。Dの追加世界数/費用は未予約、E1/M2の置換として事前登録し、A対FだけでAI必須と結論しない。
3. **最小G3/cal（既存）**: calm/crash/depeg×50001–50003×2場×ON/OFF=36世界（MASTER §7.3）。正常cycle≥3、制御ケースで実変更適用/復帰、全改訂検査100%、遅延/無効出力/枠切れで危険取引0。stock経路から実際に適用されることと、拒否し続けるだけの完走を区別する。制御ケースは適合証拠で、性能標本へ混ぜない。
4. **追加反復案**: G3の12regime×51001–51003=36市場セルを維持。各候補につき**ONを3独立応答履歴、OFFを1回**、計144世界を提案する。3は最低限の揺らぎ検出用の政策値で、十分な検出力の計算結果ではない。OFFもG0の時間揺らぎから独立した決定論を保証しない。応答不安定なら都合のよい追加反復をせず、未結論/見送り。反復数・seed集合の変更は開封前の別契約のみ。
5. **判定案**: 各反復ごとに既存full G3（F_mix平均ON−OFF≥−1T・最悪regime≥−3T、安全/G0全件成立）を要求し、反復を平均して危険事例を隠さない。G3は非劣化/運用gateでありalphaの証明ではない。AI性能を採用するには固定R*として下記のE3/Q1のmode契約とMASTER §6のS対R*二場基準を満たす。符号反転/欠測/閾値境界/費用超過ならS維持。Sもlive改訂適合が必要。

   **AI専用E3/Q1のmode案（未署名）**: 改訂policyだけが異なる候補はFROZENで同じ戦略になり、既存E3の改善条件を評価できない。Q0はFROZENを維持し、AI候補のE3はS/R*ともON（相手OFF）、F_mixの新12×3×2=72世界、既存G1閾値を維持する案。続くQ1はF_ref・候補ON・新12×5=60世界で、既存平均T/対noop/安全条件を維持する。候補選抜後にmodel/promptを固定し、E3/G3/Q1/H間で新しい市場集合・応答履歴を使う。開発で見たseedは移転しない。署名前は従来E3/Q1がFROZENのままで、AI-only候補の採用経路は未成立。core自体を変えた候補は凍結再資格も別途必要で、この案で免除しない。
6. **seedの意味**: 市場seedは価格/eventの再現を揃える。LLM出力seedとは別で、Lの標準requestには市場seedをLLM seedへ設定する処理がない。temperatureを下げても決定性の証明ではない。独立応答履歴で分散を観測し、記録replayで因果追跡する。同じ応答のreplayを追加の独立試行と数えない。
7. **状態持越し**: releaseにstate持越しがある場合、ON独立epochだけでは認定不可。各市場seedの12regimeを事前固定順序の連続系列として扱い、各LLM反復は空のstateから別系列を開始する。並列化は系列間だけ。同じ系列内のepochを同時実行しない。FROZEN/ON-reset/ON-persistentの差を明示し、reset対照の追加費は別予約。最終Hも独立10系列を統計単位とし、場/候補ごとにstateを分離する。12epochで本番全60epochの学習を証明したとは言わない。
8. **記録**: eligible/start/skip/response/parse/reject/install/実際に初めて動いたblock/revert/resumeを別カウント。時刻・応答待ち/検査時間・version/hash・state hash・入出力tokens・usage・エラー種別・全P/T/P−noop・全安全指標。input切詰め警告は見逃さず不成立扱い。自由文のchain記録は非信頼データ、命令として扱わない。呼出記録へ認証値を混ぜない。
9. **replayの限界**: Lのproxy replayは応答を順に返すがdurationの待機やrequest一致まで再現する保証はない（`replay.next`直後にsend）。市場/応答同一だけで実時刻の適用blockまで決定論とは認定しない。採用blockを固定するreplay fixtureを将来追加し、liveの遅延評価は別に残す。timeoutの遅延・同時負荷・API queueは実proxy校正で確認する。

### C.1 費用（提案算術、実測ではない）

単価13分/batch・p3はMASTER §7の既存仮置き。`r`はON実測倍率。分割切上げ・非run占有・retry・API料金は別。

| 構成 | 世界数の根拠 | 基本Air時間 | 現予約との関係 |
|---|---|---|---|
| 既存full G3・1候補 | 36 OFF＋36 ON | 13/5×(1+r) h | 2候補＋障害枠8/5hで既存12h（r=1） |
| 提案反復・1候補 | 36 OFF＋36×3 ON=144 | 13/5×(1+3r) h | r=1で52/5=10.4h。障害8/5を加え12h、既存枠内だが2候補分ではない |
| 提案反復・2候補 | 2×144=288 | 26/5×(1+3r)＋8/5 h | r=1で112/5=22.4h。既存12hに対し52/5=10.4h追加 |
| 追加をdeepから振替した場合 | KEEP 149/10−52/5 | 残9/2=4.5h | AI実装・新資格費もここから必要。既存180世界13h＋支援1.9hは併存不可 |
| 同じ振替のAMEND列 | 152/15−52/5 | −4/15hで不足 | この列では反復案を解放できない |

ON1worldの標準5機会を仮定すれば、1候補の3反復108 ON世界は540機会（108×5）、2候補は1,080機会。G3以外・retry・変更したcadenceの呼出は別。実際の課金はusage集計で置換する。**API concurrencyによりp3でも同時推論できない可能性**があるため、各batchを13分と確約しない。

AI専用E3/Q1案は72＋60=132世界、基本`26/5＋13/3=143/15h`（約9.5333h、MASTERの既存棚の算式）。全候補ONなので倍率rを掛けて再予約する。**2候補G3振替後の4.5hでは、この下流だけでも足りない**。実測余剰等が証明されなければ、100h内でAI挑戦者を最終採用する全工程は解放できない。SだけのH240へ縮小すると比較自体を行わないため、その節約を根拠に未比較のAI版へ差し替えることも不可。最小改訂適合を備えたSを守り、AI研究を次回へ残す停止案を含める。

H480を3反復へ機械的に拡大すると1,440世界、基本104h（480×3÷3×13/60）でforward100h全体を超える。したがって**最終Hは現行の10seed・各世界1応答履歴**を維持し、G3での反復を「H全域の応答頑健性」の証明にしない。持越しを使う場合の系列統計・実行単位の改訂は封印前に署名する。足りなければHはSのみ240又は未実施、比較優位の主張を取り下げる。

**署名欄（未署名）**: Masashi: ______ / JST: ______。対象hash/model/許可範囲 ______、G3反復1候補又は2候補 ______、AI専用E3/Q1のON mode ______、state/reset/順序 ______、D対照の置換元 ______、Air振替・API上限・追加資格費 ______、統計/停止/封印時刻 ______。空欄を埋めるまでは既存配分・既存資格判定を変更しない。

## D. 段階ロードマップ（JST）

| Step / 時期 | 入口 | 出口 | 100h・API費用 / 停止 / 本人判断 |
|---|---|---|---|
| Step1 決定論Q0→最小改訂適合→受理 / 10/4以降、受理日は未定 | dev1-xb-r終了の担当証跡、現Q0契約、候補hash/入力/G0、未使用seed/費用の確認 | 凍結Q0 PASS→mix/P60→実改訂可能な最小policy・機械的境界・最小G3/G4→dec-008→本人送信→受理S | first-next既存35/3hは追加修理/資格費を含まない。未予約費をdeep等から契約化。dev1を本書から止めず再走も開始しない。Q0失敗はAIで上書きせず停止。10/8延期は再承認不要 |
| Step2 AI提案層の最小版 / S受理後〜10/12目安 | S・cal・guard実現性・許可model・費用 | 第一候補は事後分析から小さいparam改訂。制御ケースで適用/拒否/復帰・state保持を確認。AI-G3-01署名 | AI実装は未見積。既存deepの因子/M2と置換し、足し増さない。guard迂回/適合不可なら中止。本人: 権限と金銭上限 |
| Step3 付加価値・非決定性検証 / 10/13〜17 | 凍結版・未使用集合・G3反復費・下流資格費 | D対照・E3/Q1・G3 ON/OFF反復、必要ならstate系列を通ったR*のみ | 基本反復1候補12h又は2候補22.4hは上表。ON倍率で再予算。S受理遅延/優位不明なら省略。本人: 10/17に深いリーグを削るかSのみを選ぶ |
| Step4 封印と一回採用 / 10/18〜25 | 両場・10seed・版/model/state/判定コードを封印、残費確保 | H480又は事前指定S240を完了、一回判定。10/25性能凍結 | final-g2既存35hはON校正前。追加反復なし。欠測/不適合/小差は適合S。Sが不適合なら本人判断 |
| Step5 適合・受理 / 10/26〜31 23:59 | 選定版・G4証跡 | 最終P60/配置→10/28 dec-007→10/29本人送信/受理目標→10/30予備→10/31照合 | final-g4既存9h＋共通予備3h。未知費は先に振替。新しい性能改訂を開発側で加えない。受理メールとhashで閉じる |

**新しい本人判断**はAI権限・受付方式、AI-G3-01の反復/対照/state/予算、10/17のAIと深い探索の優先配分。推奨は限定改訂を深いリーグより先に検証し、利益を再現できなければ適合Sを維持すること。反証は単純適応に対する増分なし・guard境界不成立・ON遅延/費用で受理を脅かすこと。既決のQ0優先・10/8延期・forward100h・dec-008/007は再判断へ戻さない。
