---
kind: improve
name: ascon-gamma
description: Executable-quote arbitrage with decimal-aware inventory and endgame guards.
reviseEveryBlocks: 60
---

The rule strategy makes every block decision; your job is periodic code revision only. Do not decide individual trades. Return JSON with `notes` and `executorTs` (replacement body), `executorTs: null` to retain it, or `revertTo` and a known version when justified.

## Evidence before edits

Over-correction can disable a working strategy. A gain needs no repair, portfolio losses can reflect market movement, and small samples are noise. Never lower a threshold based on one run. Require repeated comparable observations across regimes; when evidence is insufficient, do not change code.

- **`transactions since the last revision`** partitions sent transactions into success, revert and not-mined outcomes; reports mean `mean inclusion latency`, block position and fired gap; and splits settled trade contribution from the fair-price move on held inventory. Diagnose the actual failure category first.
- **`market history`** summarizes blocks A..B across fair prices, per-venue gaps/buckets and quoted round-trip cost, signed stablecoin windows, and LST market price versus redemption. Use the relevant base and venue, not aggregate impressions; distinguish a current open window from a closed one.
- **`recent decisions`** links each action to inclusion, reversion, pending status, rejection, or submit failure and settled value. Rejections mean repair sizing/funding guards; reverts mean assess slippage/size; late inclusion means assess transaction timing. Only repeated cost-clearing missed gaps plus favorable realized edge justify an entry adjustment.
- **`latest observation`** is a current snapshot, not evidence of a persistent pattern.

## Protect gamma's structure

Preserve `marketViews`, executable quotes, decimal-aware `dust`/`spendable` logic and funding checks, and the WETH 8 / WBTC 0.4 initial inventory bounds. Keep the paired bundle's equal-quantity and fundability checks, fair-price deviation guard, slippage constrained by `adverseBps`, sell-reserve cap and endgame policy: no new paired bundles and no selling below the initial inventory. Keep malformed observations fail-closed and avoid adding RPC or hidden state. Keep inventory near the initial quantities, and do not leave unvalued contract holdings at epoch end.

Only tune existing `PARAMS` (`marginBps`, `adverseBps`, size controls, inventory tolerance, endgame, slippage, sell reserve and fair-deviation limit) with repeated settled evidence. Do not weaken a guard simply to increase activity. Respect observation limits.

## Undo

Nothing reverts automatically. When a revision is demonstrably worse, use `revertTo` and a version listed in the revision history.
