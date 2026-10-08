# G3 loaderによる観測の実現性 — 2026-10-08

**結論: PARTLY（部分的に可能、完全なG3計測の成立は未検証）。G3はREQUIREDのまま。** rosterの`command/args`から起動するpreloadには、標準ファイルを一切書き換えずに`StrategyRunner`・Worker通信・送信器・推論子プロセスを計測する具体的な入口がある。ただし、親スレッドの通信監視だけではworker内のread transcript、無効化後の`ctx.submit`呼出、版管理の局所変数、取引境界の全経済値は取れない。worker側への計装と、一部のメモリ上ソース変換まで含めれば観測範囲を広げられるが、実装・完全性・挙動同一性は未実証である。

**これは計測専用のinstrumented build（実行時に観測処理を加えた構成）であり、提出artifact（提出成果物）ではない。** ディスク上の標準runtimeがbyte同一でも、追加コード、差し替えた関数、実際に評価したソース、起動引数、処理時間は異なる。「同じ提出プログラムとして扱える」という規定・実証は **not found in files**。G3の免除・緩和・別ゲートへの代替は提案しない。

## 1. 調査範囲、基準、用語

- 本文は前回調査の「byte同一性、hash、別の計測方式の扱い」項目3だけを掘り下げた、1回の静的調査である（`ascon-notes/league/G3-RECORDER-FEASIBILITY-2026-10-08.md:100-104`）。実施日は2026-10-09、ファイル名の日付は依頼指定。分析上限3時間内。実装・実験は行っていない。
- 作業場所: `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/g3-loader-feas`。branch: `docs/g3-loader-feasibility`。調査時のHEADとローカル`origin/main`は双方`abcc7052aa9a29a9a33a4d033f0a63fce9d5b3f1`。開始時clean。fetchしていないためリモート最新との一致ではない。
- 要件2はsetSource実時刻・source hash・version・初回decision ID、要件3はnoop/v0を含む全判断・worker世代・開始完了・read・return/submit、要件4は取引境界の経済値とreceipt照合、要件5は実300秒制限・子終了・遅着なし・持越し/復帰である（`ascon-notes/league/G3-PREREQ-2026-10-07.md:71-81`）。
- 短縮パス: `R/` = `example/agents/runtime/`、`G/` = `ascon-notes/league/g3/`、`C/` = `ascon-notes/league/g3/chain/`。以下の`file:line`はこのローカルcommitのファイル・行番号を指す。
- G3 = Gate 3（自己改訂の実チェーン受入れ判定）。ESM = ECMAScript Modules（JavaScript標準モジュール）。API = Application Programming Interface（プログラム間の呼出境界）。SDK = Software Development Kit（ソフトウェア開発キット）。CLI = Command Line Interface（コマンドライン実行形式）。LLM = Large Language Model（大規模言語モデル）。RPC = Remote Procedure Call（遠隔手続呼出）。HTTP = Hypertext Transfer Protocol（通信方式）。PID = Process Identifier（プロセス識別番号）。ID = Identifier（識別子）。
- JSON = JavaScript Object Notation、JSONL = JSON Lines（1行1記録）。CSV = Comma-Separated Values（カンマ区切り形式）。SHA-256 = Secure Hash Algorithm 256-bit（内容の指紋）。VM = Virtual Machine（ここでは`node:vm`の実行コンテキスト）。UTC = Coordinated Universal Time（協定世界時）。CPU = Central Processing Unit（中央演算装置）、TS = TypeScript、ETHはEthereumのネイティブ通貨Etherの単位。v0は提出時の元module、noopは取引しない判断、frameは1判断の入力・出力・時刻等を束ねた記録。worker generationはworkerを実際に作り直した回数に対応する識別子でありversionとは別。
- 「候補」はコードの呼出関係から設計できる計測点を意味し、動作確認済みという意味ではない。存在しないproducerや未確認の仕様は **not found in files** と明記する。Nodeのloader APIの詳細な互換性資料は今回の確認ファイル中にはなく、ネットワーク禁止のため外部資料は照合していない。

## 2. 起動経路と「親側」の意味

`AgentSpec`は`command?: string`と`args?: string[]`を持ち（`sdk/src/types.ts:1042-1055`）、roster検査は非空command・文字列配列argsを許可し、commandなしargsを拒否して保持する（`core/src/config.ts:122-139,225-237`）。`external:true`は自分で起動する登録でありcommandと共存できない（同`:141-153`）。通常のcoordinatorが起動するagentを対象とする。

`RealtimeAgentProcess`はcommand指定時にそのままspawnし、未指定時だけ`ERIS_AGENT_DIR`設定・Docker分岐・`node --import tsx .../runtime/bot.ts`選択を行う（`core/src/realtime/agentProcess.ts:217-251`）。したがって独自commandには次の条件がある。

