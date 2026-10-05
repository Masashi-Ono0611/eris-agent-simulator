# dev3a xb-r v2 診断と v3（未実走）

2026-10-04。診断元は league-v2 / upstream-eval 共通の `a646e9b1f57ecd342c9f3810805798c55df7a0cf`。
upstream-eval の index とその run_dir を読み取りだけで分析した。commit・計測起動・upstream-eval への書込みはしていない。

**第1ブロッカーはQ0のまま**: F_ref 全12レジーム等重み平均 T ≥ multi-arb、各レジーム平均(T−Tnoop) ≥ 0、安全条件。
この資料は9レジーム×2seedの診断であり、Q0合格もv3性能向上も主張しない。参照戦略の実装は移植していない。

## 1. 実測と会計分解

入力: `../upstream-eval/ascon-notes/eval/out/dev3a-xb-r/index.tsv` の18世界、seed 35001/35002。
summary・agents/cand/multi-arb/clean-arb.jsonl・blocks.csv・market.json。入力ごとのSHA256は
[集計JSON](../eval/dev3a-xb-r-analysis.json)。[再実行スクリプト](../eval/diagnose-xb-r-dev3a.mjs):

```sh
node --import tsx ascon-notes/eval/diagnose-xb-r-dev3a.mjs ../upstream-eval /tmp/xb-r-dev3a
```

P−noopは18/18正、cand violations 0、valueSeries failedReads 0、362ループを再確認。
G0 PASSは依頼の計測引継ぎであり、G0判定器は再実行していない。
候補はPでmultiに勝つ世界が4/18。Tは3体のPの平均・母標準偏差から計算する。

| 1世界平均 | cand | multi | clean |
|---|---|---|---|
| P | 842.26 | 2,032.87 | 1,050.27 |
| included | 54.44 | 288.67 | 61.28 |
| reverts | 0.00 | 0.89 | 0.50 |

cand submitted 980 / submit_failed 27（入力レッグ）。失敗理由は Too little received 9、BAL#507 11、Slippage 7。mined revertとは別。

| regime | T cand | T multi | T−Tnoop cand |
|---|---|---|---|
| calm | 43.61 | 64.02 | 6.79 |
| cex-drift | 44.83 | 63.98 | 7.91 |
| informed-flow | 55.23 | 36.01 | 17.44 |
| whale | 38.88 | 56.28 | 17.75 |
| lending-incident | 52.52 | 49.15 | 12.16 |
| crash | 44.83 | 63.98 | 6.49 |
| depeg | 51.54 | 61.37 | 17.34 |
| vuln | 49.35 | 50.10 | 16.68 |
| spike | 40.68 | 58.51 | 8.11 |

9レジーム等重み平均Tは46.83対55.93。未計測のdepeg-persist / cdp-incident / launchを含まない。

会計式は DESIGN-REPAIR-01 §2.1 と同じ。Δは **multi−cand**。
`E=Σs q(f−p)`、`M=Σs q(F−f)`、`G=gas ETH×終値ETH`、`X=(P−Pnoop)−E−M+G`。
`runStartBlock < inclusion block ≤ finalBlock` の成功spotを集計する。
数量とcashは `baseUnits` と `baseUnits×priceUsd` を使用し、両側評価の最大値である `notionals.usd` をcashにしない。

Eを `成功レッグ数 N × 平均cashサイズ S × cash加重約定edge e` に分解し、N/S/eを置換する6順序の寄与を平均した。
これは会計上の対称分配で、因果的な「取引数を増やせば得る利益」ではない。各世界で計算後、2seedを平均する。

| regime | ΔP USD | 回数→ΔE | サイズ→ΔE | edge幅→ΔE | ΔM carry | −ΔG | ΔX |
|---|---|---|---|---|---|---|---|
| calm | 801.72 | 1,994.29 | -345.01 | 17.89 | -862.06 | -3.38 | 0.00 |
| cex-drift | 2,385.37 | 3,825.88 | -1,263.34 | 284.63 | -453.01 | -8.79 | -0.00 |
| whale | 3,590.67 | 8,705.56 | -954.09 | -3,185.89 | -970.98 | -3.93 | -0.00 |
| crash | 2,553.27 | 4,852.94 | -296.70 | -988.06 | -1,009.89 | -5.01 | 0.00 |
| spike | 1,708.53 | 4,418.60 | -2,239.57 | -1,675.32 | 1,211.23 | -6.41 | 0.00 |

比較の実数（cand / multi、各2世界の平均）。edge幅は包含時fairに対する実際の手数料・impact後の優位幅。

