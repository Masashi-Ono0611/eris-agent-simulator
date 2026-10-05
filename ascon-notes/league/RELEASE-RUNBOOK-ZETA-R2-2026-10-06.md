# RELEASE RUNBOOK — S_cond / ascon-zeta-r2（2026-10-06 JST）

**10/14 JSTの初回提出を目標に、固定r2を監査→mix smoke→初回P60→最小G3→G4→本人送信・受理確認へ進める。現在は未READY。** 実行権限の根拠と保存証拠限定のC5/C6は [C-EXCEPTION-01](C-EXCEPTION-01-2026-10-06.md)。追加資格試験、新候補、AI性能研究は行わない。本書のコマンドは将来の実行手順であり、今回実行したものではない。

## 1. 根拠・固定対象・既知の阻害要因

読取根拠: [submission-checklist](../submission-checklist.md) A–F、[competition-start](../../docs/competition-start.md) §5/6/10、[MASTER](MASTER-PLAN-2026-10-04.md) §3.2/6/7/10、[bundleAgent.ts](../../scripts/bundleAgent.ts)、[Docker仕様](../../infra/docker-agent/README.md)と同ディレクトリのbuild/self-test/run-agent/Dockerfile、[agentSelftest.ts](../../scripts/agentSelftest.ts)、[ci-local.sh](../ci-local.sh)、[prepare-release.py](../release/prepare-release.py)と[証跡仕様](../release/README.md)、`core/src/cli/backtest.ts`、`config/scenarios/public.yaml`、`round-manifest.py`、`g0.py`。P60/G3/G4という内部ゲート名・最小設計はMASTER由来で、競技手順に独立した同名の節があるわけではない。

| 固定項目 | 値／状態 |
|---|---|
| candidate directory | `example/agents/ascon-zeta-r2`（改名・コピーによる別候補化なし） |
| candidate commit | `b3b27c1daf6c7e10d5ecb962f72c7898e4afb421` |
| candidate tree SHA-256 | `ddd7c718f2e9091c64b9949e277447868dd82347729d86f899b35dc89156786c`、全5ファイル。今回読取再計算一致 |
| lock | `ascon-notes/league/q-zeta-02-lock.json`。runtime/evaluation aggregate `5eb1ae316e683c81336b465d654d700a62dce27949fbe3dfa81b11755f781055`、完全lock再検証は実行前 |
| release commit案 R | 現HEAD `2dac3a93f6fbde5d94fad7e0e4752a539ccf2918`。候補は上のcommitと同内容。提出までに採る実commitは明示固定し、変更時は影響検査と証跡再束縛。candidate commitとrelease commitを混同しない |
| upstream住所表比較元 U（ローカル参照） | `879c428f049ad765f56016f87867282dc12738b4`。RとUの`sdk/src/constants.local.ts`の差分なしを読取確認。最新運営配布版との一致は未検証 |
| host（本人提示） | AirはDocker/Colima稼働、miniにはDockerなし、両方backtest可。今回実機稼働・残資源は未確認 |

着手前に解決・確認する点:

