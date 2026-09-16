# Phase 0 — Asterisk core image (Institute SIP Broadcast Paging System)
#
# Base image choice: ubuntu:24.04 (noble LTS) + distro-packaged Asterisk 20 LTS
# (1:20.6.0). Ubuntu was chosen over debian:bookworm-slim after the Debian
# package was dropped from the stable/oldstable archives (verified: `apt-get
# install asterisk` fails on bookworm-slim and trixie-slim in Aug 2026; the
# package only remains in Debian testing/unstable). Ubuntu noble is an LTS
# (supported to 2029) and ships Asterisk 20.6.0 LTS via `apt`, so we keep the
# "distro-maintained, transparent, apt-updateable" justification. PJSIP modules
# (chan_pjsip.so, res_pjsip.so) ship in the `asterisk-modules` package; the
# "beep" prompt needed by Page() ships in `asterisk-core-sounds-en-gsm`.
#
# The bind-mounted ./asterisk-config:/etc/asterisk (see docker-compose.yml) is
# authoritative at runtime; the COPY below only gives a sane default when the
# image is run standalone without the mount.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        asterisk \
        asterisk-modules \
        asterisk-config \
        asterisk-core-sounds-en-gsm \
        curl \
        ca-certificates \
        openssl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY asterisk-config/ /etc/asterisk/
COPY docker/asterisk/entrypoint.sh /usr/local/bin/asterisk-entrypoint.sh
RUN chmod +x /usr/local/bin/asterisk-entrypoint.sh

# Generate a self-signed DTLS cert if one doesn't exist (used by WebRTC
# DTLS-SRTP for the live talk mic). The /etc/asterisk/certs dir is on the
# bind-mounted volume so the cert persists across container restarts.
RUN mkdir -p /etc/asterisk/certs \
    && openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout /etc/asterisk/certs/asterisk.key \
        -out /etc/asterisk/certs/asterisk.pem \
        -days 3650 \
        -subj "/CN=asterisk" \
    && chmod 640 /etc/asterisk/certs/asterisk.key

# LAN-only: SIP signalling + RTP + AMI + WebSocket (WebRTC signalling).
# Host networking is used in compose, so EXPOSE is informational only.
EXPOSE 5060/udp 5060/tcp 5038/tcp 10000-10100/udp 5061/tcp

# Foreground + verbose so `docker compose logs` shows the console; handshake/
# originate activity is visible without attaching to the CLI. Absolute path to
# /usr/sbin/asterisk (Ubuntu layout). Entrypoint renders pjsip.conf from the
# template using the HOST_IP env var before starting Asterisk.
CMD ["/usr/local/bin/asterisk-entrypoint.sh"]
