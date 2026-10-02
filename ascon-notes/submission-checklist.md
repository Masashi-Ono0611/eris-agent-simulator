# 提出前チェックリスト（最終評価は「提出期間の終了時に最後に受理された1件」・提出は 10/31 JST まで 1 日 5 回）

提出するのは 1 件。**フォームの送信はチーム代表の Google アカウントで本人が行う**（ここは自動化しない）。以下は、これまでの実測で踏んだ罠をゲートにしたもの。全項目を満たすまで送らない。

## A. 候補の選定（backtest 由来の根拠）
- [ ] 候補を **単独 + 参照（noop / multi-arb / clean-arb）だけ**の世界で、12 レジーム × **5 seed 以上**回した（`ascon-notes/eval/run-matrix.sh`）。バリアントを同じ世界に混ぜた sweep は方向を見るためのもので、最終判断に使わない（同一コードの先着・後着で P が約 1,560 USDC 動くため）。
- [ ] 採用基準: 12 レジームの平均 T が multi-arb 以上、最悪レジーム T が noop 以上、noop を下回るレジーム数 0。満たさないなら提出しない。
- [ ] 単一レジームの勝ちに依存していない（レジーム別の alpha を確認。launch・cdp・lending の専門戦略は他レジームを壊していないこと）。

## B. 環境変数に依存しない（本番では `ASCON_*_PARAMS` が設定されない）
- [ ] 採用する設定を**コードの既定値として焼き込んだ**（`DEFAULT_PARAMS` を書き換える。`ASCON_*_PARAMS` を roster の env で渡して得た成績は、本番では再現されない）。
- [ ] 環境変数が**未設定**でテストが通る（既定値＝採用設定であることを単体テストで固定）。`ERIS_AGENT_FROZEN` や `ERIS_LAUNCH_*` に依存していないこと。
- [ ] 運営スキャンの WARN（`reads process env`）は許容だが、可能なら環境変数の読み取り自体を削る。

## C. 自己完結と提出形式
- [ ] 提出ディレクトリが他のエージェントディレクトリへ相対 import していない（提出 ZIP には自分のディレクトリ + runtime + lib + sdk しか入らない）。`rg 'from "\.\./' <dir> | rg -v '\.\./(lib|runtime)/'` が 0 件。
- [ ] `agent.ts` は `decide()` 形式（`run(ctx)` 形式は prompt.md と共存できず提出不可）。`prompt.md` の frontmatter に `kind: improve` / `name` / `description`。
- [ ] `npm run typecheck` / `check:strategy` / 全単体テストが pass。差分ファジング（multi-arb との同一性）が、改変した範囲に応じて意図どおりの結果。
- [ ] `node --import tsx scripts/bundleAgent.ts <dir>` → `python3 infra/submission/scan-submission.py bundle-<dir>.zip` が **0 BLOCK**。ZIP の中身を `unzip -l` で確認。
- [ ] `npm run agent:build -- team <dir>` と `npm run agent:selftest -- <dir>` が PASS（2 vCPU・4GB の上限下。OOM-kill は「取引しない」と区別できないので必ず確認）。Docker が必要（Colima 起動・ディスク空きに注意）。

## D. 運用・安全
- [ ] 5 秒の応答制限内（launch の RPC は個別タイムアウト付き）。例外で `decide` 全体が落ちない。
- [ ] 規約 §8: 評価価格を歪める取引・自己取引・他者の環境への干渉が無い。
- [ ] 秘密（鍵・ヘッダ値）が ZIP・コード・ログに含まれていない（`gitleaks`、ZIP を展開して grep）。
- [ ] 推論 API キーの登録フォーム（別フォーム・1 回だけ）。LLM 改訂（`reviseEveryBlocks`）を使うか決める。使わない場合も prompt.md は必須。LLM 改訂が戦略を壊さない方針（パラメータとガードの調整に限る）になっている。

## E. 練習 devnet での疎通（スコア対象外・任意だが推奨）
- [ ] faucet 着金（`ascon-notes/practice/wait-funds.ts` が自動検知）→ `npx tsx ascon-notes/practice/check-practice.ts` で全項目 PASS。
- [ ] `npx tsx ascon-notes/practice/run-agent.ts <dir>` で数十ブロック走らせ、約定がチェーンに着地している（`includedTxCount > 0`、`submit_failed` が多発していない）。

## F. 送信
- [ ] 提出フォームに ZIP をアップロード（本人）。数秒後に受理/不受理のメールが届く。**不受理は回数に数えない**。
- [ ] 受理メールを確認。最終評価の対象は「最後に受理された1件」なので、**差し替え後の最後の提出が本当に意図した版か**を、ZIP の SHA-256 と commit ハッシュで記録しておく。
- [ ] 10/31 JST 締切の前に、余裕をもって（前日までに）最終版を受理させる。

## 記録（提出のたびに追記）
| 日時 (JST) | 候補 | commit | ZIP SHA-256 | 受理 | 備考 |
|---|---|---|---|---|---|
