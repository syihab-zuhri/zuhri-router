#!/bin/sh
# Database backup for the compose deployment. Run from the repository root on the server, e.g. from cron:
#   15 * * * *  cd /srv/zrouter && sh deploy/backup.sh /srv/zrouter-backups
# Keeps 14 days locally. Copy the files off the server as well: a backup on the same disk does not survive that disk.
set -eu
DIR="${1:?usage: backup.sh <backup-dir>}"
mkdir -p "$DIR"
OUT="$DIR/zrouter-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose -f deploy/compose.yml --env-file deploy/.env exec -T db pg_dump -U zrouter -Fc zrouter > "$OUT.tmp"
[ -s "$OUT.tmp" ] || { echo "backup is empty" >&2; rm -f "$OUT.tmp"; exit 1; }
mv "$OUT.tmp" "$OUT"
find "$DIR" -name 'zrouter-*.dump' -mtime +14 -delete
echo "$OUT"
