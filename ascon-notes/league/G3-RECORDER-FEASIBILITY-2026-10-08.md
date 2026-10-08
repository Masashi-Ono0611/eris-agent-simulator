# G3 実改訂recorderの実現性 — 2026-10-08

**結論: PARTLY。** 標準runtimeのファイルを変えずに、モデル交換、呼出開始とcall blockの結合、既存ログの保存・digest、送信済み取引とreceiptの一部は外部収集できる。ただし既存の環境変数フック・ログ・Remote Procedure Call（RPC、遠隔手続呼出）だけでは、**実setSource時刻と初回判断、全判断の完全frame、return/submit別の全attempt、判断境界の予約・ガス・allowance、遅着適用なしと復帰後実行**を揃えられない。完全なG3（Gate 3、自己改訂の実チェーン受入れ判定）recorderの成立は認定しない。

根拠となる5要件は `ascon-notes/league/G3-PREREQ-2026-10-07.md:71-81`。以下は実コードを読んだ実現性判定であり、live実測ではない。「取得可能」は既存境界に外部collectorを実装できる根拠があること、「取得不可」は調べた公開経路から必要情報を復元できないこと、「不明」は別の計測方法の実証がないことを意味する。任意のデバッガやメモリ計測まで不可能だとは断定しない。

## 調査対象と表記

- 作業場所: `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/g3-recorder-feas`。
- ローカル確認時のbranch: `docs/g3-recorder-feasibility`。HEADとローカル`origin/main`はいずれも `1bb0fc7eb61e935dc2c74f2f1d828bbb9d9aa316`。開始時の作業ツリーはclean。fetchしていないため、これはリモート最新状態の主張ではない。
- 対象はこのtreeのTypeScript版標準runtime。候補r3への切替後もchain資料のsource-view・eval・replay・manifestは未更新と明記されている（`ascon-notes/league/g3/chain/README.md:1-8`）。過去のec80bb8/r2実測を今回のtreeの実測として使用しない。
- 以下の短縮パスは、`R/` = `example/agents/runtime/`、`G/` = `ascon-notes/league/g3/`、`C/` = `ascon-notes/league/g3/chain/`。すべてこのcommitのリポジトリ相対パスと行番号を指す。
- CLIはCommand Line Interface（コマンドライン実行形式）、LLMはLarge Language Model（大規模言語モデル）、PIDはProcess Identifier（プロセス識別番号）、JSONLはJavaScript Object Notation Lines（1行1記録）、SHA-256はSecure Hash Algorithm 256-bit（256ビットの内容ハッシュ）。SDKはSoftware Development Kit（ソフトウェア開発キット）、APIはApplication Programming Interface（プログラム間の呼出境界）、CSVはComma-Separated Values（カンマ区切り形式）。WETHはWrapped Ether（Etherをトークン化したもの）。tsはtimestamp（時刻）、IDはidentifier（識別子）。frameは1判断の入力・出力・実行情報をまとめた監査記録。

## 判定一覧

| 要件 | 取得可能な部分と正確な入口 | 残る欠落・判定 |
|---|---|---|
| 1. world/mode/case、期待件数、digest、開始ts/PIDと実call block | 外部launcherの設定・終了済み成果物、`ERIS_CLAUDE_BIN`のargv、`.llm`/採否ログ。call contextの先頭に実call blockがある | **部分可能**。全判断の期待件数・firstObservationRound・欠測なしは独立に証明できない。HTTP経路はCLI開始/PID形式と契約が合わない |
| 2. 実setSourceのts/hash/version/初回decision ID | `.llm`のsource、採否ログのversion・revert先、任意の永続state | **完全取得不可**。setSource時刻と初回worker判断IDの外部hookは not found in files |
| 3. noop/v0を含む全判断、worker世代、時刻、read transcript、return/submit | 一部noop/失敗ログ、RPC通信、component harnessでの戻り値・submit | **完全取得不可**。実workerの入力・開始完了・世代・両経路・高水準read呼出を外部ログに出すhookは not found in files |
| 4. 実取引境界の残高・allowance・予約・ガス・receiptと完全対応 | `ERIS_AGENT_RPC_URL`のRPC proxy、mempoolログ、`blocks.csv`とreceipt取得 | **部分可能**。送信前拒否・queue・buffer、全attemptの経路、境界時点の残高等が欠ける |
| 5. 実300秒timeout、子終了、遅着適用なし、持越し・復帰 | CLI子の開始記録・外部監視、標準timeout error、stateファイル・resume/outcomeログ | **部分可能／live不明**。独立controlは存在するがliveな適用・worker状態・v0実行の証拠にならない |