1. `dir:`だけでは`ERIS_AGENT_DIR`が設定されない。対応するagent絶対パスをrosterの`env`等から明示し、元と同じ実体を使う必要がある。envのマージ順は`core/src/realtime/agentProcess.ts:159-178,200-215`、同じ注意は`infra/docker-agent/run-agent.sh:156-157`にもある。
2. 起動例の形は`node --import tsx --import <絶対パスのour-loader.mjs> <標準runtime/bot.ts>`。**これは未検証の構成例であり実行コマンドの確定版ではない。** `botMain.ts`直起動は避ける。`bot.ts`はmanifestの環境設定を適用してから動的importするpreludeであり、この順序を飛ばすと別構成になる（`R/bot.ts:1-25`）。preloadが先にruntime/SDKをimportする場合も、この順序を壊し得る。
3. command overrideは`agentSandbox:docker`でも標準コンテナ起動分岐を通らない。素のNode起動をコンテナの2仮想CPU・4ギガバイト条件と同じだとは扱えない（`core/src/realtime/agentProcess.ts:129-131,219-244`、`docs/competition-start.md:734-743`）。今回の最小検討はローカル計測の成立性であり、提出環境の再現は別途必要。
4. coordinatorから見る「子」はbotプロセス、戦略Workerから見る「親」はbotの主スレッドである。loaderが入るのは後者。別の外側プロセスがbotを単にspawn/execしてログをtailするだけでは、bot内のWorkerやSenderを取得できない。coordinatorはbotのstdin/stdoutをignoreしstderrだけpipeするので、監査記録をconsole出力だけにしても収集できない（`core/src/realtime/agentProcess.ts:248-255`）。

## 3. hook方式の比較と制約

| 方式 | 具体的に観測できる境界 | 到達しない場所・挙動への影響 |
|---|---|---|
| 別プロセスのlauncher、既存ログtail | 起動/終了、既存ログ、完了済みstateファイル | botの局所変数やworker内関数には届かない。余分な親/孫を作るとkill対象・信号伝播も変わる |
| 同一bot内preload + class prototypeラップ | exportされた`StrategyRunner.setSource/start/decide/close`、`Sender.submit`、`AgentStateStore.load/save` | class instanceを所有しなくても同じclass実体のprototypeなら介入可能。関数呼出と計測の実行時間が増える。先行importによる副作用・別URLでの二重moduleを避ける必要がある |
| `node:worker_threads` / `node:child_process`境界 | Worker生成・postMessage・message/error/exit/terminate、推論子spawn/kill/exit/close | 親で受信した時刻はworkerの実行時刻ではない。listener順と計測負荷でdeadline判定が変わり得る。子/worker内の局所呼出は別計装が必要 |
| ESM resolve/load hook、export façade | 正確なmodule URLを識別し、`readOnlyClient`や`compileExecutor`を返す関数をラップする候補 | resolve/loadを記録するだけでは関数呼出は見えない。代替moduleやメモリ上ソースの挿入は**実際に評価するプログラムを変更する**。tsxとの連鎖、元moduleへの再入、workerへの登録は未検証 |
| `process`終了・例外等のhook | 正常終了や観測可能な異常、監査ファイル未完了の検出 | SIGKILLは捕捉できず、そのプロセスの終了handlerで書き残せない。SIGTERM handler追加や例外handler追加は既定終了挙動を変え得る。終了時flushだけでは完全性を保証できない |

classの根拠は`R/strategyRunner.ts:44-65,173-249`、`R/send.ts:84-105,295-300`、`R/state.ts:190-204,234-287`。TypeScriptの`private`表記はこのソースでは`#private`ではないが、内部method/propertyへの依存は公開APIとしての保証ではない。実際のtsx変換後の形を確認する必要がある（`tsconfig.json:2-5`、`package.json:55-58`）。

**ESMのexportを単に代入し直す案は成立条件を満たさない。** module namespaceは通常の差替え用オブジェクトではない。classのprototypeを変更することと`module.readOnlyClient = wrapper`は別である。また、`llm.ts`のexport `runCli`を外部のfacadeで包んでも、同じmodule内部の`callClaudeCli`が呼ぶ局所bindingは自動でそのwrapperを通らない（`R/llm.ts:526-531,583-610`）。ここはbuiltinのspawn境界、または当該call siteのメモリ上計装が必要。builtin export差替えを採る場合の`syncBuiltinESMExports`等の適用要否も実証項目であり、既存G3実装は **not found in files**。

**workerへは別途届かせる。** 親のprototype変更は別のJavaScript実行領域であるworkerへ共有されない。stockは`strategyWorker.mjs`を起動し、その中で`tsx/esm/api.register()`後に`strategyWorker.ts`をimportする（`R/strategyRunner.ts:84-94`、`R/strategyWorker.mjs:1-5`）。`execArgv`を明示していないため、Nodeの起動オプション継承が候補になるが、今回のloaderとtsxの組合せが全世代で一度だけ有効になる証拠は **not found in files**。`isMainThread`相当の分岐、workerごとの登録完了証跡、URL一致検査が必要。envにloaderパスがあるだけでは成立しない。

監査用の追加メッセージをstockのWorker通信へ混ぜるのも危険である。親は`ready/log/submit/error`以外をresult相当として扱うため、同じdecision IDを持つ独自typeは判断を誤って完了させ得る（`R/strategyRunner.ts:131-164`）。別の監査通信路や専用ファイル等の設計が必要だが、追加資源・順序・終了時欠測の影響を評価する。今回その設計を実装していない。

## 4. 要件別の到達点

