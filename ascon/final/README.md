# ascon/final: final evaluation inputs

**Slot replacement.** Each field holds exactly one of our agents, as id `slot`. Every other entry is an
example reference agent, and `noop` is the baseline. An arm is defined by the directory the slot points to
(`dir:` under `example/agents/`). Everything else stays the same between arms: the field, the scenarios,
the wallets (`AUTO`) and the frozen flag (`ERIS_AGENT_FROZEN: "1"` on every agent, so no LLM revision and no
model calls). A difference between two arms in the same field and scenario file is therefore a difference
between the two strategies, not between fields. Our agents never meet each other.

**Why slot replacement.** In the earlier field rosters our near-identical agents sat side by side and raced
for the same trades, so the race set their differences: opus-fc's -10.5 / -9.2 T on active launch were
reverts behind opus-1's identical-fee swap of the same pool; ascon-zeta, r2 and r3 sent the same Liquity
liquidation in one block and only one could win; opus-fc - opus-1 read -0.15 T on seeds 404/505/606 and
+0.66 on 707/808/909 with near-clones present; r2 and r3, byte-identical strategy code, differed by -4.7 to
+2.9 T. In the live week each unit runs one agent, which a slot field reproduces. The placebo arm B'
(opus-1-pb, sizes x0.999) measures the noise floor without touching fees or timing: a blocking RPC of 2-4 ms
in decide() (opus-r3s's getBlock) lost equal-fee ties about 2:1.

| File | What it is |
|---|---|
| `roster-FP.yaml` | Sparse field: random, lp-provider, lst-carry, levered-long, venue-arb, basis-arb, peg-arb + slot |
| `roster-FD.yaml` | Contested field: venue-arb, venue-arb-2 (dir venue-arb), multi-arb, clean-arb, cross-venue-arb, max-profit-arb, stat-arb, adaptive-arb + slot |
| `roster-FS.yaml` | Specialist field: launch-confirm, launch-sniper, liquidator, redemption-arb, trove-manager, discovery-arb-verify, max-profit-arb, venue-arb, lp-provider, random + slot |
| `scen-<seed>.yaml` | All 12 regimes at one seed: 1001, 1003-1010, 1011-1018, 1021-1024, 1101-1102, 1201-1206 (29 files, 348 scenarios). 1007-1010 are stage 1's second seed block (R late), 1015-1018 stage 2's F2 seeds |
| `scen-launch-1041-1046.yaml`, `scen-launch-1047-1050.yaml` | Launch regime only, 6 + 4 seeds |
| `smoke-{calm,lending,launch}-1001.yaml` | One scenario each (`lending` is the lending-incident regime): checks that a roster starts and scores, not a result |
| `check-arm.py` | Per matrix: the slot ran the intended arm, frozen, in every scenario |
| `check-trap-scope.py` | Whether the trap control is still unnecessary for given scenario files and arms (see "No trap control") |
| `stage2-plan.py` | Validates a complete judge2 stage-1 verdict and writes Step-7 FP/FD queues; controls: `test-stage2-plan.sh` |
| `make-queues.py` | Writes a stage's lane-queue files by the cell rules (one cell = all arms of a (seed, field), on one lane, in a recorded random order), and checks a set of them (`--check`) |
| `test-checks.sh` | Positive and negative controls for check-arm, check-trap-scope and make-queues: `/bin/bash ascon/final/test-checks.sh "$PWD"`; all harness tests: `/bin/bash ascon/eval/test-all.sh` |
| `LINEAGE.md` | Which of our agents survived which round, and how they map onto the arms |

**Using a roster.** The rosters are templates; the only placeholder is `__SLOT_DIR__` on the slot's `dir:`
line. Run them through `ascon/eval/lane-queue.sh`: a queue line `<job> ascon/final/roster-FP.yaml <arm-dir>
<scenarios>` renders the copy into `<logs>/rosters/<job>.yaml`, fails the job before anything starts when
`example/agents/<arm-dir>` is missing, records the arm as `NOTE_<job> run=<id> slot=<arm-dir> ... head=
arm_tree= lib_tree= dirty= load1=`, and runs run-matrix.sh, check-collision.py and check-arm.py. Write the
queue files of a stage with `make-queues.py`, not by hand. The whole procedure is `ascon/eval/README.md`.
For a one-off matrix, make the copy by hand (`sed 's/__SLOT_DIR__/opus-1/' ascon/final/roster-FP.yaml >
<run-dir>/roster-FP.opus-1.yaml`) and pass it to `ascon/eval/run-matrix.sh <name> <roster> <scenarios>
<port> [state-dir]`, with both the field and the arm in `<name>`. run-matrix.sh alone does not check the
slot directory: a template passed as-is fails each scenario only when its agents are spawned (`agent
directory not found for id "slot"`, core/src/realtime/agentProcess.ts; read from the code, not run).

**Lanes stay busy.** Each lane runs `ascon/eval/lane-chain.sh`, which takes the next queue file from its
`pending/` directory as soon as one ends. Keep one queue in every lane's `pending/` that needs no decision
to start. Default once the decision rule is frozen by commit hash (the plan requires that before stage 1
starts): stage-1 cells {opus-1, opus-1-pb, opus-1a} on seeds 1003-1006 (the plan's order when R is late);
R (opus-1r) gets its cells on 1007-1010 when it lands. Soak is not a lane-queue job: it runs the slot
unfrozen (check-arm would report ARM=FAIL, and the rosters here freeze every agent) and needs the mini's
revision key (plan U6). A decision gates only what goes into `pending/` next, never whether a lane runs.

**Checking which arm ran.** Every arm's matrix.json calls our agent `slot`, and check-matrix.py and
check-collision.py compare agent ids only, so neither can tell one arm from another: a roster copy made
with the wrong directory makes two arms the same run, and their difference reads as zero. The run records
the arm itself. The agent runtime writes one `runtime_start` line, with the directory it loaded and its
mode, to `runs/<id>/agents/slot.jsonl` (example/agents/runtime/botMain.ts). lane-queue.sh runs
`python3 ascon/final/check-arm.py <matrix.json> <arm>` on every PASS matrix, with `<arm>` the job's slot
dir, and writes the result as `ARM=` in the job's EXIT line; outside lane-queue run it by hand. It requires,
in every scenario with results, exactly one `runtime_start` whose directory is `<arm>` and whose mode is
`decide` (frozen: an arm with a prompt.md runs as `improve` when not frozen, and every planned arm has
one). It exits 1 (FAIL) on a mismatch and 2 (BLOCKED) when the record is missing or unreadable.

**No trap control.** The plan's draft had a trap field (FP + trap-launcher, on launch) and a C1 criterion
"(e) trap loss C1 ≤ B". Both are dropped. The trap cannot be set in any planned run, and where it can be
set it would not separate B from C1:
- trap-launcher needs the permissionless lending singleton. The coordinator deploys it only when
  `run.protocols` includes `lending` (core/src/realtime/coordinator.ts, `deployAgentMarketVenues(...,
  withLending)`), and none of the 12 official regimes lists it. Without it trap-launcher logs
  `trap-launcher idle: this run has no lending singleton` at its first observation and stops. The runs on
  the mini agree: all 134 runs in `~/Developer/ascon/runs` dated 2026-10-2x that have a
  `market_registry_deployed` event, across the 12 regimes, record `lending: null`. The trap field would
  have been FP plus an idle agent, and (e) would pass as 0 ≤ 0.
- The trap takes only what is lent into it. opus-1, opus-1-pb, opus-2 and ascon-zeta-r3 have no lending
  code in their directories or in anything they import, so even in a world that has the venue
  (config/regimes/agent-markets.yaml, which is not an official regime) their trap loss is zero by
  construction. C1's planned fix (r3's `launchSwap.ts`) approves USDC to `UNISWAP.swapRouter`, an
  environment contract, not to anything an agent deploys.

So the trap risk does not exist in the competition for these arms. check-trap-scope.py re-checks both
points; run it for every new arm (C1 = opus-1a, R = opus-1r, the weapon arms opus-1g and ascon-zeta-r3k,
any later one) on the commit that will be measured, before its matrices count:
`python3 ascon/final/check-trap-scope.py --scenarios ascon/final/scen-*.yaml ascon/final/smoke-*.yaml --arms opus-1 opus-1-pb opus-1a opus-2 ascon-zeta-r3 <new arm>`.
A FAIL means a trap control is needed again: in a world that has the venue, with a check that
`agents/trap-launcher.jsonl` shows the trap reached market creation, bait and posted collateral.

**Reading the results.** A matrix counts only with `VERDICT=PASS COLLISION=PASS ARM=PASS` in its EXIT
line (ascon/eval/README.md). Compare arms only within one field and one scenario file. Do not pool the
launch-only files with the 12-regime files without reweighting: launch would then carry 39 scenarios
against 29 for every other regime. run-matrix.sh uses `--agent-sandbox process`, so the regimes' docker
CPU/memory caps do not apply.

**Shipping check.** A result is about the code that ran, which the job's NOTE line pins (`head=`,
`arm_tree=`, `lib_tree=`, `dirty=0`). Before packaging the chosen arm, run
`git diff --quiet <lane-head> <ship-sha> -- example/agents/<arm> example/agents/lib example/agents/runtime ':!example/agents/<arm>/prompt.md'`
(prompt.md is excluded because frozen runs do not read it). Any difference means the measured result does
not apply to what ships: measure the ship commit, or ship the measured one. A job with `dirty=1` ran
uncommitted code and does not count for shipping.

