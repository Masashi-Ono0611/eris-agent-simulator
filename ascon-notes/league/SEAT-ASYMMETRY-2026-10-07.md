# 混成場の席の非対称性 — 2026-10-07

同じ判断コードでも、独立プロセスが同じ市場を取り合うため、席ごとの損益は一致しない。**名簿順の資本上乗せや採点ボーナスは確認できないが、起動順・開始前取引・観測と送信の遅延を通じた系統的な席差は可能である。inc-zetaが恒常的に有利か、約3点の差を説明するかは静的読解だけでは不明。** 毎ブロックの判断を名簿順に要求する中央ディスパッチは確認した経路では見当たらず、取引のブロック内順序はノードに委ねられる。同額入札の厳密な順位規則は2026-10-07の静的読解では確認できていない（§3）。

## 対象・証拠の範囲

- 読解対象は `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/docs-seat`、branch `docs/seat-asymmetry-analysis`。確認時のHEADとローカルの `origin/main` はともに `c800a812bddb1aa5b8791673915fee5457701352`。リモートの最新状態は取得していない。以下の `file:line` はこの版のリポジトリ相対パス。
- 席とは、名簿（roster）上の位置、識別子（id）、ウォレット、実行プロセスと設定の組をいう。位置だけとidだけは別の変数である。rは `ascon-zeta-r`、r3は `ascon-zeta-r3`。inc-zetaは `ascon-zeta` を指す名簿上のidで、独立した戦略ディレクトリ名ではない（`ascon-notes/league/roster-league-r1.yaml:17-21`）。
- 2026-10-07の戦略比較 [INCZETA-VS-R-DIFF-2026-10-07.md](INCZETA-VS-R-DIFF-2026-10-07.md) は、指定された環境変数と追加上書きなしの条件でinc-zetaとrが判断上同値とする。r3には修理による挙動差がある。2026-10-07の席差分析ではこの戦略比較を再実行せず、ハーネス側を調べた（`ascon-notes/league/INCZETA-VS-R-DIFF-2026-10-07.md:50-63,72-86`）。
- **E1〜E3**は2026-10-07の混成場診断の実験識別子。E1は候補r3・seeds 65001–65003、E2は候補r・同seeds、E3は候補r3・seeds 66001–66003で、それぞれ12レジーム×3 seed＝36世界。出典は `ascon-notes/league/RESULTS-E1-E2-2026-10-07.md:20-28` と、`ascon-notes/league/results-2026-10-07/` の `e1-mixed-r3-seeds65001-3.txt`、`e2-mixed-r-seeds65001-3.txt`、`e3-mixed-r3-seeds66001-3.txt`。**E4**は下記のA/A対照実験を指す。
- **R1 / U1**は保存名簿のリーグ識別子。R1は11席の初回名簿、U1は新upstream向けにR1へzeta-2を追加した12席の名簿（`ascon-notes/league/roster-league-r1.yaml:1-27`、`ascon-notes/league/roster-league-u1.yaml:1-28`）。E1〜E4の実走名簿との一致は未確認。
- E1＋E3の保存集計のr3 − inc-zetaは72世界で −3.41、SE（standard error、標準誤差）1.72、近似95%区間 [−6.85, +0.02]。再集計した値ではない（`ascon-notes/league/RESULTS-E1-E2-2026-10-07.md:3,14-16`）。SIMPLIFIED T（簡易偏差値）は各世界のnoopを含む全員の損益Pから `50 + 10 × (P − 平均P) / 母標準偏差` を求め、世界を等重みで平均する。公式の基準エージェント除外・エポック加重とは異なる（`ascon-notes/league/remote/agg_mixed.py:43-61,71-81`、`core/src/scoring/deviationScore.ts:3-18`）。
- **E4 A/A（同一実装を両席に置く対照実験）**は、inc-zeta席のコードをr3に置換し、候補席もr3、その他の名簿を維持する設計。`e4aa-...`、seeds 67001–67003というパラメータの出所は、2026-10-07の実走コマンドライン（起動ログに記録、リポジトリには未収録）とするレビュー時の情報である。起動ログの正確なパスと原文は未確認で、このworktreeの保存結果にもE4のファイルは見つからない。実効設定・実行状態・結果を確認済みとは扱わず、以下では指定された設計としてのみ論じる。
- ネットワーク、Docker、Anvil、backtestは実行していない。規約の正本は https://ascon.dev/rules だが、オンラインの現行本文は未取得。2026-10-07の席差分析での規約への言及はローカルの `docs/competition-start.md` と仕様文書に記載された範囲であり、本番運用の確認ではない。

