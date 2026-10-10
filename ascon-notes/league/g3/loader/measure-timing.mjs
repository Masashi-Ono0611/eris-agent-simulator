import assert from 'node:assert/strict';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { loadSweep, delayHitsByPhase, explorationQuality, MAX_TRANSITION_WIDTH_MS } from './timing-sweep.mjs';
import { auditRecords } from './audit-records.mjs';
import { probeToolchain, toolchainEnvironment } from './probe-toolchain.mjs';
import { DEFAULT_MAX_LOAD1, parseLoadOptions, parseTimingArgs, assertFreshOutput, parseProtocolOptions } from './timing-options.mjs';
import { CALIBRATION, calibrateTiming, assertTimingCalibration, renderCalibration } from './timing-calibration.mjs';

import { REDUCED, blockPoint, trapezoid, bootstrapShift, reducedInference } from './timing-reduced.mjs';
import { budgetMinutes, createBudget, partialJournal, stopTimingClient, BUDGET_VERDICT } from './timing-budget.mjs';

const directory = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const DEFAULTS = Object.freeze({ repetitions: 240, boundaryRepetitions: 20,
  timeoutMs: 100, minOffsetMs: -30, maxOffsetMs: 30, stepMs: 0.5,
  warmupPairs: 10, warmupDecides: 5, measuredDecides: 40, maxTransitionWidthMs: MAX_TRANSITION_WIDTH_MS, seed: 20261009, maxLoad1: DEFAULT_MAX_LOAD1, loadNote: '', cooldownMs: 1500,
  arms: [{ name: 'A-stock', probe: false, delayMs: 0 }, { name: 'B-probe', probe: true, delayMs: 0 }] });

export function assertLoad(load1, threshold) {
  if (!Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(load1) || load1 > threshold) {
    throw Object.assign(Error('TIMING_LOAD_REFUSED'), { code: 'TIMING_LOAD_REFUSED', load1, threshold });
  }
}
export function distribution(values) {
  if (!values.length) return { n: 0, median: null, p95: null, p99: null, max: null };
  assert.ok(values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = p => {
    const position = (sorted.length - 1) * p, lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  };
  return { n: sorted.length, median: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), max: sorted.at(-1) };
}
// A raw row pairs two arm PROCESSES; only records in `decides` are measured.
// Legacy single-decision rows remain readable for archived synthetic fixtures.
export function measuredRecords(unit) {
  return unit.decides ?? [unit];
}
// Predeclared descriptive warning; it does not change control thresholds.
export const REWARM_IMBALANCE = Object.freeze({ minDifference: 2, minRelativeDifference: 0.1 });
export function rewarmAccounting(raw) {
  const arms = Object.fromEntries(['A', 'B'].map(arm => {
    const units = raw.map(p => p[arm]).filter(Boolean);
    const known = units.every(u => Number.isSafeInteger(u.rewarmCount));
    return [arm, { processes: units.length,
      rewarmCount: known ? units.reduce((n, u) => n + u.rewarmCount, 0) : null,
      discardedDecideCount: known ? units.reduce((n, u) => n + u.discardedDecideCount, 0) : null,
      measuredDecideCount: units.reduce((n, u) => n + measuredRecords(u).length, 0) }];
  }));
  const A = arms.A.rewarmCount, B = arms.B.rewarmCount;
  const difference = A === null || B === null ? null : Math.abs(B - A);
  const relativeDifference = difference === null ? null : difference / Math.max(A, B, 1);
  const material = difference !== null && difference >= REWARM_IMBALANCE.minDifference &&
    relativeDifference >= REWARM_IMBALANCE.minRelativeDifference;
  return { ...arms, threshold: REWARM_IMBALANCE, difference, relativeDifference,
    warning: material ? 'Re-warm imbalance between arms can bias timeout fractions.' : null };
}
export function summarize(raw, config) {
  const overhead = {};
  const pairs = raw.filter(r => r.phase === 'overhead');
  for (const method of ['setSource', 'start', 'startReady', 'decide', 'close']) {
    const values = arm => pairs.flatMap(p => method === 'decide'
      ? measuredRecords(p[arm]).map(d => d.wallMs ?? d.durations?.decide)
      : [p[arm].durations[method]]);
    const A = values('A'), B = values('B');
    overhead[method] = { A: distribution(A), B: distribution(B),
      pairedDelta: distribution(B.map((v, i) => v - A[i])) };
  }
  const boundary = [];
  const phase = config.explore ? 'exploration' : 'boundary';
  for (const dMs of dwellPoints(config)) {
    const offset = dMs - config.timeoutMs;
    const pairs = raw.filter(p => p.phase === phase && (p.durationMs === dMs || (p.durationMs === undefined && p.offsetMs === offset)));
    const records = Object.fromEntries(['A', 'B'].map(arm => [arm, pairs.flatMap(p => measuredRecords(p[arm]))]));
    assert.equal(records.A.length, records.B.length, 'equal measured decide counts per arm');
    const row = { dMs, offsetMs: offset, processesPerArm: pairs.length, n: records.A.length, rewarm: rewarmAccounting(pairs) };
    for (const arm of ['A', 'B']) {
      const ds = records[arm], timeouts = ds.filter(d => d.timedOut).length;
      row[arm] = { timeouts, fraction: ds.length ? timeouts / ds.length : null,
        decideWallMs: distribution(ds.map(d => d.wallMs ?? d.durations?.decide).filter(v => v !== undefined)),
        successfulFixtureMs: distribution(ds.filter(d => !d.timedOut).map(d => d.fixtureElapsedMs)) };
    }
    row.difference = row.n ? row.B.fraction - row.A.fraction : null;
    row.discordant = { onlyA: records.A.filter((d, i) => d.timedOut && !records.B[i].timedOut).length,
      onlyB: records.B.filter((d, i) => d.timedOut && !records.A[i].timedOut).length };
    if (config.protocol === 'reduced') Object.assign(row, blockPoint(pairs));
    boundary.push(row);
  }
  // Signed area: positive means B times out sooner. No monotonicity fit or extrapolation.
  const boundaryShiftMs = boundary.every(r => r.n > 0)
    ? (config.protocol === 'reduced' ? trapezoid(boundary) : config.stepMs * boundary.reduce((sum, r) => sum + r.difference, 0)) : null;
  const fixedCostEstimateMs = Object.fromEntries(['A', 'B'].map(arm => [arm,
    distribution(raw.filter(p => p.phase === phase && p.durationMs === 0 || p.phase === 'overhead')
      .flatMap(p => measuredRecords(p[arm])).map(d => d.wallMs ?? d.durations?.decide).filter(v => v !== undefined)).median]));
  const rewarm = rewarmAccounting(raw);
  return config.explore ? { rewarm, overhead, exploration: boundary, boundary: [], boundaryShiftMs: null,
    fixedCostEstimateMs, explorationQuality: explorationQuality(boundary, config.maxTransitionWidthMs) }
    : { rewarm, overhead, boundary, boundaryShiftMs, fixedCostEstimateMs,
      ...(config.protocol === 'reduced' ? { boundaryShiftIntervalMs: bootstrapShift(raw, dwellPoints(config)) } : {}) };
}

