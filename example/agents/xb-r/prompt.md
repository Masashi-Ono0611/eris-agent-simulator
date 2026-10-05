---
kind: improve
name: xb-r
description: Spot-only xb-r v5 R9-only diagnostic and independently switchable R1-R13 factors.
---

This is the xb-r v5 diagnostic candidate. Only R9 differs from frozen v3.
It is an ablation setting, not a measured improvement or promotion.
Return `"executorTs": null`. Keep the baked Params and safety invariants unchanged
throughout this fixed experiment. The runner must disable inference explicitly;
this prompt alone cannot enforce frozen execution. This is not a completed live
improvement policy or a qualified submission.

ENTRY_BPS starts at 50. Its design range is 20–60 in 5bps steps; it controls
admission only. It is the sole parameter reserved for future AI authority.
R6_ANCHOR_CROSS, R7_SINGLE_ENTRY, R8_SETTLED_COOLDOWN and R9_BUNDLE_HEADROOM
are fixed diagnostic factors, not AI controls. R8 is ON: only a next-block
single with exact input debit, positive proceeds and gas payment visible in the
wallet may release cooldown. R9 is ON for this single-factor diagnostic: singles use the initial ±10%
band, reserving room for bundles whose independent ±20% bounds are unchanged.
R9 OFF (V3_PARAMS) reproduces frozen d30cbbb behavior. Unconfirmed and bundle attempts retain
the original single cooldown; bundle priority itself is unchanged.
R10–R13 are all OFF and are not AI controls:
- R10_FULL_DEPTH_SIZE: use the existing edge/(2*slope) depth ceiling as the
  size target, still bounded by current funds, 8% asset cap and ±20% inventory.
- R11_SMALL_SINGLE_CAP: halve only the single-leg asset cap to 4%; bundles
  retain 8%. This is an allocation experiment, not a demonstrated improvement.
- R12_UNCONFIRMED_BACKOFF: wait 4 blocks after an unconfirmed single attempt;
  exact next-block settlement still permits R8 release. Bundles keep the
  historical wait and profitable endgame restoration keeps its exception.
- R13_EDGE_SLIPPAGE: cap each leg at the lesser of 80bps, ENTRY_BPS and the
  integer-bps budget from modeled net profit after gas, reserving $0.05.
  The shared exposure is leg-count * input USD + modeled profit; bundles
  share that budget. Reject candidates with less than 1bps room. OFF preserves
  historical 80bps actions exactly. This is a model-based bound, not a guarantee
  against loss: amount-specific execution quotes are obtained later by the SDK.
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
