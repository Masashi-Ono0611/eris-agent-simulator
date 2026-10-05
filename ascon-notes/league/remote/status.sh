#!/bin/bash
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
exec /bin/bash "$HERE/job-queue.sh" status "${1:-$HOME/ascon-run/queue}"
