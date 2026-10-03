import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('offline league harness: statistics, ledger, briefs, status and confirmation fixtures', () => {
  const result = spawnSync('python3', ['-B', 'test/ascon_league_harness_test.py', '-v'], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log(result.stderr.trim());
});
