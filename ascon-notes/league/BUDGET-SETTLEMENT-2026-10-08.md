# 2026-10-08 測定・開発100時間予算の暫定精算

## 結論と対象

**100時間の正確な消化・残量はUNKNOWN（証拠不足）。** Mac mini（以下mini）の開始・終了が整合する完了区間は **28.286964時間**。MacBook Air（以下Air）は終了マーカーの時刻が世界開始時刻と矛盾するため、完了占有時間を確定できない。Airの既知の区間は、3回の起動（`e2r`、`e2r3`、`e2r4`）それぞれの「最初の世界開始から最後の世界開始まで」の和で **1.940051時間**ある（起動をまたぐ単一の最初〜最後の区間は約2.870時間であり、その値ではない）。この途中までの区間を加えた **30.227015時間**は復元区間の小計であり、総消化ではない。占有区間方式での差額 **69.772985時間 − 未復元費用**も、自由に使える残予算ではない。数値は付録の `TOTAL_STRICT`、`AIR_FIRST_TO_LAST_START_SPANS`、`KNOWN_SPAN_SUBTOTAL` に対応する。

起算は **2026-10-04 01:00 日本標準時（JST、協定世界時UTC＋9時間）**、締切は **2026-10-31 23:59 JST**。境界前の使用を今回の100時間から差し引かない。日付だけで10/4午前0時に変更もしない（`MASTER-PLAN-2026-10-04.md:610-612`、`SCHEDULE-2026-10-08.md:50,63`）。本書のリポジトリ相対パスは、特記しない限り `ascon-notes/league/` を基点とする。`.scratch-data/` はリポジトリ直下の提供資料。

調査対象はブランチ `docs/budget-settlement-2026-10-08`、HEADとorigin/mainはいずれも `e24cafec5197dfe80f6b464086375154caeaa864`（`git rev-parse HEAD origin/main` で確認）。提供コピーだけを読み、ホスト接続・現状確認・追加測定はしていない。後述の「稼働中」はコピー内の状態であって現在のプロセス確認ではない。

## 何を数える100時間か

| 出典 | 数えるもの・粒度 | 今回の扱い |
|---|---|---|
| `PLAN-MASA-ASCON-V2.md:130-145` | Air占有を中心とする計画。並列度p＝3で世界数をバッチへ切り上げて見積もる。失敗・再走・推論待ち・ローカル検査を含む。人間／クラウドモデルの作業時間と推論API（Application Programming Interface）課金は別会計 | **大会互換の成功シミュレーションだけでも、モデル呼び出し時間だけでもない。** ホストを専有する待機・検査も対象。世界やモデル数の単純な時間和ではない |
| 同`:136-145` と `MASTER-PLAN-2026-10-04.md:595-612,627-644` | 旧案は「既消費＋G0（測定健全性の検査）6h」を暫定充当し過去分の照合を求める。更新後は境界前の18.6hを枠外、10/4以後のforward枠とする | 起算の差は明記して更新後の契約を使う。18.6h、夜間概算、予約を重複加算しない。旧6hを実測値と見なさない |
| `GROK-REVIEW-MASTER-PLAN.md:19-22` | 既消費C_used未確定、改訂を有効にした場合の所要時間未校正を指摘 | 計画の合計が100hでも残量の証明にはならない |
| `SCHEDULE-2026-10-08.md:63-65,120,169`、`RETROSPECTIVE-FULL-2026-10-07.md:257-263` | 経過時間、host-hours（各ホストの占有時間の合計）、算入時間を分ける。同一ホストの並列3実行を3倍しない。2台同時使用は両方算入。通常6h/日を2台で12hへ増やさない | 本書もホストごとに区間和集合を取り、その後に加算。消化C＋残予約R＋次工程N≦100h、予約から実行への振替で二重計上しない |
| `g3/budget.json:1-25` | G3（実行中の改訂の検証）用の未検証見積。基本9.966667h、準備監査込み留保14–15h、倍率1.2、日次6h、chunk（連続実行を区切った単位）110分、直列1 | 計画値であって消化台帳ではない |
| `g3/chain/chain.py:217-243,299-309,358-401`、`g3/chain/README.md:55-69` | `$HOME/.ascon-g3/budget-ledger.json` に起動時、最大110分・残日次枠・現地日付の午前0時までの最小値を秒単位で先取り。早期失敗も全予約秒を課金し返却しない。監査込みの期限。台帳はこのlauncherのみ対象 | **実際の経過秒の精算と異なる。** ホスト現地日付でありJST固定でもない。コードには全期間100h・2台合算の制御はない。実台帳は未提供なのでこの予約会計の消化はUNKNOWN。E系ログをこのlauncherの予約と同一視しない |
| `ledger.py:94-119`、`ledger.md:5-7` | 結果・設定・hash（内容の識別値）の台帳。datetimeは追記時刻。G0非PASSは通常追記拒否 | 開始／終了、ホスト占有時間の台帳ではなく、失敗費用も網羅しない |

したがって本書は、(A) 失敗を含む占有区間方式と、(B) 成功測定だけを数えると解釈した場合のPASS区間参考値を併記する。Bは現行契約の代替ではなく、G0 PASSだけで大会互換・正式資格を認定した値でもない。真のシミュレータ稼働秒、監査、sleep（休止）、idle（非稼働）を分離した値はUNKNOWN。**占有区間の中にidleがあれば、区間長は純粋な測定時間の上限**になる。一方、記録のない実行・検査があるので、記載済み区間の小計を総費用の上限にはできない。

## 復元方法と日次表

標準ライブラリだけの `remote/budget_hours.py` が読み取り専用で集計する。再現コマンドはリポジトリ直下から次のとおり。