1. **`--submission`未実装。** `bundleAgent.ts`は先頭id、`--out`だけを解釈し、単独`--`を除去する。未知フラグを拒否する分岐がないため、`npm run bundle:agent ascon-zeta-r2 -- --submission`は読取上「通常bundle相当」で、特別な提出形式を作らない。実行確認は未実施。正しい現行ローカル生成コマンドは `npm run bundle:agent -- ascon-zeta-r2`。最新規約・フォーム・配布実装との整合が取れるまで形式適合はBLOCKED。通常ZIPの受理を推定しない。
2. **Docker baseのinstall規則不整合。** `infra/docker-agent/Dockerfile.base`に`RUN npm ci`があり、`NPM_CONFIG_IGNORE_SCRIPTS=true`も`--ignore-scripts`も指定なし。team側は`--ignore-scripts`あり。ホスト側の環境変数を付けるだけではDockerのRUNへ伝播しない。別の実装作業でbaseへの適用・実commit固定・影響検証を済ませるまで標準build/selftestはBLOCKED。本書では修正しない。
3. **C0とselftestの接続条件。** selftestは`localDeploy:true`、local chainを要求する。READMEの`gen:local-constants`をrelease内で実行するとC0を壊す可能性がある。Uの住所表・bytecodeに一致するローカルsnapshot/chainとconfigを独立に用意できるか未検証。実現できるまでselftest BLOCKED。汚染した住所表でテスト後に戻して「同じZIPを検証済み」としない。
4. **証跡とG3の準備不足。** r2用P60/F_mix/G3 roster・begin・公式CLI出力→G0 indexの対応・同場負荷baseline・G3制御ケースは未作成／未検証。r2 promptには`model:`がなく、runtime実効modelの記録が必要。promptの文章だけでは改訂の機械的安全境界を証明しない。G3修理が候補hashを変えるなら例外継承なしで停止。
5. **外部条件は未検証。** 規約の適用版、許可model、形式、キー疎通、受理はネットワーク禁止により未確認。手元競技手順の時系列には「2件」、§10には「最後に受理された1件」の記述差があり、現在の1件経路をG4で現行規約と照合する。

## 2. 実行境界と予定（すべてJST・時間は見積）

今はこの2文書以外を書かず、commit/push、simulation/Docker/network、`.env`/鍵読取をしない。以下のworktree・証跡・ZIP・configの作成は**将来の実行担当向け**で、今回の成果物ではない。

無人監督ができるのは、固定入力・権限・予算・host・監視が成立した検査と測定、証跡保存まで。本人操作はフォーム送信、鍵登録/変更、Usage/Billing確認・支払、外部問い合わせ判断。無人監督は未知フラグの受理判断・基準緩和・新hashへの例外拡張をしない。監督の実装/稼働も未確認。

通常**6h/日以下**、背景chunk **110分以下**、forward100hの実消化＋全残予約を精算してから開始。同一hostでmatrixとbuild/全テスト等のCPU負荷を重ねない。最大p3は校正済みの場合のみ。本経路の公式P60は保守的にp1、両hostの世界を合算しない。給電・keep-awake、リース/heartbeat、開始余裕39.5GiB、途中25GB未満停止、G0/sleep/hash drift/未知失敗で次chunk停止。監視は60秒以下、検知2分/受領5分/次着手10分を既存MASTERから保持。自動再走なし。

| 手順・予定日 | host／担当 | 予約時間 | 前提・停止条件 | 証跡の保存先（将来） |
|---|---|---:|---|---|
| 0. 例外・115件・由来/安全監査、10/6–7 | Airまたはmini／監督 | 各日1–2h | C例外のhash、Q02全60/G0/条件1–3、規約§8・資金/退出ガードを点検。不一致/実害で停止 | `$EV/audit.md`, `open-items.tsv`, `budget.json` |
| 1. C0 release/eval worktree、10/7 | Air／監督 | 0.5h | R/U固定、tracked clean、未使用出力先。lock/住所不一致なら停止 | `$EV/identity.txt`, `lock.txt`, `c0.txt` |
| 2. typecheck/strategy/全テスト/ci-local、10/8 | Air／監督 | 1–1.5h | 他anvil/npm test停止、依存とlock一致。全非0停止、ci-local rc2はBLOCKED | `$EV/checks/*.log`, `*.exit` |
| 3. 暫定ZIP固定・mix smoke、10/8 | ZIPはAir release、smokeはAir eval／監督 | 0.2h＋0.87h（p3見積） | mix相手/hash/新seed/自機G0成立。未整備なら停止。p1なら約2.6hで再配分 | `$EV/zip.sha256`, `mix/`、evalのmanifests/runs |
| 4. 最初のP60、10/8–10 | Air eval推奨／監督 | 実行12–13h＋照合1hを目安 | frozen、公式60固定、全coverage/負荷G0。各chunk≤110分、日合計≤6h、失敗・遅延で停止 | `$EV/p60/`、evalの`runs/*`, `g0.json` |
| 5. 最小G3、10/11–12 | Air eval／監督（本人が安全な推論経路を用意） | 2.6h基本＋制御/照合1–2h | P60・実改訂適合・全費用/無料枠。実効model不明/ガード未証明/危険取引で停止 | `$EV/g3/`、適用/拒否/復帰・state履歴 |
| 6. build/selftest・ZIP起動、10/12–13 | Air releaseのみ／監督 | 1–2h（取得時間不明） | Docker install問題とC0 chain解決済み。上限2 vCPU/4GB、非0/結果欠落/残存で停止 | `$EV/g4/build.log`, `selftest.json`, run一式、image digest |
| 7. scan/gitleaks/prepare-release/G4照合、10/13 | Air release／監督 | 1–2h | 同一ZIP・commitのP60/G3/selftest、外部形式確認。exit3/不一致/秘密検出で停止 | `$EV/g4/`, `$EV/READY.txt`, `submission-record.md` |
| 8. 任意練習run、10/13（余裕枠） | Air release／監督、wallet/faucetは本人 | 0.5–1h＋着金待ち不明 | devnet専用wallet・安全な資格情報経路・C0、未資金/疎通不良は停止 | `$EV/practice/`（値を伏せた照合結果とtx証跡） |
| 9. 初回F0確認→本人フォーム送信・受理、10/14目標 | 本人ブラウザ／Masashi | 0.5h＋応答待ち不明 | 全技術ゲートと初回前の鍵/利用枠確認。未READY/不受理なら止める | `$EV/submission-record.md`, 受理メール参照 |

