# ascon/eval: running and judging backtest matrices

End to end, for the final evaluation (ascon/final) on the Mac mini, with the laptop as an optional third
lane. Every script prints one-line markers; wait on markers, never on an ssh exit code (`tailscale ssh`
returns 0 even when the remote command failed).

| Script | What it does | Control test |
|---|---|---|
| `run-matrix.sh` | One matrix; `EXIT_<name>=<rc> VERDICT=<PASS\|FAIL\|BLOCKED>` | `test-run-matrix.sh` |
| `check-matrix.py` | Is matrix.json complete against the scenarios and roster (run-matrix calls it) | (in `test-run-matrix.sh`) |
| `check-collision.py` | Did the matrix share a run directory with another run | `test-check-collision.sh` |
| `lane-queue.sh` | One queue file: roster per job, run-matrix, check-collision, check-arm, one EXIT line per job | `test-lane-queue.sh` |
| `lane-chain.sh` | One lane: the queue files of `pending/` one after another, then idle until more arrive | `test-lane-chain.sh` |
| `mini-lane-start.sh` | Start a lane-chain on a checkout pinned to a commit | `test-mini-lane-start.sh` |
| `lane-eta.py` | Read-only per-lane progress, timing proxies and conditional ETA | `test-lane-eta.sh` |
| `lane-status.sh` | Read-only status of every lane on a host, one call | `test-lane-status.sh` |
| `watch-lanes.sh` | Laptop side: poll lane-status over ssh, print new lines, exit on done or hold | `test-lane-status.sh` |
| `new-worktree.sh` | A second checkout on the laptop that can run backtests | none |
| `docker-selftest.sh <arm> <commit>` | Fresh detached tree, deploy on port 8855, regenerate constants, Docker selftest; `SELFTEST_PASS` / `SELFTEST_FAIL` / `BLOCKED` with logs | `test-docker-selftest.sh` |
| `release-bundle.sh <arm> <commit>` | Fresh detached tree, bundle + submission scan + byte comparison; unique ZIP and JSON receipt | `test-release-bundle.sh` |
| `test-all.sh` | Every control test above with /bin/bash: `ALL_HARNESS_OK` | itself (red-checked with broken fakes) |

Run `/bin/bash ascon/eval/test-all.sh` after changing anything here or in ascon/final. CI does not run
these tests.

## 1. A checkout per commit

- **Mini:** `mini-lane-start.sh` makes `~/Developer/ascon-wt-<sha8>` from `~/Developer/ascon` at the commit
  you name, links `node_modules` and `out`, and never checks anything out inside an existing tree (lanes
  may be running from it; a script or agent file changed under a running job is shell-ops S24). A new arm
  on a new commit gets a new tree. Push the commit first: it must be fetchable on the mini.
- **Laptop:** the main repo is bare. Run `new-worktree.sh <path> <ref>` from the worktree that holds the
  real `node_modules` and `out/`, which is `.claude/worktrees/opus-1-model`: keep that worktree until 10/31
  even though its branch is merged, or every laptop backtest fails in seconds.
- The `out` symlink is untracked, not ignored (`.gitignore` has `out/`, a directory pattern). Commit with
  explicit paths, never `git add -A` or `git add .`.

## 2. Arms and rosters

An arm is a directory under `example/agents/`. Before its matrices count, run
`python3 ascon/final/check-trap-scope.py` for it on the commit that will be measured (ascon/final/README.md,
"No trap control"). Rosters `ascon/final/roster-{FP,FD,FS}.yaml` are templates with `__SLOT_DIR__`;
lane-queue renders one copy per job.

## 3. Queue files

Write them with `ascon/final/make-queues.py`, not by hand:

```
python3 ascon/final/make-queues.py --stage s1 --seeds 1003-1006 --fields FP,FD \
  --arms opus-1,opus-1-pb,opus-1a --lanes A,B --order-seed <int> --out <dir>
python3 ascon/final/make-queues.py --check <dir>     # PASS, or one FAIL line per problem
```

