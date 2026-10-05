// Offline only. Reads completed dev4a + dev4b logs; writes ONLY the explicitly supplied output directory.
// node --import tsx ascon-notes/eval/diagnose-xb-r-dev4-v5.mjs ../upstream-eval /tmp/xb-r-dev4-v5
import { readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.argv.length, 4, 'pass input tree and output directory with an existing parent');
const input = realpathSync(resolve(process.argv[2]));
const output = join(realpathSync(dirname(resolve(process.argv[3]))), basename(process.argv[3]));
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
const frozen = frozenV3;
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
const v3 = await moduleFor([], frozenV3);
const current = await import(pathToFileURL(join(root, 'example/agents/xb-r/agent.ts')));
const baselineParams = { ...current.PARAMS, R9_BUNDLE_HEADROOM: false, R10_FULL_DEPTH_SIZE: false,
  R11_SMALL_SINGLE_CAP: false, R12_UNCONFIRMED_BACKOFF: false, R13_EDGE_SLIPPAGE: false, ENTRY_BPS: 50 };
const repaired = { ...current, PARAMS: baselineParams };
const probes = { R9: { ...baselineParams, R9_BUNDLE_HEADROOM: true },
  R10: { ...baselineParams, R10_FULL_DEPTH_SIZE: true }, R11: { ...baselineParams, R11_SMALL_SINGLE_CAP: true },
  ENTRY45: { ...baselineParams, ENTRY_BPS: 45 }, R7: { ...baselineParams, R7_SINGLE_ENTRY: false, SINGLE_EDGE_BPS: 75 } };
const { UNISWAP, BALANCER, MARKET_LEGS } = await import(pathToFileURL(join(root, 'sdk/src/constants.ts')));
const stats = { sourceCommit: 'd30cbbb46ca472b5a7a72fc1b99deab96dc97bf3',
  sourceSha256: createHash('sha256').update(frozenV3).digest('hex'),
  scriptSha256: digest(fileURLToPath(import.meta.url)), worlds: [], coverage: {}, confusion: {},
  factors: {}, failures: {}, defaultV3StatefulMatches: 0, defaultV3StatelessMatches: 0,
  R10: { positiveCandidates: 0, depthOnlyLimited: 0 },
  R7: { successSingles50to75: 0, inclusionEdgeLessGas: 0, missingQuote: 0 },
  R12: { retryFailuresWithin4: 0, retryRevertsWithin4: 0, examples: [] } };
