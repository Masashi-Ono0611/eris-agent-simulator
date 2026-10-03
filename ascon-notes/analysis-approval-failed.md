# approval_failed 原因調査

## 結論
- **`approval_failed` は見かけの失敗で、承認は実際にはチェーンに着地している（提出前に直す必要はない）**。2026-10-03 に、読み取りのみでウォレットの allowance を直接照会した（manifest の 5 トークン × コントラクト住所 52 件 = 260 組）ところ、**23 組が最大値（max）で有効**だった。Uniswap（swapRouter・nonfungiblePositionManager）・Balancer vault・Curve pool・Aave Pool・GMX Router・LST（lstToken・pool）・Liquity（redemptionHelper）・stableMarkets（DAI・EUSD の pool）の全 venue で、起動時の承認が着地している。したがって「An unknown RPC error」は、承認の**送信後**の確認（レシート取得など）で出た例外で、承認自体の失敗ではないとみられる（**確認の段階のどのメソッドが落ちたかは未特定**。ログに method/status が残らないため）。
- 当初の調査（ログとコードだけ）は「承認が通ったか区別できない」ため慎重に「提出前に確認すべき」としたが、チェーンの実測で覆った。実行は止まらず、20 件の `submitted` が着地し残高も動いた。
- `submit_failed` 2 件（`ERC20: transfer amount exceeds balance`・`BAL#507`）は、承認とは別の原因（残高競合・価格変化・スリッページのいずれか）で、**桁の誤りは確認できず、原因は未特定**（下記）。件数は 2 件で、取引の継続を妨げていない。
- 問題は epsilon 固有ではない。承認は全有効 adapter の起動時セットアップ（`botMain.ts`）で、ランタイム側の挙動。

（以下は、実測の前に書いた調査の詳細。承認が着地していた事実と矛盾する箇所は「実測で覆った」と読むこと。）

## コード経路
- `example/agents/runtime/botMain.ts:527-563` が adapter の `setupWallet()` を列挙し、各 tx の `to`（トークン）と approve calldata の spender を読み、`allowance(owner,spender)` を読む。allowance が要求額の半分未満なら approve 対象。
- `botMain.ts:565-580` が不足分を `sendAndMine` し、例外ごとに `approval_failed`。ループ後は成功数でなく対象数を `approvals_granted.count` として記録するため、29 は成功件数ではない。
- `botMain.ts:701-710` でブロック監視前に一度だけ実行。再試行ループは見当たらない。approve は `sdk/src/protocols/uniswap.ts:1667-1675` の ERC20 `approve(spender,maxUint256)`。
- 有効 adapter の例: Uniswap は market base/quote token を swap router と position manager に承認（`uniswap.ts:1646-1662`）；Balancer は各 market の base/stable を Vault に承認（`balancer.ts:647-660`）；Liquity は eUSD/USDC を market pool、eUSD を redemption helper に承認（`liquity.ts:1743-1754`）。Curve/Aave/GMX/LST 等にも setupWallet がある。今回のログだけでは各 `to` のアドレス対応と spender の組を一意に復元できない。
- `send.ts:194-214` は gas 未指定 tx で `eth_estimateGas`、失敗時 pending nonce 判定を試みる。`send.ts:124-130` は nonce を `eth_getTransactionCount(address,"pending")` で得る。送信は walletClient `sendTransaction`（`send.ts:233-244`、viem の署名済み raw tx 経路）。SDK の client/fee 設定により block/fee 読み取りも行う。gateway README は `eth_sendRawTransaction` を許可（121行）、pending nonce を許可（155-158,175行）、heavy read の `eth_call`/`eth_estimateGas` は 5 倍課金（78-89行）。

