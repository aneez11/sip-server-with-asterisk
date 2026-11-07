#!/bin/sh
# go2rtc entrypoint: render the config with the deployment's HOST_IP, then run.
#
# The ICE candidate must be the LAN address clients use, exactly like the
# Asterisk pjsip template — hence the same HOST_IP variable.
set -eu

TMPL=/opt/go2rtc/go2rtc.yaml.tmpl
OUT=/tmp/go2rtc.yaml

if [ -z "${HOST_IP:-}" ]; then
  echo "ERROR: HOST_IP is not set — cannot advertise a WebRTC candidate" >&2
  exit 1
fi

sed "s/__HOST_IP__/${HOST_IP}/g" "$TMPL" > "$OUT"
echo "go2rtc config ready (HOST_IP=${HOST_IP})"

# The official image ships the binary at /go2rtc (some builds put it on PATH).
if [ -x /go2rtc ]; then
  exec /go2rtc -config "$OUT"
fi
exec go2rtc -config "$OUT"
