# 変異対照

**synthetic-only / not G3 evidence**

各行はsuiteがcheck名・item・FAIL/BLOCKEDを直接assertする陽性対照。
通常入力と、callerが別eval依存を明示した整合入力も通す。
削除変異では該当関数を空リスト返却に置換し、解析/入口の4変異では拒否条件を無効化する。

| 削除・無効化するcheck | 壊れた実装が見逃す入力 |
|---|---|
| documents | 空manifest/期待値、null、配列、数値、boolean |
| required_keys | 各必須キーの欠落/null（両側を独立に確認） |
| extra_keys | 未登録のトップレベルキー |
| synthetic_contract | 人工表示欠落/別schema/別release、実入力扱いの要求 |
| commit_format | 7桁/39桁/41桁/非hex/空/booleanのcommit |
| identifier_format | 空Git参照、相対GitDir、曖昧なpath、不正候補hash |
| legacy_references | r2、release-r2、ec80bb8、nested file key、除外path、旧形式manifest |
| file_maps | 空files、配列形式、非hash、path traversal、重複skippedPaths |
| identities | 各ID/path/hash/commitの差、evalだけの変更、Git参照差 |
| file_sets | 各領域の不足/余剰、除外集合差、選択と除外の重複 |
| file_hashes | source/view/eval/tool各hash差、sourceをevalに代入 |
| candidate_tree | 候補prompt hashだけ変更、候補不在、集約hash不一致 |
| distinct_roots | sourceとevalの同一/親子path（期待値も同じ不正値） |
| json_duplicates | 同値の重複JSONキー、files内重複、期待値側重複 |
| json_constants | NaN/Infinity/-Infinityをnullとして受理 |
| input_json | 読取不能、空テキスト、壊れたJSON/UTF-8を成功扱い |
| arguments | 明示期待値なし・余剰引数・オプションを成功扱い |

すべて人工契約の検査感度であり、G3/B04/B07の証拠ではない。

## 実行記録（2026-10-10）

synthetic-only / not G3 evidence。branch `feat/g3-mancheck-1010`。
repo cwdは `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/c-mancheck`。
以下は最終コードで実際に実行したコマンドと結果（未実行の推定結果は含まない）。

repo cwd:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ascon-notes/league/g3/manifest-contract/tests -v
```

終了0、33 tests、失敗0・error 0。各subTestは33件と別に水増し集計していない。

cwd `ascon-notes/league/g3/manifest-contract/`:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest
python3 -B mutation-check.py
python3 -B check.py fixtures/manifest.json fixtures/expected-identifiers.json
python3 -B check.py fixtures/r2-era.json fixtures/expected-identifiers.json
python3 -B check.py
```

上から順に：

- 終了0、33 tests、失敗0・error 0。repo全体のsuiteという意味ではない。
- 終了0、baseline/final baseline各33 tests成功、17/17変異をassertion失敗で検出。
  全変異のerrorは0。check.pyのbyte不変も確認。
- 終了0、`CONTRACT_OK_ON_SYNTHETIC`、118項目PASS（人工宣言のみ）。
- 終了1、`FAIL`、68項目PASS / 42 BLOCKED / 6 FAIL（人工r2拒否）。
- 終了2、`BLOCKED`、明示引数不足1件。

repo cwd:

```sh
git diff --check
for file in ascon-notes/league/g3/manifest-contract/**/*(.); do
  git diff --no-index --check /dev/null "$file"
  code=$?
  printf '%s exit=%s\n' "$file" "$code"
  if (( code > 1 )); then exit "$code"; fi
done
git status --short --untracked-files=all
NPM_CONFIG_OFFLINE=true NPM_CONFIG_IGNORE_SCRIPTS=true NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_LOGS_MAX=0 npm run typecheck
```

- `git diff --check`: 終了0、出力なし。未追跡本文は対象外なので次の検査を併用。
- zsh loop: 終了0。新規9ファイルそれぞれ終了1（新規差分あり）、空白エラー出力なし。
- status: 終了0。新規ディレクトリ内9件の `??` だけ。既存追跡ファイルの差分なし。
- typecheck: 終了127、`sh: tsc: command not found`。**型検査未検証**。
  依存インストールやネットワークで補っていない。

検証中に深いJSONのテストが、実行環境の再帰上限を固定と仮定して1件失敗した。
その仮定を除き、深い値の走査とRecursionErrorの取扱いを別々にテストしてから、
上記33件・17変異を再実行した。

未実行・未検証：実manifest/lock/tool照合、登録、既存chain/prestart/loaderの実行、
G3/B04/B07受入れ、実ホスト/依存/実ファイル/解決先/symlink/state/model/ZIP。
commit/push、ネットワーク、Docker、Anvil、モデル呼出なし。既存ツール変更なし。
