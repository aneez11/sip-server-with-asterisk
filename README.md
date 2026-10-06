# Infinity Echo

Infinity Echo is the Node.js and TypeScript SIP broadcast paging console. It
contains the Express API, React/Vite web console, Prisma data layer, Socket.IO
realtime events, and Asterisk integration.

## Requirements

- Docker Desktop with Docker Compose
- Node.js 20 or newer for local development
- A LAN IP address for the machine running Asterisk (`HOST_IP`)

## Run the complete stack

The Docker stack starts MySQL, Asterisk, and the API. The API serves the built
web console, so this is the simplest way to run the complete application.

From this directory:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set at least these values:

```dotenv
HOST_IP=192.168.1.50
DB_ROOT_PASSWORD=replace-with-a-database-password
AMI_SECRET=replace-with-the-ami-password
ADMIN_PASSWORD=replace-with-the-console-password
SESSION_SECRET=replace-with-a-random-string-at-least-8-characters
PA_TRIGGER_SECRET=replace-with-a-private-trigger-secret
```

`HOST_IP` must be reachable by the SIP phones and speakers. It is used when
Asterisk generates its SIP/RTP configuration. `AMI_USERNAME` and `AMI_SECRET`
must match the AMI credentials in `asterisk-config/manager.conf`.

Build and start the services:

```powershell
docker compose up --build
```

Open the console at <http://localhost:3001>. Sign in with the values from
`ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` (the default username is
`admin`). The API synchronizes the Prisma schema and creates the first admin
user automatically on its first successful startup.

Stop the stack with `Ctrl+C`, or run it in the background:

```powershell
docker compose up --build -d
docker compose logs -f api
docker compose down
```

The MySQL data is stored in the `infinity-mysql` Docker volume. To remove the
database as well as the containers, use `docker compose down -v`.

## Deployment on a Synology NAS

The stack runs on DSM's Container Manager (Docker). Prefer the **`docker compose`
CLI** over the Container Manager UI: the UI can ignore `mem_limit`, `labels`, and
`healthcheck`, which the auto-recovery relies on.

1. Copy the project to a shared folder (e.g. `/volume1/docker/infinity-echo`) and
   create `.env` from `.env.example`.
2. **Open the firewall** (Control Panel → Security → Firewall) for TCP `3001`,
   UDP **and** TCP `5060`, and UDP `10000-10100`. Without these, nothing outside
   the NAS reaches the console or SIP/RTP.
3. Set `HOST_IP` to the NAS's LAN IP (the address phones/speakers use).
4. **Tune memory** to the unit. Defaults target a 2 GB host
   (`API_MEM_LIMIT=512m`, `ASTERISK_MEM_LIMIT=256m`, `MYSQL_MEM_LIMIT=768m`,
   `AUTOHEAL_MEM_LIMIT=64m`); raise them on a larger NAS. These are ceilings, not
   reservations — normal usage sits well below them.
5. Start and verify:

   ```sh
   cd /volume1/docker/infinity-echo
   sudo docker compose up -d
   sudo docker compose ps
   curl -s http://localhost:3001/health
   ```

Notes:

- `autoheal` mounts `/var/run/docker.sock`, which is present under Container
  Manager. If it runs as an unprivileged task it needs read access to that socket.
- Keep bridge networking (the default). The config's media-address rewriting
  handles the bridge NAT; `HOST_IP` plus the published RTP range must be
  reachable from the SIP devices.
- ARM-based models run the same images (multi-arch); expect slower startup.

## Local development

Install all workspace dependencies from the repository root:

```powershell
npm install
```

The API still needs MySQL and Asterisk. Set `DATABASE_URL`, `AMI_HOST`,
`AMI_PORT`, `AMI_USERNAME`, `AMI_SECRET`, `ADMIN_PASSWORD`, and
`SESSION_SECRET` in `api/.env` (or in the environment) before starting it.
For a local API process, use a host-reachable database and Asterisk, for
example `mysql://root:password@127.0.0.1:3306/infinity_echo` and
`AMI_HOST=127.0.0.1`.

Start the API and web development servers in separate terminals:

```powershell
npm run dev:api
npm run dev:web
```

The Vite console runs at <http://localhost:5173> and proxies API and Socket.IO
requests to the API at <http://localhost:3001>.

## Useful commands

```powershell
npm run typecheck
npm run build
npm run typecheck -w api
npm run typecheck -w web
```

To run the live-talk audio smoke test against a running API and Asterisk:

```powershell
docker compose exec api node scripts/test-talk-audio.mjs <endpointId>
```

## Project layout

```text
shared/             Shared domain types and Socket.IO event contracts
api/                Express API, Prisma, AMI client, and realtime services
web/                React 19 + Vite administration console
asterisk-config/    Asterisk SIP, dialplan, and AMI configuration
announcements/      Shared WAV announcement storage
docs/               Design and behavior documentation
```

## Stability & auto-recovery

The stack is hardened against the "works for days, then hangs, restart fixes it"
failure mode:

- **Health checks.** `api`, `asterisk`, and `mysql` each define a Docker
  healthcheck. The API exposes `GET /health` (unauthenticated), which only
  answers while its event loop is responsive and returns `503` if the AMI/DB
  sweep loop has stalled.
- **Auto-restart (`autoheal`).** The `autoheal` service watches containers
  labelled `autoheal=true` and restarts any that report unhealthy, automating
  the manual "restart the container" recovery.
- **In-process guards.** The API runs a single sweep loop (never stacked across
  AMI reconnects), ignores overlapping sweeps, and has an event-loop watchdog
  that exits the process if it is blocked for more than ~2 minutes so Docker
  restarts it.
- **Memory caps + log rotation.** Each service sets a `mem_limit` and capped
  JSON logs, so a leak is OOM-killed and restarted instead of freezing the host
  or filling the disk.
- **Static IPs.** All services are pinned on the compose network so a dynamic
  allocation can never race the API for `172.30.0.4`.

`GET /health` is also useful for external monitoring:

```powershell
curl.exe -s http://localhost:3001/health
```

### SIP registrations dropping

Asterisk AORs use `remove_existing = yes`, so a device that re-registers (soft
phones and mobile SIP apps re-register from changing source ports, often behind
Docker's NAT) **replaces** its contact instead of accumulating a second one.
Without this, the AOR fills to `max_contacts` and Asterisk rejects further
registrations with `will exceed max contacts`, leaving the device offline until
the container is restarted.

## Troubleshooting

- Check `docker compose logs -f api asterisk mysql` for startup failures.
- If phones cannot register or receive audio, verify `HOST_IP`, the LAN
  firewall, UDP/TCP port `5060`, and UDP ports `10000-10100`.
- If the API cannot connect to AMI, verify the AMI credentials and that
  `asterisk-config/manager.conf` allows the API container (`172.30.0.4`).
- After changing environment values used by Docker, recreate the API and
  Asterisk containers with `docker compose up --build -d`.
- If lines show offline, inspect registration state:

  ```powershell
  docker exec infinityecho-asterisk-1 asterisk -rx "pjsip show endpoints"
  ```

  and confirm no `will exceed max contacts` rejections (see
  [SIP registrations dropping](#sip-registrations-dropping)).
