-- ============================================================
-- Migration: unique (user_uuid, budget) on public.budgets
-- ============================================================
-- The live budgets table has no primary key and, per the dashboard schema
-- export, only one constraint:
--
--   CONSTRAINT budgets_user_uuid_fkey FOREIGN KEY (user_uuid) -> auth.users(id)
--
-- No PK, no UNIQUE. That matters for two reasons.
--
-- 1. ensureDefaultBudgets (lib/hooks/useDataLoading.ts:53) seeds a new user's
--    default budgets with:
--        POST /budgets?on_conflict=user_uuid,budget
--    ON CONFLICT requires a unique index or constraint covering exactly those
--    columns. Without one Postgres raises 42P10 ("there is no unique or
--    exclusion constraint matching the ON CONFLICT specification") — it does
--    NOT fall back to a plain insert. ensureDefaultBudgets only logs a failed
--    response, so seeding fails silently; the user still sees categories
--    because loadUserBudgets falls back to SYSTEM_CATEGORIES client-side.
--    Its retry (on_conflict=user_id,category) cannot help — the live table has
--    neither a user_id nor a category column.
--
-- 2. saveBudgetLimit uses PATCH-then-plain-POST rather than an upsert, so it
--    works without the constraint — but nothing structurally prevents two
--    rows for the same (user_uuid, budget). A racing save from two devices, or
--    any PATCH that matches zero rows twice, silently duplicates a budget.
--
-- NOTE: the dashboard export lists table constraints, not indexes. A bare
-- `CREATE UNIQUE INDEX` would satisfy ON CONFLICT without appearing there, so
-- check before assuming this is missing:
--
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname='public' AND tablename='budgets';
--
-- If a unique index on (user_uuid, budget) already exists, skip this file.
-- ============================================================


-- Step 1 — look for existing duplicates. If this returns rows, resolve them
-- before the constraint can be added.
--
--   SELECT user_uuid, budget, count(*), array_agg(amount) AS amounts
--   FROM public.budgets
--   GROUP BY user_uuid, budget
--   HAVING count(*) > 1;


-- Step 2 — OPTIONAL dedupe. Commented out deliberately: it deletes rows, and
-- which duplicate to keep is a judgement call about your data. Review the
-- output of step 1 first. This keeps the row with the largest amount per
-- (user_uuid, budget), breaking ties arbitrarily by physical position.
--
-- DELETE FROM public.budgets b
-- WHERE b.ctid <> (
--   SELECT keep.ctid FROM public.budgets keep
--   WHERE keep.user_uuid IS NOT DISTINCT FROM b.user_uuid
--     AND keep.budget    IS NOT DISTINCT FROM b.budget
--   ORDER BY keep.amount DESC NULLS LAST, keep.ctid
--   LIMIT 1
-- );


-- Step 3 — add the constraint. Skipped if an equivalent unique index or
-- constraint is already present. Raises loudly if duplicates remain, which is
-- the correct outcome: silently discarding a user's budget row would be worse.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.budgets'::regclass
      AND contype = 'u'
      AND conkey @> ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid='public.budgets'::regclass AND attname='user_uuid'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='public.budgets'::regclass AND attname='budget')
      ]::smallint[]
  ) THEN
    RAISE NOTICE 'budgets already has a unique constraint on (user_uuid, budget); nothing to do';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.budgets'::regclass
      AND i.indisunique
      AND i.indnatts = 2
  ) THEN
    RAISE NOTICE 'budgets already has a 2-column unique index; verify it covers (user_uuid, budget) before skipping';
    RETURN;
  END IF;

  ALTER TABLE public.budgets
    ADD CONSTRAINT budgets_user_uuid_budget_key UNIQUE (user_uuid, budget);
  RAISE NOTICE 'added budgets_user_uuid_budget_key';
END $$;


-- Verify:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid='public.budgets'::regclass;
--
-- Then confirm seeding works by signing up a throwaway account and checking
-- that 7 budget rows appear for its user_uuid.
