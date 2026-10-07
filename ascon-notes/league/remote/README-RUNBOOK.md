# ASCON 計測の遠隔・常駐運用 Runbook（mini 常駐 + Air 併用）

再発防止・固定chunkテンプレート・診断/資格の再開規則: [OPS-LESSONS-2026-10-06.md](../OPS-LESSONS-2026-10-06.md)（`chain-template.sh` / `test_chain_template.py`）。

作成: 2026-10-05（Claude が Codex 作成のスクリプトを検証して整備）。状態: **仕組みは作成・オフライン試験済み、mini での実機運用は未検証。**

## 1. 役割
| ホスト | 役割 | 備考 |
|---|---|---|
| mini (`macmini`, user `masa-ws1`) | 常時稼働。自分のキューを常に回す | 12コア/64GB。gbrain/openclaw の常駐ジョブと同居。空きディスク約 51GB（停止下限 25GB） |
| Air | 起きている間だけ別のキューを回す | G0 は Air（並列3）で校正された |

- **1ホストで同時に走らせる計測は1本だけ**（G0 は他の負荷が無いことを前提にする）。`job-queue.sh` は `~/ascon-run/host.lock` で二重起動を拒否する（試験で確認）。
- 2台で**同じ世界を二重に走らせない**。ジョブIDを分けて割り当てる。「ダブル」とは、別々のジョブを2台で並行して回すこと。同じ試験を2台で複製することではない。

## 2. 重要な制約（結果の読み方）
1. **G0 は各ホストで別々に合格が必要。** G0 は Air で校正された条件（並列3・360ブロック/2秒・p99<1000ms）。mini は常駐ジョブがあるので、mini 固有の G0 簡易確認（`ascon-notes/league/load-probe.sh`）に通ってから、そのホストの結果を採用する。
2. **資格試験（60世界）は1ホストで全部走らせる。** 世界を2台に分けると G0 の条件がそろわない。分けるなら、結果を見る前に契約を改訂する。
3. **Air が閉じる/スリープすると Air のジョブは止まる。** mini は止まらない前提で設計されているが、mini の再起動後は launchd で自動再開する（KeepAlive）。完了済みの世界は再実行しない（試験で確認）。部分的に終わったジョブは、整合が取れないと全体再試行を拒否して止まる（STOP が立つので人が確認する）。
4. mini 上の結果は編集しない。Air へは `pull-results.sh` で読み取り専用に取り込む。

## 3. 構成物（このディレクトリ）
- `job-queue.sh` : キュー実行。`init` / `enqueue` / `run [--once]` / `status` 等。状態は `queued/running/done/failed`。
- `queue.py`, `matrix_worker.py` : 状態管理と実行の本体。停止条件は G0 が PASS でない、violations>0、（診断のみ）revert>0、ディスク<25GB、期限超過。
- `mini-bringup.sh` : mini 上で前提を点検するだけ（自動インストールなし）。`--install-foundry`（brew install foundry）と `--npm-ci`（`NPM_CONFIG_IGNORE_SCRIPTS=true` で npm ci）は明示指定のときだけ実行。
- `local.ascon-queue.plist.template` : launchd（KeepAlive、Nice 10、低優先度 I/O）。`__REPO__` `__HOME__` `__NODE_BIN__` を置換して `~/Library/LaunchAgents/` に置く。**読み込み（bootstrap）は未実施。**
- `pull-results.sh`, `status.sh`。
- `test_queue.py` : オフライン試験（12件、ロック二重起動の拒否・ディスクガード・終了済み世界の再走拒否・実行中のディスク低下での停止を含む）。

## 4. 手順（mini）
1. 前提点検: `bash ascon-notes/league/remote/mini-bringup.sh`（不足を表示するだけ）。
2. 必要なら `--install-foundry`（brew）と `--npm-ci`。
3. キュー初期化と投入: `job-queue.sh init <queue> <plan> mini <repo>` → `enqueue <queue> <job-file>`。ジョブは COMMIT 固定（HEAD と一致しないと実行しない）。
4. 最初の1本は G0 簡易確認（smoke）にする。通ってから診断/資格のジョブを入れる。
5. 常駐化: plist を置き `launchctl bootstrap gui/$(id -u) ...`（本人の了承後）。
6. 結果の取り込み: Air から `pull-results.sh`。