## 1. AUTOウォレット・初期資産・nonce

### ウォレットは席番号ではなくidから決まる

`wallet: AUTO` は `environmentKey("agent", agentId)` を呼ぶ（`core/src/config.ts:75-76`）。導出はHMAC（Hash-based Message Authentication Code、ハッシュを用いたメッセージ認証コード）のSHA-256方式で、入力は導出方式名・種類・id。秘密値は設定ファイルから読むか、未指定ならプロセスごとに乱数で生成して保持する。**名簿index、戦略dir、世界のseedは導出入力ではない**（`core/src/walletKeys.ts:65-76,92-101`）。秘密値や秘密鍵の内容は読んでいない。

したがって同じ秘密値とidを保持してdirや名簿位置だけを変えてもウォレットは変わらない。idを変えると別ウォレットになる。同一プロセス内の複数世界では秘密値が保持されるが、別プロセスで秘密値ファイルを指定しなければ同じidでもアドレスは変わる。単にseedを固定するだけでは同じウォレットにならない。

この区別は実験ランナーにも関係する。`run-matrix.sh` は各regime/seedについて別の `npm run backtest` を起動し、同じrosterパスを渡す（`ascon-notes/eval/run-matrix.sh:91-99,155-165`）。一方、backtest CLI（Command-Line Interface、コマンドライン操作用プログラム）自身のシナリオ反復は、動的importしたcoordinatorの `runRealtimeSimulation` を同一プロセス内で呼ぶ（`core/src/cli/backtest.ts:658-663,913-936`）。渡されるコマンド風の配列は子プロセス起動用ではなく、関数本体が `argv` として受け取り `resolveRunInputs(argv, overrides)` に渡す設定解析用の引数である（`core/src/realtime/coordinator.ts:609-625`）。実走で秘密値を固定していたかは未確認であり、「inc-zetaのアドレスが72世界ずっと同じ」とは言えない。

### 配布順は名簿順だが、指定金額は共通

名簿検証は配列の `map` で順番を保存し、runtimeも同順で作る。登録ファイルからの追加参加者はその後ろに付く（`core/src/config.ts:96-108,225-238`、`core/src/realtime/coordinator.ts:899-919`）。資金配布対象はまずこのagent配列、その後に環境の取引ウォレット。配布は逐次 `await` なので、先の席が先に配布・承認を済ませる（`core/src/realtime/coordinator.ts:1244-1265,1311-1339`）。

ただしagentに選ばれる値は共通の `initialEthWei / initialWethWei / initialUsdcUnits / initialBaseAmounts` で、名簿indexやアドレス大小による金額分岐はない。ETH（Ether）の追加ガス用バッファもagent全員0である（`core/src/realtime/coordinator.ts:1270-1294`）。ローカル配布はETH残高設定、必要時のWETH（Wrapped Ether）への変換、USDC（USD Coin）等への残高設定を行う（`sdk/src/chain.ts:1020-1049`）。外部チェーンでは既存残高を考慮した補充になるため、既存資産の異なるアドレスを使えば別の条件になる（`sdk/src/chain.ts:1089-1112`）。

**指定配布額の同一性は、setup後の実残高が最小単位まで同じという保証ではない。** WETHへの変換とvenue（取引先プロトコル）の承認は実取引で、ガスを消費する。setupの承認は共通の送信処理を通り、個々のウォレットでnonceを進める（`sdk/src/chain.ts:1021-1030,725-759`）。実際の初期残高はsetup後に各アドレスから取得され、`initial_endowment` に評価値と最大/最小比が記録される（`core/src/realtime/coordinator.ts:1518-1546`）。このログとsetupのreceipt（取引実行結果）を確認していないため、残高差の有無・金額・ガス差の原因は不明。

### nonceは全員0ではない

nonce（同一送信者の取引連番）は席番号で割り当てない。ローカルでresetを行う場合、配布前に全既知ウォレットへ**同じ** `floor(Date.now()) × 1000` の下限を適用する。アドレス群は重複除去され、並列に処理される。既に下限以上のnonceは維持する（`core/src/realtime/coordinator.ts:1070-1088`、`core/src/realtime/nonceFloor.ts:30-63`）。この下限はseedではなく開始時刻に依存し、外部チェーンまたは `skipReset` ではこの処理をしない。

