#!/bin/bash
# Nightly PostgreSQL backup to OCI Object Storage.
# Uploads via boto3 against OCI's S3-compatible API (the AWS CLI has a
# Content-Length issue with that endpoint). Retention: RETENTION_DAYS.
# Optional encryption (2026-08-31 spec §B3): set BACKUP_PASSPHRASE in .env to pipe the
# gzip through symmetric gpg (AES256) and upload .sql.gz.gpg; unset keeps plaintext
# dumps and prints a one-line warning per run.
# Verify phase (2026-09-03 data-lifecycle spec §8): the uploaded dump is restored into a
# scratch database and three row counts compared; the marker records verified/verify_error.
# Config comes from the project-root .env (see README "Nightly backups").
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load .env from project root if it exists
ENV_FILE="${SCRIPT_DIR}/../../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Database config
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-finance}"
DB_USER="${POSTGRES_USER:-finance}"

# OCI Object Storage config (S3-compatible)
OCI_REGION="${OCI_REGION:?Set OCI_REGION}"
OCI_NAMESPACE="${OCI_NAMESPACE:?Set OCI_NAMESPACE}"
OCI_BUCKET="${OCI_BUCKET_NAME:?Set OCI_BUCKET_NAME}"
OCI_ACCESS_KEY="${OCI_ACCESS_KEY:?Set OCI_ACCESS_KEY}"
OCI_SECRET_KEY="${OCI_SECRET_KEY:?Set OCI_SECRET_KEY}"

S3_ENDPOINT="https://${OCI_NAMESPACE}.compat.objectstorage.${OCI_REGION}.oraclecloud.com"

RETENTION_DAYS=30
TODAY="$(date +%Y-%m-%d)"
EXPIRED="$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y-%m-%d)"

# Encryption is opt-in: with BACKUP_PASSPHRASE everything lands as .sql.gz.gpg; without
# it, today's plaintext path stands — loudly.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  SUFFIX="sql.gz.gpg"
else
  SUFFIX="sql.gz"
  echo "[$(date)] WARN: BACKUP_PASSPHRASE is not set — uploading an UNENCRYPTED dump"
fi
DUMP_FILE="/tmp/${DB_NAME}_${TODAY}.${SUFFIX}"
OBJECT_KEY="backups/${DB_NAME}_${TODAY}.${SUFFIX}"
# Retention sweeps BOTH suffixes regardless of today's mode: a passphrase added (or
# dropped) mid-window must not orphan the other flavor past RETENTION_DAYS.
EXPIRED_KEY_PLAIN="backups/${DB_NAME}_${EXPIRED}.sql.gz"
EXPIRED_KEY_GPG="backups/${DB_NAME}_${EXPIRED}.sql.gz.gpg"

# Run trail (2026-08-31 spec §B3): app_settings['backup_runs'] is a FLAT jsonb ARRAY,
# newest first, trimmed to 10 in the upsert itself — the {"value": ...} envelope is a
# Python readers' convention and this writer is a shell script, exactly like
# backup_status below. The `\$` keeps bash's ancient $[...] arithmetic out of the
# jsonpath literal; the keep-10 window agrees with system.RUNS_LIMIT and
# price_service.REFRESH_RUNS_KEEP — bump all three together. Every interpolated value is machine-generated (date -u, the
# OBJECT_KEY template), so the single-quoted SQL literal cannot be broken by user text.
append_backup_run() {
  local run_json="$1"
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -q \
    -c "INSERT INTO app_settings AS s (key, value) VALUES ('backup_runs', jsonb_build_array('${run_json}'::jsonb)) ON CONFLICT (key) DO UPDATE SET value = jsonb_path_query_array(EXCLUDED.value || (CASE WHEN jsonb_typeof(s.value) = 'array' THEN s.value ELSE '[]'::jsonb END), '\$[0 to 9]')"
}

