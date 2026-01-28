-- ============================================================
-- COVAULT DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. DROP OLD TABLES (order matters due to foreign keys)
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.primary_categories CASCADE;
DROP TABLE IF EXISTS public.user_profiles CASCADE;
DROP TABLE IF EXISTS public.linked_partners CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;

-- ============================================================
-- 2. TABLES WITHOUT RLS
-- ============================================================

-- Categories: 6 universal budget categories (read-only for all users)
CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  display_order integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_name_key UNIQUE (name)
);

-- Seed the 6 immutable categories
INSERT INTO public.categories (name, display_order) VALUES
  ('Housing', 1),
  ('Groceries', 2),
  ('Transport', 3),
  ('Utilities', 4),
  ('Leisure', 5),
  ('Other', 6);

-- Allow all authenticated users to read categories, no one can modify
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read categories"
  ON public.categories FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 3. TABLES WITH RLS
-- ============================================================

-- User Profiles: settings + profile info, one row per user
CREATE TABLE public.user_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  monthly_income numeric(12,2) NOT NULL DEFAULT 5000.00,
  budgeting_solo boolean NOT NULL DEFAULT true,
  theme text NOT NULL DEFAULT 'light',
  has_seen_tutorial boolean NOT NULL DEFAULT false,
  rollover_enabled boolean NOT NULL DEFAULT true,
  rollover_overspend boolean NOT NULL DEFAULT false,
  use_leisure_as_buffer boolean NOT NULL DEFAULT true,
  show_savings_insight boolean NOT NULL DEFAULT true,
  budget_limits jsonb NOT NULL DEFAULT '{"Housing":1500,"Groceries":600,"Transport":300,"Utilities":150,"Leisure":400,"Other":100}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT user_profiles_user_id_key UNIQUE (user_id)
);

CREATE INDEX idx_user_profiles_user_id ON public.user_profiles (user_id);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.user_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Auto-create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1), 'User')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Linked Partners: connections between two users
CREATE TABLE public.linked_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT linked_partners_pkey PRIMARY KEY (id),
  CONSTRAINT linked_partners_no_self CHECK (user_id <> partner_id),
  CONSTRAINT linked_partners_unique UNIQUE (user_id, partner_id),
  CONSTRAINT linked_partners_status_check CHECK (
    status = ANY (ARRAY['pending', 'accepted', 'rejected'])
  )
);

CREATE INDEX idx_linked_partners_user_id ON public.linked_partners (user_id);
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

-- Transactions
CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  amount numeric(12,2) NOT NULL,
  date date NOT NULL,
  category_id uuid NOT NULL REFERENCES public.categories(id),
  recurrence text NOT NULL DEFAULT 'One-time',
  label text NOT NULL DEFAULT 'Manual',
  is_projected boolean NOT NULL DEFAULT false,
  split_group_id uuid,
  source_hash text,
  user_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_recurrence_check CHECK (
    recurrence = ANY (ARRAY['One-time', 'Biweekly', 'Monthly'])
  ),
  CONSTRAINT transactions_label_check CHECK (
    label = ANY (ARRAY['Auto-Added', 'Manual', 'Auto-Added + Edited'])
  )
);

CREATE INDEX idx_transactions_user_id ON public.transactions (user_id);
CREATE INDEX idx_transactions_date ON public.transactions (date);
CREATE INDEX idx_transactions_category_id ON public.transactions (category_id);
CREATE INDEX idx_transactions_split_group ON public.transactions (split_group_id)
  WHERE split_group_id IS NOT NULL;
CREATE INDEX idx_transactions_source_hash ON public.transactions (source_hash)
  WHERE source_hash IS NOT NULL;
-- For vendor autocomplete: find distinct vendors per user quickly
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

-- Also allow users to see their partner's transactions (for shared budgeting)
CREATE POLICY "Users can view partner transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT partner_id FROM public.linked_partners
      WHERE user_id = auth.uid() AND status = 'accepted'
      UNION
      SELECT user_id FROM public.linked_partners
      WHERE partner_id = auth.uid() AND status = 'accepted'
    )
  );
