# ascon-zeta-r2 release 事前確認の記録（C0 / ci-local / selftest）

作成: 2026-10-06（JST）。対象 commit は main `91c9896`（候補 hash `153becef74bebb21acf8674191407ee941b2844a4cb4fa25716b111390eade59`）。
結果は **この 1 回の実行の記録**であり、提出準備の完了ではない。P60・G3・G4 は未実施。

## 確認できたこと（実行で確認）
| 項目 | 結果 | 根拠 |
|---|---|---|
| 候補 hash | 期待値と一致 | Astra の実行記録（私は再計算していない） |
| `npm run check:strategy` | PASS（静的検査の対象 98 ファイル。下の ZIP 96 ファイルとは別の数） | 私が実行。出力の抜粋は `selftest-r2-evidence-excerpts.txt` |
| typecheck、`test/ascon-zeta-r2.test.ts` | PASS（6/6） | Astra の実行記録 |
| `ci-local.sh --ref 91c9896 --full` | PASS（2340 件中 pass 2331、skip 9、fail 0） | 私が実行（`/tmp/cilocal-full.log`） |
| ZIP の中身 | 候補コードに環境変数の読み取りなし、秘密パターン 0 件 | 実行者（私）の申告。展開して grep（`process.env` は上流 runtime のみ）。出力ファイルは未添付 |
| selftest（`agent:selftest -- ascon-zeta-r2`） | PASS（11 件包含、revert 0、2 CPU/4GB） | 同梱 `selftest-r2-log.txt` |

## 証跡の所在
- 同梱: `selftest-r2-log.txt`（selftest 全文）、`selftest-r2-evidence-excerpts.txt`（check:strategy・ZIP 比較・ZIP の SHA-256 照合・ci-local の抜粋）。
- 候補 hash の一致、typecheck と対象テストは Astra の実行記録で、私は再実行していない。ZIP の秘密 grep と worktree の分離は私の申告で、出力は未添付。

## selftest の手順と射程
- 別 worktree（release 用とは分離）で、専用 anvil（port 18545）に 7 会場を deploy → `gen:local-constants` → image build → selftest。release 用 worktree は tracked clean のまま、release ZIP の SHA-256 は実行前後で一致。
- release の ZIP と selftest 用 worktree で作った ZIP は、ファイル名・権限・内容 hash が一致（96 ファイル。mtime は比較から除外）。ZIP は byte 再現しない（mtime が入る）ので、提出に使う ZIP を 1 つに固定して hash を記録すること。
- 検証したのは「ローカル住所表版」の 1 回の実行。ピークメモリや全シナリオの検証ではない。隔離設定（`ERIS_AGENT_ISOLATE` 等）なし・bridge ネットワークでの実行。

## 踏んだ問題
- Colima は `/tmp`（`/private/tmp`）をコンテナにマウントできない。worktree はホーム配下に置く（初回はコンテナ起動が exit 125 で失敗）。
- Docker 内の `npm ci` が ECONNRESET で 1 回失敗（再試行で通過。原因は未特定）。
- bundle は forge artifact（AgentERC20）が無いと警告を出す。`npm run build:contracts` の後に作り直すと同梱される。

## 未実施・未検証
P60（公式 CLI、10/20 以降）、G3、G4、F_mix 用 `fixed-bid-5gwei` の実体、Ollama の最終確認（10/28）、提出用 ZIP の確定。
