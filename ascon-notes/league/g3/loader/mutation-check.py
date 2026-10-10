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
    'G3_TOOLCHAIN_MISMATCH (override check)': (
        "if (toolchain.toolchainOverride && (toolchain.node !== toolchain.expectedNode || toolchain.tsx !== toolchain.expectedTsx)) {\n  throw probeError('G3_TOOLCHAIN_MISMATCH');\n}",
        'void 0;'),
    'G3_WRONG_INSTANCE (prototype check)': (
        "if (Object.getPrototypeOf(runner) !== StockRunner.prototype) fail('G3_WRONG_INSTANCE');", 'void 0;'),
    'G3_WORKER_GAP': (
        "if (Atomics.load(new Int32Array(generation.attached), 0) !== 1) {\n      fail('G3_WORKER_GAP', { generation: generation.id });\n    }",
        'void 0;'),
    'G3_VERSION_UNBOUND': ("if (!versions.has(source)) fail('G3_VERSION_UNBOUND');", 'void 0;'),
}


def run_suite(test=TEST):
    r = subprocess.run(['node', '--import', 'tsx', '--test', '--test-concurrency=1', test], capture_output=True, text=True)
    summary = [l for l in r.stdout.splitlines() if l.startswith(('ℹ pass', 'ℹ fail'))]
    if not summary:
        summary = [l for l in r.stdout.splitlines() if l.startswith(('# pass', '# fail'))]
    if r.returncode and not summary:
        print(r.stdout[-4000:], r.stderr[-4000:], flush=True)
    return r.returncode, summary


def check_mutants(path, test, mutants):
    rc, summary = run_suite(test)
    print('baseline suite_rc=', rc, summary, flush=True)
    if rc != 0:
        sys.exit('FAIL: baseline must pass before mutation')
    original = open(path, 'rb').read()
    survived = []
    try:
        for name, (old, new) in mutants.items():
            text = original.decode('utf-8')
            if text.count(old) != 1:
                print(name, 'PATTERN_NOT_UNIQUE', text.count(old))
                survived.append(name)
                continue
            open(path, 'wb').write(text.replace(old, new).encode('utf-8'))
            rc, summary = run_suite(test)
            print(name, 'suite_rc=', rc, summary, flush=True)
            if rc == 0:
                survived.append(name)
    finally:
        open(path, 'wb').write(original)
    restored_ok = open(path, 'rb').read() == original
    rc, summary = run_suite(test)
    print('restored_identical=', restored_ok, 'suite_rc=', rc, summary)
    if survived or not restored_ok or rc != 0:
        print('FAIL: survived/unrestored:', survived)
        sys.exit(1)
    print('OK: all mutants killed')


def main():
    if sys.argv[1:] not in ([], ['--fast']):
        sys.exit('usage: mutation-check.py [--fast]')
    if '--fast' in sys.argv:
        print('SKIP: 4 probe-loader mutants (real Worker fixtures excluded by --fast)', flush=True)
    else:
        check_mutants(LOADER, TEST, MUTANTS)
    check_mutants('ascon-notes/league/g3/loader/timing-sweep.mjs',
                  'ascon-notes/league/g3/tests/timing-sweep.test.mjs', {
        'derived endpoint bracketing removed': (
            "assert.ok(Object.values(endpoints).every(p => p.low <= CONTROL_THRESHOLDS.lowMax && p.high >= CONTROL_THRESHOLDS.highMin), 'derived endpoints must bracket success and timeout');",
            'void 0;'),
        'transition width rejection removed': (
            "assert.ok(!quality.rejected, 'too blurred to detect a 3 ms shift');",
            'void 0;'),
        'sensitive point moved to c-3': ('sensitiveOffsetMs: -4', 'sensitiveOffsetMs: -3'),
    })

    check_mutants('ascon-notes/league/g3/loader/timing-unit.mjs',
                  'ascon-notes/league/g3/tests/timing-unit.test.mjs', {
        'post-timeout decide counted as measured': (
            "await warm('rewarm');",
            "unit.decides.push(await decide(durationMs, 'measured')); unit.measuredDecideCount++; i++;"),
    })

    check_mutants('ascon-notes/league/g3/loader/timing-calibration.mjs',
                  'ascon-notes/league/g3/tests/timing-calibration.test.mjs', {
        'inaccurate dwell/delay abort removed': (
            "throw Object.assign(Error(code), { code, primitive: name, requestedMs: row.requestedMs });",
            'void 0;'),
    })
    check_mutants('ascon-notes/league/g3/loader/measure-timing.mjs',
                  'ascon-notes/league/g3/tests/timing-calibration.test.mjs', {
        'startup calibration gate bypassed': (
            'assertTimingCalibration(result.calibration);', 'void 0;'),
    })


    check_mutants('ascon-notes/league/g3/loader/timing-budget.mjs',
                  'ascon-notes/league/g3/tests/timing-reduced.test.mjs', {
        'reduced budget stop removed': (
            "throw error(now() - started > limitMs ? 'elapsed' : 'projection');",
            'void 0;'),
    })
    check_mutants('ascon-notes/league/g3/loader/timing-reduced.mjs',
                  'ascon-notes/league/g3/tests/timing-reduced.test.mjs', {
        'reduced positive two-sided band removed': (
            'Number.isFinite(shift) && shift >= REDUCED.positiveMinMs && shift <= REDUCED.positiveMaxMs',
            'Number.isFinite(shift)'),
        'reduced interval check replaced by point estimate': (
            'Number.isFinite(interval?.lower) && interval.lower > 0',
            'Number.isFinite(row?.difference) && row.difference > 0'),
        'reduced sensitive point moved to c-3': (
            'sensitiveOffsetMs: -4', 'sensitiveOffsetMs: -3'),
    })


if __name__ == '__main__':
    main()
