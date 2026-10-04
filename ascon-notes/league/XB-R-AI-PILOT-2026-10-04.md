# H1 パイロット仕様 — 2026-10-04（実行しない）

本人のチャット決定: 権限は検査済み方針の選択＋ENTRY。executorTs全体の
自由改訂は禁止。初期・復帰v5/50、ENTRY20–60・5刻み・最大±5、更新なし120block。
推論はサブスクのみ。第一候補 `claude-cli:haiku`。本番gpt-oss:120bに近い候補
という本人の選択であり、同等性・品質・遅延の実証ではない。
codexは本人の既存サブスクで小型モデルを選択できた場合だけ第二候補。
API/Ollama Cloud・本人のOllama無料枠・ローカルOllama・鍵操作は使わない。

## 実装の成立範囲と開始条件

実装は [xb-r-ai](../../example/agents/xb-r-ai/README.md)。engine/policyのデータ入口と
凍結版はオフライン検査対象。**標準runtimeで(a)固定templateの強制、(b)agent内
validatorの保護のどちらも成立しない**。stock ONは起動拒否。
runtime/sdk/lib/xb-rを改変していない。ローカル専用adapterの接続は未実装で、
以下はその実装・検査後の条件付き計測仕様。今回ON性能・本番適合性は主張しない。

根拠: `example/agents/runtime/improve.ts::compileExecutor` の関数本体コンパイル、
`botMain.ts`のresume/revert/install全ての`setSource`、`strategyWorker.ts`のexecutor分岐、
`invokeDecide`の戻り値とsubmitの両送信経路。templateを求めるpromptだけでは隔離できない。
提出時は`infra/submission/scan-submission.py::VENDORED`によりruntime改変を拒否する。

後続adapterは次を満たすこと:

1. 親が信頼できる各観測をgateに通知し、初回を基準、以後60blockごとに
   `request()`。同時1件、失敗の即時retryなし。署名/送信/SDK actionは既存固定v5経路。
2. 本文は`prompt.md`を主とし、標準`buildRevisionSystemPrompt`の「全体書換え/
   revert/memory」指示は使わない。自己の閉じた観測窓・現方針・ENTRY・blockを渡す。
   全参加者T・regime名・seed・未来・未確定markoutを渡さない。モデルの数値を
   安全検査値に使わない。今回は合成入力で形式のみ検査。
3. 応答は保存したticketと`accept(ticket, raw)`へ。code評価やsetSourceなし。
   worker交換なし。方針の失効/無効出力でもcooldown/予約/receipt状態は維持。
   stale/旧epoch応答は無視、現在ticketの不正はv5/50へ復帰。
4. `ERIS_AGENT_FROZEN=1`ではscheduler自体をOFF。同じadapter/engineのON/OFFで比較。
   親再起動・epoch移行ではv5/50から開始し、前runのLLM履歴・ticketを持ち越さない。
5. 各request/response/reject/install/expiry、実適用block、初回注文blockをログにする。
   拒否/timeout/nullと「有効に適用された改訂」を別件数とする。親・worker境界と
   resumeも含めゲート迂回の負対照に合格してから、計測を開始する。

dev5完了・G0影響がない実行枠・全依存hashの固定・費用なし経路の本人確認が前提。
現状はadapter条件が未成立。提出性能試験にはさらに運営hookの受入証拠が必要。

今回の[検証記録](../eval/xb-r-ai-validation.json): `npm run typecheck` PASS、
4ソースのstrategy静的検査findings/hintsとも0。新規H1 30件＋既存xb 183件＝213件
PASS（並列度1）。一時コピーの赤対照25件は対象assertionで全て失敗し、復元後も
全213件PASS。全H1 TSの復元SHA256と元xb-rの不変SHA256を記録。
日次horizon、期限境界、方針変更を跨ぐcooldown/R8確認、再構成6フレームと
連続入力の凍結一致を含む。既存xb赤対照の原本変異スクリプトは実行していない。
CLI形式validatorも合成4ケース（正常2、不正2）の期待exitを確認した。
モデル/チェーン/agy/Docker起動、フルnpm test、upstream-eval書込、commitはしていない。

