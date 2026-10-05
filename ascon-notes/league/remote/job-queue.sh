#!/bin/bash
# Bash 3.2 entry point; Python standard library owns durable state and supervision.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
export PYTHONDONTWRITEBYTECODE=1
exec python3 -B "$HERE/queue.py" "$@"
