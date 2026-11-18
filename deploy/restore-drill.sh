#!/bin/sh
# Non-destructive backup restore drill: restores a custom-format dump into a disposable zrouter_drill_* database,
# runs server/scripts/check-invariants.ts, compares migration count with server/migrations/, prints key row counts,
# and always drops the disposable database on exit.
#
# Usage (from repo root):
#   Local container (router-spike-pg on 127.0.0.1:55432):
#     sh deploy/restore-drill.sh /path/to/backup.dump
#   Compose (VPS):
#     COMPOSE_FILE=deploy/compose.tunnel.yml COMPOSE_PROJECT=zrouter DOCKER="sudo docker" sh deploy/restore-drill.sh /path/to/backup.dump
set -eu

FILE="${1:?usage: restore-drill.sh <dump-file>}"
if [ ! -f "$FILE" ] || [ ! -s "$FILE" ]; then
  echo "restore-drill: dump file missing or empty: $FILE" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

DOCKER="${DOCKER:-docker}"
ENV_FILE="${ENV_FILE:-deploy/.env}"
DRILL_DB="${DRILL_DB:-zrouter_drill_$(date -u +%Y%m%dT%H%M%SZ)_$$}"

# Safety guard: refuse any database name that does not strictly start with zrouter_drill_.
case "$DRILL_DB" in
  zrouter_drill_?*) ;;
  *)
    echo "restore-drill: refusing to run; DRILL_DB ($DRILL_DB) must start with zrouter_drill_" >&2
    exit 1
    ;;
esac
case "$DRILL_DB" in
  *[!A-Za-z0-9_]*)
    echo "restore-drill: invalid characters in DRILL_DB ($DRILL_DB); only [A-Za-z0-9_] allowed" >&2
    exit 1
    ;;
esac

# Choose mode: compose on VPS when COMPOSE_FILE/COMPOSE_PROJECT is set, or ENV_FILE exists without explicit DB_CONTAINER;
# otherwise local container router-spike-pg.
MODE="local"
RESOLVED_ENV_FILE=""
if [ -f "$ENV_FILE" ]; then
  RESOLVED_ENV_FILE="$ENV_FILE"
elif [ -f "$REPO_ROOT/$ENV_FILE" ]; then
  RESOLVED_ENV_FILE="$REPO_ROOT/$ENV_FILE"
fi

if [ -n "${COMPOSE_FILE:-}" ] || [ -n "${COMPOSE_PROJECT:-}" ]; then
  MODE="compose"
elif [ -z "${DB_CONTAINER:-}" ] && [ -n "$RESOLVED_ENV_FILE" ]; then
  MODE="compose"
fi

if [ "$MODE" = "compose" ]; then
  COMPOSE_FILE_EFF="${COMPOSE_FILE:-deploy/compose.yml}"
  PGUSER_EFF="${PGUSER:-zrouter}"
  DB_CREATED=0
else
  DB_CONTAINER_EFF="${DB_CONTAINER:-router-spike-pg}"
  PGUSER_EFF="${PGUSER:-postgres}"
  PGPASSWORD_EFF="${PGPASSWORD:-spike_local_only}"
  PGHOST_EFF="${PGHOST:-127.0.0.1}"
  PGPORT_EFF="${PGPORT:-55432}"
  DB_CREATED=0
fi

compose_exec() {
  if [ -n "${COMPOSE_PROJECT:-}" ] && [ -n "$RESOLVED_ENV_FILE" ]; then
    "$DOCKER" compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE_EFF" --env-file "$RESOLVED_ENV_FILE" exec -T "$@"
  elif [ -n "${COMPOSE_PROJECT:-}" ]; then
    "$DOCKER" compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE_EFF" exec -T "$@"
  elif [ -n "$RESOLVED_ENV_FILE" ]; then
    "$DOCKER" compose -f "$COMPOSE_FILE_EFF" --env-file "$RESOLVED_ENV_FILE" exec -T "$@"
  else
    "$DOCKER" compose -f "$COMPOSE_FILE_EFF" exec -T "$@"
  fi
}

