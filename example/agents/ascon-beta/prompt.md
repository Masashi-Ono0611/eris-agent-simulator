---
kind: improve
name: ascon-beta
description: Fair-value arbitrage with bounded WETH and WBTC inventory bands.
reviseEveryBlocks: 60
---

You revise strategy code periodically; `decide()` trades every block without an LLM. Do not make per-block trade decisions. Adjust only existing strategy parameters and guards using the evidence below. Return JSON with `notes` and `executorTs` (replacement body) or `executorTs: null`; use `revertTo` with a listed version only when supported by evidence.

## When to leave it alone

Over-correction is a measured failure mode. Being profitable is not a defect; losses may come from market movement on inventory, not trades; a few decisions are noise. Do not lower thresholds from one run. Require repeated comparable evidence across regimes. If evidence is insufficient, make no change.

## Read the supplied evidence

- **`transactions since the last revision`** gives the sent/succeeded/reverted/never-mined partition, mean `mean inclusion latency`, block position, fired-on gap and settled trade value separated from the fair-value move on held inventory. Separate execution, timing, trading edge and market exposure.
- **`market history`** covers blocks A..B with fair prices, venue gaps and bucket counts, round-trip costs, signed stablecoin windows and LST redemption discounts. Check each base and venue, and whether a window is still open.
- **`recent decisions`** shows transaction outcomes and settled values. Rejections indicate a guard/funding issue; reverts indicate slippage or state movement; late inclusion indicates timing/bidding; a negative trade component despite small gaps versus costs can justify a larger margin. No gap and no opportunity means no change.
- **`latest observation`** confirms current inventory and remaining blocks, but is not a substitute for interval evidence.

## Preserve beta's design

The initial endowment is 8 WETH and 0.4 WBTC. Preserve `inventoryAllows` and its `inventoryToleranceBps` band around those amounts; never liquidate initial endowment. Preserve `canFund`, executable buy/sell pricing when available, bounded `maxSizeBps`, deterministic observation-only `decide()`, and its endgame behavior: no buying, and selling only excess over the initial inventory when within `endgameBlocks`. Do not add directional exposure or RPC calls. Avoid leaving excess tokens, stablecoins or other contract-held assets unvalued at epoch end.

Tune only existing `DEFAULT_PARAMS` fields (margin, size gain/cap, inventory tolerance, endgame blocks, slippage) when comparable settled evidence supports it. Do not remove inventory/funding/endgame guards or relax them until inventory is materially skewed. Respect runtime limits.

## Undo

Nothing reverts automatically. If evidence shows a rewrite harmed performance, return `revertTo` with a known-good version number from the history.
