-- ============================================================
-- COVAULT DATABASE SCHEMA (CORRECT VERSION)
-- Based on the problem statement requirements
-- ============================================================

-- DROP ALL EXISTING TABLES
DROP TABLE IF EXISTS public.vendor_overrides CASCADE;
DROP TABLE IF EXISTS public.flag_reports CASCADE;
DROP TABLE IF EXISTS public.user_budgets CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.notification_rules CASCADE;
DROP TABLE IF EXISTS public.linked_partners CASCADE;
DROP TABLE IF EXISTS public.settings CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;

-- ============================================================
-- 1. CATEGORIES
-- ============================================================
CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_order integer NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id)
);

-- Insert default categories
INSERT INTO public.categories (name, display_order) VALUES
  ('Housing', 1),
  ('Groceries', 2),
  ('Transport', 3),
  ('Utilities', 4),
  ('Leisure', 5),
  ('Other', 6);

-- ============================================================
-- 2. SETTINGS
-- ============================================================
CREATE TABLE public.settings (
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  partner_id uuid,
  partner_email text,
  partner_name text,
  has_joint_accounts boolean DEFAULT false,
  budgeting_solo boolean DEFAULT true,
  monthly_income numeric DEFAULT 0 CHECK (monthly_income >= 0::numeric),
  rollover_enabled boolean DEFAULT true,
  rollover_overspend boolean DEFAULT false,
  use_leisure_as_buffer boolean DEFAULT true,
  show_savings_insight boolean DEFAULT true,
  theme text DEFAULT 'light'::text CHECK (theme = ANY (ARRAY['light'::text, 'dark'::text])),
  has_seen_tutorial boolean DEFAULT false,
  app_notifications_enabled boolean DEFAULT false,
  CONSTRAINT settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT settings_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES auth.users(id)
);

-- ============================================================
-- 3. LINKED PARTNERS
-- ============================================================
CREATE TABLE public.linked_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT linked_partners_pkey PRIMARY KEY (id),
  CONSTRAINT linked_partners_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT linked_partners_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES auth.users(id)
);

-- ============================================================
-- 4. NOTIFICATION RULES
-- ============================================================
CREATE TABLE public.notification_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bank_app_id text NOT NULL,
  bank_name text NOT NULL,
  amount_regex text NOT NULL,
  vendor_regex text NOT NULL,
  default_category_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  flagged_count integer NOT NULL DEFAULT 0,
  last_flagged_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_rules_pkey PRIMARY KEY (id),
  CONSTRAINT notification_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT notification_rules_default_category_id_fkey FOREIGN KEY (default_category_id) REFERENCES public.categories(id)
);

-- ============================================================
-- 5. TRANSACTIONS
-- ============================================================
CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor text NOT NULL,
  amount numeric NOT NULL,
  date date NOT NULL,
  category_id uuid NOT NULL,
  recurrence text NOT NULL DEFAULT 'One-time'::text CHECK (recurrence = ANY (ARRAY['One-time'::text, 'Biweekly'::text, 'Monthly'::text])),
  label text NOT NULL DEFAULT 'Manual'::text CHECK (label = ANY (ARRAY['Auto-Added'::text, 'Manual'::text, 'Auto-Added + Edited'::text])),
  is_projected boolean NOT NULL DEFAULT false,
  split_group_id uuid,
  source_hash text,
  user_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);

-- ============================================================
-- 6. USER BUDGETS
-- ============================================================
CREATE TABLE public.user_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category_id uuid NOT NULL,
  total_limit numeric NOT NULL DEFAULT 0 CHECK (total_limit >= 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_budgets_pkey PRIMARY KEY (id),
  CONSTRAINT user_budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);

-- ============================================================
-- 7. VENDOR OVERRIDES
-- ============================================================
CREATE TABLE public.vendor_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor_name text NOT NULL,
  category_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT vendor_overrides_pkey PRIMARY KEY (id),
  CONSTRAINT vendor_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT vendor_overrides_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);

-- ============================================================
-- 8. FLAG REPORTS
-- ============================================================
CREATE TABLE public.flag_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  notification_rule_id uuid,
  raw_notification text NOT NULL,
  expected_vendor text,
  expected_amount numeric,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT flag_reports_pkey PRIMARY KEY (id),
  CONSTRAINT flag_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT flag_reports_notification_rule_id_fkey FOREIGN KEY (notification_rule_id) REFERENCES public.notification_rules(id)
);
