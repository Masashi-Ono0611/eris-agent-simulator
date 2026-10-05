# zeta-2 regression diagnosis: u1m

Read-only analysis, 2026-10-03. No backtests, Anvil, network, typecheck, or tests were run. Only this report was written. Code references refer to checkout HEAD `3d86a356f5e2281adc54f4c34023979e7cc2990b`; the pre-existing modification to `sdk/src/constants.local.ts` and other existing workspace artifacts were not changed.

## Finding

**The strongest explanation is a bidding/selection mismatch introduced by the single-leg bid-profit review fix, amplified by worse fills, missed legs, and inventory-dependent WETH liquidation.** zeta-2 keeps incumbent raw-gap selection/sizing but deducts a 75 bps adverse-execution allowance when calculating its bid budget. It therefore still sends many orders whose own conservative profit estimate is nonpositive, at **zero priority fee**. The incumbent bids on a different, positive edge. Equal `bidMode=2 / bidProfitShareBps=3000 / gasPerSwap=140000` does not imply equal bids.

Measured across all 36 indexed scenarios: zeta-2 submitted **4,986** transactions, **2,035 (40.81%)** at zero priority; inc-zeta submitted **5,266**, **zero** at zero priority. zeta-2's **230 of 239 reverts (96.23%)** paid zero priority; incumbent had 7 reverts. Both had **0 runtime `rejected` events**. These counts independently extend the supplied report's included counts, 4,975 vs 5,254, and submit failures, 756 vs 497. A submission is not necessarily inside the scoring window.

This is predominantly **lost execution quality and changed inventory**, not excess gas expenditure or an endgame principal write-off. In calm/201, 85 of 87 matched successful orders execute after the incumbent and at worse prices. zeta-2 saves 0.021249694 ETH in priority fees but loses 937.68 USDC more P. Its SP withdrawal/eUSD exit consumes about 0.13 USDC of fixed-fair value; it does not explain a roughly 938 USDC gap.

This is a **ranked causal hypothesis supported by measured mechanisms**, not an isolated-world causal estimate. u1m contains both strategies and other competitors in the same world. The report itself is labelled **未検証（G0 BLOCKED）**. Its observed mean T is 40.42 vs 53.70, difference −13.28 [95% CI −17.81, −8.80]; these conditional league results are not a submission certification.

## Evidence and counting contract

Inputs: `ascon-notes/league/report-u1m.md`, `ascon-notes/eval/out/u1m/index.tsv`, and each mapped run's `agents/{zeta-2,inc-zeta}.jsonl`, `blocks.csv`, `summary.json`, `events.jsonl`, and `market.json`. The two additional cases are informed-flow/201 (ΔT −43.55) and vuln/203 (ΔT −33.18), from two consistently weak regimes. calm/202 is an important counterexample: zeta-2 beats inc-zeta there.

| Scenario | Run directory | Start block B | Final block B+360 |
|---|---|---|---|
| calm/201 | runs/2026-10-03T11-33-01-195Z | 1542 | 1902 |
| calm/202 | runs/2026-10-03T11-33-04-029Z | 1542 | 1902 |
| cdp-incident/201 | runs/2026-10-03T13-46-22-383Z | 1570 | 1930 |
| informed-flow/201 | runs/2026-10-03T11-58-22-954Z | 1542 | 1902 |
| vuln/203 | runs/2026-10-03T13-01-47-587Z | 1568 | 1928 |

### Final scored P (USDC)

| Scenario | zeta-2 | inc-zeta | noop | zeta − incumbent |
|---|---|---|---|---|
| calm/201 | -1118.67 | -180.99 | -53.89 | -937.68 |
| calm/202 | -328.08 | -372.13 | 443.66 | +44.05 |
| cdp-incident/201 | -3325.99 | 173.67 | 351.55 | -3499.65 |
| informed-flow/201 | -1447.63 | 893.03 | -508.55 | -2340.66 |
| vuln/203 | -1001.80 | 401.10 | 91.83 | -1402.90 |

### Action and transaction counts

