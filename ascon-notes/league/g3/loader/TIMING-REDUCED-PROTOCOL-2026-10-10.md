# REDUCED timing protocol — pre-declaration, 2026-10-10

Declared before the first reduced run. No reduced exploration, control or main
measurement data existed when these rules were declared. Do not edit these
rules after seeing results. Changes require a separately named, newly declared
protocol and new artifacts; never reclassify an old run. Synthetic fixtures are
software tests, not experimental observations. This is a supporting study only.

## Fixed design

Explicit selection: `--protocol reduced`, or `G3_TIMING_PROTOCOL=reduced` in the
control tests. Omission retains the legacy 49-point grid, counts and decisions.
REDUCED is confirmation-only: use a separate complete, accepted exploration.
Selection, both-arm bracketing, first upward A=0.5 interpolation, no smoothing or
extrapolation, and transition-width rejection (maximum 10 ms) are unchanged.
Hash the exact exploration bytes before calibration/launch and persist the SHA-256.

All REDUCED constants are exported as `REDUCED` in `timing-reduced.mjs`, copied to
`config.protocolConstants`, and printed verbatim in every reduced JSON/Markdown
plan and result. The declaration is included in source hashes.

| Constant | Pre-declared value |
| --- | --- |
| offsets from c, ms | [-12, -8, -6, -4, 0, 4, 12] |
| sensitive / main primary offset, ms | -4 / 0 |
| initial and replacement warmups W / measured decisions N | 5 / 4 |
| control pairs per point / AB / BA | 24 / 12 / 12 |
| main pairs per point / AB / BA | 64 / 32 / 32 |
| discarded process-pair warmups | 2 |
| main d=0 overhead pairs / controls overhead pairs | 24 / 0 |
| boundary points / control total pairs / main total pairs | 7 / 170 / 474 |
| pair cooldown, ms | 1500 |
| main / positive / negative shuffle seeds | 20261009 / 91001 / 91002 |
| nominal positive B delay, ms | 6 |
| positive signed area band, ms (inclusive) | [3, 9] |
| negative absolute area tolerance, ms (inclusive) | 2 |
| endpoint low maximum / high minimum, both arms | 0.125 / 0.875 |
| confidence level / alpha / planning power | 0.95 / 0.05 / 0.80 |
| normal critical values z(0.975) / z(0.80) | 1.959963984540054 / 0.8416212335729143 |
| block bootstrap replicates / seed | 4000 / 20261010 |
| planning within-process correlation / assumed local slope per ms | 1 / 0.08 |
| planning resolution target, ms | 4 |
| pre-declared sampled-area margin, ms | [-2, 2] |
| controls / main default budget, minutes | 30 / 90 |
| test timeout margin / arm shutdown grace, ms | 120000 / 5000 |

Counts cannot be overridden for reduced runs. Each point alternates AB/BA by
repetition; a seeded shuffle orders points separately each repetition. No
outcome-based early success or adaptive sampling. The same runner is re-warmed
with W discarded d=0 calls after a timeout only when another measured call
remains. Existing calibration, load notes/guards, toolchain fail-closed checks,
probe audits, exclusive artifact creation and rewarm accounting remain in force.

## Statistics and decisions

For each point, keep each A/B process pair as one block; a process contributes
its mean of N timeout indicators. The point estimate is the mean of those block
fractions, still exactly timeout count / measured decision count. Wilson uses
R process blocks as effective n, not 4R decisions: for p and z,
`centre=(p+z²/(2R))/(1+z²/R)`,
`half=z*sqrt(p(1-p)/R+z²/(4R²))/(1+z²/R)`.
Newcombe hybrid-score difference interval for D=pB-pA:
`[D-sqrt((pB-LB)²+(UA-pA)²), D+sqrt((UB-pB)²+(pA-LA)²)]`.
This is a nominal block-effective Wilson/Newcombe approximation, not an exact
binomial interval for fractional block observations. It allows arbitrary
correlation within each process by planning at rho=1. It assumes independent,
stationary process pairs and zero or nonnegative between-arm covariance within
a pair (the interval does not take credit for positive pairing). Negative
between-arm covariance or dependence/drift across pairs can invalidate coverage.
Report observed block covariance/correlation, AB/BA means, and chronological
first-half/second-half means; do not narrow intervals based on these diagnostics.
All seven intervals are pointwise, not simultaneous. Controls use only c-4 as
the primary sensitive comparison; main uses c as primary, the others descriptive.

Signed shift is the sampled-curve area in ms:
`sum((d[i+1]-d[i])*(D[i]+D[i+1])/2)`.
Use actual non-uniform dwell points. Positive means more B timeouts. This is not
an unconstrained estimate of a continuous horizontal shift. Missing points
produce null area. No rectangle-rule reuse, fit, smoothing, or extrapolation.

Positive descriptive criteria: complete planned sample, all existing structural
and endpoint guards, lower Newcombe bound at c-4 strictly >0, and signed area in
[3,9] ms. Negative descriptive criteria: same guards, c-4 interval contains zero,
and absolute area <=2 ms. An incomplete run never passes. Save each assertion and
its actual/expected values before the test assertion. The public control verdict
is **descriptive only**, with a separate `controlCriteriaPassed` boolean and a
`controlAssessment` of `criteria met` or `criteria failed`; never label it PASS.
Budget stop takes precedence: `INCONCLUSIVE (budget)`.

