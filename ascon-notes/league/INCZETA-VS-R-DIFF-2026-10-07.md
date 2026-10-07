# inc-zetaとr系の挙動差：静的原因調査 — 2026-10-07

**約3 Tの差を、パラメータ固定化による性能低下とは説明できない。原因は未確定。** 確認できたinc-zetaのroster設定 `{bidMode:2, bidProfitShareBps:3000, gasPerSwap:140000}` は、修理前の `ascon-zeta-r` に埋め込まれた値と一致する。この設定が実走でも適用され、専門機能の追加設定がなく、コード改訂が停止していれば、現在のinc-zetaとrは同じ観測・内部状態・自身のアドレスに対応するRPC応答なら同じ取引判断をする実装である。r2/r3の修理には取引を変える差があるが、修理のないE2の差まで説明する共通原因にはならない。

E2の同一世界内r − inc-zetaは **−2.72、標準誤差（standard error、SE）2.58、近似95%区間 [−7.88, +2.44]、15/36勝**（`results-2026-10-07/e2-paired-r-vs-inczeta.txt:29`）。負の点推定は観測事実で、持続的な約3 Tの因果効果が確立したわけではない。E1＋E3のr3 − inc-zetaも−3.41だが区間上端は+0.02で、事前ルールの正式判定は未決。統計と実験制約は [RESULTS-E1-E2-2026-10-07.md](RESULTS-E1-E2-2026-10-07.md) に記録した。TはSIMPLIFIED T（世界内の損益を標準化して世界間を等重み平均した簡易T）であり、公式の後半エポック加重Tではない。

## 用語

本文のZは `example/agents/ascon-zeta/`、r/r2/r3はそれぞれ `example/agents/ascon-zeta-r/`、`ascon-zeta-r2/`、`ascon-zeta-r3/`。inc-zetaはZを参照する対戦枠の名前。rosterは参加者と設定の一覧、frozenはLLMによるコード改訂を停止する指定、bundleは複数の取引脚をまとめたアクションを指す。ETHはEther、WETHはWrapped Ether、USDCはUSD Coin、eUSDはここでLiquityが扱うステーブルコインのシンボル。Pは終了時資産価値から求める損益、noopは何もしない比較対象。数量・価格・手数料の説明はこのシミュレーター内の値を指す。

## 調査範囲と証拠の強さ

- 読解対象は `docs/e3-pooled-results`、HEADおよびローカルの `origin/main` が `b4e0ecc` のソース。ネットワークでoriginを更新していない。`example/agents/ascon-zeta{,-r,-r2,-r3}/` の全ファイルを比較した。以下のfile:lineはこのworktree基準。
- 指定の `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-r2/ascon-notes/` と現worktreeの `ascon-notes/` について、無視対象も含めroster名を探索したが、**`roster-mix-r3-frozen.yaml` およびE1〜E3の実走roster原本・manifest・全世界indexは見つからなかった**。名前・集計表のagent idだけから、実走設定を確定していない。
- 代替根拠として `ascon-notes/league/roster-league-r1.yaml:17`–21にinc-zetaの明示定義を確認。このrosterと上記4エージェントの全ファイルは、release-r2 worktreeの同名ファイルとバイト一致した。ただしこれは現在のローカル2 worktree間の一致で、mini/Airの実走hashの証明ではない。`ascon-notes/league/g3/mix-off.yaml:69`–75にも同じinc-zeta設定があるが、これをE1〜E3のrosterと取り違えない。
- 以下の「同じ」「変わる」は静的なコード経路の判断。「実走で発火した」「損益差の原因だった」という主張ではない。エージェントを起動した動作比較・取引ログ照合・再計測は行っていない。

## inc-zetaの定義と設定がコードに届く経路

inc-zetaはディレクトリ名ではなくroster上の識別子（id）。確認できた定義は `id: inc-zeta`、`dir: ascon-zeta`、`wallet: AUTO`、`ERIS_AGENT_FROZEN: "1"`、`ASCON_DELTA_PARAMS: '{"bidMode":2,"bidProfitShareBps":3000,"gasPerSwap":140000}'`。`ASCON_ZETA_PARAMS` とlaunch個別設定はこの行にない（`ascon-notes/league/roster-league-r1.yaml:17`–21）。shareの実際のキーは `bidProfitShareBps`、gasは `gasPerSwap` であり、`share` / `gas` というキーを渡してもparserは読まない。

