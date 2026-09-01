#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/applik8s-v09-runtime.XXXXXX")"
DATA="$WORK/data"
PORT="$((54000 + $$ % 1000))"
SUITE="${1:-}"

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

for command in initdb pg_ctl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "PostgreSQL command $command is required for the v0.9 $SUITE live gate." >&2
    exit 1
  fi
done

case "$SUITE" in
  managed-models)
    TESTS=(
      packages/applik8s/test/application-managed-model-runtime.vertical.test.ts
      packages/compiler/test/application-managed-models.vertical.test.ts
      packages/runtime-kubernetes/test/managed-model-runtime.vertical.test.ts
      packages/runtime-postgres/test/managed-model-store.vertical.test.ts
    )
    ;;
  query-batching)
    TESTS=(
      packages/applik8s/test/application-query-batching.vertical.test.ts
      packages/runtime-postgres/test/query-batch.vertical.test.ts
    )
    ;;
  sagas)
    TESTS=(
      packages/applik8s/test/application-sagas.vertical.test.ts
      packages/runtime-postgres/test/saga-store.vertical.test.ts
    )
    ;;
  *)
    echo "Usage: $0 managed-models|query-batching|sagas" >&2
    exit 2
    ;;
esac

initdb -D "$DATA" -U postgres -A trust --no-locale >/dev/null
if ! pg_ctl -D "$DATA" -l "$WORK/postgres.log" -o "-p $PORT -h 127.0.0.1 -k $WORK" -w start >/dev/null; then
  sed -n '1,160p' "$WORK/postgres.log" >&2
  exit 1
fi

cd "$ROOT"
APPLIK8S_JOB_POSTGRES_URL="postgres://postgres@127.0.0.1:$PORT/postgres" \
  bunx vitest run --maxWorkers=1 "${TESTS[@]}"
