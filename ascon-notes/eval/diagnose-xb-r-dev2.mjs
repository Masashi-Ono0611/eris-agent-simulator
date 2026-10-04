// Offline only. Reads dev2 logs; writes ONLY the explicitly supplied output directory.
// node --import tsx ascon-notes/eval/diagnose-xb-r-dev2.mjs ../upstream-eval /tmp/xb-r-dev2
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const input = resolve(process.argv[2]), output = resolve(process.argv[3]);
assert.ok(output !== input && !output.startsWith(input + '/'), 'input tree is read-only');
mkdirSync(output, { recursive: true });
const read = p => readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));
const lines = p => read(p).trim().split('\n').map(l => JSON.parse(l));
const csv = (p, sep = ',') => { const [head, ...rows] = read(p).trim().split('\n');
  return rows.map(l => Object.fromEntries(l.split(sep).map((v, i) => [head.split(sep)[i], v]))); };
const count = (o, k, n = 1) => o[k] = (o[k] ?? 0) + n;
const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const frozen = execFileSync('git', ['show', '2ae0d59:example/agents/xb-r/agent.ts'], { cwd: root, encoding: 'utf8' });
function replace(s, a, b) { assert.equal(s.split(a).length, 2, a); return s.replace(a, b); }
async function moduleFor(changes = []) {
  let s = frozen;
  for (const [a, b] of changes) s = replace(s, a, b);
  // Offline parameter sweep calls the pure enumeration, not the live constructor.
  s = replace(s, 'export const decide = createLiveAgent(PARAMS);', '');
  s = s.replace('from "@eris/sdk/constants.js"', `from ${JSON.stringify(pathToFileURL(join(root, 'sdk/src/constants.ts')).href)}`)
    .replace('from "../lib/affordable.js"', `from ${JSON.stringify(pathToFileURL(join(root, 'example/agents/lib/affordable.ts')).href)}`);
  s += '\nexport { markets, remaining, candidateObservation };';
  return import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(s, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText).toString('base64'));
}
const old = await moduleFor();
const repaired = await import(pathToFileURL(join(root, 'example/agents/xb-r/agent.ts')));
const cases = {
  baseline: old,
  entry20: await moduleFor([['ENTRY_BPS: 50,', 'ENTRY_BPS: 20,']]),
  single50: await moduleFor([['SINGLE_EDGE_BPS: 100,', 'SINGLE_EDGE_BPS: 50,']]),
  min10: await moduleFor([
    ['if (!(usd >= 50)) continue;\n        const amount', 'if (!(usd >= 10)) continue;\n        const amount'],
    ['if (!(usd >= 50)) continue;\n      const spend', 'if (!(usd >= 10)) continue;\n      const spend'],
  ]),
  // Only cross the anchor when the NEW-risk edge clears the existing single gate.
  anchor: await moduleFor([['restoring ? Math.abs(held - initial) : buy ? upper - held : held - lower',
    'restoring && (endgame || rawEdge * 10000 <= p.SINGLE_EDGE_BPS) ? Math.abs(held - initial) : buy ? upper - held : held - lower']]),
  band40: await moduleFor([['const INV_BAND = 0.2;', 'const INV_BAND = 0.4;']]),
  sizeMax: await moduleFor([['const desired = floor ? Math.max(depthTarget, balanceTarget) : depthTarget;',
    'const desired = edge / (2 * slope);']]),
  profit01: await moduleFor([['const MIN_PROFIT_USDC = 0.05;', 'const MIN_PROFIT_USDC = 0.01;']]),
  cooldown0: old,
  bidBudget: await moduleFor([['R4_COMPETITOR_BID: true,', 'R4_COMPETITOR_BID: false,']]),
  cap16: await moduleFor([['const cap = 0.08 *', 'const cap = 0.16 *']]),
  entry60: await moduleFor([['ENTRY_BPS: 50,', 'ENTRY_BPS: 60,']]),
  single60: await moduleFor([['ENTRY_BPS: 50, SINGLE_EDGE_BPS: 100,', 'ENTRY_BPS: 60, SINGLE_EDGE_BPS: 60,']]),
  combined60: await moduleFor([
    ['ENTRY_BPS: 50, SINGLE_EDGE_BPS: 100,', 'ENTRY_BPS: 60, SINGLE_EDGE_BPS: 60,'],
    ['restoring ? Math.abs(held - initial) : buy ? upper - held : held - lower',
      'restoring && endgame ? Math.abs(held - initial) : buy ? upper - held : held - lower'],
  ]),
};
const { UNISWAP, BALANCER, MARKET_LEGS } = await import(pathToFileURL(join(root, 'sdk/src/constants.ts')));
const stats = { worlds: [], reasons: {}, failures: {}, gates: {}, matchedGates: {}, matchedRouteGates: {}, matchedGateBlocks: {}, factors: {}, coverage: {}, confusion: {}, repairedMatches: 0 };
let gateBlocks, matchingRoutes = [];
const incGate = (gate, matched, route = []) => { count(stats.gates, gate);
  if (matched) { count(stats.matchedGates, gate); gateBlocks.add(gate);
    if (route.some(a => matchingRoutes.some(b => a.base === b.base && a.protocol === b.protocol && a.side === b.side)))
      count(stats.matchedRouteGates, gate);
  }
};
// First rejection per potential directed route. This is a model, NOT logged reject reasons.
function trace(o, cooling, bids, matched) {
  const ms = old.markets(o), cash = Number(o.balances.usdcUnits) / 1e6;
  const cap = .08 * (cash + ms.reduce((s, m) => s + Number(m.held) / 10 ** m.decimals * m.fair, 0));
  const left = old.remaining(o), endgame = left <= 4;
  if (left <= 0) { incGate('horizon', matched); return; }
  for (const m of ms) {
    const held = Number(m.held) / 10 ** m.decimals, initial = m.base === 'WETH' ? 8 : .4;
    const lower = initial * .8, upper = initial * 1.2;
    for (const v of m.venues) for (const buy of [true, false]) {
      const restoring = buy ? held < initial : held > initial;
      let gate;
      const edge = buy ? m.fair / v.mid - 1 - v.cost : v.mid / m.fair - 1 - v.cost;
      if (endgame && !restoring) gate = 'endgame_new_risk';
      else if (cooling.has(m.base) && !(endgame && restoring)) gate = 'cooldown';
      else if (!old.entryAllowed(edge, old.PARAMS)) gate = edge > 0 ? 'entry_positive' : 'no_edge';
      else if (!restoring && edge * 10000 <= 100) gate = 'single_edge';
      else {
        const target = old.sizeUsd(edge, 1 / v.depth, buy ? cash : held * v.mid, cap, true);
        const room = Math.max(0, restoring ? Math.abs(held - initial) : buy ? upper - held : held - lower);
        const usd = Math.min(target, room * v.mid / (buy ? 1.008 : 1), cap * Math.min(1, v.mid / m.fair));
        if (usd < 50) gate = target < 50 ? 'minimum_size' : restoring ? 'anchor_dust' : 'inventory_band';
      }
      if (gate) incGate(gate, matched, [{ base: m.base, protocol: v.protocol, side: buy ? 'buy' : 'sell' }]);
    }
    if (endgame) { incGate('endgame_bundle', matched); continue; }
    for (const cheap of m.venues) for (const rich of m.venues) {
      if (cheap.protocol === rich.protocol) continue;
      const edge = rich.mid / cheap.mid - 1 - cheap.cost - rich.cost;
      const route = [{ base: m.base, protocol: cheap.protocol, side: 'buy' }, { base: m.base, protocol: rich.protocol, side: 'sell' }];
      if (!old.entryAllowed(edge, old.PARAMS)) { incGate(edge > 0 ? 'entry_positive' : 'no_edge', matched, route); continue; }
      const target = old.sizeUsd(edge, 1 / cheap.depth + 1 / rich.depth, cash, cap, true);
      const usd = Math.min(target, held * cheap.mid / 1.008, Math.max(0, upper - held) * cheap.mid / 1.008,
        Math.max(0, held - lower) * cheap.mid, cap * Math.min(1, cheap.mid / m.fair));
      if (usd < 50) incGate(target < 50 ? 'minimum_size' : 'inventory_band', matched, route);
    }
  }
  for (const c of old.enumerateCandidates(o, old.PARAMS, cooling)) {
    const fee = old.bidWei(old.candidateObservation(o, c, bids), c.profit, c.gas, true);
    incGate(fee <= 0n ? 'bid' : old.netProfitUsd(o, c, fee) < .05 ? 'net_profit'
      : !old.reserveCandidate(o, c) ? 'funding' : BigInt(o.balances.ethWei) - BigInt(c.gas) * fee < 50000000000000000n
      ? 'gas_reserve' : 'eligible', matched, (c.action.type === 'bundle' ? c.action.actions : [c.action]).map(a => ({
        base: c.base, protocol: { swap: 'uniswap', balancerSwap: 'balancer', curveSwap: 'curve' }[a.type], side: a.tokenIn === 'USDC' ? 'buy' : 'sell' })));
  }
}
function evaluate(mod, o, cooling, bids) {
  const cs = mod.enumerateCandidates(o, mod.PARAMS, cooling), a = mod.selectCandidate(o, cs, mod.PARAMS, bids);
  const c = cs.find(c => JSON.stringify({ ...c.action, base: c.base, maxPriorityFeePerGasWei: a.maxPriorityFeePerGasWei }) === JSON.stringify(a));
  return { action: a, net: c ? mod.netProfitUsd(o, c, BigInt(a.maxPriorityFeePerGasWei)) : 0, usd: c?.usd ?? 0 };
}
const frames = [];
for (const row of csv(join(input, 'ascon-notes/eval/out/dev2-xb-r/index.tsv'), '\t')) {
  assert.ok(['31001', '31002'].includes(row.seed), 'diagnostic seeds only');
  const dir = join(input, row.run_dir), market = json(join(dir, 'market.json')), summary = json(join(dir, 'summary.json'));
  const receipts = csv(join(dir, 'blocks.csv')), byHash = new Map(receipts.map(r => [r.hash, r]));
  const logs = Object.fromEntries(['cand', 'multi-arb', 'clean-arb'].map(id => [id, lines(join(dir, `agents/${id}.jsonl`))]));
  const observed = new Map(), attempted = new Map(), refs = new Map();
  for (const x of logs.cand) {
    if (x.action) { observed.set(x.round, x); count(stats.reasons, x.reason ?? x.action.type); }
    if (['submitted', 'submit_failed'].includes(x.event)) {
      attempted.set(x.blockSeen, [...(attempted.get(x.blockSeen) ?? []), x]);
      if (x.event === 'submit_failed') count(stats.failures, x.error.split('\n')[0]);
    }
  }
  for (const id of ['multi-arb', 'clean-arb']) for (const x of logs[id]) {
    if (x.event !== 'submitted' || byHash.get(x.hash)?.status !== 'success') continue;
    refs.set(x.blockSeen, [...(refs.get(x.blockSeen) ?? []), { agent: id, base: x.base, protocol: x.protocol, side: market.notionals[x.hash]?.side,
      actionType: x.actionType, receiptBlock: Number(byHash.get(x.hash).blockNumber) }]);
  }
  const candAddress = summary.agents.find(a => a.id === 'cand').address;
  const wallet = { USDC: 25000, WETH: 8, WBTC: .4, ETH: 1 }, last = new Map();
  const world = { regime: row.regime, seed: row.seed, run: row.run_dir, elapsedMs: summary.elapsedMs,
    attempts: attempted.size, loggedNoops: observed.size, frames: 0, agreement: 0, factors: {}, sha256: {} };
  for (const f of ['market.json','blocks.csv','agents/cand.jsonl','agents/multi-arb.jsonl','agents/clean-arb.jsonl']) world.sha256[f] = digest(join(dir, f));
  const sortedReceipts = [...receipts].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.txIndex) - Number(b.txIndex));
  let receiptAt = 0;
  for (const m of market.series) {
    const block = m.block;
    while (receiptAt < sortedReceipts.length && Number(sortedReceipts[receiptAt].blockNumber) <= block) {
      const r = sortedReceipts[receiptAt++];
      if (r.ownerId !== 'cand') continue;
      wallet.ETH -= Number(r.gasUsed) * Number(r.priorityFeeWei) / 1e18;
      if (r.status !== 'success') continue;
      const n = market.notionals[r.hash];
      if (!n?.priceUsd || !n?.baseUnits) continue;
      const sign = n.side === 'buy' ? 1 : -1;
      wallet[n.base] += sign * n.baseUnits;
      wallet.USDC -= sign * n.baseUnits * n.priceUsd;
    }
    // Cooldown follows observed attempted decisions, including preflight rejects.
    for (const [at, xs] of attempted) if (at < block) for (const x of xs) last.set(x.base, Math.max(last.get(x.base) ?? -1, at));
    if (!observed.has(block) && !attempted.has(block)) continue;
    const o = { kind: 'observation', runId: summary.runId, round: block, blockNumber: String(block),
      blocksRemaining: summary.finalBlock - block, agentAddress: candAddress,
      fairPriceUsdcPerWeth: m.fair.WETH, fairPricesUsd: m.fair, baseDecimals: { WETH: 18, WBTC: 8 },
      baseBalances: { WBTC: String(Math.round(wallet.WBTC * 1e8)) },
      balances: { ethWei: String(BigInt(Math.floor(wallet.ETH * 1e18))), wethWei: String(BigInt(Math.round(wallet.WETH * 1e18))), usdcUnits: String(Math.round(wallet.USDC * 1e6)) },
      enabledProtocols: ['uniswap', 'balancer', 'curve'], history: [],
      limits: { defaultPriorityFeePerGasWei: '100000000', maxPriorityFeePerGasWei: '5000000000', defaultSlippageBps: 50 },
      competition: { maxCompetitorPriorityFeeWei: '6000000000' }, protocols: {} };
    for (const venue of ['uniswap', 'balancer', 'curve']) {
      const entries = {};
      for (const base of ['WETH', 'WBTC']) {
        const v = m.venues[venue]?.[base]; if (!v) continue;
        entries[base] = venue === 'uniswap' ? { pair: `${base}/USDC`, priceUsdcPerWeth: v.mid, fee: 3000, tick: 0, tickSpacing: 60 }
          : { priceUsdcPerWeth: v.mid, buyPriceUsdcPerWeth: v.buy, sellPriceUsdcPerWeth: v.sell,
            effectiveHalfSpreadBps: Math.max(0, (Math.sqrt(v.buy / v.sell) - 1) * 10000) };
      }
      o.protocols[venue] = venue === 'uniswap' ? { pool: entries.WETH, markets: { 'WBTC/USDC': entries.WBTC }, positions: [] }
        : { ...entries.WETH, markets: { 'WBTC/USDC': entries.WBTC } };
    }
    const bids = new Map(), transactions = [];
    for (const r of receipts.filter(r => Number(r.blockNumber) === block && r.from.toLowerCase() !== candAddress.toLowerCase())) {
      const base = market.notionals[r.hash]?.base;
      const target = r.method === 'exactInputSingle' ? UNISWAP.swapRouter : r.method === 'swap' ? BALANCER.vault
        : r.method === 'exchange' && base ? MARKET_LEGS.curve[base]?.pool : undefined;
      if (target) { const fee = BigInt(r.priorityFeeWei); if (fee > (bids.get(target.toLowerCase()) ?? 0n)) bids.set(target.toLowerCase(), fee); }
      transactions.push({ from: r.from, method: r.method, priorityFeeWei: r.priorityFeeWei, ...(base ? { receiptBase: base } : {}) });
    }
    const cooling = new Set([...last].filter(([, at]) => block - at < 2).map(([b]) => b));
    const matched = observed.has(block) && refs.has(block);
    gateBlocks = new Set(); matchingRoutes = refs.get(block) ?? [];
    trace(o, cooling, bids, matched);
    for (const g of gateBlocks) count(stats.matchedGateBlocks, g);
    const baseline = evaluate(old, o, cooling, bids), predictedTrade = baseline.action.type !== 'noop';
    count(stats.confusion, `${attempted.has(block) ? 'attempted' : 'noop'}_${predictedTrade ? 'trade' : 'noop'}`);
    const current = evaluate(repaired, o, cooling, bids), combined = evaluate(cases.combined60, o, cooling, bids);
    assert.deepEqual(current.action, combined.action, 'implemented defaults match the specified factor model');
    stats.repairedMatches++;
    world.frames++; if (predictedTrade === attempted.has(block)) world.agreement++;
    count(stats.coverage, observed.has(block) ? 'loggedNoopFrames' : 'attemptFrames');
    if (matched) {
      count(stats.coverage, 'noopWithReferenceSuccess');
      for (const id of new Set(refs.get(block).map(r => r.agent))) count(stats.coverage, `noopWith_${id}`);
    }
    const effects = {};
    for (const [name, mod] of Object.entries(cases)) {
      const result = evaluate(mod, o, name === 'cooldown0' ? new Set() : cooling, bids);
      const s = stats.factors[name] ??= { trades: 0, added: 0, addedOnLoggedNoop: 0, addedOnMatchedNoop: 0, modelNet: 0, addedNet: 0, usd: 0 };
      if (result.action.type !== 'noop') { s.trades++; s.modelNet += result.net; s.usd += result.usd; }
      if (!predictedTrade && result.action.type !== 'noop') {
        s.added++; s.addedNet += result.net; count(world.factors, name);
        if (observed.has(block)) s.addedOnLoggedNoop++;
        if (matched) s.addedOnMatchedNoop++;
        effects[name] = result;
      }
    }
    if (matched && Object.keys(effects).length) frames.push({ regime: row.regime, seed: row.seed, source: row.run_dir,
      observation: o, cooling: [...cooling], bids: [...bids].map(([k,v]) => [k, String(v)]),
      transactions, referenceTrades: refs.get(block), candDecision: observed.get(block), baseline, effects });
  }
  stats.worlds.push(world);
}
writeFileSync(join(output, 'analysis.json'), JSON.stringify(stats, null, 2) + '\n');
writeFileSync(join(output, 'frames.json'), JSON.stringify(frames) + '\n');
console.log(JSON.stringify({ reasons: stats.reasons, failures: stats.failures, coverage: stats.coverage,
  gates: stats.gates, matchedGates: stats.matchedGates, factors: stats.factors,
  agreement: stats.worlds.reduce((s,w) => s+w.agreement,0), frames: stats.worlds.reduce((s,w) => s+w.frames,0) }, null, 2));
