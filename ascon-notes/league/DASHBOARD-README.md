# ASCON ダッシュボードの更新手順

[ASCON-DASHBOARD.html](ASCON-DASHBOARD.html) は外部リソース不要の単一HTMLアプリです。ダッシュボードの正本データはHTML内の `application/json` ブロックだけです。画面・比較値・件数・進捗はそのデータから描画します。MASTERは計画の契約・根拠資料として照合し、HTMLの外から自動取得しません。

ブラウザでファイルを開くと概要が表示されます。`#results`、`#decisions`、`#log` などで直接ページを指定でき、戻る・進むにも対応します。保存後の更新はファイルの再読み込みで反映します。実行中プロセスやサービスをポーリングする機能はありません。

## 画面構成

| ページ | 表示する内容 |
|---|---|
| 概要 | KPI4枚（このページのみ）、現在地の一文、最優先ブロッカーと確認項目、本人が今やること、重要イベント3件、次のマイルストーン |
| 全体計画 | 日付付き5 Stepロードマップ、締切、ゲート、重要日程、全28日の詳細 |
| 進捗・結果 | 比較表を最初の内容セクションに表示。診断／資格試験の切替、run・母集団・出所、原表、進捗台帳と過去の記録 |
| ブロッカー・リスク | 優先順位、原因、影響、対応、担当。未解消／解消済み／全件の切替 |
| 判断 | 本人の予定、登録報告、委任決定、署名・原判断・旧案の詳細 |
| 実行キュー・予算 | inczの走行中・結果待ち、夜間消費の概算/未精算、体制・別ジョブ、連続稼働の段階・待ち時間・Q0準備screen、依存付きキュー、100h枠の予約と実消化の区別 |
| 更新ログ | 91件（既存87件を全件保持し4件追加）。全文検索＋種類＋記録日（JST）の絞り込み。IDは小さな注記だけ |
| 用語集 | 53語。名前・略語・説明検索、分類フィルタ、参照資料 |

本文の専門語はページ内の初出に `ⓘ` を付け、クリック／キーボードで説明を開きます。Escapeで閉じ、元のボタンへフォーカスを戻します。図表の原語・署名のAstra表記は保存し、現担当はCodexで統一しています。

システムフォント、明示したライト背景、青1色＋状態色を使用。状態には記号と文字を併記します。スマホは16pxの左右余白、表はラベル付き縦並びに切り替えます。動きを減らすOS設定に対応し、印刷用CSSはありません。

## 編集するデータ

事実の更新は `<!-- BEGIN data-… -->` と `<!-- END data-… -->` の間で行います。レイアウト修正はCSS/rendererも対象とし、事実の定数をrendererへ転記しません。`ui.schema_version` は `"2"`。既存12ブロックを保持し、`ui` と `glossary` を追加した14ブロック構成です。

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
3. 計画や新しい引継ぎの原表をMASTERへ反映する。現在はrevision 12、最新値は§1.7/5、夜間会計は§7.1、連続稼働は§8、用語はAppendix B。revision 6の既決契約を維持する。ロードマップの期間や最大3回という上限は開始を許可するものではない。
4. `status.as_of` と `last_update` を更新する。時刻はJSTで取得する。測定開始／完了時刻へ更新時刻を代入しない。
5. 下記の軽量検査を実行し、未検証の境界を引き継ぐ。commitは今回の依頼では行わない。

JSTは `TZ=Asia/Tokyo date '+%Y-%m-%dT%H:%M:%S%z'`、またはPython `ZoneInfo('Asia/Tokyo')` で取得します。保存形式は秒付き `YYYY-MM-DDTHH:mm:ss+09:00`。日付は `YYYY-MM-DD`。Macの現地時刻（UTC+8）をJSTとして保存しません。

IDは全ブロックで一意。progressは `done/running/pending/failed/blocked`、担当は `human/Claude/Codex`。署名の原記録にあるAstraは改名しません。出所は既存ファイルに限り、絶対path・`..`・外部URL・symlink・`upstream-eval`・生の測定出力・秘密への参照を入れません。

ログは追記のみ。訂正は新しい `誤り` エントリにし、時刻を降順に保ちます。既存87件を全件・全フィールド保持し、rev 12ではmix2結果・48世界集計・提出基盤の推奨・incz開始見込み訂正の4件を追加しました。rev 10/11の結果待ちは当時の履歴として残します。旧60件/65件/rev 7の68件/rev 8の73件/rev 9の78件/rev 10の84件/rev 11の87件のdigestをすべて検査します。既存20判断レコード（rev 10の未決提案を含む）も全フィールド不変です。本文は該当節へ統合し、末尾の追補で現況を上書きしません。原時刻が不明なら記録時刻と `time_basis` を明示し、出来事の時刻を作りません。dev3aの17:39 JSTは本人提示の分精度で、ISO形式の秒00は保存表現です。

