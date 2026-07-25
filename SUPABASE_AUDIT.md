# Supabase schema notes

**Status:** `supabase/schema.sql` is the intended source of truth, but it is
NOT currently a verified match for production. A static audit of the app's
reads and writes against the file found gaps (listed under "Known gaps"
below). Treat `schema.sql` as "mostly right, with known holes" until someone
runs `scripts/introspect_schema.sql` against the live project and reconciles
it. What follows is the context needed before touching data access.

## Canonical schema

- `supabase/schema.sql` — introspected from production; matches the live DB.
  Defines the 5 live tables: `settings`, `transactions`, `budgets`,
  `overrides`, `banks`. (See `CLAUDE.md` for the per-table summary.)
- `supabase/migrations/*.sql` — incremental production changes. Dead RPCs and
  RLS were already cleaned up (`2026_cleanup_dead_rpcs.sql`,
  `2026_verify_rls.sql`).
- **Drift check:** `scripts/check_schema_drift.sh` (and `.py`) compares a live
  introspection against `schema.sql`. It is **not wired into CI** — nothing in
  `.github/workflows/` invokes it, and it needs `SUPABASE_SECRET_KEY`, so it
  only runs when someone runs it by hand. That is how the gaps below
  accumulated. Update `schema.sql` whenever you change the DB.
- **Introspection:** `scripts/introspect_schema.sql` — paste into the Supabase
  SQL editor for a full read-only dump of tables, columns (with exact case),
  enums, RLS, policies, constraints, indexes, triggers and functions.

## Known gaps (found by static audit, not yet confirmed against live)

1. **`settings.smart_notifications_enabled` is written but never read, and is
   defined nowhere.** `saveSettingToDb('smart_notifications_enabled', ...)`
   PATCHes it (Dashboard.tsx SETTING_DB_KEYS), but the column appears in no
   migration and not in `schema.sql`, and `loadUserSettings`'s select list
   omits it. So the toggle persists only to localStorage: it does not sync
   across devices or to a partner, and if the column really is absent the
   PATCH fails with PGRST204 — which `saveSettingToDb` only logs, so the UI
   still looks like it worked. Decide: add the column and add it to the select
   list, or make it explicitly local-only.

2. **Two tables the app uses are absent from `schema.sql`:**
   `notification_rules` and `pending_transactions`. See the section at the
   bottom of `schema.sql`. Only the second one's absence is tolerated at
   runtime.

3. **`subscription_status` default disagrees with the app's type.** The column
   defaults to `'false'`, but `types.ts` declares
   `subscription_status?: 'none' | 'active' | 'expired'`. Nothing currently
   branches on it (premium gating is stubbed to always-on in
   `lib/entitlement.ts`), so this is latent rather than broken.

4. **Theme default disagrees.** `settings.theme_selected` defaults to
   `'dark'`; the app's in-memory default is `'light'` (`App.tsx`
   DEFAULT_SETTINGS) and `loadUserSettings` falls back to `'light'`. A new
   user renders light, then flips to dark once settings load.

5. **`budgets."Visible"` must stay quoted.** Unquoted, Postgres folds it to
   `visible`, and every write path sends the JSON key `Visible`, which
   PostgREST matches case-sensitively. Fixed in `schema.sql`; confirm the live
   column's real spelling with the introspection script.

## Load-bearing quirks — do NOT "clean these up"

These are intentional and keep the app working across historical rows and the
one remaining drift point (`pending_transactions`). See `CLAUDE.md` and
`SETUP.md` for the same guidance.

- **Defensive column-name fallbacks** in `lib/hooks/useDataLoading.ts` and
  `lib/hooks/transactionMappers.ts`: `user_uuid`/`user_id`,
  `Visible`/`visible`, `Budget`/`budget`, `recur`/`recurrence`. Historical
  rows and mixed-case columns rely on these.
- **`pending_transactions` absence is tolerated.** The capture pipeline
  reads/writes it, but `loadPendingTransactions` treats a 404 as an empty
  queue. Note this does NOT extend to `notification_rules`, which has no such
  fallback.
- **`banks`** has a hardcoded fallback list in `lib/bankingApps.ts` if the
  table read fails.
