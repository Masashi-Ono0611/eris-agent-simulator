#!/usr/bin/env python3
"""Read-only queue progress and approximate ETA. Timing/error model: eval/README.md."""
import argparse
from datetime import datetime, timedelta
import math
from pathlib import Path
import re
import sys

NAME = r'[A-Za-z0-9][A-Za-z0-9_.-]*'
DEFAULT_JOB_HOURS = 2.5
STAMP = re.compile(r'(?<![\w/])\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?')


def timestamp(line):
    m = STAMP.search(line)
    return datetime.fromisoformat(m[0].replace('Z', '+00:00')).timestamp() if m else None


def fields(line):
    return dict(re.findall(r'(\w+)=([^\s]+)', line))


def parse(path):
    runs = {}
    for line in path.read_text().splitlines():
        kv = fields(line)
        rid = kv.get('run')
        if not rid:
            continue
        if line.startswith('QUEUE_START_'):
            runs[rid] = {'jobs': {}, 'start': timestamp(line), 'count': int(kv['jobs']),
                         'queue': kv.get('queue', ''), 'status': 'unconfirmed-active'}
        if rid not in runs:
            continue
        run = runs[rid]
        for prefix, status in [('QUEUE_DONE_', 'done'), ('STOPPED_', 'stopped'), ('HOLD_', 'held')]:
            if line.startswith(prefix):
                run['status'] = status
        m = re.match(r'(NOTE|EXIT)_(' + NAME + r')(?:=([^\s]+))?\s', line)
        if not m:
            continue
        kind, job, rc = m.groups()
        rec = run['jobs'].setdefault(job, {'start': None, 'end': None, 'exit': None, 'launched': False})
        if kind == 'NOTE' and 'slot' in kv:
            rec['launched'] = True
            rec['start'] = timestamp(line)
        if kind == 'EXIT':
            rec['exit'] = dict(kv, rc=rc)
            rec['end'] = timestamp(line)
    return runs


def passed(rec):
    x = rec['exit'] or {}
    return x.get('rc') == '0' and all(x.get(k) == 'PASS' for k in ('VERDICT', 'COLLISION', 'ARM'))


def superseded(runs):
    """Failed-only runs retried with an overlapping job supersede the entire failed run.

    This covers renamed 20/22/23 queues after stale locks. Mixed successful runs
    retain unrelated jobs; individual repeated jobs always use their latest attempt.
    """
    ids = list(runs)
    return {rid for i, rid in enumerate(ids) if not any(passed(r) for r in runs[rid]['jobs'].values())
            and any(set(runs[rid]['jobs']) & set(runs[new]['jobs']) for new in ids[i + 1:])}


def queue_jobs(path):
    jobs = []
    for line in path.read_text().splitlines():
        parts = line.split('#', 1)[0].split()
        if not parts:
            continue
        if len(parts) != 4 or not re.fullmatch(NAME, parts[0]):
            raise ValueError(f'invalid queue line in {path.name}')
        jobs.append(parts[0])
    return jobs


def run_family(rid, run):
    """lane-chain IDs are <lane>-[<tag>-]<queue stem>; unknown IDs stay exact."""
    suffix = '-' + Path(run['queue']).stem
    return rid[:-len(suffix)] if run['queue'] and rid.endswith(suffix) else rid


