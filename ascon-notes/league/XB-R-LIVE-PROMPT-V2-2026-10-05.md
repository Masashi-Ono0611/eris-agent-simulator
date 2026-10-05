# xb-r-live ON smoke解析 / prompt v2 / 次回案

作業日: 2026-10-05 MYT（原runとseed監査のUTC日付は2026-10-04）。
対象: `livesmoke-xb-r-live-on` / F_ref / calm / 39101 / claude-cli:haiku。
この文書は初回前の[仕様](XB-R-LIVE-PILOT-2026-10-04.md)の未開始・seed未使用表記を更新する記録。
upstream-evalは読取のみ。計測・LLM・Docker・Anvil・フルnpm test・課金・commitは行わない。
鍵・`.env`には触れない。runtime/SDK/初期agentの修正も対象外。

## 1. 拒否の確定理由

一次資料run dir:
`/Users/masashi_mac_ssd/Developer/majisuke/ascon/.claude/worktrees/upstream-eval/runs/2026-10-04T15-41-46-294Z/`

- `agents/cand.llm.jsonl:3` のblock 1465、rawをJSON.parseしたexecutorTs **全文**を照合。
  17,751文字 / 338行、SHA256 `7763564572ac9fbe5a287c2a41b5c632b759e24b6656c6982edc747a80dd59d4`。
  3行目 `import type { AgentContext, AgentObservation } from "@eris/sdk";`、
  4–5行目は定数・funding helperのimport、7行目から `export type Params`、
  最終行は `export const decide = createLiveAgent(PARAMS);`。関数本体ではなくTSモジュール。
- **実ログ** `agents/cand.jsonl:241`（15:49:40.199Z、round 1465）:
  `revision rejected` / `compile failed: Cannot use import statement outside a module`。
- 全文への軽量再現: `parseRevision(JSON.parse(raw)).ok=true`、
  `findCheatcodeUsage(executorTs)=[]`、`compileExecutor(executorTs)` は実ログと同じ理由でfalse。
  `improve.ts`、`botMain.ts`、`evidence.ts`、`sdk/src/observation.ts` と初期agentは
  実行側upstream-evalと当作業側のバイト一致も確認した。
- 拒否経路: `botMain.ts` がJSON→parseRevision→prepareSource→compileExecutor。
  `improve.ts` は静的cheatcode検査後、`(async function decide(obs, ctx) { <source> })`
  をnode:vmのScriptで構文解析する。TSトランスパイルはしない。最初のimportで止まり、
  setSource/installedには到達していない。JSON型不備・安全違反・戻り値検証が今回の拒否原因ではない。

全文とv3との差分は、主に `BASES=["WETH","WBTC"]`→`["WETH"]`、未使用の診断用
DEV3A/DEV2定数の削除、コメント削除。これは変更の意図を示すが、importを消すだけでは
export/型構文・未解決helper/constants・performance/timers/structuredClone・戻り値/状態が残る。
未解決変数や関数を返すコードはコンパイルを通る場合もあり、実行時に例外/clone失敗となる。
この後続障害はコードから確認できる潜在問題であり、今回そこまで実行されたとは主張しない。
`return decide(obs,ctx)` は元モジュール呼出ではなくwrapperの再帰になる。

完了rawは5件（1345/1405/1465/1525/1585）、declined 4 / rejected 1 / installed 0。
`cand.cli-timing.jsonl`は約120秒間隔で**6件の開始**を記録（最後15:53:53.515Z）。
6件目の完了raw/outcomeは保存ログにないため正常cycleに数えない。5完了と6開始は区別する。
summaryは360 blocks / 362 loops、cand取引57 / revert0、cand P=-334.8364723、
P−noop=+145.7723743。G0 PASSは依頼の測定報告を引継ぐ（G0再実行はしない）。
正常cycleはdeclined 4件で3件以上だが、実変更の適用0件なので校正未成立、本体32世界は禁止のまま。

## 2. WBTC除外の判断: 意図と根拠を分ける

**確認できた意図:** Haikuはログの悪化を受けて、WBTC除外という局所変更をコードで試みた。
しかし「流動性不足」「1取引で195%スリッページ」「WETHは問題ない」はそのログから確定できない。
BASES削除はWBTC取引だけでなく `markets()` を通じた8% equity capの母数も変えるため、
WETHを不変に保つ純粋な最小変更でもない。

