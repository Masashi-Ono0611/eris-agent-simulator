# Q-ZETA-01 — inc-zeta 新資格試験の事前登録下書き

作成日: 2026-10-05。状態: **署名済み（2026-10-05 JST）・開始前照合済み・起動待ち**。

Masashi本人は2026-10-05のチャットで「inc-zetaを独自戦略と認め条件付き第一候補にする」「弱点診断後、現行閾値を維持した新契約・回数枠でF_ref資格試験へ進む」を承認済み。この承認を未承認に戻さない。本紙は対象hash・seed・試行上限・費用の具体化であり、資格合格や実行済みを表さない。今回の作業指示は準備のみで、計測の起動は禁止。

## 1. 候補はBの1つだけ

対象は `example/agents/ascon-zeta-r/`、**B（修理なし）**。Cは診断のみで修理因子を実装していない。採用理由は測定設定との同一性を保ち、1seedの弱点に合わせた未検証の入札/在庫/回収変更を持ち込まないため。[診断](INC-ZETA-DIAGNOSIS-2026-10-05.md)の弱点を受け入れて資格条件で判定する。結果を見て修理ON/OFFを選ばない。

- delta設定: `bidMode=2`, `bidProfitShareBps=3000`, `gasPerSwap=140000`。`ASCON_DELTA_PARAMS` は不使用。入口手数料+50bps、サイズ2.5〜25%等は現行通り。
- specialist設定: `launch=true`, `redemption=true`, `stabilityPool=true` を `DEFAULTS` から焼き込み。元 `ascon-zeta/agent.ts` の既定値と一致し、測定 `roster-league-u1.yaml` のinc-zetaには `ASCON_ZETA_PARAMS` 指定がない。未指定時の動作を保持し、候補内の `process.env` 読み取りは0件。
- tree SHA256: **`b4e295aeef419ea00b1ae00d9c63672d3142d64676ae3b764ace121aeec75a56`**。
- hash方式: ディレクトリ内の全ファイルの相対path→SHA256 mapをキー順に並べ、空白なしJSON (`sort_keys=True,separators=(',',':')`) のUTF-8をSHA256化。既存 `league_harness.tree_hash` と同じ方式。
- 詳細固定表: [q-zeta-01-lock.json](q-zeta-01-lock.json)。agent/launch/prompt/deltaの全hash、参照3体、SDK・共通lib・runtime・core/scorer・G0/runner・package-lock等を含む。元ascon-zetaのtree hashも保存。
- roster: [roster-q-zeta-01.yaml](roster-q-zeta-01.yaml)、SHA256 `323f489c53f27e46f7ca4b1d4c53738928b40a087e9d23f4e169e1404d767e30`。
- runtime/evaluation固定表のaggregate: `23bde898f31602bcf732aa66c0322b8251c9d58633eeed454562fa901b8ce093`。準備元HEAD `cca4005baeb30f2c69d3d87d45e3cef487ca3337`。診断データ元HEAD `8303d85c1ac80792ad7c17da97b78c46df40bbc7`。
- 別担当の上流統合/分割PR/merge commitは本紙の作業範囲外。実行先で依存/runner/HEADが変われば**結果閲覧前**に差分レビュー・軽量検査・固定表更新・run-start manifestを残す。candidateのsilent差替えは禁止。現在のlockはrun-start manifestではない。

## 2. 場・母集団・seed

場は **F_ref = cand + noop + multi-arb + clean-arb**。同一世界に4体、独立候補は1体。roster/slot順はyaml通り `noop,multi-arb,clean-arb,cand`、noopのみbaseline。比較用3体とcandは既定コード凍結（`ERIS_AGENT_FROZEN=1`、推論改訂OFF）。親環境の `ASCON_ZETA_PARAMS` / `ERIS_LAUNCH_*` パラメータoverrideを与えず、`ASCON_DELTA_PARAMS`もunset。環境の秘密値をログへ出さない。

12レジーム: `calm,cex-drift,informed-flow,whale,lending-incident,crash,depeg,vuln,spike,depeg-persist,cdp-incident,launch`。各360blocks、blockTime=2s、expected loopIterations=362。世界ごとに独立reset、frozen実行。各レジーム×同じ5新seed、合計60世界、欠測/重複0。

**提案seed: `46001,46002,46003,46004,46005`**。