## 世界・seed・反復

本体は **calm / whale / crash / depeg-persist × 39001 / 39002** = 8セル。
各セルOFF1＋ON3、計32世界。slotはcand、相手noop/multi-arb/clean-arbを固定。
候補を別runで置換し、同じseed/生成版/初期資金/horizon360/相手hash/slot順/scorer。
ONとOFFは同じ初期v5/50で、学習持越しなし。行動が変える市場分岐は効果の一部。
対応seedは同一の価格結果を保証しない。制御不能な包含時刻差もログに残す。

本体の実行順を先に固定: 8セルを上記regime順、seed昇順に並べ、奇数セルは
OFF→ON1→ON2→ON3、偶数セルはON1→OFF→ON2→ON3。同時比較せずp1を基本とする。
ONは別の推論応答履歴3本。replayを反復に数えない。途中結果によるprompt/seed変更、
好結果までの反復追加は禁止。全結果・失敗を報告する。

[seed監査](../eval/xb-r-ai-seed-audit.json): 44台帳565行、候補39001/39002、
校正39101/39102/39103はseed列0件。可視の兄弟worktree＋mainの
`runs/**/index.tsv`と`ascon-notes/eval/out/**/index.tsv`を読取のみ。
既存ascon-notesのmd/yaml/seed・validation JSONでも当候補の記述なし
（本仕様作成前、今回成果物を除外）。36001/36002は各12行、調整用途として除外。
37001/37002は未使用だが独立検証に温存。38001/38002はxa-1案に記載済みなので回避。
これは可視台帳の瞬間値。dev5結果は読まず、台帳のseed列だけを確認した。
開始直前に `python3 -B ascon-notes/eval/audit-xb-r-ai-seeds.py` を再実行し、
未記録run・他担当の予約と非交差を確認。本書は実行枠の予約ではない。

比較値はセルごとのΔT、Δ(P−noop)。ON各反復をseed平均→4regime等重みで集計し、
最悪regimeΔT、各世界のP/P−noop、noop割れ、安全/包含/失敗も併記。
screen案: 全ON反復で平均ΔT>0、平均Δ(P−noop)>0、最悪regimeΔT≥−2、全安全/G0成立。
4regimeの結果をQ0/G3/全12regimeの合格とはしない。
有限政策なのでAIの必要性はON/OFFだけで分からない。固定router Dは別途結果前に
窓・閾値・優先順を定義し、D1×8世界を追加する場合は別枠。未実装Dを計測済み対照に含めない。

## roster/env と推論

`core/src/config.ts`はagents[].envのstring値を受け取り、
`core/src/realtime/agentProcess.ts`で`Object.assign(childEnv, spec.env ?? {})`により
個体ごとに上書きする。`botMain.ts`のmodel優先順はprompt frontmatter→
ERIS_LLM_MODEL→既定。本promptはmodel未指定。
実変数は **ERIS_AGENT_FROZEN**。`ERISAGENTFROZEN`では無効化できない。

```yaml
# OFFの具体的なroster。今回は起動しない。
agents:
  - id: noop
    wallet: AUTO
    baseline: true
  - id: multi-arb
    wallet: AUTO
    env: { ERIS_AGENT_FROZEN: "1" }
  - id: clean-arb
    wallet: AUTO
    env: { ERIS_AGENT_FROZEN: "1" }
  - id: cand
    dir: xb-r-ai
    wallet: AUTO
    env:
      ERIS_AGENT_FROZEN: "1"
      ERIS_LLM_MODEL: "claude-cli:haiku"
      ERIS_IMPROVE_LOG_CALLS: "1"
      ERIS_LLM_CALL_TIMEOUT_MS: "120000"
```

