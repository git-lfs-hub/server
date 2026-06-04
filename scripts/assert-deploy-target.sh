#!/usr/bin/env bash
# Fail closed: refuse to publish if the rendered Worker name doesn't match the
# env pinned in .config.json (read from disk, not GLH_ENV which turbo can strip).
set -Eeuo pipefail

env=$(jq -r '.env' ../.config.json)

wranglerName=$(jq -r '.name' wrangler.jsonc)
if [[ "$wranglerName" != *"-$env" ]]; then
  echo "::error::refusing deploy — Worker '$wranglerName' is not a -$env target" >&2
  exit 1
fi

wranglerEnv=$(jq -r '.vars.ENV' wrangler.jsonc)
if [[ "$wranglerEnv" != "$env" ]]; then
  echo "::error::refusing deploy — vars.ENV '$wranglerEnv' does not match env '$env'" >&2
  exit 1
fi
