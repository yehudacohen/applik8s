#!/usr/bin/env bash
set -euo pipefail

POSTGRES_CONTAINER="applik8s-v041-postgres-$$"
NATS_CONTAINER="applik8s-v041-nats-$$"
POSTGRES_PORT="${APPLIK8S_BENCH_POSTGRES_PORT:-55432}"
NATS_PORT="${APPLIK8S_BENCH_NATS_PORT:-54223}"

cleanup() {
  docker stop "$POSTGRES_CONTAINER" "$NATS_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm --detach --name "$POSTGRES_CONTAINER" \
  --env POSTGRES_USER=applik8s_benchmark \
  --env POSTGRES_PASSWORD=applik8s_benchmark \
  --env POSTGRES_DB=applik8s_benchmark \
  --publish "127.0.0.1:${POSTGRES_PORT}:5432" \
  postgres:16-alpine >/dev/null

docker run --rm --detach --name "$NATS_CONTAINER" \
  --publish "127.0.0.1:${NATS_PORT}:4222" \
  nats:2.14.0-alpine --jetstream >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$POSTGRES_CONTAINER" pg_isready --username applik8s_benchmark --dbname applik8s_benchmark >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
docker exec "$POSTGRES_CONTAINER" pg_isready --username applik8s_benchmark --dbname applik8s_benchmark >/dev/null

for _ in $(seq 1 60); do
  if docker logs "$NATS_CONTAINER" 2>&1 | grep -q 'Server is ready'; then
    break
  fi
  sleep 0.25
done
docker logs "$NATS_CONTAINER" 2>&1 | grep -q 'Server is ready'

APPLIK8S_BENCH_DATABASE_URL="postgres://applik8s_benchmark:applik8s_benchmark@127.0.0.1:${POSTGRES_PORT}/applik8s_benchmark" \
APPLIK8S_BENCH_NATS_URL="nats://127.0.0.1:${NATS_PORT}" \
bun run scripts/benchmark-v041.ts --record
