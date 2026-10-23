#!/bin/bash
# Read-only status of every evaluation lane on this host, in one call (meant for one ssh from the laptop).
#   bash ascon/eval/lane-status.sh [lane ...]
# Reads <logs>/*.queue.log, <logs>/<lane>.chain.log and the job logs (<logs> = $ASCON_EVAL_LOGS, default
# ~/ascon-final/logs). It changes nothing. For each lane (all lanes with a queue log, or the ones named):
#   LANE <lane> run=<last run id> state=<RUNNING|DONE|HOLD|STOPPED|DEAD|IDLE|CHAIN_HELD|CHAIN_STOP>
#        job=<current job or -> scen=<started>/<total> or - jobs=<markers written>/<jobs in the queue>
#   then that run's EXIT_ lines, its HOLD_/STOPPED_/QUEUE_DONE_ line, and the last chain line (IDLE_,
#   CHAIN_HELD_, CHAIN_STOP_, CHAIN_STOPPED_) if the lane has a chain.
# state: RUNNING the run has no end line and its lane-queue pid is alive; DEAD no end line and the pid is
# gone (killed or a reboot: its locks are left behind, see lane-queue.sh); IDLE / CHAIN_* when the chain's
# last line says so and no queue is running. scen is "[backtest] scenario <i>/<n>" from the current job's
# log: <i> has started, so <i>-1 are finished.
# Last lines: "HOST load1=<x> free_gib=<n>" and "ALL_DONE=<0|1> HOLD=<0|1>": ALL_DONE=1 when no lane is
# RUNNING; HOLD=1 when any lane is HOLD, DEAD or CHAIN_HELD (a decision is needed).
set -u
logs="${ASCON_EVAL_LOGS:-$HOME/ascon-final/logs}"
load1="$(sysctl -n vm.loadavg 2>/dev/null | awk '{ print $2 }')"
[ -n "$load1" ] || load1="$(awk '{ print $1 }' /proc/loadavg 2>/dev/null)"
free_gib="$(df -Pk "$HOME" 2>/dev/null | awk 'NR == 2 { printf "%d", $4 / 1048576 }')"
python3 - "$logs" "${load1:--}" "${free_gib:--}" "$@" <<'PY'
import glob, os, re, sys
logs, load1, free_gib, want = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
if not os.path.isdir(logs):
    print(f"NO_LOGS {logs}")
    print(f"HOST load1={load1} free_gib={free_gib}")
    print("ALL_DONE=0 HOLD=1")
    sys.exit(0)
def read(p):
    try:
        with open(p, errors="replace") as f:
            return f.read().splitlines()
    except OSError:
        return []
def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False
lanes = sorted({os.path.basename(p)[: -len(".queue.log")] for p in glob.glob(os.path.join(logs, "*.queue.log"))}
               | {os.path.basename(p)[: -len(".chain.log")] for p in glob.glob(os.path.join(logs, "*.chain.log"))})
if want:
    lanes = [l for l in want]
any_running, any_hold = False, False
for lane in lanes:
    q = read(os.path.join(logs, f"{lane}.queue.log"))
    starts = [l for l in q if l.startswith(f"QUEUE_START_{lane} run=")]
    chain = [l for l in read(os.path.join(logs, f"{lane}.chain.log"))
             if re.match(rf"(IDLE_{re.escape(lane)}|CHAIN_HELD_{re.escape(lane)}|CHAIN_STOP_{re.escape(lane)}|CHAIN_STOPPED_{re.escape(lane)}|CHAIN_QUEUE_{re.escape(lane)}|CHAIN_START_{re.escape(lane)})\b", l)]
    if not starts:
        state = "NONE"
        if chain:
            state = next((k for k in ("IDLE", "CHAIN_HELD", "CHAIN_STOPPED", "CHAIN_STOP") if chain[-1].startswith(k + "_")), "RUNNING")
        any_running |= state == "RUNNING"
        any_hold |= state == "CHAIN_HELD"
        print(f"LANE {lane} run=- state={state} job=- scen=- jobs=-")
        if chain:
            print(chain[-1])
        continue
    m = re.match(rf"QUEUE_START_{re.escape(lane)} run=(\S+) .*pid=(\d+).* jobs=(\d+)", starts[-1])
    run, pid, njobs = (m.group(1), m.group(2), m.group(3)) if m else ("?", "", "?")
    tok = f" run={run}"
    mine = [l for l in q if (l + " ").find(tok + " ") >= 0 or l.endswith(tok)]
    exits = [l for l in mine if l.startswith("EXIT_")]
    end = [l for l in mine if re.match(rf"(HOLD|STOPPED|QUEUE_DONE)_{re.escape(lane)} ", l)]
    done_jobs = {l.split("=", 1)[0][5:] for l in exits}
    job = "-"
    for l in mine:
        mm = re.match(r"NOTE_(\S+) run=\S+ slot=", l)
        if mm and mm.group(1) not in done_jobs:
            job = mm.group(1)
    scen = "-"
    if job != "-":
        for l in read(os.path.join(logs, f"{job}.log")):
            mm = re.match(r"\[backtest\] scenario (\d+)/(\d+) ", l)
            if mm:
                scen = f"{mm.group(1)}/{mm.group(2)}"
    if end:
        state = end[-1].split("_", 1)[0]
        state = {"QUEUE": "DONE"}.get(state, state)
        if state == "DONE" and chain:
            last = chain[-1]
            for k in ("IDLE", "CHAIN_HELD", "CHAIN_STOPPED", "CHAIN_STOP"):
                if last.startswith(k + "_"):
                    state = k
                    break
            else:
                state = "RUNNING"  # the chain moved on to its next queue
    else:
        state = "RUNNING" if alive(pid) else "DEAD"
    if state == "RUNNING":
        any_running = True
    if state in ("HOLD", "DEAD", "CHAIN_HELD"):
        any_hold = True
    print(f"LANE {lane} run={run} state={state} job={job} scen={scen} jobs={len(exits)}/{njobs}")
    for l in exits + end:
        print(l)
    if chain and chain[-1].split("_")[0] in ("IDLE", "CHAIN"):
        print(chain[-1])
print(f"HOST load1={load1} free_gib={free_gib}")
print(f"ALL_DONE={0 if any_running else 1} HOLD={1 if any_hold else 0}")
PY
