# XB-R-LIVE: 標準 runtime 自由改訂パイロット（準備のみ）

**「推論あり、動き始めた?」への回答: 実計測はまだ始まっていない。**
旧 xb-r-ai/H1 は標準 runtime の ON を拒否し、専用 adapter は未実装。
agy の形式確認は実走ではない。本書は adapter を要しない新候補 xb-r-live の
実装と将来の実行仕様。dev7 が走行中のため、今回 smoke/LLM/Anvil/Docker/
backtest は起動しない。upstream-eval への書込、commit、鍵・`.env` 操作も行わない。

## 1. 構成と成立範囲

- [xb-r-live 初期コード](../../example/agents/xb-r-live/agent.ts) は
  `d30cbbb46ca472b5a7a72fc1b99deab96dc97bf3:example/agents/xb-r/agent.ts`
  のバイト同一コピー。SHA256
  `78d8fa43156cee872e1bcbcaf86c1da00f1aa1646c6b210e7af4b499edea4d04`。
  初期 ENTRY=50 / R9=false。v5不昇格・v3基準という本人の指定を採用する。
- [prompt.md](../../example/agents/xb-r-live/prompt.md): kind/name/description、
  `model: claude-cli:haiku`、既定値と同じ `reviseEveryBlocks: 60`。
  本番 gpt-oss:120b に近い第一候補という本人指定であり、品質/遅延の同等性は未実証。
- [OFF](roster-xb-r-live-off.yaml) / [ON](roster-xb-r-live-on.yaml):
  noop / multi-arb / clean-arb / cand の順。同じ cand→xb-r-live。
  違いは cand の `ERIS_AGENT_FROZEN: "1"` と `"0"` のみ。
  `ERISAGENTFROZEN` ではない。ONは明示的な0で親の1を上書きする。
  flagの省略だけでは親から継承した凍結を解除できない。
- [CLI開始時刻補助](xb-r-live-claude-timed.sh): 既存の `ERIS_CLAUDE_BIN` hookで
  開始のts/PIDだけを記録して `exec claude`。argv/prompt/環境変数/認証値を記録しない。
  timeout対象PIDを維持する。改訂検査・解釈・送信には介入しない。

コード根拠は `docs/guide/llm-agents.md`、`runtime/improve.ts`、`runtime/botMain.ts`、
`runtime/strategyRunner.ts`、`runtime/llm.ts`、`core/src/realtime/agentProcess.ts`。
agents[].envはstring値で子環境を上書きし、modelはfrontmatter→env→既定の順。
modelを変える場合はfrontmatterを変えた別実験にし、Haikuの3反復と混ぜない。
CLI providerはHTTP/Anthropic APIより先に選ばれ、APIへのfallbackはない。
stockのclaude呼出はANTHROPIC_API_KEYを渡さずサブスク経路を使う。
ただし追加使用課金OFF・利用枠・Haiku権限・認証は今回未確認。
ローカルOllama、本人Ollama鍵/無料枠、API、従量課金への切替は禁止。

改訂は `executorTs`=JS判断関数本体をparse→cheatcode静的検査→compile→setSource。
`void maybeRevise(block)` の非同期・同時1件。60block機会が来ても前回呼出中なら
skipし、即時retryしない。初回は最初の観測から60block後。ON起動とinstalledは別状態。
初回にLLMへ示すv0はモジュール全体で、返す本体にはimport/TypeScript/元のclosureを
使えない。promptはhelperのインライン化、使えないglobals、保守的競合入札fallbackを説明する。
これをHaikuが実際に正しく書けるかが最初のsmokeで確かめる点。

## 2. seedと比較設計

[既存仕様](XB-R-AI-PILOT-2026-10-04.md) の4レジーム×2seed・OFF1+ON3・F_ref・
実行順・screenを引き継ぐ。変更は旧H1のv5/50有限選択から、v3を初期値とする
標準runtimeの自由改訂への変更。旧H1の120block TTLやadapterによる強制validatorはない。
旧H1を別途同じseedで走らせない。今回の準備は実行枠の取得や開始許可ではない。

