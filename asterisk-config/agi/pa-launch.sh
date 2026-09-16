#!/bin/bash
# PA group launcher — AGI hook called by the static dialplan when an initiator
# device dials a group extension (e.g. 9100).
#
# Usage: AGI(/etc/asterisk/agi/pa-launch.sh,<EXTEN>)
#
# Reads the dialed extension and the calling channel's caller-id (the initiator
# device), calls the API's PA-trigger endpoint (shared-secret auth), which
# resolves the group, originates the receiver member legs + the pa_start/pa_end
# announcer, and returns the conference name. The AGI sets the PA_CONF channel
# variable so the dialplan can join the initiator as the marked speaker.

set -euo pipefail

# The API container is reachable on the bridge network as "api". Override with
# PA_API_BASE if deployed elsewhere.
API_BASE="${PA_API_BASE:-http://api:3001}"
API_SECRET="${PA_API_SECRET:-}"
PA_AGI_LOG=/var/log/asterisk/pa-agi.log

log() { echo "$(date '+%F %T') $*" >> "$PA_AGI_LOG"; }
say() { printf '%s\n' "$*"; }

# Read the AGI request header from stdin: `key: value` lines until a blank line.
IFS= read -r first
while IFS= read -r line; do
  [ -z "$line" ] && break
  key="${line%%:*}"; value="${line#*: }"
  case "$key" in
    agi_callerid) AGI_CALLERID="$value" ;;
    agi_extension) AGI_EXTENSION="$value" ;;
    agi_channel) AGI_CHANNEL="$value" ;;
  esac
done

# AGI vars: agi_extension, agi_callerid, agi_channel ...
EXT="${1:-${AGI_EXTENSION:-}}"
# Extract the numeric extension from a caller-id like `"Office Phone" <2000>`.
CALLER=$(printf '%s' "${AGI_CALLERID:-}" | sed -n 's/.*<\([0-9]*\)>.*/\1/p')
if [ -z "$CALLER" ]; then
  CALLER=$(printf '%s' "${AGI_CALLERID:-}" | tr -cd '0-9')
fi

if [ -z "$EXT" ]; then
  say "SET VARIABLE PA_CONF \"\""
  say "EXIT 1"
  exit 1
fi

# URL-encode extension + caller using od/awk (no jq dependency for the request).
enc() { printf '%s' "$1" | od -An -tx1 | tr ' ' '\n' | grep . | sed 's/^\(..\)/%\1/' | tr -d '\n'; }

URL="${API_BASE}/api/pa-trigger/$(enc "$EXT")"
if [ -n "$CALLER" ]; then URL="${URL}?caller=$(enc "$CALLER")"; fi

RESP=$(curl -sS -m 8 -H "Authorization: Bearer ${API_SECRET}" "$URL" 2>>"$PA_AGI_LOG") || {
  log "trigger curl failed"
  say "SET VARIABLE PA_CONF \"\""
  say "EXIT 1"
  exit 1
}
log "trigger response: $RESP"

# Extract pageConf. Key = "pageConf":"<uuid>". Uses only sed/awk (no jq in the
# Asterisk image). If absent, the response was an error.
pageConf=$(printf '%s' "$RESP" | sed -n 's/.*"pageConf":"\([^"]*\)".*/\1/p')

if [ -z "$pageConf" ]; then
  log "no pageConf in response: $RESP"
  say "SET VARIABLE PA_CONF \"\""
  say "EXIT 1"
  exit 1
fi

say "SET VARIABLE PA_CONF ${pageConf}"
say "SET VARIABLE PA_OK 1"
say "EXIT 0"
exit 0
