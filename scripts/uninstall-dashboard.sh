#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this uninstaller as root or with sudo." >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PARENT="$(dirname "$PROJECT_DIR")"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
BACKUP_ROOT="${TOPOMARI_BACKUP_DIR:-/var/backups/topomari}"
NGINX_SITE_NAME="${TOPOMARI_NGINX_SITE:-topomari}"
UNIT_NAME="komari-topology-dashboard.service"
UNIT_FILE="/etc/systemd/system/$UNIT_NAME"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUNTIME_BACKUP="$BACKUP_ROOT/topomari-runtime-before-uninstall-$TIMESTAMP.tar.gz"
SYSTEM_BACKUP_DIR="$BACKUP_ROOT/system-before-uninstall-$TIMESTAMP"
ARCHIVE_DIR="$PROJECT_PARENT/$PROJECT_NAME.uninstalled-$TIMESTAMP"

case "$PROJECT_DIR" in
  /|/bin|/boot|/dev|/etc|/home|/opt|/root|/srv|/usr|/var)
    echo "Refusing to uninstall from unsafe project path: $PROJECT_DIR" >&2
    exit 1
    ;;
esac
if [[ ! -f "$PROJECT_DIR/server.mjs" || ! -f "$PROJECT_DIR/package.json" || ! -f "$PROJECT_DIR/docker-compose.yml" ]]; then
  echo "Refusing to uninstall: $PROJECT_DIR is not a complete TopoMari checkout." >&2
  exit 1
fi
if ! grep -Eq '"name"[[:space:]]*:[[:space:]]*"topomari"' "$PROJECT_DIR/package.json"; then
  echo "Refusing to uninstall: package.json does not identify TopoMari." >&2
  exit 1
fi
if [[ ! "$NGINX_SITE_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "TOPOMARI_NGINX_SITE contains unsafe characters." >&2
  exit 1
fi
if [[ "$BACKUP_ROOT" != /* ]]; then
  echo "TOPOMARI_BACKUP_DIR must be an absolute path." >&2
  exit 1
fi
if [[ "$BACKUP_ROOT" == "$PROJECT_DIR" || "$BACKUP_ROOT" == "$PROJECT_DIR/"* ]]; then
  echo "TOPOMARI_BACKUP_DIR must be outside the project directory." >&2
  exit 1
fi
if [[ -e "$ARCHIVE_DIR" ]]; then
  echo "Archive destination already exists: $ARCHIVE_DIR" >&2
  exit 1
fi

for command_name in date grep install mv rm tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    exit 1
  fi
done

echo "Stopping TopoMari..."
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml" down
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
fi

install -d -m 0700 "$BACKUP_ROOT" "$SYSTEM_BACKUP_DIR"
runtime_items=()
for runtime_item in .env config data; do
  if [[ -e "$PROJECT_DIR/$runtime_item" ]]; then
    runtime_items+=("$runtime_item")
  fi
done
if [[ "${#runtime_items[@]}" -gt 0 ]]; then
  (
    umask 077
    tar -C "$PROJECT_DIR" -czf "$RUNTIME_BACKUP" "${runtime_items[@]}"
  )
  tar -tzf "$RUNTIME_BACKUP" >/dev/null
  echo "Runtime backup created: $RUNTIME_BACKUP"
else
  echo "No .env, config, or data directory was found; no runtime archive was created."
  RUNTIME_BACKUP=""
fi

if [[ -f "$UNIT_FILE" ]]; then
  install -m 0600 "$UNIT_FILE" "$SYSTEM_BACKUP_DIR/$UNIT_NAME"
  rm -f -- "$UNIT_FILE"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload
  fi
fi

NGINX_AVAILABLE="/etc/nginx/sites-available/$NGINX_SITE_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$NGINX_SITE_NAME"
NGINX_CHANGED="false"
if [[ -e "$NGINX_AVAILABLE" || -L "$NGINX_AVAILABLE" ]]; then
  install -m 0600 "$NGINX_AVAILABLE" "$SYSTEM_BACKUP_DIR/nginx-$NGINX_SITE_NAME.conf"
  rm -f -- "$NGINX_AVAILABLE"
  NGINX_CHANGED="true"
fi
if [[ -e "$NGINX_ENABLED" || -L "$NGINX_ENABLED" ]]; then
  rm -f -- "$NGINX_ENABLED"
  NGINX_CHANGED="true"
fi
if [[ "$NGINX_CHANGED" == "true" ]] && command -v nginx >/dev/null 2>&1; then
  nginx -t
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload nginx
  fi
fi

cd "$PROJECT_PARENT"
mv -- "$PROJECT_DIR" "$ARCHIVE_DIR"

echo
echo "TopoMari has been uninstalled from $PROJECT_DIR."
echo "Recoverable project archive: $ARCHIVE_DIR"
if [[ -n "$RUNTIME_BACKUP" ]]; then
  echo "Runtime backup: $RUNTIME_BACKUP"
fi
echo "System configuration backup: $SYSTEM_BACKUP_DIR"
echo "Private probes on other servers were not removed."