# Best-effort failure marker: record {ok: false} in the trail so the System card can say
# WHEN the cron last broke, then let set -e end the run as before. || true keeps an
# unreachable database from failing inside its own failure handler.
record_failure() {
  local line="$1"
  append_backup_run "{\"at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"ok\": false, \"error\": \"backup script failed near line ${line}\"}" \
    || true
}
trap 'record_failure $LINENO' ERR

# ── Verify phase helpers (2026-09-03 data-lifecycle spec §8) ─────────────────────────
# Three row counts from the live database at dump time, compared after restoring the
# uploaded dump into a scratch database. The role needs CREATEDB once (README 5.3):
#   sudo -u postgres psql -c "ALTER ROLE finance CREATEDB;"
VERIFY_TABLES="net_worth_snapshots monthly_spending position_transactions"
VERIFY_DB="${DB_NAME}_verify_$$"
VERIFIED=false
VERIFY_ERROR=""
VERIFIED_AT=""

live_counts() {  # $1 = database -> "t1=n1 t2=n2 t3=n3"
  local db="$1" out="" t n
  for t in $VERIFY_TABLES; do
    n="$(PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$db" -Atc "SELECT count(*) FROM ${t}" 2>/dev/null || echo '?')"
    out="${out}${out:+ }${t}=${n}"
  done
  echo "$out"
}

counts_json() {  # "t=n t=n" -> {"t": n, ...}
  local json="" pair
  for pair in $1; do
    json="${json}${json:+, }\"${pair%%=*}\": ${pair#*=}"
  done
  echo "{${json}}"
}

sanitize() {  # the first 300 bytes of a file as one JSON/SQL-safe line
  head -c 300 "$1" | tr -d "\"'\\\\" | tr '\n' ' '
}

decrypt_dump() {  # the SQL text of $DUMP_FILE on stdout, whichever flavor was written
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    gpg --decrypt --batch --quiet --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" "$DUMP_FILE" | gunzip
  else
    gunzip -c "$DUMP_FILE"
  fi
}

LIVE_COUNTS="$(live_counts "$DB_NAME")"

echo "[$(date)] Starting backup of database '${DB_NAME}'..."

# Dump, compress, and (when configured) encrypt. --pinentry-mode loopback is required to
# take the passphrase non-interactively: without it gpg 2.1+ ignores --passphrase under
# --batch and tries to open a pinentry a cron job does not have.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-acl \
    | gzip \
    | gpg --symmetric --batch --yes --cipher-algo AES256 \
        --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
        -o "$DUMP_FILE"
else
  PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-acl \
    | gzip > "$DUMP_FILE"
fi

DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "[$(date)] Dump complete: ${DUMP_FILE} (${DUMP_SIZE})"

# Upload to OCI Object Storage and delete the backups (both flavors) that aged past
# retention
python3 - "$S3_ENDPOINT" "$OCI_REGION" "$OCI_ACCESS_KEY" "$OCI_SECRET_KEY" \
  "$OCI_BUCKET" "$DUMP_FILE" "$OBJECT_KEY" "$EXPIRED_KEY_PLAIN" "$EXPIRED_KEY_GPG" <<'PYEOF'
import sys, boto3
from botocore.config import Config

endpoint, region, access_key, secret_key, bucket, dump_file, obj_key = sys.argv[1:8]
expired_keys = sys.argv[8:10]

# region_name is REQUIRED: without it boto3 signs with us-east-1 in the SigV4
# credential scope, which OCI only tolerates in the tenancy's home region
# ("SignatureDoesNotMatch: The secret key ... could not be found. The region
# must be specified if this is not the home region for the tenancy.")
s3 = boto3.client(
    "s3",
    endpoint_url=endpoint,
    region_name=region,
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
    config=Config(signature_version="s3v4"),
)

s3.upload_file(dump_file, bucket, obj_key)
print(f"Uploaded to s3://{bucket}/{obj_key}")

for expired_key in expired_keys:
    try:
        s3.delete_object(Bucket=bucket, Key=expired_key)
        print(f"Deleted expired backup (if it existed): {expired_key}")
    except Exception:
        print(f"Could not delete expired backup: {expired_key}")
