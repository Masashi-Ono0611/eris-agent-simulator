# ASCON ダッシュボードの更新手順

正本は [ASCON-DASHBOARD.html](ASCON-DASHBOARD.html)。計画・結果・判断・履歴を表示する**唯一の要約HTML**とし、他の summary HTML は退役する。旧 `summary-2026-10-03.html` は削除し、過去版はgit履歴で参照する。upstream製品の `dashboard/index.html` は対象外。

## 更新場所

HTML冒頭の `<!-- BEGIN data-… -->` と `<!-- END data-… -->` の間にある `<script type="application/json" id="data-…">` だけを編集する。図・表・件数・バーはインラインJSが生成する。表示用JS/CSSに事実や測定値を足さない。

| ブロック | 編集する内容 |
|---|---|
| `data-sources` | `sources` 配列。出典ID、repo root相対の `path`、資料名、節/表の位置 |
| `data-status` | `as_of`、測定資料の時点、`last_update`、現在phase、Q0bなどの状態 |
| `data-plan` / `data-phases` | 目標・制約・競技手順・ゲート / 各phaseの期間と状態 |
| `data-milestones` | 日程・依存・停止条件・既決判断への参照。翌週表示もここから生成 |
| `data-progress` | workstream別の項目と状態、証拠。完了数は登録項目数に対する比率 |
| `data-blockers` | 順位、重要度、可能性、影響、owner、根拠、対策、状態。定性判断を実測確率と呼ばない |
| `data-queue` | 優先順、owner、条件、全量見積h、active。`null` は未見積で0hではない |
| `data-budget` | 消費実測下限、解釈、KEEP/AMEND配分と会計区分。分数文字列で保持 |
| `data-results` | 生成表のheader/rows、比較条件、単位、診断/資格の別。`source_table` は転記元との照合指定 |
| `data-decisions` | 本人判断日/資料記録日、期日、状態。方針決定と実行完了を分ける |
| `data-log` | JST時刻・種類・一行要約・出典・時刻根拠・出来事の対象日 |

## 時刻の規則（2026-10-04 追加）
- すべて JST（+09:00）で記録する。この Mac のタイムゾーンは Asia/Kuala_Lumpur（UTC+8）で JST と 1 時間ずれるため、現在時刻は必ず `TZ=Asia/Tokyo date` で取る。commit 時刻は `git log --format=%cI` のオフセット付き表記から換算する。
- 出来事の正確な時刻が不明なものは「移行時刻」で追記し、`time_basis` に根拠を書く（Astra が初回に作った移行時刻 09:15:12 JST は実際の作成時刻で正しい）。

## 更新の約束

- IDはASCII英数字とハイフン、全ブロックで一意。既存IDは再利用しない。例：`progress-q0b`、`B15`、`log-040`。既存の `dec-007` / `dec-008` は維持する。
- 日付は `YYYY-MM-DD`、時刻は秒付き `YYYY-MM-DDTHH:mm:ss+09:00`。画面はJST。毎回 `as_of` と `last_update` を更新する。測定時点を更新時刻で上書きしない。
- 数字は**生成済みの表からそのまま転記し、手計算で導出しない**。原表の桁・単位・母集団・seed・G0状態を保持。チャート幅や件数の表示計算だけをJSに任せる。出典が不明なら `null` / 未確認とする。
- 数値/判断を持つ行・表には `sources: ["src-…"]` を付ける（同じブロックの共通出典を継承可）。リンクは `data-sources.sources[].path` に集約し、repo root相対・実在ファイルにする。外部URL・絶対path・`..`・symlinkを使わない。今回保護された測定出力にはリンクせず、生成表を保存したMarkdownを出典にする。
- progressは `done/running/pending/failed/blocked`。FAILの測定が終了しても合格やREADYにしない。blockerのseverity/likelihood/impactとownerは明示し、解消には証拠を付ける。
- queueは依存ゲートを先に更新し、priorityを連続番号にする。Q0b完了後はAstra更新が先。見込み終了時刻が過ぎただけで完了へ遷移させない。
- budgetは実測・推定・全量予約・枠外履歴を分ける。各列の合計を `total_hours` に一致させる。実消費は担当者が生成した開始/終了区間の和集合から転記。夜間/日境界や失敗を消さず、未署名案を現行配分へ混ぜない。
- **ログは追記のみ、歴史を書き換えない。訂正は `[誤り]` の新entryを追加する。** JSON配列の先頭に新しい記録を追加し、時刻は非増加（同時刻可）にする。typeは `実測/決定/実装/レビュー/計画変更/誤り` のいずれか。古い出来事を今追記する場合、timestampは記録時刻、event_dateは対象日、time_basisに「時刻未記録」と明記。架空の分単位時刻は作らない。

