"""Positive rejection controls: synthetic-only / not G3 evidence."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('manifest_contract', HERE / 'check.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)
FIXTURES = HERE / 'fixtures'
SCOPE = 'synthetic-only / not G3 evidence'
print(SCOPE, file=sys.stderr)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((FIXTURES / 'manifest.json').read_text())
        self.expected = json.loads((FIXTURES / 'expected-identifiers.json').read_text())

    def result(self):
        return contract.check(self.manifest, self.expected)

    def fired(self, check, item=None, status='FAIL', result=None):
        result = self.result() if result is None else result
        self.assertNotEqual(result['verdict'], 'CONTRACT_OK_ON_SYNTHETIC')
        rows = [r for r in result['checks'] if r['check'] == check and r['status'] == status
                and (item is None or r['item'] == item)]
        self.assertTrue(rows, (check, item, status, result))
        self.assertTrue(all(r['reason'] and r['scope'] == SCOPE for r in rows))

    def test_normal_contract_is_only_synthetic(self):
        result = self.result()
        self.assertEqual(result['verdict'], 'CONTRACT_OK_ON_SYNTHETIC')
        self.assertTrue(all(r['status'] == 'PASS' for r in result['checks']))
        self.assertEqual(result['scope'], SCOPE)
        self.assertEqual(result['g3Requirement'], 'REQUIRED')
        self.assertEqual(result['g3Status'], 'BLOCKED')
        self.assertEqual(result['b03Status'], 'USER-ACCEPTED unresolved residual risk')
        self.assertEqual(result['b04Status'], 'not_evaluated')
        self.assertEqual(result['b07Status'], 'BLOCKED')
        self.assertEqual(result['realRun'], 'not_evaluated')
        self.assertEqual(result['filesystemIdentity'], 'not_evaluated')
        self.assertIn('not a manifest registration', result['notice'])
        self.assertIn('not B07 closure', result['notice'])
        self.assertIn('does not read or change the real lock/tool manifest', result['notice'])
        self.assertTrue(all(r['scope'] == SCOPE for r in result['checks']))

    def test_empty_and_wrong_root_documents(self):
        for bad in ({}, None, [], '', 0, True):
            for label in ('manifest', 'expected'):
                with self.subTest(bad=bad, label=label):
                    args = [self.manifest, self.expected]
                    args[0 if label == 'manifest' else 1] = bad
                    self.fired('documents', label, 'BLOCKED', contract.check(*args))

    def test_every_required_key_missing_or_null_on_either_side(self):
        for label in ('manifest', 'expected'):
            for key in sorted(contract.KEYS):
                for null in (False, True):
                    with self.subTest(label=label, key=key, null=null):
                        m, e = copy.deepcopy(self.manifest), copy.deepcopy(self.expected)
                        doc = m if label == 'manifest' else e
                        if null:
                            doc[key] = None
                        else:
                            del doc[key]
                        self.fired('required_keys', label + '.' + key, 'BLOCKED', contract.check(m, e))

    def test_extra_top_level_entries_rejected(self):
        for doc in (self.manifest, self.expected):
            doc['extra'] = 'unregistered'
        self.fired('extra_keys', 'manifest')
        self.fired('extra_keys', 'expected')

    def test_synthetic_marker_schema_and_release_required(self):
        for key, bad in (('scope', 'real'), ('schema', 1), ('release', 'r4')):
            with self.subTest(key=key):
                m, e = copy.deepcopy(self.manifest), copy.deepcopy(self.expected)
                m[key] = e[key] = bad
                result = contract.check(m, e)
                self.fired('synthetic_contract', 'manifest.' + key, result=result)
                self.fired('synthetic_contract', 'expected.' + key, result=result)

    def test_incomplete_nonhex_commits_even_when_equal(self):
        for key in ('head', 'mainRef'):
            for value in ('abcdef0', 'g'*40, 'a'*39, 'a'*41, '', False, 0):
                with self.subTest(key=key, value=value):
                    m, e = copy.deepcopy(self.manifest), copy.deepcopy(self.expected)
                    m[key] = e[key] = value
                    result = contract.check(m, e)
                    self.fired('commit_format', 'manifest.' + key, result=result)
                    self.fired('commit_format', 'expected.' + key, result=result)

    def test_identifier_shapes_and_git_reference(self):
        cases = [('source', 'relative'), ('view', '/a/../b'), ('eval', '/a//b'),
                 ('tool', '/a/'), ('absoluteGitDir', ''), ('branch', ''),
                 ('candidateId', True), ('candidateDir', 'a/b'),
                 ('candidateSha256', '1'*40)]
        for key, value in cases:
            with self.subTest(key=key):
                m, e = copy.deepcopy(self.manifest), copy.deepcopy(self.expected)
                m[key] = e[key] = value
                result = contract.check(m, e)
                self.fired('identifier_format', 'manifest.' + key, result=result)
                self.fired('identifier_format', 'expected.' + key, result=result)

    def test_each_legacy_reference_is_found_even_when_expectations_agree(self):
        for key, value in [('branch', 'r2'), ('source', '/synthetic/release-r2'),
                           ('absoluteGitDir', '/synthetic/git/release-r2'),
                           ('candidateDir', 'ascon-zeta-r2'),
                           ('head', 'ec80bb8' + '3'*33), ('branch', 'release/r2-c0'),
                           ('branch', 'prefix/R2-test')]:
            with self.subTest(key=key, value=value):
                m, e = copy.deepcopy(self.manifest), copy.deepcopy(self.expected)
                m[key] = e[key] = value
                result = contract.check(m, e)
                self.fired('legacy_references', 'manifest', result=result)
                self.fired('legacy_references', 'expected', result=result)

    def test_legacy_nested_file_key_and_exclusion(self):
        self.manifest['toolFiles']['old/r2/tool.py'] = 'a'*64
        self.fired('legacy_references', 'manifest')
        self.manifest = copy.deepcopy(self.expected)
        self.manifest['skippedPaths'].append('release-r2/old.txt')
        self.fired('legacy_references', 'manifest')

    def test_r2_era_manifest_cannot_be_submitted_as_r3(self):
        self.manifest = json.loads((FIXTURES / 'r2-era.json').read_text())
        self.fired('legacy_references', 'manifest')
        self.fired('required_keys', 'manifest.eval', 'BLOCKED')
        self.fired('identities', 'head')

    def test_all_file_maps_reject_empty_bad_paths_hashes_or_shapes(self):
        cases = [({}, 'BLOCKED'), ([], 'FAIL'), ({'a': None}, 'FAIL'),
                 ({'a': True}, 'FAIL'), ({'../x': 'a'*64}, 'FAIL'),
                 ({'/x': 'a'*64}, 'FAIL'), ({'a//b': 'a'*64}, 'FAIL'),
                 ({'a/./b': 'a'*64}, 'FAIL'), ({'a\\b': 'a'*64}, 'FAIL'),
                 ({'a': 'short'}, 'FAIL')]
        for key in contract.MAPS:
            for value, status in cases:
                with self.subTest(key=key, value=value):
                    m, e = copy.deepcopy(self.manifest), copy.deepcopy(self.expected)
                    m[key] = e[key] = value
                    result = contract.check(m, e)
                    self.fired('file_maps', 'manifest.' + key, status, result)
                    self.fired('file_maps', 'expected.' + key, status, result)

    def test_duplicate_or_malformed_exclusions(self):
        for value in (['a', 'a'], ['../a'], [None], {}, False):
            self.manifest['skippedPaths'] = value
            self.fired('file_maps', 'manifest.skippedPaths')

    def test_each_identifier_mismatch_including_eval_only(self):
        for key in contract.IDENTIFIERS:
            with self.subTest(key=key):
                m = copy.deepcopy(self.manifest)
                m[key] = 'b'*64 if key == 'candidateSha256' else 'b'*40 if key in ('head', 'mainRef') else m[key] + '-other'
                self.fired('identities', key, result=contract.check(m, self.expected))

    def test_each_file_set_missing_or_extra(self):
        for key in contract.MAPS:
            for extra in (False, True):
                with self.subTest(key=key, extra=extra):
                    m = copy.deepcopy(self.manifest)
                    if extra:
                        m[key]['extra.txt'] = 'b'*64
                    else:
                        # A nonempty reduced set isolates set equality from empty-map rejection.
                        if len(m[key]) == 1:
                            m[key] = {'replacement.txt': 'b'*64}
                        else:
                            del m[key][next(iter(m[key]))]
                    self.fired('file_sets', key, result=contract.check(m, self.expected))

    def test_exclusion_set_and_selected_overlap(self):
        self.manifest['skippedPaths'] = []
        self.fired('file_sets', 'skippedPaths')
        self.manifest['skippedPaths'] = [next(iter(self.manifest['files']))]
        self.expected['skippedPaths'] = list(self.manifest['skippedPaths'])
        self.fired('file_sets', 'manifest.selected_vs_skipped')
        self.fired('file_sets', 'expected.selected_vs_skipped')

    def test_each_role_file_hash_detects_drift_including_eval_only(self):
        for key in contract.MAPS:
            m = copy.deepcopy(self.manifest)
            name = 'synthetic/common.ts' if key != 'toolFiles' else 'synthetic-check.py'
            m[key][name] = 'd'*64
            result = contract.check(m, self.expected)
            self.fired('file_hashes', key + '.' + name, result=result)
            failures = [(r['check'], r['item']) for r in result['checks'] if r['status'] == 'FAIL']
            self.assertEqual(failures, [('file_hashes', key + '.' + name)])

    def test_source_eval_mixup_and_independent_caller_pins(self):
        # Caller explicitly pins a distinct eval dependency hash; source cannot substitute for it.
        self.expected['evalFiles']['synthetic/common.ts'] = 'c'*64
        self.manifest = copy.deepcopy(self.expected)
        self.assertEqual(self.result()['verdict'], 'CONTRACT_OK_ON_SYNTHETIC')
        self.manifest['evalFiles'] = copy.deepcopy(self.manifest['files'])
        self.fired('file_hashes', 'evalFiles.synthetic/common.ts')
        self.manifest = copy.deepcopy(self.expected)
        self.manifest['eval'] = self.manifest['source']
        self.fired('identities', 'eval')
        self.fired('distinct_roots', 'manifest')

    def test_candidate_tree_is_recomputed_from_each_declared_map(self):
        for key in ('files', 'viewFiles', 'evalFiles'):
            m, e = copy.deepcopy(self.manifest), copy.deepcopy(self.expected)
            name = 'example/agents/ascon-synthetic-r3/prompt.md'
            m[key][name] = e[key][name] = 'e'*64
            result = contract.check(m, e)
            self.fired('candidate_tree', 'manifest.' + key, result=result)
            self.fired('candidate_tree', 'expected.' + key, result=result)

    def test_candidate_hash_mismatch_and_absent_candidate_not_empty_tree_success(self):
        self.manifest['candidateSha256'] = 'b'*64
        self.fired('identities', 'candidateSha256')
        self.fired('candidate_tree', 'manifest.files')
        for doc in (self.manifest, self.expected):
            doc['files'] = {'synthetic/common.ts': 'c'*64}
        self.fired('candidate_tree', 'manifest.files', 'BLOCKED')
        self.fired('candidate_tree', 'expected.files', 'BLOCKED')

    def test_aggregate_uses_relative_sorted_compact_json(self):
        import hashlib
        expected = hashlib.sha256(b'{"a":"x","b":"y"}').hexdigest()
        self.assertEqual(contract.aggregate({'b': 'y', 'a': 'x'}), expected)

    def test_same_or_nested_roots_even_when_caller_matches(self):
        for value in (self.manifest['source'], self.manifest['source'] + '/eval'):
            self.manifest['eval'] = self.expected['eval'] = value
            self.fired('distinct_roots', 'manifest')
            self.fired('distinct_roots', 'expected')

    def test_unknowns_not_filled_and_inputs_unchanged(self):
        self.manifest['eval'] = None
        before = copy.deepcopy((self.manifest, self.expected))
        result = self.result()
        self.assertEqual(result['verdict'], 'BLOCKED')
        self.fired('identities', 'eval', 'BLOCKED', result)
        self.assertEqual((self.manifest, self.expected), before)

    def test_caller_supplied_alternate_identifiers_not_repository_defaults(self):
        for doc in (self.manifest, self.expected):
            doc['candidateId'] = 'another-synthetic-candidate'
            doc['head'] = 'a'*40
            doc['mainRef'] = 'b'*40
            doc['branch'] = 'synthetic/alternate-r3'
            doc['absoluteGitDir'] = '/different-synthetic/git/r3'
            for key in contract.ROOTS:
                doc[key] = '/different-synthetic/' + key
        self.assertEqual(self.result()['verdict'], 'CONTRACT_OK_ON_SYNTHETIC')

    def test_wrong_json_field_types_never_crash_or_pass(self):
        for key in contract.KEYS:
            for value in (None, False, 0, 1.5, '', [], {}, [None], {'x': []}):
                if key == 'skippedPaths' and value == []:
                    continue
                with self.subTest(key=key, value=value):
                    m = copy.deepcopy(self.manifest)
                    m[key] = value
                    self.assertIn(contract.check(m, self.expected)['verdict'], ('FAIL', 'BLOCKED'))

    def test_deterministic_with_reordered_dictionary_keys(self):
        before = json.dumps(self.result(), sort_keys=True)
        for doc in (self.manifest, self.expected):
            for key in contract.MAPS:
                doc[key] = dict(reversed(list(doc[key].items())))
        self.manifest = dict(reversed(list(self.manifest.items())))
        self.assertEqual(json.dumps(self.result(), sort_keys=True), before)


class InputTests(ContractTests):
    # Do not inherit test cases twice; load_tests below selects own methods only.
    def via_raw(self, m, e=None):
        e = json.dumps(self.expected) if e is None else e
        with patch.object(contract.Path, 'read_text', side_effect=[m, e]) as read:
            result = contract.check_paths('synthetic-manifest.json', 'synthetic-expected.json')
        self.assertEqual(read.call_count, 2)
        return result

    def test_duplicate_json_keys_at_every_object_depth_and_both_inputs(self):
        normal = json.dumps(self.manifest)
        duplicates = [normal[:-1] + ',"head":"' + '1'*40 + '"}',
                      normal.replace('"files": {', '"files": {"same":"a","same":"a",', 1)]
        for raw in duplicates:
            for label in ('manifest', 'expected'):
                result = self.via_raw(raw, normal) if label == 'manifest' else self.via_raw(normal, raw)
                self.fired('json_duplicates', label, result=result)

    def test_invalid_json_empty_text_nonfinite_and_utf8(self):
        for raw in ('', ' ', '{', '[] trailing', '{"x":NaN}', '{"x":Infinity}', '{"x":-Infinity}'):
            self.fired('input_json', 'manifest', 'BLOCKED', self.via_raw(raw))
        with patch.object(contract.Path, 'read_text', side_effect=UnicodeDecodeError('utf-8', b'x', 0, 1, 'test')):
            result = contract.check_paths('m', 'e')
        self.fired('input_json', 'manifest', 'BLOCKED', result)

    def test_deep_json_is_rejected_without_recursing_through_extra_values(self):
        # Scan nested values iteratively, independently of the interpreter recursion limit.
        raw = json.dumps(self.manifest)[:-1] + ',"extra":' + '['*600 + '"r2"' + ']'*600 + '}'
        result = self.via_raw(raw)
        self.fired('extra_keys', 'manifest', result=result)
        self.fired('legacy_references', 'manifest', result=result)
        with patch.object(contract, 'parse', side_effect=[RecursionError(), self.expected]):
            self.fired('input_json', 'manifest', 'BLOCKED', self.via_raw('{}'))

    def test_unreadable_or_absent_paths(self):
        for error in (FileNotFoundError(), PermissionError(), IsADirectoryError()):
            with patch.object(contract.Path, 'read_text', side_effect=error):
                result = contract.check_paths('m', 'e')
            self.fired('input_json', 'manifest', 'BLOCKED', result)
            self.fired('input_json', 'expected', 'BLOCKED', result)

    def test_reads_only_two_explicit_documents_no_referenced_paths(self):
        seen = []
        def read(path, **kwargs):
            seen.append(str(path))
            return json.dumps(self.manifest if str(path) == 'caller-m' else self.expected)
        with patch.object(contract.Path, 'read_text', read), \
             patch('builtins.open', side_effect=AssertionError('unexpected IO')):
            result = contract.check_paths('caller-m', 'caller-e')
        self.assertEqual(seen, ['caller-m', 'caller-e'])
        self.assertEqual(result['verdict'], 'CONTRACT_OK_ON_SYNTHETIC')

    def test_cli_normal_and_fail_exit_codes_deterministic_json(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = contract.main([str(FIXTURES / 'manifest.json'), str(FIXTURES / 'expected-identifiers.json')])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(output.getvalue()), self.result())
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = contract.main([str(FIXTURES / 'r2-era.json'), str(FIXTURES / 'expected-identifiers.json')])
        self.assertEqual(rc, 1)
        self.assertEqual(json.loads(output.getvalue())['scope'], SCOPE)

    def test_cli_missing_arguments_and_options_never_read(self):
        for args in ([], ['one'], ['one', 'two', 'three'], ['--help'], ['--real', 'two']):
            output = io.StringIO()
            with contextlib.redirect_stdout(output), patch.object(contract, 'check_paths') as reader:
                rc = contract.main(args)
            reader.assert_not_called()
            self.assertEqual(rc, 2)
            self.fired('arguments', 'caller', 'BLOCKED', json.loads(output.getvalue()))

    def test_checker_has_only_stdlib_imports_and_no_write_process_network_apis(self):
        tree = ast.parse((HERE / 'check.py').read_text())
        allowed = {'hashlib', 'json', 'pathlib', 're', 'sys'}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                self.assertTrue(all(n.name in allowed for n in node.names))
            if isinstance(node, ast.ImportFrom):
                self.assertIn(node.module, allowed)
            if isinstance(node, ast.Call):
                name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, 'id', '')
                self.assertNotIn(name, {'open', 'write', 'write_text', 'write_bytes', 'mkdir', 'unlink',
                                        'rename', 'replace', 'resolve', 'stat', 'system', 'exec', 'eval',
                                        'Popen', 'run', 'connect', 'urlopen'})


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    for cls in (ContractTests, InputTests):
        for name in sorted(cls.__dict__):
            if name.startswith('test_'):
                suite.addTest(cls(name))
    return suite


if __name__ == '__main__':
    print(SCOPE, file=sys.stderr)
    unittest.main()
