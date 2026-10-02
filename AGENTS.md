# ASCON 参戦リポジトリ — 作業ルール（Codex / Claude 共通）

目的: ASCON（Nyx Foundation 主催 DeFi エージェント競技）で優勝する。
このリポジトリは `NyxFoundation/eris-agent-simulator`（MIT）を取り込んだもの。
**正は常に upstream の `docs/competition-start.md`。規約は https://ascon.dev/rules が最優先。**
自分用のメモ・テンプレは `ascon-notes/` に置く（upstream のファイルと混ぜない）。

## 提出物
- 1 エージェント = `example/agents/<id>/`（`agent.ts` に `decide(obs)` + `prompt.md`（frontmatter `kind: improve` / `name` / `description` 必須））
- 自分の戦略は `example/agents/ascon-*/` に作る。既存の参照エージェントは改変せずコピーして使う。
- 提出前: `npm run typecheck` → `npm run check:strategy` → public 60 シナリオで backtest → `npm run bundle:agent <id>` → `agent:selftest`。
- `run(ctx)` 形式は `prompt.md` と共存できず提出不可。必ず `decide()`。

## 戦略の評価基準（採点の要点）
- 採点 = エポック終了時の資産価値の損益 P を全参加者で偏差値化（後半エポックほど重い）。途中の含み益は無意味。
- 12 レジームほぼ等しい重み。単一レジームへの合わせ込み禁止。**何もしない参照との差、レジーム別の最悪値**を見る。
- 在庫の無い側の leg は検証で弾かれ「何もしない」と区別できない → `example/agents/lib/affordable.ts` の `canFund` を使う。
- 自分のコントラクトに残した資産は終了時 0 評価。cheatcode(`anvil_*`/`evm_*`)禁止。

## 絶対ルール
- 秘密鍵・RPC ヘッダ値・API キー・`.env*` を commit / 出力しない。ログにも出さない。
- devnet 専用の新規ウォレットのみ。Anvil 既定鍵は **ローカル anvil でのみ**使ってよい（練習 devnet・本番では禁止）。
- 練習 devnet はレート 100 req/秒（eth_call/estimateGas/getLogs は5倍換算）。使えない RPC: `anvil_*` / `evm_*` / `eth_sendTransaction` / `txpool_*` / `eth_subscribe`。
- 規約 §8: 評価価格を歪める取引・自分の複数提出間の資産移動（自己取引）は禁止。
- main へ直 push しない。branch → PR。upstream 由来ファイルは原則改変しない（merge 衝突を避ける）。
- `npm install` 系は `NPM_CONFIG_IGNORE_SCRIPTS=true` を付ける（外部 repo の postinstall を実行しない）。

## 完了条件
変更は `npm run typecheck` と関連テストが通ってから報告する。Docker / 外部ネットワークが要る検証を実行できなかった場合は「未検証」と明記する。