**Checked (2026-10-22).** Every scenario file was parsed with the backtest CLI's own `loadScenarioSet`
(core/src/cli/backtest.ts) and gives exactly the planned (regime, seed) list. The 23 evaluation files then
held 262 distinct scenarios over 31 seeds. Every roster, instantiated with opus-1, opus-1-pb, opus-2 and
ascon-zeta-r3, passes `validateAgentsFile` (core/src/config.ts); every agent directory exists with an
`agent.ts`. `ascon/eval/check-matrix.py` accepts a complete synthetic matrix for every (file, roster) pair.
`test-checks.sh` passed all its controls. check-arm.py, run read-only on a real 12-scenario matrix on the
mini (runs/matrix-2026-10-21T20-30-40-853Z), passes for `opus-1` and for `venue-arb-2` as `venue-arb`, and
fails all 12 rows when asked for `opus-2`, or for `venue-arb-2` as its own directory. No backtest was run.

**Checked (2026-10-23).** opus-1a (C1) is on this branch since 1ce98d01. check-trap-scope.py: PASS on the
26 scenario files then present for opus-1, opus-1-pb, opus-1a and ascon-zeta-r3, and PASS on all 34 after
the seeds 1007-1010 and 1015-1018 were added (opus-1, opus-1-pb, opus-1a, opus-2, ascon-zeta-r3; the
positive control of test-checks.sh). The new files are scen-1003.yaml with only the seed changed (diffed);
they were not run through `loadScenarioSet`. The 31 evaluation files now hold 358 distinct scenarios over
39 seeds (counted from the files). The arms still in progress (opus-1r, opus-1g, ascon-zeta-r3k) passed
check-trap-scope in their own worktrees on uncommitted code; rerun it on the committed version.
test-checks.sh failed two controls once opus-1a existed (they used opus-1a as the arm that does not
exist) and passes again after the fix.

