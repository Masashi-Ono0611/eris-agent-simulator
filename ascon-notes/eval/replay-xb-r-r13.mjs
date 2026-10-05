// Offline fixed-wallet decisions only; no RPC, simulation or writes to input logs.
// node --import tsx ascon-notes/eval/replay-xb-r-r13.mjs /tmp/r13-replay.json /tmp/xb-r-dev2/frames.json /tmp/xb-r-dev3-v4/frames.json
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import * as xb from '../../example/agents/xb-r/agent.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [output, ...inputs] = process.argv.slice(2).map(p => resolve(p));
assert.ok(output && inputs.length && !inputs.includes(output));
const sha = s => createHash('sha256').update(s).digest('hex');
const frozenCommit = '96b9764';
const original = execFileSync('git', ['show', `${frozenCommit}:example/agents/xb-r/agent.ts`], { cwd: root, encoding: 'utf8' });
const source = original.replace('from "@eris/sdk/constants.js"', `from ${JSON.stringify(pathToFileURL(join(root, 'sdk/src/constants.ts')).href)}`)
  .replace('from "../lib/affordable.js"', `from ${JSON.stringify(pathToFileURL(join(root, 'example/agents/lib/affordable.ts')).href)}`);
const frozen = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString('base64'));
const report = { frozenCommit, frozenSha256: sha(original), implementationSha256: sha(readFileSync(join(root, 'example/agents/xb-r/agent.ts'))),
  scriptSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  caveat: 'Saved opportunity-selected subsets, not every block (dev2 1567; dev3a+b 1542). Fixed historical wallets/cooldowns/bids, no alternate fills or trajectory. Actual fill-count impact is unidentifiable without amount-specific quotes. Model net includes estimated gas, not realized costs.',
  datasets: [] };
const on = { ...xb.PARAMS, R13_EDGE_SLIPPAGE: true };
const strip = a => {
  const b = structuredClone(a);
  for (const leg of b.type === 'bundle' ? b.actions : [b]) delete leg.slippageBps;
  return b;
};
for (const input of inputs) {
  const content = readFileSync(input), frames = JSON.parse(content);
  const stats = { input, sha256: sha(content), frames: frames.length, frozenMatches: 0, explicitOffMatches: 0,
    storedV3Matches: 0, offTrades: 0, onTrades: 0, added: 0, removed: 0, changedRouteOrSize: 0,
    tightenedActions: 0, onSlippageBps: {}, byRegime: {} };
  for (const f of frames) {
    const o = f.observation, bids = new Map(f.bids.map(([k, v]) => [k, BigInt(v)]));
    const cooling = new Set(f.cooling);
    if (f.settledFrame && xb.settledSingle(f.settledFrame.observation, f.settledFrame.action, o))
      cooling.delete(f.settledFrame.action.base);
    const run = (mod, p) => mod.selectCandidate(o, mod.enumerateCandidates(o, p, cooling), p, bids);
    const off = run(xb, xb.PARAMS), a = run(xb, on);
    assert.deepEqual(off, run(frozen, frozen.PARAMS)); stats.frozenMatches++;
    assert.deepEqual(off, run(xb, { ...xb.PARAMS, R13_EDGE_SLIPPAGE: false })); stats.explicitOffMatches++;
    if (f.v3) { assert.deepEqual(off, f.v3.action); stats.storedV3Matches++; }
    const region = stats.byRegime[f.regime] ??= { frames: 0, offTrades: 0, onTrades: 0, removed: 0 };
    region.frames++;
    const was = off.type !== 'noop', now = a.type !== 'noop';
    stats.offTrades += Number(was); stats.onTrades += Number(now);
    region.offTrades += Number(was); region.onTrades += Number(now);
    stats.added += Number(!was && now); stats.removed += Number(was && !now); region.removed += Number(was && !now);
    if (was && now) stats.changedRouteOrSize += Number(JSON.stringify(strip(a)) !== JSON.stringify(strip(off)));
    if (now) {
      stats.tightenedActions++;
      for (const leg of a.type === 'bundle' ? a.actions : [a]) {
        assert.ok(leg.slippageBps >= 1 && leg.slippageBps <= 50);
        stats.onSlippageBps[leg.slippageBps] = (stats.onSlippageBps[leg.slippageBps] ?? 0) + 1;
      }
    }
  }
  report.datasets.push(stats);
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.datasets.map(({ byRegime, onSlippageBps, ...s }) => ({ ...s,
  slippageMin: Math.min(...Object.keys(onSlippageBps).map(Number)), slippageMax: Math.max(...Object.keys(onSlippageBps).map(Number)) })), null, 2));
