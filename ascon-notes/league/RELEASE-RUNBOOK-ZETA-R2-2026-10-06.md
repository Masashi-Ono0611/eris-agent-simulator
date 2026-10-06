# RELEASE RUNBOOK — S_cond / ascon-zeta-r2（2026-10-06 JST）

**10/6–14 JSTに監査・mix smoke・P60 dry run・最小G3・G4準備を進め、10/20施行版P60確認後の10/24–27初回提出、10/29受理照合を目標とする。現在は未READY。** 旧10/14提出目標は準備棚卸しへ変更する。10/20以降の比較可能なP60を必須とするため、10/14に全ゲート通過とは扱わない。 実行権限の根拠と保存証拠限定のC5/C6は [C-EXCEPTION-01](C-EXCEPTION-01-2026-10-06.md)。追加資格試験、新候補、AI性能研究は行わない。本書のコマンドは将来の実行手順であり、今回実行したものではない。

## 1. 根拠・固定対象・既知の阻害要因

読取根拠: [submission-checklist](../submission-checklist.md) A–F、[competition-start](../../docs/competition-start.md) §5/6/10、[MASTER](MASTER-PLAN-2026-10-04.md) §3.2/6/7/10、[bundleAgent.ts](../../scripts/bundleAgent.ts)、[Docker仕様](../../infra/docker-agent/README.md)と同ディレクトリのbuild/self-test/run-agent/Dockerfile、[agentSelftest.ts](../../scripts/agentSelftest.ts)、[ci-local.sh](../ci-local.sh)、[prepare-release.py](../release/prepare-release.py)と[証跡仕様](../release/README.md)、`example/agents/runtime/improve.ts` / `botMain.ts` / `llm.ts`、`scripts/genLocalConstants.ts`、`deployer/src/index.ts`、`core/src/cli/backtest.ts`、`config/scenarios/public.yaml`、`round-manifest.py`、`g0.py`。P60/G3/G4という内部ゲート名・最小設計はMASTER由来で、競技手順に独立した同名の節があるわけではない。

| 固定項目 | 値／状態 |
|---|---|
| candidate directory | `example/agents/ascon-zeta-r2`（改名・コピーによる別候補化なし） |
| 旧資格試験candidate commit | `b3b27c1daf6c7e10d5ecb962f72c7898e4afb421`（現在の提出treeとは異なる） |
| 現candidate tree SHA-256 | `153becef74bebb21acf8674191407ee941b2844a4cb4fa25716b111390eade59`、全5ファイル。今回読取再計算一致 |
| 旧Q-ZETA-02 tree / lock | `ddd7c718f2e9091c64b9949e277447868dd82347729d86f899b35dc89156786c`。`q-zeta-02-lock.json`と旧runtime aggregate `5eb1ae316e683c81336b465d654d700a62dce27949fbe3dfa81b11755f781055`は旧資格証跡として保持。現HEADに旧verifierを通すことはできない |
| release commit案 R | 読取時HEAD `b61f109e2b178b16569c4bdb76938ae078b0cb01`、branch `pr/upstream-integration-2`。league/v2＋upstream＋compat編集。PR #8 CI runningは本人提示、最新CI結果は未照会。最終Rを明示固定し、その正確なcommitでci-local --fullと後続証跡を取得する |
| upstream比較元 U | 統合済み `4057ea339f050373bdff92c961b71d015afaad3c`。現HEADとUの`sdk/src/constants.local.ts`差分なしを読取確認。10/20施行版の配布物との一致は未検証 |
| 例外の継承 | [C-EXCEPTION-01](C-EXCEPTION-01-2026-10-06.md) §7の2026-10-06本人「Go」。`launch.ts`のundefined balanceガード＋コメントの互換変更のみ。旧Q02の結果を新hashに再認定しない |
| prompt / model | `kind: improve`、`reviseEveryBlocks: 60`、`model:`なしを読取確認。解決順・運営既定値の未確認は§6 |
| host（本人提示） | AirはDocker/Colimaあり、release/selftest担当。miniにはDockerなし（process評価のみ可）。今回実機稼働・残資源は未確認 |

規約根拠は**本人セッションに保存された https://ascon.dev/rules の本文として今回提示された内容**（ネットワーク再取得なし）。提出は依存を含むagent ZIP＋フォーム経由の推論APIキー。規約にもupstream 4057ea3の`bundleAgent.ts`にも`--submission`は存在しない。公式生成コマンドは **`npm run bundle:agent -- ascon-zeta-r2`**。bundlerはidと`--out`のみを解釈し、未知フラグを拒否しないので未知フラグの成功を適合証拠にしない。ZIPはruntime/lib/sdk/自候補/必要artifactと依存宣言を同梱し、node_modulesを全同梱する方式ではない。依存解決と提出先での起動はG4で確認する。

規約§2.5／参加規約8-5は改訂を必須とし、`reviseEveryBlocks`既定60、推論なし設定は除外され得る。FROZENは内部比較専用で、提出設定に持ち込まない。本競技は**11/1–11/7、60 epochs**、regimeは独立抽選。内部stateはepochを跨いで持続し、永続領域は**64MiB**。epochのs/kは開始時に告知。`decide()`は**5000ms**、推論1callは**5分**（別の制限）。公開12 regime回帰と独立抽選の本番列を同一視しない。

適用規約は**10/11まで9/22版、10/12–19は9/28版、10/20から新改訂版**。10/20施行改訂は公開集合のscenario結果を変えるため、提出判断に使う比較可能なP60は10/20以降の適用版で取得する。日付だけで同等とせず規約版・配布commit・scenario/config hash・採点実装を束縛し、旧版dry runと成績を混ぜない。

着手前に解決・確認する点:

