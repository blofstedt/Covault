-- ============================================================
-- COVAULT DATABASE SCHEMA  (paste into Supabase SQL Editor)
-- Drops everything and rebuilds with RLS policies
-- ============================================================

-- 1. DROP ALL EXISTING TABLES
DROP TABLE IF EXISTS public.transactions  CASCADE;
DROP TABLE IF EXISTS public.transaction_budget_splits CASCADE;
DROP TABLE IF EXISTS public.pending_transactions CASCADE;
DROP TABLE IF EXISTS public.budgets CASCADE;
DROP TABLE IF EXISTS public.user_budgets   CASCADE;
DROP TABLE IF EXISTS public.household_links CASCADE;
DROP TABLE IF EXISTS public.link_codes CASCADE;
DROP TABLE IF EXISTS public.linked_partners CASCADE;
DROP TABLE IF EXISTS public.partners       CASCADE;
DROP TABLE IF EXISTS public.settings       CASCADE;
DROP TABLE IF EXISTS public.user_profiles  CASCADE;
DROP TABLE IF EXISTS public.primary_categories CASCADE;
DROP TABLE IF EXISTS public.categories     CASCADE;
DROP TABLE IF EXISTS public.validation_baselines CASCADE;

-- Drop old trigger/function if they exist
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ============================================================
-- 2. CATEGORIES  (read-only for all authenticated users)
-- ============================================================
CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  display_order integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_name_key UNIQUE (name)
);

INSERT INTO public.categories (name, display_order) VALUES
  ('Housing',   1),
  ('Groceries', 2),
  ('Transport', 3),
  ('Utilities', 4),
  ('Leisure',   5),
  ('Other',     6);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read categories"
  ON public.categories FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 3. SETTINGS  (one row per user, keyed by user_id)
-- ============================================================
CREATE TABLE public.settings (
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

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings"
  ON public.settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

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
  INSERT INTO public.settings (user_id, name, email, monthly_income)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name',
             split_part(NEW.email, '@', 1),
             'User'),
    NEW.email,
    5000
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 4. HOUSEHOLD LINKS (replaces linked_partners)
-- Links two users together as household partners
-- Shows "Our Remaining Balance" when linked
-- ============================================================
CREATE TABLE public.household_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user1_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user2_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  user1_name text,
  user2_name text,
  CONSTRAINT household_links_pkey PRIMARY KEY (id),
  CONSTRAINT household_links_no_self CHECK (user1_id <> user2_id),
  CONSTRAINT household_links_unique UNIQUE (user1_id, user2_id)
);

CREATE INDEX idx_household_links_user1_id ON public.household_links (user1_id);
CREATE INDEX idx_household_links_user2_id ON public.household_links (user2_id);

ALTER TABLE public.household_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own household links"
  ON public.household_links FOR SELECT TO authenticated
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can create household links"
  ON public.household_links FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can update household links they're part of"
  ON public.household_links FOR UPDATE TO authenticated
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can delete own household links"
  ON public.household_links FOR DELETE TO authenticated
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- ============================================================
-- 5. LINK CODES (for joining households via code)
-- ============================================================
CREATE TABLE public.link_codes (
  code text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT link_codes_pkey PRIMARY KEY (code)
);

CREATE INDEX idx_link_codes_user_id ON public.link_codes (user_id);
CREATE INDEX idx_link_codes_expires_at ON public.link_codes (expires_at);

ALTER TABLE public.link_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own link codes"
  ON public.link_codes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own link codes"
  ON public.link_codes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own link codes"
  ON public.link_codes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can read valid link codes"
  ON public.link_codes FOR SELECT TO authenticated
  USING (expires_at > now());

-- ============================================================
-- 6. TRANSACTIONS
-- ============================================================
CREATE TABLE public.transactions (
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

CREATE INDEX idx_transactions_user_id     ON public.transactions (user_id);
CREATE INDEX idx_transactions_date        ON public.transactions (date);
CREATE INDEX idx_transactions_category_id ON public.transactions (category_id);
CREATE INDEX idx_transactions_split_group ON public.transactions (split_group_id)
  WHERE split_group_id IS NOT NULL;
CREATE INDEX idx_transactions_source_hash ON public.transactions (source_hash)
  WHERE source_hash IS NOT NULL;
CREATE INDEX idx_transactions_user_vendor ON public.transactions (user_id, vendor);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON public.transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view partner transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT hl.user2_id FROM public.household_links hl
       WHERE hl.user1_id = auth.uid()
      UNION
      SELECT hl.user1_id FROM public.household_links hl
       WHERE hl.user2_id = auth.uid()
    )
  );

