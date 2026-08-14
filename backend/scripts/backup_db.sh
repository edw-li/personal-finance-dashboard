#!/bin/bash
# Nightly PostgreSQL backup to OCI Object Storage.
# Uploads via boto3 against OCI's S3-compatible API (the AWS CLI has a
# Content-Length issue with that endpoint). Retention: RETENTION_DAYS.
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
DUMP_FILE="/tmp/${DB_NAME}_${TODAY}.sql.gz"
OBJECT_KEY="backups/${DB_NAME}_${TODAY}.sql.gz"
EXPIRED_KEY="backups/${DB_NAME}_${EXPIRED}.sql.gz"

echo "[$(date)] Starting backup of database '${DB_NAME}'..."

# Dump and compress
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-acl \
  | gzip > "$DUMP_FILE"

DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "[$(date)] Dump complete: ${DUMP_FILE} (${DUMP_SIZE})"

# Upload to OCI Object Storage and delete the backup that aged past retention
python3 - "$S3_ENDPOINT" "$OCI_REGION" "$OCI_ACCESS_KEY" "$OCI_SECRET_KEY" \
  "$OCI_BUCKET" "$DUMP_FILE" "$OBJECT_KEY" "$EXPIRED_KEY" <<'PYEOF'
import sys, boto3
from botocore.config import Config

endpoint, region, access_key, secret_key, bucket, dump_file, obj_key, expired_key = sys.argv[1:9]

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

try:
    s3.delete_object(Bucket=bucket, Key=expired_key)
    print(f"Deleted expired backup: {expired_key}")
except Exception:
    print(f"No expired backup to delete: {expired_key}")
PYEOF

# Clean up local dump
rm -f "$DUMP_FILE"
echo "[$(date)] Backup complete."
