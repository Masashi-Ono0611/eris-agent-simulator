# r3a の回復在庫と通常裁定の混在診断（2026-10-07）

## 結論と調査範囲

**r3aの回復への帰属が通常裁定の売却後も残り、後で通常購入分を回復在庫として売る経路を、複数ブロックのテストで再現した。** このため、条件付きの修正対象として `ascon-zeta-r3c` を作成した。研究用であり、提出候補への昇格や収益改善を意味しない。

作業場所は `ascon/.claude/worktrees/r3a-weth-risk`、ブランチは `research/r3a-weth-mix`。ローカル参照 `origin/main` は `75887dc`（fetchしていない）。対象は既存r3aとr3、および新規r3c。既存agent、runtime、SDK（Software Development Kit、開発用ライブラリ）、lib、coreは変更していない。commit、push、外部ネットワーク利用、Docker、Anvil、バックテストは実施していない。

参照した問題提起は `R3A-VARIANT-2026-10-07.md` の「独立レビューで見つかった未解決のリスク」。r3aとr3の戦略コードの差は、回復の価格・費用チェック不適合時に、r3のnoop返却をr3aでは回復ブロックからの脱出に置き換えた点である。

ETH（Ether、ネイティブ通貨）のwrap（WETHへの変換）から帰属するWETH（Wrapped Ether）の数量と、delta（通常の価格差裁定）が取得・消費する同一トークンの数量を区別して調べた。USDC（USD Coin）は裁定の決済側トークン。WETHは代替可能なので、ここでいう「所有」は別アドレスによる所有権ではなく、同一口座の内部的な回復への帰属である。

## テスト方法

- `test/ascon-zeta-r3a-weth.test.ts`：8テスト。r3aの現行動作を固定し、r3を対照とする。問題を再現する箇所には `KNOWN-RISK:` コメントと明示的なテスト名を付けた。成功は危険動作の再現成功も含む。
- `test/helpers/r3Weth.ts`：既存r3aテストと同じく、各候補を独立したモジュールとして読み込み、テストで読み込むソースにのみ `recoveryState()` を追加する。製品ソースには検査用exportを追加しない。実際の `decideWithParams()` を呼び、RPC（Remote Procedure Call、遠隔手続き呼出し）のquoteとnonceをモックする。deltaの選択・数量計算は実コードである。
- `test/ascon-zeta-r3c.test.ts`：r3cの修正、保守的な副作用、変更対象以外の一致、ファイル集合とソース全文の同一性、prompt本文の維持を検査する。
- 各シナリオの全返却actionと `recoveryWeth` / `wrapPending` / `recoverySellPending` を、ブロックごとに保存し、テスト診断出力にJSON（JavaScript Object Notation、構造化データ形式）として出す。以下の表はその要約。

`decideWithParams` の設定は原則 `launch=false, redemption=true, stabilityPool=false`。SP（Stability Pool、安定化プール）の一致検査だけ有効にする。初期価格は1 WETH=3,000 USDC、初期ETHは1、通常は初期WETHは0、初期USDCは20,000。b1はnoop、b2でETHを2へ増やし、1 ETHのwrapを返させる。b3に正確なwrap後残高（ETH=1、WETH=1）を渡す。したがって、問題再現には初期WETHと自己wrap分のどちらを先に売ったかという仮定が不要である。

回復quoteは不適合時に0、適合時は売却数量×3,000 USDCとする。通常裁定の価格情報と回復quoteは別のモック値であり、流動性・スリッページを含む整合した実プールの再現ではない。返却actionを自動送信する仕組みはなく、fill（約定）を仮定した残高を次の観測へ明示的に設定する。

r3への比較は次の2種類を区別する。

1. **同一観測リプレイ**：r3aと同じ残高をr3へ渡す。r3が返していないdelta売買の結果も外生的な残高変化として見せるため、r3の実取引履歴とは呼ばない。この入力ではr3も最後に1 WETHを回復として売る。
2. **行動に応じた残高反映**：それぞれが返した売買だけを成功させる。共通の価格推移に対し、r3は回復不適合中にdelta売買を返さず、自己wrapの1 WETHを維持する。r3がこの混在を起こさないという結論は、この条件に限定する。任意の外部入出金や異なる設定まで含む一般的な安全性証明ではない。

