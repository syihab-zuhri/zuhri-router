#!/bin/sh
# Restore a backup into the compose database. DESTROYS the current database content: only for recovery, with the app stopped.
#   sh deploy/restore.sh /srv/zrouter-backups/zrouter-<time>.dump
set -eu
FILE="${1:?usage: restore.sh <dump-file>}"
[ "${CONFIRM:-}" = "restore" ] || { echo "Set CONFIRM=restore to replace the current database with $FILE" >&2; exit 1; }
C="docker compose -f deploy/compose.yml --env-file deploy/.env"
$C stop app
$C exec -T db psql -U zrouter -d postgres -c "drop database if exists zrouter" -c "create database zrouter"
$C exec -T db pg_restore -U zrouter -d zrouter --no-owner --exit-on-error < "$FILE"
$C start app
