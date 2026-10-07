# 計測運用の再発防止（2026-10-06）

本日の観測は依頼者の報告と参照スクリプトによる。今回、実計測は行っていない。

## 固定テンプレート

`remote/chain-template.sh` は Bash 3.2 用。`REG` ループ、番号、ラベルを sed で編集して再開しない。次の表を固定し、選択だけを引数で渡す。

| chunk | regimes |
|---|---|
| 1 | calm cex-drift informed-flow |
| 2 | whale lending-incident crash |
| 3 | depeg vuln spike |
| 4 | depeg-persist cdp-incident launch |

```bash
bash ascon-notes/league/remote/chain-template.sh \
  --repo "$HOME/ascon-run/p60" \
  --roster /absolute/path/roster-fref-p60-r3.yaml \
  --prefix "p60-$(date -u +%Y%m%dT%H%M%SZ)" \
  --seeds "62001 62002 62003 62004 62005" \
  --chunks "1 3 4" --dry-run
```

全4群は選択指定なし。連続範囲なら `--from 2 --to 4`。同時指定・重複・範囲外は拒否する。上例の部分選択は操作例であり60世界の資格完了を意味しない。実行時は dry-run を外し、ホストの負荷を止めて `--activity-note '停止した常駐ジョブ、同居プロセス、時刻'` を必ず指定する。秘密情報は引数・メモに書かない。

`--prefix` は試行ごとに一意とし、UTC時刻を含める。同秒起動なら接尾辞も変える。ラベルは `<prefix>-c1` 等。全選択ラベルの manifest (`ascon-notes/league/manifests/<label>.json`)・出力先 (`ascon-notes/eval/out/<label>`) を事前検査する。既存物があれば、途中の群も含め一切起動しない。ログ先の再利用も拒否する。新しいprefixは同じ世界の再試行を許可するものではない。

## 事前確認と記録

1. **容量**: repo と `${TMPDIR:-/tmp}` の空きGB（実装上GiB）と有効 `MIN_FREE_GB` を表示。既定40 GB未満は拒否し、25 GBは絶対下限。25〜39 GBでの開始には `--min-free-gb 25` 等を明示し、逸脱としてログに残す。環境からの暗黙の `MIN_FREE_GB` は拒否する。各chunkでも再確認し、matrix自身の容量監視も維持する。ログ先を別ボリュームにした場合、その空きも人が確認する。依頼者報告ではファイル削除後も空き容量が変わらず、Time Machineのローカルsnapshotが存在した。APFS snapshotによるブロック保持が容量未回復の原因という説明は推論であり、因果関係は未確認。削除後も実際の `df` を再確認する。
2. **ホスト占有**: `pgrep -x anvil` が検出・失敗したら拒否。`mkdir` ロックを取得し、EXIT/INT/TERM/HUPで所有ロックだけを解放する。既定は `${TMPDIR:-/tmp}/ascon-measurement-host.lock`。全ユーザー・他キューを含め同一ホストでは同じ `--lock-dir` に統一し、既存queueの `host.lock` とも調整する。このテンプレートを使わない処理はロックで止まらない。ロック親は事前作成。SIGKILL/電源断後は残留ロックを自動削除せず、プロセス不在と記録を人が確認する。
3. **CPU負荷**: 計測中は同一ホストでcodex jobs、npm ci、builds、ci-local等を走らせない。予約ジョブも停止し、開始時の同居状況をactivity-note、途中の変化を運用記録に残す。コマンドライン全体や環境のdumpは秘密を含み得るので収集しない。依頼者報告では、Airで他作業と同時にloopIterations 359–361（期待362）のG0 FAILが発生し、miniでは同様の失敗は報告されていない。他作業との関連は報告に基づく推論であり、同時発生だけでは因果関係は証明されず、今回の再現確認も行っていない。pgrepだけではCPU占有を保証しない。
4. **state**: upstream統合後は旧dumpを流用せず再生成する。HEAD、Anvilバージョン、dump生成時点・hashを記録し、LQTYStakingが0でないことと対応するdeploymentを確認してから開始する。0拒否を再試行で回避しない。自動再生成はしない。計測中のコード、roster、state、HEADは固定する（commitやcheckoutも禁止）。manifestはstate dumpまで束縛しないので別途記録が必要。
5. **環境差**: `env -i` 起動ではclaude CLIのKeychainログイン用に `USER="$USER"` を明示して渡す。鍵をexport/表示しない。依頼者報告の観測は、Colima利用時に `/private/tmp` のmount失敗メッセージが出たこと。共有設定が原因という説明は推論であり、Colima一般の制約とは未確認。コンテナ利用時は当該ホストの共有設定を確認し、共有可能な `$HOME/ascon-run` 等を使う。今回のdry-run/試験用tempはmountしない。GNU/BSD `diff` のディレクトリ出力順には依存せず、ファイル別比較か構造化比較を行う。
6. **集計**: 既存summaryのagent id `cand` 固定を信用しない。rosterのidとディレクトリ名を区別し、集計を変更する際は `--agent-id` 等で明示入力し、存在確認する。今回は集計コードを変更しない。

