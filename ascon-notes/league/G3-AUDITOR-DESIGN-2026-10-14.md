# G3 監査器の設計案 — 2026-10-14

> この文書は設計だけを記す。実装・実走・合格判定は行わない。本文中の `[事実: file:line]` はこの作業ツリーの該当行で確認した内容、`[推論]` はその事実からの提案、`[未確認]` は資料だけでは断定できない内容を示す。

## 前提と用語

- [事実: `ascon-notes/league/G3-GAP-CLASSIFICATION-2026-10-14.md:14-20`] 標準実行基盤（stock runtime）と主催者側の設定・起動経路は変えられない。外部環境のため構造的に測れない項目は未解決の「測定不能」として受け入れ、測れる項目は技術で解く。この方針は合格や免除を意味しない。
- [事実: `ascon-notes/league/G3-GAP-CLASSIFICATION-2026-10-14.md:62,79,88,136`（R1e は :62、R4i は :79、R5h は :88）] 今回の設計対象は、監査器の v0 復帰再生（R5h）、HTTP 経路の呼出識別（R1e）、通信記録器案（R4i）である。
- [事実: `ascon-notes/league/g3/prestart-check.py:27-37,244-251`] 開始前検査は、自然な変更と復帰の fixture、悪意ケース、完全な記録器、隔離評価環境、実際の時間制限・復帰などを blocker として列挙する。監査器の改修だけでは blocker は消えない。
- [事実: `ascon-notes/league/g3/chain/gates.py:73-81,93-100`] 監査結果の `FAIL` または `BLOCKED` は、終了コードに写される。runtime-ready は実記録器と隔離評価環境の検証不足で `BLOCKED` を返す。
- [推論] 終了コードが後続工程を止めるかどうかの実際の仕組みは `chain.py` 側にあり、この設計では追っていない。
- [推論・この文書での用語定義] v0 は提出時の元戦略、v1 以降は改訂版。HTTP（Hypertext Transfer Protocol、ハイパーテキスト転送プロトコル）は通信方式、RPC（Remote Procedure Call、遠隔手続呼出）はチェーンへの遠隔呼出、PID（Process Identifier、プロセス識別番号）はプロセスの番号、SHA-256（Secure Hash Algorithm 256-bit、256 ビット暗号学的ハッシュ）は内容照合値、ID（Identifier、識別子）は呼出を区別する値、JSON（JavaScript Object Notation、軽量データ形式）は構造化データ形式。fixture は固定試験データ、receipt は取引の採掘後の結果、worker は戦略を動かす別プロセス、executor は実行する戦略関数、manifest は必要な証拠項目と hash の一覧、frame は1回の判断の入力・出力・時刻、sidecar は本体ログと別に保存する補助記録、transport は通信を引き渡す相手、nonce は送信者の取引連番、FAIL は検査違反、BLOCKED は必要な証拠不足を指す。正対照は問題を含む入力で検査が必ず発火する試験、負対照は問題のない入力で検査が静かな試験を指す。

## 1. v0 に戻った場合を再生する

### 現状の不足

- [事実: `ascon-notes/league/g3/chain/revision_audit.py:147-147,220-237`] 監査器は `versions` を空で始め、v1 以上の採用・復帰版だけを加える。`revertTo: 0` は形式上受け付けるが、復帰元は `versions.get(0)` となって `None` になり、`restored v0 module replay unavailable` として BLOCKED になる。
- [事実: `ascon-notes/league/g3/chain/REVISION-AUDIT.md:48-50,102-106`] 現在の manifest 契約には実際の適用記録はある一方、復帰した元 module の再生材料がなく、復帰元 v0 は BLOCKED と明記されている。
- [事実: `example/agents/runtime/botMain.ts:514-520,791-804`] 実行時の v0 は提出されたファイル全体と、起動時に準備された executor の組である。ファイル全体を改訂版の `executorTs` と同じ文字列として扱うことはできない。
- [事実: `example/agents/runtime/strategyRunner.ts:53-64`] runner は最初の source を受け取り、後続の `setSource` で選択中の source を置き換える。したがって初期 v0 の source と復帰時の適用イベントをそれぞれ記録する必要がある。

