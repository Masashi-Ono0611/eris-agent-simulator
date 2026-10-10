# 検証記録 2026-10-10 — independent review修正

**synthetic-only / not G3 evidence**

この記録は今回実行した結果。前passの46 tests・7 mutantsの記録を更新した。
branchは`feat/g3-joiner-1010`。開始時と確認時の`git status --short`は
`?? ascon-notes/league/g3/posthoc-join/`のみ。
編集は同ディレクトリ内のjoin.py、tests/test_join.py、mutation-check.py、README.md、本記録のみ。
合成fixture・Python標準ライブラリのみ。コード/テストからのsubprocess起動なし。
commit/push、外部通信、Docker、Anvil、モデル呼出、依存追加なし。

## Red: join.pyを変更する前

cwd: `ascon-notes/league/g3/posthoc-join/`。
最初に2つの再現テストだけを追加し、未修正のjoin.pyに対して実行した。

```sh
python3 -B -m unittest tests.test_join.JoinTests.test_j03_world_unknown_conflicting_csv_duplicate tests.test_join.JoinTests.test_j07_successful_csv_without_receipt_is_blocked
```

終了1、`Ran 2 tests`、`FAILED (failures=3)`、errors=0。

- `('J03', 'DUPLICATE_CONTENT_CONFLICT', 'FAIL')`: findingなし。
  summaryは`{}`、CSVは同じ正規化hashでgasUsedが異なる2行。
  先行する`WORLD_UNKNOWN` BLOCKED assertionは通過した。
- `('J07', 'RECEIPT_UNAVAILABLE', 'BLOCKED')`: findingなし。
  receiptのないCSVについてstatus=`1`と`success`の両subTestが失敗した。

同じ未修正コードに追加の正対照/負対照を実行した。

```sh
python3 -B -m unittest tests.test_join.JoinTests.test_j03_world_unknown_position_collision tests.test_join.JoinTests.test_j03_submit_duplicates_and_repeated_nonce_are_reported tests.test_join.JoinTests.test_j03_unique_submits_and_nonces_have_no_duplicate_findings tests.test_join.JoinTests.test_j01_csv_error_line_count_matches_csv_newlines
```

終了1、4 tests、3 assertion failures、errors=0。
不明worldの`CSV_POSITION_DUPLICATE`が欠落（1件）、`SUBMIT_HASH_DUPLICATE`が欠落
（既知/不明worldの2 subTests）。nonce assertionはこのredでは先行assertion失敗のため未到達。
nonce検出は後述の専用mutantで独立に検証した。
一意なhash/nonceの負対照と、CSV混在改行の正対照は通過した。
行数処理は既存のbytes.splitlinesがcsv.line_numと整合しており、ロジック変更せずコメントと回帰テストを追加した。

## Green: 修正後

CSV重複検査をworld外部結合から独立させ、source file/正規化hashで検査する。
不明worldの包含位置もファイル内で検査する。外部結合のworld分離は保持。
J07のreceipt不在を原本行付きBLOCKEDにする。receipt/CSVの原status比較は変更していない。
submitted重複・nonce反復は曖昧さを示すBLOCKEDとして追加し、行を削除・並替えない。

修正後最初の全suiteは53 tests中1 failure（順序保存テストの古いJ03 PASS期待）、errors=0。
新しいsubmitted重複の意味に合わせてBLOCKED期待へ更新し、FAILがないことも検査した。

リポジトリ直下で実行:

| 正確なコマンド | 結果 |
|---|---|
| `python3 -B -m unittest discover -s ascon-notes/league/g3/posthoc-join/tests` | 終了0、53 tests、失敗0、エラー0 |
| `python3 -B ascon-notes/league/g3/posthoc-join/mutation-check.py` | 終了0、11/11 mutants killed、source_unchanged=True、survived=[] |
| `git diff --check` | 終了0、出力なし。未追跡本文はこのコマンドだけでは検査されない |

未追跡のため、今回編集した5ファイルの本文も個別に検査した。
以下は各終了1（新規差分あり）、全て出力なし・空白エラーなし。

```sh
git diff --no-index --check /dev/null ascon-notes/league/g3/posthoc-join/join.py
git diff --no-index --check /dev/null ascon-notes/league/g3/posthoc-join/tests/test_join.py
git diff --no-index --check /dev/null ascon-notes/league/g3/posthoc-join/mutation-check.py
git diff --no-index --check /dev/null ascon-notes/league/g3/posthoc-join/README.md
git diff --no-index --check /dev/null ascon-notes/league/g3/posthoc-join/VALIDATION.md
```

cwd: `ascon-notes/league/g3/posthoc-join/`。

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest
```

終了0、53 tests、失敗0、エラー0。rootからの0件discoveryを合格としていない。
receiptが実際にある合成契約テストでは、CSVと同じ原statusの`1/success`でJ07 PASS、
異なる原statusでFAILになることを検証した。これは実receiptの読み込み検証ではない。

## Mutation

全mutantとbaselineは同じ53 testsを使用。下表はassertion failure数（subTestを含む）。
全実行でerrors=0。各mutantは対象正対照のassertion failureを必須とし、例外をkill扱いしない。
最初と最後の無変更baselineはそれぞれ53 tests通過。ソースファイルを書き換えず、同一bytesも確認。

| 変異 | assertion failures |
|---|---:|
| J01除去 | 20 |
| J02除去 | 7 |
| J03除去 | 10 |
| J06除去 | 5 |
| J07除去 | 16 |
| J08除去 | 10 |
| J14除去 | 3 |
| world依存の重複bucket（不明worldを行ごとに分離）へ戻す | 2 |
| RECEIPT_UNAVAILABLE block除去 | 5 |
| SUBMIT_HASH_DUPLICATE block除去 | 2 |
| SUBMIT_NONCE_REPEATED_ACROSS_HASHES block除去 | 2 |

必須2 mutantsはそれぞれ`test_j03_world_unknown_conflicting_csv_duplicate`、
`test_j07_successful_csv_without_receipt_is_blocked`でkillした。
submitted/nonceの2 mutantsもそれぞれ`test_j03_submit_duplicates_and_repeated_nonce_are_reported`でkillした。

## 未検証・制約

`npm run typecheck`は今回未実行（stdlib-only/no-subprocess指定の範囲外）。
前passの記録には`tsc: command not found`とあるが、今回再検証していない。
実run、実receipt/署名tx/chain実体、frame/queue/版/因果順、全試行・全経済値・全segment、
独立完全性、実挙動の同等性、Docker/外部ネットワークが必要な検証は未検証。
4ファイルにreceipt全文の読込経路はない。nonce反復は送信元未確定のため実nonce衝突の証明ではない。
G3はREQUIREDのまま、B03は本人受容済み未解決残余リスク。G3/B04/B07の完了根拠ではない。
