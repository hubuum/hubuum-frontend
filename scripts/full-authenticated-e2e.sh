#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_COMPOSE_FILE="${ROOT_DIR}/docker-compose.live-backend.yml"
VALKEY_COMPOSE_FILE="${ROOT_DIR}/compose.dev.yml"
BACKEND_PROJECT="${HUBUUM_FULL_E2E_BACKEND_PROJECT:-hubuum-frontend-full-e2e-backend}"
VALKEY_PROJECT="${HUBUUM_FULL_E2E_VALKEY_PROJECT:-hubuum-frontend-full-e2e-valkey}"
BACKEND_IMAGE="${HUBUUM_FULL_E2E_BACKEND_IMAGE:-ghcr.io/hubuum/hubuum-server:v0.0.9@sha256:1f12baf882b6d3df5b4b2dbdf26aad0793274e57f86a2c186b8e1e68632db5db}"
BACKEND_PORT="${HUBUUM_FULL_E2E_BACKEND_PORT:-19999}"
VALKEY_PORT="${HUBUUM_FULL_E2E_VALKEY_PORT:-16379}"
BASE_URL="http://127.0.0.1:${BACKEND_PORT}"
KEEP_STACK="${HUBUUM_FULL_E2E_KEEP_STACK:-0}"
ARTIFACT_DIR="${ROOT_DIR}/test-results/full-authenticated"

export HUBUUM_LIVE_BACKEND_IMAGE="${BACKEND_IMAGE}"
export HUBUUM_LIVE_BACKEND_PORT="${BACKEND_PORT}"

cd "${ROOT_DIR}"
rm -rf "${ARTIFACT_DIR}"
mkdir -p "${ARTIFACT_DIR}"
printf 'backend_image=%s\nbackend_url=%s\nvalkey_port=%s\n' \
  "${BACKEND_IMAGE}" "${BASE_URL}" "${VALKEY_PORT}" \
  > "${ARTIFACT_DIR}/environment.txt"

capture_logs() {
  docker compose -f "${BACKEND_COMPOSE_FILE}" -p "${BACKEND_PROJECT}" \
    logs --no-color > "${ARTIFACT_DIR}/backend-stack.log" 2>&1 || true
  VALKEY_DEV_PORT="${VALKEY_PORT}" \
    docker compose -f "${VALKEY_COMPOSE_FILE}" -p "${VALKEY_PROJECT}" \
    logs --no-color > "${ARTIFACT_DIR}/valkey.log" 2>&1 || true
}

cleanup() {
  local status=$?
  set +e
  capture_logs

  if [[ "${KEEP_STACK}" == "1" ]]; then
    echo "Keeping disposable stacks because HUBUUM_FULL_E2E_KEEP_STACK=1."
  else
    docker compose -f "${BACKEND_COMPOSE_FILE}" -p "${BACKEND_PROJECT}" \
      down -v --remove-orphans >/dev/null 2>&1 || true
    VALKEY_DEV_PORT="${VALKEY_PORT}" \
      docker compose -f "${VALKEY_COMPOSE_FILE}" -p "${VALKEY_PROJECT}" \
      down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  exit "${status}"
}

trap cleanup EXIT

echo "Starting disposable Hubuum Server and PostgreSQL stack."
docker compose -f "${BACKEND_COMPOSE_FILE}" -p "${BACKEND_PROJECT}" \
  up -d --force-recreate --renew-anon-volumes

echo "Starting disposable Valkey session store."
VALKEY_DEV_PORT="${VALKEY_PORT}" \
  docker compose -f "${VALKEY_COMPOSE_FILE}" -p "${VALKEY_PROJECT}" \
  up -d --wait --force-recreate

echo "Waiting for Hubuum Server readiness."
ready=0
for _ in $(seq 1 90); do
  if curl --fail --silent "${BASE_URL}/readyz" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "${ready}" -ne 1 ]]; then
  echo "Hubuum Server did not become ready at ${BASE_URL}/readyz." >&2
  exit 1
fi

reset_output="$(
  docker compose -f "${BACKEND_COMPOSE_FILE}" -p "${BACKEND_PROJECT}" \
    exec -T hubuum hubuum-admin --reset-password admin
)"
admin_password="$(
  printf '%s\n' "${reset_output}" \
    | sed -n 's/^Password for user admin reset to: //p' \
    | tail -1
)"
unset reset_output

if [[ -z "${admin_password}" ]]; then
  echo "Could not obtain a disposable admin password." >&2
  exit 1
fi

echo "Running the complete authenticated Chromium suite sequentially."
CI=1 \
BACKEND_BASE_URL="${BASE_URL}" \
VALKEY_URL="redis://127.0.0.1:${VALKEY_PORT}/0" \
E2E_USERNAME="admin" \
E2E_PASSWORD="${admin_password}" \
E2E_IDENTITY_SCOPE="local" \
  npx playwright test tests/e2e/authenticated-ui.spec.ts \
    --project=chromium \
    --workers=1