### 提案する最小契約

1. [推論] 監査 manifest に `initialVersion` を加える。最低限 `version:0`、提出ファイルの相対パスと SHA-256、実行用 executor の種別・内容 SHA-256、言語、元ファイルから実行 executor を作った変換方法、最初の worker 世代と最初の判断 ID を持たせる。秘密値や全プロンプトは入れない。
2. [推論] 監査器は提出ファイルと pinned source（固定 commit と依存ハッシュ）を照合し、stock の起動時変換とコンパイルを使って v0 executor を再構築する。入力にある executor 本文はファイルのハッシュ一致後にだけ使う。対応する言語や変換の再現材料が無い場合は推測せず BLOCKED にする。
3. [推論] `versions[0]` に v0 executor を登録し、`revertTo:0` を新しい単調増加バージョンとして記録する。復帰適用イベントは `version:2` などの新しい番号と `restoredFromVersion:0` を分けて持つ。復帰後の最初の frame は新しい実行版番号を示し、その source hash が v0 と一致しなければ FAIL とする。
4. [推論] v0 frame も他の版と同様に、観測、順序付き read 記録、戻り値、`ctx.submit`、安全情報を固定入力として再生する。返却値・submit の列、例外、read の順序と返値が記録と違えば FAIL。read 入力または経済安全情報が欠ければ BLOCKED。
5. [事実: `ascon-notes/league/g3/chain/revision_audit.py:238-296`] 現監査器は frame を実際に実行した版へ対応付けて再生し、見つからない source は BLOCKED にする。v0 を同じ対応付け経路へ足せば、別の判定方式を増やさずに済む。

### v0 再生の正対照と負対照

以下の各試験案は [推論]。

| 検査 | 正対照: 必ず発火する入力 | 期待 verdict（判定） | 負対照: 問題のない入力 | 静かな条件 |
|---|---|---|---|---|
| v0 材料の存在と同一性 | `revertTo:0` の応答、適用記録、復帰後 frame はあるが `initialVersion` または提出ファイルがない／ハッシュを1文字変える | 欠落は BLOCKED、ハッシュ不一致は FAIL | pinned 提出ファイル、変換材料、v0 executor hash が一致し、復帰イベントも揃う | v0 source 欠落・不一致の診断なし |
| 復帰の版と時系列 | 復帰適用の版番号を単調増加させない、または復帰適用前の frame に v0 を使った記録を置く | FAIL | v1 適用後に v0 復帰を新しい版番号で記録し、復帰後 frame はその適用後に始まる | 版・適用順序の診断なし |
| 元 module の実行再現 | v0 frame に「取引しない」を記録し、試験用 executor は取引を返す、または記録にない read を呼ぶ | 出力差は FAIL、read transcript（読出し記録）の欠落・余剰は BLOCKED | 固定観測と read 記録から記録と同じ返却値、submit、read 順を再現する | v0 再生差分なし |

[推論] 負対照での「静か」は新設した v0 検査だけについて述べる。監査全体の PASS を意味しない。既存の別 blocker はそのまま残る。

## 2. HTTP 経路の呼出識別（R1e）