10/8はchecks＋mix＋P60最初の2 regime（約2.2h）で約4.8h、10/9と10/10は残り各5 regime（約5.4h）を基本案とする。1 regime×5seed≒65分に終了確認を足しても110分内か実測し、6hを超える見込みならその日の次chunkを開始しない。mix p3が未校正、ON遅延、Docker準備等で押した場合は日程を再見積し、10/14を理由に検査を削らない。p3版MASTERのP60 4.33hと公式直列12hは別見積。全体20–24h程度＋準備/外部待ちを仮予約し、確定予算とはしない。

## 3. 手順0–2: 固定commitからclean releaseと検査

以下はbash例。`R`は提出に採用するcommit、`U`は照合した配布元commit。準備後にRを動かさない。新しいcommitが必要なら別記して検査し直す。

```bash
SRC=/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/league-v2
R=2dac3a93f6fbde5d94fad7e0e4752a539ccf2918
U=879c428f049ad765f56016f87867282dc12738b4
REL=/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-zeta-r2-20261007
EVAL=/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/eval-release-zeta-r2-20261007
EV=/private/tmp/ascon-release-evidence-zeta-r2-20261007
git -C "$SRC" worktree add --detach "$REL" "$R"
git -C "$SRC" worktree add --detach "$EVAL" "$R"
mkdir -p "$EV/checks" "$EV/p60" "$EV/g3" "$EV/g4"
cd "$REL"
git rev-parse HEAD > "$EV/identity.txt"
git status --short >> "$EV/identity.txt"
python3 -B ascon-notes/eval/verify-q-zeta-02-lock.py > "$EV/lock.txt"
git diff --exit-code "$U" -- sdk/src/constants.local.ts > "$EV/c0.txt"
NPM_CONFIG_IGNORE_SCRIPTS=true npm ci
```

各行の終了コードを監督が保存して非0で止める。依存取得はネットワーク作業。deployer/dashboard依存やPython/Foundryもlockに従い準備する。`npm ci`系にはすべて`NPM_CONFIG_IGNORE_SCRIPTS=true`を付ける。現worktreeの未追跡`node_modules`をリリースのclean状態と混同しない。releaseで**backtest/run-matrix/run-league/gen:local-constantsを実行しない**。C0はclean statusだけでなくUとのbyte一致を必須にする。

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

