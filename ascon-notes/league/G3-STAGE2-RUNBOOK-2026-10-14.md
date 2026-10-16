# G3 Stage 2 実モデル最小診断ランブック

## Current checkpoint: STOP

As of 2026-10-16, this runbook remains a design/fake-test artifact. Stage2 `run` and `invoke` are hard-disabled; no real world, CLI, model, provider, or Anvil has been run. G3 is BLOCKED, and this document does not grant runtime approval. The coordination handoff at `/Users/masashi_mac_ssd/Documents/ChatGPT/ascon/operations/2026-10-14/STATUS.md` is a separate workspace whose directory date is not its last-update date. It records ongoing coordination; the candidate-specific checkpoint below scopes the saved offline receipts. Historical candidate sections below explain revisions and must not be read as current runtime acceptance. The remaining intentional blockers include execution identity and routing, same-UID evidence forgery, independent watchdog, runtime output provenance, CLI HOME/memory, and resource/escaped-child limits. The owner has authorized continued offline development and integration when verification finds no material issue. Offline-only changes may proceed through the required review, documentation, PR and CI gates; integrating them does not authorize Stage2 execution or clear G3 acceptance.

### 2026-10-16 offline hash-budget and validation checkpoint

The diagnostic plan now requires an explicit schema-2 `input_hash_policy`; the guard does not infer a plan's per-job limits. The implementation enforces fixed ceilings of 64 MiB per unique file, 128 MiB across unique input and prerequisite-evidence files, and 1,024 unique files. Each synthetic plan must supply plain-integer limits at or below those ceilings. Preparation and verification use bounded hashing and record policy/accounting in the receipt; verification checks that accounting against the pinned plan. These code ceilings bound this prototype and are not a universal operator policy. See the [Stage2 guard prototype reference](g3/stage2/README.md) for the schema, trust boundary, and preparation details.

Saved offline verification for source commit `ba2f4e2d6df1af71f0aaba0f4b38a75c35e3ab56` reports 176 passed and 1 skipped of 177 tests on macOS; the Stage2 guard suite reports 140 passed and 37 platform-skipped tests on Linux; and the selected Pregate run reports 497 collected tests across 12 files. These are synthetic/local checks, with the Linux selected run explicitly cache-only. They do not constitute GitHub hosted CI, provider/model execution, Anvil/world execution, runtime acceptance, or G3 approval. Hosted Linux `ci.yml/check` remains a separate publication gate. Stage2 remains STOP; G3 remains BLOCKED; `run` and `invoke` remain disabled.

## この文書の読み方

- `[事実: ファイル:行]` は指定 worktree の該当行で確認した内容。`[事実: owner提示]` は今回の依頼に書かれた所有者の判断。
- `[推論]` は根拠から導いた予測であり、実行結果ではない。
- `[不明]` はこの worktree の資料から確認できないこと。
- `G3` は Gate 3（自己改訂戦略の受入れ段階）、`F_ref` は参照相手だけの場、`PID` はプロセス識別番号、`PPID` は親プロセス識別番号、`PGID` はプロセスグループ識別番号、`CLI` は Command-Line Interface（コマンドライン操作）、`PATH` はコマンド検索先、`JSONL` は1行ごとに1つの JSON を書く形式、`OAuth` は Open Authorization（アカウント認証方式）、`LLM` は Large Language Model（大規模言語モデル）、`seed` は乱数初期値、`world` は市場条件と seed の組、`roster` は参加者名簿を指す。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:7-13; G3-GAP-CLASSIFICATION-2026-10-14.md:22]

## 2026-10-15 再レビュー時点の実行停止

この文書は改善中であり、現時点では実モデル診断を開始しない。最大6 CLI起動の計数・拒否、quota/429/予期しないprovider/modelの自動停止、専用process groupの終了確認、Claude子へのprobe環境の遮断、共有アカウント利用元と実行窓、B05/B07/B08bの証跡が揃っていない。本人の段階2実施承認は過去の記録として保持する。ただし最新の実行状態は STOP であり、この過去の承認を現在の起動許可として扱わない。以下の起動例には無条件の停止を入れ、必要な制御の実装と対照検証を終えるまでは外さない。

miniの2026-10-14 23:53 JST頃の読取で、Claude CLI 2.1.278、loggedIn=true / authMethod=claude.ai / apiProvider=firstParty / subscriptionType=maxを確認した。秘密・email・orgId等は出力していない。Node v24.13.0を公式配布元から導入しchecksum一致、tsx4.23.13を確認した。これらは追加利用OFF、quota残量、他の利用元や実走干渉の証明ではなく、実行直前に再確認する。

## 目的と境界

この手順は Mac mini で `ascon-zeta-r3` の自然な自己改訂を一つの `calm` world で観察する診断である。Go/No-Go、G3 合格、候補と凍結対照の優劣を判定する試験ではない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:140-149; 推論]

外部の実行環境は変えず、実装・手順で可能な確認を進めるという所有者判断がある。所有者は追加利用（従量課金）を OFF にしたことを確認し、開発時のモデル料金はサブスクリプション枠だけ、API キー請求・有料経路・別モデルへの自動切替なしと指定した。[事実: owner提示 2026-10-14; DECISIONS-2026-10-14.md:7-16 はこの追加利用確認・Stage 2 承認の詳細を記載していない]

この所有者判断は、サブスクリプションの残枠、mini でのログイン状態、予算予約、ホスト排他、評価環境準備を証明しない。いずれかの必須確認が未完了なら実行しない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:45-48, 140-149; 推論]

## 実行条件

開始前に次を満たす。どれか一つでも不明なら停止する。

1. 開始時点で mini の追加利用が OFF であることは所有者が確認済み。[事実: owner提示 2026-10-14]
2. B05 の利用枠予約と既利用分の照合、B08b の mini のホスト排他・容量・プロセス一覧確認、B07 の隔離評価ソース・依存・状態ダンプが開始可能と確認されていること。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:45-48, 90-101, 140-149]
3. mini の同じ Claude サブスクリプションを使う定期処理・自動化を列挙し、実行時間と重ならないと所有者が確認すること。既存資料では共有利用の有無は未確認。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:146-149]
4. `~/ascon-dev` が診断用の `origin/main` checkout であり、今回の roster、`ascon-zeta-r3`、wrapper、loader がその checkout に存在すること。Stage 1 の状態ダンプは `~/ascon-run/p60/backtest/state` から診断 checkout の `backtest/state` にコピーしたものを使い、元を変更・移動しない。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:19-29, 33-51]
5. Node.js `v24.13.0` と `tsx 4.23.13` を使う。loader はこの二つを固定確認する。Stage 1 は Node.js `v24.19.0` を使ったため、そのままでは loader の固定値に合わない。版の上書きで強行しない。[事実: g3/loader/probe-toolchain.mjs:3-19; g3/chain/README.md:14-18; G3-STAGE1-RUNBOOK-2026-10-14.md:121-128]
6. `~/ascon-run/bin/anvil` が PATH の先頭から起動し、版が1.2.3であること、診断 checkout 内で `forge build` が完了し、`ERIS_FORGE_OUT` が未設定であること。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:53-71]
7. 睡眠を防ぎ、電源につなぐ。重い build、試験、container、別の Anvil、定期処理がなく、監視を最後まで続けられる静穏時間であること。Stage 1 では準備込み約13分だったが、実モデル呼出し込みの所要時間は未測定。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:90-92; 不明]

> **現行状態: 実行禁止（歴史的・非実行資料）** — Stage2 は STOP、G3 は BLOCKED、`run`/`invoke` は無効です。以下の shell コマンドは過去の計画記録であり、現在の認証・実行許可を与えるものではありません。本文にある条件を満たして見えても、この停止状態を解除しません。現在の指示に基づく独立した再承認がない限り、実行しないでください。

## 料金・ログイン・環境の読み取り専用事前確認

次の確認は mini の `~/ascon-dev` で行う。値、トークン、秘密鍵、RPC URL/ヘッダーは表示・記録しない。`.env` の中身を読むコマンドは実行しない。[事実: AGENTS.md の絶対ルール; g3/loader/README.md:30-33]

```sh
(
cd "$HOME/ascon-dev" || exit 1
command -v claude >/dev/null || { echo 'STOP: claude CLI missing'; exit 1; }
claude --version
AUTH_RESULT="$(claude auth status --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); ok=(d.get("loggedIn") is True and d.get("authMethod")=="claude.ai" and d.get("apiProvider")=="firstParty"); print("subscription_oauth_ok" if ok else "STOP: subscription login not verified"); sys.exit(0 if ok else 1)')" || { echo 'STOP: auth status failed or subscription login not verified'; exit 1; }
printf '%s\n' "$AUTH_RESULT"
if env | cut -d= -f1 | grep -qx ANTHROPIC_API_KEY; then
  echo 'STOP: ANTHROPIC_API_KEY is present; value was not displayed'
  exit 1
fi
unset ANTHROPIC_API_KEY
printf '%s\n' 'ANTHROPIC_API_KEY absent'
)
```

`ANTHROPIC_API_KEY` の確認は環境変数名だけを調べ、key の値を表示・読出ししない。runtime は Claude CLI に渡す環境からもこの変数を削除する。[事実: llm.ts:587-600; 推論]

`claude auth status --json` は2026-10-14 23:53 JST頃にminiで読み取り実行し、2.1.278の出力で `loggedIn=true` / `authMethod=claude.ai` / `apiProvider=firstParty` / `subscriptionType=max` を確認した。上の限定field判定はこの観測に基づく。CLI更新後や開始直前は再確認し、JSONが異なる、出力が空、または照会が不明な動作をする場合は停止する。出力全体やemail/token/orgIdを貼らない。この状態はquota残量・追加利用OFF・他利用元の排他を証明しない。

この確認では追加利用 OFF を判定できない。OFF は所有者が既に確認した設定として扱い、ログイン成功を OFF の証明に読み替えない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:46, 145, 148; owner提示 2026-10-14]

同一アカウントを利用する実行中プロセスと登録済み LaunchAgent の名称だけを読み取る。内容や引数は出力しない。[推論]

```sh
ps -Ao pid,ppid,stat,etime,comm | awk 'NR==1 || tolower($5) ~ /claude|node|python/'
launchctl list | awk 'NR==1 || tolower($0) ~ /claude/' | cut -f1,3
```

この一覧だけでは、遅れて起動する定期処理、別ユーザーの処理、または Claude CLI を子として起動する別名の自動化を網羅したとは言えない。所有者が mini 上の同一アカウント利用元を別途確認できなければ停止する。[不明]

## seed・出力先・記録先の事前確認

この runbook では seed `923847`、label `g3-stage2-live-haiku-20261014`、市場条件 `calm`、並列数1を提案する。seed は候補値であり、未使用を証明していない。次の検索がすべて0件で、さらに予約台帳・実行履歴との照合が済むまで採用しない。[推論; G3-STAGE1-RUNBOOK-2026-10-14.md:73-88]

```sh
(
cd "$HOME/ascon-dev" || exit 1
git grep -nw 923847 origin/main -- .
find "$HOME/ascon-run" "$HOME/ascon-dev" "$HOME/Developer/ascon-g3-eval" -name '*923847*' -print
grep -rIlE '[Ss]eeds?"?[:= ]+\[?"?923847' "$HOME/ascon-run" "$HOME/ascon-dev" "$HOME/Developer/ascon-g3-eval"
)
```

各検索のヒット、検索エラー、対象 directory 不在は STOP とする。Stage 1 の seed 検索パターンは配列の先頭以外にある seed などを見落とし得て、正式な監査ではない。出力が0件でも未使用の証明ではない。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:73-88]

label、loader sink、process watch、launcher log がまだ存在せず、空き容量の事前値も満たすことを確認する。Stage 1 の準備では `MIN_FREE_GB=40` を使用した。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:119-143]

```sh
(
test ! -e "$HOME/ascon-dev/ascon-notes/eval/out/g3-stage2-live-haiku-20261014" || exit 1
test ! -e "$HOME/g3-stage2-live-haiku-20261014.probe.jsonl" || exit 1
test ! -e "$HOME/g3-stage2-live-haiku-20261014.process-watch.log" || exit 1
test ! -e "$HOME/g3-stage2-live-haiku-20261014.launch.log" || exit 1
df -g "$HOME"
)
```

## Claude 呼出数と停止条件

`ascon-zeta-r3/prompt.md` は `reviseEveryBlocks: 60`、Stage 1 の360 block worldでは改訂 call が block 1352, 1412, 1472, 1532, 1592, 1652 に現れた。従ってこの360 block診断で runtime が開始できる改訂 call は最大6回と見込む。[事実: example/agents/ascon-zeta-r3/prompt.md:1-8; G3-STAGE1-RESULT-2026-10-14.md:35-45; 推論]

6は runtime の call 起動上限の見込みである。Claude CLI 自身が通信を再試行するか、サービス側で1起動を何回の請求単位に数えるかは資料にないため、外部 request の絶対上限とは断言できない。自動再試行・別モデル・API経路・従量課金へ移らない設定が確認できなければ実行しない。[不明]

次のいずれかが出たら world を即時中断する。再試行して続けない。[推論; G3-GAP-CLASSIFICATION-2026-10-14.md:146-150]

