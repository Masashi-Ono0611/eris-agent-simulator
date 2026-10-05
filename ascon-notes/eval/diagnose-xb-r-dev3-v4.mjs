// Offline only. Reads dev3a + dev3b logs; writes ONLY the explicitly supplied output directory.
// node --import tsx ascon-notes/eval/diagnose-xb-r-dev3-v4.mjs ../upstream-eval /tmp/xb-r-dev3-v4
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
const frozenV3 = execFileSync('git', ['show', 'd30cbbb:example/agents/xb-r/agent.ts'], { cwd: root, encoding: 'utf8' });
const frozen = execFileSync('git', ['show', 'a646e9b:example/agents/xb-r/agent.ts'], { cwd: root, encoding: 'utf8' });
function replace(s, a, b) { assert.equal(s.split(a).length, 2, a); return s.replace(a, b); }
async function moduleFor(changes = [], source = frozen) {
  let s = source;
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
const old = await moduleFor(), v3 = await moduleFor([], frozenV3);
const repaired = await import(pathToFileURL(join(root, 'example/agents/xb-r/agent.ts')));
// Single-variable offline probes; these are decisions on fixed reconstructed v2 wallets, not realized P.
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
  v4fullDepth: { ...repaired, PARAMS: { ...repaired.PARAMS, R10_FULL_DEPTH_SIZE: true } },
  v4smallSingles: { ...repaired, PARAMS: { ...repaired.PARAMS, R11_SMALL_SINGLE_CAP: true } },
  v4headroom: { ...repaired, PARAMS: { ...repaired.PARAMS, R9_BUNDLE_HEADROOM: true } },
  v4singleGate: { ...repaired, PARAMS: { ...repaired.PARAMS, R7_SINGLE_ENTRY: false, SINGLE_EDGE_BPS: 75 } },
  v4backoff: { ...repaired, PARAMS: { ...repaired.PARAMS, R12_UNCONFIRMED_BACKOFF: true } },
  headroom10: await moduleFor([headroom]),
};
const { UNISWAP, BALANCER, MARKET_LEGS } = await import(pathToFileURL(join(root, 'sdk/src/constants.ts')));
const stats = { sourceCommit: 'a646e9b1f57ecd342c9f3810805798c55df7a0cf', scriptSha256: digest(fileURLToPath(import.meta.url)), v3Commit: 'd30cbbb46ca472b5a7a72fc1b99deab96dc97bf3', implementationSha256: digest(join(root, 'example/agents/xb-r/agent.ts')), worlds: [], reasons: {}, failures: {}, factorsVsV3: {}, gates: {}, matchedGates: {}, matchedRouteGates: {}, matchedGateBlocks: {}, factors: {}, coverage: {}, confusion: {}, repairedMatches: 0, defaultV3StatefulMatches: 0, defaultV3StatelessMatches: 0 };
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
      actions: {}, nonSpot: 0, E: 0, M: 0, G: 0, turnover: 0, legs: 0, missing: 0, bundles: {}, modes: {} };
    for (const l of logs[id]) { if(l.event === 'submitted') { z.submitted++; count(z.actions, l.actionType); if (!['swap', 'balancerSwap', 'curveSwap'].includes(l.actionType)) z.nonSpot++; } if(l.event === 'submit_failed') z.failed++; }
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
for (const row of ['dev3a-xb-r', 'dev3b-xb-r'].flatMap(group => csv(join(input, `ascon-notes/eval/out/${group}/index.tsv`), '\t'))) {
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
  const v3Agent = v3.createAgent(v3.PARAMS, () => 0), v4Agent = repaired.createAgent(repaired.PARAMS, () => 0);
  const observations = new Map(), candByHash = new Map(logs.cand.filter(x => x.hash).map(x => [x.hash, x]));
  const world = { regime: row.regime, seed: row.seed, run: row.run_dir, elapsedMs: summary.elapsedMs,
    attempts: attempted.size, loggedNoops: observed.size, frames: 0, agreement: 0, factors: {}, sha256: {}, loops: summary.loopIterations, violations: summary.violations, failedReads: summary.valueSeries.failedReads, accounts: account(summary, market, receipts, logs), factorsVsV3: {}, matchedGateBlocks: {} };
  const ps = summary.agents.filter(a => !a.baseline).map(a => a.pnlUsdc);
  const mu = ps.reduce((s,x) => s+x,0)/ps.length, sd = Math.sqrt(ps.reduce((s,x) => s+(x-mu)**2,0)/ps.length);
  world.T = Object.fromEntries(summary.agents.map(a => [a.id, 50 + 10 * (a.pnlUsdc-mu)/sd]));
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
    assert.deepEqual(v4Agent(o, undefined, { started: 0, bids }), v3Agent(o, undefined, { started: 0, bids }), 'v4 default state machine equals d30cbbb');
    stats.defaultV3StatefulMatches++;
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
    for (const g of gateBlocks) { count(stats.matchedGateBlocks, g); count(world.matchedGateBlocks, g); }
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
    const v3Result = evaluate(v3, o, settledCooling, bids);
    assert.deepEqual(evaluate(repaired, o, settledCooling, bids), v3Result, 'v4 default equals exact frozen d30cbbb');
    stats.defaultV3StatelessMatches++;
    const effects = {}, v4Effects = {};
    const backoffCooling = new Set(settledCooling);
    for (const [base, at] of last) {
      const xs = (attempted.get(at) ?? []).filter(x => x.base === base);
      const beforeAttempt = observations.get(at), afterAttempt = observations.get(at + 1);
      const x = xs[0], n = x && market.notionals[x.hash];
      const confirmed = xs.length === 1 && !x.bundleId && n && beforeAttempt && afterAttempt &&
        repaired.settledSingle(beforeAttempt, { type: x.actionType, base, tokenIn: n.side === 'buy' ? 'USDC' : base, amountIn: x.amount }, afterAttempt);
      if (xs.length === 1 && !x.bundleId && !confirmed && block - at < 4) backoffCooling.add(base);
    }
    for (const [name, mod] of Object.entries(cases)) {
      const result = evaluate(mod, o, name === 'cooldown0' ? new Set() : name === 'v4backoff' ? backoffCooling : (['settled60','combined50'].includes(name) || name.startsWith('v4')) ? settledCooling : cooling, bids);
      if (name.startsWith('v4')) {
        const changed = JSON.stringify(result.action) !== JSON.stringify(v3Result.action);
        for (const container of [stats.factorsVsV3, world.factorsVsV3]) {
          const t = container[name] ??= { added: 0, removed: 0, changed: 0, modelNetDelta: 0, usdDelta: 0 };
          t.added += Number(v3Result.action.type === 'noop' && result.action.type !== 'noop');
          t.removed += Number(v3Result.action.type !== 'noop' && result.action.type === 'noop');
          t.changed += Number(changed && v3Result.action.type !== 'noop' && result.action.type !== 'noop');
          t.modelNetDelta += result.net - v3Result.net; t.usdDelta += result.usd - v3Result.usd;
        }
        if (changed) v4Effects[name] = result;
      }
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
    if (Object.keys(v4Effects).length || Object.keys(effects).length || (predictedTrade && baseline.action.type !== "bundle")) frames.push({ regime: row.regime, seed: row.seed, source: row.run_dir,
      observation: o, cooling: [...cooling], bids: [...bids].map(([k,v]) => [k, String(v)]),
      transactions, referenceTrades: refs.get(block), candDecision: observed.get(block), baseline, v3: v3Result, effects, v4Effects, backoffCooling: [...backoffCooling], ...(settledFrame ? { settledFrame } : {}), matched, loggedNoop: observed.has(block) });
  }
  stats.worlds.push(world);
}
// N * mean-cash-size * cash-weighted edge: symmetric accounting attribution,
// averaged over the six substitution orders, not a causal return forecast.
const permutations = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
for (const w of stats.worlds) {
  const a = w.accounts.cand, b = w.accounts['multi-arb'];
  const old = [a.legs, a.averageLegUsd, a.E/a.turnover], next = [b.legs, b.averageLegUsd, b.E/b.turnover];
  const result = [0,0,0];
  for (const order of permutations) {
    const x = [...old];
    for (const i of order) { const before = x[0]*x[1]*x[2]; x[i] = next[i]; result[i] += (x[0]*x[1]*x[2]-before)/6; }
  }
  w.multiMinusCand = { P: b.P-a.P, count: result[0], size: result[1], edge: result[2], carry: b.M-a.M,
    gas: a.G-b.G, residual: b.X-a.X };
  assert.ok(Math.abs(w.multiMinusCand.P - Object.entries(w.multiMinusCand).filter(([k]) => k !== 'P').reduce((s,[,v]) => s+v,0)) < 1e-6);
}
assert.equal(stats.worlds.length, 24);
assert.equal(new Set(stats.worlds.map(w => `${w.regime}/${w.seed}`)).size, 24);
assert.equal(new Set(stats.worlds.map(w => w.regime)).size, 12);
stats.indexSha256 = Object.fromEntries(['dev3a-xb-r','dev3b-xb-r'].map(group => {
  const path = `ascon-notes/eval/out/${group}/index.tsv`; return [path, digest(join(input,path))];
}));
writeFileSync(join(output, 'analysis.json'), JSON.stringify(stats, null, 2) + '\n');
writeFileSync(join(output, 'frames.json'), JSON.stringify(frames) + '\n');
console.log(JSON.stringify({ reasons: stats.reasons, failures: stats.failures, coverage: stats.coverage,
  gates: stats.gates, matchedGates: stats.matchedGates, factors: stats.factors,
  factorsVsV3: stats.factorsVsV3, agreement: stats.worlds.reduce((s,w) => s+w.agreement,0), frames: stats.worlds.reduce((s,w) => s+w.frames,0) }, null, 2));

