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
fee. `MIN_PROFIT_USDC = 0.05` is an explicit common spot/bundle dust filter
for **all** variants, not a Params factor. At depth 300,000 with no binding
size caps, notional = 75,000 × e and profit = **56,250 × e²** USDC. Thus
21/25/29 bps yield approximately 0.24806/0.35156/0.47306 USDC. All clear
0.05, whereas the old 0.5 floor discarded all three and made V1 behave like
V0 in this band. A still controls admission only; this common filter and
other funding/size constraints can reject trades independently of A.

Bidding follows sonnet-1's default-floor-plus-extra semantics. Let F be the
runtime default priority fee (at least 1 wei, clipped to the runtime ceiling),
and E = floor(0.1 × profit / ETH fair / estimated gas × 1e18). In wei/gas:

- BID0: min(ceiling, F + E).
- BID1: min(ceiling, F + E, max(F, competitor_max + 100,000,000)).

This chooses the requested competitor-target interpretation: **total extra
above F**, not the total fee or an extra above the competitor, spends at most
10% of estimated profit. BID1 remains distinguishable when its competitor
target is below F + E. For profit 5.625 USDC, ETH 3,000, gas 200,000 and
F = 0.1 gwei, E = 0.9375 gwei: BID0 pays 1.0375 gwei, while a competitor
at 0.1 gwei makes BID1 pay 0.2 gwei. For profit 0.3515625, E = 0.05859375
gwei; that same competitor target is clipped to F + E in both modes.
An extra rounded to zero still pays F. A zero/nonpositive ceiling rejects
the action instead of sending a zero fee. A ceiling below the default takes
precedence and becomes the effective floor.

Admission conservatively reserves gas at BID0 in both modes so changing BID
alone cannot change the candidate or size. Final `gasSafe` also checks the
actual fee sent, including its floor. Candidates are tried in descending
profit order until one passes this shared admission guard. An unaffordable
competitor target is clipped, not used to reject or rerank candidates.

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
variants: the same effective default floor, with gas reserve enforcement.
A zero ceiling cannot produce a recovery transaction either. Recovery may realize a loss and is not filtered by entry edge.

Every action preserves at least 0.05 native ETH after its estimated gas
cost under the zero-base-fee assumption below. Collateral wrapping retains the greater of 1 ETH and Liquity's
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
Both MOD entries use the same floor-plus-budget bid rule, with positive
estimated liquidation reward or discount-purchase profit. The spot/bundle
0.05 dust filter does not discard tiny positive liquidation rewards.
Liquidations use 700,000 gas; discount purchases use **350,000** consistently
for bidding, admission and final reserve (replacing the mixed 1.5M/350k
estimates). Later redemption/wrap/sale actions each have their own recovery
gas guard. A failed MOD admission or finish does not spend the attempt/allocation
state and falls through to redeem-buy and then spot candidates as applicable.
The common deadline guard still prevents a late fallback from being sent.


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

## Known limits

- Gas cost assumes **backtest base fee = 0** and charges estimated gas × the
  actual priority fee. A nonzero base fee is not covered by this reserve model.
- Gas estimates are fixed: spot 200k, bundle/purchase 350k, liquidation and
  redemption 700k, wrapping 100k. Actual gas above the estimate can violate the
  modeled extra budget or reserve. No transaction execution was measured here.
- Estimated profit excludes priority costs. The default floor is paid separately
  from the 10% extra budget and may exceed a tiny reward; positive estimated
  profit is not a guarantee of positive profit after gas or transaction inclusion.
- GATE=off still maintains fair-price/pause bookkeeping; that state cannot gate
  actions while the factor is off.

Fixed-observation validation is recorded in `VALIDATION.md`. Real inclusion,
contract execution, liquidity disappearance and complete epoch exits remain
unverified. No backtests or performance measurements were run.
