#!/usr/bin/env python3
"""Offline dashboard contract checker. Stdlib only; never opens measurement output.

Run from any directory: python3 -B /path/to/dashboard-check.py [--self-check]
No imports from the experiment harness and no child processes/network/browser.
"""
import argparse
import copy
import json
import math
import re
from datetime import date, datetime, timedelta
from fractions import Fraction
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).absolute().parents[2]
HTML = ROOT / 'ascon-notes/league/ASCON-DASHBOARD.html'
REQUIRED = {'sources', 'status', 'plan', 'phases', 'milestones', 'progress',
            'blockers', 'queue', 'budget', 'results', 'decisions', 'log', 'ui', 'glossary'}
TYPES = {'実測', '決定', '実装', 'レビュー', '計画変更', '誤り'}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'param', 'source', 'track', 'wbr'}


class Document(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.blocks, self.ids, self.errors, self.links = [], {}, [], [], []
        self.capture, self.buffer = None, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get('id'):
            self.ids.append(a['id'])
        if tag not in VOID:
            self.stack.append(tag)
        if tag == 'script' and a.get('type') == 'application/json':
            key = a.get('id', '')
            if not key.startswith('data-'):
                self.errors.append('JSON block must have a data-* id: '+key)
            if key in self.blocks:
                self.errors.append('duplicate JSON block: '+key)
            self.capture, self.buffer = key, []
        if a.get('src') or (tag == 'link' and a.get('href')):
            self.errors.append('external/resource loading is disabled: '+tag)
        if a.get('href'):
            self.links.append(a['href'])

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == 'script' and self.capture is not None:
            self.blocks[self.capture.removeprefix('data-')] = ''.join(self.buffer)
            self.capture, self.buffer = None, []
        if tag in VOID:
            self.errors.append('closing void tag: '+tag)
        elif not self.stack or self.stack[-1] != tag:
            self.errors.append('unbalanced tag: </'+tag+'>')
        else:
            self.stack.pop()

    def handle_data(self, text):
        if self.capture is not None:
            self.buffer.append(text)


def unique_object(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise ValueError('duplicate JSON key: '+k)
        out[k] = v
    return out


def bad_constant(value):
    raise ValueError('non-finite JSON value: '+value)


def safe_path(raw):
    """Reject forbidden paths lexically before ANY filesystem existence check.

    Symlinks are rejected, so even a repo-local alias cannot read another worktree.
    All links in data are root-relative POSIX paths (no inline :line suffixes).
    """
    if not isinstance(raw, str) or not raw or '\\' in raw or '%' in raw or ':' in raw:
        raise ValueError('invalid repo path: '+repr(raw))
    p = PurePosixPath(raw.split('#', 1)[0])
    if (not p.parts or p.is_absolute() or '..' in p.parts or
            p.as_posix() != raw.split('#', 1)[0]):
        raise ValueError('path escapes/is not canonical: '+raw)
    if ('runs' in p.parts or 'upstream-eval' in p.parts or
            any(part.startswith('.env') or part in {'.aws', '.ssh', 'credentials', 'keys'} for part in p.parts) or
            p.parts[:3] == ('ascon-notes', 'eval', 'out') or
            p.parts[:2] == ('example', 'agents') or
            p.parts[0] in {'.git', 'node_modules', 'test'}):
        raise ValueError('protected path (not accessed): '+raw)
    current = ROOT
    for part in p.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('symlink (not followed): '+raw)
    return current


def markdown_table(text, header_key):
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith('| '+header_key+' |'))
    rows = []
    for line in lines[start:]:
        if not line.startswith('|'):
            break
        if re.fullmatch(r'[| :\-]+', line):
            continue
        rows.append([c.strip() for c in line.strip('|').split('|')])
    return rows[0], rows[1:]


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00', value):
        raise ValueError('expected ISO timestamp with seconds and +09:00: '+str(value))
    dt = datetime.fromisoformat(value)
    if dt.utcoffset() != timedelta(hours=9):
        raise ValueError('not JST: '+value)
    return dt


def validate(doc, data):
    errors = list(doc.errors)
    stats = {'blocks': len(data), 'ids': 0, 'paths': 0, 'tables': 0, 'logs': 0, 'blockers': 0}
    def check(ok, message):
        if not ok:
            errors.append(message)
    check(not doc.stack, 'unclosed HTML tags: '+str(doc.stack))
    check(len(doc.ids) == len(set(doc.ids)), 'duplicate HTML ids')
    check(REQUIRED <= set(data), 'missing JSON blocks: '+', '.join(sorted(REQUIRED-set(data))))
    if not REQUIRED <= set(data):
        return errors, stats
    sources = data['sources'].get('sources', [])
    source_map = {s.get('id'):s for s in sources if isinstance(s, dict)}
    seen, paths = set(doc.ids), set()
    date_keys = {'date', 'due_date', 'event_date', 'start_date', 'end_date'}
    time_keys = {'timestamp', 'as_of', 'measurement_as_of', 'started_at', 'expected_end', 'start_at', 'signed_at', 'completed_at', 'deadline_at', 'at'}

    def walk(value, location, inherited_sources=None):
        if isinstance(value, dict):
            refs = value.get('sources', inherited_sources)
            if 'id' in value:
                identifier = value['id']
                check(isinstance(identifier, str) and bool(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', identifier)), 'invalid id at '+location)
                check(identifier not in seen, 'duplicate id: '+str(identifier))
                seen.add(identifier)
            if 'sources' in value and location != 'sources':
                check(isinstance(refs, list) and bool(refs), 'empty sources at '+location)
                if isinstance(refs, list):
                    for ref in refs:
                        check(isinstance(ref, str) and ref in source_map, 'unknown source '+str(ref)+' at '+location)
            for key, child in value.items():
                loc = location+'.'+key
                if key in date_keys and child is not None:
                    try:
                        check(bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', child)), 'non-ISO date: '+loc)
                        date.fromisoformat(child)
                    except (ValueError, TypeError):
                        errors.append('invalid date: '+loc+' = '+str(child))
                if key in time_keys and child is not None:
                    try:
                        timestamp(child)
                    except (ValueError, TypeError) as exc:
                        errors.append('invalid timestamp: '+loc+' '+str(exc))
                if key in {'path', 'file', 'href'} and child is not None:
                    if isinstance(child, str) and child.startswith('#'):
                        continue
                    try:
                        path = safe_path(child)
                        paths.add(child)
                        check(path.is_file(), 'MISSING file: '+child)
                    except ValueError as exc:
                        errors.append(str(exc))
                if isinstance(child, (int, float)) and not isinstance(child, bool):
                    check(math.isfinite(child), 'non-finite number: '+loc)
                    check(bool(refs), 'number without sources: '+loc)
                walk(child, loc, refs)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                walk(child, f'{location}[{i}]', inherited_sources)
    for name, block in data.items():
        walk(block, name)
    stats.update(ids=len(seen), paths=len(paths))
    phase_ids = {p['id'] for p in data['phases']['items']}
    decision_ids = {d['id'] for d in data['decisions']['items']}
    check(data['status']['phase_id'] in phase_ids, 'unknown current phase')
    for m in data['milestones']['items']:
        check(all(i in decision_ids for i in m['decision_refs']), 'unknown decision reference: '+m['id'])
    for p in data['phases']['items']:
        check(p['start_date'] <= p['end_date'], 'reversed phase dates: '+p['id'])
    log = data['log']['items']
    check(set(data['log']['allowed_types']) == TYPES, 'log type vocabulary changed')
    previous = None
    for item in log:
        check(item.get('type') in TYPES, 'invalid log type: '+str(item.get('type')))
        for key in ('id','timestamp','type','summary','sources','time_basis','event_date'):
            check(bool(item.get(key)), 'missing log field '+key)
        check('\n' not in item.get('summary',''), 'log summary must be one line: '+item.get('id','?'))
        try:
            t = timestamp(item['timestamp'])
            check(previous is None or t <= previous, 'log time increases: '+item['id'])
            previous = t
            check(t <= timestamp(data['status']['as_of']), 'log newer than as_of: '+item['id'])
            check(item['event_date'] <= t.date().isoformat(), 'log event date is after recording: '+item['id'])
        except (ValueError, KeyError):
            pass  # Already reported by date/required-field validation.
    stats['logs'] = len(log)
    budget = data['budget']
    try:
        total = Fraction(str(budget['total_hours']))
        for column in budget['columns']:
            values = [Fraction(str(r[column['key']])) for r in budget['rows']]
            check(all(v >= 0 for v in values), 'negative budget allocation: '+column['key'])
            check(sum(values) == total, 'budget sum mismatch: '+column['key']+' = '+str(sum(values))+' != '+str(total))
    except (ValueError, KeyError, ZeroDivisionError) as exc:
        errors.append('invalid budget: '+str(exc))
    fields = {'id','rank','title','severity','likelihood','impact','owner','evidence','mitigation','status','sources'}
    for b in data['blockers']['items']:
        check(all(k in b and b[k] not in ('',None,[]) for k in fields), 'incomplete blocker: '+b.get('id','?'))
        check(b.get('owner') in {'human','Claude','Codex'}, 'invalid blocker owner: '+b.get('id','?'))
        check(b.get('likelihood') in data['blockers']['likelihood_axis'], 'invalid likelihood: '+b.get('id','?'))
        check(b.get('impact') in data['blockers']['impact_axis'], 'invalid impact: '+b.get('id','?'))
        check(b.get('severity') in {'Critical','Warning','Suggestion'}, 'invalid severity: '+b.get('id','?'))
    stats['blockers'] = len(data['blockers']['items'])
    for b in data['blockers']['items']:
        check(bool(b.get('impact_note')), 'blocker must explain impact: '+b['id'])
    check([b['rank'] for b in data['blockers']['items']] == list(range(1,stats['blockers']+1)), 'blocker ranks must be unique and ordered')
    queue = data['queue']['items']
    check([q['priority'] for q in queue] == list(range(1,len(queue)+1)), 'queue priorities must be unique and ordered')
    for q in queue:
        check(q.get('owner') in {'human', 'Claude', 'Codex'}, 'invalid queue owner: '+q['id'])
        check(isinstance(q.get('active'), bool), 'queue active must be boolean: '+q['id'])
        check(bool(q.get('dependency')) and bool(q.get('state')), 'queue state/dependency missing: '+q['id'])
        if q['hours'] is not None:
            try:
                check(Fraction(str(q['hours'])) >= 0, 'negative queue hours: '+q['id'])
            except (ValueError, ZeroDivisionError):
                errors.append('invalid queue hours: '+q['id'])

    # Compare copied measurement tables with existing Markdown, without opening raw runs.
    for result in data['results'].values():
        if not isinstance(result, dict) or 'source_table' not in result:
            continue
        try:
            spec = result['source_table']
            source = safe_path(source_map[spec['source']]['path'])
            head, rows = markdown_table(source.read_text(), spec['header_key'])
            check(head == result['header'] and rows == result['rows'], 'generated table differs from source: '+result['id'])
            stats['tables'] += 1
        except (ValueError, KeyError, OSError, StopIteration) as exc:
            errors.append('source table unreadable: '+result.get('id','?')+' '+str(exc))
    for href in doc.links:
        if href.startswith('#'):
            check(href[1:] in seen, 'missing static fragment: '+href)
        else:
            errors.append('static links must use sources data or local fragments: '+href)
    # The app is a projection of JSON: every screen, KPI and comparison must have a valid reference.
    def resolve(ref):
        value = data
        for key in ref.split('.'):
            value = value[key]
        return value
    ui = data['ui']
    expected_pages = ['overview','plan','results','blockers','decisions','operations','log','glossary']
    check(ui.get('schema_version') == '2', 'unsupported app data schema')
    check([p['key'] for p in ui['pages']] == expected_pages, 'eight required app pages and order')
    for p in ui['pages']:
        check(all(p.get(k) for k in ('label','description','eyebrow','icon')), 'incomplete page: '+p['key'])
    for kpi in ui['kpis']:
        try:
            check(resolve(kpi['ref']) is not None, 'KPI must reference a known value')
        except (KeyError, TypeError, AttributeError):
            errors.append('invalid KPI reference: '+str(kpi.get('ref')))
        check(kpi['route'] in expected_pages, 'KPI route does not exist')
    progress = {p['id']:p for p in data['progress']['items']}
    for p in progress.values():
        check(p['state'] in {'done','running','pending','failed','blocked'}, 'invalid progress state: '+p['id'])
        check(bool(p.get('evidence')) and bool(p.get('sources')), 'progress evidence missing: '+p['id'])
    priority = data['status']['priority']
    check(priority['blocker_ref'] == data['blockers']['items'][0]['id'], 'priority must point to the first blocker')
    check(len(priority['progress_refs']) == len(set(priority['progress_refs'])) and
          all(ref in progress for ref in priority['progress_refs']), 'priority progress refs invalid/duplicated')
    for mode, rows in data['results']['comparison'].items():
        if mode == 'sources':
            continue
        check(mode in {'diagnostic','qualification'} and bool(rows), 'comparison category missing/invalid')
        for row in rows:
            for key in ('run_ref','scope_ref'):
                try:
                    check(resolve(row[key]) is not None, 'comparison reference is empty')
                except (KeyError, TypeError, AttributeError):
                    errors.append('invalid comparison reference: '+str(row.get(key)))
            for metric in row.get('metrics', []):
                for key in ('candidate_ref','baseline_ref'):
                    if key not in metric:
                        continue
                    try:
                        check(resolve(metric[key]) is not None, 'comparison metric is unknown')
                    except (KeyError, TypeError, AttributeError):
                        errors.append('invalid comparison metric reference: '+str(metric.get(key)))
            check(bool(row.get('sources')), 'comparison row without sources')
    glossary = data['glossary']['items']
    required_terms = {'ascon','score-t','profit-p','noop','multi-arb','clean-arb','regime','epoch','seed',
                      'world','f-ref','f-mix','q0','q0b','q0m','g0','g3','g4','p60','dev','xb-r','factors',
                      'r1','r2','r3','r4','r5','r6','r7','bundle','single','revert','frozen','revision',
                      'ollama','forward','dec-007','dec-008','deterministic'}
    check({'term-'+t for t in required_terms} <= {g['id'] for g in glossary}, 'required glossary entry missing')
    aliases = []
    for g in glossary:
        check(all(g.get(k) for k in ('term','aliases','category','definition')), 'incomplete glossary: '+g['id'])
        check(len(g['definition']) >= 20, 'glossary explanation too short: '+g['id'])
        aliases.extend(g['aliases'])
    check(len(aliases) == len(set(aliases)), 'ambiguous glossary aliases')
    stats['terms'] = len(glossary)
    return errors, stats


def parse(text):
    doc = Document()
    doc.feed(text)
    doc.close()
    styles = '\n'.join(re.findall(r'<style>(.*?)</style>', text, re.S))
    if re.search(r'@import|url\s*\(', styles, re.I):
        doc.errors.append('CSS must not load external resources')
    if '@media print' in styles or 'beforeprint' in text:
        doc.errors.append('print-only behavior is retired')
    app = re.search(r'<script id="dashboard-app">(.*?)</script>', text, re.S)
    if not app:
        doc.errors.append('missing app renderer')
    elif re.search(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|eval)\s*\(', app[1]):
        doc.errors.append('app must stay offline and data-only')
    data = {}
    for name, raw in doc.blocks.items():
        try:
            value = json.loads(raw, object_pairs_hook=unique_object, parse_constant=bad_constant)
            if not isinstance(value, dict):
                raise ValueError('top level must be an object')
            data[name] = value
        except (ValueError, TypeError) as exc:
            doc.errors.append('invalid JSON '+name+': '+str(exc))
    return doc, data


def self_check(text):
    """Negative controls in memory only. Does not write tests or read raw results."""
    doc, original = parse(text)
    mutations = [
        lambda d: d['budget']['rows'][1].update(keep_hours='999'),
        lambda d: d['progress']['items'][0].update(id=d['progress']['items'][1]['id']),
        lambda d: d['log']['items'][-1].update(timestamp=d['log']['items'][0]['timestamp']),
        lambda d: d['log']['items'][0].update(type='UNKNOWN'),
        lambda d: d['decisions']['items'][0].update(date='2026-02-30'),
        lambda d: d['sources']['sources'][0].update(path='ascon-notes/league/DOES-NOT-EXIST.md'),
        lambda d: d['sources']['sources'][0].update(path='runs/NEVER-ACCESS.json'),
        lambda d: d['blockers']['items'][0].pop('mitigation'),
        lambda d: d['results']['q0']['rows'][0].__setitem__(2, '999999'),
        lambda d: d['queue']['items'][0].update(hours='not-a-fraction'),
        lambda d: d['glossary']['items'].pop(0),
        lambda d: d['glossary']['items'][0].update(definition=''),
        lambda d: d['ui']['kpis'][0].update(ref='status.missing'),
        lambda d: d['ui']['pages'].pop(),
        lambda d: d['status']['priority']['progress_refs'].append('progress-not-found'),
        lambda d: d['results']['comparison']['diagnostic'][1]['metrics'][0].update(candidate_ref='results.missing'),
        lambda d: d['blockers']['items'][0].pop('impact_note'),
        lambda d: d['progress']['items'][0].update(state='PASS'),
        lambda d: d['sources']['sources'][0].update(path='.env.secret'),
    ]
    for n, mutate in enumerate(mutations,1):
        changed = copy.deepcopy(original)
        mutate(changed)
        errors, _ = validate(doc,changed)
        if not errors:
            raise ValueError('negative control incorrectly passed: '+str(n))
    # Malformed JSON, duplicate JSON keys, and unbalanced tags are checked by the parser.
    bad_documents = [text.replace('"as_of":', '"as_of"',1),
                     text.replace('"as_of":', '"as_of":"duplicate","as_of":',1),
                     text.replace('</main>', '</aside>',1),
                     text.replace('<style>', '<style>@import "https://invalid.example/font.css";',1)]
    for broken in bad_documents:
        parsed, _ = parse(broken)
        if not parsed.errors:
            raise ValueError('malformed document incorrectly passed')
    return len(mutations)+len(bad_documents)


def check_rendered(path, data):
    """Inspect output from the Node DOM adapter, never starting a browser/process.

    This is tag/link/accessibility-markup validation, not a layout claim.
    """
    raw = str(path)
    if not (raw.startswith('/tmp/') or raw.startswith('/private/tmp/')) or '..' in Path(raw).parts:
        raise ValueError('rendered output must be an explicit temporary file')
    current = Path('/')
    for part in Path(raw).parts[1:]:
        current = current / part
        # macOS /tmp itself is the allowed system alias to /private/tmp.
        if current.is_symlink() and str(current) != '/tmp':
            raise ValueError('rendered output symlink rejected')
    pages = json.loads(Path(path).read_text())
    required = {p['key'] for p in data['ui']['pages']} | {'qualification'}
    if set(pages) != required:
        raise ValueError('rendered output must contain all eight pages and qualification view')
    for name, html in pages.items():
        doc = Document()
        doc.feed(html)
        doc.close()
        if doc.errors or doc.stack or len(doc.ids) != len(set(doc.ids)):
            raise ValueError('rendered HTML malformed: '+name+' '+str(doc.errors))
        if len(re.findall(r'<h1\b', html)) != 1:
            raise ValueError('rendered page must have one h1: '+name)
        for href in doc.links:
            if href.startswith('#'):
                if href[1:].split('/')[0] not in {p['key'] for p in data['ui']['pages']}:
                    raise ValueError('invalid rendered route: '+href)
            elif not href.startswith('../../') or not safe_path(href[6:]).is_file():
                raise ValueError('invalid rendered source link: '+href)
        without_ids = re.sub(r'<small class="mono">log-\d+</small>', '', html)
        if re.search(r'log-\d+', without_ids):
            raise ValueError('internal log ID escaped its small note: '+name)
    return len(pages)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-check', action='store_true', help='also reject in-memory negative controls')
    parser.add_argument('--rendered', help='also inspect Node-rendered pages from an explicit /tmp JSON file')
    args = parser.parse_args()
    try:
        text = HTML.read_text()
        doc, data = parse(text)
        errors, stats = validate(doc,data)
        if errors:
            print('FAIL dashboard-check')
            for error in errors:
                print('  - '+error)
            return 1
        print(f"PASS JSON: {stats['blocks']} blocks; {stats['ids']} unique HTML/data ids")
        print(f"PASS log: {stats['logs']} entries; JST descending (ties allowed); allowed types; valid dates")
        totals = {c['key']: sum(Fraction(str(r[c['key']])) for r in data['budget']['rows'])
                  for c in data['budget']['columns']}
        print(f"PASS budget: KEEP = {totals['keep_hours']} h; archived unsigned AMEND = {totals['amend_hours']} h (exact fractions)")
        print(f"PASS sources: {stats['paths']} repo files exist; 0 missing; {stats['tables']} copied tables match")
        print(f"PASS blockers: {stats['blockers']} complete ranked rows; queue / phase / decision references valid")
        print('PASS HTML: balanced tags; unique ids; no external resources')
        print(f"PASS app: 8 pages; valid KPI/comparison references; {stats['terms']} glossary entries; all required terms")
        if args.self_check:
            print(f'PASS checker controls: {self_check(text)} invalid cases rejected in memory')
        if args.rendered:
            print(f'PASS rendered HTML: {check_rendered(args.rendered, data)} views; balanced tags, unique ids, safe links, no inline log ids')
        print('LIMIT: static consistency only; live runs / browser layout / submission / actual hours unverified')
        print('PASS dashboard-check')
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print('FAIL dashboard-check: '+str(exc))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
