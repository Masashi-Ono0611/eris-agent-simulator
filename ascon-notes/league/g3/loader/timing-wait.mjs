// Intentionally burns one CPU core for the entire requested duration. Timer
// coalescing makes sleep-based waits unsuitable for measured dwell/delay times.
// Preemption can still cause overshoot; startup calibration fails closed.
export function spinWait(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) throw Error('TIMING_BAD_DURATION');
  const begin = performance.now();
  while (performance.now() - begin < durationMs) { /* intentional busy-spin */ }
  return performance.now() - begin;
}

export const dwell = spinWait;
export const injectedReceiveDelay = spinWait;
