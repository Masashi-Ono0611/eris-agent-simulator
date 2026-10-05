# xa-1 — 候補 A と dev6s 修理

[PLATEAU §3 A](../../../ascon-notes/league/PLATEAU-ANALYSIS-2026-10-04.md)
の独立実装。xb-r の置換・昇格・Q0 合格ではない。性能判断は行わない。
2026-10-04 の dev6s（元コード `7179efe`）の G0/確認待ちを修理。
upstream-eval は読取専用。コミット・チェーン起動・フル npm test は行わず、
次のスモーク前にユーザーがコミットする。

## 独自設計と台帳

意思決定は新規の「完全な往復計画 → 入口確認 → lot 回収 → 出口確認」。
初版は **買いから始める単脚往復のみ、同時 1 lot、1 pending** とする。
売りから始める初期在庫の借用は実装しない。exact-input の買戻しによる
不足数量・端数債務を避け、元から持つ WETH/WBTC は一切売らない。
参照 multi-arb/clean-arb のコードは読込・移植していない。

xb-r から複製したのは市場デコード、WBTC の canFund 用桁正規化、入札の
経済上限、SDK 実行先別の競合入札取得のみ。xb-r の候補列挙・順位・サイズ・
在庫帯・冷却・復元判断を継承せず、共通ファイルも変更していない。
runtime import は SDK の公開定数/型と `../lib/affordable.js`。

| 記録 | 定義 |
|---|---|
| `initial` | 最初の有効観測の USDC/WETH/WBTC/native ETH。WETH/WBTC は固定アンカーで、後続の損益・追加在庫から分離 |
| `pending` | entry/exit、送信観測 block、exact-input action、送信前全残高、予約した Plan。未確認時は予約解除・再送・新規を禁止 |
| `unresolved` | 8 block の確認期限を超えた予約。新規を停止し、同じ exact-input 基準で遅延約定を追跡。未確定の exit は再送しない |
| `Plan` | 入金額、入口/予定出口、予測数量、独立に前払い可能な base 数量、両脚分 gas、往復費用控除後見積、固定損失枠、回収期限 |
| `lot` | 実 USDC debit、**実 base 増分**、実 gas ETH 減分、確認 block と期限。初期保有は数量に含めない |
| `lastClose` | 実 cashOut−cashIn−両脚実 gas の時点 USD 換算、gasWei、保有 block 数。`closed` と lot id で重複ログを除外可能 |
| `lossSpent` | 閉鎖した lot の負の実現純損益だけを累積。勝った lot で枠を補充しない |

次の観測の exact-input debit、正の受取数量、gas 減少、他方の base 不変を
すべて照合して初めて pending を解除する。遅い観測でも一致すれば照合するが、
**時間経過だけでは予約解除しない**。送信観測から **8 block** で通常の
`pending` を `unresolved` に移し、その run の新規を停止して回収専用にする。
遅延した入口が exact-input として確認できれば、その実増分だけを期限回収する。
遅延した出口は一度だけ計上する。gas のみの減少、部分 debit、外部資金移動、
変化なしは失敗確定と見なさず予約を維持する。入口・出口とも同じ基準。
`decide` は送信 hash/receipt を受け取らないため、これは残高確認であり、
receipt を取得したという意味ではない。SDK/runtime は変更していない。

## 計画・回収条件

入口は fee 控除後の fair に対する割安幅が `ENTRY_BPS` より大きい場合のみ。
買い数量・出口の売却収支には各 venue の fee、数量による価格影響、各脚 20bps の
slippage を計上する。出口が **現在の fair に戻る** 仮説での往復利益から、
入口入札 gas＋出口 ceiling gas＋6 block×1bps の保有 haircut を差し引き、
$0.05 以上を要求する。将来 fair を参照せず、予測を実現利益として扱わない。
さらに現在の価格と両脚の必要入札でも、即時回収損失が固定枠内であることを確認。

サイズは最大 $1,000、流動資産の 8%、cash の 90%、初期 base の 10% 相当、
入口深さの 0.5% の最小値から 1 / 1/2 / 1/4 を列挙し、往復純利益で選ぶ。
出口も全 lot が深さの 0.5% 以内で処理できる必要がある。$50 未満は新規不可。
予測買い proceeds で資金確認を通さず、入口時点の cash と base の両方で
`canFund`・実額を検査する。base 予約の上限は初期量の 10%、出力増加の余裕は
0.8%。入口確定後は実増分を回収対象とし、予約超過なら回収だけを許して停止する。

