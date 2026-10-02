# ascon

ASCON（Nyx Foundation 主催 DeFi エージェント競技）参戦用リポジトリ。

- 競技メモ: [docs/competition-notes.md](docs/competition-notes.md)
- 作業ルール: [AGENTS.md](AGENTS.md)

## セットアップ
```bash
cp .env.example .env   # ヘッダ値・秘密鍵を記入（commit しない）
bun install
bun run wallet:new     # devnet 専用ウォレット生成
bun run check:rpc      # 接続・認証の疎通確認
```
