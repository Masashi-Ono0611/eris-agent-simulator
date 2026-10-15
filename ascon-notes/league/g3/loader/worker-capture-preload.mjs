import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, lstatSync, realpathSync } from 'node:fs';
import { types as utilTypes } from 'node:util';
import { isMainThread, workerData, threadId } from 'node:worker_threads';
import threads from 'node:worker_threads';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';
import { hashActionIdentity } from './worker-action-identity.mjs';

const stockUrl = new URL('../../../../example/agents/runtime/strategyWorker.ts', import.meta.url);
const stockPath = fileURLToPath(stockUrl);
const workerModulePath = resolve(dirname(stockPath), 'strategyWorker.mjs');
const repoRoot = resolve(dirname(stockPath), '../../..');
const PINNED = '11a625f89c254766df314460cf501783753442161e2a3db2d96fad0098c7ed79';
const hash = value => createHash('sha256').update(value).digest('hex');
const hashValue = hashActionIdentity;
const stateKey = Symbol.for('g3.workerCapture.state');
const validCaptureMeta = meta => Boolean(meta && typeof meta.path === 'string' && meta.path.length > 0 &&
  Number.isSafeInteger(meta.generation) && meta.generation > 0 &&
  typeof SharedArrayBuffer !== 'undefined' && meta.stats instanceof SharedArrayBuffer && meta.stats.byteLength >= 8);