## 現在の証拠・計画境界

- dev2-xb-rはmeasured引継ぎ。F_ref、31001/31002、6レジーム12世界、G0 PASS。平均P 149.0/1352.2、平均取引数44.8/300.9、診断平均T44.36/56.84。全世界P−noop正・最小+147.7、noop割れ／違反／revertは0。原表の細かい桁は `DEV2-XB-R-REPAIR.md` の別表を維持。資格合格にはしない。
- a646e9bの123テスト・赤対照25件は既存の検査記録の引継ぎ。今回の再実行結果ではない。
- dev3a-xb-rはF_ref、35001/35002、9レジーム18世界、10/4 16:24 JST開始・17:39 JST完了（分精度の本人引継ぎ）。G0 PASS、P−noop全正、noop割れ/違反/revert0、submit_failed27/submitted980。平均Pは842.3/2032.9/1050.3、取引54.4/288.7/61.3（cand/multi/clean）、平均T46.83対55.93。最小P−noopは未提示。dev3b（残り3レジーム）はrev 7時点の未確認履歴として保持。v3実装・凍結とdev4結果は最新引継ぎで更新。全12平均やv2の因果効果へ外挿しない。旧D対照35001/35002案は失効。
- dev4（v3 d30cbbb）は本人提示measured引継ぎ。F_ref・36001/36002・12レジーム24世界・G0 PASS・362ループ。12レジーム等重み平均T49.72/55.02（差5.3T）、全12平均(T−Tnoop)>0・最小+7.85、noop割れ/violations/cand revert0。submitted1652/failed23（1.4%、23/1675の丸め）。1世界平均P488.2/1460.8/440.0、取引68.8/273.4/46.3（cand/multi/clean）。全12レジーム別TはMASTER §1.7とHTML原表で照合。
- v5はv3+R9 ON、7b1448b・183テスト/赤対照59は既存引継ぎ。dev5のF_ref・同seed36001/36002・12レジーム24世界は平均T50.15対55.73、v5昇格せず基準はv3。2/3回目。完了時刻/完了数/G0/安全内訳は未提示のまま。独立screen/Q0へ使わない。
- Codex(Astra)主・Claude副・agy補助、Grokは402で離脱。agy（Gemini 3.8 Flash High、masa-harness#409）は「ツール使用禁止・差分埋め込み・`echo "" | …`」。差分はプロンプト内、空stdinで入力待ちを避ける。今回は外部照会/別エージェント起動なし。
- PLATEAU-ANALYSIS（構造の異なる独自設計候補の検討）はAstraが別ジョブで作成中、結果未確認。新規候補の採用や追加計測予算を承認したものではない。
- [本人決定 2026-10-04] H1「検査済み方針の選択+ENTRY」を選択、全面executorTs改訂は見送り。決定論の改良で大きな改善が見込めないなら推論あり等の大きな改善仮説へ切替える方針。旧rev 6の署名・初期60契約は原記録のまま保持し、H1の初期/復帰50と区別。
- xb-r-ai a95054aは3方針・ENTRY20–60/5bps/±5・初期50・120block復帰、213テスト/赤対照25のmeasured・コード確認引継ぎ。標準runtimeはdecide全体を置換し、固定テンプレ限定/エージェント内検証とも安全境界は成立せずON拒否。専用adapterは未実装。運営受付が必要で、提出物のruntime改変はVENDORED BLOCK。本番は事実上プロンプト誘導・安全保証なし。
- agy GPT-OSS 120B（Medium・無料枠・本番と同系統）はsparse/selection/injection各1回、validator ok=true、sparse/injectionは期待どおりnull。selectionは答えを指定した形式確認で能力評価ではない。runtime/haiku/性能へ外挿しない。
- 課金なし・claude-cli:haiku、v3初期コード/prompt v2のxb-r-liveはH1と別系統。F_ref・calm/whale/crash/depeg-persist×39001/39002、OFF1+ON3=32世界・全群G0 PASS/安全OK。OFF54.74、ON48.91/52.80/53.62、全反復dT>0を満たさずPILOT-STOP。全反復のdAlpha/worst/installed/declined/rejectedをMASTER §5と正本JSONに保持。校正39101/v1はcompile failed/installed0、39102/v2はinstalled1（WBTC slippage80→100bps、安全節違反・sim内のみ）。WBTC16取引の固定価格損益+63.34 USDCは除外理由を支持しない。
- xa-1は7179efe→6cd9e70→3ad4f60。dev6 G0 BLOCKED（round無し+停止）→修理1→dev7（提出18・回収264/362）→修理2→xas2（calm/38005、G0 PASS、提出10<30・回収4/710、violations0/revert0）。HEALTHY=no、2回修理後も不健全で第3回打ち切り。決定論ラインはQ0のF_ref平均T≥multiに未達。契約を緩めず本人報告。
- `plan.continuous_operation`の60秒以下監視/2分検知/5分受領/10分次着手、150分目標/180分上限、最大3回、fresh全12×2と費用条件は不変。夜間は8分heartbeatと`/tmp/night-state.md`で進行管理との本人引継ぎ。監視30分失効を各heartbeatで確認/更新し、失効なら新規起動停止。8分heartbeatは60秒監視の代替ではなく、実稼働は未再検証。
- Q0/Q0bの旧不合格・Q0bの2世界G0 FAIL・安全nullスナップショットを保持。救済再走なし。新Q0は1候補1回60世界・41301–41305・5h上限。ゲートやrevert上限の緩和なし。
- 委任済み6決定と旧H1/全面改訂判断を含む既存19レコード・署名を保持。KEY/金銭への委任拡張なし。dec-008 resolved、dec-007は10/28 open。現本人判断はQ0の扱いと提出方針（10/31 23:59 JST締切、受理済み版未確保）。朝報告に3選択肢・A推奨・反証条件を記す。契約変更は未決定。
- mix1は本人提示measured引継ぎ。u1の11体、zeta-2をcand=xb-r v3凍結（xb-r-liveのagent.ts=d30cbbbとバイト同一との報告）に置換。12×40001/40002=24世界、p=3。G0は23 PASS/1 BLOCKED（crash/40001、grok-1 telemetry、cand原因ではない）、全24世界を診断として保持。violations 0。平均T52.18・5/11位、worst regime T47.6は全員で最良。multi-arbは36.73で最下位。全11体順位とcand全12レジーム値をMASTER原表/JSONの厳密期待値で照合。約2.8Tの首位差や既存候補との非有意の見立てはinferredで、統計検定結果ではない。資格/旧Q0m/提出可否へ転用しない。
- [measured] mix2はmix1と同じroster（u1の11体、zeta-2をcand=xb-r v3凍結に置換）。fresh seed40003/40004・12レジーム24世界、mix2a/mix2bともG0 PASS、violations 0。candは平均T51.63・6位・最悪46.2、inc-zetaは61.54・1位・最悪53.2。05:34 JST開始の引継ぎを保持し、実完了時刻は未提示。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。
- [measured] mix1/mix2でseedを替えても順位は概ね安定（inc-zeta 1位・venue-arb 2位・multi-arb 11位）。mix1+mix2は12レジーム等重み・seed40001–40004の48世界。inc-zetaは平均T58.26、2位53.71との差は約4.5T（表示値の差4.55T）、最悪レジームT46.8。観測した混成場では明確な最強。cand(xb-r v3)は平均T51.91・5位・最悪47.6で、sonnet-1/grok-1/opus-1と約1T以内（表示値ではsonnet-1との差1.01T、grok-1との差0.89T、opus-1との差0.03T）。 mix1のcrash/40001（grok-1 telemetry）BLOCKEDを保持し、PASSへ変更しない。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。
- [inferred] xb-r v3とsonnet-1/grok-1/opus-1はこの集計では区別できないとの見立てで、統計検定の結果ではない。決定論ラインxb-rの追加改良より、混成場で強い既存の独自戦略inc-zeta=zeta-a30（Claude+Codex作成の本命）を提出基盤にする案が示唆される。ただしinc-zetaはF_ref契約(Q0)未通過。D0のF_ref診断はcommit不一致でG0 FAIL、性能は診断のみ。
- [進行中・診断] inczはinc-zetaをF_refで12レジーム×seed40005=12世界。10/5 07:20 JST頃開始との本人引継ぎ（旧05:40頃開始見込みを訂正）、約55分・08:15 JST頃完了見込み。走行中・結果未確認・結果待ち。G0・完了数・完了時刻・性能・安全内訳は未確認。結果追記欄: 未受領。経過時間で完了としない。契約・資格とは無関係の診断。資格合格・旧Q0mの代用・提出可否の判断に使わず、Q0契約は変更しない。 `status.incz.result`・G0・完了数・完了時刻はnull。後続引継ぎ時に本文・JSON・厳密期待値/反例を同時更新する。
- 推奨はA: 混成場で強いinc-zetaを提出基盤の第一候補とし、Q0（F_ref・対multi-arb）をどう扱うかは本人判断。契約変更は提案のみ。Q0維持・追加起動停止のまま、走行中inczの結果受領と時間精算・受理工程の再計画を行う。 選択肢と反証条件は朝報告とMASTER §10。
- 本番gpt-oss:120bがHaikuより弱い可能性が高いという見立ては推測。標準runtimeでは安全枠を強制できず提出物はruntime改変不可。H1 ON拒否を維持。
- OVERNIGHT §2.3会計: 00:26以降xa smoke13×2＋live smoke13×2＋live本体150＝概算202分、rev 10時点のmix1約150分見込み込み352分。mix1結果受領後も確定時間は不明で、mix2/inczはこの旧見積に含まない。非重複仮定の単純和で、確定区間和集合ではない。修理/検査/非run・当日/forward消費・残予約は不明。C_forward + R_remaining + N_next ≤ 100h、同一区間のC/R二重計上禁止を維持し、不明なら追加起動不可。
- KEEP配分は100h、G3 17.2h・deep 9.7h（Q0 5h優先）・M2 0h。旧AMENDも100hの履歴として保存。全費用未確保を実行許可や残り時間へ読み替えない。10/17 18:00の分岐、10/31 23:59 JST締切を保持。

