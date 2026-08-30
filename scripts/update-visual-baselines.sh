#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e"
NODE_MODULES_VOLUME="hubuum-frontend-visual-node-modules"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

docker run --rm --init --ipc=host \
	--volume "${ROOT_DIR}:/work" \
	--volume "${NODE_MODULES_VOLUME}:/work/node_modules" \
	--workdir /work \
	--env HOME=/tmp \
	--env NEXT_PUBLIC_APP_VERSION=v0.0.0+visual \
	--env VISUAL_REGRESSION=1 \
	--env VISUAL_TEST_HOST_UID="${HOST_UID}" \
	--env VISUAL_TEST_HOST_GID="${HOST_GID}" \
	"${IMAGE}" \
	bash -lc '
		cleanup() {
			chown -R "${VISUAL_TEST_HOST_UID}:${VISUAL_TEST_HOST_GID}" \
				tests/e2e/__screenshots__ test-results playwright-report \
				2>/dev/null || true
		}
		trap cleanup EXIT
		npm ci --no-audit
		npm run test:e2e:visual -- --update-snapshots
	'
