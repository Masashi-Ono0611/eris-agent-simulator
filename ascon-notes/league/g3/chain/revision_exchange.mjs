/** Offline archive/audit of native revision exchanges, NOT the G3 world auditor.
 * No provider, executor invocation, RPC, sender, or runtime instrumentation.
 * record RUN_DIR OUTPUT [--synthetic]; audit FILE. Output never prints raw logs.
 */
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRevision, compileExecutor} from '../../../../example/agents/runtime/improve.ts';

export const FILES = ['agents/cand.cli-timing.jsonl', 'agents/cand.llm.jsonl', 'agents/cand.jsonl'];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCHEMA = 'g3-revision-exchange-v1';
const EXIT = {PASS: 0, FAIL: 1, BLOCKED: 2};
export const digest = text => createHash('sha256').update(text).digest('hex');

// Deliberately no NATURAL/VERIFIED label: importing logs cannot certify their origin.
export function recordExchange(runDir, provenance = 'UNVERIFIED') {
  if (!['SYNTHETIC', 'UNVERIFIED'].includes(provenance)) throw Error('invalid provenance');
  const root = realpathSync(runDir), files = {};
  for (const name of FILES) {
    const path = resolve(root, name);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()
        || !realpathSync(path).startsWith(root + sep)) throw Error('unsafe log path');
    const bytes = readFileSync(path), text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) throw Error('invalid UTF-8 log');
    files[name] = {text, sha256: digest(text)};
  }
  return {schema: SCHEMA, provenance, files};
}

