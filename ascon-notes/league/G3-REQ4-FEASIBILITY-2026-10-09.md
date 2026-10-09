# G3 要件4: 標準runtimeのファイルを変更しない観測の実現性

**結論: PARTLY（部分的に可能）。** 既存ファイルから送信申告・採掘結果の一部を事後照合でき、`ERIS_AGENT_RPC_URL`を入口とする外部プロキシなら、そこを通る要求・応答・署名済み取引を記録する余地がある。しかし、それだけで**全actionの実境界における残高、spender別allowance、全予約額、ガス予備、判断からreceiptまでの完全対応**は得られない。マージ済みloaderは非送信のオフライン試作であり、この不足をまだ埋めない。標準ファイルのbyte同一性と実行挙動の同一性は別である。

G3（Gate 3、自己改訂の実チェーン受入れ判定）は引き続き必須。欠測をゼロ・真偽値・履歴状態の推定で埋めない。ゲートの免除・緩和・代替は提案しない。実装・実走による成立認定は今回行っていない。

## 1. 対象、基準、用語

- 対象要件は `ascon-notes/league/G3-PREREQ-2026-10-07.md:78` の項目4。実境界での採取、events/blocksとの完全対応、欠測を補完せずBLOCKEDとする条件は同ファイル `:71-81`。
- 作業場所は `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/g3-req4-feas`、branchは `docs/g3-req4-feasibility`。読取時のHEADとローカル`origin/main`は `ab5ad98f121b26e7738ef23874180eea6e8b3868`。`git show`で確認した。fetchはしておらず、リモート最新との一致は主張しない。
- この文書の引用はリポジトリ相対の実ファイル・行番号。コードから設計可能と判断したhook（観測を挿入する位置）は、既存の記録器や検証済み機能とは区別する。探索範囲に根拠がないものは **not found in files** と記す。
- RPC = Remote Procedure Call（遠隔手続呼出）、HTTP = Hypertext Transfer Protocol（通信方式）、SDK = Software Development Kit（ソフトウェア開発キット）、API = Application Programming Interface（プログラム間の呼出境界）。JSON = JavaScript Object Notation、JSONL = JSON Lines（1行1記録）、CSV = Comma-Separated Values（カンマ区切り形式）。
- ID = Identifier（識別子）、URL = Uniform Resource Locator（接続先等の所在表記）、SHA-256 = Secure Hash Algorithm 256-bit（内容ハッシュ）、ESM = ECMAScript Modules（JavaScript標準モジュール）、CPU = Central Processing Unit（中央演算装置）、SSH = Secure Shell。ETHはEther、WETHはWrapped Ether、USDCはUSD Coin、EUSDはソース上のeUSDトークン識別子。weiはEtherの最小単位。ERC-20はEthereum Request for Comments 20（トークン標準）。
- actionは戦略の高水準出力、intentは検証後の実行要求、transaction（tx）は署名して送るチェーン取引、receiptは採掘後の実行結果。1 actionと1 transactionは一対一ではない。nonceは送信アカウントの取引連番。spenderはトークンの支出を許されたコントラクト、allowanceはその支出上限。mempoolは未採掘取引の待機集合だが、本書の「mempoolログ」はSender自身の申告ログを指す。
- frameは1判断の監査記録、routeは`return`または`submit`、ordinalはそのroute内の順番。noopは取引しない判断、v0は元module。pendingにはworker内buffer、送信queue、ノード受理済み未採掘という異なる段階がある。

## 2. 監査が要求するものと、コードが直接検査するもの

規範となる契約は `ascon-notes/league/g3/chain/REVISION-AUDIT.md:52-75`。具体的な経済値を実send/receipt境界から採取し、replayによる推定やゼロ補完を認めない（同 `:60-67`）。Python監査器だけでなく、その委譲先も読む必要がある。

