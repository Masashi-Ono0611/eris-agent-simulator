import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('offline degradation gate and resource preflight fixtures', () => {
  const result = spawnSync('python3', ['-B', 'test/ascon_degradation_gate_test.py', '-v'], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log(result.stderr.trim());
});