[seed監査](../eval/q-zeta-01-seed-audit.json) / [再監査スクリプト](../eval/audit-q-zeta-seeds.py): 可視の全sibling worktreeのindex60本・686行、manifest37本のseed欄、計画/台帳120本を照合し、提案5本との衝突0。提案seedのrun結果は開いていない。

- 31xxx/35xxx/36xxx/38xxx/39xxx/40xxx/41xxx/44xxx/45xxxは、使用済みと予約済みの区別にかかわらず**帯全体を除外**した。44xxx/45xxxは本人指定の予約帯として扱い、台帳に実走がないことを解放の根拠にしない。
- 旧Q0-A-REQUAL-01の41301–41305は予約を保持。本契約へ自動転用しない。過去seed201–203、40001–40005等も既見。
- この下書きで46001–46005をQ-ZETA-01の**提案枠**として明示するが、他worktreeの台帳へは書き込んでいない。実行担当が直前に全台帳・予約を再照合し、正式manifestに全60組を一度に登録する。他担当/非公開台帳の不在まで証明したとはしない。
- 事前監査で衝突が分かった場合だけ、結果を見る前に全5seed集合を新規に再登録する。実行後の性能を理由に追加/交換しない。

## 3. 合格条件 — 全て必要、変更しない

1. **全60世界G0 PASS、欠測/重複0**。全行exit0、入力/候補/依存/roster/hash固定、360blocks/362loops、failedReads0、既存G0の時刻・coverage・timeout・排他条件を満たす。PASS部分だけの集計で救済しない。
2. **12レジーム等重み平均T(cand) ≥ 同世界multi-arb**。各世界の `summary.agents[].pnlUsdc` を使用。noopを除くcand/multi-arb/clean-arbの母平均μ・母標準偏差σで `T=50+10(P−μ)/σ`。σ=0はupstream scorerの `sigma-zero` 除外に合わせ採点不能として停止し、league表示用の50で60世界合格へ救済しない。レジーム内5seed平均、その12レジーム平均。別世界の比較値やmixed-field Tを混ぜない。
3. **全12レジームそれぞれで平均(Tcand−Tnoop) ≥ 0**。Tnoopも同世界のμ/σへ当てはめ、noopを標準化母集団へは含めない。平均P−noopや全体平均だけで代用しない。
4. **各世界でmined revert ≤1件、かつmined revert / 包含取引数 ≤0.1%**。分母は当該世界candの包含総数（成功+revert）。包含0・revert0の場合の比率は0、欠測はFAIL。したがって包含1000件未満の世界は、1revertでも比率条件を満たさない。60世界の合算比率で救済しない。
5. **原因不明の失敗0、片脚回収不明の失敗0**。submit_failed、preflight拒否、mined revert、never-mined/期末pending、invalid actionを区別し、全件をhash/時刻/観測block/receipt/残高と対応付ける。理由が分からないものや単に次の取引があるだけの回収推定は合格扱いしない。
6. **未回収自前資産損失0、gas枯渇0、無効注文0、違反0**。SP等の正当に評価されるprotocol資産と、ゼロ評価の自前コントラクト残留を区別する。欠測/n.a.を0に変換しない。期末評価と実行ログの両方で照合する。

比較対象も同一世界でG0成立が必要。安全条件はcandの審査に適用し、環境/規約違反があれば世界を停止する。過去診断のrevertや失敗を新資格の合格として扱わない。inczの4弱点世界のうちinformed-flowは1/227 revertで、この診断が既に合格したという説明はしない。

## 4. 試行回数・停止・失格

**新枠は1候補・資格試験1回（60世界）だけ。** 4チャンクは1試行の分割であり、4回の試行権ではない。修理なしBを結果前に固定。旧決定論ライン3/3回打ち切り・旧Q0/Q0b不合格を保持し、名称/日付変更で回数をリセットしない。旧5h枠も自動で流用しない。

開始前のhash/seed/費用/環境条件不成立は未起動のまま停止。開始後のG0不良、安全違反、原因/回収不明、hash drift、欠測/重複は即座に新規起動停止し証拠を保全する。ディスク（output/TMP）が25GB未満なら停止。開始余裕は既存の39.5GiB（p=3の見積+20GiB）を維持し、リース/heartbeat/メモリ/他ジョブ排他等の既存G0条件も緩めない。