1. **Docker base install不整合は解消。** 現`Dockerfile.base`は`RUN npm ci --ignore-scripts`。本人提示では`eris-agent-base:local` build済み、tsx/esbuild/sdk-py動作確認済み。今回の再buildではなく、最終Rのimage digest・selftestは別途必要。
2. **C0/selftestは分離worktree経路で実施予定。** §7はスクリプト読取に基づく具体案で実走未検証。releaseの住所表を変更せず、別worktreeのローカル住所表差分を明記する。source selftestと同一ZIPの起動証拠を分ける。
3. **証跡とG3準備不足。** r2用roster・begin・公式CLI→G0 index・負荷baseline・制御ケースは未作成／未検証。実改訂安全性、epoch間state継続・64MiB境界も未検証。G3練習推論経路は`claude-cli:haiku`のsubscriptionのみ、本人のOllamaキーは使わない。
4. **旧lockとの不一致は予定された互換差分。** 旧verifierを改変してPASSにしない。新releaseの候補map/実行環境manifestを別に保存し、旧hash→新hashのlaunch.ts差分と§7の承認を対応付ける。それ以外の候補変更は例外継承対象外。
5. **外部条件は未検証。** 保存規約本文から形式不明の一律BLOCKEDは解除するが、運営の現在のモデル一覧・既定model・フォームUI・キー有効性・受理・10/20配布版は未照合。C例外§7の回収待ち状態が解除されずnoop継続となる既知リスクも残し、P60/G3で兆候があれば停止する。

## 2. 実行境界と予定（すべてJST・時間は見積）

今は本ランブック1件のみを更新し、それ以外を書かず、commit/push、simulation/Docker/network、`.env`/鍵読取をしない。以下のworktree・証跡・ZIP・configの作成は**将来の実行担当向け**で、今回の成果物ではない。

無人監督ができるのは、固定入力・権限・予算・host・監視が成立した検査と測定、証跡保存まで。本人操作はフォーム送信、鍵登録/変更、Usage/Billing確認・支払、外部問い合わせ判断。無人監督は未知フラグの受理判断・基準緩和・新hashへの例外拡張をしない。監督の実装/稼働も未確認。

通常**6h/日以下**、背景chunk **110分以下**、forward100hの実消化＋全残予約を精算してから開始。同一hostでmatrixとbuild/全テスト等のCPU負荷を重ねない。現在はPR #8 CI／他担当稼働中のためnpm testを含む重いjobを開始しない。最大p3は校正済みの場合のみ。本経路の公式P60は保守的にp1、両hostの世界を合算しない。給電・keep-awake、リース/heartbeat、開始余裕39.5GiB、途中25GB未満停止、G0/sleep/hash drift/未知失敗で次chunk停止。監視は60秒以下、検知2分/受領5分/次着手10分を既存MASTERから保持。自動再走なし。

| 手順・予定日 | host／担当 | 予約時間 | 前提・停止条件 | 証跡の保存先（将来） |
|---|---|---:|---|---|
| 0. 例外・115件・由来/安全監査、10/6–7 | Airまたはmini／監督 | 各日1–2h | C例外§7の新hash、旧Q02全60/G0/条件1–3（新hashの再認定なし）、規約§8・資金/退出ガードを点検。不一致/実害で停止 | `$EV/audit.md`, `open-items.tsv`, `budget.json` |
| 1. C0 release/eval worktree、10/7 | Air／監督 | 0.5h | R/U固定、tracked clean、未使用出力先。新release manifest/住所不一致なら停止 | `$EV/identity.txt`, `release-manifest.json`, `compat-diff.txt`, `c0.txt` |
| 2. typecheck/strategy/全テスト/ci-local、10/8 | Air／監督 | 1–1.5h | 他anvil/npm test停止、依存とlock一致。全非0停止、ci-local rc2はBLOCKED | `$EV/checks/*.log`, `*.exit` |
| 3. 暫定ZIP固定・mix smoke、10/8 | ZIPはAir release、smokeはAir eval／監督 | 0.2h＋0.87h（p3見積） | mix相手/hash/新seed/自機G0成立。未整備なら停止。p1なら約2.6hで再配分 | `$EV/zip.sha256`, `mix/`、evalのmanifests/runs |
| 4. P60 dry run、10/8–10 | Air eval推奨／監督 | 実行12–13h＋照合1hを目安 | frozen、公式60固定、全coverage/負荷G0。各chunk≤110分、日合計≤6h、失敗・遅延で停止 | `$EV/p60-dry-pre1020/`、evalの`runs/*`, `g0.json` |
| 5. 最小G3、10/11以降・日程再配分要 | Air eval／監督（本人が安全な推論経路を用意） | [g3/budget.json](g3/budget.json): 基本9.97h、準備/全件監査込み14–15h予約案 | dry run・実改訂適合・全費用/無料枠。実効model不明/ガード未証明/危険取引で停止 | `$EV/g3/`、適用/拒否/復帰・state履歴 |
| 6. build/selftest・ZIP起動、10/12–13 | Air独立SELF worktree／監督 | 1–2h（取得時間不明） | §7の分離構成・依存・chain成立。上限2 vCPU/4GB、非0/結果欠落/残存で停止 | `$EV/g4/build.log`, `selftest.json`, run一式、image digest |
| 7. scan/gitleaks/prepare-release/G4照合、10/13 | Air release／監督 | 1–2h | 同一ZIP・commitのG3/selftest・静的確認。正式P60前はREADY不可。exit3/不一致/秘密検出で停止 | `$EV/g4/`, `$EV/READY.txt`, `submission-record.md` |
| 8. 任意練習run、10/13（余裕枠） | Air release／監督、wallet/faucetは本人 | 0.5–1h＋着金待ち不明 | devnet専用wallet・安全な資格情報経路・C0、未資金/疎通不良は停止 | `$EV/practice/`（値を伏せた照合結果とtx証跡） |
| 9. 準備棚卸し、10/14（送信保留） | 本人ブラウザ／Masashi | 0.5h＋応答待ち不明 | 旧初回目標の棚卸し。10/20施行版P60前は未READY | `$EV/submission-record.md`, 受理メール参照 |
| 10. 提出判断用P60、10/20–22 | Air eval／監督 | 12–13h＋照合1h | 10/20施行版とR/U/scenario照合。変更時は影響ゲート再実施 | `$EV/p60/` |
| 11. G4再照合→初回F0・本人送信、10/23–27 | Air／監督、送信は本人 | 2–4h＋外部待ち | 同一R/ZIPの正式P60・G3・selftest・scan・prepare-release全成立 | `$EV/READY.txt`, `submission-record.md` |
| 12. F0最終確認→受理照合、10/28–29 | 本人 | 0.5h＋外部待ち | 遅延時は10/29提出へ退避、受理未確認を完了扱いしない | 同上 |