## G0、再開、完了

各chunkは manifest begin → matrix → manifest verify → G0。パイプで終了コードを隠さず、各出力を保存する。G0 FAILは既定で停止。`--mode diagnostic --continue-on-g0-fail` の組だけが次の**未実行chunk**へ進む。FAILは保存され、最後の終了コードも1のまま。BLOCKED、実行エラー、manifest不一致は診断でも停止する。

世界集合につき一試行。G0 FAIL世界を黙って再実行しない。診断の再開では以前の世界一覧・失敗・中断地点を照合し、未着手chunkのみ新prefixで選ぶ。部分実行chunkを丸ごと再投入しない。意図的な追試は元の失敗と結び付けて別の診断として事前登録し、資格記録の置換に使わない。資格試験は同一ホストで事前に世界集合を固定し、失敗を除外して合格集合を作らない。異常・中断後は適用する資格契約に従い再設計・事前登録するまで資格再開しない。スクリプトはprefixを跨ぐ世界の重複を自動判定しないため、この照合は操作者の責務。

実行ログは `--log-root`（既定 `${TMPDIR:-/tmp}/ascon-chain-logs`）配下のprefix専用ディレクトリに保存する。永続保存にはrepo外の永続ディレクトリを指定する。`chain.log` は初回を含む容量確認・activity/逸脱/判定、`*-begin/run/verify/g0.log` は各コマンドの全出力。終了時に標準出力・chain.log・`end.marker` に `CHAIN_END_<runid>=<rc>` を書く。ランチャーの「background完了」は計測完了ではない。対応するend.markerと全chunkのG0記録を確認する。markerなしは完了未確認。実行モードではロック取得・runディレクトリ作成後に初回容量/Anvil確認を行い、その拒否もchain.logとend.markerに残す。それ以前のpreflight拒否はrunディレクトリを作らず、STOPは標準エラー、終了markerは標準出力のみ（引数不正はmarkerを出せない場合がある）。dry-runは正確なargv・リダイレクトを表示するだけで、計測・ロック取得・ログ作成・成功marker発行をしない。

## オフライン検証

`/bin/bash -n remote/chain-template.sh` と `python3 -B remote/test_chain_template.py` をこのleagueディレクトリから実行する。試験はtemp内のスタブのみ使用する。赤対照は既存manifest/出力、容量24 GB、既定40 GB未満、roster欠落、ロック保持、Anvil検出、診断以外のG0継続等。G0停止/診断継続、非ゼロ終了、ロック解放、marker、引数ごとのSTOP理由、固定群、初回DISK行のchain.log記録も検証する。dfスタブの空出力/非数値、pgrep rc=2/3/127/255、G0 rc=0なのにPASS行なしを拒否する。該当する3つのガードをtempコピーで個別に無効化し、同じテストの失敗（計7ケース）を確認してからコピーを復元し、再度PASSを確認する。容量注入 `CHAIN_TEST_MODE=1 CHAIN_TEST_FREE_GB=24` はdry-run限定で、実行モードでは拒否する。

