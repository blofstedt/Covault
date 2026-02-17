-- ============================================================
-- COVAULT DATABASE SCHEMA  (paste into Supabase SQL Editor)
-- FRESH INSTALL ONLY — drops everything and rebuilds.
-- Do NOT run on an existing database with data you want to keep.
-- For safe migration, see schema.sql instead.
-- ============================================================
-- Tables: budgets, settings, transactions, pending_transactions,
--         ignored_transactions, vendor_overrides, known_banking_apps
-- ============================================================

-- 1. DROP ALL EXISTING TABLES
DROP TABLE IF EXISTS public.ignored_transactions CASCADE;
DROP TABLE IF EXISTS public.vendor_overrides CASCADE;
DROP TABLE IF EXISTS public.pending_transactions CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.budgets CASCADE;
DROP TABLE IF EXISTS public.settings CASCADE;
DROP TABLE IF EXISTS public.known_banking_apps CASCADE;
-- Legacy tables (safe to drop even if they don't exist)
DROP TABLE IF EXISTS public.notification_fingerprints CASCADE;
DROP TABLE IF EXISTS public.transaction_budget_splits CASCADE;
DROP TABLE IF EXISTS public.notification_rules CASCADE;
DROP TABLE IF EXISTS public.flag_reports CASCADE;
DROP TABLE IF EXISTS public.validation_baselines CASCADE;
DROP TABLE IF EXISTS public.household_links CASCADE;
DROP TABLE IF EXISTS public.link_codes CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.user_budgets CASCADE;
DROP TABLE IF EXISTS public.linked_partners CASCADE;
DROP TABLE IF EXISTS public.partners CASCADE;
DROP TABLE IF EXISTS public.user_profiles CASCADE;
DROP TABLE IF EXISTS public.primary_categories CASCADE;

-- Drop old trigger/function if they exist
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ============================================================
-- 2. BUDGETS  (categories ARE budgets — each user gets 7 defaults)
-- ============================================================
CREATE TABLE public.budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL,
  limit_amount numeric NOT NULL DEFAULT 0,
  user_id uuid NOT NULL,
  is_household boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  visible boolean NOT NULL DEFAULT true,
  CONSTRAINT budgets_pkey PRIMARY KEY (id),
  CONSTRAINT budgets_user_id_category_key UNIQUE (user_id, category),
  CONSTRAINT budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own budgets"
  ON public.budgets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view partner budgets"
  ON public.budgets FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT s.partner_id FROM public.settings s WHERE s.user_id = auth.uid() AND s.partner_id IS NOT NULL
    )
  );

CREATE POLICY "Users can insert own budgets"
  ON public.budgets FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own budgets"
  ON public.budgets FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own budgets"
  ON public.budgets FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. SETTINGS  (one row per user)
-- ============================================================
CREATE TABLE public.settings (
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  partner_id uuid,
  partner_email text,
  partner_name text,
  budgeting_solo boolean DEFAULT true,
  monthly_income numeric DEFAULT 0 CHECK (monthly_income >= 0),
  rollover_enabled boolean DEFAULT true,
  leisure_buffer_enable boolean DEFAULT true,
  show_savings_insight boolean DEFAULT true,
  app_notifications_enabled boolean DEFAULT false,
  theme_selected text DEFAULT 'dark',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_consumed boolean DEFAULT false,
  subscription_status text DEFAULT 'none' CHECK (subscription_status IN ('none', 'active', 'expired')),
  link_code text,
  CONSTRAINT settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT settings_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES auth.users(id)
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings"
  ON public.settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view partner settings"
  ON public.settings FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT s.partner_id FROM public.settings s WHERE s.user_id = auth.uid() AND s.partner_id IS NOT NULL
    )
  );

CREATE POLICY "Users can insert own settings"
  ON public.settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON public.settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-create a settings row when a new user signs up
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
    true,
    'none'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 4. TRANSACTIONS
-- ============================================================
CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor text NOT NULL,
  amount numeric NOT NULL,
  date date NOT NULL,
  category_id uuid NOT NULL,
  recurrence text NOT NULL DEFAULT 'One-time' CHECK (recurrence IN ('One-time', 'Biweekly', 'Monthly')),
  label text NOT NULL DEFAULT 'Manual' CHECK (label IN ('Auto-Added', 'Manual', 'Auto-Added + Edited', 'AI')),
  is_projected boolean NOT NULL DEFAULT false,
  user_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  description text,
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE INDEX idx_transactions_user_id     ON public.transactions (user_id);
CREATE INDEX idx_transactions_date        ON public.transactions (date);
CREATE INDEX idx_transactions_category_id ON public.transactions (category_id);
CREATE INDEX idx_transactions_user_vendor ON public.transactions (user_id, vendor);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view partner transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT s.partner_id FROM public.settings s WHERE s.user_id = auth.uid() AND s.partner_id IS NOT NULL
    )
  );

CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON public.transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 5. PENDING TRANSACTIONS
-- Auto-parsed transactions awaiting user approval
-- ============================================================
CREATE TABLE public.pending_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  app_package text NOT NULL,
  app_name text NOT NULL,
  notification_timestamp bigint NOT NULL,
  posted_at timestamptz NOT NULL,
  extracted_vendor text NOT NULL,
  extracted_amount numeric NOT NULL,
  extracted_timestamp timestamptz NOT NULL,
  confidence smallint NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT pending_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT pending_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE INDEX idx_pending_transactions_status ON public.pending_transactions (user_id, status);

ALTER TABLE public.pending_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pending transactions"
  ON public.pending_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pending transactions"
  ON public.pending_transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pending transactions"
  ON public.pending_transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pending transactions"
  ON public.pending_transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 6. IGNORED TRANSACTIONS
-- Persist user rules to ignore known non-expense notifications
-- ============================================================
CREATE TABLE public.ignored_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor_name text NOT NULL,
  amount numeric,
  bank_app_id text,
  expires_at timestamptz,
  reason text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT ignored_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT ignored_transactions_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE INDEX idx_ignored_transactions_user_id ON public.ignored_transactions (user_id);
CREATE INDEX idx_ignored_transactions_vendor  ON public.ignored_transactions (user_id, vendor_name);

ALTER TABLE public.ignored_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ignored transactions"
  ON public.ignored_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ignored transactions"
  ON public.ignored_transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ignored transactions"
  ON public.ignored_transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own ignored transactions"
  ON public.ignored_transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 7. VENDOR OVERRIDES  (reclassification memory)
-- ============================================================
CREATE TABLE public.vendor_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor_name text NOT NULL,
  category_id uuid NOT NULL,
  proper_name text,
  CONSTRAINT vendor_overrides_pkey PRIMARY KEY (id),
  CONSTRAINT vendor_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

ALTER TABLE public.vendor_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vendor overrides"
  ON public.vendor_overrides FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own vendor overrides"
  ON public.vendor_overrides FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own vendor overrides"
  ON public.vendor_overrides FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own vendor overrides"
  ON public.vendor_overrides FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 8. KNOWN BANKING APPS  (banking app identifiers)
-- ============================================================
CREATE TABLE public.known_banking_apps (
  package_name text NOT NULL,
  display_name text NOT NULL,
  country text NOT NULL DEFAULT 'US',
  app_type text NOT NULL DEFAULT 'bank' CHECK (app_type IN ('bank', 'credit_card', 'fintech', 'credit_union', 'investment', 'payment')),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT known_banking_apps_pkey PRIMARY KEY (package_name)
);

ALTER TABLE public.known_banking_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read known banking apps"
  ON public.known_banking_apps FOR SELECT TO authenticated
  USING (true);