一覧の各判定のコード根拠と未取得証拠を以下に記す。

## 1. 呼出の識別・件数・digest

**CLI経路ではcall block bindingを新規外部wrapperで取得可能。** `botMain.maybeRevise(block)`が`buildRevisionContext({block,...})`を作り、そのcontextを唯一のuser messageとして`callLlmWithUsage`に渡す（`R/botMain.ts:1009-1041`）。context先頭は文字列`block: ${opts.block}`である（`R/improve.ts:690-693`）。Claude CLIでは単一messageを変更せず平坦化し、`-p`の引数に渡し、systemは`--append-system-prompt`で別に渡す（`R/llm.ts:443-452,490-505,583-600`）。したがって**同じwrapper入口でargvのcontext先頭block、開始ts、自身のPIDを記録してから同じargvでexecする**設計には根拠がある。チェーンの最新blockを呼び直す推定は不要であり、代替にもならない。

既存の正確な差替え入口は`ERIS_CLAUDE_BIN`、Codex CLIなら`ERIS_CODEX_BIN`（`R/llm.ts:587-610`）。Codexはsystemとcontextを1文字列に結合するため、Claudeと同じargv解析を流用せず結合形式を扱う必要がある（`R/llm.ts:508-522,607-610`）。モデルprovider選択はmodel名で行われ、`claude-cli:haiku`がCLIを選ぶ（`R/llm.ts:169-184,199-208`）。環境変数はcoordinatorから`ERIS_*`として引き継ぎ、rosterの`spec.env`で上書きできる（`core/src/realtime/agentProcess.ts:159-178`）。

**現wrapperはbindingを保存していない。** `ascon-notes/league/xb-r-live-claude-timed.sh:11-25`は`ERIS_RUN_DIR/agents/<id>.cli-timing.jsonl`にts/agentId/PIDのみ記録し、最後に`exec claude "$@"`する。PIDは記録用Pythonから見た親shellのPIDで、exec後のCLIと同じになる設計。block/一意call ID、応答全体、子終了記録は not found in files。この開始ログはstock `llm.ts`の自動出力ではない。`G/ref-on.yaml:31-33`がこのwrapperを選択し、fault用`G/fault-timeout.yaml:31-33`は別のfakeを選択するため、fault経路には同じ開始記録が自動で付くと仮定できない。

**標準ログのtailで応答と採否は収集可能。** `ERIS_IMPROVE_LOG_CALLS=1`が`.llm`記録を有効にし（`R/botMain.ts:775-785`）、応答時にblock/model/system/context/rawまたはerrorを記録する（同`:1033-1067`）。採否は`round:block`、`reason:"revision ..."`、`state`になる（同`:960-967`）。ただしCLIの`raw`はCLI stdoutそのものではなく、最初のJSON objectを抽出して再直列化した値。非JSON出力のerrorは先頭200文字だけなので、不正応答の全文は別の取得が必要（`R/llm.ts:569-580`）。単純exec wrapperはstdoutを透過できるが自分ではその後の全応答を保存できず、tee目的の子孫追加は要件5のkill対象を変える。

**HTTP（Hypertext Transfer Protocol）経路にも入口はあるが、現在の監査契約へそのまま接続できない。** `ERIS_INFERENCE_BASE_URL`はHTTP provider共通proxy入口で、OpenAIは`/v1/chat/completions`、Ollamaは`/api/chat`、AnthropicはSDKの`baseURL`へ渡る（`R/llm.ts:154-167,211-239,269-304,342-388`）。外部proxyはrequest bodyのmodel/system/contextとresponse bodyを保存できる設計。ただしCLI providerはここを通らない（同`:199-208`）。監査器は`cand.cli-timing.jsonl`と`kind:cli_call_started`、ts/PIDの結合を要求する（`C/revision_audit.py:75-85,115-140`）。HTTP requestにはCLI子PIDがないので、架空PIDを埋めてPASSにしない。HTTP試行と論理revision callの対応、retry数・timeout時の上流終了は今回未実測。

