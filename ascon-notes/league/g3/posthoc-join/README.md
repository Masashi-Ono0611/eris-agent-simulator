# 保存済み4ファイルの部分結合器

**synthetic-only / not G3 evidence**

設計書 `../../G3-B04-CAPTURE-DESIGN-2026-10-10.md` §2・4・5・6 の最初の工程。
Python 3.10以上の標準ライブラリのみ。通信、subprocess、runtime importはない。
G3は内部REQUIRED、B03はUSER-ACCEPTEDの未解決残余リスクのまま。
この実装・合成試験はG3/B04/B07を閉じず、実runの合格も示さない。

## 実行

リポジトリ直下から、合成入力のディレクトリと**存在しない出力先**を明示する。
出力先は入力ディレクトリの外に置く。以下の出力ファイルは再実行時に再利用できない。

```sh
python3 -B ascon-notes/league/g3/posthoc-join/join.py \
  ascon-notes/league/g3/posthoc-join/fixtures/standard \
  --output ascon-notes/league/g3/posthoc-join/synthetic-report.json
```

読むのは `summary.json`、`events.jsonl`、`agents/cand.jsonl`、`blocks.csv` のみ。
symlink・非通常ファイルを拒否し、原本は読取専用、出力はexclusive create。
取得時刻・絶対パスを結果に混ぜず、同じ入力・引数から同じJSONを作る。
`--expect-sha256 RELATIVE_PATH=HEX` を4回渡すと独立した期待digestを照合できる。
未指定・不完全・不一致はJ01 BLOCKED。結果から計算したdigestだけでは完全性を証明しない。

出力には必ず上記注意書きが入り、`evidenceClass=SYNTHETIC` 固定。
全体判定の許容値は `CONSISTENT_ON_SYNTHETIC / FAIL / BLOCKED` だけ。
**現在の4入力では必須情報が足りず、実際に返すのはFAILかBLOCKEDのみ**。
終了値はそれぞれ1/2（将来の合成限定CONSISTENTは0）。部分チェックのPASSをゲート判定に使わない。

## 確立すること

- J01: 原本不在・構文不正・JSON重複キー・末尾改行・容量上限/切詰め・終了印・segment印・digestを検査。
- J02/J03: worldと所有者の矛盾、CSV hash/包含位置の重複を検出。外部結合では別worldや不明worldを混ぜない。
  重複検査は外部結合と独立し、`(source file, normalized hash)`で全CSV行を検査する。
  world不明でも`CSV_HASH_DUPLICATE`はBLOCKED、内容矛盾は`DUPLICATE_CONTENT_CONFLICT`でFAIL。
  J02の`WORLD_UNKNOWN` BLOCKEDも残す。包含位置は既知world単位、不明時はCSVファイル単位で検査する。
- J06/J07/J08: hash外部結合、申告のみ/CSVのみ、receipt全文不足、原statusの制約、包含列の欠測を報告。
  J07はreceipt不在の候補hashに原本行付き`RECEIPT_UNAVAILABLE` BLOCKEDを必ず追加する。
  CSVが`1/success`でもJ07はPASSにしない。status矛盾があればFAILを優先し、BLOCKED findingも保持する。
- J14: approve候補・gas refill・derived senderを含む候補を保持し、frame帰属の不足を報告。

同一hashの複数申告を配列で保持し、同nonceの別hashも潰さない。hashなしの失敗・任意log・summary/eventsは
`unboundEvidence` に残す。手書きの期待集合は `fixtures/expected.json` にあり、joiner自身は読まない。
同一ファイル・正規化hashの複数submitted行は`SUBMIT_HASH_DUPLICATE` BLOCKED、
同一ファイル・world（不明を含む）・nonceに複数hashがあれば
`SUBMIT_NONCE_REPEATED_ACROSS_HASHES` BLOCKEDを原本行付きで報告する。
これは観測の曖昧さであり、送信元/attempt未確定のため不正送信やnonce衝突とは断定しない。
既知の別worldのnonceは比較しない。申告の時刻・fee差だけで内容矛盾FAILにはしない。
全行を`sourceRows`へ保持し、`observedRows = joinedSourceRows + unboundSourceRows`を試験する。
CSV破損で論理行を確定できない残りは、物理行ごとの不透明な原本参照として保持する。
CSVの`line/endLine`と破損後の行数はCR・LF・CRLF（CRLFは1行）で数える。
Unicode行区切り・VT・FFはCSVの改行に数えない。混在改行の正対照を追加済み。