P60の開始前、G3前、selftest前後、送信前に固定候補を同じ方式で照合する。以下のverifierは候補5ファイルに加え、lockに記載された参照・依存・runner・契約も照合する（候補の名前/個数の増減も拒否）。ZIP側は`agents/ascon-zeta-r2/`以下の同5ファイルを取り出して同じmapで照合し、ZIP全体digestとは区別する。

```bash
python3 -B ascon-notes/eval/verify-q-zeta-02-lock.py
git diff --exit-code "$R" -- example/agents/ascon-zeta-r2
shasum -a 256 "$ZIP"
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

公式集合は12 regime×5 seed **101,202,303,404,505**。初回P60はMASTERどおりFROZEN、公開回帰であり未使用holdoutではない。F_ref rosterを新設し、順番noop/multi-arb/clean-arb/ascon-zeta-r2、noopのみbaseline、wallet AUTO、dir=各id、各envのERIS_AGENT_FROZEN=1、ASCON_*_PARAMS/ERIS_LAUNCH_* overrideなし。Q rosterの`cand`を黙って証跡上でリネームせず、別ファイルとして開始前固定する。

公式CLIの一括形（**参考、6h/日・110分chunkのためこのまま無人起動しない**）:

```bash
npm run backtest -- --scenarios config/scenarios/public.yaml --agents "$P60_ROSTER" --agent-sandbox process
```

推奨hostはAir eval（Docker関連以外はminiも可）。process指定は資源保証をしない。DockerでP60を行う場合は先に全roster imageを同じ評価住所表でbuildし`--agent-sandbox docker`へ事前固定する。Airのrelease image tagを評価側buildで上書きしたらrelease selftest前に必ず再build/digest照合。途中のhost/sandbox切替はしない。

**予定分割**: 10/8にcalm/cex-drift、10/9にinformed-flow/whale/lending-incident/crash/depeg、10/10にvuln/spike/depeg-persist/cdp-incident/launch。各regimeを5seedの小さな公式matrixにし、60組を起動前に全部登録する。1本約60–70分、12本約12–13h、照合1h。`--blocks`/`--seconds`短縮・`--repeat`増加なし。総合standingsは各小matrix順位の単純平均を使わず、60世界のPを正式採点で再集計する。

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

**最小設計**: MASTERのcalm/crash/depeg × 未使用50001–50003 × F_ref/F_mix × ON/OFF = 36世界。seedは予約台帳と開始直前照合し、既使用なら結果を見る前に新集合全体を登録。候補1体、参照OFF、同一slot/入力、ON/OFFは別世界で順序交互。p3が成立すれば基本2.6h、ON実測最大batch×1.2で再見積し、障害ケース・検査1–2hを別予約。全runにbegin/終了G0、epoch開始version0、前epochの改訂コード/学習memoryを持ち越さない。旧Q02のOFFだけで代用しない。

使用コマンドは前節と同じ`round-manifest.py begin`→`run-league.sh`→`g0.py`。ON/OFF×場ごとに独立label/rosterで固定する。例（3×3=9世界、4セルで36世界）:

```bash
python3 -B ascon-notes/league/round-manifest.py begin release-r2-g3-ref-on \
  --roster "$G3_REF_ON_ROSTER" --regimes calm crash depeg --seeds 50001 50002 50003 --parallel 3 --zip "$ZIP"
bash ascon-notes/league/run-league.sh --label release-r2-g3-ref-on \
  --roster "$G3_REF_ON_ROSTER" --regimes 'calm crash depeg' --seeds '50001 50002 50003' --parallel 3 --base-port 8547
