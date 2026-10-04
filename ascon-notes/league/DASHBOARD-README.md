# ASCON ダッシュボードの更新手順

[ASCON-DASHBOARD.html](ASCON-DASHBOARD.html) は外部リソース不要の単一HTMLアプリです。ダッシュボードの正本データはHTML内の `application/json` ブロックだけです。画面・比較値・件数・進捗はそのデータから描画します。MASTERは計画の契約・根拠資料として照合し、HTMLの外から自動取得しません。

ブラウザでファイルを開くと概要が表示されます。`#results`、`#decisions`、`#log` などで直接ページを指定でき、戻る・進むにも対応します。保存後の更新はファイルの再読み込みで反映します。実行中プロセスやサービスをポーリングする機能はありません。

## 画面構成

| ページ | 表示する内容 |
|---|---|
| 概要 | 現在地の一文、最優先ブロッカーと確認項目、本人が今やること、重要イベント3件、次のマイルストーン |
| 全体計画 | 日付付き5 Stepロードマップ、締切、ゲート、重要日程、全28日の詳細 |
| 進捗・結果 | 診断／資格試験の切替、候補比較、run・母集団・出所、原表、進捗台帳と過去の記録 |
| ブロッカー・リスク | 優先順位、原因、影響、対応、担当。未解消／解消済み／全件の切替 |
| 判断 | 本人の予定、登録報告、委任決定、署名・原判断・旧案の詳細 |
| 実行キュー・予算 | 開始・完了見込み・結果確認状態、依存付きキュー、100h枠の予約と実消化の区別 |
| 更新ログ | 既存65件すべて。全文検索＋種類＋記録日（JST）の絞り込み。IDは小さな注記だけ |
| 用語集 | 49語。名前・略語・説明検索、分類フィルタ、参照資料 |

本文の専門語はページ内の初出に `ⓘ` を付け、クリック／キーボードで説明を開きます。Escapeで閉じ、元のボタンへフォーカスを戻します。図表の原語・署名のAstra表記は保存し、現担当はCodexで統一しています。

システムフォント、明示したライト背景、青1色＋状態色を使用。状態には記号と文字を併記します。スマホは16pxの左右余白、表はラベル付き縦並びに切り替えます。動きを減らすOS設定に対応し、印刷用CSSはありません。

## 編集するデータ

`<!-- BEGIN data-… -->` と `<!-- END data-… -->` の間だけを更新します。`ui.schema_version` は `"2"`。既存12ブロックを保持し、`ui` と `glossary` を追加した14ブロック構成です。

| ブロック | 更新する内容 |
|---|---|
| `data-sources` | 出典ID・repo root相対 `path`・資料名・節。生ログや秘密へのリンクは禁止 |
| `data-status` | 更新時刻、概要、本人作業、最優先項目、dev1/dev2/dev3、修理記録、重要イベント、次の目標 |
| `data-plan` | rev・締切、ルール、Stepの期間／状態／平易なラベル、各ゲート、AI・資格・失敗上限の契約 |
| `data-phases` | 工程の期間・状態・停止条件。既存の工程IDを保持 |
| `data-milestones` | 28日分の予定・依存・停止条件。MASTERのschedule表と一致させる |
| `data-progress` | 作業単位の状態・根拠。最優先バーは `priority.progress_refs` の完了数だけを数える |
| `data-blockers` | 順位、重要度、可能性、影響、`impact_note`（何が困るか）、根拠、対応、担当、状態 |
| `data-queue` | 優先順、現在の実行、依存、全量見積もり。MASTERのnext-24h表と一致させる |
| `data-budget` | 100hの予約配分、枠内消化、過去の実測下限、推定、旧未採用列。分数を保持 |
| `data-results` | 原表、診断／資格別の比較定義、数値への参照、runラベル、母集団、出典 |
| `data-decisions` | 決定・元の日付・期日・担当・委任出所・署名、Ollama本人報告 |
| `data-log` | 全履歴。JST時刻、種類、要約、出所、時刻根拠、対象日 |
| `data-glossary` | 用語ID、名称、別名、分類、平易な定義。初出説明と用語集で共用 |
| `data-ui` | ページ定義、KPIの参照、表示文、ロードマップ目盛り、省いた重複。事実をJSに直接追加しない |