findingには対象keyと原本行の表示、`relativePath / line / fileSha256`を付ける。
秘密非出力を優先し、自由文・URL・未知項目・opaque IDを伏せ、`redactedFields`で明示する。
これは**原本の完全コピーではなく、伏字付き表示**。原本は変更しない。
worldIdは原runIdのSHA-256ラベル。既知statusの原値と数値表現は保持し、未知statusの伏字は
`statusRaw=null / statusRawAvailability=redacted`にする。検査は伏字前の値で行う。

ファイル行順と包含block/indexを別々に残す。`blockSeen`を送信blockとせず、包含順・全体nonce順で
申告を並べ替えない。J09の因果順序・時計・版検証は未実装。

## 確立しないこと

標準producerは `core/src/logger.ts`（依頼の`core/src/realtime/logger.ts`は存在しない）、
`example/agents/runtime/send.ts`、`g3/chain/revision_audit.py`と関連箇所を参照した。
CSVはreceipt由来の**投影**で、receipt全文ではない。4入力にreceipt全文のproducerがないため、
J07/J08のreceipt原status・hash・block/index/gasUsed比較はメモリ内の合成契約テストでのみ検証する。
任意strategy logをreceiptへ昇格しない。署名tx対返却hash、receiptだけの外部入力、
frame/attempt重複、probe対応、segment全体結合は未接続で、欠測またはnot_evaluatedを残す。

J04/J05/J09〜J13はnot_evaluated。chain実体、独立した全件数、全frame/試行、action→Sender→queue→tx、
残高・allowance・予約・ガス予備、採取由来、実挙動の同等性は確立しない。
未知の安全件数・経済値はnull。`mined`はFAILかつ結果未取得で、実revert件数へ加算しない。
架空frame・`g3-audit.json`・合格用入力は生成しない。

## 検証と変異リスト

```sh
# リポジトリ直下
python3 -B -m unittest discover -s ascon-notes/league/g3/posthoc-join/tests
python3 -B ascon-notes/league/g3/posthoc-join/mutation-check.py
git diff --check
# posthoc-join ディレクトリ内
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest
```

変異スクリプトはASTのメモリ内コピーで7個のcheckメソッドと4個の個別guardを1個ずつ変異させる。
同じ全suiteを実行し、対応する正対照の**assertion failure**を必須とする（例外では代用しない）。
元ソースを書き換えず、最後に原本一致と正常suiteの再通過を確認する。

| 変異 | 壊れた実装が誤って通す入力 |
|---|---|
| J01除去 | 不在・壊れた行・改行欠落・cap・終了印重複・segment・digest改変 |
| J02除去 | 別world・別owner・agentId不一致 |
| J03除去 | 同一CSV重複・同hashのstatus矛盾・同block/indexの別hash |
| J06除去 | 片側hash・不正hash・receipt全文不在 |
| J07除去 | reverted/mined/未知status/0x1の誤成功化・原status比較の消失 |
| J08除去 | block/index/gasUsed/hash矛盾・必要原本なし |
| J14除去 | 補助送信の孤立・分類/現frame対応不明 |
| world依存のhash重複bucketへ戻す | runIdのないsummaryと、同じ正規化hashで内容の異なるCSV行 |
| RECEIPT_UNAVAILABLE block除去 | CSVは`1/success`だがreceiptなし。原本行付きBLOCKEDが必要 |
| SUBMIT_HASH_DUPLICATE block除去 | 同一hashのsubmitted行が複数存在 |
| SUBMIT_NONCE_REPEATED_ACROSS_HASHES block除去 | 同nonceに複数hashが存在 |

追加の故障対照はinner join脱落、先勝ち/後勝ち、gasUsed→gasLimit、未知→0、
全体nonceソート、架空frame、秘密出力、上書き、原本改変を検出する。
実行したコマンドと結果は `VALIDATION.md` に記録する。