2026-10-04 15:34:41 UTCの[再監査](xb-r-live-seed-audit-2026-10-04.json):
可視の兄弟worktree＋mainの47台帳590行で39001/39002、39101/39102/39103の使用0。
兄弟worktreeのleague md/yaml予約検索でも当該seedは旧H1とその参照だけだった。
したがって**記録上はH1予約を本パイロットへ引き継いで使用可**。
未記録run/他担当予約は否定できず、開始直前に台帳seed列と予約を再確認し、交差なら停止。
監査で成績は開かない。36001/36002は各24行の使用済みで調整用、37001/37002は
独立検証に温存、38xxxはxa-1診断用として使わない。

本体は calm / whale / crash / depeg-persist × 39001 / 39002 = 8セル。
1セルOFF1＋ON1/ON2/ON3、合計32世界、原則p1。ONは独立した3本の実応答履歴。
応答replayや同じ生成コードの再実行はON反復に数えない。

| セル順 | regime | seed | 起動順（必ず逐次） |
|---|---|---|---|
| 1 | calm | 39001 | OFF → ON1 → ON2 → ON3 |
| 2 | calm | 39002 | ON1 → OFF → ON2 → ON3 |
| 3 | whale | 39001 | OFF → ON1 → ON2 → ON3 |
| 4 | whale | 39002 | ON1 → OFF → ON2 → ON3 |
| 5 | crash | 39001 | OFF → ON1 → ON2 → ON3 |
| 6 | crash | 39002 | ON1 → OFF → ON2 → ON3 |
| 7 | depeg-persist | 39001 | OFF → ON1 → ON2 → ON3 |
| 8 | depeg-persist | 39002 | ON1 → OFF → ON2 → ON3 |

同じ世界条件を作り直し、candだけON/OFFにする対応比較。両候補の同居ではない。
同seed・regime・scenario生成版/公開scenario key・相手/依存hash・slot順・初期資金・
360block/2秒・scorerを固定。行動で変わる市場経路は効果に含むため、価格や包含時刻の
完全一致は保証しない。各世界は新プロセス/v0で、`--agent-state-root`、resume、
持越し `ERIS_AGENT_STATE_DIR` を使わない。旧runのmemory/versionsを渡さない。
stock `--repeat 3` の中央値集約を使わず、ON各反復を別label/別ログで保持する。

## 3. ON校正: 短縮smokeから

以下は**将来の実行担当向け。今回は実行しない**。

1. dev7の終了・既存の排他/資源ゲート・空き枠を確認する。既存matrixにビルド/計測を重ねない。
   runtime/sdk/lib/相手/agent/prompt/roster/runner/config/scorer/CLI版のhashと予定世界、
   worker/監視担当・期限・停止方法を開始manifestに固定。作業コピーの未commitファイルも
   個別hashを採る。ローカルAnvilのAUTO財布のみを使い、公開devnetへ送信しない。
   `backtest`は`.env.local`を自動読込するので、後日の実行場所は**.envを含めない専用の
   ローカルsnapshot**にする。秘密をコピーせず、既存の認証済みCLIを使う。
   snapshotの用意やstate dump生成も今回はしない。upstream-evalは実行/出力先にしない。
2. サブスク認証・Haiku利用可・追加使用課金OFFを確認。確認不能、枠切れ、API要求なら停止。
   `--agent-sandbox process`必須。stock DockerにはCLIがない。
   snapshot rootから実行し、roster内の相対ERIS_CLAUDE_BINと実行権限を確認する。
3. **短縮ON smokeは calm/39103、1世界のみ、150blocks/320seconds、p1**。
   このseedは校正枠のみで本体へ入れない。120秒timeoutでは最初の60block機会から
   応答まで約60blockかかり得るので、通常の24block smokeでは改訂が一度も起きない。
   `reviseEveryBlocks=60`は変えない。smoke失敗で自動延長・追加seed・再試行しない。