| regime | 成功レッグ数 | cash/leg USD | 約定edge bps | bundle組数 | 単脚終値寄与 USD | bundle終値寄与 USD |
|---|---|---|---|---|---|---|
| calm | 50.00 / 235.00 | 2,260.43 / 1,820.71 | 53.61 / 54.12 | 4.50 / 20.00 | 228.72 / 888.86 | 34.63 / 179.60 |
| cex-drift | 48.50 / 367.00 | 2,067.89 / 1,215.56 | 68.75 / 76.41 | 3.50 / 83.00 | 797.48 / 2,963.14 | 68.87 / 297.38 |
| whale | 75.50 / 317.00 | 2,569.77 / 2,244.62 | 184.35 / 114.47 | 18.00 / 58.50 | 1,303.25 / 1,443.29 | 1,919.16 / 5,373.72 |
| crash | 44.00 / 275.00 | 1,996.77 / 1,685.39 | 132.25 / 97.96 | 3.00 / 47.00 | 670.59 / 2,774.34 | 32.88 / 487.43 |
| spike | 52.00 / 324.50 | 2,161.31 / 1,183.32 | 133.49 / 62.05 | 5.50 / 68.00 | 607.30 / 2,014.83 | 63.58 / 370.99 |

単脚/bundle分類には **submittedログのbundleIdをhashで結合**する。blocks.csvのbundleId欄は空であり、その欄だけでは全て単脚に誤分類する。
18世界でcand成功bundle IDは128、うち成功片脚のみ1（whale/35002）。multiは889、うち成功片脚のみ8。
候補はmined revert 0でも、送信前失敗による片脚露出は残っている。
multiの微小成功レッグ51件はprice/quantityの復元欠測。N/S/e表は復元可能なレッグだけを使い、includedTxと区別する。
全cand/multiで |X| 最大0.003813 USD、cand欠測0。会計のほぼ全額を説明できるが、反実仮想の妥当性は別問題。

calm/cex-drift/crashは主に単脚の回転不足、whaleはbundle終値寄与の不足が大きい。
spikeではmultiのcarryが候補より約1,211 USD有利。candの1取引サイズや約定edgeが小さいという一律の説明は成立しない。

## 2. 見送りと同ブロックの参照機会

cand noop 5,636件中、5,621件が共通理由 `no funded positive net edge at an affordable bid`、15件が期限境界。
実行時の完全な観測・候補別拒否理由は保存されていない。以下のゲート帰属は **再構成モデル** であって実測理由ではない。
開始前18件を除いた6,495フレームを使用。cand noopと同じblockSeenで後に成功した参照取引は3,425ブロック
（multi 3,423、clean 352、重複あり）。包含ブロックで意思決定を対応付けない。

- 価格は事後のblock別市場（6桁）。Uniswap active liquidityは未保存なので300,000 USD fallback。pool総depthをactive liquidityと置き換えない。
- 残高は初期在庫＋成功receiptから復元。入力はsubmitted.amountの整数を正確に控除、出力はnotionalから丸めて再構成。初期承認gas等は未復元。
- ログで省略されたbaseはWETHへ正規化。これを怠るとWETHのcooldownと同経路対応が欠落する。dev2スクリプトをそのまま流用せず修正した。
- 競合入札は同blockのmethod/receipt baseから実行先へ対応付ける。raw tx.to未保存で完全な入札集合ではない。
- v2取引有無の一致は6,096/6,495 = 93.86%。内訳: attempt→trade479、attempt→noop398、noop→trade1、noop→noop5,617。
  **実attemptの再現は479/877 = 54.62%に留まる**。高い全体一致率だけで精密な寄与分析とは呼ばない。

候補経路ごとの最初の拒否。1ブロック内の経路は重複し、合算不可。同経路はbase/venue/方向一致で、bundleの片脚一致も含む。

| ゲート | 該当block / 3425 | 候補経路 | 同経路の参照成功 |
|---|---|---|---|
| 正edgeだがENTRY≤60bps | 3310 | 12039 | 3051 |
| ±20%帯で50 USD未満 | 2417 | 5765 | 2686 |
| 2block冷却 | 558 | 3348 | 382 |
| 競合超え入札が利益予算外 | 205 | 310 | 184 |
| 終盤新規単脚禁止 | 48 | 288 | 40 |
| 終盤bundle禁止 | 48 | 96 | 0 |
| 終盤anchor残差<50 | 3 | 3 | 3 |
| モデルeligibleだが実noop | 1 | 1 | 1 |

edge≤0は別枠。funding/gas予備/net floor/サイズ目標自体<50の先行拒否はモデル上0。安全ゲートを緩める根拠にはしない。

