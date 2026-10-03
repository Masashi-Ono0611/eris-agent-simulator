# G0 実装検証（2026-10-03）

対象は scaffold worktree の eval / league / release / practice と test のみ。
agentコード、既存run、devnet、anvil、ネットワーク、git commit/push、全体 npm test は使用していない。
既存の deployer/vendor/aave/package-lock.json / sdk/src/constants.local.ts の変更は本作業の対象外。

## 実装と反例

| 対象 | 修正前の反例・観測 | 修正後 |
|---|---|---|
| G0 単一入口 | 入口自体が無く、G0 CLI fixture は実行不能で赤 | scenario×seed / roster全ID / 有限P / summary・ログ / 負荷の積集合、JSON・表・exit 0/1/2 |
| report / ledger | G0判定も未検証表示も無い。G0結線fixtureは赤 | 非PASS時に順位・脱落を抑止、追記拒否。override表示・行への記録。PASS時も確認。全runから欠けた予定選手はoverrideでも部分採点せず、追加fixtureの赤→緑を確認 |
| degradation単体 | failedReads=7＋violationsありでも GATE PASS（Astra再現 fixture が赤） | shared summary判定でFAIL。「負荷のみ」を明示 |
| aggregate | ヘッダだけでexit0（赤）。旧版を再読取すると NaN / None P も invalid=None | 空表は非0。1人の非有限/欠測P・不揃いrosterで全シナリオ無効、部分採点なし |
| harness | loops欠測＋NaNを与えても除外0（赤） | 共通契約を使用し、全員有限P・362loopsでのみ採点。正常対照も通過 |
| verify-player | exit7なのに偽PASS出力で通過。nested禁止RPC・single quote / require / dynamic / side effect importを見逃す（赤） | returncode保存、再帰走査、全.tsをcheckerへ、解決先でcross-agent import拒否、JSON |
| release | 静的だけでexit0（赤）。旧版は確認フラグ2つだけでexit0 RELEASE READY。自己申告証跡のstdout='PASS'も途中実装では通過し追加fixtureが赤 | G0 PASS / manifest検証 / commit・ZIP hash一致 / selftest rc0と完了・Report出力を要求。静的のみexit3。verify-existingで同一ZIPを再検査 |
| manifest | 機能未実装で反例fixtureは赤 | beginを新規作成専用、終了時のprompt/roster/git変更でFAIL、同一ならPASS。既存round出力があれば開始拒否。台帳にhash/未記録 |
| practice transport | 共通許可リストが無く、新規transport fixtureはimport失敗で赤 | 許可外method・混在batch・不正JSON・Requestを送信0回で拒否。許可methodは偽transportへ到達。runtime preload経路も確認 |
| 完全ログ | 最終行が改行で閉じていないJSONLでも単体ゲートPASS（追加fixtureが赤） | BLOCKED。正常改行ログはPASS |

新規機能の「赤（機能なし）」と、旧コードに壊れた入力を与えた実際の偽成功は上表で区別した。
実装前の赤ログは `/tmp/ascon-g0-red.log` / `/tmp/ascon-evidence-red.log` /
`/tmp/ascon-transport-red.log`、追加反例は `/tmp/ascon-log-red.log` /
`/tmp/ascon-selftest-output-red.log` / `/tmp/ascon-override-red.log`。旧版aggregate/releaseの再現は
`/tmp/ascon-baseline-red-replay.log`（git showで読んだ旧版を一時領域で実行、書換えなし）。
ログは一時ファイルのため永続証跡ではない。反例生成コードは次のテストファイルに残した。

## ターゲット検証

- `python3 -B -m unittest discover -s test -p 'ascon*_test.py'`: 100件。
  - `ascon_degradation_gate_test.py`: 30件。
  - `ascon_g0_test.py`: 21件。
  - `ascon_league_harness_test.py`: 33件。
  - `ascon_pipeline_evidence_test.py`: 16件。
- `node --import tsx --test` に次の7ファイルを明示: 25件、skip 0。
  `ascon-league.test.ts`, `ascon-eval-aggregate.test.ts`, `ascon-release-prepare.test.ts`,
  `ascon-practice-env.test.ts`, `ascon-practice-run-agent.test.ts`, `ascon-practice-transport.test.ts`,
  `ascon-tools-regressions.test.ts`。最後の1件は別途Pythonの既存16件を内包する。
- releaseの出力検査追加後、`ascon-release-prepare.test.ts` 5件を再実行。
- `npm run typecheck`、`git diff --check`。

## 未検証・編集範囲

実バックテスト/public60、負荷の実測校正、devnet、Docker selftest、ZIP実起動は未検証。
合成fixtureや既存runの読取はこれらの代用ではない。現在形式のJSONLには完全な連番が無く、
有効な行の任意欠落は検出しきれない。証跡のhash照合は第三者による偽造の暗号的認証ではない。

HARNESS.md / DEGRADATION-GATE.md / release・practice README は該当節を書き換えた。
`ascon-notes/submission-checklist.md` は指定された編集可能ディレクトリの外にあるため未変更。
範囲追加を問い合わせたが回答が無いため、関連チェック項目は `release/README.md` に統合した。