```sh
# 実行枠・snapshot・課金なし確認を満たした後だけ。現在は実行禁止。
BACKTEST_EXTRA_ARGS='--blocks 150 --seconds 320' \
bash ascon-notes/eval/run-matrix.sh \
  --label xb-r-live-smoke-on --roster ascon-notes/league/roster-xb-r-live-on.yaml \
  --regimes 'calm' --seeds '39103' --parallel 1 --base-port 8847
```

4. `runtime_start.mode=improve`、model=claude-cli:haiku、CLI開始と応答、少なくとも1回の
   **実際のinstalled＋そのexecutorの判断/有効な取引**、安全、欠測/timeoutを確認。
   構文compileだけ通り実行時例外になる改訂を成功扱いしない。モデルが全declinedなら
   「改訂未成立」で止め、強制変更やsilent fallbackで緑にしない。
   取引0なら機会/ゲート/形式を切り分け、本体へ進まない。
   短縮smokeは本G0 PASSでも利益評価でもない。構成を変えたら別hashの再提案とする。
5. smoke成立後、calm/39101で360blocksのOFF1＋ON1を逐次校正（2世界）。
   `BACKTEST_EXTRA_ARGS`の上書きを外して既定360/2秒、60block機会を維持する。
   1世界ずつ別labelでrunnerを使う。本G0・安全成立と、ONで3回以上の有効な改訂応答
   （installed/declined/reverted。rejected/skipは除外）、うち少なくとも1回のinstalledと
   正常実行を要求する。smokeと校正の成績でpromptを調整せず、形式/安全/時間を判定する。
6. 各全長runは起動前に `round-manifest.py begin <label> --roster <その側yaml>
   --regimes calm --seeds 39101 --parallel 1` で既存形式のmanifestを作り、
   終了後に `g0.py <label> --roster <その側yaml> --regimes calm --seeds 39101
   --manifest <同じlabel> --json` を実行し、全ID・有限P・360blocks・362loops・
   環境p99<1000ms・timeout0・failedReads0・violations0を確認する。
   両スクリプトは `python3 -B ascon-notes/league/<script>` で呼ぶ。
   `--manifest`はファイル名ではなくlabel。既存manifestはagentツリー/roster/HEADを
   hashするがruntime/sdk等の未commit変更は網羅しないため、手順1の依存hash記録も必要。
   p99はLLM待ち時間ではなく環境 `round_timing.totalMs` のnearest-rank。
   OFFとONのcatch-up増加0、timeout増加0、判断被覆の低下≤1ppを同じp1同士で別途照合する。
   既存p3校正成立の主張はしない。LLM実行中/worker差替え付近にも判断が継続するか
   JSONLのdistinct decision blocksと時刻で確認。累計362だけで非同期性を認定しない。
7. 合格した校正の時間/利用枠から本体を見積り、上表の順番を固定して初めて32世界へ。
   本仕様の最短経路はp1のみ。p3への増加は未校正で、自動では行わない。

本体1世界の起動形は同じrunnerに `--label xb-r-live-<regime>-<seed>-<off|on1|on2|on3>`、
該当yaml、単一regime/seed、`--parallel 1`。終了・G0確認前に次を起動しない。
runnerの終了コード0は全検証完了を意味しない。OFF8セルとON各反復8セルの
台帳を別々にまとめ、全32世界で欠測/重複0を確認する。途中のP/Tで順番や試行数を変えない。

## 4. 測定値とログの解釈