各反実仮想で、実際のcand残高・過去のattempt・相手の取引を固定する。追加判断を将来の在庫や相場へ反映しない。
「追加」は再構成baseline noop→tradeの意思決定数（約定数ではない）。
「net」はimpactモデル・既定入札・gas控除後の追加分合計で、**確率を含む実現期待利益でもPの下限でもない**。

| 因子（単独、組合せ明記） | 追加判断 | 参照対応noop内 | 追加net USD | 失う判断 | 既存判断変更 | 判断・リスク |
|---|---|---|---|---|---|---|
| entry50 | 190 | 173 | 389.67 | 0 | 0 | 小edgeのquote誤差。採用、実費後gate維持 |
| entry45 | 344 | 228 | 625.86 | 0 | 0 | より薄いedge。既定には採用せず |
| entry20 | 536 | 302 | 835.50 | 0 | 0 | 薄いedgeの比率増。既定には採用せず |
| cooldown0 | 191 | 171 | 2,994.77 | 0 | 0 | 未確定/片脚との衝突。無条件解除は不採用 |
| settled60 | 142 | 132 | 922.31 | 0 | 0 | 残高で確認できた単脚だけ解除。R8採用 |
| combined50 | 355 | 326 | 1,360.65 | 0 | 0 | v3既定。ENTRY50+R8、R9 OFF |
| sizeMax | 0 | 0 | 0.00 | 0 | 0 | 上限を広げても今回変化なし。不採用 |
| cap16 | 0 | 0 | 0.00 | 0 | 7 | 既存7判断のサイズのみ増加。8%を維持 |
| band40 | 1786 | 1644 | 62,030.04 | 0 | 76 | 在庫リスク拡大、明示禁止につき不採用 |
| min10 | 33 | 33 | 38.88 | 0 | 1 | 小額化とbundle優先の交絡。50 USD維持 |
| profit01 | 0 | 0 | 0.00 | 0 | 0 | 追加なし。利益floor維持 |
| bidBudget | 613 | 205 | 1,668.50 | 0 | 480 | 競合より後の約定/revert増。R4維持 |
| headroom10 | 0 | 0 | 0.00 | 82 | 48 | 即時82判断を失う。R9実装、既定OFF |
| headroom10entry50 | 163 | 148 | 329.26 | 82 | 48 | 在庫経路効果未測定。既定不採用 |

v3既定は480→835判断（+355、全て単脚）。追加の330件は実noop内、326件は参照成功との対応がある。
R8の残高確認は725フレーム、そのうち新たな判断142件。無条件解除191件のうち49件を通さない。
各因子の追加数を足して組合せ値にしない。R9の将来bundle回復は固定残高モデルでは測れない。
min10は小額bundleの優先によって既存の大きい単脚を置き換える場合があり、追加netが正でも総モデルnetは下がる。

## 3. v3実装とリスク境界

[agent.ts](../../example/agents/xb-r/agent.ts) の独自xb系コアに実装。multi-arbのコード・設定・サイズ式は移植していない。

- **ENTRY初期50**（20–60、5bps刻み）。AIに留保する可変パラメータはこれだけ。ENTRYは入口専用でサイズ/profitに二重控除しない。
- **R8_SETTLED_COOLDOWN=ON**。前回が単脚、同じrunの直後1block、入力トークンがamountInと整数単位で一致して減少、出力が正に増加、native gas減少、他baseが不変の場合だけ、そのbaseの単脚cooldownを解除する。bundle/部分約定/曖昧な残高は解除しない。通常2block待ち、bundle優先、終盤の利益付き復元は従来どおり。RPC追加なし。
- R8は**残高による確認**で、receiptの直接検証ではない。自己ウォレットへの外部送金等が重なる環境では同じ残高差を作る可能性が残る。観測欠測やgas補充は保守的に待つ。stateはrun/巻戻り/期限リセットで破棄、重複block・deadlineでは追加attemptを記録しない。
- **R9_BUNDLE_HEADROOM=OFF**。ON時は新規単脚の到達在庫を初期±10%に抑えて残り半分をbundle用に残す。bundle各脚の±20%帯は不変。通常時のanchor通過、利益付き復元は維持。実効性は別アブレーションで確認する。
- canFund、候補ごとの累積予約、両脚の独立資金、0.05 ETH予備、asset cap8%、depth ceiling、80bps slippage、net≥0.05、競合超え入札の予算、priority>0、利益0の強制売り禁止を維持。

