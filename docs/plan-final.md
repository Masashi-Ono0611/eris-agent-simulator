# ASCON 最終実行プラン（2026-10-23 改訂版）

この文書が最終プランの正本（branch `feat/final-plan` の `docs/plan-final.md`）。10/22 21:45 JST の確定版を、10/23 早朝までに分かった事実と判断で書き換えたもの。実行の記録（何が走り、何が決まったか）は追記専用の STATE ログに、R の設計根拠は R 設計メモに置く（どちらも git 管理外）。置き場所は `~/ascon-final/notes/`（`STATE.md`、`r-design-memo.md`）に移す予定だが、10/23 早朝の時点ではそのディレクトリはまだ無く、セッション a6a3f651 の scratchpad（`/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer-ascon/a6a3f651-0db9-44e2-821d-4d07b8dc21f6/scratchpad/` の `STATE-pause-0259.md` と `r-design-memo.md`。macOS は 3 日使われないファイルを消す）にしかない。まず `ls ~/ascon-final/notes` で移動済みかを確かめる。圧縮や新しいセッションの後は、まず STATE ログを読む。

**前提の日程**: 本番週 11/1〜11/8。提出締切 10/31 23:59 JST。1 段に入れる arm の締切 10/23 22:00（10/22 版では新しい候補のコード締切を 10/24 23:59 としていたが、新しい arm 1 本に約 21 lane-h かかるので前倒しした。理由は「計算資源」）。既存 arm の修正の締切 10/24 23:59。戦略コードの凍結 10/29 23:59。最後の提出操作 10/31 18:00。

**用語**
- **B**: 受理済みの opus-1（ASCON-S-00048、ZIP sha `2e5a0451` = commit `8ff2e696`）のバイト。
- **B′**: 偽薬（placebo）。dir `opus-1-pb`。B の全取引サイズを ×0.999 にしただけの版で、効果がほぼゼロのときの差のばらつきを測るのに使う。fee や遅延は変えない（理由は「反映しなかった指摘」）。
- **C1**: dir `opus-1a`（PR #85）。B に launch の allowance 修正（launch module の 2 か所の swapBundle 呼び出しを、承認を無制限に保つ launchSwapBundle に替える）と、改訂用 prompt P1 だけを入れた版。launch 以外の挙動は B と同一。
- **R**: dir `opus-1r`（commit を固定して評価する）。C1 に r3 由来の機構を足した版。機構は R 設計メモ §2〜§5 のとおり: 2 脚のバンドルのみ、サイズ N* = R·e/4（R は深さ、e は正味エッジ）を上限 min($6k, NAV の 8%) で切る、入札は競合の最大 fee ×1.2 + 1 wei を上限 0.30E（E は期待利益）で切る、最小エッジ 100bps かつ最小期待利益 $25、片側だけ約定したバンドルを数えるブレーキで 36 block 停止、深さは背景で取得してキャッシュし decide() でブロッキング RPC を待たない。数値の正本は `example/agents/opus-1r/agent.ts` の PARAMS。
- **W**: 独自の武器（weapon）を足した arm を 1 本だけ。候補は opus-1g（C1 + GMX の OU 平均回帰 M-OU、commit `4d5fac2e` 以降）と ascon-zeta-r3k（r3 系譜 + 単脚の下限 K1、自分の結果によるブレーキ K2、大きなエッジでの入札 K3）。10/23 22:00 までに Step 2 の W スクリーンで 1 本を選ぶ。
- **F / F2**: 1 段で選ばれた第 1 候補と第 2 候補。
- **EW**: レジームごとの T の単純平均。判定には launch を除いた 11 レジームの EW（**EW11**）を使い、12 レジームの EW と公式の重み付き値は報告用の数字として併記する。
- **slot 入替**: 1 ロスターに入れる我々の agent を `id: slot` の 1 体だけにし、dir だけを替えて比べる方式。理由: 近縁クローンを同居させると、同じ launch プールや同じ Liquity 清算を奪い合って偽の差が出る（fc の launch での −10 T は opus-1 と同じ fee の swap の後ろで revert した結果だった）。
- **セル**: (seed, field) の組。1 セルの全 arm を同じ host の同じ lane で走らせる。
- **F_P / F_D / F_S**: 評価用の 3 つのロスター（sparse / contested / spec）。
- **STF**: launch entry 後に USDC→Uniswap の swap が失敗し続けるバグ（lib の swapBundle が承認額をちょうどにするため）。
- **P0 / P1**: 改訂用の prompt。P0 は現行、P1 は改訂版（Codex レビュー 3 回、残余リスクあり）。
- **lane / lane-h**: 行列を順に走らせる実行列と、lane 1 本を 1 時間使う量。lane は mini A、mini B、laptop L（ユーザーの承認は「10/25 まで」。計画上は 10/25 08:00 で区切る）。
- **D1 / D2**: 1 段と 2 段の判定時点。

**指摘の番号**: `Codex C1–C7`（Critical）、`W1–W9`（Warning）、`S1–S7`（Suggestion）、`批評 1–20`（完全性批評）は 10/22 のレビュー記録の番号。原文は `codex-final-plan-review.out`（10/22 セッションの scratchpad。消える可能性がある）。

---

## 1. 振り返り

### 分かったこと
- **採点式**: P は `pnlUsdc`、重みは `w_s = 1 + 0.5(s−1)/(k−1)`。既存の 17 行列を誤差 2e-14 で再現できた。
- **重み**: backtest は launch 10.0%、cdp-incident 9.7%、calm 6.7% の重みになる。本番は k=60 で、レジームは epoch ごとに独立に抽選されるので、各レジームの期待重みは約 8.3%。
- **opus-1 の優位は launch 由来だけ**: launch を除くと sonnet-1 が +0.89 で上回る。ただしどちらも近縁クローンが同居した条件の値。
- **同居クローンが結果を壊す**: fc の active launch での −10.5 / −9.2 は、opus-1 との同じ fee の swap 争いによる revert だった（launch を除くと fc は +0.27）。同じ Liquity 清算も奪い合う。fc 対 opus-1 は 404/505/606 で −0.15、707/808/909 で +0.66 と、seed の組で符号が逆になった（どちらもクローン同居）。
- **ノイズ**:
  - 同一コードの r2 と r3 で、公式 T の差が −4.7〜+2.9 出た。
  - レジーム別の対比のノイズは launch が圧倒的: rms 20.8（F_P）/ 22.8（F_D）に対し、他のレジームは 1.2〜6.9（`stepR/noise-r2r3.json`）。seed ごとの EW 対比の分散のうち、launch が 89%（F_P）/ 67%（F_D）を占める。
  - quiet はほぼ決定論的に再現する。active はカオス的で、1 体変えると他の agent の T が rms 6.8 動く。
- **遅延は順位に効く**: decide() の中のブロッキング getBlock（2〜4ms）で、r3s は同じ fee 同士の順位に約 2:1 で負けていた。RPC を足したくなる候補（R、r3k、opus-1g）では毎回確かめる。
- **opus-1 の実バグ**:
  - (a) STF。launch epoch あたり 13〜118 件。C1 が直す。
  - (b) M1 が $1,125 で頭打ちになる（深さのフォールバック値）。811bps の取引も $1,125 だった。R が直す。
