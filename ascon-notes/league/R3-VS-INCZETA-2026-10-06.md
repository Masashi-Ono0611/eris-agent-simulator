[V=verified-by-reading／読解確認、I=inferred／未検証仮説]。以下 `Z/R/R2/R3` は `example/agents/ascon-zeta{,-r,-r2,-r3}/`。現HEAD `714370b` の静的比較であり、実走コードhashとの一致は未確認。

[V] `git log -p` と全ディレクトリdiff：`5ef7577` R作成→`5347243` ZETA環境読込除去→`57a96af` R2修正→`b3b27c1` 通常裁定の入札不足skip撤回→`a5df142` 共通の残高読取対応→`9f72fb2` R3。R2/R3の全TSは同一。

[V] `/tmp/results-2026-10-06/mixed-field-36worlds.txt:1–27`：incは57.42/+621.7/13敗、R3は50.65/+115.5/19敗。簡易T、7世界G0不合格。**depegはR3 63.0＜inc 65.0**。優位はwhale 65.2＞54.6、cex-drift、spike。原因は集計だけでは確定不能。

| 読解で確認した全差分 [V] | 反証可能な予測 [I] |
|---|---|
| **設定固定**：Z/agent.ts:7,18→R3/agent.ts:9,20。launch/redemption/SPは全てtrue。R3:123でlaunch先行、:127のfalseは後段引数で無効化ではない。Liquityとpool-launchは別処理。Z/delta.ts:13,51→R3/delta.ts:14,54は提示envと同値。サイズ・通常入札式は同じ。 | 指定外envがなければ固定化だけでは全レジームの差を説明できない。 |
| **launch設定**：Z/launch.ts:36–53→R3/launch.ts:35–52で8環境読込を固定。確認3block、流入25bps、USDC20%/reserve10%上限、流出10bps、保持60block、終盤12block、slippage1000bps。 | 旧env上書きがなければ差ゼロ。上書きがあればlaunchの数量・参入・退出時刻が変わる。 |
| **allowance**：`example/agents/lib/launchSwap.ts:390–395`の毎回「定額approve＋swap」→R3/launchSwap.ts:12–21のallowance照会、十分ならswapのみ、不足ならapprove単独（USDC最大値／他token定額）、後続判断でswap。R3/launch.ts:165,187,231,241は追加RPCを既存timeout内に置き、entry状態をrawBundle時だけ設定。数量式不変、失敗時そのpoolをskip。 | launch(49.5/72.1)：承認待ち・RPC失敗で売却が遅れ、終端未評価tokenが増えるなら低下を説明。待ちも残存もなければ棄却。 |
| **独立資金**：R3/delta.ts:207–221。売数量以上の既存在庫＋decimals正規化dust判定（0.001base）がなければ売脚を削除、買脚は縮小せず維持。USDC<1ならnoop。片脚でもbundle用入札・120bpsを維持。通常single-leg不変。**SDKは買い出力を後続脚へ加算**（sdk/src/action.ts:305–308,427–432）；旧bundleが必ず資金不足という説明は誤り。 | calm(40.5/48.5)は往復益喪失、lending-incident(37.2/64.9)・crash(45.4/59.7)は買い片脚の下落曝露。whaleでは反発益。片脚化・在庫差がなければ棄却。 |
| **回収対象**：Z/agent.ts:39–42の「初期超過WETHを全売却」→R3/agent.ts:25–83の自分のwrap確認分のみ、売量=min(帰属量,残高)、閾値0.01。通常裁定購入分は回収売りしない。wrap数量・reserveは同じ。block飛びで追跡reset(:35,120)、曖昧wrapは帰属破棄、売却後残高変化で全追跡解除。 | calm・crash・lendingで超過在庫滞留が損、whaleで早売り減少が益。cdp-incident(47.1/60.4)では回収取り逃し。対応する在庫経路がなければ棄却。 |
| **回収停止／費用**：R3/agent.ts:46–77、delta.ts:116–146。nonce不一致、未反映wrap/売却、pool欠落、quote不良、競合+0.1gweiを上限/利益30%予算内で払えない場合noop。quote/fair−1＋35bpsで判定。旧はdefault feeで即売却。追加nonce/quote RPCに独自timeoutなし、例外もnoop(:113)。後続Liquity/SP/deltaも止まる。 | cdp・depegの回収停滞、calmの薄利skip、lending/crashの売却遅延。該当noop・RPC待ちがなければ棄却。depeg優位という仮説は現結果に反する。 |
| **prompt**：R/prompt.md:24のendgame記述訂正、R2:31の修正説明、R3:3–10の名称/説明・改訂抑制文。60block周期同じ。 | FROZENなら差ゼロ。改訂ON時だけ生成変更の差となり得る。 |

[I] 最安の機序切り分け：**R3/delta.ts:220の「売脚削除」だけ無効化**し、同一mixed相手・席・FROZENで対照と別世界比較。Air、p3、lending-incident/crash/whale×seed **64001**×2条件＝6世界。旧見積13分/batch（ascon-notes/league/PLAN-MASA-ASCON-V2.md:132）なら基本0.43h、確認込み約0.7h。売脚復活→下落時在庫減→P−noop改善を予測、whaleでは逆。発火ゼロなら不識別。Tだけでなく脚数・在庫・拒否・回収noopを比較。全G0確認必須。64001は指定除外外、検索した設定・計画・結果に使用記録なし[V]；ホスト全履歴での未使用は未確認[I]。実験・通信・モデル・テスト・commitは実行していない[V]。
