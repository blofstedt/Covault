#!/usr/bin/env bash
# ============================================================
# Build a throwaway database from supabase/schema.sql and check it
# ============================================================
# 1. Starts Supabase's own Postgres image in Docker (no network port is
#    opened), so the auth schema, the anon/authenticated/service_role roles
#    and pg_cron are there just as in a real project.
# 2. Applies supabase/schema.sql, stopping at the first error.
# 3. Prints the structure fingerprint (scripts/schema-fingerprint.sql).
#    Compare it with the same query run against the live project — see
#    docs/DATABASE_SETUP.md for what is expected to differ.
# 4. Runs the access-rule checks (scripts/rls-check.sql) and fails if any
#    says FAIL.
# 5. Removes the container.
#
# Needs Docker. Touches nothing but the throwaway container.
#
# COVAULT_PG_IMAGE overrides the image. The default is pinned to the
# Postgres version the live project runs (17.6, checked 2026-10-03); move it
# when the live project is upgraded, so a fresh build is tested on what
# production actually runs.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${COVAULT_PG_IMAGE:-supabase/postgres:17.6.1.178}"
NAME="covault-schema-check-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Starting $IMAGE ..."
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=throwaway "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
# The image runs its own setup scripts after the server first accepts
# connections; wait until the auth schema they create is there.
for _ in $(seq 1 30); do
  [ "$(docker exec "$NAME" psql -U postgres -d postgres -Atc "select to_regclass('auth.users') is not null" 2>/dev/null)" = "t" ] && break
  sleep 2
done

echo "Applying supabase/schema.sql ..."
docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  < "$ROOT/supabase/schema.sql" >/dev/null

echo
echo "Fingerprint (compare with the same query on the live project):"
docker exec -i "$NAME" psql -U postgres -d postgres -At -F' ' \
  < "$ROOT/scripts/schema-fingerprint.sql"

echo
echo "Access-rule checks:"
results="$(docker exec -i "$NAME" psql -U postgres -d postgres -q \
  < "$ROOT/scripts/rls-check.sql" 2>&1 \
  | sed -E 's/^(psql:[^:]*:[0-9]+: )?NOTICE:  //' | grep -E 'PASS|FAIL|ERROR' || true)"
echo "$results"

if [ -z "$results" ] || echo "$results" | grep -qE 'FAIL|ERROR'; then
  echo
  echo "Access-rule checks did not all pass."
  exit 1
fi
echo
echo "All access-rule checks passed."