- **r3 の稼ぎ方**（R 設計メモ §1 の帰属分析）: quiet での優位は 2 脚をまとめて出すバンドル、active での損失は小さな乖離での単脚を低い入札で出したもの。quiet +1.72（5 seed 中 4 で正）、active −7.54（5 seed すべて負）。いずれもクローン同居での値。
- **r3s / r3b**: 新しい seed 707/808/909 で事前登録ゲートに FAIL（r3s −0.36、r3b −0.79）。退役。
- **1 scenario の所要時間**: ロスターの体数に関係なく約 12.4〜13.2 分（block 時間で決まる）。1 行列 2.6 lane-h は小さいロスターでも同じ。
- **本番の場**: 各 unit が 1 体ずつ。live week は epoch ごとに revert される行列（liveWeek.ts の冒頭）。
- **道具について確かめた事実**:
  - 同じミリ秒に始まった 2 本の run は `runs/<ms>` を共有し、run-matrix は `VERDICT=PASS` のまま（808 で実証）。検出は `check-collision.py`、回避は lane を 20 秒ずらすこと。上流の修正 PR #324 は 10/23 時点で未 merge で、この branch には入っていない（現在の状態は upstream の PR #324 を見て確かめる）。
  - run-matrix と check-matrix は agent id しか見ないので、slot 入替では arm の取り違えを見抜けない。`check-arm.py` が必要。
  - `ascon/eval/run-matrix.sh` は `--agent-state-root` を渡さない。
  - `agent:selftest` の合否は summary.json の有無と早期終了・OOM だけで決まり、推論経路は見ない。
  - backtest CLI は `.env.local` を読まない（鍵は export が必要）。
  - state の fingerprint が合わないと、backtest CLI は追跡対象の `sdk/src/constants.local.ts` を書き換える（opus-1g の worktree で発生）。
  - agent runtime は decide() 1 回ごとの所要時間を記録していない（`strategyRunner.ts` の performance.now は締切計算だけ）。
- **受理と床**: 受理メールに書かれるのは受理の可否と当日の残り回数だけで、sha では照合できない。床は時刻（00:35 作成 → 00:42 受理）で `2e5a0451` と特定済み。docker selftest PASS（4g、26 件 include、revert 0）。改訂の呼び出しは鍵なしで 401（想定どおり BLOCKED）。

### 信じるのをやめること
- 「opus-1 は万能型」「fc は cap のせいで負ける」「同居させて比べれば公平」
- 「S1 は A/A」。実際は getBlock の同期呼び出しで tie に約 2:1 で負けていた。
- 「事前登録ゲートは保守的」「gate は本番では開かないので安全側」「モデルはほぼ常に改訂を断る」
- 「--state を分ければ並列 lane は安全」「run-matrix の PASS で run は有効」「受理メールで sha を照合できる」
- 「小さいロスターなら行列が短くなる」
- 単一 seed の結果で方向を決めること。これまで 3 回、逆を向いた。
- 4 seed に正規近似を当てた「m/SE ≥ 1.65 で片側 5%」。t(3) では片側約 10%［Codex C1、批評 2］。
- 「launch を含む 12 レジーム EW の差で、+1.0 の効果を検出できる」。シミュレーションでは検出力が約 10% しかない（第 3 章 Step 6）。

### 進め方の教訓
- 自律を任された後も go/no-go を聞いて、lane が 3.1h 空いた。計画の開始も 19:30 予定から約 2 時間遅れた［批評 12］。lane を空けないことを最優先にする（lane の運用の「連鎖起動」）。
- セッションの使用上限に 2 回当たった。大きな workflow（verify agent 58 体）が全部同時に落ち、laptop は load 43 に達した。D1/D2、凍結、提出の前後は workflow の同時実行を約 8 agent までにする。reviewer・skeptic・recheck は Sonnet にする（Opus は設計判断だけ）。10/23 03:13 以降、実装・テスト・分析・レビューは `codex exec` 1 本ずつを既定にし、Claude の workflow は Codex でできない仕事だけにする。大きな workflow の前には使用量を確かめる（基準は auto-memory の usage pacing）。方向を確かめる前に全候補を全観点で検証しない（武器探しでは、検証の途中でユーザーが方向を r3 系譜に変えた）。
- レビューは「1 回 + 修正の再確認 1 回」までにする。新しい Critical が出なくなったら止め、残る Warning は残余リスクとして記録する。
- 機能したもの: 公式式の再現、事前登録、早めの保険提出、Codex レビューで実バグを捕まえたこと、陽性対照・陰性対照付きの検査道具。

---

## 2. 現状の判断

- **S-00048（B）を据え置く。** clone-free の比較で B を上回ったと示せた候補は、まだない。
- **床**: `2e5a0451`（= commit `8ff2e696`）。docker selftest PASS。U1 は閉じた。
- **r3s / r3b は退役**（707/808/909 で事前登録ゲートに FAIL、−0.36 / −0.79）。記録は `ascon/final/LINEAGE.md`。
- **評価の土台**: slot 入替。候補の arm は C1、R、W の 3 本。
- **退役・arm にしないもの**:
  - r3s / r3b: 新しい seed でのゲートに FAIL。
  - fc: 証拠がクローン同居の条件だけで、seed の組で符号が逆になる。
  - opus-2: 不採用（PR #81 のコメントに +0.16 で不採用と記録）。
  - r3（clone-free）: 0 段で記録するだけ。その機構は R と r3k が受け継ぐ。
- **方針**: 土台は commodity な opus（C1）、独自性は武器 1 本（W）。r3 系譜を武器として使う（ユーザーの方針）。

---

## 3. プラン

### 共通ルール
- **ロスター**: 全 agent に `ERIS_AGENT_FROZEN=1` を付ける。ただし soak では slot だけ外す［批評 3］。
  - F_P（8 体）: random, lp-provider, lst-carry, levered-long, venue-arb, basis-arb, peg-arb, slot
  - F_D（9 体）: venue-arb, venue-arb-2, multi-arb, clean-arb, cross-venue-arb, max-profit-arb, stat-arb, adaptive-arb, slot
  - F_S（11 体）: launch-confirm, launch-sniper, liquidator, redemption-arb, trove-manager, discovery-arb-verify, max-profit-arb, venue-arb, lp-provider, random, slot
- **生存系譜**: 生存者は相手役ではなく slot の arm として扱う。同居させない理由（クローンの奪い合いによる偽の差）は `ascon/final/LINEAGE.md` と U4 に書く。生存者の対応表も LINEAGE.md が正本。
- **seed**: 一度使った seed は使い回さない［Codex C3］。

  | 用途 | seed |
  |---|---|
  | smoke / 0 段の記録 / W スクリーン | 1001 |
  | C1 の launch 検査 | 1041〜1046（予備 1047〜1050） |
  | soak | 1202（P1）、1205（陽性対照）、1204（P1 を締め直した後の再測定だけ） |
  | 1 段 | 1003〜1006（R が late-arm 規則で足せない場合だけ、R は 1007〜1010） |
  | 2 段 | 1011〜1014 |
  | 追試 | 1021〜1024 |
  | F_S | 1101〜1102 |
  | opus-1g の GMX 実測（laptop、記録用） | 2001（使用済み） |

  1201、1203、1206 は使わない。F2 を順に回す 2 段用の 1015〜1018 は使わない（F2 の並走に置き換えた）。`scen-1007〜1010.yaml` と `scen-1015〜1018.yaml` はあり、`ascon/final/README.md` の「Lanes stay busy」と judge2.py の docstring はまだ「1 段は {B, B′, C1} で先に始め、R は 1007〜1010」「F2 は 1015〜1018」という旧版の運用を書いている。凍結の前にこの 2 か所を本プランに合わせる（**未対応**）。
