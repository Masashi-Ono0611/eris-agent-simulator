# dev3 全24世界の分解と xb-r v4 先行準備

2026-10-04 / league-v2。dev4 は別 worktree の `d30cbbb` を計測中。本変更は未コミット。
v4 の性能・Q0 合格を主張しない。multi-arb は比較のための読み取りのみで、実装を移植していない。

## 1. 負けの源 — measured と再構成モデルを分離

入力は upstream-eval の `ascon-notes/eval/out/{dev3a-xb-r,dev3b-xb-r}/index.tsv` が指す24世界。
12レジーム × seed 35001/35002、全362ループ、cand mined revert 0、violations 0、noop割れ0。
G0 PASS は引継ぎ情報（今回G0判定器は未再実行）。
[実ログ集計・入力SHA256](../eval/dev3-v4-xb-r-analysis.json)と[再実行スクリプト](../eval/diagnose-xb-r-dev3-v4.mjs)。

12レジーム等重み平均 T は **48.42 / 54.60**、全レジーム平均(T−Tnoop)>0、最小+6.49。
P は cand **599.07** / multi **1591.45** / clean **734.61**、included tx は **54.42 / 283.71 / 57.54**。
以下は cand / multi の世界平均。サイズは各世界の成功レッグ cash 総額÷復元成功レッグ数を平均。

| regime | T | 復元成功legs | USD/leg | 成功bundle ID数 |
|---|---:|---:|---:|---:|
| calm | 43.61/64.02 | 50.0/235.0 | 2260/1821 | 4.5/20.0 |
| cex-drift | 44.83/63.98 | 48.5/367.0 | 2068/1216 | 3.5/83.0 |
| informed-flow | 55.23/36.01 | 66.0/183.0 | 2163/2100 | 9.5/22.0 |
| whale | 38.88/56.28 | 75.5/317.0 | 2570/2245 | 18.0/58.5 |
| lending-incident | 52.52/49.15 | 77.0/331.5 | 1976/1296 | 15.0/59.5 |
| crash | 44.83/63.98 | 44.0/275.0 | 1997/1685 | 3.0/47.0 |
| depeg | 51.54/61.37 | 37.5/261.0 | 2291/1756 | 3.0/27.5 |
| vuln | 49.35/50.10 | 39.5/270.5 | 2441/1401 | 2.0/59.0 |
| spike | 40.68/58.51 | 52.0/324.5 | 2161/1183 | 5.5/68.0 |
| depeg-persist | 62.49/38.44 | 49.5/232.0 | 2228/2023 | 2.0/12.5 |
| cdp-incident | 42.35/64.12 | 49.0/301.5 | 2408/1756 | 2.0/55.5 |
| launch | 54.69/49.18 | 64.5/271.0 | 1994/1503 | 6.0/42.0 |

会計式は `P−Pnoop=E+M−G+X`。`E=Σ sign×数量×(包含時fair−約定価格)`、
`M=Σ sign×数量×(終値fair−包含時fair)`、Gは終値換算gas、Xは残差。
EをN×サイズ×cash加重edgeに分解し、置換6順序の寄与を等重み平均。
次表は **multi−cand / USD / 2seed平均**。件数寄与は会計上の配分であり、回数を増やした際の因果効果ではない。

| regime | ΔP | 回数→ΔE | サイズ→ΔE | edge→ΔE | Δcarry | −Δgas | Δ残差 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calm | 801.72 | 1994.29 | -345.01 | 17.89 | -862.06 | -3.38 | 0.00 |
| cex-drift | 2385.37 | 3825.88 | -1263.34 | 284.63 | -453.01 | -8.79 | -0.00 |
| crash | 2553.27 | 4852.94 | -296.70 | -988.06 | -1009.89 | -5.01 | 0.00 |
| whale | 3590.67 | 8705.56 | -954.09 | -3185.89 | -970.98 | -3.93 | -0.00 |
| spike | 1708.53 | 4418.60 | -2239.57 | -1675.32 | 1211.23 | -6.41 | 0.00 |
| cdp-incident | 1743.04 | 5543.05 | -1519.85 | -3730.27 | 1455.63 | -5.51 | -0.00 |
| depeg-persist | -402.82 | 2358.04 | -207.93 | -337.88 | -2211.40 | -3.65 | 0.00 |
| launch | -147.07 | 2030.10 | -482.90 | -148.62 | -1542.26 | -3.38 | -0.00 |