S = submitted; I = included (success + revert); R = mined revert; F = submit_failed; J = runtime rejected. The three AMM columns and Other count **submitted transaction legs**, including any outside the scoring window.

| Scenario | Agent | Noop | S | I | R | F | J | Uniswap | Curve | Balancer | Other submitted |
|---|---|---|---|---|---|---|---|---|---|---|---|
| calm/201 | zeta-2 | 255 | 98 | 98 | 4 | 14 | 0 | 32 | 42 | 20 | liquitySwapEusd:2, liquityProvideToSP:1, liquityWithdrawFromSP:1 |
| calm/201 | inc-zeta | 255 | 101 | 101 | 0 | 11 | 0 | 37 | 42 | 20 | liquitySwapEusd:1, liquityProvideToSP:1 |
| calm/202 | zeta-2 | 199 | 174 | 172 | 2 | 7 | 0 | 83 | 58 | 29 | liquitySwapEusd:2, liquityProvideToSP:1, liquityWithdrawFromSP:1 |
| calm/202 | inc-zeta | 199 | 178 | 176 | 0 | 3 | 0 | 90 | 56 | 30 | liquitySwapEusd:1, liquityProvideToSP:1 |
| cdp-incident/201 | zeta-2 | 144 | 201 | 201 | 3 | 29 | 0 | 127 | 41 | 24 | liquitySwapEusd:3, liquityProvideToSP:1, liquityWithdrawFromSP:2, rawTx:2, liquityRedeem:1 |
| cdp-incident/201 | inc-zeta | 144 | 209 | 208 | 1 | 18 | 0 | 123 | 49 | 29 | liquitySwapEusd:1, liquityProvideToSP:1, liquityLiquidate:2, liquityWithdrawFromSP:1, rawTx:2, liquityRedeem:1 |
| informed-flow/201 | zeta-2 | 220 | 134 | 134 | 15 | 22 | 0 | 47 | 47 | 36 | liquitySwapEusd:2, liquityProvideToSP:1, liquityWithdrawFromSP:1 |
| informed-flow/201 | inc-zeta | 222 | 152 | 152 | 1 | 3 | 0 | 60 | 50 | 40 | liquitySwapEusd:1, liquityProvideToSP:1 |
| vuln/203 | zeta-2 | 242 | 121 | 121 | 6 | 6 | 0 | 51 | 44 | 22 | liquitySwapEusd:2, liquityProvideToSP:1, liquityWithdrawFromSP:1 |
| vuln/203 | inc-zeta | 246 | 117 | 117 | 0 | 6 | 0 | 45 | 45 | 25 | liquitySwapEusd:1, liquityProvideToSP:1 |

All noop reasons are no funded venue gap. Nine tapes show 362 distinct logged decision blocks; cdp-incident/201 zeta-2 shows 361, ending at 1929 rather than 1930. There are no internal gaps in any of the ten tapes. In calm/202 each sends two bundle legs at blockSeen 1902 beyond the included window; in cdp-incident/201 inc-zeta sends one swap at blockSeen 1930. These account for the sampled S/I differences; they are not counted as reverts. zeta-2's absent terminal decision would also have targeted a block beyond the scored horizon; its cause is unverified.

Failure types: Balancer reports BAL#507, Uniswap Too little received, Curve Slippage; cdp-incident zeta-2 liquidation failures report nothing to liquidate.

| Scenario | Agent | submit_failed breakdown |
|---|---|---|
| calm/201 | zeta-2 | balancerSwap: 5, swap: 7, curveSwap: 2 |
| calm/201 | inc-zeta | balancerSwap: 5, swap: 5, curveSwap: 1 |
| calm/202 | zeta-2 | swap: 5, balancerSwap: 2 |
| calm/202 | inc-zeta | balancerSwap: 1, swap: 2 |
| cdp-incident/201 | zeta-2 | swap: 13, balancerSwap: 8, curveSwap: 6, liquityLiquidate: 2 |
| cdp-incident/201 | inc-zeta | swap: 12, balancerSwap: 4, curveSwap: 2 |
| informed-flow/201 | zeta-2 | balancerSwap: 7, swap: 11, curveSwap: 4 |
| informed-flow/201 | inc-zeta | swap: 1, balancerSwap: 1, curveSwap: 1 |
| vuln/203 | zeta-2 | balancerSwap: 3, curveSwap: 1, swap: 2 |
| vuln/203 | inc-zeta | swap: 4, balancerSwap: 2 |

