# B07：r3 実行 source・必要ファイル・独立 eval・ツール移植の決定案 — 2026-10-11

**本書は提案のみ。ツールの移植・再登録・起動はしていない。B07 は未解消（BLOCKED）。G3（Gate 3、自己改訂の実チェーン受入れ）は内部の必須ゲート（REQUIRED）のまま開始不可（BLOCKED）。B03 は本人受容済みの未解決残余リスク（USER-ACCEPTED）で、合格・解消ではない。** どのゲートの免除・緩和も提案しない。所要時間の見積りは本書の範囲外で、数値は出さない。

用語：source は実行に使うソース原本（Git の作業ツリー）、view はその読取専用コピー、eval は書込み可能な独立評価領域、manifest はファイルと内容ハッシュの対応台帳、pin は期待する版・内容を固定する記録、lock は `g3/inputs.lock.json`（入力固定台帳）、SHA-256（Secure Hash Algorithm 256-bit）は内容ハッシュ、commit 値は Git の版識別子（40桁の16進数）、worktree は同じリポジトリの別作業ツリー、ZIP は提出用の圧縮配布物、Anvil はローカル検証用チェーン、F_ref（reference field）は参照場。引用の基点は `ascon-notes/league/`、`C/` は `g3/chain/`。

本書の判断材料は今回の読取・Git 照会で得た値で、各所に取得方法を書く。「提案」と書いたものは本人の決定前の案であり、決定ではない。

## 0. 今回新たに確認した事実（読取のみ）

| 事実 | 取得方法 |
|---|---|
| 旧 r2 用 worktree `.claude/worktrees/release-r2` の現在の HEAD は `5b713a474d31a9b10fa7ae3aa0a0b3515736c10d`（branch `release/r2-c0`）で、`ec80bb8` ではない。`ec80bb8…` はその祖先 | `git -C …/release-r2 rev-parse HEAD`、`git merge-base --is-ancestor` |
| そのため旧生成器 `C/make-view.py:8` の `assert head.startswith('ec80bb8')` は、今そのまま実行すれば停止する（実行はしていない。コードからの導出） | 行読取 |
| 10/10 の移植計画が読めた旧台帳 `/tmp/g3-chain/source-manifest.json`（同計画の「M」）は、今回は存在しなかった。`/tmp/g3-chain/` には `eval`、`eval2`、`source-view` 等のディレクトリだけが残る。消えた原因は特定していない | `ls -la /tmp/g3-chain`、読込み時の FileNotFoundError |
| `C/chain.py:40` は import 時にこの台帳を読むため、現状のままでは起動自体が失敗する（コードからの導出、未実行） | 行読取 |
| 候補 tree hash（集約方法は `g3/prestart-check.py:47-49`）は、r3 提出物の bundle 元 commit `1f49117…`、`5b713a4…`、現 `origin/main`（`333c2ae7…`）の committed byte でいずれも `a03da518…3dff` | `git show <commit>:<path>` の byte から Python で再計算 |
| r3 bundle は main `1f49117` から作成した記録がある | `RELEASE-CHECKS-ZETA-R3-2026-10-06.md:9` |
| `1f49117` の `g3/prestart-check.py:18-19` は `CANDIDATE='example/agents/ascon-zeta-r2'`、期待値 `153becef…`（r2）。同 commit の lock も r2 候補で入力37件 | `git show 1f49117:…` |
| 標準 runtime／lib／SDK（`example/agents/runtime`、`example/agents/lib`、`sdk`）は `1f49117`・`5b713a4`・`origin/main`・`upstream/main` の間で byte 差なし | `git diff --quiet`（終了0） |
| `1f49117` と `origin/main` の差のうち `ascon-notes/` 以外は16ファイル（`ascon-zeta-r3a`、`ascon-zeta-r3c`、`fixed-bid-5gwei`、関連テスト） | `git diff --name-only` |
| chain 13ファイルの現 SHA-256 は、lock 登録済み8件が `inputs.lock.json:7-14` と一致 | `shasum -a 256` |

## 1. 決定事項 (a)：r3 実行 source（commit／branch／パス）

**r2 のやり方**：`C/make-view.py:3` の固定パス（release-r2 worktree）から、HEAD の先頭が `ec80bb8` であることを確認し（`:8`）、追跡済み通常ファイルを `/tmp/g3-chain/source-view` に読取専用で書き出し（`:9-29`）、台帳を `/tmp/g3-chain/source-manifest.json` に書いた（`:30-31`）。`C/chain.py:33` と `C/revision_audit.py:21` も同じ固定パスを source とする。なお生成器の台帳には `absoluteGitDir` キーが無い（`make-view.py:30`）が、`chain.py:117` は必須として読む。

