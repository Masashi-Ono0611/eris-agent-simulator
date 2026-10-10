import assert from 'node:assert/strict';
import { probeToolchain } from './probe-toolchain.mjs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { StrategyRunner } from '../../../../example/agents/runtime/strategyRunner.ts';
import { DecideTimeoutError, DECIDE_TIMEOUT_MS } from '../../../../example/agents/runtime/decideTimeout.ts';
import { runTimingUnit } from './timing-unit.mjs';

const probe = process.env.G3_TIMING_PROBE === '1' ? await import('./probe-loader.mjs') : undefined;
const context = { agentId: 'offline-timing', address: '0x1234567890123456789012345678901234567890',
  rpcUrl: 'https://offline-timing.invalid', config: { chainId: 31337 } };
const descriptor = () => {
  const value = { kind: 'module', path: fileURLToPath(new URL('./timing-fixture.mjs', import.meta.url)) };
  return probe ? probe.bindSourceVersion(value, 0) : value;
};
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
emit({ ready: true, stockTimeoutMs: DECIDE_TIMEOUT_MS, toolchain: probeToolchain() });
let executed = false;
for await (const line of createInterface({ input: process.stdin })) {
  const command = JSON.parse(line);
  if (command.finish) {
    probe?.finishProbe();
    emit({ finished: true, delayHits: globalThis.__g3TimingDelayHits ?? 0 });
    break;
  }
  assert.equal(executed, false, 'one execution unit / StrategyRunner per arm process');
  executed = true;
  emit(await runTimingUnit(command, {
    createRunner: source => new StrategyRunner(source, context, () => {}, command.timeoutMs, 15000),
    descriptor, isTimeout: error => error instanceof DecideTimeoutError,
    delayHits: () => globalThis.__g3TimingDelayHits ?? 0,
  }));
}
