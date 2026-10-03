### 1. 仮説（1つ）

**zeta-2の単脚裁定に「観測した競合を上回る入札を、既存の利益予算内で払える場合だけ送信する」条件を追加すれば、割に合わない後順位約定を減らせる。**

狙う弱点は、入口判定を通した注文でも、保守的な利益見積もりが非正ならゼロ入札で送信する不整合。zeta-2の送信の40.81%がゼロ入札で、calm/201の対応する成功注文87組中85組はinc-zetaより後順位・不利価格だった。ただし、因果効果は分離されていない。[診断・主要所見](/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/league-v2/ascon-notes/league/ZETA2-REGRESSION.md:7)

### 2. 利益の仕組み（なぜ他の参加者から取れるか・どの資産/venueの何を見るか）

利益源は既存のまま、**WETH/WBTCの公正価格とUniswap・Balancer・Curveの価格差**。安いvenueで買い、高いvenueで売る。[カード・共通の核](/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/league-v2/ascon-notes/league/STRATEGY-CARDS-U1.md:5)

競合も同じ乖離を取るため、先行注文が価格差を消した後の約定は不利になりやすい。競争可能な注文を残し、予算不足の注文を見送ることで、残存する裁定利益の確保と不利約定の回避を狙う。相対Tの改善は、必ずしも他参加者からの直接的な資産移転を意味しない。

問題は主に同一ブロック内の順序であり、確認待ち時間ではない。同額5 gweiでも先行された記録があるため、**上限で競合と同額になる注文も見送る**。[診断・具体的約定例](/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/league-v2/ascon-notes/league/ZETA2-REGRESSION.md:140)

### 3. 予測（方向・おおよその大きさ・どのレジームで効くか/効かないか）

検証前の作業仮説は、**未変更zeta-2比で12レジーム等重み平均Tが＋2〜5程度**。これは測定値から推定できた効果量ではなく、観測されたinc-zetaとの差13.28 Tの一部を回復するという暫定予測である。

- **効きやすい予測：calm、informed-flow、vuln。** 不利約定と途中からの損益差拡大が観測されている。
- **cdp-incident：部分的。** WETH購入直後の無条件売却による損失増幅は残る。
- **crash、whale：改善方向は不明。** とくにcrashでは既にzeta-2が60.03、inc-zetaが58.82であり、単純な改善余地を仮定できない。
- **cex-drift、launch：利益機会を見送って悪化する可能性。** 前者でvenue-arbが73.70を得た低閾値戦略の利点や、後者の専門モジュールを再現する変更ではない。

根拠は[レジーム別T](/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/league-v2/ascon-notes/league/report-u1m.md:15)と[在庫経路の診断](/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/league-v2/ascon-notes/league/ZETA2-REGRESSION.md:148)。3 seedの自チーム内診断であり、性能は未実証。

### 4. 失敗条件（これが観測されたら仮説は誤り）

同じ対戦相手・資金・配置で、候補と基準を別々の初期化した世界で比較し、未使用seedと配置入れ替えでも確認する。

**見送りが十分発生しているのに、終端のΔ(P−noop)とΔTの平均がともに非正で、その95%区間上端も0以下なら棄却する。** 区間が0を跨ぐ場合は未決着。

平均が改善しても最悪レジームTが基準より3以上悪化したら採用しない。3 Tは新設する判断基準で、既存データから導いた値ではない。リバート数や手数料だけの減少は成功と数えない。

### 5. 必要な観測（decide() が見る現在・過去の合法な情報だけ。レジーム名・seed・将来情報は使わない）

現在の観測だけで判定する。

- 各資産の公正価格、各venueの価格・手数料。
- USDC/WETH/WBTC残高、ガス用残高。
- `obs.competition.maxCompetitorPriorityFeeWei`。
- `obs.limits`の既定・最大priority fee。

競合値はSDKが提供した観測を使う。全市場の最大値であれば、当該venueと無関係な競争まで拾って過剰に見送る可能性がある。必要値が欠落・非有限・不正なら対象単脚はnoop。明示的な競合値0と欠落は区別する。

レジーム名、seed、事後再構成された損益、将来価格は入力にしない。

### 6. 実装の概要（どのモジュールを足す/変えるか、サイズ・入札・撤退の具体的な数値案）

zeta-2をコピーした提出候補の`delta.ts`で、既存の最良単脚を選び、サイズと入札額を計算した直後に送信ゲートを追加する。

1. **入口・サイズを維持：** 手数料＋50 bps、入力資産残高の2.5〜25%。候補の順位も維持。
2. **利益計算・入札を維持：** 75 bpsの不利執行控除、利益予算30%、推定ガス140,000、競合＋0.1 gwei。[診断・計算差](/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/league-v2/ascon-notes/league/ZETA2-REGRESSION.md:129)
3. `c＝観測競合入札`、`d＝既定入札`、`M＝観測上限`として、必要入札を **`r=max(d,c+0.1 gwei)`** とする。
4. 保守的利益が正、`r≤M`、既存bidderの返す額が`r`以上、の**全条件**を満たす場合だけ送信する。比較は整数weiで行う。
5. 不成立なら**0注文・noop**。次候補への切替、サイズ変更、待機期間の追加はせず、次回観測で再判定する。

観測上限5 gwei・競合5 gweiなら、必要額5.1 gweiなので見送る。既定額・上限を本番で固定値と仮定しない。定数はコードに内蔵し、環境変数に依存しない。二脚裁定と専門モジュールは変更しない。

### 7. 安全な出口と最悪ケース（資産損失の上限、5秒締切、無効注文の防止）

**新しい撤退動作は、条件不成立時に発注しないこと。** 保有資産の出口は既存方針を継承する。新たな強制売却や損切りを加えると、在庫方針という別因子になる。

単脚の入力額は当該資産残高の最大25%だが、これは総資産損失の上限ではない。75 bpsも保有中の価格下落を制限しない。反復取引・既存在庫を含めれば、**保有資産価値のほぼ全額を失う可能性が残る**。推定140,000 gas・5 gweiならpriority feeは0.0007 ETHだが、実ガス量の保証ではない。

`canFund`、正の数量、実残高以下、資産ごとのdecimalsを確認する。WBTCは18桁前提のdust判定を流用せず、8桁の正確な残高比較を行う。[現在の資金確認](/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/league-v2/example/agents/zeta-2/delta.ts:91)

追加処理は観測値の整数比較のみで、RPC・待機・探索を追加しない。全体4秒時点で新規判断を打ち切りnoopへ戻す設計とし、5秒締切への余裕を確保する。ただし既存処理を含む時間保証は実装時に検証が必要。部分約定リスクも残る。

### 8. 既存の戦略との違い（STRATEGY-CARDS のどのプレイヤーに近いか・何が新しいか）

最も近いのは**zeta-2**。inc-zetaの高い入札へ一律に戻すのではなく、zeta-2の保守的利益予算を送信可否にも適用する。

カードのzeta-2が送っていたゼロ・低額入札の単脚を止め、さらに上限で競合と同額になる場合も止める点が変更点。sonnet-2のような利益配分率変更や、opus-1のような在庫統制は加えない。[戦略カード](/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/league-v2/ascon-notes/league/STRATEGY-CARDS-U1.md:12)

### 9. 因子分類（入口閾値/サイズ/入札/在庫/専門モジュール/観測による制限のどれに当たるか、または新機構）

**観測による制限：1因子。** 既存の入口閾値・サイズ・入札計算・在庫方針・専門モジュールを固定し、選ばれた単脚を送るかだけ変更する。

本回答は仕様提案のみ。ファイル変更、実行検証、性能確認は行っていない。