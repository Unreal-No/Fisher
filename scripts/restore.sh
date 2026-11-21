#!/usr/bin/env bash
# Restore a dump into the database in DATABASE_URL. DESTRUCTIVE for that database: run on a new/empty DB first and verify.
# Usage: DATABASE_URL=... ./scripts/restore.sh backups/db-YYYYmmdd-HHMMSS.dump [files.tar.gz] [storage_dir]
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL required}"
DUMP="${1:?dump file required}"
read -r -p "Restore $DUMP into $(echo "$DATABASE_URL" | sed 's#//.*@#//***@#')? type YES: " ok
[ "$ok" = "YES" ] || { echo aborted; exit 1; }
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP"
if [ -n "${2:-}" ]; then mkdir -p "${3:?storage_dir required}" && tar -xzf "$2" -C "$3"; fi
echo "restore ok"
