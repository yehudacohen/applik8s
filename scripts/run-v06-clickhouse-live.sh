#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="applik8s-v06-clickhouse-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm --name "$CONTAINER" --env CLICKHOUSE_SKIP_USER_SETUP=1 --publish 127.0.0.1::8123 clickhouse/clickhouse-server:25.12.5 >/dev/null
PORT="$(docker port "$CONTAINER" 8123/tcp | awk -F: 'NR == 1 { print $NF }')"
for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:$PORT/ping" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://127.0.0.1:$PORT/ping" >/dev/null

cd "$ROOT"
APPLIK8S_V06_CLICKHOUSE_ENDPOINT="http://127.0.0.1:$PORT" TYPEKRO_LOG_LEVEL=fatal \
  bunx vitest run packages/applik8s/test/projection-clickhouse-live.vertical.test.ts

bun run scripts/write-v06-datastore-evidence.ts clickhouse
