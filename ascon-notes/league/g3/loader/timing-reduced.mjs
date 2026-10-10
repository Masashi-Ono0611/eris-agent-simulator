import assert from 'node:assert/strict';

// Pre-declared before the first reduced run. Never tune after viewing results.
// See TIMING-REDUCED-PROTOCOL-2026-10-10.md for derivations and limitations.
export const REDUCED = Object.freeze({
  declaration: 'TIMING-REDUCED-PROTOCOL-2026-10-10.md',
  offsetsMs: Object.freeze([-12, -8, -6, -4, 0, 4, 12]), points: 7,
  sensitiveOffsetMs: -4, mainPrimaryOffsetMs: 0,
  warmupDecides: 5, measuredDecides: 4, controlPairs: 24, controlAB: 12, controlBA: 12,
  mainPairs: 64, mainAB: 32, mainBA: 32, warmupPairs: 2,
  mainOverheadPairs: 24, controlOverheadPairs: 0, controlTotalPairs: 170, mainTotalPairs: 474,
  cooldownMs: 1500, mainSeed: 20261009, positiveSeed: 91001, negativeSeed: 91002,
  nominalDelayMs: 6, positiveMinMs: 3, positiveMaxMs: 9, negativeAbsMaxMs: 2,
  lowMax: 0.125, highMin: 0.875,
  confidence: 0.95, alpha: 0.05, power: 0.80,
  z975: 1.959963984540054, z80: 0.8416212335729143,
  bootstrapReplicates: 4000, bootstrapSeed: 20261010,
  planningWithinProcessCorrelation: 1, planningSlopePerMs: 0.08, planningResolutionMs: 4,
  marginLowMs: -2, marginHighMs: 2,
  controlBudgetMin: 30, mainBudgetMin: 90, testTimeoutMarginMs: 120000, shutdownGraceMs: 5000,
  controlInterpretation: 'descriptive only',
});

export function wilson(fraction, blocks, z = REDUCED.z975) {
  assert.ok(Number.isFinite(fraction) && fraction >= 0 && fraction <= 1);
  assert.ok(Number.isSafeInteger(blocks) && blocks > 0);
  const z2 = z * z, denominator = 1 + z2 / blocks;
  const centre = (fraction + z2 / (2 * blocks)) / denominator;
  const half = z * Math.sqrt(fraction * (1 - fraction) / blocks + z2 / (4 * blocks ** 2)) / denominator;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}
