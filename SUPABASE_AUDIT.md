# Supabase vs Repo Audit

Generated against the live project at `xqleyxrftyehodksashu.supabase.co`.

## TL;DR

The repo's `supabase/schema.sql`, `supabase/schema_fresh_install.sql`, and
`supabase/migrations/*.sql` describe a database that **does not exist** in
production. The live DB has a different, much simpler shape — and the app
code has already been adapted to it (via defensive column-name fallbacks).
But there are a handful of mismatches, dead code, and broken RPCs you
should know about.

## Live database (what's actually there)

Tables: `settings, transactions, banks, overrides, budgets`
RPCs: `get_my_partner_id` (BROKEN — references missing `public.profiles`),
`generate_transaction_hash`
Edge Functions: none deployed

### `settings`
PK: `user_id` (uuid)
Cols: `name, email, partner_id, partner_email, partner_name,
budgeting_solo, monthly_income, rollover_enabled, leisure_buffer_enabled,
show_savings_insight, app_notifications_enabled, theme_selected,
trial_started_at, trial_ends_at, trial_consumed, subscription_status,
link_code`

### `transactions`
PK: `id` (uuid, gen_random_uuid)
Cols: `user_id, vendor, amount, date, is_projected, budget, type, recur,
created_at, caught_cleared, source`
Enums: `budget` ∈ {Housing, Groceries, Leisure, Utilities, Transport,
Services, Other}, `type` ∈ {Manual, Automatic},
`recur` ∈ {One-time, Biweekly, Monthly}
**No `category_id`, no `label`, no `recurrence`, no `user_name`,
no `description`.**

### `budgets`
Cols: `user_uuid, budget, amount, Visible`
**No PK, no `id`, no `category`, no `limit_amount`, no `user_id`,
no `is_household`, no `created_at`, no `updated_at`.**

### `overrides`
PK: `id`
Cols: `user_id, category_id, proper_name, match_key`

### `banks`
PK: `package_name`
Cols: `display_name`

## What the repo claims

`supabase/schema.sql` and `schema_fresh_install.sql` describe a database
with:

- `transactions.category_id` (uuid, FK to categories) — **doesn't exist**
- `transactions.label` (text) — **doesn't exist** (live DB has `type`)
- `transactions.recurrence` — **doesn't exist** (live DB has `recur`)
- `transactions.user_name`, `description`, `updated_at` — **don't exist**
- `transactions.source` — exists in live DB, NOT in schema.sql
- `budgets.id, category, limit_amount, user_id, is_household, created_at,
  updated_at, visible` — **none match the live schema**
- `vendor_overrides` table — **doesn't exist** (live DB has `overrides`)
- `pending_transactions`, `known_banking_apps`, `household_links`,
  `link_codes`, `notification_rules`, `notification_fingerprints`,
  `transaction_budget_splits`, `categories`, `feature_requests` — all
  **don't exist**
- `settings.leisure_buffer_enable` (typo, no "d") — live DB has
  `leisure_buffer_enabled`

The `consolidate_schema.sql` migration is the "current" intent and
mentions some of the new columns (source, etc.) but is also not what was
actually applied.

## Mismatches by table

| Repo code uses | Live DB has | Status |
|---|---|---|
| `transactions.budget` (string enum) | ✅ `budget` | OK |
| `transactions.type` (string enum) | ✅ `type` | OK |
| `transactions.recur` | ✅ `recur` | OK |
| `transactions.source` | ✅ `source` | OK |
| `transactions.category_id` (in old code/comments) | ❌ | App migrated away |
| `transactions.label` (in old code/comments) | ❌ | App migrated away |
| `transactions.recurrence` (in old code/comments) | ❌ | App migrated away |
| `budgets.user_uuid` | ✅ `user_uuid` | OK |
| `budgets.budget` (string enum) | ✅ `budget` | OK |
| `budgets.amount` | ✅ `amount` | OK |
| `budgets.Visible` (capital) | ✅ `Visible` | OK |
| `budgets.user_id` (fallback only) | ❌ | Fallback path will fail |
| `budgets.category`, `limit_amount` (fallback only) | ❌ | Fallback path will fail |
| `overrides` table | ✅ `overrides` | OK |
| `overrides.proper_name`, `category_id` | ✅ both | OK |
| `overrides.match_key` | ✅ present | App doesn't write it |
| `settings.leisure_buffer_enabled` | ✅ present | OK |
| `banks` table | ✅ `banks` | OK |
| `feature_requests` table | ❌ missing | Only used by `useFeatureRequests` hook which has no UI consumer (dead code) |
| `pending_transactions` | ❌ missing | App handles 404 gracefully with empty list |
| `known_banking_apps` | ❌ missing | App falls back to `lib/bankingApps.ts` hardcoded list |
| `vendor_overrides` | ❌ missing | App uses `overrides` instead (already migrated) |
| `get_my_partner_id` RPC | exists but broken (references missing `profiles` table) | Not used by app |
| `generate_transaction_hash` RPC | exists | Not used by app |
| `send-report` Edge Function | ❌ not deployed | Not used by app |

