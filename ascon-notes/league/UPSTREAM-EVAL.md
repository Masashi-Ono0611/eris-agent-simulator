# Upstream 評価（2026-10-03、merge 後のオフライン適合）

## 結論・対象

- `eval/upstream-merge` / worktree `upstream-eval` の HEAD は **18cbeb9**。親は `d7826f7` と `879c428`、upstream 40 commit を merge commit で取り込み済み。コンフリクトなしは作業依頼時の報告、今回確認したコードはこの merge 後の状態。
- 本適合の指定テストは **333件 / 331 PASS / 0 FAIL / 2 SKIP**。`npm run typecheck` はエラー0。性能 **T/P は実バックテスト前なので未検証**。
- 実装変更はこの worktree の3エージェントと `load-probe.sh` のみ。テスト・本文を更新し、upstream の lib / sdk / core / 参照エージェントは変更していない。commit / push / fetch / 依存追加なし。
- 全体の `npm test`、実バックテスト、devnet、Anvil、Docker、ネットワークは実行していない。外部規約・remote 最新性は未確認。スキルの全体テスト・外部同期・worktree 外の記録は今回の作業制約を優先して実施していない。
- 旧本文は `cbec5ad`（13 commit）の検証コピー時点だった。`.upstream-eval-preview/` と従来の全体テストログは今回の検証根拠ではない。現在の根拠は `.upstream-eval-evidence/adaptation-*`。本文中の行番号は特記なければ適合後の本 worktree。

## 失敗原因と対応

修正前の指定範囲は合計 **322件 / 247 PASS / 73 FAIL / 2 SKIP**（重点118件と残り204件を分けて実行）。launch の `rawBundle` が通常裁定の `bundle` に変わったのは、アクション形式の変更ではなく launch 候補が空になり dispatcher が delta にフォールスルーしたため。

| 失敗テスト | 分類・根拠 | 対応 |
|---|---|---|
| `ascon-epsilon`: `launch confirms consecutive buying, then exits on selling, max hold, and endgame`（1件） | upstream による fixture のずれ。旧 `test/ascon-epsilon.test.ts:19` は pool だけ、`launchSwap.ts:114-116` が必須とする token の ERC20 登録なし | `test/ascon-epsilon.test.ts:20` と共通 fixture で token 登録・同一creator・一致codehashを追加。`rawBundle` 期待値は維持。60 block 保有上限と通常の残12 block出口も明示確認 |
| `ascon-zeta`: 同名 launch テスト（1件） | epsilon と同じ。旧 `test/ascon-zeta.test.ts:20` の pool-only registry | `test/ascon-zeta.test.ts:21` を同様に更新。入口→売り→強制出口→残高ゼロでdelta復帰の期待を維持 |
| `zeta-2`: 下表の69件 | upstream による fixture のずれ。旧 `test/zeta-2.test.ts:112` が全候補を pool-only で作成。watch/entry 不成立のため保有・期限・出口・prune 検証が連鎖失敗 | `test/zeta-2.test.ts:107-129` の共通 harness を pool＋token の対に更新。fresh/cap 用 `splice` も対単位へ（同:472,498）。既存の売買・期限・minOut・件数期待は維持 |
| `opus-1`: `decide: a chain read that never answers does not eat the five-second deadline`（1件） | upstream による fixture のずれ。`test/opus-1.test.ts:545` の registry に token 登録がなく、RPCを開始せず `module launch failed` が出なかった | 同:559 にERC20登録を追加。2.5秒未満と失敗ログの両期待を維持。opus戦略自体は変更しない |
| `ASCON tooling offline Python/shell regressions`（wrapper 1件）: `test_malformed_summary_recorded_by_both_readers` の7 subcase、`test_league_equal_regime_weight` | 私たちのtest loaderの前提。`league-report.py:7` の sibling import を `spec_from_file_location` が解決できない。upstream差分にはascon-notesもこのtestも含まれない | `test/ascon-tools-regressions.py:17-23` でロード中だけscript親をsys.pathへ追加。等重み50/最悪40の値は維持し、`league_harness.py:275` の2桁表示に期待文字列を適合（同test:119-121）。import失敗に隠れていた表示期待のずれも解消 |
| 同wrapper: `test_load_probe_generation_failure_stops` | 私たちのtoolの実際の挙動。`--dry-run` が参照欠落の検査より先に成功終了 | `ascon-notes/league/load-probe.sh:47-53` に実行/dry-run共通の存在検査。欠落時は両方失敗し子matrixも一時rosterも作らない。testのdf/memoryはstub化してホスト資源に依存させない（同Python:231） |