| 必須項目 | 要求・検査の根拠 | 注意点 |
| --- | --- | --- |
| 実入力の残高 | `ascon-notes/league/g3/chain/revision_audit.py:218-228` が完全frameと`observation.balances`を要求。`ascon-notes/league/g3/chain/revision_replay.mjs:17-24,49-53` がtoken別残高から予約を引き、全return/submit legの累計支出を検査 | 実装は残高を`observation`から読む。各send直前残高を別フィールドで検証する実装は **not found in files**。従って観測時残高を埋めて検査を通すことと、項目4の実境界採取は同義でない |
| spender別allowance | `ascon-notes/league/g3/chain/REVISION-AUDIT.md:60-67`、`ascon-notes/league/g3/chain/revision_audit.py:239-242`、`ascon-notes/league/g3/chain/revision_replay.mjs:54-56` | 現schemaは`allowances[token][actionType]`。spenderアドレス自体の検証ではないため、どのtoken/owner/spenderから採った値かという由来が別途必要 |
| 未包含・予約額 | `ascon-notes/league/g3/chain/revision_replay.mjs:17-24,51-53`。`pendingReservations[token]`を非負整数の10進文字列として要求し、同判断の複数legも累計 | 以前の判断の未包含分と今回のaction群を二重計上しない境界が必要。ノードnonce差だけでは金額にならない |
| fee、全actionの最大ガス費、既存pendingガス、ガス予備 | `ascon-notes/league/g3/chain/REVISION-AUDIT.md:60-67`、`ascon-notes/league/g3/chain/revision_replay.mjs:30-35,58-63`。`ethWei - maxGasCostWei - pendingGasWei >= gasReserveWei`、予備と今回最大費用は正値 | Python監査器がframeを委譲するのは `ascon-notes/league/g3/chain/revision_audit.py:266-270`。gas量、gas費用、残す予備額は別の値 |
| receiptと候補の全採掘行 | `ascon-notes/league/g3/chain/revision_audit.py:95-104,243-259`。hash/status一致、全候補hashとの集合一致、frame側receipt重複排除。取引があるframeはreceipt非空も要求（`ascon-notes/league/g3/chain/revision_replay.mjs:58-63`） | Python実装はreceiptのhash/statusを照合し、gas費用とreceiptの数値を直接再計算して照合するわけではない。CSV側はhash辞書化するため同一hashの重複行検出まで保証しない。契約上の完全性を弱める理由にはしない |
| events、frame、全attemptの対応 | `ascon-notes/league/g3/chain/revision_audit.py:212-238,257-259`。開始ID/時刻/round/version、非noop出力の`frameId + route + ordinal + actionSha256`を順序付き照合 | `ascon-notes/league/g3/chain/REVISION-AUDIT.md:69-75` は全判断・全attemptのproducerを要求。hashが同じactionを両routeから出した場合、hashだけでは区別不能 |
| 危険試行・採掘revert・遅着submit | `ascon-notes/league/g3/chain/revision_audit.py:248-250` が`unsafeAttempts/minedReverts/lateSubmits`を検査 | ログにないことは「0件」の証明ではない。chain receiptだけで危険試行や送信前破棄を数えられない |
| 完成・欠測なし・由来 | `ascon-notes/league/g3/chain/revision_audit.py:56-81,88-114` が原ログ、終了、件数、digestを検査 | 数値predicateを満たす自作JSONは信頼できる採取の証明ではない（`ascon-notes/league/g3/chain/REVISION-AUDIT.md:74-75`） |

対応するreplayは固定の`release-r2`とsource manifestを参照する（`ascon-notes/league/g3/chain/revision_audit.py:20-45`）。chain資料もr3用source/eval/replay未更新と明記する（`ascon-notes/league/g3/chain/README.md:1-8`）。本treeの観測が増えても、そのまま旧基準による認定が成立するとは扱わない。

## 3. 実action境界と取得方式

### 3.1 境界は一つではない

1. workerが`ctx.submit`または結果を生成する。`active=false`後のsubmitは通信を出さない（`example/agents/runtime/strategyWorker.ts:47-83`）。
2. 親Runnerがsubmitをbufferし、結果とともに返す。世代/ID不一致や期限超過は捨てる（`example/agents/runtime/strategyRunner.ts:131-163,190-219`）。
3. botMainがsubmit群、その後returnをSenderに渡す。渡す残高は判断開始時に保持したもの（`example/agents/runtime/botMain.ts:623-638`）。
4. Senderはparse/guard/validateを行い、拒否なら送信しない。通過したintentをPromise queueに積み、adapterが複数取引を構築し得る（`example/agents/runtime/send.ts:295-397`）。
5. queue実行中にblock/fee/gasを取得し、検査後にnonceを割り当てて送る（`example/agents/runtime/send.ts:184-290`）。外部プロキシがraw transactionを見るのはこの後。
6. 採掘後にSenderまたはcoordinatorがreceiptを取得する（`example/agents/runtime/send.ts:490-509`、`core/src/realtime/coordinator.ts:2838-2874`）。

判断開始、Sender入口、queue開始、署名/送信、ノード受理、採掘を同じ時刻・同じ残高として扱わない。`blockSeen`は判断時のroundであり、実送信blockや採掘blockではない（`example/agents/runtime/send.ts:193-194,336-373`）。

### 3.2 方式比較

