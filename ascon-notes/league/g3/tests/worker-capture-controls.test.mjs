import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { auditWorkerCapture } from '../loader/worker-capture-audit.mjs';
import { hashActionIdentity } from '../loader/worker-action-identity.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const loader = fileURLToPath(new URL('../loader/', import.meta.url));
const fixture = join(loader, 'run-fixtures.mjs');
const url = name => new URL(`../loader/${name}`, import.meta.url).href;
// The measurement loader uses Node registerHooks, including when Bun runs this test file.
// Keep the tested child runtime as Node rather than accidentally launching Bun children.
const nodeProbe = process.versions.bun
  ? spawnSync('node', ['-e', 'console.log(JSON.stringify({ execPath: process.execPath, version: process.version, release: process.release.name, bun: process.versions.bun ?? null }))'], { encoding: 'utf8' })
  : null;
if (nodeProbe && nodeProbe.status !== 0) throw new Error('Node runtime unavailable for measurement controls');
const nodeRuntime = nodeProbe ? JSON.parse(nodeProbe.stdout) : {
  execPath: process.execPath, version: process.version, release: process.release.name, bun: process.versions.bun ?? null,
};
if (nodeRuntime.release !== 'node' || nodeRuntime.bun || nodeRuntime.version !== 'v24.13.0')
  throw new Error(`Pinned measurement Node mismatch: ${JSON.stringify(nodeRuntime)}`);
const nodeBinary = nodeRuntime.execPath;
const tsxEnv = { G3_PROBE_EXPECT_NODE: 'v24.13.0', G3_PROBE_EXPECT_TSX: '4.23.13' };

