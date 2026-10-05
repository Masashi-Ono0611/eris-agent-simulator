// All mutations live in a private temp copy. Never mutate xb-r, runtime, or this worktree.
// Sequential assertion failures only; syntax/loader failures do not count as red controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = mkdtempSync(join(tmpdir(), 'xb-r-ai-red-'));
const sandbox = join(evidence, 'copy');
mkdirSync(join(sandbox, 'example/agents'), { recursive: true });
mkdirSync(join(sandbox, 'test'), { recursive: true });
for (const name of ['package.json', 'tsconfig.json']) cpSync(join(root, name), join(sandbox, name));
for (const name of ['sdk', 'node_modules']) symlinkSync(join(root, name), join(sandbox, name));
for (const name of readdirSync(join(root, 'example/agents'))) {
  const from = join(root, 'example/agents', name), to = join(sandbox, 'example/agents', name);
  if (name === 'xb-r-ai') cpSync(from, to, { recursive: true });
  else symlinkSync(from, to);
}
symlinkSync(join(root, 'test/fixtures'), join(sandbox, 'test/fixtures'));
for (const name of readdirSync(join(root, 'test')).filter(n => /^xb.*\.test\.ts$/.test(n) || n === 'xb-fixtures.ts'))
  cpSync(join(root, 'test', name), join(sandbox, 'test', name));
const dir = 'example/agents/xb-r-ai/';
const originals = Object.fromEntries(['agent.ts', 'policy.ts', 'engine.ts', 'v5.ts'].map(name =>
  [name, readFileSync(join(root, dir, name), 'utf8')]));