| 方式 | 標準ファイルを変更せずに得られる範囲 | 得られないもの・挙動への影響 |
| --- | --- | --- |
| A. 完成済みファイルの事後読取 | mempool申告、blocksの採掘行、再構成された評価event。RPC追加なし | 実行済みrunを遡って変えない。ただし稼働中の同じhostで大規模解析すれば資源競合はあり得る。未記録の境界値は作れない |
| B. 通過する全要求・応答を保存する受動RPCプロキシ | 既存readの結果、raw transaction、通過receipt応答、通信失敗。送信内容と取引hashの結合候補 | 元のRPC数を増やさずに設計できるが、転送・記録の遅延は増える。「全要求」は当該入口を通る要求に限り、bot内部の全actionやcoordinatorの全通信を意味しない |
| C. 追加readを発行するRPCプロキシ | 既知token/owner/spenderへの残高・allowance、履歴blockの値を新たに問い合わせ可能 | 必ずRPC数が増える。送信を待たせれば順序/時間が変わり、並行読取なら同一境界の保証がない。読取そのものはnonceを消費しないが、遅延・retry・block進行により後続取引のnonce観測や順序は変わり得る |
| D. 終了後の履歴状態読取 | 保存されているblockを指定して、その確定断面の残高/allowanceを再取得する候補 | 既存ファイルの読取ではなく追加RPC。run終了後なら過去の送信は変えない。worker buffer、queue、送信直前の未採掘集合、実際に返ったread結果は復元しない |
| E. loaderによるプロセス内計測 | 理論上はRunner/Worker/Senderの関数・通信境界を観測可能。既存試作はその一部だけ | ディスクbytesは保ててもprototype、Worker生成引数、Promise処理、実効コードと時間が変わる。今の試作は要件4の記録器ではない |

## 4. (a) 外部RPC入口の到達範囲

coordinatorは子の`ERIS_RPC_URL`を`ERIS_AGENT_RPC_URL || rpcUrl`で設定する（`core/src/realtime/agentProcess.ts:186-192`）。botMainはそれを読み、clientを生成する（`example/agents/runtime/botMain.ts:183,270-274`）。workerもcontextの同じURLから別clientを作る（`example/agents/runtime/strategyWorker.ts:21-26`）。SDKはHTTP transport、retry 2回、JSON-RPC batch、Multicall3による複数readの集約を使う（`sdk/src/chain.ts:34-75`）。

ここに新規の外部記録プロキシを置く構成は、標準runtimeファイルを編集しない入口として具体的である。ただし**既存gatewayのアクセスログが完全なtranscriptを保存しているわけではない**。現gatewayの通常記録はmethod/所要時間/status/client等で、params/result本文ではない（`infra/rpc-gateway/gateway.mjs:513-525`）。要件4向けの完全なRPC記録器は調査対象の `g3/loader`、runtime、SDK、core内に **not found in files**。

### 4.1 受動捕捉で分かること

- 既に発行された`getBalance`/`balanceOf`/`allowance`の要求と応答。Multicallの内部callを復号する場合も、外側RPC IDと内部順序を保持する。高水準clientの呼出順や判断IDへの一意対応は通信だけでは保証されない。
- 署名済みraw transactionのgas limit、fee、nonce、宛先、value、calldataと応答hash。既存gatewayもraw bytesからgas limitを読む（`infra/rpc-gateway/gateway.mjs:179-213`）。取引内容の解析は新たな送信ではない。応答が失われてもraw bytesからhashを導出して後日照合する設計は可能だが、受理/採掘を推測で確定しない。
- Senderが実際に要求したreceipt応答。ただしSenderのownTx ringは上限を超えると、全件未解決なら最古を落とす（`example/agents/runtime/send.ts:173-181`）。既存のreceipt pollが全送信を永久追跡するとはいえない。

独立した親clientとworker client、複数agentのRPC IDは衝突し得る。接続/要求ごとの記録IDとbatch内IDを区別し、応答順を要求順に読み替えない。共有URLへのreadからagent/decisionを識別するタグは上記client構築に **not found in files**。coordinatorは別URLを使い得る設計なので、agent用プロキシだけでcoordinatorのreceipt取得もすべて見えるとはいえない（`core/src/realtime/agentProcess.ts:186-192`）。

### 4.2 追加readをしても「同時snapshot」にはならない

送信要求を保持してbalance/allowance読取を`await`すれば、ノードへの送信到着が遅れる。並行に発行すれば、その間のblock更新、先行取引の採掘、別agentの取引と競合する。RPC batchも、それだけでreadと送信を一つの原子的操作にする根拠にはならない。同一block番号に固定した複数readはその断面を揃える方法であって、実send瞬間の予約状態を保証しない。

読取は新しいチェーン取引を作らず、直接nonceを増やさない。一方、Senderは`pending` nonceを初回/再同期で読み、ローカルに増番する。送信例外時にはnonce cacheを捨てる（`example/agents/runtime/send.ts:139-166,248-290`）。プロキシによる遅延や応答切断がこの経路を変えれば、実行全体のnonce取得結果や送信順も変わり得る。「read-onlyだから挙動不変」とは認定できない。

