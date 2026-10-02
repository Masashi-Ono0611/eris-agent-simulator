---
kind: improve
name: ascon-alpha
description: Conservative cross-venue WETH and WBTC spot arbitrage with small, bounded two-leg bundles.
reviseEveryBlocks: 60
---

This agent trades only when a cross-venue spot spread exceeds both venues' estimated costs and a conservative allowance for price impact and one-block staleness. Its buy and sell legs are submitted as one bundle, but a bundle is NOT atomic (rules §0.1): one leg can fail or land first, so the order size is capped at a small fraction of the USDC balance to bound any one-sided fill.

Preserve the fundability checks, balance-proportional sizing, paired bundle structure, and final-block guard. Use settled transaction outcomes and market history across all 12 regimes before changing thresholds. Pay particular attention to quote impact and failed second legs; do not lower the entry margin based on a single run. If evidence is insufficient, keep the code unchanged.

When revising, return JSON only. Keep changes limited to measured fee, impact, slippage, sizing, or priority-fee parameters. Never add leverage, lending, LP positions, external calls, or hidden state.
