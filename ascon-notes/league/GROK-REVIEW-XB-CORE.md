仕様と実装を突き合わせて、実欠陥だけを洗い出します。まず仕様とコードを読みます。仕様とコア実装の差分を精読します。実装の細部（bid=0、MOD、テストの空断言）を掘ります。## Verdict

V0–V7 の Params 配線自体は仕様どおり（各変種は宣言因子だけ）。実欠陥は **(a) 隠れた `$0.5` 利益床が A=20 を殺す**、**(b) 正の利益見積りでも bid=0 を送れる（gas reserve も迂回）**、**(c) そのゼロ bid をテストが検知できない**。

---

### Critical

**1. 隠れた利益床 `$0.5` が A=20 帯を無効化** — `example/agents/xb-core/agent.ts:145`
```ts
return out.filter(c => Number.isFinite(c.profit) && c.profit >= 0.5)
```
- `entryAllowed` 通過後に、サイズ／利益段の出力へ別マージンを掛けている（README「四段の入力は互いに独立・閾値は profit に届かない」と衝突）。
- 既定 depth=300k では `profit ≈ 56250·e²`。`e∈(0.002, ~0.00298)`（20–30 bps）は **A=20 で入場可・床で破棄**。
- **失敗例（実測）**: fee 調整後 25 bps、`A_EDGE_BPS=20` → `entryAllowed=true`、`usd=187.5`、`profit≈0.35` → V0/V1 とも `noop`/`no funded edge`。A 因子が効くべき帯で V1≡V0。
- red-A は 40 bps（床を越える）だけを見るため、この死帯を検知しない。

**2. 正の利益見積りでも `maxPriorityFeePerGasWei: "0"` を送る（zeta-2 型）** — `agent.ts:85-90,189-191,100-102`
- `bidWei`: `floor(profit·0.1/fair/gas·1e18)` が 0 でも、`positive(profit)` なら 0n を返す。
- `gasSafe(..., bid=0n)` は base fee を見ず `eth >= 0.05 ETH` だけで通る → **reserve ちょうどの ETH でもゼロ bid は通る**。
- **失敗例（実測）**:
  - MOD 清算: `gasCompensationEusdWei="1000"` → `liquityLiquidate` + bid `"0"`。同じ `eth=W/20` で通常利益の清算は `gas reserve` noop。
  - spot: `fair=3e12`、edge 100 bps → `swap` + bid `"0"`（`profit=5.625>0`）。

**3. テストがゼロ bid／A 死帯を落とせない** — `test/xb-fixtures.ts:81`, `test/xb-core.test.ts:25-32`
- `assert.ok(BigInt(a.maxPriorityFeePerGasWei) >= 0n)` は `"0"` を許可（下界なし）。
- bid テストは **上限のみ**（`<= 10%`）。`profit>0 ⇒ fee>0` を主張しない。
- 上記 Critical 1–2 は現行 57 テスト緑のまま残る。

---

### Warning

**4. 候補は利益最大の 1 件だけ；gas 不足で即 noop** — `agent.ts:299-302`  
次点の資金・gas 可能な足を試さない。高 profit・高 gas 見積が弾かれると、安い次点が残っていても全スキップ。

**5. MOD 分岐が失敗しても spot に落ちない** — `agent.ts:270-276`  
`liquidatable` に入ったあと `finish` が deadline/noop でも `return a`。同ブロックの redeem-buy／spot を潰す。

**6. gas コストが priority のみ** — `agent.ts:100-102`  
README「推定 gas コスト後に ≥0.05 ETH」だが `gas·bid` のみ。base fee で reserve 割れしうる。ゼロ bid と組み合わさると reserve 意図が空になる。

**7. `safeAction` が redeem の在庫を見ない** — `test/xb-fixtures.ts:65-72`  
`amountEusdWei` は `>0` のみ。累積 spend／`eusdBalance` 突合なし（実装は `funded` 済みだが、不変条件テストとしては穴）。

**8. red-A が床クリア帯（40 bps）に固定** — `test/xb-variants.test.ts:94-97`  
A 因子の固有帯（20–30 bps）を陽性対照にしていない → Critical 1 を通せない設計。

---

### Suggestion

**9. MOD 入場の bid 計算 gas=1.5M vs `finish` gas=350k** — `agent.ts:289-291`  
同一 action で見積が不一致（過小 bid。10% 超過ではない）。

**10. GATE=off でも `pauseUntil`／`fairs` を更新** — `agent.ts:182-188`  
挙動リークにはならないが、因子オフ時の死んだ状態更新。

**11. 未文書の `$0.5` と hard-coded gas（200k/350k）**  
仕様 §5.1／README の分離算術に無い。実 gas ≫ 見積なら総 priority が「利益の 10%」を超えうる。

---

### 確認して問題なしだった点

| 観点 | 結果 |
|---|---|
| V0–V7 は宣言 Params のみ差分 | `xb-v*/agent.ts` 全件・`test/xb-variants.test.ts:27-30` と一致 |
| A 閾値が size/profit/bid 式に代入されていない | `entryAllowed` は boolean のみ（ただし Critical 1 の床が別経路） |
| BID=1 が 10% 予算を超えない | `min(budget, competitor+0.1gwei, ceiling)` — 実測 OK |
| 売り脚は観測在庫のみ | bundle `funded(obs, base, sell)`；予測買分は使わない |
| RPC=0・`catch → noop`・runId は reset のみ | README／ソース一致；regime/seed 分岐なし |
| GATE 3 block（b..b+2）、回収・endgame 先行 | `pauseUntil=block+3`、`block < pauseUntil` |

---

**やり残しチェック**: コード変更なし（依頼どおり read-only）。上記 Critical 2 件は `node --import tsx` で再現確認済み。テストスイート全体の再実行はしていない（欠陥はソース＋最小再現で足りる）。
