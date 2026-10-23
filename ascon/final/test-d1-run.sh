#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1
src="${1:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
tmp="$(mktemp -d)" || exit 2
# Keep fixtures/logs for diagnosis; no recursive deletion.
python3 -B "$src/ascon/final/test-d1-run.py" "$src" "$tmp" || { echo "FAIL fixtures=$tmp"; exit 1; }
echo ALL_CONTROLS_OK
