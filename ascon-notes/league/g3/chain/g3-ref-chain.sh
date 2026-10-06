#!/bin/bash
# macOS /bin/bash 3.2; Python supervises process groups (no GNU timeout).
set -eu
case "${1:---dry-run}" in
  --dry-run|--run) MODE=${1:---dry-run} ;;
  *) printf '%s\n' 'Usage: g3-ref-chain.sh [--dry-run|--run]' >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || exit 2
exec python3 -B /tmp/g3-chain/chain.py "${MODE}"
