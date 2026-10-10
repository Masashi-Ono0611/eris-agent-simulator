#!/usr/bin/env python3
"""Read-only declaration comparison: synthetic-only / not G3 evidence."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

SCOPE = 'synthetic-only / not G3 evidence'
SCHEMA = 'synthetic-source-manifest-contract-v1'
ROOTS = ('source', 'view', 'eval', 'tool')
MAPS = ('files', 'viewFiles', 'evalFiles', 'toolFiles')
IDENTIFIERS = ('candidateId', 'candidateDir', 'candidateSha256', 'head',
               'branch', 'mainRef', 'absoluteGitDir') + ROOTS
KEYS = frozenset(('scope', 'schema', 'release', 'skippedPaths') + IDENTIFIERS + MAPS)
EXIT = {'CONTRACT_OK_ON_SYNTHETIC': 0, 'FAIL': 1, 'BLOCKED': 2}


def row(check, item, status, reason):
    return dict(check=check, item=item, status=status, reason=reason, scope=SCOPE)


def report(rows):
    statuses = {r['status'] for r in rows}
    verdict = ('FAIL' if 'FAIL' in statuses else 'BLOCKED'
               if 'BLOCKED' in statuses or not rows else 'CONTRACT_OK_ON_SYNTHETIC')
    return {
        'scope': SCOPE, 'verdict': verdict,
        'notice': 'not a manifest registration; not B07 closure; '
                  'does not read or change the real lock/tool manifest',
        'g3Requirement': 'REQUIRED', 'g3Status': 'BLOCKED',
        'b03Status': 'USER-ACCEPTED unresolved residual risk',
        'b04Status': 'not_evaluated', 'b07Status': 'BLOCKED',
        'realRun': 'not_evaluated', 'filesystemIdentity': 'not_evaluated',
        'checks': rows,
    }


def text(value):
    return isinstance(value, str) and bool(value.strip()) and value == value.strip()


def hex_string(value, length):
    return isinstance(value, str) and re.fullmatch('[0-9a-fA-F]{%d}' % length, value) is not None


def path_string(value, absolute=False):
    if not text(value) or '\\' in value or any(ord(c) < 32 for c in value):
        return False
    parts = value.split('/')
    if absolute:
        return value.startswith('/') and all(p not in ('', '.', '..') for p in parts[1:])
    return all(p not in ('', '.', '..') for p in parts) and not value.startswith('/')


def documents(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        status = 'PASS' if isinstance(doc, dict) and doc else 'BLOCKED'
        yield row('documents', label, status, 'nonempty object required')


def required_keys(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        for key in sorted(KEYS):
            value = doc.get(key)
            status = 'BLOCKED' if value is None else 'PASS'
            yield row('required_keys', label + '.' + key, status,
                      'explicit non-null value required; no repository defaults')


def extra_keys(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        yield row('extra_keys', label, 'FAIL' if set(doc) - KEYS else 'PASS',
                  'only the documented top-level keys are allowed')


def synthetic_contract(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        for key, value in (('scope', SCOPE), ('schema', SCHEMA), ('release', 'r3')):
            status = 'BLOCKED' if doc.get(key) is None else 'PASS' if doc[key] == value else 'FAIL'
            yield row('synthetic_contract', label + '.' + key, status,
                      'explicit synthetic r3 contract required; no real mode')


def commit_format(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        for key in ('head', 'mainRef'):
            value = doc.get(key)
            status = 'BLOCKED' if value is None else 'PASS' if hex_string(value, 40) else 'FAIL'
            yield row('commit_format', label + '.' + key, status, 'full 40-hex commit required')


def identifier_format(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        predicates = {key: (lambda v: path_string(v, absolute=True))
                      for key in ROOTS + ('absoluteGitDir',)}
        predicates.update(candidateId=text, candidateDir=lambda v: path_string(v) and '/' not in v,
                          candidateSha256=lambda v: hex_string(v, 64), branch=text)
        for key, predicate in predicates.items():
            value = doc.get(key)
            status = 'BLOCKED' if value is None else 'PASS' if predicate(value) else 'FAIL'
            yield row('identifier_format', label + '.' + key, status,
                      'explicit identifier, normalized absolute POSIX path, or 64-hex hash required')


def legacy_references(manifest, expected):
    def legacy(value):
        pending = [value]
        while pending:
            current = pending.pop()
            if isinstance(current, str):
                if re.search(r'(?i)(?<![a-z0-9])r2(?![a-z0-9])|release-r2|ec80bb8', current):
                    return True
            elif isinstance(current, dict):
                pending.extend(current.keys())
                pending.extend(current.values())
            elif isinstance(current, list):
                pending.extend(current)
        return False
    for label, doc in (('manifest', manifest), ('expected', expected)):
        yield row('legacy_references', label, 'FAIL' if legacy(doc) else 'PASS',
                  'r2/release-r2/ec80bb8 references forbidden in this r3 execution contract')


def valid_map(value):
    return (isinstance(value, dict) and bool(value)
            and all(path_string(k) and hex_string(v, 64) for k, v in value.items()))


def file_maps(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        for key in MAPS:
            value = doc.get(key)
            status = ('BLOCKED' if value is None or value == {} else
                      'PASS' if valid_map(value) else 'FAIL')
            yield row('file_maps', label + '.' + key, status,
                      'nonempty relative-path to 64-hex hash object required')
        skipped = doc.get('skippedPaths')
        valid = (isinstance(skipped, list) and all(path_string(p) for p in skipped)
                 and len(set(skipped)) == len(skipped))
        yield row('file_maps', label + '.skippedPaths',
                  'BLOCKED' if skipped is None else 'PASS' if valid else 'FAIL',
                  'explicit unique relative-path list required (empty list allowed)')


def identities(manifest, expected):
    for key in IDENTIFIERS:
        m, e = manifest.get(key), expected.get(key)
        status = 'BLOCKED' if m is None or e is None else 'PASS' if m == e else 'FAIL'
        yield row('identities', key, status, 'exact caller-supplied identifier equality required')


def file_sets(manifest, expected):
    for key in MAPS:
        m, e = manifest.get(key), expected.get(key)
        status = ('BLOCKED' if not valid_map(m) or not valid_map(e) else
                  'PASS' if set(m) == set(e) else 'FAIL')
        yield row('file_sets', key, status, 'exact caller file set required; missing/extra entries rejected')
    m, e = manifest.get('skippedPaths'), expected.get('skippedPaths')
    valid = all(isinstance(v, list) and all(path_string(p) for p in v) for v in (m, e))
    status = 'BLOCKED' if not valid else 'PASS' if sorted(m) == sorted(e) else 'FAIL'
    yield row('file_sets', 'skippedPaths', status, 'exact caller exclusion set required')
    for label, doc in (('manifest', manifest), ('expected', expected)):
        files, skipped = doc.get('files'), doc.get('skippedPaths')
        valid = valid_map(files) and isinstance(skipped, list) and all(path_string(p) for p in skipped)
        status = 'BLOCKED' if not valid else 'FAIL' if set(files) & set(skipped) else 'PASS'
        yield row('file_sets', label + '.selected_vs_skipped', status,
                  'selected source files cannot also be excluded')


def file_hashes(manifest, expected):
    for key in MAPS:
        m, e = manifest.get(key), expected.get(key)
        if not valid_map(m) or not valid_map(e):
            yield row('file_hashes', key, 'BLOCKED', 'valid explicit file maps required')
            continue
        for name in sorted(set(m) | set(e)):
            status = 'BLOCKED' if name not in m or name not in e else 'PASS' if m[name] == e[name] else 'FAIL'
            yield row('file_hashes', key + '.' + name, status,
                      'declared hash must equal caller hash for this role; bytes not read')


def aggregate(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def candidate_tree(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        directory, digest = doc.get('candidateDir'), doc.get('candidateSha256')
        for key in ('files', 'viewFiles', 'evalFiles'):
            files = doc.get(key)
            if not path_string(directory) or not hex_string(digest, 64) or not valid_map(files):
                status, reason = 'BLOCKED', 'candidate directory/hash and file map required'
            else:
                prefix = 'example/agents/' + directory + '/'
                subset = {p[len(prefix):]: h for p, h in files.items() if p.startswith(prefix)}
                status = 'BLOCKED' if not subset else 'PASS' if aggregate(subset) == digest else 'FAIL'
                reason = 'nonempty candidate-relative hash map must aggregate to candidateSha256'
            yield row('candidate_tree', label + '.' + key, status, reason)


def distinct_roots(manifest, expected):
    for label, doc in (('manifest', manifest), ('expected', expected)):
        values = [doc.get(key) for key in ROOTS]
        if not all(path_string(v, absolute=True) for v in values):
            status = 'BLOCKED'
        else:
            paths = [PurePosixPath(v) for v in values]
            overlap = any(a == b or a in b.parents or b in a.parents
                          for i, a in enumerate(paths) for b in paths[i + 1:])
            status = 'FAIL' if overlap else 'PASS'
        yield row('distinct_roots', label, status,
                  'four distinct non-nested declared roots required; symlinks not inspected')


CHECKS = (documents, required_keys, extra_keys, synthetic_contract, commit_format,
          identifier_format, legacy_references, file_maps, identities, file_sets,
          file_hashes, candidate_tree, distinct_roots)


def check(manifest, expected):
    """Pure function over JSON objects; no ambient defaults or filesystem queries."""
    rows = list(documents(manifest, expected))
    # A malformed root has no fields to evaluate. Do not treat it as an empty pass.
    if not isinstance(manifest, dict) or not isinstance(expected, dict):
        return report(rows)
    for guard in CHECKS[1:]:
        rows.extend(guard(manifest, expected))
    return report(rows)


class DuplicateKey(ValueError):
    pass


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise DuplicateKey('duplicate JSON key')
        obj[key] = value
    return obj


def reject_constant(value):
    raise ValueError('non-JSON number')


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)


def check_paths(manifest_path, expected_path):
    """Read exactly the two supplied JSON documents, never their referenced paths."""
    docs, issues = [], []
    for label, path in (('manifest', manifest_path), ('expected', expected_path)):
        try:
            raw = Path(path).read_text(encoding='utf-8')
            docs.append(parse(raw))
        except DuplicateKey:
            issues.append(row('json_duplicates', label, 'FAIL', 'duplicate JSON member rejected before collapse'))
        except (OSError, ValueError, TypeError, RecursionError):
            issues.append(row('input_json', label, 'BLOCKED', 'input missing, unreadable, or invalid JSON'))
    if issues:
        return report(issues)
    return check(*docs)


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2 or any(arg.startswith('--') for arg in args):
        result = report([row('arguments', 'caller', 'BLOCKED',
                             'usage: check.py MANIFEST.json EXPECTED-IDENTIFIERS.json; both required')])
    else:
        result = check_paths(*args)
    print(json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False))
    return EXIT[result['verdict']]


if __name__ == '__main__':
    sys.exit(main())
