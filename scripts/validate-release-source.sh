#!/usr/bin/env bash
set -euo pipefail

case "$EVENT_NAME" in
  workflow_run)
    [[ "$CONCLUSION" == success ]] || { echo 'source CI did not succeed' >&2; exit 1; }
    [[ "$HEAD_BRANCH" == main ]] || { echo 'source CI was not for main' >&2; exit 1; }
    [[ "$HEAD_REPOSITORY" == "$REPOSITORY" ]] || { echo 'source CI was not for this repository' >&2; exit 1; }
    source_sha="$HEAD_SHA"
    ;;
  workflow_dispatch)
    [[ "$REF" == refs/heads/main ]] || { echo 'manual releases must target main' >&2; exit 1; }
    source_sha="$SHA"
    ;;
  *) echo 'unsupported release event' >&2; exit 1 ;;
esac

[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'invalid release source SHA' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$source_sha" ]] || { echo 'checkout does not match verified source snapshot' >&2; exit 1; }
printf 'release_source_sha=%s\n' "$source_sha"