**manifestの作成自体は外部処理で可能。** worldIdはsummaryと整合、mode/caseはlauncher設定に結合し、終了後の全対象ファイルにSHA-256を付けられる。監査器はファイルをread/hashし、world完了・meta・件数・digestを照合する（`C/revision_audit.py:56-118`）。既存`revision_exchange.mjs`も3ログの原文とdigestを保存するが、世界全体のrecorderではなく、結果は常に`g3Status:BLOCKED / liveRecorderVerified:false`（`C/revision_exchange.mjs:11-40,134-138`）。

**不足:** `expectedCalls`はwrapperの開始全件と応答・採否を突合できるが、`expectedFrames`を観測済み行数から自己申告しても全判断の独立な期待件数にはならない。`firstObservationRound`も最初のcall blockから60を引いて捏造できない。判断中は次のinvokeがskipされ、内部workerにはbackoffもある（`R/botMain.ts:623-625`、`R/strategyRunner.ts:173-189`）。ログは行上限で原文を置換、総量上限で停止し、書込例外を無視する（`R/agentLog.ts:78-131`）。従って終了前hash、欠測・切詰めの黙認、順番だけのbindingは認定不可。監査器も切詰め・不完全bindingをBLOCKEDにする（`C/revision_audit.py:61-66,115-140`）。

## 2. 実setSourceと最初の適用判断

**取得可能:** `.llm.raw`から提案sourceのhash、installed採否からversion、reverted採否から復帰先を取得できる。installはsource/versionを構築して`strategy.setSource(installed.executor)`し、その後persist・採否記録。revertも`strategy.setSource(target.executor)`後に採否記録する（`R/botMain.ts:1105-1132,1151-1175`）。ただしreverted記録は`to/from`であり、installedと同じ`state.version`が常にあると仮定しない。

**取得できない:** 正確なhookが必要な位置は`StrategyRunner.setSource`、`start/spawn`、`decide`だが、`setSource`は単に`this.source = source`するだけで時刻・hash・version・IDを出力しない（`R/strategyRunner.ts:61-94`）。実行中の判断は旧workerで完了し、次の`start()`でsource差を検出してworkerを破棄・生成する。判断IDは内部で増加しpostMessageへ渡る（同`:187-205`）。`installedAtBlock`は`maybeRevise`引数のcall blockであって、完了時blockではない（`R/botMain.ts:973,1113,1157`）。

外から分かるのは応答ログと採否ログの間という範囲だけ。ログのtsもappender呼出時に付く値である（`R/agentLog.ts:108-127`）。採否tsやファイル更新時刻をsetSource実時刻に置換してはいけない。RPC取引がないnoopもあり、最初の取引を初回判断とみなせない（`R/botMain.ts:643-653`）。**実setSource tsとfirstDecisionIdを得る既存外部hookは not found in files。**

**不足:** 監査器が要求する`applications[{callBlock,version,ts,sourceSha256,firstDecisionId}]`の実測、および旧判断と新versionの境界（`C/revision_audit.py:204-211,229-233,260-263`）。sourceを再compileできても採用済みworkerがそのsourceを実行した証明ではない。

## 3. 全判断frameとread transcript

**内部には必要情報の一部があるが、外部へ出ていない。** 観測は`Reader.snapshot`で残高・venue状態・履歴から組み立て、clock/epoch/discoveryを追加し（`R/read.ts:140-211`）、botMainがcompetition情報を足す（`R/botMain.ts:676-684`）。`StrategyRunner.decide`が実際の観測と内部IDをworkerへ送り、workerは`submit`と`result`を別メッセージで返す（`R/strategyRunner.ts:187-205`、`R/strategyWorker.ts:47-83`、`R/strategyProtocol.ts:27-37`）。これは**botMainとworker threadの間**の通信であり、coordinatorの子プロセス標準出力ではない。coordinatorはstdin/stdoutをignoreしてspawnする（`core/src/realtime/agentProcess.ts:243-251`）。