const sha = s => createHash('sha256').update(s).digest('hex');
const baseline = Object.fromEntries(Object.entries(originals).map(([n, s]) => [n, sha(s)]));
const xbOriginal = sha(readFileSync(join(root, 'example/agents/xb-r/agent.ts')));
// [name, source, test title prefix, unique mutation anchor, replacement]
const controls = [
  ['entry-min', 'policy.ts', 'H1 ENTRY range', 'o.ENTRY_BPS >= 20', 'o.ENTRY_BPS >= 0'],
  ['entry-max', 'policy.ts', 'H1 ENTRY range', 'o.ENTRY_BPS <= 60', 'o.ENTRY_BPS <= 100'],
  ['entry-step', 'policy.ts', 'H1 ENTRY range', 'o.ENTRY_BPS % 5 === 0', 'true'],
  ['entry-delta', 'policy.ts', 'H1 ENTRY delta', 'Math.abs(parsed.selection.ENTRY_BPS - current.ENTRY_BPS) > 5', 'false'],
  ['policy-r11', 'policy.ts', 'H1 policy v5-r11', "R11_SMALL_SINGLE_CAP: selection.policyId === 'v5-r11'", 'R11_SMALL_SINGLE_CAP: false'],
  ['policy-r7', 'policy.ts', 'H1 policy v5-r7-strict', "R7_SINGLE_ENTRY: selection.policyId !== 'v5-r7-strict'", 'R7_SINGLE_ENTRY: true'],
  ['policy-r9-gate', 'policy.ts', 'H1 policy v5 preserves', '...PARAMS, ENTRY_BPS:', '...PARAMS, R9_BUNDLE_HEADROOM: false, ENTRY_BPS:'],
  ['ttl', 'policy.ts', 'H1 TTL', 'block - appliedAt >= POLICY_TTL', 'block - appliedAt > POLICY_TTL'],
  ['apply-time', 'policy.ts', 'H1 TTL', 'appliedAt = latest;', 'appliedAt = ticket.observedAtBlock;'],
  ['proposal-ttl', 'policy.ts', 'H1 proposal expiry', 'latest - ticket.observedAtBlock > PROPOSAL_TTL', 'false'],
  ['cadence', 'policy.ts', 'H1 baseline initial', 'latest - lastRequest < REVISION_INTERVAL', 'latest - lastRequest < 1'],
  ['ticket-identity', 'policy.ts', 'H1 baseline initial', 'pending !== ticket || ', ''],
  ['epoch-reset', 'policy.ts', 'H1 epoch reset run', 'runId !== obs.runId || ', ''],
  ['rewind-reset', 'policy.ts', 'H1 epoch reset rewind', 'block < latest || ', ''],
  ['horizon-reset', 'policy.ts', 'H1 epoch reset horizon', 'left > remaining + 5', 'false'],
  ['day-horizon-reset', 'policy.ts', 'H1 day epoch reset', '[obs.blocksRemaining, obs.dayBlocksRemaining]', '[obs.blocksRemaining]'],
  ['frozen-request', 'policy.ts', 'H1 valid same selection', 'if (frozen || latest < 0', 'if (false || latest < 0'],
  ['invalid-fallback', 'policy.ts', 'H1 malformed output', "baseline(); return { kind: 'rejected', reason: parsed.reason };", "return { kind: 'rejected', reason: parsed.reason };"],
  ['template-gate', 'policy.ts', 'H1 gate removal negative control', "if (!match) throw new Error('executorTs is not the fixed literal template');", "if (!match) return { kind: 'selection', selection: BASELINE, notes: o.notes };"],
  ['stock-on-guard', 'agent.ts', 'H1 stock ON', "process.env.ERIS_AGENT_FROZEN !== '1'", 'false'],
  ['state-reset', 'engine.ts', 'H1 update, rejection', 'return core(obs);', 'return createAgent(PARAMS, options.now, gate.params)(obs);'],
  ['funding-gate', 'v5.ts', 'H1 all policies', 'if (!reserveCandidate(obs, c)) continue;', 'if (false) continue;'],
  ['gas-gate', 'v5.ts', 'H1 all policies', 'if (BigInt(obs.balances.ethWei) - BigInt(c.gas) * fee < GAS_RESERVE) continue;', 'if (false) continue;'],
  ['settlement-state', 'v5.ts', 'H1 update preserves pending', 'p.R8_SETTLED_COOLDOWN && previous', 'false && previous'],
  ['frozen-r9', 'v5.ts', 'H1 frozen reconstructed headroom-buy', '...V3_PARAMS, R9_BUNDLE_HEADROOM: true', '...V3_PARAMS, R9_BUNDLE_HEADROOM: false'],
];
function run(label, pattern) {
  const files = pattern ? ['test/xb-r-ai.test.ts'] : readdirSync(join(sandbox, 'test')).filter(n => /^xb.*\.test\.ts$/.test(n)).map(n => `test/${n}`);
  const args = ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap',
    ...(pattern ? [`--test-name-pattern=${pattern}`] : []), ...files];
  const r = spawnSync(process.execPath, args, { cwd: sandbox, encoding: 'utf8',
    env: { ...process.env, TSX_DISABLE_CACHE: '1' }, timeout: 60000 });
  const log = (r.stdout ?? '') + (r.stderr ?? '');
  writeFileSync(join(evidence, `${label}.log`), log);
  assert.equal(r.error, undefined, `${label}: infrastructure error`);
  return { r, log };
}
const records = [];
try {
  for (const [name, file, pattern, from, to] of controls) {
    const original = originals[file], path = join(sandbox, dir, file);
    assert.equal(original.split(from).length, 2, `${name}: unique anchor`);
    writeFileSync(path, original.replace(from, to));
    let result;
    try { result = run(name, pattern); } finally { writeFileSync(path, original); }
    assert.equal(result.r.status, 1, `${name}: mutant must exit 1`);
    assert.match(result.log, /ERR_ASSERTION/, `${name}: must be assertion failure`);
    assert.match(result.log, new RegExp(`not ok \\d+ - ${pattern}`), `${name}: named test must fail`);
    assert.equal(sha(readFileSync(path)), baseline[file]);
    records.push({ name, file, exit: 1, restoredSha256: baseline[file], logSha256: sha(result.log) });
    console.log(`RED ${name}: assertion failure; temp source restored`);
  }
} finally {
  for (const [name, source] of Object.entries(originals)) writeFileSync(join(sandbox, dir, name), source);
  writeFileSync(join(evidence, 'mutations.json'), JSON.stringify(records, null, 2) + '\n');
}
const restored = run('restored-xb-tests');
assert.equal(restored.r.status, 0, 'restored xb subset must pass');
for (const name of Object.keys(originals)) {
  assert.equal(sha(readFileSync(join(root, dir, name))), baseline[name], 'working source unchanged');
  assert.equal(sha(readFileSync(join(sandbox, dir, name))), baseline[name], 'temp source restored');
}
assert.equal(sha(readFileSync(join(root, 'example/agents/xb-r/agent.ts'))), xbOriginal);
const counts = Object.fromEntries([...restored.log.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map(m => [m[1], Number(m[2])]));
const report = { controls: records.length, counts, restoredSha256: baseline, xbUnchangedSha256: xbOriginal, evidence };
writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
