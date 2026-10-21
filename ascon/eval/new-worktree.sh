#!/bin/bash
# Make a second checkout that can run backtests next to the main one (e.g. while the main checkout
# is busy with a matrix whose agents must not change under it).
#   ascon/eval/new-worktree.sh <path> <git-ref>      run from the main checkout
# Links node_modules and out/ (forge artifacts) from the main checkout, copies its state dump and the
# generated sdk/src/constants.local.ts. Without these every scenario fails in seconds.
set -euo pipefail
dest="${1:?path}"; ref="${2:?git ref}"
main="$(pwd)"
[ -d "$main/node_modules" ] || { echo "BLOCKED: run from the main checkout (no node_modules here)"; exit 2; }
[ -f "$main/out/MockOracleProvider.sol/MockOracleProvider.json" ] || { echo "BLOCKED: no forge artifacts in $main/out"; exit 2; }
[ -f "$main/backtest/state/manifest.json" ] || { echo "BLOCKED: no state dump in $main/backtest/state"; exit 2; }
[ -e "$dest" ] && { echo "BLOCKED: $dest already exists"; exit 2; }
git fetch -q origin
git worktree add -q --detach "$dest" "$ref"
ln -s "$main/node_modules" "$dest/node_modules"
ln -s "$main/out" "$dest/out"
mkdir -p "$dest/backtest"
cp -R "$main/backtest/state" "$dest/backtest/state"
rm -f "$dest/backtest/state/.effective-"*.yaml
rmdir "$dest/backtest/state/.run-matrix.lock" 2>/dev/null || true
cp "$main/sdk/src/constants.local.ts" "$dest/sdk/src/constants.local.ts"
echo "ready: $dest at $(git -C "$dest" rev-parse --short HEAD)"
