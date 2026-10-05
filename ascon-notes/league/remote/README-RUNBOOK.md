# ASCON 計測の遠隔・常駐運用 Runbook（mini 常駐 + Air 併用）

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
