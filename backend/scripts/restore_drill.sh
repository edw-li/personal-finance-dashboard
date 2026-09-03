#!/bin/bash
# Restore drill (2026-09-03 data-lifecycle spec §13): prove that a snapshot ZIP restores onto
# a freshly MIGRATED database — real Alembic DDL, real sequences and constraints, the class
# of bug a JSON round trip on the create_all test schema cannot see — then verify it table
# by table. Prints PASS or FAIL; exit 0 / 1 (2 for a usage error).
#
#   backend/scripts/restore_drill.sh <finance-export-*.zip>
#
# Credentials: DB_HOST, DB_PORT, POSTGRES_USER and POSTGRES_PASSWORD from the project-root
# .env or the environment, exactly like backup_db.sh (on the dev box export DB_PORT=5433);
# whatever they leave unset is filled in from DATABASE_URL, which is all the backend
# container has. The scratch database is created and dropped through the app's own driver
# (asyncpg), so this runs identically from the dev venv and inside the backend container
# (README 5.5). PYTHON overrides the interpreter and may be relative — it is resolved to an
# absolute path before the cd below.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# The header promises exit 2 for a usage error; the parameter-expansion guard this
# replaced (a bare `:?` default on $1) exited 1 instead.
if [ "$#" -ne 1 ]; then
  echo "usage: restore_drill.sh <snapshot.zip>" >&2
  exit 2
fi
ZIP="$1"
if [ ! -f "$ZIP" ]; then
  echo "error: $ZIP is not a file" >&2
  exit 2
fi
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"  # absolute: we cd below

# Resolve the interpreter to an ABSOLUTE path HERE, in the caller's directory: every use of
# it below — including the EXIT trap that drops the scratch database — runs after
# `cd "$BACKEND_DIR"`, where README 5.5's repo-relative PYTHON=backend/.venv/Scripts/python.exe
# no longer exists. That was exit 127 mid-drill plus a leaked finance_drill_* database.
PYTHON_REQUESTED="${PYTHON:-python}"
case "$PYTHON_REQUESTED" in
  */*)
    if [ ! -f "$PYTHON_REQUESTED" ]; then
      echo "error: PYTHON=$PYTHON_REQUESTED is not a file" >&2
      exit 2
    fi
    PYTHON="$(cd "$(dirname "$PYTHON_REQUESTED")" && pwd)/$(basename "$PYTHON_REQUESTED")"
    ;;
  *)
    PYTHON="$(command -v "$PYTHON_REQUESTED" || true)"
    if [ -z "$PYTHON" ]; then
      echo "error: PYTHON=$PYTHON_REQUESTED is not on PATH" >&2
      exit 2
    fi
    ;;
esac

ENV_FILE="${BACKEND_DIR}/../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Inside the backend container DATABASE_URL is the ONLY database config that exists:
# docker-compose.prod.yml passes no POSTGRES_USER/POSTGRES_PASSWORD and backend/.dockerignore
# keeps .env out of the image, so the drill used to fall back to the literal finance:finance
# and fail to connect. Derive the defaults from it instead. Example:
#   DATABASE_URL=postgresql+asyncpg://finance:s%40cret@host.docker.internal:5432/finance
#   -> URL_HOST=host.docker.internal URL_PORT=5432 URL_USER=finance URL_PASSWORD='s@cret'
# shlex.quote is what makes the eval safe for a password with spaces or quotes in it.
if [ -n "${DATABASE_URL:-}" ]; then
  URL_PARTS="$(cd "$BACKEND_DIR" && "$PYTHON" - <<'PYEOF'
import shlex

from app.database import database_url_parts

for key, value in database_url_parts().items():
    print(f"URL_{key.upper()}={shlex.quote(value)}")
PYEOF
  )"
  eval "$URL_PARTS"
fi

# An explicit DB_HOST/DB_PORT/POSTGRES_* still wins: the prod HOST path (outside the
# container) has those in .env and no DATABASE_URL at all.
DB_HOST="${DB_HOST:-${URL_HOST:-localhost}}"
DB_PORT="${DB_PORT:-${URL_PORT:-5432}}"
DB_USER="${POSTGRES_USER:-${URL_USER:-finance}}"
DB_PASSWORD="${POSTGRES_PASSWORD:-${URL_PASSWORD:-finance}}"
DRILL_DB="finance_drill_$(date +%Y%m%d_%H%M%S)"

db_url() {  # $1 = database, $2 = driver -> a DSN whose credentials are properly ENCODED
  ( cd "$BACKEND_DIR" \
      && DRILL_HOST="$DB_HOST" DRILL_PORT="$DB_PORT" DRILL_USER="$DB_USER" \
         DRILL_PASSWORD="$DB_PASSWORD" DRILL_DATABASE="$1" DRILL_DRIVER="$2" \
         "$PYTHON" - <<'PYEOF'
import os

from app.database import database_url_from_parts

print(
    database_url_from_parts(
        {
            "host": os.environ["DRILL_HOST"],
            "port": os.environ["DRILL_PORT"],
            "user": os.environ["DRILL_USER"],
            "password": os.environ["DRILL_PASSWORD"],
            "database": os.environ["DRILL_DATABASE"],
        },
        driver=os.environ["DRILL_DRIVER"],
    )
)
PYEOF
  )
}

ADMIN_URL="$(db_url postgres postgresql)"

# The URL rides an environment variable, never argv: it carries the database password, and
# `ps` on the prod box is readable by every user logged into it.
pg_admin() {  # $1 = one SQL statement on the maintenance database
  DRILL_ADMIN_URL="$ADMIN_URL" DRILL_SQL="$1" "$PYTHON" - <<'PYEOF'
import asyncio
import os

import asyncpg


async def go() -> None:
    conn = await asyncpg.connect(os.environ["DRILL_ADMIN_URL"])
    try:
        await conn.execute(os.environ["DRILL_SQL"])
    finally:
        await conn.close()


asyncio.run(go())
PYEOF
}

fail() {  # every step's failure is a drill FAIL, never a bare set -e exit
  echo "[drill] FAIL"
  exit 1
}

echo "[drill] creating ${DRILL_DB}"
pg_admin "CREATE DATABASE \"${DRILL_DB}\""
cleanup() {  # the scratch database AND the throwaway data dir; neither may outlive the drill
  pg_admin "DROP DATABASE IF EXISTS \"${DRILL_DB}\"" || echo "[drill] WARN: could not drop ${DRILL_DB}"
  if [ -n "${DATA_DIR:-}" ]; then
    rm -rf "$DATA_DIR"
  fi
  return 0  # an EXIT trap that ends non-zero would rewrite the drill's own exit code
}
trap cleanup EXIT

# Point the app at the scratch database; no scheduler, no snapshot job, a throwaway data dir.
DATABASE_URL="$(db_url "$DRILL_DB" postgresql+asyncpg)"
export DATABASE_URL
export SCHEDULER_ENABLED=0
export SNAPSHOT_ENABLED=0
DATA_DIR="$(mktemp -d)"
export DATA_DIR
cd "$BACKEND_DIR"

echo "[drill] alembic upgrade head"
"$PYTHON" -m alembic upgrade head >/dev/null || fail
echo "[drill] seed (the admin user the preferences attach to)"
"$PYTHON" -m app.seed >/dev/null || fail
echo "[drill] restore $(basename "$ZIP")"
"$PYTHON" -m app.lifecycle restore "$ZIP" || fail
echo "[drill] verify"
"$PYTHON" -m app.lifecycle verify "$ZIP" || fail
echo "[drill] PASS"
