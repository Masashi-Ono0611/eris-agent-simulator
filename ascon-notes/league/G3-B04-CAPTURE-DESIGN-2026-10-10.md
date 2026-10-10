# G3 B04：取引境界の証拠を採取・結合する設計 — 2026-10-10

**結論：最初に実装できるのは、保存済み記録の対応と欠落を出す事後結合器である。既存ログ・現probe・外部通信だけで、判断から全取引境界までの完全な証拠は作れない。** 本書は実装前の設計であり、収集成功・挙動不変・B04完了を示す結果ではない。根拠：`G3-SUCCESS-PLAN-2026-10-09.md:46-58`、`G3-REQ4-FEASIBILITY-2026-10-09.md:194-198`、`g3/loader/README.md:170-180`。

G3（Gate 3、自己改訂の実チェーン受入れ）は内部の **REQUIRED（必須）** のまま。B03は **USER-ACCEPTED（本人受容済み）の未解決残余リスク** で、PASS（合格）・closed（解決済み）ではない。他の必須条件も維持し、証拠不足はBLOCKED（不足により判定・進行不可）。ゲートの免除・緩和・代替を提案・決定せず、ツールも変更しない。根拠：`DECISIONS-2026-10-10.md:8-16`。

## 1. 読み方と対象

引用は `ascon-notes/league/` が基点。コードの接頭辞 `R/` はリポジトリ直下の `example/agents/runtime/`、`S/` は `sdk/src/`、`C/` は `core/src/`、`ROOT/` はリポジトリ直下へ展開する。run内のファイル名はコードの所在ではなく、実行結果ディレクトリからの相対名である。以下の **設計** は提案であり、既存機能という意味ではない。`not found in files` は今回の静的読取・検索範囲で根拠を発見していないという意味で、外部の機構一般の不存在は断定しない。

用語：RPC＝Remote Procedure Call（遠隔手続呼出）、HTTP＝Hypertext Transfer Protocol（通信方式）、JSON＝JavaScript Object Notation、JSONL＝JSON Lines（1行1記録）、CSV＝Comma-Separated Values（カンマ区切り）、ID＝Identifier（識別子）、URL＝Uniform Resource Locator（接続先表記）、SDK＝Software Development Kit（開発キット）、SHA-256＝Secure Hash Algorithm 256-bit（内容ハッシュ）、UTC＝Coordinated Universal Time（協定世界時）。txはtransaction（チェーン取引）、nonceは送信元ごとの取引連番、receiptは採掘後の実行結果、spenderは支出許可先、allowanceはその支出許可額。ETHはEther、weiはEtherの最小単位。用語と既存境界の根拠：`G3-REQ4-FEASIBILITY-2026-10-09.md:12-15,38-47`。

本書ではactionを注文案、frameを判断記録、intentを検証後の実行要求、queueを送信待ち行列、probeを観測処理、loaderを起動時の追加読込コード、proxyを通信中継器、fixtureを合成の固定試験データ、schemaを記録形式と呼ぶ。Workerは戦略用の別スレッド、noopは無取引、v0は元のプログラム、CLIはCommand Line Interface（コマンドライン操作系）、PIDはProcess Identifier（プロセス識別番号）である。用語の基点：`G3-REQ4-FEASIBILITY-2026-10-09.md:14-15`、`G3-SUCCESS-PLAN-2026-10-09.md:13-15`。`ctx.submit`の試行、親が採用した出力、`Sender.submit`の検証、ノードへの送信を別の段階として扱う。子のsubmitは結果と一緒に親から送られ、期限後の出力は破棄され得るためである（`R/strategyWorker.ts:47-83`、`R/strategyRunner.ts:131-163,190-219`、`R/botMain.ts:623-638`）。

対象は要件4の「実取引境界の残高・支出先別許可・予約・ガス費と予備・receipt・events/blocks完全対応」。不足を0やtrueで埋めない（`G3-PREREQ-2026-10-07.md:71-81`）。B04経路表の実適用、全入力/読取、全試行、送信帰属、補助送信、完全性も、この結合の前提として残す（`G3-B03-B04-PATHS-2026-10-10.md:15-27`）。

## 2. 第1層：終了したrunのファイルを事後結合する

### 2.1 入力一覧と、そのファイルにあるもの

本表は**producer（記録を作るコード）から分かる形式**である。今回、特定の実runディレクトリを選んで原ログを検査してはいない。従って、各runに実在するか、最後まで保存されたかは未検証。将来の結合器は、明示された入力一覧だけを読み、不在ファイルも不足として報告する設計とする。

| run内の入力 | 使用する行・列と結合キー | 制限・根拠 |
|---|---|---|
| `summary.json` | `runId`、`runStartBlock`、`finalBlock`、`violations`。world（実行世界）の起点 | producerは `C/realtime/coordinator.ts:5065-5079,5100`。終了イベントとの対応は `g3/chain/revision_audit.py:88-94`。runIdだけで別チェーン/resetを同定できる保証は **not found in files** |
| `events.jsonl` | `run_completed.runId`。将来の`g3_decision_started`は`agentId,id,ts,round,version`、`g3_action_attempt`は`agentId,frameId,route,ordinal,actionSha256` | 後者2種は現標準ログにない将来契約（`g3/chain/REVISION-AUDIT.md:69-75`）。再構成イベントの`agentId,observation.round`は評価断面の参照に限る（`C/realtime/reconstruct.ts:1282-1306`） |
| `blocks.csv` | `hash,blockNumber,txIndex,from,ownerId,role,status,gasUsed,priorityFeeWei,maxFeePerGasWei,to,valueWei,derivedFrom`。`round,actionType,method,bundleId,bundleIndex`も原値保持 | 正式列は `C/logger.ts:8-59`、空値の出力は同`:142-146`。候補の`actionType`は`direct`になり得る。methodは取引入力の復号であり、返値/submit経路ではない（`C/realtime/coordinator.ts:2918-2943`） |
| `agents/<agentId>.jsonl`：mempool申告 | `kind=mempool,event=submitted`の`hash,nonce,priorityFeeWei,actionType,protocol,amount,base,bundleId,bundleIndex,blockSeen`。各行に`agentId,ts` | 独立した標準`mempool.jsonl`ではなく、このファイルに混在する（`R/send.ts:29-35,278-284,359-373`、`R/agentLog.ts:93,108`）。未設定のamount等は欠落のまま |
| 同ファイル：失敗・補助・判断・改訂 | `bad_action,rejected,submit_failed,approval_failed,approvals_granted`、`reason=revision ...`の`round,state`、任意の戦略log、無取引log | 失敗にhashがあるとは限らず、`approvals_granted.count`はreceiptではない（`R/send.ts:301-355`、`R/botMain.ts:587-602,647-653,960-967`）。`rememberDecision`はメモリ上の履歴であり、全actionを永続化する行ではない（同`:352-358,631-638`） |
| `agents/cand.cli-timing.jsonl`、`agents/cand.llm.jsonl` | 呼出開始`ts,pid`、応答`block,ts`、改訂結果`round`。`g3-audit.json.callStarts`と`applications`がある場合だけ版の結合を検査 | 現監査は`cand`固定。開始行の順番だけでは実blockを確定しない（`g3/chain/revision_audit.py:75-85,115-140,204-211`）。言語モデル応答は取引receiptではない |
| `g3-audit.json`、`agents/cand.audit-frames.jsonl` | `worldId,files,expectedFrames,expectedCalls,applications`、frameの`id,version,workerGeneration,observation,returned,submitted,reads,safety` | **将来契約であり、標準runに存在すると仮定しない**（`g3/chain/revision_audit.py:4-6`、`g3/chain/REVISION-AUDIT.md:39-75`）。結合器が不足を埋めて生成する対象ではない |
| `G3_PROBE_JSONL`で明示されたprobeファイル | `seq,threadId,utc,monoNs,event`、`runnerId,callId,decisionId,generation,workerDecisionId,sourceSha256,version` | 固定basenameはない。原runとの対応表が必要。probeはオフライン試作で、注文・観測本文なし、版は`fixture-explicit`（`g3/loader/README.md:3-10,30-59`、`g3/loader/probe-io.mjs:16-20`） |
| 独立したreceipt全文ファイル | **標準producerは not found in files**。CSVのreceipt由来列を読む。将来別採取がある場合だけ明示入力に追加 | `C/realtime/coordinator.ts:2851-2874,2918-2943`はreceiptの一部をCSVへ保存。全文のlogs、blockHash、effectiveGasPriceを保存する標準ファイルではない（`G3-REQ4-FEASIBILITY-2026-10-09.md:89-93`） |

