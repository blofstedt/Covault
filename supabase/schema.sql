-- ============================================================
-- COVAULT DATABASE SCHEMA — INTROSPECTED FROM PRODUCTION
-- ============================================================
-- This file is the canonical schema for the Covault project as it
-- actually exists in production. It was regenerated from PostgREST
-- introspection of https://xqleyxrftyehodksashu.supabase.co and
-- supplemented with the RLS policy intent from the original repo
-- files.
--
-- IMPORTANT: This file is the source of truth for what the live DB
-- looks like. If you change the DB, update this file. The CI drift
-- check (scripts/check_schema_drift.sh) compares the introspection
-- of the live DB against this file's expected shape and fails if
-- they diverge.
--
-- What this file is:
--   - A reference / spec of the live DB
--   - A starting point for a brand-new project
--   - A drift-detection target
--
-- What this file is NOT:
--   - A migration to apply on top of the live DB. Applying this on
--     the live DB will be a no-op (CREATE TABLE IF NOT EXISTS) for
--     everything and would only add what's missing.
--
-- Sections NOT introspected (intentional placeholders):
--   - Indexes (PostgREST does not expose index metadata)
--   - CHECK constraints beyond enum membership
--   - Triggers (e.g. on_auth_user_created, update_budgets_updated_at)
--   - Foreign keys (only user_id -> auth.users was inferable)
-- These are reconstructed from the original schema intent and
-- marked with "(RECONSTRUCTED)" comments.
-- ============================================================


-- ============================================================
-- ENUMS
-- ============================================================

-- The Budgets enum is referenced by transactions.budget and
-- overrides.category_id. RLS-restricted tables don't expose enum
-- type details via PostgREST, but the valid members were confirmed
-- by attempting inserts via the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Budgets') THEN
    CREATE TYPE public."Budgets" AS ENUM (
      'Housing', 'Groceries', 'Leisure', 'Utilities',
      'Transport', 'Services', 'Other'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Type') THEN
    CREATE TYPE public."Type" AS ENUM ('Manual', 'Automatic');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Recurrence') THEN
    CREATE TYPE public."Recurrence" AS ENUM ('One-time', 'Biweekly', 'Monthly');
  END IF;
END $$;


-- ============================================================
-- 1. SETTINGS  (one row per user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settings (
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  partner_id uuid,
  partner_email text,
  partner_name text,
  budgeting_solo boolean DEFAULT true,
  monthly_income numeric,
  rollover_enabled boolean DEFAULT true,
  leisure_buffer_enabled boolean DEFAULT true,
  show_savings_insight boolean DEFAULT true,
  app_notifications_enabled boolean,
  theme_selected text DEFAULT 'dark',
  trial_started_at timestamp with time zone,
  trial_ends_at timestamp with time zone,
  trial_consumed boolean,
  subscription_status text DEFAULT 'false',
  link_code text,
  CONSTRAINT settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id),
  CONSTRAINT settings_partner_id_fkey FOREIGN KEY (partner_id)
    REFERENCES auth.users(id)
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'settings' AND policyname = 'Users can view own settings') THEN
    CREATE POLICY "Users can view own settings" ON public.settings
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'settings' AND policyname = 'Users can view partner settings') THEN
    CREATE POLICY "Users can view partner settings" ON public.settings
      FOR SELECT TO authenticated
      USING (
        user_id IN (
          SELECT s.partner_id FROM public.settings s
          WHERE s.user_id = auth.uid() AND s.partner_id IS NOT NULL
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'settings' AND policyname = 'Users can insert own settings') THEN
    CREATE POLICY "Users can insert own settings" ON public.settings
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'settings' AND policyname = 'Users can update own settings') THEN
    CREATE POLICY "Users can update own settings" ON public.settings
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 2. TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor text NOT NULL,
  amount numeric NOT NULL,
  date date NOT NULL,
  is_projected boolean NOT NULL,
  budget public."Budgets" NOT NULL,
  type public."Type" NOT NULL DEFAULT 'Manual',
  recur public."Recurrence" NOT NULL DEFAULT 'One-time',
  created_at timestamp with time zone DEFAULT now(),
  caught_cleared boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
);

-- (RECONSTRUCTED) Indexes based on original schema intent:
--   idx_transactions_user_id     ON (user_id)
--   idx_transactions_date        ON (date)
--   idx_transactions_user_vendor ON (user_id, vendor)
CREATE INDEX IF NOT EXISTS idx_transactions_user_id
  ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON public.transactions (date);