### Priority bids and paid fees

Bid statistics cover all submitted transactions, including bundles and specialist actions. Gwei = 10^9 wei/gas. Range is 0–5 gwei for zeta-2 and 0.1–5 for incumbent in every sampled run. Paid ETH sums included gasUsed × min(priorityFeeWei,maxFeePerGasWei), using the report’s local base-fee-zero convention.

| Scenario | Agent | Median gwei | Mean gwei | Zero | 0 < bid < 0.1 | bid ≤ 0.1 | Paid ETH |
|---|---|---|---|---|---|---|---|
| calm/201 | zeta-2 | 0.000000 | 0.494134 | 55 | 1 | 74 | 0.005892462 |
| calm/201 | inc-zeta | 1.242858 | 2.138513 | 0 | 0 | 23 | 0.027142156 |
| calm/202 | zeta-2 | 0.100000 | 0.829335 | 64 | 14 | 122 | 0.015861727 |
| calm/202 | inc-zeta | 0.372455 | 1.657984 | 0 | 0 | 69 | 0.032968732 |
| cdp-incident/201 | zeta-2 | 0.100000 | 1.698055 | 37 | 5 | 112 | 0.037788809 |
| cdp-incident/201 | inc-zeta | 1.228442 | 2.385097 | 0 | 0 | 73 | 0.057884748 |
| informed-flow/201 | zeta-2 | 0.100000 | 1.101723 | 61 | 2 | 86 | 0.016883593 |
| informed-flow/201 | inc-zeta | 1.672274 | 2.369062 | 0 | 0 | 32 | 0.041995356 |
| vuln/203 | zeta-2 | 0.000000 | 0.602124 | 67 | 1 | 97 | 0.008211710 |
| vuln/203 | inc-zeta | 0.820187 | 1.815133 | 0 | 0 | 27 | 0.025061813 |

### Matched successful execution

| Scenario | Matched pairs | zeta lower bid | zeta later txIndex | zeta worse price | Median adverse bps | Mean adverse bps |
|---|---|---|---|---|---|---|
| calm/201 | 87 | 67 | 85 | 85 | 12.81 | 20.74 |
| calm/202 | 153 | 91 | 99 | 97 | 3.07 | 3.27 |
| cdp-incident/201 | 117 | 48 | 101 | 100 | 27.63 | 26.98 |
| informed-flow/201 | 94 | 62 | 83 | 83 | 9.28 | 19.40 |
| vuln/203 | 102 | 74 | 79 | 79 | 11.62 | 14.42 |

### Where the P gap accrues

Cumulative (V_z(b)−V_z(B))−(V_inc(b)−V_inc(B)) at recorded 12-block boundaries; offsets are relative to start B above. The last column exactly reproduces the final P gap (rounding aside).

| Scenario | +60 | +120 | +180 | +240 | +300 | +336 | +360 |
|---|---|---|---|---|---|---|---|
| calm/201 | -37.50 | -226.91 | -544.96 | -602.82 | -720.63 | -784.64 | -937.68 |
| calm/202 | -27.40 | +359.09 | +228.35 | +229.92 | -94.35 | -14.48 | +44.05 |
| cdp-incident/201 | -122.52 | -401.48 | -558.34 | -462.82 | -1452.39 | -2971.75 | -3499.65 |
| informed-flow/201 | -233.40 | -1030.13 | -1588.45 | -2001.63 | -2428.98 | -2278.02 | -2340.66 |
| vuln/203 | +51.44 | -326.36 | -571.70 | -778.32 | -1074.63 | -1076.81 | -1402.90 |

