// Synthetic only: no subprocess, stock Runner, Worker, model or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTimingUnit } from '../loader/timing-unit.mjs';
import { DEFAULTS, summarize, rewarmAccounting, renderReport, renderControlReport,
  renderExploration, prepareTimingConfig } from '../loader/measure-timing.mjs';

class SyntheticTimeout extends Error {}
function harness({ timeouts = [], errorAt, W = 2, N = 3 } = {}) {
  const calls = [], lifecycle = [];
  let made = 0, clock = 0, generation = 1, warm = 0;
  return { calls, lifecycle, created: () => made,
    run: () => runTimingUnit({ durationMs: 20, timeoutMs: 100, warmupDecides: W, measuredDecides: N }, {
      descriptor: () => ({}), now: () => clock++, isTimeout: e => e instanceof SyntheticTimeout,
      createRunner: () => {
        made++;
        return {
          setSource() { lifecycle.push('setSource'); },
          async start() { lifecycle.push('start'); },
          async close() { lifecycle.push('close'); },
          async decide(observation) {
            calls.push({ ...observation, generation, warm });
            if (observation.round === errorAt) throw Error('synthetic failure');
            if (timeouts.includes(observation.round)) {
              generation++; warm = 0; throw new SyntheticTimeout();
            }
            // Advance well past the nominal timeout: wall time is NOT the classifier.
            clock += 200;
            warm++;
            return { submitted: [], action: { type: 'noop', reason: JSON.stringify({ elapsedMs: observation.timingDurationMs }) } };
          },
        };
      },
    }),
  };
}

test('one runner reused; post-timeout decide is discarded and W warmups precede measurement', async () => {
  const h = harness({ timeouts: [3, 7] });
  const unit = await h.run();
  assert.equal(unit.status, 'complete');
  assert.equal(h.created(), 1);
  assert.deepEqual(h.lifecycle, ['setSource', 'start', 'start', 'close']);
  assert.equal(unit.rewarmCount, 1); // final timeout needs no replacement / next measurement
  assert.equal(unit.discardedDecideCount, 4);
  assert.equal(unit.measuredDecideCount, 3);
  assert.deepEqual(unit.warmup.map(d => d.round), [1, 2, 4, 5]);
  assert.deepEqual(unit.decides.map(d => d.round), [3, 6, 7]);
  assert.deepEqual(unit.decides.map(d => d.timedOut), [true, false, true]);
  assert.ok(unit.decides.every(d => Number.isFinite(d.wallMs)));
  assert.equal(unit.decides[0].fixtureElapsedMs, null);
  assert.equal(unit.decides[1].fixtureElapsedMs, 20);
  assert.equal(h.calls[3].timingDurationMs, 0);
  assert.equal(unit.warmup.find(d => d.round === 4).phase, 'rewarm');
  assert.ok(h.calls.filter(c => c.timingDurationMs === 20).every(c => c.warm >= 2));
});

test('every non-final timeout triggers a fresh W discarded decides on the replacement', async () => {
  const h = harness({ timeouts: [3, 6, 9] });
  const unit = await h.run();
  assert.equal(unit.rewarmCount, 2);
  assert.equal(unit.discardedDecideCount, 6);
  assert.equal(unit.measuredDecideCount, 3);
  assert.deepEqual(unit.decides.map(d => d.round), [3, 6, 9]);
  assert.deepEqual(h.calls.filter(c => c.timingDurationMs === 20).map(c => c.generation), [1, 2, 3]);
});

test('stock exception classification preserved even when successful wall time exceeds T', async () => {
  const h = harness();
  const unit = await h.run();
  assert.equal(unit.status, 'complete');
  assert.equal(unit.rewarmCount, 0);
  assert.equal(unit.discardedDecideCount, 2);
  assert.ok(unit.decides.every(d => !d.timedOut && d.wallMs > 100));
  assert.equal(new Set(h.calls.map(c => c.generation)).size, 1);
});