export function host(env = process.env) {
  return { ...probeToolchain(env),
    platform: os.platform(), release: os.release(), arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length, loadAverage: os.loadavg() };
}
function shuffled(values, random) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(1664525, value) + 1013904223) >>> 0; return value / 2 ** 32; };
}

export function launch(arm, sink) {
  const url = name => new URL(name, import.meta.url).href;
  const args = ['--import', 'tsx', '--import', url('offline-guard.mjs'), '--import', url('timing-delay.mjs')];
  if (arm.probe) args.push('--import', url('probe-loader.mjs'));
  args.push(fileURLToPath(new URL('timing-arm.mjs', import.meta.url)));
  const child = spawn(process.execPath, args, { cwd: root, env: {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    ...toolchainEnvironment(),
    G3_PROBE_JSONL: sink, G3_TIMING_PROBE: arm.probe ? '1' : '0', G3_TIMING_DELAY_MS: String(arm.delayMs),
  }, stdio: ['pipe', 'pipe', 'pipe'] });
  const queue = [];
  let waiter, failure, stderr = '';
  const fail = error => { failure = error; waiter?.reject(error); waiter = undefined; };
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-12000); });
  child.stdin.on('error', fail);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const value = JSON.parse(line);
      if (waiter) { const current = waiter; waiter = undefined; current.resolve(value); }
      else queue.push(value);
    } catch { fail(Error('TIMING_INVALID_CHILD_JSON')); }
  });
  child.on('error', fail);
  const exited = new Promise(resolveExit => child.on('exit', (code, signal) => {
    if (code !== 0 || signal) fail(Error(`TIMING_CHILD_EXIT:${code}:${signal}:${stderr}`));
    else if (waiter) fail(Error('TIMING_EARLY_CHILD_EXIT'));
    resolveExit({ code, signal });
  }));
  const receive = () => {
    if (failure) return Promise.reject(failure);
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolveValue, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(Error('TIMING_CHILD_WATCHDOG')); }, 1800000);
      waiter = { resolve: value => { clearTimeout(timer); resolveValue(value); },
        reject: error => { clearTimeout(timer); reject(error); } };
    });
  };
  return { child, exited, receive, args,
    async request(command) { const result = receive(); child.stdin.write(`${JSON.stringify(command)}\n`); return result; } };
}

// Validate all generations/calls even when the old auditor stops at its known timeout gap.
export function inspectProbe(sink, unit) {
  const decisions = [...unit.warmup, ...unit.decides].sort((a, b) => a.round - b.round);
  const expectedCalls = decisions.length;
  const expectedTimeouts = decisions.filter(d => d.timedOut).length;
  const expectedGenerations = 1 + expectedTimeouts - Number(decisions.at(-1)?.timedOut ?? false);
  const records = readFileSync(sink, 'utf8').trim().split('\n').map(JSON.parse).sort((a, b) => a.seq - b.seq);
  assert.ok(records.every((r, i) => r.seq === i + 1));
  assert.equal(records.filter(r => r.event === 'probe_registered').length, 1);
  assert.equal(records.filter(r => r.event === 'probe_complete').length, 1);
  assert.equal(records.at(-1).event, 'probe_complete');
  assert.ok(!records.some(r => r.event === 'guard' || r.event === 'worker_error' || r.event === 'worker_submit'));
  const generations = new Map(), calls = new Map(), posts = new Map(), exits = new Map();
  for (const record of records) {
    if (record.generation !== undefined) {
      const own = generations.get(record.generation) ?? [];
      own.push(record); generations.set(record.generation, own);
    }
    if (/^(setSource|start|decide|close)_enter$/.test(record.event)) {
      assert.ok(!calls.has(record.callId)); calls.set(record.callId, record);
    }
    if (/^(setSource|start|decide|close)_exit$/.test(record.event)) {
      const enter = calls.get(record.callId);
      assert.ok(enter && enter.event.replace('_enter', '_exit') === record.event && enter.seq < record.seq);
      calls.delete(record.callId);
      if (record.event === 'decide_exit') exits.set(record.decisionId, record);
    }
    if (record.event === 'worker_post') {
      assert.ok(!posts.has(record.decisionId)); posts.set(record.decisionId, record);
    }
  }
  assert.equal(calls.size, 0);
  assert.equal(exits.size, expectedCalls);
  assert.equal(posts.size, expectedCalls);
  assert.equal(records.at(-1).calls, expectedCalls * 2 + 4); // setSource, 2 explicit starts, start+decide per call, close
  assert.equal(records.at(-1).decisions, expectedCalls);
  assert.equal([...exits.values()].filter(r => r.outcome === 'throw').length, expectedTimeouts);
  assert.equal(generations.size, expectedGenerations);
  assert.equal(records.at(-1).generations, expectedGenerations);
  let terminalGaps = 0;
  assert.equal(records.filter(r => r.event === 'runner_seen').length, 1);
  for (const own of generations.values()) {
    for (const event of ['worker_create', 'worker_attach', 'worker_exit', 'worker_ready']) {
      assert.equal(own.filter(r => r.event === event).length, 1, event);
    }
    const ownPosts = own.filter(r => r.event === 'worker_post');
    assert.ok(ownPosts.length > 0);
    for (const post of ownPosts) {
      const results = own.filter(r => r.event === 'worker_result' && r.decisionId === post.decisionId);
      assert.ok(results.length <= 1);
      if (!results.length) {
        assert.equal(exits.get(post.decisionId).outcome, 'throw'); terminalGaps++;
      } else assert.equal(results[0].workerDecisionId, post.workerDecisionId);
    }
  }
  let originalAudit;
  try { auditRecords(records); originalAudit = 'passed'; }
  catch (error) {
    assert.equal(error.code, 'G3_TERMINAL_GAP'); assert.ok(terminalGaps > 0);
    originalAudit = error.code;
  }
  return { records: records.length, generations: generations.size, terminalGaps, originalAudit,
    measurementStructureChecked: true, expectedTimeouts, registration: records[0] };
}

export function dwellPoints(config) {
  return config.dwellPointsMs ?? Array.from({ length: Math.round((config.maxOffsetMs - config.minOffsetMs) / config.stepMs) + 1 },
    (_, i) => config.timeoutMs + config.minOffsetMs + i * config.stepMs);
}