設計上、segment（分割保存）には明示した全ファイル集合と境界を要求する。末尾の1ファイルだけを全runとしない。agentの出力先はsegmentごとに移り、CSVも順次flushされる（`R/agentLog.ts:46-65,93-99`、`C/realtime/coordinator.ts:2947-2957,4412,4558`）。CSVに行がないblockが空blockだったことは、CSVだけでは証明できない。全blockのscan完了を独立に証明するrun別原本は今回 **not found in files**。`run_completed`だけから全receiptの取得成功を導かない（同`:2864-2871,5165`）。

### 2.2 キーと結合手順（実装提案）

**入力の外側に採取由来を置く。** `captureSetId`は取り込む原本集合の識別子、`worldId`はsummaryのrunId、`chainInstanceRef`はresetを含むチェーン実体の根拠への参照とする。後二者が不明でもローカルな原本行の索引は作れるが、世界をまたぐ結合と完全性の認定はBLOCKED。ファイル名だけからchain ID・block hash・agentを捏造しない。この区別が必要な理由：`G3-REQ4-FEASIBILITY-2026-10-09.md:188`。

全入力行に`sourceRef={relativePath,line,fileSha256}`を付ける。CSVはヘッダーを1行目としてデータ行を数える。原値と正規化値を別に持ち、空文字、項目なし、読取失敗、nullを同一視しない。ハッシュ・アドレスは検証後に小文字の索引を作り、整数・金額は浮動小数点へ変換しない。証拠ハッシュだけでは採取の信頼性が証明できない点は維持する（`g3/chain/REVISION-AUDIT.md:45,74-75`）。

| 結合する端点 | 厳密なキー・関係（設計） | 現時点で成立する範囲／不足 |
|---|---|---|
| 判断開始イベント ↔ frame | 同一world・agentの`event.id = frame.id`。`ts=startedAt,round=observation.round,version`も一致。配列順も保持 | `g3/chain/revision_audit.py:212-228`の契約。元版・無取引も対象。現標準の両producerは **not found in files**（`g3/chain/REVISION-AUDIT.md:52-75`） |
| frame ↔ action試行 | `attemptKey=(captureSetId,worldId,agentId,frameId,route,ordinal)`。`route=submit`はsubmitted配列、`return`は返値の単一要素。非noopについて整列済みコンパクトJSONのSHA-256を照合 | 現監査の順序はframe順→submit順→returnで、単なるhash集合でない（`g3/chain/revision_audit.py:234-238,257-258`）。hashが同じ両経路を統合しない |
| probe内の呼出 ↔ Worker送受信 | 同一probe入力の`runnerId,decisionId`、`generation,workerDecisionId`を`worker_post`で橋渡し。method入口/出口は`callId` | 現probe内なら識別可能（`g3/loader/probe-loader.mjs:103-126,148-179`）。probeのdecisionIdと監査frame.idを結ぶproducerは **not found in files**。数値一致や近い時刻で補わない |
| action試行 ↔ Sender入口 ↔ intent ↔ queue ↔ 構築tx | 将来は`attemptKey → senderCallId → intentOrdinal → queueTaskId → builtTxOrdinal → sendAttemptId`の明示辺が必要 | 現`Sender.submit`にframe/route/ordinalはない。queueは関数の連鎖で、1注文から複数tx、構築失敗、raw取引もある（`R/send.ts:169-170,295-397`）。この辺を生む記録器は **not found in files**。actionType/amount/blockSeen/bundleの一致は候補絞込みにしか使わない |
| mempool送信申告 ↔ tx | 同一worldの検証済み`hash`で結合。申告行のagentとCSVのownerの整合も確認。1 hashに複数の通信試行があり得る設計にする | `submitted`にはhashがある（`R/send.ts:278-284`）。`submit_failed`は受理済み応答喪失もあり、未送信と断定できない（同`:285-290`）。失敗行を「次の成功行」に順番で結ばない |
| tx ↔ receipt ↔ CSV採掘行 | `txKey=(captureSetId,worldId,hash)`。receiptがあれば`transactionHash`を照合し、`blockNumber,transactionIndex,status`、取得済みなら`blockHash`も照合。CSVの位置キーは`(worldId,blockNumber,txIndex)` | CSVと申告のhash結合は可能（`R/send.ts:278-284`、`C/realtime/coordinator.ts:2918-2943`）。receipt全文未取得を、CSVから全文へ昇格しない。chain実体の根拠がなければ強いチェーン同定は未解決 |
| 評価events ↔ CSVのblock | `observation.agentId`ではなく外側`agentId`と`observation.round`を使用し、同一worldのblockへ参照を付ける | 再構成イベントの形は `C/realtime/reconstruct.ts:1285-1306`。判断→送信の因果辺ではない。イベントのtsは書込時刻であり、当時の判断時刻に転用しない（`C/logger.ts:135-139`） |
| 補助送信・派生送信元 ↔ tx | `origin=startup_approval / gas_refill / derived_sender / unknown`を別欄に保持。確定には原送信の明示根拠が必要。判断がなければ`attemptKey=null` | 起動承認はSender外、補充は判断外、派生送信元も候補に帰属し得る（`R/botMain.ts:587-602`、`R/send.ts:427-478`、`C/realtime/coordinator.ts:2887-2916`）。approve calldataだけで「起動承認」と決めない |

版の事前結合も別に行う設計とする。`cli-timing`の開始`ts,pid`を`g3-audit.callStarts`の同値へ結び、そのbindingのblockを応答のblock、改訂結果のround、`applications.callBlock`と照合する。応答→実setSource→結果の時刻区間を検査し、`applications.firstDecisionId`を当該版の最初のframeへ結ぶ。複数候補・孤立・版不一致は残す。行番号順だけの呼出対応やsource hashだけの版推定は確定根拠にしない（`g3/chain/revision_audit.py:115-152,204-214,260-263`、`g3/loader/README.md:47-53`）。