## ブロック列と状態

以下はWETH単位の数量。`R` は `recoveryWeth`、`W` は `wrapPending`、`S` は `recoverySellPending`。`—` は未設定。`W=(weth, eth, amount)`、`S=(weth, amount)`。ETH/USDの価格変動損益は計算していない。

| シナリオ | r3aの返却行動と観測 | 回復状態の要点 | r3の対照 |
|---|---|---|---|
| SELL→BUY→適合 | b3: WETH価格4,000で0.25 WETH売却。b4: 残高0.75、USDC=21,000、価格2,000で5,250 USDC買い。買い約定を2.6 WETHとし、b5: 残高3.35で回復1 WETH売却 | b2: R=0,W=(0,2,1)。b3/b4: R=1,W=—,S=—。b5: R=1,S=(3.35,1) | 同一観測ではb3/b4は回復不適合noop、b5は同じ回復売却。行動反映比較ではWETH=1を維持して回復1を売る |
| SELLだけ→適合 | b3で0.25売り、b4は残高0.75から回復0.75を売る | b3のRは1のまま。b4: R=1,S=(0.75,0.75)。`min(R,weth)`で実残高以上の売りは出ない | 同一観測でb3はnoop、b4は同量を売る |
| BUYだけ→適合 | b3で5,000 USDC買い、買い約定を2.47 WETHとする。b4: 残高3.47から回復1を売る | Rは1のまま増加しない。S=(3.47,1) | b3はnoop。純粋な買い増しだけで回復数量が増える現象はない |
| bundle→leg pending→適合 | 初期WETH=8、wrap後9。b3: 5,000 USDC買い＋1.75 WETH売りのbundle（複数取引の組）。b4: 買い約定後10.78、売りがpendingなのでnoop。b5: 売り約定後9.03、回復1を売る | b3/b4: R=1,W=—,S=—。b5: S=(9.03,1)。bundleの売り数量は決定時残高以下 | b3は回復不適合noop。同一観測のpendingでは同じ保護noop |
| 反復見送り＋追加ETH＋次のwrap | b3〜b5不適合。b4からETH=2でも追加wrapなし。b6回復1を売り、b7のWETH=0で次のwrap1、b8の正確な残高増分を確認 | b3〜b5: R=1,W/S=—。b7: R=0,W=(0,2,1),S=—。b8: R=1,W/S=— | 後続裁定機会なしなので、見送り理由以外は同じ |
| wrap・売却確認待ち | b3: wrap未反映でnoop。b4: wrap確認後回復1を返す。b5: nonce不一致、b6/b7: nonce一致でも残高不変ならnoop。b8: WETH=0を確認 | b3はWを保持。b4〜b7はR=1,S=(1,1)。b8でR=0,W/S=—。回復quoteは一度だけ | 同一行動・状態。重複売りを再現しない |
| 未送信bundleとの重なり（条件付き） | USDC=10,000、WETH=1。b3: 2,500 USDC買い＋0.875 WETH売りのbundle。送信待ちのままb4を迎えた仮定で、残高不変かつnonce一致なら回復1を返す | R=1のまま、b4: S=(1,1)。回復が先に成功すると残高0となり、古い売りlegの独立資金0.875を満たさない | b3にbundleを返していないため、その古いlegとの重なりはない |

最初の行では、b3の売り成功後に残る自己wrap分は最大0.75。b5の回復売り1のうち**少なくとも0.25は通常の買いによるWETH**である。これは残高上限の問題ではなく、帰属情報が古くなる問題である。

未送信bundleの検査は、返却済みactionが次の判断まで送信待ちで保持されるという入力モデルである。テストは返却と資金重複を示すが、実際の送信順・実行可否は示さない。古い買いlegが先に成功すれば資金を補える場合もある。買いの失敗、売りだけの遅延、次ブロック判断との並行が実runtimeで許されるかは未検証。