- `429`、rate limit、quota exhausted、usage limit、支払い/費用が発生した旨の表示。[推論]
- 記録された model が `claude-cli:haiku` 以外、API/provider が異なる、または自動 fallback の兆候。[事実: g3/ref-on.yaml:27-36; llm.ts:778-785; 推論]
- wrapper の `g3-cli-binding: guard=...`、`spawn ... failed`、loader の `G3_*` エラー、欠けた start/probe log、予期しない seed/roster/world、監視の欠落。[事実: g3/claude-start-binding.py:14-17, 78-93; g3/loader/probe-loader.mjs:10-20, 26-35; 推論]
- 子プロセスが時間切れ、world 完了後も残る、または候補以外のプロセスが予期せず起動する。[事実: llm.ts:543-565; G3-STAGE1-RESULT-2026-10-14.md:39-51; 推論]

通常の Claude 呼出しは300,000ミリ秒で時間切れとなり、標準 runtime は直接の子に SIGKILL（強制終了 signal）を送る。wrapper は `exec` で同じ PID のまま `claude` に置き換わる。子孫すべてが終了する保証はない。[事実: ref-on.yaml:30-35; llm.ts:543-565; claude-start-binding.py:88-93; G3-STAGE1-RESULT-2026-10-14.md:41-51]

## 一時 roster と起動前のSTOP

この手順では一時 roster を生成しない。prototype は roster のagent別 `env` を解析せず、実起動コマンド・prompt・roster内のmodel routeも一体として拘束していない。特に `ERIS_CLAUDE_BIN` / `NODE_OPTIONS` / `G3_*` の候補別指定がguard shimを迂回または計測設定と衝突させないことを証明できていない。固定スキーマをguardが検証し、実起動argvと全関連source hashへの結合を独立レビューするまで、roster作成・world起動は停止する。[事実: g3/stage2/stage2_guard.py:prepare, supervise; 推論]

> **現行状態: world 起動禁止** — 次の監視・起動用 shell ブロックは歴史的な手順案です。Stage2 STOP / G3 BLOCKED / `run`・`invoke` 無効のため、watcher の開始も含めて実行しないでください。ここに示す launcher コマンドは実行許可ではありません。

## 子プロセス監視・world 起動

現在はSTOPのため、監視daemonも起動しない。将来の実行手順では、監視をguard supervisorの所有下に置き、停止時に必ず終了・記録する方法を先にレビューする。実プロセスの引数にはpromptが含まれる可能性があるため、記録は識別子と親子関係に限定する。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:94-115; 推論]

Stage 1 の子プロセスは Node.js `17064`（PPID `16916`）の子 `17605` として見え、world 末尾では Node.js が消えた後に子 `19228` が PPID 1 となって残った。これは親終了後に子が孤立する実例であり、world 終了が子孫終了を保証しないことを示唆する。[事実: G3-STAGE1-RESULT-2026-10-14.md:41-51]

現在は起動可能なコマンドがなく、別Terminalでの起動・launcher PID記録も行わない。Stage2 helperの `run` と `invoke` CLI は、必須引数を満たす形式の呼び出しでも内部実行関数より前にexit 78で停止する。不正な引数はargparseが起動前に拒否する。将来の実行可能手順はguardのworld argv束縛とsupervisor異常終了時STOPを実装・再レビューした後にのみ追加する。プロセス引数、環境、秘密値はログや記録に写さない。[推論]

```sh
(
cd "$HOME/ascon-dev" || exit 1
export PATH="$HOME/ascon-run/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24.13.0 || exit 1
unset ERIS_AGENT_FROZEN ANTHROPIC_API_KEY G3_UNIT_TIME_SCALE G3_PROBE_EXPECT_NODE G3_PROBE_EXPECT_TSX
export MIN_FREE_GB=40
export BACKTEST_EXTRA_ARGS='--blocks 360'
RUN_LABEL='g3-stage2-live-haiku-20261014'
# Mandatory fail-closed stop. This example is deliberately non-runnable: do not remove or bypass it.
# No launch command is included. A future executable block must replace this whole section with a
# reviewed launcher that binds the pinned prompt/roster to the actual world command and routes every
# model call through the guard, after all prerequisite receipts and supervisor controls are verified.
printf '%s\n' 'STOP: Stage 2 guardrails and prerequisite receipts are not ready' >&2
exit 2
)
```

上のブロックには起動行を記載していない。これは `stage2_guard` を通さない直接実行を避けるためであり、STOPを外す・別資料からshell行だけをコピーする・別経路で直接 `run-league.sh` を呼ぶことは禁止する。実行可能な手順へ変える場合は、この全ブロックをguard管理下の起動に置換し、rosterとpromptの実使用、各CLI起動の上限、supervisor異常終了時のSTOP、B07/B08b/排他/managed policy等の前提receiptを検証してから独立再レビューする。現在は実装も接続もされておらず、Stage 2は無条件STOPのまま。[事実: run-league.sh:1-48; stage2_guard.py:main (CLI entrypoint dispatch; resolve against current source); G3-GAP-CLASSIFICATION-2026-10-14.md:142, 149; 推論]

> **現行状態: 対象プロセスなし・操作禁止** — 以下は仮想的な将来手順を記録したものです。現時点で Stage2 の実行は許可されていません。これらの `kill` コマンドを実行したり、無関係な既存プロセスへ適用したりしないでください。

### 強制停止の手順

停止条件に触れたら、launcher、run matrix、world supervisor、agent runtime、Claude CLI の生存 PID と PPID を監視ログ・`ps` で突き合わせる。Stage 1 の `nohup caffeinate ... &` は専用 process group の作成を示していないため、group signal は使わない。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:134-143; 推論]

実行中と確認できた PID を子から親の順に明示し、一度だけ `kill -TERM <CLI_PID> <AGENT_PID> <WORLD_PID> <MATRIX_PID> <LAUNCHER_PID>` を送る。2秒間隔の監視で同じ PID が残ることと、その実行由来であることを再確認し、残存 PID のみへ `kill -KILL <PID>` を送る。親の停止後に PPID が1となった子も別に探して終了する。PID が再利用された疑い、所有者が特定できない PID、または正しい PID を特定できない場合は kill を追加せず、mini の管理者へ即時停止を依頼する。[推論; PID/PPID の観測例: G3-STAGE1-RESULT-2026-10-14.md:41-51]

PPID が1になった Claude/Node 子は親 PID の kill では消えない。world 終了後にも監視して該当 PID を識別し、当該 world の実行由来であると確認できた PID に限って `kill -TERM <PID>`、消えない場合は `kill -KILL <PID>` を使う。PID/PPID の生存確認間隔は2秒なので、正確な終了時刻や送信 signal は記録から断定しない。[事実: G3-STAGE1-RESULT-2026-10-14.md:41-56; 推論]

上記 kill コマンドは placeholder を live PID で置き換えて使う。PID の所有関係を確認できない場合、無差別な `pkill claude` や HOME 全体の cleanup はしない。[推論]

## 将来の実走時に調べる artifact

以下は実行可能なguard経路が別途レビューされた場合にだけ確認する候補artifactであり、現在のSTOPブロックでは生成されない。さらに現行prototypeはworldとCLIの環境から `NODE_OPTIONS` と `G3_*`（`G3_PROBE_JSONL` を含む）を除去するため、現行guardのままではprobe loader自体が有効にならず、この一覧のprobe行は実装済み出力の期待値ではない。将来のguardが計測変数を限定的に受け渡すか代替方式を結び付け、その方法を独立レビューするまでprobe証跡は未観測のままとする。[事実: g3/stage2/stage2_guard.py:36, 339-347; g3/loader/probe-loader.mjs:34; 推論]

launcher 完了後、world が一件、run directory と summary があり、launcher log に `completed with 0 failed run(s)` があるか確認する。exit code だけで成功としない。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:148-166]

確認先は次の通り。出力本文や秘密値をチャットへ貼らない。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:148-166; g3/chain/README.md:116-121]

- `~/g3-stage2-live-haiku-20261014.launch.log`、`ascon-notes/eval/out/g3-stage2-live-haiku-20261014/index.tsv`、`calm-923847.log`、`runs/<runId>/summary.json`：実行条件、終了理由、block 数、所要時間。[事実: G3-STAGE1-RUNBOOK-2026-10-14.md:148-160]
- `runs/<runId>/agents/cand.cli-timing.jsonl`：wrapper の `cli_call_started`、UTC 時刻、PID、block、prompt 全文ではない SHA-256。これは CLI 起動前記録であり、exec 成功や応答完了の証拠ではない。[事実: g3/CLI-START-BINDING.md:9-30; 推論]
- 将来 guard がprobe環境の安全な結合を実装・再レビューした場合の候補 `~/g3-stage2-live-haiku-20261014.probe.jsonl`：loader の登録、runner、setSource、start/decide/close、worker 作成・応答など。fixture runner は `finishProbe()` を明示的に呼ぶが、run-league の live botMain 経路がこれを呼ぶ記載は見つからない。したがって `probe_complete` がない可能性を前提にし、記録が存在しても stock `botMain` 全体を観測できた証明にはしない。[事実: g3/loader/README.md:45, 77; g3/loader/run-fixtures.mjs:92-104; 不明: live finishProbe 呼出]
- `runs/<runId>/agents/cand.llm.jsonl`：block、モデル名、応答本文、context/system、返却 token usage（提供があれば）または error。安全な保管場所で必要項目だけを読む。runtime は `usage.inputTokens` / `usage.outputTokens` が存在する場合に記録する。[事実: llm.ts:53-60, 1033-1066]
- `runs/<runId>/agents/cand.jsonl`：各改訂の `installed`、`declined`、`rejected`、`reverted` とその block/version 情報。`installed` 行の有無だけで実行中 source と trade safety は証明しない。[事実: g3/chain/README.md:116-121; G3-STAGE1-RUNBOOK-2026-10-14.md:157-159; 推論]
- `events.jsonl`、`blocks.csv`、summary：改訂前後に起きた処理と世界の状態を、candidate の revision log と時刻・block で結ぶ。[事実: g3/chain/README.md:116-121]

自然改訂が「導入・見送り・拒否」のどれだったかは `cand.jsonl` と `cand.llm.jsonl` を block で結び、導入された場合は返却 `executorTs` を稼働 source と照合する。前後 source の内容差分、version/hash、該当時点のイベント・取引・残高を一緒に調べる。危険性はこの一世界のログで観測できた範囲だけを記載し、安全の証明や凍結対照より優れるという結論にはしない。[事実: llm.ts:1033-1067; g3/chain/README.md:116-121; 推論]

### 要件ごとの観測限界

- **R1b は部分観測候補**：wrapper の start 時刻・PID・block・context hash を確認する。ただし exec 成功、応答全文、全 call の独立した期待件数は記録しない。[事実: g3/CLI-START-BINDING.md:9-40]
- **R1a、R1c、R1d、R1e、R1f は未観測のまま**：manifest/digest、独立した期待件数、標準出力全文と欠落検知、HTTP 呼出し識別、標準ログ上限の影響を閉じる記録器はこの手順の対象でない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:58-63]
- **R2a は部分観測に留まる可能性**：loader に `setSource` 記録があっても、実 `botMain` の active source に結合できたかを確かめる。loader の既知の対象は stock `StrategyRunner` で、`botMain` の観測は未検証。[事実: g3/loader/README.md:1-10; 推論]
- **R2b、R2c は未観測**：botMain 内の局所版と worker 内の最初の判断識別子はこの loader の記録だけでは確定しない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:65-66]
- **R3a は部分観測に留まる可能性**：候補の記録された判断・改訂結果と probe count は照合できるが、noop/v0/省略を含む全判断の母集合は作れない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:60, 67; g3/loader/README.md:35-45]
- **R3b、R3c、R3d は未観測**：worker 内の判断時刻、高水準 read の全順序、return/submit の全試行は記録しない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:68-70]
- **R5a/R5b/R5c は部分観測候補**：最大300秒の呼出、子 PID/PPID の存続、world 末尾の孤立子、遅着応答と改訂採否を照合できる。2秒監視は kill signal と正確な終了時刻を示さない。実モデルの呼出結果は Stage 1 の偽 CLI 結果から推定しない。[事実: G3-STAGE1-RESULT-2026-10-14.md:33-60; 推論]
- **R5g は部分観測候補**：開始記録の block 間隔と重なりを照合する。呼出し開始件数だけでは全周期・同時実行制約の充足にならない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:87; g3/chain/README.md:116-121]
- その他の R4 取引境界・状態復旧・複数 world 再現性・提出モデルとの一致はこの一 world では未観測。[事実: G3-STAGE1-RESULT-2026-10-14.md:53-60; G3-GAP-CLASSIFICATION-2026-10-14.md:69-88]

## 全360 blockが長すぎる場合の小さい案

次は全て同じ `calm`、並列数1、seed再確認、凍結対照、同じ候補・wrapper・loader・300秒 timeout を保ち、`BACKTEST_EXTRA_ARGS` の block 数だけ短くする案である。実施前に新しい label を割り当て、予算・利用枠を改めて確認する。[推論]

1. `--blocks 120`：最大2改訂 call の見込み。[推論: 60 block間隔]
2. `--blocks 180`：最大3改訂 call の見込み。[推論: 60 block間隔]
3. `--blocks 240`：最大4改訂 call の見込み。[推論: 60 block間隔]