actionのhashは現Python監査と同じ`json.dumps(action, sort_keys=True, separators=(',', ':')).encode()`のSHA-256を基準にする。実装案ではPython既定の非ASCII文字エスケープも再現し、単なるキー順整列のJavaScript文字列化と同じと仮定しない。改行・日本語文字・入れ子・同値でキー順だけ違うactionを合成対照に含める（現処理：`g3/chain/revision_audit.py:234-238`）。

結合処理の順番は、原本検査→worldの同定→配列のまま重複検査→各索引作成→完全外部結合→不足集合/矛盾の出力とする。候補について`H_csv`（CSV hash）、`H_submit`（送信申告hash）、`H_receipt`（全文receiptのhash）、`H_frame`（frame側receipt hash）を別集合にし、まず和集合の全要素を出す。`H_submit-H_csv`、`H_csv-H_submit`、全文receipt不在、frame帰属不在は別理由で残す。補助経路では申告ファイルがないこともあるので、原送信の別証拠で結べるかを調べ、集合を都合よく削らない。現監査の必須条件は`H_frame=H_csv`かつframe側receiptのhash重複なしであり、補助送信を含む対応が閉じなければBLOCKEDのままである（`g3/chain/revision_audit.py:243-259`、`R/botMain.ts:587-602`）。

**順序の設計：** ファイル行順、probeの採番順、通信の要求/応答順、採掘順は別列で残す。probeはseq順に監査するが、thread間の物理行順は前後し得る（`g3/loader/README.md:66-70`）。既存の`blockSeen`は判断時のroundであり、送信blockではない（`R/send.ts:193-194,336-373`）。`txIndex`はblock内包含順であり、全agentの送信到着順やsubmit順への並べ替え規則にしない（`C/realtime/coordinator.ts:2920-2922`、`G3-REQ4-FEASIBILITY-2026-10-09.md:101`）。

### 2.3 結合結果のschema（新設案、現監査への入力ではない）

提案名を`b04-capture-join-v1`とする。結果は原本を上書きせず、別出力として作る。次は型の設計であり、実runの値を示すJSONではない。既存契約への対応元は `g3/chain/REVISION-AUDIT.md:39-75`、欠落箇所は `G3-B03-B04-PATHS-2026-10-10.md:15-27`。

```text
CaptureJoin {
  schema: "b04-capture-join-v1",
  evidenceClass: "SYNTHETIC" | "RUN_FILES",
  captureSetId: string, worldId: string | null,
  candidateId: string,                 // 現監査との対応では cand を明示
  chainInstanceRef: SourceRef | null,
  inputs: [{path, sha256, role, segmentRef, capturePhase, availability, issues[]}],
  decisions: [Decision],               // 無取引も残す。probeだけから生成しない
  attempts: [Attempt],                 // actionの金額を集計する単位
  joined: [JoinedRecord],
  readObservations: [ValueEvidence],
  diagnostics: [{checkId, severity, code, subjectKeys[], sourceRefs[]}],
  unresolved: [{edgeOrValue, subjectKey, reason, sourceRefs[]}],
  coverage: {declaredScope, observedCounts, independentCountRefs, missingScopes[]},
  joinStatus: "CONSISTENT_WITHIN_SCOPE" | "BLOCKED" | "FAIL",
  gateDecision: "NOT_EVALUATED"
}
Decision {
  frameKey, frameId, agentId, version, workerGeneration,
  startedAt, completedAt, observationRef, returnedRef, submittedRefs[],
  readTranscriptRef, telemetryRefs[], probeBindingRef, sourceRefs[]
}
Attempt {
  attemptKey, frameKey, route, ordinal, actionRef, actionSha256,
  senderCallId, intentKeys[], queueTaskIds[], disposition,
  dispositionEvidenceRefs[], completeness, missingReasons[]
}
JoinedRecord {
  rowKey, kind: "transaction" | "unsent_attempt" | "unbound_evidence",
  worldId, agentId, origin,
  attemptKey: string | null, frameKey: string | null,
  senderCallId: string | null, intentKey: string | null,
  queueTaskId: string | null, builtTxOrdinal: integer | null,
  actionRef, submitRefs[],                 // 申告/通信試行は配列で保持
  transaction: {
    hash, hashOrigin, from, nonce, to, valueWei, inputRef,
    gasLimit, maxFeePerGasWei, maxPriorityFeePerGasWei, gasPriceWei,
    signedTxRef, nonceGroupKey
  } | null,
  receipt: {
    availability: "full" | "csv_projection" | "missing",
    statusRaw, statusClass: "success" | "reverted" | "unknown",
    transactionHash, blockNumber, blockHash, transactionIndex,
    gasUsed, effectiveGasPriceWei, logsRef, sourceRefs[]
  },
  inclusion: {blockNumber, blockHash, txIndex, blockRowRefs[], blockSourceRef},
  ordering: {sourcePositions[], probeSeqs[], rpcRequestKeys[], causalRefs[]},
  valueEvidenceRefs[], missingEdges[], sourceRefs[]
}
ValueEvidence {
  name, tokenAddress, owner, spender, actionType, attemptKey,
  boundary: "decision" | "sender_entry" | "queue_start" | "send" |
            "receipt" | "historical_block" | "unbound_rpc_read",
  value: decimal-string | null, unit,
  availability: "observed" | "derived" | "missing" | "error" | "ambiguous",
  requestedBlockTag, resolvedBlockNumber, resolvedBlockHash,
  clockDomain, observedAt, requestRef, responseRef, derivationRefs[], missingReason
}
SourceRef = {relativePath, line, fileSha256}
```

型の補足も設計条件とする。

- 数値がない欄はnullと理由を必須にする。観測済みの数値0は原応答がある場合だけ許す。安全値にtrueを入れない。金額・nonce・block番号は桁落ちしない非負整数表現で保持する。元のCSV/JSON表現もsourceRefから追えるようにする。
- `transaction`行のrowKeyは`(captureSetId,worldId,hash)`、`unsent_attempt`はattemptKey、`unbound_evidence`は原本行をキーにする。`frameKey=(captureSetId,worldId,agentId,frameId)`とする。hashの由来`hashOrigin`は申告・RPC返答・署名内容からの計算を区別する。同じhashの複数通信試行・receipt再読取は参照配列で保持し、取引件数を増やさない。異なるactionへの二重帰属は曖昧として停止する。1 actionから複数txができても、actionの支出額は`attempts`側で一度だけ扱う。異なるhashで同じ送信元/nonceなら`nonceGroupKey=(captureSetId,worldId,from,nonce)`で束ね、hashを潰さない。
- hashなしの失敗/拒否行は原本行をキーにした`unbound_evidence`として必ず残す。明示的なaction対応と送信前拒否の根拠がある場合だけ`unsent_attempt`へ分類する。receipt欠落を「未採掘確定」へ変えない。
- `Decision`は実frameが存在する場合だけ作り、未知フィールドは不足にする。無取引frameは取引行がなくても残す。破棄されたWorker試行は採用出力と別の証拠として保持し、現監査のattempt配列に無理に混ぜない。
- `statusRaw`は変更しない。表示用には`1/success/0x1`をsuccess、`0/reverted/0x0`をrevertedへ対応できるが、未知値・`mined`・応答なしはunknown。現監査はCSVの`1/success`以外をFAILとし、receiptとの比較も文字列一致なので、表示用正規化で監査結果を改善しない（`g3/chain/revision_audit.py:101-104,243-247`）。
- `CONSISTENT_WITHIN_SCOPE`は指定された部分の照合成功だけを意味する。G3・B04のPASSを出力しない。必須辺・必須値が欠ければBLOCKEDを併記する。FAILとBLOCKEDの理由は両方残し、主表示だけFAILを優先する。これは現監査の優先順に対応する（`g3/chain/revision_audit.py:283-288`）。

