#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/applik8s-v09-research.XXXXXX")"
DATA="$WORK/data"
PORT="$((53000 + $$ % 1000))"

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

for command in initdb pg_ctl createuser createdb; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "PostgreSQL command $command is required for the v0.9 research evidence live gate." >&2
    exit 1
  fi
done

initdb -D "$DATA" -U postgres -A trust --no-locale >/dev/null
if ! pg_ctl -D "$DATA" -l "$WORK/postgres.log" -o "-p $PORT -h 127.0.0.1 -k $WORK" -w start >/dev/null; then
  sed -n '1,160p' "$WORK/postgres.log" >&2
  exit 1
fi
createuser -h 127.0.0.1 -p "$PORT" -U postgres applik8s_v09_research
createdb -h 127.0.0.1 -p "$PORT" -U postgres -O applik8s_v09_research research_evidence

cd "$ROOT"
APPLIK8S_V09_RESEARCH_DATABASE_URL="postgres://applik8s_v09_research@127.0.0.1:$PORT/research_evidence" \
  bunx vitest run --maxWorkers=1 \
    packages/research/test/research-evidence-postgres-live.vertical.test.ts
