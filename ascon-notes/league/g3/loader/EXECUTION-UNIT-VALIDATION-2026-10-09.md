# Execution-unit change validation — 2026-10-09

Scope: local uncommitted timing harness only. No commit/push, network, Docker,
model call, real exploration, main measurement or positive/negative timing control
was run. Existing archived measurements and pre-existing unrelated `$LOG` were
left alone. All edits for this change are under `ascon-notes/league/g3/`.

Implemented: one stock StrategyRunner per arm process, W=5 initial discarded
d=0 decides, N=40 measured decides by default, same W after each non-final measured
timeout before the next measured call. Stock timeout exception classification and
worker termination are unchanged. Failed warmup aborts without measuring cold
calls. Each unit records rewarm/discarded/measured counts and individual records.
Reports include A/B counts and per-point/overall imbalance warnings (difference
>=2 and >=10% of the larger count). See `TIMING-HARNESS.md` for the protocol.

Commands below ran from:
`/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/g3-probe-timing`

## Fast tests

```sh
node --import tsx --test ascon-notes/league/g3/tests/timing-options.test.mjs ascon-notes/league/g3/tests/timing-sweep.test.mjs ascon-notes/league/g3/tests/timing-unit.test.mjs
```

Exit 0: 36 tests, 36 passed, 0 failed, 0 skipped. These tests never launch a
measurement arm or real Worker. The new unit tests use an injected synthetic
runner, including timeout/replacement state, discarded accounting, exception-only
classification, per-decide aggregation, reporting, delay hit separation and
synthetic probe generation/timeout-gap inspection.

```sh
npm run typecheck
```

Exit 0 (`tsc --noEmit`), no diagnostics. The `.mjs` behavior is covered by the
synthetic tests; typecheck alone does not establish it.

```sh
python3 ascon-notes/league/g3/loader/mutation-check.py --fast
```

Exit 0. Four synthetic mutants killed:

| Mutant | Suite exit | Passed / failed |
| --- | ---: | ---: |
| derived endpoint bracketing removed | 1 | 13 / 1 |
| transition width rejection removed | 1 | 12 / 2 |
| sensitive point moved to c-3 | 1 | 13 / 1 |
| post-timeout decide counted as measured | 1 | 7 / 4 |

Sweep baseline/restored: 14/14. Unit baseline/restored: 11/11.
Both groups reported `restored_identical=True`.
Four existing probe-loader mutants were explicitly skipped because their suite
launches real Worker fixtures. The unrestricted mutation-check was not run.

## Authorized single-process smoke

```sh
node ascon-notes/league/g3/loader/smoke-timing-unit.mjs
```

Exit 0. The script executed `uptime` immediately before its only arm process:

```text
15:10  2 users, load averages: 1.54 2.03 2.45
```

load1=1.54 <4 satisfied the user's gate. Declared loose load limit=8; note:
`User-authorized one-arm d=0 smoke only; not idle-load or timing evidence`.
One probe arm, no artificial delay, T=100ms, W=5, N=3, d=0.

- rewarmCount=0; discardedDecideCount=5; measuredDecideCount=3.
- Measured rounds: 6, 7, 8; timeout flags: false, false, false.
- Measured wall ms: 0.19262499999996407, 0.19195799999999963, 0.171875.
- One runner, one worker generation, 63 probe records; original audit passed.
- No second arm or retry was launched. Temporary probe JSONL was removed.

This validates only the happy-path process protocol at d=0. It does not validate
real timeout/replacement behavior, arm balance, timing sensitivity, exploration
quality, controls or actual performance distributions. Those remain unverified.

## Diff/scope checks

```sh
git diff --check
git diff HEAD --name-only -- . ':(exclude)ascon-notes/league/g3/**'
```

Both exit 0 with no output. The second command establishes no tracked differences
outside G3, not absence of unrelated untracked files. Since the timing files are
untracked, they were also checked with `git diff --no-index --check /dev/null <file>`
for every untracked G3 file; exact batch command:

```sh
python3 - <<'PY'
import subprocess
paths = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z', '--', 'ascon-notes/league/g3/']).decode().split('\0')
for path in filter(None, paths):
    result = subprocess.run(['git', 'diff', '--no-index', '--check', '/dev/null', path], capture_output=True, text=True)
    assert result.returncode in (0, 1) and not result.stdout and not result.stderr, (path, result.returncode, result.stdout, result.stderr)
print('PASS: whitespace checked for all untracked G3 files')
PY
```

Exit 0; no whitespace errors. An initial wrapper using `check=True` exited 1
because `git diff --no-index` returns 1 for an added file even without whitespace
diagnostics. The corrected batch above accepts 0/1 only with empty stdout/stderr.