`ascon_degradation_gate_test.py:138` の正常系setupにも4参照ディレクトリを追加した。上のdry-run修正後、従来の空workspace fixtureだと正常系5件（agents compatibility / exact disk / healthy memory / parallel range / port boundary）が新しい存在検査で落ちたため。資源・port境界や無書込みのassertは変更していない。

### zeta-2 の修正前失敗一覧

全行の直接原因と対応は上表の共通harness更新。行番号は現在のテストで、`${...}` は元テストのパラメータ展開を表す。合計69件を網羅する。

| テスト名・テンプレート | 件数 | 根拠 |
|---|---:|---|
| `8 launch tracks held positions across same/missing block ${block}` | 2 | `test/zeta-2.test.ts:174` |
| `8 dispatcher does not reset launch holdings on a gap` | 1 | `test/zeta-2.test.ts:178` |
| `9 expired budget starts no new RPC work across a large registry` | 1 | `test/zeta-2.test.ts:184` |
| `9 timeouts bound each decision and stale slots recover on later decisions` | 1 | `test/zeta-2.test.ts:190` |
| `9 early rejected state reads cannot orphan unbounded sibling RPCs` | 1 | `test/zeta-2.test.ts:197` |
| `10 mandatory exit survives ${failure}, remaining=${remaining}` | 9 | `test/zeta-2.test.ts:207` |
| `10 dust quote never permanently retires a held position` | 1 | `test/zeta-2.test.ts:213` |
| `11 ${noise} flow resets confirmation streak` | 2 | `test/zeta-2.test.ts:218` |
| `11 duplicate blocks do not advance streak and gaps cannot count as consecutive` | 1 | `test/zeta-2.test.ts:222` |
| `12 only the returned entry is marked pending` | 1 | `test/zeta-2.test.ts:227` |
| `12 exit priority does not mark an unreturned entry pending` | 1 | `test/zeta-2.test.ts:232` |
| `C1 quote failure fallback boundary remaining=${remaining}` | 8 | `test/zeta-2.test.ts:284` |
| `W4 rewind drops zero-balance pending entry immediately` | 1 | `test/zeta-2.test.ts:354` |
| `W4 rewind rebases held timestamp, forward gap preserves hold age` | 1 | `test/zeta-2.test.ts:359` |
| `W5 expired holdings request releases its key for a recovered client` | 1 | `test/zeta-2.test.ts:365` |
| `W5 optional hanging reads leave a slot for mandatory holdings and quote` | 1 | `test/zeta-2.test.ts:375` |
| `W4 rewind reconciliation survives a failed balance read through dispatcher` | 1 | `test/zeta-2.test.ts:409` |
| `W5 late stale settlement cannot remove a still-pending replacement with the same key` | 1 | `test/zeta-2.test.ts:418` |
| `G1 minOut boundary remaining=${remaining} quote=${quote}` | 20 | `test/zeta-2.test.ts:438` |
| `G2 quote timeout releases its key and never forces a nonterminal sale` | 1 | `test/zeta-2.test.ts:448` |
| `G3 idle zero-balance watch is pruned at 30 blocks and not immediately rediscovered` | 1 | `test/zeta-2.test.ts:465` |
| `G3 fresh discovery is protected and precedes old optional reads` | 1 | `test/zeta-2.test.ts:471` |
| `G3 recent pool activity renews the idle grace period` | 1 | `test/zeta-2.test.ts:479` |
| `G3 pruning protects ${mode} balances` | 4 | `test/zeta-2.test.ts:486` |
| `G3 watch cap preserves holdings and prevents unbounded discovery` | 1 | `test/zeta-2.test.ts:497` |
| `G4 gap inspects missing sales in one bounded log request even when buying offsets them` | 1 | `test/zeta-2.test.ts:508` |
| `G4 ${mode} gap uncertainty schedules protected exit on the next block` | 3 | `test/zeta-2.test.ts:516` |
| `G4 gap cannot dismiss past selling using a later larger reserve` | 1 | `test/zeta-2.test.ts:544` |