Thus calm/201 already trails by 784.64 before the final 24 blocks; informed-flow/201 by 2,278.02. cdp-incident/201 loses 1,519.36 between +300 and +336. calm/202 reverses from −94.35 at +300 to +44.05 at the end. Endgame changes cannot explain losses accumulated much earlier.

For action association, sum adjacent-block changes in reconstructed inventory.alphaValueUsdc on blocks whose included transactions have the named runtime action type. Cells are **zeta / incumbent USDC**. Mixed AMM includes multiple types in one block and is kept separate. This removes changing marks on free WETH/WBTC but retains final-price exposure and any changing protocol marks; it is not pure execution alpha or counterfactual P.

| Scenario | Curve blocks | Balancer blocks | Uniswap blocks | Mixed AMM blocks |
|---|---|---|---|---|
| calm/201 | -581.88 / -249.43 | -435.86 / -144.33 | -64.32 / +186.90 | +18.02 / +81.08 |
| calm/202 | +345.36 / +681.10 | -22.40 / +423.54 | -1306.30 / -2160.53 | +212.34 / +240.18 |
| cdp-incident/201 | +603.41 / +2247.63 | +1360.94 / +688.01 | -6585.34 / -3598.95 | +259.93 / +71.06 |
| informed-flow/201 | -268.40 / +316.25 | -602.69 / -89.29 | -360.17 / +325.23 | +292.91 / +850.72 |
| vuln/203 | -586.96 / -98.32 | -104.20 / +742.90 | -414.39 / -349.03 | +12.13 / +14.33 |

The AMM associations locate the deficit: calm/201 Curve and Balancer blocks are substantially worse, informed-flow/201 loses across all three venues, and cdp-incident/201 is dominated by Uniswap blocks. These categories exclude initial-block effects, no-transaction blocks, wrapping and Liquity; they should not be forced to sum to scored P.


## Concrete mechanisms and ranked hypotheses

### 1. Single-leg bid edge and zero/subdefault bids: high confidence, dominant candidate

Code:
- Incumbent `example/agents/ascon-zeta/delta.ts:169-198`: legacy raw-gap selection, then `singleProfitEdge = gapAbs - (feeBps + SAFETY_MARGIN_BPS)/10000`.
- zeta-2 `example/agents/zeta-2/delta.ts:181-198`: same legacy ranking, fee+safety gate, and sizing.
- zeta-2 `delta.ts:214-225`: for spot buys, `profitEdge = (fair/price)*(1-fee)*(1-0.0075)-1`; sells use `price/fair` instead. Its selection safety margin is no longer an execution expense, but its 75 bps slippage allowance now reduces the bid.
- zeta-2 `delta.ts:123-150`: a nonpositive single-leg edge returns **0**; positive budgets may also fall below the 0.1 gwei default. Incumbent `delta.ts:93-121` returns the default on nonpositive edge or a subdefault budget.
- Budget remains integer-capped at the configured profit share, fee ceiling, and competitor-plus-bump target. The formula input changed, not the three adopted a30 parameters.

For illustration only, a 1% spot buy gap with a 30 bps venue fee passes the unchanged 80 bps selection threshold. Incumbent budget edge is 20 bps. New edge is `1.01 * .997 * .9925 - 1 = -0.000582275`, or **−5.82 bps**: same order, zero bid. This arithmetic example is not a reconstruction of a saved decision observation.

The behavior is explicitly intentional in the reviewed implementation: `example/agents/zeta-2/prompt.md:33` and `test/zeta-2.test.ts:535-541,551-559` require raw-gap orders to survive nonpositive conservative profit with zero bids. These tests were **read, not executed**. `ascon-delta/agent.ts` is a useful ancestor but not the incumbent runtime: its directional-edge implementation lacks the zeta adaptive bidder and a30 legacy-selection branch. `ascon-zeta/agent.ts:3,70` imports its own `delta.ts`.

