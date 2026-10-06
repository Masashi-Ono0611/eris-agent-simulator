#!/usr/bin/env python3
"""Fixture-only ERIS_CLAUDE_BIN hook. Ignores argv; never reads credentials/network.
Long delays are defaults. G3_UNIT_TIME_SCALE is ONLY for explicitly shortened unit tests.
Audited replay inputs are required for delayed/change-revert; no synthetic success substitute.
"""
import json
import os
from pathlib import Path
import sys
import time

HERE=Path(__file__).resolve().parent

def main():
    case=os.environ.get('G3_FAULT_CASE','')
    if case not in {'malicious','invalid','empty','quota','delayed','timeout','change-revert','null','empty-executor','wrong-type','import-body','unknown-revert'}:
        raise ValueError('unknown fixture case')
    scale=float(os.environ.get('G3_UNIT_TIME_SCALE','1'))
    if not 0 < scale <= 1:raise ValueError('invalid unit time scale')
    if case=='quota':
        print('synthetic quota exhausted 429',file=sys.stderr);return 1
    if case=='empty':return 0
    if case=='timeout':
        time.sleep(301*scale);print('{"notes":"late", "executorTs":null}');return 0
    if case in {'delayed','change-revert'}:
        reply=Path(os.environ['G3_FAULT_REPLY'])
        # Do not read arbitrary/sensitive files even if misconfigured.
        if not reply.resolve().is_relative_to(HERE/'fixtures') or reply.suffix!='.json' or reply.is_symlink():
            raise ValueError('reply must be a local registered JSON fixture')
        body=reply.read_text()
        if case=='delayed':time.sleep(150*scale)
        else:
            counter=Path(os.environ['G3_FAULT_COUNTER'])
            if counter.is_symlink() or not counter.parent.is_dir():raise ValueError('invalid counter directory')
            n=int(counter.read_text()) if counter.exists() else 0
            counter.write_text(str(n+1))
            if n==1:body=json.dumps({'notes':'controlled restore','revertTo':0})
            elif n>1:body=json.dumps({'notes':'controlled hold','executorTs':None})
    else:
        name='malicious-return' if case=='malicious' else case
        body=(HERE/'fixtures'/f'{name}.json').read_text()
    sys.stdout.write(body)
    return 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError):
        print('G3 fixture configuration unavailable/invalid; no fallback',file=sys.stderr)
        raise SystemExit(2)