- **セルの実行**［Codex S1］:
  - 同じセルの arm は、同じ host の同じ lane で続けて走らせる。arm の順は事前に乱数で決めて記録する。
  - **late-arm 規則**: セルは B、B′、C1 が揃い、判定則が凍結されていれば始めてよい。R と W は、`git diff <セルの commit> <arm の commit> -- core sdk example/agents/lib example/agents/runtime example/agents/opus-1 example/agents/opus-1-pb example/agents/opus-1a ascon/eval ascon/final/roster-FP.yaml ascon/final/roster-FD.yaml ascon/final/check-arm.py 'ascon/final/scen-*.yaml'` が空のときだけ、同じセルの同じ lane・同じ host に後から足す。判定にしか使わない judge2.py / mc.py の変更は対象外にする（`ascon/final` 全体を対象にすると、judge2 の commit だけで規則が使えなくなる）。追加した順は記録する。R の diff が空でなければ、R は 1007〜1010 の別のセルで測る。
  - lane の起動は 20 秒以上ずらす（同じミリ秒に始まった 2 本は `runs/<ms>` を共有し、run-matrix は PASS のまま。上流 #324 は未 merge）。
- **有効性**［Codex W5、批評 16/17］:
  - 有効の条件: run-matrix が PASS、`check-collision.py` が PASS、runDir が一意、`check-arm.py` が PASS（slot が意図した arm を frozen で走らせた）。lane-queue は各 job の後に check-collision と check-arm を走らせ、EXIT 行に `VERDICT= COLLISION= ARM=` を書く（この変更は 10/23 早朝時点で未 commit。数えるのは 3 つとも PASS の job だけ。`ascon/eval/README.md` §6）。lane-queue の外で走らせた行列には手でかける。
  - **基盤側の失敗**（衝突、setup の失敗、参照 agent が ready にならない）: 同じ lane で 1 回だけ再走する。2 回目も失敗したら、そのセルを全 arm から外す。
  - **候補側の失敗**（slot の decide timeout / crash / 未 ready）: セルは外さず、その候補の機構条件（条件 5）の FAIL として数える。
  - 参照 agent の timeout は記録だけにする。
  - 解析ツールが読むファイルは `agents/slot.jsonl` にする。
  - 共変量として、scenario ごとに host、開始時の load1、arm の順を記録する。
- **測った木と出す木の一致**: 結果は arm の dir 名で引かれるが、戦略は `example/agents/lib` と runtime にも依存する。各行列の記録に、arm dir・lib・runtime・sdk の git tree hash を残す。出荷する commit と測った commit の間で `git diff <測った commit> <出荷 commit> -- example/agents/<arm> example/agents/lib example/agents/runtime sdk core` が空であることを Step 8 の条件にする。
- **`constants.local.ts`**: 候補の commit と bundle の前に、毎回 `git diff --quiet -- sdk/src/constants.local.ts` が通ること。通らなければ `git checkout -- sdk/src/constants.local.ts` で戻す。候補の worktree で backtest を走らせるのは、fingerprint が一致する state dir（評価 branch の state をコピーするか、`ascon/eval/new-worktree.sh` で作る）を使うときだけ。
- **commit の注意**: laptop の worktree では `out` が symlink のため `.gitignore` の `out/` にかからず、未追跡に見える。`git add -A` や `git add .` を使わず、パスを明示して add する。laptop の worktree が共有する `node_modules` と `out` は worktree `opus-1-model` が持っているので、その branch（#82）が merge 済みでも 10/31 まで消さない。

### lane の運用［批評 14/15］
- **lane**: mini A、mini B、laptop L（U5 でユーザー承認済み。期間は上の用語を参照）。mini は 2 lane が上限（2 lane で load1 約 16、12 コア）。手順の正本は `ascon/eval/README.md`。
- **各 lane は自分の評価 worktree から走らせる**。mini では `mini-lane-start.sh` が commit ごとに `~/Developer/ascon-wt-<sha8>` を作り、既存の tree の中では checkout しない（稼働中のスクリプトや agent コードが入れ替わるため）。新しい arm を足すときは、新しい commit の tree を別に作り、late-arm 規則の diff が空であることを確かめる。
- **laptop L の規則**（ユーザーの上限: 10/23 03:19「Air の負荷はこれが最大とし、基本は mini」）:
  - laptop で走らせる lane は最大 1 本。丸ごとのセルだけを走らせる。worktree は `ascon/eval/new-worktree.sh` で mini の評価 tree と同じ commit から作る。port 8800 番台、専用の state dir、ログは /tmp の外、`caffeinate` の下で動かす。
  - 各 job は load1 < 10 で、大きな workflow が動いていないときだけ始める（`ascon/eval/README.md` §4 と同じ基準）。待ちが時間切れになったら HOLD。
  - L がセルを持っている間は、laptop で他の backtest、probe、multi-agent workflow を走らせない（10/23 02:22〜02:43 に重い 3 job が重なって load 43〜47 になった）。
- **実装済みの道具**（10/23 早朝時点で未 commit。テストは `/bin/bash ascon/eval/test-all.sh`）:
  - `ascon/final/make-queues.py`: セル規則（セルの全 arm が同じ lane、記録した乱数で決める arm の順、lane 間の均衡、slot dir とシナリオファイルの存在）を満たす queue を作り、`--check` で検査する。queue は手で書かない。
  - `ascon/eval/lane-chain.sh`: lane ごとの `pending/` の queue ファイルを順に lane-queue に渡し、空になったら待つ。各 lane の `pending/` には、判断を待たずに始められる queue を 1 本置いておく（判断で変わるのは次に何を置くかだけ）。止めるときは `STOP` ファイル。
  - `ascon/eval/mini-lane-start.sh`: commit に固定した tree で lane-chain を nohup で起動し、lane 同士の起動を 20 秒ずらす。
  - `ascon/eval/lane-status.sh` / `watch-lanes.sh`: 全 lane の状態を 1 回の ssh で読む。待つときは watch-lanes を 1 本、背景で動かす（ssh の sleep ループを都度書かない）。
- lane-queue は job の前に空きディスクを確かめ、10GiB 未満なら `HOLD_<lane>` で止まる。完了は queue ログの `QUEUE_DONE_<lane> run=<id>` で判定する。tailscale ssh の終了コードは使わない（常に 0）。
- 2 段の queue は F = R 用と F = W 用の 2 通りを書いておき、D1 の後に正しい方を `pending/` に置く。

