# Zeta r3 pre-trade guard: BLOCKED by installation boundary

## Current fallback status (2026-10-06)

The fallback `example/agents/ascon-zeta-r3/` has been created. Its `agent.ts`,
`delta.ts`, `launch.ts` and `launchSwap.ts` are byte-identical to r2. Only `prompt.md`
changes: the r3 name/description and the sentence
`executorTs: null unless the evidence shows a clear improvement`.
It retains `kind: improve`, `reviseEveryBlocks: 60`, and no model line.

**Prompt hardening is NOT enforcement.** Its effect on real revisions is unverified;
live protection against a harmful revision remains absent in stock runtime.
The runtime is part of the submission bundle and must NOT be modified: our boundary
review requires sdk/runtime/lib/core to remain byte-identical to upstream. Whether
the organizer overrides the bundled runtime is unverified. This fallback changes
none of those files. The existing blocker reproduction test is retained unchanged.

Current candidate tree SHA-256:
`a03da51869cf8c8160aaa25eb5f1e87cfa74a3a9dfdac3050945a71f7d143dff`.
Computed with the repository's `local_tree` implementation (without preflight):

```sh
python3 -B - <<'PYHASH'
import runpy
from pathlib import Path
m = runpy.run_path('ascon-notes/league/g3/prestart-check.py')
print(m['local_tree'](Path('example/agents/ascon-zeta-r3'))['sha256'])
PYHASH
```

The same function reconfirmed r2's hash:
`153becef74bebb21acf8674191407ee941b2844a4cb4fa25716b111390eade59`.
`test/ascon-zeta-r3-identity.test.ts` checks code SHA-256 equality, the exact prompt
diff, 32 unrevised replay frames, and poisoned-env behavior with a red control.
Current local validation: PASS, all 12 tests (r3 identity 4, existing r2 6, unchanged
blocker reproduction 2); PASS, `npm_config_offline=true npx tsc --noEmit` (exit 0).
The r3 checks cover 32 equal replay frames and 96 poisoned-env comparisons plus
an SP probe and a restored-env red control. The passing blocker tests still prove
safety FAIL for malicious stock-runtime revisions; they do not establish protection.

```sh
node --import tsx --test test/ascon-zeta-r3-identity.test.ts test/ascon-zeta-r3.test.ts test/ascon-zeta-r2.test.ts
npm_config_offline=true npx tsc --noEmit
```
`npm run check:strategy` cannot be run by this agent in this task; the supervisor
runs it. Strategy-check acceptance remains unverified here. No simulation, network,
or commit is authorized or performed.

## Original blocker record (before fallback; preserved below)

The remaining sections record the earlier enforced-guard request and its validation.
Their statements that r3 was not created, no new hash existed, or r3 identity/env
checks were absent describe that earlier state, superseded by the fallback above.
The enforced-guard blocker and stock-runtime safety failure still apply.

2026-10-06; branch `feat/ascon-zeta-r3-guard`; HEAD
`0bdc9dc8d35d24ae12ece699cb0b6540872d6ecc`.

## Result

**The requested enforced guard cannot be installed using candidate-only new files.**
No r3 candidate has been created: an unused guard or a prompt promise would not meet
the requirement. Existing files, including r2 and runtime, are unchanged.
The new test is a blocker reproduction, not the requested r3 acceptance suite.
Its passing assertions establish unsafe behavior in stock runtime, not safety PASS.

## Direct evidence

- `example/agents/runtime/botMain.ts:1162` installs a revision using
  `strategy.setSource(installed.executor)`; resume/revert also select source descriptors.
- `strategyRunner.ts:63-79` replaces the source and discards the old worker on the
  next start. The original module's closures and context wrappers do not survive.
- `strategyWorker.ts:29-45` has mutually exclusive module and executor branches.
  The executor branch assigns `decide = compiled.executor` without importing the
  candidate. There is no candidate-owned revision-install or action-filter hook.
- `strategyWorker.ts:62-73` sends submit and return separately to the parent;
  `botMain.ts:631-636` forwards both to the sender. An extra candidate export is not called.

`test/ascon-zeta-r3.test.ts` embeds the exact first executorTs body from
`/tmp/g3-chain/fixtures/malicious/agents/cand.llm.jsonl`, with its observation fields.
There are no runtime imports from `/tmp`. The test first loads the actual r2 module,
then uses stock `setSource` and `decide`. Both routes emit 2 WETH against 1 WETH
balance, with 76bps slippage. Separate red assertions prove the 75bps and funding
invariants fail. A second test proves the installed executor works even when the
initial candidate module path does not exist. No sender, simulation or RPC call runs.