- **calm / cex-drift / crash**: 単脚の終値寄与 cand/multi は229/889、797/2963、671/2774 USD。回転不足が中心。candの1脚サイズは既に大きい。
- **whale**: bundle終値寄与1919/5374 USDの差が大きい。単脚は1303/1443 USD。R9の在庫余地は検討対象だが、単脚を減らす機会費用を伴う。
- **spike**: 回数だけでは説明できず、multi側carry優位が+1211 USD。単脚607/2015、bundle64/371 USD。
- **cdp-incident**: multiは**全送信がswap/balancerSwap/curveSwap**。Liquity等の専門取引0（24世界全体でも0）。単脚561/2568、bundle26/−232 USD。差+1743 USDのうちcarry +1456 USD、純粋な包含時edge差は+293 USD。**Liquity欠如をmultiへの敗因とは認定できない**。v3で取引数を増やして同じcarryが得られる保証もない。seed別carry差は+32.18 / +2879.07 USDで、平均は後者に強く依存する。receiptから復元したmultiのWETH在庫範囲は35001で0.030–21.403、35002で0.005–21.072 WETH（candの安全帯6.4–9.6を大幅に超える）。この露出を模倣して差を埋めることはしない。
- **depeg-persist / launch**: candは少ないspot取引でも勝っている。単脚284/−242、254/58 USDで、multiの大きい回転量をそのまま目標にすると保護を失う可能性がある。

分類はsubmitted.bundleIdをhashでreceiptに結合（blocks.csvの空bundleIdだけで分類しない）。
集計窓はrunStartBlock < inclusion block ≤ finalBlock。片脚のみ成功したbundle IDはcand 1、multi 9。
candのsubmit_failedは31件（31/(1306+31)=2.32%）、mined revert 0と区別する。
multiの微小成功51レッグは数量/価格欠測。multiの最大|X|は0.003813 USD、candは0.000001未満。
専門モジュールがないという判定はactionTypeと現物会計の両方で確認した。

**v3が効く見込み [inferred]**: v2の残高・価格を固定した8,660フレームでは、ENTRY60→50で追加277判断、
残高確認済み単脚の冷却短縮で200、組合せで510（461は同blockSeenで参照成功あり、全て単脚）。
大負けレジームの組合せ追加はcalm55 / cex25 / crash28 / whale43 / spike43 / cdp51。
depeg-persist44 / launch60にも効き得る。これらは追加約定数や実現Pではなく、v3の実効性はdev4で測る。
R9はv3でOFFなので、dev4にbundle余地改善の効果を期待してはいけない。

拒否理由は実行ログに全て保存されていない。同blockSeen参照成功付きcand noop 4,507フレームについて、
再構成の最初の経路ゲートはENTRY正edge≤60に4,353、在庫帯に3,141、冷却に755、入札予算に307。
経路/ブロックは重複するので合計しない。全体一致率は8103/8660=93.57%だが、
実attemptをtradeと再現したのは634/1187=53.41%。完全観測ではなく、精密な因果帰属には使えない。
Uniswap active liquidity未保存→300,000 USD fallback、出力残高丸め、raw tx.to未保存の制約をfixtureにも記載。

**専門モジュールの評価**: opus-1の旧60世界もreceiptとsubmittedを再結合した。
[監査JSON](../eval/dev3-v4-opus-audit.json)の通り、741 revertsはbundle522 / 単脚swap107 / balancer49 / curve21 / rawTx42。
Liquity購入19・償還19・清算5は全て成功、submit_failedも0。741件をLiquityの失敗率と呼ぶのは誤り。
ただし成功19/19・5/5は少数かつ試行が選ばれた標本であり、将来の安全証明ではない。
以前の[会計分解](DESIGN-REPAIR-01-astra.md)ではcdpの専門等残差は+2533 USD/世界、
償還のみのblockなどにも寄与が見られた。これは別seed集合の既存分析で、今回モジュール単独Pを再推定していない。

限定案はレジーム名で分岐せず、観測状態だけから独立因子として設計する。
償還は既存eUSDのみなら新規資金拘束を避けられるが、初期eUSD=0のためそれだけでは機会を作れない。
購入から始める場合は、最大500 USDか資産1%の小さい方・1ポジション・残40block以上・費用/手数料/価格逆行分を引いたnet≥0.05、
前取引の残高確定後のみ次段へ進む状態機械が必要。native ETH受取→wrap→spot回収まで±20%帯に合算し、利益0の強制売却で閉じない。
清算は明示borrower 1件・通常モード・SPの吸収余力確認・市場価格で評価した報酬net>0・epoch最大1試行の案。
競合清算/価格更新/償還手数料とhint/部分回収の変化は残る。SDKの静的validateだけでは保証できない。
SDKは償還helperを用いるが、実際のhelper/承認/回収を今回チェーンで検証していない。
**v4では専門モジュールを実装しない**。無効果のONスイッチも置かず、全OFFを維持する。