**ログから取れるのは一部の結果。** noop、decide error/timeoutはroundと理由が記録される（`R/botMain.ts:639-662`）。submitは内部bufferに溜まり、完了後に返されるがtimeoutでは破棄される（`R/strategyRunner.ts:139-163,190-219`）。ログtailには開始・完了時刻、完全なobs、worker世代、破棄前のsubmit全件、元のreturned値を一括取得する経路がない。LLM contextの観測も改訂時点の最新観測をsanitizeしたもので、recent decisionsは末尾だけ（`R/improve.ts:775-793`）。全判断の代わりにはならない。

**RPC proxyではread transcriptの粒度が異なる。** 正確なネットワーク入口はcoordinatorの`ERIS_AGENT_RPC_URL` → 子の`ERIS_RPC_URL`（`core/src/realtime/agentProcess.ts:186-192`）。workerは同じcontext RPC URLで独自clientを作る（`R/strategyWorker.ts:21-26`）。proxyで通過RPC要求・応答は収集可能だが、`readOnlyClient`はclient methodの記録器ではなくtransportの許可検査（`R/readOnlyClient.ts:5-24`）。SDKはJSON-RPC batchとMulticall3集約を使う（`sdk/src/chain.ts:35-74`）。従ってRPC wire記録だけから`readContract`等のJavaScript引数、復号済み戻り値、元の順序、判断ID・worker世代を一意に戻せるとはいえない。監査replayは**client method名・argsの完全一致**を要求する（`C/revision_replay.mjs:71-85`）。親の観測読出とworker読出を区別するdecisionタグも、この接続構築には not found in files。

**不足:** `g3_decision_started`と全frameの対応、noop/v0を含む入力、開始完了、世代、return/submit、read transcript。必要フィールドと全件照合は`C/revision_audit.py:212-238`、仕様は`C/REVISION-AUDIT.md:52-58,69-75`。stockの`example/agents/runtime`・`sdk/src`・`core/src`を検索して`g3_decision_started` / `g3_action_attempt` / `audit-frames`のproducerは **not found in files**。別プロセスで同じsourceを再実行しても、実判断で失われたframeは生成できない。

## 4. 送信境界と経済安全性

**取引・receiptは部分収集可能。** 正確な入口は前節のRPC proxyと`agents/<id>.jsonl`のmempool記録。senderは送信成功でhash/nonce/priorityFee/blockSeen等を記録し、失敗も記録する（`R/send.ts:250-290,359-368`）。coordinatorはblockと取引receiptを読み、`blocks.csv`へ帰属・status・gasUsed等を記録する（`core/src/realtime/coordinator.ts:2834-2874`、`core/src/logger.ts:8-58`）。従って通過取引、採掘receipt、そのhash joinは実装可能。ただしreceipt取得失敗時には`status:"mined"`というfallbackがあり、監査用の成功statusへ読み替えない（同coordinator`:2864-2871`）。非segmentの記録はrun後のscanであり、live tailで常に完成CSVを得られるわけではない（同`:2834-2837`）。

**全attemptはRPCまで届かない。** returnもsubmitも`sender.submit`へ渡り、route/decision IDは引数にない（`R/botMain.ts:631-638`）。senderはparse失敗をraw actionなしで記録し、noopを落とし、guard/validation拒否では送信しない（`R/send.ts:295-335`）。worker timeout時に破棄されたsubmitはそもそもsenderまで来ない（`R/strategyRunner.ts:148-163,190-219`）。`g3_action_attempt`のroute/ordinal/action hashを通信から復元する入口は **not found in files**。

**残高・allowanceの値だけと、判断境界のsnapshotは異なる。** 残高読出はSDKの`getBalance`/`balanceOf`であり、通過する読出値はproxyで捕捉できる（`sdk/src/chain.ts:144-173`）。しかしsenderは`balancesAtDecision/stateAtDecision`を受け取ってvalidationし、その後非同期queueでbuild/sendする（`R/botMain.ts:626-636`、`R/send.ts:169-171,331-360`）。proxyの送信直前に別途balance/allowanceを問い合わせる設計は可能でも、それは過去の判断入力や未送信queue予約額の実測ではない。spender別allowanceを全action境界で必ず採取するhookは、調査したsender/worker経路では **not found in files**。

senderには未包含nonceの検査、内部gasByRound、ガス見積・buffer・上限がある（`R/send.ts:98-105,139-166,196-264`）。ガス補充の目標値も`perTxCost * GAS_REFILL_TX_HEADROOM`として計算される（同`:408-425`）。これらは全判断の`pendingReservations[token] / pendingGasWei / gasReserveWei / maxGasCostWei`を外へ記録するAPIではない。proxyに見える署名取引のgas/feeから送信済み最大費用を計算することと、未送信・拒否・両経路を含む全actionの必要予約を認定することは別。

