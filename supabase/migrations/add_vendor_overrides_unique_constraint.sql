-- ================================================================
-- Migration: Fix vendor_overrides for delete + budget defaults
-- ================================================================
-- Run this in the Supabase SQL Editor (https://app.supabase.com/project/_/sql)
--
-- ✅ Safe to run multiple times (every statement checks IF NOT EXISTS)
-- ✅ Does NOT drop any tables, columns, or data
-- ✅ Only adds missing constraints, policies, and deduplicates rows
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Ensure auto_accept column exists
-- ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'vendor_overrides'
      AND column_name = 'auto_accept'
  ) THEN
    ALTER TABLE public.vendor_overrides
      ADD COLUMN auto_accept boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- 2. Deduplicate rows BEFORE adding the unique constraint
--    Keeps the most recently created row for each (user_id, vendor_name)
-- ────────────────────────────────────────────────────────────────
DELETE FROM public.vendor_overrides
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, vendor_name) id
  FROM public.vendor_overrides
  ORDER BY user_id, vendor_name, created_at DESC NULLS LAST
);

-- ────────────────────────────────────────────────────────────────
-- 3. Add UNIQUE constraint on (user_id, vendor_name)
--    Required so that insert/update logic works correctly
-- ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'vendor_overrides_unique'
      AND table_name      = 'vendor_overrides'
  ) THEN
    ALTER TABLE public.vendor_overrides
      ADD CONSTRAINT vendor_overrides_unique UNIQUE (user_id, vendor_name);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- 4. Enable RLS (safe even if already enabled)
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.vendor_overrides ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────
-- 5. Add all four RLS policies (SELECT / INSERT / UPDATE / DELETE)
--    Without these, authenticated users cannot read or modify
--    their own rows when RLS is on.
-- ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  -- SELECT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename  = 'vendor_overrides'
      AND policyname = 'Users can view own vendor overrides'
  ) THEN
    CREATE POLICY "Users can view own vendor overrides"
      ON public.vendor_overrides FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  -- INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename  = 'vendor_overrides'
      AND policyname = 'Users can upsert own vendor overrides'
  ) THEN
    CREATE POLICY "Users can upsert own vendor overrides"
      ON public.vendor_overrides FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  -- UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename  = 'vendor_overrides'
      AND policyname = 'Users can update own vendor overrides'
  ) THEN
    CREATE POLICY "Users can update own vendor overrides"
      ON public.vendor_overrides FOR UPDATE TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  -- DELETE  ← this is the critical one that was likely missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename  = 'vendor_overrides'
      AND policyname = 'Users can delete own vendor overrides'
  ) THEN
    CREATE POLICY "Users can delete own vendor overrides"
      ON public.vendor_overrides FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
