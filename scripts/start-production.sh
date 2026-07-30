#!/usr/bin/env bash
# Local production boot — build, reindex, check logistics, start.
# Usage: bash scripts/start-production.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Building packages..."
npm run build

echo "==> Reindexing knowledge..."
npm run reindex

echo "==> Checking logistics API..."
npm run check:acocam-api || echo "WARN: Logistics API check failed — tracking/quotes may fail."

if [[ ! -f .env ]]; then
  echo "WARN: No .env — copy env.production.example to .env and set live keys."
fi

echo "==> Starting chatbot API..."
npm run start
