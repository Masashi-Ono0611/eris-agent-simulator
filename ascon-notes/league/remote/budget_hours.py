#!/usr/bin/env python3
"""Offline, stdlib-only reconstruction. Prints evidence; never modifies inputs.

Chunk endpoints between indexed chunks include unknown audit/idle time.
Air marker +1h is an explicit sensitivity hypothesis, NOT a timezone repair.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import statistics

JST = timezone(timedelta(hours=9))
UTC = timezone.utc
CUTOFF = datetime(2026, 10, 4, 1, tzinfo=JST)
DEADLINE = datetime(2026, 10, 31, 23, 59, tzinfo=JST)


def run_time(value):
    return datetime.strptime(value.removeprefix('runs/'), '%Y-%m-%dT%H-%M-%S-%fZ').replace(tzinfo=UTC).astimezone(JST)


def union(intervals):
    result = []
    for start, end in sorted(intervals):
        if end < start:
            raise ValueError('end precedes start')
        start = max(start, CUTOFF)
        if end <= start:
            continue
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(end, result[-1][1]))
        else:
            result.append((start, end))
    return result


def hours(intervals):
    return sum((b-a).total_seconds()/3600 for a,b in union(intervals))


def days(intervals):
    result = defaultdict(float)
    for a,b in union(intervals):
        a, b = a.astimezone(JST), b.astimezone(JST)
        while a < b:
            stop = min(b, datetime.combine(a.date()+timedelta(days=1), datetime.min.time(), JST))
            result[str(a.date())] += (stop-a).total_seconds()/3600
            a = stop
    return dict(result)


def indexes(root):
    """Deduplicate aggregate and split copies by run directory; reject conflicts."""
    seen = {}
    groups = defaultdict(list)
    for path in sorted((root/'indexes').glob('*-index.tsv')):
        for n,line in enumerate(path.read_text().splitlines(),1):
            chunk,regime,seed,run,exit_code = line.split('\t')
            record = (chunk,regime,seed,exit_code)
            if run in seen:
                if seen[run] != record:
                    raise ValueError('conflicting index: '+run)
                continue
            seen[run] = record
            groups[chunk].append((run_time(run), f'{path.relative_to(root)}:{n}'))
    return {k: sorted(v) for k,v in groups.items()}


def stamp(value):
    return value.isoformat(timespec='milliseconds')


def analyze(root):
    groups = indexes(root)
    markers = {}
    for host in ('mini','air'):
        path = root/f'{host}-chain-log-dirs.txt'
        for n,line in enumerate(path.read_text().splitlines(),1):
            parts = line.split()
            markers[Path(parts[0]).name] = (datetime.fromisoformat(parts[1]).replace(tzinfo=JST) if len(parts)>1 else None, f'{path.name}:{n}')
    # Aggregate index aliases map to actual launches, never to prefix timestamps.
    aliases = {'e1':'e1','e3b':'e3','e4aa':'e4','e4bb':'e4','e5r3a':'e5','e5bb':'e5','e6r3':'e6','e7r3c':'e7','e8r3c':'e8'}
    strict = defaultdict(list)
    corrected = defaultdict(list)
    pass_only = defaultdict(list)
    launches = defaultdict(list)
    durations = []
    classifications = defaultdict(list)
    air_spans = []
    print('CHUNKS: host | chunk | start JST | end JST | hours | status | endpoint | sources')
    for host in ('mini','air'):
        for path in sorted((root/f'{host}-logs').glob('*chain.log')):
            lines = path.read_text().splitlines()
            run = next((re.search(r'RUN prefix=(\S+)',l) for l in lines if l.startswith('RUN prefix=')),None)
            if not run:
                continue
            prefix = run[1]; short = prefix.split('-')[0]
            end, marker_source = markers[prefix]
            chunks = []
            for n,l in enumerate(lines,1):
                m = re.match(r'CHUNK (\d+) label=(\S+)',l)
                if not m: continue
                label = m[2]; alias = aliases.get(short)
                key = f'{alias}-c{m[1]}' if alias else label
                result = next((re.search(r'matrix_rc=(\d+) verify_rc=(\d+) g0_rc=(\d+)',v) for v in lines if v.startswith('RESULT '+label+' ')),None)
                status = ('INTERRUPTED/NO_RESULT' if any('CHAIN_END_' in v for v in lines) else 'RUNNING/NO_RESULT') if result is None else ('RUNNER_FAIL' if result[1]!='0' or result[2]!='0' else {'0':'PASS','1':'preserved-FAIL','2':'BLOCKED'}.get(result[3],'UNKNOWN'))
                if key not in groups:
                    print(f'{host} | {label} | UNKNOWN | {stamp(end) if end else "UNKNOWN"} | UNKNOWN | {status} | no index | {path.relative_to(root)}:{n}; {marker_source}')
                    continue
                chunks.append((label,groups[key],status,n))
            if not chunks: continue
            start = chunks[0][1][0][0]; last = chunks[-1][1][-1][0]
            valid = end is not None and end >= last
            if host=='air':
                air_spans.append((start,last))
            print(f'LAUNCH | {host} | {prefix} | {stamp(start)} .. {stamp(end) if valid else "UNKNOWN"} | {hours([(start,end)]) if valid else "UNKNOWN"}h')
            if valid:
                strict[host].append((start,end)); corrected[host].append((start,end))
                launches[host].append((start,end,prefix))
            elif end is not None:
                print(f'INVALID_MARKER | {prefix} | last_start={stamp(last)} > end={stamp(end)} | {marker_source}')
                # Only under the explicitly labelled +1h hypothesis.
                shifted = end+timedelta(hours=1)
                if shifted < last: raise ValueError('even +1h marker inconsistent')
                corrected[host].append((start,shifted))
            for i,(label,entries,status,line) in enumerate(chunks):
                a=entries[0][0]; last_start=entries[-1][0]
                b=chunks[i+1][1][0][0] if i+1<len(chunks) else end
                method='next chunk first start (audit/idle unresolved)' if i+1<len(chunks) else 'end marker'
                refs=f'{entries[0][1]}, {entries[-1][1]}; {path.relative_to(root)}:{line}; {marker_source}'
                if b is None or b<last_start:
                    print(f'{host} | {label} | {stamp(a)} | UNKNOWN (last start {stamp(last_start)}) | UNKNOWN | {status} | {method} invalid/missing | {refs}')
                else:
                    h=hours([(a,b)])
                    print(f'{host} | {label} | {stamp(a)} | {stamp(b)} | {h:.6f} | {status} | {method} | {refs}')
                    if host=='mini':
                        durations.append(h)
                        classifications[status].append((a,b))
                        if status=='PASS':pass_only[host].append((a,b))
    # Timestamped mini rehearsal: use begin..done, do not count qb/pb duplicates.
    for name in ('chain-qz2.log','chain-p60.log'):
        path=root/'mini-logs'/name; current=None
        for n,line in enumerate(path.read_text().splitlines(),1):
            m=re.search(r'(2026-\d\d-\d\d \d\d:\d\d:\d\d) JST chunk (\d+) (begin|done)',line)
            if not m: continue
            t=datetime.fromisoformat(m[1]).replace(tzinfo=JST)
            if m[3]=='begin':current=(t,n)
            else:
                a,first_line=current
                for table in (strict,corrected,pass_only):table['mini'].append((a,t))
                classifications['PASS'].append((a,t))
                print(f'mini | {name}:c{m[2]} | {stamp(a)} | {stamp(t)} | {hours([(a,t)]):.6f} | PASS | timestamped begin/done | mini-logs/{name}:{first_line}-{n}')
    print('CLASSIFIED_MINI', {k:hours(v) for k,v in classifications.items()})
    print('CLASSIFIED_MINI_DAILY', {k:days(v) for k,v in classifications.items()})
    print(f'AIR_FIRST_TO_LAST_START_SPANS={hours(air_spans):.6f}h; tails/failed attempts UNKNOWN (not a full occupation total)')
    print('DAILY_STRICT_COMPLETE_ENVELOPES', {h:days(v) for h,v in strict.items()})
    mini=hours(strict['mini']); hyp_air=hours(corrected['air'])
    print(f'KNOWN_SPAN_SUBTOTAL mini+Air_start_spans={mini+hours(air_spans):.6f}h; residual={100-mini-hours(air_spans):.6f}h minus UNKNOWN (envelope convention)')
    print(f'TOTAL_STRICT mini={mini:.6f}h; Air=UNKNOWN; sum={mini:.6f}h + UNKNOWN; 100-minus-known={100-mini:.6f}h (NOT available balance)')
    print(f'PASS_ENVELOPE mini={hours(pass_only["mini"]):.6f}h; not pure simulator runtime; Air UNKNOWN')
    print(f'AIR_MARKER_PLUS_1H_HYPOTHESIS Air={hyp_air:.6f}h; combined={mini+hyp_air:.6f}h; residual={100-mini-hyp_air:.6f}h minus unrecorded cost')
    print('GAPS_BETWEEN_INDEXED_MINI_LAUNCHES (occupation UNKNOWN; not included)')
    for prev,nxt in zip(sorted(launches['mini']),sorted(launches['mini'])[1:]):
        a,b=prev[1],nxt[0]
        print(f'{prev[2]} -> {nxt[2]} | {stamp(a)} .. {stamp(b)} | {hours([(a,b)]):.6f}h')
    print('RELAUNCH_GAPS E4/E5 only (optional continuous-experiment envelope)')
    gap_hours=0
    for old,new in [('e4aa','e4bb'),('e5r3a','e5bb')]:
        a=next(x[1] for x in launches['mini'] if x[2].startswith(old+'-'))
        b=next(x[0] for x in launches['mini'] if x[2].startswith(new+'-'))
        gap_hours+=hours([(a,b)])
    print(f'relaunch_gap={gap_hours:.6f}h; mini_inclusive={mini+gap_hours:.6f}h; corrected_air_combined_inclusive={mini+hyp_air+gap_hours:.6f}h; residual={100-mini-hyp_air-gap_hours:.6f}h minus unrecorded cost')
    lo,mid,hi=min(durations),statistics.median(durations),max(durations)
    print(f'ESTIMATE mini 9-world chunk n={len(durations)} min/median/max={lo:.6f}/{mid:.6f}/{hi:.6f}h; E9 full 4 chunks={4*lo:.6f}/{4*mid:.6f}/{4*hi:.6f}h; E9 final chunk empirical estimate up to {hi:.6f}h from its unknown start; remaining from snapshot UNKNOWN')
    p60=[]
    for line in (root/'mini-logs'/'chain-p60.log').read_text().splitlines():
        m=re.search(r'(2026-\d\d-\d\d \d\d:\d\d:\d\d) JST chunk \d+ (begin|done)',line)
        if m:
            t=datetime.fromisoformat(m[1]).replace(tzinfo=JST)
            if m[2]=='begin': a=t
            else:p60.append(hours([(a,t)]))
    print(f'ESTIMATE E10 60 worlds same layout as P60: prior={sum(p60):.6f}h; 4*min/max chunk={4*min(p60):.6f}/{4*max(p60):.6f}h; no startup/audit/retry reserve')
    anchor=max(b for a,b in strict['mini'])
    print(f'CALENDAR anchor latest verified end={stamp(anchor)}; deadline={stamp(DEADLINE)}; delta={(DEADLINE-anchor).total_seconds()/3600:.6f}h; not snapshot/current time')
    mgs=(root/'mini-logs/mgs.log').read_text()
    mts=re.findall(r'2026-\d\d-\d\d \d\d:\d\d:\d\d',mgs)
    a,b=(datetime.fromisoformat(mts[i]).replace(tzinfo=JST) for i in (0,-1))
    print(f'MGS_TIMEZONE_UNLABELLED assumed JST only: {stamp(a)} .. {stamp(b)}; {hours([(a,b)]):.6f}h; mini with MGS={mini+hours([(a,b)]):.6f}h')
    for ledger in (root/'ledger.jsonl', root.parent/'ascon-notes/league/ledger.jsonl'):
        if ledger.exists():
            import json
            rows=[json.loads(l) for l in ledger.read_text().splitlines()]
            print('LEDGER',str(ledger),'rows',len(rows),[(x['round'],x['datetime']) for x in rows])


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('data', type=Path)
    args=p.parse_args();analyze(args.data)


if __name__=='__main__': main()