### 道具の置き場所
- `check-collision.py` / `lane-queue.sh` / `lane-chain.sh` / `mini-lane-start.sh` / `lane-status.sh` / `watch-lanes.sh` / `run-matrix.sh` / `new-worktree.sh` は `ascon/eval/`。`judge2.py` / `mc.py` / `check-arm.py` / `check-trap-scope.py` / `make-queues.py` とロスター・シナリオは `ascon/final/`。いずれも branch `feat/final-plan`。手順は `ascon/eval/README.md`。
- 陽性対照が通ってから使う。陰性対照は arm を追加するたびに再実行する（`ascon/final/test-checks.sh` は opus-1a の追加で、陰性対照「存在しない arm」が存在する arm になって壊れていた）。テストは `/bin/bash` で、repo のパスを引数に渡して回す。CI はこれらのテストを走らせない。
- merge は `/review:self-multi-model` を通した後。稼働中のスクリプトは書き換えない。
- docker selftest のスクリプトは `ascon/final/` に置く（現在は scratchpad にしかない。Step 8 で F に再び使う）（**未実施**）。

### Step 0 — 準備（済）
- worktree `final-plan`、ロスター 3 つ、シナリオファイル、B′（opus-1-pb、unit test 付き）、`check-collision.py`、`check-arm.py`、`check-trap-scope.py`、`lane-queue.sh`（陽性・陰性対照付き）は commit `11f3f8f0` と `1ce98d01` に入った。
- C1（opus-1a）は PR #85。中身は launch の swap の承認を無制限に保つ修正と P1 だけ。
- U1〜U9 の依頼は送った。回答は第 6 章。

### Step 1 — 既存 run の後始末、smoke、床の selftest（済）
- 707 / 808 / 909 の衝突検査と r3s / r3b の判定は済み。707/808/909 で事前登録ゲートに FAIL（r3s −0.36 / r3b −0.79）、退役。記録は LINEAGE.md。
- smoke（両 lane、seed 1001）は PASS。
- 床の selftest は PASS（4g、26 件 include、revert 0）。改訂の呼び出しは鍵なしで 401 のため、その項目は BLOCKED（想定どおり）。

### Step 2 — 0 段: 記録用の診断、C1 の機構検査、W スクリーン（10/23、mini 2 lane）
- **lane A（記録用、判定には使わない）**［Codex W3］: F_P#1001 と F_D#1001 × {B, r3}。4 行列、約 10.5 lane-h。clone-free での r3 の実力を見る。10/23 約 10:30 に空く見込み（STATE の時刻からの推定）。
- **lane B**: launch#1041〜1046 × F_P/F_D × {B, C1}、24 scenario（c1L）。約 05:15 に空く見込み。
- **trap 対照は不要**: 公式 12 レジームに lending の singleton が無く、trap-launcher は空回りする（134 run で `lending: null`）。arm ごとに `check-trap-scope.py` で再確認する（`ascon/final/README.md`）。
- **C1 の機構判定**（c1L から）:
  - (a) unit test が通る。
  - (b) B で entry があり STF が出た run が 3 本以上ある（陽性対照。足りなければ 1047〜1050 を追加）。C1 は entry のあるすべての run で STF 0。
  - (c) 同じ seed で比べて、entry 後の M1/M2 の約定数が C1 ≥ B。
  - (d) entry のある run での launch ΔT 平均が −3.0 以上。
  - FAIL なら直して、新しい seed で再検査する。
- **C1 の launch 限定ガード**: F_D#1003 で C1 の 12 レジーム行列を 1 本だけ走らせ、(1) launch 以外のレジームで launch module の行が出ないこと、(2) launch 以外の対 B の対比が B′ のノイズの範囲に入ること、を確かめる。どちらかが崩れたら、C1 は全レジームの行列に戻す。根拠: opus-1a と opus-1 の agent.ts の差は launch module の 2 か所の呼び出しだけ（prompt.md も違うが、frozen では読まない）。opus-fc-validate の 45 run で opus-1 が launch module の行を書いたのは 2 run だけ（その 2 run のレジームは**未確認**）。
- **W スクリーン**（mini lane B、c1L の直後から、2 × 2.6 lane-h）:
  - F_D#1001 を ascon-zeta-r3k と opus-1g で 1 本ずつ走らせ、同じ host の s0-FD1001-B / s0-FD1001-r3 と比べる。laptop でのスクリーンは smoke 扱いで、比較には使わない（host の load と decide の遅延で tie の順位が変わる。laptop は Node v24.13.0、mini は v24.18.0）。
  - 事前登録: 「W = decide timeout 0、decide() の経路にブロッキング RPC が無い（下の grep。runtime は decide の所要時間を記録しないので、p99 はこの段では測れない）、STF 0 を満たす arm のうち、F_D#1001 の launch 以外の EW の対 B 差が大きい方。これは 21 lane-h をどこに使うかを決めるだけで、出荷の証拠ではない（単一 seed）」。
  - どちらの arm も、行列を数える前に decide() の経路で await している RPC（getBlock / readContract 等）を grep し、`check-trap-scope.py` を opus-1a、opus-1r、opus-1g、ascon-zeta-r3k にかける。
  - opus-1g の証拠は既定長の slot ロスターの run だけ。`--blocks 60` の短縮 run（CLI が「結果を読む run は regime の既定値を使え」と警告し、crash は窓が収まらず FAIL）と、opus-1a と opus-1g を同居させた probe ロスターは、機構の確認用で判定には使わない。
- **夜間の Claude 作業（読み取りだけ）**: r3 の PnL のモジュール × field × regime の分解、max-profit-arb の whale の分解、opus-1 の cdp-incident の分解は R 設計メモ §1〜§4 に反映済み。武器探しの検証は保存済みの run を読むだけにし、backtest は走らせない。検証するのは未検証のエッジの上位 3 つ（#10 launch の同ブロック波、#21 自分の nonce 順の入札、#4 whale での復元）だけ。

### Step 3 — 改訂ループの実測（soak）（laptop L、または U6 が済んでいれば mini）
- **実行**［批評 3］: run-matrix は `--agent-state-root` を渡さないので、backtest CLI を直接呼ぶ。F_P で slot だけ FROZEN を外す。鍵は worktree の `.env.local` から export する（CLI は `.env.local` を読まない）。
- **本数**: P1（C1）を seed 1202 で 1 回の連続 run（12 scenario、reviseEveryBlocks=60、約 72 call）。許容的な prompt の陽性対照を 1205 で 1 scenario。P0 の run と、1206 での強制 install の ΔT 測定はやめる（U3 が skip され、P1 を既定で出すので、どちらも判断を変えない）。
- 約 3 lane-h、約 80 call（週の無料枠約 2,100 call の約 4%）。
- **判定**:
  - attempt の数が期待値（blocks/60 の合計）の 90% 未満、または HTTP 200 で解析できた応答が attempt の 90% 未満なら、**BLOCKED**。
  - 陽性対照で install が 0 件なら、検出器が BLOCKED。
  - P1 で install が 0 件なら PASS とし、install 率の 95% 上限と、本番約 300 call での期待 install 数の上限を記録する。soak は安全を証明するものではなく、率の上限を与えるだけ。
  - P1 で 1 件以上 install が出たら、締め直して新しい seed（1204）で測り直す［Codex C6］。締め直しは最大 2 回。
