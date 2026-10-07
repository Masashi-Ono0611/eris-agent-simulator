# grok-1 の G0 BLOCKED：拒否ログの round 欠落（2026-10-07）

## 結論と調査範囲

G0（評価・選抜前の証跡検査ゲート）が `agent telemetry grok-1` を返す直接原因は、固定対戦相手 grok-1 の **`kind="mempool", event="rejected"` レコードに `action` があり、`round` がないこと**である。E4 crash/67001 では1行、E5 whale/68002 では2行が該当する。いずれも `sizeDeltaUsd` が数値としてゼロの `gmxDecrease` を拒否した記録である。最初の該当行で整数検査が例外になり、当該エージェントの負荷指標を確定できず BLOCKED になる（`ascon-notes/league/degradation-gate.py:124-145`）。

大規模言語モデル（Large Language Model、LLM）の呼出失敗、タイムアウト、利用頻度制限を示す事象ではない。3世界とも開始行の実行モードは `decide` であり、今回の通常戦略実行経路では LLM 改善ループを起動しない（各 `agents/grok-1.jsonl:1`、`example/agents/runtime/botMain.ts:523`、同 `:736`）。ファイル全体の消失や構文破損でもない。対戦相手の特定の行動が、共有ランタイムの拒否ログ形式と G0 の読取契約の不整合を露呈させた。

調査対象コードはブランチ `docs/grok1-telemetry-block`、HEAD およびローカルの `origin/main` がともに `2f09698c6d4269541cdf2277d5f0367b6618dfec` の状態。リモート参照の更新はしていない。ソースと保存済みデータの読取、およびメモリ内での検査のみを実施した。本書以外の変更・修正実装はない。

**BLOCKED は、診断目的で後続実行を許す場合も必ず BLOCKED のまま保存・表示する。PASS への変換は禁止する。**

## 証跡の所在と分かる範囲

以下の略記はリポジトリ相対パスを指す。表と本文の `E4-B/…:行` などは、この表で展開できるファイル・行番号引用である。world（世界）は regime（市場状況）と seed（乱数初期値）の組、chunk（実行区分）は複数世界をまとめた単位とする。

| 略記 | ディレクトリ | 実験上の対応・既報の G0 判定 |
|---|---|---|
| E4-B | `.scratch-logs/runs/2026-10-07T10-47-19-695Z` | E4 crash/67001、BLOCKED |
| E5-B | `.scratch-logs/runs/2026-10-07T13-30-09-332Z` | E5 whale/68002、BLOCKED |
| E4-P | `.scratch-logs/runs/2026-10-07T10-19-29-054Z` | E4 whale/67001、PASS 対照 |

36世界チェーンの第2区分でそれぞれ1世界が BLOCKED になり、9世界の実行自体は失敗0で終わっていた、という実験報告を調査の背景とする。ただし提供されたコピーには各世界の `summary.json` と12人のエージェントログ、E4-B の環境 `manifest.json` しかない。区分の `index.tsv`、チェーンログ、G0 出力、`events.jsonl`、`blocks.csv`、ラウンド開始時の証跡固定 manifest は含まれない。したがって9世界全部の終了コード、区分全体の判定、実際の再起動回数は本調査では再確認していない。表の実験番号・seed 対応と既報の PASS は、G0 全体を再実行して認証したものではない。

3世界それぞれの `summary.json:6-9` には `blocksProcessed=360`、`loopIterations=362` がある。開始・終了ブロックは E4-B が1561・1921、E5-B と E4-P が1583・1943。`failedReads=0` は E4-B `summary.json:71`、E5-B `:81`、E4-P `:57`、`violations=[]` は順に `:995`、`:1005`、`:981`。これらは完走を示す保存値であり、全証跡の完全性を単独で証明しない。

## `agent telemetry <id>` の正確な契約

契約文書は `ascon-notes/league/DEGRADATION-GATE.md:13-21`、同 `:45-55`。G0 は予定世界・全選手・採点値・実行ログ・負荷の積集合を検査する。既知の不一致は FAIL、必要証跡の欠測・不正は BLOCKED、両方ある場合は BLOCKED を優先する。`ascon-notes/league/G0-VERIFICATION.md:20` は末尾改行欠落を BLOCKED にする検証を記録し、同 `:45-47` は構文的に有効な行の任意欠落を完全には検出できない限界を明記している。