10/8はchecks＋mix＋P60最初の2 regime（約2.2h）で約4.8h、10/9と10/10は残り各5 regime（約5.4h）を基本案とする。1 regime×5seed≒65分に終了確認を足しても110分内か実測し、6hを超える見込みならその日の次chunkを開始しない。mix p3が未校正、ON遅延、Docker準備等で押した場合は日程を再見積し、10/14や10/29を理由に検査を削らない。p3版MASTERのP60 4.33hと公式直列12hは別見積。dry runまで全体20–24h程度に加え、10/20以降P60 13–14h＋再照合・準備/外部待ちを仮予約し、確定予算とはしない。

## 3. 手順0–2: 固定commitからclean releaseと検査

以下はbash例。`R`は提出に採用するcommit、`U`は照合した配布元commit。準備後にRを動かさない。新しいcommitが必要なら別記して検査し直す。

```bash
SRC=/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/upstream-2
R=b61f109e2b178b16569c4bdb76938ae078b0cb01
U=4057ea339f050373bdff92c961b71d015afaad3c
REL=/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-zeta-r2-20261007
EVAL=/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/eval-release-zeta-r2-20261007
EV=/private/tmp/ascon-release-evidence-zeta-r2-20261007
git -C "$SRC" worktree add --detach "$REL" "$R"
git -C "$SRC" worktree add --detach "$EVAL" "$R"
mkdir -p "$EV/checks" "$EV/p60" "$EV/p60-dry-pre1020" "$EV/g3" "$EV/g4"
cd "$REL"
git rev-parse HEAD > "$EV/identity.txt"
git status --short >> "$EV/identity.txt"
git diff b3b27c1daf6c7e10d5ecb962f72c7898e4afb421 "$R" -- example/agents/ascon-zeta-r2 > "$EV/compat-diff.txt"
git diff --exit-code "$U" -- sdk/src/constants.local.ts > "$EV/c0.txt"
NPM_CONFIG_IGNORE_SCRIPTS=true npm ci
```

上記Rは現時点案。PR #8 CI結果・最終採用commitの確認後に固定する。各行の終了コードを監督が保存して非0で止める。依存取得はネットワーク作業。deployer/dashboard依存やPython/Foundryもlockに従い準備する。`npm ci`系にはすべて`NPM_CONFIG_IGNORE_SCRIPTS=true`を付ける。現worktreeの未追跡`node_modules`をリリースのclean状態と混同しない。releaseで**backtest/run-matrix/run-league/gen:local-constantsを実行しない**。C0はclean statusだけでなくUとのbyte一致を必須にする。

全テストはCI同様forge成果物/Python依存を準備した独立exportかevalで行う。テストが生成するSDK/住所表をreleaseに持ち込まない。以下はevalで順次実行し、各ログと終了コードを保存する（pipeのtee成功だけを判定しない）。

```bash
cd "$EVAL"
NPM_CONFIG_IGNORE_SCRIPTS=true npm ci
NPM_CONFIG_IGNORE_SCRIPTS=true npm ci --prefix deployer
NPM_CONFIG_IGNORE_SCRIPTS=true npm ci --prefix dashboard
python3 -m venv "$EV/python"
"$EV/python/bin/python" -m pip install ./sdk-py -r sdk-py/requirements-dev.txt
npm run build:contracts > "$EV/checks/contracts.log" 2>&1
npm run typecheck > "$EV/checks/typecheck.log" 2>&1
npm run check:strategy > "$EV/checks/strategy.log" 2>&1
env PATH="$EV/python/bin:$PATH" npm test > "$EV/checks/full-tests.log" 2>&1
ASCON_CI_VENV="$EV/python" bash ascon-notes/ci-local.sh --ref "$R" --full --keep > "$EV/checks/ci-local-full.log" 2>&1
```

`ci-local`はtracked commitをクリーンexportし`env -i`、空き13GBのdf stub、lock一致のnode_modulesを使う。Python venvへのpip installとforge buildを行い、別anvil/全test稼働中・pgrep失敗ならrc2で停止。typecheck/strategyはこのscriptの代わりにならず、scriptもそれらを自動実行しない。rc0/全tests成功を確認する。今回これらは**未実行**。

## 4. 手順3: ZIPを先に封印し、mix smokeへ

P60前のbeginにZIP hashを束縛するため、**検査通過後に暫定ZIPを一度生成**する。これは提出READYではない。P60後は同じZIPを再検査し、再生成しない（zip時刻等でもdigestが変わり得る）。チェックリストの「P60→bundle」は、事前bundleへの証拠束縛が必要な実装との接続として、この事前生成＋事後検査の2段階で扱う。