## 5. 検証状況
| 項目 | 状態 |
|---|---|
| bash 構文・shellcheck・型検査 | PASS（Codex 実行を Claude が再実行して確認） |
| オフライン試験 12/12 | PASS（1件は macOS の killpg 権限エラーが原因の不具合で、修正後に PASS） |
| mini 上の foundry/npm ci | **未検証**（brew install foundry は開始済み、完了未確認） |
| mini の G0 | **未検証** |
| launchd 読み込み・自動再開 | **未検証** |
| 実 rsync 取り込み | **未検証** |

## 6. mini 環境の作り方（2026-10-06 に実施した手順・実績）
mini は Intel (x86_64) で、Air は Apple シリコン。次の差があるので、Air の成果物をそのまま持ち込めない。
1. foundry: `brew install foundry`（1.8.4）。ただし Air の状態ダンプ（anvil 1.2.3 で生成）は 1.8.4 で読めない（`data did not match any variant`）。
2. anvil 1.2.3: 公式リリース v1.2.3 の darwin_amd64 を取得し、`anvil` だけを `~/ascon-run/bin/` に置く。コミットが Air と同じ `a813a2ce` であることを確認。libusb の参照が `/usr/local/opt/...` なので、`install_name_tool -change` で `~/.homebrew/opt/libusb/lib/...` に直し、`codesign --force -s -` で署名し直した（元は `anvil.orig`）。環境変数 `DYLD_*` は /bin/sh 経由で落ちるため使えない。
3. 状態ダンプ: Air の `backtest/state/{manifest.json,venues-state.json}` を scp で mini の `~/ascon-run/ascon/backtest/state/` へ（sha256 一致を確認）。大きいファイルは `.part` に送ってから sha256 照合後に rename。`rsync -e 'tailscale ssh'` は固まったので使わない。
4. `PATH` は `~/ascon-run/bin` を先頭に、nvm の default node、`NPM_CONFIG_IGNORE_SCRIPTS=true`。`npm ci` は `mini-bringup.sh --npm-ci`、コントラクトは `npm run build:contracts`。
5. 注意: Air と anvil のビルド（x86_64/arm64）・CPU が違うので、mini の結果は Air の結果と数値を直接比較しない（相対 T は同一ホスト・同一場の中だけで意味を持つ）。G0 は mini 固有の確認が必要。

## 7. Detached chain launch（2026-10-07 additions）

ハーネスの `run_in_background` で起動した計測が、セッション再起動時に exit 143 で終了したという運用報告を受けた。長時間のchainはmini上のシェルで **nohup + stdinを `/dev/null` + caffeinate + chain自身のend marker** を使って起動する。以下は実行手順の例であり、この変更ではSSH接続・実計測・切断後の生存確認は実施していない。

```bash
# mini上で実行。repo/roster/activityは実際の固定済み計画に合わせる。
export PATH="$HOME/ascon-run/bin:$HOME/.homebrew/bin:$HOME/.foundry/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use default || exit 1
export NPM_CONFIG_IGNORE_SCRIPTS=true

repo="$HOME/ascon-run/p60"
roster="/absolute/path/roster-fref-p60-r3.yaml"
runid="p60-$(date -u +%Y%m%dT%H%M%SZ)"
logroot="$HOME/ascon-run/chain-logs"
mkdir -p "$logroot"
nohup caffeinate -i /bin/bash "$repo/ascon-notes/league/remote/chain-template.sh" \
  --repo "$repo" --roster "$roster" --prefix "$runid" \
  --seeds "62001 62002 62003 62004 62005" \
  --log-root "$logroot" --lock-dir "$HOME/ascon-run/measurement-host.lock" \
  --activity-note 'host idle; scheduled jobs paused; record actual confirmation time' \
  </dev/null >"$logroot/$runid.launch.log" 2>&1 &
printf 'launcher_pid=%s runid=%s\n' "$!" "$runid"
```

