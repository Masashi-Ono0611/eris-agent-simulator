#!/bin/bash
# Run on Air. Remote side is rsync sender only; never delete or rewrite mini data.
set -eu
DEST=${1:?usage: pull-results.sh ABSOLUTE_LOCAL_DEST [--dry-run]}
case "$DEST" in /*) ;; *) echo 'destination must be absolute local path' >&2; exit 2 ;; esac
EXTRA=()
if [ "$#" -eq 2 ] && [ "$2" = '--dry-run' ]; then EXTRA+=(--dry-run)
elif [ "$#" -ne 1 ]; then echo 'unknown argument' >&2; exit 2; fi
mkdir -p "$DEST/queue" "$DEST/raw"
# MagicDNS macmini over Tailscale only; system ssh uses its Tailscale SSH server.
RSYNC_SSH='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
rsync -rt --partial --safe-links "${EXTRA[@]}" -e "$RSYNC_SSH" \
  --exclude '.env*' --exclude '*.key' \
  --exclude 'host.lock/' --exclude '*.tmp-*' \
  masa-ws1@macmini:/Users/masa-ws1/ascon-run/queue/ "$DEST/queue/"
# Dedicated execution checkout; pull only artifacts, never .env, keys or backtest state.
rsync -rt --partial --safe-links "${EXTRA[@]}" -e "$RSYNC_SSH" \
  --include '/runs/***' --include '/ascon-notes/' --include '/ascon-notes/eval/' \
  --include '/ascon-notes/eval/out/***' --include '/ascon-notes/league/' \
  --include '/ascon-notes/league/manifests/***' --exclude '*' \
  masa-ws1@macmini:/Users/masa-ws1/ascon-run/repo/ "$DEST/raw/"
echo 'Pulled snapshot only. Repeat after jobs finish; running files may be incomplete.'
