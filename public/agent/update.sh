#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="/etc/komari-topology-agent.json"
INSTALL_DIR="/usr/local/lib/komari-topology-agent"
AGENT_FILE="$INSTALL_DIR/probe_agent.py"
UNIT_FILE="/etc/systemd/system/komari-topology-agent.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this updater as root or with sudo." >&2
  exit 1
fi

for command_name in python3 curl systemctl install mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    exit 1
  fi
done
if [[ ! -s "$CONFIG_FILE" || ! -s "$AGENT_FILE" || ! -s "$UNIT_FILE" ]]; then
  echo "An existing TopoMari probe installation was not found." >&2
  echo "Use /agent/install.sh for the first installation." >&2
  exit 1
fi

PYTHON_BIN="$(command -v python3)"
IFS=$'\t' read -r SERVER_URL VERIFY_TLS < <(
  CONFIG_FILE="$CONFIG_FILE" "$PYTHON_BIN" - <<'PY'
import json
import os

with open(os.environ["CONFIG_FILE"], "r", encoding="utf-8") as handle:
    config = json.load(handle)
server_url = str(config.get("server_url", "")).rstrip("/")
if not server_url:
    raise SystemExit("server_url is missing from the existing Agent config")
verify_tls = config.get("verify_tls", True) is not False
print(f"{server_url}\t{'true' if verify_tls else 'false'}")
PY
)

WORK_DIR="$(mktemp -d /tmp/topomari-agent-update.XXXXXX)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

CANDIDATE_AGENT="$WORK_DIR/probe_agent.py"
CANDIDATE_UNIT="$WORK_DIR/komari-topology-agent.service"
OLD_AGENT="$WORK_DIR/probe_agent.py.old"
OLD_UNIT="$WORK_DIR/komari-topology-agent.service.old"
CURL_ARGS=(-fsSL)
if [[ "$VERIFY_TLS" != "true" ]]; then
  CURL_ARGS+=(-k)
fi

echo "Downloading the current TopoMari probe without changing its token or targets..."
curl "${CURL_ARGS[@]}" "$SERVER_URL/agent/probe_agent.py" -o "$CANDIDATE_AGENT"
chmod 0755 "$CANDIDATE_AGENT"
"$PYTHON_BIN" -c 'import sys; compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")' "$CANDIDATE_AGENT"

echo "Verifying the existing credentials with one report before replacing the running Agent..."
if ! "$PYTHON_BIN" "$CANDIDATE_AGENT" --config "$CONFIG_FILE" --once; then
  echo "Agent update aborted. The installed binary, config, token, and service were not changed." >&2
  exit 1
fi

cp -p "$AGENT_FILE" "$OLD_AGENT"
if [[ -f "$UNIT_FILE" ]]; then
  cp -p "$UNIT_FILE" "$OLD_UNIT"
fi

cat >"$CANDIDATE_UNIT" <<UNIT
[Unit]
Description=Komari Topology Private TCP Probe
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=notify
NotifyAccess=main
ExecStart=${PYTHON_BIN} /usr/local/lib/komari-topology-agent/probe_agent.py --config /etc/komari-topology-agent.json
Restart=always
RestartSec=5
WatchdogSec=120
TimeoutStartSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
UNIT

rollback() {
  echo "The updated service did not stay active; restoring the previous Agent binary and unit." >&2
  install -m 0755 "$OLD_AGENT" "$AGENT_FILE"
  if [[ -f "$OLD_UNIT" ]]; then
    install -m 0644 "$OLD_UNIT" "$UNIT_FILE"
  fi
  systemctl daemon-reload
  systemctl restart komari-topology-agent.service || true
}

install -d -m 0755 "$INSTALL_DIR"
install -m 0755 "$CANDIDATE_AGENT" "$AGENT_FILE.new"
mv -f "$AGENT_FILE.new" "$AGENT_FILE"
install -m 0644 "$CANDIDATE_UNIT" "$UNIT_FILE.new"
mv -f "$UNIT_FILE.new" "$UNIT_FILE"
systemctl daemon-reload
if ! systemctl enable --now komari-topology-agent.service || \
   ! systemctl restart komari-topology-agent.service || \
   ! systemctl is-active --quiet komari-topology-agent.service; then
  rollback
  exit 1
fi

systemctl --no-pager --full status komari-topology-agent.service
echo
echo "TopoMari probe updated successfully. Existing config, token, targets, and Agent ID were preserved."