既存gatewayは`pending`状態読取を原則拒否し、例外は`eth_getTransactionCount`だけ。block指定を省いた`eth_estimateGas`には`latest`を補う（`infra/rpc-gateway/gateway.mjs:132-175,465-480`）。従ってpending balance/allowanceを問い合わせて予約額を埋める案は、この経路ではそのまま成立しない。直接ノードへの迂回やgateway挙動変更は提案しない。追加readは重み付きレート制限の対象でもある（`infra/rpc-gateway/gateway.mjs:504-510`）。

## 5. (b) 既存ファイルからの事後観測

### 5.1 mempoolログ

これはcoordinator自身による全mempoolの記録ではなく、agent側`createMempoolLog`が`agents/<id>.jsonl`に書く申告である（`example/agents/runtime/send.ts:29-35`）。成功時はhash/nonce/priorityFeeとactionType/protocol/amount/bundle/blockSeen等が得られる（同 `:265-284,359-373`）。`bad_action`は元actionを保存せず、guard/validation拒否にも全判断ID・routeはない（同 `:301-335`）。送信失敗は受理済み応答喪失の可能性を含む（同 `:285-290`）。

残高、spender別allowance、gas limit/最大費用の全成功送信分、queue予約台帳を常に保存する欄は **not found in files**。さらにappenderには行切詰め・総量上限・書込失敗の黙殺がある（`example/agents/runtime/agentLog.ts:78-131`）。既存ログの「行がない」は「試行がなかった」ではない。

### 5.2 blocks.csvとreceiptの区別

coordinatorはblock内の取引を読み、各hashのreceiptからstatus/gasUsed/logs/contractAddressを取得する（`core/src/realtime/coordinator.ts:2838-2874`）。保存するCSVにはblockNumber、txIndex、hash、from、ownerId、fee列、status、gasUsed、to/value等がある（`core/src/logger.ts:8-59,142-146`）。hashでmempool申告と結べば、**一致した送信の包含とその順序、未照合の申告集合**を確認できる。未照合だけで不採掘を確定しない。

ただし、receipt全文を個別JSON/JSONLとして永続化する標準producerは、調べた `core/src`、`example/agents/runtime`、`sdk/src` 内では **not found in files**。CSVはreceipt由来の一部であり、receiptのlogs、blockHash、effectiveGasPrice、取引gas limit、nonce、calldata全文を保存しない。coordinatorはlogsを帰属判定にも使うが、その値は`blockRow`へ渡していない（`core/src/realtime/coordinator.ts:2906-2943`）。「receipt filesが既にある」と仮定して不足を埋めない。別のrun固有ファイルが存在するかは今回未確認。

receipt取得失敗時はstatus=`mined`、gasUsed不明となる（`core/src/realtime/coordinator.ts:2864-2871`）。これは成功receiptではない。現監査器は候補行のstatusが`1`/`success`以外なら`candidate mined revert`としてFAILにする（`ascon-notes/league/g3/chain/revision_audit.py:101-104`）。この実装上の分類と、「receiptを取れず本当の実行結果は不明」という証拠の意味を区別し、成功に読み替えない。

通常runのCSVは終了後のscanで完成する。segment運用では`bn - 1`までを順次flushし、最後に残りをflushする（`core/src/realtime/coordinator.ts:2834-2837,4405-4413,4549-4558`）。途中の空CSV、最終segmentだけ、ログ切詰め、reset後の再読取を完全性の証明に使わない。

### 5.3 events.jsonl

少なくとも事後再構成経路の`observation`は`reconstructed:true`、round、価格、inventory価値などで、実worker入力の残高frameを保存しない（`core/src/realtime/reconstruct.ts:1282-1306`）。`events.jsonl`への書込時刻はappenderの現在時刻である（`core/src/logger.ts:135-139`）。過去のblockに対する再構成eventの時刻を、判断や送信が起きた実時刻として使わない。

`g3_decision_started`、`g3_action_attempt`、`audit-frames`のproducerはruntime/SDK/coreおよび現loader内に **not found in files**。監査契約もstockにこれらがないと記す（`ascon-notes/league/g3/chain/REVISION-AUDIT.md:69-75`）。CSVのtxIndexは包含順であり、return/submitの順やSender queue順の代わりにはならない。

## 6. (c) マージ済みloaderと、未実装のhook候補

設計文書の§3–4はprototype/Worker/局所計装の候補比較であり、実装済み一覧ではない（`ascon-notes/league/G3-LOADER-FEASIBILITY-2026-10-08.md:28-53,91-109`）。現在の実装を直接読むと次の範囲に限られる。