```sh
python3 -B ascon-notes/league/remote/budget_hours.py .scratch-data
```

- TSV（タブ区切り）indexのrun_dirをUTC開始時刻としてJSTへ変換する。同じrun_dirを含む結合index／分割indexは一度だけ数え、内容が矛盾すれば停止する。
- 起動単位の最初の世界開始から終了マーカーまでを占有区間とする。途中chunkの終了時刻はないため、次chunkの最初の世界開始を暫定境界にする。監査・内部idleはこの区間に含まれるが内訳はUNKNOWN。
- Q-ZETA-02（資格測定）とP60（公開60世界のリハーサル）はJST明記のchainログのbegin〜doneを使う。対応qb/pbログは同じ実行なので追加加算しない。世界開始indexがないため、この2実験の始点は世界開始ではなくchunk開始である。
- prefixのUTCらしい文字列は開始証明に使わない。E8とE9は同じprefix時刻を持つ。E9をE8と同時起動したと仮定しない。起算境界で切り、ホストごとに区間を併合しJST午前0時で分割する。

下表の「0*」は復元区間がないという意味で、実消化ゼロではない。数値は付録の `CLASSIFIED_MINI_DAILY`、`DAILY_STRICT_COMPLETE_ENVELOPES` に対応。

| JST日 | mini PASS区間 h | mini preserved-FAIL区間 h | mini BLOCKED区間 h | mini 復元完了小計 h | Air | 未復元事項 |
|---|---:|---:|---:|---:|---|---|
| 10/4（01:00以後） | 0* | 0* | 0* | 0* | UNKNOWN | 夜間D0（初期診断）・Q0（初回資格）等、境界またぎの実区間なし |
| 10/5 | 0* | 0* | 0* | 0* | UNKNOWN | Air夜間queue、開発smoke、改訂実験、混成場等の原区間なし |
| 10/6 | 8.780556 | 0* | 0* | 8.780556 | UNKNOWN | miniの準備・probe、MGS時刻帯、Airの既存測定等 |
| 10/7 | 7.691893 | 1.387055 | 1.391043 | 10.469991 | E2既知開始間1.940051h、末尾等UNKNOWN | E3初回失敗、Airのr3ctl/r3x、E2失敗・中断と終了矛盾 |
| 10/8 | 4.137427 | 4.898990 | 0* | 9.036417 | UNKNOWN | E9進行中、E10待ち、記録のない非run占有 |
| 合計 | **20.609876** | **6.286045** | **1.391043** | **28.286964** | **UNKNOWN** | 全量の精算未成立 |

通常日次枠との照合でもminiの記録済み区間が6hを超える日がある。ただしこれは計画枠との比較であり、G3 launcherの実台帳から超過を確認したわけではない。

## 実験ごとの占有区間、失敗、再起動

時刻はすべてJST、表は読みやすさのため秒へ丸めた表示。計算には付録のミリ秒を用いた。hは時間。E番号は提供ログ上の実験識別子であり、旧計画の同名探索段階と混同しない。

| host・実験／起動 | 最初の世界開始〜終了（JST） | h | 状態／根拠 |
|---|---|---:|---|
| mini Q-ZETA-02 | 10/6 02:02:38〜06:25:29（chunk開始） | 4.380833 | 全chunk PASS。`mini-logs/chain-qz2.log:2-9` |
| mini 最初のP60 | 10/6 18:35:49〜22:59:48（chunk開始） | 4.399722 | 全chunk PASS。`mini-logs/chain-p60.log:2-9` |
| mini E1 | 10/7 12:40:39〜15:27:30 | 2.780966 | c1 preserved-FAIL（失敗結果を保持）、c2–4 PASS |
| mini E3 初回 | UNKNOWN〜10/7 15:38:48 | UNKNOWN | c1 runner失敗、indexなし。prefix時刻との差を実測としない |
| mini E3 再起動e3b | 10/7 15:39:30〜18:26:26 | 2.782295 | c3 preserved-FAIL、他PASS。初回失敗費用は別に未精算 |
| mini E4 前半 | 10/7 18:37:40〜20:01:16 | 1.393319 | c1 PASS、c2 BLOCKED（欠測等で判定不能） |
| mini E4 後半e4bb | 10/7 20:02:38〜21:26:08 | 1.391748 | c3–4 PASS。c2を再走したものではない |
| mini E5 前半 | 10/7 21:48:31〜23:11:47 | 1.387685 | c1 PASS、c2 BLOCKED |
| mini E5 後半e5bb | 10/7 23:15:58〜10/8 00:39:33 | 1.393145 | c3–4 PASS。日付で分割して集計 |
| mini E6 | 10/8 00:42:33〜03:30:34 | 2.800306 | c2のみPASS、c1/3/4 preserved-FAIL |
| mini E7 | 10/8 03:31:25〜06:18:25 | 2.783351 | c3 preserved-FAIL、他PASS |
| mini E8 | 10/8 10:59:31〜13:47:08 | 2.793593 | c1のみPASS、c2–4 preserved-FAIL |
| Air E2 初回e2r | 10/7 12:41:15〜UNKNOWN | UNKNOWN | c1 PASS、c2 preserved-FAIL、c3 runner失敗で停止 |
| Air E2 再起動e2r3 | 10/7 14:12:04〜UNKNOWN | UNKNOWN | c3 PASS、c4は終了結果なし、SIGTERM（終了シグナル）で中断 |
| Air E2 再起動e2r4 | 10/7 15:06:59〜UNKNOWN | UNKNOWN | c4再実行、preserved-FAIL |

