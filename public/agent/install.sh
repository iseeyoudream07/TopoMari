#!/usr/bin/env bash
set -euo pipefail

SERVER_URL=""
AGENT_ID=""
EDGE_ID=""
TARGET_HOST=""
TARGET_PORT=""
INTERVAL_SECONDS="30"
TIMEOUT_SECONDS="5"
VERIFY_TLS="true"
ALLOW_HTTP="false"
TOKEN="${AGENT_TOKEN:-}"
ENROLLMENT_CODE=""

usage() {
  cat <<'EOF'
Usage:
  curl -fsSL https://topology.example.com/agent/install.sh | sudo bash -s -- \
    --server-url https://topology.example.com \
    --enrollment-code ONE_TIME_CODE \
    --target-host 203.0.113.10 \
    --target-port 443

Manual token mode:
  bash install.sh --server-url URL --agent-id ID --edge-id ID \
    --target-host HOST --target-port PORT --token TOKEN

Optional:
  --interval 30
  --timeout 5
  --enrollment-code CODE   Redeem a 15-minute, single-use enrollment code.
  --token TOKEN             Otherwise you will be prompted securely.
  --allow-http              Allow an unencrypted dashboard URL for temporary testing.
  --insecure-skip-verify    Disable TLS certificate validation. Testing only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url) SERVER_URL="${2:-}"; shift 2 ;;
    --agent-id) AGENT_ID="${2:-}"; shift 2 ;;
    --edge-id) EDGE_ID="${2:-}"; shift 2 ;;
    --target-host) TARGET_HOST="${2:-}"; shift 2 ;;
    --target-port) TARGET_PORT="${2:-}"; shift 2 ;;
    --interval) INTERVAL_SECONDS="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --enrollment-code) ENROLLMENT_CODE="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --allow-http) ALLOW_HTTP="true"; shift ;;
    --insecure-skip-verify) VERIFY_TLS="false"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root or with sudo." >&2
  exit 1
fi

for value in SERVER_URL TARGET_HOST TARGET_PORT; do
  if [[ -z "${!value}" ]]; then
    echo "Missing required option: ${value}" >&2
    usage
    exit 1
  fi
done

if [[ -n "$ENROLLMENT_CODE" && -n "$TOKEN" ]]; then
  echo "Use either --enrollment-code or --token, not both." >&2
  exit 1
fi
if [[ -z "$ENROLLMENT_CODE" ]]; then
  for value in AGENT_ID EDGE_ID; do
    if [[ -z "${!value}" ]]; then
      echo "Missing required option in manual token mode: ${value}" >&2
      usage
      exit 1
    fi
  done
fi

if [[ "$SERVER_URL" != https://* && "$ALLOW_HTTP" != "true" ]]; then
  echo "Refusing to send an agent token over HTTP. Use HTTPS or add --allow-http for temporary testing." >&2
  exit 1
fi

if [[ -z "$TOKEN" && -z "$ENROLLMENT_CODE" ]]; then
  read -r -s -p "Agent token: " TOKEN
  echo
fi
if [[ -z "$TOKEN" && -z "$ENROLLMENT_CODE" ]]; then
  echo "Agent token cannot be empty." >&2
  exit 1
fi

install_dependencies() {
  if command -v python3 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
    return
  fi
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3 curl ca-certificates
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache python3 curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 curl ca-certificates
  else
    echo "Install python3, curl, and CA certificates first." >&2
    exit 1
  fi
}

install_dependencies
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is required for this installer." >&2
  exit 1
fi
PYTHON_BIN="$(command -v python3)"

INSTALL_DIR="/usr/local/lib/komari-topology-agent"
CONFIG_FILE="/etc/komari-topology-agent.json"
UNIT_FILE="/etc/systemd/system/komari-topology-agent.service"
mkdir -p "$INSTALL_DIR"
CURL_ARGS=(-fsSL)
if [[ "$VERIFY_TLS" != "true" ]]; then
  CURL_ARGS+=(-k)
fi

if [[ -n "$ENROLLMENT_CODE" ]]; then
  ENROLL_RESPONSE="$({ ENROLLMENT_CODE="$ENROLLMENT_CODE" python3 - <<'PY'
import json
import os
print(json.dumps({"code": os.environ["ENROLLMENT_CODE"]}))
PY
  } | curl "${CURL_ARGS[@]}" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    "${SERVER_URL%/}/api/enroll")"
  IFS=$'\t' read -r AGENT_ID EDGE_ID TOKEN < <(
    ENROLL_RESPONSE="$ENROLL_RESPONSE" python3 - <<'PY'
import json
import os
import sys

try:
    payload = json.loads(os.environ["ENROLL_RESPONSE"])
    values = [payload["agentId"], payload["edgeId"], payload["token"]]
    if not all(isinstance(value, str) and value for value in values):
        raise ValueError("empty enrollment value")
except Exception as error:
    print(f"Invalid enrollment response: {error}", file=sys.stderr)
    raise SystemExit(1)
print("\t".join(values))
PY
  )
  if [[ -z "$AGENT_ID" || -z "$EDGE_ID" || -z "$TOKEN" ]]; then
    echo "Enrollment failed." >&2
    exit 1
  fi
  unset ENROLLMENT_CODE ENROLL_RESPONSE
