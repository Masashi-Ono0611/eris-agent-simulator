#!/usr/bin/env python3
"""Implementation of d1-run.sh. Local evidence only; never starts a lane."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


class Blocked(Exception):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Blocked(message)


def run(script, *args):
    # The judge's default table includes cell data: never forward tool stdout.
    return subprocess.run([sys.executable, '-B', str(script), *map(str, args)],
                          cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True)


def read(path):
    return json.loads(path.read_text())


def main():
    dry = '--allow-partial' in sys.argv[1:]
    lines = []
    out = None

    def say(line):
        line = ('DRY_RUN ' if dry else '') + line
        lines.append(line)
        print(line)

    def finish(marker, rc):
        # Dry artifacts are deliberately not reusable as authoritative inputs.
        try:
            if out is not None:
                if dry:
                    for path in out.rglob('*'):
                        if path.is_file() and path.suffix == '.json':
                            try:
                                value = read(path)
                            except ValueError:
                                value = {'malformed_output': path.read_text()}
                            if not isinstance(value, dict):
                                value = {'output': value}
                            value['DRY_RUN'] = True
                            path.write_text(json.dumps(value, indent=2) + '\n')
                        elif path.is_file() and path.suffix == '.txt':
                            path.write_text('# DRY_RUN\n' + path.read_text())
                final_line = ('DRY_RUN ' if dry else '') + marker
                (out / 'summary.txt').write_text('\n'.join(lines + [final_line]) + '\n')
        except OSError:
            marker, rc = 'D1_BLOCKED cannot finalize output artifacts', 2
        say(marker)
        return rc

    try:
        p = Parser(description=__doc__)
        p.add_argument('out_dir', type=Path)
        p.add_argument('--logs', type=Path, default=Path(os.environ.get('ASCON_EVAL_LOGS', str(Path.home() / 'ascon-final/logs'))))
        p.add_argument('--lanes', default='A,B,C,D')
        p.add_argument('--order-seed', type=int, default=231023)
        p.add_argument('--install-into', action='append', default=[], metavar='LANE=QUEUE_DIR',
                       help='repeat once per selected lane; pending directory must exist')
        p.add_argument('--allow-partial', action='store_true', help='dry run only; never install')
        a = p.parse_args()
        if dry and a.install_into:
            raise Blocked('--allow-partial cannot --install-into')
        lanes = a.lanes.split(',')
        if (not lanes or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', x) for x in lanes)
                or len({x.lower() for x in lanes}) != len(lanes)):
            raise Blocked('invalid or duplicate lanes')
        installs = {}
        for entry in a.install_into:
            lane, sep, directory = entry.partition('=')
            if not sep or not directory or lane not in lanes or lane in installs:
                raise Blocked('invalid or duplicate --install-into; expected selected LANE=QUEUE_DIR')
            installs[lane] = Path(directory).expanduser().resolve()
        if installs and set(installs) != set(lanes):
            raise Blocked('--install-into requires one directory for every selected lane')
        target = a.out_dir.resolve()
        if target.exists() and (not target.is_dir() or any(target.iterdir())):
            raise Blocked('out-dir must be new or empty')
        target.mkdir(parents=True, exist_ok=True)
        out = target
        manifest, mech, verdict = [out / x for x in ('M.json', 'MECH.json', 'VERDICT.json')]
        result = run(HERE / 'make-manifest.py', '--logs', a.logs.resolve(), '--stage', '1', '--out', manifest)
        if result.returncode not in (0, 2) or not manifest.is_file():
            raise Blocked('make-manifest failed')
        # Use the extractor's attested cells from one log snapshot. Retain its
        # full audit, but omit an entire informational arm until all 8 cells exist.
        m = read(manifest)
        audit_path = Path(str(manifest) + '.audit.json')
        audit = read(audit_path)
        from judge2 import exploratory_arm
        optional = {name for name in m['arm_map'] if exploratory_arm(name, m['arm_map'])}
        pending = set()
        for name in sorted(optional):
            count = sum(name in cell['arms'] for cell in m['cells'])
            if count != 8:
                pending.add(name)
                say(f'{name}: informational: pending ({count}/8 cells)')
        required_dirs = {directory for name, directory in m['arm_map'].items() if name not in optional}
        missing = [x['job'] for x in audit['missing']
                   if x['job'].split('-', 2)[2] in required_dirs]
        for key in ('arm_map', 'candidates'):
            m[key] = {name: value for name, value in m[key].items() if name not in pending}
        for cell in m['cells']:
            for key in ('arms', 'arm_evidence'):
                cell[key] = {name: value for name, value in cell[key].items() if name not in pending}
        manifest.write_text(json.dumps(m, indent=2) + '\n')
        if missing or audit.get('errors'):
            reason = 'stage 1 incomplete: ' + ', '.join(missing) if missing else 'make-manifest parse/read errors'
            if not dry:
                raise Blocked(reason)
            say(reason)
        result = run(HERE / 'mechanism.py', manifest, '--out', mech)
        # Exit 2 is expected for unmeasured p99; judge checks every other subclause.
        if result.returncode not in (0, 2) or not mech.is_file():
            raise Blocked('mechanism failed without usable evidence')
        read(mech)
        result = run(HERE / 'judge2.py', 'judge', '--manifest', manifest,
                     '--mechanism', mech, '--stage', '1', '--out', verdict)
        if result.returncode != 0 or not verdict.is_file():
            raise Blocked('judge2 failed')
        v = read(verdict)
        for name, cv in v['candidates'].items():
            st = cv.get('stats', {})
            informational = bool(cv.get('informational') or cv.get('exploratory'))
            say(f"{name}: verdict={cv['verdict']} rule={cv['rule']} m={st.get('m')} t={st.get('t')} informational={informational}")
            cl = cv.get('clauses', {}).get('5_mechanism', {})
            subs = cl.get('subclauses', {})
            say('  condition5=' + cl.get('status', 'BLOCKED') + ' ' + ' '.join(
                f"{k}={val['status']}" for k, val in subs.items()))
        sel = v['selection']
        say(f"selection: status={sel['status']} F={sel.get('F')} F2={sel.get('F2')}")
        if sel['status'] != 'DECIDED':
            raise Blocked('stage-1 selection pending')
        if not sel.get('F'):
            say('Plan Step 6 / N4 consequence: ship S-00048 (keep existing submission).')
            return finish('D1_NO_STAGE2', 0)
        head = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], capture_output=True, text=True)
        sha = head.stdout.strip()
        if head.returncode or not re.fullmatch('[0-9a-f]{40}', sha):
            raise Blocked('cannot resolve execution commit')
        queues = out / 's2'
        result = run(HERE / 'stage2-plan.py', '--verdict', verdict, '--lanes', a.lanes,
                     '--order-seed', a.order_seed, '--out', queues, '--commit', sha)
        if result.returncode:
            raise Blocked('stage2-plan refused verdict/queues')
        # Read the ETA CLI's actual default without duplicating its constant.
        import importlib.util
        spec = importlib.util.spec_from_file_location('lane_eta', HERE.parent / 'eval/lane-eta.py')
        eta = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(eta)
        hours = eta.DEFAULT_JOB_HOURS
        for lane in lanes:
            path = queues / f's2-{lane}.txt'
            jobs = len(eta.queue_jobs(path))
            say(f'lane {lane}: jobs={jobs} ETA_hours={jobs * hours:.2f} job_hours={hours} (default; conditional on uninterrupted execution)')
        if installs:
            def check_destination(lane, queue):
                dest = queue / 'pending'
                if not dest.is_dir() or dest.is_symlink():
                    raise Blocked(f'pending directory missing or unsafe: {dest}')
                name = f'55-s2-{lane}.txt'
                # A stem is a run identity, including after completion or HOLD.
                # rglob also finds directories and dangling symlinks of this name.
                if any(queue.rglob(name)):
                    raise Blocked(f'install name already exists in queue directory: {queue / name}')
                return dest / name

            # Preflight ALL lanes before writing ANY queue. Existing work is untouched.
            for lane, queue in installs.items():
                check_destination(lane, queue)
            for lane, queue in installs.items():
                dest = check_destination(lane, queue)
                # Exclusive creation also refuses a concurrent same-name pending file.
                with dest.open('xb') as f:
                    f.write((queues / f's2-{lane}.txt').read_bytes())
            say('Installed stage-2 queues into existing chains; no lane starts or switches executed.')
            for lane, queue in installs.items():
                order = sorted(p.name for p in (queue / 'pending').glob('*.txt') if p.is_file())
                say(f'lane {lane}: pending order: ' + ' -> '.join(order))
        say('Stage 2 FP/FD ready; FS, docker, shipping parity and release gates remain separate.')
        return finish('D1_PASS', 0)
    except (Blocked, OSError, ValueError, KeyError, TypeError) as exc:
        return finish('D1_BLOCKED ' + str(exc), 2)


if __name__ == '__main__':
    sys.exit(main())
