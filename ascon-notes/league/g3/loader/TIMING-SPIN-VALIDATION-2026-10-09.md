# Spin primitive correction — validation 2026-10-09

Scope: existing uncommitted timing harness in `g3-probe-timing`. This patch only
edits `ascon-notes/league/g3/`; no commit, push, network, Docker or model call.
The Mac mini measurements (85.8/171.3ms Atomics vs 10.01/25.01ms spin) were supplied
by the user, not reproduced here.

Executed from the worktree root:

```sh
node --import tsx --test --test-concurrency=1 ascon-notes/league/g3/tests/timing-calibration.test.mjs ascon-notes/league/g3/tests/timing-options.test.mjs ascon-notes/league/g3/tests/timing-sweep.test.mjs ascon-notes/league/g3/tests/timing-unit.test.mjs
npm run typecheck
python3 ascon-notes/league/g3/loader/mutation-check.py --fast
git diff --check
```

- Fast tests: exit 0, 43 tests passed, 0 failed, 0 skipped. Seven new calibration
  tests include short real spin waits, a deliberately oversleeping setTimeout
  positive control, deterministic statistics, both named failures, artifact
  fields, and all four run configurations with a synthetic launch tripwire.
- Typecheck: exit 0 (`tsc --noEmit`).
- Mutation check: exit 0. All six executed mutants killed (each mutant suite
  exits 1), baseline/restored suites exit 0 and restored bytes identical.
- `git diff --check`: exit 0, no output. Git's tracked diff does not include
  untracked harness files. All nine untracked files added/edited by this patch
  were also checked with `git diff --no-index --check /dev/null <path>`: no
  diagnostics. That command returns 1 for new-file differences; the initial
  wrapper incorrectly treated this as failure, then the corrected wrapper
  verified all 9/9 while accepting exit 1 only with empty stdout/stderr.

| Mutant | pass/fail with mutant | baseline and restored pass/fail |
| --- | --- | --- |
| Derived endpoint bracketing removed | 13/1 | 14/0 |
| Transition width rejection removed | 12/2 | 14/0 |
| Sensitive point moved to c-3 | 13/1 | 14/0 |
| Post-timeout decide counted as measured | 7/4 | 11/0 |
| Inaccurate dwell/delay abort removed (new) | 4/3 | 7/0 |
| Startup calibration gate bypassed (new) | 6/1 | 7/0 |

The four real-Worker probe-loader mutants were explicitly skipped by `--fast`.
No real exploration, positive/negative boundary control, measurement, Worker
smoke, full production 20-sample calibration, Mac mini run, network, Docker,
model, chain or strategy evaluation was run. The default calibration profile
was tested with an injected clock; the live spin test used 5 samples each at
0.5/1/2ms. Startup integration tests replace arm launch, so they do not establish
stock Worker runtime accuracy or timing sensitivity. Coordinator calibration
alone does not establish Worker scheduling behavior under measurement load.

The run JSON/Markdown now records both primitives' requested/achieved statistics
before enforcing the fixed 1ms median-error gate. Load refusal records not-run.
Historical measurement/control artifacts were not regenerated.
