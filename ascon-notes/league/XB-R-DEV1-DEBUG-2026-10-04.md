# xb-r dev1 無取引の診断と修正（2026-10-04）

対象: `league/v2` の `a042a70`。調査開始時 HEAD は `c2aeb72`、xb-r ソースは a042a70 と同じ。
参照 run: `/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/upstream-eval/runs/2026-10-04T04-46-54-248Z`（calm / 31001）。
upstream-eval は読み取りのみ。修正・fixture は league-v2 のみ。コミット、チェーン実行なし。

## 1. 確認した事実と原因

- `agents/cand.jsonl`: 362判断、通常の見送り361、境界見送り1、submitted 0。
  判断範囲は1285–1646、境界は1646。保存市場系列は1286–1646なので、開始前1285の市場は復元していない。
- `summary.json`: cand/noop の P はともに **404.59624231106136**。
  multi-arb は1317.0263903330197、clean-arb は1175.3761692823464。
  それぞれ343 / 120取引が包含、revertは双方0。candは包含0。
- `blocks.csv`: 保存361ブロック **すべて最大6,000,000,000 wei/gas**、その最大値の送信者はoracle。
  oracleの呼出しはsetPrice/setPriceFor/setAnswer等。keeperには5.5gweiもある。
  multi-arb / clean-arb の計463送信はすべて0.1gwei。
- `runtime/send.ts::computeCompetition` は自分以外の全txを最大化する。oracle/keeperを除外せず、
  venueも区別しない。したがってRPC読取成功時の観測は `maxCompetitorPriorityFeeWei="6000000000"`。
- runの `agent-view/cand/config.yaml` は `economicGas: false`。
  `manifest.json` の上限5gweiはSDK設定既定値と一致し、`observationFor()` は非economicGas時この上限を返す。
  R4要求は **max(0.1, 6 + 0.1)=6.1gwei > 上限5gwei**。
  **どれほど利益が大きくても、候補が入口を通ればR4で必ず落ちる。**

これが確定したコード上の遮断条件であり、再構成fixtureで旧コードの無取引を再現した。
全Observation/全候補traceは保存されていないので、各実判断の候補数やRPC取得成功を直接観測したとは言わない。
他11世界は本調査で再集計していない。

旧fixtureは競合0.1gwei、上限10gwei。実際の「環境txを含む集約値6gwei、上限5gwei」という
組合せが一度もテストされず、101件greenでも取引可能性を証明できていなかった。

## 2. Observationの形・単位・復元限界

SDKの`observation.ts`、Balancer/Curveの`observe()`、runtime/send.tsと、両worktreeの該当ソースが同一であることを照合。
`agent-view/cand`にはconfigとrun-startだけがあり、生Observationはない。
eventsの`observation`は終わった後に再構成した価格・valueの要約で、残高やcompetitionの完全なsnapshotではない。

fixture: `test/fixtures/xb-r-dev1-calm-31001.json`（3ブロック、約47KB）。sourceパス、元ログSHA-256、限界を内包。

| 項目 | 実ログ / SDK契約とfixtureでの扱い |
|---|---|
| 市場価格 | `market.json.series` のblock固定・事後読取、価格は小数6桁に丸め済み。runtimeの瞬間snapshotそのものではない |
| WETH | `protocols.uniswap.pool` / `protocols.balancer` / `protocols.curve` のトップレベル、18桁 |
| WBTC | 各protocolの `markets["WBTC/USDC"]`、価格名はWBTCでも `priceUsdcPerWeth`、実通貨量は8桁 |
| 初期残高 | manifestで USDC=`25000000000`、WETH=`8000000000000000000`、WBTC=`40000000`、native=`1000000000000000000`。cand取引0。起動承認gasの正確なnative差分は未保存 |
| Uniswap fee | `3000 / 1e6 = 0.003`、30bps。fee値3000をbpsと解釈しない |
| Balancer / Curve fee | 2-sided quoteから `sqrt(buy/sell)-1`。1302のWBTCは50.230953 / 29.143912bps。単位はbps、コードで10000除算 |
| Balancer / Curve depth | SDK observe()にreservesは存在しない。実際のxb-rは既存fallback 300,000 USDCを使う。旧fixtureの明示reservesと形が違うが、同値のfallbackなら原因ではない |
| Uniswap depth | in-range liquidityはログ未保存。fixtureでは欠測として既存fallbackを使う。marketの`depthUsd`は全token残高のfair評価であり、liquidityに代入してはいけない |
| competition | block txの集約は6gwei。candは未送信なのでrecentSampleSize=0、recentRevertRate=0、lastTxIndex=null。これらは低競争や入札敗北の証拠ではない |
| gas | 現行モデルはsingle 200,000 / bundle 350,000、base fee=0前提を維持。参照の実gasは下表。candidateの実gasは未測定 |
| horizon | run-start block1286 + 360 - 観測block。1302/1303/1304では344/343/342。R5終盤条件外 |
| RPC fixture | blocks.csvにはraw tx.to/calldataがない。method、sender、fee、receipt由来baseを保存し、テスト時にSDKの対象アドレスへ射影。未記録のraw txを実ログと称していない |

