#!/usr/bin/env python3
"""Prepare an ASCON agent release copy and run its submission checks."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


DELTA = 'parseDeltaParams(process.env.ASCON_DELTA_PARAMS)'
EPSILON = 'parseEpsilonParams(process.env.ASCON_EPSILON_PARAMS)'
ENV_RE = re.compile(r'process\.env')
NUMBER_RE = re.compile(r'numberEnv\(\s*(["\'])ERIS_LAUNCH_[A-Z0-9_]+\1\s*,\s*((?:\d+(?:\.\d+)?|\.\d+)(?:n)?)\s*\)')
NUMBER_ANY_RE = re.compile(r'numberEnv\s*\(')
IMPORT_RE = re.compile(r'(?:from\s*|import\s*\(|require\s*\()(["\'])(\.{1,2}/[^"\']+)\1')


def json_literal(raw):
    value = json.loads(raw)
    return json.dumps(raw, ensure_ascii=True)


def rewrite_source(text, delta_raw=None, epsilon_raw=None):
    delta = json_literal(delta_raw) if delta_raw is not None else 'undefined'
    epsilon = json_literal(epsilon_raw) if epsilon_raw is not None else 'undefined'
    text = text.replace(DELTA, f'parseDeltaParams({delta})')
    text = text.replace(EPSILON, f'parseEpsilonParams({epsilon})')
    def sub(m):
        return m.group(2)
    text = NUMBER_RE.sub(sub, text)
    if NUMBER_ANY_RE.search(text):
        raise ValueError('numberEnv 呼び出しの形式が想定外です。手動確認が必要です')
    return text


def rewrite_prompt(text, name):
    if not text.startswith('---'):
        raise ValueError('prompt.md に frontmatter がありません')
    match = re.search(r'(?m)^name\s*:\s*.*$', text)
    if not match:
        raise ValueError('prompt.md frontmatter に name: がありません')
    return text[:match.start()] + f'name: {name}' + text[match.end():]


def inspect_tree(path):
    problems = []
    for file in path.rglob('*'):
        if not file.is_file():
            continue
        try:
            text = file.read_text()
        except UnicodeDecodeError:
            continue
        for m in ENV_RE.finditer(text):
            problems.append(f'process.env 残存: {file.relative_to(path)}:{text.count(chr(10), 0, m.start()) + 1}')
        for m in IMPORT_RE.finditer(text):
            target = m.group(2)
            if target.startswith('../') and not (target.startswith('../lib/') or target.startswith('../runtime/')):
                problems.append(f'他エージェントへの相対 import: {file.relative_to(path)}: {target}')
    return problems


def scan_passed(returncode, stdout):
    """True only for a zero exit AND a parsed summary line `--- N BLOCK, M WARN -> ACCEPT` with N == 0.

    The bare word BLOCK also appears in the summary of a clean scan ("0 BLOCK"), so it cannot be searched
    for. A missing or unparsable summary fails closed (BLOCKED is not PASS)."""
    if returncode != 0:
        return False
    found = re.findall(r'^---\s*(\d+)\s+BLOCK,\s*(\d+)\s+WARN\s*->\s*(\w+)\s*$', stdout, re.M)
    if not found:
        return False
    block, _warn, verdict = found[-1]
    return int(block) == 0 and verdict == 'ACCEPT'


def run(root, command):
    return subprocess.run(command, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', required=True)
    p.add_argument('--name', required=True)
    p.add_argument('--delta-params')
    p.add_argument('--epsilon-params')
    p.add_argument('--root', default=str(Path(__file__).resolve().parents[2]))
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--skip-checks', action='store_true')
    p.add_argument('--confirm-backtest', action='store_true', help='attest that public-60 backtest passed for this release')
    p.add_argument('--confirm-selftest', action='store_true', help='attest that agent:selftest passed for this release')
    p.add_argument('--upstream-ref', default='HEAD')
    a = p.parse_args()
    root = Path(a.root).resolve()
    src, dst = root/'example/agents'/a.source, root/'example/agents'/a.name
    failures = []
    if not src.is_dir(): failures.append(f'ソースがありません: {src}')
    if dst.exists(): failures.append(f'出力先が既に存在します: {dst}')
    for raw, label in ((a.delta_params, 'delta'), (a.epsilon_params, 'epsilon')):
        if raw is not None:
            try: json.loads(raw)
            except Exception as e: failures.append(f'{label} JSON 不正: {e}')
    if failures:
        print('\n'.join(failures)); print('NOT READY'); return 1
    tmp = shutil.copytree(src, dst) if not a.dry_run else None
    try:
        if tmp:
            for f in tmp.rglob('*'):
                if not f.is_file(): continue
                try: content = f.read_text()
                except UnicodeDecodeError: continue
                updated = rewrite_source(content, a.delta_params, a.epsilon_params)
                if f.name == 'prompt.md': updated = rewrite_prompt(updated, a.name)
                f.write_text(updated)
            failures.extend(inspect_tree(tmp))
    except Exception as e:
        failures.append(str(e))
    if a.dry_run:
        print('DRY RUN: 書き込みなし（変換構文と入力を確認）')
        status = run(root,['git','status','--short','sdk/src/constants.local.ts'])
        if status.stdout.strip():
            failures.append('住所表が汚れている（ZIP 未生成のためバイト比較は未実施）')
            print(f'WARNING: sdk/src/constants.local.ts が dirty: {status.stdout.strip()}')
        failures.append('dry-run のため検証未実施')
    if failures:
        for x in failures: print(f'FAIL: {x}')
        print('NOT READY'); return 1
    checks = []
    zip_path = root/f'bundle-{a.name}.zip'
    if not a.skip_checks:
        commands = [
            ('typecheck', ['npm','run','typecheck']),
            ('strategy check', ['node','--import','tsx','scripts/checkStrategyCode.ts']),
            ('bundle', ['node','--import','tsx','scripts/bundleAgent.ts',a.name]),
        ]
        for label, cmd in commands:
            res = run(root, cmd); checks.append((label, res.returncode == 0, res.stdout[-1200:]))
        if zip_path.exists():
            res = run(root, ['python3','infra/submission/scan-submission.py',str(zip_path)])
            passed = scan_passed(res.returncode, res.stdout)
            checks.append(('submission scan (0 BLOCK)', passed, res.stdout[-1200:]))
        else: checks.append(('submission scan', False, 'bundle ZIP がありません'))
        try:
            expected = run(root,['git','show',f'{a.upstream_ref}:sdk/src/constants.local.ts'])
            if expected.returncode: raise RuntimeError(expected.stdout)
            with zipfile.ZipFile(zip_path) as z:
                candidates = [n for n in z.namelist() if n.endswith('sdk/src/constants.local.ts') or n.endswith('src/constants.local.ts')]
                if not candidates: raise RuntimeError('ZIP 内に sdk/src/constants.local.ts がありません')
                actual = z.read(candidates[0])
            want = expected.stdout.encode()
            match = hashlib.sha256(actual).hexdigest() == hashlib.sha256(want).hexdigest()
            checks.append(('住所表 SHA-256', match, f'zip={hashlib.sha256(actual).hexdigest()} ref={hashlib.sha256(want).hexdigest()}'))
            status = run(root,['git','status','--short','sdk/src/constants.local.ts'])
            if status.stdout.strip(): print(f'WARNING: sdk/src/constants.local.ts が dirty: {status.stdout.strip()}')
            if not match: failures.append('住所表が汚れている')
        except Exception as e:
            checks.append(('住所表 SHA-256', False, str(e)))
        failures.extend(f'{label} failed/blocked' for label, ok, _ in checks if not ok)
    else:
        print('CHECKS: SKIPPED（検証未実施）'); failures.append('--skip-checks により検証未実施')
    print('\n検証結果')
    for label, ok, detail in checks: print(f'{label}: {"PASS" if ok else "FAIL/BLOCKED"}\n{detail}')
    if zip_path.exists():
        digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        commit = run(root,['git','rev-parse','HEAD']).stdout.strip()
        print(f'記録: ZIP SHA-256={digest} commit={commit}')
    if failures:
        for x in failures: print(f'FAIL: {x}')
        print('NOT READY'); return 1
    pending = []
    if not a.confirm_backtest: pending.append('public-60 backtest')
    if not a.confirm_selftest: pending.append('agent:selftest')
    if pending:
        print(f'静的検査のみ通過（未完: {" / ".join(pending)}）')
    else:
        print('RELEASE READY')
    return 0


if __name__ == '__main__': sys.exit(main())