| 経路 | 静的に確認した扱い | 取引への意味・限界 |
|---|---|---|
| roster → process | `core/src/config.ts:209`–232はenvが文字列mapであることを検査して保持。`core/src/realtime/agentProcess.ts:159`–178で親の許可された環境、extraEnv、最後にspec.envを適用する | 正しいrosterの `ASCON_DELTA_PARAMS` は親の値より優先して子へ届く。親にあるASCON系の任意変数は一般継承されず、roster/extraEnvに載せる必要がある。ERIS系のlaunch設定は親からも届き得る。実走のroster/extraEnvは未確認 |
| id → directory | `core/src/realtime/agentProcess.ts:224`–233は `spec.dir ?? spec.id` を使う | この定義ならinc-zetaが読むのはascon-zeta。id文字列自体がbidMode等を選ぶ分岐は当該戦略にない |
| process → strategy worker | `example/agents/runtime/strategyRunner.ts:84`–92で `strategyEnv()` を渡す。`example/agents/runtime/strategyEnv.ts:58`–75は秘密設定を除く方式で、ASCONのPARAMS名・ERISのlaunch設定を除去しない | 現コードでは「worker境界で3パラメータが失われる」という説明は支持されない。実走版・経路の一致は別途必要 |
| 読込時点 | `example/agents/ascon-zeta/delta.ts:51`、`example/agents/ascon-zeta/agent.ts:18`でモジュール読込時にenvをparse | 各判断のたびにenvを再読込しない。r系は定数コピーなのでenvを書き換えてもこれらのPARAMSは変わらない |
| 改訂停止 | `example/agents/runtime/botMain.ts:494`、523–533は `ERIS_AGENT_FROZEN === "1"` ならdecideモードとし、改訂用promptをロードしない | frozenならpromptの文言は取引判断に影響しない。ただしE1〜E3の実際のfrozen値はroster原本/ログで未確認 |

## 全パラメータの比較

下表のinc-zeta実効値は、上記rosterの3キー以外に上書きがない場合の**コード上の到達値**。実走プロセスから採取した値ではない。根拠は `example/agents/ascon-zeta/delta.ts:7`–51、`example/agents/ascon-zeta-r/delta.ts:7`–53、`example/agents/ascon-zeta-r3/delta.ts:8`–53。r2のTypeScriptはr3とバイト同一。

| パラメータ | ascon-zetaの既定値 | inc-zeta実効値 | r / r2 / r3の固定値 | 差による取引変化 |
|---|---:|---:|---:|---|
| bidMode | 0 | 2（env） | 2 | 正しく適用されれば差なし。env欠落ならincだけ既定優先手数料へ戻る |
| bidProfitShareBps | 3000 | 3000（env） | 3000 | 差なし。利益予算30% |
| gasPerSwap | 200000 | 140000（env） | 140000 | 差なし。入札予算の推定gas。取引gas limitを直接指定する値ではない |
| bidBumpWei | 100000000 | 100000000 | 100000000 | 差なし。競合手数料への上乗せ0.1 gwei |
| SAFETY_MARGIN_BPS | 50 | 50 | 50 | 差なし |
| MIN_SIZE_BPS / MAX_SIZE_BPS | 250 / 2500 | 250 / 2500 | 250 / 2500 | 差なし。残高の2.5〜25%範囲 |
| SPREAD_GAIN / GAP_GAIN | 200000 / 200000 | 同左 | 同左 | 差なし |
| LEG_SLIPPAGE_BPS / SINGLE_SLIPPAGE_BPS | 120 / 75 | 同左 | 同左 | 差なし |
| useExecutableQuotes | false | false | false | 差なし。実行見積価格への切替なし |
| persistBlocks / inventoryBandBps | 0 / 0 | 同左 | 同左 | 差なし。継続ブロック条件・在庫帯とも無効 |
| endgameNoNewBlocks / bidExtraBps | 0 / 0 | 同左 | 同左 | 差なし。deltaの終盤bundle停止は無効 |