**Anvilログの限界。** AnvilはローカルEthereum実行環境。通常のbacktest起動はstdoutをignoreしている（`core/src/cli/backtest.ts:594-625`）。別の`core/src/cli/anvil.ts:52`はstdioをinheritするが、ノード出力とworker内部IDのbinding実装は **not found in files**。今回ノードの版・実出力形式は未検証。Anvilログが取れたとしても、nodeに到達しなかったattempt、JavaScriptのqueue、setSourceは上記経路に存在しないため補えない。

**不足:** 実action境界の全残高・spender別allowance、全経路の予約とガス最大費用、全attempt → 全receipt → events/blocksの一意対応。監査仕様は実送信境界の具体値を要求し、推定PASSや欠落の0埋めを禁止している（`C/REVISION-AUDIT.md:60-75`）。検査は`C/revision_audit.py:239-259`、経済値を消費する処理は`C/revision_replay.mjs:17-24,51-63`。既存CSVは判断ID/route/ordinalを持たない（`core/src/logger.ts:8-58`）。

## 5. timeout・子終了・遅着・状態持越し／復帰

**300秒制限の実装と独立controlは存在する。** `ERIS_LLM_CALL_TIMEOUT_MS`の既定値は300000ms（`R/llm.ts:63-70`）。CLIでは`runCli`が期限に直接の子を`SIGKILL`し、Promiseをerrorで確定させ、以後のclose結果を`done`で無視する（同`:525-565`）。このコードから「同じPromiseの遅着成功を採用しない」ことは読めるが、実走での子終了・遅着なしを測ったことにはならない。HTTPはAbortSignal/SDK timeout経路で、CLI子killの証明と同一ではない（同`:226-229,287-290,356-388`）。

`C/timeout-child.cjs:1-3`はPID/開始時刻を書き301秒後に遅着file/outputを出す。`C/timeout-control.mjs:3-15`はstock `runCli(...,300000)`を直接呼び、1.5秒待ってPID不存在と遅着file不存在を調べる。これはモデルを通さない独立部品controlで、`liveRevisionLifecycleVerified:false`。直接のchild exit eventやkill signal自体を独立記録するcontrolではなく、PID probeとstock kill実装に依存する。さらに参照先はこのtreeではなく固定の`release-r2`と`/tmp/g3-chain`（同`:3-7`）。今回は実行していない。

**外部wrapperのプロセス形状が重要。** 現timed wrapperの`exec`は直接の子PIDを維持する（`ascon-notes/league/xb-r-live-claude-timed.sh:3,25`）。collector目的でwrapperが実CLIを孫としてspawnすると、stock `runCli`がkillするのはwrapperであり、プロセスグループや孫のkillは`R/llm.ts:543-565`に **not found in files**。直接子PIDの保持、開始記録、外部監視を再利用する余地はあるが、liveでexit/kill/遅着を結合するcollectorは未実証。SIGKILL後にwrapper自身の終了handlerで記録できる前提を置かない。

**判断側の5秒controlもliveではない。** `C/decide-budget-control.mjs:3-15`は`StrategyRunner`へ「submit後に無限loopするexecutor」を直接渡し、5000ms timeout後に安全sourceへ切替え、buffered submitが残らないか検査する。stock側にはdeadline超過拒否とworker terminateがある（`R/strategyRunner.ts:139-145,190-219,239-245`）。しかしcontrolは別runnerを自身で所有しており、実botMainのrunnerや送信器を監視していない。参照先も固定`release-r2`である。

**持越し状態とresume通知は外部で読める。** `ERIS_AGENT_STATE_DIR`が永続領域を指定し、`versions.json`を使用する（`R/state.ts:37-47`、`R/botMain.ts:825-826`）。botMainはversion>0のsource/epoch情報とmemoryを保存し（同`:833-850`）、再開時は再compile、setSource、`revision_resumed`または失敗ログを出す（同`:853-925`）。外部collectorによるepoch終了・開始時のstate保存とdigest比較は可能。ただしこれはモデルの永続memory/sourceであり、worker realmの内部変数や最初の実判断を証明しない。v0は元moduleとして再構成するためpersistから除外されている（同`:840-845`）。

