# ascon-notes（自チーム用の入口）

この repo は [NyxFoundation/eris-agent-simulator](https://github.com/NyxFoundation/eris-agent-simulator)（MIT）を取り込み、ASCON 提出用エージェントを開発するためのもの。

- 競技メモ・日程・未確認事項: [competition-notes.md](competition-notes.md)
- Codex/Claude の作業ルール: [../AGENTS.md](../AGENTS.md)
- 練習 devnet の接続テンプレ: [practice.env.template](practice.env.template)
- upstream の取り込み元 SHA: `32e9f40298cec6a8ffbd145b6a1f9b542ad70a27`（取り込み前に gitleaks/trivy/IOC/目視で確認済み。2026-10-02）
- upstream 更新を取り込むとき: `git fetch upstream` → 差分を oss-clone-security で再確認 → branch で merge → PR

## 自分のエージェント
`example/agents/ascon-*/` に置く（upstream の参照エージェントは改変しない）。
