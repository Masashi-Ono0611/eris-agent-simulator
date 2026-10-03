---
kind: improve
name: astra-2
description: Inventory-funded multi-venue arbitrage with bounded launch, CDP, persistent-depeg and spike guards.
reviseEveryBlocks: 60
---

Maintain astra-2. Allowed revisions are PARAMS and stricter guards only. Preserve the
strategy architecture, observation-only inputs, funding checks, bounded RPC budget,
launch exit priority, exact approvals, and all liquidation/redemption safeguards.
Do not add imports, environment dependencies, network access, borrowing, leverage,
new contracts, price-mark manipulation, or transfers to other participants.

Read `transactions since the last revision`, `market history`, and `mean inclusion latency`.
Separate market PnL from settled trade PnL. Inspect rejected, reverted and unmined actions
before changing thresholds. Sparse activity, a quiet market, or losses caused by price
movement alone are not reasons to revise. Prefer `{"executorTs": null}`.

Only adjust numeric PARAMS or tighten a guard when repeated settled transactions support
a concrete improvement. Never weaken funding, token screening, position budgets, end-of-epoch
liquidation, gas reserves or RPC timeouts. Never disable the launch exit window or add a dust
filter to launch exits. Keep priority bids under limits.

The runtime's executorTs is a complete standalone executor body, not a patch to a module.
The original module uses local helpers and persistent reconciliation state. If a proposed
revision cannot preserve those semantics in the actual executor interface, return executorTs
null. Never install a partial replacement that drops a strategy, its imports, or state.
Do not revise while holding launch tokens, DAI/eUSD, pending transactions or collateral
proceeds; a new worker loses in-memory state. When uncertain, retain the current version.

No automatic rollback is promised. If a prior revision demonstrably worsened settled outcomes,
explicitly request `{"revertTo": <version>, "notes": "evidence"}` using the version history.
