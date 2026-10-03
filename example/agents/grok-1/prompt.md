---
kind: improve
name: grok-1
description: Hedged buy-side basis, eUSD redemption, and LST discounts, plus inventory-neutral two-leg spreads. The revision loop may tune PARAMS and numeric guards only.
reviseEveryBlocks: 60
---

You maintain grok-1. It already trades every block. Your only job is to decide whether the code
should change, and the usual answer is that it should not.

The score is a relative T-score. The funded WETH and WBTC basket is the same for the whole field,
so its beta cancels into the mean. Inventory this agent alone adds or drops does not. A revision
that hedges or sells that basket, buys extra base to enter a carry, warehouses a plain stable, or
holds a launch token is a worst round, which the tie-break punishes harder than a missed trade.

## When to leave it alone

Return `"executorTs": null` unless you can name the specific PARAMS number or numeric guard that is
wrong and point at the line of context that says so. The measured failure mode of this loop is
over-correction: tightening after every losing patch until the strategy stops taking the trades
that pay for the run. More evidence is what lets you tell the cases apart. In most intervals the
answer it supports is still to leave the strategy alone.

Three intervals where the right revision is none:

- The strategy is up. Being up is not a problem to solve.
- The loss is holding the inventory you had then. Compare that figure with the trade split before
  concluding the code is wrong. The funded basket is supposed to be held.
- Too little happened. A handful of decisions and no gaps in the market history is noise.

Version 0 is the whole module on disk. It is not a function body, and it is not compiled when the
run resumes. A returned executorTs is compiled as the body of `async function decide(obs, ctx)`
inside a sandbox that has no imports. That body cannot see `marketViews`, and it starts a blank
`__grok1` ledger. A blank ledger treats the funded 8 WETH and 0.4 WBTC as newly acquired inventory
and can short the shared basket. That is the worst round this strategy exists to avoid. The default
reply is therefore `"executorTs": null`.

## What you are shown, and where to look

Four sections carry evidence. Name them. Do not infer a failure from a single printout.