## launch API 適合と挙動の境界

- upstream **99367d4** の基準は `example/agents/lib/launchSwap.ts:64-84,114-128`。tokenにERC20登録があること、pool/tokenのcreator一致、現在codehashが登録時から不変、期待hashが分かる場合はAgentERC20のruntime hashとの一致を要求する。
- 参照実装 `launch-confirm/agent.ts:82-91` / `launch-sniper/agent.ts:71-80` に倣い、3エージェントは `launchTokenCodehash(client)` → `launchPools(obs, { tokenCodehash })` を使う。`LaunchPool.tokenCodehash` は共通libから返される。独自の許可creatorや推測hashは導入しない。
- **実際に変わる挙動**: hashが取得できれば、形状だけ似せた異なるbytecodeのtokenは新規watch/買付対象にならない。上場token登録が遅れると、公開されるまで入場しない。`mine` の除外は従来どおり。
- epsilon/zeta原本の実装差分は import、hash取得、filter引数、fallbackの一度だけのログに限定。サイズ・連続買い閾値・売り条件・保有上限・終盤条件を変えていない（両 `launch.ts:94-105`）。追加のhash RPCは既存1.2秒timeoutを使う。外側だけタイムアウトすると共有helperの未解決Promiseが残るため、`client.call` 自体をtimeoutさせて次回リトライ可能にする。
- zeta-2は `launch.ts:125-133` の既存RPC wrapperに `call` を追加し、hash取得も4秒budget/optional同時read枠に従わせる。既存保有の処理後に取得し、出口選択済み/期限切れでは新たなhash RPCを開始しない（同:232-255）。既存の保有・出口優先、gap・minOutの保護は維持。
- **参照実装と同じ制限**: artifact不在/RPC失敗でhash不明ならログを一度出し、形状チェックのみになる。これは異なるbytecodeを排除する保証がない。さらに同じAgentERC20 bytecodeを同一creatorで登録した参加者のpoolはupstreamも許容する（lib:77-80）。「環境の上場と同形」であり環境所有の証明ではない。既存watchの再認証も参照実装同様行わないため、shape-only期間に登録したwatchを後のhash取得だけで除去する仕様ではない。
- 実artifactは本worktreeの既定`out/`にない。`sdk/src/forge.ts:17-18` の `ERIS_FORGE_OUT` またはbundle内artifactと実nodeでのhash取得は未検証。helperは成功hashをprocess内でcacheし、call例外は再試行する一方、artifact不在/空dataのnullはcacheされる（lib:157-182）。実環境でartifactを準備してからプロセスを開始する必要がある。
- テストの新共通fixture `test/fixtures/ascon-launch.ts:9-35` は合成artifactとstub `client.call` のruntime bytesを使う。実helperが算出するkeccak256とregistryを一致させ、形状だけでなくcodehash照合まで実行。実contractをdeploy/実行した証拠ではない。
- 新規11件: zeta-2のhash RPC停止→1.2秒timeout→次decision再試行（`test/zeta-2.test.ts:132`）、token登録欠落/creator違い/code変更/異code/自己poolそれぞれ「単独」「正常pool混在」の10件（同:144-172）。拒否対象のpool readがなく、混在時は正常tokenだけ3連続買い後にentryする。filter引数を一時的に省くnegative controlでは異codeの2件がFAIL、復元後PASS。テスト内assertをRPCのcatchに飲ませないよう、呼び出し履歴のassertはdecision外で行う。

