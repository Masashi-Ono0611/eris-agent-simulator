# Stage-1 arm map and family calibration, 2026-10-23

Worktree: feat/mechanism, starting HEAD 10045fc0. No commits or network access.

## Arm handling

The explicit `--arms LABEL=agent-dir` map is carried in the manifest as `arm_map`.
B=opus-1 and B'=opus-1-pb are required. Defaults are R=opus-1r,
W1=opus-1g, W2=ascon-zeta-r3k, X1=opus-1g2, X2=opus-1w,
X3=ascon-zeta-r3kg. No implicit C1. Each candidate receives the same frozen
superiority rule independently. Missing W2 blocks W2, while other candidate
verdicts are retained (overall selection stays pending). X labels and known X
directories are exploratory; stage-1 PASS is “go to stage 2”, never shipment.
The original explicit legacy C1 rule remains available in legacy manifests.

## Report-only MC

Noise: `/private/tmp/claude-501/-Users-masashi-mac-ssd-Developer-ascon/a6a3f651-0db9-44e2-821d-4d07b8dc21f6/scratchpad/stepR/noise-r2r3.json`

Verified SHA256: `8d0e83d77b8bab7238061466edfad2ac68ba2a10c544f6b76423742761321505`.

```sh
python3 -B ascon/final/mc.py run --noise <noise-path-above> \
  --calibrate --candidates R W1 W2 --sims 40000 --rng-seed 231023 \
  --json /private/tmp/ascon-mc-three-231023.json
```

Gaussian, scale 1, measured launch noise, placebo uses candidate noise,
rho 0, tau FP/FD/FS=0.25/0.5/0.5, FS copies FD. All three candidates have
the same non-launch effect; launch effect and tagged mechanism PnL are zero.
Input, clause-5, and noop guards are assumed PASS. C1 and X are not simulated.
Stage 2 uses stage-1 placebo f. Shared B is drawn for potential finalists;
only the top two stage-1 passers by frozen m/label ranking may ship through
stage 2 and FS. Passing only as the third-ranked candidate cannot ship.
The interval grid calculation was checked against judge2.select at boundaries.

40,000 trials per effect (0, +0.5, +1.0), RNG seed 231023. Wilson upper endpoint
of the two-sided 95% interval, z=1.96. Tightening grid 0.81:0.01:3.00.

| t | Null ships / 40,000 | False ship | MC SE (percentage points) | Upper-95 |
|---|---:|---:|---:|---:|
| 0.81 | 1,022 | 2.5550% | 0.078894 | 2.714249% |
| 0.93 | 753 | 1.8825% | 0.067953 | 2.020383% |
| **0.94** | **740** | **1.8500%** | **0.067375** | **1.986754%** |

0.94 is the smallest qualifying grid point. At 0.81, +0.5/+1.0 ship rates
are 20.3675% / 40.1225%; at 0.94 they are 17.4825% / 38.5275%.
This is the calibration sample, not independent-seed validation or live/backtest
acceptance. `judge2.T_CRIT` stays **0.81**; no threshold was changed.

Run code hashes (captured by mc.py):
- `mc.py`: `dd109ee660346a267daf3d8b5ae03ac894a46fa09780eb7af776fabd947d6187`
- `judge2.py`: `a548bbe803851bdda92fff75a5b59708dc73358d5dc9de9e7a1f9c98fa6f0fc2`

The judge later regained its legacy maximum-one-noninferiority input guard;
no MC evaluation function or threshold changed after the run started.
Full result: `/private/tmp/ascon-mc-three-231023.json` (temporary artifact).

## Verification

- `bash ascon/final/test-evidence.sh`: exit 0, `ALL_CONTROLS_OK`.
  Explicit full map, no C1, missing W2, extraction map propagation, conflicting
  maps, and manifest/mechanism deliberate mutation controls passed.
- `bash ascon/final/test-judge2.sh "$PWD"`: exit 0, `ALL_CONTROLS_OK`.
  Existing synthetic controls: 165/165; MC controls: `MC OK`.
  New full-map and missing-W2 controls pass; X PASS goes to stage 2, never ship;
  removing X classification trips the red control. Three-arm MC selection
  agrees with the frozen selector, including third-arm exclusion.
  Optional saved real-matrix checks skipped: no REAL_DIR supplied.
- `/bin/bash ascon/eval/test-all.sh`: exit 0, all 8 suites OK,
  `ALL_HARNESS_OK`.
- `npm run typecheck`: exit 0.
- `git diff --check`: exit 0.

Logs: `/private/tmp/ascon-evidence.log`, `/private/tmp/ascon-judge2.log`,
`/private/tmp/ascon-all.log`, `/private/tmp/ascon-typecheck.log`,
`/private/tmp/ascon-mc-three-231023.log`.