```bash
cd "$REL"
npm run build:contracts > "$EV/g4/forge.log" 2>&1
npm run bundle:agent -- ascon-zeta-r2 > "$EV/g4/bundle.log" 2>&1
ZIP="$REL/bundle-ascon-zeta-r2.zip"
shasum -a 256 "$ZIP" > "$EV/zip.sha256"
unzip -t "$ZIP" > "$EV/g4/zip-test.txt"
unzip -p "$ZIP" sdk/src/constants.local.ts | shasum -a 256 > "$EV/g4/zip-address.sha256"
git show "$U:sdk/src/constants.local.ts" | shasum -a 256 > "$EV/g4/upstream-address.sha256"
cmp "$EV/g4/zip-address.sha256" "$EV/g4/upstream-address.sha256"
```

未同梱forge artifactはbundlerでWARNINGに留まるため、終了0でも必要artifactが欠ければ停止。ZIP内のcandidate/runtime/lib/sdkとRの対応・candidate hashを検査する。評価側は同一R・同一ZIP・同一候補を使い、評価用に変わる住所表のみC0の非提出差分として別記する。

P60開始前、G3前、selftest前後、送信前に同じ候補mapで照合する。旧`verify-q-zeta-02-lock.py`は現HEADも旧lockと同一であることを要求するため現releaseゲートには使わない。旧lockは保存し、新releaseのruntime/lib/sdk/runner/依存lock/必要artifactのpath→SHA256一覧をRから別途作成して実物・ZIPと対応付ける（住所表の評価側差分は明示除外、未準備）。候補は以下をrelease/eval/SELFで実行し、ZIP展開側は同じ方法で`agents/ascon-zeta-r2`を対象にする。

```bash
python3 -B - <<'PYHASH'
from pathlib import Path
import hashlib, json
root = Path('example/agents/ascon-zeta-r2')
files = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
         for p in sorted(root.rglob('*')) if p.is_file()}
assert set(files) == {'agent.ts', 'delta.ts', 'launch.ts', 'launchSwap.ts', 'prompt.md'}
digest = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
assert digest == '153becef74bebb21acf8674191407ee941b2844a4cb4fa25716b111390eade59'
print(json.dumps({'files': files, 'sha256': digest}, sort_keys=True))
PYHASH
git diff --exit-code "$R" -- example/agents/ascon-zeta-r2
shasum -a 256 -c "$EV/zip.sha256"
```

mixはMASTERのF_mix（固定相手10＋候補slot1＋noop）を使う。`fixed-bid-5gwei`等の存在/hash・ロスター適合が未確認であり、過去u1mを代用しない。候補idは **ascon-zeta-r2**（`cand`だけではprepare-releaseのexpected.agents条件を満たさない）。全員FROZEN、候補設定overrideなし。43001は予約案にすぎず、可視・remote使用台帳を監督が再照合して未使用なら採用、既使用なら起動前に別集合全体を登録。Qの47001–47005/診断48xxxを流用しない。

準備後の具体コマンド（`MIX_ROSTER`/`MIX_SEED`/`LOAD_BASELINE`は起動前固定、現在未設定）:

```bash
cd "$EVAL"
python3 -B ascon-notes/league/round-manifest.py begin release-r2-mix \
  --roster "$MIX_ROSTER" --regimes calm cex-drift informed-flow whale lending-incident crash depeg vuln spike depeg-persist cdp-incident launch \
  --seeds "$MIX_SEED" --parallel 3 --zip "$ZIP"
bash ascon-notes/league/run-league.sh --label release-r2-mix \
  --roster "$MIX_ROSTER" --regimes 'calm cex-drift informed-flow whale lending-incident crash depeg vuln spike depeg-persist cdp-incident launch' \
  --seeds "$MIX_SEED" --parallel 3 --base-port 8547
python3 -B ascon-notes/league/g0.py release-r2-mix --roster "$MIX_ROSTER" \
  --regimes calm cex-drift informed-flow whale lending-incident crash depeg vuln spike depeg-persist cdp-incident launch \
  --seeds "$MIX_SEED" --baseline "$LOAD_BASELINE" --manifest release-r2-mix --json > "$EV/mix-g0.json"
```

run-league→run-matrixは明示的に`--agent-sandbox process`を使う。miniでも可能だが資源制限の証拠ではない。約0.87hはp3校正時の計算値。mixの目的はG0・安全・執行で、順位から調整・候補選びを再開しない。

## 5. 手順4: public60の公式CLI・分割・G0証跡

公式集合は12 regime×5 seed **101,202,303,404,505**。P60はMASTERどおりFROZEN、公開回帰であり未使用holdoutではない。F_ref rosterを新設し、順番noop/multi-arb/clean-arb/ascon-zeta-r2、noopのみbaseline、wallet AUTO、dir=各id、各envのERIS_AGENT_FROZEN=1、ASCON_*_PARAMS/ERIS_LAUNCH_* overrideなし。Q rosterの`cand`を黙って証跡上でリネームせず、別ファイルとして開始前固定する。

公式CLIの一括形（**参考、6h/日・110分chunkのためこのまま無人起動しない**）:

```bash
npm run backtest -- --scenarios config/scenarios/public.yaml --agents "$P60_ROSTER" --agent-sandbox process
```

推奨hostはAir eval（Docker関連以外はminiも可）。process指定は資源保証をしない。DockerでP60を行う場合は先に全roster imageを同じ評価住所表でbuildし`--agent-sandbox docker`へ事前固定する。評価側buildは共通image tagを上書きするため、§7のSELF selftestで再buildし、そこで使った住所表とimage digestを記録する。途中のhost/sandbox切替はしない。

**予定分割**: dry runは10/8にcalm/cex-drift、10/9にinformed-flow/whale/lending-incident/crash/depeg、10/10にvuln/spike/depeg-persist/cdp-incident/launch。提出判断用は10/20・21・22に同じ2/5/5分割。以下の`release-r2-p60`／`$EV/p60/`は10/20施行版用とし、早期dry runでは全label/pathを`release-r2-p60-dry-pre1020`／`$EV/p60-dry-pre1020/`へ分ける。dry runのG0をprepare-releaseへ渡さない。10/20配布版でR/UやZIPが変わる場合は、ci-local --full・mix・G3・selftest等の影響確認と証跡再取得が済むまで停止し、旧ZIPの実績を新ZIPへ移さない。各regimeを5seedの小さな公式matrixにし、60組を起動前に全部登録する。1本約60–70分、12本約12–13h、照合1h。`--blocks`/`--seconds`短縮・`--repeat`増加なし。総合standingsは各小matrix順位の単純平均を使わず、60世界のPを正式採点で再集計する。

