"""Bounded offline accounting of known diagnostic logs; never starts a runtime.

Usage: python3 ascon-notes/eval/diagnose-inc-zeta.py ../upstream-eval
Only writes this worktree's report and small reconstructed replay fixture.
"""
from pathlib import Path
import collections
import csv
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1]).resolve()
assert ROOT != SOURCE and SOURCE not in ROOT.parents
WEAK = {'cex-drift', 'informed-flow', 'lending-incident', 'vuln'}
GROUPS = ['incz-inc-zeta', 'mix1a-mix-v3', 'mix1b-mix-v3',
          'mix2a-mix-v3', 'mix2b-mix-v3', 'fref-inc-zeta', 'u1m']
SPOT = {'swap', 'balancerSwap', 'curveSwap'}


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rows(p, sep=','):
    with p.open() as f:
        return list(csv.DictReader(f, delimiter=sep))


def total():
    return dict(legs=0, E=0., M=0., cash=0., WETH=0., WBTC=0.)


worlds, fixtures = [], []
for group in GROUPS:
    index = SOURCE / 'ascon-notes/eval/out' / group / 'index.tsv'
    if not index.exists():
        continue
    for row in rows(index, '\t'):
        if group != 'incz-inc-zeta' and row['regime'] not in WEAK:
            continue
        d = SOURCE / row['run_dir']
        s = json.loads((d / 'summary.json').read_text())
        m = json.loads((d / 'market.json').read_text())
        agents = {a['id']: a for a in s['agents']}
        aid = 'cand' if group in ('incz-inc-zeta', 'fref-inc-zeta') else 'inc-zeta'
        if aid not in agents:
            continue
        a, noop = agents[aid], agents['noop']
        logpath = d / f'agents/{aid}.jsonl'
        logs = [dict(json.loads(line), sourceLine=i) for i, line in enumerate(logpath.open(), 1)]
        byhash = {x['hash']: x for x in logs if 'hash' in x}
        receipts = rows(d / 'blocks.csv')
        own = sorted((r for r in receipts if r['ownerId'] == aid and int(r['blockNumber']) <= s['finalBlock']),
                     key=lambda r: (int(r['blockNumber']), int(r['txIndex'])))
        points = {x['block']: x for x in m['series']}
        end = points[s['finalBlock']]
        F = end['fair']
        w = dict(group=group, **row, agent=aid, indexSha256=sha(index),
                 sha256={f: sha(d/f) for f in ['summary.json', 'market.json', 'blocks.csv', f'agents/{aid}.jsonl']},
                 excess=a['pnlUsdc']-noop['pnlUsdc'], P=a['pnlUsdc'], included=a['includedTxCount'],
                 reverts=a['revertCount'], loops=s['loopIterations'], violations=s['violations'],
                 failedReads=s['valueSeries']['failedReads'],
                 submissions=dict(collections.Counter(x.get('actionType') for x in logs if x.get('event') == 'submitted')),
                 failures=dict(collections.Counter(x.get('error', '').split('\n')[0] for x in logs if x.get('event') == 'submit_failed')),
                 gasEth=0., gasUsd=0., defaultTipUsd=0., elevatedTipUsd=0.,
                 gasUnits=0, maxFeeEqualsTip=True, spot=total(), modes={}, bundles={}, missingSpot=[],
                 specialist=[], launch=[], unpriced=s['valueSeries'].get('unpricedHoldings'),
                 spotWallet={'USDC': 25000., 'WETH': 8., 'WBTC': .4, 'ETH': 1.}, anchorMatches=[])
        lp = next((x for x in m.get('liquityPositionsAtEnd', []) if x['agent'] == aid), None)
        w['liquityAtEnd'] = lp
        included_hashes = {r['hash'] for r in own}
        w['outsideFinalWindowSubmissions'] = [dict(logLine=x['sourceLine'], blockSeen=x.get('blockSeen'), hash=x['hash'])
                                              for x in logs if x.get('event') == 'submitted' and x['hash'] not in included_hashes]
        w['revertedReceipts'] = [{k:r[k] for k in ['blockNumber','hash','bundleId','bundleIndex','gasUsed','priorityFeeWei']}
                                for r in own if r['status'] != 'success']
        wallet = w['spotWallet']
        snapshots = {}
        at = 0
        for block, point in sorted(points.items()):
            while at < len(own) and int(own[at]['blockNumber']) <= block:
                r = own[at]; at += 1
                x = byhash.get(r['hash'], {})
                kind = x.get('actionType', r['actionType'])
                gas = int(r['gasUsed'] or 0)
                tip = min(int(r['priorityFeeWei']), int(r['maxFeePerGasWei'] or r['priorityFeeWei']))
                cost = gas * tip / 1e18
                w['gasEth'] += cost; w['gasUsd'] += cost * F['WETH']; w['gasUnits'] += gas
                w['defaultTipUsd'] += gas * min(tip, 100000000) / 1e18 * F['WETH']
                w['elevatedTipUsd'] += gas * max(0, tip-100000000) / 1e18 * F['WETH']
                w['maxFeeEqualsTip'] &= r['maxFeePerGasWei'] == r['priorityFeeWei']
                wallet['ETH'] -= cost
                n = m['notionals'].get(r['hash'], {})
                if kind.startswith('liquity'):
                    w['specialist'].append(dict(block=int(r['blockNumber']), action=kind, status=r['status'], notional=n))
                    if kind == 'liquitySwapEusd' and r['status'] == 'success' and x.get('amount'):
                        wallet['USDC'] -= int(x['amount']) / 1e6
                if kind not in SPOT:
                    if not kind.startswith('liquity'):
                        w['launch'].append(dict(block=int(r['blockNumber']), action=kind, status=r['status']))
                    continue
                if r['status'] != 'success':
                    continue
                if not n.get('priceUsd') or n.get('base') not in ('WETH', 'WBTC'):
                    w['missingSpot'].append(r['hash']); continue
                base, qty = n['base'], n['baseUnits']
                sign = 1 if n['side'] == 'buy' else -1
                fair = points[int(r['blockNumber'])]['fair'][base]
                E, M, cash = sign*qty*(fair-n['priceUsd']), sign*qty*(F[base]-fair), -sign*qty*n['priceUsd']
                bundle = x.get('bundleId') or r['bundleId']
                mode = 'bundle' if bundle else 'single'
                if not bundle and base == 'WETH' and sign == -1 and kind == 'swap' and abs(qty-(wallet['WETH']-8)) < 1e-8:
                    mode = 'anchor-matched-sale'
                    w['anchorMatches'].append(dict(block=int(r['blockNumber']), logLine=x.get('sourceLine'),
                                                  qty=qty, before=wallet['WETH'], E=E, M=M))
                parts = [w['spot'], w['modes'].setdefault(mode, total())]
                if bundle:
                    parts.append(w['bundles'].setdefault(bundle, total()))
                for t in parts:
                    t['legs'] += 1; t['E'] += E; t['M'] += M; t['cash'] += cash; t[base] += sign*qty
                wallet['USDC'] += cash; wallet[base] += sign*qty
            snapshots[block] = dict(wallet)
        w['partialBundles'] = {k:v for k,v in w.pop('bundles').items() if v['legs'] != 2}
        # SP principal is a valued protocol position, not a zero-valued own contract.
        # The four weak incz worlds have one buy/deposit and no other specialist flow.
        if lp and len(w['specialist']) == 2 and set(x['action'] for x in w['specialist']) == {'liquitySwapEusd', 'liquityProvideToSP'}:
            p = end['stables']['EUSD']['sellPriceUsdc']
            w['liquityApproxContribution'] = lp['stabilityDepositEusd'] * p - 2500
        else:
            w['liquityApproxContribution'] = None
        w['residualBeforeSpecialist'] = w['excess']-w['spot']['E']-w['spot']['M']+w['gasUsd']
        w['residualAfterSpecialistApprox'] = (w['residualBeforeSpecialist']-w['liquityApproxContribution']
                                              if w['liquityApproxContribution'] is not None else None)
        w['valuation'] = dict(finalFair=F, finalValue=a['finalValueUsdc'], markedValue=a.get('markedValueUsdc'),
                              scoredFinal=s['valueSeries']['epochSeries']['valuesByAgent'][aid][-1],
                              noopScoredFinal=s['valueSeries']['epochSeries']['valuesByAgent']['noop'][-1])
        worlds.append(w)
        # Four small windows, provenance linked to actual cand/inc-zeta submission lines.
        if (group, row['regime'], row['seed']) not in {
            ('incz-inc-zeta', 'cex-drift', '40005'), ('incz-inc-zeta', 'informed-flow', '40005'),
            ('mix1a-mix-v3', 'cex-drift', '40001'), ('mix2a-mix-v3', 'informed-flow', '40003')}:
            continue
        eligible = [x for x in logs if x.get('event') == 'submitted' and x.get('actionType') in SPOT
                    and x.get('blockSeen') in points and int(x.get('priorityFeeWei', '0')) > 100000000]
        if not eligible:
            continue
        start = eligible[0]['blockSeen']
        observations = []
        for block in range(start, start+8):
            point = points[block]; wallet = snapshots[block]; protocols = {}
            for venue in ['uniswap', 'balancer', 'curve']:
                entries = {}
                for base, v in point['venues'][venue].items():
                    entries[base] = (dict(priceUsdcPerWeth=v['mid'], fee=3000) if venue == 'uniswap' else
                                     dict(priceUsdcPerWeth=v['mid'], buyPriceUsdcPerWeth=v['buy'], sellPriceUsdcPerWeth=v['sell'],
                                          effectiveHalfSpreadBps=max(0, ((v['buy']/v['sell'])**.5-1)*10000)))
                protocols[venue] = (dict(pool=entries['WETH'], markets={'WBTC/USDC': entries['WBTC']}) if venue == 'uniswap' else
                                    dict(**entries['WETH'], markets={'WBTC/USDC': entries['WBTC']}))
            # Match runtime/send.ts: max of ALL senders other than self (including oracle/flow).
            bids = [int(r['priorityFeeWei']) for r in receipts if int(r['blockNumber']) == block
                    and r['from'].lower() != a['address'].lower()]
            related = [x for x in logs if x.get('blockSeen', x.get('round')) == block]
            observations.append(dict(sourceLines=[x['sourceLine'] for x in related], observation=dict(
                kind='observation', runId=s['runId'], round=block, blockNumber=str(block),
                blocksRemaining=s['finalBlock']-block, fairPriceUsdcPerWeth=point['fair']['WETH'], fairPricesUsd=point['fair'],
                balances=dict(usdcUnits=str(round(wallet['USDC']*1e6)), wethWei=str(round(wallet['WETH']*1e18)), ethWei=str(round(wallet['ETH']*1e18))),
                baseBalances={'WBTC': str(round(wallet['WBTC']*1e8))}, baseDecimals={'WETH':18, 'WBTC':8},
                enabledProtocols=['uniswap','balancer','curve'], history=[], protocols=protocols,
                limits=dict(defaultPriorityFeePerGasWei='100000000',maxPriorityFeePerGasWei='5000000000',defaultSlippageBps=50),
                competition=dict(maxCompetitorPriorityFeeWei=str(max(bids, default=0))))))
        fixtures.append(dict(group=group, regime=row['regime'], seed=row['seed'], run=row['run_dir'],
                             agentLog=f'agents/{aid}.jsonl', sha256=w['sha256'], frames=observations))