短縮しても一つの結果から G3、自然改訂の一般的安全性、凍結対照に対する候補の優位性は結論できない。5分 timeout が world 時間を支配する場合は実時間が比例して短くなるとは限らない。[推論]

## リスクと今回も証明されないこと

- Mac mini の CPU、disk、Anvil を使う。過去の負荷校正は中断例があり、今回の負荷閾値は定義されていない。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:147; G3-STAGE1-RUNBOOK-2026-10-14.md:90-92]
- 同じ subscription quota を別の automation が使う可能性がある。現状の共有先一覧はなく、直前に所有者が確認する必要がある。[事実: G3-GAP-CLASSIFICATION-2026-10-14.md:148; 不明]
- start-binding wrapper は毎 call のファイル追記・fsync後に exec する。loader は同期記録・hash処理を追加し、元プログラムと時刻・例外経路に干渉し得る。deadline 近傍の挙動を変える可能性がある。[事実: g3/claude-start-binding.py:36-75, 88-93; g3/loader/README.md:24-33, 160-167; 推論]
- candidate に渡した `NODE_OPTIONS` は Claude 子プロセスへも引き継がれる可能性がある。そうなると loader が Claude CLI 側の Node.js process にも読み込まれ、probe sink に追加記録を作るか、toolchain check で停止する可能性がある。実モデル経路での確認はなく、追加 load が特定できなければ停止する。[事実: llm.ts:587-600; g3/loader/probe-loader.mjs:10-20, 34-35; 推論; 実動作は不明]
- `cand.llm.jsonl` は改訂 prompt、context、応答全文を保存する。財布、RPC URL/ヘッダー、秘密値を記録しない。権限を絞り、必要部分だけを読む。[事実: llm.ts:779-785, 1033-1066; g3/loader/README.md:30-33]
- 実提出 artifact、主催者の評価経路、HTTP 推論、複数 seed/world、すべての取引安全性、全要件の完全記録、子孫の全終了、loader/wrapper の無干渉は証明しない。G3 は REQUIRED / BLOCKED のままで、進捗として報告しない。[事実: DECISIONS-2026-10-14.md:12-16; G3-GAP-CLASSIFICATION-2026-10-14.md:5, 142, 149; G3-STAGE1-RESULT-2026-10-14.md:53-60]
- `g3/chain/README.md` は歴史的 r2 手順であり、現行 r3-ready launcher ではなく、その文書自体が固定入力では world を起動できないと記す。上記の Stage 2 コマンドの根拠・実行許可として用いない。[事実: g3/chain/README.md:1-17]

## この資料で見つからなかったこと

- Claude CLI statusの限定fieldは上記日時にminiで確認済み。開始直前の状態、quota残量、追加利用OFFのlive照会は未確認。
- mini の同一 Claude アカウントを利用する automation の完全な一覧、quota の現在残量、料金表示の live 監視方法。[不明]
- B05 の予約記録、B08b の直前排他/負荷結果、stage 2 用 B07 隔離領域の実体がこの worktreeに用意済みである証拠。[不明]
- probe loader を `run-league.sh` の real botMain / worker 起動へ付けた実行記録、start-binding と loader の結合検証、実モデル呼出での干渉測定。[不明]
- seed `923847` の予約台帳・完全な過去実行履歴に対する監査結果。[不明]
- Stage 2 を実施した結果、採否・危険な挙動、G3 の進捗、残り時間の数値。[不明]

この runbook は計画・手順であり、Stage 2 は未実施である。ここに書いた確認、停止条件、予測は実行証跡に置き換わらない。[事実: この runbook の作成時点; 推論]

## 次の実装・検証（未完）

1. 実モデルを呼ばないfake CLI対照で、上限を超えたCLI起動を拒否する計数器を検証する。CLI起動数と外部API request数・請求単位は区別する。
2. 実際のClaude呼出環境でANTHROPIC/AWS/Bedrock/Vertexなどの別認証・provider指定を拒否し、絶対CLIパス/bytesとmodelを確認する。NODE_OPTIONSとprobe保存先をClaude子へ渡さない。hooks/MCPが追加起動を発生させない経路を検証する。提出runtimeは変更せず計測用の制御として記録する。
3. launchログと改訂記録からquota/429/異なるmodel/providerの観測時に、専用process groupを停止するsupervisorをfake child treeで検証する。anvil/caffeinateと孤児確認、watch停止も含める。PID未確認の無差別killを使わない。
4. 起動準備と起動を同じ検査済みscriptにまとめる。Node/tsx/anvil、override未設定、roster、seed、容量、排他、B05/B07/B08bの実証を再確認し、未確認なら起動させない。
5. 元の`llm.ts:490-508,587-600`ではmodel引数と一部tools拒否を付けるが、API key削除だけでは他provider/別認証変数やhooks/MCPを遮断しない。`run-matrix.sh:97-99`はprocess sandboxとBACKTEST_EXTRA_ARGSを渡す。これらの読取はwrapper/loaderの実結合や無干渉の証明ではない。
6. 上の制御と文書を独立レビューし、無条件STOPを置き換える差分をレビューする。現時点では置き換えない。

## 2026-10-15 の準備確認（実走の承認証拠ではない）

Codexの読み取り専用inventoryで、miniの `~/ascon-dev` は `56a0c7e17d72937ffff49b8c5db73ee71185b56a`、tracked/untracked差分0、Node24.13.0、tsx4.23.13を確認した。診断用checkoutの現状であり、B07や主催者環境との同等性の証明ではない。

inventory用の汎用PATHはHomebrew Anvil1.8.4を選んでいた。絶対パス `~/ascon-run/bin/anvil --version` は1.2.3を返した。実走のPATHでは必ず `ascon-run/bin` をHomebrewより前に置き、起動前に解決した絶対パスと版を記録する。現在までの追加検証はfakeCLI・offline replayのみで、実Anvilを起動していない。

標準managed-settingsファイル `/Library/Application Support/ClaudeCode/managed-settings.json` は存在しなかった。user設定は存在しhooksがあり、local設定も存在する。値やhookコマンドは出力せず、ファイルhashと存在/field名だけをinventoryに記録した。標準パス1件の不存在は、配布されるmanaged policyや別のmanaged経路の不存在を証明しない。`--restricted` のuser/local設定無視を前提にしても、managed inventoryは未完了である。

gbrainのLaunchAgent類が稼働登録され、共有資源の負荷もある。これは同じモデルアカウントの利用を断定するものではない。B05予約、account-wide排他、開始直前quota、B07の隔離ソース/状態、managed policy確認を未確認のままverifiedにしない。

`g3/stage2/` にguard prototypeとfake対照がある。親レビューと追加不具合修正を続けており、まだ起動コマンドには結合しない。exact receiptの親レビューは内部の実行管理ゲートであり、既に本人が許可した範囲に新しい本人確認を追加するものではない。上記の無条件STOPは維持する。

## Guard checkpointの検証状況

初回helper checkpoint `eba611d`（履歴上のcheckpoint。後続で置換済み、現行ではない）はsource SHA256 `84e67249807ab71fd18104546b3bf82c922182bd1cfce3aee1bfc24294f2e149`、mini/local fake-only46/46、py_compile、diff-checkが成功した時点の記録。改行無し/4KiB超出力の停止marker、終了時drain、signal、leaderless group、壊れたregistryを含む。これは前提証拠、実model、runtime同等性を証明しない。上の起動STOPは外していない。

後続helper checkpoint `9c6a9d4`（履歴上のcheckpoint、後続で置換済み）は、実runtime `llm.ts:554` がtimeoutでshimへSIGKILLする経路を受け、owner PID/world identity/300s deadlineの監視と、dead-owner時の再予約拒否を追加した。mini/local fake49/49、py_compile/diff-check成功、旧eba611dのdead-owner対照RED→修正GREEN。helper SHA256 `bbae15dd6d65dd55d93148c9d1d34986dc5229ee4cb8f307b8aa93bde6ef57be`。これは実runtimeを使う診断の合格証拠ではなく、独立再レビュー・現在の前提receiptが必要。無条件STOPは維持する。


後続helper checkpoint `f3ff120a181abc1b19f63ff9c481e6411751b50d`（履歴上のcheckpoint、後続で置換済み）はr7独立レビューの登録前SIGKILL窓・未回収zombie・world PGID公開競合を修正した。旧9c6a9d4で3対照RED、新sourceで4対照GREEN、local56/56・mini56/56とpy_compileが成功。source SHA256 `d46bfd30c844c5532d30152483a7ef9724bae170cde33f27427b9661db3067e9` はmini一致。登録前にownerが死んだ場合はSTOPと未解決記録を残すが、未知PGIDの孤児CLI掃除は保証しない。prompt.md/rosterのpinとfrontmatter経路の確認証拠も必須になった。helper自身はfrontmatterを解析せず、別provider経路をOSで遮断しない。実運用前提・同等性・G3受理の証拠ではなく、無条件STOPを維持する。

## Historical Stage 2 guard checkpoint (2026-10-15 JST; superseded by r23c and later)

Code checkpoint `5bf9d177d9b4d48d8a9cf11edee94f14822556c3` (`stage2_guard.py` SHA256 `d9d811693e762a6b82d0965519b5dc004a602ef85a7ecfe7048f2d72f113b906`; `test_stage2_guard.py` SHA256 `a8e86961df5aa5480b807b26d5eff94d974bb2c52be9b9d91e9aa419db4d9f99`). On mini at this exact HEAD, the fake-only suite passed 59/59 in 26.24 seconds, `py_compile` and `git diff --check` passed. Log: `~/ascon-control/logs/stage2-r16-mini-full.log`, SHA256 `5b4e6bcd89b16921a9dfe063d45e87480cab1bdf1d5709f04a3536adb287a0fb`.

The hard-disable regression tests were also run against pre-disable helper `3ea6e55267bdd289b66b77eb2b5e65048a0efe4e`: both failed as expected (RED 2/2), demonstrating sensitivity to the old CLI dispatch. They pass valid arguments to `main()`, assert exit 78 and the disabled-action message, and verify the patched downstream `authorize_for_run` / `supervise` / `invoke` functions are not called. This does not claim a separate fake executable was attempted. Log: `~/ascon-control/logs/stage2-r16-cli-disable-red.log`, SHA256 `306c090aef18582bdd8a4be60a12a24c8b6b5c74ee090c8916b5e26a5873554d`.

The world-identity race regression uses a bounded observation window while the supervisor holds the control lock. The fake CLI cannot publish its registration record until that lock is released; the test checks publication ordering before the fake world is allowed to continue. Cleanup is scoped to the exact fake world process handle. On mini, the test passed 1/1 against the current lock and failed 1/1 against a temporary mutation that removed the supervisor's control lock, with the expected `CLI shim ran before world identity publication` diagnostic. Log: `~/ascon-control/logs/stage2-r16-lockless-red.log`, SHA256 `6902d736e134efc902c4e6a18779288abaacba93f54c19ac1db02f2b5cee241e`. The run-log test also asserts STOP reason `quota` and source `run_log`. Four shell examples containing `exit` are subshell-scoped, superseded checkpoints are labeled historical, and the probe artifact is explicitly unavailable because the current guard strips `NODE_OPTIONS` and `G3_*`.

Both documented CLI actions, `run` and direct `invoke`, stop with exit 78 for syntactically valid required arguments before authorization or process launch; malformed arguments are rejected by argparse before execution. Regression tests assert exit 78 and verify the patched downstream functions are not called; they do not assert that a fake marker executable was attempted. Fake process-tree tests call internal functions only. This is an accidental-use guard, not an OS security boundary. Claude's r12 static review found unresolved P1 execution-identity binding and external supervisor-death containment, plus P2 control-file mutation, an unregistered-CLI cleanup window, and self-asserted evidence/provider detection gaps. These remain open; do not restore either CLI path or add a world launch command. This checkpoint has mini fake-suite evidence and a positive control, but awaits a fresh independent review. No real model, provider, world, or Anvil was started; Stage 2 remains unconditionally STOPPED and G3 remains BLOCKED.


## 2026-10-15 mini candidate r19 and independent review

History uses `Claude rNN` for the reviewer sequence and `candidate r23x` for a source checkpoint; these identifiers are independent. Thus “Claude r28 reviewed r23i” means reviewer sequence 28 assessed candidate r23i. Older entries retain their original labels for audit traceability.

Claude r15 reviewed the prior working-tree patch `stage2-r17.patch` (SHA256 `613231d9b248d0a20012fba3a118a7c7df38bab89b1666ce406c737f89ccb030`) statically and found P1=2, P2=6, P3=5. The actionable P2 was a regular-file-to-FIFO/path replacement between enumeration and `open`, which could block the supervisor. The reviewer explicitly did not run tests or inspect live/runtime behavior. Full text and gate record: `operations/2026-10-14/reviews/stage2-claude-r15-final.md` and `stage2-claude-r15-status.json`.

The next mini attempt (`stage2-r18-mini-full.log`, SHA256 `c9ae7d6d8a9cc656697ee5f0c90af9112ac2aee17bf1f578c04e7d33baf0e7e3`) ran 63 tests but had one test-harness error: macOS Python 3.9 does not implement `os.mkfifo(..., dir_fd=...)`. This was a test portability defect, not a guard failure. The test now swaps a file within its private temporary directory using absolute paths. The failed run is retained separately and is not counted as passing evidence.