Measured execution examples (block numbers are inclusion blocks):
- **calm/201, block 1550:** both buy WETH via Curve. zeta-2 bid 0, txIndex 22, price **3011.991674**; inc-zeta bid **1.774390707 gwei**, txIndex 13, price **3008.797748**. Both sent 3,728.25 USDC (runtime JSONL line 10 in each file, blockSeen 1549). The difference is already present before inventory meaningfully diverges.
- **calm/201, block 1553:** zeta-2 Balancer buy bid 0, index 21, price **3038.582794**; incumbent **0.857670757 gwei**, index 12, price **3021.584767** (JSONL line 13 in each file, blockSeen 1552).
- **calm/201, block 1672:** zeta-2 sells 0.15699751 WBTC via Curve at **60275.147791**, bid 0, index 24; incumbent sells 0.17931196 at **60574.676368**, bid 5 gwei, index 11. The one-block P-gap change is **−63.43**; fixed-fair value changes are −0.48 vs +51.02.
- All matched mined transactions in these five cases land at `blockSeen + 1`. The measured problem is primarily **within-block ordering and price**, not longer confirmation delays. Same-fee ties also matter: calm/201 block 1892 has both bundle bids at 5 gwei, yet incumbent legs execute first and its block fixed-fair gain is +74.09 vs +12.20. Lower bidding is not the sole explanation for every individual fill.

All zeta-2 reverts in calm/201, calm/202, cdp-incident/201 and vuln/203 have zero priority. In informed-flow/201, 14/15 do; its other revert costs 0.000000959186 ETH. Thus the revert count mostly measures missed execution, not gas burning. Submit failures report slippage/simulation errors; they are distinct from local validation rejection and mined reverts (`example/agents/runtime/send.ts:208-289,310-354`).

### 2. Inventory path and unconditional excess-WETH selling: measured amplifier, not a new review change

Both agents sell WETH above the first observed WETH balance through Uniswap at **0.1 gwei**, before calling delta: zeta-2 `agent.ts:52-53,69-73,101`, incumbent `agent.ts:35-42,70`. This can sell a delta purchase on the next block regardless of whether that sale is profitable. Altered fills and failed legs feed back into balances, the next delta order size, and which branch executes.

The table below identifies **non-bundle WETH buys followed exactly one block later by a non-bundle Uniswap WETH sale at 0.1 gwei of at least 99.9% of the bought quantity**. Cash P is `min(buyQty,sellQty)*(sellPrice-buyPrice)`, excluding gas and any excess sold. This is an observed matched-quantity diagnostic, not full strategy P or proof of the branch that selected each order.

| Scenario | zeta-2 pairs / cash P | inc-zeta pairs / cash P |
|---|---:|---:|
| calm/201 | 11 / −297.78 | 14 / −114.85 |
| calm/202 | 21 / −317.91 | 28 / −1,168.83 |
| cdp-incident/201 | 51 / −4,045.01 | 54 / −1,048.36 |
| informed-flow/201 | 11 / −773.85 | 16 / −256.07 |
| vuln/203 | 12 / −213.95 | 8 / −300.30 |

The cdp-incident loss is strongly amplified here: zeta-2's successful Uniswap turnover is **1,075,552.75 USDC** vs **726,129.98**, while total successful AMM turnover is **1,293,255.08** vs **1,005,231.13**. At block 1843 it sells **3.78222356 WETH at 2975.117614** at 0.1 gwei, whereas incumbent buys **2.66429264 WETH via Curve at 2998.671641** at 5 gwei. The one-block P-gap change is **−355.67**. At block 1847 the analogous change is **−296.77**. These late losses cannot be assigned simply to the liquidation incident or to the final SP exit.

Holdings recovered from successful swap base flows plus the manifest's initial 8 WETH / 0.4 WBTC (no wrapping/redemption in these four cases):

| Scenario | Final WETH zeta / incumbent | Final WBTC zeta / incumbent |
|---|---:|---:|
| calm/201 | 2.55086328 / 2.11492074 | 0.56865673 / 0.48077118 |
| calm/202 | 8.00000000 / 8.00000000 | 0.23571098 / 0.15754694 |
| informed-flow/201 | 0.37670782 / 0.18609475 | 0.29621698 / 0.34851378 |
| vuln/203 | 6.70681385 / 4.42533751 | 0.72469811 / 0.39331730 |