以後は配布時の変換・承認と各agent自身の取引で増える。ランタイムは自分のアドレスのpending nonceを読んで連番を払い出す（`example/agents/runtime/send.ts:139-146`）。別アドレスのnonceの大小を比較して席の優先順位を作る処理ではない。

**判定：** indexによる追加配布・index由来の初期nonce優先は、**確認した経路では見当たらない**。配布順によるsetup状態差、アドレスごとの既存状態、実残高差を介した差は**可能だが、E1〜E4での発生は不明**。アドレスの辞書順を資金・送信優先順位に使うコードは確認した経路では見当たらない。ノード内部や全プロトコルにわたるアドレス依存効果まで不存在を証明したものではない。

## 2. 判断の要求順・送信順・seedとの関係

### 起動は名簿順、判断は独立

coordinatorは `for (const agent of agentRuntimes)` の中で各プロセスを作る（`core/src/realtime/coordinator.ts:2357,2414-2430`）。実際の `spawn` はコンストラクタ内で実行されるが、1体のreadyを待ってから次を起動する構造ではない（`core/src/realtime/agentProcess.ts:224-251`）。名簿順は**起動呼出順**であり、起動完了順や送信順と同義ではない。

各agentは自分のブロック監視を持つ。ポーリング間隔は `max(100ms, blockTimeSec × 1000 / 4)` で、監視登録時にも通知する（`example/agents/runtime/botMain.ts:738-745`）。新しいブロックを見たプロセスが自分の観測と競合情報を読み、判断中でなければ `decide` を起動する。観測処理中の通知や判断中の追加判断はスキップされ得る（`example/agents/runtime/botMain.ts:622-636,668-719`）。

よって、12体の判断をcoordinatorが「名簿順」「アドレス順」「seedでシャッフルした順」で順番に要求する仕組みは、確認したcoordinatorとbotMainの経路では見当たらない。各プロセスのポーリング位相、オペレーティングシステムのスケジューリング、読取と判断の所要時間によって送信時刻が決まる。名簿を読み込むbacktest経路にもseed別の席シャッフルはなく、元の配列を各世界の設定にそのまま渡す（`core/src/cli/backtest.ts:464-476,509-516`）。固定名簿なら起動呼出順は同じでも、実際の到着順は世界ごとに変動し得る。

観測も全員へ配る一つの凍結スナップショットではない。Readerは各ウォレットの残高、価格、各venueの状態をRPC（Remote Procedure Call、遠隔手続き呼出し）で再構成する。`snapshot(bn)` のbnを残高・価格・venue読取の共通固定ブロックとして渡してはいない（`example/agents/runtime/read.ts:136-165`、残高取得の例 `sdk/src/chain.ts:144-149`）。同じround表記でも読取が別の時刻に実行され、途中でブロックが進めば同一状態の保証はない。別ウォレットの在庫・自分の約定履歴も、最初の約定差以後は当然異なる。

### 送信キューはagent内だけ

判断が返すアクションは各agentのSenderへ渡り、**そのagent内**のPromiseキューで直列化される。複数取引のアクションは組み立て順に送る。全員分を集めるbarrier（同期の待合せ）や中央の送信キューではない（`example/agents/runtime/botMain.ts:631-636`、`example/agents/runtime/send.ts:98-100,169-170,336-375`）。送信自体はウォレットクライアントが直接行う（`example/agents/runtime/send.ts:250-259`）。

### ready待ちは開始前の発注を止めない

全プロセス起動後、coordinatorはローカルの自動採掘をOFFにし、`runtime_start` を全員が書くまで時間上限付きで待つ。遅いagentが残っても上限に達すれば始まる（`core/src/realtime/coordinator.ts:2983-3025`）。しかしagentは監視を登録した後に `runtime_start` を記録し、最初の監視通知から判断できる（`example/agents/runtime/botMain.ts:709-713,738-747`）。

つまり、**先にreadyになったagentの発注を全員readyまで禁止する処理ではない**。起動後〜自動採掘OFFの間や、ready待ち・採掘切替の間に取引が出る経路がある。開始前取引が状態を動かすことは初期評価値補正の設計にも明記されている（`core/src/scoring/endowmentV0.ts:3-10`）。実際の開始ブロックは採掘切替後に定まり、共通のrun-start情報として後から各agentに配られる（`core/src/realtime/coordinator.ts:3073-3109,3148-3169`）。