- **本番の proxy 経路**［批評 5］: `infra/inference-proxy` をローカルで起動し、鍵 1 本で 1 call 通す。できなければ BLOCKED と記録する（**未検証**）。

### Step 4 — R の確定、MC、判定則の凍結（10/23、1 段の開始前）
- **R**: R 設計メモ §2〜§5 と opus-1r の PARAMS（入札 rBidRivalMult 1.2 + 1 wei、上限 0.30E。最小エッジ rMinEdgeBps 100、最小利益 rMinProfitUsd 25、whale の目印 rWhaleEdgeBps 200 はタグだけ。ブレーキ 20 件の窓 / 8 件以上 / 40% で 36 block 停止、片側だけのバンドルを数える）。
  - 脚の guard は凍結前に決める: `rLegAllowanceBps 0`（fair に基づく厳格な guard）を既定とする。whale 窓の再生で緩めた guard がエッジを増やすと示された場合だけ緩める。R の arm は 1 本だけ。reviewer の指摘: 厳格な guard だと whale 窓で R がほとんど点火しない（STATE 02:15）。
- **mechanism JSON**（判定の条件 5 と C1 の機構判定の入力）: judge2 は slot_timeouts、p99_decide_ms、tie_win_rate、stf、matrices_sha256、C1 の step2_mechanism / step2_report を必要とするが、これを書き出す道具がまだ無い。1 段の開始前、かつ judge2.py を hash で凍結する前に作る。
  - `ascon/final/mechanism.py <stage manifest> --out MECH.json` を追加する（**未実装**）。arm の行列ごとに: slot_timeouts（`agents/slot.jsonl` の decide timeout 行の数）、stf（最初の launch entry 以降の STF の submit 失敗）、tie_win_rate（blocks.csv で slot と他の送信者が同じブロック・同じ venue に同じ優先手数料を払った件のうち、slot の txIndex が小さかった割合）、matrices_sha256。C1 の Step 2 の report は別ファイルにし、その sha256 も付ける。陽性対照・陰性対照付きのテストを付ける。
  - **p99_decide_ms の取り方は決定待ち（論点）**: runtime は decide() の所要時間を記録していないので、走り終えた run からは出せない。選択肢 1: `strategyRunner.ts` の既存の決定ログ行に duration_ms を足す（全 arm に同じ影響。runtime のバイトが変わるので bundle に入るかの確認が要る。入るなら、評価で走る B は S-00048 と runtime が違うバイトになり、出荷する F も新しい runtime を含む。runtime は late-arm 規則の diff の対象なので、1 段の最初のセルより前に入れる）。選択肢 2: p99 を BLOCKED-by-design とし、条件 5 の p99 を参考値にすることをユーザーに承認してもらう（凍結前なので緩和にはあたらない）。決めないまま D1 に入ると R と C1 が BLOCKED になる。決定は `ascon/eval/README.md` に反映する。
- **MC**［Codex C2/S2、批評 2］:
  - 過去の差の実測（r2/r3 の同一コードのノイズ）から seed ごとの対比の分布を作り、1 段 → 2 段 → 追試まで、判断木全体を模擬する。
  - 求める性質: 効果ゼロのとき R または W を出荷してしまう率（木全体）が 2% 以下。その中で検出力を最大にする。+0.5 と +1.0 での出荷率を報告する。
  - **凍結 commit まで（1 段のデータが 1 本も無い間）は、t_crit と基準値をどちらの向きにも動かしてよい。凍結後は厳しくする方向にしか変えない。** ただし U4 で承認された基準値より緩める変更は、凍結前でもユーザーの承認が要る。旧規則（MC は厳しくする方向だけ）は、1 段のデータが無い段階で厳しすぎる検定を固定してしまうのでやめた。旧規則での実測: 真の +1.0 で R を出荷する率 9.1%（strict）/ 9.7%（u4）、+0.5 で 1.7%、効果ゼロでの誤出荷 0.15%（目標 2% に対し約 13 倍の余裕）（`stepR/mc-main.log`、`review-mcval/v-base10k.log` では 6.6%）。
  - ノイズモデルはクローン同居の場から作ったもので、悲観的な可能性が高い（launch の sd はクローンの launch 争いからの上限、F_S は F_D のコピー）。ノイズを半分にすると、11 レジーム・基準 0.2 で +0.5 が 71%、+1.0 が 99.6% 通る。最初の有効な 2 セルが揃ったら、B 対 B′ から作ったノイズで mc.py を再実行する（R と W の列は見ない）。これは報告用で、閾値は凍結のまま。
- **judge2.py**: 作業中の judge2.py は 10/22 版の規則（12 レジームの EW、基準 +1.0 で U4 承認後は +0.20、+0.20〜+1.0 はユーザーに判断を仰ぐ帯、R 遅れは 1007〜1010、F2 は 1015〜1018）で書かれている。凍結する judge2 は、本プランの Step 6 と U4 の回答に合わせ直したものにする。P は `pnlUsdc`、noop は除外。17 行列を誤差 1e-9 以内で再現する。帰無の対照（B′ の対比、過去の r2 対 r3 の再標本）での採用率が α + 5pt 以下、合成で +0.5 / +1.0 を注入したときの採用率が MC の予測 ±10pt に入る［Codex S2］。統計量と条件の変更（Step 6）は、走っている judge2/mc の作業が終わってから入れる。
- **判定則（Step 6 と第 4 章）を、1 段の開始前に commit hash で固定する**。前提条件は U4 の回答（第 6 章の表）。凍結時の commit hash と基準値を STATE に 1 行で残す。0 段は記録用なので先に始めてよい。
- Codex に 1 回だけ再レビューを頼む（上限 15 分、待つ間も lane は止めない）。

### Step 5 — 1 段（凍結後 → D1、8 セル）
- seed 1003〜1006 × F_P/F_D、arm = {B, B′, C1（launch のみ）, R, W}。
- C1 は各セルの launch scenario だけを走らせ、launch 以外は B のセルを使い回す（Step 2 のガードが崩れたら全レジームに戻す）。launch だけの scenario ファイル（1003〜1006、1011〜1014）はまだ無いので、凍結前に作る。
- **arm の締切**: 1 段に入れる arm は 10/23 22:00 までに review を通り、`feat/final-plan` に入っていること。間に合わない arm は落とす。
- 割り当て: mini A に 3 セル、mini B に 3 セル、laptop L に 2 セル。
- 共変量として、arm ごとの decide の p50 / p99（取り方は Step 4 の決定による）、同じ fee 同士の tie 勝率、R と W の点火とタグ付きの機構 PnL、host と load1 を記録する。

### 計算資源

| 項目 | 中身 | lane-h |
|---|---|---|
| 1 セル | B 12 + B′ 12 + C1 1 + R 12 + W 12 = 49 scenario | 約 10.6 |
| 1 段 | 8 セル | 約 85 |
| 1 段の容量（10/23 約 11:00 開始 → 10/25 08:00 の約 45 時間、推定） | mini A 約 45 + mini B 約 45（稼働率 100%）+ laptop 約 31（稼働率 70%） | 約 120 |
| 1 段の残り | W スクリーン、soak、再走を引いた余裕 | 約 25 |
| 2 段 | 1011〜1014 × F_P/F_D × {B, F}（16 行列）+ F_S 縮小版 + docker 2 本 | 約 45 |
| F2 を 2 段に並走 | F2 = C1 なら約 1.7、R / W なら約 21 | 1.7〜21 |
| 追試 | 1021〜1024 × F_P/F_D × {B, F} | 約 42 |

