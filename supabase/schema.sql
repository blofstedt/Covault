-- ============================================================
-- COVAULT DATABASE SCHEMA — SAFE MIGRATION
-- Idempotent: can be run on an existing database without data loss.
-- Uses IF NOT EXISTS / IF EXISTS guards throughout.
--
-- For a BRAND-NEW database, see schema_fresh_install.sql instead.
-- ============================================================


-- ============================================================
-- 1. CATEGORIES  (read-only seed data)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  display_order integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_name_key UNIQUE (name)
);

-- Seed rows (skip duplicates via ON CONFLICT)
INSERT INTO public.categories (name, display_order) VALUES
  ('Housing',   1),
  ('Groceries', 2),
  ('Transport', 3),
  ('Utilities', 4),
  ('Leisure',   5),
  ('Other',     6)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'Anyone can read categories'
  ) THEN
    CREATE POLICY "Anyone can read categories"
      ON public.categories FOR SELECT TO authenticated USING (true);
  END IF;
END $$;


-- ============================================================
-- 2. SETTINGS  (one row per user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settings (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  partner_id uuid REFERENCES auth.users(id),
  partner_email text,
  partner_name text,
  has_joint_accounts boolean DEFAULT false,
  budgeting_solo boolean DEFAULT true,
  monthly_income numeric DEFAULT 0 CHECK (monthly_income >= 0),
  rollover_enabled boolean DEFAULT true,
  rollover_overspend boolean DEFAULT false,
  use_leisure_as_buffer boolean DEFAULT true,
  show_savings_insight boolean DEFAULT true,
  theme text DEFAULT 'light' CHECK (theme = ANY (ARRAY['light','dark'])),
  has_seen_tutorial boolean DEFAULT false,
  app_notifications_enabled boolean DEFAULT false,
  CONSTRAINT settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT settings_email_key UNIQUE (email)
);

-- Add trial & subscription columns (safe for existing databases)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'trial_started_at'
  ) THEN
    ALTER TABLE public.settings ADD COLUMN trial_started_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'trial_ends_at'
  ) THEN
    ALTER TABLE public.settings ADD COLUMN trial_ends_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'trial_consumed'
  ) THEN
    ALTER TABLE public.settings ADD COLUMN trial_consumed boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'subscription_status'
  ) THEN
    ALTER TABLE public.settings ADD COLUMN subscription_status text DEFAULT 'none'
      CHECK (subscription_status = ANY (ARRAY['none','active','expired']));
  END IF;
END $$;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'Users can view own settings') THEN
    CREATE POLICY "Users can view own settings" ON public.settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'Users can insert own settings') THEN
    CREATE POLICY "Users can insert own settings" ON public.settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'Users can update own settings') THEN
    CREATE POLICY "Users can update own settings" ON public.settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Auto-create a settings row when a new user signs up
-- trial_consumed = true means the one-time trial slot has been used (prevents trial reset)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.settings (user_id, name, email, monthly_income, trial_started_at, trial_ends_at, trial_consumed, subscription_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name',
             split_part(NEW.email, '@', 1),
             'User'),
    NEW.email,
    5000,
    now(),
    now() + interval '14 days',
    true,   -- trial slot consumed on first signup (cannot be reset)
    'none'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger (DROP + CREATE is safe — it doesn't affect data)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill existing users who don't have trial data yet
UPDATE public.settings
SET
  trial_started_at = COALESCE(trial_started_at, now()),
  trial_ends_at    = COALESCE(trial_ends_at,    now() + interval '14 days'),
  trial_consumed   = COALESCE(trial_consumed,   true),
  subscription_status = COALESCE(subscription_status, 'none')
WHERE trial_started_at IS NULL;


-- ============================================================
-- 3. HOUSEHOLD LINKS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.household_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user1_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user2_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  user1_name text,
  user2_name text,
  CONSTRAINT household_links_pkey PRIMARY KEY (id)
);

