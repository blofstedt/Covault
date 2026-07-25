# Supabase schema notes

**Status:** `supabase/schema.sql` is the intended source of truth. Its column
list was verified against the live project on 2026-07-25 via
`scripts/introspect_schema.sql` (query 10) — see "Verified" and "Still
unverified" below. What follows is the context needed before touching data
access.

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

## Verified against live (2026-07-25)

Confirmed **present** in production, and now all present in `schema.sql`:
`transactions.refunded`, `transactions.raw_notification`,
`transactions.confidence`, `transactions.caught_cleared`,
`transactions.source`, `overrides.match_type`, `overrides.updated_at`,
`settings.link_code`.

Confirmed **`budgets."Visible"` is spelled with a capital V** in the live DB.
`schema.sql` now quotes it. Unquoted, Postgres folds the identifier to
`visible`, and every write path sends the JSON key `Visible`, which PostgREST
matches case-sensitively — so an unquoted definition would produce a project
where budget-limit and visibility writes fail.

Confirmed **`settings.smart_notifications_enabled` did NOT exist** — a live
bug, now fixed:

- The app had been PATCHing it since smart notifications shipped
  (`Dashboard.tsx` SETTING_DB_KEYS -> `saveSettingToDb`). Every write returned
  PGRST204; `saveSettingToDb` only logs a failed response, and the UI had
  already applied the change optimistically and persisted it to localStorage,
  so the toggle looked like it worked. The preference never left the device.
- `supabase/migrations/2026_add_smart_notifications_column.sql` adds it,
  defaulting to `true` to match the app's in-memory default so existing users
  keep current behaviour.
- `loadUserSettings` now reads it back, so it finally syncs across devices and
  to a linked partner. It is requested as a **separate select with a retry
  that drops it**, because PostgREST 400s the entire select on an unknown
  column and that function returns early on a non-ok response — naming it
  unconditionally would take theme, income and the trial fields down with it
  on any project where the migration has not been applied.

`schema.sql` was reconciled against the dashboard's full schema export on
2026-07-25: live defaults, CHECK constraints, the real constraint names, and
the `notification_rules` table are now all reflected there.

**`notification_rules` exists.** Now defined in `schema.sql`. Its
`pattern_type` CHECK allows only `'exact'`/`'contains'`, which matches
`NotATxRuleType` exactly — note this is narrower than `overrides.match_type`,
which also allows `'prefix'`.

**`pending_transactions` does NOT exist.** The capture pipeline still writes
to it (`notificationProcessor.ts:924` insert, `useTransactionOps.ts:447`
patch). The read path tolerates this (404 → empty queue) so the app runs, but
those writes fail on every captured notification and are swallowed. Either
create the table or remove the dead references — see the section in
`schema.sql`.

## Open issues requiring a decision

1. **`settings.subscription_status` default contradicts its own CHECK —
   CONFIRMED.** `information_schema.columns.column_default` returns `false` on
   the live project, under
   `CHECK (subscription_status IN ('none','active','expired'))`. The default
   coerces to the text `'false'`, which the CHECK rejects. Postgres does not
   validate defaults when a CHECK is added, so this only fails on an INSERT
   that omits the column — which is what `handle_new_user()` does on signup.
   **Apply `2026_fix_subscription_status_default.sql`.** It contains a
   transactional probe (a temp table cloned with
   `INCLUDING DEFAULTS INCLUDING CONSTRAINTS`) that reproduces the failure
   without creating an account or touching data. If that probe *succeeds*
   pre-migration, the live `handle_new_user()` must be setting the column
   explicitly — the fix is still correct, since `'false'` is never a valid
   value here.

2. **`budgets` has no UNIQUE on (user_uuid, budget).** The export shows only a
   FK. Consequences: `ensureDefaultBudgets`'s
   `POST /budgets?on_conflict=user_uuid,budget` raises 42P10 rather than
   falling back to a plain insert, so default-budget seeding fails silently
   for new users (the UI still shows categories via the client-side
   `SYSTEM_CATEGORIES` fallback); and nothing prevents duplicate budget rows,
   since `saveBudgetLimit` writes via PATCH-then-plain-POST. Addressed by
   `2026_add_budgets_unique_constraint.sql`. **Check `pg_indexes` first** — a
   bare unique index would satisfy ON CONFLICT without appearing as a
   constraint in the export.

3. **`ensureDefaultBudgets`' retry is dead.** Its fallback posts
   `user_id`/`category`/`limit_amount`/`visible`, but the live table has none
   of those columns, so the retry cannot succeed. Left in place for now — it
   is harmless — but it is not the safety net it looks like.

## Still unverified

Queries 4, 5, 7 and 9 of `scripts/introspect_schema.sql` have not been run:

1. **RLS enabled, and policies correct, on every table** — including
   `notification_rules`, whose policies are not documented anywhere.
2. **Indexes** — in particular whether a unique index on
   `budgets (user_uuid, budget)` already exists (see issue 2 above).
3. **Were the dead RPCs dropped?** `get_my_partner_id` and
   `generate_transaction_hash`, per `2026_cleanup_dead_rpcs.sql`.

## Known mismatches (latent, not breaking)

- **Theme default disagrees.** `settings.theme_selected` defaults to `'dark'`;
  the app's in-memory default is `'light'` (`App.tsx` DEFAULT_SETTINGS) and
  `loadUserSettings` falls back to `'light'`. A new user renders light, then
  flips to dark once settings load.

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