These are arithmetic reconstructions from `market.json.notionals`, not direct final balance RPC reads. cdp-incident has native-ETH wrapping/redemption and is omitted from this balance reconstruction. Inventory drift is material: vuln/203 block 1926 has no zeta-2 included transaction but its value falls **110.72**, while incumbent falls **17.93** and executes a WBTC sale. This is why attributing every live-value change to that block's trade would be wrong. calm/202's better zeta-2 outcome likewise disproves “higher bids always improve P.”

### 3. Bundle funding precheck / partial execution: possible secondary contribution

zeta-2 `delta.ts:91-94` checks USDC/WETH dust and the full pre-existing sell balance before considering a bundle; incumbent `delta.ts:83-91` does not. This can change the selected opportunity. Retaining this funding safeguard is appropriate; it is not equivalent to making bundles atomic.

Evidence against it as the general dominant cause: calm/201 and vuln/203 have the same submitted bundle opportunities (5 and 7 respectively), no bundle submit failures, and large deficits. In informed-flow/201 the incumbent has 15 mined bundle IDs vs zeta-2's 12 (one of the latter contains only one submitted leg). zeta-2 has failed bundle legs at blockSeen **1560** (both), **1610** (both), and **1629** (buy only). At 1629 its buy `swap` fails, but the `curveSwap` sell is submitted and lands at 1630. Incumbent lands both legs. See zeta JSONL lines **94–95**, incumbent **95–96**. zeta fixed-fair change at 1630 is +55.44 vs incumbent +252.30; the live P-gap change is −322.33.

The stored logs do not retain complete input observations or rejected candidate lists. It is **unverified** which absent bundle candidates the new precheck filtered, as opposed to later inventory-dependent selection. No runtime balance rejection was logged in the sampled cases or entire league. Do not interpret “no rejection” as proof that the precheck never changed selection.

### 4. Liquity liquidation race and exit ordering: real local divergence, weak global explanation

cdp-incident/201, blockSeen 1751 and 1752: zeta-2 logs two `TroveManager: nothing to liquidate` submit failures (JSONL 187–188). Incumbent submits twice: first reverts at 1752, second succeeds at 1753 and receives **200 EUSD** in decoded transfers. Both bid 0.1 gwei on this branch; its selection code is unchanged. Therefore a fee-rewrite explanation for these particular liquidation attempts is not established; timing/estimation state and the shared liquidation race are plausible.

Both subsequently claim SP gain and wrap ETH. At blockSeen 1755, zeta-2 buys **3,597.686082 USDC** worth of EUSD and redeems **3,665.791648 EUSD** next; incumbent redeems its **200 EUSD** immediately. These are different holdings paths, not evidence that zeta-2's redemption code was globally disabled. The largest cdp gap expansion occurs much later: −1,519.36 from offset 300 to 336.

The added endgame block in zeta-2 `agent.ts:57-67` withdraws principal, then sells EUSD; `agent.ts:91` stops new redemption-path activity in the last 20 blocks. Incumbent `agent.ts:51-67` has no principal exit. Observed exits:
- calm/201, calm/202, informed-flow/201: withdrawal submitted at **1882**, EUSD sale at **1883**, each mined next block.
- cdp-incident/201: **1910 / 1911**.
- vuln/203: **1908 / 1909**.

No sampled principal exit failed or required repeated eUSD retry. Final `market.json.liquityPositionsAtEnd` retains inc-zeta SP principal of **2,499.131005 EUSD** in the first three non-vuln cases, **2,018.517871** in cdp-incident, and **2,497.888986** in vuln/203. zeta-2 has no remaining Liquity-position row. The writer omits all-zero positions (`core/src/realtime/marketSeries.ts:1497-1505`), and relevant artifact reads report no failures.