## Where the app's defensive code already covers drift

These places are good — they tolerate the schema drift. Don't touch them.

- `lib/hooks/useDataLoading.ts` `loadUserBudgets`: tries `user_uuid`
  first, falls back to `user_id`. Accepts `visible/Visible`,
  `category/budget`, `limit_amount/amount`. ✅
- `lib/hooks/useDataLoading.ts` `ensureDefaultBudgets`: posts with
  `user_uuid, budget, Visible` first, falls back to `user_id, category,
  limit_amount, visible`. ✅
- `lib/hooks/transactionMappers.ts` `fromSupabaseTransaction`:
  accepts `row.Budget || row.budget`, `row.recur || row.recurrence`,
  `row.type` for label, `row.source` for source. ✅
- `lib/hooks/transactionMappers.ts` `toSupabaseTransaction`: writes to
  the live DB shape (`budget, type, recur, source`). ✅
- `lib/hooks/useDataLoading.ts` `loadPendingTransactions`: handles 404
  on missing `pending_transactions` table. ✅
- `lib/bankingApps.ts` `loadBankingAppsFromDB`: falls back to hardcoded
  list on any error. ✅

## What's actually broken / weird

1. **`schema.sql` and `schema_fresh_install.sql` are pure fiction.** They
   do not match production. Anyone running them on the live DB would
   either (a) silently no-op because the `IF NOT EXISTS` checks match,
   or (b) catastrophically fail. **Recommendation:** delete them, OR
   rewrite them to match the live shape with comments noting this is
   the canonical "from zero" setup, not the migration path.

2. **`supabase/migrations/consolidate_schema.sql` is not idempotent
   against the live DB either.** It assumes the old `category_id`
   layout, drops things, and seeds `known_banking_apps` which would
   conflict with nothing (safe there) but also assumes tables like
   `notification_rules` exist that don't. **Recommendation:** rewrite
   to match the live shape, or replace with a single canonical
   `schema.sql` derived from introspecting the live DB.

3. **`get_my_partner_id` RPC is broken** (references missing
   `public.profiles` table). Not called by the app, but it's exposed
   on the public API. **Recommendation:** drop it from the DB.

4. **`generate_transaction_hash` RPC is dead code.** Not used by app or
   tests. **Recommendation:** drop it.

5. **`send-report` Edge Function is in the repo but not deployed and
   not called.** **Recommendation:** either deploy it (if you actually
   want server-side email sending) or delete it from the repo.

6. **`useFeatureRequests` hook + `FeatureRequestModal` type-only
   import is dead code.** No UI consumer. **Recommendation:** delete
   the hook, or wire it to a UI.

7. **No RLS check performed via API.** The schema.sql includes policies
   but the live DB's actual policies are unknown from this audit (the
   REST introspection doesn't expose them). If the repo's policy
   definitions were never applied, RLS might be disabled or
   misconfigured. **Recommendation:** verify RLS on each table is
   enabled and policies match the schema.sql intent (or are at least
   as strict — users can only see their own rows + their partner's).

8. **The repo's `Budgets` enum is missing in old migrations** but
   present in the live DB (referenced by `transactions.budget` and
   `overrides.category_id`). If the live DB was created by hand
   (likely, given the drift), the enum exists, but there's no
   authoritative SQL for it anywhere in the repo.

## Suggested fix order

If you want a single source of truth:

1. **Introspect the live DB** (already done above).
2. **Regenerate `supabase/schema.sql`** from the live introspection,
   with RLS policies added back (and verified actually present in
   live DB).
3. **Delete or rewrite `consolidate_schema.sql`** to apply only on
   top of the new shape.
4. **Drop dead RPCs** (`get_my_partner_id`, `generate_transaction_hash`)
   from the live DB.
5. **Decide on `send-report`**: deploy or delete.
6. **Delete `useFeatureRequests`** if no UI consumer is coming.
7. **Re-introspect and add an automated drift check** to CI so this
   can't happen again — a script that runs `supabase db pull` and
   diffs against the committed `schema.sql`.
