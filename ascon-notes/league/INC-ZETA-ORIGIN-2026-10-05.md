# inc-zeta の由来と独自性の開示（2026-10-05）

Masashiは2026-10-05のチャットで、inc-zeta（ascon-zeta の zeta-a30）の実質的改変を「独自戦略」と認め、**条件付き第一候補**にすることを承認した。これは本人の採用判断であり、主催者の独自性認定・資格試験合格・提出受理を意味しない。

## 由来

NyxFoundation/eris-agent-simulator（MIT）の multi-arb → ascon-delta → ascon-epsilon → ascon-zeta → ascon-zeta-r。launch部分には別の上流参照 launch-confirm 由来のコードも含む。multi-arbからの派生を隠したり、全コードをゼロから書いたと説明したりしない。参照元のライセンス・著作権表示を維持する。

| commit | 履歴上の役割 |
|---|---|
| `c80a189` | multi-arbのコピーにパラメータ/guardを追加したascon-delta。既定互換を意図 |
| `e315ecf` | 実行可能quoteの方向別edge、候補別persistence、bundleのnet inventory band |
| `4e8519b` | delta、launch-confirm、Liquity eUSD償還/SPを自己完結ディレクトリへ統合したepsilon |
| `c664039` | launchのfallback飢餓防止、exit優先、RPC timeout、状態reset、multi-arb差分テスト |
| `41832d0aa7c3296284d0a6807eed9060fba23779` | epsilon上に適応優先入札を加えたzeta。コミットの記載も「defaults identical to multi-arb」。現在の測定envによる設定と区別する |
| `5332f1b` | promptを改訂エビデンス用へ適応 |
| `7d3855a` | upstream `99367d4` のlaunch trap-pool filterへの適応 |
| 今回・未コミット | zeta-rとしてzeta-a30設定を焼き込み、環境変数依存を除去、由来をdescriptionに明記 |

この履歴はローカル `git log --follow -- example/agents/ascon-zeta/delta.ts` と各commitのdiff/statで確認した。Claude/Codexの協働による派生実装というプロジェクト内の位置づけはあるが、全行の著作者をこの表から断定しない。

## multi-arbと共通の中核

| 部分 | 上流/共通の出所 | zetaでの所在 |
|---|---|---|
| 全base×AMM venueを走査、最安/最高を選びbundleを優先、次にfair乖離single | `example/agents/multi-arb/agent.ts` の `decide` | `ascon-zeta/delta.ts` の `chooseAction` |
| bundle入口=両venue手数料+50bps、single入口=venue手数料+50bps | multi-arb `SAFETY_MARGIN_BPS=50` とroundtripCost/single判定 | delta `DEFAULT_PARAMS` およびlegacy互換single分岐 |
| 残高比2.5〜25%、spread/gap gain=200000 | multi-arb `MIN_SIZE_BPS=250`, `MAX_SIZE_BPS=2500` | 同名deltaパラメータ |
| bundleの売却量=推定取得量×0.98、slippage bundle120/single75bps | multi-arb baseSell/各action | delta baseSell/各action |
| WETH/WBTC等の観測正規化、venueのmid/実行quote/手数料 | 共通 `example/agents/lib/markets.ts` | 同helperを利用 |

上記は独自発明として扱わない。既存の差分テストが既定deltaとmulti-arbの互換を確認していることも開示する。なお、コードコメントの「delta-neutral」は完全な無在庫リスク保証ではなく、非原子的bundle、0.98売却量、single fallbackによる在庫リスクが残る。

## 私たちが加えた/適応した部分

- 適応入札: 観測した競合最高tip+0.1gweiを狙い、fee上限・想定利益配分で制限。zeta-a30はbidMode2、利益30%、gasPerSwap140000。入口閾値とポジションサイズの基本式はmulti-arb由来のまま。
- Liquity統合: eUSD割引購入/償還、Stability Pool、観測可能なriskiest trove清算、ETH/WETH回収とdelta fallbackの優先順位。SDK/上流プロトコル部品を利用している。
- launch統合: **launch-confirm由来**の需要確認/exitロジックを再利用し、fallbackの継続、保有時exit、待ち時間上限、trap filterへの適応を加えた。launch全体を独自発明とは記載しない。
- 状態管理: 初期ETH/WETHアンカー、block逆行/gap時のreset、watch/pending/max-hold/endgame、persistenceなど。常に実効ONとは限らず、zeta-a30のdelta persistence/inventory band/endgameNoNewBlocksは0。
- releaseの再現性: ascon-zeta-rのdelta環境変数依存を除去。ascon-zeta自体は変更しない。promptの「delta endgame guardは有効」と読める旧記載を実際の既定0に合わせた。Liquity/launchの既存guardは変更していない。

## 提出規約について確認できた範囲

2026-10-05に [公式競技規約](https://ascon.dev/rules) の提出条件・改訂・禁止行為を参照した。取得したページは**10/20発効版**の表示であり、10/5の適用版との一致は未確認。参照エージェントの利用/改変を禁じる提出条件は確認した範囲では見当たらないが、これは適用版や主催者判断を確定した法律上の結論ではない。

ローカル `docs/competition-start.md` §3にはテンプレート複製による作成手順があり、§8には参照例の説明がある。ただしテンプレート利用の説明だけで、独自性について包括的な許諾を推論しない。提出にはdecideとkind: improveのpromptが必要で、改訂経路の適合/実動作は今回未検証。

説明文の採用案（zeta-r/prompt.mdに反映済み）:

```yaml
description: "multi-arb 派生: adaptive priority bidding (zeta-a30), Liquity integration, and launch-confirm-derived specialist."
```

提出時の日本語補足案: 「MIT公開参照multi-arbを基礎に、適応優先入札・Liquity統合・launch-confirm由来の専門処理と状態管理を追加した派生戦略です。採用設定は提出物に固定しています。」

本人決定: **2026-10-05チャット承認済み — 独自戦略と認め、条件付き第一候補とする。** 条件は [Q-ZETA-01](Q-ZETA-01.md) の独立資格試験、安全・提出適合、費用枠等。性能の保証はしない。
