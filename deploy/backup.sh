#!/bin/sh
# Database backup for the compose deployment. Run from the repository root on the server, e.g. from cron:
#   15 * * * *  cd /srv/zrouter && sh deploy/backup.sh /srv/zrouter-backups
# Keeps 14 days locally. With RCLONE_REMOTE set (for example RCLONE_REMOTE=gdrive:zrouter-backups) the new file is also
# uploaded with rclone; set that remote up once on the server with `rclone config` (Google Drive, your own account).
# A backup that only exists on the same disk does not survive that disk.
set -eu
DIR="${1:?usage: backup.sh <backup-dir>}"
mkdir -p "$DIR"
OUT="$DIR/zrouter-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Override for other layouts, e.g. COMPOSE_FILE=deploy/compose.tunnel.yml COMPOSE_PROJECT=zrouter DOCKER="sudo docker"
${DOCKER:-docker} compose ${COMPOSE_PROJECT:+-p "$COMPOSE_PROJECT"} -f "${COMPOSE_FILE:-deploy/compose.yml}" --env-file "${ENV_FILE:-deploy/.env}" exec -T db pg_dump -U zrouter -Fc zrouter > "$OUT.tmp"
[ -s "$OUT.tmp" ] || { echo "backup is empty" >&2; rm -f "$OUT.tmp"; exit 1; }
mv "$OUT.tmp" "$OUT"
find "$DIR" -name 'zrouter-*.dump' -mtime +14 -delete
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$OUT" "$RCLONE_REMOTE" || { echo "upload to $RCLONE_REMOTE failed; the local file is kept" >&2; exit 2; }
  rclone delete --min-age 30d "$RCLONE_REMOTE" || true
fi
echo "$OUT"
