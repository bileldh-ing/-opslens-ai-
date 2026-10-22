#!/bin/sh
# Demo/recording mode: seeds the embedded database (demo workspace + an eval run for the
# Quality page) and starts OpsLens on http://localhost:3000.
#   npm run demo            # reuse existing demo data
#   npm run demo -- --reset # start from a clean demo database
set -e
export DATABASE_URL="${DATABASE_URL:-pglite://.data/demo}"
export UPLOAD_DIR="${UPLOAD_DIR:-.data/demo-uploads}"
export APP_URL="${APP_URL:-http://localhost:3000}"
# Lets the webhook "Test" button reach the local receiver (npm run webhook:receiver).
export ALLOW_PRIVATE_WEBHOOK_TARGETS="${ALLOW_PRIVATE_WEBHOOK_TARGETS:-true}"
if [ "$1" = "--reset" ]; then
  case "$DATABASE_URL" in pglite://*) rm -rf "${DATABASE_URL#pglite://}" "$UPLOAD_DIR" ;; esac
fi
echo "→ migrating + seeding $DATABASE_URL and recording a baseline eval run"
npx tsx evals/run.ts || echo "(eval run reported failures; continuing)"
echo ""
echo "  OpsLens demo → $APP_URL"
echo "  Sign in: demo@opslens.dev / opslens-demo-123"
echo ""
if [ -f .next/BUILD_ID ] && [ "${DEMO_DEV:-0}" != "1" ]; then
  exec npx next start -p 3000
else
  exec npx next dev -p 3000
fi
