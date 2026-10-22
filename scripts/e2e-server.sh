#!/bin/sh
# Starts OpsLens for Playwright on a fresh embedded database seeded with the demo workspace.
set -e
PORT="${E2E_PORT:-3100}"
export DATABASE_URL="pglite://.data/e2e"
export UPLOAD_DIR="${UPLOAD_DIR:-.data/e2e-uploads}"
rm -rf .data/e2e "$UPLOAD_DIR"
npx tsx scripts/seed.ts
if [ "${E2E_MODE:-dev}" = "start" ]; then
  exec npx next start -p "$PORT"
else
  exec npx next dev -p "$PORT"
fi