リスクの増分は、低edgeと連続取引への露出であって、在庫上限の拡大ではない。
固定フレームで追加入力回転額342,338.84 USD、最大1判断3,597.71 USD、モデル追加gas59.21 USD。
全追加判断の約定価格がモデルより80bps不利というストレスを置くと、利益を2,738.71 USD失い、モデルnet+1,360.65は約−1,378.07 USDになる。
1%逆行を1追加取引の入力額に掛けた感応度は最大35.98 USD。いずれも価格感応度で、実現P・revert確率の予測ではない。
20%在庫帯の最大偏りは1.6 WETH / 0.08 WBTCのまま。初期価格3,000/60,000なら1%の同方向価格変動に対する偏り損益は最大約96 USD。
取引回数増加は累積gas/revert機会を増やす。実測前にrevertの増分確率は識別できない。
既存preflight失敗率27/(980+27)=2.68%が不変という仮定なら、追加355レッグで約9.5失敗の感応度だが、低edge採用後の率には未較正。

## 4. 回帰・赤対照・再現性

fixtureはdev3a calm/35001の4フレーム（block1297/1335の低edge買い・売り、1300/1394の冷却買い・売り）。
R8用に前blockの観測・実submitted入力・receipt包含blockを併記した。約38KBで、runtime snapshotではない。
テストはその再構成fixture、合成残高の状態遷移、WBTCを含む在庫境界を区別して扱う。
テスト用SDKの実行先はログmethod/baseから再対応付け、deploymentのアドレス差を競合不在と誤認しない。

- `npm run typecheck`: PASS。
- xb-core / xb-variants / xb-r / xb-r-dev2 / xb-r-dev3a: **136/136 PASS、skip0**。既存123＋新規13。
- 赤対照: **33/33 intended RED**、既存25維持＋v2原本と新規mutation7件。全てAssertionErrorを確認、構文/ロード失敗を赤と数えない。
- 復元後136/136 PASS。実装SHA256 `78d8fa43156cee872e1bcbcaf86c1da00f1aa1646c6b210e7af4b499edea4d04`。
- 赤対照証拠: `/var/folders/yk/mx8jn78j6xq0w5l4z9d8hbvw0000gn/T/xb-r-red-controls-4doT3O/`。
- DEV2_PARAMS / DEV3A_PARAMSで歴史的assertionを保存。v3因子OFFとa646e9bの出力一致、およびR9単独の仕様一致を **全6,495フレーム** でassert。

```sh
npm run typecheck
node --import tsx --test --test-concurrency=1 test/xb-core.test.ts test/xb-variants.test.ts test/xb-r.test.ts test/xb-r-dev2.test.ts test/xb-r-dev3a.test.ts
node test/xb-r-red-controls.mjs
```

赤対照はleague-v2のagent.tsを一時変異して毎回finallyで復元するので、このworktreeを直接使う評価とは同時実行しない。
現在のdev3bはupstream-evalを使うため、そのソースに触れていない。テストconcurrencyは1。

## 5. 次の診断と未検証

**36001/36002** を次の候補とする。2026-10-04 10:45 UTCに league-v2 / upstream-eval の
`runs/` と `ascon-notes/eval/out/` のseed設定・TSV列・CLI引数・ファイル名をrgで監査し0一致。
league-v2側は両ディレクトリがない。価格/ハッシュ中心のmarket.json、blocks/values.csv、agent jsonlはseed内容検索から除外。
35001/35002はdev3使用済み。実行直前に、進行中ジョブや他担当による新規利用を再監査する。seed監査結果を集計JSONに保存した。

提案は **F_ref / FROZEN、36001/36002 × 全12レジーム = 24世界、p3、18＋6世界**。
ENTRY50・R8 ON・R9 OFFをhashとともに事前固定し、dev3b終了後に別候補として投入する。今回まだ起動していない。
観測された世界本体は721,613–722,009ms（約12.03分）。p3で8batch、既存実績の投入間隔約12.5分を仮定し、
20%の余裕とchunk確認20分を入れて **約2時間20分**（新取引量に対する再校正前の概算）。
進行中評価とのCPU排他を守り、途中結果で後半の設定を変えない。診断を資格PASSに読み替えない。

R9の因子比較が必要なら使用済みdev3aのseedで独立した24世界・同程度の追加枠を用意する。未使用診断seedを反復調整に回さない。
未検証: v3の実現P/T、12レジームQ0、動的な在庫/相手/入札フィードバック、revert率、fixtureのruntime観測一致、R9の将来bundle回復。
フルnpm test、Docker、外部ネットワーク、public60、bundle/selftestは実行していない。鍵/.envには触れていない。

