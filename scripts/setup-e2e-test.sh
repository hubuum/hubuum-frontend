#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
project="hubuum-setup-e2e-$$-$RANDOM"
runtime="${HUBUUM_CONTAINER_RUNTIME:-}"
if [[ -z "$runtime" ]]; then
  if command -v docker >/dev/null 2>&1; then runtime=docker; else runtime=podman; fi
fi
override="$(mktemp "${TMPDIR:-/tmp}/hubuum-setup-compose.XXXXXX")"
cat >"$override" <<'YAML'
services:
  valkey:
    ports: ["127.0.0.1::6379"]
YAML
compose=("$runtime" compose -f "$PWD/compose.quickstart.yml" -f "$override" -p "$project")
cleanup() {
  local status=$?
  trap - EXIT
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || status=1
  rm -f "$override"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" up -d --wait valkey
discover_port() {
  local address
  address="$("${compose[@]}" port valkey 6379)"
  if [[ ! "$address" =~ ^(127\.0\.0\.1:)?([0-9]+)$ ]]; then
    echo "Could not determine the test Valkey port." >&2
    exit 1
  fi
  export VALKEY_URL="redis://127.0.0.1:${BASH_REMATCH[2]}/0"
}
discover_port
export BACKEND_BASE_URL=""
export HUBUUM_SETUP_TEST_PREFIX="$project:"
HUBUUM_SETUP_TEST_PHASE=before npx vitest run src/lib/backend-target.integration.test.ts
"${compose[@]}" restart valkey
if ! "${compose[@]}" up -d --wait valkey; then
  "${compose[@]}" logs --tail 40 valkey
  exit 1
fi
discover_port
HUBUUM_SETUP_TEST_PHASE=after npx vitest run src/lib/backend-target.integration.test.ts
export SETUP_KEY=""
export SESSION_PREFIX="$project:sessions:"
export SETTINGS_PREFIX="$project:settings:"
export E2E_SETUP=1
export CI=1
unset PLAYWRIGHT_BASE_URL
npx playwright test tests/e2e/backend-setup.spec.ts --workers=1 --retries=0 "$@" 2>&1 |
  awk '!/\[hubuum-setup\] One-time setup key:/ { print; fflush() }'