KPIの `ref`、比較表の `scope_ref` / `run_ref` / `candidate_ref` / `baseline_ref` は `status.dev2.result.p_candidate` のようなJSON参照です。同じ値をrendererへ転記しません。`ui.copy` は概要や判定の表示文です。数値を更新したら、文の判定・状態も根拠に合わせます。`source_table` のある原表は指定Markdownの桁・列・母集団をそのまま保持します。

`null` は未確認／未見積です。0に置換しません。現在の `consumed_forward_hours=null` と `consumed_exact_hours=null` は未精算の意味です。過去の実測下限18.6hを100hから引いた残量や、経過時間からの計測進行率は表示しません。予算の棒は予約配分、最優先の進捗は確認項目数であり、実消化率・合格率ではありません。

## 更新手順

1. 秘密値を含まない担当者の引継ぎ／生成表で事実を確認する。本人が確認した設定は「本人報告」、提示計測値は「measured引継ぎ」、推定と未確認は別にする。
2. 該当するJSONを更新し、数値・run・seed・レジーム・場・G0・時刻根拠・出所をそろえる。要約、比較判定、進捗、ブロッカー、キュー、重要イベントに旧状態が残っていないか確認する。
3. 計画や新しい引継ぎの原表をMASTERへ反映する。今回の最新値はMASTER §1.6、用語はAppendix B。契約はrevision 6を維持する。ロードマップの期間は開始を許可するものではない。
4. `status.as_of` と `last_update` を更新する。時刻はJSTで取得する。測定開始／完了時刻へ更新時刻を代入しない。
5. 下記の軽量検査を実行し、未検証の境界を引き継ぐ。commitは今回の依頼では行わない。

JSTは `TZ=Asia/Tokyo date '+%Y-%m-%dT%H:%M:%S%z'`、またはPython `ZoneInfo('Asia/Tokyo')` で取得します。保存形式は秒付き `YYYY-MM-DDTHH:mm:ss+09:00`。日付は `YYYY-MM-DD`。Macの現地時刻（UTC+8）をJSTとして保存しません。

IDは全ブロックで一意。progressは `done/running/pending/failed/blocked`、担当は `human/Claude/Codex`。署名の原記録にあるAstraは改名しません。出所は既存ファイルに限り、絶対path・`..`・外部URL・symlink・`upstream-eval`・生の測定出力・秘密への参照を入れません。

ログは追記のみ。訂正は新しい `誤り` エントリにし、時刻を降順に保ちます。今回の再構成では65件を全件・全フィールドそのまま維持し、新しい引継ぎは `status.recent` の3件とMASTER §1.6へ表示しました。今後ログを追加する際も既存65件のdigestを変更しません。既存の原時刻が不明なら、記録時刻と `time_basis` を明示し、出来事の分単位の時刻を作らないでください。

## 現在の証拠・計画境界

- dev2-xb-rはmeasured引継ぎ。F_ref、31001/31002、6レジーム12世界、G0 PASS。平均P 149.0/1352.2、平均取引数44.8/300.9、診断平均T44.36/56.84。全世界P−noop正・最小+147.7、noop割れ／違反／revertは0。原表の細かい桁は `DEV2-XB-R-REPAIR.md` の別表を維持。資格合格にはしない。
- a646e9bの123テスト・赤対照25件は既存の検査記録の引継ぎ。今回の再実行結果ではない。
- dev3a-xb-rはF_ref、35001/35002、9レジーム18世界、10/4 16:24 JST開始、17:40頃完了見込み。結果・G0・完了数・完了時刻はnull。残り3レジームは第2チャンク。見込み時刻が過ぎても自動で完了にしない。旧AI D対照案の同seedは再利用せず、将来実行前に未使用集合の登録が必要。
- Q0/Q0bの旧不合格・Q0bの2世界G0 FAIL・安全nullスナップショットを保持。救済再走なし。新Q0は1候補1回60世界・41301–41305・5h上限。ゲートやrevert上限の緩和なし。
- 委任済み6決定は確定状態・出所・署名日時を保持。KEY/金銭を委任へ拡張しない。Ollamaの登録・Free・残高$0・Auto-reload Off・クリップボード消去は本人報告。dec-008 resolved、dec-007は10/28 open、現在の本人作業はなし。モデルの運営一覧・無料枠量・疎通は未確認。
- KEEP配分は100h、G3 17.2h・deep 9.7h（Q0 5h優先）・M2 0h。旧AMENDも100hの履歴として保存。全費用未確保を実行許可や残り時間へ読み替えない。10/17 18:00の分岐、10/31 23:59 JST締切を保持。

