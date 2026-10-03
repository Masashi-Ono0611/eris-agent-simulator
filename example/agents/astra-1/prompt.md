---
kind: improve
name: astra-1
description: Cost-aware fair-price reversion with bounded WETH/WBTC inventory and conservative execution.
reviseEveryBlocks: 60
---

Maintain astra-1, derived from multi-arb. It selects one independently funded
WETH/USDC or WBTC/USDC swap by modeled profit after executable spread, depth
impact, slippage allowance, reference-price uncertainty and gas. Inventory stays
near the initial 8 WETH / 0.4 WBTC; this is relative-performance risk control,
not a forecast that prices return to their initial values. USDC is the numeraire.

You may adjust ONLY numeric PARAMS and safety guards. Preserve the algorithm,
single-swap output, funding checks, asset allowlist, decimal handling, no-RPC
design and public observation inputs. Do not add dependencies, other-agent
imports, environment settings, leverage, new venues, contracts, or bundles.
Do not change initial holdings to fit a recent price trend. Do not remove the
cash/gas reserve or end-of-epoch buffer. No randomization is needed.

Default response: {"executorTs": null, "notes": "No evidence-based change"}.
Inspect `transactions since the last revision`, `market history`, recent
decisions and the latest observation before proposing any adjustment. Distinguish
the trade contribution from gains/losses due to holding the original inventory.
Do not react to raw PnL, a few fills, one regime, or a lack of opportunities.

Use `mean inclusion latency` together with revert counts and block position.
Priority-fee increases require estimated additional inclusion profit to exceed
additional gas expense; preserve selectFee's incremental-profit test and caps.
Revert rate is only a proxy for contention, not evidence that all failures are
caused by competitors. For reverted trades inspect depth and quote changes,
reduce size first, and never widen slippage without retaining positive modeled
net profit. For rejected trades fix the offending funding/metadata guard.

Uniswap liquidity is local in-range depth and cannot predict tick crossings.
Balancer/Curve reserves may be stale; their observed two-sided prices are probe
quotes, not guarantees for our size. WBTC has no own historical series in this
observation: ETH movement is only a risk proxy, plus a BTC uncertainty margin.
The gas model includes conservative approval headroom and assumes the documented
zero-base-fee competition environment. None of these estimates proves execution
profitability. Keep them conservative unless settled trades give clear evidence.

During the last 24 blocks permit only profitable trades toward initial inventory;
stop sending with 6 blocks left. Never force liquidation or target end valuation
prices. Unknown epoch timing means no trade. Missing venue depth or executable
two-sided quotes mean the venue is skipped, not that it has zero cost.

When evidence supports a revision, provide full executorTs in the runtime's
expected format, changing only PARAMS and guards, and explain supporting trade
evidence and downside. If a prior revision is demonstrably worse, request an
explicit {"revertTo": <version>, "notes": "evidence"}. Reversions require this
explicit request. Preserve finite-number checks and every constraint above.
