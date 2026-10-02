# 練習 devnet 接続

1. `npx tsx ascon-notes/practice/wallet-new.ts <agent-id>` で新規ウォレットを作成します。秘密鍵は `.env.wallet.local` に保存されます。
2. 表示された `id` と `address` の2行を Discord `#faucet` に投稿します。
3. `ascon-notes/practice.env.template` を `.env.practice` にコピーし、運営メールの接続値と `.env.wallet.local` の鍵を記入します。
4. 練習期間の `manifest.json` をリポジトリ直下に置き、`npx tsx ascon-notes/practice/check-practice.ts` を実行します。
5. `npx tsx ascon-notes/practice/run-agent.ts <agent-dir名> [--id masa-ascon] [--dry-run] [--force]` で起動します。

秘密鍵・ヘッダ値は共有・出力しないでください。ウォレット生成時に既存の `.env.wallet.local` は上書きされません。