### 2.4 検査とFAIL / BLOCKEDの境界

下表のJ番号は**将来の結合器の検査識別子**。現監査が直接実装していない検査も明示する。FAILは観測された矛盾・不許可結果、BLOCKEDは欠落・曖昧さによる不成立。合成fixtureの合格は、現監査や実runの合格を意味しない（監査の射程：`g3/chain/revision_audit.py:283-288`）。

| ID・検査 | FAIL / BLOCKEDとする具体条件（設計） | 現監査の対応行・差 |
|---|---|---|
| J01 原本と完了 | BLOCKED：不在、壊れたJSON/CSV、JSONL末尾欠落、切詰め/容量上限印、root外参照、未説明のsegment、完了なし/重複、入力digest不一致。原本を補修して続行しない | `g3/chain/revision_audit.py:56-81,88-114`。同一runの独立完全性は契約`:109-114`と`g3/chain/REVISION-AUDIT.md:74-75`も必要 |
| J02 world・所有者 | BLOCKED：run/probe/chain実体の結合根拠なし、候補IDの対応不明。FAIL：同じhashを別world・別ownerへ誤結合した明示矛盾 | `g3/chain/revision_audit.py:84-105,259`。chain実体/hash/ownerの横断比較は直接実装 **not found in files**、追加照合案 |
| J03 重複 | BLOCKED：CSVの同一world/hash重複、同一block/txIndexの複数行、frame/attemptキー重複。内容が異なる重複は矛盾もFAILへ追加。先勝ち/後勝ちで消さない | `g3/chain/revision_audit.py:213-214,259`。CSVは`:101`の辞書化で重複が隠れ得るため、辞書化前に検査する追加案 |
| J04 判断・出力の被覆 | BLOCKED：開始ID/順序・frame・非noopのroute/ordinal/hashが不一致、片側だけ存在、noop/v0を除外、同一actionの両routeを統合。危険試行なしを空ログから推定しない | `g3/chain/revision_audit.py:212-238,257-258`。現producer不足は `g3/chain/REVISION-AUDIT.md:69-75` |
| J05 action→送信帰属 | BLOCKED：frame→Sender→intent→queue→txの明示辺欠落、同一txの複数action帰属、構築失敗の結合先不明。孤立行は件数付きで残す | `g3/chain/revision_audit.py:237-259`の全件対応を支える追加検査。Senderの中間IDを検証する実装は **not found in files** |
| J06 receiptと孤立hash | BLOCKED：申告だけ/CSVだけ/receiptだけの候補hash、receipt取得不能、末尾未解決、frameが指すhashがCSVにない、候補hashの集合不一致。receipt全文なしも別不足として残す | `g3/chain/revision_audit.py:243-246,259`、委譲`:266-270`→`g3/chain/revision_replay.mjs:63`。申告の全件比較・全文検査は追加案 |
| J07 status | FAIL：候補CSVのstatusが`1/success`以外、receiptの原statusとCSVが不一致、実receiptがreverted。`mined`は現監査FAILに加え「結果未取得」をBLOCKEDへ記録し、実revert件数には断定加算しない | `g3/chain/revision_audit.py:101-104,247-250`。`mined`の生成理由は `C/realtime/coordinator.ts:2864-2871` |
| J08 block・取引内容 | FAIL：hashで一致したreceiptとCSVのblock/index/status、存在するgasUsed等が矛盾、署名内容と返却hashが矛盾。BLOCKED：blockHash/nonce/gas limit等の必要原本なし、取引形式を解読不能 | `g3/chain/revision_audit.py:243-247`はhash/statusのみ。blockHash/index/署名内容の検査は追加案。CSV列は `C/logger.ts:8-59` |
| J09 順序・時間・版 | FAIL：同じ時計の開始/終了逆転、根拠のある送信前receipt、確定したqueue順の逆転、適用版不一致、現契約の判断期限/終了時刻違反。BLOCKED：時計対応不明、版/世代/因果辺欠落。世界の違う時刻を並べない | `g3/chain/revision_audit.py:204-233,260-263`。内部queue・RPC順は追加案。`blockSeen=採掘block`や全体nonce連続を要求しない（`R/send.ts:139-170,193-194,285-290`） |
| J10 probe完全性 | BLOCKED：seq欠番/重複、登録・世代attach/exit・call終端・完了印欠落、未知世代。物理行の並びだけの違いは不合格にしない | `g3/loader/audit-records.mjs:4-37`。現`revision_audit.py`にprobe読込は **not found in files**（読込一覧`:75-81`）。frame完全性への前提として扱う |
| J11 残高・allowance由来 | BLOCKED：token/owner/spender/境界/状態または値なし、読取失敗を0扱い、異なるspenderを単一値に集約、履歴断面を実入力へ転用。FAIL：完全な由来がある値で支出超過、矛盾した値の帰属 | `g3/chain/revision_audit.py:225-242,266-270`→`g3/chain/revision_replay.mjs:17-24,49-56`。spender実アドレス/送信時点の検査は追加案 |
| J12 予約・ガス | BLOCKED：全予約の開始/解放、全action最大ガス費、既存pendingガス、予備方針・具体額がない、同nonce群未解決、単位不明。FAIL：完全な境界データで資金/ガス不足、明示的な二重計上・不正な予備値 | `g3/chain/revision_audit.py:239-242,266-270`→`g3/chain/revision_replay.mjs:17-24,51-63`。pendingGas/予備producerは **not found in files**（`G3-REQ4-FEASIBILITY-2026-10-09.md:156-162`） |
| J13 全試行・安全件数 | BLOCKED：危険試行/採掘revert/遅着submitの件数・母集合が不明。FAIL：原証拠付きの危険試行・遅着submit・実revert。単なるvalidation拒否をすべて危険と決めない | `g3/chain/revision_audit.py:248-250,257-259`。worker内の捨てた試行は通信から見えない（`R/strategyWorker.ts:62-83`） |
| J14 補助送信を含む全候補集合 | BLOCKED：起動承認/補充/派生送信元のhashが孤立、分類根拠なし、現frame契約へ忠実に対応できない。候補全hashから除外しない | `g3/chain/revision_audit.py:259`。補助送信専用の監査schemaは **not found in files**。現契約のまま架空frameを足して通さない（`G3-REQ4-FEASIBILITY-2026-10-09.md:176`） |

現監査には旧`release-r2`固定と元module再生などの未対応が残る。結合器はその問題を解消しない。現ツールへ自動入力したり、`g3-audit.json.complete=true`を発行したりしない（`g3/chain/revision_audit.py:20-45,207,254`、`g3/chain/REVISION-AUDIT.md:102-111`）。