- [事実: `example/agents/runtime/llm.ts:154-166,211-230,270-303`] HTTP 推論 proxy へは per-agent token と `x-eris-agent` が送られる。要求本文に改訂ブロック番号、監査 call ID、PID は見当たらない。HTTP 呼出は `fetch` を通る。
- [事実: `example/agents/runtime/botMain.ts:769-785,994-1010,1033-1050,1057-1067`] 改訂処理と改訂用入力は botMain 内にあり、成功・失敗後の call log には block、model、system、context が入る。現行の raw call log は明示的に有効化する方式で、成功記録には raw 応答、失敗記録には error が入る。
- [事実: `ascon-notes/league/G3-GAP-CLASSIFICATION-2026-10-14.md:62`] 現監査契約は CLI の PID と call block の結合を要求するが、提出側既定モデルは Ollama 系 HTTP 経路である。
- [推論] 1回ごとに中継側で `requestId` を割り当て、要求内の system と user context の正規化 hash を sidecar に記録する。現行 HTTP request body に block は無いが、完了後の `.llm` log は同じ system/context と block を持つため、hash がただ1件の完了記録と一致するときに `requestId → callBlock → response/outcome` を結ぶ。raw context や認証値・上流秘密は proxy sidecar に保存しない。HTTP call log が無効、hash が0件または複数件と一致、要求と完了記録の hash が不一致なら BLOCKED とする。応答本文を照合するには、現行の raw call log があることも別条件とする。
- [推論] proxy recorder（中継記録器）は `ERIS_INFERENCE_BASE_URL` の人工／将来実環境の中継点に置く案とする。要求・応答の SHA-256、モデル名、HTTP status、開始・終了時刻、agent ID、request ID、失敗種別を sidecar へ出す。認証値や原文を保存する場合は、既存 raw log の保存規約、アクセス制限、削除条件を決めてから別途承認する。
- [未確認] 実際の Ollama Cloud／主催者 proxy が未知の応答 header に request ID を返すか、HTTP request に block/call ID を追加できるかは調べていない。外部設定を変えられない前提では、これらに依存した設計を採用しない。
- [推論] HTTP 呼出識別の正対照: (1) proxy が記録した要求 hash を別の `.llm` call log に対応付ける → FAIL、(2) request ID または `.llm` call log を欠落・重複させる → BLOCKED、(3) 同一 system/context の要求が複数あり hash が一意に対応しない → BLOCKED。負対照: 要求 hash がちょうど一つの `.llm` call log と一致し、block と outcome に一意に結ぶ → 識別検査は静か。

## 3. 通信記録器（R4i）が必要な範囲

- [事実: `ascon-notes/league/G3-REQ4-GAP-2026-10-11.md:9-22`] 現行の事後結合器は一部の取引整合性だけを扱う。通信記録器 P01〜P07（委譲回数、要求・応答、一括要求、署名済み取引、終了状態、秘密の扱い、順序）は未実装として残る。
- [事実: `ascon-notes/league/G3-REQ25-PLAN-2026-10-11.md:114-132`] 既存案は人工 transport（通信先）を受け取る `rpc-fixture-recorder.mjs` と部分 receipt 結合、通信失敗・応答逆順・nonce（取引連番）競合・補助送信等の人工 fixture を挙げている。通信の欠落は BLOCKED、二重委譲や別接続混同等は FAIL の対照が指定されている。
- [推論] R4i の人工記録器は必要である。これは RPC 呼出の重複、要求・応答の取り違え、未完了の隠蔽、秘密値保存の誤りを実装前に見つけるチェックとして必要。ただし人工 transport の契約試験であり、実 RPC 記録器が動いた証明や、残高・allowance・予約・ガス予備・全 receipt の実測にはならない。
- [推論] 既存案の最小形は人工 transport wrapper と純粋な fixture join に限定する。wrapper は各要求を委譲先へ厳密に一度渡し、接続 ID・要求 ID・method/args・開始/終了・結果/error・未完了を順序付きで保持する。自分で再試行・追加 read・再送をしない。署名値、秘密 header、token は保存しない。 receipt join は人工の world ID・hash・status を照合し、解けないものを BLOCKED の集合に残す。
- [未確認] P01〜P07 の完全な定義はこの設計では新たに作らない。ここでは REQ4-GAP が列挙する項目名を入口として使い、人工記録器の項目ごとの形式・許可フィールドは実装前に既存 B04 capture design と照合する。

### 通信記録器の正対照と負対照

以下の各試験案は [推論]。

