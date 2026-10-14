# G3の不足項目の分類（変えられない外部環境を前提に） — 2026-10-14

## 要約（8行以内）

1. G3（Gate 3、自己改訂を実チェーンで受け入れるための内部判定）は**必須（REQUIRED）のまま、証拠不足で停止（BLOCKED）**。開始前検査 `prestart-check.py` は本日 Air のこの作業ツリーで **FAIL**（`seedAudit` と `completeness` が不合格）。B07 は閉じていない。
2. 表は全60行。内訳を別の行に分けた親行5行（B04・B07・B08・B09・B10）を除く55行を件数に数えた。A（外部環境を変えられない前提で構造的に測れない）は **2件**（B03〔本人受容済み〕と B09e）。A?（未検証の前提に依存。本人確認まで B/C 扱い）は **2件**（R4f・B09c）。B（実走なしで今すぐ技術的に進められる）は **17件**。C（技術的に可能だが、Docker・Anvil・モデルを使う実走が必要）は **34件**。
3. A の判定には、標準実行基盤（stock runtime）に該当する取得口が無いことと、提出物でその実行基盤を変えられないことの両方について、file:line の根拠を付けた。「方法が見つからない」だけの項目は A にしていない。
4. A を受け入れても G3 が PASS になることはない。ツールは A を列挙し続けるため、ツールを変えない限り `completeness` は通らない（B03 と同じ扱い）。
5. 今週の技術的な次の5手：①B07 の実行元 commit 固定と隔離領域の準備、②seed 監査の不合格471件の仕分け、③監査器側のオフライン改修（元版復帰の再生、HTTP 経路の呼出識別、通信記録器）、④worker（戦略を動かす別スレッド）側計測の試作、⑤mini での最小実走診断の範囲案（実施は本人の承認後）。
6. 合格・免除の判断はしていない。残り開発時間は不明（UNKNOWN）のため数字を書かない。

## 0. 前提・用語・引用の書き方

- **本人方針（2026-10-14、依頼者が言い直したもの）**：外部環境（標準実行基盤＝stock runtime、主催者の設定・起動経路）は変えられない。その前提で構造的に測れない項目は「測定不能」として受け入れ、B03 と同じ扱いにする（本人受容済みの未解決項目であり、PASS ではない。ツールは変えない）。技術や回避策で測れる・解けるもの（Mac mini での実行を含む。mini は外部環境ではない）は、エージェントが進める。**本書は分類だけを行い、合格・免除は決めない。**
- 区分の定義：
  - **A**：外部環境を変えられない前提で、構造的に測れないもの。積極的な根拠を要求する（標準実行基盤に取得口が無いこと＋提出物の同梱基盤はバイト一致が必須で改変できないこと、を file:line で示す）。
  - **A?**：未検証の前提（例：主催者が同梱基盤を差し替えるかどうか）に分類が依存するもの。前提を明記し、本人が確認するまでは B/C として扱う。
  - **B**：実走なしで今すぐ技術的に進められるもの（オフライン作業、mini 上での読取検査、文書・監査器の改修、本人の確認作業を含む）。
  - **C**：技術的には可能だが、実走（Docker・Anvil（ローカル検証用チェーン）・モデル呼出のいずれか）が要るもの。実行場所は mini または Air。
- 迷った項目は A にしていない。
- 引用の短縮：`R/`＝`example/agents/runtime/`、`L/`＝`ascon-notes/league/`、`G/`＝`ascon-notes/league/g3/`、`C/`＝`ascon-notes/league/g3/chain/`。その他はリポジトリルートからの相対パス。行番号は、この作業ツリー（base `origin/main` `0a102f1a540a6dfc98f7b9aefc651cd12a28d21c`）で確認した。
- その他の略語：SHA-256＝内容ハッシュ。RPC（Remote Procedure Call）＝チェーンへの遠隔呼出。CLI（Command Line Interface）＝コマンド実行形式。HTTP（Hypertext Transfer Protocol）＝通信方式。PID（Process Identifier）＝プロセス番号。frame＝1回の判断の入力・出力・時刻をまとめた監査記録。receipt＝採掘後の取引結果。loader＝起動時に追加で読み込む計測コード。v0＝改訂前の元の戦略。noop＝取引しない判断。epoch＝状態を引き継ぐ期間の区切り。F_ref／F_mix＝参照相手だけの場／混成の場。
- **本日の実測（2026-10-14、Air、この作業ツリー）**：`python3 ascon-notes/league/g3/prestart-check.py` の終了コードは1、status は FAIL。11項目のうち、candidate・inputs・trackedTree・upstreamByteEquality・upstreamRefPinned・disk・noAnvil・parentFrozenUnset・unitTimingOverrideAbsent は pass。`seedAudit` は不合格（hits 471件、errors 1件、sources 2524件）。`completeness` も不合格（blocked 10件）。これは検査器の出力をそのまま数えた値で、測定ホスト（mini）での実行値ではない。

