-- ============================================================
-- COVAULT DATABASE SCHEMA  (paste into Supabase SQL Editor)
-- Drops everything and rebuilds with RLS policies
-- ============================================================

-- 1. DROP ALL EXISTING TABLES
DROP TABLE IF EXISTS public.transactions  CASCADE;
DROP TABLE IF EXISTS public.user_budgets   CASCADE;
DROP TABLE IF EXISTS public.linked_partners CASCADE;
DROP TABLE IF EXISTS public.partners       CASCADE;
DROP TABLE IF EXISTS public.settings       CASCADE;
DROP TABLE IF EXISTS public.user_profiles  CASCADE;
DROP TABLE IF EXISTS public.primary_categories CASCADE;
DROP TABLE IF EXISTS public.categories     CASCADE;

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
  USING (auth.uid() = user_id);

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
-- 4. LINKED PARTNERS
-- ============================================================
CREATE TABLE public.linked_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','accepted','rejected'])),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT linked_partners_pkey PRIMARY KEY (id),
  CONSTRAINT linked_partners_no_self CHECK (user_id <> partner_id),
  CONSTRAINT linked_partners_unique UNIQUE (user_id, partner_id)
);

CREATE INDEX idx_linked_partners_user_id    ON public.linked_partners (user_id);
CREATE INDEX idx_linked_partners_partner_id ON public.linked_partners (partner_id);

ALTER TABLE public.linked_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own partnerships"
  ON public.linked_partners FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = partner_id);

CREATE POLICY "Users can create partnership requests"
  ON public.linked_partners FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update partnerships they're part of"
  ON public.linked_partners FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = partner_id);

CREATE POLICY "Users can delete own partnership requests"
  ON public.linked_partners FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 5. TRANSACTIONS
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
      SELECT lp.partner_id FROM public.linked_partners lp
       WHERE lp.user_id = auth.uid() AND lp.status = 'accepted'
      UNION
      SELECT lp.user_id FROM public.linked_partners lp
       WHERE lp.partner_id = auth.uid() AND lp.status = 'accepted'
    )
  );

-- ============================================================
-- 6. USER BUDGETS  (per-user category spending limits)
-- ============================================================
CREATE TABLE public.user_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id),
  total_limit numeric NOT NULL DEFAULT 0 CHECK (total_limit >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT user_budgets_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_user_budgets_user_id ON public.user_budgets (user_id);

ALTER TABLE public.user_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own budgets"
  ON public.user_budgets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own budgets"
  ON public.user_budgets FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own budgets"
  ON public.user_budgets FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own budgets"
  ON public.user_budgets FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