## 検査

repo rootから、依存のインストールなしで実行します。Python標準ライブラリとNode組込み機能のみです。

```sh
python3 -B ascon-notes/league/check-plan-consistency.py --self-check
node ascon-notes/league/dashboard-ui-check.mjs --dump /tmp/ascon-rendered-pages.json
python3 -B ascon-notes/league/dashboard-check.py --self-check --rendered /tmp/ascon-rendered-pages.json
git diff --check
```

`dashboard-check.py` はJSON重複キー・有限数・一意ID・JST・日付・ログ降順・出所の実在と安全・元表一致・正確な分数和・担当／状態／依存・HTML構造を検査します。追加で8ページ、KPI／比較の参照、53語と必須語、外部CSS／ネットワーク呼出しの禁止を確認します。`--rendered` はNodeで生成した各画面のタグ、ID、出典リンクとID露出を検査します。

`check-plan-consistency.py` は旧表、全28日、18件のレビュー判断、予算・署名・Q0・AI反復・切替条件の照合を維持し、87ログの完全保持と既存20判断レコードの不変性、dev2/dev3a/dev4/dev5/xa-1/liveの正確な提示値、dev3b/PLATEAUの未確認履歴、mix1の全測定値とG0例外、mix2/48世界の全順位・提示値、inczの結果待ち、実消化のnull、表示比較の母集団と数値参照、連続稼働の上限・独立seed・screenも検査します。