## 質問(a)〜(d)への回答

| 質問 | 判定 | 根拠と必要な実チェーン情報 |
|---|---|---|
| (a) 回復が帰属外WETHを売るか。r3にはなかったか | **r3aでは起こる（モックの行動反映モデル）。r3には同モデルの自己生成経路がない** | SELL→BUYで下限0.25を再現。r3の不適合noopがその2行動を抑制する。ただし同一の外生残高変化を与えるとr3も売るため、「r3はどんな履歴でも安全」とはしない。実証にはwrapの入金、deltaの各送信・receipt（取引結果）、WETH Transferログ、ブロックごとの残高と回復状態が必要 |
| (b) delta bundleのlegに必要なWETHを回復が売るか | **未送信legを保持する入力モデルでは条件付きで起こる。nonceがpendingを正しく示すモデルでは起こらない。実runtimeでは未確定** | pending不一致は回復を停止。返却済みで未送信のactionはnonceに出ないため重複する。senderのキュー、action返却・各leg送信の時刻、nonce、各receipt、revertや送信失敗後の継続方針が必要。原子的bundleの実行や、判断前に全leg処理が完了することは仮定しない |
| (c) 二重売り／状態不整合により後で誤動作するか | **Rの不整合と後続の誤帰属売却は起こる。W/Sの競合や重複した回復売却は今回のモデルでは起こらない** | 0.25売却後もR=1。後の買いでその古い帰属が再使用される。pendingおよび残高不変ガードは維持される。回復売り失敗後に残高不変なら待機が続く既存ロジックもあり、成功・revert・dropを残高だけで区別できるとは主張しない。receiptと未送信action、同一ブロックの入出金を対応付ける必要がある |
| (d) 普通のdelta買いを回復在庫にしないというコメントに反するか | **SELL→BUY後の回復売りという意味で起こる。BUYだけでは起こらない** | 買い時にRが加算されるのではなく、売り時に減らないRが買い在庫を覆う。コメントはdelta買い自体を禁止していないので、delta行動を返すだけで違反とはしない。実データでは(a)の取引別残高・帰属推移が必要 |

## r3cの変更と理由

`example/agents/ascon-zeta-r3c/` はr3aの5ファイルのコピー。戦略コードの変更は `agent.ts` の末尾のdelta返却部分だけで、1行を7行へ置換した。

1. 実deltaのactionを取得する。
2. 単独行動またはbundleの各legを調べ、`swap` / `curveSwap` / `balancerSwap` でbaseがWETH（省略時もWETH）なら `recoveryWeth=0n` とする。
3. action自体はそのまま返す。WETH以外のbase、noop、先に返るLiquity処理や回復処理には変更を加えない。

売却後の予想残高へのclamp（上限による切り詰め）だけでは、約定前のbundle、買いと売りの一部失敗、古い帰属と新しい買いの混在を正確に追跡できない。**ここでは帰属を維持できなくなった時点で破棄する**という小さな保守的修正を選んだ。これにより最初のdelta行動はr3aと一致するが、その後の回復売却・次のwrapの時期は変わり得る。

代償として、返却したdeltaが未送信・拒否・revert（実行取り消し）になっても帰属を失う。純粋な買いだけでも破棄するため、まだ回復可能だった自己wrap分が通常在庫へ移る。売りを強制したり資産を廃棄したりする変更ではないが、期末の在庫構成・損益への影響は未計測。r3cはsender全体の二重発注防止や資金予約を実装したものではない。

launchは既存の `launchPools` が既知トークンであるWETHを除外し、USDCと新規トークンだけを対象とする。トークン順序を入れ替えたWETHプールも除外するテストを追加した。このコード経路にはWETH帰属破棄の処理を追加しない。launchの別トークン保有や送信は今回の実行対象ではない。

r3c検査はSELL、BUY、bundleで帰属破棄と元action一致を確認し、SELL→BUY後の誤回復売りがなくなること、未送信bundleモデルで回復が割り込まないこと、delta失敗時にも帰属を捨てること、次の正確な自己wrapだけを新たに帰属することを固定した。その他の一致はnoop、競争力あり、quote欠落、wrap/nonce/売り確認待ち、清算、SP、WBTC（Wrapped Bitcoin）の単独買いとbundle、回復在庫なしのpublic `decide()`で確認した。全入力への形式的な同値証明ではない。

