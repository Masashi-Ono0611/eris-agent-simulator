# clean-arb の収益構造と ascon-beta との比較

- `clean-arb/agent.ts:13-18` は往復の安全幅を `ERIS_ARB_SAFETY_BPS`（既定 60 bps）、最小/最大サイズを資本の 2.5%/25%、スリッページを各 leg 120 bps とする。
- `agent.ts:46-51` は最安 venue と最高 venue の mid 乖離を `rich/cheap - 1` として測る。成立条件は乖離が両 venue の `feeBps` 合計＋安全幅を**超える**こと。
- `agent.ts:59-69` は純 edge（乖離−見積りコスト）をサイズへ線形変換し、USDC 資本の所定割合を投入する。強い乖離ほどサイズが増えるが最大 25% で止まる。
- `agent.ts:70-72` は買い出力を mid で概算し、売り leg をその 98% にする。2 本目が落ちた際にも販売量を抑える意図と読めるが、残余在庫リスクは残る。
- `agent.ts:80-93` は買い leg と売り leg を bundle 化する。コメントは bundle の原子性を保証せず、価格影響・逆行を fee 合計と安全幅で見積もる設計。
- **推測:** 大きな 1 件あたり利益は、コストと安全幅を越えたクロス venue spread に絞り、最低 2.5% の資本サイズで往復するためと考えられる。実現利益の因果は個別約定・残余在庫ログで追加確認が必要。
- `multi-arb/agent.ts:16-18, 120-133` は同じ2-leg機会に加え、機会がないときに fair value へ寄せる単発 leg を出す。clean-arb はファイル先頭コメントと実装上、その単発 fallback を持たず選別が狭い。
- `ascon-beta/agent.ts:78-85, 104` は venue の `buyPrice`/`sellPrice` を優先して edge を算出する一方、midGap 条件に `feeBps + marginBps` も要求する。
- **二重計上の結論: あり（乖離ゲート側）。** `buyExecution = buyPrice` / `sellExecution = sellPrice` があれば約定価格で手数料込み edge を計算し、さらに `midGapBps <= feeBps + marginBps` を独立ゲートとして適用するため、fee が edge 条件に加えて乖離条件でも要求される。`edgeBps <= marginBps` 自体は安全幅であり fee の再控除ではない。
- `ascon-beta/agent.ts:9-15` の既定 margin は 50 bps、最大 size は 25%、在庫許容帯は初期値 ±25%、終盤 12 block は初期在庫を下回る売却禁止。したがって取り逃しの大きさは**仮説**で、backtest で閾値変更を比較する必要がある。

## 入力欠落

- `example/agents/clean-arb/prompt.md` はこの worktree に存在しない。上記は `agent.ts` の実装・コメントを根拠にした。
