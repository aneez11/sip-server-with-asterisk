#!/bin/sh
# API container entrypoint.
#
# Prepares TLS material, then starts the API.
#
# Why this exists: Live Talk streams the operator's microphone, and browsers only
# expose navigator.mediaDevices in a *secure context*. Over plain HTTP on a LAN IP
# `navigator.mediaDevices` is undefined and getUserMedia fails with
# "Cannot read properties of undefined (reading 'getUserMedia')".
#
# Trust model (air-gapped LAN, no public CA):
#   - a local root CA is generated once and kept in the `infinity-certs` volume
#   - the server leaf cert is signed by that CA, SAN = HOST_IP + localhost
#   - the CA is downloadable at /ca.pem; install it once per device and the
#     browser stops showing the self-signed warning entirely
# Leaf lifetime is 825 days: the maximum Apple platforms accept for a cert
# issued by a user-installed root.
set -eu

CERT_DIR="${TLS_DIR:-/app/certs}"
CA_CERT="$CERT_DIR/ca.pem"
CA_KEY="$CERT_DIR/ca.key"
CERT="$CERT_DIR/server.pem"
KEY="$CERT_DIR/server.key"

mkdir -p "$CERT_DIR"

SAN="DNS:localhost,IP:127.0.0.1"
if [ -n "${HOST_IP:-}" ]; then
  SAN="$SAN,IP:$HOST_IP"
fi
HOSTNAME_SAN="$(hostname 2>/dev/null || true)"
if [ -n "$HOSTNAME_SAN" ]; then
  SAN="$SAN,DNS:$HOSTNAME_SAN"
fi

# 1. Root CA (10 years) — created once, kept across rebuilds via the volume.
CA_CREATED=0
if [ ! -f "$CA_CERT" ] || [ ! -f "$CA_KEY" ]; then
  echo "Generating local root CA in $CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$CA_KEY" -out "$CA_CERT" \
    -subj "/CN=Infinity Echo Local CA/O=Infinity Echo" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
  chmod 600 "$CA_KEY"
  CA_CREATED=1
fi

# 2. Server leaf cert (825 days), signed by the CA above. Re-issued when missing,
#    or when a fresh CA was just created (upgrade from the earlier self-signed
#    cert, which nothing could trust).
if [ "$CA_CREATED" = "1" ] || [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "Issuing server certificate for $SAN"
  CSR="$CERT_DIR/server.csr"
  EXT="$CERT_DIR/server.ext"
  openssl req -new -newkey rsa:2048 -nodes \
    -keyout "$KEY" -out "$CSR" \
    -subj "/CN=${HOST_IP:-infinity-echo}" >/dev/null 2>&1
  {
    echo "basicConstraints=CA:FALSE"
    echo "keyUsage=critical,digitalSignature,keyEncipherment"
    echo "extendedKeyUsage=serverAuth"
    echo "subjectAltName=$SAN"
  } > "$EXT"
  openssl x509 -req -in "$CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" \
    -CAcreateserial -out "$CERT" -days 825 -sha256 -extfile "$EXT" >/dev/null 2>&1
  rm -f "$CSR" "$EXT"
  chmod 600 "$KEY"
fi

echo "TLS ready: $(openssl x509 -in "$CERT" -noout -subject) (CA: /ca.pem)"

exec node dist/index.js