## 1. 全不足項目の分類表

列の意味：**未証明のまま残ること**＝A として受け入れた場合に残るもの。B/C の行では、閉じるまでに残るもの。**必要資源**＝Docker／Anvil／モデル枠／mini の占有時間。**依存**＝先に終わっている必要がある行。

### 1.1 開始前検査（prestart-check.py の11項目）

| ID | 項目 | 区分 | 根拠 (file:line) | 未証明のまま残ること | 次の技術的一手 | 必要資源 | 依存 |
|---|---|---|---|---|---|---|---|
| PS-1 | 通過中の9項目（candidate／inputs／trackedTree／upstreamByteEquality／upstreamRefPinned／disk／noAnvil／parentFrozenUnset／unitTimingOverrideAbsent） | B | `G/prestart-check.py:278-287` | 今回の pass は Air のこの作業ツリーでの値。測定ホストで開始直前に通るかは未確認 | 実行担当ホスト（mini）で開始直前に再実行し、出力を証跡として保存する | mini（読取のみ） | B07a |
| PS-2 | `seedAudit` 不合格 | B | `G/prestart-check.py:123-221,283`。本日の hits 471件の内訳（ファイルの相対パス別）：`g3/schedule.tsv` 184、`g3/chain/summary.tsv` 144、`G3-DESIGN-ZETA-R2-2026-10-06.md` 76、`g3/README.md` 24、ほか。`summary.tsv` の該当行は `NOT RUN` の計画行（`C/summary.tsv:2-4`）。errors 1件は `insufficient sources for root /Users/masashi_mac_ssd/Developer/ascon: 0 < 1`（`G/prestart-check.py:211-213`） | 実使用との衝突か、他作業ツリーにある自計画のコピーかの区別。他端末・遠隔・非公開の記録は検査対象外（`G/prestart-check.py:221`） | ヒットを（パス・SHA-256・行の種類）で仕分け、自己予約（`G/inputs.lock.json` の `selfReservations` 16件）とバイト一致するコピー、`NOT RUN` 計画行、実使用を分けた表を作る。主作業ツリーの検査対象0件の原因も調べる。**検査器の変更は本人のレビュー後**。seed を勝手に差し替えない | なし | なし |
| PS-3 | `completeness` 不合格（blocked 10件） | B（ツール側） | `G/prestart-check.py:24-38,244-251`。起動器側にも免除はない：`C/chain.py:98-111` | 下の B01〜B10 の各行 | 証拠が揃った行について、根拠付きの実装・レビューでのみ列挙から外す（`G/prestart-check.py:245-246`）。**A の行が列挙にある限り不通過のまま**（§2） | なし | 各 B 行 |

### 1.2 REQUIRED_BLOCKERS の10件（B01〜B10。`G/prestart-check.py:28-37`、`G/inputs.lock.json` の `blocked` と同じ内容）