export function auditExchange(doc) {
  const failures = [], blocked = [], exchanges = [];
  const totals = {starts: 0, responses: 0, outcomes: 0, unfinished: 0, installed: 0, rejected: 0, declined: 0, reverted: 0};
  const finish = () => ({status: failures.length ? 'FAIL' : blocked.length ? 'BLOCKED' : 'PASS',
    scope: 'offline exchange consistency only', provenance: doc?.provenance ?? 'UNKNOWN',
    g3Status: 'BLOCKED', liveRecorderVerified: false,
    missingG3Prerequisites: ['validated live full-frame recorder', 'application/decision/action/receipt evidence',
      'audited natural non-noop revision and real change/revert execution'],
    parserSha256: digest(readFileSync(resolve(ROOT, 'example/agents/runtime/improve.ts'))),
    totals, exchanges, failures, blocked});
  try {
    if (doc?.schema !== SCHEMA || !['SYNTHETIC', 'UNVERIFIED'].includes(doc.provenance)) {
      blocked.push('exchange schema/provenance missing or unsupported'); return finish();
    }
    if (!doc.files || Object.keys(doc.files).sort().join() !== [...FILES].sort().join()) {
      blocked.push('exact native log set required'); return finish();
    }
    const rows = FILES.map(name => {
      const input = doc.files[name];
      if (typeof input?.text !== 'string' || typeof input.sha256 !== 'string') throw Error('missing log');
      if (digest(input.text) !== input.sha256) failures.push(`${name}: digest mismatch`);
      if (input.text && !input.text.endsWith('\n')) throw Error('partial log');
      const parsed = input.text ? input.text.split('\n').slice(0, -1).map(line => JSON.parse(line)) : [];
      if (parsed.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error('invalid log');
      if (parsed.some(row => ['log_cap_reached', 'log_line_truncated'].includes(row.event)
          || ['log_cap_reached', 'log_line_truncated'].includes(row.kind))) blocked.push(`${name}: capped/truncated log`);
      return parsed;
    });
    // Do not compile a document whose archived bytes no longer match its digests.
    if (failures.length) return finish();
    const [starts, replies, agent] = rows;
    const outcomes = agent.filter(row => String(row.reason ?? '').startsWith('revision '));
    Object.assign(totals, {starts: starts.length, responses: replies.length, outcomes: outcomes.length,
      unfinished: Math.max(0, starts.length - replies.length)});
    if (!replies.length) blocked.push('no recorded responses');
    if (starts.length !== replies.length || replies.length !== outcomes.length) blocked.push('start/response/outcome coverage incomplete');
    const stamp = value => {
      if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('invalid timestamp');
      return Date.parse(value);
    };
    const validRound = value => Number.isInteger(value) && value >= 0;
    const seen = new Set(), usedOutcomes = new Set(), versions = new Set([0]);
    let version = 0, previousEnd = -Infinity;
    for (const [index, reply] of replies.entries()) {
      const start = starts[index];
      if (!start || start.kind !== 'cli_call_started' || start.agentId !== 'cand'
          || !Number.isInteger(start.pid) || start.pid <= 0) { blocked.push(`call ${index}: missing/invalid start`); continue; }
      if (reply.kind !== 'revision_call' || reply.agentId !== 'cand' || !validRound(reply.block)) {
        blocked.push(`call ${index}: invalid response identity`); continue;
      }
      if (seen.has(reply.block)) failures.push('duplicate response block');
      seen.add(reply.block);
      const matches = outcomes.filter(outcome => outcome.round === reply.block && outcome.agentId === 'cand');
      if (matches.length !== 1) { blocked.push(`call ${index}: missing/ambiguous outcome`); continue; }
      const outcome = matches[0], kind = outcome.state?.kind;
      usedOutcomes.add(outcome);
      if (!['installed', 'rejected', 'declined', 'reverted'].includes(kind) || outcome.reason !== `revision ${kind}`) {
        blocked.push(`call ${index}: invalid outcome`); continue;
      }
      totals[kind]++;
      const begin = stamp(start.ts), end = stamp(reply.ts), recorded = stamp(outcome.ts);
      if (begin < previousEnd || begin > end || end > recorded) failures.push(`call ${index}: unordered/overlapping timestamps`);
      previousEnd = recorded;
      if (['system', 'context', 'model'].some(key => typeof reply[key] !== 'string' || !reply[key].trim()))
        blocked.push(`call ${index}: system/context/model missing`);
      if (typeof reply.raw !== 'string' || 'error' in reply) {
        blocked.push(`call ${index}: full raw response unavailable or ambiguous`); continue;
      }
      let parsed;
      try {
        const raw = reply.raw.trim(), fenced = raw.match(/^```(?:json)?\n([\s\S]*?)\n```$/);
        parsed = parseRevision(JSON.parse(fenced ? fenced[1] : raw));
      }
      catch { parsed = {ok: false}; }
      let expected = 'rejected', classification = 'invalid', sourceSha256 = null;
      if (parsed.ok) {
        const revision = parsed.revision;
        if (revision.revertTo !== null) {
          expected = versions.has(revision.revertTo) ? 'reverted' : 'rejected'; classification = 'revert';
        } else if (revision.executorTs === null) { expected = 'declined'; classification = 'decline'; }
        else {
          sourceSha256 = digest(revision.executorTs);
          expected = compileExecutor(revision.executorTs).ok ? 'installed' : 'rejected';
          classification = expected === 'installed' ? 'compilable' : 'compile-rejected';
        }
      }
      if (kind !== expected) failures.push(`call ${index}: stock parse/compile disagrees with recorded outcome`);
      if (kind === 'installed' || kind === 'reverted') {
        version++;
        if (outcome.state.version !== version) failures.push(`call ${index}: non-monotonic version`);
        versions.add(version);
      }
      exchanges.push({index, block: reply.block, recordedOutcome: kind, expectedOutcome: expected,
        classification, rawSha256: digest(reply.raw), sourceSha256});
    }
    if (usedOutcomes.size !== outcomes.length) blocked.push('orphan/duplicate outcomes');
  } catch { blocked.push('missing/malformed exchange evidence; raw error suppressed'); }
  return finish();
}

function main(args) {
  const [command, input, output, flag] = args;
  if (command === 'record' && input && output && args.length <= 4 && (!flag || flag === '--synthetic')) {
    const doc = recordExchange(input, flag ? 'SYNTHETIC' : 'UNVERIFIED');
    // Refuse overwrite; raw logs are saved only to this explicit local file, never stdout.
    writeFileSync(output, JSON.stringify(doc, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({recorded: true, provenance: doc.provenance, g3Status: 'BLOCKED'})); return 0;
  }
  if (command === 'audit' && input && args.length === 2) {
    const result = auditExchange(JSON.parse(readFileSync(input, 'utf8')));
    console.log(JSON.stringify(result, null, 2)); return EXIT[result.status];
  }
  throw Error('usage: record RUN_DIR OUTPUT [--synthetic] | audit FILE');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch { console.log(JSON.stringify({status: 'BLOCKED', g3Status: 'BLOCKED', reason: 'invalid/missing input or output already exists; raw error suppressed'})); process.exitCode = 2; }
}
