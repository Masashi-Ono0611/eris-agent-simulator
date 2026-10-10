// Fast, offline checks only: never call runExperiment or import loader-timing.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseTimingArgs, parseTimingEnvironment, assertFreshOutput } from '../loader/timing-options.mjs';
import { DEFAULTS, host, renderReport, renderRefusal, renderControlReport, summarize } from '../loader/measure-timing.mjs';

import { probeToolchain, toolchainEnvironment, TOOLCHAIN_OVERRIDE_NOTE } from '../loader/probe-toolchain.mjs';

const output = ['--output', 'new-run'];
const note = 'Mac mini Intel, 12 CPUs: shared background services, expected load1 about 2.6';

test('CLI default remains 2.5 with an empty load note', () => {
  assert.equal(DEFAULTS.maxLoad1, 2.5);
  assert.equal(DEFAULTS.loadNote, '');
  assert.deepEqual(parseTimingArgs(output), { output: 'new-run', maxLoad1: 2.5, loadNote: '' });
  assert.equal(parseTimingArgs([...output, '--max-load1', '2.50']).maxLoad1, 2.5);
});

test('CLI accepts valid thresholds with a note, in any option order', () => {
  for (const value of ['3.5', '1.5', '2.5']) {
    assert.deepEqual(parseTimingArgs(['--load-note', note, '--max-load1', value, ...output]),
      { output: 'new-run', maxLoad1: Number(value), loadNote: note });
  }
});

test('CLI rejects missing or blank load-note for either direction of threshold change', () => {
  for (const value of ['3', '2']) {
    assert.throws(() => parseTimingArgs([...output, '--max-load1', value]), /load-note is required/);
    assert.throws(() => parseTimingArgs([...output, '--max-load1', value, '--load-note', '  ']), /missing value/);
  }
});

test('CLI rejects non-positive, NaN, nonnumeric and infinite thresholds', () => {
  for (const value of ['0', '-0', '-1', 'NaN', 'oops', 'Infinity', '-Infinity', '1e999']) {
    assert.throws(() => parseTimingArgs([...output, '--max-load1', value, '--load-note', note]), /finite positive number/);
  }
});

test('CLI rejects missing values, missing output, duplicate and unknown options', () => {
  for (const args of [[], ['--output'], [...output, '--max-load1'], [...output, '--load-note'],
    [...output, '--max-load1', '--load-note', note], [...output, '--output', 'second'],
    [...output, '--max-load1', '2.5', '--max-load1', '3'], [...output, '--typo', '3']]) {
    assert.throws(() => parseTimingArgs(args));
  }
});

test('control environment honors max-load1 and requires its paired load note', () => {
  assert.deepEqual(parseTimingEnvironment({}), { maxLoad1: 2.5, loadNote: '' });
  assert.deepEqual(parseTimingEnvironment({ G3_TIMING_MAX_LOAD1: '3.5', G3_TIMING_LOAD_NOTE: note }),
    { maxLoad1: 3.5, loadNote: note });
  assert.throws(() => parseTimingEnvironment({ G3_TIMING_MAX_LOAD1: '3' }), /G3_TIMING_LOAD_NOTE.*required/);
  assert.throws(() => parseTimingEnvironment({ G3_TIMING_MAX_LOAD1: '2', G3_TIMING_LOAD_NOTE: ' ' }), /G3_TIMING_LOAD_NOTE.*required/);
  for (const value of ['', ' ', '0', '-1', 'NaN', 'Infinity']) {
    assert.throws(() => parseTimingEnvironment({ G3_TIMING_MAX_LOAD1: value, G3_TIMING_LOAD_NOTE: note }), /finite positive number/);
  }
});

