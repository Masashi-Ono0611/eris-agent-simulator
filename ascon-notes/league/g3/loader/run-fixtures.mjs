import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdirSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { StrategyRunner } from '../../../../example/agents/runtime/strategyRunner.ts';

const mode = process.argv[2] ?? 'normal';
const enabled = process.env.G3_TEST_WITH_PROBE === '1';
const probeURL = new URL('./probe-loader.mjs', import.meta.url);
const probe = enabled ? await import(probeURL.href) : undefined;
const source = (descriptor, version) => probe ? probe.bindSourceVersion(descriptor, version) : descriptor;
const moduleSource = version => source({ kind: 'module', path: fileURLToPath(new URL('./noop-fixture.mjs', import.meta.url)) }, version);
const executor = (body, version) => source({ kind: 'executor', source: body }, version);
// Synthetic sentinels, never actual credentials. No signer, Sender, RPC or model exists here.
const context = {
  agentId: 'G3_CONTEXT_SENTINEL', address: '0x1234567890123456789012345678901234567890',
  rpcUrl: 'https://G3_RPC_SENTINEL.invalid', config: { chainId: 31337 },
  wallet: { privateKey: 'G3_WALLET_SENTINEL' }, custom: 'G3_FULL_CONTEXT_SENTINEL',
};
const events = [];
const runner = new StrategyRunner(moduleSource(0), context, () => {}, 3000, 15000);
let round = 0;
const observation = extras => ({ round: ++round, secret: 'G3_OBSERVATION_SENTINEL', ...extras });
const decide = async extras => {
  try { events.push({ decision: await runner.decide(observation(extras)) }); }
  catch (error) { events.push({ error: { name: error.name, message: error.message } }); }
};

// Test-only call-site witness. Read the frame immediately after fail(), then emit
// only an allowlisted label/code: never persist the stack, path or error message.
async function guardControl(action) {
  try {
    await action();
    process.stdout.write(JSON.stringify({ guard: null }) + '\n');
  } catch (error) {
    assert.ok(['G3_VERSION_UNBOUND', 'G3_WRONG_INSTANCE'].includes(error.code));
    const frames = error.stack.split('\n');
    const failIndex = frames.findIndex(frame => /^\s+at fail \(.*\/probe-loader\.mjs:\d+:\d+\)$/.test(frame));
    assert.ok(failIndex >= 0, 'control must throw through the production fail()');
    const caller = frames[failIndex + 1]?.match(/^\s+at (describe|state|new ProbeWorker) \(.*\/probe-loader\.mjs:\d+:\d+\)$/)?.[1];
    assert.ok(caller, 'guard caller must be an allowlisted production site');
    const site = { describe: 'describe', state: 'state', 'new ProbeWorker': 'worker-constructor' }[caller];
    process.stdout.write(JSON.stringify({ guard: { code: error.code, site } }) + '\n');
  }
}

