import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { auditRecords } from '../loader/audit-records.mjs';

const loaderDir = fileURLToPath(new URL('../loader/', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const url = name => new URL(`../loader/${name}`, import.meta.url).href;
const sha = data => createHash('sha256').update(data).digest('hex');
const fixture = url('run-fixtures.mjs');
const require = createRequire(import.meta.url);
const sentinels = {
  G3_UNRELATED_SETTING: 'G3_ENV_SENTINEL',
  ERIS_AGENT_PRIVATE_KEY: 'G3_PRIVATE_KEY_SENTINEL',
  CF_ACCESS_CLIENT_ID: 'G3_CF_ID_SENTINEL',
  CF_ACCESS_CLIENT_SECRET: 'G3_CF_SECRET_SENTINEL',
  ERIS_RPC_HEADERS: '{"Authorization":"G3_HEADER_SENTINEL"}',
};

function run(enabled, mode = 'normal', extra = {}, witness = true) {
  const dir = mkdtempSync(join(loaderDir, '.probe-test-'));
  const sink = join(dir, 'records.jsonl');
  try {
    const args = ['--import', 'tsx', '--import', url('offline-guard.mjs')];
    if (witness) args.push('--import', url('call-witness.mjs'));
    if (enabled) args.push('--import', url('probe-loader.mjs'));
    args.push(fileURLToPath(fixture), mode);
    // Do not inherit real credentials or user NODE_OPTIONS into either fixture process.
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      ...sentinels, G3_PROBE_JSONL: sink, G3_TEST_WITH_PROBE: enabled ? '1' : '0', ...extra };
    const child = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 90000, maxBuffer: 4e6 });
    assert.equal(child.error, undefined, 'fixture must finish without harness timeout');
    const path = mode === 'write-failure' ? `${sink}.before-failure` : sink;
    const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const records = raw.trim() ? raw.trim().split('\n').map(line => JSON.parse(line)) : [];
    return { status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr, records, raw, sink };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function success(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  return JSON.parse(result.stdout);
}

function guardAt(result, code, site) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '', 'control must catch the error without printing its stack');
  assert.deepEqual(JSON.parse(result.stdout), { guard: { code, site } });
  const guards = result.records.filter(r => r.event === 'guard');
  assert.equal(guards.length, 1, 'exactly one guard must fire');
  assert.equal(guards[0].code, code);
  assert.deepEqual(result.records.map(r => r.event), site === 'describe' && result.records.some(r => r.event === 'runner_seen')
    ? ['probe_registered', 'runner_seen', 'guard'] : ['probe_registered', 'guard']);
  for (const secret of [...Object.values(sentinels), 'G3_RAW_SOURCE_SENTINEL', result.sink]) {
    assert.ok(!result.raw.includes(secret), 'guard records must preserve redaction');
  }
  assert.deepEqual(Object.keys(guards[0]).sort(),
    ['schema', 'seq', 'threadId', 'utc', 'monoNs', 'event', 'code'].sort());
}

