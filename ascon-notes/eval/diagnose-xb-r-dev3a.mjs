// Offline only. Reads dev3a logs; writes ONLY the explicitly supplied output directory.
// node --import tsx ascon-notes/eval/diagnose-xb-r-dev3a.mjs ../upstream-eval /tmp/xb-r-dev3a
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
const frozen = execFileSync('git', ['show', 'a646e9b:example/agents/xb-r/agent.ts'], { cwd: root, encoding: 'utf8' });
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
// Single-variable offline probes. Unsafe probes are diagnostic only, never live defaults.
const entry = n => ['ENTRY_BPS: 60,', `ENTRY_BPS: ${n},`];
const headroom = ['buy ? upper - held : held - lower',
  'buy ? initial * 1.1 - held : held - initial * .9'];
const cases = {
  baseline: old,
  settled60: { ...repaired, PARAMS: { ...repaired.DEV3A_PARAMS, R8_SETTLED_COOLDOWN: true } },
  combined50: repaired,
  entry50: await moduleFor([entry(50)]),
  entry45: await moduleFor([entry(45)]),
  entry20: await moduleFor([entry(20)]),
  sizeMax: await moduleFor([['const desired = floor ? Math.max(depthTarget, balanceTarget) : depthTarget;', 'const desired = edge / (2 * slope);']]),
  cap16: await moduleFor([['const cap = 0.08 *', 'const cap = 0.16 *']]),
  band40: await moduleFor([['const INV_BAND = 0.2;', 'const INV_BAND = 0.4;']]),
  min10: await moduleFor([
    ['if (!(usd >= 50)) continue;\n        const amount', 'if (!(usd >= 10)) continue;\n        const amount'],
    ['if (!(usd >= 50)) continue;\n      const spend', 'if (!(usd >= 10)) continue;\n      const spend']]),
  profit01: await moduleFor([['const MIN_PROFIT_USDC = 0.05;', 'const MIN_PROFIT_USDC = 0.01;']]),
  cooldown0: old,
  bidBudget: await moduleFor([['R4_COMPETITOR_BID: true,', 'R4_COMPETITOR_BID: false,']]),
  headroom10: await moduleFor([headroom]),
  headroom10entry50: await moduleFor([headroom, entry(50)]),
};
const { UNISWAP, BALANCER, MARKET_LEGS } = await import(pathToFileURL(join(root, 'sdk/src/constants.ts')));
const stats = { sourceCommit: 'a646e9b1f57ecd342c9f3810805798c55df7a0cf', scriptSha256: digest(fileURLToPath(import.meta.url)), implementationSha256: digest(join(root, 'example/agents/xb-r/agent.ts')), worlds: [], reasons: {}, failures: {}, gates: {}, matchedGates: {}, matchedRouteGates: {}, matchedGateBlocks: {}, factors: {}, coverage: {}, confusion: {}, repairedMatches: 0 };
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
      
      else {
        const target = old.sizeUsd(edge, 1 / v.depth, buy ? cash : held * v.mid, cap, true);
        const room = Math.max(0, restoring && endgame ? Math.abs(held - initial) : buy ? upper - held : held - lower);
        const usd = Math.min(target, room * v.mid / (buy ? 1.008 : 1), cap * Math.min(1, v.mid / m.fair));
        if (usd < 50) gate = target < 50 ? 'minimum_size' : restoring && endgame ? 'anchor_dust' : 'inventory_band';
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
  return { action: a, net: c ? mod.netProfitUsd(o, c, BigInt(a.maxPriorityFeePerGasWei)) : 0, usd: c?.usd ?? 0, gasUsd: c ? c.profit - mod.netProfitUsd(o, c, BigInt(a.maxPriorityFeePerGasWei)) : 0 };
}
function account(summary, market, receipts, logs) {
  const points = new Map(market.series.map(m => [m.block, m]));
  const final = points.get(summary.finalBlock).fair;
  const agents = Object.fromEntries(summary.agents.map(a => [a.id, a]));
  const out = {};
  for (const id of ['cand', 'multi-arb', 'clean-arb']) {
    const logByHash = new Map(logs[id].filter(l => l.hash).map(l => [l.hash, l]));
    const a = agents[id], z = out[id] = { P: a.pnlUsdc, excess: a.pnlUsdc - agents.noop.pnlUsdc,
      included: a.includedTxCount, reverts: a.revertCount, submitted: 0, failed: 0,
      E: 0, M: 0, G: 0, turnover: 0, legs: 0, missing: 0, bundles: {}, modes: {} };
    for (const l of logs[id]) { if(l.event === 'submitted') z.submitted++; if(l.event === 'submit_failed') z.failed++; }
    for (const r of receipts) {
      if (r.ownerId !== id || Number(r.blockNumber) <= summary.runStartBlock || Number(r.blockNumber) > summary.finalBlock) continue;
      z.G += Number(r.gasUsed) * Math.min(Number(r.priorityFeeWei), Number(r.maxFeePerGasWei)) / 1e18 * final.WETH;
      if (r.status !== 'success') continue;
      const n = market.notionals[r.hash];
      if (!n?.priceUsd || !n?.baseUnits || !['WETH','WBTC'].includes(n.base)) { z.missing++; continue; }
      const f = points.get(Number(r.blockNumber)).fair[n.base], F = final[n.base], sign = n.side === 'buy' ? 1 : -1;
      const E = sign * n.baseUnits * (f - n.priceUsd), M = sign * n.baseUnits * (F - f), cash = n.baseUnits * n.priceUsd;
      z.E += E; z.M += M; z.turnover += cash; z.legs++;
      const bundleId = logByHash.get(r.hash)?.bundleId ?? r.bundleId;
      const mode = bundleId ? 'bundle' : 'single';
      const t = z.modes[mode] ??= { legs: 0, turnover: 0, E: 0, M: 0, finalContribution: 0, quotedEdgeBpsSum: 0, quotedEdgeSamples: 0 };
      t.legs++; t.turnover += cash; t.E += E; t.M += M; t.finalContribution += E+M;
      const log = logByHash.get(r.hash), quote = points.get(log?.blockSeen)?.venues[log?.protocol]?.[n.base];
      if (quote) {
        const fair = points.get(log.blockSeen).fair[n.base];
        const edge = n.side === 'buy' ? fair / quote.buy - 1 : quote.sell / fair - 1;
        t.quotedEdgeBpsSum += edge * 10000; t.quotedEdgeSamples++;
      }
      if (bundleId) { const b = z.bundles[bundleId] ??= { legs: 0, cash: 0, qty: 0 }; b.legs++; b.cash -= sign * cash; b.qty += sign * n.baseUnits; }
    }
    z.X = z.excess - z.E - z.M + z.G;
    z.execEdgeBps = z.turnover ? z.E/z.turnover*10000 : 0;
    z.averageLegUsd = z.turnover / z.legs;
    z.bundleCount = Object.keys(z.bundles).length;
    z.partialBundles = Object.values(z.bundles).filter(b => b.legs !== 2).length;
    delete z.bundles;
  }
  return out;
}
const frames = [];
for (const row of csv(join(input, 'ascon-notes/eval/out/dev3a-xb-r/index.tsv'), '\t')) {
  assert.ok(['35001', '35002'].includes(row.seed), 'diagnostic seeds only');
  assert.equal(row.exit_code, '0', 'completed worlds only');
  const dir = join(input, row.run_dir), market = json(join(dir, 'market.json')), summary = json(join(dir, 'summary.json'));
  const receipts = csv(join(dir, 'blocks.csv')), byHash = new Map(receipts.map(r => [r.hash, r]));
  const logs = Object.fromEntries(['cand', 'multi-arb', 'clean-arb'].map(id => [id, lines(join(dir, `agents/${id}.jsonl`))]));
  const observed = new Map(), attempted = new Map(), refs = new Map();
  for (const x of logs.cand) {
    if (x.action) { observed.set(x.round, x); count(stats.reasons, x.reason ?? x.action.type); }
    if (['submitted', 'submit_failed'].includes(x.event)) {
      x.base ??= 'WETH'; // runtime omits the default base
      attempted.set(x.blockSeen, [...(attempted.get(x.blockSeen) ?? []), x]);
      if (x.event === 'submit_failed') count(stats.failures, x.error.split('\n')[0]);
    }
  }
  for (const id of ['multi-arb', 'clean-arb']) for (const x of logs[id]) {
    if (x.event !== 'submitted' || byHash.get(x.hash)?.status !== 'success') continue;
    refs.set(x.blockSeen, [...(refs.get(x.blockSeen) ?? []), { agent: id, base: x.base ?? 'WETH', protocol: x.protocol, side: market.notionals[x.hash]?.side,
      actionType: x.actionType, receiptBlock: Number(byHash.get(x.hash).blockNumber) }]);
  }
  const candAddress = summary.agents.find(a => a.id === 'cand').address;
  const wallet = { USDC: 25000000000n, WETH: 8000000000000000000n, WBTC: 40000000n, ETH: 1000000000000000000n }, last = new Map();
  const observations = new Map(), candByHash = new Map(logs.cand.filter(x => x.hash).map(x => [x.hash, x]));
  const world = { regime: row.regime, seed: row.seed, run: row.run_dir, elapsedMs: summary.elapsedMs,
    attempts: attempted.size, loggedNoops: observed.size, frames: 0, agreement: 0, factors: {}, sha256: {}, loops: summary.loopIterations, violations: summary.violations, failedReads: summary.valueSeries.failedReads, accounts: account(summary, market, receipts, logs) };
  for (const f of ['summary.json','market.json','blocks.csv','agents/cand.jsonl','agents/multi-arb.jsonl','agents/clean-arb.jsonl']) world.sha256[f] = digest(join(dir, f));
  const sortedReceipts = [...receipts].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.txIndex) - Number(b.txIndex));
  let receiptAt = 0;
  for (const m of market.series) {
    const block = m.block;
    while (receiptAt < sortedReceipts.length && Number(sortedReceipts[receiptAt].blockNumber) <= block) {
      const r = sortedReceipts[receiptAt++];
      if (r.ownerId !== 'cand') continue;
      wallet.ETH -= BigInt(r.gasUsed) * BigInt(r.priorityFeeWei);
      if (r.status !== 'success') continue;
      const n = market.notionals[r.hash];
      if (!n?.priceUsd || !n?.baseUnits) continue;
      const log = candByHash.get(r.hash), amount = log?.amount ? BigInt(log.amount) : undefined;
      const baseUnits = BigInt(Math.round(n.baseUnits * (n.base === 'WETH' ? 1e18 : 1e8)));
      const cashUnits = BigInt(Math.round(n.baseUnits * n.priceUsd * 1e6));
      // Exact logged input debits; output units remain a post-run reconstruction.
      if (n.side === 'buy') { wallet[n.base] += baseUnits; wallet.USDC -= amount ?? cashUnits; }
      else { wallet[n.base] -= amount ?? baseUnits; wallet.USDC += cashUnits; }
    }
    // Cooldown follows observed attempted decisions, including preflight rejects.
    for (const [at, xs] of attempted) if (at < block) for (const x of xs) last.set(x.base, Math.max(last.get(x.base) ?? -1, at));
    if (!observed.has(block) && !attempted.has(block)) continue;
    const o = { kind: 'observation', runId: summary.runId, round: block, blockNumber: String(block),
      blocksRemaining: summary.finalBlock - block, agentAddress: candAddress,
      fairPriceUsdcPerWeth: m.fair.WETH, fairPricesUsd: m.fair, baseDecimals: { WETH: 18, WBTC: 8 },
      baseBalances: { WBTC: String(wallet.WBTC) },
      balances: { ethWei: String(wallet.ETH), wethWei: String(wallet.WETH), usdcUnits: String(wallet.USDC) },
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
    observations.set(block, o);
    const cooling = new Set([...last].filter(([, at]) => block - at < 2).map(([b]) => b));
    const prevLogs = attempted.get(block - 1) ?? [], before = observations.get(block - 1);
    let settledFrame;
    if (before && prevLogs.length === 1 && !prevLogs[0].bundleId) {
      const x = prevLogs[0], n = market.notionals[x.hash];
      if (n) {
        const action = { type: x.actionType, base: x.base, tokenIn: n.side === 'buy' ? 'USDC' : n.base,
          amountIn: x.amount };
        if (repaired.settledSingle(before, action, o)) settledFrame = { observation: before, action,
          receiptBlock: Number(byHash.get(x.hash)?.blockNumber), status: byHash.get(x.hash)?.status };
      }
    }
    const settledCooling = new Set(cooling);
    if (settledFrame) { settledCooling.delete(settledFrame.action.base); count(stats.coverage, 'balanceConfirmedSingles'); }
    const matched = observed.has(block) && refs.has(block);
    gateBlocks = new Set(); matchingRoutes = refs.get(block) ?? [];
    trace(o, cooling, bids, matched);
    for (const g of gateBlocks) count(stats.matchedGateBlocks, g);
    const baseline = evaluate(old, o, cooling, bids), predictedTrade = baseline.action.type !== 'noop';
    count(stats.confusion, `${attempted.has(block) ? 'attempted' : 'noop'}_${predictedTrade ? 'trade' : 'noop'}`);
    assert.deepEqual(evaluate({ ...repaired, PARAMS: repaired.DEV3A_PARAMS }, o, cooling, bids).action,
      baseline.action, 'all v3 factors off reproduce a646e9b');
    assert.deepEqual(evaluate({ ...repaired, PARAMS: { ...repaired.DEV3A_PARAMS, R9_BUNDLE_HEADROOM: true } }, o, cooling, bids).action,
      evaluate(cases.headroom10, o, cooling, bids).action, 'R9 implements only the declared half-band probe');
    stats.repairedMatches++;
    world.frames++; if (predictedTrade === attempted.has(block)) world.agreement++;
    count(stats.coverage, observed.has(block) ? 'loggedNoopFrames' : 'attemptFrames');
    if (matched) {
      count(stats.coverage, 'noopWithReferenceSuccess');
      for (const id of new Set(refs.get(block).map(r => r.agent))) count(stats.coverage, `noopWith_${id}`);
    }
    const effects = {};
    for (const [name, mod] of Object.entries(cases)) {
      const result = evaluate(mod, o, name === 'cooldown0' ? new Set() : ['settled60','combined50'].includes(name) ? settledCooling : cooling, bids);
      const s = stats.factors[name] ??= { trades: 0, added: 0, addedOnLoggedNoop: 0, addedOnMatchedNoop: 0, modelNet: 0, addedNet: 0, usd: 0, removed: 0, changed: 0, addedUsd: 0, addedLegs: 0, maxAddedUsd: 0, addedBundle: 0, addedGasUsd: 0 };
      if (result.action.type !== 'noop') { s.trades++; s.modelNet += result.net; s.usd += result.usd; }
      if (predictedTrade && result.action.type === 'noop') s.removed++;
      if (predictedTrade && result.action.type !== 'noop' && JSON.stringify(result.action) !== JSON.stringify(baseline.action)) s.changed++;
      if (!predictedTrade && result.action.type !== 'noop') {
        s.added++; s.addedNet += result.net;
        s.addedGasUsd += result.gasUsd; s.addedUsd += result.usd; s.maxAddedUsd = Math.max(s.maxAddedUsd, result.usd);
        s.addedLegs += result.action.type === 'bundle' ? 2 : 1;
        if (result.action.type === 'bundle') s.addedBundle++; count(world.factors, name);
        if (observed.has(block)) s.addedOnLoggedNoop++;
        if (matched) s.addedOnMatchedNoop++;
        effects[name] = result;
      }
    }
    if (Object.keys(effects).length || (predictedTrade && baseline.action.type !== "bundle")) frames.push({ regime: row.regime, seed: row.seed, source: row.run_dir,
      observation: o, cooling: [...cooling], bids: [...bids].map(([k,v]) => [k, String(v)]),
      transactions, referenceTrades: refs.get(block), candDecision: observed.get(block), baseline, effects, ...(settledFrame ? { settledFrame } : {}), matched, loggedNoop: observed.has(block) });
  }
  stats.worlds.push(world);
}
writeFileSync(join(output, 'analysis.json'), JSON.stringify(stats, null, 2) + '\n');
writeFileSync(join(output, 'frames.json'), JSON.stringify(frames) + '\n');
console.log(JSON.stringify({ reasons: stats.reasons, failures: stats.failures, coverage: stats.coverage,
  gates: stats.gates, matchedGates: stats.matchedGates, factors: stats.factors,
  agreement: stats.worlds.reduce((s,w) => s+w.agreement,0), frames: stats.worlds.reduce((s,w) => s+w.frames,0) }, null, 2));
