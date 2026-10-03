# 練習 devnet 接続

1. `npx tsx ascon-notes/practice/wallet-new.ts <agent-id>` で新規ウォレットを作成します。秘密鍵は `.env.wallet.local` に保存されます。
2. 表示された `id` と `address` の2行を Discord `#faucet` に投稿します。
3. `ascon-notes/practice.env.template` を `.env.practice` にコピーし、運営メールの接続値と `.env.wallet.local` の鍵を記入します。
4. 練習期間の `manifest.json` をリポジトリ直下に置き、`npx tsx ascon-notes/practice/check-practice.ts` を実行します。
5. `npx tsx ascon-notes/practice/run-agent.ts <agent-dir名> [--id masa-ascon] [--dry-run] [--force]` で起動します。

RPC は `transport.ts` の許可リストを通す。読み取り系と `eth_sendRawTransaction` のみを許可し、
未知メソッド、anvil/evm/debug、eth_sendTransaction、txpool、eth_subscribe は送信前に例外となる。
混在 batch も全体を送信前に拒否する。check-practice / wait-funds / run-agent の残高照会と
raw RPC は共通 transport を使用し、子 runtime は `rpc-guard.ts` を preload して SDK の fetch にも適用する。
これはこの起動経路のガードであり、任意の Node http ソケットを隔離するサンドボックスではない。

オフライン検査: `node --import tsx --test test/ascon-practice-transport.test.ts`。
禁止メソッドを devnet へ実送信して 403 を確認することはしない。

秘密鍵・ヘッダ値は共有・出力しないでください。ウォレット生成時に既存の `.env.wallet.local` は上書きされません。
