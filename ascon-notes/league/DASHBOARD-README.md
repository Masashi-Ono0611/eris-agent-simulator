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
- queueは依存ゲートを先に更新し、priorityを連続番号にする。現優先は修正後dev2再診断（結果待ち）→現Q0→受理S。dev2だけactive、Q0以降は停止。dev1は本人提示のmeasured診断完了・取引なし。原ログ/live監査とは分け、診断完了を資格PASSへ遷移させない。
- budgetは実測・推定・全量予約・枠外履歴を分ける。各列の合計を `total_hours` に一致させる。実消費は担当者が生成した開始/終了区間の和集合から転記。夜間/日境界や失敗を消さず、未署名案を現行配分へ混ぜない。
- **ログは追記のみ、歴史を書き換えない。訂正は `[誤り]` の新entryを追加する。** JSON配列の先頭に新しい記録を追加し、時刻は非増加（同時刻可）にする。typeは `実測/決定/実装/レビュー/計画変更/誤り` のいずれか。古い出来事を今追記する場合、timestampは記録時刻、event_dateは対象日、time_basisに「時刻未記録」と明記。架空の分単位時刻は作らない。

## revision 6の保守契約

- 正本は[MASTER rev 6](MASTER-PLAN-2026-10-04.md)、AI契約詳細は[AI設計](DESIGN-AI-LAYER-01-astra.md)。決定出所は「本人が 2026-10-04 に Astra へ判断を委任。Astra が決定」。署名者は「本人委任のAstra決定」、署名日時は今回のJST決定記録時刻。本人の署名や過去の発言時刻を偽装しない。hash/未使用性/全費用の未確認を署名空欄や本人再承認待ちへ戻さない。
- `decisions`の6件は`decided`で、`origin`/`signer`/`signed_at`を持ち、rendererが表示する`note`にも出所・署名を含める。dec-007/008のID・元の日付/期日は保持。本人報告に基づきdec-008はresolved、dec-007は10/28 open。登録受理・設定は本人報告と明記し、モデル公式一覧照合/無料枠量/鍵疎通は未確認。現在の本人作業なし、無料枠不足時の前払い判断はG3見積もり後。
- `plan.protocol`はMASTERの`ai-roadmap`と一致。`ai_parameters`はENTRY_BPSだけ、20–60/初期60/刻み5/最大±5bps/60block。`ai_contract`はR* ON3/OFF1＋S full=216世界・17.2h、epoch間学習持越しなし。決定と実装/資格/受理を混同しない。
- KEEP予算はG3へ5.2hを振替済み（17.2h）、deepは9.7h（うち新Q0 5hを優先留保）。M2=0h。両列合計100hを維持し、AMEND列は旧未署名比較の履歴として選択不可。AI専用E3/Q1・D・実装・追加修理の全費用は未確保。API金銭費/将来の条件付き前払い判断/未精算dev1・dev2をAir空き枠や0hへ変えない。
- `q0_requalification`はA現行維持、修理済み1候補1回/60世界。追加P条件・全世界P−noop≥0・F_u1m等の採否はMASTER §4.1に明記。`revert_contract`は新資格各60世界で≤1件かつ≤0.1%、旧結果へ遡及しない。`cutover`は10/17 18:00 JSTのH480/S240/未実施条件。6件の判断を未決表示へ戻さない。
- `status.dev1.state=measured-diagnostic-complete`は本人が今回提示したmeasured結果。`verified=false`は原ログ/live再監査をしていない意味で、提示された実測を未測定へ戻すものではない。G0 PASS/362loops/12世界でも全世界P−noop=0.0・取引0で`q0_eligible=false`。`progress-dev1=done`は診断の終了だけ、資格は別のblocked項目。正確な完了時刻/hash/占有費は未提示のまま。
- Q0bの旧60世界表/安全nullスナップショット/2世界G0 FAIL/平均T FAILは保存し、救済再走なし。DESIGN-REPAIR-01は変更せず、未署名案の追加条件/費用を現在の採用条件にしない。
- HTMLはJSONブロックだけ変更し、renderer/CSSは維持。既存60ログは完全保存、今回log-061〜065を先頭へ連番追加（配列順は065→061）。新診断の原表はMASTER §1.5に保存し、データ表と汎用researchカード/現在地へ反映する。
- 規約/Ollamaページ取得はrev 5の記録であり今回再取得なし。未来日付表示と適用確認を区別。秘密/認証画面/計測領域を読む同期経路を作らない。