## ログで確認できる事実
- 29 件は 2026-10-03 03:04:52.272〜03:05:34.926 UTC、全て同じ `An unknown RPC error occurred.`（ログ1-29）。token=`to`別件数: `0x04370…A27A` 10、`0x4806…75f4` 7、`0x1645…0e07` 6、`0xdF2F…3845` 3、`0x1fE6…6bC9` 2、`0xF02d…4D43` 1。
- 約1.4〜1.7秒間隔で反復。ログは approve spender、RPC method、HTTP status/body、allowance 値を記録していない。アドレスの token 銘柄対応はこのログからは確認不能。
- `approvals_granted count:29` は最初の approve_failed の後（ログ30）。実装上、成功した approve の有無を示さない。
- 送信後、`liquitySwapEusd` と `liquityProvideToSP` は submitted（ログ32-33）。次の SP 入金は transfer amount exceeds balance で失敗（ログ34）。後続には Curve/Balancer/Uniswap trades の submitted がある（35-39,41以降）。

## RPC エラーの整合性
- Gateway README `infra/rpc-gateway/README.md:96-117` は privileged/非許可 method を node 到達前に HTTP 403 + JSON-RPC error とする。標準 allowlist は全 `eth_` prefix ではなく明示列挙（107-116行）。従って `anvil_*`, `evm_*`, `debug_*`, `txpool_*` 等拒否は仕様と整合。
- 一方、approve に通常必要な `eth_estimateGas`, `eth_call`, `eth_getTransactionCount(...,"pending")`, `eth_sendRawTransaction` は資料上許可。`eth_feeHistory` 等の個別許可有無は README の該当一覧だけでは確定できず、今回の実際の呼び出しもログにない。
- README 78-89行の rate limit は超過時 HTTP 429 + JSON-RPC error、heavy read は5 token。1.4秒間隔の低頻度 approve だけを見ると429を積極的に示す材料はないが、他プロセス/観測の同時利用や短い初期 burst はログだけでは除外不能。
- viem の文言 `An unknown RPC error occurred.` は method/status/body を失った上位の汎用エラー表示と整合するが、当該依存版で403/429/ノード応答をその文字列に包む実装箇所は本調査で確認できず、(a)(b)(c) の識別は不能。禁止 method が原因なら通常の approve 経路からは考えにくい。429またはノード/transport error は排除できない。

## 影響と submit_failed
- approve失敗後も取引できる理由はログ・コードから確定できない。既存 allowance が半額以上なら approve を送らず pending 対象外（`botMain.ts:553-563`）だが、失敗した29件は allowance 不足判定後に送信されている。別経路で後から承認された証拠もない。すでに十分な allowance があったという説明はこの29件には当てはまらない。
- 失敗 allowance が必要な venue/action は後日 revert し得る。Liquity swap は privileged token transfer 経路もあり得る（`liquity.ts:1745-1747`）。個々の成功 trade の calldata/receipt/allowance を照合していないため、実際に allowance 不要だったかは未確認。終了時資産価値への純影響は残高・receipt 全履歴がなく算定不能。失敗 tx 自体は取引不成立で機会損失と gas 消費の可能性がある。
- `submit_failed` 残高不足は SP に eusd を全額提供する判断（epsilon `agent.ts:46-55`）後、残高が先行 action 等で減った可能性と整合。観測残高と実行時残高の差/競合をログだけで分けられず、桁誤りとは断定不能。epsilon の WETH excess は初期残高超過分だけ swap（`agent.ts:38-42`）、USDC は残高の1/10（55-58,64-68）；明白な単位誤りは確認できない。
- Balancer `BAL#507` は `balancerSwap`（ログ40）。epsilon の直接分岐以外に `deltaDecide`/launch からも action が来る。epsilon に独自の Balancer サイズ計算は見当たらない。adapter は入力額を観測残高以下に検証（`sdk/src/protocols/balancer.ts:321-340`）、quote 出力から slippage limit を作る（343-360）。BAL#507 の意味をこのコードだけで特定できず、残高競合・プール状態変化・slippageのいずれかは未確定。ログ前後は WBTC の Curve/Balancer/Uniswap 注文が続く（35-40）ため競争/価格変化は推測候補だが、先行取引が直接原因という証拠はない。
