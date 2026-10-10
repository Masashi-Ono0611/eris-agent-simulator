// SYNTHETIC ONLY: no runExperiment, StrategyRunner, Workers or real controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { selectSweep, loadSweep, delayHitsByPhase, storeControlVerdict, transitionWidth, explorationQuality } from '../loader/timing-sweep.mjs';
import { prepareTimingConfig, artifactWriter, renderReport, summarize, DEFAULTS, renderControlReport } from '../loader/measure-timing.mjs';
import { parseTimingArgs, parseTimingEnvironment } from '../loader/timing-options.mjs';

function exploration() {
  return { mode: 'exploration', status: 'complete', config: { timeoutMs: 100, boundaryRepetitions: 4,
    arms: [{ probe: true, delayMs: 0 }, { probe: true, delayMs: 0 }] },
  summary: { exploration: Array.from({ length: 23 }, (_, i) => {
    const dMs = i * 5, timeouts = dMs < 40 ? 0 : dMs === 40 ? 1 : 4;
    return { dMs, n: 4, A: { timeouts, fraction: timeouts / 4 }, B: { timeouts, fraction: timeouts / 4 } };
  }) } };
}
function temporary(fn) {
  const dir = mkdtempSync(fileURLToPath(new URL('./.sweep-test-', import.meta.url)));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('first upward crossing is linearly interpolated; derived range and c-4 are deterministic', () => {
  const data = exploration(), before = structuredClone(data);
  const selected = selectSweep(data);
  assert.equal(selected.cMs, 40 + 5 / 3);
  assert.equal(selected.minDwellMs, selected.cMs - 12);
  assert.equal(selected.maxDwellMs, selected.cMs + 12);
  assert.equal(selected.sensitiveDwellMs, selected.cMs - 4);
  assert.equal(selected.stepMs, 0.5);
  assert.equal(selected.dwellPointsMs.length, 49);
  assert.ok(selected.dwellPointsMs.some(d => Math.abs(d - selected.sensitiveDwellMs) < 1e-9));
  assert.deepEqual(selectSweep(data), selected);
  assert.deepEqual(data, before);
});

test('all-timeout and all-success explorations are rejected', () => {
  for (const timeouts of [0, 4]) {
    const data = exploration();
    for (const p of data.summary.exploration) p.A = p.B = { timeouts, fraction: timeouts / 4 };
    assert.throws(() => selectSweep(data), /non-bracketing/);
  }
});

test('reject uncovered derived range and endpoint non-bracketing in either arm', () => {
  const short = exploration();
  short.summary.exploration = short.summary.exploration.filter(p => p.dMs >= 35);
  assert.throws(() => selectSweep(short), /not covered/);
  for (const arm of ['A', 'B']) {
    for (const side of ['low', 'high']) {
      const data = exploration();
      for (const p of data.summary.exploration) {
        if (side === 'low' ? p.dMs < 40 : p.dMs > 45) {
          const timeouts = side === 'low' ? 1 : 3;
          p[arm] = { timeouts, fraction: timeouts / 4 };
        }
      }
      assert.throws(() => selectSweep(data), /derived endpoints must bracket|too blurred/);
    }
  }
});

test('refuse incomplete, intervened, wrong-mode or malformed exploration data', () => {
  for (const change of [d => d.status = 'aborted', d => d.mode = 'confirmation',
    d => d.config.arms[0].delayMs = 6, d => d.config.arms[1].probe = false,
    d => d.summary.exploration[0].A.fraction = NaN, d => d.summary.exploration[0].n = 0]) {
    const data = exploration(); change(data); assert.throws(() => selectSweep(data));
  }
});

test('CLI and test environment select exploration input; modes are exclusive', () => {
  assert.equal(parseTimingArgs(['--explore', '--output', 'new']).explore, true);
  assert.equal(parseTimingArgs(['--output', 'new', '--sweep-from', 'synthetic.json']).sweepFrom, 'synthetic.json');
  assert.equal(parseTimingEnvironment({ G3_TIMING_SWEEP_FROM: 'synthetic.json' }).sweepFrom, 'synthetic.json');
  assert.throws(() => parseTimingArgs(['--output', 'new', '--explore', '--sweep-from', 'x']), /exclusive/);
  assert.throws(() => prepareTimingConfig({}, {}), /requires/);
  const config = prepareTimingConfig({ explore: true }, {});
  assert.equal(config.timeoutMs + config.minOffsetMs, 0);
  assert.equal(config.timeoutMs + config.maxOffsetMs, 110);
  assert.equal(config.stepMs, 5);
  assert.equal(config.boundaryRepetitions, 4);
  assert.ok(config.arms.every(a => a.probe && a.delayMs === 0));
});

test('SHA hashes exact input bytes; range is persisted in JSON and markdown before results exist', () => temporary(dir => {
  const path = join(dir, 'synthetic.json'), bytes = JSON.stringify(exploration()) + '\n';
  writeFileSync(path, bytes);
  const selected = loadSweep(path), sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(selected.explorationSha256, sha);
  const config = prepareTimingConfig({ sweepFrom: path }, {});
  assert.deepEqual(config, prepareTimingConfig({}, { G3_TIMING_SWEEP_FROM: path }));
  assert.deepEqual(config.sweepSelection, selected);
  assert.equal(config.timeoutMs, 100);
  assert.throws(() => prepareTimingConfig({ sweepFrom: path, timeoutMs: 80 }, {}), /T mismatch/);
  const metadata = { platform: 'synthetic', release: 'fixture', arch: 'synthetic', cpuModel: 'synthetic',
    logicalCpus: 1, node: 'synthetic', tsx: 'synthetic', loadAverage: [0, 0, 0] };
  const plan = { mode: 'confirmation', status: 'planned', config, raw: [], summary: summarize([], config),
    hostBefore: metadata, hostAfter: metadata };
  for (const control of [false, true]) {
    const prefix = join(dir, control ? 'controls' : 'main');
    const persist = artifactWriter(prefix, control ? renderControlReport : renderReport);
    const value = control ? { positive: plan, negative: plan } : plan;
    persist(value);
    const disk = JSON.parse(readFileSync(`${prefix}.json`));
    assert.equal((control ? disk.positive : disk).status, 'planned');
    assert.equal((control ? disk.negative : disk).config.sweepSelection.explorationSha256, sha);
    const md = readFileSync(`${prefix}.md`, 'utf8');
    for (const text of [sha, 'minDwellMs', 'maxDwellMs', 'sensitiveDwellMs']) assert.ok(md.includes(text));
    persist(value); // Only the writer owning this reserved output can update it.
    assert.throws(() => artifactWriter(prefix, renderReport)(plan), /EEXIST/);
  }
}));

test('delay hits split warmup, overhead, boundary and exploration on synthetic records', () => {
  const raw = ['warmup', 'boundary', 'boundary', 'overhead', 'exploration'].map((phase, i) =>
    ({ phase, A: { delayHits: 0 }, B: { delayHits: i + 1 } }));
  assert.deepEqual(delayHitsByPhase(raw, 'B'), { warmup: 1, boundary: 5, overhead: 4, exploration: 5 });
  assert.deepEqual(delayHitsByPhase(raw, 'A'), { warmup: 0, boundary: 0, overhead: 0, exploration: 0 });
});

test('exploration samples never contribute to confirmation summary or control pass', () => {
  const config = { ...DEFAULTS, minOffsetMs: -100, maxOffsetMs: -95, stepMs: 5 };
  const raw = [{ phase: 'exploration', durationMs: 0, A: { timedOut: true }, B: { timedOut: true } }];
  assert.ok(summarize(raw, config).boundary.every(row => row.n === 0));
  const summary = summarize(raw, { ...config, explore: true });
  assert.equal(summary.boundaryShiftMs, null);
  assert.deepEqual(summary.boundary, []);
  const result = storeControlVerdict({ mode: 'exploration', status: 'complete', summary }, 'positive');
  assert.equal(result.controlVerdict, 'failed');
  assert.equal(result.controlFailures[0].name, 'confirmationComplete');
});

function syntheticControl() {
  const selection = { ...selectSweep(exploration()), explorationSha256: 'synthetic-only' };
  const config = { ...DEFAULTS, measuredDecides: 1, boundaryRepetitions: 4, dwellPointsMs: selection.dwellPointsMs, stepMs: 0.5, sweepSelection: selection };
  const raw = selection.dwellPointsMs.flatMap(d => Array.from({ length: 4 }, (_, repetition) => ({
    phase: 'boundary', durationMs: d, repetition, order: repetition % 2 ? 'BA' : 'AB',
    A: { timedOut: d >= selection.cMs, fixtureElapsedMs: d },
    B: { timedOut: d >= selection.cMs - 6, fixtureElapsedMs: d },
  })));
  return { mode: 'confirmation', status: 'complete', config, raw, summary: summarize(raw, config),
    armDiagnostics: [0, 4].map(hits => ({ delayHitsByPhase: { warmup: 99, boundary: hits },
      probe: { measurementStructureChecked: true, expectedTimeouts: 1 } })) };
}

test('control verdict records assertion names and values, preserves thresholds and excludes warmup hits', () => {
  const good = syntheticControl();
  assert.equal(storeControlVerdict(good, 'positive').controlVerdict, 'passed');
  for (const [shift, pass] of [[2.99, false], [3, true], [9, true], [9.01, false]]) {
    const result = syntheticControl(); result.summary.boundaryShiftMs = shift;
    storeControlVerdict(result, 'positive');
    assert.equal(result.controlAssertions.find(c => c.name === 'positiveIntegratedDifference').passed, pass);
  }
  for (const [shift, pass] of [[-2.01, false], [-2, true], [2, true], [2.01, false]]) {
    const result = syntheticControl(); result.summary.boundaryShiftMs = shift;
    result.armDiagnostics[1].delayHitsByPhase.boundary = 0;
    storeControlVerdict(result, 'negative');
    assert.equal(result.controlAssertions.find(c => c.name === 'negativeIntegratedDifference').passed, pass);
  }
  const bad = syntheticControl();
  bad.armDiagnostics[1].delayHitsByPhase.boundary = 0;
  bad.summary.boundary[0].A.fraction = 1;
  const sensitive = bad.summary.boundary.find(r => Math.abs(r.dMs - bad.config.sweepSelection.sensitiveDwellMs) < 1e-9);
  sensitive.difference = 0.49;
  const saved = JSON.parse(JSON.stringify(storeControlVerdict(bad, 'positive')));
  assert.equal(saved.controlVerdict, 'failed');
  for (const name of ['boundaryDelayHits', 'lowEndpoint', 'sensitiveTimeoutIncrease']) {
    assert.ok(saved.controlFailures.some(f => f.name === name && f.values));
  }
  assert.equal(saved.controlFailures.find(f => f.name === 'boundaryDelayHits').values.actual, 0);
});


test('transition width interpolates jumps and includes noisy later returns', () => {
  const points = pairs => pairs.map(([dMs, fraction]) => ({ dMs, A: { fraction }, B: { fraction } }));
  assert.deepEqual(transitionWidth(points([[0, 0], [5, 1]]), 'A'),
    { minDwellMs: 0.5, maxDwellMs: 4.5, widthMs: 4 });
  assert.deepEqual(transitionWidth(points([[0, 0], [5, 0]]), 'A'),
    { minDwellMs: null, maxDwellMs: null, widthMs: null });
  const noisy = points([[0, 0], [5, 1], [10, 1], [20, 0.5], [25, 1]]);
  assert.equal(transitionWidth(noisy, 'A').widthMs, 23.5);
  assert.equal(explorationQuality(points([[0, 0], [12.5, 1]])).rejected, false); // exactly 10ms
  assert.equal(explorationQuality(points([[0, 0], [12.6, 1]])).rejected, true);
  assert.throws(() => explorationQuality(noisy, 11));
});

test('real cold Mac mini exploration fixture is rejected as too blurred', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/mini-cold-exploration.json', import.meta.url)));
  const quality = explorationQuality(fixture.summary.exploration);
  assert.ok(quality.arms.A.widthMs > 70);
  assert.ok(quality.arms.B.widthMs > 60);
  assert.throws(() => selectSweep(fixture), /too blurred to detect a 3 ms shift/);
  temporary(dir => {
    const path = join(dir, 'blurred.json'); writeFileSync(path, JSON.stringify(fixture));
    assert.throws(() => prepareTimingConfig({ sweepFrom: path }, {}), /too blurred/);
  });
});