Uniswap depthを0（候補から除外）/大きな値とした場合、nativeを0.1 ETHとした場合も、
3blockすべてで安全に資金を賄える選択肢が残るテストを追加した。
未保存値が正確に復元できたという証拠ではなく、その値に依存しない不具合再現・修正確認である。

## 3. 同一機会のゲート比較

「同じblock」は**観測block**で合わせる。参照取引は通常その次のblockに包含されている。

| 観測 | 両参照のroute (WBTC) | 包含block | multiのtxIndex / gas | cleanのtxIndex / gas |
|---|---|---:|---|---|
| 1302 | Uniswap買い → Balancer売り | 1303 | 24,26 / 103380+96254 | 23,25 / 102398+96254 |
| 1303 | Curve買い → Balancer売り | 1304 | 20,22 / 136462+96254 | 19,21 / 136462+96254 |
| 1304 | Curve買い → Balancer売り | 1305 | 20,22 / 136472+96254 | 19,21 / 136462+96254 |

以下は**ログから再構成した入力でのモデル値**。cand実約定利益でも、修正後のチェーンPでもない。
旧R4は全行で6.1gweiを要求し、上限5gwei/経済予算で落ちる。
修正要求は対象への公開取引の最大fee+0.1gwei。全行でR3の50bpsを通過し、
単脚はR1の100bpsも通過。cooldownは元のcandが未送信なので空。

| 観測block | 候補 (WBTC) | fee後edge bps | size USDC | canFund | gas見積 | 旧要求6.1でのnet USDC | 経済予算上限 gwei | 修正要求 gwei | 修正net USDC | 判定 |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|---|
| 1302 | balancerSwap | 209.752 | 3146.281 | PASS | 200000 | 29.3272 | 5.000000 | 0.264 | 32.8381 | 通過・順位下位 |
| 1302 | swap → balancerSwap | 121.266 | 909.495 | PASS | 350000 | -2.0105 | 0.519038 | 0.288 | 4.1084 | 選択 |
| 1302 | curveSwap → balancerSwap | 118.501 | 888.756 | PASS | 350000 | -2.2093 | 0.500146 | 0.298 | 3.8990 | 通過・順位下位 |
| 1303 | balancerSwap | 144.280 | 2164.199 | PASS | 200000 | 11.9365 | 2.690743 | 0.256 | 15.4583 | 選択 |
| 1303 | curveSwap → balancerSwap | 73.248 | 549.360 | PASS | 350000 | -4.8235 | 0.252625 | 0.279 | 1.3154 | R4予算不足 |
| 1304 | balancerSwap | 162.566 | 2438.496 | PASS | 200000 | 16.1422 | 3.386729 | 0.278 | 19.6532 | 選択 |
| 1304 | curveSwap → balancerSwap | 61.500 | 461.247 | PASS | 350000 | -5.3030 | 0.207515 | 0.278 | 0.8413 | R4予算不足 |

- 1302: fair WBTC=59,603.235418、Uni mid=59,944.946131、Balancer mid=61,152.818301。
  共通8% cap=5,832.424375 USDC。選択bundleはUSDC 909,494,710 units、売りWBTC 1,485,471 units。
  両脚は既存在庫で賄い、8桁換算0.01485471 WBTC。0.4 WBTCからの20%帯を守る。
- 現行gas reserveは0.05 ETH。再構成native 1 ETHに対し、仮に旧要求6.1gweiを送ったとしても
  single後0.99878 / bundle後0.997865 ETHでreserveを割らない。今回の遮断はreserveではない。
  修正の選択fee後残高は1302=0.9998992、1303=0.9999488、1304=0.9999444 ETH。