## 他のupstream変更と評価への影響

- `rawTxGuard`（`example/agents/runtime/rawTxGuard.ts:10-17`）はLLM改訂後version > 0の送信先/transfer/approve等を制限するruntime境界。今回の失敗はdecision戻り値を直接検査する段階であり、この送信guardが`rawBundle`を`bundle`へ変えたわけではない。
- `endowmentV0` は **V0 = max(endowment, measured)** を最初の境界に適用（`core/src/scoring/endowmentV0.ts:57-85`）。旧本文の「P入力はstable評価だけ変わる」は不十分で、初期資産を移すことでV0を下げられなくなった。`v0Flags` / `scenarioScores.ts:166` はV0由来の情報を結果へ伝える。これらはlaunch fixture失敗の原因ではない。
- P→T→epoch加重平均、baselineを母集団から除く基本式は維持（`docs/guide/scoring.md:20-53`）。stablesはwallet/venue分を合算したown-size売却/買戻し評価へ。quote欠測の`mid-fallback`も確認対象（`docs/competition-start.md:205-216`、`sdk/src/valuation.ts:40-55`、`core/src/realtime/reconstruct.ts:612`）。Uniswap LPの内訳も整数tickではなくsqrtPriceX96基準へ（4715b25）。今回の単体PASSはP/T改善の証明ではない。
- 本番regimeは独立一様抽選（`core/src/competition/schedule.ts:155`）。public 60のシナリオ列挙は不変。研究用leagueのregime等重み集計は、本番の実現頻度・時系列加重を再現するものではない。
- RNGにregime名を含める `regime-v1`（`sdk/src/rng.ts:140`）。同じ整数seedでも旧/新は別市場。旧matrixや別streamからのresumeは拒否（`core/src/backtest/resume.ts:159-177`）。`compare.py` / league集計はsourceCommitやstream互換を自動検査しないため、旧新の入力を混ぜない。
- audienceのregime/stress/event公開制限も入っている。operatorの生ログと公開表示を区別する。今回の回帰は合成summaryを用いたオフライン検証。

## State dump・提出物

- deployer/contracts/constants.local.tsに差分はないが、40 commit範囲では **scripts/genStateDump.tsに変更あり**。public test accounts情報をmanifestへ保存（同:128,158）。live weekは当該情報が欠ける旧manifestや公開account入りdumpを拒否する（`core/src/realtime/liveWeek.ts:165-189`）。以前の「dump再生成不要」を全環境に一般化できない。
- local backtestの既存dumpの互換性、実manifest/fingerprint、live用の再デプロイ/再生成要否は未検証。今回dumpの生成・Anvil操作はしていない。
- `bundle:agent --submission` は対応オプションではない（`scripts/bundleAgent.ts:83-96`）。提出TSは`decide()`＋prompt frontmatter（kind/name/description）。SDK/runtime/libの配布版一致とZIP受理は別検証。
- bundleはagentと共有libのartifact参照をscanする（`scripts/bundleAgent.ts:145-158`）。AgentERC20 artifactが実際に含まれていることとnodeでhashが取れることは、次のbundle/selftestで確認する。今回ZIP作成・scan・selftestはしていない。

## 実行した検証

| 検証 | 結果 |
|---|---|
| `npm run typecheck` | PASS、エラー0 |
| 指定の `test/ascon-*.test.ts` 15ファイル＋`{astra-1,astra-2,sonnet-1,sonnet-2,opus-1,grok-1,zeta-2}.test.ts` 7ファイル | **333件、331 PASS、0 FAIL、2 SKIP** |
| `test/ascon-tools-regressions.py -v`（`python3 -B`） | **16/16 PASS** |
| `test/ascon_degradation_gate_test.py -v`（`python3 -B`） | **29/29 PASS** |
| `test/ascon_league_harness_test.py -v`（`python3 -B`） | **33/33 PASS** |
| 関連upstream純粋単体: `rawTxGuard` / `launchPools` / `v0Flags` / `endowmentV0` | **27/27 PASS**、ソース改変なし |
| 変更したlaunch 3ファイルの `checkStrategyCode.ts` | **3/3 PASS**、findings/hintsなし |
| `bash -n ascon-notes/league/load-probe.sh` / `git diff --check` | PASS |
| filter省略のnegative control（復元済み） | 異code拒否の**2件が期待どおりFAIL** |

