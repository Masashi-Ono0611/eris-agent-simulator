// Non-sending fixture. d is worker-local dwell time, NOT parent deadline time.
import { dwell } from './timing-wait.mjs';
export function decide(observation) {
  const d = observation.timingDurationMs;
  if (!Number.isFinite(d) || d < 0) throw Error('TIMING_BAD_DURATION');
  return { type: 'noop', reason: JSON.stringify({ elapsedMs: dwell(d) }) };
}