**反証となる実測ログ:** cand.jsonlのsubmitted hashをblocks.csvのownerId=candに結び、
events.jsonlのpost-run reconstructed observationから包含block前後の
`alphaValueUsdc`差分を計算した。全57 hashが対応、同じ包含blockのbaseが混在しないことを確認。
固定参照価格でのwallet変化なので市場価格移動を除き、gasを含む。WBTCは16件、WETHは41件。

| WBTC決定block | 包含block | 固定参照価格での資産増減 USDC |
|---:|---:|---:|
|1294|1295|+6.535385|
|1295|1296|+5.038473|
|1324|1325|-7.053525|
|1461|1462|+29.422300|
|1464|1465|+26.857292|
|1470|1471|+7.961145|
|1483|1484|-3.093345|
|1484|1485|-43.227527|
|1490|1491|-4.891121|
|1491|1492|-5.147640|
|1492|1493|-8.394506|
|1493|1494|-8.274829|
|1570|1571|+47.163150|
|1575|1576|+10.471848|
|1585|1586|+7.238560|
|1588|1589|+2.739307|
|**WBTC合計**|**16件**|**+63.344967**|

WETHの同定義合計は+82.427408、合計+145.772374でsummary.alphaUsdcと一致する。
これはこの世界での固定価格による帰属であり、実現損益、個別約定スリッページ、
base別の競技P、除外した場合の反実仮想効果や性能優位ではない。
block1461注文は4,141.437238 USDC、hash `0xdb61f53c593013601d44f38048c821c157c5270fe41d4af682fe7aa9623e2419`、
包含1462 / status success / gas107288 / priority283000000。-8,061.70の単発損失ではない。

**評価漏れは事実:** block1465のcontextでlive inventory.valueUsdcは48,679.882747。
これはUSDC+WETH+native ETHだけの値に一致する。保有0.45675528 WBTC × 59,214.60546324
=27,046.583698を加えると75,726.466446で、同blockのevents再構築値と一致する。
5回すべてのcontextで同じWBTC除外が確認できた。
`sdk/src/observation.ts` の `balanceToInventory(balances, fairPrice, stablePrices)` は
WETH価格1個しか渡さず、`sdk/src/pnl.ts` のnormalizePricesは `{WETH:...}` にするため
WBTCを `(p[sym] ?? 0)` で0評価する。一方evidence.tsの市場移動側はWBTC保有も数える。
この非対称な入力ではWBTCの購入支出が損失、売却収入が利益に見えてしまう。
該当sdk/src/pnl.tsも実行側とのバイト一致を確認済み。今回は診断のみで修正しない。

**markoutの混同も事実:** 問題の表示はdecision1461からincluded1462+3=1465までの
wallet markout。その間にもう一つのWBTC買い（decision1464 / included1465）がある。
合計支出8,068.290797 USDCが、評価漏れ下では約8千USDCの下落として見える。
1回のnotionalで割った195%を約定スリッページと呼べない。market.jsonの1461 WBTC
uniswap depthUsdは約596万、mid/fair差は約-85 bpsで、これも195%の約定証拠ではない。
正確なreceipt token delta/quoteによるslippage復元は未実施、流動性原因は未立証。

**結論:** 有益な変更をしようとした応答であることは確認できる。WBTCを除外すれば
有益だという判断は支持できない。v2にWBTC除外を固定せず、表示不整合/重複窓の検証を教える。
本分析の終了後ログを将来のモデルに渡してseedへ適合させず、promptには一般的な検証手順だけを入れる。

## 3. prompt v2と軽量検証

- body契約を冒頭に置き、v0がmoduleであるというgeneric captionとの相違を明示。
  コンパイル・実行可能な最小形式例、fundingのインライン実装、helper一覧、状態移行、
  ctxの実在interface、globals、失敗例、JSON/戻り値を機械的に確認できる構成。
- 形式例はnoopだけなので**単独適用禁止**。正常な改訂の代用品ではなく、全v3依存を保った
  実変更をモデルが生成できなければdeclineする。これは完成した売買用executorの配布ではない。
- canFund/WBTC dust、各leg実残高、gas reserve0.05 ETH、priority0禁止、net利益0.05、
  終端の利益0強制売り禁止、在庫帯/上限、revert/重複/状態リセット、禁止RPC、
  評価価格歪曲/自己取引/未来情報禁止の安全節は維持。安全を弱めてinstalledを得ない。