native ETH は $0.05 ではなく **0.05 ETH** を常時残し、入口前に
200k gas×runtime priority ceiling を両脚分予約する。実入札は
`max(正の default floor, 実行先の競合 + 0.1gwei)`。
ceiling または xb の「floor＋見積利益の 10% 以内の追加費用」上限を超えたら見送る。
上限までの値下げ入札、priority 0、利益を 0 と偽装した強制売却はない。
出口は入口で固定した正の利益見積を入札上限に使い、**実際の出口 gas と往復収支を
別に再検査**する。現在の出口でこの入札・資金・流動性を満たせなければ保有を継続する。

入口後は出口だけを検討する。出口単脚が fair 比で負 edge でも、実入口費用を含む
往復純利益が $0.05 以上なら全 lot を回収する。通常時に損失回収は行わない。
期限では `min(元本の2%, $20, 残りepoch損失枠)` 以内の見積損失だけを許す。
epoch 損失枠は $60。損失枠とガス枠は入口時に固定し、AI は変更できない。
実測損失/gas が予約を超えた場合は、閉鎖後の新規も停止する。

期限は `min(入口送信block+2+6, 入口確認block+6)` と期末回収開始時刻の早い方。
新規は残り **12 block 以下では停止**。epoch/day の早い境界を使い、残り
**4 block 以下で回収を優先**する。残り 1 でも安全に回収可能なら送信するが、
包含は保証しない。残り 0 では残高照合だけを行い、新たな注文は出さない。
未知の horizon も新規/出口送信を停止。巻き戻りでは予約を保持し、新規停止。
runId は別 run の状態初期化のための等値比較だけに使う。

## 診断ログ・決定論・限界

`ctx.log` は整数の `round = Number(obs.blockNumber)`、action、短い状態要約を
記録する。initial/wallet/pending.before/plan 全体は繰り返さない。実際の観測残高は
初回と変化時だけ `state.observed` に出す（照合済み台帳の wallet とは別）。
未回収数量、確認待ち、停止理由、回収期限、実現往復損益を確認できる。環境変数、乱数、seed、
regime、未来イベント、候補 identity は意思決定入力にしない。競合は観測 block
に固定した 1 回の公開 getBlock から取得し、750ms の読取失敗/不完全結果は保守的な
aggregate に戻す。自身を除き、router/vault/direct pool の全 tx を対象とする。

残高だけでは未送信/送信前失敗/滞留を区別できない。8 block で通常待機は
打ち切るが、期限は取消証明ではない。未約定のままなら `unresolved` の予約は
run 終了まで残り得る。遅延約定は回収可能であり、期限による二重送信や新規再開はしない。
SDK に sender の確定結果を返す口がないため、送信失敗を確定して再開する修理とは区別する。
1 lot 制約、買い始点限定により売り始点・同時機会を取り逃す。
初期値と pending は process 内状態であり、途中再起動からの復元は未実装。
診断は epoch ごとの新規 process と専用 wallet を前提とする。

深さ fallback $300k、簡略 impact、200k gas、slippage モデルは実行保証ではない。
SDK は送信時に別途 quote するため、観測後の価格変化・競合・quote の差・gas 超過で
損失枠を超える、revert する、期末に lot が残る可能性がある。出口不能なら新規を
停止したまま残量を記録し、損失枠を外して閉じない。外部コントラクトは作らない。
gas の時点 USD 換算は期末一括 valuation と異なるため、gasWei も保存し、P−noop は
runner の期末価格で別計算する。安全機構の単体検証と凍結 Q0 の実測合格は別。

## 軽量検証

`test/xa-1.test.ts` は **47 件（元39件＋8件）**。確認期限に達した既存テストは
予約の移動先 `unresolved` を検査し、同じ残高安全条件を維持する。
`test/xa-1-red-controls.mjs` は **47 赤対照（既存39＋追加7＋旧commit全体1）**。
指定テストの `ERR_ASSERTION` / exit 1 を確認し、構文/ロード失敗は数えない。
各回と finally で source を復元し、SHA256 一致後に47件を再実行する。
元の `7179efe` 全体でも dev6s 回帰が赤になり、復元後は緑になる。
この修理では xa-1 と gate の関連テストのみ実行し、xb/フル suite は実行しない。

