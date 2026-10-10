// Explicitly invoked optional smoke: exactly ONE arm process, never a sweep.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { launch, inspectProbe, assertLoad } from './measure-timing.mjs';

const maxLoad1 = 8;
const loadNote = 'User-authorized one-arm d=0 smoke only; not idle-load or timing evidence';
const command = { durationMs: 0, timeoutMs: 100, warmupDecides: 5, measuredDecides: 3 };
const scratch = mkdtempSync(fileURLToPath(new URL('./.unit-smoke-', import.meta.url)));
let client;
try {
  // Required uptime gate immediately before the sole process launch.
  const uptime = execFileSync('uptime', { encoding: 'utf8' }).trim();
  const load1 = Number(uptime.match(/load averages?:\s*([\d.]+)/)?.[1]);
  console.log(JSON.stringify({ uptime, load1, maxLoad1, loadNote, command }));
  if (!Number.isFinite(load1) || load1 >= 4) {
    console.log('SKIP: uptime load1 must be < 4; no arm process launched');
  } else {
    assertLoad(load1, maxLoad1);
    const sink = join(scratch, 'probe.jsonl');
    client = launch({ probe: true, delayMs: 0 }, sink);
    const ready = await client.receive();
    assert.equal(ready.ready, true);
    const unit = await client.request(command);
    const finished = await client.request({ finish: true });
    assert.equal(finished.finished, true);
    client.child.stdin.end();
    assert.equal((await client.exited).code, 0);
    console.log(JSON.stringify({ unit, probe: inspectProbe(sink, unit) }, null, 2));
    assert.equal(unit.status, 'complete');
    assert.equal(unit.measuredDecideCount, 3);
    assert.equal(unit.discardedDecideCount, 5);
    assert.equal(unit.rewarmCount, 0);
    assert.ok(unit.decides.every(d => !d.timedOut));
    console.log('PASS: one arm process, one stock runner/worker, 3 measured d=0 decides');
  }
} finally {
  if (client?.child.exitCode === null) client.child.kill();
  if (client) await client.exited;
  rmSync(scratch, { recursive: true, force: true });
}
