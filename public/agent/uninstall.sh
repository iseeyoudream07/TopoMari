#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root or with sudo." >&2
  exit 1
fi

systemctl disable --now komari-topology-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/komari-topology-agent.service
rm -f /etc/komari-topology-agent.json
rm -rf /usr/local/lib/komari-topology-agent
systemctl daemon-reload
echo "Komari topology private probe removed."
