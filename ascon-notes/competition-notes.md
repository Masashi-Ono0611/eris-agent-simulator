# ASCON 競技メモ（2026-10-02 時点・Discord #info/#qa と upstream docs の調査結果）

正本: upstream `docs/competition-start.md`（本 repo 内）、規約 https://ascon.dev/rules 。ここは「自分用の要約と進捗」だけ。

## スケジュール（JST・競技ガイド §1「競技の時系列」より）
| いつ | 内容 |
|---|---|
| 〜10/24 | 参加登録（フォーム）。Discord の ASCON チャンネル参加 |
| 9/23〜10/31 | 提出期間。公開 60 シナリオで自己評価、**1 日 5 回まで**差し替え。同時に試行環境（スコア対象外）が開く |
| 10/31 | 提出締切＝エージェント凍結。最終評価の対象（ガイド内で「2件指名」「最後に受理された1件」と記述が揺れている → 規約で要確認） |
| 11/1〜11/7 | ライブ競技（k エポック、毎回初期化。操作不要） |
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

## 未確認（要対応）
- 規約本文（ascon.dev/rules）未読 — 最終評価の指名数・禁止行為の細部
- 参加登録/チーム登録の完了状況、チームコード
- 推論 API キー登録フォームの実施、利用可能モデル一覧