-- Add missing constraints (safe: will no-op if they already exist)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'household_links_no_self' AND table_name = 'household_links'
  ) THEN
    ALTER TABLE public.household_links ADD CONSTRAINT household_links_no_self CHECK (user1_id <> user2_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'household_links_unique' AND table_name = 'household_links'
  ) THEN
    ALTER TABLE public.household_links ADD CONSTRAINT household_links_unique UNIQUE (user1_id, user2_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_household_links_user1_id ON public.household_links (user1_id);
CREATE INDEX IF NOT EXISTS idx_household_links_user2_id ON public.household_links (user2_id);

ALTER TABLE public.household_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_links' AND policyname = 'Users can view own household links') THEN
    CREATE POLICY "Users can view own household links" ON public.household_links FOR SELECT TO authenticated
      USING (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_links' AND policyname = 'Users can create household links') THEN
    CREATE POLICY "Users can create household links" ON public.household_links FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_links' AND policyname = 'Users can update household links they''re part of') THEN
    CREATE POLICY "Users can update household links they're part of" ON public.household_links FOR UPDATE TO authenticated
      USING (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_links' AND policyname = 'Users can delete own household links') THEN
    CREATE POLICY "Users can delete own household links" ON public.household_links FOR DELETE TO authenticated
      USING (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
END $$;


-- ============================================================
-- 4. LINK CODES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.link_codes (
  code text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT link_codes_pkey PRIMARY KEY (code)
);

CREATE INDEX IF NOT EXISTS idx_link_codes_user_id ON public.link_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_link_codes_expires_at ON public.link_codes (expires_at);

ALTER TABLE public.link_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'link_codes' AND policyname = 'Users can view own link codes') THEN
    CREATE POLICY "Users can view own link codes" ON public.link_codes FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'link_codes' AND policyname = 'Users can create own link codes') THEN
    CREATE POLICY "Users can create own link codes" ON public.link_codes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'link_codes' AND policyname = 'Users can delete own link codes') THEN
    CREATE POLICY "Users can delete own link codes" ON public.link_codes FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'link_codes' AND policyname = 'Anyone can read valid link codes') THEN
    CREATE POLICY "Anyone can read valid link codes" ON public.link_codes FOR SELECT TO authenticated USING (expires_at > now());
  END IF;
END $$;


-- ============================================================
-- 5. TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  amount numeric(12,2) NOT NULL,
  date date NOT NULL,
  category_id uuid NOT NULL REFERENCES public.categories(id),
  recurrence text NOT NULL DEFAULT 'One-time'
    CHECK (recurrence = ANY (ARRAY['One-time','Biweekly','Monthly'])),
  label text NOT NULL DEFAULT 'Manual'
    CHECK (label = ANY (ARRAY['Auto-Added','Manual','Auto-Added + Edited'])),
  is_projected boolean NOT NULL DEFAULT false,
  description text,
  split_group_id uuid,
  source_hash text,
  user_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT transactions_pkey PRIMARY KEY (id)
);

-- Rename "Description" (capital D) → "description" if the old column exists
-- PostgreSQL stores unquoted identifiers as lowercase, but quoted "Description"
-- would be stored with capital D. This handles both cases safely.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'Description'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.transactions RENAME COLUMN "Description" TO description;
  END IF;
END $$;

-- Add description column if it doesn't exist at all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.transactions ADD COLUMN description text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_user_id     ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date        ON public.transactions (date);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON public.transactions (category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_vendor ON public.transactions (user_id, vendor);

-- Partial indexes (IF NOT EXISTS works for these too)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_transactions_split_group') THEN
    CREATE INDEX idx_transactions_split_group ON public.transactions (split_group_id) WHERE split_group_id IS NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_transactions_source_hash') THEN
    CREATE INDEX idx_transactions_source_hash ON public.transactions (source_hash) WHERE source_hash IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can view own transactions') THEN
    CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can insert own transactions') THEN
    CREATE POLICY "Users can insert own transactions" ON public.transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can update own transactions') THEN
    CREATE POLICY "Users can update own transactions" ON public.transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can delete own transactions') THEN
    CREATE POLICY "Users can delete own transactions" ON public.transactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can view partner transactions') THEN
    CREATE POLICY "Users can view partner transactions" ON public.transactions FOR SELECT TO authenticated
      USING (
        user_id IN (
          SELECT hl.user2_id FROM public.household_links hl WHERE hl.user1_id = auth.uid()
          UNION
          SELECT hl.user1_id FROM public.household_links hl WHERE hl.user2_id = auth.uid()
        )
      );
  END IF;
