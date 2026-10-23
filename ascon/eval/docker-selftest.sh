#!/bin/bash
set -euo pipefail
export PATH="$HOME/.local/ascon-docker-shim:$HOME/.homebrew/bin:$HOME/.foundry/bin:$PATH"
exec python3 "$(dirname "$0")/release-tools.py" selftest "$@"