## 3. 第2層：外部RPC proxyで通過通信だけを記録する

### 3.1 到達範囲と保存契約（設計）

接続案は `agent → 新しい受動記録proxy → 従来の接続先/gateway → ノード`。入口候補は`ERIS_AGENT_RPC_URL`で、子へ`ERIS_RPC_URL`として渡る。親botとWorkerはそれぞれclientを作る（`C/realtime/agentProcess.ts:186-192`、`R/botMain.ts:183,270-274`、`R/strategyWorker.ts:21-26`）。これは**接続・実走を行った報告ではない**。coordinatorの別経路の通信まで見える保証はない（`C/realtime/agentProcess.ts:186-192`）。

既存gatewayのアクセスログはmethod、時間、HTTP/status等で、params/resultの完全記録ではない（`ROOT/infra/rpc-gateway/gateway.mjs:513-525`）。新proxyはgatewayの前へ置く案とし、gatewayの認証・拒否・レート制限・`estimateGas`の既定block補正を変更しない。後段補正があるため、proxyで観測するのは**agentが実際に送受信した境界**であって、常にノードの未加工応答ではない（同`:445-480,483-525`）。

新規記録形式は`rpc-exchange`とし、実在する標準ファイル名とは扱わない。各記録には`captureSetId,worldId,proxyInstanceId,exchangeId,batchIndex,requestId(type,value),method,paramsRef,requestAt,responseAt,clockDomain,responseRef,httpStatus,transportOutcome,sourceRefs`を持たせる設計。`exchangeId`はHTTP要求ごと、`batchIndex`はその要求内の要素ごとに採番し、JSON-RPCのIDだけを全体キーにしない。要求のID型を保存し、応答配列の位置ではなく同じexchangeの型付きIDで照合する。同一batch内のID重複は曖昧としてBLOCKED。SDKはHTTP再試行とJSON-RPC一括化、Multicallによる契約読取の集約を行うため、この区別が必要（`S/chain.ts:29-30,40-43,62-75`）。

将来の保存名の案は`rpc-capture.jsonl`とする。要求/応答を別の連番付き行として記録し、許可された`method,params,result,error`と署名済み取引のbytesはその行に保持する。`paramsRef/responseRef`はこの原本行を指す。receiptも通過応答の一種として同じファイルに残し、独立した既存receiptファイルを仮定しない。HTTPヘッダや資格情報を含むURLは保存しない。要求だけ・応答だけ・保存不能も明示し、完了行と独立transport台帳で件数を検査する案である。完全な既存RPC記録器は **not found in files**（`G3-REQ4-FEASIBILITY-2026-10-09.md:59-61`）。

| 通過時に見えるもの | 取得後にできること | 限界・根拠 |
|---|---|---|
| 既存の`eth_getBalance`、`eth_call`の要求/成功結果/エラー | 残高・allowanceならtoken/owner/spender、指定blockを復号し`ValueEvidence`に保存。Multicallなら外側要求と内部call順を両方保持 | 実`getBalances`はblock固定でない（`S/chain.ts:144-190`）。通信にframe/routeがないため、どの判断の実入力かは未結合。全高水準read履歴の代用にはしない（`G3-REQ4-FEASIBILITY-2026-10-09.md:65,69,124`） |
| `eth_sendRawTransaction`等の署名済み取引と応答 | オフラインでhash、送信元、nonce、宛先、value、入力、gas limit、feeを復号する案。返却hashと比較し、第1層のhashへ結合 | gatewayも署名済み取引のgasを読む（`ROOT/infra/rpc-gateway/gateway.mjs:179-213`）。応答喪失時の計算hashは送信内容の識別であり受理証明ではない（`G3-REQ4-FEASIBILITY-2026-10-09.md:66`） |
| 既存のreceipt要求/結果 | `transactionHash,blockHash,blockNumber,transactionIndex,status,gasUsed,effectiveGasPrice,logs`が応答にあれば原本参照で保持 | Senderが既に要求した範囲だけ（`R/send.ts:490-509`）。ringから未解決も脱落し得る（同`:173-181`）。coordinator経路の全文捕捉は保証しない |
| 既存のnonce/block/gas見積要求と結果 | Senderが見た返答や失敗分岐の資料を残せる。最終署名内容と区別する | nonce cache、見積失敗時の固定gas、送信例外時のcache破棄がある（`R/send.ts:139-166,196-290`）。見積結果を最終gas limitに置換しない |

**転送の制約（提案）：** proxy自身の追加read・再試行・再送・キャッシュ・batch再編・ID変更は行わない。各受信HTTP要求を従来接続先へ一度だけ委譲し、要求/応答/エラーの意味と到着順を保つ。SDK自身が再試行したときは別exchangeとして記録する。元から並行な要求をproxyが直列化しない。型/復号不能や記録欠落は証拠のBLOCKEDとし、proxyに新しい取引拒否制御を足さない。既存方針の根拠：`G3-REQ4-FEASIBILITY-2026-10-09.md:196-198`、`G3-SUCCESS-PLAN-2026-10-09.md:51,58`。

記録のために送信を待たせず、転送から重い復号・hash計算を外す設計を検討する。ただし有限bufferからの欠落、書込失敗、proxy停止、同期/非同期どちらの遅延も測定対象である。記録保証と追加待ちを同時に解消した実装・数値上限は **not found in files**。オフラインfixtureの一致だけで「実挙動不変」とはしない（`G3-SUCCESS-PLAN-2026-10-09.md:53-58`）。

保存は許可フィールドだけに限定し、秘密鍵、認証ヘッダ、接続先の資格情報、全環境変数を含めない。エラー本文や任意paramsにも秘密が混ざり得るため、許可できない内容は転送を変えず記録側を欠落扱いにする提案。秘密を削った応答を「完全な原応答」と表示しない。署名済み取引も再送可能なデータとして保存範囲を明示し、再送機能を付けない。資格情報がHTTP transportへ入る位置：`S/chain.ts:45-66`。既存probeの保存対象制限と秘密検査の限界：`g3/loader/README.md:30-33,168`。

### 3.2 run中に追加してはいけない読取

**設計では、balance/allowanceの補完、追加nonce取得、gas見積、receipt追跡、block/log照会をrun中に新規発行しない。** 読取そのものはnonceを消費しないが、通信増加・待ち・再試行・block進行が既存Senderのnonce観測、fee、包含順、期限判定を変え得る。送信を保持して読んでも、並列に読んでも「実境界と同じ状態」とは保証されない（`G3-REQ4-FEASIBILITY-2026-10-09.md:71-77`、`R/send.ts:139-166,196-290`）。

`pending`残高/allowanceによる予約推定も採用しない。gatewayは`eth_getTransactionCount`以外のpending指定を拒否し、省略された`eth_estimateGas`のblockをlatestへ補う。追加の重い読取はレート制限にも影響する（`ROOT/infra/rpc-gateway/gateway.mjs:132-175,465-480,504-510`）。予約の内部台帳は別物であり、gatewayを変えたり迂回したりして補わない（`G3-REQ4-FEASIBILITY-2026-10-09.md:138-144`）。

### 3.3 終了後の状態再構成という別成果物

