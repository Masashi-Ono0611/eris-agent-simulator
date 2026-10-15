import threads, { isMainThread, workerData } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeWriter, probeError } from './probe-io.mjs';
import { probeToolchain } from './probe-toolchain.mjs';
import { hashActionIdentity } from './worker-action-identity.mjs';

const registration = Symbol.for('g3.offline.probe.registration');
if (globalThis[registration]) throw probeError('G3_DOUBLE_REGISTRATION');
globalThis[registration] = true;
const toolchain = probeToolchain();
if (!toolchain.toolchainOverride && (toolchain.node !== toolchain.expectedNode || toolchain.tsx !== toolchain.expectedTsx)) {
  throw probeError('G3_TOOLCHAIN_MISMATCH');
}

// An opt-in changes expectations, never disables the exact-version guard.
if (toolchain.toolchainOverride && (toolchain.node !== toolchain.expectedNode || toolchain.tsx !== toolchain.expectedTsx)) {
  throw probeError('G3_TOOLCHAIN_MISMATCH');
}

export let bindSourceVersion;
export let finishProbe;

if (!isMainThread) {
  const meta = workerData?.__g3OfflineProbe;
  if (!meta) throw probeError('G3_WORKER_METADATA_MISSING');
  const write = makeWriter(meta.path, meta.shared);
  write('worker_attach', { generation: meta.generation });
  // Publish only AFTER the registration record has been written successfully.
  Atomics.store(new Int32Array(meta.attached), 0, 1);
} else {
  const path = process.env.G3_PROBE_JSONL;
  if (!path) throw probeError('G3_SINK_MISSING');
  const shared = new SharedArrayBuffer(8);
  const write = makeWriter(path, shared);
  const scope = new AsyncLocalStorage();
  const versions = new WeakMap();
  const runners = new WeakMap();
  const generations = [];
  let runnerCount = 0, decisionCount = 0, callCount = 0, openCalls = 0;
  let failure;
  let finished = false;
  let StockRunner;
  const workerURL = new URL('../../../../example/agents/runtime/strategyWorker.mjs', import.meta.url).href;
  const runnerURL = pathToFileURL(realpathSync(fileURLToPath(
    new URL('../../../../example/agents/runtime/strategyRunner.ts', import.meta.url),
  ))).href;
  const hash = value => createHash('sha256').update(value).digest('hex');
  const fail = (code, fields = {}) => {
    failure ??= code;
    process.exitCode = 1;
    write('guard', { code, ...fields });
    throw probeError(code);
  };
  const healthy = () => {
    if (Atomics.load(new Int32Array(shared), 1)) {
      process.exitCode = 1;
      throw probeError('G3_WRITE_FAILED');
    }
    if (failure) throw probeError(failure);
    if (finished) fail('G3_ALREADY_FINISHED');
  };
  bindSourceVersion = (source, version) => {
    healthy();
    if (!Number.isSafeInteger(version) || version < 0) fail('G3_VERSION_INVALID');
    // Fixture-owned version, NOT botMain's closure state. Hash is never a version.
    versions.set(source, version);
    return source;
  };
  const describe = source => {
    if (!versions.has(source)) fail('G3_VERSION_UNBOUND');
    let bytes;
    if (source.kind === 'executor') bytes = source.source;
    else if (source.kind === 'module') bytes = readFileSync(source.path);
    else fail('G3_SOURCE_UNSUPPORTED');
    return { kind: source.kind, sourceSha256: hash(bytes), version: versions.get(source),
      versionOrigin: 'fixture-explicit', hashScope: source.kind === 'module' ? 'entry-bytes-only' : 'executor-body' };
  };
  const state = runner => {
    healthy();
    if (Object.getPrototypeOf(runner) !== StockRunner.prototype) fail('G3_WRONG_INSTANCE');
    let value = runners.get(runner);
    if (!value) {
      value = { runnerId: ++runnerCount };
      runners.set(runner, value);
      write('runner_seen', { ...value, ...describe(runner.source) });
    }
    return value;
  };
  const verifyAttachment = generation => {
    healthy();
    if (Atomics.load(new Int32Array(generation.attached), 0) !== 1) {
      fail('G3_WORKER_GAP', { generation: generation.id });
    }
  };

  const OriginalWorker = threads.Worker;
  threads.Worker = class ProbeWorker extends OriginalWorker {
    constructor(filename, options) {
      if (String(filename) !== workerURL) {
        super(filename, options);
        return;
      }
      const active = scope.getStore();
      if (!active?.spawning || !runners.has(active.runner)) fail('G3_WRONG_INSTANCE');
      healthy();
      const generation = { id: generations.length + 1, attached: new SharedArrayBuffer(4), exited: false };
      const fields = { generation: generation.id, runnerId: active.runnerId, ...describe(options.workerData.source) };
      const meta = { path, shared, attached: generation.attached, generation: generation.id };
      super(filename, { ...options, workerData: { ...options.workerData, __g3OfflineProbe: meta } });
      generations.push(generation);
      write('worker_create', fields);
      const decisions = new Map();
      const submitOrdinals = new Map();
      const post = this.postMessage;
      this.postMessage = function (...args) {
        healthy();
        const decisionId = scope.getStore()?.decisionId;
        if (!Number.isSafeInteger(decisionId)) fail('G3_DECISION_UNBOUND');
        const workerDecisionId = args[0].id;
        decisions.set(workerDecisionId, decisionId);
        write('worker_post', { ...fields, decisionId, workerDecisionId });
        return Reflect.apply(post, this, args);
      };
      // Observe receipt only. Stock listeners alone decide acceptance/timeout/submit buffering.
      this.on('message', message => {
        verifyAttachment(generation);
        const type = ['ready', 'result', 'submit', 'log', 'error'].includes(message.type) ? message.type : 'unknown';
        const identity = type === 'ready' ? {} : {
          workerDecisionId: message.id, decisionId: decisions.get(message.id) ?? null,
        };
        if (type === 'submit') {
          const submitOrdinal = (submitOrdinals.get(message.id) ?? 0) + 1;
          submitOrdinals.set(message.id, submitOrdinal);
          write('worker_submit', { ...fields, ...identity, submitOrdinal,
            actionSha256: hashActionIdentity(message.action) });
        } else write(`worker_${type}`, { ...fields, ...identity });
      });
      this.on('error', () => { write('worker_error_event', fields); });
      this.on('exit', code => {
        generation.exited = true;
        write('worker_exit', { ...fields, code });
        verifyAttachment(generation);
      });
    }
  };
  syncBuiltinESMExports();
  ({ StrategyRunner: StockRunner } = await import(runnerURL));
  write('probe_registered', { node: toolchain.node, tsx: toolchain.tsx,
    toolchainOverride: toolchain.toolchainOverride,
    runnerSha256: hash(readFileSync(fileURLToPath(runnerURL))) });

  const prototype = StockRunner.prototype;
  const originalSpawn = prototype.spawn;
  prototype.spawn = function (...args) {
    const identity = state(this);
    return scope.run({ ...scope.getStore(), ...identity, runner: this, spawning: true },
      () => Reflect.apply(originalSpawn, this, args));
  };
  const originalSetSource = prototype.setSource;
  prototype.setSource = function (...args) {
    const identity = state(this);
    const source = describe(args[0]);
    const callId = ++callCount;
    write('setSource_enter', { ...identity, ...source, callId });
    // Capture clocks immediately around the original synchronous invocation.
    const beforeUtc = new Date().toISOString(), beforeNs = process.hrtime.bigint().toString();
    let value, thrown, didThrow = false;
    try { value = Reflect.apply(originalSetSource, this, args); }
    catch (error) { didThrow = true; thrown = error; }
    const afterNs = process.hrtime.bigint().toString(), afterUtc = new Date().toISOString();
    write('setSource_exit', { ...identity, ...source, callId, beforeUtc, beforeNs, afterUtc, afterNs,
      outcome: didThrow ? 'throw' : 'return' });
    if (didThrow) throw thrown;
    return value;
  };
  for (const method of ['start', 'decide', 'close']) {
    const original = prototype[method];
    prototype[method] = function (...args) {
      const identity = state(this);
      const decisionId = method === 'decide' ? ++decisionCount : scope.getStore()?.decisionId ?? null;
      const fields = { ...identity, ...describe(this.source), callId: ++callCount, decisionId };
      write(`${method}_enter`, fields);
      openCalls++;
      return scope.run({ ...identity, runner: this, decisionId }, async () => {
        let result, thrown, didThrow = false;
        try { result = await Reflect.apply(original, this, args); }
        catch (error) { didThrow = true; thrown = error; }
        openCalls--;
        healthy();
        write(`${method}_exit`, { ...fields, outcome: didThrow ? 'throw' : 'return' });
        if (didThrow) throw thrown;
        return result;
      });
    };
  }
  finishProbe = () => {
    healthy();
    if (openCalls || generations.some(g => !g.exited)) fail('G3_INCOMPLETE');
    for (const generation of generations) verifyAttachment(generation);
    write('probe_complete', { generations: generations.length, decisions: decisionCount, calls: callCount });
    finished = true;
  };
}