| ID | 項目 | 区分 | 根拠 (file:line) | 未証明のまま残ること | 次の技術的一手 | 必要資源 | 依存 |
|---|---|---|---|---|---|---|---|
| B01 | F_mix の r3 負荷校正と実チェーン確認。起動器は F_ref 専用 | C | `G/prestart-check.py:28`、`L/G3-LOCK-R3-2026-10-08.md:61-62`、`L/G3-SUCCESS-PLAN-2026-10-09.md:31` | 世界ごとの G0（計測の健全性）合格率、p99（99パーセンタイル）<1000ms、固定5 gwei 相手の動作、資金不足時の無取引 | F_mix 用の起動器を作り、ロック対象の全席・相手ハッシュで同一ホスト校正を行う | Anvil、mini の占有時間 | B07、B08c |
| B02 | 自然に生成された安全な変更の fixture（固定の試験データ）が無い | C | `G/prestart-check.py:26,29,248-250`、`L/G3-PREREQ-2026-10-07.md:83-89` | 無修理の原応答、実適用→異なる判断→有効取引→`revertTo:0` 後の元 module の実行 | `claude-cli:haiku`（サブスク枠）で ON 世界を回し、全応答を監査する。自然な変更が出なければ未成立のまま残す（変更を強制する prompt、手修理、成功するまでの再走はしない） | Anvil、モデル枠（サブスク）、mini の占有時間 | B07、B06、R1〜R3 |
| B03 | 悪意 fixture の危険注文を標準処理が受け入れる（安全 FAIL） | **A（本人受容済み 2026-10-10）** | 返値と `ctx.submit` に経済上限を強制する処理が無い：`R/improve.ts:408-412`、`L/G3-B03-B04-PATHS-2026-10-10.md:13`。生成コードは元の `decide` を包まずに置き換える：`R/strategyWorker.ts:40-43`。候補が不変の制御を登録する入口が無い：`sdk/src/agent.ts:64-69`。同梱基盤の変更は提出時に拒否される：`infra/submission/scan-submission.py:190-202`。運営は参加者のディレクトリだけを取り込む：`infra/submission/accept-submission.sh:9-18`。受容の記録：`L/DECISIONS-2026-10-10.md:8` | 危険な改訂を実行時に拒否できること（安全合格）。「将来の方式まで不可能」とは断定しない（`L/G3-B03-B04-PATHS-2026-10-10.md:42`） | なし（受容済み。ツールは変えない：`L/DECISIONS-2026-10-11.md:9`） | — | — |
| B04 | 実走全体の記録器（全 frame・試行・取引・receipt）が無い | C（内訳は §1.3 の R 行） | `G/prestart-check.py:31`、`L/G3-PREREQ-2026-10-07.md:71-81` | §1.3 の各行 | §1.3 | §1.3 | B07 |
| B05 | 永続予算台帳、旧使用分の精算、forward-100h（10/4起算の100時間枠）の残量と予約 | B（本人の事実確認を含む） | `G/prestart-check.py:32`、`L/BUDGET-SETTLEMENT-2026-10-08.md:5`（正確な消化・残量は UNKNOWN） | 消化＋残予約＋次工程が100時間以内に収まること | 両ホストの完了区間・失敗・予約を突き合わせた精算表を作り、未記録の区間は本人に確認する。欠落を0で補わない | なし | なし |
| B06 | サブスクの追加利用 OFF、Haiku 利用枠・認証が未確認 | B（本人作業） | `G/prestart-check.py:33`、`L/G3-LOCK-R3-2026-10-08.md:67`、`L/DECISIONS-2026-10-09.md:8` | 実行直前1時間以内の確認記録 | 本人が設定を確認する。実行担当は秘密値を出さずに認証結果だけを記録する。認証できたことを追加利用 OFF の証明にしない | なし | なし |
| B07 | r3 用の隔離 source／eval／tool manifest、依存関係、state dump が未登録 | B/C（内訳は §1.4） | `G/prestart-check.py:34`、`L/G3-B07-OFFLINE-AUDIT-2026-10-11.md:100-102` | §1.4 | §1.4 | §1.4 | — |
| B08 | 新しい seed 衝突監査、ホスト排他、容量、負荷校正 | B／C | `G/prestart-check.py:35`、seed は PS-2 | 下の B08b・B08c と PS-2 | 下の行 | 下の行 | — |
| B09 | 提出モデル・適用規約・配布版との同等性（Haiku は代理であり、提出 G3 ではない） | C／B／A?／A（内訳は §1.5） | `G/prestart-check.py:36` | §1.5 | §1.5 | §1.5 | — |
| B10 | 実300秒 timeout、5秒判断、遅着、epoch の持越し・復帰、64MiB の状態上限 | C（内訳は §1.3 の R5 行） | `G/prestart-check.py:37` | R5a〜R5h | R5 行 | R5 行 | R1、R2 |

### 1.3 記録器の5要件（`L/G3-PREREQ-2026-10-07.md:75-79`）の内訳

前提となる事実：標準ファイルを書き換えずに計測できる入口は実在する。roster（参加 agent の一覧）の `command/args` で起動を差し替えられ（`core/src/realtime/agentProcess.ts:219-223`）、CLI は `ERIS_CLAUDE_BIN` で差し替えられる（`R/llm.ts:587`）。このため、記録器の要件そのものは A にしていない。