// First route gate after horizon/cooldown/ENTRY. Count each frame once even
// when multiple directed routes are blocked. These are reconstructed, NOT
// reasons emitted by the live runtime. Do not sum overlapping block counts.
function inventoryBlocked(o, cooling) {
  const ms = v3.markets(o), cash = Number(o.balances.usdcUnits) / 1e6;
  const cap = .08 * (cash + ms.reduce((s,m) => s + Number(m.held)/10**m.decimals*m.fair,0));
  const endgame = v3.remaining(o) <= 4;
  let blocked = false;
  if (v3.remaining(o) <= 0) return false;
  for (const m of ms) {
    const held = Number(m.held)/10**m.decimals, initial = m.base === 'WETH' ? 8 : .4;
    for (const v of m.venues) for (const buy of [true,false]) {
      const restoring = buy ? held < initial : held > initial;
      if (endgame && !restoring || cooling.has(m.base) && !(endgame && restoring)) continue;
      const edge = buy ? m.fair/v.mid-1-v.cost : v.mid/m.fair-1-v.cost;
      if (!v3.entryAllowed(edge,v3.PARAMS)) continue;
      const target = Math.min(v3.sizeUsd(edge,1/v.depth,buy ? cash : held*v.mid,cap,true),cap*Math.min(1,v.mid/m.fair));
      const room = Math.max(0,endgame && restoring ? Math.abs(held-initial) : buy ? initial*1.2-held : held-initial*.8);
      if (target >= 50 && room*v.mid/(buy ? 1.008 : 1) < 50) blocked = true;
    }
    if (endgame) continue;
    for (const cheap of m.venues) for (const rich of m.venues) {
      if (cheap.protocol === rich.protocol) continue;
      const edge = rich.mid/cheap.mid-1-cheap.cost-rich.cost;
      if (!v3.entryAllowed(edge,v3.PARAMS)) continue;
      const target = Math.min(v3.sizeUsd(edge,1/cheap.depth+1/rich.depth,cash,cap,true),held*cheap.mid/1.008,cap*Math.min(1,cheap.mid/m.fair));
      const room = Math.min(Math.max(0,initial*1.2-held)*cheap.mid/1.008,Math.max(0,held-initial*.8)*cheap.mid);
      if (target >= 50 && room < 50) blocked = true;
    }
  }
  return blocked;
}
const frames = [];
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
      const bundleId = logByHash.get(r.hash)?.bundleId ?? r.bundleId;
      if (bundleId) { const b = z.bundles[bundleId] ??= { legs: 0 }; b.legs++; }
      const n = market.notionals[r.hash];
      if (!n?.priceUsd || !n?.baseUnits || !['WETH','WBTC'].includes(n.base)) { z.missing++; continue; }
      const f = points.get(Number(r.blockNumber)).fair[n.base], F = final[n.base], sign = n.side === 'buy' ? 1 : -1;
      const E = sign * n.baseUnits * (f - n.priceUsd), M = sign * n.baseUnits * (F - f), cash = n.baseUnits * n.priceUsd;
      z.E += E; z.M += M; z.turnover += cash; z.legs++;
      const mode = bundleId ? 'bundle' : 'single';
      const t = z.modes[mode] ??= { legs: 0, turnover: 0, E: 0, M: 0, finalContribution: 0, quotedEdgeBpsSum: 0, quotedEdgeSamples: 0 };
      t.legs++; t.turnover += cash; t.E += E; t.M += M; t.finalContribution += E+M;
      const log = logByHash.get(r.hash), quote = points.get(log?.blockSeen)?.venues[log?.protocol]?.[n.base];
      if (quote) {
        const fair = points.get(log.blockSeen).fair[n.base];
        const edge = n.side === 'buy' ? fair / quote.buy - 1 : quote.sell / fair - 1;
        t.quotedEdgeBpsSum += edge * 10000; t.quotedEdgeSamples++;
      }
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
for (const row of ['dev4a-xb-r', 'dev4b-xb-r'].flatMap(group => csv(join(input, `ascon-notes/eval/out/${group}/index.tsv`), '\t'))) {
  assert.ok(['36001', '36002'].includes(row.seed), 'diagnostic seeds only');
  assert.equal(row.exit_code, '0', 'completed worlds only');
  const dir = join(input, row.run_dir), market = json(join(dir, 'market.json')), summary = json(join(dir, 'summary.json'));
  const receipts = csv(join(dir, 'blocks.csv')), byHash = new Map(receipts.map(r => [r.hash, r]));
  const logs = Object.fromEntries(['cand', 'multi-arb', 'clean-arb'].map(id => [id, lines(join(dir, `agents/${id}.jsonl`))]));
  const observed = new Map(), attempted = new Map(), refs = new Map();
  for (const x of logs.cand) {
    if (x.action?.type === 'noop') observed.set(x.round, x);
    if (['submitted', 'submit_failed'].includes(x.event)) {
      x.base ??= 'WETH'; // runtime omits the default base
      attempted.set(x.blockSeen, [...(attempted.get(x.blockSeen) ?? []), x]);
      if (x.event === 'submit_failed') count(stats.failures, x.error?.split('\n')[0] ?? 'missing error detail');
    }
  }
  for (const id of ['multi-arb', 'clean-arb']) for (const x of logs[id]) {
    if (x.event !== 'submitted' || byHash.get(x.hash)?.status !== 'success' ||
      +byHash.get(x.hash).blockNumber <= summary.runStartBlock || +byHash.get(x.hash).blockNumber > summary.finalBlock) continue;
    refs.set(x.blockSeen, [...(refs.get(x.blockSeen) ?? []), { agent: id, base: x.base ?? 'WETH', protocol: x.protocol, side: market.notionals[x.hash]?.side,
      actionType: x.actionType, receiptBlock: Number(byHash.get(x.hash).blockNumber) }]);
  }
  const candAddress = summary.agents.find(a => a.id === 'cand').address;
  const wallet = { USDC: 25000000000n, WETH: 8000000000000000000n, WBTC: 40000000n, ETH: 1000000000000000000n }, last = new Map();
  const v3Agent = v3.createAgent(v3.PARAMS, () => 0), offAgent = repaired.createAgent(repaired.PARAMS, () => 0);
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
    assert.deepEqual(offAgent(o, undefined, { started: 0, bids }), v3Agent(o, undefined, { started: 0, bids }), 'factor-OFF state machine equals d30cbbb');
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
    const matched = observed.has(block) && (refs.get(block) ?? []).some(x => x.agent === 'multi-arb');
    const base = evaluate(repaired, o, settledCooling, bids);
    assert.deepEqual(base, evaluate(v3, o, settledCooling, bids), 'OFF matches frozen v3');
    stats.defaultV3StatelessMatches++;
    world.frames++;
    const attemptedFrame = attempted.has(block), trade = base.action.type !== 'noop';
    if (attemptedFrame === trade) world.agreement++;
    count(stats.confusion, `${attemptedFrame ? 'attempt' : 'noop'}_${trade ? 'trade' : 'noop'}`);
    count(stats.coverage, 'frames');
    const band = inventoryBlocked(o, settledCooling);
    const effects = Object.fromEntries(Object.entries(probes).map(([k,p]) => [k,evaluate({ ...current, PARAMS:p },o,settledCooling,bids)]));
    for (const [k,result] of Object.entries(effects)) {
      const z = stats.factors[k] ??= { added:0, removed:0, changed:0, modelNetDelta:0 };
      z.added += Number(!trade && result.action.type !== 'noop');
      z.removed += Number(trade && result.action.type === 'noop');
      z.changed += Number(trade && result.action.type !== 'noop' && JSON.stringify(base.action) !== JSON.stringify(result.action));
      z.modelNetDelta += result.net-base.net;
    }
    if (matched) {
      count(stats.coverage,'noopWithMultiSuccess');
      count(world.matchedGateBlocks,'denominator');
      if (band) { count(stats.coverage,'inventoryBlocked'); count(world.matchedGateBlocks,'inventoryBlocked'); }
      if (!trade && effects.ENTRY45.action.type !== 'noop') {
        count(stats.coverage,'entry45OtherGatesPass'); count(world.matchedGateBlocks,'entry45OtherGatesPass');
      }
    }
    const full = current.enumerateCandidates(o,probes.R10,settledCooling);
    const ordinary = current.enumerateCandidates(o,baselineParams,settledCooling);
    const route = c => JSON.stringify([c.base,c.action.type,c.action.tokenIn,c.action.actions?.map(a => a.type)]);
    for (const c of full) {
      if (current.selectCandidate(o,[c],probes.R10,bids).type === 'noop') continue;
      stats.R10.positiveCandidates++;
      const off = ordinary.find(x => route(x) === route(c));
      // Strict other-hard-cap slack at the off size is demonstrated by a
      // larger full-depth candidate passing the identical safety selector.
      if (off && c.usd > off.usd+1e-6 && current.selectCandidate(o,[off],baselineParams,bids).type !== 'noop') stats.R10.depthOnlyLimited++;
    }
    frames.push({ regime:row.regime, seed:row.seed, source:row.run_dir, observation:o,
      cooling:[...settledCooling], bids:[...bids].map(([k,v])=>[k,String(v)]),
      transactions:transactions.filter(t=>['exactInputSingle','swap','exchange'].includes(t.method)).map(({method,priorityFeeWei,receiptBase})=>({method,priorityFeeWei,...(receiptBase?{receiptBase}:{})})),
      referenceTrades:refs.get(block)??[], matched, inventoryBlocked:band,
      loggedNoop:observed.has(block), expectedV3:base.action, expectedProbes:Object.fromEntries(Object.entries(effects).map(([k,v])=>[k,v.action])),
      ...(settledFrame?{settledFrame}:{}),
    });
  }
  // R7 quote bucket: decision-block mid/fee reconstructed with the frozen
  // strategy formula, inclusion E and actual gas from successful receipts.
  const points = new Map(market.series.map(m=>[m.block,m]));
  const final = points.get(summary.finalBlock).fair;
  for (const x of logs.cand.filter(x=>x.event === 'submitted' && !x.bundleId)) {
    const r = byHash.get(x.hash), n = market.notionals[x.hash], m = points.get(x.blockSeen);
    if (r?.status !== 'success' || +r.blockNumber <= summary.runStartBlock || +r.blockNumber > summary.finalBlock) continue;
    const v = m?.venues[x.protocol]?.[n?.base];
    if (!v || !n?.baseUnits || !n?.priceUsd) { stats.R7.missingQuote++; continue; }
    const cost = x.protocol === 'uniswap' ? .003 : Math.max(0,Math.sqrt(v.buy/v.sell)-1);
    const edge = (n.side === 'buy' ? m.fair[n.base]/v.mid-1-cost : v.mid/m.fair[n.base]-1-cost)*10000;
    if (edge > 50 && edge <= 75) {
      const E = (n.side === 'buy'?1:-1)*n.baseUnits*(points.get(+r.blockNumber).fair[n.base]-n.priceUsd);
      const gas = Number(r.gasUsed)*Math.min(Number(r.priorityFeeWei),Number(r.maxFeePerGasWei))/1e18*final.WETH;
      stats.R7.successSingles50to75++; stats.R7.inclusionEdgeLessGas += E-gas;
    }
  }
  // R12: all previous same-base singles, including failed submissions. A
  // next-block exact balance confirmation clears the unconfirmed status.
  const prior = new Map();
  for (const [block,xs] of [...attempted].sort((a,b)=>a[0]-b[0])) {
    for (const x of xs) {
      const prev = prior.get(x.base);
      if (prev && block-prev.blockSeen > 0 && block-prev.blockSeen <= 4) {
        const a = observations.get(prev.blockSeen), b = observations.get(prev.blockSeen+1), n = market.notionals[prev.hash];
        const confirmed = a && b && n && current.settledSingle(a,{type:prev.actionType,base:prev.base,tokenIn:n.side === 'buy'?'USDC':prev.base,amountIn:prev.amount},b);
        if (!confirmed && (x.event === 'submit_failed' || byHash.get(x.hash)?.status === 'reverted')) {
          const key = x.event === 'submit_failed' ? 'retryFailuresWithin4' : 'retryRevertsWithin4';
          stats.R12[key]++; stats.R12.examples.push({run:row.run_dir,base:x.base,previous:prev.blockSeen,block,event:x.event});
        }
      }
    }
    for (const x of xs) if (!x.bundleId) prior.set(x.base,x);
  }
  assert.equal(world.loops,362);
  assert.equal(summary.blocksProcessed,360);
  assert.deepEqual(world.violations,[]);
  assert.equal(world.accounts.cand.reverts,0);
  assert.equal(world.failedReads,0);
  assert.equal(summary.finalBlock-summary.runStartBlock,360);
  stats.worlds.push(world);
}
assert.equal(stats.worlds.length,24);
assert.equal(new Set(stats.worlds.map(w=>`${w.regime}/${w.seed}`)).size,24);
assert.equal(new Set(stats.worlds.map(w=>w.regime)).size,12);
stats.indexSha256 = Object.fromEntries(['dev4a-xb-r','dev4b-xb-r'].map(group=> {
  const p=`ascon-notes/eval/out/${group}/index.tsv`; return [p,digest(join(input,p))];
}));
const mean = xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const sum = fn=>stats.worlds.reduce((s,w)=>s+fn(w),0);
const A = id=>({T:mean(stats.worlds.map(w=>w.T[id])),P:mean(stats.worlds.map(w=>w.accounts[id].P)),
  submitted:sum(w=>w.accounts[id].submitted),failed:sum(w=>w.accounts[id].failed),
  bundles:sum(w=>w.accounts[id].bundleCount),partialBundles:sum(w=>w.accounts[id].partialBundles),
  singleCashMean:mean(stats.worlds.map(w=>w.accounts[id].modes.single.turnover/w.accounts[id].modes.single.legs)),
  singleCashPooled:sum(w=>w.accounts[id].modes.single.turnover)/sum(w=>w.accounts[id].modes.single.legs)});
