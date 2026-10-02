# ASCON 競技メモ（2026-10-02 時点・Discord #info/#qa と upstream docs の調査結果）

正本: upstream `docs/competition-start.md`（本 repo 内）、規約 https://ascon.dev/rules 。ここは「自分用の要約と進捗」だけ。

## スケジュール（JST・競技ガイド §1「競技の時系列」より）
| いつ | 内容 |
|---|---|
| 〜10/24 | 参加登録（フォーム）。Discord の ASCON チャンネル参加 |
| 9/23〜10/31 | 提出期間。公開 60 シナリオで自己評価、**1 日 5 回まで**差し替え。同時に試行環境（スコア対象外）が開く |
| 10/31 | 提出締切＝エージェント凍結。**最終評価の対象は、提出期間終了時点で最後に受理された1件**（規約 §2.2・2026-10-03 に ascon.dev/rules で確認。starter ガイドの「2件指名」は古い記述） |
| 11/1〜11/7 | ライブ競技（k=60 エポック、毎回初期化。操作不要） |
| 11/21 | レポートトラック応募締切 |
| 12/7 | 結果発表 |

## 提出フロー
1. `npm run bundle:agent <id>` で zip → Google フォーム（運営の提出フォーム。URLは Discord #qa 参照）
2. 推論サービスの API キーは**別フォームで1回だけ**登録（本番で使えるモデル一覧は推論プロキシ側の公表を確認）
3. 送信数秒後に受理/不受理メールが届く

## 練習 devnet（スコア対象外）
- RPC `https://ascon-rpc.nyx.foundation/`（chainId 31337、2秒/ブロック）、ダッシュボード/エクスプローラは認証不要
- RPC は HTTP ヘッダ3つ必須（値は contact@nyx.foundation からのメール。チーム専用キーは共有禁止）
- 資金: Discord #faucet に `id: <英字・-_>` / `address: 0x...` を投稿（秘密鍵は絶対に貼らない）
- 使用不可: `anvil_*` / `evm_*` / `eth_sendTransaction` / `txpool_*` / `eth_subscribe`。100 req/秒（バースト300、call/estimateGas/getLogs は5回分）
- 詳細: `docs/guide/practice-devnet.md`、接続テンプレ: `ascon-notes/practice.env.template`

## 競技の骨子
- 360 ブロック(12分)=1 エポック、世界は毎回リセット。P=終了時資産−開始時資産、偏差値 T=50+10×(P−平均)/σ、後半ほど重み(1.0→1.5)
- 初期資産 8 WETH + 0.4 WBTC + 25,000 USDC + 1 ETH（ガス）。全員相対評価＝相場全体の上げ下げは相殺される
- 12 レジーム: calm / cex-drift / informed-flow / whale / lending-incident / depeg / crash / vuln / spike / depeg-persist / cdp-incident / launch
- 7 プロトコル: Uniswap V3 / Balancer / Curve / Aave v3 / GMX v2 / LST / Liquity
- 提出エージェントは `decide()` + `prompt.md`(kind: improve)。エポック中の LLM 改訂が唯一の動的要素

## 規約の要点（ascon.dev/rules・2026-10-03 確認。食い違いがあれば規約が正）
- 参加単位はチームまたは個人、チームは 5 名以下。1 日 5 回まで提出を差し替え可
- エポック: k=60、360 ブロック（2 秒 = 約 12 分）。初期資産 USDC 25,000 / WETH 8 / WBTC 0.4 / ガス用 1 ETH
- 実行上限: 2 vCPU / 4 GB。**各ブロックの取引判断の応答は 5 秒以内**。LLM はブロックごとの取引判断をせず、`reviseEveryBlocks`（既定 60）ごとの戦略コード改訂のみ（推論タイムアウト 5 分）
- 禁止（§8）: 実行環境の隔離回避・環境操作機能の呼び出し・主催者設備や他参加者環境への干渉・凍結後の人為的介入・チーム間共謀/複数参加・**自己取引による資産移転**・**評価価格を歪める取引**。他参加者のエージェント/コントラクト/市場構造の弱点を突くことは競技の一部として認められる
- 賞金: リーダーボード総額 300 万円（1 位 100 万・2 位 50 万・3 位 30 万…）、レポートトラック総額 200 万円（応募締切 11/21）

## 未確認（要対応）
- 参加登録/チーム登録の完了状況、チームコード
- 推論 API キー登録フォームの実施、本番で利用可能なモデル一覧（LLM 改訂を使う場合）
- 練習 devnet のヘッダ 3 つ（メール）と faucet 投稿（本人作業）
