#!/bin/sh
# Local measurement helper, not an adapter. Never log argv, prompt, env or credentials.
# exec preserves the PID: the stock runtime timeout kills the CLI, not a waiting wrapper.
set -eu
python3 -B - <<'PY'
import datetime
import json
import os
from pathlib import Path
import re
try:
    run = os.environ['ERIS_RUN_DIR']
    agent = os.environ['ERIS_AGENT_ID']
    if not run or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', agent):
        raise ValueError('invalid logging destination')
    directory = Path(run) / 'agents'
    directory.mkdir(parents=True, exist_ok=True)
    record = {'ts': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'kind': 'cli_call_started', 'agentId': agent, 'pid': os.getppid()}
    with (directory / (agent + '.cli-timing.jsonl')).open('a') as stream:
        stream.write(json.dumps(record) + '\n')
except Exception:
    raise SystemExit('xb-r-live: cannot record CLI start; refusing unmeasured call')
PY
exec claude "$@"
