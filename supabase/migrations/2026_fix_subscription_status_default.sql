-- ============================================================
-- Migration: fix settings.subscription_status default
-- ============================================================
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
-- That INSERT is the signup path. public.handle_new_user() inserts only
-- (user_id, name, email), so subscription_status falls to its default and the
-- row is rejected with a check_violation. Because the trigger runs AFTER
-- INSERT on auth.users, the error propagates and the signup fails.
--
-- CONFIRMED on the live project (2026-07-25):
--
--   SELECT column_default FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='settings'
--     AND column_name='subscription_status';
--   -- returned: false
--
-- So the default really is the boolean literal, coerced to the text 'false',
-- and it really does violate the CHECK. Apply this migration.
--
-- To see the failure yourself without creating a real account or touching any
-- data — this copies the defaults and CHECK constraints but NOT the foreign
-- keys, and rolls back either way:
--
--   BEGIN;
--   CREATE TEMP TABLE probe (LIKE public.settings INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
--   INSERT INTO probe (user_id, name, email)
--   VALUES (gen_random_uuid(), 'probe', 'probe@example.invalid');
--   ROLLBACK;
--
-- Expected before this migration: ERROR, new row violates check constraint.
-- Expected after: one row inserted, subscription_status = 'none'.
--
-- If that probe succeeds *before* the migration, then signups are surviving
-- for some other reason — most likely the live handle_new_user() sets
-- subscription_status explicitly. Check with:
--   SELECT pg_get_functiondef('public.handle_new_user'::regproc);
-- Applying this migration is still correct either way: 'false' is never a
-- valid value for this column.
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