```bash
cd "$EVAL"
python3 -B ascon-notes/league/round-manifest.py begin release-r2-p60 \
  --roster "$P60_ROSTER" --regimes calm cex-drift informed-flow whale lending-incident crash depeg vuln spike depeg-persist cdp-incident launch \
  --seeds 101 202 303 404 505 --parallel 1 --zip "$ZIP"
```

各小matrixのYAMLは公式public.yamlのregimesを1個に絞り、同じ5seedを保持する。例として`$EV/p60/calm.yaml`は次の内容（全12本の元データ・hashも開始前保存）:

```yaml
regimes: [calm]
seeds: [101, 202, 303, 404, 505]
```

各日に予定したregimeだけを、監督が前chunkと日次残量を確認して次の形で実行する。

```bash
npm run backtest -- --scenarios "$EV/p60/calm.yaml" --agents "$P60_ROSTER" \
  --agent-sandbox process --port 8547 --state backtest/state > "$EV/p60/calm.log" 2>&1
```

各終了コード、開始/終了JST、公式CLIが出した`runs/matrix-*/matrix.json`/`standings.json`を一対一で記録する。`matrix.json`の`scenarios[].regime/seed/runDir/error`と実summary/run-startを照合して、全60行の **`ascon-notes/eval/out/release-r2-p60/index.tsv`**（`regime\tseed\trun_dir\texit_code`）を作る。`exit_code`は捕捉した実プロセス値であり成功を手書きしない。CLI終了0でもscenario.error、agents欠落、σ=0/部分採点があれば止める。全60のraw summary/blocks/events/market/intervals/agentログ、出力元matrixとindex生成の対応表を残す。現在この接続処理は未実装・未検証で、事前に読取fixtureで確認してから測定を解放する。

```bash
python3 -B ascon-notes/league/round-manifest.py verify release-r2-p60 > "$EV/p60/manifest-verify.json"
python3 -B ascon-notes/league/g0.py release-r2-p60 --roster "$P60_ROSTER" \
  --regimes calm cex-drift informed-flow whale lending-incident crash depeg vuln spike depeg-persist cdp-incident launch \
  --seeds 101 202 303 404 505 --baseline "$P60_LOAD_BASELINE" \
  --manifest release-r2-p60 --json > "$EV/p60/g0.json"
```

同場・同host・同並列度の適切な負荷baselineが必要。g0.pyはbaseline省略でも`absolute only`のPASSを出し得るので、それだけでMASTERの相対負荷G0を満たしたとしない。全予定、有限P、360blocks/362loops、failedReads/violations/timeout/早期終了0、p99<1000ms、被覆低下≤1pp/catch-up増加0を検査。C5/C6台帳も作り、115件を消さず新runの失敗を別記する。失敗/未完は救済再走・seed交換なしで停止。

## 6. 手順5: 最小G3（性能研究を再開しない）

**実行順・入力の正は [g3/schedule.tsv](g3/schedule.tsv)**、設計根拠は [G3-DESIGN](G3-DESIGN-ZETA-R2-2026-10-06.md)。通常36＋fault7＋状態3の計46世界。seed、regime、場、ON/OFF順、label、roster、host、並列度、port、s/kは各行から取得し、本書に別の集合・batchを定義しない。seedは予約台帳と開始直前照合し、衝突・監査不足なら停止して再登録判断へ戻す。自動seed交換・救済再走はしない。

費用は [g3/budget.json](g3/budget.json) のp1計画（基本約9.97h、準備/全件監査込み約14–15h予約案）。6h/日以下・chunk110分以下で日程を再配分し、後続G4との重複も解消してから予約する。実測最大×1.2＋全件監査時間で更新し、旧p3の2.6h枠は使わない。

各行の `gate` とprestartを確認し、BLOCKED／FAILなら開始しない。**非送信malicious先行検査がFAILならworld 1より前に中止**。必要条件成立後のコマンド形は `round-manifest.py begin` → `run-league.sh` → manifest verify／`g0.py`。1行ずつ `label`、`roster`、`regime`、`seed`、`parallel` を渡し、runnerには同じ行の `base_port`、`blocks`、`block_seconds` を渡す。schedule順に進め、毎行G0・全revision/action監査を完了する。TSVからの起動・集約・状態制御の監督配線は未検証であり、本書は実行可能な一括起動スクリプトではない。

候補1体、参照OFF、同一slot/入力。通常ON/OFFは独立世界の開始時にversion0へ戻し、相互に改訂コード/学習memoryを混ぜない。これは試験間隔離で、本番epoch間のreset指示ではない。状態試験はscheduleと `g3/state-plan.yaml` に従って専用state rootを継続し、64MiB永続領域とepoch開始s/k告知への対応を確認する。旧Q02のOFFだけで代用しない。

合格に必要な独立証拠:

- 提出model/実効提供版・prompt hash・既定60block間隔・API usage/待ち/retry/同時枠。正常cycle **3回以上**、提案/拒否/受理/実適用blockを区別する。全declined/nullだけでは実変更の試験にならない。
- 別の制御ケースで**実変更の適用と既知版への復帰**を確認し、改訂ごとの静的/型/安全検査 **100%**。returnとctx.submit両方で資金・サイズ・slippage・送信先等の境界を監査。
- 遅延、無効出力、枠切れ/429、到達不能と復帰、本番相当のepoch境界（state持続）で**危険取引0**。故障注入は通常36世界と別の証拠・費用とし、通常G0に混ぜない。
- offline fault fixtureとrosterは `g3/` に登録済み。ただしdelayed/change-revert用の監査済み自然Haiku実変更fixtureは欠落し、F_mixも未成立。scheduleのBLOCKEDを維持する。実runtimeの制御起動・監督は未検証であり、単体テストをG3 PASSにしない。

