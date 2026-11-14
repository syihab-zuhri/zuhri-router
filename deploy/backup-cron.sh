#!/bin/sh
# Cron wrapper: runs backup.sh and reports a failure to the Telegram chat configured in the env file.
# Usage (from the repository/deploy root on the server): sh deploy/backup-cron.sh <backup-dir>
# Takes the same environment as backup.sh (COMPOSE_FILE, COMPOSE_PROJECT, DOCKER, RCLONE_REMOTE, ENV_FILE).
DIR="${1:?usage: backup-cron.sh <backup-dir>}"
ENVF="${ENV_FILE:-deploy/.env}"
OUT=$(sh deploy/backup.sh "$DIR" 2>&1); CODE=$?
echo "$(date -u +%FT%TZ) exit=$CODE $OUT" | tail -3
[ "$CODE" -eq 0 ] && exit 0
TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$ENVF"); CHAT=$(sed -n 's/^TELEGRAM_CHAT_ID=//p' "$ENVF")
[ -n "$TOKEN" ] && [ -n "$CHAT" ] || exit "$CODE"
WHAT="Backup database GAGAL."; [ "$CODE" -eq 2 ] && WHAT="Backup dibuat di server, tetapi unggah ke penyimpanan luar GAGAL."
curl -s -m 15 -o /dev/null "https://api.telegram.org/bot$TOKEN/sendMessage" --data-urlencode "chat_id=$CHAT" --data-urlencode "text=[ZRouter] $WHAT Periksa ~/zrouter-backups/backup.log di server."
exit "$CODE"
