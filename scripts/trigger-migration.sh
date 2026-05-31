#!/usr/bin/env bash
set -euo pipefail

# Kick off a data migration after deploy. Workflows don't auto-start on deploy,
# so trigger one instance from the pipeline. The fixed instance id makes the
# trigger idempotent across re-deploys: creating an instance with an existing id
# errors (swallowed below), and even a fresh id is harmless because the per-repo
# `ver` guard skips already-migrated repos.

# Target ver (the workflow's payload). Defaults to current from
# migration.ver.json — the same file repos-schema.ts reads, so the two never
# drift; the instance id is the "v<ver>" label, so re-deploys reuse
# "migration-v<ver>". Override with an arg for back-migrations.
version_file="$(dirname "${BASH_SOURCE[0]}")/../src/db/migration.ver.json"
CURRENT_VER=$(jq -e '.current' "$version_file")
VER="${1:-$CURRENT_VER}"
if [[ ! "$VER" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::migration ver must be a positive integer, got '${VER}'"
  exit 1
fi

INSTANCE_ID="migration-v${VER}"

out=$(wrangler workflows trigger migration "{\"ver\":${VER}}" \
  --id "$INSTANCE_ID" 2>&1) && status=0 || status=$?

if [[ $status -ne 0 ]]; then
  # Already triggered by a prior deploy — instance id taken, nothing to do.
  if grep -qiE "already exists|instance.*exists|duplicate" <<<"$out"; then
    echo "${INSTANCE_ID} already triggered; skipping"
    exit 0
  fi
  echo "::error::failed to trigger ${INSTANCE_ID}"
  echo "$out" >&2
  exit $status
fi

echo "::notice::triggered ${INSTANCE_ID}"
echo "$out"
