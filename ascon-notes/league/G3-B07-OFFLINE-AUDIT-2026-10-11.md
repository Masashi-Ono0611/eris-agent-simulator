# B07：オフライン読取だけで確定できる範囲の監査 — 2026-10-11

**B07は未解消（BLOCKED）。G3（Gate 3、自己改訂の実チェーン受入れ）は内部の必須ゲート（REQUIRED）のまま開始不可（BLOCKED）。B03は本人受容済みの未解決残余リスク（USER-ACCEPTED）で、合格・解消ではない。** 本書は、B07が求める r3 の source／eval／tool manifest（ファイルと由来の対応台帳）の各欄について、実ファイルからオフラインで計算できた値と、実行・生成・本人レビューが無いと埋まらない欄を分ける。ツール・lock（入力固定台帳）・候補・既存証拠は変更していない。

用語：SHA-256（Secure Hash Algorithm 256-bit）は内容ハッシュ、HEADは作業ツリーの現在commit、Airは MacBook Air、eval は書込み可能な独立評価領域、view は source の読取専用コピー、state dump はチェーン初期状態の保存物、Anvil はローカルの検証用チェーン。引用の基点は `ascon-notes/league/`、`../../` はリポジトリルート。

## 1. 観測条件

| 項目 | 値 | 取得方法 |
|---|---|---|
| 作業ツリー | `.claude/worktrees/b07-1011`、branch `feat/b07-r3-manifest-1011` | `git branch --show-current` |
| HEAD ＝ origin/main | `cee6fe6169045de8cf35908ca619346bc8a4f7ef` | `git rev-parse HEAD origin/main`（同値） |
| upstream/main | `4057ea339f050373bdff92c961b71d015afaad3c`（`g3/inputs.lock.json` の `localUpstreamRef` と同値） | `git rev-parse upstream/main` |
| 追跡ファイルの未コミット変更 | なし | `git status --porcelain=v1 --untracked-files=no` |
| Node／tsx | v24.13.0／tsx v4.23.13（この作業ツリーの node_modules。独立evalのものではない） | `node --version`、`node_modules/.bin/tsx --version` |

この HEAD は**今回の監査に使った作業ツリーの観測値**であり、r3 実行用 source commit として選定・レビューされた値ではない（選定値は読取範囲の文書に **not found in files**。`G3-B07-R3-PORT-2026-10-10.md:42`）。

## 2. 契約が要求する欄と実値

対象の契約は `g3/manifest-contract/check.py` の必須キー（`KEYS`、`check.py:9-15`）。区分は「確定（直接取得）」「観測のみ（値は取れるがr3実行値として未選定）」「未確定（実行・生成・レビューが必要）」。