## 検査

repo rootから、依存のインストールなしで実行します。Python標準ライブラリとNode組込み機能のみです。

```sh
python3 -B ascon-notes/league/check-plan-consistency.py --self-check
node ascon-notes/league/dashboard-ui-check.mjs --dump /tmp/ascon-rendered-pages.json
python3 -B ascon-notes/league/dashboard-check.py --self-check --rendered /tmp/ascon-rendered-pages.json
git diff --check
```

`dashboard-check.py` はJSON重複キー・有限数・一意ID・JST・日付・ログ降順・出所の実在と安全・元表一致・正確な分数和・担当／状態／依存・HTML構造を検査します。追加で8ページ、KPI／比較の参照、49語と必須語、外部CSS／ネットワーク呼出しの禁止を確認します。`--rendered` はNodeで生成した各画面のタグ、ID、出典リンクとID露出を検査します。

`check-plan-consistency.py` は旧表、全28日、18件のレビュー判断、予算・署名・Q0・AI反復・切替条件の照合を維持し、65ログの完全保持、最新dev2値とdev3の未確認状態、実消化のnull、表示比較の母集団と数値参照も検査します。

`dashboard-ui-check.mjs` は実際のインラインJSを小さなDOMアダプターで実行します。8ページ＋資格ビューの生成、検索／複合フィルタ、空結果、ハッシュ遷移、用語の開閉とEscape、エスケープ、JSON変更の表示反映、主要文字色のAA比とレスポンシブ指定を検査します。DOMアダプターはブラウザではなく、レイアウトの検証にはなりません。

**チェッカー変更理由**: JSON正本のまま8ページと用語説明へ再構成したため、従来のデータ・計画・予算・署名・原表の検査を全て保持した上で、ページ／参照／用語／描画出力の検査を追加した。旧dev2結果待ちという固定条件は最新のmeasured引継ぎと衝突するため、提示された数値・母集団・資格不可を厳密一致で検査し、未確認状態の検査はdev3へ移した。dev3の架空完了・結果・進行率、本人報告の監査済み化、予算消化の捏造、数値参照の取り違えを新たな反例として拒否する。旧60ログのdigest検査を残し、全65件のdigestも追加した。合否閾値・費用・反復回数は緩めていない。

## 省いた表示と保存先

削除した事実・ログ・測定表はありません。以下の表示上の重複を整理しました。

- 同じ結果の繰り返し図表：MASTER §1に保持し、進捗・結果の比較と原表に集約。
- 予算配分・AI契約の重複説明：MASTER §5–7に保持し、判断・予算の詳細へ集約。
- トップにあった内部手順・過去の細かな経緯：MASTER §8–11と全ログを保持し、原表・履歴の折りたたみへ移動。

## 今回の検証範囲

静的検査・Nodeの画面ロジック検査は実行済み。ブラウザ／ヘッドレスChrome／描画エンジンは起動していません。実際の見た目、スマホ幅での横スクロール、支援技術の読み上げ、実ブラウザでの操作は未検証で、Claudeのブラウザペインで確認する引継ぎです。

`node_modules` 自体のリンク属性だけを確認し、`../upstream-eval/node_modules` を指すため辿っていません。依存を読む `npm run typecheck`、戦略テスト、Docker、backtestは今回未実行です。保護領域・鍵・`.env`・実行中計測へアクセスせず、型検査済みとは報告しません。新規計測・外部サービス照会・commitも行っていません。

最終確認結果（ブラウザ未起動）:

```text
PASS dashboard-check: 14 blocks / 65 logs / 10 source tables / 49 terms
PASS checker controls: 23 invalid cases rejected
PASS check-plan-consistency: rev 6 contracts + latest handoff + all 65 logs
PASS plan controls: 57 unsafe/stale mutations rejected
PASS dashboard UI: 21 checks / 8 pages + qualification view
PASS rendered HTML: 9 views / balanced tags / safe links / unique IDs
PASS git diff --check
```

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
