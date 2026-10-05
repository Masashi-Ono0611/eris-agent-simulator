# Q-ZETA-02 — ascon-zeta-r2 新資格試験の事前登録

作成日: 2026-10-06。状態: **registered-pending-start（登録済み・未起動）**。本作業は契約準備・静的照合のみ。実行担当の開始前照合欄は空欄で、起動済み・資格合格を意味しない。

## 1. 候補は1つだけ

対象は `example/agents/ascon-zeta-r2/`、commit **`b3b27c1daf6c7e10d5ecb962f72c7898e4afb421`**。Q-ZETA-01の候補ascon-zeta-rに対する限定修理3点だけを固定する: launch allowanceを小さく上書きしない、各脚を独立してdecimals込みで資金確認するbundle、由来を特定できるWETHのみ回収する。入札はascon-zeta-rと同じ。結果を見て修理ON/OFFや候補を選ばない。

- delta設定: `bidMode=2`, `bidProfitShareBps=3000`, `gasPerSwap=140000`。specialist設定: `launch=true`, `redemption=true`, `stabilityPool=true`。overrideなし。
- candidate tree SHA256: **`ddd7c718f2e9091c64b9949e277447868dd82347729d86f899b35dc89156786c`**。
- hash方式: 全ファイルの相対path→SHA256 mapをキー順・空白なしJSON (`sort_keys=True,separators=(',',':')`) にしてUTF-8 SHA256化。Q-ZETA-01と同じ。
- [lock](q-zeta-02-lock.json) / [検証](../eval/verify-q-zeta-02-lock.py): 候補全5ファイル、旧候補・原型・参照3体、SDK・core/scorer・共通lib・runtime・G0/runner・package-lock等を固定する。
- roster: [roster-q-zeta-02.yaml](roster-q-zeta-02.yaml)、SHA256 `08ea4958228289aff25d60e40f91ebe457f62b3912d1378f65e35098c4b83010`。
- committed runtime/evaluation aggregate: **`5eb1ae316e683c81336b465d654d700a62dce27949fbe3dfa81b11755f781055`**。準備元HEAD `9f7d5a8ae98bdc3e53fde926576949446233baf5`。
- **コミット済みツリーで検証**する。candidateはb3b27c1とも照合し、現在のHEAD・working treeの差分も検出する。新規未commitのrosterはartifactFilesで別固定。`sdk/src/constants.local.ts` はdeployer再生成ファイルなのでhash対象外。アドレス/chain/デプロイ先の正当性は実行ホストのG0・run-start manifestで確認し、この除外を他の依存差替えへ拡張しない。
- 依存/runner/HEADの実行先差分は結果閲覧前にレビュー・軽量検査・固定表更新・run-start manifestへ記録。候補のsilent差替えは禁止。開始後のdriftは停止。このlockはrun-start manifestではない。

## 2. 場・母集団・seed

場は **F_ref = cand + noop + multi-arb + clean-arb**。候補1体、同一世界に4体。slot順はQ-ZETA-01と同じ `noop,multi-arb,clean-arb,cand`、noopのみbaseline。比較3体とcandのコードを凍結（`ERIS_AGENT_FROZEN=1`、推論改訂OFF）。親環境の `ASCON_DELTA_PARAMS` / `ASCON_ZETA_PARAMS` / `ERIS_LAUNCH_*` overrideを与えない。秘密値をログに出さない。

レジーム順: `calm,cex-drift,informed-flow,whale,lending-incident,crash,depeg,vuln,spike,depeg-persist,cdp-incident,launch`。各360blocks、blockTime=2s、expected loopIterations=362。世界ごとに独立reset。各レジーム× **`47001,47002,47003,47004,47005`** = **60世界**、欠測/重複0。

[seed監査JSON](../eval/q-zeta-02-seed-audit.json) / [監査スクリプト](../eval/audit-q-zeta-02-seeds.py)で可視の全登録/sibling worktreeのindex seed欄、manifest、台帳、計画、予約記録を読み取り照合する。`hits=[]` は実際に衝突0の場合のみ。読取不能・壊れたseed欄を成功扱いしない。自身の新規登録のみpath/markerを限定して除外し、他worktreeの同名文書を除外しない。

2026-10-06のローカル監査: **1,304資料（index 67本・770行）、47001–47005のhits=[]、PASS**。48001/48002は各12 index行を使用済み証拠として保存。可視範囲の時点監査であり、開始直前の再監査を代替しない。

- 31xxx/35xxx/36xxx/38xxx/39xxx/40xxx/41xxx/44xxx/45xxx/46xxx/48xxxは使用/予約帯として除外。旧41301–41305予約・Q-ZETA-01の46001–46005を保持。
- **48001・48002は診断に使用済み**。それぞれのindex行をauditへ記録し、Q-ZETA-02に再使用しない。48001は旧variant、48002は12世界診断であり資格証拠ではない。
- 登録は本worktreeだけ。他worktree/run出力は変更しない。remote/private台帳の不在は証明できないため、実行担当が開始直前に再監査し、正式manifestへ全60組・順序を一括登録する。
- 起動前の衝突判明時のみ、結果閲覧前に全5seed集合を新規登録して再監査。起動後の追加/交換/救済再走なし。