bps（basis points）は1/10000、gweiは10億分の1 ETH。`parseDeltaParams` は数値・有限値・整数・範囲を検査し、不正なキーの値を**境界へclampせず既定値のまま無視**する。未指定キーも既定値のまま、未知キーも無視。MIN_SIZE_BPS > MAX_SIZE_BPSなら両方を既定値に戻す（`example/agents/ascon-zeta/delta.ts:23`–49）。提示の3値はすべて受理範囲内。r系にもparserは残るが、通常の `decide()` はparserを呼ばず固定PARAMSへ進む（r:52–53、r3:52–53）。したがってenv欠落・誤型・別の有効値では挙動差が出るが、提示値をparseしたこと自体に丸め差はない。

専門機能はinc-zetaの `ASCON_ZETA_PARAMS` で `launch / redemption / stabilityPool` のbooleanだけを上書きでき、既定は全true。rは全true固定、r2/r3も同じ（`example/agents/ascon-zeta/agent.ts:6`–18、`example/agents/ascon-zeta-r/agent.ts:6`–18、`example/agents/ascon-zeta-r3/agent.ts:8`–20）。追加上書きがなければ差なし。あればlaunch呼出、償還・回収、Stability Pool（Liquityの安定化プール）の分岐が変わる。ただし既存SP預入に対する清算分岐は `stabilityPool` フラグでは囲まれていない（Z/r:46–49、r3:88–91）。

## inc-zeta → 修理前r：全ソース差分と同一部分

`diff`で確認した差は `agent.ts` のZETA設定読込除去、`delta.ts` のbidMode/gas既定値とenv読込除去・コメント、`prompt.md` のメタデータと終盤説明だけ。`launch.ts` は完全一致する。

| 項目 | コードの比較 | 取引が変わるか |
|---|---|---|
| Delta設定 | 上表のとおりenvから定数へ。`example/agents/ascon-zeta/delta.ts:13,51` → `example/agents/ascon-zeta-r/delta.ts:13,52`–53 | 実効値が同じなら変わらない。別の上書き・欠落があれば変わる |
| 専門機能設定 | `example/agents/ascon-zeta/agent.ts:18` → `example/agents/ascon-zeta-r/agent.ts:18` | 全trueなら変わらない。ASCON_ZETA_PARAMSで無効化していた場合のみ変わる |
| 通常入札の式・丸め・clamp | Z `delta.ts:93`–133とr `delta.ts:94`–134は同じ本文 | 固定化で新たなclamp・順序差は生じない。次段落参照 |
| 取引選択・数量・同点処理 | Z `delta.ts:75`–92,134–202とr `delta.ts:76`–93,135–203は同じ本文。二脚優先、最大spread、単脚は最大gapAbs、同値では先のvenueを維持。`legacyDefaults` はbidMode/share/gasを条件に含めない（r:170） | 提示値ではどちらもlegacy分岐。bidMode固定化が売買方向・機会の並べ方を変える説明は成立しない |
| ディスパッチ順 | Z/r `agent.ts:38`–70,74–86：launch → 余剰WETH回収/ETH wrap → 清算 → SP → eUSD償還 → delta | 同じ。`{...PARAMS, launch:false}` は先行launch後の引数であり、先行launchを止める変更ではない |
| Launch設定・helper | Z/r `launch.ts:20`–55は同一。共有 `example/agents/lib/launchSwap.ts` を使う | 同じenv・状態・RPC応答なら同じ。rの段階ではlaunch設定はまだ固定化されていない |
| prompt | Z `prompt.md:3`–5,25 → r `prompt.md:3`–5,25 | frozenでは変化なし。改訂有効時の違いは下記 |

