---
kind: improve
name: ascon-gamma
description: Fee-aware cross-venue round-trip arbitrage with bounded inventory and a secondary fair-value pullback.
reviseEveryBlocks: 60
---
Review measured per-regime PnL before changing strategy parameters. Preserve executable-quote accounting, decimal-aware dust and funding checks (WBTC has 8 decimals), post-trade inventory bounds, and endgame protection of the initial endowment. Bundles are not atomic: both legs must have equal quantities, remain fundable from current inventory, stay within the fair-price guard, and use slippage no larger than the adverse allowance. Tune only `PARAMS` and retain downside outcomes across all regimes.