E系の各index行・chainログ行・marker行は付録のCHUNKSおよびLAUNCHに列挙する。Airのindexは完了したc1〜4を収録するが、初回c3失敗／中断したc4のrun_dirを含まない。これらの費用を成功した再起動で置換して消してはいけない（`.scratch-data/air-logs/e2-chain.log:28-36`、`e2b-chain.log:20-24`、`e2c-chain.log:4,16-19`）。

E4前後の空白は **0.022697h**、E5前後は **0.069633h**、合計 **0.092330h**。占有継続なら費用、ホスト解放なら除外であり、真のidleとは断定できない。この空白を含む「実験全体の包絡区間」方式ではmini小計は **28.379294h**になる（付録 `RELAUNCH_GAPS`）。その他の起動間の空白は付録 `GAPS_BETWEEN_INDEXED_MINI_LAUNCHES` に全件列挙。特にE7→E8の **4.685018h**を測定時間へ自動加算しない。E1→E3bの空白にはE3初回失敗が入るので、全体をidleとしてもいけない。連続chunk内部の監査／idleは時刻ログ不足で分離不能。

## Airの終了時刻矛盾と感度計算

`.scratch-data/air-chain-log-dirs.txt:1-3` を指定どおりJSTとして読むと、次の矛盾がある。転記ファイル自身のmtimeを測定終了時刻の代わりには使わない。

| E2起動 | 最後に記録された世界開始JST | 終了マーカー（JST指定） | 判定 |
|---|---|---|---|
| e2r | 10/7 13:45:23.934 | 10/7 13:10:55 | 最終開始より前 |
| e2r3 | 10/7 14:37:51.517 | 10/7 13:57:31 | 最初の開始よりも前 |
| e2r4 | 10/7 15:33:27.406 | 10/7 14:46:40 | 最初の開始よりも前 |

**仮説としてだけ**全Airマーカーへ1時間加えると、E2の起動区間和は **2.913147h**、miniと合わせ **31.200110h**、差額は **68.799890h − 未復元費用**となる。E4/E5の空白も占有とするなら合計 **31.292440h**、差額 **68.707560h − 未復元費用**。付録 `AIR_MARKER_PLUS_1H_HYPOTHESIS` と `RELAUNCH_GAPS` が計算根拠。これは現地時刻がUTC＋8だった可能性などを検討する感度計算で、タイムゾーン誤りの原因確認・訂正ではない。

Airのr3ctl/r3xも終了マーカーしかない（同`:4-5`）。両方のprefix時刻は同じであり、実開始indexがない。こちらにはこの仮説を使っても個々の占有時間は作れない。

## 数え方別の合計と残予算

| 数え方 | 復元できた額 | 100hとの差額・意味 |
|---|---|---|
| A：失敗／BLOCKEDも含む、完了起動の占有区間 | mini 28.286964h、Air UNKNOWN | miniだけを引いた71.713036hは残予算ではない |
| Aの途中まで分かるAir開始間も算入 | 両host小計30.227015h | 69.772985h − 未復元占有費用。正確なC（消化）、R（残予約）、利用可能残量はUNKNOWN |
| AのAirマーカー＋1h仮説 | 小計31.200110h | 68.799890h − 未復元費用。仮説であるため正式精算不可 |
| Aの同仮説＋E4/E5の空白も占有 | 小計31.292440h | 68.707560h − 未復元費用。空白を除く場合との差を明示 |
| B：G0 PASS区間だけの参考集計 | mini 20.609876h、Air UNKNOWN | 失敗・監査等を算入する契約には使えない。大会互換の成功シミュレーション実時間もUNKNOWN |
| G3 launcherの予約秒会計 | UNKNOWN | 永続budget-ledger未提供。消化を起動chunk数×110分で推測しない |

未復元費用には、初期Air実験、mini準備、E3失敗、E9の既消化、非run占有等がある。BのPASS区間にも内部待機が残るため、Bを正確な純測定時間と表示しない。暦の残時間と予算の残時間は別である。最新の整合する終了証拠 **10/8 13:47:08 JST**から指定締切までは **562.197778暦時間**（付録 `CALENDAR`）。これはコピー取得時刻や現在時刻からの残時間ではなく、2台分の予算を増やす値でもない。

## 進行中・待機中と推計

- **E9：mini、r3、新しいseed（乱数系列の識別値）での対照測定。** ログはc1〜3の結果がPASS、c4の実行コマンドまでで、終了マーカーがない（`.scratch-data/mini-logs/e9-chain.log:22,33,44,48-51`、`mini-chain-log-dirs.txt:11`）。index・chunk時刻・コピー取得時刻がないため、既消化とコピー時点の残時間はUNKNOWN。E8と同じprefix時刻を開始時刻として流用しない。
- E系miniの実測包絡区間28chunk（各9世界）の最小／中央値／最大は **0.692789／0.696212／0.701322h**。同程度ならE9全4chunkは **2.771154〜2.805288h**、中央値換算 **2.784847h**。最後のchunkの開始から終了まで約 **0.701322h**という最大観測値ベースの推計はできるが、保証上限ではない。途中までの実消化と全体見積を二重計上しない（付録 `ESTIMATE`）。
- **E10：mini、F_ref（固定参照対戦相手構成）のr3c、60世界、収集時の付帯情報では待機中。** `.scratch-data/mini-logs/e10-waiter.log` は空で、開始・queue登録・完了はコピーから独立確認できない。E10 chain/indexも提供なし。「0h消化を確認」ではなく「開始証拠なし」。
- 同じ並列度・分割・負荷を仮定すると、最初のP60実績 **4.399722h**がE10の参考。4chunk×P60の実測最小／最大では **4.390000〜4.412222h**。起動準備・追加監査・再試行を含まない推計で、将来の正式予約ではない。所要時間増加の可能性を、この観測範囲で打ち切らない。