| ID | 項目 | 区分 | 根拠 (file:line) | 閉じるまでに残ること | 次の技術的一手 | 必要資源 | 依存 |
|---|---|---|---|---|---|---|---|
| R1a | 要件1：world／mode／case、全対象ファイルの digest（内容ハッシュ）を持つ manifest | C | `L/G3-RECORDER-FEASIBILITY-2026-10-08.md:39` | 実走の成果物に結び付いた manifest | 終了後の成果物に SHA-256 を付ける生成器を、B07 の評価領域で動かす | Anvil | B07 |
| R1b | 要件1：呼出開始の時刻・PID と call block（改訂呼出時のブロック）の結合 | C | オフライン試作のみ：`G/CLI-START-BINDING.md:1-8,34-41` | 実走で全呼出を記録できること | `claude-start-binding.py` を `ERIS_CLAUDE_BIN` に指定して実走する | Anvil、モデル枠 | B07 |
| R1c | 要件1：独立に数えた期待件数（判断の省略を含む） | C | 自己申告の件数では足りない：`L/G3-RECORDER-FEASIBILITY-2026-10-08.md:41`。判断中は次の起動を省略する：`R/botMain.ts:623-625` | botMain の省略を含む全判断の母集合 | loader で botMain の呼出点を数える（`L/G3-LOADER-FEASIBILITY-2026-10-08.md:65`） | Anvil | R2b |
| R1d | 要件1：応答原文の全文（標準ログの `raw` は再直列化された値で、エラーは先頭200文字だけ） | C | `L/G3-RECORDER-FEASIBILITY-2026-10-08.md:35`、`R/llm.ts:569-580` | stdout の全文を保存しつつ、PID とプロセスの kill を保つこと | wrapper ではなく、bot 内で子の pipe を観測する（`L/G3-LOADER-FEASIBILITY-2026-10-08.md:117`） | Anvil、モデル枠 | R1b |
| R1e | 要件1：HTTP 経路（提出側の既定モデル `gpt-oss:120b`＝Ollama）の呼出識別。監査器は CLI の PID を要求する | B | 既定モデル：`R/botMain.ts:100,778`。HTTP の入口：`R/llm.ts:154-167`。CLI 前提の契約：`L/G3-RECORDER-FEASIBILITY-2026-10-08.md:37` | HTTP 経路に、架空でない呼出識別を与える監査契約 | `ERIS_INFERENCE_BASE_URL` 経由の proxy 記録を前提にした契約案と、人工入力での正対照（わざと問題を入れて検査が鳴ることの確認）を作る | なし | なし |
| R1f | 要件1：標準ログの上限（1行256KiB・全体64MiB）による切詰めに依存しない記録 | B | `R/agentLog.ts:78-79,109-121` | 切詰めや欠測を検出できること | 標準ログとは別の sidecar（専用の記録ファイル）に、欠測検出つきの記録形式を作る（人工入力で検査） | なし | なし |
| R2a | 要件2：実 `setSource` の時刻区間とハッシュ | C | `setSource` は代入だけで何も出力しない：`R/strategyRunner.ts:63-64`。試作と結合器は人工入力のみ：`G/loader/README.md:22-40,182-196` | 実 botMain 上での記録 | 既存の preload を実 botMain の起動に載せる | Anvil | B07 |
| R2b | 要件2：botMain が持つ版（局所変数） | C | `L/G3-REQ25-PLAN-2026-10-11.md:81` | 選んだ版と実際に動いた版の区別 | メモリ上で botMain の呼出点に版を渡す変換を作る（`L/G3-LOADER-FEASIBILITY-2026-10-08.md:65`） | Anvil | R2a |
| R2c | 要件2：worker 内での最初の判断の識別子（現状は親の送信記録だけ） | C | `G/loader/README.md:190-193` | worker 内で実際に判断を始めた記録 | 次の一手はオフライン：fixture 上で worker 側の計測を試作する（§3 の④） | Anvil（実走時） | なし |
| R3a | 要件3：noop・v0・省略を含む全判断 | C | 人工の結合器は完成済み（`G/loader/README.md:209` 以下）。実走の取得口は無い：`L/G3-REQ25-PLAN-2026-10-11.md:106-108` | 実走の全件 | R1c・R2c の取得口を実走で結合する | Anvil、モデル枠 | R1c、R2c |
| R3b | 要件3：worker の世代、判断の開始・完了時刻 | C | `L/G3-LOADER-FEASIBILITY-2026-10-08.md:74` | 親側の往復時間と worker 内の時間の区別 | worker 側の計測（R2c と同じ試作） | Anvil | R2c |
| R3c | 要件3：高水準 read（読出し）の呼出順と結果。通信の記録だけでは一意に戻せない | C | 一括要求の集約：`sdk/src/chain.ts:41-44`、`L/G3-RECORDER-FEASIBILITY-2026-10-08.md:59` | 実走での全 read 記録 | 次の一手はオフライン：worker 内の read client を包む Proxy を fixture で試作する | Anvil | R2c |
| R3d | 要件3：返値と `ctx.submit` の全試行（timeout 時に捨てた分、親で破棄した分、送信前に拒否した分を含む） | C | worker の submit：`R/strategyWorker.ts:62-63`。親の転送：`R/botMain.ts:630-636` | 通信に出てこない試行の全件 | 次の一手はオフライン：worker 側で submit と result を両方記録し、遅着・破棄の対照で検査する | Anvil | R2c |
| R4a | 要件4：実際の送信境界でのトークン残高 | C | Sender に渡るのは判断を始めた時点の残高：`R/botMain.ts:626-636` | 送信直前の状態 | Sender の境界で記録し、実走後にブロックを指定した読取で補う（`L/G3-REQ4-FEASIBILITY-2026-10-09.md` §8） | Anvil | R3d |
| R4b | 要件4：支出先別の allowance（支出許可額） | C | 読取は起動時だけ：`R/botMain.ts:559-562`、`L/G3-B03-B04-PATHS-2026-10-10.md:20` | 注文ごとの値 | R4a と同じ | Anvil | R3d |
| R4c | 要件4：`pendingReservations`（未送信分の資金予約） | C | 標準処理に生成元が無い：`L/G3-B03-B04-PATHS-2026-10-10.md:21` | 監査側で導出する台帳の実観測との結合 | 予約の開始・解放の契約は人工入力で作り（B 作業）、実走の送信待ち行列の観測で閉じる | Anvil | R3d |
| R4d | 要件4：`maxGasCostWei`（1判断の全注文の最大ガス費） | C | `L/G3-B03-B04-PATHS-2026-10-10.md:22`。人工入力の J12 は実装済み：`L/G3-REQ4-GAP-2026-10-11.md:33` | 署名済み取引との全件対応 | 実走の署名済み取引から導出する | Anvil | R3d |
| R4e | 要件4：`pendingGasWei`（未完了分のガス費予約） | C | 標準処理に無い：`L/G3-B03-B04-PATHS-2026-10-10.md:23` | 全未完了送信との結合 | R4c と同じ | Anvil | R3d |
| R4f | 要件4：`gasReserveWei`（維持すべきガス予備額） | **A?** | 標準処理にも候補にも予備を守る方針が無い：`L/G3-B03-B04-PATHS-2026-10-10.md:24`。補充目標は予備の保証ではない：`R/send.ts:408-425` | 予備が守られていること | **前提：候補 r3 を変えず、監査契約のこの欄も定義し直さない。** この前提を本人が確認するまでは B/C 扱い。B/C として扱う場合は、予備方針を候補に入れる（候補変更＝本人判断）か、監査契約で導出量として定義し直す（B） | — | 本人確認 |
| R4g | 要件4：全 receipt・包含ブロック・採掘後の取消（`mined` の代替値を成功と読み替えない） | C | `core/src/realtime/coordinator.ts:2864-2871`。J06 は常に BLOCKED：`L/G3-REQ4-GAP-2026-10-11.md:14` | receipt の全文 | 実走後に Anvil から receipt を取得する（追加の RPC として明記する） | Anvil | R4a |
| R4h | 要件4：補助送信（起動時の承認、ガス補充、派生送信元）の分類 | C | `L/G3-B03-B04-PATHS-2026-10-10.md:26` | 実判断との関係 | 監査設計（B）を作り、実走で全件照合する | Anvil | R4g |
| R4i | 要件4：通信記録器（P01〜P07）が未実装 | B | `L/G3-REQ4-GAP-2026-10-11.md:22` | 実走での動作 | `rpc-fixture-recorder.mjs` を人工の委譲先で作る（`L/G3-REQ25-PLAN-2026-10-11.md:118-132`） | なし | なし |
| R4j | 要件4：危険な試行・取消・遅着の全件数（J13） | C | `L/G3-REQ4-GAP-2026-10-11.md:21` | 母集合（R3d が前提） | R3d の後に行う | Anvil、モデル枠 | R3d |
| R5a | 要件5：実300秒の timeout と直接の子の kill | C | `R/llm.ts:67,553-556` | 実走での子の終了と、遅着が採用されないこと | `G/fault-timeout.yaml` で偽の CLI（`G/fake-claude.py:24` は実時間で301秒待つ）を使う。モデル呼出なし・$0。`G3_UNIT_TIME_SCALE` は未設定（`G/prestart-check.py:287`） | Anvil、mini の占有時間 | B07 |
| R5b | 要件5：子孫プロセスの終了（標準処理は直接の子だけを kill する） | C | `R/llm.ts:553-556` | 実際の claude CLI が子孫を残すかどうか。残る場合も標準処理は変えられないので、それは観測される事実（リスク）として記録する | R5a と同じ実走で、プロセスツリーを外から観測する | mini | R5a |
| R5c | 要件5：遅着予定時刻から世界終了まで、遅着が適用・送信されないこと | C | `G/loader/README.md:354` 以下（人工入力のみ） | 全期間の観測 | R5a の世界を最後まで記録する | Anvil、mini | R5a、R2a |
| R5d | 要件5：5秒の判断予算と、破棄後に submit しないこと | C | `R/decideTimeout.ts:8`、`R/botMain.ts:629-630` | 実 botMain の runner での確認 | 偽 provider で無限ループする executor を返し、実走で確認する（$0） | Anvil | R3d |
| R5e | 要件5：epoch の持越し・再開・元版への復帰と、元 module の実行 | C | `L/G3-RECORDER-FEASIBILITY-2026-10-08.md:87-89` | 復帰後の世代と最初の判断 | `change-revert` の fault 世界（人工の制御応答）で確認する | Anvil | R5h、R2 |
| R5f | 要件5：64MiB の状態上限の超過・破損・復元失敗時に旧版で安全に続くこと | C | `R/state.ts:45`、`L/G3-DESIGN-ZETA-R2-2026-10-06.md:120` | 実世界での挙動 | ダミーの state fixture を注入した世界で確認する | Anvil | B07 |
| R5g | 要件5：60ブロックに最大1呼出、同時実行1件 | C | `L/G3-DESIGN-ZETA-R2-2026-10-06.md:172` | 実走での呼出間隔 | R1b の記録から検査する | Anvil、モデル枠 | R1b |
| R5h | 要件5：監査器が元版（v0）復帰の再生に未対応 | B | `C/REVISION-AUDIT.md:102-103` | 実記録への適用 | `C/revision_audit.py` に v0 の再生を追加し、正対照を作る（ツール変更なので、レビューと lock 再登録が必要） | なし | B07a |