The incumbent SP claim is valued by the scorer; it is not an unknown agent-owned contract that is automatically written to zero. In the four non-cdp cases, zeta-2's withdrawal plus sale block fixed-fair deltas total approximately **−0.13 USDC**. The much larger live-value swings during those blocks include price changes on other inventory.

The unpriced 8.684976–8.689295 token units in zeta-2's summaries match **LQTY**, not EUSD or a launch token: token address ends in `52b6`, identified by `sdk/src/constants.local.ts:194`. No dollar price is recorded for this reward. Its zero valuation is measured; a dollar loss from it is **unverified**. It does not represent 2,500 EUSD of stranded principal.

### 5. Other review fixes: low priority / inactive in these samples

- Inventory-band math (`zeta-2/delta.ts:95-119,199-206`) is gated by `inventoryBandBps=0` here; persistence fixes (`delta.ts:238-253`) are gated by `persistBlocks=0`. Executable-quote handling is off. These cannot explain the default-path divergence unless runtime settings differed from the roster.
- Forward-gap state preservation (`zeta-2/agent.ts:27-33` vs incumbent `agent.ts:77-80`): the union of action `round` and mempool `blockSeen` records has **no missing decision blocks** in all ten sampled tapes. No observed trigger for the old forward-gap reset.
- Launch tracking/timeouts/hold reconciliation (`zeta-2/agent.ts:109`, `launch.ts:80-95,100-118`) have no observed launch logs or launch transactions in these five cases. The residual reward is LQTY. Keep these fixes; reverting them has no measured justification here.
- Defaults: roster explicitly sets incumbent's three a30 parameters; zeta's `delta.ts:8-14,52` bakes them in. Other relevant defaults match. Commit `d7826f7` adds the reviewed candidate; `7d3855a` adapts launch trap filtering. No runtime source-content hash was found in the inspected artifacts: equivalence to the present source is supported by runtime paths/config and observed behavior, not cryptographically verified.

## Minimal ablation plan for later isolated worlds

No variants were created or executed. Run each variant from the same zeta-2 base, changing **only one named behavior**, with fixed seed, wallet/launch order, roster and funding. Put exactly one experimental zeta in each world; compare against an incumbent control in a separately reset world with the same opponents. Swapping wallet/launch slot in a follow-up is necessary to distinguish bid effects from tie-order effects. Retain noop, compare P−noop and worst-regime P/T, and use the same population when interpreting T. Use the five diagnostic cases first, then all 12 regimes and unused seeds; do not choose solely from calm/201.

| Variant | Single behavior to toggle | What it tests / safety tradeoff |
|---|---|---|
| **A: legacy bid-edge input only** | For the adopted legacy path only, replace `singleProfitEdge` at `zeta-2/delta.ts:222` with incumbent `gapAbs-(feeBps+50)/10000`. Keep new bidder caps, all selection/sizing and specialist/funding fixes. | Best **diagnostic candidate for recovering incumbent P**, because it directly restores the main divergent input. It intentionally relaxes the reviewed adverse-slippage budget estimate on the legacy path; it does **not** preserve that particular economic safeguard. Do not silently call it fully safety-equivalent. |
| **B: old default-fee fallback only** | Keep new profitEdge, but use the old 0.1 gwei fallback for nonpositive/subdefault single-leg budgets instead of zero/subdefault bids (`delta.ts:125,148`). | Separates zero-bid policy from lower positive bids. Likely weaker than A: 0.1 still loses to 1–5 gwei competition. Diagnostic only; it can exceed the new profit-share bound. |
| **C: require an affordable competitive single-leg bid** | Keep corrected profitEdge and caps. Before returning the chosen single leg, return noop if profitEdge≤0 or its capped bid cannot reach `min(maxFeeCeiling, max(defaultFee, competitorFee+bidBump))`. Do not change ranking, bundle policy, or specialist exits. | **Recommended safety-preserving recovery candidate.** It stops sending economically unsupported low-priority orders while retaining corrected accounting, funding checks and exits. It may miss profitable opportunities; equal ceiling bids can still lose tie order. Predicted improvement, not proven incumbent-level recovery. |
| **D: SP principal-exit toggle only** | Disable the added last-20-block principal-withdraw/EUSD-sale block (`agent.ts:57-67`), leaving redemption entry cutoff and other fixes intact. | Low-priority falsification of the endgame hypothesis. Expect much smaller effect than A/C in non-cdp cases. Diagnostic only: sacrifices the principal-exit safeguard. |
| **E: bundle affordability prefilter only** | Temporarily bypass only `delta.ts:93-94`'s new dust/balance checks; preserve positive amount checks and all other code. | Run only if A/C fail to explain informed-flow's bundle divergence. Diagnostic only, unsafe for promotion: permits proposals without funded sell inventory. Do not revert inventory/persistence/launch fixes with it. |