-- ============================================================
-- 7. TRANSACTION BUDGET SPLITS
-- Used when a transaction is split across multiple categories
-- ============================================================
CREATE TABLE public.transaction_budget_splits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  budget_category text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  percentage numeric CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT transaction_budget_splits_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_transaction_budget_splits_transaction_id ON public.transaction_budget_splits (transaction_id);

ALTER TABLE public.transaction_budget_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view splits for own transactions"
  ON public.transaction_budget_splits FOR SELECT TO authenticated
  USING (
    transaction_id IN (
      SELECT id FROM public.transactions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert splits for own transactions"
  ON public.transaction_budget_splits FOR INSERT TO authenticated
  WITH CHECK (
    transaction_id IN (
      SELECT id FROM public.transactions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update splits for own transactions"
  ON public.transaction_budget_splits FOR UPDATE TO authenticated
  USING (
    transaction_id IN (
      SELECT id FROM public.transactions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete splits for own transactions"
  ON public.transaction_budget_splits FOR DELETE TO authenticated
  USING (
    transaction_id IN (
      SELECT id FROM public.transactions WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 8. PENDING TRANSACTIONS
-- Auto-parsed transactions awaiting user approval
-- Sits in "purgatory" in dashboard until reviewed
-- ============================================================
CREATE TABLE public.pending_transactions (
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

CREATE INDEX idx_pending_transactions_user_id ON public.pending_transactions (user_id);
CREATE INDEX idx_pending_transactions_needs_review ON public.pending_transactions (needs_review);

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
-- 9. BUDGETS  (per-user category spending limits)
-- ============================================================
CREATE TABLE public.budgets (
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
  CONSTRAINT budgets_pkey PRIMARY KEY (id),
  CONSTRAINT budgets_user_category_unique UNIQUE (user_id, category)
);

CREATE INDEX idx_budgets_user_id ON public.budgets (user_id);
CREATE INDEX idx_budgets_category ON public.budgets (category);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own budgets"
  ON public.budgets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

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
-- 10. VALIDATION BASELINES
-- REGEX patterns for notification parsing validation
-- ============================================================
CREATE TABLE public.validation_baselines (
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

CREATE INDEX idx_validation_baselines_user_id ON public.validation_baselines (user_id);
CREATE INDEX idx_validation_baselines_app_package ON public.validation_baselines (app_package);

ALTER TABLE public.validation_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own validation baselines"
  ON public.validation_baselines FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own validation baselines"
  ON public.validation_baselines FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own validation baselines"
  ON public.validation_baselines FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own validation baselines"
  ON public.validation_baselines FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 11. NOTIFICATION RULES  (bank regex patterns per user)
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
  CONSTRAINT notification_rules_pkey PRIMARY KEY (id),
  CONSTRAINT notification_rules_unique UNIQUE (user_id, bank_app_id)
);

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification rules"
  ON public.notification_rules FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notification rules"
  ON public.notification_rules FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notification rules"
  ON public.notification_rules FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own notification rules"
  ON public.notification_rules FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 12. VENDOR CATEGORY OVERRIDES  (reclassification memory)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vendor_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.categories(id),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT vendor_overrides_pkey PRIMARY KEY (id),
  CONSTRAINT vendor_overrides_unique UNIQUE (user_id, vendor_name)
);

ALTER TABLE public.vendor_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vendor overrides"
  ON public.vendor_overrides FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can upsert own vendor overrides"
  ON public.vendor_overrides FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own vendor overrides"
  ON public.vendor_overrides FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 13. FLAG REPORTS  (rate-limited Gemini correction requests)
--    Max 5 per 24h, 1h cooldown between reports
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

CREATE POLICY "Users can view own flag reports"
  ON public.flag_reports FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own flag reports"
  ON public.flag_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