## Building stage-1 evidence from copied logs

```sh
python3 ascon/final/make-manifest.py --logs /local/logs --stage 1 --out M.json \
  --arms R=opus-1r W1=opus-1g2 W2=ascon-zeta-r3k \
    X1=opus-1g X2=opus-1w X3=ascon-zeta-r3kg --path-map /mini/repo=/local/repo
python3 ascon/final/mechanism.py M.json --out MECH.json
python3 ascon/final/judge2.py judge --manifest M.json --mechanism MECH.json --out verdict.json
bash ascon/final/test-evidence.sh
```

`--arms` accepts `LABEL=agent-dir` entries, comma or space separated. The default
is the explicit map above plus required B=opus-1 and B'=opus-1-pb. There is no
implicit C1. The manifest records `arm_map`; mechanism and judge inherit it, or
accept the identical `--arms` map (conflicting maps are refused). Each candidate
gets the unchanged frozen superiority rule independently. A missing W2 blocks
W2 while other candidates still receive verdicts; final selection waits for
unresolved shipping candidates. The shipping family is exactly R/W1/W2 (three
candidates), decided on 2026-10-23 before inspecting any candidate data. W1 is
the defect-fixed opus-1g2; X1 is the frozen original opus-1g. X labels and the
three known informational directories are labelled informational and excluded
from selection. Their best outcome is `informational PASS`, never advancement
to stage 2 or shipment; later-stage inputs are refused. Their statistics and
PASS/FAIL/BLOCKED checks are identical. Shipping arms with stage-1 PASS may
advance to stage 2; stage 1 alone never authorizes shipment.
Legacy manifests explicitly requesting C1 retain their launch-only rule.

The frozen stage-1 and stage-2 t critical value is **0.94**, tightened from
0.81 to meet the whole-tree false-ship Wilson upper-95 bound of 2% for
R/W1/W2. The stage-1 +0.20 mean floor and all other rules are unchanged.
Family-wise calibration for the three shippable candidates is report-only:

```sh
python3 -B ascon/final/mc.py run --noise /path/to/stepR/noise-r2r3.json \
  --calibrate --candidates R W1 W2 --sims 40000 --rng-seed 231023 --json mc-three.json
```