The r19 working-tree patch (SHA256 `58b7a6ee60e733460f62ee59b9b039c4b308ad43ef3bcdbed67af2af78ea63bf`) replaces recursive path opens with `os.fwalk(..., follow_symlinks=False)` from an opened work-directory descriptor. Each candidate is reopened through directory descriptors using `O_NOFOLLOW`; files use `O_NONBLOCK` and are accepted only when `fstat` still reports the enumerated regular-file device/inode. A replacement or symlink race is skipped for the next poll. It retains whole-tree backlog accounting before reading and rotates the bounded scan cursor. Regression controls cover fairness, aggregate backlog, leaf and directory symlinks, and replacing a regular log with a FIFO immediately before open.

On mini, the r19 synthetic-only suite passed **63/63** in 27.935s, `py_compile` passed, and `git diff --check` passed. Log SHA256 `5a0f8554d6ad66bc5af4c4924c7271ec7f0e216a05536ecf65e41dd3389bb520`; current helper SHA256 `5ada15ca8ac5917b40574c1ed0833ad847032e5a2d5553e2970f1232cabac859`; test SHA256 `69f5d6f5742b7993ff7dc5885b43320fd044857a9a8cc0aedbe5cc9ff64101cb`. The mini validation worktree used parent HEAD `348ff2f5a5b44120c0a89191607b21e4d9e0e513`; patch files are applied but not committed there. Free space after verification was 41,946,032 KiB (40 GiB minimum retained). No live world, model, provider, Anvil, or real CLI action was started.

This does not close the review gate. The latest review still identifies unbound execution identity, lack of an independent supervisor-death owner, the same-UID control-file boundary, the CLI registration window, broad STOP patterns, PID/PGID reuse, and unverified mapping from `ERIS_RUN_DIR` to the real runtime's output tree. We have not proven that the runner writes all relevant logs under `job/work`. These are explicit design/runtime gaps; do not enable `run`/`invoke` or infer G3 readiness. Stage 2 stays unconditionally STOPPED and G3 stays BLOCKED followed by the r20 fail-closed scanner/control-read patch below; all runtime gaps still require separate resolution.


## 2026-10-15 mini candidate r20 and Claude r16 findings

Claude r16 statically reviewed r19 and found P1=2, P2=7, P3=1. It judged the leaf-file re-open path materially improved, but identified standard-library `os.fwalk` enumeration races and silent subtree skips, FIFO blocking in control JSON/lock/ledger reads, unbounded lock/`ps` waits, and unbounded tree shape. Reviewer did not run tests or verify mini logs/hashes/runtime. Full review/status: `operations/2026-10-14/reviews/stage2-claude-r16-final.md` and `stage2-claude-r16-status.json`.

The r20 candidate replaces `os.fwalk` with a bounded stack walk based on `os.scandir(fd)` and `openat`-style descriptor-relative opens. It anchors traversal at the opened work directory, uses `O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK` for directory traversal, checks device/inode after open, fails closed on symlink, unsafe log entry, unscannable subtree, or tree/file/depth limit, and rotates the per-poll scan cursor after global backlog accounting. File reads are regular-file/no-follow/nonblocking with device/inode identity checks. The same safe-open helper now protects JSON and digest reads; control JSON is capped at 4 MiB, the start ledger at 64 KiB, lock acquisition at 5 seconds, and `ps` probes at 2 seconds. Tests cover directory/leaf FIFO races, leaf/directory symlinks, scan permission failure, control JSON/lock/ledger FIFOs, lock contention timeout, bounded fairness/backlog, and `ps` timeout. These are fake-only controls.

There was an intermediate local full-suite failure when the lock wait was 2 seconds: the existing immediate-shim publication race intentionally blocks through a 3-second observation window. The wait was raised to 5 seconds while remaining finite; the targeted race/lock tests and the complete local suite then passed 70/70. This failed local attempt is preserved in `/tmp/ascon-stage2-r20-local.log` on the current host only and is not mini evidence.

On mini, r20 passed **70/70** in 28.642s, `py_compile` and `git diff --check` passed. Receipt: `operations/2026-10-14/stage2-r20-mini-receipt.json`; log SHA256 `a0a8e23433ab3ea44ca13c7c16ac686361e76d1cfcc0a638dbb396977068bb2e`; helper SHA256 `4e3b0adf128a3679138dfc2c8d14b2ea52210faaecb6e0c9b12a329389ea5d3c`; test SHA256 `98c06f40b2f4a7254ccf1d97c5efa6c3cbd24c65ed5ae3b4f9ab9502a101448d`. Parent HEAD remains `348ff2f5a5b44120c0a89191607b21e4d9e0e513`; mini free space after the lane was 41,956,728 KiB, above the 40 GiB floor. No real world/model/provider/Anvil/CLI execution occurred.

At this historical checkpoint, Claude r20 review was pending; later r17 and subsequent reviews are recorded below. The known P1 execution-identity binding and external watchdog gaps remain; same-UID mutation, pre-registration orphan cleanup, STOP marker quality, process-group PID reuse, evidence self-assertion, and actual runtime log-path mapping also remain unproved. Keep Stage 2 unconditionally STOPPED, keep `run`/`invoke` disabled, and retain G3 BLOCKED. No PR, push, CI, or merge is authorized by these test results.


## 2026-10-15 candidate r21: cleanup and marker controls

Claude's static r20 review (r17) found P1=2, P2=8, P3=4. The execution-identity and external-watchdog P1s remain open, so runtime stays unconditionally STOPPED. This candidate addresses selected actionable findings without claiming the gate is clear: supervisor finalization now attempts both separately owned CLI and world group cleanup even if sentinel publication or one cleanup raises; regression controls assert the ordering. The scanner has a nested-directory positive control. STOP matching no longer treats any ordinary `error` token or alphanumeric-embedded 429/529 as a stop, recognizes scoped provider-error/529/standalone-overload markers, and defers a bare numeric code at a chunk boundary until a delimiter or confirmed EOF. Tests cover numeric chunks, ordinary code text, terminal EOF, and nested log scanning.

On the canonical source worktree, the fake-only Stage2 suite passed **73/73** after these changes; `py_compile` and `git diff --check` passed. Local final log SHA256: `e5cd5115fc51999f11a201420e89b20093780af5d454b9aa52d5f3506433b8b3`. Source hashes: helper `fa3a7286c0c61dc19cae5589618cbc5c64f410ca241a7f823aa1e6c7f68329ce`; tests `1a4d88a1269fc78c1931eed3eabd1fcde406118f7174da4bb6bce5fa85ac7387`. This suite is synthetic only and does not establish runtime output-path coverage, provider identity, billing, or G3 acceptance.


## 2026-10-15 candidate r22: lock-failure cleanup and structured STOP patterns

Claude r18 reviewed r21b statically and returned P1=1, P2=3, P3=6 (FAIL). Its single P1 finding groups two blocking gaps: unbound execution identity and absent external supervisor watchdog. r22 narrows 429/529 to HTTP/status/code-labelled values, requires delimiters and operation context for rate/quota phrases, and restricts fallback/provider/billing markers to explicit structured fields or payment/credit failure phrases. It adds negative controls for quotation, decimal prices/times, `rateLimit`, generic request error handling, size-limit messages, and ordinary code wording. When `control_lock` cannot be acquired, cleanup now safely attempts to stop only registered records whose job ID and exact positive PID/PGID agree; it does not mutate registry files and returns an incomplete-cleanup error so the supervisor remains STOPPED. Tests include the supervisor plus a separately-sessioned fake CLI child, lock failure, record retention, 429→4291 splits through CLI/world streams and 64-KiB log reads, and nested terminal-log handling. This remains design-only; validate against mini and request another static review before any publication.

The corrected canonical source worktree passed the fake-only Stage2 suite **79/79** in 16.407s; `py_compile` and `git diff --check` passed. Final local log SHA256 `6fd65c75dc6973e8f6de06b6c4022da4cbe183b217d5e97337b192fcfab41b3d`. The first attempt had two test-fixture failures (one registry fixture lacked the newly required `phase=registered`; one numeric-marker fixture joined the HTTP label directly to an alphanumeric run); both fixtures were corrected before the passing run.

On mini, all four tracked candidate files matched the canonical worktree by SHA256. Because mini free space was below the 40-GiB floor, only the 11 change-focused fake controls were run there, serially: **11/11** in 5.151s; in-memory compile and `git diff --check` passed. Receipt `operations/2026-10-14/stage2-r22-mini-receipt.json`; log SHA256 `b838ea71042ba955eb94bc44fa96d318778083d07eedcd566b006a63aad8c70a`; source hashes for this historical checkpoint are preserved in the external r22 receipt, not embedded here. Mini had 41,869,980 KiB free immediately after the lane. The focused run does not replace full-suite/runtime acceptance.

Claude r18 did not run tests or verify mini artifacts. The r18 P1 count is one finding group covering execution identity and external watchdog; its three P2 findings are described in `stage2-claude-r18-final.md`. Keep both CLI actions hard-disabled and G3 BLOCKED; no world/model/provider/Anvil/real CLI run, PR, push, CI, or merge has occurred.


## 2026-10-15 candidate r23: review-driven fail-closed controls

Claude's read-only static review of r22 completed with **P1=2, P2=5, P3=6 (FAIL)**. Full text and structured gate: `operations/2026-10-14/reviews/stage2-claude-r19-final.md` and `stage2-claude-r19-status.json`. Outside coverage is limited to the supplied diff; the reviewer ran no tests, checked no mini hashes/logs, and observed no runtime output. P1 execution identity and external supervisor-death ownership remain unresolved, so Stage 2 stays STOP and G3 stays BLOCKED.

The initial r23 working tree addressed selected P2/P3 issues: lock-free STOP creation, registry validation, failure-context marker patterns and negative controls. Its independent Claude review found **P1=1, P2=3, P3=6 (FAIL)**. The review identified non-GuardError lock failures, the in-flight CLI registration race, missing `status code 429` and escaped JSON patterns, and a malformed README digest. It did not run tests or verify mini evidence. Full text/status: `operations/2026-10-14/reviews/stage2-claude-r20-final.md` and `stage2-claude-r20-status.json`.

The r23b follow-up writes a complete STOP document to a fsynced same-directory temporary file and atomically publishes it with no-replace hard-link creation. Lock acquisition and lock-held registry-read exceptions route to fail-closed STOP and fallback cleanup. After writing STOP, cleanup attempts one bounded lock reacquisition, allowing an invocation already in Popen/registration to publish its group record before the cleanup snapshot; if this retry remains unavailable, cleanup reports incomplete and the registry snapshot remains best-effort. Tests cover late registration appearing at the retry boundary, post-STOP invoke refusal, synthetic OS lock/read errors, mismatched-job and `starting` record non-kill, atomic sentinel publication/idempotency, escaped and quoted JSON status forms, `status code 429`, `429 Too Many Requests`, and negative plain rate-limit context. The runbook no longer embeds its own digest; the SHA is recorded in the external receipt. Actual model/provider output mapping remains an unimplemented external preflight obligation.

The final canonical fake-only suite passed **86/86** in 16.108s; local log: `operations/2026-10-14/stage2-r23b-full-local.log`, SHA256 `41cca059a5e3273605431aad2bf8a95ece3594a3705c20b8f7308a2cd6dd2e0d`. An earlier full run had one assertion expecting the lower-priority `provider_error` label despite a matched HTTP status; the test expectation was corrected to `429`, then the complete suite passed. `py_compile` and `git diff --check` passed. The mini targeted suite passed **13/13** in 2.463s; mini log SHA256 `ff24243148dfb1d22cff66c33a75e169c9366599666023a084881a592f3f6d8d`. Receipt `stage2-r23b-mini-receipt.json` records the synchronized source hashes. Mini is below the 40-GiB floor, so the full suite was not run there. At that historical checkpoint, review was pending; it later completed as r21 FAIL and the numeric idle flush and invoke signal-handler restoration were addressed in r23c; atomic STOP publication and the README digest were fixed. Same-UID authority, process identity/TOCTOU and scanner/runtime-fit limitations remain explicit. No real runtime action was started.
These tests do not close the r20 review gate. Re-review the complete r23b diff before considering any publication. The P1 execution-identity and independent-watchdog gaps remain; no real world/model/provider/Anvil/CLI execution occurred, and Stage 2/G3 remain STOP/BLOCKED.


## 2026-10-15 candidate r23c: idle STOP flush and process identity guard

Claude's static review of r23b completed with **P1=1, P2=2, P3=6 (FAIL)**. It elevated an idle terminal 429/529 marker to P2 and identified retained-record PID reuse. It also noted remaining signal-handler restoration, raw flock error, nested escaped JSON, and source/runbook consistency gaps. Full text/status: `operations/2026-10-14/reviews/stage2-claude-r21-final.md` and `stage2-claude-r21-status.json`. The reviewer ran no tests, checked no receipt/log/hash, and observed no runtime.