通常のbidMode=2では `desired = max(defaultFee, competitor + 0.1 gwei)`、推定gasは単脚140000・bundleはその2倍。利益をUSDCの最小単位へ切り捨て、公正ETH価格もUSDCの最小単位へ切り捨てて、BigIntで利益30%分の1 gas当たり予算を計算し、`min(desired, maximum, budgetFee)` を返す。予算がdefaultFee未満、競合情報欠落、価格・数量不正ならdefaultFeeへ戻る。**競合を上回れなくても、通常裁定をskipしない**（Z `delta.ts:93`–121、r:94–122）。単脚の利益edgeはgross gapからvenue手数料と50 bpsを引く。二脚は往復費用控除後edgeを使う（Z:161,197–200、r:162,198–201）。サイズのfloor、min/max、整数数量化も同じ。コメントの変更は取引を変えない。

この条件付き同値性から、E2での約−2.72 Tを「rだけ利益予算が小さい」「固定化でgasが大きくなった」「rだけ通常入札不足で停止した」と説明する根拠はない。

## r → r2/r3：追加された全挙動差

r2とr3の `agent.ts / delta.ts / launch.ts / launchSwap.ts` はバイト同一。以下は両者に適用する。修理前inc-zetaとrは上記条件下で同値なので、inc-zeta対r3の取引差もこの表と設定・prompt差で覆う。

| 差分 | 根拠（file:line） | 取引への作用（発火・損益の実測は未確認） |
|---|---|---|
| Launchの8設定を固定 | `example/agents/ascon-zeta-r/launch.ts:36`–53 → `example/agents/ascon-zeta-r3/launch.ts:35`–52。`numberEnv`の扱いは `example/agents/lib/launchSwap.ts:410`–417 | ERIS_LAUNCH_CONFIRM_BLOCKS=3、MIN_FLOW_BPS=25、SIZE_BPS=2000、MAX_RESERVE_BPS=1000、EXIT_FLOW_BPS=10、MAX_HOLD_BLOCKS=60、EXIT_BLOCKS=12、SLIPPAGE_BPS=1000を定数化。上書きなしなら同値。上書きがあれば参入・退出時点、数量、slippageが変わる。旧の非有限値での起動例外も固定版にはない |
| Launchのallowance（routerへの支出承認額） | 旧helper `example/agents/lib/launchSwap.ts:376`–399 → `example/agents/ascon-zeta-r3/launchSwap.ts:9`–22 | 旧は毎回定額approve＋swap。新はallowanceをRPC（Remote Procedure Call、遠隔手続き呼出し）で読み、十分ならswapだけ、不足ならapprove単独（USDC最大値、他tokenは必要額）にして、確認後の判断でswapする。通常USDC allowanceを縮めず、取引数・承認待ち・約定時点を変える |
| Launchの非同期化と状態更新 | `example/agents/ascon-zeta-r3/launch.ts:162`–166,187–196,229–243。旧はr:165–167,188–197,222–242 | allowance読取を既存のtimeout/deadline内でawait。entry状態はrawBundle時だけ設定し、approveだけなら未参入を保つ。追加RPCの失敗でpoolをskipし得る。退出優先・参入次点の順（r3:245–246）や数量式は不変。承認待ちにより終端の未売却tokenが増減する可能性はあるが方向は未確定 |
| bundleの両脚を既存在庫で確認 | `example/agents/ascon-zeta-r/delta.ts:157`–162 → `example/agents/ascon-zeta-r3/delta.ts:205`–221、`example/agents/lib/affordable.ts:21`–25,33–41,82–83 | 買い側USDCの最低残高1 USDCと必要額を確認、満たさなければnoop。売り側は現在残高が売数量以上かつdust以上かを確認。非WETHのdust判定だけ18桁へ正規化し、必要量照合は実際の桁数のまま。売りを払えなければ買い脚だけを同数量で送る。往復裁定から方向性のある保有へ変わり得る |
| 片脚化時の入札と順番 | `example/agents/ascon-zeta-r3/delta.ts:214`–220 | 買い脚だけでもbundle用利益edge・2倍gas予算・LEG_SLIPPAGE_BPS=120を維持し、単脚探索へは戻らない。通常single-legの75 bpsやその利益式に変わるわけではない。新しいbid式ではなく、新しい発火経路に旧bundle入札を使う差 |
| WETH回収対象の限定 | 旧r `agent.ts:35`–42 → `example/agents/ascon-zeta-r3/agent.ts:24`–26,41–83 | 旧は初期残高を超えたWETHを由来不問で売る。新は自分のETH wrapに対応する厳密な残高増だけを追跡し、min(追跡量,現在残高)を売る。最低0.01 WETH、wrap量とgas用ETH reserveの式は不変。通常裁定購入分を即回収売りしなくなり、手数料・在庫曝露が変わる |
| 回収状態の確認・破棄 | `example/agents/ascon-zeta-r3/agent.ts:34`–35,46–65,118–120 | nonceのpending/latest不一致、wrap/売却後の残高未反映ならnoop。曖昧なwrap増分は帰属させず、売却後にWETH残高が変化すると追跡全量を解除。blockが逆行・飛ぶと追加の追跡状態もreset。回収機会を見送る可能性がある |
| 回収の価格・費用判定 | `example/agents/ascon-zeta-r3/agent.ts:65`–77、`example/agents/ascon-zeta-r3/delta.ts:116`–156 | 旧はdefaultFeeで即売り。新はquote/fairValue − 1 + 35 bpsをedgeとし、競合+0.1 gweiを上限・利益30%予算内で払えなければnull→noop。pool欠落・quote不良もnoop。通常裁定のようにdefaultへ戻したり上限へ切り詰めて送ったりしない。回収量・売却時点・支払手数料が変わる |
| 回収の追加待ちと下位処理の抑止 | `example/agents/ascon-zeta-r3/agent.ts:29,46`–77,112–113,127 | decideWithParamsがasyncになりnonce2件・quoteをawaitする。ここにはlaunchのtimed相当の独自timeoutがない。noop/例外は後続の清算・SP・償還・deltaへ進ませない。通常回収条件外では順番は従来どおり。待ち時間・後続取引数が変わり得る |
| 通常裁定bidFeeの関数切出し | r `delta.ts:94`–134 → `example/agents/ascon-zeta-r3/delta.ts:72`–113,214–215,257–261 | 同じparamsを明示して渡すため、式・clamp順・fallbackは不変。回収用 `recoveryBidFee` の停止条件を通常裁定へ一般化しない |
| prompt | `example/agents/ascon-zeta-r2/prompt.md:31`、`example/agents/ascon-zeta-r3/prompt.md:3`–10,33 | 修理説明、名称/description、r3の改訂抑制文が追加。frozenなら取引差なし。改訂有効なら候補生成・変更頻度へ影響し得る |