stats.aggregate = {cand:A('cand'),multi:A('multi-arb')};
const {cand,multi} = stats.aggregate;
stats.triggerMetrics = { Tgap:cand.T-multi.T, bundleRatio:cand.bundles/multi.bundles,
  completeBundleRatio:(cand.bundles-cand.partialBundles)/(multi.bundles-multi.partialBundles),
  inventoryBlockRate:stats.coverage.inventoryBlocked/stats.coverage.noopWithMultiSuccess,
  singleSizeRatio:cand.singleCashMean/multi.singleCashMean,
  singleSizePooledRatio:cand.singleCashPooled/multi.singleCashPooled,
  depthLimitedRate:stats.R10.depthOnlyLimited/stats.R10.positiveCandidates,
  failedRate:cand.failed/(cand.submitted+cand.failed),
  entry45Rate:(stats.coverage.entry45OtherGatesPass??0)/stats.coverage.noopWithMultiSuccess };
stats.limitations = ['Post-run reconstructed observations, not runtime snapshots.',
  'Uniswap active liquidity missing: historical 300000 USD fallback. Output units rounded; logged input debits exact.',
  'Raw tx.to missing: bids reconstructed by receipt method/base; agreement is reported, not assumed.',
  'First-gate inventory blocks include routes whose downstream bid/profit gates may also fail.',
  'No alternate wallet trajectory or realized factor performance is measured. G0 PASS is user-reported, full G0 checker not rerun.'];
