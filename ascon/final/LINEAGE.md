# Survivor lineage of our agents (for the final evaluation)

Compiled 2026-10-22. Two kinds of source, kept apart:

- **Dashboard and decisions** (data as of 2026-10-14 19:57 JST): `ascon-notes/league/ASCON-DASHBOARD.html`
  (embedded JSON: `data-plan.zeta_qualification`, `data-results` d0 / q0 / q0b / strategies / ranking /
  mix1 / mixed_r3_ranking, `data-decisions`) and `ascon-notes/league/DECISIONS-2026-10-09/10/11/14.md`.
  The DECISIONS files settle gates, billing and G3 handling; they name no new candidate. Candidate
  decisions are in the dashboard's `data-decisions`.
- **After 2026-10-14** (not in the dashboard): PR #78 / #81 bodies and commit messages on origin/main and on
  the unmerged branches `feat/opus-flatten-variants`, `feat/opus-fc-validation`, `feat/opus-r3s`.

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
| 2026-10-22 (PR #81, merged) | opus-2 = opus-1 + revert-driven bid controller | Head-to-head on the mini was running when the PR merged; it replaces opus-1 only if it beats it. No result in these sources |
| 2026-10-22 (unmerged branches) | opus-nf, opus-fc (end-of-epoch variants); opus-r3s, opus-r3b (r3's sizing while calm and lightly contested, on opus-fc / opus-1); opus-1-aa (A/A control) | No result in these sources |

## Current champions

- **Submission line: opus-1.** Provisional submission since PR #78 (merged 2026-10-21), best mean and best
  minimum in the 10-21 screen. PR #79 named its revision model.
- **Furthest qualification survivor: ascon-zeta-r2, carried to ascon-zeta-r3 by exception.** r3 was the
  insurance candidate as of 2026-10-09; no later record in these sources retires or re-confirms it.
- **Strongest in the old mixed fields: inc-zeta (ascon-zeta).** That ranking predates the upstream merge; in
  the 10-21 screen on the current upstream it was last of the four.
- **Not in the planned arms:** sonnet-1 (2nd in the 10-21 screen) and opus-2 (result pending). Including or
  excluding them is the plan owner's call; this file only records that they survived.

## How the survivors map onto the planned arms

- **B = opus-1 as accepted**: the current submission line, unchanged. Every other arm is read against B in
  the same field and scenarios.
- **B' = placebo (opus-1-pb)**: opus-1 with every sized amount ×999/1000 (bigint, rounded down), applied
  where `decide()` hands its actions out; whole-balance close-outs are not scaled
  (example/agents/opus-1-pb/agent.ts, test/opus-1-pb.test.ts). It is a small-perturbation placebo, not an
  A/A copy like `opus-1-aa` on `feat/opus-r3s`: B vs B' measures how far two near-identical strategies
  drift apart, and the noise floor f = max(0.25, sd(c′)) is built from that contrast. It runs frozen like
  every agent, so its prompt.md is not read.
- **C1 = opus-1a (allowance fix)**: direct descendant of B with one fix. Its directory is not on origin/main
  or on either mini checkout yet.
- **R = C1 + r3 mechanisms**: merges the two surviving lines, the opus submission line and the zeta
  qualification line (r2 → r3). Its nearest prior art is opus-r3s / opus-r3b (unmerged, no recorded result).
- **r3 measured clone-free (record arm)**: ascon-zeta-r3 alone in the slot. The earlier field rosters had
  ascon-zeta, r2 and r3 side by side, and r2 and r3 run byte-identical strategy code (agent.ts, delta.ts,
  launch.ts, launchSwap.ts), so they competed for the same trades. Here only one zeta-family agent is in the
  field. It is a record of the qualification survivor, not a new candidate.