将来案は、停止済みrunの未解決hash・必要token/owner/spenderを第1層で列挙し、**履歴が保持され、他の測定と資源を共有しない条件でのみ**別工程としてreceipt・block・確定block断面を読むこと。今回この工程は実施しない。既存評価再構成にも、reset前の履歴読取とblock指定Multicallがある（`C/realtime/reconstruct.ts:1-10,320-327`）。現在のノードの履歴保持量・使える実行窓は **not found in files**。保持を前提にrunのresetを勝手に遅らせる設計にもしない。

設計手順は、(a) world/chain実体とblock hashの同定、(b) hash指定receiptと対応blockの取得、(c) 必要な確定blockの残高/allowance読取、(d) 要求・結果・失敗・取得日時・原runとの関係を独立保存、(e) 第1層へ`inputs.capturePhase=post_run`として追加、である。後日取得したreceiptは後日の原観測として残し、履歴残高は`boundary=historical_block`、計算で導いた値だけ`availability=derived`とする。履歴不在はBLOCKEDのまま、latestへの代替はしない。原runの既存値を書き換えない（`G3-REQ4-FEASIBILITY-2026-10-09.md:180-190`）。

block Bの状態はB内の全取引後、B−1はB内の先行取引を含まない。各tx直前状態が必要なら、親blockの状態と全取引順・実行条件を用いる別の状態再実行が必要となるが、その要件4向けproducerは **not found in files**。仮に再構成できても、当時の`latest`応答、Worker内buffer、送信前queue、実予約・破棄試行の実測へ格上げしない。現`revision_replay.mjs`は保存した高水準readを返す判断再生であり、チェーン状態の再実行ではない（`G3-REQ4-FEASIBILITY-2026-10-09.md:184-188`、`g3/chain/revision_replay.mjs:71-85,114-139`）。

## 4. 要件4の小項目別の取得可否

「部分」は欄の一部または過去断面のみ取得できるという意味で、要件充足ではない。第1層は**現在の標準ファイルと現probe**、第2層は**追加readなしの将来proxy**を指す。第2層が保存したものを後で第1層が読む場合も、採取元は第2層と明記する設計。判定基準は `G3-PREREQ-2026-10-07.md:78-81`、`g3/chain/REVISION-AUDIT.md:60-75`。

| 小項目 | 第1層 | 第2層 | 取得できない部分・理由、残す状態 |
|---|---|---|---|
| token残高・ガス用ETH残高 | 実境界値は取得不可。再構成評価値は残高frameではない（`C/realtime/reconstruct.ts:1282-1306`） | 部分：既存readの実応答。block固定なし、判断への結合なし（`S/chain.ts:144-190`） | 全判断/送信境界は **not found in files**。判断時残高はqueue後残高でない（`R/botMain.ts:626-636`）。null＋境界未結合 |
| token・owner・spender別allowance | 取得不可。承認成功申告はその時点の値を保存しない（`R/botMain.ts:587-602`） | 部分：起動時のallowance readが通れば取得可能（同`:559-585`） | 各action境界の値は **not found in files**。同じtokenでも複数承認先がある（`S/protocols/uniswap.ts:1694-1705`、`S/protocols/curve.ts:599-619`）。エラーを0、別spenderを同じ値にしない |
| `pendingReservations`：未送信・未包含のtoken予約 | 部分：申告hashからCSVに見えない集合まで。金額全量は不可（`R/send.ts:278-284,359-373`） | 部分：通った署名txの未解決集合まで | Worker/queue/build失敗/破棄分が見えず、予約台帳producerは **not found in files**（`G3-REQ4-FEASIBILITY-2026-10-09.md:138-144`）。部分集合のamount合計を予約値にしない |
| feeと`maxGasCostWei`：判断全actionの最大ガス費 | 部分：CSVのfeeとgasUsed。gas limitではない（`C/logger.ts:29-45`） | 部分：署名済みtxの最終gas limitとfee。対応する上限費用を導出可能な形式に限る（`R/send.ts:196-259`） | 未構築action、複数txの帰属が未解決。全判断の最大値は **not found in files**（`G3-REQ4-FEASIBILITY-2026-10-09.md:148-154`）。実使用費と最大費を分ける |
| `pendingGasWei`：既存未完了分のガス費予約 | 全量取得不可 | 部分：観測済み署名txの上限費用まで | 未署名queueと全解放が欠ける。`gasByRound`はgas量で通貨額ではない（`R/send.ts:102-105,235-263`）。全量producerは **not found in files**（`G3-REQ4-FEASIBILITY-2026-10-09.md:156-162`） |
| `gasReserveWei`：維持すべきガス予備額 | 取得不可 | 取得不可 | 実方針とproducerは **not found in files**。補充targetは予備保証ではない（`R/send.ts:407-425`、`G3-REQ4-FEASIBILITY-2026-10-09.md:158-162`）。正数を後付けしない |
| receipt・包含block/index | 部分：CSVの採掘行と申告hashを結合 | 部分：通過したreceipt全文、署名txとの結合 | 全receipt、block hash、末尾未解決と全frame帰属は不足。ring脱落・別通信経路がある（`R/send.ts:173-181,490-509`、`C/realtime/agentProcess.ts:186-192`）。取得不能をrevert/成功/未採掘確定にしない |
| events/blocksと全判断・全attemptの対応 | 部分：hash/roundの対応と現probe内部のIDだけ | 部分：通信のhash/receiptまで | 完全なframe/attempt producerは **not found in files**（`g3/chain/REVISION-AUDIT.md:69-75`）。実版・高水準read・破棄submit・補助送信帰属は別に不足（`G3-B03-B04-PATHS-2026-10-10.md:15-18,26-27`） |
| `unsafeAttempts/minedReverts/lateSubmits`と完全性 | 部分：実revertのある採掘行は検出可能。全件ゼロの証明は不可 | 部分：見えたreceiptのrevertまで | 通信へ出ない試行、欠落したログの母集合がない。全件producerは **not found in files**（`R/strategyWorker.ts:62-83`、`R/strategyRunner.ts:139-163`、`R/agentLog.ts:107-131`）。unknownを0にしない |

将来、監査側に予約の導出台帳を作る場合も、予約開始・解放を示す全原観測が必要である。開始を「queue登録」、解放を「包含/確定拒否」とするだけでも、部分構築、同nonceの別hash、応答喪失、終了時未解決、補助送信の扱いを先に定義する必要がある。観測済みtxの部分台帳だけを全予約へ昇格しない。完全producerは **not found in files**（`G3-REQ4-FEASIBILITY-2026-10-09.md:142-144,160-162`）。本書は候補の制御や予備方針を新設しない。

計算する場合の設計は、対応する署名形式を解読できたtxについてのみ`gasLimit × 署名上限単価`を個別の最大費用として導出し、原フィールドと式を残すこと。全action/全txの対応が閉じてから判断単位へ集計し、同nonceの別hashを単純合算しない。現監査へ対応する式は`ethWei - maxGasCostWei - pendingGasWei >= gasReserveWei`で、予備と今回最大費用には正値を要求する。内部予約・予備方針が不明なら式の入力を埋めずBLOCKEDとする（`G3-REQ4-FEASIBILITY-2026-10-09.md:148-162`、`g3/chain/revision_replay.mjs:60-63`）。

## 5. SYNTHETIC fixtureによる試験計画（未実行）

