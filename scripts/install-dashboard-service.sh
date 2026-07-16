#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root or with sudo." >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
UNIT_FILE="/etc/systemd/system/komari-topology-dashboard.service"
SERVICE_USER="${DASHBOARD_SERVICE_USER:-komari}"
SERVICE_GROUP="${DASHBOARD_SERVICE_GROUP:-$SERVICE_USER}"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is not installed." >&2
  exit 1
fi
NODE_BIN="$(readlink -f "$NODE_BIN")"
if [[ ! -f "$PROJECT_DIR/server.mjs" ]]; then
  echo "server.mjs was not found in $PROJECT_DIR" >&2
  exit 1
fi
if [[ "$PROJECT_DIR" == /root/* || "$PROJECT_DIR" == /home/* ]]; then
  echo "Install the dashboard under /opt; ProtectHome=true blocks projects under /root or /home." >&2
  exit 1
fi
if [[ "$NODE_BIN" == /root/* || "$NODE_BIN" == /home/* ]]; then
  echo "Install Node.js system-wide; the service cannot execute a Node binary under /root or /home." >&2
  exit 1
fi
if [[ "$PROJECT_DIR" =~ [[:space:]] ]]; then
  echo "The project path must not contain whitespace." >&2
  exit 1
fi

if ! getent group "$SERVICE_GROUP" >/dev/null; then
  groupadd --system "$SERVICE_GROUP"
fi
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  NOLOGIN_SHELL="$(command -v nologin || true)"
  NOLOGIN_SHELL="${NOLOGIN_SHELL:-/usr/sbin/nologin}"
  useradd \
    --system \
    --gid "$SERVICE_GROUP" \
    --home-dir "$PROJECT_DIR" \
    --shell "$NOLOGIN_SHELL" \
    --no-create-home \
    "$SERVICE_USER"
fi

chown root:"$SERVICE_GROUP" "$PROJECT_DIR"
chmod 0750 "$PROJECT_DIR"
chown root:"$SERVICE_GROUP" "$PROJECT_DIR/config"
chmod 2770 "$PROJECT_DIR/config"
chown -R "$SERVICE_USER":"$SERVICE_GROUP" "$PROJECT_DIR/data"
chmod 0750 "$PROJECT_DIR/data"

for protected_file in "$PROJECT_DIR/.env" "$PROJECT_DIR/config/topology.json" "$PROJECT_DIR/config/agents.json"; do
  if [[ -f "$protected_file" ]]; then
    chown root:"$SERVICE_GROUP" "$protected_file"
    chmod 0640 "$protected_file"
  fi
done

cat >"$UNIT_FILE" <<UNIT
[Unit]
Description=TopoMari
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_BIN --env-file-if-exists=.env server.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictRealtime=true
RestrictSUIDSGID=true
RemoveIPC=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=$PROJECT_DIR/config $PROJECT_DIR/data

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable komari-topology-dashboard.service
if ! systemctl restart komari-topology-dashboard.service; then
  systemctl --no-pager --full status komari-topology-dashboard.service || true
  echo "Startup failed. Logs: journalctl -u komari-topology-dashboard -n 100 --no-pager" >&2
  exit 1
fi
systemctl --no-pager --full status komari-topology-dashboard.service || true
echo "Logs: journalctl -u komari-topology-dashboard -f"
