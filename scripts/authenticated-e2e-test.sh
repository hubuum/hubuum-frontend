#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_COMPOSE_FILE="${ROOT_DIR}/docker-compose.live-backend.yml"
VALKEY_COMPOSE_FILE="${ROOT_DIR}/compose.dev.yml"
BACKEND_PROJECT="${HUBUUM_AUTH_E2E_BACKEND_PROJECT:-hubuum-frontend-auth-e2e}"
VALKEY_PROJECT="${HUBUUM_AUTH_E2E_VALKEY_PROJECT:-hubuum-frontend-auth-e2e-valkey}"
IMAGE="${HUBUUM_AUTH_E2E_BACKEND_IMAGE:-ghcr.io/hubuum/hubuum-server:v0.0.9}"
BACKEND_PORT="${HUBUUM_AUTH_E2E_BACKEND_PORT:-9998}"
POSTGRES_PORT="${HUBUUM_AUTH_E2E_POSTGRES_PORT:-15433}"
VALKEY_PORT="${HUBUUM_AUTH_E2E_VALKEY_PORT:-16379}"
BASE_URL="http://127.0.0.1:${BACKEND_PORT}"
KEEP_STACK="${HUBUUM_AUTH_E2E_KEEP_STACK:-0}"

export HUBUUM_LIVE_BACKEND_IMAGE="${IMAGE}"
export HUBUUM_LIVE_BACKEND_PORT="${BACKEND_PORT}"
export HUBUUM_LIVE_POSTGRES_PORT="${POSTGRES_PORT}"
export VALKEY_DEV_PORT="${VALKEY_PORT}"

cd "${ROOT_DIR}"

cleanup() {
  local status=$?
  trap - EXIT

  if [ "${status}" -ne 0 ]; then
    echo
    echo "Authenticated browser smoke test failed. Recent service logs:"
    docker compose -f "${BACKEND_COMPOSE_FILE}" -p "${BACKEND_PROJECT}" logs --tail=200 hubuum postgres || true
    docker compose -f "${VALKEY_COMPOSE_FILE}" -p "${VALKEY_PROJECT}" logs --tail=100 valkey || true
  fi

  if [ "${KEEP_STACK}" = "1" ]; then
    echo "Keeping disposable test services because HUBUUM_AUTH_E2E_KEEP_STACK=1."
  else
    docker compose -f "${BACKEND_COMPOSE_FILE}" -p "${BACKEND_PROJECT}" down -v --remove-orphans >/dev/null 2>&1 || true
    docker compose -f "${VALKEY_COMPOSE_FILE}" -p "${VALKEY_PROJECT}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  exit "${status}"
}

trap cleanup EXIT

echo "Starting disposable Valkey service on 127.0.0.1:${VALKEY_PORT}"
docker compose -f "${VALKEY_COMPOSE_FILE}" -p "${VALKEY_PROJECT}" up -d --wait --force-recreate --renew-anon-volumes

echo "Pulling authenticated-test backend image: ${IMAGE}"
docker pull "${IMAGE}"
docker pull postgres:17

echo "Starting disposable Hubuum Server on ${BASE_URL}"
docker compose -f "${BACKEND_COMPOSE_FILE}" -p "${BACKEND_PROJECT}" up -d --force-recreate --renew-anon-volumes

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

reset_output="$(docker compose -f "${BACKEND_COMPOSE_FILE}" -p "${BACKEND_PROJECT}" exec -T hubuum /usr/local/bin/hubuum-admin --reset-password admin)"
admin_password="$(printf '%s\n' "${reset_output}" | sed -n 's/^Password for user admin reset to: //p' | tail -1)"

if [ -z "${admin_password}" ]; then
  echo "Could not obtain the disposable admin credential."
  exit 1
fi

BACKEND_BASE_URL="${BASE_URL}" \
  VALKEY_URL="redis://127.0.0.1:${VALKEY_PORT}/0" \
  E2E_IDENTITY_SCOPE="local" \
  E2E_USERNAME="admin" \
  E2E_PASSWORD="${admin_password}" \
  npx playwright test tests/e2e/authenticated-smoke.spec.ts
