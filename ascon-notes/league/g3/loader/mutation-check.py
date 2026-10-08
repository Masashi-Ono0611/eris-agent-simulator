#!/usr/bin/env python3
"""Mutation check for probe-loader.mjs guards. Run from the repository root.

Each mutant removes one guard in memory-restored fashion; the suite must go red.
The original bytes are restored in a finally block and verified before exit.
"""
import subprocess
import sys

LOADER = 'ascon-notes/league/g3/loader/probe-loader.mjs'
TEST = 'ascon-notes/league/g3/tests/loader-probe.test.mjs'
MUTANTS = {
    'G3_WRONG_INSTANCE (prototype check)': (
        "if (Object.getPrototypeOf(runner) !== StockRunner.prototype) fail('G3_WRONG_INSTANCE');", 'void 0;'),
    'G3_WORKER_GAP': (
        "if (Atomics.load(new Int32Array(generation.attached), 0) !== 1) {\n      fail('G3_WORKER_GAP', { generation: generation.id });\n    }",
        'void 0;'),
    'G3_VERSION_UNBOUND': ("if (!versions.has(source)) fail('G3_VERSION_UNBOUND');", 'void 0;'),
}


def run_suite():
    r = subprocess.run(['node', '--import', 'tsx', '--test', TEST], capture_output=True, text=True)
    summary = [l for l in r.stdout.splitlines() if l.startswith(('ℹ pass', 'ℹ fail'))]
    return r.returncode, summary


def main():
    original = open(LOADER, 'rb').read()
    survived = []
    try:
        for name, (old, new) in MUTANTS.items():
            text = original.decode('utf-8')
            if text.count(old) != 1:
                print(name, 'PATTERN_NOT_UNIQUE', text.count(old))
                survived.append(name)
                continue
            open(LOADER, 'wb').write(text.replace(old, new).encode('utf-8'))
            rc, summary = run_suite()
            print(name, 'suite_rc=', rc, summary)
            if rc == 0:
                survived.append(name)
    finally:
        open(LOADER, 'wb').write(original)
    restored_ok = open(LOADER, 'rb').read() == original
    rc, summary = run_suite()
    print('restored_identical=', restored_ok, 'suite_rc=', rc, summary)
    if survived or not restored_ok or rc != 0:
        print('FAIL: survived/unrestored:', survived)
        sys.exit(1)
    print('OK: all mutants killed')


if __name__ == '__main__':
    main()
