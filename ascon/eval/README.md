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
| `lane-status.sh` | Read-only status of every lane on a host, one call | `test-lane-status.sh` |
| `watch-lanes.sh` | Laptop side: poll lane-status over ssh, print new lines, exit on done or hold | `test-lane-status.sh` |
| `new-worktree.sh` | A second checkout on the laptop that can run backtests | none |
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