### Band derivation and its limitation

For an ideal common hard-step curve with its midpoint at c (p=0.5 at the step),
the grid gives A fractions [0,0,0,0,0.5,1,1]. A nominal 6 ms left shift gives
B=[0,0,0.5,1,1,1,1], differences [0,0,0.5,1,0.5,0,0].
Trapezoids give 0+0.5+1.5+3+1+0=6 ms. Moving the unresolved A step within its
adjacent [-4,0] cell gives a midpoint location error bounded by half that cell
(2 ms); the B step in its adjacent [-8,-6] or [-6,-4] cell has error <=1 ms.
The sum is 3 ms, motivating 6±3=[3,9] under this **local hard-step model**.
A 12 ms shift gives area 11 ms on this grid and also violates the low-end guard;
no-shift gives zero and fails the positive sensitive bound. For identical curves
expected area is zero; the negative ±2 ms tolerance retains the earlier target
and corresponds to half the 4 ms cell next to c. It is not a sampling-error bound.

These local arguments are not a clean general derivation: an 8 ms outer gap,
non-step shapes, truncation, and sampling error are not bounded by the exploration
width gate. That gate does not ensure the stated step locations or local slope.
Therefore both controls are **descriptive only** even when all criteria are met.
We keep the earlier numeric bands without claiming calibrated false-pass rates.

### Main intervals, MDE, and allowed interpretation

Bootstrap whole A/B process-pair blocks, independently within each (point, AB/BA)
stratum, preserving both arms and every decision in each sampled block. Use 4000
replicates, fixed seed, and the 2.5/97.5 percentile with linear quantile
interpolation. Report the signed-area interval, seven pointwise difference
intervals, and rewarm diagnostics. Bootstrap assumes independent exchangeable
blocks within strata; it does not cover grid interpolation error, serial drift,
or missing data. All-constant samples can give a degenerate bootstrap interval;
this is not proof of a population point mass. Partial intervals are descriptive
and cannot support a completed conclusion.

Counts alone cannot give an unconditional millisecond MDE. With rho=1,
`n_eff=4R/(1+3rho)=R`. At worst-case pA=pB=0.5, two-sided alpha=.05 and power=.80,
`MDE_fraction=(z(.975)+z(.80))*sqrt(0.5/n_eff)`.
For R=24 this is 0.404374; R=64 gives 0.247627 (approximately).
Under a common local slope s=.08/ms, the main primary-point shift MDE is
`MDE_fraction/s`, approximately **3.095 ms**; the planning resolution target is
**4 ms**. Neither slope nor power is guaranteed by width<=10 ms. The optimistic
rho=0 case is also reported (n_eff=256, MDE approximately 1.548 ms).
For the sampled-area estimator, trapezoid weights are [2,3,2,3,4,6,4] ms,
sum squared=94 ms². Independent points and the same worst-case variance give
`MDE_area=(z(.975)+z(.80))*sqrt(0.5*94/64)`, approximately 2.401 ms;
this describes sampled area, not continuous horizontal shift.

Every main report must say: **a probe-induced shift smaller than MDE is not detectable**,
qualified as the above conditional 80%-power planning statement, not a claim
of mathematical impossibility. The fixed sampled-area margin is [-2,2] ms;
record whether the entire bootstrap interval lies inside it only for a complete
run. No claim about equivalence or absence of interference is made by this
protocol. No other margin or substitute wording is allowed after results.

## Budget, persistence, and stopping

`--budget-min` / `G3_TIMING_BUDGET_MIN` accepts a finite positive value. Defaults
are controls 30, main 90 minutes; the budget is per run and includes calibration,
coordinator setup, audit/persistence, process startup/rewarm and cooldown. Legacy
sampling and decision rules remain unchanged; the resource guard also applies.
Node control-test timeout = selected budget * 60000 + 120000 ms. The two-minute
margin is reserved for graceful termination, summary/bootstrap and writing.

Before calibration, exclusively create `<output>.partial.jsonl` (controls use
`<output>.positive.partial.jsonl` and `.negative.partial.jsonl`). Keep its opened
append-only descriptor; fsync every record. Record the initial plan/hash,
calibration, every completed pair with the current budget projection, and final
state. Preserve failed units separately in the final record. Never reopen or
truncate an existing journal. JSON/Markdown retain their existing wx ownership.

After every complete pair project total wall as elapsed + current cooldown +
remaining pair count * max(mean observed pair cost, mean boundary pair cost).
Observed pair costs include their scheduled cooldown; setup/calibration is in
elapsed, not repeatedly multiplied. Before any boundary pair exists use the
all-pair mean. This is a resource heuristic, not a promise of completion. Record
projection inputs. Stop if projection or elapsed exceeds budget; check elapsed
before each launch and while awaiting child responses/cooldown. Send SIGTERM to
an active arm (which closes its runner); after 5000 ms use SIGKILL if it fails
to exit, and record that fallback. Never launch the next arm after budget expiry.

Write `status: incomplete`, `verdict: INCONCLUSIVE (budget)` and the same control
verdict, preserve completed/partial pairs, and exit nonzero. A deadline during
calibration is checked before arms launch. No statistical early-success stop,
no automatic retry, range expansion, threshold relaxation, or promotion of a
partial run. Actual runtime fit and Mac mini scheduling/shutdown remain unverified
until separately authorized real runs.
