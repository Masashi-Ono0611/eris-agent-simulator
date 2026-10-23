# Survivor lineage of our agents (for the final evaluation)

Compiled 2026-10-22. Two kinds of source, kept apart:

- **Dashboard and decisions** (data as of 2026-10-14 19:57 JST): `ascon-notes/league/ASCON-DASHBOARD.html`
  (embedded JSON: `data-plan.zeta_qualification`, `data-results` d0 / q0 / q0b / strategies / ranking /
  mix1 / mixed_r3_ranking, `data-decisions`) and `ascon-notes/league/DECISIONS-2026-10-09/10/11/14.md`.
  The DECISIONS files settle gates, billing and G3 handling; they name no new candidate. Candidate
  decisions are in the dashboard's `data-decisions`.
- **After 2026-10-14** (not in the dashboard): PR #78 / #81 bodies and commit messages on origin/main and on
  the unmerged branches `feat/opus-flatten-variants`, `feat/opus-fc-validation`, `feat/opus-r3s`.
- **Session decisions not in a PR or commit yet** (marked (session)): copy them into a PR body or commit
  message when the branch lands.

T is a position within one field. Numbers from different fields, seed sets or upstream versions are not
comparable (PLAN-UPDATE-2026-10-17 §3-4: pre-rebuild results are not comparable with post-rebuild ones).

## Rounds, in order

