#!/bin/sh
# Asterisk container entrypoint.
#
# Renders /etc/asterisk/pjsip.conf from the pjsip.conf.tmpl template,
# substituting __HOST_IP__ with the $HOST_IP env var (the Docker host's LAN
# IP that phones/speakers use to reach this server). This makes the config
# deployment-agnostic — the host IP can change between environments without
# editing any config file.
#
# Requires:
#   HOST_IP  the Docker host's LAN IP (e.g. 10.20.30.20)
#
# The generated pjsip.conf lives on the bind-mounted ./asterisk-config volume,
# so it is visible on the host for inspection. The template remains the source
# of truth.

set -eu

if [ -z "${HOST_IP:-}" ]; then
  echo "ERROR: HOST_IP environment variable is not set." >&2
  echo "Set HOST_IP to the Docker host's LAN IP (e.g. HOST_IP=10.20.30.20) in the .env file." >&2
  exit 1
fi

if [ -f /etc/asterisk/pjsip.conf.tmpl ]; then
  sed "s/__HOST_IP__/${HOST_IP}/g" /etc/asterisk/pjsip.conf.tmpl > /etc/asterisk/pjsip.conf
  echo "Rendered pjsip.conf (HOST_IP=${HOST_IP})"
else
  echo "WARNING: pjsip.conf.tmpl not found; using existing pjsip.conf as-is."
fi

exec /usr/sbin/asterisk -fvvv
