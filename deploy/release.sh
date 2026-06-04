#!/usr/bin/env bash
#
# Release tasks: apply DB migrations and ensure the app-role password.
# Idempotent — safe to run on every deploy. Requires DATABASE_URL (the owner/admin
# connection) and, in production, ANNAPURNA_APP_DB_PASSWORD.
#
set -euo pipefail

echo "▶ Applying database migrations…"
python -m annapurna.migrations

if [ -n "${ANNAPURNA_APP_DB_PASSWORD:-}" ]; then
  echo "▶ Ensuring the application role password…"
  # :'pw' safely quotes the value, whatever characters it contains.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -v pw="$ANNAPURNA_APP_DB_PASSWORD" \
    -c "ALTER ROLE annapurna_app WITH LOGIN PASSWORD :'pw'"
fi

echo "✓ Release tasks complete."
