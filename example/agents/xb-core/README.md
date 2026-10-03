# Masa-Ascon V2 factor base B

Specification: `ascon-notes/league/MASTER-PLAN-2026-10-04.md` §5.1 and
`ascon-notes/league/PLAN-MASA-ASCON-V2.md` §§2–3. This is a new experimental
base derived from `sonnet-1/agent.ts`, not a claim of equivalence to sonnet-1.
Only the six fields in `Params` vary. There is no compatibility switch.

| Variant | Change from B |
| --- | --- |
| xb-v0 | None |
| xb-v1 | A_EDGE_BPS = 20 |
| xb-v2 | BID_MODE = competitor + 0.1 gwei, budget capped |
| xb-v3 | A and BID |
| xb-v4 | SIZ_MODE = balance-2.5-25 |
| xb-v5 | INV_BAND = 0.4 |
| xb-v6 | MOD = Liquity liquidation/redemption |
| xb-v7 | GATE = three-block pause |

Each variant freezes its complete Params and creates its own decision state.
Its improve prompt requests no executor revision during the fixed experiment.
Inference must remain disabled by the experiment runner; a prompt alone cannot
enforce runner configuration.

## Separated arithmetic

Entry compares venue-fee-adjusted edge with a strict 60/20 bps threshold.
The threshold is not subtracted from edge and is not passed to sizing, profit
estimation or bidding. Single-leg edge is fair/mid − 1 − fee for buys and
mid/fair − 1 − fee for sells. Two-leg edge is rich/cheap − 1 − both fees.

Depth sizing is 0.5 × edge / (2 × impact slope), with slope 1/depth for
one leg and the sum of reciprocal depths for two. Balance sizing uses the
input balance × clamp(10 × edge, 0.025, 0.25). Both then apply the same
8% liquid-asset cap per leg, 90% cash limit, inventory limits and funding
checks. Portfolio value for this conservative cap is USDC plus observed
WETH/WBTC at fair; native gas ETH and specialty holdings are excluded.

Estimated spot profit is notional × (edge − notional × slope), with sonnet's
0.8 haircut for bundles. It does not deduct the entry threshold or priority
fee. The priority budget is floor(0.1 × profit / ETH fair / gas × 1e18).
Budget10 pays that budget, capped by the runtime ceiling. BID1 pays the
lesser of competitor + 100,000,000 wei, that same budget and the ceiling.
The runtime default fee is never added or forced as a floor. An unaffordable
competitor target is clipped, not used to reject or rerank candidates.
Admission reserves gas at the budget10 bid in both modes.

## Common safety and state

All variants check positive amounts, actual balances and `canFund`.
WBTC is normalized only for the library's 18-decimal dust check; its real
8-decimal balance still limits the amount. EUSD recovery uses Liquity's
observed balance. Bundle sell legs cannot spend predicted buy proceeds.
Each bundle leg also fits the inventory band independently, so a partial
execution does not rely on the other leg restoring inventory.

Inventory anchors are the published initial 8 WETH and 0.4 WBTC. The last
four blocks prohibit new spot risk and restore deviations toward those
anchors at available venues, subject to funding, depth and gas guards.
The earliest of epoch/day remaining blocks wins; an unknown horizon or
valuation boundary produces noop. Recovery fee policy is identical for all
variants: runtime default capped by the runtime ceiling, with gas reserve
enforcement. Recovery may realize a loss and is not filtered by entry edge.

Every action preserves at least 0.05 native ETH after its estimated gas
cost. Collateral wrapping retains the greater of 1 ETH and Liquity's
suggested reserve before estimating transaction gas. No agent RPC calls,
promises, timers, logging or context accesses occur: the RPC call budget is
zero, so there is no RPC timeout or outstanding request. Work is bounded
to two bases and three venues; a monotonic 4-second pre-return guard leaves
one second inside the runtime's 5-second decision limit. Exceptions return
noop. There is no guarantee under process suspension or an exhausted host.

GATE compares consecutive observed fair values of either base. A step of
at least 75 bps pauses all new risk at blocks b, b+1 and b+2; b+3 resumes
unless another shock extends the pause. Observed specialty recoveries and
endgame inventory exits run before this gate. Duplicate observations do
not resubmit; spot entries have a two-block per-base cooldown. Run identity
changes, block rewinds or horizon resets clear state. Identity is used only
for reset, never for regime/seed selection.

The native wrapping target comes directly from the SDK's generated
`constants.local.ts`, avoiding the environment-selecting `constants.ts`.
These agents target this checkout's deterministic ASCON deployment, not an
Arbitrum fork. No SDK or existing strategy file was changed.

## V6 bounded Liquity module

V6 reuses astra-2's liquidation eligibility checks, redemption fee/impact
and debt-rise sizing, and balance-confirmed collateral recovery. Its scope
excludes launch, DAI, GMX, trove opening and stability-pool deposits.

New specialty actions require more than 40 remaining blocks, an observed
WETH exit venue and a quoted eUSD pool with at least 120,000 USDC depth.
Discount purchases are limited to one submission and at most 1,200 USDC
per epoch, further bounded by portfolio, cash, pool depth, imbalance,
protocol debt/fee-rise and the front trove's redeemable debt. Failed buys
consume that one-shot allocation; a late fill still enters common recovery.
Liquidations target the observed borrower, with at most three submissions
per epoch and five blocks between attempts on one borrower.

Recovery consumes only already observed eUSD. With sufficient time and
eligible troves it redeems at most 1,200 eUSD per action with a bounded fee
and iteration count. Otherwise it sells eUSD through the quoted pool,
including during endgame. Native proceeds above reserve are wrapped;
the subsequent WETH balance increase must be observed before collateral
sale. Wrap/sale attempts wait for balance confirmation and can retry after
five blocks. Missing exit liquidity causes noop and retains wallet assets;
no proceeds are assumed or transferred into a custom contract. Tiny dust
can remain below `canFund`'s dust threshold.

Common recoveries also apply to V0–V5/V7 if given inherited specialty
balances, and ignore MOD/GATE/entry/sizing/band/bid settings. A worker
restart discovers held eUSD and excess native ETH; wrapped holdings are
also subject to the common endgame inventory exit.

Fixed-observation validation is recorded in `VALIDATION.md`. Real inclusion,
contract execution, liquidity disappearance and complete epoch exits remain
unverified. No backtests or performance measurements were run.
