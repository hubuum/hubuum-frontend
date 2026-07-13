#!/usr/bin/env bash
set -euo pipefail

project="${HUBUUM_QUICKSTART_SMOKE_PROJECT:-hubuum-frontend-quickstart-smoke}"
port="${HUBUUM_FRONTEND_PORT:-13001}"
base_url="http://127.0.0.1:${port}"

cleanup() {
  docker compose -p "$project" -f compose.quickstart.yml down \
    --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -p "$project" -f compose.quickstart.yml config --quiet
docker compose -p "$project" -f compose.quickstart.yml up --detach

healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent "${base_url}/healthz" >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$healthy" -ne 1 ]]; then
  docker compose -p "$project" -f compose.quickstart.yml logs frontend valkey
  echo "Compose quickstart frontend did not become healthy." >&2
  exit 1
fi

docker compose -p "$project" -f compose.quickstart.yml exec -T valkey \
  valkey-cli ping | grep -Fxq PONG

status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "${base_url}/readyz")"
if [[ "$status" != "503" ]]; then
  echo "Expected readiness to fail for the intentionally unavailable backend; received HTTP $status." >&2
  exit 1
fi

echo "Compose quickstart smoke test passed."