## 未復元区間と台帳の不足

| 記録 | 分かること | 不足・会計上の扱い |
|---|---|---|
| `.scratch-data/ledger.jsonl:1`、リポジトリ`ledger.jsonl:1`、`ledger.md:7` | いずれもleague-r1、記帳datetimeは2026-10-03T08:19:52.818611+00:00、1行のみ | 起算後のAir夜間queueを復元する行がない。datetimeは実行開始／終了ではない。10/4以後の費用へ加算しない |
| `MASTER-PLAN-2026-10-04.md:595-620` | D0／sonnet Q0／opus Q0b（別候補資格）、10/5のxa-1 smoke、live smoke／本計測、mix1/mix2（混成場）、incz（参照候補）の概算記述 | 開始終了区間・境界・重複が不明。旧18.6h、457分、RETROの約15hを新たな実測として足さない（`RETROSPECTIVE-FULL-2026-10-07.md:259-263`） |
| `.scratch-data/mini-logs/mgs.log:1-6` | MGS（ログ識別子mgs-smoke）のbegin〜QUEUE DONEは01:46:35〜01:59:47、差分0.220000h | 時刻帯の明記なし。JST仮定なら10/6、mini小計28.506964h。主表からは分離。付録 `MGS_TIMEZONE_UNLABELLED` |
| `mini-logs/mini-g0-probe1.log:1-9`、probe2/3の同箇所、`mini-g0-probe4.log:9-13` | 前3probeは失敗、probe4は世界別duration_secondsを記録 | 開始／終了indexなし。並列世界のduration単純和をhost-hoursにしない。起算後か、どの区間に重なるかUNKNOWN |
| `mini-logs/brew-foundry.log:199-341`、`build-contracts.log:1-6`、`p60-npmci.log:1-12` | ソフトウェア導入・ビルド等の所要表示が一部ある | 記録日・占有開始終了・重複がない。導入の全経過時間はUNKNOWN。ホスト占有検査／準備なら契約対象になり得るが今は日次加算不能 |
| `air-chain-log-dirs.txt:4-5` | r3ctl／r3xの終了値だけ | 開始index・実行／再起動関係・時刻帯不整合。UNKNOWN |
| 空のe7-waiter/e89-chain/e10-waiter/mgs-wrapperログ | 内容なし | 稼働ゼロ、待ちゼロの証拠ではない |

正しい精算に必要な追記項目は、ホスト識別子、UTCの起動・最初の世界・各世界終了・chunk終了・ホスト解放、現地UTCオフセット、並列度、run_dir／実験／試行／再起動の対応、PASS／FAIL／BLOCKED／中断、sleep・idle・監査・非run検査の区間、予約と実消化の振替、取消・持越し、コピー取得時刻、原証拠の識別値である。世界数や性能値の台帳と時間台帳を関連付け、同一ホスト内の重複を除き、複数ホストは加算する必要がある。

現`ledger.py:106-119`にはこれらの時間・ホスト欄がなく、`:108`は記帳時刻である。`:94-99`は通常G0非PASSや順位なしを拒否するため、費用台帳としては失敗を取りこぼす。永続G3予算台帳もlauncher外の作業を網羅しない（`g3/chain/README.md:59-69`）。本作業ではいずれの台帳も変更していない。

## 検証

- `python3 -B -m unittest`（`ascon-notes/league/remote`）：既存と新規を合わせ102件PASS。新規6件は手計算の区間和集合、JST日付境界、forward起算、重複index、矛盾検出、host加算を検証する。重なった2区間を単純加算すると2h、正しく併合すると1.5hになるfixture（小さな人工データ）を使用。
- `python3 -B -m unittest test_budget_hours`（remoteディレクトリ）：新規6件PASS。重複区間を単純加算する誤実装をメモリ上で注入し、上記fixtureが期待どおり1件FAILになるpositive control（検出能力の確認）もPASS。終了が開始より前／重複runの結果矛盾の拒否も検証した。なお同コマンドをリポジトリ直下で実行した初回はmodule未発見で失敗し、指定ディレクトリで再実行した。
- `npm run typecheck`：exit 127、`tsc: command not found`。依存導入は行わず、型チェックは未検証。
- `git diff --check`：exit 0。追跡対象差分がないため、新規3ファイルには別途行末空白検査も行いPASS。付録と実際のスクリプト出力の完全一致も確認した。
- ネットワーク、Docker、実Anvil、backtest、commit、pushは実行していない。既存テストのホスト／runner操作は人工stub（代用品）によるもの。

## 付録：集計スクリプト出力

以下を保存し、原資料未配布の読者も各小計と区間を追えるようにする。source欄は `.scratch-data/` 相対。小数は表示時だけ丸めている。UNKNOWNは欠測であり0ではない。

