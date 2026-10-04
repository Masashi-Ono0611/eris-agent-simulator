# ASCON ダッシュボードの更新手順

正本は [ASCON-DASHBOARD.html](ASCON-DASHBOARD.html)。計画・結果・判断・履歴を表示する**唯一の要約HTML**とし、他の summary HTML は退役する。旧 `summary-2026-10-03.html` は削除し、過去版はgit履歴で参照する。upstream製品の `dashboard/index.html` は対象外。

## 更新場所

HTML冒頭の `<!-- BEGIN data-… -->` と `<!-- END data-… -->` の間にある `<script type="application/json" id="data-…">` だけを編集する。図・表・件数・バーはインラインJSが生成する。表示用JS/CSSに事実や測定値を足さない。

Q0b完了への移行では、終了見込みの固定表示を `status.measurement_note` の表示へ置き換え、`results.q0b` の表を描画する汎用処理だけを追加した。以後の更新は上記データブロック内で完結する。完了/集計時刻が未提示なら `measurement_as_of` / `q0b.completed_at` は `null`、終了済みなら `q0b.expected_end` は `null` とし、記録時刻を実測時刻へ代入しない。

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
- queueは依存ゲートを先に更新し、priorityを連続番号にする。現優先はdev1終了後の担当証跡→現Q0契約→受理S。本人申告runningとlive確認済みを分け、終了見込みだけで完了へ遷移させない。
- budgetは実測・推定・全量予約・枠外履歴を分ける。各列の合計を `total_hours` に一致させる。実消費は担当者が生成した開始/終了区間の和集合から転記。夜間/日境界や失敗を消さず、未署名案を現行配分へ混ぜない。
- **ログは追記のみ、歴史を書き換えない。訂正は `[誤り]` の新entryを追加する。** JSON配列の先頭に新しい記録を追加し、時刻は非増加（同時刻可）にする。typeは `実測/決定/実装/レビュー/計画変更/誤り` のいずれか。古い出来事を今追記する場合、timestampは記録時刻、event_dateは対象日、time_basisに「時刻未記録」と明記。架空の分単位時刻は作らない。

## revision 5の保守契約

- [MASTER rev 5](MASTER-PLAN-2026-10-04.md)と[AI詳細設計](DESIGN-AI-LAYER-01-astra.md)を出典にする。Step1決定論Q0優先・10/8延期は本人決定済み。AI権限/反復/費用は未署名であり、この二つを混ぜない。
- `plan.protocol`のStep1–5はMASTERの`ai-roadmap`表に一致させる。`plan.ai_contract`はAI-G3-01の未署名の提案値。世界数/時間は設計C.1の算式から転記し、checkerのFraction計算で検証する。実測へ昇格しない。
- 既存budget両列100hは維持。AI費の振替は署名前には行わない。提案残額と現在の予約額を別フィールドに保ち、API金銭費・Air占有・本人操作待ちを混ぜない。dev1の未精算費を0hにしない。
- `status.dev1.state=reported-running` / `verified=false`は今回本人申告の記録。担当証拠で進捗が更新されたら、checkerの状態契約も理由付きで更新する。計測領域を直接読んで同期する仕組みにはしない。
- `results.q0b_summary`の安全nullはrev 4引継ぎ時点の保存値。その後の修理設計には診断集計がある。新たな認定を示す場合は別の出典/判定欄を作り、元の表/旧FAIL/ログを上書きしない。
- 規約はオンライン取得済み。ただし未来日付版の表示があるため適用版は未確認。取得と適用確認を区別する。鍵/アカウントをAIが確認する手順は設けない。
- 今回はJSONブロックだけを変更し、renderer/CSSは維持した。既存49ログとdec-007/008は完全保持し、新しい訂正/計画変更/レビューを追加した。

**checker変更理由**: rev 4専用の「延期は本人未決」「証跡待ちqueue」を現在方針へ更新するため。予算/過去結果/未署名Q0mの検査を維持し、AI反復/下流資格費の算術・AI専用E3/Q1の未署名mode・5段階の本文対応・未署名/申告状態と13件の反例検査を追加した。`dashboard-check.py`は既存の汎用スキーマで検証できるため変更していない。試験を通すための合否閾値緩和ではない。

## 初回の当日引継ぎ・移行証拠