### 1.4 B07 の残り（`L/G3-B07-OFFLINE-AUDIT-2026-10-11.md:100-102`、`L/G3-B07-R3-PORT-DIFF-2026-10-11.md:134-141`）

| ID | 項目 | 区分 | 根拠 (file:line) | 閉じるまでに残ること | 次の技術的一手 | 必要資源 | 依存 |
|---|---|---|---|---|---|---|---|
| B07a | r3 の実行元 commit を40桁で固定し、専用の作業ツリーを作る | B | 方針は決定済み：`L/DECISIONS-2026-10-11.md:22`。移植 PR は `1feb95fb24d23c2be298b26a40ada47233262f5a` で merge 済み | 本人の事前レビュー | 候補の commit（例：上の merge commit と現在の main `0a102f1…`）の差分を示し、本人に選んでもらう | なし | なし |
| B07b | 評価領域 `~/Developer/ascon-g3-eval/` の作成と make-view（読取専用コピーの生成） | B | パスは決定済み：`L/DECISIONS-2026-10-11.md:36`。未作成：同 `:39` | view と manifest の実体 | 3つの入力（`G3_CHAIN_SOURCE`／`_COMMIT`／`_BASE`）を明示して `make-view.py` を実行する（`L/G3-B07-R3-PORT-DIFF-2026-10-11.md:13-15`） | なし | B07a |
| B07c | 必須ファイル集合のレビュー（全件の view＋レビュー済みの必須集合） | B | `L/DECISIONS-2026-10-11.md:23` | 本人のレビュー | import の連鎖を追った一覧を作る | なし | B07b |
| B07d | 評価領域の依存関係と Node／tsx の実体の固定 | B | `L/G3-B07-OFFLINE-AUDIT-2026-10-11.md:38` | 解決先のハッシュ | 既存の npm キャッシュからオフラインで導入する（前例：`L/G3-PREREQ-2026-10-07.md` 末尾）。それが無理ならネットワークが必要（本人に確認） | なし（または通信） | B07b |
| B07e | manifest 検査器の実入力モード（現在は人工入力専用） | B | `L/G3-B07-OFFLINE-AUDIT-2026-10-11.md:65-74` | 実入力での検査 | 実入力専用の判定語と、レビュー済みの期待集合ファイルを入力にする設計を実装する | なし | B07c |
| B07f | chain の説明文書（README／SNAPSHOT／REVISION-AUDIT）が r2・`/tmp` のまま | B | `L/G3-B07-R3-PORT-DIFF-2026-10-11.md:138` | — | 文書を r3 に合わせて改訂する | なし | B07a |
| B07g | state dump（チェーン初期状態の保存物）の内容ハッシュと互換性 | C | `L/G3-B07-OFFLINE-AUDIT-2026-10-11.md:40` | 生成・読込・genesis（初期ブロック）の照合 | 評価領域で Anvil を使って生成・読込する | Anvil | B07b |
| B07h | 配布 ZIP・観測器・CLI の実効設定の結び付け | C | `L/G3-B07-OFFLINE-AUDIT-2026-10-11.md:41` | ZIP のハッシュ、コンテナの selftest、CLI の認証状態 | Docker で ZIP を作り selftest を行う。CLI は秘密値を出さずに確認する | Docker、認証 | B07a、B06 |