def report(lane, logs, chain_dir, default, now, next_dirs=()):
    qpath = logs / (lane + '.queue.log')
    runs = parse(qpath) if qpath.exists() else {}
    cpath = logs / (lane + '.chain.log')
    chain = cpath.read_text().splitlines() if cpath.exists() else []
    # Chain start is only a first-queue anchor, never a timestamp for every queue.
    anchor = None
    file_runs = {}
    chain_status = None
    for line in chain:
        kv = fields(line)
        if line.startswith('CHAIN_START_'):
            anchor = timestamp(line)
            chain_status = None
        elif line.startswith('CHAIN_QUEUE_') and not line.startswith('CHAIN_QUEUE_END_'):
            rid = kv.get('run')
            file_runs[kv.get('file')] = rid
            if rid in runs and runs[rid]['start'] is None:
                runs[rid]['start'] = anchor
            anchor = None
            chain_status = None
        elif line.startswith(('CHAIN_STOP_', 'CHAIN_STOPPED_', 'CHAIN_HELD_', 'IDLE_')):
            chain_status = line.split()[0].split('_')[0:2]
    ignored = superseded(runs)
    latest = {}
    for rid, run in runs.items():
        if rid not in ignored:
            for job, rec in run['jobs'].items():
                latest[job] = (rid, rec)
    finished = {j: (r, x) for j, (r, x) in latest.items() if x['exit'] is not None}
    current_id = next(reversed(runs), None)
    family = run_family(current_id, runs[current_id]) if current_id else None
    samples = []
    sample_jobs = []
    for rid, run in runs.items():
        if rid in ignored or run_family(rid, run) != family:
            continue
        previous = run['start']
        for job, rec in run['jobs'].items():
            end = rec['end']
            # Per-job files are overwritten on retries: only the latest attempt owns mtime.
            if (latest.get(job) == (rid, rec) and rec['exit'] and rec['launched']
                    and passed(rec) and job.startswith('s1-')):
                p = logs / (job + '.log')
                if end is None and p.is_file():
                    end = p.stat().st_mtime
                start = rec['start'] if rec['start'] is not None else previous
                if start is not None and end is not None and start < end <= now:
                    samples.append((end - start) / 3600)
                    sample_jobs.append(f'{rid}/{job}')
            # Missing endpoint breaks adjacency; do not bridge an unmeasured job.
            previous = end
    mean = sum(samples) / len(samples) if len(samples) >= 2 else default
    mode = 'measured-proxy' if len(samples) >= 2 else 'default'
    current = runs.get(current_id)
    status = current['status'] if current else 'unknown'
    if chain_status:
        status = '-'.join(chain_status).lower()
    remaining = None
    pending = None
    if chain_dir is not None:
        pending = sum(len(queue_jobs(p)) for p in sorted((chain_dir / 'pending').glob('*.txt')))
        remaining = 0
        for p in sorted((chain_dir / 'running').glob('*.txt')):
            jobs = queue_jobs(p)
            rid = file_runs.get(p.name)
            if rid is None:
                matches = [r for r, run in runs.items() if Path(run['queue']).name == p.name]
                rid = matches[-1] if matches else None
            done = runs.get(rid, {}).get('jobs', {})
            remaining += sum(not done.get(j, {}).get('exit') for j in jobs)
    elif current:
        remaining = max(0, current['count'] - sum(x['exit'] is not None for x in current['jobs'].values()))
    next_pending = sum(len(queue_jobs(p)) for directory in next_dirs
                       for p in sorted((directory / 'pending').glob('*.txt')))
    if pending is not None:
        pending += next_pending
    total = (next_pending if pending is None else 0) + (remaining or 0) + (pending or 0)
    eta = datetime.fromtimestamp(now + mean * total * 3600).astimezone().isoformat(timespec='seconds')
    if remaining is None:
        eta = 'unknown'
    suffix = 'conditional-on-resume' if status in ('stopped', 'held', 'chain-stopped', 'chain-stop', 'chain-held') else 'projection-from-now'
    good = sum(passed(x) for _, x in finished.values())
    print(f'{lane}: done_PASS={good} done_not_PASS={len(finished)-good} mean_hours={mean:.2f} '
          f'({mode}; samples={len(samples)}) running_remaining={remaining if remaining is not None else "unknown"} '
          f'pending={pending if pending is not None else "unknown"} ETA={eta} '
          f'({suffix}; known-work-only) status={status} superseded_runs={len(ignored)}')
    print(f'  timing_family={family or "unknown"} stage=s1 sample_jobs={",".join(sample_jobs) or "none"}'
          f' mean_jobs={",".join(sample_jobs) if len(samples) >= 2 else "none (default)"}')
    if next_dirs:
        print(f'  next_pending={next_pending} next_queues=' + ','.join(map(str, next_dirs)))
    notes = []
    if not cpath.exists():
        notes.append('no chain log')
    if chain_dir is None:
        notes.append('no chain inventory; pending unknown; running count from latest QUEUE_START')
    if len(samples) < 2:
        notes.append('fewer than 2 timed finished jobs (PASS, latest family, s1); no reliable mean (missing timestamps/per-job mtimes)')
    if notes:
        print('  unavailable: ' + '; '.join(notes))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--logs', type=Path, required=True)
    ap.add_argument('--chains', type=Path)
    ap.add_argument('--next', action='append', default=[], metavar='LANE=QUEUE_DIR',
                    help='count pending jobs after this lane; repeatable; duplicate paths count once')
    ap.add_argument('--job-hours-default', type=float, default=DEFAULT_JOB_HOURS)
    a = ap.parse_args()
    try:
        if not a.logs.is_dir() or (a.chains and not a.chains.is_dir()):
            raise ValueError('logs/chains directory missing')
        if not math.isfinite(a.job_hours_default) or a.job_hours_default <= 0:
            raise ValueError('job-hours-default must be positive and finite')
        lanes = {p.name.rsplit('.', 2)[0] for pattern in ('*.queue.log', '*.chain.log') for p in a.logs.glob(pattern)}
        dirs = {}
        next_dirs = {}
        for value in a.next:
            lane, sep, directory = value.partition('=')
            if not sep or not re.fullmatch(NAME, lane) or not directory:
                raise ValueError('--next requires LANE=QUEUE_DIR')
            p = Path(directory).expanduser().resolve()
            if not p.is_dir() or not (p / 'pending').is_dir():
                raise ValueError(f'next queue missing pending directory: {p}')
            next_dirs.setdefault(lane, set()).add(p)
            lanes.add(lane)
        if a.chains:
            for p in sorted(a.chains.iterdir()):
                if p.is_dir() and (p / 'pending').is_dir():
                    if re.fullmatch(r'chain-.+2', p.name):
                        lane = p.name[len('chain-'):-1]
                        next_dirs.setdefault(lane, set()).add(p.resolve())
                        lanes.add(lane)
                        print(f'{lane}: auto-detected next queue {p}')
                        continue
                    if not (p / 'running').is_dir():
                        continue
                    lane = p.name.removeprefix('chain-')
                    dirs[lane] = p
                    lanes.add(lane)
        if not lanes:
            raise ValueError('no lane logs or chain directories')
        now = datetime.now().timestamp()
        print('ETA: snapshot projection; no liveness check; naive ISO times use local timezone; in-flight job charged a full mean.')
        for lane in sorted(lanes):
            current_dir = dirs.get(lane)
            following = sorted(p for p in next_dirs.get(lane, ())
                               if current_dir is None or p != current_dir.resolve())
            report(lane, a.logs, current_dir, a.job_hours_default, now, following)
        return 0
    except (OSError, ValueError, KeyError) as e:
        print('BLOCKED ' + str(e))
        return 2


if __name__ == '__main__':
    sys.exit(main())
