#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "/tmp/applik8s-v07-http.XXXXXX")"
DATA="$WORK/data"
PORT="$((57000 + $$ % 1000))"

cleanup() {
  if [[ -f "$DATA/postmaster.pid" ]]; then
    pg_ctl -D "$DATA" -m fast -w stop >/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

initdb -D "$DATA" -U postgres -A trust --no-locale >/dev/null
if ! pg_ctl -D "$DATA" -l "$WORK/postgres.log" \
  -o "-p $PORT -h 127.0.0.1 -k $WORK" -w start >/dev/null; then
  cat "$WORK/postgres.log"
  exit 1
fi
createuser -h 127.0.0.1 -p "$PORT" -U postgres applik8s_v07_http
createdb -h 127.0.0.1 -p "$PORT" -U postgres -O applik8s_v07_http function_native_http

cd "$ROOT"
APPLIK8S_V07_FUNCTION_NATIVE_HTTP_DATABASE_URL="postgres://applik8s_v07_http@127.0.0.1:$PORT/function_native_http" \
TYPEKRO_LOG_LEVEL=fatal \
  bunx vitest run --config vitest.e2e.config.ts --maxWorkers=1 \
    packages/e2e/test/function-native-http-live.e2e.test.ts
