#!/bin/bash
# Install a git pre-push hook that runs `ascon-notes/ci-local.sh --quick` on the commit being pushed.
# Hooks live in the SHARED git dir, so one install covers the main checkout and every worktree of this repo.
# It is local-only (not tracked, not pushed). Re-run to update. Remove with: --uninstall
# Skip once (loudly, logged): ASCON_SKIP_PREPUSH=1 git push ...      Run the full suite on demand: ascon-notes/ci-local.sh --full
set -u
GITDIR="$(git rev-parse --git-common-dir 2>/dev/null)" || { echo "not in a git repo" >&2; exit 2; }
GITDIR="$(cd "$GITDIR" && pwd)"
HOOK="$GITDIR/hooks/pre-push"
MARK="# ascon-ci-local pre-push (managed by ascon-notes/install-prepush.sh)"
if [ "${1:-}" = "--uninstall" ]; then
  if [ -f "$HOOK" ] && grep -q "$MARK" "$HOOK"; then
    python3 -c 'import os,sys; os.remove(sys.argv[1])' "$HOOK"; echo "removed $HOOK"
  else echo "no managed hook at $HOOK"; fi
  exit 0
fi
if [ -f "$HOOK" ] && ! grep -q "$MARK" "$HOOK"; then
  echo "refusing to overwrite an existing, unmanaged pre-push hook: $HOOK" >&2; exit 2
fi
HP="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ -n "$HP" ]; then echo "core.hooksPath is set ($HP): git would not run $HOOK. Unset it or install there." >&2; exit 2; fi
mkdir -p "$GITDIR/hooks" || { echo "cannot create hooks dir" >&2; exit 2; }
cat > "$HOOK" <<EOF
#!/bin/bash
$MARK
# stdin: <local ref> <local sha> <remote ref> <remote sha> per pushed ref. Branch pushes and raw-sha pushes are checked.
LOG="\${TMPDIR:-/tmp}/ascon-prepush.log"
if [ "\${ASCON_SKIP_PREPUSH:-}" = "1" ]; then
  echo "WARNING: ASCON_SKIP_PREPUSH=1 -> pre-push CI reproduction SKIPPED (CI may fail)." >&2
  echo "\$(date '+%F %T') SKIPPED \$PWD" >> "\$LOG"; exit 0
fi
CHECKED=""
while read -r LREF LSHA RREF RSHA; do
  case "\$LREF" in refs/tags/*|"(delete)") continue;; esac        # tags / deletions are not checked; a branch OR a raw sha (git push <sha>:<ref>) is
  [ "\$LSHA" = "0000000000000000000000000000000000000000" ] && continue
  case " \$CHECKED " in *" \$LSHA "*) continue;; esac
  CHECKED="\$CHECKED \$LSHA"
  SCRIPT="\$(git rev-parse --show-toplevel)/ascon-notes/ci-local.sh"
  [ -x "\$SCRIPT" ] || { echo "pre-push: BLOCKED. \$SCRIPT is missing or not executable, so CI cannot be reproduced (ASCON_SKIP_PREPUSH=1 to override, logged)." >&2; exit 1; }
  echo "pre-push: reproducing CI for \${LSHA:0:7} (clean export, env -i, small-disk df)..." >&2
  if ! "\$SCRIPT" --ref "\$LSHA" --quick; then
    echo "pre-push: BLOCKED. Fix the failure above (or ASCON_SKIP_PREPUSH=1 git push ... to override, logged to \$LOG)." >&2
    exit 1
  fi
done
exit 0
EOF
chmod +x "$HOOK" && [ -x "$HOOK" ] && grep -q "$MARK" "$HOOK" || { echo "install failed: $HOOK" >&2; exit 2; }
echo "installed: $HOOK"