### 1.5 B08・B09 の内訳

| ID | 項目 | 区分 | 根拠 (file:line) | 未証明のまま残ること | 次の技術的一手 | 必要資源 | 依存 |
|---|---|---|---|---|---|---|---|
| B08b | ホストの排他、プロセス一覧の取得、容量（mini） | B | `L/G3-LOCK-R3-2026-10-08.md:69`、`G/prestart-check.py:264-267,284` | 開始直前の状態 | mini で読取だけの検査を行う。gbrain の夜間処理や計時実験との重なりを確認する | mini（読取） | なし |
| B08c | 負荷校正 | C | `L/G3-LOCK-R3-2026-10-08.md:61` | 世界ごとの p99 | ロック対象の場で校正する | Anvil、mini の占有時間 | B07、B08b |
| B09a | 提出モデル（既定は `gpt-oss:120b`、Ollama Cloud）での自然な改訂と、HTTP 経路の実走 | C | `R/botMain.ts:100`、`L/DECISIONS-2026-10-09.md:9` | 提出モデルでの G3 証拠。Haiku の証拠は流用しない | 無料枠の量（dec-007、本人作業）が分かってから、限られた範囲で実走する。前払いは $0 のまま | Anvil、Ollama 無料枠 | R1e、本人の dec-007 |
| B09b | 現行の公開規約本文との照合 | B（実走不要・ネットワークでの読取だけ） | 規約の唯一の出典：`docs/competition-start.md:7` | 適用される版 | 公開ページを読み、ローカルの写しとの差分を記録する（本人が通信を許可した場合） | 通信 | なし |
| B09c | 主催者が実際に評価で使う配布版・起動経路・推論 proxy・モデル設定と、手元が同一であること | **A?** | 運営は自分の同梱基盤を使い、参加者のディレクトリだけを取り込む：`infra/submission/accept-submission.sh:9-18`。起動は標準の bot.ts：`infra/docker-agent/Dockerfile.base:36`。運営の推論 proxy：`R/llm.ts:64-65`。本人の前提（今出ている情報以上の強制はなく、公式な方法もない）：`L/DECISIONS-2026-10-10.md:7`。質問は送らない：`L/DECISIONS-2026-10-11.md:10` | 本番の評価環境で同じ挙動になること | **前提：主催者は、提出時のバイト一致検査を通った同梱基盤を差し替えず、公開情報以上の設定は得られない。** 本人が確認するまでは B/C 扱い（B09b で公開情報を最大限照合する） | — | 本人確認 |
| B09d | loader ありとなしの実行が、外から見える出力で一致すること | C | 必要な対照：`L/G3-LOADER-FEASIBILITY-2026-10-08.md:160` | 同じ seed での取引・nonce（取引連番）・fee・receipt・改訂採否の一致 | loader だけを切り替えた対の実走を行う | Anvil、モデル枠、mini の占有時間 | R2〜R4、B07 |
| B09e | 計測しない構成（提出物そのもの）の内部 frame の直接観測 | **A** | 標準実行基盤に frame の生成元が無い：`L/G3-RECORDER-FEASIBILITY-2026-10-08.md:61`、`L/G3-B03-B04-PATHS-2026-10-10.md:68`。運営の起動は loader なしの標準 bot.ts：`infra/docker-agent/Dockerfile.base:36`。同梱基盤の改変は拒否：`infra/submission/scan-submission.py:190-202`。候補側で記録しても、改訂後のコードには引き継がれない（生成コードが `decide` を置き換える：`R/strategyWorker.ts:40-43`） | 提出構成の内部挙動（worker 内の read、捨てた submit 等）が計測構成と同じであること。**この A 判定は、本リポジトリ内にある運営用 infra ファイル（`Dockerfile.base`、`scan-submission.py`）に依存する。主催者の実際の環境は未確認（B09c と同じ前提）。**B09d で外から見える出力の一致までは示せるが、内部の一致は示せない | なし | — | — |
| B09f | 計測による時間干渉が、宣言した許容範囲より小さいこと | C | 現設計では最小検出効果より小さい移動を確実には認証できない：`G/loader/TIMING-RESULTS-2026-10-11.md:3` | 干渉の大きさ | 検出力を上げた再設計を作り、mini で再計測する（単一ホスト・単回の結果を一般化しない） | mini の占有時間 | B09d |

