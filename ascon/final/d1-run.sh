#!/bin/bash
# Offline D1 orchestration; Python handles JSON without shell parsing.
set -u
here="$(cd "$(dirname "$0")" && pwd -P)" || { echo 'D1_BLOCKED script directory'; exit 2; }
command -v python3 >/dev/null || { echo 'D1_BLOCKED python3 missing'; exit 2; }
exec python3 -B "$here/d1-run.py" "$@"
