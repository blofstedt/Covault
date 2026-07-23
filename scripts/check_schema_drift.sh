#!/usr/bin/env bash
# ============================================================
# Schema drift check
# ============================================================
# Compares the live Supabase project's schema against
# supabase/schema.sql and fails CI if they don't match.
#
# Two modes:
#   REST-ONLY (default)  — queries the live DB's PostgREST
#     introspection endpoint. Detects drift in: tables, columns,
#     types, nullability, enum members, RPCs.
#     DOES NOT detect: RLS policies, triggers, CHECK constraints,
#     indexes, foreign keys.
#     Required env: SUPABASE_URL, SUPABASE_SECRET_KEY
#
#   FULL — additionally calls `supabase db pull` to a temp
#     directory and diffs the pulled migration against the
#     committed migration history.
#     Required env: + SUPABASE_DB_PASSWORD (or `--db-url`)
#     Required CLI: supabase
#
# Usage:
#   ./scripts/check_schema_drift.sh                  # REST-only
#   ./scripts/check_schema_drift.sh --full           # REST + supabase db pull
#   ./scripts/check_schema_drift.sh --project REF    # custom project ref
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ── Args ──
FULL_MODE=0
PROJECT_REF="${SUPABASE_PROJECT_REF:-xqleyxrftyehodksashu}"
SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
SUPABASE_KEY="${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)        FULL_MODE=1; shift ;;
    --project)     PROJECT_REF="$2"; shift 2 ;;
    --url)         SUPABASE_URL="$2"; shift 2 ;;
    --key)         SUPABASE_KEY="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$SUPABASE_KEY" ]]; then
  echo "❌ SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set" >&2
  exit 2
fi

# ── Step 1: pull live schema via PostgREST introspection ──
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
LIVE_SCHEMA="$TMPDIR/live_schema.json"

echo "→ Fetching live schema from $SUPABASE_URL ..."
HTTP_CODE=$(curl -sS -o "$LIVE_SCHEMA" -w "%{http_code}" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  "$SUPABASE_URL/rest/v1/")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "❌ Failed to fetch live schema: HTTP $HTTP_CODE" >&2
  head -c 500 "$LIVE_SCHEMA" >&2
  echo >&2
  exit 1
fi

# ── Step 2: compare table/column/enum shape ──
python3 "$SCRIPT_DIR/check_schema_drift.py" \
  --live "$LIVE_SCHEMA" \
  --expected "$ROOT_DIR/supabase/schema.sql" \
  --project "$PROJECT_REF"

PYTHON_EXIT=$?

# ── Step 3: full mode — also run supabase db pull ──
if [[ $FULL_MODE -eq 1 ]]; then
  echo ""
  echo "→ Full mode: running supabase db pull ..."
  PULL_DIR="$TMPDIR/pull"
  mkdir -p "$PULL_DIR/supabase"

  # Build connection string from env if --db-url not provided
  if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
    DB_URL="$SUPABASE_DB_URL"
  elif [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
    # Pooler URL: postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
    # Region must be supplied separately via SUPABASE_DB_REGION.
    DB_REGION="${SUPABASE_DB_REGION:-us-east-1}"
    DB_URL="postgresql://postgres.${PROJECT_REF}:${SUPABASE_DB_PASSWORD}@aws-0-${DB_REGION}.pooler.supabase.com:5432/postgres"
  else
    echo "❌ --full requires SUPABASE_DB_PASSWORD (+ optional SUPABASE_DB_REGION) or SUPABASE_DB_URL" >&2
    exit 2
  fi

  if ! command -v supabase >/dev/null 2>&1; then
    echo "❌ --full requires the supabase CLI (https://supabase.com/docs/guides/cli)" >&2
    exit 2
  fi

  # config.toml with placeholder project name so `supabase db pull` doesn't
  # try to read a linked project
  cat > "$PULL_DIR/supabase/config.toml" <<EOF
project_id = "$PROJECT_REF"
EOF

  (
    cd "$PULL_DIR"
    if ! supabase db pull --db-url "$DB_URL" --schema public 2>"$TMPDIR/pull.err" >"$TMPDIR/pull.out"; then
      echo "❌ supabase db pull failed:" >&2
      cat "$TMPDIR/pull.err" >&2
      exit 1
    fi
  )

  # The pulled migration is the most recent file in supabase/migrations/.
  # Diff it against the committed canonical schema.sql.
  PULLED=$(find "$PULL_DIR/supabase/migrations" -type f -name "*.sql" 2>/dev/null | sort | tail -1 || true)

  if [[ -z "$PULLED" ]]; then
    echo "⚠️  supabase db pull produced no migration file (empty schema?). Skipping diff."
  else
    echo "→ Diffing pulled migration against committed schema.sql ..."
    # Strip the timestamp prefix from the pulled file to make diff readable
    NORMALIZED="$TMPDIR/pulled_normalized.sql"
    FILENAME=$(basename "$PULLED")
    STRIPPED="${FILENAME#[0-9]*_}"
    {
      echo "-- Normalized from: $FILENAME"
      cat "$PULLED"
    } > "$NORMALIZED"

    if diff -u "$NORMALIZED" "$ROOT_DIR/supabase/schema.sql" >"$TMPDIR/diff.out"; then
      echo "✅ Pulled schema matches supabase/schema.sql (after normalization)"
    else
      echo "❌ Pulled live schema diverges from supabase/schema.sql:" >&2
      cat "$TMPDIR/diff.out" >&2
      PYTHON_EXIT=1
    fi
  fi
fi

if [[ $PYTHON_EXIT -ne 0 ]]; then
  echo ""
  echo "❌ Schema drift detected. Update supabase/schema.sql to match live, or run the appropriate migration."
  exit 1
fi

echo ""
echo "✅ No schema drift detected."
