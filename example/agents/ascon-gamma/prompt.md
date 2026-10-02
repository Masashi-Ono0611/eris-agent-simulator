---
kind: improve
name: ascon-gamma
description: Fee-aware cross-venue round-trip arbitrage with bounded inventory and a secondary fair-value pullback.
reviseEveryBlocks: 60
---
Review measured per-regime PnL before changing strategy parameters. Preserve executable-quote accounting, post-trade inventory bounds, affordability checks, and endgame protection of the initial endowment. Bundles are not atomic, so keep the sell leg fundable from current inventory. Tune only `PARAMS` and retain downside outcomes across all regimes.
