#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DRY=0 ROSTER=
ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --label|--roster|--regimes|--seeds|--parallel|--base-port)
      [ "$#" -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }
      key=$1; val=$2; ARGS+=("$key" "$val")
      if [ "$key" = "--roster" ]; then ROSTER=$val; fi
      shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$ROSTER" ] || { echo "--roster is required" >&2; exit 2; }
case "$ROSTER" in /*) RPATH=$ROSTER ;; *) RPATH="$ROOT/$ROSTER" ;; esac
[ -f "$RPATH" ] || { echo "roster missing: $RPATH" >&2; exit 2; }
python3 - "$RPATH" "$ROOT" <<'PY' || exit 2
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding="utf-8")
dirs = re.findall(r'^\s+dir:\s*["\']?([^"\'\s]+)', text, re.M)
if not dirs: raise SystemExit("roster contains no dir entries")
for d in dirs:
    if not (Path(sys.argv[2]) / d).is_dir(): raise SystemExit(f"roster agent directory missing: {d}")
PY
if ! git -C "$ROOT" diff HEAD --quiet -- sdk/src/constants.local.ts; then
  echo "WARNING: sdk/src/constants.local.ts differs from git; backtest may rewrite it."
else echo "sdk/src/constants.local.ts matches git version."; fi
if [ "$DRY" -eq 1 ]; then
  printf 'DRY RUN: %q' "$ROOT/ascon-notes/eval/run-matrix.sh"
  printf ' %q' "${ARGS[@]}"
  printf '\n'
  exit 0
fi
cd "$ROOT" || exit 2
exec bash ascon-notes/eval/run-matrix.sh "${ARGS[@]}"