const inactiveNonTargetWorker = !isMainThread && !validCaptureMeta(workerData?.__g3WorkerCapture);
if (!inactiveNonTargetWorker) {
if (globalThis[stateKey] && !globalThis[stateKey].inert) {
  const prior = globalThis[stateKey];
  prior.emit?.(prior, 'capture_gap', { reason: 'double_hook' });
  throw new Error('G3_WORKER_CAPTURE_DOUBLE_HOOK');
}

let parentState;
if (isMainThread) {
  const configuredPath = process.env.G3_WORKER_CAPTURE_JSONL;
  if (!configuredPath) throw new Error('G3_WORKER_CAPTURE_SINK_MISSING');
  const requestedPath = resolve(configuredPath);
  let existingParent = requestedPath;
  const missingParts = [];
  while (true) {
    try {
      try {
        if (lstatSync(existingParent).isSymbolicLink()) throw new Error('G3_WORKER_CAPTURE_SINK_FORBIDDEN');
      } catch (error) {
        if (error?.message === 'G3_WORKER_CAPTURE_SINK_FORBIDDEN') throw error;
        if (error?.code !== 'ENOENT') throw error;
      }
      const canonicalParent = realpathSync(existingParent);
      const path = resolve(canonicalParent, ...missingParts.reverse());
      const canonicalRepoRoot = realpathSync(repoRoot);
      const forbiddenRoots = ['example', 'runtime', 'sdk', 'lib', 'core']
        .map(value => resolve(canonicalRepoRoot, value));
      if (forbiddenRoots.some(root => {
        const rel = relative(root, path);
        return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
      })) throw new Error('G3_WORKER_CAPTURE_SINK_FORBIDDEN');
      parentState = { path, seq: 0, generation: null, gap: false };
      break;
    } catch (error) {
      if (error?.message === 'G3_WORKER_CAPTURE_SINK_FORBIDDEN') throw error;
      const parent = dirname(existingParent);
      if (parent === existingParent) throw new Error('G3_WORKER_CAPTURE_SINK_RESOLVE_FAILED');
      missingParts.push(basename(existingParent));
      existingParent = parent;
    }
  }
  const path = parentState.path;
  globalThis[stateKey] = parentState;
  const OriginalWorker = threads.Worker;
  threads.Worker = class CaptureWorker extends OriginalWorker {
    constructor(filename, options = {}) {
      let candidate = String(filename);
      try { if (candidate.startsWith('file:')) candidate = fileURLToPath(candidate); }
      catch { candidate = ''; }
      candidate = candidate.replaceAll('\\', '/');
      const target = candidate !== '' && resolve(candidate) === workerModulePath;
      if (!target) { super(filename, options); return; }
      const generation = ++parentState.generation;
      const stats = new SharedArrayBuffer(8);
      const prior = options.workerData ?? {};
      super(filename, { ...options, workerData: { ...prior,
        __g3WorkerCapture: { path, generation, stats } } });
      const workerThreadId = this.threadId;
      const submitOrdinals = new Map();
      this.on('message', message => {
        if (message?.type !== 'submit') return;
        const ordinal = (submitOrdinals.get(message.id) ?? 0) + 1;
        submitOrdinals.set(message.id, ordinal);
        emit(parentState, 'worker_submit_identity', { generation, workerDecisionId: message.id,
          submitOrdinal: ordinal, actionSha256: hashValue(message.action) });
      });
      this.once('exit', () => {
        const counters = new Int32Array(stats);
        const recordCount = Atomics.load(counters, 0);
        const summary = { schema: 1, event: 'capture_summary', seq: recordCount + 1, threadId: workerThreadId,
          generation, recordCount, gap: Atomics.load(counters, 1) !== 0,
          utc: new Date().toISOString(), monoNs: process.hrtime.bigint().toString() };
        try { appendFileSync(path, `${JSON.stringify(summary)}\n`, { encoding: 'utf8', flag: 'a' }); }
        catch { /* No summary is itself detected as BLOCKED by the audit. */ }
      });
      emit(parentState, 'parent_generation', { generation });
    }
  };
  syncBuiltinESMExports();
  // Node workers inherit --import arguments. The private workerData marker identifies the
  // stock worker without changing its message protocol. It changes workerData: __g3WorkerCapture
  // carries the sink path and shared counters.
} else {
  const meta = workerData?.__g3WorkerCapture;
  if (!validCaptureMeta(meta)) parentState = { inert: true };
  else parentState = { ...meta, seq: 0, gap: false, stats: new Int32Array(meta.stats) };
  globalThis[stateKey] = parentState;
}

function emit(state, event, fields = {}) {
  if (state.inert) return null;
  if (state.stats) {
    // Arm before allocating the row or advancing sequence: termination during any
    // part of this write attempt must leave the parent a fail-closed summary.
    Atomics.store(state.stats, 1, 1);
  }
  try {
    const row = { schema: 1, event, seq: ++state.seq, threadId, generation: state.generation ?? null,
      utc: new Date().toISOString(), monoNs: process.hrtime.bigint().toString(), ...fields };
    // Reserve the sequence before append. A worker can be terminated immediately after
    // a successful write; the parent exit summary must not duplicate that written seq.
    // A reservation without a completed write instead leaves a detectable gap.
    if (state.stats) Atomics.store(state.stats, 0, state.seq);
    appendFileSync(state.path, `${JSON.stringify(row)}\n`, { encoding: 'utf8', flag: 'a' });
    if (state.stats && !state.gap) Atomics.store(state.stats, 1, 0);
    return row.seq;
  } catch {
    state.gap = true;
    if (state.stats) Atomics.store(state.stats, 1, 1);
    try {
      const gap = { schema: 1, event: 'capture_gap', seq: ++state.seq, threadId,
        generation: state.generation ?? null, reason: 'append_failure', utc: new Date().toISOString(),
        monoNs: process.hrtime.bigint().toString() };
      if (state.stats) Atomics.store(state.stats, 0, state.seq);
      appendFileSync(state.path, `${JSON.stringify(gap)}\n`, { encoding: 'utf8', flag: 'a' });
    } catch { /* gap state and summary remain the fallback if the sink stays unavailable */ }
    return null;
  }
}

function emitSummary(state) {
  const recordCount = state.seq;
  emit(state, 'capture_summary', { recordCount, gap: state.gap, generation: state.generation ?? null });
}

function safeCall(context, method, args, target, thisArg) {
  const state = context.state;
  const readId = ++context.readId;
  const argsDigest = hashValue(args);
  emit(state, 'read_call', { decisionId: context.decisionId, workerDecisionId: context.workerDecisionId,
    readId, ordinal: context.readOrdinal++, method, argsSha256: argsDigest });
  let result;
  try { result = Reflect.apply(target, thisArg, args); }
  catch (error) {
    emit(state, 'read_error', { decisionId: context.decisionId, workerDecisionId: context.workerDecisionId,
      readId, errorName: error instanceof Error ? 'Error' : 'Other' });
    throw error;
  }
  const settle = (kind, value) => emit(state, kind, { decisionId: context.decisionId,
    workerDecisionId: context.workerDecisionId, readId, resultType: value === null ? 'null' : typeof value });
  if (utilTypes.isPromise(result)) {
    // Keep and return the original Promise object; the observer does not replace it.
    Promise.prototype.then.call(result, value => settle('read_resolve', value), () => settle('read_reject', null));
  } else settle('read_resolve', result);
  return result;
}

const wrapperCache = new WeakMap();
function captureClient(client, context) {
  let contexts = wrapperCache.get(client);
  if (!contexts) { contexts = new WeakMap(); wrapperCache.set(client, contexts); }
  let properties = contexts.get(context);
  if (!properties) { properties = new Map(); contexts.set(context, properties); }
  let proxy;
  proxy = new Proxy(client, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (typeof value !== 'function') return value;
    if (properties.has(property) && properties.get(property).target === value) return properties.get(property).wrapper;
    const wrapper = function (...args) {
      const thisArg = this === proxy ? target : this;
      return safeCall(context, String(property), args, value, thisArg);
    };
    properties.set(property, { target: value, wrapper });
    return wrapper;
  } });
  return proxy;
}
parentState.emit = emit;
parentState.hash = hash;
parentState.hashValue = hashValue;
parentState.captureClient = captureClient;
if (isMainThread) process.once('exit', () => emitSummary(parentState));