| 要件 | 親のprototype/通信hookだけ | worker側またはメモリ上計装を加えた候補 | 今回の判定 |
|---|---|---|---|
| 2. setSource・hash・version・初回判断 | setSourceの引数と呼出境界、Worker source、postした判断ID | `botMain`のinstall/resume/revert境界で版とcallを直接結合 | 有力。ただしhashだけでversionを決められず、完全binding未実証 |
| 3. 全判断・read・両経路 | runner呼出、実dispatch、受信result/submit/error、世代、親側破棄 | workerのcallback入口/完了、`ctx.submit`、`readOnlyClient`上のmethod呼出 | 親だけでは不足。worker計装込みでも全件性・read再現未実証 |
| 4. 取引境界 | Sender入力、queue境界、build/send、receiptの一部 | call siteのroute/ordinal、validation結果、queue taskに監査識別子を結合 | 部分的。allowance・全予約/最大費用は既存値を読むだけでは揃わない |
| 5. 300秒・終了・遅着・持越し | spawn/kill/exit、runner/state境界 | timeout処理、採否/適用、worker内の遅いsubmit試行 | 有力な計測候補だが、実300秒・全期間・実world証跡なし |

### 要件2: 選択したsourceと、実際に動いたsourceを分ける

`StrategyRunner.prototype.setSource`の同期wrapperなら、呼出直前/直後の時刻、引数descriptor、成功/例外を記録して元methodを1度だけ実行できる候補になる。stockは`this.source = source`だけであり、versionやcallBlockを引数に持たない（`R/strategyRunner.ts:61-65`）。したがって記録すべきものは次のとおり。

- `executor`型は実際に受け取ったsource文字列のSHA-256。親の`prepareSource`はcompileで検査した後、**元の文字列**を`{kind:"executor",source}`に入れる。VMで評価するラップ済み文字列は別物である（`R/botMain.ts:514-519`、`R/improve.ts:420-436`）。提案raw JSON、採用source、loader変換後moduleのhashを混同しない。
- `module`型はpathそのもののhashではなく、元`agent.ts`と依存moduleの実byte hash・解決先。workerはそのpathをimportする（`R/strategyProtocol.ts:10-13`、`R/strategyWorker.ts:29-43`）。元moduleへの復帰をexecutor本文の再生成で代用しない。
- 時刻は同期callを挟む区間と記録地点を明記する。wrapper後の時刻は代入完了の直後でありCPU上の代入瞬間そのものではない。代入位置でのイベントが必要ならメモリ上変換でそこにprobeを置く。いずれもUTCと単調増加時計、記録順番号、観測誤差を残す。既存採否ログのtsをsetSource時刻に転用しない。

versionの正確な所有者は`botMain`内の`highestVersion/active/runningVersion`である（`R/botMain.ts:795-816`）。通常installでは増番後setSource、その後active更新・persist・outcome、revertでも増番し旧executorを再利用する（同`:1105-1132,1151-1175`）。再開ではpersisted versionを再検査して最新が生き残った場合だけsetSourceする（同`:863-912`）。**同じhashのsourceが複数versionに属する**ためhash一致をversion番号に読み替えられない。

候補はsetSourceの同期待受と、`createAgentLog`が返す関数のoutcome捕捉、`AgentStateStore.load/save`の引数/結果の結合。ただし採否/保存が欠測なら未結合として残す。完全に直接読む案はESM load変換で上記botMain call siteに`version/callBlock/epoch`を渡すprobeを置くこと。これはファイルのbyteを保てても実行時のbotMainを計装する方式である。module exportだけからclosure内のversionを読むhookは **not found in files**。

初回decision IDは、setSource時点で即生成されたものではない。`start()`がsourceオブジェクト同一性またはfailureを見てworkerを捨て、`decide()`がready後にIDを増やしてdispatchする（`R/strategyRunner.ts:67-94,187-205`）。実行中の旧判断は旧workerのsourceで完了する。生成時descriptor、generation、実dispatch IDを結合し、worker内開始も確認した最初のframeへ結ぶ。sourceを選んだが次の改訂/終了まで実行されなかった場合に初回IDを捏造しない。v0へのrevertも新しい管理versionであり、worker再生成の有無はsourceオブジェクトと実際のWorker生成に従う。versionが増えたからgenerationも増えたとはしない。

### 要件3: 全判断の階層とread transcript

**親で取得する候補:** `StrategyRunner.decide(obs)`の入口・戻り/例外、`Worker`生成/終了、`postMessage({id,observation})`、受信`submit/result/error`、`terminate()`要求と完了。これでnoop/nullやv0も含む実dispatch、元の観測、worker source、bufferに入る前のsubmit受信を捕捉できる（`R/strategyRunner.ts:131-169,173-219,239-245`）。ただし次の区別が必須。