The r23c working tree adds a one-second idle flush for trailing numeric status markers in CLI stdout, world stdout, and watched files while preserving 429-to-4291 continuation handling; it wraps non-contention flock errors as `GuardError` and restores invoke signal handlers on launch-lock/log failure paths. Each registered CLI group now records the OS `ps` start token. Cleanup compares the recorded token before TERM and KILL and refuses a mismatched reused leader PID; this narrows the risk but does not eliminate the residual check-to-signal race or same-UID record forgery. Regression tests cover idle STOP on all three output paths, signal-handler restoration, and a simulated reused PID that must remain alive. The canonical fake-only suite passed **92/92** in 20.679s; log `operations/2026-10-14/stage2-r23c-full-local.log`, SHA256 `a052bf9807b4f11a1f5439377bc2d5c593453deb815824087ff0802017b3ef64`. Mini ran 19 focused cases in 6.047s, all PASS; log `operations/2026-10-14/stage2-r23c-mini-focused.log`, SHA256 `1761466ba8508b246798415b9cd561a6f1ebb4de3774e1c2f0165f792616af55`. `py_compile` and `git diff --check` passed locally and on mini; the source hashes matched. Mini free space after the run was 41,877,264 KiB, below the 40-GiB floor, so the full mini suite was skipped. The mini receipt records the runbook hash at synchronization time. Claude r22 static re-review requested changes: no new P1, but it reiterated that internal Python APIs are test-callable and not a security boundary, and that CLI memory loading and actual runtime log-path mapping remain unverified. Stage 2 remains disabled; G3 remains BLOCKED.


## 2026-10-15 candidate r23d: owner PID reuse and idle-marker timing

- Claude r22 static review returned REQUEST_CHANGES (no new P1; P2 concerns include import-callable internal APIs, unverified CLI memory injection and runtime log-path mapping; P3 include owner PID reuse, numeric idle timer carry-over, signal restoration, and checkpoint wording). The canonical README already states that internal APIs are test-callable and not an OS boundary; the runbook history now labels the prior checkpoint as historical and explains the bounded lock-held observation window. CLI memory-file behavior is explicitly unverified.
- r23d records the shim owner process start token and compares it during stale-owner scans; a reused owner PID fails closed and triggers owned CLI cleanup. Deferred numeric markers now bind their idle timer to a marker signature, so a new 529 cannot inherit an earlier 429 wait. Regression adds a live fake CLI with a deliberately stale owner token and marker-identity assertion.
- Canonical fake-only suite **93/93** passed (19.474s), py_compile and diff-check PASS. Log `operations/2026-10-14/stage2-r23d-full-local.log`, SHA256 `24890cb011db071cf8c66b5eba2235de30a08ce828917e1ac2f039dac668c157`. Mini targeted four tests **4/4** passed (0.533s); log `operations/2026-10-14/stage2-r23d-mini-focused.log`, SHA256 `976672c7dbe5f4df713c92f75638911ac245e24086fdda9d724845b937ddd0c6`. Mini free space after run was 41,876,512 KiB, below the 40-GiB full-suite floor.
- Current limitations remain: execution identity is unbound; no independent watchdog owns cleanup if supervisor dies; Python internal APIs remain callable; same-UID control mutation and check-to-signal races remain; CLI memory behavior and final runtime log layout are unverified. Keep Stage 2 STOPPED, CLI entrypoints hard-disabled, G3 BLOCKED. Independent r23d review required; no push, PR, CI, merge, or runtime execution.


## 2026-10-15 candidate r23e: signal and marker follow-up

- Claude r23 re-review of r23d returned REQUEST_CHANGES. It confirmed that the CLI entrypoint is disabled while import-callable internal APIs are not a security boundary. Existing P1 execution-identity binding and independent watchdog gaps remain. P2 runtime output path and CLI memory/settings injection remain unverified; environment scope is not fully isolated. P3 noted supervisor signal-handler restoration, numeric timer symmetry in `invoke`, error normalization, STOP false positives, and receipt/history traceability. Full text/status: `operations/2026-10-14/reviews/stage2-claude-r23-final.md` / `stage2-claude-r23-status.json`; static-only, with no independent test/hash/mini/runtime verification.
- r23e wraps launch-lock acquisition so supervisor signal handlers restore if lock setup fails; it normalizes any world Popen exception into STOP/GuardError. The CLI numeric idle timer now binds to the pending marker signature like world/file scanning. Tests cover launch-lock handler restoration and retained marker-owner checks.
- Local fake suite **95/95** passed (18.698s), py_compile/diff-check PASS. Log `operations/2026-10-14/stage2-r23e-full-local.log`, SHA256 `748f31bf6ddb1b116af77d9ec86be8af133f4884e12a6f4cc557905bd3813fcb`. See external receipt `operations/2026-10-14/stage2-r23e-mini-receipt.json` for final four-source hashes and mini test evidence; it intentionally carries the runbook digest to avoid a self-hash. The first mini focused attempt was correctly rejected because this invocation set `PYTHONDONTWRITEBYTECODE`, which the fixture treats as unsafe inherited state (log `operations/2026-10-14/stage2-r23e-mini-focused.log`, SHA256 `e97ced59cbbbe32e69824577feb970b73020a3fd1ee3a0814003ef2a1341c098`). The same six tests passed on retry after explicitly unsetting it. A seventh case was then added for non-OSError world launch failure; final mini coverage is **7/7** (2.211s), log `operations/2026-10-14/stage2-r23e-mini-final.log`, SHA256 `576221bb390f990506ff012fdc9a277e449f5ddee2d4796386a14159480d31fe`. Mini full suite remains skipped below the 40-GiB floor.
- Remaining P1/P2 limitations are not waived. Stage 2 STOP, CLI entrypoints disabled, G3 BLOCKED. No world/model/provider/Anvil/real CLI, push, PR, CI, or merge.


## 2026-10-15 candidate r23f: bounded stdout drain and launch normalization

- Claude r24 static review of r23e returned REQUEST_CHANGES. The r23e changes to lock-failure signal restoration, world Popen normalization, numeric marker signature timing, tests, and runbook source anchor were judged sound. P1 execution identity and independent supervisor watchdog remain; P2 runtime log mapping, CLI memory/environment isolation, and callable internal API boundary remain unresolved. P3 additionally identified CLI Popen non-OSError leaving a `starting` record and a setsid descendant holding world stdout open indefinitely. Review text/status: `operations/2026-10-14/reviews/stage2-claude-r24-final.md` / `stage2-claude-r24-status.json`; static-only, no independently run tests/hash/mini/runtime.
- r23f catches all ordinary exceptions from CLI Popen, publishes STOP, removes the pending registration, and returns GuardError. Supervisor now bounds post-leader stdout drain to five seconds; if an escaped setsid descendant still holds the pipe, it records `world_stdout_eof_timeout` and stops waiting. That escaped process itself is not reaped by the owned group and remains a documented unresolved ownership gap.
- Local fake suite **97/97** passed (25.729s), py_compile/diff-check PASS. Log `operations/2026-10-14/stage2-r23f-full-local.log`, SHA256 `962f8a266b0ed39b4e73571460745fd97feb7168efc7c1bc696be091a50c7d58`. Mini focused **8/8** passed (6.291s), source hashes match; log `operations/2026-10-14/stage2-r23f-mini-focused.log`, SHA256 `71eda07751cf976592d8502d397441080534d6981bc3202fa70aef320baa1949`. Receipt `stage2-r23f-mini-receipt.json` carries all source hashes. Free mini space 41,881,568 KiB, below 40-GiB full-suite floor.
- Remain STOP/BLOCKED: execution identity/world args/routes are not receipt-bound; no independent watchdog; no verified runtime log-path mapping; no measured CLI memory isolation; internal Python APIs remain directly callable; escaped-session descendants are not owned. No world/model/provider/Anvil/real CLI, push, PR, CI, or merge.


## 2026-10-15 candidate r23g: bound CLI stdout drain

- Claude r25 static review of r23f accepted the non-OSError CLI launch cleanup and world stdout timeout, but identified asymmetric unbounded EOF waiting in `invoke`. It also reiterated P1 execution-identity binding and missing independent watchdog; P2 runtime log-path/zero-coverage success, model-route/frontmatter, callable internal API, memory/config isolation; and P3 false-positive markers, runtime cost/resource caps, external evidence, and setup-Python isolation. Review text/status `operations/2026-10-14/reviews/stage2-claude-r25-final.md` / `stage2-claude-r25-status.json`; static only.
- r23g gives `invoke` the same five-second post-leader stdout drain timeout as the world supervisor. It publishes `cli_stdout_eof_timeout`, returns 78, closes the owned pipe, and unregisters the process record. A separate-session descendant still survives group cleanup; timeout bounds waiting, not containment.
- Canonical fake suite **98/98** passed (30.556s), py_compile/diff-check PASS. Log `operations/2026-10-14/stage2-r23g-full-local.log`, SHA256 `762aaa413ef295a8e10590009fe367d32c2a0364942715dd31d0b0463bba3f8f`. Mini focused verification pending; consult `stage2-r23g-mini-receipt.json` for final synchronized source hashes. Mini full-suite floor remains 40 GiB.
- Stage2 STOP and G3 BLOCKED. The status must not be upgraded on the fake-only evidence. Runtime log coverage, route binding, memory/environment isolation, execution identity, and watchdog remain unresolved. No real CLI/world/model/provider/Anvil, push, PR, CI, or merge.


## 2026-10-15 candidate r23h: require observed diagnostic coverage

- Claude r26 re-review accepted r23g's CLI EOF bound. It identified that a run could still return success with zero watched logs and no shim call; this could happen if the runtime overrides `ERIS_RUN_DIR` or argv does not match the pinned shim. Existing P1 identity/watchdog and P2 route, CLI memory/environment, internal API and runtime log mapping remain. Review: `operations/2026-10-14/reviews/stage2-claude-r26-final.md`, static-only.
- r23h now requires both at least one syntactically valid `starts.jsonl` entry and at least one watched run-log file before the supervisor may report normal completion. Missing logs produce `run_log_coverage_missing`; zero guarded CLI starts produce `cli_start_missing`. The checks are fake-only regression gates and do not prove the real runtime uses `job/work`.
- Local fake suite **98/98** passed (29.955s), py_compile/diff-check PASS. Log `operations/2026-10-14/stage2-r23h-full-local.log`, SHA256 `dd13631630a8064f5fd28d0b4f00ca8e223aa19eed1a2d5f01fbae5839d1859a`. Mini focused **13/13** passed (17.852s), log `operations/2026-10-14/stage2-r23h-mini-focused.log`, SHA256 `949d5f22b2dda1beb3cd1e5ee706cd3760f6d608e93c618fbddb3afdec8f999a`; see `stage2-r23h-mini-receipt.json` for synchronized source hashes. Mini free space was 41,858,924 KiB, below 40 GiB, so no full mini suite.
- Stage2 STOP / G3 BLOCKED remain unchanged. No real CLI/world/provider/model/Anvil, push, PR, CI, or merge.


## 2026-10-15 candidate r23i: require candidate output and CLI completion

- Claude r27 reviewed r23h: the existence/count gates only required any watched file and a pre-Popen reservation. An empty unrelated file plus one failed/unlaunched start could pass. Existing P1 identity/watchdog and P2 model route/internal API/runtime log mapping/CLI memory remain. r23h gate is a lower bound only, not proof of effective runtime monitoring. Full review `operations/2026-10-14/reviews/stage2-claude-r27-final.md`, static-only.
- r23i now requires a nonempty `cand.llm.jsonl` in the watched tree, at least one start reservation, and a no-replace result record showing a guarded CLI exit status 0 before returning normal completion. A missing candidate file, missing start, or missing successful result publishes a distinct STOP. The candidate file can still be spoofed or unrelated; actual runtime path and provenance remain unverified. The result record is not immutable against its same-UID owner.
- Canonical fake-only suite **98/98** passed (30.151s), py_compile/diff-check PASS; log `operations/2026-10-14/stage2-r23i-full-local.log`, SHA256 `23865fdb167ad05f4ba3caa4f0aff284e828796e38d1b57ec8afd6251694ec6f`. Mini focused **13/13** passed (17.859s); log `operations/2026-10-14/stage2-r23i-mini-focused.log`, SHA256 `bf9eab59efa6d1bead4be59ada56532392ec2bddc17a3bfda54c900b46969a04`. Mini free 41,854,408 KiB, below 40-GiB full-suite floor. Receipt `stage2-r23i-mini-receipt.json` records source hashes; mini remains synthetic only.
- Stage2 STOP / G3 BLOCKED. Never treat these synthetic coverage records as runtime acceptance. No real CLI/world/model/provider/Anvil, push, PR, CI, or merge.


## 2026-10-15 candidate r23j: bind completion records to logs and require quiescence

