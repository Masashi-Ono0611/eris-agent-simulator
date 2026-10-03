#!/bin/bash
# macOS bash 3.2: Python preserves child return codes and emits optional JSON.
exec python3 -B "$(cd "$(dirname "$0")" && pwd)/verify-player.py" "$@"