## 3. 合格条件 — 全て必要、変更しない

1. **全60世界G0 PASS、欠測/重複0**。全行exit0、入力/候補/依存/roster/hash固定、360blocks/362loops、failedReads0、既存G0の時刻・coverage・timeout・排他条件を満たす。PASS部分だけの集計で救済しない。
2. **12レジーム等重み平均T(cand) ≥ 同世界multi-arb**。各世界の `summary.agents[].pnlUsdc` を使用。noopを除くcand/multi-arb/clean-arbの母平均μ・母標準偏差σで `T=50+10(P−μ)/σ`。σ=0はupstream scorerの `sigma-zero` 除外に合わせ採点不能として停止し、league表示用の50で60世界合格へ救済しない。レジーム内5seed平均、その12レジーム平均。別世界の比較値やmixed-field Tを混ぜない。
3. **全12レジームそれぞれで平均(Tcand−Tnoop) ≥ 0**。Tnoopも同世界のμ/σへ当てはめ、noopを標準化母集団へは含めない。平均P−noopや全体平均だけで代用しない。
4. **各世界でmined revert ≤1件、かつmined revert / 包含取引数 ≤0.1%**。分母は当該世界candの包含総数（成功+revert）。包含0・revert0の場合の比率は0、欠測はFAIL。したがって包含1000件未満の世界は、1revertでも比率条件を満たさない。60世界の合算比率で救済しない。
5. **原因不明の失敗0、片脚回収不明の失敗0**。submit_failed、preflight拒否、mined revert、never-mined/期末pending、invalid actionを区別し、全件をhash/時刻/観測block/receipt/残高と対応付ける。理由が分からないものや単に次の取引があるだけの回収推定は合格扱いしない。
6. **未回収自前資産損失0、gas枯渇0、無効注文0、違反0**。SP等の正当に評価されるprotocol資産と、ゼロ評価の自前コントラクト残留を区別する。欠測/n.a.を0に変換しない。期末評価と実行ログの両方で照合する。

比較対象も同一世界でG0成立が必要。安全条件はcandに適用し、環境/規約違反は停止する。上記6条件はQ-ZETA-01と逐語一致し、検証スクリプトでも比較する。

## 4. 試行回数・停止・失格

**1候補・資格試験1回（60世界）だけ。** 4チャンクは1回の分割で、4回の試行権ではない。**Q-ZETA-01の不合格・消費1回を保持し、回数リセットなし**。旧決定論ライン3/3打ち切り、旧Q0/Q0bの不合格も保持。限定修理後の明示的新契約であり、自動再挑戦権ではない。

停止規則（既存閾値を維持し、運用上の判定時点を明確化）:

- **起動前**: hash/seed/予算/host G0/manifest/排他/keep-awakeの不成立・不明があれば未起動で停止。output/TMP開始余裕は既存39.5GiB以上（p=3見積+20GiB）。リース・heartbeat・メモリ・他ジョブ排他等、既存G0条件を緩めない。
- **実行中**: G0不良、安全/規約違反、hash drift、欠測/重複、原因/片脚回収不明、未回収自前資産損失・gas枯渇・無効注文、sleep検出、監視/リース喪失、output/TMP空き25GB未満で即座に新規世界/次チャンクの起動を停止し証拠保全。稼働中世界は安全に終了/停止し、部分標本を資格合格にしない。未分類失敗を握り潰して次チャンクへ進まない。
- **mined revert**: 各世界で2件目を確認すれば件数条件で確定FAIL、残りの新規起動停止。1件の場合は稼働途中の分母を最終値と取り違えず、その世界の終了時に `1000×revert ≤ included` を判定する。最終包含<1000で1件なら即FAIL、合算率で救済しない。submit_failed/preflightをmined revertと混同せず全件帰属させる。失敗分類不能は別の停止条件。
- **時間**: 各chunk≤110分、確認込み全体≤5h、通常6h/日、forward100hと既決留保の最も早い上限で止める。sleep・停止時間をwall-clockから差し引いて上限を帳消しにしない。超過見込みなら次chunkを開始しない。超過/未完は逸脱・未完/不合格を保持し、欠測補充しない。G0 PASSでも時間逸脱は別に記録し、契約適合へ読み替えない。
- **性能**: 条件2は全60世界、条件3はレジーム内5seed完了後の値で判定。途中の単一世界/暫定平均を理由にseed・順序・候補を切り替えない。完了したレジームの条件3不達等、確定した不合格は新規起動停止。集計不能（σ=0・必要証跡欠落）は停止し、合格部分だけ採用しない。

技術不良も自動再走権を生まない。失敗/未完・逸脱・原因・費用を保持して本人へ報告。診断や別研究で本契約の失格を置換しない。

