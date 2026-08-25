#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "/tmp/applik8s-v08-otel.XXXXXX")"
DATA="$WORK/data"
PORT="$((54000 + RANDOM % 10000))"

cleanup() {
  local status=$?
  if [[ -f "$DATA/postmaster.pid" ]]; then
    pg_ctl -D "$DATA" -m fast -w stop >/dev/null
  fi
  rm -rf "$WORK"
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

initdb -D "$DATA" -U postgres -A trust --no-locale >/dev/null
if ! pg_ctl -D "$DATA" -l "$WORK/postgres.log" -o "-p $PORT -h 127.0.0.1 -k $WORK" -w start >/dev/null; then
  sed -n '1,160p' "$WORK/postgres.log" >&2
  exit 1
fi
createuser -h 127.0.0.1 -p "$PORT" -U postgres applik8s_v08_observability
createdb -h 127.0.0.1 -p "$PORT" -U postgres -O applik8s_v08_observability v08_observability

cd "$ROOT"
APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL="postgres://applik8s_v08_observability@127.0.0.1:$PORT/v08_observability" \
TYPEKRO_LOG_LEVEL=fatal \
  bunx vitest run --maxWorkers=1 \
    packages/applik8s/test/transactional-database-postgres-runtime.vertical.test.ts \
    -t 'commits model state, history, transitions, results, and event outbox atomically and replays duplicate results'