This scans 0.01 grid points from the frozen threshold upward, keeps shared B
and the frozen ranking/F/F2 limit, and reports Wilson upper-95. It does not
change `judge2.T_CRIT`. Exploratory arms and C1 are absent from this calibration.

The stage-1 design is FP/FD at seeds 1003–1006. Each job uses its last EXIT with VERDICT=PASS,
ordered by line position within its lane log; newer killed/failed attempts do not replace it.
That selected attempt must also have rc=0, COLLISION=PASS, ARM=PASS and matching slot/matrix
NOTEs. An invalid latest PASS is missing, never rescued by an earlier PASS. PASS attempts in
multiple lanes have no reliable cross-file order (run ids can be arbitrary), so are missing.
Missing jobs are omitted; partial cells contain only observed arms. No empty cells are invented.
Exit 0 means complete; exit 2 means incomplete/refused. `M.json.audit.json` lists selected,
ignored and missing attempts and the path mappings, without adding unsupported manifest keys.

Repeat `--path-map` for multiple roots (longest component prefix wins). Keep copied matrices
unchanged under `runs/matrix-*/matrix.json`, alongside copied `runs/<id>/` directories.
The audit sidecar carries the mappings into mechanism extraction for absolute runDir values;
relative runDir values resolve against the directory containing `runs/`. If moving M.json,
move its audit sidecar too, or pass the same mappings to `mechanism.py --path-map`.
Hashes always cover the original matrix bytes, not rewritten paths.

`MECH.json` has the judge's `arms` object, with aggregate counts, pooled pairwise tie win rate,
exact matrix SHA256 list, and per-matrix counts/rates. Only `agents/slot.jsonl` is counted:
decide-timeout reason lines, and `submit_failed` events containing the STF token after the
first launch-entry reason in each scenario. Entry state resets for each scenario.
Tie pairs have the same block, destination (`to`, the venue key available in blocks.csv),
and integer priority fee, but different sender addresses. Each slot/other transaction pair
counts once, including reverted transactions; a lower slot txIndex wins. This measures
same-destination races and cannot distinguish pools behind one router. No ties yields null.
Missing/malformed evidence yields null counts and an error, never zero failures. C1's
separate Step-2 report/verdict and tagged mechanism PnL are not inferred by this extractor.

**Unmeasured p99 (user decision 2026-10-23):** Stage 1 started without decide-duration
logging, so p99 cannot be measured retrospectively. Mechanism extraction still writes
`p99_decide_ms: null` with `p99_decide_ms_reason` and exits 2. The judge explicitly reports
`p99_latency: NOT_MEASURED` (advisory) only for an explicit null with a non-empty reason
string (whitespace alone is insufficient). This subclause does not block or fail condition 5.
Latency's harm in equal-fee races is measured directly by tie-win difference within 10 pt
of B and zero slot timeouts; STF and provenance checks remain enforced.

Numeric p99 keeps the strict <500 ms rule: 499 ms PASS, 500 ms FAIL. A missing key,
malformed value, or null without a valid reason stays BLOCKED. Other failures still take
precedence. All other judge rules remain frozen. Tests cover these cases and revert the
advisory branch in memory to verify null+reason returns to BLOCKED.
Judge CLI exit 0 means it produced a verdict, not that a candidate passed.

## D1 offline runner

```sh
bash ascon/final/d1-run.sh /tmp/d1-result --logs /copies/logs \
  --lanes A,B,C,D --order-seed 231023
# Optional: insert stage 2 into the existing NEXT queues:
bash ascon/final/d1-run.sh /tmp/d1-installed --logs /copies/logs \
  --install-into A="$HOME/ascon-final/chain-A2" \
  --install-into B="$HOME/ascon-final/chain-B2" \
  --install-into C="$HOME/ascon-final/chain-C2" \
  --install-into D="$HOME/ascon-final/chain-D2"
bash ascon/final/test-d1-run.sh
```

The output directory must be new or empty. Defaults: logs from `ASCON_EVAL_LOGS`
or `~/ascon-final/logs`, lanes A,B,C,D, order seed 231023. Choose the seed before
reading results. `M.json` and its audit, `MECH.json`, `VERDICT.json` and
`summary.txt` preserve the evidence and judge-reported candidate statistics,
condition-5 sub-statuses (including advisory NOT_MEASURED p99), informational
flags and F/F2. No raw PnL series are printed. D1 requires all eight cells of
B, B', R (opus-1r), W1 (opus-1g2), and W2 (ascon-zeta-r3k). Each informational
arm X1/X2/X3 is included only when all eight attested cells are present; otherwise
it is omitted from M.json and reported as `informational: pending (n/8 cells)`.
The full extractor audit retains missing informational jobs for diagnosis.
Missing shipping-family cells stop immediately with their job names; extractor exit 2 with written
evidence proceeds to the judge because p99 is unmeasured.