export function prepareTimingConfig(options = {}, env = process.env) {
  const selected = parseProtocolOptions(options.protocol ?? env.G3_TIMING_PROTOCOL, options.budgetMin ?? env.G3_TIMING_BUDGET_MIN);
  const config = { ...DEFAULTS, ...options, ...selected, ...parseLoadOptions(options.maxLoad1, options.loadNote) };
  const control = config.controlName;
  assert.ok(control === undefined || ['positive', 'negative'].includes(control), 'unknown control');
  config.budgetMin = budgetMinutes(config.budgetMin, Boolean(control));
  config.testTimeoutMarginMs = REDUCED.testTimeoutMarginMs;
  config.shutdownGraceMs = REDUCED.shutdownGraceMs;
  if (config.protocol === 'reduced') {
    assert.ok(!config.explore, 'reduced is confirmation-only; use legacy exploration');
    const fixed = { repetitions: control ? REDUCED.controlOverheadPairs : REDUCED.mainOverheadPairs,
      boundaryRepetitions: control ? REDUCED.controlPairs : REDUCED.mainPairs,
      warmupPairs: REDUCED.warmupPairs, warmupDecides: REDUCED.warmupDecides, measuredDecides: REDUCED.measuredDecides,
      cooldownMs: REDUCED.cooldownMs, seed: control ? REDUCED[`${control}Seed`] : REDUCED.mainSeed };
    for (const [key, value] of Object.entries(fixed)) assert.ok(options[key] === undefined || options[key] === value, `reduced fixes ${key}=${value}`);
    Object.assign(config, fixed, { protocolConstants: REDUCED });
    const expectedArms = control ? [{ name: 'probe-A', probe: true, delayMs: 0 },
      { name: 'probe-B', probe: true, delayMs: control === 'positive' ? REDUCED.nominalDelayMs : 0 }] : DEFAULTS.arms;
    if (options.arms) assert.deepEqual(options.arms.map(({ probe, delayMs }) => ({ probe, delayMs })),
      expectedArms.map(({ probe, delayMs }) => ({ probe, delayMs })), 'reduced arm configuration');
    config.arms = options.arms ?? expectedArms;
  }
  const sweepFrom = options.sweepFrom ?? env.G3_TIMING_SWEEP_FROM;
  if (config.explore) {
    assert.ok(!sweepFrom, '--explore and --sweep-from are exclusive');
    Object.assign(config, { repetitions: 0, boundaryRepetitions: 4, warmupPairs: 2,
      minOffsetMs: -config.timeoutMs, maxOffsetMs: Math.ceil((config.timeoutMs + 10) / 5) * 5 - config.timeoutMs,
      stepMs: 5, arms: [{ name: 'explore-A', probe: true, delayMs: 0 }, { name: 'explore-B', probe: true, delayMs: 0 }] });
    delete config.dwellPointsMs;
    delete config.sweepSelection;
  } else {
    assert.ok(sweepFrom, 'confirmation requires --sweep-from or G3_TIMING_SWEEP_FROM');
    const selection = loadSweep(sweepFrom, config.protocol);
    assert.ok(options.timeoutMs === undefined || options.timeoutMs === selection.timeoutMs, 'exploration T mismatch');
    Object.assign(config, { sweepFrom, sweepSelection: selection, timeoutMs: selection.timeoutMs,
      minOffsetMs: selection.minDwellMs - selection.timeoutMs, maxOffsetMs: selection.maxDwellMs - selection.timeoutMs,
      stepMs: selection.stepMs, dwellPointsMs: selection.dwellPointsMs });
  }
  return config;
}

// Reserve both artifacts before workers can start, then update only these owned
// files. A killed process leaves the predeclared plan; archived files remain wx protected.
export function artifactWriter(prefix, render) {
  let reserved = false;
  const write = value => {
    const json = `${JSON.stringify(value, null, 2)}\n`, markdown = render(value);
    writeFileSync(`${prefix}.json`, json, { flag: reserved ? 'w' : 'wx' });
    writeFileSync(`${prefix}.md`, markdown, { flag: reserved ? 'w' : 'wx' });
    reserved = true;
  };
  write.partialPath = `${prefix}.partial.jsonl`;
  return write;
}

