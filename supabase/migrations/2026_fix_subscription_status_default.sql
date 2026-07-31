-- ============================================================
-- SUPERSEDED by 2026_08_01_sync_schema_to_app.sql
-- ============================================================
-- That file is the single script to run: it contains this change
-- plus the other outstanding ones. Kept here for history only —
-- running it is harmless but unnecessary.
-- ============================================================

-- ============================================================
-- Migration: fix settings.subscription_status default
-- ============================================================
-- Priority: low. Nothing is broken today — see "NOT CURRENTLY REACHABLE"
-- below. This removes a trap, it does not fix an outage.
-- The live column is:
--
--   subscription_status text DEFAULT false
--     CHECK (subscription_status = ANY (ARRAY['none','active','expired']))
--
-- The DEFAULT and the CHECK contradict each other. `DEFAULT false` on a text
-- column resolves to the string 'false', which is not a member of the CHECK's
-- allowed set. Postgres validates a CHECK against existing rows when it is
-- added, but it does NOT validate column defaults — so a contradiction like
-- this is accepted at definition time and only fails later, on the first
-- INSERT that omits the column.
--
-- NOT CURRENTLY REACHABLE — this is a landmine, not an outage.
--
-- Verified on the live project (2026-07-25):
--   * public.handle_new_user() names subscription_status explicitly in its
--     INSERT column list, so the default is never applied on signup.
--     (SELECT pg_get_functiondef('public.handle_new_user'::regproc);)
--   * The app never POSTs to /settings — it only ever PATCHes. The trigger is
--     the sole inserter.
--
-- So signups work today. But any future INSERT that omits the column — a new
-- code path, a manual backfill, a restored dump, an edited trigger — fails
-- with a check_violation. Fixing the default costs nothing and removes that.
--
-- To see the failure, without creating an account or touching data. The temp
-- table copies defaults and CHECK constraints but NOT foreign keys, and the
-- whole thing rolls back:
--
--   BEGIN;
--   CREATE TEMP TABLE probe (LIKE public.settings INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
--   INSERT INTO probe (user_id, name, email)
--   VALUES (gen_random_uuid(), 'probe', 'probe@example.invalid');
--   ROLLBACK;
--
-- Before this migration: ERROR, new row violates check constraint.
-- After: one row, subscription_status = 'none'.
--
-- 'none' is the right default: it is a member of the CHECK set, and it is
-- already what the app coerces a missing value to
-- (useDataLoading.ts: `rows[0].subscription_status || 'none'`) and what
-- types.ts declares.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.settings
  ALTER COLUMN subscription_status SET DEFAULT 'none';

-- Repair any rows that were written before the CHECK existed and still hold
-- a value outside the allowed set.
UPDATE public.settings
SET subscription_status = 'none'
WHERE subscription_status IS NOT NULL
  AND subscription_status NOT IN ('none', 'active', 'expired');


-- Verify:
--   SELECT column_default FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='settings'
--     AND column_name='subscription_status';
--   -- expected: 'none'::text
--
-- Then confirm the signup path works end to end by creating a throwaway
-- account; a settings row should appear with subscription_status = 'none'.
