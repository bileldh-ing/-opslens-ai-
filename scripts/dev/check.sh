#!/usr/bin/env bash
# Local verification: typecheck + tests (serial, low memory).
set -euo pipefail
cd "$(dirname "$0")/../.."
npx tsc --noEmit
npx vitest run --no-file-parallelism