1. botの`invokeDecide`は判断中なら呼出自体をskipする。runnerのbackoffはnoopを返すがworker IDを割り当てない。startup失敗もdispatch前に起こり得る（`R/botMain.ts:623-631`、`R/strategyRunner.ts:173-205`）。監査側の論理呼出IDとstock worker IDを別々に保ち、未dispatchを明記する。1 block = 1 frameやID連番だけでは全判断の完全性にならない。観測通知・invoke試行・skip・runner開始・dispatch・完了/未完了を別記録で突合するにはbotMain内境界の計装も必要。
2. runner開始、Workerへの送信、worker callback開始、executor呼出開始、worker result送出、親受信、runner Promise確定、sender送信は別時刻。親の往復時間を実worker計算時間にしない。stockの5秒timerは`await start()`後で始まり、worker起動は別の60秒上限である（`R/strategyRunner.ts:104-112,187-205`、`R/decideTimeout.ts:8-17`）。wrapper全体にstartupを含めて5秒判定しない。現監査器のframe時間上限との対応も明記が必要（`C/revision_audit.py:218-223`）。
3. parent受信hookは「届いた」証拠であり「採用した」証拠ではない。stockは世代不一致・pending不在・ID不一致・期限超過を落とす（`R/strategyRunner.ts:131-145`）。受信と採否を分け、元listenerの前で重いhash処理をすると、間にdeadlineを越えて判断結果が変わり得る。

**worker内開始/完了の候補:** `strategyWorker.ts`の`port.on("message", async ...)`入口、`await decide(observation,ctx)`前後、post result/error、finallyが正確な場所である（`R/strategyWorker.ts:47-84`）。callbackを包むだけではexecutor境界と完全一致しないので、必要粒度に応じて局所probeを置く。親hookがworker内へ自動到達すると仮定しない。

**read transcriptの候補:** workerで生成する`readOnlyClient(publicClient)`の**返り値の高水準method境界**をProxy等で包む。method名、引数、呼出順番号、開始/解決/拒否、結果、decision ID、generationを記録し、元methodに元の`this`とargsを渡す。`readOnlyClient`自身の既存実装はtransportの許可検査だけで、JavaScript methodの履歴は保存しない（`R/strategyWorker.ts:21-26,51-56`、`R/readOnlyClient.ts:5-25`）。親のpublicClientのwrapperだけではworker独自clientには届かない。

RPC wireだけでは不十分である。SDKはJSON-RPC batchとMulticall3集約を行い、高水準methodと通信要求が一対一にならない（`sdk/src/chain.ts:34-74`）。replay側はmethod名とargsの順序付き一致を要求する（`C/revision_replay.mjs:71-85`）。read結果順ではなく**呼出順にIDを割り当て、完了はそのIDへ戻す**必要がある。並列read、BigInt、例外、未完了read、結果を後で変更する場合、`request`や拡張method、元moduleが別clientを作る場合の網羅性を検証する。最後の経路まで全件収集する汎用実装は **not found in files**。

生成executorは`compileExecutor`のVM bridgeを経由するため、VM内のglobal fetchだけを包んでも漏れる。host側`ctx.publicClient`のmethodがbridgeから呼ばれる位置が候補であり、realmを隔離するcloneとread-only guardを維持する（`R/improve.ts:337-371,448-461`）。元moduleと生成executorで返り値の正規化が異なる点も保存する。例えば生成executorのundefinedはnullへ正規化される（同`:458-459`）。

**return/submitの候補:** workerの`ctx.submit`入口とresult、親のbuffer採否、botMainの`sender.submit` call siteの3段階を結ぶ。stockはsubmitted配列を先にsenderへ渡し、その後returned actionを渡す（`R/botMain.ts:631-638`）。同じactionを両経路から出せるので、action hashだけで経路を同定しない。`frameId + route + ordinal`をside table等で保持し、payloadの変更は避ける。call siteを直接計装する方が、sender引数だけから経路を推定するより正確である。

特に、workerの`active=false`後の`ctx.submit`は**通信を送らずに捨てられる**（`R/strategyWorker.ts:48-66,81-83`）。親だけではlate submitの「試行なし」と「試行したが遮断」を区別できない。worker内ctx関数入口のprobeが必要。非同期継続が次の判断に跨がる場合も元IDを保つ必要があり、単一globalのcurrentDecision変数では誤帰属する。AsyncLocalStorage（非同期処理に関連情報を保持するNode機構）や判断専用wrapperは候補だが未実証。timeoutでterminateしたworkerの未flush分を欠測なしとして扱わない。

**挙動への影響:** Proxyによる関数同一性/thisの変化、コピーやJSON化でのgetter評価、Promiseの追加then/await、microtask順、batchのまとまり、loggerの入出力、追加メッセージ、garbage collectionが遅延・順序を変え得る。観測用の処理だから決定性を保つ、と断定できない。同期結果・例外・元Promiseを可能な限り保っても観測コストはゼロではない。

### 要件4: 送信・経済値の境界