- `probe-loader.mjs`はNode `v24.13.0`、tsx `4.23.13`を固定する（`ascon-notes/league/g3/loader/probe-loader.mjs:9-15`）。worker側は登録印を記録するだけ（同 `:20-26`）。
- 親側でWorker生成、dispatch ID、受信message種別を記録するが、observation/action本文は記録しない（同 `:93-133`）。`setSource/start/decide/close`も識別情報と成否を記録し、結果の経済値を保存しない（同 `:148-183`）。
- versionはfixtureが明示登録した値で、botMainの管理versionではない（同 `:59-73`）。Sender、queue、wallet送信、receiptのhookはこのloaderに **not found in files**。
- READMEもstock botMain/live/提出artifactではないとし、Senderを作らないこと、要件4未着手を明記する（`ascon-notes/league/g3/loader/README.md:3-20,30-33,176-180`）。今回この試作の既存テスト結果を再検証していない。

将来、標準ファイルを編集せずに計装する具体的候補は `Sender.submit`、`enqueueSend`、`sendBuiltTx`、`adapter.buildTxs`、wallet送信、receipt解決。位置は `example/agents/runtime/send.ts:169-170,184-191,295-397,490-506`。ただしtaskはclosureであり、単にqueue入口をwrapしても元action/金額は読めない。botMainのrouteを持つcall siteから、frame/route/ordinal → intent → task → transaction hashへの別台帳が必要（`example/agents/runtime/botMain.ts:631-636`）。これは今のloaderの機能ではない。

probeは同期書込、Workerへの追加データ、元listenerより前の処理、Promise wrapperを伴う。既存コードにもその変更がある（`ascon-notes/league/g3/loader/probe-loader.mjs:103-126,165-181`）。記録失敗やversion未登録は例外になるため、fixture用bindingを持たないbotMainへそのまま付けるだけの構成でもない（同 `:45-73`）。時間干渉や実効構成差はREADMEにも列挙される（`ascon-notes/league/g3/loader/README.md:160-174`）。disk bytesが同じでも、全nonce/fee/順序/5秒期限判定が同じとは主張できない。

## 7. 小項目ごとの取得可能性と欠落

監査行の対応は§2を前提とする。ここでは各値について取得位置と影響を具体化する。

### 7.1 balance（token残高とガス用ETH残高） — PARTLY

**既存hook:** `Reader.snapshot`が`getBalances`を呼び（`example/agents/runtime/read.ts:137-143`）、SDKがETH/WETH/base/stable残高を並行に読む（`sdk/src/chain.ts:144-190`）。受動プロキシはその実応答を記録できる。将来のSender入口計装なら、Senderが検証に使った`balancesAtDecision`も取れる（`example/agents/runtime/botMain.ts:626-636`、`example/agents/runtime/send.ts:295-300`）。

**不足:** `getBalances`の各readはblock番号を固定していない。`snapshot(bn)`のラベルだけで全部がblock bnの原子的snapshotだったとは断定できない。判断中・queue待ち中の採掘後残高とは別。全action境界で再読取するproducer、実worker入力とwire応答の完全bindingは **not found in files**。監査の残高検査は `ascon-notes/league/g3/chain/revision_replay.mjs:17-24,49-53,60-62`。

**影響:** 既存応答の事後解析は追加RPCなし。プロキシ記録は遅延あり得る。追加readならRPC数と待ちが増え、履歴block読取ならそのblock断面の再構成に限定する。

### 7.2 per-spender allowance — PARTLY

**既存hook:** 起動時`ensureVenueApprovals`がsetupWalletのapprove calldataを復号し、token/owner/spender別にallowanceを読む（`example/agents/runtime/botMain.ts:559-585`）。プロキシならその要求・成功応答を取得できる。ただし失敗を0扱いにする内部catchもあるため、読取失敗を実allowance=0の観測としない（同 `:575-582`）。

spenderはactionの実市場・送信先に結び付ける必要がある。例えばUniswapはrouterとposition managerの両方に承認し（`sdk/src/protocols/uniswap.ts:1691-1705`）、Curveは市場ごとのpoolへ承認する（`sdk/src/protocols/curve.ts:599-619`）。同じtoken/actionTypeでも複数poolがあり得るので、監査の`allowances[token][actionType]`だけでは由来が失われる。複数spenderの値を一つに勝手に集約しない。監査要求は `ascon-notes/league/g3/chain/REVISION-AUDIT.md:60-67` と `ascon-notes/league/g3/chain/revision_replay.mjs:54-56`。

**不足:** 起動時allowanceは各actionの実送信境界の値ではない。approve成功申告や初期最大承認から、その後のallowanceを推定して固定することもできない。全actionの実token/spender解決・境界readのproducerは **not found in files**。実txがまだないparse/validation拒否も含め、wireだけでは全対応を作れない。

**影響:** 新たな`eth_call`による追加readはnonceを直接消費しないが、RPC負荷・待ち・競争順を変え得る。履歴readで得るallowanceは指定block断面であり、契約が求める実境界採取の代用にはしない。

### 7.3 reserved / unincluded token amounts — 全量取得は現方式ではNOT-FEASIBLE

