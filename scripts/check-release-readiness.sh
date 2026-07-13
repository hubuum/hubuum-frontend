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

echo "Release metadata is ready for $tag."