`g0_contract.py` 自体が当該メッセージを作るわけではない。閾値（360ブロック、362ループ、2秒間隔など）は `ascon-notes/league/g0_contract.py:5-7`、採点値・読取失敗・違反の検査は同 `:14-34`。メッセージは共有負荷検査から来る。

1. `g0.py:98-104` が `degradation-gate.py` の `extract()` を呼び、その `failed` と `blocked` を取り込む。
2. `degradation-gate.py:124-145` が summary の全 ID に対して下表を検査する。候補・対戦相手・baseline の区別による免除はない。
3. 当該区間の `OSError` または `ValueError` を `:145` で捕捉し、`block('agent telemetry ' + aid)` とする。これは複数原因を同じ文字列にまとめるため、メッセージだけでは原因を分類できない。
4. `g0.py:132-136` が世界別理由を `regime/seed: …` として集約する。`g0.py:27-28` の優先順位は BLOCKED → FAIL → PASS、終了コードは同 `:165` の2 → 1 → 0。

| 必要証跡・条件 | 実装箇所 |
|---|---|
| `agents/<id>.jsonl` が読める。各行が改行で終わり、JSON Lines（1行ごとの JavaScript Object Notation）として辞書に解析できる。空行も解析エラーになる | `ascon-notes/league/league_timing.py:7-14`、`degradation-gate.py:126` |
| 非空で、すべての行の `agentId` が対象 ID と一致 | `degradation-gate.py:127` |
| `log_cap_reached`、`log_line_truncated` がない | `degradation-gate.py:128` |
| `kind=mempool` かつ `event=runtime_start` がちょうど1件 | `degradation-gate.py:129-130` |
| `kind=mempool` かつ `submitted/submit_failed` は `blockSeen` が非負の整数値である | `degradation-gate.py:134-139`、同 `:21-22` |
| 上記以外でも `action` キーがある、または `reason` が `decide error:` / `decide timeout:` で始まる行は `round` が非負の整数値である | `degradation-gate.py:136-139` |
| summary の有効な開始・終了区間に対し、`runStartBlock < ブロック <= finalBlock` の判断記録が少なくとも1ブロックある | `degradation-gate.py:71-74`、同 `:140-144` |

ここでいう整数値には整数相当の数値を含み、文字列・真偽値・非有限値は受け付けない（`degradation-gate.py:21-22`、`ascon-notes/league/league_harness.py:21-22`）。判断回数は重複を除くブロック数で、実際の `decide()` 呼出回数ではない。ブロック番号の妥当性はエポック内外を振り分ける**前**に検査するため、範囲外らしい行でも `round` 欠落を無視しない。

本件の `rejected` は `submitted/submit_failed` に含まれないため、`blockSeen` を使う側には入らない。しかし `action` があるため判断記録に該当し、`round=None` の検査で失敗する。直前行に `round` があっても結合・補完しない。`reason/signals` だけの通常行は判断記録として数えない。

LLM の `.llm.jsonl` やコマンドラインインターフェース（Command-Line Interface、CLI）の `.cli-timing.jsonl` は、この検査の入力ではない。絶対検査のこの部分に「全360ブロックの判断が必須」という条件もない。baseline を渡した場合の被覆低下比較は別の `degradation-gate.py:149-171`、記録された `decide timeout` の絶対 FAIL は `g0.py:103` にある。今回のチェーン呼出は `--baseline` を渡さない（`remote/chain-template.sh:220`）。

## 3ログの比較と直接原因

全行を現行の `league_timing.events()` で読んだ。3ファイルとも末尾改行あり、全行が辞書として解析可能、ID 不一致0、開始イベント1件、容量上限・行切詰めイベント0。下表の集計範囲は E4-B `agents/grok-1.jsonl:1-729`、E5-B `:1-740`、E4-P `:1-738`。

| 項目 | E4-B | E5-B | E4-P |
|---|---:|---:|---:|
| バイト数 / 行数 | 131938 / 729 | 132779 / 740 | 120233 / 738 |
| `submitted` | 202 | 97 | 69 |
| `submit_failed` | 1 | 8 | 0 |
| `rejected` | 1 | 2 | 0 |
| 判断対象なのにブロック番号が不正な行 | 252 | 306、316 | なし |
| 不正行以外から数えたエポック内判断ブロック | 359 | 358 | 360 |
| その集計で欠けるブロック | 1684 | 1730、1735 | なし |