**判定：** 毎ブロックの中央名簿順ディスパッチによる優先は**確認した経路では見当たらない**。固定起動順が開始前の機会やポーリング位相を偏らせ、後続の在庫・入札に差を残すことは**可能**。ただし「先の席ほど得をする」「inc-zetaが毎回先着する」は**不明**。早い発注が損な取引や開始前費用を増やす場合もあり、効果の符号はコードから決まらない。

## 3. ブロック内の取引順序と取込可否

ローカルbacktestの起動コードはAnvilへ `--order fees --base-fee 0 --gas-limit 30000000 --accounts 0` を渡す（`core/src/cli/backtest.ts:594-624`）。`run-matrix.sh` は `ascon-notes/eval/anvil-shim` をPATHの先頭に置き、実体を `ASCON_REAL_ANVIL` で渡す（`ascon-notes/eval/run-matrix.sh:43-45,98-99`）。shim本体はHOMEを変更して `exec env HOME="$ASCON_ANVIL_HOME" "$ASCON_REAL_ANVIL" "$@"` を実行し、引数をそのまま転送する（`ascon-notes/eval/anvil-shim/anvil:8-13`）。したがって、このリポジトリ版のshimは `--order fees` を変更しない。これは起動経路の静的確認であり、E1〜E4の実走が同じ版・バイナリ・設定だったかは未確認。確認した経路ではcoordinatorによるagentアクションの独自ソートは見当たらない。競技フェーズ開始前に設定上のブロックガス上限を改めて適用するため、実走の最終上限は設定と `block_gas_limit_set` の記録で確認する必要がある（`core/src/realtime/coordinator.ts:3062-3073`）。

| 要素 | 静的に読めること | 席の優先への含意 |
|---|---|---|
| 手数料 | 上記の起動引数が有効である条件で、ローカル仕様が引用するFoundry v1.7.1の `--order fees` では、並べ替えキーはtipそのものではなく `maxFeePerGas`。従来型取引では `gasPrice`。参照ランタイムは上限手数料と優先手数料を等しく署名するため、base fee 0では入札額とキーが一致する（`docs/spec/03-market.md:81-85`、`sdk/src/feeRule.ts:3-26,48-60`） | この手数料順の条件では、有効な高額入札と低額入札の差は席番号による優先ではない。同一コードでも観測・在庫が違えば入札額は変わる |
| nonce | 自分の連番を順に払い出して送る。過去の設計記録も、fee降順の例外として同一送信者のnonce制約を挙げる（`example/agents/runtime/send.ts:139-146,250-259`、`docs/adr/0006-separate-environment-from-agent-execution.md:9`） | 自分の低nonce取引が後続を制約する。別agentの小さいnonceに全球的な優先権がある、とは読めない |
| 到着時刻 | 各agentが直接送るため、ブロックを作る時点で未到着の取引はその候補になれない。送信前にもブロック取得・ガス見積り・署名送信がある（`example/agents/runtime/send.ts:195-217,250-259`） | 高いfeeでも次のブロックに間に合う保証はない。送信の遅延差が機会差になり得る |
| 同額fee | 仕様は同額時の着順を「非決定論的」と分類する（`docs/spec/03-market.md:145-153`） | 先着順、アドレス順、取引ハッシュ順等の厳密なtie-breakは**不明**。「無作為かつ公平」とも断定できない |
| 取込容量 | 初期設定は30,000,000 gasのブロック。ランタイムの既定予算は1取引・1agentの観測round合計とも10,000,000 gas（`core/src/cli/backtest.ts:601-612`、`example/agents/runtime/send.ts:62-71,231-244,260-263`） | 全員の全取引が同じブロックに入る保証はない。高額でもnonce・容量・有効性の制約は別にある |

Foundryの取引プール実装は2026-10-07に読解したリポジトリ内に見つからず、ノードのバイナリ版や実際のmempool（未採掘取引の待機領域）も調べていない。`maxFeePerGas` の内部キーについては、ローカル仕様とSDK（Software Development Kit、開発用ライブラリ）の記録を根拠とする。Anvil内部を直接検証した結果ではない。

