# Factor experiment implementation validation

Scope: league-v2 only; independent findings in
`ascon-notes/league/GROK-REVIEW-XB-CORE.md`. V0–V7 Params and wrappers are
unchanged. Evidence below supersedes the earlier 57-test snapshot.

Command (including the final rerun after restoring source mutations):

```sh
nice -n 19 node --import tsx --test test/xb-core.test.ts test/xb-variants.test.ts
```

| Test file | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| test/xb-core.test.ts | 28 | 0 | 0 |
| test/xb-variants.test.ts | 45 | 0 | 0 |
| Total | 73 | 0 | 0 |

The command exited 0. The environment printed
`nice: setpriority: Operation not permitted`: tests did run, but the requested
lower scheduling priority could not be applied. This limitation also applies
to the mutation runs below.

## Critical regression evidence

- At fee-adjusted 21, 25 and 29 bps, V1 emits a swap and V0 emits noop.
  Estimated profit is approximately 0.24806, 0.35156 and 0.47306 USDC;
  the common 0.05 floor admits these while the old 0.5 floor rejects them.
  Tests independently check profit ≈ 56250 × edge², reapply the old filter,
  show old V1 = V0 noop, and catch the failed swap assertion. The A factor-off
  control now uses 25 bps rather than the old 40 bps observation.
- Every variant has explicit positive-profit spot and bundle observations,
  plus extreme ETH-price observations where the old extra calculation rounds
  to zero. Actions must have positive fees, respect the effective default floor
  and ceiling, spend no more than 10% of profit on the extra above the floor,
  and retain 0.05 ETH after estimated gas at the actual sent fee.
- Each variant's production Params admits MOD entries only when MOD is on
  (V6). Separate explicit MOD-on combinations exercise both liquidation and
  discount purchase with every variant's other factors, including BID1.
  These use the same positive-fee, extra-budget and reserve assertions.
- The original tiny liquidation reward (`gasCompensationEusdWei = "1000"`)
  sends the default floor with adequate ETH. Exact floor-gas headroom succeeds;
  one wei less and the bare 0.05 ETH reserve both produce noop.
- Zero ceilings fail closed. Zero defaults use a 1-wei minimum when the ceiling
  permits it. A ceiling below the default takes precedence. Ordinary fee tests
  also cover a high default, tiny/large profits and unaffordable competitors.
- BID0 and BID1 remain distinguishable on fixed observations; candidate, size
  and shared admission remain identical when only BID changes. The documented
  arithmetic is floor + budget versus clipped competitor target.

The final suite contains 10 existing factor-off assertion controls, three
old-floor band controls, 16 old-zero-bid controls (spot/bundle × eight
variants), and one tiny-reward MOD zero-bid control. Red assertions are caught
intentionally inside those tests; a green outer suite does not hide a mutation
that unexpectedly passes.

Two additional **actual agent source mutations** were run separately using
the same allowed command. Each mutation was restored before the next run;
the fixed agent was restored in a `finally` block and the final suite rerun.

| Source mutation | Exit | Passed | Failed | Detected by |
| --- | ---: | ---: | ---: | --- |
| Candidate filter restored to `profit >= 0.5` | 1 | 71 | 2 | 25-bps A control and 20–30-bps floor regression |
| Entire `bidWei` function restored to the old absolute-budget formula | 1 | 61 | 12 | Floor/extra unit test, tiny MOD reward, MOD purchase bid, all eight variant fee invariants, low-edge fee invariant |
| Fixed source restored | 0 | 73 | 0 | Complete targeted suite |

The old-bid mutation keeps the new gas guard, so zero fees fail closed in
that run; the in-test old-zero-bid controls separately prove that the fee
assertion itself rejects zero. Temporary mutation/test logs are local
`/tmp/xb-review-{old-floor,old-bid,final-tests}.log` artifacts.

## Warning coverage and retained checks

- A gas-blocked top bundle falls through to an affordable spot candidate.
- Gas-blocked MOD liquidation/purchase falls through to spot. A blocked
  recovery-mode liquidation can fall through to a cheaper eligible redeem-buy.
  A synthetic clock also exercises liquidation `finish` returning noop before
  the redeem-buy branch, without consuming successful-attempt state.
- MOD purchase consistently uses 350k gas for bid, admission and final reserve;
  its exact required headroom succeeds and one wei less fails.
- Redemption amounts now join cumulative EUSD spending checks against the
  observed Liquity balance, closing the invariant gap in review item 7.
- Existing registry validation, funding, inventory/caps, gas guards, state
  resets/cooldowns, GATE timing/recoveries, zero-RPC/deadline behavior and
  bounded Liquity entry/recovery tests remain green.

README Known limits records the zero-base-fee assumption, fixed gas estimates,
default-floor cost outside the extra budget, and unused GATE-off bookkeeping.
These assumptions have not been verified through chain execution in this task.

## Typecheck and scope

The single final `nice -n 19 npm run typecheck` invocation completed with
exit 0 (`tsc --noEmit`, no diagnostics). This replaces the previous snapshot's
unconfirmed post-null-guard status. As with the tests, `nice` reported that
the priority change was not permitted; typechecking itself completed.

Changed files:

- example/agents/xb-core/agent.ts
- example/agents/xb-core/README.md
- example/agents/xb-core/VALIDATION.md
- test/xb-core.test.ts
- test/xb-fixtures.ts
- test/xb-variants.test.ts

No backtests, anvil, full npm test, network requests, commits, bundle build,
strategy CLI check or Docker selftest were run. No files under upstream-eval,
ascon-notes/eval/out or runs were accessed or changed. Real transaction
inclusion, actual gas usage and complete epoch exits remain unverified.
These are implementation checks; no performance claims are made.