旧bundleが常に「資金不足で何もしない」だったとはいえない。現SDK（Software Development Kit、ソフトウェア開発キット）の検証は脚ごとに支出を反映し、stable→baseの推定出力を後続脚に加算する（`sdk/src/action.ts:304`–308,427–432）。既存在庫だけを見るr2/r3の条件の方が厳しい場合がある。この点はE1/r3の差の候補機序にはなるが、同じ旧bundleを使うE2/r対inc-zetaの差にはならない。

## promptの差：frozenと改訂有効時を分ける

全版は `kind: improve`、改訂周期60ブロックで、日々の売買はルールコードが行う（各 `prompt.md:1`–8）。LLM（Large Language Model、大規模言語モデル）はコード改訂役であり、frozenなら呼び出されない（`example/agents/runtime/botMain.ts:523`–533）。

1. inc-zeta側のpromptは「終盤の新規bundle停止を有効のまま保つ」と述べるが、コードのendgameNoNewBlocksは0。rはこの不整合を訂正し、Liquityの20ブロック新規参入停止とlaunchの退出条件を区別する（`example/agents/ascon-zeta/prompt.md:25`、`example/agents/ascon-zeta-r/prompt.md:25`）。改訂有効時なら解釈や提案が変わり得る。frozen時にコード上の終盤条件が変わるわけではない。
2. r2は3修理と通常裁定入札を維持する説明を追加（`example/agents/ascon-zeta-r2/prompt.md:31`）。r3は同説明を残し、`executorTs: null unless the evidence shows a clear improvement` を加える（`example/agents/ascon-zeta-r3/prompt.md:10,33`）。これは文章による抑制で、変更を機械的に禁止する実装ではない。
3. 各版のname/descriptionも異なる（各 `prompt.md:3`–4）。改訂文脈への影響の大きさは未測定。frozenの対戦成績をpromptの良し悪しと解釈できない。