fi

curl "${CURL_ARGS[@]}" "${SERVER_URL%/}/agent/probe_agent.py" -o "$INSTALL_DIR/probe_agent.py"
chmod 0755 "$INSTALL_DIR/probe_agent.py"

CONFIG_FILE="$CONFIG_FILE" SERVER_URL="$SERVER_URL" AGENT_ID="$AGENT_ID" TOKEN="$TOKEN" \
EDGE_ID="$EDGE_ID" TARGET_HOST="$TARGET_HOST" TARGET_PORT="$TARGET_PORT" \
INTERVAL_SECONDS="$INTERVAL_SECONDS" TIMEOUT_SECONDS="$TIMEOUT_SECONDS" VERIFY_TLS="$VERIFY_TLS" \
python3 - <<'PY'
import json
import os

payload = {
    "server_url": os.environ["SERVER_URL"].rstrip("/"),
    "agent_id": os.environ["AGENT_ID"],
    "token": os.environ["TOKEN"],
    "interval_seconds": int(os.environ["INTERVAL_SECONDS"]),
    "timeout_seconds": float(os.environ["TIMEOUT_SECONDS"]),
    "verify_tls": os.environ["VERIFY_TLS"].lower() == "true",
    "probes": [
        {
            "edge_id": os.environ["EDGE_ID"],
            "host": os.environ["TARGET_HOST"],
            "port": int(os.environ["TARGET_PORT"]),
        }
    ],
}
with open(os.environ["CONFIG_FILE"], "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")
PY
chmod 0600 "$CONFIG_FILE"

echo "Verifying the first private probe report..."
if ! "$PYTHON_BIN" "$INSTALL_DIR/probe_agent.py" --config "$CONFIG_FILE" --once; then
  echo "Probe preflight failed; the systemd service was not installed." >&2
  echo "Check HTTPS reachability, certificate trust, Agent enrollment, and the dashboard logs above." >&2
  exit 1
fi
echo "First private probe report accepted."
unset TOKEN AGENT_TOKEN

cat >"$UNIT_FILE" <<UNIT
[Unit]
Description=Komari Topology Private TCP Probe
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${PYTHON_BIN} /usr/local/lib/komari-topology-agent/probe_agent.py --config /etc/komari-topology-agent.json
Restart=always
RestartSec=5
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

systemctl daemon-reload
if ! systemctl enable --now komari-topology-agent.service; then
  echo "Unable to enable or start komari-topology-agent.service." >&2
  journalctl -u komari-topology-agent.service -n 30 --no-pager >&2 || true
  exit 1
fi
sleep 2
if ! systemctl is-active --quiet komari-topology-agent.service; then
  systemctl --no-pager --full status komari-topology-agent.service >&2 || true
  journalctl -u komari-topology-agent.service -n 30 --no-pager >&2 || true
  echo "Private probe service did not stay active." >&2
  exit 1
fi
systemctl --no-pager --full status komari-topology-agent.service
echo
echo "Private probe installed and reporting: ${AGENT_ID} -> ${EDGE_ID} (${TARGET_HOST}:${TARGET_PORT})"
echo "Logs: journalctl -u komari-topology-agent -f"
