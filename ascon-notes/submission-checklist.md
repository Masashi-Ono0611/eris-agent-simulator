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

## C0. 住所表の汚染ゲート（実害由来・致命的）
- バックテスト（`npm run backtest`）は、追跡対象の `sdk/src/constants.local.ts` を**ローカル deployer の住所表に毎回書き換える**（fingerprint 不一致で自動再生成）。upstream が commit している版は**練習 devnet / 運営環境の住所表**で、練習 devnet に繋ぐランナーも、提出 ZIP（sdk を同梱する）も、この版でなければ動かない。2026-10-03 に、書き換わったまま練習 devnet に繋ぎ「18 件すべてコードなし」で起動拒否された。
- **バンドル・練習 devnet 実行・selftest は、バックテストを一切走らせない専用のリリース用 worktree で行う**（`git worktree add` でコミット済みの状態から作る）。リリース用 worktree で `git diff --quiet upstream/main -- sdk/src/constants.local.ts`（または `git status --short sdk/src/constants.local.ts` が空）を確認する。
- [ ] 提出 ZIP の `sdk/src/constants.local.ts` が upstream の commit 版と**バイト一致**（`unzip -p bundle-<dir>.zip sdk/src/constants.local.ts | shasum -a 256` と `git show <upstream commit>:sdk/src/constants.local.ts | shasum -a 256` が一致）。

## C0b. CI の再現（提出する commit に対して必須・2026-10-03 の CI 失敗 4 回の再発防止）
- [ ] **提出する commit を `bash ascon-notes/ci-local.sh --ref <commit> --full` で通す**（commit 済みの内容だけのクリーンな export・`env -i`・空き 13GB の `df` スタブ・他の全体テスト/anvil が居れば BLOCKED）。作業ツリーにだけあるファイル・ホスト環境（空きディスク・絶対パス・HOME・python 版）への依存・関連テストだけでは見えない回帰を、CI と同じ形で出す。push 前は `--quick`（pre-push フックが自動実行。入れ方: `bash ascon-notes/install-prepush.sh`）。
- [ ] `prepare-release.py` の **READY は証跡つき**: `--backtest-evidence <G0 PASS の JSON>` と `--selftest-evidence <selftest の出力>` が ZIP の SHA-256・commit と一致すること。静的検査のみなら READY ではない（exit 3）。

## C. 自己完結と提出形式
- [ ] 提出ディレクトリが他のエージェントディレクトリへ相対 import していない（提出 ZIP には自分のディレクトリ + runtime + lib + sdk しか入らない）。`rg 'from "\.\./' <dir> | rg -v '\.\./(lib|runtime)/'` が 0 件。
- [ ] `agent.ts` は `decide()` 形式（`run(ctx)` 形式は prompt.md と共存できず提出不可）。`prompt.md` の frontmatter に `kind: improve` / `name` / `description`。
- [ ] `npm run typecheck` / `check:strategy` / 全単体テストが pass。差分ファジング（multi-arb との同一性）が、改変した範囲に応じて意図どおりの結果。
- [ ] 提出用 ZIP は **`npm run bundle:agent <id> -- --submission`**（提出フォームの指定）で作る（手で圧縮しない）。**2026-10-03 時点で、この `--submission` フラグは当 repo（取り込み SHA 32e9f40）にも upstream main（cbec5ad）の `scripts/bundleAgent.ts`・`docs/competition-start.md` にも見当たらない**（未知フラグがどう扱われるかは未検証）＝提出前に upstream を fetch して実装の有無を再確認し、無ければ通常の bundle の ZIP を使うか運営に確認する→ `python3 infra/submission/scan-submission.py bundle-<dir>.zip` が **0 BLOCK**。ZIP の中身を `unzip -l` で確認。受理条件（運営の形式検証）: ZIP が展開できる／`agent.ts` と `strategy.py` のどちらか一方だけ／`prompt.md` に `kind: improve`・`name`・`description`／`artifacts.json` で契約を宣言する場合は forge 成果物を同梱。
- [ ] `npm run agent:build -- team <dir>` と `npm run agent:selftest -- <dir>` が PASS（2 vCPU・4GB の上限下。OOM-kill は「取引しない」と区別できないので必ず確認）。Docker が必要（Colima 起動・ディスク空きに注意）。

