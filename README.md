# TopoMari

TopoMari is a self-hosted network-topology dashboard for Komari. It combines Komari latency tasks with authenticated private TCP probes to show multi-hop latency, packet loss, route health, and historical trends in one interface.

> **简体中文：** TopoMari 是面向 Komari 的自托管多跳链路拓扑面板，整合 Komari 延迟任务与认证私有 TCP 探针。界面支持中文 / English、日间 / 夜间模式；完整中文部署流程见 [QUICKSTART.md](QUICKSTART.md)。

```text
Local network -> Relay -> Exit -> Internet target
```

The dashboard includes Chinese and English interfaces, light and dark themes, responsive layouts, and a browser-based route editor. Language and theme preferences are stored only in the browser.

## Features

- Multi-route topology view with per-edge latency and packet-loss status
- Komari Ping task aggregation for reverse-estimated access latency
- Lightweight Python Agents for source-side TCP connection measurements
- SQLite history, retention controls, sparklines, and configurable health thresholds
- Authenticated route editor with atomic writes and revision-conflict protection
- Single-use enrollment codes for private probe deployment
- Agent token hashing, explicit rotation, revocation, and recovery support
- Chinese / English interface and persistent light / dark themes
- Responsive desktop and mobile layouts
- Docker Compose, systemd, Nginx, and HTTPS deployment paths

The browser API never exposes Komari credentials, Agent tokens, probe target addresses, or raw Komari payloads.

## Architecture

```text
                         +------------------+
                         |  Komari server   |
                         +---------+--------+
                                   |
                                   | filtered node/task data
                                   v
+----------------+       +---------+---------+       +----------------+
| Browser UI     | <---> | TopoMari server   | <---> | SQLite history |
| static modules |  API  | auth + aggregation|       | probe samples  |
+----------------+       +---------+---------+       +----------------+
                                   ^
                                   | authenticated ingest
                         +---------+---------+
                         | Private TCP Agents|
                         +-------------------+
```

Frontend and backend code are intentionally separated:

```text
public/
  index.html                  Page structure and accessible controls
  app.js                      Dashboard rendering and refresh orchestration
  editor.js                   Route editor UI
  sparkline.js                Dependency-free trend rendering
  styles.css                  Layout and component structure
  frontend/
    api-client.js             Browser-to-server API boundary
    i18n.js                   Chinese / English messages
    preferences.js            Language and theme persistence
    theme.css                 Light / dark design tokens and visual layer

server.mjs                    HTTP server and route registration
lib/                          Backend domain, security, storage, and Komari logic
scripts/                      Operations, recovery, and release checks
```

The frontend uses native browser modules and has no build step. Visual changes can usually be made in `public/frontend/theme.css`; API changes remain isolated in `public/frontend/api-client.js` and the backend.

## Requirements

- Node.js 22.13 or newer
- Python 3 on hosts running private probe Agents
- A Komari instance for live mode
- HTTPS for production Agent enrollment and reporting

## Quick start

```bash
git clone https://github.com/iseeyoudream07/TopoMari.git
cd TopoMari
cp .env.example .env
cp config/topology.example.json config/topology.json
npm start
```

Open `http://127.0.0.1:3000`.

When `KOMARI_BASE_URL` is not configured, TopoMari starts in demo mode with synthetic Alpha and Beta nodes. Runtime topology and Agent files are ignored by Git.

## Live configuration

Configure the service in `.env`:

```dotenv
KOMARI_BASE_URL=https://status.example.com/
KOMARI_COOKIE=
KOMARI_AUTHORIZATION=
DEMO_MODE=false

HOST=127.0.0.1
PORT=3000

DASHBOARD_USER=topomari
DASHBOARD_PASSWORD=replace-with-a-long-random-password
ALLOW_UNAUTHENTICATED_DASHBOARD=false
ENABLE_DIAGNOSTIC_API=false
ENABLE_TOPOLOGY_EDITOR=true

PROBE_DB_PATH=./data/probes.db
AGENT_CONFIG_PATH=./config/agents.json
AGENT_BACKUP_PATH=./data/agents.backup.json
TOPOLOGY_CONFIG_PATH=./config/topology.json
PROBE_RETENTION_DAYS=7
```

Live mode requires TopoMari Basic Auth by default. The route editor is enabled only when both dashboard credentials and `ENABLE_TOPOLOGY_EDITOR=true` are configured.

If Komari requires an authenticated session, set `KOMARI_COOKIE` or `KOMARI_AUTHORIZATION` in the server environment. Never commit real credentials.

