#!/usr/bin/env python3
"""In-memory mutation suite; no subprocess/writes. synthetic-only / not G3 evidence."""
import ast
import copy
import importlib.util
import io
from pathlib import Path
import sys
import types
import unittest

BASE = Path(__file__).resolve().parent
NOTICE = "synthetic-only / not G3 evidence"


class GuardMutation(ast.NodeTransformer):
    def __init__(self, target):
        self.target = target
        self.count = 0

    def visit_Subscript(self, node):
        if (self.target == "world-dependent duplicate grouping"
                and isinstance(node.value, ast.Name) and node.value.id == "hashes"):
            # Reintroduce the defect: unknown-world source rows get unique keys.
            node.slice = ast.parse('(name, hash_value, row["ref"]["line"]) '
                                   'if self.world is None else (name, hash_value)', mode="eval").body
            self.count += 1
        return self.generic_visit(node)

    def visit_If(self, node):
        # Remove just the finding's guard block, retaining all other checks.
        if any(isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call)
               and isinstance(stmt.value.func, ast.Attribute) and stmt.value.func.attr == "finding"
               and len(stmt.value.args) > 2 and isinstance(stmt.value.args[2], ast.Constant)
               and stmt.value.args[2].value == self.target for stmt in node.body):
            self.count += 1
            return ast.copy_location(ast.Pass(), node)
        return self.generic_visit(node)


def main():
    # unittest receives freshly constructed suites each time; assertions and all
    # fixture expectations remain identical for the baseline and each mutant.
    spec = importlib.util.spec_from_file_location("mutation_tests", BASE / "tests/test_join.py")
    tests = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tests)
    original_module = tests.join
    source = (BASE / "join.py").read_bytes()
    tree = ast.parse(source)

    def run(label, module):
        tests.join = module
        suite = unittest.defaultTestLoader.loadTestsFromModule(tests)
        result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
        print(f"{NOTICE}: {label}: tests={result.testsRun} failures={len(result.failures)} errors={len(result.errors)}")
        return result

    baseline = run("baseline", original_module)
    if not baseline.wasSuccessful() or baseline.testsRun == 0:
        return 1
    survived = []
    mutations = [(check, "test_" + check.lower() + "_") for check in original_module.IMPLEMENTED]
    mutations += [
        ("world-dependent duplicate grouping", "test_j03_world_unknown_conflicting_csv_duplicate"),
        ("RECEIPT_UNAVAILABLE", "test_j07_successful_csv_without_receipt_is_blocked"),
        ("SUBMIT_HASH_DUPLICATE", "test_j03_submit_duplicates_and_repeated_nonce_are_reported"),
        ("SUBMIT_NONCE_REPEATED_ACROSS_HASHES", "test_j03_submit_duplicates_and_repeated_nonce_are_reported"),
    ]
    for check, positive_control in mutations:
        mutant = copy.deepcopy(tree)
        count = 0
        if check in original_module.IMPLEMENTED:
            for node in ast.walk(mutant):
                if isinstance(node, ast.FunctionDef) and node.name == "check_" + check.lower():
                    node.body = [ast.Pass()]
                    count += 1
        else:
            transform = GuardMutation(check)
            mutant = transform.visit(mutant)
            count = transform.count
        if count != 1:
            print(f"{NOTICE}: {check}: invalid mutation target")
            return 1
        ast.fix_missing_locations(mutant)
        module = types.ModuleType("posthoc_mutant_" + check)
        module.__file__ = str(BASE / "join.py")
        exec(compile(mutant, module.__file__, "exec"), module.__dict__)
        result = run("remove " + check, module)
        # An exception/import failure is not evidence of a killed guard. Require
        # an assertion failure in that check's own positive-control test.
        targeted = any(positive_control in test.id() for test, _ in result.failures)
        print(f"{NOTICE}: positive_control={positive_control}; assertion_failure={targeted}")
        if result.errors or result.testsRun != baseline.testsRun or not targeted:
            survived.append(check)
    tests.join = original_module
    restored = run("unchanged baseline", original_module)
    unchanged = (BASE / "join.py").read_bytes() == source
    print(f"{NOTICE}: killed={len(mutations) - len(survived)}/{len(mutations)}; "
          f"source_unchanged={unchanged}; survived={survived}")
    return 0 if not survived and unchanged and restored.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
