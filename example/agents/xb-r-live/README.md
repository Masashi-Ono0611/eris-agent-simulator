# xb-r-live: 標準 runtime の自由改訂パイロット

**初回ONスモークは完了、校正未成立（installed=0）。** 初期 `agent.ts` は xb-r v3
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
初回結果と次案は[解析・prompt v2記録](../../../ascon-notes/league/XB-R-LIVE-PROMPT-V2-2026-10-05.md)
を参照。上のパイロット仕様は初回前の設計記録で、未開始表記や39101未使用表記は現在の状態ではない。
今回の作業は xa-1 再スモークと並行する軽量な解析・準備のみで、計測を起動しない。
鍵・`.env`・Ollama・API課金を使わない。
ローカルの検査は次だけでよく、LLM/チェーンを呼ばない:

```sh
npm run typecheck
node --import tsx --test --test-concurrency=1 test/xb-r-live.test.ts test/improve.test.ts test/runtimeLlmCli.test.ts
```

2026-10-05 prompt v2: calm/39101のONスモークはdeclined 4・rejected 1・installed 0。
block 1465の拒否は `import` を含むTSモジュールをJS関数本体として返した構文エラーで再現した。
WBTC除外を試みた点は確認できるが、「195%スリッページ」はWBTCを含まないlive評価額と
重複する3block窓に基づき、固定価格で分解したWBTC 16取引の増減+63.34 USDCとも整合しない。
v2はbody形式の実行可能な最小例（形式確認専用・単独適用禁止）、helper/globals/ctxの対応表、
機械的な変換手順、評価漏れとmarkoutの確認を追加。安全不変条件・v3初期コード・モデル・60block間隔は維持する。
候補は未使用のcalm/39102・ON・F_ref・全長1回で、全応答を記録し校正条件は変更しない。
本体32世界・実改訂の適用・性能は未検証であり、起動・コミットはしていない。