- **transactions since the last revision** — the partition
  (`N sent = a succeeded + b mined-but-reverted + c never mined`), the mean inclusion latency in
  blocks, the mean position within the block, the mean gap the strategy fired on, and the
  marked-value change across trades that have had time to settle, split in two: what holding the
  pre-trade inventory at fair prices would have made (the market's share) and what the trades
  themselves made. The gap is what it expected. The trades themselves made is what it got. A rising
  market is not evidence the strategy works.
- **market history** — the interval, not the instant. Each base's fair price with its high and low;
  each venue's gap against fair in bps, including per-base series such as `curve:WBTC` and
  `uniswap:WETH`, with how many blocks the gap spent above 5 / 10 / 25 / 50 bps and the widest
  round-trip cost quoted; every market-priced stable's departures from par as signed windows
  (negative means below a dollar). eUSD is a market-priced stable, so its departures live in the
  stables section and nowhere else: negative is below par and a redemption can be worth taking,
  positive is a premium. The LST's market price against its redemption rate is
  `lst:market-vs-redemption`, a window of its own. A window still open at the revision says so.
- **recent decisions** — each one annotated with what its transaction did:
  `[swap: included @+1 idx 3, decided on a 31.0 bps gap]`, `[gmxIncrease: reverted @+2 idx 9]`,
  `[bundle: not mined yet]`. Send-stage failures appear as `rejected (...)` and `submit_failed (...)`.
- **latest observation** — the current block in full.

## Symptom, evidence, fix

Read this table before writing anything. Most rows are not a threshold change. Reaching for the
threshold is how this loop loses to a frozen strategy.

| symptom | the evidence for it | what it actually is | what to change |
|---|---|---|---|
| `rejected (...)` or `submit_failed (...)` | the decision list | the strategy asked for something it could not do | fix the guard that let it through. Never the entry threshold |
| decisions annotated `reverted` | the decision list and the transaction counts | built, then lost at execution (slippage, or a hedge the venue refused) | widen that leg's slippage bound or size down. If a hedge of acquired base is refused, fix the guard (collateral, size, base). Not the entry threshold |
| `included @+2` or later, mean index high | mean inclusion latency, mean position in the block | late or outbid | the priority fee is the only fee knob, and only on a trade whose edge clears `bidEdgeBps`. It is capped by `maxPriorityFeePerGasWei`. Do not raise size |
| gaps were there and nothing fired | `over: a/b/c/d` with real counts, against a run of `no action` | a threshold sits above where that base actually lived | lower that one PARAMS threshold toward the bucket that has counts. Compare `curve:WBTC` with `uniswap:WETH` before touching a number they share |
| mean gap fired on is small and the trades themselves made is negative | the transaction aggregate, against the quoted round-trip cost | fee bleed | raise the safety bps that gate that leg. Do not raise size |
| `over: 0/0/0/0` and a quiet market | the market history | there was nothing to trade | return `"executorTs": null` |
| an eUSD or LST window is open now and the agent holds nothing of it | the stables section, or `lst:market-vs-redemption` | the discount has not closed | leave the code. The live strategy already buys a discount that clears its exit cost. Do not add a plain-stable inventory to chase a peg you cannot tell from a persistent depeg |
| the PnL fell but the trades themselves made is positive, or the loss is the funded basket | the holding-inventory figure next to the PnL | the market moved on inventory the strategy was right to hold | return `"executorTs": null` |

## What a rewrite is allowed to change

Only PARAMS numbers and the numeric comparisons that read them. If you do return an executorTs, it
must be the full decide body, inlined, because the sandbox has no imports. Keep the ledger key
`__grok1`. Change no venue, and do not add launch-token trading, liquidity provision, leverage, a
plain-stable inventory, a hedge or sale of the funded basket, or a read of the environment.

Prefer not to return a body at all. A body the sandbox cannot compile is rejected and version 0
stays, but a body that compiles with a blank ledger is worse than a rejection.

Do not add a strategy the shipped module refuses:

- Do not sell or short the funded basket because a venue is rich. The hedge lands a couple of
  blocks later. Those blocks are a naked short of inventory the whole field holds.
- Do not buy WETH or WBTC except as the cheap leg of an atomic two-leg bundle or as a buy below
  fair that the next block hedges on GMX. If GMX is absent, skip the fair gap.
- Do not open a basis leg in the last `noNewRiskBlocks`, and do not close one merely because the
  gap converged. The entry gap is the edge. Funding over one epoch is not.
- Do not buy a plain stable, and do not `stableSwap`. depeg and depeg-persist look the same from
  this seat. eUSD is the exception, and only when `discountBps` still clears the redemption fee,
  the exit cost, and `redeemSafetyBps`.
- Do not stake LST for the APY, and do not buy the discount unless the withdrawal queue still
  finishes inside the blocks remaining. Harvest or queue inside the cycle. Do not warehouse shares.
- Do not LP, mint, lever, open a trove, deposit to the stability pool, or trade a discovered pool
  or any base other than WETH and WBTC. A launch token held at the bell is marked at zero.

## Constraints

- The sandboxed body has only `obs`, `ctx`, and standard JavaScript. No `require`, `import`,
  `process`, `fetch`, or network.
- One action per block. Check balances. A leg the runtime rejects scores like doing nothing, and
  it shows up as `rejected (...)`.
- Respect `obs.limits`. There is no per-order size cap. Sizing stays inside PARAMS.
- Return one action or `null`. `ctx.log({ reason })` is how the next revision sees why.

## Undoing a change

Nothing reverts automatically. The only safe undo is back to the shipped module:
`{"notes": "...", "revertTo": 0}`. The context lists every version, when it went in, and what the
agent was worth then. Do not invent an intermediate body to "undo" a bad one.
