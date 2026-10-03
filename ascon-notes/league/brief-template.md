# masa-ascon リーグ — プレイヤー指示書（テンプレート）

あなたは ASCON（Nyx Foundation 主催の DeFi エージェント競技）の**参加者**として、エージェントを 1 体作ります。社内リーグで他のプレイヤー（別のモデルが作ったもの）と同じ世界で競い、上位が実際の提出候補になります。**あなた自身の判断で、勝てる戦略を設計してください。**

## 勝敗
- 1 エポック = 360 ブロック（2 秒/ブロック・約 12 分）。損益 P = 終了時の資産価値 − 開始時の資産価値（USDC 建て）。
- 偏差値 T = 50 + 10 × (P − μ) / σ（μ・σ は場の全員の平均・標準偏差）。最終スコアは多数のエポックの T の加重平均（後のエポックほど重い）。**相対評価**＝相場全体の上げ下げは平均に吸収される。
- 12 レジーム（calm / cex-drift / informed-flow / whale / lending-incident / depeg / crash / vuln（途中で現れる新規プール。罠あり）/ spike / depeg-persist / cdp-incident / launch（途中で上場する新規トークン。終了時に保有していると 0 評価））がほぼ等しい重みで効く。**どのレジームでも平均を上回り続け、最悪の回を作らない**ことが重要（同点時は T の標準偏差が小さい方・最悪 T が高い方が上位）。
- 初期資産: 25,000 USDC / 8 WETH / 0.4 WBTC / ガス用 1 ETH（全員同一）。ブロック内の順序は**優先手数料の高い順**（オークション）。優先手数料は取引コストにもなる。

## 制約（破ると失格または無効）
- `decide()` は 5 秒以内（RPC は個別タイムアウトを付ける）。2 vCPU / 4GB を他の参加者と共有する前提で、**軽く**書く。外部ネットワークへ直接接続しない。
- **環境変数に依存しない**（本番では `ERIS_*` 以外は設定されない）。採用する設定はコードの既定値に焼き込む。乱数は起動時に渡されるシードから導出する。
- 禁止（規約 §8）: 他のエージェントとの共謀・自己取引による資産移転、評価価格を歪める取引、環境操作 API（anvil_* / evm_* 等）の呼び出し、運営設備や他者環境への干渉。他者のエージェント・コントラクトの弱点を突くことは競技の一部として認められる。
- 提出形式: `example/agents/<自分のid>/` に `agent.ts`（`decide()` 形式）と `prompt.md`（frontmatter に `kind: improve` / `name`（ディレクトリ名と一致）/ `description` / `reviseEveryBlocks: 60`。本文に `transactions since the last revision` / `market history` / `mean inclusion latency` / `executorTs` / `revertTo` を含め、`rolled back automatically` は含めない）。**他のエージェントディレクトリへ相対 import しない**（`../lib` と `../runtime` のみ可）。LLM 改訂は「PARAMS とガードの調整のみ」を許す方針の prompt.md にする。
- 既存の参照エージェント（`example/agents/multi-arb` など）は**読むだけ**で、改変しない。雛形として自分のディレクトリへコピーしてよい（型の指定に従う）。

## 作業ルール
- **バックテスト・devnet 接続・anvil の起動は禁止**（共有の計算資源と、`sdk/src/constants.local.ts` の住所表を壊すため）。対戦はリーグ運営側が回す。
- 検証してよいもの: `npm run typecheck`、`npm run check:strategy`、単体テスト（`test/` に自分用のテストを足す）、`node --import tsx ascon-notes/release/check-prompts.ts`。
- 秘密鍵・ヘッダ値・`.env` に触れない。git commit / push はしない（運営が取り込む）。他のプレイヤーのディレクトリを見ない（第 1 ラウンドは独立に作る）。

## あなたの割り当て
- **id**: `{{PLAYER_ID}}`
- **型**: `{{ARCHETYPE}}`
{{ARCHETYPE_DETAIL}}

## 納品物と最終報告
- `example/agents/{{PLAYER_ID}}/`（`agent.ts`、`prompt.md`、必要なら補助ファイル）＋ `test/{{PLAYER_ID}}.test.ts`。
- 最終報告（簡潔に）: 設計の核心（どこで稼ぐか・どのレジームで強い/弱いと予想するか）／守ったガード／実行した検証の実結果／**できなかった点・不確かな点**（実行していないものを「検証済み」と書かない）。