## 2. A の項目を受け入れるとはどういうことか

- **G3 は、受け入れた A の項目について PASS になることはない。** 受け入れは「測れないことを知った上で残るリスクとして開示する」という意味で、安全や同等性の証拠にはならない。B03 の前例（`L/DECISIONS-2026-10-10.md:8`、`L/DECISIONS-2026-10-11.md:9`）と同じく、ツールは変えず、`REQUIRED_BLOCKERS` とロックは A の項目を列挙し続ける。
- **ツールを変えない限り、`completeness` は通らず、起動器 `chain.py` も開始しない**（`C/chain.py:98-111` には免除がない）。したがって、A を受け入れて B/C を全部閉じても、今のツールのままでは G3 の実走は始まらない。それをどう扱うか（ツールの表現を変えるか、提出判断をどうするか）は本人の判断で、本書は勧めも決めもしない。
- 開示の文言は「未解決・本人受容済み・測定不能」とし、「PASS」「解消」「同等」とは書かない。
- **本人に1件ずつ確認してほしい A の項目**：
  1. **B03**：受容済み（2026-10-10）。再確認は不要。一覧に載せるだけ。
  2. **B09e**：提出構成（loader なし）の内部 frame は直接観測できない。B09d（外から見える出力の一致）で示せる範囲を超える内部の一致は、測定不能として受け入れるか。
- **A? の項目（前提の確認が先。確認されるまでは B/C として作業を続ける）**：
  3. **R4f**：「候補 r3 を変えず、`gasReserveWei` の監査上の定義も変えない」という前提を本人が認めるか。認めない場合は B/C（候補変更、または監査契約の定義し直し）に戻す。
  4. **B09c**：「主催者は同梱基盤を差し替えず、公開情報以上の設定は得られない」という前提を本人が認めるか。認めない場合は、B09b での確認や問い合わせ（本人判断）に戻す。

## 3. B/C の進め方（今週）

### 3.1 推奨する次の5手（各手の最初の一歩）

