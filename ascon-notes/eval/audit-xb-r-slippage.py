"""Offline audit of completed dev2/dev3 logs; never writes into the log tree.

python3 ascon-notes/eval/audit-xb-r-slippage.py ../upstream-eval /tmp/xb-slippage.json
The benchmark quote is a block-end probe, NOT the SDK's amount-specific quote.
"""
import collections
import csv
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
source, output = map(lambda p: Path(p).resolve(), sys.argv[1:])
assert output != source and source not in output.parents
read_json = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
dev2 = read_json(ROOT / 'ascon-notes/eval/dev2-xb-r-analysis.json')['worlds']
dev3 = read_json(ROOT / 'ascon-notes/eval/dev3-v4-xb-r-analysis.json')['worlds']


def distribution(values):
    values = sorted(values)
    if not values:
        return {'n': 0}
    return {'n': len(values), 'min': values[0], 'median': values[(len(values)-1)//2],
            'p95': values[math.ceil(.95*len(values))-1], 'max': values[-1],
            **{f'gt{n}': sum(x > n for x in values) for n in [0, 30, 50, 80]}}


report = {'exactQuoteSlippage': None,
          'reason': 'No amount-specific SDK quote, minOut or transaction calldata in cand/summary/events/blocks. market.json is a different-size block-end probe (Uniswap: mid plus fee).',
          'proxyPriceBps': 'buy=(fill/benchmark-1)*10000; sell=(1-fill/benchmark)*10000; positive=worse',
          'proxyOutputLossBps': 'buy=(1-benchmark/fill)*10000; sell=(1-fill/benchmark)*10000',
          'caveat': 'Proxy includes own size impact, probe-size differences and intervening state changes; cannot identify SDK quote slippage or infer tighter-minOut fill counts.',
          'groups': {}, 'sources': [], 'samples': []}
for group, worlds in [('dev2', dev2), ('dev3a', dev3[:12]), ('dev3b', dev3[12:])]:
    samples, counts = [], collections.Counter()
    fields = {k: set() for k in ['candSubmitted', 'candObservation', 'candTxSubmitted', 'summary']}
    for w in worlds:
        directory = source / w['run']
        files = ['agents/cand.jsonl', 'summary.json', 'events.jsonl', 'market.json', 'blocks.csv']
        hashes = {f: sha(directory / f) for f in files}
        for f, digest in hashes.items():
            if f in w['sha256']:
                assert digest == w['sha256'][f], (w['run'], f, 'completed log changed')
        summary, market = (read_json(directory / f) for f in ['summary.json', 'market.json'])
        fields['summary'].update(summary)
        logs = [json.loads(s) for s in (directory / 'agents/cand.jsonl').read_text().splitlines()]
        submitted = {x['hash']: x for x in logs if x.get('event') == 'submitted'}
        counts['submitted'] += len(submitted)
        for x in submitted.values():
            fields['candSubmitted'].update(x)
        for line in (directory / 'events.jsonl').open():
            x = json.loads(line)
            if x.get('type') == 'observation' and x.get('agentId') == 'cand':
                fields['candObservation'].update(x['observation'])
            if x.get('type') == 'tx_submitted' and x.get('ownerId') == 'cand':
                fields['candTxSubmitted'].update(x)
        points = {x['block']: x for x in market['series']}
        for r in csv.DictReader((directory / 'blocks.csv').open()):
            if r['ownerId'] != 'cand' or not summary['runStartBlock'] < int(r['blockNumber']) <= summary['finalBlock']:
                continue
            counts[r['status']] += 1
            if r['status'] != 'success':
                continue
            log, n = submitted.get(r['hash']), market['notionals'].get(r['hash'])
            if not log or not n or not n.get('priceUsd') or n.get('side') not in ['buy', 'sell']:
                counts['missingFill'] += 1
                continue
            q = points.get(log['blockSeen'], {}).get('venues', {}).get(log['protocol'], {}).get(n['base'], {})
            benchmark = q.get(n['side'])
            if not benchmark:
                counts['missingBenchmark'] += 1
                continue
            fill = n['priceUsd']
            price_bps = (fill/benchmark-1 if n['side'] == 'buy' else 1-fill/benchmark)*10000
            output_bps = (1-benchmark/fill if n['side'] == 'buy' else 1-fill/benchmark)*10000
            sample = {'group': group, 'run': w['run'], 'hash': r['hash'], 'regime': w['regime'],
                      'base': n['base'], 'side': n['side'], 'protocol': log['protocol'],
                      'mode': 'bundle' if log.get('bundleId') else 'single',
                      'blockSeen': log['blockSeen'], 'receiptBlock': int(r['blockNumber']),
                      'benchmark': benchmark, 'fill': fill,
                      'priceBps': price_bps, 'outputLossBps': output_bps}
            samples.append(sample)
        assert all(sha(directory / f) == digest for f, digest in hashes.items())
        report['sources'].append({'group': group, 'run': w['run'], 'sha256': hashes})
    report['groups'][group] = {'worlds': len(worlds), **counts, 'exactQuotePairs': 0,
                              'loggedFields': {k: sorted(v) for k, v in fields.items()},
                              'proxyPriceBps': distribution([s['priceBps'] for s in samples]),
                              'proxyOutputLossBps': distribution([s['outputLossBps'] for s in samples]),
                              'byMode': {mode: distribution([s['priceBps'] for s in samples if s['mode'] == mode])
                                         for mode in ['single', 'bundle']}}
    report['samples'].extend(samples)
report['scriptSha256'] = sha(Path(__file__))
output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({g: {k: v for k, v in x.items() if k != 'loggedFields'} for g, x in report['groups'].items()}, indent=2))
