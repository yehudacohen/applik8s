#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/applik8s-v06-postgres.XXXXXX")"
DATA="$WORK/data"
PORT="$((55000 + $$ % 1000))"

cleanup() {
  if [[ -f "$DATA/postmaster.pid" ]]; then
    pg_ctl -D "$DATA" -m fast -w stop >/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

initdb -D "$DATA" -U postgres -A trust --no-locale >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -h 127.0.0.1 -k $WORK" -w start >/dev/null
createuser -h 127.0.0.1 -p "$PORT" -U postgres applik8s_v06
createdb -h 127.0.0.1 -p "$PORT" -U postgres -O applik8s_v06 v06_native

cd "$ROOT"
APPLIK8S_V06_POSTGRES_DATABASE_URL="postgres://applik8s_v06@127.0.0.1:$PORT/v06_native" \
TYPEKRO_LOG_LEVEL=fatal \
  bunx vitest run packages/applik8s/test/relational-postgres-live.vertical.test.ts
APPLIK8S_MODELSTORE_SCRIPT_RUNTIME_DATABASE_URL="postgres://applik8s_v06@127.0.0.1:$PORT/v06_native" \
TYPEKRO_LOG_LEVEL=fatal \
  bunx vitest run packages/applik8s/test/model-store-postgres-runtime.vertical.test.ts

bun run scripts/write-v06-datastore-evidence.ts postgres