| 欄 | 実値／状態 | 区分 | 理由・必要なもの |
|---|---|---|---|
| `release` | `r3` | 確定 | `G3-LOCK-R3-2026-10-08.md` の既決事項 |
| `candidateId` | `cand` | 確定 | `g3/inputs.lock.json` の `candidateId` |
| `candidateDir` | `ascon-zeta-r3` | 確定 | 同 `candidateDir`、`g3/prestart-check.py:18` |
| `candidateSha256` | `a03da51869cf8c8160aaa25eb5f1e87cfa74a3a9dfdac3050945a71f7d143dff` | 確定 | 作業ファイルの再計算と HEAD の committed byte からの再計算が一致し、lock・`prestart-check.py:19` の期待値とも一致（集約方法は `prestart-check.py:47-49`） |
| 候補5ファイル | `agent.ts` `2903c55d…ffe6a`、`delta.ts` `9ae322a7…ade91`、`launch.ts` `3b2df02d…8b36a`、`launchSwap.ts` `0feb331b…6b1`、`prompt.md` `8494cdc8…f5336`（完全値は DRAFT の `candidateFiles`） | 確定 | `shasum -a 256` と Python の `hashlib` の別経路で同値、lock の `agentTrees.ascon-zeta-r3` とも一致 |
| 相手 agent tree 12件 | lock の各 `sha256` と作業ファイル再計算が全件一致 | 確定（照合のみ） | manifest 契約の欄ではないが、B07が束縛を求める「相手」の現byte |
| lock の `inputs` 47件 | 全件、現byteの SHA-256 と一致 | 確定（照合のみ） | lockの登録一致であり、r3実行配置の登録ではない |
| `head` | 未確定（観測値は §1 の `cee6fe61…`） | 観測のみ | r3 実行 source commit の選定とレビューが必要 |
| `branch`、`mainRef`、`absoluteGitDir` | 未確定（観測値：上記branch、`cee6fe61…`、`/Users/masashi_mac_ssd/Developer/ascon/.git/worktrees/b07-1011`） | 観測のみ | 実行用 source の Git 参照が未選定。この作業ツリーは作業用branchで実行sourceではない |
| `source` | 未確定 | 未確定 | 実行用 source の配置パスが未決（`G3-B07-R3-PORT-2026-10-10.md:42`） |
| `files`（source の全期待集合） | 部分集合のみ観測：候補＋`example/agents/runtime` 23件＋`example/agents/lib` 13件＋`sdk` 52件＋runner／採点器／設定16件＝109件 | 観測のみ | 必須ファイル集合そのものがレビュー未了（`G3-B07-R3-PORT-2026-10-10.md:65`）。node_modules・Node・tsx の実解決先は未束縛 |
| 標準 runtime／lib／SDK の集約値 | runtime `1771a83b…b054`、lib `cde278b4…45af`、sdk `ffe4ec33…cfa5`（HEADのbyte。`git diff --quiet upstream/main HEAD -- …` が終了0＝upstream と同一） | 観測のみ | 実行用 source commit 選定後に同値かを照合する必要 |
| `view`、`viewFiles`、`skippedPaths` | 未確定 | 未確定 | r3 view は存在しない。生成器 `g3/chain/make-view.py` は HEAD 先頭 `ec80bb8`（r2）を要求するため、移植前は r3 view を作れない |
| `eval`、`evalFiles` | 未確定 | 未確定 | r3 専用の独立 eval 領域が無い。作成・依存導入・実byteの記録が必要（ネットワークを伴う可能性あり） |
| `tool`、`toolFiles` | 未確定（現byteは DRAFT の `chainToolsObservedR2Pinned` に13件記録） | 未確定 | §3 のとおり chain ツールは r2 に固定されたまま。移植＋本人レビュー付き再登録が先 |
| state dump の内容hash・互換性 | 未確定 | 未確定（実行が必要） | この作業ツリーに `backtest/state` は **not found in files**。生成・ロード・genesis照合に Anvil 等の実行が必要（`G3-LOCK-R3-2026-10-08.md:34`） |
| 配布ZIP、観測器、CLI実効設定の束縛 | 未確定 | 未確定（実行が必要） | ZIP作成・コンテナ selftest は Docker、CLI 確認は認証を伴う |
| `scope`、`schema` | 契約上は人工専用の固定文字列のみ | 該当なし | §4 参照 |

## 3. chain ツールに残る r2 固定（現byteの行番号）

`g3/chain/` の実行物を検索した結果（`release-r2`／`ec80bb8`／`ascon-zeta-r2`／`g3-r2`／`/tmp/g3-chain` の出現行）。

| ファイル | SHA-256（先頭） | lock 登録 | 出現行 |
|---|---|---|---|
| `chain.py` | `afc0d444` | あり | 25, 33, 74, 153, 336 |
| `make-view.py` | `04812780` | あり | 3, 4, 8, 31 |
| `revision_audit.py` | `f2ff1258` | あり（TOOL_MANIFEST） | 5, 21, 32 |
| `malicious.mjs` | `dbad20a1` | あり | 4 |
| `g3-ref-chain.sh` | `b9e30d13` | あり | 9 |
| `test_chain.py` | `62c050f3` | あり | 56, 213 |
| `decide-budget-control.mjs` | `a5be42a2` | なし | 3, 17 |
| `timeout-control.mjs` | `8cf7fcc9` | なし | 3 |
| `test_revision_audit.py` | `a0bb991e` | なし | 143, 145 |
| `gates.py`、`revision_replay.mjs`、`revision_exchange.mjs`、`timeout-child.cjs` | — | gates／replay はあり、他はなし | 出現なし（ただし gates は chain から r2 配置を import するため、出現なし＝r3対応ではない） |

完全hashは DRAFT の `chainToolsObservedR2Pinned.files`。**これらは r3 の tool pin ではない。** 移植には上記ファイルの変更が必要で、本書の作業範囲外（変更していない）。