359・358は診断用に不正行を除いて数えた値である。実際の G0 は不正行で打ち切り、そのエージェントの指標を返さない。少数の被覆不足が閾値を超えて BLOCKED になったのではない。`submit_failed` 自体は有効な `blockSeen` を持ち、この形式検査を失敗させない。

### E4-B：252行目

`E4-B/agents/grok-1.jsonl:252` の原文全体：

```json
{"ts":"2026-10-07T10:52:08.489Z","agentId":"grok-1","kind":"mempool","event":"rejected","reason":"sizeDeltaUsd must be positive","action":{"type":"gmxDecrease","isLong":true,"collateral":"USDC","sizeDeltaUsd":"0000000000000000000000000","collateralDeltaAmount":"303344603","maxPriorityFeePerGasWei":"100000000"}}
```

`round` も `blockSeen` もない。直前の251行目は同時刻で `round=1684, reason="hedge WETH gap -904"`、253行目には次の `round=1685` の判断理由がある。251行目には `action` がなく、通常の理由文字列なので G0 の判断集合に入らない。ログは729行目の `submitted, blockSeen=1921` まで続いている。

### E5-B：306行目と316行目

`E5-B/agents/grok-1.jsonl:306` の原文全体：

```json
{"ts":"2026-10-07T13:35:50.888Z","agentId":"grok-1","kind":"mempool","event":"rejected","reason":"sizeDeltaUsd must be positive","action":{"type":"gmxDecrease","isLong":false,"collateral":"USDC","sizeDeltaUsd":"0000000000000000000000000","collateralDeltaAmount":"1311405614","maxPriorityFeePerGasWei":"100000000"}}
```

`E5-B/agents/grok-1.jsonl:316` の原文全体：

```json
{"ts":"2026-10-07T13:36:00.526Z","agentId":"grok-1","kind":"mempool","event":"rejected","reason":"sizeDeltaUsd must be positive","action":{"type":"gmxDecrease","isLong":true,"collateral":"USDC","sizeDeltaUsd":"0000000000000000000000000","collateralDeltaAmount":"534671127","maxPriorityFeePerGasWei":"100000000"}}
```

どちらも `round` と `blockSeen` がない。305行目は同時刻で `round=1730, reason="hedge WETH gap 803"`、315行目は同時刻で `round=1735, reason="hedge WETH gap -1264"`。307・317行目にはそれぞれ次ブロックの判断理由があり、740行目には `round=1943, action={"type":"noop"}` がある。G0 が最初に例外にするのは306行目で、316行目は同じ欠陥の追加例である。

### E4-P：拒否イベントなし

`E4-P/agents/grok-1.jsonl:1-738` には `rejected` がない。通常の不実行判断には `round` と `action` がそろっており、例えば末尾738行目は次の原文である。

```json
{"ts":"2026-10-07T10:32:11.900Z","agentId":"grok-1","round":1943,"action":{"type":"noop"},"reason":"no new risk (cycle idle, 0 blocks left)"}
```

したがって確認できる差は、ファイル全体の欠損や LLM 計時ファイルの有無ではなく、**有効な JSON として保存された特定イベントのブロック番号欠落**である。ただし有効行の任意欠落一般まで否定したわけではない。

### ファイル非変更の局所再現

Python の抽象構文木（Abstract Syntax Tree、AST）で現行 `degradation-gate.py` の `extract()` から `for aid in ids`（124–145行）のコードを取り出し、そのままメモリ上で実行した。summary の全12 ID、区間、実ログ、現行 `integer()` と `events()` を使用した。G0 全体の実行ではなく、エージェント証跡検査の局所再現である。

| メモリ上の入力 | 検査結果 |
|---|---|
| E4-B 原本 | `blocked=['agent telemetry grok-1']`、11人の指標のみ取得 |
| E5-B 原本 | 同上 |
| E4-P 原本 | `blocked=[]`、12人の指標取得。grok-1 は判断360、timeout 0、submit_failed 0 |
| E4-B 252行目に仮の `round=1684` を付与 | この検査の blocked は空。grok-1 は判断360、timeout 0、submit_failed 1 |
| E5-B 306・316行目に仮の `round=1730/1735` を付与 | この検査の blocked は空。grok-1 は判断360、timeout 0、submit_failed 8 |
| 上の仮補完を `round` でなく `blockSeen` にする | 両方とも依然 `agent telemetry grok-1` |
| E4-P の3行目から `round` をメモリ上で除く陽性対照 | `agent telemetry grok-1` を検出 |