// Registration-only subprocesses: no StrategyRunner calls, Workers or timing sweep.
function registration(extra = {}, nodeVersion) {
  const dir = mkdtempSync(join(loaderDir, '.probe-test-'));
  const sink = join(dir, 'records.jsonl');
  try {
    const script = `
      ${nodeVersion === undefined ? '' : `Object.defineProperty(process, 'version', { value: ${JSON.stringify(nodeVersion)} });`}
      try {
        const probe = await import(${JSON.stringify(url('probe-loader.mjs'))});
        probe.finishProbe();
        console.log(JSON.stringify({ code: null }));
      } catch (error) {
        console.log(JSON.stringify({ code: error.code }));
        process.exitCode = 1;
      }`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--import', url('offline-guard.mjs'),
      '--input-type=module', '--eval', script], { cwd: root, encoding: 'utf8', timeout: 10000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        G3_PROBE_JSONL: sink, ...extra } });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.stderr, '');
    return { status: child.status, code: JSON.parse(child.stdout).code,
      records: existsSync(sink) ? readFileSync(sink, 'utf8').trim().split('\n').map(JSON.parse) : [] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('toolchain guard: default rejects a different Node with the exact code', () => {
  // Synthetic version property only; this does not claim a run on another Node binary.
  const result = registration({}, 'v0.0.0-g3-test');
  assert.equal(result.status, 1);
  assert.equal(result.code, 'G3_TOOLCHAIN_MISMATCH');
  assert.deepEqual(result.records, []);
});

test('toolchain guard: incorrect and empty overrides still fail closed', () => {
  for (const extra of [{ G3_PROBE_EXPECT_NODE: 'v0.0.0-wrong' },
    { G3_PROBE_EXPECT_TSX: '0.0.0-wrong' }, { G3_PROBE_EXPECT_NODE: '' }, { G3_PROBE_EXPECT_TSX: '' }]) {
    const result = registration(extra);
    assert.equal(result.status, 1);
    assert.equal(result.code, 'G3_TOOLCHAIN_MISMATCH');
    assert.deepEqual(result.records, []);
  }
});

test('toolchain override: correct exact expectations pass and record actual versions in first record', () => {
  const tsx = require('tsx/package.json').version;
  for (const node of [process.version, 'v0.0.0-g3-test']) {
    const result = registration({ G3_PROBE_EXPECT_NODE: node, G3_PROBE_EXPECT_TSX: tsx }, node);
    assert.equal(result.status, 0);
    assert.equal(result.code, null);
    assert.equal(result.records[0].event, 'probe_registered');
    assert.equal(result.records[0].node, node);
    assert.equal(result.records[0].tsx, tsx);
    assert.equal(result.records[0].toolchainOverride, true);
  }
  for (const extra of [{}, { G3_PROBE_EXPECT_NODE: process.version }, { G3_PROBE_EXPECT_TSX: tsx }]) {
    const result = registration(extra);
    assert.equal(result.status, 0);
    assert.equal(result.records[0].toolchainOverride, Object.keys(extra).length > 0);
  }
});

test('fixed local toolchain', () => {
  assert.equal(process.version, 'v24.13.0');
  assert.equal(require('tsx/package.json').version, '4.23.13');
});

test('with/without probe: stock outcomes, submissions, errors and independent original-call counts match', () => {
  const without = run(false);
  const withProbe = run(true);
  const baseline = success(without), measured = success(withProbe);
  assert.deepEqual(measured, baseline);
  assert.equal(without.records.length, 0);
  assert.deepEqual(measured.controls, ['G3_OFFLINE_NETWORK', 'G3_OFFLINE_CHILD']);
  const decisions = measured.events.filter(e => e.decision).map(e => e.decision);
  assert.equal(decisions[0].action, null);
  assert.equal(decisions[1].action.reason, 'module-call-2');
  assert.equal(decisions.filter(d => d.action?.reason === 'safe-return').length, 3);
  assert.equal(decisions.flatMap(d => d.submitted).length, 3);
  assert.ok(decisions.some(d => d.action?.reason === 'G3_OFFLINE_NETWORK'), 'worker network guard FIRE');
  assert.ok(decisions.some(d => d.action?.reason?.startsWith('backing off')), 'stock backoff branch FIRE');
  assert.ok(measured.events.some(e => e.error?.message === 'Error: fixture-error'), 'stock executor error branch FIRE');
  assert.ok(measured.events.some(e => e.error?.message === 'strategy runner is closed'), 'stock closed branch FIRE');
  assert.deepEqual(measured.counts, { setSource: 6, start: 13, decide: 13, close: 1, spawn: 8,
    workerCreate: 8, workerPost: 11, workerResult: 7, workerSubmit: 3, workerExit: 8 });
  const records = withProbe.records;
  const audit = auditRecords(records);
  assert.equal(audit.generations, measured.counts.workerCreate);
  assert.equal(records.filter(r => r.event === 'worker_post').length, measured.counts.workerPost);
  assert.equal(records.filter(r => r.event === 'worker_result').length, measured.counts.workerResult);
  assert.equal(records.filter(r => r.event === 'worker_submit').length, measured.counts.workerSubmit);
  for (const method of ['start', 'setSource', 'decide', 'close']) {
    assert.equal(records.filter(r => r.event === `${method}_enter`).length, measured.counts[method]);
  }
  assert.equal(records.filter(r => r.event === 'worker_exit').length, measured.counts.workerExit);
  const selections = records.filter(r => r.event === 'setSource_exit');
  assert.deepEqual(selections.map(r => r.version), [1, 1, 2, 3, 4, 5]);
  for (const record of selections) {
    assert.equal(record.outcome, 'return');
    assert.equal(record.versionOrigin, 'fixture-explicit');
    assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(BigInt(record.beforeNs) <= BigInt(record.afterNs));
    assert.ok(Date.parse(record.beforeUtc) <= Date.parse(record.afterUtc));
  }
  const first = selections.find(r => r.version === 1), second = selections.find(r => r.version === 2);
  assert.equal(first.sourceSha256, sha('ctx.submit({type:"noop",reason:"safe-submit"}); return {type:"noop",reason:"safe-return"};'));
  assert.equal(first.sourceSha256, second.sourceSha256);
  const initial = records.find(r => r.event === 'runner_seen');
  assert.equal(initial.sourceSha256, sha(readFileSync(join(loaderDir, 'noop-fixture.mjs'))));
  assert.equal(selections.find(r => r.version === 3).sourceSha256, initial.sourceSha256);
  assert.equal(records.filter(r => r.event === 'worker_create' && r.version === 1).length, 1);
  assert.equal(records.filter(r => r.event === 'worker_create' && r.version === 2).length, 1);
  assert.equal(records.filter(r => r.event === 'worker_post' && r.version === 5).length, 0);
  const calls = records.filter(r => r.event === 'decide_enter');
  assert.equal(new Set(calls.map(r => r.decisionId)).size, 13);
  assert.ok(calls.every(r => Number.isSafeInteger(r.decisionId)));
  const undispatched = calls.filter(call => !records.some(r => r.event === 'worker_post' && r.decisionId === call.decisionId));
  assert.deepEqual(undispatched.map(r => r.decisionId), [11, 13]); // backoff and closed
  const dropped = records.filter(r => r.event !== 'worker_attach').map((r, i) => ({ ...r, seq: i + 1 }));
  assert.throws(() => auditRecords(dropped), { code: 'G3_WORKER_GAP' }, 'offline missing-attach guard FIRE');
  assert.throws(() => auditRecords(records.slice(0, -1)), { code: 'G3_INCOMPLETE' }, 'truncation guard FIRE');
});

test('production probe also runs directly, without the independent witness', () => {
  const baseline = success(run(false, 'normal', {}, false));
  const measured = run(true, 'normal', { G3_PROBE_EXPECT_NODE: process.version,
    G3_PROBE_EXPECT_TSX: require('tsx/package.json').version }, false);
  assert.equal(measured.records[0].toolchainOverride, true);
  assert.deepEqual(success(measured), baseline);
  auditRecords(measured.records);
});

test('source selection during an in-flight decision keeps old generation/version through its result', () => {
  const baseline = success(run(false, 'inflight'));
  const measured = run(true, 'inflight');
  assert.deepEqual(success(measured), baseline);
  auditRecords(measured.records);
  const selection = measured.records.find(r => r.event === 'setSource_exit');
  const oldResult = measured.records.find(r => r.event === 'worker_result' && r.version === 0);
  const nextPost = measured.records.find(r => r.event === 'worker_post' && r.version === 1);
  assert.ok(selection.seq < oldResult.seq && oldResult.seq < nextPost.seq);
  assert.notEqual(oldResult.generation, nextPost.generation);
  assert.deepEqual(baseline.events[0].decision.submitted, [{ type: 'noop', reason: 'old-generation-submit' }]);
});

test('positive control: one real un-probed generation triggers G3_WORKER_GAP', () => {
  const result = run(true, 'normal', { G3_TEST_SKIP_GENERATION: '2' });
  assert.notEqual(result.status, 0);
  assert.ok(result.records.some(r => r.event === 'worker_attach' && r.generation === 1));
  assert.ok(result.records.some(r => r.event === 'worker_create' && r.generation === 2));
  assert.ok(!result.records.some(r => r.event === 'worker_attach' && r.generation === 2));
  assert.ok(result.records.some(r => r.event === 'guard' && r.code === 'G3_WORKER_GAP' && r.generation === 2));
  assert.match(result.stderr, /G3_WORKER_GAP/);
  assert.ok(!result.records.some(r => r.event === 'probe_complete'));
});

test('positive control: duplicate preload registration fires its exact guard', () => {
  const result = run(true, 'double');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /G3_DOUBLE_REGISTRATION/);
  assert.equal(result.records.filter(r => r.event === 'probe_registered').length, 1);
});

