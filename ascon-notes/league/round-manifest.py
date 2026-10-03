#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import subprocess
from round_manifest import begin, verify


def main():
    p=argparse.ArgumentParser(description='Record pre-run inputs without overwriting; verify unchanged at completion.')
    sub=p.add_subparsers(dest='command',required=True)
    b=sub.add_parser('begin'); b.add_argument('label'); b.add_argument('--roster',type=Path,required=True)
    b.add_argument('--regimes',nargs='+',required=True); b.add_argument('--seeds',nargs='+',required=True)
    b.add_argument('--parallel',type=int,required=True); b.add_argument('--agent-root',type=Path)
    b.add_argument('--zip',type=Path,help='optional release ZIP to bind before evaluation')
    v=sub.add_parser('verify'); v.add_argument('label')
    a=p.parse_args()
    try:
        if a.command=='begin':
            result=begin(a.label,a.roster,a.regimes,a.seeds,a.parallel,a.agent_root,a.zip)
            print(json.dumps(result,ensure_ascii=False,indent=2)); return 0
        result=verify(a.label); print(json.dumps(result,ensure_ascii=False,indent=2)); return 0 if result['status']=='PASS' else 1
    except (OSError,ValueError,KeyError,TypeError,subprocess.CalledProcessError) as e:
        print('FAIL: '+str(e)); return 1


if __name__=='__main__': raise SystemExit(main())