- Claude r28 reviewed r23i statically and returned REQUEST_CHANGES. The completion gate could pass while later reserved CLI starts remained incomplete or active. A same-UID world could forge the candidate file, start ledger, and CLI result JSON; the evidence has no independent provenance. Additional unresolved points: execution identity and watchdog (P1), STOP races/nonzero world exits, ledger locking/torn reads, real candidate output provenance, model-route/frontmatter binding, runtime log mapping, CLI memory/environment isolation, escaped children and resource bounds. The internal API is callable and is not a security boundary. Review `operations/2026-10-14/reviews/stage2-claude-r28-response.json`; static-only, no tests/hash/mini/runtime independently verified.
- r23j makes the CLI result record bind the exit-0 result to the SHA-256 of its diagnostic log and its logged argv digest, publishes the record with no-replace semantics, and flushes/fsyncs the log before recording success. A torn start ledger fails closed. Normal supervisor completion now requires every reserved CLI start to have a valid matching success record and an empty active-CLI registry; nonzero world exit also stops. These checks reduce incomplete completion states but do not establish provenance against the same UID or prove runtime paths.
- Canonical fake-only suite **99/99** passed (30.204s), py_compile and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23j-full-local.log`, SHA256 `5a522c3405e5bc7299b6c07b2642581d1ef32e8c591d6f196a1235b7dbbad48a`. The first two r23j runs exposed stale assertions/fixtures and are superseded by this complete passing run.
- On mini, all four source hashes matched the canonical worktree. Focused fake suite **14/14** passed (8.186s), py_compile and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23j-mini-focused.log`, SHA256 `9ef74311d517bf23f5aeab83da86bcf243e06afb94cb14dce74383e205b53fd7`. Receipt `stage2-r23j-mini-receipt.json`. Mini free space was 41,862,196 KiB, below the 40-GiB floor; no full mini suite. No ASCON process remained after the lane.
- Stage2 remains STOP; G3 remains BLOCKED. Same-UID spoofing, execution identity, independent watchdog, runtime output mapping, model routing, memory/environment isolation, and child containment remain unverified. No world/model/provider/Anvil/real CLI, commit, push, PR, CI, or merge. Fresh independent Claude review of r23j is pending.


## 2026-10-15 candidate r23k: close reviewed gate branches with explicit tests

- Claude r23j independent static review returned REQUEST_CHANGES. P1: the runbook remains bypassable because world argv, source, prompt/roster and actual model route are not bound to one execution identity, and no independent watchdog owns the world after supervisor death. Same-UID world can fabricate candidate/start/result records; this is documented, not closed. P2: candidate validity/provenance and runtime output mapping; missing supervisor-level regression tests for nonzero world exit, incomplete/active later CLI starts, log hash and argv digest mismatch; OSError escaping the coverage gate; CLI receives a broad environment and user HOME/memory remains unverified. P3: torn ledger append, STOP race after the gate, result record called immutable despite same-UID mutability, digest omitted pinned path/forced args, unbounded logs/processes. Review `operations/2026-10-14/reviews/stage2-claude-r23j-response.json`; static only, no tests/hash/mini/runtime independently verified.
- r23k normalizes diagnostic-log read errors to `GuardError`, rejects a torn valid start-ledger line before appending, rechecks STOP after the completion gate and before returning, and includes the pinned CLI path plus forced arguments in the recorded argv digest. New regressions cover torn ledger refusal, log hash mismatch, argv digest mismatch, missing CLI log, world nonzero exit, and a STOP published between gate and normal return. Same-UID forge, runtime candidate validity/path, execution identity/watchdog, environment/memory isolation, and output/process resource ceilings remain unresolved.
- Canonical fake-only suite **102/102** passed (31.091s), py_compile and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23k-full-local.log`, SHA256 `acb17add006190f3297ed7dba5a2b6821317bc4db9f8c359067f08be9d870727`.
- Mini focused fake suite **17/17** passed (9.376s), four synchronized source hashes matched, py_compile and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23k-mini-focused.log`, SHA256 `a4a33094dd7a2cbf5389fe7d3c37c8e44e4cfc26c311cae60bdfec5f4e87868f`. Mini free was 41,858,404 KiB, below 40 GiB, so no full mini suite. No ASCON test process remained after the lane. Final runbook hash sync/receipt update follows this entry.
- Stage2 remains STOP and G3 BLOCKED. Fake tests do not prove runtime integration, live readiness, or security boundary. No real CLI/world/model/provider/Anvil, commit, push, PR, CI, or merge. Claude r23k re-review pending.


## 2026-10-15 candidate r23l: bind CLI digests to reservations and verify post-cleanup STOP

- Claude r23k re-review returned REQUEST_CHANGES. It confirmed the prior ledger, hash, world-nonzero and gate-race fixes, but found the argv digest was self-consistent only between log/result and not compared with a pre-launch reservation; several new error/gate paths were helper-only; `_count_cli_starts` and registry scan OSError handling could still escape; the terminal STOP was not rechecked after cleanup. It reiterated P1 execution identity/watchdog and same-UID bypass, candidate JSON/provenance/runtime-path and memory/env uncertainty, plus unbounded logs/processes. Static only, with no tests/hash/mini/runtime independently verified. Full response `operations/2026-10-14/reviews/stage2-claude-r23k-response.json`.
- r23l records the digest of the fully reconstructed pinned CLI command (executable path, validated runtime args, and forced args) in the locked start reservation before Popen. Completion verifies result and diagnostic-log digest against that reserved value while holding the control lock. The digest is consistency evidence only; the same UID can rewrite the ledger/log/result, and it is not an independent attestation.
- The completion gate normalizes OSError from start-ledger/registry reads and the supervisor maps gate errors to `cli_completion_unverified`. After owned-group cleanup, normal return requires a verified terminal record with `reason=world_exit` and `source=supervisor`. Added supervisor-level tests for OSError mapping, completion issue STOP, and a late external STOP after cleanup. README now states explicitly that stdout/log and child-process resource limits are not enforced.
- Canonical fake-only suite **105/105** passed (31.421s), py_compile and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23l-full-local.log`, SHA256 `514cccb68638409d5ab245720dac5187754c9d9f46fc2a1c2cfe1379ed0d3905`.
- Mini focused fake suite **20/20** passed (10.649s), all four source hashes matched, py_compile and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23l-mini-focused.log`, SHA256 `5f7e4b9504f1e491f99cd2de02903df1234559acb9d008c7cbdea80d6db01747`. Mini free 41,856,880 KiB, below 40 GiB, so no full mini suite. No ASCON test process remained after the lane.
- Stage2 remains STOP and G3 BLOCKED. World argv/source/model routing, external watchdog, same-UID provenance, candidate JSON/output-path validity, CLI environment/HOME memory isolation, and resource limits remain unresolved. No real CLI/world/model/provider/Anvil, commit, push, PR, CI, or merge. Fresh Claude re-review pending.


## 2026-10-15 candidate r23m: make completion STOP atomic and terminal success post-cleanup

- Claude r23l static review returned REQUEST_CHANGES. It confirmed the r23k fixes but identified: `[P2]` `world_exit` STOP was emitted from `finally` after both normal and exceptional exits; the gate released its lock before the terminal STOP, allowing a late shim reservation; STOP error mapping retried through the same failed lock. `[P2]` candidate logs still pass on filename/nonempty size without JSON, provenance, or verified runtime path; CLI HOME/memory and unbounded world/resource usage remain. P1 same-UID forgery, arbitrary world/source/model route, and missing external watchdog remain. Full response `operations/2026-10-14/reviews/stage2-claude-r23l-response.json`, static-only.
- r23m has the completion gate publish `stop.json` with `completion_gate_passed` while still holding `control_lock`; the marker prevents a later shim reservation before the gate unlocks. After owned-group cleanup succeeds, the supervisor publishes a separate `terminal.json` with `world_exit`. Unexpected exceptions before gate completion publish `supervisor_error` if no earlier STOP exists; an exception after gate completion leaves only the gate sentinel and never writes terminal success. Gate error STOP uses lock-free atomic fallback if acquiring `control_lock` fails. This narrows race/record confusion but remains same-UID forgeable.
- Historical r23m record. Candidate r23n subsequently moved successful completion to the distinct `completion-fence.json`; see its section below.
- r23m canonical fake-only suite **108/108** passed locally (31.335s); `operations/2026-10-14/stage2-r23m-full-local.log`, SHA256 `2be0746bf6e47436dbff83fd6f8bb3e15a23a483e4b7820d8108df0a8742cdf2`. Local `py_compile` and `git diff --check` passed.
- Mini ran the **23 focused fake regressions** covering atomic gate STOP, late reservation refusal, exception-vs-normal terminal distinction, and lock-free STOP fallback, **23/23** passed (10.778s). `operations/2026-10-14/stage2-r23m-mini-focused.log`, SHA256 `c14f9df9539b4c1d619de3133e5ffdce66ae9ef8e959be5b90acbc43d384edf7`; mini `py_compile` and `git diff --check` passed and all four synchronized source hashes matched. Available space after run was 41,848,332 KiB, below 40 GiB, so the full mini suite was skipped; no ASCON runtime/test process remained.
- A prior focused invocation used an incorrect import path and another contained misspelled test selectors; both failed at test discovery/selection and were not counted. The corrected 23-case run above is the accepted mini result. Receipt `operations/2026-10-14/stage2-r23m-mini-receipt.json` records exact source hashes and evidence.
- Candidate-log JSON/provenance/path, world identity, independent watchdog, CLI environment/HOME memory, escaped children, and resource ceilings remain unresolved. Stage2 STOP/G3 BLOCKED. No live CLI/world/model/provider/Anvil, commit, push, PR, CI, or merge. Fresh Claude static re-review pending.

## 2026-10-15 candidate r23n: separate completion fence from abnormal STOP

- Claude r23m static re-review returned **REQUEST_CHANGES (P1=3, P2=5, P3=6)**. It confirmed r23m closes exception-vs-success marking, lock-held atomic gate publication, shim reservation blocking, and lock-free STOP fallback. Remaining P1s: same-UID evidence forgery, unbound world/source/prompt/roster/model identity and shim bypass, and no independent watchdog. P2s: candidate JSON/provenance/runtime output path; CLI cwd/HOME/memory isolation; log/stdout/world/resource bounds; escaped descendants; runtime CLI argv/path/owner identity wiring. P3s included conflated success fence and failure STOP semantics plus tests not exercising a true lock contender and post-gate exception. Full response: `operations/2026-10-14/reviews/stage2-claude-r23m-final.md`; static only.
- r23n moves successful gate publication to a dedicated `completion-fence.json`; `stop.json` now records abnormal/unsafe conditions only. A separate locking regression starts a competing reservation while the gate owns the lock, verifies it remains blocked during publication, then confirms it resumes and rejects without appending. A STOP published during post-gate cleanup now prevents `terminal.json`; cleanup exceptions after gate publication persist `supervisor_cleanup_failure`.
- r23n local canonical fake-only suite **110/110** passed in 32.044s; a cleanup-failure-after-gate regression verifies a failure STOP is recorded without terminal success. `operations/2026-10-14/stage2-r23n-full-local.log`, SHA256 `18962478d764e873d3d25d0ce7b35c486714d8923fda04e418c18b9f07b8b881`; local `py_compile` and `git diff --check` pass.
- Mini focused fake suite **25/25** passed in 12.031s; `operations/2026-10-14/stage2-r23n-mini-focused.log`, SHA256 `9a07b4a2c6ff38cfad48931428f32f62376be03b6b8b96ed20a27ca6bd9be528`. Mini `py_compile`/`git diff --check` pass; synchronized source hashes match the external receipt `operations/2026-10-14/stage2-r23n-mini-receipt.json` (which stores the runbook hash without introducing a self-hash).
- Mini available space after tests was 41,863,576 KiB, below the 40-GiB full-suite floor; full mini suite was skipped. Fresh independent r23n re-review pending. No real CLI/world/model/provider/Anvil execution or shipping action.
- The dedicated fence and its hashes are consistency controls only. Same-UID forgery, runtime/output path and CLI-environment preconditions, watchdog and resource bounds remain. Stage2 STOP and G3 BLOCKED; no real CLI/world/model/provider/Anvil or shipping action.

## 2026-10-15 candidate r23o: reject finalized-job reuse and serialize terminal publication

- Claude r23n static review returned **REQUEST_CHANGES (P1=3, P2=5, P3=6)**. It found finalized-job reuse in `supervise`, missing fence checks at gate and invoke boundaries, terminal publication racing lock-free STOP, and a timing-dependent threaded test. Full text `operations/2026-10-14/reviews/stage2-claude-r23n-final.md`; static only. It could not reassess three earlier P3 items because their details were not present in that prompt; they are included in the next review input.
- r23o rejects stopped/fenced/terminal jobs before `supervise` creates a shim or world log and rechecks immediately before CLI Popen; `reserve_start` and CLI success recording honor the fence/terminal. The completion gate refuses an existing failure STOP and validates an existing fence. Terminal publication is under `control_lock`; failure STOP publication checks for terminal before and after atomic link, and terminal publication rolls back if it observes a STOP race. The threaded contender test now signals at the lock boundary rather than using a sleep.
- Local canonical fake-only suite **112/112** passed in 32.105s; `operations/2026-10-14/stage2-r23o-full-local.log`, SHA256 `573529ddb18b1e82784150cb03d15affd6febada70b484598bdb449742901a32`. Local `py_compile`/`git diff --check` pass.
- Mini focused fake suite **27/27** passed in 12.181s; `operations/2026-10-14/stage2-r23o-mini-focused.log`, SHA256 `34543c84e9113584d70c47e36f4bfe73ec77a18ec0d578c50f545d2c960e4959`. Mini `py_compile`/`git diff --check` pass; synchronized hashes match `operations/2026-10-14/stage2-r23o-mini-receipt.json`. Mini free after the run was 41,860,940 KiB, below 40 GiB, so the full mini suite was skipped.
- Claude r23o and Grok independent reviews pending. Grok CLI help works, but `grok models` reports unauthenticated; no login or billable call was attempted under the no-extra-billing constraint. Stage2 STOP/G3 BLOCKED.
- Stage2 remains STOP/G3 BLOCKED. P1 identity/provenance/watchdog and P2 runtime-output, environment, resource and actual-wiring gates remain. No runtime or shipping.

