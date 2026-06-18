#!/usr/bin/env bash
# Bump the pmsec version in every file that declares it, then verify.
# Usage: scripts/bump.sh <version>
set -euo pipefail
ver="${1:?usage: scripts/bump.sh <version>}"
printf '%s' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "invalid version: $ver" >&2; exit 2; }
cd "$(dirname "$0")/.."

perl -pi -e 's/^(  "version": ")[^"]+/${1}'"$ver"'/' node/package.json
perl -pi -e 's/^(version = ")[^"]+/${1}'"$ver"'/' python/pyproject.toml
perl -pi -e 's/^(PMSEC_VERSION=")[^"]+/${1}'"$ver"'/' bash/pmsec
perl -pi -e "s/(PmsecVersion = ')[^']+/\${1}$ver/" powershell/pmsec.ps1
(cd python && uv lock --quiet)

bash scripts/check-versions.sh

echo "Bumped to $ver."
