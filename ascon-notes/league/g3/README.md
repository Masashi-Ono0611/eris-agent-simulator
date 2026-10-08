# G3-proxy offline inputs — r3 (BLOCKED)

**NO-GO. Offline preparation only; no simulation or launch authorization.**
The non-sending malicious control is expected to produce **safety FAIL** while
its detection unit test passes. Do not spend the 36 normal worlds after that FAIL.
The stock runtime has no general economic safety rejection gate at compilation.

Sources: `../G3-DESIGN-ZETA-R2-2026-10-06.md` (read in full), MASTER §3,
`example/agents/runtime/{llm,improve,strategyRunner,botMain}.ts`,
`../{make-roster.py,run-league.sh,league_harness.py,round_manifest.py}`.
Read-only pilot review used `chain-live-main.sh`, all `run-queue-*.sh`,
`rosters/roster-fref-xb-r-live-on.yaml` and `roster-fref-mix-v3.yaml` under
`/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer/b274e4c9-6365-44d8-96d5-84b3db6e48ad/scratchpad/`.
That directory has no `live_summary.py`; the chain's actual `/private/tmp/live_summary.py`
was read. Do not execute the old queues: they contain ff-merge, old seeds, p3 and
partial/intersection-only summaries. No old results were used to select new seeds.

## Rosters and blocked slot

`ref-{off,on}.yaml` has noop (baseline), multi-arb, clean-arb, cand/ascon-zeta-r3.
ON omits `ERIS_AGENT_FROZEN`; OFF sets `1`. All other candidate env is identical:
claude-cli:haiku, call logging=1, timeout=300000, existing timed CLI wrapper.
Parent **must unset** FROZEN before BOTH paired runs (omission does not erase an
inherited value); checker rejects even an inherited `0`. Opponents are always frozen.
AUTO wallets are for future local Anvil only. No private wallets were opened.

`example/agents/fixed-bid-5gwei/` now exists. **G3 F_mix remains BLOCKED**
for the reasons in [G3-PREREQ-2026-10-07.md](../G3-PREREQ-2026-10-07.md).
Slots are fixed as noop, the 10 opponents in MASTER's listed order, then cand.
Repository input hashes and r3 candidate binding were re-registered on 2026-10-08.
Directory existence and matching hashes do not establish an executable F_mix.
See [G3-LOCK-R3-2026-10-08.md](../G3-LOCK-R3-2026-10-08.md) for remaining blockers.
inc-zeta maps to ascon-zeta with measured ASCON_DELTA_PARAMS:
`{"bidMode":2,"bidProfitShareBps":3000,"gasPerSwap":140000}` from roster-league-u1
and scratchpad mix-v3. No ASCON_ZETA_PARAMS override is invented.

## Order, seeds, host, time

`schedule.tsv` is the exact 36 + 7 + 3 design ordering. Normal: calm→crash→depeg,
ref→mix, ascending seed, OFF→ON except the middle seed ON→OFF. Faults and state
resets reuse their seeds ONLY as pre-registered fixtures, never independent samples.
Normal rows start fresh process/v0; state epochs share only their dedicated initially
empty state root. `state-plan.yaml` records s=1,2,3/k=3. Collection wiring and 64MiB
corrupt/oversize/restore tests remain **unverified**, not covered by these small tests.
The host column pins the local hostname observed during preparation, **planned and
unverified** (the design names no physical host). No SSH/remote host was inspected.
All rows p1, base port 8847, nominal 13 minutes. `budget.json`: 7.8h normal,
1.5167h fault, 0.65h state = 9.9667h basic, reserve about 14–15h with audits.
No calendar/date reservation. Max daily 6h and chunk 110min: at most 8 nominal
worlds/chunk, shorter after measured audit costs. ON-first pairs need recheck after
OFF completes; every next cell requires G0 + complete revision/action audit.
**Non-sending malicious precheck precedes world 1**, although the scheduled seven
fault worlds retain their prescribed order after the normal group.

## r3 registration (2026-10-08)

`python3 -B ascon-notes/league/g3/register-inputs.py --check` compares the
registration byte-for-byte and uses `prestart-check.py` to verify every pin.
After review ONLY, `--write` recomputes repository hashes and the fixed inline tool
manifest. It does not register a state dump, create a live source manifest, clear
prerequisites, change seeds or grant start permission. Candidate tree must match
C-EXCEPTION-01 section 8, using sorted compact JSON of relative-path SHA-256 values.
The 11 rosters and 46 schedule labels now name r3; `cand` and opponent slots stay fixed.
The chain directory remains a legacy r2 execution snapshot; its source/eval/replay
paths and manifest require a separate reviewed r3 installation. No snapshot or old
result is promoted to r3 evidence. No completeness exemption remains in its gate.
The remainder of this README includes historical verification records; current
commands/results are recorded in the 2026-10-08 report, not inferred from those records.

## Offline checks

