#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export HUBUUM_VALKEY_PROJECT="hubuum-setup-e2e-$$-$RANDOM"
export VALKEY_DEV_PORT=""
cleanup() {
  local status=$?
  trap - EXIT
  bash scripts/dev-deps.sh down --volumes --remove-orphans >/dev/null 2>&1 || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
bash scripts/dev-deps.sh up
address="$(bash scripts/dev-deps.sh port)"
if [[ ! "$address" =~ ^(127\.0\.0\.1:)?([0-9]+)$ ]]; then
  echo "Could not determine the test Valkey port." >&2
  exit 1
fi
export VALKEY_URL="redis://127.0.0.1:${BASH_REMATCH[2]}/0"
export BACKEND_BASE_URL=""
export SETUP_KEY="$(openssl rand -hex 32)"
export E2E_SETUP=1
export CI=1
unset PLAYWRIGHT_BASE_URL
npx playwright test tests/e2e/backend-setup.spec.ts --workers=1 --retries=0 "$@"