**checker変更理由**: rev 6の契約は維持し、今回の本人指示に合わせてdev2結果待ち/dec-008 resolved/現在の本人作業なしを検証する。旧「全キュー停止」「dec-007/008 open固定・オブジェクト不変」は現在事実と衝突するため、dev2だけactive、dec-008 resolved・元の日付/期日保持、dec-007 openに置換した。既存60ログはdigestで保存を確認。本人報告をmeasuredへ変える、未確認のモデル/枠/鍵疎通を確認済みにする、dev2に結果/完了時刻を入れる反例など計39件を拒否する。旧結果・予算・表・6決定・ゲート検査は維持し、合否閾値は緩和しない。

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

標準ライブラリのみ。JSON、ID、JST/日付、ログ降順、予算の正確和、全出典ファイル、blocker必須欄、元の生成表との一致、HTMLタグを検査する。`--self-check` は不正入力の反例をメモリ上で検査する。欠落パスは一覧でFAIL。保護領域は存在確認より前に拒否し、symlinkも辿らない。`check-plan-consistency.py` はrevision 6の本文とデータの旧Q0b保存値/予算/queue/日程/委任決定/AI契約を照合する。`--self-check`は署名捏造・費用欠落・反復削減・旧状態への逆戻り等をメモリ内で拒否する。退役HTMLや「Q0b実行中」の固定条件は使わない。

PASSは静的整合性のみ。ブラウザ描画・モバイル/印刷の実見、dev1/dev2/Q0b原ログ、実消費時間、規約の適用版、戦略の型/性能/提出適合は未検証。今回のnode_modulesはupstream-evalへのsymlinkであり、測定領域を開かない境界のためnpm typecheckを実行しない。npm test・backtest・Anvil・ブラウザは実行しない。公開規約/Ollama公式ページ取得はrev 5記録を継承しただけで今回は再取得なし。認証付きサービスへの操作はない。IBM Plexはローカルのインストールがあれば使用し、未導入ならフォールバックする。外部フォントの取得はしない。

最終checker出力（今回の静的検査。戦略テスト/ブラウザ描画は未実行）:

<!-- self-check-output:start -->
```text
PASS sources: D0/Q0/M1/Q0b tables retained; dev1 handoff matches plan/dashboard
PASS Q0b: old 60-world result, G0 2-world FAIL and mean-T FAIL retained; no rescue rerun
PASS budget: KEEP 100 h (G3 17.2, deep 9.7); archived unsigned AMEND 100 h; Q0 priority 5 h
PASS queue: repair/rediagnosis -> Q0 -> acceptance; AI execution blocked by full-cost/evidence gates
PASS decisions: 6 delegated Astra decisions with origin/signer/JST; Ollama registration/settings are user-reported; prepayment deferred
PASS Q0: A unchanged; 1 new 60-world attempt; extra P/u1m conditions rejected; revert cap prospective only
PASS AI: ENTRY_BPS 20-60, max step 5; R* ON3/OFF1 + S full = 216 worlds / 17.2 h; no epoch learning carryover
PASS cutover: Oct 17 evidence gates select H480 / S240 / no campaign; no fresh deep exploration
PASS schedule/review: 28 JST dates, 18 findings, five roadmap steps match dashboard
PASS preservation: prior 60 logs unchanged; dec-008 resolved / dec-007 open with original dates; old safety nulls retained
LIMIT: static consistency only; raw runs, actual hours, strategy safety, browser layout and acceptance unverified
PASS check-plan-consistency
PASS plan controls: 39 unsafe/stale mutations rejected in memory
PASS JSON: 12 blocks; 267 unique HTML/data ids
PASS log: 65 entries; JST descending (ties allowed); allowed types; valid dates
PASS budget: KEEP = 100 h; archived unsigned AMEND = 100 h (exact fractions)
PASS sources: 22 repo files exist; 0 missing; 8 copied tables match
PASS blockers: 15 complete ranked rows; queue / phase / decision references valid
PASS HTML: balanced tags; unique ids; no external resources
PASS checker controls: 13 invalid cases rejected in memory
LIMIT: static consistency only; live runs / browser layout / submission / actual hours unverified
PASS dashboard-check
PASS preservation: previous 60 logs, six delegated decisions, budget rows and Q0b unchanged; HTML edits only within JSON; MASTER rev 6 sections/line count unchanged
```
<!-- self-check-output:end -->
