# G3-proxy F_REF-ONLY launcher (offline preparation, NOT launch approval)

Entry point: `/tmp/g3-chain/g3-ref-chain.sh --dry-run` (default). `--run` is a future
execution mode, not used in this task. Current pinned inputs **cannot launch a world**.
All generated files, tests, logs and future launcher outputs live under `/tmp/g3-chain/`.
No edits to release-r2 or league-v2. No network/SSH/Docker/simulation/model/auth calls,
no run-league invocation, no commit, no dotenv/key reads were made during preparation.
The non-sending malicious compiler/executor harness was run; it is not a simulation.

## Source identity and view

Read source `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-r2`:
HEAD `ec80bb89df22e4899695a4cf2ba131382e130481`, branch `release/r2-c0`.
Local `main` actually resolves to `c76162440fda4b20adc46bf0821c2f11f7186985`.
The requested ec80bb8 is used, not the differing main ref. No checkout/fetch occurred.
`source-view/` is a fresh read-only export of 1,304 tracked regular files at that HEAD.
Three sensitive/symlink paths were excluded by NAME before blob extraction; untracked
files, dotenvs, credentials, dependency directories and state dumps were not copied.
`source-manifest.json` binds exported bytes and source identity. No new Git worktree
or Git metadata was written. This is a source view, **not a runnable eval installation**.

## Requirements and actual evidence

1. **PASS (guard), BLOCKED (real prestart)**: only the exact completeness string for
   missing fixed-bid-5gwei may be exempted. A whole completeness/FAIL exemption is
   forbidden. Gate requires all expected checks, JSON/exit-code agreement, and rejects
   extra unknown failing checks. Tests turn EACH other check red; an actual subprocess
   red control proves downstream sentinel execution is stopped. Actual prestart exits 1:
   seedAudit reports 75 reservation hits and one root with no audited sources; noAnvil
   exits 3 because this sandbox cannot access the process list (NOT proof of live Anvil).
   Missing natural Haiku fixture and unsafe malicious fixture remain blockers.
2. **PASS (path lookup), BLOCKED (live auth/probe unverified)**: executable discovery
   finds `/Users/masashi_mac_ssd/.local/bin/claude`. Future helper resolves the executable,
   captures `auth status --json` in memory and emits only boolean/subscription metadata.
   No raw identity, token, prompt or stderr is printed. Clean allowlisted environment
   drops all API keys and nesting markers. Once current subscription/extra-usage-OFF
   and Haiku permission are confirmed, a single tiny `haiku` probe uses the PROJECT'S
   `xb-r-live-claude-timed.sh`, with tools/MCP/settings disabled. Attempt is claimed
   before starting; no retry or fallback. Probe output is only tested for `OK`, never saved.
   The probe and auth have NOT been run. This task did not manufacture the future
   `subscription-check.json` assertion (checkedAt with timezone, extraUsageOff, haikuAllowed).
3. **PASS (plan/limits/tests/offline auditor), BLOCKED (live recorder/runtime)**: exact 18 F_ref
   rows from schedule.tsv; calm/crash/depeg, seeds 49001..49003; middle seed ON first.
   Runner has no `--blocks` or `--block-seconds` options: use documented
   `BACKTEST_EXTRA_ARGS='--blocks 360'`; verify regime `blockTimeSec: 2` and G0 outputs.
   Each world is p1 and fresh process/v0. G0 requires 360 blocks, 362 loops, strict
   p99 < 1000ms, zero violations/failures and verified manifest; baseline comparison
   runs after EVERY pair, including ON-first, before the next pair. Exit codes survive
   failures/timeouts/signals. Six worlds per conservative chunk, persistent FULL chunk
   reservations <=110min and <=6h/day, pair admission based on nominal/measured max x1.2
   plus audit allowance, monotonic process-group deadline, no GNU timeout. No automatic
   wait/retry/seed replacement. A clean completed pair checkpoint allows next `--run`
   to continue after a budget pause; an interrupted/failed pair forbids rescue reruns.
   Daily ledger covers this launcher only, not unrelated jobs or unrecorded preparation.
4. **PASS (wiring), BLOCKED (live exclusivity check)**: atomic mkdir lock, caffeinate
   while running, process checks before startup and each world; pgrep errors fail closed.
   Only owned process groups can be killed by the deadline. Existing Anvil/matrix is
   never killed. No process list was obtainable in this sandbox; caffeinate was not run.
5. **PASS**: clean parent environment omits ERIS_AGENT_FROZEN for BOTH modes. OFF
   gets `1` from unchanged ref-off.yaml; ON candidate omits it. Opponents stay frozen.
