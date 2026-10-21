#!/usr/bin/env bash
# Issue or revoke a token for the dashboard's sponsor view (dashboard/server/sponsor.ts).
#
#   infra/dashboard/issue-sponsor-token.sh issue  <label>   print a new token ONCE, record its digest
#   infra/dashboard/issue-sponsor-token.sh revoke <label>   comment out every live line with that label
#   infra/dashboard/issue-sponsor-token.sh list             labels, issue times, revocations
#
# The tokens file is ERIS_DASHBOARD_SPONSOR_TOKENS_FILE (the same variable the server reads; set it
# in the environment or pass it as TOKENS_FILE=...). One line per token:
#
#   <sha256 hex of the token> <label> issued=<UTC time>
#
# The server re-reads the file on every request, so neither command needs a restart: an issued token
# works on the next request, a revoked one is refused on the next request. Revoking keeps the line
# (commented, with the revocation time) so the file stays the record of who could read what, when.
#
# The token itself is never written anywhere. It is printed to stdout once; hand it to the sponsor
# over a channel the two of you agreed on, and do not paste it into an issue, a chat log or a shell
# history file. Lost = revoke and issue another.
set -euo pipefail

FILE="${TOKENS_FILE:-${ERIS_DASHBOARD_SPONSOR_TOKENS_FILE:-}}"
usage() {
  echo "usage: $0 issue <label> | revoke <label> | list   (TOKENS_FILE or ERIS_DASHBOARD_SPONSOR_TOKENS_FILE names the file)" >&2
  exit 2
}
[ -n "$FILE" ] || usage
cmd="${1:-}"
label="${2:-}"

check_label() {
  # One whitespace-free word: the file is space-separated, and the label is what the access log
  # records against every request.
  [[ "$label" =~ ^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$ ]] || {
    echo "label must be 1-64 of [A-Za-z0-9._@-], starting with a letter or digit: '$label'" >&2
    exit 2
  }
}

# A live line for the label: digest, the label, then the issue time.
has_live() {
  [ -f "$FILE" ] && awk -v l="$label" '$1 ~ /^[0-9a-f]+$/ && length($1) == 64 && $2 == l { found = 1 } END { exit !found }' "$FILE"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1
  else shasum -a 256 | cut -d' ' -f1
  fi
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

case "$cmd" in
  issue)
    check_label
    if has_live; then
      echo "'$label' already has a live token in $FILE; revoke it first, or use another label" >&2
      exit 1
    fi
    umask 077
    mkdir -p "$(dirname "$FILE")"
    token="$(openssl rand -hex 32)"
    digest="$(printf '%s' "$token" | sha256)"
    printf '%s %s issued=%s\n' "$digest" "$label" "$(now)" >> "$FILE"
    chmod 600 "$FILE" 2>/dev/null || true
    echo "issued a sponsor token for '$label' (digest recorded in $FILE)." >&2
    echo "It is shown once and stored nowhere. Use it as:  Authorization: Bearer <token>" >&2
    echo "$token"
    ;;
  revoke)
    check_label
    if ! has_live; then
      echo "no live token labelled '$label' in $FILE" >&2
      exit 1
    fi
    tmp="$(mktemp "$(dirname "$FILE")/.sponsor-tokens.XXXXXX")"
    stamp="$(now)"
    # Written beside the file and renamed over it, so the server never reads half a file.
    awk -v l="$label" -v t="$stamp" '
      $1 ~ /^[0-9a-f]+$/ && length($1) == 64 && $2 == l { print "# revoked=" t " " $0; next }
      { print }
    ' "$FILE" > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$FILE"
    echo "revoked every token labelled '$label' ($stamp). Refused from the next request on." >&2
    ;;
  list)
    [ -f "$FILE" ] || { echo "no tokens file at $FILE" >&2; exit 1; }
    # Digests are not secrets, but there is no reason to print them: label and dates are the record.
    awk '
      /^# revoked=/ { print "revoked  " $4 "  " $5 "  " substr($2, 1); next }
      $1 ~ /^[0-9a-f]+$/ && length($1) == 64 { print "live     " $2 "  " $3; next }
    ' "$FILE"
    ;;
  *) usage ;;
esac