test('positive control: distinct StrategyRunner module copy fires wrong-instance guard before worker creation', () => {
  const result = run(true, 'wrong');
  guardAt(result, 'G3_WRONG_INSTANCE', 'worker-constructor');
});

test('positive control: subclass setSource reaches state wrong-instance guard without a Worker', () => {
  for (const witness of [true, false]) {
    assert.deepEqual(success(run(false, 'wrong-state', {}, witness)), { guard: null });
    guardAt(run(true, 'wrong-state', {}, witness), 'G3_WRONG_INSTANCE', 'state');
  }
});

for (const mode of ['unbound-initial', 'unbound-replacement']) {
  test(`positive control: ${mode} reaches describe version guard on a stock instance`, () => {
    for (const witness of [true, false]) {
      assert.deepEqual(success(run(false, mode, {}, witness)), { guard: null });
      const result = run(true, mode, {}, witness);
      guardAt(result, 'G3_VERSION_UNBOUND', 'describe');
      assert.equal(result.records.filter(r => r.event === 'runner_seen').length, mode === 'unbound-initial' ? 0 : 1);
    }
  });
}

test('positive control: a previously writable sink fails explicitly on the next record', () => {
  const result = run(true, 'write-failure');
  assert.equal(result.status, 23);
  assert.match(result.stderr, /CONTROL:G3_WRITE_FAILED/);
  assert.ok(result.records.some(r => r.event === 'worker_attach'));
  assert.ok(!result.records.some(r => r.event === 'probe_complete'));
});

