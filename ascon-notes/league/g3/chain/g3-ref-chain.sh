#!/bin/bash
# macOS /bin/bash 3.2; Python supervises process groups (no GNU timeout).
set -eu
case "${1:---dry-run}" in
  --dry-run|--run) MODE=${1:---dry-run} ;;
  *) printf '%s\n' 'Usage: g3-ref-chain.sh [--dry-run|--run]' >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || exit 2
# G3_CHAIN_BASE is a REQUIRED explicit input (no default, no fallback to the old /tmp base).
# chain.py itself also requires G3_CHAIN_SOURCE and G3_CHAIN_SOURCE_COMMIT and re-validates all three.
BASE_DIR=${G3_CHAIN_BASE:-}
if [ -z "${BASE_DIR}" ]; then
  printf '%s\n' 'BLOCKED: G3_CHAIN_BASE missing or empty; explicit value required (no default)' >&2; exit 2
fi
case "${BASE_DIR}" in
  /*) ;;
  *) printf '%s\n' 'BLOCKED: G3_CHAIN_BASE must be an absolute path' >&2; exit 2 ;;
esac
case "${BASE_DIR}" in
  /tmp|/tmp/*|/private/tmp|/private/tmp/*|/var/tmp|/var/tmp/*|/private/var/tmp|/private/var/tmp/*)
    printf '%s\n' 'BLOCKED: G3_CHAIN_BASE must not be under /tmp or /var/tmp' >&2; exit 2 ;;
esac
if [ ! -d "${BASE_DIR}" ]; then
  printf '%s\n' 'BLOCKED: G3_CHAIN_BASE does not exist or is not a directory' >&2; exit 2
fi
exec python3 -B "${BASE_DIR}/chain.py" "${MODE}"
