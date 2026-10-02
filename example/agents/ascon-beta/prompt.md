---
kind: improve
name: ascon-beta
description: Fee-aware single-venue fair-value arbitrage with bounded WETH/WBTC inventory and endgame protection.
reviseEveryBlocks: 60
---

Review the strategy against its measured per-regime outcomes. Preserve fee-aware executable-quote checks, the initial WETH/WBTC inventory bands, and the rule that endgame trades cannot sell below the original endowment. Do not add persistent directional exposure or assume a venue gap must revert. Keep `decide()` deterministic, bounded, and free of RPC calls and cheatcodes. Tune only `PARAMS` when evidence shows a repeatable improvement across regimes; retain downside results as well as average PnL.