if (mode === 'double') {
  await import(`${probeURL.href}?second-registration`);
} else if (mode === 'wrong') {
  const url = new URL('../../../../example/agents/runtime/strategyRunner.ts?second-copy', import.meta.url);
  const { StrategyRunner: OtherRunner } = await import(url.href);
  assert.notEqual(OtherRunner, StrategyRunner, 'positive control must create a distinct class');
  const other = new OtherRunner(moduleSource(0), context, () => {}, 3000, 15000);
  await guardControl(async () => {
    try { await other.start(); } finally { await other.close(); }
  });
} else if (mode === 'wrong-state') {
  class DerivedRunner extends StrategyRunner {}
  const other = new DerivedRunner(moduleSource(0), context, () => {}, 3000, 15000);
  assert.notEqual(Object.getPrototypeOf(other), StrategyRunner.prototype);
  // Inherited wrapper reaches state(); synchronous setSource never constructs a Worker.
  await guardControl(() => other.setSource(moduleSource(1)));
} else if (mode === 'unbound-initial') {
  const unbound = { kind: 'executor', source: '// G3_RAW_SOURCE_SENTINEL\nreturn null;' };
  const other = new StrategyRunner(unbound, context, () => {}, 3000, 15000);
  assert.equal(Object.getPrototypeOf(other), StrategyRunner.prototype);
  await guardControl(() => other.setSource(moduleSource(1)));
} else if (mode === 'unbound-replacement') {
  const unbound = { kind: 'executor', source: '// G3_RAW_SOURCE_SENTINEL\nreturn null;' };
  await guardControl(() => runner.setSource(unbound));
} else if (mode === 'write-failure') {
  await runner.start();
  // A path that was writable ceases to be a file, even under a privileged test user.
  renameSync(process.env.G3_PROBE_JSONL, `${process.env.G3_PROBE_JSONL}.before-failure`);
  mkdirSync(process.env.G3_PROBE_JSONL);
  try { runner.setSource(executor('return null;', 1)); }
  catch (error) {
    assert.equal(error.code, 'G3_WRITE_FAILED');
    process.stderr.write('CONTROL:G3_WRITE_FAILED\n');
    // End the fault-injected process; this is deliberately not a complete run.
    process.exit(23);
  }
  throw Error('write failure guard did not fire');
} else if (mode === 'redaction') {
  await decide();
  runner.setSource(executor(`// G3_RAW_SOURCE_SENTINEL
    ctx.log({reason: 'G3_LOG_SENTINEL', state: {address: ctx.address, observation: obs}});
    ctx.submit({type: 'noop', reason: 'G3_ACTION_SENTINEL'});
    throw Error('G3_ERROR_SENTINEL');`, 1));
  await decide();
  await runner.close();
  probe?.finishProbe();
  // Intentionally do not print returned data or caught error text in this fixture.
  process.stdout.write(JSON.stringify({ redactionFixtureCompleted: true }) + '\n');
} else if (mode === 'inflight') {
  await runner.start();
  const pending = decide({ waitForSelection: true });
  // Wait for actual dispatch, not an assumed scheduling delay.
  while (!runner.instance?.pending) await new Promise(resolve => setImmediate(resolve));
  runner.setSource(executor('return {type:"noop",reason:"new-generation"};', 1));
  await pending;
  await decide();
  await runner.close();
  probe?.finishProbe();
  process.stdout.write(JSON.stringify({ events, counts: globalThis[Symbol.for('g3.test.witness')] }) + '\n');
} else {
  assert.throws(() => fetch('https://g3-must-never-resolve.invalid'), { code: 'G3_OFFLINE_NETWORK' });
  assert.throws(() => spawn('g3-must-never-execute'), { code: 'G3_OFFLINE_CHILD' });
  await runner.start();
  await decide(); // module v0 -> null
  await decide(); // same generation, increments module counter once
  const safeBody = 'ctx.submit({type:"noop",reason:"safe-submit"}); return {type:"noop",reason:"safe-return"};';
  const safe = executor(safeBody, 1);
  assert.equal(runner.setSource(safe), undefined); // preserve synchronous return
  assert.equal(runner.source, safe); // the original assignment already happened, without awaiting
  await decide();
  runner.setSource(safe); // same object: no worker replacement
  await decide();
  runner.setSource(executor(safeBody, 2)); // same hash, different version and object
  await decide();
  runner.setSource(moduleSource(3)); // original module, newly selected version
  await decide();
  await decide({ offlineGuardControl: true });
  runner.setSource(executor('throw Error("fixture-error");', 4));
  for (let i = 0; i < 5; i++) await decide(); // failure, respawn, then stock backoff
  runner.setSource(executor('return null;', 5)); // selected but never dispatched
  await runner.close();
  await decide({ round: 1000 }); // past backoff, stock closed error
  probe?.finishProbe();
  process.stdout.write(JSON.stringify({ events, counts: globalThis[Symbol.for('g3.test.witness')],
    controls: ['G3_OFFLINE_NETWORK', 'G3_OFFLINE_CHILD'] }) + '\n');
}
