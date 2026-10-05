# xb-r-ai H1 prototype

User-authorized on 2026-10-04: choose one inspected policy and ENTRY only. No
performance claim. This is an offline-checked pilot component, not an ON-ready
stock-runtime agent or a submission-ready package.

- `v5.ts`: copy of xb-r v5 SHA256
  `a4ab7664cf87155ad193cc79ae038ecf4d2e6289d71179b3bc356b52c4a36b54`,
  with only a trusted parameter resolver added to the two factories. Tests check
  the complete source against that copy with the enumerated seam changes.
- `policy.ts`: exactly three policies, ENTRY 20..60 in steps of 5, delta <=5.
  Canonical literal strings are parsed as data, never compiled. The caller owns
  observation time and opaque one-use tickets. Requests every 60 blocks after
  the first observation, one in flight, proposal age <=60. Lease is 120 blocks
  from actual application, including a valid same-policy refresh. Null/timeout
  do not renew. Invalid current replies reset v5/50; stale/duplicate replies are
  ignored. Run/rewind/horizon resets invalidate outstanding tickets.
- `engine.ts`: explicit `gate.observe` / `request` / `accept` seam plus fixed v5
  `decide` and `decideLive`. Updates/expiry/rejection do not recreate the engine;
  cooldown, duplicate detection and pending R8 receipt state survive. Use only
  one decision driver per instance. A future adapter must be a trusted caller.
- `agent.ts`: stock runtime **FROZEN only**. Without
  `ERIS_AGENT_FROZEN=1`, import throws before a model call can replace the module.
  `ERISAGENTFROZEN` is not the runtime's variable name. Frozen live decisions use
  baseline v5/50 and cannot request/accept revisions.
- `prompt.md`: evidence-based selection policy, immutable constraints, exact
  output envelope. No model frontmatter, so the adapter can use roster selection.

## Why stock ON cannot enforce either option

Stock `improve.ts::compileExecutor` wraps any accepted body as a new function;
it checks privileged RPC names, not v5 gates. `botMain.ts` installs it via
`strategy.setSource`; `strategyWorker.ts` then uses the generated function
instead of importing this agent. Therefore (a) a prompt requesting a literal
template is not enforced and (b) an agent-side validator disappears on replacement.
`ctx.submit` and the returned action both reach the sender. The negative control
compiles both a gate-free return and a buffered submit in an isolated VM with a
fake context; H1 rejects both strings without executing them.

The literal template returns policy data, not an SDK action. Feeding even a
valid template directly to stock `compileExecutor` is not the H1 integration.
Stock `buildRevisionSystemPrompt` also appends whole-body/revert/memory
instructions that conflict with this data contract; reuse of that prompt builder
without changes is inappropriate.

Alternative: an isolated **local research adapter**, after dev5, that keeps this
engine alive, uses `prompt.md` plus the observation-only evidence, calls
`llm.ts` with `claude-cli:haiku`, and feeds replies to `gate.accept`. Never call
`setSource`, `compileExecutor`, or stock resume/revert for H1. Gate observations
must come from the parent block loop, not model fields. Freeze must disable the
entire inference scheduler. The adapter/IPC integration is **not implemented**
in this change; do not start ON with the roster snippet alone. Submission also
needs an operator-approved hook: vendored runtime/sdk/lib changes are blocked
by `infra/submission/scan-submission.py` and are not installed by team acceptance.

See [pilot specification](../../../ascon-notes/league/XB-R-AI-PILOT-2026-10-04.md)
and [agy format check](../../../ascon-notes/league/XB-R-AI-AGY-2026-10-04.md).

## Lightweight verification

Run sequentially; no simulation or external inference:

```sh
npm run typecheck
TSX_DISABLE_CACHE=1 node --import tsx scripts/checkStrategyCode.ts example/agents/xb-r-ai/agent.ts example/agents/xb-r-ai/engine.ts example/agents/xb-r-ai/policy.ts example/agents/xb-r-ai/v5.ts
TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 --test-reporter=tap test/xb-core.test.ts test/xb-variants.test.ts test/xb-r.test.ts test/xb-r-dev2.test.ts test/xb-r-dev3a.test.ts test/xb-r-v4.test.ts test/xb-r-slippage.test.ts test/xb-r-v5.test.ts test/xb-r-ai.test.ts
TSX_DISABLE_CACHE=1 node test/xb-r-ai-red-controls.mjs
```

The red script only mutates a temp copy, restores after each case/finally, checks
SHA256 of all restored H1 TS sources and unchanged xb-r, then runs the xb subset.
It does not run the old xb red script (which mutates the source consumed by tests).