## 今回の当日引継ぎ・移行証拠

以下は2026-10-04朝の本人依頼から保存した事実/判断。測定領域へのライブ照会は行っていない。

| 項目 | 引継ぎ内容 |
|---|---|
| Q0b | opus-1、seeds 41101–41105、60世界、3 chunks、06:37 JST開始、RUNNING、~11:00終了見込み |
| 本人判断 | 現Q0契約をKEEPしてQ0bを待つ。Q0-AMEND-01は未署名。完了後にAstraが計画を更新 |
| 人間操作 | dec-008はopen、10/7まで最小Ollama確認＋本人が鍵を貼付・登録。dec-007もopen、10/28最後に再確認 |
| 時間 | 実測の累積Air消費は最低18.6h。forward-100h読みで運用中、本人の確認待ち |
| 時刻の訂正 | MORNING/MASTERの06:41表記より今回の06:37を優先。元資料は変更せず `[誤り]` を追記 |

旧HTML（`f63c3cb`時点の `ascon-notes/league/summary-2026-10-03.html`）から、他のMarkdownに全数値が揃わない履歴も退役時に転記した。新たな実測ではない。

| 旧HTMLの節 | 保持した記録 |
|---|---|
| s11 / s12 | CI失敗4回。原因記録はcommit漏れ、CI空き13GB、旧検査回帰、全体検査同時実行 |
| s12 | quick 326件・約20秒、full 1665 PASS・失敗0・skip 9、BLOCKED条件6。失敗commitの赤→緑確認との記録 |
| s13 | U1は21 FAIL / 1 BLOCKED / 14 PASS、p99 1.1–2.7秒。u1mは負荷36/36・362loops・最大233ms、全体G0 BLOCKED |

履歴のcommit時刻は、このworktreeのローカルgit履歴のISO日時をJSTへ変換した。ログ要約にSHAと「commit記録時刻」を併記し、計測開始/終了時刻とは区別している。PR #4など時刻の根拠がない事象は移行時刻で追記した。資料本文に引用される保護パスは開いていない。

## 検査

repo rootから（別cwdでもスクリプトは自身の場所からrootを決定）:

```sh
python3 -B ascon-notes/league/dashboard-check.py --self-check
git diff --check
```

標準ライブラリのみ。JSON、ID、JST/日付、ログ降順、予算の正確和、全出典ファイル、blocker必須欄、元の生成表との一致、HTMLタグを検査する。`--self-check` は不正入力の反例をメモリ上で検査する。欠落パスは一覧でFAIL。保護領域は存在確認より前に拒否し、symlinkも辿らない。旧 `check-plan-consistency.py` は退役HTMLの当時の構造に依存する履歴用スクリプトなので、今後のダッシュボード更新には使用しない。

PASSは静的整合性のみ。ブラウザ描画・モバイル/印刷の実見、Q0bライブ進捗、実消費時間、外部規約、戦略の型/性能/提出適合は未検証。この作業では測定保全と対象範囲のため、npm typecheck・npm test・backtest・Anvil・ネットワーク・ブラウザを実行しない。IBM Plexはローカルのインストールがあれば使用し、未導入ならフォールバックする。外部フォントの取得はしない。

最終checker出力:

```text
PASS JSON: 12 blocks; 216 unique HTML/data ids
PASS log: 45 entries; JST descending (ties allowed); allowed types; valid dates
PASS budget: KEEP = 100 h; unsigned AMEND = 100 h (exact fractions)
PASS sources: 19 repo files exist; 0 missing; 6 copied tables match
PASS blockers: 14 complete ranked rows; queue / phase / decision references valid
PASS HTML: balanced tags; unique ids; no external resources
PASS checker controls: 13 invalid cases rejected in memory
LIMIT: static consistency only; live runs / browser layout / submission / actual hours unverified
PASS dashboard-check
```