r2のfrontmatterは既に`kind: improve` / `name` / `description` / `reviseEveryBlocks: 60`を満たし、`model:`はない。`loadImproveAgent()`はmodelを`undefined`として返し、`botMain.ts`が **prompt.model → ERIS_LLM_MODEL → `gpt-oss:120b`** の順に解決する。これは4057ea3統合コードのfallbackであり、運営告知の本番defaultとの一致は未確認。告知一覧・運営envが不明な間は本番実効modelを確定しない。promptへ推測でmodel行を足さない。

練習G3はON roster/runtime環境の`ERIS_LLM_MODEL=claude-cli:haiku`を明示し、subscription経路だけを用いる。`llm.ts`はこのprefixでClaude CLIへ分岐する。本人のOllamaキーを読み込まず、引き渡さず、fallbackにも使わない。練習proxyを挟む場合もsubscription backendに限定し、認可済み配線・失敗時停止・使用量を確認する（未検証）。これは運営proxyへの本番キー登録・本番model試験の代替ではない。推論call timeout既定300000msとdecideの5000msを分けて記録する。

r2のpromptは既存PARAMSへの改訂を許すが、自然文の禁止事項だけでは機械的に拘束できない。標準runtimeで最小G3を満たせるか未検証。code/promptの修理が必要ならhashが変わるので自動続行しない。H1標準ON拒否・過去AI失敗をr2のG3 PASSともFAILとも読み替えない。

MASTERの**full G3**（F_mix全12×3、ON36/OFF36、各反復平均差≥−1T・最悪≥−3、基本5.2h）は最小G3と別。本提出は既定の最小G3経路であり、fullをPASSとは記録しない。S_condを資格済SやH/AI入口へ昇格させない。後日fullが必要なゲートを実施するなら別途費用と未使用集合を固定する。

## 7. 手順6–7: G4・2 vCPU/4GB・READY

Docker baseの`npm ci --ignore-scripts`対応は済んでいる。Airで最終Rのbuild・selftestを確認する。miniでは実施しない。`agentSelftest.ts`はRPCの`eth_blockNumber`を確認後、candidate/noopのteam imageを**実行worktreeのソースから再build**し、configを`localDeploy:true` / docker / segmentHours=0に上書きしてcoordinatorを起動する。`self-test.sh`は自身のrepo rootへcdするため、release側のwrapperを別cwdから呼んでも分離にはならない。ZIP入力オプションはなく、**ZIPそのもののselftestではない**。

**C0を保つ実行計画（将来実行・未検証）**:

1. AirのRELをRで固定し、§3–4の検査後に公式bundleを一度生成。`$EV/zip.sha256`とZIP内住所表hashを封印し、RELの住所表がUと一致することを確認する。ZIPは以後再生成しない。別worktree SELFを同じRで作る。SELFだけにchain/config/出力を作り、RELとnode_modules・SDK・backtest stateをsymlink共有しない。
2. 他担当とchain/port/container名/image tagの利用枠を確保する。`docker info`でAirを確認し、SELFに`.env*`/実キーをコピーしない。selftestは`loadEnvLocal()`を呼ぶため、存在する環境ファイルを読ませない構成を確認する。認可された最小環境から起動し、以下のローカルAnvilだけで既定テストアカウントを使う。G4の凍結起動では`ERIS_AGENT_FROZEN=1`とし、推論なし提出の適合証拠に転用しない（改訂は別G3）。
3. SELFのdeployerを`--keep-fresh`で実行し、全必要protocolのdeploy完了・deployments.json出力を待つ。途中でconstantsを生成しない。`gen:local-constants`は`DEPLOYMENTS_JSON`（未指定ならそのrepoのdeployer/deployments/deployments.json）を読み、**script所属repoのsdk/src/constants.local.tsへ固定書込み**する。SELFのnpm scriptを呼ぶことが隔離の要点。

```bash
SELF=/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/selftest-zeta-r2-20261012
git -C "$SRC" worktree add --detach "$SELF" "$R"
cd "$SELF"
NPM_CONFIG_IGNORE_SCRIPTS=true npm ci
NPM_CONFIG_IGNORE_SCRIPTS=true npm ci --prefix deployer
npm run build:contracts > "$EV/g4/self-contracts.log" 2>&1
# Airの専用Terminal 1、他runが停止しローカル8545を占有できる時だけ:
cd "$SELF/deployer"
npm run deploy -- --keep-fresh
# Terminal 2、上のdeploy完了後（同じSELF、同じR/EV/REL/ZIP変数）:
cd "$SELF"
DEPLOYMENTS_JSON="$SELF/deployer/deployments/deployments.json" \
  npm run gen:local-constants > "$EV/g4/local-constants.log" 2>&1
git diff -- sdk/src/constants.local.ts > "$EV/g4/self-address.diff"
shasum -a 256 sdk/src/constants.local.ts > "$EV/g4/self-address.sha256"
SELFTEST_CONFIG="$SELF/config/example.yaml"
ERIS_RPC_URL=http://127.0.0.1:8545 ERIS_AGENT_FROZEN=1 \
  ERIS_DOCKER_CPUS=2 ERIS_DOCKER_MEM=4g ERIS_SELFTEST_CONFIG="$SELFTEST_CONFIG" \
  npm run agent:selftest -- ascon-zeta-r2 > "$EV/g4/selftest.log" 2>&1
# 終了コードを直ちに保存し、非0なら以後を成功扱いしない。
shasum -a 256 -c "$EV/zip.sha256"
git -C "$REL" diff --exit-code "$U" -- sdk/src/constants.local.ts
git -C "$REL" diff --exit-code "$R" -- example/agents/ascon-zeta-r2 sdk example/agents/runtime example/agents/lib
git -C "$REL" status --short > "$EV/g4/release-status-after.txt"
```

