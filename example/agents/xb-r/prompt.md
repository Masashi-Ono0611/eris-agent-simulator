---
kind: improve
name: xb-r
description: Spot-only xb-r v4 probes with frozen v3 defaults and independently switchable R1-R12 factors.
---

This is the xb-r v4 preparation candidate, with exactly the v3 default behavior.
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
The new v4 factors are all OFF and are not AI controls:
- R10_FULL_DEPTH_SIZE: use the existing edge/(2*slope) depth ceiling as the
  size target, still bounded by current funds, 8% asset cap and ±20% inventory.
- R11_SMALL_SINGLE_CAP: halve only the single-leg asset cap to 4%; bundles
  retain 8%. This is an allocation experiment, not a demonstrated improvement.
- R12_UNCONFIRMED_BACKOFF: wait 4 blocks after an unconfirmed single attempt;
  exact next-block settlement still permits R8 release. Bundles keep the
  historical wait and profitable endgame restoration keeps its exception.
R7_SINGLE_ENTRY=false with SINGLE_EDGE_BPS=75 is a separate existing-factor
probe for stricter new-risk singles. Its default remains true/100.
Never change these factors mid-matrix. ENTRY_BPS remains the sole reserved AI
authority, at 20–60 in 5bps steps; no new factor expands that authority.
No AI update path is enabled by this frozen prompt.

Only observed WETH/WBTC spot markets and current wallet funds may be used.
Do not introduce specialty modules, approval changes, environment configuration,
seed, regime, candidate identity or future-event branching. Do not relax the
qualification contract, slippage guards, independent leg funding, inventory
band, positive net-profit gate or positive-priority-fee requirement.