## Route editor

After authentication, open **Manage routes** in the dashboard:

1. Select the relay and exit nodes from the filtered Komari inventory.
2. Assign one or more Komari Ping tasks to the access edge.
3. Configure unique `probe_id` and `agent_id` values for private edges.
4. Optionally override latency and packet-loss thresholds per edge.
5. Save and apply the topology.

Topology configuration stores route identifiers but not probe target addresses. A target address entered in the deployment form is used to generate the Agent command and is saved only on the source host.

## Private probes

The recommended deployment path is **Manage routes -> Private probe deployment**:

1. TopoMari creates a single-use enrollment code valid for 15 minutes.
2. The source host exchanges the code for an Agent token over HTTPS.
3. The installer performs a real measurement and requires `202 Accepted` from TopoMari.
4. The systemd service is installed only after the first report succeeds.

Successful installation ends with:

```text
First private probe report accepted.
Private probe installed and reporting
```

Agents can also be managed from the command line:

```bash
npm run agents:bootstrap
npm run agent:create -- <agent-id> <edge-id>
npm run agent:list
npm run agent:rotate -- <agent-id>
npm run agent:revoke -- <agent-id>
npm run agent:enable -- <agent-id>
```

Installed Agents can be updated without changing their token or target configuration:

```bash
curl -fsSL https://topology.example.com/agent/update.sh -o /tmp/update-topology-agent.sh
sudo bash /tmp/update-topology-agent.sh
```

## Deployment

### Docker Compose

```bash
cp .env.example .env
cp config/topology.example.json config/topology.json
docker compose up -d --build
docker compose logs -f komari-topology
```

The Compose service binds to `127.0.0.1:3000`. Persistent state is stored in `config/` and `data/`.

### systemd

```bash
sudo bash scripts/install-dashboard-service.sh
sudo systemctl status komari-topology-dashboard --no-pager
```

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name topology.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

See [QUICKSTART.md](QUICKSTART.md) for the complete Ubuntu and Docker deployment flow, including HTTPS, probe installation, upgrades, and rollback.

## Health thresholds

Default status thresholds:

- `warning`: average latency at least 150 ms or packet loss above 0%
- `degraded`: average latency at least 250 ms or packet loss at least 20%

An edge can override the defaults:

```json
{
  "from": "relay-a",
  "to": "exit-a",
  "probe_id": "relay-a-to-exit-a",
  "agent_id": "relay-a-agent",
  "health_thresholds": {
    "warning_latency_ms": 250,
    "degraded_latency_ms": 400,
    "warning_loss_percent": 2,
    "degraded_loss_percent": 25
  }
}
```

Each warning threshold must be lower than its degraded threshold.

## API

| Endpoint | Authentication | Purpose |
|---|---|---|
| `GET /api/health` | None | Service health |
| `GET /api/dashboard` | Basic Auth in live mode | Complete dashboard snapshot |
| `GET /api/probes` | Basic Auth | Agent and edge ingest status |
| `GET /api/edge-stats?probe_id=...` | Basic Auth | Private-edge history |
| `GET /api/nodes` | Basic Auth + diagnostics enabled | Filtered Komari nodes |
| `GET /api/ping-tasks` | Basic Auth + diagnostics enabled | Filtered Komari tasks |
| `GET /api/editor/bootstrap` | Basic Auth + editor enabled | Route editor bootstrap |
| `PUT /api/editor/topology` | Basic Auth + CSRF | Atomic topology update |
| `POST /api/editor/enrollments` | Basic Auth + CSRF | Single-use enrollment code |
| `POST /api/enroll` | Enrollment code | Agent token exchange |
| `POST /api/ingest` | Agent Bearer token | Private probe ingest |

Diagnostic node and task endpoints are disabled by default. No endpoint proxies raw Komari payloads.

## Security and state

The following runtime files are excluded from Git and container build context:

```text
.env
config/topology.json
config/agents.json
data/*
```

Agent tokens are returned once and stored as SHA-256 hashes. The Agent registry is mirrored to `data/agents.backup.json` so a missing primary registry can be recovered without invalidating existing Agents.

For vulnerability reporting, see [SECURITY.md](SECURITY.md).

## Development

```bash
npm run dev
npm run check
npm test
npm run audit:public
```

TopoMari has no third-party runtime dependencies. The server, storage layer, browser UI, and Agent use platform or standard-library APIs.

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License

[MIT](LICENSE)