PYEOF

# ── Verify phase: restore the uploaded dump into a scratch database and compare counts ──
# Every step lives inside an `if`, so set -e and the ERR trap never fire from here: a verify
# failure keeps ok:true for the upload (the dump IS in the bucket), records verified:false
# with the reason, and lets the run end with exit 0 so retention still ran.
VERIFY_ERR_FILE="/tmp/verify_err_$$"
if PGPASSWORD="${POSTGRES_PASSWORD}" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$VERIFY_DB" 2>"$VERIFY_ERR_FILE"; then
  if decrypt_dump | PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>"$VERIFY_ERR_FILE"; then
    RESTORED_COUNTS="$(live_counts "$VERIFY_DB")"
    if [ "$RESTORED_COUNTS" = "$LIVE_COUNTS" ]; then
      VERIFIED=true
      VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "[$(date)] Verify OK: ${RESTORED_COUNTS}"
    else
      VERIFY_ERROR="row count mismatch: live ${LIVE_COUNTS} vs restored ${RESTORED_COUNTS}"
    fi
  else
    VERIFY_ERROR="restore into ${VERIFY_DB} failed: $(sanitize "$VERIFY_ERR_FILE")"
  fi
  PGPASSWORD="${POSTGRES_PASSWORD}" dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$VERIFY_DB" \
    || echo "[$(date)] WARN: could not drop ${VERIFY_DB}"
else
  VERIFY_ERROR="createdb failed (grant CREATEDB to ${DB_USER}, README 5.3): $(sanitize "$VERIFY_ERR_FILE")"
fi
rm -f "$VERIFY_ERR_FILE"
[ "$VERIFIED" = true ] || echo "[$(date)] WARN: backup NOT verified — ${VERIFY_ERROR}"

# Record the run for the dashboard (2026-08-25 spec §3 + 2026-08-31 §B3 + 2026-09-03 §8):
# upsert app_settings['backup_status'] as a FLAT JSON object — the {"value": ...} envelope is
# a Python readers' convention — and append this run to app_settings['backup_runs']. The
# verify fields are Optional in BackupStatusOut, so a marker from an older script still
# parses. Best-effort BY DESIGN: the backup itself already succeeded, so a marker failure
# only warns — the `|| echo` keeps set -e (and the ERR trap) out of bookkeeping.
RUN_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DUMP_BYTES="$(stat -c%s "$DUMP_FILE" 2>/dev/null || stat -f%z "$DUMP_FILE")"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then ENCRYPTED=true; else ENCRYPTED=false; fi
if [ "$VERIFIED" = true ]; then
  VERIFY_FIELDS="\"verified\": true, \"verified_at\": \"${VERIFIED_AT}\", \"row_counts\": $(counts_json "$LIVE_COUNTS")"
else
  VERIFY_FIELDS="\"verified\": false, \"verify_error\": \"${VERIFY_ERROR}\""
fi
BACKUP_MARKER="{\"last_success_at\": \"${RUN_AT}\", \"object_key\": \"${OBJECT_KEY}\", \"size\": \"${DUMP_SIZE}\", \"size_bytes\": ${DUMP_BYTES}, \"encrypted\": ${ENCRYPTED}, \"retention_days\": ${RETENTION_DAYS}, ${VERIFY_FIELDS}}"
{
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    -q \
    -c "INSERT INTO app_settings (key, value) VALUES ('backup_status', '${BACKUP_MARKER}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" \
  && append_backup_run "{\"at\": \"${RUN_AT}\", \"ok\": true, \"object\": \"${OBJECT_KEY}\", \"verified\": ${VERIFIED}}"
} || echo "[$(date)] WARN: could not record backup_status/backup_runs in app_settings — the backup itself succeeded"

# Clean up local dump
rm -f "$DUMP_FILE"
echo "[$(date)] Backup complete."
