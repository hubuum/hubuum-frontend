#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
    echo "Usage: BACKEND_BASE_URL=https://your-server PORT=4444 ./run.sh [options]"
    echo "Starts a private, temporary Valkey instance; Ctrl-C stops both services."
    exec npm run dev -- --help
  fi
done

: "${BACKEND_BASE_URL:?Set BACKEND_BASE_URL to the remote Hubuum Server base URL.}"
if [[ ! -d node_modules/next ]]; then
  echo "Install dependencies first with npm ci (Node.js 24 required)." >&2
  exit 1
fi

# Always own a separate project, even if the shell names another development stack.
export HUBUUM_VALKEY_PROJECT="hubuum-run-$$-$RANDOM"
export VALKEY_DEV_PORT="${VALKEY_DEV_PORT:-}"
active_pid=""

cleanup() {
  local status=$?
  trap - EXIT
  trap '' INT TERM HUP
  if [[ -n "$active_pid" ]]; then
    # Job control gives each command its own group, including npm/Next children.
    kill -TERM -- "-$active_pid" 2>/dev/null || true
    for _ in {1..50}; do
      kill -0 -- "-$active_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$active_pid" 2>/dev/null || true
    wait "$active_pid" 2>/dev/null || true
  fi
  if ! npm run dev:deps:down -- --volumes --remove-orphans; then
    status=1
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
set -m

npm run dev:deps </dev/null &
active_pid=$!
wait "$active_pid"
active_pid=""

address="$(bash scripts/dev-deps.sh port)"
# Docker includes the loopback address; podman-compose returns only the port.
if [[ ! "$address" =~ ^(127\.0\.0\.1:)?([0-9]+)$ ]]; then
  echo "Could not determine the local Valkey port." >&2
  exit 1
fi
export VALKEY_URL="redis://127.0.0.1:${BASH_REMATCH[2]}/0"

npm run dev -- "$@" </dev/null &
active_pid=$!
wait "$active_pid"