**r3 の制約**：`chain.py:130` は source 側の `prestart-check.py` を起動し、prestart は lock（chain ツール自身の hash を含む）を source 側で照合する。したがって source commit には「移植・再登録済みの chain ツールと、それを登録した lock」が入っている必要がある。

| 案 | 内容 | 事実 | 長所 | 短所 |
|---|---|---|---|---|
| A1 | 提出物の bundle 元 `1f49117` を source にする | 候補 tree は `a03da518…`、標準 runtime/lib/SDK は main と同一。ただし prestart と lock は r2 用（§0） | 提出 ZIP と同じ commit | source 側 prestart が r2 候補を期待するため、そのままでは通らない。通すには別 commit のツールや lock を混ぜることになり、由来が分かれる |
| A2 | 現 `origin/main` `333c2ae…` を source にする | r3 lock・r3 prestart を含む。chain ツールは r2 固定のまま | すぐ選べる | ツール移植前の commit なので、移植後の lock と食い違う。最終 source にはなり得ない |
| A3 | 移植 PR を main へ merge した後の commit を、40桁で事前レビューして source に固定。専用の detached worktree（例：`.claude/worktrees/release-r3-g3`）をその commit に作る | 候補・標準依存は A1 と同一 byte であることを Git で照合できる。`1f49117` との差は §0 の16ファイル＋`ascon-notes/` | source・ツール・lock が1つの commit にそろう。r2 worktree を動かさずに済む | 提出 ZIP の commit とは別になる。ZIP との対応（候補・標準依存・配布物の一致）は別欄で証拠化が必要 |

**提案**：A3。commit 照合は先頭一致ではなく40桁の完全一致にする。旧 release-r2 worktree は動かさず履歴として凍結する。提出 ZIP との対応は B07 の別欄として残し、A3 を選んでも閉じたとは扱わない。

## 2. 決定事項 (b)：r3 の必要ファイル集合

10/11 監査で観測した109件の内訳は、候補5、`example/agents/runtime` 23、`example/agents/lib` 13、`sdk` 52、runner・採点器・設定16（`run-matrix.sh`、`g0.py`、`g0_contract.py`、`g3/harness.mjs`、`league-report.py`、`league_harness.py`、`round_manifest.py`、`run-league.sh`、`xb-r-live-claude-timed.sh`、`config/regimes/{calm,crash,depeg}.yaml`、`core/src/backtest/shared.ts`、`core/src/cli/backtest.ts`、`package.json`、`package-lock.json`）。出典は `g3/manifest-contract/r3-manifest.DRAFT.json` の `observedSourceSubset`。

**109件に無いが、chain が実際に読む・起動するもの**（`chain.py` の読取から。import の全連鎖は追っていない）：

| 不足 | 根拠 |
|---|---|
| `ascon-notes/league/round-manifest.py`（ハイフン版。109件にあるのは `round_manifest.py`） | `chain.py:142,147` |
| F_ref の相手 `example/agents/noop/agent.ts`、`multi-arb/{agent.ts,prompt.md}`、`clean-arb/agent.ts` | 相手の並び `chain.py:72`、tree は lock `inputs.lock.json:89-114` |
| `g3/schedule.tsv`、`g3/budget.json`、`g3/ref-on.yaml`、`g3/ref-off.yaml` | `chain.py:41,62,70-71` |
| `g3/prestart-check.py`、`g3/inputs.lock.json` | `chain.py:130` |

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| B1 | r2 と同じく、追跡済み通常ファイル全部（秘密名除外）を view にし、全件を期待集合にする（この worktree の追跡ファイルは1572件） | 取りこぼしが起きにくい | 本人レビュー量が大きい。実行に無関係な差分でも停止する |
| B2 | 109件だけを期待集合にする | 小さい | 上表の不足があり、実行物を束縛しきれない |
| B3 | view は B1 と同じ全件で作り、そのうち「必須集合」（109件＋上表の不足＋import 連鎖を追って見つかる分）を本人レビュー済み一覧として別に固定し、不足・不一致で停止する | 被覆と審査対象の明確さの両立 | 必須集合を作るために import 連鎖の追跡作業が別に必要 |

**提案**：B3。109件はすべて必要側に残す（どれが未使用かは import を追うまで判断しない。削る根拠は現時点で無い）。node_modules・Node・tsx の実体は source ではなく eval 側の欄で別に束縛する。

## 3. 決定事項 (c)：独立 eval 領域

r2 では `chain.py:25,34-35` で `/tmp/g3-chain` の下に view と eval を置き、ツールも同じ場所から実行した（`TOOL_ROOT=BASE`、`:26`）。予算台帳だけは `/tmp` を拒否して `$HOME` 側に置く（`:216-224`）。

