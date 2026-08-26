#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "/tmp/applik8s-v08-agent-process.XXXXXX")"
DATA="$WORK/postgres"
POSTGRES_PORT="$((44000 + RANDOM % 8000))"

cleanup() {
  local status=$?
  local cleanup_failed=0
  if [[ -f "$DATA/postmaster.pid" ]]; then
    if ! pg_ctl -D "$DATA" -m fast -w stop >/dev/null; then
      echo "Failed to stop disposable PostgreSQL cluster $DATA." >&2
      cleanup_failed=1
    fi
  fi
  rm -rf "$WORK"
  if [[ -e "$WORK" ]]; then
    echo "Disposable agent-process workspace $WORK still exists after cleanup." >&2
    cleanup_failed=1
  fi
  if [[ "$status" -eq 0 && "$cleanup_failed" -ne 0 ]]; then
    status=1
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

initdb -D "$DATA" -U postgres -A trust --no-locale >/dev/null
if ! pg_ctl -D "$DATA" -l "$WORK/postgres.log" -o "-p $POSTGRES_PORT -h 127.0.0.1 -k $WORK" -w start >/dev/null; then
  sed -n '1,160p' "$WORK/postgres.log" >&2
  exit 1
fi
createuser -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres applik8s_v08_agent
createdb -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres -O applik8s_v08_agent v08_observability_agent

cd "$ROOT"
APPLIK8S_V08_OBSERVABILITY_AGENT_DATABASE_URL="postgres://applik8s_v08_agent@127.0.0.1:$POSTGRES_PORT/v08_observability_agent" \
TYPEKRO_LOG_LEVEL=fatal \
  bunx vitest run --config vitest.e2e.config.ts --maxWorkers=1 \
    packages/e2e/test/v08-observability-agent-process-live.e2e.test.ts
