import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertLoad, distribution, runExperiment, summarize, refusalResult, renderControlReport, artifactWriter } from '../loader/measure-timing.mjs';
import { storeControlVerdict } from '../loader/timing-sweep.mjs';
import { parseTimingEnvironment, assertFreshOutput } from '../loader/timing-options.mjs';

test('load gate refuses high, invalid and unavailable load before any worker starts', () => {
  assert.doesNotThrow(() => assertLoad(2.5, 2.5));
  for (const [load, limit] of [[2.50001, 2.5], [NaN, 2.5], [1, 0], [1, Infinity]]) {
    assert.throws(() => assertLoad(load, limit), { code: 'TIMING_LOAD_REFUSED' });
  }
});

test('quantiles keep signed paired differences and use linear interpolation', () => {
  assert.deepEqual(distribution([-2, -1, 0, 1, 2]), { n: 5, median: 0, p95: 1.7999999999999998, p99: 1.96, max: 2 });
  assert.deepEqual(distribution([]), { n: 0, median: null, p95: null, p99: null, max: null });
});

const controls = {};
const { values } = parseArgs({ options: { 'sweep-from': { type: 'string' } } });
const config = { repetitions: 0, warmupPairs: 4, boundaryRepetitions: 16, ...parseTimingEnvironment(process.env),
  ...(values['sweep-from'] ? { sweepFrom: values['sweep-from'] } : {}) };
let persist;
async function runControl(name, options, progress) {
  // Required for a measured run, but pure unit tests need no output or filesystem writes.
  persist ??= artifactWriter(assertFreshOutput(process.env.G3_TIMING_CONTROL_OUTPUT,
    fileURLToPath(new URL('./', import.meta.url))), renderControlReport);
  let result;
  try { result = await runExperiment(options, progress, plan => {
    controls[name] = { ...plan, controlVerdict: 'not-run' };
    persist(controls);
  }); }
  catch (error) {
    if (error.code !== 'TIMING_LOAD_REFUSED') throw error;
    result = refusalResult(error, options);
  }
  controls[name] = result;
  return result;
}
function verify(result, name) {
  const recomputed = result.summary ? summarize(result.raw, result.config) : null;
  storeControlVerdict(result, name, [{ name: 'summaryMatchesRaw',
    passed: JSON.stringify(recomputed) === JSON.stringify(result.summary ?? null),
    values: { expected: recomputed, actual: result.summary ?? null } }]);
  persist(controls); // Persist assertion names and values before throwing.
  assert.equal(result.controlVerdict, 'passed', JSON.stringify(result.controlFailures));
}

test('positive control: measurement-only 6ms receive delay moves the stock deadline boundary', { timeout: 3600000 }, async t => {
  const result = await runControl('positive', { ...config, seed: 91001, arms: [
    { name: 'probe', probe: true, delayMs: 0 }, { name: 'probe+6ms-control', probe: true, delayMs: 6 },
  ] }, update => t.diagnostic(JSON.stringify(update)));
  verify(result, 'positive');
  const sensitive = result.summary.boundary.find(row => Math.abs(row.dMs - result.config.sweepSelection.sensitiveDwellMs) < 1e-9);
  t.diagnostic(JSON.stringify({ control: 'positive', boundaryShiftMs: result.summary.boundaryShiftMs,
    sensitive, delayHits: result.armDiagnostics[1].delayHits }));
});

test('negative control: identical probe arms have boundary difference within predeclared 2ms noise tolerance', { timeout: 3600000 }, async t => {
  const result = await runControl('negative', { ...config, seed: 91002, arms: [
    { name: 'probe-identical-A', probe: true, delayMs: 0 }, { name: 'probe-identical-B', probe: true, delayMs: 0 },
  ] }, update => t.diagnostic(JSON.stringify(update)));
  verify(result, 'negative');
  t.diagnostic(JSON.stringify({ control: 'negative', boundaryShiftMs: result.summary.boundaryShiftMs }));
});

// Artifacts from this exact run; refusal and aborted results remain failed controls.
after(() => {
  if (!Object.keys(controls).length) return;
  persist(controls);
});