`dashboard-ui-check.mjs` は実際のインラインJSを小さなDOMアダプターで実行します。8ページ＋資格ビューの生成、検索／複合フィルタ、空結果、ハッシュ遷移、用語の開閉とEscape、エスケープ、JSON変更の表示反映、主要文字色のAA比とレスポンシブ指定を検査します。DOMアダプターはブラウザではなく、レイアウトの検証にはなりません。

**rev 7のチェッカー変更理由（履歴）**: dev3a未確認という旧固定条件が今回の本人提示集計と衝突するため、提示値・18世界・G0・17:39分精度・資格不可を厳密一致で検査し、未確認項目の拒否はdev3b/v3へ維持・拡張した。旧60件/65件のdigest、全既決契約、予算、旧安全nullの検査は保持。監視稼働済み化、診断閾値緩和、回数増加、既見seedの流用を拒否する反例を追加した。UI検査には概要だけのKPI4枚、比較表の先頭配置、最新数値、375pxのCSS構造確認を追加。合否閾値・費用・反復回数は緩めていない。

**rev 8のチェッカー変更理由（履歴）**: rev 7の「v3実装中・dev3bが現在の計測」という固定条件を、本人提示のv3凍結hash・dev4実測とdev5走行中へ置き換えた。dev4の全提示値・12レジーム表、dev5の既見seed/開始/翌日見込み/未確認結果、v5検査記録、体制/別ジョブ、2/3回目を厳密一致で検査する。旧68ログのdigestと旧契約・全既存反例を保持し、反例は76から128件へ増加。UIはdev5の現在表示とdev4の安全集計に対応し、KPIの概要限定も維持。閾値・費用・反復上限は緩めていない。

