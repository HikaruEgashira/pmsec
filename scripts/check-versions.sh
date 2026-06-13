#!/usr/bin/env bash
# Verify that every file declaring the pmsec version agrees.
# The release workflows only check tag == their own implementation's version,
# so this is the one place that catches a partial bump (e.g. uv.lock left behind).
set -euo pipefail
cd "$(dirname "$0")/.."

node_v=$(awk -F'"' '/"version":/ {print $4; exit}' node/package.json)
py_v=$(awk -F'"' '/^version = / {print $2; exit}' python/pyproject.toml)
lock_v=$(awk -F'"' 'f && /^version = / {print $2; exit} /^name = "pmsec"$/ {f=1}' python/uv.lock)
bash_v=$(awk -F'"' '/^PMSEC_VERSION=/ {print $2; exit}' bash/pmsec)
ps1_v=$(awk -F"'" '/PmsecVersion = / {print $2; exit}' powershell/pmsec.ps1)

status=0
for entry in \
  "node/package.json=$node_v" \
  "python/pyproject.toml=$py_v" \
  "python/uv.lock=$lock_v" \
  "bash/pmsec=$bash_v" \
  "powershell/pmsec.ps1=$ps1_v"; do
  file="${entry%%=*}"
  ver="${entry#*=}"
  if [ -z "$ver" ]; then
    echo "FAIL  $file: version not found" >&2
    status=1
  elif [ "$ver" != "$node_v" ]; then
    echo "FAIL  $file: $ver != $node_v (node/package.json)" >&2
    status=1
  else
    echo "OK    $file: $ver"
  fi
done

exit $status