Final markers: `D1_PASS` (exit 0, FP/FD stage-2 queues ready in `s2/`),
`D1_NO_STAGE2` (exit 0, keep/ship S-00048), or `D1_BLOCKED <reason>` (exit 2,
including pending selections). Stage 1 never authorizes shipping a new arm.
ETA uses lane-eta's default job hours (2.5), without assuming lane liveness.
`--allow-partial` is a dry run even with complete logs: all console lines and
artifacts carry DRY_RUN, JSON gets a `DRY_RUN` field, and installation is refused.
Dry artifacts are diagnostic, not reusable authoritative inputs (their hashes
and schemas are intentionally changed by labelling).

`--install-into LANE=QUEUE_DIR` is repeatable; supply exactly one mapping for
each selected lane (use `--lanes` to select a subset). It replaces `--install`.
Every `QUEUE_DIR/pending/` must already exist. All destinations are checked before
any queue is written. A `55-s2-<lane>.txt` name anywhere under that queue directory
(including pending, running, done and held) causes `D1_BLOCKED`: a lane's run ID is
`<lane>-<sha8>-<file stem>`, so a used stem must not be reused. The runner exclusively
creates `pending/55-s2-<lane>.txt`; it never moves or edits existing files, and prints
each lane's resulting name-sorted pending `*.txt` order.

On the Mini, B's `30-s1-r3k.txt` and C/D's `50-s1-1g2-<lane>.txt` remain ahead of
stage 2. Informational `60-s1-1w-<lane>.txt`, `70-s1-r3kg-A.txt` and
`71-s1-r3kg-B.txt` follow stage 2. A's empty `chain-A2` receives its stage-2 file;
the existing waiter starts A there after its current chain ends. `lane-chain.sh`
picks up later additions automatically. Install while these NEXT queues are still
waiting: adding a file cannot reorder or interrupt a queue already running.
No replacement chain, STOP file, start command or swap waiter is created.

The current HEAD is recorded as the intended execution commit; this does not
certify shipping parity. Installation is not a multi-directory transaction: a
concurrent consumer/writer or I/O failure can leave a partial installation,
reported BLOCKED on detected failures. Pending order is a snapshot, not a lock
against a running consumer. No lanes, network calls or recursive deletes are run by D1.

The test uses mktemp fixtures, real manifest/planner CLIs, controlled
judge/mechanism CLI outcomes and a red mutation of the incomplete-stage gate.
It also checks 50 < 55 < 60 ordering, collisions in all four queue states,
missing pending directories, unchanged existing file bytes/mtimes, and real
empty-evidence dry judging. Statistical validation remains
in `test-judge2.sh`; fixture tests do not establish live stage-1 completion.

## Stage-2 planner CLI

```sh
python3 ascon/final/stage2-plan.py --verdict verdict.json --lanes A,B,C,D \
  --order-seed 231023 --out /tmp/stage2-queues --commit <sha> --job-hours 2.5
```

Step 7 of `docs/plan-final.md` is authoritative: seeds 1011–1014, fields FP/FD,
B and F; **no B′ rerun** (judge2 inherits stage-1 placebo f). A selected F2 is
queued in the same cells, using the plan's capacity-available parallel option:
invoking this planner assumes the supplied lanes have capacity for F2. No new
selection or ranking is performed. Informational arms may appear in the source
verdict but can never be F/F2. Missing/incomplete/pending verdicts exit 2 with
BLOCKED before writing queues. The prior JSON is validated without opening its
recorded matrix paths; this is not an independent re-audit of those matrices.

The make-queues generator/checker supplies the recorded deterministic shuffle,
whole-cell lane assignment and resource checks. With two candidates this writes
24 jobs (6/lane on four lanes, 15 hours/lane at 2.5h/job); with only F, 16 jobs.
`stage2-plan.json` records the source verdict hash, mappings and scheduling policy.
`--commit` records the intended execution SHA; it does not checkout or certify
that tree. mini-lane-start still validates resources in the actual pinned tree.
FS seeds 1101–1102 and docker checks are separate gates, not covered by these
FP/FD queues. Legacy C1 uses the existing full scenario file; only launch is
judged for its noninferiority rule (no shortened C1 scenario files are generated).
