import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('ASCON tooling offline Python/shell regressions', () => {
  const result = spawnSync('python3', [resolve('test/ascon-tools-regressions.py')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