A and B are independent, not cumulative. If A recovers P but B does not, positive bid-budget reduction is important beyond zero bids. If C improves P while retaining the conservative cap, it is the preferred production direction. If A helps but C fails, the data would favor restoring competitive execution on marginal trades, but there is then **no demonstrated way to claim incumbent P and all reviewed economic safety constraints simultaneously**. A may retain all operational review fixes, but not the conservative bid-edge assumption it ablates.

Do not initially change `gasPerSwap`, bid share, safety margin, actual transaction slippage, or all review fixes together. Changing `SINGLE_SLIPPAGE_BPS` away from 75 also turns off `legacyDefaults` (`delta.ts:181`), confounding a “slippage-only” experiment. If the remaining cdp loss persists after bid repair, separately test restricting the excess-WETH sweep to tracked redemption proceeds; that is a new behavioral design experiment, not a review-fix revert.

Success evidence to collect later: P and P−noop, same-seed differences/CI and worst regime; zero/subdefault bid counts; same-opportunity order and fill-price comparisons; separately counted submit failures/rejections/reverts; partial bundles; WETH buy→next-block-sale cash loss; terminal WETH/WBTC/SP/eUSD; and final-24-block P change. A reduction in gas spending or revert count alone is not recovery.

## Limits and reproducibility

- P and interval gaps come from `summary.json` agents' `pnlUsdc` / `valueSeries.intervalSeries.valuesByAgent`, not `netPnlUsdc`. The local harness standardizes final P across non-baseline agents (`ascon-notes/league/league_harness.py:219-226`). Local upstream documentation (`docs/competition-start.md:54-56`) calls one run an epoch and its 12-block boundaries evaluation intervals; P uses the first and last boundaries. No claim is made that this report independently verifies all official epoch-weighting rules.
- Transaction types come from joining runtime `submitted.hash` to `blocks.csv.hash`: the latter labels these transactions `direct`, so grouping its actionType column alone would be wrong. Bundle legs count as separate transactions; distinct `bundleId` values count bundle submissions. Noop records are decisions, not transactions.
- `events.jsonl` observations here are post-run value reconstructions, not the full input seen by `decide()`. Per-block value and fixed-fair changes are measured accounting associations, not transaction-isolated causal P. Fixed-reference fair removes free-base mark movement but protocol marks can still change (`core/src/realtime/reconstruct.ts:1256-1287`).
- Exact matched-order comparison requires same blockSeen, actionType, base and side, successful receipt notionals, and same inclusion block. Adverse bps = 10,000×(zetaPrice/incPrice−1), sign-reversed for sells; order quantities may differ. This is not a same-size execution counterfactual.
- `market.json.notionals` supplies receipt-derived base quantities and execution prices. Pair cash P and turnover are diagnostics and overlap the per-action accounting table; do not add them again to P.
- All five runs have 362 loop iterations, zero reconstruction/market failed reads, and zero unlogged transactions for the two agents. No full saved decision observations, tx traces, per-tx revert reason receipts, or frozen source hashes were available in the inspected evidence. Mined-revert causes beyond their action type and fee remain unverified.
- Observed shared-world fill ordering, liquidation races, inventory divergence and selection feedback prevent exact assignment of the −13.28 T regression to a single code edit. All ablation outcomes remain **未検証 / unverified**.
