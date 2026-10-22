# ascon/final: final evaluation inputs

**Slot replacement.** Each field holds exactly one of our agents, as id `slot`. Every other entry is an
example reference agent, and `noop` is the baseline. An arm is defined by the directory the slot points to
(`dir:` under `example/agents/`). Everything else stays the same between arms: the field, the scenarios,
the wallets (`AUTO`) and the frozen flag (`ERIS_AGENT_FROZEN: "1"` on every agent, so no LLM revision and no
model calls). A difference between two arms in the same field and scenario file is therefore a difference
between the two strategies, not between fields. Our agents never meet each other.

| File | What it is |
|---|---|
| `roster-FP.yaml` | Sparse field: random, lp-provider, lst-carry, levered-long, venue-arb, basis-arb, peg-arb + slot |
| `roster-FD.yaml` | Contested field: venue-arb, venue-arb-2 (dir venue-arb), multi-arb, clean-arb, cross-venue-arb, max-profit-arb, stat-arb, adaptive-arb + slot |
| `roster-FS.yaml` | Specialist field: launch-confirm, launch-sniper, liquidator, redemption-arb, trove-manager, discovery-arb-verify, max-profit-arb, venue-arb, lp-provider, random + slot |
| `scen-<seed>.yaml` | All 12 regimes at one seed: 1001, 1003-1006, 1011-1014, 1021-1024, 1101-1102, 1201-1206 (21 files, 252 scenarios) |
| `scen-launch-1041-1046.yaml`, `scen-launch-1047-1050.yaml` | Launch regime only, 6 + 4 seeds |
| `smoke-{calm,lending,launch}-1001.yaml` | One scenario each (`lending` is the lending-incident regime): checks that a roster starts and scores, not a result |
| `check-arm.py` | Per matrix: the slot ran the intended arm, frozen, in every scenario |
| `check-trap-scope.py` | Whether the trap control is still unnecessary for given scenario files and arms (see "No trap control") |
| `test-checks.sh` | Positive and negative controls for the two checks: `bash ascon/final/test-checks.sh "$PWD"` |
| `LINEAGE.md` | Which of our agents survived which round, and how they map onto the arms |

**Using a roster.** The rosters are templates. The only placeholder is `__SLOT_DIR__` on the slot's `dir:`
line. Make one instantiated copy per (field, arm), for example
`sed 's/__SLOT_DIR__/opus-1/' ascon/final/roster-FP.yaml > <run-dir>/roster-FP.opus-1.yaml`, and pass that
copy to `ascon/eval/run-matrix.sh <name> <roster> <scenarios> <port> [state-dir]`. Put both the field and
the arm in `<name>`. Nothing checks the slot directory before anvil starts: a template passed as-is fails
each scenario only when its agents are spawned (`agent directory not found for id "slot"`,
core/src/realtime/agentProcess.ts; read from the code, not run).

**Checking which arm ran.** Every arm's matrix.json calls our agent `slot`, and check-matrix.py and
check-collision.py compare agent ids only, so neither can tell one arm from another: a roster copy made
with the wrong directory makes two arms the same run, and their difference reads as zero. The run records
the arm itself. The agent runtime writes one `runtime_start` line, with the directory it loaded and its
mode, to `runs/<id>/agents/slot.jsonl` (example/agents/runtime/botMain.ts). After run-matrix.sh and
check-collision.py, run `python3 ascon/final/check-arm.py <matrix.json> <arm>` on each matrix. It requires,
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
points; run it for every new arm (C1, R) before its matrices count:
`python3 ascon/final/check-trap-scope.py --scenarios ascon/final/scen-*.yaml ascon/final/smoke-*.yaml --arms opus-1 opus-1-pb opus-2 ascon-zeta-r3 <new arm>`.
A FAIL means a trap control is needed again: in a world that has the venue, with a check that
`agents/trap-launcher.jsonl` shows the trap reached market creation, bait and posted collateral.

**Reading the results.** Compare arms only within one field and one scenario file. Do not pool the
launch-only files with the 12-regime files without reweighting: launch would then carry 31 scenarios
against 21 for every other regime. run-matrix.sh uses `--agent-sandbox process`, so the regimes' docker
CPU/memory caps do not apply.

**Checked (2026-10-22).** Every scenario file was parsed with the backtest CLI's own `loadScenarioSet`
(core/src/cli/backtest.ts) and gives exactly the planned (regime, seed) list. The 23 evaluation files hold
262 distinct scenarios over 31 seeds. Every roster, instantiated with opus-1, opus-1-pb, opus-2 and
ascon-zeta-r3, passes `validateAgentsFile` (core/src/config.ts); every agent directory exists with an
`agent.ts`. `ascon/eval/check-matrix.py` accepts a complete synthetic matrix for every (file, roster) pair.
`test-checks.sh` passes all its controls. check-arm.py, run read-only on a real 12-scenario matrix on the
mini (runs/matrix-2026-10-21T20-30-40-853Z), passes for `opus-1` and for `venue-arb-2` as `venue-arb`, and
fails all 12 rows when asked for `opus-2`, or for `venue-arb-2` as its own directory. C1 (opus-1a) and R
are not on disk yet, so check-trap-scope.py has not been run on them. No backtest was run.
