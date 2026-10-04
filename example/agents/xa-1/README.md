# xa-1 — 候補 A の先行準備

[PLATEAU §3 A](../../../ascon-notes/league/PLATEAU-ANALYSIS-2026-10-04.md)
の独立実装。xb-r の置換・昇格・Q0 合格ではない。性能は未測定。
dev5 を動かしている upstream-eval の HEAD `7b1448b` と入力は変更しない。
本作業はコミット・チェーン起動・フル npm test を行わない。

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
| `Plan` | 入金額、入口/予定出口、予測数量、独立に前払い可能な base 数量、両脚分 gas、往復費用控除後見積、固定損失枠、回収期限 |
| `lot` | 実 USDC debit、**実 base 増分**、実 gas ETH 減分、確認 block と期限。初期保有は数量に含めない |
| `lastClose` | 実 cashOut−cashIn−両脚実 gas の時点 USD 換算、gasWei、保有 block 数。`closed` と lot id で重複ログを除外可能 |
| `lossSpent` | 閉鎖した lot の負の実現純損益だけを累積。勝った lot で枠を補充しない |

次の観測の exact-input debit、正の受取数量、gas 減少、他方の base 不変を
すべて照合して初めて pending を解除する。遅い観測でも一致すれば照合するが、
**時間経過だけでは解除しない**。gas のみ減った revert 相当、部分 debit、
外部資金移動などは停止状態として残す。入口・出口とも同じ基準。
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

`ctx.log` へ各観測の action とシリアライズした台帳を記録する。未回収数量、
確認待ち、停止理由、回収期限、実現往復損益を確認できる。環境変数、乱数、seed、
regime、未来イベント、候補 identity は意思決定入力にしない。競合は観測 block
に固定した 1 回の公開 getBlock から取得し、750ms の読取失敗/不完全結果は保守的な
aggregate に戻す。自身を除き、router/vault/direct pool の全 tx を対象とする。

残高だけでは未送信/送信前失敗/滞留を区別できない。最初の未確認注文で
その run の残り全部を待機する可能性がある。無期限再送で解消しない。
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

`test/xa-1.test.ts` は 39 件。既存 xb 183 件と合わせ **222 件**を対象にする。
`test/xa-1-red-controls.mjs` は **39 因子破壊**を逐次適用し、指定テスト名の
`ERR_ASSERTION` / exit 1 を確認する。構文/ロード失敗は赤成功と数えない。
xa-1 の source だけを各回と finally で復元し、SHA256 一致後に xa テストを再実行する。
xb-r の赤対照スクリプトは実行しない。

```sh
npm run typecheck
TSX_DISABLE_CACHE=1 node --import tsx scripts/checkStrategyCode.ts example/agents/xa-1/agent.ts
TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 test/xa-1.test.ts test/xb-core.test.ts test/xb-variants.test.ts test/xb-r.test.ts test/xb-r-dev2.test.ts test/xb-r-dev3a.test.ts test/xb-r-v4.test.ts test/xb-r-slippage.test.ts test/xb-r-v5.test.ts
TSX_DISABLE_CACHE=1 node test/xa-1-red-controls.mjs
```

復元後 `agent.ts` SHA256:
`70706ea292d9a838657b1bb70a6a25cdac594cb47edc292d92e5613a404adf65`。
詳細な最終実行結果・ログ・台帳 hash は
[検証証跡](../../../ascon-notes/eval/xa-1-prep-validation.json) に保存する。

[実ログ fixture](../../../test/fixtures/xa-1-dev4.json) は dev4 calm/36001 の
block 1384/1559、cand/multi の **7 件**と market.json の 2 フレーム、原本 SHA256。
market は事後再構成で、残高は明示的な合成初期値、入札は記録した送信を実行先へ
投影する。実際の包含 block・raw Observation・動的再現・成績の証拠ではない。
aggregate に oracle 高額 bid が混入した場合の見送りと、実行先別 bid の復元、
submit_failed が残高確認の代わりにならないことを検査する。

## 第3イテレーションの提案（未起動）

dev5 の結果と既消費・残費を確認後、xa-1 を固定して一案だけ診断する。
smoke は **calm / 38003 / 最大120 block / 上限10分**、包含成功と未回収ゼロを
先に確認。その後 F_ref/FROZEN、全12×**38001/38002** の **24世界**、p=3、18+6。
既存校正 13分/batch なら **104分＋smoke/終了検査**、1反復180分上限。
新候補の実時間・G0 p99/362 loops は未校正。既存 xb-r を同居させず cand slot で別測定する。
親との因果効果を求める fresh 対応比較は48世界/208分以上となり、この案には含めない。

準備時の可視兄弟 worktree 全 **44 index.tsv / 565 行**を seed 列で監査し、
38001/38002/38003 の使用記録は各0件。両 checkout の公開 league 計画にも記載なし。
全履歴の完全性・非公開 Hfinal/未記録予約との非交差は未検証。実走直前に再監査し、
入口/hash/予算条件を記録する。先行準備で検証時計や最大3回をリセットしない。

screen は MASTER §8.3 を維持し、全24世界G0、安全0条件、等重み平均T≥multi、
全12平均(T−Tnoop)≥0、全世界 P/P−noop と最悪値を確認する。lot 別の保有時間、
閉鎖損益、期末残量、pending、出口失敗を追加報告し、E/M/G を receipt と結合して
「失った entry edge」と「回収した carry」を分離する。初期在庫の売却量は常に0を確認。
第3回未達なら停止し、4回目や安全閾値の変更へ進まない。

未検証: チェーン/Docker、public60、bundle/selftest、Q0/F_ref、安全実績、実 gas・
包含/revert/回収率・p99、最新外部規約/提出適合、AI ON/OFF。収益性・T改善は主張しない。