export async function runExperiment(options = {}, progress = () => {}, persistPlan = () => {},
  { calibrationOptions, readHost = host, readLoad = () => os.loadavg(), launchArm = launch, inspectArm = inspectProbe,
    now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms)) } = {}) {
  const started = now();
  const config = prepareTimingConfig(options);
  for (const key of ['repetitions', 'boundaryRepetitions', 'warmupPairs', 'warmupDecides', 'measuredDecides']) {
    assert.ok(Number.isSafeInteger(config[key]) && config[key] >= 0, key);
  }
  assert.ok(config.warmupDecides > 0 && config.measuredDecides > 0);
  assert.ok(config.boundaryRepetitions > 0 && (config.protocol === 'reduced' || config.stepMs > 0) && config.minOffsetMs < config.maxOffsetMs);
  assert.ok(config.timeoutMs + config.minOffsetMs >= 0 && config.timeoutMs > 0);
  if (config.protocol !== 'reduced') assert.ok(Math.abs((config.maxOffsetMs - config.minOffsetMs) / config.stepMs - Math.round((config.maxOffsetMs - config.minOffsetMs) / config.stepMs)) < 1e-9);
  assert.equal(config.arms.length, 2);
  assert.ok(Number.isFinite(config.cooldownMs) && config.cooldownMs >= 0);
  const totalPairs = config.warmupPairs + config.repetitions + dwellPoints(config).length * config.boundaryRepetitions;
  const budget = createBudget({ ...config, totalPairs }, { now, started, setTimer, clearTimer });
  const journalPath = options.partialPath ?? persistPlan.partialPath;
  assert.ok(config.protocol !== 'reduced' || journalPath, 'reduced requires an exclusive partial journal next to the output');
  const journal = journalPath ? partialJournal(journalPath) : null;
  try {
    const before = readHost();
    const plan = { schema: 3, mode: config.explore ? 'exploration' : 'confirmation', status: 'planned',
      plannedAt: new Date().toISOString(), config, hostBefore: before, hostAfter: before, raw: [],
      calibration: { status: 'not-run', ...CALIBRATION }, budget: budget.snapshot(), partialPath: journalPath ?? null, summary: summarize([], config) };
    journal?.append({ type: 'plan', plan });
    await persistPlan(plan); // Durable JSON + Markdown BEFORE load check or launch.
    try { assertLoad(before.loadAverage[0], config.maxLoad1); } // BEFORE spawning any process
    catch (error) {
      journal?.append({ type: 'final', status: 'refused', failure: { code: error.code, load1: error.load1, threshold: error.threshold }, budget: budget.snapshot() });
      error.hostBefore = before; error.plan = plan; throw error;
    }
    const scratch = mkdtempSync(join(directory, '.timing-run-'));
    const clients = [];
    const raw = [], loadChecks = [];
    const result = { ...plan, status: 'running', startedAt: new Date().toISOString(), config,
      hostBefore: before, armToolchains: [], armDiagnostics: [], failedUnits: [], sourceHashes: {}, raw, loadChecks };
    for (const name of ['measure-timing.mjs', 'timing-options.mjs', 'timing-sweep.mjs', 'timing-arm.mjs', 'timing-unit.mjs', 'timing-delay.mjs', 'timing-fixture.mjs', 'timing-wait.mjs', 'timing-calibration.mjs', 'timing-reduced.mjs', 'timing-budget.mjs', 'TIMING-REDUCED-PROTOCOL-2026-10-10.md',
      'probe-loader.mjs', 'probe-toolchain.mjs', 'probe-io.mjs', 'audit-records.mjs', 'offline-guard.mjs',
      '../../../../example/agents/runtime/strategyRunner.ts', '../../../../example/agents/runtime/decideTimeout.ts']) {
      result.sourceHashes[name] = createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex');
    }
    const random = randomGenerator(config.seed);
    let index = 0;
    const pair = async (phase, repetition, durationMs) => {
      budget.check();
      const pairStarted = now();
      const isSweep = phase === 'boundary' || phase === 'exploration';
      const offsetMs = isSweep ? durationMs - config.timeoutMs : 0;
      const load = readLoad();
      loadChecks.push({ pair: index, load });
      assertLoad(load[0], config.maxLoad1);
      const parity = isSweep ? repetition % 2 : index % 2;
      const order = parity === 0 ? ['A', 'B'] : ['B', 'A'];
      const sample = { index: index++, phase, repetition, offsetMs, order: order.join(''),
        durationMs: isSweep ? durationMs : 0 };
      result.failedUnits.push(sample); // Retain even if the load check before B fails.
      for (const arm of order) {
        // Fresh parent process for each unit; only this process owns its one runner.
        // Check again before B: A may have spent substantial time re-warming.
        budget.check();
        const armLoad = readLoad();
        loadChecks.push({ pair: sample.index, arm, load: armLoad });
        assertLoad(armLoad[0], config.maxLoad1);
        const i = arm === 'A' ? 0 : 1;
        const sink = join(scratch, `${sample.index}-${arm}.jsonl`);
        const client = launchArm(config.arms[i], sink);
        clients.push(client);
        try {
          const ready = await budget.wait(() => client.receive());
          assert.equal(ready.ready, true);
          assert.deepEqual(ready.toolchain, probeToolchain());
          if (!result.armToolchains.some(t => t.arm === arm)) result.armToolchains.push({ arm, ...ready.toolchain });
          result.stockDefaultTimeoutMs = ready.stockTimeoutMs;
          sample[arm] = await budget.wait(() => client.request({ durationMs: sample.durationMs,
            timeoutMs: isSweep ? config.timeoutMs : 1000,
            warmupDecides: config.warmupDecides, measuredDecides: config.measuredDecides }));
          const finished = await budget.wait(() => client.request({ finish: true }));
          assert.equal(finished.finished, true);
          client.child.stdin.end();
          assert.equal((await budget.wait(() => client.exited)).code, 0);
          assert.equal(sample[arm].delayHits, finished.delayHits);
          if (config.arms[i].delayMs === 0) assert.equal(finished.delayHits, 0);
          sample[arm].probe = config.arms[i].probe ? inspectArm(sink, sample[arm]) : null;
          if (sample[arm].status !== 'complete') throw Error(sample[arm].failure?.code ?? 'TIMING_UNIT_ABORTED');
          assert.equal(sample[arm].measuredDecideCount, config.measuredDecides);
          if (!isSweep) assert.ok(sample[arm].decides.every(d => !d.timedOut));
        } finally {
          const stopped = await stopTimingClient(client, { setTimer, clearTimer });
          if (!stopped.alreadyExited) (result.armStops ??= []).push({ pair: sample.index, arm, ...stopped });
          clients.splice(clients.indexOf(client), 1);
        }
      }
      raw.push(sample);
      result.failedUnits.pop();
      result.budget = budget.completedPair(phase, now() - pairStarted);
      journal?.append({ type: 'pair', sample, budget: result.budget });
      budget.check();
      if (index % 25 === 0) progress({ pairs: index, phase, load1: load[0], budget: result.budget });
      // Outside all measured intervals, between complete pairs only.
      if (config.cooldownMs) await budget.wait(() => pause(config.cooldownMs));
    };
    try {
      budget.check();
      result.calibration = await calibrateTiming(calibrationOptions);
      result.budget = budget.snapshot();
      journal?.append({ type: 'calibration', calibration: result.calibration, sourceHashes: result.sourceHashes, budget: result.budget });
      await persistPlan(result); // Keep BOTH primitives' samples even when the gate aborts.
      assertTimingCalibration(result.calibration);
      budget.check();
      for (let i = 0; i < config.warmupPairs; i++) await pair('warmup', i, 0);
      for (let i = 0; i < config.repetitions; i++) await pair('overhead', i, 0);
      const points = dwellPoints(config);
      for (let repetition = 0; repetition < config.boundaryRepetitions; repetition++) {
        // A new seeded shuffle each repetition; every d alternates AB/BA across repetitions.
        for (const d of shuffled(points, random)) await pair(config.explore ? 'exploration' : 'boundary', repetition, d);
      }
      result.armDiagnostics = ['A', 'B'].map(arm => ({ arm,
        delayHits: raw.reduce((sum, p) => sum + p[arm].delayHits, 0),
        delayHitsByPhase: delayHitsByPhase(raw, arm),
        probe: config.arms[arm === 'A' ? 0 : 1].probe ? {
          measurementStructureChecked: raw.every(p => p[arm].probe?.measurementStructureChecked),
          expectedTimeouts: raw.reduce((sum, p) => sum + p[arm].probe.expectedTimeouts, 0),
        } : null,
      }));
      result.status = 'complete';
    } catch (error) {
      result.status = error.code === 'TIMING_BUDGET_EXCEEDED' ? 'incomplete' : 'aborted';
      if (result.status === 'incomplete') result.verdict = BUDGET_VERDICT;
      result.failure = { code: error.code ?? error.message, name: error.name, message: error.message,
        actual: error.actual, expected: error.expected, operator: error.operator,
        load1: error.load1, threshold: error.threshold,
        primitive: error.primitive, requestedMs: error.requestedMs, reason: error.reason, budget: error.budget };
    } finally {
      for (const client of clients) {
        const stopped = await stopTimingClient(client, { setTimer, clearTimer });
        if (!stopped.alreadyExited) (result.armStops ??= []).push(stopped);
      }
      rmSync(scratch, { recursive: true, force: true });
      result.hostAfter = readHost();
      result.finishedAt = new Date().toISOString();
      result.summary = summarize(raw, config);
      if (config.explore && result.status === 'complete' && result.summary.explorationQuality.rejected) {
        result.status = 'rejected';
        result.failure = { code: 'TIMING_EXPLORATION_TOO_BLURRED', message: result.summary.explorationQuality.reason };
      }
      result.delayHitsByPhase = Object.fromEntries(['A', 'B'].map(arm => [arm, delayHitsByPhase(raw, arm)]));
      result.maxObservedLoad1 = Math.max(before.loadAverage[0], result.hostAfter.loadAverage[0], ...loadChecks.map(c => c.load[0]));
      if (result.hostAfter.loadAverage[0] > config.maxLoad1 && result.status === 'complete') {
        result.status = 'aborted'; result.failure = { code: 'TIMING_LOAD_REFUSED_AFTER' };
      }
    }
    result.budget = budget.snapshot();
    if (result.status === 'complete') {
      try { budget.check(); } catch (error) {
        result.status = 'incomplete'; result.verdict = BUDGET_VERDICT;
        result.failure = { code: error.code, reason: error.reason, budget: error.budget };
      }
    }
    if (config.protocol === 'reduced') result.inference = reducedInference(result);
    journal?.append({ type: 'final', status: result.status, verdict: result.verdict ?? null, failure: result.failure ?? null,
      budget: result.budget, summary: result.summary, failedUnits: result.failedUnits, armStops: result.armStops ?? [] });
    await persistPlan(result);
    return result;
  } finally { journal?.close(); }
}