| 案 | 内容 | 事実 | 長所 | 短所 |
|---|---|---|---|---|
| C1 | `/tmp/g3-chain-r3` のような新しい一時領域 | r2 と同形 | 既存コードの変更が少ない | §0 のとおり旧 `/tmp/g3-chain` の台帳ファイルは1日で消えていた（原因未特定）。証拠の保存場所として不安定 |
| C2 | `/tmp` 外の専用ディレクトリ（例：`$HOME/ascon-g3-r3/`）に `view/`、`eval/`、`tools/`、`evidence/` を分けて置く | 台帳が `/tmp` 外という既存方針と同じ向き | 消去されにくい。用途ごとに分けて symlink・共有書込先を検査しやすい | 新パスをツールへ通す変更が増える。依存導入（node_modules）にネットワークが要る可能性 |
| C3 | 別ホスト（Mac mini）に置く | 計測ホストの扱いは別 blocker（`prestart-check.py:35`） | 作業機と分離できる | ホスト間の束縛・転送が増え、遠隔操作が必要 |

**提案**：C2。旧 `/tmp/g3-chain` は上書き・再利用しない。依存導入は別工程に分け、導入後の実 byte と Node・tsx 実体を eval 欄に記録する。

## 4. 決定事項 (d)：13ファイルの移植計画（編集はしていない）

置換後の記号：`<R3_SOURCE>`＝§1 A3 の worktree パス、`<R3_COMMIT>`＝その40桁 commit 値、`<R3_BASE>`＝§3 の領域（C2 なら `tools/` 等のサブディレクトリ）。行番号は現 byte（hash は §0）で確認済み。

| ファイル | lock | r2 を固定している行（現内容） | 置換案 |
|---|---|---|---|
| `chain.py` | 登録（`inputs.lock.json:7`） | `:25` `BASE=/tmp/g3-chain`、`:33` `SOURCE=…/release-r2`、`:74` `assert candidate['dir']=='ascon-zeta-r2'`、`:153` `'g3-r2-ref-'`、`:336` 表示文の `/tmp/g3-chain/chain.lock` | `:25`→`<R3_BASE>`、`:33`→`<R3_SOURCE>`、`:74`→`'ascon-zeta-r3'`（lock の `candidateDir` と一致）、`:153`→`'g3-r3-ref-'`（予定表は全行 `g3-r3-*`、`G3-LOCK-R3-2026-10-08.md:16`）、`:336`→`<R3_BASE>`。`:29-32` の TOOL_MANIFEST は登録器が更新。`:117` が読む `absoluteGitDir` を生成側と一致させる |
| `make-view.py` | 登録（`:10`） | `:3` src、`:4` out、`:8` `head.startswith('ec80bb8')`、`:31` 台帳の出力先。`:30` に `absoluteGitDir` が無い | `:3`→`<R3_SOURCE>`、`:4`/`:31`→`<R3_BASE>` 配下、`:8`→`head=='<R3_COMMIT>'`（完全一致）、`:30` に `absoluteGitDir` を追加。上書き拒否・秘密名除外（`:5,14-18`）は維持 |
| `revision_audit.py` | 登録（`:12`）＋TOOL_MANIFEST（`chain.py:31`） | `:21` `SOURCE=…/release-r2`、`:5` と `:32` のコメント `ec80bb8` | `:21`→`<R3_SOURCE>`、コメントを r3 commit 表記へ。`:20` の BASE はスクリプト所在で決まり、`:33` はその隣の台帳を読むため、配置先を `<R3_BASE>` の台帳と同じ場所にそろえる |
| `gates.py` | 登録（`:9`）＋TOOL_MANIFEST（`chain.py:30`） | r2 文字列なし。`:5` で chain から配置を import、`:48` は SOURCE 内の wrapper | byte 変更は不要の見込み（chain 側の置換に追従）。ただし「文字列なし＝r3 対応済み」とは扱わず、正例・反例で確認 |
| `malicious.mjs` | 登録（`:11`） | `:4` `root=…/release-r2` | `:4`→`<R3_SOURCE>`。両 fixture と失敗時停止（`:7-12`）は維持。B03 は本人受容済み未解決のまま |
| `g3-ref-chain.sh` | 登録（`:8`） | `:9` `exec python3 -B /tmp/g3-chain/chain.py` | `:9`→`<R3_BASE>` の chain.py |
| `test_chain.py` | 登録（`:14`） | `:56` `g3-r2-ref-calm-49002-on/off`、`:213` `/tmp/g3-chain/fake-home` | `:56`→`g3-r3-ref-…`。`:213` は「`/tmp` 下の HOME を拒否する」反例なので `/tmp` のまま残し、r2 名だけを外した名前にする。r2 source を与えると停止する反例を追加 |
| `revision_replay.mjs` | 登録（`:13`） | r2 文字列なし。root は引数（`:6`）、`:9-11` で root 配下を import | 固定箇所の移植は不要。呼出側（`revision_audit.py:42-45`）が渡す root が r3 になることで追従 |
| `decide-budget-control.mjs` | 未登録 | `:3` `root=…/release-r2`、`:17` 出力 `/tmp/g3-chain/decide-budget-control.json` | `:3`→`<R3_SOURCE>`、`:17`→`<R3_BASE>` の evidence 配下 |
| `timeout-control.mjs` | 未登録 | `:3` `base='/tmp/g3-chain'`、`root=…/release-r2` | base→`<R3_BASE>`、root→`<R3_SOURCE>`。`:7,10,12,16` の派生パスは base に追従 |
| `timeout-child.cjs` | 未登録 | r2 文字列なし。出力先は引数（`:2-3`）で、`timeout-control.mjs:7` が渡す | 変更不要。配置先だけ `<R3_BASE>` |
| `test_revision_audit.py` | 未登録 | `:143,145` `python3 -B /tmp/g3-chain/revision_audit.py` | `<R3_BASE>` の監査器パスへ |
| `revision_exchange.mjs` | 未登録 | r2 文字列なし。`:9` 相対 import、`:12` ファイル位置から4階層上をリポジトリ root とみなす | 変更不要。ただし `<R3_BASE>` へコピーすると root が狂うため、リポジトリ内の位置から実行する |

