#!/usr/bin/env python3
"""Adapter for existing league tools; raw results are append-only, one label per attempt."""
import csv
import json
from pathlib import Path
import re
import subprocess
import sys

from queue import read, require, save, worlds


def observations(repo, job, label):
    out = repo / 'ascon-notes/eval/out' / label
    records = {}
    index = out / 'index.tsv'
    if index.exists():
        with index.open() as f:
            for row in csv.DictReader(f, delimiter='\t'):
                key = row['regime'] + '/' + row['seed']
                records[key] = (row['run_dir'], row['exit_code'])
    for rowfile in out.glob('.matrix-tmp-*/*.row'):
        fields = rowfile.read_text().strip('\n').split('\t')
        if len(fields) == 4:
            records[fields[0] + '/' + fields[1]] = (fields[2], fields[3])
    # Covers the crash window before run_one publishes its row, including a
    # finished world with a lost queue receipt. Never infer absence from index alone.
    for key in worlds(job):
        r, s = key.split('/')
        log = out / (r + '-' + s + '.log')
        if not log.exists():
            continue
        text = log.read_text(errors='replace')
        ids = re.findall(r'"runId"\s*:\s*"([^"\n]+)"', text)
        dirs = re.findall(r'realtime simulation completed: (runs/[^\s(]+)', text)
        for line in text.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict) and event.get('type') == 'run_completed' and event.get('runDir'):
                dirs.append(event['runDir'])
        paths = dirs + ['runs/' + rid for rid in ids]
        for rel in paths:
            path = Path(rel)
            path = path if path.is_absolute() else repo / path
            require(path.resolve().is_relative_to((repo / 'runs').resolve()), 'run path outside dedicated runs directory')
            if (path / 'summary.json').exists() or rel in dirs:
                records[key] = (str(path), records.get(key, ('', '0'))[1])
    return records


def observe(repo, job, label):
    finished, errors = [], []
    for key, (directory, rc) in observations(repo, job, label).items():
        require(key in worlds(job), 'unexpected world in attempt')
        if not directory:
            if rc != '0':
                errors.append(key + ': no result / failed exit')
            continue
        path = Path(directory)
        path = path if path.is_absolute() else repo / path
        require(path.resolve().is_relative_to((repo / 'runs').resolve()), 'run path outside dedicated runs directory')
        # Any terminal evidence is irrevocable, irrespective of scientific validity.
        finished.append(key)
        if rc != '0':
            errors.append(key + ': world exit nonzero')
        try:
            summary = read(path / 'summary.json')
        except (ValueError, OSError):
            continue  # in-flight write; final adapter audit fails closed
        errors.extend(safety(summary, job)[2])
    return sorted(set(finished)), errors


def safety(summary, job):
    errors = []
    violations = summary.get('violations')
    if not isinstance(violations, list) or violations:
        errors.append('violations nonzero/missing')
    agents = {a['id']: a for a in summary.get('agents', [])}
    reverted = 0
    for aid in job['SAFETY_AGENTS'].split():
        a = agents.get(aid, {})
        n, inc = a.get('revertCount'), a.get('includedTxCount')
        if type(n) is not int or type(inc) is not int or min(n, inc) < 0 or n > inc:
            errors.append('revert/inclusion missing: ' + aid)
            continue
        reverted += n
        if job['STOP_REVERT'] == '1' and n > 0:
            errors.append('diagnostic revert > 0: ' + aid)
        if job['KIND'] == 'qualification' and (n > 1 or n * 1000 > inc):
            errors.append('qualification per-world revert cap: ' + aid)
    return len(violations) if isinstance(violations, list) else -1, reverted, errors


def main():
    repo, attempt, label = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    job = read(attempt / 'job.json')
    roster = repo / job['ROSTER']
    if job['KIND'] == 'smoke':
        roster = attempt / 'smoke-roster.yaml'
        lines = ['agents:']
        for i in range(12):
            ref = ['multi-arb', 'clean-arb', 'noop', 'venue-arb'][i % 4]
            lines += ['  - id: probe-' + str(i + 1), '    wallet: AUTO', '    dir: ' + ref]
        roster.write_text('\n'.join(lines) + '\n')
    league = repo / 'ascon-notes/league'

    def call(args, filename):
        with (attempt / filename).open('x') as f:
            return subprocess.run(args, cwd=repo, stdout=f, stderr=subprocess.STDOUT).returncode

    rc = call([sys.executable, '-B', str(league / 'round-manifest.py'), 'begin', label,
               '--roster', str(roster), '--regimes', job['REGIMES'], '--seeds', job['SEEDS'],
               '--parallel', job['PARALLEL']], 'begin.json')
    require(rc == 0, 'begin manifest failed')
    if job['KIND'] == 'smoke':
        cmd = ['/bin/bash', str(league / 'load-probe.sh'), '--agents', '12', '--parallel', job['PARALLEL'], '--label', label]
    else:
        cmd = ['/bin/bash', str(league / 'run-league.sh'), '--label', label, '--roster', str(roster),
               '--regimes', job['REGIMES'], '--seeds', job['SEEDS'], '--parallel', job['PARALLEL'], '--base-port', '8547']
    rc = call(cmd, 'matrix.log')
    require(rc == 0, 'matrix failed')
    verify_rc = call([sys.executable, '-B', str(league / 'round-manifest.py'), 'verify', label], 'verify.json')
    require(verify_rc == 0 and read(attempt / 'verify.json')['status'] == 'PASS', 'manifest verify failed')
    g0_rc = call([sys.executable, '-B', str(league / 'g0.py'), label, '--roster', str(roster),
                  '--regimes', *job['REGIMES'].split(), '--seeds', *job['SEEDS'].split(),
                  '--manifest', label, '--json'], 'g0.json')
    g0 = read(attempt / 'g0.json')
    finished, errors = observe(repo, job, label)
    violations = reverts = 0
    for directory, _ in observations(repo, job, label).values():
        path = Path(directory)
        path = path if path.is_absolute() else repo / path
        v, r, es = safety(read(path / 'summary.json'), job)
        violations += v; reverts += r; errors += es
    save(attempt / 'result.json', dict(finished_worlds=finished, g0=g0['status'],
         violations=violations, reverts=reverts, safety='FAIL' if errors else 'PASS', errors=errors,
         qualification_accepted=False))
    require(g0_rc == 0 and g0['status'] == 'PASS' and not errors, 'G0/safety failed')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(2)