実ホスト占有、実際のdump再生成・LQTYStaking、matrix/G0本体との実計測、SSH、Colima/Docker、Keychainログイン、APFS容量回復は今回未検証。特にsnapshotと容量未回復、AirのG0失敗と同時作業、Colimaのmount失敗と共有設定の因果関係は、依頼者報告からの推論に留まり未検証。

### このworktreeでの結果

| 検査 | 結果 |
|---|---|
| Bash 3.2構文、shellcheck | PASS |
| dry-runのargv・固定群・範囲指定・副作用なし | PASS |
| 赤対照: 既存manifest / 出力、25 GB未満、roster欠落、保持中ロック | PASS（拒否を確認） |
| その他の赤対照、スタブG0停止/継続・終了コード・marker・ロック解放 | PASS（合計26テスト。tempコピーの3変異で計7ケースの失敗と復元後PASSを確認） |
| `git diff --check` | PASS |
| `npm run typecheck` | PASS（今回の再確認はexit 0。前回の `tsc: command not found` は再現せず） |

依存導入は行っていない。シミュレーション、ネットワーク、SSH、Docker、commit、`.env`/鍵の読み取りも実施していない。

## 2026-10-07 additions

以下は運用報告を受けた追加対策。実機での失敗再現ではなく、ローカルのスタブと手計算fixtureで検証した。

| failure | cause | guard | where tested |
|---|---|---|---|
| SSH+nohup起動の全worldがAnvil不足で失敗 | 非対話シェルのPATHにfoundry/nodeがなく、既存Anvil検査だけでは検出できなかった | manifest begin前にanvil/node/python3の解決先を記録。欠落はSTOP・exit 3。測定経路はforgeを起動しないのでforgeは要求しない | `test_chain_template.py`: `test_path_missing_stops_before_manifest` / `test_path_resolved_passes_without_forge` |
| セッション再起動でbackground計測がexit 143 | ハーネスが子プロセスの寿命を管理していたという報告 | runbook §7にnohup・/dev/null・caffeinate・PATH/nvm・独自end marker確認を固定。LAUNCH_ENVでPATH先頭/TTYを記録しTTYならWARN | `test_launch_env_tty_warns` / `test_launch_env_detached_input_passes`。切断後の実機生存は未検証 |
| ファイル削除後も空きが戻らず計測停止 | Time Machine local snapshotが削除済みデータを保持していたという報告 | macOSでsnapshot数>=10ならWARN。容量STOPに件数と対処を追加。自動削除なし | `test_snapshot_warning_threshold` / `test_snapshot_low_disk_remedy` / `test_snapshot_absent_or_linux_passes` / `test_snapshot_probe_failure_warns` |
| 過去のmixed-field数値を再現できない | 集計コードが使い捨てで、計算式・対象集合が保存されていなかった | `remote/agg_mixed.py`に簡易T、362限定表、異常一覧、paired差を保存。不正入力はSTOP。公式weighted Tとは明確に区別 | `test_agg_mixed.py`: 手計算3world×4agent、361/標準偏差0、paired SE、異常WARN/正常対照、不正入力STOP/復元後PASS |

追加後のオフライン結果: chain **34 tests**（既存26を含む）、aggregation **7 tests**、`bash -n` はPASS。今回の `npm run typecheck` は `tsc: command not found` で実行不可。依存導入は行っていない。参照36worldの再集計、SSH/nohup切断試験、Time Machineの実容量回復、実シミュレーションは未検証。起動例・集計の入力形式と統計上の範囲は [README-RUNBOOK.md](remote/README-RUNBOOK.md) §7–8を参照。
