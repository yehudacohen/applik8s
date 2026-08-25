#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "/tmp/applik8s-v08-observed-process.XXXXXX")"
DATA="$WORK/postgres"
POSTGRES_PORT="$((44000 + RANDOM % 8000))"
NATS_CONTAINER="applik8s-v08-observed-$RANDOM-$$"
NATS_PORT=""

cleanup() {
  local status=$?
  local cleanup_failed=0
  if [[ -f "$DATA/postmaster.pid" ]]; then
    if ! pg_ctl -D "$DATA" -m fast -w stop >/dev/null; then
      echo "Failed to stop disposable PostgreSQL cluster $DATA." >&2
      cleanup_failed=1
    fi
  fi
  if docker inspect "$NATS_CONTAINER" >/dev/null 2>&1; then
    if ! docker stop "$NATS_CONTAINER" >/dev/null; then
      echo "Failed to stop disposable NATS container $NATS_CONTAINER." >&2
      cleanup_failed=1
    fi
    for _ in $(seq 1 100); do
      if ! docker inspect "$NATS_CONTAINER" >/dev/null 2>&1; then
        break
      fi
      sleep 0.05
    done
    if docker inspect "$NATS_CONTAINER" >/dev/null 2>&1; then
      echo "Disposable NATS container $NATS_CONTAINER still exists after cleanup." >&2
      cleanup_failed=1
    fi
  fi
  rm -rf "$WORK"
  if [[ -e "$WORK" ]]; then
    echo "Disposable process workspace $WORK still exists after cleanup." >&2
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
createuser -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres applik8s_v08_process
createdb -h 127.0.0.1 -p "$POSTGRES_PORT" -U postgres -O applik8s_v08_process v08_observability_process

docker run --rm --detach --name "$NATS_CONTAINER" --publish 127.0.0.1::4222 nats:2.14.0-alpine -js >/dev/null
for _ in $(seq 1 100); do
  NATS_PORT="$(docker port "$NATS_CONTAINER" 4222/tcp 2>/dev/null | head -n 1 | sed 's/.*://')"
  if [[ "$NATS_PORT" =~ ^[0-9]+$ ]]; then
    break
  fi
  sleep 0.05
done
if [[ ! "$NATS_PORT" =~ ^[0-9]+$ ]]; then
  docker logs "$NATS_CONTAINER" >&2 || true
  echo "NATS did not publish a local client port." >&2
  exit 1
fi

cd "$ROOT"
APPLIK8S_V08_OBSERVABILITY_PROCESS_DATABASE_URL="postgres://applik8s_v08_process@127.0.0.1:$POSTGRES_PORT/v08_observability_process" \
APPLIK8S_V08_OBSERVABILITY_PROCESS_NATS_URL="nats://127.0.0.1:$NATS_PORT" \
TYPEKRO_LOG_LEVEL=fatal \
  bunx vitest run --config vitest.e2e.config.ts --maxWorkers=1 \
    packages/e2e/test/v08-observability-generated-process-live.e2e.test.ts