nohupはSIGHUP、caffeinateは計測中のidle sleepへの対策。SIGTERMを送るハーネスのcleanup、ホスト再起動、電源断まで防ぐものではない。プロセス寿命がセッションに束縛されるハーネス経由で起動せず、mini上の独立した起動手順を使う。`CHAIN_END_<runid>=0` を `$logroot/$runid/end.marker` と `chain.log` で確認し、全chunkのG0記録も確認する。markerがない場合は未完了扱い。起動コマンドの終了やPIDの表示だけでは完了ではない。preflightの早期拒否はlaunch.logだけにmarkerが残る場合もある。

chainはrun headerに1行の `LAUNCH_ENV PATH_head=... stdin_tty=yes|no` を残す。TTYなら `WARN stdin is a tty`。`stdin_tty=no` はnohup/caffeinate使用や切断後の生存を証明しない。PATH先頭はBash `%q` でエスケープし、全環境のdumpは行わない。

manifest beginより前に `command -v anvil/node/python3` を検査し、解決先を `PREFLIGHT <tool>=<path>` として表示・保存する。欠落は `STOP: required command not found in PATH: <tool>`、専用exit **3** で終了する（通常のガード拒否は2）。dry-runも同じ検査を行う。実行可能性・バージョン互換性まで証明する検査ではない。

**forgeを要求しない理由**: `run-league.sh` → `ascon-notes/eval/run-matrix.sh` → `npm run backtest`（`core/src/cli/backtest.ts`）の経路は既存stateとビルド済みartifactを読む。chainもこの経路もforgeを起動しない。`package.json` の `build:contracts` は別の準備工程でのみ `forge build` を使う。依存導入、npmとその依存パッケージ、artifact/stateの準備は従来どおり事前に必要。

macOS（`uname -s=Darwin`）でtmutilが見つかれば、各容量検査で `tmutil listlocalsnapshots /` のヘッダ・空行以外を数える。10件以上は `WARN local TimeMachine snapshots=N`。空きがMIN_FREE_GB未満ならSTOPに件数と「snapshotの見直し/間引きまたはTime Machine backup完了後にdf再確認」の対処を添える。tmutilの失敗は件数unknownの警告、tmutilなし・Linuxでは通常の容量検査を継続する。自動削除しない。件数は保持容量や容量不足の原因を証明しない。

## 8. 保存されたmixed-field集計

`agg_mixed.py` は標準ライブラリのみを使用する。repo rootとindex TSVを渡す。indexは次のヘッダをこの順に持ち、`run_dir` はrootからの相対パス、`summary.json` は各run_dir内に置く。index自身の相対パスもroot基準。複数chunkのindexはこの形の単一TSVにまとめて、元summaryと一緒に保存する。

```text
chunk	regime	seed	run_dir	exit_code
1	calm	63001	runs/example-world	0
```

```bash
python3 -B ascon-notes/league/remote/agg_mixed.py /absolute/repo /absolute/mixed-index.tsv
python3 -B ascon-notes/league/remote/agg_mixed.py /absolute/repo /absolute/mixed-index.tsv \
  --paired ascon-zeta-r3 venue-arb
```

出力は **SIMPLIFIED T (not the official weighted T)**。各worldの全 `agents[]`（noopを含む）の `pnlUsdc` をPとして、`50+10*(P-mean)/pstdev`（母標準偏差0なら50）。worldを等重みとし、agent別にmeanT、mean(P-noop)、P<noop件数/世界数を表示する。ALLと、**loopIterations==362だけ**に限定した表を併記する。後者もexit_code/violationsによる除外はしないため、資格合格表ではない。loopIterations不一致・非ゼロexit・violationsのworldはWARNで列挙する。これらは診断結果として表示し、集計CLI自体はexit 0。

`--paired A B` は両表について同一world内のT(A)-T(B)を集計する。n、平均差、標本標準偏差/√nのSE、平均±2SEの概算95%区間、正の差のwins/n（同点は勝ちに含めない）、regime別平均差。n<2のSE/区間はNA。regime相関や公式epoch重みを反映した推論ではない。

