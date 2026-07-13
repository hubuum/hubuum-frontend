#!/usr/bin/env bash
set -euo pipefail

version="${1:?Usage: $0 X.Y.Z sha256:DIGEST [OUTPUT_DIR]}"
digest="${2:?Usage: $0 X.Y.Z sha256:DIGEST [OUTPUT_DIR]}"
output_dir="${3:-dist}"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid semantic version: $version" >&2
  exit 1
fi
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Invalid image digest: $digest" >&2
  exit 1
fi

bundle="hubuum-frontend-v${version}-compose"
staging="${output_dir}/${bundle}"
archive="${output_dir}/${bundle}.tar.gz"

rm -rf "$staging"
mkdir -p "$staging"
cp compose.quickstart.yml "$staging/compose.quickstart.yml"
cp .env.quickstart.example "$staging/.env.quickstart.example"
cp docs/quickstart-compose.md "$staging/README.md"

image="ghcr.io/hubuum/hubuum-frontend:v${version}@${digest}"
sed -E -i.bak "s#ghcr\.io/hubuum/hubuum-frontend:v[0-9]+\.[0-9]+\.[0-9]+#${image}#g" \
	"$staging/compose.quickstart.yml" "$staging/.env.quickstart.example"
rm "$staging/compose.quickstart.yml.bak" "$staging/.env.quickstart.example.bak"

tar -czf "$archive" -C "$output_dir" "$bundle"
(
  cd "$output_dir"
  sha256sum "$(basename "$archive")" > SHA256SUMS
)

echo "$archive"