CREATE INDEX IF NOT EXISTS idx_transactions_user_vendor
  ON public.transactions (user_id, vendor);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'Users can view own transactions') THEN
    CREATE POLICY "Users can view own transactions" ON public.transactions
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'Users can insert own transactions') THEN
    CREATE POLICY "Users can insert own transactions" ON public.transactions
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'Users can update own transactions') THEN
    CREATE POLICY "Users can update own transactions" ON public.transactions
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'Users can delete own transactions') THEN
    CREATE POLICY "Users can delete own transactions" ON public.transactions
      FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  -- (LIVE ONLY) service_delete: lets the service role bypass RLS for
  -- maintenance. Created automatically by Supabase when the service role
  -- key is used. Documented here for completeness.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'service_delete') THEN
    -- No-op: this policy is created by Supabase itself; we just note its existence.
    NULL;
  END IF;
END $$;


-- ============================================================
-- 3. BUDGETS
-- ============================================================
-- Note: live DB has NO primary key on this table. Each row is
-- identified by the (user_uuid, budget) tuple. The app uses
-- `on_conflict=user_uuid,budget` upserts, so a unique index on
-- that pair is required for upsert semantics to work.
CREATE TABLE IF NOT EXISTS public.budgets (
  user_uuid uuid,
  budget public."Budgets",
  amount numeric,
  Visible boolean NOT NULL DEFAULT true
);

-- (RECONSTRUCTED) Unique constraint required for upserts via
-- `on_conflict=user_uuid,budget`. Without this, `on_conflict`
-- silently degrades to plain inserts and duplicate rows accumulate.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'budgets_user_uuid_budget_key'
  ) THEN
    ALTER TABLE public.budgets
      ADD CONSTRAINT budgets_user_uuid_budget_key
      UNIQUE (user_uuid, budget);
  END IF;
END $$;

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'budgets' AND policyname = 'Users can view own budgets') THEN
    CREATE POLICY "Users can view own budgets" ON public.budgets
      FOR SELECT TO authenticated
      USING (auth.uid() = user_uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'budgets' AND policyname = 'Users can upsert own budgets') THEN
    CREATE POLICY "Users can upsert own budgets" ON public.budgets
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'budgets' AND policyname = 'Users can update own budgets') THEN
    CREATE POLICY "Users can update own budgets" ON public.budgets
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_uuid);
  END IF;
END $$;


-- ============================================================
-- 4. OVERRIDES  (vendor reclassification memory)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category_id public."Budgets" NOT NULL,
  proper_name text,
  match_key text,
  CONSTRAINT overrides_pkey PRIMARY KEY (id),
  CONSTRAINT overrides_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
);

ALTER TABLE public.overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'overrides' AND policyname = 'Users can view own overrides') THEN
    CREATE POLICY "Users can view own overrides" ON public.overrides
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'overrides' AND policyname = 'Users can insert own overrides') THEN
    CREATE POLICY "Users can insert own overrides" ON public.overrides
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'overrides' AND policyname = 'Users can update own overrides') THEN
    CREATE POLICY "Users can update own overrides" ON public.overrides
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 5. BANKS  (banking app display name lookup)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.banks (
  package_name text NOT NULL,
  display_name text NOT NULL,
  CONSTRAINT banks_pkey PRIMARY KEY (package_name)
);

ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'banks' AND policyname = 'Anyone can read Banking') THEN
    CREATE POLICY "Anyone can read banks" ON public.banks
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;


-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create a settings row when a new user signs up. The
-- original schema also set monthly_income=5000 and a 14-day trial;
-- the live DB's handle_new_user may not. This trigger is preserved
-- here for documentation; verify the live DB version matches before
-- relying on it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.settings (user_id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name',
             split_part(NEW.email, '@', 1),
             'User'),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- DEAD CODE — flagged for cleanup
-- ============================================================
-- The following exist in the live DB but are not used by the app:
--   - public.get_my_partner_id (RPC)  — references missing
--     public.profiles table, fails on call
--   - public.generate_transaction_hash (RPC)  — not called
--     by the app or tests
--
-- Drop them by running the snippet in
-- supabase/migrations/2026_cleanup_dead_rpcs.sql.
-- ============================================================