```text
CHUNKS: host | chunk | start JST | end JST | hours | status | endpoint | sources
LAUNCH | mini | e1-20261007T034035Z | 2026-10-07T12:40:38.521+09:00 .. 2026-10-07T15:27:30.000+09:00 | 2.780966388888889h
mini | e1-20261007T034035Z-c1 | 2026-10-07T12:40:38.521+09:00 | 2026-10-07T13:22:12.560+09:00 | 0.692789 | preserved-FAIL | next chunk first start (audit/idle unresolved) | indexes/e1-index.tsv:1, indexes/e1-index.tsv:9; mini-logs/e1-chain.log:10; mini-chain-log-dirs.txt:1
mini | e1-20261007T034035Z-c2 | 2026-10-07T13:22:12.560+09:00 | 2026-10-07T14:03:58.286+09:00 | 0.696035 | PASS | next chunk first start (audit/idle unresolved) | indexes/e1-index.tsv:10, indexes/e1-index.tsv:18; mini-logs/e1-chain.log:19; mini-chain-log-dirs.txt:1
mini | e1-20261007T034035Z-c3 | 2026-10-07T14:03:58.286+09:00 | 2026-10-07T14:45:44.590+09:00 | 0.696196 | PASS | next chunk first start (audit/idle unresolved) | indexes/e1-index.tsv:19, indexes/e1-index.tsv:27; mini-logs/e1-chain.log:28; mini-chain-log-dirs.txt:1
mini | e1-20261007T034035Z-c4 | 2026-10-07T14:45:44.590+09:00 | 2026-10-07T15:27:30.000+09:00 | 0.695947 | PASS | end marker | indexes/e1-index.tsv:28, indexes/e1-index.tsv:36; mini-logs/e1-chain.log:37; mini-chain-log-dirs.txt:1
mini | e3-20261007T063846Z-c1 | UNKNOWN | 2026-10-07T15:38:48.000+09:00 | UNKNOWN | RUNNER_FAIL | no index | mini-logs/e3-chain.log:11; mini-chain-log-dirs.txt:2
LAUNCH | mini | e3b-20261007T063927Z | 2026-10-07T15:39:29.738+09:00 .. 2026-10-07T18:26:26.000+09:00 | 2.782295h
mini | e3b-20261007T063927Z-c1 | 2026-10-07T15:39:29.738+09:00 | 2026-10-07T16:21:06.434+09:00 | 0.693527 | PASS | next chunk first start (audit/idle unresolved) | indexes/e13-index.tsv:37, indexes/e13-index.tsv:45; mini-logs/e3b-chain.log:11; mini-chain-log-dirs.txt:3
mini | e3b-20261007T063927Z-c2 | 2026-10-07T16:21:06.434+09:00 | 2026-10-07T17:02:55.061+09:00 | 0.696841 | PASS | next chunk first start (audit/idle unresolved) | indexes/e13-index.tsv:46, indexes/e13-index.tsv:54; mini-logs/e3b-chain.log:20; mini-chain-log-dirs.txt:3
mini | e3b-20261007T063927Z-c3 | 2026-10-07T17:02:55.061+09:00 | 2026-10-07T17:44:34.419+09:00 | 0.694266 | preserved-FAIL | next chunk first start (audit/idle unresolved) | indexes/e13-index.tsv:55, indexes/e13-index.tsv:63; mini-logs/e3b-chain.log:29; mini-chain-log-dirs.txt:3
mini | e3b-20261007T063927Z-c4 | 2026-10-07T17:44:34.419+09:00 | 2026-10-07T18:26:26.000+09:00 | 0.697661 | PASS | end marker | indexes/e13-index.tsv:64, indexes/e13-index.tsv:72; mini-logs/e3b-chain.log:38; mini-chain-log-dirs.txt:3
LAUNCH | mini | e4aa-20261007T093737Z | 2026-10-07T18:37:40.052+09:00 .. 2026-10-07T20:01:16.000+09:00 | 1.393318888888889h
mini | e4aa-20261007T093737Z-c1 | 2026-10-07T18:37:40.052+09:00 | 2026-10-07T19:19:29.054+09:00 | 0.696945 | PASS | next chunk first start (audit/idle unresolved) | indexes/e4-index.tsv:1, indexes/e4-index.tsv:9; mini-logs/e4-chain.log:11; mini-chain-log-dirs.txt:4
mini | e4aa-20261007T093737Z-c2 | 2026-10-07T19:19:29.054+09:00 | 2026-10-07T20:01:16.000+09:00 | 0.696374 | BLOCKED | end marker | indexes/e4-index.tsv:10, indexes/e4-index.tsv:18; mini-logs/e4-chain.log:20; mini-chain-log-dirs.txt:4
LAUNCH | mini | e4bb-20261007T110235Z | 2026-10-07T20:02:37.709+09:00 .. 2026-10-07T21:26:08.000+09:00 | 1.3917475000000001h
mini | e4bb-20261007T110235Z-c3 | 2026-10-07T20:02:37.709+09:00 | 2026-10-07T20:44:21.580+09:00 | 0.695520 | PASS | next chunk first start (audit/idle unresolved) | indexes/e4-index.tsv:19, indexes/e4-index.tsv:27; mini-logs/e4b-chain.log:11; mini-chain-log-dirs.txt:5
mini | e4bb-20261007T110235Z-c4 | 2026-10-07T20:44:21.580+09:00 | 2026-10-07T21:26:08.000+09:00 | 0.696228 | PASS | end marker | indexes/e4-index.tsv:28, indexes/e4-index.tsv:36; mini-logs/e4b-chain.log:20; mini-chain-log-dirs.txt:5
LAUNCH | mini | e5r3a-20261007T124829Z | 2026-10-07T21:48:31.334+09:00 .. 2026-10-07T23:11:47.000+09:00 | 1.387685h
mini | e5r3a-20261007T124829Z-c1 | 2026-10-07T21:48:31.334+09:00 | 2026-10-07T22:30:06.190+09:00 | 0.693016 | PASS | next chunk first start (audit/idle unresolved) | indexes/e5-index.tsv:1, indexes/e5-index.tsv:9; mini-logs/e5-chain.log:11; mini-chain-log-dirs.txt:7
mini | e5r3a-20261007T124829Z-c2 | 2026-10-07T22:30:06.190+09:00 | 2026-10-07T23:11:47.000+09:00 | 0.694669 | BLOCKED | end marker | indexes/e5-index.tsv:10, indexes/e5-index.tsv:18; mini-logs/e5-chain.log:20; mini-chain-log-dirs.txt:7
LAUNCH | mini | e5bb-20261007T141555Z | 2026-10-07T23:15:57.679+09:00 .. 2026-10-08T00:39:33.000+09:00 | 1.3931447222222222h
mini | e5bb-20261007T141555Z-c3 | 2026-10-07T23:15:57.679+09:00 | 2026-10-07T23:57:39.426+09:00 | 0.694930 | PASS | next chunk first start (audit/idle unresolved) | indexes/e5-index.tsv:19, indexes/e5-index.tsv:27; mini-logs/e5b-chain.log:11; mini-chain-log-dirs.txt:6
mini | e5bb-20261007T141555Z-c4 | 2026-10-07T23:57:39.426+09:00 | 2026-10-08T00:39:33.000+09:00 | 0.698215 | PASS | end marker | indexes/e5-index.tsv:28, indexes/e5-index.tsv:36; mini-logs/e5b-chain.log:20; mini-chain-log-dirs.txt:6
LAUNCH | mini | e6r3-20261007T154230Z | 2026-10-08T00:42:32.897+09:00 .. 2026-10-08T03:30:34.000+09:00 | 2.8003063888888886h
mini | e6r3-20261007T154230Z-c1 | 2026-10-08T00:42:32.897+09:00 | 2026-10-08T01:24:34.054+09:00 | 0.700321 | preserved-FAIL | next chunk first start (audit/idle unresolved) | indexes/e6-index.tsv:1, indexes/e6-index.tsv:9; mini-logs/e6-chain.log:15; mini-chain-log-dirs.txt:8
mini | e6r3-20261007T154230Z-c2 | 2026-10-08T01:24:34.054+09:00 | 2026-10-08T02:06:25.015+09:00 | 0.697489 | PASS | next chunk first start (audit/idle unresolved) | indexes/e6-index.tsv:10, indexes/e6-index.tsv:18; mini-logs/e6-chain.log:26; mini-chain-log-dirs.txt:8
mini | e6r3-20261007T154230Z-c3 | 2026-10-08T02:06:25.015+09:00 | 2026-10-08T02:48:29.241+09:00 | 0.701174 | preserved-FAIL | next chunk first start (audit/idle unresolved) | indexes/e6-index.tsv:19, indexes/e6-index.tsv:27; mini-logs/e6-chain.log:37; mini-chain-log-dirs.txt:8
mini | e6r3-20261007T154230Z-c4 | 2026-10-08T02:48:29.241+09:00 | 2026-10-08T03:30:34.000+09:00 | 0.701322 | preserved-FAIL | end marker | indexes/e6-index.tsv:28, indexes/e6-index.tsv:36; mini-logs/e6-chain.log:48; mini-chain-log-dirs.txt:8
LAUNCH | mini | e7r3c-20261007T183122Z | 2026-10-08T03:31:24.937+09:00 .. 2026-10-08T06:18:25.000+09:00 | 2.7833508333333334h
mini | e7r3c-20261007T183122Z-c1 | 2026-10-08T03:31:24.937+09:00 | 2026-10-08T04:13:04.725+09:00 | 0.694386 | PASS | next chunk first start (audit/idle unresolved) | indexes/e7-index.tsv:1, indexes/e7-index.tsv:9; mini-logs/e7-chain.log:15; mini-chain-log-dirs.txt:9
mini | e7r3c-20261007T183122Z-c2 | 2026-10-08T04:13:04.725+09:00 | 2026-10-08T04:54:48.594+09:00 | 0.695519 | PASS | next chunk first start (audit/idle unresolved) | indexes/e7-index.tsv:10, indexes/e7-index.tsv:18; mini-logs/e7-chain.log:26; mini-chain-log-dirs.txt:9
mini | e7r3c-20261007T183122Z-c3 | 2026-10-08T04:54:48.594+09:00 | 2026-10-08T05:36:32.917+09:00 | 0.695645 | preserved-FAIL | next chunk first start (audit/idle unresolved) | indexes/e7-index.tsv:19, indexes/e7-index.tsv:27; mini-logs/e7-chain.log:37; mini-chain-log-dirs.txt:9
mini | e7r3c-20261007T183122Z-c4 | 2026-10-08T05:36:32.917+09:00 | 2026-10-08T06:18:25.000+09:00 | 0.697801 | PASS | end marker | indexes/e7-index.tsv:28, indexes/e7-index.tsv:36; mini-logs/e7-chain.log:48; mini-chain-log-dirs.txt:9
LAUNCH | mini | e8r3c-20261008T015928Z | 2026-10-08T10:59:31.064+09:00 .. 2026-10-08T13:47:08.000+09:00 | 2.7935933333333334h
mini | e8r3c-20261008T015928Z-c1 | 2026-10-08T10:59:31.064+09:00 | 2026-10-08T11:41:06.101+09:00 | 0.693066 | PASS | next chunk first start (audit/idle unresolved) | indexes/e8-index.tsv:1, indexes/e8-index.tsv:9; mini-logs/e8-chain.log:15; mini-chain-log-dirs.txt:10
mini | e8r3c-20261008T015928Z-c2 | 2026-10-08T11:41:06.101+09:00 | 2026-10-08T12:23:09.805+09:00 | 0.701029 | preserved-FAIL | next chunk first start (audit/idle unresolved) | indexes/e8-index.tsv:10, indexes/e8-index.tsv:18; mini-logs/e8-chain.log:26; mini-chain-log-dirs.txt:10
mini | e8r3c-20261008T015928Z-c3 | 2026-10-08T12:23:09.805+09:00 | 2026-10-08T13:05:06.527+09:00 | 0.699089 | preserved-FAIL | next chunk first start (audit/idle unresolved) | indexes/e8-index.tsv:19, indexes/e8-index.tsv:27; mini-logs/e8-chain.log:37; mini-chain-log-dirs.txt:10
mini | e8r3c-20261008T015928Z-c4 | 2026-10-08T13:05:06.527+09:00 | 2026-10-08T13:47:08.000+09:00 | 0.700409 | preserved-FAIL | end marker | indexes/e8-index.tsv:28, indexes/e8-index.tsv:36; mini-logs/e8-chain.log:48; mini-chain-log-dirs.txt:10
mini | e9r3-20261008T015928Z-c1 | UNKNOWN | UNKNOWN | UNKNOWN | PASS | no index | mini-logs/e9-chain.log:15; mini-chain-log-dirs.txt:11
mini | e9r3-20261008T015928Z-c2 | UNKNOWN | UNKNOWN | UNKNOWN | PASS | no index | mini-logs/e9-chain.log:26; mini-chain-log-dirs.txt:11
mini | e9r3-20261008T015928Z-c3 | UNKNOWN | UNKNOWN | UNKNOWN | PASS | no index | mini-logs/e9-chain.log:37; mini-chain-log-dirs.txt:11
mini | e9r3-20261008T015928Z-c4 | UNKNOWN | UNKNOWN | UNKNOWN | RUNNING/NO_RESULT | no index | mini-logs/e9-chain.log:48; mini-chain-log-dirs.txt:11
air | e2r-20261007T034113Z-c3 | UNKNOWN | 2026-10-07T13:10:55.000+09:00 | UNKNOWN | RUNNER_FAIL | no index | air-logs/e2-chain.log:28; air-chain-log-dirs.txt:1
LAUNCH | air | e2r-20261007T034113Z | 2026-10-07T12:41:15.039+09:00 .. UNKNOWN | UNKNOWNh
INVALID_MARKER | e2r-20261007T034113Z | last_start=2026-10-07T13:45:23.934+09:00 > end=2026-10-07T13:10:55.000+09:00 | air-chain-log-dirs.txt:1
air | e2r-20261007T034113Z-c1 | 2026-10-07T12:41:15.039+09:00 | 2026-10-07T13:19:30.890+09:00 | 0.637736 | PASS | next chunk first start (audit/idle unresolved) | indexes/e2-index.tsv:1, indexes/e2-index.tsv:9; air-logs/e2-chain.log:10; air-chain-log-dirs.txt:1
air | e2r-20261007T034113Z-c2 | 2026-10-07T13:19:30.890+09:00 | UNKNOWN (last start 2026-10-07T13:45:23.934+09:00) | UNKNOWN | preserved-FAIL | end marker invalid/missing | indexes/e2-index.tsv:10, indexes/e2-index.tsv:18; air-logs/e2-chain.log:19; air-chain-log-dirs.txt:1
air | e2r3-20261007T051203Z-c4 | UNKNOWN | 2026-10-07T13:57:31.000+09:00 | UNKNOWN | INTERRUPTED/NO_RESULT | no index | air-logs/e2b-chain.log:20; air-chain-log-dirs.txt:2
LAUNCH | air | e2r3-20261007T051203Z | 2026-10-07T14:12:04.263+09:00 .. UNKNOWN | UNKNOWNh
INVALID_MARKER | e2r3-20261007T051203Z | last_start=2026-10-07T14:37:51.517+09:00 > end=2026-10-07T13:57:31.000+09:00 | air-chain-log-dirs.txt:2
air | e2r3-20261007T051203Z-c3 | 2026-10-07T14:12:04.263+09:00 | UNKNOWN (last start 2026-10-07T14:37:51.517+09:00) | UNKNOWN | PASS | end marker invalid/missing | indexes/e2-index.tsv:19, indexes/e2-index.tsv:27; air-logs/e2b-chain.log:11; air-chain-log-dirs.txt:2
LAUNCH | air | e2r4-20261007T060658Z | 2026-10-07T15:06:59.370+09:00 .. UNKNOWN | UNKNOWNh
INVALID_MARKER | e2r4-20261007T060658Z | last_start=2026-10-07T15:33:27.406+09:00 > end=2026-10-07T14:46:40.000+09:00 | air-chain-log-dirs.txt:3
air | e2r4-20261007T060658Z-c4 | 2026-10-07T15:06:59.370+09:00 | UNKNOWN (last start 2026-10-07T15:33:27.406+09:00) | UNKNOWN | preserved-FAIL | end marker invalid/missing | indexes/e2-index.tsv:28, indexes/e2-index.tsv:36; air-logs/e2c-chain.log:11; air-chain-log-dirs.txt:3
mini | chain-qz2.log:c1 | 2026-10-06T02:02:38.000+09:00 | 2026-10-06T03:08:22.000+09:00 | 1.095556 | PASS | timestamped begin/done | mini-logs/chain-qz2.log:2-3
mini | chain-qz2.log:c2 | 2026-10-06T03:08:22.000+09:00 | 2026-10-06T04:14:08.000+09:00 | 1.096111 | PASS | timestamped begin/done | mini-logs/chain-qz2.log:4-5
mini | chain-qz2.log:c3 | 2026-10-06T04:14:08.000+09:00 | 2026-10-06T05:19:40.000+09:00 | 1.092222 | PASS | timestamped begin/done | mini-logs/chain-qz2.log:6-7
mini | chain-qz2.log:c4 | 2026-10-06T05:19:40.000+09:00 | 2026-10-06T06:25:29.000+09:00 | 1.096944 | PASS | timestamped begin/done | mini-logs/chain-qz2.log:8-9
mini | chain-p60.log:c1 | 2026-10-06T18:35:49.000+09:00 | 2026-10-06T19:41:49.000+09:00 | 1.100000 | PASS | timestamped begin/done | mini-logs/chain-p60.log:2-3
mini | chain-p60.log:c2 | 2026-10-06T19:41:49.000+09:00 | 2026-10-06T20:47:46.000+09:00 | 1.099167 | PASS | timestamped begin/done | mini-logs/chain-p60.log:4-5
mini | chain-p60.log:c3 | 2026-10-06T20:47:46.000+09:00 | 2026-10-06T21:53:37.000+09:00 | 1.097500 | PASS | timestamped begin/done | mini-logs/chain-p60.log:6-7
mini | chain-p60.log:c4 | 2026-10-06T21:53:37.000+09:00 | 2026-10-06T22:59:48.000+09:00 | 1.103056 | PASS | timestamped begin/done | mini-logs/chain-p60.log:8-9
CLASSIFIED_MINI {'preserved-FAIL': 6.286044722222222, 'PASS': 20.609875555555554, 'BLOCKED': 1.3910433333333332}
CLASSIFIED_MINI_DAILY {'preserved-FAIL': {'2026-10-07': 1.3870547222222223, '2026-10-08': 4.89899}, 'PASS': {'2026-10-06': 8.780555555555555, '2026-10-07': 7.6918927777777775, '2026-10-08': 4.137427222222223}, 'BLOCKED': {'2026-10-07': 1.3910433333333332}}
AIR_FIRST_TO_LAST_START_SPANS=1.940051h; tails/failed attempts UNKNOWN (not a full occupation total)
DAILY_STRICT_COMPLETE_ENVELOPES {'mini': {'2026-10-06': 8.780555555555555, '2026-10-07': 10.469990833333334, '2026-10-08': 9.036417222222223}}
KNOWN_SPAN_SUBTOTAL mini+Air_start_spans=30.227015h; residual=69.772985h minus UNKNOWN (envelope convention)
TOTAL_STRICT mini=28.286964h; Air=UNKNOWN; sum=28.286964h + UNKNOWN; 100-minus-known=71.713036h (NOT available balance)
PASS_ENVELOPE mini=20.609876h; not pure simulator runtime; Air UNKNOWN
AIR_MARKER_PLUS_1H_HYPOTHESIS Air=2.913147h; combined=31.200110h; residual=68.799890h minus unrecorded cost
GAPS_BETWEEN_INDEXED_MINI_LAUNCHES (occupation UNKNOWN; not included)
e1-20261007T034035Z -> e3b-20261007T063927Z | 2026-10-07T15:27:30.000+09:00 .. 2026-10-07T15:39:29.738+09:00 | 0.199927h
e3b-20261007T063927Z -> e4aa-20261007T093737Z | 2026-10-07T18:26:26.000+09:00 .. 2026-10-07T18:37:40.052+09:00 | 0.187237h
e4aa-20261007T093737Z -> e4bb-20261007T110235Z | 2026-10-07T20:01:16.000+09:00 .. 2026-10-07T20:02:37.709+09:00 | 0.022697h
e4bb-20261007T110235Z -> e5r3a-20261007T124829Z | 2026-10-07T21:26:08.000+09:00 .. 2026-10-07T21:48:31.334+09:00 | 0.373148h
e5r3a-20261007T124829Z -> e5bb-20261007T141555Z | 2026-10-07T23:11:47.000+09:00 .. 2026-10-07T23:15:57.679+09:00 | 0.069633h
e5bb-20261007T141555Z -> e6r3-20261007T154230Z | 2026-10-08T00:39:33.000+09:00 .. 2026-10-08T00:42:32.897+09:00 | 0.049971h
e6r3-20261007T154230Z -> e7r3c-20261007T183122Z | 2026-10-08T03:30:34.000+09:00 .. 2026-10-08T03:31:24.937+09:00 | 0.014149h
e7r3c-20261007T183122Z -> e8r3c-20261008T015928Z | 2026-10-08T06:18:25.000+09:00 .. 2026-10-08T10:59:31.064+09:00 | 4.685018h
RELAUNCH_GAPS E4/E5 only (optional continuous-experiment envelope)
relaunch_gap=0.092330h; mini_inclusive=28.379294h; corrected_air_combined_inclusive=31.292440h; residual=68.707560h minus unrecorded cost
ESTIMATE mini 9-world chunk n=28 min/median/max=0.692789/0.696212/0.701322h; E9 full 4 chunks=2.771154/2.784847/2.805288h; E9 final chunk empirical estimate up to 0.701322h from its unknown start; remaining from snapshot UNKNOWN
ESTIMATE E10 60 worlds same layout as P60: prior=4.399722h; 4*min/max chunk=4.390000/4.412222h; no startup/audit/retry reserve
CALENDAR anchor latest verified end=2026-10-08T13:47:08.000+09:00; deadline=2026-10-31T23:59:00.000+09:00; delta=562.197778h; not snapshot/current time
MGS_TIMEZONE_UNLABELLED assumed JST only: 2026-10-06T01:46:35.000+09:00 .. 2026-10-06T01:59:47.000+09:00; 0.220000h; mini with MGS=28.506964h
LEDGER .scratch-data/ledger.jsonl rows 1 [('league-r1', '2026-10-03T08:19:52.818611+00:00')]
LEDGER ascon-notes/league/ledger.jsonl rows 1 [('league-r1', '2026-10-03T08:19:52.818611+00:00')]

```