以下は2026-10-04朝の初回移行時点の履歴で、現在状態ではない。Q0b完了後の実測引継ぎは [MASTER §1.3](MASTER-PLAN-2026-10-04.md#13-opus-1-q0b-全60世界完了平均t条件fail)、現況は正本のデータブロックを参照する。測定領域へのライブ照会は行っていない。表中の旧時刻はMac現地時刻で、JSTでは+1h（開始07:37、旧見込み12:00）だった。

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
python3 -B ascon-notes/league/check-plan-consistency.py
python3 -B ascon-notes/league/check-plan-consistency.py --self-check
python3 -B ascon-notes/league/dashboard-check.py --self-check
git diff --check
```

標準ライブラリのみ。JSON、ID、JST/日付、ログ降順、予算の正確和、全出典ファイル、blocker必須欄、元の生成表との一致、HTMLタグを検査する。`--self-check` は不正入力の反例をメモリ上で検査する。欠落パスは一覧でFAIL。保護領域は存在確認より前に拒否し、symlinkも辿らない。`check-plan-consistency.py` はrevision 5の本文とデータの旧Q0b保存値/予算/queue/日程/本人判断/AI契約を照合する。`--self-check`は署名捏造・費用欠落・反復削減・旧状態への逆戻り等をメモリ内で拒否する。退役HTMLや「Q0b実行中」の固定条件は使わない。

PASSは静的整合性のみ。ブラウザ描画・モバイル/印刷の実見、dev1/Q0b原ログ、実消費時間、規約の適用版、戦略の型/性能/提出適合は未検証。今回のnode_modulesはupstream-evalへのsymlinkであり、測定領域を開かない境界のためnpm typecheckを実行しない。npm test・backtest・Anvil・ブラウザは実行しない。公開規約/Ollama公式ページの読取だけは今回実施済みで、認証付きサービスへの操作はない。IBM Plexはローカルのインストールがあれば使用し、未導入ならフォールバックする。外部フォントの取得はしない。

最終checker出力（静的検査、今回実行）:

```text
PASS sources: D0 6 rows, Q0 12 regimes, M1 6 clusters unchanged; Q0b handoff table matches dashboard
PASS Q0b: 60 completed; mean-T FAIL; G0 A/C PASS, B FAIL; rev-4 safety snapshot retained; no automatic rerun
PASS budget: KEEP = 100 h; unsigned AMEND = 100 h; Q0b completed-time estimate, actual usage unverified
PASS exploration: M2-skipped 180 worlds = 13 h + 1.9 h support; no new runs released
PASS queue: dev1 evidence -> Q0/acceptance first; AI/exploration not released
PASS amendment: original unsigned and pre-view condition expired; new version/signature required; old FAIL retained
PASS schedule/review: 28 consecutive JST dates; 18 Grok findings; dec-008 Oct 7 / dec-007 Oct 28 preserved
PASS dashboard correspondence: budgets, queue, schedule, Q0b data and pending decisions match plan
PASS AI: five steps match; unsigned 3-ON/1-OFF contract; 144/288 worlds and 12/22.4 h verified; no budget transfer
PASS current state: Q0 first, Oct 8 deferred, dev1 user-reported only; safety boundary and rule-version caveats retained
LIMIT: static consistency only; raw results, actual hours, strategy safety, browser layout and acceptance unverified
PASS check-plan-consistency
PASS plan controls: 13 unsafe/stale mutations rejected in memory
PASS JSON: 12 blocks; 243 unique HTML/data ids
PASS log: 52 entries; JST descending (ties allowed); allowed types; valid dates
PASS budget: KEEP = 100 h; unsigned AMEND = 100 h (exact fractions)
PASS sources: 21 repo files exist; 0 missing; 7 copied tables match
PASS blockers: 15 complete ranked rows; queue / phase / decision references valid
PASS HTML: balanced tags; unique ids; no external resources
PASS checker controls: 13 invalid cases rejected in memory
LIMIT: static consistency only; live runs / browser layout / submission / actual hours unverified
PASS dashboard-check
PASS preservation: 49 prior logs and dec-007/008 unchanged; only HTML data blocks changed; dashboard checker unchanged
PASS source links: 37 repo-local citations exist; no protected path or symlink followed
PASS renderer smoke: 10 sections and five AI steps generated; DOM stub only, not visual QA
```