| 必要値/経路 | concrete hook候補と根拠 | 残る限界・影響 |
|---|---|---|
| 判断時残高/状態、送信要求 | `Sender.prototype.submit(raw,observation,balances,stateById)`入口（`R/send.ts:295-300`）。botMainは判断開始時の残高と状態を保持して渡す（`R/botMain.ts:626-636`） | 取得できるのはsenderが使ったsnapshot。署名時/採掘時の実残高ではない。noop frameにはSenderが呼ばれない場合があるためReader結果と実obsの結合も必要（`R/read.ts:140-211`） |
| parse/guard/validation拒否 | `submit`入口、既存拒否log、必要なら局所`parseAction/validateAction`結果のprobe（`R/send.ts:301-335`） | Workerで捨てたsubmitはここへ来ない。parse後に正規化されたactionと生のactionを区別し、probeで検証・送信可否を変えない |
| queue/intent/取引への対応 | `enqueueSend(task)`、task開始/完了、`adapter.buildTxs`、`sendBuiltTx(tx,fee,meta)`（`R/send.ts:169-170,184-191,336-397`） | TS privateへの依存。taskはclosureなので入口の関数だけからintentや予約額は読めない。side tableやcall site probeでaction→intent→複数txの対応を維持する必要がある |
| gas/nonce/送信hash | `allocNonce`、`gasByRound`、見積/fee計算、wallet送信の直前/結果（`R/send.ts:139-166,196-290`） | `gasByRound`はblockのgas量でありETH費用の予約ではない。gas未確定経路や送信応答喪失もある。account全体をdumpすると秘密鍵等が漏れ得るので記録項目を限定する |
| allowance（spenderに許した支出枠） | 起動時`ensureVenueApprovals`のread（`R/botMain.ts:559-585`）、実際に発生するreadContract境界 | 起動時readは各判断のsnapshotではない。全action境界のtoken/spender別allowance取得は **not found in files**。新しいreadを追加するとRPC数・待ち・観測blockが変わる |
| `pendingReservations/pendingGasWei/gasReserveWei/maxGasCostWei` | queue、全return/submit、実tx gas/fee、receipt確定等を観測して監査側台帳を作る余地 | 対応する完成済みstock変数/producerは **not found in files**。`sendQueue`はPromise鎖、gas補充targetは局所値（`R/send.ts:98-105,169-170,407-425`）。補充targetをそのまま監査のgas予備と名付けない |
| receipt、blocks/eventsとの結合 | senderの`getTransactionReceipt`/ledger境界（`R/send.ts:490-506`）、hashでcoordinator記録と照合 | senderのring、未採掘、例外、終了直前を含め全件必要。通常blocks.csvは終了後scanで、receipt取得失敗の`mined`は成功を意味しない（`core/src/realtime/coordinator.ts:2834-2871`） |

予約額は「予約用変数が無いから0」としてよい値ではない。監査が求めるのは全経路で先に拘束した資金/ガスとの対応である（`C/REVISION-AUDIT.md:60-75`、`C/revision_replay.mjs:17-24,51-63`）。実queue境界から別台帳を構築するなら、bundleの複数leg、同じ残高に対する重複要求、拒否・送信失敗・応答喪失・nonce再同期・採掘/取消までの予約解放を定義し、元runtimeの内部予約値ではなく**観測に基づく監査側の導出値**と明記する。その台帳が要件を満たすという根拠は今回ない。replayからの推定やゼロ埋めでは閉じられない。

新しいbalance/allowance読出をawaitしてから送信すれば、標準の時間順序を変更する。非同期に並行収集すれば待ちを減らせても、送信と同じ状態境界とは保証できない。履歴block固定の事後読出で確定状態を復元できる場合にも、送信直前のqueueや未採掘状態を復元したことにはならない。完全性と低干渉の両方を証明する必要がある。

gas補充は`ctx.submit/return`由来ではなく独立にenqueueされ、起動時approvalはSenderを通らない経路で送る（`R/send.ts:427-478`、`R/botMain.ts:587-602,695-701`）。これらもreceipt/ガスの全件照合に含め、判断のreturn/submitに偽装しない。現監査器は候補の全receiptとの完全一致を要求するので、別経路を分類して扱う監査側設計も残る（`C/revision_audit.py:239-259`）。CSVにdecision ID/routeを保存する欄は **not found in files**（`core/src/logger.ts:8-58`）。

`runningVersion`を使うsender guardの版と、そのactionを計算した旧workerの版も分けて記録する。改訂中の旧判断を許すrunnerと、botMainの現在版を読むguardの組合せだからである（`R/strategyRunner.ts:61-72`、`R/botMain.ts:404-426`）。計測器側で勝手に一致させるのは修正であり、観測ではない。

### 要件5: 実300秒・子終了・遅着なし・持越し/復帰

**300秒はLLM呼出であり、decideの5秒と別。** `CALL_TIMEOUT_MS`はmodule読込時に環境変数または300000を選び、CLIの`runCli`はspawn後timerで直接childへSIGKILLし、`done`でPromiseの二重完了を防ぐ（`R/llm.ts:63-70,525-565`）。静的実装は確認できるが実elapsedや実終了の証明ではない。

同一bot内で`spawn`を元どおり1度呼ぶwrapperは、既存の直接childを維持したままPID、開始、kill要求、exitのcode/signal、close、stdout/stderr到着を観測する候補である。`child.kill`の呼出/返却だけでは終了証拠にならない。独立したexit/closeと、以後のsource適用・Worker dispatch・Sender到達まで結合する。timer開始はspawnより後なので、spawn hookの負荷を含む測定起点と実timer設定点を両方記録する。processのexit hook単体ではLLM childの生死は分からない。