コピーした `delta.ts` / `launch.ts` / `launchSwap.ts` はr3aとバイト一致。`prompt.md` はname、description、研究版説明文だけ変更した。r3本文の必須5フレーズ（`transactions since the last revision`、`market history`、`mean inclusion latency`、`recent decisions`、`latest observation`）を維持し、既存revisionEvidence検査も実行する。

## 検証結果

最終結果は以下に記す。テストの成功は実チェーン安全性・採算性の認定ではない。

| 実行 | 結果 |
|---|---|
| `npm run typecheck` | 最終成功、終了コード0 |
| `node --import tsx --test test/ascon-zeta-r3a-weth.test.ts test/ascon-zeta-r3c.test.ts test/ascon-zeta-r3a.test.ts test/ascon-zeta-r3.test.ts test/revisionEvidence.test.ts` | 78成功、0失敗、0スキップ、終了コード0 |
| `npm test` | 起動したが完走せず、監視用プロセスが70秒で全体のプロセス群を停止。完走・合格とはしない |
| 同じ全ファイルを `node --import tsx --test --test-concurrency=4 --test-timeout=30000 --test-reporter=tap test/*.test.ts` で補足実行 | 完走、2,389テスト中2,310成功・69失敗・10スキップ・0キャンセル。終了コード1、約47.9秒 |
| `git diff --check` | 成功、終了コード0。未追跡ファイルはこのコマンドだけでは検査されないため、新規テスト・helper・agent.ts・prompt.mdには `git diff --no-index --check /dev/null <file>` も実行し、空白違反の出力なし |

型検査の初回はactionのunion型の扱いで2エラーがあり修正した。初回の指定テストは、WBTCモックの価格フィールド名が既存APIと違うため2失敗があり、実装側ではなくモックを `priceUsdcPerWeth` 形式へ修正した。上表は追加シナリオを含む最終版の結果。コピー元delta.tsの既存末尾空白は、バイト同一性を保つため変更していない。

全体テストは実Anvil・DockerのあるディレクトリをPATHから除いて実行した。テスト自身が作るコマンドのスタブ（代用品）はそのまま使用する。ローカル待受けはsandboxで拒否された。69失敗の内訳は、既知のForge成果物欠落1、既知のPython依存 `pydantic` 欠落2、`listen EPERM` 57、待受けEPERMを伴う `runtimeLlmLimits` のbefore hook失敗9。変更前の再実行はしていないので、全失敗を変更と無関係と証明したわけではない。新規テストの失敗はない。

中断した実行と時間制限付き実行の両方で、起動したプロセス群へ終了処理を行った。`ps` による列挙はsandboxに拒否されたが、各プロセス群へのsignal 0確認は `ProcessLookupError`（不存在）となり、両ログを保持するプロセスも `lsof` では検出されなかった。テスト実行をバックグラウンドへ残していない。

一時ログは `/tmp/r3c-typecheck.log`、`/tmp/r3c-targeted.log`、`/tmp/r3c-full-npm.log`、`/tmp/r3c-full-bounded.log`。ファイル名は依頼通り2026-10-07とし、最終検証・記録はシンガポール時間2026-10-08にまたがった。

## 限界と次回計測の提案（未実行）

モックquoteと明示した残高更新による決定ロジックの診断であり、実プールでこの価格と約定が同時に成立すること、senderで未送信bundleが次判断と重なること、実チェーン上の二重売却、収益効果は未検証。Docker、Anvil、バックテスト、bundle生成・selftest、提出は実行していない。コード置換revisionによる任意行動という既存r3のBLOCKER検査も引き続き再現成功であり、今回の帰属修正で解消していない。