```sh
npm run typecheck
TSX_DISABLE_CACHE=1 node --import tsx scripts/checkStrategyCode.ts example/agents/xa-1/agent.ts
TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 test/xa-1.test.ts
TSX_DISABLE_CACHE=1 node test/xa-1-red-controls.mjs
```

復元後 `agent.ts` SHA256:
`14849fc8f96772ccb18883b971e7d058eb9f8a844dc0177d2cf5e9f91ea3b800`。
今回の復元ログは `/tmp/xa-1-dev6s-red-controls.log` とそこに記載した evidence
ディレクトリ。`xa-1-prep-validation.json` は初版の履歴であり、今回の検証結果ではない。

[実ログ fixture](../../../test/fixtures/xa-1-dev4.json) は dev4 calm/36001 の
block 1384/1559、cand/multi の **7 件**と market.json の 2 フレーム、原本 SHA256。
market は事後再構成で、残高は明示的な合成初期値、入札は記録した送信を実行先へ
投影する。実際の包含 block・raw Observation・動的再現・成績の証拠ではない。
aggregate に oracle 高額 bid が混入した場合の見送りと、実行先別 bid の復元、
submit_failed が残高確認の代わりにならないことを検査する。

## dev6s の事実・推測・修理

原本は `upstream-eval/runs/2026-10-04T15-00-28-261Z/agents/cand.jsonl` と
`blocks.csv`。`/tmp/dev6s.log` は G0 BLOCKED を記録。読取専用で production gate の
`extract` を実行して `blocked = ["agent telemetry cand"]`、failed なしを再現した。

- **事実**: 判断行362件のすべてに round がない。全725行は判断回数ではない。
  pending理由は判断333行＋runtime noop333行の666回。同じ判断の重複記録。
- **事実**: block1298で USDC 1,000 を買い入力、1299で WETH
  `0.332580878762405375` 増、native ETH gas `32013246000000` wei 減を照合済み。
  block1305で同数量を売り、1306で USDC `996.298130` 増、gas
  `27117216000000` wei 減を照合し1往復を閉鎖。両方の包含は blocks.csv で success。
- **事実**: block1312の次の買いは `submit_failed: Too little received`。
  以後 cand の包含なし（全runで2件、revertなし）。送信前に作る pending が
  期限なく残った。WETH/WBTC桁、gas、買い受取の照合不一致を示す証拠はない。
- **推測と限界**: 原因となる submit_failed は送信前の simulation/estimate 失敗と
  整合する。元ログの `state.wallet` は照合済み台帳で、生の毎回の残高ではない。
  1312以降の残高不変は直接測定しておらず、fixture の不変残高は明示的な推定。
  quote と執行時価格の競争はあり得るが、この資料だけで価格変動原因を断定しない。
- **修理**: 8 block で回収専用へ遷移し、未確定予約を保存したまま遅延した
  exact-input 約定を回収する。新規停止、初期在庫保護、gas/損失上限、二重送信禁止を維持。
  安全に確認できない注文を時間だけで「未送信だった」と判定しない。

[dev6s fixture](../../../test/fixtures/xa-1-dev6s.json) は原本SHA256付きの小さい抜粋。
実測した買い/売り残高と失敗の履歴を使い、市場・遅延約定・WBTCは合成ケースと明記。
production `degradation-gate.py` を fixture に実行し、round欠落、agentId不一致、
startup回数、cap/truncation、submitted/submit_failed の非整数blockSeenを赤確認する。
actual runtime logger で362観測の合成ログは **174,897 bytes、各行2,048 bytes未満**、
cap/truncationなし。原本 cand は516,009 bytes（multi-arb 92,708 bytes）。
これはログ容量のfixture検証であり、修理後の実チェーン計測や性能評価ではない。

## 再スモークの提案（未起動）

ユーザーのcommit後、**F_ref / FROZEN / calm / seed 38004 / 360 blocks** を提案。
G0の362 loops・telemetry、送信/残高照合、8 block期限、遅延回収、未回収在庫を確認する。
seed **38003 はdev6sで使用済み**。過去の未使用記述は今回の監査で更新した。
可視の兄弟worktree全46 index.tsv / 590行（seed列）と、agent-view重複を除く
1,177 manifest/run-start JSONのseed欄に38004の使用は0件。
league-v2/upstream-evalの公開計画・設定でも38004の記載なし。監査詳細は
`/tmp/xa-1-dev6s-seed-audit.json`。非公開・未記録の使用/予約は確認できないため、
実行直前にも再確認する。実チェーン・Docker・実G0の修理後PASSは未検証。