- R3の安全幅二重控除は復活させていない。全行でfee後edgeをそのままサイズ/profitに使い、impactと送信feeを引く。
  net floorは0.05 USDCのまま。利益正でもR4の10%追加予算が足りなければ1303/1304のbundleのように落ちる。
- 期限理由・invalid observation理由は実ログにない。元の見送りはselectCandidateの汎用理由。
  ローカルの即時RPC stubでは選択所要1ms未満だったが、実RPCの遅延やG0を検証した値ではない。
  専用テストでRPC読取を含む4,000ms経過時の見送りを確認。

各fixture判断は**当時のcand残高を使う独立した反実仮想**。1302で取引した後の残高・cooldownを
仮定して1303以降の利益を足し上げることはしていない。すべてのmulti-arb機会を取る仕様でもない。

## 4. 修正範囲と維持条件

変更する戦略ソースは `example/agents/xb-r/agent.ts` だけ。
純粋な`createAgent()`の既存経済ロジックを維持し、提出entrypointの`decide()`をasync wrapperにした。

1. 1回の`ctx.publicClient.getBlock({blockNumber: obs.blockNumber, includeTransactions: true})`を最大750msで読む。
2. 候補の実行先に対する他送信者の最大bidを使う。Uni routerと当該pool、Balancer vault、Curve当該pool。
   異なるbaseでもrouter/vaultを共有する場合は保守的に含める。bundleは両脚の最大。
   oracle名・keeper名・固定アドレス・6gweiという値で除外しない。対象への全呼出しを数えるためrevertや流動性操作も含む。
3. block不一致、RPC失敗、hashだけのtx、不正なsender/fee、timeout、未知routeは元の集約値へ戻す。
   欠測を競合0と扱わない。読み取りが後で終わっても、送信・後続判断の状態を変更しない。
4. R4は引き続き `max(default floor, scoped competitor + 0.1gwei)`。
   元と同じ `min(floor + 利益10%相当, runtime ceiling)` を越えたら見送り。priority0を送らない。
   読取時間を含めて4,000msを判定し、期限切れの行動はcooldownを消費しない。
5. R1/R2/R3/R5、canFund、累積資金予約、gas reserve、80bps slippage、20%在庫帯、0.05利益floorは不変。

`DESIGN-REPAIR-01 §4.2` の「全市場のcompetitor maxを当該venueの競争と同一視しない」を実装した修正。
recentRevertRate/lastTxIndexから無根拠に競合を割り引く閾値変更ではない。

制約: ブロックの直接の宛先を観測し、別コントラクトからの内部callをtrace展開していない。
独自executor経由の競争の捕捉、非原子的bundle、固定gas/impactモデルの妥当性、実RPC負荷は別途実測が必要。

## 5. 検証記録

- 修正前: 既存101/101 pass。新しい3block replayはa042a70のソースで3/3が`ERR_ASSERTION`、exit 1。
- 修正後: **112/112 pass**（xb-core 28、xb-variants 45、xb-r 39）、fail/skip=0。
  元の101件と因子OFF対照を維持。追加11件はreplay3、対象/自己tx除外、入札・reserve、bundle両脚、
  空block/legacy fee、欠測、timeout/遅延応答、全体期限、未保存depth/nativeへの感度。
- `node test/xb-r-red-controls.mjs`: **19対照**が予定どおりassertionで赤。
  exact a042a70 1対照 + 18変異（既存15 + 新規3）。毎回finally復元、全112件greenを再確認。
  修正ソース復元SHA-256: `f895dc07de5c94e09e50fba28ca35687be0b117e2a443f05862860d3fd0f7782`。
  TAP/変異記録: `/var/folders/yk/mx8jn78j6xq0w5l4z9d8hbvw0000gn/T/xb-r-red-controls-gMHczn/`。
- `npm run typecheck`（tsc --noEmit）PASS。
  `node --import tsx scripts/checkStrategyCode.ts example/agents/xb-r/agent.ts` PASS。
  フルnpm testは未実行（依頼どおり）。
- **未検証: 修正後のチェーン上の実測**（約定、revert、実gas、RPC/G0、P−noop、他11世界、public60等）。
  replayのgreenは利益や資格を証明しない。コミットなし。upstream-eval・鍵・.envの変更なし。