**rev 9のチェッカー更新（履歴）**: 旧版番号と「現在の本人作業なし」の固定条件を、H1本人決定/全面改訂未許可の厳密一致へ更新。旧128反例を保持し、H1権限・安全境界・ON拒否・adapter未実装・agyの外挿禁止・xa-1未計測・課金なし・次分岐の52反例を追加して180件とした。旧73ログと既存判断全件のdigestを追加し、UIは78ログと現行H1/分岐の表示検査を追加。既決の閾値・費用・反復上限を緩めず、旧ENTRY単独契約も検査対象に保持。

**rev 10のチェッカー更新（履歴）**: dev5/xa-1未測定という古い固定条件を今回の提示値と停止判断へ置換し、mix1には未確認の厳密検査を維持する。旧180反例を保持し、live全反復/安全節違反/モデル比較は推測/mix1結果待ち/時間会計/本人判断/朝報告の66反例を追加、計246件。旧78ログ・既存19判断のdigestと全契約検査を保持。Nodeは29項目、表示の現在runをJSON参照へ変更。閾値・反復上限・予算の緩和なし。

**rev 11のチェッカー更新（履歴）**: mix1未確認の固定値を今回の提示集計との厳密一致に置換し、mix2に未確認の境界を設ける。旧246反例を維持し、mix1完了数の反例は24世界から23世界への欠落を拒否する形に更新。G0例外のPASS化/原因すり替え、11体全順位・T・worst、12レジーム全値、mix2結果捏造/fresh seed流用/資格昇格、84ログ/20判断の改変を拒否する反例を追加し344件。Q0/予算/署名/失敗上限の検査は不変。UIは87ログとmix2時刻・mix1表示値を厳密検査。HTMLのCSS/rendererと戦略実装は変更しない。

**rev 12のチェッカー更新**: mix2結果待ちの旧固定値を全11体の提示値・24世界・両chunk G0 PASS・violations 0との厳密一致へ更新。48世界全11体と朝報告原表の照合、inczの07:20 JST頃開始/08:15頃見込み/12世界/結果null、既存87ログのdigestを追加。旧344反例の意図を保持し、確定したmix2を未確認へ戻す改変も拒否する。102反例を加え446件、UIは31項目・91ログ。Q0/予算/署名/回数上限を緩めず、20判断レコードは不変。CSS/renderer・戦略実装は変更しない。

## 省いた表示と保存先

削除した事実・ログ・測定表はありません。以下の表示上の重複を整理しました。

- 同じ結果の繰り返し図表：MASTER §1に保持し、進捗・結果の比較と原表に集約。
- 予算配分・AI契約の重複説明：MASTER §5–7に保持し、判断・予算の詳細へ集約。
- トップにあった内部手順・過去の細かな経緯：MASTER §8–11と全ログを保持し、原表・履歴の折りたたみへ移動。

## 今回の検証範囲

静的検査・Nodeの画面ロジック検査は実行済み。375pxを対象に、左右余白、長語の折返し、flex/grid子の最小幅0、見出しの折返し、表の縦配置、フォーム/ポップアップの幅制限を検査しました。overflowを隠す処理で代用していません。ブラウザ／ヘッドレスChrome／描画エンジンは起動せず、実際の横スクロール量・見た目・支援技術・実ブラウザ操作は未検証です。

incz走行中の重い処理禁止を優先し、依存を読む `npm run typecheck`、戦略テスト、Docker、backtestは今回未実行です。xb-r/xa-1/xb-r-ai/xb-r-liveの実装・テスト、保護領域・鍵・`.env`・実行中計測へアクセスせず、型検査済みとは報告しません。新規計測・外部サービス照会・commitも行っていません。

最終確認結果（ブラウザ未起動）:

```text
PASS dashboard-check: 14 blocks / 91 logs / 19 source tables / 53 terms
PASS checker controls: 23 invalid cases rejected
PASS check-plan-consistency: rev 12 facts + operations + unchanged contracts + all 87 prior logs / 20 decisions
PASS plan controls: 446 unsafe/stale mutations rejected
PASS dashboard UI: 31 checks / 8 pages + qualification view / 375px static containment
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