## 残る説明と確認できなかった点

**先に切り分けるべき仮説は、r系共通の戦略劣化ではなく、同時対戦の席・観測・実行経路の非対称性。これは静的同値性からの候補であり、原因を観測した結論ではない。** 同じコードでも別walletが同じ世界で取引すれば、最初の約定差から残高・後続の機会・競合入札観測が分かれる。現在の実装はAUTO walletをagent idから導出し（値は読まず、`core/src/config.ts:75`–76）、roster順にruntimeを作り起動ループを回す（`core/src/realtime/coordinator.ts:899`–908,2357,2414）。同じregime/seedであることは、二者の観測や送信時刻の一致を保証しない。ただし起動順が実際にinc-zetaを有利にした、同額入札の約定順が原因だった、とはログなしにはいえない。

対抗説明は実走設定・コードの不一致、残る標本変動。次の境界が残る。

- 実走rosterのdir/env/frozen、候補・共有helper・runtimeのhash、起動時の追加ERIS_LAUNCH設定、sandbox/command override、保存状態の有無を照合できていない。表の実効PARAMSは静的な条件付き値であり、実走値の断定ではない。
- E1〜E3の取引ごとの注文・nonce・優先手数料・送信時刻・取込順・拒否/失敗・在庫推移・残存launch tokenを読めていない。コード差の発火頻度、約3 Tへの寄与、最初に二者が分岐する箇所は不明。
- r2のTypeScriptはr3と同じだが、E1〜E3にはr2の独立した対戦結果はない。「r/r2/r3がすべて約3 T劣る」と独立した3本の実測証拠にしない。
- E2内のr/inc-zetaはともにAirの同一世界なので、mini対AirだけでE2内の差を説明できない。一方、E1/r3・E3/r3はmini、E2/rはAirであり、実験間の差から修理効果を分離できない。
- 現在のローカルソースの一致は実走一致ではない。E2の区間もE1＋E3の区間もゼロを含むため、再現する恒常的な劣位があると確定できない。

## 今回実施した確認

ローカルのbranch/HEAD/status読取、両worktreeのroster探索、全エージェントファイルのdiffとバイト比較、設定伝達・判断・prompt経路の静的読解、保存された集計・chain抜粋の読取を行った。Pythonによる文書照合では、E3の12順位行、seed別6行、相手別4行、レジーム別24値が保存出力と一致した。Z/rのTypeScriptは文書化した設定読込・既定値・コメントの差を除いて一致し、r2/r3のTypeScriptはバイト一致した。参照先存在・行番号範囲・表の連続性を確認し、`git diff --check` はPASS。新規文書も末尾空白・終端改行の検査を通過した。これらは文書・ソースの静的照合で、動作試験ではない。`npm run typecheck` は `tsc: command not found`（exit 127）で実行不可。依存導入、TypeScriptエージェントの動作試験、全 `npm test`、ネットワーク、Docker、Anvil、backtest、commit/pushは実施していない。

## 最小の切り分け実験（提案のみ）

**E2型のfrozen対戦で、inc-zeta枠の `dir` だけを `ascon-zeta` から既存の `ascon-zeta-r` へ変更し、両枠を同一実装に揃える対照を1つ置く。** r枠・id・wallet割当・席順・相手・seed・ホスト・既存envは維持する。inc-zeta枠に残るASCON_DELTA_PARAMSはrでは読まれない。これは環境読込版対固定版という実装差を取り除き、席に残る差を調べる提案で、新候補を作る提案ではない。実施前に実走rosterの不足を解消し、frozenと同一hashを確認する必要がある。

同一r実装でもinc-zeta席の優位が残れば、設定固定化や3修理を必要としない席・観測・実行経路の説明と整合する。消えれば、元のascon-zeta枠の実効設定/実走版不一致を疑うが、単一追試の変動だけで原因確定とはしない。観測・手数料・取込順・残高が最初に分かれる位置を併記する。このroster変更も計測も、今回実行していない。