## 5. チャンク・実行ホスト・費用・forward100h

**全60世界をONE hostで実行**。primaryは**Mac mini（常時稼働）が開始前に自機でG0 smokeをPASSした場合のみ**。未実施/FAILならfallbackは**Air（電源接続・keep-awake・蓋を閉じずsleep禁止）**。Airも自機の既存G0/校正が成立していることを照合する。選択host識別子・自機G0証跡・時刻・commitを正式run-start manifestと下の実行担当欄へ**最初の世界開始前**に記録し、開始後のhost変更・60世界のAir/mini分割は禁止。未起動ならfallbackを選べるが、開始後の障害で別hostへ続きを移さない。

本人の「Air and mini in parallel」は承認文脈として原文を保持する。Q-ZETA-02の60世界は単一hostに固定し、他hostの並行作業は別scope/予算/seed/出力で排他を満たすものに限る。この準備作業からどちらも起動しない。

実行担当は `caffeinate` 等のkeep-awakeを試験全期間（chunk間・終了確認含む）で有効化し、給電・設定・プロセス存続・sleep履歴を監視する。keep-awakeの起動だけでsleep不在を証明したとしない。sleepは時刻・影響世界/loop・経過時間とともに**逸脱**へ記録し、新規起動停止。診断48002でhost sleep後に360/361loopsとなったG0 FAILをPASSへ読み替えない。

並列数は同一hostで既存校正済み **最大3**。順序はレジーム順→seed昇順で固定。各chunkは3レジーム×5seed=15世界、5バッチ、≤110分（既存の最大6バッチも維持）。

| chunk | レジーム（順序固定） | seed | 世界数 | 上限 |
|---|---|---|---:|---|
| 1 | calm / cex-drift / informed-flow | 47001–47005 | 15 | 110分 |
| 2 | whale / lending-incident / crash | 47001–47005 | 15 | 110分 |
| 3 | depeg / vuln / spike | 47001–47005 | 15 | 110分 |
| 4 | depeg-persist / cdp-incident / launch | 47001–47005 | 15 | 110分 |

| 費用項目 | 枠 |
|---|---:|
| 60世界基本実行見積（20バッチ×約13.5分） | 4.5h |
| 終了確認・G0/全失敗/評価照合 | 0.5h |
| **確認込み予約/時間上限** | **5.0h** |

見積は実測ではない。自機G0 smokeは資格とは別の運用前提で、47001–47005を消費せず、別の監査済みseed/manifestと費用を先に確保する。新規性能smoke/候補選別の追加枠は本契約に含めない。smoke・別host並行作業もforward100h外へ逃がさず、両hostの機械占有を別に記録して過少計上しない。

**5hはforward100hの内数**。Q-ZETA-01失敗・診断・準備/smoke・今回の実消化と予約を保持し、100+5hへ増枠しない。`C_forward + R_remaining + N_next ≤ 100h`、同一区間の消化/予約二重計上なし。旧5h枠/受理/最終安全/下流AI留保を自動流用しない。全残費・通常6h/日・chunk/全体上限が成立するまで未起動。実消化/残量は**未精算**で0としない。frozen推論0回でも機械占有/保管費は0でない。金銭単価は未算定。

## 6. 入口証跡・署名

- Q-ZETA-01は[結果](Q-ZETA-01-RESULT-2026-10-05.md)の**条件4 FAIL**を保持。条件5/6には未判定項目、chunk2にはsleep/110分超過の記録があるため「他項目全て証明済み」とはしない。旧結果は変更しない。
- 本人提示診断48002: 12世界、平均包含231、mined revert0、T57.61対40.51、submit_failed32/2811。host sleep後360/361loopsでG0 FAIL。**診断であって資格証拠ではない**。48001は以前のvariant。どちらも本契約の60世界へ混ぜず、全失敗帰属や合格を推定しない。
- 本パッケージの検証対象: committed-tree hash/roster、seed metadata監査、計画/dashboard整合、`npx tsc --noEmit`。`npm run check:strategy` はsandbox EPERMのため本人が別途実行し、この作業では実行しない。
- 未検証: 選択hostのG0 smoke・keep-awake実運用・正式manifest/リース・直前seed再監査・予算精算・全60世界・Docker selftest/bundle/public backtest・改訂ON/実提出受理。提出所定順序は別の未完了工程。

| 項目 | 署名/確認状態 |
|---|---|
| 本人方針承認（2026-10-05） | “limited repair then new contract” |
| 本人実行指示（2026-10-06 JST） | “start quickly and run Air and mini in parallel” |
| 承認文脈の扱い | 上2行は本人提示の原文。限定修理・新契約への承認を保持し、host選定済み/開始前確認済みとは代署しない。本紙の単一host条件を適用する。 |
| 実行担当Claudeの開始前照合 |  |
| 合否報告・本人受領 | 未起動・結果なし |