## D. 運用・安全
- [ ] 5 秒の応答制限内（launch の RPC は個別タイムアウト付き）。例外で `decide` 全体が落ちない。
- [ ] 規約 §8: 評価価格を歪める取引・自己取引・他者の環境への干渉が無い。
- [ ] 秘密（鍵・ヘッダ値）が ZIP・コード・ログに含まれていない（`gitleaks`、ZIP を展開して grep）。
- [ ] **推論 API キーの登録は必須**（規約 §8-1/8-2/8-5。未登録だと除外の恐れ）。キーは **Ollama Cloud のキーのみ**（OpenAI キーは不可）。登録フォーム（https://forms.gle/yYHU9deG4JJ5RnJQ6・参加単位ごとに 1 回）に、提出フォームと**同じ代表者メール**で、**ZIP の最初の提出と同時**に登録する（本人作業。キーはチャット・提出フォーム・ファイルに書かない）。
- [ ] Ollama Cloud アカウントに**利用上限を設定**済み（提出フォームの同意項目・参加規約 第8条の2第5項）。
- [ ] `prompt.md` の `model:` / `reviseEveryBlocks` は ZIP 内の frontmatter から読まれる。モデル一覧は 2026-10-03 時点で未公表（暫定 `gpt-oss:120b`）＝**公表され次第、一覧と照合**して合わせる。提出する全エージェントは戦略改訂を行う構成（競技規約 §2.5）。LLM 改訂が戦略を壊さない方針（パラメータとガードの調整に限る）になっている。

## E. 練習 devnet での疎通（スコア対象外・任意だが推奨）
- [ ] faucet 着金（`ascon-notes/practice/wait-funds.ts` が自動検知）→ `npx tsx ascon-notes/practice/check-practice.ts` で全項目 PASS。
- [ ] `npx tsx ascon-notes/practice/run-agent.ts <dir>` で数十ブロック走らせ、約定がチェーンに着地している（`includedTxCount > 0`、`submit_failed` が多発していない）。

## F0. 最終ゲート — Ollama Cloud の上限・無料枠・鍵登録（**最後にやる。忘れない**）
2026-10-03 にユーザーと「最後に確認する」と決めた項目。セッション開始時の Open Decisions（`attentionctl decision list`・期日 2026-10-28）にも登録済み。**提出（ZIP 送信）の前に、全部済ませる**。
- [ ] **上限の実態を確認**: Ollama Cloud には独立した「上限額」の設定欄が無い（2026-10-03 に Usage / Billing の 2 ページで確認）。上限は「無料枠 + 前払い残高 + 自動チャージ Off」で決まる。**自動チャージが Off、残高が意図した額**であることを Usage ページで再確認する。
- [ ] **無料枠で足りるか**: 無料枠の量は画面に出ていない（2026-10-03 時点で 0% 使用・4 週でリセット）。1 エージェント約 360 回（既定 `reviseEveryBlocks=60`）の改訂が枠に収まるかを、少数回の実呼び出しで「使用 %」の動きを見て見積もる（ローカルの改訂実験）。足りないなら `reviseEveryBlocks` を大きくするか、少額（例 $5〜10）を前払い（**自動チャージは Off のまま**。前払いは本人の操作）。
- [ ] **使うモデルが無料枠の対象か**: 無料枠で使えるクラウドモデルは `gemma4:31b` / `gpt-oss:120b` / `gpt-oss:20b` / `nemotron-3-nano:30b` / `nemotron-3-super` / `nemotron-3-ultra`（2026-10-03）。競技の対応モデル一覧（未公表）が出たら、`prompt.md` の `model:` と照合。
- [ ] **鍵登録フォーム**（https://forms.gle/yYHU9deG4JJ5RnJQ6）: 参加登録・提出フォームと**同じ代表者メール**、キー、「上限設定済み」に同意（実態は上の確認で担保）。**鍵はチャット・ファイル・提出フォームに書かない**。本人が貼る。差し替えは再登録（最後の登録が有効）。
- [ ] 貼り終えたら**クリップボードを別の文字列で上書き**する。鍵を失効させたら再登録。
- [ ] 登録後、受理を確認できる手段があるか（確認メール等）を見て、無ければ運営に問い合わせるか判断（キー未登録での提出受理可否は未確認のまま）。

## F. 送信
- [ ] 提出フォームに ZIP をアップロード（本人）。数秒後に受理/不受理のメールが届く。**不受理は回数に数えない**。
- [ ] 受理メールを確認。最終評価の対象は「最後に受理された1件」なので、**差し替え後の最後の提出が本当に意図した版か**を、ZIP の SHA-256 と commit ハッシュで記録しておく。
- [ ] 10/31 JST 締切の前に、余裕をもって（前日までに）最終版を受理させる。

## 記録（提出のたびに追記）
| 日時 (JST) | 候補 | commit | ZIP SHA-256 | 受理 | 備考 |
|---|---|---|---|---|---|
