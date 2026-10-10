// Measurement-only positive control. Never changes the production probe source.
import threads, { isMainThread } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { injectedReceiveDelay } from './timing-wait.mjs';

if (isMainThread) {
  const delayMs = Number(process.env.G3_TIMING_DELAY_MS ?? 0);
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 50) throw Error('TIMING_BAD_DELAY');
  if (delayMs > 0) {
    const OriginalWorker = threads.Worker;
    const workerURL = new URL('../../../../example/agents/runtime/strategyWorker.mjs', import.meta.url).href;
    threads.Worker = class TimingDelayWorker extends OriginalWorker {
      constructor(filename, options) {
        super(filename, options);
        if (String(filename) === workerURL) this.on('message', message => {
          if (message.type !== 'result') return;
          injectedReceiveDelay(delayMs); // before stock deadline check; burns one core intentionally
          globalThis.__g3TimingDelayHits = (globalThis.__g3TimingDelayHits ?? 0) + 1;
        });
      }
    };
    syncBuiltinESMExports();
  }
}