One file per lane (`<stage>-<lane>.txt`), job names `<stage>-<field><seed>-<arm>`. A cell (one seed, one
field) runs all its arms back to back on one lane in a recorded random order; cells alternate lanes so
every lane runs every field. `--check` catches a duplicate or missing arm, a slot dir or scenario file that
does not exist, a wrong scenario file and a cell split across lanes; run-matrix and check-matrix cannot,
because they compare agent ids only. Pick the order seed before seeing any result and record it.

## 4. Starting lanes

On the mini, one call per lane, from any checkout that has the script:

```
mkdir -p ~/ascon-final/chain-A/pending && cp <dir>/s1-A.txt ~/ascon-final/chain-A/pending/
bash ascon/eval/mini-lane-start.sh A <sha> ~/ascon-final/chain-A 8700
bash ascon/eval/mini-lane-start.sh B <sha> ~/ascon-final/chain-B 8710   # waits out the 20 s gap itself
```

It checks that every pending queue's rosters, slot dirs and scenario files exist in the pinned tree
(BLOCKED otherwise), copies a state dir `~/ascon-final/state-<lane>` if missing, refuses only when that
lane already has a chain, sleeps until 20 s after the last start of any lane (two runs started in the same
millisecond share `runs/<start time>`; upstream PR #324 is not in our tree), and prints
`CHAIN_RUN_<lane> pid=... sha=... tree=...`.

Rules: one port and one state dir per lane; at most two lanes on the mini (12 cores, load about 16 with
two); on the laptop at most one lane, started only when load1 is below 10, never next to large workflows,
and never with one cell's arms split across hosts. Logs live in `~/ascon-final/logs` (not /tmp: macOS
deletes files there after 3 idle days).

**Keep lanes busy.** lane-chain takes the next file in `pending/` the moment a queue ends. Keep one queue
in every lane's `pending/` that needs no decision (ascon/final/README.md, "Lanes stay busy"); add files to
`pending/` at any time. To stop a lane after its current queue: `touch ~/ascon-final/chain-<lane>/STOP`. To
move a lane to a new commit: STOP it, wait for `CHAIN_STOP_<lane>`, then `mini-lane-start.sh` with the new
sha. Remove an old tree (`git -C ~/Developer/ascon worktree remove <tree>`) only after every lane that ran
from it has ended.

## 5. Waiting

From the laptop, one background job, watched with Monitor:

```
bash ascon/eval/watch-lanes.sh 'bash ~/Developer/ascon-wt-<sha8>/ascon/eval/lane-status.sh'
```

Every 10 min it makes one ssh call (60 s timeout), prints only new EXIT/HOLD/QUEUE_DONE/IDLE/CHAIN lines
and lane state changes, and exits 0 when no lane is running (`ALL_DONE=1`) or 3 when one needs a decision
(`HOLD=1`: HOLD, a dead lane-queue, or a held queue). For a one-off look, run lane-status.sh once over ssh.
Do not poll with ad hoc ssh sleep loops.

Markers, per lane (`<logs>/<lane>.queue.log`, `<logs>/<lane>.chain.log`):

- `NOTE_<job> run=<id> slot=<arm> ... head=<commit> arm_tree=<tree> lib_tree=<tree> dirty=<0|1> load1=<x>`:
  what ran.
- `EXIT_<job>=<rc> VERDICT=<..> COLLISION=<..> ARM=<..> run=<id>`: one per job.
- `QUEUE_DONE_<lane> run=<id>`: a queue finished. `HOLD_` (disk), `STOPPED_` (signal): it did not.
- `IDLE_<lane>`, `CHAIN_HELD_<lane>`, `CHAIN_STOP_<lane>`: the chain is waiting, needs a decision, or ended.

## 6. Which matrices count

Only jobs with `VERDICT=PASS COLLISION=PASS ARM=PASS`:

- VERDICT (run-matrix + check-matrix): every scenario has results. The backtest CLI exits 0 even when
  every scenario failed, so the exit code alone means nothing.
- COLLISION (check-collision.py): no run directory was shared with another run. VERDICT=PASS cannot see
  this.
- ARM (ascon/final/check-arm.py): the slot ran that arm's directory, frozen (mode `decide`). Under slot
  replacement every arm's agent is `slot`, so nothing else can tell arms apart.

