#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf"
NODE_MODULES_VOLUME="hubuum-frontend-visual-amd64-node-modules"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

docker run --rm --init --ipc=host --platform linux/amd64 \
	--volume "${ROOT_DIR}:/work" \
	--volume "${NODE_MODULES_VOLUME}:/work/node_modules" \
	--tmpfs /work/.next \
	--workdir /work \
	--env HOME=/tmp \
	--env CI=true \
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
		npm run test:e2e:visual -- --update-snapshots=all
	'