**既存hook:** mempool成功申告のhash/amountとCSVのhashを突合すれば、「申告はあるが対象CSVには包含が見えない」集合は作れる（`example/agents/runtime/send.ts:278-284,359-373`）。受動プロキシを加えれば応答喪失したraw transactionも追跡候補になる。これは予約額そのものではない。

**不足:** 未送信queue、build失敗、RPCへ届かない拒否、worker buffer/破棄は外から分からない。amountはtoken識別・route・複数txの区別を常に持つわけではなく、一actionが複数txになれば単純合計は二重計上になる。`sendQueue`はPromise鎖で、token予約台帳ではない（`example/agents/runtime/send.ts:98-105,169-170,337-375`）。`pendingReservations`を供給するstock変数/producerは **not found in files**。監査は具体額を要求する（`ascon-notes/league/g3/chain/revision_replay.mjs:17-24,51-53`）。

**将来候補と影響:** 全queue/intent/送信/receipt境界を観測した監査側台帳は設計余地がある。ただしこれはstockの予約値の読取ではなく導出値。予約開始・解放、同nonce再送/置換、応答喪失、revert、終了時未解決を定義し、全観測の由来を実証する必要がある。現loaderは未対応。chain残高差やpending nonce差、欠測時0では埋めない。

### 7.4 gas fee / maxGasCostWei — PARTLY

**既存hook:** 送信処理のblock/fee/gas算定は `example/agents/runtime/send.ts:196-229,248-259`。raw transactionの捕捉なら最終gas limitとfeeを得られる。gas estimate失敗時にpendingがあると固定gasを使う分岐もあり、estimate応答だけを最終gasとしない（同 `:223-228`）。fee算定は `sdk/src/feeRule.ts:48-60`。

**事後ファイル:** CSVのgasUsedとmaxFeePerGasWeiは実使用量と署名上限単価で、gas limitではない（`core/src/logger.ts:29-45`）。標準Senderが`participantFees`で両feeを同値にした取引なら、使用量×当該単価による実ガス費の導出に根拠がある（`sdk/src/feeRule.ts:3-16,48-60`）。ただし欠落列、規則違反、未確認の取引形式まで同一視しない。receiptのeffectiveGasPriceを得られれば実支払単価と直接照合できるが、その値の標準CSV保存は **not found in files**。実支払費用と送信前最大費用は別。

**不足:** `maxGasCostWei`は1本のtxでなく判断の全action分（`ascon-notes/league/g3/chain/REVISION-AUDIT.md:63-64`）。署名後のgas limit×maxFeeから個別上限を導出できても、route/intent/複数txの対応がないまま全判断の上限にはできない。まだbuildされていないqueueの費用も取れない。現監査は正の最大費用とガス余力を要求する（`ascon-notes/league/g3/chain/revision_replay.mjs:58-63`）。

**影響:** raw bytesの解析だけなら追加RPC/nonceなし。計装・プロキシの遅延は残る。追加estimateはRPCを増やし、状態によって結果が変わるため元の送信時費用の証拠に置換しない。

### 7.5 pendingGasWei / gasReserveWei — 全量取得は現方式ではNOT-FEASIBLE

**既存の類似値:** `gasByRound`はgas limitのblock予算であり、ETH建て予約ではない（`example/agents/runtime/send.ts:102-105,235-263`）。補充targetは`1,500,000 × (2 × baseFee + tip) × headroom`で計算する補充基準（同 `:49-54,407-425`）。監査のガス予備を表す実装変数ではない。

**不足:** 現監査が要求する具体的な`pendingGasWei/gasReserveWei`のproducerは **not found in files**。targetをそのまま予備へ改名したり、gasByRoundをweiに読み替えたりしない。receiptから分かるのは採掘済み使用量であり、境界時点で維持すべき予備額を遡って決められない（`ascon-notes/league/g3/chain/revision_replay.mjs:60-62`）。

**将来候補と影響:** 既知の未採掘raw txの上限費用を集計する部分台帳は可能でも、未署名queue、未観測送信、予約解放まで含む完全台帳ではない。予備方針と実境界への結合の根拠が必要であり、監査用の数字を後付けしない。追加readだけで解消しない。

### 7.6 receipt / block correspondence — 採掘済み部分はFEASIBLE、全対応はPARTLY

**既存hook:** CSVとmempoolのhash join、Senderのreceipt取得、coordinatorのblock scan（`example/agents/runtime/send.ts:490-506`、`core/src/realtime/coordinator.ts:2838-2943`）。完全な記録が残っている採掘済み集合のstatus/包含block/index照合は、ファイル事後処理だけでも可能。

**不足:** receipt全文、原blockHash、失敗時の未取得receipt、run末尾未採掘分、frameごとのhash帰属。CSVの`direct`やmethodは高水準routeではない（`core/src/realtime/coordinator.ts:2930-2935`）。監査の候補全hash照合は `ascon-notes/league/g3/chain/revision_audit.py:243-259`。全raw sendを見ても採掘失敗/未確認を自動的にrevertとはできない。

