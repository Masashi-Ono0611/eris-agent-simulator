// Fast synthetic startup checks: launch is replaced by a tripwire. No real
// exploration, controls, measurement, StrategyRunner, Worker or network runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALIBRATION, calibrateTiming, assertTimingCalibration } from '../loader/timing-calibration.mjs';
import { dwell, injectedReceiveDelay } from '../loader/timing-wait.mjs';
import { decide } from '../loader/timing-fixture.mjs';
import { runExperiment, artifactWriter, renderReport, renderRefusal, renderControlReport,
  renderExploration, DEFAULTS, summarize } from '../loader/measure-timing.mjs';

const metadata = { node: 'synthetic', tsx: 'synthetic', arch: 'synthetic',
  platform: 'synthetic', release: 'synthetic', cpuModel: 'synthetic', logicalCpus: 1, loadAverage: [0, 0, 0] };

function simulatedCalibration(badPrimitive, errorMs = 3) {
  let clock = 0;
  return { requestedMs: [1, 2], samplesPerLength: 3, now: () => clock,
    primitives: Object.fromEntries(['dwell', 'injectedReceiveDelay'].map(name => [name,
      d => { clock += d + (name === badPrimitive ? errorMs : 0); }])) };
}

test('short real spin calibration passes for both production primitives and fixture', async () => {
  const c = await calibrateTiming({ requestedMs: [0.5, 1, 2], samplesPerLength: 5 });
  assertTimingCalibration(c);
  assert.equal(c.passed, true);
  assert.equal(dwell, injectedReceiveDelay);
  assert.ok(JSON.parse(decide({ timingDurationMs: 1 }).reason).elapsedMs >= 1);
  for (const rows of Object.values(c.primitives)) for (const row of rows) {
    assert.equal(row.n, 5);
    assert.ok(row.medianAchievedMs >= row.requestedMs);
    assert.ok(row.medianErrorMs <= 1);
    assert.ok(row.p95AchievedMs >= row.medianAchievedMs);
    assert.ok(row.maxErrorMs >= row.medianErrorMs);
  }
});

test('default profile is 20 samples each at 5/10/25ms, separately for each primitive', async () => {
  const options = simulatedCalibration();
  delete options.requestedMs;
  delete options.samplesPerLength;
  const c = await calibrateTiming(options);
  assert.deepEqual(c.requestedMs, [5, 10, 25]);
  assert.equal(CALIBRATION.maxMedianErrorMs, 1);
  for (const rows of Object.values(c.primitives)) {
    assert.deepEqual(rows.map(r => r.requestedMs), [5, 10, 25]);
    assert.ok(rows.every(r => r.n === 20 && r.achievedMs.length === 20));
  }
});

test('positive control: deliberately sloppy setTimeout sleeper triggers named abort', async () => {
  const c = await calibrateTiming({ requestedMs: [1], samplesPerLength: 3,
    primitives: { dwell: ms => new Promise(resolve => setTimeout(resolve, ms + 15)), injectedReceiveDelay } });
  assert.equal(c.passed, false);
  assert.ok(c.primitives.dwell[0].medianErrorMs > 1);
  assert.equal(c.primitives.injectedReceiveDelay.length, 1);
  assert.throws(() => assertTimingCalibration(c), { code: 'TIMING_DWELL_INACCURATE' });
});

test('gate uses absolute error at every length and either primitive; exactly 1ms is allowed', async () => {
  for (const name of ['dwell', 'injectedReceiveDelay']) {
    for (const error of [-1.01, 1.01]) {
      const options = simulatedCalibration(name, error);
      options.requestedMs = [5, 10, 25];
      const c = await calibrateTiming(options);
      // Earlier lengths pass: the last length must still be checked.
      for (const row of c.primitives[name].slice(0, -1)) row.medianAchievedMs = row.requestedMs;
      c.passed = true; // A stale pass flag must not bypass measured values.
      assert.throws(() => assertTimingCalibration(c), {
        code: name === 'dwell' ? 'TIMING_DWELL_INACCURATE' : 'TIMING_DELAY_INACCURATE', requestedMs: 25 });
    }
    assertTimingCalibration(await calibrateTiming(simulatedCalibration(name, 1)));
  }
});

function syntheticExploration() {
  return { mode: 'exploration', status: 'complete', config: { timeoutMs: 100, boundaryRepetitions: 4,
    arms: [{ probe: true, delayMs: 0 }, { probe: true, delayMs: 0 }] },
    summary: { exploration: Array.from({ length: 23 }, (_, i) => {
      const dMs = i * 5, timeouts = dMs < 40 ? 0 : dMs === 40 ? 1 : 4;
      return { dMs, n: 4, A: { timeouts, fraction: timeouts / 4 }, B: { timeouts, fraction: timeouts / 4 } };
    }) } };
}

