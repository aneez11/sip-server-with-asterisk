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

## Troubleshooting

- Check `docker compose logs -f api asterisk mysql` for startup failures.
- If phones cannot register or receive audio, verify `HOST_IP`, the LAN
  firewall, UDP/TCP port `5060`, and UDP ports `10000-10100`.
- If the API cannot connect to AMI, verify the AMI credentials and that
  `asterisk-config/manager.conf` allows the API container (`172.30.0.4`).
- After changing environment values used by Docker, recreate the API and
  Asterisk containers with `docker compose up --build -d`.