| 検査 | 正対照: 必ず発火する入力 | 期待 verdict | 負対照: 問題のない入力 | 静かな条件 |
|---|---|---|---|---|
| 委譲回数・副作用 | 同じ要求を recorder が二度委譲、または記録目的で追加 read を行う | FAIL | 各要求を1回だけ委譲し、追加通信なし | 重複・余分な通信なし |
| 接続と batch の識別 | 別接続で同じ ID を再利用、要求 ID を重複、応答を逆の要求へ割当て | FAIL | 接続 ID と要求 ID が一意で、応答順が逆でも ID で元要求へ結合 | 取り違えなし |
| 未完了と通信 error | 応答または error を削除し、記録器が完了扱いにする | BLOCKED | error/未完了が元要求に対応して残る | 欠測を完了と誤認しない |
| 署名取引・nonce 競合 | 同 nonce の異なる hash を1件にまとめる、同じ hash を二重計上する | FAIL | 各 hash と置換関係を別々に保持し、採掘結果へ一意に結ぶ | 欠落・二重計上なし |
| receipt の帰属 | 別 world の同番号 block、status 矛盾、同一 receipt の重複を投入 | FAIL | world、block hash、位置、transaction hash、status が一意に対応 | 矛盾なし |
| 補助送信 | 起動時承認やガス補充を判断由来として記録、または対象集合から落とす | FAIL | 補助送信を別分類し、判断との対応を偽らない | 誤帰属・脱落なし |
| 秘密値・経済情報欠測 | 合成 secret header を投入し保存を試みる、または残高等の必須値を削る | 保存は FAIL、必須値欠落は BLOCKED | secret を記録せず、必要欄の欠落を欠落として表す | 秘密値なし、欠測をゼロ補完しない |

## 4. 最小実装スライスとロック

次は将来の実装順案である [推論]。この作業では下記のどのファイルも変更しない。

| 順 | 最小スライス | 実装時に変更する正確なファイル | 変更される固定ハッシュ／再登録 |
|---|---|---|---|
| 1 | v0 executor を監査入力として結合し、`revertTo:0` 後の適用・frame を再生する。上記 v0 正負対照を追加する | `ascon-notes/league/g3/chain/revision_audit.py`、`ascon-notes/league/g3/chain/revision_replay.mjs`、`ascon-notes/league/g3/chain/test_revision_audit.py`、`ascon-notes/league/g3/chain/REVISION-AUDIT.md` | `revision_audit.py` は `chain.py` の `TOOL_MANIFEST` hash と `inputs.lock.json` の input hash を更新する。replay/test/doc の input hash も `inputs.lock.json` で更新。`register-inputs.py` は既存ファイルを登録済みなので変更不要。`chain.py` 自体の byte も inline hash 更新により変わり、lock の同ファイル hash を更新。 |
| 2 | HTTP 用 request ID、要求 hash と一意な call/block/outcome binding を記録・監査する。曖昧なら BLOCKED | `ascon-notes/league/g3/chain/http-fixture-recorder.mjs`、`ascon-notes/league/g3/chain/test_http_fixture_recorder.mjs`、`ascon-notes/league/g3/chain/revision_audit.py`、`ascon-notes/league/g3/chain/test_revision_audit.py`、`ascon-notes/league/g3/chain/REVISION-AUDIT.md` | 監査器の固定 tool hash と、変更した各 input の `inputs.lock.json` hash。新規 recorder/test の lock 登録に `register-inputs.py` の `ADDITIONS` 追記も必要。再度 `chain.py` の inline hash とその lock hash を再登録。`gates.py` hash は変わらない。 |
| 3 | RPC 人工 transport recorder と receipt fixture join、指定された失敗対照を追加 | `ascon-notes/league/g3/loader/rpc-fixture-recorder.mjs`、`ascon-notes/league/g3/loader/receipt-fixture-join.mjs`、`ascon-notes/league/g3/tests/fixtures/SYNTHETIC-rpc-receipts.mjs`、`ascon-notes/league/g3/tests/rpc-fixture-recorder.test.mjs`、`ascon-notes/league/g3/tests/receipt-fixture-join.test.mjs`、`ascon-notes/league/g3/chain/REVISION-AUDIT.md` | 新規ファイルを lock 対象にするため `ascon-notes/league/g3/register-inputs.py` の `ADDITIONS` と `inputs.lock.json` を更新。監査器と独立実行する限り `chain.py` の tool manifest hash は変わらない。launcher から呼ぶ場合は `chain.py` の `TOOL_MANIFEST` に追加する設計判断が必要で、その場合はそのファイル hash と `inputs.lock.json` も更新。 |