`docs/competition-start.md:275-277` の「回線の速さや呼び出し順では勝てない」は、優先手数料による並べ替えを説明している。同額時の公平性や、採掘締切に間に合うかまで保証する文言としては扱えない。詳細仕様が同額順序の非決定性を明示していること、各agentの送信が非同期であることと併せて読む必要がある。

**判定：** 同額時やブロック到着境界を介した固定席の系統的優位は**可能**。ただしその発生・方向・同額時の決定規則は**不明**。名簿index・アドレスによる優先指定は**確認した経路では見当たらない**（上記の起動・送信経路の読解範囲）。手数料順だけでは席効果の有無や方向は確定しない。

## 4. 採点・初期評価値・資源制限の席差

### 採点式自体にindexやアドレスの加点はない

公式の偏差値計算は各agentのP、同じ母集団の平均・母標準偏差、全員共通のエポック重みを使う。基準agentは名簿の `baseline` 指定で母集団から除外する。席indexやアドレスによる係数はない（`core/src/scoring/deviationScore.ts:141-176`）。順位の同点判定には自分のTのばらつき、最悪T、最終提出時刻があり、最後まで同じなら同順位。これはTを上乗せする処理ではない（同ファイル `179-194`）。

`ascon-notes/league/remote/agg_mixed.py` の簡易TもPに対して対称な式で、表示行は平均T順、同値ならid順にソートする。**表示順位からrosterの位置は復元できない**（`ascon-notes/league/remote/agg_mixed.py:58-61,71-81`）。同じ世界の二者について母標準偏差が正なら、`T候補 − Tinc = 10 × (P候補 − Pinc) / 母標準偏差`。同一Pに異なるTを与える席ボーナスはこの式では生じない。母集団が変わればTの尺度も変わるため、別実験間のT差の差をそのまま修理効果としない。

### 初期評価値補正は取引を同期させない

公式損益用の初期評価値V0は、scenario resetなら配布後資産の評価値に固定、continuousならその値と初回実測値の大きい方になる（`core/src/scoring/endowmentV0.ts:60-62,83-109`）。前者と後者では開始前利益の扱いが異なるが、どちらも席番号による条件ではない。初期資産には実際の `agent.initial` が渡り、損益は採点境界系列から計算される（`core/src/realtime/coordinator.ts:4642-4653,4993-5022`）。

注意点として、外側の `run-matrix.sh` は単独の `--regime` backtestを世界ごとに起動する。backtest内部のmatrixでなければrunのresetUnitはcontinuousとして扱われる設計である（`ascon-notes/eval/run-matrix.sh:99`、`core/src/cli/backtest.ts:928-936`）。「複数世界の集計だから必ずpinned」とは言えず、実走summaryのモードとV0の記録が必要。V0を補正しても、開始前に変わったプール・在庫・承認状態・戦略内状態を巻き戻すわけではない。

### 同じ上限は同じ遅延を保証しない

ランタイムの判断時間の既定上限は5,000ms（`example/agents/runtime/decideTimeout.ts:8`）。Dockerの共通既定資源は4 GiB（gibibyte）メモリと2 vCPU（virtual Central Processing Unit、仮想CPU）で、起動スクリプトが上限を渡す（`infra/docker-agent/run-agent.sh:18-27,151-154`）。一方、ローカル評価スクリプトは `--agent-sandbox process` を指定し、agentは通常のnodeプロセスとして起動する（`ascon-notes/eval/run-matrix.sh:99`、`core/src/realtime/agentProcess.ts:234-251`）。この経路ではDockerのCPU・メモリ上限を検証したことにならず、複数世界の同時起動もホスト負荷を変える（`ascon-notes/eval/run-matrix.sh:155-165`）。

RPC接続先は共通設定から渡され、席別の専用帯域・順番は割り当てられない（`core/src/realtime/agentProcess.ts:185-192`）。通常の直接Anvil接続にはgateway側の参加者レート制限は入らない。ただし `ERIS_AGENT_RPC_URL` による別経路があり、実走の経路は未確認。gatewayを通す場合は既定100 tokens/秒、burst 300、重いメソッドの重み5で、参加者の認証id、なければIP等をキーに同一規則のbucketを使う（`infra/rpc-gateway/gateway.mjs:93-98,305-315,442-443,506`）。同一id/IPを共有する接続なら予算を共有し得るため、「全席それぞれ100」の保証ではない。認証値は読んでいない。