仮の番号は直前行から診断目的で与えたもので、過去ログの修復・正式証跡の補完には使っていない。局所検査の成功を、その世界の G0 PASS と呼んではならない。

## 生成側の経路と原因の帰属

grok-1 の `decide()` は `plan()` の結果について `round/reason/signals` を `ctx.log()` に渡し、行動は戻り値にする。独自ログには `action` を入れていない。内部例外時は理由 `decide failed closed` の noop を返す（`example/agents/grok-1/agent.ts:1015-1031`）。ワーカーのログは親の logger に転送される（`example/agents/runtime/strategyRunner.ts:139-147`）。

親ランタイムは返った行動を sender に渡す。noop の場合は `round/action/reason` を別途記録し、`decide()` 自体の例外・時間超過なら `round/reason` を記録する（`example/agents/runtime/botMain.ts:631-662`）。`rememberDecision()` はメモリ上のリングへの追加であり、すべての返却行動を JSONL に書く処理ではない（同 `:352-359`）。このため今回の拒否行を補う完全な行動ログが自動的に残るわけではない。

`sender.submit()` は `validateAction()` が失敗すると、`{event:"rejected", reason:validated.reason, action}` だけを記録して戻る（`example/agents/runtime/send.ts:331-335`）。`blockSeen` の設定はその後の336行目である。mempool logger が `kind=mempool` を付け（同 `:29-35`）、共通 appender が時刻・ID と改行を付けるが、`round` は生成しない（`example/agents/runtime/agentLog.ts:108-118`、同 `:127-131`）。拒否理由を改善用リングへ写す wrapper も先に原形のログを書いており、ディスク上の行に番号を補わない（`botMain.ts:383-394`）。この実装と保存された3拒否行の形が一致する。

取引プロトコル GMX の validator は `BigInt(sizeDeltaUsd) <= 0` を `sizeDeltaUsd must be positive` として拒否する（`sdk/src/protocols/gmx.ts:1204-1209`）。現行 grok-1 は減額時の `sizeUsd > 0` を確認してから、`Math.floor(usd * 1e6)` に相当する丸めを行って30桁スケールの文字列に変換する（`example/agents/grok-1/agent.ts:459-475`、同 `:189-190`）。したがって正だが 0.000001 未満の米ドル相当額が丸めでゼロになる経路は静的に存在する。ログの25個のゼロとも整合する。ただし当時の全観測値・ポジション残高・実行コードのハッシュはないので、当時その微小残高経路だったことまでは証明していない。

帰属は二段階で考える。

- **世界内の行動として確認できる事実：** grok-1 がゼロ数量の減額を提案し、送信前の検証で拒否された。候補エージェントの telemetry 欠損ではない。summary の grok-1 は E4-B `:1201-1203`、E5-B `:1211-1213` とも revertCount 0・unloggedTxCount 0 だが、ローカル拒否はチェーン上の revert ではないため矛盾しない。
- **観測形式の問題：** `action` を持つ拒否イベントに時点がない共有ランタイムと、それを `round` 必須の判断として読む G0 の契約不整合である。対戦相手のその世界で顕在化したが、「計測系には問題がなく対戦相手だけの問題」とは断定できない。他のエージェントも同じ拒否経路で発生し得る。

### LLM 失敗時との区別

grok-1 の `prompt.md:1-5` は `kind: improve` と60ブロックごとの改善を宣言するが、実際の3開始行はすべて `mode=decide`。現行コードでは `ERIS_AGENT_FROZEN=1` により改善を無効化できる（`botMain.ts:492-494`、同 `:523`）。実行時の全環境変数はないので「この変数が設定されていた」とまでは認定しない。実行モードと改善ループ非起動の対応はソースとログで確認できる。3ログ全行に `llm `、`revision `、`decide error:`、`decide timeout:` で始まる reason はない。提供された各 agents ディレクトリには `.llm.jsonl` と `.cli-timing.jsonl` もないが、コピーにないことだけを根拠に呼出失敗とは判断しない。

改善モードを使う別の実行について、現行コードから分かる動作は次のとおり。

