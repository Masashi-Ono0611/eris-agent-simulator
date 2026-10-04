# xb-r v1 — Q0 blocker repair candidate

Implementation candidate only. No chain performance has been measured and no
Q0, F_ref, P or mean-T pass is claimed. The qualification contract, reference
roster and pass criteria are unchanged. Work is confined to league-v2; no
upstream-eval code, inputs or HEAD were changed. No commit was made.

## Provenance and independent design

The parent is **xb-core V0**, itself derived from sonnet-1. Market decoding,
WBTC dust normalization, published inventory anchors, the depth model,
portfolio cap, bundle haircut, sell-leg sizing and fixed gas estimates come
from that lineage. The only runtime import is the existing
`../lib/affordable.js` (`balanceOf` and `canFund`); SDK imports are type-only.
The copied helpers are local to xb-r so the one-agent bundler need not include
the sibling xb-core directory. Existing xb-core and V0–V7 are unchanged.

No multi-arb or clean-arb branches, constants or sizing code were transplanted.
Reference code was read only to check differences. The substantive differences
from multi-arb are:

- Enumerate every admitted spot candidate and ordered venue pair before any
  reservation, then rank each class by modeled profit **after** impact and the
  actual gas bid. This is not widest-spread selection.
- Each bundle leg spends current, independently verified wallet inventory.
  Predicted buy proceeds never fund the sell. A failed reservation is discarded
  before considering the next candidate, and each partial leg fits the 20%
  inventory band when starting inside it.
- Size combines the parent's depth target and the requested balance target,
  with depth, portfolio, cash and inventory limits; it is not spread gain
  multiplied directly into a balance fraction without a depth ceiling.
- A single must restore toward its inventory anchor or have a sufficiently
  large fee-adjusted edge. Competitive bids must be affordable within the V0
  economic budget; zero-fee or clipped-under-target submissions are rejected.

Only WETH/WBTC on Uniswap, Balancer and Curve are eligible. Liquity, launch,
GMX, DAI and all other specialty operations are OFF, including inherited eUSD
recovery and native collateral wrapping. No approval or runtime code is changed.
There is no agent RPC, environment, random, future-event, regime, seed or
candidate-ID input. `runId` is compared only to reset state.

## Factors and defaults

`PARAMS` is frozen. `createAgent(params)` copies and freezes each independent
instance's parameters and owns its own state. Toggle one factor at a time for
diagnosis; factor-off combinations are not claimed equivalent to V0.

| Parameter | Default / enabled behavior | Disabled diagnostic |
| --- | --- | --- |
| R1_BUNDLE_PRIORITY | Try admissible bundles before singles; bundles ignore per-base cooldown; singles require restoration or large edge | Rank all candidates by net profit, apply cooldown to both, ordinary entry is enough for singles |
| R2_BALANCE_FLOOR | Desired size is max(depth target, balance target) | Use the V0 depth target alone |
| R3_ENTRY_ONLY | Entry uses ENTRY_BPS; never subtract that margin from economic edge | Sonnet-style 60bps entry and another 60bps deduction from sizing/profit edge |
| R4_COMPETITOR_BID | Competitor + 0.1 gwei, subject to floor and V0 budget; reject unaffordable target | V0 floor-plus-budget bid, still subject to net-profit and native reserve checks |
| R5_PROFITABLE_RESTORE | Last four blocks may restore toward the anchor if profitable | Hold during the last four blocks |
| ENTRY_BPS | 50; configurable as 45 or 50, strict fee-adjusted comparison | Independent of the R3-off historical diagnostic |
| SINGLE_EDGE_BPS | 100, strict comparison for non-restoring singles | Still bounded by the inventory band |

Funding, positive bids, positive net profit, gas reserve, slippage and the
20% band cannot be disabled by these parameters. In particular R5-off is a
safe hold control, not a switch that reintroduces loss-making forced sales.
R3-off deliberately diagnoses the original double margin; xb-core V0 itself
already separates the admission threshold from sizing and profit.

## Arithmetic and selection

Let `e` be edge after venue fees and `s` the impact slope (1/depth for a
single, the sum of the two reciprocal depths for a bundle).

```text
depth target   = 0.5 * e / (2*s)             [xb-core V0]
balance target = input balance USD * clamp(10*e, 0.025, 0.25)
desired        = max(depth target, balance target)  [R2 enabled]
depth ceiling  = e / (2*s)
size           = min(desired, depth ceiling, other hard caps)
gross estimate = size * (e - size*s) * (bundle ? 0.8 : 1)
net estimate   = gross estimate - gas units * sent fee * ETH fair / 1e18
```

The depth ceiling is the parent's underlying edge-closing size, while the
V0 *half of that size* remains the conservative target. This distinction makes
the requested balance floor effective: it can raise the target up to the
edge-closing ceiling, but cannot override that ceiling. The 2.5–25% range is
a **desired allocation**, not a guaranteed minimum order when a cap binds.
It uses xb-core V4's `10*e` balance mapping, not either reference agent's gain.

Other hard caps remain 8% of liquid spot assets per leg, 90% of input balance,
available wallet funds and the initial 8 WETH / 0.4 WBTC anchors ±20%.
Bundle sizing allows either leg to execute alone within the band; it cannot
rely on the other leg for restoration. Buy room uses the same 1.008 output
allowance as xb-core. A restoring single stops at its anchor rather than
crossing it. A wallet already outside the band can only move toward the anchor.
Rounded actual input notionals feed profit estimation. The trade dust limit
is 50 USDC and the net-profit dust limit is 0.05 USDC.

