# xb-r-live: 標準 runtime の自由改訂パイロット

**実計測は未開始。** 初期 `agent.ts` は xb-r v3
`d30cbbb46ca472b5a7a72fc1b99deab96dc97bf3` のバイト同一コピー。
SHA256: `78d8fa43156cee872e1bcbcaf86c1da00f1aa1646c6b210e7af4b499edea4d04`。
現行 `xb-r` の既定 v5 を import しない。ENTRY=50、R9=false。

`prompt.md` は `kind: improve`、`model: claude-cli:haiku`、60 block 間隔。
標準 `improve.ts` / `botMain.ts` が executorTs（JS判断関数本体）を検査して
差し替える。専用 adapter、runtime/SDK/lib の変更はない。初回にモデルへ渡る
v0 ソースはモジュール全体なので、prompt は import/helper/状態の本体化を説明する。
モデルがそれを正しく実行できるかは未検証。

[OFF roster](../../../ascon-notes/league/roster-xb-r-live-off.yaml) と
[ON roster](../../../ascon-notes/league/roster-xb-r-live-on.yaml) は
同じ cand slot・相手・初期 v3 を使い、`ERIS_AGENT_FROZEN` の `"1"` / `"0"` だけが異なる。
`ERISAGENTFROZEN` ではない。別世界で対応比較し、v3/v3-ONを同居させない。
Haiku は本人指定の gpt-oss:120b に近い第一候補という位置付けで、同等性の主張ではない。

安全不変条件は prompt による指示。runtime の静的検査・コンパイル・送信検証は
経済的安全性を保証せず、自動 rollback はない。改訂・revertでworkerの状態も失われる。
シミュレーション（ローカル devnet）のみ。本番提出・資格・性能は別判断。

詳細な32世界の設計、短縮smoke、校正、ログ、停止条件、本人に必要な作業は
[パイロット仕様](../../../ascon-notes/league/XB-R-LIVE-PILOT-2026-10-04.md) に記載。
今は dev7 走行中のため起動しない。鍵・`.env`・Ollama・API課金を使わない。
ローカルの検査は次だけでよく、LLM/チェーンを呼ばない:

```sh
npm run typecheck
node --import tsx --test --test-concurrency=1 test/xb-r-live.test.ts test/improve.test.ts test/runtimeLlmCli.test.ts
```