END $$;


-- ============================================================
-- 6. TRANSACTION BUDGET SPLITS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transaction_budget_splits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  budget_category text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  percentage numeric CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT transaction_budget_splits_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_budget_splits_transaction_id ON public.transaction_budget_splits (transaction_id);

ALTER TABLE public.transaction_budget_splits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_budget_splits' AND policyname = 'Users can view splits for own transactions') THEN
    CREATE POLICY "Users can view splits for own transactions" ON public.transaction_budget_splits FOR SELECT TO authenticated
      USING (transaction_id IN (SELECT id FROM public.transactions WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_budget_splits' AND policyname = 'Users can insert splits for own transactions') THEN
    CREATE POLICY "Users can insert splits for own transactions" ON public.transaction_budget_splits FOR INSERT TO authenticated
      WITH CHECK (transaction_id IN (SELECT id FROM public.transactions WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_budget_splits' AND policyname = 'Users can update splits for own transactions') THEN
    CREATE POLICY "Users can update splits for own transactions" ON public.transaction_budget_splits FOR UPDATE TO authenticated
      USING (transaction_id IN (SELECT id FROM public.transactions WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_budget_splits' AND policyname = 'Users can delete splits for own transactions') THEN
    CREATE POLICY "Users can delete splits for own transactions" ON public.transaction_budget_splits FOR DELETE TO authenticated
      USING (transaction_id IN (SELECT id FROM public.transactions WHERE user_id = auth.uid()));
  END IF;
END $$;


-- ============================================================
-- 7. PENDING TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pending_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_package text NOT NULL,
  app_name text NOT NULL,
  notification_title text NOT NULL,
  notification_text text NOT NULL,
  notification_timestamp bigint NOT NULL,
  posted_at timestamptz NOT NULL,
  extracted_vendor text NOT NULL,
  extracted_amount numeric(12,2) NOT NULL,
  extracted_timestamp timestamptz NOT NULL,
  confidence integer NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  validation_reasons text NOT NULL,
  needs_review boolean DEFAULT true,
  pattern_id text,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  approved boolean,
  CONSTRAINT pending_transactions_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_pending_transactions_user_id ON public.pending_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_needs_review ON public.pending_transactions (needs_review);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_dedup ON public.pending_transactions (user_id, app_package, notification_timestamp, extracted_amount);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_extracted_dedup ON public.pending_transactions (user_id, extracted_vendor, extracted_amount, extracted_timestamp);

ALTER TABLE public.pending_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_transactions' AND policyname = 'Users can view own pending transactions') THEN
    CREATE POLICY "Users can view own pending transactions" ON public.pending_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_transactions' AND policyname = 'Users can insert own pending transactions') THEN
    CREATE POLICY "Users can insert own pending transactions" ON public.pending_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_transactions' AND policyname = 'Users can update own pending transactions') THEN
    CREATE POLICY "Users can update own pending transactions" ON public.pending_transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_transactions' AND policyname = 'Users can delete own pending transactions') THEN
    CREATE POLICY "Users can delete own pending transactions" ON public.pending_transactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 8. BUDGETS  (per-user category spending limits)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL,
  limit_amount numeric NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_household boolean DEFAULT true,
  parent_category text,
  icon text,
  color text,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT budgets_pkey PRIMARY KEY (id)
);

-- Add missing UNIQUE constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'budgets_user_category_unique' AND table_name = 'budgets'
  ) THEN
    ALTER TABLE public.budgets ADD CONSTRAINT budgets_user_category_unique UNIQUE (user_id, category);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON public.budgets (user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_category ON public.budgets (category);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can view own budgets') THEN
    CREATE POLICY "Users can view own budgets" ON public.budgets FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can insert own budgets') THEN
    CREATE POLICY "Users can insert own budgets" ON public.budgets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can update own budgets') THEN
    CREATE POLICY "Users can update own budgets" ON public.budgets FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can delete own budgets') THEN
    CREATE POLICY "Users can delete own budgets" ON public.budgets FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- Auto-update updated_at on budgets
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_budgets_updated_at ON public.budgets;
CREATE TRIGGER update_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 9. VALIDATION BASELINES  (new table)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.validation_baselines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_package text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_length_min integer NOT NULL,
  vendor_length_max integer NOT NULL,
  vendor_character_classes text NOT NULL,
  vendor_case_style text NOT NULL CHECK (vendor_case_style = ANY (ARRAY['title','lower','upper','mixed'])),
  vendor_forbidden_patterns text NOT NULL,
  amount_range_min numeric(12,2) NOT NULL,
  amount_range_max numeric(12,2) NOT NULL,
  amount_decimal_places integer NOT NULL,
  confidence_threshold integer DEFAULT 70,
  sample_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT validation_baselines_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_validation_baselines_user_id ON public.validation_baselines (user_id);
CREATE INDEX IF NOT EXISTS idx_validation_baselines_app_package ON public.validation_baselines (app_package);

ALTER TABLE public.validation_baselines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'validation_baselines' AND policyname = 'Users can view own validation baselines') THEN
    CREATE POLICY "Users can view own validation baselines" ON public.validation_baselines FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'validation_baselines' AND policyname = 'Users can insert own validation baselines') THEN
    CREATE POLICY "Users can insert own validation baselines" ON public.validation_baselines FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'validation_baselines' AND policyname = 'Users can update own validation baselines') THEN
    CREATE POLICY "Users can update own validation baselines" ON public.validation_baselines FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'validation_baselines' AND policyname = 'Users can delete own validation baselines') THEN
    CREATE POLICY "Users can delete own validation baselines" ON public.validation_baselines FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 10. NOTIFICATION RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_app_id text NOT NULL,
  bank_name text NOT NULL,
  amount_regex text NOT NULL,
  vendor_regex text NOT NULL,
  default_category_id uuid REFERENCES public.categories(id),
  is_active boolean NOT NULL DEFAULT true,
  flagged_count integer NOT NULL DEFAULT 0,
  last_flagged_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT notification_rules_pkey PRIMARY KEY (id)
);