**次に行う計測の提案のみ**：同じ相手構成・seed（乱数の初期値）・レジーム（市場局面）で候補席だけをr3 / r3a / r3cへ入れ替え、12レジームを等しく含む対応比較を行う。まず自己wrap→不適合→delta売買→回復再評価の実際の発生数を測る。各決定の返却action、送信キュー、leg別nonce・送信時刻・成功/revert/未送信、wrapとTransferのログ、判断前後のWETH残高、3状態を同じ識別子で結び付ける。特にnonce一致でも未送信legが残るかを確認する。

r3cの帰属破棄回数、破棄後にdeltaが未送信・失敗した件数、次のwrapまでの時間、通常在庫として残るWETHも測る。期末資産価値の損益Pと何もしない基準との差、各レジームの最悪値を併記し、欠測や失敗世界を除外して改善としない。これは計測提案であり、実行予約や採用判断ではない。

## 全体検証の失敗名

以下は時間制限付き全ファイル実行の69失敗すべて。既知3件を明示し、それ以外の66件も名前を省略せず記載する。

- `agentCreatedMarkets.test.ts` — `selector recovery finds an un-gated rescue() from runtime bytecode alone`：既知：Forge生成物 LeakyVault.json 欠落
- `dashboardHealthz.test.ts` — `/healthz is 200 with a listable runs/ and 503 without, and is not the SPA fallback`：127.0.0.1待受けEPERM
- `dashboardHealthz.test.ts` — `/healthz names the commit in dist, and says when a build landed under it`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `audience mode withholds the participants' files and everything not on the list`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `the interval series is public under its name and under the old one (issue #140)`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `audience mode strips seeds, future windows, rigged ground truth and stderr from events.jsonl`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `audience mode hides regime and seed of a scenario matrix but not a practice period's days`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `operator mode serves everything as before, with cache headers`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `the live tail holds an unmined submission and delivers it once mined, losing nothing`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `a scenario epoch's regime-naming owners are collapsed in events.jsonl and blocks.csv`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `operator mode serves every file and tail byte for byte`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `an allowlisted competition is served with its scenarios, and nothing else is`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `a practice period admits everything inside it, and nothing outside`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `no allowlist serves everything, which is the operator's own view`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `/manifest.json is the manifest of the run to connect to, among the admitted ones (issue #156)`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `/manifest.json is a 404 when no admitted run has written one`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `the public view withholds who moved value to whom`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `a '..' in the path cannot step from an admitted competition into a run outside it`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `a malformed percent-escape answers 400 and the server keeps serving`：127.0.0.1待受けEPERM
- `dashboardRunsApi.test.ts` — `a symlink inside an admitted competition does not serve a run outside the allowlist`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `only the three inference paths exist; everything else is 404`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `a model outside the list, or on the wrong provider's path, is refused with the allowed names`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `stored or previous references are refused, naming the key`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `with a secret, the caller needs its own token; the upstream sees the operator's key and the pinned model`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `every call is recorded per agent with a sequence number, and a recording replays without an upstream`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `the per-agent rate limit is a sliding minute`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `ollama: a streamed answer is relayed chunk by chunk under the upstream's status and content type`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `openai: a streamed answer is relayed chunk by chunk under the upstream's status and content type`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `anthropic: a streamed answer is relayed chunk by chunk under the upstream's status and content type`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `a streamed call is recorded as one record with its text and content type, and replays as the same stream`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `a streamed call is cut by silence, not by its length`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `an agent that stops waiting aborts the upstream request, streamed or not`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `an agent that reads slowly is not buffered for: the proxy stops pulling from the upstream`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `a stream past maxStreamBytes is cut, and recorded and replayed with the same cut`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `a record that cannot be written is reported and counted; the call is served and the next one too`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `recording stops at the agent's cap with a note in its file; its calls still pass and others still record`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `the proxy's total cap stops recording for everyone, each file ending with the note`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `past the cap a call still leaves a bounded stub: padding a request cannot buy silence`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `the recording stats are the operator's, not the field's: /healthz says only that it is alive`：127.0.0.1待受けEPERM
- `inferenceProxy.test.ts` — `a handler that throws is that call's 500, not the process's exit, and the next call is served`：127.0.0.1待受けEPERM
- `inferenceProxyCli.test.ts` — `the CLI keeps serving after a record write fails, and says so on stderr`：127.0.0.1待受けEPERM
- `monitoringExporter.test.ts` — `environment failures are counted by kind, with a recent-window gauge the alert reads (issue #159)`：127.0.0.1待受けEPERM
- `monitoringExporter.test.ts` — `container memory comes from the cgroup tree, named from Docker's metadata (issue #157)`：127.0.0.1待受けEPERM
- `monitoringExporter.test.ts` — `a registered canary's silence is measured from its last landed transaction (issue #159)`：127.0.0.1待受けEPERM
- `monitoringExporter.test.ts` — `every block interval since the last sample is measured, so a stall between samples still shows (issue #159)`：127.0.0.1待受けEPERM
- `monitoringExporter.test.ts` — `the textfile is one family per name and the dashboard is probed`：127.0.0.1待受けEPERM
- `monitoringExporter.test.ts` — `the public probe names itself, so the tunnel does not refuse it as a bot`：127.0.0.1待受けEPERM
- `nonceFloor.test.ts` — `without a floor, epoch s's oracle update replays in epoch s+1 and shuts out the coordinator's`：127.0.0.1待受けEPERM
- `nonceFloor.test.ts` — `after raiseNonces, the replay is refused and the coordinator's update lands`：127.0.0.1待受けEPERM
- `pyBridge.test.ts` — `SDK sample has the same decisions as my-arb across funding, venues and dust`：既知：Python pydantic 欠落
- `pythonSdk.test.ts` — `Python sizing and multi-market helpers match TypeScript with exact integer balances`：既知：Python pydantic 欠落
- `rpcGateway.test.ts` — `gateway seals pending transactions while preserving nonce seeding and mined reads`：127.0.0.1待受けEPERM
- `rpcGateway.test.ts` — `gateway refuses a raw tx whose maxFeePerGas exceeds its tip or the cap, and forwards the rest`：127.0.0.1待受けEPERM
- `rpcGateway.test.ts` — `gateway refuses methods outside the explicit list and the pending tag in any position`：127.0.0.1待受けEPERM
- `rpcGateway.test.ts` — `gateway refuses a deeply nested body without dying, and estimates gas at latest when the tag is omitted`：127.0.0.1待受けEPERM
- `rpcGatewayBody.test.ts` — `an unmined transaction read by hash is null; a mined one passes through`：127.0.0.1待受けEPERM
- `rpcGatewayBody.test.ts` — `a request body over the cap is refused with 413 and never reaches the upstream`：127.0.0.1待受けEPERM
- `runtimeLlmLimits.test.ts` — `each family sends the limits prompt.md configured`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeLlmLimits.test.ts` — `without a configured limit: an explicit Ollama context, the model's own output cap, and 16,000 for Claude`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeLlmLimits.test.ts` — `the environment supplies limits prompt.md did not set, and prompt.md wins`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeLlmLimits.test.ts` — `the Claude default is above the old 2,048 and inside the SDK's non-streaming bound`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeLlmLimits.test.ts` — `ollama: a reply cut at its output cap is a truncation, not a reply`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeLlmLimits.test.ts` — `openai: a reply cut at its output cap is a truncation, not a reply`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeLlmLimits.test.ts` — `anthropic: a reply cut at its output cap is a truncation, not a reply`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeLlmLimits.test.ts` — `usage comes back with the reply`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeLlmLimits.test.ts` — `an Ollama prompt that cannot fit its context comes back with a warning, not silently`：before hook失敗（30秒制限、待受けEPERMを別途記録）
- `runtimeSender.test.ts` — `typescript: ctx.submit and returned actions share pending nonces and one submitted record per transaction`：127.0.0.1待受けEPERM
- `runtimeSender.test.ts` — `python: ctx.submit and returned actions share pending nonces and one submitted record per transaction`：127.0.0.1待受けEPERM
- `runtimeSender.test.ts` — `a bundle leg that depends on an earlier pending leg is sent through a latest-only gateway`：127.0.0.1待受けEPERM