LLM binaryを別wrapperが孫としてspawnする案より、bot内で既存childの境界を観測する案にはプロセス形状を維持できる利点がある。ただしloader自身のイベント追加・pipeの購読開始時点・書込負荷は影響する。stock `runCli`に孫やprocess groupのkillは **not found in files**（`R/llm.ts:543-565`）。子孫が存在する実CLIなら、直接child exitだけで全子孫終了を主張しない。SIGKILLされた側のfinally/exit handlerで証跡を書けるとも仮定しない。

timeout証拠には実際の301000ms遅延注入、300000ms設定、時間倍率1、elapsed 300000..301000ms、SIGKILL、child終了、rejected、lateApplied:falseの根拠が必要（`C/REVISION-AUDIT.md:77-82`、`C/revision_audit.py:271-280`）。短縮timer、加速時計、stockのkillをloaderが先回りする制御はこの証拠にならない。期限近傍でloader負荷が1秒枠を超える可能性も未検証。

`lateApplied:false`はkill直後にsetSourceが無いだけでは閉じない。該当call IDに対するreply/outcome/全setSource/全判断/送信の完全記録を、少なくとも遅着予定時刻以後とworld終了まで揃え、終了時の未完了を明記する。stockの`done`による後続close無視と、botMainの例外→rejected経路が実際に通った証跡を取る（`R/llm.ts:536-565`、`R/botMain.ts:1057-1067,1177-1184`）。HTTP経路にはこのCLI childが無いので、CLIのkill証跡をHTTP実行に流用しない（`R/llm.ts:16-27`）。

判断側でも期限超過はbuffer破棄→worker terminateとなるので、terminate要求と完了、旧世代message拒否、sender不達、新世代の最初の判断を結ぶ（`R/strategyRunner.ts:139-163,190-219,239-245`）。worker内で遮断されたlate submit試行の観測は要件3で述べた別probeが必要。

**持越し:** `AgentStateStore.load/save`のprototype hookは、読んだstate/保存要求/成功・無効化状態を観測する候補。save呼出だけでは保存成功を意味しない。cap超過や書込失敗があり、成功は一時ファイルwrite→renameである（`R/state.ts:234-287`）。epoch境界の実ファイルdigestと次epochのload結果を結び、監査ファイルをstate領域へ混ぜて容量判定を変えない。

**再開/復帰:** stockはversion>0だけをpersistし、次epochで全sourceを再検査、最新が拒否された場合は元moduleを選ぶ。監視開始前にこのresumeが終わる（`R/botMain.ts:734-736,833-925`）。revertTo:0では元module descriptorが再選択されるが管理versionは新規に増える（同`:1105-1129`）。state digestだけでなくsetSource、実generation、元module/import依存hash、初回frameと取引境界が必要。workerの内部変数の持越しと、永続revision historyの持越しは別。

## 5. 既存harnessと監査器へそのまま接続できるか

`G/harness.mjs:3-13,23-34`はstock parser/compilerを使ってfixtureのexecutorを直接呼び、自分で作ったctxでsubmitとreturnを集める。read clientは呼出を拒否するstubであり、実botMainを観測していない。安全検査もswap形、75 basis points（1万分の75）、WETH（Wrapped Ether）の資金に限定される（同`:15-21`）。loaderのread transcriptや送信境界の実証にはならない。

`G/tests/provider.test.mjs:6-15`はstock関数をimportして`ERIS_CLAUDE_BIN`をfakeにし、親fetchを拒否する。delayed/timeoutテストは時間短縮と80msを使う（同`:32-46`）。runnerテストは自分で作ったinstanceのsetSource/decideを調べ、Senderは存在しない（同`:58-72`）。既存APIの試作足場にはなるが、全live判断の横取り・300秒・復帰後元moduleの実行証拠ではない。危険なreturn/submitを検出してFAILとするテストは、runtimeがその危険を強制拒否した証拠でもない（同`:49-55`）。

現在の監査契約へは追加の障害がある。

- `events.jsonl`への`g3_decision_started/g3_action_attempt`producerはstockのruntime/SDK/coreに **not found in files**。bot loaderがcoordinatorのメモリを観測できるわけではない。専用sidecarからnative eventsと証跡をどう結合するか、単一writer・終了・digest・原記録保持まで設計が要る。coordinatorのファイルへ無調整で同時appendする案は完成済みでない（`C/REVISION-AUDIT.md:69-75`）。今回既存ファイルは変更していない。
- auditの開始件数とframesを同じ観測器から出すだけでは、両方同時に欠測した場合を検知できない。観測→invoke→dispatch→terminalの独立counter、起動成功/終了watermark、未完了集合、drop数、hash対象の確定、負の対照が必要。stock worker IDの無いbackoffは専用記録にし、架空のworker実行を作らない。
- 監査器はframe開始時刻に対し直前のapplication版を期待し、v0復帰replayと一部経済動作に未対応（`C/revision_audit.py:200-233,251-265`、`C/REVISION-AUDIT.md:102-111`）。同じsource再選択、resume、選択したが未実行、startup中切替、途中で改訂された旧判断を忠実に記録した場合の整合は別途必要。現契約に合うよう事実を丸めない。
- 現replayは固定`release-r2`とsource-manifestを参照する（`C/revision_audit.py:20-45`）。chain資料自身がr3用source/eval/replay未更新と記す（`C/README.md:1-8`）。このtreeのloader証跡を旧manifestで認定できない。監査器・manifestのレビュー済み更新も残作業であり、今回の許可範囲外（同`:91-101`）。