**ONはこのYAMLのflagを0にするだけでは起動不可。** adapter完成後、同じcand/相手/
hashでON側だけ`ERIS_AGENT_FROZEN: "0"`。adapterも上記env名を明示的に読み、
`claude-cli:haiku`以外への暗黙fallbackを禁止。`--agent-sandbox process`必須。
stock DockerにCLIは無い。既存runner用の新しい架空env hookは定義していない。

`runtime/llm.ts::resolveLlmProvider`はclaude-cliをHTTP系より先に判定し、
`buildClaudeCliArgs`で`claude -p ... --model haiku`にする。サブスクCLI認証を利用し、
rosterにキー名/値を追加しない。CLIの利用枠と追加使用課金OFFは本人の設定で確認する。
フォールバックAPI・追加使用の有効化をしない。プロンプトのtoken上限envはHTTP系のみで、
CLIの上限を保証しない。実応答サイズはH1側で8192文字上限。

第二候補は`ERIS_LLM_MODEL: "codex:<本人がサブスクで使用可能と確認した小型model ID>"`。
`codex:<model>`はruntime上`codex exec ... --model <model>`へ渡ることのみコード確認済み。
小型modelの利用可否は未確認。`codex`無指定で大きい既定モデルへ逃がさない。
プロバイダ変更は新実験としてprompt/hash/model版を固定し、Haiku反復と混ぜない。

## 校正と所要時間

実測未校正。凍結版の旧13分/batchをONの実測に転用しない。
まずcalm/39101、OFFとONをp1で各1世界（2世界）。horizon360、改訂機会は60block。
ONは有効適用cycleを3回以上観測、少なくとも1回は実設定変更し、遅い応答の棄却と
120block失効も別の隔離adapter検査で確認。正常cycle不足なら不成立として止める。
新たな世界・blockの自動延長で成立扱いにしない。

記録: 壁時計、decision被覆/p99、block遅延、LLM開始/skip/応答/拒否/適用、
呼出観測→検証完了→初回判断block、失効、usage取得可否、429、timeout、retry件数。
stock installedAtBlockは呼出開始を記録するので、それだけで適用遅延を算出しない。
API課金は0が必須。CLI usage不明は0tokenと記録しない。

p1校正の最大所要分を t_off / t_on とし、本体予約は
**1.2 × (8 t_off + 24 t_on) / 60 時間＋終了確認/障害対応**。
サブスク枠/G0が許す場合だけ任意のp3校正を追加:
calm/39101,39102,39103の3セルでOFF/ON各1batch（6世界）。39101の再使用は
校正内だけ。本体seedに流用しない。校正総量最大8世界。
p3成立時、反復ごと切上げでOFF3batch＋ON9batch、予約は
**1.2 × (3 b_off + 9 b_on) / 60 時間＋支援**。
旧13分を単なる例に使えば、ON倍率rで支援前 `1.2 × (0.65 + 1.95r)` 時間。
rは未測定。校正失敗時にこの式を実行見積の確定値として使わない。
同時推論による枠制限を検査せずp3へ増やさない。

## 停止条件

ゲート迂回、設定/対応/hashずれ、G0不成立、decision欠測の予算逸脱、資金/gas不足、
priority0、無効注文、mined revert、violations/failedReads、未解消片脚、未回収自前資産
を検出したら新規起動停止。送信失敗は全件原因照合、原因不明/反復不備は停止。
LLMが有効設定変更を行わない・失効しない・古い応答を適用・形式拒否反復・429/枠切れ・
課金経路を要求した場合も停止。拒否やtimeoutを安全に処理しただけでは改訂成功に数えない。
AI必要性/性能の結論が反復で反転した場合、追加試行で救済しない。
ローカルOllama起動・本人鍵/無料枠利用・未承認API移行は禁止のまま。
