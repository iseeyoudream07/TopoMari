#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this updater as root or with sudo." >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${TOPOMARI_BACKUP_DIR:-/var/backups/topomari}"
HEALTH_URL="${TOPOMARI_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
RUNTIME_OWNER="${TOPOMARI_RUNTIME_OWNER:-1000:1000}"
UPDATE_LOCK="${TOPOMARI_UPDATE_LOCK:-/var/lock/topomari-update.lock}"
AGENT_FILE="$PROJECT_DIR/config/agents.json"
AGENT_BACKUP_FILE="$PROJECT_DIR/data/agents.backup.json"
TOPOLOGY_FILE="$PROJECT_DIR/config/topology.json"
PROBE_DB="$PROJECT_DIR/data/probes.db"
SERVICE_STOPPED="false"
BACKUP_FILE=""

for command_name in curl docker flock git install python3 sha256sum tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    exit 1
  fi
done
exec 9>"$UPDATE_LOCK"
if ! flock -n 9; then
  echo "Another TopoMari update is already running." >&2
  exit 1
fi
if [[ ! -f "$PROJECT_DIR/.env" || ! -f "$TOPOLOGY_FILE" ]]; then
  echo "Refusing to update without .env and config/topology.json in $PROJECT_DIR." >&2
  exit 1
fi
if [[ -n "$(git -C "$PROJECT_DIR" status --porcelain --untracked-files=normal)" ]]; then
  echo "Refusing to update a dirty Git worktree. Commit or move local source changes first." >&2
  exit 1
fi

probe_sample_count() {
  PROBE_DB="$PROBE_DB" python3 - <<'PY'
import os
import sqlite3

path = os.environ["PROBE_DB"]
if not os.path.exists(path):
    print(0)
    raise SystemExit(0)
try:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        row = connection.execute("SELECT COUNT(*) FROM probe_samples").fetchone()
        print(int(row[0] if row else 0))
    finally:
        connection.close()
except sqlite3.OperationalError as error:
    if "no such table" in str(error).lower():
        print(0)
    else:
        raise
PY
}

agent_count() {
  local path=$1
  AGENT_PATH="$path" python3 - <<'PY'
import json
import os

path = os.environ["AGENT_PATH"]
if not os.path.exists(path):
    print(0)
    raise SystemExit(0)
with open(path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)
agents = payload.get("agents", [])
if not isinstance(agents, list):
    raise SystemExit("Agent registry has an invalid agents field")
print(len(agents))
PY
}

restore_agent_registry() {
  if [[ "$AGENT_HASH_BEFORE" == "missing" ]]; then
    rm -f "$AGENT_FILE"
  else
    tar -xzf "$BACKUP_FILE" -C "$PROJECT_DIR" config/agents.json
    chown "$RUNTIME_OWNER" "$AGENT_FILE"
    chmod 0640 "$AGENT_FILE"
  fi
}

ACTIVE_AGENT_COUNT="$(agent_count "$AGENT_FILE")"
BACKUP_AGENT_COUNT="$(agent_count "$AGENT_BACKUP_FILE")"
if [[ "$ACTIVE_AGENT_COUNT" -eq 0 && "$BACKUP_AGENT_COUNT" -gt 0 ]]; then
  echo "Restoring the missing Agent registry from data/agents.backup.json before updating..."
  install -m 0640 "$AGENT_BACKUP_FILE" "$AGENT_FILE.restore"
  chown "$RUNTIME_OWNER" "$AGENT_FILE.restore"
  mv -f "$AGENT_FILE.restore" "$AGENT_FILE"
  ACTIVE_AGENT_COUNT="$BACKUP_AGENT_COUNT"
fi
if [[ "$ACTIVE_AGENT_COUNT" -eq 0 && "$(probe_sample_count)" -gt 0 ]]; then
  echo "Refusing to update: probe history exists but config/agents.json is missing." >&2
  echo "Restore the Agent registry from backup before starting a new release." >&2
  exit 1
fi

docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" config --quiet

recover_service() {
  local exit_code=$?
  trap - ERR INT TERM
  if [[ "$SERVICE_STOPPED" == "true" ]]; then
    echo "Update did not complete. Attempting to start TopoMari with the preserved runtime state..." >&2
    docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" up -d || true
  fi
  if [[ -n "$BACKUP_FILE" ]]; then
    echo "Runtime backup: $BACKUP_FILE" >&2
  fi
  exit "$exit_code"
}
trap recover_service ERR INT TERM

echo "Stopping TopoMari so SQLite and Agent credentials can be backed up consistently..."
docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" down
SERVICE_STOPPED="true"

AGENT_HASH_BEFORE="missing"
if [[ -s "$AGENT_FILE" ]]; then
  python3 -m json.tool "$AGENT_FILE" >/dev/null
  AGENT_HASH_BEFORE="$(sha256sum "$AGENT_FILE" | awk '{print $1}')"
fi

install -d -m 0700 "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/topomari-runtime-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
(
  umask 077
  tar -C "$PROJECT_DIR" -czf "$BACKUP_FILE" .env config data
)
tar -tzf "$BACKUP_FILE" >/dev/null
echo "Runtime state backed up to $BACKUP_FILE"

(
  # Git honors the current umask for replaced files. Keep application source
  # readable by the unprivileged node user used in the Docker image.
  umask 022
  git -C "$PROJECT_DIR" pull --ff-only
)

AGENT_HASH_AFTER_PULL="missing"
if [[ -s "$AGENT_FILE" ]]; then
  python3 -m json.tool "$AGENT_FILE" >/dev/null
  AGENT_HASH_AFTER_PULL="$(sha256sum "$AGENT_FILE" | awk '{print $1}')"
fi
if [[ "$AGENT_HASH_AFTER_PULL" != "$AGENT_HASH_BEFORE" ]]; then
  echo "Agent registry changed during the code update; refusing to start the new release." >&2
  restore_agent_registry
  exit 1
fi

chown -R "$RUNTIME_OWNER" "$PROJECT_DIR/config" "$PROJECT_DIR/data"
chmod 0750 "$PROJECT_DIR/config" "$PROJECT_DIR/data"
docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" up -d --build --force-recreate

HEALTHY="false"
for _attempt in $(seq 1 60); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null; then
    HEALTHY="true"
    break
  fi
  sleep 1
done
if [[ "$HEALTHY" != "true" ]]; then
  echo "TopoMari did not become healthy within 60 seconds." >&2
  docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" logs --tail=100 komari-topology >&2 || true
  exit 1
fi

AGENT_HASH_RUNNING="missing"
if [[ -s "$AGENT_FILE" ]]; then
  AGENT_HASH_RUNNING="$(sha256sum "$AGENT_FILE" | awk '{print $1}')"
fi
if [[ "$AGENT_HASH_RUNNING" != "$AGENT_HASH_BEFORE" ]]; then
  echo "Agent registry changed after startup; stopping to protect existing probe tokens." >&2
  docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" down
  restore_agent_registry
  exit 1
fi

SERVICE_STOPPED="false"
trap - ERR INT TERM
docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" ps
echo
echo "TopoMari update completed. Agent credentials and SQLite history were preserved."
echo "Runtime backup: $BACKUP_FILE"
