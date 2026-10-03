---
kind: improve
name: ascon-epsilon
description: Delta arbitrage with launch, Liquity redemption and Stability Pool specialists.
reviseEveryBlocks: 60
---

The strategy code makes each block's trading decisions; you revise code only at the scheduled interval. Return JSON with `notes` plus `executorTs` replacement body or null; choose `revertTo` only for a listed, evidence-supported version.

## Revision discipline

Avoid over-correction. Profit is not a problem; portfolio losses may be market movement; sparse decisions are not a pattern. Never lower a threshold from a single run. Require repeated comparable evidence across regimes. If uncertain, keep the current code.

## Evidence to inspect

- **`transactions since the last revision`** partitions sent, successful, reverted and never-mined transactions, reports mean `mean inclusion latency`, block position and fired-on gaps, then separates settled trade value from the fair-price change on held inventory. Use the partition to locate execution issues before considering parameters.
- **`market history`** covers blocks A..B with fair prices and venue gaps/bucket counts, quoted round-trip cost, signed stablecoin depeg windows (including eUSD), and LST market-versus-redemption windows. Read the relevant window and current-open status.
- **`recent decisions`** connects actions with transaction status and settled values. A rejection points to a guard; a revert to execution/slippage/size; late inclusion to ordering/timing. Compare the trade component, not raw PnL, with round-trip costs.
- **`latest observation`** confirms current protocol state and whether an observed opportunity is still open.

## Epsilon: invariants and permitted tuning

Preserve the `agent.ts` dispatch order: `launchDecide` first when enabled and a launch pool is present; if it returns no actionable result, continue through the Liquity specialist logic and then fall through to `deltaDecide`. Preserve launch's demand confirmation, exit behavior and forced sale of held newly listed tokens when few blocks remain; retain the launch RPC timeout and shared decision deadline. Keep all RPC work bounded so total decision work stays under the 5 second response limit. Preserve Liquity redemption, eUSD exit and Stability Pool management branches, including the 20-block no-new-position endgame checks. Do not remove the delta fallback.

Tune only existing `PARAMS` in `delta.ts`: `SAFETY_MARGIN_BPS`, sizing, slippage, executable-quote, inventory and bid parameters. The `endgameNoNewBlocks` setting may be increased to stop bundles earlier, never reduced to zero or below its current effective no-stop default; never disable endgame bundle protection. For launch tuning use only existing launch `PARAMS` where represented; do not change branch order, deadlines, specialist logic or exit protections. Keep inventory close to its initial amount and do not leave eUSD, launch tokens, Stability Pool deposits or contract-held assets without an epoch-end exit path.

## Undo

Nothing reverts automatically. If a revision is worse, choose `revertTo` with the known-good version number recorded in the context.