## 2026-10-15 candidate r23p: close r23o scanner and race regressions

- r23p addresses the low-severity r23o review findings: vanished log entries are skipped for that scan and cache entries for paths no longer present are pruned; unrelated-suffix symlinks are ignored while scan-relevant symlinks remain fail-closed; a duplicate supervisor shim collision no longer publishes STOP against an existing job; final prelaunch rechecks reject completion fence and terminal records; and lock-free STOP/terminal publication interleavings retain STOP without leaving a success terminal. The lock-contender test now waits for the expected blocked interval.
- Added deterministic regressions for both STOP/terminal interleavings, duplicate supervisor collision, irrelevant symlink, and an entry removed before stat.
- Local canonical fake-only suite **117/117** passed (32.926s), `py_compile` and `git diff --check` PASS. Log: `operations/2026-10-14/stage2-r23p-full-local.log`, SHA256 `5cc0c42fab57fb94cff8f29ac18b5f69bd32d6b21bc76e3152ffdab8304c520d`.
- Mini focused fake suite **32/32** passed (12.339s), `py_compile` and `git diff --check` PASS. Log: `operations/2026-10-14/stage2-r23p-mini-focused.log`, SHA256 `554da9300a1361232590f06a49af5d36cdedc0bb9dd31878121187f88023c862`. Mini free after run was 41,847,608 KiB, below the 40-GiB full-suite threshold, so full mini suite was skipped. Receipt: `operations/2026-10-14/stage2-r23p-mini-receipt.json`.
- These are fake-only regressions; same-UID evidence forgery and execution identity, independent watchdog, runtime output mapping, CLI memory/environment isolation, resource limits, and escaped process ownership remain unresolved. Grok remains unavailable without authentication; no login or model call was attempted. Stage2 STOP / G3 BLOCKED. No real runtime or shipping.

## Claude review of r23p: REQUEST_CHANGES

- Independent tool-less static review found five candidate P2 and five P3 issues, in addition to two intentionally unresolved global P1 blockers. Full categorized summary: `operations/2026-10-14/reviews/stage2-claude-r23p-final.md`.
- Candidate P2s: a preexisting completion fence could bypass CLI-success checks; read-phase file disappearance/replacement was treated asymmetrically; extensionless directory symlinks could hide watched output; STOP/terminal crash precedence was unspecified; and several security checks/cache behaviors had no mutation-killing regression tests.
- Candidate P3s: terminal publication failure could leave ambiguous evidence; macOS directory fsync must not be described as power-loss durability; a prelaunch refusal consumes its reserved start and records STOP; non-EEXIST shim-open errors could disturb an existing supervisor; and the append-only evidence log obscured historical vs current claims.
- Global blockers remain: unbound execution identity/world and route, no independent watchdog, same-UID evidence forgery, unverified runtime output/provenance, CLI memory/environment isolation, and resource/escaped-child limits. Reviewer ran no tests or runtime. Stage2 STOP/G3 BLOCKED.

## 2026-10-15 candidate r23q: close r23p gate, scanner, precedence and test gaps

- The completion gate now rejects every preexisting fence instead of interpreting it as success. Added separate tests for preexisting fence without CLI evidence, terminal rejection in the finalized-job guard/reservation, success recording against a fence/terminal, and a fence arriving after CLI reservation but before Popen.
- Scanner read-phase disappearance and regular-file inode replacement now discard per-path offsets/tails/deferred markers and retry on the next poll; special-file/symlink replacement remains fail-closed. Directory symlinks are rejected even without a recognized suffix, while unrelated regular-file symlinks remain ignored. Added independent regressions for cache pruning and these path races.
- STOP precedence is explicit: when a STOP already exists it repairs/removes a leftover terminal marker; a newly published STOP also removes terminal and syncs the directory. A terminal-publication OSError rolls back the linked terminal and publishes `terminal_publication_failure` when possible. If a crash leaves both STOP and terminal, consumers must treat STOP as authoritative. README documents that ordinary directory fsync is not hardware power-loss durability.
- A non-EEXIST shim open error does not publish STOP when the shim path already exists, avoiding disturbance of a potentially active supervisor. Added a regression.
- Local canonical fake-only suite **130/130** passed (33.218s), `py_compile` and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23q-full-local.log`, SHA256 `f0e855a4c8748c37ef133b22cb6ee501f5324bdc9d0c33695fb68f35f190dad5`.
- Mini focused fake suite **45/45** passed (12.572s), `py_compile` and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23q-mini-focused.log`, SHA256 `d1557a9e3ba763cdf6bf9caf1c5b0c2faeb116bd99c7d9097eca15fcebe3e638`. Mini free after run was 41,841,728 KiB, below 40 GiB; full mini suite skipped. The first post-sync hash command used an incorrect relative runbook path after the tests passed; hashes were rerun with the correct path and are listed in the receipt.
- r23q fresh independent review pending. P1/G3 and other actual-runtime blockers remain. No real CLI/world/model/provider/Anvil, commit, push, PR, CI, or merge.

## Claude review of r23q: REQUEST_CHANGES

- r23q static re-review retained two intentional global P1 blockers and found three candidate P2 items plus P3 test/maintenance issues. Full categorized summary: `operations/2026-10-14/reviews/stage2-claude-r23q-final.md`.
- Candidate findings: final scan could skip a transiently replaced file and complete without another poll; README promised STOP precedence while `_write_stop_locked` rejected STOP after terminal; a failed terminal rollback could leave success terminal without STOP. The file replacement test patched `_open_regular_file` rather than exercising its inode comparison; cache pruning did not prove active keys survived; the preexisting-fence test did not include complete CLI evidence.
- Claude accepted the directory-symlink rejection, shim-collision behavior and cache-pruning logic. Global execution-identity, watchdog, same-UID, runtime output/environment, resource, and escaped-child blockers remain. Reviewer ran no tests. Stage2 STOP/G3 BLOCKED.

## 2026-10-15 candidate r23r: bound final scan races and make STOP authoritative