不足/不正summary、非数値P、noop欠落、world間のroster不一致、重複world/run_dir、root外のrun_dir、不明なpaired agentは `STOP` / exit 2。黙って母集団を縮めない。既存の参照値は `../results-2026-10-06/mixed-field-36worlds.txt` に保存済みで変更していない。今回の数値確認は3world×4agentの手計算fixtureのみ。実36worldの再集計は未実施。

repo rootからのオフライン検証:

```bash
python3 -B -m unittest discover -s ascon-notes/league/remote -p test_chain_template.py
python3 -B -m unittest discover -s ascon-notes/league/remote -p test_agg_mixed.py
bash -n ascon-notes/league/remote/chain-template.sh
```

## 9. 固定相手の既知 telemetry BLOCKED に限る診断続行

runtime は upstream と同一のままで変更できないため、これは **診断専用の暫定回避策**。
公式・gate・qualification 実行は影響を受けない。生成側で拒否行に `round` を記録する恒久修正は、引き続き upstream コード側の検討事項である。

通常の chain 引数に `--mode diagnostic --continue-on-opponent-telemetry-blocked CANDIDATE_ID` を追加する。
`CANDIDATE_ID` はディレクトリ名ではなく roster 内の正確な候補 ID。最初の matrix より前に begin manifest から候補と残りの固定相手・roster hash・agent tree を `telemetry-context.json` に固定し、後続 chunk でも一致を要求する。`baseline: false` から候補を推定しない。diagnostic 以外では STOP / exit 2。

matrix / manifest verify が成功し、G0 の JSON・終了コード・世界別理由が整合するときだけ分類する。
BLOCKED 世界の該当相手の原ログ全行を読み、唯一の欠陥が既知のゼロ数量 `gmxDecrease` 拒否（`kind=mempool,event=rejected,action` あり、`round` なし、理由 `sizeDeltaUsd must be positive`）の場合に限り次の未実行 chunk へ進む。候補・不明 ID・他の欠損・破損・FAIL 混在・記録失敗は停止。両方の続行フラグを付けても FAIL+BLOCKED 混在は許可しない。

各承認世界・相手について `DEVIATION diagnostic continuation; G0=BLOCKED; world=<regime>/<seed>; agent=<id>; eligible_for_gate=false` を標準出力と `chain.log` に残す。chunk は BLOCKED のまま、後続 PASS/FAIL で上書きせず、最終 exit と `CHAIN_END_<runid>` は **2**。フラグなしの停止挙動、既存 `--continue-on-g0-fail` 単独の挙動は変わらない。

chunk ログの隣に `*-g0.json`（原出力）、`*-g0.log`（状態表示）、`*-classifier.json`（承認/拒否、承認時は世界・agent・原ログパス/hash・行番号・理由・BLOCKED 世界数と全世界数）、`*-classifier.log` を保存する。原ログは修復せず、そのパスの証跡を保持する。診断集計ではこの欠測世界一覧と母数を必ず併記し、除外して「36世界合格」と報告しない。既存 report/ledger の非 PASS 抑止は維持する。

オフライン検証は `python3 -B -m unittest discover -s ascon-notes/league/remote -p 'test*.py'`。
合成 fixture とスタブ runner による検証であり、実36世界・実 G0・実機継続は未検証。

### 既知の限界（`--continue-on-opponent-telemetry-blocked`、独立レビューで指摘された確度の低い点）

- 候補の席は、操作者が指定した ID を信頼する。roster に候補のような席が複数あると、指定した 1 つ以外はすべて「固定相手」として扱われ、その席の既知の欠陥も承認される。起動前に roster で、候補が 1 つだけであることを確認する。
- 分類器は、G0 が読んだ後にログを読む。G0 と結び付けて固定しているのは `index.tsv` のハッシュだけで、ログ自体は固定していない。検査と記録のハッシュの間にも、わずかな時間差がある。測定ホストを占有している前提（他の作業がログを書き換えない）に依存する。
- どちらも診断用のチェーンだけの問題で、公式・ゲートの経路には適用されない。