## 6. 提出時に「同じプログラム」と扱えるか

**扱えるとは確認できない。ローカル起動可能性と提出受理は別である。** ローカルguideは規約の唯一の出典を`https://ascon.dev/rules`と指定する（`docs/competition-start.md:7`）。今回はネットワーク禁止なので現行規約本文の確認は未検証。loader実行との同等性に関する明示規定は、調査したdocs/checklist/提出処理には **not found in files**。許可とも禁止とも推測で断定しない。

ローカル実装から確定できる範囲は次のとおり。

1. 提出ZIPはruntime/lib/対象agent/SDKをコピーする。`ascon-notes/`の任意loaderやローカルrosterはこのコピー対象に含まれない。READMEの起動は`node --import tsx agents/runtime/bot.ts`（`scripts/bundleAgent.ts:120-137,195-211`）。
2. scanはvendored runtime/SDK/libの未知ファイルやbyte差分をBLOCKにする（`infra/submission/scan-submission.py:170-204`）。loaderをascon-notesに置いて標準bytesを保つことはこの検査の必要条件の一部を保つにすぎず、実行時同一性の承認ではない。参加者コード側に同梱する計装も、fs/child_process/VM等の検査を受けるため、scan通過を推測しない（同`:34-59`）。
3. accept処理は**参加者agentディレクトリだけ**を取り込み、同梱runtimeを運営側へ上書きしない。出力するrosterもid/dir/walletであり、ローカルcommand overrideを受け継ぐ処理ではない（`infra/submission/accept-submission.sh:9-18,48-65,79-97`）。
4. team imageは運営baseを継承してagentだけを加える。baseのentrypointはstock bot.tsで、任意loaderの指定はない（`infra/docker-agent/Dockerfile.team:47-59`、`infra/docker-agent/Dockerfile.base:9,34-36`）。この実装はnode:24を指定するが、guideの最低要件はNode 20以上であり、すべてのNode版で追加loaderが同じ挙動をする根拠にはならない（`docs/competition-start.md:9`）。
5. 自分たちのchecklistも本番に存在しないroster envへの依存を排し、提出commit/ZIPへの証拠結合、自己完結、型/戦略/単体検査とコンテナselftestを要求する（`ascon-notes/submission-checklist.md:10-12,20-30,53-55`）。loaderを外したら動くことに加え、**loaderを外した提出runでも検証した性質が成り立つ**根拠が必要。

したがって計測構成は、標準bytes + 計測器 + 計測用起動引数からなる別の実効構成としてhashと由来を固定する。計測器を提出物と呼ばず、計測runを提出runそのものと呼ばない。

## 7. 観測runを提出runへ結び付けるために追加で必要な証拠

以下は将来必要な証拠の条件であり、今回実施したものではない。

1. **実効構成の完全manifest。** 標準runtime/SDK/lib/agent/prompt/依存lock/解決module、loader自身、変換前後ソース、Node/tsx版、起動引数、秘密を除いた設定、state初期digest、イメージdigestを固定。提出ZIPのhash、実際に運営が起動するruntime/baseとの一致を別々に示す。disk hashと評価されたソースのhashを分ける。
2. **観測器の正負対照。** 既知のnoop/null、v0、read並列/拒否/例外、returnとsubmitの同一action、backoff、startup失敗、old worker完了、同一source再適用、timeout後late submit、revertTo:0、再開失敗で、全件性と欠測検知を確認。probeが付かなかった世代・module違い・log切詰め・途中kill・監査保存失敗は未検証/BLOCKEDにする。追加の安全検査でstock動作を修正しない。
3. **loaderあり/なしの対照run。** 同一stock bytes、同一seed/初期chain/state、同一roster・資源上限でloaderだけを切り替え、取引内容/順序/nonce/fee、採掘block/index、receipt/revert、最終残高/損益、改訂採否/時刻/初回判断、判断skip/timeoutを比較する。少なくとも同じseedsで同一のtrade outcomesを示す証拠が必要。最終損益が近いだけを同一性としない。
4. **非決定性の切り分け。** 同じseedでも取引順は揺れるとguideにある（`docs/competition-start.md:567-572`）。無計装同士の繰返し、固定された応答/遅延の部品対照、実自然応答の取得を分ける。LLM応答を固定した対照は計測影響の試験であり、自然改訂を取得した証拠の代替ではない（`ascon-notes/league/G3-PREREQ-2026-10-07.md:83-89`）。不一致を「計測だから」と許容せず、原因と成立範囲を残す。
5. **時間・経済・提出条件の別証拠。** 実300秒と5秒の境界、子終了、全期間の遅着適用なし、epoch越し復帰、実allowance/予約/ガス/receiptを計測。同じ上限でloader負荷の分布とdeadline近傍を確認する。loaderなしの提出artifactにも元来要求される検査を完遂し、規約上の扱いが必要なら公式な確認を得る。有限の一致runだけで全seed・全未実行branchの等価性や安全性は証明できない（`C/REVISION-AUDIT.md:109-111`）。