For each candidate, V0's same-input bid bound is the effective default floor
plus an extra costing at most 10% of estimated gross profit, clipped to the
runtime ceiling. R4 requires `max(floor, competitor + 0.1 gwei)` to fit that
bound. If it does not, the candidate is skipped. "No higher than V0" here
compares the same candidate profit and gas inputs, not different-sized trades.
The total sent fee, **including the default floor**, is deducted once in the
net calculation. Under the simulator's zero-base-fee assumption, gas and
priority payment are the same cost; they are not double charged.

All candidates are built before selection. The selector tries bundles first,
and within each class higher net profit first. Each trial uses a fresh
cumulative token-reservation map. Rejection for funding, bid, profit or gas
cannot consume capital for a later candidate. At most one selected action
(single or two-leg bundle) is returned per observation.

Both legs call `canFund` through the xb-core normalization helper and check
their actual amount against current balances. In particular, the SDK's bundle
crediting of predicted outputs is not used. WBTC retains its actual 8-decimal
amount and uses 18-decimal normalization only for the generic dust check.

Singles retain a two-block per-base cooldown. A preceding single or bundle
cannot cool down a new bundle. Same-block duplicate observations still return
noop. Run changes, block rewinds and horizon resets clear cooldown state. The
earliest available epoch/day boundary is used; unknown or expired horizons
return noop. No new bundle or non-restoring single is opened in the last four
blocks. Even endgame restoration must pass entry, net-profit, bid and funding
checks. Slippage stays **80bps** for every leg, unchanged from xb-core; no
zero-profit 150bps forced-sale path exists.

## Local validation record

Commands executed after restoring all source mutations:

```sh
npm run typecheck
node --import tsx --test test/xb-core.test.ts test/xb-variants.test.ts test/xb-r.test.ts
```

Typecheck (`tsc --noEmit`): exit 0, no diagnostics. Targeted tests: **98 passed,
0 failed, 0 skipped** (xb-core 28, xb-variants 45, xb-r 25). No full `npm test`.

The strategy static check also passed for `xb-r/agent.ts` via
`node --import tsx scripts/checkStrategyCode.ts example/agents/xb-r/agent.ts`
(exit 0, one file, no findings). The npm wrapper was attempted first but its
`tsx` CLI could not open an IPC pipe under the sandbox (`listen EPERM`); running
the same checker through Node's loader succeeded without that CLI pipe.

xb-r includes eight explicit factor-off assertion controls: R1 priority,
R1 cooldown after single/bundle, R2 size, R3 entry, R4 bid, and R5 buy/sell
restoration. Each executes the same assertion against enabled, disabled and
restored Params and records `RED-CONTROL` only after catching AssertionError.

Additionally, `node test/xb-r-red-controls.mjs` actually mutated agent.ts
sequentially and observed the following **uncaught test failures**. Every run
exited 1, with its one selected test failing by `ERR_ASSERTION`; source was
restored after each run and also in a `finally` guard.

| Source mutation | Observed failing test |
| --- | --- |
| R1 remove bundle ranking priority | Bundle before more profitable single |
| R1 apply cooldown to bundles | Bundle after preceding single/bundle |
| R2 remove balance floor | Increased size with depth ceiling |
| R3 deduct 60bps again even for admitted entries | Independently checked size and profit |
| R4 use V0 bid instead of competitor target | Competitor + 0.1 gwei |
| R4 remove positive-fee submission guard | Unaffordable competitor must skip |
| R5 disable profitable restoration | Endgame buy/sell restoration |
| R5 remove net-profit gate | Gas-consuming restoration must skip |
| R5 loosen slippage to 150bps | Every leg remains 80bps |

The final restored 98-test run exited 0 and the script verified the restored
source SHA-256 matches its initial backup:
`a7ec52a51e94bb5518158d0687d104b84292e9266e16ad15e7beccb93080a87a`.
This run's full TAP logs and mutation records are local at
`/var/folders/yk/mx8jn78j6xq0w5l4z9d8hbvw0000gn/T/xb-r-red-controls-XZ0fgy/`.
The script creates a fresh evidence directory on rerun. Run it only when no
evaluation or other process is consuming xb-r, because it temporarily edits
the source. It never edits xb-core, V0–V7 or upstream-eval.

Other checks cover independent/cumulative funding, fallback after rejected
bundle reservation, 45/50bps admission, the 2.5% sizing floor and 25% cap,
gas headroom to one wei, both inventory-band boundaries, WBTC decimals,
disabled specialty actions, duplicate/reset/deadline handling, malformed
observations, prompt loading, SDK action validation and zero context access.

## Unverified boundaries

The net estimate is a **model-based lower-profit filter**, not a chain-proven
lower bound. The inherited impact model, 0.8 bundle haircut, fallback depth
and fixed gas estimates (single 200k, bundle 350k) have not been measured here.
Nonzero base fees, gas above the estimate, intervening price changes and
slippage at execution can invalidate that model. minOut is left to the
unchanged SDK quote path with the unchanged slippage tolerance.

Bundles are non-atomic. This v1 reserves against the current observation only;
it does not add receipt correlation or a persistent in-flight ledger. Removal
of bundle cooldown does not prove safe handling of delayed/partial fills.
Markout adaptation, lot accounting and specialty recovery from the broader
DESIGN-REPAIR-01 are not implemented in this scoped R1–R5 candidate. A skipped
restoration can retain spot inventory at valuation; full liquidation or
nonnegative realized P is not guaranteed.

The improve prompt follows the fixed xb variants (`executorTs: null`). The
runner must explicitly disable inference for frozen diagnostics. A live
improvement policy and its ON/OFF validation remain separate work.

**未検証: チェーン上の性能は未測定。** No backtest, public60, Q0/F_ref campaign,
Docker selftest, transaction inclusion, actual gas, revert, P or T measurement,
submission bundle or live deployment was performed. This experimental xb-r
directory must be qualified and prepared for submission separately.
