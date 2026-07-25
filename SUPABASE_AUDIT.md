# Supabase schema notes

**Status:** `supabase/schema.sql` was reconciled to production — it is now
introspected from the live database and is the canonical source of truth for
the schema. The large schema-vs-repo divergence this document used to catalog
no longer exists, so the old audit was removed. What remains below is the
still-relevant context an AI (or human) needs before touching data access.

## Canonical schema

- `supabase/schema.sql` — introspected from production; matches the live DB.
  Defines the 5 live tables: `settings`, `transactions`, `budgets`,
  `overrides`, `banks`. (See `CLAUDE.md` for the per-table summary.)
- `supabase/migrations/*.sql` — incremental production changes. Dead RPCs and
  RLS were already cleaned up (`2026_cleanup_dead_rpcs.sql`,
  `2026_verify_rls.sql`).
- **Drift check:** `scripts/check_schema_drift.sh` (and `.py`) compares a live
  introspection against `schema.sql` and fails CI if they diverge. Update
  `schema.sql` whenever you change the DB.

## Load-bearing quirks — do NOT "clean these up"

These are intentional and keep the app working across historical rows and the
one remaining drift point (`pending_transactions`). See `CLAUDE.md` and
`SETUP.md` for the same guidance.

- **Defensive column-name fallbacks** in `lib/hooks/useDataLoading.ts` and
  `lib/hooks/transactionMappers.ts`: `user_uuid`/`user_id`,
  `Visible`/`visible`, `Budget`/`budget`, `recur`/`recurrence`. Historical
  rows and mixed-case columns rely on these.
- **`pending_transactions` is intentionally absent from `schema.sql`.** The
  capture pipeline reads/writes it, but `loadPendingTransactions` treats a
  404 as an empty queue, so the app tolerates its absence.
- **`banks`** has a hardcoded fallback list in `lib/bankingApps.ts` if the
  table read fails.