run_psql() {
  TARGET_DB="$1"
  shift
  if [ "$MODE" = "compose" ]; then
    compose_exec db psql -U "$PGUSER_EFF" -d "$TARGET_DB" -v ON_ERROR_STOP=1 "$@"
  else
    "$DOCKER" exec -i "$DB_CONTAINER_EFF" psql -U "$PGUSER_EFF" -d "$TARGET_DB" -v ON_ERROR_STOP=1 "$@"
  fi
}

cleanup() {
  set +e
  trap - EXIT HUP INT TERM
  if [ "${DB_CREATED:-0}" -eq 1 ]; then
    echo "restore-drill: dropping disposable database $DRILL_DB ..." >&2
    run_psql postgres -c "drop database if exists \"$DRILL_DB\" with (force)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT HUP INT TERM

echo "restore-drill: mode=$MODE target_db=$DRILL_DB dump=$FILE"
run_psql postgres -c "create database \"$DRILL_DB\"" >/dev/null
DB_CREATED=1

echo "restore-drill: running pg_restore --no-owner --exit-on-error ..."
if [ "$MODE" = "compose" ]; then
  compose_exec db pg_restore -U "$PGUSER_EFF" -d "$DRILL_DB" --no-owner --exit-on-error < "$FILE"
else
  "$DOCKER" exec -i "$DB_CONTAINER_EFF" pg_restore -U "$PGUSER_EFF" -d "$DRILL_DB" --no-owner --exit-on-error < "$FILE"
fi

echo "restore-drill: running check-invariants.ts ..."
set +e
if [ "$MODE" = "compose" ]; then
  INV_OUT=$(compose_exec -e DRILL_DB="$DRILL_DB" app node -e "
    const { spawnSync } = require('node:child_process');
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = '/' + process.env.DRILL_DB;
    const res = spawnSync(process.execPath, ['scripts/check-invariants.ts'], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: 'utf8',
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.status ?? 1);
  " 2>&1)
  INV_RC=$?
else
  DRILL_URL="postgres://${PGUSER_EFF}:${PGPASSWORD_EFF}@${PGHOST_EFF}:${PGPORT_EFF}/${DRILL_DB}"
  INV_OUT=$(DATABASE_URL="$DRILL_URL" node "$REPO_ROOT/server/scripts/check-invariants.ts" 2>&1)
  INV_RC=$?
fi
set -e

echo "restore-drill: check-invariants output: $INV_OUT"
if [ "$INV_RC" -ne 0 ]; then
  echo "restore-drill: FAIL - invariant check exited with $INV_RC" >&2
  exit 1
fi

MIG_DIR="$REPO_ROOT/server/migrations"
if [ -d "$MIG_DIR" ]; then
  REPO_MIGRATIONS=$(find "$MIG_DIR" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d '[:space:]')
elif [ "$MODE" = "compose" ]; then
  REPO_MIGRATIONS=$(compose_exec app sh -c 'ls -1 /app/server/migrations/*.sql | wc -l' | tr -d '[:space:]')
else
  echo "restore-drill: FAIL - migrations directory not found: $MIG_DIR" >&2
  exit 1
fi
DB_MIGRATIONS=$(run_psql "$DRILL_DB" -At -c "select count(*) from schema_migration" | tr -d '[:space:]')

ROW_COUNTS=$(run_psql "$DRILL_DB" -At -c "select 'tenants=' || (select count(*) from tenant) || ' users=' || (select count(*) from app_user) || ' accounts=' || (select count(*) from ledger_account) || ' entries=' || (select count(*) from ledger_entry) || ' vouchers=' || (select count(*) from voucher) || ' redemptions=' || (select count(*) from redemption) || ' requests=' || (select count(*) from request) || ' active_holds=' || (select count(*) from hold where status='ACTIVE') || ' audit_events=' || (select count(*) from audit_event)")

echo "restore-drill: row counts: $ROW_COUNTS"
echo "restore-drill: migrations db=$DB_MIGRATIONS repo=$REPO_MIGRATIONS"

if [ "$REPO_MIGRATIONS" -eq 0 ] || [ "$DB_MIGRATIONS" != "$REPO_MIGRATIONS" ]; then
  echo "restore-drill: FAIL - migration count mismatch (db=$DB_MIGRATIONS, repo=$REPO_MIGRATIONS)" >&2
  exit 1
fi

echo "restore-drill: PASS"
