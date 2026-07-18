#!/usr/bin/env bash
set -euo pipefail

package_version="$(node -p "require('./package.json').version")"
tag="${1:-v${package_version}}"
if [[ ! "$tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "Usage: $0 [vX.Y.Z]" >&2
  exit 1
fi

version="${tag#v}"
lock_version="$(node -p "require('./package-lock.json').packages[''].version")"
chart_version="$(awk '$1 == "version:" { print $2; exit }' charts/hubuum-frontend/Chart.yaml | tr -d '\"')"
app_version="$(awk '$1 == "appVersion:" { print $2; exit }' charts/hubuum-frontend/Chart.yaml | tr -d '\"')"
compat_backend_image="$(awk '$1 == "COMPAT_BACKEND_IMAGE:" { print $2; exit }' .github/workflows/ci.yml)"

check_equal() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label is '$actual'; expected '$expected'." >&2
    exit 1
  fi
}

check_equal "package.json version" "$package_version" "$version"
check_equal "package-lock.json version" "$lock_version" "$version"
check_equal "Helm chart version" "$chart_version" "$version"
check_equal "Helm appVersion" "$app_version" "$tag"

grep -Fq "## [$version]" CHANGELOG.md || {
  echo "CHANGELOG.md has no section for $version." >&2
  exit 1
}
grep -Fq "ghcr.io/hubuum/hubuum-frontend:$tag" compose.quickstart.yml || {
  echo "compose.quickstart.yml does not default to the $tag image." >&2
  exit 1
}
grep -Fq "HUBUUM_FRONTEND_IMAGE=ghcr.io/hubuum/hubuum-frontend:$tag" .env.quickstart.example || {
  echo ".env.quickstart.example does not default to the $tag image." >&2
  exit 1
}

if [[ "$compat_backend_image" =~ :(v[0-9]+\.[0-9]+\.[0-9]+)@sha256:[0-9a-f]{64}$ ]]; then
  compat_server_tag="${BASH_REMATCH[1]}"
else
  echo "CI compatibility image is not pinned to a versioned server digest." >&2
  exit 1
fi

compatibility_row="| \`$tag\` | \`$compat_server_tag\` | \`ghcr.io/hubuum/hubuum-server:$compat_server_tag\` |"
grep -Fqx "$compatibility_row" docs/compatibility.md || {
  echo "docs/compatibility.md has no $tag -> $compat_server_tag row matching CI." >&2
  exit 1
}

echo "Release metadata is ready for $tag."