const picks = [
  ['cdp-size', f => f.regime === 'cdp-incident' && f.v4Effects.v4smallSingles],
  ['cdp-entry', f => f.regime === 'cdp-incident' && f.loggedNoop && f.effects.combined50 && !f.settledFrame],
  ['depeg-persist', f => f.regime === 'depeg-persist' && f.v4Effects.v4singleGate],
  ['launch', f => f.regime === 'launch' && f.v4Effects.v4singleGate],
  ['whale-headroom', f => f.regime === 'whale' && f.v4Effects.v4headroom?.action.type === 'noop' && f.v3.action.type !== 'noop'],
  ['calm-size', f => f.regime === 'calm' && f.v4Effects.v4smallSingles],
].map(([name, match]) => {
  const f = frames.find(match); assert.ok(f, name);
  const world = stats.worlds.find(w => w.run === f.source);
  return { name, regime: f.regime, seed: f.seed, source: f.source, sha256: world.sha256,
    observation: f.observation, cooling: f.cooling, transactions: f.transactions.filter(t => ['exactInputSingle', 'swap', 'exchange'].includes(t.method)).map(({ method, priorityFeeWei, receiptBase }) => ({ method, priorityFeeWei, ...(receiptBase ? { receiptBase } : {}) })),
    ...(f.settledFrame ? { settledFrame: f.settledFrame } : {}),
    referenceTrades: f.referenceTrades ?? [], candDecision: f.candDecision,
    expectedV3: f.v3.action, expectedV4: Object.fromEntries(Object.entries(f.v4Effects).map(([k,v]) => [k,v.action])) };
});
writeFileSync(join(output, 'fixture.json'), JSON.stringify({
  sourceCommit: stats.sourceCommit, goldenCommit: stats.v3Commit,
  scriptSha256: stats.scriptSha256,
  caveat: 'Post-run reconstruction, not runtime snapshots. Missing active liquidity uses 300000 USD fallback; input debit exact, proceeds rounded; raw tx.to unavailable. Expected v3 verified against git d30cbbb.',
  frames: picks }, null, 2) + '\n');