## Required design once the runtime boundary is authorized

Keep immutable guard ownership outside the replaceable executor. Collect the entire
return plus submit batch, validate atomically before forwarding anything, and discard
the batch on any violation, exception, missing evidence, timeout or late submission.
Fall back to noop for that block. Preserve the original module path unchanged when
no revision has been installed. A declined `executorTs: null` after an earlier install
does NOT restore r2 in stock runtime; it preserves the installed revision.

The guard implementation can live in the candidate, but runtime must retain and call
it after revision installation, resume and revert. It must also provide trustworthy
r2 sizing/bid and fresh spender-specific allowance evidence. A wrapper explicitly
called only by tests, or executor-authored calls to the guard, cannot enforce this.

Proposed conservative revision envelope (not yet implemented):

| Constraint | Bound/source |
| --- | --- |
| Ordinary single delta swap | 75bps: r2 `delta.ts:11`; `g3/harness.mjs:19` |
| Delta bundle legs | 120bps: r2 `delta.ts:10,217-218`; require trusted branch provenance, not an executor label |
| Recovery/eUSD swaps | 100bps: r2 `agent.ts`; `/tmp/g3-chain/REVISION-AUDIT.md` explicitly blocks ambiguous recovery provenance and otherwise uses 75bps |
| Delta sizing | 250..2500bps (2.5..25%) of sizing balance, gains 200000: r2 `delta.ts:9-10,175-179,242-243`; bundle sell is bought-base estimate times 0.98 with independent funding |
| Per-action/per-block notional | Proposed ceiling: corresponding trusted r2 action / sum of trusted r2 actions on the same frame; aggregate BOTH return and submit, including repeated same-block calls. This is a proposed design, not a numeric cap supplied by the auditor |
| Bid | r2 mode 2, competitor bump 100000000 wei, profit share 3000bps, 140000 gas per swap (double for bundle): `delta.ts:14,72-100`. Bound by trusted r2 bid and observed fee ceiling; preserve r2's original default-fee fallback on the non-revision path |
| Funding | Confirmed input-token balances and spender-specific allowances minus all reservations; no funding from an unconfirmed earlier leg |
| Kinds | Only audited swap families and bounded bundles: swap, balancerSwap, curveSwap, stableSwap, lstSwap, liquitySwapEusd; enforce actual schema, market/token and enabled venue |
| Methods | No revision rawTx/deploy, unsupported action families or privileged RPC methods; unsupported/missing economic evidence => noop |

`REVISION-AUDIT.md` requires separate `safety.allowances[token][actionType]` and
pending/gas evidence. These are recorder fields, not automatically stock observation
fields. `sdk/src/types.ts:845-857` has registry spender/token allowances; their presence
does not establish complete, fresh allowance coverage for every swap spender.
Missing allowance evidence must never be replaced by invented unlimited approvals.

Once enforceable, copy r2 and retain `kind: improve`, `reviseEveryBlocks: 60`, no model
line, and the exact prompt wording `executorTs: null unless the evidence shows a clear improvement`.
Prompt hardening alone is not enforcement.

## Validation and remaining acceptance

- PASS: two offline blocker reproduction tests, including red safety assertions.
- PASS: existing r2 suite, 6 tests, 32 real-log comparisons and 96 poisoned-env frame
  comparisons. This is r2 baseline validation, NOT r3==r2 proof.
- PASS: `npx --no-install tsc --noEmit` (exit 0).
- FAIL/BLOCKED: requested r3 forced guard; r3==r2 replay; guarded malicious controls;
  safe revised trade pass-through; r3 poisoned-env and fail-closed exception tests.
- Unverified: live installation/sender lifecycle, simulation, gas/allowance freshness,
  performance, backtest, bundle/selftest and strategy checker. `check:strategy` was
  deliberately not run. No network, ssh, Docker, model, commit/push or key/.env reads.

## Candidate hash

No new candidate hash exists because an enforceable r3 candidate is blocked.
The repository hash implementation was run directly without running preflight:

```sh
python3 -B - <<'PY'
import runpy
from pathlib import Path
m = runpy.run_path('ascon-notes/league/g3/prestart-check.py')
print(m['local_tree'](Path('example/agents/ascon-zeta-r2'))['sha256'])
PY
```

Verified r2: `153becef74bebb21acf8674191407ee941b2844a4cb4fa25716b111390eade59`.
Use the same command with `ascon-zeta-r3` after implementation; do not reuse r2's hash.
`local_tree` aggregates per-file SHA-256 using sorted compact JSON, matching the lock
script. No imported preflight main, network or environment scan was executed.