-- Add missing UNIQUE constraint (user_id, bank_app_id, notification_type)
-- Drop old constraint if it exists (it was previously on user_id, bank_app_id only)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notification_rules_unique' AND table_name = 'notification_rules'
  ) THEN
    ALTER TABLE public.notification_rules DROP CONSTRAINT notification_rules_unique;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notification_rules_unique_v2' AND table_name = 'notification_rules'
  ) THEN
    ALTER TABLE public.notification_rules ADD CONSTRAINT notification_rules_unique_v2 UNIQUE (user_id, bank_app_id, notification_type);
  END IF;
END $$;

-- Add filter_keywords column (array of keywords for "Only Parse" feature)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_rules' AND column_name = 'filter_keywords'
  ) THEN
    ALTER TABLE public.notification_rules ADD COLUMN filter_keywords text[] DEFAULT '{}';
  END IF;
END $$;

-- Add filter_mode column ('all', 'some', or 'one' — keyword matching condition)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_rules' AND column_name = 'filter_mode'
  ) THEN
    ALTER TABLE public.notification_rules ADD COLUMN filter_mode text DEFAULT 'one' CHECK (filter_mode = ANY (ARRAY['all'::text, 'some'::text, 'one'::text]));
  END IF;
END $$;

-- Add notification_type column (label for which transaction type this rule handles)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_rules' AND column_name = 'notification_type'
  ) THEN
    ALTER TABLE public.notification_rules ADD COLUMN notification_type text DEFAULT 'default';
  END IF;
END $$;

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'Users can view own notification rules') THEN
    CREATE POLICY "Users can view own notification rules" ON public.notification_rules FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'Users can insert own notification rules') THEN
    CREATE POLICY "Users can insert own notification rules" ON public.notification_rules FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'Users can update own notification rules') THEN
    CREATE POLICY "Users can update own notification rules" ON public.notification_rules FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'Users can delete own notification rules') THEN
    CREATE POLICY "Users can delete own notification rules" ON public.notification_rules FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 11. VENDOR CATEGORY OVERRIDES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vendor_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.categories(id),
  auto_accept boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT vendor_overrides_pkey PRIMARY KEY (id)
);

