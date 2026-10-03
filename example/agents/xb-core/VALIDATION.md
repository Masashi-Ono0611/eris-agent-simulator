# Factor experiment implementation validation

Scope: league-v2 only. Base B and all eight variants, including V6, are present.

Command: `node --import tsx --test test/xb-core.test.ts test/xb-variants.test.ts`

| Test file | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| test/xb-core.test.ts | 21 | 0 | 0 |
| test/xb-variants.test.ts | 36 | 0 | 0 |
| Total | 57 | 0 | 0 |

The tests parse and validate emitted actions using the local-deployment SDK
registry and independently check positive amounts, cumulative input spends
against observed balances, the per-leg 8% asset cap and priority ceilings.
The SDK registry selection is test-only. Agent source has no environment reads.

Ten factor-off mutations were rejected by the same assertions that passed
with the intended factor enabled. These are in-test Params overrides, caught
as AssertionError by the red-control harness; the overall test command exits 0.

| Red control | Enabled observation/result | Factor-off mutation/result |
| --- | --- | --- |
| A | 40 bps after fees: swap | A=60: noop; action assertion fails |
| BID | 200,000,000 wei, competitor plus 0.1 gwei | budget10: different bid; equality assertion fails |
| V3-A | 40 bps, zero competitor: swap at 100,000,000 wei | A=60: noop; action assertion fails |
| V3-BID | Same observation: 100,000,000 wei | budget10: about 150,000,000 wei; equality assertion fails |
| SIZ | 100 bps: approximately 2,500 USDC | depth: approximately 750 USDC; amount assertion fails |
| INV-buy | At 9.6 WETH, 40% band permits purchase | 20% band: noop; action assertion fails |
| INV-sell | At 6.4 WETH, 40% band permits sale | 20% band: noop; action assertion fails |
| MOD-redeem-entry | Quoted eUSD discount: capped USDC purchase | MOD=none: noop; action assertion fails |
| MOD-liquidate | Observed eligible borrower: liquidation | MOD=none: noop; action assertion fails |
| GATE | Exact +75 bps step: shock-pause noop | GATE=off: swap; pause assertion fails |

Invariant observations cover quiet markets, admitted high-edge trades,
inventory-capped sizes, capped bids, low gas, endgame exits and inherited
specialty recovery. V2 keeps the selected candidate and amount unchanged,
including at the gas-reserve boundary. Unaffordable competitor targets are
capped and still trade. GATE tests include both directions, WBTC, subthreshold
moves, exactly three blocks, retriggers, resets and recovery while paused.

V6 tests cover its one-shot 1,200 USDC entry cap, observed eUSD redemption,
native collateral wrapping above reserve, observed WETH sale, confirmation
waits, five-block retries, high-fee/endgame fallback sales, missing-route
noops, restart recovery and bounded liquidation attempts. Additional tests
exercise the zero-RPC contract, a simulated 4-second deadline, malformed
observations, zero liquidity and WBTC decimal normalization.

The single `npm run typecheck` invocation exited 2 with one diagnostic:
`example/agents/xb-core/agent.ts(228,56): TS18047: LOCAL_DEPLOYMENT is possibly null`.
A fail-closed null guard was then added before accessing the deployment's
WETH address. The two targeted test files were rerun after that fix. Typecheck
was not rerun because the task permits exactly one invocation; post-fix type
verification remains unconfirmed. No typecheck pass is claimed.

No backtests, anvil, full npm test, network requests, commits, bundle build,
strategy CLI check or Docker selftest were run. No files under upstream-eval,
ascon-notes/eval/out or runs were accessed or changed. Chain execution,
transaction inclusion and full epoch exits are unverified. These are
implementation checks, not performance evidence.

Files added:

- example/agents/xb-core/agent.ts
- example/agents/xb-core/README.md
- example/agents/xb-core/VALIDATION.md
- example/agents/xb-v0/agent.ts
- example/agents/xb-v0/prompt.md
- example/agents/xb-v1/agent.ts
- example/agents/xb-v1/prompt.md
- example/agents/xb-v2/agent.ts
- example/agents/xb-v2/prompt.md
- example/agents/xb-v3/agent.ts
- example/agents/xb-v3/prompt.md
- example/agents/xb-v4/agent.ts
- example/agents/xb-v4/prompt.md
- example/agents/xb-v5/agent.ts
- example/agents/xb-v5/prompt.md
- example/agents/xb-v6/agent.ts
- example/agents/xb-v6/prompt.md
- example/agents/xb-v7/agent.ts
- example/agents/xb-v7/prompt.md
- test/xb-core.test.ts
- test/xb-variants.test.ts
- test/xb-fixtures.ts
