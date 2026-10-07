import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync, symlinkSync, lstatSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditExchange, recordExchange, digest, FILES} from '../chain/revision_exchange.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('../chain/fixtures/SYNTHETIC-revision-exchange.json', import.meta.url), 'utf8'));
const tool = fileURLToPath(new URL('../chain/revision_exchange.mjs', import.meta.url));
function mutate(doc, name, change) {
  const file = doc.files[name], rows = file.text.trim().split('\n').map(JSON.parse);
  change(rows); file.text = rows.map(row => JSON.stringify(row)).join('\n')+'\n'; file.sha256 = digest(file.text);
}
test('SYNTHETIC accepted and rejected exchanges pass stock parse/compile audit, never G3', () => {
  const result = auditExchange(fixture()); assert.equal(result.status, 'PASS', JSON.stringify(result));
  assert.equal(result.totals.installed, 1); assert.equal(result.totals.rejected, 1);
  assert.equal(result.provenance, 'SYNTHETIC'); assert.equal(result.g3Status, 'BLOCKED');
  assert.equal(result.liveRecorderVerified, false);
  assert.deepEqual(result.exchanges.map(row => row.expectedOutcome), ['installed','rejected']);
  // World gate requires counts/calls/evidenceSha256, intentionally a different protocol.
  assert.equal(result.counts, undefined);
});
test('positive controls: false acceptance, altered archive, version and time mismatch fail', () => {
  for (const [change, reason] of [
    [doc => mutate(doc, FILES[2], rows => {rows[1].reason='revision installed';rows[1].state={kind:'installed',version:2};}), /parse\/compile disagrees/],
    [doc => {doc.files[FILES[1]].text += ' ';}, /digest mismatch/],
    [doc => mutate(doc, FILES[2], rows => {rows[0].state.version=8;}), /non-monotonic version/],
    [doc => mutate(doc, FILES[0], rows => {rows[1].ts=rows[0].ts;}), /overlapping timestamps/],
  ]) {
    const doc=fixture(); change(doc); const result=auditExchange(doc);
    assert.equal(result.status, 'FAIL'); assert.match(result.failures.join('\n'),reason);
  }
});
test('positive control: duplicate response block fires its FAIL guard', () => {
  const doc = fixture();
  mutate(doc, FILES[1], rows => {rows[1].block = rows[0].block;});
  const result = auditExchange(doc);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.failures.includes('duplicate response block'), JSON.stringify(result));
});
function secondOutcome(raw, kind) {
  const doc = fixture();
  mutate(doc, FILES[1], rows => {rows[1].raw = JSON.stringify({notes: 'SYNTHETIC outcome control', ...raw});});
  mutate(doc, FILES[2], rows => {
    rows[1].reason = `revision ${kind}`;
    rows[1].state = {kind, ...(['installed', 'reverted'].includes(kind) ? {version: 2} : {})};
  });
  return doc;
}
test('decline and known/unknown revertTo normal controls pass offline consistency only', () => {
  for (const [raw, kind, classification] of [
    [{executorTs: null}, 'declined', 'decline'],
    [{revertTo: 0}, 'reverted', 'revert'],
    [{revertTo: 1}, 'reverted', 'revert'],
    [{revertTo: 99}, 'rejected', 'revert'],
  ]) {
    const result = auditExchange(secondOutcome(raw, kind));
    assert.equal(result.status, 'PASS', JSON.stringify(result));
    assert.deepEqual(result.failures, []); assert.deepEqual(result.blocked, []);
    assert.equal(result.exchanges[1].expectedOutcome, kind);
    assert.equal(result.exchanges[1].classification, classification);
    assert.equal(result.totals[kind], 1);
    assert.equal(result.g3Status, 'BLOCKED'); assert.equal(result.liveRecorderVerified, false);
  }
});
test('positive controls: false declined/reverted outcomes fire stock outcome disagreement', () => {
  for (const [raw, recorded, expected] of [
    [{revertTo: 0}, 'declined', 'reverted'],
    [{revertTo: 1}, 'declined', 'reverted'],
    [{executorTs: null}, 'reverted', 'declined'],
    [{revertTo: 99}, 'reverted', 'rejected'],
  ]) {
    const result = auditExchange(secondOutcome(raw, recorded));
    assert.equal(result.status, 'FAIL', JSON.stringify(result));
    assert.deepEqual(result.failures, ['call 1: stock parse/compile disagrees with recorded outcome']);
    assert.deepEqual(result.blocked, []);
    assert.equal(result.exchanges[1].recordedOutcome, recorded);
    assert.equal(result.exchanges[1].expectedOutcome, expected);
  }
});
test('positive controls: invalid UTF-8, file symlink and parent run-dir escape are refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'g3-exchange-paths-'));
  try {
    const runDir = join(root, 'run'), outside = join(root, 'run-outside');
    mkdirSync(join(runDir, 'agents'), {recursive: true}); mkdirSync(outside);
    const doc = fixture();
    for (const name of FILES) writeFileSync(join(runDir, name), doc.files[name].text);
    assert.deepEqual(recordExchange(runDir, 'SYNTHETIC'), doc);

    const target = join(runDir, FILES[0]);
    writeFileSync(target, Buffer.from([0xc3, 0x28]));
    assert.throws(() => recordExchange(runDir), {message: 'invalid UTF-8 log'});
    writeFileSync(target, doc.files[FILES[0]].text);
    assert.deepEqual(recordExchange(runDir, 'SYNTHETIC'), doc);

    const inside = join(runDir, 'timing.jsonl');
    writeFileSync(inside, doc.files[FILES[0]].text); rmSync(target);
    symlinkSync(inside, target);
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(realpathSync(target), realpathSync(inside));
    assert.throws(() => recordExchange(runDir), {message: 'unsafe log path'});
    rmSync(target); writeFileSync(target, doc.files[FILES[0]].text);
    assert.deepEqual(recordExchange(runDir, 'SYNTHETIC'), doc);

    // A regular leaf through a parent symlink reaches a sibling with the same
    // name prefix: only the realpath containment check can reject this case.
    for (const name of FILES) writeFileSync(join(outside, name.split('/')[1]), doc.files[name].text);
    rmSync(join(runDir, 'agents'), {recursive: true});
    symlinkSync(outside, join(runDir, 'agents'));
    assert.equal(lstatSync(target).isSymbolicLink(), false);
    assert.equal(lstatSync(target).isFile(), true);
    assert.equal(realpathSync(target), join(realpathSync(outside), 'cand.cli-timing.jsonl'));
    assert.throws(() => recordExchange(runDir), {message: 'unsafe log path'});
    unlinkSync(join(runDir, 'agents')); mkdirSync(join(runDir, 'agents'));
    for (const name of FILES) writeFileSync(join(runDir, name), doc.files[name].text);
    assert.deepEqual(recordExchange(runDir, 'SYNTHETIC'), doc);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
test('missing/raw/capped/ambiguous/unfinished evidence and false provenance stay BLOCKED', () => {
  for (const change of [
    doc => {delete doc.files[FILES[0]];},
    doc => mutate(doc, FILES[1], rows => {delete rows[0].raw;}),
    doc => mutate(doc, FILES[2], rows => {rows.push({event:'log_cap_reached'});}),
    doc => mutate(doc, FILES[2], rows => {rows.push(rows[0]);}),
    doc => mutate(doc, FILES[0], rows => {rows.push({...rows[1],pid:3});}),
    doc => {doc.provenance='NATURAL';},
    doc => {doc.files[FILES[0]].text='{"unfinished"';doc.files[FILES[0]].sha256=digest(doc.files[FILES[0]].text);},
  ]) { const doc=fixture(); change(doc); assert.equal(auditExchange(doc).status, 'BLOCKED'); }
});
test('offline native-log recording round trip, CLI audit and no-overwrite guard', () => {
  const root=mkdtempSync(join(tmpdir(),'g3-exchange-'));
  try {
    mkdirSync(join(root,'agents'));
    const doc=fixture(); for (const name of FILES) writeFileSync(join(root,name),doc.files[name].text);
    assert.deepEqual(recordExchange(root,'SYNTHETIC'),doc);
    assert.equal(recordExchange(root).provenance,'UNVERIFIED');
    const output=join(root,'exchange.json');
    const run = args => spawnSync(process.execPath,['--import','tsx',tool,...args],{encoding:'utf8'});
    assert.equal(run(['record',root,output,'--synthetic']).status,0);
    const audit=run(['audit',output]); assert.equal(audit.status,0,audit.stderr);
    assert.equal(JSON.parse(audit.stdout).g3Status,'BLOCKED');
    assert.equal(run(['record',root,output,'--synthetic']).status,2);
    assert.equal(run(['audit',join(root,'missing.json')]).status,2);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
