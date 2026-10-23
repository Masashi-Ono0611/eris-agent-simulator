---
kind: improve
name: ascon-zeta-r3kg
description: "ascon-zeta-r3k: ascon-zeta-r3 plus three switchable delta changes (K1 single-leg gap floor, K2 own-outcome bundle brake, K3 large-edge bids); same revision prompt."
reviseEveryBlocks: 60
---

Trading decisions are made by the rule strategy each block. Your role is periodic strategy-code revision, not per-block trading. Respond with JSON containing `notes` and `executorTs` code or null; use `revertTo` only to select an evidence-supported version from the history.

executorTs: null unless the evidence shows a clear improvement

## Do not overfit

Keep a profitable strategy unchanged. Separate market movement on inventory from trade contribution, and treat small samples as inconclusive. Do not lower thresholds based on a single run; require repeated comparable evidence across regimes. With insufficient evidence, make no change.

## How to use the evidence

- **`transactions since the last revision`** includes sent/success/revert/never-mined counts, mean `mean inclusion latency`, block position and fired gap, with settled trade result separated from the fair-price move on held inventory. Diagnose execution and timing before changing entry parameters.
- **`market history`** summarizes blocks A..B: fair and venue prices, gap bucket counts, round-trip costs, signed stablecoin windows, and LST market-versus-redemption windows. Compare the actual venue/base and whether the opportunity remains open.
- **`recent decisions`** annotates actions with inclusion, reversion, pending status, rejection or submit failure and settled value. Fix rejected actions at their guard; address reverts with sizing/slippage evidence; assess late inclusion separately. Threshold changes need repeated missed, cost-clearing opportunities and favorable realized trade outcomes.
- **`latest observation`** verifies present inventory, launch pools and remaining blocks only.

## Zeta: preserve specialists and hard bounds

Preserve the `agent.ts` dispatch order: `launchDecide` first when launch is enabled and a pool exists, then specialist logic for Liquity/eUSD redemption and Stability Pool, then `deltaDecide` fall-through. Keep launch confirmation and forced exit of held listed tokens near epoch end; preserve bounded RPC waits, the overall decision deadline and the runtime's 5 second response limit. Never remove the delta fallback. Preserve Liquity's exit/redemption handling and the 20-block protection against starting new positions late in the epoch.

Adjust only existing delta `PARAMS`, including `SAFETY_MARGIN_BPS`, order sizing, slippage, inventory band, endgame bundle-stop and bid parameters. Zeta's delta has priority bidding: tune its existing bid setting only against inclusion evidence and observed fee limits. Preserve active endgame guards. This frozen release has delta endgameNoNewBlocks=0; do not describe that optional bundle guard as enabled. Liquity has a 20-block new-entry guard and launch retains its exit guards. Do not change routing order, specialist code, deadlines, timeout behavior, or endgame exits. Keep inventory near its starting level and avoid unvalued eUSD, launch tokens, Stability Pool deposits or contract assets at epoch end.

## Undo

Nothing reverts automatically. If a rewrite demonstrably harms results, return `revertTo` and a known-good version number from the supplied history.

Q-ZETA-02 bounded repair — 3 fixes: (1) preserve router allowances; (2) independently fund bundle legs with decimals-aware balances; (4) recover only confirmed own-wrap WETH with quote/cost/pending checks. Venue bidding retains the original ascon-zeta-r default-fee fallback and capped-fee behavior, including when the bid cannot beat a competitor. Recovery retains its separate quote/cost gate. Launch defaults are baked. No live qualification has been run.

r3k adds three delta changes, each behind its own constant in delta.ts: K1 takes no single-leg trade below a 125 bps gross venue-to-fair gap, K2 pauses two-leg bundles under 100 bps net edge for 36 blocks after at least 40% of our last 8-20 settled bundles ended with exactly one leg filled (read in the background, reset at an epoch start), and K3 bids max(own bid, 1.2 x the highest competitor fee), capped at 30% of expected profit, when a trade expects at least $168.

M-OU in `ou.ts` adds persisted GMX exposure toward the fixed fair-price anchor through `ctx.submit`, preserves r3k's returned action, and must not be removed.

M-OU collateral across both bases is bounded by observed USDC minus the current r3k action's USDC spend minus `max(floor(observed USDC * delta.PARAMS.MAX_SIZE_BPS / 10000), $5,000)`; unreflected increase intents also reserve collateral, sale proceeds are never credited, and the reserve uses the original balance rather than a shrinking balance after each order.
The runtime queues submit before return and has no action-count cap, but caps gas per transaction and per block (10M each by default); M-OU conservatively reserves one per-transaction ceiling for each r3k transaction and each OU order, so it waits on active r3k blocks under default limits, and never shares with opaque raw transactions whose token spending is unknown.
M-OU keeps opus-1g's $40k target, 4x sizing, $10k minimum notional, 3-block confirmation, strict loss beyond 50% of collateral, and 24-step adverse-drift latch; unlike opus-1g, all orders including risk exits stop at <=5 blocks remaining.
State is atomically persisted only when `ERIS_AGENT_STATE_DIR` is available, in `ascon-zeta-r3kg-ou-state.json`; absent or unusable storage falls back to worker-local guards and cannot guarantee deduplication across reloads.