```sh
python3 -B -m unittest discover -s ascon-notes/league/g3/tests -p 'test_*.py'
node ascon-notes/league/g3/validate-inputs.mjs
/usr/bin/env -i PATH="$PATH" ERIS_LLM_CALL_TIMEOUT_MS=1000 node --import tsx --test ascon-notes/league/g3/tests/provider.test.mjs
NPM_CONFIG_OFFLINE=true NPM_CONFIG_UPDATE_NOTIFIER=false npx tsc --noEmit -p .
python3 -B ascon-notes/league/g3/prestart-check.py
```

`prestart-check.py` prints JSON and exits nonzero on any failed check; writes nothing.
It checks HEAD AND working candidate using the exact sorted compact JSON tree hash
algorithm in verify-q-zeta-02-lock.py, input/roster/opponent hashes, tracked dirt
(including staged changes), local upstream/main runtime/lib/SDK bytes, disk >=25GiB,
pgrep no-Anvil, parent FROZEN absence, unit timing override absence, pinned upstream ref, and visible registered/sibling seed metadata.
Inspection failure is failure; untracked task files do not count as tracked dirt.
Self reservations are only exact local paths with pinned hashes, never a whole
worktree/name-prefix exemption. Audit checks index seed columns, JSON seed fields,
text enumerations/ranges/49xxx reservations. Other devices/private/unrecorded runs
remain unverified. Fresh pre-start audit required; do not automatically replace seeds.
Sensitive-path checks use only parts relative to each scan root. At least one
successfully parsed, non-exempt source is required overall AND from every root;
empty roots or self-reservations alone fail. JSON includes `sourceCount`,
`rootSourceCounts`, minimum counts, and `skipped` paths with reasons for pruned
directories, sensitive paths, symlinks and hash-bound self-reservations. Pruned
directories are reported as a whole without inspecting their descendants.
The checker is deliberately also blocked by incomplete F_mix and missing real replay.
The red tests modify only temporary copies (a sparse local shared clone has no new
commit, network or credential checkout). They demonstrate clean→dirty, original→changed
candidate, unused→used seed, reservation-band/range, malformed metadata and hash drift.
Additional red controls cover zero sources, empty sibling roots, self-only coverage,
and used seeds below ancestors named secret/credential/private-key; safe metadata
under those ancestors remains readable, while sensitive descendants stay excluded.

## Fake provider and evidence boundary

No `fake:` model prefix exists (`fake:*` would select Ollama). The supported
`ERIS_CLAUDE_BIN` hook selects executable `fake-claude.py` using claude-cli:haiku.
`fault-*.yaml` use this hook. The script ignores argv/context and reads only selected
fixture/config env names, writes no credential log, has no HTTP/real CLI fallback.
Fixtures cover malicious return/submit, malformed JSON, wrong executor type,
import body, empty stdout, empty executor, null decline, unknown revert, quota,
150s delay and 301s response versus 300s timeout. Delay/timeout defaults match design.
`G3_UNIT_TIME_SCALE` is ONLY a shortened-unit-test knob; remove it for eventual
long tests. Short checks do NOT prove real 150s/300s timing, cadence, TTL, backoff,
late install/submit suppression, or quota retry behavior in botMain.

`harness.mjs` calls stock parseRevision and compileExecutor, with fixed zero-inventory
observation, read-only client stub and return/submit capture. Both malicious fixtures
are legal swap schema yet relax single slippage 75→76 and attempt unfunded WETH.
Tests also exercise stock StrategyRunner.setSource and both output routes, then
restore a null executor. This is **not** a custom stock revision-loop substitute:
no botMain installation lifecycle, receipts, epoch boundary or actual candidate module
restore is certified. Worker fixtures make no RPC calls; no sender exists.
Unknown revert parses successfully; botMain checks version existence separately.

`unit-change.json` is visibly synthetic, noop-only and never a successful G3 code
change. It tests CLI replay mechanics only. Delayed/change-revert rosters reference
an intentionally MISSING `AUDITED-HAIKU-CHANGE-MISSING.json`: **BLOCKED** until a
natural Haiku safe change has been fully audited and registered with a new input
lock. Do not hand-repair or treat synthetic replay/restore as real Haiku success.
Their schedule gates are `BLOCKED-AUDITED-HAIKU-CHANGE`; the schedule retains 46 rows.
`fixtures` hashes and expected outcomes are registered in `fixture-expectations.json`.

Full G3, submission-model equivalence, subscription/OAuth/extra-billing state,
current online rules, live G0/receipts, state cap/boundaries, timeout/backoff,
P60, runtime/devnet execution and any host other than the local offline check remain
**unverified**. No commit/push, simulation, Docker, SSH, npm test or network was run.
`verification.json` retains earlier-session checks separately from the current review
checks. Its historical tsc entry is **self-reported, not re-verified** as a historical
execution claim. This review independently ran offline `npm run typecheck`
(`tsc --noEmit`, exit 0) and `python3 -B -m unittest` from `g3/tests`
(12 tests, exit 0); provider tests were not re-run. New red controls failed before
the fix and passed afterward. These results do not certify full G3.
`initial-state.json` records the original preparation session, when g3 was new.
This review started clean at `docs/g3-r2-prep` / `b336496`; edits are confined to
g3 and the release runbook. Input/self-reservation hashes for edited files were
refreshed without clearing any existing blockers. Full prestart was not run.