- Final scans now retry a transient file disappearance or typed `FileChangedDuringOpen` race for at most three polls; exhausting the budget returns `log_scan_unstable_tree` and cannot reach the success gate. Nonfinal reads retain the retry-on-next-poll behavior. `cand.llm.jsonl` is therefore not accepted based solely on a skipped final read.
- `_open_regular_file` raises a dedicated exception for dev/inode mismatch, removing the scanner's coupling to an exception message. The regular-file replacement regression now swaps a real different-inode file at the `os.open` boundary and verifies the marker is found on the next poll.
- STOP is now permitted after terminal publication and removes/syncs terminal where possible. If unlink fails, the durable STOP marker remains authoritative and any coexisting terminal is failure. A terminal-publication OSError attempts rollback and a failure STOP even when rollback fails. README explicitly covers bounded final retries and STOP precedence.
- Added tests for complete-CLI evidence plus preexisting fence, final scan transient retry and retry exhaustion, actual inode replacement, STOP after terminal, terminal rollback unlink failure, and preservation of active cache entries.
- Local canonical fake-only suite **135/135** passed (32.296s), `py_compile` and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23r-full-local.log`, SHA256 `ce2df532a45526a7517e7437c9751e111b3d006832b7fe29915e4d10e036717c`.
- Mini focused fake suite **50/50** passed (13.067s), `py_compile` / `git diff --check` PASS; log `operations/2026-10-14/stage2-r23r-mini-focused.log`, SHA256 `5b87811ff861433aaea3989fec6b23ae4e43c83e6857a15a5652c994fcb167ca`. Mini free after run was 41,840,428 KiB (<40 GiB), so full suite was skipped. Fresh independent review pending. No real CLI/world/model/provider/Anvil, commit, push, PR, CI or merge.

## 2026-10-15 candidate r23s: close final-scan budget and stat-race gaps

- Claude r23r provider response was `REQUEST_CHANGES` but lacked literal severity markers; structured validator rejected it, so outside-review coverage was unavailable. The summary is retained in `operations/2026-10-14/reviews/stage2-claude-r23r-final.md`; do not treat that response as a formal review gate.
- r23s marks any unvisited entry pending when a final scan exhausts its byte budget, including EOF-complete entries with cached tails. Final enumeration-time file disappearance enters the same bounded retry path as open/read races. Renamed the bound to `MAX_FINAL_SCAN_ATTEMPTS=3` (three total observations, two retries).
- Local fake-only suite 137/137 and mini focused fake suite 6/6 passed; see `operations/2026-10-14/stage2-r23s-mini-receipt.json`. The review exposed that the race bound applied only to consecutive races and there was no overall final-poll ceiling; it also found weak active-cache assertions and an unreachable loop-head byte-budget branch. See the accepted-coverage review record `operations/2026-10-14/reviews/stage2-claude-r23s-final.md`.

## 2026-10-15 candidate r23t: define acceptance reader and bound finalization

- Added `verify_job_outcome(job, supervisor_returncode)` as a same-UID consistency reader. It requires independently observed exact integer exit code 0, a valid completion fence and terminal, complete hash-checked results for every reserved CLI start, no active CLI records, and STOP absence before and after evidence reads. Disk files cannot supply or attest the external process status.
- If terminal publication's directory sync fails and both rollback and STOP persistence also fail, terminal-only evidence can remain while the supervisor fails. This is now a tested fail-closed reader case: a nonzero externally observed supervisor result rejects that disk state. Same-UID actors can still forge all records; this helper is not authentication.
- Final file-entry race observations now accumulate across clean-but-pending polls and stop at three observations. All finalization is additionally bounded to 64 polls; directory-component disappearance/identity change and enumeration I/O failure still stop immediately. Removed the unreachable duplicate budget branch. Expanded cache-pruning assertions to preserve exact active offset, tail, and deferred-marker state while deleting stale keys.
- Canonical fake-only suite **142/142** passed (32.119s), `py_compile` and `git diff --check` PASS; local log is `operations/2026-10-14/stage2-r23t-full-local.log`. Mini focused fake suite **11/11** passed (0.160s), in-memory compile and `git diff --check` PASS; mini log is `operations/2026-10-14/stage2-r23t-mini-focused.log`. Four source hashes matched; receipt `operations/2026-10-14/stage2-r23t-mini-receipt.json`. Mini free after run was 41,869,144 KiB (<40 GiB), so full mini suite skipped.
- Claude r23t returned `REQUEST_CHANGES`. The later Claude r23v static review returned `APPROVE` for the r23v candidate diff only; coverage did not include tests/hash/mini/runtime. Its P3 follow-ups are recorded in `operations/2026-10-14/reviews/stage2-claude-r23v-final.md` and addressed in r23w. Stage2 STOP / G3 BLOCKED; no runtime or shipping action.

## 2026-10-15 candidate r23v: enforce fail-closed acceptance and preserve finalization bounds

- Claude r23t returned `REQUEST_CHANGES` (structured validator passed), static-only. It found that nonfinal empty-tree scans reset final counters, acceptance reader tests and external wait-status connection were incomplete, read-phase directory disappearance disagreed with docs, cache timing was flaky, dangling STOP markers could be missed, ledger I/O could leak, active registry temp entries were ignored, terminal failure lacked lock-free STOP fallback, and the long history obscured current state. Summary: `operations/2026-10-14/reviews/stage2-claude-r23t-final.md`.
- r23v retains final race/poll counters through nonfinal empty scans; treats directory-descent disappearance as immediate fail-closed while retrying only file-entry races; checks STOP/fence/terminal via lstat (including dangling symlinks); maps ledger I/O errors; requires a completely empty active registry and receipt call cap; and tries lock-free STOP publication after terminal verification failure.
- `verify_job_outcome` also validates receipt, candidate nonempty file, result/log hashes, full start count, and active registry; tests cover missing/invalid evidence, symlinks, STOP appearing on the final check, external return-code type/value, and an end-to-end fake supervisor subprocess whose observed return code is passed into the reader. This helper is still not wired to enabled operational execution; `run`/`invoke` remain disabled.
- Runbook now declares the current STOP/G3 BLOCKED state at the top and points to the operations status ledger; historical candidate notes remain below.
- Canonical fake-only suite **151/151** passed (31.586s), `py_compile` and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23v-full-local.log`. Mini focused fake suite **21/21** passed (3.037s), in-memory compile and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23v-mini-focused.log`, receipt `operations/2026-10-14/stage2-r23v-mini-receipt.json`. Four file hashes were synchronized. Mini free space 41,868,756 KiB, below the 40-GiB floor; no full mini suite.
- The first focused invocation had three selector discovery errors and is explicitly excluded; corrected exact selectors passed 21/21. No overlapping mini runs. No real runtime/model/provider/Anvil/CLI. Claude r23v review approved this candidate only; its five P3 findings are addressed in r23w. Stage2 STOP/G3 BLOCKED; no commit/push/PR/CI/merge.

## 2026-10-15 candidate r23w: align acceptance reader and close reviewer negative controls

- Candidate finding follow-ups: enumerated entries disappearing before `lstat` are documented as an entry race regardless of kind; known directory disappearance during descent still stops immediately. Supervisor and reader now use the same direct `work/cand.llm.jsonl` acceptance location.
- `verify_job_outcome` now verifies the parent review token against the receipt. Negative controls include an actual nonzero supervisor subprocess with complete disk evidence; valid but symlinked fence/terminal; malformed fence JSON; FIFO/symlink candidate; missing review token; and an on-disk STOP created after success evidence is read. Dangling marker checks cover `invoke` and finalized-job checks.
- A preexisting malformed/dangling STOP path now returns `existing_stop_invalid` from a subsequent stop publication while all execution/gate checks continue to treat it as a failure marker.
- Canonical fake-only suite **153/153** passed (33.663s), `py_compile` and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23w-full-local.log`. Mini focused fake suite **23/23** passed (4.427s), in-memory compile and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23w-mini-focused.log`, receipt `operations/2026-10-14/stage2-r23w-mini-receipt.json`. Four file hashes match. Mini free 41,872,040 KiB (<40 GiB); full mini suite skipped.
- Fresh independent Claude review pending. Stage2 STOP / G3 BLOCKED; run/invoke remain hard-disabled; no runtime or shipping action.

## 2026-10-15 candidate r23x: close r23w independent-review findings

- Fresh Claude review of r23w returned `REQUEST_CHANGES`; structured validator passed. Coverage was static-only. The review confirmed candidate-path agreement, review-token binding, STOP idempotency, race documentation, and directory-descent failure behavior. It found one P2 historical approval attribution error and four P3 cache/type/error/negative-control issues. Full response and scoped coverage are preserved in `operations/2026-10-14/reviews/stage2-claude-r23w-response.txt`; summary: `operations/2026-10-14/reviews/stage2-claude-r23w-final.md`.
- Corrected the runbook: r23t was `REQUEST_CHANGES`; the later r23v review approved r23v only. Final enumeration-time disappearance now immediately discards the vanished path's offset, tail, and deferred-marker cache before bounded retry. Reader/supervisor return-code checks require exact integer zero; candidate acceptance requires a regular single-link file. Receipt read races in review-token verification become `GuardError`.
- Replaced the status-forging negative control with an external test process that SIGKILLs the supervisor after terminal publication and passes the observed negative signal wait status to the reader. Removed the fixed-duration lock assertion; added FIFO marker rejection and bool/float/hardlink/cache/OSError regressions.
- Canonical fake-only suite **156/156** passed (33.229s), `py_compile` and `git diff --check` PASS; log `operations/2026-10-14/stage2-r23x-full-local.log`, SHA256 `eb6262f384d2fe621a935376442d755d303b7c16ea9ffd87520697dce756114b`.
- Mini focused fake suite **8/8** passed (2.255s), compile and diff-check PASS; log `operations/2026-10-14/stage2-r23x-mini-focused.log`, SHA256 `98480c5b76cecd2d0169b7b840279f058910b6171386c712933b7088cf6494a9`. Mini free 41,868,916 KiB (<40 GiB), so full mini suite skipped. Four canonical/mini source hashes match in `stage2-r23x-mini-receipt.json`; no ASCON process remains after this lane.
- Fresh Claude review of r23x pending. Stage2 STOP / G3 BLOCKED; run/invoke disabled. No real runtime/provider/CLI/world/Anvil and no commit/push/PR/CI/merge.

## 2026-10-15 candidate r23y: harden lock and file-incarnation regressions

- Claude r23x review returned `REQUEST_CHANGES`; structured validator passed, static-only. It confirmed r23w history attribution and exact return-code/FIFO fixes, but found that the lock test did not prove OS-level contention, file inode reuse between polls could preserve offsets, `authorize_for_run` could leak receipt-hash OSError, the scanner-side hardlink policy lacked a test, and the SIGKILL negative control had an 8-second watcher limit. Full response: `operations/2026-10-14/reviews/stage2-claude-r23x-response.txt`; summary: `operations/2026-10-14/reviews/stage2-claude-r23x-final.md`.
- r23y observes an actual `BlockingIOError` from `flock` in the competing reservation thread before fence publication. A gate-lock-removal mutation was injected and the test rejected it at that synchronization point. Scanner cursor identity included filesystem birth time where available; the r23y note that systems without birth time used change time was superseded in r23z, which removed that fallback and fails closed as unavailable. Added poll-to-poll identity replacement and scanner hardlink regressions. `authorize_for_run` normalizes receipt hashing OSError to `GuardError`. The supervisor SIGKILL test watcher is bounded at 30 seconds, with a 35-second supervisor wait.
- Canonical fake-only suite **159/159** passed (32.806s); `py_compile` / `git diff --check` PASS. Log `operations/2026-10-14/stage2-r23y-full-local.log`, SHA256 `488a759fd15f4617900031b06fbc9f62c144068514fbbadc98be3aa4709d1f00`.
- Mini focused fake suite **11/11** passed (2.400s); compile/diff-check PASS. Log `operations/2026-10-14/stage2-r23y-mini-focused.log`, SHA256 `deadd5b1e8d5d5338f84dbf39ddc0483ed2fed797a362e5a670c10431a3d1243`. Mini free 41,848,412 KiB (<40 GiB); full suite skipped. Four source hashes match in `stage2-r23y-mini-receipt.json`; lock-removal mutation rejection is recorded in `stage2-r23y-lock-mutation.log`.
- Fresh Claude review of r23y pending. Stage2 STOP / G3 BLOCKED; run/invoke disabled. No real runtime/provider/CLI/world/Anvil and no commit/push/PR/CI/merge.

## 2026-10-15 candidate r23z: verify scan identity at open and atomically publish parent review

- Claude r23y review returned `REQUEST_CHANGES`; structured validator passed, static-only. It found a P2 enumeration/open race that could carry an old offset into a same-inode replacement, P3 ctime fallback causing repeat rescans/backlog STOP, README omission of hardlink policy, SIGKILL test without positive acceptance control/guaranteed cleanup, and direct non-atomic parent review-token write. Full response `operations/2026-10-14/reviews/stage2-claude-r23y-response.txt`; summary `operations/2026-10-14/reviews/stage2-claude-r23y-final.md`.
- r23z compares open-descriptor birth identity and `st_nlink` with enumeration metadata before reading. Any difference enters the existing cache-discard/retry path. If filesystem birth time is unavailable, scanning fails closed as `log_scan_unavailable`; ctime is no longer used as a cursor identity. README now documents unsupported filesystems, hardlink rejection, and post-open checks.
- The SIGKILL negative control now proves complete disk evidence is accepted with synthetic external rc=0 before verifying rejection with the actual negative signal wait status. Both spawned processes are reaped in `finally`. `authorize_for_run` stages a read-only token, fsyncs it, and publishes via same-directory hard link; I/O failures normalize to `GuardError` and temporary tokens are cleaned. Job path resolution errors also normalize.
- Canonical fake-only suite **163/163** passed (33.957s), `py_compile` / `git diff --check` PASS; log `operations/2026-10-14/stage2-r23z-full-local.log`, SHA256 `6677b4a3a199fe3359b014128b2cd988713ef03b63efe7ad9e26ec90d952475b`.
- Mini focused fake suite **15/15** passed (2.607s), compile / diff-check PASS; log `operations/2026-10-14/stage2-r23z-mini-focused.log`, SHA256 `0d4828ed1fbad9c37f91fb22944f90803caf399309ecc7677f860285f4e92c5c`. Free 41,854,280 KiB (<40 GiB), so full mini suite skipped. Four canonical/mini source hashes match in `stage2-r23z-mini-receipt.json`; no ASCON job remained after the lane.
- Fresh Claude static re-review of r23z pending. Stage2 STOP / G3 BLOCKED; run/invoke disabled. No real runtime/provider/CLI/world/Anvil and no commit/push/PR/CI/merge.

## 2026-10-15 candidate r23aa: reconcile review-token publication and portable scanner tests

- Claude review sequence 29 of candidate r23z returned `REQUEST_CHANGES`, structured validator PASS, static-only. It found post-link directory-fsync failure could be reported as an error while leaving a valid authorization token, cleanup gaps for fake world/CLI sessions on timeout, missing explicit macOS/Python birthtime support in docs/tests, and historical ctime/reviewer-label ambiguity. Full response: `operations/2026-10-14/reviews/stage2-claude-r23z-response.txt`.
- r23aa treats the successfully linked review token as published only after `verify_review_token` confirms it still matches the receipt; directory fsync remains crash-ordering best effort, not a hardware durability claim. A regression injects failure only on the directory fsync and checks the verified token and returned receipt digest. The SIGKILL test finally block now attempts recorded CLI-group and owned-world-group cleanup before reaping direct children.
- Birthtime-dependent scanner regressions skip with an explicit reason where Python `stat` lacks `st_birthtime`; the synthetic no-birthtime fail-closed control always runs. README now names macOS/Python birthtime support. Historical r23y ctime wording is marked superseded by r23z, and the runbook distinguishes reviewer-sequence labels from candidate IDs.
- Final canonical local fake-only suite **164/164** passed (33.451s); `py_compile` and `git diff --check` PASS. Log `operations/2026-10-14/stage2-r23aa-final-local.log`, SHA256 `20c2f2e3fb28887047f54c613cf7e351f6f3e10ac3cacc9aa51d477cf119b059`.
- Mini focused fake suite **35/35** passed (1.807s). After the requested npm-cache cleanup raised free space above the 40-GiB floor, the final-tree full mini fake-only suite passed **164/164** in 55.061s. Final-suite log `operations/2026-10-14/stage2-r23aa-mini-final.log`, SHA256 `dd1ab59c95e6611a8b4afe8fff0b971fdce5962e8f490c6180e746cedee862c4`; focused log SHA256 `0e6279582d49fac813e1ea4f4fbd4ac8dece64309387f40c3276e0beb316c462`. Mini free space after the final suite was 44,173,636 KiB. Final canonical/mini hashes match: guard `377943b7a5bdaa5c5724f7b3ccaa8e7d1b5e6378fb89dc5133e966002e636b53`, tests `98bd018126db0370bca79d55c3c07d8898331be8955ee0eeb0647f17091b5b67`, README `f6f0fe1a44cf3cbe3ee2d6ce91f53b2c63deff110e8ccf66d45cbe9c26a4f10b`; runbook hash is recorded in `stage2-r23aa-mini-receipt.json`. No ASCON process remained after the lane.
- The user directed that Claude not be used for reviews. An in-session Codex static review found no new issue in the r23aa-specific changes; it is not an independent review. No Grok tool is configured and the prior credential-exposing CLI route will not be reused, so independent Grok review remains unavailable. Stage2 remains STOP, G3 remains BLOCKED, and run/invoke remain hard-disabled. No real runtime/model/provider/Anvil/CLI, commit, push, PR, CI, or merge.

## Current implementation note — T4 output classification (2026-10-15)

The candidate scanner currently reads regular single-link files ending in `.log`, `.json`, `.jsonl`, or `.txt` under the runtime output root. Any symlink under that root stops as `log_scan_unsafe_path`; any other regular-file extension, including an extensionless output, stops as `log_scan_unclassified_output`. Do not expand the suffix set by assumption: first inventory outputs from an authorized runtime artifact, then add a fake-only regression for each newly classified format.

This is fail-closed scanner behavior verified with fake-only tests, not proof that the real runtime writes all of its logs or decision evidence under the monitored root. The full runtime output mapping and provenance remain unverified. Current evidence is recorded in `operations/2026-10-14/STATUS.md` and `operations/2026-10-14/stage2-t4-r4-mini-receipt-2026-10-15.json` under that separate coordination handoff workspace.

Stage2 remains STOP, G3 remains BLOCKED, and `run` / `invoke` remain disabled. This note grants no execution approval. Offline integration follows the review and publication gates described above and cannot clear Stage2 STOP or G3 BLOCKED or enable run/invoke.

## Current-source offline checkpoint (2026-10-15 22:58 JST)

A fresh mini run verified the current guard and tests with **166/166 fake-only tests PASS** (55.410s), followed by `npm run typecheck` and `git diff --check` PASS. Guard SHA-256 before/after: `537450a4653b71009ad0a0f61d3a52a1ee161e666f01ca4fa1c8efca44c1e99a`; tests SHA-256 before/after: `bcda91c86a915fcbec3251f0571799afdcc1e960894162624f6dcb123c64a15c`. The old r4 receipt listed a different test hash, so its 166/166 result was not reused for this checkpoint. The old receipt is retained as historical evidence with that mismatch disclosed.

Mini log: `~/ascon-control/logs/stage2-current-source-recheck-20261015.log`. Available space after the run: 41,920,944 KiB, above the 30 GB decimal floor. CLI/error strings in this suite come from fake fixtures; no real provider/model/world/Anvil was launched. Code and tests were unchanged during validation; the following local checkpoint commits preserve the tested working sources. Stage2 STOP, G3 BLOCKED and run/invoke disabled remain. This offline checkpoint is not live runtime acceptance.
