#!/usr/bin/env python3
"""In-memory guard deletion, stdlib only: synthetic-only / not G3 evidence."""
import ast
import contextlib
import io
import json
from pathlib import Path
import sys
import types
import unittest

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SCOPE = 'synthetic-only / not G3 evidence'


def module_from_source(name, source, path):
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), module.__dict__)
    return module


def run_suite(tests, module):
    tests.contract = module
    suite = tests.load_tests(unittest.TestLoader(), None, None)
    result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
    return {'tests': result.testsRun, 'failures': len(result.failures),
            'errors': len(result.errors), 'successful': result.wasSuccessful()}


def mutate(source, name):
    tree = ast.parse(source)
    changed = 0
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        if node.name == name:
            # Remove the entire guard, retaining no PASS/FAIL/BLOCKED rows.
            node.body = [ast.Return(value=ast.List(elts=[], ctx=ast.Load()))]
            changed += 1
        elif name == 'json_duplicates' and node.name == 'unique_object':
            for child in ast.walk(node):
                if isinstance(child, ast.If):
                    child.test = ast.Constant(value=False)
                    changed += 1
        elif name == 'json_constants' and node.name == 'reject_constant':
            node.body = [ast.Return(value=ast.Constant(value=None))]
            changed += 1
        elif name in ('input_json', 'arguments') and node.name == (
                'check_paths' if name == 'input_json' else 'main'):
            for child in ast.walk(node):
                if (isinstance(child, ast.Call) and isinstance(child.func, ast.Name)
                        and child.func.id == 'row' and child.args
                        and isinstance(child.args[0], ast.Constant) and child.args[0].value == name):
                    child.args[2] = ast.Constant(value='PASS')
                    changed += 1
    if changed != 1:
        raise ValueError('mutation must replace exactly one guard: ' + name)
    return ast.fix_missing_locations(tree)


def main():
    source = (HERE / 'check.py').read_text(encoding='utf-8')
    # Import the test definitions without bytecode or stdout/stderr leakage.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        tests = module_from_source('synthetic_tests',
                                   (HERE / 'tests/test_contract.py').read_text(encoding='utf-8'),
                                   HERE / 'tests/test_contract.py')
    baseline_module = module_from_source('synthetic_baseline', source, HERE / 'check.py')
    baseline = run_suite(tests, baseline_module)
    rows = []
    if baseline['successful'] and baseline['tests']:
        names = [guard.__name__ for guard in baseline_module.CHECKS]
        names += ['json_duplicates', 'json_constants', 'input_json', 'arguments']
        for name in names:
            mutant = module_from_source('synthetic_mutant', mutate(source, name), HERE / 'check.py')
            result = run_suite(tests, mutant)
            # An assertion must fail; import/runtime errors alone do not kill a mutant.
            killed = result['failures'] > 0 and result['errors'] == 0
            rows.append(dict(mutation=name, detected=killed, scope=SCOPE, **result))
    unchanged = (HERE / 'check.py').read_text(encoding='utf-8') == source
    final = run_suite(tests, baseline_module)
    ok = (baseline['successful'] and baseline['tests'] > 0 and bool(rows)
          and all(r['detected'] for r in rows) and unchanged and final['successful'])
    print(json.dumps({'scope': SCOPE, 'verdict': 'CONTRACT_OK_ON_SYNTHETIC' if ok else 'FAIL',
                      'notice': 'test sensitivity only; not a manifest registration; not B07 closure; '
                                'does not read or change the real lock/tool manifest',
                      'g3Requirement': 'REQUIRED', 'g3Status': 'BLOCKED',
                      'b03Status': 'USER-ACCEPTED unresolved residual risk',
                      'b04Status': 'not_evaluated', 'b07Status': 'BLOCKED',
                      'baseline': baseline, 'mutations': rows,
                      'sourceUnchanged': unchanged, 'finalBaseline': final},
                     sort_keys=True, separators=(',', ':')))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