チャンクは**110分以下**、全試行は確認を含む**5h上限枠案**、通常6h/日・forward100h・その他留保のうち最も早い上限で止める。時間上限で未完なら未完/不合格のまま保持し、欠測を黙って補わない。今回の準備からは起動しない。

性能不良ならseed追加・再走・次点切替をしない。途中成績を見て候補、場、順序、基準、試行上限を変えない。基準を結果に合わせて緩めない。技術不良も資格救済の自動再走権を生まない。失敗/未完の結果を保持し、原因・費用を本人へ報告する。別研究は別途判断とし、この契約の失格を置換しない。

## 5. チャンク・費用・forward100h

並列数は既存校正を前提とする **最大3**。世界順は上記レジーム順→seed昇順の60行を先に固定し、4チャンクに分割する。**実行時の分割（結果閲覧前に確定）: 実行系が レジーム×seed の直積で動くため、レジーム順の3レジームずつ×5seed＝15世界×4チャンクとする（60行・順序は不変、1チャンク5バッチ・約70分で110分以下）。**1チャンク最大6バッチ。110分を超える見込みなら開始せず見積を直す（世界数/安全条件を減らさない）。新規性能smokeの追加枠は本紙に含めない。

| 費用項目 | 枠案 |
|---|---:|
| 60世界の基本実行見積 | 4.5h（20バッチ×約13.5分） |
| 終了確認・G0/全失敗/評価照合の余白 | 0.5h |
| **確認込み予約/時間上限** | **5.0h** |

4.5hは既存の本人提示計画の基本見積で、今回の実測ではない。複数チャンクの起動/終了確認が0.5hに収まること、各chunk110分、全5hが成立することを実行担当が事前確認する。収まらなければ開始前に時間配分を本人確認し、超過を自動実行しない。

**5hはforward100hの内数**であり100+5hに増やさない。既消費（夜間mix/incz等）・予約・実消化・残量を別々に記録する。現時点で実消化/残量の精算は未確認。旧Q0のdeep内5h、受理/最終安全/下流AI等の留保と重複計上・無断振替しない。Q-ZETA-01全量とその後の必須工程の残費を確保できるまで起動しない。frozen試験の予定推論呼出は0だが、機械占有時間/保管費用が0とはしない。金銭単価は未算定。

## 6. 入口証跡・署名

- 済: [独自性開示](INC-ZETA-ORIGIN-2026-10-05.md)、4世界の会計/過去照合、B固定hash、32再構成フレームの判断一致、既存3赤対照（不一致19/13/17件）、delta/zeta/両方のpoisonそれぞれ32フレーム一致、env読取復元の第4赤対照。32実ログフレームはLiquity/launch観測を含まないため、第4対照は別の合成SP観測で同じ判断一致assertionが失敗することを確認。launch.tsは元とbyte一致、agent.tsはPARAMS行のみ差分。今回の型検査・指定関連13testsはPASS。前回の静的戦略検査・可視seed衝突0は今回再検証していない。
- 未検証: 実行先統合commitと依存照合、正式run-start manifest/リース、直前seed監査、費用残量、全60世界、Docker selftest/bundle/public backtest、LLM改訂ON/実提出受理。既見診断の安全/性能を新資格の証明にしない。
- 提出直前のrepo所定順序（typecheck→strategy check→public60→bundle→selftest）は別の未完了工程。この準備で完了したとしない。

| 項目 | 署名/確認状態 |
|---|---|
| 方針承認（独自戦略・条件付き第一候補・新枠で資格試験へ進む） | **Masashi本人、2026-10-05チャット承認済み** |
| 本契約の個別最終署名（B hash / 46001–46005 / 1回 / 確認込み5h） | **Masashi本人、2026-10-05チャット「問題ないと思います」（hash b4e295ae…ec75a56 を提示した上での回答）** |
| 実行担当の開始前hash/予約/予算/排他照合 | **Claude（実行担当）、2026-10-05 JST: lock照合 PASS（175ファイル・hash一致）、seed再監査 hits=[]（686行/37 manifest/120計画）、他の計測プロセス0、ディスク82GiB空き。予算の実消化精算は未確認（forward100h内数として記録）** |
| 合否報告・本人受領 | **本人確認待ち（未実行のため結果なし）** |
