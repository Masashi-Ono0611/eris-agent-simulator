#!/usr/bin/env python3
"""Offline, stdlib-only reconstruction. Prints evidence; never modifies inputs.

Chunk endpoints between indexed chunks include unknown audit/idle time.
Air marker +1h is an explicit sensitivity hypothesis, NOT a timezone repair.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import statistics
import sys

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


RESULTS = ('PASS', 'FAIL', 'BLOCKED', 'RUNNER_FAILED', 'STOPPED', 'INTERRUPTED')
KEY_FIELDS = ('host', 'prefix', 'label', 'chunk')


def ledger_object(pairs):
    row = {}
    for key, value in pairs:
        if key in row:
            raise ValueError('malformed JSON: duplicate object field')
        row[key] = value
    return row


def reject_json_constant(value):
    raise ValueError('malformed JSON: non-finite number')


def ledger_key(row):
    if not isinstance(row, dict):
        raise ValueError('event must be a JSON object')
    if any(not isinstance(row.get(k), str) or not row[k].strip()
           for k in KEY_FIELDS[:3]):
        raise ValueError('host, prefix and label must be nonempty strings')
    if type(row.get('chunk')) is not int or row['chunk'] < 1:
        raise ValueError('chunk must be a positive integer')
    return tuple(row[k] for k in KEY_FIELDS)


def ledger_time(value):
    # Require explicit UTC, never interpret a naive timestamp as local time.
    if not isinstance(value, str) or not re.fullmatch(
            r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value):
        raise ValueError('unparseable time: expected UTC timestamp ending in Z')
    try:
        return datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError as exc:
        raise ValueError('unparseable time: invalid calendar date or time') from exc


def validate_ledger_event(row):
    if type(row.get('schema_version')) is not int or row['schema_version'] != 1:
        raise ValueError('unknown schema version (expected 1)')
    if row.get('event') not in ('chunk_start', 'chunk_end'):
        raise ValueError('unknown event')
    start = ledger_time(row.get('utc_start'))
    offset = row.get('local_utc_offset')
    if not isinstance(offset, str) or not re.fullmatch(r'[+-](?:[01]\d|2[0-3])[0-5]\d', offset):
        raise ValueError('invalid local_utc_offset')
    if type(row.get('pid')) is not int or row['pid'] <= 0:
        raise ValueError('invalid pid')
    if 'relaunch_of' not in row or (row['relaunch_of'] is not None and
                                  not isinstance(row['relaunch_of'], str)):
        raise ValueError('invalid relaunch_of')
    codes = row.get('exit_codes')
    if not isinstance(codes, dict) or any(
            code is not None and (type(code) is not int or code < 0)
            for code in codes.values()):
        raise ValueError('invalid exit_codes')
    if row['event'] == 'chunk_start':
        if 'utc_end' not in row or 'result' not in row or row['utc_end'] is not None or row['result'] is not None:
            raise ValueError('chunk_start requires null utc_end and result')
        return start, None
    end = ledger_time(row.get('utc_end'))
    if row.get('result') not in RESULTS:
        raise ValueError('unknown result')
    if end < start:
        raise ValueError('end precedes start')
    return start, end


def ledger_totals(chunks, live=False):
    by_host = defaultdict(list)
    for chunk in chunks:
        end = chunk['assumed_utc_end'] if live and chunk['utc_end'] is None else chunk['utc_end']
        by_host[chunk['host']]  # Keep hosts with only UNKNOWN_END visible.
        if end is not None:
            by_host[chunk['host']].append((ledger_time(chunk['utc_start']), ledger_time(end)))
    hosts = {host: {'hours': hours(spans), 'daily_jst': days(spans)}
             for host, spans in sorted(by_host.items())}
    daily = defaultdict(float)
    for host in hosts.values():
        for day, value in host['daily_jst'].items():
            daily[day] += value
    return {'hours': sum(host['hours'] for host in hosts.values()),
            'daily_jst': dict(sorted(daily.items())), 'hosts': hosts}


def read_ledgers(paths, report_bad_lines=False, assume_end_now=False, now=None):
    """Quarantine ambiguous keys; never rescue a duplicate by picking a winner."""
    groups = defaultdict(list)
    rejected = set()
    issues = []

    def bad(message, sources, key=None):
        issues.append({'reason': message, 'sources': sources,
                       'key': dict(zip(KEY_FIELDS, key)) if key else None})
        if key is not None:
            rejected.add(key)

    for path in paths:
        try:
            with Path(path).open('rb') as stream:
                for number, raw in enumerate(stream, 1):
                    source = f'{path}:{number}'
                    key = None
                    try:
                        row = json.loads(raw.decode('utf-8'), object_pairs_hook=ledger_object,
                                         parse_constant=reject_json_constant)
                        key = ledger_key(row)
                        start, end = validate_ledger_event(row)
                        groups[key].append((row, start, end, source))
                    except (ValueError, UnicodeError) as exc:
                        bad(str(exc), [source], key)
        except OSError as exc:
            bad(f'cannot read ledger: {exc.strerror}', [str(path)])

    snapshot = now if now is not None else datetime.now(UTC)
    if assume_end_now and (snapshot.tzinfo is None or snapshot.utcoffset() is None):
        raise ValueError('live snapshot must have an explicit timezone')
    chunks = []
    for key, records in sorted(groups.items()):
        if key in rejected:
            continue
        starts = [r for r in records if r[0]['event'] == 'chunk_start']
        ends = [r for r in records if r[0]['event'] == 'chunk_end']
        sources = [r[3] for r in records]
        if len(starts) > 1 or len(ends) > 1:
            bad('duplicated pair/event', sources, key)
            continue
        if not starts:
            bad('end without a start', sources, key)
            continue
        row, start, _, _ = starts[0]
        end = None
        result = 'UNKNOWN_END'
        if ends:
            end_row, repeated_start, end, _ = ends[0]
            if start != repeated_start:
                bad('chunk_end utc_start differs from chunk_start', sources, key)
                continue
            result = end_row['result']
        elif assume_end_now and snapshot < start:
            bad('assumed end precedes start', sources, key)
            continue
        chunks.append({**dict(zip(KEY_FIELDS, key)), 'utc_start': row['utc_start'],
                       'utc_end': ends[0][0]['utc_end'] if ends else None,
                       'result': result, 'sources': sources,
                       'hours': hours([(start, end)]) if end is not None else None,
                       'assumed_utc_end': snapshot.astimezone(UTC).isoformat().replace('+00:00', 'Z')
                       if end is None and assume_end_now else None})

    failed = bool(issues) and not report_bad_lines
    unknown = [c for c in chunks if c['result'] == 'UNKNOWN_END']
    known = None if failed else ledger_totals(chunks)
    breakdown = {}
    if not failed:
        for result in (*RESULTS, 'UNKNOWN_END'):
            subset = [c for c in chunks if c['result'] == result]
            breakdown[result] = {'chunks': len(subset),
                                 'hours': None if result == 'UNKNOWN_END' else ledger_totals(subset)['hours']}
    return {'mode': 'LIVE_ASSUMED_END_NOW' if assume_end_now else 'RECORDED_ONLY',
            'status': 'INVALID' if failed else 'PARTIAL_BAD_LINES_EXCLUDED' if issues else
                      'INCOMPLETE_UNKNOWN_END' if unknown else 'COMPLETE',
            'cutoff_jst': CUTOFF.isoformat(), 'issues': issues,
            'chunks': chunks, 'unknown_end': unknown, 'known': known,
            'total_hours': known['hours'] if known is not None and not unknown and not issues else None,
            'result_breakdown': breakdown,
            'result_hours_note': 'Each result is unioned per host; different results may overlap and are not additive. Counts include pre-cutoff chunks.',
            'live_assumed': ledger_totals(chunks, live=True) if assume_end_now and not failed else None,
            'assumed_now_utc': snapshot.astimezone(UTC).isoformat().replace('+00:00', 'Z') if assume_end_now else None}


def print_ledger_table(report):
    def emit(value):
        print(value, file=sys.stderr)
    emit(f"LEDGER {report['status']} | {report['mode']} | cutoff {report['cutoff_jst']}")
    if report['known'] is not None:
        emit('HOST | known union hours | JST day: hours')
        for host, totals in report['known']['hosts'].items():
            daily = ', '.join(f'{d}: {h:.6f}' for d, h in totals['daily_jst'].items())
            emit(f"{host} | {totals['hours']:.6f} | {daily}")
        emit(f"KNOWN SUBTOTAL | {report['known']['hours']:.6f}h; total={report['total_hours'] if report['total_hours'] is not None else 'UNKNOWN'}")
        emit('RESULT | chunks | union hours (not additive across results)')
        for result, totals in report['result_breakdown'].items():
            emit(f"{result} | {totals['chunks']} | {totals['hours'] if totals['hours'] is not None else 'UNKNOWN'}")
    for chunk in report['unknown_end']:
        emit('UNKNOWN_END | ' + ' | '.join(str(chunk[k]) for k in KEY_FIELDS) + f" | start={chunk['utc_start']}")
    if report['live_assumed'] is not None:
        emit(f"LIVE_ASSUMED_END_NOW | {report['assumed_now_utc']} | {report['live_assumed']['hours']:.6f}h (estimate, not settlement)")
    for issue in report['issues']:
        emit(f"BAD / EXCLUDED | {', '.join(issue['sources'])} | {issue['reason']} | {issue['key']}")


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
    p.add_argument('data', type=Path, nargs='?', help='legacy index/log directory')
    p.add_argument('--ledger', type=Path, action='append', help='host-local JSONL ledger; repeat per host; JSON on stdout, table on stderr')
    p.add_argument('--report-bad-lines', action='store_true', help='list and exclude bad records/ambiguous pairs instead of failing closed')
    p.add_argument('--assume-end-now', action='store_true', help='explicit live estimate only; UNKNOWN_END remains unresolved')
    args=p.parse_args()
    if args.ledger:
        if args.data is not None:
            p.error('data and --ledger are mutually exclusive')
        report = read_ledgers(args.ledger, args.report_bad_lines, args.assume_end_now)
        print(json.dumps(report, indent=2, ensure_ascii=True))
        print_ledger_table(report)
        # 0 = settled, 2 = invalid input, 3 = incomplete (a start without an end): the totals are UNKNOWN,
        # so a caller that checks only the exit code must not read the known subtotal as the total.
        if report['status'] == 'INVALID':
            return 2
        return 3 if report['status'] == 'INCOMPLETE_UNKNOWN_END' else 0
    if args.data is None or args.report_bad_lines or args.assume_end_now:
        p.error('provide data or --ledger; ledger flags require --ledger')
    analyze(args.data)
    return 0


if __name__=='__main__': sys.exit(main())