| 対象 | 記録と判定 |
|---|---|
| 利益 | セルのΔT=T_ON−T_OFF、Δ(P−noop)。各ON反復ごとseed2本平均→4regime等重み平均。最悪regimeΔT、最悪世界ΔT、各regimeの最小P−noop、全世界のP/T/対noopを併記。noopは基準でT母集団から除外する既存scorerを使う |
| screen | 3反復それぞれ平均ΔT>0、平均Δ(P−noop)>0、最悪regimeΔT≥−2、noop割れ0、安全/G0成立。全反復を平均して悪化を隠さない。不成立・結論反転なら効果確認できずとして止める |
| 安全/送信 | violations、failedReads、mined revert、submit_failed、submitted/included/未包含、未解消片脚、在庫/gas/priority0逸脱。送信失敗と採掘revertを分離し、件数と分母・理由を保存 |
| 改訂 | `cand.jsonl`の `revision installed/declined/rejected/reverted` を別々に集計。declinedは正常な維持判断、revertedはモデルの復帰判断で、どちらも自動的に「失敗数」へ足さない。失敗= rejected（JSON/compile/禁止call/CLI timeout等の理由別）＋installed後の実行失敗を別表。skip・終端未完了呼出も別計数 |
| 呼出時間 | `cand.cli-timing.jsonl`の開始tsと `cand.llm.jsonl`の対応する `revision_call` 完了tsとの差（ms）。run/agentごと同時1件なので開始順で一対一対応。CLI起動・出力処理を含むend-to-end時間で、純粋なモデル推論時間ではない。各回とp50/p95/max、失敗/timeoutも残す |
| 適用遅延 | 呼出contextのblock、応答ts、installed/revertedのts、executor初回ログとその後の最初のaction blockを別々に記録。`installedAtBlock`とrevision logのroundは呼出開始blockなので適用時刻として使わない |
| G0/非同期 | 360blocks/362loops、p99<1000ms、timeout0、全参加者の判断被覆、連続欠落、catch-up、LLM実行中と差替え直後の判断継続、worker失敗を記録。コードが非同期である事実と実負荷下の成立を区別 |

CLI開始記録があるのに返答がない終端は右打切り/未完了、0msでもdeclinedでもない。
時刻逆転、開始/完了の対応不能、log cap/truncationは計測不成立。
CLI usageはstockで得られなければunknown。0token/0追加課金の実証と取り違えない。
安全なmockは輸送の検査に限り、実LLM呼出やON成功に数えない。

stockは判断ごとの権威的なversion番号を保存せず、setSource時の進行中判断は旧版で
完了し得る。promptのrevisionLabelは補助証拠でしかない。初回新版判断をログから
特定できなければ「適用block未確認」とし、installedの記録だけで非同期/実行成功を
認定しない。revertTo:0は元モジュールを戻すが、取引や在庫は巻き戻らない。

## 5. 停止条件、安全上の限界

次を検出したら新規起動を止め、当該runを隔離する。実走中の資金/規約/安全逸脱は
そのローカルrunを停止し、次の改訂機会を待って救済しない。全失敗履歴を保持する。

- dev7未終了・排他衝突、入力hash/roster/seedずれ、持越し状態、秘密/課金経路の要求。
- G0 FAIL/BLOCKED、判断停止/timeout、欠測、環境p99不合格、資源/ディスク/実行期限逸脱。
- violations/failedReads/mined revert、資金/gas/在庫違反、priority0、利益0の強制売り、
  未解消片脚、評価価格歪曲/自己取引/未来情報利用。submit_failedは全件原因を照合し、
  原因不明または反復する無効注文なら停止する。
- installed後の例外/安全逸脱、連続2回のrejected、429/枠切れ、課金へのfallback要求。
  校正の改訂数不足・取引0・ログ欠落・初回新版判断を確認できない場合も本体に進めない。
- 本体でnoop割れ、screen退行または反復で結論反転。好結果になるまで反復/seed追加や
  閾値緩和をしない。修理するなら別hash/別試験として失敗を消さず再設計する。

**経済的な安全境界はpromptのみ。自動rollbackはない。** runtimeのcheatcode検査、
compile、read-only client、送信検証は存在するが、canFund/gas reserve/利益/在庫/
revert抑制という不変条件を生成コードの外から固定していない。モデルは安全検査自体を
書き換えられる。compileは未定義helperも検出できず、モデルはこの危険を解決していない。
worker交換は旧closure/cooldownを捨てる。promptの初回2block待機も強制ではなく、
revertTo:0で元v3へ戻ったworkerにも旧状態は復元されない。呼出中の古い観測に基づく
改訂を遅れてinstallする経路にも、H1のTTL/応答失効保護はない。

