// Artifact consistency only: exit 0 does NOT mean that the measurement completed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { summarize, renderReport, renderRefusal, renderControlReport } from './measure-timing.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
// Explicit inputs prevent a new-host validation from silently reading the archived Air run.
const { values } = parseArgs({ options: { measurement: { type: 'string' }, controls: { type: 'string' } } });
assert.ok(values.measurement && values.controls, 'required: --measurement <new-prefix> --controls <new-prefix>');
const result = JSON.parse(readFileSync(`${values.measurement}.json`, 'utf8'));
if (result.summary) assert.deepEqual(summarize(result.raw, result.config), result.summary);
assert.equal(result.status === 'refused' ? renderRefusal(result) : renderReport(result),
  readFileSync(`${values.measurement}.md`, 'utf8'));
const controls = JSON.parse(readFileSync(`${values.controls}.json`, 'utf8'));
assert.equal(renderControlReport(controls), readFileSync(`${values.controls}.md`, 'utf8'));
for (const control of Object.values(controls)) {
  if (control.summary) assert.deepEqual(summarize(control.raw, control.config), control.summary);
  for (const key of ['node', 'tsx', 'toolchainOverride', 'expectedNode', 'expectedTsx', 'platform', 'release', 'arch', 'cpuModel', 'logicalCpus']) {
    assert.equal(control.hostBefore[key], result.hostBefore[key], `same-host metadata: ${key}`);
  }
  assert.equal(control.config.maxLoad1, result.config.maxLoad1, 'same load threshold');
  assert.equal(control.config.loadNote, result.config.loadNote, 'same load note');
}
for (const record of [result, ...Object.values(controls)]) {
  for (const [name, expected] of Object.entries(record.sourceHashes ?? {})) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex'), expected, name);
  }
}
assert.equal(execFileSync('git', ['diff', 'HEAD', '--name-only', '--', '.', ':(exclude)ascon-notes/league/g3/**'], { cwd: root, encoding: 'utf8' }), '');
execFileSync('git', ['diff', '--check'], { cwd: root });
const paths = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
for (const path of paths) {
  assert.ok(path.startsWith('ascon-notes/league/g3/loader/') || path.startsWith('ascon-notes/league/g3/tests/'), path);
  const check = spawnSync('git', ['diff', '--no-index', '--check', '/dev/null', path], { cwd: root, encoding: 'utf8' });
  assert.ok([0, 1].includes(check.status) && check.stdout === '' && check.stderr === '', path);
}
console.log(JSON.stringify({ artifactConsistency: true, newFiles: paths.length,
  measurementComplete: result.status === 'complete', overheadSamplesPerArm: result.summary?.overhead.decide.A.n ?? 0,
  controlVerdicts: Object.fromEntries(Object.entries(controls).map(([name, r]) => [name, r.controlVerdict])),
  negativeControlPresent: Boolean(controls.negative), trackedFilesOutsideG3Changed: false }));
