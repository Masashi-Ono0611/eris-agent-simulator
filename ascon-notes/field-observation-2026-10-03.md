# 練習 devnet の他参加者の観察（2026-10-03・公開情報のみ）

出典: Grok（読み取り専用・`--permission-mode plan`）が、認証なしのダッシュボード `https://ascon-dash.nyx.foundation` とエクスプローラ `https://ascon-explorer.nyx.foundation` の公開 GET だけで調べた報告（RPC は叩いていない）。**この文書の数値は Grok の報告で、私は独立に再取得していない**（直接取得か推定かは各項目に付記）。練習 devnet の記録は順位に使われない。個人を特定する情報は集めず、id・アドレス・件数のみ。

## 場の構成（直接取得: マニフェスト）
- 参加者 25 = baseline 1 + 参照エージェント 8 + 運営 canary 1 + 外部 15（私たち `masa-ascon` を含む）。
- 終了日 2026-10-01-s03 の 1 日分 tx 数（`summary.json` の `includedTxCount`・直接取得）: 参照 = venue-arb 179,477 / multi-arb 122,734 / basis-arb 107,389 / random 44,289 / clean-arb 20,552。外部で活発 = teemo 28,694 / at 19,369 / corki 8,034 / sophie555-safe 5,035 / onebridge-core 4,335 / noah 2,766。ほぼ静止（0〜365 件）の外部が複数。
- 含意: **場は参照エージェントが大半の取引量を占める**（仮説「フィールドは参照寄り」を一部支持）。ただし練習環境で、ライブ参加者の構成とは限らない。

## 手数料（live の `blocks.csv` 実測・標本ベース）
- 参照エージェントは全員 **0.10 gwei 固定**（`defaultPriorityFeeWei`）。
- 外部の teemo は標本の大半が **5.00 gwei（上限）**、at は 0.10 と 5.00 の混在。ブロック内 `position` は高 tip ほど先頭寄り（標本平均: teemo 約 10、multi-arb 約 19）。
- 含意: **参照 clone に対して手数料で順序を取る戦い方は、既に外部の一部が実行している**。入札戦略（A1/A6）の効果は、この 0.10 gwei 固定の群に対する先着になる。入札は取引コストでもあるので「追加の約定利益 − 追加ガス費」で評価する（Codex 指摘）。

## 参照 clone を見分ける指標（推定・未検証）
venue の幅（Uni `exactInputSingle` + Balancer `swap` + Curve `exchange` の同時利用。venue-arb も同じなので単独では不足）／WBTC を触るか（venue-arb は WBTC を触らない）／同一ブロック複数 tx（multi-arb は約 37% の活動ブロックで 2〜4 本）／手数料の形／method セット（`multicall` 偏重は basis-arb 寄り）／1 日の頻度。

## 取得手段と注意
- ダッシュボード: `/runs/index.json`・`/runs/manifest.json`・`<period>/matrix.json`・`<period>/<day>/summary.json`（終了日のみ）・`blocks.csv`（**live は約 132MB で Range 無視。丸ごと再取得しない**＝末尾は `/runs/<id>/tail/<file>?offset=N&limit=M`）・`intervals.jsonl`（区間ごとの全員の評価額）。`/runs/<id>/agents/*.jsonl` は 404（audience モード）。
- エクスプローラ（Blockscout v2・CORS `*`・`x-ratelimit-limit: 500`）: `/api/v2/transactions`（position・gas_price・priority・method）、`/addresses/{addr}/transactions`（50 件/ページ）、`/tokens/{token}/holders` など。tx の `timestamp` は Anvil 時刻（indexer の `inserted_at` とは別）。
- 禁止・グレー: 他参加者環境への干渉、運営設備への攻撃、**エクスプローラを第二の RPC として使う**こと（`/api/eth-rpc` 等の proxy 経路は使わない）。読むのは公開されている記録のみ。

## 未確認
- ライブ競技の参加者数・構成（練習環境の 25 と同じとは限らない）。
- `intervals.jsonl` で突出した評価額の外部 1 件（約 76 万。公式バスケット以外の自前トークンを含む可能性）は、中身の確認をしていない。
