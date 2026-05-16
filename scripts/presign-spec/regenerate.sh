#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

bun install --cwd scripts/presign-spec

OUT="${1:-src/storage/presign.spec.json}"
bun run scripts/presign-spec/regenerate.ts -- "$OUT"
