import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const SWEEP = Object.freeze({ halfWidthMs: 12, stepMs: 0.5, sensitiveOffsetMs: -4 });
export const CONTROL_THRESHOLDS = Object.freeze({ positiveMinMs: 3, positiveMaxMs: 9,
  sensitiveIncrease: 0.5, negativeAbsMaxMs: 2, lowMax: 0.125, highMin: 0.875 });
export const MAX_TRANSITION_WIDTH_MS = 10;

// Envelope of ALL portions of the adjacent-point linear curve in [0.1, 0.9].
// Include later reversals; a noisy return to the transition must not look sharp.
// Interpolation also gives a nonzero width to a sampled 0 -> 1 jump.
export function transitionWidth(points, arm) {
  const sorted = [...points].sort((a, b) => a.dMs - b.dMs);
  const spans = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i], p = a[arm].fraction, q = b[arm].fraction;
    if (p === null || q === null) continue;
    assert.ok(Number.isFinite(p) && Number.isFinite(q) && p >= 0 && p <= 1 && q >= 0 && q <= 1);
    assert.ok(b.dMs > a.dMs);
    if (p === q) {
      if (p >= 0.1 && p <= 0.9) spans.push([a.dMs, b.dMs]);
    } else {
      const crossings = [(0.1 - p) / (q - p), (0.9 - p) / (q - p)].sort((x, y) => x - y);
      const lo = Math.max(0, crossings[0]), hi = Math.min(1, crossings[1]);
      if (lo <= hi) spans.push([a.dMs + lo * (b.dMs - a.dMs), a.dMs + hi * (b.dMs - a.dMs)]);
    }
  }
  if (!spans.length) return { minDwellMs: null, maxDwellMs: null, widthMs: null };
  const minDwellMs = Math.min(...spans.map(s => s[0])), maxDwellMs = Math.max(...spans.map(s => s[1]));
  return { minDwellMs, maxDwellMs, widthMs: maxDwellMs - minDwellMs };
}

export function explorationQuality(points, limitMs = MAX_TRANSITION_WIDTH_MS) {
  assert.ok(Number.isFinite(limitMs) && limitMs > 0 && limitMs <= MAX_TRANSITION_WIDTH_MS);
  const arms = Object.fromEntries(['A', 'B'].map(arm => [arm, transitionWidth(points, arm)]));
  const blurred = Object.values(arms).some(a => a.widthMs !== null && a.widthMs > limitMs);
  return { limitMs, arms, rejected: blurred,
    reason: blurred ? 'too blurred to detect a 3 ms shift' : null,
    method: 'envelope of all adjacent-point linear segments with timeout fraction in [0.1, 0.9]; no smoothing' };
}

// Pure selection. First upward 0.5 crossing, piecewise linear interpolation on
// adjacent observed points, no smoothing/extrapolation. Endpoints use that same
// interpolation for BOTH arms; strict coverage is required even if tails saturate.
export function selectSweep(exploration) {
  assert.equal(exploration.mode, 'exploration', 'only exploration input is accepted');
  assert.equal(exploration.status, 'complete', 'exploration must be complete');
  const { config } = exploration;
  assert.ok(Number.isFinite(config.timeoutMs) && config.timeoutMs > 0);
  assert.equal(config.arms.length, 2);
  assert.ok(config.arms.every(a => a.probe === true && a.delayMs === 0), 'exploration must have two unmodified probe arms');
  const points = [...exploration.summary.exploration].sort((a, b) => a.dMs - b.dMs);
  assert.ok(points.length >= 2);
  for (const [i, p] of points.entries()) {
    assert.ok(Number.isFinite(p.dMs) && p.dMs >= 0 && (!i || p.dMs > points[i - 1].dMs));
    assert.ok(Number.isSafeInteger(p.n) && p.n > 0 && p.n === config.boundaryRepetitions * (config.measuredDecides ?? 1));
    for (const arm of ['A', 'B']) {
      assert.ok(Number.isInteger(p[arm].timeouts) && p[arm].timeouts >= 0 && p[arm].timeouts <= p.n);
      assert.equal(p[arm].fraction, p[arm].timeouts / p.n);
    }
  }
  assert.ok(points.some(p => p.A.fraction < 0.5) && points.some(p => p.A.fraction > 0.5), 'non-bracketing exploration');
  const quality = explorationQuality(points, config.maxTransitionWidthMs);
  assert.ok(!quality.rejected, 'too blurred to detect a 3 ms shift');
  const i = points.findIndex((p, j) => j > 0 && points[j - 1].A.fraction < 0.5 && p.A.fraction >= 0.5);
  assert.ok(i > 0, 'non-bracketing upward transition');
  const left = points[i - 1], right = points[i];
  const cMs = left.dMs + (0.5 - left.A.fraction) * (right.dMs - left.dMs) / (right.A.fraction - left.A.fraction);
  const minDwellMs = cMs - SWEEP.halfWidthMs, maxDwellMs = cMs + SWEEP.halfWidthMs;
  assert.ok(minDwellMs >= points[0].dMs && maxDwellMs <= points.at(-1).dMs, 'derived range not covered by exploration');
  const interpolate = (d, arm) => {
    const hi = points.findIndex(p => p.dMs >= d);
    if (points[hi].dMs === d) return points[hi][arm].fraction;
    const lo = points[hi - 1], up = points[hi];
    return lo[arm].fraction + (up[arm].fraction - lo[arm].fraction) * (d - lo.dMs) / (up.dMs - lo.dMs);
  };
  const endpoints = Object.fromEntries(['A', 'B'].map(arm => [arm,
    { low: interpolate(minDwellMs, arm), high: interpolate(maxDwellMs, arm) }]));
  assert.ok(Object.values(endpoints).every(p => p.low <= CONTROL_THRESHOLDS.lowMax && p.high >= CONTROL_THRESHOLDS.highMin), 'derived endpoints must bracket success and timeout');
  const dwellPointsMs = Array.from({ length: 2 * SWEEP.halfWidthMs / SWEEP.stepMs + 1 },
    (_, j) => minDwellMs + j * SWEEP.stepMs);
  return { ...SWEEP, timeoutMs: config.timeoutMs, cMs, minDwellMs, maxDwellMs,
    sensitiveDwellMs: cMs + SWEEP.sensitiveOffsetMs, dwellPointsMs, endpoints,
    interpolation: 'first upward A=0.5 crossing; adjacent-point linear interpolation; no extrapolation',
    thresholds: CONTROL_THRESHOLDS, explorationQuality: quality };
}