**不足:** 実timeout callと同じworldでの300000..301000ms、直接子終了、実kill、採否、以後のsetSource/判断監視を揃えた`lateApplied:false`。復帰・resume後の実module/worker世代と判断frameも必要。現在のtimeout契約は`C/revision_audit.py:271-280`。さらに現監査器自体がrestored v0 module replayをBLOCKEDにする（同`:200-208,251-255`、`C/REVISION-AUDIT.md:102-111`）。collectorだけ完成してもv0復帰認定には監査側の別対応が残る。

## providerテストはlive呼出の横取り器か

**既存hookの再利用は可能だが、テスト実装そのものは実モデルの透過recorderではない。** `G/tests/provider.test.mjs:6-15`はこのtreeのstock `callLlm/runCli/resolveLlmProvider`をimportし、`ERIS_CLAUDE_BIN`を`G/fake-claude.py`へ置換する。これは同じCLI選択経路を通すテスト。`globalThis.fetch`もparent内で拒否する（同`:13-14`）。本物のモデル呼出に横から記録を足す実装ではない。

- fakeはargvを読まず、固定fixture・fault caseで出力する。quota/empty/301秒timeout、150秒delayed、counterによる変更→`revertTo:0`→nullの制御応答を作る（`G/fake-claude.py:1-4,14-42`）。自然な改訂を取得する機能、開始binding、全文交換の保存機能は **not found in files**。
- providerテストの遅延は`G3_UNIT_TIME_SCALE`で短縮され、明示timeoutは80ms。これを実300秒の証明にできない（`G/tests/provider.test.mjs:32-46`）。fault rosterは同じfake CLIを使うので、将来のlive fault注入への接続点は既にある（例`G/fault-timeout.yaml:31-33`）。自然モデル応答のrecorder用途ではfakeを透過wrapperへ置き換える新規実装が必要。
- `G/harness.mjs:3-13,23-34`はstock parser/compilerを使い、fixture観測と読出拒否stubを渡してexecutorを直接実行し、`ctx.submit`とreturnを自身で収集する。live botMain内部を横取りしていない。`auditAction`もswap schema、75 basis points（1万分の1単位）、WETH資金の限定検査（同`:15-21`）。`C/malicious.mjs:1-12`はさらに固定`release-r2`のharnessをimportする独立非送信control。
- `G/tests/provider.test.mjs:58-72`はstock `StrategyRunner`を新規作成し、`setSource`と`decide`の返す`action/submitted`を取る。部品のAPIを使う方法は参考になるが、botMainが所有する既存instanceを注入・取得するhookではない。stock runnerの戻り値自体も観測開始時刻、世代、read transcriptを含まない（`R/strategyRunner.ts:159-163`）。

## byte同一性、hash、別の計測方式の扱い

1. **ファイルのbyte同一性と実行挙動の同一性を分ける。** `ERIS_CLAUDE_BIN`/`ERIS_CODEX_BIN`/`ERIS_INFERENCE_BASE_URL`/`ERIS_AGENT_RPC_URL`を外部collectorへ向けるだけならstockファイルを書き換える必要はない。入口は上記`R/llm.ts:156-158,587-610`と`core/src/realtime/agentProcess.ts:192`。ただしwrapper、proxy、環境変数、model、roster、fixture、観測遅延は実効構成の一部。fake応答や別モデルは同じruntime bytesでも同じ自然モデル実行ではない（`G/fake-claude.py:14-42`）。今後は追加collectorと設定も別途hash・由来を固定する必要がある。
2. **既存監査のSHAは用途が異なる。** `revision_exchange`の`parserSha256`は`improve.ts`だけ（`C/revision_exchange.mjs:40`）。`revision_audit.replay`は固定`release-r2`と`source-manifest.json`の列挙ファイルを照合する（`C/revision_audit.py:20-45`）。providerテストは相対importでこのtreeを読む（`G/tests/provider.test.mjs:6-9`）。従ってこのtreeのproviderテストと旧manifestのreplayを同じsource証明として混ぜない。chainは固定tool hashのレビュー済み更新を要求し、source/eval更新は未完とされる（`C/README.md:1-8,91-101`）。今回manifestやlockは変更していない。
3. **preload・prototype差替え・debuggerは未評価。** rosterには独自`command/args`を選ぶ経路がある（`core/src/realtime/agentProcess.ts:217-244`）。その入口から追加loaderを入れ、`StrategyRunner.setSource/decide`、Worker通信、readOnlyClient等を計測する案は、ディスク上のstock bytesを保持できる可能性がある。しかし既存G3 collectorとしての実装は **not found in files**。実行時関数を差し替えるなら単なる外部tailではなくruntimeの実行を計装する方式であり、起動順序・workerへの適用・read粒度・deadlineや順序への影響・stock挙動維持は不明。byte hash一致だけで無変更と認定しない。今回の結論をこの未実証案でFEASIBLEへ引き上げない。
4. **今回のbyte確認:** `git ls-files`から、親ディレクトリ名に`runtime/sdk/lib/core`を含む全tracked fileと`example/agents/`全体を抽出し、339ファイルを`git show origin/main:<path>`のbytesと直接比較した。不一致0。これはローカル基準1bb0fc7との一致であり、ネットワーク未使用のためupstream GitHubの現行HEADとの一致は未検証。

