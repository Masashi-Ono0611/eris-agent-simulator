// Independent test instrumentation installed BEFORE the probe. Counters sit immediately
// outside stock methods, so a probe that calls its delegate twice cannot hide behind its log.
import threads, { isMainThread } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
if (isMainThread) {
  const counts = { setSource: 0, start: 0, decide: 0, close: 0, spawn: 0,
    workerCreate: 0, workerPost: 0, workerResult: 0, workerSubmit: 0, workerExit: 0 };
  globalThis[Symbol.for('g3.test.witness')] = counts;
  const original = threads.Worker;
  const workerURL = new URL('../../../../example/agents/runtime/strategyWorker.mjs', import.meta.url).href;
  const probeURL = new URL('./probe-loader.mjs', import.meta.url).href;
  threads.Worker = class WitnessWorker extends original {
    constructor(filename, options) {
      const strategy = String(filename) === workerURL;
      if (strategy) {
        counts.workerCreate++;
        // Deliberately omit ONLY the probe preload for one real stock generation.
        if (counts.workerCreate === Number(process.env.G3_TEST_SKIP_GENERATION)) {
          const execArgv = [...process.execArgv];
          const index = execArgv.indexOf(probeURL);
          if (index < 1 || execArgv[index - 1] !== '--import') throw Error('G3_TEST_FAULT_NOT_INSTALLED');
          execArgv.splice(index - 1, 2);
          options = { ...options, execArgv };
        }
      }
      super(filename, options);
      if (!strategy) return;
      const post = this.postMessage;
      this.postMessage = function (...args) {
        counts.workerPost++;
        return Reflect.apply(post, this, args);
      };
      this.on('message', m => {
        if (m.type === 'result') counts.workerResult++;
        if (m.type === 'submit') counts.workerSubmit++;
      });
      this.on('exit', () => { counts.workerExit++; });
    }
  };
  syncBuiltinESMExports();
  const { StrategyRunner } = await import('../../../../example/agents/runtime/strategyRunner.ts');
  for (const method of ['setSource', 'start', 'decide', 'close', 'spawn']) {
    const originalMethod = StrategyRunner.prototype[method];
    StrategyRunner.prototype[method] = function (...args) {
      counts[method]++;
      return Reflect.apply(originalMethod, this, args);
    };
  }
}