すべてを`evidenceClass=SYNTHETIC`に固定する。合成識別子・注文・CSV・JSONL・擬似通信を使い、鍵、実ノード、実署名送信、モデル、実Worker、実時計待ちは使わない設計。以下の「正対照」は**検査が確実に発火する既知の故障入力**、「mutant」は検査や結合処理を意図的に壊した版を意味する。正常入力も対にし、故障対照が指定のcode・対象key・原本行で落ち、正常入力は当該理由で落ちないことを確認する。終了値だけの確認にしない。検査手法の基点：`g3/loader/README.md:113-145,149-152`。

fixtureの期待集合は結合器から逆算せず、手書きの期待キー・辺・件数を別に置く。正常fixtureに無取引、元版、同じ注文をsubmit/returnの両方から出す例、1注文の複数tx、補助送信、同nonceの別hash、再読取を含める。架空の完全fixtureでschemaを試す場合と、標準ログ相当の欠落fixtureがBLOCKEDになる場合を分ける。実完全性の証拠に転用しない（`G3-SUCCESS-PLAN-2026-10-09.md:51,55`、`g3/chain/REVISION-AUDIT.md:74-75`）。

### 5.1 第1層：各検査の正対照とmutant

| 対象 | 正対照：故障fixture → 必須の検出 | 正常側／mutantの例 |
|---|---|---|
| J01 | 必須ファイル不在、末尾改行切除、壊れた行、cap印、終了印削除/重複、segment欠落、digest改変を個別に作る → 原本位置付きBLOCKED | 正常な原本集合。mutant：欠落時に空配列を返し成功扱い、cap検査削除、digest不一致無視 |
| J02 | 同じhashを別worldへ配置、probeを別runに割当、owner不一致 → world欠落BLOCKED/明示矛盾FAIL | 同じhashでも別worldでは結合しない。mutant：worldをhash索引キーから削除、owner比較削除 |
| J03 | CSV同一行重複、同一hashでstatus違い、同一block/indexへ別hash、frame/attemptキー重複 → 重複理由付きBLOCKED、矛盾ならFAILも | receiptの別exchange再読取は別観測として許す。mutant：検査前にhash辞書へ格納して上書き |
| J04 | frame/開始イベント/attemptを片側だけ削除、route変更、ordinal交換、action本文改変、noop/v0脱落 → 被覆BLOCKED | 同じaction hashでも両routeを別試行として保持。mutant：hash集合だけで比較、noop frameを除外 |
| J05 | 明示的なqueue→tx辺削除、同一txを別actionにも帰属、build失敗を次の成功へ接続 → 帰属BLOCKED | 1 action→複数txは正常。mutant：blockSeen・金額・時刻の近さだけで自動結合 |
| J06 | 申告/CSV/receiptをそれぞれ単独で残す、末尾送信のreceiptを削除 → 種別別の未解決集合とBLOCKED | 全端点が揃ったhash。mutant：inner joinで孤立行を捨てる、receipt不在を未採掘確定へ変える |
| J07 | `reverted`、`mined`、未知status、receipt/CSVの原status不一致を別例で注入 → 前表どおりFAIL、minedには欠測理由も残る | 同じ成功原値。mutant：`mined`を成功へ変換、truthyなstatusを成功扱い、表示正規化で監査差を消す |
| J08 | hash返答不一致、receiptのblock/index/gasUsed改変、必要なblockHash削除 → 矛盾FAIL/欠落BLOCKED | 異なるblockの同じtxIndexは正常。mutant：hashだけ見て残りを検査しない、gasUsedをgas limitへ代入 |
| J09 | 同時計の終了<開始、実適用とframe版不一致、明示queue辺逆転、既存契約を超す判断終了 → 対象を特定してFAIL。時計対応なしはBLOCKED | 別送信元のnonce逆転、包含順と全体送信順の違いだけでは落とさない。mutant：全記録をtsでソートし原順序消失、期限/版検査削除 |
| J10 | seq欠番/重複、attach/exit/終端/完了印を1種ずつ削除、未知世代 → 該当probe理由でBLOCKED | seqと内容は同じで物理行だけ交換した例は正常。mutant：物理行をseqとみなす、世代登録/完了検査削除 |
| J11 | allowance読取失敗、spender違い、境界なし、履歴値をsend値へ誤分類、合成の支出超過 → 欠測BLOCKED/証拠付き超過FAIL | 原応答の実測0と、値なしを別に扱う。mutant：`missing ?? 0`、spenderをキーから除去、observationをlatestで置換 |
| J12 | 予約解放削除、同nonce群を二重加算、複数txでaction元本を重複加算、予備方針削除、合成のガス余力不足 → BLOCKED/明示計算矛盾FAIL | 原観測付き予約ライフサイクル。mutant：pendingGasを0、補充targetを予備に使用、1本の最大費用を判断全体へコピー |
| J13 | 隠れたsubmit試行を母集合にだけ残す、故意のunsafe/late/実revertを記録、件数だけ0へ改変 → 不足BLOCKED/原証拠付き違反FAIL | 全原観測から導出した件数。mutant：CSVだけから全安全件数を0にする、拒否行を無条件に捨てる |
| J14 | 起動承認/補充/派生送信元のhashを候補集合から削除、架空frameへ割当 → BLOCKED | 部分報告では補助送信を独立保持し、監査への未対応も残す。mutant：`gasRefill`を除外、未知hashを最後のframeに付与 |

### 5.2 第2層：通信記録部分の正対照とmutant

以下も未実行の設計。固定の擬似transportは受け取った要求列を独立保存し、応答/エラー/応答喪失を予定どおり返す。元の要求を一度だけ渡すこと、追加readなし、意味変更なし、秘密非出力を検査する範囲は `G3-REQ4-FEASIBILITY-2026-10-09.md:196-198` に対応する。

| ID・検査 | 正対照と必要な結果 | mutant |
|---|---|---|
| P01 委譲回数 | 擬似transportの受信台帳に観測器起因の追加read/retry/二重送信を注入 → `EXTRA_FORWARD`のFAIL。client自身の再試行は独立exchangeとして正常保存 | エラー時にproxyが自動再試行、記録用getBalanceを追加 |
| P02 要求・応答・エラー保存 | params、ID型、応答body、HTTP status、エラーを個別改変 → `WIRE_CHANGED`のFAIL。応答なしはそのまま未完了BLOCKED | stringifyでID型を統一、errorを成功resultへ変換、null receiptをsuccessへ変更 |
| P03 batch/Multicall対応 | 別接続の同じID、応答順逆転、同一batch内ID重複、内部call欠落 → 逆順は正しく結合、曖昧/欠落はBLOCKED | IDだけで全体辞書化、応答配列位置で結合、Multicallの先頭結果を全callへ配布 |
| P04 raw tx/nonce | 同じrawの再試行、同nonceの別hash、返答hash不一致、応答喪失 → 再試行を残し二重計上なし、置換候補群保持、矛盾FAIL/喪失BLOCKED | nonceをtx一意キーにする、返答がないrawを捨てる、計算hashを受理成功扱い |
| P05 終端・保存失敗 | 記録の欠番、片側応答/要求、完了印削除、保存失敗を注入 → `CAPTURE_INCOMPLETE`のBLOCKED。転送結果は擬似対照と同じ | 記録失敗を黙殺してcomplete、保存のために送信を中止/応答を変更 |
| P06 秘密 | 合成秘密をヘッダ、URL、任意params、errorへ置く → 保存先・標準出力・標準エラーに秘密なし。安全に残せない本文は欠落を表示 | headers/env/error全体をdump、secretを除いたのに完全原本扱い |
| P07 順序と余分な待ち | 擬似スケジューラで並行要求・遅い記録器を再現 → 余分な直列化・順序変更は`ORDER_CHANGED`のFAIL。測定していない実遅延は未検証のまま | 書込完了をawaitしてから転送、全要求を単一queueへ、応答をID順へ並べ直す |