## 2. 実装した因子と既定

[agent.ts](../../example/agents/xb-r/agent.ts)と[prompt.md](../../example/agents/xb-r/prompt.md)。
全新因子OFFで既定はv3と同一。8,660フレームについてd30cbbb原本との候補選択・状態付きcreateAgentの両方で一致をassertした。

| 因子 | 既定 | ON / 診断設定 |
|---|---|---|
| R10_FULL_DEPTH_SIZE | OFF | サイズ目標を既存のe/(2s)まで使用。深さ上限、資産8%、入力残高90%、±20%帯を維持 |
| R11_SMALL_SINGLE_CAP | OFF | 単脚のみ資産上限を8%→4%。bundle上限は8%のまま |
| R12_UNCONFIRMED_BACKOFF | OFF | 未確認単脚の同base待機を2→4block。厳密な次block残高確認時のみ解除。R8 OFFなら確認後も従来2block |
| R9_BUNDLE_HEADROOM（既存） | OFF | 単脚を初期±10%に抑えてbundle用の帯を残す。bundle各脚の±20%は不変 |
| R7_SINGLE_ENTRY（既存） | ON | 厳格化実験はfalse＋SINGLE_EDGE_BPS=75。復元を含むanchor通過も新規リスクゲートを満たす必要あり |
| ENTRY_BPS（既存） | 50 | AI権限対象はこれだけ。20–60、5bps刻み。固定評価中は推論更新を無効化 |

R12はbaseごとに未確認試行を保持し、別baseへの送信でも消えない。run変更/巻戻り/horizon再開で破棄。
重複block・deadline・不正入力で新たな試行を記録しない。bundle優先と利益のある終盤復元の例外を維持。
canFund、観測残高で両脚独立に資金確保、gas予備0.05 ETH、net≥0.05 USD、positive priority、80bps slippageを変更していない。

固定v2残高上での **v3既定に対する** v4単独因子の効果。将来の在庫/競合変化を含まないため採用判定ではない。

| 因子 | 追加判断 | 消える判断 | 既存判断変更 | モデルnet差 USD |
|---|---:|---:|---:|---:|
| R10 | 0 | 0 | 0 | 0.00 |
| R11 | 0 | 0 | 23 | −1535.53 |
| R12 | 0 | 13 | 0 | −251.84 |
| R9 | 0 | 235 | 120 | −2187.32 |
| R7 OFF + 75 | 0 | 340 | 26 | −927.65 |

R10は今回の選択判断に変化がなく低優先。R11/R9/R7は目先の機会を捨てて後続の在庫余地/品質を得る仮説、
R12は繰返し失敗を減らす仮説。いずれも固定フレーム上の損失があるため既定ONにはしない。

## 3. テスト・赤対照

- `npm run typecheck`: PASS。戦略静的検査: 1ファイル、findings 0、PASS。
- **159/159 PASS、skip 0**（既存136維持＋追加23）。
- **43/43 intended RED**（既存33維持＋追加10）。全件exit 1 / ERR_ASSERTIONを確認し、ロード・構文エラーを赤と数えない。
- 各変異後に原本を復元、全変異終了後の159件もPASS。実装SHA256 `ab2f26337c716eb73a8b4657758f20934028e6e3895ee3a4e3fd02d6a696e763`。
- [検証記録と全mutation結果](../eval/dev3-v4-validation.json)。詳細ログは `/var/folders/yk/mx8jn78j6xq0w5l4z9d8hbvw0000gn/T/xb-r-red-controls-KyJpya/`。

fixtureはdev3bのcdp 2 / depeg-persist 1 / launch 1とdev3aのwhale 1 / calm 1、計6フレーム、約42 KB。
実際のrun_dir/入力hashとd30cbbbから検証したgolden出力を含む再構成fixtureであり、runtime snapshotとは呼ばない。
データのテストに加え、資金が少ない場合のサイズ効果、WBTCを含む在庫境界、全16組合せの安全ゲート、
状態の確認/未確認/別base/リセット/終盤、候補生成後に資金・gasが不足した場合のselector再検査を確認。