6. **PASS (artifact)**: summary.tsv has one row per planned normal world; F_ref 18
   **NOT RUN**, excluded F_mix 18 **NOT RUN / BLOCKED fixed-bid-5gwei**. No dry-run result
   is labeled world PASS. `--dry-run` prints all 18 run commands, 9 pair checks and gates
   without executing a child or modifying the summary. bash 3.2, bash -n, ShellCheck,
   offline npm run typecheck and local control tests pass. See `validation.json`.

## Existing tools and audit boundary

- `ascon-notes/league/round-manifest.py` (+ round_manifest.py): begin/verify provenance.
- `g0.py`, `g0_contract.py`, `degradation-gate.py`: complete expected-set/summary/load G0.
- `league-report.py`, `league_harness.py`: summary/scoring report AFTER G0.
- `g3/harness.mjs`: non-sending stock parse/compile, return/submit capture.
- `ascon-notes/eval/audit-xb-r-slippage.py`: old dev2/dev3 proxy analysis; **not** a
  G3 revision/action auditor. Seed audit scripts likewise do not audit revisions.
- No `live_summary.py` in this repository; no dependency on external scratchpad tools.
- `revision_audit.py` now supplies the local fail-closed auditor; `gates.py revision-audit`
  invokes it through `--audit-cmd`. `runtime-ready` still blocks on missing live recorder
  validation and isolated eval prerequisites. See the implementation update below.

Runtime evidence to join: cand.cli-timing.jsonl (call start), cand.llm.jsonl (raw/system/
context/model/block/usage-or-error), cand.jsonl (revision installed/declined/rejected/
reverted), events.jsonl, blocks.csv and summary.json. Start/outcome counts alone cannot
prove cadence, in-flight <=1, timeout <=300s, three completed ON cycles, actual first
application block, return/submit safety or 100% audited revisions. installedAtBlock is
call block, not necessarily actual application. Unfinished calls must remain in the ledger.

Actual malicious result: **safety FAIL**, both return and submit accepted slippage 76
versus 75 and unfunded WETH. `offline-malicious.exit` is 1. Detection succeeded but
runtime safety FAILED: normal world 1 must not start. The full prestart also blocks.

## Future execution dependencies and unknowns

`run-league.sh` -> run-matrix.sh -> npm backtest explicitly passes
`--agent-sandbox process`: Docker is NOT required on this code path. This bypasses
Docker CPU/memory caps and does not certify production. Anvil, isolated dependencies,
artifacts and a compatible state dump ARE required. release-r2 has no backtest/state.
Never execute runner from release-r2 or the read-only source-view. Future eval must be
an independent writable copy at `/tmp/g3-chain/eval` with its own state/dependencies,
no symlink back to either source worktree. No such runtime copy was claimed ready.
Manifest Git identity queries are read-only against the pinned source Git metadata;
manifest/run writes resolve into eval. Live readiness and source/runtime hash bindings
need review when the missing full auditor and eval installation are supplied. The
current mandatory readiness gate prevents accidentally reaching this incomplete path.

The dry-run lists the conditional downstream commands even though they are presently
unreachable. It is reviewable launch preparation, **not a claim that 18 worlds can run**.
No bypass for the natural-Haiku-fixture or malicious blockers is supplied.

## Estimate

18 x 360 x 2s = **3.6h block lower bound**; 18 x 13min = **3.9h nominal**.
Using budget.json's multiplier 1.2 and audit/preparation 2–3h yields **6.68–7.68h**
reserved estimate (at least two days under 6h/day; >=3 chunks, more if audits are slow).
Current malicious FAIL means stop before any world; the full 36/46-world estimate is
not spent and this subset cannot be promoted to full G3 or submission-model PASS.


## Revision auditor implementation update (2026-10-06)

See [REVISION-AUDIT.md](REVISION-AUDIT.md) for the exact log contract, checks,
unsupported economics and evidence boundaries. `revision_audit.py` inventories all
native calls, replays adopted bodies with stock compile + g3 auditAction, and emits
PASS/FAIL/BLOCKED JSON with counts. The `--audit-cmd` hook is wired into chain/gates;
non-PASS or inconsistent JSON/exit codes prevent the next command/world.

The previous xb-r-live layout is a sanitized fixture, not an r2 G3 live result.
Safe, malicious, missing-log and over-cap fixtures/results live under fixtures/ and
revision-control-*.json. Current stock logs lack full observation/version/decision,
allowance, reservation and timeout-lifecycle evidence; they remain BLOCKED.
No live G3/r2 revision world has been run. Synthetic PASS does not clear readiness,
malicious, prestart, auth, natural-Haiku, F_mix or other original blockers.
Actual 5s and 300s stock component controls are separate from world evidence.
See revision-validation.json, revision-tests.log and *-control.json.