// Pure rendering: only the supplied run's metadata; no archived values or hostname lookup.
const markdownText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/[\r\n]+/g, ' ');
export function renderHostAndLoad(result) {
  const { config, hostBefore: before } = result;
  const identity = `${before.platform} ${before.release} / ${before.arch} / ${before.cpuModel} / ${before.logicalCpus} logical CPUs`;
  return [
    `Host (hostname-free): ${markdownText(identity)}. These results belong only to this run on this host; no Air measurements are reused.`,
    `Node / tsx (actual host runtime): ${markdownText(before.node)} / ${markdownText(before.tsx)}. toolchainOverride:${before.toolchainOverride ?? false}.`,
    ...(before.toolchainNote ? [markdownText(before.toolchainNote)] : []),
    `Budget: ${config.budgetMin ?? 'legacy/unrecorded'} minutes; test cleanup/report margin: ${config.testTimeoutMarginMs ?? 'unrecorded'} ms. Budget state: ${JSON.stringify(result.budget ?? null)}.`,
    `Operative max-load1: **${config.maxLoad1}** (default: ${DEFAULT_MAX_LOAD1}).`,
    `Load note: ${markdownText(config.loadNote || '(none; default unchanged)')}.`,
    config.maxLoad1 !== DEFAULT_MAX_LOAD1
      ? `This threshold was changed from default ${DEFAULT_MAX_LOAD1} to ${config.maxLoad1} for host ${markdownText(identity)} because: ${markdownText(config.loadNote)}.`
      : 'The load threshold is unchanged from default.',
    config.maxLoad1 > DEFAULT_MAX_LOAD1
      ? 'The relaxed threshold weakens the "idle-load" claim; this run is not evidence of meeting the default 2.5 threshold.'
      : 'Load average does not prove an idle host; a relaxed threshold would weaken the "idle-load" claim.',
  ].join('\n\n');
}

export function refusalResult(error, options) {
  return { schema: 1, status: 'refused', finishedAt: new Date().toISOString(),
    mode: error.plan?.mode, config: error.plan?.config ?? { ...DEFAULTS, ...options, ...parseLoadOptions(options.maxLoad1, options.loadNote) },
    hostBefore: error.hostBefore, hostAfter: host(), raw: [], budget: error.plan?.budget, partialPath: error.plan?.partialPath, calibration: error.plan?.calibration,
    failure: { code: error.code, load1: error.load1, threshold: error.threshold } };
}

export function renderControlReport(controls) {
  if (Object.values(controls).some(r => r.config.protocol === 'reduced')) {
    return Object.entries(controls).map(([name, r]) => r.config.protocol === 'reduced'
      ? renderReducedReport(r, name) : renderControlReport({ [name]: r })).join('\n');
  }
  const lines = ['# 時間干渉ハーネスの対照実験', '',
    'loader-timing.test.mjs がこの実行のJSONから生成。production probeのoverheadの推定ではない。', '',
    '事前閾値: positiveの積分差3〜9ms、c−4msでtimeout割合増加≥0.5。negativeの積分差の絶対値≤2ms。',
    '両armはstock StrategyRunner + production probe。positiveのBのみ測定専用listenerで6ms追加。negativeは同一設定。', ''];
  for (const [name, result] of Object.entries(controls)) {
    lines.push(`## ${name}`, '', renderHostAndLoad(result), renderCalibration(result), renderSweepPlan(result), renderRewarm(result), '',
      `状態: ${result.status} / ${result.controlVerdict}。`,
      ...(result.failure ? [`失敗: ${JSON.stringify(result.failure)}`] : []),
      `失敗assertions: ${JSON.stringify(result.controlFailures ?? [])}`,
      `phase別delayHits: ${JSON.stringify(result.delayHitsByPhase ?? {})}`,
      `開始load: ${result.hostBefore.loadAverage.join(' / ')}。終了load: ${result.hostAfter.loadAverage.join(' / ')}。最大load1: ${result.maxObservedLoad1 ?? '未測定'}。`,
      `T: ${result.config.timeoutMs}ms。各点の予定n: ${result.config.boundaryRepetitions * result.config.measuredDecides} measured decides。積分差: ${result.summary?.boundaryShiftMs ?? '未測定'}ms。`,
      `delay発火 A/B: ${(result.armDiagnostics ?? []).map(a => a.delayHits).join('/') || '未検査'}。`, '',
      '| d ms | n/arm | A timeout | B timeout | B−A割合 |', '| ---: | ---: | ---: | ---: | ---: |');
    for (const row of result.summary?.boundary ?? []) lines.push(`| ${row.dMs} | ${row.n} | ${row.A.timeouts} | ${row.B.timeouts} | ${row.difference} |`);
    lines.push('');
  }
  lines.push('単一ホストの指定負荷閾値内での有限サンプル。noise閾値の通過は一般的な等価性を意味しない。G3 evidenceではない。', '');
  return lines.join('\n');
}

