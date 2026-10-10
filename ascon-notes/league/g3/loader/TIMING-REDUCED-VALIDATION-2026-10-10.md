# REDUCED implementation validation — 2026-10-10

Implementation and synthetic/fixture verification only, on branch
`feat/g3-timing-reduced`. No real timing exploration, timing controls or main
measurement were run. No network, Docker, model calls, commit or push. Edits
are confined to `ascon-notes/league/g3/loader/` and `tests/`.

The rules were written before the first reduced run in
[TIMING-REDUCED-PROTOCOL-2026-10-10.md](TIMING-REDUCED-PROTOCOL-2026-10-10.md).
That pre-declaration contains every constant, the formulas, assumptions and
limits. This separate file records software verification, not timing evidence.

## Exact final verification commands and results

From `/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/g3-reduced`:

```sh
node --import tsx --test --test-concurrency=1 ascon-notes/league/g3/tests/timing-*.test.mjs ascon-notes/league/g3/tests/loader-probe.test.mjs
npm run typecheck
git diff --check
python3 ascon-notes/league/g3/loader/mutation-check.py --fast
```

- Test command: exit 0; **83 tests, 83 passed, 0 failed, 0 cancelled, 0 skipped**;
  final reported duration 14869.010917 ms. This includes 23 new reduced tests.
- `npm run typecheck`: exit 0 (`tsc --noEmit`).
- `git diff --check`: exit 0, no diagnostics. New untracked files also checked
  separately using `git diff --no-index --check /dev/null <file>` (no whitespace
  diagnostics; exit 0 or 1 is accepted for that additional new-file check).
- Mutation command: exit 0; **10/10 mutants killed**. Every mutation group
  reports `restored_identical=True` and its restored suite exits 0. The four
  original probe-loader mutants are explicitly skipped by `--fast`.

| New mutant | Mutated suite exit | Pass / fail | Restored suite |
| --- | ---: | --- | --- |
| budget stop removed | 1 | 18 / 5 | 23 / 0 |
| positive two-sided band removed | 1 | 21 / 2 | 23 / 0 |
| interval check replaced by point estimate | 1 | 22 / 1 | 23 / 0 |
| sensitive point moved to c-3 | 1 | 19 / 4 | 23 / 0 |

The six earlier fast mutants remain killed: endpoint guard, width rejection,
legacy sensitive point, measured post-timeout warmup, inaccurate calibration
abort, and startup calibration gate. Their restored suites pass (14 sweep,
12 unit, 7 calibration tests respectively).

The probe suite independently compared **178 protected tracked stock files**
with HEAD by SHA-256 and checked that tracked files outside G3 were unchanged.
All six archived Air artifact hashes also remain unchanged. No experimental
artifacts were created: synthetic JSON/Markdown/journals use temporary test
directories and are removed by the tests.

## What the tests establish

- Explicit protocol/env selection, legacy 49-point default, seven exact reduced
  offsets, exploration SHA in the pre-run plan, rejection of incomplete,
  intervened, blurred, uncovered and non-bracketing synthetic explorations.
- Declared W/N, all pair counts/seeds, balanced AB/BA, seeded point shuffling,
  cooldown, and every constant persisted in JSON/Markdown. Attempts to override
  reduced counts fail. A complete fake main executes 474 fake pairs / 948 fake
  arm clients; all seven points contain 64 blocks and 256 decisions per arm.
- Hand-calculated Wilson/Newcombe and non-uniform trapezoid values; synthetic
  6 ms shift meets descriptive control criteria, zero and 12 ms fail; a positive
  point estimate whose interval crosses zero fails. Negative control also
  requires the interval to contain zero. Original endpoint/structural guards
  still apply.
- Whole-pair bootstrap retains A/B dependence and AB/BA strata; repeatable seed,
  missing-stratum rejection, and deterministic/variable synthetic cases.
- MDE calculations: R=64 yields fraction 0.2476274882249591, conditional primary
  shift 3.095343602811989 ms (slope=.08/ms), and sampled-area MDE
  2.4008375736214673 ms (weights squared sum=94). Optimistic rho=0 gives
  1.5476718014059945 ms. These are planning calculations, not measured power.
- Projection overrun writes the completed pair before returning
  `incomplete / INCONCLUSIVE (budget)`; calibration time consumes budget;
  a hanging fake arm is stopped; expiry prevents a second arm; an already
  received unit is retained; no partial run is passed. Exclusive append-only
  journal creation rejects existing/orphan journals without changing them.
- Reduced main and both controls retain calibration aborts; load refusal retains
  notes and prevents launch. Existing rewarm accounting and toolchain tests pass.

## Derivation and interpretation

The ideal hard-step 6 ms displacement has sampled differences
`[0,0,.5,1,.5,0,0]`, whose non-uniform trapezoid is exactly 6 ms. Local half-cell
errors 2+1 ms motivate [3,9] **only under the declared step model**. The negative
2 ms tolerance retains the earlier target (half the cell next to c); it is not
a general sampling-error bound. Exploration width does not establish these
shape assumptions. Both public control verdicts are therefore **descriptive
only**, even when `controlCriteriaPassed=true`. A test passing those criteria
must not be confused with a calibrated experimental PASS.

Point intervals use R process blocks as effective n, not 4R decisions; process
correlation is planned at rho=1. Coverage additionally assumes independent,
stationary pairs and nonnegative within-pair arm covariance. Main uses c as the
primary point and c-4 as the predeclared control-sensitive point. The sampled
area interval is a 4000-replicate, point/order-stratified whole-pair bootstrap.
The fixed sampled-area margin is [-2,2] ms, with no general inference about a
continuous curve or other workloads. The report includes the required MDE
sentence, qualified as a conditional 80%-power planning statement.

## Unverified

- Actual Mac mini completion within 30 / 30 / 90 minutes; the guard enforces
  stopping semantics, not a claim that all planned samples fit these budgets.
- Actual timing sensitivity, empirical interval coverage, false-pass rate,
  detection power, local slope, drift/correlation, or coarse-grid approximation
  error. There is no clean general derivation of a narrow control band.
- Graceful termination of a real active timing arm under the Mac mini OS and
  load. SIGTERM/SIGKILL policy was tested with fake clients; no timing-arm smoke
  or real timing cancellation was run.
- Real post-timeout timing/rewarm performance, production probe overhead, live
  competition behavior, Docker, external services, networks or model execution.

The explicitly requested existing tests include short live spin/sleep primitive
checks and offline stock-Worker probe fixtures. Those fixtures are not real timing
exploration/control/main experiments. The new reduced coordinator tests inject
clocks, calibration, load, arm clients and probe audits; they launch no real arms.
