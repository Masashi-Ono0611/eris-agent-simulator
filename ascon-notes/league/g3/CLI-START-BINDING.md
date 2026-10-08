# 要件1: CLI start-binding のオフライン試作

`claude-start-binding.py` は `ERIS_CLAUDE_BIN` に絶対パスを指定して使う
POSIX / Python 3 用の新規ラッパー。既存 timed wrapper は変更しない。
標準 `llm.ts` の `[-p, context, ...]` 形式だけを受け付け、context の先頭行
`block: N` を読む。system や後続行から block を補完しない。
N は 0 以上の JavaScript 安全整数で、符号・先頭ゼロ・余分な空白は拒否する。

既存の絶対パス `ERIS_RUN_DIR` 内に `agents` を必要なら作り、
`agents/<ERIS_AGENT_ID>.cli-timing.jsonl` に `ts`（UTC ISO 8601）、
`kind: cli_call_started`、`agentId`、`pid`、`block`、`contextSha256` を追記する。
SHA-256 は `-p` context 引数の元バイト全体（通常 UTF-8、改行を含む）で、
system は含めない。prompt 全文・argv・環境変数は記録しない。
agent ID は既存 wrapper と同じ英数字先頭＋英数字・`_`・`-` の規則。
run 最終要素・agents・ログの symlink、通常ファイル以外のログ、複数 hardlink のログは拒否する。
親ディレクトリと PATH は信頼できる launcher が管理する前提。

追記・fsync・close 後に PATH 上の `claude` を `exec` し、同じ PID、argv、
stdin/stdout/stderr を引き継ぐ。PATH の `claude` はこの wrapper 自身に向けない。
stdout/stderr の捕捉や tee は行わない。失敗時は値を含めず stderr に
`guard=context_argument / missing_block / malformed_block / invalid_agent_id / destination`
の該当識別子だけを示し、exit 2 で CLI を起動しない。exec 失敗は `guard=exec`、
exit 127。書込途中の失敗では部分行が残り得るが CLI は起動しない。

同じ block の呼出も毎回追記する。重複拒否・重複除去・PASS 判定は行わない。
テスト側では重複 block の曖昧性を明示的に検出し、2行とも残り、成功判定フィールドが
ないことを確認する。開始記録は exec 成功・応答・採否・完了の証明ではなく、
exec 失敗や CLI 非ゼロ終了でも残る。
exec が失敗すると、応答の無い開始記録が残る。`revision_exchange.mjs` は開始と応答を順序で対応させるため、
この記録は後続の対応をずらし得る。その場合に監査が PASS でなく BLOCKED になるかは、実監査器では未検証。
コンテナ内で動く agent では `ERIS_RUN_DIR` は agent から見たディレクトリを指す。wrapper はそこへ書くだけで、
ホスト側の収集器に届くことは確認していない。
`destination` ガードは書込み先の失敗を一括して扱うため、権限・symlink・hardlink・FIFO のテストは
どの副検査が働いたかまでは区別しない。非 UTF-8 の context を渡すテストも無い。

これは**要件1の start-binding 部分だけ**であり、G3 evidence ではない。
world/mode/case、独立した期待件数、欠測なし、全成果物 digest、監査器の
`g3-audit.json.callStarts` の生成・照合は未実装。既存監査器・exchange collector は
変更せず、この追加行だけでそれらの認定が成立するとは扱わない。
要件2–5（setSource、全判断 frame、取引境界、実 timeout・復帰等）も対象外。
**live run は実施せず、G3 は BLOCKED のまま。**

オフライン検査（リポジトリルートで実行）:

```sh
python3 -B ascon-notes/league/g3/tests/test_cli_start_binding.py
```

テストは一時 PATH の偽 `claude` のみを使い、各拒否ガードの識別子と CLI 未起動、
実際の読取専用ログへの書込拒否、重複保持、argv・バイナリ標準入出力・exit code の透過、
記録 PID と偽 shell の `$$` の一致を検査する。書込拒否の検査は非特権ユーザーが必要で、
特権実行時に黙って skip しない。実 CLI/model、ネットワーク、チェーンを使用しない。

## この試作の検査結果（2026-10-08）

- `python3 -B ascon-notes/league/g3/tests/test_cli_start_binding.py`: exit 0、14 tests、全件 OK、skip なし。
- `npm run typecheck`: exit 127、`sh: tsc: command not found`。依存導入なし、型検査は未検証。
- `git diff --check`: exit 0。新規未追跡ファイルも以下で検査し、各 exit 1（新規差分あり）、空白エラー出力なし。

```sh
git diff --no-index --check /dev/null ascon-notes/league/g3/claude-start-binding.py
git diff --no-index --check /dev/null ascon-notes/league/g3/tests/test_cli_start_binding.py
git diff --no-index --check /dev/null ascon-notes/league/g3/CLI-START-BINDING.md
```

tracked ファイルの変更は0。追加はこの文書・wrapper・テストの3ファイルだけ。
commit/push、network、Docker、Anvil、backtest、SSH、実 CLI/model 呼出は未実施。
実 runtime 経由の起動・実300秒 timeout・子終了・G3 の成立は未検証。