指定TS実行コマンド（全体`npm test`ではない）:

```sh
node --import tsx --test --test-concurrency=4 test/ascon-*.test.ts \
  test/astra-1.test.ts test/astra-2.test.ts test/sonnet-1.test.ts test/sonnet-2.test.ts \
  test/opus-1.test.ts test/grok-1.test.ts test/zeta-2.test.ts
node --import tsx --test test/rawTxGuard.test.ts test/launchPools.test.ts \
  test/v0Flags.test.ts test/endowmentV0.test.ts
```

Python計78件はTS wrapper内でも実行されており、331 PASSへ加算してユニーク件数を水増ししない。SKIPは`aggregate reproduces reference P and T`と`seed 101 real four-world indices run and retain expected candidate names`。既存実結果fixtureがこのworktreeにないためで、期待値を弱めたりskipを追加したものではない。

最終ログ: `.upstream-eval-evidence/adaptation-all-targeted.log`、`adaptation-typecheck.log`、`adaptation-python-{tools,degradation,league}.log`、`adaptation-upstream-pure.log`、`adaptation-strategy.log`。修正前の失敗は`adaptation-before.log` / `adaptation-others-before.log`、negative controlは`adaptation-negative-control.log`。証拠/previewディレクトリはcommit対象から分離する。

## 変更ファイル・残課題

- 実装: `example/agents/{ascon-epsilon,ascon-zeta,zeta-2}/launch.ts`、`ascon-notes/league/load-probe.sh`。
- テスト: `test/{ascon-epsilon,ascon-zeta,zeta-2,opus-1}.test.ts`、`test/fixtures/ascon-launch.ts`（新規）、`test/ascon-tools-regressions.py`、`test/ascon_degradation_gate_test.py`。
- 文書: 本`UPSTREAM-EVAL.md`（開始時からuntracked）。Git commit/pushはユーザー側で実施。
- opus-1も`launchPools(obs)`を使うが、codehash引数を渡す戦略変更は今回指定の3エージェント外なので行っていない（`example/agents/opus-1/agent.ts:1007`）。その戦略まで同等のcodehash防御を求める場合は別適合が必要。
- 本作業のオフライン適合は完了。**性能T/P、public 60 backtest、devnet、実artifact/hash取得、ZIP受理、Docker/selftest、実dump互換、ネット上の最新規約は未検証**。

## 旧評価比較・R1再評価の手順案（未実行）

1. 本差分をユーザーがcommitし、採用するコード/roster/agent SHAを固定する。旧R1台帳の旧commit `9b7da50d`、12 regime × seeds 201/202/203、11体・parallel=3は台帳の記録であり、今回36 runを再監査してはいない。
2. 旧側は旧コード、新側は本適合後コードで、同じロスター・初期条件・制限・負荷条件を明示し、別label/output/stateへ実行。既存matrixへresumeしない。事前にdry-runとdump適合を確認する。
3. 同じseedでも別市場なので比較は「評価＋市場生成＋API適合」の移行効果。採点だけの差には同一境界block/保有/own-size quoteへ旧新scorerを適用する別検証が必要。旧summaryのPだけからは復元できない。
4. 完走、failedReads、violations、mid/par fallback、V0 source/flags、遅延を点検し、旧台帳を上書きしない。各版を別集計し、平均T・最悪regime・noopとの差を確認。旧新同seedを同じ市場のpaired CIにしない。
5. 未使用seedで候補を確認して新基準を固定する。許可が変わるまで今回の作業から実行しない。
