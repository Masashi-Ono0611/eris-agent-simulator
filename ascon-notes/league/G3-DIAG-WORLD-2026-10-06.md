# G3 診断世界（1 世界）の結果 — 2026-10-06

**これは G3 の合否に数えない診断。** F_mix 未解決（fixed-bid-5gwei）・実ログ形式の確認・revision 呼び出しの実挙動の確認が目的。
対象: F_ref（noop・multi-arb・clean-arb・ascon-zeta-r2）、calm、seed 49002、revision ON、並列 1、360 ブロック。eval は main `223f244` の独立コピーで、状態ダンプは上流統合後の deploy から再生成（統合前の古いダンプは「LQTYStaking が 0」で起動拒否された）。Haiku は claude-cli:haiku（サブスク枠、extra usage OFF は本人確認済み）。

## 実測（summary.json・llm ログ）
| 項目 | 値 |
|---|---|
| ブロック／ループ／経過 | 360／362／721.7 秒（violations なし） |
| netPnl（USDC） | noop 0、multi-arb −414.9、clean-arb +88.4、**r2 +762.0** |
| revision 呼び出し | 開始 6、応答 5（見送り 4・無効 1）、未完了 1（走行終了時に進行中） |
| 採用された revision | **0** |
| 1 呼び出しの所要 | 24〜42 秒（上限 300 秒に対し十分短い） |

## 読み方（射程）
- 採用された executor が 0 件なので、**悪意ある／危険な revision が実走で混入するかは何も示していない**。Haiku は 4 回とも「executorTs: null（変更なし）」と返した。実際の競技のモデル（gpt-oss 等）の挙動は別。
- 1 世界・1 seed の PnL は参考値（有意差の根拠にしない）。
- 監査器（revision_audit.py）は **BLOCKED**（期待どおり）: 標準 runtime には recorder が無く、観測 frame・digest が保存されない。失敗（FAIL）は 0。保存形式の整備は未了。
- 認証の注意: 実走環境（env -i）では claude CLI のログインに `USER` 環境変数が要る（キーチェーン参照）。`claude auth login` を実ターミナルで実施済みが前提。

## 未実施
G3 本体（36＋7＋3 世界）、F_mix、prompt 強化版（r3）の revision の挙動、P60、G4。