さらにrosterのenvは共通envに上書きされるため、実行設定が席ごとに違う経路は存在する（`core/src/realtime/agentProcess.ts:159-178`）。E1〜E4の12席のenv・実遅延・タイムアウト・RPC拒否は未確認。

**判定：** 同一Pに対する席index・アドレスによる系統的加点は、**確認した経路では見当たらない**（上記の採点式の読解範囲）。初期実残高、開始前取引、席のenv、資源競合、共有RPC予算を通じた損益差は**可能**で、実走における固定効果は**不明**。採点式の対称性は実行環境の対称性を意味しない。

## 5. 候補席とinc-zeta席のindex

indexは0始まり、括弧内は1始まりの席番号である。探索はこのworktreeの `ascon-notes/` と `example/agents/` を対象に、隠し・無視対象も含め `rg --files --hidden --no-ignore ... -g '*roster-mix*.yaml'` で行った。**混成場の実走rosterファイルはこのworktreeでは見つからなかったため、候補席・inc-zeta席のどちらのindexについても結論を出さない。** 別ホストやジョブのファイルは取得していない。以下のR1/U1の位置は保存名簿だけの事実である。

| 名簿・証拠 | 総席数 | inc-zeta | 候補r/r3 | 確定範囲 |
|---|---:|---|---|---|
| `roster-league-r1.yaml` | 11 | index 4（5番目） | 不在 | `ascon-notes/league/roster-league-r1.yaml:3-27`。noop、multi-arb、clean-arb、venue-arb、inc-zeta、astra-1、astra-2、sonnet-1、sonnet-2、opus-1、grok-1の順 |
| `roster-league-u1.yaml` | 12 | index 4（5番目） | 不在。末尾はzeta-2、index 11（12番目） | `ascon-notes/league/roster-league-u1.yaml:3-28`。U1末尾を候補に置換したと仮定すれば候補はindex 11だが、E1〜E4の実走原本による確認ではない |
| E1〜E3の `roster-mix*.yaml` | 保存集計では12 | idの存在のみ確認、index不明 | E1のidは `ascon-zeta-r3`、index不明 | 原本なし。集計表の存在と12体構成は `ascon-notes/league/results-2026-10-07/e1-mixed-r3-seeds65001-3.txt:7-20`、実験間の構成は `ascon-notes/league/RESULTS-E1-E2-2026-10-07.md:24-28` |
| E4 A/Aの実走名簿 | 指定設計では12 | r3に置換する指定、index未確認 | r3を維持する指定、index未確認 | 2026-10-07の起動ログ由来とされる設計指定のみ（「対象・証拠の範囲」参照）。実走原本・manifestは未確認 |

**判定：** 固定位置差があるという仮説は**可能**だが、実走で候補が後ろの席だったかは**不明**。R1のindex 4をE1〜E4へそのまま移して事実扱いすることもできない。成績表の行順は席順の証拠にならない。

## A/A結果の読み方

両席が同じr3のコードhash・実効env・改訂停止条件で走ること、元のid・wallet指定・位置・相手・資源条件が保持されることをまず実走資料で確認する必要がある。dirだけの置換は**位置、id、ウォレット、起動順をまとめて残す**ため、単独の要因を同定する実験ではない。また、新seedで相手inc-zetaの挙動も変わるので、E1＋E3との完全な対応比較ではない。

| 調べる仮説 | 同じ向きの差が残る場合 | 差が消える場合 |
|---|---|---|
| 1. ウォレット・配布・nonce | 残高・アドレス状態等の差、コードと状態の相互作用、標本変動と整合する。資金配布が原因とは確定しない | 残高・アドレス状態の差が小さい条件、効果の相殺、標本変動と整合する。効果ゼロの証明ではない |
| 2. 起動順・観測・送信遅延 | 非同期実行や開始前の機会に由来する席差、旧比較と同方向の標本変動と整合する。前席優位の証明ではない | 遅延差が小さい条件、コードと実行条件の相互作用、標本変動と整合する。名簿順が無関係とは確定しない |
| 3. 同額時の取込順 | 同額時の順序効果、nonce・到着・容量の差と整合する。T差だけでは区別できず、同額feeの取引のreceipt・txIndex等が必要 | 同額競争が少ない条件、順序効果の相殺、標本変動と整合する。tie-breakの公平性の証明ではない |
| 4. 採点・資源 | P自体が違うなら実行・状態差と整合する。同じ世界・母集団で同じPなのにTが違うなら、保存データ・集計対象の不整合と整合する | 資源競合の影響が小さい条件、効果の相殺、標本変動と整合する。実遅延の同一性は未証明 |
| 5. 名簿位置 | 実走位置が確認できれば、位置・id・ウォレット等を含む席の組全体の差と整合する。各要因の分離には交差比較が必要 | 位置効果が小さい条件、位置と他要因の相互作用・相殺、標本変動と整合する。実走位置の確認は依然必要 |

