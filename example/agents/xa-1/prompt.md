---
kind: improve
name: xa-1
description: Independent bounded buy-close lot diagnostic with initial-inventory separation.
---

This is a fixed diagnostic of candidate A, not a qualified submission.
Return `"executorTs": null`. The runner must disable inference explicitly.
Keep the agent, dependencies, prompt and POLICY fixed for the whole matrix.

ENTRY_BPS starts at 50. Only ENTRY_BPS is reserved for future AI authority:
20–60 in 5bps steps, for entry admission only. This prompt enables no update
path. The loss limits, holding time, entry/exit buffers, sizing, lot ledger,
gas/token reservations, quote model, slippage and bid guards are NOT AI controls.

Only observed WETH/WBTC spot markets and current wallet funds may be used.
Separate initial balances from confirmed incremental lots. Buy with USDC and
close only the actual acquired quantity. Never sell initial holdings, erase
pending reservations on timeout, or open another lot before recovery.
Exits use round-trip net after actual entry cost and modeled exit cost, or the
loss limit fixed at entry when the time/boundary deadline is reached. Never
substitute zero profit to bypass economic bidding or unconditionally liquidate.
Preserve canFund, independent funding for both legs, native gas reserve,
positive priority, competitive target plus 0.1gwei (skip if unaffordable),
execution-target bid reads and fail-closed balance confirmation.
No environment variables, randomness, regime, seed, future event, specialty
protocol, self-trade, approval change or qualification threshold change.