export function loadSweep(path) {
  const bytes = readFileSync(path);
  return { explorationFile: resolve(path), explorationSha256: createHash('sha256').update(bytes).digest('hex'),
    ...selectSweep(JSON.parse(bytes)) };
}

export function delayHitsByPhase(raw, arm) {
  const totals = { warmup: 0, overhead: 0, exploration: 0, boundary: 0 };
  for (const sample of raw) {
    assert.ok(Object.hasOwn(totals, sample.phase));
    const hits = sample[arm]?.delayHits;
    assert.ok(Number.isSafeInteger(hits) && hits >= 0, 'per-decision delayHits required');
    const unit = sample[arm];
    if (unit.decides) {
      const sum = records => records.reduce((n, d) => {
        assert.ok(Number.isSafeInteger(d.delayHits) && d.delayHits >= 0);
        return n + d.delayHits;
      }, 0);
      const discarded = sum(unit.warmup), measured = sum(unit.decides);
      assert.equal(discarded + measured, hits, 'all delay hits accounted per decide');
      totals.warmup += discarded;
      totals[sample.phase] += measured;
    } else totals[sample.phase] += hits;
  }
  return totals;
}

// Every control assertion is serializable, including failures before thresholds.
export function controlChecks(result, name) {
  const checks = [];
  const check = (name, passed, values) => checks.push({ name, passed: Boolean(passed), values });
  check('confirmationComplete', result.mode === 'confirmation' && result.status === 'complete',
    { mode: result.mode, status: result.status, failure: result.failure ?? null });
  if (!checks[0].passed) return checks;
  check('selectionRecorded', Boolean(result.config.sweepSelection?.explorationSha256), { selection: result.config.sweepSelection ?? null });
  const rows = result.summary.boundary;
  for (const row of rows) {
    const samples = result.raw.filter(p => p.phase === 'boundary' && p.durationMs === row.dMs);
    const ab = samples.filter(p => p.order === 'AB').length, ba = samples.filter(p => p.order === 'BA').length;
    const processes = result.config.boundaryRepetitions;
    const expectedN = processes * (result.config.measuredDecides ?? 1);
    check('balancedPoint', row.n === expectedN && ab === processes / 2 && ba === processes / 2,
      { dMs: row.dMs, n: row.n, expectedN, processes, ab, ba });
  }
  for (const [i, arm] of ['A', 'B'].entries()) {
    const low = rows[0]?.[arm].fraction, high = rows.at(-1)?.[arm].fraction;
    check('lowEndpoint', Number.isFinite(low) && low <= 0.125, { arm, actual: low ?? null, max: 0.125 });
    check('highEndpoint', Number.isFinite(high) && high >= 0.875, { arm, actual: high ?? null, min: 0.875 });
    const diagnostic = result.armDiagnostics?.[i];
    check('probeStructure', diagnostic?.probe?.measurementStructureChecked === true && diagnostic.probe.expectedTimeouts > 0,
      { arm, probe: diagnostic?.probe ?? null });
    const hits = diagnostic?.delayHitsByPhase?.boundary;
    check('boundaryDelayHits', name === 'positive' && arm === 'B' ? hits >= result.config.boundaryRepetitions : hits === 0,
      { arm, actual: hits ?? null, minimum: name === 'positive' && arm === 'B' ? result.config.boundaryRepetitions : 0,
        maximum: name === 'positive' && arm === 'B' ? null : 0 });
  }
  const shift = result.summary.boundaryShiftMs;
  if (name === 'positive') {
    check('positiveIntegratedDifference', Number.isFinite(shift) && shift >= 3 && shift <= 9, { actual: shift, min: 3, max: 9 });
    const d = result.config.sweepSelection?.sensitiveDwellMs;
    const sensitive = rows.find(r => Math.abs(r.dMs - d) < 1e-9);
    check('sensitiveTimeoutIncrease', Number.isFinite(sensitive?.difference) && sensitive.difference >= 0.5,
      { dMs: d ?? null, actual: sensitive?.difference ?? null, min: 0.5 });
  } else {
    assert.equal(name, 'negative');
    check('negativeIntegratedDifference', Number.isFinite(shift) && Math.abs(shift) <= 2, { actual: shift, absMax: 2 });
  }
  return checks;
}

export function storeControlVerdict(result, name, extraChecks = []) {
  result.controlAssertions = [...controlChecks(result, name), ...extraChecks];
  result.controlFailures = result.controlAssertions.filter(c => !c.passed);
  result.controlVerdict = result.controlFailures.length ? 'failed' : 'passed';
  return result;
}