- 改善は取引ループ外で実行される。呼出中に次の改善機会が来たら、スキップ理由を通常ログへ記録する（`botMain.ts:769-775`、同 `:973-985`）。
- 呼出例外は、任意の `.llm.jsonl` 記録を有効にしていれば `revision_call` の `error` として残り、外側で通常ログの `reason="revision rejected"` と `state.reason="revision failed: …"` になる。呼出失敗だけで既存戦略を停止・交換する処理ではない（`botMain.ts:782-785`、同 `:1057-1067`、同 `:1177-1183`、同 `:960-967`、`runtime/improve.ts:204-205`）。
- 呼出の既定タイムアウトは300000ミリ秒。OpenAI 互換・Ollama の直接 HTTP 経路は abort signal を使い、429を含む非成功応答を例外にする。この関数内に自動再試行ループはない（`runtime/llm.ts:67-70`、同 `:226-242`、同 `:287-306`）。Anthropic 経路はソフトウェア開発キット（Software Development Kit、SDK）に timeout を渡しており、その内部再試行挙動までは本調査で確認していない（同 `:345-363`）。CLI 経路は起動失敗・非ゼロ終了・タイムアウトを例外にし、時間超過で子プロセスを終了する（同 `:525-565`）。

これらの一般的失敗経路は、本件の観測された直接原因とは異なる。実サービスへの呼出・障害注入は実施していない。

## 診断チェーンでの扱いの選択肢（すべて未実装）

現在の `remote/chain-template.sh` は `--continue-on-g0-fail` を diagnostic モードだけに許す（`:82-83`）。runner と manifest 検証が成功していても、続行できるのは終了コード1かつ出力 `G0 FAIL` の場合だけである（`:224-230`）。BLOCKED の終了コード2は `:231-232` で停止する。第2区分の市場状況は whale / lending-incident / crash（`:200-205`）。したがって全世界のシミュレーションが済んだ後のゲートで停止し、後続区分を再起動する必要が生じる構造である。

### A. 診断専用の狭い続行フラグ

変更案はチェーン制御に `--continue-on-opponent-telemetry-blocked` と明示的な候補 ID 指定を追加するもの。G0 のコード・結果・終了コードは変更しない。診断実行に限り、既知の拒否イベントによる番号欠落を確認した非候補の世界を BLOCKED と記録してから後続区分へ進む。

許可条件はすべて満たす必要がある。

1. 明示フラグあり、`mode=diagnostic`、候補 ID と固定対戦相手集合が開始時の roster に固定されている。`baseline=false` は候補判定に使わない。実際に grok-1 も false である（E4-B `summary.json:1190`、E5-B `:1200`）。
2. matrix と manifest 検証の終了コードが0。G0 の構造化 JSON 出力・終了コード・世界別 status が整合し、すべての blocked 理由が対象の非候補 telemetry に限定される。候補・不明 ID・他種の欠損が1件でもあれば停止する。
3. `agent telemetry <id>` の文字列一致だけで許可しない。原ログを読み、全行解析、開始行、ID、容量上限などの異常がなく、今回と同じ番号欠落の `rejected` 行だけであることを確認する追加分類が必要。他の拒否理由、ファイル欠損・破損も同じメッセージになるため、未知の形は停止する。
4. 最も狭い初期案では同時に `failed` があれば停止する。将来 FAIL の続行を組み合わせるなら、既存の別フラグも要求し、両方の理由を保存する。
5. 原 G0 JSON とログ、世界・agent・行番号・理由を保存し、各続行時に例えば `DEVIATION diagnostic continuation; G0=BLOCKED; world=crash/67001; agent=grok-1; eligible_for_gate=false` を必ず表示する。記録できなければ停止する。
6. 世界を黙って除外して残りを「36世界合格」としない。診断集計には欠測世界と母数を明記する。チェーンが全区分を終えても総合状態は BLOCKED、最終終了コードは2を保持する。後続の PASS で上書きしない。qualification・公式選抜・提出経路には適用しない。

リスクは、候補 ID の誤指定、理由文字列の粗さによる別障害の混入、共有記録系の障害を対戦相手固有と誤認すること、障害世界の除外による選択バイアス、最終終了コードだけを見る監視の誤読。上記の開始時固定・細分類・世界別表示・総合 BLOCKED 保存が必要になる。現行の report/ledger は非 PASS を抑止する契約を維持する（`ascon-notes/league/HARNESS.md:43-46`）。

実装時の陽性対照：同じ拒否欠損を**候補**に入れた fixture（合成入力）、qualification モード、不明 ID、末尾改行欠落、manifest 失敗をそれぞれ与え、すべて停止することを確認する。許可対照は非候補の既知拒否行だけを含む diagnostic で、後続区分が実行され、DEVIATION・世界 BLOCKED・最終終了コード2が残ること。これらのチェーン制御テストは本調査では実行していない。

### B. 拒否ログの生成側を修正する（推奨する恒久策）