- 1 scenario はロスターの体数に関係なく約 13 分（block 時間で決まる）。1 行列 2.6 lane-h は実測で確かめた。
- 余裕は約 25 lane-h なので、W は 1 本だけにする（2 本目は +21 lane-h）。
- 新しい arm 1 本は 8 セル × 12 scenario × 13 分 ≈ 21 lane-h（3 lane で約 7 時間）。これが arm の締切を 10/23 22:00 にした理由。
- 10/25 08:00 以降は mini の 2 lane だけ（10/26 17:00 まで約 66 lane-h）。

### Step 6 — D1 判定（8 セルがすべて有効になった時点。見込み 10/24 夜（mini の 3 セル = 約 32 lane-h を 10/23 11:00 ごろから休みなく回した場合。凍結が遅れればその分遅れる）、遅くとも 10/25 08:00。judge2 で機械的に判定）
- **統計量**［Codex C1/S1］:
  - R と W: d = EW11(候補) − EW11(B)（launch を除いた 11 レジーム）。両者の launch のコードは C1 と同じか、機構が launch の外にあるため。
  - seed ごとに c_s = (d_P,s + d_D,s)/2。m = c_s の平均。
  - f = max(0.25, sd_s(c′_s))。c′ は同じ 11 レジームでの B′ の対比。
  - SE = max(sd_s(c_s), f)/√n、n は両 field が揃った seed の数（予定どおりなら n = 4 で √n = 2）。t = m/SE。
  - field を同じ seed で組にするので、field 間の共分散は c_s の中に入る。
  - 12 レジームの EW と公式の重み付き値は、報告用の数字として併記する。
- **R と W の PASS**（すべて満たす）:
  1. t ≥ t_crit（既定 1.64、t(3) で片側 10%）、かつ m ≥ 基準値。**基準値は U4 の回答で決まり、凍結の前提条件にする**。10/22 版で事前に決めていた既定は「U4 の承認があれば +0.20、なければ +1.0、+0.20 以上 +1.0 未満なら提出時にユーザーに判断を仰ぐ」。本プランは「+0.20、判断を仰ぐ帯なし」を提案するが、これは基準の緩和でありユーザーの判断なので、U4 で承認を得てから凍結する。承認が無いまま凍結する場合は 10/22 版の既定（+1.0 と判断の帯）で凍結する。+0.20 を提案する理由（+1.0 では検出力が足りない）: シミュレーションでは +1.0 の効果を検出する力が約 50% で頭打ちになり（ノイズを半分にしても 49%）、t ではなく基準そのものが効いてしまう。t_crit と基準値の最終値は Step 4 の MC で凍結前に決める。参考（1 段だけ、条件 1〜3）: 11 レジーム・基準 0.2 で +1.0 が 69%、+0.5 が 29%、効果ゼロが 5% 通る。12 レジーム・基準 0.2 では +1.0 が 31%。
  2. field ごとの下限: d̄_f + 1.64·sd_f/2 ≥ −0.5（F_D）/ −0.25（F_P）（launch を除いた統計量で）。点推定で判定すると、効果ゼロの候補が F_D で約 25%、F_P で約 23% 落ちる（launch を含めると約 33% / 39%）。
  3. launch 以外のレジームで「8 セル平均が −3.0 以下、かつ 6/8 以上が負」であり、**かつ** そのレジームでの slot のタグ付き機構 PnL（R のタグ、W の ouPnl 等の信号）の合計が負のもの、がない。機構の PnL が負でなければ、報告ではノイズとして記載する。帰属を問わない旧条件は効果ゼロの候補を 12.0% 落とした。W の cex-drift のセルは別に報告し、W の cex-drift には条件 3 をそのまま適用する。
  4. launch 以外の epoch で ΔP < −3,000 USDC のセルが 2 未満。
  5. slot の timeout 0、p99 < 500ms、tie 勝率の差（B 比）±10pt 以内、STF 0。
  6. launch の非劣性: 8 セルの launch の平均 ΔT ≥ −3.0、かつ STF 0。
- **C1 の PASS**: c1L の機構判定 (a)〜(d)（entry 後の STF 0、M1/M2 の約定数 ≥ B、launch ΔT 平均 ≥ −3.0）、かつ 1 段のセルでの launch 非劣性（8 セルの launch 平均 ≥ −3.0）、かつ条件 5。C1 の判定に 12 レジームの EW（m ≥ 0）は使わない。launch のノイズで結果がほぼ硬貨投げになるため（真の効果 +1.0 でも出荷率 44%、効果ゼロで 6.5%）。
- **選び方**: R と W のうち PASS したものの中で、launch 以外の m が大きい方を F、もう一方を F2。片方だけ PASS ならそれが F、C1 が PASS なら F2 = C1。R も W も FAIL で C1 が PASS なら F = C1。どれも FAIL なら S-00048 のまま。
- **独立の検算**: Claude と Codex がそれぞれ計算を検算する。食い違いは計算を直して解消し、多数決にはしない［Codex W6］。B′ の t も記録して報告に添える。

### Step 7 — 2 段と F_S（D1 → 10/26 約 17:00、mini 2 lane）
- **中身**:
  - 1011〜1014 × F_P/F_D × {B, F}: 16 行列。F2 は、F2 = C1（launch のみ）のとき、または容量があるときに、同じセルに並走させる。F2 を順に回す 2 段（seed 1015〜1018、10/28 締切）はやめた。
  - F_S: {launch, cdp-incident, lending-incident} × 1101〜1102 × {B, F}、12 scenario、約 2.6 lane-h。F_S のノイズモデルは F_D のコピーで仮置きなので、全レジームは回さない。
  - docker sandbox（上限付き）で launch と cdp-incident を 1 本ずつ［批評 4］。
- **判定**（1 段の seed は混ぜない。統計量と条件は Step 6 と同じ定義、f は 1 段の B′ から）:
  - R / W: t′ ≥ t_crit かつ m′ > 0［Codex W4］、加えて条件 2〜6。
  - C1: launch 非劣性と条件 5。
  - F_S: 平均 d ≥ −0.5 で、launch 以外で ΔP < −3k のセルがない。
  - 絶対値のゲート（G0 = public-60 での単独評価と、チェックリスト A の絶対条件）はやめた。B 自身が G0 に FAIL している（opus-1 Q0b で T 48.07 対 56.43、2 つの世界で FAIL）ので、F と B を区別できない。代わりに「B ≥ noop なのに F < noop になるレジームがない」を段のセルから読む。

### Step 8 — 梱包と提出（10/26 17:00 → 10/27 12:00。提出操作はユーザー）［批評 18］
- **梱包**: release worktree で `bundle:agent --submission` を実行し、次をすべて通す。
  - scan-submission で BLOCK 0、check:strategy
  - `constants.local.ts` が upstream とバイト一致
  - 測った commit と出荷 commit の diff が空（共通ルール）
  - 環境変数を設定しない状態で test が通る
  - `ci-local.sh --full`
  - docker selftest（`ascon/final/` に置いたスクリプトで）
  - `prepare-release.py` が READY
  - soak が PASS