A FAIL or BLOCKED of either check has a NOTE line with its first 300 characters. Before shipping, apply the
"Shipping check" in ascon/final/README.md to the job's `head=` and `arm_tree=`.

## 7. Judging

`ascon/final/judge2.py` reads the counted matrices of a stage and applies the plan's pre-registered rule
(see its docstring). Feed it only matrices that passed section 6.
Use `ascon/final/make-manifest.py` and `mechanism.py` on copied logs/runs; usage, retry
selection and path mappings are documented in `ascon/final/README.md`. Stage-1 p99 remains
unmeasured: the extractor writes null and the frozen judge blocks its latency subclause.
No decision to waive that requirement has been made by these tools.

## Pitfalls seen in this project

- Same (regime, seed) from one state dir in parallel: rosters swap silently. One state dir per lane.
- Two runs started in the same millisecond share a run directory, and run-matrix still says PASS.
- A matrix runner that exits 0 on total failure; a `tailscale ssh` that returns 0 on remote failure.
- A blocking RPC inside `decide()` (2-4 ms) loses equal-fee ties about 2:1: compare arms of a cell on one
  lane under similar load, and never add fee wei or delay to a placebo.
- The laptop ran three heavy jobs at load 43-47 (10 cores): timing-sensitive results from such a host are
  not comparable.
- A control test that names a "nonexistent" arm breaks the day that arm is created (test-checks.sh used
  opus-1a): use names that can never be agent directories.

## Read-only ETA from copied logs

```sh
python3 ascon/eval/lane-eta.py --logs /copies/logs --chains /copies/chains \
  --job-hours-default 2.5 --next B=/copies/chain-B2 --next C=/copies/chain-C2
```

`--chains` is a parent containing `chain-A/` (or `A/`), etc., each with
`pending/` and `running/`. `--next LANE=QUEUE_DIR` is repeatable and adds that
queue's `pending/*.txt` jobs after current work. `chain-<lane>2` directories under
`--chains` are automatically reported and attached to that lane, not separate
lanes. Repeated explicit/auto-detected paths count once; the current directory
is never counted twice. Waiter processes/PIDs are not inspected, so detection
is an inventory assumption, not proof that a swap will execute.
Only these explicit paths and logs are read; remote
paths mentioned in log lines are never opened. Nothing is written into them.
Running files subtract EXITs from their matching run (chain file/run mapping,
then queue basename); pending files count every job, including deliberate reruns.
Without inventory, remaining work comes from the latest QUEUE_START jobs count
minus unique EXITs, and pending remains unknown. ETA covers known work only.

Each lane is parsed independently in its own append order, with run IDs delimiting attempts.
For timing, the latest run defines the run family: lane-chain IDs have the form
`<lane>-[<tag>-]<queue stem>`, so the exact logged queue stem suffix is removed.
Unrecognized IDs match only themselves (conservative fallback). Duplicate EXITs for a job/run collapse. Latest attempts, including
in-flight retries, replace older attempts of that job. A failed-only run with any
job retried in a later run is treated as superseded in its entirety; this explicit
heuristic handles the renamed 20/22/23 killed/stale-lock queues. It assumes those
failed-only overlapping runs are replacements, not unrelated partial queues.
Mixed successful runs retain unrelated jobs. PASS requires rc=0 and VERDICT,
COLLISION and ARM all PASS; legacy records without ARM count as not PASS.
BLOCKED is a finished not-PASS attempt, never a timing sample from an old job log.
This progress selection differs from make-manifest's last-valid-PASS selection.

NOTE/EXIT normally have no timestamps. For each sequential job, a timestamp on
its NOTE/EXIT is preferred; otherwise QUEUE_START (or CHAIN_START for its first
queue only) anchors the first start, the previous job's endpoint anchors the next
start, and the latest attempt's `<job>.log` mtime approximates its end. Missing
endpoints break adjacency. Only launched, latest PASS attempts with `s1-` job names in the latest run's
family and same lane contribute. Failed, killed, BLOCKED, other-stage and older
family jobs never enter the mean. At least two usable intervals are required,
otherwise the default is used. Output lists the family and timed `run/job`
samples, and separately which jobs actually contributed to the mean (none when
using the default).
Queue/chain log mtimes and timestamp-looking matrix paths are not job endpoints.
Naive ISO timestamps are interpreted in the reader's local timezone: use the
source host's TZ when reading copies (e.g. `TZ=Asia/Tokyo`).

