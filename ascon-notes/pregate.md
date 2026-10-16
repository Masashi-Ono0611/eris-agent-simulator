# Pregate の既存テスト実行

`.gstack/pregate.json` は、選択された TypeScript と Python のテストを `scripts/pregate-runner.py` に渡す。TypeScript は既存の `node --import tsx --test`、Python は各ファイルの `unittest.main()` で実行する。未対応・存在しない・リポジトリ外のパス、空の選択、実行件数0、全件skip、子プロセスの不合格・実行不能・時間超過は成功扱いにしない。各プロセスの既定上限は300秒で、`PREGATE_TEST_TIMEOUT_SECONDS` に1〜1800秒の正の整数を指定できる。無効値はテストを開始する前に拒否する。両実行系の件数を集計し、各コマンドの元の出力も残す。

長時間のローカル監査ではテストプロセスの上限を有限の1800秒にし、`gstack-pregate --timeout 3600` は各checkの上限として指定する。

G3 の `test_chain.py` と `test_revision_audit.py` は、テスト自身が `G3_CHAIN_BASE` 直下の生成物を使うため、専用ディスパッチャーが候補 commit の `git archive` を外部 scratch に展開し、そのコピー内で `make-view.py` と選択されたテストを実行する。source と Pregate runner の両方が同じ明示 commit の HEAD であり、両worktreeに tracked drift や ignored でない untracked file がないことを確認する。依存を入れ直さず、明示された source の `node_modules` だけを一時コピーへリンクする。Git の `safe.directory` は子プロセスの環境だけに設定する。生成 manifest/source-view は scratch 内にだけ作り、Pregate runner は自分で作成した一時ディレクトリだけを通常終了・失敗・時間超過時に回収する。外側から SIGKILL された場合の後片付けは保証しない。

この選択テストを実行するには、候補の40桁 commit と、`/tmp`・`/var/tmp` 系および product worktree の外にある既存 scratch directory を明示する。例の commit 値は、実行対象の候補で確認した値に置き換える。

```sh
mkdir -p "$HOME/.cache/ascon-pregate"
G3_CHAIN_SOURCE="$PWD" \
G3_CHAIN_SOURCE_COMMIT="<exact-40-character-candidate-commit>" \
ASCON_PREGATE_NODE_MODULES="$PWD/node_modules" \
ASCON_PREGATE_SCRATCH_ROOT="$HOME/.cache/ascon-pregate" \
PREGATE_TEST_TIMEOUT_SECONDS=1800 \
gstack-pregate --timeout 3600 --allow-repo-commands --policy-from head --explain
```

入力が不足・不一致・一時領域内の場合は G3 の選択 lane を失敗にする。別の通常テストはそのまま実行する。scratch は証跡や作業物を置く場所に使わない。

`AGENTS.md` は既存の `test/ascon-league.test.ts` に対応付ける。実行器自体は `test/pregate_runner_test.py` と `test/pregate_chain_test.py` で、混在選択・パス拒否・zero-run拒否・実際のNode/Python実行・両言語の失敗伝播・source-bound G3 scratch dispatch の fail-closed 条件を検証する。既存のテスト選択を削らず、`warn` や Linux obligation の免除は設定しない。

各実行コマンドは専用のプロセスセッションで起動し、正常終了・時間超過・SIGTERM・例外のいずれでも、そのセッションの子プロセスを終了して回収する。セッション外へ離脱した子の回収までは保証しない。時間超過後に出力パイプが残る場合も成功扱いにしない。

```sh
gstack-pregate validate
PREGATE_TEST_TIMEOUT_SECONDS=1800 gstack-pregate --timeout 3600 --allow-repo-commands --policy-from head --explain
```

導入PRでは、`--policy-from head` が未レビューの候補設定を使ったことを明示する。通常は base にマージ済みの設定を使う。Linux の `ci.yml/check` が `requires-remote` に残った場合、Mac の成功だけで消さない。対象の同じ候補を Linux で実行した成功記録を保存してから、実在する run URL または `--bundle-lane` の証拠ラベルを `gstack-pregate clear` に渡す。ラベルだけを作って未実行のチェックを通したことにはしない。