- **提出の段取り**:
  - ZIP は SendUserFile で、sha と commit を添えて渡す。
  - 提出依頼には、比較方式（slot 入替）が「同居で比べる」方針から外れていること、その根拠（クローンの奪い合いによる偽の差）、基準値と t_crit を必ず書く。
  - ユーザーから受理メールの時刻と残り回数をもらい、記録表に追記する。

### Step 9 — 追試（10/26 17:00 → 10/27 約 14:00、約 42 lane-h）
- 1021〜1024 × F_P/F_D × {B, F}。
- 2 段と追試を合わせた 8 seed の launch 以外の推定で m ≤ 0 のとき、または機構の失敗（timeout、STF、crash）が出たときだけ、S-00048 に戻す。旧規則（4 seed で m < 0 または d̄_D < −0.5 なら戻す）は、真の +0.5 でも良い F を約 35〜40% 戻してしまう（正規近似、r2/r3 ノイズ）。
- **選択肢（U7 の時間帯の変更が要るのでユーザーの OK が必要）**: 提出を 1 回だけにして追試の後（約 10/28 12:00、10/29 の凍結前）に回すと、戻す経路そのものが無くなる。

### Step 10 — 上流の変化への対応と凍結（毎日 09:00 〜 10/31）
- upstream main（10/22 時点で `0922fa14`、#320 を含む。再確認はしていない）と次のファイルの diff を取る: `example/agents/lib/{markets,launchSwap}.ts`、`runtime/*`、`sdk/src/{constants,types,abis}.ts`。上流の PR #319、#321、#322、#324 の状態も確かめる（10/23 時点で未 merge）。
- F が import している symbol に変更があれば、smoke と selftest を回し、lib を agent dir にコピーした vendored 版 F_v を 10/29 までに用意する。
- **1 段に入れる arm の締切は 10/23 22:00**。それまでに review を通り `feat/final-plan` に入っていない arm は落とす。
- **10/24 23:59 は、評価中の arm の修正（修正版は新しい arm として新しい seed で測る）と、任意の R+M-OU 結合版（第 4 章）だけの締切**。武器探しの workflow が 22:00 以降に検証した武器は、記録するだけで作らない。
- 戦略コードの凍結は 10/29 23:59。最後の提出操作は 10/31 18:00 まで。

---

## 4. 提出の判断木

既定は何もしないこと（S-00048 のまま）。提出は 1 段階につき 1 回で、受理された ZIP の sha と commit を記録する。

1. **N0（済）**: 床は `2e5a0451`（= commit `8ff2e696`）。docker selftest PASS（4g、26 件 include、revert 0）。改訂の呼び出しは鍵なしで 401（想定どおり BLOCKED）。
2. **N1（閉じた）**: 推論キーと unit id の対応は確認できていない（U3 は skip）。どの arm も frozen で評価しているので、対応が崩れても評価した挙動そのものに戻るだけで、評価結果を裏切らない。P1 で出す。
3. **N2（D1）**: Step 6 の規則で F と F2 を決める。
4. **N3（D2、10/26 17:00）**: F が全ゲートを通れば、F を提出する（10/27 12:00 まで）。FAIL で F2 が並走で全ゲートを通っていれば F2。
5. **R と W の両方が PASS した場合**: F = launch 以外の m が大きい方、F2 = もう一方。任意で opus-1rg（R + M-OU の単純な merge、新しいパラメタなし）を 10/24 23:59 までに作ってよい。opus-1rg は 2 段だけで、B と、良い方の単独 arm の両方に対して評価する。
6. **N4**: R / W がどれも PASS しなければ、C1 の launch 限定の PASS が成り立てば C1 を出す。それ以外は S-00048 のまま。
7. **N5（10/27 夕）**: 2 段と追試を合わせた 8 seed の launch 以外の推定で m ≤ 0、または機構の失敗（timeout、STF、crash）が出た場合だけ、S-00048 に戻す。
8. **N6（10/30〜31）**: 上流の変化で F が壊れたと smoke で確認できた場合だけ、F_v を提出する（18:00 まで）。
9. **出さないもの**: r3s / r3b、fc、同居クローン条件だけの証拠、単一 seed の結果（W スクリーンを含む）、測った木と一致しない ZIP、ローカルでしか動かない環境変数に依存する版、`--blocks 60` の短縮 run だけの証拠。
10. **prompt**: どの出荷物も P1（U3 skip により既定どおり）。

---

## 5. 武器の機構

### R（r3 系譜）
- 機構と数値の正本は R 設計メモ §2〜§5 と `example/agents/opus-1r/agent.ts` の PARAMS。ここには要点だけ置く。
  - 2 脚のバンドルだけを出す（r3 の active での損失源である、小さな乖離での単脚は出さない）。
  - サイズ N* = R·e/4、上限 min($6k, NAV の 8%)。M1 の $1,125 の頭打ち（深さのフォールバック）を直す。
  - 入札は競合の最大 fee ×1.2 + 1 wei、上限 0.30E。最小エッジ 100bps かつ期待利益 $25。
  - ブレーキ: 片側だけ約定したバンドルを数え、20 件の窓・8 件以上・40% で 36 block 停止。
  - 深さは背景で取得してキャッシュし、decide() でブロッキング RPC を待たない。
- **土台は C1**。fc の cap とは混ぜない。R の寄与を R − C1 で測れるようにするため［Codex S3/W9］。
- **測るもの**［Codex S4］: 点火の頻度、点火した取引の増分正味 PnL、fee と revert の費用。tags に記録し、条件 3 の帰属に使う。
- **移植しないもの**: Stability Pool への預け入れ、flatten をしない持ち越し、r3 の launch module、場全体の混み具合で開く gate、本番 epoch の統計を持ち越して閾値を較正するやり方。
- R が壊してはいけない opus-1 の性質（cdp-incident、whale、crash）は R 設計メモ §5。

### W の候補
- **opus-1g**（C1 + M-OU）: fair は固定の anchor に向かう OU 過程（コードで確認: coordinator.ts の fairAnchor、rng.ts の nextFairPrice、kappa 0.02/block）。GMX でその平均回帰を取る。base ごとに想定元本 $40k、4 倍（ouNotionalUsd 40000、ouLeverage 4）。live week は epoch ごとに revert されるので、anchor を epoch の最初の fair から取るのは本番と整合する（コードを読んだだけで、**未検証**）。リスクは第 6 章。
- **ascon-zeta-r3k**（r3 + K1/K2/K3）: K1 単脚の下限 125bps、K2 小エッジのバンドルに自分の結果でかけるブレーキ、K3 E ≥ $168 で競合 ×1.2 の入札。branch `feat/zeta-r3k`、commit `7cc45752`（未 push かどうかは未確認。worktree の `sdk/src/constants.local.ts` が書き換わっているので、共通ルールの戻しが要る）。
- どちらも「commodity な土台 + 独自の武器」の方針に沿う。選び方は Step 2 の W スクリーン。

---

## 6. リスクと止める条件