const opus = { worlds: 0, sources: [], all: {}, byRegime: {} };
for (const group of ['q0ba', 'q0bb', 'q0bc']) {
  const index = `ascon-notes/eval/out/${group}-opus-1/index.tsv`;
  for (const row of csv(join(input, index), '\t')) {
    assert.equal(row.exit_code, '0');
    const dir = join(input, row.run_dir), summary = json(join(dir, 'summary.json'));
    const logs = lines(join(dir, 'agents/cand.jsonl')), hashes = new Map(logs.filter(x => x.hash).map(x => [x.hash,x]));
    opus.worlds++;
    opus.sources.push({ regime: row.regime, seed: row.seed, run: row.run_dir,
      sha256: Object.fromEntries([index, ...['summary.json', 'blocks.csv', 'agents/cand.jsonl'].map(f => join(row.run_dir, f))].map(f => [f, digest(join(input, f))])) });
    const region = opus.byRegime[row.regime] ??= {};
    const inc = k => { count(opus.all, k); count(region, k); };
    for (const x of logs) if (['submitted', 'submit_failed'].includes(x.event)) inc(`${x.event}:${x.actionType}`);
    for (const r of csv(join(dir, 'blocks.csv'))) {
      if (r.ownerId !== 'cand' || Number(r.blockNumber) <= summary.runStartBlock || Number(r.blockNumber) > summary.finalBlock) continue;
      const log = hashes.get(r.hash);
      inc(`${r.status}:${log?.bundleId ? 'bundle' : log?.actionType ?? 'unknown'}`);
    }
  }
}
assert.equal(opus.worlds, 60);
writeFileSync(join(output, 'opus-audit.json'), JSON.stringify(opus, null, 2) + '\n');
