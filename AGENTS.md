# ASCON agent — 作業ルール（Codex / Claude 共通）

目的: ASCON（Nyx Foundation 主催の DeFi エージェント競技）で優勝するエージェントを作る。
競技情報は `docs/competition-notes.md` を正とする。

## 絶対ルール
- 秘密鍵・RPC ヘッダ値・`.env` を commit/出力しない。ログにも出さない。`.env.example` のみ追跡。
- devnet 専用の新規ウォレットのみ使用。Anvil 既定鍵・普段使いウォレットは禁止。
- 使えない RPC: anvil_* / evm_* / eth_sendTransaction / txpool_* / eth_subscribe。署名はローカル、送信は eth_sendRawTransaction。
- レート 100 req/秒（eth_call/estimateGas/getLogs は5回分）。必ずスロットル＋429 バックオフ。
- main へ直 push しない。branch → PR。

## 技術スタック
TypeScript + viem + bun。`src/` に実装、`scripts/` に運用スクリプト、`test/` にテスト。

## 完了条件
変更は `bun run typecheck` と `bun test` が通ってから報告する。外部ネットワークが要る検証は未実施と明記する。
