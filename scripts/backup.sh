#!/usr/bin/env bash
# Daily backup: PostgreSQL custom-format dump + private file storage. Keep N days.
# Usage: DATABASE_URL=... STORAGE_DIR=./apps/api/storage ./scripts/backup.sh [backup_dir] [keep_days]
set -euo pipefail
DIR="${1:-./backups}"; KEEP="${2:-14}"; TS="$(date +%Y%m%d-%H%M%S)"
: "${DATABASE_URL:?DATABASE_URL required}"
mkdir -p "$DIR"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$DIR/db-$TS.dump"
if [ -n "${STORAGE_DIR:-}" ] && [ -d "$STORAGE_DIR" ]; then tar -czf "$DIR/files-$TS.tar.gz" -C "$STORAGE_DIR" .; fi
find "$DIR" -type f \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP" -delete
echo "backup ok: $DIR/db-$TS.dump"