## 8. 最小の次実装工程とリスク

**最小工程は「親preloadが同じstock StrategyRunner実体と全Worker世代を観測できるか」のオフライン試作1件。** 将来の別作業として`ascon-notes/`にだけ追加し、固定Node/tsxで元Runnerを用いた非送信fixtureを動かす。新規loaderはsetSource同期境界、start/decide、Worker生成/post/result/exitを記録し、worker側bootstrapの適用確認までに限定する。元moduleのnoop→安全なexecutor→元moduleという切替で、descriptor/hash・世代・初回dispatch・noopを欠測なく対応させる。最初からread Proxy、Sender、300秒world、モデル呼出を実装対象に広げない。

合格条件は、元関数を各1回だけ呼ぶこと、loaderの有無で同じaction列/submit列/エラーになること、全世代でprobeが付くこと、実体違い/二重登録を検知すること、全標準ファイルのbytesが不変なこと。stock botMain内部instanceの観測を済ませたとは主張せず、次の別検証でprelude順序とbotMainへの到達を確かめる。**この小工程の成功は要件2/3の一部の足場でありG3 PASSではない。** 本文のread・version closure・経済値・300秒・提出run同等性がすべて残る。

主なリスクは次のとおり。

- ESM/tsx/Workerのloader順序、早期SDK import、二重module、Node版差でprobeが実体に付かない、または起動動作が変わる。
- logger/clone/hash/Promise/Proxyの負荷でdeadline、block skip、RPC batching、送信順・入札結果が変わる。
- versionとgeneration、選択と実dispatch、return/submit、拒否と未試行を誤結合する。stockにない値を監査側が勝手に補完する。
- worker terminateやbot SIGKILLで最後の記録が失われる。非同期保存は欠測し、同期保存は時間干渉する。
- 追加child・signal handler・監査messageが、既存kill/例外/Promise確定の意味を変える。
- allowance追加readと監査側予約台帳が、実境界の証拠として不足する。gas補充/approvalや応答喪失した送信をreceipt照合から落とす。
- 記録対象のenv、RPCヘッダ、wallet account、workerData/contextの丸ごとdumpで秘密が漏れる。workerも読出用資格情報は保持するので「workerは全て公開情報」と扱わない（`R/strategyEnv.ts:16-27`、`sdk/src/chain.ts:48-66`）。
- 旧r2監査器/manifestの制約と、今回のsource/世代/復帰の意味が一致しない。scanner byte一致を提出runの挙動同一性へ拡大解釈する。

**総合判定をPARTLYとする理由:** ファイルを書き換えない計装の入口は具体的にあるため、全面NOT-FEASIBLEとはいえない。一方、親だけで完全取得できるわけではなく、worker/read・版closure・全経済境界・実時間・提出との同等性が揃っていないためFEASIBLEとも認定しない。G3 REQUIRED、未成立部分BLOCKEDを維持する。

## 9. 今回の変更、実行した検査、未検証

- 変更は新規文書`ascon-notes/league/G3-LOADER-FEASIBILITY-2026-10-08.md`だけ。runtime/SDK/lib/core/agent、既存文書、roster、harness、監査器は変更していない。
- 実行した読取: `pwd`、`git status --short`、`git branch --show-current`、`git rev-parse HEAD origin/main`、`rg/rg --files`、`nl -ba`/`sed`等。依頼されたbotMain/strategyRunner/strategyWorker/send/readOnlyClient/improve/agentProcess、roster/spec、harness/provider testと、関連提出・監査・state/readコードを静的確認した。探索中に存在しないbuild/Dockerfileパスやglobのエラーがあり、実在パスへ絞って確認した。
- Python標準ライブラリと読取専用Gitで、`example/agents/`全体および親pathに`runtime/sdk/lib/core`を含むtracked **339ファイル**をローカル`origin/main`のbytesと比較し、不一致0。これはローカル基準commitとの一致であり、公式現行runtimeや提出ZIPとの比較ではない。
- `node --version`: `v24.13.0`。loaderは動かしていない。`npm run typecheck`: **exit 127、`sh: tsc: command not found`**。型検査は未検証。依存導入はしていない。
- `git diff --check`: **exit 0、空白エラーなし**。新規未追跡文書も対象にした`git diff --no-index --check /dev/null ascon-notes/league/G3-LOADER-FEASIBILITY-2026-10-08.md`: 空白エラーの出力なし、exit 1（新規内容の差分あり）。Pythonによる明示的なfile:line参照124区間のファイル存在・行数範囲検査は不整合0。これは引用内容の意味的正しさや実行時挙動の証明ではない。最終`git status --short`も指定文書の新規追加1件のみ。
- テスト・loader試作・providerテスト・harness/replay/control実行は行っていない。文書だけの静的調査なのでruntime挙動の検証済みとは報告しない。ネットワーク、Docker、Anvil、backtest、SSH（Secure Shell）、モデル呼出、commit/pushは実行していない。
- 未検証: loader互換性/全世代到達、read/全判断の完全収集、全取引経済境界、実300秒/子終了/遅着適用なし、実epoch持越し/復帰、自然改訂、同seed対照run、提出artifact同等性、オンライン現行規約。文書の結論は静的分析の到達点である。