| リスク | 止める・切り替える条件 |
|---|---|
| 統計の誤判定 | 判定則は 1 段の前に commit で固定する。結果を見た後で直した版は、新しい seed でだけ測る。判断木全体を MC で較正する |
| 判定則が検出力を持たない | launch を判定から外し、基準 +0.20 を U4 で承認してもらう。凍結までは MC で両方向に調整する |
| 計測の汚染 | check-collision と check-arm が必須（run-matrix の PASS だけでは不十分だと 808 で実証済み）。lane は 20 秒ずらす |
| 測った木と出す木の不一致 | 行列ごとに tree hash を記録し、出荷 commit との diff が空であることを梱包の条件にする |
| `constants.local.ts` の書き換え | commit と bundle の前に `git diff --quiet` を通す |
| p99 を測れずに R / C1 が BLOCKED | 凍結前に Step 4 の選択肢 1 か 2 を決める |
| 計算の遅れ | 1 段の arm の締切は 10/23 22:00。W は 1 本だけ。lane を空けないよう連鎖起動を使う |
| laptop の負荷が対比を歪める | laptop は 1 lane まで、L はセル単位、load1 < 10 で開始、L が動く間は laptop で他の重い作業をしない。host と load1 を共変量に残す |
| セッションの使用上限で作業が止まる | workflow の同時実行は約 8 agent まで、reviewer は Sonnet。lane は連鎖起動で回り続ける。引き継ぎは静かな時点（night1 の判定後など）で新しいセッションに行い、作業途中で自動圧縮に任せない |
| opus-1g の証拠が無効 | 既定長の slot ロスターの run だけを証拠にする。`--blocks 60` と同居 probe は判定に使わない |
| cex-drift での anchor の付け替え（M-OU） | cex-drift は 2〜4 個の episode があり、それぞれ確率 0.35 で anchor を付け替える（1 run で 1 回以上起きる確率 58〜82%）。付け替えた水準は残る（events.ts の anchorMultiplierAt）。M-OU は 10/23 22:00 までに止める規則を持つこと（例: drift 窓の後に \|fair − anchor\| が N block 広がり続けたら閉じる、epoch あたりの損失上限）。cex-drift の σ_P は 886（F_D）/ 2,534（F_P）USDC |
| GMX の執行コスト | keeper による執行の遅れ、fair に対する約定値、position fee、funding、ETH の執行 fee の消費、OI 上限での拒否を既定長の run から測る。ouEthReserveWei は 1 epoch 分の gas を賄うこと。position は oracle で評価されるので、強制決済は要らない |
| T の飽和 | z-score は T を頭打ちにする（9〜11 体の場で約 3σ）。M-OU の P の伸びは実際の場の T として読み、P から外挿しない。主張されていた epoch あたり +12〜14 T は桁が合わない |
| ローカルの場と本番の違い［Codex C7］ | ローカルの優位は逆転もありうる。3 つの場での非劣性を満たしたものだけを出す |
| 推論キーと unit id の不一致 | U3 は skip。frozen で評価しているので、対応が崩れても評価した挙動に戻るだけ。P1 で出す |
| install が 60 epoch 持ち越される | soak が BLOCKED なら、その測定を根拠にしない。P1 で install 0 件でも安全の証明ではないので、率の上限を報告に書く |
| Ollama の枠 | 週の無料枠は約 2,100 call（15 request = 0.7%、毎週補充、1 call $0.01 未満）。本番週は約 360 call、テスト約 200 で合計約 25%。自動チャージと残高は表示されない（無料プランと仮定） |
| mini のディスク | 空きが 10GiB 未満なら、新しい job を保留して知らせる |
| 凍結 commit での lib / sdk / runtime の変化 | 毎日 diff を取る。10/29 までに F_v を用意する。10/31 18:00 以降は提出しない |
| 開発がまったく実らない | 1 段の arm は 10/23 22:00、既存 arm の修正は 10/24 23:59 で打ち切る。その後は C1 と床の維持に集中する |

**ユーザーへの依頼の状態**（10/23 02:30 時点）

| | 依頼 | 状態 |
|---|---|---|
| U1 | 床の特定 | 済: `2e5a0451` |
| U2 | 推論キー、Ollama の枠 | 回答済み: 週約 2,100 call、毎週補充 |
| U3 | Discord #qa への投稿 | skip: operator の回答なしとして P1 で出す |
| U4 | slot 入替（同居比較からの逸脱）と統計基準の承認。本プランで確認する中身: slot 入替、判定の統計量を EW11（launch を除く 11 レジーム）にすること、基準 +0.20 で判断の帯を置かないこと | **回答の中身の記録が見つかっていない**（STATE の 02:30 は「U1〜U9 はすべて閉じた」と書くが、U4 の回答は書いていない。10/22 15:00〜17:39 UTC の発言でも見つからない。AskUserQuestion の回答として別にある可能性はある）。**凍結の前に**回答を確かめ、STATE に「U4: 回答と日時、またはユーザーの言葉」を 1 行書く。回答が無ければ、+1.0 にしたときの検出力（約 50% が上限、Step 6）を添えて聞く。聞けないまま凍結するなら 10/22 版の既定（+1.0 と判断の帯）にする |
| U5 | laptop を lane に使ってよいか | 承認: 10/25 まで 3 本目の評価 lane |
| U6 | mini に鍵の symlink を張る | 未実施なら soak は laptop L で行う |
| U7 | 提出操作。時間帯: 10/26 夕〜10/27 12:00、戻す場合は 10/27 夜、F_v は 10/31 18:00 まで | 追試の後の 1 回提出（約 10/28 12:00）に変える場合は OK が要る |
| U8 | lib の STF バグを upstream に報告するか | 既定: 報告しない |
| U9 | trial 環境で C1 を走らせてよいか | 承認の記録なし → 既定どおり走らせない |

---

## 反映しなかった指摘

- **Codex C3「seed の分離はすでに漏れている」**: 計画時点では run を 1 本も走らせておらず、漏れは起きていなかった。重なっていた C1 の launch 検査と soak の seed は、どちらも未使用の seed に移した。
- **批評 2 の偽薬の作り方（1 wei 上乗せ / 1ms 遅延）**: どちらも同じ fee 同士の順位に偏りを生む（r3s は 2〜4ms の遅れで tie に約 2:1 で負けた）。代わりにサイズ ×0.999 を使った。
- **Codex S1「再走のばらつきを B 対 B の再走で測る」**: quiet はほぼ決定論的なので、B 対 B の再走からは情報がほとんど出ない。4 seed での B′ の対比で代えた。
- **Codex W1「EW が主指標で良いかは条件付き」**: 主指標は EW（判定は launch を除いた EW11）のままにする。本番のレジームの順は無作為で非公開。改訂による非定常性は凍結した backtest ではモデル化できない。公式の重み付き値は併記する。
- **Codex C7「もっと代表的な場を足す」**: 計算資源に余裕がないので足さない。リスクの扱いを「逆転もありうる」にした。
- **批評 6「R も trial 環境で裏を取る」**: 採らない。公開される blocks.csv から、締切前に他チームへ入札ルールが見えてしまう。trial 環境の確認自体も U9 が既定（走らせない）になったのでやめた。
