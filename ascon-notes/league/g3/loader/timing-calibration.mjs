import assert from 'node:assert/strict';
import { dwell, injectedReceiveDelay } from './timing-wait.mjs';

export const CALIBRATION = Object.freeze({ requestedMs: Object.freeze([5, 10, 25]),
  samplesPerLength: 20, maxMedianErrorMs: 1 });

const quantile = (sorted, p) => {
  const position = (sorted.length - 1) * p, lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
};

// Injection is only a synthetic-test seam; production runs use the exact shared
// dwell/receive-delay functions. No CLI/environment knob can weaken the gate.
export async function calibrateTiming({ requestedMs = CALIBRATION.requestedMs,
  samplesPerLength = CALIBRATION.samplesPerLength, primitives = { dwell, injectedReceiveDelay },
  now = () => performance.now() } = {}) {
  assert.ok(requestedMs.length > 0 && requestedMs.every(d => Number.isFinite(d) && d > 0));
  assert.ok(Number.isSafeInteger(samplesPerLength) && samplesPerLength > 0);
  const calibration = { status: 'complete', clock: 'performance.now',
    context: 'coordinator startup, before any arm process or measured interval',
    primitive: 'performance.now busy-spin (intentionally consumes one core)',
    requestedMs: [...requestedMs], samplesPerLength, maxMedianErrorMs: CALIBRATION.maxMedianErrorMs,
    primitives: {} };
  for (const name of ['dwell', 'injectedReceiveDelay']) {
    const rows = calibration.primitives[name] = [];
    for (const requested of requestedMs) {
      const achievedMs = [];
      for (let i = 0; i < samplesPerLength; i++) {
        const begin = now();
        await primitives[name](requested);
        const achieved = now() - begin;
        assert.ok(Number.isFinite(achieved) && achieved >= 0, 'invalid calibration clock');
        achievedMs.push(achieved);
      }
      const sorted = [...achievedMs].sort((a, b) => a - b);
      const medianAchievedMs = quantile(sorted, 0.5);
      const medianErrorMs = Math.abs(medianAchievedMs - requested);
      rows.push({ requestedMs: requested, n: samplesPerLength, achievedMs, medianAchievedMs,
        p95AchievedMs: quantile(sorted, 0.95), medianErrorMs,
        maxErrorMs: Math.max(...achievedMs.map(d => Math.abs(d - requested))),
        passed: medianErrorMs <= CALIBRATION.maxMedianErrorMs });
    }
  }
  calibration.passed = Object.values(calibration.primitives).flat().every(row => row.passed);
  return calibration;
}

export function assertTimingCalibration(calibration) {
  // Recompute from measured values rather than trusting a stored pass flag.
  for (const name of ['dwell', 'injectedReceiveDelay']) {
    for (const row of calibration.primitives[name]) {
      if (!Number.isFinite(row.medianAchievedMs) ||
          Math.abs(row.medianAchievedMs - row.requestedMs) > CALIBRATION.maxMedianErrorMs) {
        const code = name === 'dwell' ? 'TIMING_DWELL_INACCURATE' : 'TIMING_DELAY_INACCURATE';
        throw Object.assign(Error(code), { code, primitive: name, requestedMs: row.requestedMs });
      }
    }
  }
}

export function renderCalibration(result) {
  const c = result.calibration;
  if (!c || c.status !== 'complete') return `Timing calibration: ${c?.status ?? 'not recorded (legacy artifact)'}.`;
  const lines = ['Timing calibration: achieved vs requested (ms).', '',
    `Context: ${c.context}. ${c.primitive}.`,
    `Gate: absolute median error > ${c.maxMedianErrorMs}ms aborts; passed=${c.passed}. p95/max error are descriptive.`, '',
    '| primitive | requested ms | n | median achieved ms | p95 achieved ms | median error ms | max error ms | passed |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |'];
  for (const [name, rows] of Object.entries(c.primitives)) for (const row of rows) {
    lines.push(`| ${name} | ${row.requestedMs} | ${row.n} | ${row.medianAchievedMs} | ${row.p95AchievedMs} | ${row.medianErrorMs} | ${row.maxErrorMs} | ${row.passed} |`);
  }
  return lines.join('\n');
}
