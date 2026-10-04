---
kind: improve
name: xb-r
description: Spot-only repair of the sonnet-derived xb-core V0 with independently switchable R1-R9 factors.
---

This is the fixed xb-r v3 repair candidate for diagnosis before qualification.
Return `"executorTs": null`. Keep the baked Params and safety invariants unchanged
throughout this fixed experiment. The runner must disable inference explicitly;
this prompt alone cannot enforce frozen execution. This is not a completed live
improvement policy or a qualified submission.

ENTRY_BPS starts at 50. Its design range is 20–60 in 5bps steps; it controls
admission only. It is the sole parameter reserved for future AI authority.
R6_ANCHOR_CROSS, R7_SINGLE_ENTRY, R8_SETTLED_COOLDOWN and R9_BUNDLE_HEADROOM
are fixed diagnostic factors, not AI controls. R8 is ON: only a next-block
single with exact input debit, positive proceeds and gas payment visible in the
wallet may release cooldown. R9 is OFF: the optional half-band reservation for
bundles needs a separate diagnostic. Unconfirmed and bundle attempts retain
the original single cooldown; bundle priority itself is unchanged.
No AI update path is enabled by this frozen prompt.

Only observed WETH/WBTC spot markets and current wallet funds may be used.
Do not introduce specialty modules, approval changes, environment configuration,
seed, regime, candidate identity or future-event branching. Do not relax the
qualification contract, slippage guards, independent leg funding, inventory
band, positive net-profit gate or positive-priority-fee requirement.