- 39101の数値や将来の成果をpromptへ埋め込まない。原agent.tsはv3バイト同一、
  SHA256 `78d8fa43156cee872e1bcbcaf86c1da00f1aa1646c6b210e7af4b499edea4d04`。
  frontmatter kind/name/model/60block間隔を維持、descriptionのみv2表示。
- 検証は `npm run typecheck` と
  `node --import tsx --test --test-concurrency=1 test/xb-r-live.test.ts test/improve.test.ts test/runtimeLlmCli.test.ts`。
  **tsc --noEmit PASS / 関連57 tests PASS（fail/skip 0、約6.36秒）**。
  frontmatter/v3同一性の既存テストを維持し、prompt内の実コード例のVM実行・状態保持、
  WBTC dust/残高境界、import構文拒否と実行時globalsエラーの区別を追加検証。
  CLI testはnode/mockだけで、モデル呼出なし。`git diff --check`もPASS。
  v3のgit objectとのバイト一致と、安全節の変更前後の完全一致を別途確認した。

残る限界: LLMによる実変更生成・installed後の安全/売買・gpt-oss:120bでの成立は未検証。
元runtimeの評価漏れは未修正。promptで誤帰属を警告できても、正しい過去のPnLを復元する
ことはできず、全declinedで止まる可能性もある。compile成功だけで成功認定しない。

## 4. 再スモーク案（未起動）

2026-10-04 **15:59:09 UTC**、main＋可視兄弟worktreeの `runs/**/index.tsv` と
`ascon-notes/eval/out/**/index.tsv` のseed列のみを監査: **50台帳592行**。
実績検索と併せて各treeのleague *.md/*.yaml/ledger.jsonlの予約表記も確認した。

| seed | 使用記録 | 予約/扱い |
|---|---|---|
|39101|1件、upstream-eval `ascon-notes/eval/out/livesmoke-xb-r-live-on/index.tsv:2`|使用済み。再利用しない|
|39102|0件|旧XB-R-AI-PILOTの追加p3校正候補、LIVE-PILOT §2で本パイロットに引継ぐ枠。今回のv2全長p1 ONへの用途変更案（実行・排他予約はしていない）|
|39103|0件|LIVE-PILOT §3の短縮150block smoke予約を保持。未使用だが未予約ではない|

未記録run/他担当の予約は否定できない。開始直前の再監査で競合があれば停止し、
別seedを自動割当しない。監査結果は開始許可・排他枠取得ではない。

提案: **calm / seed39102 / ON / F_ref / claude-cli:haiku / 60block cadence /
360 blocks・2秒・期待362 loops / p1 / 1世界**、label例 `livesmoke-xb-r-live-on-v2-39102`。
xa-1再スモーク終了と既存資源ゲートを実行担当が確認後、初期v3を維持し、変更はprompt v2のみ。
元runと同じF_ref相手/slot/資金/scorer/runner/CLI版をmanifestで照合し、agent/prompt/runtime/
SDK/rosterなどのhashを凍結する。原runのログ/モデル状態をresume・持越ししない。
鍵/.envを含めない実行snapshot、既存サブスク経路・追加課金なしを確認する既存手順を維持。
今回はそのsnapshot作成や起動はしない。upstream-evalには書かない。

**事前登録の条件は変更しない:** 正常改訂cycle≥3（installed/declined/reverted、rejected/skip除外）、
実コード変更のinstalled≥1と当該executorの正常実行/取引、G0 PASS・安全・取引成立。
noop-only/変更なしの再出力/オペレータが手で修理したコードを実改訂適用に数えない。
未達なら停止、本体32世界は起動しない。今回も本体を起動しない。

**応答の選別をしない運用:** 1 seed 1回。5応答のうち良いものだけを選んでreplayしたり、
同seedを成功が出るまで再走したりしない。開始/完了/declined/rejected/installed/timeoutを
raw/system/context/時刻とともにすべて保持。39101失敗も台帳に残す。中断/インフラ理由で
例外的な再走が別途指示された場合は、旧attemptを消さず、全attempt・理由・変更hashを記録し、
都合の良い結果への置換や独立seed扱いはしない。39102未達でも39103を自動消費しない。
