#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 ]]; then
  echo 'expected package tag prefix and manifest version' >&2
  exit 2
fi
prefix="$1"
actual_version="$2"
case "$prefix" in
  pmsec-node-v|pmsec-py-v) ;;
  *) echo 'unsupported package tag prefix' >&2; exit 1 ;;
esac

case "$EVENT_NAME" in
  workflow_dispatch)
    [[ "$ACTOR" == github-actions\[bot\] ]] || { echo 'dispatch rejected' >&2; exit 1; }
    version="$INPUT_VERSION"
    ;;
  push)
    [[ "$BEFORE" == 0000000000000000000000000000000000000000 ]] || { echo 'tag updates are rejected' >&2; exit 1; }
    version="${REF#refs/tags/$prefix}"
    [[ "$version" != "$REF" ]] || { echo 'unexpected tag ref' >&2; exit 1; }
    ;;
  *) echo 'unsupported publisher event' >&2; exit 1 ;;
esac

[[ "$version" =~ ^[0-9]{4}\.(0?[1-9]|1[0-2])\.[0-9]+$ ]] || { echo 'invalid release version' >&2; exit 1; }
[[ "$REF" == "refs/tags/$prefix$version" ]] || { echo 'tag and version input differ' >&2; exit 1; }
[[ "$actual_version" == "$version" ]] || { echo 'tag and package version differ' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$SHA" ]] || { echo 'checkout does not match event snapshot' >&2; exit 1; }

printf 'version=%s\n' "$version" >> "$GITHUB_OUTPUT"
printf 'release_ref=%s\nrelease_sha=%s\n' "$REF" "$SHA"