test('initial or replacement warmup timeout aborts without measuring a cold decide', async () => {
  for (const [timeouts, expectedN, expectedDiscarded, expectedRewarm] of [
    [[1], 0, 1, 0], [[3, 4], 1, 3, 1], [[3, 5], 1, 4, 1],
  ]) {
    const h = harness({ timeouts }), unit = await h.run();
    assert.equal(unit.status, 'aborted');
    assert.equal(unit.failure.code, 'TIMING_WARMUP_TIMEOUT');
    assert.equal(unit.measuredDecideCount, expectedN);
    assert.equal(unit.discardedDecideCount, expectedDiscarded);
    assert.equal(unit.rewarmCount, expectedRewarm);
    assert.equal(h.lifecycle.at(-1), 'close');
    assert.ok(!unit.decides.some(d => d.round === 4));
  }
});

test('unrelated errors abort and close; invalid W/N cannot instantiate a runner', async () => {
  const h = harness({ errorAt: 3 }), unit = await h.run();
  assert.equal(unit.status, 'aborted');
  assert.equal(unit.failure.message, 'synthetic failure');
  assert.equal(unit.measuredDecideCount, 0);
  assert.equal(h.lifecycle.at(-1), 'close');
  for (const value of [0, -1, 0.5, NaN]) for (const key of ['W', 'N']) {
    const invalid = harness({ [key]: value });
    await assert.rejects(invalid.run);
    assert.equal(invalid.created(), 0);
  }
});

const syntheticUnit = (timeouts, rewarmCount = 0) => ({ rewarmCount, discardedDecideCount: 5 * (rewarmCount + 1),
  measuredDecideCount: timeouts.length, warmup: [{ timedOut: true, wallMs: 9999, fixtureElapsedMs: null }],
  durations: { setSource: 1, start: 2, startReady: 3, close: 4 },
  decides: timeouts.map((timedOut, i) => ({ timedOut, wallMs: 10 + i * 2, fixtureElapsedMs: timedOut ? null : 0 })) });

test('per-decide aggregation in exploration, main measurement and controls excludes all discarded records', () => {
  for (const explore of [true, false]) {
    const config = { ...DEFAULTS, explore, dwellPointsMs: [0], stepMs: 0.5 };
    const raw = [0, 1].map(i => ({ phase: explore ? 'exploration' : 'boundary', durationMs: 0,
      order: i ? 'BA' : 'AB', A: syntheticUnit([true, false, true], 1), B: syntheticUnit([false, false, true]) }));
    raw.push({ phase: 'overhead', durationMs: 0, A: syntheticUnit([false, false]), B: syntheticUnit([false, false]) });
    const summary = summarize(raw, config), row = (explore ? summary.exploration : summary.boundary)[0];
    assert.equal(row.n, 6);
    assert.equal(row.A.timeouts, 4);
    assert.equal(row.A.fraction, 4 / 6);
    assert.equal(row.B.fraction, 2 / 6);
    assert.equal(row.A.decideWallMs.n, 6);
    assert.equal(row.A.decideWallMs.median, 12);
    assert.equal(row.A.decideWallMs.p95, 14);
    assert.equal(summary.overhead.decide.A.n, 2);
    assert.equal(summary.overhead.start.A.n, 1);
    assert.equal(summary.fixedCostEstimateMs.A, 12);
    assert.equal(row.rewarm.A.rewarmCount, 2);
    assert.match(row.rewarm.warning, /bias timeout fractions/);
  }
});

test('arm imbalance warning uses declared absolute and relative limits', () => {
  for (const [a, b, warning] of [[0, 0, false], [0, 1, false], [0, 2, true], [18, 20, true], [19, 21, false], [20, 18, true]]) {
    const stats = rewarmAccounting([{ A: syntheticUnit([false], a), B: syntheticUnit([false], b) }]);
    assert.equal(Boolean(stats.warning), warning, `${a}/${b}`);
    assert.equal(stats.A.rewarmCount, a);
    assert.equal(stats.B.rewarmCount, b);
  }
});

test('all report paths show A/B counts and warn per point even when overall counts cancel', () => {
  const config = { ...DEFAULTS, dwellPointsMs: [0, 5], stepMs: 5 };
  const raw = [0, 5].map((durationMs, i) => ({ phase: 'boundary', durationMs,
    A: syntheticUnit([false], i ? 0 : 2), B: syntheticUnit([false], i ? 2 : 0) }));
  const metadata = { platform: 'synthetic', release: 'fixture', arch: 'synthetic', cpuModel: 'synthetic',
    logicalCpus: 1, node: 'synthetic', tsx: 'synthetic', loadAverage: [0, 0, 0] };
  const result = { config, raw, status: 'complete', summary: summarize(raw, config), hostBefore: metadata, hostAfter: metadata };
  assert.equal(result.summary.rewarm.warning, null);
  const exploration = { ...result, config: { ...config, explore: true },
    raw: raw.map(p => ({ ...p, phase: 'exploration' })) };
  exploration.summary = summarize(exploration.raw, exploration.config);
  for (const report of [renderReport(result), renderControlReport({ positive: result, negative: result }), renderExploration(exploration)]) {
    assert.match(report, /Rewarm counts A=2, B=2/);
    assert.match(report, /WARNING: Re-warm imbalance between arms can bias timeout fractions/);
    assert.match(report, /Fraction = timeouts \/ measured decides/);
  }
});