変異試験は将来の一時領域の検査コピーに対して行う提案であり、現runtime・gateway・監査器を変更しない。各mutantで対応する正対照が失敗すること、無変更版の正常側が通ることを対で残す。合成試験では実時間の低干渉は証明できず、成功計画の無計装/計装比較は未実施のまま残る（`G3-SUCCESS-PLAN-2026-10-09.md:53-58`）。

## 6. 最小の最初の実装工程と出口（提案のみ）

**最初は、SYNTHETIC原本だけを読む小さな事後結合器を作る。** 範囲は`summary.json / events.jsonl / agents/cand.jsonl / blocks.csv`の読取、hashごとの外部結合、J01〜J03・J06〜J08・J14、未解決一覧の出力まで。実run、proxyサーバ、loader、Sender、現監査器へは接続しない。これは既存の「非送信proxy記録＋fixtureのmempool/blocks結合」案のうち、先に結合契約を確定する部分である（`G3-REQ4-FEASIBILITY-2026-10-09.md:196-198`）。

実装の入口は明示した入力一覧と出力先だけを受け、入力を読取専用で扱う案。通信・subprocess・runtime importなしで、CSV/JSONLの解析と集合照合だけを行う。出力は§2.3の該当欄と不足理由で、まだ実装しない検査は`not_evaluated`として列挙する。全体判定をCONSISTENTへ誤昇格させない。この範囲を選ぶ理由は、標準producerのあるhash/CSV部分と、producerのないframe/queue部分を小さく分離できるため（`R/send.ts:278-284`、`C/logger.ts:8-59`、`G3-B03-B04-PATHS-2026-10-10.md:18,25-27`）。

出口は次の全項目とする設計。

1. 合成の成功hashは対応行が1件、孤立・重複・status不明/不一致は原本行付きで残る。inner joinによる脱落がなく、期待集合と件数が一致する。
2. 対象J検査の正常側・正対照・mutantが、§5.1の指定理由で通る/落ちる。実行した検査数・失敗・未実装範囲をその時の証拠に残す。今回は結果を先取りしない。
3. 標準ログ相当のfixtureでは、action→Sender→tx、receipt全文、全経済値、全試行、採取由来の不足がBLOCKEDとして残る。未知を0/trueにしない。
4. 補助送信を候補集合から落とさず、現frame契約への未対応を明示する。`g3-audit.json`や監査frameの合格用データを生成しない。
5. 全入力の不変、出力の決定性、合成秘密の非出力を確認する。ネットワーク・取引送信・モデル呼出の入口を持たないことをレビューする。

これらは**部分結合器の出口**であり、B04の出口ではない。次の設計対象は擬似transportによるP01〜P07、続いて未取得の内部境界と経済値のproducerである。実装完了工数・挙動不変の証拠・全量producerは **not found in files**。現ゲート・開始条件・B03の扱い・調査期間を変更しない（`G3-SUCCESS-PLAN-2026-10-09.md:52-58,75,84-86`、`DECISIONS-2026-10-10.md:12-16`）。

## 7. 今回の読取と検証の限界

本節は本作業の実施記録。最初に`G3-SUCCESS-PLAN-2026-10-09.md`を読み、関係する行を再読した。続いて`G3-REQ4-FEASIBILITY-2026-10-09.md`、`G3-B03-B04-PATHS-2026-10-10.md`のB04行、`g3/loader/README.md`、`DECISIONS-2026-10-10.md`、`G3-PREREQ-2026-10-07.md:69-82`を読んだ。具体的な根拠行は本文各節に記載した。

追加で静的に読んだ範囲は、`g3/chain/revision_audit.py`の読取・frame/receipt監査・判定、`g3/chain/revision_replay.mjs`の経済値/読取再生、`g3/chain/REVISION-AUDIT.md`の契約、`g3/loader/probe-loader.mjs`・`probe-io.mjs`・`audit-records.mjs`、`R/send.ts`の送信/補充/receipt、`R/agentLog.ts`、`R/botMain.ts`のclient/履歴/承認/判断/改訂log、`R/strategyWorker.ts`・`R/strategyRunner.ts`の判断通信/期限、`R/read.ts`の残高読取、`S/chain.ts`のclient/残高、Uniswap/CurveのsetupWallet、`C/logger.ts`、`C/realtime/agentProcess.ts`のRPC入口、`C/realtime/coordinator.ts`のCSV/summary/終了、`C/realtime/reconstruct.ts`の履歴読取/再構成event、`ROOT/infra/rpc-gateway/gateway.mjs`の制限/転送/logである。全文を読んでいないファイルは本文の関連範囲に限定する。

否定検索は`R/`、`S/`、`C/`、`g3/loader/`でreceipt/mempoolのJSON出力、`g3_decision_started`、`g3_action_attempt`、`pendingReservations`、`pendingGasWei`、`gasReserveWei`、`audit-frames`を対象に実施した。mempoolがagent JSONLに入る説明以外、完全producerの該当は **not found in files**。名称検索だけに依存せず、上記の送信・保存経路を照合した。過去メモの初期検索に今回の判断へ使える記録はなく、根拠には使用していない。

作業開始時の読取Gitはbranch `docs/g3-b04-1010`、HEAD `87a100537e9539de13974382b30147c9136002c8`、`git status --short --branch`に変更行なし。これは本作業のコマンド結果であり、remote最新確認ではない。書込み対象は本書のみ。作業条件の2時間上限を他工程の調査延長・実走許可と解釈しない。

**未検証：** 型検査、テスト、ビルド、Nodeスクリプト、モデル呼出、バックテスト、Docker、Anvil、遠隔接続、ネットワーク、commit/pushは実施していない。特定runの原本照合、receipt補完、proxy試作、SYNTHETIC試験・変異試験、実測中の別ホストの状態/結果、全経済値の取得、実行挙動の同等性も未検証。実装・計測・合格の数字は報告しない。現存資料の過去のテスト結果は今回の結果へ転用していない。

空白検査の実施記録：`git diff --check -- ascon-notes/league/G3-B04-CAPTURE-DESIGN-2026-10-10.md`は終了0。未追跡ファイルの本文を含む`git diff --no-index --check /dev/null ascon-notes/league/G3-B04-CAPTURE-DESIGN-2026-10-10.md`は空白エラー出力なし・終了1（新規差分あり）。通常のdiffだけでは未追跡本文を検査できないため、両方を実行した。最終版にも同じ検査を行う。これらは型検査や設計の実証ではない。変更確認の`git status --short --branch`は本書の未追跡1件だけだった。