writeFileSync(join(output,'analysis.json'),JSON.stringify(stats,null,2)+'\n');
writeFileSync(join(output,'frames.json'),JSON.stringify(frames)+'\n');
const picks = [
  ['headroom-buy',f=>f.expectedV3.tokenIn==='USDC'&&f.expectedProbes.R9.type!=='noop'&&f.expectedV3.amountIn!==f.expectedProbes.R9.amountIn],
  ['headroom-sell',f=>f.expectedV3.tokenIn==='WETH'&&f.expectedProbes.R9.type!=='noop'&&f.expectedV3.amountIn!==f.expectedProbes.R9.amountIn],
  ['headroom-reject',f=>f.expectedV3.type!=='noop'&&f.expectedProbes.R9.type==='noop'],
  ['bundle-unchanged',f=>f.expectedV3.type==='bundle'],
  ['matched-inventory',f=>f.matched&&f.inventoryBlocked],
  ['entry45-only',f=>f.matched&&f.expectedV3.type==='noop'&&f.expectedProbes.ENTRY45.type!=='noop'],
].map(([name,predicate])=> {
  const f=frames.find(predicate); assert.ok(f,name);
  const w=stats.worlds.find(w=>w.run===f.source);
  return {name,...f,sha256:w.sha256};
});
writeFileSync(join(output,'fixture.json'),JSON.stringify({sourceCommit:stats.sourceCommit,
  sourceSha256:stats.sourceSha256,scriptSha256:stats.scriptSha256,caveats:stats.limitations,frames:picks},null,2)+'\n');
console.log(JSON.stringify({aggregate:stats.aggregate,coverage:stats.coverage,confusion:stats.confusion,
  triggerMetrics:stats.triggerMetrics,R7:stats.R7,R10:stats.R10,R12:stats.R12,factors:stats.factors,failures:stats.failures},null,2));
