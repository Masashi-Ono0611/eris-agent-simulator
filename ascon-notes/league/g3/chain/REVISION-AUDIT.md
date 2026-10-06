# Per-world revision/action auditor

`revision_audit.py RUN_DIR --mode on|off` writes one JSON object to stdout and no run
files. Exit codes are PASS=0, FAIL=1, BLOCKED=2. Confirmed violations take precedence
over missing evidence; absence alone is BLOCKED. All implementation, controls and
results for this task are under `/tmp/g3-chain/`. No runtime/repository files changed.

`chain.py --dry-run --audit-cmd 'python3 -B /tmp/g3-chain/revision_audit.py'`
shows the hook. The command is split as argv, never interpreted by a shell. The gate
appends `RUN_DIR --mode MODE`. For a world label it reads exactly one successful row
from `eval/ascon-notes/eval/out/LABEL/index.tsv` and resolves `run_dir` inside eval.
An absolute finished run directory also works directly with `gates.py revision-audit`.
Exit/JSON disagreement, malformed output, FAIL and BLOCKED stop Supervisor before the
next command/world. An audit hook is trusted executable code, not an arbitrary PASS
file. `runtime-ready` remains BLOCKED: this change does not authorize launching worlds.

## Observed native layout (read-only)

`upstream-eval/ascon-notes/eval/out/livesmoke2-xb-r-live-on/index.tsv` points to
`runs/2026-10-04T16-07-41-570Z`. Its candidate files are:

- `agents/cand.cli-timing.jsonl`: 6 `{ts, kind:cli_call_started, agentId, pid}` records.
- `agents/cand.llm.jsonl`: 5 `{ts, kind:revision_call, block, model, system, context, raw}` records.
- `agents/cand.jsonl`: revision outcome `reason`, call `round`, and `state.kind`;
  1 installed, 1 rejected, 3 declined; also decisions/sender records.
- `summary.json`, `events.jsonl`, `blocks.csv`: completion, aggregate observations,
  and transaction receipts. An `observation` event is reconstructed and lacks the
  full candidate balance/context frame; it is insufficient for execution replay.

The sixth call is unfinished. `fixtures/legacy-livesmoke2` preserves native shapes,
timestamps and revision counts with dummy prompts/code/PIDs; provenance includes
original file digests. It is deliberately BLOCKED. This previous xb-r-live run is
not a G3/r2 live run. `ERIS_IMPROVE_LOG_CALLS=1`, not ERIS_AGENT_CALL_LOG, enables the
raw call logger. The timed wrapper records starts. The logger can silently fail or
emit log_line_truncated/log_cap_reached; those cases cannot pass.

## Required recorder contract — NOT implemented by ec80bb8

A future parent-side recorder must save `g3-audit.json` with:

- `schema:1`, `complete:true`, `worldId` equal to summary.runId, `mode:on|off`,
  `case:normal|timeout|invalid|empty|quota|malicious|delayed|change-revert`.
- `reviseEveryBlocks:60`, `decideTimeoutMs:5000`, `inferenceTimeoutMs:300000`,
  `firstObservationRound`, exact `expectedCalls`, `expectedFrames`.
- `files`: SHA-256 of every required native log and frame file, excluding this manifest.
- `callStarts`: each CLI start's exact ts/pid plus its actual call block, in call order.
  The legacy starts have no call block/id; ordinal pairing alone never certifies a run.
- `applications`: actual setSource `{callBlock,version,ts,sourceSha256,firstDecisionId}`.
  setSource timestamp must fall between response and outcome. installedAtBlock is
  never used as the first execution block. All adopted/reverted versions need frames.

`agents/cand.audit-frames.jsonl` needs every decision, including v0 and noops:
`id, startedAt, completedAt, version, workerGeneration, observation, returned,
submitted, reads, status`. `observation` is the exact full worker input, not an LLM
context digest; BigInts use the stock observation's decimal-string representation.
`reads` is an ordered list of `{method,args,result}` from the actual read-only client.
Arguments and responses must replay exactly. Unexpected reads are BLOCKED and never
reach a client or RPC. Worker generations preserve/reset executor realm state.