```

残りref-off/mix-on/mix-offも同形。これはコマンド形で、上の順にON全量→OFF全量を実行する指示ではない。開始前に交互batchの子label/manifest・集約表を固定し、既存labelへの追記・再利用をしない。現行runnerは1roster/呼出しのため、交互実行の監督配線は準備が必要。

合格に必要な独立証拠:

- 提出model/実効提供版・prompt hash・既定60block間隔・API usage/待ち/retry/同時枠。正常cycle **3回以上**、提案/拒否/受理/実適用blockを区別する。全declined/nullだけでは実変更の試験にならない。
- 別の制御ケースで**実変更の適用と既知版への復帰**を確認し、改訂ごとの静的/型/安全検査 **100%**。returnとctx.submit両方で資金・サイズ・slippage・送信先等の境界を監査。
- 遅延、無効出力、枠切れ/429、到達不能と復帰、epoch resetで**危険取引0**。故障注入は通常36世界と別の証拠・費用とし、通常G0に混ぜない。
- fault用fixture/proxy/制御起動コマンドは現時点で固定されていない。存在しない`g3` CLIや架空のPASSを作らない。安全なcredential loader/proxy、制御仕様・コマンド・監督が揃うまでG3 BLOCKED。

r2のpromptは既存PARAMSへの改訂を許すが、自然文の禁止事項だけでは機械的に拘束できない。標準runtimeで最小G3を満たせるか未検証。code/promptの修理が必要ならhashが変わるので自動続行しない。H1標準ON拒否・過去AI失敗をr2のG3 PASSともFAILとも読み替えない。

MASTERの**full G3**（F_mix全12×3、ON36/OFF36、各反復平均差≥−1T・最悪≥−3、基本5.2h）は最小G3と別。10/14初回は既定の最小G3経路であり、fullをPASSとは記録しない。S_condを資格済SやH/AI入口へ昇格させない。後日fullが必要なゲートを実施するなら別途費用と未使用集合を固定する。

## 7. 手順6–7: G4・2 vCPU/4GB・READY

Docker base install問題とC0 chainが解決済みであることが先。AirのColima稼働は本人情報であり、実行時は`docker info`で確認する（環境全体やcredentialをdumpしない）。以下はrelease内で実行する。

```bash
cd "$REL"
git diff --exit-code "$U" -- sdk/src/constants.local.ts
NPM_CONFIG_IGNORE_SCRIPTS=true npm run agent:build -- team ascon-zeta-r2 > "$EV/g4/build.log" 2>&1
ERIS_DOCKER_CPUS=2 ERIS_DOCKER_MEM=4g ERIS_SELFTEST_CONFIG="$SELFTEST_CONFIG" \
  npm run agent:selftest -- ascon-zeta-r2 > "$EV/g4/selftest.log" 2>&1
