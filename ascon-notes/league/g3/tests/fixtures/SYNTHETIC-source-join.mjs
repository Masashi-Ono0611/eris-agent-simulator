// 人工の記録のみ。実行時観測・モデル応答・チェーン記録ではない。
import { createHash } from 'node:crypto';

export const source = (version, module = false) => ({
  kind: module ? 'module' : 'executor', version,
  sourceSha256: createHash('sha256').update(module ? 'synthetic module' : 'return null;').digest('hex'),
  versionOrigin: 'fixture-explicit', hashScope: module ? 'entry-bytes-only' : 'executor-body',
});

export function seal(records) {
  const copy = structuredClone(records);
  for (const [i, r] of copy.entries()) {
    r.seq = i + 1;
    r.monoNs = String((i + 1) * 10000);
    r.utc = new Date(Date.UTC(2026, 9, 11) + i * 10).toISOString();
    if (r.event === 'setSource_exit') {
      const enter = copy.find(e => e.event === 'setSource_enter' && e.callId === r.callId);
      r.beforeNs = String(BigInt(enter.monoNs) + 1n);
      r.afterNs = String(BigInt(r.monoNs) - 1n);
      r.beforeUtc = enter.utc;
      r.afterUtc = r.utc;
    }
  }
  const end = copy.find(r => r.event === 'probe_complete');
  if (end) Object.assign(end, {
    calls: copy.filter(r => /^(start|decide|close|setSource)_enter$/.test(r.event)).length,
    decisions: copy.filter(r => r.event === 'decide_enter').length,
    generations: copy.filter(r => r.event === 'worker_create').length,
  });
  return { schema: 1, provenance: 'SYNTHETIC', records: copy };
}

export function syntheticSourceJoin({ runners = 1 } = {}) {
  const records = [];
  let callId = 0, decisionId = 0, generation = 0;
  const add = (event, fields = {}) => records.push({ schema: 1, threadId: 0, event, ...fields });
  add('probe_registered');
  for (let runnerId = 1; runnerId <= runners; runnerId++) {
    const identity = { runnerId };
    add('runner_seen', { ...identity, ...source(0, true) });
    for (const version of [0, 1, 2, 3]) {
      const fields = { ...identity, ...source(version, version === 0 || version === 3) };
      if (version) {
        ++callId;
        add('setSource_enter', { ...fields, callId });
        add('setSource_exit', { ...fields, callId, outcome: 'return' });
      }
      ++callId; ++decisionId; ++generation;
      add('decide_enter', { ...fields, callId, decisionId });
      const worker = { ...fields, generation };
      add('worker_create', worker);
      add('worker_attach', { generation, threadId: generation });
      const post = { ...worker, decisionId, workerDecisionId: 1 };
      add('worker_post', post);
      add('worker_result', post);
      add('worker_exit', { ...worker, code: 0 });
      add('decide_exit', { ...fields, callId, decisionId, outcome: 'return' });
    }
  }
  add('probe_complete');
  return seal(records);
}