```sh
npm run typecheck
node --import tsx scripts/checkStrategyCode.ts example/agents/xb-r/agent.ts
node --import tsx --test --test-concurrency=1 test/xb-core.test.ts test/xb-variants.test.ts test/xb-r.test.ts test/xb-r-dev2.test.ts test/xb-r-dev3a.test.ts test/xb-r-v4.test.ts
node test/xb-r-red-controls.mjs
node --import tsx ascon-notes/eval/diagnose-xb-r-dev3-v4.mjs ../upstream-eval /tmp/xb-r-dev3-v4
```

赤対照はleague-v2のagent.tsだけを一時変異し、各回/最終finallyで原本SHA256に復元する。
upstream-evalで走るdev4に書込みはなく、ソースはd30cbbbのまま。テスト並列度1、チェーン計測は起動していない。

## 4. dev4後のON判断ルール（事前の運用判断、性能予測ではない）

dev4の24世界が完了し、G0/コードhash/12レジーム×2seedを確認してから使う。途中結果で設定を変えない。
以下の「ON」は **次の独立アブレーション枠** を指し、提出・資格認定を意味しない。
全レジームで同じ固定設定を使い、agentにレジーム識別ロジックを入れない。

| 観測される条件 | 次に試す因子 |
|---|---|
| 平均(Tcand−Tmulti)≥0、全レジーム平均(T−Tnoop)≥0、安全全件合格 | 新因子は全OFF維持。Q0以外の未完条件は別途確認 |
| T不足、cand/multi成功bundle数<0.5、参照成功付きnoopの在庫帯ブロック≥25% | R9のみONの24世界。whaleだけを重くしない |
| T不足、平均単脚cashサイズがmultiの1.25倍以上、上記帯ブロック≥25% | R11のみONの24世界。R9と同時に始めない |
| T不足、深さ目標だけでサイズが抑えられた正net候補が全正net候補の≥5%、他hard capには余地あり | R10のみON。dev3の選択変化0件だけでは条件を確認できず保留 |
| submit_failed率≥3%、かつ同base未確認後4block内の再試行失敗≥2件、または同パターンのmined revert≥1 | R12のみONの安全診断。1件でもmined revertがあれば性能因子追加を止めて原因確認 |
| ENTRY後edge 50–75bpsの成功単脚≥20件、そのbucketの合計(E−gas)<0 | R7 OFF / SINGLE_EDGE_BPS=75のみを試す。単に回数が少ないだけなら厳格化しない |
| T不足、参照成功付きnoopのうち45<edge≤50bpsかつ他gate合格が≥10% | ENTRY=45のみの診断。AIの20–60権限は維持し、根拠なく20へ下げない |

上記のgate/quote bucketは完全ログがなければ再構成値であり、条件を観測できない因子はOFFを維持する。
複数成立時は安全(R12)→在庫(R9)→サイズ配分(R11)→ENTRY→R10/R7の順に一因子ずつ比較。

**候補既定へ昇格する共通条件**: 同seed/同F_refで凍結v3と比較し、12レジーム等重み **ΔT≥+1.0**、
各レジームのv3比ΔT≥−2.0、全レジーム平均(T−Tnoop)≥0、全24世界noop割れ0、violations0、mined revert0。
preflight失敗率はv3を上回らず、片脚bundle率も悪化させない。R9は成功bundle数がv3比≥25%増も要求する。
安全目的R12は、対象の繰返し失敗を≥50%減らし、平均ΔT≥0なら診断既定への昇格候補にできる（他条件は同じ）。
差分合格だけでQ0 PASSにはしない。Q0は別に **絶対平均Tcand≥Tmulti** を満たす必要がある。
使用済みseedの対照は開発診断と明記し、最後に未使用seedで資格を確認する。複数因子の合算効果を推定で足さない。
専門因子は今回ON対象なし。実装と多段回収のチェーン検証を行ってから別計画にする。

## 5. 未検証・作業境界

v4実現P/T、dev4の結果、動的在庫/競合応答、R9の将来bundle回復、R12の実際のrevert抑制は未検証。
専門機能の回収・競合・helper/承認も未検証。Docker/public60/agent bundle/selftest/フルnpm testは実行していない。
upstream由来の参照agent/SDK/runtimeは変更なし。upstream-evalは読み取りのみ、鍵/.envは開いていない。コミットなし。