| 順 | 対象 | 最初の一歩 | 区分 | 理由 |
|---|---|---|---|---|
| ① | B07a→B07b→B07d | `1feb95fb24d23c2be298b26a40ada47233262f5a`（移植の merge）と `0a102f1a540a6dfc98f7b9aefc651cd12a28d21c`（現在の main）の差分を `git diff --stat` で示し、本人に実行元 commit を選んでもらう | B | ほぼ全ての C 行が評価領域に依存している |
| ② | PS-2（seed 監査） | 本日の出力（hits 471件）を、自己予約とバイト一致するコピー／`NOT RUN` 計画行／実使用に仕分けた表を作る。主作業ツリーの「検査対象0件」の原因も調べる | B | 開始前検査の不合格2件のうちの1件。検査器の変更はレビュー後 |
| ③ | R5h・R1e・R4i（監査器と契約） | Codex に、`revision_audit.py` の v0 再生追加の設計と、正対照（わざと壊した入力で検査が鳴るテスト）の一覧を依頼する | B | 実走しても監査器が受け取れなければ閉じられない |
| ④ | R2c・R3c・R3d（worker 側の計測） | 既存の fixture runner 上で、worker 内の submit・result・read を記録する試作を書き、遅着・破棄の対照を先に用意する | B（C の前段） | 実走の前に、記録の漏れを検出できることを確かめる |
| ⑤ | 最小の実走診断（C） | 下の 3.2 の範囲案を本人に提示し、承認を得る | C | 開始経路は資料に無い（`L/G3-SUCCESS-PLAN-2026-10-09.md:84`）。G3 の実走ではない診断として、本人の判断が要る |

### 3.2 mini での最小実走診断（提案。未実施、承認待ち）

- **位置づけ**：G3 の実走ではなく、記録の欠落を見つけるための診断。成果は「どの欄が BLOCKED のまま残るか」の一覧。開始前検査の不合格を迂回して G3 の証拠を作るものではない（`L/G3-SUCCESS-PLAN-2026-10-09.md:86`）。
- **段階1（モデル呼出なし・$0）**：`G/fault-timeout.yaml` を使う。偽 CLI（`ERIS_CLAUDE_BIN=./ascon-notes/league/g3/fake-claude.py`、`G3_FAULT_CASE=timeout`、`ERIS_LLM_CALL_TIMEOUT_MS=300000`：`G/fault-timeout.yaml:30-34`）で、R5a・R5b・R5c を実時間で観測する。`G3_UNIT_TIME_SCALE` は設定しない。
- **段階2（サブスク枠・従量課金なし）**：`G/ref-on.yaml` と同じ設定（`ERIS_LLM_MODEL=claude-cli:haiku`、`ERIS_IMPROVE_LOG_CALLS=1`：`G/ref-on.yaml:30-33`）。CLI 経路は API キーを外してサブスク（OAuth ログイン）で課金する（`R/llm.ts:592-593`）。`ERIS_CLAUDE_BIN` には `G/claude-start-binding.py` を指定し、loader の出力先は `G3_PROBE_JSONL`（`G/loader/README.md:30`）にする。F_ref の ON 世界を1つだけ、短い範囲で回し、既存の人工結合器（source／decision／boundary／lifecycle の各 join）に実記録を通す。結果は BLOCKED になる見込みで、そのとき不足している欄の一覧を得る。
- **前提**：①（B07 の評価領域）、B06（本人による追加利用 OFF の確認）、B05（予約。`C/chain.py:367` の方式では、早く失敗しても予約した時間全体が課金される）、B08b（排他）。
- **リスク**：
  - mini の負荷：過去の計時実験は負荷ガードで中断している（`G/loader/TIMING-RESULTS-2026-10-11.md` の失敗表）。gbrain の夜間処理と重ならない時間帯を選び、1ホストでは1測定だけにする。
  - 利用枠：mini の claude CLI のアカウントが他の自動処理と枠を共有しているかは未確認。枠を使い切った場合、別のモデルや従量課金へ自動で切り替えない。
  - 計測への干渉：計測構成は提出構成と違う（`L/G3-LOADER-FEASIBILITY-2026-10-08.md:5`）。診断の結果を同等性の証拠にしない。
  - 秘密：記録に env・RPC の URL やヘッダ・wallet を残さない（`G/loader/README.md:31-33`）。

## 4. 確認したこと・できなかったこと

- 本書の file:line は、この作業ツリーでその行を表示して確認した。過去の文書から引いた行番号のうち、移植後に位置がずれた `chain.py` の行は、現在の行（`C/chain.py:98-111`）に置き換えた。
- 実行したのは読取コマンド、Git の読取、そして読取専用の `prestart-check.py` 1回（ネットワーク・RPC・自動修理なし。終了コード1）だけ。計測、モデル呼出、Docker、Anvil、SSH、ネットワーク、commit／push はしていない。
- **未確認**：mini での開始前検査の値、seed のヒットが実使用かどうか、mini の CLI アカウントの枠、主催者の評価環境、現行のオンライン規約。
- 変更したファイルは本書1件だけ。標準実行基盤・SDK・共通 lib・core・`example/agents/`・`G/` は変更していない。