report = dict(source=str(SOURCE), sourceHead='8303d85',
              method='E = signed qty*(inclusion fair - fill); M = signed qty*(final fair - inclusion fair). G = gasUsed*min(tip,maxFee)*final WETH. Residual retained; no causal counterfactual.',
              limitation='Full weak-world spot accounting only. spotWallet reconstructs spot flows, gas, and the logged two-step SP entry debit; it excludes other specialist credits/wrapping/launch flows. Other incz regimes are triage metadata, not complete wallet or recovery audits.', worlds=worlds)
(ROOT/'ascon-notes/eval/inc-zeta-diagnosis.json').write_text(json.dumps(report,indent=2)+'\n')
(ROOT/'test/fixtures/ascon-zeta-r-logs.json').write_text(json.dumps(dict(
    method='Reconstructed, not full observation replay: cand/inc-zeta.jsonl line anchors + market.json notionals/prices + blocks.csv receipts. Floating output balances; runtime all-other-sender max competitor bid (including oracle/flow); no Liquity/registry/RPC history. Same-input decision identity only, not historical action/performance equivalence.',
    windows=fixtures),indent=2)+'\n')
for w in worlds:
    if w['regime'] in WEAK:
        print(w['group'],w['regime'],w['seed'], 'excess/E/M/G/R',*(round(w[k],3) for k in ['excess']),
              round(w['spot']['E'],3),round(w['spot']['M'],3),round(w['gasUsd'],3),round(w['residualBeforeSpecialist'],3),
              'anchor',len(w['anchorMatches']), 'partial',len(w['partialBundles']))
print('worlds',len(worlds),'replay frames',sum(len(w['frames']) for w in fixtures))
