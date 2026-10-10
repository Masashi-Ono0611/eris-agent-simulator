// Synthetic statistics and fake-arm coordinator only. No real timing processes,
// Workers, exploration, controls, network, models or measurements are launched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REDUCED, wilson, newcombe, blockPoint, trapezoid, bootstrapShift, designMde, reducedDecisionChecks, reducedInference } from '../loader/timing-reduced.mjs';
import { selectSweep, storeControlVerdict } from '../loader/timing-sweep.mjs';
import { prepareTimingConfig, summarize, artifactWriter, renderReport, renderControlReport, renderRefusal, runExperiment } from '../loader/measure-timing.mjs';
import { parseTimingArgs, parseTimingEnvironment, assertFreshOutput } from '../loader/timing-options.mjs';
import { budgetMinutes, testTimeoutMs, createBudget, partialJournal, stopTimingClient } from '../loader/timing-budget.mjs';
import { probeToolchain } from '../loader/probe-toolchain.mjs';

const near = (actual, expected, epsilon = 1e-12) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const metadata = { ...probeToolchain(), arch: 'synthetic', platform: 'synthetic', release: 'synthetic', cpuModel: 'synthetic', logicalCpus: 1, loadAverage: [0, 0, 0] };
function exploration() {
  return { mode: 'exploration', status: 'complete', config: { timeoutMs: 100, boundaryRepetitions: 4,
    arms: [{ probe: true, delayMs: 0 }, { probe: true, delayMs: 0 }] },
  summary: { exploration: Array.from({ length: 23 }, (_, i) => {
    const dMs = i * 5, timeouts = dMs < 40 ? 0 : dMs === 40 ? 2 : 4;
    return { dMs, n: 4, A: { timeouts, fraction: timeouts / 4 }, B: { timeouts, fraction: timeouts / 4 } };
  }) } };
}
async function temporary(fn) {
  const dir = mkdtempSync(fileURLToPath(new URL('./.reduced-test-', import.meta.url)));
  try {
    const sweepFrom = join(dir, 'synthetic.json'); writeFileSync(sweepFrom, JSON.stringify(exploration()));
    return await fn(dir, sweepFrom);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function unit(fraction = 0, delay = 0) {
  return { status: 'complete', measuredDecideCount: 4, rewarmCount: 0, discardedDecideCount: 5,
    delayHits: delay * 4, warmup: Array.from({ length: 5 }, () => ({ delayHits: 0 })),
    decides: Array.from({ length: 4 }, (_, i) => ({ timedOut: i < fraction * 4, wallMs: 1,
      fixtureElapsedMs: i < fraction * 4 ? null : 0, delayHits: delay })),
    durations: { setSource: 0, start: 0, startReady: 0, close: 0 } };
}
function syntheticControl(shift = 6, name = 'positive') {
  const selection = { ...selectSweep(exploration(), 'reduced'), explorationSha256: 'synthetic-only' };
  const config = { protocol: 'reduced', protocolConstants: REDUCED, controlName: name,
    timeoutMs: 100, measuredDecides: 4, warmupDecides: 5, repetitions: 0, warmupPairs: 2, boundaryRepetitions: 24,
    budgetMin: 30, maxLoad1: 2.5, loadNote: '', seed: REDUCED[`${name}Seed`], cooldownMs: 1500,
    dwellPointsMs: selection.dwellPointsMs, stepMs: null, sweepSelection: selection,
    arms: [{ probe: true, delayMs: 0 }, { probe: true, delayMs: name === 'positive' ? 6 : 0 }] };
  const step = x => x < 0 ? 0 : x === 0 ? 0.5 : 1;
  const raw = ['AB', 'BA'].map(order => ({ phase: 'warmup', durationMs: 0, order, A: unit(), B: unit() }));
  raw.push(...selection.dwellPointsMs.flatMap(d => Array.from({ length: 24 }, (_, repetition) => ({
    phase: 'boundary', durationMs: d, repetition, order: repetition % 2 ? 'BA' : 'AB',
    A: unit(step(d - selection.cMs)), B: unit(step(d - selection.cMs + shift), name === 'positive' ? 1 : 0),
  }))));
  return { mode: 'confirmation', status: 'complete', config, raw, summary: summarize(raw, config),
    hostBefore: metadata, hostAfter: metadata,
    armDiagnostics: [0, name === 'positive' ? 24 : 0].map(hits => ({ delayHitsByPhase: { boundary: hits },
      probe: { measurementStructureChecked: true, expectedTimeouts: 1 } })) };
}

test('explicit reduced selection preserves legacy default, exact grid, original centre and guards', () => {
  const original = exploration(), old = selectSweep(original), reduced = selectSweep(original, 'reduced');
  assert.equal(old.dwellPointsMs.length, 49); assert.equal(old.stepMs, 0.5);
  assert.equal(reduced.cMs, old.cMs); assert.equal(reduced.stepMs, null);
  assert.deepEqual(reduced.dwellPointsMs.map(d => d - reduced.cMs), [-12, -8, -6, -4, 0, 4, 12]);
  assert.equal(reduced.sensitiveDwellMs, reduced.cMs - 4);
  assert.ok(reduced.dwellPointsMs.includes(reduced.cMs - 6));
  assert.deepEqual(reduced.endpoints, old.endpoints);
  for (const change of [x => x.status = 'rejected', x => x.config.arms[0].delayMs = 6,
    x => x.summary.exploration.forEach(p => { p.B = { timeouts: 0, fraction: 0 }; }),
    x => x.summary.exploration.forEach(p => { p.A = { timeouts: 4, fraction: 1 }; }),
    x => x.summary.exploration = x.summary.exploration.filter(p => p.dMs >= 35),
    x => x.summary.exploration.forEach(p => { if (p.dMs >= 20 && p.dMs <= 60) p.A = p.B = { timeouts: 2, fraction: 0.5 }; })]) {
    const bad = structuredClone(original); change(bad); assert.throws(() => selectSweep(bad, 'reduced'));
  }
});

test('CLI/env protocol and budget are explicit, validated, and CLI takes precedence', () => temporary((dir, sweepFrom) => {
  assert.equal(parseTimingArgs(['--output', 'fresh', '--protocol', 'reduced', '--budget-min', '12.5']).budgetMin, 12.5);
  assert.deepEqual(parseTimingEnvironment({ G3_TIMING_PROTOCOL: 'reduced', G3_TIMING_BUDGET_MIN: '30' }),
    { protocol: 'reduced', budgetMin: 30, maxLoad1: 2.5, loadNote: '' });
  for (const value of ['', '0', '-1', 'NaN', 'Infinity', '999999999']) {
    assert.throws(() => budgetMinutes(value));
    assert.throws(() => parseTimingEnvironment({ G3_TIMING_BUDGET_MIN: value }), /G3_TIMING_BUDGET_MIN/);
  }
  assert.throws(() => parseTimingEnvironment({ G3_TIMING_PROTOCOL: 'typo' }), /G3_TIMING_PROTOCOL/);
  assert.throws(() => parseTimingArgs(['--output', 'x', '--protocol', 'oops']));
  const config = prepareTimingConfig({ sweepFrom, protocol: 'legacy', budgetMin: 20 }, { G3_TIMING_PROTOCOL: 'reduced', G3_TIMING_BUDGET_MIN: '30' });
  assert.equal(config.dwellPointsMs.length, 49); assert.equal(config.budgetMin, 20);
  assert.equal(prepareTimingConfig({ sweepFrom }, {}).measuredDecides, 40);
  assert.throws(() => prepareTimingConfig({ explore: true, protocol: 'reduced' }, {}), /confirmation-only/);
}));

test('all counts, constants and exact exploration SHA recorded before any reduced data', () => temporary((dir, sweepFrom) => {
  for (const controlName of [undefined, 'positive', 'negative']) {
    const config = prepareTimingConfig({ sweepFrom, protocol: 'reduced', controlName }, {});
    assert.deepEqual(config.protocolConstants, REDUCED);
    assert.equal(config.measuredDecides, 4); assert.equal(config.warmupDecides, 5);
    assert.equal(config.boundaryRepetitions, controlName ? 24 : 64);
    assert.equal(config.repetitions, controlName ? 0 : 24); assert.equal(config.warmupPairs, 2);
    assert.equal(config.budgetMin, controlName ? 30 : 90);
    assert.equal(config.cooldownMs, 1500);
    assert.equal(config.boundaryRepetitions * 7 + config.repetitions + config.warmupPairs, controlName ? 170 : 474);
    assert.equal(config.sweepSelection.explorationSha256, createHash('sha256').update(readFileSync(sweepFrom)).digest('hex'));
    const plan = { config, status: 'planned', mode: 'confirmation', raw: [], hostBefore: metadata, hostAfter: metadata, summary: summarize([], config) };
    const prefix = join(dir, controlName ?? 'main'), write = artifactWriter(prefix, renderReport);
    write(plan);
    assert.deepEqual(JSON.parse(readFileSync(`${prefix}.json`)).config.protocolConstants, REDUCED);
    for (const report of [readFileSync(`${prefix}.md`, 'utf8'), renderControlReport({ [controlName ?? 'main']: plan }), renderRefusal(plan)]) {
      assert.ok(report.includes(JSON.stringify(REDUCED, null, 2)));
      assert.ok(report.includes(config.sweepSelection.explorationSha256));
      assert.ok(!/\bequivalent\b|no interference/i.test(report));
    }
  }
  for (const [key, value] of Object.entries({ measuredDecides: 40, warmupDecides: 1, cooldownMs: 0, boundaryRepetitions: 2, seed: 1 })) {
    assert.throws(() => prepareTimingConfig({ sweepFrom, protocol: 'reduced', [key]: value }, {}), /reduced fixes/);
  }
}));

test('Wilson/Newcombe block-effective intervals match independently hand-calculated values', () => {
  near(wilson(0, 24).upper, 0.13797620467498017);
  near(wilson(0.5, 24).lower, 0.3142742581957335);
  near(wilson(0.5, 24).upper, 0.6857257418042665);
  near(newcombe(0, 1, 24).lower, 0.804872180063877);
  const difference = newcombe(0.25, 0.75, 24);
  near(difference.lower, 0.2185793640422723); near(difference.upper, 0.6838567259896662);
  const pairs = Array.from({ length: 24 }, (_, i) => ({ order: i % 2 ? 'BA' : 'AB', A: unit(0.25), B: unit(0.75) }));
  assert.deepEqual(blockPoint(pairs).differenceInterval, difference);
  assert.notDeepEqual(blockPoint(pairs).differenceInterval, newcombe(0.25, 0.75, 96));
  assert.equal(blockPoint([]).differenceInterval, null);
  assert.throws(() => wilson(0.5, 0));
});

test('non-uniform trapezoid uses actual spacing, signed values and missing-point rejection', () => {
  assert.equal(trapezoid([{ dMs: 10, difference: 0 }, { dMs: 12, difference: 1 }, { dMs: 20, difference: -0.5 }]), 3);
  assert.equal(trapezoid([{ dMs: 10, difference: null }, { dMs: 12, difference: 1 }]), null);
  const differences = [0, 0, 0.5, 1, 0.5, 0, 0];
  assert.equal(trapezoid(REDUCED.offsetsMs.map((dMs, i) => ({ dMs, difference: differences[i] }))), 6);
});

test('positive: synthetic nominal 6ms shift meets criteria, no shift fails, 12ms fails two-sided band', () => {
  const six = storeControlVerdict(syntheticControl(6), 'positive');
  assert.equal(six.summary.boundaryShiftMs, 6);
  assert.equal(six.controlCriteriaPassed, true); assert.equal(six.controlVerdict, 'descriptive only');
  assert.equal(six.controlAssessment, 'criteria met');
  const zero = storeControlVerdict(syntheticControl(0), 'positive');
  assert.equal(zero.controlCriteriaPassed, false);
  assert.ok(zero.controlFailures.some(c => c.name === 'sensitiveIntervalAboveZero'));
  const twelve = storeControlVerdict(syntheticControl(12), 'positive');
  assert.equal(twelve.summary.boundaryShiftMs, 11);
  assert.equal(twelve.controlCriteriaPassed, false);
  assert.ok(twelve.controlFailures.some(c => c.name === 'positiveIntegratedDifference'));
});

test('positive interval condition cannot be replaced by a positive point estimate, or moved away from c-4', () => {
  const result = syntheticControl(), sensitive = result.summary.boundary.find(r => r.dMs === result.config.sweepSelection.cMs - 4);
  sensitive.difference = 0.05; sensitive.differenceInterval = newcombe(0.5, 0.55, 24);
  assert.ok(sensitive.differenceInterval.lower < 0);
  assert.equal(reducedDecisionChecks(result, 'positive').find(c => c.name === 'sensitiveIntervalAboveZero').passed, false);
  const original = syntheticControl();
  const check = reducedDecisionChecks(original, 'positive').find(c => c.name === 'sensitiveIntervalAboveZero');
  assert.equal(check.values.dMs, original.config.sweepSelection.cMs - 4); assert.equal(check.passed, true);
  for (const [area, pass] of [[2.99, false], [3, true], [9, true], [9.01, false]]) {
    original.summary.boundaryShiftMs = area;
    assert.equal(reducedDecisionChecks(original, 'positive')[0].passed, pass);
  }
});

test('negative requires zero inside sensitive interval and signed area within tolerance', () => {
  const identical = storeControlVerdict(syntheticControl(0, 'negative'), 'negative');
  assert.equal(identical.controlCriteriaPassed, true); assert.equal(identical.controlVerdict, 'descriptive only');
  assert.equal(storeControlVerdict(syntheticControl(6, 'negative'), 'negative').controlCriteriaPassed, false);
  const c = syntheticControl(0, 'negative');
  for (const [shift, pass] of [[-2.01, false], [-2, true], [2, true], [2.01, false]]) {
    c.summary.boundaryShiftMs = shift; assert.equal(reducedDecisionChecks(c, 'negative')[0].passed, pass);
  }
  c.summary.boundaryShiftMs = 0;
  c.summary.boundary.find(r => r.dMs === c.config.sweepSelection.cMs - 4).differenceInterval = { lower: 0.001, upper: 0.1 };
  assert.equal(storeControlVerdict(c, 'negative').controlCriteriaPassed, false);
});

test('reduced retains full sample, balancing, endpoint, probe and delay guards', () => {
  for (const mutate of [r => r.status = 'incomplete', r => r.raw.pop(), r => r.summary.boundary.pop(),
    r => r.raw.find(p => p.phase === 'boundary' && p.order === 'BA').order = 'AB',
    r => r.summary.boundary[0].B.fraction = 0.126, r => r.summary.boundary.at(-1).A.fraction = 0.874,
    r => r.armDiagnostics[1].delayHitsByPhase.boundary = 23,
    r => r.armDiagnostics[0].probe.measurementStructureChecked = false]) {
    const result = syntheticControl(); mutate(result);
    assert.equal(storeControlVerdict(result, 'positive').controlCriteriaPassed, false);
  }
});

test('block bootstrap preserves paired arms and order strata, is deterministic, and rejects missing strata', () => {
  const result = syntheticControl(0, 'negative'), points = result.config.dwellPointsMs;
  // Strong between-arm correlation: preserving blocks gives identically zero differences.
  for (const p of result.raw.filter(p => p.phase === 'boundary')) p.A = p.B = unit(p.repetition % 2);
  const interval = bootstrapShift(result.raw, points);
  assert.equal(interval.lower, 0); assert.equal(interval.upper, 0); assert.equal(interval.degenerate, true);
  assert.equal(interval.replicates, 4000); assert.equal(interval.seed, 20261010);
  // AB delta=+1, BA=-1: stratification keeps exact cancellation in every resample.
  for (const p of result.raw.filter(p => p.phase === 'boundary')) { p.A = unit(p.order === 'BA' ? 1 : 0); p.B = unit(p.order === 'AB' ? 1 : 0); }
  assert.equal(bootstrapShift(result.raw, points).lower, 0);
  for (const p of result.raw.filter(p => p.phase === 'boundary')) p.B = unit(p.repetition % 3 ? 1 : 0);
  const varied = bootstrapShift(result.raw, points);
  assert.ok(varied.upper > varied.lower);
  assert.deepEqual(bootstrapShift(result.raw, points), varied);
  assert.equal(bootstrapShift(result.raw.filter(p => p.order !== 'BA'), points), null);
});

test('MDE uses process counts, correlation design effect and non-uniform integration weights', () => {
  const main = designMde(64), control = designMde(24), optimistic = designMde(64, 0);
  assert.equal(main.effectiveN, 64); assert.equal(optimistic.effectiveN, 256);
  near(main.fraction, 0.2476274882249591); near(control.fraction, 0.40437399495879967);
  near(main.conditionalShiftMs, 3.095343602811989); near(optimistic.conditionalShiftMs, 1.5476718014059945);
  assert.deepEqual(main.areaWeightsMs, [2, 3, 2, 3, 4, 6, 4]); near(main.sampledAreaMs, 2.4008375736214673);
  const result = syntheticControl(0, 'negative');
  for (const [lower, upper, inside] of [[-2, 2, true], [-2.01, 0, false], [0, 2.01, false]]) {
    result.summary.boundaryShiftIntervalMs = { lower, upper };
    assert.equal(reducedInference(result).intervalInsideMargin, inside);
  }
  // A degenerate bootstrap interval (all resampled areas identical) carries no information about the margin.
  result.summary.boundaryShiftIntervalMs = { lower: 0, upper: 0, degenerate: true };
  assert.equal(reducedInference(result).intervalInsideMargin, false);
  result.summary.boundaryShiftIntervalMs = { lower: 0, upper: 0, degenerate: false };
  assert.equal(reducedInference(result).intervalInsideMargin, true);
  result.status = 'incomplete'; result.summary.boundaryShiftIntervalMs = { lower: 0, upper: 0 };
  assert.equal(reducedInference(result).intervalInsideMargin, false);
  assert.match(renderReport(result), /a probe-induced shift smaller than MDE is not detectable/);
});

test('budget defaults and test timeouts include the declared cleanup/report margin', () => {
  assert.equal(budgetMinutes(undefined, true), 30); assert.equal(budgetMinutes(), 90);
  assert.equal(testTimeoutMs(), 1920000); assert.equal(testTimeoutMs(90, false), 5520000);
  assert.equal(testTimeoutMs(1.5), 210000);
});

test('partial JSONL is append-only and exclusive-create, including orphan-journal preflight', () => temporary(dir => {
  const prefix = join(dir, 'partial'), path = `${prefix}.partial.jsonl`;
  const journal = partialJournal(path); journal.append({ type: 'plan' });
  const initial = readFileSync(path, 'utf8'); journal.append({ type: 'pair', index: 0 });
  assert.ok(readFileSync(path, 'utf8').startsWith(initial));
  assert.throws(() => partialJournal(path), /EEXIST/); journal.close();
  assert.throws(() => partialJournal(path), /EEXIST/);
  assert.throws(() => assertFreshOutput(prefix, dir), /refuse to overwrite/);
  for (const name of ['positive', 'negative']) {
    const prefix = join(dir, name); writeFileSync(`${prefix}.${name}.partial.jsonl`, 'original');
    assert.throws(() => assertFreshOutput(prefix, dir), /refuse to overwrite/);
  }
}));

function fakeRuntime({ armCostMs = 1, calibrationElapsedMs = 0, hang = false, expireAfterFirstArm = false } = {}) {
  let clock = 0, calibrationClock = 0, launches = 0, closes = 0;
  const signals = [], commands = [];
  return { launches: () => launches, closes: () => closes, signals, commands,
    deps: { now: () => clock, readHost: () => metadata, readLoad: () => [0, 0, 0],
      pause: async ms => { clock += ms; },
      calibrationOptions: { requestedMs: [1], samplesPerLength: 1, now: () => calibrationClock,
        primitives: Object.fromEntries(['dwell', 'injectedReceiveDelay'].map(k => [k, d => { calibrationClock += d; clock += calibrationElapsedMs / 2; }])) },
      inspectArm: () => ({ measurementStructureChecked: true, expectedTimeouts: 1 }),
      ...(hang ? { setTimer: fn => setTimeout(() => { clock += 6000000; fn(); }, 0) } : {}),
      launchArm(arm) {
        launches++;
        let resolveExit;
        const exited = new Promise(resolve => { resolveExit = resolve; });
        const child = { exitCode: null, stdin: { end() { child.exitCode = 0; closes++; resolveExit({ code: 0 }); if (expireAfterFirstArm) clock += 6000000; } },
          kill(signal) { signals.push(signal); child.exitCode = 0; closes++; resolveExit({ code: 0 }); } };
        return { child, exited,
          receive: async () => hang ? new Promise(() => {}) : { ready: true, toolchain: probeToolchain(), stockTimeoutMs: 5000 },
          async request(command) {
            if (command.finish) return { finished: true, delayHits: arm.delayMs ? 4 : 0 };
            commands.push(command); clock += armCostMs;
            return unit(command.durationMs >= 40 ? 1 : 0, arm.delayMs ? 1 : 0);
          },
        };
      },
    } };
}
async function fakeRun(dir, sweepFrom, name, runtime, options = {}) {
  const prefix = join(dir, name), write = artifactWriter(prefix, renderReport);
  const result = await runExperiment({ protocol: 'reduced', sweepFrom, ...options }, () => {}, write, runtime.deps);
  const journal = readFileSync(`${prefix}.partial.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
  return { result, journal, prefix };
}

test('projection budget stop persists completed pair before INCONCLUSIVE; never partial PASS', () => temporary(async (dir, sweepFrom) => {
  const runtime = fakeRuntime({ armCostMs: 1000 });
  const { result, journal, prefix } = await fakeRun(dir, sweepFrom, 'budget-projection', runtime, { budgetMin: 20 });
  assert.equal(result.status, 'incomplete'); assert.equal(result.verdict, 'INCONCLUSIVE (budget)');
  assert.equal(result.failure.reason, 'projection'); assert.equal(result.raw.length, 1);
  assert.equal(runtime.launches(), 2); assert.equal(runtime.closes(), 2);
  assert.equal(journal[0].type, 'plan'); assert.match(journal[0].plan.config.sweepSelection.explorationSha256, /^[a-f0-9]{64}$/);
  const pairs = journal.filter(x => x.type === 'pair'); assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].sample, result.raw[0]); assert.ok(pairs[0].budget.projectedTotalMs > pairs[0].budget.limitMs);
  assert.equal(journal.at(-1).verdict, 'INCONCLUSIVE (budget)');
  assert.equal(JSON.parse(readFileSync(`${prefix}.json`)).status, 'incomplete');
  assert.match(readFileSync(`${prefix}.md`, 'utf8'), /INCONCLUSIVE \(budget\)/);
  const control = storeControlVerdict(result, 'positive');
  assert.equal(control.controlVerdict, 'INCONCLUSIVE (budget)'); assert.equal(control.controlCriteriaPassed, false);
}));

test('calibration consumes the elapsed budget and stops before any arm launch', () => temporary(async (dir, sweepFrom) => {
  const runtime = fakeRuntime({ calibrationElapsedMs: 60001 });
  const { result, journal } = await fakeRun(dir, sweepFrom, 'budget-calibration', runtime, { budgetMin: 1 });
  assert.equal(result.calibration.passed, true); assert.equal(result.status, 'incomplete');
  assert.equal(result.verdict, 'INCONCLUSIVE (budget)'); assert.equal(result.failure.reason, 'elapsed');
  assert.equal(runtime.launches(), 0); assert.equal(result.raw.length, 0);
  assert.equal(journal[1].type, 'calibration'); assert.ok(result.budget.elapsedMs > 60000);
}));

test('elapsed deadline while waiting for an arm closes it and writes incomplete failed unit', () => temporary(async (dir, sweepFrom) => {
  const runtime = fakeRuntime({ hang: true });
  const { result, journal } = await fakeRun(dir, sweepFrom, 'budget-hung-arm', runtime);
  assert.equal(result.status, 'incomplete'); assert.equal(result.verdict, 'INCONCLUSIVE (budget)');
  assert.equal(runtime.launches(), 1); assert.equal(runtime.closes(), 1); assert.deepEqual(runtime.signals, ['SIGTERM']);
  assert.equal(result.raw.length, 0); assert.equal(result.failedUnits.length, 1);
  assert.equal(journal.at(-1).failedUnits.length, 1); assert.equal(result.armStops[0].forced, false);
}));

test('expiry after first arm never launches second arm and preserves available partial data', () => temporary(async (dir, sweepFrom) => {
  const runtime = fakeRuntime({ expireAfterFirstArm: true });
  const { result } = await fakeRun(dir, sweepFrom, 'budget-between-arms', runtime);
  assert.equal(runtime.launches(), 1); assert.equal(result.status, 'incomplete');
  assert.equal(result.raw.length, 0); assert.equal(result.failedUnits[0].A.measuredDecideCount, 4);
}));

test('complete fake main has all declared counts, balanced orders, seeded shuffle, and a journal record per pair', () => temporary(async (dir, sweepFrom) => {
  const runtime = fakeRuntime();
  const { result, journal } = await fakeRun(dir, sweepFrom, 'complete-synthetic', runtime);
  assert.equal(result.status, 'complete'); assert.equal(result.raw.length, 474);
  assert.equal(runtime.launches(), 948); assert.equal(runtime.closes(), 948);
  assert.equal(journal.filter(x => x.type === 'pair').length, 474);
  assert.equal(result.raw.filter(p => p.phase === 'overhead').length, 24);
  assert.equal(result.raw.filter(p => p.phase === 'warmup').length, 2);
  for (const row of result.summary.boundary) {
    assert.equal(row.n, 256); assert.equal(row.blocks, 64);
    assert.equal(row.blockDiagnostics.byOrder.AB.blocks, 32); assert.equal(row.blockDiagnostics.byOrder.BA.blocks, 32);
    assert.ok(row.differenceInterval); assert.equal(row.difference, 0);
  }
  assert.equal(result.summary.overhead.decide.A.n, 96);
  assert.ok(runtime.commands.every(c => c.warmupDecides === 5 && c.measuredDecides === 4));
  const order = r => r.raw.filter(p => p.phase === 'boundary').map(p => p.durationMs);
  assert.notDeepEqual(order(result).slice(0, 7), result.config.dwellPointsMs);
  const second = await fakeRun(dir, sweepFrom, 'repeat-synthetic', fakeRuntime());
  assert.deepEqual(order(second.result), order(result));
  assert.equal(result.budget.completedPairs, 474);
  assert.ok(result.summary.boundaryShiftIntervalMs);
}));

test('budget projection includes cooldown, setup and boundary-cost update, but not multiplied calibration', () => {
  let clock = 100;
  const budget = createBudget({ budgetMin: 100, totalPairs: 10, cooldownMs: 1500 }, { now: () => clock, started: 0 });
  clock = 300; let state = budget.completedPair('warmup', 200);
  assert.equal(state.projectedTotalMs, 300 + 1500 + 9 * 1700);
  clock = 3800; state = budget.completedPair('boundary', 2000);
  assert.equal(state.projectedTotalMs, 3800 + 1500 + 8 * 3500);
  const limit = createBudget({ budgetMin: 1, totalPairs: 0, cooldownMs: 0 }, { now: () => clock, started: 0 });
  clock = 60000; assert.doesNotThrow(limit.check); clock++; assert.throws(limit.check, { code: 'TIMING_BUDGET_EXCEEDED' });
});

test('shutdown uses a bounded graceful close then records forced fallback for an unresponsive fake arm', async () => {
  const signals = []; let exit;
  const client = { child: { exitCode: null, kill(signal) { signals.push(signal); if (signal === 'SIGKILL') exit({ code: null, signal }); } }, exited: new Promise(resolve => exit = resolve) };
  const result = await stopTimingClient(client, { setTimer: fn => setTimeout(fn, 0) });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']); assert.equal(result.forced, true); assert.equal(result.graceMs, 5000);
});


test('a completed response crossing the budget is retained before the next operation is refused', async () => {
  let clock = 0, nextCalled = false;
  const budget = createBudget({ budgetMin: 1, totalPairs: 1, cooldownMs: 0 }, { now: () => clock });
  const received = await budget.wait(async () => { clock = 60001; return unit(); });
  assert.equal(received.measuredDecideCount, 4);
  await assert.rejects(budget.wait(() => { nextCalled = true; }), { code: 'TIMING_BUDGET_EXCEEDED' });
  assert.equal(nextCalled, false);
});

test('reduced main and both controls retain calibration aborts with both primitive records', () => temporary(async (dir, sweepFrom) => {
  for (const controlName of [undefined, 'positive', 'negative']) for (const bad of ['dwell', 'injectedReceiveDelay']) {
    const runtime = fakeRuntime(); let calibrationClock = 0;
    runtime.deps.calibrationOptions = { requestedMs: [1], samplesPerLength: 1, now: () => calibrationClock,
      primitives: Object.fromEntries(['dwell', 'injectedReceiveDelay'].map(name => [name, d => { calibrationClock += d + (name === bad ? 2 : 0); }])) };
    const { result, journal } = await fakeRun(dir, sweepFrom, `bad-${controlName ?? 'main'}-${bad}`, runtime, { controlName });
    assert.equal(result.status, 'aborted'); assert.equal(runtime.launches(), 0);
    assert.equal(result.failure.code, bad === 'dwell' ? 'TIMING_DWELL_INACCURATE' : 'TIMING_DELAY_INACCURATE');
    assert.equal(Object.keys(journal.find(r => r.type === 'calibration').calibration.primitives).length, 2);
  }
}));

test('reduced load refusal preserves notes and journal and cannot launch; existing journal also prevents launch', () => temporary(async (dir, sweepFrom) => {
  const prefix = join(dir, 'load-refused'), write = artifactWriter(prefix, renderReport), runtime = fakeRuntime();
  runtime.deps.readHost = () => ({ ...metadata, loadAverage: [4, 0, 0] });
  await assert.rejects(runExperiment({ protocol: 'reduced', sweepFrom, maxLoad1: 3, loadNote: 'synthetic guard check' }, () => {}, write, runtime.deps), error => {
    assert.equal(error.code, 'TIMING_LOAD_REFUSED'); assert.equal(error.plan.config.loadNote, 'synthetic guard check');
    return true;
  });
  assert.equal(runtime.launches(), 0);
  const saved = readFileSync(`${prefix}.partial.jsonl`, 'utf8');
  assert.equal(JSON.parse(saved.trim().split('\n').at(-1)).status, 'refused');
  await assert.rejects(runExperiment({ protocol: 'reduced', sweepFrom }, () => {}, write, runtime.deps), /EEXIST/);
  assert.equal(readFileSync(`${prefix}.partial.jsonl`, 'utf8'), saved); assert.equal(runtime.launches(), 0);
}));
