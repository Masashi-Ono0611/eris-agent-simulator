# 専門戦略の decide(obs) 実現可能性

## 調査結果
- `runtime/strategyWorker.ts:51-53,72` は `decide(observation, ctx)` を呼ぶ。`ctx.publicClient` は read-only RPC だが各判断の同期予算は `StrategyRunner` の既定 5 秒。
- `writing-agents.md` の decide 契約は観測を引数で受け、`run(ctx)` は `onObservation` と独自ループを使う（`strategyWorker.ts`）。`ctx.submit` は利用可能だが、decide から遅延 callback を使えない。
- `liquidator/agent.ts` は `ERIS_LIQUIDATION_VICTIMS` を `process.env` から読み、各 victim に `getUserAccountData` RPC を行い HF を判定して `rawTx` を送る。victim 群は `AgentObservation` に無く、単体decideへ環境変数も渡されない。`ctx.publicClient` は読み取り可能でも victim 情報の受け渡しがないため**不可**。観測の別プロトコルに同等データもない。
- `lib/aave-liquidation.ts` は `liquidationCall` calldata を作るだけで victim/HF 検出はしない。calldata 生成だけ移せても戦略全体は不可。
- `sp-underwriter/agent.ts` は `protocols.liquity` の `riskiestTrove`, SP残高/報酬、USDC残高を使い、`liquityLiquidate`, `liquityWithdrawFromSP`, `liquitySwapEusd`, `liquityProvideToSP` を返す。これらは `sdk/src/types.ts` / action schema にあり**可能**。ただし拘束預け入れの回収はエポック末に注意。
- `redemption-arb/agent.ts` は `discountBps`, `redemptionRateBps`, `eusdBalanceWei`, pool reserves と残高で売買/償還判断。`liquitySwapEusd` と `liquityRedeem` があるため**可能**。ETH受取後のwrap/swapも観測・rawTxで可能。
- `protocols-and-actions.md` は `rawTx` と semantic Liquity actions を列挙。SP deposit/withdraw と liquidationCall相当（Liquityの `liquityLiquidate`）は利用可。
- `lib/exploit.ts` は bytecode selector復元と `PublicClient.simulateContract` が必要。`decide` は ctx経由のread-only clientを持つが、対象選定・多重RPC・シミュレーションを5秒内で安定完了できる保証なし。今回は依頼対象の専門戦略ではなく実装しない。
- 環境変数は run worker の `process.env` に存在しうるが、decide契約で公開保証された戦略設定ではない。epsilonは `ASCON_EPSILON_PARAMS` を読み、victim設定依存を避ける。
- 資産拘束を避け、末尾20ブロックでは新規のSP預入・eUSD購入を開始しない。回収可能な報酬請求・償還後のETH売却は継続する。

## 判定
- Aave liquidator: **不可**（obsにvictim一覧/HFがなく、既存実装はrun(ctx)専用設計）。
- Liquity Stability Pool underwriter: **可能**（観測とsemantic actionで判断可能）。
- eUSD redemption arb: **可能**（観測とsemantic actionで判断可能）。
- exploit-hunter系: **未実装**（観測外チェーン探索の負荷と5秒制限のため）。

## launch-confirm 追記
- launch-confirm: **可能**。registry の `uniswapV3Pool` と USDCペアから新規上場を見つけ、read-only `ctx.publicClient` で fee / reserve / Swapログ / token残高 / quoteを読み、連続買いフロー確認後に `rawBundle` で参入する。
- `runtime/strategyWorker.ts` は `await decide(observation, ctx)` なので Promise を返す `decide` は対応済み。 epsilon には同戦略をコピーし、`../lib/launchSwap.js` のみ共有する。
- 保有中は launch 専門判断を先に行い、売りが不要なブロックも delta にUSDCを使わせない予約状態を設ける必要がある。出口条件は売りフロー、保有60ブロック、残り12ブロック。
- 参入確認の連続性と持ち越し状態、RPC遅延/ログ取得失敗、提出ランタイム上の rawBundle 実行は実測 backtest で追加確認する。