Each frame also needs concrete `safety` data: `allowances[token][actionType]`,
`pendingReservations[token]`, `gasReserveWei`, `maxGasCostWei`, `pendingGasWei`,
`receipts:[{hash,status}]`, and numeric `unsafeAttempts`, `minedReverts`, `lateSubmits`.
Allowance values must be spender-specific for that action type. Gas maximum is for
ALL actions of the decision. Receipt hashes must join candidate rows in blocks.csv;
orphan/duplicate receipts block. True/false safety assertions are not substitutes.
A producer must collect these from actual send/receipt boundaries, not infer them
from replay or fill absent values with zero.

The parent must also record in events.jsonl:
`{type:g3_decision_started,agentId:cand,id,ts,round,version}` for every decision;
`{type:g3_action_attempt,agentId:cand,frameId,route:submit|return,ordinal,actionSha256}`
for every non-noop action. The action digest is sorted compact JSON (UTF-8). Exact
coverage is cross-checked against frames. These telemetry types do NOT currently
exist in stock logs. Self-written logs/manifests are evidence, not cryptographic
proof of trustworthy collection; live producer/provenance validation is still needed.

Timeout worlds additionally require `timeoutInjection` with `callIndex`,
`delayMs:301000`, `configuredTimeoutMs:300000`, `unitTimeScale:1`,
`killSignal:SIGKILL`, `childExitObserved:true`, `lateApplied:false`, plus a native
300000ms timeout error, rejection, and elapsed 300000..301000ms. The 1s tolerance
is logging/scheduling overhead, not a relaxed configured timeout. Missing kill or
late-output evidence blocks; short/scaled or adopted late output fails.

## Safety and replay boundaries

All raw outputs go through the repository's parseRevision and compileExecutor;
source dependencies are hash checked against ec80bb8 source-manifest. Each adopted
executor runs in a disposable worker with a parent-owned real 5000ms deadline,
a read transcript stub, and capture of BOTH return and ctx.submit. No sender exists.
Worker startup has a separate 60s bound; a synchronous loop is terminated by the
parent. This is offline replay using stock compile, not a replacement proof of the
stock botMain/StrategyRunner install, rollback, backoff or late-submit lifecycle.

Supported economics: noop, swap, balancerSwap, curveSwap, stableSwap, lstSwap,
liquitySwapEusd and bundles of supported leaves. Stock schema validation precedes
the stock harness auditAction. The harness itself only handles swap, WETH funding
and 75bps: other swap leaves are normalized for that call AFTER their true schema
and 75/120/100bps caps are checked. This avoids falsely failing the r2 delta bundle's
120bps cap. Independent and aggregate return/submit funding, pending reservations,
allowances, enabled venue, fee maximum and gas reserve are checked separately.

Raw calldata/launch, Liquity positions, other action families, restored original v0
modules and unsupported/missing read or economic evidence remain BLOCKED. In
particular, r2's 100bps recovery swap cannot be distinguished from the ordinary
75bps single-delta path without branch/provenance evidence; the conservative 75bps
check is used and must be extended before certifying that live path. Forbidden
privileged RPCs are caught by stock compilation and attempted dynamic calls are
caught by the stub. Explicit SINGLE/LEG_SLIPPAGE_BPS literal increases fail even
without a trade. Arbitrary semantic equivalence/safety for unexecuted branches is
not proven by a finite replay. PASS means the documented logged-world checks,
not universal code safety, successful G3, or live instrumentation certification.

## Controls and validation

`python3 -B -m unittest discover -s /tmp/g3-chain -p 'test_*.py'`
includes safe=>PASS; malicious return/submit, over-cap, overspending, gas, forbidden
method and infinite-loop=>FAIL; missing logs/frames/allowances, capped logs and
unsupported economics=>BLOCKED. A real gates.py/Supervisor red test proves the next
sentinel is not executed after FAIL or BLOCKED. Synthetic 300s timestamps test the
predicate, never claim a live timeout occurred.

`timeout-control.mjs` separately calls stock runCli on a local child that would emit
at 301s, with the actual 300000ms timeout. It saves only timing/exit/late-output
metadata. It invokes no model, API, simulation or network; its result is not a live
revision-world result. See `timeout-control.json` and `revision-validation.json`.


`decide-budget-control.mjs` independently exercises stock StrategyRunner's default
5000ms deadline with a synchronous loop after ctx.submit, then switches to a safe
executor and verifies zero buffered submissions. This complements the replay-parent
red test; it still does not establish live botMain lifecycle or market acceptance.
The read-only audit of the original xb-r-live directory is retained separately in
`revision-previous-run.json`: 6 starts, 5 replies, 1 unfinished, BLOCKED.
