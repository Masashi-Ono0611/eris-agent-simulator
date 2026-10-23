# D1・2 段後の提出チェックリスト

## 前提

- 現在の提出は **S-00048 = opus-1（B）**。ZIP sha は `2e5a0451`（短縮）、commit は `8ff2e696`。
- **既定は何もしない。** PASS だけでは提出せず、Claude が材料を示し、ユーザーと一緒に決める。
- コード凍結は **10/29 23:59 JST**、最後の提出操作は **10/31 18:00 JST**。
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

以下は `feat/ship-prompts` の `09f6869d` から作った ZIP の記録。評価・提出の PASS を意味しない。
arm dir は `example/agents/` 配下。

| 候補 | arm dir | release commit | ZIP sha256 |
|---|---|---|---|
| R | `opus-1r` | `09f6869d` | `f8d1a920ae25ac23af6a59fe52a5e6109e1a4cb660e158b68039d815de481ab7` |
| W1 | `opus-1g2` | `09f6869d` | `615c8d900a71005bae75b0a21ad2efa4b081a59761d49eb7b3d871faefed0994` |
| W2 | `ascon-zeta-r3k` | `09f6869d` | `6fe24f049a0541a038b2aae01fe49797437f50b81531192bff7aacd47ff16d21` |

merge 後など出荷 commit が変わったら ZIP を作り直し、新しい commit と sha256 を記録する。

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

止まったら提出を進めず、S-00048 を維持する。提出後の不一致は未解決として記録し、対応をユーザーと決める。