**hash 再登録の必要（再登録は本人レビュー後の別工程、`register-inputs.py:4-5`）**

- 登録済み8件（`inputs.lock.json:7-14`）：上表で byte が変わる見込みの `chain.py`、`make-view.py`、`revision_audit.py`、`malicious.mjs`、`g3-ref-chain.sh`、`test_chain.py` の6件は新 hash の登録が必要。`gates.py`、`revision_replay.mjs` の2件は byte が変わらなければ値は据え置き、照合だけ行う。`gates.py`・`revision_audit.py` は TOOL_MANIFEST（`chain.py:29-32`）にも載るため、変更すれば `chain.py` の hash も連鎖して変わる（`register-inputs.py:52-68`）。
- 未登録5件（`decide-budget-control.mjs`、`timeout-control.mjs`、`timeout-child.cjs`、`test_revision_audit.py`、`revision_exchange.mjs`）：登録するには登録器の追加一覧 `register-inputs.py:20-23` に加える必要があり、その結果 `register-inputs.py` 自身（lock `:41`）も再登録対象になる。
- 実行時の照合は TOOL_MANIFEST の2件だけ（`chain.py:173-180`）。他11件が `<R3_BASE>` にコピーされた後の byte は、現コードでは実行時に照合されない。

未登録5件の扱いの案：

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| D1 | 5件すべてを lock に登録 | r3 証拠を作る部品がすべて hash で追える | 登録器の変更が増える |
| D2 | r3 で実際に使う部品だけ登録 | 変更が小さい | 「使うかどうか」の判断自体に本人レビューが要る |
| D3 | 登録せず、その出力を「未固定ツールの証拠」と明記 | 変更なし | その部品で得た記録の由来が弱いまま残る |

**提案**：D1。あわせて、コピー先の byte を実行時に照合する対象を広げるかを別途レビューする（本書では決めない）。

## 5. 本人が決めること（1項目1問）

1. r3 実行 source は、移植 PR の merge 後の commit を40桁で固定し、専用 worktree に置く案（§1 A3）でよいか。
2. 必要ファイル集合は、全件 view＋レビュー済み必須集合（109件＋§2 の不足＋import 連鎖分）の案（§2 B3）でよいか。
3. 独立 eval 領域は `/tmp` 外の専用ディレクトリ（§3 C2）でよいか。よければ具体パスは何にするか。
4. 未登録の chain ツール5件は、すべて lock へ登録する案（§4 D1）でよいか。

どれを選んでも B07 は閉じない。state dump の hash と互換性、提出 ZIP・観測器・CLI 実効設定の束縛は、Anvil・Docker・認証を要する別欄として残る。

## 6. 今回の操作

ファイル読取、文字列検索、`shasum -a 256`、Python 標準機能での hash 再計算、Git の読取照会（`rev-parse`、`show`、`diff --quiet`、`ls-tree`、`worktree list`、`merge-base`）、`/tmp/g3-chain` の一覧のみ。本書以外のファイル、lock、ツール、旧 `/tmp/g3-chain`、release-r2 worktree には書き込んでいない。**未実行**：make-view、chain の dry-run／run、prestart、登録器、テスト、typecheck、Anvil、Docker、ネットワーク、認証、モデル呼出、commit／push。
