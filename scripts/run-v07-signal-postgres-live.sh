#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/applik8s-v07-signal.XXXXXX")"
DATA="$WORK/data"
PORT="$((58000 + $$ % 1000))"

cleanup() {
  if [[ -f "$DATA/postmaster.pid" ]]; then
    pg_ctl -D "$DATA" -m fast -w stop >/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

initdb -D "$DATA" -U postgres -A trust --no-locale >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -h 127.0.0.1 -k $WORK" -w start >/dev/null
createuser -h 127.0.0.1 -p "$PORT" -U postgres applik8s_v07_signal
createdb -h 127.0.0.1 -p "$PORT" -U postgres -O applik8s_v07_signal signal_live

cd "$ROOT"
APPLIK8S_V07_SIGNAL_DATABASE_URL="postgres://applik8s_v07_signal@127.0.0.1:$PORT/signal_live" \
TYPEKRO_LOG_LEVEL=fatal \
  bunx vitest run --config vitest.e2e.config.ts --maxWorkers=1 \
    packages/e2e/test/signal-postgres-live.e2e.test.ts
