#!/usr/bin/env bash
set -euo pipefail

compose_file="docker-compose.release-smoke.yml"
project="${HUBUUM_RELEASE_SMOKE_PROJECT:-hubuum-frontend-release-smoke}"
port="${HUBUUM_FRONTEND_TEST_PORT:-13000}"
base_url="http://127.0.0.1:${port}"
cookies="$(mktemp)"

cleanup() {
  docker compose -p "$project" -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$cookies"
}
trap cleanup EXIT

docker compose -p "$project" -f "$compose_file" up --detach

ready=0
for _ in $(seq 1 60); do
  if curl --fail --silent "${base_url}/readyz" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  docker compose -p "$project" -f "$compose_file" logs frontend hubuum valkey
  echo "Release smoke stack did not become ready." >&2
  exit 1
fi

password_output="$(docker compose -p "$project" -f "$compose_file" exec -T hubuum \
  hubuum-admin --reset-password admin)"
password="${password_output##*: }"
if [[ -z "$password" || "$password" == "$password_output" ]]; then
  echo "Could not read the generated admin password." >&2
  exit 1
fi

curl --fail --silent --show-error \
  --cookie-jar "$cookies" \
  --header 'Content-Type: application/json' \
  --data "{\"username\":\"admin\",\"password\":\"${password}\"}" \
  "${base_url}/_hubuum-bff/auth/login" >/dev/null

curl --fail --silent --show-error \
  --cookie "$cookies" \
  "${base_url}/_hubuum-bff/auth/session" >/dev/null

curl --fail --silent --show-error \
  --cookie "$cookies" \
  "${base_url}/_hubuum-bff/hubuum/api/v1/iam/me" >/dev/null

curl --fail --silent --show-error \
  --cookie "$cookies" \
  --request POST \
  "${base_url}/_hubuum-bff/auth/logout" >/dev/null

status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --cookie "$cookies" \
  "${base_url}/_hubuum-bff/auth/session")"
if [[ "$status" != "401" ]]; then
  echo "Expected the session to be invalid after logout; received HTTP $status." >&2
  exit 1
fi

echo "Release stack smoke test passed."