These are wall-time proxies, not exact durations: between-job overhead/checking
is included or shifted between intervals, chain startup delay inflates the first
interval, and overwritten or copy-reset mtimes can invalidate timing entirely.
Preserve mtimes when copying; their error cannot be bounded from logs alone.
No liveness is inferred: stopped/held ETA is conditional on resume, other ETA is
a projection from now, charging the in-flight job a full mean. Idle gaps, load,
retries, unequal smoke/full-matrix lengths and unknown pending work add unbounded
forecast error. A directory with only queue logs reports the missing measurements
and uses the default, rather than interpreting copy time as completion time.

## Release helpers (Mac mini)

Run `bash ascon/eval/docker-selftest.sh <arm> <commit>` and
`bash ascon/eval/release-bundle.sh <arm> <commit>` from a non-lane checkout.
Commits must already be available locally (7–40 lowercase hex); neither helper fetches or installs.
`ASCON_HOME` selects the dependency/source checkout (default: the checkout containing the helper).
It must have `node_modules/` and `out/`; both are linked into the new detached checkout.
GMX project files (including artifacts/TypeChain and non-localhost deployments) are private
APFS clones (`cp -cR`, falling back to `cp -R`); only its top-level `node_modules` is shared.
Git metadata and credential-like paths are omitted; internal symlinks are rebased and escaping
nested symlinks block setup. GMX `deployments/localhost` and cache start empty: this avoids
stale addresses and absolute cache paths, at the cost of a full initial GMX recompile.
Aave dependencies and Liquity's read-only artifact tree remain shared; Aave outputs stay private.
The Docker wrapper prepends `~/.local/ascon-docker-shim`, `~/.homebrew/bin`, and `~/.foundry/bin` to PATH
so child agents also receive the Colima shim.

Selftest creates `$ASCON_WT_BASE/ascon-selftest-<sha8>` (`ASCON_WT_BASE` defaults to `~/Developer`).
Existing paths are refused, including a previous selftest tree; use a fresh base for a repeat.
Port **8855** is the default (`ASCON_SELFTEST_PORT` overrides); ports 8700–8810, occupied ports,
lane paths and `~/ascon-final` paths are refused. A per-port lock prevents simultaneous helper starts
in the same base. Deploy receives `RPC_URL`, selftest receives matching `ERIS_RPC_URL`.
Readiness requires both `anvil is still running` and the new tree's `deployer/deployments/deployments.json`.
`ASCON_DEPLOY_TIMEOUT` defaults to 600 seconds; selftest has a 3600-second timeout.
Constants are regenerated only there. The fresh-chain image build explicitly allows the state-dump
overlay mismatch, and inherited ERIS runtime overrides are cleared except the memory cap.
Logs are retained in a fresh temporary directory printed as `LOG_PATH`; the final marker repeats it.
Cleanup signals owned process groups and removes only containers with mounts inside the new tree.
Existing matching container names block startup; no broad reaper is used.

Bundle uses another fresh temporary directory, invokes `bundleAgent.ts <arm> --out <unique-path>`
(without `--submission`), scans using `infra/submission/scan-submission.py --json`, lists ZIP members,
and compares every agent file to `agents/<arm>/` byte-for-byte, including extra files. Missing/different
files produce `RELEASE_FAIL`. The ZIP path, size and SHA-256 are printed; an adjacent JSON records arm,
full commit, ZIP SHA-256, scan result and member list. Scan rejection also produces `RELEASE_FAIL`;
setup errors produce `BLOCKED`. No existing ZIP is overwritten. Exit codes: 0 pass, 1 fail, 2 blocked.
Both helpers retain their detached trees for inspection and never recursively delete them; the owner
can remove them manually after review. They do not update lane checkouts or final-state directories.
These helpers cover packaging and selftest only, not the other Step 8 gates or submission acceptance.