「残る」は点推定が負というだけではなく、世界ごとに対応させた差の大きさ・不確実性・レジーム別の偏りで判断する。「消える」も有意でないだけでは同値の証明にならない。SEの既存定義は世界間差の標本標準偏差を世界数の平方根で割るもの（`ascon-notes/league/remote/agg_mixed.py:84-99`）。3 seedの結果では偶然の片寄りやレジームとの相互作用が残り得る。

差の残存は席に伴う状態・実行条件の差や標本変動と、差の消失は小さい席効果・相互作用・相殺や標本変動と整合する。符号の逆転も、seed・相手挙動・ホスト負荷による効果の変化や標本変動と整合する。いずれの結果も説明の優先順位や単一要因を確定せず、「3修理が弱さの原因だった」とも断定しない。rとinc-zetaの実効条件付き同値性の出典は `ascon-notes/league/INCZETA-VS-R-DIFF-2026-10-07.md:50-63` であり、実走条件との一致は別途確認が必要である。

## 未確認事項と実施した確認

2026-10-07の静的読解で未確認なのは、E1〜E4の実走roster原本と順序・env・hash、秘密値固定の有無、実際のウォレットと初期実残高、setupの取引費用、Anvilの版と同額tie-break、起動完了時刻、最初の観測・判断・送信・採掘順、開始前取引、RPCの実経路と制限、CPU競合、公式本番の運用設定である。約3点への各要因の寄与は算出していない。

追跡すべき既存証拠は、実走manifest/roster、`initial_endowment` と `epoch_nonce_floor`、`agents_ready`、`runtime_start`、`run_start_declared`、各agentのsubmitted/rejected/submit_failed、`blocks.csv` のhash・blockNumber・txIndex・fee・nonce、初期V0の記録である。送信ログと採掘ログをhashで結ぶ方法は参加ガイドにもある（`docs/competition-start.md:585-589,608`）。ランタイムのsubmitted記録は送信API完了側の自己申告であり、ノード到着時刻そのものではない（`example/agents/runtime/send.ts:250-284`）。厳密な到着順はこのログだけで確定できない。2026-10-07の文書改訂ではログ回収や追加実験は行っていない。

- 2026-10-07の文書改訂で実行した確認：ローカルのbranch/HEAD/status確認、ファイル探索、引用元・coordinator関数本体・Anvil shimの静的読解。
- `npm run typecheck` は `tsc: command not found`（終了コード127）で未完了。依存関係のインストールはしていない。関連テストは未実行。
- `git diff --check` は終了コード0。対象文書が未追跡のため、`git diff --no-index --check /dev/null ascon-notes/league/SEAT-ASYMMETRY-2026-10-07.md` でも空白エラーがないことを確認した（終了コード1は新規文書の差分あり）。静的な文書検査であり、実走の検証ではない。
- 編集対象はこの文書のみ。コード変更、依存導入、commit、push、ネットワーク、Docker、Anvil、backtestは実施していない。

## what this implies for the real competition（本競技への含意・すべて推論）

- **推論：** ローカルのinc-zeta席の成績を、そのまま戦略固有の強さや本番の優位に読み替えない。A/Aと席を分離した比較が、コード改善の価値を判断する助けになる。
- **推論：** 本番も独立プロセス・手数料競争なら、同じコードでも到着締切・nonce・在庫の履歴で成績が分かれ得る。同額入札の公平性は、公式運用の明示または実行証拠が必要である。
- **推論：** process方式・複数世界同時実行で生じた速度差は、本番のコンテナ資源・参加者数・RPC制限では変わり得る。ローカルの席差の方向や大きさは移植できない。
- **推論：** A/Aがどちらの結果でも、最終判断は本番に近い実行条件での終了時損益と公式採点に戻す。簡易Tの約3点を、そのまま公式得点差として扱わない。