-- Add auto_accept column if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vendor_overrides' AND column_name = 'auto_accept'
  ) THEN
    ALTER TABLE public.vendor_overrides ADD COLUMN auto_accept boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add missing UNIQUE constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'vendor_overrides_unique' AND table_name = 'vendor_overrides'
  ) THEN
    ALTER TABLE public.vendor_overrides ADD CONSTRAINT vendor_overrides_unique UNIQUE (user_id, vendor_name);
  END IF;
END $$;

ALTER TABLE public.vendor_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_overrides' AND policyname = 'Users can view own vendor overrides') THEN
    CREATE POLICY "Users can view own vendor overrides" ON public.vendor_overrides FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_overrides' AND policyname = 'Users can upsert own vendor overrides') THEN
    CREATE POLICY "Users can upsert own vendor overrides" ON public.vendor_overrides FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_overrides' AND policyname = 'Users can update own vendor overrides') THEN
    CREATE POLICY "Users can update own vendor overrides" ON public.vendor_overrides FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 12. FLAG REPORTS  (new table)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.flag_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_rule_id uuid REFERENCES public.notification_rules(id) ON DELETE SET NULL,
  raw_notification text NOT NULL,
  expected_vendor text,
  expected_amount numeric(12,2),
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT flag_reports_pkey PRIMARY KEY (id)
);

ALTER TABLE public.flag_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flag_reports' AND policyname = 'Users can view own flag reports') THEN
    CREATE POLICY "Users can view own flag reports" ON public.flag_reports FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flag_reports' AND policyname = 'Users can insert own flag reports') THEN
    CREATE POLICY "Users can insert own flag reports" ON public.flag_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 13. IGNORED TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ignored_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  amount numeric(12,2),
  bank_app_id text,
  expires_at timestamptz,
  reason text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT ignored_transactions_pkey PRIMARY KEY (id)
);

-- Backfill NULL reason values before adding NOT NULL (if column already exists as nullable)
UPDATE public.ignored_transactions SET reason = 'No reason provided' WHERE reason IS NULL;

-- If the column existed as nullable, alter it to NOT NULL (safe after backfill)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ignored_transactions'
      AND column_name = 'reason' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.ignored_transactions ALTER COLUMN reason SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ignored_transactions_user_id ON public.ignored_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_ignored_transactions_vendor ON public.ignored_transactions (user_id, vendor_name);

ALTER TABLE public.ignored_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ignored_transactions' AND policyname = 'Users can view own ignored transactions') THEN
    CREATE POLICY "Users can view own ignored transactions" ON public.ignored_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ignored_transactions' AND policyname = 'Users can insert own ignored transactions') THEN
    CREATE POLICY "Users can insert own ignored transactions" ON public.ignored_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ignored_transactions' AND policyname = 'Users can update own ignored transactions') THEN
    CREATE POLICY "Users can update own ignored transactions" ON public.ignored_transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ignored_transactions' AND policyname = 'Users can delete own ignored transactions') THEN
    CREATE POLICY "Users can delete own ignored transactions" ON public.ignored_transactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 14. NOTIFICATION FINGERPRINTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_fingerprints (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint_hash text NOT NULL,
  bank_app_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT notification_fingerprints_pkey PRIMARY KEY (id)
);

-- Add missing UNIQUE constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notification_fingerprints_unique' AND table_name = 'notification_fingerprints'
  ) THEN
    ALTER TABLE public.notification_fingerprints ADD CONSTRAINT notification_fingerprints_unique UNIQUE (user_id, fingerprint_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_fingerprints_user_id ON public.notification_fingerprints (user_id);
CREATE INDEX IF NOT EXISTS idx_notification_fingerprints_hash ON public.notification_fingerprints (user_id, fingerprint_hash);

ALTER TABLE public.notification_fingerprints ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_fingerprints' AND policyname = 'Users can view own notification fingerprints') THEN
    CREATE POLICY "Users can view own notification fingerprints" ON public.notification_fingerprints FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_fingerprints' AND policyname = 'Users can insert own notification fingerprints') THEN
    CREATE POLICY "Users can insert own notification fingerprints" ON public.notification_fingerprints FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