test('sharp curve accepted; blurred curve with valid endpoints rejected before controls', () => {
  assert.equal(selectSweep(exploration()).explorationQuality.rejected, false);
  const blurred = exploration();
  for (const p of blurred.summary.exploration) {
    const timeouts = p.dMs < 30 ? 0 : p.dMs <= 45 ? 2 : 4;
    p.A = p.B = { timeouts, fraction: timeouts / 4 };
  }
  assert.throws(() => selectSweep(blurred), /too blurred/);
});

test('endpoint guard still rejects a sharp but non-bracketing second arm', () => {
  for (const timeouts of [0, 4]) {
    const data = exploration();
    for (const p of data.summary.exploration) p.B = { timeouts, fraction: timeouts / 4 };
    assert.throws(() => selectSweep(data), /derived endpoints must bracket/);
  }
});

test('per-decide aggregation excludes discarded warmup and counts N decisions per process', () => {
  const config = { ...DEFAULTS, explore: true, dwellPointsMs: [0, 5], stepMs: 5,
    boundaryRepetitions: 2, measuredDecides: 2 };
  const unit = (timeouts, walls) => ({
    warmup: [{ timedOut: true, wallMs: 999 }],
    decides: walls.map((wallMs, i) => ({ timedOut: timeouts[i], wallMs, fixtureElapsedMs: timeouts[i] ? null : 0 })),
  });
  const raw = [0, 5].flatMap(durationMs => [0, 1].map(repetition => ({
    phase: 'exploration', durationMs, repetition, order: repetition ? 'BA' : 'AB',
    A: unit([false, true], [2, 4]), B: unit([false, false], [3, 5]),
  })));
  const summary = summarize(raw, config);
  for (const row of summary.exploration) {
    assert.equal(row.n, 4); assert.equal(row.processesPerArm, 2);
    assert.equal(row.A.timeouts, 2); assert.equal(row.A.fraction, 0.5);
    assert.equal(row.B.timeouts, 0); assert.equal(row.B.fraction, 0);
    assert.equal(row.A.decideWallMs.median, 3); assert.equal(row.A.decideWallMs.p95, 4);
    assert.equal(row.A.successfulFixtureMs.n, 2);
  }
  assert.deepEqual(summary.fixedCostEstimateMs, { A: 3, B: 4 });
  assert.equal(summary.boundaryShiftMs, null);
  assert.deepEqual(summary.boundary, []);
});