共有 sender が観測値を持つ検証拒否で、`action` と同じ判断時点の `round: observation.round` を必ず記録する。必要なら `blockSeen` も併記するが、**現行 G0 には blockSeen だけの追加では足りない**。通常戦略ログへ別の完全な判断行を追加するだけでも、不正な拒否行が残れば BLOCKED は解消しない。G0 の条件・公式ゲートは変更しない。

今回の経路は `send.ts:331-336`。共有コードなので grok-1 以外にも有効だが、観測なしの拒否（同 `:312-318`）まで番号を捏造してはならない。別の guard 拒否は現状 `blockSeen` と `action` がある一方 `round` がないため、同様に確認する必要がある（同 `:320-328`）。

リスクは、非同期処理の「最新」ブロックを誤って割り当てること、重複記録、ログ量・測定負荷の変化、共有 upstream コードの変更による比較条件の変化。修正は別途の変更としてレビューし、同じランタイム版で候補と対照を測る。過去の `.scratch-logs` を書き換えて PASS にしない。拒否された不正注文自体も成功扱いにしない。

実装時の陽性対照：ゼロ `sizeDeltaUsd` を提案し、validator が拒否し送信しないこと、拒否行に正確な `round` が残ることを確認する。その行から `round` を除く、または末尾改行を欠かせた対照では G0 が引き続き BLOCKED を出すことを確認する。今回のメモリ内対照で `round` 有無による検査の差は確認済みだが、sender 修正後の実行・全 G0・実負荷は未検証である。

### C. 固定対戦相手のゼロ数量提案を防ぐ

数量を最終整数表現へ変換してから正値を確認するなど、該当する提案を返さない戦略にする。既存参照エージェントを直接改変せず、新 ID のコピーと新しい固定 roster で比較し直す案である。問題箇所候補は `grok-1/agent.ts:189-190` と `:459-475`。

リスクは対戦相手の行動・資産価値・市場への影響が変わり、旧実験と同条件でなくなること。他の理由による拒否ログの欠陥は残る。したがって telemetry 問題だけを解決する第一選択にはしない。

実装時の陽性対照：正だが最終丸め後ゼロになるポジションの観測値を与え、ゼロ注文を生成しないこと、通常の正数量では従来の行動を維持することを確認する。別途、ゼロ注文を sender に直接与えれば validator の拒否が発火することも確認する。未修正の番号なし拒否ログを G0 に渡せば依然 BLOCKED であるべきで、戦略修正を理由にゲートを緩めない。これらの戦略・sender テストは未実施。

### 推奨判断

恒久策は **B：生成側が実際の判断時点を記録すること**。欠測を許容する条件追加より、既存 G0 契約を満たす観測を残す方が原因に直接対応する。診断チェーンの再起動コストを先に抑える必要がある場合だけ A を暫定採用し、許可対象を今回の既知イベント形に絞る。非候補の telemetry 全般を無条件で続行する案、拒否行を消す案、過去ログに推定時点を補って公式 PASS とする案は採用しない。

## 実施した確認・未検証事項

- ソース、契約文書、3世界の summary・全エージェントログと E4-B の環境 manifest を読取。grok-1 の全行解析・集計、現行エージェント検査コードのメモリ内実行と上記対照を実施した。
- `NPM_CONFIG_IGNORE_SCRIPTS=true NPM_CONFIG_OFFLINE=true npm --logs-max=0 run typecheck` を試行。`tsc --noEmit` の起動時に `sh: tsc: command not found`、終了コード127。**型検査は未検証**。依存関係のインストールはしていない。
- 完全な G0 再判定、区分9世界・全36世界の再検証、チェーン制御の新フラグ試験、既存 unit test suite、LLM 実呼出、Docker、Anvil、バックテストは実行していない。ネットワーク接続、commit、push もしていない。
- 実行当時の全環境・ソースハッシュ、拒否時の完全な観測値、全証跡の保存・転送の完全性は確定できない。環境 manifest はラウンド開始時のコード固定証跡の代用にはならない。
- 変更対象は本書 `ascon-notes/league/G0-GROK1-TELEMETRY-2026-10-07.md` のみ。`.scratch-logs` は読取専用で扱った。`git diff --check` は通過。未追跡の新規文書も対象にするため `git diff --no-index --check /dev/null ascon-notes/league/G0-GROK1-TELEMETRY-2026-10-07.md` を実行し、空白エラーなしを確認した。
