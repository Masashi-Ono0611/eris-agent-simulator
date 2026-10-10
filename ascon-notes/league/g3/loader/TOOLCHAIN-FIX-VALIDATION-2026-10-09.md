# Toolchain override and load-note fix validation

Local validation only, 2026-10-09. Working directory:
`/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/g3-probe-timing`.

Actual validation runtime: Node **v24.13.0**, tsx **4.23.13**, **darwin / arm64**.
This is not a Mac mini / x64 / Node v24.13.1 measurement.

## Changes

- Default Node v24.13.0 / tsx 4.23.13 remain fail-closed.
- Explicit `G3_PROBE_EXPECT_NODE` / `G3_PROBE_EXPECT_TSX` replace only their respective expectations. Wrong or empty expectations still throw `G3_TOOLCHAIN_MISMATCH`.
- The first probe record contains actual Node/tsx versions and `toolchainOverride`.
- Measurement subprocesses receive the explicit overrides. JSON host metadata records actual versions, arch, expectations, override flag and the toolchain-only qualification. Child startup metadata is checked and retained in `armToolchains`; completed probe diagnostics retain the registration record. Markdown renders actual versions, arch, flag and qualification, including refusal and control reports.
- `loader-timing.test.mjs` already used `parseTimingEnvironment(process.env)` in this working tree. That parser already forwarded `G3_TIMING_LOAD_NOTE`; errors now name `G3_TIMING_LOAD_NOTE` and `G3_TIMING_MAX_LOAD1`. CLI errors keep CLI option names.
- Artifact validation compares toolchains as well as host/load settings. The tracked-file guard permits the authorized G3 edits while continuing to reject tracked changes outside G3.
- All edits are under `ascon-notes/league/g3/`. No commit/push, network, Docker or model calls.

## Exact validation commands and observed results

Runtime inspection:

```sh
node --version
node -p "require('tsx/package.json').version"
node -p "JSON.stringify({node:process.version,tsx:require('tsx/package.json').version,arch:process.arch,platform:process.platform})"
```

All exit 0. Output: v24.13.0; 4.23.13; `{"node":"v24.13.0","tsx":"4.23.13","arch":"arm64","platform":"darwin"}`.

Red regression check, before implementation:

```sh
node --import tsx --test --test-name-pattern='toolchain guard|toolchain override|control environment' ascon-notes/league/g3/tests/loader-probe.test.mjs ascon-notes/league/g3/tests/timing-options.test.mjs
```

Exit 1: 4 tests, 1 passed, 3 failed. Default mismatch already rejected; incorrect overrides, override recording, and the environment-variable error message failed.

Initial green check after implementation:

```sh
node --import tsx --test ascon-notes/league/g3/tests/timing-options.test.mjs ascon-notes/league/g3/tests/loader-probe.test.mjs
```

Exit 0: 26 tests passed, 0 failed, about 10.22 seconds. This preceded the additional metadata/report test and the explicit override in the existing no-witness fixture test.

Final fast option/report checks:

```sh
node --import tsx --test ascon-notes/league/g3/tests/timing-options.test.mjs
```

Exit 0: 11 tests passed, 0 failed. No measurement process or timing Worker started. Synthetic render checks cover actual-version fields, arch, override flag/qualification and load-note parsing. Six archived Air artifacts still match their recorded hashes.

Final probe suite and mutation checks:

```sh
python3 ascon-notes/league/g3/loader/mutation-check.py
```

The script runs this command for its baseline, each mutant, and restored loader:

```sh
node --import tsx --test ascon-notes/league/g3/tests/loader-probe.test.mjs
```

Overall script exit 0:

| Case | Suite exit | Passed | Failed |
| --- | ---: | ---: | ---: |
| Baseline | 0 | 16 | 0 |
| Remove override mismatch check | 1 | 15 | 1 |
| Remove prototype wrong-instance check | 1 | 15 | 1 |
| Remove worker-gap check | 1 | 15 | 1 |
| Remove unbound-version check | 1 | 14 | 2 |
| Restored loader | 0 | 16 | 0 |

`restored_identical=True`; all four mutants killed. The probe suite verifies 178 protected tracked files against HEAD by SHA-256. Its fixtures include offline Workers and guard positive controls; these are not the timing measurement controls.

```sh
npm run typecheck
git diff --check
```

Both exit 0. Typecheck executes `tsc --noEmit`. Diff check produced no output.

## Not run / not verified

- No real measurement and no `loader-timing.test.mjs` execution, including its positive/negative timing controls.
- No `runExperiment` call, timing sweep, or regenerated measurement/control artifacts.
- No Node v24.13.1 binary, alternate tsx installation, or Mac mini/x64 execution. Different Node guard conditions use a synthetic `process.version` property in registration-only child processes; this does not verify runtime compatibility with that Node binary.
- The full measurement-child startup/report pipeline and artifact validator were not exercised against a new measured run. Fast tests verify configuration, guard behavior and pure report generation only.
- No Docker, external network, model, chain or backtest validation.
