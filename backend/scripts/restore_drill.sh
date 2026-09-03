#!/bin/bash
# Restore drill (2026-09-03 data-lifecycle spec §13): prove that a snapshot ZIP restores onto
# a freshly MIGRATED database — real Alembic DDL, real sequences and constraints, the class
# of bug a JSON round trip on the create_all test schema cannot see — then verify it table
# by table. Prints PASS or FAIL; exit 0 / 1 (2 for a usage error).
#
#   backend/scripts/restore_drill.sh <finance-export-*.zip>
#
# Reads the project-root .env like backup_db.sh (DB_HOST, DB_PORT, POSTGRES_USER,
# POSTGRES_PASSWORD; on the dev box export DB_PORT=5433). The scratch database is created
# and dropped through the app's own driver (asyncpg), so this runs identically from the dev
# venv and inside the backend container (README 5.5). PYTHON overrides the interpreter.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ZIP="${1:?usage: restore_drill.sh <snapshot.zip>}"
if [ ! -f "$ZIP" ]; then
  echo "error: $ZIP is not a file" >&2
  exit 2
fi
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"  # absolute: we cd below

ENV_FILE="${BACKEND_DIR}/../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${POSTGRES_USER:-finance}"
DB_PASSWORD="${POSTGRES_PASSWORD:-finance}"
PYTHON="${PYTHON:-python}"
DRILL_DB="finance_drill_$(date +%Y%m%d_%H%M%S)"
ADMIN_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres"

pg_admin() {  # $1 = one SQL statement on the maintenance database
  "$PYTHON" - "$ADMIN_URL" "$1" <<'PYEOF'
import asyncio
import sys

import asyncpg


async def go() -> None:
    conn = await asyncpg.connect(sys.argv[1])
    try:
        await conn.execute(sys.argv[2])
    finally:
        await conn.close()


asyncio.run(go())
PYEOF
}

echo "[drill] creating ${DRILL_DB}"
pg_admin "CREATE DATABASE \"${DRILL_DB}\""
trap 'pg_admin "DROP DATABASE IF EXISTS \"${DRILL_DB}\"" || echo "[drill] WARN: could not drop ${DRILL_DB}"' EXIT

# Point the app at the scratch database; no scheduler, no snapshot job, a throwaway data dir.
export DATABASE_URL="postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DRILL_DB}"
export SCHEDULER_ENABLED=0
export SNAPSHOT_ENABLED=0
DATA_DIR="$(mktemp -d)"
export DATA_DIR
cd "$BACKEND_DIR"

echo "[drill] alembic upgrade head"
"$PYTHON" -m alembic upgrade head >/dev/null
echo "[drill] seed (the admin user the preferences attach to)"
"$PYTHON" -m app.seed >/dev/null
echo "[drill] restore $(basename "$ZIP")"
"$PYTHON" -m app.lifecycle restore "$ZIP"
echo "[drill] verify"
if "$PYTHON" -m app.lifecycle verify "$ZIP"; then
  echo "[drill] PASS"
  exit 0
fi
echo "[drill] FAIL"
exit 1
