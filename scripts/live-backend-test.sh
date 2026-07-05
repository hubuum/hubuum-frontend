#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.live-backend.yml"
PROJECT="${HUBUUM_LIVE_COMPOSE_PROJECT:-hubuum-frontend-live-test}"
IMAGE="${HUBUUM_LIVE_BACKEND_IMAGE:-ghcr.io/hubuum/hubuum-server:main}"
PORT="${HUBUUM_LIVE_BACKEND_PORT:-9999}"
BASE_URL="${HUBUUM_LIVE_BACKEND_URL:-http://127.0.0.1:${PORT}}"
KEEP_STACK="${HUBUUM_LIVE_KEEP_STACK:-0}"

export HUBUUM_LIVE_BACKEND_IMAGE="${IMAGE}"
export HUBUUM_LIVE_BACKEND_PORT="${PORT}"

cd "${ROOT_DIR}"

cleanup() {
  local status=$?

  if [ "${status}" -ne 0 ]; then
    echo
    echo "Live backend test failed. Recent hubuum logs:"
    docker compose -f "${COMPOSE_FILE}" -p "${PROJECT}" logs --tail=200 hubuum || true
  fi

  if [ "${KEEP_STACK}" = "1" ]; then
    echo "Keeping live backend stack '${PROJECT}' because HUBUUM_LIVE_KEEP_STACK=1."
  else
    docker compose -f "${COMPOSE_FILE}" -p "${PROJECT}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  exit "${status}"
}

trap cleanup EXIT

echo "Pulling latest live backend image: ${IMAGE}"
docker pull "${IMAGE}"
docker pull postgres:17

echo "Starting disposable live backend stack '${PROJECT}' on ${BASE_URL}"
docker compose -f "${COMPOSE_FILE}" -p "${PROJECT}" up -d --force-recreate --renew-anon-volumes

echo "Waiting for backend readiness..."
ready=0
for _ in $(seq 1 90); do
  if curl -fsS "${BASE_URL}/readyz" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done

if [ "${ready}" -ne 1 ]; then
  echo "Backend did not become ready at ${BASE_URL}/readyz."
  exit 1
fi

echo "Resetting admin password for live test session..."
reset_output="$(docker compose -f "${COMPOSE_FILE}" -p "${PROJECT}" exec -T hubuum hubuum-admin --reset-password admin)"
admin_password="$(printf '%s\n' "${reset_output}" | sed -n 's/^Password for user admin reset to: //p' | tail -1)"

if [ -z "${admin_password}" ]; then
  echo "Could not parse admin password from hubuum-admin output:"
  printf '%s\n' "${reset_output}"
  exit 1
fi

HUBUUM_LIVE_BACKEND_URL="${BASE_URL}" \
  HUBUUM_LIVE_ADMIN_PASSWORD="${admin_password}" \
  node scripts/live-backend-suite.mjs
