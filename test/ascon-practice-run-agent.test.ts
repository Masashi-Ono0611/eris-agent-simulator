import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentEnv, formatDryRun } from '../ascon-notes/practice/run-agent.js';
import type { PracticeEnv } from '../ascon-notes/practice/env.js';

const key = `0x${'a'.repeat(64)}` as `0x${string}`;
const values: PracticeEnv = {
  rpcUrl: 'https://rpc.invalid', chainId: 31337, privateKey: key,
  headers: {
    'CF-Access-Client-Id': 'cf-id-secret',
    'CF-Access-Client-Secret': 'cf-secret-value',
    'X-ASCON-Key': 'ascon-secret-value',
  },
};

test('buildAgentEnv routes the three auth headers and private key correctly', () => {
  process.env.PARENT_SECRET = 'must-not-pass';
  const env = buildAgentEnv(values, { agentDir: 'ascon-test', agentId: 'masa-ascon', runDir: 'practice-logs/test' });
  assert.equal(env.CF_ACCESS_CLIENT_ID, 'cf-id-secret');
  assert.equal(env.CF_ACCESS_CLIENT_SECRET, 'cf-secret-value');
  assert.deepEqual(JSON.parse(env.ERIS_RPC_HEADERS!), { 'X-ASCON-Key': 'ascon-secret-value' });
  assert.equal(env.ERIS_AGENT_PRIVATE_KEY, key);
  assert.equal(env.PARENT_SECRET, undefined);
  delete process.env.PARENT_SECRET;
});

test('dry-run report includes names and lengths but no secret values', () => {
  const env = buildAgentEnv(values, { agentDir: 'ascon-test', agentId: 'masa-ascon', runDir: 'practice-logs/test' });
  const report = formatDryRun(env);
  for (const secret of [key, 'cf-id-secret', 'cf-secret-value', 'ascon-secret-value']) assert.equal(report.includes(secret), false);
  for (const name of ['ERIS_AGENT_PRIVATE_KEY', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'ERIS_RPC_HEADERS']) assert.match(report, new RegExp(name));
});