const f = value => value === null ? '—' : value.toFixed(6);
export function renderReport(result) {
  if (result.config.protocol === 'reduced') return renderReducedReport(result);
  if (result.mode === 'exploration') return renderExploration(result);
  const { config, summary } = result;
  const lines = ['# StrategyRunner プローブ時間干渉のオフライン計測', '',
    '**G3 evidence ではない。G3 PASS、動作等価性、botMain の観測を主張しない。**', '',
    `実行状態: **${result.status}**。開始 ${result.startedAt}、終了 ${result.finishedAt}。`,
    ...(result.failure ? [`失敗: \`${JSON.stringify(result.failure)}\`。完了した実測として扱わない。`] : []), '',
    'この Markdown は measure-timing.mjs が同じ JSON の数値から生成したもの。手入力の測定値はない。', '',
    renderHostAndLoad(result), renderCalibration(result), renderSweepPlan(result), renderRewarm(result), '',
    '| ホスト・条件 | 実測・設定 |', '| --- | --- |',
    `| Node / tsx | ${result.hostBefore.node} / ${result.hostBefore.tsx} |`,
    `| CPU / 論理CPU | ${result.hostBefore.cpuModel} / ${result.hostBefore.logicalCpus} |`,
    `| OS | ${result.hostBefore.platform} ${result.hostBefore.release} ${result.hostBefore.arch} |`,
    `| load average 開始 (1/5/15分) | ${result.hostBefore.loadAverage.join(' / ')} |`,
    `| load average 終了 (1/5/15分) | ${result.hostAfter.loadAverage.join(' / ')} |`,
    `| 許容1分load / 観測最大 | ${config.maxLoad1} / ${result.maxObservedLoad1} |`,
    `| pair間の休止（計測区間外） | ${config.cooldownMs}ms |`,
    `| A / B | ${config.arms.map(a => `${a.name} (probe=${a.probe}, delay=${a.delayMs}ms)`).join(' / ')} |`,
    `| 反復 | overhead 各 ${config.repetitions}、境界各点・各arm ${config.boundaryRepetitions}、除外warmup 各 ${config.warmupPairs} |`,
    `| 期限 T / stock既定 | ${config.timeoutMs}ms / ${result.stockDefaultTimeoutMs}ms |`,
    `| sweep / seed | T${config.minOffsetMs}〜T+${config.maxOffsetMs}ms、${config.stepMs}ms刻み / ${config.seed} |`, '',
    '負荷閾値は事前固定。開始前・各pair前・終了後に検査し、超過なら拒否または中断する。',
    'この条件を低負荷（idle-load）条件の操作的定義とするが、load average は完全なアイドル状態を証明しない。', '',
    '## 方法', '',
    '各pairのarmごとに独立した Node 親プロセスを起動して逐次駆動し、overhead は AB/BA を交互に実行。境界は各点で反復ごとに AB/BA を交互にし、各反復の点順序を固定seedでshuffleする。並列実行しない。',
    '各arm processは1つのstock StrategyRunnerを保持し、Workerを再利用する。timeout時はstockがWorkerを終了し、次の計測前に同じRunnerで replacement WorkerをW回再warm-upする。setSourceは新descriptorの同期呼出（probeの初回runner_seenを含む）、startはcold Worker起動、startReadyは同Workerのready後の再呼出。decideはW回warm-up後の各呼出を測り、closeはN回計測後の終了を測る。warm-upはd=0でtimeout設定は計測と同じ。',
    'overhead の decide は d=0、timeout=1000ms。境界の decide はコンストラクタ第4引数で T を設定する。このcheckoutのrunnerはERIS decide timeout環境変数を読まず、既定値はdecideTimeout.tsの定数。エラー文の5000msは定数なので、分類はDecideTimeoutErrorの型で行う。',
    'fixtureと受信遅延は共通のperformance.now busy-spinを使い、timer coalescingを避けるため意図的に1コアを消費する。dはworker内の目標滞在時間で、preemptionによる超過は起こり得る。IPC・親側の処理はdに含まれず、期限は親のdispatch前から始まる。送信・log・RPC・モデル呼出はない。',
    'この版のprobeの受信listenerは、世代生成時に計算済みのhashを含むfieldsを書き込む。受信時そのものにhashを再計算するコードはない。hash/readFileはmethod wrapperやspawnで実行される。deadline設置後のworker_post記録と、stock判定前の受信記録は期限の余裕を消費し得る。',
    '親のperformance.nowでwrapperの入口から返却/Promise完了まで測る。新規sinkへの同期append、hash、Worker内のpreloadを含む。親プロセス自体の起動・probe登録・version bind・出力JSON整形・監査は区間外。start/decide内の共通処理があるので各行の差を加算しない。',
    '個別armの分布と同一pairのB−A差の分布を示す。分位点はソート後の線形補間（index=(n−1)p）。差にはOSノイズも入り、負値を切り捨てない。因果的な厳密上限ではない。', '',
    '## 呼出時間と追加時間（ms）', '',
    '| method | arm / 差 | n | median | p95 | p99 | max |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const [method, groups] of Object.entries(summary.overhead)) {
    for (const [arm, stats] of Object.entries(groups)) lines.push(
      `| ${method} | ${arm === 'pairedDelta' ? 'B−A (paired)' : arm} | ${stats.n} | ${f(stats.median)} | ${f(stats.p95)} | ${f(stats.p99)} | ${f(stats.max)} |`);
  }
  lines.push('', '## 期限境界', '',
    'timeout割合差はB−A。nは各arm。成功時のfixture実滞在時間も示す（timeout側は未観測・打切り）。', '',
    '| d ms | n | A timeout/n | A割合 | B timeout/n | B割合 | 差 | Aのみ/Bのみtimeout | 成功fixture median A/B ms |',
    '| ---: | ---: | --- | ---: | --- | ---: | ---: | --- | --- |');
  for (const row of summary.boundary) lines.push(
    `| ${row.dMs} | ${row.n} | ${row.A.timeouts}/${row.n} | ${f(row.A.fraction)} | ${row.B.timeouts}/${row.n} | ${f(row.B.fraction)} | ${f(row.difference)} | ${row.discordant.onlyA}/${row.discordant.onlyB} | ${f(row.A.successfulFixtureMs.median)}/${f(row.B.successfulFixtureMs.median)} |`);
  lines.push('', `格子上の積分差 step × Σ(pB−pA) = **${f(summary.boundaryShiftMs)}ms**。正値はBのtimeout増加側。`,
    'これは観測範囲内の割合差の面積であり、単調性を仮定した50%境界の推定値でも、信頼区間でもない。差が小さい/ゼロでも等価性・干渉なしを証明しない。', '',
    '## 記録の検査', '', '```json', JSON.stringify(result.armDiagnostics ?? [], null, 2), '```', '',
    ...(!result.armDiagnostics?.length ? ['中断のためfinishProbeと記録監査は完了していない。保存rawはcall結果であり、完全なprobe監査ログではない。', ''] : []),
    'stock probeの既存auditRecordsはtimeoutでworker終端記録が無い場合G3_TERMINAL_GAPとなる。これをPASSに変更しない。測定専用検査は全連番・call終端・世代のattach/exit・dispatch数・timeout数を確認し、正常決定の終端欠落やその他の監査エラーは失敗扱いにする。', '',
    '## 解釈の範囲', '',
    '単一ホスト・上記の指定負荷閾値内・小さい非送信fixture・StrategyRunnerレベルのみの結果。実戦略、重いmodule/依存graph、大量log/submit、実5秒境界、高負荷、別OS/ストレージ、botMain、chain、モデル、取引、backtest、G3要件は未検証。',
    '同期I/Oのストレージ依存やスケジューラの外れ値があり、この分布は一般的な上限ではない。stockソースは変更していない。probeのtoolchain overrideはバージョン照合と記録に限定する。人工delayは測定専用preloadにあり、本実測はdelay=0。', '',
    'JSONには全pair、順序、設定、時刻、load検査、ソースSHA-256、成功fixture実滞在時間、対照実験とは独立した実測値を保存する。生probe JSONLは構造検査後に削除する。', '',
    '実行コマンド:', '', '```sh', result.command ?? '(imported harness)', '```', '');
  return lines.join('\n');
}

