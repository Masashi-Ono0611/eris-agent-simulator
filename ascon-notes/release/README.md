# ASCON release preparation

`RELEASE READY` は静的検査と、**同じ commit・ZIP SHA-256 に結びついた G0 / selftest 証跡**の
両方が揃った場合だけ出る。自己申告の `--confirm-backtest` / `--confirm-selftest` は廃止。
通常の準備はリリース worktree で行い、住所表を選択した upstream commit と一致させる。
バックテストは別の評価 worktree で行う。

```bash
python3 ascon-notes/release/prepare-release.py \
  --source ascon-epsilon --name ascon-final-epsilon \
  --delta-params '{"SAFETY_MARGIN_BPS":75}' \
  --epsilon-params '{"launch":true,"redemption":false}'
```

この段階は別ディレクトリに既定値を焼き込み、静的検査・bundle・0 BLOCK スキャン・
ZIP住所表照合を行う。証跡が無ければ「静的検査のみ通過（READY ではない）」、**exit 3**。
`--dry-run` / `--skip-checks` は NOT READY・非0。ソースと既存出力は通常上書きしない。

## 評価・selftest の証跡

評価を始める前に `round-manifest.py begin <label> --roster ... --regimes ... --seeds ...
--parallel N --zip <release.zip>` で版を固定する。評価側とリリース側は同じ commit と ZIP を使い、
roster ID にリリース名を含める。終了後に `g0.py ... --manifest <label> --json` の出力を保存する。
G0 は開始時 manifest と現在の agent/prompt/roster/ZIP の一致を検査し、commit / zip_sha256 /
manifest_sha256 / manifest_verified を JSON に記録する。manifest が無い G0 PASS は提出証跡として不十分。
public 60 の予定 regime / seed を外部の計画と照合すること（G0 PASS は入力した予定の完全性を表す）。

`--selftest-evidence` は実 selftest 実行側が保存した **JSON 出力 envelope** を受け取る。
終了コードと `[3/3] PASS <id>: completed the self-test ...` / `Report: .../summary.json` を含む実出力を捕捉し、実行前後の commit / ZIP 同一性を確認して次の形式で保存する。
ログに秘密鍵・認証ヘッダを含めない。単なる PASS という文字列・手作業の確認フラグは受理しない。

```json
{
  "schema": "ascon-selftest-v1",
  "status": "PASS",
  "exit_code": 0,
  "command": "agent:selftest",
  "agent_id": "ascon-final-epsilon",
  "commit": "<実行した git SHA>",
  "zip_sha256": "<実際の ZIP の SHA-256>",
  "stdout": "<捕捉した selftest 出力>"
}
```

既に準備した出力を最終照合するときは、ZIP を再生成せず同じものを検査する。

```bash
python3 ascon-notes/release/prepare-release.py \
  --source ascon-epsilon --name ascon-final-epsilon --verify-existing \
  --backtest-evidence /path/to/g0.json --selftest-evidence /path/to/selftest.json
```

一致して初めて `RELEASE READY` / exit 0。不正・欠測・不一致は NOT READY / exit 1。
これらはローカル証跡の整合検査であり、偽造ファイルを暗号的に認証するものではない。
selftest の実起動・Docker制限・ZIPの実起動・公式public60は別途必要で、オフラインfixtureでは代用できない。

## 提出前チェックリスト（証跡ゲート）

- 開始前 manifest を保存し、終了後 verify が PASS。
- 予定 public60 の G0 が PASS（全ロスター有限P、欠測・重複・部分採点なし）。
- 実 selftest の終了コード0・実出力・commit/ZIP hash を保存。
- 同じZIPで `prepare-release.py --verify-existing` が RELEASE READY / exit 0。
- ZIP hash / commit / 受理の記録を照合し、本人が送信。

全体の `npm test` は使わず、`node --import tsx --test test/ascon-release-prepare.test.ts` と
`python3 -B -m unittest discover -s test -p ascon_pipeline_evidence_test.py` でオフライン検査する。