| Round (field, worlds) | Who was measured | Outcome |
|---|---|---|
| Q0 (F_ref, 60) | sonnet-1 | Not qualified: T 44.56 vs multi-arb 56.50 |
| Q0b (F_ref, 60, seeds 41101-41105) | opus-1 | FAIL: T 48.07 vs 56.43, G0 FAIL in 2 worlds |
| xb-r dev1-dev5, xa-1 (F_ref, diagnostic) | deterministic xb-r line, xa-1 | xb-r v5 not promoted (base stays v3); xa-1 stopped after two repairs |
| u1m (mixed, 11 players, 36 worlds, G0 BLOCKED, diagnostic) | opus-1, sonnet-1, inc-zeta, grok-1, astra-1/2, sonnet-2, zeta-2 + refs | Top group within noise: venue-arb 54.48, opus-1 54.33, sonnet-1 53.92, inc-zeta 53.70, grok-1 53.52. Dropped: sonnet-2 46.30, zeta-2 40.42 |
| D0 (F_ref, 8 worlds, seen seeds, diagnostic) | inc-zeta, zeta-2/2a/2c, sonnet-1, opus-1 | Diagnostic only |
| mix1 + mix2 (mixed, 48 worlds, seeds 40001-40004) | same 11, zeta-2 replaced by xb-r v3 | inc-zeta 1st (58.26), venue-arb 53.71, sonnet-1 52.92, grok-1 52.80, xb-r v3 51.91, opus-1 51.88 |
| Decision 2026-10-05 (`dec-zeta-original`) | inc-zeta = ascon-zeta with zeta-a30 params | Made the conditional first candidate |
| Q-ZETA-01 (F_ref, 60) | ascon-zeta-r | FAIL (condition 4, 9/60 worlds) |
| Q-ZETA-02 (F_ref, 60, seeds 47001-47005, mini) | ascon-zeta-r2 | T 58.91 vs 42.34, 12/12 regimes, G0 all PASS; condition 4 FAIL (8/60), 5/6 BLOCKED. Not qualified, but the furthest qualification survivor |
| Decision 2026-10-06 (`dec-c-exception-r3`), 2026-10-09 (`dec-oct09-r3`) | ascon-zeta-r3 | r3 inherits r2's result by exception (strategy code identical to r2, prompt changed) and is kept as the insurance submission candidate. r3a / r3c stay research versions |
| E1-E10, mixed_r3 (mixed, 36 worlds, diagnostic) | r3, r3a, r3c, inc-zeta + field | mixed_r3: inc-zeta 57.42, venue-arb 53.98, sonnet-1 53.24, opus-1 52.90, grok-1 52.67, ... ascon-zeta-r3 50.65 (7th of 12) |
| Selection screen 2026-10-21 (PR #78; frozen, §4.4 score, 12 scenarios each: mixed s101/s202/s303, quiet, active; current upstream) | opus-1, sonnet-1, ascon-zeta-r2/r3, ascon-zeta | opus-1 mean 56.22 / min 54.03; sonnet-1 54.40 / 52.69; r2/r3 avg 53.61 / 47.05; ascon-zeta 42.61 / 36.52. opus-1 made the provisional submission |
| 2026-10-22 (PR #81, merged) | opus-2 = opus-1 + revert-driven bid controller | Held-out seeds 202/303 x quiet/active (co-present with opus-1, sonnet-1, r3): opus-2 - opus-1 = +0.21 / +1.02 / +0.28 / -0.88, mean +0.16, below the +1 T replacement gate: not adopted, submission stays opus-1 (PR #81 comment). Same runs (session): sonnet-1 -0.12 (mean 55.40 vs 55.52), with repeated losses of more than 2 T in active depeg and cdp-incident |
| 2026-10-22 (feat/opus-flatten-variants) | opus-nf, opus-fc (end-of-epoch variants) | Seed 101, 4 regimes x quiet/active, co-present with opus-1: opus-nf -0.09 / +0.76, opus-fc +0.12 / +1.14 (session). opus-nf dropped; opus-fc went to validation |
| 2026-10-22 (feat/opus-fc-validation) | opus-fc | Untouched seeds 404/505/606 x 12 regimes x quiet/active: -0.15 T vs opus-1: FAIL (session). Its -10.5 / -9.2 on active launch were reverts behind opus-1's identical-fee swap. On 707/808/909, with r3s/r3b also present, it read +0.66; near-clones were present in every run, so neither number is clean |
| 2026-10-22/23 (feat/opus-r3s) | opus-r3s (opus-fc + r3 sizing behind a calm / lightly-contested gate), opus-r3b (the same boost on opus-1); opus-1-aa (A/A copy of opus-1) | Pre-registered gate on fresh seeds 707/808/909 x quiet/active: r3s -0.36, r3b -0.79: FAIL, retired (session; the judge output file was not located when this row was written). r3s's gate never opened on seed 101, and its blocking getBlock in decide() lost equal-fee ties about 2:1, so it was no A/A of opus-fc. opus-1-aa: no result in these sources |
| 2026-10-23 (feat/final-plan; slot replacement, one of ours per field) | record arms opus-1 and ascon-zeta-r3 clone-free on FP/FD seed 1001; C1 mechanism check opus-1 vs opus-1a on launch 1041-1046 | Running on the mini (lanes night1-A / night1-B) at 02:30 JST; no result in these sources |
| 2026-10-23 (in progress) | opus-1r (R: C1 + r3 mechanisms), opus-1g (C1 + GMX OU mean-reversion overlay), ascon-zeta-r3k (r3 + single-leg floor 125 bps, own-outcome brake, rival x1.2 bids for E >= $168) | Being built and screened; no result |

## Current champions

- **Submission line: opus-1.** Provisional submission since PR #78 (merged 2026-10-21), best mean and best
  minimum in the 10-21 screen. PR #79 named its revision model. S-00048 (ZIP sha 2e5a0451 = commit
  8ff2e696); docker selftest PASS 2026-10-23 (4g, 26 included, 0 reverted). Neither opus-2 nor opus-fc
  replaced it.
- **Furthest qualification survivor: ascon-zeta-r2, carried to ascon-zeta-r3 by exception.** r3 was the
  insurance candidate as of 2026-10-09; not retired: r3's sizing grafted onto the opus base (r3s/r3b) was
  retired, but r3 itself is being measured clone-free (night1-A), and its lineage is the source of the
  weapon arms (ascon-zeta-r3k, R's mechanisms).
- **Strongest in the old mixed fields: inc-zeta (ascon-zeta).** That ranking predates the upstream merge; in
  the 10-21 screen on the current upstream it was last of the four.
- **Not in the planned arms:** sonnet-1 (-0.12 vs opus-1 on 202/303, repeated > 2 T losses in active depeg
  and cdp-incident, although +0.89 ahead of opus-1 once launch is excluded, near-clones present; final
  plan 10-22) and opus-2 (+0.16, below the gate).

## How the survivors map onto the planned arms

- **B = opus-1 as accepted**: the current submission line, unchanged. Every other arm is read against B in
  the same field and scenarios.
- **B' = placebo (opus-1-pb)**: opus-1 with every sized amount ×999/1000 (bigint, rounded down), applied
  where `decide()` hands its actions out; whole-balance close-outs are not scaled
  (example/agents/opus-1-pb/agent.ts, test/opus-1-pb.test.ts). It is a small-perturbation placebo, not an
  A/A copy like `opus-1-aa` on `feat/opus-r3s`: B vs B' measures how far two near-identical strategies
  drift apart, and the noise floor f = max(0.25, sd(c′)) is built from that contrast. It runs frozen like
  every agent, so its prompt.md is not read.
- **C1 = opus-1a (allowance fix)**: direct descendant of B with one fix. On this branch since 1ce98d01 (PR #85
  for main is open); the mini's evaluation worktree runs it; check-trap-scope PASS 2026-10-23.
- **R = C1 + r3 mechanisms**: merges the two surviving lines, the opus submission line and the zeta
  qualification line (r2 → r3). Built as opus-1r (branch feat/opus-1r). Its nearest prior art, opus-r3s /
  opus-r3b, failed its pre-registered gate and was retired; R differs by firing per trade on edge size
  (two-leg, large-edge bundles, no field-wide gate) and by keeping decide() free of blocking RPC.
- **r3 measured clone-free (record arm)**: ascon-zeta-r3 alone in the slot. The earlier field rosters had
  ascon-zeta, r2 and r3 side by side, and r2 and r3 run byte-identical strategy code (agent.ts, delta.ts,
  launch.ts, launchSwap.ts), so they competed for the same trades. Here only one zeta-family agent is in the
  field. It is a record of the qualification survivor, not a new candidate.
- **Weapon arms** (user direction 2026-10-23: commodity opus base + a weapon other teams lack): opus-1g and
  ascon-zeta-r3k are arms in the slot like any other; each passes check-trap-scope before its matrices count.