**影響:** 既存ファイルの事後joinは追加RPCなし。不足receiptをノードから取得するなら追加RPCであり、既存ファイル読取と区別する。run中に取得すると、通信量・遅延・順序に影響して実行挙動を変え得るため、run終了後に行う案を先に検討する。agent用プロキシがcoordinatorの経路を見ない場合、coordinatorが取得したreceipt全文は捕捉できない。

### 7.7 all events / attempts / safety counts — 既存ファイル・RPC・現loaderだけではNOT-FEASIBLE

監査の全attempt照合は `ascon-notes/league/g3/chain/revision_audit.py:212-238,248-259`。workerでactive終了後に捨てられたsubmit、Runnerで破棄されたbuffer、Senderの送信前拒否はRPCに出ない（`example/agents/runtime/strategyWorker.ts:62-83`、`example/agents/runtime/strategyRunner.ts:139-163,190-219`、`example/agents/runtime/send.ts:301-335`）。既存loaderは受信種別しか保存せず、unsafe/late試行の不存在を証明できない。必要な完全producerは **not found in files**。

さらにgas補充は判断と独立してqueueへ入り（`example/agents/runtime/send.ts:407-478`）、起動approvalはSenderを通らず`sendAndMine`から送る（`example/agents/runtime/botMain.ts:587-602`）。coordinatorは派生送信元も候補に帰属させ得る（`core/src/realtime/coordinator.ts:2887-2916`）。これらのreceiptを落とすことも、架空のreturn/submitへ付けることもできない。補助送信を含む全hashと実判断の関係を忠実に表現する設計は残課題。現gateを外す提案ではない。

## 8. block指定の再構成で分かること・分からないこと

ローカルchainの履歴状態をblock番号で読む仕組みは既にある。評価再構成はreset前に過去blockを読み（`core/src/realtime/reconstruct.ts:1-10`）、multicallへ`blockNumber`を渡す（同 `:320-327`）。これを根拠に、**履歴状態が残っている場合**にbalance/allowanceをblock固定で問い合わせる設計は可能と判断する。全履歴が常に利用可能という根拠は **not found in files**。同ファイル `:64-65` は履歴深さ約1,050に対する1,000blockの警告基準を持つが、今回hostの実保持量を測った値ではない。

区別すべき再構成は以下の3つ。

1. **block断面のread:** block Bの確定状態を読む。Bで採掘された取引後の状態であり、そのblock内の各取引直前ではない。B−1もB内の先行取引を反映しない。実際にruntimeが`latest`から受け取った値や、その時刻と一致するとは限らない。
2. **取引順の状態再実行:** B−1からblock B内の取引を順に適用すれば各tx前後状態を調べる方法は考えられるが、それはblock指定readだけではない。要件4向けの完全な状態再実行producerは **not found in files**。仮に作ってもworker/queueの内部予約や送信試行を再現した証拠にはならない。
3. **既存の監査replay:** `revision_replay.mjs`は保存された高水準read transcriptをstubで返し、executor出力を比較する。未知readを外部RPCへ送らない（`ascon-notes/league/g3/chain/revision_replay.mjs:71-85,114-139`）。chainを履歴再実行して実境界値を採取する処理ではない。

block番号だけではresetや別worldとの混同を防げない。将来の履歴読取記録ではworld/chain識別、block hash、token/owner/spender、読取指定block、実要求・結果を保持する必要がある。元のログが持たない識別情報を事後に観測済みと偽らない。ノードが履歴を失ったら未取得のままとし、`latest`へのfallbackで穴埋めしない。

完了後の履歴readは過去のruntime動作を変えないが、動いている別実験や次epochと同じノード/CPUを共有すれば負荷を加える。今回のtiming measurementと並行した履歴read、再実行、receipt補完は一切行っていない。

## 9. 判定、最小の次実装工程、リスク

**総合PARTLY。** ファイル事後joinと通過RPC観測には具体的な取得口があるため、全面NOT-FEASIBLEではない。一方、現在の既存ファイル・外部RPC・マージ済みloaderを合わせても、内部の全予約、ガス予備、全attempt、frame↔補助送信を含むreceipt対応が欠けるためFEASIBLEとは認定できない。将来の追加計装まで一般に不可能と断定するものでもない。

**最小の次工程は、外部RPCプロキシの「追加RPCを発行しない記録部分」だけを非送信のオフラインfixtureで試作すること。** 実チェーンやstock botMainにはまだ接続せず、元の要求を渡す先はfixtureのtransportにする。batch内ID、要求/応答の順、エラー、応答喪失、同nonceの複数raw txを区別して記録し、fixtureのmempool/blocksとのhash対応と未解決一覧だけを出す。既存gatewayを改変せず、frameや安全値を捏造せず、監査PASSを出す形式にしない。これは今の試作が全く触れていないwire→hash→receiptの対応を、最小範囲で具体化する工程である。