export function newcombe(a, b, blocks) {
  const A = wilson(a, blocks), B = wilson(b, blocks), difference = b - a;
  return { lower: Math.max(-1, difference - Math.hypot(b - B.lower, A.upper - a)),
    upper: Math.min(1, difference + Math.hypot(B.upper - b, a - A.lower)) };
}
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
export function blockFraction(unit) {
  assert.ok(unit.decides?.length > 0, 'reduced statistics require process blocks');
  return mean(unit.decides.map(d => Number(d.timedOut)));
}
export function blockPoint(pairs) {
  if (!pairs.length) return { blocks: 0, differenceInterval: null, blockDiagnostics: null };
  const A = pairs.map(p => blockFraction(p.A)), B = pairs.map(p => blockFraction(p.B));
  const a = mean(A), b = mean(B), delta = B.map((x, i) => x - A[i]);
  const covariance = pairs.length > 1 ? mean(A.map((x, i) => (x - a) * (B[i] - b))) * pairs.length / (pairs.length - 1) : null;
  const va = mean(A.map(x => (x - a) ** 2)), vb = mean(B.map(x => (x - b) ** 2));
  const split = Math.floor(pairs.length / 2);
  return { blocks: pairs.length, differenceInterval: newcombe(a, b, pairs.length),
    blockDiagnostics: { covariance, correlation: va && vb ? mean(A.map((x, i) => (x - a) * (B[i] - b))) / Math.sqrt(va * vb) : null,
      byOrder: Object.fromEntries(['AB', 'BA'].map(order => {
        const xs = delta.filter((_, i) => pairs[i].order === order);
        return [order, { blocks: xs.length, difference: xs.length ? mean(xs) : null }];
      })), firstHalfDifference: split ? mean(delta.slice(0, split)) : null,
      secondHalfDifference: mean(delta.slice(split)) } };
}
export function trapezoid(rows) {
  if (rows.length < 2 || rows.some(r => !Number.isFinite(r.difference))) return null;
  const sorted = [...rows].sort((a, b) => a.dMs - b.dMs);
  let area = 0;
  for (let i = 1; i < sorted.length; i++) {
    const left = sorted[i - 1], right = sorted[i];
    assert.ok(right.dMs > left.dMs, 'unique integration points');
    area += (right.dMs - left.dMs) * (left.difference + right.difference) / 2;
  }
  return area;
}
export function trapezoidWeights(points) {
  return points.map((d, i) => ((points[i + 1] ?? d) - (points[i - 1] ?? d)) / 2);
}
export function designMde(pairs, rho = REDUCED.planningWithinProcessCorrelation) {
  assert.ok(Number.isSafeInteger(pairs) && pairs > 0 && rho >= 0 && rho <= 1);
  const effectiveN = REDUCED.measuredDecides * pairs / (1 + (REDUCED.measuredDecides - 1) * rho);
  const fraction = (REDUCED.z975 + REDUCED.z80) * Math.sqrt(0.5 / effectiveN);
  const areaWeightsMs = trapezoidWeights(REDUCED.offsetsMs);
  return { pairs, rho, effectiveN, fraction, conditionalShiftMs: fraction / REDUCED.planningSlopePerMs,
    assumedSlopePerMs: REDUCED.planningSlopePerMs, areaWeightsMs,
    sampledAreaMs: fraction * Math.sqrt(areaWeightsMs.reduce((s, w) => s + w * w, 0)),
    planningResolutionMs: REDUCED.planningResolutionMs, alpha: REDUCED.alpha, power: REDUCED.power };
}
function rng(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(1664525, value) + 1013904223) >>> 0; return value / 2 ** 32; };
}
function quantile(xs, p) {
  const index = (xs.length - 1) * p, lo = Math.floor(index);
  return xs[lo] + (xs[Math.ceil(index)] - xs[lo]) * (index - lo);
}
export function bootstrapShift(raw, points) {
  const strata = points.map(d => ['AB', 'BA'].map(order => raw
    .filter(p => p.phase === 'boundary' && p.durationMs === d && p.order === order)
    .map(p => blockFraction(p.B) - blockFraction(p.A))));
  if (strata.some(groups => groups.some(g => !g.length))) return null;
  const random = rng(REDUCED.bootstrapSeed), areas = [], weights = trapezoidWeights(points);
  for (let i = 0; i < REDUCED.bootstrapReplicates; i++) {
    let area = 0;
    for (const [j, groups] of strata.entries()) {
      let total = 0, n = 0;
      for (const group of groups) for (let k = 0; k < group.length; k++) {
        total += group[Math.floor(random() * group.length)]; n++;
      }
      area += weights[j] * total / n;
    }
    areas.push(area);
  }
  areas.sort((a, b) => a - b);
  return { lower: quantile(areas, REDUCED.alpha / 2), upper: quantile(areas, 1 - REDUCED.alpha / 2),
    replicates: REDUCED.bootstrapReplicates, seed: REDUCED.bootstrapSeed,
    method: 'percentile; whole A/B process-pair blocks; stratified by point and AB/BA',
    degenerate: areas[0] === areas.at(-1) };
}
export function reducedDecisionChecks(result, name) {
  const rows = result.summary.boundary, shift = result.summary.boundaryShiftMs;
  const d = result.config.sweepSelection.cMs + REDUCED.sensitiveOffsetMs;
  const row = rows.find(r => Math.abs(r.dMs - d) < 1e-9), interval = row?.differenceInterval;
  const check = (name, passed, values) => ({ name, passed: Boolean(passed), values });
  if (name === 'positive') return [
    check('positiveIntegratedDifference', Number.isFinite(shift) && shift >= REDUCED.positiveMinMs && shift <= REDUCED.positiveMaxMs,
      { actual: shift, min: REDUCED.positiveMinMs, max: REDUCED.positiveMaxMs }),
    check('sensitiveIntervalAboveZero', Number.isFinite(interval?.lower) && interval.lower > 0,
      { dMs: d, difference: row?.difference ?? null, interval: interval ?? null, lowerStrictlyAbove: 0 }),
  ];
  assert.equal(name, 'negative');
  return [check('negativeIntegratedDifference', Number.isFinite(shift) && Math.abs(shift) <= REDUCED.negativeAbsMaxMs,
    { actual: shift, absMax: REDUCED.negativeAbsMaxMs }),
  check('sensitiveIntervalContainsZero', Number.isFinite(interval?.lower) && Number.isFinite(interval?.upper) && interval.lower <= 0 && interval.upper >= 0,
    { dMs: d, difference: row?.difference ?? null, interval: interval ?? null })];
}
export function reducedInference(result) {
  const interval = result.summary?.boundaryShiftIntervalMs;
  return { primaryDwellMs: result.config.sweepSelection.cMs + REDUCED.mainPrimaryOffsetMs,
    mde: designMde(result.config.boundaryRepetitions), optimisticMde: designMde(result.config.boundaryRepetitions, 0),
    marginMs: [REDUCED.marginLowMs, REDUCED.marginHighMs],
    intervalInsideMargin: result.status === 'complete' && Boolean(interval && interval.degenerate !== true && interval.lower >= REDUCED.marginLowMs && interval.upper <= REDUCED.marginHighMs),
    interpretation: 'a probe-induced shift smaller than MDE is not detectable',
    qualification: 'conditional 80%-power planning approximation; local slope 0.08/ms, independent stationary process pairs, nonnegative within-pair arm covariance; no unconditional millisecond MDE from counts alone' };
}
