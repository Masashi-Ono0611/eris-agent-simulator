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
(cd "$ROOT" && node -e '
const fs = require("fs"), path = require("path"), yaml = require("yaml");
const roster = yaml.parse(fs.readFileSync(process.argv[1], "utf8"));
const agents = roster && roster.agents;
if (!Array.isArray(agents) || agents.length === 0) { console.error("roster has no agents"); process.exit(2); }
const seen = new Set();
for (const a of agents) {
  if (seen.has(String(a.id))) { console.error("duplicate agent id: " + a.id); process.exit(2); }
  seen.add(String(a.id));
  if (a.command) continue;
  const d = String(a.dir || a.id);
  if (!fs.existsSync(path.join("example/agents", d, "agent.ts")) && !fs.existsSync(path.join("example/agents", d, "strategy.py"))) {
    console.error("roster agent directory missing: example/agents/" + d + " (id " + a.id + ")"); process.exit(2);
  }
}
console.log("roster ok: " + agents.length + " agents");
' "$RPATH") || exit 2
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
