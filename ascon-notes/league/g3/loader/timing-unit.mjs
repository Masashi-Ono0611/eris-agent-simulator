import assert from 'node:assert/strict';

// Inject the factory only for fast synthetic tests. Production supplies the stock
// constructor and stock DecideTimeoutError; there is exactly one runner per unit.
export async function runTimingUnit(command, { createRunner, descriptor, isTimeout,
  now = () => performance.now(), delayHits = () => 0 }) {
  const { warmupDecides: W, measuredDecides: N, durationMs } = command;
  assert.ok(Number.isSafeInteger(W) && W > 0, 'warmupDecides must be positive');
  assert.ok(Number.isSafeInteger(N) && N > 0, 'measuredDecides must be positive');
  assert.ok(Number.isFinite(durationMs) && durationMs >= 0);
  assert.ok(Number.isFinite(command.timeoutMs) && command.timeoutMs > 0);
  const runner = createRunner(descriptor());
  const unit = { status: 'running', rewarmCount: 0, discardedDecideCount: 0,
    measuredDecideCount: 0, warmup: [], decides: [], durations: {} };
  const hitsBefore = delayHits();
  let round = 0;
  const decide = async (d, phase) => {
    const record = { round: ++round, phase, durationMs: d, timedOut: false, fixtureElapsedMs: null };
    const hitsBeforeDecide = delayHits();
    const begin = now();
    let decision;
    try { decision = await runner.decide({ round, timingDurationMs: d }); }
    catch (error) {
      if (!isTimeout(error)) throw error;
      record.timedOut = true;
    }
    record.wallMs = now() - begin;
    record.delayHits = delayHits() - hitsBeforeDecide;
    // Validation and JSON parsing are outside the wall timer. No wall-based
    // reclassification: only the stock timeout exception counts as a timeout.
    if (!record.timedOut) {
      assert.deepEqual(decision.submitted, []);
      assert.equal(decision.action?.type, 'noop');
      record.fixtureElapsedMs = JSON.parse(decision.action.reason).elapsedMs;
      assert.ok(record.fixtureElapsedMs >= d);
    }
    return record;
  };
  const warm = async phase => {
    for (let i = 0; i < W; i++) {
      const record = await decide(0, phase);
      unit.warmup.push(record);
      unit.discardedDecideCount++;
      // Fail closed: no measurement on a worker which did not finish W warmups.
      // Also avoids treating stock backoff noops as successful fixture decides.
      if (record.timedOut) throw Error('TIMING_WARMUP_TIMEOUT');
    }
  };
  try {
    const next = descriptor();
    let begin = now();
    runner.setSource(next);
    unit.durations.setSource = now() - begin;
    begin = now();
    await runner.start();
    unit.durations.start = now() - begin;
    begin = now();
    await runner.start();
    unit.durations.startReady = now() - begin;
    await warm('initial');
    for (let i = 0; i < N; i++) {
      if (unit.decides.at(-1)?.timedOut) {
        unit.rewarmCount++;
        await warm('rewarm');
      }
      unit.decides.push(await decide(durationMs, 'measured'));
      unit.measuredDecideCount++;
    }
    unit.status = 'complete';
  } catch (error) {
    unit.status = 'aborted';
    unit.failure = { code: error.code ?? error.message, name: error.name, message: error.message };
  } finally {
    const begin = now();
    await runner.close();
    unit.durations.close = now() - begin;
    unit.delayHits = delayHits() - hitsBefore;
  }
  return unit;
}