- [事実: `ascon-notes/league/g3/chain/chain.py:68-74,233-240`] launcher の固定 tool manifest は `gates.py` と `revision_audit.py` の内容ハッシュを検査する。
- [事実: `ascon-notes/league/g3/register-inputs.py:20-25,54-70`] 登録器は既存固定 tool hash を更新し、`ADDITIONS` と既存 input 集合の全ファイル hash を lock に記録する。
- [推論] したがってスライス1・2は監査器 hash と変更済み input hash の再登録を必須とする。スライス3は新規ファイルの lock 登録が必要。登録を起動時の自動修復に使わず、レビュー後に明示的に実施する。**lock の変更は「G3 が何を信頼するか」を変えるため、変更の差分（旧→新の hash の一覧）を本人が確認してから merge する（2026-10-12 の移植 PR と同じ手順）。**
- [未確認] HTTP proxy recorder を将来どこで実行するか、運営・参加者がその proxy を設定できるかは未確認。外部環境変更が前提となる場合、その部分は実装不能なまま測定不能候補として残り得るが、現在はその判断を確定しない。

## 5. 全スライス後も証明されないこと

- [事実: `ascon-notes/league/g3/chain/REVISION-AUDIT.md:69-75,86-112`] 自己申告の sidecar は信頼できる採取元の証明ではない。有限の replay（再生）は実行されていない分岐の意味や安全性を証明せず、現監査器の PASS 範囲も記録された世界の検査に限られる。
- [事実: `ascon-notes/league/g3/chain/revision_replay.mjs:8-13,67-92,114-145`] 既存 replay はネットワーク送信を禁止する人工 read stub で executor を再生し、実送信元を持たない。これは実 runtime の開始、復帰、遅着処理を再現した証拠ではない。
- [事実: `ascon-notes/league/g3/prestart-check.py:27-37,244-251`] 開始前 blocker とその completeness 判定は残る。新しいローカル監査チェックを加えても lock や blocker の証拠を消さない限り準備条件は満たされない。
- [事実: `ascon-notes/league/G3-GAP-CLASSIFICATION-2026-10-14.md:113-123`] B09e は計測しない提出構成の内部 frame を直接観測できない項目として分類されている。今回の recorder/replay は計測構成の証拠を増やしても、その未観測内部挙動を実測したことにはしない。
- [推論] v0 の人工再生が完了しても、実世界で自然に得た安全変更、実チェーン上で変更後・復帰後の module が動いたこと、実際の残高・allowance・予約・fee・receipt の全件対応、実際の HTTP proxy 出所、計測有無による影響、主催者の配布環境との一致は別の証拠を要する。
- [未確認] 本設計では recorder の第三者検証、sidecar の改ざん耐性、HTTP proxy の本番設定、実チェーンでの試験、現行 prestart の再実行を行っていない。

## 6. リスク

- [推論] v0 executor と提出元ファイルを混同すると、監査は別の戦略を動かした結果を「復帰成功」と誤認し得る。元ファイル、変換後 executor、pinned source の三者を個別 hash で結ぶ。
- [推論] v0 と復帰版をどちらも番号 0 と記録すると、その後の版履歴・first frame が曖昧になる。復帰は新しい版番号とし、復帰元番号は別フィールドにする。
- [推論] HTTP の同時呼出が起きたとき、順番だけで block を推定すると別の改訂応答へ結び付ける危険がある。一意な相関が無ければ BLOCKED とする。
- [推論] 記録用 proxy が再試行・追加 read を行うと通信自体を変え、また秘密 header/body の保存は認証情報漏えいにつながる。人工 transport で一回委譲・保存対象 allowlist・秘密混入対照を検査する。
- [事実: `ascon-notes/league/G3-REQ4-GAP-2026-10-11.md:21-22`] 通信の完全な母集合が得られないうちは危険試行数を確定できず、通信記録器も未実装のままである。記録がないことを「危険な通信がなかった」と読み替えない。
- [推論] これらの対照に通っても、人工 transport と offline replay が示すのは設計契約の内部整合性までで、実行時採取の真正性や未実行コードの安全性ではない。
