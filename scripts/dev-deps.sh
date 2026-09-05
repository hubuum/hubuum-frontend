#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
action="${1:-up}"
if [[ $# -gt 0 ]]; then shift; fi
runtime="${HUBUUM_CONTAINER_RUNTIME:-}"
if [[ -z "$runtime" ]]; then
  if command -v docker >/dev/null 2>&1; then
    runtime=docker
  else
    runtime=podman
  fi
fi

compose=("$runtime" compose -f "$ROOT_DIR/compose.dev.yml")
if [[ -n "${HUBUUM_VALKEY_PROJECT:-}" ]]; then
  compose+=(-p "$HUBUUM_VALKEY_PROJECT")
fi

case "$action" in
  down)
    exec "${compose[@]}" down "$@"
    ;;
  up)
    "${compose[@]}" up -d "$@"
    ;;
  *)
    echo "Usage: $0 [up|down] [compose action options]" >&2
    exit 2
    ;;
esac

echo "Waiting for development Valkey to accept connections..."
for attempt in $(seq 1 30); do
  if response="$("${compose[@]}" exec -T valkey valkey-cli ping 2>/dev/null)" &&
    [[ "${response//$'\r'/}" == "PONG" ]]; then
    echo "Development Valkey is ready."
    exit 0
  fi
  sleep 2
done

echo "Valkey did not become ready within 60 seconds. Inspect the Compose service logs for details." >&2
exit 1