## 4. check.py を実入力に使わなかった理由と、実入力モードに必要なもの

`check.py` の語彙は人工専用である：`scope` は `synthetic-only / not G3 evidence`、`schema` は `synthetic-source-manifest-contract-v1` と完全一致しなければ FAIL（`check.py:9-10,77-82`）、最上位判定は `CONTRACT_OK_ON_SYNTHETIC` のみ、README も「実入力を認定するモードはない」と明記する（`g3/manifest-contract/README.md:23`）。実入力に人工 scope を付けて通せば偽の一致になり、付けなければ契約上 FAIL になる。どちらも実証拠の検査ではないため、**DRAFT に対して check.py を実行していない。**

実入力モードとして最低限必要なもの（提案。実装していない）：

1. 実入力専用の scope／schema／判定語（例：人工判定語と混ざらない名前）と、`g3Status: BLOCKED` の常時併記。
2. 期待値の出所：本人レビュー済みの期待集合ファイル（hash 付き）を入力にし、manifest 自身や実行時の現byteから期待値を作らない。
3. 宣言比較に加えて、ファイル実体の再ハッシュ、symlink・親子配置・共有書込先の実検査（現契約は「bytes not read」「symlinks not inspected」と明記、`check.py:180,213`）。
4. Git 実体照合：`head` が `absoluteGitDir` の実commitであること、候補treeが committed byte と作業byteで一致すること。
5. eval 側の実依存（node_modules の解決先、Node・tsx 実体）、state dump、ZIP、観測器の欄。
6. r2 参照拒否は現契約どおり維持（DRAFT は tool 欄を空にして r2 固定物を tool pin として載せていない）。

## 5. 生成した DRAFT

`g3/manifest-contract/r3-manifest.DRAFT.json`。HEAD の committed byte から計算し、作業byteとの一致を全件確認してから書き出した（生成スクリプトはリポジトリ外の一時領域に置いた）。契約の必須キーを持つが、未確定欄は `null` とし理由を `nullReason` に記した。`scope` は人工文字列ではなく「real-input DRAFT / not G3 evidence / not B07 closure」、`schema` は `r3-real-manifest-draft-v0`。**登録済み manifest ではなく、lock・TOOL_MANIFEST とは無関係の下書きである。**

## 6. 今回の実行記録

| 操作 | 結果 |
|---|---|
| 候補 tree の再計算（作業byte／HEAD byte の2経路）と lock 照合 | 3者一致 `a03da518…3dff` |
| 候補5ファイル `shasum -a 256` | lock の各値と一致 |
| lock `inputs` 47件・相手 tree 12件の再計算 | 全件一致 |
| `git diff --quiet upstream/main HEAD -- example/agents/runtime example/agents/lib sdk` | 終了0 |
| DRAFT 生成 | 終了0、source 部分集合109件、chain ツール13件 |
| `python3 -m unittest`（manifest-contract 内） | 33件 OK |
| `python3 -B mutation-check.py` | 全17変異を検出、元ファイル不変（人工契約の感度検査のみ） |
| `git diff --check` と新規2ファイルの `git diff --no-index --check` | §7 に記載 |

**未実行**：check.py の実入力適用、make-view、chain の dry-run／run、prestart、登録器、Anvil、Docker、バックテスト、ネットワーク、認証、モデル呼出、commit／push。

## 7. 空白差分検査

- `git diff --check`：終了0、出力なし（追跡ファイルの変更なし）。
- `git diff --no-index --check /dev/null <新規ファイル>`：本書と DRAFT の各1回、空白エラー出力なし（新規差分のため終了1）。

## 8. B07 で残る欄（まとめ）

オフラインで確定したのは候補識別（ID・dir・tree hash・5ファイル）と、既存 lock・相手 tree の現byte一致まで。**残る欄**：実行 source の commit／branch／Git参照／パス（選定とレビュー待ち）、source の必須ファイル集合（レビュー待ち）、view と除外一覧（生成器が r2 固定）、eval とその実依存（領域が無い）、tool pin（chain ツールが r2 固定のまま、移植と本人レビュー付き再登録が必要）、state dump の hash と互換性（Anvil 等での生成・ロードが必要）、ZIP・観測器・CLI 実効設定の束縛（Docker・認証が必要）。B07 は閉じていない。
