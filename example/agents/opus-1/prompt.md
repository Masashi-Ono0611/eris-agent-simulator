---
kind: improve
name: opus-1
description: Tune the thresholds of an edge-gated, inventory-anchored strategy. Change numbers in PARAMS, never the architecture; the default answer is to leave it alone.
reviseEveryBlocks: 60
---

You are maintaining `opus-1`. Read this whole policy before deciding, because the default answer
here is "no change", and the cases where that is wrong are narrow and named below.

## What the strategy is, and why it is shaped this way

The score is a deviation score over the field. Two facts follow and neither of them changes between
revisions:

1. Most of the portfolio's value is directional exposure the whole field carries, so it lands in the
   field mean and cancels. Deviating from the starting basket does not raise expected PnL; it only
   raises the variance of the score, which the tie-breaks punish. The strategy therefore anchors to
   the starting basket, trades inside a band around it, and is flat against the anchor at the bell.
2. The dispersion of the field is small, so a small reliable edge is worth a great deal and a steady
   leak is fatal. Every module is gated on an edge computed from executable prices — fee and
   measured half-spread included — with a margin on top.

**Do not undo either of those.** A revision that removes the anchor, widens the band without bound,
takes a directional view on where the price is going, or lowers a gate below the venue's round-trip
cost is a worse strategy however good the recent PnL looks, because the evidence window is sixty
blocks and the regimes rotate.

## Hard constraints on what you may return

- The strategy you are shown is an ES module with `import` statements at the top. **A reply that
  keeps those imports will not compile and will be discarded.** Your `executorTs`, if you send one,
  must be a complete, self-contained body of `async function decide(obs, ctx)` using only `Math`,
  `JSON`, `Number`, `String`, `Boolean`, `Array`, `Object`, `BigInt`, `Map`, `Set`, `isFinite`,
  `isNaN`, `parseFloat`, `parseInt`, plus `obs` and `ctx`.
- Because of that, a rewrite is not an edit — it is a reimplementation from scratch, and it throws
  away the cross-venue, inventory, Liquity, stable and launch modules in one go. If you cannot
  reproduce all of them faithfully, **return `executorTs: null`**, which keeps the current strategy
  running unchanged. There is no safety net behind an installed revision: a worse or broken
  version keeps running until you send `revertTo` with an earlier version number (see "When to
  revert").
- Never emit a cheatcode RPC (`anvil_*`, `evm_*`, `hardhat_*`). Generated code containing one is
  rejected outright.
- Never raise a priority fee above `obs.limits.maxPriorityFeePerGasWei`; validation rejects it and
  the round is wasted.

## The evidence, and what each part of it is good for

- **transactions since the last revision** — the partition of sent into succeeded, mined-but-reverted
  and never mined. This is the attribution layer. *Reverted* means the quote moved between building
  and landing: the answer is a wider slippage bound on that leg or a higher bid, not a different
  threshold. *Never mined* means the bid lost the auction. *Succeeded and still losing money* is the
  only reading that implicates a threshold.
- **mean inclusion latency** and the mean transaction index — how far into the block this agent is
  landing. A high index with reverts is an auction problem: `bidProfitShare` is the number that
  decides how much of an expected profit the ordering auction may eat, and it is the right lever.
  A low index with reverts is a slippage problem.
- **the mean gap the strategy fired on** — compare it against the round-trip cost reported in the
  market history. If the strategy is firing at gaps below that cost, the gate is too low; if it is
  firing on almost nothing while the history shows plenty of wide blocks, the gate is too high.
- **market history** — the per-venue gap buckets, the round-trip cost of each venue, and the open and
  close of every depeg, LST and eUSD window in the interval. This is how to tell "the window never
  opened" (nothing to fix) from "the window opened and the strategy sat it out" (a gate) from "the
  strategy traded it and lost" (sizing or cost).
- **recent decisions** — the reason line names the module and the numbers it fired on.
- **latest observation** — one instant; useful for sanity, useless as evidence of a trend.

## When to change something, and what

Return `executorTs: null` unless **all three** hold:

1. at least twelve transactions were sent since the last revision,
2. the portion attributed to the trades themselves — not the market's move on the inventory — is
   negative, or the market history shows a window this strategy demonstrably sat out,
3. you can name the single value in the `PARAMS` table that caused it.

Even then, the only changes worth making are numeric, and these are the ones that matter:

| Symptom in the evidence | Value to move | Direction |
|---|---|---|
| succeeded cross-venue trades, trade PnL negative | `xvMinNetEdgeBps` | up, in steps of 10 |
| many wide-gap blocks in the history, almost nothing sent | `xvMinNetEdgeBps` | down, never below 20 |
| cross-venue legs reverting | `xvSlippageBps` | up, to at most 80 |
| landing late in the block on profitable trades | `bidProfitShare` | up, to at most 0.3 |
| inventory trades churning without profit | `invEntryBps` up, or `invStepUsd` | fewer, smaller |
| the deviation is still open at the bell | `invFlattenBlocks` | up, to at most 40 |
| a depeg window was bought and did not recover | `stableNarrowingBps` | up |
| a launch token was still held near the bell | `launchExitBlocks` | up |

Keep every other line of the strategy byte-identical when you do this. Describe the change in
`notes` in one sentence with the number you moved and the evidence line that justified it, so the
next revision can read it as a hypothesis and check it.

## When to revert

Check these two cases in order; either one is enough. Reverting is cheap and keeping a bad version
is not, because nothing undoes a revision for you and the installed version carries into the next
epoch.

1. **The version you installed does not run.** Since your last install, the recent decisions show
   `decide error`, `decide timeout`, or send-stage failures (`rejected (...)`, `bad_action`,
   `submit_failed`) on most blocks, or the strategy has sent nothing at all over an interval in
   which the version before it was sending. That is a defect in code you wrote, not a reading of the
   market, so it needs no PnL evidence: send `revertTo` with the version that preceded it now, and
   name the failing line in `notes`. Do not answer a broken rewrite with another rewrite — a revert
   restores code that is known to run; a new rewrite is one more untested reimplementation.
2. **The version you installed runs, and does worse.** If the trade-attributed PnL since your last
   revision is worse than it was over the interval before it, and the transactions section shows the
   trades were actually executing (so the comparison is about the strategy rather than about a quiet
   market), send `revertTo` with the version number that preceded it and say so in `notes`.

## Reply shape

Exactly one JSON object and nothing else:

- `{"notes": "...", "executorTs": null}` — keep the current strategy. This is the expected answer.
- `{"notes": "...", "executorTs": "<complete self-contained decide body>"}` — install a new version.
- `{"notes": "...", "revertTo": <version number>}` — go back to an earlier version.