test('initial W and measured N are declared for exploration and inherited by common paths', () => {
  assert.equal(DEFAULTS.warmupDecides, 5);
  assert.equal(DEFAULTS.measuredDecides, 40);
  const config = prepareTimingConfig({ explore: true }, {});
  assert.equal(config.warmupDecides, 5);
  assert.equal(config.measuredDecides, 40);
});

test('discarded initial and replacement delay hits never satisfy measured boundary delay checks', async () => {
  const { delayHitsByPhase } = await import('../loader/timing-sweep.mjs');
  const unit = { delayHits: 9, warmup: [{ delayHits: 2 }, { delayHits: 3 }],
    decides: [{ delayHits: 4 }] };
  assert.deepEqual(delayHitsByPhase([{ phase: 'boundary', B: unit }], 'B'),
    { warmup: 5, overhead: 0, exploration: 0, boundary: 4 });
  assert.throws(() => delayHitsByPhase([{ phase: 'boundary', B: { ...unit, delayHits: 10 } }], 'B'), /accounted/);
});

test('synthetic probe audit accepts reused generations and stock timeout gaps, rejects lost success', async () => {
  const { inspectProbe } = await import('../loader/measure-timing.mjs');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const unit = await harness({ timeouts: [3, 7] }).run();
  const records = [];
  const emit = (event, fields = {}) => records.push({ seq: records.length + 1, event, ...fields });
  let callId = 0, generation = 0, alive = false;
  const call = (method, fields = {}, action = () => {}) => {
    const id = ++callId;
    emit(`${method}_enter`, { callId: id, ...fields });
    action();
    emit(`${method}_exit`, { callId: id, outcome: 'return', ...fields });
  };
  const start = () => {
    if (alive) return;
    alive = true; generation++;
    emit('worker_create', { generation, version: 0, sourceSha256: 'synthetic' });
    emit('worker_attach', { generation, threadId: 1 });
    emit('worker_ready', { generation });
  };
  emit('probe_registered'); emit('runner_seen');
  call('setSource'); call('start', {}, start); call('start');
  for (const d of [...unit.warmup, ...unit.decides].sort((a, b) => a.round - b.round)) {
    call('decide', { decisionId: d.round, outcome: d.timedOut ? 'throw' : 'return' }, () => {
      call('start', {}, start);
      const fields = { generation, decisionId: d.round, workerDecisionId: d.round,
        version: 0, sourceSha256: 'synthetic' };
      emit('worker_post', fields);
      if (d.timedOut) { emit('worker_exit', { generation }); alive = false; }
      else emit('worker_result', fields);
    });
  }
  call('close', {}, () => { if (alive) emit('worker_exit', { generation }); });
  emit('probe_complete', { calls: callId, decisions: unit.warmup.length + unit.decides.length, generations: generation });
  const directory = mkdtempSync(fileURLToPath(new URL('./.unit-audit-', import.meta.url)));
  const sink = `${directory}/synthetic.jsonl`;
  try {
    writeFileSync(sink, records.map(r => JSON.stringify(r)).join('\n'));
    const result = inspectProbe(sink, unit);
    assert.equal(result.generations, 2);
    assert.equal(result.expectedTimeouts, 2);
    assert.equal(result.terminalGaps, 2);
    assert.equal(result.originalAudit, 'G3_TERMINAL_GAP');
    const lost = records.filter(r => r.event !== 'worker_result' || r.decisionId !== 6)
      .map((r, i) => ({ ...r, seq: i + 1 }));
    writeFileSync(sink, lost.map(r => JSON.stringify(r)).join('\n'));
    assert.throws(() => inspectProbe(sink, unit));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