test('output preflight requires a new prefix and rejects either existing artifact', () => {
  const directory = mkdtempSync(fileURLToPath(new URL('./.timing-options-test-', import.meta.url)));
  try {
    const fresh = join(directory, 'fresh');
    assert.equal(assertFreshOutput(fresh, directory), fresh);
    assert.throws(() => assertFreshOutput(undefined, directory), /new output prefix/);
    assert.throws(() => assertFreshOutput(join(directory, '..', 'escape'), directory), /artifact directory/);
    for (const extension of ['json', 'md']) {
      const prefix = join(directory, extension);
      writeFileSync(`${prefix}.${extension}`, 'preserved', { flag: 'wx' });
      assert.throws(() => assertFreshOutput(prefix, directory), /refuse to overwrite/);
      assert.equal(readFileSync(`${prefix}.${extension}`, 'utf8'), 'preserved');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('live host metadata records OS, arch, CPU model and logical count without hostname', () => {
  const metadata = host();
  for (const key of ['platform', 'release', 'arch', 'cpuModel']) assert.equal(typeof metadata[key], 'string');
  assert.ok(Number.isInteger(metadata.logicalCpus) && metadata.logicalCpus > 0);
  assert.equal(Object.hasOwn(metadata, 'hostname'), false);
});

test('all report paths use supplied host, operative threshold and note, including refusal', () => {
  // Synthetic metadata, not measured Mac mini results.
  const metadata = { node: 'synthetic', tsx: 'synthetic', platform: 'darwin', release: 'synthetic',
    arch: 'x64', cpuModel: 'Intel synthetic fixture', logicalCpus: 12, loadAverage: [2.6, 2.6, 2.6] };
  const config = { ...DEFAULTS, ...parseTimingEnvironment({ G3_TIMING_MAX_LOAD1: '3.5', G3_TIMING_LOAD_NOTE: note }) };
  const result = JSON.parse(JSON.stringify({ config, hostBefore: metadata, hostAfter: metadata,
    status: 'aborted', controlVerdict: 'failed', raw: [], summary: summarize([], config),
    failure: { code: 'SYNTHETIC' }, command: '(synthetic only)' }));
  assert.equal(result.config.maxLoad1, 3.5);
  assert.equal(result.config.loadNote, note);
  for (const report of [renderReport(result), renderRefusal(result), renderControlReport({ positive: result })]) {
    for (const text of ['x64', 'Intel synthetic fixture', '12 logical CPUs', 'Operative max-load1: **3.5**',
      note, 'changed from default 2.5 to 3.5 for host', 'because:', 'relaxed threshold weakens the "idle-load" claim']) {
      assert.ok(report.includes(text), text);
    }
    assert.ok(!report.includes('Apple M5'));
  }
  const defaultReport = renderReport({ ...result, config: DEFAULTS });
  assert.ok(defaultReport.includes('The load threshold is unchanged from default.'));
  assert.ok(!defaultReport.includes('This threshold was changed'));
});

test('six archived Air artifacts retain their recorded hashes and cannot be output targets', () => {
  const loader = new URL('../loader/', import.meta.url);
  const index = readFileSync(new URL('TIMING-AIR-ARCHIVE.md', loader), 'utf8');
  assert.ok(index.includes('aborted, Air, load guard'));
  const entries = [...index.matchAll(/\]\(([^)]+)\) \| `([a-f0-9]{64})`/g)];
  assert.equal(entries.length, 6);
  for (const [, path, expected] of entries) {
    const url = new URL(path, loader);
    assert.equal(createHash('sha256').update(readFileSync(url)).digest('hex'), expected, path);
    assert.throws(() => assertFreshOutput(fileURLToPath(url).replace(/\.(json|md)$/, ''),
      fileURLToPath(new URL('./', url))), /refuse to overwrite/);
  }
});


test('measurement forwards only explicit toolchain overrides and records actual runtime', () => {
  const actual = probeToolchain({});
  assert.equal(actual.toolchainOverride, false);
  assert.equal(actual.node, process.version);
  assert.deepEqual(toolchainEnvironment({}), {});
  const env = { G3_PROBE_EXPECT_NODE: actual.node, G3_PROBE_EXPECT_TSX: actual.tsx };
  assert.deepEqual(toolchainEnvironment({ ...env, UNRELATED: 'not-forwarded' }), env);
  assert.deepEqual(toolchainEnvironment({ G3_PROBE_EXPECT_NODE: '' }), { G3_PROBE_EXPECT_NODE: '' });
  const metadata = JSON.parse(JSON.stringify(host(env)));
  assert.equal(metadata.node, actual.node);
  assert.equal(metadata.tsx, actual.tsx);
  assert.equal(metadata.toolchainOverride, true);
  assert.equal(metadata.toolchainNote, TOOLCHAIN_OVERRIDE_NOTE);
  assert.equal(metadata.expectedNode, actual.node);
  assert.equal(metadata.expectedTsx, actual.tsx);
  // Expectations are never misreported as actual runtime versions.
  const wrong = host({ G3_PROBE_EXPECT_NODE: 'wrong', G3_PROBE_EXPECT_TSX: 'wrong' });
  assert.equal(wrong.node, actual.node);
  assert.equal(wrong.tsx, actual.tsx);
  const result = JSON.parse(JSON.stringify({ config: DEFAULTS, hostBefore: metadata, hostAfter: metadata,
    status: 'aborted', raw: [], summary: summarize([], DEFAULTS), failure: { code: 'SYNTHETIC' } }));
  for (const report of [renderReport(result), renderRefusal(result), renderControlReport({ synthetic: result })]) {
    for (const text of [actual.node, actual.tsx, metadata.arch, 'toolchainOverride:true', TOOLCHAIN_OVERRIDE_NOTE]) {
      assert.ok(report.includes(text), text);
    }
  }
});