## 最小の次工程（提案のみ、未実装）

**まず要件1だけを閉じるCLI開始binding collectorのオフライン試作。** 別途承認された作業で、`ascon-notes/`配下に新規wrapperを置き、既存`ERIS_CLAUDE_BIN`入口でClaudeの`-p` context先頭のblockと、同時取得のts/PID・collector識別をsidecarへ保存し、argvを変更せずexecする。既存timed wrapperのPID維持構造と、context先頭blockに根拠がある（`ascon-notes/league/xb-r-live-claude-timed.sh:5-25`、`R/llm.ts:490-505,587-600`、`R/improve.ts:690-693`）。モデルやチェーンなしで、合成argv、同一PID、欠落block拒否、同一内容転送、未完了呼出を残すことを検査する。既存wrapperの「argvをログしない」方針を保ち、sidecarには必要なblockだけを抽出し、資格情報・環境変数・prompt全文を出さない。

この小工程は交換収集を前進させるが、完全G3を解放しない。stdout全文捕捉とkill維持の両立、要件2・3の実worker観測経路、要件4の全action境界、要件5のlive終了・復帰証明は別の成立条件。欠落を埋める標準の公開hookが追加されるか、実行時計装の許容範囲と挙動同一性が実証されるまでは、**PARTLY／G3はBLOCKED**を維持する。既存監査も収集器の真正性をdigestだけでは認定しない（`C/REVISION-AUDIT.md:69-75`）。

## 今回実行した検査と限界

- 実行: `pwd`、`git status --short`、`git branch --show-current`、`git rev-parse HEAD origin/main`、`rg/rg --files`と`nl -ba`等による上記コードの静的読取。探索時に存在しない`lib`/`erc20.ts`やglobのエラーがあり、実在する`R/`・`sdk/src/chain.ts`等へ絞って読み直した。
- 実行: Python標準ライブラリと読取専用Gitコマンドによる上記339ファイルのbyte比較。不一致0。既存runtime・SDK・lib・core・agentを変更していない。
- `npm run typecheck`: **exit 127、`sh: tsc: command not found`**。依存導入は行っていない。型検査は未検証。文書のみの追加であり、provider/control/replayテストは実行していない。
- `git diff --check`: exit 0、空白エラーなし。新規未追跡文書も対象にする`git diff --no-index --check /dev/null ascon-notes/league/G3-RECORDER-FEASIBILITY-2026-10-08.md`: 空白エラーの出力なし、exit 1（新規内容の差分あり）。文書内の明示的な91件のファイル・行番号参照も、存在と行数範囲をPythonで確認し、無効参照0。これは記述内容の意味的正しさを自動証明する検査ではない。
- ネットワーク、Docker、Anvil、backtest、SSH（Secure Shell）、モデル呼出、commit/pushは実行していない。live recorder、実300秒timeout、子プロセス終了、RPC proxy、実取引、持越し・復帰、自然改訂、upstream現行規約の照合はすべて未検証。
- 変更ファイルはこの新規文書`ascon-notes/league/G3-RECORDER-FEASIBILITY-2026-10-08.md`だけ。実装は追加していない。
