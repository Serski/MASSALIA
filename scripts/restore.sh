#!/usr/bin/env bash
# Restore a nightly backup (massalia-YYYY-MM-DD.dump.gz, or an uncompressed
# pg_dump custom-format .dump) into a database. For the restore drill: point it
# at a scratch database first, then at the real one only on purpose.
#
#   scripts/restore.sh <dump.gz|dump> <DATABASE_URL> [--yes]
#
# Fetch the object first, e.g. with the AWS CLI against the same variables the
# worker uses:
#   aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "s3://$BACKUP_S3_BUCKET/massalia-2026-09-05.dump.gz" .
#
# pg_restore --clean --if-exists drops and recreates every object in the archive
# (data included) inside the target database; the database itself must exist.
# Mismatched major versions: pg_restore must be at least the pg_dump version.
set -euo pipefail

usage() {
  echo "usage: $0 <dump.gz|dump> <DATABASE_URL> [--yes]" >&2
  exit 2
}

[ $# -ge 2 ] || usage
DUMP="$1"
TARGET="$2"
CONFIRM="${3:-}"

[ -f "$DUMP" ] || { echo "restore: no such file: $DUMP" >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "restore: pg_restore not found on PATH" >&2; exit 1; }

# Show where this is going, credentials stripped.
TARGET_DESC="$(printf '%s' "$TARGET" | sed -E 's#//[^@/]*@#//***@#')"
echo "restore: $DUMP -> $TARGET_DESC"
if [ "$CONFIRM" != "--yes" ]; then
  read -r -p "This drops and recreates every object in that database. Type the database name to continue: " ANSWER
  DBNAME="${TARGET##*/}"; DBNAME="${DBNAME%%\?*}"
  [ "$ANSWER" = "$DBNAME" ] || { echo "restore: aborted" >&2; exit 1; }
fi

RESTORE=(pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname "$TARGET")
case "$DUMP" in
  *.gz) gunzip -c "$DUMP" | "${RESTORE[@]}" ;;
  *) "${RESTORE[@]}" "$DUMP" ;;
esac

echo "restore: done. Row counts:"
psql "$TARGET" -Atc "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 10" 2>/dev/null || true
