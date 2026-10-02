# ASCON 競技メモ（主催 Nyx Foundation / 2026-09-28 Discord 告知より）

## devnet（試行環境・スコア対象外）
- RPC: https://ascon-rpc.nyx.foundation/ （chainId 31337 / 0x7a69、2秒ブロック）
- ダッシュボード: https://ascon-dash.nyx.foundation/
- エクスプローラ: https://ascon-explorer.nyx.foundation/
- 認証: HTTP ヘッダ3つ（チーム専用キー＋共通2つ）。値は contact@nyx.foundation からのメール
- レート: 100 req/秒（バースト300）。eth_call / eth_estimateGas / eth_getLogs は5回分
- 使用不可: anvil_* / evm_* / eth_sendTransaction 等ノード鍵系 / txpool_* / eth_subscribe
- 送信は eth_sendRawTransaction（署名はローカル）
- 資金: Discord #faucet に `id: <英字・-_>` と `address: 0x...` を投稿（秘密鍵は絶対に貼らない）
- エラー: 403=ヘッダ不足（発行直後は1分待つ）/ 403 method not permitted=意図的に封鎖 / 429=レート超過

## スターターガイド動画（音声なし・日本語字幕）
再生リスト（Discord 告知のURLは末尾が切れている可能性あり。Discord 側で全URLを確認）:
1. 基礎編 — 競技のしくみとブロックチェーン
2. プロトコル編 — AMM・Aave・GMX・LST・Liquity
3. レジーム編 — 12の市場シナリオ
4. 実践編 — エージェントを作る・回す・提出する
番外 — サンプルエージェント12体

## 未確認事項（動画・公式資料で要確認）
- 採点指標（収益/リスク調整/ドローダウン等）と提出形式・締切
- 12レジームの具体内容と、本番とdevnetの差
- エージェントの実行方式（自前実行か提出コードを主催が実行か）
