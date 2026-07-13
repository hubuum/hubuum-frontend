#!/usr/bin/env bash
set -euo pipefail

version="${1:?Usage: $0 X.Y.Z}"
awk -v header="## [$version]" '
  $0 == header || index($0, header " - ") == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' CHANGELOG.md
