#!/usr/bin/env bash
# Convenience wrapper around the development Home Assistant container.
set -euo pipefail

cd "$(dirname "$0")"
CONFIG_DIR="$(cd .. && pwd)/../ha-dev/config"

case "${1:-up}" in
  up)
    mkdir -p "$CONFIG_DIR/www"
    docker compose up -d
    echo "Home Assistant starting on http://localhost:8123"
    echo "Config directory: $CONFIG_DIR"
    ;;
  down)
    docker compose down
    ;;
  logs)
    docker compose logs -f
    ;;
  restart)
    docker compose restart
    ;;
  recreate)
    # A changed volume only takes effect when the container is rebuilt, which
    # `restart` does not do. The config lives in its own directory, so the
    # recorded history survives this.
    docker compose down
    mkdir -p "$CONFIG_DIR/www"
    docker compose up -d
    echo "Recreated. Waiting for the bundle to be served..."
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w '%{http_code}' \
        http://localhost:8123/local/ftc/family-tracking-card.js || true)
      if [ "$code" = "200" ]; then
        echo "OK: /local/ftc/family-tracking-card.js is served."
        echo "Register it once under Settings > Dashboards > Resources as a"
        echo "JavaScript module, then hard refresh (Ctrl+Shift+R)."
        exit 0
      fi
      sleep 2
    done
    echo "Still not served (last HTTP status: ${code:-none})." >&2
    echo "Check 'ls dist/' and '$0 logs'." >&2
    exit 1
    ;;
  *)
    echo "usage: $0 {up|down|logs|restart|recreate}" >&2
    exit 1
    ;;
esac