const transformations = [
  ['const reads = readOnlyClient(publicClient);', 'const reads = readOnlyClient(publicClient);'],
  ['port.on("message", async ({ id, observation }: StrategyRequest) => {', 'port.on("message", async ({ id, observation }: StrategyRequest) => {\n  const __g3 = globalThis[Symbol.for("g3.workerCapture.state")];\n  const __g3Context = { state: __g3, workerDecisionId: id, readId: 0, readOrdinal: 0, submitOrdinal: 0 };\n  __g3.emit(__g3, "callback_entry", { workerDecisionId: id });'],
  ['  const ctx: AgentContext = {', '  const ctx: AgentContext = {'],
  ['    publicClient: reads,', '    publicClient: __g3.captureClient(reads, __g3Context),'],
  ['submit(action) {\n      if (active) post({ type: "submit", id, action });', 'submit(action) {\n      const submitOrdinal = ++__g3Context.submitOrdinal;\n      __g3.emit(__g3, "submit_attempt", { workerDecisionId: id, submitOrdinal, active, actionType: action === null ? "null" : typeof action, actionSha256: __g3.hashValue(action) });\n      if (active) post({ type: "submit", id, action });'],
  ['post({ type: "result", id, action });', '__g3.emit(__g3, "result_before_post", { workerDecisionId: id, submitCount: __g3Context.submitOrdinal, resultType: action === null ? "null" : typeof action, resultSha256: __g3.hashValue(action) });\n    post({ type: "result", id, action });'],
  ['post({\n      type: "error",\n      id,', '__g3.emit(__g3, "error_before_post", { workerDecisionId: id, submitCount: __g3Context.submitOrdinal, errorName: error instanceof Error ? "Error" : "NonError" });\n    post({\n      type: "error",\n      id,'],
  ['  } finally {\n    active = false;', '  } finally {\n    __g3.emit(__g3, "callback_finally", { workerDecisionId: id, active });\n    active = false;'],
];

const original = readFileSync(stockPath);
if (hash(original) !== PINNED) {
  emit(parentState, 'capture_gap', { reason: 'stock_digest_mismatch' });
  throw new Error('G3_WORKER_CAPTURE_DIGEST_MISMATCH');
}
emit(parentState, isMainThread ? 'capture_parent_ready' : 'capture_worker_ready',
  { stockSha256: PINNED, generation: parentState.generation ?? null });

registerHooks({ load(url, context, nextLoad) {
  if (url !== stockUrl.href) return nextLoad(url, context);
  if (parentState.inert) return nextLoad(url, context);
  // Intercept the exact pinned TypeScript bytes before the existing tsx loader. Transform in
  // memory, then use the same esbuild TypeScript frontend that tsx uses for this fixture.
  let source = original.toString('utf8');
  if (hash(readFileSync(stockPath)) !== PINNED) throw new Error('G3_WORKER_CAPTURE_DIGEST_MISMATCH');
  const anchorCounts = transformations.map(([anchor]) => source.split(anchor).length - 1);
  if (anchorCounts.some(count => count !== 1)) {
    emit(parentState, 'capture_gap', { reason: 'insertion_point_mismatch' });
    throw new Error(`G3_WORKER_CAPTURE_INSERTION_MISMATCH:${anchorCounts.join(',')}`);
  }
  for (const [anchor, replacement] of transformations) source = source.replace(anchor, replacement);
  emit(parentState, 'capture_hook_applied', { stockSha256: PINNED });
  let compiled;
  try { compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'node22' }).code; }
  catch {
    emit(parentState, 'capture_gap', { reason: 'in_memory_transform_failed' });
    throw new Error('G3_WORKER_CAPTURE_TRANSFORM_FAILED');
  }
  return { format: 'module', source: compiled, shortCircuit: true };
} });
}