function runFixture({ duplicateHook = false, mode = 'normal', preload = url('worker-capture-preload.mjs'), extraEnv = {} } = {}) {
  const dir = mkdtempSync(join(loader, '.worker-capture-test-'));
  const parentPath = join(dir, 'parent.jsonl');
  const workerPath = join(dir, 'worker.jsonl');
  try {
    const args = ['--import', 'tsx', '--import', url('offline-guard.mjs'), '--import', url('probe-loader.mjs'),
      '--import', preload];
    if (duplicateHook) args.push('--import', `${url('worker-capture-preload.mjs')}?second-registration`);
    args.push(fixture, mode);
    const child = spawnSync(nodeBinary, args, { cwd: root, encoding: 'utf8', timeout: 90000,
      maxBuffer: 4e6, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        ...tsxEnv, G3_TEST_WITH_PROBE: '1', G3_PROBE_JSONL: parentPath,
        G3_WORKER_CAPTURE_JSONL: workerPath, ...extraEnv } });
    return { ...child, parent: readJsonl(parentPath), worker: readJsonl(workerPath), workerPath };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function readJsonl(path) {
  try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch { return []; }
}
function runReadControl() {
  const dir = mkdtempSync(join(loader, '.worker-read-test-'));
  const workerPath = join(dir, 'worker.jsonl');
  const driverPath = join(dir, 'read-driver.mjs');
  const strategyRunnerPath = new URL('../../../../example/agents/runtime/strategyRunner.ts', import.meta.url).href;
  const script = `
    import { StrategyRunner } from ${JSON.stringify(strategyRunnerPath)};
    const source = { kind: 'executor', source: 'return await ctx.publicClient.getBlockNumber();' };
    const context = { agentId: 'SYNTHETIC_AGENT', address: 'SYNTHETIC_ADDRESS',
      rpcUrl: 'https://SYNTHETIC_RPC.invalid', config: { chainId: 31337 } };
    const runner = new StrategyRunner(source, context, () => {}, 1200, 5000);
    try { await runner.decide({ round: 1 }); } catch (error) { console.log(JSON.stringify({ caught: error.name, code: error.code ?? null })); }
    await runner.close();
  `;
  try {
    writeFileSync(driverPath, script);
    const child = spawnSync(nodeBinary, ['--import', 'tsx', '--import', url('offline-guard.mjs'),
      '--import', url('worker-capture-preload.mjs'), driverPath],
    { cwd: root, encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR, G3_WORKER_CAPTURE_JSONL: workerPath } });
    return { ...child, summary: child.stdout, worker: readJsonl(workerPath) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function runLateSubmitControl(body = `const action = { type: 'noop', reason: 'late-submit-control' };
    let pending = Promise.resolve();
    for (let i = 0; i < 40; i++) pending = pending.then(() => undefined);
    pending.then(() => ctx.submit(action));
    return null;`) {
  const dir = mkdtempSync(join(loader, '.worker-late-submit-test-'));
  const parentPath = join(dir, 'parent.jsonl');
  const workerPath = join(dir, 'worker.jsonl');
  const driverPath = join(dir, 'late-submit-driver.mjs');
  const strategyRunnerPath = new URL('../../../../example/agents/runtime/strategyRunner.ts', import.meta.url).href;
  const probeUrl = url('probe-loader.mjs');
  const script = `
    import { StrategyRunner } from ${JSON.stringify(strategyRunnerPath)};
    const probe = await import(${JSON.stringify(probeUrl)});
    const source = probe.bindSourceVersion({ kind: 'executor', source: ${JSON.stringify(body)} }, 1);
    const context = { agentId: 'SYNTHETIC_AGENT', address: 'SYNTHETIC_ADDRESS',
      rpcUrl: 'https://SYNTHETIC_RPC.invalid', config: { chainId: 31337 } };
    const runner = new StrategyRunner(source, context, () => {}, 1200, 5000);
    await runner.decide({ round: 1 });
    await runner.close();
    probe.finishProbe();
  `;
  try {
    writeFileSync(driverPath, script);
    const child = spawnSync(nodeBinary, ['--import', 'tsx', '--import', url('offline-guard.mjs'),
      '--import', probeUrl, '--import', url('worker-capture-preload.mjs'), driverPath],
    { cwd: root, encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR, ...tsxEnv, G3_PROBE_JSONL: parentPath,
      G3_WORKER_CAPTURE_JSONL: workerPath } });
    return { ...child, parent: readJsonl(parentPath), worker: readJsonl(workerPath) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function runAccessorSubmitControl() {
  const dir = mkdtempSync(join(loader, '.worker-accessor-test-'));
  const parentPath = join(dir, 'parent.jsonl');
  const workerPath = join(dir, 'worker.jsonl');
  const modulePath = join(dir, 'accessor-strategy.mjs');
  const driverPath = join(dir, 'accessor-driver.mjs');
  const strategyRunnerPath = new URL('../../../../example/agents/runtime/strategyRunner.ts', import.meta.url).href;
  const probeUrl = url('probe-loader.mjs');
  writeFileSync(modulePath, `export async function decide(_observation, ctx) {
    const action = {};
    Object.defineProperty(action, 'payload', { enumerable: true, get() { return 'cloned-value'; } });
    ctx.submit(action);
    return null;
  }`);
  const script = `
    import { StrategyRunner } from ${JSON.stringify(strategyRunnerPath)};
    const probe = await import(${JSON.stringify(probeUrl)});
    const source = probe.bindSourceVersion({ kind: 'module', path: ${JSON.stringify(modulePath)} }, 1);
    const context = { agentId: 'SYNTHETIC_AGENT', address: 'SYNTHETIC_ADDRESS',
      rpcUrl: 'https://SYNTHETIC_RPC.invalid', config: { chainId: 31337 } };
    const runner = new StrategyRunner(source, context, () => {}, 1200, 5000);
    await runner.decide({ round: 1 });
    await runner.close();
    probe.finishProbe();
  `;
  try {
    writeFileSync(driverPath, script);
    const child = spawnSync(nodeBinary, ['--import', 'tsx', '--import', url('offline-guard.mjs'),
      '--import', probeUrl, '--import', url('worker-capture-preload.mjs'), driverPath],
    { cwd: root, encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR, ...tsxEnv, G3_PROBE_JSONL: parentPath,
      G3_WORKER_CAPTURE_JSONL: workerPath } });
    return { ...child, parent: readJsonl(parentPath), worker: readJsonl(workerPath) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function runConcurrentCallbackControl() {
  const dir = mkdtempSync(join(loader, '.worker-concurrent-test-'));
  const workerPath = join(dir, 'worker.jsonl');
  const driverPath = join(dir, 'concurrent-driver.mjs');
  const strategyWorkerPath = new URL('../../../../example/agents/runtime/strategyWorker.mjs', import.meta.url).href;
  const script = `
    import { Worker } from 'node:worker_threads';
    const source = { kind: 'executor', source: 'return await ctx.publicClient.getBlockNumber();' };
    const context = { agentId: 'SYNTHETIC_AGENT', address: 'SYNTHETIC_ADDRESS',
      rpcUrl: 'https://SYNTHETIC_RPC.invalid', config: { chainId: 31337 } };
    const worker = new Worker(new URL(${JSON.stringify(strategyWorkerPath)}), { workerData: { source, context },
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        G3_WORKER_CAPTURE_JSONL: process.env.G3_WORKER_CAPTURE_JSONL } });
    const terminal = new Promise(resolve => {
      const seen = new Set();
      worker.on('message', message => {
        if (message.type === 'ready') return;
        if (message.type === 'result' || message.type === 'error') {
          seen.add(message.id);
          if (seen.size === 2) resolve();
        }
      });
    });
    await new Promise((resolve, reject) => {
      worker.once('message', message => message.type === 'ready' ? resolve() : reject(Error('worker not ready')));
      worker.once('error', reject);
    });
    worker.postMessage({ id: 101, observation: { round: 1 } });
    worker.postMessage({ id: 102, observation: { round: 2 } });
    await terminal;
    await worker.terminate();
  `;
  try {
    writeFileSync(driverPath, script);
    const child = spawnSync(nodeBinary, ['--import', 'tsx', '--import', url('offline-guard.mjs'),
      '--import', url('worker-capture-preload.mjs'), driverPath], { cwd: root, encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        G3_WORKER_CAPTURE_JSONL: workerPath } });
    return { ...child, worker: readJsonl(workerPath) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function runProxySemanticsControl() {
  const dir = mkdtempSync(join(loader, '.worker-proxy-test-'));
  const workerPath = join(dir, 'worker.jsonl');
  const driverPath = join(dir, 'proxy-driver.mjs');
  const preload = url('worker-capture-preload.mjs');
  const script = `
    import assert from 'node:assert/strict';
    await import(${JSON.stringify(preload)});
    const state = globalThis[Symbol.for('g3.workerCapture.state')];
    let getterCalls = 0, resolveLate;
    const label = { identity: true };
    const client = { marker: 'stock-this', label,
      who() { return this === client; },
      identify() { return this; },
      pass(value) { return value; },
      later() { return new Promise(resolve => { resolveLate = resolve; }); },
      immediate() { return Promise.resolve('ok'); },
      inspect() { return Promise.resolve('ok'); } };
    const first = { state, decisionId: 11, workerDecisionId: 101, readId: 0, readOrdinal: 0 };
    const second = { state, decisionId: 12, workerDecisionId: 102, readId: 0, readOrdinal: 0 };
    const a = state.captureClient(client, first);
    const b = state.captureClient(client, second);
    assert.equal(a.who, a.who, 'repeated method access must preserve wrapper identity');
    assert.equal(a.who(), client.who());
    assert.equal(a.identify(), client);
    const customThis = {};
    assert.equal(a.identify.call(customThis), customThis);
    let thenCalls = 0;
    const lazyThenable = { then(resolve) { thenCalls++; resolve('observed'); } };
    assert.equal(a.pass(lazyThenable), lazyThenable);
    assert.equal(thenCalls, 0);
    assert.equal(a.label, label);
    const late = a.later();
    await b.immediate();
    const args = {};
    Object.defineProperty(args, 'secret', { enumerable: true, get() { getterCalls++; return 'value'; } });
    Object.defineProperty(args, 'toJSON', { value() { getterCalls++; return {}; } });
    await b.inspect(args);
    resolveLate('late');
    await late;
    await Promise.resolve();
    assert.equal(getterCalls, 0);
  `;
  try {
    writeFileSync(driverPath, script);
    const child = spawnSync(nodeBinary, ['--unhandled-rejections=warn', '--import', url('worker-capture-preload.mjs'), driverPath],
      { cwd: root, encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR, G3_WORKER_CAPTURE_JSONL: workerPath } });
    return { ...child, worker: readJsonl(workerPath) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function runNonTargetWorkerControl() {
  const dir = mkdtempSync(join(loader, '.worker-nontarget-test-'));
  const workerPath = join(dir, 'worker.jsonl');
  const driverPath = join(dir, 'nontarget-driver.mjs');
  const script = `
    import { Worker } from 'node:worker_threads';
    const worker = new Worker(new URL('data:text/javascript,import { parentPort } from "node:worker_threads"; parentPort.postMessage("started")'), { type: 'module' });
    const message = await new Promise((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
    });
    const code = await new Promise(resolve => worker.once('exit', resolve));
    console.log(JSON.stringify({ message, code }));
  `;
  try {
    writeFileSync(driverPath, script);
    const child = spawnSync(nodeBinary, ['--import', url('worker-capture-preload.mjs'), driverPath],
      { cwd: root, encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR, G3_WORKER_CAPTURE_JSONL: workerPath } });
    return { ...child };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function controlInput() {
  const parentRecords = [
      { event: 'worker_create', generation: 1 },
      { event: 'worker_post', generation: 1, workerDecisionId: 7, decisionId: 3 },
      { event: 'worker_submit', generation: 1, workerDecisionId: 7, decisionId: 3, submitOrdinal: 1, actionSha256: 'a'.repeat(64) },
      { event: 'worker_result', generation: 1, workerDecisionId: 7, decisionId: 3 },
      { event: 'decide_exit', generation: 1, decisionId: 3 },
    ].map((row, i) => ({ ...row, seq: i + 1, threadId: 0 }));
  parentRecords.push(
    { event: 'capture_parent_ready', seq: 1, threadId: 100 },
    { event: 'parent_generation', seq: 2, threadId: 100, generation: 1 },
    { event: 'worker_submit_identity', seq: 3, threadId: 100, generation: 1, workerDecisionId: 7,
      submitOrdinal: 1, actionSha256: 'a'.repeat(64) },
    { event: 'capture_summary', seq: 4, threadId: 100, recordCount: 3, gap: false },
  );
  const workerRecords = [
      { event: 'capture_hook_applied', seq: 1, generation: 1, stockSha256: '11a625f89c254766df314460cf501783753442161e2a3db2d96fad0098c7ed79' },
      { event: 'callback_entry', seq: 2, generation: 1, workerDecisionId: 7 },
      { event: 'read_call', seq: 3, generation: 1, workerDecisionId: 7, readId: 1 },
      { event: 'read_resolve', seq: 4, generation: 1, workerDecisionId: 7, readId: 1 },
      { event: 'submit_attempt', seq: 5, generation: 1, workerDecisionId: 7,
        submitOrdinal: 1, actionSha256: 'a'.repeat(64), active: true },
      { event: 'result_before_post', seq: 6, generation: 1, workerDecisionId: 7, submitCount: 1 },
      { event: 'callback_finally', seq: 7, generation: 1, workerDecisionId: 7 },
    ].map(row => ({ ...row, threadId: 1 }));
  workerRecords.push({ event: 'capture_summary', seq: 8, threadId: 1, generation: 1, recordCount: 7, gap: false });
  return { schema: 1, provenance: 'SYNTHETIC', expectedGenerations: [1], parentRecords, workerRecords };
}
function reindexParentCapture(input) {
  const rows = input.parentRecords.filter(row => row.threadId === 100 && row.event !== 'capture_summary');
  input.parentRecords = input.parentRecords.filter(row => row.threadId !== 100);
  rows.forEach((row, i) => { row.seq = i + 1; });
  input.parentRecords.push(...rows, { event: 'capture_summary', seq: rows.length + 1, threadId: 100,
    recordCount: rows.length, gap: false });
}
const audit = input => auditWorkerCapture(input);

test('end-to-end fixture: raw parent submit receipts join real worker capture on synthetic input', () => {
  const workerSource = join(root, 'example/agents/runtime/strategyWorker.ts');
  const beforeSha = createHash('sha256').update(readFileSync(workerSource)).digest('hex');
  const run = runFixture({ mode: 'multi-submit' });
  const afterSha = createHash('sha256').update(readFileSync(workerSource)).digest('hex');
  assert.equal(afterSha, beforeSha, 'stock strategyWorker.ts bytes must remain unchanged around control run');
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.parent.some(row => row.event === 'worker_post'));
  assert.ok(run.worker.some(row => row.event === 'callback_entry'));
  assert.ok(run.worker.some(row => row.event === 'submit_attempt'));
  assert.ok(run.worker.some(row => row.event === 'result_before_post'));
  assert.ok(run.worker.some(row => row.event === 'callback_finally'));
  const rawSubmits = run.parent.filter(row => row.event === 'worker_submit');
  assert.equal(rawSubmits.length, 2);
  assert.equal(rawSubmits[0].workerDecisionId, rawSubmits[1].workerDecisionId);
  assert.deepEqual(rawSubmits.map(row => row.submitOrdinal), [1, 2]);
  assert.ok(rawSubmits.every(row => Number.isSafeInteger(row.submitOrdinal) &&
    /^[0-9a-f]{64}$/.test(row.actionSha256)));
  const captureSubmits = run.worker.filter(row => row.threadId === 0 && row.event === 'worker_submit_identity');
  const identityKey = row => `${row.generation}/${row.workerDecisionId}/${row.submitOrdinal}/${row.actionSha256}`;
  assert.deepEqual(rawSubmits.map(identityKey).sort(), captureSubmits.map(identityKey).sort());
  const parentRecords = [...run.parent, ...run.worker.filter(row => row.threadId === 0 &&
    ['capture_parent_ready', 'parent_generation', 'capture_gap', 'worker_submit_identity', 'capture_summary'].includes(row.event))];
  const expectedGenerations = [...new Set(run.parent.filter(row => row.event === 'worker_create').map(row => row.generation))];
  const result = audit({ schema: 1, provenance: 'SYNTHETIC', expectedGenerations,
    parentRecords, workerRecords: run.worker });
  assert.equal(result.g3Status, 'BLOCKED');
  assert.equal(result.liveRecorderVerified, false);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result));
});

test('positive control: preload remains inert in a non-target worker', () => {
  const run = runNonTargetWorkerControl();
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { message: 'started', code: 0 });
});

test('negative control: delete one worker record line blocks the join', () => {
  const input = controlInput();
  input.workerRecords.splice(0, 1);
  assert.equal(audit(input).reason, 'worker_sequence_gap');
  const callbackGap = controlInput();
  callbackGap.workerRecords.splice(1, 1);
  assert.equal(audit(callbackGap).verdict, 'BLOCKED');
});

test('negative control: alter the worker decision identity contradicts the parent post', () => {
  const input = controlInput();
  input.workerRecords[1].workerDecisionId = 8;
  assert.equal(audit(input).verdict, 'FAIL');
});

test('negative control: a submit after callback finally fails as late activity', () => {
  const input = controlInput();
  const late = { event: 'submit_attempt', threadId: 1, generation: 1, workerDecisionId: 7, decisionId: 3,
    submitOrdinal: 2, actionSha256: 'b'.repeat(64), active: false };
  input.workerRecords.splice(input.workerRecords.length - 1, 0, late);
  input.workerRecords.forEach((row, i) => { row.seq = i + 1; });
  input.workerRecords.at(-1).recordCount = input.workerRecords.length - 1;
  input.workerRecords.find(row => row.event === 'result_before_post').submitCount = 1;
  assert.equal(audit(input).verdict, 'FAIL');
  assert.equal(audit(input).reason, 'callback_activity_after_terminal');
});

test('negative control: real worker callback submit after finally fails the audit', () => {
  const run = runLateSubmitControl();
  assert.equal(run.status, 0, run.stderr);
  const attemptIndex = run.worker.findIndex(row => row.event === 'submit_attempt');
  const finallyIndex = run.worker.findIndex(row => row.event === 'callback_finally');
  const terminal = run.worker.find(row => row.event === 'result_before_post');
  assert.ok(attemptIndex > finallyIndex, 'real deferred callback submit must occur after finally');
  assert.equal(run.worker[attemptIndex].active, false);
  assert.equal(terminal.submitCount, 0);
  const parentRecords = [...run.parent, ...run.worker.filter(row => row.threadId === 0 &&
    ['capture_parent_ready', 'parent_generation', 'capture_gap', 'worker_submit_identity', 'capture_summary'].includes(row.event))];
  const expectedGenerations = [...new Set(run.parent.filter(row => row.event === 'worker_create').map(row => row.generation))];
  const result = audit({ schema: 1, provenance: 'SYNTHETIC', expectedGenerations,
    parentRecords, workerRecords: run.worker });
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.reason, 'callback_activity_after_terminal');
});

test('negative control: accessor action hashes are unsupported across structured clone', () => {
  const trace = runAccessorSubmitControl();
  assert.equal(trace.status, 0, trace.stderr);
  const attempt = trace.worker.find(row => row.event === 'submit_attempt' && row.active === true);
  const identity = trace.worker.find(row => row.event === 'worker_submit_identity');
  assert.equal(attempt.actionSha256, null, JSON.stringify(attempt));
  assert.equal(typeof identity.actionSha256, 'string', JSON.stringify(identity));
  const input = controlInput();
  input.workerRecords.find(row => row.event === 'submit_attempt').actionSha256 = null;
  input.parentRecords.find(row => row.event === 'worker_submit_identity').actionSha256 = identity.actionSha256;
  assert.equal(audit(input).verdict, 'BLOCKED');
  assert.equal(audit(input).reason, 'submit_action_hash_unsupported');
});

test('negative control: unrecorded submit disposition claims block', () => {
  const input = controlInput();
  input.workerRecords[4].claimedDisposition = 'discarded';
  assert.equal(audit(input).reason, 'submit_disposition_claim_unsupported');
});

test('negative control: enumerable array properties cannot be omitted from action identity', () => {
  const action = ['noop'];
  action.extra = 'not part of indexed payload';
  assert.equal(hashActionIdentity(action), null);
  const symbolAction = ['noop'];
  Object.defineProperty(symbolAction, Symbol('extra'), { value: 'untracked', enumerable: true });
  assert.equal(hashActionIdentity(symbolAction), null);
});

test('negative control: termination after gap arm leaves a gap summary', () => {
  const name = `.worker-capture-preload-termination-${process.pid}.mjs`;
  const path = join(loader, name);
  const original = readFileSync(fileURLToPath(url('worker-capture-preload.mjs')), 'utf8');
  const marker = "Atomics.store(state.stats, 1, 1);\n  }\n  try {\n    const row =";
  const injected = original.replace(marker, "Atomics.store(state.stats, 1, 1);\n    if (process.env.G3_TEST_TERMINATE_AFTER_GAP_ARM === '1') process.exit(0);\n  }\n  try {\n    const row =");
  assert.notEqual(injected, original, 'termination injection point must remain unique');
  try {
    writeFileSync(path, injected);
    const run = runFixture({ preload: url(name), extraEnv: { G3_TEST_TERMINATE_AFTER_GAP_ARM: '1' } });
    const summaries = run.worker.filter(row => row.event === 'capture_summary');
    assert.ok(summaries.some(row => row.threadId === 1 && row.generation === 1 && row.gap === true), JSON.stringify(summaries));
    assert.ok(!summaries.some(row => row.threadId === 1 && row.generation === 1 && row.gap === false), JSON.stringify(summaries));
  } finally { rmSync(path, { force: true }); }
});

test('negative control: double hook is caught in the fixture child before decisions run', () => {
  const run = runFixture({ duplicateHook: true });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /G3_WORKER_CAPTURE_DOUBLE_HOOK/);
  assert.ok(run.worker.some(row => row.event === 'capture_gap' && row.reason === 'double_hook'));
});

test('negative control: digest mismatch evidence is BLOCKED and never promoted', () => {
  const input = controlInput();
  input.parentRecords.push({ event: 'capture_gap', reason: 'stock_digest_mismatch' });
  assert.equal(audit(input).verdict, 'BLOCKED');
});

test('negative control: reordered worker records block on a sequence gap', () => {
  const input = controlInput();
  input.workerRecords[3].seq = 1;
  assert.equal(audit(input).verdict, 'BLOCKED');
});

test('negative control: parent order check blocks when parent seq is not an integer', () => {
  const missing = controlInput();
  delete missing.parentRecords.find(row => row.event === 'decide_exit').seq;
  assert.equal(audit(missing).verdict, 'BLOCKED');
});

test('negative control: parent worker_post after decide_exit fails', () => {
  const postAfterDecision = controlInput();
  postAfterDecision.parentRecords.find(row => row.event === 'worker_post').seq = 7;
  assert.equal(audit(postAfterDecision).verdict, 'FAIL');
});

test('negative control: parent terminal after decide_exit fails', () => {
  const terminalAfterDecision = controlInput();
  terminalAfterDecision.parentRecords.find(row => row.event === 'worker_result').seq = 7;
  assert.equal(audit(terminalAfterDecision).verdict, 'FAIL');
});

test('negative control: deleting a middle worker record is detected by sequence continuity', () => {
  const middle = controlInput();
  middle.workerRecords.splice(3, 1);
  assert.equal(audit(middle).reason, 'worker_sequence_gap');
});

test('negative control: deleting the last callback record is detected against summary', () => {
  const last = controlInput();
  last.workerRecords.splice(last.workerRecords.findIndex(row => row.event === 'callback_finally'), 1);
  assert.equal(audit(last).verdict, 'BLOCKED');
});

test('negative control: simulated write failure is carried by the final summary', () => {
  const failedWrite = controlInput();
  failedWrite.workerRecords.at(-1).gap = true;
  assert.equal(audit(failedWrite).verdict, 'BLOCKED');
});

test('negative control: deleting both records of a read pair still leaves a sequence gap', () => {
  const input = controlInput();
  input.workerRecords.splice(2, 2);
  assert.equal(audit(input).reason, 'worker_sequence_gap');
});

test('negative control: phantom generation without create and hook cannot pass', () => {
  const input = controlInput();
  input.parentRecords.push(
    { event: 'worker_post', seq: 8, threadId: 0, generation: 2, workerDecisionId: 8, decisionId: 4 },
    { event: 'worker_result', seq: 9, threadId: 0, generation: 2, workerDecisionId: 8, decisionId: 4 },
    { event: 'decide_exit', seq: 10, threadId: 0, decisionId: 4 },
  );
  input.workerRecords.push(
    { event: 'callback_entry', seq: 1, threadId: 2, generation: 2, workerDecisionId: 8 },
    { event: 'result_before_post', seq: 2, threadId: 2, generation: 2, workerDecisionId: 8, submitCount: 0 },
    { event: 'callback_finally', seq: 3, threadId: 2, generation: 2, workerDecisionId: 8 },
    { event: 'capture_summary', seq: 4, threadId: 2, generation: 2, recordCount: 3, gap: false },
  );
  assert.notEqual(audit(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

test('negative control: independent parent generation set catches a phantom record', () => {
  const input = controlInput();
  input.parentRecords.push({ event: 'parent_disposition', generation: 2, disposition: 'discarded' });
  assert.notEqual(audit(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

test('negative control: hook must belong to the callback worker thread', () => {
  const input = controlInput();
  const hook = input.workerRecords[0];
  const callbackRows = input.workerRecords.slice(1, -1);
  callbackRows.forEach((row, i) => { row.threadId = 2; row.seq = i + 1; });
  callbackRows.push({ event: 'capture_summary', seq: callbackRows.length + 1, threadId: 2,
    generation: 1, recordCount: callbackRows.length, gap: false });
  input.workerRecords = [hook, { event: 'capture_summary', seq: 2, threadId: 1,
    generation: 1, recordCount: 1, gap: false }, ...callbackRows];
  assert.notEqual(audit(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

test('negative control: terminal submit count detects deletion of attempts and receipts', () => {
  const input = controlInput();
  input.workerRecords.splice(input.workerRecords.findIndex(row => row.event === 'submit_attempt'), 1);
  input.parentRecords.splice(input.parentRecords.findIndex(row => row.event === 'worker_submit'), 1);
  input.parentRecords.splice(input.parentRecords.findIndex(row => row.event === 'worker_submit_identity'), 1);
  input.workerRecords.forEach((row, i) => { row.seq = i + 1; });
  input.workerRecords.at(-1).recordCount = input.workerRecords.length - 1;
  assert.notEqual(audit(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

test('negative control: worker submit receipt requires hash and ordinal', () => {
  for (const field of ['actionSha256', 'submitOrdinal']) {
    const input = controlInput();
    delete input.parentRecords.find(row => row.event === 'worker_submit')[field];
    delete input.parentRecords.find(row => row.event === 'worker_submit_identity')[field];
    assert.equal(audit(input).reason, 'worker_submit_identity_missing', field);
  }
});

test('negative control: probe receipt identity fields cannot be omitted', () => {
  for (const field of ['actionSha256', 'submitOrdinal']) {
    const input = controlInput();
    delete input.parentRecords.find(row => row.event === 'worker_submit')[field];
    assert.equal(audit(input).verdict, 'BLOCKED', field);
  }
});

test('negative control: submit attempts require an explicit boolean active state', () => {
  for (const value of [undefined, 'false', 0, null]) {
    const input = controlInput();
    if (value === undefined) delete input.workerRecords.find(row => row.event === 'submit_attempt').active;
    else input.workerRecords.find(row => row.event === 'submit_attempt').active = value;
    assert.equal(audit(input).verdict, 'BLOCKED', String(value));
  }
});

test('negative control: an inactive submit attempt before terminal fails', () => {
  const input = controlInput();
  input.workerRecords.splice(5, 0, { event: 'submit_attempt', seq: 6, threadId: 1,
    generation: 1, workerDecisionId: 7, decisionId: 3, submitOrdinal: 2, actionSha256: 'b'.repeat(64), active: false });
  input.workerRecords.forEach((row, i) => { row.seq = i + 1; });
  input.workerRecords.at(-1).recordCount = input.workerRecords.length - 1;
  input.workerRecords.find(row => row.event === 'result_before_post').submitCount = 2;
  assert.equal(audit(input).verdict, 'FAIL');
});

test('negative control: swapped parent submit receipts cannot match by array position', () => {
  const input = controlInput();
  const attempt = input.workerRecords.find(row => row.event === 'submit_attempt');
  const identity = input.parentRecords.find(row => row.event === 'worker_submit_identity');
  const receipt = input.parentRecords.find(row => row.event === 'worker_submit');
  attempt.submitOrdinal = 2; attempt.actionSha256 = 'b'.repeat(64);
  identity.submitOrdinal = 2; identity.actionSha256 = 'b'.repeat(64);
  receipt.submitOrdinal = 2; receipt.actionSha256 = 'b'.repeat(64);
  const secondIdentity = { ...identity, submitOrdinal: 1, actionSha256: 'a'.repeat(64), seq: 4 };
  const secondReceipt = { ...receipt, submitOrdinal: 1, actionSha256: 'a'.repeat(64), seq: 6 };
  input.parentRecords.splice(input.parentRecords.indexOf(identity) + 1, 0, secondIdentity);
  input.parentRecords.splice(input.parentRecords.indexOf(receipt) + 1, 0, secondReceipt);
  reindexParentCapture(input);
  assert.equal(audit(input).verdict, 'FAIL');
});

test('positive control: reordered parent submit receipts match by identity multiset', () => {
  const input = controlInput();
  const originalAttempt = input.workerRecords.find(row => row.event === 'submit_attempt');
  const secondAttempt = { ...originalAttempt, submitOrdinal: 2 };
  input.workerRecords.splice(input.workerRecords.findIndex(row => row.event === 'result_before_post'), 0, secondAttempt);
  input.workerRecords.find(row => row.event === 'result_before_post').submitCount = 2;
  input.workerRecords.forEach((row, i) => { row.seq = i + 1; });
  input.workerRecords.at(-1).recordCount = input.workerRecords.length - 1;

  const receipt = input.parentRecords.find(row => row.event === 'worker_submit');
  const secondReceipt = { ...receipt, submitOrdinal: 2, seq: 4 };
  receipt.seq = 3;
  input.parentRecords.splice(input.parentRecords.indexOf(receipt) + 1, 0, secondReceipt);
  const exit = input.parentRecords.find(row => row.event === 'decide_exit'); exit.seq = 6;
  input.parentRecords.find(row => row.event === 'worker_result').seq = 5;
  input.parentRecords.reverse();
  // Restore the capture rows as a valid stream and put the raw receipts in reverse array order.
  input.parentRecords.reverse();
  const identity = input.parentRecords.find(row => row.event === 'worker_submit_identity');
  const secondIdentity = { ...identity, submitOrdinal: 2, seq: 4 };
  identity.seq = 3;
  input.parentRecords.splice(input.parentRecords.indexOf(identity) + 1, 0, secondIdentity);
  const summary = input.parentRecords.find(row => row.event === 'capture_summary');
  summary.seq = 5; summary.recordCount = 4;
  const firstIndex = input.parentRecords.indexOf(receipt);
  const secondIndex = input.parentRecords.indexOf(secondReceipt);
  input.parentRecords[firstIndex] = secondReceipt;
  input.parentRecords[secondIndex] = receipt;
  assert.equal(audit(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

test('negative control: parent capture stream requires contiguous sequence and final summary', () => {
  const gap = controlInput();
  gap.parentRecords.find(row => row.event === 'worker_submit_identity').seq = 5;
  assert.notEqual(audit(gap).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  const missing = controlInput();
  missing.parentRecords = missing.parentRecords.filter(row => row.event !== 'capture_summary');
  assert.notEqual(audit(missing).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

test('negative control: an inactive attempt with an extra parent receipt fails', () => {
  const input = controlInput();
  input.workerRecords.splice(5, 0, { event: 'submit_attempt', seq: 6, threadId: 1,
    generation: 1, workerDecisionId: 7, active: false });
  input.workerRecords.find(row => row.event === 'result_before_post').submitCount = 2;
  input.workerRecords.forEach((row, i) => { row.seq = i + 1; });
  input.workerRecords.at(-1).recordCount = input.workerRecords.length - 1;
  input.parentRecords.push({ event: 'worker_submit', seq: 7, threadId: 0, generation: 1,
    workerDecisionId: 7, decisionId: 3 });
  input.parentRecords.find(row => row.event === 'decide_exit').seq = 8;
  assert.equal(audit(input).verdict, 'FAIL');
});

test('negative control: real stock digest mismatch is explicit and blocked', () => {
  const input = controlInput();
  input.workerRecords[0].stockSha256 = '0'.repeat(64);
  assert.equal(audit(input).verdict, 'BLOCKED');
});

test('negative control: missing worker hook digest blocks', () => {
  const input = controlInput();
  delete input.workerRecords[0].stockSha256;
  assert.equal(audit(input).reason, 'worker_hook_digest_missing_or_mismatched');
});

test('negative controls: callback causal stages cannot be reordered while seq stays monotonic', () => {
  for (const [name, mutate] of [
    ['entry after read', rows => { rows.find(r => r.event === 'callback_entry').seq = 4; rows.find(r => r.event === 'read_call').seq = 2; rows.find(r => r.event === 'read_resolve').seq = 3; }],
    ['read after terminal', rows => { rows.find(r => r.event === 'result_before_post').seq = 3; rows.find(r => r.event === 'read_call').seq = 5; rows.find(r => r.event === 'read_resolve').seq = 6; }],
    ['submit after terminal', rows => { rows.find(r => r.event === 'result_before_post').seq = 4; rows.find(r => r.event === 'submit_attempt').seq = 5; }],
    ['finally before terminal', rows => { rows.find(r => r.event === 'callback_finally').seq = 6; rows.find(r => r.event === 'result_before_post').seq = 7; }],
  ]) {
    const input = controlInput();
    mutate(input.workerRecords);
    input.workerRecords.sort((a, b) => a.seq - b.seq);
    input.workerRecords.forEach((row, i) => { row.seq = i + 1; });
    input.workerRecords.at(-1).seq = input.workerRecords.length;
    input.workerRecords.at(-1).recordCount = input.workerRecords.length - 1;
    assert.notEqual(audit(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC', name);
  }
});

test('negative control: equal submit counts with a different action identity fail', () => {
  const input = controlInput();
  Object.assign(input.workerRecords.find(r => r.event === 'submit_attempt'),
    { submitOrdinal: 1, actionSha256: 'a'.repeat(64) });
  Object.assign(input.parentRecords.find(r => r.event === 'worker_submit'),
    { submitOrdinal: 1, actionSha256: 'b'.repeat(64) });
  assert.equal(audit(input).verdict, 'FAIL');
});

test('negative control: monotonic duplicate read terminal reaches duplicate guard', () => {
  const input = controlInput();
  input.workerRecords.splice(4, 0, { ...input.workerRecords[3], seq: 5 });
  input.workerRecords.forEach((row, i) => { row.seq = i + 1; });
  input.workerRecords.at(-1).recordCount = input.workerRecords.length - 1;
  assert.equal(audit(input).reason, 'read_terminal_gap_or_duplicate');
});

test('negative control: a parent submit receipt without an observed worker hook is BLOCKED', () => {
  const run = runFixture();
  assert.equal(run.status, 0, run.stderr);
  const expectedGenerations = [...new Set(run.worker.filter(row => row.threadId === 0 && row.event === 'parent_generation')
    .map(row => row.generation))];
  const noHook = run.worker.map(row => row.event === 'capture_hook_applied'
    ? { ...row, event: 'capture_worker_ready' } : row);
  const result = audit({ schema: 1, provenance: 'SYNTHETIC', expectedGenerations,
    parentRecords: [...run.parent, ...run.worker.filter(row => row.threadId === 0 &&
      ['capture_parent_ready', 'parent_generation', 'capture_gap', 'worker_submit_identity', 'capture_summary'].includes(row.event))],
    workerRecords: noHook });
  assert.equal(result.reason, 'worker_hook_not_observed');
});

test('positive control: concurrent worker callbacks retain isolated identities', () => {
  const run = runConcurrentCallbackControl();
  assert.equal(run.status, 0, run.stderr);
  const callbacks = run.worker.filter(row => row.event === 'callback_entry');
  assert.equal(callbacks.length, 2, run.worker.map(row => row.event).join(','));
  assert.notEqual(callbacks[0].workerDecisionId, callbacks[1].workerDecisionId);
  for (const callback of callbacks) {
    const reads = run.worker.filter(row => row.event === 'read_call' && row.workerDecisionId === callback.workerDecisionId);
    const terminals = run.worker.filter(row => ['read_reject', 'read_error'].includes(row.event) &&
      row.workerDecisionId === callback.workerDecisionId);
    assert.equal(reads.length, 1, JSON.stringify(run.worker));
    assert.equal(terminals.length, 1, JSON.stringify(run.worker));
  }
  const workerRecords = run.worker.filter(row => row.threadId !== 0);
  const captureRows = run.worker.filter(row => row.threadId === 0 &&
    ['capture_parent_ready', 'parent_generation', 'worker_submit_identity', 'capture_summary'].includes(row.event))
    .map(row => ({ ...row, threadId: 100 }));
  const captureSummary = captureRows.find(row => row.event === 'capture_summary');
  const captureBody = captureRows.filter(row => row !== captureSummary);
  captureBody.forEach((row, i) => { row.seq = i + 1; });
  captureRows.splice(0, captureRows.length, ...captureBody,
    { event: 'capture_summary', threadId: 100, seq: captureBody.length + 1,
      recordCount: captureBody.length, gap: false });
  const parentRecords = [...captureRows, { event: 'worker_create', generation: 1, threadId: 0, seq: 1 }];
  let seq = 2;
  callbacks.forEach((callback, i) => {
    const decisionId = i + 1;
    parentRecords.push({ event: 'worker_post', generation: callback.generation,
      workerDecisionId: callback.workerDecisionId, decisionId, threadId: 0, seq: seq++ });
    const terminal = workerRecords.find(row => row.generation === callback.generation &&
      row.workerDecisionId === callback.workerDecisionId && ['result_before_post', 'error_before_post'].includes(row.event));
    parentRecords.push({ event: terminal.event === 'result_before_post' ? 'worker_result' : 'worker_error',
      generation: callback.generation, workerDecisionId: callback.workerDecisionId, decisionId, threadId: 0, seq: seq++ });
    parentRecords.push({ event: 'decide_exit', generation: callback.generation, decisionId, threadId: 0, seq: seq++ });
  });
  const result = audit({ schema: 1, provenance: 'SYNTHETIC', expectedGenerations: [1], parentRecords, workerRecords });
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result));
});

test('negative control: a modified expected stock digest aborts preload on actual byte mismatch', () => {
  const dir = mkdtempSync(join(loader, '.worker-digest-test-'));
  const preloadPath = join(loader, `.worker-capture-preload-digest-control-${process.pid}-${Date.now()}.mjs`);
  const workerPath = join(dir, 'worker.jsonl');
  const original = readFileSync(fileURLToPath(url('worker-capture-preload.mjs')), 'utf8');
  try {
    writeFileSync(preloadPath, original.replace("const PINNED = '11a625f89c254766df314460cf501783753442161e2a3db2d96fad0098c7ed79';",
      `const PINNED = '${'0'.repeat(64)}';`));
    const child = spawnSync(nodeBinary, ['--import', preloadPath, '-e', ''], { cwd: root, encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, G3_WORKER_CAPTURE_JSONL: workerPath } });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /G3_WORKER_CAPTURE_DIGEST_MISMATCH/);
    assert.ok(readJsonl(workerPath).some(row => row.event === 'capture_gap' && row.reason === 'stock_digest_mismatch'));
  } finally { rmSync(preloadPath, { force: true }); rmSync(dir, { recursive: true, force: true }); }
});

test('negative control: duplicated read terminal is detected', () => {
  const missingCall = controlInput();
  missingCall.workerRecords.splice(2, 1);
  assert.equal(audit(missingCall).reason, 'worker_sequence_gap');
  const input = controlInput();
  input.workerRecords.splice(4, 0, { ...input.workerRecords[3], seq: 4 });
  assert.equal(audit(input).verdict, 'BLOCKED');
});

test('negative control: unsupported worker capture event blocks the synthetic contract', () => {
  for (const event of ['unknown_fake_event', undefined]) {
    const input = controlInput();
    const summary = input.workerRecords.at(-1);
    input.workerRecords.splice(-1, 0, { event, seq: summary.seq, threadId: summary.threadId, generation: 1 });
    input.workerRecords.forEach((row, index) => { row.seq = index + 1; });
    summary.recordCount += 1;
    const result = audit(input);
    assert.equal(result.verdict, 'BLOCKED', String(event));
    assert.equal(result.reason, 'worker_event_unrecognized', String(event));
  }
});

test('positive control: synthetic parent worker error event stays recognized', () => {
  const input = controlInput();
  input.parentRecords.push({ event: 'worker_error_event', seq: 6, threadId: 0, generation: 1 });
  const result = audit(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result));
  assert.equal(result.g3Status, 'BLOCKED');
  assert.equal(result.liveRecorderVerified, false);
});

test('negative control: unsupported parent event blocks the synthetic contract', () => {
  for (const event of ['unknown_fake_event', undefined]) {
    const input = controlInput();
    input.parentRecords.push({ event, seq: 6, threadId: 0, generation: 1 });
    const result = audit(input);
    assert.equal(result.verdict, 'BLOCKED', String(event));
    assert.equal(result.reason, 'parent_event_unrecognized', String(event));
  }
});

test('positive control: clean synthetic run is quiet and remains explicitly unverified', () => {
  const result = audit(controlInput());
  assert.deepEqual(result, { verdict: 'CONTRACT_OK_ON_SYNTHETIC', g3Status: 'BLOCKED',
    liveRecorderVerified: false, generations: 1, joinedDecisions: 1, diagnostics: [],
    limitations: [
      'submit_action_sha256_is_bounded_summary_not_full_serialization',
      'accessor_action_hash_is_unsupported_and_blocks',
      'worker_return_sha256_is_not_joined_to_parent_result_or_delivery',
      'native_promise_rejection_observer_suppresses_unhandled_rejection',
      'measurement_timing_and_live_equivalence_are_unproven',
    ] });
});

test('negative control: undefined decision IDs cannot join parent rows', () => {
  const input = controlInput();
  for (const row of input.parentRecords) {
    if (['worker_post', 'worker_submit', 'worker_result', 'decide_exit'].includes(row.event)) delete row.decisionId;
  }
  assert.equal(audit(input).reason, 'parent_decision_identity_missing');
});

test('negative control: undefined parent worker decision ID is rejected before joins', () => {
  const input = controlInput();
  delete input.parentRecords.find(row => row.event === 'worker_post').workerDecisionId;
  assert.equal(audit(input).reason, 'parent_worker_identity_missing');
});

test('negative control: undefined callback worker decision ID cannot join', () => {
  const input = controlInput();
  delete input.workerRecords.find(row => row.event === 'callback_entry').workerDecisionId;
  assert.equal(audit(input).reason, 'worker_decision_identity_missing');
});

test('negative control: orphan parent submit and terminal rows fail without a worker post', () => {
  for (const event of ['worker_submit', 'worker_submit_identity', 'worker_result', 'worker_error']) {
    const input = controlInput();
    const row = { event, generation: 1, workerDecisionId: 999, decisionId: 3 };
    if (event === 'worker_submit' || event === 'worker_submit_identity')
      Object.assign(row, { submitOrdinal: 1, actionSha256: 'b'.repeat(64) });
    if (event === 'worker_submit_identity') {
      Object.assign(row, { threadId: 100 });
      input.parentRecords.splice(-1, 0, row);
      reindexParentCapture(input);
    } else {
      Object.assign(row, { seq: 6, threadId: 0 });
      input.parentRecords.push(row);
    }
    const result = audit(input);
    assert.equal(result.verdict, 'FAIL', event);
    assert.equal(result.reason, 'parent_event_without_worker_post', event);
  }
});

test('negative control: missing decisionId on parent receipt and terminal rows is BLOCKED', () => {
  for (const event of ['worker_submit', 'worker_result', 'worker_error']) {
    const input = controlInput();
    let row;
    if (event === 'worker_error') {
      row = input.parentRecords.find(record => record.event === 'worker_result');
      row.event = 'worker_error';
      input.workerRecords.find(record => record.event === 'result_before_post').event = 'error_before_post';
    } else row = input.parentRecords.find(record => record.event === event);
    delete row.decisionId;
    const result = audit(input);
    assert.equal(result.verdict, 'BLOCKED', event);
    assert.equal(result.reason, 'parent_decision_identity_missing', event);
  }
});

test('negative control: missing generation or worker decision IDs on joined rows are BLOCKED', () => {
  for (const event of ['worker_submit', 'worker_submit_identity', 'worker_result', 'worker_error']) {
    const input = controlInput();
    const eventRow = input.parentRecords.find(record => record.event === (event === 'worker_error' ? 'worker_result' : event));
    if (event === 'worker_error') {
      eventRow.event = event;
      input.workerRecords.find(record => record.event === 'result_before_post').event = 'error_before_post';
    }
    delete eventRow.generation;
    assert.equal(audit(input).reason, 'parent_worker_identity_missing', `${event} generation`);
    const second = controlInput();
    const secondRow = second.parentRecords.find(record => record.event === (event === 'worker_error' ? 'worker_result' : event));
    if (event === 'worker_error') {
      secondRow.event = event;
      second.workerRecords.find(record => record.event === 'result_before_post').event = 'error_before_post';
    }
    delete secondRow.workerDecisionId;
    assert.equal(audit(second).reason, 'parent_worker_identity_missing', `${event} workerDecisionId`);
  }
  for (const event of ['callback_finally', 'read_call', 'submit_attempt', 'result_before_post']) {
    const input = controlInput();
    delete input.workerRecords.find(record => record.event === event).workerDecisionId;
    assert.equal(audit(input).reason, 'worker_decision_identity_missing', `${event} workerDecisionId`);
  }
});

test('positive control: synthetic read call and completion stay individually paired', () => {
  const result = audit(controlInput());
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC');
  const input = controlInput();
  input.workerRecords[3].event = 'read_reject';
  assert.equal(audit(input).verdict, 'CONTRACT_OK_ON_SYNTHETIC');
});

test('positive control: read-client proxy records a guarded read call and rejection', () => {
  const run = runReadControl();
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.worker.some(row => row.event === 'read_call'), `${run.worker.map(row => row.event).join(',')};${run.summary}`);
  assert.ok(run.worker.some(row => row.event === 'read_reject' || row.event === 'read_error'));
  const input = controlInput();
  const actualPair = run.worker.filter(row => ['read_call', 'read_resolve', 'read_reject', 'read_error'].includes(row.event))
    .map(row => ({ ...row, generation: 1, workerDecisionId: 7, readId: 1, threadId: 1 }));
  input.workerRecords = input.workerRecords.filter(row => !['read_call', 'read_resolve', 'read_reject', 'read_error'].includes(row.event));
  input.workerRecords.splice(2, 0, ...actualPair);
  input.workerRecords.forEach((row, i) => { row.seq = i + 1; });
  input.workerRecords.at(-1).seq = input.workerRecords.length;
  input.workerRecords.at(-1).recordCount = input.workerRecords.length - 1;
  const result = audit(input);
  assert.equal(result.verdict, 'CONTRACT_OK_ON_SYNTHETIC', JSON.stringify(result));
});

test('negative control: append failure writes a gap and the final summary preserves gap=true', () => {
  const dir = mkdtempSync(join(loader, '.worker-gap-test-'));
  const workerPath = join(dir, 'worker.jsonl');
  const script = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.appendFileSync;
    let first = true;
    fs.appendFileSync = (...args) => { if (first) { first = false; throw Error('synthetic write failure'); } return original(...args); };
    syncBuiltinESMExports();
    await import(${JSON.stringify(url('worker-capture-preload.mjs'))});
  `;
  try {
    const child = spawnSync(nodeBinary, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, G3_WORKER_CAPTURE_JSONL: workerPath } });
    assert.equal(child.status, 0, child.stderr);
    const rows = readJsonl(workerPath);
    assert.ok(rows.some(row => row.event === 'capture_gap' && row.reason === 'append_failure'));
    assert.equal(rows.at(-1)?.event, 'capture_summary');
    assert.equal(rows.at(-1)?.gap, true);
    assert.equal(audit({ schema: 1, provenance: 'SYNTHETIC', expectedGenerations: [],
      parentRecords: [{ event: 'parent_generation', generation: 0 }], workerRecords: rows }).verdict, 'BLOCKED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('negative control: sink under stock/runtime or protected source trees is refused', () => {
  for (const sink of [join(root, 'example/.capture-forbidden.jsonl'), join(root, 'example/agents/.capture-forbidden.jsonl'), join(root, 'runtime/.capture-forbidden.jsonl'),
    join(root, 'sdk/.capture-forbidden.jsonl'), join(root, 'lib/.capture-forbidden.jsonl'), join(root, 'core/.capture-forbidden.jsonl')]) {
    const child = spawnSync(nodeBinary, ['--import', url('worker-capture-preload.mjs'), '-e', ''], { cwd: root,
      encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        G3_WORKER_CAPTURE_JSONL: sink } });
    assert.notEqual(child.status, 0, sink);
    assert.match(child.stderr, /G3_WORKER_CAPTURE_SINK_FORBIDDEN/);
  }
});

test('negative control: dangling sink symlink into a protected tree is refused without creating it', () => {
  const dir = mkdtempSync(join(loader, '.worker-capture-symlink-test-'));
  const fakeRepo = join(dir, 'fake-repo');
  const target = join(fakeRepo, 'example', `missing-${process.pid}`, 'sink.jsonl');
  const symlink = join(dir, 'sink.jsonl');
  const preloadPath = join(dir, 'worker-capture-preload.mjs');
  try {
    const original = readFileSync(fileURLToPath(url('worker-capture-preload.mjs')), 'utf8');
    const identityHelper = readFileSync(fileURLToPath(url('worker-action-identity.mjs')), 'utf8');
    const patched = original.replace("const repoRoot = resolve(dirname(stockPath), '../../..');",
      `const repoRoot = ${JSON.stringify(fakeRepo)};`);
    assert.notEqual(patched, original, 'fake protected root anchor must remain unique');
    writeFileSync(preloadPath, patched);
    writeFileSync(join(dir, 'worker-action-identity.mjs'), identityHelper);
    mkdirSync(fakeRepo, { recursive: true });
    symlinkSync(target, symlink);
    const child = spawnSync(nodeBinary, ['--import', preloadPath, '-e', ''], { cwd: root,
      encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        G3_WORKER_CAPTURE_JSONL: symlink } });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /G3_WORKER_CAPTURE_SINK_FORBIDDEN/);
    assert.equal(existsSync(target), false);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(target, { force: true }); }
});

test('positive control: read proxy keeps receiver and properties, binds late reads, and skips getters', () => {
  const run = runProxySemanticsControl();
  assert.equal(run.status, 0, run.stderr);
  const aCall = run.worker.find(row => row.event === 'read_call' && row.method === 'later');
  const aResolve = run.worker.find(row => row.event === 'read_resolve' && row.readId === aCall?.readId &&
    row.threadId === aCall?.threadId && row.workerDecisionId === aCall?.workerDecisionId);
  const bCall = run.worker.find(row => row.event === 'read_call' && row.method === 'immediate');
  assert.equal(aCall.workerDecisionId, 101);
  assert.equal(aResolve.workerDecisionId, 101);
  assert.equal(bCall.workerDecisionId, 102);
  assert.ok(run.worker.some(row => row.event === 'capture_summary' && row.recordCount > 0));
});

test('control: the recorder Promise observer changes unhandledRejection handled-ness', () => {
  const script = `
    const events = [];
    process.on('unhandledRejection', reason => events.push(reason.message));
    Promise.reject(new Error('plain'));
    await new Promise(resolve => setTimeout(resolve, 20));
    const plain = events.slice(); events.length = 0;
    const observed = Promise.reject(new Error('observed'));
    Promise.prototype.then.call(observed, value => value, () => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    console.log(JSON.stringify({ plain, observed: events }));
  `;
  const child = spawnSync(nodeBinary, ['--unhandled-rejections=warn', '--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { plain: ['plain'], observed: [] });
});

test('positive control: submit join uses real preload identity fields without parent decisionId', () => {
  const input=controlInput();
  delete input.workerRecords.find(r=>r.event==='submit_attempt').decisionId;
  delete input.parentRecords.find(r=>r.event==='worker_submit_identity').decisionId;
  assert.equal(audit(input).verdict,'CONTRACT_OK_ON_SYNTHETIC');
});
test('negative control: parent submit receipt after decision exit fails', () => {
  const input=controlInput();
  input.parentRecords.find(r=>r.event==='worker_submit').seq=6;
  assert.equal(audit(input).verdict,'FAIL');
});
test('negative control: empty callback terminal before entry fails', () => {
  const input=controlInput();
  input.workerRecords=input.workerRecords.filter(r=>!['read_call','read_resolve','submit_attempt'].includes(r.event));
  const entry=input.workerRecords.find(r=>r.event==='callback_entry');
  const terminal=input.workerRecords.find(r=>r.event==='result_before_post');
  input.workerRecords.splice(input.workerRecords.indexOf(entry),1);
  input.workerRecords.splice(input.workerRecords.indexOf(terminal)+1,0,entry);
  terminal.submitCount=0;
  input.workerRecords.forEach((r,i)=>r.seq=i+1);input.workerRecords.at(-1).recordCount=input.workerRecords.length-1;
  input.parentRecords=input.parentRecords.filter(r=>!['worker_submit','worker_submit_identity'].includes(r.event));
  reindexParentCapture(input);
  assert.equal(audit(input).verdict,'FAIL');
});
test('termination control: final summary counts a record written before worker termination', () => {
  const dir=mkdtempSync(join(loader,'.worker-termination-test-'));
  const workerPath=join(dir,'worker.jsonl');
  const copyPath=join(loader,`.worker-termination-preload-${process.pid}.mjs`);
  const driverPath=join(dir,'driver.mjs');
  const stockUrl=new URL('../../../../example/agents/runtime/strategyWorker.mjs',import.meta.url).href;
  try {
    const original=readFileSync(join(loader,'worker-capture-preload.mjs'),'utf8');
    const needle='appendFileSync(state.path, `${JSON.stringify(row)}\\n`, { encoding: \'utf8\', flag: \'a\' });';
    assert.equal(original.split(needle).length-1,1);
    writeFileSync(copyPath,original.replace(needle,needle+`
    if (state.stats && event === 'callback_entry') {
      threads.parentPort.postMessage({ type: 'g3-test-pause' });
      Atomics.wait(state.stats, 1, 0, 5000);
    }`));
    writeFileSync(driverPath,`import { Worker } from 'node:worker_threads';
      const worker=new Worker(new URL(${JSON.stringify(stockUrl)}),{workerData:{source:{kind:'executor',source:'return null;'},context:{agentId:'SYNTHETIC_AGENT',address:'SYNTHETIC_ADDRESS',rpcUrl:'https://SYNTHETIC_RPC.invalid',config:{chainId:31337}}}});
      await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',m=>{if(m.type==='ready')worker.postMessage({id:1,observation:{round:1}});if(m.type==='g3-test-pause')worker.terminate().then(resolve,reject);});});`);
    const child=spawnSync(nodeBinary,['--import','tsx','--import',url('offline-guard.mjs'),'--import',copyPath,driverPath],{cwd:root,encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,HOME:process.env.HOME,G3_WORKER_CAPTURE_JSONL:workerPath}});
    assert.equal(child.status,0,child.stderr);
    const rows=readJsonl(workerPath);const entry=rows.find(r=>r.event==='callback_entry');assert.ok(entry);
    const summary=rows.find(r=>r.event==='capture_summary'&&r.threadId===entry.threadId);assert.ok(summary);
    assert.equal(summary.recordCount,entry.seq,'written callback_entry must be included even if terminated before emit returns');
    assert.equal(summary.seq,entry.seq+1);
  } finally { rmSync(copyPath,{force:true});rmSync(dir,{recursive:true,force:true}); }
});

test('negative control: malformed record rows block without throwing', () => {
  for (const field of ['parentRecords','workerRecords']) {
    const input=controlInput();input[field].push(null);
    const result=audit(input);assert.equal(result.verdict,'BLOCKED');
    assert.equal(result.reason,'record_shape_invalid');
  }
});
