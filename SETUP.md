# Setup

Everything a fresh session needs to know to be productive on this repo.
**No secrets here** — keep those in your password manager.

## Project

- **Repo:** `https://github.com/blofstedt/Covault.git` (owner: `blofstedt`)
- **Supabase project ref:** `xqleyxrftyehodksashu`
- **Supabase URL:** `https://xqleyxrftyehodksashu.supabase.co`
- **Region:** `us-east-1` (inferred from Supabase pooler DNS)
- **App name:** Covault (personal finance tracker; React + Vite + Capacitor)

## Live database (as of 2026-07-17)

Five tables: `settings`, `transactions`, `budgets`, `overrides`, `banks`.
Enums: `Budgets` (Housing/Groceries/Leisure/Utilities/Transport/Services/Other),
`Type` (Manual/Automatic), `Recurrence` (One-time/Biweekly/Monthly).
Canonical schema is in `supabase/schema.sql`.

RLS is enabled on every public table. Three policies were added in
`supabase/migrations/2026_cleanup_dead_rpcs.sql`-adjacent work
(see git log: "fix: resolve onDeleteTransaction crash and clean up
schema drift"). The drift check script
`scripts/check_schema_drift.sh` will tell you if the live DB ever
diverges from `supabase/schema.sql`.

There is **one** user in the DB right now: `de1ba59d-6f77-40f7-b622-da579e4c6b9e`
(Brian / itsjustmyemail@gmail.com). All test data references this user.

## Required secrets (NOT in this file)

| What | Where to get it | Where it goes |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API | `.env` (Vercel/GitHub Actions env too) |
| `VITE_SUPABASE_ANON_KEY` | Same | Same |
| `GITHUB_TOKEN` (for pushes) | GitHub → Settings → Developer settings → PAT (classic, repo scope) | Sandbox env var, not the repo |
| `SUPABASE_SECRET_KEY` (service role) | Supabase → Project Settings → API → service_role | Sandbox env var, for drift check + introspection |
| `SUPABASE_DB_PASSWORD` (optional) | Supabase → Project Settings → Database | Only if you want full-mode drift check (triggers, RLS, CHECK constraints) |

Pattern: anon key goes in `.env` and Vercel. Service role key only in
sandbox env or GitHub Actions secrets (NEVER in the client bundle).

## Build / dev

```bash
npm install --legacy-peer-deps
npm run dev              # Vite dev server
npm run build            # Production build to dist/
npm run cap:build        # Build + sync to Android
npm test                 # Vitest
npx tsc --noEmit         # TypeScript check
./scripts/check_schema_drift.sh  # DB ↔ schema.sql check
```

Vite needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to do
anything useful. If those are missing it falls back to a stub client
that logs warnings (see `lib/supabase.ts`).

## Recurring transaction model

Two systems write future transactions:

1. **`lib/recurringExecutor.ts`** — runs on app open / notification events.
   Walks forward from each recurring row's base date, inserting any missing
   due dates. Backs up to 2 months. Idempotent (uses `existingKeys` set).
2. **`lib/projectedTransactions.ts`** — display-only. Walks forward from
   the *earliest* transaction per (vendor, amount, recurrence, day-of-month)
   group, projecting up to 3 months ahead. Past occurrences in the current
   month are "solidified" (is_projected = false) so the dashboard math
   matches the DB.

Both are biweekly-aware. The bug we fixed in commit `dcc033f` was that
the executor was using a stale 2/13 KIA as its anchor, producing rows
on the 13th of every month instead of every 14 days from 7/3.

## Refund handling

A refund = a transaction with `amount < 0` and `is_income !== true`.

`lib/refundMatching.ts` matches each refund to an expense (same vendor,
same |amount|, same budget, within 30 days) and:

- hides the refund from every list (budget, search, AI-entered, approved, CSV)
- strikes through the matched expense with a "Refunded" tag
- the negative amount still counts in the budget reduce, so the budget
  total is automatically reduced

Unmatched refunds are also hidden; their negative amount still reduces
the budget total but no expense is struck through.

## Override learning (category memory)

When a user re-categorizes an AI transaction, the app writes to the
`overrides` table: `{ user_id, proper_name, match_key, category_id }`.

- `proper_name` = display vendor (e.g. "Kia")
- `match_key` = normalized slug (e.g. "kia") — survives name variants
  like "KIA Finance Corp" vs "Kia"

The AI pipeline (`lib/notificationProcessor.ts`) looks up overrides by
`match_key` first, then falls back to `proper_name` ilike for legacy
rows. **Both are now written on every override save** (commit `dcc033f`).

## Conventions discovered this session

- App uses defensive column-name fallbacks in many places (e.g.
  `row.Budget || row.budget`, `row.recur || row.recurrence`,
  `row.visible ?? row.Visible`). Don't "clean these up" — they're
  load-bearing for the schema-drift period.
- `transaction.budget_id` in the in-memory `Transaction` type is the
  app's UUID-style id; the DB column `transactions.budget` is the
  enum name. `lib/transactionMappers.ts` does the translation via
  `resolveBudgetNameForInsert` / `resolveBudgetIdFromRow`.
- "Projected" in the UI = `is_projected: true` AND date in the future.
  Current-month past occurrences are solidified (still rendered but
  `is_projected: false`) so dashboard totals match the DB.
- Refunds, income, and projected transactions are excluded from CSV
  export. They are also excluded from the budget reduce for projected
  spend.

## Known things still on the wishlist

- Full-mode drift check (catches RLS / trigger / CHECK drift). Needs
  `SUPABASE_DB_PASSWORD`.
- The recurring executor + projection functions still both walk
  forward from each transaction's base date independently. A unified
  "next due date" function would be cleaner but isn't urgent.
- `bankingApps` table in the DB has 282 rows of package_name/display_name
  mappings. The app falls back to a hardcoded list in `lib/bankingApps.ts`
  on any error. The hardcoded list is not kept in sync with the DB.

## Sandbox quirks

- The sandbox has `SUPABASE_URL` and `SUPABASE_SECRET_KEY` set as env
  vars at the process level. These can leak into vitest's `import.meta.env`
  via the unfiltered default env. Watch for this if you add new env vars.
- `npx supabase db pull --db-url "..."` needs the actual Postgres
  password, NOT the API service role key. The CLI is installed globally
  via `npm install -g supabase`.
- `psql` is NOT installed. For raw SQL, use the Supabase SQL editor in
  the dashboard (https://supabase.com/dashboard/project/<ref>/sql).
- `pip install --break-system-packages pg8000` works for one-off
  Python + PostgREST introspection scripts. Standard pip is blocked by
  PEP 668.