完了条件は、元要求を各試行につき一度だけ委譲すること、記録器自身のread/retry/再送がゼロであること、params/result/errorを意味変更しないこと、欠測・未完了を検出すること、秘密を保存しないこと。loaderのオフライン成功と同様、これだけでliveの低干渉や要件4充足とはしない。その後も実queue/route計装、spender解決、全経済値の実境界採取、由来と完全性の検証が必要。本依頼ではこの次工程を実装・実行していない。

主なリスク:

- **観測による時間変化:** プロキシ、同期書込、hash、Promise追加、追加readによってblock跨ぎ、skip、5秒timeout、fee/nonce取得時点、包含順が変わる。stockのnonce処理と失敗再同期は `example/agents/runtime/send.ts:139-166,248-290`。
- **見えた通信と全試行の混同:** wireに出ない拒否/buffer、bootstrap approval、gas補充、派生送信元、別clientを落とす。署名取引の集合だけで全return/submitを証明しない。
- **非原子的なsnapshot:** `latest` read、並列batch、queue待ちを同一境界に丸める。block番号を付けた後処理だけではこの問題は解消しない。
- **費用・予約の誤集計:** amountとtokenの対応欠落、bundleの複数tx、同nonce再送、失敗/応答喪失、実使用ガスと上限ガス、補充targetと予備の混同。
- **欠測・帰属:** cappedログ、未解決ringの脱落、CSVの終了後生成、segment不足、receipt取得失敗、同hash/同actionの重複、route/ordinal欠落。
- **履歴喪失:** reset、保持期限、別worldの同block番号。終了時点でchain情報を後から何でも読めるとは限らない。
- **機密:** SDKはRPCヘッダを環境から加える（`sdk/src/chain.ts:48-66`）。プロキシのheaders/URL、loaderのaccount/context、環境変数を丸ごと保存しない。raw transactionの署名は秘密鍵そのものではないが、保存物のアクセスと再送防止も設計対象。
- **監査と実効構成の不一致:** loaderがディスクを変えなくても実行構成は異なる。現r2固定replayの成功、合成fixture、数値だけ揃えたframeをlive収集の認定に拡張しない。

## 10. 変更・読取コマンド・未検証

- 変更は新規の `ascon-notes/league/G3-REQ4-FEASIBILITY-2026-10-09.md` のみ。本文作成には`apply_patch`を使用した。runtime、SDK、core、既存loader、監査器、既存文書を編集していない。開始時の作業ツリー全体のclean状態や全tracked bytesの一致を検査したという主張ではない。
- 読取は `git show --no-patch --format=... HEAD origin/main`、`rg --files`、`rg -n`、`sed -n`のみ。要件・監査・loaderと、agentProcess/botMain/Runner/Worker/Reader/Sender、SDK chain/fee/adapter、coordinator/logger/reconstruct、RPC gatewayを静的に確認した。関連履歴の初期検索に`MEMORY.md`への`rg`も使ったが、今回の判定は本treeの引用箇所に基づく。
- 引用確認は`rg -n '^' <実ファイル> | sed -n '<開始>,<終了>p'`等で行番号付き本文を表示し、引用のファイル・行と内容を目視照合した。引用検査用スクリプト、Python/Node、テストは実行していない。検索の一部で存在しないglobをzshが拒否し、その後実在ディレクトリへ絞って再検索した。否定検索の`rg` exit 1は一致なしであり、テスト結果ではない。
- `g3_decision_started|g3_action_attempt|pendingReservations|pendingGasWei|gasReserveWei|maxGasCostWei|audit-frames`を `core/src`、`sdk/src`、`example/agents/runtime`、`ascon-notes/league/g3/loader`で検索して一致なしを確認した。receiptファイル名・書込とeffectiveGasPriceも関連sourceで検索し、coordinatorの取得処理とCSV schemaを直接読んだ。**not found in files** はこの静的探索範囲の結果であり、任意の外部記録器が存在しないという断定ではない。
- 明示された低負荷・禁止条件に従い、typecheck、テスト、build、install、Node script、監査/replay/loader実行は行っていない。network、Docker、Anvil、backtest、SSH、モデル呼出、commit/pushも行っていない。オンライン規約を確認していない。
- 未検証: liveプロキシの全経路捕捉/遅延/欠測、loaderのbotMain/Sender到達、全予約・gas予備の成立、実blockの履歴保持、receipt全文のrun固有保存、実chainのnonce/順序/fee/残高一致、提出時の同等性、現行r3の監査認定。実ログを使った全件joinも未実施。本文は静的な実現性分析であり、G3成功やruntime-readyを報告するものではない。
