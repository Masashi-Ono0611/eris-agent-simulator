# source-manifest 契約の最初の部品

**synthetic-only / not G3 evidence**

人工のmanifestと、呼出側が明示した期待値の「宣言の一致」だけを検査する。
manifest登録ではなく、B07解消でもない。実lock/tool manifestを読まず変更しない。
G3は内部の **REQUIRED / BLOCKED** のまま。B03は **USER-ACCEPTEDな未解決の残余リスク**。
B04・B07・実走・実体ファイルの一致・依存解決・symlink隔離・state・モデル・ZIP・
完全収集・観測同等性を証明しない。この作業で閉じる項目はない。

## 使い方

リポジトリルートから（Python 3.9以降、標準ライブラリのみ）：

```sh
python3 -B ascon-notes/league/g3/manifest-contract/check.py \
  ascon-notes/league/g3/manifest-contract/fixtures/manifest.json \
  ascon-notes/league/g3/manifest-contract/fixtures/expected-identifiers.json
```

両JSONは必須。既定path・環境変数・Git・repoから期待値を補完しない。
参照先のファイルは開かず、明示された2文書だけを読み、決定的JSONをstdoutへ出す。
ファイル書込み・子プロセス・ネットワークはない。実入力を認定するモードはない。
`check(manifest, expected)` は副作用のない辞書用関数。重複JSONキーの検査は
辞書化前が必要なので、外部JSONには `check_paths()` / CLIを使う。

最上位verdictは `CONTRACT_OK_ON_SYNTHETIC`（終了0）、`FAIL`（1）、`BLOCKED`（2）のみ。
各項目はcheck名・item・PASS/FAIL/BLOCKED・理由・人工限定表示を持つ。
不一致/不正形式はFAIL、欠落/null/空集合/読取不能はBLOCKED（空skippedPathsは許可）。
FAILとBLOCKEDが共存すればFAILを優先し、各理由を残す。未知値を0/trueで補わない。
PASSは宣言比較の各項目に限定され、実走PASSにはならない。

## 明示する契約（両JSONで同じ必須キー）

| キー | 意味 |
|---|---|
| `scope`, `schema`, `release` | 上記人工表示、`synthetic-source-manifest-contract-v1`、`r3` |
| `candidateId`, `candidateDir`, `candidateSha256` | roster ID、単一ディレクトリ名、候補treeの64-hex hash |
| `head`, `branch`, `mainRef`, `absoluteGitDir` | 完全40-hex source commit、明示Git参照、完全40-hex main参照、絶対Gitディレクトリ |
| `source`, `view`, `eval`, `tool` | 別々の正規化済み絶対POSIXパス（同一/親子配置は拒否） |
| `files`, `viewFiles`, `evalFiles`, `toolFiles` | 各領域の非空「相対path → 64-hex SHA-256」辞書。callerが全期待集合を明示 |
| `skippedPaths` | 除外相対pathの重複なしリスト。選択filesとの重複は拒否 |

source/view/evalの `example/agents/<candidateDir>/` 集合はそれぞれ候補相対pathにし、
キー順・空白なしJSONのSHA-256でcandidateSha256に結ぶ。ファイル本体のhash再計算ではない。
それ以外のファイルは領域ごとの期待値と照合するため、callerが明示するeval固有依存も扱える。
集合の不足/余剰、JSON重複キー（同値でも拒否）、候補hash・commit・Git参照・各領域の差を検出する。
hash/識別子は大文字小文字を含め完全一致。履歴を含む巨大export全体ではなく、
この最小実行契約内の全文字列/keyにあるr2/release-r2/ec80bb8参照を保守的に拒否する。
期待集合自体の完全性・正当性はcaller側の別レビュー事項であり、repoから推定しない。

これは既存producerの置換schemaではない。`make-view.py` の既存キーを踏まえ、
chainが読む `absoluteGitDir` と候補・view/eval/tool束縛を独立部品として追加した試案。
既存生成器は変更せず、その出力をそのまま通さない。fixtureのpath/hash/commitはすべて人工。
`r2-era.json` も旧形式を模した人工対照で、保存された実manifestの複製ではない。

## 検証

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ascon-notes/league/g3/manifest-contract/tests -v
# 以下2行はこのディレクトリをcwdにして実行
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest
python3 -B mutation-check.py
```

mutationスクリプトはASTをメモリ内だけで変え、各チェックを外したsuiteで
assertion失敗が起きることを要求する（例外だけの失敗は不十分）。元ファイルは書き換えない。
陽性対照の対応表は [tests/MUTATIONS.md](tests/MUTATIONS.md)。実測の検証記録は同ファイル末尾。
