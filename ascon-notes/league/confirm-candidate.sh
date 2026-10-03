#!/usr/bin/env bash
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$HERE/confirm_candidate.py" "$@"