export function renderReducedReport(result, controlName = result.config.controlName) {
  const inference = result.inference ?? reducedInference(result);
  const summary = result.summary;
  const lines = [`# REDUCED timing ${controlName ?? 'main'}`, '',
    'Pre-declared before the first reduced run; rules must not be edited after seeing results. Supporting study only; G3 evidenceではない。',
    `Status: ${result.status}. Verdict: ${result.verdict ?? result.controlVerdict ?? 'not adjudicated'}.`,
    `Control assessment: ${result.controlAssessment ?? 'not adjudicated'}; criteria passed: ${result.controlCriteriaPassed ?? false}.`,
    `Failure: ${JSON.stringify(result.failure ?? null)}`, '',
    renderHostAndLoad(result), renderCalibration(result), renderSweepPlan(result), renderRewarm(result), '',
    'Declared constants (verbatim; includes every count, seed, threshold and margin):',
    '```json', JSON.stringify(result.config.protocolConstants, null, 2), '```',
    `Started: ${result.startedAt ?? 'not started'}; finished: ${result.finishedAt ?? 'not finished'}.`,
    `Partial journal: ${markdownText(result.partialPath ?? 'not recorded')}. Arm shutdowns: ${JSON.stringify(result.armStops ?? [])}.`,
    `Planned counts: ${result.config.boundaryRepetitions} pairs/point; ${result.config.boundaryRepetitions * result.config.measuredDecides} measured decides/arm/point; warmup pairs=${result.config.warmupPairs}; overhead pairs=${result.config.repetitions}.`,
    `Seeded point-order shuffle: seed=${result.config.seed}; AB/BA alternate by repetition. Pair cooldown=${result.config.cooldownMs}ms.`,
    `Primary main dwell: ${inference.primaryDwellMs}ms. Sensitive control dwell: ${result.config.sweepSelection.sensitiveDwellMs}ms.`,
    'Intervals: nominal 95% block-effective Wilson/Newcombe, effective n = process pairs, not decisions. Arbitrary within-process correlation; independent stationary pairs and nonnegative within-pair arm covariance assumed. Pointwise intervals, no simultaneous coverage.',
    '| d ms | blocks | decisions/arm | A fraction | B fraction | B-A | 95% lower | 95% upper |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const row of summary?.boundary ?? []) lines.push(`| ${row.dMs} | ${row.blocks} | ${row.n} | ${row.A.fraction} | ${row.B.fraction} | ${row.difference} | ${row.differenceInterval?.lower ?? 'unavailable'} | ${row.differenceInterval?.upper ?? 'unavailable'} |`);
  lines.push('', `Signed sampled-curve shift (non-uniform trapezoid B-A): ${summary?.boundaryShiftMs ?? 'unavailable'} ms. Positive means more B timeouts.`,
    `95% bootstrap-by-process-pair-block interval (ms): ${JSON.stringify(summary?.boundaryShiftIntervalMs ?? null)}.`,
    'Bootstrap resamples whole pairs within each point and AB/BA stratum. Independent exchangeable blocks assumed; serial drift and grid interpolation error are not covered. Degenerate intervals do not prove a population point mass. Partial estimates are descriptive only.',
    'Controls: lower interval bound at c-4 >0 AND signed area in [3,9]ms for positive; interval at c-4 contains 0 AND absolute area <=2ms for negative. Endpoint and structural guards also required. Both control verdicts are descriptive only: local hard-step derivation does not bound general coarse-grid error.',
    `Assertions: ${JSON.stringify(result.controlAssertions ?? [])}`,
    `Failures: ${JSON.stringify(result.controlFailures ?? [])}`,
    `MDE design: ${JSON.stringify(inference.mde)}`,
    `Optimistic rho=0 design: ${JSON.stringify(inference.optimisticMde)}`,
    inference.interpretation, inference.qualification,
    `Planning resolution target: ${REDUCED.planningResolutionMs}ms. Pre-declared sampled-area margin: ${JSON.stringify(inference.marginMs)}ms; complete interval inside margin: ${inference.intervalInsideMargin}.`,
    'Counts alone cannot determine a continuous-shift MDE. The area MDE concerns the sampled trapezoid only. No claim beyond the recorded host, toolchain, load, fixture and deadline.',
    'Order/time diagnostics (process-pair blocks in acquisition order):',
    '```json', JSON.stringify((summary?.boundary ?? []).map(r => ({ dMs: r.dMs, ...r.blockDiagnostics })), null, 2), '```',
    'd=0 overhead distributions (warmups excluded; 96 main decisions/arm do not establish a precise p99):',
    '```json', JSON.stringify(summary?.overhead ?? null, null, 2), '```',
    `Phase delay hits: ${JSON.stringify(result.delayHitsByPhase ?? {})}`,
    `Maximum observed load1: ${result.maxObservedLoad1 ?? 'unrecorded'}.`,
    'Probe audits and actual arm toolchains:', '```json', JSON.stringify({ diagnostics: result.armDiagnostics ?? [], toolchains: result.armToolchains ?? [] }, null, 2), '```',
    'Source SHA-256:', '```json', JSON.stringify(result.sourceHashes ?? {}, null, 2), '```',
    'Command:', '```sh', result.command ?? '(imported harness)', '```', '');
  return lines.join('\n');
}

export function renderRewarm(result) {
  const stats = result.summary?.rewarm ?? rewarmAccounting(result.raw ?? []);
  const lines = [
    `Execution unit: one stock StrategyRunner per arm process; W=${result.config.warmupDecides ?? 'legacy/unknown'} discarded d=0 warmups initially and before the next measured decide after a timeout; N=${result.config.measuredDecides ?? 1} measured decides. Fraction = timeouts / measured decides.`,
    `Rewarm counts A=${stats.A.rewarmCount ?? 'unknown'}, B=${stats.B.rewarmCount ?? 'unknown'} (completed pairs, all phases). Discarded decides A=${stats.A.discardedDecideCount ?? 'unknown'}, B=${stats.B.discardedDecideCount ?? 'unknown'}; measured decides A=${stats.A.measuredDecideCount}, B=${stats.B.measuredDecideCount}.`,
    'Imbalance warning threshold: absolute count difference >=2 AND difference / max(A,B,1) >=10%; checked overall and per measured point. Unequal re-warming can bias timeout fractions. Decisions within a process are correlated.',
    ...(stats.warning ? [`WARNING: ${stats.warning}`] : []),
    '| d ms | rewarm A | rewarm B | warning |', '| ---: | ---: | ---: | --- |',
  ];
  for (const row of [...(result.summary?.exploration ?? []), ...(result.summary?.boundary ?? [])]) {
    const r = row.rewarm;
    lines.push(`| ${row.dMs} | ${r?.A.rewarmCount ?? 'unknown'} | ${r?.B.rewarmCount ?? 'unknown'} | ${r?.warning ? `WARNING: ${r.warning}` : ''} |`);
  }
  if (result.failedUnits?.length) lines.push('Incomplete pairs excluded from summary; process counts and partial records:',
    '```json', JSON.stringify(result.failedUnits, null, 2), '```');
  return lines.join('\n');
}

export function renderSweepPlan(result) {
  const selection = result.config.sweepSelection;
  return selection ? ['確認実験の事前固定条件（探索値は合否計算に使用しない）:',
    '```json', JSON.stringify(selection, null, 2), '```'].join('\n') : '';
}

export function renderExploration(result) {
  const lines = ['# Timing exploration — selection only', '',
    '探索データはPASS/FAIL・control verdictの計算には使用しない。',
    `Status: ${result.status}`, renderHostAndLoad(result), renderCalibration(result), renderRewarm(result),
    `T=${result.config.timeoutMs}ms; step=${result.config.stepMs}ms; processes=${result.config.boundaryRepetitions}/point/arm; W=${result.config.warmupDecides ?? 'legacy cold unit'}; N=${result.config.measuredDecides ?? 1}`,
    `Failure: ${JSON.stringify(result.failure ?? null)}`,
    `Exploration quality (selection only): ${JSON.stringify(result.summary?.explorationQuality ?? null)}`,
    `Fixed cost at d=0 (median decide wall ms): ${JSON.stringify(result.summary?.fixedCostEstimateMs ?? null)}`,
    '| d ms | n | A timeout fraction | B timeout fraction | A median/p95 ms | B median/p95 ms |',
    '| ---: | ---: | ---: | ---: | --- | --- |'];
  for (const p of result.summary?.exploration ?? []) lines.push(`| ${p.dMs} | ${p.n} | ${p.A.fraction} | ${p.B.fraction} | ${p.A.decideWallMs.median}/${p.A.decideWallMs.p95} | ${p.B.decideWallMs.median}/${p.B.decideWallMs.p95} |`);
  lines.push('', `delayHits by phase: ${JSON.stringify(result.delayHitsByPhase ?? {})}`, '');
  return lines.join('\n');
}

export function renderRefusal(result) {
  if (result.config.protocol === 'reduced') return renderReducedReport(result);
  return ['# StrategyRunner 時間干渉計測 — 開始拒否・未測定', '',
    '**測定未完了。per-call overhead・timeout境界差・等価性について結果はない。G3 evidenceではない。**', '',
    'このレポートはmeasure-timing.mjsが同時保存したJSONから生成した。負荷上限を超えたため、計測用の子プロセス/Workerを起動していない。', '',
    renderHostAndLoad(result), renderCalibration(result), renderSweepPlan(result), renderRewarm(result), '',
    '| 項目 | 実測・設定 |', '| --- | --- |',
    `| 拒否時刻 UTC | ${result.finishedAt} |`,
    `| Node / tsx | ${result.hostBefore.node} / ${result.hostBefore.tsx} |`,
    `| CPU / 論理CPU | ${result.hostBefore.cpuModel} / ${result.hostBefore.logicalCpus} |`,
    `| OS | ${result.hostBefore.platform} ${result.hostBefore.release} ${result.hostBefore.arch} |`,
    `| 開始前 load (1/5/15分) | ${result.hostBefore.loadAverage.join(' / ')} |`,
    `| 拒否後 load (1/5/15分) | ${result.hostAfter.loadAverage.join(' / ')} |`,
    `| 1分load 上限 | ${result.config.maxLoad1} |`,
    `| 拒否コード | ${result.failure.code} |`,
    '| 実測反復数 | 0 |', '',
    `予定設定: 各arm ${result.config.repetitions}反復、T=${result.config.timeoutMs}ms、` +
      `d=T${result.config.minOffsetMs}〜T+${result.config.maxOffsetMs}ms、${result.config.stepMs}ms刻み、各点${result.config.boundaryRepetitions}反復。これは実行済み件数ではない。`, '',
    '正対照・負対照の実測結果はこのレポートに含まれない。測定ハーネスが実際に時間干渉を検出できるかも、対照テストの実行結果で別途確認する必要がある。', '',
    '対象は単一ホストの指定負荷閾値内の非送信fixture、stock StrategyRunnerレベルのみ。botMain、実戦略、実5秒境界、chain、モデル、backtest、G3要件はいずれも未検証。', '',
    '負荷が上限以下になってから、未使用の出力名で再実行する。既存結果は上書きしない。', '',
    '```sh', result.command, '```', ''].join('\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let parsed, prefix;
  try {
    parsed = parseTimingArgs(process.argv.slice(2));
    prefix = assertFreshOutput(parsed.output, directory);
  } catch (error) {
    console.error(error.message);
    console.error('Usage: node ascon-notes/league/g3/loader/measure-timing.mjs --output <new-prefix> [--explore | --sweep-from <exploration.json>] [--protocol legacy|reduced] [--budget-min <minutes>] [--max-load1 <number>] [--load-note <host and reason; required if threshold differs from 2.5>]');
    process.exitCode = 2;
  }
  if (prefix) {
    const { output, ...options } = parsed;
    const persist = artifactWriter(prefix, r => r.status === 'refused' ? renderRefusal(r) : renderReport(r));
    let result;
    try { result = await runExperiment(options, update => process.stderr.write(`${JSON.stringify(update)}\n`), persist); }
    catch (error) {
      if (error.code !== 'TIMING_LOAD_REFUSED') throw error;
      result = refusalResult(error, options);
    }
    // Shell-safe reconstruction, including a multiword load note.
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    result.command = ['env', ...Object.entries(toolchainEnvironment()).map(([key, value]) => `${key}=${value}`), 'node', 'ascon-notes/league/g3/loader/measure-timing.mjs',
      ...process.argv.slice(2)].map(quote).join(' ');
    persist(result);
    process.stdout.write(`${JSON.stringify({ status: result.status, json: `${output}.json`,
      markdown: `${output}.md`, completedPairs: result.raw.length,
      overheadSamplesPerArm: result.summary?.overhead.decide.A.n ?? 0,
      boundaryShiftMs: result.summary?.boundaryShiftMs ?? null, failure: result.failure })}\n`);
    if (result.status !== 'complete') process.exitCode = result.status === 'refused' ? 2 : 1;
  }
}
