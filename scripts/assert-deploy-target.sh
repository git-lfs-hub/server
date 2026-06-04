#!/usr/bin/env bash
# Fail closed: refuse to publish if the rendered Worker name doesn't match the
# env pinned in .config.json (read from disk, not GLH_ENV which turbo can strip).
set -Eeuo pipefail

env=$(jq -r '.env' ../.config.json)
name=$(jq -r '.name' wrangler.jsonc)
if [[ "$name" != *"-$env" ]]; then
  echo "::error::refusing deploy — Worker '$name' is not a -$env target" >&2
  exit 1
fi