deployerはAnvilを起動・維持する。使用portが空かない場合は他担当のchainをresetせず日程を移す。Air/Colimaからcontainer→RPCの到達経路が成立することも実走前に確認する（上のlocalhost指定だけでDocker到達を保証しない）。SELFの住所表はdeployされたchainと一致すればよく、Uの住所と同じである必要はない。chainのprotocol別住所・bytecode hash・deployments fingerprintを保存し、candidate/runtime/lib/sdk（**constants.local.tsのみ明示差分**）と必要artifactをREL/ZIP/SELFで比較する。その他の差分やartifact欠落は停止。自動生成物はRELへコピーしない。

4. 実runのsummary/blocks/eventsを保管し、candidate/noop双方の終了・残存containerなしを確認する。実行中の必要フィールドだけで**2 CPU、memory=4g、memory-swap=4g**を記録し、image ID/digestを保存する。SELF buildは共通`eris-agent:ascon-zeta-r2`/`noop`/base tagを更新するため、他runと同時buildしない。タグ名一致をrelease image一致としない。全inspect・環境dump禁止。137はpossible OOMで確定ではない。
5. 実行後、§4の候補map、RELのtracked clean/C0、`shasum -a 256 -c "$EV/zip.sha256"`を再確認する。ZIP内住所表hashも§4と同じ抽出で再照合し、before/afterが一致する記録を保存する。これで**release ZIP bytes不変＋同じ候補/runtimeのローカル住所表版selftest**を示す。RELを汚して戻す操作はない。

`$EV/g4/selftest.json`は成功時だけ実ログから生成する。手書きのPASSやplanned値は証拠にしない。`schema=ascon-selftest-v1`、`status=PASS`、`exit_code=0`、`command=agent:selftest`、`agent_id=ascon-zeta-r2`、実`commit`/`zip_sha256`/`stdout`に加え、少なくとも`execution_root`、`execution_commit`、`source_constants_sha256`、`release_constants_sha256`、`constants_diff_path`、`zip_unchanged`、`artifact_scope: source-with-local-constants`を添え、`commit`/`zip_sha256`を同じR/封印ZIPへ対応付ける。必須出力は`[3/3] PASS ascon-zeta-r2: completed the self-test at memory cap ...`と`Report: .../summary.json`、exit0、report実体。短いPASSは全scenario/peak memory/実改訂の保証ではない。

**同一ZIPの起動との区別・fallback**: 上記でC0と公式source selftestは接続できるが、標準selftestはZIPを読み込まないので「無改変ZIPを直接実行済み」とは記録しない。§7のscan後に同じZIPを隔離展開し、依存を`NPM_CONFIG_IGNORE_SCRIPTS=true npm install`で解決、解決lock/版を証跡として保存する（bundlerのroot packageにはlockがなく再解決差分があり得る）。ZIPの`agents/`はrepoの`example/agents/`と配置が違うため、起動adapterにはこのpath対応、`ERIS_AGENT_DIR`、view/state/log/RPCと必要artifactの対応が必要。未変更のZIP payloadからimageを作り、2 vCPU/4GB下でcoordinatorと接続する受入れ配線は**現時点未実装／未検証**。

無改変ZIPのローカル実行には、ZIPの住所表と一致するchain（住所だけでなくbytecode/初期状態も照合）が必要。そのchainが用意できない場合、別の展開コピーだけをローカル住所表へ差し替えて候補・runtime・依存の起動を検査できるが、これは**ローカル適合版の補助証拠**に留める。元ZIPは不変のまま保管し、G4の「同一ZIP起動」欄はBLOCKEDを維持する。fallbackは運営相当の住所/chainでの受入れ試験を準備するか、10/29まで延期してその証拠を取得すること。準備できなければ送信しない。`prepare-release`がschema上このenvelopeを受け付けても、ZIP実起動を独立に検証したことにはならない。

ZIPの検査・秘密スキャン（gitleaksのinstalled CLI/helpに合わせる。下記は`git`/`dir` subcommand対応版の形）:

```bash
python3 infra/submission/scan-submission.py "$ZIP" > "$EV/g4/submission-scan.txt" 2>&1
unzip -l "$ZIP" > "$EV/g4/zip-list.txt"
gitleaks git --redact --report-format json --report-path "$EV/g4/gitleaks-git.json" "$REL"
# zip-listで絶対path/..、重複名、symlink等を拒否してから新規の隔離先へ展開
mkdir "$EV/zip-inspect"
unzip -q "$ZIP" -d "$EV/zip-inspect"
gitleaks dir --redact --report-format json --report-path "$EV/g4/gitleaks-zip.json" "$EV/zip-inspect"
rg -l -i 'BEGIN .*PRIVATE KEY|api[_-]?key|authorization|secret' "$EV/zip-inspect" > "$EV/g4/secret-review-paths.txt"
```

`rg -l`は値を出さずファイル名だけ。runtimeの環境変数名等の正当参照と直書き秘密を安全に判別する。`.env*`/鍵らしきファイルがZIP一覧にあれば開かず停止・除外原因を調査。スキャンログにも鍵値を出さない。gitleaks未導入・コマンド非対応はBLOCKED、見つからないからPASSにしない。履歴スキャンもZIPスキャンも0件/exit0を証跡化する。submission scanは **0 BLOCK / ACCEPTかつexit0**、WARNは理由を全件記録。

