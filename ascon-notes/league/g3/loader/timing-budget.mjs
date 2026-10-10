import assert from 'node:assert/strict';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { REDUCED } from './timing-reduced.mjs';

export const BUDGET_VERDICT = 'INCONCLUSIVE (budget)';
export function budgetMinutes(value, control = false) {
  const number = value === undefined ? (control ? REDUCED.controlBudgetMin : REDUCED.mainBudgetMin) : Number(value);
  if (!Number.isFinite(number) || number <= 0 || number * 60000 + REDUCED.testTimeoutMarginMs > 2147483647) {
    throw Error('budget-min must be a finite positive number within the Node timer limit');
  }
  return number;
}
export function testTimeoutMs(value, control = true) {
  return budgetMinutes(value, control) * 60000 + REDUCED.testTimeoutMarginMs;
}
export function partialJournal(path) {
  // O_APPEND + O_EXCL: owned descriptor only; neither existing data nor a
  // replaced path is ever reopened for writing. Every record is durable.
  const fd = openSync(path, 'ax');
  let closed = false;
  return {
    append(record) {
      assert.ok(!closed, 'journal closed');
      const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    },
    close() { if (!closed) { closed = true; closeSync(fd); } },
  };
}
export function createBudget({ budgetMin, totalPairs, cooldownMs }, {
  now = () => performance.now(), started = now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let completed = 0, sumCosts = 0, boundaryCosts = 0, boundaryPairs = 0, projectedTotalMs = null;
  const limitMs = budgetMin * 60000;
  const snapshot = () => ({ limitMs, elapsedMs: now() - started, projectedTotalMs, completedPairs: completed,
    totalPairs, meanPairCostMs: completed ? sumCosts / completed : null,
    meanBoundaryPairCostMs: boundaryPairs ? boundaryCosts / boundaryPairs : null,
    projectionMethod: 'elapsed + pending cooldown + remaining pairs * max(mean pair cost, mean boundary pair cost); pair cost includes cooldown' });
  const error = reason => Object.assign(Error('TIMING_BUDGET_EXCEEDED'), { code: 'TIMING_BUDGET_EXCEEDED', reason, budget: snapshot() });
  const check = () => {
    if (now() - started > limitMs || (projectedTotalMs !== null && projectedTotalMs > limitMs)) {
      throw error(now() - started > limitMs ? 'elapsed' : 'projection');
    }
  };
  return { snapshot, check,
    completedPair(phase, pairElapsedMs) {
      completed++; sumCosts += pairElapsedMs + cooldownMs;
      if (phase === 'boundary' || phase === 'exploration') { boundaryPairs++; boundaryCosts += pairElapsedMs + cooldownMs; }
      const mean = Math.max(sumCosts / completed, boundaryPairs ? boundaryCosts / boundaryPairs : 0);
      projectedTotalMs = now() - started + cooldownMs + Math.max(0, totalPairs - completed) * mean;
      return snapshot(); // Caller must persist BEFORE check() can throw.
    },
    async wait(operation) {
      check();
      let timer;
      try {
        const deadline = new Promise((_, reject) => { timer = setTimer(() => reject(error('elapsed')), Math.max(0, limitMs - (now() - started))); });
        const result = await Promise.race([Promise.resolve().then(operation), deadline]);
        // Return an already received unit so the caller can retain it. The
        // next operation/pair check stops before any further arm work.
        return result;
      } finally { clearTimer(timer); }
    },
  };
}
export async function stopTimingClient(client, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (client.child.exitCode !== null || client.child.signalCode) return { alreadyExited: true };
  client.child.kill('SIGTERM');
  let timer, forced = false;
  try {
    const graceful = await Promise.race([client.exited.then(() => true), new Promise(resolve => {
      timer = setTimer(() => resolve(false), REDUCED.shutdownGraceMs);
    })]);
    if (!graceful) { forced = true; client.child.kill('SIGKILL'); }
    await client.exited;
    return { signal: 'SIGTERM', forced, graceMs: REDUCED.shutdownGraceMs };
  } finally { clearTimer(timer); }
}