測定対象は**シミュレーション（ローカルdevnet）内のみ**。「本番相当」は標準改訂機構を
使う意味で、モデル/process sandbox/課金経路/エポック持越しは本番と同一ではない。
本番提出は別判断。4レジーム診断を12レジーム、Q0/G3、性能優位や稀な損失率の保証へ
外挿しない。提出時は指定モデル/運営環境/規約とpublic60/bundle/selftest等を別途検証する。
[公式規約](https://ascon.dev/rules)は今回表示上10/20効力版・10/6公表という改定表記を
含み、作業日10/4との版差がある。将来の提出時点で有効な版を再照合する。

## 6. 時間と本人に必要な作業

未校正。旧凍結runの「13分」をON実測の見積値には使わない。
単位を分として、短縮smokeの実時間 s、360block OFF/ON校正の最大実時間 t_off/t_on、
終了確認/障害対応の予約 h 時間を使う。

- 校正実費: `(s + t_off + t_on) / 60` 時間、合計3世界（短縮1＋全長2）。
- 本体予約: `1.2 × (8 t_off + 24 t_on) / 60 + h` 時間。
- 全体予約: 校正実費＋本体予約。1.2は20%余裕、hは開始前に固定する。
  blockだけの下限は本体 `32×360×2/3600=6.4h` で、setup/終了待ち/失敗を含まない。
  LLMは非同期なので、改訂回数×呼出時間を世界時間にそのまま加算しない。
  単一世界の期限は校正後 `1.2×該当側最大実時間＋事前固定した片付け猶予` をmanifest化し、
  サブスク枠/既存日次・世代予算に入らなければ本体を開始しない。

本人の作業は**今回の実装・静的検査についてはなし**。
将来の計測は別途開始判断が必要（現在の指示は実装・仕様のみ）。既存サブスク認証/
Haiku権限/追加使用課金OFFを実行担当が確認できれば、本人による鍵発行やOllama作業はなし。
確認できない場合だけ**あり: サブスクのログイン/利用枠/追加課金OFFの確認**。
枠を買う・APIへ切り替える・本人鍵を渡す作業は要求しない。

## 7. 軽量検証と未検証

`test/xb-r-live.test.ts`はfrontmatter/モデルrouting/rosterの1flag差、git原本とSHA256、
既存6再構成フレームのexpectedV3、連続入力/重複/epoch reset、初期安全境界、
標準revision輸送、mock CLIの同一PIDと機微情報を含めない開始ログを検査する。
フレームは事後再構成であり、生のruntime snapshotではない。出典は
`test/fixtures/xb-r-dev3-v4.json`、価格深度fallback/丸め/raw tx.to欠落という限界を保持。
currentのv3 profileとの連続比較は補助で、goldenと原本hashが固定の根拠。

準備時の軽量検証結果:

- `npm run typecheck`: PASS。
- `node --import tsx --test --test-concurrency=1 test/xb-r-live.test.ts test/improve.test.ts test/runtimeLlmCli.test.ts`:
  **54/54 PASS**（新規13＋既存41）。LLM/チェーン起動なし。
- `npm run check:strategy -- example/agents/xb-r-live/agent.ts`: tsxのIPC作成が
  sandboxでEPERMとなり起動不可。同じスクリプトを
  `node --import tsx scripts/checkStrategyCode.ts example/agents/xb-r-live/agent.ts`
  で実行し、PASS、findings=0 / hints=0を確認。

実Haiku出力、ON起動、遅延、非同期性/G0、収益、smoke、Docker/ローカルdevnet、
public60/bundle/selftest、本番適合性はすべて未検証。性能は主張しない。
