# D1・2 段後の提出チェックリスト

## 前提

- 現在の提出は **ASCON-S-00063 = opus-1r（R）**（2026-10-26 受理）。詳細は下の「提出記録」。直前の提出は S-00048 = opus-1（B、ZIP sha `2e5a0451`、commit `8ff2e696`）。
- **既定は何もしない。** PASS だけでは提出せず、Claude が材料を示し、ユーザーと一緒に決める。
- コード凍結は **10/29 23:59 JST**。提出期間の終了は **10/31 23:59 JST**（受理メールの記載。評価対象は期間終了時点の最後に受理された 1 件）。当方の運用上の最終操作目安 10/31 18:00 JST は残す（余裕を持たせるための内部期限）。
- 判断の正本は [plan-final](plan-final.md) の Step 6〜8 と「4. 提出の判断木」。F/F2、C1 への分岐も正本に従う。
- 評価の読み方は [final README](../ascon/final/README.md)、梱包は [eval README](../ascon/eval/README.md) の Release helpers を参照。

## 判断の材料（Claude がユーザーに示す）

- [ ] R / W1 / W2 ごとに D1 と 2 段の verdict、m、t、条件 5、未実施項目を並べる。2 段は m′・t′ と明記する。
- [ ] `t_crit = 0.94`、D1 は `m ≥ +0.20`、2 段は `m′ > 0`。小標本 guard と他の条件も正本どおり確認する。
- [ ] 機構指標：timeout、B 比の tie 勝率差、STF、機構別 PnL。条件 5 の p99 は理由付き `NOT_MEASURED`（参考扱い）を明記する。
- [ ] 比較は slot 入替。同居比較から変えた理由は、近縁クローンの奪い合いによる偽の差を避けるため、と説明する。
- [ ] Docker selftest の対象 arm・commit・結果・ログを示す。未実施を PASS と扱わない。
- [ ] 評価 commit と出荷 commit の差分結果を示す。許す差は対象 arm の `prompt.md`（P1）だけ。
- [ ] Step 8 の残りの条件（scan、check:strategy、constants、環境変数なしの test、ci-local、READY、soak）も確認する。

## 準備済み ZIP

以下は `feat/ship-prompts` の `63257148` から作った ZIP の記録。評価・提出の PASS を意味しない。
arm dir は `example/agents/` 配下。

| 候補 | arm dir | release commit | ZIP sha256 |
|---|---|---|---|
| R | `opus-1r` | `63257148` | `53665ecb0df2a7a677ba06db0db3e36219d618d2ad9114c8cab06c3af328cfc1` |
| W1 | `opus-1g2` | `63257148` | `900b4ec100ef08ff9708064c53da201cbee1e72d7ad8fc97969315bcc971795a` |
| W2 | `ascon-zeta-r3k` | `63257148` | `32cb272a696318797c48f1ddc38f9fb1b1f0c83c2e783ba7f2f6623d43809afd` |

ZIP の sha256 は作るたびに変わる（ZIP に作成時刻が入るため。中身は同じでも変わる）。提出するのは実際に作った1つの ZIP で、その sha256 を記録する。merge 後など出荷 commit が変わったら作り直す。

## 手順（共同で「出す」と決めた後）

1. 稼働 lane 以外の checkout で `bash ascon/eval/release-bundle.sh <arm> <commit>` を実行する。`RELEASE_PASS` と receipt の arm・commit・ZIP sha256 を確認し、提出用の記録を更新する。
2. 同じ arm・commit で `bash ascon/eval/docker-selftest.sh <arm> <commit>` を実行し、`SELFTEST_PASS` とログを残す。
3. 各評価 commit と出荷 commit を、下の plan-final のコマンドで比較する。置換後に実行し、出力なしを確認する。1 行目で BLOCKED が出たら停止し、2 行目には進まない。git 自体の失敗は合格にしない。

   ```sh
   git diff --name-only <測った commit> <出荷 commit> -- example/agents/<arm> example/agents/lib example/agents/runtime sdk core > /tmp/ascon-release-diff.out || echo BLOCKED
   grep -vxF example/agents/<arm>/prompt.md /tmp/ascon-release-diff.out
   ```

4. Step 8 の全条件を確認し、ZIP・commit・sha256 をユーザーに渡す。**フォームから提出するのはユーザー。Claude は提出しない。**
5. 受理メールを確認し、受理された ZIP の sha256 が記録した sha256 と一致することを確認する。確認できなければ受理確認は未完了。
6. 提出 ID、受理時刻、残り回数、arm、commit、ZIP sha256、確認ログの場所を docs に記録する。

## 止める条件

- 提出対象の必須チェックに `FAIL` / `BLOCKED`、または未確認がある。
- 上の比較範囲で、対象 arm の `prompt.md` 以外に差分がある。
- 提出用・受理済み ZIP の sha256 が記録と一致しない。

止まったら提出を進めず、現在の提出を維持する。提出後の不一致は未解決として記録し、対応をユーザーと決める。

## 提出記録

| 項目 | 値 |
|---|---|
| 提出 ID | ASCON-S-00063 |
| 受理時刻 | 2026-10-26 13:44:13 JST |
| 受理時点の同日残り提出回数 | 4 回（受理メール記載の確定値。以後の提出で変わる） |
| arm / commit | `opus-1r` / `defdb86e3b44401eddb50d7d2b7a382c743d003d` |
| 提出した ZIP の sha256（想定） | `b52b028b715acfb84fd099c364293e92beb8cb4d582e51b2f1a5f7c3e8e73626`（472,635 bytes） |
| 直前の提出 | ASCON-S-00048 = `opus-1`（commit `8ff2e696`） |

- 受理メールに ZIP の sha256 は記載されていない。提出した ZIP が上の sha256 のものである根拠は、提出者（ユーザー）がこのファイルを選んだという申告のみで、運営側の記録との照合は未実施。
- 測った commit（mini の lane 作業ツリー `9e332b3e`）と出荷 commit `defdb86e` の差分は、手順 3 のコマンドで `example/agents/opus-1r/prompt.md` のみと確認した（出力の保存先は各自のアーカイブ）。
- 受理メール本文は保存済み。評価の証拠一式（stage 2・追試・機構指標・ZIP・receipt）は各自のアーカイブ `~/ascon-cleanup-saved/2026-10-26/` にある（リポジトリには含めない）。
- 判断時点で未実施・未達だった項目: soak は 1 条件のみ（calm、seed 1205、30 呼び出し）、p99 は `NOT_MEASURED`、prepare-release の READY は取得できず、CI はアカウントの利用上限で一度も実行されていない。