```

`SELFTEST_CONFIG`はUの住所・protocol bytecodeと一致するローカルchainを指す確認済みconfig。RPC/資金は安全なランタイム経路で供給し、秘密値を記録しない。selftestはcandidateとnoopを再buildしてrunし、結果summaryとcontainer消滅まで検査する。**2 CPU、memory=4g、memory-swap=4g**をdocker inspectの必要フィールドだけで確認して保存する。全inspectや環境変数のdump禁止。終了137はpossible OOMでありそれだけでOOM確定ではない。短いselftest PASSは全scenario/peak memory保証ではない。

自己申告でなく実終了コードと出力を捕捉し、実行前後R/ZIP hash/candidate/C0/image digest一致を照合して `$EV/g4/selftest.json` を作る:

```json
{
  "schema": "ascon-selftest-v1",
  "status": "PASS",
  "exit_code": 0,
  "command": "agent:selftest",
  "agent_id": "ascon-zeta-r2",
  "commit": "<実release commit>",
  "zip_sha256": "<実ZIP SHA-256>",
  "stdout": "<実際の出力全文。値の代入前は証拠ではない>"
}
```

必須出力は`[3/3] PASS ascon-zeta-r2: completed the self-test at memory cap ...`と`Report: .../summary.json`。report実体、blocks、events、image digestを一緒に保管する。selftestはZIPを直接起動しないので、別途安全に展開した**同一ZIP**から依存準備・同じ制限下の起動を確認し、source imageとのcandidate/runtime/sdk/lib/artifact一致を記録する。ZIPからの受入れイメージ化の配線も未検証。`prepare-release`だけでZIP実起動済みとは言わない。

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

通常モードはsourceをcopyしenv参照/prompt nameを書き換えるため固定hashには使わない。`--verify-existing`は既存candidateとZIPを検査し、typecheck/strategy/scan/住所照合を実施、bundleを省略する。G0 JSONは`ascon-g0-v1`、status PASS、failed/blocked空、manifest_verified=trueとmanifest SHA256、公開12×5全予定とPASS全60行、expected.agentsにascon-zeta-r2、実R/ZIP hash一致が必要。selftest JSONも同じR/hashが必要。実際に`RELEASE READY`・exit0を得て初めてローカルREADY。静的だけはexit3、欠測/不一致はexit1で止める。G3、ci-local、秘密監査、運営適合はこのツールが自動証明しないため別欄で全て照合する。

## 8. 手順8–9: 練習・本人送信と10/28 F0

任意の練習runはC0 releaseから（実行権限・wallet/faucetがある時だけ）:

```bash
npx tsx ascon-notes/practice/check-practice.ts
npx tsx ascon-notes/practice/run-agent.ts ascon-zeta-r2
```

数十block、includedTxCount>0、submit_failedの集中なし、receipt/balance/gas/終了後nonceを必要な範囲で保存する。環境が保存しない値は別の認可済み読取collectorが必要で、上記コマンドだけで取得できるとはしない。devnet専用新規wallet、100 req/s（eth_call/estimateGas/getLogsは5倍）、禁止RPCなし。練習でAnvil既定鍵を使わない。gas/資産台帳の不足はC例外の台帳と対応させる。practiceはP60/G3/G4の代替ではない。

**10/14前の本人作業**: 技術証跡とC開示を見て、提出時点のOllamaキー登録・代表者メール一致・有効性・利用枠・model・Auto-reload Off/意図した残高を確認する。MASTERでは10/4の初回鍵登録は本人報告でresolved、再登録を無条件に要求しない。既登録と有効性・十分な枠の確認は別。足りなければ本人判断まで停止し、勝手に購入/上限変更しない。

チェックリストF0は「ZIP送信前に全部」と要求するため、**10/28まで全確認を先送りして10/14に送ることはしない**。10/14の初回前にも必要な現時点確認を済ませ、**10/28 JSTのdec-007/F0は最終再確認として維持**する。初回前に未成立なら10/14目標を延期する。10/28はOllama Cloudモデル一覧、約360改訂の利用枠見積、疎通、鍵登録・利用上限・最終ZIPとの対応を本人が再確認。キー変更/失効なら本人再登録、クリップボード消去。値はチャット・ファイル・提出フォームに保存しない。

本人が [提出フォーム](https://forms.gle/97bxYQvh43GVAS4z9)へ同じZIPをアップロード。必要時の[鍵登録フォーム](https://forms.gle/yYHU9deG4JJ5RnJQ6)は別、同じ代表者メール。監督の自動送信なし。外部フォーム・1日5回・不受理の扱いは手元文書の記載で、提出時の現行版を確認する。

`$EV/submission-record.md`へ、C例外§6の開示文、candidate tree hash、R/U、ZIP SHA-256、全ゲート証跡、初回前F0確認日、送信JST、受理/不受理メール参照、最終受理版の対応を保存する。送信ボタン押下と受理は別。受理前は`S_cond（送信済み・受理未確認）`、受理後も`S_cond（受理済み）`。不受理の形式修理で候補hashが変わる場合は例外の自動継承を止める。

10/28最終確認→10/29最終受理照合目標→10/30予備→**10/31 23:59 JSTまでに最後に受理された意図した版を確認**。日程は受理保証ではない。期限対策として新候補・資格再走・AI性能研究を再開しない。

## 9. 今回の検証範囲

指定の2文書のみ新規作成。ソース/契約/lockは読取のみ。候補hash・候補commitとの差分・ローカルupstream住所表一致・スクリプトの引数/証跡仕様は読取確認した。依存を含むlock全検査、typecheck、check:strategy、全test、ci-local、mix/P60/G3、Docker/build/selftest、ZIP生成・scan・gitleaks・prepare-release、practice、現行外部規約・model・鍵・フォーム受理は**未実行／未検証**。この文書を実行ログや提出可能証明として扱わない。