ZIP内容は自候補＋runtime＋lib＋sdk＋必要artifact、agent.tsのみ（strategy.py同居なし）、decide、prompt frontmatter kind/name/description、自己完結importを照合。依存が他候補に出ないこと、既定値がbidMode=2/bidProfitShareBps=3000/gasPerSwap=140000・specialists有効であること、ASCON_*未設定で同じであることを既定値テスト/コードで確認。envなしは資格情報まで削除する意味ではない。5秒境界、canFund、資金予約、承認・回収・末尾送信・自前資産・規約§8は監査表に結び付ける。

最終照合は**コピー・書換え・再bundleをしない**:

```bash
python3 ascon-notes/release/prepare-release.py \
  --root "$REL" --source ascon-zeta-r2 --name ascon-zeta-r2 --verify-existing \
  --upstream-ref "$U" --backtest-evidence "$EV/p60/g0.json" \
  --selftest-evidence "$EV/g4/selftest.json" > "$EV/READY.txt" 2>&1
```

通常モードはsourceをcopyしenv参照/prompt nameを書き換えるため固定hashには使わない。`--verify-existing`は既存candidateとZIPを検査し、typecheck/strategy/scan/住所照合を実施、bundleを省略する。G0 JSONは`ascon-g0-v1`、status PASS、failed/blocked空、manifest_verified=trueとmanifest SHA256、公開12×5全予定とPASS全60行、expected.agentsにascon-zeta-r2、実R/ZIP hash一致が必要。selftest JSONも同じR/hashが必要。実際の`RELEASE READY`・exit0は必要条件であり、別欄のG3・同一ZIP起動なども全成立して初めてローカルREADY。静的だけはexit3、欠測/不一致はexit1で止める。G3、ci-local、秘密監査、運営適合はこのツールが自動証明しないため別欄で全て照合する。

## 8. 手順8–9: 練習・本人送信と10/28 F0

任意の練習runはC0 releaseから（実行権限・wallet/faucetがある時だけ）:

```bash
npx tsx ascon-notes/practice/check-practice.ts
npx tsx ascon-notes/practice/run-agent.ts ascon-zeta-r2
```

数十block、includedTxCount>0、submit_failedの集中なし、receipt/balance/gas/終了後nonceを必要な範囲で保存する。環境が保存しない値は別の認可済み読取collectorが必要で、上記コマンドだけで取得できるとはしない。devnet専用新規wallet、100 req/s（eth_call/estimateGas/getLogsは5倍）、禁止RPCなし。練習でAnvil既定鍵を使わない。gas/資産台帳の不足はC例外の台帳と対応させる。practiceはP60/G3/G4の代替ではない。

**初回送信前（10/24–27目標、遅延時10/29）の本人作業**: 技術証跡とC開示を見て、提出時点のOllamaキー登録・代表者メール一致・有効性・利用枠・model・Auto-reload Off/意図した残高を確認する。MASTERでは10/4の初回鍵登録は本人報告でresolved、再登録を無条件に要求しない。既登録と有効性・十分な枠の確認は別。足りなければ本人判断まで停止し、勝手に購入/上限変更しない。

チェックリストF0はZIP送信前に全確認を要求する。**10/14は準備棚卸し、10/20施行版P60→10/23 G4再照合→10/24–27初回前F0・本人送信**とし、10/28 JSTのdec-007/F0は最終再確認として維持する。初回前に未成立なら延期し、残作業と予算を再見積して10/29へ退避する。10/28は運営の告知model/defaultと登録providerの対応、概算360改訂（60epochs×各epochの改訂回数に依存し固定値ではない）の利用枠、疎通、鍵登録・利用上限・最終ZIPとの対応を本人が再確認。キー変更/失効なら本人再登録、クリップボード消去。キー値はチャット・ファイル・ログに保存せず、運営指定キー登録フォームだけへ本人が入力する。練習G3で本人のOllamaキーは使わない。

本人が [提出フォーム](https://forms.gle/97bxYQvh43GVAS4z9)へ同じZIPをアップロード。必要時の[鍵登録フォーム](https://forms.gle/yYHU9deG4JJ5RnJQ6)は別、同じ代表者メール。監督の自動送信なし。外部フォーム・1日5回・不受理の扱いは手元文書の記載で、提出時の現行版を確認する。

`$EV/submission-record.md`へ、C例外§6の旧資格試験開示と§7のGo／互換変更／新旧hashの区別、現candidate tree hash、R/U、ZIP SHA-256、全ゲート証跡、初回前F0確認日、送信JST、受理/不受理メール参照、最終受理版の対応を保存する。送信ボタン押下と受理は別。受理前は`S_cond（送信済み・受理未確認）`、受理後も`S_cond（受理済み）`。不受理の形式修理で候補hashが変わる場合は例外の自動継承を止める。

10/28最終確認→10/29最終受理照合目標→10/30予備→**10/31 23:59 JSTまでに最後に受理された意図した版を確認**。日程は受理保証ではない。期限対策として新候補・資格再走・AI性能研究を再開しない。

## 9. 今回の検証範囲

指定ランブック1件のみを既存構成に沿って更新。ソース/契約/lockは読取のみ。現候補5ファイルのhash、旧候補との差分がlaunch.tsの互換2行のみであること、Uとの住所表一致、bundle/selftest/local-deploy/model解決・証跡仕様を読取確認した。Docker base buildとtsx/esbuild/sdk-py動作は本人提示の検証済み事実で、今回の実行ではない。規約は本人提示の保存本文を使用した。

依存を含む新release manifest検証、typecheck、check:strategy、npm test、ci-local --full、mix/P60/G3、Docker/build/selftest、ZIP生成・scan・gitleaks・prepare-release、practiceは**今回未実行**。PR #8 CI結果、運営default/model・キー・現行フォーム受理、10/20配布版、分離SELFでの実走、同一ZIP受入れ配線は**未検証／該当ゲートBLOCKED**。commit/push、ネットワーク、`.env`/鍵読取は行っていない。本書を実行ログや提出可能証明として扱わない。