test('all run modes persist both calibrations and abort before launching on either inaccurate primitive', async () => {
  const dir = mkdtempSync(fileURLToPath(new URL('./.calibration-test-', import.meta.url)));
  try {
    const sweepFrom = join(dir, 'synthetic-exploration.json');
    writeFileSync(sweepFrom, JSON.stringify(syntheticExploration()));
    for (const mode of ['exploration', 'measurement', 'positive', 'negative']) {
      for (const bad of ['dwell', 'injectedReceiveDelay']) {
        const prefix = join(dir, `${mode}-${bad}`), snapshots = [];
        const render = ['positive', 'negative'].includes(mode)
          ? r => renderControlReport({ [mode]: r }) : renderReport;
        const write = artifactWriter(prefix, render);
        const persist = r => { snapshots.push(structuredClone(r)); write(r); };
        let launches = 0;
        const result = await runExperiment(mode === 'exploration' ? { explore: true } : {
          sweepFrom, arms: mode === 'measurement' ? DEFAULTS.arms : [
            { name: 'A', probe: true, delayMs: 0 },
            { name: 'B', probe: true, delayMs: mode === 'positive' ? 6 : 0 }],
        }, () => {}, persist, {
          readHost: () => metadata, calibrationOptions: simulatedCalibration(bad),
          launchArm: () => { launches++; throw Error('SYNTHETIC_LAUNCH_TRIPWIRE'); },
        });
        persist(result); // Same final persistence as CLI/control callers.
        assert.equal(launches, 0);
        assert.equal(result.status, 'aborted');
        assert.equal(result.failure.code, bad === 'dwell' ? 'TIMING_DWELL_INACCURATE' : 'TIMING_DELAY_INACCURATE');
        assert.deepEqual(result.raw, []);
        assert.equal(snapshots[0].calibration.status, 'not-run');
        assert.equal(snapshots[1].calibration.status, 'complete');
        const saved = JSON.parse(readFileSync(`${prefix}.json`, 'utf8'));
        assert.deepEqual(saved.calibration, result.calibration);
        assert.equal(saved.calibration.primitives[bad][0].medianErrorMs, 3);
        for (const hash of ['timing-wait.mjs', 'timing-calibration.mjs']) assert.match(saved.sourceHashes[hash], /^[a-f0-9]{64}$/);
        const md = readFileSync(`${prefix}.md`, 'utf8');
        for (const text of ['dwell', 'injectedReceiveDelay', 'requested ms', 'median achieved ms',
          'p95 achieved ms', 'max error ms', result.failure.code]) assert.ok(md.includes(text), text);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('accurate startup calibration reaches only the synthetic launch tripwire', async () => {
  let launches = 0;
  const result = await runExperiment({ explore: true, maxLoad1: 1000000, loadNote: 'synthetic launch tripwire only' },
    () => {}, () => {}, { readHost: () => metadata, calibrationOptions: simulatedCalibration(),
      launchArm: () => { launches++; throw Error('SYNTHETIC_LAUNCH_TRIPWIRE'); } });
  assert.equal(result.calibration.passed, true);
  assert.equal(launches, 1);
  assert.equal(result.failure.code, 'SYNTHETIC_LAUNCH_TRIPWIRE');
});

test('every report prints supplied calibration values; missing/declined calibration is explicit', async () => {
  const calibration = await calibrateTiming(simulatedCalibration());
  const result = { config: DEFAULTS, calibration, hostBefore: metadata, hostAfter: metadata,
    status: 'aborted', raw: [], summary: summarize([], DEFAULTS), failure: { code: 'SYNTHETIC' } };
  for (const render of [renderReport, renderExploration, renderRefusal, r => renderControlReport({ positive: r })]) {
    const md = render(JSON.parse(JSON.stringify(result)));
    assert.ok(md.includes('| dwell | 1 | 3 | 1 | 1 | 0 | 0 | true |'));
    assert.ok(md.includes('| injectedReceiveDelay | 2 | 3 | 2 | 2 | 0 | 0 | true |'));
    assert.ok(render({ ...result, calibration: { status: 'not-run' } }).includes('Timing calibration: not-run'));
    assert.ok(render({ ...result, calibration: undefined }).includes('not recorded (legacy artifact)'));
  }
});