test('redaction: schema excludes env values, RPC credentials, wallet, source, observations, actions, logs and errors', () => {
  const result = run(true, 'redaction');
  assert.deepEqual(success(result), { redactionFixtureCompleted: true });
  auditRecords(result.records);
  assert.ok(result.records.some(r => r.event === 'worker_log'), 'log branch FIRE');
  assert.ok(result.records.some(r => r.event === 'worker_submit'), 'submit branch FIRE');
  assert.ok(result.records.some(r => r.event === 'worker_error'), 'error branch FIRE');
  const privateStrings = [...Object.values(sentinels), 'G3_HEADER_SENTINEL', result.sink,
    'G3_CONTEXT_SENTINEL', '0x1234567890123456789012345678901234567890', 'G3_RPC_SENTINEL',
    'G3_WALLET_SENTINEL', 'G3_FULL_CONTEXT_SENTINEL', 'G3_OBSERVATION_SENTINEL',
    'G3_RAW_SOURCE_SENTINEL', 'G3_LOG_SENTINEL', 'G3_ACTION_SENTINEL', 'G3_ERROR_SENTINEL'];
  for (const secret of privateStrings) assert.ok(!result.raw.includes(secret), 'synthetic sensitive data must not be recorded');
  const keys = new Set(['schema', 'seq', 'threadId', 'utc', 'monoNs', 'event', 'generation', 'runnerId',
    'kind', 'sourceSha256', 'version', 'versionOrigin', 'hashScope', 'decisionId', 'workerDecisionId',
    'code', 'node', 'tsx', 'toolchainOverride', 'runnerSha256', 'callId', 'beforeUtc', 'beforeNs', 'afterUtc', 'afterNs',
    'outcome', 'generations', 'decisions', 'calls']);
  for (const record of result.records) for (const key of Object.keys(record)) assert.ok(keys.has(key), `unexpected field: ${key}`);
});

test('all tracked protected stock bytes match git HEAD by SHA-256 (plus tracked files outside G3 unchanged)', t => {
  const roots = ['example/agents/runtime', 'sdk', 'lib', 'core', 'example/agents/lib'];
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...roots], { cwd: root })
    .toString().split('\0').filter(Boolean);
  assert.ok(paths.length > 100);
  for (const path of paths) {
    assert.equal(sha(readFileSync(join(root, path))), sha(execFileSync('git', ['show', `HEAD:${path}`], { cwd: root })), path);
  }
  assert.equal(execFileSync('git', ['diff', 'HEAD', '--name-only', '--', '.', ':(exclude)ascon-notes/league/g3/**'], { cwd: root, encoding: 'utf8' }), '');
  t.diagnostic(`SHA-256 checked ${paths.length} tracked stock files; root lib/ ${existsSync(join(root, 'lib')) ? 'present' : 'absent; example/agents/lib/ included'}`);
});
